//! AES-256-GCM encryption for SSH credentials stored in redb JSON documents.
//!
//! ## Key hierarchy
//!
//! ```text
//! wrapping_key  = SHA-256("dragonfly-key-wrap-v1:" || master_password_or_home_path)
//! master.key    = redb text doc containing base64( wrap_nonce[12] || AES-256-GCM(wrapping_key, master_key[32]) )
//! sessions doc  = { "password": base64( nonce[12] || AES-256-GCM(master_key, plaintext) ), … }
//! ```
//!
//! When a master password is configured the wrapping key is derived from it;
//! otherwise the user's home directory path is used as the key material.
//!
//! The master password itself is stored in the settings document encrypted with the
//! home-path-derived key (via [`encrypt_settings_secret`]) to avoid a circular
//! dependency during bootstrap.

use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::sync::RwLock;

static MASTER_PASSWORD: RwLock<Option<String>> = RwLock::new(None);

/// Set the master password used for wrapping key derivation.
/// Pass `None` to revert to home-path-based derivation.
pub fn set_master_password(password: Option<String>) {
    let mut pw = MASTER_PASSWORD.write().unwrap();
    *pw = password.filter(|s| !s.is_empty());
}

/// Returns the currently configured master password, if any.
pub fn get_master_password() -> Option<String> {
    MASTER_PASSWORD.read().unwrap().clone()
}

/// Derives a wrapping key from the given material.
///
/// When `password` is `Some`, uses the password as key material.
/// Otherwise falls back to the home directory path.
fn derive_wrapping_key(password: Option<&str>) -> AppResult<Key<Aes256Gcm>> {
    let mut h = Sha256::new();
    h.update(b"dragonfly-key-wrap-v1:");
    match password {
        Some(pw) => h.update(pw.as_bytes()),
        None => {
            let home = dirs::home_dir()
                .ok_or_else(|| AppError::Crypto("cannot determine home directory".into()))?;
            h.update(home.to_string_lossy().as_bytes());
        }
    }
    let digest = h.finalize();
    Ok(*Key::<Aes256Gcm>::from_slice(&digest))
}

/// Derives the wrapping key from the current master password (or home path).
fn get_wrapping_key() -> AppResult<Key<Aes256Gcm>> {
    let pw = get_master_password();
    derive_wrapping_key(pw.as_deref())
}

/// Wraps `master_key` with `wrapping_key` and writes it to redb `master.key`.
fn write_wrapped_master_key(
    master_key: &Key<Aes256Gcm>,
    wrapping_key: &Key<Aes256Gcm>,
) -> AppResult<()> {
    let cipher = Aes256Gcm::new(wrapping_key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let wrapped = cipher
        .encrypt(&nonce, master_key.as_slice())
        .map_err(|e| AppError::Crypto(format!("wrap master.key: {e}")))?;

    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&wrapped);

    crate::storage::save_text_doc(crate::storage::TEXT_MASTER_KEY, &B64.encode(&combined))?;
    Ok(())
}

/// Unwraps the master key from the raw bytes of `master.key`.
fn unwrap_master_key_bytes(raw: &[u8], wrapping_key: &Key<Aes256Gcm>) -> AppResult<Key<Aes256Gcm>> {
    if raw.len() < 13 {
        return Err(AppError::Crypto("master.key file is malformed".into()));
    }
    let cipher = Aes256Gcm::new(wrapping_key);
    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
    let master_key_bytes = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(format!("unwrap master.key: {e}")))?;

    if master_key_bytes.len() != 32 {
        return Err(AppError::Crypto("master key length mismatch".into()));
    }
    Ok(*Key::<Aes256Gcm>::from_slice(&master_key_bytes))
}

/// Loads the master key from redb `master.key`, creating it on first use.
fn get_master_key() -> AppResult<Key<Aes256Gcm>> {
    if let Some(encoded) = crate::storage::load_text_doc(crate::storage::TEXT_MASTER_KEY)? {
        let raw = B64
            .decode(encoded.trim())
            .map_err(|e| AppError::Crypto(format!("decode master.key: {e}")))?;

        let wrapping_key = get_wrapping_key()?;
        unwrap_master_key_bytes(&raw, &wrapping_key)
    } else {
        let master_key = Aes256Gcm::generate_key(OsRng);
        let wrapping_key = get_wrapping_key()?;
        write_wrapped_master_key(&master_key, &wrapping_key)?;
        Ok(master_key)
    }
}

/// Re-wraps the existing master key when the master password changes.
///
/// `old_password` is the previous master password (`None` = home-path-based).
/// `new_password` is the new master password (`None` = revert to home-path-based).
pub fn rewrap_master_key(old_password: Option<&str>, new_password: Option<&str>) -> AppResult<()> {
    let master_key = if let Some(encoded) =
        crate::storage::load_text_doc(crate::storage::TEXT_MASTER_KEY)?
    {
        let raw = B64
            .decode(encoded.trim())
            .map_err(|e| AppError::Crypto(format!("decode master.key: {e}")))?;

        let old_wrapping = derive_wrapping_key(old_password)?;
        unwrap_master_key_bytes(&raw, &old_wrapping)?
    } else {
        Aes256Gcm::generate_key(OsRng)
    };

    let new_wrapping = derive_wrapping_key(new_password)?;
    write_wrapped_master_key(&master_key, &new_wrapping)?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Settings-secret helpers (for the master password field in the settings document)
// ---------------------------------------------------------------------------

/// Encrypts a value using the home-path-derived key directly (not via master.key).
///
/// Used exclusively for storing the master password in settings.json to avoid
/// a circular dependency: we need the master password to unwrap master.key,
/// but master.key is needed to call [`encrypt`].
pub fn encrypt_settings_secret(plaintext: &str) -> AppResult<String> {
    let key = derive_wrapping_key(None)?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Crypto(format!("encryption failed: {e}")))?;

    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

/// Decrypts a value produced by [`encrypt_settings_secret`].
pub fn decrypt_settings_secret(token: &str) -> AppResult<String> {
    let key = derive_wrapping_key(None)?;
    let cipher = Aes256Gcm::new(&key);
    let raw = B64
        .decode(token)
        .map_err(|e| AppError::Crypto(format!("invalid base64: {e}")))?;

    if raw.len() < 13 {
        return Err(AppError::Crypto("ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(format!("decryption failed: {e}")))?;

    String::from_utf8(plaintext).map_err(|e| AppError::Crypto(format!("invalid UTF-8: {e}")))
}

// ---------------------------------------------------------------------------
// Public encrypt / decrypt (use the master key from master.key)
// ---------------------------------------------------------------------------

/// Encrypts `plaintext` with AES-256-GCM.
///
/// Returns `base64( nonce[12] || ciphertext+tag )`.
pub fn encrypt(plaintext: &str) -> AppResult<String> {
    let key = get_master_key()?;
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, plaintext.as_bytes())
        .map_err(|e| AppError::Crypto(format!("encryption failed: {e}")))?;

    let mut combined = nonce.to_vec();
    combined.extend_from_slice(&ciphertext);
    Ok(B64.encode(&combined))
}

/// Decrypts a `base64( nonce || ciphertext )` token produced by [`encrypt`].
pub fn decrypt(token: &str) -> AppResult<String> {
    let key = get_master_key()?;
    let cipher = Aes256Gcm::new(&key);
    let raw = B64
        .decode(token)
        .map_err(|e| AppError::Crypto(format!("invalid base64: {e}")))?;

    if raw.len() < 13 {
        return Err(AppError::Crypto("ciphertext too short".into()));
    }

    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
    let plaintext = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(format!("decryption failed: {e}")))?;

    String::from_utf8(plaintext).map_err(|e| AppError::Crypto(format!("invalid UTF-8: {e}")))
}

/// Decrypts an optional token, returning `None` when the input is `None` or empty.
pub fn decrypt_optional(token: &Option<String>) -> AppResult<Option<String>> {
    match token {
        Some(t) if !t.is_empty() => Ok(Some(decrypt(t)?)),
        _ => Ok(None),
    }
}

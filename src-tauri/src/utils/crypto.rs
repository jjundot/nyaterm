//! AES-256-GCM encryption for SSH credentials stored in sessions.json.
//!
//! ## Key hierarchy
//!
//! ```text
//! wrapping_key  = SHA-256("dragonfly-key-wrap-v1:" || home_path)
//! master.key    = base64( wrap_nonce[12] || AES-256-GCM(wrapping_key, master_key[32]) )
//! sessions.json = { "password": base64( nonce[12] || AES-256-GCM(master_key, plaintext) ), … }
//! ```
//!
//! Copying `master.key` to another machine/user account alone is not sufficient to decrypt
//! credentials — the wrapping key is derived from the local user's home directory path.

use crate::error::{AppError, AppResult};
use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use sha2::{Digest, Sha256};
use std::path::PathBuf;

fn key_file_path() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Crypto("cannot determine home directory".into()))?;
    Ok(home.join(".dragonfly").join("master.key"))
}

/// Derives the wrapping key from the user's home directory path.
///
/// `wrapping_key = SHA-256("dragonfly-key-wrap-v1:" || home_path)`
fn get_wrapping_key() -> AppResult<Key<Aes256Gcm>> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Crypto("cannot determine home directory".into()))?;

    let mut h = Sha256::new();
    h.update(b"dragonfly-key-wrap-v1:");
    h.update(home.to_string_lossy().as_bytes());
    let digest = h.finalize();

    Ok(*Key::<Aes256Gcm>::from_slice(&digest))
}

/// Loads the master key from `~/.dragonfly/master.key`, creating it on first use.
///
/// The file stores the master key wrapped (AES-256-GCM) with the wrapping key.
fn get_master_key() -> AppResult<Key<Aes256Gcm>> {
    let path = key_file_path()?;

    if path.exists() {
        let encoded = std::fs::read_to_string(&path)
            .map_err(|e| AppError::Crypto(format!("read master.key: {e}")))?;
        let raw = B64
            .decode(encoded.trim())
            .map_err(|e| AppError::Crypto(format!("decode master.key: {e}")))?;

        if raw.len() < 13 {
            return Err(AppError::Crypto("master.key file is malformed".into()));
        }

        let wrapping_key = get_wrapping_key()?;
        let cipher = Aes256Gcm::new(&wrapping_key);
        let (nonce_bytes, ciphertext) = raw.split_at(12);
        let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);
        let master_key_bytes = cipher
            .decrypt(nonce, ciphertext)
            .map_err(|e| AppError::Crypto(format!("unwrap master.key: {e}")))?;

        if master_key_bytes.len() != 32 {
            return Err(AppError::Crypto("master key length mismatch".into()));
        }
        Ok(*Key::<Aes256Gcm>::from_slice(&master_key_bytes))
    } else {
        // First run: generate a random master key and wrap it for storage.
        let master_key = Aes256Gcm::generate_key(OsRng);

        let wrapping_key = get_wrapping_key()?;
        let cipher = Aes256Gcm::new(&wrapping_key);
        let wrap_nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let wrapped = cipher
            .encrypt(&wrap_nonce, master_key.as_slice())
            .map_err(|e| AppError::Crypto(format!("wrap master.key: {e}")))?;

        let mut combined = wrap_nonce.to_vec();
        combined.extend_from_slice(&wrapped);

        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(&path, B64.encode(&combined))?;

        Ok(master_key)
    }
}

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

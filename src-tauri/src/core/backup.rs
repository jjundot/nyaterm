use std::io::{Cursor, Read, Write};

use aes_gcm::aead::{Aead, OsRng};
use aes_gcm::{AeadCore, Aes256Gcm, Key, KeyInit};
use sha2::{Digest, Sha256};
use tauri::AppHandle;

use crate::config;
use crate::error::{AppError, AppResult};
use crate::utils::crypto::get_master_password;

use super::cloud_crypto::{decrypt_snapshot_bytes, encrypt_snapshot_bytes};
use super::portable_snapshot::{
    apply_portable_snapshot, build_portable_snapshot, decode_portable_snapshot,
    encode_portable_snapshot, PortableSnapshotKind,
};

const BACKUP_KEY_PREFIX: &[u8] = b"dragonfly-backup-v1:";
const BIT_ROTATE_AMOUNT: u32 = 3;

pub async fn export_config(app: &AppHandle, output_path: &str) -> AppResult<()> {
    let _ = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;
    let state = config::load_cloud_sync_state(app).unwrap_or_default();
    let envelope = build_portable_snapshot(app, PortableSnapshotKind::Backup, &state.device_id)?;
    let encoded = encode_portable_snapshot(&envelope)?;
    let encrypted = encrypt_snapshot_bytes(&encoded)?;
    std::fs::write(output_path, encrypted)?;
    Ok(())
}

pub async fn import_config(app: &AppHandle, file_path: &str) -> AppResult<()> {
    let raw = std::fs::read(file_path)?;
    if let Ok(decoded) = decrypt_snapshot_bytes(&raw) {
        let envelope = decode_portable_snapshot(&decoded)?;
        apply_portable_snapshot(app, &envelope).await?;

        let mut state = config::load_cloud_sync_state(app).unwrap_or_default();
        state.last_synced_payload_hash = None;
        state.last_applied_remote_revision = None;
        config::save_cloud_sync_state(app, &state)?;
        return Ok(());
    }

    import_legacy_config(app, file_path)
}

fn derive_backup_key(master_password: &str) -> Key<Aes256Gcm> {
    let mut h = Sha256::new();
    h.update(BACKUP_KEY_PREFIX);
    h.update(master_password.as_bytes());
    let digest = h.finalize();
    *Key::<Aes256Gcm>::from_slice(&digest)
}

fn rotate_right(data: &[u8]) -> Vec<u8> {
    data.iter()
        .map(|b| b.rotate_right(BIT_ROTATE_AMOUNT))
        .collect()
}

fn import_legacy_config(app: &AppHandle, file_path: &str) -> AppResult<()> {
    let master_password = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;

    let raw = std::fs::read(file_path)?;
    if raw.len() < 13 {
        return Err(AppError::Crypto("backup file is too short".into()));
    }

    let (nonce_bytes, ciphertext) = raw.split_at(12);
    let nonce = aes_gcm::Nonce::from_slice(nonce_bytes);

    let key = derive_backup_key(&master_password);
    let cipher = Aes256Gcm::new(&key);
    let rotated = cipher
        .decrypt(nonce, ciphertext)
        .map_err(|e| AppError::Crypto(format!("backup decryption failed: {e}")))?;

    let zip_bytes = rotate_right(&rotated);
    let _ = config::get_config_dir(app)?;

    let cursor = Cursor::new(zip_bytes);
    let mut archive = zip::ZipArchive::new(cursor)
        .map_err(|e| AppError::Config(format!("invalid backup archive: {e}")))?;

    for index in 0..archive.len() {
        let mut file = archive
            .by_index(index)
            .map_err(|e| AppError::Config(format!("read archive entry: {e}")))?;

        if file.is_dir() {
            continue;
        }

        let Some(name) = file.enclosed_name().map(|path| path.to_owned()) else {
            continue;
        };

        let Some(file_name) = name.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        let mut buf = Vec::new();
        file.read_to_end(&mut buf)?;
        if let Some(key) = crate::storage::json_key_for_legacy_file(file_name) {
            let content = String::from_utf8(buf)
                .map_err(|e| AppError::Config(format!("invalid UTF-8 in {file_name}: {e}")))?;
            crate::storage::save_json_doc_raw(key, &content)?;
        } else if let Some(key) = crate::storage::text_key_for_legacy_file(file_name) {
            let content = String::from_utf8(buf)
                .map_err(|e| AppError::Config(format!("invalid UTF-8 in {file_name}: {e}")))?;
            crate::storage::save_text_doc(key, &content)?;
        }
    }

    if let Ok(settings) = crate::config::load_app_settings(app) {
        if let Some(ref ct) = settings.security.master_password {
            if let Ok(plain) = crate::utils::crypto::decrypt_settings_secret(ct) {
                crate::utils::crypto::set_master_password(Some(plain));
            }
        }
    }

    Ok(())
}

#[allow(dead_code)]
fn export_legacy_config(app: &AppHandle, output_path: &str) -> AppResult<()> {
    let master_password = get_master_password()
        .ok_or_else(|| AppError::Config("master password is not set".into()))?;

    let config_dir = config::get_config_dir(app)?;
    let mut zip_buf = Cursor::new(Vec::new());
    {
        let mut zip_writer = zip::ZipWriter::new(&mut zip_buf);
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);

        let entries = std::fs::read_dir(&config_dir)
            .map_err(|e| AppError::Config(format!("read config dir: {e}")))?;

        for entry in entries {
            let entry = entry?;
            let path = entry.path();
            if !path.is_file() {
                continue;
            }
            let file_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| AppError::Config("invalid file name".into()))?;

            let contents = std::fs::read(&path)?;
            zip_writer
                .start_file(file_name, options)
                .map_err(|e| AppError::Config(format!("zip write: {e}")))?;
            zip_writer.write_all(&contents)?;
        }
        zip_writer
            .finish()
            .map_err(|e| AppError::Config(format!("zip finalize: {e}")))?;
    }

    let zip_bytes = zip_buf.into_inner();
    let rotated: Vec<u8> = zip_bytes
        .iter()
        .map(|byte| byte.rotate_left(BIT_ROTATE_AMOUNT))
        .collect();

    let key = derive_backup_key(&master_password);
    let cipher = Aes256Gcm::new(&key);
    let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
    let ciphertext = cipher
        .encrypt(&nonce, rotated.as_ref())
        .map_err(|e| AppError::Crypto(format!("backup encryption failed: {e}")))?;

    let mut output = nonce.to_vec();
    output.extend_from_slice(&ciphertext);
    std::fs::write(output_path, &output)?;
    Ok(())
}

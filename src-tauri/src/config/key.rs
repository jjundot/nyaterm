use super::uuid_v4;
use crate::error::{AppError, AppResult};
use crate::storage;
use crate::utils::crypto;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

/// Managed SSH private key. PEM content and passphrase are AES-256-GCM encrypted on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SshKey {
    #[serde(default = "uuid_v4")]
    pub id: String,
    pub name: String,
    /// Encrypted PEM content on disk.
    #[serde(default)]
    pub key: Option<String>,
    /// Encrypted passphrase on disk.
    #[serde(default)]
    pub passphrase: Option<String>,

    /// Transient: file path from the UI file picker.
    #[serde(default, skip_serializing)]
    pub key_file_path: Option<String>,
    /// Transient: true when encrypted key data exists on disk.
    #[serde(default, skip_serializing)]
    pub has_key_data: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct KeysConfig {
    #[serde(default)]
    pub keys: Vec<SshKey>,
}

pub fn load_keys(app: &AppHandle) -> AppResult<KeysConfig> {
    let _ = app;
    let mut config = KeysConfig {
        keys: storage::list_ssh_keys()?,
    };
    for k in &mut config.keys {
        k.has_key_data = k.key.is_some();
    }
    Ok(config)
}

pub fn save_keys(app: &AppHandle, config: &KeysConfig) -> AppResult<()> {
    let _ = app;
    storage::replace_ssh_keys(config)
}

pub fn load_key_by_id(app: &AppHandle, id: &str) -> AppResult<SshKey> {
    let cfg = load_keys(app)?;
    let mut key = cfg
        .keys
        .into_iter()
        .find(|k| k.id == id)
        .ok_or_else(|| AppError::Config(format!("SSH key '{}' not found", id)))?;
    if let Some(ct) = key.passphrase.clone() {
        key.passphrase = crypto::decrypt(&ct).ok();
    }
    Ok(key)
}

pub fn decrypt_key_pem(key: &SshKey) -> AppResult<Option<String>> {
    crypto::decrypt_optional(&key.key)
}

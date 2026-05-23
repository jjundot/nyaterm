use super::uuid_v4;
use crate::error::{AppError, AppResult};
use crate::storage;
use crate::utils::crypto;
use serde::{Deserialize, Serialize};
use tauri::AppHandle;

fn default_enabled() -> bool {
    true
}

/// Terminal credential entry. The password field is AES-256-GCM encrypted on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedCredential {
    #[serde(default = "uuid_v4")]
    pub id: String,
    pub name: String,
    pub username: String,
    /// Encrypted password on disk; plaintext only after explicit decryption.
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub username_prompt_regex: Option<String>,
    #[serde(default)]
    pub password_prompt_regex: Option<String>,
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// Transient: true when encrypted password data exists on disk.
    #[serde(default, skip_serializing)]
    pub has_password: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CredentialsConfig {
    #[serde(default)]
    pub credentials: Vec<SavedCredential>,
}

pub fn load_credentials(app: &AppHandle) -> AppResult<CredentialsConfig> {
    let _ = app;
    let mut config = CredentialsConfig {
        credentials: storage::list_credentials()?,
    };
    for credential in &mut config.credentials {
        credential.has_password = credential.password.is_some();
    }
    Ok(config)
}

pub fn save_credentials(app: &AppHandle, config: &CredentialsConfig) -> AppResult<()> {
    let _ = app;
    storage::replace_credentials(config)
}

pub fn load_credential_by_id(app: &AppHandle, id: &str) -> AppResult<SavedCredential> {
    let cfg = load_credentials(app)?;
    let mut entry = cfg
        .credentials
        .into_iter()
        .find(|credential| credential.id == id)
        .ok_or_else(|| AppError::Config(format!("Credential '{}' not found", id)))?;
    if let Some(ct) = entry.password.clone() {
        entry.password = crypto::decrypt(&ct).ok();
    }
    Ok(entry)
}

pub fn upsert_credential(
    config: &mut CredentialsConfig,
    mut entry: SavedCredential,
) -> AppResult<String> {
    if entry.id.is_empty() {
        entry.id = uuid_v4();
    }

    let target_id = entry.id.clone();
    let existing = config
        .credentials
        .iter()
        .find(|credential| credential.id == target_id);

    entry.password = match entry.password.as_deref() {
        Some(plain) if !plain.is_empty() => Some(crypto::encrypt(plain)?),
        _ => existing.and_then(|credential| credential.password.clone()),
    };

    if let Some(existing_entry) = config
        .credentials
        .iter_mut()
        .find(|credential| credential.id == target_id)
    {
        *existing_entry = entry;
    } else {
        config.credentials.push(entry);
    }

    Ok(target_id)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_config_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("nyaterm-credential-{name}-{nanos}"))
    }

    #[test]
    fn upsert_preserves_password_and_list_hides_plaintext_after_decrypt() {
        let dir = unique_config_dir("upsert");
        fs::create_dir_all(&dir).expect("create temp dir");
        crate::storage::init(&dir).expect("init storage");
        crate::utils::crypto::set_master_password(None);

        let mut config = CredentialsConfig::default();
        let id = upsert_credential(
            &mut config,
            SavedCredential {
                id: String::new(),
                name: "Git".to_string(),
                username: "nyakang".to_string(),
                password: Some("secret".to_string()),
                username_prompt_regex: None,
                password_prompt_regex: None,
                enabled: true,
                has_password: false,
            },
        )
        .expect("save credential");

        assert_eq!(config.credentials.len(), 1);
        assert!(config.credentials[0].password.as_deref() != Some("secret"));
        let encrypted = config.credentials[0].password.clone();

        let updated_id = upsert_credential(
            &mut config,
            SavedCredential {
                id: id.clone(),
                name: "GitLab".to_string(),
                username: "nyakang".to_string(),
                password: None,
                username_prompt_regex: Some("Username:".to_string()),
                password_prompt_regex: Some("Password:".to_string()),
                enabled: true,
                has_password: false,
            },
        )
        .expect("update credential");

        assert_eq!(updated_id, id);
        assert_eq!(config.credentials[0].name, "GitLab");
        assert_eq!(config.credentials[0].password, encrypted);
        let decrypted = config.credentials[0]
            .password
            .as_deref()
            .and_then(|ciphertext| crypto::decrypt(ciphertext).ok());
        assert_eq!(decrypted.as_deref(), Some("secret"));

        config.credentials.retain(|credential| credential.id != id);
        assert!(config.credentials.is_empty());

        let _ = fs::remove_dir_all(dir);
    }
}

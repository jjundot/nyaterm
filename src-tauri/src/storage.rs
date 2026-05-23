//! redb-backed repository for `NyaTerm`'s user data.

#![allow(dead_code)]
use crate::error::{AppError, AppResult};
use base64::engine::general_purpose::STANDARD as B64;
use base64::Engine;
use hmac::{Hmac, Mac};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
const DATABASE_FILE: &str = "nyaterm.redb";
const SCHEMA_VERSION: u32 = 3;
const META_SCHEMA_VERSION: &str = "schema_version";
const META_MASTER_KEY: &str = "security/master_key";
const META_MIGRATION_BACKUP_PATH: &str = "migration/v1_backup_path";
const META_MIGRATION_BACKUP_CREATED_AT_MS: &str = "migration/v1_backup_created_at_ms";
const META_MIGRATION_SUCCESSFUL_V3_STARTUPS: &str = "migration/v1_successful_v3_startups";
const SETTINGS_DEFAULT: &str = "settings/default";
const SETTINGS_DOC_PREFIX: &str = "settings/doc/";
const GROUP_PREFIX: &str = "groups/";
const CONNECTION_PREFIX: &str = "connections/";
const CREDENTIAL_PREFIX: &str = "credentials/credential/";
const PASSWORD_PREFIX: &str = "credentials/password/";
const SSH_KEY_PREFIX: &str = "credentials/key/";
const CONNECTION_PASSWORD_PREFIX: &str = "credentials/connection-password/";
const OTP_PREFIX: &str = "otp_accounts/";
const PROXY_PREFIX: &str = "proxies/";
const TUNNEL_PREFIX: &str = "tunnels/";
const KNOWN_HOST_PREFIX: &str = "known_hosts/";
const KNOWN_HOST_RAW_PREFIX: &str = "known_hosts/raw/";
const COMMAND_HISTORY_PREFIX: &str = "command_history/";
const JSON_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("json_docs");
const TEXT_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("text_docs");
pub const META_TABLE: TableDefinition<&str, &str> = TableDefinition::new("meta");
pub const SETTINGS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("settings");
pub const GROUPS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("groups");
pub const CONNECTIONS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("connections");
pub const CREDENTIALS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("credentials");
pub const OTP_ACCOUNTS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("otp_accounts");
pub const PROXIES_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("proxies");
pub const TUNNELS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("tunnels");
pub const KNOWN_HOSTS_TABLE: TableDefinition<&str, &[u8]> = TableDefinition::new("known_hosts");
pub const COMMAND_HISTORY_TABLE: TableDefinition<&str, &[u8]> =
    TableDefinition::new("command_history");
pub const IDX_CONNECTIONS_BY_GROUP_TABLE: TableDefinition<&str, &str> =
    TableDefinition::new("idx_connections_by_group");
pub const IDX_CONNECTIONS_BY_LAST_USED_TABLE: TableDefinition<&str, &str> =
    TableDefinition::new("idx_connections_by_last_used");
pub const IDX_CONNECTIONS_BY_PROTOCOL_TABLE: TableDefinition<&str, &str> =
    TableDefinition::new("idx_connections_by_protocol");
const LEGACY_JSON_SETTINGS: &str = "settings";
const LEGACY_JSON_SESSIONS: &str = "sessions";
const LEGACY_JSON_KEYS: &str = "keys";
const LEGACY_JSON_PASSWORDS: &str = "passwords";
const LEGACY_JSON_CREDENTIALS: &str = "credentials";
const LEGACY_JSON_OTP: &str = "otp";
const LEGACY_JSON_PROXIES: &str = "proxies";
const LEGACY_JSON_TUNNELS: &str = "tunnels";
const LEGACY_JSON_QUICK_COMMAND: &str = "quick-command";
const LEGACY_JSON_CLOUD_SYNC: &str = "cloud-sync";
const LEGACY_JSON_CLOUD_SYNC_STATE: &str = "cloud-sync-state";
const LEGACY_JSON_HISTORY: &str = "history";
const LEGACY_JSON_AI_HISTORY: &str = "ai-history";
const LEGACY_JSON_AI_AUDIT: &str = "ai-audit";
const LEGACY_TEXT_KNOWN_HOSTS: &str = "known_hosts";
const LEGACY_TEXT_MASTER_KEY: &str = "master.key";
static STORAGE: OnceLock<Arc<Storage>> = OnceLock::new();
type HmacSha1 = Hmac<Sha1>;
#[derive(Debug)]
pub struct Storage {
    db: Database,
    db_path: PathBuf,
    pending_migration_backup: Option<BackupInfo>,
}
#[derive(Debug, Clone)]
struct BackupInfo {
    path: PathBuf,
    created_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct ConnectionPasswordRecord {
    id: String,
    connection_id: String,
    password: String,
    created_at_ms: u64,
    updated_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnownHostRecord {
    #[serde(default)]
    marker: Option<String>,
    host_identifier: String,
    #[serde(default)]
    host_patterns: Vec<String>,
    key_type: String,
    key_base64: String,
    #[serde(default)]
    comment: Option<String>,
    #[serde(default)]
    raw_line: Option<String>,
    created_at_ms: u64,
    updated_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct KnownHostRawRecord {
    line: String,
    created_at_ms: u64,
    updated_at_ms: u64,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
struct HistoryStoreFileV2 {
    version: u32,
    entries: Vec<crate::core::history::HistoryEntry>,
}
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
struct ProxiesConfig {
    #[serde(default)]
    proxies: Vec<crate::config::ProxyConfig>,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsDocKey {
    AppSettings,
    QuickCommands,
    CloudSyncSettings,
    CloudSyncState,
    AiHistory,
    AiAudit,
    SftpFileBackendCache,
}
impl SettingsDocKey {
    fn storage_key(self) -> &'static str {
        match self {
            Self::AppSettings => SETTINGS_DEFAULT,
            Self::QuickCommands => "settings/doc/quick-command",
            Self::CloudSyncSettings => "settings/doc/cloud-sync",
            Self::CloudSyncState => "settings/doc/cloud-sync-state",
            Self::AiHistory => "settings/doc/ai-history",
            Self::AiAudit => "settings/doc/ai-audit",
            Self::SftpFileBackendCache => "settings/doc/file-backend-cache",
        }
    }

    fn legacy_key(self) -> Option<&'static str> {
        match self {
            Self::AppSettings => Some(LEGACY_JSON_SETTINGS),
            Self::QuickCommands => Some(LEGACY_JSON_QUICK_COMMAND),
            Self::CloudSyncSettings => Some(LEGACY_JSON_CLOUD_SYNC),
            Self::CloudSyncState => Some(LEGACY_JSON_CLOUD_SYNC_STATE),
            Self::AiHistory => Some(LEGACY_JSON_AI_HISTORY),
            Self::AiAudit => Some(LEGACY_JSON_AI_AUDIT),
            Self::SftpFileBackendCache => Some("file-backend-cache"),
        }
    }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KnownHostCheck {
    Match,
    HostSeen,
    UnknownHost,
}
pub fn init(config_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let storage = Arc::new(Storage::open(config_dir)?);
    if STORAGE.set(storage).is_err() {
        tracing::debug!("redb storage was already initialized");
    }
    Ok(())
}
#[cfg(test)]
fn database_path(config_dir: &Path) -> PathBuf {
    config_dir.join(DATABASE_FILE)
}

pub(crate) fn load_settings_doc<T: DeserializeOwned + Default>(
    key: SettingsDocKey,
) -> AppResult<T> {
    Ok(storage()?.get_settings_doc(key)?.unwrap_or_default())
}

pub(crate) fn save_settings_doc<T: Serialize>(key: SettingsDocKey, value: &T) -> AppResult<()> {
    storage()?.save_settings_doc(key, value)
}

pub(crate) fn update_settings_doc<T, R, F>(key: SettingsDocKey, updater: F) -> AppResult<R>
where
    T: DeserializeOwned + Default + Serialize,
    F: FnOnce(&mut T) -> AppResult<R>,
{
    storage()?.update_settings_doc(key, updater)
}

pub(crate) fn load_sessions() -> AppResult<crate::config::SessionsConfig> {
    storage()?.load_sessions()
}

pub(crate) fn replace_sessions(config: &crate::config::SessionsConfig) -> AppResult<()> {
    storage()?.replace_sessions(config)
}

pub(crate) fn get_connection(
    connection_id: &str,
) -> AppResult<Option<crate::config::SavedConnection>> {
    storage()?.get_connection_with_secret(connection_id)
}

pub(crate) fn mark_connection_used(connection_id: &str) -> AppResult<()> {
    storage()?.mark_connection_used(connection_id)
}

pub(crate) fn list_passwords() -> AppResult<Vec<crate::config::SavedPassword>> {
    storage()?.list_passwords()
}

pub(crate) fn replace_passwords(config: &crate::config::PasswordsConfig) -> AppResult<()> {
    storage()?.replace_passwords(config)
}

pub(crate) fn list_ssh_keys() -> AppResult<Vec<crate::config::SshKey>> {
    storage()?.list_ssh_keys()
}

pub(crate) fn replace_ssh_keys(config: &crate::config::KeysConfig) -> AppResult<()> {
    storage()?.replace_ssh_keys(config)
}

pub(crate) fn list_credentials() -> AppResult<Vec<crate::config::SavedCredential>> {
    storage()?.list_credentials()
}

pub(crate) fn replace_credentials(config: &crate::config::CredentialsConfig) -> AppResult<()> {
    storage()?.replace_credentials(config)
}

pub(crate) fn list_otp_accounts() -> AppResult<Vec<crate::config::OtpEntry>> {
    storage()?.list_otp_accounts()
}

pub(crate) fn replace_otp_accounts(config: &crate::config::OtpConfig) -> AppResult<()> {
    storage()?.replace_otp_accounts(config)
}

pub(crate) fn list_proxies() -> AppResult<Vec<crate::config::ProxyConfig>> {
    storage()?.list_proxies()
}

pub(crate) fn replace_proxies(proxies: &[crate::config::ProxyConfig]) -> AppResult<()> {
    storage()?.replace_proxies(proxies)
}

pub(crate) fn list_tunnels() -> AppResult<Vec<crate::config::TunnelConfig>> {
    storage()?.list_tunnels()
}

pub(crate) fn replace_tunnels(tunnels: &[crate::config::TunnelConfig]) -> AppResult<()> {
    storage()?.replace_tunnels(tunnels)
}

pub(crate) fn list_command_history_entries(
    limit: usize,
) -> AppResult<Vec<crate::core::history::HistoryEntry>> {
    storage()?.list_recent_command_history(limit)
}

pub(crate) fn replace_command_history_entries(
    entries: &[crate::core::history::HistoryEntry],
) -> AppResult<()> {
    storage()?.replace_command_history(entries)
}

pub(crate) fn check_known_host(
    host_identifier: &str,
    key_type: &str,
    key_base64: &str,
) -> AppResult<KnownHostCheck> {
    storage()?.check_known_host(host_identifier, key_type, key_base64)
}

pub(crate) fn upsert_known_host(line: &str) -> AppResult<()> {
    storage()?.upsert_known_host(line)
}

pub(crate) fn replace_known_host_for_host(host_identifier: &str, line: &str) -> AppResult<()> {
    storage()?.replace_known_host_for_host(host_identifier, line)
}

pub(crate) fn render_known_hosts_export() -> AppResult<String> {
    storage()?.render_known_hosts_export()
}

pub(crate) fn replace_known_hosts_export(content: &str) -> AppResult<()> {
    storage()?.replace_known_hosts_export(content)
}

pub(crate) fn load_master_key_token() -> AppResult<Option<String>> {
    storage()?.load_master_key_token()
}

pub(crate) fn save_master_key_token(token: &str) -> AppResult<()> {
    storage()?.save_master_key_token(token)
}
fn storage() -> AppResult<Arc<Storage>> {
    if let Some(storage) = STORAGE.get() {
        return Ok(storage.clone());
    }
    let config_dir = default_config_dir()?;
    init(&config_dir)?;
    STORAGE
        .get()
        .cloned()
        .ok_or_else(|| AppError::Storage("redb storage did not initialize".to_string()))
}
fn default_config_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Config("cannot determine home directory".to_string()))?;
    Ok(home.join(".nyaterm"))
}
impl Storage {
    pub fn open(config_dir: &Path) -> AppResult<Self> {
        fs::create_dir_all(config_dir)?;
        Self::open_path(&config_dir.join(DATABASE_FILE))
    }
    fn open_path(db_path: &Path) -> AppResult<Self> {
        let pending_migration_backup = if db_path.exists() {
            backup_database_before_migration_if_needed(db_path)?
        } else {
            None
        };

        let db = if db_path.exists() {
            Database::open(db_path).map_err(storage_error)?
        } else {
            Database::create(db_path).map_err(storage_error)?
        };
        let storage = Self {
            db,
            db_path: db_path.to_path_buf(),
            pending_migration_backup,
        };
        storage.migrate_if_needed()?;
        storage.record_successful_v3_startup_and_cleanup_backups()?;
        Ok(storage)
    }
    pub fn get_schema_version(&self) -> AppResult<u32> {
        Ok(self.get_schema_version_optional()?.unwrap_or(1))
    }
    pub fn set_schema_version(&self, version: u32) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        write_meta_u32(&txn, META_SCHEMA_VERSION, version)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn migrate_if_needed(&self) -> AppResult<()> {
        match self.get_schema_version_optional()? {
            Some(version) if version >= SCHEMA_VERSION => return Ok(()),
            Some(version) => {
                tracing::info!(schema_version = version, "Migrating redb storage schema");
            }
            None => {}
        }
        if self.has_legacy_data()? || self.get_schema_version_optional()?.is_some() {
            self.migrate_to_v3()?;
        } else {
            self.initialize_v3_schema()?;
        }
        Ok(())
    }
    pub fn get_settings<T>(&self, key: &str) -> AppResult<Option<T>>
    where
        T: DeserializeOwned,
    {
        self.read_json(SETTINGS_TABLE, key)
    }
    pub fn save_settings<T>(&self, key: &str, value: &T) -> AppResult<()>
    where
        T: Serialize,
    {
        self.write_json(SETTINGS_TABLE, key, value)
    }
    pub fn get_settings_doc<T>(&self, key: SettingsDocKey) -> AppResult<Option<T>>
    where
        T: DeserializeOwned,
    {
        self.get_settings(key.storage_key())
    }
    pub fn save_settings_doc<T>(&self, key: SettingsDocKey, value: &T) -> AppResult<()>
    where
        T: Serialize,
    {
        self.save_settings(key.storage_key(), value)
    }
    pub fn update_settings_doc<T, R, F>(&self, key: SettingsDocKey, updater: F) -> AppResult<R>
    where
        T: DeserializeOwned + Default + Serialize,
        F: FnOnce(&mut T) -> AppResult<R>,
    {
        let txn = self.db.begin_write().map_err(storage_error)?;
        let result = {
            let settings_key = key.storage_key();
            let mut table = txn.open_table(SETTINGS_TABLE).map_err(storage_error)?;
            let mut document = match table.get(settings_key).map_err(storage_error)? {
                Some(raw) => deserialize_json::<T>(raw.value())?,
                None => T::default(),
            };
            let result = updater(&mut document)?;
            let content = serialize_json(&document)?;
            table
                .insert(settings_key, content.as_slice())
                .map_err(storage_error)?;
            result
        };
        txn.commit().map_err(storage_error)?;
        Ok(result)
    }
    pub fn load_sessions(&self) -> AppResult<crate::config::SessionsConfig> {
        let groups = self.list_groups()?;
        let mut connections = self.list_connections()?;
        self.hydrate_connection_passwords(&mut connections)?;
        Ok(crate::config::SessionsConfig {
            groups,
            connections,
        })
    }
    pub fn replace_sessions(&self, config: &crate::config::SessionsConfig) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_sessions_in_txn(&txn, config)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn list_groups(&self) -> AppResult<Vec<crate::config::Group>> {
        let mut groups = self.list_json_by_prefix(GROUPS_TABLE, GROUP_PREFIX)?;
        groups.sort_by(|left: &crate::config::Group, right| {
            left.sort_order
                .cmp(&right.sort_order)
                .then(left.name.cmp(&right.name))
                .then(left.id.cmp(&right.id))
        });
        Ok(groups)
    }
    pub fn get_group(&self, group_id: &str) -> AppResult<Option<crate::config::Group>> {
        self.read_json(GROUPS_TABLE, &entity_key(GROUP_PREFIX, group_id))
    }
    pub fn save_group(&self, group: &crate::config::Group) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        save_group_in_txn(&txn, group)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn delete_group(&self, group_id: &str) -> AppResult<()> {
        self.remove_key(GROUPS_TABLE, &entity_key(GROUP_PREFIX, group_id))
    }
    pub fn list_connections(&self) -> AppResult<Vec<crate::config::SavedConnection>> {
        let mut connections = self.list_json_by_prefix(CONNECTIONS_TABLE, CONNECTION_PREFIX)?;
        sort_connections(&mut connections);
        Ok(connections)
    }
    pub fn get_connection(
        &self,
        connection_id: &str,
    ) -> AppResult<Option<crate::config::SavedConnection>> {
        self.read_json(
            CONNECTIONS_TABLE,
            &entity_key(CONNECTION_PREFIX, connection_id),
        )
    }
    pub fn get_connection_with_secret(
        &self,
        connection_id: &str,
    ) -> AppResult<Option<crate::config::SavedConnection>> {
        let Some(mut connection) = self.get_connection(connection_id)? else {
            return Ok(None);
        };
        self.hydrate_connection_passwords(std::slice::from_mut(&mut connection))?;
        Ok(Some(connection))
    }
    pub fn save_connection(&self, connection: &crate::config::SavedConnection) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        save_connection_in_txn(&txn, connection)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn delete_connection(&self, connection_id: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        delete_connection_in_txn(&txn, connection_id)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn mark_connection_used(&self, connection_id: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        let key = entity_key(CONNECTION_PREFIX, connection_id);
        let connection = {
            let table = txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
            let connection = table
                .get(key.as_str())
                .map_err(storage_error)?
                .map(|raw| deserialize_json::<crate::config::SavedConnection>(raw.value()))
                .transpose()?;
            connection
        };
        let Some(mut connection) = connection else {
            txn.commit().map_err(storage_error)?;
            return Ok(());
        };
        connection.last_used_at_ms = Some(current_time_ms());
        save_connection_in_txn(&txn, &connection)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn list_connections_by_group(
        &self,
        group_id: Option<&str>,
    ) -> AppResult<Vec<crate::config::SavedConnection>> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let index_table = match txn.open_table(IDX_CONNECTIONS_BY_GROUP_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(error) => return Err(storage_error(error)),
        };
        let connections_table = match txn.open_table(CONNECTIONS_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(error) => return Err(storage_error(error)),
        };
        let prefix = format!("{}|", group_id.unwrap_or_default());
        let mut connections = Vec::new();
        for entry in index_table.iter().map_err(storage_error)? {
            let (key, value) = entry.map_err(storage_error)?;
            if !key.value().starts_with(&prefix) {
                continue;
            }
            let connection_key = entity_key(CONNECTION_PREFIX, value.value());
            if let Some(raw) = connections_table
                .get(connection_key.as_str())
                .map_err(storage_error)?
            {
                connections.push(deserialize_json(raw.value())?);
            }
        }
        Ok(connections)
    }
    pub fn save_credential(&self, credential: &crate::config::SavedCredential) -> AppResult<()> {
        self.write_json(
            CREDENTIALS_TABLE,
            &entity_key(CREDENTIAL_PREFIX, &credential.id),
            credential,
        )
    }
    pub fn get_credential(
        &self,
        credential_id: &str,
    ) -> AppResult<Option<crate::config::SavedCredential>> {
        self.read_json(
            CREDENTIALS_TABLE,
            &entity_key(CREDENTIAL_PREFIX, credential_id),
        )
    }
    pub fn delete_credential(&self, credential_id: &str) -> AppResult<()> {
        self.remove_key(
            CREDENTIALS_TABLE,
            &entity_key(CREDENTIAL_PREFIX, credential_id),
        )
    }
    pub fn list_credentials(&self) -> AppResult<Vec<crate::config::SavedCredential>> {
        self.list_json_by_prefix(CREDENTIALS_TABLE, CREDENTIAL_PREFIX)
    }
    pub fn replace_credentials(&self, config: &crate::config::CredentialsConfig) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_credentials_in_txn(&txn, config)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn list_passwords(&self) -> AppResult<Vec<crate::config::SavedPassword>> {
        self.list_json_by_prefix(CREDENTIALS_TABLE, PASSWORD_PREFIX)
    }
    pub fn replace_passwords(&self, config: &crate::config::PasswordsConfig) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_passwords_in_txn(&txn, config)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn list_ssh_keys(&self) -> AppResult<Vec<crate::config::SshKey>> {
        self.list_json_by_prefix(CREDENTIALS_TABLE, SSH_KEY_PREFIX)
    }
    pub fn replace_ssh_keys(&self, config: &crate::config::KeysConfig) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_ssh_keys_in_txn(&txn, config)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn save_otp_account(&self, account: &crate::config::OtpEntry) -> AppResult<()> {
        self.write_json(
            OTP_ACCOUNTS_TABLE,
            &entity_key(OTP_PREFIX, &account.id),
            account,
        )
    }
    pub fn get_otp_account(&self, otp_id: &str) -> AppResult<Option<crate::config::OtpEntry>> {
        self.read_json(OTP_ACCOUNTS_TABLE, &entity_key(OTP_PREFIX, otp_id))
    }
    pub fn delete_otp_account(&self, otp_id: &str) -> AppResult<()> {
        self.remove_key(OTP_ACCOUNTS_TABLE, &entity_key(OTP_PREFIX, otp_id))
    }
    pub fn list_otp_accounts(&self) -> AppResult<Vec<crate::config::OtpEntry>> {
        self.list_json_by_prefix(OTP_ACCOUNTS_TABLE, OTP_PREFIX)
    }
    pub fn replace_otp_accounts(&self, config: &crate::config::OtpConfig) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_otp_in_txn(&txn, config)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn save_proxy(&self, proxy: &crate::config::ProxyConfig) -> AppResult<()> {
        self.write_json(PROXIES_TABLE, &entity_key(PROXY_PREFIX, &proxy.id), proxy)
    }
    pub fn get_proxy(&self, proxy_id: &str) -> AppResult<Option<crate::config::ProxyConfig>> {
        self.read_json(PROXIES_TABLE, &entity_key(PROXY_PREFIX, proxy_id))
    }
    pub fn list_proxies(&self) -> AppResult<Vec<crate::config::ProxyConfig>> {
        self.list_json_by_prefix(PROXIES_TABLE, PROXY_PREFIX)
    }
    pub fn delete_proxy(&self, proxy_id: &str) -> AppResult<()> {
        self.remove_key(PROXIES_TABLE, &entity_key(PROXY_PREFIX, proxy_id))
    }
    pub fn replace_proxies(&self, proxies: &[crate::config::ProxyConfig]) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_proxies_in_txn(&txn, proxies)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn save_tunnel(&self, tunnel: &crate::config::TunnelConfig) -> AppResult<()> {
        self.write_json(
            TUNNELS_TABLE,
            &entity_key(TUNNEL_PREFIX, &tunnel.id),
            tunnel,
        )
    }
    pub fn get_tunnel(&self, tunnel_id: &str) -> AppResult<Option<crate::config::TunnelConfig>> {
        self.read_json(TUNNELS_TABLE, &entity_key(TUNNEL_PREFIX, tunnel_id))
    }
    pub fn list_tunnels(&self) -> AppResult<Vec<crate::config::TunnelConfig>> {
        self.list_json_by_prefix(TUNNELS_TABLE, TUNNEL_PREFIX)
    }
    pub fn delete_tunnel(&self, tunnel_id: &str) -> AppResult<()> {
        self.remove_key(TUNNELS_TABLE, &entity_key(TUNNEL_PREFIX, tunnel_id))
    }
    pub fn replace_tunnels(&self, tunnels: &[crate::config::TunnelConfig]) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_tunnels_in_txn(&txn, tunnels)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn append_command_history(
        &self,
        item: &crate::core::history::HistoryEntry,
    ) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        save_history_entry_in_txn(&txn, item)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn list_recent_command_history(
        &self,
        limit: usize,
    ) -> AppResult<Vec<crate::core::history::HistoryEntry>> {
        let mut entries: Vec<(String, crate::core::history::HistoryEntry)> =
            self.list_keyed_json_by_prefix(COMMAND_HISTORY_TABLE, COMMAND_HISTORY_PREFIX)?;
        entries.sort_by(|left, right| right.0.cmp(&left.0));
        Ok(entries
            .into_iter()
            .take(limit)
            .map(|(_, entry)| entry)
            .collect())
    }
    pub fn delete_command_history_before(&self, timestamp_ms: i64) -> AppResult<()> {
        let cutoff = u64::try_from(timestamp_ms).unwrap_or_default();
        let txn = self.db.begin_write().map_err(storage_error)?;
        let table = match txn.open_table(COMMAND_HISTORY_TABLE) {
            Ok(table) => table,
            Err(error) => return Err(storage_error(error)),
        };
        let mut keys_to_remove = Vec::new();
        for entry in table.iter().map_err(storage_error)? {
            let (key, value) = entry.map_err(storage_error)?;
            let item: crate::core::history::HistoryEntry = deserialize_json(value.value())?;
            if item.last_used_at_ms < cutoff {
                keys_to_remove.push(key.value().to_string());
            }
        }
        drop(table);
        {
            let mut table = txn
                .open_table(COMMAND_HISTORY_TABLE)
                .map_err(storage_error)?;
            for key in keys_to_remove {
                table.remove(key.as_str()).map_err(storage_error)?;
            }
        }
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn replace_command_history(
        &self,
        entries: &[crate::core::history::HistoryEntry],
    ) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_command_history_in_txn(&txn, entries)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn check_known_host(
        &self,
        host_identifier: &str,
        key_type: &str,
        key_base64: &str,
    ) -> AppResult<KnownHostCheck> {
        let mut host_seen = false;
        let records: Vec<(String, Vec<u8>)> =
            self.list_raw_by_prefix(KNOWN_HOSTS_TABLE, KNOWN_HOST_PREFIX)?;
        for (key, value) in records {
            if key.starts_with(KNOWN_HOST_RAW_PREFIX) {
                continue;
            }
            let host: KnownHostRecord = deserialize_json(&value)?;
            if known_host_record_matches(&host, host_identifier) {
                host_seen = true;
                if host.key_type == key_type && host.key_base64 == key_base64 {
                    return Ok(KnownHostCheck::Match);
                }
            }
        }
        if host_seen {
            Ok(KnownHostCheck::HostSeen)
        } else {
            Ok(KnownHostCheck::UnknownHost)
        }
    }
    pub fn upsert_known_host(&self, line: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        save_known_hosts_line_in_txn(&txn, line)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn replace_known_host_for_host(&self, host_identifier: &str, line: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        remove_known_hosts_for_host_in_txn(&txn, host_identifier)?;
        save_known_hosts_line_in_txn(&txn, line)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn render_known_hosts_export(&self) -> AppResult<String> {
        self.render_known_hosts_text()
    }
    pub fn replace_known_hosts_export(&self, content: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        replace_known_hosts_text_in_txn(&txn, content)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    pub fn load_master_key_token(&self) -> AppResult<Option<String>> {
        self.read_meta_string(META_MASTER_KEY)
    }
    pub fn save_master_key_token(&self, token: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        write_meta_string(&txn, META_MASTER_KEY, token)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    fn get_schema_version_optional(&self) -> AppResult<Option<u32>> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(META_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        let Some(raw) = table.get(META_SCHEMA_VERSION).map_err(storage_error)? else {
            return Ok(None);
        };
        parse_meta_u32(raw.value(), META_SCHEMA_VERSION).map(Some)
    }
    fn initialize_v3_schema(&self) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        open_all_v3_tables(&txn)?;
        write_meta_u32(&txn, META_SCHEMA_VERSION, SCHEMA_VERSION)?;
        txn.commit().map_err(storage_error)?;
        tracing::info!("Initialized redb storage schema v3");
        Ok(())
    }
    fn has_legacy_data(&self) -> AppResult<bool> {
        has_legacy_data(&self.db)
    }
    fn migrate_to_v3(&self) -> AppResult<()> {
        let from_version = self.get_schema_version_optional()?.unwrap_or(1);
        let json_docs = read_legacy_docs(&self.db, JSON_DOCS_TABLE)?;
        let text_docs = read_legacy_docs(&self.db, TEXT_DOCS_TABLE)?;
        let txn = self.db.begin_write().map_err(storage_error)?;
        open_all_v3_tables(&txn)?;
        if from_version < 2 {
            Self::import_legacy_docs_in_txn(&txn, &json_docs, &text_docs)?;
        } else {
            rebuild_all_connection_indexes_in_txn(&txn)?;
        }
        if let Some(backup) = &self.pending_migration_backup {
            write_meta_string(
                &txn,
                META_MIGRATION_BACKUP_PATH,
                &backup.path.to_string_lossy(),
            )?;
            write_meta_string(
                &txn,
                META_MIGRATION_BACKUP_CREATED_AT_MS,
                &backup.created_at_ms.to_string(),
            )?;
            write_meta_u32(&txn, META_MIGRATION_SUCCESSFUL_V3_STARTUPS, 0)?;
        }
        delete_legacy_tables_in_txn(&txn)?;
        write_meta_u32(&txn, META_SCHEMA_VERSION, SCHEMA_VERSION)?;
        txn.commit().map_err(storage_error)?;
        tracing::info!(from_version, "Migrated redb storage schema to v3 entities");
        Ok(())
    }

    fn import_legacy_docs_in_txn(
        txn: &redb::WriteTransaction,
        json_docs: &BTreeMap<String, String>,
        text_docs: &BTreeMap<String, String>,
    ) -> AppResult<()> {
        if let Some(settings) = json_docs.get(LEGACY_JSON_SETTINGS) {
            write_raw_bytes_in_txn(txn, SETTINGS_TABLE, SETTINGS_DEFAULT, settings.as_bytes())?;
        }
        for (key, raw) in json_docs {
            if key == LEGACY_JSON_SETTINGS || is_entity_json_doc(key) {
                continue;
            }
            write_raw_bytes_in_txn(txn, SETTINGS_TABLE, &settings_doc_key(key), raw.as_bytes())?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_SESSIONS) {
            let config = parse_sessions_config(raw)?;
            replace_sessions_in_txn(txn, &config)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_PASSWORDS) {
            let config: crate::config::PasswordsConfig = serde_json::from_str(raw)?;
            replace_passwords_in_txn(txn, &config)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_KEYS) {
            let config: crate::config::KeysConfig = serde_json::from_str(raw)?;
            replace_ssh_keys_in_txn(txn, &config)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_CREDENTIALS) {
            let config: crate::config::CredentialsConfig = serde_json::from_str(raw)?;
            replace_credentials_in_txn(txn, &config)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_OTP) {
            let config: crate::config::OtpConfig = serde_json::from_str(raw)?;
            replace_otp_in_txn(txn, &config)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_PROXIES) {
            let config: ProxiesConfig = serde_json::from_str(raw)?;
            replace_proxies_in_txn(txn, &config.proxies)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_TUNNELS) {
            let config: crate::config::TunnelsConfig = serde_json::from_str(raw)?;
            replace_tunnels_in_txn(txn, &config.tunnels)?;
        }
        if let Some(raw) = json_docs.get(LEGACY_JSON_HISTORY) {
            let entries = parse_history_entries(raw)?;
            replace_command_history_in_txn(txn, &entries)?;
        }
        if let Some(master_key) = text_docs.get(LEGACY_TEXT_MASTER_KEY) {
            write_meta_string(txn, META_MASTER_KEY, master_key)?;
        }
        if let Some(known_hosts) = text_docs.get(LEGACY_TEXT_KNOWN_HOSTS) {
            replace_known_hosts_text_in_txn(txn, known_hosts)?;
        }
        Ok(())
    }
    fn record_successful_v3_startup_and_cleanup_backups(&self) -> AppResult<()> {
        if self.get_schema_version()? < SCHEMA_VERSION {
            return Ok(());
        }
        self.v3_smoke_check()?;

        let txn = self.db.begin_write().map_err(storage_error)?;
        let backup_path = read_meta_string_in_txn(&txn, META_MIGRATION_BACKUP_PATH)?;
        let backup_created_at = read_meta_u64_in_txn(&txn, META_MIGRATION_BACKUP_CREATED_AT_MS)?;
        let startup_count =
            read_meta_u32_in_txn(&txn, META_MIGRATION_SUCCESSFUL_V3_STARTUPS)?.unwrap_or(0);
        let next_count = startup_count.saturating_add(1);
        write_meta_u32(&txn, META_MIGRATION_SUCCESSFUL_V3_STARTUPS, next_count)?;
        txn.commit().map_err(storage_error)?;

        if let (Some(path), Some(created_at)) = (backup_path, backup_created_at) {
            let age_ms = current_time_ms().saturating_sub(created_at);
            if age_ms >= 14 * 24 * 60 * 60 * 1000 && next_count >= 3 {
                match fs::remove_file(&path) {
                    Ok(()) => {
                        tracing::info!(backup_path = %path, "Deleted expired migration backup");
                    }
                    Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                    Err(error) => tracing::warn!(
                        backup_path = %path,
                        %error,
                        "Failed to delete expired migration backup"
                    ),
                }
            }
        }

        cleanup_orphan_backups(&self.db_path)?;
        Ok(())
    }
    fn v3_smoke_check(&self) -> AppResult<()> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        txn.open_table(META_TABLE).map_err(storage_error)?;
        txn.open_table(SETTINGS_TABLE).map_err(storage_error)?;
        txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
        txn.open_table(CREDENTIALS_TABLE).map_err(storage_error)?;
        txn.open_table(KNOWN_HOSTS_TABLE).map_err(storage_error)?;
        Ok(())
    }
    fn read_json<T>(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        key: &str,
    ) -> AppResult<Option<T>>
    where
        T: DeserializeOwned,
    {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(definition) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        let Some(raw) = table.get(key).map_err(storage_error)? else {
            return Ok(None);
        };
        deserialize_json(raw.value()).map(Some)
    }
    fn write_json<T>(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        key: &str,
        value: &T,
    ) -> AppResult<()>
    where
        T: Serialize,
    {
        let txn = self.db.begin_write().map_err(storage_error)?;
        write_json_in_txn(&txn, definition, key, value)?;
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    fn remove_key(&self, definition: TableDefinition<&str, &[u8]>, key: &str) -> AppResult<()> {
        let txn = self.db.begin_write().map_err(storage_error)?;
        {
            let mut table = txn.open_table(definition).map_err(storage_error)?;
            table.remove(key).map_err(storage_error)?;
        }
        txn.commit().map_err(storage_error)?;
        Ok(())
    }
    fn list_json_by_prefix<T>(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        prefix: &str,
    ) -> AppResult<Vec<T>>
    where
        T: DeserializeOwned,
    {
        Ok(self
            .list_keyed_json_by_prefix(definition, prefix)?
            .into_iter()
            .map(|(_, value)| value)
            .collect())
    }
    fn list_keyed_json_by_prefix<T>(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        prefix: &str,
    ) -> AppResult<Vec<(String, T)>>
    where
        T: DeserializeOwned,
    {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(definition) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(error) => return Err(storage_error(error)),
        };
        let mut values = Vec::new();
        for entry in table.iter().map_err(storage_error)? {
            let (key, value) = entry.map_err(storage_error)?;
            if key.value().starts_with(prefix) {
                values.push((key.value().to_string(), deserialize_json(value.value())?));
            }
        }
        Ok(values)
    }
    fn read_raw_string(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        key: &str,
    ) -> AppResult<Option<String>> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(definition) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        let Some(raw) = table.get(key).map_err(storage_error)? else {
            return Ok(None);
        };
        String::from_utf8(raw.value().to_vec())
            .map(Some)
            .map_err(|error| AppError::Storage(format!("Stored value is not UTF-8: {error}")))
    }

    fn read_meta_string(&self, key: &str) -> AppResult<Option<String>> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(META_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
            Err(error) => return Err(storage_error(error)),
        };
        Ok(table
            .get(key)
            .map_err(storage_error)?
            .map(|raw| raw.value().to_string()))
    }
    fn hydrate_connection_passwords(
        &self,
        connections: &mut [crate::config::SavedConnection],
    ) -> AppResult<()> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(CREDENTIALS_TABLE) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(()),
            Err(error) => return Err(storage_error(error)),
        };
        for connection in connections {
            let Some(auth) = connection.auth.as_mut() else {
                continue;
            };
            let key = entity_key(CONNECTION_PASSWORD_PREFIX, &connection.id);
            if let Some(raw) = table.get(key.as_str()).map_err(storage_error)? {
                let record: ConnectionPasswordRecord = deserialize_json(raw.value())?;
                auth.password = Some(record.password);
                auth.has_password = true;
            }
        }
        Ok(())
    }
    fn render_known_hosts_text(&self) -> AppResult<String> {
        let mut records: Vec<(String, Vec<u8>)> =
            self.list_raw_by_prefix(KNOWN_HOSTS_TABLE, KNOWN_HOST_PREFIX)?;
        records.sort_by(|left, right| left.0.cmp(&right.0));
        let mut lines = Vec::new();
        for (key, value) in records {
            if key.starts_with(KNOWN_HOST_RAW_PREFIX) {
                let raw: KnownHostRawRecord = deserialize_json(&value)?;
                lines.push(raw.line);
            } else {
                let host: KnownHostRecord = deserialize_json(&value)?;
                lines.push(
                    host.raw_line
                        .clone()
                        .unwrap_or_else(|| render_known_host_record(&host)),
                );
            }
        }
        if lines.is_empty() {
            Ok(String::new())
        } else {
            Ok(format!("{}\n", lines.join("\n")))
        }
    }
    fn list_raw_by_prefix(
        &self,
        definition: TableDefinition<&str, &[u8]>,
        prefix: &str,
    ) -> AppResult<Vec<(String, Vec<u8>)>> {
        let txn = self.db.begin_read().map_err(storage_error)?;
        let table = match txn.open_table(definition) {
            Ok(table) => table,
            Err(redb::TableError::TableDoesNotExist(_)) => return Ok(Vec::new()),
            Err(error) => return Err(storage_error(error)),
        };
        let mut values = Vec::new();
        for entry in table.iter().map_err(storage_error)? {
            let (key, value) = entry.map_err(storage_error)?;
            if key.value().starts_with(prefix) {
                values.push((key.value().to_string(), value.value().to_vec()));
            }
        }
        Ok(values)
    }
}
fn open_all_v3_tables(txn: &redb::WriteTransaction) -> AppResult<()> {
    txn.open_table(META_TABLE).map_err(storage_error)?;
    txn.open_table(SETTINGS_TABLE).map_err(storage_error)?;
    txn.open_table(GROUPS_TABLE).map_err(storage_error)?;
    txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
    txn.open_table(CREDENTIALS_TABLE).map_err(storage_error)?;
    txn.open_table(OTP_ACCOUNTS_TABLE).map_err(storage_error)?;
    txn.open_table(PROXIES_TABLE).map_err(storage_error)?;
    txn.open_table(TUNNELS_TABLE).map_err(storage_error)?;
    txn.open_table(KNOWN_HOSTS_TABLE).map_err(storage_error)?;
    txn.open_table(COMMAND_HISTORY_TABLE)
        .map_err(storage_error)?;
    txn.open_table(IDX_CONNECTIONS_BY_GROUP_TABLE)
        .map_err(storage_error)?;
    txn.open_table(IDX_CONNECTIONS_BY_LAST_USED_TABLE)
        .map_err(storage_error)?;
    txn.open_table(IDX_CONNECTIONS_BY_PROTOCOL_TABLE)
        .map_err(storage_error)?;
    Ok(())
}
fn delete_legacy_tables_in_txn(txn: &redb::WriteTransaction) -> AppResult<()> {
    match txn.delete_table(JSON_DOCS_TABLE) {
        Ok(_) | Err(redb::TableError::TableDoesNotExist(_)) => {}
        Err(error) => return Err(storage_error(error)),
    }
    match txn.delete_table(TEXT_DOCS_TABLE) {
        Ok(_) | Err(redb::TableError::TableDoesNotExist(_)) => {}
        Err(error) => return Err(storage_error(error)),
    }
    Ok(())
}
fn read_legacy_docs(
    db: &Database,
    definition: TableDefinition<&str, &str>,
) -> AppResult<BTreeMap<String, String>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(definition) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(BTreeMap::new()),
        Err(error) => return Err(storage_error(error)),
    };
    let mut values = BTreeMap::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        values.insert(key.value().to_string(), value.value().to_string());
    }
    Ok(values)
}

fn backup_database_before_migration_if_needed(db_path: &Path) -> AppResult<Option<BackupInfo>> {
    let needs_backup = {
        let db = Database::open(db_path).map_err(storage_error)?;
        match get_schema_version_optional_from_db(&db)? {
            Some(version) if version >= SCHEMA_VERSION => false,
            _ => has_legacy_data(&db)?,
        }
    };

    if !needs_backup {
        return Ok(None);
    }

    let created_at_ms = current_time_ms();
    let backup_name = format!("nyaterm.redb.bak-v1-{created_at_ms}.redb");
    let backup_path = db_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(backup_name);
    fs::copy(db_path, &backup_path).map_err(|error| {
        AppError::Storage(format!(
            "Failed to backup redb before schema migration to '{}': {error}",
            backup_path.display()
        ))
    })?;
    tracing::info!(
        backup_path = %backup_path.display(),
        "Backed up redb before storage schema migration"
    );
    Ok(Some(BackupInfo {
        path: backup_path,
        created_at_ms,
    }))
}

fn cleanup_orphan_backups(db_path: &Path) -> AppResult<()> {
    let Some(parent) = db_path.parent() else {
        return Ok(());
    };
    let now = current_time_ms();
    let mut backups = Vec::new();
    for entry in fs::read_dir(parent)? {
        let entry = entry?;
        let file_name = entry.file_name();
        let Some(file_name) = file_name.to_str() else {
            continue;
        };
        let Some(timestamp) = backup_timestamp_from_name(file_name) else {
            continue;
        };
        backups.push((timestamp, entry.path()));
    }
    backups.sort_by(|left, right| right.0.cmp(&left.0));

    let stale: Vec<_> = backups
        .into_iter()
        .filter(|(created_at, _)| now.saturating_sub(*created_at) >= 30 * 24 * 60 * 60 * 1000)
        .skip(2)
        .collect();
    for (_, path) in stale {
        match fs::remove_file(&path) {
            Ok(()) => {
                tracing::info!(backup_path = %path.display(), "Deleted orphaned migration backup");
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => tracing::warn!(
                backup_path = %path.display(),
                %error,
                "Failed to delete orphaned migration backup"
            ),
        }
    }
    Ok(())
}

fn backup_timestamp_from_name(file_name: &str) -> Option<u64> {
    file_name
        .strip_prefix("nyaterm.redb.bak-v1-")?
        .strip_suffix(".redb")?
        .parse()
        .ok()
}

fn has_legacy_data(db: &Database) -> AppResult<bool> {
    Ok(!read_legacy_docs(db, JSON_DOCS_TABLE)?.is_empty()
        || !read_legacy_docs(db, TEXT_DOCS_TABLE)?.is_empty())
}

fn get_schema_version_optional_from_db(db: &Database) -> AppResult<Option<u32>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(META_TABLE) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    let Some(raw) = table.get(META_SCHEMA_VERSION).map_err(storage_error)? else {
        return Ok(None);
    };
    parse_meta_u32(raw.value(), META_SCHEMA_VERSION).map(Some)
}

fn parse_meta_u32(raw: &str, key: &str) -> AppResult<u32> {
    raw.parse::<u32>()
        .map_err(|error| AppError::Storage(format!("meta/{key} is not a u32: {error}")))
}
fn read_meta_string_in_txn(txn: &redb::WriteTransaction, key: &str) -> AppResult<Option<String>> {
    let table = txn.open_table(META_TABLE).map_err(storage_error)?;
    let value = table
        .get(key)
        .map_err(storage_error)?
        .map(|raw| raw.value().to_string());
    Ok(value)
}
fn read_meta_u32_in_txn(txn: &redb::WriteTransaction, key: &str) -> AppResult<Option<u32>> {
    read_meta_string_in_txn(txn, key)?
        .map(|raw| parse_meta_u32(&raw, key))
        .transpose()
}
fn read_meta_u64_in_txn(txn: &redb::WriteTransaction, key: &str) -> AppResult<Option<u64>> {
    read_meta_string_in_txn(txn, key)?
        .map(|raw| {
            raw.parse::<u64>()
                .map_err(|error| AppError::Storage(format!("meta/{key} is not a u64: {error}")))
        })
        .transpose()
}
fn write_meta_u32(txn: &redb::WriteTransaction, key: &str, value: u32) -> AppResult<()> {
    write_meta_string(txn, key, &value.to_string())
}
fn write_meta_string(txn: &redb::WriteTransaction, key: &str, value: &str) -> AppResult<()> {
    let mut table = txn.open_table(META_TABLE).map_err(storage_error)?;
    table.insert(key, value).map_err(storage_error)?;
    Ok(())
}
fn write_raw_bytes_in_txn(
    txn: &redb::WriteTransaction,
    definition: TableDefinition<&str, &[u8]>,
    key: &str,
    value: &[u8],
) -> AppResult<()> {
    let mut table = txn.open_table(definition).map_err(storage_error)?;
    table.insert(key, value).map_err(storage_error)?;
    Ok(())
}
fn write_json_in_txn<T>(
    txn: &redb::WriteTransaction,
    definition: TableDefinition<&str, &[u8]>,
    key: &str,
    value: &T,
) -> AppResult<()>
where
    T: Serialize,
{
    let bytes = serialize_json(value)?;
    write_raw_bytes_in_txn(txn, definition, key, bytes.as_slice())
}
fn serialize_json<T: Serialize>(value: &T) -> AppResult<Vec<u8>> {
    serde_json::to_vec(value).map_err(Into::into)
}
fn deserialize_json<T: DeserializeOwned>(bytes: &[u8]) -> AppResult<T> {
    serde_json::from_slice(bytes).map_err(Into::into)
}
fn entity_key(prefix: &str, id: &str) -> String {
    format!("{prefix}{id}")
}
fn settings_doc_key(key: &str) -> String {
    format!("{SETTINGS_DOC_PREFIX}{key}")
}
fn is_entity_json_doc(key: &str) -> bool {
    matches!(
        key,
        LEGACY_JSON_SETTINGS
            | LEGACY_JSON_SESSIONS
            | LEGACY_JSON_KEYS
            | LEGACY_JSON_PASSWORDS
            | LEGACY_JSON_CREDENTIALS
            | LEGACY_JSON_OTP
            | LEGACY_JSON_PROXIES
            | LEGACY_JSON_TUNNELS
            | LEGACY_JSON_HISTORY
    )
}
fn current_time_ms() -> u64 {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}
fn parse_sessions_config(content: &str) -> AppResult<crate::config::SessionsConfig> {
    let raw: serde_json::Value = serde_json::from_str(content)?;
    let groups = raw
        .get("groups")
        .cloned()
        .map(serde_json::from_value)
        .transpose()?
        .unwrap_or_default();
    let raw_connections = raw
        .get("connections")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let mut connections = Vec::new();
    for raw_connection in raw_connections {
        if raw_connection.get("type").is_none() {
            tracing::warn!("Skipping unsupported legacy connection entry without type");
            continue;
        }
        match serde_json::from_value::<crate::config::SavedConnection>(raw_connection) {
            Ok(connection) => connections.push(connection),
            Err(error) => {
                tracing::warn!("Skipping malformed connection during storage migration: {error}");
            }
        }
    }
    Ok(crate::config::SessionsConfig {
        groups,
        connections,
    })
}
fn replace_sessions_in_txn(
    txn: &redb::WriteTransaction,
    config: &crate::config::SessionsConfig,
) -> AppResult<()> {
    clear_prefix_in_txn(txn, GROUPS_TABLE, GROUP_PREFIX)?;
    clear_prefix_in_txn(txn, CONNECTIONS_TABLE, CONNECTION_PREFIX)?;
    clear_prefix_in_txn(txn, CREDENTIALS_TABLE, CONNECTION_PASSWORD_PREFIX)?;
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_GROUP_TABLE, "")?;
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_LAST_USED_TABLE, "")?;
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_PROTOCOL_TABLE, "")?;
    for group in &config.groups {
        save_group_in_txn(txn, group)?;
    }
    for connection in &config.connections {
        save_connection_in_txn(txn, connection)?;
    }
    Ok(())
}
fn save_group_in_txn(txn: &redb::WriteTransaction, group: &crate::config::Group) -> AppResult<()> {
    let mut group = group.clone();
    let now = current_time_ms();
    let key = entity_key(GROUP_PREFIX, &group.id);
    if group.created_at_ms.is_none() {
        group.created_at_ms = existing_group_created_at(txn, &key)?.or(Some(now));
    }
    group.updated_at_ms = Some(now);
    write_json_in_txn(txn, GROUPS_TABLE, &key, &group)
}
fn existing_group_created_at(txn: &redb::WriteTransaction, key: &str) -> AppResult<Option<u64>> {
    let table = txn.open_table(GROUPS_TABLE).map_err(storage_error)?;
    let Some(raw) = table.get(key).map_err(storage_error)? else {
        return Ok(None);
    };
    let group: crate::config::Group = deserialize_json(raw.value())?;
    Ok(group.created_at_ms)
}
fn save_connection_in_txn(
    txn: &redb::WriteTransaction,
    connection: &crate::config::SavedConnection,
) -> AppResult<()> {
    let mut connection = connection.clone();
    let now = current_time_ms();
    let connection_key = entity_key(CONNECTION_PREFIX, &connection.id);
    if connection.created_at_ms.is_none() {
        connection.created_at_ms =
            existing_connection_created_at(txn, &connection_key)?.or(Some(now));
    }
    connection.updated_at_ms = Some(now);
    remove_connection_index_entries(txn, &connection.id)?;
    delete_connection_password_in_txn(txn, &connection.id)?;
    if let Some(auth) = connection.auth.as_mut() {
        if let Some(password) = auth.password.take().filter(|value| !value.is_empty()) {
            let record = ConnectionPasswordRecord {
                id: connection.id.clone(),
                connection_id: connection.id.clone(),
                password,
                created_at_ms: now,
                updated_at_ms: now,
            };
            write_json_in_txn(
                txn,
                CREDENTIALS_TABLE,
                &entity_key(CONNECTION_PASSWORD_PREFIX, &connection.id),
                &record,
            )?;
        }
        auth.has_password = false;
    }
    write_json_in_txn(txn, CONNECTIONS_TABLE, &connection_key, &connection)?;
    insert_connection_indexes(txn, &connection)?;
    Ok(())
}
fn existing_connection_created_at(
    txn: &redb::WriteTransaction,
    key: &str,
) -> AppResult<Option<u64>> {
    let table = txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
    let Some(raw) = table.get(key).map_err(storage_error)? else {
        return Ok(None);
    };
    let connection: crate::config::SavedConnection = deserialize_json(raw.value())?;
    Ok(connection.created_at_ms)
}
fn delete_connection_in_txn(txn: &redb::WriteTransaction, connection_id: &str) -> AppResult<()> {
    {
        let mut table = txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
        table
            .remove(entity_key(CONNECTION_PREFIX, connection_id).as_str())
            .map_err(storage_error)?;
    }
    delete_connection_password_in_txn(txn, connection_id)?;
    remove_connection_index_entries(txn, connection_id)?;
    Ok(())
}
fn delete_connection_password_in_txn(
    txn: &redb::WriteTransaction,
    connection_id: &str,
) -> AppResult<()> {
    let mut table = txn.open_table(CREDENTIALS_TABLE).map_err(storage_error)?;
    table
        .remove(entity_key(CONNECTION_PASSWORD_PREFIX, connection_id).as_str())
        .map_err(storage_error)?;
    Ok(())
}
fn insert_connection_indexes(
    txn: &redb::WriteTransaction,
    connection: &crate::config::SavedConnection,
) -> AppResult<()> {
    insert_connection_group_index(txn, connection)?;
    insert_connection_last_used_index(txn, connection)?;
    insert_connection_protocol_index(txn, connection)
}
fn insert_connection_group_index(
    txn: &redb::WriteTransaction,
    connection: &crate::config::SavedConnection,
) -> AppResult<()> {
    let group_id = connection.group_id.as_deref().unwrap_or_default();
    let key = format!(
        "{}|{}|{}",
        group_id,
        padded_i64(i64::from(connection.sort_order)),
        connection.id
    );
    let mut table = txn
        .open_table(IDX_CONNECTIONS_BY_GROUP_TABLE)
        .map_err(storage_error)?;
    table
        .insert(key.as_str(), connection.id.as_str())
        .map_err(storage_error)?;
    Ok(())
}
fn insert_connection_last_used_index(
    txn: &redb::WriteTransaction,
    connection: &crate::config::SavedConnection,
) -> AppResult<()> {
    let last_used = connection.last_used_at_ms.unwrap_or_default();
    let reverse = u64::MAX.saturating_sub(last_used);
    let key = format!("{reverse:020}|{}", connection.id);
    let mut table = txn
        .open_table(IDX_CONNECTIONS_BY_LAST_USED_TABLE)
        .map_err(storage_error)?;
    table
        .insert(key.as_str(), connection.id.as_str())
        .map_err(storage_error)?;
    Ok(())
}
fn insert_connection_protocol_index(
    txn: &redb::WriteTransaction,
    connection: &crate::config::SavedConnection,
) -> AppResult<()> {
    let protocol = connection_protocol(&connection.config);
    let key = format!("{protocol}|{}", connection.id);
    let mut table = txn
        .open_table(IDX_CONNECTIONS_BY_PROTOCOL_TABLE)
        .map_err(storage_error)?;
    table
        .insert(key.as_str(), connection.id.as_str())
        .map_err(storage_error)?;
    Ok(())
}
fn remove_connection_index_entries(
    txn: &redb::WriteTransaction,
    connection_id: &str,
) -> AppResult<()> {
    remove_connection_index_entries_from_table(txn, IDX_CONNECTIONS_BY_GROUP_TABLE, connection_id)?;
    remove_connection_index_entries_from_table(
        txn,
        IDX_CONNECTIONS_BY_LAST_USED_TABLE,
        connection_id,
    )?;
    remove_connection_index_entries_from_table(
        txn,
        IDX_CONNECTIONS_BY_PROTOCOL_TABLE,
        connection_id,
    )
}
fn remove_connection_index_entries_from_table(
    txn: &redb::WriteTransaction,
    definition: TableDefinition<&str, &str>,
    connection_id: &str,
) -> AppResult<()> {
    let table = txn.open_table(definition).map_err(storage_error)?;
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if value.value() == connection_id || key.value().ends_with(&format!("|{connection_id}")) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn.open_table(definition).map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn rebuild_all_connection_indexes_in_txn(txn: &redb::WriteTransaction) -> AppResult<()> {
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_GROUP_TABLE, "")?;
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_LAST_USED_TABLE, "")?;
    clear_string_prefix_in_txn(txn, IDX_CONNECTIONS_BY_PROTOCOL_TABLE, "")?;
    let table = txn.open_table(CONNECTIONS_TABLE).map_err(storage_error)?;
    let mut connections = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if key.value().starts_with(CONNECTION_PREFIX) {
            connections.push(deserialize_json::<crate::config::SavedConnection>(
                value.value(),
            )?);
        }
    }
    drop(table);
    for connection in connections {
        insert_connection_indexes(txn, &connection)?;
    }
    Ok(())
}
fn connection_protocol(config: &crate::config::ConnectionType) -> &'static str {
    match config {
        crate::config::ConnectionType::Ssh { .. } => "ssh",
        crate::config::ConnectionType::LocalTerminal { .. } => "local_terminal",
        crate::config::ConnectionType::Telnet { .. } => "telnet",
        crate::config::ConnectionType::Serial { .. } => "serial",
    }
}
fn sort_connections(connections: &mut [crate::config::SavedConnection]) {
    connections.sort_by(|left, right| {
        left.group_id
            .cmp(&right.group_id)
            .then(left.sort_order.cmp(&right.sort_order))
            .then(left.name.cmp(&right.name))
            .then(left.id.cmp(&right.id))
    });
}
fn padded_i64(value: i64) -> String {
    let shifted = i128::from(value) - i128::from(i64::MIN);
    format!("{shifted:020}")
}
fn replace_passwords_in_txn(
    txn: &redb::WriteTransaction,
    config: &crate::config::PasswordsConfig,
) -> AppResult<()> {
    clear_prefix_in_txn(txn, CREDENTIALS_TABLE, PASSWORD_PREFIX)?;
    for entry in &config.passwords {
        write_json_in_txn(
            txn,
            CREDENTIALS_TABLE,
            &entity_key(PASSWORD_PREFIX, &entry.id),
            entry,
        )?;
    }
    Ok(())
}
fn replace_ssh_keys_in_txn(
    txn: &redb::WriteTransaction,
    config: &crate::config::KeysConfig,
) -> AppResult<()> {
    clear_prefix_in_txn(txn, CREDENTIALS_TABLE, SSH_KEY_PREFIX)?;
    for entry in &config.keys {
        write_json_in_txn(
            txn,
            CREDENTIALS_TABLE,
            &entity_key(SSH_KEY_PREFIX, &entry.id),
            entry,
        )?;
    }
    Ok(())
}
fn replace_credentials_in_txn(
    txn: &redb::WriteTransaction,
    config: &crate::config::CredentialsConfig,
) -> AppResult<()> {
    clear_prefix_in_txn(txn, CREDENTIALS_TABLE, CREDENTIAL_PREFIX)?;
    for entry in &config.credentials {
        write_json_in_txn(
            txn,
            CREDENTIALS_TABLE,
            &entity_key(CREDENTIAL_PREFIX, &entry.id),
            entry,
        )?;
    }
    Ok(())
}
fn replace_otp_in_txn(
    txn: &redb::WriteTransaction,
    config: &crate::config::OtpConfig,
) -> AppResult<()> {
    clear_prefix_in_txn(txn, OTP_ACCOUNTS_TABLE, OTP_PREFIX)?;
    for entry in &config.entries {
        write_json_in_txn(
            txn,
            OTP_ACCOUNTS_TABLE,
            &entity_key(OTP_PREFIX, &entry.id),
            entry,
        )?;
    }
    Ok(())
}
fn replace_proxies_in_txn(
    txn: &redb::WriteTransaction,
    proxies: &[crate::config::ProxyConfig],
) -> AppResult<()> {
    clear_prefix_in_txn(txn, PROXIES_TABLE, PROXY_PREFIX)?;
    for proxy in proxies {
        write_json_in_txn(
            txn,
            PROXIES_TABLE,
            &entity_key(PROXY_PREFIX, &proxy.id),
            proxy,
        )?;
    }
    Ok(())
}
fn replace_tunnels_in_txn(
    txn: &redb::WriteTransaction,
    tunnels: &[crate::config::TunnelConfig],
) -> AppResult<()> {
    clear_prefix_in_txn(txn, TUNNELS_TABLE, TUNNEL_PREFIX)?;
    for tunnel in tunnels {
        write_json_in_txn(
            txn,
            TUNNELS_TABLE,
            &entity_key(TUNNEL_PREFIX, &tunnel.id),
            tunnel,
        )?;
    }
    Ok(())
}
fn clear_prefix_in_txn(
    txn: &redb::WriteTransaction,
    definition: TableDefinition<&str, &[u8]>,
    prefix: &str,
) -> AppResult<()> {
    let table = txn.open_table(definition).map_err(storage_error)?;
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, _) = entry.map_err(storage_error)?;
        if key.value().starts_with(prefix) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn.open_table(definition).map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn clear_string_prefix_in_txn(
    txn: &redb::WriteTransaction,
    definition: TableDefinition<&str, &str>,
    prefix: &str,
) -> AppResult<()> {
    let table = txn.open_table(definition).map_err(storage_error)?;
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, _) = entry.map_err(storage_error)?;
        if key.value().starts_with(prefix) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn.open_table(definition).map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn parse_history_entries(content: &str) -> AppResult<Vec<crate::core::history::HistoryEntry>> {
    if content.trim().is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(store) = serde_json::from_str::<HistoryStoreFileV2>(content) {
        return Ok(normalize_history_entries(store.entries));
    }
    let legacy_commands: Vec<String> = serde_json::from_str(content)?;
    let base_timestamp = current_time_ms().saturating_sub(legacy_commands.len() as u64);
    let entries = legacy_commands
        .into_iter()
        .enumerate()
        .filter_map(|(index, command)| {
            crate::core::history::sanitize_history_command(&command).map(|command| {
                crate::core::history::HistoryEntry {
                    command,
                    last_used_at_ms: base_timestamp.saturating_add(index as u64),
                    use_count: 1,
                }
            })
        })
        .collect();
    Ok(normalize_history_entries(entries))
}
fn normalize_history_entries(
    entries: Vec<crate::core::history::HistoryEntry>,
) -> Vec<crate::core::history::HistoryEntry> {
    let mut by_command: HashMap<String, crate::core::history::HistoryEntry> = HashMap::new();
    for entry in entries {
        let Some(command) = crate::core::history::sanitize_history_command(&entry.command) else {
            continue;
        };
        by_command
            .entry(command.clone())
            .and_modify(|existing| {
                existing.last_used_at_ms = existing.last_used_at_ms.max(entry.last_used_at_ms);
                existing.use_count = existing.use_count.saturating_add(entry.use_count.max(1));
            })
            .or_insert(crate::core::history::HistoryEntry {
                command,
                last_used_at_ms: entry.last_used_at_ms,
                use_count: entry.use_count.max(1),
            });
    }
    let mut entries: Vec<_> = by_command.into_values().collect();
    entries.sort_by_key(|entry| entry.last_used_at_ms);
    entries
}
fn replace_command_history_in_txn(
    txn: &redb::WriteTransaction,
    entries: &[crate::core::history::HistoryEntry],
) -> AppResult<()> {
    clear_prefix_in_txn(txn, COMMAND_HISTORY_TABLE, COMMAND_HISTORY_PREFIX)?;
    for entry in entries {
        save_history_entry_in_txn(txn, entry)?;
    }
    Ok(())
}
fn save_history_entry_in_txn(
    txn: &redb::WriteTransaction,
    entry: &crate::core::history::HistoryEntry,
) -> AppResult<()> {
    let id = history_id(&entry.command);
    remove_history_id_in_txn(txn, &id)?;
    write_json_in_txn(txn, COMMAND_HISTORY_TABLE, &history_key(entry, &id), entry)
}
fn remove_history_id_in_txn(txn: &redb::WriteTransaction, id: &str) -> AppResult<()> {
    let table = txn
        .open_table(COMMAND_HISTORY_TABLE)
        .map_err(storage_error)?;
    let suffix = format!("|{id}");
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, _) = entry.map_err(storage_error)?;
        if key.value().ends_with(&suffix) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn
        .open_table(COMMAND_HISTORY_TABLE)
        .map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn history_key(entry: &crate::core::history::HistoryEntry, id: &str) -> String {
    format!(
        "{}{:020}|{}",
        COMMAND_HISTORY_PREFIX, entry.last_used_at_ms, id
    )
}
fn history_id(command: &str) -> String {
    let digest = Sha256::digest(command.as_bytes());
    hex::encode(&digest[..16])
}
fn replace_known_hosts_text_in_txn(txn: &redb::WriteTransaction, content: &str) -> AppResult<()> {
    clear_prefix_in_txn(txn, KNOWN_HOSTS_TABLE, KNOWN_HOST_PREFIX)?;
    for line in content.lines() {
        save_known_hosts_line_in_txn(txn, line)?;
    }
    Ok(())
}
fn save_known_hosts_line_in_txn(txn: &redb::WriteTransaction, line: &str) -> AppResult<()> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Ok(());
    }
    let now = current_time_ms();
    if let Some(record) = parse_known_host_line(trimmed, now) {
        write_json_in_txn(txn, KNOWN_HOSTS_TABLE, &known_host_key(&record), &record)?;
    } else {
        let record = KnownHostRawRecord {
            line: trimmed.to_string(),
            created_at_ms: now,
            updated_at_ms: now,
        };
        write_json_in_txn(
            txn,
            KNOWN_HOSTS_TABLE,
            &format!("{}{}", KNOWN_HOST_RAW_PREFIX, history_id(trimmed)),
            &record,
        )?;
    }
    Ok(())
}
fn parse_known_host_line(line: &str, now: u64) -> Option<KnownHostRecord> {
    if line.starts_with('#') {
        return None;
    }
    let mut parts = line.split_whitespace();
    let first = parts.next()?;
    let (marker, host_list) = if first.starts_with('@') {
        (Some(first.to_string()), parts.next()?)
    } else {
        (None, first)
    };
    let key_type = parts.next()?;
    let key_base64 = parts.next()?;
    let comment = {
        let rest = parts.collect::<Vec<_>>().join(" ");
        if rest.is_empty() {
            None
        } else {
            Some(rest)
        }
    };
    let host_patterns = host_list
        .split(',')
        .filter(|pattern| !pattern.is_empty())
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    if host_patterns.is_empty() {
        return None;
    }
    Some(KnownHostRecord {
        marker,
        host_identifier: host_patterns[0].clone(),
        host_patterns,
        key_type: key_type.to_string(),
        key_base64: key_base64.to_string(),
        comment,
        raw_line: Some(line.to_string()),
        created_at_ms: now,
        updated_at_ms: now,
    })
}
fn remove_known_hosts_for_host_in_txn(
    txn: &redb::WriteTransaction,
    host_identifier: &str,
) -> AppResult<()> {
    let table = txn.open_table(KNOWN_HOSTS_TABLE).map_err(storage_error)?;
    let mut keys = Vec::new();
    for entry in table.iter().map_err(storage_error)? {
        let (key, value) = entry.map_err(storage_error)?;
        if key.value().starts_with(KNOWN_HOST_RAW_PREFIX) {
            continue;
        }
        let record: KnownHostRecord = deserialize_json(value.value())?;
        if known_host_record_matches(&record, host_identifier) {
            keys.push(key.value().to_string());
        }
    }
    drop(table);
    let mut table = txn.open_table(KNOWN_HOSTS_TABLE).map_err(storage_error)?;
    for key in keys {
        table.remove(key.as_str()).map_err(storage_error)?;
    }
    Ok(())
}
fn known_host_record_matches(record: &KnownHostRecord, host_identifier: &str) -> bool {
    let patterns = if record.host_patterns.is_empty() {
        std::slice::from_ref(&record.host_identifier)
    } else {
        record.host_patterns.as_slice()
    };
    let mut matched = false;
    for pattern in patterns {
        let (negated, pattern) = pattern
            .strip_prefix('!')
            .map_or((false, pattern.as_str()), |pattern| (true, pattern));
        if known_host_pattern_matches(pattern, host_identifier) {
            if negated {
                return false;
            }
            matched = true;
        }
    }
    matched
}
fn known_host_pattern_matches(pattern: &str, host_identifier: &str) -> bool {
    if pattern == host_identifier {
        return true;
    }
    if pattern.starts_with("|1|") {
        return hashed_known_host_matches(pattern, host_identifier);
    }
    false
}
fn hashed_known_host_matches(pattern: &str, host_identifier: &str) -> bool {
    let mut parts = pattern.split('|');
    if parts.next() != Some("") || parts.next() != Some("1") {
        return false;
    }
    let Some(salt_b64) = parts.next() else {
        return false;
    };
    let Some(hash_b64) = parts.next() else {
        return false;
    };
    if parts.next().is_some() {
        return false;
    }
    let Ok(salt) = B64.decode(salt_b64) else {
        return false;
    };
    let Ok(expected) = B64.decode(hash_b64) else {
        return false;
    };
    let Ok(mut mac) = HmacSha1::new_from_slice(&salt) else {
        return false;
    };
    mac.update(host_identifier.as_bytes());
    let actual = mac.finalize().into_bytes();
    expected.as_slice() == actual.as_slice()
}
fn known_host_key(record: &KnownHostRecord) -> String {
    let digest_input = format!(
        "{}|{}|{}",
        record.marker.as_deref().unwrap_or_default(),
        record.host_patterns.join(","),
        record.key_type
    );
    format!("{KNOWN_HOST_PREFIX}{}", history_id(&digest_input))
}
fn render_known_host_record(record: &KnownHostRecord) -> String {
    let host_list = if record.host_patterns.is_empty() {
        record.host_identifier.clone()
    } else {
        record.host_patterns.join(",")
    };
    let mut line = String::new();
    if let Some(marker) = &record.marker {
        line.push_str(marker);
        line.push(' ');
    }
    line.push_str(&host_list);
    line.push(' ');
    line.push_str(&record.key_type);
    line.push(' ');
    line.push_str(&record.key_base64);
    if let Some(comment) = &record.comment {
        if !comment.is_empty() {
            line.push(' ');
            line.push_str(comment);
        }
    }
    line
}
fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{ConnectionAuth, ConnectionType, Group, SavedConnection, SessionsConfig};
    fn unique_config_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("nyaterm-redb-v3-{name}-{nanos}"))
    }
    fn test_storage(name: &str) -> (PathBuf, Storage) {
        let dir = unique_config_dir(name);
        fs::create_dir_all(&dir).expect("create temp dir");
        let storage = Storage::open(&dir).expect("open storage");
        (dir, storage)
    }
    fn sample_group(id: &str, sort_order: i32) -> Group {
        Group {
            id: id.to_string(),
            name: id.to_string(),
            parent_id: None,
            sort_order,
            created_at_ms: None,
            updated_at_ms: None,
        }
    }
    fn sample_connection(id: &str, group_id: Option<&str>, sort_order: i32) -> SavedConnection {
        SavedConnection {
            id: id.to_string(),
            name: id.to_string(),
            config: ConnectionType::Ssh {
                host: "example.com".to_string(),
                port: 22,
                username: "root".to_string(),
            },
            group_id: group_id.map(str::to_string),
            description: None,
            sort_order,
            icon: None,
            auth: Some(ConnectionAuth {
                mode: "password".to_string(),
                password_id: None,
                password: Some(format!("cipher-{id}")),
                key_id: None,
                otp_id: None,
                auto_fill_otp: false,
                has_password: false,
            }),
            network: None,
            created_at_ms: None,
            updated_at_ms: None,
            last_used_at_ms: None,
        }
    }
    #[test]
    fn new_storage_initializes_schema_v3_without_json_files() {
        let (dir, storage) = test_storage("init");
        assert_eq!(storage.get_schema_version().expect("schema version"), 3);
        assert!(!dir.join("settings.json").exists());
        assert!(!dir.join("sessions.json").exists());
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn settings_roundtrip_uses_generic_json_bytes() {
        let (dir, storage) = test_storage("settings");
        let value = serde_json::json!({"theme": "dark"});
        storage
            .save_settings("settings/ui", &value)
            .expect("save settings");
        let loaded: serde_json::Value = storage
            .get_settings("settings/ui")
            .expect("get settings")
            .expect("settings exist");
        assert_eq!(loaded["theme"], "dark");
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn group_crud_roundtrip() {
        let (dir, storage) = test_storage("groups");
        let group = sample_group("group-a", 1);
        storage.save_group(&group).expect("save group");
        assert_eq!(storage.list_groups().expect("list groups").len(), 1);
        assert_eq!(
            storage
                .get_group("group-a")
                .expect("get group")
                .expect("group")
                .name,
            "group-a"
        );
        storage.delete_group("group-a").expect("delete group");
        assert!(storage.list_groups().expect("list groups").is_empty());
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn connection_crud_and_group_index_roundtrip() {
        let (dir, storage) = test_storage("connections");
        let mut one = sample_connection("one", Some("group-a"), 1);
        let two = sample_connection("two", Some("group-b"), 2);
        storage.save_connection(&one).expect("save one");
        storage.save_connection(&two).expect("save two");
        assert_eq!(storage.list_connections().expect("list").len(), 2);
        assert!(storage
            .get_connection("one")
            .expect("get one")
            .expect("one")
            .auth
            .and_then(|auth| auth.password)
            .is_none());
        let group_a = storage
            .list_connections_by_group(Some("group-a"))
            .expect("list group a");
        assert_eq!(
            group_a
                .iter()
                .map(|conn| conn.id.as_str())
                .collect::<Vec<_>>(),
            ["one"]
        );
        one.group_id = Some("group-b".to_string());
        one.auth.as_mut().expect("auth").password = Some("cipher-one".to_string());
        storage.save_connection(&one).expect("move one");
        assert!(storage
            .list_connections_by_group(Some("group-a"))
            .expect("list old group")
            .is_empty());
        assert_eq!(
            storage
                .list_connections_by_group(Some("group-b"))
                .expect("list new group")
                .len(),
            2
        );
        storage.delete_connection("one").expect("delete one");
        assert_eq!(
            storage
                .list_connections_by_group(Some("group-b"))
                .expect("list group b")
                .iter()
                .map(|conn| conn.id.as_str())
                .collect::<Vec<_>>(),
            ["two"]
        );
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn history_appends_lists_and_deletes_by_timestamp() {
        let (dir, storage) = test_storage("history");
        storage
            .append_command_history(&crate::core::history::HistoryEntry {
                command: "ls".to_string(),
                last_used_at_ms: 10,
                use_count: 1,
            })
            .expect("append ls");
        storage
            .append_command_history(&crate::core::history::HistoryEntry {
                command: "pwd".to_string(),
                last_used_at_ms: 20,
                use_count: 1,
            })
            .expect("append pwd");
        let recent = storage
            .list_recent_command_history(10)
            .expect("recent history");
        assert_eq!(recent[0].command, "pwd");
        storage
            .delete_command_history_before(15)
            .expect("delete old history");
        let remaining = storage
            .list_recent_command_history(10)
            .expect("remaining history");
        assert_eq!(remaining.len(), 1);
        assert_eq!(remaining[0].command, "pwd");
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn v1_migration_splits_sessions_deletes_legacy_tables_and_keeps_external_backup() {
        let dir = unique_config_dir("migration");
        fs::create_dir_all(&dir).expect("create temp dir");
        let db_path = database_path(&dir);
        {
            let db = Database::create(&db_path).expect("create legacy db");
            let txn = db.begin_write().expect("begin legacy write");
            {
                let mut json = txn.open_table(JSON_DOCS_TABLE).expect("legacy json table");
                let sessions = SessionsConfig {
                    groups: vec![sample_group("group-a", 1)],
                    connections: vec![sample_connection("conn-a", Some("group-a"), 1)],
                };
                json.insert(
                    LEGACY_JSON_SETTINGS,
                    serde_json::json!({"general": {}}).to_string().as_str(),
                )
                .expect("write settings");
                json.insert(
                    LEGACY_JSON_SESSIONS,
                    serde_json::to_string(&sessions)
                        .expect("serialize")
                        .as_str(),
                )
                .expect("write sessions");
            }
            txn.commit().expect("commit legacy");
        }
        let storage = Storage::open(&dir).expect("migrate storage");
        assert_eq!(storage.get_schema_version().expect("schema version"), 3);
        assert_eq!(storage.list_groups().expect("groups").len(), 1);
        assert_eq!(storage.list_connections().expect("connections").len(), 1);
        let compat = storage.load_sessions().expect("load sessions");
        assert_eq!(compat.groups[0].id, "group-a");
        assert_eq!(compat.connections[0].id, "conn-a");
        assert!(compat.connections[0]
            .auth
            .as_ref()
            .and_then(|auth| auth.password.as_deref())
            .is_some());
        let legacy_docs = read_legacy_docs(&storage.db, JSON_DOCS_TABLE).expect("legacy docs");
        assert!(legacy_docs.is_empty());
        let backup_count = fs::read_dir(&dir)
            .expect("read dir")
            .filter_map(Result::ok)
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("nyaterm.redb.bak-v1-")
            })
            .count();
        assert_eq!(backup_count, 1);
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn replace_sessions_splits_entities() {
        let (dir, storage) = test_storage("sessions");
        let config = SessionsConfig {
            groups: vec![sample_group("group-a", 1)],
            connections: vec![sample_connection("conn-a", Some("group-a"), 1)],
        };
        storage.replace_sessions(&config).expect("save sessions");
        assert!(read_legacy_docs(&storage.db, JSON_DOCS_TABLE)
            .expect("legacy docs")
            .is_empty());
        assert_eq!(storage.list_groups().expect("groups").len(), 1);
        assert_eq!(storage.list_connections().expect("connections").len(), 1);
        let _ = fs::remove_dir_all(dir);
    }
    #[test]
    fn known_hosts_repository_preserves_structured_marker_hashed_and_raw_lines() {
        let (dir, storage) = test_storage("known-hosts");
        storage
            .replace_known_hosts_export(
                "# comment\n@cert-authority *.example.com ssh-ed25519 AAAA ca\n|1|nNMSH1CuL4w6FneDFn3ONf5paeg=|q8MlMsHsBk6GOpNwYqhnCeXKlRk= ssh-rsa BBBB\n",
            )
            .expect("save known hosts");
        let rendered = storage
            .render_known_hosts_export()
            .expect("load known hosts");
        assert!(rendered.contains("# comment"));
        assert!(rendered.contains("@cert-authority *.example.com ssh-ed25519 AAAA ca"));
        assert!(rendered
            .contains("|1|nNMSH1CuL4w6FneDFn3ONf5paeg=|q8MlMsHsBk6GOpNwYqhnCeXKlRk= ssh-rsa BBBB"));
        let _ = fs::remove_dir_all(dir);
    }
}

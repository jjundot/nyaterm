//! redb-backed persistence for Dragonfly's user data.
//!
//! The public API stores the same JSON/text payloads that used to live as
//! files under `~/.dragonfly`, so higher layers can keep their serde models.

use crate::error::{AppError, AppResult};
use redb::{Database, ReadableDatabase, ReadableTable, TableDefinition};
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, OnceLock};

const DATABASE_FILE: &str = "dragonfly.redb";
const SCHEMA_VERSION: &str = "1";
const META_SCHEMA_VERSION: &str = "schema_version";
const META_LEGACY_MIGRATED: &str = "legacy_migrated";

const META_TABLE: TableDefinition<&str, &str> = TableDefinition::new("meta");
const JSON_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("json_docs");
const TEXT_DOCS_TABLE: TableDefinition<&str, &str> = TableDefinition::new("text_docs");

pub const JSON_SETTINGS: &str = "settings";
pub const JSON_SESSIONS: &str = "sessions";
pub const JSON_KEYS: &str = "keys";
pub const JSON_PASSWORDS: &str = "passwords";
pub const JSON_OTP: &str = "otp";
pub const JSON_PROXIES: &str = "proxies";
pub const JSON_TUNNELS: &str = "tunnels";
pub const JSON_QUICK_COMMAND: &str = "quick-command";
pub const JSON_CLOUD_SYNC: &str = "cloud-sync";
pub const JSON_CLOUD_SYNC_STATE: &str = "cloud-sync-state";
pub const JSON_HISTORY: &str = "history";
pub const JSON_AI_HISTORY: &str = "ai-history";
pub const JSON_AI_AUDIT: &str = "ai-audit";

pub const TEXT_KNOWN_HOSTS: &str = "known_hosts";
pub const TEXT_MASTER_KEY: &str = "master.key";

static DATABASE: OnceLock<Arc<Database>> = OnceLock::new();

const LEGACY_JSON_FILES: &[(&str, &str)] = &[
    ("settings.json", JSON_SETTINGS),
    ("sessions.json", JSON_SESSIONS),
    ("keys.json", JSON_KEYS),
    ("passwords.json", JSON_PASSWORDS),
    ("otp.json", JSON_OTP),
    ("proxies.json", JSON_PROXIES),
    ("tunnels.json", JSON_TUNNELS),
    ("quick-command.json", JSON_QUICK_COMMAND),
    ("cloud_sync.json", JSON_CLOUD_SYNC),
    ("cloud_sync_state.json", JSON_CLOUD_SYNC_STATE),
    ("history.json", JSON_HISTORY),
    ("ai-history.json", JSON_AI_HISTORY),
    ("ai-audit.json", JSON_AI_AUDIT),
];

const LEGACY_TEXT_FILES: &[(&str, &str)] = &[
    ("known_hosts", TEXT_KNOWN_HOSTS),
    ("master.key", TEXT_MASTER_KEY),
];

pub fn init(config_dir: &Path) -> AppResult<()> {
    fs::create_dir_all(config_dir)?;
    let db_path = config_dir.join(DATABASE_FILE);
    let db = Arc::new(open_database(&db_path)?);
    migrate_legacy_files(&db, config_dir)?;

    if DATABASE.set(db).is_err() {
        tracing::debug!("redb storage was already initialized");
    }
    Ok(())
}

#[cfg(test)]
fn database_path(config_dir: &Path) -> PathBuf {
    config_dir.join(DATABASE_FILE)
}

pub fn json_key_for_legacy_file(file_name: &str) -> Option<&'static str> {
    LEGACY_JSON_FILES
        .iter()
        .find_map(|(name, key)| (*name == file_name).then_some(*key))
}

pub fn text_key_for_legacy_file(file_name: &str) -> Option<&'static str> {
    LEGACY_TEXT_FILES
        .iter()
        .find_map(|(name, key)| (*name == file_name).then_some(*key))
}

pub fn load_json_doc<T: serde::de::DeserializeOwned + Default>(key: &str) -> AppResult<T> {
    let Some(raw) = load_json_doc_raw(key)? else {
        return Ok(T::default());
    };
    Ok(serde_json::from_str(&raw)?)
}

pub fn save_json_doc<T: Serialize>(key: &str, data: &T) -> AppResult<()> {
    let content = serde_json::to_string_pretty(data)?;
    save_json_doc_raw(key, &content)
}

pub fn load_json_doc_raw(key: &str) -> AppResult<Option<String>> {
    let db = database()?;
    read_json_doc(&db, key)
}

pub fn save_json_doc_raw(key: &str, value: &str) -> AppResult<()> {
    let db = database()?;
    write_json_doc(&db, key, value)
}

pub fn load_text_doc(key: &str) -> AppResult<Option<String>> {
    let db = database()?;
    read_text_doc(&db, key)
}

pub fn save_text_doc(key: &str, value: &str) -> AppResult<()> {
    let db = database()?;
    write_text_doc(&db, key, value)
}

pub fn append_text_line(key: &str, line: &str) -> AppResult<()> {
    let mut current = load_text_doc(key)?.unwrap_or_default();
    if !current.is_empty() && !current.ends_with('\n') {
        current.push('\n');
    }
    current.push_str(line);
    current.push('\n');
    save_text_doc(key, &current)
}

fn database() -> AppResult<Arc<Database>> {
    if let Some(db) = DATABASE.get() {
        return Ok(db.clone());
    }

    let config_dir = default_config_dir()?;
    init(&config_dir)?;
    DATABASE
        .get()
        .cloned()
        .ok_or_else(|| AppError::Storage("redb storage did not initialize".to_string()))
}

fn default_config_dir() -> AppResult<PathBuf> {
    let home = dirs::home_dir()
        .ok_or_else(|| AppError::Config("cannot determine home directory".to_string()))?;
    Ok(home.join(".dragonfly"))
}

fn open_database(path: &Path) -> AppResult<Database> {
    if path.exists() {
        Database::open(path).map_err(storage_error)
    } else {
        Database::create(path).map_err(storage_error)
    }
}

fn migrate_legacy_files(db: &Database, config_dir: &Path) -> AppResult<()> {
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut meta = txn.open_table(META_TABLE).map_err(storage_error)?;
        meta.insert(META_SCHEMA_VERSION, SCHEMA_VERSION)
            .map_err(storage_error)?;
        if meta
            .get(META_LEGACY_MIGRATED)
            .map_err(storage_error)?
            .is_some()
        {
            drop(meta);
            txn.commit().map_err(storage_error)?;
            return Ok(());
        }
    }

    {
        let mut json_docs = txn.open_table(JSON_DOCS_TABLE).map_err(storage_error)?;
        for (file_name, key) in LEGACY_JSON_FILES {
            if json_docs.get(*key).map_err(storage_error)?.is_some() {
                continue;
            }
            let path = config_dir.join(file_name);
            if !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(&path)?;
            json_docs.insert(*key, content.as_str()).map_err(storage_error)?;
        }
    }

    {
        let mut text_docs = txn.open_table(TEXT_DOCS_TABLE).map_err(storage_error)?;
        for (file_name, key) in LEGACY_TEXT_FILES {
            if text_docs.get(*key).map_err(storage_error)?.is_some() {
                continue;
            }
            let path = config_dir.join(file_name);
            if !path.is_file() {
                continue;
            }
            let content = fs::read_to_string(&path)?;
            text_docs.insert(*key, content.as_str()).map_err(storage_error)?;
        }
    }

    {
        let mut meta = txn.open_table(META_TABLE).map_err(storage_error)?;
        meta.insert(META_LEGACY_MIGRATED, "true")
            .map_err(storage_error)?;
    }

    txn.commit().map_err(storage_error)?;
    Ok(())
}

fn read_json_doc(db: &Database, key: &str) -> AppResult<Option<String>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(JSON_DOCS_TABLE) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    Ok(table
        .get(key)
        .map_err(storage_error)?
        .map(|guard| guard.value().to_string()))
}

fn write_json_doc(db: &Database, key: &str, value: &str) -> AppResult<()> {
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut table = txn.open_table(JSON_DOCS_TABLE).map_err(storage_error)?;
        table.insert(key, value).map_err(storage_error)?;
    }
    txn.commit().map_err(storage_error)?;
    Ok(())
}

fn read_text_doc(db: &Database, key: &str) -> AppResult<Option<String>> {
    let txn = db.begin_read().map_err(storage_error)?;
    let table = match txn.open_table(TEXT_DOCS_TABLE) {
        Ok(table) => table,
        Err(redb::TableError::TableDoesNotExist(_)) => return Ok(None),
        Err(error) => return Err(storage_error(error)),
    };
    Ok(table
        .get(key)
        .map_err(storage_error)?
        .map(|guard| guard.value().to_string()))
}

fn write_text_doc(db: &Database, key: &str, value: &str) -> AppResult<()> {
    let txn = db.begin_write().map_err(storage_error)?;
    {
        let mut table = txn.open_table(TEXT_DOCS_TABLE).map_err(storage_error)?;
        table.insert(key, value).map_err(storage_error)?;
    }
    txn.commit().map_err(storage_error)?;
    Ok(())
}

fn storage_error(error: impl std::fmt::Display) -> AppError {
    AppError::Storage(format!("Storage error: {error}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn unique_config_dir(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("dragonfly-redb-{name}-{nanos}"))
    }

    #[test]
    fn redb_json_and_text_roundtrip() {
        let dir = unique_config_dir("roundtrip");
        fs::create_dir_all(&dir).expect("create temp dir");
        let db = open_database(&database_path(&dir)).expect("open db");

        write_json_doc(&db, JSON_SETTINGS, "{\"ok\":true}").expect("write json");
        write_text_doc(&db, TEXT_KNOWN_HOSTS, "example ssh-ed25519 abc\n").expect("write text");

        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS).expect("read json").as_deref(),
            Some("{\"ok\":true}")
        );
        assert_eq!(
            read_text_doc(&db, TEXT_KNOWN_HOSTS)
                .expect("read text")
                .as_deref(),
            Some("example ssh-ed25519 abc\n")
        );

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn migration_keeps_existing_redb_values() {
        let dir = unique_config_dir("migration");
        fs::create_dir_all(&dir).expect("create temp dir");
        fs::write(dir.join("settings.json"), "{\"legacy\":true}").expect("write settings");
        fs::write(dir.join("known_hosts"), "legacy-host key value\n").expect("write known_hosts");

        let db = open_database(&database_path(&dir)).expect("open db");
        write_json_doc(&db, JSON_SETTINGS, "{\"existing\":true}").expect("preseed");
        migrate_legacy_files(&db, &dir).expect("migrate");

        assert_eq!(
            read_json_doc(&db, JSON_SETTINGS)
                .expect("read settings")
                .as_deref(),
            Some("{\"existing\":true}")
        );
        assert_eq!(
            read_text_doc(&db, TEXT_KNOWN_HOSTS)
                .expect("read known_hosts")
                .as_deref(),
            Some("legacy-host key value\n")
        );
        assert!(dir.join("settings.json").exists());
        assert!(dir.join("known_hosts").exists());

        let _ = fs::remove_dir_all(dir);
    }
}

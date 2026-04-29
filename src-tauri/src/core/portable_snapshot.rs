use crate::config::{
    self, ActivityBarLayout, AppSettings, DiagnosticsSettings, InteractionSettings, SearchSettings,
    TerminalSettings, TransferSettings, TranslationSettings,
};
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};

use super::{QuickCommandsStore, SessionManager};

const PORTABLE_SNAPSHOT_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PortableSnapshotKind {
    Sync,
    Backup,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortableSnapshotPayload {
    #[serde(default)]
    pub files: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSnapshotEnvelope {
    pub schema_version: u32,
    pub snapshot_kind: PortableSnapshotKind,
    pub revision_id: String,
    pub device_id: String,
    pub created_at_ms: u64,
    pub payload_hash: String,
    pub app_version: String,
    pub payload: PortableSnapshotPayload,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableUiSettings {
    pub language: Option<String>,
    pub show_remote_stats: bool,
    pub remote_stats_interval: u32,
    pub saved_connections_sort_mode: String,
    pub activity_bar_layout: ActivityBarLayout,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableAppSettings {
    pub general: config::GeneralSettings,
    pub appearance: config::AppearanceSettings,
    pub proxy: config::ProxySettings,
    pub search: SearchSettings,
    pub translation: TranslationSettings,
    pub security: config::SecuritySettings,
    pub terminal: TerminalSettings,
    pub interaction: InteractionSettings,
    pub transfer: TransferSettings,
    pub diagnostics: DiagnosticsSettings,
    pub ui: PortableUiSettings,
}

impl PortableAppSettings {
    pub fn from_app_settings(settings: &AppSettings) -> Self {
        let mut security = settings.security.clone();
        security.master_password = None;
        Self {
            general: settings.general.clone(),
            appearance: settings.appearance.clone(),
            proxy: settings.proxy.clone(),
            search: settings.search.clone(),
            translation: settings.translation.clone(),
            security,
            terminal: settings.terminal.clone(),
            interaction: settings.interaction.clone(),
            transfer: settings.transfer.clone(),
            diagnostics: settings.diagnostics.clone(),
            ui: PortableUiSettings {
                language: settings.ui.language.clone(),
                show_remote_stats: settings.ui.show_remote_stats,
                remote_stats_interval: settings.ui.remote_stats_interval,
                saved_connections_sort_mode: settings.ui.saved_connections_sort_mode.clone(),
                activity_bar_layout: settings.ui.activity_bar_layout.clone(),
            },
        }
    }

    pub fn apply_to(self, mut current: AppSettings) -> AppSettings {
        let master_password = current.security.master_password.clone();
        let ui_state = current.ui.clone();

        current.general = self.general;
        current.appearance = self.appearance;
        current.proxy = self.proxy;
        current.search = self.search;
        current.translation = self.translation;
        current.security = self.security;
        current.security.master_password = master_password;
        current.terminal = self.terminal;
        current.interaction = self.interaction;
        current.transfer = self.transfer;
        current.diagnostics = self.diagnostics;
        current.ui.language = self.ui.language;
        current.ui.show_remote_stats = self.ui.show_remote_stats;
        current.ui.remote_stats_interval = self.ui.remote_stats_interval;
        current.ui.saved_connections_sort_mode = self.ui.saved_connections_sort_mode;
        current.ui.activity_bar_layout = self.ui.activity_bar_layout;

        // Preserve device-local UI state.
        current.ui.open_tabs = ui_state.open_tabs;
        current.ui.left_width = ui_state.left_width;
        current.ui.right_width = ui_state.right_width;
        current.ui.quick_cmd_height = ui_state.quick_cmd_height;
        current.ui.active_left_panel = ui_state.active_left_panel;
        current.ui.active_right_panel = ui_state.active_right_panel;
        current.ui.show_quick_cmd_bar = ui_state.show_quick_cmd_bar;
        current.ui.show_serial_send_panel = ui_state.show_serial_send_panel;
        current.ui.serial_send_height = ui_state.serial_send_height;
        current.ui.zoom_level = ui_state.zoom_level;
        current.ui.transfer_height = ui_state.transfer_height;
        current
    }
}

pub fn build_portable_snapshot(
    app: &AppHandle,
    snapshot_kind: PortableSnapshotKind,
    device_id: &str,
) -> AppResult<PortableSnapshotEnvelope> {
    let _ = config::load_config(app)?;
    let settings = config::load_app_settings(app)?;
    let _ = config::get_config_dir(app)?;

    let mut files = BTreeMap::new();
    files.insert(
        "sessions.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_SESSIONS,
            &serde_json::to_string_pretty(&config::SessionsConfig::default())?,
        )?,
    );
    files.insert(
        "keys.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_KEYS,
            &serde_json::to_string_pretty(&config::KeysConfig::default())?,
        )?,
    );
    files.insert(
        "passwords.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_PASSWORDS,
            &serde_json::to_string_pretty(&config::PasswordsConfig::default())?,
        )?,
    );
    files.insert(
        "otp.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_OTP,
            &serde_json::to_string_pretty(&config::OtpConfig::default())?,
        )?,
    );
    files.insert(
        "proxies.json".to_string(),
        read_json_doc_or_default(crate::storage::JSON_PROXIES, "{\n  \"proxies\": []\n}")?,
    );
    files.insert(
        "tunnels.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_TUNNELS,
            &serde_json::to_string_pretty(&config::TunnelsConfig::default())?,
        )?,
    );
    files.insert(
        "quick-command.json".to_string(),
        read_json_doc_or_default(
            crate::storage::JSON_QUICK_COMMAND,
            &serde_json::to_string_pretty(&config::QuickCommandsConfig::default())?,
        )?,
    );
    files.insert(
        "portable-settings.json".to_string(),
        serde_json::to_string_pretty(&PortableAppSettings::from_app_settings(&settings))?,
    );

    if snapshot_kind == PortableSnapshotKind::Backup {
        files.insert(
            "history.json".to_string(),
            read_json_doc_or_default(
                crate::storage::JSON_HISTORY,
                "{\n  \"version\": 2,\n  \"entries\": []\n}",
            )?,
        );
    }

    if let Some(master_key) = crate::storage::load_text_doc(crate::storage::TEXT_MASTER_KEY)? {
        files.insert("master.key".to_string(), master_key);
    }

    let payload = PortableSnapshotPayload { files };
    let payload_bytes = serde_json::to_vec(&payload)?;

    Ok(PortableSnapshotEnvelope {
        schema_version: PORTABLE_SNAPSHOT_SCHEMA_VERSION,
        snapshot_kind,
        revision_id: uuid::Uuid::new_v4().to_string(),
        device_id: device_id.to_string(),
        created_at_ms: current_time_ms(),
        payload_hash: hex::encode(Sha256::digest(&payload_bytes)),
        app_version: app.package_info().version.to_string(),
        payload,
    })
}

pub fn decode_portable_snapshot(bytes: &[u8]) -> AppResult<PortableSnapshotEnvelope> {
    let envelope: PortableSnapshotEnvelope = serde_json::from_slice(bytes)?;
    validate_portable_snapshot(&envelope)?;
    Ok(envelope)
}

pub fn encode_portable_snapshot(envelope: &PortableSnapshotEnvelope) -> AppResult<Vec<u8>> {
    validate_portable_snapshot(envelope)?;
    serde_json::to_vec(envelope).map_err(Into::into)
}

pub async fn apply_portable_snapshot(
    app: &AppHandle,
    envelope: &PortableSnapshotEnvelope,
) -> AppResult<()> {
    validate_portable_snapshot(envelope)?;

    let _ = config::get_config_dir(app)?;

    for (name, contents) in &envelope.payload.files {
        match name.as_str() {
            "portable-settings.json" | "master.key" => continue,
            _ => {
                if let Some(key) = crate::storage::json_key_for_legacy_file(name) {
                    crate::storage::save_json_doc_raw(key, contents)?;
                }
            }
        }
    }

    if let Some(settings_raw) = envelope.payload.files.get("portable-settings.json") {
        let portable: PortableAppSettings = serde_json::from_str(settings_raw)?;
        let merged = portable.apply_to(config::load_app_settings(app).unwrap_or_default());
        config::save_app_settings(app, &merged)?;
    }

    if let Some(master_key) = envelope.payload.files.get("master.key") {
        crate::storage::save_text_doc(crate::storage::TEXT_MASTER_KEY, master_key)?;
    }

    let quick_commands_store = app.state::<Arc<QuickCommandsStore>>();
    quick_commands_store.load_from_disk(app)?;

    let session_manager = app.state::<Arc<SessionManager>>();
    session_manager
        .inner()
        .as_ref()
        .reload_history_from_storage()
        .await?;

    let _ = app.emit("connections-changed", ());
    let _ = app.emit("quick-commands-changed", ());
    let _ = app.emit("settings-changed", ());
    let _ = app.emit("command-history-changed", ());

    Ok(())
}

fn validate_portable_snapshot(envelope: &PortableSnapshotEnvelope) -> AppResult<()> {
    if envelope.schema_version != PORTABLE_SNAPSHOT_SCHEMA_VERSION {
        return Err(AppError::Config(format!(
            "Unsupported portable snapshot version {}",
            envelope.schema_version
        )));
    }
    let payload_bytes = serde_json::to_vec(&envelope.payload)?;
    let actual = hex::encode(Sha256::digest(&payload_bytes));
    if actual != envelope.payload_hash {
        return Err(AppError::Crypto(
            "Portable snapshot payload hash mismatch".to_string(),
        ));
    }
    Ok(())
}

fn read_json_doc_or_default(key: &str, default_contents: &str) -> AppResult<String> {
    Ok(crate::storage::load_json_doc_raw(key)?.unwrap_or_else(|| default_contents.to_string()))
}

fn current_time_ms() -> u64 {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    u64::try_from(millis).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::{
        PortableAppSettings, PortableSnapshotEnvelope, PortableSnapshotKind, PortableUiSettings,
    };
    use crate::config::{self, ActivityBarLayout, AppSettings};

    #[test]
    fn portable_settings_strip_master_password_and_preserve_device_ui_state_on_apply() {
        let mut current = AppSettings::default();
        current.security.master_password = Some("encrypted-master".to_string());
        current.ui.left_width = 444.0;
        current.ui.active_left_panel = Some("fileExplorer".to_string());

        let mut updated = PortableAppSettings::from_app_settings(&current);
        updated.general.startup_restore = false;
        updated.ui.language = Some("zh-CN".to_string());
        updated.ui.saved_connections_sort_mode = "name-asc".to_string();

        let merged = updated.apply_to(current.clone());
        assert_eq!(
            merged.security.master_password,
            current.security.master_password
        );
        assert_eq!(merged.ui.left_width, current.ui.left_width);
        assert_eq!(merged.ui.active_left_panel, current.ui.active_left_panel);
        assert_eq!(merged.ui.language.as_deref(), Some("zh-CN"));
        assert_eq!(merged.ui.saved_connections_sort_mode, "name-asc");
    }

    #[test]
    fn portable_snapshot_hash_is_stable() {
        let envelope = PortableSnapshotEnvelope {
            schema_version: 1,
            snapshot_kind: PortableSnapshotKind::Sync,
            revision_id: "rev".to_string(),
            device_id: "dev".to_string(),
            created_at_ms: 1,
            payload_hash: "3f7f7dcbad0f09e869f49c57da76d4fcda1fb8f2f7c70231a0a5e731f865f6a3"
                .to_string(),
            app_version: "1.0.0".to_string(),
            payload: super::PortableSnapshotPayload {
                files: std::collections::BTreeMap::from([(
                    "portable-settings.json".to_string(),
                    serde_json::to_string(&PortableAppSettings {
                        general: config::GeneralSettings::default(),
                        appearance: config::AppearanceSettings::default(),
                        proxy: config::ProxySettings::default(),
                        search: config::SearchSettings::default(),
                        translation: config::TranslationSettings::default(),
                        security: config::SecuritySettings::default(),
                        terminal: config::TerminalSettings::default(),
                        interaction: config::InteractionSettings::default(),
                        transfer: config::TransferSettings::default(),
                        diagnostics: config::DiagnosticsSettings::default(),
                        ui: PortableUiSettings {
                            language: Some("en".to_string()),
                            show_remote_stats: false,
                            remote_stats_interval: 3,
                            saved_connections_sort_mode: "default".to_string(),
                            activity_bar_layout: ActivityBarLayout::default(),
                        },
                    })
                    .expect("serialize portable settings"),
                )]),
            },
        };

        assert!(super::validate_portable_snapshot(&envelope).is_ok());
    }
}

//! Config persistence for sessions, UI, and quick commands.
//!
//! Stores JSON files in `~/.dragonfly/`. Credentials are AES-256-GCM encrypted in-place.

use crate::crypto;
use crate::error::{AppError, AppResult};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

// ── Shared Helpers ─────────────────────────────────────────────────────────

fn get_config_dir(app: &AppHandle) -> AppResult<PathBuf> {
    let home_dir = app
        .path()
        .home_dir()
        .map_err(|e| AppError::Config(e.to_string()))?;
    let config_dir = home_dir.join(".dragonfly");
    fs::create_dir_all(&config_dir)?;
    Ok(config_dir)
}

fn load_json<T: serde::de::DeserializeOwned + Default>(path: &PathBuf) -> AppResult<T> {
    if !path.exists() {
        return Ok(T::default());
    }
    let content = fs::read_to_string(path)?;
    Ok(serde_json::from_str(&content)?)
}

fn save_json<T: Serialize>(path: &PathBuf, data: &T) -> AppResult<()> {
    let content = serde_json::to_string_pretty(data)?;
    fs::write(path, content)?;
    Ok(())
}

// ── sessions.json ──────────────────────────────────────────────────────────

/// Saved SSH connection. Credential fields store AES-256-GCM ciphertext on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SavedConnection {
    #[serde(default = "uuid_v4")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    pub host: String,
    pub port: u16,
    pub username: String,
    pub auth_type: String,

    /// Ciphertext on disk; plaintext in memory after `load_connection_by_id`.
    #[serde(default)]
    pub password: Option<String>,
    /// Ciphertext on disk (PEM content); decrypted on demand via `decrypt_key_data`.
    #[serde(default)]
    pub key: Option<String>,
    /// Ciphertext on disk; plaintext in memory after `load_connection_by_id`.
    #[serde(default)]
    pub passphrase: Option<String>,

    /// File path chosen via the file picker — backend reads & encrypts the content.
    #[serde(default, skip_serializing)]
    pub key_file_path: Option<String>,
    /// True when an encrypted private key is stored in `key`.
    #[serde(default, skip_serializing)]
    pub has_key_data: bool,
}

fn uuid_v4() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Group for organizing saved connections in the UI.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Group {
    #[serde(default = "uuid_v4")]
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub sort_order: i32,
}

/// Root config for groups and saved connections (sessions.json).
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SessionsConfig {
    #[serde(default)]
    pub groups: Vec<Group>,
    pub connections: Vec<SavedConnection>,
}

/// Alias for the main app config (sessions + groups).
pub type AppConfig = SessionsConfig;

/// Decrypts `password` and `passphrase` in-place (ciphertext → plaintext).
///
/// Called by `load_connection_by_id` before an SSH session is established.
pub fn decrypt_credentials(conn: &mut SavedConnection) {
    if let Some(ct) = conn.password.clone() {
        conn.password = crypto::decrypt(&ct).ok();
    }
    if let Some(ct) = conn.passphrase.clone() {
        conn.passphrase = crypto::decrypt(&ct).ok();
    }
}

/// Decrypts and returns the stored private key (PEM) for SSH authentication.
pub fn decrypt_key_data(conn: &SavedConnection) -> AppResult<Option<String>> {
    crypto::decrypt_optional(&conn.key)
}

/// Loads sessions.json. Credential fields contain raw ciphertext; only `has_key_data` is derived.
pub fn load_sessions(app: &AppHandle) -> AppResult<SessionsConfig> {
    let dir = get_config_dir(app)?;
    let path = dir.join("sessions.json");
    let mut config: SessionsConfig = load_json(&path)?;

    for conn in &mut config.connections {
        conn.has_key_data = conn.key.is_some();
    }

    Ok(config)
}

/// Saves sessions config to disk (encrypted credentials are inline).
pub fn save_sessions(app: &AppHandle, config: &SessionsConfig) -> AppResult<()> {
    let dir = get_config_dir(app)?;
    save_json(&dir.join("sessions.json"), config)
}

/// Loads the main app config (sessions + groups).
pub fn load_config(app: &AppHandle) -> AppResult<AppConfig> {
    load_sessions(app)
}

/// Loads a single connection by ID and decrypts `password` and `passphrase` for SSH auth.
///
/// Returns `AppError::SessionNotFound` if no connection with that ID exists.
pub fn load_connection_by_id(app: &AppHandle, id: &str) -> AppResult<SavedConnection> {
    let cfg = load_config(app)?;
    let mut conn = cfg
        .connections
        .into_iter()
        .find(|c| c.id == id)
        .ok_or_else(|| AppError::SessionNotFound(format!("Connection '{}' not found", id)))?;
    decrypt_credentials(&mut conn);
    Ok(conn)
}

/// Saves the main app config.
pub fn save_config(app: &AppHandle, config: &AppConfig) -> AppResult<()> {
    save_sessions(app, config)
}

// ── ui.json ────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct RestorableTab {
    pub title: String,
    pub session_type: String,
    pub connection_id: Option<String>,
}

/// Layout and theme preferences persisted in ui.json.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct UiConfig {
    #[serde(default)]
    pub open_tabs: Vec<RestorableTab>,
    pub left_width: f64,
    pub right_width: f64,
    pub saved_conn_height: f64,
    pub history_height: f64,
    pub quick_cmd_height: f64,
    pub show_file_explorer: bool,
    #[serde(default = "default_true")]
    pub show_file_transfer: bool,
    pub show_saved_connections: bool,
    pub show_active_sessions: bool,
    pub show_command_history: bool,
    pub show_quick_commands: bool,
    pub zoom_level: f64,
    #[serde(default = "default_transfer_height")]
    pub file_transfer_height: f64,
    #[serde(default = "default_language")]
    pub language: Option<String>,
}

fn default_true() -> bool {
    true
}

fn default_transfer_height() -> f64 {
    240.0
}

fn default_language() -> Option<String> {
    Some("en".to_string())
}

impl Default for UiConfig {
    fn default() -> Self {
        Self {
            open_tabs: vec![],
            left_width: 256.0,
            right_width: 288.0,
            saved_conn_height: 240.0,
            history_height: 200.0,
            quick_cmd_height: 36.0,
            show_file_explorer: true,
            show_file_transfer: true,
            show_saved_connections: true,
            show_active_sessions: true,
            show_command_history: true,
            show_quick_commands: true,
            zoom_level: 1.0,
            file_transfer_height: 240.0,
            language: Some("en".to_string()),
        }
    }
}

/// Loads UI layout/theme config from ~/.dragonfly/ui.json.
pub fn load_ui_config(app: &AppHandle) -> AppResult<UiConfig> {
    let dir = get_config_dir(app)?;
    load_json(&dir.join("ui.json"))
}

/// Saves UI config to disk.
pub fn save_ui_config(app: &AppHandle, config: &UiConfig) -> AppResult<()> {
    let dir = get_config_dir(app)?;
    save_json(&dir.join("ui.json"), config)
}

// ── quick-command.json ─────────────────────────────────────────────────────

/// Single quick command (label + shell command).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct QuickCommand {
    pub id: String,
    pub label: String,
    pub command: String,
}

/// List of quick commands persisted in quick-command.json.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct QuickCommandsConfig {
    pub commands: Vec<QuickCommand>,
}

/// Loads quick commands from ~/.dragonfly/quick-command.json.
pub fn load_quick_commands(app: &AppHandle) -> AppResult<QuickCommandsConfig> {
    let dir = get_config_dir(app)?;
    load_json(&dir.join("quick-command.json"))
}

/// Saves quick commands to disk.
pub fn save_quick_commands(app: &AppHandle, config: &QuickCommandsConfig) -> AppResult<()> {
    let dir = get_config_dir(app)?;
    save_json(&dir.join("quick-command.json"), config)
}

// ── settings.json ──────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralSettings {
    #[serde(default = "default_true")]
    pub startup_restore: bool,
    #[serde(default = "default_shell")]
    pub default_local_shell: String,
    #[serde(default = "default_false")]
    pub minimize_to_tray: bool,
    #[serde(default)]
    pub boss_key: Option<String>,
}

fn default_shell() -> String {
    if cfg!(windows) { "powershell.exe".to_string() } else { "bash".to_string() }
}
fn default_false() -> bool { false }

impl Default for GeneralSettings {
    fn default() -> Self {
        Self {
            startup_restore: true,
            default_local_shell: default_shell(),
            minimize_to_tray: false,
            boss_key: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppearanceSettings {
    #[serde(default = "default_app_theme")]
    pub theme: String,
    #[serde(default = "default_font")]
    pub font_family: String,
    #[serde(default = "default_font_size")]
    pub font_size: f64,
    #[serde(default = "default_false")]
    pub ligatures: bool,
    #[serde(default = "default_opacity")]
    pub background_opacity: f64,
    #[serde(default = "default_cursor_style")]
    pub cursor_style: String,
    #[serde(default = "default_true")]
    pub cursor_blink: bool,
}

fn default_app_theme() -> String { "github-dark".to_string() }
fn default_font() -> String { "JetBrains Mono, Fira Code, Consolas, monospace".to_string() }
fn default_font_size() -> f64 { 14.0 }
fn default_opacity() -> f64 { 1.0 }
fn default_cursor_style() -> String { "block".to_string() }

impl Default for AppearanceSettings {
    fn default() -> Self {
        Self {
            theme: "github-dark".to_string(),
            font_family: default_font(),
            font_size: default_font_size(),
            ligatures: false,
            background_opacity: default_opacity(),
            cursor_style: default_cursor_style(),
            cursor_blink: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ProxySettings {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub protocol: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SearchEngine {
    pub name: String,
    pub url_template: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchSettings {
    #[serde(default = "default_search_engine")]
    pub default_engine: String,
    #[serde(default = "default_custom_engines")]
    pub custom_engines: Vec<SearchEngine>,
}

fn default_search_engine() -> String {
    "Google".to_string()
}

fn default_custom_engines() -> Vec<SearchEngine> {
    vec![
        SearchEngine {
            name: "Google".to_string(),
            url_template: "https://www.google.com/search?q=%s".to_string(),
        },
        SearchEngine {
            name: "Bing".to_string(),
            url_template: "https://www.bing.com/search?q=%s".to_string(),
        },
        SearchEngine {
            name: "DuckDuckGo".to_string(),
            url_template: "https://duckduckgo.com/?q=%s".to_string(),
        },
    ]
}

impl Default for SearchSettings {
    fn default() -> Self {
        Self {
            default_engine: default_search_engine(),
            custom_engines: default_custom_engines(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct TranslationSettings {
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub api_key: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SecuritySettings {
    #[serde(default = "default_true")]
    pub use_os_keyring: bool,
    #[serde(default = "default_false")]
    pub require_master_password: bool,
    #[serde(default)]
    pub idle_lock_minutes: u32,
    #[serde(default = "default_host_key_policy")]
    pub host_key_policy: String,
}

fn default_host_key_policy() -> String { "prompt".to_string() }

impl Default for SecuritySettings {
    fn default() -> Self {
        Self {
            use_os_keyring: true,
            require_master_password: false,
            idle_lock_minutes: 0,
            host_key_policy: default_host_key_policy(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TerminalSettings {
    #[serde(default = "default_scrollback")]
    pub scrollback_lines: u32,
    #[serde(default = "default_keep_alive")]
    pub keep_alive_interval: u32,
}

fn default_scrollback() -> u32 { 10000 }
fn default_keep_alive() -> u32 { 60 }

impl Default for TerminalSettings {
    fn default() -> Self {
        Self {
            scrollback_lines: default_scrollback(),
            keep_alive_interval: default_keep_alive(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionSettings {
    #[serde(default = "default_true")]
    pub copy_on_select: bool,
    #[serde(default = "default_true")]
    pub right_click_paste: bool,
    #[serde(default = "default_word_separators")]
    pub word_separators: String,
    #[serde(default = "default_encoding")]
    pub default_encoding: String,
}

fn default_word_separators() -> String { " ()[]{}\"'".to_string() }
fn default_encoding() -> String { "UTF-8".to_string() }

impl Default for InteractionSettings {
    fn default() -> Self {
        Self {
            copy_on_select: true,
            right_click_paste: true,
            word_separators: default_word_separators(),
            default_encoding: default_encoding(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    #[serde(default)]
    pub general: GeneralSettings,
    #[serde(default)]
    pub appearance: AppearanceSettings,
    #[serde(default)]
    pub proxy: ProxySettings,
    #[serde(default)]
    pub search: SearchSettings,
    #[serde(default)]
    pub translation: TranslationSettings,
    #[serde(default)]
    pub security: SecuritySettings,
    #[serde(default)]
    pub terminal: TerminalSettings,
    #[serde(default)]
    pub interaction: InteractionSettings,
}

pub fn load_app_settings(app: &AppHandle) -> AppResult<AppSettings> {
    let dir = get_config_dir(app)?;
    load_json(&dir.join("settings.json"))
}

pub fn save_app_settings(app: &AppHandle, config: &AppSettings) -> AppResult<()> {
    let dir = get_config_dir(app)?;
    save_json(&dir.join("settings.json"), config)
}


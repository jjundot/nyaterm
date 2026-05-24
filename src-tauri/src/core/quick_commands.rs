use crate::config::{self, QuickCommand, QuickCommandCategory, QuickCommandsConfig};
use crate::error::AppResult;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

/// In-memory quick-command cache used by both management UI and suggestion search.
pub struct QuickCommandsStore {
    config: RwLock<QuickCommandsConfig>,
}

impl QuickCommandsStore {
    pub fn new() -> Self {
        Self {
            config: RwLock::new(QuickCommandsConfig::default()),
        }
    }

    pub fn load_from_disk(&self, app: &AppHandle) -> AppResult<()> {
        let config = config::load_quick_commands(app)?;
        self.replace(config);
        Ok(())
    }

    pub fn snapshot(&self) -> QuickCommandsConfig {
        self.config.read().unwrap().clone()
    }

    pub fn save_all(&self, app: &AppHandle, config: QuickCommandsConfig) -> AppResult<()> {
        config::save_quick_commands(app, &config)?;
        self.replace(config);
        Ok(())
    }

    pub fn upsert(
        &self,
        app: &AppHandle,
        mut command: QuickCommand,
        new_category: Option<QuickCommandCategory>,
    ) -> AppResult<QuickCommandsConfig> {
        let mut config = self.snapshot();
        let now = now_millis();

        if let Some(category) = new_category {
            if !config.categories.iter().any(|item| item.id == category.id) {
                config.categories.push(category);
            }
        }

        command.updated_at = Some(now);

        if let Some(existing) = config
            .commands
            .iter_mut()
            .find(|item| item.id == command.id)
        {
            let original_created_at = existing.created_at;
            let original_use_count = existing.use_count;
            *existing = command;
            existing.created_at = existing.created_at.or(original_created_at);
            existing.use_count = existing.use_count.or(original_use_count);
        } else {
            command.created_at = command.created_at.or(Some(now));
            config.commands.push(command);
        }

        self.save_all(app, config.clone())?;
        Ok(config)
    }

    pub fn increment_use_count(&self, app: &AppHandle, id: &str) -> AppResult<()> {
        let mut config = self.snapshot();
        if let Some(cmd) = config.commands.iter_mut().find(|c| c.id == id) {
            cmd.use_count = Some(cmd.use_count.unwrap_or(0) + 1);
            cmd.updated_at = Some(now_millis());
            self.save_all(app, config)?;
        }
        Ok(())
    }

    fn replace(&self, config: QuickCommandsConfig) {
        *self.config.write().unwrap() = config;
    }
}

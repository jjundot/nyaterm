use crate::error::AppResult;
use crate::utils::fuzzy::{fuzzy_search_items, FuzzyResult};
use std::collections::HashSet;
use std::fs;
use std::path::PathBuf;

const MAX_HISTORY: usize = 5000;

/// In-memory history store with dedup, persistence, and nucleo-based fuzzy search.
pub struct CommandHistoryStore {
    commands: Vec<String>,
    dedup: HashSet<String>,
    dirty: bool,
    history_path: Option<PathBuf>,
}

impl CommandHistoryStore {
    pub fn new() -> Self {
        Self {
            commands: Vec::new(),
            dedup: HashSet::new(),
            dirty: false,
            history_path: None,
        }
    }

    pub fn set_history_path(&mut self, path: PathBuf) {
        self.history_path = Some(path);
    }

    pub fn load(&mut self) -> AppResult<()> {
        if let Some(path) = &self.history_path {
            if path.exists() {
                let content = fs::read_to_string(path)?;
                let cmds: Vec<String> = serde_json::from_str(&content)?;
                for cmd in cmds {
                    if self.dedup.insert(cmd.clone()) {
                        self.commands.push(cmd);
                    }
                }
            }
        }
        Ok(())
    }

    pub fn save(&mut self) -> AppResult<()> {
        if !self.dirty {
            return Ok(());
        }
        if let Some(path) = &self.history_path {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent)?;
            }
            let content = serde_json::to_string(&self.commands)?;
            fs::write(path, content)?;
            self.dirty = false;
        }
        Ok(())
    }

    pub fn add(&mut self, command: String) {
        let command = command.trim().to_string();
        if command.is_empty() {
            return;
        }

        if self.dedup.contains(&command) {
            self.commands.retain(|c| c != &command);
        } else {
            self.dedup.insert(command.clone());
        }
        self.commands.push(command);

        while self.commands.len() > MAX_HISTORY {
            if let Some(removed) = self.commands.first().cloned() {
                self.commands.remove(0);
                self.dedup.remove(&removed);
            }
        }

        self.dirty = true;
    }

    pub fn search(&self, pattern_str: &str, limit: usize) -> Vec<FuzzyResult> {
        let items: Vec<(String, String)> = self
            .commands
            .iter()
            .map(|c| (c.clone(), c.clone()))
            .collect();
        fuzzy_search_items(&items, pattern_str, "history", limit)
    }
}

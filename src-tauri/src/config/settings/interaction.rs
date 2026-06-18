use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InteractionSettings {
    #[serde(default = "default_true")]
    pub copy_on_select: bool,
    #[serde(default = "default_true")]
    pub right_click_paste: bool,
    #[serde(default = "default_true")]
    pub command_suggestions_enabled: bool,
    #[serde(default = "default_command_suggestion_min_chars")]
    pub command_suggestion_min_chars: usize,
    #[serde(default = "default_command_suggestion_max_chars")]
    pub command_suggestion_max_chars: usize,
    #[serde(default = "default_word_separators")]
    pub word_separators: String,
    #[serde(default = "default_encoding")]
    pub default_encoding: String,
}

fn default_command_suggestion_min_chars() -> usize {
    2
}

fn default_command_suggestion_max_chars() -> usize {
    64
}

fn default_word_separators() -> String {
    " ()[]{}\"':=,;|&<>".to_string()
}
fn default_encoding() -> String {
    "UTF-8".to_string()
}

fn default_true() -> bool {
    true
}

impl Default for InteractionSettings {
    fn default() -> Self {
        Self {
            copy_on_select: true,
            right_click_paste: true,
            command_suggestions_enabled: true,
            command_suggestion_min_chars: default_command_suggestion_min_chars(),
            command_suggestion_max_chars: default_command_suggestion_max_chars(),
            word_separators: default_word_separators(),
            default_encoding: default_encoding(),
        }
    }
}

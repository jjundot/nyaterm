use std::collections::HashSet;

use crate::error::AppResult;

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LocalDropPathEntry {
    path: String,
    is_dir: bool,
}

#[tauri::command]
pub fn quit_application(app: tauri::AppHandle) -> AppResult<()> {
    crate::app::quit_application(&app);
    Ok(())
}

#[tauri::command]
pub fn resolve_local_drop_paths(paths: Vec<String>) -> AppResult<Vec<LocalDropPathEntry>> {
    let mut resolved = Vec::new();
    let mut seen = HashSet::new();

    for raw_path in paths {
        let trimmed = raw_path.trim();
        if trimmed.is_empty() || !seen.insert(trimmed.to_string()) {
            continue;
        }

        let path = std::path::PathBuf::from(trimmed);
        let Ok(metadata) = std::fs::metadata(&path) else {
            continue;
        };

        resolved.push(LocalDropPathEntry {
            path: path.to_string_lossy().to_string(),
            is_dir: metadata.is_dir(),
        });
    }

    Ok(resolved)
}

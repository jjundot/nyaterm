#[cfg(windows)]
mod windows_external_drop;

#[cfg(windows)]
pub use windows_external_drop::install_external_file_drop_bridge;

#[cfg(not(windows))]
pub fn install_external_file_drop_bridge(
    _window: &tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    Ok(())
}

use std::{cell::RefCell, collections::HashMap, io, ptr, sync::mpsc};

use serde::Deserialize;
use tauri::{Emitter, EventTarget, Manager};
use webview2_com::{
    CoTaskMemPWSTR, Microsoft::Web::WebView2::Win32::*, WebMessageReceivedEventHandler,
};
use windows::core::{Interface, PWSTR};

const EXTERNAL_FILE_DROP_EVENT: &str = "external-file-drop";
const EXTERNAL_FILE_DROP_MESSAGE_KIND: &str = "external-file-drop";

thread_local! {
    static WINDOWS_EXTERNAL_DROP_BRIDGES: RefCell<HashMap<String, WindowsExternalDropBridge>> =
        RefCell::new(HashMap::new());
}

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct ExternalFileDropPayload {
    kind: ExternalFileDropKind,
    paths: Vec<String>,
    position: ExternalDropPosition,
}

#[derive(Clone, Copy, serde::Serialize)]
#[serde(rename_all = "lowercase")]
enum ExternalFileDropKind {
    Drop,
}

#[derive(Clone, Copy, Deserialize, serde::Serialize)]
struct ExternalDropPosition {
    x: i32,
    y: i32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExternalFileDropWebMessage {
    kind: String,
    position: ExternalDropPosition,
}

struct WindowsExternalDropBridge {
    webview: ICoreWebView2,
    token: i64,
}

impl Drop for WindowsExternalDropBridge {
    fn drop(&mut self) {
        unsafe {
            let _ = self.webview.remove_WebMessageReceived(self.token);
        }
    }
}

impl WindowsExternalDropBridge {
    fn new(
        controller: ICoreWebView2Controller,
        app_handle: tauri::AppHandle,
        window_label: String,
    ) -> Result<Self, String> {
        let webview = unsafe { controller.CoreWebView2() }.map_err(|error| error.to_string())?;
        let handler = WebMessageReceivedEventHandler::create(Box::new(move |_sender, args| {
            handle_web_message(&app_handle, &window_label, args);
            Ok(())
        }));
        let mut token = 0;

        unsafe {
            webview
                .add_WebMessageReceived(&handler, &mut token)
                .map_err(|error| error.to_string())?;
        }

        Ok(Self { webview, token })
    }
}

pub fn install_external_file_drop_bridge(
    window: &tauri::WebviewWindow,
) -> Result<(), Box<dyn std::error::Error>> {
    // Tauri disables its native drag/drop bridge on Windows when `dragDropEnabled: false`.
    // That keeps HTML5 / React drag-and-drop working, but it also means
    // `getCurrentWebview().onDragDropEvent(...)` is no longer a usable source of Explorer paths.
    //
    // On Windows we bridge external drops through WebView2 web messages instead of replacing the
    // browser's drop target. The frontend posts dropped File/FileSystemHandle objects via
    // `chrome.webview.postMessageWithAdditionalObjects(...)`, and Rust extracts absolute paths from
    // WebView2's native `ICoreWebView2File` / `ICoreWebView2FileSystemHandle` objects.
    let app_handle = window.app_handle().clone();
    let window_label = window.label().to_string();
    let registry_label = window_label.clone();
    let (tx, rx) = mpsc::channel();

    window.with_webview(move |webview| {
        let result =
            WindowsExternalDropBridge::new(webview.controller(), app_handle, window_label.clone())
                .map(|bridge| {
                    WINDOWS_EXTERNAL_DROP_BRIDGES.with(|bridges| {
                        bridges.borrow_mut().insert(window_label.clone(), bridge);
                    });
                });

        let _ = tx.send(result);
    })?;

    match rx.recv() {
        Ok(Ok(())) => {
            tracing::info!(
                "Installed Windows external file drop bridge for webview window '{}'",
                registry_label
            );
            Ok(())
        }
        Ok(Err(message)) => Err(io::Error::other(message).into()),
        Err(_) => Err(io::Error::other(format!(
            "failed to receive Windows external drop bridge status for '{}'",
            registry_label
        ))
        .into()),
    }
}

fn handle_web_message(
    app_handle: &tauri::AppHandle,
    window_label: &str,
    args: Option<ICoreWebView2WebMessageReceivedEventArgs>,
) {
    let Some(args) = args else {
        return;
    };

    let Some(message) = parse_external_drop_message(&args) else {
        return;
    };

    tracing::info!(
        "Windows external file drop bridge received web message at ({}, {})",
        message.position.x,
        message.position.y
    );

    let paths = extract_additional_object_paths(&args);
    if paths.is_empty() {
        tracing::warn!(
            "Windows external file drop bridge received a matching web message but no native paths"
        );
        return;
    }

    tracing::info!(
        "Windows external file drop bridge resolved {} native path(s)",
        paths.len()
    );

    let payload = ExternalFileDropPayload {
        kind: ExternalFileDropKind::Drop,
        paths,
        position: message.position,
    };

    let _ = app_handle.emit_to(
        EventTarget::webview_window(window_label.to_string()),
        EXTERNAL_FILE_DROP_EVENT,
        payload,
    );
}

fn parse_external_drop_message(
    args: &ICoreWebView2WebMessageReceivedEventArgs,
) -> Option<ExternalFileDropWebMessage> {
    if let Some(message) = try_get_web_message_as_string(args) {
        return parse_external_drop_message_text(&message, "TryGetWebMessageAsString");
    }

    let mut raw_message = PWSTR(ptr::null_mut());
    if let Err(error) = unsafe { args.WebMessageAsJson(&mut raw_message) } {
        tracing::warn!(
            "Windows external file drop bridge failed to read WebMessageAsJson payload: {}",
            error
        );
        return None;
    }

    let message = CoTaskMemPWSTR::from(raw_message).to_string();
    parse_external_drop_message_text(&message, "WebMessageAsJson")
}

fn extract_additional_object_paths(args: &ICoreWebView2WebMessageReceivedEventArgs) -> Vec<String> {
    let Ok(args2) = args.cast::<ICoreWebView2WebMessageReceivedEventArgs2>() else {
        tracing::warn!(
            "Windows external file drop bridge could not cast WebMessageReceived args to AdditionalObjects-capable interface"
        );
        return Vec::new();
    };
    let Ok(objects) = (unsafe { args2.AdditionalObjects() }) else {
        tracing::warn!(
            "Windows external file drop bridge could not read additional objects from web message"
        );
        return Vec::new();
    };

    let mut count = 0;
    if unsafe { objects.Count(&mut count) }.is_err() {
        tracing::warn!(
            "Windows external file drop bridge could not determine additional object count"
        );
        return Vec::new();
    }

    let mut paths = Vec::with_capacity(count as usize);

    for index in 0..count {
        let Ok(value) = (unsafe { objects.GetValueAtIndex(index) }) else {
            continue;
        };

        if let Ok(handle) = value.cast::<ICoreWebView2FileSystemHandle>() {
            if let Some(path) = extract_path_from_handle(&handle) {
                paths.push(path);
            }
            continue;
        }

        if let Ok(file) = value.cast::<ICoreWebView2File>() {
            if let Some(path) = extract_path_from_file(&file) {
                paths.push(path);
            }
        }
    }

    paths
}

fn try_get_web_message_as_string(
    args: &ICoreWebView2WebMessageReceivedEventArgs,
) -> Option<String> {
    let mut raw_message = PWSTR(ptr::null_mut());
    unsafe { args.TryGetWebMessageAsString(&mut raw_message) }.ok()?;
    Some(CoTaskMemPWSTR::from(raw_message).to_string())
}

fn parse_external_drop_message_text(
    message: &str,
    source: &str,
) -> Option<ExternalFileDropWebMessage> {
    if let Ok(parsed) = serde_json::from_str::<ExternalFileDropWebMessage>(message) {
        if parsed.kind == EXTERNAL_FILE_DROP_MESSAGE_KIND {
            return Some(parsed);
        }

        return None;
    }

    if let Ok(encoded) = serde_json::from_str::<String>(message) {
        match serde_json::from_str::<ExternalFileDropWebMessage>(&encoded) {
            Ok(parsed) if parsed.kind == EXTERNAL_FILE_DROP_MESSAGE_KIND => {
                return Some(parsed);
            }
            Ok(_) => return None,
            Err(error) => {
                tracing::warn!(
                    "Windows external file drop bridge failed to parse nested {} payload: {}",
                    source,
                    error
                );
                return None;
            }
        }
    }

    tracing::warn!(
        "Windows external file drop bridge ignored unparsable {} payload ({} bytes)",
        source,
        message.len()
    );
    None
}

fn extract_path_from_handle(handle: &ICoreWebView2FileSystemHandle) -> Option<String> {
    let mut path = PWSTR(ptr::null_mut());
    unsafe {
        handle.Path(&mut path).ok()?;
    }

    let path = CoTaskMemPWSTR::from(path).to_string();
    if path.trim().is_empty() {
        return None;
    }

    Some(path)
}

fn extract_path_from_file(file: &ICoreWebView2File) -> Option<String> {
    let mut path = PWSTR(ptr::null_mut());
    unsafe {
        file.Path(&mut path).ok()?;
    }

    let path = CoTaskMemPWSTR::from(path).to_string();
    if path.trim().is_empty() {
        return None;
    }

    Some(path)
}

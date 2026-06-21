mod pty;
mod logtail;
mod cost;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Apply a macOS vibrancy material behind the window live (requires the
/// `macos-private-api` feature). `"none"` clears vibrancy so the transparent
/// background shows through.
#[tauri::command]
fn set_window_effect(window: tauri::WebviewWindow, material: String) -> Result<(), String> {
    use tauri::window::{Effect, EffectsBuilder};
    let effect = match material.as_str() {
        "hudWindow" => Some(Effect::HudWindow),
        "fullScreenUI" => Some(Effect::FullScreenUI),
        "sidebar" => Some(Effect::Sidebar),
        "underWindowBackground" => Some(Effect::UnderWindowBackground),
        "none" => None,
        _ => return Err(format!("unknown material: {material}")),
    };
    let effects = match effect {
        Some(e) => EffectsBuilder::new().effect(e).build(),
        None => EffectsBuilder::new().build(), // clear → no vibrancy, transparent bg shows
    };
    window.set_effects(effects).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyManager::default())
        .manage(logtail::LogtailManager::default())
        .manage(cost::CostManager::default())
        .manage(cost::CostReportManager::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_window_effect,
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
            pty::pty_kill,
            logtail::logtail_start,
            logtail::logtail_stop,
            logtail::pane_topic,
            logtail::session_exists,
            cost::session_usage,
            cost::cost_report,
            cost::list_projects,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

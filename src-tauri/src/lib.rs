mod pty;
mod logtail;
mod cost;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
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

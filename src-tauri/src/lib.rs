mod pty;
mod logtail;
mod cost;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Continuous Ghostty-style background blur via the private CoreGraphics
/// `CGSSetWindowBackgroundBlurRadius` API. `radius = 0` clears the blur so the
/// transparent window shows the desktop through unmodified.
#[cfg(target_os = "macos")]
mod macos_blur {
    use objc2::msg_send;
    use objc2::runtime::AnyObject;

    type CGSConnectionID = i32;
    type CGWindowID = u32;

    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn CGSDefaultConnectionForThread() -> CGSConnectionID;
        fn CGSSetWindowBackgroundBlurRadius(
            connection: CGSConnectionID,
            window: CGWindowID,
            radius: i32,
        ) -> i32;
    }

    pub fn set_blur(ns_window: *mut std::ffi::c_void, radius: i32) {
        if ns_window.is_null() {
            return;
        }
        unsafe {
            let win = ns_window as *mut AnyObject;
            let window_number: isize = msg_send![&*win, windowNumber];
            let conn = CGSDefaultConnectionForThread();
            CGSSetWindowBackgroundBlurRadius(conn, window_number as CGWindowID, radius);
        }
    }
}

#[tauri::command]
fn set_window_blur(window: tauri::WebviewWindow, radius: u32) -> Result<(), String> {
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            #[cfg(target_os = "macos")]
            if let Ok(ns) = w.ns_window() {
                macos_blur::set_blur(ns, radius as i32);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (&w, radius);
            }
        })
        .map_err(|e| e.to_string())
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
            set_window_blur,
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

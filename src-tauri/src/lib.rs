mod pty;
mod logtail;
mod cost;
mod usage;
mod dropfile;
mod headroom;
mod headroomlog;
mod ponytail;
mod handoff;

use tauri::{Emitter, Manager};

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

/// Jump back to the main window and emit a cockpit://jump event with the given session ID.
#[tauri::command]
fn beacon_jump(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    app.emit("cockpit://jump", session_id).map_err(|e| e.to_string())
}

/// Show or hide the floating beacon window.
#[tauri::command]
fn set_beacon_visible(app: tauri::AppHandle, visible: bool) {
    if let Some(w) = app.get_webview_window("beacon") {
        let _ = if visible { w.show() } else { w.hide() };
    }
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
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(pty::PtyManager::default())
        .manage(logtail::LogtailManager::default())
        .manage(cost::CostManager::default())
        .manage(cost::CostReportManager::default())
        .manage(headroom::HeadroomManager::default())
        .manage(headroomlog::HeadroomLogManager::default())
        .invoke_handler(tauri::generate_handler![
            greet,
            set_window_blur,
            beacon_jump,
            set_beacon_visible,
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
            usage::usage_report,
            dropfile::save_dropped_file,
            headroom::headroom_ensure,
            headroom::headroom_status,
            headroomlog::headroom_log_start,
            headroomlog::headroom_log_stop,
            ponytail::ponytail_installed,
            handoff::create_codex_handoff,
        ])
        .setup(|app| {
            use tauri::{WebviewWindowBuilder, WebviewUrl, WindowEvent};
            let b = WebviewWindowBuilder::new(app, "beacon", WebviewUrl::App("beacon.html".into()))
                .title("")
                .inner_size(230.0, 64.0)
                .decorations(false)
                .transparent(true)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .shadow(false)
                .visible(false);
            // Standalone window (NOT a child of main): a child follows its parent's moves on
            // macOS, so it could never be dragged independently. App lifecycle is handled by the
            // CloseRequested -> exit(0) hook below, which also tears the beacon down with main.
            let beacon = b.build()?;
            let _ = beacon.set_visible_on_all_workspaces(true);
            // Center on the primary monitor on first run. The user can drag it anywhere;
            // the dragged position is remembered across launches (saved by the webview).
            if let Ok(Some(mon)) = beacon.primary_monitor() {
                let sz = mon.size();
                let pos = mon.position();
                let scale = mon.scale_factor();
                let bw = (230.0 * scale) as i32;
                let bh = (64.0 * scale) as i32;
                let _ = beacon.set_position(tauri::PhysicalPosition::new(
                    pos.x + (sz.width as i32 - bw) / 2,
                    pos.y + (sz.height as i32 - bh) / 2,
                ));
            }
            // Lifecycle B: closing the main Cockpit window quits the whole app (beacon
            // included). macOS otherwise keeps a windowless app alive, so make it explicit.
            if let Some(main) = app.get_webview_window("main") {
                let handle = app.handle().clone();
                main.on_window_event(move |e| {
                    if matches!(e, WindowEvent::CloseRequested { .. }) {
                        handle.exit(0);
                    }
                });
            }
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");
    app.run(|app_handle, event| {
        if let tauri::RunEvent::Exit = event {
            headroom::shutdown(app_handle);
        }
    });
}

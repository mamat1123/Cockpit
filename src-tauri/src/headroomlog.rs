use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct HeadroomLogManager(pub Mutex<Option<Arc<AtomicBool>>>);

fn log_path() -> Option<PathBuf> {
    std::env::var_os("HOME")
        .map(|h| PathBuf::from(h).join(".headroom/logs/cockpit-proxy.jsonl"))
}

/// Tail the proxy log from its CURRENT end, emitting each new line on `headroom://log`.
/// Idempotent: a second call stops the previous tailer first.
#[tauri::command]
pub fn headroom_log_start(app: AppHandle, mgr: State<HeadroomLogManager>) -> Result<(), String> {
    if let Some(prev) = mgr.0.lock().unwrap().take() {
        prev.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    *mgr.0.lock().unwrap() = Some(stop.clone());
    let path = log_path().ok_or("no HOME dir")?;

    std::thread::spawn(move || {
        // Start at the current end so we only attribute requests from this session on.
        let mut offset: u64 = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
        while !stop.load(Ordering::Relaxed) {
            if let Ok(meta) = std::fs::metadata(&path) {
                let len = meta.len();
                // The proxy may rotate/recreate the file (len shrinks) — reset to its start.
                if len < offset {
                    offset = 0;
                }
                if len > offset {
                    if let Ok(mut f) = std::fs::File::open(&path) {
                        let _ = f.seek(SeekFrom::Start(offset));
                        for line in BufReader::new(&mut f).lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                let _ = app.emit("headroom://log", line);
                            }
                        }
                        offset = len;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(400));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn headroom_log_stop(mgr: State<HeadroomLogManager>) {
    if let Some(stop) = mgr.0.lock().unwrap().take() {
        stop.store(true, Ordering::Relaxed);
    }
}

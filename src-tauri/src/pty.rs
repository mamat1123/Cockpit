/// Validate that a spawn cwd exists and is a directory.
/// Returns the canonicalized path string, or an error message.
pub fn validate_cwd(path: &str) -> Result<String, String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(format!("cwd does not exist: {path}"));
    }
    if !p.is_dir() {
        return Err(format!("cwd is not a directory: {path}"));
    }
    p.canonicalize()
        .map(|c| c.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot canonicalize {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_dir() {
        let r = validate_cwd("/no/such/dir/xyz123");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn accepts_temp_dir() {
        let tmp = std::env::temp_dir();
        let r = validate_cwd(tmp.to_str().unwrap());
        assert!(r.is_ok());
    }
}

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    // keep child alive; killing it on drop is handled by portable-pty
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager(pub Mutex<HashMap<String, PtySession>>);

/// Event channel a pane listens on for its output bytes.
pub fn output_event(pane_id: &str) -> String {
    format!("pty://output/{pane_id}")
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<PtyManager>,
    pane_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cwd = validate_cwd(&cwd)?;
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&cwd);
    // inherit the user's env so ~/.claude config / PATH / hooks all apply
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // blocking reader thread -> emit output bytes (lossy UTF-8) to the webview
    let app2 = app.clone();
    let evt = output_event(&pane_id);
    let exit_evt = format!("pty://exit/{pane_id}");
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,                  // EOF: claude exited
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app2.emit(&evt, chunk);
                }
                Err(_) => break,
            }
        }
        let _ = app2.emit(&exit_evt, ());
    });

    mgr.0.lock().unwrap().insert(
        pane_id,
        PtySession { master: pair.master, writer, _child: child },
    );
    Ok(())
}

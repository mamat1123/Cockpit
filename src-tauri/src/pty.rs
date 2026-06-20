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
    launch: Option<String>,
) -> Result<(), String> {
    // Idempotent: a pane that re-mounts must NOT respawn (would kill its session).
    if mgr.0.lock().unwrap().contains_key(&pane_id) {
        return Ok(());
    }
    let cwd = validate_cwd(&cwd)?;
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    // Spawn the user's interactive login shell, NOT `claude` directly. A GUI app's
    // PATH doesn't include nvm/homebrew, and the user's `claude` is a zsh function —
    // so `CommandBuilder::new("claude")` would fail to resolve. An interactive login
    // shell (`-il`) sources the user's profile (full PATH, functions, aliases), making
    // the pane a real terminal in which `claude` (and anything else) resolves correctly.
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
    let mut cmd = CommandBuilder::new(&shell);
    cmd.arg("-il");
    cmd.cwd(&cwd);
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // blocking reader thread -> emit output to the webview.
    // Accumulate bytes and only emit the longest VALID UTF-8 prefix, holding any
    // trailing partial multibyte sequence for the next read. Raw 8 KiB reads can
    // split a multibyte char (e.g. Thai = 3 bytes) across a boundary; decoding each
    // chunk independently would corrupt it with replacement chars.
    let app2 = app.clone();
    let evt = output_event(&pane_id);
    let exit_evt = format!("pty://exit/{pane_id}");
    std::thread::spawn(move || {
        let mut carry: Vec<u8> = Vec::new();
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF: claude exited
                Ok(n) => {
                    carry.extend_from_slice(&buf[..n]);
                    let valid_up_to = match std::str::from_utf8(&carry) {
                        Ok(_) => carry.len(),
                        Err(e) => e.valid_up_to(),
                    };
                    // If nothing is valid yet but we already have >=4 bytes, the first
                    // byte is genuinely invalid (no UTF-8 char exceeds 4 bytes) — flush
                    // it lossily so carry can't grow unbounded on a binary stream.
                    let emit_to = if valid_up_to == 0 && carry.len() >= 4 { carry.len() } else { valid_up_to };
                    if emit_to > 0 {
                        let chunk = String::from_utf8_lossy(&carry[..emit_to]).into_owned();
                        let _ = app2.emit(&evt, chunk);
                        carry.drain(..emit_to);
                    }
                }
                Err(_) => break,
            }
        }
        if !carry.is_empty() {
            let _ = app2.emit(&evt, String::from_utf8_lossy(&carry).into_owned());
        }
        let _ = app2.emit(&exit_evt, ());
    });

    // Auto-run the pane's claude session (or any launch command). Written to the PTY's
    // stdin so the user's login-shell `claude` function + PATH resolve normally.
    let mut writer = writer;
    if let Some(cmd) = launch {
        let _ = writer.write_all(format!("{cmd}\r").as_bytes());
        let _ = writer.flush();
    }

    mgr.0.lock().unwrap().insert(
        pane_id,
        PtySession { master: pair.master, writer, _child: child },
    );
    Ok(())
}

#[tauri::command]
pub fn pty_write(mgr: State<PtyManager>, pane_id: String, data: String) -> Result<(), String> {
    let mut map = mgr.0.lock().unwrap();
    let s = map.get_mut(&pane_id).ok_or("no such pane")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(mgr: State<PtyManager>, pane_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = mgr.0.lock().unwrap();
    let s = map.get(&pane_id).ok_or("no such pane")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_kill(mgr: State<PtyManager>, pane_id: String) {
    // Dropping the PtySession drops its child -> portable-pty kills the process.
    mgr.0.lock().unwrap().remove(&pane_id);
}

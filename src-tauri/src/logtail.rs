use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

/// Claude Code stores a session under ~/.claude/projects/<encoded>/, where <encoded>
/// is the absolute cwd with path separators turned into '-'. Verified against real dirs
/// (e.g. /Users/x/Work/mee-tang -> -Users-x-Work-mee-tang). Dots are also encoded to '-'
/// by Claude Code; we replicate that (no dotted-path sample exists locally, so the spike
/// in Task 2 confirms it against a live `claude` run before relying on it).
pub fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

/// Directory that holds this cwd's session logs.
pub fn project_log_dir(home: &Path, cwd: &str) -> PathBuf {
    home.join(".claude").join("projects").join(encode_project_dir(cwd))
}

/// Newest *.jsonl in `dir` by mtime, or None if the dir is missing/empty.
pub fn newest_session_file(dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let m = entry.metadata().ok().and_then(|m| m.modified().ok());
        if let Some(t) = m {
            if newest.as_ref().map_or(true, |(bt, _)| t > *bt) {
                newest = Some((t, p));
            }
        }
    }
    newest.map(|(_, p)| p)
}

#[derive(Default)]
pub struct LogtailManager(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

pub fn log_event(pane_id: &str) -> String {
    format!("pane://log/{pane_id}")
}

#[tauri::command]
pub fn logtail_start(
    app: AppHandle,
    mgr: State<LogtailManager>,
    pane_id: String,
    cwd: String,
) -> Result<(), String> {
    // restart-safe: stop any existing tail for this pane first (inlined)
    if let Some(prev) = mgr.0.lock().unwrap().remove(&pane_id) {
        prev.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    mgr.0.lock().unwrap().insert(pane_id.clone(), stop.clone());

    let home = dirs_home().ok_or("no home dir")?;
    let dir = project_log_dir(&home, &cwd);
    let evt = log_event(&pane_id);

    std::thread::spawn(move || {
        let mut current: Option<PathBuf> = None;
        let mut offset: u64 = 0;
        while !stop.load(Ordering::Relaxed) {
            let newest = newest_session_file(&dir);
            if newest != current {
                current = newest.clone();
                // Start at EOF: only emit lines appended after we attach, so opening a
                // pane with a pre-existing session log doesn't replay old lines (which
                // would falsely show "working"). Activity = growth from now on.
                offset = current
                    .as_ref()
                    .and_then(|p| std::fs::metadata(p).ok())
                    .map(|m| m.len())
                    .unwrap_or(0);
            }
            if let Some(path) = &current {
                if let Ok(mut f) = std::fs::File::open(path) {
                    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                    if len > offset {
                        let _ = f.seek(SeekFrom::Start(offset));
                        let reader = BufReader::new(&mut f);
                        for line in reader.lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                let _ = app.emit(&evt, line);
                            }
                        }
                        offset = len;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });
    Ok(())
}

#[tauri::command]
pub fn logtail_stop(mgr: State<LogtailManager>, pane_id: String) {
    if let Some(stop) = mgr.0.lock().unwrap().remove(&pane_id) {
        stop.store(true, Ordering::Relaxed);
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_slashes_to_dashes() {
        assert_eq!(
            encode_project_dir("/Users/theerametsaengsin/Work/mee-tang"),
            "-Users-theerametsaengsin-Work-mee-tang"
        );
    }

    #[test]
    fn newest_picks_latest_mtime() {
        let dir = std::env::temp_dir().join(format!("cockpit-m2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.jsonl"), "{}").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("b.jsonl"), "{}").unwrap();
        std::fs::write(dir.join("ignore.txt"), "x").unwrap();
        let got = newest_session_file(&dir).unwrap();
        assert_eq!(got.file_name().unwrap().to_str().unwrap(), "b.jsonl");
        std::fs::remove_dir_all(&dir).ok();
    }
}

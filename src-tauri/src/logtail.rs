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

/// Exact log file for a known claude session under a cwd.
pub fn session_log_path(home: &Path, cwd: &str, session_id: &str) -> PathBuf {
    project_log_dir(home, cwd).join(format!("{session_id}.jsonl"))
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

/// Collapse whitespace to single spaces and cap at 60 chars (… suffix if cut).
fn truncate_topic(s: &str) -> String {
    let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
    let max = 60;
    if one_line.chars().count() <= max {
        one_line
    } else {
        let mut out: String = one_line.chars().take(max).collect();
        out.push('…');
        out
    }
}

/// First natural-language user message in a session log, or None.
/// Skips `<…>` command-wrappers, tool_results, and blanks.
pub fn first_user_topic(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let v: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };
        if v.get("type").and_then(|t| t.as_str()) != Some("user") {
            continue;
        }
        let content = v.get("message").and_then(|m| m.get("content"));
        let text = match content {
            Some(serde_json::Value::String(s)) => Some(s.clone()),
            Some(serde_json::Value::Array(arr)) => arr.iter().find_map(|b| {
                if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                    b.get("text").and_then(|t| t.as_str()).map(str::to_string)
                } else {
                    None
                }
            }),
            _ => None,
        };
        if let Some(t) = text {
            let t = t.trim();
            if t.is_empty() || t.starts_with('<') {
                continue;
            }
            return Some(truncate_topic(t));
        }
    }
    None
}

#[tauri::command]
pub fn pane_topic(cwd: String, session_id: String) -> Option<String> {
    let home = dirs_home()?;
    first_user_topic(&session_log_path(&home, &cwd, &session_id))
}

/// True if the pane's own session log exists and is non-empty (i.e. resumable).
#[tauri::command]
pub fn session_exists(cwd: String, session_id: String) -> bool {
    let home = match dirs_home() { Some(h) => h, None => return false };
    let path = session_log_path(&home, &cwd, &session_id);
    std::fs::metadata(&path).map(|m| m.len() > 0).unwrap_or(false)
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
    session_id: String,
) -> Result<(), String> {
    if let Some(prev) = mgr.0.lock().unwrap().remove(&pane_id) {
        prev.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    mgr.0.lock().unwrap().insert(pane_id.clone(), stop.clone());

    let home = dirs_home().ok_or("no home dir")?;
    let path = session_log_path(&home, &cwd, &session_id);
    let evt = log_event(&pane_id);

    std::thread::spawn(move || {
        // Our own fresh session: the file is created by `claude --session-id <id>` and
        // starts empty, so tail from the start (offset 0) once it appears.
        let mut offset: u64 = 0;
        let mut seen = false;
        while !stop.load(Ordering::Relaxed) {
            if let Ok(meta) = std::fs::metadata(&path) {
                if !seen {
                    seen = true;
                    offset = 0;
                }
                let len = meta.len();
                if len > offset {
                    if let Ok(mut f) = std::fs::File::open(&path) {
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

    #[test]
    fn first_user_topic_skips_wrappers_and_collapses_ws() {
        let dir = std::env::temp_dir().join(format!("cockpit-topic-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let content = concat!(
            "{\"type\":\"summary\",\"summary\":\"ignore me\"}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":[{\"type\":\"text\",\"text\":\"<local-command-caveat>skip\"}]}}\n",
            "{\"type\":\"user\",\"message\":{\"role\":\"user\",\"content\":\"  Fix the   crypto\\n pricing bug  \"}}\n"
        );
        std::fs::write(&path, content).unwrap();
        assert_eq!(first_user_topic(&path).as_deref(), Some("Fix the crypto pricing bug"));
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn first_user_topic_truncates_long_text() {
        let dir = std::env::temp_dir().join(format!("cockpit-topic2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let long = "a ".repeat(80);
        std::fs::write(&path, format!("{{\"type\":\"user\",\"message\":{{\"role\":\"user\",\"content\":\"{}\"}}}}\n", long)).unwrap();
        let got = first_user_topic(&path).unwrap();
        assert!(got.ends_with('…'));
        assert_eq!(got.chars().count(), 61);
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn session_log_path_builds_the_uuid_file() {
        let p = session_log_path(
            std::path::Path::new("/home/u"),
            "/Users/x/Work/app",
            "abc-123",
        );
        assert_eq!(
            p,
            std::path::Path::new("/home/u/.claude/projects/-Users-x-Work-app/abc-123.jsonl")
        );
    }

    #[test]
    fn session_exists_helper_path_logic() {
        // session_log_path builds the file; existence is just metadata — sanity-check the path joins.
        let p = session_log_path(std::path::Path::new("/h"), "/c", "id1");
        assert!(p.ends_with("id1.jsonl"));
    }
}

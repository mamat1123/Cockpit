use std::path::{Path, PathBuf};

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

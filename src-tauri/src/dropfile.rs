use std::io::Write;
use base64::{engine::general_purpose::STANDARD, Engine};

/// Reduce a dropped file's name to a safe basename containing only
/// `[A-Za-z0-9._-]` — every other char (path separators, spaces, shell
/// metacharacters) becomes `_`, and leading/trailing dots are trimmed. This
/// guarantees a single path component with no spaces, so the resulting temp
/// path can be typed into the PTY unquoted.
pub fn sanitize_filename(name: &str) -> String {
    let base = std::path::Path::new(name)
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("dropped");
    let cleaned: String = base
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-') { c } else { '_' })
        .collect();
    let cleaned = cleaned.trim_matches('.').to_string();
    if cleaned.is_empty() { "dropped".to_string() } else { cleaned }
}

/// Persist a file dragged onto a pane to a temp dir and return its absolute
/// path. The bytes arrive base64-encoded because a Tauri WKWebView never
/// exposes the original filesystem path of an HTML5-dropped file (`File.path`
/// is empty, unlike Electron) — so we ship the bytes from the webview and
/// re-materialize them here. The frontend then types the returned path into
/// claude, exactly as a native terminal does on a Finder drop.
#[tauri::command]
pub fn save_dropped_file(name: String, data_b64: String) -> Result<String, String> {
    let bytes = STANDARD
        .decode(data_b64.as_bytes())
        .map_err(|e| format!("bad base64: {e}"))?;
    let dir = std::env::temp_dir().join("cockpit-drops");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let path = dir.join(format!("{millis}-{}", sanitize_filename(&name)));
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    f.write_all(&bytes).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_path_separators_and_spaces() {
        assert_eq!(sanitize_filename("../../etc/pa ss wd"), "pa_ss_wd");
        assert_eq!(sanitize_filename("Screenshot 2026.png"), "Screenshot_2026.png");
        assert_eq!(sanitize_filename("a/b/c.PNG"), "c.PNG");
    }

    #[test]
    fn empty_or_dotted_falls_back() {
        assert_eq!(sanitize_filename(""), "dropped");
        assert_eq!(sanitize_filename("..."), "dropped");
        assert_eq!(sanitize_filename(".hidden"), "hidden");
    }

    #[test]
    fn save_round_trips_bytes_to_temp() {
        let b64 = STANDARD.encode([1u8, 2, 3, 4, 255]);
        let p = save_dropped_file("snap.png".into(), b64).unwrap();
        assert!(p.contains("cockpit-drops"));
        assert!(p.ends_with("-snap.png"));
        assert!(!p.contains(' '));
        assert_eq!(std::fs::read(&p).unwrap(), vec![1, 2, 3, 4, 255]);
        let _ = std::fs::remove_file(&p);
    }

    #[test]
    fn rejects_bad_base64() {
        assert!(save_dropped_file("x.png".into(), "not base64!!!".into()).is_err());
    }
}

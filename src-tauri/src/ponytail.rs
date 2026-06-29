use std::fs;
use std::path::PathBuf;

/// Path to Claude Code's installed-plugins manifest, honoring CLAUDE_CONFIG_DIR.
fn installed_plugins_path() -> Option<PathBuf> {
    let base = match std::env::var("CLAUDE_CONFIG_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d),
        _ => PathBuf::from(std::env::var("HOME").ok()?).join(".claude"),
    };
    Some(base.join("plugins").join("installed_plugins.json"))
}

/// True if the manifest lists any plugin keyed `ponytail` or `ponytail@<marketplace>`.
/// installed_plugins.json shape: { "version": int, "plugins": { "<plugin>@<mkt>": [...] } }.
fn has_ponytail(json: &str) -> bool {
    let v: serde_json::Value = match serde_json::from_str(json) {
        Ok(v) => v,
        Err(_) => return false,
    };
    match v.get("plugins").and_then(|p| p.as_object()) {
        Some(map) => map
            .keys()
            .any(|k| k == "ponytail" || k.starts_with("ponytail@")),
        None => false,
    }
}

/// Whether the ponytail Claude Code plugin is installed.
#[tauri::command]
pub fn ponytail_installed() -> bool {
    installed_plugins_path()
        .and_then(|p| fs::read_to_string(p).ok())
        .map(|s| has_ponytail(&s))
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::has_ponytail;

    #[test]
    fn detects_installed_ponytail() {
        let json = r#"{"version":1,"plugins":{"ponytail@ponytail":[{}],"superpowers@superpowers-dev":[{}]}}"#;
        assert!(has_ponytail(json));
    }
    #[test]
    fn absent_when_not_listed() {
        let json = r#"{"version":1,"plugins":{"superpowers@superpowers-dev":[{}]}}"#;
        assert!(!has_ponytail(json));
    }
    #[test]
    fn false_on_garbage() {
        assert!(!has_ponytail("not json"));
    }
}

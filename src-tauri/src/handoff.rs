use serde::Serialize;
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const MAX_BLOCK_CHARS: usize = 2_000;
const MAX_TRANSCRIPT_CHARS: usize = 36_000;
const MAX_GIT_CHARS: usize = 8_000;

#[derive(Serialize)]
pub struct CodexHandoff {
    prompt_path: String,
    title: Option<String>,
    cwd: String,
    source_session_id: String,
    excerpt_count: usize,
    omitted_count: usize,
}

#[tauri::command]
pub fn create_codex_handoff(cwd: String, session_id: String) -> Result<CodexHandoff, String> {
    let home = dirs_home().ok_or("no home dir")?;
    let path = crate::logtail::session_log_path(&home, &cwd, &session_id);
    if !path.exists() {
        return Err(format!("Claude session log not found: {}", path.display()));
    }

    let entries = transcript_entries(&path)?;
    if entries.is_empty() {
        return Err("Claude session log has no readable transcript entries".to_string());
    }
    let title = crate::logtail::first_user_topic(&path);
    let selected = select_entries(&entries, MAX_TRANSCRIPT_CHARS);
    let omitted = entries.len().saturating_sub(selected.len());
    let git = git_snapshot(&cwd);
    let prompt = render_prompt(&cwd, &session_id, &selected, omitted, &git);
    let prompt_path = write_prompt(&session_id, &prompt)?;

    Ok(CodexHandoff {
        prompt_path: prompt_path.to_string_lossy().into_owned(),
        title,
        cwd,
        source_session_id: session_id,
        excerpt_count: selected.len(),
        omitted_count: omitted,
    })
}

fn transcript_entries(path: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        let Some(entry) = transcript_entry(&line) else { continue };
        out.push(entry);
    }
    Ok(out)
}

fn transcript_entry(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    let ty = v.get("type").and_then(|t| t.as_str())?;
    match ty {
        "summary" => v
            .get("summary")
            .and_then(|s| s.as_str())
            .map(|s| format!("[summary]\n{}", cap(s, MAX_BLOCK_CHARS))),
        "user" | "assistant" => {
            let role = v
                .get("message")
                .and_then(|m| m.get("role"))
                .and_then(|r| r.as_str())
                .unwrap_or(ty);
            let content = v.get("message").and_then(|m| m.get("content"))?;
            let text = content_text(content);
            if text.trim().is_empty() {
                None
            } else {
                Some(format!("[{role}]\n{}", cap(text.trim(), MAX_BLOCK_CHARS)))
            }
        }
        _ => None,
    }
}

fn content_text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Array(items) => items
            .iter()
            .filter_map(block_text)
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

fn block_text(v: &Value) -> Option<String> {
    let ty = v.get("type").and_then(|t| t.as_str())?;
    match ty {
        "text" => v.get("text").and_then(|t| t.as_str()).map(str::to_string),
        "tool_use" => {
            let name = v.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
            let input = v.get("input").map(|i| cap(&i.to_string(), 600)).unwrap_or_default();
            Some(format!("[tool_use: {name}] {input}"))
        }
        "tool_result" => {
            let content = v.get("content").map(content_text).unwrap_or_default();
            Some(format!("[tool_result] {}", cap(&content, 900)))
        }
        "image" | "image_url" => Some("[image]".to_string()),
        _ => None,
    }
}

fn select_entries(entries: &[String], max_chars: usize) -> Vec<String> {
    let mut selected = Vec::new();
    let mut chars = 0;
    for entry in entries.iter().rev() {
        let len = entry.chars().count() + 2;
        if chars + len > max_chars && !selected.is_empty() {
            break;
        }
        selected.push(entry.clone());
        chars += len;
    }
    selected.reverse();
    selected
}

fn git_snapshot(cwd: &str) -> String {
    let status = run_git(cwd, &["status", "--short"]);
    let branch = run_git(cwd, &["branch", "--show-current"]);
    let diff_stat = run_git(cwd, &["diff", "--stat"]);
    cap(
        &format!(
            "branch:\n{}\n\nstatus --short:\n{}\n\ndiff --stat:\n{}",
            branch.trim(),
            status.trim(),
            diff_stat.trim()
        ),
        MAX_GIT_CHARS,
    )
}

fn run_git(cwd: &str, args: &[&str]) -> String {
    let output = std::process::Command::new("git").args(args).current_dir(cwd).output();
    match output {
        Ok(out) if out.status.success() => String::from_utf8_lossy(&out.stdout).into_owned(),
        Ok(out) => String::from_utf8_lossy(&out.stderr).into_owned(),
        Err(e) => format!("git unavailable: {e}"),
    }
}

fn render_prompt(cwd: &str, session_id: &str, entries: &[String], omitted: usize, git: &str) -> String {
    let omitted_note = if omitted > 0 {
        format!("Older transcript entries omitted by Cockpit for context budget: {omitted}\n")
    } else {
        String::new()
    };
    format!(
        r#"You are Codex continuing work from a Claude Code session imported by Cockpit.

Source Claude session: {session_id}
Working directory: {cwd}

Use this as handoff context, then inspect the repository before editing. Do not assume the transcript is complete; verify the current filesystem and git state.

Current git snapshot:
```text
{git}
```

{omitted_note}Recent Claude transcript excerpt:
```text
{}
```

Continue from here. First briefly restate the concrete next step you infer, then proceed."#,
        entries.join("\n\n")
    )
}

fn write_prompt(session_id: &str, prompt: &str) -> Result<PathBuf, String> {
    let short: String = session_id.chars().take(8).collect();
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = std::env::temp_dir().join(format!("cockpit-codex-handoff-{short}-{millis}.md"));
    std::fs::write(&path, prompt).map_err(|e| e.to_string())?;
    Ok(path)
}

fn cap(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let mut out: String = s.chars().take(max_chars).collect();
    out.push_str("\n[truncated]");
    out
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn extracts_text_and_tool_blocks() {
        let line = r#"{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Done"},{"type":"tool_use","name":"Edit","input":{"file_path":"a.ts"}}]}}"#;
        let got = transcript_entry(line).unwrap();
        assert!(got.contains("[assistant]"));
        assert!(got.contains("Done"));
        assert!(got.contains("[tool_use: Edit]"));
    }

    #[test]
    fn selects_recent_entries_under_budget() {
        let entries = vec!["a".repeat(10), "b".repeat(10), "c".repeat(10)];
        let got = select_entries(&entries, 25);
        assert_eq!(got, vec!["b".repeat(10), "c".repeat(10)]);
    }
}

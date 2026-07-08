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

#[derive(Serialize)]
pub struct ClaudeHandoff {
    prompt_path: String,
    title: Option<String>,
    cwd: String,
    excerpt_count: usize,
    omitted_count: usize,
}

#[tauri::command]
pub fn create_codex_handoff(cwd: String, session_id: String) -> Result<CodexHandoff, String> {
    let home = dirs_home().ok_or("no home dir")?;
    let (source_session_id, path) = crate::logtail::resolve_current_session_log(&home, &cwd, &session_id, true)
        .unwrap_or_else(|| (session_id.clone(), crate::logtail::session_log_path(&home, &cwd, &session_id)));
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
    let prompt = render_prompt(&cwd, &source_session_id, &selected, omitted, &git);
    let prompt_path = write_prompt("codex", &source_session_id, &prompt)?;

    Ok(CodexHandoff {
        prompt_path: prompt_path.to_string_lossy().into_owned(),
        title,
        cwd,
        source_session_id,
        excerpt_count: selected.len(),
        omitted_count: omitted,
    })
}

/// Codex CLI assigns its own session id internally (Cockpit never sees or sets it),
/// so unlike the Claude->Codex direction we can't look a rollout log up by id. Instead
/// we find the most recently modified rollout under ~/.codex/sessions whose recorded
/// cwd matches — good enough as long as you hand off from the Codex pane you were just
/// using for that directory (the common case; a stale sibling pane in the same cwd
/// could in principle shadow it, but that's a narrow edge case).
#[tauri::command]
pub fn create_claude_handoff(cwd: String) -> Result<ClaudeHandoff, String> {
    let home = dirs_home().ok_or("no home dir")?;
    let sessions_root = home.join(".codex").join("sessions");
    let path = find_codex_rollout(&sessions_root, &cwd)
        .ok_or_else(|| format!("No Codex session found for {cwd}"))?;

    let entries = codex_transcript_entries(&path)?;
    if entries.is_empty() {
        return Err("Codex session log has no readable transcript entries".to_string());
    }
    let title = codex_first_topic(&entries);
    let selected = select_entries(&entries, MAX_TRANSCRIPT_CHARS);
    let omitted = entries.len().saturating_sub(selected.len());
    let git = git_snapshot(&cwd);
    let prompt = render_reverse_prompt(&cwd, &selected, omitted, &git);
    let tag = cwd.rsplit('/').find(|s| !s.is_empty()).unwrap_or("project");
    let prompt_path = write_prompt("claude", tag, &prompt)?;

    Ok(ClaudeHandoff {
        prompt_path: prompt_path.to_string_lossy().into_owned(),
        title,
        cwd,
        excerpt_count: selected.len(),
        omitted_count: omitted,
    })
}

fn find_codex_rollout(sessions_root: &Path, cwd: &str) -> Option<PathBuf> {
    let mut files = Vec::new();
    collect_jsonl(sessions_root, 0, &mut files);
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for path in files {
        if rollout_cwd(&path).as_deref() != Some(cwd) {
            continue;
        }
        let Ok(modified) = std::fs::metadata(&path).and_then(|m| m.modified()) else { continue };
        if newest.as_ref().map_or(true, |(t, _)| modified > *t) {
            newest = Some((modified, path));
        }
    }
    newest.map(|(_, p)| p)
}

fn collect_jsonl(dir: &Path, depth: u8, out: &mut Vec<PathBuf>) {
    if depth > 4 {
        return;
    }
    let Ok(rd) = std::fs::read_dir(dir) else { return };
    for entry in rd.flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_jsonl(&p, depth + 1, out);
        } else if p.extension().and_then(|e| e.to_str()) == Some("jsonl") {
            out.push(p);
        }
    }
}

/// Peek the first line (always `session_meta`) for the cwd Codex recorded at launch.
fn rollout_cwd(path: &Path) -> Option<String> {
    let file = std::fs::File::open(path).ok()?;
    let mut first_line = String::new();
    BufReader::new(file).read_line(&mut first_line).ok()?;
    let v: Value = serde_json::from_str(first_line.trim()).ok()?;
    v.get("payload")?.get("cwd")?.as_str().map(str::to_string)
}

fn codex_transcript_entries(path: &Path) -> Result<Vec<String>, String> {
    let file = std::fs::File::open(path).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for line in BufReader::new(file).lines().map_while(Result::ok) {
        if let Some(entry) = codex_transcript_entry(&line) {
            out.push(entry);
        }
    }
    Ok(out)
}

/// Codex's rollout format wraps every record as `{type, payload}`. The event-level
/// `user_message`/`agent_message` records carry the clean natural-language text
/// (unlike the `response_item`/`message` records, which also include the injected
/// AGENTS.md + sandbox-policy boilerplate as if it were a user turn).
fn codex_transcript_entry(line: &str) -> Option<String> {
    let v: Value = serde_json::from_str(line).ok()?;
    let payload = v.get("payload")?;
    let ptype = payload.get("type").and_then(|t| t.as_str())?;
    match ptype {
        "user_message" => {
            let text = payload.get("message").and_then(|m| m.as_str())?.trim();
            if text.is_empty() { None } else { Some(format!("[user]\n{}", cap(text, MAX_BLOCK_CHARS))) }
        }
        "agent_message" => {
            let text = payload.get("message").and_then(|m| m.as_str())?.trim();
            if text.is_empty() { None } else { Some(format!("[assistant]\n{}", cap(text, MAX_BLOCK_CHARS))) }
        }
        "function_call" => {
            let name = payload.get("name").and_then(|n| n.as_str()).unwrap_or("tool");
            let args = payload.get("arguments").and_then(|a| a.as_str()).unwrap_or("");
            Some(format!("[tool_use: {name}] {}", cap(args, 600)))
        }
        "function_call_output" => {
            let output = payload.get("output").and_then(|o| o.as_str()).unwrap_or("");
            Some(format!("[tool_result] {}", cap(output, 900)))
        }
        _ => None,
    }
}

fn codex_first_topic(entries: &[String]) -> Option<String> {
    entries.iter().find_map(|e| e.strip_prefix("[user]\n")).map(|s| {
        let one_line = s.split_whitespace().collect::<Vec<_>>().join(" ");
        if one_line.chars().count() <= 60 {
            one_line
        } else {
            let mut out: String = one_line.chars().take(60).collect();
            out.push('…');
            out
        }
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

fn render_reverse_prompt(cwd: &str, entries: &[String], omitted: usize, git: &str) -> String {
    let omitted_note = if omitted > 0 {
        format!("Older transcript entries omitted by Cockpit for context budget: {omitted}\n")
    } else {
        String::new()
    };
    format!(
        r#"You are Claude continuing work from a Codex session imported by Cockpit.

Working directory: {cwd}

Use this as handoff context, then inspect the repository before editing. Do not assume the transcript is complete; verify the current filesystem and git state.

Current git snapshot:
```text
{git}
```

{omitted_note}Recent Codex transcript excerpt:
```text
{}
```

Continue from here. First briefly restate the concrete next step you infer, then proceed."#,
        entries.join("\n\n")
    )
}

fn write_prompt(kind: &str, tag: &str, prompt: &str) -> Result<PathBuf, String> {
    let short: String = tag.chars().take(8).collect();
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_millis();
    let path = std::env::temp_dir().join(format!("cockpit-{kind}-handoff-{short}-{millis}.md"));
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

    #[test]
    fn codex_entry_extracts_user_and_agent_messages() {
        let user = r#"{"timestamp":"t","type":"event_msg","payload":{"type":"user_message","message":"hello there"}}"#;
        let agent = r#"{"timestamp":"t","type":"event_msg","payload":{"type":"agent_message","message":"hi back"}}"#;
        assert_eq!(codex_transcript_entry(user).unwrap(), "[user]\nhello there");
        assert_eq!(codex_transcript_entry(agent).unwrap(), "[assistant]\nhi back");
    }

    #[test]
    fn codex_entry_extracts_tool_call_and_output() {
        let call = r#"{"type":"response_item","payload":{"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}"}}"#;
        let output = r#"{"type":"response_item","payload":{"type":"function_call_output","call_id":"c1","output":"file1\nfile2"}}"#;
        assert_eq!(codex_transcript_entry(call).unwrap(), "[tool_use: exec_command] {\"cmd\":\"ls\"}");
        assert_eq!(codex_transcript_entry(output).unwrap(), "[tool_result] file1\nfile2");
    }

    #[test]
    fn codex_entry_skips_unrelated_record_types() {
        let reasoning = r#"{"type":"response_item","payload":{"type":"reasoning","id":"r1"}}"#;
        let session_meta = r#"{"type":"session_meta","payload":{"cwd":"/x"}}"#;
        assert!(codex_transcript_entry(reasoning).is_none());
        assert!(codex_transcript_entry(session_meta).is_none());
    }

    #[test]
    fn codex_first_topic_finds_first_user_entry() {
        let entries = vec![
            "[assistant]\nignored".to_string(),
            "[user]\n  fix   the   bug  ".to_string(),
        ];
        assert_eq!(codex_first_topic(&entries).as_deref(), Some("fix the bug"));
    }

    #[test]
    fn find_codex_rollout_matches_cwd_and_picks_newest() {
        let dir = std::env::temp_dir().join(format!("cockpit-rollout-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let older = dir.join("rollout-a.jsonl");
        let newer = dir.join("rollout-b.jsonl");
        let other_cwd = dir.join("rollout-c.jsonl");
        std::fs::write(&older, r#"{"type":"session_meta","payload":{"cwd":"/proj"}}"#).unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(&newer, r#"{"type":"session_meta","payload":{"cwd":"/proj"}}"#).unwrap();
        std::fs::write(&other_cwd, r#"{"type":"session_meta","payload":{"cwd":"/elsewhere"}}"#).unwrap();
        let got = find_codex_rollout(&dir, "/proj").unwrap();
        assert_eq!(got, newer);
        std::fs::remove_dir_all(&dir).ok();
    }
}

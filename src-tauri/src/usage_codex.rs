use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use crate::usage::{UsageReport, UsageWindow};
use crate::usage_time::unix_ms_to_iso;

fn report(status: &str) -> UsageReport {
    UsageReport { status: status.into(), five_hour: None, seven_day: None }
}

/// Cap on how many of the most-recently-modified rollout files we'll open looking for
/// a `token_count` snapshot. A freshly-opened Codex session has none yet, so scanning
/// only the single newest file isn't enough — but scanning the whole tree on every
/// poll would be slow on a long-lived `~/.codex`.
const MAX_SCAN_FILES: usize = 10;

/// One `{used_percent, resets_at}` rate-limit window from a Codex `token_count` event.
/// `resets_at` is Codex's own unix SECONDS (not the milliseconds `unix_ms_to_iso` needs).
struct CodexWindow {
    used_percent: f64,
    resets_at: i64,
}

/// Pull `payload.rate_limits.{primary,secondary}` out of one rollout JSONL line, if
/// it's an `event_msg` with `payload.type == "token_count"`.
fn parse_token_count_line(line: &str) -> Option<(CodexWindow, CodexWindow)> {
    let v: Value = serde_json::from_str(line).ok()?;
    if v.get("type").and_then(|t| t.as_str()) != Some("event_msg") {
        return None;
    }
    let payload = v.get("payload")?;
    if payload.get("type").and_then(|t| t.as_str()) != Some("token_count") {
        return None;
    }
    let rl = payload.get("rate_limits")?;
    let window = |key: &str| -> Option<CodexWindow> {
        let w = rl.get(key)?;
        Some(CodexWindow {
            used_percent: w.get("used_percent").and_then(|x| x.as_f64())?,
            resets_at: w.get("resets_at").and_then(|x| x.as_i64())?,
        })
    };
    Some((window("primary")?, window("secondary")?))
}

/// Given rollout file contents already ordered newest-first, return the first
/// `token_count` snapshot found (scanning each file's own lines newest-first too,
/// since a file can carry more than one snapshot over its life). Pure — no
/// filesystem, so it's testable without real files or mtime ordering.
fn pick_newest_snapshot(files_newest_first: &[String]) -> Option<(CodexWindow, CodexWindow)> {
    files_newest_first
        .iter()
        .find_map(|content| content.lines().rev().find_map(parse_token_count_line))
}

/// Recursively collect `rollout-*.jsonl` files under `~/.codex/sessions` (the tree is
/// date-partitioned `YYYY/MM/DD/`) with their mtimes. I/O — not unit tested.
fn collect_rollout_files(dir: &Path, out: &mut Vec<(SystemTime, PathBuf)>) {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rollout_files(&path, out);
        } else if path
            .file_name()
            .and_then(|n| n.to_str())
            .map_or(false, |n| n.starts_with("rollout-") && n.ends_with(".jsonl"))
        {
            if let Ok(meta) = entry.metadata() {
                if let Ok(mtime) = meta.modified() {
                    out.push((mtime, path));
                }
            }
        }
    }
}

/// Read up to `MAX_SCAN_FILES` of the most recently modified rollout files (newest
/// first) and return the first snapshot found. I/O glue around the pure
/// `pick_newest_snapshot` — not unit tested (mirrors `cost.rs`'s directory scan).
fn newest_snapshot(root: &Path) -> Option<(CodexWindow, CodexWindow)> {
    let mut files: Vec<(SystemTime, PathBuf)> = Vec::new();
    collect_rollout_files(root, &mut files);
    files.sort_by(|a, b| b.0.cmp(&a.0));
    let contents: Vec<String> = files
        .into_iter()
        .take(MAX_SCAN_FILES)
        .filter_map(|(_, p)| fs::read_to_string(p).ok())
        .collect();
    pick_newest_snapshot(&contents)
}

fn windows_to_report(primary: CodexWindow, secondary: CodexWindow) -> UsageReport {
    UsageReport {
        status: "ok".into(),
        five_hour: Some(UsageWindow {
            utilization: primary.used_percent,
            resets_at: unix_ms_to_iso(primary.resets_at * 1000),
        }),
        seven_day: Some(UsageWindow {
            utilization: secondary.used_percent,
            resets_at: unix_ms_to_iso(secondary.resets_at * 1000),
        }),
    }
}

fn fetch_codex_usage() -> UsageReport {
    let home = match std::env::var_os("HOME") {
        Some(h) => PathBuf::from(h),
        None => return report("error"),
    };
    let root = home.join(".codex").join("sessions");
    if !root.is_dir() {
        // Codex has never been used on this machine — "no data yet", not an error.
        return report("no_token");
    }
    match newest_snapshot(&root) {
        Some((primary, secondary)) => windows_to_report(primary, secondary),
        None => report("no_token"), // sessions exist but none carries a token_count event yet
    }
}

/// Local Codex 5-hour + weekly rate-limit usage, read from `~/.codex/sessions`. No
/// network, no auth — but scanning session files can be slow on a long-lived
/// `~/.codex`, so this runs on a blocking pool like `usage::usage_report`.
#[tauri::command]
pub async fn usage_report_codex() -> UsageReport {
    tauri::async_runtime::spawn_blocking(fetch_codex_usage)
        .await
        .unwrap_or_else(|_| report("error"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_token_count_line() -> String {
        r#"{"timestamp":"2026-05-11T13:48:09.601Z","type":"event_msg","payload":{"type":"token_count","info":null,"rate_limits":{"limit_id":"codex","limit_name":null,"primary":{"used_percent":24.0,"window_minutes":300,"resets_at":1782907200},"secondary":{"used_percent":41.0,"window_minutes":10080,"resets_at":1783080000},"credits":null,"plan_type":"plus","rate_limit_reached_type":null}}}"#.to_string()
    }

    #[test]
    fn parses_real_shaped_token_count_line() {
        let (primary, secondary) = parse_token_count_line(&sample_token_count_line()).unwrap();
        assert_eq!(primary.used_percent, 24.0);
        assert_eq!(primary.resets_at, 1782907200);
        assert_eq!(secondary.used_percent, 41.0);
        assert_eq!(secondary.resets_at, 1783080000);
    }

    #[test]
    fn ignores_non_token_count_events() {
        assert!(parse_token_count_line(r#"{"type":"event_msg","payload":{"type":"task_started"}}"#).is_none());
        assert!(parse_token_count_line(r#"{"type":"response_item","payload":{}}"#).is_none());
        assert!(parse_token_count_line("not json").is_none());
    }

    #[test]
    fn picks_snapshot_from_first_file_that_has_one() {
        let no_snapshot = r#"{"type":"event_msg","payload":{"type":"task_started"}}"#.to_string();
        let files = vec![no_snapshot, sample_token_count_line()];
        let (primary, secondary) = pick_newest_snapshot(&files).unwrap();
        assert_eq!(primary.used_percent, 24.0);
        assert_eq!(secondary.used_percent, 41.0);
    }

    #[test]
    fn none_when_no_file_has_a_snapshot() {
        let files = vec![r#"{"type":"event_msg","payload":{"type":"task_started"}}"#.to_string()];
        assert!(pick_newest_snapshot(&files).is_none());
    }

    #[test]
    fn windows_to_report_converts_seconds_to_iso() {
        let r = windows_to_report(
            CodexWindow { used_percent: 24.0, resets_at: 1782907200 },
            CodexWindow { used_percent: 41.0, resets_at: 1783080000 },
        );
        assert_eq!(r.status, "ok");
        assert_eq!(r.five_hour.as_ref().unwrap().utilization, 24.0);
        assert_eq!(r.five_hour.as_ref().unwrap().resets_at.as_deref(), Some("2026-07-01T12:00:00+00:00"));
        assert_eq!(r.seven_day.as_ref().unwrap().utilization, 41.0);
    }
}

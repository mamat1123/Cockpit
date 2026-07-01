# Multi-provider Usage Gauges (Codex + z.ai) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show Codex and z.ai usage (5-hour + weekly rate-limit %, with reset time) alongside Claude's in the tab-bar strip and Mission Control panel, each provider isolated so one failing never blanks the others.

**Architecture:** Two new Tauri commands (`usage_report_codex`, local file scan; `usage_report_zai`, network + Keychain) return the *same* `UsageReport`/`UsageWindow` struct Claude's `usage_report` already returns — no new wire type. The frontend's single poller becomes provider-keyed (`useMultiUsage`, `Promise.allSettled`) so a rejection only staleness's that provider's slice. A new `ProviderGaugeGroup` component (badge + label + gauges, Claude-only budget row) is shared by two placements: a per-provider hover popover in the tab-bar strip, and an always-visible stacked block in Mission Control.

**Tech Stack:** Rust (Tauri commands, `serde_json`, new `chrono` dependency for Unix-timestamp → RFC3339), TypeScript/React, Vitest, macOS `security` CLI (Keychain).

**Spec:** `docs/superpowers/specs/2026-07-01-multi-provider-usage-gauges-design.md` — read it first; this plan implements it task-by-task and does not re-derive its decisions.

## Global Constraints

- **Out of scope, do not touch:** `src/lib/providers.ts`'s `enabled` flag, `PaneHost.tsx`'s `onSelectProvider`, or any `terminalRegistry.ts` launch code. That is the *pane-launch* provider concept, a different feature from the *usage-display* provider concept this plan builds, even though both use the id `"zai"`.
- **Out of scope:** `src/lib/budget.ts` (today's-budget pacing math) — stays Claude-only, untouched.
- `UsageReport`/`UsageWindow` (defined in `src-tauri/src/usage.rs`) are reused as-is by both new Rust commands — their fields are already `pub`, so no visibility changes to `usage.rs` are needed, and `usage.rs` itself is not modified anywhere in this plan.
- Provider id type: reuse the existing `AgentProvider` type from `src/layout/paneLayout.ts` (`"claude" | "codex" | "zai"`) for typing the usage code, rather than inventing a parallel identical union — it's a compile-time-only type with no runtime coupling to pane-launch logic, so reusing it doesn't violate the scope boundary above.
- File structure: the new `ProviderGaugeGroup`/`MiniProviderRow` components live **inside** `src/components/UsageGauges.tsx`, not new files — this file already co-locates `Gauge`/`Mini`/`DayMini`/`DayGauge`/`Popover` as one feature unit, and `PaneHeader.tsx` follows the same "one file per feature" convention for its own inline sub-renders (HR popover, PT dropdown). Splitting would break that established pattern for a file that's still a reasonable size after this change (~340 lines).
- Rust `#[cfg(test)]` unit tests only cover pure functions (JSON/string in, struct out) — file-scanning and Keychain/network I/O are glue, verified manually, matching the existing precedent in this codebase (`cost.rs`'s directory scan, `headroom.rs`'s proxy spawn — see `docs/superpowers/plans/2026-06-29-headroom-per-session-foundation.md` Task 2 Step 4).
- Existing test runners: `npm test` (Vitest, from repo root) and `cd src-tauri && cargo test` (Rust).

---

### Task 1: Shared Unix-timestamp → ISO helper (`usage_time.rs`)

Both new collectors need to turn a Unix timestamp into the RFC3339 string `UsageWindow.resets_at` already expects (the frontend calls `Date.parse()` on it) — Codex reports seconds, z.ai reports milliseconds. Rather than hand-rolling calendar math twice (error-prone) or in each file, add one small dependency and one shared pure function.

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `chrono`)
- Create: `src-tauri/src/usage_time.rs`
- Modify: `src-tauri/src/lib.rs:4` (register the module)

**Interfaces:**
- Produces: `pub fn unix_ms_to_iso(ms: i64) -> Option<String>`

- [ ] **Step 1: Add the `chrono` dependency**

In `src-tauri/Cargo.toml`, add this line under `[dependencies]` (after `serde_json = "1"`):

```toml
chrono = { version = "0.4", default-features = false, features = ["std"] }
```

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/usage_time.rs`:

```rust
use chrono::DateTime;

/// Unix milliseconds → RFC3339 UTC string (e.g. `"2026-07-01T12:00:00+00:00"`), the
/// same shape the frontend already parses via `Date.parse()` for Claude's
/// `resets_at`. Shared by the Codex (seconds → ×1000) and z.ai (already ms)
/// collectors so the conversion is written and tested once.
pub fn unix_ms_to_iso(ms: i64) -> Option<String> {
    let dt = DateTime::from_timestamp_millis(ms)?;
    Some(dt.to_rfc3339())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_a_known_timestamp() {
        // 2026-07-01T12:00:00Z
        assert_eq!(unix_ms_to_iso(1782907200000).as_deref(), Some("2026-07-01T12:00:00+00:00"));
    }

    #[test]
    fn rejects_out_of_range() {
        assert_eq!(unix_ms_to_iso(i64::MAX), None);
    }
}
```

- [ ] **Step 3: Register the module**

In `src-tauri/src/lib.rs`, change line 4 (`mod usage;`) to:

```rust
mod usage;
mod usage_time;
```

- [ ] **Step 4: Run the tests**

Run: `cd src-tauri && cargo test usage_time`
Expected: `2 passed`. (This also confirms `chrono` compiled — first run will take longer while it fetches/builds the new dependency.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/usage_time.rs src-tauri/src/lib.rs
git commit -m "feat(usage): add shared unix-ms-to-ISO helper for provider collectors"
```

---

### Task 2: Codex collector (`usage_report_codex`)

Reads `~/.codex/sessions/**/rollout-*.jsonl` locally — no network, no auth. A freshly-opened Codex session has no `token_count` event yet, so this scans the most-recently-modified files (newest first) until it finds one, capped so a long-lived `~/.codex` doesn't stall a poll.

**Files:**
- Create: `src-tauri/src/usage_codex.rs`
- Modify: `src-tauri/src/lib.rs:5` (register module), `:120` (register command)

**Interfaces:**
- Consumes: `crate::usage::{UsageReport, UsageWindow}`, `crate::usage_time::unix_ms_to_iso` (Task 1)
- Produces: Tauri command `usage_report_codex() -> UsageReport`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/usage_codex.rs`:

```rust
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
```

- [ ] **Step 2: Register the module and command**

In `src-tauri/src/lib.rs`, change what is now (after Task 1) line 5 (`mod usage_time;`) to also add:

```rust
mod usage_time;
mod usage_codex;
```

In the `generate_handler![...]` macro, change the line `usage::usage_report,` (originally line 119, shifted by Task 1's one-line insertion — find it, it hasn't moved otherwise) to:

```rust
            usage::usage_report,
            usage_codex::usage_report_codex,
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test usage_codex`
Expected: `5 passed`.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles clean.

- [ ] **Step 5: Manual verification**

1. Confirm you have local Codex sessions: `ls ~/.codex/sessions 2>/dev/null` (if empty/missing, skip to step 3 — the "no_token" path is what you're verifying instead).
2. `npm run tauri dev`, open devtools console, run: `await window.__TAURI__.core.invoke('usage_report_codex')`.
3. Expected: `{status: "ok", fiveHour: {utilization: <number>, resetsAt: "<ISO string>"}, sevenDay: {...}}` if you have Codex usage; `{status: "no_token", fiveHour: null, sevenDay: null}` if you don't.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/usage_codex.rs src-tauri/src/lib.rs
git commit -m "feat(usage): add local Codex rate-limit collector (usage_report_codex)"
```

---

### Task 3: z.ai collector + Keychain token commands

Network collector (mirrors Claude's `curl` pattern in `usage.rs`) plus two Keychain commands for the Settings UI (Task 8) to save/check the monitor token. The token is **never** returned to the frontend.

**Files:**
- Create: `src-tauri/src/usage_zai.rs`
- Modify: `src-tauri/src/lib.rs:6` (register module), generate_handler (register 3 commands)

**Interfaces:**
- Produces: Tauri commands `usage_report_zai() -> UsageReport`, `save_zai_token(token: String) -> Result<(), String>`, `zai_token_configured() -> bool`

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/usage_zai.rs`:

```rust
use serde_json::Value;
use std::process::Command;

use crate::usage::{UsageReport, UsageWindow};
use crate::usage_time::unix_ms_to_iso;

/// Keychain identity for the z.ai monitor token — distinct from Claude's
/// "Claude Code-credentials" service so the two never collide.
const ZAI_KEYCHAIN_SERVICE: &str = "Cockpit z.ai Monitor Token";
const ZAI_KEYCHAIN_ACCOUNT: &str = "cockpit";

fn report(status: &str) -> UsageReport {
    UsageReport { status: status.into(), five_hour: None, seven_day: None }
}

/// Read the saved z.ai monitor token from macOS Keychain, if any.
fn zai_token() -> Option<String> {
    let out = Command::new("security")
        .args(["find-generic-password", "-s", ZAI_KEYCHAIN_SERVICE, "-w"])
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    let t = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if t.is_empty() { None } else { Some(t) }
}

/// One `data.limits[]` entry matches a window iff its `type` is `TOKENS_LIMIT` and
/// `(unit, number)` is the pair z.ai uses for that window: `(3, 5)` is the 5-hour
/// window, `(6, 1)` is weekly.
fn is_window(limit: &Value, unit: i64, number: i64) -> bool {
    limit.get("type").and_then(|t| t.as_str()) == Some("TOKENS_LIMIT")
        && limit.get("unit").and_then(|x| x.as_i64()) == Some(unit)
        && limit.get("number").and_then(|x| x.as_i64()) == Some(number)
}

fn window_from_limit(limit: &Value) -> Option<UsageWindow> {
    let percentage = limit.get("percentage").and_then(|x| x.as_f64())?;
    let next_reset = limit.get("nextResetTime").and_then(|x| x.as_i64())?;
    Some(UsageWindow { utilization: percentage, resets_at: unix_ms_to_iso(next_reset) })
}

/// Parse the z.ai `quota/limit` response body. `status: "ok"` requires finding at
/// least the 5-hour window; anything else (garbage body, missing 5-hour window) is
/// `"error"` — z.ai has no separate "auth expired" body shape to distinguish, unlike
/// Claude's usage endpoint.
fn report_from_body(body: &[u8]) -> UsageReport {
    let v: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return report("error"),
    };
    let limits = match v.get("data").and_then(|d| d.get("limits")).and_then(|l| l.as_array()) {
        Some(l) => l,
        None => return report("error"),
    };
    let five_hour = limits.iter().find(|l| is_window(l, 3, 5)).and_then(window_from_limit);
    let seven_day = limits.iter().find(|l| is_window(l, 6, 1)).and_then(window_from_limit);
    if five_hour.is_none() {
        return report("error");
    }
    UsageReport { status: "ok".into(), five_hour, seven_day }
}

/// curl the quota endpoint with the bearer-less `Authorization` header z.ai's monitor
/// API expects (confirmed against the official endpoint — NOT `"Bearer <token>"`).
fn curl_quota(token: &str) -> Option<Vec<u8>> {
    match Command::new("curl")
        .args([
            "-s",
            "--max-time",
            "8",
            "-H",
            &format!("Authorization: {token}"),
            "-H",
            "Accept-Language: en-US,en",
            "https://api.z.ai/api/monitor/usage/quota/limit",
        ])
        .output()
    {
        Ok(o) if o.status.success() && !o.stdout.is_empty() => Some(o.stdout),
        _ => None,
    }
}

fn fetch_zai_usage() -> UsageReport {
    let token = match zai_token() {
        Some(t) => t,
        None => return report("no_token"),
    };
    match curl_quota(&token) {
        Some(body) => report_from_body(&body),
        None => report("error"),
    }
}

/// Live z.ai 5-hour + weekly usage for the saved monitor token. Blocking pool like
/// `usage::usage_report` (same reasoning: an up-to-8s curl call).
#[tauri::command]
pub async fn usage_report_zai() -> UsageReport {
    tauri::async_runtime::spawn_blocking(fetch_zai_usage)
        .await
        .unwrap_or_else(|_| report("error"))
}

/// Save (or clear) the z.ai monitor token. An empty/whitespace-only `token` deletes
/// the Keychain entry instead of storing an empty secret, so clearing the Settings
/// field + Save is how the user returns to "not configured" — no separate delete
/// command/button needed.
#[tauri::command]
pub fn save_zai_token(token: String) -> Result<(), String> {
    let trimmed = token.trim();
    if trimmed.is_empty() {
        let _ = Command::new("security")
            .args(["delete-generic-password", "-s", ZAI_KEYCHAIN_SERVICE])
            .output();
        return Ok(());
    }
    let out = Command::new("security")
        .args([
            "add-generic-password",
            "-a", ZAI_KEYCHAIN_ACCOUNT,
            "-s", ZAI_KEYCHAIN_SERVICE,
            "-w", trimmed,
            "-U",
        ])
        .output()
        .map_err(|e| format!("keychain write failed: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).into_owned())
    }
}

/// Existence check only — never returns the token value to the frontend.
#[tauri::command]
pub fn zai_token_configured() -> bool {
    zai_token().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ok_report_extracts_both_windows() {
        let body = br#"{"data":{"limits":[
            {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":24.0,"nextResetTime":1782907200000},
            {"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":41.0,"nextResetTime":1783080000000}
        ]}}"#;
        let r = report_from_body(body);
        assert_eq!(r.status, "ok");
        assert_eq!(r.five_hour.as_ref().unwrap().utilization, 24.0);
        assert_eq!(r.five_hour.as_ref().unwrap().resets_at.as_deref(), Some("2026-07-01T12:00:00+00:00"));
        assert_eq!(r.seven_day.as_ref().unwrap().utilization, 41.0);
    }

    #[test]
    fn missing_five_hour_window_is_error() {
        let body = br#"{"data":{"limits":[
            {"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":41.0,"nextResetTime":1783080000000}
        ]}}"#;
        assert_eq!(report_from_body(body).status, "error");
    }

    #[test]
    fn ignores_non_tokens_limit_entries() {
        let body = br#"{"data":{"limits":[
            {"type":"TIME_LIMIT","unit":3,"number":5,"percentage":99.0},
            {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":24.0,"nextResetTime":1782907200000}
        ]}}"#;
        let r = report_from_body(body);
        assert_eq!(r.status, "ok");
        assert_eq!(r.five_hour.as_ref().unwrap().utilization, 24.0);
    }

    #[test]
    fn garbage_body_maps_to_error() {
        assert_eq!(report_from_body(b"not json").status, "error");
        assert_eq!(report_from_body(b"{}").status, "error");
    }
}
```

- [ ] **Step 2: Register the module and commands**

In `src-tauri/src/lib.rs`, change the (post-Task-2) `mod usage_codex;` line to also add:

```rust
mod usage_codex;
mod usage_zai;
```

In `generate_handler![...]`, change the line added in Task 2 (`usage_codex::usage_report_codex,`) to also add the three new z.ai commands:

```rust
            usage_codex::usage_report_codex,
            usage_zai::usage_report_zai,
            usage_zai::save_zai_token,
            usage_zai::zai_token_configured,
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test usage_zai`
Expected: `4 passed`.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles clean.

- [ ] **Step 5: Manual verification (Keychain write can't be unit tested — it prompts the macOS Keychain permission dialog)**

1. `npm run tauri dev`, open devtools console.
2. `await window.__TAURI__.core.invoke('zai_token_configured')` → `false` (nothing saved yet).
3. `await window.__TAURI__.core.invoke('save_zai_token', {token: 'test-token-123'})` → macOS prompts for Keychain access the first time; approve it. Resolves with no error.
4. `await window.__TAURI__.core.invoke('zai_token_configured')` → `true`.
5. `await window.__TAURI__.core.invoke('usage_report_zai')` → `{status: "error", ...}` (the test token is fake, so the real z.ai API rejects it — this confirms the network path runs, not that the token is valid).
6. `await window.__TAURI__.core.invoke('save_zai_token', {token: ''})` → clears it.
7. `await window.__TAURI__.core.invoke('zai_token_configured')` → back to `false`.
8. If you have a **real** z.ai monitor token (from `~/.claude/glm.env`'s `GLM_MONITOR_TOKEN`, per the spec's Context — Cockpit does not read that file, this is just for your own manual smoke test), repeat step 3 with it and confirm step 5 now returns `status: "ok"` with real percentages.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/usage_zai.rs src-tauri/src/lib.rs
git commit -m "feat(usage): add z.ai rate-limit collector + Keychain token commands"
```

---

### Task 4: Frontend `usageClient.ts` wrappers

Thin `invoke` wrappers for the three new commands — no logic to unit test, matches the existing `usageReport()` wrapper exactly.

**Files:**
- Modify: `src/lib/usageClient.ts`

**Interfaces:**
- Produces: `usageReportCodex(): Promise<UsageReport>`, `usageReportZai(): Promise<UsageReport>`, `saveZaiToken(token: string): Promise<void>`, `zaiTokenConfigured(): Promise<boolean>`

- [ ] **Step 1: Add the wrappers**

Replace the full contents of `src/lib/usageClient.ts` with:

```typescript
import { invoke } from "@tauri-apps/api/core";

/** One rolling rate-limit window: % burned (0–100) + ISO reset time. */
export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

/** `status` mirrors the Rust command — drives the graceful UI states. */
export interface UsageReport {
  status: "ok" | "no_token" | "error";
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

/** Live 5-hour + weekly account usage from the Rust `usage_report` command (Claude). */
export function usageReport(): Promise<UsageReport> {
  return invoke("usage_report");
}

/** Local Codex 5-hour + weekly usage, read from `~/.codex/sessions` — no network. */
export function usageReportCodex(): Promise<UsageReport> {
  return invoke("usage_report_codex");
}

/** Live z.ai 5-hour + weekly usage for the saved monitor token. */
export function usageReportZai(): Promise<UsageReport> {
  return invoke("usage_report_zai");
}

/** Save (or, with an empty string, clear) the z.ai monitor token in macOS Keychain. */
export function saveZaiToken(token: string): Promise<void> {
  return invoke("save_zai_token", { token });
}

/** Whether a z.ai monitor token is currently saved — never returns the value itself. */
export function zaiTokenConfigured(): Promise<boolean> {
  return invoke("zai_token_configured");
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no new errors (existing call sites of `usageReport`/`UsageReport`/`UsageWindow` are unaffected — only additions).

- [ ] **Step 3: Commit**

```bash
git add src/lib/usageClient.ts
git commit -m "feat(usage): add Codex/z.ai usage + z.ai token client wrappers"
```

---

### Task 5: `useMultiUsage` — provider-keyed poller with failure isolation

Replaces the single-provider `useUsage` store with one that fetches all three providers per tick via `Promise.allSettled`, so one rejection only staleness's its own slice.

**Files:**
- Modify: `src/lib/usageStore.ts`
- Test: `src/lib/usageStore.test.ts` (new)

**Interfaces:**
- Produces: `export type ProviderId = AgentProvider` (re-exported for convenience), `interface UsageState { report: UsageReport | null; status: UsageUiStatus; lastOkAt: number | null }` (unchanged shape), `type MultiUsageState = Record<ProviderId, UsageState>`, `useMultiUsage(): MultiUsageState`

- [ ] **Step 1: Write the failing test**

Create `src/lib/usageStore.test.ts`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMultiUsage } from "./usageStore";

vi.mock("./usageClient", () => ({
  usageReport: () => Promise.resolve({ status: "ok", fiveHour: { utilization: 24, resetsAt: null }, sevenDay: null }),
  usageReportCodex: () => Promise.resolve({ status: "ok", fiveHour: { utilization: 31, resetsAt: null }, sevenDay: null }),
  usageReportZai: () => Promise.reject(new Error("network down")),
}));
vi.mock("./terminalRegistry", () => ({ anyPaneWorking: () => false }));

function Harness({ onState }: { onState: (s: ReturnType<typeof useMultiUsage>) => void }) {
  const state = useMultiUsage();
  onState(state);
  return null;
}

describe("useMultiUsage", () => {
  it("a rejected provider only affects its own slice — the other two still update", async () => {
    let latest: ReturnType<typeof useMultiUsage> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness onState={(s) => { latest = s; }} />);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(latest!.claude.status).toBe("ok");
    expect(latest!.claude.report?.fiveHour?.utilization).toBe(24);
    expect(latest!.codex.status).toBe("ok");
    expect(latest!.codex.report?.fiveHour?.utilization).toBe(31);
    // z.ai's fetch rejected and it never had a prior report → "loading", not blank/crashed.
    expect(latest!.zai.status).toBe("loading");
    expect(latest!.zai.report).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/lib/usageStore.test.ts`
Expected: FAIL — `useMultiUsage` is not exported yet.

- [ ] **Step 3: Rewrite the store**

Replace the full contents of `src/lib/usageStore.ts` with:

```typescript
import { useEffect, useState } from "react";
import { usageReport, usageReportCodex, usageReportZai, type UsageReport } from "./usageClient";
import { anyPaneWorking } from "./terminalRegistry";
import type { AgentProvider } from "../layout/paneLayout";

/**
 * One shared usage poller behind a tiny pub/sub store, so the tab-bar strip and the
 * Mission Control panel read the SAME cached state and trigger ONE set of network/file
 * calls — now fanned out across all three providers per tick.
 *
 * Refresh policy (unchanged from the single-provider version):
 *  - a turn finishing (working→idle edge) → refresh after an 8s settle
 *  - window regains focus → refresh now
 *  - baseline poll every 60s as a floor
 *  - never below MIN_GAP between actual fetch ticks, so bursts of idle events coalesce
 *
 * Failure isolation: each tick fetches all three providers via `Promise.allSettled`,
 * so one provider's rejection (e.g. z.ai's curl timing out) only staleness's *that*
 * provider's slice of state — the other two update normally. This shares the refresh
 * triggers/timers above (a UI-level concern) rather than running three independent
 * pollers, which would just duplicate timers for no extra isolation benefit.
 */

export type UsageUiStatus = "loading" | "ok" | "stale" | "noToken";
export type ProviderId = AgentProvider;

export interface UsageState {
  report: UsageReport | null; // last GOOD report (status === "ok"), or null until first success
  status: UsageUiStatus;
  lastOkAt: number | null;
}

export type MultiUsageState = Record<ProviderId, UsageState>;

const MIN_GAP_MS = 8_000;
const BASELINE_MS = 60_000;
const IDLE_SETTLE_MS = 8_000;
const EDGE_TICK_MS = 1_000;

const EMPTY_STATE: UsageState = { report: null, status: "loading", lastOkAt: null };

let state: MultiUsageState = { claude: EMPTY_STATE, codex: EMPTY_STATE, zai: EMPTY_STATE };
const subs = new Set<(s: MultiUsageState) => void>();

function emit(provider: ProviderId, patch: Partial<UsageState>) {
  state = { ...state, [provider]: { ...state[provider], ...patch } };
  for (const fn of subs) fn(state);
}

/** Apply one provider's fetch outcome to its own slice — never touches the others. */
function applyResult(provider: ProviderId, settled: PromiseSettledResult<UsageReport>) {
  const hadReport = !!state[provider].report;
  if (settled.status === "fulfilled") {
    const r = settled.value;
    if (r.status === "ok") {
      emit(provider, { report: r, status: "ok", lastOkAt: Date.now() });
    } else if (r.status === "no_token") {
      emit(provider, { status: hadReport ? "stale" : "noToken" });
    } else {
      emit(provider, { status: hadReport ? "stale" : "loading" });
    }
  } else {
    // Rejected promise (network/invoke failure): same graceful degrade as a
    // non-"ok" status — keep the last good report if we have one.
    emit(provider, { status: hadReport ? "stale" : "loading" });
  }
}

let inFlight = false;
let lastFetchAt = 0;

async function fetchUsage(force = false): Promise<void> {
  const now = Date.now();
  if (inFlight) return;
  if (!force && now - lastFetchAt < MIN_GAP_MS) return;
  inFlight = true;
  lastFetchAt = now;
  const [claude, codex, zai] = await Promise.allSettled([usageReport(), usageReportCodex(), usageReportZai()]);
  applyResult("claude", claude);
  applyResult("codex", codex);
  applyResult("zai", zai);
  inFlight = false;
}

let started = false;
function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  void fetchUsage(true);
  setInterval(() => void fetchUsage(), BASELINE_MS);

  // window focus → fresh read
  const onFocus = () => void fetchUsage(true);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void fetchUsage(true);
  });

  // working→idle edge → refresh after a settle (utilization only moves when a turn spends tokens)
  let prevWorking = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  setInterval(() => {
    const working = anyPaneWorking(Date.now());
    if (prevWorking && !working) {
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => void fetchUsage(), IDLE_SETTLE_MS);
    }
    prevWorking = working;
  }, EDGE_TICK_MS);
}

/** Subscribe a React component to the shared multi-provider usage state. */
export function useMultiUsage(): MultiUsageState {
  const [s, setS] = useState<MultiUsageState>(state);
  useEffect(() => {
    start();
    subs.add(setS);
    setS(state);
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run src/lib/usageStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/usageStore.ts src/lib/usageStore.test.ts
git commit -m "feat(usage): fan usage polling out to claude/codex/zai with failure isolation"
```

---

### Task 6: Rewrite `UsageStrip` — per-provider rows, independent popovers, `naLabel`

The big UI task. Extracts `ProviderGaugeGroup` (badge + label + gauges, optional Claude-only budget row) and `MiniProviderRow` (the tab-bar badge + 2 mini bars, its own hover/focus target opening its own popover). `Gauge` gains a `naLabel` prop so each provider can show its own no-data copy.

**Files:**
- Modify: `src/components/UsageGauges.tsx`, `src/components/UsageGauges.css`
- Test: `src/components/UsageGauges.popover.test.tsx` (rewritten)

**Interfaces:**
- Produces (new, internal to `UsageGauges.tsx`): `ProviderGaugeGroup`, `MiniProviderRow`, `MiniWithReset`
- Changes: `Gauge` gains `naLabel?: string` (default `"sign in to Claude"`); `UsageStrip` no longer takes/needs `useUsage` — uses `useMultiUsage` + `useBudget`

- [ ] **Step 1: Write the failing tests**

Replace the full contents of `src/components/UsageGauges.popover.test.tsx` with:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UsageStrip } from "./UsageGauges";

const inFuture = new Date(Date.now() + (4 * 60 + 12) * 60 * 1000);
const expectedClock = `${String(inFuture.getHours()).padStart(2, "0")}:${String(inFuture.getMinutes()).padStart(2, "0")}`;

vi.mock("../lib/usageStore", () => ({
  useMultiUsage: () => ({
    claude: {
      report: {
        status: "ok",
        fiveHour: { utilization: 24, resetsAt: inFuture.toISOString() },
        sevenDay: { utilization: 41, resetsAt: inFuture.toISOString() },
      },
      status: "ok",
      lastOkAt: Date.now(),
    },
    codex: {
      report: {
        status: "ok",
        fiveHour: { utilization: 31, resetsAt: inFuture.toISOString() },
        sevenDay: { utilization: 20, resetsAt: inFuture.toISOString() },
      },
      status: "ok",
      lastOkAt: Date.now(),
    },
    zai: { report: null, status: "noToken", lastOkAt: null },
  }),
}));
vi.mock("../lib/budgetStore", () => ({ useBudget: () => null }));

describe("UsageStrip — per-provider rows and popovers", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UsageStrip />));
    return container;
  }

  it("renders one row per provider", () => {
    const c = mount();
    expect(c.querySelectorAll(".cu-provider-row")).toHaveLength(3);
  });

  it("z.ai shows its na-state without blocking Claude/Codex, and isn't focusable", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    expect(rows[0].className).not.toContain("is-na"); // claude
    expect(rows[1].className).not.toContain("is-na"); // codex
    expect(rows[2].className).toContain("is-na"); // zai

    act(() => rows[2].focus());
    expect(c.querySelectorAll(".cu-provider-row__pop")).toHaveLength(0);
  });

  it("focusing the Claude row opens ONLY Claude's popover, with both times shown", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    act(() => rows[0].focus());

    const popovers = c.querySelectorAll(".cu-provider-row__pop");
    expect(popovers).toHaveLength(1);

    const resets = Array.from(popovers[0].querySelectorAll(".cu-gauge__reset")).map((el) => el.textContent ?? "");
    expect(resets).toHaveLength(2); // 5-hour + weekly
    for (const text of resets) {
      expect(text).toMatch(/resets in \d/);
      expect(text).toContain(`(${expectedClock})`);
    }
  });

  it("focusing Codex's row opens a DIFFERENT popover than Claude's", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    act(() => rows[1].focus());

    const popovers = c.querySelectorAll(".cu-provider-row__pop");
    expect(popovers).toHaveLength(1);
    const pct = popovers[0].querySelector(".cu-gauge__pct")?.textContent ?? "";
    expect(pct).toContain("31"); // Codex's 5-hour utilization, not Claude's 24
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/components/UsageGauges.popover.test.tsx`
Expected: FAIL — `.cu-provider-row` doesn't exist yet (old `UsageStrip` renders `.cockpit-usage` with `.cu-mini`s, no per-row popovers).

- [ ] **Step 3: Rewrite `UsageGauges.tsx`**

Replace the full contents of `src/components/UsageGauges.tsx` with:

```typescript
import { useEffect, useState } from "react";
import { useMultiUsage, type UsageUiStatus, type UsageState, type ProviderId } from "../lib/usageStore";
import { useBudget } from "../lib/budgetStore";
import type { Budget } from "../lib/budget";
import type { UsageWindow } from "../lib/usageClient";
import { clampPct, levelFor, formatReset, formatResetClock } from "../lib/usage";
import { providerMeta } from "../lib/providers";
import "./UsageGauges.css";

type Mode = "data" | "loading" | "na";

function modeOf(status: UsageUiStatus, hasReport: boolean): Mode {
  if (status === "noToken") return "na";
  if (!hasReport && status === "loading") return "loading";
  return "data";
}

/** Local 1s clock used for the live reset countdown / Mission Control clock. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Full instrument gauge for one window — used in per-provider popovers and Mission Control. */
function Gauge({ label, win, now, stale, mode, naLabel = "sign in to Claude" }: {
  label: string;
  win: UsageWindow | null;
  now: number;
  stale: boolean;
  mode: Mode;
  naLabel?: string;
}) {
  const pct = clampPct(win?.utilization ?? 0);
  const level = levelFor(pct);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (mode !== "data") return;
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct, mode]);

  const cls = mode === "data" ? `is-${level}` : `is-${mode}`;
  const hot = mode === "data" && pct > 80;
  const reset = mode === "data"
    ? (win?.resetsAt ? `resets in ${formatReset(win.resetsAt, now)}` : "—")
    : mode === "na" ? naLabel : "loading…";
  const resetClock = mode === "data" && win?.resetsAt ? formatResetClock(win.resetsAt) : null;

  return (
    <div className={`cu-gauge ${cls}${stale ? " is-stale" : ""}${hot ? " is-hot" : ""}`}>
      <div className="cu-gauge__head">
        <span className="cu-gauge__name">{label}</span>
        <span className="cu-gauge__pct">{mode === "data" ? <>{pct}<i>%</i></> : "—"}</span>
      </div>
      <div className="cu-gauge__track">
        {mode === "data" && <div className="cu-gauge__fill" style={{ width: `${w}%` }} />}
        <div className="cu-gauge__ticks" />
      </div>
      <div className="cu-gauge__foot">
        <span className="cu-gauge__used">used</span>
        <span className="cu-gauge__reset">
          <span className="r">⟳</span>{reset}
          {resetClock && <span className="cu-gauge__reset-clock"> ({resetClock})</span>}
        </span>
      </div>
    </div>
  );
}

/** One compact bar with a trailing reset-time chip — the tab-bar strip's per-window row. */
function MiniWithReset({ win, now, stale }: { win: UsageWindow | null; now: number; stale: boolean }) {
  const pct = clampPct(win?.utilization ?? 0);
  const level = levelFor(pct);
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <span className={`cu-mini is-${level}${stale ? " is-stale" : ""}`}>
      <span className="cu-mini__track"><span className="cu-mini__fill" style={{ width: `${w}%` }} /></span>
      <span className="cu-mini__v">{pct}%</span>
      {win?.resetsAt && <span className="cu-mini__t">{formatReset(win.resetsAt, now)}</span>}
    </span>
  );
}

/** Daily-budget mini for the strip: how much of TODAY's pacing budget is spent (can exceed 100% = borrowing from later days). Claude-only. */
function DayMini({ b, stale }: { b: Budget; stale: boolean }) {
  const fill = Math.max(0, Math.min(100, b.fillPct));
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(fill));
    return () => cancelAnimationFrame(id);
  }, [fill]);
  const cls = b.over ? "is-red is-over" : `is-${b.level}`;
  const remain = Math.max(0, Math.round(b.remainingPct));
  const title = `today's budget — ${Math.round(b.fillPct)}% used · ${remain}% (≈$${Math.round(b.remainingUsd)}) left to spend today · ${b.daysLeft}d left this week. A pacing target, not a hard limit.`;
  return (
    <span className={`cu-mini ${cls}${stale ? " is-stale" : ""}`} title={title}>
      <span className="cu-mini__k">day</span>
      <span className="cu-mini__track"><span className="cu-mini__fill" style={{ width: `${w}%` }} /></span>
      <span className="cu-mini__v">{Math.round(b.fillPct)}%</span>
    </span>
  );
}

/** Full daily-budget gauge — mirrors the 5h/weekly gauge. Claude-only. */
function DayGauge({ b, stale }: { b: Budget; stale: boolean }) {
  const fill = Math.max(0, Math.min(100, b.fillPct));
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(fill));
    return () => cancelAnimationFrame(id);
  }, [fill]);
  const cls = b.over ? "is-red is-over" : `is-${b.level}`;
  const remain = Math.round(b.remainingPct);
  const foot = b.over
    ? `${Math.abs(remain)}% over — borrowing from later days`
    : `${remain}% (≈$${Math.round(b.remainingUsd)}) left today`;
  return (
    <div className={`cu-gauge ${cls}${stale ? " is-stale" : ""}`}>
      <div className="cu-gauge__head">
        <span className="cu-gauge__name">today’s budget</span>
        <span className="cu-gauge__pct">{Math.round(b.fillPct)}<i>%</i></span>
      </div>
      <div className="cu-gauge__track">
        <div className="cu-gauge__fill" style={{ width: `${w}%` }} />
        <div className="cu-gauge__ticks" />
      </div>
      <div className="cu-gauge__foot">
        <span className="cu-gauge__used">spent</span>
        <span className="cu-gauge__reset">{foot}</span>
      </div>
    </div>
  );
}

/** No-data copy per provider, shown by `Gauge`/`MiniProviderRow` when there's nothing to show. */
const NA_LABEL: Record<ProviderId, string> = {
  claude: "sign in to Claude",
  codex: "no Codex sessions yet",
  zai: "set token in Settings",
};

/**
 * Badge + label + full 5h/weekly gauges for one provider, with an optional Claude-only
 * daily-budget row. The one shared visual unit used by both the tab-bar popover
 * (`MiniProviderRow`, below) and Mission Control (`UsagePanel`).
 */
function ProviderGaugeGroup({ id, state, now, budget }: {
  id: ProviderId;
  state: UsageState;
  now: number;
  budget?: Budget | null;
}) {
  const meta = providerMeta(id);
  const mode = modeOf(state.status, !!state.report);
  const five = state.report?.fiveHour ?? null;
  const week = state.report?.sevenDay ?? null;
  const stale = state.status === "stale";
  return (
    <div className="cu-provider-group">
      <div className="cu-provider-group__head">
        <span className={`cu-badge provider-${id}`}>{meta.mark}</span>
        <span className="cu-provider-group__name">{meta.label}</span>
      </div>
      <Gauge label="5-hour window" win={five} now={now} stale={stale} mode={mode} naLabel={NA_LABEL[id]} />
      <Gauge label="Weekly · 7-day" win={week} now={now} stale={stale} mode={mode} naLabel={NA_LABEL[id]} />
      {budget && <DayGauge b={budget} stale={stale} />}
    </div>
  );
}

/**
 * One provider's tab-bar strip row: badge + 2 mini bars (5h/weekly, each with a
 * trailing reset-time chip). Its own independent hover/focus target — opens ONLY its
 * own popover, anchored under itself. A provider with no data shows its own na/loading
 * state and is never focusable, so it can never block or blank the other providers.
 */
function MiniProviderRow({ id, state, budget }: {
  id: ProviderId;
  state: UsageState;
  budget?: Budget | null;
}) {
  const meta = providerMeta(id);
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const mode = modeOf(state.status, !!state.report);
  const stale = state.status === "stale";

  if (mode === "loading") {
    return (
      <span className="cu-provider-row is-loading" aria-label={`Loading ${meta.label} usage`}>
        <span className={`cu-badge provider-${id}`}>{meta.mark}</span>
        <span className="cu-provider-row__bars"><span className="cu-mini-sk" /><span className="cu-mini-sk" /></span>
      </span>
    );
  }
  if (mode === "na") {
    return (
      <span className="cu-provider-row is-na" title={NA_LABEL[id]} aria-label={`${meta.label} usage unavailable — ${NA_LABEL[id]}`}>
        <span className={`cu-badge provider-${id}`}>{meta.mark}</span>
        <span className="cu-na">—</span>
      </span>
    );
  }

  const five = state.report?.fiveHour ?? null;
  const week = state.report?.sevenDay ?? null;
  return (
    <span
      className={`cu-provider-row${stale ? " is-stale" : ""}`}
      tabIndex={0}
      aria-label={`${meta.label} usage`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className={`cu-badge provider-${id}`}>{meta.mark}</span>
      <span className="cu-provider-row__bars">
        <MiniWithReset win={five} now={now} stale={stale} />
        <MiniWithReset win={week} now={now} stale={stale} />
      </span>
      {open && (
        <span className="cu-provider-row__pop" role="tooltip">
          <ProviderGaugeGroup id={id} state={state} now={now} budget={budget} />
        </span>
      )}
    </span>
  );
}

/**
 * Compact always-visible usage strip for the tab bar: one row per provider (Claude,
 * Codex, z.ai), each its own hover/focus target with its own popover, plus a
 * daily-budget mini (Claude-only, unchanged from before).
 */
export function UsageStrip() {
  const multi = useMultiUsage();
  const budget = useBudget();
  return (
    <div className="cockpit-usage" aria-label="Account usage — Claude, Codex, z.ai">
      <MiniProviderRow id="claude" state={multi.claude} budget={budget} />
      <MiniProviderRow id="codex" state={multi.codex} />
      <MiniProviderRow id="zai" state={multi.zai} />
      {budget && <DayMini b={budget} stale={multi.claude.status === "stale"} />}
    </div>
  );
}

/** Full usage panel for Mission Control: one stacked block per provider + a local clock. */
export function UsagePanel() {
  const multi = useMultiUsage();
  const budget = useBudget();
  const now = useNow(1000);
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="cu-panel">
      <div className="cu-panel__label">
        <span>account usage</span>
      </div>
      <div className="cu-panel__providers">
        <ProviderGaugeGroup id="claude" state={multi.claude} now={now} budget={budget} />
        <ProviderGaugeGroup id="codex" state={multi.codex} now={now} />
        <ProviderGaugeGroup id="zai" state={multi.zai} now={now} />
      </div>
      <div className="cu-panel__clock"><b>{clock}</b><span>local</span></div>
    </div>
  );
}
```

- [ ] **Step 4: Update `UsageGauges.css`**

In `src/components/UsageGauges.css`, remove the now-dead `.cu-mini__k` rule (line 24, `.cu-mini__k { ... }` — `MiniWithReset` no longer renders a `k` label; `DayMini` still uses `.cu-mini` itself but never `.cu-mini__k`, so this specific rule is unused) and the old central-popover rule `.cu-pop { ... }` (lines 52-58, superseded by `.cu-provider-row__pop` below — the `cu-pop-in` keyframe it used is kept and reused). Also change `.cu-panel`'s `align-items: center` to `align-items: flex-start` (line 111 — the panel is no longer a single row of equal-height items now that provider blocks stack tall), and replace `.cu-panel__gauges` (lines 126, plus its responsive override at the bottom) with `.cu-panel__providers`.

Apply these edits:

Replace:
```css
.cu-mini { display: flex; align-items: center; gap: 7px; }
.cu-mini__k { font-size: 9.5px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ck-dim); }
.cu-mini__track {
```
with:
```css
.cu-mini { display: flex; align-items: center; gap: 7px; }
.cu-mini__track {
```

Replace:
```css
.cu-mini__v {
  font-size: 11.5px; font-weight: 700; color: var(--col); font-variant-numeric: tabular-nums;
  min-width: 30px; transition: color 0.5s;
}
```
with:
```css
.cu-mini__v {
  font-size: 11.5px; font-weight: 700; color: var(--col); font-variant-numeric: tabular-nums;
  min-width: 30px; transition: color 0.5s;
}
.cu-mini__t { font-size: 8.5px; color: var(--ck-dim); font-variant-numeric: tabular-nums; margin-left: 2px; }
```

Replace:
```css
/* ── hover popover (anchored to the strip) ──────────────────── */
.cu-pop {
  position: absolute; top: calc(100% + 6px); right: 8px; z-index: 60; width: 236px;
  padding: 15px 16px; background: var(--ck-surface);
  border: 1px solid var(--ck-border); border-radius: 12px;
  box-shadow: 0 22px 54px -22px #000, inset 0 1px 0 rgba(255,255,255,.03);
  animation: cu-pop-in 0.13s ease;
}
@keyframes cu-pop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.cu-pop .cu-gauge + .cu-gauge { margin-top: 15px; }
```
with:
```css
/* ── per-provider row (badge + 2 mini bars) + its own popover ──────────────── */
.cu-badge {
  display: inline-flex; align-items: center; justify-content: center;
  width: 16px; height: 16px; border-radius: 5px; flex: none;
  font-size: 9px; font-weight: 800; font-family: ui-monospace, Menlo, monospace;
  border: 1px solid currentColor; background: color-mix(in srgb, currentColor 18%, transparent);
}
.cu-badge.provider-claude { color: var(--ck-accent); }
.cu-badge.provider-codex { color: var(--ck-blue); }
.cu-badge.provider-zai { color: var(--ck-magenta); }

.cu-provider-row { display: flex; align-items: center; gap: 6px; position: relative; outline: none; cursor: default; }
.cu-provider-row:focus-visible { outline: 2px solid var(--ck-accent); outline-offset: -2px; }
.cu-provider-row.is-stale { opacity: 0.6; }
.cu-provider-row.is-na { color: var(--ck-dim); font-size: 12px; }
.cu-provider-row.is-loading { gap: 6px; }
.cu-provider-row__bars { display: flex; flex-direction: column; gap: 3px; }

@keyframes cu-pop-in { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
.cu-provider-row__pop {
  position: absolute; top: calc(100% + 6px); left: 0; z-index: 60; width: 210px;
  padding: 15px 16px; background: var(--ck-surface);
  border: 1px solid var(--ck-border); border-radius: 12px;
  box-shadow: 0 22px 54px -22px #000, inset 0 1px 0 rgba(255,255,255,.03);
  animation: cu-pop-in 0.13s ease;
}

/* ── the shared badge+gauges unit, used in the popover above AND Mission Control ── */
.cu-provider-group__head { display: flex; align-items: center; gap: 7px; margin-bottom: 12px; }
.cu-provider-group__name { font-size: 11.5px; font-weight: 700; color: var(--ck-bright); }
.cu-provider-group .cu-gauge + .cu-gauge { margin-top: 13px; }
```

Replace:
```css
.cu-panel {
  display: flex; align-items: center; gap: clamp(18px, 4vw, 36px);
```
with:
```css
.cu-panel {
  display: flex; align-items: flex-start; gap: clamp(18px, 4vw, 36px);
```

Replace:
```css
.cu-panel__gauges { flex: 1; display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: clamp(18px, 4vw, 40px); min-width: 0; }
```
with:
```css
.cu-panel__providers { flex: 1; display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.cu-provider-group { border-top: 1px solid var(--ck-border); padding-top: 16px; }
.cu-provider-group:first-child { border-top: none; padding-top: 0; }
```

Replace:
```css
@media (max-width: 720px) {
  .cu-panel { flex-wrap: wrap; }
  .cu-panel__gauges { grid-template-columns: 1fr 1fr; width: 100%; order: 3; }
}
```
with:
```css
@media (max-width: 720px) {
  .cu-panel { flex-wrap: wrap; }
  .cu-panel__providers { width: 100%; order: 3; }
}
```

- [ ] **Step 5: Run the tests**

Run: `npx vitest run src/components/UsageGauges.popover.test.tsx`
Expected: PASS (all 4 tests).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (This will also surface any remaining callers still assuming the old `useUsage`/single-`Popover` shape — there are none outside this file per Task-start's `grep`, but confirm.)

- [ ] **Step 7: Commit**

```bash
git add src/components/UsageGauges.tsx src/components/UsageGauges.css src/components/UsageGauges.popover.test.tsx
git commit -m "feat(usage): per-provider strip rows with independent popovers (Claude/Codex/z.ai)"
```

---

### Task 7: Rewrite `UsagePanel` for Mission Control — verify the stacked layout

Task 6 already rewrote `UsagePanel` (it lives in the same file). This task is the dedicated test + verification pass for it, since Mission Control's assertions (three stacked groups, budget only under Claude) are a distinct concern from the strip's popover-isolation tests in Task 6.

**Files:**
- Test: `src/components/UsageGauges.panel.test.tsx` (new)

**Interfaces:**
- Consumes: `UsagePanel` (rewritten in Task 6)

- [ ] **Step 1: Write the test**

Create `src/components/UsageGauges.panel.test.tsx`:

```typescript
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UsagePanel } from "./UsageGauges";

vi.mock("../lib/usageStore", () => ({
  useMultiUsage: () => ({
    claude: {
      report: { status: "ok", fiveHour: { utilization: 24, resetsAt: null }, sevenDay: { utilization: 41, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
    codex: {
      report: { status: "ok", fiveHour: { utilization: 31, resetsAt: null }, sevenDay: { utilization: 20, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
    zai: {
      report: { status: "ok", fiveHour: { utilization: 82, resetsAt: null }, sevenDay: { utilization: 61, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
  }),
}));
vi.mock("../lib/budgetStore", () => ({
  useBudget: () => ({
    daysLeft: 3, allowancePct: 10, usedPct: 5, remainingPct: 5, fillPct: 88, level: "amber",
    over: false, dollarsPerPct: 1, allowanceUsd: 10, usedUsd: 8, remainingUsd: 2,
    blocksRemaining: 1, unspendable: false,
  }),
}));

describe("UsagePanel — Mission Control", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("renders one provider group per provider, in order, with the budget row only under Claude", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UsagePanel />));

    const names = Array.from(container.querySelectorAll(".cu-provider-group__name")).map((el) => el.textContent);
    expect(names).toEqual(["Claude", "Codex", "z.ai"]);

    const budgetHeaders = Array.from(container.querySelectorAll(".cu-gauge__name")).filter(
      (el) => el.textContent === "today’s budget",
    );
    expect(budgetHeaders).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run src/components/UsageGauges.panel.test.tsx`
Expected: PASS. (If it fails, re-check Task 6 Step 3's `UsagePanel` body was applied correctly — this task doesn't change implementation, only adds coverage for it.)

- [ ] **Step 3: Commit**

```bash
git add src/components/UsageGauges.panel.test.tsx
git commit -m "test(usage): cover Mission Control's stacked multi-provider panel"
```

---

### Task 8: Settings UI for the z.ai monitor token

Password-style input + Save, with a live "configured ✓ / not configured" status. The token is never redisplayed.

**Files:**
- Modify: `src/components/SettingsMenu.tsx`, `src/components/SettingsMenu.css`

**Interfaces:**
- Consumes: `saveZaiToken`, `zaiTokenConfigured` (Task 4)

- [ ] **Step 1: Add the imports and state**

In `src/components/SettingsMenu.tsx`, change the import block (lines 1-8) to add one import:

```typescript
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { THEMES, themeById } from "../lib/themes";
import { MONO_FONTS, FONT_SIZE_MIN, FONT_SIZE_MAX } from "../lib/fonts";
import { DEFAULT_SETTINGS, type Settings } from "../lib/settings";
import { checkForUpdate, type Update } from "../lib/updateClient";
import { ensureNotifyPermission } from "../lib/osNotify";
import { saveZaiToken, zaiTokenConfigured } from "../lib/usageClient";
import "./SettingsMenu.css";
```

Add new state right after the existing `checkState` line (line 17):

```typescript
  const [checkState, setCheckState] = useState<"idle" | "checking" | "uptodate">("idle");
  const [zaiToken, setZaiToken] = useState("");
  const [zaiConfigured, setZaiConfigured] = useState<boolean | null>(null);
  const [zaiSaving, setZaiSaving] = useState(false);
```

Add an effect right after the existing `getVersion` effect (line 25):

```typescript
  useEffect(() => { getVersion().then(setVersion).catch(() => setVersion("")); }, []);
  useEffect(() => { zaiTokenConfigured().then(setZaiConfigured).catch(() => setZaiConfigured(false)); }, []);
```

Add a handler right after the existing `check()` function (after line 31, before `const accentValue = ...`):

```typescript
  async function saveZai() {
    setZaiSaving(true);
    try {
      await saveZaiToken(zaiToken);
      setZaiToken("");
      setZaiConfigured(await zaiTokenConfigured());
    } finally {
      setZaiSaving(false);
    }
  }
```

- [ ] **Step 2: Add the row**

Insert this block right before the existing "Updates" row (before line 171, `<div className="settings__row">` that contains `<span className="settings__name">Updates</span>`):

```tsx
        <div className="settings__row">
          <div className="settings__label">
            <span className="settings__name">z.ai monitor token</span>
            <span className="settings__desc">shows the z.ai (GLM Coding Plan) usage gauge — token from your own z.ai account, saved in macOS Keychain</span>
          </div>
          <div className="settings__control settings__control--column">
            <div className="settings__zai-row">
              <input
                className="settings__zai-input"
                type="password"
                placeholder={zaiConfigured ? "•••••••• (configured)" : "paste monitor token"}
                value={zaiToken}
                onChange={(e) => setZaiToken(e.target.value)}
                aria-label="z.ai monitor token"
              />
              <button type="button" className="settings__btn" onClick={saveZai} disabled={zaiSaving}>
                {zaiSaving ? "saving…" : "save"}
              </button>
            </div>
            <span className={`settings__zai-status${zaiConfigured ? " is-on" : ""}`}>
              {zaiConfigured === null ? "…" : zaiConfigured ? "✓ configured" : "not configured"}
            </span>
          </div>
        </div>

```

- [ ] **Step 3: Style it**

Append to `src/components/SettingsMenu.css`:

```css
/* --- z.ai monitor token --- */
.settings__control--column { flex-direction: column; align-items: flex-end; gap: 6px; }
.settings__zai-row { display: flex; gap: 8px; }
.settings__zai-input { font-family: inherit; font-size: 12.5px; color: var(--ck-bright); background: var(--ck-surface);
  border: 1px solid var(--ck-border); border-radius: 8px; padding: 7px 10px; width: 170px; outline: none; }
.settings__zai-input:focus-visible { outline: 2px solid var(--ck-accent); outline-offset: 2px; }
.settings__zai-status { font-size: 11px; color: var(--ck-dim); }
.settings__zai-status.is-on { color: var(--ck-green); font-weight: 600; }
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual verification**

1. `npm run tauri dev`, open Settings.
2. New row "z.ai monitor token" shows "not configured" (assuming Task 3's manual test cleared it).
3. Paste any text, click "save" → status flips to "✓ configured", input clears.
4. Close and reopen Settings → still shows "✓ configured" (confirms the Keychain round-trip, not just local state).
5. Clear the field (leave it empty) and click "save" → status flips back to "not configured".

- [ ] **Step 6: Commit**

```bash
git add src/components/SettingsMenu.tsx src/components/SettingsMenu.css
git commit -m "feat(settings): add z.ai monitor token field (Keychain-backed)"
```

---

### Task 9: Docs corrections

Two rows in `docs/codex-support-matrix.md` need fixing: row "Token used display" overclaims (no code reads Codex `token_count` for a cumulative pane-header total — that's a *different*, still-unbuilt metric from the rate-limit % gauges this plan adds), and row "Usage / rate-limit gauges" is now stale (it currently says "Partial | Claude only", but Codex and z.ai now have their own collectors). `CONTEXT.md`'s **Usage** term is Claude-specific; amend it.

**Files:**
- Modify: `docs/codex-support-matrix.md`, `CONTEXT.md`

- [ ] **Step 1: Correct the "Token used display" row**

In `docs/codex-support-matrix.md`, replace line 16:

```
| Token used display | Yes | Implemented after v0.7.0 | Claude panes sum Claude usage from session logs. Codex panes read local Codex `token_count` events and show total tokens in the pane header and Mission Control. |
```

with:

```
| Token used display | Partial | Claude only | Claude panes sum Claude usage from session logs and show it in the pane header/Mission Control. Codex has no equivalent cumulative per-session token count yet — a different metric from the 5h/weekly rate-limit % below, which Codex now has. |
```

- [ ] **Step 2: Correct the "Usage / rate-limit gauges" row**

In the same file, replace line 29 (now that Step 1 shifted nothing — replacements are same-line-count):

```
| Usage / rate-limit gauges | Partial | Claude only | Existing gauges are Claude-account-specific. Codex has different account/rate-limit surfaces, so it needs separate provider-specific usage collectors. |
```

with:

```
| Usage / rate-limit gauges | Yes | Implemented | Codex reads local `~/.codex/sessions` rollout files (`usage_report_codex`, no network); z.ai reads its official monitor API with a Keychain-saved token (`usage_report_zai`). Both show 5h/weekly % + reset time in the tab-bar strip and Mission Control, same as Claude. |
```

- [ ] **Step 3: Amend `CONTEXT.md`'s Usage term**

In `CONTEXT.md`, replace:

```
**Usage**:
How much of your Claude account's rate limit you've consumed in a rolling window, as a
percentage (0–100% utilization) plus a reset time. Read live from your account, NOT derived
from session logs. Distinct from **Cost** — Cost is USD spent, Usage is % of limit left.
_Avoid_: cost, quota, tokens-left, rate (be specific)
```

with:

```
**Usage**:
How much of an account's rate limit you've consumed in a rolling window, as a percentage
(0–100% utilization) plus a reset time. Read live from the account/local session data, NOT
derived from cost logs. Tracked independently for all three providers Cockpit shows usage
for — Claude, Codex, z.ai — each provider's own Usage, never combined into one number.
Distinct from **Cost** — Cost is USD spent, Usage is % of limit left; Cost stays Claude-only
(Codex/z.ai have no comparable per-turn cost log).
_Avoid_: cost, quota, tokens-left, rate (be specific)
```

- [ ] **Step 4: Commit**

```bash
git add docs/codex-support-matrix.md CONTEXT.md
git commit -m "docs: correct Codex token-display claim, mark rate-limit gauges implemented"
```

---

### Task 10: Full verification pass

- [ ] **Step 1: Rust tests**

Run: `cd src-tauri && cargo test`
Expected: all pass, including the new `usage_time`, `usage_codex`, `usage_zai` modules alongside the existing `usage`/`cost` tests.

- [ ] **Step 2: Rust build**

Run: `cd src-tauri && cargo build`
Expected: compiles clean (warnings from pre-existing code are fine; no NEW warnings from the files this plan touched).

- [ ] **Step 3: Frontend tests**

Run: `npm test`
Expected: all pass (existing suites + the new `usageStore.test.ts`, `UsageGauges.popover.test.tsx` rewrite, `UsageGauges.panel.test.tsx`).

- [ ] **Step 4: Frontend typecheck + build**

Run: `npm run build`
Expected: PASS (this runs `tsc` then `vite build`).

- [ ] **Step 5: Manual end-to-end run**

1. `npm run tauri dev`.
2. Tab-bar strip: confirm 3 badges (C/X/Z) each show their own 2 mini bars with trailing reset-time text (or their own na-state if you have no Codex sessions / no z.ai token saved).
3. Hover/focus each badge in turn: confirm each opens its OWN popover (not a shared one), each showing `resets in <countdown> (<clock time>)`.
4. Open Mission Control (Dashboard): confirm 3 stacked provider blocks in order Claude/Codex/z.ai, with the daily-budget gauge appearing only under Claude's block.
5. Open Settings: confirm the z.ai token row works (per Task 8 Step 5, if not already re-verified).
6. Leave the app running ~90s: confirm the baseline poll updates the gauges without any provider's failure freezing the others (watch dev console for invoke errors — a z.ai network failure should only affect the z.ai badge).

- [ ] **Step 6: Fix anything Step 1-5 surfaced, then commit**

If everything passed cleanly, there's nothing to commit here — this task is verification-only. If Step 5 surfaced a real bug, fix it, re-run the relevant step, then:

```bash
git add -A
git commit -m "fix(usage): <describe what Step 5 surfaced>"
```

---

## Self-Review

- **Spec coverage:** Three independent commands, same wire shape (Task 2, 3 — no `usage.rs` changes). Codex multi-file newest-snapshot scan (Task 2). z.ai `(unit,number)` window matching + Keychain read/write with empty-clears-entry (Task 3). Shared poller + `Promise.allSettled` failure isolation (Task 5). `ProviderGaugeGroup` reused in both the per-provider popover and Mission Control (Task 6, 7). `naLabel` per provider (Task 6). Settings UI, write-only token (Task 8). Status-mapping table's three per-provider `no_token`/`error` meanings — encoded directly in each collector's `report(...)` branches (Task 2's `.is_dir()`/no-snapshot split, Task 3's missing-token vs curl-failure split) and in `NA_LABEL` (Task 6). Out-of-scope boundary (`providers.ts` untouched, `budget.ts` untouched) — verified by this plan never listing those files as touched. Docs correction — Task 9, both matrix rows plus `CONTEXT.md`.
- **Placeholder scan:** every step carries full code; the only "read the file first"-style deferral in the reference plan this one is modeled on doesn't appear here — every JSX/CSS insertion point is quoted exactly from the files read during planning.
- **Type consistency:** `UsageReport`/`UsageWindow` (unchanged, from `usage.rs`) used identically across `usage_codex.rs`/`usage_zai.rs`. `ProviderId = AgentProvider` used consistently in `usageStore.ts` and `UsageGauges.tsx`. `MultiUsageState`/`UsageState` shapes match between the store (Task 5) and every consumer (Task 6, 7). `NA_LABEL`/`naLabel` prop name consistent between `Gauge`, `ProviderGaugeGroup`, and `MiniProviderRow`. Command names (`usage_report_codex`, `usage_report_zai`, `save_zai_token`, `zai_token_configured`) match exactly between Rust `#[tauri::command]` fns, `lib.rs` registration, and the TS `invoke(...)` calls in `usageClient.ts`.

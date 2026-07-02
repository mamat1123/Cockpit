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
    let resets_at = limit
        .get("nextResetTime")
        .and_then(|x| x.as_i64())
        .and_then(unix_ms_to_iso);
    Some(UsageWindow { utilization: percentage, resets_at })
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
    fn five_hour_window_without_reset_time_is_ok() {
        // Real z.ai response shape at 0% usage: the 5-hour window omits nextResetTime
        // entirely (the window hasn't started counting down yet).
        let body = br#"{"data":{"limits":[
            {"type":"TOKENS_LIMIT","unit":3,"number":5,"percentage":0},
            {"type":"TOKENS_LIMIT","unit":6,"number":1,"percentage":1,"nextResetTime":1783353822988}
        ]}}"#;
        let r = report_from_body(body);
        assert_eq!(r.status, "ok");
        assert_eq!(r.five_hour.as_ref().unwrap().utilization, 0.0);
        assert_eq!(r.five_hour.as_ref().unwrap().resets_at, None);
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

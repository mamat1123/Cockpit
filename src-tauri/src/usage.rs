use serde::Serialize;
use serde_json::Value;
use std::process::Command;

/// One rolling rate-limit window: how much of it you've burned (0–100) + when it resets.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub utilization: f64,
    pub resets_at: Option<String>,
}

/// Live account usage. `status` lets the UI degrade gracefully without throwing:
/// "ok" (windows present), "no_token" (not signed in / token expired), "error" (network/parse).
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageReport {
    pub status: String,
    pub five_hour: Option<UsageWindow>,
    pub seven_day: Option<UsageWindow>,
}

fn report(status: &str) -> UsageReport {
    UsageReport { status: status.into(), five_hour: None, seven_day: None }
}

/// Pull the OAuth access token the same way statusline.sh does:
/// env override → macOS keychain ("Claude Code-credentials") → ~/.claude/.credentials.json.
fn oauth_token() -> Option<String> {
    if let Ok(t) = std::env::var("CLAUDE_CODE_OAUTH_TOKEN") {
        if !t.is_empty() {
            return Some(t);
        }
    }
    #[cfg(target_os = "macos")]
    {
        if let Ok(out) = Command::new("security")
            .args(["find-generic-password", "-s", "Claude Code-credentials", "-w"])
            .output()
        {
            if out.status.success() {
                if let Some(t) = token_from_blob(&String::from_utf8_lossy(&out.stdout)) {
                    return Some(t);
                }
            }
        }
    }
    let home = std::env::var_os("HOME")?;
    let creds = std::path::PathBuf::from(home).join(".claude").join(".credentials.json");
    token_from_blob(&std::fs::read_to_string(creds).ok()?)
}

/// Extract `claudeAiOauth.accessToken` from a credentials JSON blob.
fn token_from_blob(blob: &str) -> Option<String> {
    let v: Value = serde_json::from_str(blob).ok()?;
    v.get("claudeAiOauth")
        .and_then(|o| o.get("accessToken"))
        .and_then(|t| t.as_str())
        .filter(|s| !s.is_empty())
        .map(str::to_string)
}

/// Parse one `{utilization, resets_at}` window out of the usage JSON, or None if absent/null.
fn window_from(v: &Value, key: &str) -> Option<UsageWindow> {
    let w = v.get(key)?;
    if !w.is_object() {
        return None;
    }
    Some(UsageWindow {
        utilization: w.get("utilization").and_then(|x| x.as_f64())?,
        resets_at: w.get("resets_at").and_then(|x| x.as_str()).map(str::to_string),
    })
}

/// Turn a successful response body into a report; "ok" requires the five_hour window.
/// A body without five_hour but with an `error`/`type:error` is an auth failure (expired
/// token) → "no_token"; anything else unparseable → "error".
fn report_from_body(body: &[u8]) -> UsageReport {
    let v: Value = match serde_json::from_slice(body) {
        Ok(v) => v,
        Err(_) => return report("error"),
    };
    if v.get("five_hour").map(|x| x.is_object()) != Some(true) {
        let is_auth = v.get("error").is_some()
            || v.get("type").and_then(|t| t.as_str()) == Some("error");
        return report(if is_auth { "no_token" } else { "error" });
    }
    UsageReport {
        status: "ok".into(),
        five_hour: window_from(&v, "five_hour"),
        seven_day: window_from(&v, "seven_day"),
    }
}

/// Where statusline.sh caches the raw usage response (refreshed ~60s while any claude
/// statusline is live). A keychain-/auth-free source the GUI can always read from /tmp.
const STATUSLINE_CACHE: &str = "/tmp/claude/statusline-usage-cache.json";

/// curl the usage endpoint with the bearer token; Some(body) on HTTP success.
fn curl_usage(token: &str) -> Option<Vec<u8>> {
    match Command::new("curl")
        .args([
            "-s",
            "--max-time",
            "8",
            "-H",
            &format!("Authorization: Bearer {token}"),
            "-H",
            "anthropic-beta: oauth-2025-04-20",
            "-H",
            "Content-Type: application/json",
            "https://api.anthropic.com/api/oauth/usage",
        ])
        .output()
    {
        Ok(o) if o.status.success() && !o.stdout.is_empty() => Some(o.stdout),
        _ => None,
    }
}

/// statusline.sh's cached usage response, parsed — Some only when it carries live windows.
fn report_from_cache() -> Option<UsageReport> {
    let body = std::fs::read(STATUSLINE_CACHE).ok()?;
    let r = report_from_body(&body);
    if r.status == "ok" {
        Some(r)
    } else {
        None
    }
}

fn fetch_usage() -> UsageReport {
    // 1) Live read: OAuth token (keychain) → curl. Freshest, preferred.
    let token = oauth_token();
    if let Some(ref t) = token {
        if let Some(body) = curl_usage(t) {
            let r = report_from_body(&body);
            if r.status == "ok" {
                return r;
            }
        }
    }
    // 2) Fallback: statusline.sh's /tmp cache (no keychain/auth needed — the GUI can always
    //    read it). Keeps the gauges populated even if the live read can't run.
    if let Some(r) = report_from_cache() {
        return r;
    }
    // 3) Nothing worked — degrade gracefully (no token vs transient error).
    if token.is_some() {
        report("error")
    } else {
        report("no_token")
    }
}

/// Live 5-hour + weekly rate-limit usage for the signed-in account. Shells out to `curl`
/// (no HTTP dependency) on a blocking pool so the up-to-8s call never stalls the UI.
#[tauri::command]
pub async fn usage_report() -> UsageReport {
    tauri::async_runtime::spawn_blocking(fetch_usage)
        .await
        .unwrap_or_else(|_| report("error"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_from_credentials_blob() {
        let blob = r#"{"claudeAiOauth":{"accessToken":"sk-abc","refreshToken":"r"}}"#;
        assert_eq!(token_from_blob(blob).as_deref(), Some("sk-abc"));
    }

    #[test]
    fn token_blob_rejects_empty_or_missing() {
        assert_eq!(token_from_blob(r#"{"claudeAiOauth":{"accessToken":""}}"#), None);
        assert_eq!(token_from_blob(r#"{"other":1}"#), None);
        assert_eq!(token_from_blob("not json"), None);
    }

    #[test]
    fn ok_report_extracts_both_windows() {
        let body = br#"{"five_hour":{"utilization":34.5,"resets_at":"2026-06-22T18:47:00Z"},
            "seven_day":{"utilization":58.0,"resets_at":"2026-06-23T00:00:00Z"}}"#;
        let r = report_from_body(body);
        assert_eq!(r.status, "ok");
        let f = r.five_hour.unwrap();
        assert_eq!(f.utilization, 34.5);
        assert_eq!(f.resets_at.as_deref(), Some("2026-06-22T18:47:00Z"));
        assert_eq!(r.seven_day.unwrap().utilization, 58.0);
    }

    #[test]
    fn null_seven_day_is_none_but_still_ok() {
        let body = br#"{"five_hour":{"utilization":10,"resets_at":"x"},"seven_day":null}"#;
        let r = report_from_body(body);
        assert_eq!(r.status, "ok");
        assert!(r.seven_day.is_none());
        assert_eq!(r.five_hour.unwrap().utilization, 10.0);
    }

    #[test]
    fn auth_error_body_maps_to_no_token() {
        let body = br#"{"type":"error","error":{"type":"authentication_error","message":"x"}}"#;
        assert_eq!(report_from_body(body).status, "no_token");
    }

    #[test]
    fn garbage_body_maps_to_error() {
        assert_eq!(report_from_body(b"<html>nope</html>").status, "error");
        assert_eq!(report_from_body(b"{}").status, "error");
    }
}

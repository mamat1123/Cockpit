use std::collections::{HashMap, HashSet};
use std::io::{Read, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Mutex;
use serde::Serialize;
use tauri::State;

/// Billable token tiers for a model in one session. Cache write tiers are split
/// because 1h writes cost 2x input while 5m writes cost 1.25x.
#[derive(Default, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Usage {
    pub input: u64,
    pub output: u64,
    pub cache_read: u64,
    pub cache_write5m: u64,
    pub cache_write1h: u64,
}

/// Parse one jsonl line; Some((message_id, model, usage)) if it carries token usage.
/// Reads ONLY the top-level `message.usage` (ignores the duplicate `iterations[]`).
/// The id is needed because Claude Code logs the SAME assistant message more than once
/// (streaming/sidechain duplicates) — summing every line double-counts cost.
pub fn parse_turn_usage(line: &str) -> Option<(String, String, Usage)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let id = msg.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let model = msg.get("model").and_then(|m| m.as_str()).unwrap_or("unknown").to_string();
    let g = |obj: &serde_json::Value, k: &str| obj.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let (w5m, w1h) = match usage.get("cache_creation") {
        Some(cc) if cc.is_object() => (g(cc, "ephemeral_5m_input_tokens"), g(cc, "ephemeral_1h_input_tokens")),
        _ => (g(usage, "cache_creation_input_tokens"), 0),
    };
    Some((id, model, Usage {
        input: g(usage, "input_tokens"),
        output: g(usage, "output_tokens"),
        cache_read: g(usage, "cache_read_input_tokens"),
        cache_write5m: w5m,
        cache_write1h: w1h,
    }))
}

/// Fold every usage-bearing line in `chunk` into `totals`, skipping any message id
/// already in `seen` (dedup). Matches `claude --cost` exactly.
pub fn accumulate(totals: &mut HashMap<String, Usage>, seen: &mut HashSet<String>, chunk: &str) {
    for line in chunk.lines() {
        if let Some((id, model, u)) = parse_turn_usage(line) {
            if !id.is_empty() && !seen.insert(id) {
                continue; // duplicate message — already counted
            }
            let e = totals.entry(model).or_default();
            e.input += u.input;
            e.output += u.output;
            e.cache_read += u.cache_read;
            e.cache_write5m += u.cache_write5m;
            e.cache_write1h += u.cache_write1h;
        }
    }
}

struct CostState { offset: u64, totals: HashMap<String, Usage>, seen: HashSet<String> }

#[derive(Default)]
pub struct CostManager(pub Mutex<HashMap<String, CostState>>);

/// Per-model token totals for a pane's own session log. Incremental: only bytes
/// appended since the last call are parsed (complete lines only — a half-written
/// trailing line is left for next time). Deduped by message id across the session.
#[tauri::command]
pub fn session_usage(mgr: State<CostManager>, cwd: String, session_id: String) -> HashMap<String, Usage> {
    let home = match std::env::var_os("HOME") { Some(h) => PathBuf::from(h), None => return HashMap::new() };
    let path = crate::logtail::session_log_path(&home, &cwd, &session_id);

    let mut map = mgr.0.lock().unwrap();
    let state = map.entry(session_id.clone())
        .or_insert_with(|| CostState { offset: 0, totals: HashMap::new(), seen: HashSet::new() });

    let len = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    if len < state.offset { state.offset = 0; state.totals.clear(); state.seen.clear(); }
    if len > state.offset {
        if let Ok(mut f) = std::fs::File::open(&path) {
            if f.seek(SeekFrom::Start(state.offset)).is_ok() {
                let mut buf = String::new();
                if f.take(len - state.offset).read_to_string(&mut buf).is_ok() {
                    if let Some(idx) = buf.rfind('\n') {
                        accumulate(&mut state.totals, &mut state.seen, &buf[..idx]);
                        state.offset += (idx + 1) as u64;
                    }
                }
            }
        }
    }
    state.totals.clone()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_assistant_usage_with_cache_split() {
        let line = r#"{"type":"assistant","message":{"id":"msg_1","model":"claude-opus-4-8","usage":{"input_tokens":18110,"cache_creation_input_tokens":6754,"cache_read_input_tokens":17551,"output_tokens":3183,"cache_creation":{"ephemeral_5m_input_tokens":0,"ephemeral_1h_input_tokens":6754}}}}"#;
        let (id, m, u) = parse_turn_usage(line).unwrap();
        assert_eq!(id, "msg_1");
        assert_eq!(m, "claude-opus-4-8");
        assert_eq!(u.input, 18110);
        assert_eq!(u.output, 3183);
        assert_eq!(u.cache_read, 17551);
        assert_eq!(u.cache_write5m, 0);
        assert_eq!(u.cache_write1h, 6754);
    }

    #[test]
    fn falls_back_to_flat_cache_creation_as_5m() {
        let line = r#"{"type":"assistant","message":{"id":"m","model":"x","usage":{"input_tokens":10,"output_tokens":2,"cache_creation_input_tokens":50,"cache_read_input_tokens":7}}}"#;
        let (_, _, u) = parse_turn_usage(line).unwrap();
        assert_eq!(u.cache_write5m, 50);
        assert_eq!(u.cache_write1h, 0);
    }

    #[test]
    fn ignores_non_usage_lines() {
        assert!(parse_turn_usage(r#"{"type":"user","message":{"role":"user","content":"hi"}}"#).is_none());
        assert!(parse_turn_usage("not json").is_none());
    }

    #[test]
    fn dedupes_repeated_message_ids() {
        // Claude Code logs the same assistant message twice; we must count it ONCE.
        let line = r#"{"message":{"id":"msg_x","model":"m","usage":{"input_tokens":100,"output_tokens":5,"cache_read_input_tokens":0}}}"#;
        let mut totals = HashMap::new();
        let mut seen = HashSet::new();
        accumulate(&mut totals, &mut seen, &format!("{line}\n{line}"));
        assert_eq!(totals["m"].input, 100); // not 200
        assert_eq!(totals["m"].output, 5);
    }
}

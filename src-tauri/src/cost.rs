use std::collections::{HashMap, HashSet};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
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

/// Pull the 5 billable token tiers out of a `message.usage` JSON object.
fn usage_from(usage: &serde_json::Value) -> Usage {
    let g = |obj: &serde_json::Value, k: &str| obj.get(k).and_then(|x| x.as_u64()).unwrap_or(0);
    let (w5m, w1h) = match usage.get("cache_creation") {
        Some(cc) if cc.is_object() => (g(cc, "ephemeral_5m_input_tokens"), g(cc, "ephemeral_1h_input_tokens")),
        _ => (g(usage, "cache_creation_input_tokens"), 0),
    };
    Usage {
        input: g(usage, "input_tokens"),
        output: g(usage, "output_tokens"),
        cache_read: g(usage, "cache_read_input_tokens"),
        cache_write5m: w5m,
        cache_write1h: w1h,
    }
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
    Some((id, model, usage_from(usage)))
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

fn label_from_cwd(cwd: &str) -> String {
    let segs: Vec<&str> = cwd.split('/').filter(|s| !s.is_empty()).collect();
    match segs.len() {
        0 => "—".to_string(),
        1 => segs[0].to_string(),
        n => format!("{}/{}", segs[n - 2], segs[n - 1]),
    }
}

/// (message_id, model, usage, date) for a usage-bearing line; date = YYYY-MM-DD from `timestamp`.
fn parse_turn_full(line: &str) -> Option<(String, String, Usage, String)> {
    let v: serde_json::Value = serde_json::from_str(line).ok()?;
    let msg = v.get("message")?;
    let usage = msg.get("usage")?;
    let id = msg.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
    let model = msg.get("model").and_then(|x| x.as_str()).unwrap_or("unknown").to_string();
    let date = v.get("timestamp").and_then(|x| x.as_str())
        .map(|s| s.chars().take(10).collect::<String>()).unwrap_or_default();
    Some((id, model, usage_from(usage), date))
}

/// (full cwd, first user-message title) from a session log's opening lines.
fn first_meta(path: &Path) -> (Option<String>, Option<String>) {
    let mut cwd = None;
    let mut title = None;
    if let Ok(f) = std::fs::File::open(path) {
        for line in BufReader::new(f).lines().map_while(Result::ok).take(80) {
            if cwd.is_some() && title.is_some() { break; }
            let v: serde_json::Value = match serde_json::from_str(&line) { Ok(v) => v, Err(_) => continue };
            if cwd.is_none() {
                if let Some(c) = v.get("cwd").and_then(|x| x.as_str()) { cwd = Some(c.to_string()); }
            }
            if title.is_none() && v.get("type").and_then(|t| t.as_str()) == Some("user") {
                if let Some(msg) = v.get("message") {
                    let txt = match msg.get("content") {
                        Some(serde_json::Value::String(s)) => Some(s.clone()),
                        Some(serde_json::Value::Array(a)) => a.iter().find_map(|b| {
                            if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                                b.get("text").and_then(|t| t.as_str()).map(str::to_string)
                            } else { None }
                        }),
                        _ => None,
                    };
                    if let Some(t) = txt {
                        let t = t.split_whitespace().collect::<Vec<_>>().join(" ");
                        if !t.is_empty() && !t.starts_with('<') {
                            title = Some(if t.chars().count() > 60 { t.chars().take(60).collect::<String>() + "…" } else { t });
                        }
                    }
                }
            }
        }
    }
    (cwd, title)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket { pub date: String, pub project: String, pub model: String, pub session: String, pub usage: Usage }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta { pub session: String, pub cwd: String, pub project: String, pub title: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostReport { pub buckets: Vec<Bucket>, pub sessions: Vec<SessionMeta> }

struct FileState { offset: u64, session: String }

#[derive(Default)]
struct ReportState {
    files: HashMap<PathBuf, FileState>,
    seen: HashSet<String>,
    agg: HashMap<(String, String, String), Usage>,     // (date, session, model) -> tokens
    meta: HashMap<String, (String, String, String)>,   // session -> (cwd, project, title)
}

#[derive(Default)]
pub struct CostReportManager(pub Mutex<ReportState>);

/// Cost across ALL projects, per (date, session, model) + per-session metadata.
/// Incremental per file (offset) + global message-id dedup. `async` so Tauri runs the
/// (potentially hundreds-of-MB) cold scan OFF the main thread — the UI stays responsive.
#[tauri::command]
pub async fn cost_report(mgr: State<'_, CostReportManager>) -> Result<CostReport, ()> {
    let home = match std::env::var_os("HOME") { Some(h) => PathBuf::from(h), None => return Ok(CostReport { buckets: vec![], sessions: vec![] }) };
    let root = home.join(".claude").join("projects");
    let mut st = mgr.0.lock().unwrap();

    let dirs = match std::fs::read_dir(&root) { Ok(d) => d, Err(_) => return Ok(CostReport { buckets: vec![], sessions: vec![] }) };
    for d in dirs.flatten() {
        let dpath = d.path();
        if !dpath.is_dir() { continue; }
        let files = match std::fs::read_dir(&dpath) { Ok(f) => f, Err(_) => continue };
        for f in files.flatten() {
            let p = f.path();
            if p.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
            let len = std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0);

            if !st.files.contains_key(&p) {
                let session = p.file_stem().and_then(|s| s.to_str()).unwrap_or("").to_string();
                let (cwd_opt, title_opt) = first_meta(&p);
                let cwd = cwd_opt.unwrap_or_default();
                let project = if cwd.is_empty() {
                    dpath.file_name().and_then(|s| s.to_str()).unwrap_or("—").to_string()
                } else { label_from_cwd(&cwd) };
                let title = title_opt.unwrap_or_default();
                st.meta.insert(session.clone(), (cwd, project, title));
                st.files.insert(p.clone(), FileState { offset: 0, session });
            }
            let (offset, session) = { let fs = &st.files[&p]; (fs.offset, fs.session.clone()) };
            let start = if len < offset { 0 } else { offset };

            if len > start {
                if let Ok(mut fh) = std::fs::File::open(&p) {
                    if fh.seek(SeekFrom::Start(start)).is_ok() {
                        let mut buf = String::new();
                        if fh.take(len - start).read_to_string(&mut buf).is_ok() {
                            if let Some(idx) = buf.rfind('\n') {
                                for line in buf[..idx].lines() {
                                    if !line.contains("\"usage\"") { continue; } // cheap skip: only assistant-usage lines
                                    if let Some((id, model, usage, date)) = parse_turn_full(line) {
                                        if !id.is_empty() && !st.seen.insert(id) { continue; }
                                        let e = st.agg.entry((date, session.clone(), model)).or_default();
                                        e.input += usage.input; e.output += usage.output; e.cache_read += usage.cache_read;
                                        e.cache_write5m += usage.cache_write5m; e.cache_write1h += usage.cache_write1h;
                                    }
                                }
                                st.files.get_mut(&p).unwrap().offset = start + (idx + 1) as u64;
                            }
                        }
                    }
                }
            }
        }
    }

    let buckets = st.agg.iter().map(|((date, session, model), usage)| {
        let project = st.meta.get(session).map(|m| m.1.clone()).unwrap_or_default();
        Bucket { date: date.clone(), project, model: model.clone(), session: session.clone(), usage: usage.clone() }
    }).collect();
    let sessions = st.meta.iter().map(|(session, (cwd, project, title))| SessionMeta {
        session: session.clone(), cwd: cwd.clone(), project: project.clone(), title: title.clone(),
    }).collect();
    Ok(CostReport { buckets, sessions })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project { pub cwd: String, pub label: String, pub last_used: u64 }

/// Dedupe (cwd, mtime-ms) pairs to the newest entry per cwd, newest-first.
fn pick_recent(mut rows: Vec<(String, u64)>) -> Vec<Project> {
    rows.sort_by(|a, b| b.1.cmp(&a.1));
    let mut seen = std::collections::HashSet::new();
    rows.into_iter()
        .filter(|(cwd, _)| !cwd.is_empty() && seen.insert(cwd.clone()))
        .map(|(cwd, last_used)| Project { label: label_from_cwd(&cwd), cwd, last_used })
        .collect()
}

/// Recent projects = every cwd you've run claude in, newest first.
#[tauri::command]
pub fn list_projects() -> Vec<Project> {
    let home = match std::env::var_os("HOME") { Some(h) => PathBuf::from(h), None => return vec![] };
    let root = home.join(".claude").join("projects");
    let mut rows: Vec<(String, u64)> = Vec::new();
    let dirs = match std::fs::read_dir(&root) { Ok(d) => d, Err(_) => return vec![] };
    for d in dirs.flatten() {
        if !d.path().is_dir() { continue; }
        let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
        if let Ok(files) = std::fs::read_dir(d.path()) {
            for f in files.flatten() {
                let p = f.path();
                if p.extension().and_then(|e| e.to_str()) != Some("jsonl") { continue; }
                if let Ok(m) = f.metadata().and_then(|m| m.modified()) {
                    if newest.as_ref().map_or(true, |(t, _)| m > *t) { newest = Some((m, p)); }
                }
            }
        }
        if let Some((mtime, path)) = newest {
            if let (Some(cwd), _) = first_meta(&path) {
                let ms = mtime.duration_since(std::time::UNIX_EPOCH).map(|x| x.as_millis() as u64).unwrap_or(0);
                rows.push((cwd, ms));
            }
        }
    }
    pick_recent(rows)
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

    #[test]
    fn label_from_cwd_takes_last_two_segments() {
        assert_eq!(label_from_cwd("/Users/x/Work/mee-tang/app"), "mee-tang/app");
        assert_eq!(label_from_cwd("/solo"), "solo");
    }

    #[test]
    fn parse_turn_full_extracts_date() {
        let line = r#"{"timestamp":"2026-06-21T10:20:30.000Z","message":{"id":"a","model":"m","usage":{"input_tokens":5,"output_tokens":1,"cache_read_input_tokens":0}}}"#;
        let (id, model, u, date) = parse_turn_full(line).unwrap();
        assert_eq!(id, "a"); assert_eq!(model, "m"); assert_eq!(u.input, 5); assert_eq!(date, "2026-06-21");
    }

    #[test]
    fn pick_recent_dedupes_to_newest_per_cwd_desc() {
        let r = pick_recent(vec![
            ("/a".into(), 100), ("/b".into(), 300), ("/a".into(), 200), ("".into(), 999),
        ]);
        assert_eq!(r.iter().map(|p| p.cwd.as_str()).collect::<Vec<_>>(), vec!["/b", "/a"]);
        assert_eq!(r[1].last_used, 200);
    }

    #[test]
    fn first_meta_reads_cwd_and_title() {
        let dir = std::env::temp_dir().join(format!("cockpit-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("s.jsonl");
        std::fs::write(&p, "{\"cwd\":\"/Users/x/Work/mee-tang/app\",\"type\":\"user\",\"message\":{\"content\":\"  fix the   login bug  \"}}\n").unwrap();
        let (cwd, title) = first_meta(&p);
        assert_eq!(cwd.as_deref(), Some("/Users/x/Work/mee-tang/app"));
        assert_eq!(title.as_deref(), Some("fix the login bug"));
        std::fs::remove_dir_all(&dir).ok();
    }
}

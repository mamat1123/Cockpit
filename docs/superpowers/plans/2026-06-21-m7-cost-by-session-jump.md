# Claude Cockpit — M7: Cost by session + jump/resume

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** The Cost view lists every chat **session** with its cost (period-filtered, sorted desc). Clicking a session **jumps** to it: if it's open in a pane → focus that pane; if not → open a new tab that **resumes** it (`claude --resume <sessionId>` in its cwd).

**Architecture:** Rust `cost_report` now returns `{ buckets, sessions }` — buckets gain a `session` (the log file's uuid) so the frontend can group cost per session (period-filtered); `sessions[]` carries each session's `cwd`/`project`/`title` (title = first user message). The reducer gains `Pane.resume` + an `openSession` action; the terminal registry launches `claude --resume <id>` for resumed panes. CockpitView resolves a clicked session to an open pane (focus) or a resume (new tab).

**Tech Stack:** Rust · React 19 · vitest + cargo test.

---

## Task 1: Rust — per-session cost + meta in the report

**Files:** modify `src-tauri/src/cost.rs`.

- [ ] **Step 1:** Add a first-line metadata reader (full cwd + first natural-language user message) above `cost_report`:
```rust
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
```

- [ ] **Step 2:** Replace `FileState`, `ReportState`, the serializable types, and `cost_report` with the per-session versions:
```rust
struct FileState { offset: u64, project: String, cwd: String, session: String, title: String }

#[derive(Default)]
struct ReportState {
    files: HashMap<PathBuf, FileState>,
    seen: HashSet<String>,
    agg: HashMap<(String, String, String), Usage>, // (date, session, model) -> tokens
    meta: HashMap<String, (String, String, String)>, // session -> (cwd, project, title)
}

#[derive(Default)]
pub struct CostReportManager(pub Mutex<ReportState>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket { pub date: String, pub project: String, pub model: String, pub session: String, pub usage: Usage }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta { pub session: String, pub cwd: String, pub project: String, pub title: String }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CostReport { pub buckets: Vec<Bucket>, pub sessions: Vec<SessionMeta> }

/// Cost across ALL projects, per (date, session, model) + per-session metadata.
/// Incremental per file (offset) + global message-id dedup.
#[tauri::command]
pub fn cost_report(mgr: State<CostReportManager>) -> CostReport {
    let home = match std::env::var_os("HOME") { Some(h) => PathBuf::from(h), None => return CostReport { buckets: vec![], sessions: vec![] } };
    let root = home.join(".claude").join("projects");
    let mut st = mgr.0.lock().unwrap();

    let dirs = match std::fs::read_dir(&root) { Ok(d) => d, Err(_) => return CostReport { buckets: vec![], sessions: vec![] } };
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
                st.meta.insert(session.clone(), (cwd.clone(), project.clone(), title.clone()));
                st.files.insert(p.clone(), FileState { offset: 0, project, cwd, session, title });
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
    CostReport { buckets, sessions }
}
```
(Remove the old `Bucket`/`FileState`/`ReportState`/`cost_report` definitions being replaced. Keep `usage_from`, `parse_turn_usage`, `accumulate`, `session_usage`, `label_from_cwd`, `first_cwd_label` (still used? if `first_cwd_label` is now unused, delete it), `parse_turn_full`.)

- [ ] **Step 3: test** — add inside `mod tests`:
```rust
    #[test]
    fn first_meta_reads_cwd_and_title() {
        let dir = std::env::temp_dir().join(format!("cockpit-meta-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("s.jsonl");
        std::fs::write(&p, concat!(
            "{\"cwd\":\"/Users/x/Work/mee-tang/app\",\"type\":\"user\",\"message\":{\"content\":\"  fix the   login bug  \"}}\n",
        )).unwrap();
        let (cwd, title) = first_meta(&p);
        assert_eq!(cwd.as_deref(), Some("/Users/x/Work/mee-tang/app"));
        assert_eq!(title.as_deref(), Some("fix the login bug"));
        std::fs::remove_dir_all(&dir).ok();
    }
```

- [ ] **Step 4:** `cd src-tauri && cargo test` → pass; `cargo build` → exit 0 (fix any now-unused-fn warning by deleting `first_cwd_label` if unused — it likely is now).
- [ ] **Step 5: commit** — `feat(core): cost_report returns per-session buckets + session metadata (cwd/project/title)`

---

## Task 2: Frontend — client shape + bySession aggregation (TDD)

**Files:** modify `src/lib/costClient.ts`, `src/lib/costAggregate.ts` (+ test).

- [ ] **Step 1: `costClient.ts`** — update Bucket + add types + change return:
```ts
export interface Bucket { date: string; project: string; model: string; session: string; usage: Usage }
export interface SessionMeta { session: string; cwd: string; project: string; title: string }
export interface CostReport { buckets: Bucket[]; sessions: SessionMeta[] }
export function costReport(): Promise<CostReport> { return invoke("cost_report"); }
```

- [ ] **Step 2: failing test** — append to `src/lib/costAggregate.test.ts`:
```ts
import { bySession } from "./costAggregate";

describe("bySession", () => {
  it("groups cost by session id, sorted desc", () => {
    const U = (input: number) => ({ input, output: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 });
    const data = [
      { date: "2026-06-21", project: "p", model: "claude-opus-4-8", session: "s1", usage: U(2e6) }, // $10
      { date: "2026-06-21", project: "p", model: "claude-opus-4-8", session: "s2", usage: U(1e6) }, // $5
    ];
    const r = bySession(data);
    expect(r[0]).toMatchObject({ name: "s1", usd: 10 });
    expect(r[1]).toMatchObject({ name: "s2", usd: 5 });
  });
});
```
(The earlier `Bucket` test objects now need a `session` field — add `session: "x"` to each existing test bucket in this file so they still type-check.)

- [ ] **Step 3: implement** — in `src/lib/costAggregate.ts` add:
```ts
export const bySession = (b: Bucket[]): Slice[] => groupCost(b, (x) => x.session);
```

- [ ] **Step 4:** vitest green; `npx tsc --noEmit` — expect CostView call-site errors (costReport shape changed); they're fixed in Task 4. Confirm `costAggregate.ts`/`costClient.ts` themselves are clean.
- [ ] **Step 5: commit** — `feat(lib): cost report {buckets,sessions} shape + bySession aggregation`

---

## Task 3: Model — `Pane.resume` + `openSession` + resume launch (TDD)

**Files:** modify `src/layout/paneLayout.ts` (+ test), `src/lib/terminalRegistry.ts`, `src/components/TerminalPane.tsx`, `src/components/PaneHost.tsx`.

- [ ] **Step 1: failing test** — append to `src/layout/paneLayout.test.ts`:
```ts
  it("openSession adds a tab whose pane resumes the given session", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "openSession", cwd: "/Users/x/Work/foo", sessionId: "sess-123" });
    const tab = l.tabs[l.tabs.length - 1];
    const pane = tab.rows[0].panes[0];
    expect(l.activeTabId).toBe(tab.id);
    expect(pane.cwd).toBe("/Users/x/Work/foo");
    expect(pane.sessionId).toBe("sess-123");
    expect(pane.resume).toBe(true);
  });
```

- [ ] **Step 2: implement** in `paneLayout.ts`:
  - add `resume?: boolean` to `Pane`.
  - add to `Action`: `| { type: "openSession"; cwd: string; sessionId: string }`
  - add the case:
```ts
    case "openSession": {
      const pane: Pane = { id: nextId("pane"), cwd: a.cwd, size: 1, title: defaultTitle(a.cwd), autoTitle: true, sessionId: a.sessionId, resume: true };
      const tab: Tab = { id: nextId("tab"), rows: [{ id: nextId("row"), panes: [pane], size: 1 }] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
```
  - export a finder used by the jump wiring:
```ts
export function findPaneBySession(l: Layout, sessionId: string): { tabId: string; paneId: string } | null {
  for (const t of l.tabs) for (const r of t.rows) for (const p of r.panes)
    if (p.sessionId === sessionId) return { tabId: t.id, paneId: p.id };
  return null;
}
```

- [ ] **Step 3: registry launch choice** — in `src/lib/terminalRegistry.ts`, change `acquireTerminal` to accept `resume`:
  - signature → `acquireTerminal(paneId: string, cwd: string, sessionId: string, resume: boolean)`
  - the spawn line → `const launch = resume ? \`claude --resume ${sessionId}\` : \`claude --session-id ${sessionId}\`; void spawnPty(paneId, cwd, term.cols, term.rows, launch);`

- [ ] **Step 4: thread `resume`** — `TerminalPane.tsx`: add `resume?: boolean` prop; in the mount effect call `acquireTerminal(paneId, cwd, sessionId, !!resume)`. `PaneHost.tsx`: pass `resume={pane.resume}` to `<TerminalPane>`.

- [ ] **Step 5:** `npm test` green; `npx tsc --noEmit` clean.
- [ ] **Step 6: commit** — `feat(ui): openSession action + Pane.resume → panes can resume an existing claude session`

---

## Task 4: UI — "By session" card + jump wiring

**Files:** modify `src/components/CostView.tsx`, `src/components/CostView.css`, `src/components/Dashboard.tsx`, `src/components/CockpitView.tsx`.

- [ ] **Step 1: CostView** — accept `onJump`, use the new report shape, render the list:
  - props: `export function CostView({ onJump }: { onJump: (sessionId: string, cwd: string) => void })`.
  - state: `const [report, setReport] = useState<CostReport>({ buckets: [], sessions: [] });` load via `costReport()`.
  - `const f = useMemo(() => filterByPeriod(report.buckets, period), [report, period]);` (everything else that used `buckets`/`f` stays).
  - import `bySession` and `type CostReport, SessionMeta`.
  - build the session rows:
```tsx
  const metaBy = useMemo(() => Object.fromEntries(report.sessions.map((s) => [s.session, s])), [report.sessions]);
  const sessions = bySession(f).map((s) => ({ ...s, meta: metaBy[s.name] as SessionMeta | undefined })).filter((s) => s.usd > 0);
```
  - add a card AFTER "By model" grid (or after the tier card), before the foot:
```tsx
      <div className="cost__card">
        <h4>By session</h4>
        <div className="cost__sessions">
          {sessions.length === 0 ? <p className="cost__empty">No sessions in this period.</p> :
            sessions.map((s) => (
              <button key={s.name} className="cost__srow" onClick={() => s.meta && onJump(s.name, s.meta.cwd)} title="jump to / resume this session">
                <span className="cost__sname">{s.meta?.title || s.meta?.project || s.name.slice(0, 8)}</span>
                <span className="cost__sproj">{s.meta?.project ?? ""}</span>
                <span className="cost__samt">{usd(s.usd)}</span>
                <span className="cost__sjump">↵</span>
              </button>
            ))}
        </div>
      </div>
```

- [ ] **Step 2: CostView.css** — append:
```css
.cost__sessions { display: flex; flex-direction: column; gap: 2px; max-height: 300px; overflow-y: auto; }
.cost__srow { display: grid; grid-template-columns: 1fr auto auto auto; align-items: center; gap: 12px; width: 100%;
  background: transparent; border: 0; border-radius: 8px; padding: 9px 10px; cursor: pointer; font-family: inherit; text-align: left; color: #C8CDD6; }
.cost__srow:hover { background: #181B22; }
.cost__sname { color: #EDEFF3; font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cost__sproj { color: #6B7280; font-size: 11px; white-space: nowrap; }
.cost__samt { color: #F5A623; font-size: 12.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
.cost__sjump { color: #565d68; font-size: 12px; }
.cost__srow:hover .cost__sjump { color: #F5A623; }
.cost__empty { color: #6B7280; font-size: 12px; padding: 8px 2px; }
```

- [ ] **Step 3: Dashboard** — add `onJumpSession: (sessionId: string, cwd: string) => void` to props; pass it to `<CostView onJump={onJumpSession} />`.

- [ ] **Step 4: CockpitView** — provide the handler + pass to `<Dashboard>`:
  - import `findPaneBySession` from paneLayout and `focusTerminal` (already imported).
```tsx
  const jumpSession = useCallback((sessionId: string, cwd: string) => {
    setLayout((l) => l); // no-op placeholder if needed
  }, []);
```
  Actually implement inline where `<Dashboard>` is rendered (it has `layout`/`dispatch` in scope):
```tsx
        onJumpSession={(sessionId, cwd) => {
          const hit = findPaneBySession(layout, sessionId);
          if (hit) { dispatch({ type: "focusTab", tabId: hit.tabId }); dispatch({ type: "focusPane", paneId: hit.paneId }); }
          else { dispatch({ type: "openSession", cwd, sessionId }); }
          setDashOpen(false);
          const pid = hit?.paneId;
          if (pid) requestAnimationFrame(() => requestAnimationFrame(() => focusTerminal(pid)));
        }}
```
  (For a freshly opened session the new pane mounts + auto-focuses via `attachTerminal`; only existing panes need the explicit `focusTerminal`.)

- [ ] **Step 5:** `npx tsc --noEmit` clean; `npm test` green; `npm run build` ok.
- [ ] **Step 6: commit** — `feat(ui): Cost 'By session' list — per-session cost, click to focus or resume the session`

---

## Task 5: GUI verification (owner)

- [ ] `npm run tauri dev`:
1. ⌘0 → Cost. A **By session** list shows each session (title/project) + its cost, sorted, scrollable, period-aware.
2. Click a session that's **open** → jumps to that pane + focuses it.
3. Click a session that's **closed** → a new tab opens running `claude --resume <id>` in its cwd (the prior conversation comes back).
4. Totals/charts unaffected; sessions/jump/pop-out/resize all still work.

Report pass/fail.

- [ ] **Wrap-up:** SPEC.md (cost by-session + resume done); commit `docs: M7 done`.

---

## Self-review
**Spec coverage:** per-session cost (Task 1 buckets+meta, Task 2 bySession), list w/ price (Task 4), click→focus-if-open / resume-if-closed (Task 3 openSession+resume launch, Task 4 jump wiring). Period-aware (buckets carry session, filtered before bySession).
**Placeholder scan:** Task 4 Step 4 shows one stray placeholder snippet (`jumpSession` no-op) — IGNORE it; implement the inline `onJumpSession` version shown directly after. (Note to implementer: do NOT add the no-op; use the inline handler.)
**Type consistency:** Rust `CostReport{buckets:Bucket[],sessions:SessionMeta[]}` (camelCase, Bucket.session) == TS; `acquireTerminal(...,resume)`, `Pane.resume`, `openSession{cwd,sessionId}`, `findPaneBySession`, `bySession`, CostView `onJump`, Dashboard `onJumpSession` consistent.
**Caveats:** resume opens a fresh pane (its own xterm); the session's prior scrollback is restored by `claude --resume`, not by us. Title = first user message (may be "hello" etc.). Sessions with $0 in the period are hidden.

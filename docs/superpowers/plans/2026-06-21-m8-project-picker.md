# Claude Cockpit — M8: Project / repo picker

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Open a new tab in ANY repo, not just the hardcoded `DEFAULT_CWD`. A command-palette launcher (the `+` button or ⌘O) lists recent projects (every cwd you've run `claude` in, newest first), filters as you type, lets you paste an absolute path for a new repo, and opens the chosen repo in a new tab.

**Architecture:** Rust `list_projects()` scans `~/.claude/projects/*`, reads each dir's newest log's cwd + mtime, dedupes by cwd, returns recent-first. Reducer `newTab` gains an optional `cwd`. A `ProjectPicker` overlay (HUD style) drives it; CockpitView opens it from `+`/⌘O and dispatches `newTab` with the picked cwd.

**Tech Stack:** Rust · React 19 · vitest + cargo test. (No native folder dialog in v1 — recent list + typed absolute path; the Tauri dialog plugin is a fast-follow.)

---

## Task 1: Rust — `list_projects`

**Files:** modify `src-tauri/src/cost.rs` (reuses `first_meta`, `label_from_cwd`), `src-tauri/src/lib.rs`.

- [ ] **Step 1:** add to `cost.rs` (after `cost_report`):
```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Project { pub cwd: String, pub label: String, pub last_used: u64 }

/// Dedupe (cwd, mtime) pairs to the newest entry per cwd, newest-first.
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
        // newest jsonl in this project dir
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
                let ms = mtime.duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
                rows.push((cwd, ms));
            }
        }
    }
    pick_recent(rows)
}
```

- [ ] **Step 2: test** (inside `mod tests`):
```rust
    #[test]
    fn pick_recent_dedupes_to_newest_per_cwd_desc() {
        let r = pick_recent(vec![
            ("/a".into(), 100), ("/b".into(), 300), ("/a".into(), 200), ("".into(), 999),
        ]);
        assert_eq!(r.iter().map(|p| p.cwd.as_str()).collect::<Vec<_>>(), vec!["/b", "/a"]);
        assert_eq!(r[1].last_used, 200); // newest /a kept
    }
```

- [ ] **Step 3: register** in `lib.rs`: add `cost::list_projects,` to `generate_handler![...]` (no manager needed).
- [ ] **Step 4:** `cd src-tauri && cargo test` pass; `cargo build` exit 0.
- [ ] **Step 5: commit** — `feat(core): list_projects — recent repos (cwd/label/last-used) from logs`

---

## Task 2: client + reducer `newTab(cwd?)` (TDD)

**Files:** create `src/lib/projectsClient.ts`; modify `src/layout/paneLayout.ts` (+ test).

- [ ] **Step 1: `src/lib/projectsClient.ts`:**
```ts
import { invoke } from "@tauri-apps/api/core";
export interface Project { cwd: string; label: string; lastUsed: number }
export function listProjects(): Promise<Project[]> { return invoke("list_projects"); }
```

- [ ] **Step 2: failing test** — append to `src/layout/paneLayout.test.ts`:
```ts
  it("newTab can open in a specific cwd", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/Users/x/Work/other" });
    const tab = l.tabs[l.tabs.length - 1];
    expect(tab.rows[0].panes[0].cwd).toBe("/Users/x/Work/other");
    expect(l.activeTabId).toBe(tab.id);
  });
  it("newTab without cwd inherits the focused pane's cwd", () => {
    const l = reduce(initLayout(CWD), { type: "newTab" });
    expect(l.tabs[l.tabs.length - 1].rows[0].panes[0].cwd).toBe(CWD);
  });
```

- [ ] **Step 3: implement** in `paneLayout.ts`:
  - change the `newTab` action type to `| { type: "newTab"; cwd?: string }`
  - in the `newTab` case, `const row = makeRow(a.cwd ?? focusedCwd(l));` (rest unchanged).

- [ ] **Step 4:** vitest green; `npx tsc --noEmit` clean (existing `dispatch({type:"newTab"})` callers still valid).
- [ ] **Step 5: commit** — `feat(ui): newTab accepts an optional cwd; list_projects client`

---

## Task 3: ProjectPicker overlay

**Files:** create `src/components/ProjectPicker.tsx`, `src/components/ProjectPicker.css`.

- [ ] **Step 1: `ProjectPicker.tsx`:**
```tsx
import { useEffect, useMemo, useRef, useState } from "react";
import { listProjects, type Project } from "../lib/projectsClient";
import "./ProjectPicker.css";

interface Row { cwd: string; label: string; sub: string; typed?: boolean }

function rel(ms: number, now: number): string {
  if (!ms) return "";
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function ProjectPicker({ onPick, onClose }: { onPick: (cwd: string) => void; onClose: () => void }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const now = Date.now();
  useEffect(() => { listProjects().then(setProjects).catch(() => {}); }, []);

  const rows: Row[] = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const typed = q.trim().startsWith("/")
      ? [{ cwd: q.trim(), label: "Open path", sub: q.trim(), typed: true }]
      : [];
    const matched = projects
      .filter((p) => !ql || p.label.toLowerCase().includes(ql) || p.cwd.toLowerCase().includes(ql))
      .map((p) => ({ cwd: p.cwd, label: p.label, sub: `${p.cwd}  ·  ${rel(p.lastUsed, now)}` }));
    return [...typed, ...matched];
  }, [projects, q, now]);

  useEffect(() => { setSel(0); }, [q]);
  const pick = (i: number) => { const r = rows[i]; if (r) onPick(r.cwd); };

  return (
    <div className="picker" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="picker__panel" role="dialog" aria-label="Open project">
        <input
          className="picker__input"
          autoFocus
          placeholder="Open project — type to filter, or paste an absolute path…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") { e.preventDefault(); onClose(); }
            else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, rows.length - 1)); }
            else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
            else if (e.key === "Enter") { e.preventDefault(); pick(sel); }
          }}
        />
        <div className="picker__list">
          {rows.length === 0 ? (
            <p className="picker__empty">No recent projects. Paste an absolute path to open one.</p>
          ) : (
            rows.map((r, i) => (
              <button
                key={r.cwd + i}
                className={`picker__row${i === sel ? " is-sel" : ""}`}
                onMouseEnter={() => setSel(i)}
                onClick={() => pick(i)}
              >
                <span className="picker__label">{r.typed ? "↳ " : ""}{r.label}</span>
                <span className="picker__sub">{r.sub}</span>
              </button>
            ))
          )}
        </div>
        <div className="picker__foot"><kbd>↑↓</kbd> move · <kbd>↵</kbd> open · <kbd>esc</kbd> cancel</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `ProjectPicker.css`:**
```css
.picker { position: fixed; inset: 0; z-index: 60; background: rgba(8,9,12,.6); backdrop-filter: blur(3px);
  display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; animation: picker-in .12s ease; }
@keyframes picker-in { from { opacity: 0; } to { opacity: 1; } }
.picker__panel { width: min(560px, 92vw); background: #0E1014; border: 1px solid #2A2F3A; border-radius: 14px;
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.6); overflow: hidden; font-family: ui-monospace, Menlo, monospace; }
.picker__input { width: 100%; box-sizing: border-box; background: #14161B; border: 0; border-bottom: 1px solid #262A33;
  color: #EDEFF3; font: 14px ui-monospace, Menlo, monospace; padding: 16px 18px; outline: none; }
.picker__input::placeholder { color: #565d68; }
.picker__list { max-height: 360px; overflow-y: auto; padding: 6px; }
.picker__row { display: flex; flex-direction: column; gap: 3px; width: 100%; text-align: left; background: transparent;
  border: 0; border-radius: 9px; padding: 10px 12px; cursor: pointer; }
.picker__row.is-sel { background: #1b2029; }
.picker__label { color: #EDEFF3; font-size: 13px; font-weight: 600; }
.picker__row.is-sel .picker__label { color: #F5A623; }
.picker__sub { color: #6B7280; font-size: 11px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.picker__empty { color: #6B7280; font-size: 12.5px; padding: 18px; }
.picker__foot { border-top: 1px solid #262A33; padding: 9px 14px; color: #565d68; font-size: 11px; }
.picker__foot kbd { background: #20242d; border: 1px solid #262A33; border-radius: 4px; padding: 0 5px; color: #C8CDD6; }
```

- [ ] **Step 3:** `npx tsc --noEmit` clean (ProjectPicker self-contained). **commit** — `feat(ui): ProjectPicker launcher overlay`

---

## Task 4: wire — `+`/⌘O open the picker → new tab in the picked repo

**Files:** modify `src/components/CockpitView.tsx`, `src/components/TabBar.tsx`, `src/layout/useKeybindings.ts`.

- [ ] **Step 1: `useKeybindings.ts`** — add a 3rd optional param + ⌘O:
  - signature → `export function useKeybindings(dispatch, onToggleDashboard?, onOpenProject?)`
  - in the key switch add: `else if (k === "o") { e.preventDefault(); onOpenProject?.(); }`
  - add `onOpenProject` to the effect deps array.

- [ ] **Step 2: `CockpitView.tsx`:**
  - `import { ProjectPicker } from "./ProjectPicker";`
  - `const [pickerOpen, setPickerOpen] = useState(false);`
  - change the keybindings call → `useKeybindings(dispatch, toggleDash, () => setPickerOpen(true));`
  - pass `onOpenPicker={() => setPickerOpen(true)}` to `<TabBar .../>`.
  - render, alongside the Dashboard block:
```tsx
      {pickerOpen && (
        <ProjectPicker
          onClose={() => setPickerOpen(false)}
          onPick={(cwd) => { dispatch({ type: "newTab", cwd }); setPickerOpen(false); }}
        />
      )}
```

- [ ] **Step 3: `TabBar.tsx`** — make `+` open the picker instead of an instant new tab. Add `onOpenPicker: () => void;` to props; change the `+` button's `onClick={onNewTab}` → `onClick={onOpenPicker}` and its `aria-label`/`title` to `"Open project (⌘O)"`. (Keep `onNewTab` in props/usage elsewhere — ⌘T still does an instant same-cwd new tab via useKeybindings; the `+` now opens the picker.)

- [ ] **Step 4:** `npx tsc --noEmit` clean; `npm test` green; `npm run build` ok.
- [ ] **Step 5: commit** — `feat(ui): + button and Cmd+O open the project picker → new tab in any repo`

---

## Task 5: GUI verification (owner)

- [ ] `npm run tauri dev`:
1. Click **+** (or **⌘O**) → launcher opens with your recent repos (mee-tang/app, ai-trading-bot, nurse-scheduling, talance, wiki…), newest first, each with path + last-used.
2. Type to filter; ↑↓ + ↵ or click → a **new tab opens in that repo** (its pane runs claude there).
3. Paste an absolute path to a repo you've never used → "↳ Open path" → opens a tab there.
4. ⌘T still makes an instant new tab in the current repo; split/resize/dashboard/cost unaffected.

Report pass/fail.

- [ ] **Wrap-up:** SPEC.md (project picker done); commit `docs: M8 done`.

---

## Self-review
**Spec coverage:** open any repo (Task 1 recent list + Task 3 typed-path + Task 4 wiring), newTab(cwd) (Task 2). Native folder dialog deferred (typed absolute path covers new repos).
**Placeholder scan:** none.
**Type consistency:** Rust `Project{cwd,label,lastUsed}` (camelCase) == TS `Project`; `list_projects`==`listProjects`; `newTab.cwd?`; `useKeybindings(dispatch,onToggleDashboard?,onOpenProject?)`; `TabBar.onOpenPicker`; `ProjectPicker{onPick,onClose}`.
**Caveats:** recent list only shows repos already used with claude; new repos via pasted absolute path (must start with `/`; `~` not expanded in v1). Invalid paths surface as the pane's pty spawn error.

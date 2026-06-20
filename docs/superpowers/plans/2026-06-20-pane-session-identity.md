# Per-pane Session Identity + Pop-out Preserves Session — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give each pane its own claude session (deterministic `--session-id`) so names/activity are per-pane, and make pop-out preserve the running session by mounting panes once and portaling them into layout slots.

**Architecture:** Bug A — `Pane.sessionId` (uuid); the pane auto-runs `claude --session-id <uuid>`; topic/logtail read the exact `<uuid>.jsonl`. Bug B — a top-level `PaneHost` mounts every `TerminalPane` once and `createPortal`s it into its current slot `<div>`; moving a pane between tabs only retargets the portal, so xterm+PTY+scrollback survive.

**Tech Stack:** Tauri (Rust + portable-pty), React 18 (`react-dom` portals), xterm.js, vitest (node env, pure-logic tests), `cargo test`.

**Reference spec:** `docs/superpowers/specs/2026-06-20-pane-session-identity-design.md`

**Conventions:**
- Frontend tests: `npx vitest run <file>` / `npm test`. Typecheck: `npx tsc --noEmit`. Rust tests: `cd src-tauri && cargo test`.
- Commits: plain conventional-commit, **no Co-Authored-By, no "Generated with Claude" line** (hard repo rule). Project commits to `main` (solo workflow).
- Repo root: `/Users/theerametsaengsin/Work/claude-cockpit`.

---

## File Structure
**Modify:** `src/layout/paneLayout.ts` (+ test), `src/components/TerminalPane.tsx`, `src/components/TabPanes.tsx`, `src/components/CockpitView.tsx`, `src/lib/ptyClient.ts`, `src/lib/logClient.ts`, `src-tauri/src/pty.rs`, `src-tauri/src/logtail.rs`, `src-tauri/src/lib.rs` (register `pty_kill`).
**Create:** `src/components/PaneHost.tsx` (+ `src/components/paneHost.test.ts` for pure helpers).

---

## Task 1: Pane.sessionId

**Files:** Modify `src/layout/paneLayout.ts`; Test `src/layout/paneLayout.test.ts`

- [ ] **Step 1: Add failing test** — append to `src/layout/paneLayout.test.ts`:
```ts
import { initLayout, reduce } from "./paneLayout";

describe("sessionId", () => {
  it("gives each pane a unique uuid sessionId", () => {
    const l0 = initLayout("/x");
    const p0 = l0.tabs[0].rows[0].panes[0];
    expect(p0.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    const l1 = reduce({ ...l0, focusedPaneId: p0.id }, { type: "split" });
    const ids = l1.tabs[0].rows[0].panes.map((p) => p.sessionId);
    expect(new Set(ids).size).toBe(2);
  });
});
```
(If the test file has no `describe`/`it` import, add `import { describe, it, expect } from "vitest";` at the top — check the file first.)

- [ ] **Step 2: Run → fail.** `npx vitest run src/layout/paneLayout.test.ts` → property `sessionId` undefined.

- [ ] **Step 3: Implement.** In `src/layout/paneLayout.ts`:
  (a) extend the interface:
```ts
export interface Pane { id: string; cwd: string; size: number; title: string; autoTitle: boolean; sessionId: string }
```
  (b) generate it in `makePane`:
```ts
const makePane = (cwd: string): Pane => ({ id: nextId("pane"), cwd, size: 1, title: defaultTitle(cwd), autoTitle: true, sessionId: crypto.randomUUID() });
```

- [ ] **Step 4: Run → pass.** `npx vitest run src/layout/paneLayout.test.ts` → all pass.

- [ ] **Step 5: Commit.**
```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat(layout): per-pane sessionId (uuid)"
```

---

## Task 2: Rust — read the exact session log (not newest)

**Files:** Modify `src-tauri/src/logtail.rs`

- [ ] **Step 1: Add a failing test** — append inside the `#[cfg(test)] mod tests` block in `src-tauri/src/logtail.rs`:
```rust
    #[test]
    fn session_log_path_builds_the_uuid_file() {
        let p = session_log_path(
            std::path::Path::new("/home/u"),
            "/Users/x/Work/app",
            "abc-123",
        );
        assert_eq!(
            p,
            std::path::Path::new("/home/u/.claude/projects/-Users-x-Work-app/abc-123.jsonl")
        );
    }
```

- [ ] **Step 2: Run → fail.** `cd src-tauri && cargo test session_log_path` → `cannot find function session_log_path`.

- [ ] **Step 3: Implement.** In `src-tauri/src/logtail.rs`:
  (a) add the helper (after `project_log_dir`):
```rust
/// Exact log file for a known claude session under a cwd.
pub fn session_log_path(home: &Path, cwd: &str, session_id: &str) -> PathBuf {
    project_log_dir(home, cwd).join(format!("{session_id}.jsonl"))
}
```
  (b) change `pane_topic` to take the session id and read that file:
```rust
#[tauri::command]
pub fn pane_topic(cwd: String, session_id: String) -> Option<String> {
    let home = dirs_home()?;
    first_user_topic(&session_log_path(&home, &cwd, &session_id))
}
```
  (c) change `logtail_start` to take `session_id` and tail the EXACT path (replace the `newest_session_file` logic). Replace the whole `logtail_start` signature + thread body with:
```rust
#[tauri::command]
pub fn logtail_start(
    app: AppHandle,
    mgr: State<LogtailManager>,
    pane_id: String,
    cwd: String,
    session_id: String,
) -> Result<(), String> {
    if let Some(prev) = mgr.0.lock().unwrap().remove(&pane_id) {
        prev.store(true, Ordering::Relaxed);
    }
    let stop = Arc::new(AtomicBool::new(false));
    mgr.0.lock().unwrap().insert(pane_id.clone(), stop.clone());

    let home = dirs_home().ok_or("no home dir")?;
    let path = session_log_path(&home, &cwd, &session_id);
    let evt = log_event(&pane_id);

    std::thread::spawn(move || {
        // Our own fresh session: the file is created by `claude --session-id <id>` and
        // starts empty, so tail from the start (offset 0) once it appears.
        let mut offset: u64 = 0;
        let mut seen = false;
        while !stop.load(Ordering::Relaxed) {
            if let Ok(meta) = std::fs::metadata(&path) {
                if !seen {
                    seen = true;
                    offset = 0;
                }
                let len = meta.len();
                if len > offset {
                    if let Ok(mut f) = std::fs::File::open(&path) {
                        let _ = f.seek(SeekFrom::Start(offset));
                        let reader = BufReader::new(&mut f);
                        for line in reader.lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                let _ = app.emit(&evt, line);
                            }
                        }
                        offset = len;
                    }
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(300));
        }
    });
    Ok(())
}
```
  (Leave `newest_session_file` in place — its unit test stays green and it's harmless; do not delete it.)

- [ ] **Step 4: Run → pass.** `cd src-tauri && cargo test` → all logtail tests pass (new + existing).

- [ ] **Step 5: Commit.**
```bash
git add src-tauri/src/logtail.rs
git commit -m "feat(core): resolve pane topic/activity from the pane's own session uuid"
```

---

## Task 3: Rust — pty launch command, idempotent spawn, pty_kill

**Files:** Modify `src-tauri/src/pty.rs`, `src-tauri/src/lib.rs`

This is PTY integration (no unit test); verify by `cargo build` + the GUI later.

- [ ] **Step 1: Edit `pty_spawn`** in `src-tauri/src/pty.rs`. Add a `launch: Option<String>` param and (a) an idempotent guard at the top, (b) write the launch line after spawn.

  (a) change the signature + add the guard as the first lines of the body:
```rust
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<PtyManager>,
    pane_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    launch: Option<String>,
) -> Result<(), String> {
    // Idempotent: a pane that re-mounts must NOT respawn (would kill its session).
    if mgr.0.lock().unwrap().contains_key(&pane_id) {
        return Ok(());
    }
    let cwd = validate_cwd(&cwd)?;
```
  (b) after `let writer = pair.master.take_writer()...;` (before the reader thread / the `mgr.0.lock().unwrap().insert(...)`), write the launch line to the PTY. Insert this block right before the final `mgr.0.lock().unwrap().insert(`:
```rust
    // Auto-run the pane's claude session (or any launch command). Written to the PTY's
    // stdin so the user's login-shell `claude` function + PATH resolve normally.
    let mut writer = writer;
    if let Some(cmd) = launch {
        let _ = writer.write_all(format!("{cmd}\r").as_bytes());
        let _ = writer.flush();
    }
```
  (The existing `insert` uses `writer`; since we rebind `let mut writer = writer;` above, the struct field still receives it — keep `PtySession { master: pair.master, writer, _child: child }`.)

- [ ] **Step 2: Add `pty_kill`** in `src-tauri/src/pty.rs` (after `pty_resize`):
```rust
#[tauri::command]
pub fn pty_kill(mgr: State<PtyManager>, pane_id: String) {
    // Dropping the PtySession drops its child -> portable-pty kills the process.
    mgr.0.lock().unwrap().remove(&pane_id);
}
```

- [ ] **Step 3: Register `pty_kill`** in `src-tauri/src/lib.rs` — add `pty::pty_kill` to the `tauri::generate_handler![...]` list (find the existing `pty_resize` entry and add `pty_kill` next to it).

- [ ] **Step 4: Build.** `cd src-tauri && cargo build 2>&1 | tail -20` → compiles (exit 0). Fix any borrow error on `writer` (the rebind `let mut writer = writer;` makes it mutable for `write_all`).

- [ ] **Step 5: Commit.**
```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat(core): pty_spawn launch command + idempotent guard; add pty_kill"
```

---

## Task 4: Frontend clients (launch, kill, sessionId)

**Files:** Modify `src/lib/ptyClient.ts`, `src/lib/logClient.ts`

No new behavior to unit-test (thin IPC wrappers); verified by tsc + callers.

- [ ] **Step 1: Edit `src/lib/ptyClient.ts`** — add `launch` to spawn + a `killPty`:
```ts
export function spawnPty(paneId: string, cwd: string, cols: number, rows: number, launch: string | null) {
  return invoke("pty_spawn", { paneId, cwd, cols, rows, launch });
}

export function killPty(paneId: string) {
  return invoke("pty_kill", { paneId });
}
```
(Keep `writePty`, `resizePty`, `onPtyOutput`, `onPtyExit` unchanged.)

- [ ] **Step 2: Edit `src/lib/logClient.ts`** — thread `sessionId` through:
```ts
export function startLogtail(paneId: string, cwd: string, sessionId: string) {
  return invoke("logtail_start", { paneId, cwd, sessionId });
}
export function paneTopic(cwd: string, sessionId: string): Promise<string | null> {
  return invoke("pane_topic", { cwd, sessionId });
}
```
(Keep `stopLogtail`, `onLogLine` unchanged.)

- [ ] **Step 3: Typecheck (expect callers to break — that's fine, fixed in Task 5).** `npx tsc --noEmit 2>&1 | grep -E "ptyClient|logClient|TerminalPane" | head` — note the TerminalPane call-site errors (will be fixed next task).

- [ ] **Step 4: Commit.**
```bash
git add src/lib/ptyClient.ts src/lib/logClient.ts
git commit -m "feat(lib): pty launch + killPty; logtail/topic take sessionId"
```

---

## Task 5: TerminalPane — wire sessionId + auto-launch claude

**Files:** Modify `src/components/TerminalPane.tsx`

- [ ] **Step 1: Add `sessionId` to the props type** (in the destructured props + the type literal). Add `sessionId: string;` to the props interface and `sessionId` to the destructure.

- [ ] **Step 2: Pass launch to spawnPty.** Change the spawn line (currently `void spawnPty(paneId, cwd, term.cols, term.rows);`) to:
```ts
    void spawnPty(paneId, cwd, term.cols, term.rows, `claude --session-id ${sessionId}`);
```

- [ ] **Step 3: Start the per-pane logtail and use sessionId for topic.** In the same mount `useEffect`, after `void spawnPty(...)`, add:
```ts
    void startLogtail(paneId, cwd, sessionId);
```
  and in the cleanup (the `return () => {…}` of that effect) add:
```ts
      void stopLogtail(paneId);
```
  Update the imports at the top: `import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit, killPty } from "../lib/ptyClient";` and `import { paneTopic, startLogtail, stopLogtail } from "../lib/logClient";`.

- [ ] **Step 4: Topic poll uses sessionId.** In the topic-poll `useEffect`, change `const t = await paneTopic(cwd);` to `const t = await paneTopic(cwd, sessionId);` and add `sessionId` to that effect's dependency array (`[cwd, sessionId]`).
  Also add `sessionId` to the mount effect's dependency array so a pane that changes session re-inits: change `}, [paneId, cwd]);` → `}, [paneId, cwd, sessionId]);`.

- [ ] **Step 5: Typecheck.** `npx tsc --noEmit 2>&1 | grep TerminalPane | head` — TerminalPane errors gone (the `sessionId` prop is now required; callers fixed in Task 7/8). Full tsc may still error at the TabPanes/PaneHost call-site until Task 7-8.

- [ ] **Step 6: Commit.**
```bash
git add src/components/TerminalPane.tsx
git commit -m "feat(ui): pane auto-launches claude --session-id and tracks its own session"
```

---

## Task 6: Pure helpers for PaneHost (flatten + slot registry)

**Files:** Create `src/components/paneHost.test.ts`; the helpers live in `src/components/PaneHost.tsx` (created next task) — but the PURE helper goes in a tiny module so it's testable in node.

Create `src/components/paneFlatten.ts` for the pure part.

- [ ] **Step 1: Failing test** — `src/components/paneHost.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { flattenPanes } from "./paneFlatten";
import { initLayout, reduce } from "../layout/paneLayout";

describe("flattenPanes", () => {
  it("lists every pane across all tabs with its tab id, stable order", () => {
    let l = initLayout("/x");
    const p0 = l.tabs[0].rows[0].panes[0];
    l = reduce({ ...l, focusedPaneId: p0.id }, { type: "split" }); // 2 panes, 1 tab
    l = reduce(l, { type: "newTab" });                            // +1 tab, +1 pane
    const flat = flattenPanes(l);
    expect(flat.length).toBe(3);
    expect(new Set(flat.map((f) => f.pane.id)).size).toBe(3);
    expect(flat.every((f) => typeof f.tabId === "string")).toBe(true);
  });
});
```

- [ ] **Step 2: Run → fail.** `npx vitest run src/components/paneHost.test.ts` → no module `./paneFlatten`.

- [ ] **Step 3: Implement** `src/components/paneFlatten.ts`:
```ts
import type { Layout, Pane } from "../layout/paneLayout";

export interface FlatPane { pane: Pane; tabId: string }

/** Every pane across all tabs, in tab→row→pane order. PaneHost mounts one
 *  TerminalPane per entry (keyed by pane.id) regardless of which tab is active. */
export function flattenPanes(layout: Layout): FlatPane[] {
  return layout.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((pane) => ({ pane, tabId: t.id }))));
}
```

- [ ] **Step 4: Run → pass.** `npx vitest run src/components/paneHost.test.ts` → pass.

- [ ] **Step 5: Commit.**
```bash
git add src/components/paneFlatten.ts src/components/paneHost.test.ts
git commit -m "feat(ui): flattenPanes helper for PaneHost"
```

---

## Task 7: PaneHost — mount panes once, portal into slots

**Files:** Create `src/components/PaneHost.tsx`

Integration (portals/DOM); verified by tsc + GUI. The key correctness property: a pane is ALWAYS portaled somewhere (its slot, or a hidden parking node) so it never unmounts while its slot is transitioning between tabs.

- [ ] **Step 1: Implement** `src/components/PaneHost.tsx`:
```tsx
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Action, Layout } from "../layout/paneLayout";
import { flattenPanes } from "./paneFlatten";
import { TerminalPane } from "./TerminalPane";

/** Mounts every pane's TerminalPane ONCE and portals it into the DOM slot for its
 *  current position. Moving a pane between tabs only retargets the portal, so the
 *  xterm + PTY + scrollback survive (no remount). While a slot is momentarily absent
 *  (mid-move), the pane parks in a hidden node so it stays mounted. */
export function PaneHost({ layout, slots, dispatch }: {
  layout: Layout;
  slots: Record<string, HTMLElement>;
  dispatch: (a: Action) => void;
}) {
  const parkRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  useEffect(() => { force((n) => n + 1); }, []); // re-render once parkRef is mounted

  const park = parkRef.current;
  return (
    <>
      <div ref={parkRef} style={{ display: "none" }} />
      {park &&
        flattenPanes(layout).map(({ pane }) =>
          createPortal(
            <TerminalPane
              paneId={pane.id}
              cwd={pane.cwd}
              sessionId={pane.sessionId}
              title={pane.title}
              focused={pane.id === layout.focusedPaneId}
              onFocus={() => dispatch({ type: "focusPane", paneId: pane.id })}
              onRename={(t) => dispatch({ type: "renamePane", paneId: pane.id, title: t })}
              onAutoTitle={(t) => dispatch({ type: "autoTitlePane", paneId: pane.id, title: t })}
              onPopOut={() => dispatch({ type: "popOut", paneId: pane.id })}
              onClose={() => { dispatch({ type: "focusPane", paneId: pane.id }); dispatch({ type: "close" }); }}
              dragProps={{
                draggable: true,
                onDragStart: (e) => { e.dataTransfer.setData("text/plain", pane.id); e.dataTransfer.effectAllowed = "move"; },
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
                onDrop: (e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData("text/plain");
                  if (fromId && fromId !== pane.id) dispatch({ type: "movePaneAfter", paneId: fromId, targetPaneId: pane.id });
                },
              }}
            />,
            slots[pane.id] ?? park,
            pane.id, // stable portal key => instance preserved across slot retargets
          ),
        )}
    </>
  );
}
```

- [ ] **Step 2: Typecheck.** `npx tsc --noEmit 2>&1 | grep PaneHost | head` — no PaneHost-internal errors (CockpitView wiring comes next).

- [ ] **Step 3: Commit.**
```bash
git add src/components/PaneHost.tsx
git commit -m "feat(ui): PaneHost — mount panes once + portal into slots (survive tab moves)"
```

---

## Task 8: Slots in TabPanes + wire PaneHost + cleanup

**Files:** Modify `src/components/TabPanes.tsx`, `src/components/CockpitView.tsx`

- [ ] **Step 1: TabPanes renders slot `<div>`s (not TerminalPane).** Replace the whole `src/components/TabPanes.tsx` with:
```tsx
import { Fragment, useRef } from "react";
import type { Action, Row, Tab } from "../layout/paneLayout";
import { Divider } from "./Divider";

function RowPanes({ row, dispatch, registerSlot }: {
  row: Row; dispatch: (a: Action) => void; registerSlot: (paneId: string, el: HTMLElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rowRef} style={{ flex: `${row.size} 1 0`, display: "flex", minHeight: 0, minWidth: 0 }}>
      {row.panes.map((p, pi) => (
        <Fragment key={p.id}>
          <div
            ref={(el) => registerSlot(p.id, el)}
            style={{ flex: `${p.size} 1 0`, display: "flex", minWidth: 0 }}
          />
          {pi < row.panes.length - 1 && (
            <Divider
              axis="x"
              containerPx={() => rowRef.current?.clientWidth ?? 1}
              onResize={(df) => {
                const sizes = row.panes.map((x) => x.size);
                const total = sizes.reduce((s, v) => s + v, 0);
                const move = df * total;
                sizes[pi] = Math.max(0.1, sizes[pi] + move);
                sizes[pi + 1] = Math.max(0.1, sizes[pi + 1] - move);
                dispatch({ type: "setPaneSizes", rowId: row.id, sizes });
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function TabPanes({ tab, active, dispatch, registerSlot }: {
  tab: Tab; active: boolean; dispatch: (a: Action) => void; registerSlot: (paneId: string, el: HTMLElement | null) => void;
}) {
  const colRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={colRef}
      style={{ position: "absolute", inset: 0, display: active ? "flex" : "none", flexDirection: "column", padding: 6, minHeight: 0 }}
    >
      {tab.rows.map((r, ri) => (
        <Fragment key={r.id}>
          <RowPanes row={r} dispatch={dispatch} registerSlot={registerSlot} />
          {ri < tab.rows.length - 1 && (
            <Divider
              axis="y"
              containerPx={() => colRef.current?.clientHeight ?? 1}
              onResize={(df) => {
                const sizes = tab.rows.map((x) => x.size);
                const total = sizes.reduce((s, v) => s + v, 0);
                const move = df * total;
                sizes[ri] = Math.max(0.1, sizes[ri] + move);
                sizes[ri + 1] = Math.max(0.1, sizes[ri + 1] - move);
                dispatch({ type: "setRowSizes", tabId: tab.id, sizes });
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}
```
(The `Divider` import path and `onResize` math are unchanged from the resize fix — the cumulative-delta `Divider` still applies.)

- [ ] **Step 2: CockpitView — slot registry + PaneHost + cleanup.** Replace `src/components/CockpitView.tsx` with:
```tsx
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { reduce, initLayout, type Layout } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TabPanes } from "./TabPanes";
import { PaneHost } from "./PaneHost";
import { killPty } from "../lib/ptyClient";
import { stopLogtail } from "../lib/logClient";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

function livePaneIds(l: Layout): Set<string> {
  return new Set(l.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((p) => p.id))));
}

export function CockpitView() {
  const [layout, dispatch] = useReducer(reduce, DEFAULT_CWD, initLayout);
  useKeybindings(dispatch);

  const [slots, setSlots] = useState<Record<string, HTMLElement>>({});
  const registerSlot = useCallback((paneId: string, el: HTMLElement | null) => {
    setSlots((prev) => {
      if (el) { if (prev[paneId] === el) return prev; return { ...prev, [paneId]: el }; }
      if (!(paneId in prev)) return prev;
      const next = { ...prev }; delete next[paneId]; return next;
    });
  }, []);

  // Kill the PTY + logtail of panes that were actually removed (closed), NOT panes
  // that merely moved tabs (those are still live in the layout, just re-slotted).
  const prevIds = useRef(livePaneIds(layout));
  useEffect(() => {
    const now = livePaneIds(layout);
    for (const id of prevIds.current) {
      if (!now.has(id)) { void killPty(id); void stopLogtail(id); }
    }
    prevIds.current = now;
  }, [layout]);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#14161B" }}>
      <TabBar
        layout={layout}
        onSelect={(tabId) => dispatch({ type: "focusTab", tabId })}
        onNewTab={() => dispatch({ type: "newTab" })}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
      />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {layout.tabs.map((t) => (
          <TabPanes
            key={t.id}
            tab={t}
            active={t.id === layout.activeTabId}
            dispatch={dispatch}
            registerSlot={registerSlot}
          />
        ))}
      </div>
      <PaneHost layout={layout} slots={slots} dispatch={dispatch} />
    </div>
  );
}
```

- [ ] **Step 3: Typecheck + full frontend suite.** `npx tsc --noEmit 2>&1 | tail -20` → exit 0 (no errors anywhere now). `npm test` → all pass.

- [ ] **Step 4: Commit.**
```bash
git add src/components/TabPanes.tsx src/components/CockpitView.tsx
git commit -m "feat(ui): render panes via PaneHost portals into layout slots; cleanup PTY on close"
```

---

## Task 9: Build + manual GUI verification

- [ ] **Step 1: Full build.** `cd src-tauri && cargo build 2>&1 | tail -5` (exit 0) and `cd .. && npx tsc --noEmit` (exit 0) and `npm test` (all pass).
- [ ] **Step 2: Run the app** (`npm run tauri dev` or the project's run command) and verify by hand:
  1. Open 2 panes (Cmd+D) → each shows claude → after a couple messages the two **tab/pane names differ** (each follows its own session). ✅ Bug A
  2. In pane A talk to claude about topic X; **pop it out** (header pop-out button) → the new tab still shows **conversation X** (scrollback intact, not a fresh shell). ✅ Bug B
  3. Resize/drag dividers → no prompt cascade (resize fix still holds), panes stick.
  4. Close a pane → its shell process is gone (no orphan), other panes unaffected.
- [ ] **Step 3:** Report GUI results. (This is the real acceptance — the automated tests cover the pure logic; portals + PTY launch + claude session are GUI-verified.)

---

## Self-Review

**Spec coverage:**
- Bug B portals (mount once, portal into slots, parking node) → Tasks 6,7,8 ✅
- `pty_spawn` idempotent guard → Task 3 ✅
- Bug A `Pane.sessionId` → Task 1 ✅
- auto-launch `claude --session-id` → Tasks 3 (pty launch) + 5 (TerminalPane passes it) ✅
- topic/logtail read exact `<uuid>.jsonl` → Task 2 ✅
- clients thread sessionId/launch/kill → Task 4 ✅
- close-cleanup (pty_kill + stopLogtail for removed panes only) → Task 8 (CockpitView diff) + Task 3 (pty_kill) ✅
- v1 launch policy (all panes launch claude; plain-shell plumbing via `launch=null`) → Task 5 passes the claude command always; `launch: string | null` supports null for the future ✅
- Testing (pure: sessionId, flattenPanes, session_log_path) → Tasks 1,2,6; GUI → Task 9 ✅

**Placeholder scan:** none — every code step is complete.

**Type consistency:** `spawnPty(paneId,cwd,cols,rows,launch)`, `killPty(paneId)`, `paneTopic(cwd,sessionId)`, `startLogtail(paneId,cwd,sessionId)`, `Pane.sessionId`, `session_log_path(home,cwd,session_id)`, `pty_kill`, `PaneHost{layout,slots,dispatch}`, `TabPanes{tab,active,dispatch,registerSlot}`, `flattenPanes` are consistent across tasks. PaneHost passes `sessionId={pane.sessionId}` matching TerminalPane's new required prop (Task 5).

### Follow-up (post-v1)
- UI trigger for a plain-shell pane (`launch=null`).
- If a moved pane's terminal needs a relayout nudge after re-slotting, the existing debounced ResizeObserver in TerminalPane already refits on the slot's size change — verify in GUI; add an explicit `fit()` on portal retarget only if needed.

# Claude Cockpit — M2: Log-tail → Per-Pane Working State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each pane shows a live **working / idle** indicator (status dot + ambient glow = the "juice"), derived by tailing the Claude session log for that pane's directory. This is the differentiator a generic terminal can't have (the reason the cockpit exists).

**Architecture:** A pane spawns the user's login shell (M1). When `claude` runs inside it, Claude Code appends to `~/.claude/projects/<encoded-cwd>/<uuid>.jsonl`. Rust resolves that directory from the pane's cwd, finds the newest `.jsonl`, and polls it (size/mtime) — emitting "grew" / "line" events to the webview. A pure TS state machine turns log-growth into `working | idle`, and `TerminalPane` renders a status dot + ambient glow.

**Tech Stack:** Rust (std fs polling, serde_json) · Tauri v2 events · React/TS · vitest (state-machine TDD)

---

## Scope (M2)

**In:** pane→session-jsonl resolution; tail loop; `working | idle` state (TDD'd state machine); per-pane status dot + ambient glow.

**Out (later milestones):** `waiting`-for-approval state (the jsonl doesn't cleanly signal a pending permission prompt — best-effort later, possibly via PTY heuristic); cost (M4); activity ticker / mascot (later juice layers); multi-pane (M3).

**Key design note (read first):** M1 spawns `$SHELL -il`, NOT `claude` — so a pane has no session jsonl until the user runs `claude` inside it, and the cwd can change if they `cd`. M2's resolver therefore (a) watches the project dir for the user's *current* pane cwd, (b) treats the **most-recently-modified `.jsonl`** there as the active session, and (c) reports `idle` (no-claude) until one appears and grows. "Working" = the active jsonl grew within the last ~2 s; "idle" = it didn't.

---

## File structure (M2)

```
src-tauri/src/
  logtail.rs        # NEW: encode_project_dir, find_active_session, logtail_start/stop, poll loop
  lib.rs            # MODIFY: register logtail commands + a LogtailManager state
src/
  lib/logClient.ts  # NEW: listen to log events, JSON.parse, expose a subscribe()
  lib/paneState.ts  # NEW: pure working|idle state machine (TDD)
  components/TerminalPane.tsx  # MODIFY: start log-tail, render status dot + ambient glow
src/lib/paneState.test.ts      # NEW: vitest unit tests for the state machine
```

---

## Task 1: Rust — resolve the session jsonl (TDD the pure parts)

**Files:** Create `src-tauri/src/logtail.rs`; modify `src-tauri/src/lib.rs` (`mod logtail;`).

- [ ] **Step 1: Write the failing tests + the pure functions**

Create `src-tauri/src/logtail.rs`:
```rust
use std::path::{Path, PathBuf};

/// Claude Code stores a session under ~/.claude/projects/<encoded>/, where <encoded>
/// is the absolute cwd with path separators turned into '-'. Verified against real dirs
/// (e.g. /Users/x/Work/mee-tang -> -Users-x-Work-mee-tang). Dots are also encoded to '-'
/// by Claude Code; we replicate that (no dotted-path sample exists locally, so the spike
/// in Task 2 confirms it against a live `claude` run before relying on it).
pub fn encode_project_dir(cwd: &str) -> String {
    cwd.chars()
        .map(|c| if c == '/' || c == '.' { '-' } else { c })
        .collect()
}

/// Directory that holds this cwd's session logs.
pub fn project_log_dir(home: &Path, cwd: &str) -> PathBuf {
    home.join(".claude").join("projects").join(encode_project_dir(cwd))
}

/// Newest *.jsonl in `dir` by mtime, or None if the dir is missing/empty.
pub fn newest_session_file(dir: &Path) -> Option<PathBuf> {
    let mut newest: Option<(std::time::SystemTime, PathBuf)> = None;
    for entry in std::fs::read_dir(dir).ok()?.flatten() {
        let p = entry.path();
        if p.extension().and_then(|e| e.to_str()) != Some("jsonl") {
            continue;
        }
        let m = entry.metadata().ok().and_then(|m| m.modified().ok());
        if let Some(t) = m {
            if newest.as_ref().map_or(true, |(bt, _)| t > *bt) {
                newest = Some((t, p));
            }
        }
    }
    newest.map(|(_, p)| p)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encodes_slashes_to_dashes() {
        assert_eq!(
            encode_project_dir("/Users/theerametsaengsin/Work/mee-tang"),
            "-Users-theerametsaengsin-Work-mee-tang"
        );
    }

    #[test]
    fn newest_picks_latest_mtime() {
        let dir = std::env::temp_dir().join(format!("cockpit-m2-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("a.jsonl"), "{}").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(20));
        std::fs::write(dir.join("b.jsonl"), "{}").unwrap();
        std::fs::write(dir.join("ignore.txt"), "x").unwrap();
        let got = newest_session_file(&dir).unwrap();
        assert_eq!(got.file_name().unwrap().to_str().unwrap(), "b.jsonl");
        std::fs::remove_dir_all(&dir).ok();
    }
}
```
Add `mod logtail;` near the top of `src-tauri/src/lib.rs`.

- [ ] **Step 2: Run the tests — verify they pass**

Run (in `src-tauri/`): `cargo test --lib logtail`
Expected: 2 passed.

- [ ] **Step 3: Commit**
```bash
git add src-tauri/src/logtail.rs src-tauri/src/lib.rs
git commit -m "feat(logtail): session-dir encoding + newest-session resolver (TDD)"
```
**(Commit message: no Claude/AI attribution, no Co-Authored-By — hard rule, all tasks.)**

---

## Task 2: Rust — tail loop + commands (spike the live mapping here)

**Files:** Modify `src-tauri/src/logtail.rs`, `src-tauri/src/lib.rs`. Needs `serde_json` (already a transitive dep via tauri; add explicitly: `cargo add serde_json`).

- [ ] **Step 1: Add the manager, commands, and poll loop**

Append to `src-tauri/src/logtail.rs`:
```rust
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::sync::{Arc, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct LogtailManager(pub Mutex<HashMap<String, Arc<AtomicBool>>>);

pub fn log_event(pane_id: &str) -> String { format!("pane://log/{pane_id}") }

#[tauri::command]
pub fn logtail_start(app: AppHandle, mgr: State<LogtailManager>, pane_id: String, cwd: String) -> Result<(), String> {
    logtail_stop(mgr.clone(), pane_id.clone()); // restart-safe
    let stop = Arc::new(AtomicBool::new(false));
    mgr.0.lock().unwrap().insert(pane_id.clone(), stop.clone());

    let home = dirs_home().ok_or("no home dir")?;
    let dir = project_log_dir(&home, &cwd);
    let evt = log_event(&pane_id);

    std::thread::spawn(move || {
        let mut current: Option<PathBuf> = None;
        let mut offset: u64 = 0;
        while !stop.load(Ordering::Relaxed) {
            // (re)discover the active session file; reset offset if it changed
            let newest = newest_session_file(&dir);
            if newest != current {
                current = newest.clone();
                offset = 0;
            }
            if let Some(path) = &current {
                if let Ok(mut f) = std::fs::File::open(path) {
                    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
                    if len > offset {
                        let _ = f.seek(SeekFrom::Start(offset));
                        let reader = BufReader::new(&mut f);
                        for line in reader.lines().map_while(Result::ok) {
                            if !line.trim().is_empty() {
                                let _ = app.emit(&evt, line); // raw jsonl line
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

#[tauri::command]
pub fn logtail_stop(mgr: State<LogtailManager>, pane_id: String) {
    if let Some(stop) = mgr.0.lock().unwrap().remove(&pane_id) {
        stop.store(true, Ordering::Relaxed);
    }
}

fn dirs_home() -> Option<PathBuf> {
    std::env::var_os("HOME").map(PathBuf::from)
}
```
Register in `lib.rs`: `.manage(logtail::LogtailManager::default())` and add `logtail::logtail_start, logtail::logtail_stop` to `generate_handler!`.

- [ ] **Step 2: Build**

Run (in `src-tauri/`): `cargo build`. Expected: compiles. (`State` is not `Clone` — if `mgr.clone()` in `logtail_start` fails to compile, inline the stop-removal instead of calling `logtail_stop`: `mgr.0.lock().unwrap().remove(&pane_id).map(|s| s.store(true, Ordering::Relaxed));` Fix from the compiler.)

- [ ] **Step 3: SPIKE — verify the live mapping (manual, with the owner)**

This is risk #2; it needs a real `claude` run, so it's owner-verified (headless can't watch the GUI). Hand off: run `npm run tauri dev`, type `claude` in the pane, send one message. Confirm (via a temporary `console.log` in Task 4's logClient, or `console` in devtools) that `pane://log/pane-1` events arrive carrying real jsonl lines as Claude writes them, and that the resolved dir matches `~/.claude/projects/<encoded cwd>`. **If the encoding is wrong** (dir not found), inspect the actual dir name Claude created and correct `encode_project_dir` + its test. Record the confirmed rule in a one-line comment.

- [ ] **Step 4: Commit**
```bash
git add src-tauri/src/logtail.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(logtail): tail the active session jsonl + start/stop commands"
```

---

## Task 3: TS — `working | idle` state machine (TDD, vitest)

**Files:** Create `src/lib/paneState.ts` + `src/lib/paneState.test.ts`. (Scaffold has vitest? If `npm run test` is absent, add: `npm i -D vitest` and a `"test": "vitest run"` script.)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/paneState.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { deriveState, type LogSignal } from "./paneState";

const IDLE_MS = 2000;

describe("deriveState", () => {
  it("is idle before any log activity", () => {
    const sig: LogSignal = { lastLineAt: null };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("idle");
  });
  it("is working right after a new log line", () => {
    const sig: LogSignal = { lastLineAt: 9_500 };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("working");
  });
  it("goes idle once the gap since the last line exceeds the threshold", () => {
    const sig: LogSignal = { lastLineAt: 7_000 };
    expect(deriveState(sig, 10_000, IDLE_MS)).toBe("idle");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test`. Expected: FAIL ("Cannot find module './paneState'").

- [ ] **Step 3: Implement the minimal state machine**

Create `src/lib/paneState.ts`:
```ts
export type PaneState = "idle" | "working";

/** Signals distilled from the log tail. `lastLineAt` = ms timestamp of the most
 *  recent jsonl line for this pane, or null if none seen yet. */
export interface LogSignal {
  lastLineAt: number | null;
}

/** working if the log grew within `idleMs`; otherwise idle. Pure + clock-injected. */
export function deriveState(sig: LogSignal, now: number, idleMs: number): PaneState {
  if (sig.lastLineAt == null) return "idle";
  return now - sig.lastLineAt < idleMs ? "working" : "idle";
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test`. Expected: 3 passed.

- [ ] **Step 5: Commit**
```bash
git add src/lib/paneState.ts src/lib/paneState.test.ts package.json package-lock.json
git commit -m "feat(ui): working|idle state machine derived from log activity (TDD)"
```

---

## Task 4: TS — logClient + status dot + ambient glow

**Files:** Create `src/lib/logClient.ts`; modify `src/components/TerminalPane.tsx`.

- [ ] **Step 1: logClient — start tail + track lastLineAt**

Create `src/lib/logClient.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function startLogtail(paneId: string, cwd: string) {
  return invoke("logtail_start", { paneId, cwd });
}
export function stopLogtail(paneId: string) {
  return invoke("logtail_stop", { paneId });
}
/** Fires `onLine` for every new jsonl line; caller stamps the time. */
export function onLogLine(paneId: string, onLine: (line: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pane://log/${paneId}`, (e) => onLine(e.payload));
}
```

- [ ] **Step 2: Wire state + visuals into TerminalPane**

In `src/components/TerminalPane.tsx`, inside the existing `useEffect` (after the PTY wiring), add log-tail + a 500 ms ticker that recomputes state, and render an overlay dot. Concretely:
- add `import { startLogtail, stopLogtail, onLogLine } from "../lib/logClient";` and `import { deriveState, type PaneState } from "../lib/paneState";` and `useState`.
- a `useState<PaneState>("idle")`; a ref `lastLineAt` (number | null = null).
- in the effect: `void startLogtail(paneId, cwd);` push `onLogLine(paneId, () => { lastLineAt.current = Date.now(); })` into `unlisteners`; start `const tick = setInterval(() => setState(deriveState({ lastLineAt: lastLineAt.current }, Date.now(), 2000)), 500);`
- cleanup also: `clearInterval(tick); void stopLogtail(paneId);`
- render the dot over the terminal host:
```tsx
return (
  <div style={{ position: "relative", width: "100%", height: "100%" }}>
    <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
    <span
      aria-label={state}
      style={{
        position: "absolute", top: 6, right: 8, width: 10, height: 10, borderRadius: "50%",
        background: state === "working" ? "#f5a623" : "#3ecf8e",
        boxShadow: state === "working" ? "0 0 8px 2px #f5a62388" : "none",
        transition: "background 200ms, box-shadow 200ms",
      }}
    />
    <div
      style={{
        position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 6,
        boxShadow: state === "working" ? "inset 0 0 24px 0 #f5a62333" : "inset 0 0 0 0 transparent",
        transition: "box-shadow 300ms",
      }}
    />
  </div>
);
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit`. Expected: clean. (`State` import unused warnings → remove; `noUnusedLocals` is on.)

- [ ] **Step 4: Commit**
```bash
git add src/lib/logClient.ts src/components/TerminalPane.tsx
git commit -m "feat(ui): per-pane working/idle status dot + ambient glow from log-tail"
```

---

## Task 5: End-to-end verification (owner-driven GUI)

- [ ] **Step 1: Run + watch (manual — headless can't observe the window)**

Run: `npm run tauri dev`. In the pane: type `claude`, Enter, send a message. Verify:
1. While Claude is generating → dot turns **amber + glows**, pane gets a faint amber inner glow ("working").
2. ~2 s after it finishes → dot returns **green**, glow fades ("idle").
3. Typing in the shell with no Claude running → stays green/idle.
4. Resize still works; no console errors.

Report pass/fail. If the dot never turns amber, the spike (Task 2 Step 3) mapping is off — fix `encode_project_dir` and re-verify.

- [ ] **Step 2: M2 wrap-up commit**

Update `SPEC.md` Status: M2 done, risk #2 (log-tail → state) retired; note `waiting` state still deferred. Then:
```bash
git add SPEC.md
git commit -m "docs: M2 done — per-pane working/idle from log-tail; risk #2 retired"
```

---

## Self-review

**Spec coverage (M2 slice):** per-pane working/idle from `~/.claude/projects` log-tail ✓ (Tasks 1–4); status dot + ambient juice ✓ (Task 4); parser/state isolated + TDD'd ✓ (Tasks 1, 3). `waiting` state, cost, ticker/mascot, multi-pane → explicitly out (later milestones). The log-tail emits raw lines (Task 2), so a later cost/ticker layer can parse `usage`/`tool_use` from the same stream without re-plumbing.

**Placeholder scan:** Task 2 Step 3 (live spike) and the `encode_project_dir` dot-rule are explicit owner-verified steps with a concrete fallback (inspect the real dir, fix the fn + test) — not TODO dodges.

**Type/name consistency:** Rust commands `logtail_start`/`logtail_stop` ↔ `invoke("logtail_start", { paneId, cwd })` (Tauri camelCase→snake). Event `log_event(pane_id)` = `pane://log/{id}` ↔ frontend `onLogLine` listens `pane://log/${paneId}`. `deriveState(sig, now, idleMs)` signature identical in test, impl, and TerminalPane call (2000 ms). ✓

**Known caveat:** the 300 ms Rust poll + 500 ms TS ticker mean state lags reality by up to ~0.8 s — fine for ambient juice, not for anything timing-critical. Polling (not the `notify` crate) is deliberate: one file, simplest, cross-platform.

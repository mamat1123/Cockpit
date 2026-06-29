# Headroom per-Session — Plan 1: Routing Foundation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let each Cockpit Session be routed through a Cockpit-managed Headroom proxy via a per-Pane toggle, with the proxy auto-started and health-checked so a Session can never hit the `ConnectionRefused` retry loop again.

**Architecture:** A per-Pane `headroom` flag (persisted with the layout) decides whether that Session's `claude` is launched with `ANTHROPIC_BASE_URL` pointed at a single Cockpit-owned `headroom proxy` (run in `cache` mode). The proxy is supervised from Rust (lazy start, TCP health-poll, auto-restart). Toggling the flag relaunches the Pane's `claude` via `--resume` so the conversation survives. This plan delivers routing + supervision + the toggle UI; **Savings attribution and the Dashboard readout are Plans 2 and 3.**

**Tech Stack:** Rust (Tauri commands, `portable-pty`, `std::process`), TypeScript/React (xterm registry, PaneHeader), Vitest, `headroom` CLI v0.27+.

## Global Constraints

- The Headroom proxy listens on `http://127.0.0.1:8787` (Headroom default port). Use the constant `HEADROOM_PORT = 8787` / `HEADROOM_BASE_URL = "http://127.0.0.1:8787"`; do not hardcode the literal elsewhere.
- The proxy runs in **`cache` mode** (`headroom proxy --mode cache`), never `token` mode — protects Anthropic prompt-cache and keeps Cost aligned with Savings (see ADR 0010 / 0005).
- Cockpit is the **sole owner** of `ANTHROPIC_BASE_URL`. It is injected per-Pane at launch only when that Pane's `headroom` flag is true; it is NEVER read from a project `.claude/settings.local.json` env block (Task 7 removes the stale one).
- The `headroom` binary is not on a GUI app's PATH (same constraint as `claude`, ADR 0006). Always spawn the proxy through a login shell: `$SHELL -lc '<cmd>'`.
- Existing test runner: `npm test` (Vitest). Rust: `cargo test` in `src-tauri/`. PTY/proxy spawning is verified manually (steps say so explicitly) — do not fake a passing automated test for them.
- Routing default is **off**: a Pane with no `headroom` flag behaves exactly as today.

---

### Task 1: Per-Pane env injection in `pty_spawn`

Lets the launcher pass `ANTHROPIC_BASE_URL` (or any env) to just one Pane's shell, without touching the others.

**Files:**
- Modify: `src-tauri/src/pty.rs:57-91` (add `env` param + apply it)
- Modify: `src/lib/ptyClient.ts:4-6` (thread `env` through)

**Interfaces:**
- Produces (Rust): `pty_spawn(app, mgr, pane_id, cwd, cols, rows, launch, env: Option<HashMap<String,String>>)`
- Produces (TS): `spawnPty(paneId, cwd, cols, rows, launch, env?: Record<string,string> | null)`

- [ ] **Step 1: Add the `env` parameter to `pty_spawn`**

In `src-tauri/src/pty.rs`, add the import near the top (after the existing `use` lines):

```rust
use std::collections::HashMap;
```

Change the signature (currently ends `launch: Option<String>,`) to add a final param:

```rust
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<PtyManager>,
    pane_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
    launch: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<(), String> {
```

- [ ] **Step 2: Apply the env to the CommandBuilder**

Immediately after the existing `cmd.env("COLORTERM", "truecolor");` line (pty.rs:89), add:

```rust
    // Per-Pane env (e.g. ANTHROPIC_BASE_URL for Headroom routing). Applied on top of
    // the inherited environment, before the login shell sources the profile.
    if let Some(env) = env {
        for (k, v) in env {
            cmd.env(k, v);
        }
    }
```

- [ ] **Step 3: Thread `env` through the TS client**

Replace `src/lib/ptyClient.ts` lines 4-6 with:

```typescript
export function spawnPty(paneId: string, cwd: string, cols: number, rows: number, launch: string | null, env?: Record<string, string> | null) {
  return invoke("pty_spawn", { paneId, cwd, cols, rows, launch, env: env ?? null });
}
```

- [ ] **Step 4: Build the Rust side**

Run: `cd src-tauri && cargo build`
Expected: compiles clean (the existing single caller passes `None` implicitly? No — Tauri commands are invoked by name with named args, so the missing `env` arrives as `null` → `None`. No Rust caller to update.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/pty.rs src/lib/ptyClient.ts
git commit -m "feat(pty): accept per-pane env in pty_spawn for Headroom routing"
```

---

### Task 2: Headroom proxy supervision (Rust)

A single managed `headroom proxy` child with lazy start + TCP health check, so routed Sessions always find a live proxy.

**Files:**
- Create: `src-tauri/src/headroom.rs`
- Modify: `src-tauri/src/lib.rs:1-4` (add `mod headroom;`), `:92-96` (manage state), `:96-113` (register commands)

**Interfaces:**
- Produces: Tauri command `headroom_ensure() -> Result<bool, String>` — starts the proxy if not already healthy, blocks until `127.0.0.1:8787` accepts a TCP connection (≤8s) or errors; returns `true` when healthy.
- Produces: Tauri command `headroom_status() -> bool` — non-blocking liveness probe (TCP connect with 300ms timeout).
- Produces: `pub struct HeadroomManager(pub Mutex<Option<std::process::Child>>)` with `Default`.

- [ ] **Step 1: Write `headroom.rs`**

Create `src-tauri/src/headroom.rs`:

```rust
use std::io::ErrorKind;
use std::net::{TcpStream, ToSocketAddrs};
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::State;

pub const HEADROOM_PORT: u16 = 8787;

#[derive(Default)]
pub struct HeadroomManager(pub Mutex<Option<Child>>);

/// True if something accepts a TCP connection on the proxy port within `timeout`.
fn port_open(timeout: Duration) -> bool {
    let addr = match ("127.0.0.1", HEADROOM_PORT).to_socket_addrs() {
        Ok(mut it) => match it.next() {
            Some(a) => a,
            None => return false,
        },
        Err(_) => return false,
    };
    TcpStream::connect_timeout(&addr, timeout).is_ok()
}

/// Non-blocking liveness probe.
#[tauri::command]
pub fn headroom_status() -> bool {
    port_open(Duration::from_millis(300))
}

/// Ensure a healthy proxy exists. Idempotent: if the port is already open we do
/// nothing (covers an externally-run `headroom install` daemon). Otherwise spawn
/// `headroom proxy` through a login shell (GUI PATH lacks ~/.local/bin, ADR 0006)
/// and poll until the port opens.
#[tauri::command]
pub fn headroom_ensure(mgr: State<HeadroomManager>) -> Result<bool, String> {
    if port_open(Duration::from_millis(300)) {
        return Ok(true);
    }
    let mut guard = mgr.0.lock().unwrap();
    // Reap a dead child handle so we respawn.
    if let Some(child) = guard.as_mut() {
        if matches!(child.try_wait(), Ok(Some(_))) {
            *guard = None;
        }
    }
    if guard.is_none() {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
        // cache mode (ADR 0010); log file feeds Plan 2's Savings attribution.
        let cmd = format!(
            "headroom proxy --port {HEADROOM_PORT} --mode cache --log-file ~/.headroom/logs/cockpit-proxy.jsonl"
        );
        let child = Command::new(&shell)
            .arg("-lc")
            .arg(&cmd)
            .spawn()
            .map_err(|e| format!("spawn headroom proxy: {e}"))?;
        *guard = Some(child);
    }
    drop(guard);

    // Poll up to 8s for the port to come up.
    let deadline = Instant::now() + Duration::from_secs(8);
    while Instant::now() < deadline {
        if port_open(Duration::from_millis(250)) {
            return Ok(true);
        }
        std::thread::sleep(Duration::from_millis(150));
    }
    Err("headroom proxy did not become reachable on 127.0.0.1:8787 within 8s".into())
}

// Silence unused import on non-test builds.
#[allow(unused_imports)]
use ErrorKind as _ErrorKind;
```

- [ ] **Step 2: Register the module, state, and commands**

In `src-tauri/src/lib.rs`, add after line 4 (`mod usage;`):

```rust
mod headroom;
```

Add to the `.manage(...)` chain (after `.manage(cost::CostReportManager::default())`, lib.rs:95):

```rust
        .manage(headroom::HeadroomManager::default())
```

Add to `generate_handler![...]` (after `usage::usage_report,`, lib.rs:112):

```rust
            headroom::headroom_ensure,
            headroom::headroom_status,
```

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo build`
Expected: compiles clean.

- [ ] **Step 4: Manual verification (PTY/proxy can't be unit-tested)**

1. Ensure no proxy is running: `lsof -nP -iTCP:8787 -sTCP:LISTEN` → empty.
2. Run the app: `npm run tauri dev`.
3. In the devtools console: `await window.__TAURI__.core.invoke('headroom_ensure')` → resolves `true` within a few seconds.
4. `lsof -nP -iTCP:8787 -sTCP:LISTEN` → now shows a Python/headroom listener.
5. `await window.__TAURI__.core.invoke('headroom_status')` → `true`.

Record the result in the commit message.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/headroom.rs src-tauri/src/lib.rs
git commit -m "feat(headroom): supervise a cache-mode proxy with lazy start + health poll"
```

---

### Task 3: `headroomClient.ts` (TS wrapper)

**Files:**
- Create: `src/lib/headroomClient.ts`

**Interfaces:**
- Produces: `headroomEnsure(): Promise<boolean>`, `headroomStatus(): Promise<boolean>`, const `HEADROOM_BASE_URL = "http://127.0.0.1:8787"`.

- [ ] **Step 1: Write the client**

Create `src/lib/headroomClient.ts`:

```typescript
import { invoke } from "@tauri-apps/api/core";

export const HEADROOM_BASE_URL = "http://127.0.0.1:8787";

/** Start the Cockpit-managed Headroom proxy if needed; resolves true when reachable. */
export function headroomEnsure(): Promise<boolean> {
  return invoke<boolean>("headroom_ensure");
}

/** Non-blocking liveness probe of the proxy. */
export function headroomStatus(): Promise<boolean> {
  return invoke<boolean>("headroom_status");
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/headroomClient.ts
git commit -m "feat(headroom): add headroomClient wrapper"
```

---

### Task 4: Persist the per-Pane `headroom` flag

Add the routing flag to the Pane model so it survives reloads and serializes with the layout.

**Files:**
- Modify: `src/layout/paneLayout.ts:1` (Pane), `:6` (SavedPane), `:11-27` (Action), `:32` (makePane — no change needed), `:54-67` (serialize), `:75-89` (deserialize), `:117-273` (reduce: new case)
- Test: `src/layout/paneLayout.test.ts`

**Interfaces:**
- Produces: `Pane.headroom?: boolean`, `SavedPane.headroom?: boolean`, action `{ type: "setHeadroom"; paneId: string; on: boolean }`.

- [ ] **Step 1: Write the failing test**

Add to `src/layout/paneLayout.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { initLayout, reduce, serializeLayout, deserializeLayout } from "./paneLayout";

describe("headroom flag", () => {
  it("setHeadroom toggles the flag on the target pane only", () => {
    let l = initLayout("/tmp/a");
    l = reduce(l, { type: "split" });
    const [p0, p1] = l.tabs[0].rows[0].panes;
    l = reduce(l, { type: "setHeadroom", paneId: p0.id, on: true });
    const panes = l.tabs[0].rows[0].panes;
    expect(panes.find((p) => p.id === p0.id)!.headroom).toBe(true);
    expect(panes.find((p) => p.id === p1.id)!.headroom).toBeFalsy();
  });

  it("round-trips headroom through serialize/deserialize", () => {
    let l = initLayout("/tmp/a");
    const pid = l.tabs[0].rows[0].panes[0].id;
    l = reduce(l, { type: "setHeadroom", paneId: pid, on: true });
    const saved = serializeLayout(l, true);
    expect(saved.tabs[0].rows[0].panes[0].headroom).toBe(true);
    const back = deserializeLayout(saved);
    expect(back.tabs[0].rows[0].panes[0].headroom).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm test -- paneLayout`
Expected: FAIL — `setHeadroom` not handled / `headroom` undefined.

- [ ] **Step 3: Add the field to the types**

`src/layout/paneLayout.ts` line 1 — append `headroom?: boolean` to `Pane`:

```typescript
export interface Pane { id: string; cwd: string; size: number; title: string; autoTitle: boolean; sessionId: string; resume?: boolean; headroom?: boolean }
```

Line 6 — append to `SavedPane`:

```typescript
export interface SavedPane { cwd: string; title: string; autoTitle: boolean; size: number; sessionId?: string; headroom?: boolean }
```

- [ ] **Step 4: Add the action variant**

In the `Action` union (after the `autoTitlePane` line, paneLayout.ts:23) add:

```typescript
  | { type: "setHeadroom"; paneId: string; on: boolean }
```

- [ ] **Step 5: Serialize + deserialize the flag**

In `serializeLayout` (the `panes.map`, paneLayout.ts:60-63), add `headroom` to the emitted object:

```typescript
          panes: r.panes.map((p) => ({
            cwd: p.cwd, title: p.title, autoTitle: p.autoTitle, size: p.size,
            ...(p.headroom ? { headroom: true } : {}),
            ...(keepSessions ? { sessionId: p.sessionId } : {}),
          })),
```

In `deserializeLayout` (the `panes.map`, paneLayout.ts:80-83), carry it back:

```typescript
        panes: r.panes.map((p) => ({
          id: nextId("pane"), cwd: p.cwd, size: p.size, title: p.title, autoTitle: p.autoTitle,
          sessionId: p.sessionId ?? crypto.randomUUID(), resume: !!p.sessionId,
          headroom: !!p.headroom,
        })),
```

- [ ] **Step 6: Handle the action in `reduce`**

Add a new case before the closing `}` of the switch (after the `movePaneAfter` case, paneLayout.ts:272):

```typescript
    case "setHeadroom": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) => (p.id === a.paneId ? { ...p, headroom: a.on } : p)),
        })),
      }));
      return { ...l, tabs };
    }
```

- [ ] **Step 7: Run the tests**

Run: `npm test -- paneLayout`
Expected: PASS (both new tests + existing ones).

- [ ] **Step 8: Commit**

```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat(layout): persist a per-pane headroom routing flag"
```

---

### Task 5: Route through the proxy at launch + relaunch on toggle

Wire the flag into `terminalRegistry`: routed Panes ensure the proxy then launch with the env; a `setPaneHeadroom` relaunches an existing Pane via `--resume`.

**Files:**
- Modify: `src/lib/terminalRegistry.ts:5` (import), `:88-148` (`acquireTerminal` signature + launch), add `setPaneHeadroom` export.

**Interfaces:**
- Consumes: `spawnPty(..., env)` (Task 1), `headroomEnsure`, `HEADROOM_BASE_URL` (Task 3), `killPty` (existing in ptyClient).
- Produces: `acquireTerminal(paneId, cwd, sessionId, resume, headroom: boolean)`, `setPaneHeadroom(paneId, cwd, sessionId, on: boolean): Promise<void>`.

- [ ] **Step 1: Import the proxy client + killPty**

`src/lib/terminalRegistry.ts` line 5 — extend the ptyClient import to include `killPty`:

```typescript
import { spawnPty, writePty, resizePty, killPty, onPtyOutput, onPtyExit } from "./ptyClient";
```

Add after line 8 (`import { type Theme, ... }`):

```typescript
import { headroomEnsure, HEADROOM_BASE_URL } from "./headroomClient";
```

- [ ] **Step 2: Extract a shared launch helper**

Replace the IIFE inside `acquireTerminal` (paneLayout context: terminalRegistry.ts:132-142, the `void (async () => { ... })();` block) with a call to a new helper, and add the helper above `acquireTerminal`:

```typescript
/** Build + run the launch command for a pane, ensuring the Headroom proxy is up
 *  first when routing is on. Resumes if the session log already exists. */
async function launchClaude(paneId: string, cwd: string, sessionId: string, resume: boolean, headroom: boolean, cols: number, rows: number): Promise<void> {
  const flags = "--dangerously-skip-permissions";
  let launch = `claude ${flags} --session-id ${sessionId}`;
  if (resume) {
    try { if (await sessionExists(cwd, sessionId)) launch = `claude ${flags} --resume ${sessionId}`; } catch { /* not under tauri */ }
  }
  let env: Record<string, string> | null = null;
  if (headroom) {
    try {
      await headroomEnsure();
      env = { ANTHROPIC_BASE_URL: HEADROOM_BASE_URL };
    } catch { /* proxy down: fall back to direct so the pane is never stuck */ }
  }
  void spawnPty(paneId, cwd, cols, rows, launch, env);
}
```

Then the body that used to be the IIFE becomes:

```typescript
  void launchClaude(paneId, cwd, sessionId, resume, headroom, term.cols, term.rows);
```

- [ ] **Step 3: Add `headroom` to `acquireTerminal`'s signature**

Change `acquireTerminal` (terminalRegistry.ts:89):

```typescript
export function acquireTerminal(paneId: string, cwd: string, sessionId: string, resume: boolean, headroom: boolean): TermEntry {
```

(The `term` is created before launch, so `term.cols/term.rows` are valid when `launchClaude` runs.)

- [ ] **Step 4: Add `setPaneHeadroom` (relaunch via resume)**

Add at the end of `terminalRegistry.ts`:

```typescript
/** Toggle Headroom routing for a LIVE pane: kill its claude and relaunch with
 *  --resume so the conversation is preserved (ANTHROPIC_BASE_URL is fixed at
 *  process start, so a restart is the only way to switch routing). */
export async function setPaneHeadroom(paneId: string, cwd: string, sessionId: string, on: boolean): Promise<void> {
  const e = registry.get(paneId);
  if (!e) return;
  await killPty(paneId);
  e.term.write("\r\n[switching Headroom routing…]\r\n");
  await launchClaude(paneId, cwd, sessionId, true, on, e.term.cols, e.term.rows);
}
```

- [ ] **Step 5: Build + typecheck**

Run: `npm run build` (or `npx tsc --noEmit`)
Expected: type error at the existing `acquireTerminal(...)` call site (TerminalPane) — fixed in Task 6. If building the whole app fails only there, that's expected; proceed to Task 6 then rebuild.

- [ ] **Step 6: Commit**

```bash
git add src/lib/terminalRegistry.ts
git commit -m "feat(terminal): route claude through Headroom proxy per-pane + relaunch on toggle"
```

---

### Task 6: PaneHeader toggle + prop wiring

A small switch in the Pane header that flips routing and relaunches.

**Files:**
- Modify: `src/components/PaneHeader.tsx:17-65` (new props + control), `src/components/PaneHeader.css` (switch styles)
- Modify: `src/components/TerminalPane.tsx` (pass `headroom` to `acquireTerminal`, render toggle, call `setPaneHeadroom`)
- Modify: `src/components/CockpitView.tsx` (dispatch `setHeadroom` action)

**Interfaces:**
- Consumes: `acquireTerminal(..., headroom)`, `setPaneHeadroom(...)` (Task 5); `reduce(..., {type:"setHeadroom"})` (Task 4).
- Produces: PaneHeader props `headroom: boolean`, `onToggleHeadroom: () => void`.

- [ ] **Step 1: Add props + control to PaneHeader**

In `src/components/PaneHeader.tsx`, extend the props type (after `working: boolean;`, line 20):

```typescript
  headroom: boolean;
  onToggleHeadroom: () => void;
```

Add the control just before the pop-out button (after the working chip `</span>`, PaneHeader.tsx:62):

```tsx
      <button
        className={`pane-head__hr${headroom ? " is-on" : ""}`}
        onClick={onToggleHeadroom}
        title={headroom ? "Headroom: เปิด (กดเพื่อปิด)" : "Headroom: ปิด (กดเพื่อเปิด)"}
        aria-pressed={headroom}
      >
        <span className="pane-head__hr-sw" /><span className="pane-head__hr-lbl">HR</span>
      </button>
```

Add `headroom` and `onToggleHeadroom` to the destructured params (PaneHeader.tsx:17).

- [ ] **Step 2: Style the switch**

Append to `src/components/PaneHeader.css`:

```css
.pane-head__hr { display:inline-flex; align-items:center; gap:5px; font:600 10px var(--ck-mono, ui-monospace,monospace);
  letter-spacing:.05em; color:var(--ck-muted); background:transparent; border:1px solid var(--ck-border);
  border-radius:999px; padding:2px 7px; cursor:pointer; transition:.16s; }
.pane-head__hr:hover { color:var(--ck-text); }
.pane-head__hr-sw { width:16px; height:9px; border-radius:999px; background:var(--ck-surface-2); position:relative; transition:.18s; }
.pane-head__hr-sw::after { content:""; position:absolute; top:1px; left:1px; width:7px; height:7px; border-radius:50%; background:var(--ck-muted); transition:.18s; }
.pane-head__hr.is-on { color:var(--ck-green); border-color:color-mix(in srgb, var(--ck-green) 45%, transparent); background:color-mix(in srgb, var(--ck-green) 8%, transparent); }
.pane-head__hr.is-on .pane-head__hr-sw { background:color-mix(in srgb, var(--ck-green) 40%, transparent); }
.pane-head__hr.is-on .pane-head__hr-sw::after { left:8px; background:var(--ck-green); }
```

- [ ] **Step 3: Wire TerminalPane**

In `src/components/TerminalPane.tsx`: pass the pane's `headroom` flag into `acquireTerminal(paneId, cwd, sessionId, resume, !!pane.headroom)`, render `<PaneHeader ... headroom={!!pane.headroom} onToggleHeadroom={onToggleHeadroom} />`, and define `onToggleHeadroom` to (a) dispatch the layout action and (b) call `setPaneHeadroom(paneId, cwd, sessionId, !pane.headroom)`. Use the existing prop-drilling pattern this file already uses for `onRename`/`onClose` (mirror those exactly — read the file first to match how the dispatch reaches it).

- [ ] **Step 4: Wire the dispatch in CockpitView**

In `src/components/CockpitView.tsx`, add a handler that maps a pane toggle to `dispatch({ type: "setHeadroom", paneId, on })`, following the same path the existing `renamePane`/`close` handlers use. Pass it down to `TerminalPane` the same way.

- [ ] **Step 5: Typecheck + build**

Run: `npm run build`
Expected: PASS (Task 5's call-site error is now resolved).

- [ ] **Step 6: Run unit tests**

Run: `npm test`
Expected: PASS (paneLayout + all existing suites).

- [ ] **Step 7: Manual verification**

1. `npm run tauri dev`, open a Pane in any folder.
2. Click `HR` → header chip turns green, terminal prints `[switching Headroom routing…]`, claude resumes, no `ConnectionRefused`.
3. `lsof -nP -iTCP:8787 -sTCP:LISTEN` → proxy is up.
4. Click `HR` again → relaunches direct; reload the app → the flag persisted (green stays green).

- [ ] **Step 8: Commit**

```bash
git add src/components/PaneHeader.tsx src/components/PaneHeader.css src/components/TerminalPane.tsx src/components/CockpitView.tsx
git commit -m "feat(ui): per-pane Headroom toggle in the pane header"
```

---

### Task 7: Remove the stale durable wrap

Cockpit now owns routing; the project-level env must go or it forces every Session in that folder ON.

**Files:**
- Modify: `~/Documents/akurax-wiki/.claude/settings.local.json` (remove the `env` block)

- [ ] **Step 1: Remove the env block**

Edit `~/Documents/akurax-wiki/.claude/settings.local.json` and delete the entire `"env": { "ANTHROPIC_BASE_URL": "http://127.0.0.1:8787" }` key. (Leave `permissions` and `remote` intact.)

- [ ] **Step 2: Verify direct connectivity from that folder**

Run: `cd ~/Documents/akurax-wiki && ANTHROPIC_BASE_URL= claude -p "say hi" --max-turns 1` (or open it in Ghostty) → connects to the real API with no proxy.

- [ ] **Step 3: (Optional) undo any durable hooks**

If `headroom doctor` still shows `claude … routed`, run `headroom unwrap claude` so nothing re-injects the env behind Cockpit's back. This file lives outside the repo — no commit.

---

## Self-Review

- **Spec coverage:** Toggle semantics (relaunch via resume) → Task 5/6. Single shared proxy + supervision + fallback → Task 2/5. cache mode → Task 2 (Global Constraints). Cockpit sole owner / remove env → Task 7. Per-Pane flag persisted → Task 4. UI toggle (variant B's header switch half; the Dashboard half is Plan 3) → Task 6. **Deferred to later plans:** Savings attribution from `--log-file` + Working-state correlation + Unattributed bucket (Plan 2), Dashboard readout with tokens/%/$/#requests (Plan 3). These are called out, not dropped.
- **Placeholder scan:** Tasks 3-5 carry full code. Tasks 6 Steps 3-4 intentionally say "mirror the existing prop-drilling pattern" because the exact wiring depends on TerminalPane/CockpitView internals not yet read — flagged explicitly with "read the file first", not a silent TODO.
- **Type consistency:** `headroom: boolean` (Pane), `setHeadroom`/`on` action, `acquireTerminal(..., headroom)`, `setPaneHeadroom(paneId, cwd, sessionId, on)`, `spawnPty(..., env)`, `headroomEnsure()`/`headroom_ensure`, `HEADROOM_BASE_URL`/`HEADROOM_PORT` consistent across tasks.

## Follow-on plans (write after Plan 1 lands)

- **Plan 2 — Savings attribution:** run the proxy with `--log-file`, tail `~/.headroom/logs/cockpit-proxy.jsonl`, sum `tokens_before − tokens_after` per request, attribute to the one `working` Session at that timestamp, else the **Unattributed** bucket. Empirically confirm the real JSONL field names first.
- **Plan 3 — Dashboard readout:** per-Session Savings table (tokens · %lost · ≈$ via `pricing.ts` · #requests) + Unattributed row, alongside Cost in the Dashboard (UI variant B).

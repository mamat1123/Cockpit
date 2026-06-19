# Claude Cockpit — M1: Single-Pane PTY Foundation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Tauri app with ONE terminal pane that runs a real interactive `claude` session through a PTY (rendered with xterm.js) — you can type to it and see output at full fidelity. This proves risk #1 (Rust ↔ webview IPC + portable-pty), the foundation everything else builds on.

**Architecture:** Tauri v2 desktop app. Rust core spawns `claude` inside a pseudo-terminal (portable-pty), runs a blocking reader thread that emits output bytes to the webview as Tauri events, and exposes commands to write input and resize. The React/xterm.js frontend renders the terminal and forwards keystrokes/resizes back. No Agent SDK, no terminal scraping (see `docs/adr/0003`).

**Tech Stack:** Tauri v2 · Rust (portable-pty) · React + Vite + TypeScript + Tailwind · xterm.js (`@xterm/xterm` + `@xterm/addon-fit`)

---

## Milestone roadmap (this plan = M1 only)

- **M1 — Single-pane PTY foundation** ← THIS PLAN. One pane, real interactive `claude`, type + see output. De-risks PTY/IPC.
- **M2 — Log-tail → working state.** Map a pane's cwd → its `~/.claude/projects/<enc>/<uuid>.jsonl`, tail it, derive `working|idle|waiting`. Render a status dot. (Pure parser = heavily TDD'd.)
- **M3 — Multi-pane + tabs + persistence.** Split/tile layout, tabs, restore layout on launch, resume sessions (`claude --continue`).
- **M4 — Cost.** Cost calc from log usage × editable price table (incl. cache tiers); per-session/per-project totals + daily/weekly charts. (Pure calc = heavily TDD'd.)
- **M5 — Juice layers.** Ambient pane effects, send-flourish, then activity ticker, then mascot/avatar.

Each milestone gets its own plan. Do not start M2 until M1 is verified working.

---

## File structure (M1)

```
claude-cockpit/
├── src-tauri/
│   ├── Cargo.toml
│   └── src/
│       ├── main.rs          # entry → calls lib::run()
│       ├── lib.rs           # Tauri builder, state, command registration
│       └── pty.rs           # PtyManager, pty_spawn/pty_write/pty_resize, validate_cwd
├── src/
│   ├── main.tsx
│   ├── App.tsx              # renders one <TerminalPane cwd=... />
│   ├── components/
│   │   └── TerminalPane.tsx # xterm.js + fit addon, wired to ptyClient
│   └── lib/
│       └── ptyClient.ts     # typed wrappers over Tauri invoke/listen
├── package.json
└── index.html
```

Responsibilities: `pty.rs` owns all PTY lifecycle (one clear job). `ptyClient.ts` is the only place the frontend talks to Tauri PTY commands. `TerminalPane.tsx` owns one xterm instance and its DOM. Keep these boundaries — M3 will instantiate many `TerminalPane`s.

---

## Task 1: Scaffold the Tauri v2 + React/TS app

**Files:**
- Create: whole project skeleton (generated)

- [ ] **Step 1: Scaffold with the official template**

Run (from `~/Work/claude-cockpit`, which already contains `docs/`):
```bash
cd ~/Work/claude-cockpit
npm create tauri-app@latest . -- --template react-ts --manager npm --identifier dev.cockpit.app --yes
```
If the directory-not-empty prompt blocks `.`, scaffold in a temp dir and move files in, preserving `docs/`.

- [ ] **Step 2: Pin and confirm the toolchain versions**

```bash
npm ls @tauri-apps/api @tauri-apps/cli 2>/dev/null
cargo --version && rustc --version
```
Expected: `@tauri-apps/cli` and `@tauri-apps/api` are **v2.x**. Record the exact `tauri` crate version from `src-tauri/Cargo.toml`. (The code below targets Tauri v2 — `AppHandle::emit`, `tauri::State`, `@tauri-apps/api/core`. If a signature differs in your pinned version, fix from the compiler/`tauri` docs — do not guess.)

- [ ] **Step 3: Run the dev app once to confirm the baseline works**

Run: `npm run tauri dev`
Expected: a native window opens showing the default template page. Close it (Ctrl-C).

- [ ] **Step 4: Add Tailwind (frontend styling, used from M2 on)**

```bash
npm install -D tailwindcss @tailwindcss/vite
```
Add `@tailwindcss/vite` to `vite.config.ts` plugins and `@import "tailwindcss";` to `src/App.css` (or a new `src/index.css` imported in `main.tsx`). Verify `npm run tauri dev` still renders.

- [ ] **Step 5: Commit**

```bash
git init && git add -A && git commit -m "chore: scaffold Tauri v2 + React/TS app"
```

---

## Task 2: Rust — `validate_cwd` (pure, TDD)

A pane must spawn `claude` in a real directory. `validate_cwd` is the one pure, unit-testable helper in M1 — build it test-first to establish the Rust test pattern.

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/Cargo.toml` (add `portable-pty`)

- [ ] **Step 1: Add the PTY dependency**

In `src-tauri/Cargo.toml` under `[dependencies]`:
```toml
portable-pty = "0.8"
```
Run `cargo build` inside `src-tauri/` to fetch it. Expected: builds (no usage yet).

- [ ] **Step 2: Write the failing test**

Create `src-tauri/src/pty.rs`:
```rust
/// Validate that a spawn cwd exists and is a directory.
/// Returns the canonicalized path string, or an error message.
pub fn validate_cwd(path: &str) -> Result<String, String> {
    let p = std::path::Path::new(path);
    if !p.exists() {
        return Err(format!("cwd does not exist: {path}"));
    }
    if !p.is_dir() {
        return Err(format!("cwd is not a directory: {path}"));
    }
    p.canonicalize()
        .map(|c| c.to_string_lossy().into_owned())
        .map_err(|e| format!("cannot canonicalize {path}: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_missing_dir() {
        let r = validate_cwd("/no/such/dir/xyz123");
        assert!(r.is_err());
        assert!(r.unwrap_err().contains("does not exist"));
    }

    #[test]
    fn accepts_temp_dir() {
        let tmp = std::env::temp_dir();
        let r = validate_cwd(tmp.to_str().unwrap());
        assert!(r.is_ok());
    }
}
```
Add `mod pty;` to `src-tauri/src/lib.rs` (top).

- [ ] **Step 3: Run the test to verify it passes** (this helper is simple enough to land green immediately; the value is the harness)

Run (in `src-tauri/`): `cargo test pty::tests -- --nocshould`  →  use `cargo test --lib pty`
Expected: 2 passed.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(pty): validate_cwd helper + Rust test harness"
```

---

## Task 3: Rust — `PtyManager` + `pty_spawn`

Spawn `claude` in a PTY, store the writer/master keyed by pane id, and stream output bytes to the webview via a blocking reader thread.

**Files:**
- Modify: `src-tauri/src/pty.rs`

- [ ] **Step 1: Add the manager + spawn command**

Append to `src-tauri/src/pty.rs`:
```rust
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    // keep child alive; killing it on drop is handled by portable-pty
    _child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyManager(pub Mutex<HashMap<String, PtySession>>);

/// Event channel a pane listens on for its output bytes.
pub fn output_event(pane_id: &str) -> String {
    format!("pty://output/{pane_id}")
}

#[tauri::command]
pub fn pty_spawn(
    app: AppHandle,
    mgr: State<PtyManager>,
    pane_id: String,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cwd = validate_cwd(&cwd)?;
    let pty = native_pty_system();
    let pair = pty
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())?;

    let mut cmd = CommandBuilder::new("claude");
    cmd.cwd(&cwd);
    // inherit the user's env so ~/.claude config / PATH / hooks all apply
    cmd.env("TERM", "xterm-256color");

    let child = pair.slave.spawn_command(cmd).map_err(|e| e.to_string())?;
    drop(pair.slave);

    let mut reader = pair.master.try_clone_reader().map_err(|e| e.to_string())?;
    let writer = pair.master.take_writer().map_err(|e| e.to_string())?;

    // blocking reader thread → emit output bytes (lossy UTF-8) to the webview
    let app2 = app.clone();
    let evt = output_event(&pane_id);
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,                  // EOF: claude exited
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).into_owned();
                    let _ = app2.emit(&evt, chunk);
                }
                Err(_) => break,
            }
        }
        let _ = app2.emit(&format!("pty://exit/{pane_id}"), ());
    });

    mgr.0.lock().unwrap().insert(
        pane_id,
        PtySession { master: pair.master, writer, _child: child },
    );
    Ok(())
}
```

- [ ] **Step 2: Build to verify it compiles**

Run (in `src-tauri/`): `cargo build`
Expected: compiles. If `Child` isn't `Sync`, change the struct field bound to `Box<dyn portable_pty::Child + Send>` and adjust (don't move the child across threads). Fix from the compiler message.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/pty.rs
git commit -m "feat(pty): PtyManager + pty_spawn (claude in a PTY, reader thread → events)"
```

---

## Task 4: Rust — `pty_write`, `pty_resize`, registration

**Files:**
- Modify: `src-tauri/src/pty.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1: Add write + resize commands**

Append to `src-tauri/src/pty.rs`:
```rust
#[tauri::command]
pub fn pty_write(mgr: State<PtyManager>, pane_id: String, data: String) -> Result<(), String> {
    let mut map = mgr.0.lock().unwrap();
    let s = map.get_mut(&pane_id).ok_or("no such pane")?;
    s.writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    s.writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn pty_resize(mgr: State<PtyManager>, pane_id: String, cols: u16, rows: u16) -> Result<(), String> {
    let map = mgr.0.lock().unwrap();
    let s = map.get(&pane_id).ok_or("no such pane")?;
    s.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| e.to_string())
}
```

- [ ] **Step 2: Register state + commands in `lib.rs`**

In `src-tauri/src/lib.rs`, inside the `tauri::Builder` chain:
```rust
mod pty;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(pty::PtyManager::default())
        .invoke_handler(tauri::generate_handler![
            pty::pty_spawn,
            pty::pty_write,
            pty::pty_resize,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

- [ ] **Step 3: Build to verify it compiles**

Run (in `src-tauri/`): `cargo build`
Expected: compiles clean.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs
git commit -m "feat(pty): pty_write + pty_resize + command registration"
```

---

## Task 5: Frontend — `ptyClient.ts`

A typed wrapper so the rest of the UI never calls `invoke` directly.

**Files:**
- Create: `src/lib/ptyClient.ts`

- [ ] **Step 1: Install xterm**

```bash
npm install @xterm/xterm @xterm/addon-fit
```

- [ ] **Step 2: Write the client**

Create `src/lib/ptyClient.ts`:
```ts
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export function spawnPty(paneId: string, cwd: string, cols: number, rows: number) {
  return invoke("pty_spawn", { paneId, cwd, cols, rows });
}

export function writePty(paneId: string, data: string) {
  return invoke("pty_write", { paneId, data });
}

export function resizePty(paneId: string, cols: number, rows: number) {
  return invoke("pty_resize", { paneId, cols, rows });
}

export function onPtyOutput(paneId: string, cb: (chunk: string) => void): Promise<UnlistenFn> {
  return listen<string>(`pty://output/${paneId}`, (e) => cb(e.payload));
}

export function onPtyExit(paneId: string, cb: () => void): Promise<UnlistenFn> {
  return listen(`pty://exit/${paneId}`, () => cb());
}
```

- [ ] **Step 3: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add package.json package-lock.json src/lib/ptyClient.ts
git commit -m "feat(ui): typed ptyClient wrapper over Tauri commands"
```

---

## Task 6: Frontend — `TerminalPane.tsx`

One xterm instance, fit-to-container, wired to `ptyClient`.

**Files:**
- Create: `src/components/TerminalPane.tsx`

- [ ] **Step 1: Write the component**

Create `src/components/TerminalPane.tsx`:
```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "../lib/ptyClient";

export function TerminalPane({ paneId, cwd }: { paneId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const unlisteners: Array<Promise<() => void>> = [];
    unlisteners.push(onPtyOutput(paneId, (chunk) => term.write(chunk)));
    unlisteners.push(onPtyExit(paneId, () => term.write("\r\n[claude exited]\r\n")));

    // forward keystrokes
    const onData = term.onData((data) => { void writePty(paneId, data); });

    // spawn after the first fit so cols/rows are real
    void spawnPty(paneId, cwd, term.cols, term.rows);

    // keep PTY size in sync with the pane
    const ro = new ResizeObserver(() => {
      fit.fit();
      void resizePty(paneId, term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((un) => un()));
      term.dispose();
    };
  }, [paneId, cwd]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
```

- [ ] **Step 2: Type-check + commit**

Run: `npx tsc --noEmit`
Expected: no errors.
```bash
git add src/components/TerminalPane.tsx
git commit -m "feat(ui): TerminalPane (xterm + fit, wired to PTY)"
```

---

## Task 7: Wire `App.tsx` + end-to-end verification with real `claude`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Render one pane**

Replace `src/App.tsx` body with:
```tsx
import { TerminalPane } from "./components/TerminalPane";

// TEMP for M1: hardcode a real project dir you own. M3 makes this user-chosen.
const CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

export default function App() {
  return (
    <div style={{ position: "fixed", inset: 0, background: "#1e1e1e", padding: 8 }}>
      <TerminalPane paneId="pane-1" cwd={CWD} />
    </div>
  );
}
```

- [ ] **Step 2: Run and verify interactively** (manual — this is a GUI/PTY integration, verified by observation, not a unit test)

Run: `npm run tauri dev`
Expected, in order:
1. Window opens; within ~1s the `claude` TUI renders inside the pane (banner / prompt box).
2. Type `hello` and press Enter → claude responds (streamed text appears).
3. Resize the window → terminal reflows, no garbled columns.
4. Type `/exit` (or Ctrl-C twice) → `[claude exited]` appears.

If claude is not found: confirm `which claude` resolves; if it's a shell function/alias (it is, per the user's setup), set `CommandBuilder::new` to the absolute binary from `which -a claude | tail -1` (the real binary, not the zsh function) and pass needed env. Record the resolution in `pty.rs` as a `resolve_claude_binary()` helper and add a unit test that it returns an absolute path.

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): render one live claude pane end-to-end (M1 vertical slice)"
```

---

## Task 8: M1 wrap-up

- [ ] **Step 1: Update the spec's risk #1 as retired**

In `SPEC.md`, under "Top risks", mark risk #1 (Rust↔webview IPC + portable-pty) as ✅ proven by M1, dated 2026-06-19.

- [ ] **Step 2: Note the claude-binary resolution decision**

If Task 7 needed `resolve_claude_binary()` (absolute path because `claude` is a zsh function), add `docs/adr/0006-resolve-claude-binary.md` recording it (the real interactive binary, not the shell wrapper, and which env vars must be forwarded).

- [ ] **Step 3: Commit**

```bash
git add SPEC.md docs/
git commit -m "docs: M1 done — PTY foundation proven; record claude-binary resolution"
```

---

## Self-review

**Spec coverage (M1 slice):** PTY display of real interactive `claude` ✅ (Tasks 3–7); reuses ~/.claude via inherited env ✅ (Task 3); Tauri/Rust-core/web-frontend architecture ✅ (Tasks 1,3,4,6). Cost / log-tail / multi-pane / persistence / juice are explicitly **out of M1** → M2–M5 (roadmap above). No spec requirement is silently dropped.

**Placeholder scan:** the one `CWD` constant and the `claude`-binary resolution are explicit, justified TEMP/decision steps with concrete fallbacks (Tasks 7–8), not "TODO" dodges. Task 2 Step 3 command had a typo — use `cargo test --lib pty`.

**Type consistency:** command names match across layers — Rust `pty_spawn/pty_write/pty_resize` (snake_case) ↔ `invoke("pty_spawn", { paneId, cwd, cols, rows })` (Tauri auto-maps `paneId`→`pane_id`). Event names: Rust `output_event(pane_id)` = `pty://output/{id}` ↔ frontend `onPtyOutput` listens `pty://output/${paneId}`. ✅

**Known caveat:** exact Tauri v2 symbol names (`Emitter` trait import for `app.emit`, `@tauri-apps/api/core`) can shift across v2 minor versions — Task 1 Step 2 pins versions and the build steps (Tasks 3,4) catch mismatches via the compiler before runtime.

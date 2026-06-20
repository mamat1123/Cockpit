# Cockpit — Per-pane session identity + pop-out preserves session (Design)

**Date:** 2026-06-20
**Status:** Design — pending plan
**Scope:** Two related correctness bugs in the pane/session model.

## สรุป (TL;DR)
- **Bug A:** ชื่อ tab/pane (และ working-state) เปลี่ยนพร้อมกันทุกแพน เพราะระบบ resolve session จาก "log ล่าสุดของ cwd" — หลายแพน cwd เดียวกัน → log ไฟล์เดียวกัน. แก้: แต่ละแพนมี **session uuid ของตัวเอง** (cockpit รัน `claude --session-id <uuid>`) แล้ว topic/activity อ่านจากไฟล์ uuid นั้นตรงๆ.
- **Bug B:** pop-out แพนไป tab ใหม่แล้ว claude session หาย เพราะแพนถูก remount → spawn shell ใหม่. แก้: **React portals** — mount แพนครั้งเดียวที่ top level, portal เข้า slot ตามตำแหน่ง → ย้าย tab ไม่ remount → xterm+PTY+scrollback+claude รอดครบ.

## Bug B — pop-out preserves session (React portals)

**Root cause (confirmed):** `CockpitView` renders one `<TabPanes>` per tab; each `TerminalPane` (keyed by paneId) lives under its tab's subtree. `popOut` moves the pane to a *new* tab subtree → React unmounts/remounts it → its `useEffect` re-runs `spawnPty` → fresh shell. Also `pty_spawn` (`pty.rs:127`) `insert`s over the old `PtySession`, dropping it → the old child (claude) is killed.

**Fix:** decouple *where a pane lives in the React tree* from *where it appears in the DOM*.
- New `PaneHost` (rendered once, top-level): for every pane in the layout, render `<TerminalPane key={pane.id} … />` **once** and `createPortal` it into that pane's current **slot** DOM node.
- `TabPanes`/`RowPanes` render only empty **slot `<div>`s** (with a ref callback that registers `paneId → element` in a shared slot registry). The flex layout still lives here, so sizing is unchanged.
- A pane moving between tabs (pop-out) or repositioning only changes its portal target → the React component instance (xterm, PTY listeners, scrollback) **persists, never remounts**. Inactive tabs' slots are `display:none`; their portaled terminals stay mounted (PTY alive).
- Defense-in-depth: make `pty_spawn` idempotent (if a session for `pane_id` exists, no-op) so any stray remount can't double-spawn or kill the session.

**Slot/portal timing:** the slot ref callback writes the element into a `useState` map; that re-render lets `PaneHost` portal into the now-present node (avoids portaling into a null ref on the first render of a new slot).

## Bug A — deterministic per-pane session

**Root cause (confirmed):** `pane_topic(cwd)` and `logtail_start(paneId, cwd)` both resolve via `newest_session_file(project_log_dir(cwd))` — "newest *.jsonl for the cwd". N panes in one cwd → same newest file → identical topic + simultaneous "working".

**Fix:** give each pane its own claude session id and read that exact log.
- `Pane` gains `sessionId: string` — a v4 uuid (`crypto.randomUUID()`) generated in `makePane`.
- Pane opens the login shell (unchanged — keeps PATH/zsh-function), then cockpit **auto-runs `claude --session-id <sessionId>`** by writing that line to the PTY. (Exiting claude leaves you in the shell, as today.) `claude --session-id <uuid>` is verified to exist.
- `pane_topic(cwd, sessionId)` and `logtail_start(paneId, cwd, sessionId)` build the **exact path** `~/.claude/projects/<encode(cwd)>/<sessionId>.jsonl` and read/tail *that file only* — no newest-scan. Simpler and unambiguous.
- Result: each pane's name + working-state follow its own session.

## Edge cases
- **v1 launch policy:** every new pane auto-launches claude (`launch = "claude --session-id <sessionId>"`, computed in `TerminalPane` from the pane's `sessionId`). The plumbing supports `launch = null` (plain shell — no session file, name = cwd basename, no activity; logtail polls the exact path and emits nothing until the file appears), but **no UI trigger for plain-shell in v1** — it's a trivial future addition.
- **claude exits then re-run:** the pane keeps its `sessionId`; re-running uses the same id (resume). Auto-launch always uses the pane's id.
- **Pane close:** currently leaks (PTY + logtail thread live on). This milestone adds cleanup: `close`/`popOut`-of-last + unmount kills the PTY (`pty_kill`) and stops the logtail for panes actually removed (not for panes merely moved — portals mean moved panes never unmount).
- **session-id path encoding:** reuse the verified `encode_project_dir` (`/` and `.` → `-`).

## Components / files
- `src/layout/paneLayout.ts` — add `sessionId` to `Pane`; `makePane` generates it.
- `src/components/PaneHost.tsx` (new) — mounts all panes once + portals into slots; owns the slot registry.
- `src/components/TabPanes.tsx` — render slot divs (register refs) instead of `<TerminalPane>` directly.
- `src/components/CockpitView.tsx` — render `<PaneHost>` alongside the slot tree; wire `pty_kill`/`stopLogtail` for removed panes.
- `src/components/TerminalPane.tsx` — accept `sessionId` + `launch`; pass them to spawn; poll topic/logtail by sessionId.
- `src/lib/ptyClient.ts` — `spawnPty(paneId, cwd, cols, rows, launch)`, add `killPty(paneId)`.
- `src/lib/logClient.ts` — `paneTopic(cwd, sessionId)`, `startLogtail(paneId, cwd, sessionId)`.
- `src-tauri/src/pty.rs` — `pty_spawn` writes `launch` line after spawn + idempotent guard; add `pty_kill`.
- `src-tauri/src/logtail.rs` — `pane_topic(cwd, session_id)` + `logtail_start(... session_id)` read the exact `<uuid>.jsonl`; add a `session_log_path(home, cwd, uuid)` helper.

## Testing
- **pure (vitest):** `makePane` produces a unique `sessionId`; flatten-layout → ordered pane list (for PaneHost); slot-registry add/remove.
- **Rust:** `session_log_path` builds `…/<enc cwd>/<uuid>.jsonl`; `pane_topic(cwd, uuid)` reads that exact file (not newest); plain-shell (missing file) → None.
- **manual GUI (the real proof):** open 2 panes → 2 different names; talk to claude A in one, pop it out → conversation A still shown (not a fresh shell); the other pane's name unaffected.

## Out of scope
- Reflowing/replaying scrollback for a *reattached* PTY (portals make reattach unnecessary).
- Multi-window / detached OS windows (pop-out stays an in-app new tab for now).

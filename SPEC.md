# Claude Cockpit — v1 Design Spec (working name)

## What it is
A juicy, multi-pane macOS desktop cockpit for running many interactive Claude Code sessions
at once — a richer replacement for Ghostty. The thing a generic terminal can't do, and the
reason to build: **per-pane Claude-awareness** (live working/idle/waiting state + cost),
rendered to feel satisfying. "Game-like" = aesthetic JUICE, not game mechanics (no score).

## Architecture
- **Shell:** Tauri — Rust core + web frontend (React/Vite/Tailwind + xterm.js).  [ADR 0004]
- **Per pane:** a real interactive `claude` in a PTY (Rust `portable-pty`), rendered with
  xterm.js. Full fidelity; reuses the user's ~/.claude config / MCP / skills / hooks.
- **Data layer:** Rust tails `~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl` per pane
  → structured events (turn start/end, tool_use, per-turn usage, model, permission state)
  streamed to the frontend via Tauri IPC.  [ADR 0003]
- No Agent SDK, no terminal-scraping.

## v1 feature set  (spearhead = Claude-awareness, made juicy)
1. **Multi-pane + tabs** — split/tiled layout. (parity with Ghostty; table stakes)
2. **Per-pane working state** from log-tail → status + ambient juice (working / idle /
   waiting-for-you). Designed as LAYERS: the parser surfaces rich events from day 1 so an
   activity ticker and a mascot/avatar can be added later without re-plumbing.
3. **Cost** — per-session + per-project running totals + daily/weekly time charts.
   From log usage × an editable model→price table that accounts for cache tiers.  [ADR 0005]
4. **Persistence** — layout (panes/projects/splits) restored on launch; each pane resumes
   its prior session (`claude --continue/--resume` via the tracked session uuid).
5. **Combo / juice** — cosmetic flourish on send; no scoring.  [ADR 0002]

## Fast-follow (post-v1)
- Cross-project dashboard (aggregate cost/activity across all panes).
- Activity-ticker + mascot/avatar working-state layers.
- Budget alerts / caps per project.

## Out of scope (v1)
- Task orchestration / worktree batch dispatch.  [ADR 0001]
- Any scoring / combo game system.  [ADR 0002]
- Non-Claude CLI agents (Claude Code only).

## Top risks — spike in this order
1. **Rust ↔ webview IPC + portable-pty**: spawn interactive `claude` in a PTY, render in
   xterm.js, type back. Least-familiar piece (Rust) and the foundation.  [ADR 0004]
2. **Log-tail → state**: map a pane's cwd to its session jsonl, tail it live, derive
   working/idle/waiting from event types.
3. **Cost correctness**: cache-tier math + keeping the price table current.

## Open questions (pin before/while building)
- "หลายจอ" = multiple physical monitors, or just panes/splits? (affects window management)
- App name.
- Motion-design language for the juice (a later design pass).

---

## Status — updated 2026-06-19

**M1 (single-pane PTY foundation) — DONE & verified.**
- Risk #1 (Rust ↔ webview IPC + portable-pty) — ✅ RETIRED. Proven by a working pane: a real
  interactive login shell runs in xterm.js via portable-pty; `claude` launches and is usable;
  input, resize, and exit all work; Thai output is not corrupted (UTF-8 carry-buffer fix).
- Adjustment from plan: panes spawn the user's `$SHELL -il`, not `claude` directly (ADR 0006) —
  fixes the GUI-PATH problem and makes the pane a true terminal.
- 8 commits on `main`. Remaining M1 follow-ups deferred to later milestones: `pty_kill` +
  pane lifecycle (so unmount stops the process; also re-enables StrictMode), dead-session
  cleanup from the manager map, and per-pane auto-launch of `claude`.

## Status — updated 2026-06-20

**M1 → M4 DONE & GUI-verified.** Shipped, all on `main` (attribution-free):
- **M1** PTY foundation · **M2** working/idle from per-pane signal (HUD chip + breathing vignette) ·
  **M3** tabs/splits/keybindings (⌘T/D/⇧D/W) · **M3b** resize/window-drag/tab-reorder ·
  **M3c** per-pane header (editable name + status + pop-out ↗ + close) · **M3d** auto-name from session topic.
- **pane-session-identity**: each pane has a uuid `sessionId`, auto-runs `claude --session-id <uuid>`,
  reads that exact log for name/activity (fixes same-cwd panes sharing a name). Pop-out/drag preserve the
  running session via a terminal **registry** (xterm lives outside React; React-portal container changes
  remount, so the host `<div>` is moved with `appendChild`). Pane drag-and-drop needs Tauri
  `dragDropEnabled:false` + has drop-preview feedback.
- **M4 — Dashboard ("Mission Control")**: ⌘0 (or a ▦ tab-bar button) opens an overlay listing every
  session across tabs as a bay (name, repo, live working/idle, tab #, last-active); click → jump to that
  pane + focus its terminal (also focus-on-tab-switch). Activity from the registry.
- **M5 — Cost**: Rust `session_usage` reads each pane's `<uuid>.jsonl` incrementally → per-model token
  tiers (input/output/cache-read/cache-write-5m/cache-write-1h, split because 1h writes cost 2x vs 5m
  1.25x). Frontend `pricing.ts` (editable table, localStorage, defaults) × tokens = USD. Dashboard shows
  per-session `$` per bay + a grand total. (Per-project grouping, a price-table editor UI, and
  server-tool costs are fast-follow.)

- **M6 — Cost analytics**: a "Cost" tab in Mission Control with ECharts charts across ALL projects —
  daily-spend bars, by-project bars, by-model donut, token-tier breakdown — + a period filter
  (Today/7d/30d/All) and a big total. Rust `cost_report` scans every `~/.claude/projects/*/*.jsonl`
  incrementally (per-file offset + global message-id dedup); frontend filters/groups/prices via the
  editable table. `echarts` ^6 via a tiny `<EChart>` wrapper (React 19 → no react-wrapper lib).

- **M7 — Cost by session + jump/resume**: the Cost view lists every chat session with its cost
  (period-filtered, sorted), and clicking a session jumps to it — focuses its pane if open, else
  opens a new tab that resumes it (`claude --resume <id>` in its cwd). `cost_report` now returns
  per-session buckets + metadata (cwd/project/title from the first user message); reducer gains
  `openSession` + `Pane.resume`.

- **M8 — Project picker**: a command-palette launcher (the `+` button or ⌘O) lists recent repos
  (every cwd you've run claude in, via Rust `list_projects` over the logs, newest first), filters as
  you type, accepts a pasted absolute path for a new repo, and opens the chosen repo in a new tab
  (`newTab` now takes an optional cwd). ⌘T still makes an instant tab in the current repo.

- **M9 — Presets + auto-restore**: the layout is serialized to localStorage and **auto-restored on
  launch** (with session ids → each pane `claude --resume`s its prior conversation). A **Workspaces**
  menu (⊞ button / ⌘E) saves the current arrangement as a named preset (cwd/structure, no sessions)
  and loads/deletes them; loading replaces the layout with fresh claude sessions. `serializeLayout`/
  `deserializeLayout` + `loadLayout` action; `src/lib/persistence.ts`.

- **M10 — Juice** (ADR 0002, pure visual): retargeted from keypress-combo (wrong rhythm) to the real
  async flow — a **launch flash** on send (Enter), a **swarm meter** whose intensity escalates with the
  number of panes working concurrently (the "combo" reframed to real parallelism), and a **completion
  pull-back** glow on a background tab when a pane there finishes (clears when you view it). Thinking
  ambient = the existing breathing vignette. `juiceBus` + a `<Juice>` overlay polling registry state.

**Next candidates:** native folder dialog in the picker, price-editor UI, tool-use blips (needs log tool_use parsing), per-pane cost in the dashboard bays.

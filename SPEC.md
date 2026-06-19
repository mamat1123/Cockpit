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

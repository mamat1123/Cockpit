# Cockpit Feature Matrix

Status snapshot: v0.7.0

| Feature | Status | Details |
|---|---:|---|
| Claude Code panes | Shipped | Each pane runs the real Claude Code CLI through PTY/xterm. |
| Multi-pane / tabs | Shipped | Split, tabs, resize, drag/reorder, and pop-out. |
| Per-pane Claude session id | Shipped | Each pane owns a separate `sessionId` and can resume it. |
| Auto-restore layout | Shipped | Relaunch restores panes and resumes saved sessions. |
| Workspaces / presets | Shipped | Save and load named layouts. |
| Mission Control | Shipped | Dashboard for all panes/sessions. |
| Working / idle state | Shipped | Derived from PTY/logtail activity. |
| Completion notifications | Shipped | Toasts, Beacon, and macOS notifications. |
| Cost analytics | Shipped | Reads Claude logs from `~/.claude`, grouped by session/project/model. |
| Usage gauges | Shipped | Account usage/rate-limit panel. |
| Headroom toggle `HR` | Shipped | Per-pane proxy routing. |
| Headroom savings | Shipped | Cache hits, tokens saved, and estimated savings. |
| Ponytail level `PT` | Shipped | Per-pane `off/lite/full/ultra` level. |
| Theme / font / blur settings | Shipped | Theme palette, accent, terminal font, opacity, and blur controls. |
| Auto-update | Shipped | GitHub Release updater with `latest.json`; current release is `v0.7.0`. |
| Codex provider toggle | Shipped in v0.7.0 | Header has a `Claude / Codex` provider toggle. |
| Claude to Codex handoff | Shipped in v0.7.0 | Reads the Claude JSONL transcript and opens a Codex pane beside it. |
| Codex launch flags | Shipped in v0.7.0 | Every Codex launch uses `--dangerously-bypass-approvals-and-sandbox`. |
| Codex pane via PTY | Shipped in v0.7.0 | Runs `codex --cd <cwd> <handoff prompt>` in a pane. |
| Codex to Claude return | Shipped in v0.7.0 | Switching back to Claude jumps/resumes the source Claude session. |
| Token used display | Shipped after v0.7.0 | Pane header and Mission Control show token totals for Claude and Codex panes. |
| Native shared Claude/Codex session | Not supported | Claude and Codex use separate stores/protocols; Cockpit bridges via handoff. |
| Codex cost analytics | Not yet | Current cost pipeline is Claude JSONL-specific. |
| Codex structured working/completion events | Not yet | Codex panes currently use PTY activity, not Codex JSONL/app-server events. |
| Codex session resume in Cockpit | Partial | Codex can launch, but Cockpit does not yet persist/restore native Codex thread ids. |
| Direct Claude session id import UI | Not yet | Handoff currently starts from an existing Claude pane. |
| Switch-in-place Claude/Codex | Not yet | Current behavior is side-by-side to preserve the source session. |

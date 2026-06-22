# 0007 — Completion is detected from the jsonl turn-end, not the PTY-output heuristic

Context: everywhere else in Cockpit, a Session's working/idle state is derived from
PTY-output recency (`paneLastLineAt` — "grew within 800ms = working"), which drives the
tab dot, the swarm meter, and the completion glow. A reasonable reader would expect the
new completion **notifications** to reuse that same signal.

Decision: notifications fire on a **Completion** detected from the session jsonl
transcript — an assistant message that *ended the turn* (`stop_reason: "end_turn"`, not
`"tool_use"`), read off the already-streaming `pane://log/<paneId>` lines and debounced
~300ms against half-written lines. The PTY-output heuristic stays as-is for the ambient
glow/dot; it is NOT the basis for notifications.

Why it matters: the PTY heuristic false-fires whenever a turn goes quiet mid-work (a slow
`npm test`, a long network/MCP call, deep thinking) — with "notify on every Completion"
that means 2–3 spurious notifications per real turn. For a "you're done" notifier,
crying wolf is the cardinal failure, so accuracy beats consistency-with-the-glow. The
trade-off is a dependency on the Claude Code transcript schema, retired by a one-task
spike against a live session log before relying on it.

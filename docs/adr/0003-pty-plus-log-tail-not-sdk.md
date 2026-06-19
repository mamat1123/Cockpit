# 0003 — PTY display + session-log tailing, not the Agent SDK

Context: a terminal-first cockpit must render the REAL interactive `claude` TUI in each
pane. Cost and "working" state are needed for the dashboard + juice. Options considered:
scrape the terminal (can't get cost reliably), Agent SDK sidecar (loses the real-CLI feel
and adds a Node process), or PTY for display + read Claude's own session logs for data.

Decision: each pane runs real interactive `claude` in a PTY (xterm.js for display).
Structured data — per-turn cost, model, turn start/end, permission state — is obtained by
tailing ~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl. No Agent SDK.

Why it matters: resolves the long-running "Agent SDK (B) vs PTY (C)" question. Verified
against real logs: the jsonl already carries per-message usage (input/output/cache tokens
+ model) and event types, so cost-by-project and working-state come for free — no scraping,
no SDK sidecar. The real CLI reuses the user's full ~/.claude config / MCP / skills / hooks.

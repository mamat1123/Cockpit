# 0009 — Account usage read from the live OAuth API, not derived from logs

Context: the cockpit's data philosophy is logs-only — PTY + log-tail, no SDK, no API
([ADR 0003]), and even Cost is computed locally from log tokens ([ADR 0005]). But rate-limit
*utilization* (the 5-hour and weekly windows) cannot be reconstructed from logs: the actual
limits are undisclosed and the windows are rolling, so any local estimate would be guesswork.

Decision: fetch Usage from the live `GET api.anthropic.com/api/oauth/usage` endpoint, which
returns `five_hour`/`seven_day` `utilization` + `resets_at` directly. The Rust `usage_report`
command shells out to `curl` (no HTTP dependency added) and reads the OAuth token the same way
`~/.claude/statusline.sh` does: `CLAUDE_CODE_OAUTH_TOKEN` env → macOS keychain
("Claude Code-credentials") → `~/.claude/.credentials.json`. If the live read can't run
(no token, or the keychain isn't readable from the GUI process), it falls back to
statusline.sh's local cache (`/tmp/claude/statusline-usage-cache.json`, same JSON shape,
refreshed ~60s) before degrading — so the gauges stay populated without re-prompting.

Why it matters / consequences: this is a deliberate deviation a future reader would question —
it introduces the app's first authenticated network call and OAuth-token handling into an
otherwise local, log-derived tool. It also adds a soft external dependency (the endpoint shape
and the `oauth-2025-04-20` beta header may change). The blast radius is contained to one
command: failures degrade gracefully (`status: no_token | error`) so the UI keeps the last good
value rather than breaking. Refresh is event-driven (on a turn finishing) + a 60s baseline,
because `utilization` only moves when tokens are actually spent.

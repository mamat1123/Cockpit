# Codex Support Matrix

Status snapshot: v0.7.0

This document tracks whether each Cockpit feature can support Codex, what is already implemented, and what blocks full parity with Claude Code.

| Cockpit feature | Codex support | Current state | Why / implementation notes |
|---|---:|---|---|
| PTY terminal pane | Yes | Implemented | Codex CLI is a real terminal app, so the existing PTY/xterm stack can launch it like Claude. |
| Multi-pane / tabs / split layout | Yes | Implemented | Layout is agent-agnostic once a pane can attach to a PTY. |
| Provider toggle `Claude / Codex` | Yes | Implemented in v0.7.0 | Pane state now carries `provider: "claude" | "codex"`. |
| Claude to Codex handoff | Yes | Implemented in v0.7.0 | Cockpit reads the Claude JSONL transcript, compacts it into a handoff prompt, and opens a Codex pane beside the Claude pane. |
| Codex launch flags | Yes | Implemented in v0.7.0 | Every Codex launch uses `--dangerously-bypass-approvals-and-sandbox`. |
| Codex pane launch from handoff prompt | Yes | Implemented in v0.7.0 | Cockpit writes the handoff prompt to a temp file and launches `codex --cd <cwd> "$(cat <prompt-file>)"`. |
| Codex back to Claude jump | Yes | Implemented in v0.7.0 | Codex panes remember the source Claude `sessionId`; switching back focuses or resumes that Claude session. |
| Token used display | Partial | Claude only | Claude panes sum Claude usage from session logs and show it in the pane header/Mission Control. Codex has no equivalent cumulative per-session token count yet — a different metric from the 5h/weekly rate-limit % below, which Codex now has. |
| Direct Claude session id import UI | Yes | Not yet | Technically straightforward: add an input for Claude `sessionId`, resolve `~/.claude/projects/*/<sessionId>.jsonl`, then reuse the existing handoff command. |
| Switch-in-place Claude to Codex | Yes | Not yet | Possible, but side-by-side is safer. Switch-in-place would need to kill/park the Claude PTY, launch Codex in the same pane, and preserve a way back. |
| Native shared session between Claude and Codex | No | Not supported | Claude and Codex have different session stores, transcript schemas, and resume protocols. Cockpit can bridge context, but cannot make one native shared session. |
| Per-pane session identity | Partial | Claude only | Claude panes track Claude `sessionId`. Codex needs a separate `codexThreadId` or Codex session id stored per pane. |
| Auto-restore Codex panes | Partial | Not reliable yet | Layout can persist `provider`, but the current Codex handoff prompt path is temporary and not persisted. Full restore needs native Codex resume/thread tracking. |
| Resume prior Codex session | Yes | Not yet | Codex supports its own resume flow, but Cockpit does not yet capture and persist the Codex session/thread id. |
| Codex logtail / transcript reader | Yes | Not yet | Possible by reading Codex's local session JSONL or using Codex app-server events. It needs a separate provider parser, not the Claude JSONL parser. |
| Working / idle state | Partial | PTY heuristic only | Codex panes currently show activity from PTY output. Full parity needs structured Codex turn start/end events. |
| Completion notifications | Yes | Not yet for Codex | Claude completion uses Claude JSONL turn-end parsing. Codex can support this through app-server `turn.completed` or Codex event logs, but needs a Codex event adapter. |
| Mission Control listing | Yes | Mostly works | Codex panes appear as panes, but labels/cost/session metadata are still Claude-biased in places. |
| Cost by session | Partial | Claude only for dollars; token totals visible | Codex can expose token usage, but cost semantics differ. API-key Codex can map tokens to OpenAI pricing; ChatGPT-plan Codex does not expose the same billable cost model as Claude logs. |
| Cost analytics charts | Partial | Claude only | Chart infrastructure is reusable, but the data source must be split by provider and normalize different usage fields. |
| Usage / rate-limit gauges | Yes | Implemented | Codex reads local `~/.codex/sessions` rollout files (`usage_report_codex`, no network); z.ai reads its official monitor API with a Keychain-saved token (`usage_report_zai`). Both show 5h/weekly % + reset time in the tab-bar strip and Mission Control, same as Claude. |
| Headroom `HR` routing | No | Claude only | Headroom works by routing Anthropic traffic via Claude/Anthropic environment variables. Codex does not use `ANTHROPIC_BASE_URL`. |
| Headroom savings attribution | No | Claude only | Savings are computed from Headroom proxy logs, which only see Claude/Anthropic traffic. |
| Ponytail `PT` level | No native support | Claude only | Ponytail is a Claude Code plugin using Claude hooks/session-start behavior. Codex could approximate this with a prompt/profile, but not the actual plugin. |
| Claude plugins / hooks reuse | No direct support | Claude only | Claude Code plugin/hooks are not Codex plugin/hooks. Some behavior can be ported manually, but not reused as-is. |
| MCP tools | Yes | Not wired per provider | Codex supports MCP, but Cockpit currently relies on the user's CLI config. A provider-aware MCP settings UI would be separate work. |
| Drag/drop image into pane | Partial | Works as terminal paste only | Existing image drop writes a saved file path into the PTY. Codex may need `--image` or its own TUI image handling for first-class image attachment. |
| Project picker | Yes | Mostly works | It opens folders/panes. Recent-project discovery currently comes from Claude logs, so Codex-only projects would need Codex project discovery too. |
| Auto-title from session topic | Partial | Claude only | Current title comes from the first Claude user message in JSONL. Codex needs a Codex transcript parser or app-server metadata. |
| Workspaces / presets | Partial | Layout works | Provider metadata can persist, but full Codex session restoration needs Codex session id persistence. |
| Theme / font / blur settings | Yes | Works | UI/terminal styling is provider-agnostic. |
| Toast / Beacon UI shell | Yes | UI reusable | The UI can show Codex completion once Codex structured completion events are added. |
| Auto-update | Yes | Works | Release/updater system is app-level, not provider-specific. |

## Recommended Codex Parity Roadmap

1. **Codex session identity**
   - Capture Codex session/thread id when launching Codex.
   - Store it on `Pane` as `codexSessionId` or `codexThreadId`.
   - Implement `codex resume <id>` path for restored Codex panes.

2. **Codex event adapter**
   - Add a provider interface for `turn_started`, `turn_completed`, usage, and title.
   - Keep Claude JSONL parser as one adapter.
   - Add Codex parser/app-server adapter as the second adapter.

3. **Direct Claude session import**
   - Add a UI command/input for `Claude session id`.
   - Resolve the session across `~/.claude/projects/*`.
   - Reuse the existing handoff flow.

4. **Provider-aware analytics**
   - Split cost/usage by provider.
   - Keep Claude cost exact from Claude logs.
   - Treat Codex cost as exact only for API-key usage; otherwise show tokens/usage instead of dollars.

5. **Optional switch-in-place**
   - Add after Codex resume is reliable.
   - Until then, side-by-side remains the safer default because it preserves the source Claude session.

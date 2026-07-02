# z.ai provider — design

**Date:** 2026-07-03
**Status:** implemented same-day (user request: "ทำให้สามารถใช้ z.ai ได้ให้หน่อย"; user AFK during design,
recommended options locked in per the request)

## Goal

Flip the z.ai provider from the "SOON" stub to a working provider: pickable in the
ProviderPicker (new tab / split), selectable in the pane-header provider menu, and
switchable on a live pane.

## Core model

**A z.ai pane is Claude Code on the GLM (z.ai) backend.** It launches through the user's
existing `claude --glm` zsh wrapper, which sources `~/.claude/glm.env` and points the
claude binary at `https://api.z.ai/api/anthropic` with the GLM API key. The wrapper also
adds `--dangerously-skip-permissions` itself.

This model was anticipated by the waiting-state spec ("A future z.ai pane launched via the
claude binary inherits waiting for free") and buys, with no new machinery:

- **Sessions**: `--session-id` / `--resume` work identically; transcripts land in the same
  `~/.claude/projects` jsonl, so `sessionExists` and layout persistence need no changes.
- **Logtail**: auto-title, waiting detection, completion notifications, and beacon state all
  read the session jsonl — enabled for z.ai by widening the `provider === "claude"` gate to
  "not codex".
- **Ponytail**: the PT env (`PONYTAIL_DEFAULT_MODE`) is read by the plugin inside claude,
  backend-agnostic — the PT chip shows for z.ai panes.
- **Live switching claude ↔ z.ai**: same mechanism as the HR toggle — kill the PTY, relaunch
  with `--resume <same session>`. The conversation continues on the other backend.

**Headroom stays claude-only.** The GLM wrapper pins `ANTHROPIC_BASE_URL` to z.ai, so HR
routing can never engage for a z.ai pane; the HR chip stays hidden (`provider === "claude"`).

The z.ai usage gauge (`usage_report_zai` + Keychain monitor token) already shipped in
v0.10.x and is untouched.

## Alternatives considered

- **Cockpit reads glm.env itself** and injects `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_BASE_URL`
  as spawn env: no zshrc dependency, but duplicates the wrapper's logic in a second place and
  bypasses future wrapper fixes (e.g. model pinning). Rejected — the PTY already runs the
  user's interactive login zsh, so the wrapper is guaranteed present.
- **z.ai as a fully separate agent** (like codex): would re-implement sessions, logtail,
  waiting. Rejected — it IS claude.

## Changes

| File | Change |
| --- | --- |
| `src/lib/providers.ts` | zai `enabled: true`, real description |
| `src/lib/terminalRegistry.ts` | `launchClaude` gains `glm` opt (`claude --glm`, HR never engages); `launchAgent` zai branch; logtail gate `!== "codex"`; `setPanePonytail` provider-aware; new `setPaneProvider` (kill + `--resume` relaunch) |
| `src/layout/paneLayout.ts` | new `setProvider` action (mirrors `setPonytail`) |
| `src/components/PaneHost.tsx` | drop the zai guard; codex-handoff branch also from zai; claude↔zai dispatches `setProvider` + relaunch |
| `src/components/PaneHeader.tsx` | PT chip shows for `provider !== "codex"` (HR chip unchanged, claude-only) |

Provider-switch semantics on a live pane:

- claude ↔ zai → relaunch same pane, `--resume` same session id.
- claude → codex AND zai → codex → codex handoff (transcript is a claude session either way).
- codex → claude (with handoff source) → jump back, unchanged. codex → zai → no-op (same as
  codex → claude without a source).

## Error handling

- glm.env missing / bad key: the wrapper itself prints the error into the pane — visible,
  actionable, no cockpit code.
- Fresh pane switched to z.ai before any conversation: `sessionExists` fails → relaunch uses
  `--session-id` (fresh start), same as the HR toggle path.

## Testing

- `ProviderPicker.test.tsx`: flip the four disabled-zai assertions (card enabled, click picks
  zai, ArrowRight reaches it, digit 3 picks it).
- `paneLayout.test.ts`: `setProvider` action.
- Full suite + `tsc` build must pass.

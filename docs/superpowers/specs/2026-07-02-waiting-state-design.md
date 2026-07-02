# Waiting state — "session is asking you" detection + alerts

Status: design approved 2026-07-02 (interview-grilled). Next: implementation plan (writing-plans).

## Context

Cockpit's core promise is "know when a session needs you", but today only half of it is real:
Completions cover *finished* (bell/toast/macOS/Beacon, ADR 0007/0008), and nothing covers
*blocked on you*. Panes launch with `--dangerously-skip-permissions`, yet Claude Code still
hard-blocks mid-turn on `AskUserQuestion` — the pane renders plain "working", then decays to
"idle" as the log goes quiet, and no Completion ever fires. A session that asked a question
20 minutes ago in a background tab is the single most expensive attention failure the app has.

`waiting` has been in the CONTEXT.md glossary since M2 and is explicitly documented as inert
("panes run with permissions skipped, so it never occurs") — that rationale turns out to be
wrong for `AskUserQuestion`, which blocks regardless of the permission mode.

Chosen over the other evaluated candidates (limit/budget threshold alerts, activity ticker,
prompt queue, quick switcher, Codex event adapter) as the next feature: it closes the largest
gap in the core promise, is impossible for a plain terminal (pure JSONL awareness), and rides
the existing completion plumbing end-to-end with zero Rust changes.

## Evidence (verified against real transcripts on this machine, 2026-07-02)

- The ask is an `assistant` record whose `message.content` has a block
  `{type:"tool_use", name:"AskUserQuestion", id:"toolu_…"}` (`stop_reason:"tool_use"`).
- The answer is a later `user` record carrying `{type:"tool_result", tool_use_id:<same id>}`.
  Observed gap in a real session: **110 s** — exactly the wall-clock the user sat unaware.
- **Parallel-block splitting**: one assistant API message can be written as *multiple* JSONL
  records sharing the same `message.id` (observed: `AskUserQuestion` in one record,
  `mcp__designer__designer_session` in the next, same `msg_…` id). A subsequent assistant
  record therefore only proves the model moved on when its `message.id` differs.
- `attachment` records arrive between ask and answer (~150 ms after the ask) and mean nothing.
- `ExitPlanMode` as a `tool_use` appears in **zero** local transcripts — its shape is
  unverified. Deferred (see Out of scope).

## Scope (decisions from the grill)

1. **Trigger set v1: `AskUserQuestion` only**, keyed on an extensible `WAITING_TOOLS` name-set
   so a confirmed `ExitPlanMode` shape later is a one-line + one-fixture change.
2. **Waiting is a live state, not a ledger event.** It joins `PaneState` as the third value and
   self-clears when answered. It does NOT enter the Seen/Unseen notification ledger — a stale
   "unseen waiting" after the question was already answered would be noise. On *entry* it fires
   a one-shot notification burst through the existing channels.
3. **No nag / re-notify.** Persistence of attention is ambient: the chip shows elapsed time
   ("waiting 4m") and the Beacon keeps pulsing while any pane waits.
4. **No new settings.** The burst respects the existing `NotificationSettings`
   (`enabled/os/sound/toast/beacon`) exactly like Completions, including the active-tab
   suppression rule.

## State machine

Per pane, derived purely from its tailed JSONL lines (the `pane://log/{paneId}` stream):

- **Enter waiting**: assistant record containing `{type:"tool_use", name ∈ WAITING_TOOLS}` →
  capture `{toolUseId, messageId, askedAt}`. Reuse the ADR-0007 8-second freshness gate so
  backfill on `--resume` never fires (a resumed session with an old unanswered ask may enter
  the *state* silently, but must not notify).
- **Stay waiting** (no-ops): `attachment` records; assistant records with the *same*
  `message.id` (parallel blocks); tool_results for *other* tool_use ids.
- **Clear waiting**, whichever comes first:
  a. `user` record with `tool_result.tool_use_id == toolUseId` (answered);
  b. assistant record with a **new** `message.id` (model resumed — e.g. the ask was
     interrupted/abandoned via Esc);
  c. any non-tool_result `user` record (a typed prompt — the user is at the pane and moved on);
  d. PTY exit or pane relaunch/resume (logtail restart resets the tracker).
- **Notify once per `toolUseId`** — entering the same ask twice (duplicate lines) must dedupe.

## Surfaces

- **PaneHeader chip**: third value `waiting` overrides the idle/working timestamp heuristic.
  Alert styling (amber, distinct from working) + elapsed minutes, updated on the existing
  350–500 ms poll: `waiting 4m`.
- **Tab badge**: waiting tint on the tab, distinct from the unseen-completion badge; clears
  with the state (not by viewing).
- **One-shot burst on entry** (gated by existing settings + active-tab suppression):
  in-app toast, macOS notification, chime. Copy includes the question itself, truncated
  (~100 chars) from the `tool_use.input` — "Nurse-scheduling is asking: Which auth method…?"
  Clicking toast/notification jumps to the pane (same path as completion jump).
- **Beacon**: session rows gain the waiting state; the window pulses while *any* session is
  waiting, independent of the unseen-completion count.
- **Mission Control bays**: show `waiting + elapsed` in the session grid.

## Architecture / modules (zero Rust changes)

- `src/lib/waiting.ts` (new): pure `parseWaitingEvent(line)` + a tiny per-pane tracker reducer
  (`enter/stay/clear` per the state machine) — sibling of `completion.ts`'s `parseTurnEnd`,
  same tested-pure-parser convention, fixtures cut from the real transcripts cited above.
- `src/lib/paneState.ts`: `PaneState` gains `"waiting"`. `deriveState` (timestamp heuristic)
  stays untouched; composition happens at the consumer: `waiting` from the tracker overrides
  the derived idle/working.
- `src/hooks/useCompletionNotifier.ts`: the per-pane `pane://log` listener already
  `JSON.parse`s every line — feed the same parsed record to the waiting tracker (second parser,
  ~zero added cost). On enter: fan out through `toastBus`, `osNotify`, Beacon state; expose
  waiting per pane via the registry so PaneHeader/TabBar/Dashboard read it on their existing
  polls. (A fuller `logEvents` store refactor — step 2 of the codex-support-matrix adapter
  roadmap — is deliberately NOT required for v1.)
- `src/lib/beaconState.ts`: `BeaconSession` gains waiting; `buildBeaconState` carries a
  `waitingCount` for the pulse.

## Testing

- Parser/tracker fixtures (from real logs): ask→answer pair clears on matching `tool_use_id`;
  parallel-block same-`message.id` record does NOT clear; assistant with new `message.id`
  clears; typed user prompt clears; resume backfill enters silently (freshness gate) without
  notifying; duplicate ask lines notify once.
- Strictness: `stop_reason:"tool_use"` fires on *every* tool call — assert non-`WAITING_TOOLS`
  tool_use never enters waiting (no Bash flicker).
- Component: chip renders `waiting Nm` and overrides working; burst respects each
  `NotificationSettings` switch and the active-tab suppression rule.

## Risks (verify, don't assume)

- **Clear-rule completeness**: an interrupted ask must not strand the state — rules (b)/(c)/(d)
  are the fallbacks; if a real transcript shows an interrupt shape they miss, add it as a
  fixture first.
- **Question text extraction**: `AskUserQuestion` input carries a `questions[]` array; copy
  should use the first question's text and must tolerate schema drift (fallback to a generic
  "is asking you a question").
- **Elapsed-time drift**: `askedAt` comes from the JSONL timestamp; on resume-backfill it can
  be hours old — showing honest elapsed ("waiting 3h") is correct, just don't notify.
- **Claude-only asymmetry**: Codex panes keep the PTY heuristic (consistent with
  docs/codex-support-matrix.md). A future z.ai pane launched via the claude binary inherits
  waiting for free.

## Out of scope (this iteration)

- `ExitPlanMode` / plan-approval detection — blocked on capturing a real transcript; then it's
  one name-set entry + one fixture.
- Permission-prompt detection (panes run with permissions skipped).
- Nag / re-notify escalation; per-kind notification settings.
- Codex waiting detection (needs the Codex event adapter first).
- Answering from the toast/Beacon (jump-to-pane only).
- Docs updates that ride the implementation commit, not this spec: CONTEXT.md `Working state`
  entry (waiting is no longer inert — new definition: blocked on AskUserQuestion), CONTEXT.md
  `Completion`/`Seen` cross-references, docs/feature-matrix.md row.

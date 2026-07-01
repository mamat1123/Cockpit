# Multi-provider usage gauges — Codex and z.ai alongside Claude

Status: design approved 2026-07-01. Next: implementation plan (writing-plans).

## Context

Cockpit's usage gauges (tab-bar strip + Mission Control panel) currently show ONE provider:
Claude's 5-hour and weekly rate-limit windows, read live from `usage_report`
(`src-tauri/src/usage.rs`), which curls Anthropic's OAuth usage endpoint (falling back to
statusline.sh's `/tmp` cache). The UI is `UsageStrip` (tab bar, hover popover) and `UsagePanel`
(Mission Control), both built from a shared `Gauge` component, fed by one poller
(`src/lib/usageStore.ts`).

The user wants Codex and z.ai (GLM Coding Plan) usage visible the same way. Both are viable —
confirmed with real data on this machine during brainstorming:

- **Codex**: fully local, no auth/network. `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` carries
  an `event_msg` with `payload.type == "token_count"` and a `rate_limits` object:
  `{primary: {used_percent, window_minutes: 300, resets_at (unix seconds)}, secondary: {used_percent,
  window_minutes: 10080, resets_at}, plan_type}`. `primary` = 5-hour, `secondary` = weekly.
- **z.ai**: official monitor API. `GET https://api.z.ai/api/monitor/usage/quota/limit`, header
  `Authorization: <token>` (**no** `Bearer` prefix) + `Accept-Language: en-US,en`. Response
  `{data: {limits: [{type:"TOKENS_LIMIT", unit, number, percentage, nextResetTime (unix ms)}]}}`;
  `unit:3,number:5` is the 5-hour window, `unit:6,number:1` is weekly.

UI direction was settled through live mockup iteration (browser-based, both the visual
companion and ad-hoc HTML mockups) before this spec was written:

1. Tab-bar strip: every provider always visible inline (badge C/X/Z + two stacked mini bars for
   5h/weekly, each bar trailed by its reset countdown, e.g. `24% 4h12m`) — no click/hover needed
   to see the numbers.
2. Detail view is **per-provider, not combined** — hovering/focusing the Claude badge group opens
   only Claude's popover; Codex and z.ai are separate, independent hover targets with their own
   popovers anchored under themselves. (Explicitly chosen over a single popover listing all three,
   which felt cramped.)
3. Each provider's popover reuses the existing full-size `Gauge` look (big % number, track, foot
   line). The foot line already shows both the relative countdown and the absolute local clock
   time (`resets in 4h 12m (21:00)`, shipped just before this spec) — carries over unchanged.
4. Mission Control panel: same visual unit as the popover (badge header + stacked full `Gauge`s),
   just always visible instead of hover-triggered, one block per provider stacked vertically.
   Claude's block gets an extra `DayGauge` row underneath (today's budget) that Codex/z.ai blocks
   don't have — confirmed by the user pointing at a popover mockup and asking for the budget row
   to be added there.

## Scope

**In scope:** 5-hour/weekly usage % + reset time for Codex and z.ai, shown in the tab-bar strip
and Mission Control panel, using the mechanisms above.

**Out of scope — explicit boundary:** `src/lib/providers.ts` has a `zai` entry with
`enabled: false` ("Provider slot reserved for future support"). That flag gates the **pane
provider dropdown** — whether z.ai can be launched as a terminal session
(`onSelectProvider` in `PaneHost.tsx`, `terminalRegistry.ts`'s launch functions). This spec does
**not** touch that flag or that flow. This is usage/quota visibility only, not making z.ai a
launchable pane provider. Do not conflate the two "provider" concepts even though they share a
name and an id (`zai`).

**Also in scope:** correcting `docs/codex-support-matrix.md`'s "Token used display... Codex...
Implemented" row, which claims Codex token reading exists — it doesn't (no code reads
`token_count` today). This spec's Codex collector is what actually implements it; update the row
to point at this work instead of claiming it's already done.

**Explicitly deferred (not in this spec):**
- Day-budget pacing for Codex/z.ai — stays Claude-only. Codex (ChatGPT plan) has no dollar figure
  to pace against; z.ai has no per-turn cost log like Claude's JSONL. `src/lib/budget.ts` is not
  touched.
- Any change to how Codex/z.ai panes are launched, handed off, or resumed.

## Backend (Rust) — three independent commands

Keep `usage_report` (Claude) exactly as-is. Add two new commands returning the **same
`UsageReport`/`UsageWindow` shape** already defined in `usage.rs` — no new wire type needed,
which is what keeps the frontend's `Gauge`/`Popover` components reusable as-is.

### `usage_report_codex` (new `src-tauri/src/usage_codex.rs`)

- List `~/.codex/sessions/**/rollout-*.jsonl`, sort by mtime descending, open files newest-first
  looking for the last `token_count` event in each, stop at the first hit. Cap the scan (e.g. 10
  files) so a cold/empty `~/.codex` doesn't stall. A freshly-opened Codex session has no
  `token_count` yet, so scanning only the single newest file is not sufficient — this is the
  reason for the multi-file scan.
- Map `rate_limits.primary` → `five_hour`, `.secondary` → `seven_day`; `resets_at` (unix seconds)
  → ISO 8601 string (`UsageWindow.resets_at` is already `Option<String>`, matches).
- No network, no token. `status`: `"ok"` when a snapshot was found, `"no_token"` when no
  `token_count` event turned up in the scanned files (repurposed to mean "no data yet", not "not
  signed in" — see status-mapping table below), `"error"` only on unexpected I/O/parse failure.

### `usage_report_zai` (new `src-tauri/src/usage_zai.rs`)

- Read the monitor token from **macOS Keychain**, service name distinct from Claude's (e.g.
  `"Cockpit z.ai Monitor Token"`). No entry → `status: "no_token"`.
- `curl` the quota endpoint with the header shape above (`--max-time 8`, mirroring the existing
  Claude curl call in `usage.rs`).
- Parse `data.limits[]`, matching entries by `(unit, number)` as described in Context. `percentage`
  → `utilization`, `nextResetTime` (already unix **ms**) → ISO string.
- `status: "error"` on network/parse failure, mirroring Claude's pattern exactly.

### Keychain commands (new, 2 total)

- `save_zai_token(token: String) -> Result<(), String>` — writes/overwrites the Keychain entry.
  An empty/whitespace-only `token` **deletes** the entry instead of storing an empty secret, so
  clearing the Settings field + Save is how the user returns to "not configured" (no separate
  delete command/button needed).
- `zai_token_configured() -> bool` — existence check only. **Never returns the token value to the
  frontend** — write-only from the Settings UI, standard secret-field handling.

## Frontend data flow — shared poller, per-provider failure isolation

Keep the existing single poll loop and its triggers (baseline 60s, working→idle-edge refresh,
window-focus refresh) — these are UI-level concerns, not per-provider ones, so one shared timer
still fires all three fetches per tick via `Promise.allSettled`, updating a keyed state:

```ts
interface MultiUsageState {
  claude: UsageState;
  codex: UsageState;
  zai: UsageState;
}
```

`useUsage()` becomes `useMultiUsage()`, returning the full keyed state; consumers pick the slice
they need. `allSettled` means one provider's rejection (e.g. z.ai's curl timing out) only leaves
*that* entry stale/`no_token` — the other two update normally. This was chosen over three fully
independent pollers because the refresh triggers are shared UI state, not provider-specific
preference; three independent timers would be pure duplication for no isolation benefit (isolation
comes from `allSettled`, not from separate timers).

## Components — one visual unit, two placements

Extract **`ProviderGaugeGroup`**: badge + provider label + `Gauge`(5h) + `Gauge`(weekly) +
optional `DayGauge` (Claude only). Used in exactly two places:

- **Tab-bar strip**: each provider's badge + mini-bars (`MiniProviderRow`, new — badge + 2 stacked
  mini bars, each with a trailing reset-time chip) is its own independent hover/focus target,
  opening its own `ProviderGaugeGroup` popover anchored under itself. Not one shared popover for
  all three.
- **Mission Control (`UsagePanel`)**: three `ProviderGaugeGroup` blocks stacked vertically,
  always rendered (no hover). Claude's block includes the `DayGauge` row; Codex/z.ai's don't.

**Existing-code change required:** `Gauge`'s "not signed in" state currently hardcodes the string
`"sign in to Claude"`. This becomes a prop (e.g. `naLabel`) so Codex/z.ai popovers can show their
own no-data copy (see status-mapping table). Default stays `"sign in to Claude"` for the existing
Claude call site.

## Settings UI (new)

A block in `SettingsMenu.tsx`: "z.ai monitor token" — password-style input + Save button
(→ `save_zai_token`), plus a "configured ✓ / not configured" status line (→
`zai_token_configured`, read on mount). The existing token value is never redisplayed.

## Status mapping per provider

All three commands keep the existing 3-value `status` contract (`ok` / `no_token` / `error`), but
the *meaning* and the UI copy for `no_token` differ per provider:

| Provider | `no_token` means | `error` means |
|---|---|---|
| Claude | not signed in to Claude Code | network/parse failure (cache fallback exists) |
| Codex | no `token_count` event found yet in recent sessions (Codex barely used) | unexpected file I/O/parse failure |
| z.ai | no token saved in Settings | network failure or bad token |

A provider with no data just shows its own na-state (skeleton/dash, per-badge) — it never blocks
or blanks the other two providers' badges/bars in the strip or panel.

## Testing

- **Rust**: unit tests for the Codex rollout parser (newest-snapshot-across-files selection, the
  "no `token_count` yet" case) and the z.ai response parser (`unit`/`number` → 5h vs weekly
  matching), written as pure functions over sample JSON/fixture strings — same style as the
  existing tests in `usage.rs`/`cost.rs`. No real network or Keychain access in unit tests (the
  Keychain shell-out itself stays untested at that boundary, matching the existing precedent for
  Claude's `oauth_token()`).
- **Frontend**: `useMultiUsage` test — mock the three `invoke` calls, reject one, assert the other
  two still update (failure isolation). `ProviderGaugeGroup`/`MiniProviderRow` render tests in the
  style of the just-added `UsageGauges.popover.test.tsx` (real render + focus, not shallow) —
  confirm one badge's popover doesn't affect another's, and confirm the `DayGauge` row appears
  only for Claude.

## Touch points

New: `src-tauri/src/usage_codex.rs`, `src-tauri/src/usage_zai.rs`, `src/components/*` for
`ProviderGaugeGroup` and `MiniProviderRow` (exact file split TBD in the implementation plan).

Edit: `src-tauri/src/lib.rs` (register 4 new commands: `usage_report_codex`, `usage_report_zai`,
`save_zai_token`, `zai_token_configured`), `src/lib/usageClient.ts` (two new invoke wrappers),
`src/lib/usageStore.ts` (→ `useMultiUsage`), `src/components/UsageGauges.tsx` (restructure
`UsageStrip`/`UsagePanel` around the new components; `Gauge` gains `naLabel` prop),
`src/components/SettingsMenu.tsx` (+`.css`, z.ai token block), `docs/codex-support-matrix.md`
(correct the token-display row), `CONTEXT.md` (amend **Usage** — currently defined as
Claude-account-specific — to note it now spans providers).

## Out of scope (explicit, recap)

- Enabling z.ai as a launchable pane/terminal provider (`providers.ts`'s `enabled` flag, pane
  launch flow) — untouched.
- Day-budget/pacing for Codex or z.ai — Claude-only, unchanged.
- Codex/z.ai session resume, structured working/completion events, cost-in-dollars — unrelated
  gaps tracked in `docs/codex-support-matrix.md`, not addressed here.

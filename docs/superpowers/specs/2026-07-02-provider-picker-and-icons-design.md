# Provider picker on session/pane creation + real provider icons

Status: design approved 2026-07-02. Next: implementation plan (writing-plans).

## Context

Cockpit already models a per-pane `provider: AgentProvider` (`"claude" | "codex" | "zai"`,
`src/layout/paneLayout.ts`) end-to-end — it's persisted, restored, and threaded into the actual
PTY launch (`terminalRegistry.ts`'s `acquireTerminal`/`launchAgent`). What's missing is any way to
**choose** a provider at creation time: `newTab`/`split`/`splitDown` always create a pane with
`provider` unset (implicitly Claude, per `deserializeLayout`'s `provider ?? "claude"` and
`launchAgent`'s branching). The only existing provider UI is `PaneHeader`'s dropdown, which
**switches** an already-running pane's provider after the fact (Claude→Codex goes through a
"handoff" that spins up a new pane; that mechanism is untouched by this spec).

Providers are also shown today as plain letter badges — `C`/`X`/`Z` — driven by
`PROVIDERS[].mark` in `src/lib/providers.ts` and rendered in exactly two components:
`UsageGauges.tsx` (4 call sites: the tab-strip mini rows and the Mission Control gauge groups) and
`PaneHeader.tsx` (the active-provider badge and its dropdown list). Colors come purely from
per-theme CSS custom properties (`--ck-accent`/`--ck-blue`/`--ck-magenta`), not from the badge
itself, so swapping the glyph for an icon needs no color-system changes.

Design was worked out through iterative mockups (see conversation) rather than the visual
companion tool. Final shape: a centered modal dialog (chrome/behavior borrowed from
`ProjectPicker.tsx`'s overlay pattern) containing the three providers as a horizontal row of
icon-first cards (borrowed from a Spotlight-style "row of choices" layout explored alongside it).

### Icon sourcing

Real single-color marks were sourced for all three, all normalized to a 24×24 viewBox with path
data suitable for `fill="currentColor"` (so they recolor exactly like the letters do today, per
theme, with no new color logic):

- **Claude** — Anthropic's mark, from simple-icons (`claude.svg`, CC0).
- **Codex** — OpenAI ships a *dedicated* Codex product mark distinct from their general logo
  (sourced via lobehub/lobe-icons' `codex.svg`, MIT) — this is what gets used, not the generic
  OpenAI "hexagon knot".
- **Z.ai** — Z.ai's mark (lobehub/lobe-icons' `zai.svg`, MIT).

Exact path data was pulled during this session and is ready to drop into new icon components
verbatim (not re-derived from scratch during implementation).

## Scope

**In scope:**

1. Replace the letter-mark badges with the real icons above, everywhere `meta.mark` is rendered
   today (6 call sites across `UsageGauges.tsx` and `PaneHeader.tsx`).
2. A new `ProviderPicker` modal, shown before a pane is actually created, for both creation paths:
   - **New session** — `ProjectPicker`'s `onPick(cwd)` (⌘T / ⌘O / the tab-strip `+` button all
     route through this one picker instance in `CockpitView.tsx`) currently dispatches `newTab`
     immediately. It now opens `ProviderPicker` instead; `newTab` dispatches once a provider is
     confirmed.
   - **New pane (split)** — `useKeybindings.ts`'s ⌘D/⌘⇧D handler currently dispatches
     `split`/`splitDown` directly (the only two dispatch sites for those actions in the app). It
     now opens `ProviderPicker` instead.
3. `newTab`/`split`/`splitDown` actions and `makePane`/`makeRow` gain a `provider` parameter so
   the pane is *born* with the right provider, rather than created as Claude and switched via the
   handoff mechanism.
4. Both creation paths always show the picker — no "skip if same as last time" for this
   iteration (see Open question, below).

**Out of scope (explicit boundary — same one drawn in
`2026-07-01-multi-provider-usage-gauges-design.md` for the same reason):**

- Wiring an actual Z.ai launch. `terminalRegistry.ts:140` today spawns
  `printf 'z.ai provider is not wired yet\n'` and `PROVIDERS` flags `zai.enabled = false`. This
  spec does not touch either. Z.ai appears in the new picker as a visibly disabled card — see
  below — exactly mirroring how it's already disabled in `PaneHeader`'s dropdown.
- The post-creation provider switch / Claude↔Codex handoff in `PaneHeader.tsx` — unchanged; still
  how you change an existing pane's provider.
- `initLayout()` — dead in the live app flow today (the empty-state first pane also goes through
  `ProjectPicker` → `newTab`, same as any other new tab), so no separate handling needed.
- Saved-layout restore (`openSession`, `loadLayout`, workspace restore) and `openCodexHandoff` —
  these already carry an explicit or persisted provider and are not "fresh" creation; the picker
  does not intercept them.
- Any "remember my last provider" persistence, `defaultProvider` setting, or auto-skip behavior.
- The command-palette / anchored-menu / inline-empty-state / instant-launch alternatives explored
  during design — not being built now.

**Open question, deliberately deferred:** ⌘D (split) likely fires more often per-session than ⌘T
(new tab/session). If always-asking on every split turns out to be too much friction in practice,
a follow-up could default split's picker to the last-used provider (or skip it entirely, à la the
explored "instant + quick-switch" design) while keeping full sessions always-ask. Shipping
always-ask for both first, revisiting only if it's actually annoying in use.

## `ProviderPicker` — behavior

Modeled directly on `ProjectPicker.tsx`'s structure: full-screen backdrop `<div>` closing on
backdrop click, `role="dialog"` panel, autofocus, Escape closes. New behavior specific to this
picker:

- **Layout**: title ("Start with which provider?") + one-line context hint (which folder for a
  new tab; "split →" / "split ↓" for a pane split) + the three providers as a horizontal row of
  compact cards (icon on top, label below), not a stacked list — chosen explicitly over the list
  layout for how it reads at a glance with only 3 items.
- **Selection is immediate on click** — clicking an enabled card confirms that provider right
  away (dispatches and closes), matching how `PaneHeader`'s existing provider dropdown already
  behaves (click = act, no separate confirm step). Claude starts focused/highlighted for pure-
  keyboard use.
- **Keyboard**: `←`/`→` move focus between the two enabled cards without confirming, `Enter`
  confirms the focused card. `1`/`2` are a fast path that both focus *and* immediately confirm
  Claude/Codex in one keystroke (matching the visible key hint on each card — same "act now"
  semantics as a click, not just a focus move). `Esc` or backdrop-click cancels.
- **Z.ai's card** renders disabled/dimmed with a "Soon" badge and is skipped by arrow-key
  navigation and the `1`/`2` shortcuts — same `enabled: false` / "coming soon" convention
  `PaneHeader.tsx` already applies (`p.enabled ? p.description : "coming soon"`), just reused
  here instead of re-invented.
- **Cancelling aborts creation entirely** — no pane is created, no action is dispatched. For the
  new-session path this means the folder choice from `ProjectPicker` is discarded too (no partial
  state where a folder is "half chosen").

## Data flow / touch points

- `src/lib/providers.ts` — no data changes; the picker reads the existing `id`/`label`/`enabled`/
  `description` fields directly (same shape `PaneHeader`'s dropdown already consumes).
- New `src/components/icons/ProviderIcons.tsx` — one small SVG component per provider
  (`ClaudeIcon`/`CodexIcon`/`ZaiIcon`, `fill="currentColor"`, sourced path data as above) plus a
  `ProviderIcon({ id })` dispatcher. Replaces the 6 `{meta.mark}` render call sites in
  `UsageGauges.tsx` and `PaneHeader.tsx`. `ProviderMeta.mark` stays in the data (harmless,
  possible future aria-label use) but stops being rendered as the visible glyph.
- New `src/components/ProviderPicker.tsx` (+ `.css`) — the modal itself, `{ context, onPick,
  onCancel }` props (`context` distinguishes new-tab-with-cwd vs. split vs. split-down for the
  hint line).
- `src/layout/paneLayout.ts` — `newTab`/`split`/`splitDown` actions gain an optional
  `provider?: AgentProvider` field; `makePane`/`makeRow` take a `provider` param and set it on the
  created `Pane`(s) instead of leaving it undefined. Existing no-provider call sites (tests, the
  ⌘T fallback path when no handler is wired) keep working unchanged since the field is optional.
- `src/layout/useKeybindings.ts` — ⌘D/⌘⇧D stop dispatching `split`/`splitDown` directly; gain an
  `onSplit?: (down: boolean) => void` opt (mirroring the existing `onNewTab` opt/fallback
  pattern), so `CockpitView` can intercept with the picker instead.
- `src/components/CockpitView.tsx` — new local state (sibling to the existing `pickerOpen`/
  `wsOpen`/etc. booleans) tracking a pending creation (`{ kind: "newTab"; cwd } | { kind: "split"
  } | { kind: "splitDown" } | null`). `ProjectPicker.onPick` and the new `onSplit` handler set
  this instead of dispatching directly; `ProviderPicker` (rendered when it's non-null) performs
  the actual dispatch on pick, or clears it on cancel.
- Minor CSS additions in `UsageGauges.css` / `PaneHeader.css` to size the inline `<svg>` inside
  the existing badge containers (they're currently sized for a single text glyph).

## Testing

- `ProviderPicker` render tests: three cards render with correct icons, Z.ai is disabled and
  unreachable via arrow/number keys, `Enter`/click confirms the focused/clicked provider and
  calls `onPick` exactly once, `Esc`/backdrop-click calls `onCancel` without calling `onPick`.
- `paneLayout.ts` reducer tests (additive — existing no-provider tests keep passing since the
  field is optional): `newTab`/`split`/`splitDown` with a `provider` produce a `Pane` carrying
  that provider.
- A small icon-mapping test (`ProviderIcon` renders the right `<svg>` per `id`) as a regression
  guard against a future edit silently reverting to letters.

## Out of scope (recap)

- Making Z.ai an actually-launchable provider.
- Any change to the Claude↔Codex handoff / post-creation switch flow.
- Persisted default-provider / skip-picker behavior.

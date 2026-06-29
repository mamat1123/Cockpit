# Ponytail level — a per-Pane "lazy senior dev" intensity, toggled like HR

Status: design approved 2026-06-30. Next: implementation plan (writing-plans).

## Context

[ponytail](https://github.com/DietrichGebert/ponytail) is a **Claude Code plugin** (skills +
Node lifecycle hooks) that injects a "lazy senior dev" ruleset to make the agent write minimal
code (YAGNI, stdlib-first, no unrequested abstractions). It is **not** a proxy — it has no
daemon, no port. Its intensity is `off | lite | full | ultra`.

We want it in Cockpit as a **per-Pane toggle, like Headroom routing (HR)** — each Pane picks its
own level, switchable from the Pane header.

### Why the HR machinery fits (the key finding)

ponytail's `ponytail-config.js` resolves the active mode at **SessionStart** in this order:
`PONYTAIL_DEFAULT_MODE` (env) → `~/.config/ponytail/config.json` → `'full'`. So
`PONYTAIL_DEFAULT_MODE` is an **environment variable read once at session start** — the exact
shape of HR's `ANTHROPIC_BASE_URL`. The `SessionStart` hook (`ponytail-activate.js`, matcher
`startup|resume|clear|compact`) injects `getPonytailInstructions(mode)` for that level (`off`
skips injection entirely). Each Pane is a separate `claude` process with its own env, so the
level is naturally per-Pane.

The global flag file `~/.claude/.ponytail-active` only feeds the statusline badge — it does **not**
drive ruleset injection, so its cross-Pane clobber is cosmetic and irrelevant here.

## Decisions (resolved during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Levels | 4-level `off/lite/full/ultra` | env carries a string anyway; levels are ponytail's whole point, near-free |
| Toggle mechanism | **env + relaunch** (`PONYTAIL_DEFAULT_MODE`, kill+relaunch `--resume`) | authoritative (clean off, full ruleset per level), persists across resume, reuses HR code, no transcript/turn cost. (slash-inject rejected: non-persistent — `getDefaultMode` ignores the flag file — soft semantics, costs a turn.) |
| Plugin install | **detect + nudge** | the plugin is a global one-time install; never silently no-op (the HR lesson) |
| UI form | **Intensity-meter chip + dropdown** (direct-select) | direct-select = 1 pick = 1 relaunch (cycling would relaunch once per step); meter shows intensity at a glance; compact, survives narrow panes |
| Label / term | chip **`PT`**, term **Ponytail level** | parallels HR / Headroom |

## Domain language (add to CONTEXT.md)

**Ponytail level** — a per-[[Pane]] setting (`off`/`lite`/`full`/`ultra`) controlling how
aggressively the Session's Claude minimizes code, via the **ponytail** Claude Code plugin's
injected ruleset. A distinct axis from **Headroom routing** (where requests go) and **Savings**
(tokens the proxy removed). Fixed at Session start (the plugin reads `PONYTAIL_DEFAULT_MODE`
once), switched by relaunch. Shown as the **PT** chip in the Pane header. Default `off`.
_Avoid_: lazy mode, ponytail mode (say Ponytail level); never conflate with Headroom routing.

## Mechanism

- Per-Pane env `PONYTAIL_DEFAULT_MODE=<level>` injected at `claude` launch. ponytail's SessionStart
  hook reads it and injects that level's ruleset; `off` injects nothing (clean).
- Switching level kills the Pane's `claude` and relaunches `claude --resume <sessionId>` with the
  new env. Conversation survives via the jsonl. **1 pick = 1 relaunch** (~1–2s blip), same cost
  model as HR. No proxy, no port, no `ensure` step.

## State & persistence (parallel to `headroom`)

- `Pane.ponytail?: PonytailLevel` where `type PonytailLevel = 'off' | 'lite' | 'full' | 'ultra'`.
  Default `off`.
- `SavedPane.ponytail?: PonytailLevel`; `serializeLayout` writes it only when `!== 'off'`;
  `deserializeLayout` restores it (default `off`).
- Reducer action `{ type: 'setPonytail'; paneId; level }`, parallel to `setHeadroom`.

## Shared launch-env (the one real refactor)

HR and ponytail can both be on, so a Pane's launch env is the **merge** of both. Generalize env
construction into a pure, unit-testable helper:

```ts
// src/lib/paneLaunchEnv.ts
export function paneLaunchEnv(opts: {
  headroomEngaged: boolean;       // HR proxy actually engaged (from resolveHeadroomRouting)
  ponytail: PonytailLevel;        // pane's level
  headroomBaseUrl: string;        // HEADROOM_BASE_URL
}): Record<string, string> {
  const env: Record<string, string> = {
    // Always pin the level, INCLUDING 'off'. Omitting it would let ponytail's getDefaultMode
    // fall back to the user's global config.json / 'full' — so the chip could read "off" while
    // ponytail actually ran at full. 'off' makes activate.js skip injection (truly off). This
    // makes Cockpit's per-Pane level authoritative over any global ponytail config.
    PONYTAIL_DEFAULT_MODE: opts.ponytail,
  };
  if (opts.headroomEngaged) env.ANTHROPIC_BASE_URL = opts.headroomBaseUrl;
  return env;
}
```

**Consequence (accepted):** because `off` is pinned, every Pane launches with
`PONYTAIL_DEFAULT_MODE` set, so Cockpit's per-Pane level always wins over a global ponytail
config (a shell `PONYTAIL_DEFAULT_MODE` or `~/.config/ponytail/config.json`). This is the price
of "the chip is the truth" and mirrors ADR 0010's "Cockpit is the sole owner of routing." Harmless
when the plugin isn't installed (the env is simply ignored).

`terminalRegistry.ts` changes:
- `launchClaude(...)` takes the Pane's `{ headroom: boolean, ponytail: PonytailLevel }`, resolves HR
  via the existing `resolveHeadroomRouting`, then builds env via `paneLaunchEnv(...)`, spawns with
  the merged env. It still returns the HR-engaged boolean for HR's existing revert logic.
- New `setPanePonytail(paneId, cwd, sessionId, level, headroomOn)`: kill + relaunch with the full
  Pane state `{ headroom: headroomOn, ponytail: level }`. No failure/revert path (no proxy; a
  missing plugin is gated by the UI, see Detect). Writes a brief `[switching ponytail → <level>…]`
  notice to the Pane, mirroring HR's switch notice.
- `setPaneHeadroom(...)` gains a `ponytailLevel` parameter so toggling HR preserves the Pane's level.
- `acquireTerminal(...)` gains the `ponytail` level and passes it to `launchClaude`.
- `PaneHost` passes both `pane.headroom` and `pane.ponytail` to both toggle handlers, so switching
  one toggle never drops the other.

## Detect + nudge (plugin install)

- Rust command `ponytail_installed() -> bool` (new `src-tauri/src/ponytail.rs`): reads
  `~/.claude/plugins/installed_plugins.json` (or `$CLAUDE_CONFIG_DIR/plugins/...`). The file shape
  (verified) is `{ "version": int, "plugins": { "<plugin>@<marketplace>": [...] } }`. Returns true
  iff any key in `plugins` starts with `"ponytail@"`. Pure inner `fn has_ponytail(json: &str) -> bool`
  for a `#[cfg(test)]` unit test. Registered in `lib.rs` like `headroom_status`.
- TS client `src/lib/ponytailClient.ts`: `ponytailInstalled(): Promise<boolean>` (invoke wrapper),
  plus the `PonytailLevel` type and the level metadata (label, description, meter fill) consumed by
  the UI.
- UI gating: PaneHeader checks installed state (once on mount). If not installed, the PT chip is
  dimmed/disabled and clicking it opens a nudge popover with the install commands:
  `/plugin marketplace add DietrichGebert/ponytail` then `/plugin install ponytail@ponytail`.
  Never a silent no-op.

## UI — intensity-meter chip + dropdown (option 2)

In `PaneHeader.tsx`, next to the HR chip:
- A `PT` chip showing a 3-cell intensity meter for the current level:
  `off ▱▱▱` (dim) · `lite ▰▱▱` · `full ▰▰▱` · `ultra ▰▰▰`, color ramped
  (off muted → lite/full green → ultra amber).
- Click opens a dropdown menu of the 4 levels (each row: meter + name + one-line description).
  Selecting a level dispatches `setPonytail` and triggers the relaunch. Reuses the popover/position
  pattern of the existing HR savings popover; the menu must not be clipped (header overflow visible).
- Disabled + nudge popover when `ponytail_installed()` is false.

Level metadata:
| level | meter | description |
|---|---|---|
| off | ▱▱▱ | ponytail off — Claude behaves normally |
| lite | ▰▱▱ | light — avoids over-engineering |
| full | ▰▰▱ | standard — YAGNI, stdlib first, no extra abstractions |
| ultra | ▰▰▰ | strictest — the least code that still works |

## Testing (TDD seams)

- `paneLaunchEnv(...)` — pure. Unit tests: HR off + `off` → `{PONYTAIL_DEFAULT_MODE:'off'}` (off is
  pinned, never omitted); HR off + `full` → `{PONYTAIL_DEFAULT_MODE:'full'}`; HR on + `off` →
  `{ANTHROPIC_BASE_URL, PONYTAIL_DEFAULT_MODE:'off'}`; HR on + `ultra` → both keys with `ultra`.
- `setPonytail` reducer — `paneLayout.test.ts`: sets the level on the target Pane only; serialize
  writes it only when `!== 'off'`; deserialize round-trips. Parallel to the existing headroom flag tests.
- `has_ponytail(json)` — Rust `#[cfg(test)]`: a sample with a `ponytail@ponytail` key → true; without → false.
- PTY relaunch glue (`setPanePonytail`, `launchClaude` merge) + the PaneHeader UI = typecheck +
  manual verification (run the app), same as HR — these are side-effectful and not unit-tested.

## Touch points

New: `src/lib/paneLaunchEnv.ts` (+ `.test.ts`), `src/lib/ponytailClient.ts`,
`src-tauri/src/ponytail.rs`.
Edit: `src/layout/paneLayout.ts` (+ `.test.ts`), `src/lib/terminalRegistry.ts`,
`src/components/PaneHeader.tsx` (+ `.css`), `src/components/TerminalPane.tsx`,
`src/components/PaneHost.tsx`, `src-tauri/src/lib.rs`, `CONTEXT.md`.

## Out of scope (explicit)

- **No Savings/metric readout** — ponytail has no per-request token stream like HR's proxy log; the
  chip shows the level only.
- **Statusline flag clobber** — `~/.claude/.ponytail-active` is global, but only cosmetic; Cockpit
  shows its own per-Pane state and does not read it.
- **Live mid-session level change without relaunch** (slash-inject) — deferred; env+relaunch chosen.
- **Auto-installing the plugin** — deferred; detect + nudge only.

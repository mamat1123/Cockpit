# Completion Notifications — Design Spec

_Status: approved for planning · 2026-06-22_

## What we're building

When a Claude Session **finishes its turn** (a [[Completion]]), Cockpit tells you — across
five surfaces — so you know it's your move even when you're not looking at Cockpit:

1. **macOS notification** — native banner, reaches you in any app.
2. **Sound** — carried by the macOS notification (not a separate engine).
3. **In-app toast** — a banner inside Cockpit, bottom-right.
4. **Tab badge** — a count of unseen Completions on each background tab.
5. **Beacon** — a small always-on-top floating window that pulses + counts, and on click
   lists every Session with its status and jumps to one.

Every Completion fires all enabled surfaces — **in all cases**, including when you're
looking at the session that finished (per the user's explicit choice).

Two kinds of surface, to resolve an apparent conflict up front:
- **Transient** (macOS notification, sound, toast) fire on *every* Completion regardless of
  focus — this is the "in all cases" guarantee.
- **Persistent counts** (tab badge, bell bubble, Beacon count) reflect **Unseen**
  Completions. A Completion on the tab you're already viewing is Seen instantly, so it
  fires the transient surfaces but adds nothing to a count. That's intended, not a gap.

## Glossary

See `CONTEXT.md` — **Completion**, **Seen / Unseen**, **Beacon**, **Working state**.
Decisions are recorded in **ADR 0007** (completion = jsonl turn-end) and **ADR 0008**
(Beacon = second always-on-top window).

## The trigger: detecting a Completion

Per **ADR 0007**, a Completion is read from the session **jsonl transcript**, not the
PTY-output heuristic that drives the existing glow/dot.

- Each pane already streams its transcript lines to the frontend via
  `onLogLine(paneId, cb)` (`logClient.ts:11`, backed by `logtail.rs`). No Rust change.
- A Completion = an **assistant** transcript line whose message **ended the turn**
  (`stop_reason: "end_turn"`; treat `"stop_sequence"`/`"max_tokens"` the same; `"tool_use"`
  is NOT a completion — Claude is mid-loop).
- **Backfill guard (critical):** a resumed pane (`claude --resume`) makes `logtail` re-emit
  the *entire* prior transcript from offset 0. We must NOT fire for that history. Defense:
  use each line's own `timestamp` field — fire only when `now - timestamp <
  FRESHNESS_MS` (~8s). Old (backfilled) end_turn lines are silently ignored.
- **Debounce:** ~300ms per pane against partially-written lines (collapse a burst to one).

### Task 0 — schema spike (do this first)

Confirm against a live session log: the line shape `{type:"assistant",
message:{…,stop_reason}, timestamp}`, the exact `stop_reason` values, and the `timestamp`
format. The rest of the detector depends on this. (This is the risk ADR 0007 calls out.)

## Seen / Unseen model

- A Completion is **Unseen** until: (a) you view its Session — its Tab becomes the active
  tab (all panes in an active tab are visible), or (b) you act on it from the bell/Beacon
  (clicking its row jumps + marks it Seen), or (c) "Mark all read".
- **Opening the bell/Beacon does NOT auto-clear** — you should see what's new. Only the
  rules above clear Unseen state.
- The currently-active tab never accrues Unseen Completions (you're watching it).
- Counts: **tab badge** = Unseen for panes in that tab; **bell bubble** & **Beacon count**
  = total Unseen across all tabs.

## History persistence

**None.** Completion entries live in memory and are cleared on app restart. A "finished 3h
ago" entry from a previous run has no meaning once sessions are resumed fresh.

## Surfaces — behavior detail

### macOS notification + sound
- Sent from JS via `@tauri-apps/plugin-notification` (`sendNotification`).
- Title = Session name (pane `title`); body = Project (last path segment of `cwd`).
- `sound` attached per the **Sound** toggle (default system sound; a bundled custom sound
  is a later option). This is the only sound — no Web Audio engine.
- Permission: on first enable (or app start if enabled), `isPermissionGranted()` →
  `requestPermission()`; if denied, Settings shows a hint.
- Clicking the notification focuses Cockpit and, if the plugin surfaces a click/action
  event, jumps to that Session; fallback is "focus the app".
- macOS caveat: while Cockpit is frontmost, macOS may withhold the banner (delivers
  silently to Notification Center). The in-app **toast** guarantees an in-app signal in
  that case.

### In-app toast
- Bottom-right of the Cockpit window, stacked, newest on top, max ~3 visible; auto-dismiss
  ~5s; hover pauses dismissal.
- Check glyph (mint) + "‹name› finished" + "‹project› · ‹relative time›" + Jump affordance.
- Click → jump to that Session (focus tab + pane + terminal). Respects `prefers-reduced-
  motion`.

### Tab badge
- Mint pill on `TabBar` tabs showing Unseen count for that tab; absent on the active tab.
- Clears when the tab becomes active. Lives alongside the existing working equalizer /
  idle dot (it replaces neither).

### Bell (notification center)
- A new `TabBar` tool button between **Workspaces** and **Settings**; `⌘B` toggles it.
- Bubble badge = total Unseen.
- Panel: list of recent Completions (newest first), each = mint/dim mark + name + project +
  relative time. Unseen rows highlighted. Header has "Mark all read".
- Click a row → jump to that Session; "Open Cockpit" affordance is implicit (we're already
  in Cockpit here — the Beacon's list is the away-from-Cockpit twin).

### Beacon (surface 5) — ADR 0008
- **Window:** a second Tauri `WebviewWindow` labelled `beacon` — `transparent`,
  `decorations:false`, `alwaysOnTop:true`, `skipTaskbar:true`, `visibleOnAllWorkspaces`,
  small, **child of the main window** (closes/quits with it — lifecycle B). Default
  position top-right of the primary display; draggable; position persisted.
- **Default: ON** (toggle "Floating beacon" under Notifications).
- **Always visible while the app is open** — including when Cockpit is frontmost (user's
  choice). Default-placed in a corner so it doesn't obscure Cockpit's chrome.
- **States:** idle = faint dim dot; **working** = amber + count of Sessions currently
  working (from the existing PTY working-state — ambient, consistent with the glow);
  **Unseen Completions** = mint pulse (radar ping) + count; mixed shows both.
- **On click:** expands to a list of every Session grouped **Waiting for you** (Unseen
  Completion) / **Working** / **Idle**, each row = status mark + name + project + tab #.
  Clicking a row → focuses the main Cockpit window and jumps to that Session/pane.
- **Data flow (single source of truth = main window):** the main window owns the
  notification store + computes a sessions snapshot (name, project, tabId, working/idle,
  unseen) and `emit`s it to the Beacon over a Tauri event (`cockpit://beacon-state`); the
  Beacon `listen`s and renders. Beacon row click → `invoke("beacon_jump", {sessionId})` →
  Rust shows+focuses main and `emit`s `cockpit://jump {sessionId}` → `CockpitView` runs its
  existing jump logic (`findPaneBySession` → focusTab/focusPane/focusTerminal, else
  `openSession`).

## Settings (nested)

Extend `settings.ts` `Settings` with a `notifications` object and a "Notifications" section
in `SettingsMenu`:

```
Notify when a session finishes           [on]   ← master
  macOS notification                     [on]
    Play sound                           [on]   ← nested under macOS notification
  In-app toast                           [on]
  Floating beacon                        [on]
```

Defaults: all on. The master gates the rest. Sound is meaningful only when macOS
notification is on (nested accordingly).

## Architecture / modules

**Frontend (the bulk):**
- `lib/settings.ts` — add `notifications: { enabled, os, sound, toast, beacon }` with
  migration-safe defaults in `loadSettings`.
- `lib/completion.ts` — pure parser: `parseCompletion(line, now) → Completion | null`
  (stop_reason + freshness logic). Unit-tested.
- `hooks/useCompletionNotifier.ts` — subscribes to each live pane's `onLogLine`, runs the
  parser + per-pane debounce, and on a Completion: `notifications.push(...)`, fire OS
  notification + toast (gated by settings). Sets up/tears down listeners as panes appear/
  disappear (mirror `CockpitView`'s live-pane tracking).
- `lib/notifications.ts` — in-memory store + `useNotifications()`: `entries`, per-entry
  `seen`, derived `unseenByTab(layout)` / `totalUnseen`; actions `push`, `markTabSeen`,
  `markAllSeen`, `clearAll`, `jump`. Pure aggregation helpers unit-tested.
- `lib/osNotify.ts` — `ensurePermission()`, `notifyCompletion(entry, {sound})` over the
  Tauri notification plugin.
- `components/NotificationBell.tsx` (+ `.css`) — tool button + bubble + panel.
- `components/Toast.tsx` / `ToastHost.tsx` (+ `.css`) — queue + render.
- `beacon/` — `beacon.html` entry, `beacon/main.tsx`, `beacon/Beacon.tsx` (+ `.css`):
  renders only the Beacon UI; listens to `cockpit://beacon-state`; emits jumps.
- Wiring: `CockpitView` mounts `useCompletionNotifier`, owns the store, emits beacon state,
  listens for `cockpit://jump`, clears Unseen on `activeTabId` change (extend the existing
  effect at `CockpitView.tsx:48`), passes `unseenByTab` + bell handlers to `TabBar`.
- `TabBar.tsx` — add the bell button (between Workspaces and Settings) + per-tab badge.

**Rust / Tauri (small):**
- `package.json`: `@tauri-apps/plugin-notification`. `Cargo.toml`: `tauri-plugin-notification`.
- `lib.rs`: register the plugin; create the `beacon` window in `setup()` (child + always-on-
  top + visibleOnAllWorkspaces + macOS non-activating level); add command `beacon_jump`.
- `capabilities/`: add `notification:default`; grant the `beacon` window the events +
  `beacon_jump` it needs (likely a second capability file scoped to `beacon`).
- `vite.config.ts`: add `beacon.html` as a second build input (multi-entry).

## Testing

- **Unit (vitest, matching the repo's `*.test.ts` convention):** `parseCompletion`
  (end_turn vs tool_use, freshness/backfill rejection, malformed line → null); unseen
  aggregation (`entries` + `layout` → `unseenByTab`/`total`, active-tab exclusion);
  debounce/collapse logic; settings load/migrate defaults.
- **Spike + manual GUI verification:** Task 0 schema spike; OS notification appears +
  click focuses; toast shows on a real Completion; tab badge + bell counts and clearing;
  Beacon pulses/lists/jumps and floats over another app; permission prompt flow.

## Risks (verify, don't assume)

1. **Transcript schema** (ADR 0007) — retired by Task 0 spike.
2. **Beacon over native-fullscreen Spaces** (ADR 0008) — macOS restricts floating over
   another app's fullscreen; verify and document actual behavior.
3. **Notification permission** in `tauri dev` vs a signed bundle — may only work reliably
   in the built app; verify in a build.
4. **Multi-window capabilities** — the `beacon` window needs explicit event/command grants;
   get the capability scoping right.

## Out of scope (this iteration)

- Per-pane opt-in / mute-this-session controls.
- A separate "waiting for permission" notification (inert under skip-permissions).
- Custom bundled notification sound (system sound for now).
- Persisting notification history across restarts.
- Dock badge / menu-bar tray (the Beacon covers the always-on need).

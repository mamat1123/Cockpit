# Canvas view — a free-form pan/zoom workspace mode (M13)

Status: design approved 2026-07-07 (visual-companion session: user picked placement B
"canvas as a main view mode" over upgrading Mission Control, CNVS-style activity-log
cards over status-only/live-preview cards, and the hand-rolled engine over React Flow).
Next: user review → implementation plan.

## Context

Inspired by CNVS (cnvs.dev) — a canvas where every agent session is a free-floating
card showing what the agent is doing. Cockpit's Mission Control already lists every
session as a bay (status, cost, jump) but it is a fixed grid inside a temporary
overlay. The user wants the canvas as a *workspace mode*: cards laid out freely,
pan/zoom, glance-and-jump.

**Hard requirement (user-stated): no lag, no jank.** CNVS is native Swift; matching
its feel in a webview dictates the architecture — gestures must never touch React
rendering (§ Performance).

## Decisions

1. **View mode**: `viewMode: "tabs" | "canvas"`, UI state in `CockpitView`, persisted
   as its own localStorage key via `persistence.ts` (not a Settings entry — it is a
   frequently-toggled mode, not a set-once preference). Restored on launch.
2. **Switching**: a segmented `⌶ Tabs / ▦ Canvas` control in the top chrome
   (`TabBar.tsx`, by the tool buttons) + a `⌘G` keybinding in `useKeybindings`.
3. **Tabs stay mounted**: in canvas mode the TabPanes stack is hidden with CSS
   (`visibility`/`display`), never unmounted — terminal slots survive, PTYs and
   xterm instances are untouched, switching back is instant. Same trick inactive
   tabs use today.
4. **Engine (hand-rolled)**: one world `<div>` carrying
   `transform: translate(x,y) scale(z)`; cards absolutely positioned in world
   coordinates inside it. During any gesture (pan / zoom / card drag) the transform
   is written **directly to the DOM node via refs, batched per frame with
   requestAnimationFrame**; React state is committed once on gesture end.
   - Pan: drag empty background, or two-finger wheel scroll.
   - Zoom: trackpad pinch (wheel + `ctrlKey` on macOS) or `⌘`+wheel, zooming toward
     the cursor. Clamped 25%–200%.
   - Card drag: pointer capture on the card; click vs drag separated by a 5 px
     movement threshold.
   - HUD bottom-right: zoom % pill + "fit all" (camera framing every card).
5. **Cards** (fixed width 240 px, height by content):
   - Header: pane title + status — working (green border), waiting (amber border +
     soft glow + `waiting Xm`), idle (gray). Derived exactly like Dashboard:
     `waitingPanes` first, else `deriveState(paneLastLineAt)` on a 400 ms tick.
   - Sub-line: shortened cwd + `tab N`.
   - **Activity log: the last 3 tool actions** (CNVS-style), e.g. `⚙ Bash · npm test`,
     `✎ Edit · CanvasView.tsx`, `→ Read · dragMath.ts`.
   - Footer: session cost (`sessionUsage` × `costOf`, 3 s poll like Dashboard) +
     last-active.
   - Click → switch to tabs mode, `focusTab` + `focusPane` + `focusTerminal`
     (double-rAF pattern, same as Dashboard jump).
6. **Activity feed — the only new data-layer piece.** `src/lib/activity.ts`: a pure
   fold `nextActivity(line)` + a per-pane ring-buffer store singleton, modeled on
   `waiting.ts`. Parses assistant `tool_use` blocks from the JSONL lines the frontend
   already receives (`onLogLine`) — **no Rust changes**. Skips `isSidechain` lines.
   Detail per tool: Bash → first ~40 chars of `command`; Edit/Write/Read →
   `basename(file_path)`; Task → `description`; AskUserQuestion → first question;
   anything else → tool name only. The store is fed from the same place
   `waitingPanes.apply` is called today.
7. **Positions**: `Record<paneId, {x, y}>` in localStorage (`persistence.ts`).
   Panes without a stored position are auto-placed into the next free grid cell
   near the origin (no overlap with stored cards). Entries whose pane left the
   layout are pruned on save. Camera `{x, y, zoom}` persisted the same way.
8. **Empty state**: no sessions → the existing `cockpit-empty` invitation (open a
   folder via ⌘O), rendered on the canvas background.

## Architecture

New files, wiring confined to two existing components:

- `src/components/CanvasView.tsx` + `CanvasView.css` — the mode: world layer, cards,
  gesture handlers, HUD. Reads `overviewItems(layout)` (same source as Dashboard).
- `src/components/canvasMath.ts` — pure camera + placement math (screen↔world,
  zoom-at-point, clamp, fit-all framing, next-free-cell placement, click-vs-drag
  threshold). Sibling of `dragMath.ts`, fully unit-tested.
- `src/lib/activity.ts` — tool_use fold + ring-buffer store (§ Decisions 6).
- `src/lib/persistence.ts` — gains viewMode / positions / camera load+save helpers.
- `CockpitView.tsx` — holds `viewMode`, renders `CanvasView` over the (hidden)
  TabPanes stack, passes the jump callback.
- `TabBar.tsx` — the segmented mode toggle; `useKeybindings` — ⌘G.

## Performance (the requirement everything above serves)

- Gesture frames do zero React work: transform writes on refs, one GPU composite
  per frame, no layout/paint (`will-change: transform` on world layer and cards).
- The dot-grid background is a CSS `radial-gradient` pattern on the world layer —
  scales inside the same transform, costs nothing extra.
- Status tick (400 ms) and cost poll (3 s) update card text through normal React
  renders — decoupled from gestures; at tens of cards this is negligible. Activity
  entries arrive per log line and mutate only the affected card's text.
- No canvas library, no extra dependency, bundle unchanged.

## Testing

- `canvasMath.test.ts`: zoom-at-point keeps the cursor's world point fixed; zoom
  clamps; screen↔world round-trips; fit-all frames all cards; auto-placement fills
  free cells without overlap; 5 px click-vs-drag threshold.
- `activity.test.ts`: fold real-transcript fixture lines (`__fixtures__` style, as
  `waiting.test.ts` does) → expected entries; ring buffer caps; sidechain lines
  ignored; unreadable lines are no-ops.
- `persistence.test.ts` additions: viewMode/positions/camera round-trip; pruning of
  closed panes' positions.
- GUI verification pass at the end (pan/zoom/drag feel, mode switch, jump).

## Out of scope (v1)

- Live terminal previews or embedded xterms on cards (conflicts with the no-lag
  requirement; revisit only with a real design).
- Drawing / scratchpad / diagram layer, voice control, agent-spawns-agent (CNVS
  features explicitly deferred).
- Creating sessions from the canvas (creation stays in the picker); card resize;
  multi-select; minimap; connections between cards.

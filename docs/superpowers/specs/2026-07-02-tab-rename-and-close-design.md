# Tab rename + close button

Status: design approved 2026-07-02. Next: implementation plan (writing-plans).

## Context

The tab bar (`TabBar.tsx`) shows one button per `Tab`, labeled by `tabName(t)` — today that
function just reads `t.rows.flatMap(r => r.panes)[0]?.title`, i.e. a Tab has no name of its
own, it borrows its first Pane's title. There's also no way to close a whole Tab in one action:
`⌘W` (the `close` reducer action) removes one Pane at a time, only collapsing the Tab once its
last Pane is gone.

Two related gaps, requested together:
1. **Rename a Tab** directly, independent of any Pane inside it.
2. **Close a Tab** (all its Panes/Rows at once) from a button on the tab itself, not just by
   closing Panes one by one.

## Decisions (resolved during brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Tab naming | independent `Tab.title?: string` override, not a proxy for Pane 0's title | a multi-Pane (split) Tab has no single Pane whose title should "be" the Tab name; an override also can't be clobbered by the existing AI-topic auto-follow on Panes (`autoTitlePane`) |
| Rename trigger | double-click the tab title → inline `<input>` | mirrors `PaneHeader`'s existing rename gesture exactly — no new interaction to learn |
| Close trigger | × revealed on hover, in the slot the pane-count badge occupies | keeps the tab's resting width identical to today; badge and × are never both needed at once |
| Close confirmation | instant close for a 1-Pane Tab; inline "Close N sessions?" chip for >1-Pane Tabs | a stray click shouldn't kill several live sessions at once, but a single session closing should feel as fast as `⌘W` does today |
| Closing the only remaining Tab | no-op, same as `close`'s existing "never close the last pane anywhere" guard | keeps the same app-wide invariant instead of introducing a second way to reach the empty layout |

## Mechanism

### Reducer (`src/layout/paneLayout.ts`)

- `Tab` gains `title?: string`. `tabName()` (in `TabBar.tsx`) becomes:
  `t.title || t.rows.flatMap(r => r.panes)[0]?.title || "shell"`.
- New action `{ type: "renameTab"; tabId: string; title: string }`: sets `tab.title` to the
  trimmed value, or clears it back to `undefined` when the trimmed value is empty — an empty
  commit reverts the Tab to its auto-derived name. Parallel to `renamePane`, except there is no
  `autoTitle` flag to flip: an unset `title` always tracks the derivation live, there's nothing
  to "stop following."
- New action `{ type: "closeTab"; tabId: string }`: removes the target Tab (all its Rows/Panes)
  from `l.tabs`.
  - No-op (`return l`) if `l.tabs.length === 1` — mirrors `close`'s existing rule that the very
    last Pane anywhere can never be closed.
  - If the removed Tab was `activeTabId`, the Tab that slides into its position becomes active —
    `tabs[Math.min(idx, tabs.length - 1)]` after removal, so closing activates the tab now to its
    right, or the new last tab if you closed the rightmost one. (This differs from `close`'s
    existing tab-emptying fallback, which always jumps to the last tab; `closeTab` is a new,
    separate action so it's free to pick the more expected "stay in place" behavior.)
    `focusedPaneId` becomes that Tab's first Pane.
  - No PTY/logtail cleanup needed here: `CockpitView`'s existing effect that diffs
    `livePaneIds(layout)` before/after already kills anything that disappears from the layout,
    regardless of whether it left via `close` or `closeTab`.

### Persistence

- `SavedTab` gains `title?: string`. `serializeLayout` writes it only when set (`...(t.title ? {
  title: t.title } : {})`, same style as the existing optional Pane fields). `deserializeLayout`
  carries it through unchanged. Renamed tabs survive restart and saved workspaces without any
  migration (missing field ⇒ `undefined` ⇒ falls back to today's derivation).

### UI (`src/components/TabBar.tsx`, `TabBar.css`)

- Local state: `editingTabId` + `draft` (rename), `confirmingTabId` (pending close).
- Double-click on `.cockpit-tab__title` → enter edit mode: render an `<input>` in place of the
  span, autofocus, select-all. `Enter`/blur commits (`dispatch({ type: "renameTab", ... })`),
  `Escape` reverts the draft and exits without dispatching. Matches `PaneHeader`'s existing
  `commit()` shape.
- Hover reveals a `.cockpit-tab__x` button absolutely positioned over the pane-count badge's
  slot (badge fades out, × fades in) — resting layout is unchanged.
  - Click on a Tab with `paneCount(t) === 1`: dispatch `closeTab` immediately, with a brief
    collapse transition (width → 0) before the Tab actually leaves `layout.tabs`, respecting
    `prefers-reduced-motion`.
  - Click on a Tab with `paneCount(t) > 1`: set `confirmingTabId`, replacing the tab's contents
    with an inline chip ("Close N sessions?" + Close/Cancel). The confirming Tab gets
    `flex: 0 0 auto` and a wider `max-width` so the chip has room instead of being squeezed by
    flex-shrink (this exact overflow was caught in the design-review mockup — the fix is
    documented here so the plan doesn't regress it).
  - Confirm dispatches `closeTab`; Cancel, `Escape`, or a click outside the chip clears
    `confirmingTabId` — same outside-click pattern `PaneHeader` already uses for its
    provider/ponytail popovers.
- All new buttons (`__x`, chip's Close/Cancel) need `appearance: none` — the mockup's × was
  visibly off-center in the red hover state purely from unreset native button chrome at that
  size; carry the fix into the real CSS.

## Testing (TDD seams)

- `paneLayout.test.ts`:
  - `renameTab` sets `tab.title`; an empty/whitespace title clears it back to `undefined`.
  - `tabName()`-equivalent derivation still falls back correctly once cleared.
  - `closeTab` removes the target Tab's Rows/Panes from the layout.
  - `closeTab` is a no-op when it's the only remaining Tab.
  - `closeTab` on the active Tab reassigns `activeTabId`/`focusedPaneId` to a neighbor.
- `TabBar.test.tsx` (new, following the `UsageGauges.panel.test.tsx` convention):
  - double-click → input appears, Enter commits a `renameTab` dispatch, Escape doesn't dispatch.
  - clicking × on a 1-pane tab dispatches `closeTab` with no intermediate chip.
  - clicking × on a >1-pane tab shows the confirm chip; Cancel dispatches nothing; Close
    dispatches `closeTab`.

## Touch points

Edit: `src/layout/paneLayout.ts` (+ `.test.ts`), `src/components/TabBar.tsx` (+ `.css`).
New: `src/components/TabBar.test.tsx`.

## Out of scope (explicit)

- **Right-click context menu** (Rename/Close/Close Others) — double-click + hover-× covers the
  request; a context menu can be layered on later without touching the reducer.
- **Undo / reopen a closed tab** — closing a Tab is immediate and final, same as `⌘W` today; no
  session history or "recently closed" list.
- **Renaming from the Dashboard/Mission Control view** — this spec only covers the tab bar.

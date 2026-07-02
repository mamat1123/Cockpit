# Vertical tab bar — a setting to dock tabs left instead of top

Status: design drafted 2026-07-03 (layout picked by the user in a visual-companion session:
option A of three mockups; side/switch/width defaults chosen by Claude while the user was
AFK — all three are one-line changes if vetoed). Next: user review → implementation plan.

## Context

The tab list lives in the horizontal top bar (`TabBar.tsx`), which also carries the window
drag region, the multi-provider `UsageStrip`, the tool buttons, and the bell. With many
tabs across two jobs the horizontal strip truncates titles at 24 chars and gets crowded.
The user asked for a setting to lay tabs out vertically or horizontally.

**Chosen layout (user-picked, mockup A):** a left sidebar holds ONLY the tab list; the top
bar stays exactly as it is (drag region, usage, tools, bell) minus the tab list. Rejected:
B (everything into the sidebar, no top bar) and C (collapsible icon rail).

## Decisions

1. **Setting**: `tabBar: "top" | "left"` on `Settings` (`src/lib/settings.ts`), default
   `"top"`. Persisted with the rest of the settings blob; `loadSettings` backfills the
   default for existing installs.
2. **Side**: left only in v1 (a `"right"` value can join the union later — the layout is
   one flex-order away).
3. **Switching**: a segmented control row in `SettingsMenu` ("Tab bar · top / left").
   No keybinding (YAGNI — this is a set-once preference).
4. **Sidebar size**: fixed 200 px wide, full height under the top bar, `overflow-y: auto`
   when tabs overflow. Not resizable in v1.
5. **Feature parity**: a vertical tab row does everything a horizontal tab does today —
   click select, drag-reorder, double-click rename (with the focus-steal grace defense),
   close button + multi-pane confirm chip, working equalizer / waiting `?` / idle dot,
   unseen badge, attention state. One shared implementation, never two copies.

## Architecture

All inside the existing files — no new state, no Rust:

- **`TabBar.tsx` refactor**: extract the per-tab JSX (the `layout.tabs.map(...)` body:
  indicator + title/rename input + count/close + confirm chip + badge + dnd handlers) into
  an internal `TabItem` component, and the working/waiting poll + rename/confirm state
  into a `useTabStripState(layout, ...)` hook, so the two containers share one
  implementation. Export:
  - `TabBar` — gains a `showTabs: boolean` prop; renders the top chrome, and the
    `TabItem` row list only when `showTabs` (i.e. `tabBar === "top"`).
  - `TabSidebar` — new export in the same file: a `<nav class="cockpit-side">` mapping
    the same `TabItem`s vertically. Same props as the list part of TabBar.
- **`CockpitView.tsx`**: reads `settings.tabBar`; the content area becomes a horizontal
  flex row when `"left"`:

  ```
  column: [ TabBar (top chrome, tabs only when "top") ]
          [ row:  [ TabSidebar? ]  [ TabPanes stack (flex:1, minWidth:0) ] ]
  ```

  Everything else (Juice, ToastHost, overlays, Beacon emitter) is untouched.
- **`TabBar.css`**: `.cockpit-side` container styles + `.cockpit-tab--v` modifier —
  full-width rows, active state marked by a LEFT accent bar (the horizontal mode's
  top bar rotated), title ellipsis gets the full 200 px, right-aligned count/close.
- **`SettingsMenu.tsx`**: one `settings__row` with two segmented buttons, patching
  `{ tabBar }` like every other setting.

## Testing

- `settings.test` (alongside the existing notifications-merge tests): `loadSettings`
  backfills `tabBar: "top"` for a stored blob that predates the field, and round-trips
  a saved `"left"`.
- Tab-item behavior is exercised the same way it is today (manually / no existing
  component test) — the refactor moves JSX without changing logic.

## Out of scope (v1)

- Right-side dock, resizable width, collapsible icon rail (mockup C).
- Moving usage/tools/bell into the sidebar (mockup B).
- A "+ new tab" row inside the sidebar (the `+` tool stays top-right).

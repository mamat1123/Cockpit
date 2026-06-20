# Claude Cockpit — M3b: Resize + Window-Drag + Tab-Reorder — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** (1) drag dividers to resize panes (and rows) within a tab; (2) drag the empty header area to move the OS window; (3) drag a tab to reorder it. Builds on the M3 2-level layout (tab → rows → panes).

**Architecture:** Add `size` weights to `Row` and `Pane` in the layout model + reducer actions (`moveTab`, `setRowSizes`, `setPaneSizes`). Render uses those weights as `flex`. Dividers between siblings adjust the two neighbors' weights on pointer-drag. The header gets a `data-tauri-drag-region` spacer (window move) and draggable tab buttons (HTML5 DnD reorder).

**Tech Stack:** React/TS · pointer events (resize) · HTML5 drag-and-drop (tab reorder) · Tauri `data-tauri-drag-region` · vitest (reducer TDD)

---

## Scope (M3b)
**In:** resize within a tab (horizontal between panes, vertical between rows); window drag via header; tab reorder. **Out:** persistence (still M-later); cross-row pane drag; min/max pixel constraints beyond a simple clamp.

---

## Task 1: Reducer — size weights + moveTab/setRowSizes/setPaneSizes (TDD)

**Files:** modify `src/layout/paneLayout.ts` + `src/layout/paneLayout.test.ts`.

- [ ] **Step 1: Add the failing tests** — append inside the existing `describe` in `paneLayout.test.ts`:
```ts
  it("panes and rows start with size 1", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].rows[0].panes.every((p) => p.size === 1)).toBe(true);
    expect(l.tabs[0].rows.every((r) => r.size === 1)).toBe(true);
  });
  it("moveTab reorders tabs", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab" });   // tabs: [t1, t2], active t2
    const [t1, t2] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "moveTab", tabId: t2, toIndex: 0 });
    expect(l.tabs.map((t) => t.id)).toEqual([t2, t1]);
    expect(l.activeTabId).toBe(t2); // active unchanged
  });
  it("setPaneSizes updates the row's pane weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });
    const rowId = l.tabs[0].rows[0].id;
    l = reduce(l, { type: "setPaneSizes", rowId, sizes: [2, 1] });
    expect(l.tabs[0].rows[0].panes.map((p) => p.size)).toEqual([2, 1]);
  });
  it("setRowSizes updates the tab's row weights", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });
    const tabId = l.tabs[0].id;
    l = reduce(l, { type: "setRowSizes", tabId, sizes: [3, 1] });
    expect(l.tabs[0].rows.map((r) => r.size)).toEqual([3, 1]);
  });
```

- [ ] **Step 2: `npm run test` → the 4 new tests FAIL.**

- [ ] **Step 3: Implement.** In `paneLayout.ts`:
  - Add `size: number` to `Pane` and `Row` interfaces.
  - `makePane`: `({ id: nextId("pane"), cwd, size: 1 })`. `makeRow`: `({ id: nextId("row"), panes: [makePane(cwd)], size: 1 })`.
  - Extend the `Action` union with:
    ```ts
    | { type: "moveTab"; tabId: string; toIndex: number }
    | { type: "setRowSizes"; tabId: string; sizes: number[] }
    | { type: "setPaneSizes"; rowId: string; sizes: number[] }
    ```
  - Add cases:
    ```ts
    case "moveTab": {
      const from = l.tabs.findIndex((t) => t.id === a.tabId);
      if (from < 0) return l;
      const tabs = [...l.tabs];
      const [moved] = tabs.splice(from, 1);
      tabs.splice(Math.max(0, Math.min(a.toIndex, tabs.length)), 0, moved);
      return { ...l, tabs };
    }
    case "setRowSizes": {
      const tabs = l.tabs.map((t) =>
        t.id === a.tabId && a.sizes.length === t.rows.length
          ? { ...t, rows: t.rows.map((r, i) => ({ ...r, size: a.sizes[i] })) }
          : t,
      );
      return { ...l, tabs };
    }
    case "setPaneSizes": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) =>
          r.id === a.rowId && a.sizes.length === r.panes.length
            ? { ...r, panes: r.panes.map((p, i) => ({ ...p, size: a.sizes[i] })) }
            : r,
        ),
      }));
      return { ...l, tabs };
    }
    ```

- [ ] **Step 4: `npm run test` → all pass (14).** `npx tsc --noEmit` clean.
- [ ] **Step 5: Commit** — `feat(layout): size weights + moveTab/setRowSizes/setPaneSizes` *(no AI attribution — hard rule, all tasks)*

---

## Task 2: Header — window drag + tab reorder

**Files:** modify `src/components/TabBar.tsx`, `src/components/TabBar.css`, `src/components/CockpitView.tsx`.

- [ ] **Step 1: TabBar — draggable tabs + a drag-region spacer**

Replace `TabBar.tsx` with (adds `onReorder` prop, `draggable` tabs, and a `data-tauri-drag-region` spacer that fills remaining header width for moving the window):
```tsx
import type { Layout } from "../layout/paneLayout";
import "./TabBar.css";

export function TabBar({ layout, onSelect, onNewTab, onReorder }: {
  layout: Layout;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
}) {
  return (
    <div className="cockpit-tabs">
      {layout.tabs.map((t, i) => (
        <button
          key={t.id}
          className={`cockpit-tab${t.id === layout.activeTabId ? " is-active" : ""}`}
          draggable
          onClick={() => onSelect(t.id)}
          onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            const fromId = e.dataTransfer.getData("text/plain");
            if (fromId && fromId !== t.id) onReorder(fromId, i);
          }}
        >
          {`${i + 1} · ${t.rows.reduce((n, r) => n + r.panes.length, 0)}▦`}
        </button>
      ))}
      <button className="cockpit-tab cockpit-tab--new" onClick={onNewTab} aria-label="New tab (Cmd+T)">+</button>
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
    </div>
  );
}
```

- [ ] **Step 2: TabBar.css — the spacer + grab affordance.** Append:
```css
.cockpit-tabs__drag { flex: 1; align-self: stretch; }
.cockpit-tab { cursor: pointer; }
.cockpit-tab[draggable="true"]:active { cursor: grabbing; }
```

- [ ] **Step 3: CockpitView — wire onReorder.** On the `<TabBar .../>`, add:
```tsx
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
```

- [ ] **Step 4: Tauri drag-region permission.** Confirm `src-tauri/capabilities/default.json` allows window dragging. If `data-tauri-drag-region` doesn't move the window at GUI test, add `"core:window:allow-start-dragging"` to that capability's `permissions` array. (Verify at Task 4; note here.)

- [ ] **Step 5: `npx tsc --noEmit` clean; `npm run test` green. Commit** — `feat(ui): window drag via header + drag-to-reorder tabs`

---

## Task 3: Resize dividers (panes within a row; rows within a tab)

**Files:** modify `src/components/CockpitView.tsx`; add `src/components/Divider.tsx`.

- [ ] **Step 1: Divider component** — `src/components/Divider.tsx`:
```tsx
import { useRef } from "react";

/** A draggable splitter. Reports the drag delta (px) along its axis via onResize,
 *  with the container's full size along that axis, so the parent can convert to weights. */
export function Divider({ axis, containerPx, onResize }: {
  axis: "x" | "y";
  containerPx: () => number;
  onResize: (deltaFraction: number) => void;
}) {
  const start = useRef(0);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture(e.pointerId);
    start.current = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const now = axis === "x" ? ev.clientX : ev.clientY;
      const total = containerPx() || 1;
      onResize((now - start.current) / total);
      start.current = now;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onDown}
      style={{
        flex: "0 0 6px",
        cursor: axis === "x" ? "col-resize" : "row-resize",
        background: "transparent",
      }}
    />
  );
}
```

- [ ] **Step 2: CockpitView — render dividers + apply weights**

In the active tab body, give each row `flex: ${r.size} 1 0` and each pane `flex: ${p.size} 1 0`; insert a `<Divider>` between adjacent rows (axis "y") and between adjacent panes (axis "x"). Use refs to read the container pixel size. Concrete shape for the active tab's inner content:
```tsx
import { useRef } from "react";
import { Divider } from "./Divider";
// ...
        {layout.tabs.map((t) => {
          const colRef = useRef<HTMLDivElement>(null); // the rows column
          return (
            <div key={t.id} ref={colRef} style={{ position: "absolute", inset: 0,
              display: t.id === layout.activeTabId ? "flex" : "none",
              flexDirection: "column", gap: 0, padding: 6 }}>
              {t.rows.map((r, ri) => (
                <RowView
                  key={r.id} row={r}
                  focusedPaneId={layout.focusedPaneId}
                  onFocus={(paneId) => dispatch({ type: "focusPane", paneId })}
                  isLast={ri === t.rows.length - 1}
                  onResizeDown={(df) => {
                    const sizes = t.rows.map((x) => x.size);
                    const total = sizes.reduce((s, v) => s + v, 0);
                    const move = df * total;
                    const a = Math.max(0.1, sizes[ri] + move);
                    const b = Math.max(0.1, sizes[ri + 1] - move);
                    sizes[ri] = a; sizes[ri + 1] = b;
                    dispatch({ type: "setRowSizes", tabId: t.id, sizes });
                  }}
                  colPx={() => colRef.current?.clientHeight ?? 1}
                  tabId={t.id} dispatch={dispatch}
                />
              ))}
            </div>
          );
        })}
```
…and a `RowView` component (same file or `RowView.tsx`) that renders the row's panes with `flex:${p.size} 1 0`, a `Divider axis="x"` between adjacent panes (adjusting that row's `setPaneSizes`), the focus ring, and a `Divider axis="y"` after the row when `!isLast` (calling `onResizeDown`). Keep `<TerminalPane>` props unchanged (`paneId/cwd/focused/onFocus`) and **keep `key={p.id}` stable** so PTYs survive.

> Implementer note: a hooks-in-map lint issue (`useRef` inside `.map`) is acceptable here because the tab list is stable per render and never conditionally mounted; if the linter rejects it, lift each tab into its own `<TabPanes>` component that owns its `colRef`. Prefer extracting `<TabPanes>` for cleanliness.

- [ ] **Step 3: `npx tsc --noEmit` clean; `npm run test` green. Commit** — `feat(ui): drag-resizable panes and rows`

---

## Task 4: GUI verification (owner)

- [ ] **Step 1:** `npm run tauri dev`, verify:
1. **Resize:** `Cmd+D` to split → a draggable divider sits between the two panes; drag it → panes resize, claude reflows. `Cmd+Shift+D` → divider between rows resizes vertically.
2. **Window drag:** drag the empty area of the header (right of the tabs) → the OS window moves. (If not: add `core:window:allow-start-dragging` to `src-tauri/capabilities/default.json` and rebuild.)
3. **Tab reorder:** `Cmd+T` a couple times → drag a tab left/right → order changes; active tab stays correct; sessions in all tabs still alive.
4. Regressions: working/idle still log-driven (no false working on type/switch); Cmd+W still closes.

Report pass/fail. 

- [ ] **Step 2: wrap-up** — update `SPEC.md` (M3b: resize + window-drag + tab-reorder done; persistence still deferred). Commit — `docs: M3b done — resize, window drag, tab reorder`

---

## Self-review
**Spec coverage:** resize (Task 1 weights + Task 3 dividers), window drag (Task 2 drag-region), tab reorder (Task 2 DnD + Task 1 moveTab) — reducer parts TDD'd, drag UI owner-verified. Persistence still out.
**Placeholder scan:** the Tauri drag-region permission (Task 2 Step 4 / Task 4 Step 2) is an explicit verify-and-maybe-add step with the exact permission named — not a TODO dodge.
**Type/name consistency:** new actions `moveTab`/`setRowSizes`/`setPaneSizes` added to the union in Task 1 and dispatched in Tasks 2–3 with matching field names (`tabId`/`toIndex`, `tabId`/`sizes`, `rowId`/`sizes`). `Divider` props (`axis`, `containerPx`, `onResize`) consistent between definition and use.
**Known caveat:** resize weights aren't persisted (reset on app restart) — fine until the persistence milestone. Min clamp is 0.1 weight (not a pixel min); good enough for v1.

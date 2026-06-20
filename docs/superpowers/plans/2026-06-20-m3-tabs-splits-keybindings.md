# Claude Cockpit — M3: Tabs + Splits + Ghostty Keybindings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ghostty-style multi-pane: `Cmd+T` new tab, `Cmd+D` split the focused pane (a new pane to the right in the active tab), `Cmd+W` close the focused pane (and the tab when its last pane closes). New panes inherit the focused pane's cwd. Each pane is a full M1+M2 `TerminalPane` (own PTY + working/idle indicator).

**Architecture:** A pure layout reducer (tabs → ordered panes, with active-tab + focused-pane ids) drives rendering. App renders a tab bar + the active tab's panes in a flex row. A keybinding layer intercepts `Cmd+T/D/W` at the window level AND tells xterm to ignore those combos (so they don't leak into the shell). M1/M2 `TerminalPane` is reused unchanged.

**Tech Stack:** React/TS · xterm `attachCustomKeyEventHandler` · vitest (reducer TDD)

---

## Scope (M3)

**In:** layout model (tabs + flat horizontal splits); `Cmd+T` / `Cmd+D` / `Cmd+W`; tab bar; focus tracking + click-to-focus; new panes inherit focused cwd.

**Out (later — M3b):** recursive/grid splits + vertical split (`Cmd+Shift+D`); drag-to-resize dividers; persistence across restart; focus-move shortcuts (`Cmd+[`/`]`); per-pane cwd picker.

**Key risk to spike (Task 2):** xterm captures keystrokes when focused, so `Cmd+D/T/W` would otherwise be typed into the shell. Must intercept them before xterm sends them to the PTY.

---

## File structure (M3)

```
src/
  layout/paneLayout.ts        # NEW: types + pure reducer (newTab/split/close/focus/setCwd)
  layout/paneLayout.test.ts   # NEW: vitest reducer tests
  layout/useKeybindings.ts    # NEW: window Cmd+T/D/W → dispatch
  components/TabBar.tsx        # NEW: tab strip
  components/CockpitView.tsx   # NEW: owns layout state, renders TabBar + active tab's pane row
  components/TerminalPane.tsx  # MODIFY: accept onFocus + suppress Cmd+T/D/W in xterm; focused ring
  App.tsx                     # MODIFY: render <CockpitView/> instead of one pane
```

---

## Task 1: Pure layout reducer (TDD)

**Files:** Create `src/layout/paneLayout.ts` + `src/layout/paneLayout.test.ts`.

- [ ] **Step 1: Write the failing tests**

Create `src/layout/paneLayout.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { initLayout, reduce, type Layout } from "./paneLayout";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

function ids(l: Layout) {
  return l.tabs.map((t) => t.panes.map((p) => p.id));
}

describe("paneLayout", () => {
  it("starts with one tab + one pane", () => {
    const l = initLayout(DEFAULT_CWD);
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(l.tabs[0].panes[0].id);
  });

  it("newTab adds a tab with one pane and focuses it", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "newTab" });
    expect(l.tabs.length).toBe(2);
    expect(l.activeTabId).toBe(l.tabs[1].id);
    expect(l.focusedPaneId).toBe(l.tabs[1].panes[0].id);
  });

  it("split adds a pane to the active tab, inheriting focused cwd, and focuses it", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "setCwd", paneId: l.focusedPaneId, cwd: "/tmp/x" });
    l = reduce(l, { type: "split" });
    expect(l.tabs[0].panes.length).toBe(2);
    const created = l.tabs[0].panes[1];
    expect(created.cwd).toBe("/tmp/x");
    expect(l.focusedPaneId).toBe(created.id);
  });

  it("close removes the focused pane and refocuses a sibling", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "split" });
    const survivor = l.tabs[0].panes[0].id;
    l = reduce(l, { type: "close" }); // closes the split (focused)
    expect(l.tabs[0].panes.length).toBe(1);
    expect(l.focusedPaneId).toBe(survivor);
  });

  it("closing the last pane of a tab removes the tab", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "newTab" });
    l = reduce(l, { type: "close" }); // closes the only pane in tab 2 -> removes tab 2
    expect(l.tabs.length).toBe(1);
    expect(l.activeTabId).toBe(l.tabs[0].id);
  });

  it("never closes the very last pane (keeps at least one)", () => {
    let l = initLayout(DEFAULT_CWD);
    l = reduce(l, { type: "close" });
    expect(l.tabs.length).toBe(1);
    expect(l.tabs[0].panes.length).toBe(1);
  });
});
```

- [ ] **Step 2: Run — verify it fails**: `npm run test` → FAIL (no module).

- [ ] **Step 3: Implement**

Create `src/layout/paneLayout.ts`:
```ts
export interface Pane { id: string; cwd: string }
export interface Tab { id: string; panes: Pane[] }
export interface Layout { tabs: Tab[]; activeTabId: string; focusedPaneId: string }

export type Action =
  | { type: "newTab" }
  | { type: "split" }
  | { type: "close" }
  | { type: "focusPane"; paneId: string }
  | { type: "focusTab"; tabId: string }
  | { type: "setCwd"; paneId: string; cwd: string };

let counter = 0;
const nextId = (prefix: string) => `${prefix}-${++counter}`;

export function initLayout(cwd: string): Layout {
  const pane: Pane = { id: nextId("pane"), cwd };
  const tab: Tab = { id: nextId("tab"), panes: [pane] };
  return { tabs: [tab], activeTabId: tab.id, focusedPaneId: pane.id };
}

const activeTab = (l: Layout) => l.tabs.find((t) => t.id === l.activeTabId)!;
const focusedCwd = (l: Layout) =>
  activeTab(l).panes.find((p) => p.id === l.focusedPaneId)?.cwd ?? l.tabs[0].panes[0].cwd;

export function reduce(l: Layout, a: Action): Layout {
  switch (a.type) {
    case "newTab": {
      const pane: Pane = { id: nextId("pane"), cwd: focusedCwd(l) };
      const tab: Tab = { id: nextId("tab"), panes: [pane] };
      return { tabs: [...l.tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
    case "split": {
      const pane: Pane = { id: nextId("pane"), cwd: focusedCwd(l) };
      const tabs = l.tabs.map((t) =>
        t.id === l.activeTabId ? { ...t, panes: [...t.panes, pane] } : t,
      );
      return { ...l, tabs, focusedPaneId: pane.id };
    }
    case "close": {
      const tab = activeTab(l);
      // last pane of last tab: keep at least one pane
      if (l.tabs.length === 1 && tab.panes.length === 1) return l;
      if (tab.panes.length === 1) {
        // remove the whole tab
        const remaining = l.tabs.filter((t) => t.id !== tab.id);
        const newActive = remaining[remaining.length - 1];
        return { tabs: remaining, activeTabId: newActive.id, focusedPaneId: newActive.panes[0].id };
      }
      const idx = tab.panes.findIndex((p) => p.id === l.focusedPaneId);
      const panes = tab.panes.filter((p) => p.id !== l.focusedPaneId);
      const survivor = panes[Math.min(idx, panes.length - 1)];
      const tabs = l.tabs.map((t) => (t.id === tab.id ? { ...t, panes } : t));
      return { ...l, tabs, focusedPaneId: survivor.id };
    }
    case "focusPane":
      return { ...l, focusedPaneId: a.paneId };
    case "focusTab": {
      const t = l.tabs.find((x) => x.id === a.tabId)!;
      return { ...l, activeTabId: t.id, focusedPaneId: t.panes[0].id };
    }
    case "setCwd": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        panes: t.panes.map((p) => (p.id === a.paneId ? { ...p, cwd: a.cwd } : p)),
      }));
      return { ...l, tabs };
    }
  }
}
```

- [ ] **Step 4: Run — verify it passes**: `npm run test` → all paneLayout tests green (plus the existing paneState ones).

- [ ] **Step 5: Commit** — `feat(layout): tabs + flat-split layout reducer (TDD)` *(no AI attribution, no Co-Authored-By — hard rule, all tasks)*

---

## Task 2: Keybinding layer + xterm suppression (SPIKE)

**Files:** Create `src/layout/useKeybindings.ts`; modify `src/components/TerminalPane.tsx`.

- [ ] **Step 1: Window-level keybindings hook**

Create `src/layout/useKeybindings.ts`:
```ts
import { useEffect } from "react";
import type { Action } from "./paneLayout";

/** Cmd+T new tab, Cmd+D split, Cmd+W close. Capture-phase so it beats focus targets. */
export function useKeybindings(dispatch: (a: Action) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); dispatch({ type: "newTab" }); }
      else if (k === "d") { e.preventDefault(); dispatch({ type: "split" }); }
      else if (k === "w") { e.preventDefault(); dispatch({ type: "close" }); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch]);
}
```

- [ ] **Step 2: Stop xterm from typing these combos into the shell**

In `src/components/TerminalPane.tsx`, after `term.open(host)`, add:
```ts
    // Let app-level Cmd+T/D/W shortcuts through instead of sending them to the shell.
    term.attachCustomKeyEventHandler((e) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w"].includes(e.key.toLowerCase())) {
        return false; // xterm ignores it; the window handler acts
      }
      return true;
    });
```

- [ ] **Step 3: Build check** — `npx tsc --noEmit` clean. (Spike proper happens at Task 5 GUI: confirm Cmd+D/T/W act on the layout AND do NOT insert characters into the focused terminal.)

- [ ] **Step 4: Commit** — `feat(layout): Cmd+T/D/W keybindings + xterm suppression`

---

## Task 3: TabBar + CockpitView (render the layout)

**Files:** Create `src/components/TabBar.tsx`, `src/components/CockpitView.tsx`; modify `src/components/TerminalPane.tsx` (focus props + ring).

- [ ] **Step 1: TerminalPane — accept focus props**

Change the signature to `TerminalPane({ paneId, cwd, focused, onFocus }: { paneId: string; cwd: string; focused: boolean; onFocus: () => void })`. On the root `.cockpit-pane` div add `onMouseDown={onFocus}` and toggle a class: `className={`cockpit-pane${state==="working"?" is-working":""}${focused?" is-focused":""}`}`. In `TerminalPane.css` add:
```css
.cockpit-pane.is-focused { outline: 1px solid #f5a62355; outline-offset: -1px; }
.cockpit-pane { min-width: 0; flex: 1 1 0; }
```

- [ ] **Step 2: TabBar**

Create `src/components/TabBar.tsx`:
```tsx
import type { Layout } from "../layout/paneLayout";
import "./TabBar.css";

export function TabBar({ layout, onSelect, onNewTab }: {
  layout: Layout; onSelect: (tabId: string) => void; onNewTab: () => void;
}) {
  return (
    <div className="cockpit-tabs">
      {layout.tabs.map((t, i) => (
        <button
          key={t.id}
          className={`cockpit-tab${t.id === layout.activeTabId ? " is-active" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          {`${i + 1} · ${t.panes.length}▦`}
        </button>
      ))}
      <button className="cockpit-tab cockpit-tab--new" onClick={onNewTab} aria-label="New tab (Cmd+T)">+</button>
    </div>
  );
}
```
Create `src/components/TabBar.css`:
```css
.cockpit-tabs { display: flex; gap: 4px; padding: 6px 8px; background: #0E1014;
  border-bottom: 1px solid #262A33; -webkit-app-region: drag; }
.cockpit-tab { -webkit-app-region: no-drag; font: 600 11px/1 ui-monospace, Menlo, monospace;
  letter-spacing: .06em; color: #6B7280; background: transparent; border: 1px solid transparent;
  border-radius: 6px; padding: 6px 12px; cursor: pointer; }
.cockpit-tab.is-active { color: #C8CDD6; background: #1b1f27; border-color: #262A33; }
.cockpit-tab--new { color: #6B7280; padding: 6px 10px; }
.cockpit-tab:focus-visible { outline: 2px solid #f5a623; outline-offset: 1px; }
```

- [ ] **Step 3: CockpitView — owns state, wires everything**

Create `src/components/CockpitView.tsx`:
```tsx
import { useReducer } from "react";
import { initLayout, reduce, type Action } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TerminalPane } from "./TerminalPane";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

export function CockpitView() {
  const [layout, dispatch] = useReducer(
    (l: Parameters<typeof reduce>[0], a: Action) => reduce(l, a),
    DEFAULT_CWD,
    initLayout,
  );
  useKeybindings(dispatch);
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)!;

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#14161B" }}>
      <TabBar
        layout={layout}
        onSelect={(tabId) => dispatch({ type: "focusTab", tabId })}
        onNewTab={() => dispatch({ type: "newTab" })}
      />
      <div style={{ flex: 1, display: "flex", gap: 6, padding: 6, minHeight: 0 }}>
        {tab.panes.map((p) => (
          <TerminalPane
            key={p.id}
            paneId={p.id}
            cwd={p.cwd}
            focused={p.id === layout.focusedPaneId}
            onFocus={() => dispatch({ type: "focusPane", paneId: p.id })}
          />
        ))}
      </div>
    </div>
  );
}
```
**Note on keys:** `key={p.id}` + stable ids ensure React keeps each pane's PTY mounted across splits/tab switches (a pane only unmounts when truly closed). Do not key by index.

- [ ] **Step 4: `npx tsc --noEmit` clean.** Commit — `feat(ui): TabBar + CockpitView render tabs and split panes`

---

## Task 4: Wire into App

**Files:** Modify `src/App.tsx`.

- [ ] **Step 1:** Replace App body with:
```tsx
import { CockpitView } from "./components/CockpitView";

export default function App() {
  return <CockpitView />;
}
```
Remove the old single-pane code/imports (noUnusedLocals).

- [ ] **Step 2:** `npx tsc --noEmit` clean; `npm run test` green. Commit — `feat(app): mount CockpitView (tabs + splits)`

---

## Task 5: GUI verification (owner-driven)

- [ ] **Step 1: Run + verify (manual)** — `npm run tauri dev`:
1. One tab, one pane (claude runnable as before).
2. **Cmd+D** → pane splits; a second pane appears to the right (same cwd); it gets the focus ring. Run `claude` in each — both work independently, each with its own working/idle chip.
3. **Cmd+T** → new tab appears + activates with a fresh pane; tab bar shows 2 tabs; click tabs to switch (panes in the other tab keep running).
4. **Cmd+W** → closes the focused pane; closing a tab's last pane removes the tab; the very last pane is never closed.
5. **Critical:** while a terminal is focused, pressing Cmd+D/T/W performs the action and does **not** type `d`/`t`/`w` into the shell.
6. Click a pane → focus ring moves; resize window → panes reflow.

Report pass/fail. If Cmd+D/T/W leak characters into the shell, the xterm suppression (Task 2 Step 2) needs adjusting.

- [ ] **Step 2: M3 wrap-up** — update `SPEC.md` Status (M3 tabs+splits+keybindings done; recursive splits + persistence deferred to M3b). Commit — `docs: M3 done — tabs, splits, Ghostty keybindings`

---

## Self-review

**Spec coverage (this slice):** tabs (Cmd+T) ✓, splits (Cmd+D) ✓, close (Cmd+W) ✓, inherit cwd ✓, focus tracking ✓ — all from the reducer (Task 1, TDD) + render (Task 3) + keybindings (Task 2). Recursive/grid splits, vertical split, resize, persistence, focus-move → explicitly out (M3b). M1/M2 `TerminalPane` reused; each pane keeps its own PTY + working/idle indicator via stable React keys.

**Placeholder scan:** `DEFAULT_CWD` is the same explicit M1/M2 temp constant (a real dir), flagged for replacement when a cwd-picker lands — not a TODO dodge. Task 2/5 spike is an explicit owner-verified step with a concrete fallback.

**Type/name consistency:** `Action` union identical across reducer, `useKeybindings`, and `CockpitView` dispatch. `reduce(layout, action)` signature matches all call sites. `TerminalPane` new props (`focused`, `onFocus`) added in Task 3 and supplied by `CockpitView` — no caller left on the old 2-prop signature (App.tsx switches to `CockpitView` in Task 4).

**Known caveat:** all panes in a tab share one flex row (equal widths, no manual resize) — deliberate M3 simplification; recursive/resizable splits are M3b. Many simultaneous claude panes = many PTYs + log-tail threads; fine for a handful, revisit if it grows.

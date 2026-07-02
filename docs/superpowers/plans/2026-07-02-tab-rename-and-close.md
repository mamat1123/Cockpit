# Tab rename + close button Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Tab in the top tab bar be renamed independently of its Panes, and closed (all its Panes at once) from a hover-revealed × on the tab itself.

**Architecture:** `Tab` gains its own optional `title` override in the `paneLayout` reducer (`src/layout/paneLayout.ts`), with two new actions (`renameTab`, `closeTab`) and matching persistence in `SavedTab`. `TabBar.tsx` gets a double-click-to-edit title (mirroring `PaneHeader`'s existing pane-rename gesture) and a hover-revealed close button that either closes instantly (1 Pane) or shows an inline confirm chip (>1 Pane).

**Tech Stack:** React 19 / TypeScript, Vitest (`vitest run`) with `react-dom/client` for component tests (no Testing Library in this repo — see `UsageGauges.panel.test.tsx` / `.popover.test.tsx` for the existing pattern: raw DOM queries + `act()`).

## Global Constraints

- No new dependencies — implement with the existing `react-dom/client` + native DOM event patterns already used in `UsageGauges.*.test.tsx`.
- Match existing code style exactly: double quotes, no semicolons-only-where-already-used (this file already uses semicolons — keep them), no comments except where a genuinely non-obvious constraint needs explaining (this repo's existing comment density is very low — see `paneLayout.ts`).
- Never introduce a second way to reach zero-tabs beyond the one that already exists (`close`'s "never close the last pane anywhere" rule) — `closeTab` must respect the same invariant.
- All new interactive elements (`.cockpit-tab__x`, confirm-chip buttons) must reset native button `appearance` — the design-review mockup caught a real centering bug here (macOS button chrome drawn on top of custom styles at small sizes).

---

## Task 1: `Tab.title` + `renameTab` / `closeTab` reducer actions + persistence

**Files:**
- Modify: `src/layout/paneLayout.ts`
- Test: `src/layout/paneLayout.test.ts`

**Interfaces:**
- Produces: `Tab.title?: string`, `SavedTab.title?: string`, action
  `{ type: "renameTab"; tabId: string; title: string }`, action
  `{ type: "closeTab"; tabId: string }`. Task 2/3 dispatch these from `TabBar.tsx`.

- [ ] **Step 1: Write the failing reducer tests**

Append to `src/layout/paneLayout.test.ts` (after the `describe("headroom flag", ...)` block, before `describe("empty layout ...)`):

```ts
describe("tab title", () => {
  it("renameTab sets a custom title on the target tab only", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "renameTab", tabId: t0, title: "frontend" });
    expect(l.tabs.find((t) => t.id === t0)!.title).toBe("frontend");
    expect(l.tabs.find((t) => t.id === t1)!.title).toBeUndefined();
  });
  it("renameTab with an empty/whitespace title clears the override", () => {
    let l = initLayout(CWD);
    const id = l.tabs[0].id;
    l = reduce(l, { type: "renameTab", tabId: id, title: "frontend" });
    l = reduce(l, { type: "renameTab", tabId: id, title: "   " });
    expect(l.tabs[0].title).toBeUndefined();
  });
  it("round-trips a tab title through serialize/deserialize", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "renameTab", tabId: l.tabs[0].id, title: "frontend" });
    const back = deserializeLayout(serializeLayout(l, true));
    expect(back.tabs[0].title).toBe("frontend");
  });
  it("serialize omits title when unset", () => {
    const l = initLayout(CWD);
    expect(serializeLayout(l, true).tabs[0].title).toBeUndefined();
  });
});

describe("closeTab", () => {
  it("removes the target tab and its panes", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "closeTab", tabId: t0 });
    expect(l.tabs.map((t) => t.id)).toEqual([t1]);
  });
  it("is a no-op when it's the only remaining tab", () => {
    let l = initLayout(CWD);
    const id = l.tabs[0].id;
    l = reduce(l, { type: "closeTab", tabId: id });
    expect(l.tabs.map((t) => t.id)).toEqual([id]);
  });
  it("reassigns activeTabId + focusedPaneId to the tab that slides into its slot", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    l = reduce(l, { type: "newTab", cwd: "/three" });
    const [t0, t1, t2] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "focusTab", tabId: t1 });
    l = reduce(l, { type: "closeTab", tabId: t1 });
    expect(l.tabs.map((t) => t.id)).toEqual([t0, t2]);
    expect(l.activeTabId).toBe(t2);
    expect(l.focusedPaneId).toBe(l.tabs[1].rows[0].panes[0].id);
  });
  it("leaves activeTabId alone when closing a background tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const [t0, t1] = l.tabs.map((t) => t.id);
    l = reduce(l, { type: "focusTab", tabId: t0 });
    l = reduce(l, { type: "closeTab", tabId: t1 });
    expect(l.tabs.map((t) => t.id)).toEqual([t0]);
    expect(l.activeTabId).toBe(t0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- paneLayout`
Expected: FAIL — `reduce` has no case for `"renameTab"`/`"closeTab"` yet, so it falls through the
`switch` and implicitly returns `undefined`; every new test throws
`TypeError: Cannot read properties of undefined (reading 'tabs')` (or similar) when it dereferences `l.tabs`.

- [ ] **Step 3: Add `title` to `Tab` and `SavedTab`**

In `src/layout/paneLayout.ts`, change:

```ts
export interface Tab { id: string; rows: Row[] }
```
to:
```ts
export interface Tab { id: string; title?: string; rows: Row[] }
```

and change:
```ts
export interface SavedTab { rows: SavedRow[] }
```
to:
```ts
export interface SavedTab { title?: string; rows: SavedRow[] }
```

- [ ] **Step 4: Add the two new actions to the `Action` union**

In the `Action` union, add these two members right after `| { type: "moveTab"; tabId: string; toIndex: number }`:

```ts
  | { type: "renameTab"; tabId: string; title: string }
  | { type: "closeTab"; tabId: string }
```

- [ ] **Step 5: Add the two reducer cases**

In the `reduce` function, insert these two cases right after the existing `case "moveTab":` block (after its closing `}` and before `case "setRowSizes":`):

```ts
    case "renameTab": {
      const title = a.title.trim();
      const tabs = l.tabs.map((t) => (t.id === a.tabId ? { ...t, title: title || undefined } : t));
      return { ...l, tabs };
    }
    case "closeTab": {
      if (l.tabs.length <= 1) return l; // never close the last tab anywhere
      const idx = l.tabs.findIndex((t) => t.id === a.tabId);
      if (idx < 0) return l;
      const tabs = l.tabs.filter((t) => t.id !== a.tabId);
      if (l.activeTabId !== a.tabId) return { ...l, tabs };
      const next = tabs[Math.min(idx, tabs.length - 1)];
      return { tabs, activeTabId: next.id, focusedPaneId: next.rows[0].panes[0].id };
    }
```

- [ ] **Step 6: Carry `title` through `serializeLayout` and `deserializeLayout`**

Change:
```ts
    tabs: l.tabs.map((t) => ({
      rows: t.rows.map((r) => ({
```
to:
```ts
    tabs: l.tabs.map((t) => ({
      ...(t.title ? { title: t.title } : {}),
      rows: t.rows.map((r) => ({
```

Change:
```ts
  const tabs: Tab[] = s.tabs.map((t) => ({
    id: nextId("tab"),
    rows: t.rows.map((r) => ({
```
to:
```ts
  const tabs: Tab[] = s.tabs.map((t) => ({
    id: nextId("tab"),
    title: t.title,
    rows: t.rows.map((r) => ({
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- paneLayout`
Expected: PASS — all tests in `paneLayout.test.ts`, including the 8 new ones.

- [ ] **Step 8: Commit**

```bash
git add src/layout/paneLayout.ts src/layout/paneLayout.test.ts
git commit -m "feat(layout): add renameTab + closeTab reducer actions"
```

---

## Task 2: Tab rename UI (double-click to edit)

**Files:**
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/TabBar.css`

**Interfaces:**
- Consumes: `renameTab` action from Task 1 (dispatched via a new `onRenameTab(tabId: string, title: string) => void` prop, wired by Task 4).
- Produces: `tabName(t: Tab)` now prefers `t.title`; the `.cockpit-tab__input` CSS class; Task 3
  builds on the same per-tab `<div role="button">` wrapper introduced here.

- [ ] **Step 1: Update `tabName()` to prefer the override**

In `src/components/TabBar.tsx`, change:
```ts
function tabName(t: Tab): string {
  const base = t.rows.flatMap((r) => r.panes)[0]?.title || "shell";
  return base.length > 24 ? base.slice(0, 24) + "…" : base;
}
```
to:
```ts
function tabName(t: Tab): string {
  const base = t.title || t.rows.flatMap((r) => r.panes)[0]?.title || "shell";
  return base.length > 24 ? base.slice(0, 24) + "…" : base;
}
```

- [ ] **Step 2: Add the `onRenameTab` prop and local rename state**

Change the props type — add `onRenameTab: (tabId: string, title: string) => void;` right after
`onReorder: (tabId: string, toIndex: number) => void;` in the destructured prop signature:

```ts
export function TabBar({ layout, attention, unseenByTab, bellOpen, onToggleBell, onJumpSession, onSelect, onReorder, onRenameTab, onOpenDashboard, onOpenPicker, onOpenWorkspaces, onOpenSettings }: {
  layout: Layout;
  attention: Set<string>;
  unseenByTab: Map<string, number>;
  bellOpen: boolean;
  onToggleBell: () => void;
  onJumpSession: (c: import("../lib/notifications").Completion) => void;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onRenameTab: (tabId: string, title: string) => void;
  onOpenDashboard: () => void;
  onOpenPicker: () => void;
  onOpenWorkspaces: () => void;
  onOpenSettings: () => void;
}) {
```

Right after the existing `working` state block (after the `useEffect` that computes `working`,
before the `return (`), add:

```ts
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!editingTabId) return;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    el.select();
    // Selecting a tab (see onSelect below) schedules a double-rAF focusTerminal() to pull focus
    // into the terminal once it's visible. Re-assert focus on that same delay so double-clicking
    // a tab to rename it doesn't get the first few keystrokes silently redirected into a live
    // terminal a beat later.
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => { el.focus(); el.select(); });
    });
    return () => { cancelAnimationFrame(raf1); cancelAnimationFrame(raf2); };
  }, [editingTabId]);

  const commitRename = (tabId: string) => {
    setEditingTabId(null);
    onRenameTab(tabId, draft);
  };
```

- [ ] **Step 3: Replace the tab `<button>` with a `<div role="button">` hosting the rename input**

A nested `<input>` inside a native `<button>` is invalid content (interactive-in-interactive) —
switching the wrapper to `<div role="button" tabIndex={0}>` keeps every existing CSS selector
working (they target the `.cockpit-tab` class, not the tag) while safely allowing the input.

Change:
```tsx
          return (
            <button
              key={t.id}
              className={`cockpit-tab${active ? " is-active" : ""}${attn ? " is-attention" : ""}`}
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
              {isWorking ? (
                <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="cockpit-tab__dot" aria-hidden="true" />
              )}
              <span className="cockpit-tab__title">{tabName(t)}</span>
              <span className="cockpit-tab__ct">{paneCount(t)}</span>
              {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
                <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
              )}
            </button>
          );
```
to:
```tsx
          const editing = editingTabId === t.id;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`cockpit-tab${active ? " is-active" : ""}${attn ? " is-attention" : ""}`}
              draggable={!editing}
              onClick={() => onSelect(t.id)}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onSelect(t.id); } }}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain");
                if (fromId && fromId !== t.id) onReorder(fromId, i);
              }}
            >
              {isWorking ? (
                <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="cockpit-tab__dot" aria-hidden="true" />
              )}
              {editing ? (
                <input
                  ref={inputRef}
                  className="cockpit-tab__input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  onBlur={() => commitRename(t.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") { e.preventDefault(); commitRename(t.id); }
                    else if (e.key === "Escape") { e.preventDefault(); setEditingTabId(null); }
                  }}
                />
              ) : (
                <span
                  className="cockpit-tab__title"
                  onDoubleClick={(e) => { e.stopPropagation(); setDraft(tabName(t)); setEditingTabId(t.id); }}
                >
                  {tabName(t)}
                </span>
              )}
              <span className="cockpit-tab__ct">{paneCount(t)}</span>
              {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
                <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
              )}
            </div>
          );
```

(`i` here is the existing `layout.tabs.map((t, i) => { ... })` index parameter already in scope.)

- [ ] **Step 4: Style `.cockpit-tab__input`, matching `PaneHeader`'s `.pane-head__input`**

In `src/components/TabBar.css`, add right after the existing `.cockpit-tab__title { ... }` rule:

```css
.cockpit-tab__input { font: inherit; color: var(--ck-bright); background: var(--ck-bg);
  border: 1px solid var(--ck-accent); border-radius: 4px; padding: 0 4px; margin: 0 -4px;
  outline: none; min-width: 40px; max-width: 140px; }
```

- [ ] **Step 5: Write the component test file**

Create `src/components/TabBar.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TabBar } from "./TabBar";
import { initLayout, type Layout } from "../layout/paneLayout";

function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")!.set!;
  setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function baseProps(layout: Layout) {
  return {
    layout,
    attention: new Set<string>(),
    unseenByTab: new Map<string, number>(),
    bellOpen: false,
    onToggleBell: () => {},
    onJumpSession: () => {},
    onSelect: () => {},
    onNewTab: () => {},
    onReorder: () => {},
    onRenameTab: vi.fn(),
    onOpenDashboard: () => {},
    onOpenPicker: () => {},
    onOpenWorkspaces: () => {},
    onOpenSettings: () => {},
  };
}

// Shared across every describe block below — each test gets a fresh mount/unmount.
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});
function mount(layout: Layout, overrides: Partial<ReturnType<typeof baseProps>> = {}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  const props = { ...baseProps(layout), ...overrides };
  act(() => root!.render(<TabBar {...props} />));
  return { container, props };
}

describe("TabBar — rename", () => {
  it("double-clicking the title swaps it for an input, focused with its text selected", () => {
    const layout = initLayout("/tmp/proj");
    const { container } = mount(layout);
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("proj");
  });

  it("Enter commits the new title via onRenameTab", () => {
    const layout = initLayout("/tmp/proj");
    const onRenameTab = vi.fn();
    const { container } = mount(layout, { onRenameTab });
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    act(() => typeInto(input, "frontend"));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
    expect(onRenameTab).toHaveBeenCalledWith(layout.tabs[0].id, "frontend");
    expect(container.querySelector(".cockpit-tab__input")).toBeNull();
  });

  it("Escape cancels without calling onRenameTab", () => {
    const layout = initLayout("/tmp/proj");
    const onRenameTab = vi.fn();
    const { container } = mount(layout, { onRenameTab });
    const title = container.querySelector(".cockpit-tab__title")!;
    act(() => title.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })));
    const input = container.querySelector(".cockpit-tab__input") as HTMLInputElement;
    act(() => typeInto(input, "discard me"));
    act(() => input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(onRenameTab).not.toHaveBeenCalled();
    expect(container.querySelector(".cockpit-tab__input")).toBeNull();
    expect(container.querySelector(".cockpit-tab__title")!.textContent).toBe("proj");
  });
});
```

- [ ] **Step 6: Run the new test to verify it fails first, then passes**

Run: `npm test -- TabBar`
Expected first (before Steps 1–4 are in place): FAIL — `.cockpit-tab__title` / `.cockpit-tab__input`
not found, or `onRenameTab` missing from props. Since Steps 1–4 above are written before this
step, running now should already PASS. Confirm: `npm test -- TabBar` → PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/components/TabBar.tsx src/components/TabBar.css src/components/TabBar.test.tsx
git commit -m "feat(tabbar): double-click a tab title to rename it"
```

---

## Task 3: Tab close button + multi-pane confirm chip

**Files:**
- Modify: `src/components/TabBar.tsx`
- Modify: `src/components/TabBar.css`
- Modify: `src/components/TabBar.test.tsx`

**Interfaces:**
- Consumes: `closeTab` action from Task 1 (dispatched via a new `onCloseTab(tabId: string) => void`
  prop, wired by Task 4); the `<div role="button">` wrapper and `editing` local from Task 2.
- Produces: nothing consumed by a later task — this is the last UI piece.

- [ ] **Step 1: Add the `CloseIcon` and the `onCloseTab` prop**

In `src/components/TabBar.tsx`, add this near the other icon components (right after the
`SettingsIcon` definition):

```tsx
/** Close — X, used for the per-tab close button. */
const CloseIcon = () => (
  <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round">
    <path d="M6 6 L18 18 M18 6 L6 18" />
  </svg>
);
```

Add `onCloseTab: (tabId: string) => void;` right after `onRenameTab: (tabId: string, title: string) => void;`
in both the destructured parameter list and its type block.

- [ ] **Step 2: Add confirm-chip state + the close-request helper**

Right after the `commitRename` function from Task 2, add:

```ts
  const [confirmingTabId, setConfirmingTabId] = useState<string | null>(null);
  useEffect(() => {
    if (!confirmingTabId) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as Element).closest(".cockpit-tab.is-confirming")) setConfirmingTabId(null);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [confirmingTabId]);

  const requestClose = (t: Tab) => {
    if (paneCount(t) > 1) setConfirmingTabId(t.id);
    else onCloseTab(t.id);
  };
```

- [ ] **Step 3: Render the × button and the confirm chip**

Change:
```tsx
          const editing = editingTabId === t.id;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`cockpit-tab${active ? " is-active" : ""}${attn ? " is-attention" : ""}`}
              draggable={!editing}
```
to:
```tsx
          const editing = editingTabId === t.id;
          const confirming = confirmingTabId === t.id;
          return (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`cockpit-tab${active ? " is-active" : ""}${attn ? " is-attention" : ""}${confirming ? " is-confirming" : ""}`}
              draggable={!editing}
```

Change:
```tsx
              {isWorking ? (
                <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="cockpit-tab__dot" aria-hidden="true" />
              )}
              {editing ? (
```
to:
```tsx
              {confirming ? (
                <span className="confirm-chip">
                  {`Close ${paneCount(t)} sessions?`}
                  <button className="confirm-chip__go" onClick={(e) => { e.stopPropagation(); setConfirmingTabId(null); onCloseTab(t.id); }}>Close</button>
                  <button className="confirm-chip__cancel" onClick={(e) => { e.stopPropagation(); setConfirmingTabId(null); }}>Cancel</button>
                </span>
              ) : (
              <>
              {isWorking ? (
                <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="cockpit-tab__dot" aria-hidden="true" />
              )}
              {editing ? (
```

Change:
```tsx
              <span className="cockpit-tab__ct">{paneCount(t)}</span>
              {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
                <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
              )}
            </div>
          );
```
to:
```tsx
              <span className="cockpit-tab__meta">
                <span className="cockpit-tab__ct">{paneCount(t)}</span>
                <button
                  className="cockpit-tab__x"
                  aria-label="Close tab"
                  title="Close tab"
                  onClick={(e) => { e.stopPropagation(); requestClose(t); }}
                >
                  <CloseIcon />
                </button>
              </span>
              {!active && (unseenByTab.get(t.id) ?? 0) > 0 && (
                <span className="cockpit-tab__badge">{unseenByTab.get(t.id)}</span>
              )}
              </>
              )}
            </div>
          );
```

- [ ] **Step 4: Add the CSS — hover-reveal ×, confirm chip, and the overflow fix**

In `src/components/TabBar.css`, replace:
```css
.cockpit-tab__ct {
  font-size: 10px; letter-spacing: 0.06em; color: var(--ck-dim); font-variant-numeric: tabular-nums;
  background: var(--ck-surface-2); border-radius: 5px; padding: 1px 6px;
}
.cockpit-tab.is-active .cockpit-tab__ct { color: var(--ck-accent); background: color-mix(in srgb, var(--ck-accent) 16%, var(--ck-bg)); }
```
with:
```css
.cockpit-tab__meta { position: relative; width: 16px; height: 16px; flex: none; display: grid; place-items: center; }
.cockpit-tab__ct {
  position: absolute; inset: 0; display: inline-flex; align-items: center; justify-content: center;
  font-size: 10px; letter-spacing: 0.06em; color: var(--ck-dim); font-variant-numeric: tabular-nums;
  background: var(--ck-surface-2); border-radius: 5px; padding: 0; transition: opacity 0.1s;
}
.cockpit-tab.is-active .cockpit-tab__ct { color: var(--ck-accent); background: color-mix(in srgb, var(--ck-accent) 16%, var(--ck-bg)); }
.cockpit-tab__x {
  position: absolute; inset: 0; display: grid; place-items: center; border-radius: 5px; border: 0;
  appearance: none; -webkit-appearance: none; padding: 0; margin: 0; font: inherit; cursor: pointer;
  background: var(--ck-surface-2); color: var(--ck-dim); opacity: 0; transform: scale(0.7);
  transition: opacity 0.12s, transform 0.12s, background 0.12s, color 0.12s;
}
.cockpit-tab:hover .cockpit-tab__x { opacity: 1; transform: scale(1); }
.cockpit-tab:hover .cockpit-tab__meta .cockpit-tab__ct { opacity: 0; }
.cockpit-tab__x:hover { background: color-mix(in srgb, var(--ck-red) 22%, var(--ck-bg)); color: var(--ck-red); }
.cockpit-tab__x svg { display: block; }

/* a confirming tab claims the width its chip needs instead of being squeezed by flex-shrink and
   overflowing into the next tab (caught in the design-review mockup) */
.cockpit-tab.is-confirming { flex: 0 0 auto; max-width: 280px; background: color-mix(in srgb, var(--ck-red) 12%, var(--ck-surface)); }
.confirm-chip { display: flex; align-items: center; gap: 6px; font: 600 11px/1 ui-monospace, Menlo, monospace; white-space: nowrap; color: var(--ck-text); }
.confirm-chip button { appearance: none; -webkit-appearance: none; border: 0; border-radius: 4px; padding: 3px 7px;
  margin: 0; font: inherit; cursor: pointer; }
.confirm-chip__go { background: var(--ck-red); color: #fff; }
.confirm-chip__cancel { background: var(--ck-surface-2); color: var(--ck-text); }
```

Also add `overflow: hidden;` to the base `.cockpit-tab` rule (so anything that still doesn't fit
clips inside its own tab instead of bleeding into the next one) — change:
```css
.cockpit-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 230px;
  padding: 0 16px;
  font: 600 12.5px/1 ui-monospace, Menlo, monospace;
  color: var(--ck-muted);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--ck-surface-2);
  cursor: pointer;
  transition: background 0.12s, color 0.12s;
}
```
to:
```css
.cockpit-tab {
  position: relative;
  display: flex;
  align-items: center;
  gap: 9px;
  max-width: 230px;
  padding: 0 16px;
  font: 600 12.5px/1 ui-monospace, Menlo, monospace;
  color: var(--ck-muted);
  background: transparent;
  border: 0;
  border-right: 1px solid var(--ck-surface-2);
  cursor: pointer;
  overflow: hidden;
  transition: background 0.12s, color 0.12s, max-width 0.15s ease;
}
```

- [ ] **Step 5: Extend `TabBar.test.tsx` with close-button tests**

Add `onCloseTab: vi.fn(),` to `baseProps()`'s returned object (right after `onRenameTab: vi.fn(),`).

Add a `reduce` import (used inline with `{ type: "split" }` to build a 2-pane layout) and a new
`describe` block — append to `src/components/TabBar.test.tsx`:

```tsx
import { reduce } from "../layout/paneLayout";
```
(add this to the existing import block from `../layout/paneLayout`, i.e. change
`import { initLayout, type Layout } from "../layout/paneLayout";` to
`import { initLayout, reduce, type Layout } from "../layout/paneLayout";`)

```tsx
describe("TabBar — close", () => {
  it("clicking × on a 1-pane tab closes it immediately", () => {
    const layout = initLayout("/tmp/proj");
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    const x = container.querySelector(".cockpit-tab__x") as HTMLButtonElement;
    act(() => x.click());
    expect(onCloseTab).toHaveBeenCalledWith(layout.tabs[0].id);
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });

  it("clicking × on a >1-pane tab shows a confirm chip instead of closing", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    const x = container.querySelector(".cockpit-tab__x") as HTMLButtonElement;
    act(() => x.click());
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(container.querySelector(".confirm-chip")!.textContent).toContain("Close 2 sessions?");
  });

  it("Cancel in the confirm chip dismisses it without closing", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    act(() => (container.querySelector(".confirm-chip__cancel") as HTMLButtonElement).click());
    expect(onCloseTab).not.toHaveBeenCalled();
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });

  it("Close in the confirm chip calls onCloseTab", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const onCloseTab = vi.fn();
    const { container } = mount(layout, { onCloseTab });
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    act(() => (container.querySelector(".confirm-chip__go") as HTMLButtonElement).click());
    expect(onCloseTab).toHaveBeenCalledWith(layout.tabs[0].id);
  });

  it("clicking outside the confirm chip dismisses it", () => {
    const layout = reduce(initLayout("/tmp/proj"), { type: "split" });
    const { container } = mount(layout);
    act(() => (container.querySelector(".cockpit-tab__x") as HTMLButtonElement).click());
    expect(container.querySelector(".confirm-chip")).not.toBeNull();
    act(() => document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })));
    expect(container.querySelector(".confirm-chip")).toBeNull();
  });
});
```

- [ ] **Step 6: Run all TabBar tests**

Run: `npm test -- TabBar`
Expected: PASS (8 tests total across both `describe` blocks).

- [ ] **Step 7: Commit**

```bash
git add src/components/TabBar.tsx src/components/TabBar.css src/components/TabBar.test.tsx
git commit -m "feat(tabbar): hover × to close a tab, confirming first if it holds >1 pane"
```

---

## Task 4: Wire `renameTab`/`closeTab` into `CockpitView`, manual verification

**Files:**
- Modify: `src/components/CockpitView.tsx`

**Interfaces:**
- Consumes: `onRenameTab`/`onCloseTab` props from Tasks 2/3; `dispatch` (already in scope in
  `CockpitView`).
- Produces: a fully working, end-to-end feature — nothing downstream depends on this task.

- [ ] **Step 1: Pass the two new handlers to `<TabBar>`**

In `src/components/CockpitView.tsx`, change:
```tsx
        onNewTab={() => setPickerOpen(true)}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
```
to:
```tsx
        onNewTab={() => setPickerOpen(true)}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
        onRenameTab={(tabId, title) => dispatch({ type: "renameTab", tabId, title })}
        onCloseTab={(tabId) => dispatch({ type: "closeTab", tabId })}
```

- [ ] **Step 2: Full-project typecheck + test run**

Run: `npm test`
Expected: PASS — every existing suite plus the new `paneLayout.test.ts` and `TabBar.test.tsx`
cases.

Run: `npm run build`
Expected: PASS — `tsc` reports no type errors (this is the only point where the `Action` union /
prop-type changes across `paneLayout.ts`, `TabBar.tsx`, and `CockpitView.tsx` get fully
type-checked together; `vitest run` alone does not type-check).

- [ ] **Step 3: Manual verification in a browser**

Run: `npm run dev`, open the printed local URL in a browser (the app's persistence is
`localStorage`-backed — see `src/lib/persistence.ts` — so this works outside the Tauri shell for
everything except real terminal PTYs).

Check off each:
- [ ] Double-click a tab title → input appears with the text pre-selected; typing and pressing
  Enter renames it; the tab keeps that name even after clicking to a different tab and back.
- [ ] Double-click a tab, wait ~1 second (long enough for the double-rAF focus re-assertion to
  matter), then type — the keystrokes land in the rename input, not in a terminal.
- [ ] Empty the input (select-all, delete, Enter) → the tab's name reverts to its auto-derived
  name (the first pane's title).
- [ ] Reload the page → the renamed tab keeps its name (persisted via `localStorage`).
- [ ] Open a project, split it (⌘D) so the tab has 2 panes, hover the tab → × appears where the
  "2" badge was. Click it → an inline "Close 2 sessions?" chip appears in place of the tab's
  content; Cancel dismisses it; clicking elsewhere in the tab bar also dismisses it; Close removes
  the tab and both of its terminals (check no orphaned PTY — the existing teardown effect in
  `CockpitView` handles this, nothing new to verify beyond "the processes actually exit").
- [ ] Open a second, single-pane tab, hover it, click × → it closes immediately with no confirm
  chip.
- [ ] With only one tab open, hover it, click × → nothing happens (the last-tab guard).

- [ ] **Step 4: Commit**

```bash
git add src/components/CockpitView.tsx
git commit -m "feat(cockpit): wire tab rename + close into CockpitView"
```

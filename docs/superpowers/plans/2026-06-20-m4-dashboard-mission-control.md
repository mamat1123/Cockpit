# Claude Cockpit — M4: Dashboard ("Mission Control")

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** A toggleable overview (⌘0 or a tab-bar button) that lists every Claude session across all tabs as a "bay" card — name, project path, live working/idle state, which tab, last-active — and clicking a bay jumps to that pane. Matches the approved mockup (HUD, cockpit palette).

**Architecture:** Pure helper `overviewItems(layout)` flattens panes with their tab index. The Dashboard reads each pane's live activity from the terminal registry (`paneLastLineAt`) and derives working/idle via the existing `deriveState`. It renders an overlay above the panes; click → `focusTab` + `focusPane`. Terminals keep running (registry-owned) while the overlay is up.

**Tech Stack:** React/TS, vitest. Reuses the locked cockpit palette (#14161B ground, #F5A623 amber, #3ECF8E idle, mono).

**Scope:** activity/state + jump (the part buildable now). **Out:** per-bay cost (next milestone), mini terminal previews.

---

## Task 1: helpers — `overviewItems`, `paneLastLineAt`, ⌘0 keybinding (TDD where pure)

**Files:** `src/components/paneFlatten.ts` (+ `paneHost.test.ts`), `src/lib/terminalRegistry.ts`, `src/layout/useKeybindings.ts` (+ a test file).

- [ ] **Step 1 — failing test** in `src/components/paneHost.test.ts` (append):
```ts
import { overviewItems } from "./paneFlatten";

describe("overviewItems", () => {
  it("lists every pane with its 1-based tab index", () => {
    let l = initLayout("/a");
    const p0 = l.tabs[0].rows[0].panes[0];
    l = reduce({ ...l, focusedPaneId: p0.id }, { type: "split" }); // tab1: 2 panes
    l = reduce(l, { type: "newTab" });                            // tab2: 1 pane
    const items = overviewItems(l);
    expect(items.length).toBe(3);
    expect(items[0]).toMatchObject({ tabIndex: 1, tabId: l.tabs[0].id });
    expect(items[2].tabIndex).toBe(2);
    expect(typeof items[0].title).toBe("string");
    expect(typeof items[0].cwd).toBe("string");
    expect(items[0].paneId).toBe(l.tabs[0].rows[0].panes[0].id);
  });
});
```

- [ ] **Step 2** — `npx vitest run src/components/paneHost.test.ts` → fail (no `overviewItems`).

- [ ] **Step 3 — implement** in `src/components/paneFlatten.ts` (append, keep `flattenPanes`):
```ts
export interface OverviewItem { paneId: string; title: string; cwd: string; tabId: string; tabIndex: number }

/** Flat list of all panes for the dashboard, each tagged with its 1-based tab number. */
export function overviewItems(layout: Layout): OverviewItem[] {
  return layout.tabs.flatMap((t, ti) =>
    t.rows.flatMap((r) =>
      r.panes.map((p) => ({ paneId: p.id, title: p.title, cwd: p.cwd, tabId: t.id, tabIndex: ti + 1 })),
    ),
  );
}
```

- [ ] **Step 4 — registry accessor** in `src/lib/terminalRegistry.ts` (append, after `refit`):
```ts
/** Live activity timestamp for a pane (last meaningful PTY output), or null. */
export function paneLastLineAt(paneId: string): number | null {
  return registry.get(paneId)?.lastLineAt.current ?? null;
}
```

- [ ] **Step 5 — ⌘0 keybinding.** Change `src/layout/useKeybindings.ts` to accept an optional toggle callback:
```ts
import { useEffect } from "react";
import type { Action } from "./paneLayout";

/** Cmd+T new tab, Cmd+D split, Cmd+Shift+D split-down, Cmd+W close, Cmd+0 dashboard. */
export function useKeybindings(dispatch: (a: Action) => void, onToggleDashboard?: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "t") { e.preventDefault(); dispatch({ type: "newTab" }); }
      else if (k === "d") { e.preventDefault(); dispatch({ type: e.shiftKey ? "splitDown" : "split" }); }
      else if (k === "w") { e.preventDefault(); dispatch({ type: "close" }); }
      else if (k === "0") { e.preventDefault(); onToggleDashboard?.(); }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatch, onToggleDashboard]);
}
```

- [ ] **Step 6 — keybinding test.** Create `src/layout/useKeybindings.test.ts`:
```ts
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { useKeybindings } from "./useKeybindings";

function press(key: string, opts: Partial<KeyboardEventInit> = {}) {
  window.dispatchEvent(new KeyboardEvent("keydown", { key, metaKey: true, bubbles: true, cancelable: true, ...opts }));
}

describe("useKeybindings", () => {
  it("Cmd+0 toggles the dashboard; Cmd+T dispatches newTab", () => {
    const dispatch = vi.fn();
    const toggle = vi.fn();
    renderHook(() => useKeybindings(dispatch, toggle));
    press("0");
    expect(toggle).toHaveBeenCalledTimes(1);
    press("t");
    expect(dispatch).toHaveBeenCalledWith({ type: "newTab" });
  });
});
```
If `@testing-library/react` is NOT a dependency, do NOT add it — instead skip Step 6's renderHook approach and write a minimal test that calls the hook through a tiny test component using the project's existing test setup; if no React test renderer is available at all, OMIT this test file and note it in the report (the keybinding is still GUI-verified in Task 4). Check `package.json` devDependencies first.

- [ ] **Step 7** — `npm test` green; `npx tsc --noEmit` clean.
- [ ] **Step 8 — commit:** `feat(ui): overviewItems + paneLastLineAt + Cmd+0 dashboard keybinding`

---

## Task 2: Dashboard component + styles

**Files:** create `src/components/Dashboard.tsx`, `src/components/Dashboard.css`.

- [ ] **Step 1 — `Dashboard.tsx`:**
```tsx
import { useEffect, useState } from "react";
import type { Layout } from "../layout/paneLayout";
import { overviewItems } from "./paneFlatten";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import "./Dashboard.css";

function ago(last: number | null, now: number): string {
  if (last == null) return "—";
  const s = Math.round((now - last) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `~${s}s ago`;
  return `${Math.round(s / 60)}m idle`;
}

export function Dashboard({ layout, onJump, onClose }: {
  layout: Layout;
  onJump: (tabId: string, paneId: string) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { clearInterval(id); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  const items = overviewItems(layout).map((it) => {
    const last = paneLastLineAt(it.paneId);
    return { ...it, working: deriveState({ lastLineAt: last }, now, 800) === "working", when: ago(last, now) };
  });
  const workCount = items.filter((i) => i.working).length;

  return (
    <div className="cockpit-dash" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cockpit-dash__panel" role="dialog" aria-label="Mission Control">
        <div className="cockpit-dash__ribbon">
          <div className="cockpit-dash__brand">
            <h2>Mission Control</h2>
            <span>every Claude session, one glance · Esc to close</span>
          </div>
          <div className="cockpit-dash__readout">
            <div className="cockpit-dash__stat"><b>{items.length}</b><span>sessions</span></div>
            <div className="cockpit-dash__stat is-work"><b>{workCount}</b><span>working</span></div>
            <div className="cockpit-dash__stat is-idle"><b>{items.length - workCount}</b><span>idle</span></div>
          </div>
        </div>
        <div className="cockpit-dash__grid">
          {items.map((it) => (
            <button
              key={it.paneId}
              className={`cockpit-bay${it.working ? " is-working" : ""}`}
              onClick={() => onJump(it.tabId, it.paneId)}
            >
              <span className="cockpit-bay__rail" />
              <span className="cockpit-bay__body">
                <span className="cockpit-bay__top">
                  <span className="cockpit-bay__name">{it.title}</span>
                  <span className="cockpit-bay__loc">tab {it.tabIndex}</span>
                </span>
                <span className="cockpit-bay__path">{it.cwd}</span>
                <span className="cockpit-bay__status">
                  <span className="cockpit-bay__badge">
                    <span className="cockpit-bay__dot" />
                    <span className="cockpit-bay__bars"><i /><i /><i /></span>
                    {it.working ? "working" : "idle"}
                  </span>
                  <span className="cockpit-bay__when">{it.when}</span>
                </span>
                <span className="cockpit-bay__jump">↵ jump</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2 — `Dashboard.css`** (overlay + bays; cockpit palette, namespaced):
```css
.cockpit-dash {
  position: fixed; inset: 0; z-index: 50;
  background: rgba(8, 9, 12, 0.66); backdrop-filter: blur(3px);
  display: flex; justify-content: center; align-items: flex-start;
  padding: 40px clamp(16px, 5vw, 64px); overflow: auto;
  animation: cockpit-dash-in 0.14s ease;
}
@keyframes cockpit-dash-in { from { opacity: 0; } to { opacity: 1; } }
.cockpit-dash__panel { width: 100%; max-width: 1180px; }

.cockpit-dash__ribbon {
  display: flex; align-items: center; gap: 22px; flex-wrap: wrap;
  padding-bottom: 18px; margin-bottom: 24px; border-bottom: 1px solid #262A33;
}
.cockpit-dash__brand { display: flex; flex-direction: column; gap: 5px; }
.cockpit-dash__brand h2 {
  margin: 0; font: 700 15px/1 ui-monospace, Menlo, monospace;
  letter-spacing: 0.3em; text-transform: uppercase; color: #C8CDD6;
}
.cockpit-dash__brand span { font: 11.5px ui-monospace, Menlo, monospace; color: #6B7280; }
.cockpit-dash__readout { margin-left: auto; display: flex; border: 1px solid #262A33; border-radius: 9px; overflow: hidden; }
.cockpit-dash__stat { display: flex; flex-direction: column; gap: 3px; padding: 8px 16px; background: #181B22; font-family: ui-monospace, Menlo, monospace; }
.cockpit-dash__stat + .cockpit-dash__stat { border-left: 1px solid #262A33; }
.cockpit-dash__stat b { font-size: 18px; font-weight: 700; line-height: 1; color: #C8CDD6; font-variant-numeric: tabular-nums; }
.cockpit-dash__stat span { font-size: 9.5px; letter-spacing: 0.16em; text-transform: uppercase; color: #6B7280; }
.cockpit-dash__stat.is-work b { color: #F5A623; }
.cockpit-dash__stat.is-idle b { color: #3ECF8E; }

.cockpit-dash__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(248px, 1fr)); gap: 16px; }

.cockpit-bay {
  position: relative; display: flex; text-align: left; cursor: pointer;
  background: #0E1014; border: 1px solid #262A33; border-radius: 12px; overflow: hidden;
  font-family: ui-monospace, Menlo, monospace; color: #C8CDD6;
  transition: transform 0.14s ease, border-color 0.14s ease;
}
.cockpit-bay:hover { transform: translateY(-2px); border-color: #3a4150; }
.cockpit-bay:focus-visible { outline: 2px solid #F5A623; outline-offset: 2px; }
.cockpit-bay__rail { flex: 0 0 4px; align-self: stretch; background: #3ECF8E; transition: background 0.2s; }
.cockpit-bay.is-working .cockpit-bay__rail { background: #F5A623; }
.cockpit-bay__body { flex: 1; min-width: 0; padding: 14px 15px 13px; display: flex; flex-direction: column; }
.cockpit-bay__top { display: flex; align-items: baseline; gap: 8px; margin-bottom: 2px; }
.cockpit-bay__name { font-size: 15px; font-weight: 700; color: #EDEFF3; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.cockpit-bay__loc { margin-left: auto; flex: none; font-size: 10px; color: #6B7280; letter-spacing: 0.06em; }
.cockpit-bay__path { font-size: 11.5px; color: #6B7280; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-bottom: 13px; }
.cockpit-bay__status { display: flex; align-items: center; gap: 8px; }
.cockpit-bay__badge {
  display: inline-flex; align-items: center; gap: 7px; padding: 4px 10px; border-radius: 999px;
  font-size: 10px; font-weight: 700; letter-spacing: 0.14em; text-transform: uppercase;
  background: rgba(62, 207, 142, 0.1); color: #3ECF8E; border: 1px solid rgba(62, 207, 142, 0.4);
}
.cockpit-bay.is-working .cockpit-bay__badge { background: rgba(245, 166, 35, 0.12); color: #F5A623; border-color: rgba(245, 166, 35, 0.5); }
.cockpit-bay__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.cockpit-bay__bars { display: none; gap: 2px; align-items: flex-end; height: 10px; }
.cockpit-bay__bars i { width: 2.5px; background: currentColor; border-radius: 1px; animation: cockpit-bay-eq 0.9s ease-in-out infinite; }
.cockpit-bay__bars i:nth-child(2) { animation-delay: 0.15s; } .cockpit-bay__bars i:nth-child(3) { animation-delay: 0.3s; }
@keyframes cockpit-bay-eq { 0%, 100% { height: 3px; } 50% { height: 10px; } }
.cockpit-bay.is-working .cockpit-bay__badge .cockpit-bay__dot { display: none; }
.cockpit-bay.is-working .cockpit-bay__badge .cockpit-bay__bars { display: flex; }
.cockpit-bay__when { margin-left: auto; font-size: 10.5px; color: #6B7280; font-variant-numeric: tabular-nums; }
.cockpit-bay.is-working .cockpit-bay__when { color: #a9803a; }
.cockpit-bay.is-working { box-shadow: inset 0 0 0 1px rgba(245, 166, 35, 0.18); }
.cockpit-bay.is-working::after { content: ""; position: absolute; inset: 0; border-radius: 12px; pointer-events: none; animation: cockpit-bay-breathe 2.4s ease-in-out infinite; }
@keyframes cockpit-bay-breathe { 0%, 100% { box-shadow: inset 0 0 24px -6px rgba(245, 166, 35, 0.16); } 50% { box-shadow: inset 0 0 40px -2px rgba(245, 166, 35, 0.32); } }
.cockpit-bay__jump { position: absolute; right: 12px; bottom: 11px; font-size: 10px; letter-spacing: 0.1em; color: #F5A623; opacity: 0; transition: opacity 0.14s; }
.cockpit-bay:hover .cockpit-bay__jump { opacity: 1; }

@media (prefers-reduced-motion: reduce) { .cockpit-dash, .cockpit-bay__bars i, .cockpit-bay.is-working::after { animation: none; } }
```

- [ ] **Step 3** — `npx tsc --noEmit` clean (Dashboard internal types). `npm test` still green.
- [ ] **Step 4 — commit:** `feat(ui): Dashboard (Mission Control) overlay component`

---

## Task 3: wire into CockpitView + TabBar button

**Files:** `src/components/CockpitView.tsx`, `src/components/TabBar.tsx`.

- [ ] **Step 1 — CockpitView:** add dashboard state + render. Add imports `import { useCallback, useState } from "react";` (merge with existing react import) and `import { Dashboard } from "./Dashboard";`. Inside the component:
```tsx
  const [dashOpen, setDashOpen] = useState(false);
  const toggleDash = useCallback(() => setDashOpen((o) => !o), []);
```
Change `useKeybindings(dispatch);` → `useKeybindings(dispatch, toggleDash);`. Pass `onOpenDashboard={() => setDashOpen(true)}` to `<TabBar .../>`. After the panes `<div>` (and alongside `<PaneHost .../>`), add:
```tsx
      {dashOpen && (
        <Dashboard
          layout={layout}
          onClose={() => setDashOpen(false)}
          onJump={(tabId, paneId) => {
            dispatch({ type: "focusTab", tabId });
            dispatch({ type: "focusPane", paneId });
            setDashOpen(false);
          }}
        />
      )}
```
(`slotCbs`/registerSlot etc. unchanged.)

- [ ] **Step 2 — TabBar:** add an `onOpenDashboard: () => void` prop and a button before the `+` new-tab button:
```tsx
      <button className="cockpit-tab cockpit-tab--new" onClick={onOpenDashboard} aria-label="Mission Control (Cmd+0)" title="Mission Control (⌘0)">▦</button>
```
Add `onOpenDashboard` to the `TabBar` props type.

- [ ] **Step 3** — `npx tsc --noEmit` clean; `npm test` green.
- [ ] **Step 4 — commit:** `feat(ui): toggle Dashboard from Cmd+0 and a tab-bar button; jump-to-pane on click`

---

## Task 4: GUI verification (owner)

- [ ] `npm run tauri dev` (frontend-only changes → HMR, but a fresh load is cleanest):
1. Open a few panes across tabs, run claude in some. Press **⌘0** (or the **▦** tab-bar button) → Mission Control overlay appears.
2. Each session shows as a bay: name, repo path, **tab N**, and a live **working/idle** badge that matches the pane's real state (talk to a claude → its bay flips to amber "working" + breathes; goes green "idle" when done). Counts in the ribbon update.
3. **Click a bay** → overlay closes and the app jumps to that tab + focuses that pane.
4. **Esc** or clicking the dim backdrop closes it. ⌘0 toggles.
5. Regressions: pop-out, drag-drop, resize, names all still work.

Report pass/fail.

- [ ] **Wrap-up:** update `SPEC.md` status (Dashboard done); commit `docs: M4 dashboard done`.

---

## Self-review
**Spec coverage:** overview of all sessions w/ live state (Task 2 + registry accessor Task 1), jump-to-pane (Task 3 onJump), ⌘0 + button toggle (Task 1 keybinding + Task 3). Cost deferred (stated). Pure helper TDD'd; UI owner-verified.
**Placeholder scan:** none — full code in every step.
**Type consistency:** `overviewItems`→`OverviewItem{paneId,title,cwd,tabId,tabIndex}` consumed in Dashboard; `paneLastLineAt(paneId)` matches registry; `useKeybindings(dispatch, onToggleDashboard?)` matches CockpitView call; `Dashboard{layout,onJump,onClose}` and `TabBar onOpenDashboard` consistent.
**Risk:** `@testing-library/react` may be absent — Task 1 Step 6 has a documented fallback (omit the hook test; keybinding is GUI-verified).

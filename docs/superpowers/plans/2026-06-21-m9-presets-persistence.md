# Claude Cockpit — M9: Presets (workspaces) + auto-restore

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:**
- **B (auto-restore):** the layout (panes/tabs/splits) is remembered and restored on next launch — each pane resumes its prior claude session (`claude --resume <id>`), so your conversations come back.
- **A (named presets):** save the current arrangement as a named workspace; load it any time to recreate that repo/split layout with **fresh** claude sessions. Manage via a ⊞ Workspaces menu (tab bar) / ⌘E.

**Architecture:** Pure `serializeLayout`/`deserializeLayout` (structure + cwd/title/size; sessionId kept for auto-restore, dropped for presets so loading a preset starts fresh). `localStorage` holds `cockpit.lastLayout.v1` (auto-saved, with sessions) + `cockpit.presets.v1` (named, without sessions). CockpitView inits from last-layout, debounce-saves on change, and a `loadLayout` action swaps the whole layout (existing cleanup kills the old panes' PTYs).

**Tech Stack:** React 19 · localStorage · vitest.

---

## Task 1: model — serialize/deserialize + `loadLayout` (TDD)

**Files:** modify `src/layout/paneLayout.ts` (+ test).

- [ ] **Step 1: failing tests** — append to `src/layout/paneLayout.test.ts`:
```ts
import { serializeLayout, deserializeLayout } from "./paneLayout";

describe("serialize/deserialize", () => {
  it("round-trips structure + cwd/size, fresh ids", () => {
    let l = initLayout(CWD);
    l = reduce({ ...l, focusedPaneId: l.tabs[0].rows[0].panes[0].id }, { type: "split" });
    l = reduce(l, { type: "newTab", cwd: "/two" });
    const saved = serializeLayout(l, false);
    const back = deserializeLayout(saved);
    expect(back.tabs.length).toBe(2);
    expect(back.tabs[0].rows[0].panes.length).toBe(2);
    expect(back.tabs[1].rows[0].panes[0].cwd).toBe("/two");
    // ids regenerated (not equal to originals)
    expect(back.tabs[0].id).not.toBe(l.tabs[0].id);
  });
  it("drops sessionId (fresh) when keepSessions=false → resume false", () => {
    const l = initLayout(CWD);
    const back = deserializeLayout(serializeLayout(l, false));
    const p = back.tabs[0].rows[0].panes[0];
    expect(p.resume).toBe(false);
    expect(p.sessionId).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.sessionId).not.toBe(l.tabs[0].rows[0].panes[0].sessionId);
  });
  it("keeps sessionId + resume when keepSessions=true", () => {
    const l = initLayout(CWD);
    const orig = l.tabs[0].rows[0].panes[0].sessionId;
    const back = deserializeLayout(serializeLayout(l, true));
    const p = back.tabs[0].rows[0].panes[0];
    expect(p.sessionId).toBe(orig);
    expect(p.resume).toBe(true);
  });
  it("loadLayout action replaces the whole layout", () => {
    const saved = serializeLayout(initLayout("/x"), false);
    const l2 = reduce(initLayout(CWD), { type: "loadLayout", saved });
    expect(l2.tabs[0].rows[0].panes[0].cwd).toBe("/x");
  });
});
```

- [ ] **Step 2: run → fail.** Step 3: implement in `src/layout/paneLayout.ts`:
```ts
export interface SavedPane { cwd: string; title: string; autoTitle: boolean; size: number; sessionId?: string }
export interface SavedRow { size: number; panes: SavedPane[] }
export interface SavedTab { rows: SavedRow[] }
export interface SavedLayout { tabs: SavedTab[]; activeTabIndex: number }

export function serializeLayout(l: Layout, keepSessions: boolean): SavedLayout {
  return {
    activeTabIndex: Math.max(0, l.tabs.findIndex((t) => t.id === l.activeTabId)),
    tabs: l.tabs.map((t) => ({
      rows: t.rows.map((r) => ({
        size: r.size,
        panes: r.panes.map((p) => ({
          cwd: p.cwd, title: p.title, autoTitle: p.autoTitle, size: p.size,
          ...(keepSessions ? { sessionId: p.sessionId } : {}),
        })),
      })),
    })),
  };
}

export function deserializeLayout(s: SavedLayout): Layout {
  const tabs: Tab[] = s.tabs.map((t) => ({
    id: nextId("tab"),
    rows: t.rows.map((r) => ({
      id: nextId("row"), size: r.size,
      panes: r.panes.map((p) => ({
        id: nextId("pane"), cwd: p.cwd, size: p.size, title: p.title, autoTitle: p.autoTitle,
        sessionId: p.sessionId ?? crypto.randomUUID(), resume: !!p.sessionId,
      })),
    })),
  }));
  const idx = Math.min(Math.max(0, s.activeTabIndex), tabs.length - 1);
  const active = tabs[idx];
  return { tabs, activeTabId: active.id, focusedPaneId: active.rows[0].panes[0].id };
}
```
  - add to `Action`: `| { type: "loadLayout"; saved: SavedLayout }`
  - add case: `case "loadLayout": return deserializeLayout(a.saved);`

- [ ] **Step 4: run → pass; tsc clean.** Step 5: commit — `feat(layout): serialize/deserialize layout + loadLayout action`

---

## Task 2: persistence (localStorage) (TDD)

**Files:** create `src/lib/persistence.ts` (+ test).

- [ ] **Step 1: failing test** `src/lib/persistence.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { saveLast, loadLast, getPresets, savePreset, deletePreset } from "./persistence";
import type { SavedLayout } from "../layout/paneLayout";

const fake: SavedLayout = { activeTabIndex: 0, tabs: [{ rows: [{ size: 1, panes: [{ cwd: "/a", title: "a", autoTitle: true, size: 1 }] }] }] };

describe("persistence", () => {
  beforeEach(() => localStorage.clear());
  it("saveLast/loadLast round-trip", () => { saveLast(fake); expect(loadLast()).toEqual(fake); });
  it("loadLast is null when empty", () => { expect(loadLast()).toBeNull(); });
  it("savePreset / getPresets / deletePreset", () => {
    savePreset("work", fake);
    expect(getPresets().work).toEqual(fake);
    deletePreset("work");
    expect(getPresets().work).toBeUndefined();
  });
});
```

- [ ] **Step 2: run → fail.** Step 3: implement `src/lib/persistence.ts`:
```ts
import type { SavedLayout } from "../layout/paneLayout";

const LAST = "cockpit.lastLayout.v1";
const PRESETS = "cockpit.presets.v1";

export function saveLast(s: SavedLayout): void {
  try { localStorage.setItem(LAST, JSON.stringify(s)); } catch { /* ignore */ }
}
export function loadLast(): SavedLayout | null {
  try { const r = localStorage.getItem(LAST); return r ? (JSON.parse(r) as SavedLayout) : null; } catch { return null; }
}
export function getPresets(): Record<string, SavedLayout> {
  try { const r = localStorage.getItem(PRESETS); return r ? (JSON.parse(r) as Record<string, SavedLayout>) : {}; } catch { return {}; }
}
export function savePreset(name: string, s: SavedLayout): void {
  const all = getPresets(); all[name] = s;
  try { localStorage.setItem(PRESETS, JSON.stringify(all)); } catch { /* ignore */ }
}
export function deletePreset(name: string): void {
  const all = getPresets(); delete all[name];
  try { localStorage.setItem(PRESETS, JSON.stringify(all)); } catch { /* ignore */ }
}
```

- [ ] **Step 4: run → pass.** Step 5: commit — `feat(lib): localStorage persistence for last layout + named presets`

---

## Task 3: auto-restore (B) wiring

**Files:** modify `src/components/CockpitView.tsx`.

- [ ] **Step 1:** imports — `import { reduce, initLayout, findPaneBySession, serializeLayout, deserializeLayout, type Layout } from "../layout/paneLayout";` and `import { loadLast, saveLast } from "../lib/persistence";`.

- [ ] **Step 2:** change the reducer init to restore the last layout:
```tsx
  const [layout, dispatch] = useReducer(reduce, null, () => {
    const last = loadLast();
    if (last && last.tabs && last.tabs.length > 0) {
      try { return deserializeLayout(last); } catch { /* fall through */ }
    }
    return initLayout(DEFAULT_CWD);
  });
```
(`useReducer(reduce, null, initFn)` — the 2nd arg is ignored by the initializer.)

- [ ] **Step 3:** debounce-save the layout on every change (add near the other effects):
```tsx
  useEffect(() => {
    const id = setTimeout(() => saveLast(serializeLayout(layout, true)), 600);
    return () => clearTimeout(id);
  }, [layout]);
```

- [ ] **Step 4:** `npx tsc --noEmit` clean; `npm test` green. Do NOT run tauri dev.
- [ ] **Step 5: commit** — `feat(ui): auto-restore the last layout on launch (resumes each pane's session)`

---

## Task 4: presets UI (A) — Workspaces menu

**Files:** create `src/components/WorkspacesMenu.tsx`, `src/components/WorkspacesMenu.css`; modify `src/layout/useKeybindings.ts`, `src/components/CockpitView.tsx`, `src/components/TabBar.tsx`.

- [ ] **Step 1: `WorkspacesMenu.tsx`:**
```tsx
import { useEffect, useState } from "react";
import { getPresets, savePreset, deletePreset } from "../lib/persistence";
import type { SavedLayout } from "../layout/paneLayout";
import "./WorkspacesMenu.css";

export function WorkspacesMenu({ onLoad, onSaveCurrent, onClose }: {
  onLoad: (saved: SavedLayout) => void;
  onSaveCurrent: (name: string) => void; // serializes current layout in the parent
  onClose: () => void;
}) {
  const [presets, setPresets] = useState<Record<string, SavedLayout>>({});
  const [name, setName] = useState("");
  const refresh = () => setPresets(getPresets());
  useEffect(() => { refresh(); }, []);
  const names = Object.keys(presets).sort();
  const save = () => { const n = name.trim(); if (!n) return; onSaveCurrent(n); setName(""); refresh(); };

  return (
    <div className="ws" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="ws__panel" role="dialog" aria-label="Workspaces">
        <div className="ws__save">
          <input
            className="ws__input" autoFocus placeholder="Save current layout as…" value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); else if (e.key === "Escape") onClose(); }}
          />
          <button className="ws__savebtn" onClick={save} disabled={!name.trim()}>Save</button>
        </div>
        <div className="ws__list">
          {names.length === 0 ? (
            <p className="ws__empty">No workspaces yet. Arrange your panes, then save one above.</p>
          ) : (
            names.map((n) => (
              <div key={n} className="ws__row">
                <button className="ws__load" onClick={() => { onLoad(presets[n]); }}>
                  <span className="ws__name">{n}</span>
                  <span className="ws__meta">{presets[n].tabs.reduce((a, t) => a + t.rows.reduce((b, r) => b + r.panes.length, 0), 0)} panes · {presets[n].tabs.length} tabs</span>
                </button>
                <button className="ws__del" title="Delete" onClick={() => { deletePreset(n); refresh(); }}>✕</button>
              </div>
            ))
          )}
        </div>
        <div className="ws__foot">load a workspace to switch · current sessions close</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `WorkspacesMenu.css`:**
```css
.ws { position: fixed; inset: 0; z-index: 60; background: rgba(8,9,12,.6); backdrop-filter: blur(3px);
  display: flex; justify-content: center; align-items: flex-start; padding-top: 12vh; animation: ws-in .12s ease; }
@keyframes ws-in { from { opacity: 0; } to { opacity: 1; } }
.ws__panel { width: min(520px, 92vw); background: #0E1014; border: 1px solid #2A2F3A; border-radius: 14px;
  box-shadow: 0 24px 60px -12px rgba(0,0,0,.6); overflow: hidden; font-family: ui-monospace, Menlo, monospace; }
.ws__save { display: flex; gap: 8px; padding: 14px; border-bottom: 1px solid #262A33; background: #14161B; }
.ws__input { flex: 1; box-sizing: border-box; background: #0E1014; border: 1px solid #262A33; border-radius: 8px;
  color: #EDEFF3; font: 13px ui-monospace, Menlo, monospace; padding: 9px 11px; outline: none; }
.ws__input:focus { border-color: #F5A623; }
.ws__savebtn { font-family: inherit; font-size: 12px; font-weight: 700; color: #1a1206; background: #F5A623;
  border: 0; border-radius: 8px; padding: 0 14px; cursor: pointer; }
.ws__savebtn:disabled { opacity: .4; cursor: default; }
.ws__list { max-height: 320px; overflow-y: auto; padding: 6px; }
.ws__row { display: flex; align-items: center; gap: 4px; }
.ws__load { flex: 1; display: flex; flex-direction: column; gap: 3px; text-align: left; background: transparent;
  border: 0; border-radius: 9px; padding: 10px 12px; cursor: pointer; }
.ws__load:hover { background: #1b2029; }
.ws__name { color: #EDEFF3; font-size: 13px; font-weight: 600; }
.ws__load:hover .ws__name { color: #F5A623; }
.ws__meta { color: #6B7280; font-size: 11px; }
.ws__del { background: transparent; border: 0; color: #565d68; font-size: 12px; width: 28px; height: 28px;
  border-radius: 7px; cursor: pointer; }
.ws__del:hover { background: #222732; color: #C8CDD6; }
.ws__empty { color: #6B7280; font-size: 12.5px; padding: 18px; }
.ws__foot { border-top: 1px solid #262A33; padding: 9px 14px; color: #565d68; font-size: 11px; }
```

- [ ] **Step 3: useKeybindings** — refactor to an options object so ⌘E fits cleanly:
  - signature → `export function useKeybindings(dispatch: (a: Action) => void, opts: { onToggleDashboard?: () => void; onOpenProject?: () => void; onOpenWorkspaces?: () => void } = {}) {`
  - replace the `onToggleDashboard?.()` / `onOpenProject?.()` calls with `opts.onToggleDashboard?.()` / `opts.onOpenProject?.()`, and add `else if (k === "e") { e.preventDefault(); opts.onOpenWorkspaces?.(); }`
  - deps → `[dispatch, opts.onToggleDashboard, opts.onOpenProject, opts.onOpenWorkspaces]`

- [ ] **Step 4: CockpitView** — wire it:
  - `import { WorkspacesMenu } from "./WorkspacesMenu";` and `import { savePreset } from "../lib/persistence";`
  - `const [wsOpen, setWsOpen] = useState(false);`
  - update the keybindings call → `useKeybindings(dispatch, { onToggleDashboard: toggleDash, onOpenProject: () => setPickerOpen(true), onOpenWorkspaces: () => setWsOpen(true) });`
  - pass `onOpenWorkspaces={() => setWsOpen(true)}` to `<TabBar />`.
  - render (alongside the picker block):
```tsx
      {wsOpen && (
        <WorkspacesMenu
          onClose={() => setWsOpen(false)}
          onLoad={(saved) => { dispatch({ type: "loadLayout", saved }); setWsOpen(false); }}
          onSaveCurrent={(name) => savePreset(name, serializeLayout(layout, false))}
        />
      )}
```

- [ ] **Step 5: TabBar** — add `onOpenWorkspaces: () => void;` to props + destructure; add a button next to the ▦ dashboard button:
```tsx
      <button className="cockpit-tab cockpit-tab--new" onClick={onOpenWorkspaces} aria-label="Workspaces (Cmd+E)" title="Workspaces (⌘E)">⊞</button>
```

- [ ] **Step 6:** `npx tsc --noEmit` clean; `npm test` green; `npm run build` ok.
- [ ] **Step 7: commit** — `feat(ui): Workspaces menu — save/load/delete named layout presets (Cmd+E)`

---

## Task 5: GUI verification (owner)

- [ ] `npm run tauri dev`:
1. **Auto-restore:** open a few panes/tabs across repos, chat a bit, quit the app, relaunch → the same panes/tabs come back and each pane resumes its conversation.
2. **Save preset:** arrange a layout → **⊞** (or ⌘E) → type a name → Save. → **Load** it later → that arrangement opens (fresh claude per pane); current sessions close.
3. **Delete** a preset with ✕.
4. Regressions: project picker (+/⌘O), dashboard (⌘0), cost, pop-out, drag, resize all fine.

Report pass/fail.

- [ ] **Wrap-up:** SPEC.md (presets + persistence done); commit `docs: M9 done`.

---

## Self-review
**Spec coverage:** B auto-restore (Task 1 serialize-with-sessions + Task 3 init/save) → resumes sessions; A named presets (Task 1 serialize-without-sessions + Task 2 storage + Task 4 menu + `loadLayout`). Loading replaces layout; existing CockpitView cleanup kills old PTYs.
**Placeholder scan:** none.
**Type consistency:** `SavedLayout/SavedTab/SavedRow/SavedPane`, `serializeLayout(l,keepSessions)`, `deserializeLayout(s)`, `loadLayout` action, persistence fns, `useKeybindings(dispatch, opts)`, `WorkspacesMenu{onLoad,onSaveCurrent,onClose}`, `TabBar.onOpenWorkspaces` consistent.
**Caveats:** auto-restore resumes ALL panes' sessions on launch (N claude --resume); a session deleted from disk → that pane shows a resume error (recoverable). Presets store cwd/structure only (fresh sessions on load). localStorage is per-webview (fine for a single desktop app).

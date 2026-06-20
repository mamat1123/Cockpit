# Claude Cockpit — M3c: Pane Header (name + status + pop-out + drag-to-move) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** Each terminal pane gets a header (design B): an editable **name** (default = cwd basename, double-click to rename), the working/idle **status** chip (moved into the header), a **pop-out ↗** button (move this pane into a new tab), and a **✕** close. The header is also a **drag handle** — drag a pane by its header and drop it onto another pane to reposition it.

**Architecture:** Add `title` to `Pane` + reducer actions `renamePane`, `popOut`, `movePaneAfter`. A `PaneHeader` component renders the header B; `TerminalPane` renders it above the xterm and stops driving its own floating chip. Pane drag-and-drop uses HTML5 DnD on the header (dataTransfer = paneId; drop target = another pane → `movePaneAfter`).

**Tech Stack:** React/TS · HTML5 drag-and-drop · vitest (reducer TDD)

---

## Scope (M3c)
**In:** header B per pane (name/status/pop-out/close); rename; pop-out to new tab; drag a pane by its header to reposition (drop onto another pane → move after it, within the active tab). **Out:** cross-tab pane drag (use pop-out + reorder), drop-zone previews/animations, persistence of names.

**Decisions (Ghostty-ish, adjustable):** double-click name to edit (Enter/blur commits, Esc cancels). Pop-out always makes a fresh tab. Drop onto a pane inserts the dragged pane immediately after it in that pane's row.

---

## Task 1: Model — `title` + renamePane / popOut / movePaneAfter (TDD)

**Files:** modify `src/layout/paneLayout.ts` + `src/layout/paneLayout.test.ts`.

- [ ] **Step 1: failing tests** (append inside the existing `describe`):
```ts
  it("a pane has a default title from its cwd basename", () => {
    const l = initLayout(CWD); // .../mee-tang/app
    expect(l.tabs[0].rows[0].panes[0].title).toBe("app");
  });
  it("renamePane sets a custom title", () => {
    let l = initLayout(CWD);
    const id = l.focusedPaneId;
    l = reduce(l, { type: "renamePane", paneId: id, title: "frontend" });
    expect(l.tabs[0].rows[0].panes[0].title).toBe("frontend");
  });
  it("popOut moves a pane into a brand-new active tab", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });          // tab0: 1 row, 2 panes
    const moved = l.focusedPaneId;
    l = reduce(l, { type: "popOut", paneId: moved });
    expect(l.tabs.length).toBe(2);
    expect(l.tabs[0].rows[0].panes.length).toBe(1);            // left behind
    expect(l.tabs[1].rows[0].panes.map((p) => p.id)).toEqual([moved]);
    expect(l.activeTabId).toBe(l.tabs[1].id);
    expect(l.focusedPaneId).toBe(moved);
  });
  it("movePaneAfter reorders within a row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "split" });          // panes [A, B], focus B
    const [A, B] = l.tabs[0].rows[0].panes.map((p) => p.id);
    l = reduce(l, { type: "movePaneAfter", paneId: A, targetPaneId: B });
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([B, A]);
  });
  it("movePaneAfter across rows moves the pane and drops the emptied row", () => {
    let l = initLayout(CWD);
    l = reduce(l, { type: "splitDown" });       // row1:[A], row2:[B], focus B
    const A = l.tabs[0].rows[0].panes[0].id;
    const B = l.tabs[0].rows[1].panes[0].id;
    l = reduce(l, { type: "movePaneAfter", paneId: B, targetPaneId: A });
    expect(l.tabs[0].rows.length).toBe(1);
    expect(l.tabs[0].rows[0].panes.map((p) => p.id)).toEqual([A, B]);
  });
```

- [ ] **Step 2: `npm run test` → 5 new fail.**

- [ ] **Step 3: implement** in `paneLayout.ts`:
  - Add `title: string` to `Pane`. Add a helper `const defaultTitle = (cwd: string) => cwd.split("/").filter(Boolean).pop() ?? "shell";` and set `title: defaultTitle(cwd)` in `makePane`.
  - Add a shared remover above `reduce`:
```ts
function removePane(tabs: Tab[], paneId: string): { tabs: Tab[]; pane: Pane | null } {
  let pane: Pane | null = null;
  const out = tabs
    .map((t) => ({
      ...t,
      rows: t.rows
        .map((r) => {
          const hit = r.panes.find((p) => p.id === paneId);
          if (hit) pane = hit;
          return { ...r, panes: r.panes.filter((p) => p.id !== paneId) };
        })
        .filter((r) => r.panes.length > 0),
    }))
    .filter((t) => t.rows.length > 0);
  return { tabs: out, pane };
}
```
  - Extend `Action`:
```ts
  | { type: "renamePane"; paneId: string; title: string }
  | { type: "popOut"; paneId: string }
  | { type: "movePaneAfter"; paneId: string; targetPaneId: string }
```
  - Add cases:
```ts
    case "renamePane": {
      const tabs = l.tabs.map((t) => ({
        ...t,
        rows: t.rows.map((r) => ({
          ...r,
          panes: r.panes.map((p) => (p.id === a.paneId ? { ...p, title: a.title } : p)),
        })),
      }));
      return { ...l, tabs };
    }
    case "popOut": {
      const { tabs, pane } = removePane(l.tabs, a.paneId);
      if (!pane) return l;
      const tab: Tab = { id: nextId("tab"), rows: [{ id: nextId("row"), panes: [pane], size: 1 }] };
      return { tabs: [...tabs, tab], activeTabId: tab.id, focusedPaneId: pane.id };
    }
    case "movePaneAfter": {
      if (a.paneId === a.targetPaneId) return l;
      const { tabs, pane } = removePane(l.tabs, a.paneId);
      if (!pane) return l;
      let destTabId = l.activeTabId;
      const out = tabs.map((t) => {
        const rows = t.rows.map((r) => {
          const idx = r.panes.findIndex((p) => p.id === a.targetPaneId);
          if (idx < 0) return r;
          destTabId = t.id;
          const panes = [...r.panes];
          panes.splice(idx + 1, 0, pane);
          return { ...r, panes };
        });
        return { ...t, rows };
      });
      // if the target vanished (shouldn't happen), no-op safety
      if (!out.some((t) => t.rows.some((r) => r.panes.some((p) => p.id === a.paneId)))) return l;
      return { ...l, tabs: out, activeTabId: destTabId, focusedPaneId: pane.id };
    }
```
  Note: `removePane` also runs on `popOut`/`movePaneAfter`; the existing `close` case can stay as-is (it has its own logic) — do NOT refactor it here.

- [ ] **Step 4: `npm run test` → all pass (19). `npx tsc --noEmit` clean.** Commit — `feat(layout): pane title + renamePane/popOut/movePaneAfter` *(no AI attribution — all tasks)*

---

## Task 2: PaneHeader component + integrate into TerminalPane

**Files:** create `src/components/PaneHeader.tsx` + `src/components/PaneHeader.css`; modify `src/components/TerminalPane.tsx`; modify `src/components/TabPanes.tsx` (pass new props).

- [ ] **Step 1: PaneHeader.tsx** (header B — editable name, status chip, pop-out, close; the header is also the drag handle, wired in Task 3 via props):
```tsx
import { useState } from "react";
import "./PaneHeader.css";

export function PaneHeader({ title, working, onRename, onPopOut, onClose, dragProps }: {
  title: string;
  working: boolean;
  onRename: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(title);
  const commit = () => { setEditing(false); const t = draft.trim(); if (t && t !== title) onRename(t); else setDraft(title); };
  return (
    <div className="pane-head" {...dragProps}>
      {editing ? (
        <input
          className="pane-head__input"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") { setDraft(title); setEditing(false); }
          }}
        />
      ) : (
        <span className="pane-head__name" onDoubleClick={() => { setDraft(title); setEditing(true); }} title="ดับเบิลคลิกเพื่อเปลี่ยนชื่อ">
          {title}
        </span>
      )}
      <span className={`pane-head__chip${working ? " is-working" : ""}`}>
        <span className="pane-head__dot" />
        <span className="pane-head__bars"><i /><i /><i /></span>
        <span className="pane-head__lbl">{working ? "working" : "idle"}</span>
      </span>
      <button className="pane-head__btn" onClick={onPopOut} aria-label="เปิดในแท็บใหม่" title="เปิดในแท็บใหม่">↗</button>
      <button className="pane-head__btn" onClick={onClose} aria-label="ปิด" title="ปิด">✕</button>
    </div>
  );
}
```

- [ ] **Step 2: PaneHeader.css**:
```css
.pane-head { display: flex; align-items: center; gap: 8px; height: 30px; padding: 0 6px 0 10px;
  background: #181B22; border-bottom: 1px solid #262A33; font: 600 12px/1 ui-monospace, Menlo, monospace;
  flex: 0 0 30px; user-select: none; }
.pane-head__name { color: #C8CDD6; padding: 3px 6px; border-radius: 6px; cursor: grab; overflow: hidden;
  text-overflow: ellipsis; white-space: nowrap; }
.pane-head__name:hover { background: #222732; }
.pane-head__input { font: inherit; color: #F5F2EC; background: #0E1014; border: 1px solid #F5A623;
  border-radius: 6px; padding: 2px 6px; min-width: 80px; outline: none; }
.pane-head__chip { margin-left: auto; display: flex; align-items: center; gap: 6px; padding: 3px 9px;
  border-radius: 999px; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700;
  background: rgba(62,207,142,.10); color: #3ECF8E; border: 1px solid rgba(62,207,142,.4); }
.pane-head__chip.is-working { background: rgba(245,166,35,.13); color: #F5A623; border-color: rgba(245,166,35,.5);
  box-shadow: 0 0 14px -4px rgba(245,166,35,.6); }
.pane-head__dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
.pane-head__bars { display: none; gap: 2px; align-items: flex-end; height: 9px; }
.pane-head__bars i { width: 2px; background: currentColor; border-radius: 1px; animation: pane-eq .9s ease-in-out infinite; }
.pane-head__bars i:nth-child(2) { animation-delay: .15s; } .pane-head__bars i:nth-child(3) { animation-delay: .3s; }
@keyframes pane-eq { 0%,100% { height: 3px; } 50% { height: 9px; } }
.pane-head__chip.is-working .pane-head__dot { display: none; }
.pane-head__chip.is-working .pane-head__bars { display: flex; }
.pane-head__btn { color: #6B7280; background: transparent; border: 0; width: 24px; height: 24px;
  border-radius: 6px; cursor: pointer; font-size: 13px; }
.pane-head__btn:hover { background: #222732; color: #C8CDD6; }
@media (prefers-reduced-motion: reduce) { .pane-head__bars i { animation: none; height: 6px; } }
```

- [ ] **Step 3: TerminalPane.tsx** — render the header, drop the floating chip/vignette overlay’s chip:
  - New props: `title: string; onRename: (t: string) => void; onPopOut: () => void; onClose: () => void; dragProps?: ...` (keep `paneId, cwd, focused, onFocus`).
  - Root stays `.cockpit-pane` (+ `is-working`/`is-focused`), now a **flex column**: `<PaneHeader .../>` then `<div ref={hostRef} className="cockpit-pane__host" />` then keep `.cockpit-pane__vignette`. REMOVE the old `.cockpit-chip` span block (the chip now lives in the header).
  - In `TerminalPane.css`: change `.cockpit-pane` to `display:flex; flex-direction:column;` (keep position:relative, flex:1 1 0, min-width:0) and ensure `.cockpit-pane__host { flex:1; min-height:0; }`. Delete the now-unused `.cockpit-chip*` rules (optional cleanup; leaving them is harmless).
  - Pass `working={state === "working"}` to PaneHeader.

- [ ] **Step 4: TabPanes.tsx** — supply the new props to `<TerminalPane>`: `title={p.title}`, `onRename={(t)=>dispatch({type:"renamePane",paneId:p.id,title:t})}`, `onPopOut={()=>dispatch({type:"popOut",paneId:p.id})}`, `onClose={()=>{ dispatch({type:"focusPane",paneId:p.id}); dispatch({type:"close"}); }}`. (dragProps added in Task 3.)

- [ ] **Step 5: `npx tsc --noEmit` clean; `npm run test` green. Commit** — `feat(ui): per-pane header (name, status, pop-out, close)`

---

## Task 3: Drag a pane by its header to reposition

**Files:** modify `src/components/TabPanes.tsx` (build `dragProps`), pass into `TerminalPane` → `PaneHeader`.

- [ ] **Step 1:** In `RowPanes` (inside TabPanes.tsx), give each pane HTML5-DnD drag props on its header via the `dragProps` prop:
```tsx
            dragProps={{
              draggable: true,
              onDragStart: (e) => e.dataTransfer.setData("text/plain", p.id),
              onDragOver: (e) => e.preventDefault(),
              onDrop: (e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain");
                if (fromId && fromId !== p.id) dispatch({ type: "movePaneAfter", paneId: fromId, targetPaneId: p.id });
              },
            }}
```
  Thread `dragProps` through `TerminalPane` to `PaneHeader` (TerminalPane just forwards it). The header becomes the drag handle (cursor `grab` is already on `.pane-head__name`; add `cursor: grab` to `.pane-head` too so the whole bar grabs).

- [ ] **Step 2:** Add to `PaneHeader.css`: `.pane-head { cursor: grab; } .pane-head:active { cursor: grabbing; }` (the editable input + buttons keep their own cursors since they're interactive). Ensure the rename `<input>` and buttons aren't draggable-blocked — they work because the drag starts on the header bar; clicking a button/input still fires their handlers.

- [ ] **Step 3: `npx tsc --noEmit` clean; `npm run test` green. Commit** — `feat(ui): drag a pane by its header to reposition it`

---

## Task 4: GUI verification (owner)

- [ ] `npm run tauri dev`:
1. Each pane shows a header: name (cwd basename) + status chip (working/idle, matches the dot behavior) + ↗ + ✕.
2. **Double-click the name** → edit → type "frontend" → Enter → renames; Esc cancels.
3. **↗** → that pane pops into a NEW tab (and is removed from where it was); tab bar shows the new tab.
4. **✕** → closes that pane (last-pane rule still holds).
5. **Drag a pane by its header** onto another pane → the dragged pane moves next to it (reorder within a row / move across rows). Sessions stay alive (stable keys).
6. Regressions: resize dividers still work; working/idle still correct; Cmd+T/D/Shift+D/W still work.

Report pass/fail.

- [ ] **Wrap-up:** update `SPEC.md`; commit `docs: M3c done — pane headers, pop-out, drag-to-move`.

---

## Self-review
**Spec coverage:** name+status header (Task 2), pop-out icon → new tab (Task 1 `popOut` + Task 2 button), drag-by-header reposition (Task 1 `movePaneAfter` + Task 3 DnD), editable name (Task 1 `renamePane` + Task 2 input). Reducer TDD'd; UI owner-verified. Cross-tab drag + name persistence out.
**Placeholder scan:** none — every action and component has concrete code.
**Type/name consistency:** new actions `renamePane`/`popOut`/`movePaneAfter` defined in Task 1 and dispatched in Tasks 2–3 with matching fields. `PaneHeader` props (`title`,`working`,`onRename`,`onPopOut`,`onClose`,`dragProps`) consistent across PaneHeader ↔ TerminalPane forward ↔ TabPanes supply.
**Known caveat:** dropping onto a pane always inserts after it in that pane's row (no left/right/above drop zones) — simple and predictable for v1; finer drop zones can come later. Custom names reset on app restart (no persistence yet).

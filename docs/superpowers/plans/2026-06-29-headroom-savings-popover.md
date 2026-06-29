# Headroom Savings — Plan 3b: per-chat hover popover (replaces the Dashboard tab)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Show a Session's Headroom savings where the user actually looks — a popover on **hover of that pane's HR toggle** — and remove the Mission Control "Savings" tab (decided too hard to reach). Pure UI pivot on top of Plan 2's data layer.

**Architecture:** Keep the entire Plan 2 data layer (Rust tailer, `savingsStore`, attribution, `startSavings()` boot-start). Add `usePaneSavings(paneId)` to the store (selects one pane's `Totals`). `PaneHeader` gets the pane's id and renders a CSS-`:hover`-driven popover anchored to the HR button showing that chat's routing + cache hits + tokens saved + $ ("since app start"). Revert the Dashboard "Savings" tab and delete the now-unused `savingsRows` table helper.

**Tech Stack:** TypeScript/React, CSS, Vitest.

## Global Constraints

- **Keep** (do NOT touch): `headroomlog.rs`, `headroomLogClient.ts`, `savingsStore.ts`'s store/ingest/`startSavings`, `savings.ts`'s `parseRecord`/`savedUsd`/`attribute`/`emptyTotals`/`addRecord` (+ their tests), `routedWorkingPaneIds`. The data pipeline stays exactly as Plan 2 + the boot-start fix left it.
- **Remove** (this pivot): the Dashboard "Savings" view tab + its render block + its CSS; the `savingsRows`/`SavingsRow`/`SavingsSummary` helper + its tests (only the table used it); the `useSavings` store hook IF it ends up unused after the Dashboard revert.
- The popover is **read-only** and **hover-driven** (CSS `:hover`, no click). It must not interfere with clicking the HR toggle itself.
- `Totals = { tokensSaved: number; requests: number; cacheHits: number; usd: number }`. cache mode → `tokensSaved` is usually ~0; show BOTH cache hits and tokens saved. Label "since app start". When the pane has no proxy activity (`requests === 0`), show a gentle "no activity yet" / "routing off" state instead of zeros-only.
- Reuse the existing `pane-head__*` CSS namespace + `var(--ck-*)` tokens; the popover must be `position: absolute`, sit below the HR button, and `z-index` above sibling panes.
- `npm test` (Vitest); 3 pre-existing `persistence.test.ts` failures are unrelated — never touch them.

---

### Task 1: Revert the Dashboard "Savings" tab + delete the table helper

Back to Sessions | Cost; remove the savings table view, its CSS, and the `savingsRows` helper/tests that only the table used.

**Files:**
- Modify: `src/components/Dashboard.tsx` (remove the savings view tab + block + savings-only imports/derivations)
- Modify: `src/components/Dashboard.css` (remove `.cockpit-dash__savings*` rules)
- Modify: `src/lib/savings.ts` (remove `savingsRows` + `SavingsRow` + `SavingsSummary`)
- Modify: `src/lib/savings.test.ts` (remove the `describe("savingsRows", …)` block + the `savingsRows` import)

**Interfaces:**
- Produces: nothing new. After this task the Dashboard has only `"sessions" | "cost"` views and `savings.ts` no longer exports `savingsRows`.

- [ ] **Step 1: Revert Dashboard.tsx**

In `src/components/Dashboard.tsx`:
- Change the view state type from `"sessions" | "cost" | "savings"` back to `"sessions" | "cost"`.
- Remove the `<button … onClick={() => setView("savings")}>Savings</button>` from `cockpit-dash__viewtabs`.
- Remove the entire `{view === "savings" && ( … )}` block.
- Remove the now-unused imports/derivations: the `useSavings` import, the `savingsRows` import, the `const paneMeta = …` and `const sv = savingsRows(…)` lines. Leave `overviewItems` (still used by the sessions view) and everything else intact.

- [ ] **Step 2: Remove savings CSS**

In `src/components/Dashboard.css`, delete every rule whose selector starts with `.cockpit-dash__savings` (the container, head, scope, table, name, rate, unattributed-row, empty, hint).

- [ ] **Step 3: Remove `savingsRows` from savings.ts + its tests**

In `src/lib/savings.ts`, delete the `SavingsRow` interface, the `SavingsSummary` interface, and the `savingsRows` function (added in Plan 3 — the block at the end). Keep `parseRecord`/`savedUsd`/`attribute`/`emptyTotals`/`addRecord` + their types.
In `src/lib/savings.test.ts`, delete the `describe("savingsRows", …)` block and the `import { savingsRows } from "./savings";` line.

- [ ] **Step 4: Verify**

Run: `npm test -- savings` → passes (the savingsRows tests are gone; parse/value/attribute/addRecord tests remain green).
Run: `npx tsc --noEmit` → clean (Dashboard.tsx no longer references useSavings/savingsRows; no dangling imports). pre-existing unrelated noise ok.
Run: `npm run build` → clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.tsx src/components/Dashboard.css src/lib/savings.ts src/lib/savings.test.ts
git commit -m "revert(savings): drop the Mission Control Savings tab + table helper (moving to a per-pane hover popover)"
```

---

### Task 2: `usePaneSavings` + the HR-toggle hover popover

**Files:**
- Modify: `src/lib/savingsStore.ts` (add `usePaneSavings`; remove `useSavings` if now unused)
- Modify: `src/components/PaneHeader.tsx` (accept `paneId`; render the hover popover)
- Modify: `src/components/PaneHeader.css` (popover styles)
- Modify: `src/components/TerminalPane.tsx` (pass `paneId` to `<PaneHeader>`)

**Interfaces:**
- Consumes: the savings store `state.byPane` + subscription machinery (already in `savingsStore.ts`); `emptyTotals`, `type Totals` from `./savings`.
- Produces: `usePaneSavings(paneId: string): Totals` (returns that pane's live totals, or `emptyTotals()` if none yet).

- [ ] **Step 1: Add `usePaneSavings` (and drop unused `useSavings`)**

In `src/lib/savingsStore.ts`, add (modelled on the existing `useSavings` subscribe/unsubscribe pattern, but selecting one pane and starting the pipeline on mount):

```typescript
import { emptyTotals, type Totals } from "./savings"; // ensure emptyTotals + Totals are imported (Totals already is)

/** Live savings totals for ONE pane (the per-chat hover popover). Starts the
 *  pipeline on mount so the popover works even if no other consumer ran start(). */
export function usePaneSavings(paneId: string): Totals {
  const [t, setT] = useState<Totals>(() => state.byPane[paneId] ?? emptyTotals());
  useEffect(() => {
    start();
    const fn = (s: SavingsState) => setT(s.byPane[paneId] ?? emptyTotals());
    subs.add(fn);
    fn(state);
    return () => { subs.delete(fn); };
  }, [paneId]);
  return t;
}
```
If `useSavings` is no longer imported anywhere (Task 1 removed the Dashboard use), delete the `useSavings` export to avoid dead code. Keep `startSavings` and the store internals.

- [ ] **Step 2: PaneHeader — accept `paneId` + render the popover**

In `src/components/PaneHeader.tsx`:
- Add `paneId: string;` to the props type + destructuring.
- Import `usePaneSavings` from `../lib/savingsStore`. Inside the component: `const sv = usePaneSavings(paneId);` and `const rate = sv.requests > 0 ? Math.round((sv.cacheHits / sv.requests) * 100) : 0;`.
- Wrap the existing HR `<button>` in a hover container and add the popover as a sibling, e.g.:

```tsx
      <span className="pane-head__hr-wrap">
        <button
          className={`pane-head__hr${headroom ? " is-on" : ""}`}
          onClick={onToggleHeadroom}
          title={headroom ? "Headroom: เปิด (กดเพื่อปิด)" : "Headroom: ปิด (กดเพื่อเปิด)"}
          aria-pressed={headroom}
        >
          <span className="pane-head__hr-sw" /><span className="pane-head__hr-lbl">HR</span>
        </button>
        <span className="pane-head__hr-pop" role="tooltip">
          <span className="pane-head__hr-pop-h">Headroom · {headroom ? "on" : "off"}</span>
          {sv.requests === 0 ? (
            <span className="pane-head__hr-pop-empty">{headroom ? "no activity yet" : "routing off"}</span>
          ) : (
            <>
              <span className="pane-head__hr-pop-row"><b>{sv.cacheHits}/{sv.requests}</b> cache hits <i>({rate}%)</i></span>
              <span className="pane-head__hr-pop-row"><b>{sv.tokensSaved.toLocaleString()}</b> tokens saved</span>
              <span className="pane-head__hr-pop-row"><b>${sv.usd.toFixed(2)}</b> est. saved</span>
            </>
          )}
          <span className="pane-head__hr-pop-foot">since app start</span>
        </span>
      </span>
```
(Replace the existing standalone HR `<button>` with this wrapped version.)

- [ ] **Step 3: PaneHeader.css — popover styles**

Append to `src/components/PaneHeader.css`:
- `.pane-head__hr-wrap { position: relative; display: inline-flex; }`
- `.pane-head__hr-pop { position: absolute; top: calc(100% + 6px); right: 0; z-index: 50; display: none; flex-direction: column; gap: 3px; min-width: 160px; padding: 8px 10px; background: var(--ck-surface-2); border: 1px solid var(--ck-border); border-radius: 8px; box-shadow: 0 10px 30px -10px rgba(0,0,0,.6); font: 11px var(--ck-mono, ui-monospace, Menlo, monospace); color: var(--ck-text); }`
- `.pane-head__hr-wrap:hover .pane-head__hr-pop { display: flex; }`
- `.pane-head__hr-pop-h { color: var(--ck-bright); font-weight: 600; }` (when routing on, the heading reads green: scope it with the on state if easy — optional)
- `.pane-head__hr-pop-row b { color: var(--ck-green); font-variant-numeric: tabular-nums; }`
- `.pane-head__hr-pop-row i { color: var(--ck-muted); font-style: normal; }`
- `.pane-head__hr-pop-empty { color: var(--ck-muted); }`
- `.pane-head__hr-pop-foot { color: var(--ck-dim); font-size: 9.5px; letter-spacing: .04em; text-transform: uppercase; margin-top: 2px; }`
Read the existing `PaneHeader.css` first to match the file's token/spacing conventions; adjust values to fit.

- [ ] **Step 4: TerminalPane — pass `paneId`**

In `src/components/TerminalPane.tsx`, find the `<PaneHeader … />` render and add `paneId={paneId}` to its props (TerminalPane already has `paneId` in scope).

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` → clean (PaneHeader gets paneId; usePaneSavings typed; no dangling useSavings). `npm test` → existing suites pass (3 pre-existing persistence failures unrelated). `npm run build` → clean.

- [ ] **Step 6: Manual verification (GUI — the whole point)**

1. `npm run tauri dev`; HR on a pane, send a couple of prompts.
2. **Hover the HR button** → popover appears below it showing cache hits + % , tokens saved, est. $ ("since app start"); clicking HR still toggles (popover doesn't block the click).
3. A pane with HR off → hover shows "routing off"; HR on but no turns yet → "no activity yet".
4. Confirm Mission Control no longer has a "Savings" tab (only Sessions | Cost).

- [ ] **Step 7: Commit**

```bash
git add src/lib/savingsStore.ts src/components/PaneHeader.tsx src/components/PaneHeader.css src/components/TerminalPane.tsx
git commit -m "feat(savings): per-chat savings on HR-toggle hover (popover); drop the Dashboard tab approach"
```

---

## Self-Review

- **Spec coverage:** hover popover on HR toggle → Task 2 (PaneHeader wrap + CSS `:hover`). Per-chat data → `usePaneSavings(paneId)` (Task 2 Step 1) + `paneId` wiring (Task 2 Step 4). Routing/cache/tokens/$ + "since app start" + off/empty states → Task 2 Step 2. Remove Dashboard tab → Task 1. Delete unused `savingsRows`/`useSavings` → Task 1 + Task 2 Step 1. Data layer untouched → Global Constraints.
- **Placeholder scan:** Task 2 Steps 1–2 carry full code; Step 3 CSS is concrete values with a "read the file first to match conventions" note; Step 4 is a one-prop addition with the exact prop. No silent TODOs.
- **Type consistency:** `usePaneSavings(paneId: string): Totals`; `paneId: string` added to PaneHeader props; `sv.cacheHits/requests/tokensSaved/usd` match `Totals`; classes `pane-head__hr-wrap`/`-pop`/`-pop-h`/`-pop-row`/`-pop-empty`/`-pop-foot` consistent between Task 2 Step 2 (markup) and Step 3 (CSS).

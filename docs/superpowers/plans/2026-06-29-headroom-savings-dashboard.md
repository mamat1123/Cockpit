# Headroom Savings — Plan 3: Dashboard Polish (variant-B)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the minimal "Savings" readout from Plan 2 into the designed variant-B view — per-Session rows labelled by the real Session title (not raw pane ids), a cache-hit-rate column, a summary stat, a styled Unattributed row, and a one-line "what this means" hint.

**Architecture:** Pure UI on top of Plan 2's `useSavings()` store. A new pure `savingsRows()` helper joins the store's `byPane` (keyed by paneId) with a `paneId → {title,cwd}` map derived from the Dashboard's existing `layout` prop (via `overviewItems`), computes cache-hit rate + summary totals, and sorts. The Dashboard's `savings` view renders it; `Dashboard.css` styles it to match the existing `cockpit-dash__*` aesthetic. No data-layer changes — savings remain in-memory per app run (re-scanning the proxy log on boot would mis-attribute everything, so "since app start" is the honest scope and is labelled as such).

**Tech Stack:** TypeScript/React, Vitest, existing Dashboard CSS namespace.

## Global Constraints

- Build ONLY on what Plan 2 produced — do not change the store, the tailer, or `terminalRegistry`. `useSavings(): { byPane: Record<string, Totals>; unattributed: Totals }`, `Totals = { tokensSaved: number; requests: number; cacheHits: number; usd: number }`.
- The Dashboard already receives `layout: Layout` and uses `overviewItems(layout)` (from `./paneFlatten`) → items with `{ paneId, tabId, tabIndex, title, cwd, sessionId }`. Reuse that for the paneId→title/cwd join — do NOT thread new props.
- A paneId present in `byPane` but absent from the current layout (a closed pane) MUST still show a row, labelled `(closed session)`.
- **cache mode reality:** `tokensSaved` is ~0 for most requests; the meaningful signal is the **cache-hit rate**. Show BOTH. Include a one-line hint that token-level savings require `token` mode (which is subscription-billing-risky per the user's own notes) — do not hide that token savings are ~0.
- Savings are in-memory, reset on app restart — label the view "since app start" so the number isn't mistaken for lifetime.
- Reuse the existing `cockpit-dash__*` BEM namespace + `var(--ck-*)` tokens + the dashboard's monospace data font; mirror `CostView`/`Dashboard.css` patterns. Do NOT introduce a new design system.
- Test runner: `npm test` (Vitest). 3 pre-existing `persistence.test.ts` failures are unrelated — never "fix" them.

---

### Task 1: Pure `savingsRows` helper (join + cache-rate + summary + sort) [TDD]

The testable core of the view: join store totals with pane metadata, compute derived numbers, sort.

**Files:**
- Modify: `src/lib/savings.ts` (append the helper + types)
- Test: `src/lib/savings.test.ts` (append a `describe`)

**Interfaces:**
- Consumes: `Totals` (already in this file).
- Produces:
  - `interface SavingsRow { paneId: string; title: string; cwd: string; totals: Totals; cacheRate: number }`
  - `interface SavingsSummary { rows: SavingsRow[]; totalTokensSaved: number; totalRequests: number; totalCacheHits: number; totalUsd: number }`
  - `function savingsRows(byPane: Record<string, Totals>, meta: Record<string, { title: string; cwd: string }>): SavingsSummary`

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/savings.test.ts`:

```typescript
import { savingsRows } from "./savings";

describe("savingsRows", () => {
  const t = (tokensSaved: number, requests: number, cacheHits: number, usd: number) =>
    ({ tokensSaved, requests, cacheHits, usd });

  it("joins pane title/cwd from meta and computes cache-hit rate", () => {
    const out = savingsRows(
      { "pane-1": t(100, 4, 2, 0.5) },
      { "pane-1": { title: "akurax-api", cwd: "/Users/x/akurax-api" } },
    );
    expect(out.rows[0].title).toBe("akurax-api");
    expect(out.rows[0].cwd).toBe("/Users/x/akurax-api");
    expect(out.rows[0].cacheRate).toBeCloseTo(0.5, 6); // 2/4
  });

  it("labels a pane missing from meta as a closed session, cwd empty", () => {
    const out = savingsRows({ "pane-9": t(0, 1, 0, 0) }, {});
    expect(out.rows[0].title).toBe("(closed session)");
    expect(out.rows[0].cwd).toBe("");
  });

  it("cacheRate is 0 when there are no requests (no divide-by-zero)", () => {
    const out = savingsRows({ "pane-1": t(0, 0, 0, 0) }, {});
    expect(out.rows[0].cacheRate).toBe(0);
  });

  it("sorts rows by usd desc, then requests desc", () => {
    const out = savingsRows(
      { a: t(0, 1, 0, 0.1), b: t(0, 9, 0, 0.1), c: t(0, 1, 0, 5.0) },
      {},
    );
    expect(out.rows.map((r) => r.paneId)).toEqual(["c", "b", "a"]);
  });

  it("sums summary totals across panes", () => {
    const out = savingsRows(
      { a: t(100, 2, 1, 0.5), b: t(50, 3, 2, 0.25) },
      {},
    );
    expect(out.totalTokensSaved).toBe(150);
    expect(out.totalRequests).toBe(5);
    expect(out.totalCacheHits).toBe(3);
    expect(out.totalUsd).toBeCloseTo(0.75, 6);
  });

  it("empty byPane → empty rows + zero totals", () => {
    const out = savingsRows({}, {});
    expect(out.rows).toEqual([]);
    expect(out.totalUsd).toBe(0);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- savings`
Expected: FAIL — `savingsRows` is not exported.

- [ ] **Step 3: Implement the helper**

Append to `src/lib/savings.ts`:

```typescript
export interface SavingsRow { paneId: string; title: string; cwd: string; totals: Totals; cacheRate: number }
export interface SavingsSummary { rows: SavingsRow[]; totalTokensSaved: number; totalRequests: number; totalCacheHits: number; totalUsd: number }

/** Join per-pane savings totals with a paneId→{title,cwd} map, compute each row's
 *  cache-hit rate, sort by USD saved (then requests) descending, and sum the totals.
 *  A paneId absent from `meta` (a closed pane) is labelled "(closed session)". */
export function savingsRows(
  byPane: Record<string, Totals>,
  meta: Record<string, { title: string; cwd: string }>,
): SavingsSummary {
  const rows: SavingsRow[] = Object.entries(byPane).map(([paneId, totals]) => ({
    paneId,
    title: meta[paneId]?.title ?? "(closed session)",
    cwd: meta[paneId]?.cwd ?? "",
    totals,
    cacheRate: totals.requests > 0 ? totals.cacheHits / totals.requests : 0,
  }));
  rows.sort((a, b) => b.totals.usd - a.totals.usd || b.totals.requests - a.totals.requests);
  return {
    rows,
    totalTokensSaved: rows.reduce((s, r) => s + r.totals.tokensSaved, 0),
    totalRequests: rows.reduce((s, r) => s + r.totals.requests, 0),
    totalCacheHits: rows.reduce((s, r) => s + r.totals.cacheHits, 0),
    totalUsd: rows.reduce((s, r) => s + r.totals.usd, 0),
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test -- savings`
Expected: PASS (the new `savingsRows` describe + all prior savings tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/savings.ts src/lib/savings.test.ts
git commit -m "feat(savings): savingsRows — join totals with pane meta, cache-rate, summary, sort"
```

---

### Task 2: Render the variant-B Savings view

Replace Plan 2's minimal table with the joined, summarized, sorted view + hint.

**Files:**
- Modify: `src/components/Dashboard.tsx` (the `view === "savings"` block + a savings summary stat in the ribbon)

**Interfaces:**
- Consumes: `useSavings()` (already imported); `overviewItems(layout)` (already used); `savingsRows`, `type SavingsSummary` (Task 1).

- [ ] **Step 1: Build the meta map + rows**

In `Dashboard.tsx`, import `savingsRows` from `../lib/savingsStore`'s sibling — i.e. `import { savingsRows } from "../lib/savings";`. Inside the component body (near where `items` is built), add:

```typescript
  const paneMeta = Object.fromEntries(
    overviewItems(layout).map((it) => [it.paneId, { title: it.title, cwd: it.cwd }]),
  );
  const sv = savingsRows(savings.byPane, paneMeta);
```

- [ ] **Step 2: Replace the savings view block**

Replace the entire `{view === "savings" && (() => { ... })()}` IIFE block with this (keeps the empty state; adds title/cwd, cache-rate %, summary, hint, "since app start", styled Unattributed):

```tsx
        {view === "savings" && (
          <div className="cockpit-dash__savings">
            <div className="cockpit-dash__savings-head">
              <h3>Headroom Savings <span className="cockpit-dash__savings-scope">since app start</span></h3>
              <div className="cockpit-dash__readout">
                <div className="cockpit-dash__stat is-cost"><b>{fmt(sv.totalUsd)}</b><span>est. saved</span></div>
                <div className="cockpit-dash__stat"><b>{sv.totalCacheHits}</b><span>cache hits</span></div>
                <div className="cockpit-dash__stat"><b>{sv.totalRequests}</b><span>requests</span></div>
              </div>
            </div>
            {sv.rows.length === 0 && savings.unattributed.requests === 0 ? (
              <p className="cockpit-dash__savings-empty">No Headroom activity yet — toggle HR on a pane and send a prompt.</p>
            ) : (
              <table className="cockpit-dash__savings-table">
                <thead>
                  <tr><th>Session</th><th>Cache hits</th><th>Tokens saved</th><th>Est. saved</th></tr>
                </thead>
                <tbody>
                  {sv.rows.map((r) => (
                    <tr key={r.paneId}>
                      <td className="cockpit-dash__savings-name" title={r.cwd}>{r.title}</td>
                      <td>{r.totals.cacheHits}/{r.totals.requests} <span className="cockpit-dash__savings-rate">({Math.round(r.cacheRate * 100)}%)</span></td>
                      <td>{r.totals.tokensSaved.toLocaleString()}</td>
                      <td>{fmt(r.totals.usd)}</td>
                    </tr>
                  ))}
                  {savings.unattributed.requests > 0 && (
                    <tr className="cockpit-dash__savings-unattributed-row">
                      <td className="cockpit-dash__savings-name">Unattributed</td>
                      <td>{savings.unattributed.cacheHits}/{savings.unattributed.requests}</td>
                      <td>{savings.unattributed.tokensSaved.toLocaleString()}</td>
                      <td>{fmt(savings.unattributed.usd)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
            <p className="cockpit-dash__savings-hint">
              Headroom runs in <b>cache mode</b>: savings show as <b>cache hits</b> (cheaper input), not fewer tokens.
              Token-level compression needs <b>token mode</b> (heavier savings, but riskier for subscription billing).
            </p>
          </div>
        )}
```

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit` (Dashboard.tsx clean; pre-existing unrelated noise ok) and `npm run build` (clean).

- [ ] **Step 4: Commit**

```bash
git add src/components/Dashboard.tsx
git commit -m "feat(savings): variant-B Savings view — Session titles, cache-rate, summary, hint"
```

---

### Task 3: Style the Savings view

**Files:**
- Modify: `src/components/Dashboard.css` (add `cockpit-dash__savings*` rules)

**Interfaces:**
- Consumes: the class names rendered in Task 2.

- [ ] **Step 1: Read the file first**

Read `src/components/Dashboard.css` to see the existing `cockpit-dash__*` rules (panel background, `--ck-*` tokens, the `cockpit-dash__readout`/`cockpit-dash__stat` styles, table/grid spacing, the monospace data font used elsewhere). Match them.

- [ ] **Step 2: Add the styles**

Append rules for: `.cockpit-dash__savings` (padding/scroll container), `.cockpit-dash__savings-head` (flex row: heading left, readout right), `.cockpit-dash__savings-scope` (muted small uppercase label), `.cockpit-dash__savings-table` (full-width, `var(--ck-*)` colors, tabular-nums for the number columns, row hover, header in `--ck-muted`), `.cockpit-dash__savings-name` (bright, ellipsis), `.cockpit-dash__savings-rate` (muted), `.cockpit-dash__savings-unattributed-row` (dimmed / `--ck-dim`), `.cockpit-dash__savings-empty` and `.cockpit-dash__savings-hint` (muted helper text). Reuse the existing `.cockpit-dash__readout`/`.cockpit-dash__stat` styling for the summary (already defined — the markup reuses those classes, so no new rule needed unless a savings-specific tweak helps). Keep it consistent with `CostView`'s look.

- [ ] **Step 3: Build**

Run: `npm run build` → clean. `npm test` → existing suites pass (3 pre-existing persistence failures unrelated).

- [ ] **Step 4: Manual verification (GUI — full view)**

1. `npm run tauri dev`; toggle HR on a pane, send prompts.
2. Dashboard → Savings: rows show the Session TITLE (not pane id), cache-hit count + %, tokens, $; the summary stat reads total est. saved / cache hits / requests; the hint + "since app start" are visible; layout matches the Cost/Sessions tabs.
3. Close a pane that had savings → its row shows "(closed session)".
4. Two panes routed + working at once → some requests in the Unattributed row (dimmed).

- [ ] **Step 5: Commit**

```bash
git add src/components/Dashboard.css
git commit -m "style(savings): variant-B Savings view styling"
```

---

## Self-Review

- **Spec coverage:** Session-title join → Task 1 `savingsRows` + Task 2 `paneMeta`. Closed-pane label → Task 1 test + impl. cache-hit rate column → Task 1 `cacheRate` + Task 2 markup. Summary stat → Task 2 ribbon block. Unattributed styled → Task 2 row + Task 3 `.cockpit-dash__savings-unattributed-row`. token-mode hint + "since app start" → Task 2. Styling → Task 3. No data-layer change (per constraint).
- **Placeholder scan:** Task 1 carries full test+impl. Task 2 carries full JSX. Task 3 Step 2 is prose (class-by-class intent) because exact CSS depends on `Dashboard.css` tokens not yet read — flagged "read the file first", not a silent TODO.
- **Type consistency:** `SavingsRow`/`SavingsSummary`, `savingsRows(byPane, meta)` returning `{ rows, totalTokensSaved, totalRequests, totalCacheHits, totalUsd }`; `paneMeta: Record<paneId, {title,cwd}>`; rows sorted by `usd` then `requests` desc; `cacheRate` ∈ [0,1] rendered as `%`. `fmt` is the Dashboard's existing USD formatter.

## Follow-on (optional, not this plan)
- Persist savings across runs (would need a boot re-scan strategy that doesn't mis-attribute, or a separate lifetime bucket) — deferred; "since app start" labels the current scope.
- A per-Session %-compressed column would need `tokensOriginal` summed in the store's `Totals` (a data-layer change) — out of scope; cache-hit rate is the headline % for cache mode.

import { useEffect, useState } from "react";
import { startHeadroomLog, onHeadroomLog } from "./headroomLogClient";
import { routedWorkingPaneIds } from "./terminalRegistry";
import { parseRecord, attribute, emptyTotals, addRecord, type Totals, type WorkingSample } from "./savings";

export interface SavingsState { byPane: Record<string, Totals>; unattributed: Totals }

let state: SavingsState = { byPane: {}, unattributed: emptyTotals() };
const subs = new Set<(s: SavingsState) => void>();
function emit() { const snap = state; for (const fn of subs) fn(snap); }

// Rolling history of which routed panes were working, sampled on a tick. A proxy record
// is attributed against the sample nearest its own timestamp (handles tail latency).
const history: WorkingSample[] = [];
const HISTORY_MS = 120_000;
const SAMPLE_MS = 500;

let started = false;
function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  setInterval(() => {
    const now = Date.now();
    history.push({ t: now, paneIds: routedWorkingPaneIds(now) });
    while (history.length && now - history[0].t > HISTORY_MS) history.shift();
  }, SAMPLE_MS);

  startHeadroomLog().catch((e) => console.warn("headroom log start failed", e));
  onHeadroomLog((line) => {
    const r = parseRecord(line);
    if (!r) return;
    const paneId = attribute(r.ts || Date.now(), history);
    if (paneId) {
      state = { ...state, byPane: { ...state.byPane, [paneId]: addRecord(state.byPane[paneId] ?? emptyTotals(), r) } };
    } else {
      state = { ...state, unattributed: addRecord(state.unattributed, r) };
    }
    emit();
  }).catch((e) => console.warn("headroom log listen failed", e));
}

/** Start the savings pipeline at app boot (tailer + working-history sampling),
 *  independent of whether the Dashboard is mounted. Idempotent. */
export function startSavings(): void { start(); }

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

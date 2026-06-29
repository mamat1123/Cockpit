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

  void startHeadroomLog();
  void onHeadroomLog((line) => {
    const r = parseRecord(line);
    if (!r) return;
    const paneId = attribute(r.ts || Date.now(), history);
    if (paneId) {
      state = { ...state, byPane: { ...state.byPane, [paneId]: addRecord(state.byPane[paneId] ?? emptyTotals(), r) } };
    } else {
      state = { ...state, unattributed: addRecord(state.unattributed, r) };
    }
    emit();
  });
}

/** Subscribe a component to the live per-Session savings totals. */
export function useSavings(): SavingsState {
  const [s, setS] = useState<SavingsState>(state);
  useEffect(() => {
    start();
    subs.add(setS);
    setS(state);
    return () => { subs.delete(setS); };
  }, []);
  return s;
}

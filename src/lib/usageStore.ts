import { useEffect, useState } from "react";
import { usageReport, type UsageReport } from "./usageClient";
import { anyPaneWorking } from "./terminalRegistry";

/**
 * One shared usage poller behind a tiny pub/sub store, so the tab-bar strip and the
 * Mission Control panel read the SAME cached data and trigger ONE network call.
 *
 * Refresh policy (decided in design): event-driven + baseline floor.
 *  - a turn finishing (working→idle edge) → refresh after an 8s settle
 *  - window regains focus → refresh now
 *  - baseline poll every 60s as a floor
 *  - never below MIN_GAP between actual network calls, so bursts of idle events coalesce
 *
 * Graceful states: keep the last good report on a failed refresh (marked `stale`); only
 * show "no token" / loading when we've never had data.
 */

export type UsageUiStatus = "loading" | "ok" | "stale" | "noToken";

export interface UsageState {
  report: UsageReport | null; // last GOOD report (status === "ok"), or null until first success
  status: UsageUiStatus;
  lastOkAt: number | null;
}

const MIN_GAP_MS = 8_000;
const BASELINE_MS = 60_000;
const IDLE_SETTLE_MS = 8_000;
const EDGE_TICK_MS = 1_000;

let state: UsageState = { report: null, status: "loading", lastOkAt: null };
const subs = new Set<(s: UsageState) => void>();

function emit(patch: Partial<UsageState>) {
  state = { ...state, ...patch };
  for (const fn of subs) fn(state);
}

let inFlight = false;
let lastFetchAt = 0;

async function fetchUsage(force = false): Promise<void> {
  const now = Date.now();
  if (inFlight) return;
  if (!force && now - lastFetchAt < MIN_GAP_MS) return;
  inFlight = true;
  lastFetchAt = now;
  try {
    const r = await usageReport();
    if (r.status === "ok") {
      emit({ report: r, status: "ok", lastOkAt: Date.now() });
    } else if (r.status === "no_token") {
      emit({ status: state.report ? "stale" : "noToken" });
    } else {
      // transient error: keep showing last value if we have one, else stay in loading
      emit({ status: state.report ? "stale" : "loading" });
    }
  } catch {
    emit({ status: state.report ? "stale" : "loading" });
  } finally {
    inFlight = false;
  }
}

let started = false;
function start(): void {
  if (started || typeof window === "undefined") return;
  started = true;

  void fetchUsage(true);
  setInterval(() => void fetchUsage(), BASELINE_MS);

  // window focus → fresh read
  const onFocus = () => void fetchUsage(true);
  window.addEventListener("focus", onFocus);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void fetchUsage(true);
  });

  // working→idle edge → refresh after a settle (utilization only moves when a turn spends tokens)
  let prevWorking = false;
  let settle: ReturnType<typeof setTimeout> | null = null;
  setInterval(() => {
    const working = anyPaneWorking(Date.now());
    if (prevWorking && !working) {
      if (settle) clearTimeout(settle);
      settle = setTimeout(() => void fetchUsage(), IDLE_SETTLE_MS);
    }
    prevWorking = working;
  }, EDGE_TICK_MS);
}

/** Subscribe a React component to the shared usage state. */
export function useUsage(): UsageState {
  const [s, setS] = useState<UsageState>(state);
  useEffect(() => {
    start();
    subs.add(setS);
    setS(state);
    return () => {
      subs.delete(setS);
    };
  }, []);
  return s;
}

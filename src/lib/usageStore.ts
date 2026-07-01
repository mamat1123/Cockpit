import { useEffect, useState } from "react";
import { usageReport, usageReportCodex, usageReportZai, type UsageReport } from "./usageClient";
import { anyPaneWorking } from "./terminalRegistry";
import type { AgentProvider } from "../layout/paneLayout";

/**
 * One shared usage poller behind a tiny pub/sub store, so the tab-bar strip and the
 * Mission Control panel read the SAME cached state and trigger ONE set of network/file
 * calls — now fanned out across all three providers per tick.
 *
 * Refresh policy (unchanged from the single-provider version):
 *  - a turn finishing (working→idle edge) → refresh after an 8s settle
 *  - window regains focus → refresh now
 *  - baseline poll every 60s as a floor
 *  - never below MIN_GAP between actual fetch ticks, so bursts of idle events coalesce
 *
 * Failure isolation: each tick fetches all three providers via `Promise.allSettled`,
 * so one provider's rejection (e.g. z.ai's curl timing out) only staleness's *that*
 * provider's slice of state — the other two update normally. This shares the refresh
 * triggers/timers above (a UI-level concern) rather than running three independent
 * pollers, which would just duplicate timers for no extra isolation benefit.
 */

export type UsageUiStatus = "loading" | "ok" | "stale" | "noToken";
export type ProviderId = AgentProvider;

export interface UsageState {
  report: UsageReport | null; // last GOOD report (status === "ok"), or null until first success
  status: UsageUiStatus;
  lastOkAt: number | null;
}

export type MultiUsageState = Record<ProviderId, UsageState>;

const MIN_GAP_MS = 8_000;
const BASELINE_MS = 60_000;
const IDLE_SETTLE_MS = 8_000;
const EDGE_TICK_MS = 1_000;

const EMPTY_STATE: UsageState = { report: null, status: "loading", lastOkAt: null };

let state: MultiUsageState = { claude: EMPTY_STATE, codex: EMPTY_STATE, zai: EMPTY_STATE };
const subs = new Set<(s: MultiUsageState) => void>();

function emit(provider: ProviderId, patch: Partial<UsageState>) {
  state = { ...state, [provider]: { ...state[provider], ...patch } };
  for (const fn of subs) fn(state);
}

/** Apply one provider's fetch outcome to its own slice — never touches the others. */
function applyResult(provider: ProviderId, settled: PromiseSettledResult<UsageReport>) {
  const hadReport = !!state[provider].report;
  if (settled.status === "fulfilled") {
    const r = settled.value;
    if (r.status === "ok") {
      emit(provider, { report: r, status: "ok", lastOkAt: Date.now() });
    } else if (r.status === "no_token") {
      emit(provider, { status: hadReport ? "stale" : "noToken" });
    } else {
      emit(provider, { status: hadReport ? "stale" : "loading" });
    }
  } else {
    // Rejected promise (network/invoke failure): same graceful degrade as a
    // non-"ok" status — keep the last good report if we have one.
    emit(provider, { status: hadReport ? "stale" : "loading" });
  }
}

let inFlight = false;
let lastFetchAt = 0;

async function fetchUsage(force = false): Promise<void> {
  const now = Date.now();
  if (inFlight) return;
  if (!force && now - lastFetchAt < MIN_GAP_MS) return;
  inFlight = true;
  lastFetchAt = now;
  const [claude, codex, zai] = await Promise.allSettled([usageReport(), usageReportCodex(), usageReportZai()]);
  applyResult("claude", claude);
  applyResult("codex", codex);
  applyResult("zai", zai);
  inFlight = false;
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

/** Subscribe a React component to the shared multi-provider usage state. */
export function useMultiUsage(): MultiUsageState {
  const [s, setS] = useState<MultiUsageState>(state);
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

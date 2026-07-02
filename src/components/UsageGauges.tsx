import { useEffect, useState } from "react";
import { useMultiUsage, type UsageUiStatus, type UsageState, type ProviderId } from "../lib/usageStore";
import { useBudget } from "../lib/budgetStore";
import type { Budget } from "../lib/budget";
import type { UsageWindow } from "../lib/usageClient";
import { clampPct, levelFor, formatReset, formatResetClock } from "../lib/usage";
import { providerMeta } from "../lib/providers";
import { ProviderIcon } from "./icons/ProviderIcons";
import "./UsageGauges.css";

type Mode = "data" | "loading" | "na";

function modeOf(status: UsageUiStatus, hasReport: boolean): Mode {
  if (status === "noToken") return "na";
  if (!hasReport && status === "loading") return "loading";
  return "data";
}

/** Local 1s clock used for the live reset countdown / Mission Control clock. */
function useNow(ms: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Full instrument gauge for one window — used in per-provider popovers and Mission Control. */
function Gauge({ label, win, now, stale, mode, naLabel = "sign in to Claude" }: {
  label: string;
  win: UsageWindow | null;
  now: number;
  stale: boolean;
  mode: Mode;
  naLabel?: string;
}) {
  const pct = clampPct(win?.utilization ?? 0);
  const level = levelFor(pct);
  const [w, setW] = useState(0);
  useEffect(() => {
    if (mode !== "data") return;
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct, mode]);

  const cls = mode === "data" ? `is-${level}` : `is-${mode}`;
  const hot = mode === "data" && pct > 80;
  const reset = mode === "data"
    ? (win?.resetsAt ? `resets in ${formatReset(win.resetsAt, now)}` : "—")
    : mode === "na" ? naLabel : "loading…";
  const resetClock = mode === "data" && win?.resetsAt ? formatResetClock(win.resetsAt) : null;

  return (
    <div className={`cu-gauge ${cls}${stale ? " is-stale" : ""}${hot ? " is-hot" : ""}`}>
      <div className="cu-gauge__head">
        <span className="cu-gauge__name">{label}</span>
        <span className="cu-gauge__pct">{mode === "data" ? <>{pct}<i>%</i></> : "—"}</span>
      </div>
      <div className="cu-gauge__track">
        {mode === "data" && <div className="cu-gauge__fill" style={{ width: `${w}%` }} />}
        <div className="cu-gauge__ticks" />
      </div>
      <div className="cu-gauge__foot">
        <span className="cu-gauge__used">used</span>
        <span className="cu-gauge__reset">
          <span className="r">⟳</span>{reset}
          {resetClock && <span className="cu-gauge__reset-clock"> ({resetClock})</span>}
        </span>
      </div>
    </div>
  );
}

/** One compact bar with a trailing reset-time chip — the tab-bar strip's per-window row. */
function MiniWithReset({ win, now, stale }: { win: UsageWindow | null; now: number; stale: boolean }) {
  const pct = clampPct(win?.utilization ?? 0);
  const level = levelFor(pct);
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <span className={`cu-mini is-${level}${stale ? " is-stale" : ""}`}>
      <span className="cu-mini__track"><span className="cu-mini__fill" style={{ width: `${w}%` }} /></span>
      <span className="cu-mini__v">{pct}%</span>
      {win?.resetsAt && <span className="cu-mini__t">{formatReset(win.resetsAt, now)}</span>}
    </span>
  );
}

/** Daily-budget mini for the strip: how much of TODAY's pacing budget is spent (can exceed 100% = borrowing from later days). Claude-only. */
function DayMini({ b, stale }: { b: Budget; stale: boolean }) {
  const fill = Math.max(0, Math.min(100, b.fillPct));
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(fill));
    return () => cancelAnimationFrame(id);
  }, [fill]);
  const cls = b.over ? "is-red is-over" : `is-${b.level}`;
  const remain = Math.max(0, Math.round(b.remainingPct));
  const title = `today's budget — ${Math.round(b.fillPct)}% used · ${remain}% (≈$${Math.round(b.remainingUsd)}) left to spend today · ${b.daysLeft}d left this week. A pacing target, not a hard limit.`;
  return (
    <span className={`cu-mini ${cls}${stale ? " is-stale" : ""}`} title={title}>
      <span className="cu-mini__k">day</span>
      <span className="cu-mini__track"><span className="cu-mini__fill" style={{ width: `${w}%` }} /></span>
      <span className="cu-mini__v">{Math.round(b.fillPct)}%</span>
    </span>
  );
}

/** Full daily-budget gauge — mirrors the 5h/weekly gauge. Claude-only. */
function DayGauge({ b, stale }: { b: Budget; stale: boolean }) {
  const fill = Math.max(0, Math.min(100, b.fillPct));
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(fill));
    return () => cancelAnimationFrame(id);
  }, [fill]);
  const cls = b.over ? "is-red is-over" : `is-${b.level}`;
  const remain = Math.round(b.remainingPct);
  const foot = b.over
    ? `${Math.abs(remain)}% over — borrowing from later days`
    : `${remain}% (≈$${Math.round(b.remainingUsd)}) left today`;
  return (
    <div className={`cu-gauge ${cls}${stale ? " is-stale" : ""}`}>
      <div className="cu-gauge__head">
        <span className="cu-gauge__name">today’s budget</span>
        <span className="cu-gauge__pct">{Math.round(b.fillPct)}<i>%</i></span>
      </div>
      <div className="cu-gauge__track">
        <div className="cu-gauge__fill" style={{ width: `${w}%` }} />
        <div className="cu-gauge__ticks" />
      </div>
      <div className="cu-gauge__foot">
        <span className="cu-gauge__used">spent</span>
        <span className="cu-gauge__reset">{foot}</span>
      </div>
    </div>
  );
}

/** No-data copy per provider, shown by `Gauge`/`MiniProviderRow` when there's nothing to show. */
const NA_LABEL: Record<ProviderId, string> = {
  claude: "sign in to Claude",
  codex: "no Codex sessions yet",
  zai: "set token in Settings",
};

/**
 * Badge + label + full 5h/weekly gauges for one provider, with an optional Claude-only
 * daily-budget row. The one shared visual unit used by both the tab-bar popover
 * (`MiniProviderRow`, below) and Mission Control (`UsagePanel`).
 */
function ProviderGaugeGroup({ id, state, now, budget }: {
  id: ProviderId;
  state: UsageState;
  now: number;
  budget?: Budget | null;
}) {
  const meta = providerMeta(id);
  const mode = modeOf(state.status, !!state.report);
  const five = state.report?.fiveHour ?? null;
  const week = state.report?.sevenDay ?? null;
  const stale = state.status === "stale";
  return (
    <div className="cu-provider-group">
      <div className="cu-provider-group__head">
        <span className={`cu-badge provider-${id}`}><ProviderIcon id={id} /></span>
        <span className="cu-provider-group__name">{meta.label}</span>
      </div>
      <Gauge label="5-hour window" win={five} now={now} stale={stale} mode={mode} naLabel={NA_LABEL[id]} />
      <Gauge label="Weekly · 7-day" win={week} now={now} stale={stale} mode={mode} naLabel={NA_LABEL[id]} />
      {budget && <DayGauge b={budget} stale={stale} />}
    </div>
  );
}

/**
 * One provider's tab-bar strip row: badge + 2 mini bars (5h/weekly, each with a
 * trailing reset-time chip). Its own independent hover/focus target — opens ONLY its
 * own popover, anchored under itself. A provider with no data shows its own na/loading
 * state and is never focusable, so it can never block or blank the other providers.
 */
function MiniProviderRow({ id, state, budget }: {
  id: ProviderId;
  state: UsageState;
  budget?: Budget | null;
}) {
  const meta = providerMeta(id);
  const now = useNow(1000);
  const [open, setOpen] = useState(false);
  const mode = modeOf(state.status, !!state.report);
  const stale = state.status === "stale";

  if (mode === "loading") {
    return (
      <span className="cu-provider-row is-loading" aria-label={`Loading ${meta.label} usage`}>
        <span className={`cu-badge provider-${id}`}><ProviderIcon id={id} /></span>
        <span className="cu-provider-row__bars"><span className="cu-mini-sk" /><span className="cu-mini-sk" /></span>
      </span>
    );
  }
  if (mode === "na") {
    return (
      <span className="cu-provider-row is-na" title={NA_LABEL[id]} aria-label={`${meta.label} usage unavailable — ${NA_LABEL[id]}`}>
        <span className={`cu-badge provider-${id}`}><ProviderIcon id={id} /></span>
        <span className="cu-na">—</span>
      </span>
    );
  }

  const five = state.report?.fiveHour ?? null;
  const week = state.report?.sevenDay ?? null;
  return (
    <span
      className={`cu-provider-row${stale ? " is-stale" : ""}`}
      tabIndex={0}
      aria-label={`${meta.label} usage`}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span className={`cu-badge provider-${id}`}><ProviderIcon id={id} /></span>
      <span className="cu-provider-row__bars">
        <MiniWithReset win={five} now={now} stale={stale} />
        <MiniWithReset win={week} now={now} stale={stale} />
      </span>
      {open && (
        <span className="cu-provider-row__pop" role="tooltip">
          <ProviderGaugeGroup id={id} state={state} now={now} budget={budget} />
        </span>
      )}
    </span>
  );
}

/**
 * Compact always-visible usage strip for the tab bar: one row per provider (Claude,
 * Codex, z.ai), each its own hover/focus target with its own popover, plus a
 * daily-budget mini (Claude-only, unchanged from before).
 */
export function UsageStrip() {
  const multi = useMultiUsage();
  const budget = useBudget();
  return (
    <div className="cockpit-usage" aria-label="Account usage — Claude, Codex, z.ai">
      <MiniProviderRow id="claude" state={multi.claude} budget={budget} />
      <MiniProviderRow id="codex" state={multi.codex} />
      <MiniProviderRow id="zai" state={multi.zai} />
      {budget && <DayMini b={budget} stale={multi.claude.status === "stale"} />}
    </div>
  );
}

/** Full usage panel for Mission Control: one stacked block per provider + a local clock. */
export function UsagePanel() {
  const multi = useMultiUsage();
  const budget = useBudget();
  const now = useNow(1000);
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="cu-panel">
      <div className="cu-panel__label">
        <span>account usage</span>
      </div>
      <div className="cu-panel__providers">
        <ProviderGaugeGroup id="claude" state={multi.claude} now={now} budget={budget} />
        <ProviderGaugeGroup id="codex" state={multi.codex} now={now} />
        <ProviderGaugeGroup id="zai" state={multi.zai} now={now} />
      </div>
      <div className="cu-panel__clock"><b>{clock}</b><span>local</span></div>
    </div>
  );
}

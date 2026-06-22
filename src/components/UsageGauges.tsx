import { useEffect, useState } from "react";
import { useUsage, type UsageUiStatus } from "../lib/usageStore";
import type { UsageWindow } from "../lib/usageClient";
import { clampPct, levelFor, formatReset } from "../lib/usage";
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

/** Full instrument gauge for one window — used in the popover and the Mission Control panel. */
function Gauge({ label, win, now, stale, mode }: {
  label: string;
  win: UsageWindow | null;
  now: number;
  stale: boolean;
  mode: Mode;
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
    : mode === "na" ? "sign in to Claude" : "loading…";

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
        <span className="cu-gauge__reset"><span className="r">⟳</span>{reset}</span>
      </div>
    </div>
  );
}

/** One compact bar in the tab-bar strip. */
function Mini({ k, win, stale }: { k: string; win: UsageWindow | null; stale: boolean }) {
  const pct = clampPct(win?.utilization ?? 0);
  const level = levelFor(pct);
  const [w, setW] = useState(0);
  useEffect(() => {
    const id = requestAnimationFrame(() => setW(pct));
    return () => cancelAnimationFrame(id);
  }, [pct]);
  return (
    <span className={`cu-mini is-${level}${stale ? " is-stale" : ""}`}>
      <span className="cu-mini__k">{k}</span>
      <span className="cu-mini__track"><span className="cu-mini__fill" style={{ width: `${w}%` }} /></span>
      <span className="cu-mini__v">{pct}%</span>
    </span>
  );
}

/**
 * Compact always-visible usage strip for the tab bar: two mini gauges (5h / weekly).
 * Hover (or focus) opens a popover with full gauges + live reset countdowns.
 */
export function UsageStrip() {
  const { report, status } = useUsage();
  const [open, setOpen] = useState(false);
  const mode = modeOf(status, !!report);
  const five = report?.fiveHour ?? null;
  const week = report?.sevenDay ?? null;
  const stale = status === "stale";

  if (mode === "loading") {
    return (
      <div className="cockpit-usage is-loading" aria-label="Loading account usage">
        <span className="cu-mini-sk" /><span className="cu-mini-sk" />
      </div>
    );
  }
  if (mode === "na") {
    return (
      <div className="cockpit-usage is-na" title="Sign in to Claude Code to see usage" aria-label="Usage unavailable — sign in to Claude Code">
        <span className="cu-na">—</span><span className="cu-na__k">usage</span>
      </div>
    );
  }
  return (
    <div
      className={`cockpit-usage${stale ? " is-stale" : ""}`}
      tabIndex={0}
      aria-label="Account usage — 5-hour and weekly"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <Mini k="5h" win={five} stale={stale} />
      <Mini k="wk" win={week} stale={stale} />
      {open && <Popover five={five} week={week} stale={stale} />}
    </div>
  );
}

function Popover({ five, week, stale }: { five: UsageWindow | null; week: UsageWindow | null; stale: boolean }) {
  const now = useNow(1000);
  return (
    <div className="cu-pop" role="tooltip">
      <Gauge label="5-hour window" win={five} now={now} stale={stale} mode="data" />
      <Gauge label="Weekly · 7-day" win={week} now={now} stale={stale} mode="data" />
    </div>
  );
}

/** Full usage panel for Mission Control: both windows at full size + a local clock. */
export function UsagePanel() {
  const { report, status } = useUsage();
  const now = useNow(1000);
  const mode = modeOf(status, !!report);
  const five = report?.fiveHour ?? null;
  const week = report?.sevenDay ?? null;
  const stale = status === "stale";
  const d = new Date(now);
  const clock = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

  return (
    <div className="cu-panel">
      <div className="cu-panel__label">
        <span>account usage</span>
        {stale && <span className="cu-panel__flag">stale</span>}
        {mode === "na" && <span className="cu-panel__flag">sign in</span>}
      </div>
      <div className="cu-panel__gauges">
        <Gauge label="5-hour window" win={five} now={now} stale={stale} mode={mode} />
        <Gauge label="Weekly · 7-day" win={week} now={now} stale={stale} mode={mode} />
      </div>
      <div className="cu-panel__clock"><b>{clock}</b><span>local</span></div>
    </div>
  );
}

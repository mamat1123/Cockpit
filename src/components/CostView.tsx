import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import { costReport, type CostReport, type SessionMeta } from "../lib/costClient";
import { filterByPeriod, byProject, byModel, byDay, bySession, totalCost, tierTokens, type Period } from "../lib/costAggregate";
import { EChart } from "./EChart";
import "./CostView.css";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "all", label: "All" },
];
const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;

/** Read a live CSS custom property off :root (the active theme), with a fallback for SSR/tests. */
function cssVar(name: string, fallback = ""): string {
  if (typeof document === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export function CostView({ onJump }: { onJump: (sessionId: string, cwd: string) => void }) {
  const [report, setReport] = useState<CostReport>({ buckets: [], sessions: [] });
  const [period, setPeriod] = useState<Period>("7d");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const load = async () => {
      if (inFlight) return; // first scan can take a while (hundreds of MB of logs) — don't pile up
      inFlight = true;
      try { const r = await costReport(); if (alive) setReport(r); }
      catch { /* not under tauri */ }
      finally { inFlight = false; if (alive) setLoading(false); }
    };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const f = useMemo(() => filterByPeriod(report.buckets, period), [report, period]);
  const total = totalCost(f);
  const days = byDay(f), projects = byProject(f), models = byModel(f), tiers = tierTokens(f);
  const projectCount = new Set(f.map((b) => b.project)).size;

  // Read live theme tokens off :root each render so a freshly-opened Cost overlay shows
  // the active theme's colors (the overlay mounts after applyTheme has run).
  const accent = cssVar("--ck-accent", "#F5A623");
  const text = cssVar("--ck-text", "#C8CDD6");
  const bright = cssVar("--ck-bright", "#EDEFF3");
  const muted = cssVar("--ck-muted", "#565d68");
  const border = cssVar("--ck-border", "#262A33");
  const bg = cssVar("--ck-bg", "#0E1014");
  const surface = cssVar("--ck-surface", "#181B22");
  const PALETTE = [accent, cssVar("--ck-blue", "#7C9CFF"), cssVar("--ck-idle", "#3ECF8E"), cssVar("--ck-magenta", "#c06ad6"), cssVar("--ck-yellow", "#F5A623"), cssVar("--ck-cyan", "#56b6c2")];
  const axis = { axisLine: { lineStyle: { color: border } }, axisLabel: { color: muted, fontSize: 10 }, axisTick: { show: false } };
  const tip = { backgroundColor: surface, borderColor: border, textStyle: { color: text, fontFamily: "ui-monospace, Menlo, monospace" } };
  const base = { backgroundColor: "transparent", textStyle: { fontFamily: "ui-monospace, Menlo, monospace" }, animationDuration: 600, animationEasing: "cubicOut" as const };

  const dailyOpt: echarts.EChartsOption = {
    ...base, grid: { left: 46, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "category", data: days.map((d) => d.name.slice(5)), ...axis },
    yAxis: { type: "value", axisLabel: { color: muted, fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: border } } },
    series: [{ type: "bar", data: days.map((d) => +d.usd.toFixed(4)),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: accent }, { offset: 1, color: cssVar("--ck-yellow", "#c9851d") }]), borderRadius: [4, 4, 0, 0] },
      animationDelay: (i: number) => i * 28 }],
  };
  const projOpt: echarts.EChartsOption = {
    ...base, grid: { left: 4, right: 56, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: projects.map((p) => p.name).reverse(), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: text, fontSize: 11.5 } },
    series: [{ type: "bar", data: projects.map((p) => +p.usd.toFixed(4)).reverse(), barWidth: 10,
      itemStyle: { color: accent, borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right", formatter: (p: { value?: unknown }) => usd(+(p.value as number)), color: bright, fontSize: 11 } }],
  };
  const modelOpt: echarts.EChartsOption = {
    ...base, color: PALETTE,
    tooltip: { trigger: "item", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    legend: { orient: "vertical", right: 4, top: "center", textStyle: { color: text, fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }, icon: "roundRect" },
    series: [{ type: "pie", radius: ["56%", "82%"], center: ["32%", "50%"], data: models.map((m) => ({ name: m.name.replace("claude-", ""), value: +m.usd.toFixed(4) })),
      label: { show: false }, itemStyle: { borderColor: bg, borderWidth: 2 } }],
  };

  const tierTotal = tiers.cacheRead + tiers.input + tiers.cacheWrite + tiers.output || 1;
  const pct = (n: number) => (n / tierTotal) * 100;
  const tierColors = {
    cacheRead: cssVar("--ck-surface-2", "#3a4150"),
    input: cssVar("--ck-dim", "#5a6472"),
    cacheWrite: cssVar("--ck-blue", "#7C9CFF"),
    output: accent,
  };

  const metaBy = useMemo(() => Object.fromEntries(report.sessions.map((s) => [s.session, s])), [report.sessions]);
  const sessions = bySession(f).map((s) => ({ ...s, meta: metaBy[s.name] as SessionMeta | undefined })).filter((s) => s.usd > 0);

  return (
    <div className="cost">
      <div className="cost__head">
        <div>
          <p className="cost__eyebrow">Total spend · {PERIODS.find((p) => p.id === period)!.label.toLowerCase()}</p>
          <div className="cost__total">{usd(total)}</div>
          <p className="cost__sub">across {projectCount} project{projectCount === 1 ? "" : "s"}</p>
        </div>
        <div className="cost__tabs">
          {PERIODS.map((p) => (
            <button key={p.id} className={period === p.id ? "on" : ""} onClick={() => setPeriod(p.id)}>{p.label}</button>
          ))}
        </div>
      </div>

      {loading && report.buckets.length === 0 && (
        <div className="cost__loading">⏳ computing from your ~/.claude logs…</div>
      )}

      <div className="cost__card">
        <h4>Daily spend</h4>
        <EChart option={dailyOpt} height={180} />
      </div>

      <div className="cost__grid">
        <div className="cost__card"><h4>By project</h4><EChart option={projOpt} height={Math.max(120, projects.length * 30)} /></div>
        <div className="cost__card"><h4>By model</h4><EChart option={modelOpt} height={150} /></div>
      </div>

      <div className="cost__card">
        <h4>Where the tokens go</h4>
        <div className="cost__stack">
          <span style={{ width: `${pct(tiers.cacheRead)}%`, background: tierColors.cacheRead }} />
          <span style={{ width: `${pct(tiers.input)}%`, background: tierColors.input }} />
          <span style={{ width: `${pct(tiers.cacheWrite)}%`, background: tierColors.cacheWrite }} />
          <span style={{ width: `${pct(tiers.output)}%`, background: tierColors.output }} />
        </div>
        <div className="cost__tiers">
          <span><i style={{ background: tierColors.cacheRead }} />cache read {pct(tiers.cacheRead).toFixed(0)}%</span>
          <span><i style={{ background: tierColors.input }} />input {pct(tiers.input).toFixed(0)}%</span>
          <span><i style={{ background: tierColors.cacheWrite }} />cache write {pct(tiers.cacheWrite).toFixed(0)}%</span>
          <span><i style={{ background: tierColors.output }} />output {pct(tiers.output).toFixed(0)}%</span>
        </div>
      </div>
      <div className="cost__card">
        <h4>By session</h4>
        <div className="cost__sessions">
          {sessions.length === 0 ? (
            <p className="cost__empty">No sessions in this period.</p>
          ) : (
            sessions.map((s) => (
              <button key={s.name} className="cost__srow" onClick={() => s.meta && onJump(s.name, s.meta.cwd)} title="jump to / resume this session">
                <span className="cost__sname">{s.meta?.title || s.meta?.project || s.name.slice(0, 8)}</span>
                <span className="cost__sproj">{s.meta?.project ?? ""}</span>
                <span className="cost__samt">{usd(s.usd)}</span>
                <span className="cost__sjump">↵</span>
              </button>
            ))
          )}
        </div>
      </div>
      <p className="cost__foot">Computed from ~/.claude logs · deduped by message id · matches /cost · prices editable</p>
    </div>
  );
}

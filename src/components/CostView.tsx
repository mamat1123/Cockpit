import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts";
import { costReport, type Bucket } from "../lib/costClient";
import { filterByPeriod, byProject, byModel, byDay, totalCost, tierTokens, type Period } from "../lib/costAggregate";
import { EChart } from "./EChart";
import "./CostView.css";

const PERIODS: { id: Period; label: string }[] = [
  { id: "today", label: "Today" }, { id: "7d", label: "7 days" }, { id: "30d", label: "30 days" }, { id: "all", label: "All" },
];
const usd = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;
const PALETTE = ["#F5A623", "#3ECF8E", "#7C9CFF", "#5a6472", "#c06ad6"];
const axis = { axisLine: { lineStyle: { color: "#262A33" } }, axisLabel: { color: "#565d68", fontSize: 10 }, axisTick: { show: false } };
const tip = { backgroundColor: "#181B22", borderColor: "#262A33", textStyle: { color: "#C8CDD6", fontFamily: "ui-monospace, Menlo, monospace" } };
const base = { backgroundColor: "transparent", textStyle: { fontFamily: "ui-monospace, Menlo, monospace" }, animationDuration: 600, animationEasing: "cubicOut" as const };

export function CostView() {
  const [buckets, setBuckets] = useState<Bucket[]>([]);
  const [period, setPeriod] = useState<Period>("7d");
  useEffect(() => {
    let alive = true;
    const load = async () => { try { const b = await costReport(); if (alive) setBuckets(b); } catch { /* not under tauri */ } };
    void load();
    const id = setInterval(() => void load(), 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const f = useMemo(() => filterByPeriod(buckets, period), [buckets, period]);
  const total = totalCost(f);
  const days = byDay(f), projects = byProject(f), models = byModel(f), tiers = tierTokens(f);
  const projectCount = new Set(f.map((b) => b.project)).size;

  const dailyOpt: echarts.EChartsOption = {
    ...base, grid: { left: 46, right: 14, top: 16, bottom: 24 },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "category", data: days.map((d) => d.name.slice(5)), ...axis },
    yAxis: { type: "value", axisLabel: { color: "#565d68", fontSize: 10, formatter: (v: number) => `$${v}` }, splitLine: { lineStyle: { color: "#1a1e26" } } },
    series: [{ type: "bar", data: days.map((d) => +d.usd.toFixed(4)),
      itemStyle: { color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [{ offset: 0, color: "#F5A623" }, { offset: 1, color: "#c9851d" }]), borderRadius: [4, 4, 0, 0] },
      animationDelay: (i: number) => i * 28 }],
  };
  const projOpt: echarts.EChartsOption = {
    ...base, grid: { left: 4, right: 56, top: 6, bottom: 6, containLabel: true },
    tooltip: { trigger: "axis", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    xAxis: { type: "value", show: false },
    yAxis: { type: "category", data: projects.map((p) => p.name).reverse(), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: "#C8CDD6", fontSize: 11.5 } },
    series: [{ type: "bar", data: projects.map((p) => +p.usd.toFixed(4)).reverse(), barWidth: 10,
      itemStyle: { color: "#F5A623", borderRadius: [0, 5, 5, 0] },
      label: { show: true, position: "right", formatter: (p: { value?: unknown }) => usd(+(p.value as number)), color: "#EDEFF3", fontSize: 11 } }],
  };
  const modelOpt: echarts.EChartsOption = {
    ...base, color: PALETTE,
    tooltip: { trigger: "item", ...tip, valueFormatter: (v) => usd(+(v as number)) },
    legend: { orient: "vertical", right: 4, top: "center", textStyle: { color: "#C8CDD6", fontFamily: "ui-monospace, Menlo, monospace", fontSize: 11 }, icon: "roundRect" },
    series: [{ type: "pie", radius: ["56%", "82%"], center: ["32%", "50%"], data: models.map((m) => ({ name: m.name.replace("claude-", ""), value: +m.usd.toFixed(4) })),
      label: { show: false }, itemStyle: { borderColor: "#0E1014", borderWidth: 2 } }],
  };

  const tierTotal = tiers.cacheRead + tiers.input + tiers.cacheWrite + tiers.output || 1;
  const pct = (n: number) => (n / tierTotal) * 100;

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
          <span style={{ width: `${pct(tiers.cacheRead)}%`, background: "#3a4150" }} />
          <span style={{ width: `${pct(tiers.input)}%`, background: "#5a6472" }} />
          <span style={{ width: `${pct(tiers.cacheWrite)}%`, background: "#7C9CFF" }} />
          <span style={{ width: `${pct(tiers.output)}%`, background: "#F5A623" }} />
        </div>
        <div className="cost__tiers">
          <span><i style={{ background: "#3a4150" }} />cache read {pct(tiers.cacheRead).toFixed(0)}%</span>
          <span><i style={{ background: "#5a6472" }} />input {pct(tiers.input).toFixed(0)}%</span>
          <span><i style={{ background: "#7C9CFF" }} />cache write {pct(tiers.cacheWrite).toFixed(0)}%</span>
          <span><i style={{ background: "#F5A623" }} />output {pct(tiers.output).toFixed(0)}%</span>
        </div>
      </div>
      <p className="cost__foot">Computed from ~/.claude logs · deduped by message id · matches /cost · prices editable</p>
    </div>
  );
}

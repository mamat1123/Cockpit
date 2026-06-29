import { useEffect, useState } from "react";
import type { Layout } from "../layout/paneLayout";
import { overviewItems } from "./paneFlatten";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { sessionUsage } from "../lib/costClient";
import { costOf } from "../lib/pricing";
import { CostView } from "./CostView";
import { UsagePanel } from "./UsageGauges";
import "./Dashboard.css";

function ago(last: number | null, now: number): string {
  if (last == null) return "—";
  const s = Math.round((now - last) / 1000);
  if (s < 2) return "just now";
  if (s < 60) return `~${s}s ago`;
  return `${Math.round(s / 60)}m idle`;
}

export function Dashboard({ layout, onJump, onJumpSession, onClose }: {
  layout: Layout;
  onJump: (tabId: string, paneId: string) => void;
  onJumpSession: (sessionId: string, cwd: string) => void;
  onClose: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const [view, setView] = useState<"sessions" | "cost">("sessions");
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 400);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.preventDefault(); onClose(); } };
    window.addEventListener("keydown", onKey, true);
    return () => { clearInterval(id); window.removeEventListener("keydown", onKey, true); };
  }, [onClose]);

  const [costs, setCosts] = useState<Record<string, number>>({});
  useEffect(() => {
    let alive = true;
    const fetchAll = async () => {
      const list = overviewItems(layout);
      const pairs = await Promise.all(list.map(async (it) => {
        try { return [it.paneId, costOf(await sessionUsage(it.cwd, it.sessionId))] as const; }
        catch { return [it.paneId, 0] as const; }
      }));
      if (alive) setCosts(Object.fromEntries(pairs));
    };
    void fetchAll();
    const id = setInterval(() => void fetchAll(), 3000);
    return () => { alive = false; clearInterval(id); };
  }, [layout]);

  const fmt = (n: number) => `$${n > 0 && n < 0.01 ? n.toFixed(3) : n.toFixed(2)}`;
  const totalCost = Object.values(costs).reduce((s, v) => s + v, 0);

  const items = overviewItems(layout).map((it) => {
    const last = paneLastLineAt(it.paneId);
    return { ...it, working: deriveState({ lastLineAt: last }, now, 800) === "working", when: ago(last, now) };
  });
  const workCount = items.filter((i) => i.working).length;

  return (
    <div className="cockpit-dash" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="cockpit-dash__panel" role="dialog" aria-label="Mission Control">
        <div className="cockpit-dash__ribbon">
          <div className="cockpit-dash__brand">
            <h2>Mission Control</h2>
            <span>every Claude session, one glance · Esc to close</span>
          </div>
          <div className="cockpit-dash__viewtabs">
            <button className={view === "sessions" ? "on" : ""} onClick={() => setView("sessions")}>Sessions</button>
            <button className={view === "cost" ? "on" : ""} onClick={() => setView("cost")}>Cost</button>
          </div>
          {view === "sessions" && (
          <div className="cockpit-dash__readout">
            <div className="cockpit-dash__stat"><b>{items.length}</b><span>sessions</span></div>
            <div className="cockpit-dash__stat is-work"><b>{workCount}</b><span>working</span></div>
            <div className="cockpit-dash__stat is-idle"><b>{items.length - workCount}</b><span>idle</span></div>
            <div className="cockpit-dash__stat is-cost"><b>{fmt(totalCost)}</b><span>total</span></div>
          </div>
          )}
        </div>
        <UsagePanel />
        {view === "sessions" && (
        <div className="cockpit-dash__grid">
          {items.map((it) => (
            <button
              key={it.paneId}
              className={`cockpit-bay${it.working ? " is-working" : ""}`}
              onClick={() => onJump(it.tabId, it.paneId)}
            >
              <span className="cockpit-bay__rail" />
              <span className="cockpit-bay__body">
                <span className="cockpit-bay__top">
                  <span className="cockpit-bay__name">{it.title}</span>
                  <span className="cockpit-bay__loc">tab {it.tabIndex}</span>
                </span>
                <span className="cockpit-bay__path">{it.cwd}</span>
                <span className="cockpit-bay__status">
                  <span className="cockpit-bay__badge">
                    <span className="cockpit-bay__dot" />
                    <span className="cockpit-bay__bars"><i /><i /><i /></span>
                    {it.working ? "working" : "idle"}
                  </span>
                  <span className="cockpit-bay__when">{it.when}</span>
                  <span className="cockpit-bay__cost">{fmt(costs[it.paneId] ?? 0)}</span>
                </span>
                <span className="cockpit-bay__jump">↵ jump</span>
              </span>
            </button>
          ))}
        </div>
        )}
        {view === "cost" && <CostView onJump={onJumpSession} />}
      </div>
    </div>
  );
}

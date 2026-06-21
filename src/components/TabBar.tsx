import { useEffect, useRef, useState } from "react";
import type { Layout, Tab } from "../layout/paneLayout";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import "./TabBar.css";

const svgProps = { width: 19, height: 19, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinejoin: "round" as const, strokeLinecap: "round" as const };

/** Mission Control — 2×2 grid of session cards (one live). */
const GridIcon = () => (
  <svg {...svgProps}>
    <rect x="3" y="3" width="8" height="8" rx="2" />
    <rect x="13" y="3" width="8" height="8" rx="2" fill="currentColor" stroke="none" />
    <rect x="3" y="13" width="8" height="8" rx="2" />
    <rect x="13" y="13" width="8" height="8" rx="2" />
  </svg>
);
/** Workspaces — stacked layers (saved layouts). */
const LayersIcon = () => (
  <svg {...svgProps}>
    <path d="M12 3 L21 8 L12 13 L3 8 Z" />
    <path d="M3 12 L12 17 L21 12" />
    <path d="M3 16 L12 21 L21 16" />
  </svg>
);
/** Open project — folder + new. */
const FolderPlusIcon = () => (
  <svg {...svgProps}>
    <path d="M3 7a2 2 0 0 1 2-2h3.5l2 2H19a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    <path d="M12 11v6M9 14h6" />
  </svg>
);

function tabName(t: Tab): string {
  const base = t.rows.flatMap((r) => r.panes)[0]?.title || "shell";
  return base.length > 24 ? base.slice(0, 24) + "…" : base;
}
const paneCount = (t: Tab): number => t.rows.reduce((n, r) => n + r.panes.length, 0);

/** Settings — gear. */
const SettingsIcon = () => (
  <svg {...svgProps}>
    <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1Z" />
  </svg>
);

export function TabBar({ layout, attention, onSelect, onReorder, onOpenDashboard, onOpenPicker, onOpenWorkspaces, onOpenSettings }: {
  layout: Layout;
  attention: Set<string>;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onOpenDashboard: () => void;
  onOpenPicker: () => void;
  onOpenWorkspaces: () => void;
  onOpenSettings: () => void;
}) {
  // per-tab aggregate working state (any pane in the tab thinking) — drives the dot/equalizer
  const [working, setWorking] = useState<Set<string>>(() => new Set());
  const layoutRef = useRef(layout);
  layoutRef.current = layout;
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const w = new Set<string>();
      for (const t of layoutRef.current.tabs) {
        if (t.rows.some((r) => r.panes.some((p) => deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working"))) {
          w.add(t.id);
        }
      }
      setWorking((prev) => (prev.size === w.size && [...w].every((x) => prev.has(x)) ? prev : w));
    }, 400);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="cockpit-tabs">
      <div className="cockpit-tabs__list">
        {layout.tabs.map((t, i) => {
          const active = t.id === layout.activeTabId;
          const isWorking = working.has(t.id);
          const attn = attention.has(t.id) && !active;
          return (
            <button
              key={t.id}
              className={`cockpit-tab${active ? " is-active" : ""}${attn ? " is-attention" : ""}`}
              draggable
              onClick={() => onSelect(t.id)}
              onDragStart={(e) => e.dataTransfer.setData("text/plain", t.id)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                const fromId = e.dataTransfer.getData("text/plain");
                if (fromId && fromId !== t.id) onReorder(fromId, i);
              }}
            >
              {isWorking ? (
                <span className="cockpit-tab__eq" aria-hidden="true"><i /><i /><i /></span>
              ) : (
                <span className="cockpit-tab__dot" aria-hidden="true" />
              )}
              <span className="cockpit-tab__title">{tabName(t)}</span>
              <span className="cockpit-tab__ct">{paneCount(t)}</span>
            </button>
          );
        })}
      </div>
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
      <div className="cockpit-tabs__tools">
        <button className="cockpit-tool" onClick={onOpenDashboard} aria-label="Mission Control (Cmd+0)" title="Mission Control (⌘0)"><GridIcon /></button>
        <button className="cockpit-tool" onClick={onOpenWorkspaces} aria-label="Workspaces (Cmd+E)" title="Workspaces (⌘E)"><LayersIcon /></button>
        <button className="cockpit-tool" onClick={onOpenSettings} aria-label="Settings (Cmd+,)" title="Settings (⌘,)"><SettingsIcon /></button>
        <button className="cockpit-tool cockpit-tool--add" onClick={onOpenPicker} aria-label="Open project (Cmd+O)" title="Open project (⌘O)"><FolderPlusIcon /></button>
      </div>
    </div>
  );
}

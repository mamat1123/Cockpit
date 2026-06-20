import type { Layout, Tab } from "../layout/paneLayout";
import "./TabBar.css";

function tabTitle(t: Tab): string {
  const panes = t.rows.flatMap((r) => r.panes);
  const base = panes[0]?.title || "shell";
  const name = base.length > 28 ? base.slice(0, 28) + "…" : base;
  return panes.length > 1 ? `${name} · ${panes.length}` : name;
}

export function TabBar({ layout, onSelect, onNewTab, onReorder, onOpenDashboard }: {
  layout: Layout;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
  onOpenDashboard: () => void;
}) {
  return (
    <div className="cockpit-tabs">
      {layout.tabs.map((t, i) => (
        <button
          key={t.id}
          className={`cockpit-tab${t.id === layout.activeTabId ? " is-active" : ""}`}
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
          <span className="cockpit-tab__title">{tabTitle(t)}</span>
        </button>
      ))}
      <button className="cockpit-tab cockpit-tab--new" onClick={onOpenDashboard} aria-label="Mission Control (Cmd+0)" title="Mission Control (⌘0)">▦</button>
      <button className="cockpit-tab cockpit-tab--new" onClick={onNewTab} aria-label="New tab (Cmd+T)">+</button>
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
    </div>
  );
}

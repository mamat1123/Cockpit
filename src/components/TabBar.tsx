import type { Layout } from "../layout/paneLayout";
import "./TabBar.css";

export function TabBar({ layout, onSelect, onNewTab, onReorder }: {
  layout: Layout;
  onSelect: (tabId: string) => void;
  onNewTab: () => void;
  onReorder: (tabId: string, toIndex: number) => void;
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
          {`${i + 1} · ${t.rows.reduce((n, r) => n + r.panes.length, 0)}▦`}
        </button>
      ))}
      <button className="cockpit-tab cockpit-tab--new" onClick={onNewTab} aria-label="New tab (Cmd+T)">+</button>
      <div className="cockpit-tabs__drag" data-tauri-drag-region></div>
    </div>
  );
}

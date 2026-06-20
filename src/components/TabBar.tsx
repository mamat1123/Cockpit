import type { Layout } from "../layout/paneLayout";
import "./TabBar.css";

export function TabBar({ layout, onSelect, onNewTab }: {
  layout: Layout; onSelect: (tabId: string) => void; onNewTab: () => void;
}) {
  return (
    <div className="cockpit-tabs">
      {layout.tabs.map((t, i) => (
        <button
          key={t.id}
          className={`cockpit-tab${t.id === layout.activeTabId ? " is-active" : ""}`}
          onClick={() => onSelect(t.id)}
        >
          {`${i + 1} · ${t.rows.reduce((n, r) => n + r.panes.length, 0)}▦`}
        </button>
      ))}
      <button className="cockpit-tab cockpit-tab--new" onClick={onNewTab} aria-label="New tab (Cmd+T)">+</button>
    </div>
  );
}

import { useReducer } from "react";
import { reduce, initLayout } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TerminalPane } from "./TerminalPane";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

export function CockpitView() {
  const [layout, dispatch] = useReducer(reduce, DEFAULT_CWD, initLayout);
  useKeybindings(dispatch);
  const tab = layout.tabs.find((t) => t.id === layout.activeTabId)!;

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#14161B" }}>
      <TabBar
        layout={layout}
        onSelect={(tabId) => dispatch({ type: "focusTab", tabId })}
        onNewTab={() => dispatch({ type: "newTab" })}
      />
      <div style={{ flex: 1, display: "flex", gap: 6, padding: 6, minHeight: 0 }}>
        {tab.panes.map((p) => (
          <TerminalPane
            key={p.id}
            paneId={p.id}
            cwd={p.cwd}
            focused={p.id === layout.focusedPaneId}
            onFocus={() => dispatch({ type: "focusPane", paneId: p.id })}
          />
        ))}
      </div>
    </div>
  );
}

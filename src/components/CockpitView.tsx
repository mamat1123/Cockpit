import { useReducer } from "react";
import { reduce, initLayout } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TerminalPane } from "./TerminalPane";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

export function CockpitView() {
  const [layout, dispatch] = useReducer(reduce, DEFAULT_CWD, initLayout);
  useKeybindings(dispatch);

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#14161B" }}>
      <TabBar
        layout={layout}
        onSelect={(tabId) => dispatch({ type: "focusTab", tabId })}
        onNewTab={() => dispatch({ type: "newTab" })}
        onReorder={(tabId, toIndex) => dispatch({ type: "moveTab", tabId, toIndex })}
      />
      <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
        {layout.tabs.map((t) => (
          <div
            key={t.id}
            style={{
              position: "absolute",
              inset: 0,
              display: t.id === layout.activeTabId ? "flex" : "none",
              flexDirection: "column",
              gap: 6,
              padding: 6,
            }}
          >
            {t.rows.map((r) => (
              <div key={r.id} style={{ flex: 1, display: "flex", gap: 6, minHeight: 0 }}>
                {r.panes.map((p) => (
                  <TerminalPane
                    key={p.id}
                    paneId={p.id}
                    cwd={p.cwd}
                    focused={p.id === layout.focusedPaneId}
                    onFocus={() => dispatch({ type: "focusPane", paneId: p.id })}
                  />
                ))}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

import { useReducer } from "react";
import { reduce, initLayout } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TabPanes } from "./TabPanes";

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
          <TabPanes
            key={t.id}
            tab={t}
            active={t.id === layout.activeTabId}
            focusedPaneId={layout.focusedPaneId}
            dispatch={dispatch}
          />
        ))}
      </div>
    </div>
  );
}

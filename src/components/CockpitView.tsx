import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { reduce, initLayout, type Layout } from "../layout/paneLayout";
import { useKeybindings } from "../layout/useKeybindings";
import { TabBar } from "./TabBar";
import { TabPanes } from "./TabPanes";
import { PaneHost } from "./PaneHost";
import { killPty } from "../lib/ptyClient";
import { stopLogtail } from "../lib/logClient";

const DEFAULT_CWD = "/Users/theerametsaengsin/Work/mee-tang/app";

function livePaneIds(l: Layout): Set<string> {
  return new Set(l.tabs.flatMap((t) => t.rows.flatMap((r) => r.panes.map((p) => p.id))));
}

export function CockpitView() {
  const [layout, dispatch] = useReducer(reduce, DEFAULT_CWD, initLayout);
  useKeybindings(dispatch);

  const [slots, setSlots] = useState<Record<string, HTMLElement>>({});
  const registerSlot = useCallback((paneId: string, el: HTMLElement | null) => {
    setSlots((prev) => {
      if (el) { if (prev[paneId] === el) return prev; return { ...prev, [paneId]: el }; }
      if (!(paneId in prev)) return prev;
      const next = { ...prev }; delete next[paneId]; return next;
    });
  }, []);

  // Kill the PTY + logtail of panes that were actually removed (closed), NOT panes
  // that merely moved tabs (those are still live in the layout, just re-slotted).
  const prevIds = useRef(livePaneIds(layout));
  useEffect(() => {
    const now = livePaneIds(layout);
    for (const id of prevIds.current) {
      if (!now.has(id)) { void killPty(id); void stopLogtail(id); }
    }
    prevIds.current = now;
  }, [layout]);

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
            dispatch={dispatch}
            registerSlot={registerSlot}
          />
        ))}
      </div>
      <PaneHost layout={layout} slots={slots} dispatch={dispatch} />
    </div>
  );
}

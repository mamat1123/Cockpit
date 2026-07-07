import { Fragment, useEffect, useRef } from "react";
import type { Action, Row, Tab } from "../layout/paneLayout";
import { Divider } from "./Divider";
import { refit } from "../lib/terminalRegistry";

function RowPanes({ row, dispatch, registerSlot }: {
  row: Row; dispatch: (a: Action) => void; registerSlot: (paneId: string) => (el: HTMLElement | null) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rowRef} style={{ flex: `${row.size} 1 0`, display: "flex", minHeight: 0, minWidth: 0 }}>
      {row.panes.map((p, pi) => (
        <Fragment key={p.id}>
          <div
            ref={registerSlot(p.id)}
            style={{ flex: `${p.size} 1 0`, display: "flex", minWidth: 0 }}
          />
          {pi < row.panes.length - 1 && (
            <Divider
              axis="x"
              containerPx={() => rowRef.current?.clientWidth ?? 1}
              onResize={(df) => {
                const sizes = row.panes.map((x) => x.size);
                const total = sizes.reduce((s, v) => s + v, 0);
                const move = df * total;
                sizes[pi] = Math.max(0.1, sizes[pi] + move);
                sizes[pi + 1] = Math.max(0.1, sizes[pi + 1] - move);
                dispatch({ type: "setPaneSizes", rowId: row.id, sizes });
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

export function TabPanes({ tab, active, revealed, dispatch, registerSlot }: {
  tab: Tab; active: boolean; revealed: boolean; dispatch: (a: Action) => void; registerSlot: (paneId: string) => (el: HTMLElement | null) => void;
}) {
  const colRef = useRef<HTMLDivElement>(null);

  // Force every pane in this tab to refit when the tab becomes active or its pane
  // membership changes (pop-out / close / split). A ResizeObserver alone misses the
  // display:none -> flex transition in the webview, leaving a freshly-revealed or
  // newly-widened pane stuck at its old (smaller) grid until the next manual resize.
  // The same blind spot applies one level up when canvas mode re-reveals the whole
  // tab stack — `revealed` re-fires this effect on the way back.
  const paneIdsKey = tab.rows.flatMap((r) => r.panes.map((p) => p.id)).join(",");
  useEffect(() => {
    if (!active || !revealed) return;
    const id = requestAnimationFrame(() => {
      tab.rows.flatMap((r) => r.panes).forEach((p) => refit(p.id));
    });
    return () => cancelAnimationFrame(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, revealed, paneIdsKey]);

  return (
    <div
      ref={colRef}
      style={{ position: "absolute", inset: 0, display: active ? "flex" : "none", flexDirection: "column", padding: 6, minHeight: 0 }}
    >
      {tab.rows.map((r, ri) => (
        <Fragment key={r.id}>
          <RowPanes row={r} dispatch={dispatch} registerSlot={registerSlot} />
          {ri < tab.rows.length - 1 && (
            <Divider
              axis="y"
              containerPx={() => colRef.current?.clientHeight ?? 1}
              onResize={(df) => {
                const sizes = tab.rows.map((x) => x.size);
                const total = sizes.reduce((s, v) => s + v, 0);
                const move = df * total;
                sizes[ri] = Math.max(0.1, sizes[ri] + move);
                sizes[ri + 1] = Math.max(0.1, sizes[ri + 1] - move);
                dispatch({ type: "setRowSizes", tabId: tab.id, sizes });
              }}
            />
          )}
        </Fragment>
      ))}
    </div>
  );
}

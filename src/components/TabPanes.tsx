import { Fragment, useRef } from "react";
import type { Action, Row, Tab } from "../layout/paneLayout";
import { TerminalPane } from "./TerminalPane";
import { Divider } from "./Divider";

function RowPanes({ row, focusedPaneId, dispatch }: {
  row: Row; focusedPaneId: string; dispatch: (a: Action) => void;
}) {
  const rowRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={rowRef} style={{ flex: `${row.size} 1 0`, display: "flex", minHeight: 0, minWidth: 0 }}>
      {row.panes.map((p, pi) => (
        <Fragment key={p.id}>
          <div style={{ flex: `${p.size} 1 0`, display: "flex", minWidth: 0 }}>
            <TerminalPane
              paneId={p.id}
              cwd={p.cwd}
              title={p.title}
              focused={p.id === focusedPaneId}
              onFocus={() => dispatch({ type: "focusPane", paneId: p.id })}
              onRename={(t) => dispatch({ type: "renamePane", paneId: p.id, title: t })}
              onAutoTitle={(t) => dispatch({ type: "autoTitlePane", paneId: p.id, title: t })}
              onPopOut={() => dispatch({ type: "popOut", paneId: p.id })}
              onClose={() => { dispatch({ type: "focusPane", paneId: p.id }); dispatch({ type: "close" }); }}
              dragProps={{
                draggable: true,
                onDragStart: (e) => { e.dataTransfer.setData("text/plain", p.id); e.dataTransfer.effectAllowed = "move"; },
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
                onDrop: (e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData("text/plain");
                  if (fromId && fromId !== p.id) dispatch({ type: "movePaneAfter", paneId: fromId, targetPaneId: p.id });
                },
              }}
            />
          </div>
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

export function TabPanes({ tab, active, focusedPaneId, dispatch }: {
  tab: Tab; active: boolean; focusedPaneId: string; dispatch: (a: Action) => void;
}) {
  const colRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={colRef}
      style={{
        position: "absolute", inset: 0,
        display: active ? "flex" : "none",
        flexDirection: "column", padding: 6, minHeight: 0,
      }}
    >
      {tab.rows.map((r, ri) => (
        <Fragment key={r.id}>
          <RowPanes row={r} focusedPaneId={focusedPaneId} dispatch={dispatch} />
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

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Action, Layout } from "../layout/paneLayout";
import { flattenPanes } from "./paneFlatten";
import { TerminalPane } from "./TerminalPane";

/** Mounts every pane's TerminalPane ONCE and portals it into the DOM slot for its
 *  current position. Moving a pane between tabs only retargets the portal, so the
 *  xterm + PTY + scrollback survive (no remount). While a slot is momentarily absent
 *  (mid-move), the pane parks in a hidden node so it stays mounted. */
export function PaneHost({ layout, slots, dispatch }: {
  layout: Layout;
  slots: Record<string, HTMLElement>;
  dispatch: (a: Action) => void;
}) {
  const parkRef = useRef<HTMLDivElement>(null);
  const [, force] = useState(0);
  useEffect(() => { force((n) => n + 1); }, []); // re-render once parkRef is mounted

  const park = parkRef.current;
  return (
    <>
      <div ref={parkRef} style={{ display: "none" }} />
      {park &&
        flattenPanes(layout).map(({ pane }) =>
          createPortal(
            <TerminalPane
              paneId={pane.id}
              cwd={pane.cwd}
              sessionId={pane.sessionId}
              title={pane.title}
              focused={pane.id === layout.focusedPaneId}
              onFocus={() => dispatch({ type: "focusPane", paneId: pane.id })}
              onRename={(t) => dispatch({ type: "renamePane", paneId: pane.id, title: t })}
              onAutoTitle={(t) => dispatch({ type: "autoTitlePane", paneId: pane.id, title: t })}
              onPopOut={() => dispatch({ type: "popOut", paneId: pane.id })}
              onClose={() => { dispatch({ type: "focusPane", paneId: pane.id }); dispatch({ type: "close" }); }}
              dragProps={{
                draggable: true,
                onDragStart: (e) => { e.dataTransfer.setData("text/plain", pane.id); e.dataTransfer.effectAllowed = "move"; },
                onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; },
                onDrop: (e) => {
                  e.preventDefault();
                  const fromId = e.dataTransfer.getData("text/plain");
                  if (fromId && fromId !== pane.id) dispatch({ type: "movePaneAfter", paneId: fromId, targetPaneId: pane.id });
                },
              }}
            />,
            slots[pane.id] ?? park,
            pane.id,
          ),
        )}
    </>
  );
}

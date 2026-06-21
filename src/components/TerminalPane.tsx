import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { debounce } from "../lib/debounce";
import { deriveState, type PaneState } from "../lib/paneState";
import { paneTopic } from "../lib/logClient";
import { acquireTerminal, attachTerminal, parkTerminalNode, refit } from "../lib/terminalRegistry";
import { PaneHeader } from "./PaneHeader";
import "./TerminalPane.css";

export function TerminalPane({ paneId, cwd, sessionId, resume, title, focused, isDragging, isDropTarget, onFocus, onRename, onAutoTitle, onPopOut, onClose, dragHandleProps, dropZoneProps }: {
  paneId: string;
  cwd: string;
  sessionId: string;
  resume?: boolean;
  title: string;
  focused: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onAutoTitle: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  dropZoneProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("idle");
  const onAutoTitleRef = useRef(onAutoTitle);
  onAutoTitleRef.current = onAutoTitle;

  // The xterm + PTY live in the registry (persistent across tab moves). A pop-out or
  // drag remounts THIS wrapper (a portal-container change remounts — verified), so if
  // the terminal lived here it would be destroyed and respawn an empty shell (the
  // "pop-out = black screen" bug). Instead we just move the persistent host node into
  // this pane's container; on unmount we park it (never dispose) so the session survives.
  useLayoutEffect(() => {
    const entry = acquireTerminal(paneId, cwd, sessionId, !!resume);
    const container = containerRef.current!;
    attachTerminal(paneId, container);

    // Settle-to-fit: a drag/window-resize fires a STORM of ResizeObserver events; one
    // SIGWINCH per event floods the shell faster than it can redraw. Debounce to a
    // single resize at the settled size.
    const settle = debounce(() => refit(paneId), 100);
    const ro = new ResizeObserver(() => {
      entry.lastResizeAt.current = Date.now();
      settle();
    });
    ro.observe(container);

    const tick = setInterval(
      () => setState(deriveState({ lastLineAt: entry.lastLineAt.current }, Date.now(), 800)),
      400,
    );

    return () => {
      ro.disconnect();
      settle.cancel();
      clearInterval(tick);
      parkTerminalNode(paneId);
    };
  }, [paneId, cwd, sessionId]);

  // Auto-name: poll this pane's OWN session log for its topic.
  useEffect(() => {
    let alive = true;
    let last = "";
    const poll = async () => {
      try {
        const t = await paneTopic(cwd, sessionId);
        if (alive && t && t !== last) {
          last = t;
          onAutoTitleRef.current(t);
        }
      } catch {
        /* not under Tauri / no log yet — ignore */
      }
    };
    const first = setTimeout(poll, 1200);
    const id = setInterval(poll, 6000);
    return () => {
      alive = false;
      clearTimeout(first);
      clearInterval(id);
    };
  }, [cwd, sessionId]);

  return (
    <div
      className={`cockpit-pane${state === "working" ? " is-working" : ""}${focused ? " is-focused" : ""}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-target" : ""}`}
      onMouseDown={onFocus}
      {...dropZoneProps}
    >
      <PaneHeader
        title={title}
        repo={cwd.split("/").filter(Boolean).slice(-2).join("/")}
        working={state === "working"}
        onRename={onRename}
        onPopOut={onPopOut}
        onClose={onClose}
        dragHandleProps={dragHandleProps}
      />
      <div ref={containerRef} className="cockpit-pane__host" />
      <div className="cockpit-pane__vignette" />
      <div className="cockpit-pane__drop" />
    </div>
  );
}

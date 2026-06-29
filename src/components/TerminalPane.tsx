import { useState, useRef, useEffect, useLayoutEffect } from "react";
import { debounce } from "../lib/debounce";
import { deriveState, type PaneState } from "../lib/paneState";
import { paneTopic } from "../lib/logClient";
import { acquireTerminal, attachTerminal, parkTerminalNode, refit, focusTerminal } from "../lib/terminalRegistry";
import { writePty } from "../lib/ptyClient";
import { saveDroppedFile, dragHasFiles, imageFiles } from "../lib/dropClient";
import { PaneHeader } from "./PaneHeader";
import { ponytailInstalled, type PonytailLevel } from "../lib/ponytailClient";
import "./TerminalPane.css";

export function TerminalPane({ paneId, cwd, sessionId, resume, headroom, ponytail, title, focused, isDragging, isDropTarget, onFocus, onRename, onAutoTitle, onPopOut, onClose, onToggleHeadroom, onSetPonytail, dragHandleProps, dropZoneProps }: {
  paneId: string;
  cwd: string;
  sessionId: string;
  resume?: boolean;
  headroom?: boolean;
  ponytail?: PonytailLevel;
  title: string;
  focused: boolean;
  isDragging?: boolean;
  isDropTarget?: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onAutoTitle: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  onToggleHeadroom: () => void;
  onSetPonytail: (level: PonytailLevel) => void;
  dragHandleProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
  dropZoneProps?: React.HTMLAttributes<HTMLDivElement>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("idle");
  const [ptInstalled, setPtInstalled] = useState(false);
  useEffect(() => { ponytailInstalled().then(setPtInstalled).catch(() => {}); }, []);
  const onAutoTitleRef = useRef(onAutoTitle);
  onAutoTitleRef.current = onAutoTitle;
  const onFocusRef = useRef(onFocus);
  onFocusRef.current = onFocus;

  // The xterm + PTY live in the registry (persistent across tab moves). A pop-out or
  // drag remounts THIS wrapper (a portal-container change remounts — verified), so if
  // the terminal lived here it would be destroyed and respawn an empty shell (the
  // "pop-out = black screen" bug). Instead we just move the persistent host node into
  // this pane's container; on unmount we park it (never dispose) so the session survives.
  useLayoutEffect(() => {
    const entry = acquireTerminal(paneId, cwd, sessionId, !!resume, !!headroom, ponytail ?? "off");
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

  // Drop an image (e.g. a Snapzy screenshot) onto the terminal → type its path
  // into claude, like a native terminal does. We can't keep Tauri's native
  // drag-drop bridge (it would give the real path but breaks HTML5 pane
  // reordering — that's why tauri.conf has dragDropEnabled:false), and a
  // WKWebView never exposes File.path. So we read the dropped bytes, have Rust
  // write a temp file, and write that path to this pane's PTY. We listen only
  // for FILE drags (types includes "Files") and stopPropagation so the pane's
  // root-level reorder drop zone never sees them; non-file drags fall through.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const onDragOver = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    };
    const onDrop = (e: DragEvent) => {
      if (!dragHasFiles(e.dataTransfer)) return;
      e.preventDefault();
      e.stopPropagation();
      const files = imageFiles(e.dataTransfer!.files);
      if (!files.length) return;
      void (async () => {
        const paths: string[] = [];
        for (const f of files) {
          try { paths.push(await saveDroppedFile(f)); }
          catch (err) { console.error("[cockpit] drop save failed", err); }
        }
        if (!paths.length) return;
        // Wrap the path in bracketed-paste markers (ESC[200~ … ESC[201~). claude runs
        // its image-path → [Image #N] detection ONLY on pasted content, not on typed
        // text — a raw write leaves the literal path in the prompt. A native terminal
        // inserts a drag AS a paste, which is why Ghostty shows the [Image] chip; this
        // makes our drop behave the same.
        await writePty(paneId, `\x1b[200~${paths.join(" ")}\x1b[201~`);
        onFocusRef.current();
        focusTerminal(paneId);
      })();
    };
    container.addEventListener("dragover", onDragOver);
    container.addEventListener("drop", onDrop);
    return () => {
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("drop", onDrop);
    };
  }, [paneId]);

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
        paneId={paneId}
        title={title}
        repo={cwd.split("/").filter(Boolean).slice(-2).join("/")}
        working={state === "working"}
        headroom={!!headroom}
        ponytail={ponytail ?? "off"}
        ponytailInstalled={ptInstalled}
        onRename={onRename}
        onPopOut={onPopOut}
        onClose={onClose}
        onToggleHeadroom={onToggleHeadroom}
        onSetPonytail={onSetPonytail}
        dragHandleProps={dragHandleProps}
      />
      <div ref={containerRef} className="cockpit-pane__host" />
      <div className="cockpit-pane__vignette" />
      <div className="cockpit-pane__drop" />
    </div>
  );
}

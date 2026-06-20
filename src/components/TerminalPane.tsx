import { useState, useRef, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "../lib/ptyClient";
import { paneTopic, startLogtail, stopLogtail } from "../lib/logClient";
import { debounce } from "../lib/debounce";
import { deriveState, type PaneState } from "../lib/paneState";
import { PaneHeader } from "./PaneHeader";
import "./TerminalPane.css";

export function TerminalPane({ paneId, cwd, sessionId, title, focused, onFocus, onRename, onAutoTitle, onPopOut, onClose, dragProps }: {
  paneId: string;
  cwd: string;
  sessionId: string;
  title: string;
  focused: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onAutoTitle: (title: string) => void;
  onPopOut: () => void;
  onClose: () => void;
  dragProps?: React.HTMLAttributes<HTMLDivElement> & { draggable?: boolean };
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("idle");
  const lastLineAt = useRef<number | null>(null);
  const lastInputAt = useRef(0);
  const lastResizeAt = useRef(0);
  const onAutoTitleRef = useRef(onAutoTitle);
  onAutoTitleRef.current = onAutoTitle;

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.attachCustomKeyEventHandler((e) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w"].includes(e.key.toLowerCase())) {
        return false;
      }
      return true;
    });
    fit.fit();

    const unlisteners: Array<Promise<() => void>> = [];
    unlisteners.push(onPtyOutput(paneId, (chunk) => {
      term.write(chunk);
      const now = Date.now();
      if (now - lastInputAt.current > 150 && now - lastResizeAt.current > 500) {
        lastLineAt.current = now;
      }
    }));
    unlisteners.push(onPtyExit(paneId, () => term.write("\r\n[claude exited]\r\n")));

    const onData = term.onData((data) => {
      lastInputAt.current = Date.now();
      void writePty(paneId, data);
    });

    void spawnPty(paneId, cwd, term.cols, term.rows, `claude --session-id ${sessionId}`);
    void startLogtail(paneId, cwd, sessionId);

    // Settle-to-fit: a drag/window-resize fires a STORM of ResizeObserver events.
    // Resizing the PTY on every one floods the shell with SIGWINCH faster than it
    // can redraw its prompt -> cascading/duplicated prompts. Debounce so the shell
    // gets ONE resize at the settled size, and skip it if the char grid is unchanged.
    let lastCols = term.cols;
    let lastRows = term.rows;
    const settleResize = debounce(() => {
      fit.fit();
      if (term.cols !== lastCols || term.rows !== lastRows) {
        lastCols = term.cols;
        lastRows = term.rows;
        void resizePty(paneId, term.cols, term.rows);
      }
    }, 100);
    const ro = new ResizeObserver(() => {
      lastResizeAt.current = Date.now();
      settleResize();
    });
    ro.observe(host);

    const tick = setInterval(
      () => setState(deriveState({ lastLineAt: lastLineAt.current }, Date.now(), 800)),
      400,
    );

    return () => {
      ro.disconnect();
      settleResize.cancel();
      onData.dispose();
      unlisteners.forEach((p) => p.then((un) => un()));
      term.dispose();
      clearInterval(tick);
      void stopLogtail(paneId);
    };
  }, [paneId, cwd, sessionId]);

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
      className={`cockpit-pane${state === "working" ? " is-working" : ""}${focused ? " is-focused" : ""}`}
      onMouseDown={onFocus}
    >
      <PaneHeader
        title={title}
        working={state === "working"}
        onRename={onRename}
        onPopOut={onPopOut}
        onClose={onClose}
        dragProps={dragProps}
      />
      <div ref={hostRef} className="cockpit-pane__host" />
      <div className="cockpit-pane__vignette" />
    </div>
  );
}

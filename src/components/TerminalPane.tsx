import { useState, useRef, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "../lib/ptyClient";
import { deriveState, type PaneState } from "../lib/paneState";
import "./TerminalPane.css";

export function TerminalPane({ paneId, cwd, focused, onFocus }: { paneId: string; cwd: string; focused: boolean; onFocus: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("idle");
  const lastLineAt = useRef<number | null>(null);
  const lastInputAt = useRef(0);
  const lastResizeAt = useRef(0);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    term.attachCustomKeyEventHandler((e) => {
      if (e.metaKey && !e.ctrlKey && !e.altKey && ["t", "d", "w"].includes(e.key.toLowerCase())) {
        return false; // let app-level Cmd+T/D/W shortcuts act instead of typing into the shell
      }
      return true;
    });
    fit.fit();

    const unlisteners: Array<Promise<() => void>> = [];
    unlisteners.push(onPtyOutput(paneId, (chunk) => {
      term.write(chunk);
      // "working" = Claude actively emitting output (its thinking spinner / streaming).
      // Ignore output that is merely the echo of the user's own keystrokes, or a redraw
      // triggered by a resize (e.g. when a hidden tab becomes visible) — those are not
      // Claude working.
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

    void spawnPty(paneId, cwd, term.cols, term.rows);

    const ro = new ResizeObserver(() => {
      lastResizeAt.current = Date.now();
      fit.fit();
      void resizePty(paneId, term.cols, term.rows);
    });
    ro.observe(host);

    const tick = setInterval(
      () => setState(deriveState({ lastLineAt: lastLineAt.current }, Date.now(), 800)),
      400,
    );

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((un) => un()));
      term.dispose();
      clearInterval(tick);
    };
  }, [paneId, cwd]);

  return (
    <div className={`cockpit-pane${state === "working" ? " is-working" : ""}${focused ? " is-focused" : ""}`} onMouseDown={onFocus}>
      <div ref={hostRef} className="cockpit-pane__host" />
      <div className="cockpit-chip">
        <span className="cockpit-chip__dot" />
        <span className="cockpit-chip__bars"><i /><i /><i /></span>
        <span className="cockpit-chip__label-idle">idle</span>
        <span className="cockpit-chip__label-work">working</span>
      </div>
      <div className="cockpit-pane__vignette" />
    </div>
  );
}

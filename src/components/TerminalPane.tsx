import { useState, useRef, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "../lib/ptyClient";
import { startLogtail, stopLogtail, onLogLine } from "../lib/logClient";
import { deriveState, type PaneState } from "../lib/paneState";

export function TerminalPane({ paneId, cwd }: { paneId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<PaneState>("idle");
  const lastLineAt = useRef<number | null>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({ fontFamily: "Menlo, monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    fit.fit();

    const unlisteners: Array<Promise<() => void>> = [];
    unlisteners.push(onPtyOutput(paneId, (chunk) => term.write(chunk)));
    unlisteners.push(onPtyExit(paneId, () => term.write("\r\n[claude exited]\r\n")));

    const onData = term.onData((data) => { void writePty(paneId, data); });

    void spawnPty(paneId, cwd, term.cols, term.rows);

    const ro = new ResizeObserver(() => {
      fit.fit();
      void resizePty(paneId, term.cols, term.rows);
    });
    ro.observe(host);

    void startLogtail(paneId, cwd);
    unlisteners.push(onLogLine(paneId, () => { lastLineAt.current = Date.now(); }));
    const tick = setInterval(() => setState(deriveState({ lastLineAt: lastLineAt.current }, Date.now(), 2000)), 500);

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((un) => un()));
      term.dispose();
      clearInterval(tick);
      void stopLogtail(paneId);
    };
  }, [paneId, cwd]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div ref={hostRef} style={{ width: "100%", height: "100%" }} />
      <span
        aria-label={state}
        style={{
          position: "absolute", top: 6, right: 8, width: 10, height: 10, borderRadius: "50%",
          background: state === "working" ? "#f5a623" : "#3ecf8e",
          boxShadow: state === "working" ? "0 0 8px 2px #f5a62388" : "none",
          transition: "background 200ms, box-shadow 200ms",
        }}
      />
      <div
        style={{
          position: "absolute", inset: 0, pointerEvents: "none", borderRadius: 6,
          boxShadow: state === "working" ? "inset 0 0 24px 0 #f5a62333" : "inset 0 0 0 0 transparent",
          transition: "box-shadow 300ms",
        }}
      />
    </div>
  );
}

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, writePty, resizePty, onPtyOutput, onPtyExit } from "../lib/ptyClient";

export function TerminalPane({ paneId, cwd }: { paneId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

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

    return () => {
      ro.disconnect();
      onData.dispose();
      unlisteners.forEach((p) => p.then((un) => un()));
      term.dispose();
    };
  }, [paneId, cwd]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}

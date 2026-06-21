import { useEffect, useRef, useState } from "react";
import type { Layout } from "../layout/paneLayout";
import { paneLastLineAt } from "../lib/terminalRegistry";
import { deriveState } from "../lib/paneState";
import { onSend } from "../lib/juiceBus";
import "./Juice.css";

export function Juice({ layout, onAttention }: { layout: Layout; onAttention: (tabId: string) => void }) {
  const [working, setWorking] = useState(0);
  const [flash, setFlash] = useState(0);
  const layoutRef = useRef(layout); layoutRef.current = layout;
  const onAttentionRef = useRef(onAttention); onAttentionRef.current = onAttention;
  const prev = useRef<Map<string, boolean>>(new Map());

  useEffect(() => onSend(() => setFlash((f) => f + 1)), []);

  useEffect(() => {
    const id = setInterval(() => {
      const l = layoutRef.current;
      const now = Date.now();
      let count = 0;
      const live = new Set<string>();
      for (const t of l.tabs) for (const r of t.rows) for (const p of r.panes) {
        live.add(p.id);
        const w = deriveState({ lastLineAt: paneLastLineAt(p.id) }, now, 800) === "working";
        if (w) count++;
        const was = prev.current.get(p.id) ?? false;
        if (was && !w && t.id !== l.activeTabId) onAttentionRef.current(t.id);
        prev.current.set(p.id, w);
      }
      for (const id of [...prev.current.keys()]) if (!live.has(id)) prev.current.delete(id);
      setWorking(count);
    }, 350);
    return () => clearInterval(id);
  }, []);

  const lv = Math.min(working, 6);
  return (
    <div className="juice" aria-hidden="true">
      {flash > 0 && <div key={flash} className="juice__launch" />}
      {working > 0 && (
        <div className={`juice__swarm lv${lv}`}>
          <span className="juice__bolt">⚡</span>
          <b>{working}</b>
          <span className="juice__lbl">working</span>
        </div>
      )}
    </div>
  );
}

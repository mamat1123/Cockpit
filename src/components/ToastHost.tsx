import { useEffect, useRef, useState } from "react";
import { onToast } from "../lib/toastBus";
import type { Completion } from "../lib/notifications";
import "./ToastHost.css";

interface Shown { c: Completion; key: number }
const TTL = 5000;

export function ToastHost({ onJump }: { onJump: (c: Completion) => void }) {
  const [items, setItems] = useState<Shown[]>([]);
  const seq = useRef(0);
  const timers = useRef<Map<number, number>>(new Map());

  useEffect(() => onToast((c) => {
    const key = ++seq.current;
    setItems((prev) => [{ c, key }, ...prev].slice(0, 3));
    const t = window.setTimeout(() => dismiss(key), TTL);
    timers.current.set(key, t);
  }), []);

  const dismiss = (key: number) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
    const t = timers.current.get(key); if (t) { clearTimeout(t); timers.current.delete(key); }
  };
  const pause = (key: number) => { const t = timers.current.get(key); if (t) { clearTimeout(t); timers.current.delete(key); } };
  const resume = (key: number) => { timers.current.set(key, window.setTimeout(() => dismiss(key), TTL)); };

  return (
    <div className="toasts" aria-live="polite">
      {items.map(({ c, key }) => (
        <button key={key} className="toast" onMouseEnter={() => pause(key)} onMouseLeave={() => resume(key)}
                onClick={() => { onJump(c); dismiss(key); }}>
          <span className="toast__check" aria-hidden="true">✓</span>
          <span className="toast__tx">
            <b>{c.name} finished</b>
            <span>{c.project}</span>
          </span>
          <span className="toast__jump">Jump ↗</span>
        </button>
      ))}
    </div>
  );
}

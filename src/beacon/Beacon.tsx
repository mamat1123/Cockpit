import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize, PhysicalPosition } from "@tauri-apps/api/window";
import type { BeaconState } from "../lib/beaconState";
import "./Beacon.css";

const EMPTY: BeaconState = { sessions: [], totalUnseen: 0, working: 0, waiting: 0 };

export function Beacon() {
  const [st, setSt] = useState<BeaconState>(EMPTY);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const un = listen<BeaconState>("cockpit://beacon-state", (e) => setSt(e.payload));
    return () => { un.then((f) => f()); };
  }, []);

  // Resize the OS window to fit: a fixed large transparent window would capture clicks
  // over whatever is behind it. Collapsed = just the bar; open = bar + list (max 8 rows).
  useEffect(() => {
    const rows = st.sessions.length;
    const listH = rows === 0 ? 50 : Math.min(rows, 8) * 42 + 10;
    const h = open ? 60 + listH : 60;
    void getCurrentWindow().setSize(new LogicalSize(230, h));
  }, [open, st.sessions.length]);

  // Draggable + persisted position (localStorage is shared across same-origin windows).
  // Rust centers it on first run; a saved position overrides on next launch.
  useEffect(() => {
    const w = getCurrentWindow();
    const saved = localStorage.getItem("cockpit.beacon.pos");
    if (saved) { try { const { x, y } = JSON.parse(saved); void w.setPosition(new PhysicalPosition(x, y)); } catch { /* ignore */ } }
    const un = w.onMoved(({ payload }) => localStorage.setItem("cockpit.beacon.pos", JSON.stringify({ x: payload.x, y: payload.y })));
    return () => { un.then((f) => f()); };
  }, []);

  const jump = (sessionId: string) => { void invoke("beacon_jump", { sessionId }); setOpen(false); };
  const mode = st.waiting > 0 ? "ask" : st.totalUnseen > 0 ? "done" : st.working > 0 ? "work" : "idle";

  return (
    <div className="beacon-root">
      <button className={`beacon beacon--${mode}`} data-tauri-drag-region onClick={() => setOpen((o) => !o)}>
        {mode === "ask" && <span className="beacon__ping beacon__ping--ask"><i /><b /></span>}
        {mode === "done" && <span className="beacon__ping"><i /><b /></span>}
        {mode === "work" && <span className="beacon__eq"><i /><i /><i /></span>}
        {mode === "idle" && <span className="beacon__dot" />}
        {mode !== "idle" && <span className="beacon__num">{mode === "ask" ? st.waiting : mode === "done" ? st.totalUnseen : st.working}</span>}
        <span className="beacon__lbl">{mode === "ask" ? "waiting" : mode === "done" ? "done" : mode === "work" ? "working" : "idle"}</span>
      </button>
      {open && (
        <div className="beacon-list">
          {st.sessions.length === 0 ? <div className="beacon-list__empty">No sessions</div>
            : st.sessions.map((s) => (
            <button key={s.sessionId} className={`beacon-row beacon-row--${s.status === "waiting" ? "waiting" : s.unseen ? "done" : s.status}`} onClick={() => jump(s.sessionId)}>
              <span className="beacon-row__mark" />
              <span className="beacon-row__meta"><span className="beacon-row__nm">{s.name}</span>
                <span className="beacon-row__sub">{s.project} · tab {s.tabIndex}</span></span>
              <span className="beacon-row__jmp">↗</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

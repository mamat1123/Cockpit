import { useRef } from "react";
import "./Divider.css";

/** Draggable splitter. Reports drag delta as a FRACTION of the container's size
 *  along its axis; the parent converts it to flex-weight changes.
 *
 *  The visible line is thin, but the interactive hit-area extends well beyond it
 *  (overlapping the neighboring panes by a few px and sitting above them via
 *  z-index) so the gutter is easy to grab without a wide visual gap. */
export function Divider({ axis, containerPx, onResize }: {
  axis: "x" | "y";
  containerPx: () => number;
  onResize: (deltaFraction: number) => void;
}) {
  const start = useRef(0);
  const isX = axis === "x";

  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    start.current = isX ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const now = isX ? ev.clientX : ev.clientY;
      const total = containerPx() || 1;
      onResize((now - start.current) / total);
      start.current = now;
    };
    const up = () => {
      // capture-phase removal must match capture-phase add
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", up, true);
      document.body.style.cursor = "";
      document.body.classList.remove("cockpit-resizing");
    };
    document.body.style.cursor = isX ? "col-resize" : "row-resize";
    document.body.classList.add("cockpit-resizing");
    // CAPTURE phase: fire before xterm can stop propagation when the pointer
    // moves over a terminal pane mid-drag.
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", up, true);
  };

  return (
    <div
      className={`cockpit-divider cockpit-divider--${axis}`}
      onPointerDown={onDown}
      style={{
        flex: "0 0 6px",
        alignSelf: "stretch",
        position: "relative",
        zIndex: 5,
        cursor: isX ? "col-resize" : "row-resize",
        touchAction: "none",
      }}
    >
      {/* wide invisible grab zone — extends over the neighboring panes */}
      <div className="cockpit-divider__hit" />
      {/* thin visible line, centered */}
      <div className="cockpit-divider__line" />
    </div>
  );
}

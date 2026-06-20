import { useRef } from "react";

/** Draggable splitter. Reports drag delta as a FRACTION of the container's size
 *  along its axis, so the parent converts it to flex-weight changes. */
export function Divider({ axis, containerPx, onResize }: {
  axis: "x" | "y";
  containerPx: () => number;
  onResize: (deltaFraction: number) => void;
}) {
  const start = useRef(0);
  const onDown = (e: React.PointerEvent) => {
    e.preventDefault();
    start.current = axis === "x" ? e.clientX : e.clientY;
    const move = (ev: PointerEvent) => {
      const now = axis === "x" ? ev.clientX : ev.clientY;
      const total = containerPx() || 1;
      onResize((now - start.current) / total);
      start.current = now;
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };
  return (
    <div
      onPointerDown={onDown}
      style={{ flex: "0 0 6px", alignSelf: "stretch", cursor: axis === "x" ? "col-resize" : "row-resize" }}
    />
  );
}

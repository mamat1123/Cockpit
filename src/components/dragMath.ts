/** Track a divider drag. Returns the fraction the pointer has moved along the axis
 *  CUMULATIVELY from where the drag started, as a fraction of the container size.
 *
 *  The origin (`start`) is fixed for the whole drag — it must NOT advance per move.
 *  The parent applies this fraction to the sizes captured at drag-start, so the size
 *  is always `startSize + cumulativeFraction`. (The earlier bug advanced the origin
 *  each move, emitting per-event increments; paired with the parent's drag-start base
 *  that meant only the last tiny increment stuck and the pane snapped back.) */
export function createDrag(start: number, containerPx: () => number) {
  return (coord: number) => (coord - start) / (containerPx() || 1);
}

import { describe, expect, it } from "vitest";
import { createDrag } from "./dragMath";

describe("createDrag", () => {
  it("reports the fraction moved CUMULATIVELY from the drag's start", () => {
    const px = () => 200;
    const d = createDrag(100, px); // drag started at x=100, container 200px
    expect(d(110)).toBeCloseTo(0.05); // +10px / 200
    // still measured from the START (100), not from the previous call (110).
    // The original bug advanced the origin each move, so this returned 0.05 again
    // (a per-event increment) and the pane snapped back to its start size.
    expect(d(130)).toBeCloseTo(0.15); // +30px / 200, cumulative
  });

  it("returns 0 net when the pointer is back at the start", () => {
    const d = createDrag(100, () => 200);
    d(140);
    expect(d(100)).toBeCloseTo(0); // returned to origin => zero net resize
  });

  it("guards a zero/unknown container size (no divide-by-zero)", () => {
    const d = createDrag(50, () => 0);
    expect(Number.isFinite(d(80))).toBe(true);
  });
});

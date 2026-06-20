import { afterEach, describe, expect, it, vi } from "vitest";
import { debounce } from "./debounce";

afterEach(() => vi.useRealTimers());

describe("debounce", () => {
  it("coalesces a storm of calls into ONE trailing run", () => {
    vi.useFakeTimers();
    let n = 0;
    const f = debounce(() => n++, 100);
    for (let i = 0; i < 20; i++) f(); // resize storm
    expect(n).toBe(0); // nothing yet
    vi.advanceTimersByTime(99);
    expect(n).toBe(0); // still settling
    vi.advanceTimersByTime(1);
    expect(n).toBe(1); // exactly one run at the settled size
  });

  it("runs again for a later, separate burst", () => {
    vi.useFakeTimers();
    let n = 0;
    const f = debounce(() => n++, 100);
    f();
    vi.advanceTimersByTime(100);
    f();
    f();
    vi.advanceTimersByTime(100);
    expect(n).toBe(2);
  });

  it("cancel() prevents a pending run", () => {
    vi.useFakeTimers();
    let n = 0;
    const f = debounce(() => n++, 100);
    f();
    f.cancel();
    vi.advanceTimersByTime(500);
    expect(n).toBe(0);
  });
});

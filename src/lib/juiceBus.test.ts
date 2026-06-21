import { describe, it, expect, vi } from "vitest";
import { onSend, emitSend } from "./juiceBus";

describe("juiceBus", () => {
  it("notifies subscribers and unsubscribes", () => {
    const cb = vi.fn();
    const off = onSend(cb);
    emitSend(); emitSend();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    emitSend();
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

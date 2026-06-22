import { describe, it, expect } from "vitest";
import { onToast, emitToast } from "./toastBus";
import type { Completion } from "./notifications";

const c: Completion = { id: "1", paneId: "p", sessionId: "s", tabId: "t", name: "n", project: "pr", at: 1, seen: false };

describe("toastBus", () => {
  it("delivers to subscribers and unsubscribes", () => {
    let got: Completion | null = null;
    const off = onToast((x) => (got = x));
    emitToast(c); expect(got).toBe(c);
    got = null; off(); emitToast(c); expect(got).toBeNull();
  });
});

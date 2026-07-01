// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UsageStrip } from "./UsageGauges";

const inFuture = new Date(Date.now() + (4 * 60 + 12) * 60 * 1000);
const expectedClock = `${String(inFuture.getHours()).padStart(2, "0")}:${String(inFuture.getMinutes()).padStart(2, "0")}`;

vi.mock("../lib/usageStore", () => ({
  useUsage: () => ({
    report: {
      status: "ok",
      fiveHour: { utilization: 24, resetsAt: inFuture.toISOString() },
      sevenDay: { utilization: 41, resetsAt: inFuture.toISOString() },
    },
    status: "ok",
    lastOkAt: Date.now(),
  }),
}));
vi.mock("../lib/budgetStore", () => ({ useBudget: () => null }));

describe("UsageStrip popover reset text", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("shows both the relative countdown and the absolute clock time", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UsageStrip />));

    const strip = container.querySelector(".cockpit-usage") as HTMLElement;
    act(() => strip.focus());

    const resets = Array.from(container.querySelectorAll(".cu-gauge__reset")).map((el) => el.textContent ?? "");
    expect(resets).toHaveLength(2); // 5-hour + weekly
    for (const text of resets) {
      expect(text).toMatch(/resets in \d/);
      expect(text).toContain(`(${expectedClock})`);
    }
  });
});

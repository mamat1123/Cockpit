// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UsageStrip } from "./UsageGauges";

const inFuture = new Date(Date.now() + (4 * 60 + 12) * 60 * 1000);
const expectedClock = `${String(inFuture.getHours()).padStart(2, "0")}:${String(inFuture.getMinutes()).padStart(2, "0")}`;

vi.mock("../lib/usageStore", () => ({
  useMultiUsage: () => ({
    claude: {
      report: {
        status: "ok",
        fiveHour: { utilization: 24, resetsAt: inFuture.toISOString() },
        sevenDay: { utilization: 41, resetsAt: inFuture.toISOString() },
      },
      status: "ok",
      lastOkAt: Date.now(),
    },
    codex: {
      report: {
        status: "ok",
        fiveHour: { utilization: 31, resetsAt: inFuture.toISOString() },
        sevenDay: { utilization: 20, resetsAt: inFuture.toISOString() },
      },
      status: "ok",
      lastOkAt: Date.now(),
    },
    zai: { report: null, status: "noToken", lastOkAt: null },
  }),
}));
vi.mock("../lib/budgetStore", () => ({ useBudget: () => null }));

describe("UsageStrip — per-provider rows and popovers", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;

  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  function mount() {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UsageStrip />));
    return container;
  }

  it("renders one row per provider", () => {
    const c = mount();
    expect(c.querySelectorAll(".cu-provider-row")).toHaveLength(3);
  });

  it("z.ai shows its na-state without blocking Claude/Codex, and isn't focusable", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    expect(rows[0].className).not.toContain("is-na"); // claude
    expect(rows[1].className).not.toContain("is-na"); // codex
    expect(rows[2].className).toContain("is-na"); // zai

    act(() => rows[2].focus());
    expect(c.querySelectorAll(".cu-provider-row__pop")).toHaveLength(0);
  });

  it("focusing the Claude row opens ONLY Claude's popover, with both times shown", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    act(() => rows[0].focus());

    const popovers = c.querySelectorAll(".cu-provider-row__pop");
    expect(popovers).toHaveLength(1);

    const resets = Array.from(popovers[0].querySelectorAll(".cu-gauge__reset")).map((el) => el.textContent ?? "");
    expect(resets).toHaveLength(2); // 5-hour + weekly
    for (const text of resets) {
      expect(text).toMatch(/resets in \d/);
      expect(text).toContain(`(${expectedClock})`);
    }
  });

  it("focusing Codex's row opens a DIFFERENT popover than Claude's", () => {
    const c = mount();
    const rows = Array.from(c.querySelectorAll(".cu-provider-row")) as HTMLElement[];
    act(() => rows[1].focus());

    const popovers = c.querySelectorAll(".cu-provider-row__pop");
    expect(popovers).toHaveLength(1);
    const pct = popovers[0].querySelector(".cu-gauge__pct")?.textContent ?? "";
    expect(pct).toContain("31"); // Codex's 5-hour utilization, not Claude's 24
  });
});

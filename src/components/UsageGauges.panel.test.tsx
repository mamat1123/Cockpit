// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { UsagePanel } from "./UsageGauges";

vi.mock("../lib/usageStore", () => ({
  useMultiUsage: () => ({
    claude: {
      report: { status: "ok", fiveHour: { utilization: 24, resetsAt: null }, sevenDay: { utilization: 41, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
    codex: {
      report: { status: "ok", fiveHour: { utilization: 31, resetsAt: null }, sevenDay: { utilization: 20, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
    zai: {
      report: { status: "ok", fiveHour: { utilization: 82, resetsAt: null }, sevenDay: { utilization: 61, resetsAt: null } },
      status: "ok",
      lastOkAt: Date.now(),
    },
  }),
}));
vi.mock("../lib/budgetStore", () => ({
  useBudget: () => ({
    daysLeft: 3, allowancePct: 10, usedPct: 5, remainingPct: 5, fillPct: 88, level: "amber",
    over: false, dollarsPerPct: 1, allowanceUsd: 10, usedUsd: 8, remainingUsd: 2,
    blocksRemaining: 1, unspendable: false,
  }),
}));

describe("UsagePanel — Mission Control", () => {
  let root: Root | undefined;
  let container: HTMLDivElement | undefined;
  afterEach(() => {
    act(() => root?.unmount());
    container?.remove();
    root = undefined;
    container = undefined;
  });

  it("renders one provider group per provider, in order, with the budget row only under Claude", () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<UsagePanel />));

    const names = Array.from(container.querySelectorAll(".cu-provider-group__name")).map((el) => el.textContent);
    expect(names).toEqual(["Claude", "Codex", "z.ai"]);

    const budgetHeaders = Array.from(container.querySelectorAll(".cu-gauge__name")).filter(
      (el) => el.textContent === "today’s budget",
    );
    expect(budgetHeaders).toHaveLength(1);
  });
});

// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { useMultiUsage } from "./usageStore";

vi.mock("./usageClient", () => ({
  usageReport: () => Promise.resolve({ status: "ok", fiveHour: { utilization: 24, resetsAt: null }, sevenDay: null }),
  usageReportCodex: () => Promise.resolve({ status: "ok", fiveHour: { utilization: 31, resetsAt: null }, sevenDay: null }),
  usageReportZai: () => Promise.reject(new Error("network down")),
}));
vi.mock("./terminalRegistry", () => ({ anyPaneWorking: () => false }));

function Harness({ onState }: { onState: (s: ReturnType<typeof useMultiUsage>) => void }) {
  const state = useMultiUsage();
  onState(state);
  return null;
}

describe("useMultiUsage", () => {
  it("a rejected provider only affects its own slice — the other two still update", async () => {
    let latest: ReturnType<typeof useMultiUsage> | undefined;
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness onState={(s) => { latest = s; }} />);
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(latest!.claude.status).toBe("ok");
    expect(latest!.claude.report?.fiveHour?.utilization).toBe(24);
    expect(latest!.codex.status).toBe("ok");
    expect(latest!.codex.report?.fiveHour?.utilization).toBe(31);
    // z.ai's fetch rejected and it never had a prior report → "loading", not blank/crashed.
    expect(latest!.zai.status).toBe("loading");
    expect(latest!.zai.report).toBeNull();

    act(() => root.unmount());
    container.remove();
  });
});

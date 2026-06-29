import { describe, it, expect, vi } from "vitest";
import { resolveHeadroomRouting } from "./headroomRouting";

const BASE = "http://127.0.0.1:8787";

describe("resolveHeadroomRouting", () => {
  it("stays direct (no env, not engaged) when routing is off, without probing the proxy", async () => {
    const ensure = vi.fn(async () => true);
    const r = await resolveHeadroomRouting(false, ensure, BASE);
    expect(r).toEqual({ engaged: false, env: null });
    expect(ensure).not.toHaveBeenCalled(); // turning OFF must never spin the proxy up
  });

  it("engages and injects ANTHROPIC_BASE_URL when on and the proxy comes up", async () => {
    const r = await resolveHeadroomRouting(true, async () => true, BASE);
    expect(r).toEqual({ engaged: true, env: { ANTHROPIC_BASE_URL: BASE } });
  });

  it("falls back to direct when on but the proxy can't start (ensure rejects)", async () => {
    const r = await resolveHeadroomRouting(true, async () => { throw new Error("proxy down"); }, BASE);
    expect(r).toEqual({ engaged: false, env: null });
  });

  it("falls back to direct when on but the proxy is unreachable (ensure resolves false)", async () => {
    const r = await resolveHeadroomRouting(true, async () => false, BASE);
    expect(r).toEqual({ engaged: false, env: null });
  });
});

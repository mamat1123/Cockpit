/** Pure decision for a pane launch: should it route through the Headroom proxy, and
 *  with what env? Dependency-injected (`ensure` is the proxy bring-up) so it stays free
 *  of Tauri/DOM and is unit-tested in isolation. The caller passes `headroomEnsure` and
 *  `HEADROOM_BASE_URL`; this only decides engaged-or-direct. */
export interface RoutingResolution {
  /** True only when routing is ON *and* the proxy actually came up — i.e. the launch
   *  really talks through Headroom. False means direct (off, or proxy unavailable). */
  engaged: boolean;
  /** The env to spawn `claude` with: the proxy base url when engaged, else null (direct). */
  env: Record<string, string> | null;
}

export async function resolveHeadroomRouting(
  on: boolean,
  ensure: () => Promise<boolean>,
  baseUrl: string,
): Promise<RoutingResolution> {
  if (!on) return { engaged: false, env: null };
  try {
    if (await ensure()) return { engaged: true, env: { ANTHROPIC_BASE_URL: baseUrl } };
  } catch {
    /* proxy can't start: fall back to direct so the pane is never stuck */
  }
  return { engaged: false, env: null };
}

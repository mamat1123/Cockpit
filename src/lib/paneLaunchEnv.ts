import type { PonytailLevel } from "./ponytailClient";

/** The extra env a Pane's `claude` is launched with, merged from its toggles. HR and
 *  ponytail are independent axes that can both be on, so the env is the union of both.
 *  PONYTAIL_DEFAULT_MODE is ALWAYS set (incl. "off") so Cockpit's per-Pane level is
 *  authoritative — omitting it lets ponytail fall back to the user's global config / "full",
 *  which would make the chip lie. ANTHROPIC_BASE_URL is added only when HR actually engaged. */
export function paneLaunchEnv(opts: {
  headroomEngaged: boolean;
  ponytail: PonytailLevel;
  headroomBaseUrl: string;
}): Record<string, string> {
  const env: Record<string, string> = { PONYTAIL_DEFAULT_MODE: opts.ponytail };
  if (opts.headroomEngaged) env.ANTHROPIC_BASE_URL = opts.headroomBaseUrl;
  return env;
}

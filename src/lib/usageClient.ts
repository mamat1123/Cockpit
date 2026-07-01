import { invoke } from "@tauri-apps/api/core";

/** One rolling rate-limit window: % burned (0–100) + ISO reset time. */
export interface UsageWindow {
  utilization: number;
  resetsAt: string | null;
}

/** `status` mirrors the Rust command — drives the graceful UI states. */
export interface UsageReport {
  status: "ok" | "no_token" | "error";
  fiveHour: UsageWindow | null;
  sevenDay: UsageWindow | null;
}

/** Live 5-hour + weekly account usage from the Rust `usage_report` command (Claude). */
export function usageReport(): Promise<UsageReport> {
  return invoke("usage_report");
}

/** Local Codex 5-hour + weekly usage, read from `~/.codex/sessions` — no network. */
export function usageReportCodex(): Promise<UsageReport> {
  return invoke("usage_report_codex");
}

/** Live z.ai 5-hour + weekly usage for the saved monitor token. */
export function usageReportZai(): Promise<UsageReport> {
  return invoke("usage_report_zai");
}

/** Save (or, with an empty string, clear) the z.ai monitor token in macOS Keychain. */
export function saveZaiToken(token: string): Promise<void> {
  return invoke("save_zai_token", { token });
}

/** Whether a z.ai monitor token is currently saved — never returns the value itself. */
export function zaiTokenConfigured(): Promise<boolean> {
  return invoke("zai_token_configured");
}

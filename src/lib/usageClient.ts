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

/** Live 5-hour + weekly account usage from the Rust `usage_report` command. */
export function usageReport(): Promise<UsageReport> {
  return invoke("usage_report");
}

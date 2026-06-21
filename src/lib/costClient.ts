import { invoke } from "@tauri-apps/api/core";
import type { Usage } from "./pricing";

export function sessionUsage(cwd: string, sessionId: string): Promise<Record<string, Usage>> {
  return invoke("session_usage", { cwd, sessionId });
}

export interface Bucket { date: string; project: string; model: string; usage: Usage }
export function costReport(): Promise<Bucket[]> { return invoke("cost_report"); }

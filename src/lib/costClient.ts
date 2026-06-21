import { invoke } from "@tauri-apps/api/core";
import type { Usage } from "./pricing";

export function sessionUsage(cwd: string, sessionId: string): Promise<Record<string, Usage>> {
  return invoke("session_usage", { cwd, sessionId });
}

export interface Bucket { date: string; project: string; model: string; session: string; usage: Usage }
export interface SessionMeta { session: string; cwd: string; project: string; title: string }
export interface CostReport { buckets: Bucket[]; sessions: SessionMeta[] }
export function costReport(): Promise<CostReport> { return invoke("cost_report"); }

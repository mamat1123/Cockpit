import { invoke } from "@tauri-apps/api/core";
export interface Project { cwd: string; label: string; lastUsed: number }
export function listProjects(): Promise<Project[]> { return invoke("list_projects"); }

import { invoke } from "@tauri-apps/api/core";

export interface Burrow { path: string; branch: string; codename: string; emoji: string }
export interface DirtyState { uncommitted: boolean; unpushed: boolean }

/** Create a git worktree ("Burrow") for `projectCwd`; rejects if not a git repo. */
export function createBurrow(projectCwd: string): Promise<Burrow> {
  return invoke<Burrow>("create_burrow", { projectCwd });
}
export function removeBurrow(path: string, branch: string, force: boolean): Promise<void> {
  return invoke("remove_burrow", { path, branch, force });
}
export function burrowDirty(path: string): Promise<DirtyState> {
  return invoke<DirtyState>("burrow_dirty", { path });
}

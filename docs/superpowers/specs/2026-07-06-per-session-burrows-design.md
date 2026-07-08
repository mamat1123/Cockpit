# Per-Session Burrows — Design (2026-07-06)

Give each fresh Session its own isolated git worktree ("Burrow") on a new animal-named branch
("Codename"), so parallel Sessions don't share one working tree. See glossary: **Burrow**,
**Codename** in `CONTEXT.md`; decision rationale in `docs/adr/0011-per-session-burrows.md`.

## Terminology (canonical)

- **Burrow** — a git worktree at `<project>/.worktrees/<codename>` on its own branch, where one
  Session works. The domain term; "worktree" is the git mechanism.
- **Codename** — the animal name (`otter`, `panda`, …) identifying a Burrow: its branch name, its
  directory, and its Pane's default title. Unique within a Project.
- **Project** — unchanged: the codebase/repo a Session attaches to and cost is attributed to. A
  Burrow rolls up to its parent Project.

## Scope — which Pane creations get a Burrow

| Reducer action | Burrow? | Notes |
|---|---|---|
| `newTab` (incl. first Session from Project picker) | ✅ new | picked folder resolves to Project; Burrow cut off default branch |
| `split` / `splitDown` | ✅ new | each split is a fresh Burrow off the **default branch**, NOT the focused pane's branch |
| `openCodexHandoff` / `openClaudeHandoff` | ❌ reuse source cwd | handoff continues the source's work; a fresh Burrow would drop it |
| `popOut` | ❌ | moves an existing Pane; keeps its cwd |
| `openSession` / `loadLayout` (resume) | ❌ | cwd already points at a Burrow (or falls back — see Resume) |
| non-git Project | ❌ fallback | run in the folder as today; toast a note |

Gated by Settings toggle **"New Session in its own Burrow"** (default **ON**). Off ⇒ every action
behaves as today (run in the picked/inherited cwd).

## Architecture

`reduce()` in `src/layout/paneLayout.ts` stays **pure**. Burrow creation is an async side-effect
performed in `CockpitView.tsx` *before* dispatch; the resolved Burrow path is passed in as the
action's `cwd`.

**Rust (new module `src-tauri/src/worktree.rs`)**, reusing the `run_git(cwd, args)` subprocess
pattern from `handoff.rs:282`:
- `create_burrow(project_cwd: String) -> Result<Burrow, String>` where `Burrow { path, branch, codename }`:
  1. Resolve the Project root of `project_cwd` (`git rev-parse --show-toplevel`; if `project_cwd` is
     itself inside a worktree, resolve the main working tree via `--git-common-dir`) — so Burrows never
     nest inside Burrows and always land in the Project's `.worktrees/`.
  2. Resolve default branch: `origin/HEAD` → `main` → `master` → current `HEAD` (fallback).
  3. Pick a free **Codename**: random from a curated animal list, skipping any name already used by an
     existing branch or `.worktrees/<name>` dir; suffix `-2`, `-3`, … if the pool collides/exhausts.
  4. `git worktree add -b <codename> <root>/.worktrees/<codename> <defaultBranch>`.
  5. Return `{ path, branch, codename }`. On any git error / non-repo, return `Err` (caller falls back).
- `remove_burrow(path: String, branch: String, force: bool) -> Result<(), String>`:
  `git worktree remove [--force] <path>` then `git branch -D <branch>` (best-effort branch delete).
- `burrow_dirty(path: String) -> Result<DirtyState, String>`: `git status --porcelain` (uncommitted)
  + upstream check (`git rev-parse @{u}` / `git log @{u}..` → unpushed). Drives the close dialog.

Register all three in `src-tauri/src/lib.rs` (`invoke_handler` at `:106-135`).

**Cost / Project roll-up** (`src-tauri/src/cost.rs`): add a `project_root_of(cwd)` helper that strips
`/.worktrees/<x>[/…]` back to the Project root, and apply it in `list_projects` (`:266`) and
`cost_report` (`:189`) before dedupe/grouping. Result: Cost aggregates to the repo; the picker never
lists Codenames. Orphaned Burrow logs still roll up to the parent Project.

**Frontend:**
- `src/lib/worktreeClient.ts` — wraps `create_burrow` / `remove_burrow` / `burrow_dirty`.
- `src/components/CockpitView.tsx` — in the ProviderPicker `onPick` (`:266-288`) and the split
  keybinding path, when the setting is ON and the target is a git Project: `await createBurrow(cwd)` →
  dispatch the action with `cwd = burrow.path` (+ carry codename/branch onto the pane). On `Err`, toast
  and dispatch with the original cwd (fallback).
- `src/layout/paneLayout.ts` — `Pane` gains `codename?: string`, `burrowBranch?: string`,
  `isBurrow?: boolean`; thread through `SavedPane` (`:24`) + `serializeLayout`/`deserializeLayout`
  (`:79-124`). Pane title already derives from the last path segment = the Codename (free auto-title).

## UI — Burrow identity (chosen: variant 1, "Title + emoji")

The Codename surfaces as the Pane/Tab **title prefixed with a per-animal emoji** — e.g. `🦦 otter` —
the most minimal treatment (no new header chrome). Implications:
- The curated animal list carries an emoji per animal (`{ name: "otter", emoji: "🦦" }`), so `create_burrow`
  can return the emoji or the frontend can look it up from the Codename.
- The Burrow Pane's title renders `<emoji> <codename>`; Tabs show the same.
- Interaction with auto-title-from-topic (M3d, the `autoTitlePane` action): the emoji+Codename is the
  Burrow's stable identity. The plan settles whether the session-topic auto-title replaces the text while
  keeping the emoji prefix, or the Codename title simply persists (recommended: keep the emoji prefix,
  let the text follow the existing autoTitle rule). No `PaneHeader.tsx` layout change beyond the title string.

## Cleanup lifecycle

On `close` / `closeTab` (and `popOut`-driven removal) of a Pane where `isBurrow`:
1. `burrow_dirty(path)`.
2. Clean ⇒ `remove_burrow(path, branch, force=false)` silently, then dispatch the close.
3. Dirty/unpushed ⇒ dialog (`tauri-plugin-dialog`) with three choices:
   - **ลบ (delete)** ⇒ `remove_burrow(path, branch, force=true)` + close.
   - **เก็บ (keep)** ⇒ close the Pane, leave the Burrow + branch on disk.
   - **ยกเลิก (cancel)** ⇒ abort; the Pane stays open.

This is a side-effect ⇒ orchestrated in `CockpitView` around the close dispatch (the reducer never
touches git).

## Resume after delete

`openSession` / auto-restore run `claude --resume <id>` in the stored cwd. If that cwd is a removed
Burrow (`validate_cwd` fails), fall back to the parent Project root (`project_root_of`) and toast
"Burrow <codename> is gone — resuming in <project>". Applies to the Cost-view jump and launch restore.

## Error handling

`create_burrow` failure (non-repo, git error, locked index) **never blocks Pane creation** — fall back
to the original cwd + a toast. A Burrow that can't be removed logs + toasts but still closes the Pane.

## Testing

- Rust unit: `project_root_of` (worktree path → root, nested worktree, non-`.worktrees` path);
  default-branch resolution; codename collision/suffix picker.
- TS unit: reducer changes carry `codename`/`isBurrow` through serialize/deserialize round-trip;
  fallback path sets original cwd.
- Manual e2e: toggle ON → new tab in a git repo lands in `.worktrees/<animal>` on a new branch; split
  makes a second Burrow; Cost/picker show the repo (not animals); close-clean removes silently;
  close-dirty shows the 3-way dialog; resume a deleted Burrow lands in the repo root; toggle OFF behaves
  as today.

## Resolved decisions (from the grill)

1. Scope = every fresh Pane (newTab + split + splitDown), incl. the first Session.
2. Branch = new branch named after the Codename, off the **default branch** (`main`).
3. Location = `<project>/.worktrees/<codename>` (already `.gitignore`d).
4. Cleanup = always remove on close; warn (ลบ/เก็บ/ยกเลิก) if dirty/unpushed.
5. Handoff/pop-out reuse the source Burrow.
6. First Session from the picker also opens in a Burrow.
7. Cost/picker roll Burrows up to the parent Project.
8. Resume-after-delete falls back to the Project root.
9. Settings toggle, default ON.
10. UI identity = emoji + Codename as the Pane/Tab title (variant 1, "Title + emoji").

# 0011 — Per-Session Burrows (git worktree isolation)

_Status: proposed (design approved 2026-07-06; not yet implemented)._

Context: every Session used to run in the picked [[Project]] directory — a single shared
working tree. Running several Claude/Codex Sessions at once means they trample each other's
uncommitted changes. We want each Session isolated on its own branch/working copy.

Decision: each fresh Session (the `newTab` / `split` / `splitDown` reducer actions, including
the first Session from the Project picker) runs in its own **Burrow** — a git worktree at
`<project>/.worktrees/<codename>` on a new branch named after an animal **Codename**, created
off the Project's default branch (`main`/`master`, resolved dynamically). Handoff, pop-out, and
resume reuse the source Session's directory rather than cutting a new Burrow. A Settings toggle
_"New Session in its own Burrow"_ gates the whole feature (default **ON**); non-git Projects fall
back to running in the folder as before.

This is NOT the batch task-orchestration that [ADR 0001](./0001-terminal-first-cockpit.md) put
out of scope. Sessions stay interactive and terminal-first — you type to and watch each one.
Burrows are per-Session *isolation*, not fire-and-forget dispatch/merge. ADR 0001 stands.

## Boundary decisions

- **Cost / Project roll-up.** A Burrow belongs to its parent Project, not to itself. `list_projects`
  and `cost_report` canonicalize any `…/.worktrees/<codename>` cwd back to the Project root, so Cost
  aggregates to the repo and the Project picker never lists ephemeral Codenames. This preserves the
  [[Project]] glossary meaning ("the codebase cost is attributed to").
- **Cleanup on close.** Closing a Session's Pane removes its Burrow (git worktree + branch). If the
  Burrow has uncommitted or unpushed work, a dialog offers ลบ / เก็บ / ยกเลิก (delete / keep / cancel-close).
- **Resume after delete.** Resuming a Session whose Burrow was removed (e.g. from the Cost view, or
  auto-restore) falls back to the parent Project root — the branch is gone, but the conversation resumes.

## Consequences

- Every fresh Session triggers a `git worktree add` — effectively a full checkout. Time and disk cost
  scale with Pane count and repo size; the Settings toggle is the escape hatch.
- Deleted Burrows leave orphaned session logs under `~/.claude/projects/`; they stay attributed to the
  parent Project via the roll-up above, so Cost history survives Burrow deletion.
- Sibling Panes are on different branches: splitting inside Burrow `otter` cuts a fresh `panda` off the
  default branch — it does not inherit `otter`'s branch or uncommitted work.

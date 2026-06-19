# 0001 — Terminal-first cockpit, not a task orchestrator

Context: the app could be a fire-and-forget task orchestrator (Conductor-style: dispatch
tasks to git worktrees, review/merge) or a terminal-first cockpit (many live interactive
Claude Code sessions in split panes/tabs, game-flavored). The user's pain is that Ghostty
is too limited for living in many interactive sessions at once.

Decision: build a terminal-first cockpit. The primary unit is a live interactive Session
rendered in a Pane; the user types to and watches Sessions directly. Game / dashboard /
cost features layer on top. Batch task-orchestration is explicitly out of scope for v1.

Why it matters (hard to reverse): this makes the core engine terminal/PTY-based — it
renders real interactive `claude` processes — rather than driving the Claude Agent SDK for
batch dispatch. It flips the earlier lean toward the SDK (B) back toward PTY (C) for the core.

# 0006 — Spawn the user's interactive login shell, not the `claude` binary

Context: M1 spawns a process in each pane. Spawning `claude` directly fails: a macOS GUI
app inherits a minimal PATH (no nvm/homebrew), and the owner's `claude` is a zsh function
defined in `.zshrc`, not a bare binary on PATH.

Decision: `pty_spawn` launches the user's interactive login shell (`$SHELL -il`, default
`/bin/zsh -il`) in the pane. The shell sources the user's profile, so PATH, functions, and
aliases all apply — `claude` resolves and runs exactly as it does in their normal terminal.

Why it matters: this is the correct terminal-emulator behavior (a terminal hosts a shell,
not one program), it fixes the GUI-PATH problem, and it makes the pane general-purpose.
Auto-launching `claude` in a fresh pane is a thin layer left for a later milestone.

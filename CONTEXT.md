# Claude Cockpit (working name)

A juicy, multi-pane desktop cockpit for running many interactive Claude Code sessions at
once — a richer replacement for a plain terminal (Ghostty). "Game-like" here means visual
JUICE, not game mechanics: no score, no combo system. Adds live "Claude is working"
feedback, a dashboard, and per-project cost tracking.

## Language

**Cockpit**:
The whole app — the multi-pane workspace the user lives in to run Claude Code.
_Avoid_: terminal, IDE

**Session**:
One live, interactive Claude Code conversation the user types to and watches.
_Avoid_: agent, terminal

**Pane**:
A visual slot in the layout that renders one Session. Panes tile/split and group into Tabs.
_Avoid_: window, split

**Project**:
A codebase / working directory that Sessions attach to and that cost is attributed to.
_Avoid_: repo (when grouping cost)

**Juice**:
Satisfying visual/audio feedback layered on ordinary actions (sending a prompt, Claude
finishing a turn). The app's "game feel" IS juice — not gameplay.

**Combo**:
A purely cosmetic flourish when firing prompts — juice only. NO score, streak, or mechanic.
(Recorded to stop anyone building a scoring engine.)
_Avoid_: combo system, score, multiplier

**Working state**:
A Session's live status derived from its log: `working` (turn in progress), `idle`
(turn finished, awaiting you), or `waiting` (blocked on a permission/confirmation).
Drives the per-pane status + ambient juice.
_Avoid_: busy, running (be specific: working vs waiting)

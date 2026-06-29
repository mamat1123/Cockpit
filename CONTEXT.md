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
A Session's live status: `working` (turn in progress) or `idle` (turn finished,
awaiting you). A third value `waiting` (blocked on a permission/confirmation) is
defined but currently inert — panes run with permissions skipped, so it never occurs.
Drives the per-pane status + ambient juice.
_Avoid_: busy, running (be specific: working vs idle)

**Completion**:
The moment a Session finishes its turn and hands control back to you — Claude *ended*
the turn, not merely paused mid-tool. The single event that triggers every notification
surface ([[Beacon]], toast, macOS notification, chime, tab/bell counts).
_Avoid_: done, finish event, turn-end (when naming the trigger, say Completion)

**Seen / Unseen**:
A Completion is Unseen until you view its Session (its Tab becomes active) or act on it
from the [[Beacon]]/bell. Unseen Completions are what the tab badge, bell count, and
Beacon pulse count. "Mark all read" clears them in bulk.
_Avoid_: read/unread (say Seen/Unseen), dismissed

**Beacon**:
A small always-on-top floating window, separate from the Cockpit window, that pulses
when Sessions have Completions you haven't seen. Clicking it lists every Session with
its Working state and jumps to one. The always-on sibling of [[Juice]] — ambient, not
a control surface.
_Avoid_: widget, tray, popup, HUD (be specific: the Beacon)

**Usage**:
How much of your Claude account's rate limit you've consumed in a rolling window, as a
percentage (0–100% utilization) plus a reset time. Read live from your account, NOT derived
from session logs. Distinct from **Cost** — Cost is USD spent, Usage is % of limit left.
_Avoid_: cost, quota, tokens-left, rate (be specific)

**5-hour window** / **Weekly window**:
The two rolling rate-limit windows Usage is reported for: the short rolling 5-hour window
and the 7-day weekly window, each with its own utilization % and reset time.
_Avoid_: 5h limit / weekly limit (it's a rolling window, not a fixed limit)

**Headroom routing**:
Whether a [[Session]] talks to the model through the Headroom optimization proxy (which
compresses prompts to cut tokens) or straight to the API. Set per-Session and toggled in
the [[Pane]] header; flipping it relaunches that Session's Claude (via resume) since the
choice is fixed at process start. Default off.
_Avoid_: headroom mode, compression toggle, proxy on/off (say Headroom routing)

**Savings**:
The tokens (and their USD value) that Headroom's compression removed from a Session's
requests — the difference between what would have been sent and what actually was. A
third money/usage axis distinct from **Cost** (USD actually spent) and **Usage** (% of
rate limit). Attributed to whichever Session was in its [[Working state|working]] state
when a request passed the proxy; requests that can't be pinned to one Session land in a
separate **Unattributed** bucket rather than being guessed.
_Avoid_: discount, reduction, compression (be specific: Savings); never conflate with Cost

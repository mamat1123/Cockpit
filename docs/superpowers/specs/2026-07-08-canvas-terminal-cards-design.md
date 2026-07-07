# Canvas terminal cards — real interactive xterms on the canvas (M13b)

Status: design approved 2026-07-08 (user requested after first use of M13; picked
"full interactive terminal" over a read-only preview with the trade-offs stated
and accepted). Next: implementation (plan: docs/superpowers/plans/2026-07-08-canvas-terminal-cards.md).

## Context

M13 shipped canvas cards with a CNVS-style 3-line activity log. On first use the
user asked for the real terminal on the card instead. Explicitly accepted
trade-offs: text blurs and xterm mouse-selection drifts at zoom ≠ 100 %, the PTY
is SIGWINCH-resized when a terminal moves between card and pane (TUI reflows),
and many concurrent live xterms get heavy (fine ≤ ~8 sessions, revisit past ~10).

## Decisions

1. **Card = mini terminal window, 640×420** (`CARD_W`/`CARD_H` in `canvasMath.ts`
   change from 240/170; placement drops to 2 columns). Layout: header row
   (title · shortened cwd + tab N · status chip · `↗` button) / the pane's REAL
   xterm filling the middle / footer (cost · last-active). The activity log
   leaves the card; `activity.ts` and its feed stay (cheap, cleared on close,
   future zoomed-out level-of-detail can use it).
2. **The terminal is BORROWED, never re-created.** New registry pair:
   `borrowTerminal(paneId, container)` appendChild-moves the live host node into
   the card + refits; `returnTerminal(paneId)` moves it back to the pane
   container recorded by the last `attachTerminal` (falls back to parking if
   that container is gone). Same proven pop-out mechanism; the session, PTY,
   scrollback and React `TerminalPane` tree are untouched. Cards borrow on
   mount, return on unmount (canvas exit or pane close — `releaseTerminal`
   already disposes first, making the return a no-op).
3. **Interactions**
   - Drag a card by its HEADER only (grab cursor). Anything inside the card
     stops propagation — clicking a terminal can never start a canvas pan.
   - Click header (no drag) → focus that terminal. Typing goes to the session
     right on the canvas.
   - Double-click header → snap camera to 100 % centered on that card
     (`centerOn` in canvasMath) — the "I'm going to really type now" gesture,
     since only 100 % has sharp text and accurate mouse selection.
   - `↗` button → jump to the pane in Tabs mode (replaces M13's click-to-jump).
   - Wheel over a terminal scrolls its scrollback; ctrl/⌘-wheel (pinch) stays a
     canvas zoom everywhere.
4. **Everything else unchanged**: pan/zoom engine and its gesture/tick-pause
   rules, position/camera/mode persistence, status borders (green/amber glow),
   ⌘G, jump-exits-canvas, reveal refit.
5. **Migration note**: positions saved by M13 assumed 240-wide cards — after the
   upgrade cards may overlap once; drag them apart or hit fit-all (positions
   re-persist). Not worth code.

## Out of scope

- Card resize handles, per-card zoom, terminal virtualization/LOD for >10
  sessions, read-only preview mode.

# 0008 — The Beacon is a second always-on-top window, tied to the main window's lifecycle

Context: the user wants an always-on indicator that pulses when a Session finishes and
stays visible even when Cockpit is behind other apps — and, on click, lists every Session
with its Working state and jumps to one. Cockpit is otherwise a single-window app.

Decision: implement the [[Beacon]] as a **second Tauri WebviewWindow** — transparent,
frameless, always-on-top, `skipTaskbar`, `visibleOnAllWorkspaces`, made a child of the
main window so it closes and quits *with* it (lifecycle option B, not a "hide-to-tray /
keep-running-when-closed" model). It loads a `/beacon` route of the same build and renders
only the Beacon UI. The main window owns the notification/session state and `emit`s
snapshots to the Beacon over Tauri events (single source of truth); clicking a Beacon row
invokes a command that focuses the main window and jumps to that Session.

Why it matters: the obvious alternatives — a macOS Dock badge, a menu-bar tray icon, or
making the main window itself always-on-top — can't deliver a pulsing, clickable,
jump-to-session list that floats over other apps. A second window can, at the cost of
multi-window state sync (chosen: event-based, main is authoritative) and a known macOS
caveat: floating over another app's *native fullscreen* Space is restricted and must be
verified. Tying it to the main window's lifecycle keeps quit behavior unsurprising (close
Cockpit → the app quits, Beacon included) and needs no close-event interception.

# 0002 — "Game-like" means juice, not game mechanics

Context: the user wants the cockpit to "feel like a game" — combo prompts, animations.
A reasonable reader would assume this implies a scoring/combo system. When pressed
(combos can't work like a fighting game because Claude takes seconds-to-minutes per turn),
the user chose: combos are purely cosmetic.

Decision: the "game" is aesthetic JUICE only — satisfying animation/feedback on ordinary
actions. There is NO scoring engine, combo logic, streak tracking, or leaderboard.

Why it matters: it's an explicit scope boundary. Effort goes to a polished animated
frontend + solid PTY multiplexing + a cost/usage data pipeline — not to game systems.

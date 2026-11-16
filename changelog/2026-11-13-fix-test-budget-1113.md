### The slow test files are back inside their budget (PIE-1788)

- **Re-timed alone first:** the six files over their own budget on Nov 13 were all inside it alone (float-box's /tmp, 514k entries that night, slowed the run; PIE-1799 compacts it). link (78.7 s of 79) and ask-waits (57 s of 60) had no margin.
- **link 78.7 → 52 s:** the silent-connection test drives the link's heartbeat at a tenth (a test-only `heartbeat` option, as `retireAfterMs`); production keeps 10 s / 25 s.
- **ask-waits 57 → 23 s, group-husk 50 → 36 s, answer-pair 84 → 50 s:** test panes use the door's own short-window knobs (`EP0CH_DRAFT_TOUCH_MS`, `OUTLINER_AGENT_QUIET_MS`, and a new `EP0CH_SHELL_IDLE_MS` for the person-idle guard), so a pause is waited out sooner; the same rules are asserted.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change. The budget file is untouched.

### Tomorrow's nightly is green and nearer its budget (PIE-1763, PIE-1762)

- **The host no longer stalls when extensions reload:** each extension schema's validator is compiled once, not on every load. That was 17 s of a showcase host's 50 s of CPU.
- **Two glyphs a VGA terminal lacked:** the ask's `↵` and the answer tile's `▴ above` now draw as `◄` and `▲` there.
- **Four reds on main fixed (PIE-1763):** host-api, showcase/desk and showcase/edit-in-view now test the answers #1437 and #1442 meant (a script that writes nothing answers on its line; tidy's demo holds its own ask; ctrl+End under a shut answer lands on a line of its own), and terminal-output passes with the two glyphs. edit-in-view's last two tests no longer go red after it: its fixture's twelve `@yo` lines asked yo twelve times at once on save, which held the door for seconds. They now name an agent the outline doesn't have.
- **Slow files, timed alone (PIE-1762):**
  - **ask-yo, 143 → 76 s:** its test host waits a shorter quiet before asking (`OUTLINER_AGENT_QUIET_MS`, as `OUTLINER_EXTENSION_POLL_MS`), and its door tells the host about typing sooner (`EP0CH_DRAFT_TOUCH_MS`).
  - **backup-restic, 106 → 49 s:** its repositories are made together before the tests.
  - **write-review, 56 → 26 s:** a second `ep0ch show` per write now runs only in the tests that look at the drawing.
  - **agent-requests, 64 → 57 s:** from the host fix, plus a fake agent that is slow only on the press being timed.
- **Run:** `ep0ch install --apply` (no protocol, grammar or schema change).

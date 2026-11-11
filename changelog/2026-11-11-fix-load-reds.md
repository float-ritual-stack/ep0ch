### Four tests that went red at load 5 now wait on what they test, and drawings skip a full extension reread (PIE-1739)

- **Drawings no longer reread every extension:** `scripts.render` (a note's attachments, a service tile like what-changed) took the registry as it stands instead of reading every extension folder and script note again: ~150 ms of a ~180 ms drawing at load 5. A script note's edit or a folder's change still reloads it first (`ExtensionRegistry.current`).
- **Parity "desk: tree" and "desk: backlinks tile":** the desk parts no longer carry the showcase's made-up issues extension, whose query source spawned a `bun` per typed key once the search read as a query. Walks: 64 → 45-50 s and 57 → 35 s of their 60 s at load 4-5, same keys, builds and states.
- **The drawer recording tests** wait for the comment's session to end, not only its composer: an esc pressed while it asked for the thread never left the drawer.
- **The Jev suggestion record test** no longer draws each write through a second `ep0ch show` process: 3.9 → 1.1 s.
- **Run:** `ep0ch install --apply` (the host's render change).

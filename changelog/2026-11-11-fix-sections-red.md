### The showcase's ext-settings section is marked by tidy's settings button (PIE-1753)

- **The sections test is green again:** the ext-settings section's mark was a line under tidy's "Good to know", which the README lines PIE-1740 added pushed below the tile; the section opened at once and the test waited for a line it couldn't see. Its mark is now the page's header as the host draws it (the description and the `[⚙ settings]` button), so a longer README can't move it.
- **The extension settings test waits for the same mark,** read from `marks.ts` instead of its own copy of the line.
- **Run:** nothing (tests only).

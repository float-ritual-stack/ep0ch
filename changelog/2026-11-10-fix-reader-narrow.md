### A note reads, clicks and takes comments right at any tile width (PIE-1685, PIE-1686, PIE-1687, PIE-1701)

- **A click on the byline's `i N properties` opens the property panel,** as `i` does, in every reader, a group and the drawer; the BBS reader's `Stat:` line too.
- **The byline reads whole in a narrow tile:** who and when, the property count, each summary value and the comment count move to the next row whole instead of being cut (`i 5 p…`); the summary stays on one row while it fits one. A gutter widened by nested comment marks keeps the word "comments" and leaves no run of spaces. `[sources]` and `[comment]` are left out where they don't fit (the tile menu has them).
- **The pointer resting on a button that can't run says its whole why above the status bar,** not cut to the button's cells; a failed button's message too.
- **Saving a passage comment with ctrl+s leaves the reader where it was,** the thread open in place, for a passage picked any way (the person's selection, `C`, or a `passage.select` the person writes in); only a comment written from the thread list (`m`) lands back in it.
- **A refused power-bar line is cleared,** its why kept under "this session" and ↑ bringing it back to fix, so the next words start a line of their own.
- **A comment's hint row stays in its frame at 44 columns:** entering a tile ("reader 1 · writing") is said in passing, never over the screen above the bar. The thread list's and the passage picker's hints start with their esc.
- **`comment.close` with no comment open refuses** with why, instead of answering `{closed: false}`.
- **Run:** `ep0ch install --apply`. PROTOCOL, GRAMMAR and the schema don't move.

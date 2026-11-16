### An open Jira card follows its ticket, and a failing one stops strobing (PIE-1796)

- **An open card repaints:** a ticket's card opened from a list item (`- [jira::KEY]`, a Resource note) shows the poll's new read on its next redraw, with no reopen.
- **No strobe while Jira refuses:** a card whose fetch failed alternated "fetching…" and "can't fetch: …" several times a second, each failure's event asking for the next fetch. A card re-read because its ticket changed no longer fetches; the poll and `R` do.
- **The failure says what it keeps:** "kept the copy from 20m ago · couldn't fetch: … · the next poll tries again, R now", the last good fields above it. A copy being read again keeps its line until the new read lands.
- **The poll asks only about tickets a note names:** one whose line was taken out, or whose note was purged, isn't searched any more.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change. The outline host picks up the poll change on its next restart.

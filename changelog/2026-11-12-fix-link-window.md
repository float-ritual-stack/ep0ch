### The link carries a laptop's pages at the line's speed (PIE-1779)

- **A window, not one chunk a round trip:** each stream keeps up to 1 MB in flight, and the link 3 MB, so a 5 MB change-log page comes over the laptop's link in seconds. It came at about 30 KB/s, so float-hub's and readwise's first pages never arrived within 15 s.
- **Nothing written to a stream is lost at its end:** a stream's CLOSE follows its last acknowledged frame, and the far end ends its socket instead of destroying it.
- **Doctor and the backup alert report only what is followed:** copies listed in `EP0CH_MCP_MIRRORS` or asked for by a running process, never a status file an earlier list left behind.
- **Run:** `ep0ch install --apply` on float-2 and the laptop, in either order: old and new ends interwork. No PROTOCOL, GRAMMAR or schema change.

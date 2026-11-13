### The link carries a laptop's pages at the line's speed (PIE-1779)

- **A window, not one chunk a round trip:** each stream keeps up to 512 KB in flight, and the link 1 MB, so a 5 MB change-log page comes over the laptop's link in seconds. It came at about 30 KB/s, so float-hub's and readwise's first pages never arrived within 15 s.
- **The WebSocket's buffer stays small:** nothing more is sent while 512 KB waits unsent, so credit a closed stream gives back can't push it toward the 4 MB at which the link closes.
- **A short answer isn't held behind bulk:** waiting streams take turns, a frame each (four 8 MB transfers once held a 5-byte reply 6.5 s).
- **A closed stream lets go:** what its socket reads after CLOSE is neither sent nor counted, so cancelled reads can't fill the link's window; its socket is destroyed once its writes have gone.
- **Doctor and the backup alert report only what is followed:** copies listed in `EP0CH_MCP_MIRRORS` or asked for by a running process, never a status file an earlier list left behind.
- **Run:** `ep0ch install --apply` on float-2 and the laptop, in either order: old and new ends interwork. No PROTOCOL, GRAMMAR or schema change.

### The backup's local staging keeps only each outline's current log chain (PIE-1806)

- **Old chains leave `~/.local/state/ep0ch-door/backup/log/` once restic holds them:** an outline whose folder still holds an older chain (an earlier log, a chain kept aside at a gap) is uploaded with each such chain named in the snapshot's tags (`chain=<folder>:<newest entry>`, `ep0ch-held-chains`), and once that upload lands those chains are removed here. The run says each one and its size, and `lastRun` keeps it.
- **On the hub too:** `backup receive` lets go of a relayed outline's older chains once its upload lands. The laptop keeps its own until a direct upload, since a relay sends only the current chain.
- **Restores still reach them, every entry:** `ep0ch backup restore <o> --log <old id> --entry <n> --to <new file>` finds the old log in a snapshot of its own or one that names it as a held chain, and retention keeps every `ep0ch-held-chains` snapshot (`--keep-tag`).
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change. After deploy, the first backup run frees the old chains on float-2.

### The backup's local staging keeps only each outline's current log chain (PIE-1806)

- **Old chains leave `~/.local/state/ep0ch-door/backup/log/` once restic holds them:** after a run whose snapshot from this machine is confirmed for the outline's current log (the check install's rollback points use), every other chain of that outline (an earlier log, a chain kept aside at a gap) is removed here. The run says each one and its size, and `lastRun` keeps it.
- **On the hub too:** `backup receive` lets go of a relayed outline's older chains once its upload lands. The laptop keeps its own until a direct upload, since a relay sends only the current chain.
- **Restores still reach them:** `ep0ch backup restore <o> --log <old id> --entry <n>` reads the old log from the repository, while retention keeps a snapshot from before the trim (12 weeks at most).
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change. After deploy, the first backup run frees the old chains on float-2.

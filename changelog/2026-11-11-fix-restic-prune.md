### The backup's prune finishes a backlog instead of starting over every run (PIE-1755)

- **Forget every run, prune once a day on its own:** the 15-minute job's `restic forget` no longer carries `--prune`, so old snapshots are let go in seconds. The prune that frees their space runs once a day after it, bounded (`--max-repack-size 1G`), with its own limit (`EP0CH_BACKUP_PRUNE_MINUTES`, 40 by default). A month of backlog clears over a few days rather than being stopped at the limit every run.
- **A stop is said as one:** a restic command stopped at its limit reads `timed out after 40 min`, not the last line of the stack trace restic prints as it exits.
- **A failed prune waits 3 hours** before it tries again; failing twice in a row is an incident (`prune:<machine>`) in `ep0ch backup status`, doctor and the door's mark.
- **Run:** `ep0ch install --apply` on float-2 (the timer picks it up at its next run).

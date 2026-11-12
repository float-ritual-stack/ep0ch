### The 15-minute backup lets go of old snapshots again, and says when it can't (PIE-1755)

- **A stale lock no longer stops retention:** a restic lock left by a run killed mid-upload refused every `restic forget` (exclusive) while backups (shared) still landed. Now a refused forget runs `restic unlock`, which removes only locks whose process is gone or that nobody refreshed for 30 minutes (never `--remove-all`), and tries again, waiting up to 5 minutes for a live one. The run says `cleared a stale restic lock (<who held it>), then forgot old snapshots`.
- **Said where you look:** forget failing two runs in a row is an incident: `ep0ch backup status`, `ep0ch doctor`'s restic verdict, the door's `✗ backup` mark and one push, with restic's own line naming who holds the lock. Status's history says when old snapshots were last let go and pruned.
- **No host answering:** `ep0ch backup status` leads with the host's error and the command that starts it (`systemctl --user start outliner-host.service`), from the first failed run, not `ep0ch backup run`.
- **Run:** `ep0ch install --apply` on float-2, then `ep0ch backup run --verbose`; it clears the lock left since at least Oct 15.

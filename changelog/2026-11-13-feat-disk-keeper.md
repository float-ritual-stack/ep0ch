### float-2 keeps its own disk under 80%: the disk keeper (PIE-1787)

- **A disk keeper every 15 minutes:** `ep0ch-disk.timer` runs `ep0ch disk keep`. Past 75% it sweeps cold files to the storage box through `offload`, measures again and records the outcome.
- **One alert per incident, again only when worse:** 85% full (again at 95%), a fill within 12 hours at the last hour's rate, or a failed sweep (the box away, a copy that differs). Each names what grew in the last day, who reclaims it and the command. They show as `✗ disk` on the status bar, in doctor's `disk` group and in Herdr and ntfy.
- **It never deletes anything itself:** offload removes only what it copied and checked by content. Install backups, the change-log archive (PIE-1786), the journal and anything else are named with their owner.
- **`ep0ch disk`:** each disk's use, its biggest places with who reclaims each, the last sweep, what's open.
- **offload v2, now in the repo (`scripts/disk/offload`), installed by `ep0ch install`:**
  - the weekly sweep takes session transcripts older than 7 days, `~/.claude/uploads` older than 30, and Claude Desktop builds unused for 30 days;
  - it no longer takes `memory/` files: the old sweep's `find .claude/projects` took them;
  - a copy that differs leaves every file in place (exit 4, `--checksum` retries); a box that doesn't answer is exit 3;
  - it takes a path outside home too (a volume's folder).
- **sysop's disk trip runs the keeper:** where `ep0ch-disk.service` is installed, Calm runs it now.
- **Doctor says when journald has no cap,** with the one sudo command. The user journal is in the system journal's files, so one `SystemMaxUse` caps both.
- **Run:** on float-2, `systemctl --user disable --now offload-sweep.timer offload-sweep.service; mkdir -p ~/backups/units && mv ~/.config/systemd/user/offload-sweep.service ~/.config/systemd/user/offload-sweep.timer ~/backups/units/`, then `EP0CH_DISK_BOX=storagebox ep0ch install --apply`. No PROTOCOL, GRAMMAR or schema change.

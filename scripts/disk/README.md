# The disk keeper: a machine's disk under 80%, with nobody watching it (PIE-1787)

Cold files go to the storage box by themselves; the person hears only about what the keeper can't move.

| file | what |
|---|---|
| `offload` | moves a file or folder to the storage box and back; `--sweep` moves what's cold. Installed as `~/.local/bin/offload` |
| `ep0ch-disk.service`, `ep0ch-disk.timer` | `ep0ch disk keep` every 15 minutes |
| `offload-sweep.service`, `offload-sweep.timer` | weekly, `ep0ch disk keep --sweep`: the keeper's run with a sweep whatever the share, so it's recorded and raised the same way |

`ep0ch install --apply` writes them on Linux where `~/.config/ep0ch/disk.env` names the box (`EP0CH_DISK_BOX`, the
box's ssh name; `EP0CH_DISK_BOX=storagebox ep0ch install --apply` writes the file). It rewrites a unit only while the
unit keeps its "Written by `ep0ch install`" line, and replaces an `offload` whose `# offload v<N>` line is older.

## What a run does

0. **One at a time:** the timer's run, the weekly sweep and one typed share a lock (`disk.lock` beside disk.json); a
   second says who holds it and does nothing.
1. **Measure.** `df` for home, the install backups and `/`; `du` of home (two levels) and `/var/log` (one) on home's
   disk, the mount (two levels) on any other. Kept a day and a bit in `~/.local/state/ep0ch-door/backup/disk.json`.
2. **Sweep at 75%** (home's disk): `offload --sweep --yes`, then measure again and record before, after and what
   offload said.
3. **Raise what's wrong** through the backup job's alert path (alert.json: `✗ disk` on the door's status bar, doctor's
   `disk` group, one Herdr and ntfy announcement):
   - 85% full, and again at 95%, naming what grew in the last day and who reclaims each;
   - a fill within 12 hours at the last hour's rate, at any share;
   - a sweep that failed: the box away (offload's exit 3), or a copy that differs (exit 4).
   An incident is announced once, and again only when it gets worse; an unchanged one stays quiet until it clears. An
   announcement that reached nobody (Herdr and ntfy both said no) is tried again on the next run.

The keeper never deletes anything itself. Who reclaims what (`OWNERS` in `packages/door/src/disk/keeper.ts`):

| what | owner |
|---|---|
| Claude sessions with nothing newer than 7 days: `<project>/<session>.jsonl` and `<session>/` go or stay together | offload's sweep |
| `~/.claude/uploads` files older than 30 days (read by the session that uploaded them) | offload's sweep |
| `~/.claude/remote/ccd-cli/<version>` and `srv/<hash>`: Claude Desktop's CLI and server builds, unused (not run, not changed) for 30 days, the newest of each kept; `plugins`, `run` and `session-folders` stay | offload's sweep |
| `~/recon` clones with no file newer than 14 days | offload's sweep |
| install backups (`~/backups/ep0ch`) | install's retention |
| `~/.local/state/ep0ch-door/backup` (the outlines' change-log archive) | PIE-1786 |
| `/var/log/journal` | journald's cap |
| anything else growing | reported, with the `du` that looks closer |

The sweep never takes `memory/` or any other file under `~/.claude/projects` that isn't a session's.

## offload

- **What it removes:** only files it listed before the copy, whose copies matched by content, and that haven't changed
  since (size, mtime, ctime and inode, checked again just before each one goes, so a same-size replacement counts). A
  file written during the move, or made after the copy, stays here, and so does the rest of its session. A folder is
  never removed whole: listed folders (empty ones too, which make the trip) go only once they're empty.
- **Left open on purpose:** a write in the instant between a file's last check and its removal. These files are a
  week old or more; nothing coordinates with writers.
- **Names:** every list is NUL-separated, so a name with a newline or a space is one name; rsync quotes the paths it
  sends, so no path but `archive/<host>` meets the box's shell.
- `offload <path>…`: copy, verify by checksum, remove what's verified, leave `<path>.offloaded` with the way back (and,
  when some stayed, how many). A path outside home goes to `archive/<host>/root/<path>` (a volume's folder:
  `offload /mnt/HC_Volume_107103370/evan/claude-archive`). Refused (exit 2): home itself, `/`, and the live folders below.
- `offload --restore <path>` never writes over a file that's here, and refuses (exit 2, the marker kept) when a file
  came back as a folder or the other way round; `offload --list`, `offload --sweep` (lists what's cold), `--sweep --yes` (moves it).
- A sweep's batch is copied, then compared by content; any difference leaves every file of it here, the list in
  `~/.local/state/offload-differs.txt`, and `offload --sweep --yes --checksum` copies again by content.
- Swept files are listed in `~/.claude/projects/OFFLOADED.txt` (transcripts) and `~/.claude/OFFLOADED.txt` (uploads,
  remote), each batch with the command that brings one back. Every move is in `~/.local/state/offload.log`.
- It refuses outlines, `~/projects/ep0ch`, `~/.config`, `~/.ssh`, `~/.local/bin` and `~/backups`.

## journald

The user journal is stored by the system journald (`user-1000@….journal` in `/var/log/journal`), so `SystemMaxUse`
caps both and there is no user-level cap. Doctor says when none is set, with the one command:

```sh
sudo mkdir -p /etc/systemd/journald.conf.d && printf '[Journal]\nSystemMaxUse=300M\n' | sudo tee /etc/systemd/journald.conf.d/ep0ch.conf && sudo systemctl restart systemd-journald
```

## Settings (`~/.config/ep0ch/disk.env`)

`EP0CH_DISK_BOX` (the box), `EP0CH_DISK_SWEEP_AT` (75), `EP0CH_DISK_ALERT_AT` (85), `EP0CH_DISK_WORSE_AT` (95),
`EP0CH_DISK_FILL_HOURS` (12). `EP0CH_DISK_ALERT_AT=50 ep0ch disk keep` shows the alert on a scratch threshold.

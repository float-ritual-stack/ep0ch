# Backups: each outline's change log, archived every 15 minutes (PIE-607, ADR 0009)

An outline is its change log ([ADR 0009](../../docs/adr/0009-the-outline-is-its-change-log.md)): every committed row
change is an entry in the outline's own file. A backup is that log, archived; a copy on another machine is a follower
that applies it; a restore is a replay. Nothing copies an outline's file, retakes a snapshot or stops a replicator.

Every machine runs the same job, `ep0ch backup run` (packages/door/src/backup/), from a unit `ep0ch install --apply`
writes from the templates here:

| file | what |
|---|---|
| `ep0ch-backup.service`, `ep0ch-backup.timer` | Linux: a systemd user timer, 3 minutes after boot and then 15 minutes after each run |
| `io.ep0ch.backup.plist` | macOS: a launchd agent, every 900 seconds, logging to `~/Library/Logs/ep0ch-backup.log` |
| `ep0ch-follow.service` | Linux, when `EP0CH_MCP_MIRRORS` is set in `backup.env`: `ep0ch backup follow`, always running |

Install fills in the bun and checkout paths and rewrites a file only while it keeps its "Written by `ep0ch install`"
line.

## Only the host opens a live outline

The job, install and `ep0ch backup copy` ask the outline host and never open an outline's file (PIE-1750): its
`outlines.list` says each outline's schema, `log.range` gives its log, and `outlines.backup` makes a whole copy (VACUUM
INTO in a worker of the host's own) for install's pre-update backup and `ep0ch backup copy`. A host that doesn't
answer means nothing is archived that run, said with the command that starts it. A script that needs a copy runs
`ep0ch backup copy <outline> <file>`, never `sqlite3 .backup` on the live file.

## What a run does

1. **Archive.** For each outline the host lists: the entries of its log after what its archive holds (`log.range`, in
   whole transactions), written as one new segment, `~/.local/state/ep0ch-door/backup/log/<machine>/<outline>/<log
   id>/<first>-<last>.jsonl`, written once and never changed. A segment that doesn't follow the archive is refused.
2. **Upload.** Each outline whose archive moved since its last upload (or whose schema did: a migration writes a
   genesis) is uploaded with `restic backup <its archive folder>`, tagged `ep0ch-outline`, `outline=<name>`,
   `seq=<newest entry>`, `schema=<version>`. Only new segments travel. Each run stands alone: a failed upload, a gap
   or an offline night leaves nothing to repair; the next run uploads what's archived. A repository that isn't there
   yet is made (`restic init`).
3. **Retention**, after an upload: `restic forget --group-by host,paths --keep-within 48h --keep-hourly 72
   --keep-daily 30 --keep-weekly 12`, with `--prune` once a day. Here, the archive keeps the segments from the one
   holding the newest genesis on (a compaction writes one when the log outgrows the outline 4 times), so it stays
   about one outline and its recent changes in size; the earlier segments are in the repository's earlier snapshots.
4. **Relay** (a machine with `EP0CH_MCP_HUB`, the laptop): when the repository can't be reached (a quick look at its host
   answers nothing within 8 seconds, or restic's upload fails: a work VPN that blocks Hetzner object storage), the
   outline's archived log goes to the hub instead. It travels on the stdin of an ssh command, the path the netmail pull
   uses, to `ep0ch backup receive` in the hub's login shell, which checks its sha256 and that it is one log meeting the
   hub's own archive of that outline (a log that differs is refused), adds what it lacks to
   `~/.local/state/ep0ch-door/backup/log/<machine>/<outline>/` and uploads it to `<machine>`'s repository with that
   machine's host name, using the hub's own keys. A relayed outline counts as backed up. `ep0ch backup status` and
   doctor say `relayed via <hub>` with the repository's failure; the door's status bar shows a quiet `→ backup`.
5. **Drill**, monthly: every outline's newest archive restored into a temp folder, replayed into a new file and
   checked (`integrity_check`, its blocks counted, the replay ending at the entry the archive was taken at).
   `ep0ch backup drill` runs it now. When the repository doesn't answer (the VPN), the drill runs on the hub instead
   (`ep0ch backup drill --machine <this> --json` over ssh); with the hub out of reach too, it waits, said in doctor.
6. **Watch.** Changes waiting more than 2 hours for an upload, a failed drill, a host that doesn't answer: each is an
   incident in `~/.local/state/ep0ch-door/backup/alert.json`. The door's status bar marks it (`✗ backup`; `? backup`
   when the check itself stopped running), a click says what and the fix; `ep0ch doctor` lists it; it's announced once,
   through `herdr notification` and, when a secrets group `ntfy` holds `NTFY_URL`, ntfy.

restic gets its keys only through `with-secrets hetzner-s3,restic --` (or `RESTIC_PASSWORD` in its environment);
nothing here reads or prints them.

## Followers: the copy within seconds

`ep0ch backup follow` follows each outline `EP0CH_MCP_MIRRORS` names (`<outline>@<machine>`) into
`~/outline-mirrors/<machine>/<outline>.sqlite`: the home machine's log applied from the copy's cursor whenever its
events say something changed, and every 10 seconds. It is the same follower the MCP gateway and the web client read
another machine's outline through (packages/outliner/src/outline-follower.ts; one process serves a machine's copies,
the others attach). Run on another machine, it is the off-machine copy of an outline within seconds: float-box
following pie is what replaced Litestream's one-second replica of pie.

`ep0ch doctor` says each follower's place (`follow pie@float-2: the copy here holds entry …, last applied …`), and
stale with why when the home doesn't answer or refused to be followed.

## Settings

`~/.config/ep0ch/backup.env` (install writes it with the machine's name), overridden by the environment:

| | default |
|---|---|
| `EP0CH_BACKUP_MACHINE` | none: install asks for it (other machines name this one by it, so it's never taken from the host name silently) |
| `EP0CH_BACKUP_REPO` | `s3:https://hel1.your-objectstorage.com/ep0ch/restic/{machine}` |
| `EP0CH_BACKUP_MIRRORS` | none; the machines whose relays this hub takes (`laptop`) |
| `EP0CH_MCP_MIRRORS` | none; the outlines this machine follows (`pie@float-2`), written into the follow unit |
| `EP0CH_BACKUP_SECRETS` | `hetzner-s3,restic` |
| `EP0CH_RESTIC` | `restic` on PATH |

## Restoring

    ep0ch backup list float-hub --machine laptop
    ep0ch backup restore float-hub --machine laptop --at 3h --to /tmp/float-hub.sqlite

The restore replays the newest archive up to `--at` (an entry's time; whole transactions), or an earlier snapshot
when `--at` is before the newest one's genesis, into a new, integrity-checked file, never over an outline a service has open. The file is an outline of its own: a new log id,
recorded as forked from the old one, so a follower of the old outline rebuilds rather than mixing the two. Look at it,
then swap it in with the host stopped:

    systemctl --user stop outliner-host.service
    mv ~/outlines/float-hub.sqlite ~/backups/ && rm -f ~/outlines/float-hub.sqlite-wal ~/outlines/float-hub.sqlite-shm
    cp /tmp/float-hub.sqlite ~/outlines/float-hub.sqlite
    systemctl --user start outliner-host.service

Restic snapshots taken before ADR 0009 (a `.sqlite` file each) are not read by this build; `restic dump <id>
/<name>.sqlite` still gives one by hand.

## Retiring Litestream (ADR 0009)

The bucket's Litestream data stays until a drill on each machine has replayed the first archives and a follower has
been checked; then it is deleted by hand. The commands are in PIE-1751's PR.

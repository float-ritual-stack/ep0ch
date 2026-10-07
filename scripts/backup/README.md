# Backups: restic every 15 minutes (PIE-607)

Every machine runs the same job, `ep0ch backup run` (packages/door/src/backup/), from a unit `ep0ch install --apply`
writes from the templates here:

| file | what |
|---|---|
| `ep0ch-backup.service`, `ep0ch-backup.timer` | Linux: a systemd user timer, 3 minutes after boot and then 15 minutes after each run |
| `io.ep0ch.backup.plist` | macOS: a launchd agent, every 900 seconds, logging to `~/Library/Logs/ep0ch-backup.log` |

Install fills in the bun and checkout paths and rewrites a file only while it keeps its "Written by `ep0ch install`"
line.

## What a run does

1. **Snapshot.** For each `<outlines>/<name>.sqlite` whose change feed (`max(change_id)`) moved since its newest
   snapshot: a consistent copy (`VACUUM INTO` from a read-only connection, `integrity_check`), uploaded with
   `restic backup --stdin` as `/<name>.sqlite`, tagged `ep0ch-outline`, `outline=<name>`, `seq=<change>`. An outline
   that hasn't changed isn't snapshotted. Each run stands alone: a failed upload, a gap or an offline night leaves
   nothing to repair; the next run tries again. A repository that isn't there yet is made (`restic init`).
2. **Retention**, after an upload: `restic forget --group-by host,paths --keep-within 48h --keep-hourly 72
   --keep-daily 30 --keep-weekly 12`, with `--prune` once a day.
3. **Mirrors** (`EP0CH_BACKUP_MIRRORS`): each other machine's newest snapshot of each outline replaces
   `~/outline-mirrors/<machine>/<name>.sqlite` (atomic rename) when it's newer than the copy there. With
   `<machine>=<ssh-name>` and `sqlite3_rsync` on both machines, the outline is also copied straight from it when it
   answers; whichever copy holds the later change wins. While a Litestream follower (`litestream-mirror@<name>`) still
   runs, the copy goes to `~/outline-mirrors/.restic/<machine>/` instead, so the two never write one file.
4. **Drill**, monthly: every outline's newest snapshot restored into a temp folder and checked (`integrity_check`,
   its blocks counted). `ep0ch backup drill` runs it now.
5. **Watch.** Changes waiting more than 2 hours for a snapshot (here, or on a mirrored machine that answers over ssh),
   a mirror that couldn't take a newer snapshot, a failed drill: each is an incident in
   `~/.local/state/ep0ch-door/backup/alert.json`. The door's status bar marks it (`✗ backup`; `? backup` when the check
   itself stopped running), a click says what and the fix; `ep0ch doctor` lists it; it's announced once, through
   `herdr notification` and, when a secrets group `ntfy` holds `NTFY_URL`, ntfy.

restic gets its keys only through `with-secrets hetzner-s3,restic --` (or `RESTIC_PASSWORD` in its environment);
nothing here reads or prints them.

## Settings

`~/.config/ep0ch/backup.env` (install writes it with the machine's name), overridden by the environment:

| | default |
|---|---|
| `EP0CH_BACKUP_MACHINE` | the short host name |
| `EP0CH_BACKUP_REPO` | `s3:https://hel1.your-objectstorage.com/ep0ch/restic/{machine}` |
| `EP0CH_BACKUP_MIRRORS` | none; `laptop` or `laptop=<ssh-name>` |
| `EP0CH_BACKUP_SECRETS` | `hetzner-s3,restic` |
| `EP0CH_RESTIC` | `restic` on PATH |

## Setting up a machine

The laptop:

    EP0CH_BACKUP_MACHINE=laptop ep0ch install --apply

Its plan says first what's missing: `brew install restic`, and the `restic` secrets group with the same password as
float-2's (each machine reads the others' repositories): `scp float-2:.config/secrets/restic.env
~/.config/secrets/restic.env && chmod 600 ~/.config/secrets/restic.env`.

float-2, which mirrors the laptop's outlines:

    printf 'EP0CH_BACKUP_MACHINE=float-2\nEP0CH_BACKUP_MIRRORS=laptop=evans-macbook-pro.tail2a183e.ts.net\n' > ~/.config/ep0ch/backup.env
    ep0ch install --apply

Then `ep0ch backup run` once by hand and `ep0ch backup status`.

## Restoring

    ep0ch backup list float-hub --machine laptop
    ep0ch backup restore float-hub --machine laptop --at 3h --to /tmp/float-hub.sqlite

The restore writes a new, integrity-checked file and never over an outline a service has open: look at it, then swap
it in with the host stopped.

## Retiring Litestream where restic replaces it

After three days of clean runs (`ep0ch doctor`'s backups group all ✓, the drill ✓, the mirrors in
`~/outline-mirrors/.restic/laptop/` matching the followers' copies). The bucket's Litestream data stays as history.

On float-2, the followers (the job's next run then writes `~/outline-mirrors/laptop/` itself):

    systemctl --user disable --now litestream-mirror@float-hub.service litestream-mirror@sysops-log.service
    mv ~/.config/systemd/user/litestream-mirror@.service ~/backups/ && systemctl --user daemon-reload
    ep0ch backup run && ep0ch backup status

On the laptop:

    launchctl bootout gui/$(id -u)/io.ep0ch.litestream && mv ~/Library/LaunchAgents/io.ep0ch.litestream.plist ~/backups/

float-2's own `litestream.service` (pie, pie-hole) stays: float-2 is always online, and restic is the second copy.

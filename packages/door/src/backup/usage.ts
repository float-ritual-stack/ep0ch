// `ep0ch backup`'s part of `ep0ch help`: apart from the command, so the help doesn't load it.
export const BACKUP_USAGE = `  ep0ch backup run [--drill]       the backup job, as its timer runs it every 15 minutes: each outline here that
                                   changed is snapshotted (VACUUM INTO, integrity-checked) into this machine's restic
                                   repository, other machines' mirrors are refreshed from theirs, and what's stale is
                                   put on the door's status bar and announced once (scripts/backup/README.md)
  ep0ch backup snapshot [--force] | mirror | drill
                                   one part of it: snapshot (--force: unchanged outlines too), mirror, the restore drill
  ep0ch backup receive --machine <name> --outline <name> [--seq N] [--schema V] [--sha256 H]
                                   (run over ssh by a machine that can't reach the repository; the file on stdin) verifies
                                   the copy, installs it as that machine's mirror and uploads it to its repository
  ep0ch backup status [--json]     each outline's newest backup, the mirrors, the drill and the alert (no network)
  ep0ch backup list <outline> [--machine <name>]
                                   an outline's snapshots
  ep0ch backup restore <outline> [--machine <name>] [--at <time>] --to <path>
                                   an outline's newest snapshot (or the newest at or before --at: an ISO time, or 3h,
                                   2d ago), integrity-checked, written to a new file; never over an outline in use`;

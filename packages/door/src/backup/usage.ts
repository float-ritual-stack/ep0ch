// `ep0ch backup`'s part of `ep0ch help`: apart from the command, so the help doesn't load it.
export const BACKUP_USAGE = `  ep0ch backup run [--drill] [--verbose]   the backup job, as its timer runs it every 15 minutes: each outline's change log
                                   since its archive is written as a new segment, the archive uploaded to this machine's
                                   restic repository, and what's stale put on the door's status bar and announced once
                                   (scripts/backup/README.md, ADR 0009)
  ep0ch backup snapshot [--force] [--verbose] [--wait <seconds>] | drill
                                   one part of it: archive and upload (--force: unchanged outlines too; --wait: that long for a backup
                                   already running, as install does, instead of stopping), the restore drill.
                                   When the repository doesn't answer (the work VPN), the log goes through EP0CH_MCP_HUB
                                   and the drill runs there; with the hub out of reach too, the drill waits, said
  ep0ch backup follow [--once]     follows the outlines EP0CH_MCP_MIRRORS names (<outline>@<machine>) into
                                   ~/outline-mirrors/<machine>/, applying each one's log within seconds of a change there:
                                   the copy another machine's outline is read from, and this machine's copy of it if that
                                   machine's disk is lost. The ep0ch-follow unit runs it; --once catches up and exits
  ep0ch backup drill --machine <name> [--json]
                                   (run over ssh by a machine that can't reach its repository) the restore drill of that
                                   machine's repository, from here; writes nothing here
  ep0ch backup receive --machine <name> --outline <name> [--sha256 H]
                                   (run over ssh by a machine that can't reach the repository; its log on stdin) adds what
                                   this machine's archive of that outline lacks and uploads it to that machine's repository
  ep0ch backup status [--json|--verbose]
                                   the verdict first (✓ all backed up, ! n problems, ✗ failing) and the command to run, then each
                                   outline in a row and the history; --verbose adds the raw reasons, --json everything
  ep0ch backup list <outline> [--machine <name>]
                                   an outline's archive snapshots
  ep0ch backup copy <outline> <file>
                                   a consistent copy of a live outline, made by its host (VACUUM INTO on the host's own
                                   connection) and integrity-checked, written to a new file: what a script takes instead
                                   of opening the outline's file (sqlite3 .backup), which only the host opens
  ep0ch backup restore <outline> [--machine <name>] [--at <time>] --to <path>
                                   an outline's archived log replayed (up to --at: an ISO time, or 3h, 2d ago) into a new
                                   file, integrity-checked; never over an outline in use. The file is an outline of its own
                                   (a new log), so copies of the old one rebuild rather than mix the two`;

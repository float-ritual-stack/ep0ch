# 0009: The outline is its change log; machines follow it, backups archive it

Status: accepted, 2026-11-11 (PIE-1751; card 6 of the Nov 11 compensating-code review, Evan: "queue up all of them and
get them done").

## Context

An outline is a SQLite file, so moving it between machines meant moving bytes, and every copy needed code around it:

- **The mirror** (`outline-mirror.ts`): the laptop's Litestream (later its restic job) put float-hub in a bucket,
  float-2 restored it (`litestream restore -f`, or the backup job's restic restore beside it), took a `VACUUM INTO`
  snapshot again while the file changed (`:308`), opened a read-only host per snapshot, and served "whichever of the two
  copies is newer". The gateway and the web client each ran their own, in their own `.serve/<pid>` folder.
- **The guard** (`litestream-guard.ts`, 258 lines, and `litestream-units.ts`): Litestream loses its place when a file
  is removed, moved or made again under it, so every delete, archive, import and failed create stopped the replicator
  around the change, with crash records, retries and an alert for a replicator left stopped.
- **Busy waits**: Litestream holds a connection on the live file, so the store keeps `busy_timeout = 5000` and the
  dispatcher retries a request that met `SQLITE_BUSY` once (`request-envelope.ts` `retriesBusy`). PIE-1750 made the
  host the only other opener; Litestream is the last.

The store already has most of a log: a monotonic `sequence` in `metadata`, revisions on every block, and the change
feed (`change-feed.ts`), which says *what changed and who did it* for clients (`changes.since`) and is pruned to
10,000 rows. It doesn't hold the data, and several writes never advance the sequence (marks, read marks, selection,
the resource catalog's hidden rows, metadata), so neither can rebuild a copy.

## Decision

### 1. The log: every committed row change, in the file, in commit order

- **`change_log`**: one row per changed row of a replicated table, written by triggers the schema generates for every
  table (AFTER INSERT, UPDATE, DELETE): `lsn` (the position, `INTEGER PRIMARY KEY`), `txn`, `tbl`, `op` (`i`, `u`,
  `d`), `key` (the declared primary key's columns as JSON; every table has one, and a test holds a new one to it), `row`
  (every column as JSON, a BLOB as hex beside a marker; null for a delete) and `at`.
- **Every table is classified** in one list beside the schema (`change-log.ts` `LOG_TABLES`): *replicated* (the
  default: blocks, properties, revisions, the change feed, marks, resources, annotations, page addresses, metadata) or
  *local* (`change_log` and `log_state` themselves; where this machine's clients are, `selection`,
  `navigation_history` and `working_selections`; the metadata keys `outline_open_token`, which each open rewrites, and
  `navigation_cursor`).
  A test fails on a table the list doesn't name, so a new table is classified when it is made.
- **Whole transactions.** The store's transaction wrapper (`configureTransactions`, already the one place every write
  passes) advances `log_state.txn` at the end of each outermost write transaction that logged anything. A range never
  ends inside a `txn`: a page that reaches its limit is extended to the end of its last transaction. A writer outside
  the store (a migration, an import) only makes a group bigger, never splits one.
- **One cursor: the `lsn`.** The store's `sequence` stays the clients' content clock (`changes.since`, `asOf`) and is
  itself replicated (it is a metadata row). The backup tag and the mirror's comparison that used `max(change_id)` or
  `sequence` use the `lsn`.
- **Lineage is the log's own id**, `log_state.log_id`, a UUID minted with the log's first entry, not the outline's
  instance id (`openOutlineInstance` mints a new one after any unclean close, and the laptop crashes and sleeps).

### 2. A genesis starts a log, and every schema step

- **Genesis**: one `g` entry naming the schema version and how many rows follow it, then an `i` entry for every row
  of every replicated table, written in one SQLite transaction but numbered in log transactions of 2,000 rows, so a
  range of it is a page. A follower never applies a genesis in place: one that meets a `g` rebuilds beside its copy
  (§3). The migration to schema 12 writes the first; a new outline's starts with its schema's rows.
- **A schema step writes a new genesis.** A migration script runs with the log triggers dropped, then makes them again
  for the new columns and writes a genesis at N. Old entries before it are history, kept in the archive.
- **Compaction keeps the file in proportion:** an edit logs about 12 rows and 3 KB (measured: 600 writes on a scratch
  outline, 0.79 ms a write without the log and 0.94 ms with it; on 11,000 notes a genesis of 76,000 rows took 0.3 s and
  a rebuild from it 13 pages, 33 MB, 0.8 s). When what was logged since the newest genesis outgrows
  4 times that genesis, the host writes a new genesis and deletes the entries before the previous one (on open and
  hourly), so the file holds one generation back. A follower or an archive further behind than that rebuilds from the
  newest genesis; the archive keeps the history.

### 3. A range, and how a follower applies it

- **`log.range { after, limit }`** on any outline's server answers `{ logId, schema, head, prev, entries }`: the entries
  with `lsn > after` up to `limit` (whole transactions), `head` (the newest committed `lsn`), and `prev`, the digest of
  the entry at `after` (sha-256 of its stored columns). A follower that asks `after: 0` gets the log from its latest
  genesis.
- **A follower applies a range only if it follows its cursor:** the same `logId`, the same schema, `after` equal to its
  own newest `lsn`, and `prev` equal to the digest of its own entry there. Anything else is refused with why, and the
  follower keeps serving what it has:
  - **another `logId`** (the home was restored, §6, or made again): it rebuilds from that log's genesis into a new
    file and swaps it in;
  - **a `head` behind its cursor, or a `prev` that differs** (a file copied back by hand): the same rebuild, said in
    the log;
  - **a range holding a `g`** (a compaction, a schema step), **or a copy that isn't a follower's** (an earlier copy in
    the folder): the same rebuild;
  - **another schema**: it serves what it has, stale, saying which machine to update (`ep0ch install --apply`). A
    follower's file older than its own build is migrated in place by the follower (the migration scripts, as the
    mirror migrated its private copy), so a deploy on float-2 while the laptop sleeps keeps float-hub readable; the
    home's own migration then writes the genesis the follower rebuilds from.
- **Applying** is one transaction on the follower's file with its log triggers off (`log_state.applying`) and foreign
  keys off: each entry's row put back as it was (`i` insert-or-replace, `u` update by key, `d` delete by key), and the
  entry itself added to the follower's `change_log`. A follower's log is the home's, entry for entry, so a follower
  can answer `log.range` onward and be archived as the home would.

### 4. One follower per machine folder, in a read-only host

- **The follower's file** is `<mirrors>/<machine>/<outline>.sqlite`, served by one read-only outline host for that
  folder (`OutlineHost`, `readOnly`, `copy`). The first process that needs it (the gateway, the web client, `ep0ch
  backup follow`) starts it and takes its lock; the others attach to its socket. When the owner stops, the next read
  takes over.
- **Every process asks for the copies it needs** (`.follow/<outline>.want` in the folder), and the owner follows
  each one asked for, so a process that attaches still gets its copy. A follower's connection writes nothing of its
  home's outside an apply (TEMP triggers skip it), so the store's open-time recoveries leave the copy as the log made it.
- **What is followed is `EP0CH_MCP_MIRRORS`, the one list** (PIE-1779). Each process's ask is its own file,
  `.follow/<outline>.<pid>.want`, gone when its last follower there closes; the owner follows an outline while any
  running process asks for it, and stops the loop once none does. A link read follows the list and what a running
  process asked for, never every file in the folder nor an outline whose live read missed its deadline.
- **`ep0ch backup follow`** looks at its copies every 10 seconds, which takes the folder over when its owner exits. It
  runs the followers on their own (the `ep0ch-follow` unit, written by install when
  `EP0CH_MCP_MIRRORS` is in `backup.env`): on a machine with no gateway, it is the off-machine copy of an outline.
- **The owner follows each outline** it serves: it asks the home's host for `log.range` through the shared forward
  (`<outlines>/.remote/<machine>.sock`), applies through the hosted store (the same connection that answers reads, so
  nothing waits on a lock), and asks again when the home's `events.subscribe` stream says something changed, and
  every 30 seconds without one. A change on the laptop is on float-2 within seconds while the link is up.
- **What a read says** keeps its shape: `asOf` (the newest change the follower holds), `stale` (the home doesn't
  answer, or refused a range: since when and why), `copy` (the file, when it last applied a range, and the cursor).
- **Deleted:** the snapshot generations, `VACUUM INTO` taken again, the private-copy migration, "whichever is newer",
  the restic restore into `<mirrors>/.restic/`, and the Litestream follower units.

### 5. Backups archive the log

- **The archive:** each run of `ep0ch backup run` asks the host for each outline's entries after its archive cursor and
  appends them as segment files, `<state>/backup/log/<machine>/<outline>/<logId>/<first lsn>-<last lsn>.jsonl`,
  immutable once written. Then `restic backup` takes the archive folder (only new segments upload), with the same
  retention as before.
- **The relay carries the log:** while the work VPN blocks the bucket, the laptop sends each outline's archived log to
  the hub over ssh (as it sent sqlite copies), and the hub adds what its archive lacks and uploads it under the
  laptop's name. A log that differs from the hub's archive is refused.
- **The file keeps one generation of its log** (§2's compaction); the archive is the history, off the machine. An
  archive whose cursor was compacted away keeps that chain aside and starts a new one at the newest genesis.
- **The archive here keeps** the segments from the one holding the newest genesis on, after each upload; the earlier
  ones are in restic's earlier snapshots, and a restore to before that genesis reads one of them.
- **Recovery point, before and after** (loki, Nov 11: pie stays in seconds):
  - pie: Litestream to the bucket within about a second becomes float-box's follower of pie (`ep0ch backup follow`,
    `EP0CH_MCP_MIRRORS=pie@float-2`), woken by pie's events: seconds, on another machine. The archive every 15 minutes
    is the history to restore from, as restic was.
  - float-hub: restic every 15 minutes (relayed through float-2 when the VPN blocks the bucket) becomes float-2's
    follower within seconds of each change while the link is up, plus the laptop's archive every 15 minutes.
  - The bucket's Litestream data is kept until float-box's follower and a drill on each machine have passed.
- **What stays:** the host's `outlines.backup` (a `VACUUM INTO` copy in the host's worker), for the pre-install backup,
  `ep0ch backup copy` and the snapshot download; float-2's nightly whole-machine restic snapshot (`ep0ch-snapshot`),
  which takes those copies and is the independent second copy. Files beside the database (`<name>/`: media,
  artifacts, EchoNet) are not in the log, as they weren't in Litestream; the nightly snapshot holds them.

### 6. A restore is a replay

- `ep0ch backup restore <outline> [--machine <m>] [--at <when>] --to <file>`: restic restores the archive folder into
  a temp folder, and the entries from the latest genesis up to `--at` (an entry's `at`) are applied to an empty file at
  this build's schema. The file gets a new `logId` (recorded as forked from the old one at that `lsn`), so followers
  of the old log rebuild instead of applying a diverging range. Swapping it in stays a person's step with the host
  stopped.
- **A replay refuses an archive that isn't whole:** entries missing between segments, a range that doesn't meet the
  entry before it, a genesis short of its rows. An import is an outline of its own too: a fresh home log and genesis.
- **The drill** (monthly, and `ep0ch backup drill`) replays each outline's newest archive and checks it: integrity,
  its blocks counted, and the replay ending at the entry the archive was taken at. That a replay equals the outline,
  row for row (a canonical dump of the replicated tables), is the tests' to hold, over every mutation family.

### 7. Conflicts: one writer per outline

- The home machine is the only writer of an outline's log. A follower never writes rows; its host is read-only.
- **A write queued for an away machine** (the gateway's netmail, ADR 0005) stays a request in the queue, with the
  revision and the home's instance id the follower's copy showed (the copy carries the home's own, replicated). The
  home applies it as an ordinary attributed, revision-checked write (a conflict becomes a proposal, as now), so it
  enters the home's log as entries like any other, the queuing actor and `queued` in the rows they wrote; the follower
  sees it come back in the next range. Nothing but the home writes the home's log.

## Consequences

- **Deleted:** `litestream-guard.ts`, `litestream-units.ts` and their tests; the five `withLitestreamPaused` sites
  (host create, delete, archive and unarchive, CLI import); `host-main.ts`'s pause recovery; the Litestream checks,
  units and replica lag in `setup/backups.ts` and doctor; the alert's `guard:` incidents; the mirror step, the
  `.restic` mirror folder and the sqlite copies the relay carried in `backup/`; the store's `busy_timeout` and the
  dispatcher's `retriesBusy` (with the action table's `once`).
- **Schema 12** (`change_log`, `log_state`, the generated triggers; `scripts/migrations/0012-change-log.ts` writes the
  genesis). **Wire:** `log.range`; the mirror answer's `copy` gains `cursor`. PROTOCOL is set at the final rebase.
- **The one-way door:** once Litestream is stopped, the bucket's Litestream data is kept until float-box's follower of
  pie and a drill on each machine have passed; then it is deleted by hand. Restic snapshots from before (one `.sqlite`
  each) are not read by this build's restore; `restic dump` still gives one by hand.
- **Write cost:** every row change writes a log row in the same transaction: about 12 rows and 3 KB an edit (a note's
  properties are rewritten whole), and about a fifth more time a write (§2).

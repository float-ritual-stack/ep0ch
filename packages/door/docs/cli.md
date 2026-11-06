# CLI reference

The command registry owns short help, flags, examples, completion and typo suggestions.
This reference keeps detailed rules and environment variables. Read a section with
`ep0ch help <command> --more`; opening flags are under `ep0ch help launch --more`.
The names in examples stand for your own notes, outlines and SSH config names.

## launch

```text
ep0ch [--ws <name>] [--machine <ssh-name> [--create] | --here]
[--screen <name> [<target>] | --layout <name>]
```

open the door (the logon, then the main menu, by default);
--screen <name> opens that screen instead: a menu item (board,
desk, river, brief, welcome, waiting, who…) or any registered screen
(ep0ch act screen.list names them), with its target where it takes
one: --screen board <hub-id>, --screen detail <id | ((ref)) | ep0ch://…>
(a URI also names the outline and machine; it never creates one).
EP0CH_LANDING=<name> opens that screen after the logon instead
(EP0CH_LANDING=brief, =welcome).
--layout daily opens the desk laid out as a named layout (daily,
river, board, desk, or one saved with ^W w).
Which outline: --ws <name> from anywhere, else EP0CH_WS, else the
nearest .ep0ch from this folder up (it holds ws = "<name>"). A name
nobody has yet is created on this machine (like herdr --session <name>);
on another machine never: the home base says so and offers the one here,
creating it there, or cancel (without a terminal, the commands), and
--create makes it there on purpose. Where none is
named, the home base: this machine's outlines (open, new, import) and the
machines opened from here (add one from ~/.ssh/config); choosing one opens
it and offers to write the folder's .ep0ch.
Outlines are <name>.sqlite in EP0CH_OUTLINES (~/outlines).
Which machine: --machine <ssh-name> (a Host in ~/.ssh/config), else
EP0CH_MACHINE, else the machine = "<ssh-name>" of the .ep0ch that named
the outline; none is this machine (--here says so outright, over
EP0CH_MACHINE and the .ep0ch's machine). The door keeps an ssh forward to that
machine's outline host (~/outlines/.remote/<ssh-name>.sock), shared by
every client here and started again when it drops; a command says
"<ssh-name> via ssh" when it starts the forward (EP0CH_VERBOSE=1: every
time). EP0CH_SOCKET names
a host's socket outright
```text
ep0ch --showcase [--reset]       every shared door part, live, on its own seeded outline of made-up notes
```

(the same as ep0ch try --showcase); --reset reseeds it
```text
ep0ch --remote <ssh-name> [door flags]
```

this terminal on the door session running on that machine (ssh -t
<ssh-name> ep0ch [door flags]), like herdr --remote; an outline that
machine doesn't have is asked about first, as for --machine (--create
makes it there)
```text
ep0ch --skill [--all] [<name>]
```

the stack's skills (this door's and the installed Outliner's), or the
path of one skill's SKILL.md; --all adds contributor skills

## door

```text
ep0ch door [<ssh-name>] [<outline>]
```

ssh -t to the ssh door (ssh ep0ch: the login whose command is the door),
<ssh-name> default ep0ch, then this terminal back clean however it ends:
a dropped link too (mouse, the alternate screen and paste turned off), with
the command that reattaches. ssh's keepalives end a dead link in a minute

## log

```text
ep0ch log [--ws <name>] [--machine <ssh-name>] [--follow]
```

print the session message log as JSON lines; --follow tails it

## session

Sessions last beyond a terminal. Quitting detaches; opening ep0ch attaches again.
`list` reports outline, outline machine, pid, code, attached terminals and programs.
`session list --machine <ssh-name>` lists sessions running on that machine over SSH,
with its name above the list. `--json` keeps the JSON array without a text header.
SSH errors are printed with a command to check the connection; no local list is substituted.

Only `list` accepts `--machine`. For another session command, run it on that machine:
`ssh -t box-a ep0ch session attach --ws garden`.
Local session selection uses `--ws`, then `EP0CH_WS`, then this folder's `.ep0ch`;
when none names an outline, the only running session is selected. The outline's machine
can still be named by `EP0CH_MACHINE` or the folder's `.ep0ch`.

`attach --watch` is read-only. `end` asks while programs run or drafts are unsaved;
`--all` ends every local session and asks first, and `--yes` skips that question.
`upgrade` hands a session to this checkout's new code while its programs keep running;
`--clients` restarts only attached terminals and `--all` does every local session.
`restart` hands it over even on the same code.
`--no-daemon` (or `EP0CH_DAEMON=0`) opens the door in this terminal instead.

Internal launch commands `session serve` and `session pty-host` also refuse `--machine`.

## mcp

```text
ep0ch mcp usage [--since 24h] [--by tool|actor|outline] [--json]
ep0ch mcp usage --census [--ws <name>] [--machine <ssh-name>] [--json]
```

measured MCP calls on this machine, or the service’s current block size census
```text
ep0ch mcp [--ws <name>] [--machine <ssh-name>]
```

local stdio MCP server for ep0ch:// block resources, gated by the outline's `ep0ch mcp access` grant:
tools list_outlines, outline_read, outline_threads, outline_find, outline_grep, outline_query, outline_links, outline_components; resources/read with envelope,
and the outline's components and the skills as resources (resources/list), the skills as prompts,
and what an outline holds as its instructions (PIE-721). At `propose` and `full` it offers the
same write tools as the gateway, as `mcp:[<persona>/]<client>@<machine>` (the client the MCP initialize names, on this machine);
outline_new makes a scratch outline of its own on this machine, outline_archive puts it away
```text
ep0ch mcp serve --http [--port <n>] [--bind <address>] [--ws <default outline>]
```

the same server over streamable HTTP for remote clients (claude.ai), an OAuth resource
server for this machine's outlines (and EP0CH_MCP_REMOTE's, live or from a mirror);
needs EP0CH_MCP_RESOURCE, CLERK_PUBLISHABLE_KEY (or EP0CH_MCP_ISSUER) and
EP0CH_MCP_ALLOWED_SUBJECTS (unset: refuse and log who asked)
```text
ep0ch mcp access --matrix [--machine <ssh-name>]... [--json]
```

who can reach what: each caller (a named path, a client) against each outline, the
lower of the outline's grant and the caller's cap, with calls in the last 7 days
(the door's tile: ctrl+k > access.open)
```text
ep0ch mcp access --cap <persona>[@<outline>[@<machine>]]=<level>
```

cap a named path (/<persona>/mcp) in EP0CH_MCP_PATH_ACCESS (~/.config/ep0ch/mcp.env)
```text
ep0ch mcp access [none|read|propose|full] [--json] [--ws <name>] [--machine <ssh-name>]
```

show or set this outline's persisted MCP access grant (stdio and the gateway alike):
propose and full let the write tools (outline_create, outline_patch,
outline_comment, outline_set_property, outline_reply, outline_resolve_thread, outline_quote, outline_move, outline_trash) propose or apply (outline_assign_id and outline_restore apply at full only); a gateway's mirror of an outline queues them when its machine is away
```text
ep0ch mcp queue [status] [--json]
```

the remote MCP gateway's queued writes for other machines' outlines (netmail): how many wait
for each machine, the oldest, its last pull, and what the latest became
```text
ep0ch mcp queue drop <id>… [--why <words>]
```

withdraw waiting writes (a write redone by hand): each is settled as refused, saying why,
so neither the gateway's drain nor a pull applies it; prints what each was
```text
ep0ch mcp queue take --machine <name> --json   (run over ssh by that machine's pull) its waiting writes
ep0ch mcp queue settle --machine <name>        (the same, after applying) what each became, as JSON on stdin
ep0ch mcp pull [--from <ssh-name>]
```

on an outline's home machine: apply the writes queued for it on the gateway's machine
(EP0CH_MCP_HUB, its ssh name; this machine is EP0CH_BACKUP_MACHINE there). The backup job
runs it every 15 minutes; the gateway also drains a machine's writes itself, over the link,
as soon as it reaches that machine again

## init

```text
ep0ch init [<name>] [--create] [--json]
```

name this folder's outline: attach to it (creating it when nobody has; on
another machine only with --create), and write .ep0ch; without a name, the
folder's (or its repository's)

## outline

```text
ep0ch outline list [--all] [--archived] [--lines] | snapshot <name> [--link | --out <file>] [--ttl 15m] | attach <name> [--create]
| create <name> | import <database.sqlite> <name> | stop <name> | archive <name> | unarchive <name> | delete <name> [--yes]      [--json]
```

snapshot writes a consistent, integrity-checked SQLite copy of the outline (PIE-931): --out <file>
on the outline's own machine (refused with --machine: run it there, or take the link), --link a
curl command for a one-time download that ends after --ttl (default 15m); --json prints bytes,
sha256, schema and asOf

the host's outlines (one an agent made over MCP shows who made it and why;
archive hides one and keeps its database, unarchive restores it, --archived
lists them): --all lists every machine's (this one's, then each
machine opened before, one not connected said, nothing started), --lines
as name<TAB>machine<TAB>problem; attach opens the door on one (the same as
--ws <name>; on another machine --create makes one it lacks); import makes a new outline from an older database (its
notes, properties, pages and work ids; the file is only read); stop
releases its database; delete moves it to .deleted/, after asking

## link

```text
ep0ch link setup|serve|connect|status   outbound HTTPS link for a machine
ep0ch link doors <machine> [--json]     the door sessions that machine's link carries here (PIE-1242)
ep0ch link via <machine> <ssh-name>     that machine's link lands on <ssh-name>: reach its doors through it
```

A link carries the connector's door sessions too: each one's control socket answers at
`<outlines>/.remote/<machine>.doors/<outline>[@<machine>].sock` on the server, and, after `link via`, at the same
path on a machine that reaches the server over ssh (forwarded on its existing ssh connection). `ep0ch peek|act|open
--remote <machine> [--ws <outline>]` and `ep0ch session list --machine <machine>` use them; `docs/machine-link.md` in
the outliner has the wire.

## status

```text
ep0ch status [--json]            the outline host: its socket, its outlines folder, open outlines
```

## doctor

```text
ep0ch doctor [--backups] [--json]
```

every piece of the stack (bun, the ep0ch checkout, ep0ch on PATH, the plugin
in Herdr, the outlines folder and its host and unit, which outline this folder
opens, the backups (each Litestream unit, its log's errors, how far each replica
or mirror trails), Herdr's keys, the Claude mod): ✓ current, ! behind, ✗ missing,
with the command that fixes each. Read-only; --backups also restores each newest
snapshot into a temp folder and runs integrity_check

## backup

```text
ep0ch backup run [--drill] [--verbose]   the backup job, as its timer runs it every 15 minutes: each outline here that
```

changed is snapshotted (VACUUM INTO, integrity-checked) into this machine's restic
repository, other machines' mirrors are refreshed from theirs, and what's stale is
put on the door's status bar and announced once (scripts/backup/README.md)
```text
ep0ch backup snapshot [--force] [--verbose] | mirror | drill
```

one part of it: snapshot (--force: unchanged outlines too), mirror, the restore drill.
When the repository doesn't answer (the work VPN), snapshots go through EP0CH_MCP_HUB
and the drill runs there; with the hub out of reach too, the drill waits, said
```text
ep0ch backup drill --machine <name> [--json]
```

(run over ssh by a machine that can't reach its repository) the restore drill of that
machine's repository, from here; writes nothing here
```text
ep0ch backup receive --machine <name> --outline <name> [--seq N] [--schema V] [--sha256 H]
```

(run over ssh by a machine that can't reach the repository; the file on stdin) verifies
the copy, installs it as that machine's mirror and uploads it to its repository
```text
ep0ch backup status [--json|--verbose]
```

the verdict first (✓ all backed up, ! n problems, ✗ failing) and the command to run, then each
outline in a row, the mirrors and the history; --verbose adds the raw reasons, --json everything
```text
ep0ch backup list <outline> [--machine <name>]
```

an outline's snapshots
```text
ep0ch backup restore <outline> [--machine <name>] [--at <time>] --to <path>
```

an outline's newest snapshot (or the newest at or before --at: an ISO time, or 3h,
2d ago), integrity-checked, written to a new file; never over an outline in use

## install

```text
ep0ch install [--apply] [--json] [--machine-name <name>] [--dials-in | --no-dials-in]
[--add-client <ssh-name> | --remove-client <ssh-name>] [--as-client]
```

bring the stack up to date: a dry run by default (the plan). --apply backs
up every ~/outlines/*.sqlite to ~/backups/ep0ch/<time>/ first, then updates the
ep0ch checkout (fast-forward only, bun install when needed), links ep0ch on
PATH and restarts the outline host through its unit; each step is skipped when
current. Units, Herdr's config and its plugin link are said, never edited.
It names this machine once (~/outlines/.host/machine-name: what ep0ch://
links and EchoNet call it; give it the ssh name other machines use for it):
asked at a terminal, the short host name otherwise; --machine-name renames.
--dials-in: this machine calls the others for EchoNet and is never called
(its inbound ssh off or gated; ~/outlines/.host/dials-in); --no-dials-in undoes
.host/clients lists the ssh clients updated after the host, one per line.
--add-client and --remove-client manage it (--apply saves); --as-client
runs one client leg without updating further clients. Busy doors stay running.

## try

```text
ep0ch try --ws <name> [--copy] [--hub <id>]
ep0ch try --showcase [--reset]
```

the door on a private copy, or on the showcase outline (scripts/try-it.sh)

## find

```text
ep0ch find [<words>… [--lexical] | --recent | --tree [<root id>]] [--ids | --lines | --json] [--ws <name>] [--machine <ssh-name>]
ep0ch find [<words>…] [--query "<expression>" [--property-scope block|line|inline|all] [--machinery hide|only|show]] [--view <id>] [--under <id>]
[--sort <key> [--direction asc|desc]] [--updated-after|--updated-before|--created-after|--created-before <date>]
[--ids | --lines | --json] [--timeout <seconds>]
```

notes: with words, the service's ranked search, tree.search (the ranker
Goto, the door's / and (( use, asked from no note; at most 30), re-ordered
by Jev when it's set up: each row its Score (2.7/3) and a last line saying
how sure it is ("strong match: …"; "not sure it's the one: …" when the top
scores as a match but isn't settled; "no strong match: …" when it isn't one; on stderr with --ids, --lines, --json); when none is
sure, Jev reads every note's title for ones the words missed (deep, PIE-1200:
such a row says "by meaning"); --lexical leaves Jev out; --recent, its newest 30; --tree, the outline (or the notes under
<root id>) depth first, as Tree draws it; without, every note, newest first.
A <note> here is an id, ((id)), an id's first 8+ characters, a Work ID of
any prefix the outline has (PIE-870) or a [[page]], resolved by the service.
--query takes the saved views' grammar, evaluated by the outline
("type=chore area=garden", OR, NOT, ( ), created/updated ranges such as
"updated >= -7d", and any property compared as a date, number or text:
"due <= +3d", "wait-until <= today", "rating > 3"); --view the members of a saved view (type::virtual-branch),
in its order; --under the notes under that one (itself included). They
combine with each other and with words (then every word, any order: the
service's text filter), in outline order, paging every match. The date flags only
write the query (--updated-after 2026-03-01 is "updated > 2026-03-01": a
date is a whole UTC day; -7d, today, an ISO time also do).
--sort orders them as a view's [sort::] does: created, updated or any
property key (--sort due), numbers as numbers, notes without it last;
--direction asc (the default) or desc. Not with --view (its own order).
--property-scope says which chips --query reads: the note's own header
(block, the default), or all for a [needs::…] on any line too (a ticked
- [x] step's chips no longer match); each note then says the line it
matched on, and --json gives each record its matches. A view says its
own with [property-scope::all].
--machinery says what --query or --under holds of the notes tools stamp
[machine::…] (peer messages, tosses, fetched notifications): hide (the
default, said on stderr with how many), only, or show.
--ids prints ((id)) a line, for $(…) (ep0ch show $(ep0ch find --ids …));
--lines one per line, id<TAB>title<TAB>path<TAB>uri, for a picker; with --tree,
then <TAB>depth<TAB>glyphs<TAB>about (├─ │ └─; about: work-id · stage · type);
--json each note as a block record (outline-core's block-record.ts: title,
header, properties as lists, children, tasks, links, backlinks, resources,
created, updated, author) plus its canonical ep0ch:// URI, keys sorted; with --tree, the rows

## show

```text
ep0ch show <id>… [--source | --markdown | --ansi | --cells | --site] [--width <n>] [--rows <n>] [--ws <name>] [--machine <ssh-name>]
```

each note drawn as a reader draws it, at that width (default the terminal's,
else 80), live figures, ::links and a view's results answered by the
outline, folded callouts open, a blank line between notes; --source prints each note's text exactly as written
(properties, links and :: blocks verbatim, no header, no wrapping), a ---
line between notes; --markdown is --source with each live figure's results
under it as Markdown, as the door's page copy (Y) gives them (a checklist as
steps, a table as a table, tabs a list per group; at most 50 rows a figure,
a cut said with the ep0ch find command that reads the rest); --ansi keeps the drawing's colours; --cells prints each
as a line of JSON {id, columns, rows, cells, replaced}: cells row-major,
base64 of u32 LE [codePoint, fg, bg] (0x00RRGGBB, 0x01000000 the
terminal's own), one width-1 BMP glyph a cell, U+FFFD for a wider one
(counted in replaced); --rows keeps the first n rows; --site prints each note as a
line of JSON {id, uri, text, site}: its text as written and, when it holds a {{ }},
the service's whole answer for it (outline_read's site: each placeholder's values,
or problem and nearest keys, how it was found, and the notes it came from)

## revisions

```text
ep0ch revisions <id> [<n> [--restore]] [--json] [--ws <name>] [--machine <ssh-name>]
```

a note's revisions (PIE-621): the current one, then the earlier texts the
outline keeps (the newest 100, from the first save after schema version 4),
newest first, each with when it was saved, by whom, its size and first line;
with <n> that revision's whole text; --restore saves it as the note (a new
revision, recorded as you: it can be gone back on too). In the door: the tile
menu's "an earlier revision" (revision.restore), into the edit, ctrl+z there

## wait

```text
ep0ch wait <query> [--timeout <seconds>] [--ids | --lines | --json] [--ws <name>] [--machine <ssh-name>]
```

wait on the outline's watched query; print newly matching rows and exit 0.
Existing rows are the starting point. --timeout exits 2 with "nothing new".
A lost connection exits 1 and prints the command to start again.
Example: ep0ch wait 'parent:((<process-note-id>))' --timeout 60 --json

## record

```text
ep0ch record run-start  [--ticket <value>] [--harness <value>] [--branch <value>] [--worktree <value>] [--pid <value>] [--host <value>] [--summary <value>]
ep0ch record run-end  [--run <value>] [--exit <value>] [--pr <value>] [--duration <value>] [--report <value>]
ep0ch record deploy  [--sha <value>] [--host <value>] [--protocol <value>] [--grammar <value>] [--observed <value>] [--previous <value>] [--when <value>] [--who <value>] [--session <value>] [--from <value>] [--to <value>] [--local <value>] [--clients <value>] [--sessions <value>] [--failed <value>] [--details <value>]
ep0ch record finding  [--ticket <value>] [--pr <value>] [--source <value>] [--failure <value>] [--likelihood <value>] [--cost <value>]
ep0ch record finding-closed  [--finding <value>] [--fixed <value>] [--dismissed <value>]
ep0ch record suggestion  [--day <value>] [--note <value>] [--revision <value>] [--writer <value>] [--harness <value>] [--component <value>] [--gate <value>] [--confidence <value>] [--callout <value>] [--model <value>] [--prompt-rev <value>] [--source <value>] [--thread <value>] [--query <value>] [--words <value>]
ep0ch record review-finding  [--day <value>] [--note <value>] [--revision <value>] [--writer <value>] [--harness <value>] [--rule <value>] [--rubric <value>] [--component <value>] [--key <value>] [--line <value>] [--title <value>] [--passage <value>] [--said <value>] [--patch <value>] [--source <value>] [--fix <value>]
ep0ch record review-quiet  [--day <value>] [--note <value>] [--revision <value>] [--writer <value>] [--harness <value>] [--source <value>]
ep0ch record suggestion-outcome  [--day <value>] [--suggestion <value>] [--note <value>] [--outcome <value>] [--component <value>] [--writer <value>] [--harness <value>] [--because <value>] [--rule <value>] [--rubric <value>] [--title <value>] [--passage <value>] [--said <value>] [--patched <value>] [--query <value>] [--words <value>]
ep0ch record search-eval-case  [--query <value>] [--outline <value>] [--expect <value>] [--source <value>] [--surface <value>] [--rank <value>] [--asked <value>] [--note <value>]
ep0ch record jev-run  [--experiment <value>] [--run <value>] [--model <value>] [--prompt-rev <value>] [--items <value>] [--agreed <value>] [--agreement <value>] [--hit5 <value>] [--suggested <value>] [--different <value>] [--ignored <value>] [--quiet <value>] [--unavailable <value>] [--tokens-in <value>] [--tokens-out <value>] [--cost <value>]
ep0ch record groom-verdict  [--item <value>] [--verdict <value>] [--confidence <value>] [--evidence <value>] [--by <value>] [--pass <value>] [--thread <value>]
ep0ch record groom-later  [--item <value>] [--outcome <value>] [--why <value>] [--source <value>] [--by <value>] [--pass <value>]
ep0ch record work-twin  [--day <value>] [--title <value>] [--twin <value>] [--same <value>] [--outcome <value>] [--item <value>] [--writer <value>] [--by <value>]
```

append a machinery note under Deploys (deploy) or Records, filled through its use template;
--ws <name> and --machine <ssh-name> name the outline as usual.
--observed on deploy reads this machine's git HEAD, sessions and host versions.
run-end --report-file <path> saves the report and posts it on the start's ticket.

## review

```text
ep0ch review backfill [--since 7d] [--limit <n>] [--into <name> [--into-machine <ssh-name>]] [--no-jev] [--json] [--ws <name>] [--machine <ssh-name>]
```

every note an agent last wrote in the window (7d, 12h, 2w), reviewed as a new write would be:
code's measures and Jev's judgments against Evan's rubric (dense, format, buried, unclear,
mixed, context, argues), counted by rubric, rule and writer, with samples and Jev's tokens.
Reads the outline only; --into keeps the findings (source::backfill) and the run
(experiment::write-review-backfill) as records there, for the suggestions page.
--no-jev: code's measures alone.

## work

```text
ep0ch work groom [--ws <name>] [--repo <dir>] [--since 120d] [--where <query>] [--limit <n>] [--into <name>] [--no-jev] [--json]
```

Jev's first pass over the queued tickets: each against the CHANGELOG and merged pull
requests (--repo, default this checkout) and the other tickets; solved, superseded,
duplicate or open, with confidence and evidence. Reads only; --into keeps the verdicts,
a comment on each confident "solved" for the verifier, the "Jev thinks these are done"
view and the run's tokens and cost. Jev never closes a ticket.
```text
ep0ch work groom --park [--older-than 30d] [--where <query>] [--apply] [--as <name>] [--json]
```

the cut (PIE-1421): queued items untouched that long go to later with
[wreckage::<day>], except what a groom keeps: high priority, under 14 days old, or
decided (a ticked - [x], a decided figure, [decided::]); each kept one says why.
```text
ep0ch work groom --later [--where <query>] [--apply] [--as <name>] [--no-jev] [--into <name>] [--json]
```

the way back, weekly: each parked item a comment, a new note or live work asked for
again (Jev reads the note: wanted, or only cited?), or one parked against the keep
rule, goes back to queued with a line saying why; then the groom's pass over what
stays, so one that shipped gets its comment (kept in --into, else with --apply).
--apply writes it, with a groom-later record each (type=groom-later
outcome=restored counts what came back). --limit caps the items read.
```text
ep0ch work try <PIE-n>… [--ws <name>] [--into <name>] [--no-jev] [--json]
```

what a validator would try for merged tickets: the door's actions and each ticket's
lines Jev picks, as journeys (where, which keys or act call, what should show).
--into keeps it as a [type::validation-plan] note for the verifier's brief.
```text
ep0ch work create|stage|set|deliver|complete|body|link …   the outliner's work command (ep0ch work help)
```

## search

```text
ep0ch search harvest [--into pie] [--logs <dir>] [--dry-run] [--json] [--machine <ssh-name>]
```

agents' searches in Claude Code's session logs (~/.claude/projects, read only) and the
note each opened next, and Evan's picks from a search, kept as search-eval-case
records in --into (pie by default); only pie's and gurgle's notes become cases.
```text
ep0ch search eval [--models jev-1.13.0,jev-1.14.0] [--variants state,deep,state+deep] [--snapshots <dir>] [--cases <file>] [--only <source>] [--into pie] [--json] [--machine <ssh-name>]
```

the kept cases' candidates from each outline's own search, ranked by each model as
search ranks them (cached by request): hit@1, hit@5, the Noul's spread, thresholds
tried; --into keeps a jev-run per model and the report under pie's Search evals page.
--snapshots <dir> reads <dir>/pie.sqlite and gurgle.sqlite (copies: ep0ch outline
snapshot … --out) with this checkout's search, never the live host's; --variants also
runs the pinned model with the candidates in the request's state (state, PIE-1199)
and with the deep pass's finds added (deep, PIE-1200).

## new

```text
ep0ch new <text>… [--near <id>] [--as <agent id>] [--json] [--ws <name>] [--machine <ssh-name>]
```

a new note, its text the words given (a first line of only [page::x] is
titled x), where the outline puts new notes: the top of the Inbox, or as the
last child of --near (refused when that note is gone, with the command to
run instead); --as writes it as that agent; prints where it went and its id
(--json: id, title, parentId, rule, said). In the door: ctrl+n, or act note.new

## view

```text
ep0ch view order <view> [<id>…] [--json] [--as <agent id>] [--ws <name>] [--machine <ssh-name>]
```

a view's hand-set order (a view with no [sort::]: what its lanes, figures and
Tree show), one member a line: position, ((id)), work id, title. With ids
(ids, ((id)), an id's first 8+ characters, Work IDs such as PIE-552, [[page]]s;
the view is named the same ways), those members first, in the
order given, the rest after them as they were; then the order as it is now.
--json prints {view, order: [{id, title, workId?}]}; --as records the change as
that agent's (else EP0CH_AGENT's, else yours)

## artifact

```text
ep0ch artifact put <file-or-folder> [--name <name>] [--machine <ssh-name>]
ep0ch artifact ls | show|versions|snapshot|rm <name> [--machine <ssh-name>]
ep0ch artifact import --ws <name> [--machine <ssh-name>]
```

live artifact folders and frozen snapshots, outside the outline
```text
ep0ch artifact lease [<name>] [--ws <name>] [--json]
```

a one-time link to send a file (a page, a zip, a tar) into the inbox: prints the curl

## device

```text
ep0ch device add <name> [--ws <name>] | ls | revoke <name|id>
```

a phone's Shortcut token for the same inbox, made, listed and ended

## share

```text
ep0ch share start [<ref>] [--only <ref>] [--artifact <name>] [--ttl 1h] [--no-comments] [--via edge|cloudflare]
[--allow-mail <email>]… [--as <agent id>] [--json]
ep0ch share list [--all] [--json] | revoke <id> | revoke --all     [--ws <name>] [--machine <ssh-name>]
```

short-lived public links to the outline, navigated as the tailnet's web
client is: <ref> (an id, ((id)), a page name or [[page]], PIE-123) is the
page the link opens on; --only <ref> shows only that note and what's under
it. It lasts until it is revoked, or ends by itself after --ttl
(30m, 4h, 7d; from 1m; never says the default), and takes comments unless
--no-comments. --artifact <name> (name or name@n) shares one artifact on its own,
full-bleed, and nothing else. [publish::never]
notes stay hidden. --via edge (the default): the outline's public host
(https://pie.ep0ch.sh/s/<token>/); --via cloudflare: a Cloudflare tunnel of its
own on a random trycloudflare.com host, and with --allow-mail (an email or
@domain, repeatable) only those who sign in by a one-time PIN, for sharing with
someone else. list shows each open one (link, what, ends in); revoke ends
one now, --all every one. The tailnet page <publisher>/pub/shares does the same

## reader

```text
ep0ch reader [--json] [--ws <name>]
```

what your web client shows now: the page and the words selected on it

## loki

```text
ep0ch loki lease [--ttl 1h] | lease --revoke
```

a read-only Loki URL, or end all leases; run on the publisher host over ssh

## web

```text
ep0ch web sessions [--json] | web revoke <id> | --all
```

the browsers signed in to the web client (https://my.ep0ch.sh): each one's
id, browser, who and last use; revoke signs one out now, --all every one.
The web client's /sessions page does the same

## export

```text
ep0ch export [--all | <id>…] [--query "<expression>"] [--view <id>] [--under <id>] [<date flags>]
[--children] [--format md|json] [--out <dir>|-] [--split] [--resolve-links] [--manifest] [--source] [--timeout <seconds>]
```

notes out as files: the notes named (((id)) or bare ids, as find --ids
prints them) and the ones find's flags select; --all reads every live note. --format md (the default): a
file a note, its header line's [k::v] chips moved into YAML front matter
(values verbatim strings, a repeated key a list) with its id, parent,
path, created, updated and author; the body verbatim, its first line the prose
line 1 held. --children adds what's under each note, as nested lists, or
files of their own in the ancestor tree with --split. --resolve-links turns ((id)) and [[page]]
links to exported notes into relative file links. A ::graph-* figure
is written as its plain ASCII drawing in a fence (+--[ TITLE ]--+, 60
wide, live ones answered first); --source keeps it as written. --format json: block
records (as find --json), keys sorted. --out <dir> writes <title>-<id8>.md
(or .json) files there (it adds and replaces, never removes); without it
(or -), stdout. --manifest adds manifest.json: the export time, the outline,
the selection, the files it wrote and leftOut extension pages

--timeout <seconds>: how long to wait for each answer and for live figures on a busy machine (15 and 10 seconds by
default; a timed-out export says the command to run). find and mirror take the flag too. EP0CH_REQUEST_TIMEOUT_MS, in
milliseconds, says the same for a script's `ep0ch export`, `find`, `mirror` and every `outliner` CLI command (3 seconds, 30
to another machine); the flag wins. A door, Tree and Detail never read it: a keypress keeps its short wait.

## mirror

```text
ep0ch mirror <dir> [--once] [--timeout <seconds>] [--ws <name>] [--machine <ssh-name>]
```

export every live note as source in its tree, then follow changes;
--once writes one pass and exits. manifest.json records asOf,
sequence and leftOut. Restarted hosts reconnect and catch up. --timeout as export's

## library

```text
ep0ch library [<component>…] [--brief | --guide | --json | --out <dir> [--width 40|80|160]] [--ws <name>] [--machine <ssh-name>]
```

the component library (PIE-618): every component's properties, as the outline
has them (its own heading styles and callout types among the values, its
extensions' components). With no flag, the components; --brief, what an agent
reads: per component its purpose, where it goes, each property as
key: values (default) — meaning, and a minimal example (the
outline_components tool says the same); --guide, what an agent should know
the outline can hold: the house lines and every component in a line, grouped
(the MCP gateway's instructions and the Claude mod's context say the same,
PIE-721); --json, their schemas
(what completion reads); --out <dir>, a Markdown page each (<id>.md, and
README.md listing them), every variation drawn as the door draws it above its
source: attach one to a note with [file::<dir>/<id>.md] [publish::true] and the
publisher serves it as HTML. The pages to browse: ep0ch --screen library

## docs

```text
ep0ch docs [scripts|extensions]   list or read the scripting and extension references (no outline needed)
```

## scripts

```text
ep0ch <script> [key=value …] [--as <id>]
```

run a script of this folder's outline by its name with a button's slots
(PIE-1230): ep0ch neat page=[[a]] right=%tree is act script.run of=neat …, an
agent's run in its door (EP0CH_AGENT or --as), a key written twice a list; exit 1 with the
failed steps on stderr when the script said some failed (PIE-1469)

## echo

```text
ep0ch echo toss | nodelist | subscribe | areas …   (ep0ch help echo lists the flags)
```

EchoNet (PIE-779): run the echonet extension's tosser (copies in, netmail
both ways, nodelist and toss log), write and print the nodelist, subscribe
to an area by node mask, or list the areas an outline offers and reads

## ext

```text
ep0ch ext [--ws <name>] ls | add <name|path> | remove <name> | act <name> <action> [--block <id>]
| run <name> <action:id|handler:key>
```

the outline's extensions: ls lists each folder, what it serves and each
schedule (every or cron, next run, last run and what it did); act runs an
action as the extension; run runs a schedule now (the outliner's ext command)

## keys

```text
ep0ch keys list | check <KEY> | who <KEY> | set <group> <KEY> | grant|revoke <group>[/<KEY>] <scope>
```

which secrets (with-secrets groups) exist here, where, and who may have each:
names, places and modes, never a value; check exits 1 when a key isn't there;
set, grant and revoke are the person's (PIE-887; ep0ch keys with no word says more)

## machinery

```text
ep0ch machinery backfill [--ws <name>] [--apply] [--json]
```

stamp [machine::<producer>] on what tools wrote before they stamped (file
touches, EchoNet's logs and receipts, deliveries, prior art, backup runs, fetched notifications): a dry
run says how many; --apply stamps them (PIE-867)

## route

```text
ep0ch route <note> | --all [--dry-run] [--ws <name>] [--json]
```

route a note (an id, ((id)), [[page]] or Work ID), or every note, by the
outline's note mover rules: notes with [note-mover::((id))] [query::…],
listed in the Note mover view; the first whose query holds for a note moves it
there, as ext:note-mover. --dry-run says what would move where and why (PIE-1010)

## resource

```text
ep0ch resource rebind <folder> [--ws <name>] [--json]
```

read a file link's folder where it leads now, after a link in its path
changed or another folder took its place: the command a refused file link
names. A folder deleted and made again in the same place needs nothing

## clients

```text
ep0ch clients [--ws <name>] [--machine <ssh-name>]
```

who is connected to the service, every role (observers too)

## peek

```text
ep0ch peek [<section>] [--json] [--xray] [--full]
```

what the door shows now: by default the compact text (where, the person, speed,
and the screen as text, a few KB); --json one JSON object and nothing else (the
whole state, and the screen as "text"); a <section> (speed, person, layout, …) just that part;
the layout is in brief, as layout.get gives it: --full has each tile's whole description

## actions

```text
ep0ch actions | snap <png> | open <id|ep0ch://outline@machine/b/id|file:/path> [--json] | act <action> [key=value ...]
```

drive a running door; EP0CH_CONTROL names which one, else the one on
this folder's outline, else the only one running. open <id> is
act open id=<id>; a URI names its outline and machine first; open file:<path>
[diff=true] shows a file (or its git diff) where opens land; --as <id> (or EP0CH_AGENT) names the agent

## trace

```text
ep0ch trace on|off|show [action] [--last N] [--json]
```

prove which code ran in this door: ordered probes, running revision and handler findings

## agent

```text
ep0ch agent ls [--machine <ssh-name>] [--json]
```

the Claude Code sessions here (or on that machine, over ssh): name, short id, kind
(background: the daemon's job; interactive: a terminal owns it, with where it runs
when the process's parents say), busy or waiting, and the version each runs beside
the one installed, marked "behind" when it is older
```text
ep0ch agent restart <name | short id | --all> [--if-update] [--fresh-daemon] [--check-env <VAR>] [--now] [--dry-run]
[--machine <ssh-name>]
```

restart a background session at a safe moment (between turns, its builders done
and pushed), detached: it prints where the log is and returns. An interactive one
in a door terminal tile is restarted by its door after the same wait (tile.restart:
/exit, then the same command from an interactive login shell, so a changed ~/.bashrc
counts); one in any other terminal (a Herdr pane, an ssh shell) is refused, with
how. --if-update: only one behind the installed version (after a Claude Code
update); --all: every background session and door tile's, one at a time (the others
left out, said); --fresh-daemon: so a changed ~/.bashrc
reaches it; --check-env: and check the new process carries <VAR>; --now: don't
wait; --dry-run: say the plan, change nothing. It runs scripts/agent-restart here
or on --machine (only that flag names the machine, never EP0CH_MACHINE or a .ep0ch)
```text
ep0ch agent splits [--session <id>] [--machine <ssh-name>] [--json]
```

the Claude sessions running twice here (or on that machine): each process with
its pid, start and state, the command that stops it and, for a background job, the
one that attaches it (the door's ⚠ ×2 chip and the Claude mod read the same)
```text
ep0ch agent stop <pid> --session <session id> [--machine <ssh-name>]
```

stop one process of a Claude session that runs twice (two `claude --continue`s
on one session, both writing its transcript; the door's ⚠ ×2 chip): only while
that pid is still a process of that session and another still holds it, else
nothing is stopped
```text
ep0ch agent use <name> [--everywhere]
```

choose and restart the drawer agent for this outline, or every outline
```text
ep0ch agent start <persona> [--on <machine>] [--cwd <folder>] [--program <cmd>] [--outline <name>]
```

start that persona's hc terminal, or say it is already live. One launch
line (hc run --bg --no-parent --keep --name <persona>). Flags left out
come from the nearest .ep0ch/agents.toml. A live terminal is not started
again, so a phone session stays up
```text
ep0ch agent [--program <name>] [--in <folder>] [--persona <name>] [--new] [--json]
```

start an agent session in this folder (or --in one), or attach the one already
running there: the same program in the same folder is the same session. It opens
in the door on this folder's outline, as a tab in its drawer (alt+g lists every
session: jump to it, pull it into the drawer, dock it), continuing the program's
last conversation in that folder. --program: an agent config in the outline
([agent-config::<name>]) or one installed here (claude, codex, pi); left out, the
drawer's agent, else claude. --new starts another beside the one running

## where

```text
ep0ch where [--json|--source]
```

Names the source checkout, AGENTS.md, docs, skills and SHA; `--source` prints only the checkout path.
Also shows where this runs: the stack of layers (EP0CH_NEST: ssh, Herdr, door, tile), each
checked (the door's pid and control socket, the Herdr pane, the tile), and where
the person's keys are. Read-only; "not in a door" outside one.

## subscribe

```text
ep0ch subscribe [type,...]       the door's live feed: focus.changed, viewport, cursor, layout.changed,
```

marks.changed, one JSON event per line (docs/AGENT-INTERFACE.md)

## help

`ep0ch --help` and `ep0ch help` list everyday commands in one screen.
`ep0ch help --more` lists every command. `ep0ch help <command>` and
`ep0ch <command> --help` show its synopsis, flags and examples. `-h` works too.
`ep0ch help launch` explains opening an outline, including flags and environment.
`ep0ch help session list` explains just that subcommand. Add `--more` for this reference.
Unknown commands and door flags exit 2, suggest the closest known word and open no door.
A name that is not a command is first tried as a script (see the scripts section).

## completions

Print a shell script with `ep0ch completions bash`, `zsh` or `fish`, then source it.
For example: `source <(ep0ch completions bash)`.
The script asks `ep0ch completions -- <words through the cursor>` for command names,
session subcommands and flags. These come from the same definitions as help.
Completion offers command words and flags, without querying argument values or files.

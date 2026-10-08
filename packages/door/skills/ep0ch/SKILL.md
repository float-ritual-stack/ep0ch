---
name: ep0ch
description: Use when an agent needs to see or act in an ep0ch door (the BBS-style terminal client for an outline) — reading what the person sees, opening a note in front of them, editing, commenting, moving cards or pointing at a block — or when running a door of its own. Covers the ep0ch command, the control socket, attribution and the rules that keep the person's door, focus and drafts safe. For writing in the outline itself use ep0ch-outline; for changing the door's or outliner's code, ep0ch-core.
---

# ep0ch: working in a door

ep0ch is a terminal door into an outline: the board (kanban), desk, river and BBS screens, all built on one
note surface. Everything the person can do there, an agent can do through the door's control
socket, with the same checks (revisions, property warnings, duplicate-safe comments) and honest attribution.

Two sibling skills: `ep0ch-outline` for working in the outline for the person (notes, properties, views,
pages, publishing, extensions), and `ep0ch-core` for changing this code (including the real-pane test recipe).

## Commands

    ep0ch help                       every command, with its flags: the truth when this list and it differ
    ep0ch --ws <name>                open the door on an outline (created if nobody has it yet, on this machine only;
                                     on another machine only with --create)
    ep0ch --machine <ssh-name>       the door here, the outline on that machine; --remote <ssh-name>: the door session there
    ep0ch --showcase [--reset]       every shared door part on its own seeded outline of made-up notes
    ep0ch init [<name>]              name this folder's outline: write .ep0ch (creating the outline if needed)
    ep0ch outline list [--json]      the host's outlines: name, open, database
    ep0ch outline attach <name> [--json]   open the door on it (--json: only attach, print the answer)
    ep0ch outline create <name> | import <database.sqlite> <name> | stop <name> | delete <name> --yes
    ep0ch status [--json]            the host: socket, outlines folder, open outlines
    ep0ch where [--json]             which door, tile and Herdr pane this process runs in, and where the keys are
    ep0ch clients [--ws <name>]      who is connected to the outline (every role)
    ep0ch find [<words>… | --recent | --tree [<root>]] [--lines | --json]
                                     notes, ranked as Goto, / and (( rank them; no door needed
    ep0ch find --query "<expr>" [--view <id>] [--under <id>] [--ids | --lines | --json]
                                     the notes the outline says a query holds for (the views' grammar; --updated-after
                                     <date> and the like write it); --ids prints ((id)) a line, --json block records
    ep0ch show <id>… [--width <n>]   notes drawn as a reader draws them, as text; --source: as written; no door needed
    ep0ch export <id>… | --query … [--children] [--format md|json] [--out <dir>]
                                     notes as files: the header line's chips in YAML front matter, the body verbatim
    ep0ch peek                       the screen as text plus structured state
    ep0ch actions                    what the current screen can do, with arguments and keys
    ep0ch act <action> [key=value…] [--as <agent-id>]
    ep0ch open <block-id> [from=<tile>] [--as <agent-id>]
                                     put a block in front of the person: the same as act open id=<block-id>
    ep0ch subscribe [type,…]         the door's live feed, one JSON event per line
    ep0ch snap [out.png]             exactly what the terminal shows
    ep0ch try --ws <name> --copy     your own door on a private copy of an outline
    ep0ch session list | attach --watch | end   this folder's outline's session (or --ws <name>)
    ep0ch --skill [<name>]           the stack's skills, or the path of one
    ep0ch doctor [--json]            the whole stack's state (✓ ! ✗) with a fix command for each; read-only
    ep0ch install [--json]           the update plan (a dry run); --apply runs it

`bun src/main.ts …` in packages/door of the ep0ch checkout is the same command. The action table is the
door's README, "Letting an agent see what you see, and do what you do", and the rules per path are its
`docs/AGENT-INTERFACE.md` (`ep0ch --skill ep0ch` shows this file's path; the package is two directories up);
`ep0ch actions` on a running door lists what its current screen takes.

## Checking and updating the stack

`ep0ch doctor --json` is the first thing to run when something in the stack seems off: bun, the ep0ch
checkout, `ep0ch` on PATH, the plugin in Herdr, the outlines folder with its host and unit, which outline
this folder opens, Herdr's keys and the Claude mod. It only reads (`git fetch` aside).

`ep0ch install` without `--apply` is safe to run any time: it prints the plan. Run `--apply` only when the
person asked for the update: it also hands the person's door session to the new code, which restarts every
terminal attached to it. It backs up every outline database to `~/backups/ep0ch/` first, then
fast-forwards the ep0ch checkout and links `ep0ch`. When the host's code changed it also restarts the outline
host through its systemd or launchd unit, and every door and pane on it reconnects: say so before you run
it. Install never writes a unit, Herdr's config or Claude's settings; it reports them as notes.

## Which outline a door opens

One outline host per machine serves every outline in `~/outlines` (`EP0CH_OUTLINES`) by name:
`<name>.sqlite`, with its own folder `<name>/` beside it. Which one a door opens, first match wins: `--ws <name>`
from anywhere, then `EP0CH_WS`, then the nearest `.ep0ch` from the folder up (it holds `ws = "<name>"`). A name
nobody has yet is created on this machine; on another machine never without `--create` (the home base offers
`home.open` the one here, `home.new name= machine=`, `home.cancel`). A folder that names none opens the home base, a door screen (`home`): this machine's
outlines (open, new, import), the machines opened from here (add one from ssh config), each choice an action
(`home.open outline= [machine=] [write=true]`, `home.new`, `home.import`, `home.add`, `home.connect`); an agent's
open writes the folder's `.ep0ch` only with `write=true`. Without a terminal it says what to run instead
(`ep0ch init`, `--ws`, `ep0ch outline import`). An outline on another machine is
named by `--machine <ssh-name>`, `EP0CH_MACHINE` or the `.ep0ch`'s `machine = "<ssh-name>"`: the door reaches it
through a shared ssh forward (`~/outlines/.remote/<ssh-name>.sock`) and starts it again when it drops.
`ep0ch --remote <ssh-name>` is the door session running there, in this terminal. `outline list`, `status`,
`clients`, `find` and `show` never create. The status bar and `peek` show `host · outline`. Delete moves an outline to `.deleted/`; pass `--yes`
only when the person asked for it.

## Which door you reach

- **Inside a door** (a terminal tile, the drawer, the daily agent's Herdr pane, the door's drop shell),
  `EP0CH_CONTROL` is already that door's socket, `EP0CH_TILE` your tile's name and `EP0CH_NEST` the layers
  you run in. Run `ep0ch where` first: it checks each layer and says whether the person is typing in your
  tile. Open notes with `ep0ch open <block> from=$EP0CH_TILE` (the same as `ep0ch act open id=<block>
  from=$EP0CH_TILE`: there is one open), so they land where your tile's opens go, on the desk and the board
  alike; never name a reader you guessed.
- Otherwise the control commands talk to the door on `EP0CH_CONTROL`, else the one on the outline the folder
  names (its `door.sock` in `~/.local/state/ep0ch-door/sessions/<local or machine>/<name>/`), else the only door
  running — **usually the person's own door.** With several running and none named, the command prints the
  `EP0CH_CONTROL=…` to use for each.
- Act on the person's door only when they asked you to (show them something, make an edit they
  requested). Otherwise run your own: set `EP0CH_STATE` and `EP0CH_CONTROL` under a temp directory, start
  it with `ep0ch try … --copy` or against a scratch service with `--no-daemon` (else it runs as a session that
  outlives your pane), and pass the same `EP0CH_CONTROL` to every
  command. Keep that directory short and mode 700 (`mktemp -d /tmp/…`): a long socket path fails, and the
  door serves no socket in a folder others can reach. `ep0ch-core` has the whole recipe, mouse included.
- **The person's door is a session** (`ep0ch session list` says; README "Sessions: quit is detach"): it runs
  without a terminal, and its control socket answers whether or not a terminal is attached. To see it as a terminal does,
  `ep0ch session attach --watch` in a pane of your own (read-only, never the person's keys). Never attach to the
  person's session without `--watch`: your keys would be theirs. Ending it (`session.end`, `ep0ch session end`) is
  the person's; a session you started on your own `EP0CH_STATE` you end yourself (`EP0CH_STATE=… ep0ch session end --all --yes`),
  or it keeps running after your pane is gone.
- Name yourself: `EP0CH_AGENT=<your-id>` once, or `--as` on each `act` and `open`. The door records and shows
  it. `ext:<id>` is an extension's and is refused: only the outline service writes as an extension. To run
  one's action, run it as yourself (`act ext.<id>.<action> block=<id>`); the change feed records you as
  who asked (`requestedBy`) beside the extension's writes.

## Door tools in Claude

In a Claude session inside a door tile (`EP0CH_CONTROL` set), the Claude mod (packages/claude-mod) adds
`door_where`, `door_peek`, `door_act` and `door_open`. They run `ep0ch` on that tile's socket. Prefer them to
running `ep0ch act` through Bash. Outside a door tile they aren't there: use the commands above.

**One open.** `show`, `door_open`, a click on a reference in Claude, `ep0ch open` and `act open` are the same
open: in a door tile it lands where that tile's opens go (`from=$EP0CH_TILE`), the door choosing the reader and
saying which; in Herdr outside a door, `show` uses the Outliner Detail beside Claude (the Tree-linked one, opened when there is none, never taking focus); elsewhere it answers the `((id))`.
It never moves the person's focus, and a door's refusal is the answer, never a reason to open it elsewhere.

**Three ways a door agent starts, one environment.** Each gets the same variables (`agentVars`,
`src/desk/agent-env.ts`): `EP0CH_CONTROL`, `EP0CH_TILE`, `EP0CH_TILE_ID`, `EP0CH_NEST`, `EP0CH_IN_DOOR`, and
the door's `EP0CH_STATE` and `EP0CH_SOCKET` when it has them.
1. `^W o s` on the desk, then `claude` in that shell: a terminal tile's program.
2. The `▲ claude` chip on the status bar, or `alt+a`: your drawer, pulled up over any screen. Its own tab runs the
   agent chosen for the outline's session (`alt+g`, `host.agent name=<agent> [herdr=true]`; `EP0CH_DAILY_AGENT`
   overrides it; none chosen: a shell). Chosen "in Herdr", it runs in the session's own pane (`door-<outline>[--<machine>]-<hash>`,
   `EP0CH_CONTROL` a link the launcher points at the attached door). Any tile put in it travels with the person.
   Every agent starts inside the person's login shell: when it exits, the tile is their shell, nothing restarted.

**A Claude reads these, and the mod, only as it starts.** If the mod changed after it started (a `git pull` of
the ep0ch checkout), or it started without them, it has no door tools or old ones. The chip says so:
`▲ claude · door tools` when current, `▲ claude · started before update ⟳` (or `no door tools ⟳`) when not.
`ep0ch act agent.knows` says the same with why; `ep0ch doctor` lists every door agent on an older mod.
A click on `⟳`, `alt+R` or `ep0ch act agent.restart` restarts the door's agent, keeping the conversation
(a bare `claude` gets `--continue` on this restart only; in Herdr it comes back in the session's pane). Your `agent.restart` is refused while the person types in the agent. A `claude` you started in a tile
yourself (path 1): `/exit`, then `claude --continue`.

- **Who it's from:** each act and open goes with `--as`: the call's `actor`, else `OUTLINER_ACTOR`, else
  `EP0CH_AGENT`, else `claude-code`. The person's screen shows it.
- **`door_act {action, args, reader?}`:** `args` is `key: value`. `ep0ch` reads a value starting with `@` as
  a file, so the tool sends one such value through stdin, and refuses a second in the same call. `as` and
  `reader` aren't args: use `actor` and `reader`.
- **Refusals pass through:** when the door refuses (focus, keys, a reader the person is typing in), the tool
  fails with the door's reason. Don't route around it: set a `block.mark`, or wait until they're idle.
- **`door_open {id}`** takes an id, `((id))`, `[[page]]` or Work ID, and opens it where your tile's opens
  land (`from=$EP0CH_TILE`). It never moves the person's focus.
- To read or write notes, use the mod's `outline_*` tools (`outline_read`, `outline_edit`, `outline_patch`,
  `outline_comment`…). They work in any session, not just a door tile. Which to use when, and how the
  person writes, is the `ep0ch-outline` skill.

## Rules the door enforces, and you should expect

- An agent never takes the person's focus, keys, selection or the reader they're typing in; such actions
  are refused with the reason. Your selection, focus marks and backlinks views are your own.
- The person can limit what you do to a tile: `free`, `edit` (edit its note, never navigate, close, move or
  retarget it) or `off` (read it through `peek` only), per tile with a screen default. Read them first: `ep0ch where`
  says `agents may: …`, `peek` has `agentLimits` and each limited tile's `agents`. A refusal names the policy and the
  person's command (`tile.agent policy=free tile=<tile>`); it is theirs to change: you can only tighten a tile, never
  loosen one. An `open` that names no tile skips limited tiles. Their own keys are never limited.
- Your `select.copy` (and `copy`, `draft.copy`) returns the text to you and never touches the person's
  clipboard. Their mouse selection is copied when they let go (copy on select; `EP0CH_COPY_ON_SELECT=0`
  turns it off), and their `y` or cmd+c copies too.
- Writes carry the revision they read; a changed note is refused, never overwritten. Read again and retry.
- Drafts are never discarded: a refused save keeps the text; unsaved text is copied to disk on exit.
- An agent never moves the reader the person has: `link.follow`, `element.open`, `up`, `back`, `props.follow`,
  `threads`, `resolve` and `open tile=<reader>` are refused there (use another reader, or `open id=` naming
  none: it lands where opens land, which can be the note they're reading, said on screen, never their keys and
  never a reader they're typing in). A web link or figure you follow is never opened in their browser or viewer: you get the address back.
- While the person has a note open in a draft, you don't write it underneath them: an `edit` of it in
  another reader, an `edit.text` in their own edit (or one they're typing in), a `props.edit`, a step or a
  card move on it is refused. Patch their draft instead
  (`outline_patch`, the service's `draft.patch`: it lands above their cursor, or becomes a proposal), or
  wait until they save or close it. The draft actions (`draft.*`, `session.leave`) work only in a draft you
  opened and alone typed in.
- Test data belongs in scratch services with fictional notes, never a real outline.
- **Inserting from a picker** (`draft.pick`, ctrl+t: television in a tile beside the reader) is the person's
  only: it takes their keys. Put text in their draft with `draft.patch`, or in an edit you opened with `edit.text`.
- Moving the person's screen (`screen.open`, `screen.back`, `list.*`, `host.toggle open=true`) waits until
  they've been idle 2s and aren't typing, and is said on their status bar. `screen.shell` (drop to shell) is
  theirs only: yours is refused. Use a terminal tile (`tile.open kind=pty`) for a program of your own.

## Useful actions beyond notes

- **The drawer** (every screen; the host layer's, PIE-498, PIE-513): `host.toggle [open=true|false]`, `host.size
  share=0.2…0.9`, `agent.type text=…` (to its own program), `agent.knows`, `agent.restart`. `tile.drawer tile=<t>`
  moves a tile into it whole (its program keeps running), `tile.drawer on=false tile=<t> to=<tile> where=<side>` back
  out into the screen shown; `tile=` naming a tile in the drawer reaches it there (`tile.type tile=kettle`). Put your own
  tile in: `tile.drawer tile=<id>` with the id `ep0ch where` gives (it finds your tile by your program, even after it
  moved; `$EP0CH_TILE_ID` is only where it started). Tiles in the drawer have ids `k<n>`. Its own first tab can leave too: `tile.drawer on=false tile=drawer.agent` puts it
  on the screen as an ordinary terminal tile, still running, and the drawer starts a fresh one the next time it's pulled
  up. It never takes the person's keys; you can't move the tile they type in into it,
  put it away, resize it, type in it or restart its agent while they type in it. `peek` shows it as `drawer` (with
  `knows`, `runs` and `tiles`).
- **Links** (one model on every screen: Outlinks, Resources, Backlinks). `links tile=<reader>` aims the
  screen's links tile at that reader's note (or opens one below it), leaving the person's keys where they are;
  `backlinks.pick n=<row>` shows a row (a note, a ticket's block, a Resource's stored content) and
  `backlinks.open n=<row> [where=origin|new]` opens it for real (a Resource is registered first if it must be):
  `origin` in the tile the list's opens land in (a tile linked to it as a target, else the reader it lists the
  links of), `new` in a new detail beside that reader; `backlinks.view filter=…` filters. In the outline tree,
  `tree.links n=<row>` shows a row's links under it and `tree.pick n=<row> [open=true]` picks one (`peek`'s
  `tree.rows` numbers them). Folding a group (`backlinks.fold`) is the person's view.
- **New notes and pages** (every screen, PIE-544): `note.new text=… [near=<id>|inbox=true]` makes a note where the
  outline's placement rule puts it (under `near`, else the top of the Inbox; a `near` that's gone is refused, with
  the `inbox=true` command to run instead), as you, said on the status bar (with no door open: `ep0ch new "<text>"
  --as <you> [--near <id>] [--ws <name>] [--json]`, the same call); it opens nothing (`opens=float` shows it to the
  person, unfocused) and never takes the person's focus. The person's `ctrl+n` floats a new note each time (PIE-591). `page.create address=<name>` makes the page a missing
  `[[name]]` points at (`name [page::name]`, in the Inbox); `link.follow` on a missing page never makes one. A first
  line of only `[page::x]` is titled `x` on save, so `text="[page::2026-09-30]"` gives `2026-09-30 [page::2026-09-30]`.
- **Search:** `search query=<words>` answers the service's ranked hits (as Goto, `/` and `((` rank them, from the desk's current note); nothing
  on screen moves. `ep0ch find <words>` is the same without a door.
- **The desk:** `layout.get` (tiles, splits and tab sets by stable id, and `rev`), `tile.open`, `layout.move`,
  `block.mark reason=…` to ask for the person's attention. Pass `expected=<rev>` when you name by place.
  `tile.preview tile=<reader>` (`where=right|down|left|up`) opens a reader beside it where its opens land, linked in
  one step: then `link.follow tile=<reader> n=…` lands there and the reader keeps its note. Called again it answers
  `existing: true` and shows that one; it never takes the person's keys (the person's `O`, `^W v`, `^W V`).
- **Screens people make** (PIE-565): `screen.open name=blank` gives a blank screen; `blank.fill kind=tree|reader|detail|pty|query
  tile=blank` (a query lane takes `view=<id>`) puts the first tile in its place, `tile.open`/`tile.link` build the rest, and
  `screen.save name=<name>` writes it to the outline as a screen note (`[type::screen]`, its spec as JSON), attributed to
  you. Any door on the outline then opens it (`screen.open name=<name>`, `ep0ch --screen <name>`); `screen.list` marks
  them `made: true` with their note; saving again is checked against the revision read; `screen.delete name=<name>` trashes
  its note. Read one with the outline tools like any note.
- **The board** is a screen spec on the desk: the same `layout.get` and `tile.*` work there. Its lanes are
  query tiles named by their lane, in a `columns` container filled from the hub; its readers are `preview`,
  `detail1`…; the outline dock is `tree` over `tree-preview`, the backlinks dock `backlinks` beside
  `backlinks-preview` (`tile.slide tile=tree` opens the outline, `backlinks id=<id>` reads a note's backlinks).
  Cards: `card.select` (yours is your own), `card.move lane=…`, `card.create`, `steps`,
  `step.set`; `board.hub` lists or shows a board. On the desk, `tile.open kind=query view=<view id>` puts a
  saved view's cards in a tile.
- **The river** is a screen spec on the desk too: its columns are `river.column` tiles in a flow (`library`, then
  `column`, `column2`…). `open id= from=<column>` puts a note in the column after it; `column.select`, `column.filter`, `column.complete` (what a filter's word offers),
  `column.tag` act in a column (never the one the person has the keys in); `tile.widen` and `tile.hold` (held full) shape it.
- **What waits on the person** (PIE-614): terminal tiles report status with OSC 7501. `peek` gives each terminal's
  `status` records, `status.list` reads the list the person opens with `alt+w`, `host.waiting` opens it. Marking a
  done as seen (`status.seen`) is theirs; yours is refused.
- **Reading a note to its end:** `scroll to=end` goes to the last line, then past it; `view.get` says `atEnd` and
  `past`. `reader.overscroll rows=none|half|<n>` is the person's setting.
- **The door moves under you:** a session handover or restart doesn't strand a Claude in a tile. `EP0CH_PLACE`
  names the outline's session folder, and `ep0ch act|peek|open|where` find the door from it; `ep0ch where` says when
  your environment is stale.
- The full list and the rules for each are in the door's `docs/AGENT-INTERFACE.md`.

## When something looks wrong

`ep0ch peek` first (it shows the state the door acts on), then `ep0ch actions` for what's possible right
now. A refusal message says why and what to do instead.

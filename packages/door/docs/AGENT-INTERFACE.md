# The door's agent interface

An agent sees what the person sees, live, and can change anything except where the person's cursor is.

- **Commands are the only way the UI changes.** Every change is a named action in an `ActionSet`: the person's
  keys, clicks and drags call it, and so does an agent over the control socket (`act`). The same code runs
  either way, and an agent's run is always said on screen ("an agent (claude-7) moved draft below tree").
- **Reads:** `layout.get` and `view.get` say what's on screen, as JSON.
- **A live feed:** `subscribe` pushes every change to what the person sees as it happens: focus, what each
  tile has in view, cursors and selections, the layout, and marks.
- **Agents never take the cursor.** One rule, in one place (PIE-514): every action declares what it touches,
  and each screen host's dispatcher (`src/surface/dispatch.ts`) checks that against where the person is (the
  shell's one query, `src/whereabouts.ts`) before it runs, for every action, however it was called. Typing
  means in an edit, a comment or the property panel, in a terminal tile, in a board, river or brief tile's own
  edit, in the drawer, or with a picker open. The paths it guards are listed below. An agent never moves the outline's cursor or the person's selection at all. To get the
  person's attention, an agent sets a mark (`block.mark`).
- **Edits go through the owner.** Notes are written through the outline service, with revision checks and
  `author: agent`. An nvim tile's buffer is written through nvim's own socket, which moves no one's cursor.

## The control socket

`EP0CH_CONTROL` names it (default `door.sock` in the folder of the outline the door is on, in its state dir:
`$EP0CH_STATE` or `~/.local/state/ep0ch-door`, then `sessions/<local or ssh-name>/<name>/`; a second door on the same
outline serves on `door-<pid>.sock`, and a starting door sweeps sockets no door listens on). A control command
without `EP0CH_CONTROL` reaches the door on the outline its folder names (`EP0CH_WS`, the `.ep0ch`), else the only one
running; with several, it prints the `EP0CH_CONTROL=…` for each. **The socket is the door's shell:** a client can do what the person can, including
start a program in a terminal tile (`tile.open kind=pty cmd=…`), and `as=` is only a claimed name. So it is
0600, in a folder that is the user's alone (0700, owner checked, the nvim sockets' check); in a folder anyone
else can reach, the door serves no socket and says why. A request line longer than 16 Mi characters is refused and cut off (well above any note's whole text for `edit.text`). Every terminal tile gets its door's own socket as `EP0CH_CONTROL`, its tile's name as
`EP0CH_TILE` and its id as `EP0CH_TILE_ID`, so a program in a tile
reaches the door it runs in (for the daily agent in Herdr, the socket of the door attached to it; see the
README's "The daily agent in Herdr"). It is also told its outline's session folder as `EP0CH_PLACE` (PIE-604), so it
follows its door through a handover or restart: `ep0ch act|peek|open|where` and the outliner's `door-open` (so the
Claude mod) take `EP0CH_CONTROL` while it answers from that folder, else the outline's `door.sock` there, never another
outline's door (outline-core's `door-reach.ts`, the one rule). `ep0ch where` says when the environment is stale and
which door it answers for now. A door never serves on an inherited `EP0CH_CONTROL` naming another outline's folder. It speaks newline-delimited JSON:
one request per line, one answer per line (`{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`).

**In a door session** (PIE-418, the README's "Sessions: quit is detach") the session serves this socket, so it lives
as long as the session, not as long as a terminal: an agent's `act` and `peek` work while no terminal is attached, and
`peek` adds `session` (its `pid` and `clients`: each attached terminal's size, video mode, whether it `active`ly has the
person's keys, `watch`, `idle`). The person's keys are wherever they last typed; the actor rule reads one person
whichever terminal that is. To see the session as a terminal does, an agent attaches read-only: `ep0ch session attach
--watch` in a pane of its own is shown every frame and never given the keys (its `q` or `ctrl+c` stops watching).
Ending the session (`session.end`: `E` on the main menu, `ep0ch session end` at the person's shell) is the person's
only: an agent's `act session.end` is refused, a terminal attached to the session can't end it over the wire, and an
agent never runs `ep0ch session end` on the person's state dir (a session it started on its own `EP0CH_STATE` it ends
itself).

| Request | Answer | CLI |
|---|---|---|
| `{"cmd":"peek"}` | the screen as text, and the screen's own `describe()`, with the door's `pid` and `nest` (the layers it runs in) and `person`: where the person is (`focus`, `typingIn`, `busy`, `why`, `keys`, `idle` ms, `away`), the answer every agent rule reads | `ep0ch peek` |
| `{"cmd":"snap","path":"x.png"}` | a PNG of exactly what the terminal was sent, written under the door's state (`path` relative to it, or inside it; default `screen.png`); anywhere else is refused | `ep0ch snap` |
| `{"cmd":"snap","data":true}` | the same PNG, base64, for the client to write | `ep0ch snap x.png` (the command writes `x.png`, into a folder that must exist) |
| `{"cmd":"actions"}` | every action the current screen takes, with its arguments and keys | `ep0ch actions` |
| `{"cmd":"act","action":"…","args":{…},"tile":"<tile>","as":"<actor id>"}` | the action's result | `ep0ch act <action> k=v … tile=<tile> [--as id]` (`--tile` works too) |
| `{"cmd":"act","action":"open","args":{"id":"<block>","from":"<tile>"},"as":"<actor id>"}` | puts a block in front of the person (the `open` action: there is one way) | `ep0ch open <id> [from=<tile>] [--as id]` (`act open id=<id>`) |
| `{"cmd":"act","action":"open","args":{"file":"<absolute path>","diff":true},"as":"<actor id>"}` | a file on this machine where an agent's open lands (PIE-602): Markdown drawn as the preview draws a file, any other file through the file Resource reader, `diff=true` its changes (git's diff against its last commit, else against `against=<copy>`) | `ep0ch open file:<path> [diff=true] [against=<copy>] [--as id]` |
| `{"cmd":"subscribe","types":["focus.changed",…]}` | the live feed on this connection (below) | `ep0ch subscribe [types]` |

## Where am I: `EP0CH_NEST` and `ep0ch where`

A program can't tell from its own variables which stack it runs in: each layer only sets its own, and the
door drops the Herdr pane's variables from a tile, since the tile isn't that pane. So each layer appends itself
to `EP0CH_NEST` as it starts the next: one line, outermost first, layers joined by ` › `, at most 480
characters (past that, the oldest layers after the first become one `…`). `src/nest.ts` writes and reads it.

| Layer | Written by | Form |
|---|---|---|
| an ssh session | the door, from `SSH_TTY` (else `SSH_CONNECTION`), when the nest has no ssh layer | `ssh:pts/5`, or `ssh:-` without a tty (the client address is never recorded) |
| a Herdr pane | the door, from `HERDR_PANE_ID` before it drops it, unless the nest already ends in a Herdr layer | `herdr:w1:p1` |
| a door tile | the door, for each terminal tile (`tileEnv`) | `door:<pid>/<layout or view>/<tile id>:<tile name>` |
| the drawer | the door, for its own tab (PIE-498); a terminal put in it from a screen keeps the layer it started with | `door:<pid>/drawer/drawer.agent:claude` |
| the daily agent's Herdr pane | the Herdr launcher (`scripts/door-agent-herdr.ts`), for the pane it makes | `herdr:door-<outline>-<hash>` (the pane's label) |

The three routes:

    ssh:pts/5 › door:1388380/desk/t1:claude                               # plain ssh: a door, a tile
    ssh:pts/5 › herdr:w1:p1 › door:1388380/desk/t1:claude                 # the door in a Herdr pane
    ssh:pts/5 › herdr:w1:p1 › door:1388380/drawer/drawer.agent:claude › herdr:door-pie   # the drawer's agent in Herdr, the pie session's own pane

The nest says how the program was started, not what is true now: a tile moved to another layout keeps its
launch place, and the agent's Herdr pane keeps the door that made it while another door shows it.

`ep0ch where [--json]` checks it and says what is live. It only reads:

- **the door:** its pid is running, and its control socket (`EP0CH_CONTROL`) answers `peek`. `peek`, not
  `layout.get`: the same tiles, ids and focus, without an agent's act being announced on the person's
  screen each time an agent starts;
- **the tile:** the desk has a tile with that id (by name for a door older than tile ids), and this process
  descends from its program;
- **a Herdr pane:** `herdr pane list` has it (read-only), and whether it is focused;
- **an ssh layer:** its tty is still there;
- **the keys:** whether the person is typing in this tile, has it focused without typing, is on another tile,
  or is on another screen than the desk.

In the daily agent's Herdr pane, `EP0CH_CONTROL` is the link to whichever door is attached, so `where` names
the tile that shows the pane now, in that door, and marks the door that made it `✗` when it has gone. With no
`EP0CH_NEST` and no `EP0CH_CONTROL` it answers `not in a door`, with the ssh and Herdr layers the environment
shows. A door older than these fields is still read: what it can't check is `?`, never guessed.

    you are in: ssh:pts/5 › door:1388380/desk/t1:claude
      ✓ ssh   pts/5                           /dev/pts/5 is there
      ✓ door  pid 1388380 · desk · outline pie  running · its control socket answers
      ✓ tile  tile t1 claude                  on the desk · this process runs in it
    keys: the person is typing in this tile (t1 claude)

`--json` gives `{ inDoor, recorded, nest, layers: [{ kind, label, live, why }], door, keys, summary }`;
`summary` is one line for an agent's context (the Claude mod hands it to Claude at the start of a session).

`as` (or `EP0CH_AGENT` for the CLI) names the agent. It is shown on screen and recorded with what it writes.

### `subscribe`: the live feed

The connection stays open, and each change comes down it as one line: `{"event":{"type":…,"at":<ms>,…}}`.
Only what changed is sent, at most every 50ms (changes in between are coalesced into one diff). `types`
(optional) picks which kinds. A subscriber that stops reading is disconnected once 1 MB waits unread for it.
The door paints at most once a frame (16ms), however busy its terminal tiles are.

| Event | Fields | When |
|---|---|---|
| `hello` | `screen`, `state` (everything below, whole) | first, on subscribing |
| `focus.changed` | `tile`, `block` (the note it shows, the outline's row, the board's card), and for a terminal tile `file` and `typing` | the person's keys move, or what the focused tile shows changes |
| `viewport` | `tile`, `viewport` | what a tile has in view changes. A reader gives `block`, `title`, `first` and `last` (1-based note lines in view) and `top`, `room` and `total` (the body's scroll), `atEnd` (its last line is in view) and `past` (the blank rows under it, scrolled past the end, PIE-622). The outline gives `selected`. A terminal gives `file`, `running`, and for nvim `first` and `last` (lines in its window). A screen tile gives `selected` |
| `cursor` | `tile`, `cursor` | a reader's text selection (`selection`), nvim's cursor (`file`, `line`, `col`, `mode`), or a terminal's screen cursor (`screen: {x, y}`). A terminal's cursor is sent only for the focused tile |
| `layout.changed` | `layout`: `name`, `rev`, `rule`, `zoom`, `locked`, `tree` (splits with their `id`, `path` and `shares`, tab sets with their `id` and the tab `shown`, docks with their `id`, edge, `open` and `kid`, each container's `policy`, tiles with their `id`), `tiles` (each `tile`, `id`, `kind`, `rect`, `link`, `tabs`, `pinned` or `dock` with its `edge` and `container`, `source`, and for a terminal `cmd`, its nvim `socket` and `herdr`) | a split, move, tab, dock in or out, open or shut, resize, policy, lock, load |
| `marks.changed` | `marks`: each mark's `n`, `block` or `tile`+`line`, `reason`, `by`, `at`, `showing` | a mark set or dismissed |
| `screen` | `screen` | the door moved to another screen (the feed is the desk's) |

The feed is the desk's, and every view built on it (the brief, the pinned pages, Waiting). Other screens say
`screen` only.

## Reads

| Action | Gives |
|---|---|
| `layout.get` | `rev` (below), `locked` and the screen's `policy`; the tile tree (`describeTree` by name): each split with its `id` (`s<n>`), `path` and each kid's `share`, each tab set with its `id` (`g<n>`), each dock with its `id` (`d<n>`), edge, `open` and its `kid` (at path `<dock's>.0`), each flow with its `id` (`f<n>`), `wide` (its wide column) and `held` (the columns held full), each container's `policy`, each tile with its `id` (`t<n>`); and each tile's `id`, `n` (its number on screen), `name`, `kind`, `rect`, `tabs`, `link` (`linkFrom: opensInto` when a container's policy gives it), `dock` (`open`, `shut`) with its `edge` and `container`, `cover` in a flow (`full`, `peek`, `spine`), the `policy` over it when it says anything (`locked` by whom, `draggable`, `droppable`, `resizable`, `accepts`), `source`, `showing`, and for a terminal its `cmd`, `file`, `pid`, screen `text`, `nvim.socket`, and `herdr` |
| `layout.policy tile=<tile>` (nothing to set) | each policy layer over the tile (the screen's, each container's, its kind's default), what applies (`effective`, with `by` naming the layer that said each field), and the containers' ids |
| `view.get` (`tile=<tile>` for one) | `focus`, and each tile's `viewport` and `cursor` as the feed gives them. For one terminal tile, also its `screen` text |
| `tile.info tile=<tile>` | one tile as `layout.get` gives it |
| `tile=<mount>/<tile>` on any action (PIE-651) | a tile inside a screen mounted in a tile (`tile.open kind=screen screen=board`, a part, a group): the action runs on that screen, as `act` there would; `expected=` is its revision (`layout.get`'s `mount.layout.rev`). `tile=<mount>/` names none (the mounted screen's own default) |
| `tile.menu tile=<tile>` | the tile's menu as data (PIE-492), `rows`: each `action` with the `args` and `tile` (its id) it would run with, its `label`, `group` (Tile, Note, Reader, Terminal, Board, an extension kind's name), `key` (a key name, the person's keycap) and, when it would be refused now, `refused` with why, checked for you as the actor. Nothing is drawn and the person's keys stay where they are; run a row with `act <action> tile=<tile> <args>`. The person's `tile.menu` opens it over their screen (`at=<col,row>`, else under the tile's `⋯`) |
| `marks.list` | every mark, and the tiles showing it |
| `layout.list` | the layouts that can be loaded, saved or built in |
| `screen.spec` | the screen shown as its spec (PIE-515): its name, title, layout as it opens (containers with policy, tiles by kind with their names and args), key map, hint, band and where opens land; the data a screen note holds |
| `actions` | everything the screen can do |
| `screen.list` | the menu's screens, every registered screen by name (`named`, with the argument its target fills) and the stack the person is on |

**Opening a screen.** `screen.open name=<name> [target=<target>]` opens any screen by name: a menu item (its key, label or
title) or a registered screen (`screen.list`'s `named`), on its target where it takes one (detail: a block id,
`((ref))` or `ep0ch://` URI; the board: a hub id). `ep0ch --screen <name> [<target>]` starts the door on it through the
same action (it is the one landing flag; `--board`, `--desk`, `--river`, `--brief` and `--welcome` are gone), and a
session attached with it opens it there. A screen someone registers is a valid name with no code change. An unknown
name is refused with the names there are.

Two reads need no door at all, only the outline: `ep0ch find <words>… [--lines|--json]` (the service's forgiving
ranker, as Goto, `/` and `((` rank; `--recent`, `--tree [<root id>]`) and `ep0ch show <id>… [--width <n>] [--ansi |
--cells | --source]` (each note drawn by the note surface, as a reader draws it, live figures and `::links` answered;
`--source`, its text as written). Both take `--ws` and `--machine`. `ep0ch find --query "<expression>"` (`--view
<id>`, `--under <id>`, `--ids`, `--json` for block records) lists what the outline says a query holds for, and `ep0ch
export` writes notes out as Markdown or JSON (PIE-534; the door README has the flags).

An MCP client reads the same outline with no door either: `ep0ch mcp` (stdio, for a local harness) and `ep0ch mcp
serve --http` (the remote gateway, for claude.ai, behind Clerk OAuth) answer `outline_read`, `outline_threads`, `outline_find`,
`outline_links` and `resources/read` of `ep0ch://` URIs from one implementation, each outline gated by
`ep0ch mcp access` (`none` by default). Both write where an outline's access is `propose` or
`full` (stdio as `mcp:<client>` from the MCP `initialize`'s client name, with `EP0CH_MCP_PERSONAS`; the same tools for the same grant) (`outline_create`, `outline_patch`, `outline_comment`, `outline_reply`, `outline_resolve_thread`, `outline_set_property`: the Claude mod's operations, as
`mcp:<client>`); the gateway writes to another machine's outline straight to that machine's own host when it answers over the shared ssh forward (`source: "live"` with the `machine`; `list_outlines` gives each such outline's `route` and when it was last checked), else queues them until that machine pulls them (PIE-615, PIE-661); `outline_write_status` follows a queued write, `outline_read` shows the caller's own queued edits as `pending`, and `outline_query` runs the views' grammar or a saved view (PIE-648). The door
README's "Remote MCP gateway" has the setup.

## The shell: screens and lists

On every screen, before the screen's own actions: `screen.open name=<menu key, label or title>`,
`screen.back`, `screen.list` (what the menu opens and the stack the person is on). On the BBS lists (a
message list, Join, Last callers, File areas): `list.read` (rows numbered from 1, the lit one; moves nothing),
`list.select n=`, `list.open [n=]`. The menu's letters, `⏎` and clicks, and `q`, `j k`, `⏎` and clicks on
a list, run the same actions. On the menu or a list, the control socket's `open <id>` opens the note in a
message reader over it.

`screen.shell` (drop to shell: the menu's `!`, the desk's `^W !`) is listed with them but is the person's
only: an agent's is refused, since the shell would take their terminal. While the person is in it, the door
keeps running under it (its tiles, its control socket): `peek` says `suspended: "shell"`, screen moves are
refused, and the shell's programs see `EP0CH_IN_DOOR=1`, `EP0CH_CONTROL` and an `EP0CH_NEST` ending in
`shell:<door pid>` (`ep0ch where` checks that layer).

These change what the person looks at, so an agent's is a visible, attributed move made only while they're idle:

- refused while the top screen holds their keys (an edit, a comment, the property panel, a terminal tile
  they're typing in, a filter or palette being typed, a choice open: each screen's `holdsKeys`, on the
  message reader, the desk and its views, the board, the river and the showcase), and within 2s of their last key or click (`SHELL_IDLE_MS`), so a key in flight never
  lands on a screen they didn't choose; the refusal says why, and the agent tries again later;
- said on the status bar ("an agent (<id>) · opened board stats · q goes back"); the screen is pushed over
  theirs, so `q` brings them back where they were; a screen that starts programs or keeps a layout (the
  desk, the board, the river, the brief, Waiting, the welcome, the showcase) is refused when it's already on
  the stack (`screen.back` gets there);
- never Goodbye: `screen.open name=G` is refused, and `screen.back` on the main menu is refused (the person's
  `Esc` there only says "nothing to close · G logs off"; their `q` there is the Quay, as it always was).

**Esc closes; it never leaves.** The person's `Esc` closes the innermost temporary thing, one per press: first what
holds their keys (a picker or menu: the tile menu `⋯`, a search, a layout or board picker; the keys box, `? more`; a
pending chord, `^W`; link mode, `alt+l`; a filter being typed; an edit, at once with nothing typed, with a second `Esc`
when unsaved, PIE-475), then the drawer when it's up and they're out of it (`host.toggle`), then what's lit in their tile
(a link, a selection), then the screen's own (a zoom, a dock, the keys back home, a float's keys back to the tile
under it).
With nothing left it does nothing and says so on the status bar: `nothing to close · q leaves` (the menu's says `G
logs off`). It never pops a screen and never logs off: leaving is `q` (`screen.back`), quitting `G` or `ctrl+c`. Each
step is an action an agent runs by name (`host.toggle open=false`, `tile.slide open=false`, `tile.zoom on=false`,
`tile.focus`, `element.select n=0`, `select.clear`, `edit.close`), so nothing here needs `Esc` sent as a key. In the
showcase, `Esc` in a section's stage with nothing left hands the keys back to the index (`section.leave`); in a screen
shown in a tile (the board on the desk), it goes on to the desk's own steps.

    ep0ch act screen.open name=J --as claude-7
    ep0ch act list.read --as claude-7
    ep0ch act list.open n=3 --as claude-7

### New notes and pages (PIE-544)

Also on every screen: `note.new` (the person's `ctrl+n`, the menu's `+`). The service makes the note where its
placement rule puts it (`notes.create`): an agent's goes under `near=<id>` when it names one, else to the top of
the Inbox (`inbox=true` says so outright); it is never placed by the person's reader. A `near=` that doesn't
resolve (gone, in the trash, a system note) is refused, nothing made, the refusal naming the `inbox=true` command;
only the person's own reader note falls back to the Inbox. It is written as the agent
(`author: agent` and its id), opens nothing, and is said on the status bar ("an agent (<id>) · made a new note
“…” in the Inbox"). The answer has the note's `id`, `parentId`, `rule` (`near` or `inbox`) and `said`. With
`opens=float` (or `tab`) it is also shown to the person there (PIE-591), in a tile of its own that never takes their
keys; the answer's `reader` names it. The person's own `ctrl+n` floats by default (`note.opens`, the screen spec's
`newNote`); `peek`'s `floats` mark those with `newNote: true` and `writing` while their edit is open. On the board's
lanes the person's `ctrl+n` is `card.new` (the lane's composer); an agent writes a card with `card.create`.

`page.create address=<name>` (a note action, in any reader) makes the page a `[[name]]` points at when nothing
does yet: `name [page::name]`, where new notes go, through the service's `pages.follow`; a page already there is
answered, not made again. An agent's opens nothing. Following a missing `[[page]]` (`link.follow`) never makes it,
for anyone: an agent's is refused, the refusal naming `page.create`, the person is offered it and makes it with a second ⏎ or click.

A first line of only `[page::x]` is titled `x` on the writes the service is given (`create`, `update`,
`notes.create`, `capture.create`, an `edit.text` save), so an agent's text gets the same title as the person's.

    ep0ch act note.new text="Ask about the seed swap" --as claude-7
    ep0ch act note.new near=<block id> text="[page::2026-09-30]" --as claude-7
    ep0ch act page.create address="Seed swap ledger" --as claude-7

With no door open, `ep0ch new "<text>" --as <id> [--near <id>] [--ws <name>] [--json]` makes the same call
(`notes.create`) from a shell.

### The drawer: the host layer (PIE-498, PIE-513)

Also on every screen but the logon: your drawer, the host layer's. Its tabs are tiles that belong to the App,
not to a screen, on a desk of their own: its first tab is its own program (`drawer.agent`: `EP0CH_DAILY_AGENT`, else a
shell), and any tile can join it and leave it whole, its own first tab too. A screen left with terminals still
running in it puts them in the drawer (`shell went into your drawer · alt+a shows it`) instead of refusing. It's pulled up from the status bar's chip (`▲ claude`,
`▲ shell +2`) over (or beside) whatever screen is shown, as that screen's policy says (`host`: `over`, `beside`,
`none`). `peek` gives its state as `drawer` (`open`, `entered`, `share`, `host`, `rect`, `state`, `openedBy`,
`herdr`, its own `terminal`, `runs` (its program, its folder and why), and `tiles`: each tab's `name`, `id`,
`kind`, `title`, `shown`, and a terminal's `pid`).

| Action | Args | Keys, mouse | Agent rules |
|---|---|---|---|
| `tile.drawer` | `tile`; `on` (true: into the drawer; false: out of it; left out, whichever it isn't); `to`, `where` (on=false: beside which tile of the screen shown, and where: left, right, up, down, tabs, edge-*) | `^W a` (on a screen: in; in the drawer: out); `^W A` on a screen (the drawer's tab shown comes here); drag a title onto the chip or the open drawer; `a` while dragging a tile; drag a drawer tab's title out onto the screen | the tile moves whole: a terminal's program keeps running (the same pid), a reader keeps its note, history and draft. An agent's tab goes in behind the one shown, the drawer and the person's keys stay as they were; never the tile the person types in or has; refused where the layout keeps the tile (locked, draggable off, a lane). The drawer's own tab (`drawer.agent`) leaves too, onto the screen as an ordinary terminal tile with its program still running, and the drawer starts a fresh own program the next time it's pulled up. `tile=` names a tile of the screen shown; a request naming a tile only the drawer has goes to the drawer (`tile.drawer on=false tile=kettle`, `tile.type tile=kettle`, a note action in a reader in the drawer) |

| Action | Args | Keys, mouse | Agent rules |
|---|---|---|---|
| `host.agent` | `name` (an agent installed here, or `shell`), `herdr` (run it in the session's own Herdr pane), `default` (for every outline, not only this session), `in` (the folder it starts in, saved with it) | the person's picker (offered on the drawer's first pull; the power bar names it), ⏎ in it | no name: an agent gets the list (`agents`, `now`, `from`), the person the picker. Saved for the outline's session; it starts inside the person's login shell from the drawer's own tab's next start, never in place of one running (`agent.restart` does that); `EP0CH_DAILY_AGENT` still overrides it. Said on screen |
| `host.shell` | | `alt+s` | a new shell (`$SHELL`, the drawer's folder) as a drawer tab: the person's is shown and takes their keys; an agent's opens behind the tab shown |
| `host.toggle` | `open` (true, false; left out, it toggles) | `alt+a`, a click on the chip; `Esc` (after `ctrl+]`) puts it away | pulling it up is a move of the person's screen: refused while they're typing (in the drawer too) and within 2s of their last key, as `screen.open` is; said on the status bar and in the drawer's title. Never enters it: their keys stay where they were. Refused to put it away while they're in it |
| `host.size` | `share` (0.2 to 0.9 of the rows above the status bar) | drag its top edge; `alt+A` steps 40, 50, 60, 75% | refused while they're in it |
| `agent.type` | `text` (`\n` ⏎, `\e` Esc) | the person types in the drawer | refused while the person types in it, and while it isn't running; said on the status bar. The agent is no screen's tile, so `tile.type` doesn't reach it |
| `agent.knows` | | the chip says it: `· door tools`, `· started before update ⟳`, `· no door tools ⟳` | read-only: the agent process's own environment and start time against the installed Claude mod (`current`, `stale`, `no-door`, `unknown`, with why) |
| `agent.restart` | | a click on the chip's `⟳`; `alt+R` | that agent's process alone is asked to exit (SIGTERM, SIGKILL after 8s) and the same command runs again, keeping the conversation (in Herdr: the session's own pane again). Refused while the person types in the drawer, or within 10s of their last key in the agent; said on the status bar |

Its own program is told `EP0CH_TILE_ID=drawer.agent` and `EP0CH_TILE=claude` (`shell` for a shell), and its nest
layer is `door:<pid>/drawer/drawer.agent:claude`. The Herdr launcher's `tile.herdr tile=drawer.agent` reaches the App on
any screen. `ep0ch where` names the drawer as the tile (`the drawer`), and says when the person is typing in it; a
terminal put in from a screen keeps the `EP0CH_TILE_ID` it started with, and `where` finds it in the drawer by its
program.

An agent can put its own tile in the drawer: `ep0ch where --json` names it (`door.tile.id`, found by its program's pid
even after it moved, so not the `EP0CH_TILE_ID` it started with), then `ep0ch act tile.drawer tile=<that id> --as <you>`
(refused, with why, while the person is typing in it: they put it in themselves with `ctrl+]` then `^W a`). A tile in
the drawer has an id `k<n>`, never a screen tile's `t<n>`. A preview that follows a tile (`source=tile:tree`) follows that very tile, by
its identity (ADR 0001), into the drawer and back. In the drawer a tile's keys work as on a screen, `^W P` (the policy
panel) too.

### The power bar (PIE-656)

The person's palette over every screen (`ctrl+k`): tiles on every screen and in the drawer (indented as each layout
tree), notes (the service's one search), actions (the focused tile's menu, then every action needing no argument),
what changed, screens, and an extension's bar sources (`extensions.bar`). An agent reads and picks with a bar of its
own; it never touches the person's.

| Action | Args | Keys, mouse | Agent rules |
|---|---|---|---|
| `bar.open` | `query`, `scope` (`tiles` `notes` `actions` `recent` `screens`, an extension's `ext.<id>.<source>`, or a prefix) | `ctrl+k`, `cmd+k`, a click on the status bar's `^K`; `/` and a river column's `g` (the notes scope) | an agent's answers the rows (`n`, `source`, `key`, `label`, `detail`, `depth`, `group`, `keycap`, `refused`) and the scopes, and opens nothing |
| `bar.pick` | `n`, `alt`; an agent's `query`, `scope` | `⏎`, a double click; `alt+⏎`, an alt- or ctrl-click | an agent's lists for itself and picks as itself, through the row's own path (`tile.focus`, `open`, the action, `extensions.act`, a copy returned): a tile on a screen not shown is refused, a note lands where an agent's opens land |
| `bar.close` | | `esc`, a click outside | the person's only |

`peek` has `bar` (scope, query, selected, rows) while the person's is open; the person is busy then, so an agent's move
of their screen waits.

### Program status: what waits on the person (PIE-614)

A terminal tile reads what its program reports with OSC 7501 (the Program Status Protocol: working, blocked with a
kind, done, error; outline-core's `program-status.ts`). `peek` gives each terminal's records as `status` (`id`,
`state`, `kind`, `progress`, `app`, `title`, `msg`), and the live feed carries them in its viewport. An agent running
in a tile can report its own the same way (the Claude mod does for Claude: `hooks/claude-status.ts`); the tile answers
the feature query (`OSC 7501 ; ?`) and its terminfo has `Pst`.

| Action | Args | Keys, mouse | Agent rules |
|---|---|---|---|
| `status.list` | | the status bar's count, the waiting-on-you tab | read-only: every blocked, failed and unseen done record across the screen's terminals and the drawer's, most urgent first, each with `n`, `tile`, `name` and since when |
| `agents.list` | | the agent panel (`alt+g`) | read-only: every agent session the door holds (PIE-737): `id` (`<program>:<folder>`), `program`, `folder`, `persona`, `config`, `how` (started, found running in a terminal tile, the drawer's own), `state` (working, waiting, idle, done, failed) and where it's `shown` (your drawer, a screen and tile). `peek` gives the same under `drawer.sessions` |
| `agents.open` | | `alt+g` | the agent panel as a tab in the drawer: the person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown |
| `agent.start` | `program` (an agent config in the outline, `[agent-config::<name>]`, or an agent installed here), `in` (the folder), `persona`, `args`, `fresh` | `n` in the panel; `ep0ch agent [--program] [--in] [--persona] [--new]` from any folder | starts a session as a tab in the drawer, continuing the program's last conversation in that folder, or attaches the one of that program running in that folder. An agent's (and `ep0ch agent`'s) starts it behind the tab shown and never moves the person's keys; attaching moves nothing of theirs. Said on screen |
| `agents.new` | `program`, `in` | `n` in the panel | the person's picks the program, then the folder; an agent's is `agent.start` |
| `agents.go` | `session` (id, `program:folder`, a tile, or n from 1) | ⏎ or a click on a row | the person's only: going takes their keys |
| `agents.drawer` | `session` | `a` on a row | pulls it into the drawer from the screen it's on: the same process; an agent's adds it behind the tab shown. Said on screen |
| `agents.dock` | `session` | `d` on a row | docks it on the screen shown, from the drawer or another screen: the same process. Refused while it has the person's keys. Said on screen |
| `host.waiting` | | `alt+w`, a click on the status bar's `◆1 ✓2 on you` | the waiting-on-you list as a tab in the drawer: the person's pulls the drawer up and goes to it; an agent's opens it behind the tab shown |
| `changes.open` | | `alt+o`, a click on the status bar's `+N new` | the what-changed list as a tab in the drawer: the person's pulls the drawer up, goes to it and marks what it holds seen; an agent's opens it behind the tab shown and marks nothing |
| `changes.list` | | the status bar's `+N new`, the what-changed tab | read-only: each note others changed since the person looked (id, title, who, kind, when, seen), newest first; never marks anything seen |
| `changes.pick` | `n` or `id` | `j` `k`, the wheel, a click, in the list | refused while the person is typing there |
| `changes.go` | `n` or `id`, `fresh` | `⏎`, a double click; `alt+⏎`, an alt-click | opens the row's note where opens land (in the drawer: on the screen shown, as its details open); an agent's never takes the person's focus |
| `changes.diff` | `n` or `id` | `d` | the change under a row (the note's earlier text against the new); an agent's returns the lines and leaves the person's rows alone |
| `changes.seen` | | `x` | the person's only: marks the list seen and keeps the position |
| `status.pick` | `n` or `tile` | `j` `k`, the wheel, in the list | refused while the person is typing there |
| `status.go` | `n` or `tile` | `⏎`, a click on a row | the person's only: it takes their keys to that terminal (an agent answers a program with `tile.type`) |
| `status.seen` | `n` or `tile` | `x` | the person's only: seen is theirs, so an agent never clears a done they haven't seen (nor does `peek` or `subscribe`). Its done and failed records go; blocked ones stay until the program says otherwise |

## What an agent may do to each tile (PIE-639)

The person sets, tile by tile, what an agent may do. Three levels, one word each:

| Level | An agent may | It may not |
|---|---|---|
| `free` (the default) | open notes in the tile, navigate it, split it, close it, retarget it | |
| `edit` (`✎ agents: edit only`) | edit the note the tile shows: patch, comment, set properties (the `draft` actions), read it, mark it | navigate the tile to another note, close it, retarget it (`tile.link`), move, swap, float, dock, fold or zoom it, put another tile into its tabs, or have its opens land in it; its own new tiles go elsewhere |
| `off` (`⊘ agents: hands off`) | read the tile through `peek` and the read actions | take any action on it or its note |

A screen has a default (`layout.policy node=screen agents=edit`; a container has one too, `node=s2 agents=off`) and a
tile has its own, which wins: "yolo the screen, except this one thing" is the screen `free` and one tile `edit`.
`tile.agent policy=edit tile=detail2` sets a tile's own (`inherit` takes it away, so its container's and the screen's say
again). By key `^W g` cycles the focused tile (free, edit, off); by mouse a click on the chip on the tile's frame does the
same, and the tile's `⋯` menu has the row ("what agents may do here"); the screen's default is a row in `^W P`. It is
saved with the layout (a tile's `agents` in its saved spec, the default in the screen's policy).

Read the limits before acting:

- `peek`: each tile's `agents` and `agentsBy` (`tile`, `screen` or a container's id) when it is limited, `agentLimits` and
  `agentsDefault` at the top;
- `layout.get`: the screen's `policy.agents`, and `agents` on each limited tile; `view.get` and `view.subscribe` carry the same;
- `ep0ch where`: `door.agents` (the default and each limited tile) and `door.tile.agents` for the tile you run in, and a
  line `agents may: …` in its text.

It is enforced for agents only, in the places that already hold the person's rules: the layout module (every shape
operation that would move, close, swap, float, dock, fold, zoom, retarget or tab-into a limited tile, and a layout load
over a screen that has one) and the dispatcher's actor rule (any action that runs in a limited tile: `edit` lets the
`draft` and `nothing` touches through, `off` only the safe reads). An open that names no tile skips limited tiles:
the current note changes, but a limited reader keeps its note, and an open into a container picks or makes another tile.
A refusal names the policy and the person's command:

```
detail2 is edit only for agents: open is refused · patching, commenting and setting properties on its note are allowed; its own new tiles go elsewhere · the person's command: ^W g, its ⋯ menu or a click on its chip, or tile.agent policy=free tile=detail2
```

A container operation checks every tile it reaches: sliding a dock shut hides the tiles in it, switching tabs hides the
one shown, docking a split takes all its tiles; evening out the layout or resizing a border moves a `off` tile's edges
(an `edit` tile may be resized). An agent cannot loosen or clear a default either: `layout.policy agents=free` on a screen
or container that limits its tiles is refused with the same command. `tile.agent` is the one action whose own rule decides
(`ownGate`): the layout module lets an agent tighten a limited tile and refuses it loosening one.

The person's own keys, clicks and actions are never limited. The lock (`alt+k`) is a different rule: it fixes the screen's
shape for everyone, the person included, and leaves contents live; an agent policy limits only agents, tile by tile, and
leaves the shape alone for the person. They combine: a locked screen with an `edit` tile refuses an agent twice, and the
person's own changes to the shape only by the lock. The limit is the door's: an agent that writes the note through the
outline service (not a door action) is not held by it.

## Naming tiles and splits (PIE-491)

Two actors (the person and an agent, or two agents) change the layout at once, so a name must mean the same
thing after someone else's change.

- **Ids.** Every split (`s4`), tab set (`g2`) and tile (`t7`) has an id, in `layout.get` and the feed. It
  stays with its split, tab set or tile through moves, tabs, resizes and saves (`desk.json` and
  screen notes keep them, so a restarted door gives the same ones), and is never given to another:
  `desk.json` keeps the next ids too, and a tile made by loading a screen note's layout gets its saved
  id only if no tile had it before in this door. A split
  that's gone (its tiles moved or closed) is refused by id, never swapped for another.
- **Names.** A tile's name starts with a letter, then letters, digits, `.`, `-` or `_`, at most 40 (`middle`,
  `claude`, `reader2`), and isn't shaped like an id (`t`, `s` or `g`, then digits). So a name is never a number,
  never an id, and never holds the `:` of a `tile:<name>` source. `tile.open name=1` and `name=s2` are refused.
  (Ids have no sigil because the CLI reads a value starting with `@` from a file.) A layout saved before this
  rule with a tile named `2` (or `t2`, or any name the rule refuses, such as one with a space) loads with that
  tile renamed to its kind (`detail`, or `detail2` when taken), and its links, sources and focus follow. A
  `desk.json` saved from the `daily` layout before ids gets the
  links that layout has gained since (the now tile's, to `middle`), on tiles that have none. The old daily agent
  tile is left out: the agent is the host layer's.
- **Numbers.** `#3` (or `3`) is the tile numbered 3 on screen, where it is now.
- **`tile=<tile>`** (`parseActArgs` and the control socket read it) takes a
  name, an id, a number, an alias (a place: the board's `detail`, `float`, `lanes`),
  `focused`, or a block id (the tile showing that note: the agent's own draft of it first, then one on screen
  holding an edit, one on screen, one off screen holding an edit, then a list selecting it; the focused tile
  wins a tie). One grammar on every screen, read once by the screen's dispatcher (PIE-514): the desk, the board,
  the river, the brief, the welcome, the showcase and the message reader all name their tiles through it, and an
  action's tile-valued argument (`layout.move to=`, `tile.link to=`) takes the same words. Answers name the tile
  by its name, not its place.
- **The revision.** `layout.get` gives `rev`, a number that changes whenever the tree's shape does: a split,
  tab set or tile added, taken away or moved. A resize or showing another tab doesn't change it. It only goes
  up, and never repeats across a restart (it starts from the clock, or from the one `desk.json` saved), so an
  agent that outlives the door (the Herdr agent) is refused, not misled, after one. Any desk
  action takes `expected=<rev>`; if the layout changed since, it's refused and nothing is done ("the layout
  changed since revision 7 …"). Pass it whenever you name something by place: a `path`, or a `#number`.
- **Screens are specs on the desk** (PIE-515): every tile has a name and every desk command works on each. The
  welcome's tiles are `welcome` (the list), `detail`, `backlinks` and `preview`; the brief is one tile, `brief`;
  Waiting is `waiting` beside `reader`; a pinned page is `pinned`. A screen's own actions are its tiles' kind's
  (`welcome.select`, `brief.step`, `waiting.pick`, `waiting.reload`): `act` finds the one tile of that kind, and the answer names
  it (`tile: "welcome"`). `peek`'s `kind` is the screen's name.
- **The board is a screen spec on the desk** (PIE-511, PIE-515): every tile has a name and every desk command works there.
  Its readers are `preview`, `detail1`, `detail2`…: a detail keeps its name while it lives, whatever closes
  around it, so after `detail1` closes the other is still `detail2`, and floated (`tile.float`, `o`) it keeps it
  too. Its lanes are query tiles named by their lane (`Queued`, `Waiting-on`), in a columns container
  (`layout.get` says `columns: hub:<id>`) filled from the hub's views. The outline dock holds `tree` over
  `tree-preview`, the backlinks dock `backlinks` beside `backlinks-preview`. Places work too:
  `tile=detail` (the one ⏎ opens into), `tile=float` (the top float), `tile=lanes` (the lane the cursor
  is in), and for a note action `tile=tree` and `tile=backlinks` are the docks' previews. The outline dock is
  `tile.slide` and `tile.dock` on `tile=tree` (the older `outline` action is gone); `backlinks` is the backlinks
  tile's own action. `peek` on the board is the desk's peek: `focus` (`lanes`, or the tile), `details`, `floats`,
  `readers`, `collapsedReaders`, the lanes' model (`hub`, `lanes`, `composer`, `steps`, `mover`, …), `outline` (the
  outline dock: `open`, `pinned`, `side`, `rows`) and `backlinks`; `tree` is the layout, by tile name.
- **The river is a screen spec on the desk** (PIE-515): its columns are `river.column` tiles in a flow, named as
  any tile (`library`, then `column`, `column2`…; the older `r7`, `3` and `3.2` are gone). `open id= from=<column>`
  opens a note in the column after it (`fresh=true`: a new one even when a column has the note); an `open` naming
  no tile lands after the column with the person's keys. Its own actions are the column kind's (`column.select`,
  `column.replies`, `column.scroll`, `column.filter`, `column.tag`, `column.split`, `column.copy`; `replies`,
  `filter`, `tag`, `split`, `copy` still answer); the layout's are the desk's (`tile.widen`, alias `widen`;
  `tile.hold` (`p`: held full; before PIE-498 it was `tile.dock`, which now docks a tile to an edge); `tile.close`; `tile.travel dir=back|forward`, the person's). The old `jump` is `search`
  then `open`.

    ep0ch act layout.get                                  # rev 12; the right column is split s5
    ep0ch act layout.resize split=s5 border=0 share=0.3   # the same split, whatever moved since
    ep0ch act layout.resize path=2 border=0 share=0.3 expected=12   # refused if the layout changed

## What an action touches (PIE-514)

Every action says what it touches, and the dispatcher checks it once, the same way for a key, a click and `act`.
`ep0ch actions` prints it under each action (`touches tile · replay safe`).

| Touches | An agent's is refused when | Examples |
|---|---|---|
| `nothing` | never (it reads, or answers, or acts out of the person's sight) | `layout.get`, `view.get`, `open` naming no tile, `block.mark`, `search` |
| `tile` | the tile it runs in has the person's keys; or, for an action that says `while: typing`, only while they type in it | `view.scrollTo` (typing), `link.select`, `link.follow`, `element.open`, `up`, `back`, `props.follow`, `threads`, `resolve`, `open tile=<reader>`, a river column's `column.select` and `column.scroll`, `tile.restart` (typing) |
| `shape` | the layout engine says so (`ctx.person` from the same query): never the tile they type in (moved, floated, docked, or resized: a border, a split's shares, a grow or `layout.even` that would change its size), never their tab hidden, never their focus floated or closed; a change that would move their keys (shutting the dock they're in, loading a layout) waits as a `screen` touch does. The river's columns are a flow on it (PIE-515): `tile.widen`, `tile.hold` and `column.split` never move their keys | `layout.move`, `tile.open`, `tile.close`, `tile.dock`, `tile.float`, `tile.slide` |
| `draft` | the draft session's rule (`draftRule` in `src/draft-session.ts`): not a draft the person opened or typed in, not a note they have open in a draft. `edit.text` (`draft: replace`) and `comment.write` (`draft: text`) replace only an edit or comment the agent opened, and never while the person types in that tile; `complete insert=` (`draft: type`) puts a candidate in only at the cursor of a draft the agent opened and alone typed in. An invitation (the person's `@name` line) is the one way into theirs | `edit.text`, `comment.write`, `complete insert=`, `edit.save`, `comment.send`, `task.status` |
| `screen` | the person is away (not logged on, or in the door's shell or editor), busy (typing anywhere), or touched a key or the mouse within the last 2s (`SHELL_IDLE_MS`) | `screen.open`, `tile.focus`, `marks.next`, `brief.step`, `board.hub id=`, `host.toggle open=true` |

An action may say its touches depend on its arguments, or on whether the request named a tile (`board.hub` with
`id=` touches the screen, without it nothing; the desk's `open` with `tile=<reader>` touches that tile). An agent
never names the reader with the person's keys: `open tile=…` there is refused, its way named. An open naming no tile lands where opens land (the tile's link, the readers row, a reader that follows), which can be the note the person is reading: said on screen, never their keys, never a reader they're typing in.
A place word (`tile=detail`, `new-detail`, `float` on the board) is a place, not a reader: it is where opens land too,
and behaves as an open naming no tile. An action that is the person's own (`tile.enter`, `select.mode`, `screen.shell`) is refused to every
agent with the way an agent does it instead. Each action also says whether replaying it is `safe` (the same
answer again, nothing written twice) or `ask` (it writes, starts something, opens something outside the door, or
is kept for the next start: `link.follow`, `props.follow`, `tree.pick`, `theme.set`, `theme.cycle`): for PIE-418's replay.

Where the person is comes from one query, `App.person()`: the screen shown, which tile has their focus, which
tile they're typing in (a desk tile, a board's composer, a river column, or `drawer.agent` for the drawer),
whether they're busy, how long since their last key, and whether they're away. A screen inside a tile (a board
on a desk) is asked the same thing as seen from inside it.

An agent's action carries its actor all the way through: an open it causes, a reader it fills, a write it makes
are all attributed to that agent (its id), never to an unnamed one.

## Commands

The desk's commands, by what they change. `tile=<tile>` names a tile as above (written `tile` in the Args column).
A name in brackets is an alias: the same action (one def), listed once with it by `actions`. Each is also a key or a mouse
gesture; see the README's desk section and `docs/UI-GRAMMAR.md` §7.

| Command | Args | Agent rules |
|---|---|---|
| `layout.load`, `screen.save` | `name` | load is refused while the person is typing; running programs are never ended. `screen.save` writes a screen note (PIE-565), as the agent |
| `screen.delete` | `name` | a screen a person made: its note to the Trash; a built-in is refused |
| `blank.fill`, `blank.screens` | `kind` (tree, reader, detail, pty, query), `view`, `cmd` | the blank tile's rows; an agent may fill it under the person's keys (it only holds a place), never where they're typing |
| `layout.move` | `tile`, `to`, `where` (left, right, up, down, tabs, edge-*), `index` | never the tile the person is typing in; their tab stays shown |
| `layout.resize` | `split` (its id from `layout.get`) or `path` (with `expected`), `border`, `share`; answers the split's `id`, `path` and `tiles` | a dragged border runs this, by the split's id. An agent's never resizes the tile the person is typing in |
| `layout.even`, `layout.swap` | `to` | an agent's even-out is refused when it would resize the tile the person is typing in; a swap never moves it |
| `tile.open` | `kind` (`reader`; `detail` reads as a reader with `mode=held`, or `pinned` with `page=`), `mode` (`held`, `pinned`), `page`, `name`, `cmd`, `file`, `source`, `note`, `cwd`, `view` (a `query` tile: a saved view's block id), `to`, `where` | focus stays where it is; a new tab isn't shown over the person's |
| `tile.close` | `tile` | never the person's tile, never a running program |
| `tile.focus` | `tile`, `dir` (left, right, up, down: the tile that way; in a flow, the column before or after) | refused while the person is typing, and within 2s of their last key |
| `tile.link` | `tile`, `to`, `role` (`preview` follows the source's selection; `target` takes only opens) | |
| `tile.dock` | `tile`, `on` (true: docked to an edge, in a dock that stays on this screen; false: undocked, back in the layout; a float goes straight into a dock, one step), `edge` (left, right, up, down: the dock slides from that outer edge), `container` (a split's id: it goes in whole) | an agent's new dock starts shut, unless it holds the person's keys (their tile, or the tab set it's in) |
| `tile.collapse` | `tile`, `on` (default toggles), `dir` (`v` a vertical spine, `h` a horizontal one: one row; default the way its split runs) | folds a tile in a row or column of others to a spine, keeping what it holds and its size for when it opens; a tab set folds as one; never the tile that has the person's keys |
| `tile.expand` | `tile` | opens a spine at the size the tile had (`tile.collapse on=false`) |
| `tile.widen` | `tile` | gives the tile's flow column the wide place (a flow is the river's columns as a container); the person's keys stay where they are; said on screen. Refused outside a flow and where the flow is locked |
| `tile.hold` | `tile`, `on` (default toggles) | holds the tile's flow column full so it resists compression (the river's `p`), or lets it go; said on screen. Refused outside a flow and where the flow is locked |
| `reader.mode` | `tile`, `mode` (`follows`, `held`, `pinned`; left out, the toggle of follows and held), `page` (pinned: the page's name; left out, the shown note's own page) | sets how any reader shows notes: follows the current note, is held on the note it shows, or is pinned to a page (shown again each time it starts); said on screen. A former `detail` is a held reader and takes it too. Refused while the reader holds an edit, and where there is no page to pin to (the answer names the command) |
| `tile.travel` | `tile`, `dir` (back, the default, or forward) | the person's keys go back to the column this one was opened from, or forward again (the river's alt+← backspace alt+b, alt+→ alt+f). The person's: an agent's is refused, its way named (open beside) |
| `tile.float`, `float.place` | `tile`; `dx` `dy` `col` `row` `cols` `rows` | a tile out of the tree as a float over everything, its own rectangle (kept on screen), or put back in the layout; never the person's tile |
| `query.pick`, `query.reload` | `tile` (a query tile), `n`, `id` or `by`, `open` | on the desk: an agent's pick is its own (the person's cursor stays); `open=true` opens the card where the tile's opens go. On the board the lanes' own `card.select` moves cursors |
| `tile.slide` | `tile`, `open`, `container` (a dock's id: an outer one holding another) | see below |
| `layout.lock` | `on` (default toggles) | said on screen; locking never moves the person's focus. While locked, every action that changes the shape is refused with the reason, for agents and the person alike. Three opens fall back instead and say so: `alt+⏎` (a reader beside) opens in place, `ctrl+e` runs the editor over the whole door, and a screen's reader beside (the brief's) isn't added |
| `tile.agent` | `tile`, `policy` (`free`, `edit`, `off`, `inherit`; left out, the next level) | what an agent may do to the tile (PIE-639, see below). The person sets any level; an agent only tightens (free to edit, edit to off), never loosens one: its refusal names the person's command. Saved with the layout; `layout.policy node=screen agents=edit` is the screen's default |
| `layout.policy` | `node` (`s<n>`, `g<n>`, `d<n>`, `c<n>` columns, `screen`; default the innermost container over `tile`), `draggable`, `droppable`, `closable` (off: its tiles stay; `tile.close` is refused with the reason), `accepts` (kinds, comma-separated; `any` clears), `resizable`, `min`, `max`, `fixed` (cells; -1 clears), `collapsible`, `overlay`, `stays` (an open dock stays open when the keys leave it), `locked`, `opensInto` (a tile that takes notes; empty clears), `clear` (fields, comma-separated) | said on screen; on a locked container only `locked` changes. An agent's `opensInto` changes where the person's opens land: it is attributed like any other change, and the tile's `link` in `layout.get` says `linkFrom: opensInto`. Refusals name the container and the field: `d4 takes only tree, pty: not side (detail)`, `now stays where it is: d4 keeps its tiles (draggable off)` |
| `tile.preview` | `tile`, `where` (right, down, left, up; default beside a wide tile, else below) | a reader beside the tile where its opens land, opened and linked as one layout step (a reader's is a detail; a terminal's follows its file; anything else's follows its selection), so `link.follow` there lands in it and the tile keeps its note. Its opens already landing in a tile: that one is shown (a fold opened, its dock slid open, its tab shown unless that hides the person's), `existing: true`; an agent's never takes the person's keys, the person's goes to it. Said on screen |
| `tile.type`, `tile.restart` (both `touches: tile`, `while: typing`) | `tile` (default: the focused terminal, or the only one; with several and none focused, refused until one is named), `text` | never into the terminal the person is in (the desk's `claude` tile included while they type in it in the drawer) |
| `tab.select` | `tile`, `by` | never hides the person's tab |
| `open` | `id`, `reader`, or `from=<tile>` | shows the note in that tile, or with `from`, where that tile's opens land (its link; unlinked, where an agent's open naming neither puts it: where the focused tile's opens land, never a reader the person types in). The board takes `from` too (unlinked, its detail). A program in a tile passes `from=$EP0CH_TILE` and never names a reader. `ep0ch open <id>` is this action. The person's own open gives the tile the keys, an agent's never does. On the welcome and the brief (desks) an agent's lands their own way (the welcome's preview, the brief's step). A screen with no `open` of its own (the menu, a list, a message reader) has the shell's: a message reader opens over it once the person is idle, as for any screen change |
| `tile.herdr` | `tile`, `pane` (the Herdr pane's label), `on=false` | the terminal tile shows an agent that lives in Herdr: quitting the door ends only the attach. `scripts/door-agent-herdr.ts` calls it as it attaches; cleared when the program exits. Setting it is refused on the terminal the person is typing in (quitting would no longer warn that it ends its program); `on=false` is anyone's |
| `view.scrollTo` | `tile`, `line` or `text`, `block` | scrolls a reader's view; never the person's [ ] position, selection or keys, and never their edit |
| `block.mark` | `id` (default: the note `tile` shows), or `line` for an nvim tile; `reason` | framed and labelled in every tile showing it, or an nvim extmark |
| `block.unmark` | `n`, or `id`, or neither (the focused tile's) | |
| `marks.next` | | refused while the person is typing, and within 2s of their last key |
| `tile.resize`, `tile.zoom` | `tile`; `by`, `axis`; `on` | resize by steps; an agent zooms only the person's tile, never one that hides it |
| `pane.split` | `tile`, `kind`, `dir` (row, col) | `tile.open` along the longer side, with its own arguments; focus stays |
| `tree.links` | `tile` (an outline tree; on the board, its outline dock, refused while shut), `n` (a row as `peek`'s `tree.rows` numbers it) or `id`, `show` | shows or hides a row's outlinks, resources and backlinks under it, as the outliner's Tree does (`blocks.authored-links`, `references.backlinks`); registers nothing; the person's selection stays on its row, and hiding the rows it is in is refused |
| `tree.pick` | `tile`, `n` or `id`, `open` | an agent's pick shows the row's note where the tree's selection goes; `open=true` opens it where the tree's opens go (a group folds; a ticket the Jira extension keeps as a block opens that block; another resource is registered if it must be, fetched once if nothing is stored, and shown, attributed to the agent). Never the person's selection or keys |
| `projection.refresh` | `tile`, `block` (a page or a ticket block; default the reader's), `line` | fetches the tickets it shows now and runs its extensions' lines (`resources.projection.refresh`): with `line`, only that line (an output or component runs again, an `@name` request is asked again); without it, every line and every `@name` request not answered yet. The service writes as the extension (`ext:jira`, `ext:moon`), never as the agent or the person, and records who ran it as who asked (`asked by an agent (<id>)` on the line); said on the status bar |
| `ext.<extension>.<action>` | `block` (the note with the handler line, or the block it acts on), `line` (when the note has several of that handler's lines) | an extension's action, named as `extensions.list` names it (`ext.fancy-horror.ward`, `ext.<id>.keep`): the service runs it (`extensions.act`) and what it writes is attributed `ext:<id>`; the status bar says `an agent (<id>) · Fancy Horror: …`. On every screen. A tile kind's actions (`ext.tarot.draw`, `ext.tarot.keep`) take `tile=<the tile>`; `block` defaults to the tile's own; a block action a tile lists (`ext.tarot.keep`) runs on any screen with `block=` too. Who asked goes with it, recorded as the change feed's `requestedBy`. Bound and unbound as the service's extensions change |
| `links` | `tile` (a reader) | `b`: the reader's note's outlinks, resources and backlinks (one links model, `src/links.ts`) in the screen's links tile, opening one below the reader where the screen has none. An agent's aims or opens it and leaves the person's keys where they are; a screen with no room refuses and names `::links` |
| `column.links`, `column.link` | `tile` (a river column); `on`; `n` (a links row, from 1), `fresh` | a river column's links under its replies, and opening one in the next column; `column.links` is refused on the column the person has the keys in, with the agent's way named |
| `card.reorder` | `card` (default the selected one), `lane`; `by`, `to`, `before` or `after` | the board's hand-set order of a view (alt+↑ alt+↓, a drag within the lane): one service step (`virtual.occurrences.move`), recorded as who asked; an agent's never moves the person's cursor. A view with a `[sort::]` refuses and names it |
| `images`, `image.size`, `image.align`, `image.hero`, `image.fit`, `image.undo` | `n` (the image, from `images`) or `line`; `to`, `by`, `height` | a reader's images (PIE-532): `images` lists them with their layout; the others are one save of that image's line, recorded as who asked (an agent's refused while the person has the note open in a draft); `image.undo` takes back the asker's own last |
| `reader.overscroll` | `rows=half\|none\|<n>` | how far readers and drafts scroll past their last line (PIE-622): `half` (the default) to the middle, `none` to the bottom edge, or that many rows; End, `G` and `scroll to=end` stop on the edge first and go on past it the second time; kept for the next start |
| `reader.hero` | `on=true\|false`, `mode=first\|follow` | whether readers' sticky headers take the note's hero image as a dimmed background as it scrolls under (PIE-598), or each picture in turn (`follow`, fading one into the next), every reader at once, kept for the next start; a reader's `describe` says what its header draws (`header.backdrop`: the image, its step, the mode, kitty or cells, and `over`, the picture it's fading in over) |
| `home.pick`, `home.open`, `home.new`, `home.import`, `home.connect`, `home.add`, `home.forget`, `home.reload`, `home.cancel` | `n`; `outline`, `machine`, `write`; `name`; `path` | the home base (bare `ep0ch` where nothing names an outline). An agent's `home.open` writes the folder's `.ep0ch` only with `write=true`; what the person's would ask for (a name, a file, a machine) an agent passes as arguments |
| the note actions | `edit.*`, `comment.*`, `link.follow`, `block.tint` (PIE-423's focus mark), `select*`, … | in the reader named; an agent's edit or comment is never the person's until they enter it |

Example: bring the person's attention to a decision, from an agent running in a tile.

    ep0ch act open id=<block> from=$EP0CH_TILE --as claude-7         # answers reader=middle (the tile's link)
    ep0ch act view.scrollTo text="needs a decision" tile=middle --as claude-7
    ep0ch act block.mark reason="needs your call" tile=middle --as claude-7

## nvim tiles

A terminal tile running `nvim` listens on a socket:
- It's in the door's state (`nvim/<tile>-<pid>-<id>.sock`), or a short folder under the temp directory when
  that path would be too long for a socket.
- `layout.get`, `tile.info` and the feed's `layout.changed` name it (`nvim.socket`).
- The door connects too: nvim reports its cursor, window and buffer (autocmds that `rpcnotify` the door). That
  is how nvim's cursor is in `cursor` events, and how a preview of the tile follows the buffer's file.

An agent uses nvim's own RPC on that socket (msgpack-rpc; `nvim --server <socket> --remote-expr …` works too):
- read the person's cursor and view: `nvim_win_get_cursor(0)`, `line('w0')`, `line('w$')`;
- edit other lines without moving their cursor: `nvim_buf_set_lines(0, start, end, false, lines)`, then
  `:write` if it should reach the file;
- a mark on a line: `ep0ch act block.mark line=<n> reason=… tile=<tile>` sets an extmark with virtual
  text (namespace `ep0ch_marks`), and `block.unmark n=<n>` takes it away.

## Agent paths that could touch the person's keys

Every action an agent can call that moves focus, shows or hides a tile, or changes what the person is looking
at, and what it does while they're typing:

| Action | Moves the person's focus? | While they're typing |
|---|---|---|
| `tile.focus`, `focus` (the same action) | yes, that's what it's for | refused, and within 2s of their last key |
| `marks.next` | to a tile showing the mark | refused, and within 2s of their last key |
| `brief.step`, `tile.focus` on the river | yes: another step, another column | refused, and within 2s of their last key |
| `link.select` in the reader that has the person's keys | it would move their selection | refused: `link.follow n=` or `tile=` another reader |
| `layout.load` | rebuilds the desk | refused, and within 2s of their last key |
| `tile.slide open=false` on the dock that has the keys | the keys go to another tile | refused, and within 2s of their last key |
| `tile.slide open=true` | no (the person's own opens it and gives it the keys) | allowed |
| `screen.open`, `screen.back`, `list.select`, `list.open`, `open <id>` on the menu or a list | yes: another screen, or a list's lit row; said on the status bar, and `q` comes back | refused, and within 2s of their last key |
| `host.toggle open=true` | no: your drawer comes up over (or beside) the screen, refused on a screen whose `host` is `none`; the keys stay where they were | refused, and within 2s of their last key |
| `host.toggle open=false`, `host.size` | no | refused while they're typing in the drawer |
| `agent.restart` | no: the agent comes back where it was | refused while they're typing in the drawer, and within 10s of their last key in the agent |
| `note.new`, `page.create` | no: an agent's makes the note or page and opens nothing; its placement never reads the person's reader | allowed |
| `open`, the control socket's `open <id>` | no: shown in a tile (the focused tile's link, a following reader, a free detail) | allowed |
| `open tile=<reader>`, `link.follow`, `element.open`, `props.follow`, `up`, `threads`, `resolve` in the reader that has the person's keys (on the board, the preview they read the lanes through too) | it would move what they're reading | refused, the way named: another reader (`tile=`), or `open id=` naming none (an open naming no tile lands where opens land (the tile's link, the readers row, a reader that follows), which can be the note the person is reading: said on screen, never their keys, never a reader they're typing in). Elsewhere allowed; an agent's `link.follow n=` never moves the person's `[ ]` position |
| `link.follow`, `element.open` on a web link or a figure | no: an agent never opens the person's browser or system viewer | allowed: the answer gives the address (`outside: browser\|viewer`, `url`, `launched: false`) and the reader says the agent was given it |
| `tile.open`, `pane.split` (the same code), `tile.preview` | no; a new tab isn't shown over the person's; `tile.preview` finding its preview shows it without the keys | allowed |
| `layout.move`, `layout.swap` | no; never the tile they're typing in; their tile moved into a shut dock opens it | the typing tile refused |
| `tile.dock` | no; a dock around their tile (or its tab set) starts open | allowed |
| `tile.close` | never the focused tile, never a running program | refused for those |
| `tab.select` | never hides the person's tab | refused for that |
| `tile.zoom` | only the focused tile, never one that hides it | refused otherwise |
| `tile.type` | no | refused for the terminal they're in |
| `view.scrollTo` | no: a reader's view only (not its `[ ]` position or selection) | refused on their edit |
| `block.mark`, `block.unmark`, `block.tint` | no | allowed |
| `tree.links`, `tree.pick` | no: the tree's selection stays on the person's row (folding away the rows it is in is refused); an open lands where the tree's opens go | allowed |
| `projection.refresh` | no | allowed |
| `ext.*` | no | allowed: the service runs it, attributed to the extension |
| `changes.extensions` | what "what changed" shows is the person's | refused: an agent reads changes itself (`changes.since`, `activity.recent` with `extensions`) |
| `tile.herdr` | no | allowed |
| `scroll`, `back`, `forward` (a reader's own) | no | refused on a reader that has the person's keys (a host that doesn't say otherwise); elsewhere a scroll never lets go of their `[ ]` position. `view.scrollTo` is the agent's |
| the river's `column.select` (by row or `id=`), `column.scroll`, `column.filter` | no | refused on the column the person has the keys in (its cursor is theirs, `id=` too), with the agent's way named (another column, `search`, `open from=`, `column.tag`); said on the status bar elsewhere |
| the board's `card.select` | no: an agent's selection is its own | allowed |
| a board reader named by an agent (`tile=detail`, `tile=float`, a block id) | no: the person's keys stay on the lanes or where they were | allowed |
| `board.hub id=` | yes: the board shown | refused while the person holds the keys; said on the status bar |
| `search`, `board.hub` (no id), `who.refresh`, `activity.pick` | no: they answer, they don't open | allowed |
| `tile.enter`, `tile.leave`, `host.enter`, `host.leave`, `select.mode`, `callouts`, `fold.select`, `element.select`, `section.try`, `backlinks.fold`, `card.trash` without `confirm` | they are the person's keys | refused: each names the agent's way |
| note actions (`edit.*`, `comment.*`, `link.follow`, …) | no; an edit or comment an agent opens is the person's only when they enter it | allowed |
| an agent's `edit`, `edit.text`, `props.edit`, `task.status` or `task.undo` on a note the person has open in a draft in this door (in another reader) | no | refused (the draft session's agent rule, `agentRefusal` in `src/draft-session.ts`): a write underneath would make their save stale. It patches their draft instead (`draft.patch`), or waits until it's saved or closed. `edit.text` in the very reader the person is editing in is refused (round 3): the draft is theirs whether or not they're typing, and while they type in a reader an agent's `edit.text` there is refused even in an edit the agent opened. It patches their draft (`draft.patch`), comments on the note, or marks it (`block.mark`). In an edit the agent opened and the person typed in but isn't typing in now, it replaces the text, copying theirs out first. The rule knows this door's drafts; another door's are covered by the service's hold |
| the board's `card.move`, `step.set`, `card.trash` on a card open in a draft | no | refused for anyone until it's saved or closed (`openDraftOf`) |
| an agent's `draft.*` (`draft.copy` answers the draft's text; only the person's copies to the clipboard; `draft.paste` types, so the same rule), `edit.save`, `edit.close`, `comment.send`, `comment.close`, `session.leave` on a draft | no | only in a draft it opened and alone typed in (the same rule); `composer.leave` and `composer.close` are the person's |
| an agent's `draft.undo`, `draft.redo` in the person's draft (PIE-621) | no: the history is one, the person's ctrl+z takes back anyone's newest step | allowed, its own steps only: its newest step when that's the newest, else its last patch where it is now (a compare-and-swap, so their typing since stays); a redo of someone else's step is refused |
| an agent's `comment.write` in a comment or reply the person is writing | no | refused (round 3), whether or not they're typing in it: the reason is said on the status bar and names `block.mark`. In a comment the agent opened, it replaces the text, copying out what the person typed there first |
| an agent's `complete insert=` in the person's edit or comment | no | refused (round 3): it would type at their cursor. Looking candidates up (`complete`, `complete text=`) only reads and stays allowed |
| an agent's reply to an invitation (the person's `@name` line in their own draft) | no: the cursor and view shift with it | `DraftSession.invite` grants one reply for the text above the line, checked by hash; `reply` swaps it in as one undo step, or keeps it as a suggestion when the person changed that text. Two actions take one (`invitation=`, checked by the draft rule, then used up): `comment.write invitation=<id> base=<hash>` rewrites the text above the line through `reply`, and `complete insert=n invitation=<id>` puts one candidate in at their cursor. No key or rendering makes an invitation yet |
| an agent's `draft.pick`, `composer.pick` (`ctrl+t`, `[insert]`) | it would hand the person's terminal to a picker | refused (`person:`): an agent puts text in their draft with `draft.patch`, or in an edit it opened with `edit.text` |
| `links` | no: the links tile aims at the note and its dock opens; the person's keys stay where they are | allowed |
| an agent's `draft.patch` on the service (below) | no: it lands in the draft above the mark when it names one, and never in the block being typed in; the cursor, selection and view shift with it | allowed, compared against the text as typed |
| `proposal.apply` | no | allowed, recorded as whoever runs it; an agent's isn't forced (the same compare as a patch) |
| `proposal.dismiss` | no | its own proposals only (the actor its patch names, checked by the service), recorded as it; the person dismisses any |
| an agent's `open`, `link.follow` or `marks.next` reaching the outline | the outline's cursor never moves for an agent (it doesn't reveal the note) | — |

## What's kept as unsent

A draft the person put aside (esc twice, a closed screen, the door quitting) shows under the reader's header as a calm
`■` line that says what the comparison found (PIE-637), e.g. `■ 2 lines from your edit on Oct 1 aren't in the note`.
Its controls are actions in the note set, on the reader showing the note (`kind=` edit, the default, comment, child or
card). An edit is compared three ways: its own changes (its base text → the draft) against the note now, each marked
`already` in the note, `new` (still applies) or `conflict` (changed differently since, with the note's version).
The base is the draft's stored text, else the note at the revision it was written on, else that revision from the
note's history; with none the comparison is two-way (`basis: "two-way"`, hunks `differs`) and nothing settles by itself.

| Action | What it does | An agent |
|---|---|---|
| `unsent.diff` | the edit's own changes against the note now, in a reader beside (`unsent:<id>#diff`, read-only): the answer first, then each change marked | gets `{ basis, verdict, said, hunks: [{ line, state, removed, added, now }], diff }`, nothing drawn |
| `unsent.copy` | the kept text as written, in a reader beside (`unsent:<id>#copy`) | gets the text and where its copy is |
| `unsent.dismiss` | lets it go; a copy of the text stays on disk (written first if there is none) | refused: it's the person's |
| `unsent.add` | opens the note's edit with the edit's `new` lines in it as one `draft.patch` (one ctrl+z); a `conflict` stays kept and is said; written on the revision the note is at, it comes back whole | refused: it opens an edit with the person's keys |
| `unsent.keep` | a note under this one holding the edit's whole text; the line goes | refused: it's the person's |
| `unsent.show` | unfolds the `1 old edit` chip (an older revision, more than three days) | yes |
| `edit.strays` | right after esc dropped an edit's stray characters (src/stray.ts), opens the edit again with them (`ctrl+z`, within a minute) | refused |

An edit whose every change the note already has is settled when a reader shows the note: its copy is kept, its entry
goes, one dim line says so (`settleQuietly`); nothing is asked.

`elements` lists each control (`control: diff`, `unsent: edit`), so `element.open n=` presses one as a click does.

## Editing above the person while they type: `draft.patch` (PIE-501)

An agent that wants to change text in a note the person may be writing in doesn't use the door at all: it
asks the outline service, which routes it. `draft.patch` is compare-and-swap on a span of text: the text the
agent observed and the revision it read (a range is a hint, in `utf16` units or `utf8` bytes), the
replacement, the agent's `mutation`, and a mark (the `@request` line) the span must end above.

- **The door holds its drafts.** A note's open draft is held on the service (`drafts.hold`, renewed by
  `drafts.heartbeat` every 5 s on a 15 s lease, `drafts.release` when it closes). A held note's patch comes
  to the door as a `draft` event; a door that quits, or closes the reader or screen the draft is in, lets go
  of the hold (a dead or frozen one loses it when the lease runs out), and patches go to the saved note
  under a revision check. A door that misses the 2.5 s answer deadline keeps its hold: the patch becomes a
  proposal and nothing is written to the saved note under the draft. When two doors hold drafts of one
  note, a patch goes to neither. `drafts.read` gives the note as the draft has it now.
- **The door runs the compare** (`Draft.applyPatch`, with the service's own compare, `@ep0ch/outline-core/draft-patch-compare`): the observed text at or near its range, the draft on the revision read, none around the
  cursor, and with a mark every span above it (above the block the cursor is in when the cursor is above
  the mark). Without a mark the only limit is the block being typed in: an agent's ordinary edit lands
  anywhere else, above or below. Then the cursor, the
  selection and the view shift by the change (the cursor's row stays where it was on screen), the change is
  lit for a moment (`@tidy · just now`) and is one step of the draft's one history (`draft.undo`, ctrl+z; `draft.redo`, ctrl+y). The draft's writers
  gain the agent, so the person's save names it. `peek` shows it: `editing.held`, `editing.cursor`,
  `editing.patches`, `editing.lit`.
- **A failed compare changes nothing.** The service keeps the proposal as a reply block under the note,
  attributed to the agent, and embeds it (`!((id))`) under the mark, in the draft when one is held;
  `proposal.apply` (`A`, `[apply]`) applies it anyway, as an ordinary edit by whoever runs it;
  `proposal.dismiss` (`X`, `[dismiss]`) asks the service (`draft.proposal.dismiss`) to take its embed line out of
  the note (or the draft of it being written), mark it dismissed and put it in Trash. A proposal whose passage was
  already gone, or reached the mark, when it was proposed carries `[proposal-applies::no]`: it offers only
  `[dismiss]`, and `A` says why. The person's apply is forced (placed by its passage wherever it is now, still
  above the mark; a changed passage is refused, never guessed); an agent's is held to the same compare as a patch, under the policy its
  patch named (`edit`, or `prose` for a `prose` patch and any proposal from before policies), above the mark
  and the cursor's block, against the text now (`applyProposal` in the outliner's
  `src/draft-patch-router.ts`), so an agent can't force its own proposal. A
  proposal applies only what its text shows.
- **The structural policy is the service's,** one of two the agent picks. The
  default, `edit`, is `outline_edit`'s guard: only a dropped `[page::…]`, or a dropped `^anchor` another
  note links to, is refused (unless the patch says `allowStructural`), and that refusal is an error:
  nothing is written and nothing is proposed. `prose`, opt-in (`outliner patch-demo`, a CLI demo of draft.patch; the `@tidy` agent is the tidy extension and uses `edit`), keeps every
  `^anchor`, `[[page]]`, `((ref))` and `[key::value]`, in its span and in the whole note: no edit inside a
  token, no stray backtick that turns one into code; what it refuses becomes a proposal. Either way the
  service reads a held draft before patching it, and the door never re-checks the grammar.
- No agent's draft.patch may write or reword an `@name` request line; the service refuses it.
- **The person's typing reaches the service.** A moment after they type in a held draft (`drafts.touch`, never
  for an agent's patch), the service reads the draft back and an `@name` request line written there runs once
  quiet, before any save; its answer lands in the draft as that extension's (`ext:<id>`). Their save is then
  recorded as theirs, naming it (`ep0ch-door:<host>+ext:<id>`). `r` on a request line (or `projection.refresh`)
  asks again as whoever pressed or ran it: `asked by you`, `asked by an agent (<id>)`.

    outliner patch-demo --block <id> --tidy-above "@tidy tidy this"    # a CLI demo of the prose policy, using the tidy extension's line rules; not the @tidy agent

## Extensions (PIE-512)

The outline service runs extensions (`packages/outliner/docs/extensions/README.md`); the door binds what
`extensions.list` names, and binds it again when the service says they changed. An agent uses the same paths
the person does:

- **Lines.** `view.get`, `peek` and `elements` show an extension's line as the reader draws it: a record, an
  output, a component, an `@name` request with its state. `elements` lists its title (kind `resource`) and its
  controls (kind `control`); `element.open n=…` runs what ⏎ on it would (the line's first action, or run it
  again), as the agent.
- **Actions.** `act ext.<id>.<action> block=<note> [line=<i>]` on any screen (`actions` lists them with their
  keys). The service runs it; what it writes is attributed `ext:<id>`, the change feed records who asked
  (`requestedBy`: you, by your `--as`, or the person) beside it, and the status bar says the agent ran it.
  `--as ext:<id>` is refused: only the service writes as an extension. A draft only an `@name` agent changed
  saves as the person's, naming it (`ep0ch-door:<host>+ext:<id>`). `projection.refresh block=<note> line=<i>`
  runs a line again or asks an `@name` agent again.
- **Tiles.** `act tile.open kind=<extension kind> note=<block>` opens one (its block is `note`, or the note a
  reader or detail shows where it's opened: never the tree's row or a root, so opened from the tree with no
  `note=` it keeps nothing until given one); its actions are its kind's (`act ext.tarot.keep tile=<tile>`),
  and a block action (`ext.tarot.keep block=<id>`) works without the tile too. The program in
  it gets the host's socket and the outline's name (`EP0CH_SOCKET`, `EP0CH_WS`) and `OUTLINER_EXTENSION`, plus the door's
  own `EP0CH_CONTROL`, and its args as `--name=value`. `layout.get` shows its `args`; a tile whose kind went
  away is `unregistered` and says why.

## Names

- **Focus** is only the person's keys: which tile has them (`tile.focus`).
- **An attention mark** is `block.mark`: a reason and who set it, framed and labelled in every tile showing the
  block (or an extmark on an nvim line), until it's dismissed.
- **A tint** is `block.tint`: a block, lines or a passage tinted in one reader (PIE-423's "focus mark");
  `block.untint` takes it away.

## Programs and state: what survives what

| When | Terminal tiles | The layout |
|---|---|---|
| leaving the desk (`q`, `esc`, the menu) | keep running; the desk waits in the background and `D` brings it back | kept (desk.json) |
| `^W x` on a running program | asks; again within 3s ends it | the tile goes |
| an agent's `tile.close` on a running program | refused | — |
| the program exits | the tile keeps the person's keys until `⏎` (run again) or `ctrl+]` | — |
| `layout.load` | same-named tiles keep their programs; others running go in one shut dock on the right | replaced (refused on a locked screen) |
| detaching from a session (ctrl+c, the menu's logoff `G`, closing the terminal, a dropped ssh) | keep running in the session, scrollback and all; the next attach shows them | kept, live |
| a session handed over (`ep0ch session upgrade`, `restart`) or its daemon dying (`kill -9`, a crash) | keep running in the session's terminal host; the next daemon adopts them, their output replayed, nvim's socket and a Herdr attach remembered | kept; the screens open come back, readers keep their note, back and forward, scroll, `[ ]` position and folds, a zoomed tile stays zoomed, and at a handoff the edits open |
| ending a session (`E` on the main menu, `ep0ch session end`; an agent's `session.end` is refused) | asked (programs running), then ended with the session and its terminal host | kept |
| quitting a door in its own terminal (`--no-daemon`: ctrl+c, the menu's logoff) | asked twice, then ended (nvim keeps unsaved changes in its swap file) | kept |
| SIGINT, SIGQUIT, SIGTERM, SIGHUP, an uncaught exception | ended with the door, after drafts, comments and an open `ctrl+e` editor's text are copied to `drafts/`; the terminal is put back and the socket removed | kept; written whole (temp file, rename) |
| `kill -9` | ended by the pty's hangup; a watcher puts the terminal back; the next door sweeps the socket and keeps the `ctrl+e` file | kept |
| a restart | started again from the layout; a `ctrl+e` edit tile isn't restored | read back |

## Marks

`block.mark` is the door side of PIE-423's focus mark, kept in a `MarkStore` (`src/desk/marks.ts`):
- The store is door-local for now, in the door's `marks.json`. PIE-423's service-backed store replaces it,
  so Detail and other clients show marks too. Two doors on one state dir share the file: each change reads it
  first, so neither loses the other's marks or reuses a number (a door sees the other's marks on its next read).
- A marked note is framed in magenta, and labelled `◆ <reason> · by <who>` in the header of every tile that
  shows it.
- `alt+m` steps through marks: to a tile showing it, else it opens where the focused tile's opens go.
- A click on the label, or `alt+x` on the focused tile, dismisses it.
- A tint (`block.tint`, a block or passage tinted inside one reader) is the in-reader counterpart: no reason,
  no frame, gone when the reader shows another note or the person presses `esc`.

## Parity: every key and click is an action (PIE-506)

Audited screen by screen in PIE-506 (the table is in its PR); PIE-413 part b did the desk's layout first. The
rule now holds by test, not by review:

- **Every key or click that changes what a screen shows runs an action that names it.** The key, the click and
  `act` call the same `ActionDef`, and the def's `keys` says which keys and gestures run it, in one spelling
  (`declaredKeys` in `src/surface/actions.ts`: `q Q`, `⏎`, `esc`, `shift+tab`, `alt+l`, `ctrl+e` or `^E`, `^W x`
  for the desk's window chords, `X then Y` for other chords, `click`, `drag`, `wheel`).
- **Every key a hint names is declared** by an action the screen lists (`actions`), the shell's or the
  drawer's. A hint is `keys words · keys words` (`hintKeys`); a part that starts with a word names none.
- **Input states** (a prefix such as `^W`, `alt+l` link mode, a palette or filter being typed, a picker, an
  edit, a comment, the property panel, the board's mover and steps overlay, the hub picker) hold the keys
  (`holdsKeys`), so an agent doesn't move the person's screen while they're in one. Typing in them isn't a
  command; what they end in is, and so is opening a list the person picks from (`board.hub`, `layout.list`).
  A cancel that puts the screen back as it was runs nothing.
- **An agent's run never takes the person's focus, selection or keys.** Where an action moves only the
  person's own cursor or view, an agent's either moves its own (the board's `card.select`) or is refused with
  the agent's way named (`view.scrollTo`, `tree.pick`, `list.read`).

`test/parity.ts` (run by `test/parity-*.test.ts`) keeps it so. It builds every screen the menu opens against a scratch outline, and
more states of the board, the river, the desk and the reader, then presses every key a person can press and
clicks across the screen, one at a time from where it opens, and from each input state a second key. Every
action run is traced (`traceActions`). A key or click that changed the screen (its rows and the status bar
under them, `describe()`, the screen stack, the drawer being up, entered or resized, or the video mode)
without running an action whose `keys` names it fails, as does a hint that
names an undeclared key. Rows that change by themselves (a clock, a terminal's prompt) are masked, and a change
with no action is checked once more on a fresh screen before it fails. The second keys of a state an action
opened are probed once in a file: the shell's (a picker, a new note, the drawer) on the first screen that opens it,
a screen's own on the first scenario of that screen; a prefix no action opened, on every scenario. `PARITY_ONLY=<screen,…>`,
`PARITY_DEPTH=1` and `PARITY_LOG=<file>` narrow it while working on one screen.

What the probe doesn't reach: a terminal tile's own keys (they're its program's), the logon and logoff, the
message a key flashes on the status bar (it runs out on a timer), the drawer's own rows (its terminal's), and
ctrl+e in a tile beside the note (the probe edits over the whole door; `desk-tiles.test.ts` covers the tile).

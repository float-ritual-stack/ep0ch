# The door's agent interface

An agent sees what the person sees, live, and can change anything except where the person's cursor is.

- **Commands are the only way the UI changes.** Every change is a named action in an `ActionSet`: the person's
  keys, clicks and drags call it, and so does an agent over the control socket (`act`). The same code runs
  either way, and an agent's run is always said on screen ("an agent (claude-7) moved draft below tree").
- **Reads:** `layout.get` and `view.get` say what's on screen, as JSON.
- **A live feed:** `subscribe` pushes every change to what the person sees as it happens: focus, what each
  tile has in view, cursors and selections, the layout, and marks.
- **Agents never take the cursor.** One rule, in one place (`mayMoveKeys` in the desk): an agent's action moves
  the person's focus only when they aren't typing. Typing means in an edit, a comment or the property panel,
  in a terminal tile, in a board, river or brief tile's own edit, or with a picker open. The paths it guards
  are listed below. An agent never moves the outline's cursor or the person's selection at all. To get the
  person's attention, an agent sets a mark (`block.mark`).
- **Edits go through the owner.** Notes are written through the outline service, with revision checks and
  `author: agent`. An nvim tile's buffer is written through nvim's own socket, which moves no one's cursor.

## The control socket

`EP0CH_CONTROL` names it (default `door.sock` in the door's state, `$EP0CH_STATE` or
`~/.local/state/ep0ch-door`; a second door serves on `door-<pid>.sock`, and a starting door sweeps sockets
no door listens on). **The socket is the door's shell:** a client can do what the person can, including
start a program in a terminal tile (`tile.open kind=pty cmd=…`), and `as=` is only a claimed name. So it is
0600, in a folder that is the user's alone (0700, owner checked, the nvim sockets' check); in a folder anyone
else can reach, the door serves no socket and says why. A request line longer than 16 Mi characters is refused and cut off (well above any note's whole text for `edit.text`). Every terminal tile gets its door's own socket as `EP0CH_CONTROL`, its tile's name as
`EP0CH_TILE` and its id as `EP0CH_TILE_ID`, so a program in a tile
reaches the door it runs in (for the daily agent in Herdr, the socket of the door attached to it; see the
README's "The daily agent in Herdr"). It speaks newline-delimited JSON:
one request per line, one answer per line (`{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`).

| Request | Answer | CLI |
|---|---|---|
| `{"cmd":"peek"}` | the screen as text, and the screen's own `describe()`, with the door's `pid` and `nest` (the layers it runs in) | `ep0ch peek` |
| `{"cmd":"snap","path":"x.png"}` | a PNG of exactly what the terminal was sent, written under the door's state (`path` relative to it, or inside it; default `screen.png`); anywhere else is refused | `ep0ch snap` |
| `{"cmd":"snap","data":true}` | the same PNG, base64, for the client to write | `ep0ch snap x.png` (the command writes `x.png`, into a folder that must exist) |
| `{"cmd":"actions"}` | every action the current screen takes, with its arguments and keys | `ep0ch actions` |
| `{"cmd":"act","action":"…","args":{…},"reader":"<tile>","as":"<actor id>"}` | the action's result | `ep0ch act <action> k=v … reader=<tile> [--as id]` |
| `{"cmd":"open","id":"<block>"}` | puts a block in front of the person | `ep0ch open <id>` |
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
| the agent drawer | the door, for its one agent tile (PIE-498) | `door:<pid>/dock/dock.agent:claude` |
| the daily agent's Herdr pane | the Herdr launcher (`scripts/door-agent-herdr.ts`), for the pane it makes | `herdr:door-claude` (the pane's label) |

The three routes:

    ssh:pts/5 › door:1388380/desk/t1:claude                               # plain ssh: a door, a tile
    ssh:pts/5 › herdr:w1:p1 › door:1388380/desk/t1:claude                 # the door in a Herdr pane
    ssh:pts/5 › herdr:w1:p1 › door:1388380/daily/t3:claude › herdr:door-claude   # the daily agent in Herdr

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
| `viewport` | `tile`, `viewport` | what a tile has in view changes. A reader gives `block`, `title`, `first` and `last` (1-based note lines in view) and `top`, `room` and `total` (the body's scroll). The outline gives `selected`. A terminal gives `file`, `running`, and for nvim `first` and `last` (lines in its window). A screen tile gives `selected` |
| `cursor` | `tile`, `cursor` | a reader's text selection (`selection`), nvim's cursor (`file`, `line`, `col`, `mode`), or a terminal's screen cursor (`screen: {x, y}`). A terminal's cursor is sent only for the focused tile |
| `layout.changed` | `layout`: `name`, `rev`, `rule`, `zoom`, `tree` (splits with their `id`, `path` and `shares`, tab sets with their `id` and the tab `shown`, tiles with their `id`), `tiles` (each `tile`, `id`, `kind`, `rect`, `link`, `tabs`, `pinned` or `drawer`, `source`, and for a terminal `cmd`, its nvim `socket` and `herdr`) | a split, move, tab, pin, drawer, resize, load |
| `marks.changed` | `marks`: each mark's `n`, `block` or `tile`+`line`, `reason`, `by`, `at`, `showing` | a mark set or dismissed |
| `screen` | `screen` | the door moved to another screen (the feed is the desk's) |

The feed is the desk's, and every view built on it (the brief, the pinned pages, Waiting). Other screens say
`screen` only.

## Reads

| Action | Gives |
|---|---|
| `layout.get` | `rev` (below); the tile tree (`describeTree` by name): each split with its `id` (`s<n>`), `path` and each kid's `share`, each tab set with its `id` (`g<n>`), each tile with its `id` (`t<n>`); and each tile's `id`, `n` (its number on screen), `name`, `kind`, `rect`, `tabs`, `link`, `drawer`, `source`, `showing`, and for a terminal its `cmd`, `file`, `pid`, screen `text`, `nvim.socket`, and `herdr` |
| `view.get` (`reader=<tile>` for one) | `focus`, and each tile's `viewport` and `cursor` as the feed gives them. For one terminal tile, also its `screen` text |
| `tile.info reader=<tile>` | one tile as `layout.get` gives it |
| `marks.list` | every mark, and the tiles showing it |
| `layout.list` | the layouts that can be loaded, saved or built in |
| `actions` | everything the screen can do |

## The shell: screens and lists

On every screen, before the screen's own actions: `screen.open name=<menu key, label or title>`,
`screen.back`, `screen.list` (what the menu opens and the stack the person is on). On the BBS lists (a
message list, Join, Last callers, File areas): `list.read` (rows numbered from 1, the lit one; moves nothing),
`list.select n=`, `list.open [n=]`. The menu's letters, `⏎` and clicks, and `q`/`Esc`, `j k`, `⏎` and clicks on
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
  `Esc` there only says "G logs off"; their `q` there is the Quay, as it always was).

    ep0ch act screen.open name=J --as claude-7
    ep0ch act list.read --as claude-7
    ep0ch act list.open n=3 --as claude-7

### The agent drawer (PIE-498)

Also on every screen but the logon: the agent drawer, the App's one agent tile, pulled up from the status bar's
`▲ claude` chip over whatever screen is shown. `peek` gives its state as `dock` (`open`, `entered`, `share`,
`rect`, `state`, `openedBy`, `herdr`, and its `terminal` as a tile gives it).

| Action | Args | Keys, mouse | Agent rules |
|---|---|---|---|
| `agent.toggle` | `open` (true, false; left out, it toggles) | `alt+a`, a click on the chip; `Esc` (after `ctrl+]`) puts it away | pulling it up is a move of the person's screen: refused while they're typing (in the drawer too) and within 2s of their last key, as `screen.open` is; said on the status bar and in the drawer's title. Never enters it: their keys stay where they were. Refused to put it away while they're in it |
| `agent.height` | `share` (0.2 to 0.9 of the rows above the status bar) | drag its top edge; `alt+A` steps 40, 50, 60, 75% | refused while they're in it |

Its program is told `EP0CH_TILE_ID=dock.agent` and `EP0CH_TILE=claude`, and its nest layer is
`door:<pid>/dock/dock.agent:claude`. The Herdr launcher's `tile.herdr reader=dock.agent` reaches the App on any
screen. `ep0ch where` names the drawer as the tile (`the agent drawer`), and says when the person is typing in it.

## Naming tiles and splits (PIE-491)

Two actors (the person and an agent, or two agents) change the layout at once, so a name must mean the same
thing after someone else's change.

- **Ids.** Every split (`s4`), tab set (`g2`) and tile (`t7`) has an id, in `layout.get` and the feed. It
  stays with its split, tab set or tile through moves, tabs, resizes and saves (`desk.json` and
  `layouts.json` keep them, so a restarted door gives the same ones), and is never given to another:
  `desk.json` keeps the next ids too, and a tile made by loading a layout from `layouts.json` gets its saved
  id only if no tile had it before in this door. A split
  that's gone (its tiles moved or closed) is refused by id, never swapped for another.
- **Names.** A tile's name starts with a letter, then letters, digits, `.`, `-` or `_`, at most 40 (`middle`,
  `claude`, `reader2`), and isn't shaped like an id (`t`, `s` or `g`, then digits). So a name is never a number,
  never an id, and never holds the `:` of a `tile:<name>` source. `tile.open name=1` and `name=s2` are refused.
  (Ids have no sigil because the CLI reads a value starting with `@` from a file.) A layout saved before this
  rule with a tile named `2` (or `t2`, or any name the rule refuses, such as one with a space) loads with that
  tile renamed to its kind (`detail`, or `detail2` when taken), and its links, sources and focus follow. A
  `desk.json` saved from the `daily` layout before ids, or a `daily` saved in `layouts.json` then, gets the
  links that layout has gained since (the claude tile's, to `middle`), on tiles that have none.
- **Numbers.** `#3` (or `3`) is the tile numbered 3 on screen, where it is now.
- **`reader=<tile>`** takes a name, an id, a number, or `focused`. Answers name the tile by its name, not its
  place.
- **The revision.** `layout.get` gives `rev`, a number that changes whenever the tree's shape does: a split,
  tab set or tile added, taken away or moved. A resize or showing another tab doesn't change it. It only goes
  up, and never repeats across a restart (it starts from the clock, or from the one `desk.json` saved), so an
  agent that outlives the door (the Herdr agent) is refused, not misled, after one. Any desk
  action takes `expected=<rev>`; if the layout changed since, it's refused and nothing is done ("the layout
  changed since revision 7 …"). Pass it whenever you name something by place: a `path`, or a `#number`.
- **The board's readers** are `preview`, `detail1`, `detail2`, `float1`…: a detail keeps its name while it
  lives, whatever closes around it, so after `detail1` closes the other is still `detail2`. A detail floated
  (or a float docked) gets a new name for what it now is (`float2`, `detail3`); the old one is refused.

    ep0ch act layout.get                                  # rev 12; the right column is split s5
    ep0ch act layout.resize split=s5 border=0 share=0.3   # the same split, whatever moved since
    ep0ch act layout.resize path=2 border=0 share=0.3 expected=12   # refused if the layout changed

## Commands

The desk's commands, by what they change. `reader=<tile>` names a tile as above. Each is also a key or a mouse
gesture; see the README's desk section and `docs/UI-GRAMMAR.md` §7.

| Command | Args | Agent rules |
|---|---|---|
| `layout.load` (`layout.restore`), `layout.save` | `name` | load is refused while the person is typing; running programs are never ended |
| `layout.move` | `reader`, `to`, `where` (left, right, up, down, tabs, edge-*), `index` | never the tile the person is typing in; their tab stays shown |
| `layout.resize` | `split` (its id from `layout.get`) or `path` (with `expected`), `border`, `share`; answers the split's `id`, `path` and `tiles` | a dragged border runs this, by the split's id |
| `layout.even`, `layout.swap` | `to` | |
| `tile.open` | `kind`, `name`, `cmd`, `file`, `source`, `note`, `cwd`, `to`, `where` | focus stays where it is; a new tab isn't shown over the person's |
| `tile.close` | `reader` | never the person's tile, never a running program |
| `tile.focus` | `reader` | refused while the person is typing |
| `tile.link` | `reader`, `to` | |
| `tile.pin`, `tile.drawer` | `on`, `open` | |
| `tile.preview` | `reader`, `where` | |
| `tile.type`, `tile.restart` | `text` | never into the terminal the person is in (the desk's `claude` tile included while they type in it in the agent drawer) |
| `tab.select` | `reader`, `by` | never hides the person's tab |
| `open` | `id`, `reader`, or `from=<tile>` | shows the note in that tile, or with `from`, where that tile's opens land (its link; unlinked, where `ep0ch open` puts it). A program in a tile passes `from=$EP0CH_TILE` and never names a reader. The person's own open gives the tile the keys, an agent's never does |
| `tile.herdr` | `reader`, `pane` (the Herdr pane's label), `on=false` | the terminal tile shows an agent that lives in Herdr: quitting the door ends only the attach. `scripts/door-agent-herdr.ts` calls it as it attaches; cleared when the program exits |
| `view.scrollTo` | `reader`, `line` or `text`, `block` | scrolls a reader's view; never the person's [ ] position, selection or keys, and never their edit |
| `block.mark` | `id` (default: the note `reader` shows), or `line` for an nvim tile; `reason` | framed and labelled in every tile showing it, or an nvim extmark |
| `block.unmark` | `n`, or `id`, or neither (the focused tile's) | |
| `marks.next` | | refused while the person is typing |
| `pane.*` | `split`, `close`, `resize`, `zoom`, `float`, `pin` | as before (PIE-412) |
| `tree.links` | `reader` (an outline tree; on the board, its outline drawer, refused while shut), `n` (a row as `peek`'s `tree.rows` numbers it) or `id`, `show` | shows or hides a row's outlinks, resources and backlinks under it, as the outliner's Tree does (`blocks.authored-links`, `references.backlinks`); registers nothing; the person's selection stays on its row, and hiding the rows it is in is refused |
| `tree.pick` | `reader`, `n` or `id`, `open` | an agent's pick shows the row's note where the tree's selection goes; `open=true` opens it where the tree's opens go (a group folds; a resource is registered if it must be, fetched once if nothing is stored, and shown). Never the person's selection or keys |
| the note actions | `edit.*`, `comment.*`, `link.follow`, `block.tint` (PIE-423's focus mark; `focus.set` is its older name), `select*`, … | in the reader named; an agent's edit or comment is never the person's until they enter it |

Example: bring the person's attention to a decision, from an agent running in a tile.

    ep0ch act open id=<block> from=$EP0CH_TILE --as claude-7         # answers reader=middle (the tile's link)
    ep0ch act view.scrollTo text="needs a decision" reader=middle --as claude-7
    ep0ch act block.mark reason="needs your call" reader=middle --as claude-7

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
- a mark on a line: `ep0ch act block.mark line=<n> reason=… reader=<tile>` sets an extmark with virtual
  text (namespace `ep0ch_marks`), and `block.unmark n=<n>` takes it away.

## Agent paths that could touch the person's keys

Every action an agent can call that moves focus, shows or hides a tile, or changes what the person is looking
at, and what it does while they're typing:

| Action | Moves the person's focus? | While they're typing |
|---|---|---|
| `tile.focus`, `focus` (the same action) | yes, that's what it's for | refused |
| `marks.next` | to a tile showing the mark | refused |
| `layout.load` (`layout.restore`) | rebuilds the desk | refused |
| `tile.drawer open=false` on the drawer that has the keys | the keys go to another tile | refused |
| `tile.drawer open=true` | no (the person's own opens it and gives it the keys) | allowed |
| `screen.open`, `screen.back`, `list.select`, `list.open`, `open <id>` on the menu or a list | yes: another screen, or a list's lit row; said on the status bar, and `q` comes back | refused, and within 2s of their last key |
| `agent.toggle open=true` | no: the drawer comes up over the screen, the keys stay where they were | refused, and within 2s of their last key |
| `agent.toggle open=false`, `agent.height` | no | refused while they're typing in the drawer |
| `open`, the control socket's `open <id>` | no: shown in a tile (the focused tile's link, a following reader, a free detail) | allowed |
| `tile.open`, `pane.split` (the same code), `tile.preview` | no; a new tab isn't shown over the person's | allowed |
| `layout.move`, `layout.swap` | no; never the tile they're typing in | the typing tile refused |
| `tile.close`, `pane.close` (the same code) | never the focused tile, never a running program | refused for those |
| `tab.select` | never hides the person's tab | refused for that |
| `pane.zoom` | only the focused tile, never one that hides it | refused otherwise |
| `tile.type` | no | refused for the terminal they're in |
| `view.scrollTo` | no: a reader's view only (not its `[ ]` position or selection) | refused on their edit |
| `block.mark`, `block.unmark`, `block.tint` | no | allowed |
| `tree.links`, `tree.pick` | no: the tree's selection stays on the person's row (folding away the rows it is in is refused); an open lands where the tree's opens go | allowed |
| `tile.herdr` | no | allowed |
| note actions (`edit.*`, `comment.*`, `link.follow`, …) | no; an edit or comment an agent opens is the person's only when they enter it | allowed |
| an agent's `draft.patch` on the service (below) | no: it lands in the draft only above the mark and never around the cursor; the cursor, selection and view shift with it | allowed, compared against the text as typed |
| `proposal.apply` | no | allowed, recorded as whoever runs it; an agent's isn't forced (the same compare as a patch) |
| an agent's `open`, `link.follow` or `marks.next` reaching the outline | the outline's cursor never moves for an agent (it doesn't reveal the note) | — |

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
- **The door runs the compare** (`Draft.applyPatch`, with the service's own `src/draft-patch-compare.ts`,
  vendored): the observed text at or near its range, the draft on the revision read, every span above the
  mark (without one, or when the cursor is above the mark, above the block the cursor is in), none around
  the cursor. Then the cursor, the
  selection and the view shift by the change (the cursor's row stays where it was on screen), the change is
  lit for a moment (`@tidy · just now`) and is one undo unit (`draft.undo`, ctrl+z). The draft's writers
  gain the agent, so the person's save names it. `peek` shows it: `editing.held`, `editing.cursor`,
  `editing.patches`, `editing.lit`.
- **A failed compare changes nothing.** The service keeps the proposal as a reply block under the note,
  attributed to the agent, and embeds it (`!((id))`) under the mark, in the draft when one is held;
  `proposal.apply` (`A`) applies it anyway, as an ordinary edit by whoever runs it. The person's apply is
  forced (placed as well as it can be); an agent's is held to the same compare as a patch (prose only, above
  the mark and the cursor's block, against the text now), so an agent can't force its own proposal. A
  proposal applies only what its text shows.
- The structural policy (a prose edit keeps every `^anchor`, `[[page]]`, `((ref))` and `[key::value]`, in
  its span and in the whole note: no edit inside a token, no stray backtick that turns one into code) is
  the service's; it reads a held draft before patching it, and the door never re-checks the grammar.

    outliner patch-demo --block <id> --tidy-above "@tidy tidy this"    # the proof agent, not the @-watcher

## Names

- **Focus** is only the person's keys: which tile has them (`tile.focus`, and `focus`, its older name).
- **An attention mark** is `block.mark`: a reason and who set it, framed and labelled in every tile showing the
  block (or an extmark on an nvim line), until it's dismissed.
- **A tint** is `block.tint`: a block, lines or a passage tinted in one reader (PIE-423's "focus mark").
  `focus.set` and `focus.clear` are its older names, kept for callers that use them.

## Programs and state: what survives what

| When | Terminal tiles | The layout |
|---|---|---|
| leaving the desk (`q`, `esc`, the menu) | keep running; the desk waits in the background and `D` brings it back | kept (desk.json) |
| `^W x` on a running program | asks; again within 3s ends it | the tile goes |
| an agent's `tile.close` on a running program | refused | — |
| the program exits | the tile keeps the person's keys until `⏎` (run again) or `ctrl+]` | — |
| `layout.load` | same-named tiles keep their programs; others running become shut drawers | replaced |
| quitting the door (ctrl+c, the menu's logoff) | asked twice, then ended (nvim keeps unsaved changes in its swap file) | kept |
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

## What still changes the UI without a command

Audited for this interface (PIE-413 part b). Fixed in this PR on the desk:
- a dragged border (now `layout.resize`);
- `^W =` (`layout.even`) and `^W s` (`layout.swap`);
- a drawer sliding shut when the keys leave (`tile.drawer`);
- the person's focus by Tab, 1-9, clicks and `^W hjkl` (`tile.focus`);
- tabs (`tab.select`), zoom and unzoom (`pane.zoom`);
- an agent's `open`, the control socket's `open <id>`, `focus`, and shutting a drawer the person has: one
  guard, the same actions as `tile.*` (`focus` is `tile.focus`, `pane.split` and `pane.close` are
  `tile.open` and `tile.close`);
- an agent's open revealing its note in the outline (it moved the person's outline cursor; no longer).

Still direct, next:
- **A reader's own keys that change only what it has in view.** `j k`, PgUp, PgDn and the wheel scroll it,
  and `[ ]` moves the person's element. These are the note surface's (`src/surface/note.ts`); the feed
  publishes their effect (`viewport`), and `view.scrollTo` is the agent's way to scroll.
- **The outline tile's cursor** (`j k`, clicks). The feed publishes it (`viewport.selected`), but there is no
  `tree.select` action yet.
- **Input states:** the search overlay (`/`), the layout picker, `alt+l` link mode, the `^W` prefix, and being
  "in" a terminal tile or a reader's edit. What they end in is a command.
- **Other screens.** The board has `card.*` and `reader.*` for most of what its keys do (lane focus and the
  lane cursor aren't actions). The river has `RIVER_ACTIONS` for columns, but not its filter, `#` or `/`
  jump. The BBS lists have `list.*` and every screen the shell's `screen.*` (PIE-489); Who's Online's `r`, the art
viewer's keys and a message list's `t` aren't actions yet. See
  `docs/UI-GRAMMAR.md` §3, where the `·` in `kma` marks each missing agent action.

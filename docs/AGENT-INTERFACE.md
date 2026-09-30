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

`EP0CH_CONTROL` names it (default `~/.local/state/ep0ch-door/door.sock`; a second door serves on
`door-<pid>.sock`). Every terminal tile gets its door's own socket as `EP0CH_CONTROL`, so a program in a tile
reaches the door it runs in (for the daily agent in Herdr, the socket of the door attached to it; see the
README's "The daily agent in Herdr"). It speaks newline-delimited JSON:
one request per line, one answer per line (`{"ok":true,"result":…}` or `{"ok":false,"error":"…"}`).

| Request | Answer | CLI |
|---|---|---|
| `{"cmd":"peek"}` | the screen as text, and the screen's own `describe()` | `ep0ch peek` |
| `{"cmd":"snap","path":"x.png"}` | a PNG of exactly what the terminal was sent | `ep0ch snap x.png` |
| `{"cmd":"actions"}` | every action the current screen takes, with its arguments and keys | `ep0ch actions` |
| `{"cmd":"act","action":"…","args":{…},"reader":"<tile>","as":"<actor id>"}` | the action's result | `ep0ch act <action> k=v … reader=<tile> [--as id]` |
| `{"cmd":"open","id":"<block>"}` | puts a block in front of the person | `ep0ch open <id>` |
| `{"cmd":"subscribe","types":["focus.changed",…]}` | the live feed on this connection (below) | `ep0ch subscribe [types]` |

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
| `layout.changed` | `layout`: `name`, `rule`, `zoom`, `tree` (splits with their `path` and `shares`, tab sets with the tab `shown`), `tiles` (each `tile`, `kind`, `rect`, `link`, `tabs`, `pinned` or `drawer`, `source`, and for a terminal `cmd` and its nvim `socket`) | a split, move, tab, pin, drawer, resize, load |
| `marks.changed` | `marks`: each mark's `n`, `block` or `tile`+`line`, `reason`, `by`, `at`, `showing` | a mark set or dismissed |
| `screen` | `screen` | the door moved to another screen (the feed is the desk's) |

The feed is the desk's, and every view built on it (the brief, the pinned pages, Waiting). Other screens say
`screen` only.

## Reads

| Action | Gives |
|---|---|
| `layout.get` | the tile tree (`describeTree` by name) and each tile's `name`, `kind`, `rect`, `tabs`, `link`, `drawer`, `source`, `showing`, and for a terminal its `cmd`, `file`, `pid`, screen `text`, and `nvim.socket` |
| `view.get` (`reader=<tile>` for one) | `focus`, and each tile's `viewport` and `cursor` as the feed gives them. For one terminal tile, also its `screen` text |
| `tile.info reader=<tile>` | one tile as `layout.get` gives it |
| `marks.list` | every mark, and the tiles showing it |
| `layout.list` | the layouts that can be loaded, saved or built in |
| `actions` | everything the screen can do |

## Commands

The desk's commands, by what they change. `reader=<tile>` names a tile by name (`middle`), by its number on
screen (`5`), or `focused`. Each is also a key or a mouse gesture; see the README's desk section and
`docs/UI-GRAMMAR.md` §7.

| Command | Args | Agent rules |
|---|---|---|
| `layout.load` (`layout.restore`), `layout.save` | `name` | load is refused while the person is typing; running programs are never ended |
| `layout.move` | `reader`, `to`, `where` (left, right, up, down, tabs, edge-*), `index` | never the tile the person is typing in; their tab stays shown |
| `layout.resize` | `path` (from `layout.get`), `border`, `share` | a dragged border runs this |
| `layout.even`, `layout.swap` | `to` | |
| `tile.open` | `kind`, `name`, `cmd`, `file`, `source`, `note`, `cwd`, `to`, `where` | focus stays where it is; a new tab isn't shown over the person's |
| `tile.close` | `reader` | never the person's tile, never a running program |
| `tile.focus` | `reader` | refused while the person is typing |
| `tile.link` | `reader`, `to` | |
| `tile.pin`, `tile.drawer` | `on`, `open` | |
| `tile.preview` | `reader`, `where` | |
| `tile.type`, `tile.restart` | `text` | never into the terminal the person is in |
| `tab.select` | `reader`, `by` | never hides the person's tab |
| `open` | `id`, `reader` | shows the note in that tile; the person's own open gives the tile the keys, an agent's never does |
| `view.scrollTo` | `reader`, `line` or `text`, `block` | scrolls a reader's view; never the person's [ ] position, selection or keys, and never their edit |
| `block.mark` | `id` (default: the note `reader` shows), or `line` for an nvim tile; `reason` | framed and labelled in every tile showing it, or an nvim extmark |
| `block.unmark` | `n`, or `id`, or neither (the focused tile's) | |
| `marks.next` | | refused while the person is typing |
| `pane.*` | `split`, `close`, `resize`, `zoom`, `float`, `pin` | as before (PIE-412) |
| the note actions | `edit.*`, `comment.*`, `link.follow`, `block.tint` (PIE-423's focus mark; `focus.set` is its older name), `select*`, … | in the reader named; an agent's edit or comment is never the person's until they enter it |

Example: bring the person's attention to a decision.

    ep0ch act open id=<block> reader=middle --as claude-7
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
| `open`, the control socket's `open <id>` | no: shown in a tile (the focused tile's link, a following reader, a free detail) | allowed |
| `tile.open`, `pane.split` (the same code), `tile.preview` | no; a new tab isn't shown over the person's | allowed |
| `layout.move`, `layout.swap` | no; never the tile they're typing in | the typing tile refused |
| `tile.close`, `pane.close` (the same code) | never the focused tile, never a running program | refused for those |
| `tab.select` | never hides the person's tab | refused for that |
| `pane.zoom` | only the focused tile, never one that hides it | refused otherwise |
| `tile.type` | no | refused for the terminal they're in |
| `view.scrollTo` | no: a reader's view only (not its `[ ]` position or selection) | refused on their edit |
| `block.mark`, `block.unmark`, `block.tint` | no | allowed |
| note actions (`edit.*`, `comment.*`, `link.follow`, …) | no; an edit or comment an agent opens is the person's only when they enter it | allowed |
| an agent's `open`, `link.follow` or `marks.next` reaching the outline | the outline's cursor never moves for an agent (it doesn't reveal the note) | — |

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
| SIGTERM, SIGHUP, a crash | ended with the door (drafts copied out on a signal) | kept; written whole (temp file, rename) |
| a restart | started again from the layout; a `ctrl+e` edit tile isn't restored | read back |

## Marks

`block.mark` is the door side of PIE-423's focus mark, kept in a `MarkStore` (`src/desk/marks.ts`):
- The store is door-local for now, in the door's `marks.json`. PIE-423's service-backed store replaces it,
  so Detail and other clients show marks too.
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
  jump. The BBS list screens (News, Conferences, Who's Online, Last Callers, Stats) have none. See
  `docs/UI-GRAMMAR.md` §3, where the `·` in `kma` marks each missing agent action.

# UI grammar and glossary

One vocabulary for the door's screens. It was first checked against the code on `feature/door-writes`
(PIE-433) and is kept current with main: a PR that adds or changes a shared part updates its row here.
The line numbers in the citations below are from that first audit and drift; the
[architecture map](architecture/map.json) is the checked index. Use this page to name things in code,
READMEs and roadmap items, and to judge whether a new screen reuses the grammar or invents its own.

## Before adding a feature

Check here for the part that already does it. Skipping this step is how the door got two readers,
three layout models and four searches (§4).

| The feature needs to… | Use | Where |
|---|---|---|
| render or read a note | `NoteSurface`, hosted through `SurfaceHost` (a view with its own header gives its rows through `SurfaceHost.header`, as the BBS message reader does, PIE-426); the body drawn by `renderDoc` after `presentLinks`; literal regions (PIE-422) found by `src/literal.ts`, inline Markdown (PIE-444: bold, italic, strikethrough) by `src/inline.ts` (checked against marked, Detail's parser) and `component:` fences by the reader host's renderers in `src/components.ts` (checked against the service's `documentComponent`), each the outliner's rules mirrored and parity-tested; Markdown links open through `src/open.ts`; transclusions (`!((id))`, `!((id^fragment))`) by `src/embeds.ts` from the service's projection (`transclusions.read`, PIE-424: fragment slices, nesting depth, cycles and their wording are the service's), each embedded body drawn by the surface's own renderer; a followed `((id^fragment))` revealed from `fragments.read` (PIE-425). Whether an outline event means the note shown must be read again is `NoteSurface.staleOn` (every host asks it: the desk's and the board's readers, the river's columns, the BBS message reader) and reads it again by `NoteSurface.reread` (one read at a time: a burst of changes makes one more, not one each), so a note trashed or restored with an ancestor says so. What takes a reader's keys besides reading is a **mode** in its mode stack (PIE-516, `src/surface/modes.ts`: a step's status choice, the property panel, the edit, the comment session; each with key, click, press, wheel, rows, leave, holdsKeys, describe), their precedence stated once (`PRECEDENCE`); `holdsKeys`, `choosing`, `editing`, `sessionOf`/`sessionWord` (what hosts name and track) and what's drawn in place of the note derive from it. The edit and the comment draw in place of the note; the panel and the status choice are drawn inside it by the reading render. A new thing that takes a reader's keys is a mode, never another field the surface checks; reading itself (layout, elements, folds, history, selection, projections) stays the surface's, and it stays the only reader | `src/surface/note.ts`, `src/doc.ts`, `src/refs.ts`, `src/literal.ts`, `src/inline.ts`, `src/components.ts`, `src/open.ts`, `src/embeds.ts` |
| scroll a view (the wheel, `j k`, PgUp PgDn) | `src/scroll.ts`: `scrolled(top, by, max)` moves a position by rows within its content and nothing else; `wheelRows(dir)` is what one wheel report scrolls (`EP0CH_SCROLL_ROWS`, default 1, no timing: the terminal already paces a trackpad's reports); `RowView`, every list's cursor and scroll (a thread's replies, the welcome's notes, a lane's cards, the tree, the backlinks, the board's steps; the selection comes into view only when it moved or the view's height changed, never on a repaint; a selection several rows tall names its rows; `reveal` brings it back after the wheel), never a list's hand-rolled `if (sel < top) top = sel` (a text cursor, the editor's or a passage's, follows its own). A list whose rows open to show the notes under them (the outline tree's children, a river column's replies) keeps which are open and those children in a `Fold` (`src/fold.ts`: read once, on the first open; walked depth first), never its own `open` set and `kids` map. A list whose wheel moves its selection moves it one row a report. A frame of nothing but wheel reports is `onlyScrolled()`, and a reader moves its last layout (`NoteSurface.layOut`) instead of laying the note out again | `src/scroll.ts`, `src/app.ts` |
| let a person or agent do anything; let an agent see what the person sees | the action registry: an `ActionDef` in an `ActionSet`; the key, the mouse and `act` all call it; an action has one name and one def (a change that isn't an action is a bug, and `test/parity.ts`, run by `test/parity-*.test.ts`, finds it: it presses every key and clicks across every screen, traces the actions run with `traceActions`, and checks each key against the def's `keys` and each hint against `declaredKeys`, PIE-506). The shell's `SHELL_ACTIONS` (`screen.open`, `screen.back`, `screen.list`, `screen.help`, `video.cycle`, reached from a screen screens.ts imports through `src/shell-keys.ts`, and `screen.shell`, drop to shell: the person's only, through `App.suspend` as ctrl+e's `$EDITOR`, `src/drop.ts`) work on every screen and the BBS lists' `LIST_ACTIONS` (`list.select`, `list.open`, `list.read`) on each list (PIE-489); an agent's move of the person's screen is an action that declares `touches: "screen"`, checked by the dispatcher (next row). Reads: `layout.get`, `view.get`; the live feed: `subscribe` on the control socket, diffed from the screen's `viewState()` after each paint (`App.subscribe`). See [the agent interface](AGENT-INTERFACE.md) Running one: the screen host's **dispatcher** (PIE-514, `Dispatcher` in `src/surface/dispatch.ts`): a screen registers its action sets (its own, `TILE_ACTIONS`, a tile kind's, `NOTE_ACTIONS` on a reader, `EXT_ACTIONS`) and says what its tiles are (`TileRef`: name, id, number, aliases, what each shows) and where the person's keys are on it (`Screen.keys`); the dispatcher reads `tile=` by one grammar, finds which set owns the action, checks `expected=`, checks the actor against the action's declared `touches` (`actorRule`, against the shell's one **whereabouts** query, `App.person()` in `src/whereabouts.ts`), runs it, says a refusal and redraws for the person's keys, and flashes the def's `says`. Keys and clicks call `press`/`pressIn`, the control socket `act`. A screen in a tile (a board on a desk) is reached through a delegation, its whereabouts seen from inside (`within`). Never a screen-local `act`, a tile-name parser, or an `actor.kind` check for the person's keys: declare `touches` (`nothing`, `tile`, `shape`, `draft`, `screen`), `while`, `draft`, `person` and `replay` on the def | `src/surface/actions.ts`, `NOTE_ACTIONS` in `src/surface/note.ts`, `src/control.ts`, `src/app.ts`, `docs/AGENT-INTERFACE.md`, `src/surface/dispatch.ts`, `src/whereabouts.ts`, `src/app.ts` (`person`), `test/dispatch.test.ts` |
| read a key: name it (a key map, a hint, an action's `keys`), or ask what it is | `keyName(k)`: a key's one name (`q`, `space`, `enter`, `ctrl+w`, `alt+c`, `alt+left`, `shift+tab`; the mouse's back and forward buttons are `alt+left` and `alt+right`; null inside a paste), the only spelling a screen spec's key map, an action's `keys` and the hints use (`isKeyName` checks one; a spec binding in another spelling is refused); `ch(k)` (the letter a plain key types), `isUp(k)` (↑ or k), `isDown(k)` (↓ or j). Never a local copy, never a second vocabulary | `src/surface/actions.ts`, `src/term.ts` |
| edit text, complete `[[` `((` `[file::` | the editing component: `Draft`, edit control, completer. The draft's list keys, the mouse and the preview are `DRAFT_ACTIONS` (PIE-496: `draft.newline` `draft.indent` `draft.outdent` `draft.place` `draft.scroll` `draft.preview`, forwarded as note actions); its soft wrap hangs a list item's rows under its text (`Draft.layout`); `renderEditor` records where it drew (`Draft.frame`) and `editorClick` maps a click to an action; the preview is the readers' renderer (`draftPreview`). Its lifecycle is the draft session's (next row). A paste typed out as keys (`pasteKeys`, tagged `pasted`) goes in as it came. An agent's `draft.patch` (pi-herdr-outliner PIE-501) reaches the person's draft through its session's hold: `Draft.applyPatch` runs the service's compare (`src/vendor/draft-patch-compare.ts`, copied byte for byte) against the text as typed, moves the cursor, selection and view with it, lights it (`Draft.flashes`) and keeps it as one undo unit (`draft.undo`, ctrl+z); a proposal that couldn't apply is applied anyway by `proposal.apply` (`A`) or dismissed by `proposal.dismiss` (`X`, the service's `draft.proposal.dismiss`); its embed's source line and an opened proposal's header draw both as `[apply]` `[dismiss]` (only `[dismiss]` on one marked `[proposal-applies::no]`), elements of kind control that `[ ]` reaches and a click runs | `src/edit.ts`, `src/surface/editor.ts`, `src/surface/completer.ts`, `src/completion.ts` |
| pick from a list in a box over the screen or a reader (a layout, a policy row, a search hit, a board, the lane a card moves to, a checklist step; a step's status, whose keys it is while the reader draws it inline) | the **list picker**: `ListPicker` (a `Mode` on a `Modes` stack, the reader's `ModeStack` generalised: the desk's and the board's overlays are one each), its spec giving the items, each item's rows (`pickRow` lights the one the cursor is on), what a choice runs (an action, as the person) and its frame; ↑ ↓ j k Tab Home End PgUp PgDn and the wheel move a `RowView` cursor, ⏎ or a click on a row chooses (and puts it away, unless it `stays`), esc, a closing letter or a click outside puts it away (`closed` says what else that does); put away, it has `ended` and its stack lets it go, so a screen never drops it by hand. Never a screen field with its own `sel`, key handler and draw | `src/surface/picker.ts`, `src/surface/modes.ts` |
| type one line (a filter, a search, a name, a property value) | `LineInput`: typing, ← →, Home End (ctrl+a ctrl+e), backspace, delete, ctrl+u, a prefilled text the first key replaces; `show` draws it with its cursor (`bar` ▌, or `block` over the character), `plain` for a status part. A picker takes one as its `input`. Never `text += k.ch` | `src/surface/line.ts` |
| write a draft somewhere: a note's text, a comment or reply, a new card or a note under one | the **draft session** (PIE-516, `src/draft-session.ts`): one lifecycle for every draft, behind three **target adapters** (`blockTarget`: update a block from its revision, a property change shown first; `commentTarget`: a comment on a passage or a reply, one request id per text so a retry can't land twice; `cardTarget`: a new card through `card.create`, born by `views.planWrite`, or a child through `note.create`). `DraftSession.open` brings back what the person put aside at the target's place (`unsent`, keyed `edit:<id>` `comment:<id>` `reply:<thread>` `card:<view>` `child:<id>`, with who wrote it; never for an agent; a lane's title and the reader's "■ unsent" lines say what's put aside) and holds a block's draft on the service (`drafts.hold` lease and heartbeat, `drafts.touch` as the person types), so an agent's `draft.patch` lands in it. Hosts call `key` (typing; what ends it is a `DraftCommand` the host runs as its action) and `leave` (a click away: an unchanged draft closes, a changed edit is written against its revision, a refused one, one brought back unsent and not typed in since, and any comment, reply or new card are kept as unsent, said at once); the actions call `submit` (written by `recordAs`; a stale refusal keeps the text, copied to disk, `reload` starts over), `close` (esc, esc: put aside, or dropped when brought back unchanged) and `replace` (a whole text, the other writer's copied out first). Every rule about an agent and a draft is `agentRefusal`, stated once: in a session, only one the agent opened and alone typed in; on a block, never a write (an edit, a property, a step) underneath someone else's open draft, nor a second draft of it (the board's moves, steps and trash wait for `openDraftOf`). An **invitation** (`invite`: the person's `@name` line grants that agent the text above it, one reply, by hash) is the one way in: `reply` swaps it in place as one undo step when the range is unchanged, else keeps it as a suggestion (`accept`); a seam for `@yo`, with no action, key or rendering yet. The rule knows this door's drafts; another door's are the service hold's. `composer.leave` and `session.leave` are the board's and the readers' names for `leave`, `composer.close` and `edit.close` for `close`; the draft's own actions run through `DraftSession.act` | `src/draft-session.ts`, `src/edit.ts`, `src/comment.ts`, `src/surface/note.ts`, `src/desk/delivery.ts` |
| open, split, zoom, close tiles; tabs, drag and drop, drawers, floats, spines, columns from data, named layouts, locking a shape | the layout tree (PIE-412), one engine for the desk and every screen built on it: tiles in **containers**, n-ary splits by weight, minimums, **tab sets** (PIE-413), **drawers** (PIE-505: a `Drawer` node holding any tiles, a whole split too, sliding out from its `edge` over the others, shut to a handle on the hint row; `wrapDrawer`, `wrapNodeDrawer`, `unwrapDrawer`, `drawerToEdge`; `placeScreen`'s `slid`, each open drawer placed as if it alone docked; a click on a header's `⇤ drawer` docks it), **columns** (PIE-511: a `Columns` node, tiles side by side in the order its `source` gives, each its own weight; it stays with one tile or none and never merges; `columnsOf`), **flows** (PIE-513: a `Flow` node, the river's columns: squeezed full → peek → spine around its wide column, `squeeze` and `placeFlow` in `src/desk/flow.ts`; an open from one of its tiles lands in a new column right after (its open rule, `opens: next`, `landing`); focus never moves it, only `tile.widen` (`^W W`, a click on a spine), an open that needs it, or a key to a column off the strip; a peek is drawn whole under its right-hand neighbour; docked columns and those holding work resist compression; the module's `flow.travel` (back and forward by its trail) and `flow.dock` are the river's `⌫`/`alt+←`/`alt+→` and `p` (`tile.travel`, `tile.dock`, PIE-515), and its columns are `river.column` tiles (`src/river/column.ts`); the River screen's own squeeze is this one (`squeeze`); `flowOf`), **floats** (PIE-511: `tile.float` takes a tile out of the tree to its own rectangle above everything, `float.place` moves and sizes it, its title drags it, its ◢ corner sizes it, `H J K L` step it, a click on its ⧉ docks it where the containers take it (the module's dock: another place when the first refuses); a float has no place in the tree, so nothing goes beside it, swaps with it or folds it until it docks: one rule, inside the module; saved with the layout), **spines** (`tile.collapse`, `^W c`: a tile side by side with others folds to a strip with its title, what it holds kept; a reader's spine marks a draft and new comments), borders that follow the pointer; every container and the screen carry a **policy** saved with the layout (`Policy`: draggable, droppable, closable (off: its tiles stay, `tile.close` refused with the reason), accepts, resizable, min/max/fixed, collapsible, overlay, stays (an open drawer stays when the keys leave it), locked, opensInto (a tile, or a container's key: opens land in tiles opened there), keep (how many tiles a container opens land in keeps), shuts (a close in it shuts its drawer); `effective` resolves the layers, nearest wins and `locked` anywhere above locks), and every layout change is one operation of the **screen-layout module** (PIE-513, `src/desk/screen-layout.ts`, the reducer of the one-way data flow): `apply(state, op, ctx)` applies one operation (open, close, move, swap, float and dock, place, pin, drawer, collapse, resize, shares, grow, even, lock, policy, link, focus, tab, zoom, load, fill, source, and a flow's `flow.widen` `flow.travel` `flow.dock`) for one actor as one transaction, answering the new `LayoutState` (the tree, floats, spines, zoom, links, names, the screen's policy and lock, the revision) or a refusal with its reason and nothing changed; the rules live inside it, never in a caller: a float has no place in the tree, the nearest policy wins and a lock above locks below, an agent undoes only its own lock, an agent never moves the tile the person types in (the caller says where that is: `ctx.person`), the screen is never blank; `refusal` asks without changing anything (a drag's ghost), `init` lays a screen out as it starts or loads, `serialize` and `describe` read it; the desk keeps the tile instances, the gestures and the painting and calls the module (`Desk.apply`); the state is frozen under test, so a caller writing to it throws (`layout.lock`, `layout.policy`, the `^W P` panel); tile moves (`move`, `tabInto`, `edge`, `normalise`, floatty's model ported, reaching into drawers) and the drop zones in cells (`dropAt`: header or centre tabs, triangles split, outer edges columns; `handleDrop`: a shut drawer's handle; each drop carries policy's `refused`). A columns container's tiles come from data: its `source` names a **tile source** (`registerTileSource`, `tileSource` in `src/desk/tile-kinds.ts`; `hub:<id>` is a hub's views, one query tile each, `HUB_SOURCE` in `src/desk/query.ts`), which the desk asks as the screen starts and again when a change `affects` it, keeping each tile by its `key` (`fillColumns`); a tile a source supplies doesn't close (it goes when its data does), and the source's `drop` says how to take one away (a hub's: its view out of the hub); a fixed screen whose save needs a tile says so as policy in its spec (the river's library: closable off, held by its tab set of one as the board's preview's is, since a save comes back only with every tile its spec names, `savedScreen`; a save written before the spec said it gets the rule back as it's read); a refill gives a new tile the name of the one it replaces (`fill` drops first) and a kept one its source's name when that's free; a preview's `tile:<name>` may name a container, following any tile in it. The board is a screen spec on this engine (PIE-515, `boardSpec` in `src/desk/delivery.ts`): its lanes are those columns, and what they share (the hub shown, the cursor, cards moved and written, steps, trash, the picker) is the hub source's **model** (`TileSource.model`, a `SourceModel` the desk makes per columns container and asks to draw, hint, key and save: `Lanes` in `src/desk/lanes.ts`, its actions `BOARD_ACTIONS`); its outline and backlinks are the desk's drawers, its floats the desk's floats; its fixed shape is policy, read back by `layout.policy` (PIE-510: the lanes and the preview stay where they are, draggable off; the preview doesn't close, closable off, in a tab set of one that holds its policy; a lane closes only when its view goes, the desk's rule for any tile a source supplies; the drawers' lists stay in their drawers), never a rule kept by tile name. Opens land in a container (`opensInto: readers`: a detail opened there holds the note, `keep: 2` of them, the oldest free one giving way), a close in a drawer's container shuts the drawer instead (`shuts`), and an open drawer's header has a `[×]` that shuts it as `esc` does. The desk is **tiles**: each a kind from the **tile-kind registry** (`src/desk/tile-kinds.ts`: `registerTileKind`, one `TileKind` entry per kind with `make`, `keys`, `actions`, `policy`, `accepts`, `take`, `save`, `revive`, `holdsWork`, `shows`, `follows`, `start`, `describe`, `view`, `previewSource`, and what the desk would otherwise switch on a class for: `press` (a key or click that runs one of its actions: a terminal's ⏎, e and click run `tile.enter`), `takesKeys`, `act` and `tick` (a whole screen in a tile), `whenFree` (a gone kind's tile waits for its program); the built-ins in `src/desk/builtin-tiles.ts`, an extension's kind the same way, `serviceKind` for one the service draws; the desk never switches on a kind's name), built by `makeTile`, named (`tileNameProblem`: never a number or an id), with a link for its opens (PIE-473); every split, tab set and tile has a stable id and the layout a revision (PIE-491: `s` `g` `t`, `rev`, `expected=`), so agents name them by id, not place; the arrangement is a **layout** saved by name (`src/desk/tiles.ts`, PIE-474), where an open with no link lands on the current note. Every operation is an action: `tile.*` (open, close, resize, zoom, float, pin, collapse, …; the older `pane.*` names are declared aliases of them, and `pane.split` is `tile.open` with its own arguments) and `layout.*` `tab.select` (TILE_ACTIONS), a terminal's `tile.type`, `tile.enter`, `tile.leave`, `tile.restart`, `tile.herdr` (its kind's, `PTY_ACTIONS` in `src/desk/pty-actions.ts`); keys and drags only call them. A screen built on the desk is a **screen spec** (next row). A tree is walked one way: the live one by `leaves`, `kidsOf` and a flow's `columnOf`; one as data (a spec, a save) by `savedNodes`, with `leafNames` and `containerKeys` (`src/desk/screen-spec.ts`), never a walk of its own over `kids`, `tabs` and `kid` | `src/desk/screen-layout.ts` (the interface), `src/desk/layout.ts` and `src/desk/flow.ts` (inside it), `src/desk/drop.ts`, `src/desk/tiles.ts`, `src/desk/tile-kinds.ts`, `src/desk/builtin-tiles.ts`, `src/desk/tile-actions.ts`, `src/desk/pane-actions.ts`, `src/desk/panes.ts`, `src/desk/desk.ts` |
| make a screen (the welcome, the brief, Waiting, a pinned page, the desk itself) | a **screen spec** (PIE-515, `ScreenSpec` in `src/desk/screen-spec.ts`): plain data, on the **desk, the only screen host** (final: nothing subclasses it; `test/screen-spec.test.ts` checks). A spec is its layout (`LayoutSpec`: containers with policy, tiles by kind with their names, args and links; the screen's own policy says where the host layer may appear, `host`), a key map naming actions (`keys`: each a key, the action it runs as the person and its args, `unless`/`only` focused kinds; tried before the focused tile's own keys, never while the person types), a hint row (`hint`: one, or one per focused tile's kind, `float` and `spine`), a band across the top drawn by one of its tiles' kinds (`band`: the kind's `band` hook), the glyphs its frames use (`frame: dotted`), whether the digits are its own (`digits: false`), where the keys go back to (`home`: a tile or a container's key; `esc` and `q` step back there first), where an agent's open lands (`lands`: a tile whose kind's `take` takes it its way, or a container opens land in) and what an open fresh runs (`fresh`: an action), whether it keeps its layout (`saves`) and loads named layouts (`layouts`, the desk's). What a screen does beyond layout is its tiles' kinds' (`src/desk/tile-kinds.ts`): a screen's model lives in one of its tiles (the welcome's list knows the welcome notes and draws the band; the brief's reader knows the briefs; Waiting's list), its actions are that kind's actions (routed to the one tile of the kind), and `peek` gets what the kind says (`peek`). Opens follow the open rule in policy (`opens: beside`: a reader beside the tile, the brief's and a pinned page's kind policy) and links (a tile may link to itself: the welcome's preview). `specData` writes a spec as data and `readSpec` reads it back checked (screens as notes, gap 4, store this shape); `registerScreen`, `screenSpec`, `openScreen` (`src/desk/screen-specs.ts`) name and make them. A tile the host makes itself (the showcase's exhibits) is given by name (`new Desk(spec, { given })`) | `src/desk/screen-spec.ts`, `src/desk/screen-specs.ts`, `src/desk/desk.ts`, `src/desk/delivery.ts`, `src/desk/lanes.ts`, `src/hub/welcome.ts`, `src/brief/brief.ts`, `src/hub/waiting.ts`, `src/hub/pinned.ts` |
| add a kind of tile (a built-in, or an extension's whole tile); fill a container from data | the tile-kind registry (PIE-505): `registerTileKind` with one `TileKind` entry (`make`, `keys` under `^W o`, `actions` routed by `act`, a default `policy`, `accepts` notes or tab kinds, `take` (how it takes a note sent to it: a reader holds it, a preview follows it), `follower`, `save`/`revive`, `holdsWork`, `shows`, `follows`, `start`, `describe`, `view`, `previewSource`, `press` (its keys, the same on every screen: a terminal's ⏎ and `e`, a river column's `h l w p x g`; never while the person types; a screen's key map is only for keys that are the screen's own), `takesKeys`, `act`, `tick`, `whenFree`; `inherits`: another kind's action sets it shares); a saved tile of a kind not registered here is an `UnavailableTile` that says why (not loaded yet, or its extension removed: `unregisterTileKind(kind, why)`) and keeps its spec, and the desk makes it again when the kind comes (`watchTileKinds`, `kindsChanged`, `Desk.kindsChanged`); the built-ins register at startup, an extension's the same way; `serviceKind` makes one the service provides: rows it draws (`render`, a `ServiceTile`), or a program it names (`program`, a `ProgramTile`: a terminal tile of that kind with the terminal kind's hooks and actions, its args saved as `state` and passed as `--name=value`, a `block` arg defaulting to the note shown where it's opened). The service's `tileKinds` register through it (src/extensions.ts). The `query` kind (PIE-511, `QueryPane`): a saved view's cards with its own cursor (`query.pick`, `query.reload`; `^W o q` on a tile showing a view), a board lane on the board. A **tile source** (`registerTileSource`: `tiles`, `affects`, `key`) supplies a columns container's tiles. The desk and the layout never switch on a kind's name | `src/desk/tile-kinds.ts`, `src/desk/builtin-tiles.ts`, `src/desk/query.ts`, `src/extensions.ts` |
| run a program beside the notes (nvim, claude, a shell) | the terminal tile (PIE-417): a pty from the `PtyBackend` (`Bun.Terminal` in this process, or a session's terminal host, so it outlives the daemon: never `Bun.Terminal` directly), the screen through `@xterm/headless`, drawn in cells; keys go to it while the person is in it, `ctrl+]` leaves, encoded as the program asked (`KbdModes` in `src/kbd.ts` follows its Kitty keyboard protocol requests; the same module reads the door's own terminal's reports in `Term`); the mouse goes to it when it asked. `ctrl+e` edits a draft in one (`Ctx.editInTile`). The program is told its door (`EP0CH_CONTROL`, the door's own control socket) and its tile (`EP0CH_TILE`, `EP0CH_TILE_ID`); its environment is `tileEnv` (one list of what a tile's program doesn't get; `HERDR_VARS` is the one Herdr list for tests and scripts). What every agent is told about its door is `agentVars` (`src/desk/agent-env.ts`), the one function for a tile's program, the drawer's and the Herdr launcher's pane alike; what a running agent knows (its own environment and start against the installed Claude mod) is `judgeAgent` there, read by the drawer's chip and `ep0ch doctor`. Where a program runs, the layers outside it, is `EP0CH_NEST` (`src/nest.ts`: each layer appends itself), checked by `ep0ch where` (`src/where.ts`, over `peek` and read-only `herdr pane list`). An agent that should outlive the door runs in a Herdr pane the tile attaches to (`scripts/door-agent-herdr.ts`: Herdr's attach in the tile, no second terminal; it says so with `tile.herdr`). An agent that stays with the person on every screen is the App's one agent tile (`AgentDock`, PIE-498), the first tab of the host layer's drawer (PIE-513: `hostLayer` on the layout engine, above every screen, no copy on any screen): the status bar's chip pulls it up over a screen's lower rows (nothing reflows) or beside it (the screen drawn shorter), as the screen's policy `host` says; `host.toggle`, `host.size`, `agent.type`, `agent.knows`, `agent.restart` (DOCK_ACTIONS) on every screen | `src/desk/pty.ts`, `src/surface/editor.ts`, `src/desk/herdr-agent.ts`, `src/desk/agent-env.ts`, `src/nest.ts`, `src/where.ts`, `src/dock.ts` |
| follow a tile's selection or a file in a reader | the preview tile (PIE-473): a `ReaderPane` (the note surface, no second renderer) with a source, `tile:<name>` or `file:<path>` (re-read on save, read-only) | `src/desk/preview.ts` |
| put a whole screen in a tile (the board, the river; the brief is its own tile kind, `^W o f`, since it is a spec; a screen made for the current note as it moves, `Follows`: the showcase's BBS reader) | `ScreenTile` over the showcase's `FramedScreen`: the screen itself in a rectangle, its selection the tile's; kept in memory (`openScreen(…, { persist: false })`: the screen owns its save, `delivery.json` the board's, and the desk saves the tile) | `src/desk/screen-tile.ts`, `src/showcase/frame.ts` |
| squeeze a tile to a title strip | the spine part: `drawSpine`, `SPINE` (rotated title under Kitty, stacked letters in cells, marks) | `src/spine.ts`; river columns, board lanes and readers |
| show children, outlinks, backlinks, resources, or go back and forward | entity navigation (PIE-432); today `u` and link selection in the surface, `references.backlinks`; history (PIE-453): each reader's back and forward in the surface (`track` records a follow, `u` or an open into it; `travel` restores the note, scroll and `[ ]` position; `back`/`forward` actions; alt+← alt+→, backspace, the mouse's side buttons, the `← back` row), or the view's own through `SurfaceHost.history` where a follow opens elsewhere; backlinks presented as Detail presents them (PIE-442): `backlinkView` and the panel's text in `src/backlinks.ts`, Detail's `backlink-view.ts` over the service's facets, mirrored and parity-tested (`backlinkRows`, `backlinkStatusParts`, `describeBacklinkView` for agents), drawn by `backlinkRowLine` and `layoutBacklinkStatus` (the board's drawer and the backlinks tile, one drawing); the **backlinks tile** (`BacklinksPane`, kind `backlinks`, `^W o l`): the backlinks of what another tile shows (`source: tile:<name>`, through `DeskApi.tileShowing`), its selection shown where the tile's selection goes (`DeskApi.showFrom`: the previews following it and its link, never the current note, so the reader it lists stays put) as it moves and when the tile is given the keys (`Pane.focused`), `backlinks.pick` and `backlinks.view` (BACKLINKS_ACTIONS); a row's **links in the tree** (the outliner's Tree's authored links, PIE-324, PIE-329): `L` (`tree.links`, TREE_ACTIONS) shows under a row its outlinks and resources (the service's `blocks.authored-links`, laid out by `src/authored.ts` in the Tree's words) and its backlinks (the same `backlinkView` and `backlinkRows`), each group folding, a link to a note showing its own a level down; ⏎ or a click (`tree.pick`) opens a note where the tree's opens go, and on a resource shows its stored content as a read-only note (`openResource`: `resources.follow-authored` when it isn't registered, `resources.describe`, `resources.refresh` once when nothing is stored). A resource token in a reader (`[file::…]`, `[jira::KEY]`, as the service's spans name them, `resourceTokensOf`) is a link that does the same | `src/surface/note.ts`, `src/socket.ts`, `src/backlinks.ts`, `src/desk/backlinks-pane.ts`, `src/desk/tree.ts`, `src/authored.ts` |
| show who's here or recent activity | presence (PIE-430); today `WhoPane` and `ActivityPane` over `clients.list`, `activity.recent` | `src/desk/panes.ts` |
| put live data in a note | live figures, which read views with `views.read` | `src/live.ts`, `src/views.ts` |
| show a Resource's stored details in a note (a ticket under `jira::`, a ticket page) | resource projections (PIE-445): `projectionsOf` asks the service (`resources.projection.read`, capability `resources.projection`; with `resources.projection.materialize` the read is the one step, and the service fetches in the background what isn't fetched or is stale), the surface draws each region after its line through `DocEnv.after`, and `resource-catalog` events repaint the ones shown. A ticket the Jira extension keeps as a block (the projection's `record`, capability `extensions.records`; one block per key, so every note whose line asks for it draws that same block, and its age refreshes through it) is drawn from that block by `ticketRegion` (head, `jira.*` fields, age, body, comments; on the ticket block itself, its header on top and its comments after the body), read through `ticketBlocksOf`; one without a record is `projectionLayout`, Detail's `resourceProjectionLayout` as drawn (parity-tested). `r` or a click on the age is `projection.refresh` (`resources.projection.refresh`, any client); ⏎ on a ticket's title opens its block. The door never registers or contacts a provider itself, and never keeps a table of what refreshes (a Resource's `capabilities.refresh` says). An extension's line (PIE-507: the projection's `kind`) is the same slot: a record (`data`) is drawn by `ticketRegion` from its block, its fields the handler's; an output, a component or an `@name` request by `extensionRegion` (the output's Markdown through the reader's own `renderDoc`, a component's view through `primitiveLines`, an agent's state and reply), with a row of controls (its actions and `r`) | `src/projection.ts`, `src/surface/note.ts`, `src/doc.ts` |
| bind an extension the service runs (its handler lines, its actions, its tile kinds), and draw a rich component's view | the extension binding (PIE-512, `src/extensions.ts`): `loadExtensions` reads `extensions.list` at start and on every `extensions` event (hot reload) and `bindExtensions` binds it: the handler keys and `@name` agents `mayHaveProjections` asks about (`mentionsExtension`), each line or block action as an `ActionDef` in `EXT_ACTIONS` (`ext.<id>.<action>`, on every screen; `ActionSet.define`/`forget`), each tile kind through `serviceKind` with its actions as the kind's own set (a block action a tile lists is in `EXT_ACTIONS` too). Every action runs `extensions.act` (`runExtensionAction`) with who asks (`mutation`); the service writes as `ext:<id>` and records who asked as `requestedBy`. Only the service writes as `ext:<id>`: an `--as ext:…` is refused, and a draft only an `@agent` changed saves as the person's, naming it (`Draft.recordAs`). On a line, the reader's key, a click on its control and ⏎ on its title run the action (`handlerKeyAction`, never one of `READER_OWN_KEYS`). A component's view is drawn by `primitiveLines` (`src/components.ts`): the service's catalogue (card, box, stack, row, text, badge, stat, bar, table, checklist, sparkline) as terminal lines with tone as colour, a card's or a table row's block tagged as a link; `PrimitiveUnknown` sends the reader down the fallback chain (the line's Markdown, then its data) | `src/extensions.ts`, `src/components.ts`, `src/projection.ts`, `src/surface/note.ts`, `src/desk/tile-kinds.ts` |
| move through what a reader draws, or point someone at a block | elements and the reading ruler (PIE-441): `[ ]` over the surface's element list (links, folds, figure rows, embeds, resource projections, comment marks, an expanded thread's controls, checklist steps in the note and inside embeds), ⏎/alt+⏎/click through `enterElement`, `RULER_BG`; a comment mark expands its thread under the passage (PIE-420: `expanded`, the person's reading state like `folded`; drawn as body rows; its Select, Reply, Resolve controls act through `CommentSession`, the thread list's code); an agent's focus mark (`block.tint`) is the same tint. Hosts decide where a link opens from `SurfaceHost.navigate`'s `OpenHow`. A checklist step is an element too (PIE-472): its box is tagged (`task` in `DocEnv`) where the service's `checklist.query`, or an embed's projection, says a step is; ⏎ or a click opens its status choice (Detail's choices, `STEP_CHOICES`), drawn as body rows under it like an expanded thread; every change is `NoteSurface.changeStep` through `checklist.update` with the actor's provenance, Undo is `StepHistory`, and agents use `tasks`, `task.status`, `task.undo`, `task.link` (the board's steps overlay, `s`, is a card-level list over the same service calls). A tile-level attention mark is `block.mark` (a `MarkStore`, door-local until PIE-423's service store): framed and labelled in every tile showing the block, an extmark in an nvim tile | `src/surface/note.ts`, `src/surface/selection.ts`, `src/steps.ts`, `src/desk/marks.ts` |
| select or copy text a reader draws | the selection model (PIE-419): `Selection` over drawn rows, `Gesture` (press, drag, release, double/triple click; `release().copy` is copy on select, `copyOnSelect()` reads `EP0CH_COPY_ON_SELECT`), `modeKey` (`v`), `isCopyKey` (cmd+c), `paintRange`, `osc52`; the surface hosts it (`press`/`drag`/`release`, `y` `Y` cmd+c, `select*` actions), and so does the river over its own rows. Every copy reaches the clipboard through `Ctx.copy` (`App.copy`: OSC 52 and the "copied to clipboard" toast); a draft's selection through `draft.copy` | `src/surface/selection.ts`, `src/surface/note.ts` |
| put text on the terminal: measure it, pad it, cut it, keep escapes out, draw it in the font it has; colour it | terminal output (PIE-510): colours through the theme (`src/theme.ts`): `fg`/`bg` by palette entry (`C.*`, `paint`'s `|NN`), `tint(name)` for the backgrounds that aren't entries (a selection, an agent's, the ruler, a thread, an embed, an idle row) and `selected(keys, idle)` for a list's selected row, its background and text (lit while the list has the keys, the idle tint while not; never a list's own `SEL`), `dim(s)` for quiet text, `chip(bg, fg)` for a label on a colour (its text chosen to read), and `themed(f)` for a colour string made once at load; never a raw `\x1b[38;2;…` (art alone is drawn in `VGA_RGB`: `artLines`, `rasterize`); `width` counts terminal cells (`Bun.stringWidth`), `graphemes` and `glyphWidth` step glyph by glyph, so `pad`, `headOf`, `ellipsize` (cut to a width with `…`, no padding: a title, a quote, a label; never `.slice(0, n) + "…"`), `wrap` and the `Canvas` never split a wide or joined glyph (the canvas gives a wide one two cells); a hint row of parts joined by ` · ` is cut by `fitHint` (between parts, else at a space; the desk's row ends `? more`, a frame's edge ` …`). Text from anywhere (a title, an extension's words, an error) goes through `printable`, the one stripper; the canvas and the row writer (`rowBytes`) apply `paintable` at the sink, so only the door's own SGR reaches the terminal. A frame goes to a **`Display`** (`src/display.ts`): `App` renders the lines and Kitty placements once, and a `Painter` per terminal draws them in that terminal's video mode (its rows diffed by `Rows`, its images by its own `KittyLayer`); the door's own terminal is one Painter, a session's clients one each. Under kitty+crt (a CP437 font) the Painter sends each glyph the font lacks as its lookalike (`toCp437Glyphs`, `CP437_NEAREST`), the table the snapshot mirror draws from, and the tube under the text; a new glyph needs a lookalike there (`test/terminal-output.test.ts` scans for one without). Keys come from a `KeyDecoder` per terminal (`src/term.ts`) | `src/style.ts`, `src/text.ts`, `src/canvas.ts`, `src/term.ts`, `src/display.ts`, `src/ansi.ts` |
| know anything the service can answer | ask the service: `views.read`, `blocks.read`, `properties.preview`, `changes.since`, `references.*`, `views.planWrite` (what a move into a lane patches, what a new card there is born with), `query.matches` (which results a query holds for: a live figure's, the river filter's property clauses; only a bare word and `author:` are the column's own), gated by `Capability`. Where a call per paint is too slow (finding `[key::value]` tokens in titles, digests, metadata lines, colour), the outliner's own property grammar, copied byte for byte and checked (`test/grammar.test.ts`; `ping` reports its version): `withoutPropertyTokens`, `isPropertyTokenLine`, `propertyTokenPattern`, `PROPERTY_KEY_SOURCE`, never a local regex. Its socket, the door's control socket and their clients talk newline JSON through one module: `jsonLine` writes a value, `JsonLines` reads them as chunks arrive (decoded as a stream, a line past a limit refused), `ask` sends one request and resolves to its answer or null (`ep0ch act|peek`, `ep0ch where`, the Herdr agent telling its door), `listening` is the one liveness probe (a control socket, the session's, its terminal host's: no answer in time is taken, never free); never a `buf.indexOf("\n")` of its own | `src/socket.ts`, `src/move.ts`, `src/vendor/property-grammar.ts`, `src/jsonl.ts` |
| keep the door running without a terminal: quit detaches, attach again (`ssh`, another machine, an agent watching), several terminals at once | the **door session** (PIE-418, `src/session/`): one daemon per user and state dir holds the App (screens and layouts, the dispatcher, draft sessions, terminal tiles with their programs and scrollback, the service connection and its change feed) and serves `session.sock` (0600 in the 0700 state dir) beside the control socket. A client (`ep0ch`, `ep0ch session attach [--watch]`) only owns its terminal: it probes it, sends what it types and its size, writes what it's sent, runs a program the session hands it (`Handover`: the drop shell, `$EDITOR`). The session sends **frames, not state**: `SessionTerm` is the App's terminal and a `Display`, a `Painter` per client (its own size, video mode and Kitty images), the keys wherever the person last typed (the session drawn at that terminal's size, tmux's `window-size latest`). Quitting (`G`, `ctrl+c`, a closed terminal, a dropped ssh) detaches (`Ctx.logoff`); `session.end` (`E` on the main menu, `ep0ch session end`) ends it. A terminal tile's program outlives the daemon too: it runs in the session's **terminal host** (`src/session/pty-host.ts`) through the `PtyBackend` seam (`src/desk/pty-backend.ts`; the door's own terminal uses `localPtys`), and a new daemon (`ep0ch session upgrade`, or after a crash) adopts it by its tile (`PtyPane.keptAs`). What else it restores is a checkpoint (`src/session/restore.ts`): the screens open as the actions that open them, run again only where the action declares `replay: "safe"`, and the edits open on top (`Screen.reopen`); each screen's layout is its own saved state, never replayed. Don't add a second way to keep programs alive past a terminal, or a second restore: a new thing that must outlive one lives in the session, and a new kind of state comes back through an action that declares its `replay` | `src/session/daemon.ts`, `src/session/client.ts`, `src/session/session-term.ts`, `src/session/protocol.ts`, `src/session/pty-host.ts`, `src/session/restore.ts`, `src/desk/pty-backend.ts`, `src/door.ts` |

- **Don't copy the parallel versions:** the `colourBody` bodies left in the desk's search preview and
  the river's cards (F1), the river's pane code (F2), the extra searches (F6).
- **Don't re-derive meaning the service owns** (view membership, property parsing, query evaluation,
  what a write into a view must change, backlinks, what changed); never compute it here. The door needs every
  capability it names (`OUTLINE_CAPABILITIES`) and refuses an older service. Where a call per paint is too slow, use one module
  the outliner owns (`src/vendor/property-grammar.ts`), never a copy of its rule.
- **If the part doesn't exist yet or doesn't fit:** extend it, or write down why not in the PR.
  A new shared part gets a row here in the same PR.
- **Every row has a showcase section** (`scripts/try-it.sh --showcase`, PIE-439), in this table's
  order: `SECTIONS` in `src/showcase/showcase.ts`, drawn by the part itself. A new row gets its section
  and the seed content it needs (`src/showcase/seed.ts`) in the same PR, and a parallel version shown
  beside it until consolidation removes it.
- Name things with the glossary's canonical words (§1).

## TL;DR

- **One reader.** Board, desk, river and the BBS message reader (`MessageReader` `scr:273`, PIE-426)
  host `NoteSurface`; the BBS one keeps its header through `SurfaceHost.header`. `colourBody` still draws
  the desk's search preview and the river's cards (lists, not readers).
- **Tile operations exist twice.** The desk and the board are one engine (PIE-511): the board is a screen spec
  on the desk (PIE-515), its lanes query tiles in a columns container, its drawers and floats the desk's, its keys
  a key map naming the desk's tile actions (`x`, `o`, `T`, `B`, `{ }`). The river is one too (PIE-515): its columns
  are tiles in a flow, its `w` `p` `x` and back and forward the engine's tile actions.
- **One dispatcher per screen host (PIE-514).** Keys, clicks and `act` all run actions through it; `tile=` has
  one grammar everywhere, and whether an agent may is read from each action's declared `touches` against one
  whereabouts query, not decided screen by screen.
- **Agents can arrange the desk and the board.** Note actions are shared everywhere, and the `tile.*`
  actions (open, close, resize, zoom, float, pin, collapse) are shared by the desk
  and the board. The river has
  its own column actions. The BBS message reader has the note actions and its own `message.*`; the
  menu and every screen have the shell's `screen.*`, and the BBS lists `list.*` (PIE-489).
- **Words collide.** "Reader", "pin", "preview", "detail", "region" and "spine" each mean two
  things, and the door's "detail" is the outliner's *Current*, not its *Detail*.
- **Entity navigation is still in several places.** Backlinks are one drawing (`src/backlinks.ts`) in the
  board's drawer, the backlinks tile, the welcome and the tree's `L`, which also lists a row's outlinks and
  resources (PIE-324's Tree view). Readers have back and forward (PIE-453). Children still appear in three
  shapes, and there is no connections screen (PIE-432).
- **Duplicates.** Four searches, two Who's Online views, two activity views. The BBS `Search`
  screen (`scr:338`) is unreachable.

## How to read the citations

| Alias | File |
|---|---|
| `app` | `src/app.ts` |
| `scr` | `src/screens.ts` |
| `dsk` | `src/desk/desk.ts` |
| `pan` | `src/desk/panes.ts` |
| `lay` | `src/desk/layout.ts` (the tree arithmetic inside the screen-layout module) |
| `sl` | `src/desk/screen-layout.ts` (the screen-layout module: `apply`, PIE-513) |
| `flw` | `src/desk/flow.ts` (the flow container, inside the module) |
| `del` | `src/desk/delivery.ts` (the board's spec) |
| `lns` | `src/desk/lanes.ts` (the board's lanes: the hub source's model) |
| `riv` | `src/river/river.ts` (the River screen before PIE-515; now `src/river/column.ts`, a tile kind and a spec) |
| `note` | `src/surface/note.ts` |
| `ed` | `src/surface/editor.ts` |
| `act` | `src/surface/actions.ts` |
| `pp` | `src/surface/props-panel.ts` |
| `cmp` | `src/surface/completer.ts` |
| `sel` | `src/surface/selection.ts` |

`del:1799` means line 1799 of `src/desk/delivery.ts` at the time of writing.

---

## 1. Glossary

**Canonical** is the word to use from now on. **Aliases** are what the code or README also
calls it. **Tree/Detail** is the pi-herdr-outliner equivalent (or "none").

### Shell

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| shell | Screen stack, status bar, key routing, agent entry | `App` `app:72` | Herdr |
| screen | One full-canvas mode on the stack | `Screen` `app:42` | a Pi pane |
| menu | The screen that opens other screens | `MainMenu` `scr:132` | `?` action list |
| status bar | Last row: screen, host:workspace, offline, video | `app:242` | Herdr frame title |
| flash | A 4-second message in the status bar | `flash` `app:116` | expiring receipt |
| agent drawer | The host layer's drawer (PIE-513), its first tab the App's one agent tile, pulled up over (or beside) any screen from the status bar; the agent has no tile on any screen (the dock's first slice was PIE-498) | `AgentDock` on `hostLayer` (`src/dock.ts`) | a Herdr pane |
| drop to shell | The BBS's drop to DOS: the door steps aside for the person's login shell and comes back where it was on `exit` (`screen.shell`, the person's only); in a session, in the terminal of the client with the person's keys | `screen.shell` in `SHELL_ACTIONS`, `runLoginShell` and `Handover` (`src/drop.ts`), `App.suspend` | none |
| session | The door kept running without a terminal (PIE-418): one per user and state dir, holding the screens, layouts, drafts and terminal tiles; ended only by `session.end` (`E`, `ep0ch session end`) | `src/session/daemon.ts` | a Herdr session |
| client, attach, detach | A terminal showing a session: `ep0ch` attaches (starting the session when none runs), quitting detaches (`G`, `ctrl+c`, a closed terminal); several at once, the keys wherever the person last typed; `--watch` is read-only | `src/session/client.ts`, `SessionTerm` | Herdr's attach, `ctrl+b q` |
| nest | The layers a program runs in, outermost first (`ssh:pts/5 › door:<pid>/desk/t1:claude`), each appended by the layer that starts the next; `ep0ch where` checks each | `EP0CH_NEST`, `src/nest.ts`, `src/where.ts` | none |
| chip | A label on the status bar that stands for something docked there (`▲ claude`); a click pulls it up | `AgentDock.chip` | none |
| hint row | Key help above the status bar | `dsk:210` `del:1450` `riv:397` | menu row |
| workspace | The outline connected to (one per run) | `ctx.workspace`, `--ws` | workspace |
| video mode | Kitty+CRT, Kitty, cells (`V`) | `cycleVideo` `app:118` | none |

### Layout: block, tile, container, screen

The layout vocabulary, settled on Oct 1. The design is the outline note "Screens are layouts: one tile system"
(linked from PIE-493 and PIE-498). New code and docs use these four words. Where the code still says
pane, region or column, the table below says what it is today.

| Word | Meaning |
|---|---|
| block | Content in the outline. It is data, never UI. |
| tile | A UI leaf that shows one thing: a block, a query, a terminal, a component or a tree. Its kind comes from the tile-kind registry (`src/desk/tile-kinds.ts`), where built-ins and extensions register the same way. |
| container | Holds tiles or other containers and decides how they're arranged: `split` (side by side or stacked, resizable), `tabs` (stacked, one visible), `columns` (side by side in the order their source gives, each its own weight), `drawer` (slides out over the others from an edge and takes drops; `Drawer` in `src/desk/layout.ts`, PIE-505), `flow` (columns where opens go into the next one, each full, peek or spine around the wide one; the river's; `Flow`, PIE-513). All five are built; the river screen ports onto `flow` next (PIE-515). |
| policy | What a container allows, saved with the screen: draggable, droppable, closable, `accepts: [tile kinds]`, resizable (`min`, `max`, `fixed` cells), collapsible, overlay (and its edge), `locked`, `opens-into` (`opensInto`: a tile, or a container's key where opens land in tiles opened there), `keep` (how many of those it keeps), `shuts` (a close in it shuts its drawer), `opens` (the open rule: `current`, or `next` for a flow, a flow's own when it says none). The screen has one too, outermost: `locked` there is the screen's lock (`alt+k`, the `▣ locked` chip, `layout.lock`). `Policy`, `effective` in `src/desk/layout.ts`, checked inside every operation of the screen-layout module; set by `layout.policy` or `^W P`. |
| host layer | Above every screen, kept across screen switches (Evan, Oct 1): the agent, the admin outline and detail, terminals; later a shelf for bundles in transit. A layout like any other, changed by the same operations: one slot for the screen shown (`HOST_SCREEN`) beside a real drawer of tabs. The person's keys move through the drawer's own transitions (pulled up by the person: to its tab; put away: back to the screen as they left it). The screen's policy `host` says where it may appear: `beside` (the screen narrower or shorter), `over` (a drawer, the default), `none` (a full-screen screen). The drawer's verbs are `host.*` (`host.toggle`, `host.size`, `host.enter` into the tab it shows); the agent's own are `agent.*` (`agent.type`, `agent.restart`, `agent.knows`). `hostLayer`, `placeHost` in `src/desk/screen-layout.ts`. |
| screen layer | The screen shown (board, desk, river, reader, LORD): swapped per screen, each as small as it was designed. |
| layout operation | One change to a screen's layout, applied for one actor as one transaction by the screen-layout module: the new state or a refusal with its reason, nothing done (PIE-513). The only way a layout changes; keys, clicks and `act` reach it through actions. `Op`, `apply` in `src/desk/screen-layout.ts`. |
| screen | A **screen spec** on the desk, the one screen host (PIE-515): its containers and tiles, a key map naming actions, a hint, a band, where opens land. Board, desk, river, welcome, waiting and brief are all screens; the desk, the board, the welcome, waiting, the brief and a pinned page are specs (the river too, since PIE-515), plain data a note can hold (gap 4). Today a screen's layout is saved in the door's state (`desk.json`, `delivery.json`, `layouts.json` by name, §3's persist row); storing screens as notes in the outline is the planned PIE-412 step (gap 4). |
| pane | Not a door word. It means Herdr's or tmux's compositor box. The door's code still names a tile's class `Pane` (`ReaderPane`, `PaneView`, …), a rename left for later; `pane.split` is the one `pane.*` action left, and `tile=` names a tile in `act`. |

### View and tile

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| view | What a screen arranges: board, desk, river, BBS list | each `Screen` | Tree / Detail |
| tile | A framed rectangle that shows one thing and takes focus: a kind from the registry (outline, reader, detail, preview, terminal, board, river, brief, an extension's, …) with a name, dragged by its header (Layout, above) | the class `Pane` in the desk's tree (`pan:28`), `TileKind` `src/desk/tile-kinds.ts`, `makeTile` `src/desk/tiles.ts` | Herdr pane |
| — alias: region | Gone (PIE-511): the board's areas are tiles with names (`preview`, `detail1`, `tree`, a lane's) | — | *collides:* PreviewRegion |
| — alias: column | A river strip; stacked tiles inside. On the engine: a column of a `flow` (PIE-513), a tile or tiles stacked in it | `Col` `riv:69` `PaneS` `riv:28`; `Flow` `lay`, `flw` | none |
| layout tree | Containers (splits by weight, tab sets, drawers, columns, flows) over tile ids, each with its policy; floats above it; changed only by the screen-layout module's operations | `LNode` `lay`, `LayoutState` `sl` (the desk and the screens built on it, the board one of them; the river next, as a flow) | none |
| tab set | Tiles stacked in one place, one shown; the header shows the tabs | `Tabs` `lay` | none |
| header | A tile's top border: its number and name (or its tabs), what it shows, `→ link`, `⇤ drawer` (the arrow is its edge: `⇤ ⇥ ⤒ ⤓`). Its title or tabs are the grip: drag them to move the tile. The bare line after them is the border above, so dragging it resizes the tile (a header with no border above is all grip) | `header` `dsk` | pane title |
| drop | Where a dragged tile lands: tabs (a header or a centre), a split (a triangle), an outer edge; outlined while dragging (the ghost) | `dropAt` `src/desk/drop.ts` | none |
| link (a tile's) | The tile a tile's opens land in (PIE-473): a followed link, the outline's `⏎`; set by `alt+l` then a click | `links` `dsk`, `tile.link` | linked pane (Herdr alt-l) |
| layout (named) | The tile tree with each tile's spec, links, drawers and open rule, saved by name | `LayoutSpec` `src/desk/tiles.ts` | none |
| open rule | Where an open with no link lands: the current note (`current`), or the next column of its flow (`next`). It's policy now (PIE-513): a container's `opens`, a flow's `next` when it says none; a layout's `rule` is read as the screen's | `opens` in `Policy` `lay`, `landing` `sl` | none |
| terminal tile | A program in a pty the door owns; the person is *in* it (like entered) until `ctrl+]` | `PtyPane` `src/desk/pty.ts` | Herdr pane |
| focus | Which tile gets the keys | `focus` in each screen | pane focus |
| entered | You are *inside* a reader's edit, comment or panel | `Entered` `pan:287` | draft focus |
| zoom | One tile fills the screen | `tile.zoom` (`^W z`): the desk and every screen on it, the board too (#98) | Herdr zoom |
| float | A tile taken out of the tree to its own rectangle, above everything (`tile.float`, the board's `o`, `^W f`); its title drags it, its ◢ corner sizes it, a click on the `⧉` before its title docks it | `Desk.floats`, `ScreenLayout.floats` `lay`, `float.place` | none |
| drawer | A container sliding over the others from an edge (PIE-505): on the desk any tile or tab set put in one (`^W p`, `tile.pin`, at an outer edge with `edge=`), holding anything moved into it (a drop on its handle, a move beside a tile in it); shuts when the keys leave (unless `collapsible` or `overlay` is off, or it `stays`); a shut one is a handle at the end of the hint row (`⇤ tree+now`, or a named container's name: the board's `⇤ outline`, `⤓ links`). The board's outline (the tree over its preview, a left drawer) and backlinks (the list beside its preview, a bottom drawer that stays) are desk drawers | `Drawer` `lay` | none |
| lock | The screen's shape fixed for a task, its contents live: nothing moves, drops, opens as a new tile, closes, resizes, goes in or out of a drawer, relinks or loads; reading, editing, terminals, drawers sliding, tabs and zoom go on. Saved, so it comes back after a restart | `layout.lock` (`alt+k`, the hint row's `▣ locked` chip), `Policy.locked` | none |
| spine | A tile folded to a title strip (`tile.collapse`; the board's `c` on a lane or a reader) | `drawSpine` (`src/spine.ts`), `Desk.collapsed`; river `Cover` `riv:48` | none |
| lane | A saved view shown as a board column: a query tile in the board's columns | `QueryPane` (`src/desk/query.ts`) | virtual branch |
| card | One block in a lane | lane items | branch root row |

### Reading and editing (the note surface)

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| reader | Any tile or screen hosting a note surface | `ReaderPane` `pan:184`, `MessageReader` `scr:273` | Detail |
| note surface | Draws, folds, edits, comments on a note | `NoteSurface` `note:107` | Detail body |
| mode (a reader's) | What takes a reader's keys besides reading: a step's status choice, the property panel, the edit, the comment session; open ones form its mode stack, in a fixed precedence | `ReaderMode`, `ModeStack`, `PRECEDENCE` (`src/surface/modes.ts`) | edit mode, inspector |
| surface host | What a view gives it: ctx, redraw, navigate, and maybe its own header rows | `SurfaceHost` `note:43` | none |
| preview | The reader that follows the selection; on the desk, a preview tile follows a source (a tile, a file) | board `preview`, `PreviewPane` | **Preview** |
| detail | A reader opened on purpose (`⏎`), keeps its note | `openDetail` `del:521` | **Current** |
| header | Title, crumbs, summary line, notices | `render` `note:268` | menu row + title |
| summary line | Chosen properties under the title | `summary` `note:366` | summary keys |
| property panel | Every property token, editable | `PropertyPanel` `pp:85` | property inspector |
| edit control | Frame + status + keys for any draft | `renderEditor` `ed:25` | Detail edit mode |
| draft | Unsaved text with its base revision | `Draft` (`src/edit.ts`) | draft |
| draft session | One draft's lifecycle: open (restoring), type, write or leave, put aside, the hold, the agent rule | `DraftSession` (`src/draft-session.ts`) | none |
| target adapter | Where a draft session writes: a block's text, a comment or reply, a new card or child | `blockTarget`, `commentTarget`, `cardTarget` (`src/draft-session.ts`) | save, comment, capture |
| unsent (put aside) | A draft closed with its text (esc twice, a screen closed, the door quitting, a refused click away): kept where it was written, copied to `drafts/`, brought back by opening the same draft | `shelve`, `unsent`, `DraftSession.open` (`src/draft-session.ts`) | none |
| invitation | The person's `@name` line in their own draft: that agent may reply once with new text for the lines above it (a seam; not wired to an action yet) | `DraftSession.invite`, `reply` (`src/draft-session.ts`) | none |
| composer | Board draft for a new card or note: a draft session with the card adapter, drawn over the board | `Composer` `del` | Quick Capture (close) |
| comment session | Passage picker, comment, threads | `CommentSession` | passage comments |
| completion | `[[`, `((`, `[file::` popup | `cmp`; wired at `note:592` | completion |
| fold | Folded heading or list item (reader state) | `note:835` | Folding |
| selection | Text selected in a reader (reading state). One made with the mouse is copied when the button comes up (copy on select, as Herdr's `ui.copy_on_select`; `EP0CH_COPY_ON_SELECT=0` turns it off); `y`, `Y`, cmd+c or the copy control copy it any time. An agent's is never copied to the person's clipboard | `Selection` `sel:52` | text selection |
| element | What `[ ]` stops on in a reader: a link, a fold, a figure row, an embed, a resource projection, a comment mark, a checklist step; one is current | `elements` `note` | none |
| reading ruler | The tint under the block the current element is in | `RULER_BG` `sel` | none |
| tint | A block (maybe a passage) tinted in the ruler's colour inside one reader, with who set it named; PIE-423's "focus mark". `block.tint` | `block.tint` `note` | focus mark (PIE-423) |
| attention mark | A mark on a block (or an nvim line) with a reason and who set it, framed and labelled in every tile showing it, until dismissed | `block.mark` `src/desk/marks.ts` | focus mark (PIE-423's shared part) |
| embed | `!((id))` transclusion region; `!((id^fragment))` shows the fragment's slice; nested to the service's depth. Drawn quietly: a dim, clickable `» note` source line (`≡ view` for a view) and a dim bar; only a problem heading stays loud | `src/embeds.ts` | generated embed |
| step | A checklist item (`- [ ]`, `[x]`, `[~]`, `[!]`) whose box is a control, in the note or an embed | `task` elements, `src/steps.ts` | checklist control (PIE-367) |
| status choice | The menu a step's box opens: done, to do, waiting, problem, Copy step link, Make addressable | `picker` `note`, `STEP_CHOICES` | status picker |
| resource projection | A Resource's stored details (a ticket: key, summary, allowed fields, status, fetched time and its age) drawn read-only under the `jira::` line that names it, or at the top of a ticket page; ⏎ or a click opens the ticket's page, `y` copies it as drawn | `projectionsOf`, `projectionRegion` (`src/projection.ts`) | resource projection (a Detail region) |

### Entity navigation

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| children | Blocks under a note | `ThreadPane` `pan:299`, river `space`, BBS `T` (`message.thread`) | Tree children |
| up | The parent | `u` `note:766` (the BBS `U` too) | ancestors menu |
| outlinks | Links in the note (`[ ]` steps to them with the note's other elements, `⏎` follows); in the tree, a row's outlinks under it (`L`) | `link.select`, `elements` `note`; `tree.links` | **Outlinks** |
| backlinks | Notes that link here, grouped by kind with Detail's defaults (PIE-442) | board drawer `drawLinks`, `src/backlinks.ts` | **Backlinks** |
| resources | `[file::]`, `jira::`, `img::`, media; in the tree, a row's resources under it (`L`), ⏎ showing what the service stores | completion, `src/media.ts`, `tree.links`, `openResource` (`src/authored.ts`) | **Resources** |
| search | Find a block by text | 4 versions, see §4 | Goto search |
| history | Back/forward through what a reader showed: its note, scroll and `[ ]` position (PIE-453) | `track`, `travel`, `back` `forward` `note`; `SurfaceHost.history` | Detail history |

### Agents and presence

| Canonical | Meaning | Code | Tree/Detail |
|---|---|---|---|
| action | A named, typed thing a key or agent does | `ActionDef` `act:12` | action list |
| action set | Actions for one host kind: note, board, desk, river | `ActionSet` `act:37` | none |
| actor | You or an agent with an id, carried through every open and write it causes (`OpenHow.by`) | `agentActor` `app:66` | author, actorId |
| dispatcher | One per screen host: reads `tile=`, finds the action's set, checks `expected=` and the actor rule, runs it, says refusals and `says` | `Dispatcher` in `src/surface/dispatch.ts` | none |
| touches | What an action declares it reaches (`nothing`, `tile`, `shape`, `draft`, `screen`), with `replay` (`safe`, `ask`): the one actor rule reads it | `ActionDef.touches`, `actorRule` | none |
| whereabouts | Where the person is: the screen, the tile with their focus, the tile they type in, busy, idle, away; the shell's one answer | `App.person()`, `src/whereabouts.ts` | none |
| provenance | "an agent (id) · …" on screen and in writes | `asActor` `act:88` | provenance |
| control socket | `peek`, `snap`, `open`, `actions`, `act` | `src/control.ts` | UI commands |
| presence | Who is attached and what they read | `scr:355`, `pan:411` | client registry |
| activity | Recent edits by user, agent, system | `scr:392`, `pan:375` | none |

### Words that mean two things

| Word | Meaning A | Meaning B | Use instead |
|---|---|---|---|
| Reader | BBS screen `Reader` (now `MessageReader` `scr:273`, a surface host: resolved by PIE-426) | `ReaderPane` `pan:184` | "reader" = any surface host |
| pin | Desk reader stops following `pan:234` | River column resists squeeze `riv:879` | **pin** = a drawer joins the layout (`T`, `B`, `^W p`, or a click on a header's `⇤ drawer`); the desk reader **holds** (`p hold`); a river column **docks** |
| preview | Board reader following the card | Desk `/` search's right half `dsk:404` | A only |
| detail | Door: a reader you opened (*Current*) | Outliner: the Detail pane | owner decides |
| region | Board pane (gone with PIE-511: the board's areas are named tiles) | Outliner PreviewRegion (focusable item) | "tile" |
| spine | River compression tier | Board collapsed lane or reader | fine: same idea, one part (`src/spine.ts`) |
| `alt+⏎` | Board: second detail | Outliner: keep Preview as Current | a link's `alt+⏎` (or a ctrl- or alt-click) opens beside, never in a tile's link (PIE-473) |
| focus | The person's keys: which tile has them (`tile.focus`, `focus`) | PIE-423's "focus mark" | **focus** is only the keys; an in-reader highlight is a **tint** (`block.tint`); a mark with a reason is an **attention mark** (`block.mark`) |

---

## 2. The grammar tree

The proposed tree, refined against what the code does. `[x]` = exists in shared code today,
`[~]` = exists but per screen, `[ ]` = missing.

```
shell                                     App (app:72)
├── [x] screen switcher                   MainMenu + stack; screen.open / screen.back on every screen (PIE-489)
├── [x] drop to shell                     screen.shell: the menu's !, the desk's ^W ! (src/drop.ts, App.suspend)
├── [ ] workspace / outline switcher      one SocketBoard per run (PIE-427)
├── [x] status bar, flash                 app:242, app:116
├── [x] agent drawer (the dock's first slice)  src/dock.ts: a chip on the status bar, a drawer over any screen
├── [~] hint row                          every screen draws its own
├── [x] unsaved guard                     app:108 (asks twice, copies drafts)
├── [x] agent entry: peek snap open act   control.ts, app:151-194
└── view                                  a Screen
    ├── [x] header                        note surface; BBS rows via SurfaceHost.header
    ├── [~] primary content               lanes | layout tree | strip | list
    ├── [x] detail = reader(s)            NoteSurface in every view
    └── [~] hint row
tile operations
    ├── [~] focus (Tab, number, click)    every view, 3 implementations
    ├── [~] zoom                          desk and the screens on it, the board too (#98); tile.zoom; not the river (PIE-428)
    ├── [~] open beside / split           desk ^W o, board alt+⏎, river ⏎/s; tile.open, pane.split
    ├── [~] close                         desk ^W x, board x, river x; tile.close (desk, board)
    ├── [~] resize                        desk drag/^W<>, board drag/{}<>: one tree; tile.resize
    ├── [~] dock / move                   desk: drag a header, ^W m t T H J K L (layout.move, tabs on drop); board float HJKL; tile.float, tile.pin
    ├── [~] squeeze (width tiers)         river full/peek/spine around the wide column (w widens); board lanes, readers c · one spine part
    └── [~] persist layout                the tree to desk.json, delivery.json (same fields); river.json
entity navigation
    ├── [~] children                      thread tile, river replies, BBS T
    ├── [x] up                            note surface u
    ├── [x] outlinks (in-note links)      note surface [ ] ⏎ click; the tree's L lists a row's
    ├── [~] backlinks                     board drawer, backlinks tile, the tree's L (Detail's view, PIE-442)
    ├── [~] resources list                the tree's L: a row's resources, ⏎ shows one (PIE-432)
    ├── [~] search / jump                 4 versions
    └── [~] history (back/forward)        note surface (board, desk); river (between columns, SurfaceHost.history); BBS next (PIE-453)
extensions
    ├── [x] properties (summary, panel)   note surface
    ├── [x] edit, comments, completion    note surface + ed
    ├── [x] folds                         note surface (not river cards)
    ├── [~] presence, activity, stats     BBS screens + desk tiles (PIE-430)
    └── [~] view actions                  board cards, river columns
```

Refinements to the proposed tree:

- **"Entered" belongs in tile operations.** Focus picks the tile; *entered* says whether keys go
  into the reader's edit/comment/panel. It's shared (`Entered` `pan:287`) and it's how agents
  never steal keys.
- **The hint row is part of the view.** Every view has one; only the edit control's is shared
  (`editHint` `ed:48`).
- **Squeeze is a tile operation,** not a river feature. The board already has a manual version.
- **History was missing** from the proposed tree and from the code; the outliner's Detail has it. Readers
  have it since PIE-453 (back and forward, alt+← alt+→, the side buttons).

---

## 3. Audit matrix

Codes: **S** = shared code. **R** `file:line` = re-implemented differently. **—** = missing.
Then `kma` = keys, mouse, agent action; `·` marks one that is absent.
BBS = News, Conference and the BBS message reader (`MessageReader`) together.

### Shell

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| enter from menu | S `K`, `screen.open` kma | S `N J R`, `screen.open` kma | S `D`, `screen.open` kma | S `Q`, `screen.open` kma |
| back | S `q`, `screen.back` k·a (PIE-489) | S `q` `Esc`, a click on `Q back`, `screen.back` kma | S `q` `Esc`, `screen.back` k·a | S `q`, `screen.back` k·a |
| drop to shell | S `screen.shell`, the person's only (an agent's is refused by design) k·· | S the menu's `!`, `! Shell` click km· | S `^W !` k·· | S k·· |
| status bar, flash | S | S | S | S |
| hint row | R `del:1450` | R `scr:242` | R `dsk:210` | R `riv:397` |
| peek state | S `del:479` | S message reader `scr:430` | S `dsk:163` | S `riv:615` |
| `open <id>` | S `del:330` ··a | S message reader: the next reader ··a | S `dsk:100` ··a | S `riv:613` ··a |
| `act` | S `del:336` | S message reader `scr:442` (note + `message.*`) | S `dsk:106` | S `riv:662` |

### View

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| content | lanes `del:1225` kma | list `scr:203`, `list.*` kma | tiles `dsk:173`, `tile.focus` kma | strip `riv:270` kma |
| reader | S `ReaderPane` | S `MessageReader` hosts the surface kma | S `ReaderPane` | S surface (edit only) |
| header | S `note:268` | S surface, BBS rows via `SurfaceHost.header` `scr:301` | S | R cards `riv:362` |
| body render | S `renderDoc` | S `renderDoc` (the surface's) | S | R `colourBody` `riv:363` |

### Tile operations

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| focus | R Tab `del:1540` kma | — | R Tab/1-9 `dsk:286` kma | R h l `riv:867` kma |
| entered | S `Entered` | — | S `Entered` | R `isEntered` |
| zoom | S tree, `^W z`, `tile.zoom` k·a (a preset on the desk, #98) | — | S tree, `^W z`, `tile.zoom` k·a | — (PIE-428) |
| open beside | S tree, alt+⏎ detail kma | — | S tree, `^W o` add, `pane.split` k·a | R ⏎ column kma |
| split | — (a detail opens with a note) | — | S tree, `^W o`, `pane.split` k·a | R `s` `riv:496` k·a |
| close | S tree, `x`, `tile.close` k·a | — | S tree, `^W x`, `tile.close` k·a | R `x` k·a |
| resize | S tree, drag, `{ } < >`, `tile.resize` kma | — | S tree, drag, `^W <>`, `tile.resize` kma | — (automatic) |
| dock / move | R float HJKL, drag, `float.place` kma | — | S tree, drag a header (tabs on drop), `^W m t T H J K L`, `layout.move` kma | R `p` pin k·a |
| float | S tree floats, `o`, the `⧉` click docks, `tile.float` kma | — | S tree floats, `^W f`, the `⧉` click docks, `tile.float` kma | — |
| drawer | S tree, `t b`, pin `T B` or the header's `⇤ drawer` click, `tile.pin` kma | — | S tree, `^W p` `^W d`, a handle's click, `tile.pin` `tile.drawer` kma | — |
| squeeze | S spine: lane `c`, `lane.collapse` kma, reader `c` kma, `alt+c` | — | — | S spine, `riv:243` auto, `p` |
| persist | S tree → `delivery.json` (its old fields) | — | S tree → `desk.json` | R `river.json` |

### Entity navigation

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| children | — (`N` writes one) | R `T` `scr:400`, `message.thread` k·a, a list's `t` `list.thread` kma | R `pan:299`, `thread.pick` kma | R `space` kma |
| up | S `u` k·a | S `u` (`U` too) k·a | S `u` k·a | S `u` k·a |
| outlinks | S `[ ]` ⏎ click kma | S kma | S kma | S kma |
| backlinks | S drawer, Detail's view (`src/backlinks.ts`) kma | — | S backlinks tile (`^W o l`, the welcome's strip), the tree's `L` kma | — |
| resources | S images, `[file::` | S (projections, images) | S; the tree's `L` lists a row's, ⏎ or a click shows one; a `[file::]` token in a reader is a link kma | — |
| search | R `g` boards only, `board.hub` kma | R `scr:338` dead | R `/` `dsk:371`, `search` kma | R `/` `riv:66`, `jump` kma |
| history | S alt+← alt+→ ⌫, `← back` row, `back` `forward` kma | — (next: the screen stack) | S kma | R the columns, the river's `back` `forward` kma |

### Extensions

| Element | Kanban (board) | BBS | Desk | River |
|---|---|---|---|---|
| properties | S `i I` kma | S `i I` kma (count on `Stat:`) | S kma | S `i` k·a |
| edit | S `e` kma | S kma | S kma | S kma |
| comments | S `C m` kma | S kma | S kma | S kma |
| completion | S (the composer too, PIE-516) | S | S | S |
| folds | S kma | S kma | S kma | — (cards) |
| presence | — | R `scr:355`, `who.refresh` kma | R `pan:411`, `who.refresh` kma | — |
| activity | — | R `scr:392`, `list.*` kma | R `pan:375`, `activity.pick` `activity.reload` kma | — |
| stats | — | R `scr:535` (nothing to do there but `screen.back`) kma | — | — |
| view actions | R cards `del:1799` kma | — | — | R `riv:976` kma |

---

## 4. Findings

### F1. Two readers, two body renderers

- `NoteSurface` renders with `renderDoc` (`note:320`). The desk search preview (`dsk:404`) and river
  cards (`riv:362`) use `wrap` + `colourBody`.
- **Resolved for the BBS by PIE-426.** The BBS message reader (`MessageReader` `scr:273`) hosts
  `NoteSurface` through `SurfaceHost`, like the board, desk and river: links you step to and open, the
  property panel, folds, comments, edit, selection and copy, the ruler, resource projections, and `act`.
  Its header stays the BBS one (`Date`, `To` from `to::`, `From`, `Reply`, `Subj`, `Conf`, `Stat`),
  given to the surface through `SurfaceHost.header`, which takes the place of the surface's title, byline
  and crumbs (the summary line follows it). Its old body code is gone. Its own keys are actions
  (`message.next`, `message.previous`, `message.thread`); where they meet the surface's, the surface
  goes first (key audit below, under F4). A followed link opens as the next message reader on the screen
  stack; an agent's never opens over an edit, comment or panel the person is in.
- River cards stay a list. A full river column's note body is drawn by the surface (`NoteSurface.digest`,
  PIE-472: the same renderer, transclusions and step controls, inside the river's own column and scroll);
  its header and replies are still the river's, and PIE-431 decides the rest (folds, comment marks).

### F2. Pane operations are re-implemented per view

- Desk: layout tree (`lay:5`), zoom, `^W` prefix. Board: fractions (`del:37`), floats, drawers,
  `x` and `o` without a prefix. River: strip, automatic squeeze, `x`, `p`, `s`.
- Zoom was the desk's only (it swaps the rectangle map, `dsk:177`, not a tree op); the board has it since it became a preset on the desk (#98). The river still has none.
- **Resolved for the board by PIE-511:** it is a screen on the desk (a spec since PIE-515), so its floats, drawers, zoom and `^W` keys are
  the desk's; its `x` and `o` are the same tile actions without a prefix.
- **Resolved for the river by PIE-515:** its columns are a flow of tiles on the desk: its `w` `p` `x` `s` and back and
  forward are the engine's tile actions (`tile.widen`, `tile.dock`, `tile.close`, `column.split`, `tile.travel`), and zoom
  and `^W` work there as on any desk.
- **Resolves:** PIE-412 (one layout tree), then PIE-428 (zoom everywhere) on top of it, PIE-413
  (tabs, drag-and-drop).
- **PIE-412 slice 1 (done):** the board is on the desk's tree. Its lanes pane (columns are drawn inside
  it), preview and details (the `readers` row), backlinks drawer (under the readers) and outline drawer
  (beside everything) are leaves, the drawers sliding over (`over`) until pinned, floats above. The keys,
  hints and `delivery.json` fields are unchanged. Slice 2 moves the river's strip onto it; slice 3 stores
  the tree in the outline as screen notes.

### F3. Agents can read and edit, but not arrange (resolved by PIE-506)

- Since PIE-514 every screen's actions run through one dispatcher per screen host, and each declares what it
  touches: the screen-local `act`s, tile pickers and person checks are gone.

- Every reader shares `NOTE_ACTIONS` (`note:1329`), and since PIE-506 every key and click the note surface
  handles runs one of them (`scroll`, `element.select by=`, `fold.select`, `callouts`, `select.mode`, …).
- Desk: `open`, `tile.*`, `layout.*` by stable id with a layout revision (PIE-412, PIE-413,
  PIE-491), the policy's `layout.lock` and `layout.policy` (PIE-505), and since PIE-506 `search`, `tile.enter` (the terminal kind's),
  `tile.leave` and each tile kind's own (`thread.pick`, `activity.pick`, `tree.fold`, `backlinks.fold`,
  `reader.hold`, registered on the kind).
- Board: the desk's `tile.*`, `card.*`, and since PIE-506 `board.hub` (the `g` picker), `lane.collapse`,
  `outline`, `float.place`, `backlinks.pick`, `board.reload`; the lane cursor is `card.select by=` (an agent's
  is its own selection).
- River: since PIE-515 a column kind's (`column.select`, `column.replies`, `column.scroll`, `column.filter`, `column.tag`,
  `column.split`, `column.copy`) and the desk's tile actions (`tile.widen`, `tile.dock`, `tile.close`, `tile.travel`); `jump` is gone (`search`).
- BBS: `screen.*`, `list.*`, `message.*`, and since PIE-506 `menu.select`, `list.thread`, `who.refresh`,
  `art.*`, `screen.help` and `video.cycle`.
- **Kept so by test:** `test/parity.ts` (run by `test/parity-*.test.ts`) presses every key and clicks across every screen and fails on a
  change no action declared ([the agent interface](AGENT-INTERFACE.md#parity-every-key-and-click-is-an-action-pie-506)).
- Still direct: dragging a border or a lane edge (a share, not steps; agents resize by `tile.resize` and
  `layout.resize`), moving a keyboard selection after `v`, drag-selecting text, and the desk's `^W r` / `^W w`
  pickers (input states that end in `layout.load` and `layout.save`).

### F4. The same key means different things

| Key | Board | Desk | River | BBS |
|---|---|---|---|---|
| `c` | collapse a lane or a reader | — (says `C` comments) | — (says so) | — (says so) |
| `C` | comment (was: reopen all lanes; now `alt+c`) | comment | comment | comment |
| `s` | steps | `^W s` swap | split | — |
| `m` | move card / threads in a reader | threads | threads | threads |
| `x` | close detail or float (on the preview: says why it stays) | `^W x` close | close tile | — |
| `o` | pop out float | `^W o` add a tile | — | — |
| `t` | outline drawer | `^W o t` add outline | — | thread (`t` `T`) |
| `p` | — | hold reader | dock column | previous (`p` `P`) |
| `w` | — (the backlinks drawer's `w` is stage) | — (`^W w` saves a layout) | widen: the focused column takes the wide place | — |
| `f` | fold | fold | filter | fold |
| `alt+⏎` | second detail | — | duplicate column | the next reader, as ⏎ |
| `q` | back (PIE-489) | menu | back (the quote flash moved to `"`) | back |
| `space` | lanes: — · a reader: page (a current step: done / to do) | page (a current step: done / to do) | toggle replies (a column's current step: done / to do) | page (a current step: done / to do) |
| `ctrl+z` | undo a step change | undo a step change | undo a step change | undo a step change |

- Since PIE-514 every key on every screen runs its action through the screen's dispatcher (`press`), so one
  key is one action with one rule for agents wherever it's bound; the clashes above are only in which key
  names which action.
- Pane operations should get one key layer (the desk's `^W` is the most complete). Reader keys
  are already consistent because they come from the surface.
- The backlinks drawer (PIE-442) takes Detail's backlinks keys where they're free with the drawer
  focused: `/` filter (the desk's and river's `/` also search), `s` sort (the lanes' `s` is steps),
  `h` resolved (the lanes' and river's `h` is left; the drawer has no left), `n` this note (the lanes'
  `n` is a new card), `.` or space a group. Two clash and are moved: Detail's `k` kind is up in every
  door list, so kind is `K` (a float's `K` nudges it up, only with the float focused); Detail's `t`
  stage is the board's outline drawer from any focus, so stage is `w` (the steps overlay's `w`
  "waiting" can't be open at the same time). A filter being typed holds every key, `t b g` included.
- `c` collapses wherever something collapses, and `C` comments in every reader (PIE-440).
- **Steps (PIE-472)** take no new key while reading. `⏎` or a click (or right-click) on a step's box opens
  its status choice, as on any element. Inside the choice `x o w !` mark done, to do, waiting and problem
  (the board's steps overlay already uses `x w !`), `y` copies the step link (`y` copies everywhere) and
  `a` makes it addressable; the choice takes every key first on the board, the desk, the river and the
  BBS reader until a choice or `esc`, so their `x` (close), `o` (pop out, add tile) and `w` (the
  backlinks drawer's stage) can't fire. Outside it, `space` toggles a step only while the step is the
  current element in view (as Detail's space on a focused checkbox); it pages the reader otherwise, and
  in the river it only reaches the step through the column's `[ ]`. `ctrl+z` undoes the last step change
  you made in this reader (Detail's binding); in a draft it takes back an agent's patch (PIE-501), the same
  word, and nothing else in the door binds it.
- **The BBS message reader (PIE-426)** meets the surface's keys this way. An edit, a comment or the
  property panel takes every key (`q`, `n`, `esc` included) until it closes. Otherwise the surface goes
  first and the BBS keys take what it leaves:
  - no clash: `n` `N` `→` next, `p` `P` `←` previous, `t` `T` thread, `q` `Q` back (the surface binds none
    of them while reading); `j k ↑↓ PgUp PgDn space` scroll as they always did, now the surface's;
  - `⏎` acts on the current element when there is one in view (a link opens as the next reader, a fold
    toggles, a comment mark expands its thread); with none it is next, as before. `esc` lets go of the
    element, the selection or a focus mark first; then it is back;
  - `U` is the surface's `u` (up), one code path; at the top it still says so;
  - new to the BBS reader, no old meaning: `[ ] ( ) f F z i I C c m e ctrl+e v y Y`, clicks, drags and the
    wheel; `V` (video) stays the menu's.

### F5. Entity navigation is scattered

- Backlinks: board drawer only. Children: three shapes (thread tile, river replies, BBS `T`). Since
  PIE-442 the drawer groups, filters and sorts as Detail does through `src/backlinks.ts`; the PIE-432
  connections screen should list backlinks through it too, not a new list.
- Outlinks are in-note only (`[ ]`); no list of them. No resources list. No history anywhere. (Since then: the
  tree's `L` lists a row's outlinks, resources and backlinks, as the outliner's Tree does; the backlinks tile,
  `^W o l`, shows another tile's; readers have back and forward, PIE-453.)
- **Resolves:** PIE-432 (connections screen: children, outlinks, backlinks, resources) as one
  shared entity-nav component; PIE-413 puts backlinks under details.

### F6. Four searches

| Where | Code | Backend |
|---|---|---|
| BBS `Search` screen | removed (PIE-510) | was `board.search`, reachable from no menu |
| Desk `/` overlay | `dsk:371` | `board.search`, debounced, with preview |
| River `/` jump | removed with `river.ts` (PIE-515) | was a local `tree.index`; the river's `g` is the desk's search now, and its `/` filters a column |
| Board `g` | `del` picker | board (hub) discovery, not text |

- One jump palette, as a shell overlay, would serve every view. PIE-427's outline switcher can
  reuse its picker.

### F7. Presence and stats are duplicated and BBS-flavoured

- Who's Online and Last Callers: resolved in the demolition pass. `WhoPane` and `ActivityPane` are the one copy each;
  the menu's W and L open them as screen specs (`who`, `lastcall`).
- Stats: one screen (`scr:535`), a heatmap of `updatedAt`, not a tile.
- **Resolves:** PIE-430 (active people and agents, one component used as screen or tile).

### F8. The shell is one workspace for the whole run

- `ctx.board` is fixed at startup (`src/main.ts:38`). Live figures (`src/live.ts:26`) and
  reference caches (`src/refs.ts:25`) are module-level, not per workspace.
- **Resolves:** PIE-427 needs those caches keyed by connection before a switcher is safe.

### F9. The "one edit control" is split in two

- `ed` owns the frame, status line, hint and `$EDITOR` handoff.
- Completion is wired only inside `NoteSurface` (`note:592`) and `CommentSession`
  (`src/comment.ts:243`). The board's composer uses `renderEditor` (`del:1335`) but gets no
  completion.
- **Resolves:** PIE-434 (see §5: the editing component should own completion).
- **Status (PIE-516):** every draft is a draft session, and its `key` takes the host's completer; the
  board's composer passes one, so it completes `[[` `((` `[file::` as the reader's edit and comment do.

### F10. Stale words in the code

- Help said "Read-only. Nothing you do here writes to the outline." It writes now; the line is gone.
- `note:2` says the surface is hosted "(next) a river column". The river hosts it already.
- Not fixed here: the audit changed no behaviour or strings.

### Backlog map

| Item | What it resolves here |
|---|---|
| PIE-412 | F2: one layout tree for board, desk, river (slice 1: the board and `pane.*`, done; slice 2: the river; slice 3: screens in the outline) |
| PIE-413 | F2, F5: tabs, drag-and-drop, backlinks under details, two previews (done: §7) |
| PIE-414 | bundles of readers: needs readers addressed the same way on every view |
| PIE-417 | terminal tiles: a new tile kind, not a `suspend` (done: the terminal tile; `suspend` stays for ctrl+e and drop to shell) |
| PIE-418 | daemon: shell state (layout, drafts, presence) outlives a terminal |
| PIE-426 | F1, F3: BBS reader on the note surface, with actions (done) |
| PIE-427 | F6, F8: switcher in the status bar; per-connection caches |
| PIE-428 | F2: zoom as a tile operation everywhere (the desk and the board have it; the river is left) |
| PIE-429 | scratch note: a reader pinned to the shell, not a view |
| PIE-430 | F7: one presence/activity component |
| PIE-431 | F2, F4: river squeeze and columns as the shared layout model |
| PIE-432 | F5: shared entity navigation |
| PIE-434 | F3, F9: core vs extensions, editing component |

---

## 5. Core versus extensions (PIE-434)

### Proposed split

| Layer | Core (the door owns it) | Extension (a view or plugin adds it) |
|---|---|---|
| shell | stack, status bar, flash + log, theme, unsaved guard, control socket | menu entries |
| tiles | layout tree, focus, entered, zoom, open beside, close, resize, squeeze | tile kinds |
| reader | note surface, header, summary, links, folds, embeds | summary keys per view |
| editing | edit control with completion, draft safety, provenance | completion sources |
| entity nav | up, children, outlinks, backlinks, resources, history, jump | extra projections |
| agents | action registry, arg checking, provenance, `peek` | each extension's actions |
| views | none | board, desk, river, BBS, stats, presence |

Rules that follow from the audit:

- **A view never draws its own tile chrome.** Frames, thumbs, "(e enters)" and zoom come from
  core. Today each view draws them (`dsk:191`, `del:1218`, `riv:270`).
- **Every key a view binds is an action first.** The key is only a binding in the action list.
- **Pane operations use one key layer** across views.
- **Extensions register actions into `ActionSet`s.** They don't intercept keys before the
  shell does.

### The reusable editing component

Boundary for a TUI editing component that other TUIs can use:

| Inside | Outside (the host gives it) |
|---|---|
| `Draft`: text, cursor, base revision, dirty, writers | where it is drawn (a `Rect`) |
| edit control: frame, status, hint, keys, `$EDITOR` | where it writes: a target adapter (`src/draft-session.ts`) |
| the draft session: put aside, restore, hold, leave, the agent rule | which actions its keys' commands run |
| completion popup and its keys | completion lookups (`CompletionBoard`) |
| "changed elsewhere" state, keep-draft-to-disk | outline events that mark it |
| provenance: who typed, what the save records | the actor |
| actions: `edit.*`, `complete` | the action registry it registers into |

- Today the frame is in `ed`, the text model in `src/edit.ts`, and completion in `note` and
  `src/comment.ts`. Moving completion into the component closes F9 and gives the board's
  composer completion for free.
- Grapheme width stays a known limit in the editor: it wraps by cells (`wrapRows`), but a click and up/down count one
  cell per character (README); everything else measures in cells (`width`, `graphemes`, PIE-510).

---

## 6. Ideas from other TUIs (recon, Sep 28)

From a look at shiki, strata and mirador (all MIT). Where each fits:

- **Width tiers** (shiki): side by side, stacked when narrow, focused only when tiny. Hidden
  tiles get zero size, so navigation is the same at every width.
  - Place: tile operations (core). Today: the river has tiers (`riv:243`); lift them into the
    layout tree (PIE-412).
- **Dim unfocused tiles** (mirador).
  - Place: shell theme (core). Today: only the border colour changes (`dsk:191`).
- **Miller columns** (strata): position is depth, preview far right, hidden by width;
  `Alt+←/→` history, `Ctrl+L` jump box.
  - Place: a river view (PIE-431) plus entity navigation. Today: no history anywhere (F5).
- **Dashboard** as weighted rows of panels.
  - Place: a view built on the layout tree (PIE-412). Stats and presence become panels (PIE-430).
- **Theme palette**: ~20 named slots, "reset" inherits the terminal, selection derived from the
  terminal's colours (OSC 10/11).
  - Place: shell (core). Today: 16 VGA colour indices, hard-coded (`src/style.ts:10`).
- **Messages log** keeping every flash, and a **`doctor`** command.
  - Place: shell (core) and the control socket. Today: one 4-second flash (`app:116`); `peek`
    already reports `service.uses` (`app:155`), half of a doctor.

---

## 7. Tiles: drag, tab, link, preview, layouts (PIE-413, PIE-417, PIE-473, PIE-474)

The desk is tiles in containers on the layout tree (splits, tab sets and drawers, each with its policy, PIE-505). Everything below is an action first (`TILE_ACTIONS` in
`src/desk/tile-actions.ts`, `PANE_ACTIONS`); the key, the drag and `act` call the same code, and an agent's
never takes the person's focus, keys or shown tab.

### Hit areas (Replit's splits, floatty's outer edges)

| Where the header is dropped | What happens | Action |
|---|---|---|
| another tile's header, or its centre (the middle ~28% each way) | it joins that tile's tabs, before the tab under the pointer | `layout.move where=tabs index=<n>` |
| one of the four triangles between a tile's diagonals | a split on that side (joins a split already along that axis) | `layout.move where=left/right/up/down` |
| the window's outer left or right two columns, or its bottom row | a full-height column or full-width row beside everything | `layout.move where=edge-left/edge-right/edge-down` |
| its own tab set's side | it leaves the tabs and lands beside them | `layout.move to=<itself> where=…` |

The outer strips are checked first. The top edge is the headers' row, so a full-width row on top is by key
(`^W K`) or `act`. Zones come from the rectangles just placed, on every pointer event (floatty's ghost divider
came from geometry kept from the start of a drag).

### Key map and clash audit

Checked against every screen's keys (§4 F4, the board's, the river's, the BBS reader's, the surface's).

| Key | Tiles (the desk and screens on it) | Clash found | Decision |
|---|---|---|---|
| drag a header's title or tabs | move the tile (tab under the pointer) | none: headers took no drag before | new |
| drag a header's bare line | resize: the border above follows the pointer (`layout.resize`) | the whole header moved the tile | changed |
| `alt+l` | link this tile's opens: then a click, `h j k l` or a number | none (alt keys in use: `alt+b alt+f` history, `alt+c` the board's lanes) | new |
| `alt+d` | load `daily` | none | new |
| `alt+n` `alt+p` | next, previous tab | none | new |
| `^W m` + `hjkl` | move beside that tile (none that way: to the edge) | `m` is threads in a reader, but `^W` is a prefix | new, under `^W` |
| `^W t` + `hjkl` | into that tile's tabs | `t` is the board's outline drawer; the board doesn't take `^W` | new, under `^W` |
| `^W T` | take this tab out | none | new |
| `^W [ ]` | previous, next tab | `[ ]` are elements in a reader, but only after `^W` here | new, under `^W` |
| `^W H J K L` | to that outer edge | was "dock to edge": the same thing, now `layout.move` | kept |
| `^W o` / `^W O` + kind | open a tile beside / as a tab | `^W o` was "add pane": the same, more kinds | kept, extended |
| `^W v` | a preview of this tile | none | new |
| `^W p` / `^W d` | put the tile in a drawer container where it is, or take its drawer away (PIE-505; it was a flag on the tile) / slide its drawer open or shut | `p` holds a reader, `d d` trashes a card: both outside `^W` | new, under `^W`; `^W p` changed with PIE-505: what it makes is a container, which takes drops |
| `^W c` | fold the tile to a spine where it is, or open it (`tile.collapse`, PIE-511) | the board's `c` folds a lane or a reader (outside `^W`, the same action underneath); `C` comments in a reader; `^W` bound no `c` | new, under `^W` |
| `^W W` | give the tile's flow column the wide place (`tile.widen`, PIE-513: the river's `w`); a click on a flow column's spine does it too | the river's `w` (its own screen, not under `^W`); `^W w` saves a layout (lower case); `^W` bound no `W` | new, under `^W` |
| `^W f` | pop the tile out as a float, or dock a float back (`tile.float`, PIE-511: the desk had no floats; a click on a float's `⧉` docks it too) | `f` folds in a reader (`( ) f`), the board's `o` floats: both outside `^W`; `^W` bound no `f` | new, under `^W` |
| a click on a header's `⇤ drawer` | dock that drawer where it is (`tile.pin on=true`, PIE-511) | the board's `[ ] pin` in its drawers' titles did this (and the other way): the drawers are the desk's now, and `T` `B` put them back | changed: the board's pin box is gone; `T` and `B` toggle both ways |
| the desk's keys on the board (`^W …`, `/`, `alt+l alt+n alt+p alt+m alt+x alt+k`) | the board is a screen spec on the desk (PIE-511, PIE-515): its tiles split, tab, float, zoom, lock and search as the desk's do; `alt+d` (a layout load) is refused there, as on every preset | the board bound none of these; its `/` is the backlinks tile's filter while that tile has the keys (the tile's keys come first); `1-9` stay unbound on the board (its digits are off) | new on the board |
| `Tab` on the board | the next area: the lanes (the lane the cursor is in) count as one, then the preview, the details, the open drawers' lists, the floats | the desk's `Tab` steps every tile | kept from the board: one stop for the lanes |
| `^W P` | the policy panel: the containers over the focused tile and what each allows; `j k` rows, `h l` container, `⏎`/space or a click changes a row, `+ -` a size, `esc` closes (PIE-505) | none: `^W` bound no `P` (only `p`); the BBS message reader's `P` (previous message) is its own screen, never the desk's `^W`; a terminal tile takes `^W` itself | new, under `^W` |
| `alt+k` | lock or unlock the screen (`layout.lock`, PIE-505): the shape is fixed, the contents live | none on any screen, the surface, a draft, the board, the river or the dock (alt keys in use: `alt+a alt+A alt+R`, `alt+b alt+f`, `alt+c`, `alt+l alt+d alt+n alt+p alt+m alt+x`); Option+k (`˚`) reads as `alt+k` on a US keyboard, as the other Option keys do | new; inside a terminal tile the person is typing in, it's the program's (`ctrl+]` first); on a preset desk (the welcome, the brief) it locks that screen for the session (not saved) |
| a click on `□ lock` / `▣ locked` (the hint row's end) | lock or unlock the screen (`layout.lock`) | none: the hint row's end held only the drawer handles | new, after the handles |
| `?` on the desk and the screens built on it (the board, the brief, Waiting), a click on `? more` | when the hint row was too long for the screen it ends `? more`: `?` shows every part in a box above it (`keys.more`, PIE-509); the next key puts it away (`Esc` only that). A `^W` chord's row (`^W`, `^W o`, `^W O`) shows its box at once and ends `…` | none on the desk or the board (the river's `?` is its own key list; the menu's is help); typed as text in a draft, a filter, the search, the composer and a terminal, where it is never taken | new |
| a header dragged onto a drawer's handle | the tile goes into that drawer (`layout.move where=tabs` into what it shows; `handleDrop` in `src/desk/drop.ts`) | none: the hint row took no drops | new |
| a drag or border the policy refuses | the ghost turns red and says why (`Drop.refused`); a refused border says why on the press and doesn't follow the pointer | none | new |
| `^W r` / `^W w` | load / save a layout by name | none | new |
| `q` | back, on every screen but the menu (PIE-489): the board's lanes (it did nothing), the river (it flashed "quote isn't here"). On the menu, the top, it stays the Quay | the river's quote flash moved to `"` (gone since PIE-515); the menu's `q` (Quay) is unchanged: there's nothing under the menu to go back to | changed, except on the menu |
| `"` | nothing (PIE-515: the river's "quoting isn't here yet" flash went with its screen) | none | removed |
| the river's keys (PIE-515: its key map, a spec's) | `h l ← →` `tile.focus dir=` (the column before or after) · `w` `tile.widen` · `p` `tile.dock` · `x` `tile.close` · `alt+← backspace alt+b` / `alt+→ alt+f` `tile.travel` · `g` the desk's `search` | the reader's `h l` aren't bound (READER_OWN_KEYS keeps them for extensions only); `p` holds a following reader, but a river column follows nothing; `x` in a thread list resolves, but a session the person is in takes every key first; the desk's `/` is search, so on the river the search moves to `g` (the board's `g` is its hub picker: another screen); `backspace` was the reader's history back, and in a flow back is the column's | moved onto the engine's tile actions; `g` new |
| `/` in a river column | filter this column (`column.filter`): the hint row is the prompt, `type:hub -status:done author:codex word` its example | it was the river's jump palette (the local index), retired for the desk's search on `g`; the desk's `/` (search) is reached by `g` here | changed (PIE-515, Evan) |
| `f` `( )` `[ ]` in a river column | fold, fold points, step between the note's elements, as in every reader (the column is a reader of the note surface) | `f` was the river's filter (now `/`); `[ ]` already stepped links | changed: `f` folds (PIE-515) |
| `#` in a river column | **same property**: the selected note's properties, each a digit, opening a column of every note with it (`column.tag`); "this note has no properties to follow" when it has none | it was labelled "tags" and showed an empty box | relabelled (PIE-515) |
| `?` on the river | the desk's `keys.more` when the hint row was cut | the river's own help overlay | the overlay retired: `actions` and the hint row say every key |
| a click on a flow column's header | widen it (`tile.widen`), as the river's header click always did; on any flow on the desk | the header's press starts a drag of the tile; a click without a drag did nothing | new for every flow |
| `Esc` on the main menu | stays, says `G` logs off | it logged off (review C F1) | changed; Goodbye is `G`, a click, or the logon's `Q` |
| `ctrl+]` | leave a terminal tile, or the agent drawer; with the drawer up and the person out of it, go back in (twice at once: in, and a `ctrl+]` sent to the agent, as a tile's second sends it to its program) | nothing binds it; telnet's escape. A screen's terminal tile the person is in keeps its own `ctrl+]` and its second | new |
| `alt+a` | pull the agent drawer up, or put it away (`host.toggle`; PIE-498, PIE-513), on every screen but the logon; also inside the drawer, where every other key is the agent's | none on any screen, the surface or a draft (alt keys in use: `alt+b alt+f` history, `alt+c` the board's lanes, the desk's `alt+l alt+d alt+n alt+p alt+m alt+x`). `alt+c` was the other candidate: it's the board's lanes | new; inside a terminal tile the person is typing in, it's the program's (`ctrl+]` first) |
| `alt+A` | the agent drawer's height: 40, 50, 60, 75% (`host.size`) | none | new, with `alt+a` |
| `alt+R`, a click on the chip's `⟳` | restart the agent so it picks up the door's variables and the installed Claude mod, keeping the conversation (`agent.restart`); the chip shows `⟳` when it started before an update | none on any screen, the surface, a draft or the desk (alt keys in use: `alt+a alt+A`, `alt+b alt+f`, `alt+c`, `alt+l alt+d alt+n alt+p alt+m alt+x`); `R` alone is free of alt. Inside the drawer it's the agent's, as every key but `ctrl+]`, `alt+a`, `alt+A` | new; only outside the drawer, so a restart is never one stray chord while typing to the agent |
| `alt+v`, a click on the status bar's video mode | the next video mode (`video.cycle`): Kitty+CRT, Kitty, cells, on every screen; `V` stays on the menu (and the screens that had it) | none on any screen, the surface, a draft, the desk, the board, the river or the drawer (alt keys in use: `alt+a alt+A alt+R`, `alt+b alt+f`, `alt+c`, `alt+l alt+d alt+n alt+p alt+m alt+x alt+k`); `V` and `v` can't be global (`v` selects in a reader, `V` is the art viewer's and a terminal's), `alt+v` is free everywhere; the status bar's video mode took no click | new; the App's, before the screen, like `alt+a`; inside a terminal tile or the drawer the program's, as every key there |
| `alt+t`, a click on the status bar's theme | the next theme (`theme.cycle`): calm, night, classic, on every screen; `theme.set name=` picks one (src/theme.ts) | none on any screen, the surface, a draft, the desk, the board, the river or the drawer (the same alt keys as `alt+v`; `t` alone is the board's outline drawer and a list's thread, untouched); the status bar had no theme | new, with `alt+v`; inside a terminal tile or the drawer the program's. A Mac typing Option as characters: `†` and `√` read as `alt+t` and `alt+v` only where nobody is typing text (`OPTION_KEYS`); in a draft they stay the typed letter |
| `Esc` with the agent drawer up and the person out of it | puts the drawer away | each screen's `Esc` (back, cancel) | the drawer's first, as the desk's `Esc` slides its drawer shut; not while the screen holds the keys (an edit, a filter, a terminal) |
| `tab` / `shift+tab` in a draft | indent / outdent the line or selection (`draft.indent`, `draft.outdent`, PIE-496) | `tab` moves focus on the desk, board and river, but an open draft the person is in takes every key: `tab` there inserted two spaces before, `shift+tab` did nothing. In a completion popup `tab` still inserts the candidate | changed, inside drafts only; `esc` or `ctrl+s` leaves a draft |
| `⏎` / `alt+⏎` in a draft | the next list item (`draft.newline`) / a plain line break | none: both were a line break | changed, inside drafts only |
| `shift+⏎` | read only from a terminal speaking the Kitty keyboard protocol (`src/kbd.ts`; the door asks for it, Herdr 0.9 passes it). In a draft a plain line break, as `alt+⏎`; in a terminal tile `CSI 13;2u` to a program with the protocol, `ESC CR` to one without; everywhere else `⏎` (`ctrl+⏎` too) | none: nothing binds it, and legacy terminals send it as `⏎` | new; `⏎` everywhere but drafts and terminal tiles |
| `ctrl+p` in a draft | the live preview (`draft.preview`) | nothing binds `ctrl+p` anywhere | new |
| `ctrl+z` in a draft | take back the last agent patch (`draft.undo`, PIE-501) | reading, `ctrl+z` undoes a step change (the same word: undo); in a draft it was unbound | new, inside drafts only |
| `A` in a reader | apply anyway: a proposal an agent's patch left (`proposal.apply`, PIE-501), shown or as the current element; on another embed the key isn't taken | none: no screen, surface or host binds `A` (only `alt+A`, the drawer's height); `a` is the steps choice's "make addressable", only while it's open | new |
| `X` in a reader | dismiss a proposal (`proposal.dismiss`): on the proposal shown, or its embed or control as the current element; elsewhere the key isn't taken | none: only the main menu binds `X` (the showcase), and a reader never sees the menu's keys; `x` is the steps choice's "done", only while it's open | new |
| the wheel, a click, a drag in a draft | scroll the draft (the cursor stays), place the cursor, select (`draft.scroll`, `draft.place`) | the wheel moved the cursor three lines; a click did nothing but choose a completion; a drag was ignored | changed, inside drafts only |
| a click outside the draft (another tile, a board area, a river tile, the drawer handle) | leave it (`session.leave`, `composer.leave`): an unchanged edit closes, a changed one saves, a refused save, a comment, a reply or a new card is kept as unsent; then the click does what it does | it was refused ("finish the edit first"); a click in the draft's own tile or frame still stays in it | changed |
| `^W` in a draft (desk) | arm the window keys: the next one leaves the edit as a click away does and runs; `esc` stays in | `^W` was unbound in a draft (the draft took it and did nothing); `tab` stays indent (PIE-496), the board and river have no `^W` (a click or `esc` leaves there) | new, inside drafts on the desk |
| `ctrl+c` | the program's while in a terminal tile, else quit (asked twice) | the shell's quit | the terminal gets it |
| `cmd+c` (super+c, `CSI 99;9u` under the Kitty keyboard protocol) | copy the selection: a reader's `select.copy` (as `y`), the river's `copy`, a draft's `draft.copy`; with none, "nothing selected" | it read as a plain `c` (super was dropped from the report): `c` collapses a pane on the board, and in a reader it said "nothing collapses here"; in a terminal tile with a legacy program it typed `c`. No screen, surface, draft or overlay binds a super key; `ctrl+c` stays the quit, never the copy (Herdr copies with it; the door can't) | new; in a terminal tile it's the program's as it came (a program with the protocol gets `CSI 99;9u`, a legacy one nothing, as from a legacy terminal) |
| releasing a drag, double or triple click in a reader | copy what it selected (copy on select, Herdr's `ui.copy_on_select`; `EP0CH_COPY_ON_SELECT=0` off) | the release only kept the selection (`y` copied); a release on the pressed cell is still a click, and copies nothing | changed; not in a draft, where a drag is the draft's selection and `cmd+c` copies it |
| ctrl-click, alt-click a link | open beside | none | new, as `alt+⏎` |
| `!` on the main menu, `^W !` on the desk | drop to shell (`screen.shell`): the person's login shell in their terminal, the door back where it was when it exits | the board's steps overlay takes `!` (mark problem), but only while it's open, on the board; the menu and `^W` bound nothing on `!`; typed text (a filter, an edit, a terminal tile) takes it first | new; the menu art has twelve slots, so it's on the key line (`! Shell`), as Showcase and Today are |
| `^W o` + a capital (`^W o T`) | open an extension's tile kind (PIE-512): the capital of its name's first letter, stable as other extensions come and go; none (said on the status bar, `tile.open` still opens it) when another kind holds it or it would be `O` | none: every built-in kind's key is lower case | new, under `^W o` |
| an extension action's key on its line (`w` on a `fancy-horror::` line) | while that line (its title or a control) is the reader's current element, run the action (`ext.<id>.<action>`, PIE-512) | any key the reader keeps (`READER_OWN_KEYS`: `[ ] ( ) f F u U r y Y v V i I C c m A X e z j k h l q g G / ? n N`, digits, space) or its host keeps (`SurfaceHost.ownKeys`: the BBS reader's `n p t q U`, a following reader's `p`) stays theirs, and only a single printable character binds; the action is still a click on its control or `act` | new, only on an extension's line |
| `^W o l` | a backlinks tile of this tile | `l` is right in `^W h j k l`, but only after `^W o` here, where `l` was free | new, under `^W o` |
| `å` `¬` `∂` … (macOS Option characters) | read as `alt+a`, `alt+l`, `alt+d` … where nobody is typing text (`OPTION_KEYS`, `App.optionAsAlt`), with a one-time hint naming the terminal setting that sends Alt | none: no screen binds these characters; in an edit, a filter, the property panel, a terminal tile or the drawer's agent they stay the typed letter | new; only on a US-like keyboard by the locale, or `EP0CH_OPTION_KEYS=us`/`off`; Option+n is a dead key, so `alt+n` needs the setting |
| `L` in the outline tree (a desk tile, the board's outline drawer) | show or hide the selected row's links under it (`tree.links`): outlinks, resources, backlinks, as the outliner's Tree's `l` | the outliner binds `l`, but the door's tree has `h l` as ← →; the desk takes `L` only after `^W` (to the right edge); the board's `L` moves a card, but only while its lanes have the keys, never its outline drawer; the welcome's `L` (next logo) is the welcome's own, and the welcome has no tree tile unless one is added (then `L` there is the logo) | new, in the tree only; on a link row `l` → space show its links, `h` ← hide them, as a group folds |

Inside a terminal tile every key is the program's (`^W` included: vim's window keys work), so the only door
key there is `ctrl+]`. Inside a board or river tile its own keys work (a brief tile is a reader of the brief kind: `,` `.` are its own); `1`–`9`, `V` and `^W` stay the
desk's.

### Tiles and their actions

`tile=` names the tile an action is for. Each action has one name.

| Action | Args | Keys, mouse |
|---|---|---|
| `layout.get` | | `peek` shows the same `tree` |
| `layout.list`, `layout.save`, `layout.load` | `name` | `^W r`, `^W w`, `alt+d` |
| `layout.move` | `tile=<tile>`, `to`, `where`, `index` | drag a header, `^W m t T H J K L` |
| `tile.open` (`pane.split`: `kind`, `dir`) | `kind`, `name`, `cmd`, `file`, `source`, `note`, `cwd`, `to`, `where` | `^W o`, `^W O` |
| `tile.close`, `tile.focus`, `tile.info` | `tile=<tile>` | `^W x`, the board's `x`; click, Tab, 1-9 |
| `tile.resize`, `tile.zoom` | `by`, `axis`; `on` | `^W < > + -`, the board's `{ } < >`; `^W z` |
| `tile.float`, `tile.collapse` | none; `on` | `^W f`, the board's `o`, a click on a float's `⧉`; `^W c`, the board's `c`, `alt+c` |
| `tile.widen` | `tile=<tile>` | `^W W`, a click on a flow column's spine |
| `tile.link` | `tile=<tile>`, `to` (none unlinks) | `alt+l` then a click |
| `tile.pin` | `on`, `edge`, `container` | `^W p`; the policy panel's edge row; the board's `T` `B`; a click on a header's `⇤ drawer` |
| `tile.drawer` | `open` | `^W d`, a handle's click, `Esc` in an open drawer; it shuts when the keys leave |
| `layout.lock` | `on` | `alt+k`, a click on the hint row's lock chip; the policy panel's locked row on the screen |
| `layout.policy` | `node`, the policy's fields, `clear`; nothing: a read | `^W P`, `⏎` or a click on a row |
| `keys.more` | none (the person's view; an agent's is refused) | `?`, a click on the hint row's `? more` |
| `tile.preview` | `where` | `^W v` |
| `tile.type`, `tile.restart` | `text` | typing in the tile, `⏎` on an exited one |
| `tab.select` | `by` (1, -1) | a click on a tab, `alt+n alt+p`, `^W [ ]` |

### The river: focus is not the layout

Evan's notes (Sep 29): a click just to focus a column shifted the whole strip, and the column he'd been reading
collapsed to its headings. So the river keeps two things apart:

- **Focus** is which column has the keys (glossary: focus). A click in a column, `h` `l`, `tab`, and `back`
  move it and its highlight only; every column's place, width, cover and scroll stay cell for cell. A column
  off the strip altogether is the one exception: `h` `l` bring it on, one step.
- **The wide column** is what the layout is built around (`describe()`'s `wide`). Only an explicit shift
  moves it: `w`, a click on a column's **header** (its top border; anywhere on a spine, which is all title strip, as a click on a board spine opens it), the `widen` action,
  and an open that couldn't otherwise show the new column full. The column the person was reading (the one
  they were in before) stays full beside it when there's room; a dock (`p`) outranks it.
- **Why these inputs:** the first click must be harmless, so the shift needs a different target, not a second
  click on the same place (a second click on a card already opens it, and a double click selects a word). A
  header is the tile grammar's place for acting on the whole tile (§7's drag). `w` is free on every screen's
  reading keys (the backlinks drawer's `w` and the step choice's `w` only live while those are open; the desk's
  is under `^W`); `z` was the obvious zoom key but it's the surface's unfold.
- **Covered, not collapsed:** a peek column draws the same view a full column does, at the same reading width,
  and shows its first cells; its right-hand neighbour lies over the rest like a drawer, with the board's
  drawer shadow (`▒`) on the edge, and the visible part is dimmed (`Canvas.dim`). Nothing rewraps when it
  widens. Only the far columns become spines. Since PIE-515 this is the desk's drawing of any flow's peek: the
  river's columns are tiles in a flow on the desk, not a strip of their own.
- **Opens shift as little as they can:** ⏎ on a card or a followed link adds the column after its source as
  before. If that column already shows full next to the source, nothing moves; otherwise the new column
  becomes wide and the source stays full beside it. A close hands a full column's place to the column
  sliding into the gap. A click opens a card only in the column that already has the keys.
- **Back and forward** in the river go between columns (`SurfaceHost.history`): back gives the keys to the
  column this one was opened (or last reached) from, forward returns; each widens its target only when it's
  covered. Keys and mouse as in every reader (alt+← alt+→, backspace, the side buttons, the `← back` row
  under the column's title). An agent's `back` is refused: it would move the person's keys.

### The welcome screen (a spec on the desk)

The menu's `C` opens it (it pinned `[[claude-now]]` before; that page is now the welcome's fallback). Its keys,
checked against the desk's, the surface's and the other screens':

| Key | Welcome | Clash found | Decision |
|---|---|---|---|
| `1`–`9`, `0` | pick the welcome note on that tab (`0` the tenth) | the desk's `1`–`9` focus a tile | the tabs take them here (its spec's `digits: false`, and `1`–`9` `0` in its key map): the headers don't number the tiles, and focus is `Tab`, a click or `^W h j k l`; `act tile=` names them (welcome, detail, backlinks, preview). After `alt+l` a digit is still the desk's (the tile to link) |
| `Tab` | list → detail → backlinks → preview | none: the desk's reading order | the backlinks sit under the detail they belong to and the preview runs the full height, so reading order is the useful order; giving a tile the keys never moves a tile |
| `L` | the next logo (`welcome.logo`) | the board's `L` moves a card right, not on this screen; the surface binds no `L` | new, this screen only |
| `⏎` on a link | opens it in the preview (the detail's link) | none: the desk's link rule | kept; with nothing picked yet, `⏎` takes the first element (`]` then `⏎`) |
| `alt+⏎`, ctrl-click, alt-click | read it in the detail | everywhere else it opens beside (a new reader) | the same chord, "open fresh": on a one-note screen, fresh is the detail itself; back returns. In the preview with no link picked, `alt+⏎` (or a click on its `⇱ read here`) reads the preview's own note in the detail |
| `p` in the detail | refused, said | the desk's readers hold or follow with `p` | the detail never follows here |
| `j k ⏎ s K w h n .` in the backlinks | the board drawer's keys | none (the tile has the keys only when focused) | kept, one drawing; landing on the tile (Tab, a click) shows its selected row in the preview, as the board's drawer shows its first on opening |
| `q`, `Esc` | the menu | none | kept |

### What's not done here

- **Screen notes in the outline** (PIE-412 slice 3, gap 4): layouts are in the door's `layouts.json`, and screens are
  specs in code (`src/desk/screen-specs.ts`); `specData` and `readSpec` are the form a screen note would hold.
- **One river:** done (PIE-515). The River is a spec on the desk: a flow of `river.column` tiles (`src/river/column.ts`),
  the engine's squeeze, calm focus, explicit shift, opens into the next column, back and forward and docked
  columns. The `river` layout is that flow beside a preview following the column with the keys.
- **The board** is a screen spec on the desk (PIE-515, gap 3): its lanes are query tiles in a `columns` container
  filled from the hub (`hub:<id>`), its drawers and floats the desk's, saved as a layout in `delivery.json`;
  screens as notes in the outline is gap 4. The `board` layout still puts
  the whole board screen in a tile (`ScreenTile`), a preview tile after its card.
- **The host layer's other tabs.** The drawer is a tab set whose first tab is the agent; the admin outline and
  detail, terminals and the shelf (the same drawer docked to the status bar, a drop on the chip by `drop.ts`'s
  handle zone) come next. Today the drawer slides from the bottom edge (beside: the screen drawn shorter).
- **Where the keys are** (focus) is the person's, an input to the screen-layout module (`ctx.person`), and each operation
  answers where they go after it. The board's own moves between its areas (the lanes, the preview, the details) set
  them directly; PIE-514 makes the keys and "typing in" a shell-owned query.
- **Policy rows that don't act yet:** `collapsible` acts on drawers and on a tile folding to a spine (`tile.collapse`); a
  split or tab set folding whole is still to come (a flow's columns squeeze themselves, PIE-513); `accepts` checks a tile's kind against the containers it would join, and a registry entry's
  `accepts.tiles` checks a tab set's.
- **Terminal keys:** while the person is in a terminal tile the bytes go through raw (F-keys, modified arrows,
  Insert, bracketed pastes); only mouse reports and `ctrl+]` are the door's.

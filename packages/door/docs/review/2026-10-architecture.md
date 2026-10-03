# Review A: architecture and reuse (sceptic's brief)

Reviewed on float-2 at ep0ch-door `c6887a0` and pi-herdr-outliner `9e32c9f`. I read everything in place and
changed nothing. Runs used scratch services only (`test/scratch.ts`), with `EP0CH_STATE` and
`EP0CH_CONTROL` under the scratch root. The probes were throwaway `bun test` files in my scratchpad. Every
service they started was stopped (checked with `pgrep`). I did not touch the real outline or a real door.

"read" means confirmed by reading the code. "ran" names the probe or command.

## Summary

- The pure primitives are healthy and point the right way: `LNode`/`layout.ts` and `drop.ts` import only
  `Rect`, and `NoteSurface` really is the one reader (5 hosts). The fault is **one level up**. The desk is
  the only full host of the layout tree, and each other screen has its own host, its own `act()` router and
  its own reader names.
- **Problem 1. The action registry is a catalogue, not the dispatcher.** Outside the desk, keys and drags
  change state directly: the board (2 `ActionSet.run` calls in 2,674 lines), the river (only `w`), and the
  welcome's `fit()`. `ActionDef.keys` is just a label. So "a change that isn't an action is a bug" holds on
  one screen. From the main menu an agent is told to "open the board, the desk or the river first", but no
  action can do that (ran).
- **Problem 2. Screens aren't presets.** `DeskPreset` is code: `Pane` instances, a layout closure and links
  by index. The screens "built on the desk" are `Desk` subclasses that override `key`, `act`, `bandRows`
  and `drawBand`. The river is a second layout engine. The board lays out its lanes with a second weight
  model inside one pane. Tile kinds are a closed union in 5 places, and `desk.ts` has 69 `instanceof`
  checks on tile classes.
- **Problem 3. The door is a second implementation of the outliner's grammar:** about 1,550 lines of
  mirrors and ports. The copies have started to disagree: 9 copies of the property-token regex use a
  different key rule from the service (ran). Positional identity is a live bug too: a split named by path
  was silently resized as a different split after the person moved a tile (ran), and `layout.get` doesn't
  even return the paths the docs say it does (ran).

## Recognised systems

| We have effectively built a… | …but currently treat it as | Ladder | Evidence |
|---|---|---|---|
| **tiling window manager**: split algebra, drop zones, tabs, drawers, floats, named layouts | the desk's internals. The board is a second, partial host, and the river sits outside it | algebra (`layout.ts`, `drop.ts`): **shared** (desk and board). Host (focus, hit-testing, frames, drag, headers): **recognised** (owner `Desk`, copied in `DeliveryBoard`) | `layout.ts:1-540`; hosts `desk.ts:51-1628`, `delivery.ts:214-345,1696-1845,2334-2517` |
| **command bus**: typed commands, arg checking, provenance, a live feed | the agents' catalogue. Keys call private methods; each screen hand-routes `act` | **provisional**: one owner (`surface/actions.ts`), fully used on 1 screen | `actions.ts:12-18` (`keys` is a string), 5 routers (F2) |
| **terminal multiplexer**: pty, headless emulator, nvim RPC, attach to Herdr | a tile kind (`PtyPane`) that the desk special-cases 21 times | **recognised** (owner `pty.ts`; persistence delegated to Herdr) | `pty.ts:1-353`, `herdr-agent.ts`, 21× `instanceof PtyPane` in `desk.ts` |
| **session manager**: what's alive in the background, what's saved, what's restored | door state: `App.background`, a static `Desk.kept`, 6 JSON files | **accidental** (two owners of "alive in the background") | `app.ts:157-170`, `desk.ts:282-288`, `writeState` in 6 places |
| **window-in-window compositor**: a screen stack inside a rectangle with its own `Ctx` | a showcase helper | **accidental → recognised**: 2 copies, living in `src/showcase/` | `showcase/frame.ts:11-124`, `desk/screen-tile.ts:26-103` |
| **layout description language** | save files plus a constructor argument | **accidental**: 5 shapes of one idea | `SavedDesk` `desk.ts:34`, `LayoutSpec` `tiles.ts:52`, `DeskPreset` `desk.ts:42`, board `Layout` `delivery.ts:61`, `SavedRiver` `river.ts:141` |
| **document engine** (render, fold, edit, comment, select, steps, embeds) | "the reader" | **shared** (board, desk, river, BBS reader, brief/welcome/waiting). It will be stable after one more host | `surface/note.ts` (3,467 lines) |
| **second outliner client library** (grammar, query language, backlink view, folder rule) | parity-tested mirrors | **accidental by design**: named in UI-GRAMMAR, but no owner exports it | F11–F13 |
| **input router / hit-testing** | each screen's mouse code | **accidental** (4 copies) | F10 |
| **extension host**: a program in a tile that drives its door over `EP0CH_CONTROL`/`EP0CH_TILE` | "a terminal tile" | **accidental** in the door. The outliner's resource-provider contract (`contract: 1`) is **provisional** (one real provider) | `pty.ts`, `claude-mod/hooks/register.ts:335`, `extensions/*/manifest.json` |
| **launcher / app switcher** | a piece of BBS art with hot spots | **accidental** for agents (no actions) | `screens.ts:209-316`, F3 |

## Findings

### Converge now

### F1  Outside the desk, keys and drags bypass the action registry; the registry lists actions but doesn't dispatch them
- where:
  - board: `desk/delivery.ts:2206` (Tab moves focus directly), `:2211-2215` (`{ } < >` call
    `resizeRegion` while `pane.resize` exists; the key path fails silently where the action refuses with a
    reason, `:1799-1802`), `:2216-2221` (`t T S b B o alt+c`), `:2223-2226` (`c` collapse; the action
    `reader.collapse` exists), `:2229-2234` (float `H J K L` changes `f.rect` directly; no action exists),
    `:2279-2299` (lane `h l j k c`; no lane actions exist).
  - board drags: `delivery.ts:2498-2515` (border, lane edge, float move and float resize all mutate
    directly). Its only `ActionSet.run` calls are 2 (grep count).
  - river: `river/river.ts:1152-1153` (`h l` set `this.focus`), `:1168` (the `p` key re-implements
    `dock()`, `:1044-1050`, inline), plus `x s space`. Only `w` goes through `RIVER_ACTIONS` (`:346`).
  - desk: `desk.ts:852` (⏎ on an exited terminal calls `pane.restart()`; `tile.restart` exists,
    `tile-actions.ts:233`).
  - welcome: `hub/welcome.ts:446,449` (`fit()` writes split weights directly, by position
    `root.kids[1]`).
  - Root cause: `ActionDef.keys` is a documentation string (`surface/actions.ts:15-16`). No binding table
    exists, so each key handler decides for itself.
- evidence: read. grep counted `ActionSet.run` calls per file.
- impact: guards, refusals, provenance and the `subscribe` feed differ between the person's path and the
  agent's path for the same change. UI-GRAMMAR's core rule is false for 2 of the 3 screens that lay out
  panes. Keymap config, which C wants, has nothing to hang on.
- fix: give `ActionSet` a binding list (`{ key, action, args }`) and route every host's `key()` and
  click through it, as the desk's `cmd()` already does (`desk.ts:433-441`). Add the missing actions:
  `lane.focus`, `lane.collapse`, `float.move`, `layout.resize` on the board. Point the river's `p` at its
  own `pin` action.

### F2  Five hand-written `act()` routers and four ways to name a reader
- where:
  - desk: `desk.ts:410-424`, names at `:941-950` (tile name, or number on screen).
  - board: `delivery.ts:560-600`: `preview`, `detail1..n`, `float1..n`, `tree`, `backlinks`, all by array
    index (`:572-580`).
  - river: `river/river.ts:916-987`: `r<id>` (stable), `3` / `3.2` (position), or a block id.
  - BBS reader: `screens.ts:577-588` (`"message"`).
  - subclass overrides: `brief.ts:247-257`, `welcome.ts:570-580`, `waiting.ts:204-214`,
    `showcase.ts:306-316`.
  - `ScreenTile.act` (`screen-tile.ts:97-101`) nests one router inside another.
- evidence: read.
- impact: an agent has to learn each screen's naming. Board names shift when a detail closes. A new screen
  has to write its own router.
- fix: one `route(req, sets, tiles)` in `surface/actions.ts`, with reader names equal to tile names
  everywhere: the board's details become named tiles, and the river's `r<id>` becomes the tile name.

### F3  An agent can't leave the main menu, or act on any BBS list screen
- where: `app.ts:304-318` (`act` refuses when the screen has no `act`). `MainMenu` `screens.ts:232` has no
  actions, and its items are a hard-coded `ITEMS` at `:209-229`. `App.openBlock` refuses too
  (`app.ts:294-296`).
- evidence: ran (`shell.test.ts` probe). Main menu, Who's Online, Last Callers, Stats and Conferences each
  list 0 actions, and `act` answers: "the main menu screen has no actions yet; open the board, the desk or
  the river first". No action can do that.
- impact: agents are first-class everywhere except getting to a screen that takes actions. That makes them
  depend on however the door was launched.
- fix: add a shell-level `ActionSet` in `App`, checked before the screen's: `screen.open key=K|name=…` and
  `screen.back`. Menu clicks and keys call it (`openItem`, `screens.ts:316`).

### F4  The river is a second layout engine; the board's lanes are a third weight model inside one pane
- where:
  - river: strip, tiers and cover at `river/river.ts:284-430`. `Col`/`PaneS` at `:34-64` (stacked panes
    split evenly at `:385`). Its own spine, frames and hit rects at `:380,:411,:69`. Saved to `river.json`
    (`:141`, `:217`).
  - board: lanes drawn inside the single `lanes` leaf with `laneWeights` (`delivery.ts:61`), lane spines
    (`:1870`) and lane-edge drags (`:2500-2507`).
- evidence: read.
- impact: pane operations (close, focus, zoom, drag, tabs, `layout.*`) don't reach river columns or lanes.
  UI-GRAMMAR §3's "R" cells can't close. This is the root of C's "screens behave differently" (see
  *Disagreement with C*).
- fix: see *Re-expressing the river as a preset* below. The smallest step is 3 general additions to
  `layout.ts`, none of them river-specific.

### Small extraction

### F5  `DeskPreset` is code, not data; the screens "built on the desk" are `Desk` subclasses
- where:
  - `desk.ts:42`: `panes: Pane[]` instances, `layout?: (ids) => LNode` (a closure), `links: [number, number][]`
    by index.
  - The band and the hint are not preset fields. They are protected methods (`desk.ts:618-622`)
    overridden by `Welcome` (`welcome.ts:429,452,524`).
  - Subclasses: `Brief` `brief.ts:91`, `Waiting` `waiting.ts:174`, `Welcome` `welcome.ts:270`,
    `PinnedPage` `pinned.ts:32`. Each also overrides `key`, `act` and `describe`.
  - The data form already exists (`LayoutSpec`, `tiles.ts:52`), so there are two layout descriptions.
- evidence: read.
- impact: a "preset" can't be saved, sent by an agent, or stored as a screen note (PIE-412 slice 3). A
  screen's keys live in overrides, not in an `ActionSet` the router sees. A new screen means a new
  subclass.
- fix: `DeskPreset = LayoutSpec + { band?, keys?: ActionSet, digits?, frame? }`. Register `WelcomeList`,
  `WaitingPane` and `BriefReader` as tile kinds (F16) so the preset names kinds, not instances.

### F6  Screen-in-a-tile exists twice, lives in `showcase/`, and can't host the BBS screens
- where:
  - `ScreenTile` (`desk/screen-tile.ts:26-103`): closed to `board|river|brief` (`:15-24`, built through
    `require`).
  - `ScreenPane` (`showcase/frame.ts:92-124`): any screen, with different key rules (it keeps `/`, and
    `esc`/`q` on the first screen, at `:117-119`; `ScreenTile` keeps only `1-9 V`, at `:76`).
  - The desk imports the showcase: `screen-tile.ts:10`.
- evidence: read.
- impact: the brief's premise that "the 13 BBS screens … ScreenTile can host" is false today. Only the
  showcase can frame them.
- fix: move `FramedScreen` to `src/desk/` (or `src/shell/`). Keep one `ScreenTile` taking a factory from
  a screen registry. Delete `ScreenPane` (37 lines).

### F7  Who's Online and the activity list are still built twice
- where:
  - `WhoOnline` `screens.ts:666-707` and `WhoPane` `desk/panes.ts:467-504`: the title look-up is the same
    code (`screens.ts:674-683` ≈ `panes.ts:477-486`).
  - `LastCallers` `screens.ts:709-749` (80 rows, no refresh) and `ActivityPane` `panes.ts:431-465`
    (60 rows, 1.5 s debounce).
  - `WhoOnline.onEvent` re-asks `clients.list` on every outline event (`:685`).
- evidence: read.
- fix: menu `W`/`L` open a one-tile preset of `who`/`activity` (PIE-430). Delete the two screens (83
  lines).

### F8  Four live searches, one dead one, and the service's ranked search unused
- where:
  - BBS `Search` (`screens.ts:649-664`): never constructed.
  - desk `/` (`SearchOverlay`, `desk.ts:1629-1670`): `blocks.query` text search, with its preview through
    `colourBody` (`:1699-1704`).
  - river `/` (`OutlineIndex`, `river.ts:82-104`): runs over a full `tree.index` held in memory and
    written to `river-index.json` (`:229-237`). The river's filter `parseFilter`/`passes` (`:121-140`)
    re-implements `query.expression`.
  - board `g` board picker (`delivery.ts:2197`), and `[[page]]` look-ups (`note.ts:1786`).
  - The service's Goto search `tree.search` (`pi-herdr-outliner/src/server.ts:1555`) is not used by the
    door (grep).
- evidence: read. grep found no `new Search` and no `tree.search` in the door.
- fix: one jump palette as a shell overlay over `tree.search`, used by every view. Delete `Search`,
  `SearchOverlay` and the river's palette (about 100 lines).

### F9  "A reader that holds its note" ×4, one of them test-only
- where:
  - `DetailPane` (`tiles.ts:69-79`, which already has `page`)
  - `PinnedReader` + `PinnedPage` (`hub/pinned.ts`, 101 lines; only `test/hub.test.ts:7` imports it; no
    `src` importer)
  - `BriefReader` (`brief.ts:50-80`)
  - `WelcomeDetail` (`welcome.ts:183`)
- evidence: read. grep found no `src` user of `hub/pinned.ts`.
- fix: `DetailPane` with a source (`page:`, `newest:<query>`) and a header hook. Delete `hub/pinned.ts`.

### F10  Hit-testing, frames and hint rows are per screen
- where:
  - hit-testing: `Pointer` `screens.ts:56-124`; desk `hits/heads/markHits/handles` `desk.ts:90-95`;
    board `rects` + `topAt` `delivery.ts:844`; river `hits/colRects` `river.ts:69`.
  - frames: `desk.ts:638`, `delivery.ts:1836`, `river.ts:380`.
- evidence: read.
- fix: this goes away with F4 and F5 (one tree host). Until then, LEAVE `Pointer` for the art screens.

### Client → server (and client → shared library)

### F11  The property-token regex is copied 9 times, with a different key rule from the service
- where:
  - `[\w-]+::[^\]]*` in `board.ts:66`, `text.ts:55`, `props.ts:150`, `river.ts:119`, `panes.ts:392`,
    `props-panel.ts:66`, `completer.ts:55`, `showcase/seed.ts:356`.
  - `[A-Za-z][\w.-]*` in `desk/writes.ts:10,103`.
  - The service's rule is `properties.ts:12` `[A-Za-z][A-Za-z0-9_.-]*::[^\]\r\n]+`. The door has it right
    once, in `views.ts:38`.
- evidence: ran (`props.ts` probe, door `titleLine` against the service's `firstLineWithoutPropertyTokens`):
  - `Plan [2nd-pass::yes] beans`: the door hides the token; the service keeps it as text.
  - `[empty::]`: the door hides it; the service keeps it.
  - `Plan [plot.row::3] beans`: the door shows it; the service treats it as a property.
- impact: titles, card text and the river's cards disagree with Detail on real notes.
- fix: now, one `PROPERTY_TOKEN` in `props.ts` copied from the service. Later, the shared module (F13).

### F12  The door ports the query language and owns the "move a card into a view" semantics the service lacks
- where:
  - `query.ts` (257 lines, a port of `block-query.ts`), `move.ts` (234), `desk/writes.ts` (159).
  - `views.ts` fallback evaluator (`:1-9`, `:150-178`).
  - The river's local filter (F8).
  - The outliner has no plan endpoint (grep for plan/membership-patch found nothing).
- evidence: read.
- impact: Tree (virtual branches), the CLI's `work_stage` and agents can't ask "what would put this block
  in that view?". Another client would port 650 lines again.
- fix: add a service action `views.planWrite {view, block | text}` → `{ patches } | { refused: term }`.
  Delete the door's port. Delete the `views.ts` fallback once `views.read` is the minimum protocol.

### F13  Grammar mirrors should be one module the outliner exports, not copies
- where:
  - `literal.ts` 123, `inline.ts` 94, `components.ts` 107, `backlinks.ts` 424, `discover.ts:143-192`
    (`outlineForFolder`).
  - `components.ts:1-6` reads the outliner's own
    `$XDG_CONFIG_HOME/pi-herdr-outliner/document-renderers.json` on the door's machine, which is not the
    service host's for a remote door.
- evidence: read. The parity tests import the live checkout at test time (`literal.test.ts:44`,
  `rendering.test.ts:228`) and `skipIf` it's absent. The comments cite `test/inline.test.ts` and
  `test/components.test.ts`, which don't exist (ran `ls`).
- position:
  - Pure paint-time grammar (literal regions, inline Markdown, the backlink view, the property token)
    belongs in a **shared library** that pi-herdr-outliner exports and the door depends on. It shouldn't be
    a socket call per paint.
  - Anything that depends on the host's data (the component registry, folder → outline) is a
    **service/host call**.
- fix: see the *Client → server candidates* table.

### F14  Attention marks are door-local; nvim marks are stored by line number
- where: `desk/marks.ts:10-30` (`marks.json`); the `line` field is kept beside the extmark id.
- evidence: read.
- fix: PIE-423's service store (`marks.*` plus change-feed events). Store the extmark or passage anchor,
  not the line.

### Extension blocker

### F15  Tile kinds are a closed union in 5 places, and the desk dispatches by class
- where:
  - `PaneKind` `desk/panes.ts:15-19`, `TILE_KINDS` `tiles.ts:54`, `makeTile` switch `tiles.ts:57-66`,
    `ADD` key map `desk.ts:45`, special cases `desk.ts:891,1012,1017`, `SCREEN_KINDS` + `require`
    `screen-tile.ts:15-24`.
  - `desk.ts` has 69 `instanceof` checks on tile classes: ReaderPane 26, PtyPane 21, PreviewPane 8,
    ScreenTile 7, BacklinksPane 3, DetailPane 3, TreePane 1.
  - `Pane` (`panes.ts:43-76`) has no `actions()`, no `describe()` and no `viewport()`. The desk routes
    `BACKLINKS_ACTIONS` by class (`desk.ts:416`).
- evidence: ran (grep count), read.
- impact: no third party (nor the welcome, waiting or brief panes) can add a tile kind without editing core.
- fix: `registerTileKind({ kind, key?, make(spec), actions?, describe? })` in `tiles.ts`. Give `Pane` an
  optional `actions(): ActionSet` and `viewport()`, and have the router (F2) use them.

### F16  Import direction: the primitives are clean, but the tile layer and the protocol import features
- where:
  - clean: `desk/layout.ts:11` and `desk/drop.ts:10-11` import only `Rect` (and `layout`'s own types).
  - `socket.ts:10-11,96`: the protocol imports a value from `backlinks.ts` (the view mirror) and a type
    from `projection.ts` (a renderer). The protocol doesn't import the UI at runtime, but its wire types
    are owned by view modules.
  - `desk/tiles.ts:19` → `hub/now` (feature).
  - `desk/pty.ts:20` → `herdr-agent` (feature) and `:19` → `control`.
  - `desk/screen-tile.ts:10` → `showcase/frame`, and `:21-23` → `require` of delivery, river and brief.
  - `desk/panes.ts:2-8`: the `Pane`/`DeskApi` contract lives in a file that imports BBS `packs` and
    `art-view` for `ArtPane`.
- evidence: read (import graph dumped for all of `src`).
- fix: move the wire types into `socket.ts` (or a `protocol.ts`), and the contract into `desk/pane.ts`.
  Inject the kinds through the registry (F15).

### Identity

### F17  Splits are named by position with no layout revision; `layout.get` has no paths
- where: `layout.resize path` (`tile-actions.ts:90,243`). Paths come only from `shapeOf` (`desk.ts:1211-1216`,
  the feed's `layout.changed`). `layout.get` uses `describeTree`, which has no `path`
  (`desk.ts:1180`, `layout.ts:534-540`). `Split.key` exists (`layout.ts:19`) but the desk never sets one.
- evidence: ran (`identity.test.ts`, `daily` layout):
  - The agent saw path `2` = `col(draft, side)`.
  - The person moved `middle` to the left edge.
  - The agent's `layout.resize path=2 share=0.2` then answered ok and resized `col(tree, preview)` instead.
  - `layout.get`'s tree contains no `path` field.
- impact: with two actors (the person and an agent, or two agents), commands land on the wrong target
  without a word.
- fix: give splits stable keys (auto-assigned `s<n>`, kept in `LayoutSpec`) and address them by key.
  Put keys in `layout.get`. Optionally take `rev=` on `layout.*` and refuse when it's stale.

### F18  Names and numbers collide; other things are identified by label or by index
- where:
  - `tileNamed` checks a name before a number (`desk.ts:941-947`).
  - board readers `detailN`/`floatN` by index (`delivery.ts:572-580`).
  - "this terminal is a Herdr agent" is decided by matching the program's title text (`pty.ts:112`,
    `herdr-agent.ts:203`; the comment says the agent may set its own title).
  - the outliner's Claude mod opens in the tile labelled `middle`
    (`pi-herdr-outliner/claude-mod/hooks/register.ts:335`), a name from one built-in layout.
- evidence: ran. `tile.open name=1` was accepted, and `tile.info reader=1` then answered the new tile,
  not the tile in first place. The rest: read.
- fix:
  - numbers only as `#3`
  - board readers as named tiles
  - Herdr persistence as a tile spec field set by `herdr-agent`, not by title
  - the door's `open` from `EP0CH_TILE` lands in that tile's link (PIE-473), so the mod needn't know
    `middle`

### Consistency

### F19  Two owners of "what's alive in the background", five layout shapes
- where: `App.background` `app.ts:157-170` and `Desk.kept` (static) `desk.ts:282-288`. Only an un-preset
  desk can be kept. Layout shapes as in *Recognised systems*.
- evidence: read.
- fix: `App.background` is the one owner (`D` looks there). One `LayoutSpec` shape for `desk.json`,
  `delivery.json` and `river.json`.

### F20  Pane operations aren't the same set on the two tree hosts
- where: the desk hosts no floats (`placeScreen({… floats: [] })`, `desk.ts:586`, `:959`). The board has
  no zoom or split (`delivery.ts:1806`). The river has neither.
- evidence: read.
- fix: follows from one host (F4, F5).

### LEAVE ALONE

- **`layout.ts` / `drop.ts`:** pure, generic over `I`, well tested (89 tests pass across layout, tiles,
  desk-tiles, agent-interface and panes; ran). Extend it; don't restructure it.
- **`NoteSurface` as the one reader**, and `SurfaceHost` as its seam.
- **The art screens** (Logon, Goodbye, Help and the menu's art) as `Screen`s. They are compositions, not
  layouts. The menu needs actions (F3), not a preset.
- **The act/peek/subscribe socket shape and `ActionSet`/`ActionDef`.** Make them stricter (F1, F2, F15),
  not different.

### Later

- Screen notes in the outline (PIE-412 slice 3), once F5 makes presets data.
- The hub screens (`WAITING_QUERY` `waiting.ts:56`, `findWelcome` `welcome.ts:60`, `findBriefs`
  `brief.ts:40`) as a saved view plus a preset each.
- External tile kinds as manifests of terminal programs (see *Extension contract*).

## Re-expressing the river as a preset (paper)

The attempt is written against today's types. Each ✗ marks where it breaks.

```ts
const river: LayoutSpec = {
  name: "river",
  rule: "river",                        // ✗ OpenRule is only "current" (tiles.ts:51); desk.ts:82 still mentions the river's rule
  focus: "r1",
  root: {
    t: "split", dir: "row", key: "strip",
    policy: {                           // ✗ no per-split placement policy; place() sizes kids by weight only (layout.ts:99)
      kind: "strip", anchor: "c2", keep: "c1",           // ✗ no node attributes beyond weights and key
      full: { min: 40, max: 76, frac: 0.42 }, peek: 24, spine: SPINE,
      rank: ["anchor", "keep", "docked", "distance"],
      cover: true,                      // ✗ a peek is drawn at reading width under its right-hand neighbour; placed rects never
                                        //   overlap except drawers, and Pane.render(w, h) can't be clipped (layout.ts:302-340)
      hide: "farthest",                 // ✗ place() gives every leaf ≥ MIN_COLS (layout.ts:47); the river drops far columns (river.ts:305-306)
    },
    kids: [
      { t: "split", dir: "col", key: "c1", weights: [1], kids: [
        { t: "leaf", kind: "cards", name: "r1", source: "roots" } ] },            // ✗ no "cards" tile kind (TILE_KINDS tiles.ts:54)
      { t: "split", dir: "col", key: "c2", dock: true, weights: [0.5, 0.5], kids: [ // ✗ dock flag
        { t: "leaf", kind: "cards", name: "r4", source: "block:<id>", filter: "status=open" },   // ✗ TileSpec has no filter
        { t: "leaf", kind: "cards", name: "r5", source: "tag:project=garden" } ] },
    ],
  },
  keys: { h: "tile.focus dir=left", l: "tile.focus dir=right", w: "layout.widen", p: "layout.dock",   // ✗ no preset keymap (F1, F5)
          s: "tile.open kind=cards where=down", x: "tile.close", f: "cards.filter", "#": "cards.tag", "/": "jump" },
};
```

**What already fits:**
- A column is a `col` split of stacked tiles, with equal weights.
- Focus is separate from layout. The desk already works that way, and `tile.focus` moves nothing.
- `r<id>` becomes the tile name, which is better than the river's positional `3.2`.
- `tile.close`, `pane.zoom`, drag and tabs come free.
- `river.json` becomes a `LayoutSpec`.
- The river's `pick` (`river.ts:948-987`) and its `act` router go.
- Back/forward between columns (`Col.from/ahead`, `river.ts:64`) maps onto the tile link (PIE-473) plus a
  desk-level history. That's one missing piece, not a new model.

**What it actually requires**, all general:
1. **A split placement hook** in `place()`: `PlaceOpts.sizes?(split, avail) → number[]`. The board's
   lane spines use it too.
2. **Draw box ≠ visible rect:** `Placed` returns both, and the host clips and dims. That gives "cover".
3. **Hidden leaves** (zero size when there's no room), as shiki's width tiers do (UI-GRAMMAR §6).
4. **Node attributes** saved in `LayoutSpec`: `anchor`, `keep`, `dock`.
5. **`OpenRule: "river"`** and a preset keymap.

A `cards` tile kind would be the river's `PaneS` rendering (`river.ts:429-510`), extracted.

**Verdict:** the river doesn't have different semantics. Cover is presentation, and a split policy can hold
it. It should become a preset.

**MainMenu:** it is a launcher, not a layout. Leave it out. It needs `screen.open` (F3).

## Tables

### Gap matrix: screens × missing layout capability

Key to the capability columns:
- **K**: a tile kind exists for its content
- **D**: it can be written as data (`LayoutSpec` with names)
- **B**: art or band rows as a preset field
- **Keys**: keys are a preset keymap routed through actions
- **P**: a split placement policy (tiers, fit, fixed widths)
- **C**: cover and hidden leaves
- **G**: tiles generated from data (one per lane or column)
- **S**: a screen stack inside a tile
- **O**: overlays and pickers as floats

✓ = supported, ✗ = missing, ~ = partial, · = not needed.

| Screen | Today | K | D | B | Keys | P | C | G | S | O | Smallest change to close it |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Desk | the tree's host | ✓ | ✓ | · | ~ (F1: `desk.ts:852`) | · | · | · | · | ✗ (no floats, `desk.ts:586`) | host floats, `tile.restart` on ⏎ |
| Brief | `Desk` subclass | ~ (`BriefReader`) | ✗ | · | ✗ (`brief.ts:225`) | · | · | · | · | · | `DetailPane` with `newest:` source; `BRIEF_ACTIONS` as preset keys |
| Waiting | `Desk` subclass | ✗ (`WaitingPane`) | ✗ | · | ✗ | · | · | · | · | · | register the `waiting` kind; preset as data |
| Welcome | `Desk` subclass | ✗ (`WelcomeList`) | ✗ | ✗ (override) | ✗ (digits, `L`) | ✗ (`fit()` `:440`) | · | · | · | · | band spec plus `sizes` policy; kinds registered |
| PinnedPage | test-only | ~ | ✗ | · | · | · | · | · | · | · | delete (`DetailPane.page`) |
| Board | own tree host | ~ (lanes aren't tiles) | ~ (`delivery.json`, its own fields) | · | ✗ (F1) | ✗ (lane spines) | · | ✗ (a lane per view) | · | ✗ (composer, mover, steps, `g` inside the screen) | lanes as generated tiles, the `sizes` hook, board keys as bindings |
| River | own engine | ✗ (`cards`) | ✗ (`river.json`) | · | ✗ | ✗ | ✗ | ✗ (a column per open) | · | ✗ (palette, tags, help) | the 5 requirements above |
| Showcase | sections of preset desks | ✓ | ✗ (`deskOf` builds instances) | · | ~ | · | · | · | ✓ (`ScreenPane`) | · | after F5 and F6 |
| MessageReader | screen | ~ (`ReaderPane` + `SurfaceHost.header`) | ✗ | · | ✓ (`MESSAGE_ACTIONS`) | · | · | · | ✗ (next/previous push screens) | · | a reader tile with a list source |
| MessageList, Conferences, FileAreas | screens | ✗ (no generic list-of-notes tile) | ✗ | · | ✗ | · | · | · | ✗ | · | one `list` tile kind over a query |
| WhoOnline, LastCallers | screens | ✓ (`who`, `activity`) | · | · | ✗ | · | · | · | · | · | delete (F7) |
| ArtViewer | screen | ~ (`ArtPane`, a second implementation) | · | · | ✗ | · | · | · | · | · | one art tile |
| Stats | screen | ✗ | · | · | ✗ | · | · | · | · | · | a `stats` tile kind (PIE-430 dashboard) |
| Search | dead | · | · | · | · | · | · | · | · | · | delete (F8) |
| MainMenu, Logon, Help, Goodbye | art screens | leave out | | | ✗ (no actions, F3) | | | | | | `screen.open` / `screen.back` actions |

### Pane operations: which path runs (the key-map slice in my lens; C owns the full key map)

| Operation | Desk | Board | River |
|---|---|---|---|
| focus | action (`tile.focus`) | direct (`delivery.ts:2206`) | direct (`river.ts:1152`) |
| resize by key | action | direct (`resizeRegion`, fails silently) | · |
| resize by drag | action (`layout.resize`) | direct (`delivery.ts:2500`) | · |
| close | action | direct `closeReader` (`delivery.ts:2230`) | direct |
| float / dock | · (no floats) | direct `popOut`, float nudges with no action | direct `p` (a copy of `dock()`) |
| collapse / spine | · | direct (`c`) | automatic |
| restart a program | direct (`desk.ts:852`) | · | · |

### Client → server candidates

| The door computes | Where | Owner should be | What it would expose | Who benefits |
|---|---|---|---|---|
| property-token grammar | 9 regexes (F11) | shared library now; `properties.preview` exists | export `PROPERTY_PATTERN`/`stripPropertyTokens` | door, Detail, Tree, CLI |
| literal regions | `literal.ts` | shared library | `scanLiteralRegions` (already in `properties.ts:194`) | door, any new client |
| inline Markdown | `inline.ts` | shared library | Detail's `attributed-markdown` as a pure function | door, a web client |
| component renderers | `components.ts` | **service** (the registry is the host's config) | a rendered component in `blocks.read`, or `components.render` | a remote door, Detail over SSH |
| backlink view | `backlinks.ts` (424) | shared library (it's client-side in the outliner too, `backlink-view.ts`) | export `backlinkView` | door, Detail, CLI |
| view-write planning | `query.ts`, `move.ts`, `writes.ts` (~650) | **service** | `views.planWrite` | Tree, CLI `work_stage`, agents |
| view membership fallback | `views.ts:150-178` | service (`views.read` exists) | raise the minimum protocol, then delete | door |
| folder → outline | `discover.ts:143-192` | **host** | `outlines.resolve {folder}` on the outline host | door, Claude mod, launcher |
| search | `OutlineIndex`, `SearchOverlay` | service (`tree.search` exists, unused) | nothing new | door, every screen |
| river filter, child counts | `river.ts:121-140`, `:89` | service (`query.expression`, `hasChildren`) | nothing new | door |
| attention marks | `desk/marks.ts` | service (PIE-423) | `marks.*` plus feed events | Detail, Tree, agents |
| presence host label | `socket.ts:485-495` guesses "ep0ch door" from the id prefix | service | `clients.list` gives a display kind | every presence view |
| activity merge | `socket.ts:498-503` (3 requests merged) | service | `activity.recent` with no author filter | door |
| which change kinds invalidate what | `app.ts:16`, `welcome.ts:261` | service (change records) | a `scope` on each change | door caches |

### Hard-coded values (my lens only; B owns host values)

| Value | Where | Class |
|---|---|---|
| tile kinds, `^W o` letters | `panes.ts:15`, `tiles.ts:54`, `desk.ts:45` | accidental (should be the registry) |
| menu items | `screens.ts:209-229` | accidental (should be the registry plus `screen.open`) |
| built-in layouts | `tiles.ts:106-126` | sensible default (data, fine) |
| river tiers `PEEK=24`, `FULL` 40–76 / 42% | `river.ts:71`, `:304` | sensible default (becomes policy fields) |
| Claude mod's `middle` | `claude-mod/hooks/register.ts:335` | accidental (identity by label) |

### Deletion pressure (if the architecture were used everywhere)

| What | Lines |
|---|---|
| grammar and query ports (`literal`, `inline`, `components`, `backlinks`, `query`, `move`, `writes`, `views` fallback, `outlineForFolder`) | ~1,550 |
| the board's own tree host (drawers, slots, regions, reader names, mouse and drag, frames: `delivery.ts:214-345,572-620,1696-1845,2334-2517`) | ~350 of ~500 |
| the river's layout, render, mouse and addressing (`river.ts:284-430,916-987,1214-1291`) plus `river.json` | ~300 |
| the `act` routers (9) → one | ~70 |
| searches (`Search`, `SearchOverlay`, the river's palette and index) | ~100 |
| `WhoOnline` + `LastCallers` | 83 |
| `hub/pinned.ts` | 101 |
| `ScreenPane` | 37 |
| property regex copies | 9 |
| **total** | **~2,600 of 25,839 (≈10%)** |

**The central test.** Suppose another client arrives tomorrow. It would rebuild the grammar mirrors
(~430 lines plus 424 for backlinks), move planning (~650), folder → outline and marks.

Suppose instead another door screen with a different layout. It would have to subclass `Desk` or write a
host like the board's (~500 lines), plus its own `act` router, reader names, key handling and hit-testing.
Its content couldn't become a tile kind without editing 5 core places.

### Extension contract (today)

**Outliner:**
- **Resource providers:** `manifest.json` with `contract: 1`, `id`, `version`, `command`,
  `configSchema` (`extensions/jira/manifest.json`), enabled in `resource-extensions.json`, run as a
  process. They are installed without a rebuild. This is a real contract.
- **Document renderers:** `renderer.layout` data only, with one layout (`labelled-values`,
  `extensions/status-summary/manifest.json`).
- **Pi adapter** (`pi-extension/index.ts`) and the **Claude mod** (`claude-mod/hooks/register.ts`, which
  registers MCP tools).

**Door:**
- It registers no providers.
- What reaches it: resource projections (drawn, never fetched), component renderers (through the mirrored
  registry), `ep0ch --skill` listing, and any program in a terminal tile, which can drive the door over
  `EP0CH_CONTROL` and `EP0CH_TILE`. That last one is the de facto plugin API, and the Claude mod uses it.

**What an extension can add:**

| Add | Where it works |
|---|---|
| resources | outliner |
| component rows | outliner, drawn by both |
| actions | only as an outside caller of `act`, never as a registered `ActionSet` |
| tile kinds | no |
| views or screens | no |
| keys | no |

**What a third party needs to add a tile kind without editing core:**
1. a tile-kind registry (F15)
2. `Pane.actions()` routed by the one router (F2)
3. bindings in `ActionSet` (F1)
4. a loader

The cheapest loader: manifests of terminal programs, `tiles/<name>.json` →
`{ kind, cmd, key?, name }`, opened as a `pty` tile with `EP0CH_CONTROL`. That needs no in-process code,
and it's how the Claude agent already works.

## Disagreement with C

C will likely say the screens behave too differently for general splits: river `x/p/s/w`, board
`x/o/c/{}`, desk `^W`. My position is that the differences are **caused** by the separate hosts, not
intrinsic:
- Every divergent key in UI-GRAMMAR §4 F4 is a pane operation implemented three times (F1, F2, F20).
- The paper preset shows the river's one real difference, cover/peek, is a placement policy on one split.
  It doesn't need a different pane model.

Putting all three on one host with a keymap makes `close`, `focus`, `zoom` and `resize` identical. Each
screen keeps only its own verbs (`w` widen, card moves). Where C finds a behaviour people rely on (the
river's "focus never moves the layout", Sep 29), it's already the desk's rule, so it survives the move.

I concede one point: cover/dim is right for the river and wrong as a global default. It should be a
per-split policy, never a desk-wide setting.

## Docs that are wrong

**UI-GRAMMAR:**
- **Line 3:** "checked against the code on `feature/door-writes`". Stale; the doc is on `main` now.
- **Line 15** "(the key, the mouse and `act` all call it)". True on the desk only (F1).
- **Line 17.** It lists `bandRows`, `drawBand` and `screenHint` as parts of `DeskPreset`. They are
  protected `Desk` methods overridden by subclasses (`desk.ts:42,618-622`).
- **Line 20.** It should name `ScreenPane` as the parallel copy and say that `ScreenTile` takes only
  `board|river|brief` (`screen-tile.ts:15`).
- **Lines 30-31, 45-47 and F1 (325-339)** "`colourBody` … the river's cards". The river only imports it
  now (`river.ts:29`, unused). The desk's search preview still uses it (`desk.ts:1703`).
- **Lines 57-58** ("Backlinks exist only on the board … no history on any screen"). These contradict
  §3's own rows (the backlinks tile, PIE-453 history).
- **Line 110** ("the river as a layout with its open rule") **and line 117** (`river` open rule). The river
  isn't on the tree, and `OpenRule` is only `"current"` (`tiles.ts:51`). Also fix the comment at
  `desk.ts:82`.
- **Stale `file:line` citations (almost all of them).** For example: `scr:273` MessageReader is
  `screens.ts:408`; `scr:338` Search is `:649`; `scr:355` WhoOnline is `:666`; `scr:392` LastCallers is
  `:709`; `pan:411` WhoPane is `panes.ts:467`; `pan:375` ActivityPane is `:431`. Cite symbols, not lines.
- **§4 F2** ("Board: fractions (`del:37`)"). The board is on the tree (slice 1). The line predates it.

**AGENT-INTERFACE:**
- **`layout.resize` | `path` (from `layout.get`).** `layout.get` returns no paths. They are only in the
  feed's `layout.changed` (ran).

**README:**
- **Line 257** ("views in one layout tree"). The river and the BBS screens aren't. Line 407 is right about
  the board, but the lanes are drawn inside one leaf.

**Source comments:**
- `components.ts:5` cites `test/components.test.ts` and `inline.ts` cites `test/inline.test.ts`. Neither
  exists; the checks are in `test/rendering.test.ts`.

**The review brief** ("The 13 BBS screens … are standalone `Screen`s that `ScreenTile` can host"). Only
the showcase's `ScreenPane` can frame them (F6).

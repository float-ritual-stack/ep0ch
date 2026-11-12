# Native ep0ch: one catalogue, one layout, one dispatcher

**Base:** interaction-first (hands first, `TileCx`, `App::person`, `one_owner.rs`, per-tile memo). **Grafted:** grammar-first's saved-tree shape, one list over `site.answer` and the forkability check; service-first's `ActionRow`, served validation, shipped screens as one extension and `PRIMS` by primitive type.

**The claim, bounded.** A new screen, or a tile over an existing source, is a note. A new list source is one host producer, written once for every client. A new drawer is Rust, and there are four.

**Basis.** The maps and judges, plus spot reads of `desk/layout.ts:1036-1045`, `desk/tiles.ts`, `desk/screen-specs.ts`, `surface/keymap.ts` and the Waiting manifest. W0, W1, W2, the first hydra sweep, W3 and W4 are built: [PROBES.md](PROBES.md) has what the probes found, and where this page says more than the code does, the line says "not built yet".

## 1. Primitives

| Primitive | Owns | Describes itself as |
|---|---|---|
| **Store** | every read, watch, re-ask, stale `last()`, the 64-slot budget; one `Link` per outline and machine | the `Ask`; `peek` lists slots, their tiles and `n/64` |
| **Action** | every state change; the dispatcher checks the actor against `touches` and records the step | `ActionRow` in outline-core: `id, summary, args, touches, keys, while, menu, examples, answer` |
| **Key table** | chord to act line, per whereabouts layer | rows `{chord, line, layer, from}` |
| **Layout** | arrangement, focus, wires, policy, floats, folds; `place` | the door's saved tree; `Landing {tile, why}` |
| **Kind row** | what a tile kind is: a drawer, a source, its fields | the `extensions.list` `tileKinds` row, carried on `screens.list` as `kinds`: `{kind, name, about, drawer \| render \| view \| command, fields, replaces}` |
| **Drawer** | drawing one answer shape: `page`, `list` (built), `view`, `pty` (not yet) | `{id, about, notes, lists, facts}` |
| **Primitive registry** | one `El` builder per primitive type the service answers (`tiles/prim.rs`) | `{type, describe, fills}`, held to `outline-core/fixtures/primitives.json` |
| **Draft** | one editor and lifecycle (block, comment, card); held by the App, shown by a tile or a float | `{target, base_rev, holder, status}` |
| **Screen** | a named layout with keys, lands, menu | `ScreenSpec` as `screens.list` answers it, with `problems` |

```rust
// store.rs
struct Ask { at: OutlineAt, action: String, params: Value, watch: bool }  // equal asks share one slot
struct Store { links: HashMap<OutlineAt, Box<dyn Link>>, slots: HashMap<AskKey, Slot<Value>>, users: HashMap<AskKey, HashSet<TileId>> }
// actions/mod.rs: the row is data; `run` is Rust
struct Action { row: &'static ActionRow, run: fn(&mut App, &Args, &Actor) -> Outcome }
impl App { fn act(&mut self, line: &str, by: Actor) -> Outcome }
// layout.rs: no Rune, no socket
enum Node { Leaf(TileSpec), Split{dir, weights, kids}, Tabs{active, kids}, Columns{kids}, Flow{anchor, kids}, Dock{side, open, kid} }
fn apply(l: &Layout, op: Op, by: &Actor) -> Result<Layout, Refusal>;
fn place(l: &Layout, req: &OpenRequest) -> Landing;
// tiles/mod.rs
struct Drawer { id: &'static str, asks: fn(&TileSpec, &KindRow) -> Vec<Ask>, draw: fn(&TileCx) -> El, facts: fn(&TileCx) -> Value, takes_keys: bool }
// tiles/prim.rs (it builds `El`s, so it sits inside the renderer seam; `parts.rs` is its Rune-free model)
struct Prim { ty: &'static str, describe: &'static str, fills: bool, build: fn(&Value, &PrimCx, &Kit) -> El }
static PRIMS: &[Prim];
// draft.rs
struct DraftSession { target: Target, base_rev: u64, buf: TextEdit, hold: Lease }
```

`TileCx` hands a drawer the store (read-only), its `TileSpec`, its `TileUi`, `cx.act(line)` and `cx.emit(verb, subject)`: no `&mut Layout`, no socket. `Node` reads both of the door's saved forms (`ratio, a, b` and `weights, kids`) and saves `kids`.

Not primitives: an Attachment (it is a follower tile), a presets folder, a figure-name registry. The terminal is the `pty` drawer behind a cargo feature.

## 2. A screen is a note

A `[type::screen]` note in the outline: two bodies, one spec. The door's JSON fence stays. New: child blocks, where nesting is the tree and properties are the door's flat `TileSpec` fields. `screens.list` lowers both to one validated `ScreenSpec`; `screen.save` writes the block form.

```text
Garden work [type::screen] [screen::garden-work] [lands::reader] [focus::beds]
- split row [ratio::0.3]
  - tile query [name::beds] [query::type=bed NOT stage=done] [select::reader]
  - tabs
    - tile reader [name::reader]
    - tile backlinks [name::links] [source::tile:reader] [subject::follows]
- keys
  - ctrl+l [action::bar.open source=query]
```

Lowered, in the door's saved shape:

```json
{"name":"garden-work","lands":"reader","keys":[{"key":"ctrl+l","action":"bar.open","args":{"source":"query"}}],
 "layout":{"focus":"beds","root":{"t":"split","dir":"row","weights":[0.3,0.7],"kids":[
  {"t":"leaf","kind":"query","name":"beds","query":"type=bed NOT stage=done","wires":[{"verb":"select","to":"reader"}]},
  {"t":"tabs","active":0,"tabs":[{"t":"leaf","kind":"reader","name":"reader"},
   {"t":"leaf","kind":"backlinks","name":"links","source":"tile:reader","subject":"follows"}]}]}}}
```

As built in W2 (outline-core's `screen-note.ts`, which holds the whole form): a key is named as the door names keys
(`ctrl+l`; `readSpec` refuses `mod+l`), a tab set saves its tiles under `tabs`, and what a property can't hold (a list,
an object, a typed argument) is the block's own ```json fence. `screens.save` is the one writer of the form.

- **Shipped screens and kinds:** `screens[]` and `tiles[]` of one extension, `packages/outliner/extensions/screens/` (on wherever the service runs), served by `extensions.list` and read through the same `screens.list` (bb: core uses the path it exposes). As built (W3): native compiles in no screen and no kind (`scripts/native-forkable` holds that), and opens on the screen whose spec says `start`. The door's literals for the navigator, last callers and who's online are deleted; its kinds' descriptions are the rows'. Left in the door: it holds those three screens from the extension's manifest file until a host serves them (and keeps them when the extension is uninstalled), and `desk` and `board` are still screens it makes from its own state (named layouts, a hub's views), so each of those two names is two screens, one a door.
- **Kinds:** extension tile rows already come in three shapes, each bound to a drawer with no client code: `render` to `view`, `view` query to `list`, `command` to `pty`. One new field, `drawer`, names a client-drawn kind (`page`, `list`), and `fields` what a tile of it starts with (a list's `from`). `screens.list` serves each tile's kind already resolved (a retired name, a name an extension's kind `replaces`), with what a retired name said as the tile's fields (outline-core's `canonLeaf`: a `pinned`, and a `detail` that names a page, are readers with `mode: pinned`), and the name its screen wrote as its `role`, so no client maps old names and `tile=role:reader` names the same tile in both doors. The asker says which drawers it has; a kind served for one it hasn't is said on the tile.
- **The live arrangement:** a state file per outline, `native-<outline>.layout.json` beside the control socket, as the door keeps `desk.json`. No machinery note until the door moves too.

| Spike | Becomes |
|---|---|
| tree | kind `tree`: `list` drawer, `from: children` (the list says `arrange: tree`), select wired to the reader |
| note | kind `reader`: `page` drawer over `notes.page` |
| find, query | bar sources over `from: search` and a query; the same `query` kind docks as a tile |
| edit | `draft.begin` on the reader's block |
| inspector | `props` and `backlinks` tiles with `subject: follows`, in a dock |
| toolbar | the spec's `toolbar`: act lines, one a button; label and keycap from the row (`menu` is the main menu's row, PIE-1525) |
| scenes | `scenes/*.act` |

## 3. Service and client

**Outline-core gains** (pure moves, merged to main early): `screen-spec.ts` (types, validator, tile address), `screen-note.ts` (block-form lowering), `action-row.ts` (the door's `ActionDef extends ActionRow`) and `fixtures/` (`layout-contract`, `act-lines`, `action-rows`, `screens`).

**Wire, one PROTOCOL bump at the final rebase:**
- `screens.list` (watched): notes and extension screens, validated, addresses resolved, `problems[]`. The door's `screen-notes.ts` switches to it.
- `lists.read` (watched, a module of its own: `list-producers.ts`), `from:` a producer: `children`, `search`, `query`, `lanes`, `facets`, `links`, `properties`, `activity`, `clients`, `screens`, and `sources` (the producers as rows). Each answers a `ListAnswer` around a `ListPrimitive`: rows with `chips`, the `act` line a pick runs, and for a tree `depth`, `folds`, `open` (`arrange: tree` joined `list-row.ts`); `open` says which folders are answered. As built it is its own action, not a `site.answer` producer: `site.answer` is bound to a note, and a tree or a search has none. Not built yet (W6): `threads`, `proposals`, `revisions`, `sessions`.
- `notes.page`: its row says `watch: "later"` (a module answers it over a turn and keeps the watch) and it is in `WATCHABLE_ACTIONS`, as `screens.list` is. As built in W4: a part is `{type: "part", kind, block, span, line, …, view}`: the note it is written in, its UTF-16 span in that note's text, its first line, the service's word on its answer, and the primitive to draw. A figure is the catalogue primitives outline-core's `figure-primitive.ts` lowers its answered props to (a kind with no form: the service's Markdown, else its lines as `source`); a button is a `button` with the line a press names it by, and the slots its line leaves empty as `needs` (what stops a press: any other word the service has on a button, a look it doesn't read, is said and stops none, as in the door); a box holds the parts written inside it. Which component a line starts is one function, outline-core's `componentAt`, asked by the published page, `notes.page` and the door's reader. Not built yet: an extension's component and a `::use`'s body as primitives (both are `source`); script parts cached by script, props and deps.
- `completion.rows` takes `{text, cursor}` and answers the token with its rows; the host runs `completionTargetAtCursor`.
- `draft.patch` for a native holder: a new ask kind beside today's `read`, `patch` and `revert` (PROBES §10: a `read` already hands the host the buffer; nothing hands ranges back today). The host places the patch and returns resolved ranges.
- `events.subscribe` takes client kind `native` (W4): the window registers as itself and hears `scripts.act` and `scripts.ended`, so an act a script has for a window reaches its dispatcher and is answered (`scripts.answer`). Not built yet: `door.act` aimed at a native window, and the `site.answer` `from:` producers: the bar asks `tree.search` and `blocks.query` itself and the about tiles read `notes.page` (W3).

**Client-side:** layout, ops, placement, focus, the key table, cursor and scroll, the draft buffer, drawing, picture decode, cells, windows, the arrangement file, the control socket.

## 4. One owner each

| Decision | Owner |
|---|---|
| Who acts, and whether | `rule()` in `actions/mod.rs`, the one check `App::act` makes: the actor against what the row declares (`touches`, `while`, and `person` for what is the person's own). An agent's `touches: screen` act waits until the person has been idle 2 s (`Whereabouts.idle`) |
| Who a write is recorded as | `Store::write` stamps `mutation.actorId` |
| Which tile has focus | `Layout.focus`, changed only in `apply` (`Op::Focus`, and what a load leaves); an agent's act never moves it. `keys::follow`, in `poll`, is the one reconciler and the only caller of `Tx::focus`: a press inside a tile becomes `tile.focus`, and the tile the layout names is the one Rune focuses. Each tile's root holds the keys through `keys::tile` |
| Who has the keys | `App::person() -> Whereabouts`: the bar while it is open, else the tile `Layout.focus` names, in its draft when that tile holds one. (A float and a `takes_keys` tile join when W8 builds them) |
| Which keys mean what | `keys.rs`: row defaults. Not built yet: the spec's `keys`, then the door's `keybindings.json` in its own chord names (`ctrl+w q`) |
| How a field passes keys | one `field()` adapter in `keys.rs`: table first, text second, unhandled up |
| Where an open lands | `layout::place`, in the door's order (own wire, opens-into, home, flow next, first unpinned reader); an activation's `where` maps to an open rule there. The screen's `lands` reaches it as `Ctx.lands` (a tile, or a keyed container) for an open from outside any tile, and a new note asks it with the screen's `newNote` rule. `nav::land` is the one caller |
| Whether a layout changes | `layout::apply`, with policy and agent limits. A step undone and a screen opened are operations too: `Op::Load` carries the arrangement that would take this one's place, so what would go is asked what a close is asked |
| Which tile an address names | `Layout::resolve` (`layout/address.rs`), for `tile=`, `to=` and a follower's source; the door's resolver by language, held to it by `address-contract.json` |
| What Esc closes | one step list in `keys.rs`; the hint row reads it. A border's drag has its own way back (`layout.resize` to the share at the press), never `layout.undo` |
| What a screen or kind is | `screens.list` (its `kinds` are `extensions.list`'s rows), read once in `App::served`; a kind is found by `App::kind_row` |
| What a list's rows are, and what a pick runs | `lists.read`: the window maps no answer to rows and writes no act line for one (`tiles/list.rs`, `bar.rs`) |
| What a list is asked for | `App::list_ask`: the parameters its source says it reads, by name |
| Which component a line of a note starts | outline-core's `componentAt`, asked by the published page's walk, `notes.page` and the door's reader |
| How a part of a page is drawn | `PRIMS` in `tiles/prim.rs`, by the primitive's type; the page drawer walks and matches nothing |
| Where a button's press runs | `button.press` in `actions/script.rs`: here when its one act line is an action here, else the service (`scripts.sequence`); whether it can run at all is the part's `needs`, never its `error`; a script's act for a window is read and answered by the store (`scripts.answer`) |
| Which host and outline a window opens, and where its control socket is | the door's `resolveTarget` and `placeFor`, asked every time through `resolve.ts`; the socket's name is the door's `DOORS` |
| Which door answers `act` | `controlFor` in `session/place.ts`, with `--door native` |
| Meaning of notes; a patch's place | the service |

## 5. Agents, tests, headless

- **Control:** native serves `native.sock` beside `door.sock`, with the door's verbs. `act` runs `AppHandle::update(|s, _| s.act(line, agent))`, taking no pointer, focus or selection; the status line names the actor.
- **`peek`:** `{screen, focus, whereabouts, watches, tiles: [{id, name, kind, facts, asks}]}`. Element keys are `tile/<name>/…`.
- **Headless:** `--screen <name> --act file.act --snap out.png --tree` on `App::headless_runtime`, on a scratch outline. A headless run serves no control socket (it is one frame, with no one to answer). Not built yet: `peek`'s element tree and `snap` over the control socket, which need a drawn frame (PROBES §4); `control.rs` answers `peek` from state, `actions` and `act`.
- **Tests, four levels:**
  - **Contract tables,** generated from the door's own functions and run by both suites: `{layout, op, actor}` to layout or refusal, `{layout, open}` to `{tile, why}`, act lines to requests, `{tiles, address, from}` to the tile or the refusal.
  - **Garden over `Standin`,** asserting the wire.
  - **Window tests** with a parity table: every row runs by its chord, its bar row pressed and its act line, giving one step record.
  - **`one_owner.rs`:** `place(` only in the open's own file; `Op::` only in `actions/` and `layout.rs`; `.on_key(` and `Tx::focus` only in `keys.rs`; `virtual_rows` only in `list.rs`; the arrangement written and a load issued only in `actions/layout.rs`; no refusal for whose a thing is in an action's run; an address read only by the layout's resolver; no outline or host setting read by the window. Since W3: no kind catalogue, compiled screen or list read but `lists.read`, no act line written for a list's row, and Rune named only by what draws. Since W4: a primitive is built only by the registry, and no builder or drawer reads what a part was written as. `owners.rs` holds the same by what the window does.
- **Frame cost:** each tile draws in `memo(tile.id, version)` over its spec, slot generations, focus, cursor, scroll and draft revision.
- **Every visible wave** carries a wiretext Sketch, a scene and a `kitchen` screen entry. Tests split into `src/tests/*.rs`; actions and drawers register per module.

## 6. The three likeliest hydras

1. **A second layout decider.** Rust `apply` and `place` sit beside the door's, by language. Both suites run the one generated table, and every open reaches `place` only through the `open` action.
2. **A second vocabulary.** One kind catalogue, one validator and one address resolver, all served; one action-row fixture. A portability test opens every shipped screen in both doors, and the fork check copies each into a scratch outline as a note.
3. **A second key or list.** One field adapter, one table, and one `list.rs` for tree, bar, lanes and followers.

## 7. Judges' items, resolved

- **Arrangement store, write cost:** a state file; no outline write per op.
- **Built-in screens twice:** the screens extension. `target` has `fills: <tile>.<field>` (W3: the navigator's query is data). The door's `shipped-screens.test.ts` lists the door literals left: thirteen, each made from the door's own state or of kinds only the door has.
- **Rows three ways, search:** `from:` only; `search` calls `tree.search`'s ranker.
- **Figures:** served primitives own the look; the door's `graphs.ts` stays until a figure has a service builder.
- **Templating:** none; act lines only.
- **Wire table:** a checked-in dump of the `actions.ts` flags, kept true by a test; answer shapes are serde structs checked against recorded answers.
- **Pty hosts:** one, the door's pty host protocol, for native alone; libghostty-vt only parses cells. Sharing a session's programs between the door and native needs viewers in that protocol first (PROBES §8).
- **Watch budget:** equal asks share a slot; hidden tabs release theirs and keep `last()`; `dropped` re-asks when next drawn; lanes are one grouped query.
- **Row caps, `whole` latency:** the tree answers visible rows and `truncated` draws a row that re-roots; bar typing is measured in W1, and a fix is the host row's flag.
- **More outlines:** an Ask is keyed by outline and machine; the reader keeps `outline=` and `machine=`.
- **Draft safety:** drafts belong to the App and mirror to `edit-recovery.*` on settle; a closed tile's dirty draft moves to a float.
- **Comments on a span:** by quoted text, through `quote`; no anchor maths in Rust.
- **Undo, reset, restore:** `layout.undo` over a journal, `screen.reset`; a restart reads the file and recovery. Both go through `apply` (`Op::Load` with the arrangement). Not built yet: a notice when the note changed under an arrangement.
- **Mouse:** dividers and title bars use `on_drag`; a drop point becomes `tile.move to= side=`. Rows cross tiles by action.
- **Typed handlers, windows:** the shell keeps `HashMap<TileId, TileUi>` and uses no `PaneState` or kit `Tree`; windows share one Store and budget, each with its own layout.
- **Authoring:** arrange, then `screen.save`; kinds and fields complete inside a screen note; a problem draws on the note and on the tile.
- **Host layer, floats:** floats are layout state with ops; the agent drawer is a window-level dock.
- **Sideways lanes, native menus:** rows virtualize per lane only; the bar row is the press route everywhere.
- **A kind one door lacks:** draws its spec as data.
- **Does not apply:** `layouts.apply`, `keys.table`, `actions.list`, `Does::` templates, `wire.describe` and `wire.catalog` are dropped.

**Verified by W0** ([PROBES.md](PROBES.md)): Rune sets focus from code, wraps kit fields and reads tile rects in a drag; a live window returns its elements while it draws and not while hidden; `drafts.answer`'s present shape; `replaces` gives an extension kind a bare name; the pty host has one client. Each "no" changed the adapter, the control verbs or the terminal wave, not the primitives.

## 8. Waves

Wave PRs merge into the feature branch `claude/adoring-rubin-fcfz04` (PR 1436), never into main; hydra sweeps follow W2, W4 and W7. From W1, each sentence starts "Evan opens native and…".

| Wave | Sentence | Depends on | Files | Deletes | Tests | Can parallel with |
|---|---|---|---|---|---|---|
| **W0 Ground** | Evan opens one findings note and reads the probe answers, the terminal measurement and the generated contract tables. | none | door `scripts/layout-contract.ts`; outline-core `screen-spec.ts`, `action-row.ts`, `fixtures/`; `native/probes/` | the door's own spec types and the description half of `ActionDef` | door contract test; `one-owner.test.ts` | its three parts run together |
| **W1 Hands** | …presses ⌘K, types "trash", runs it; `ep0ch act --door native note.trash` does the same, attributed. | W0 | `store.rs`, `actions/`, `actline.rs`, `keys.rs`, `control.rs`, `list.rs`, `bar.rs`, `src/tests/`; outliner `from: search`; door `place.ts` | `on_key` match, field `on_key`s, label literals, `Tag`, `Notice::Trashed`, scene fns, `palette()`, `enum Finder` | parity, `one_owner.rs`, store re-ask, budget and `dropped` | none |
| **W2 Tiles and screens** | …splits the reader, drags a tile to a dock, saves the screen, opens it in the door, breaks a kind and reads why, then resets. | W1 | `layout.rs`, `screen.rs`; `view.rs` split into `shell.rs`, `tiles/page.rs`, `tiles/tree.rs`, `tiles/about.rs`; outline-core `screen-note.ts`; outliner `screens.list`; door `screen-notes.ts` | `view.rs`, the fixed `SplitView`, both `PaneState`s, `sidebar()`, `toolbar()`, the `back` stack; the door's note reader and validator path | contract tables in cargo; portability fixture; one shell test per container | none |
| **W3 Lists** | …opens navigator, board and lastcall from the bar in both doors; tree, lanes, matches and backlinks are one list. | W2 | `list.rs` arranges; outliner `site.ts`, `list-row.ts`, `extensions/screens/`; door `screen-specs.ts`, `builtin-tiles.ts`; `scripts/native-forkable` | `tiles/tree.rs` and `tiles/about.rs` (`tree_row`, `levels`, `inspector()`); the door's moved screen literals and kind descriptions | one list over each producer; fork check; install and uninstall on a scratch outline | W4, W8 |
| **W4 Page and parts** | …opens a note with figures, boxes and a button, presses the button, and it runs here. | W2 | `tiles/page.rs`, `prim.rs`, `actions/script.rs`; outliner `note-page.ts`, `actions.ts` | `component()`, `stat_tiles`, `note()`, `chips()` in `tiles/page.rs` | every primitive type has a builder; button answers `scripts.answer`; action-row fixture | W3, W8 |
| **W5 Draft** | …edits one block with completions while an agent patches it, quits mid-word and finds the text back. | W4 | `draft.rs`, `actions/draft.rs`, `tiles/page.rs`; outliner `completion.rows`, `draft-patch.ts` | `Editing`, the whole-note `TextArea`, the guards in `open()` | capture-first tests re-aimed; hold, patch, release; recovery | W7, W8 |
| **W6 About the note** | …comments on a selection, reviews a proposal and a revision in tiles that follow the reader, and opens the keys and library screens. | W3, W5 | `tiles/diff.rs`, `actions/review.rs`; `extensions/screens/` rows; outliner producers | nothing left of the spike | follow wire; apply and dismiss on the wire; keys screen equals the rows | W7, W8 |
| **W7 Extensions and outlines** | …installs Waiting from the bar, uses, configures and uninstalls it, switches outline, and tears a tab into a second window. | W3, W4 | `ext.rs`, `actions/outline.rs`, `shell.rs` windows | nothing | install, use, uninstall on a scratch outline; two links in one Store | W5, W6, W8 |
| **W8 Terminal and agents** | …opens a shell and an agent beside a note, detaches, returns, and jumps between agents from a list. | W2 and W0's measurement | `tiles/pty.rs`, `pty/`, `Cargo.toml` feature; a new `extensions/terminal/` manifest | nothing | `takes_keys` whereabouts; a scripted pty host; redraw cost recorded | W3 to W7 |
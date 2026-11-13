# Native ep0ch: one catalogue, one layout, one dispatcher

**Base:** interaction-first (hands first, `TileCx`, `App::person`, `one_owner.rs`, per-tile memo). **Grafted:** grammar-first's saved-tree shape, one list over `site.answer` and the forkability check; service-first's `ActionRow`, served validation, shipped screens as one extension and `PRIMS` by primitive type.

**The claim, bounded.** A new screen, or a tile over an existing source, is a note. A new list source is one host producer, written once for every client. A new drawer is Rust, and there are four.

**Basis.** The maps and judges, plus spot reads of `desk/layout.ts:1036-1045`, `desk/tiles.ts`, `desk/screen-specs.ts`, `surface/keymap.ts` and the Waiting manifest. W0, W1, W2, the first hydra sweep, W3, W4, the second hydra sweep, W5, W6 and W7 are built: [PROBES.md](PROBES.md) has what the probes found, and where this page says more than the code does, the line says "not built yet".

## 1. Primitives

| Primitive | Owns | Describes itself as |
|---|---|---|
| **Store** | every read, watch, re-ask, stale `last()`, the 64-slot budget; one `Link` per outline and machine. As built (W7): the links, slots and keys are a hub the windows of a run share, and a `Store` is one window's face on it (what it wants, the answers as it last took them, what is its to hear) | the `Ask`; `peek` lists slots, their tiles (another window's named with its window) and `n/64` a link |
| **Action** | every state change; the dispatcher checks the actor against `touches` and records the step | `ActionRow` in outline-core: `id, summary, args, touches, keys, while, menu, examples, answer` |
| **Key table** | chord to act line, per whereabouts layer | rows `{chord, line, layer, from}` (`from`: `row`, or `screen` for the open screen's own) |
| **Layout** | arrangement, focus, wires, policy, floats, folds; `place` | the door's saved tree; `Landing {tile, why}` |
| **Kind row** | what a tile kind is: a drawer, a source, its fields | the `extensions.list` `tileKinds` row, carried on `screens.list` as `kinds`: `{kind, name, about, drawer \| render \| view \| command, fields, replaces}` |
| **Drawer** | drawing one answer shape: `page`, `list`, `view` (built; `view` since W7, over `tiles.view`), `pty` (not yet) | `{id, about, notes, lists, takesKeys}`; `facts` is what `peek` says of its tile |
| **Primitive registry** | one `El` builder per primitive type the service answers (`tiles/prim.rs`) | `{type, describe, fills}`, held to `outline-core/fixtures/primitives.json` |
| **Draft** | one session for whatever is written in a tile (`draft.rs`): its text, the revision it stands on, what it writes (`Writes`: a block's own text, a comment on a note, a reply in a thread), its hold on the service (a block's only), the file that keeps it; held by the App, shown by the tile it is written in. Not built yet: a card's draft, and a draft shown in a float | `peek`'s `editing`: `{note, writes, on, revision, unsaved, text, caret, held, hold, said, completing}` |
| **Screen** | a named layout with keys, lands, menu | `ScreenSpec` as `screens.list` answers it, with `problems` |

```rust
// store.rs
struct Ask { at: OutlineAt, action: String, params: Value, watch: bool }  // equal asks share one slot
struct Store { links: HashMap<OutlineAt, Box<dyn Link>>, slots: HashMap<AskKey, Slot<Value>>, users: HashMap<AskKey, HashSet<TileId>> }
// actions/mod.rs: the row is data; `run` is Rust. A line is read into a Request; one already read (a script's call,
// a row's pick, the control socket's) goes to act_request and is never written as a line to be read again
impl App { fn act(&mut self, line: &str, by: Actor) -> Outcome; fn act_request(&mut self, req: Request, by: Actor) -> Outcome }
// layout.rs: no Rune, no socket
enum Node { Leaf(TileSpec), Split{dir, weights, kids}, Tabs{active, kids}, Columns{kids}, Flow{anchor, kids}, Dock{side, open, kid} }
fn apply(l: &Layout, op: Op, by: &Actor) -> Result<Layout, Refusal>;
fn place(l: &Layout, req: &OpenRequest) -> Landing;
// actions/mod.rs: what an act is about when it names no tile; App::target finds the tile, once an act
enum About { Nothing, Any, Notes, Lists, Tree, Placed }
struct Action { row: &'static ActionRow, run: fn(&mut App, &Args, &Actor) -> Outcome, about: About }
// tiles/mod.rs
struct Drawer { id: &'static str, about: &'static str, notes: bool, lists: bool, asks: fn(&TileCx) -> Vec<(&'static str, Ask)>, draw: fn(&TileCx, &Kit) -> El, facts: fn(&TileCx) -> Value, takes_keys: bool, version: fn(&TileCx) -> u64 }
// tiles/prim.rs (it builds `El`s, so it sits inside the renderer seam; `parts.rs` is its Rune-free model)
struct Prim { ty: &'static str, describe: &'static str, fills: bool, build: fn(&Value, &PrimCx, &Kit) -> El }
static PRIMS: &[Prim];
// draft.rs: no Rune; the field's text is the seam's own type
enum Writes { Block, Comment { quote: Option<String>, near: Option<usize> }, Reply { thread: String, to: String } }
struct DraftSession { tile: Id, note: String, writes: Writes, revision: u64, base: String, buf: keys::Text, hold: Hold, told: Option<Told>, completing: Completing }
fn map_cursor(offset: usize, spans: &[Placed]) -> usize;  // outline-core's mapCursor, held by core-contract.json
```

`TileCx` hands a drawer the store (read-only), its `TileSpec`, its kind's row, its `TileUi` and one way out, `cx.act(line)`: an act line run from its tile (a row's own, a button's, an action of this window's; `App::act_from` says whether it is about that tile). No `&mut Layout`, no socket, and no line written for a row: what a pick runs is the `act` the service wrote. `Node` reads both of the door's saved forms (`ratio, a, b` and `weights, kids`) and saves `kids`.

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
- **Kinds:** extension tile rows already come in three shapes, each bound to a drawer with no client code: `render` to `view`, `view` query to `list`, `command` to `pty`. One new field, `drawer`, names a client-drawn kind (`page`, `list`), and `fields` what a tile of it starts with (a list's `from`). `screens.list` serves each tile's kind already resolved (a retired name, a name an extension's kind `replaces`), with what a retired name said as the tile's fields (outline-core's `canonLeaf`: a `pinned`, and a `detail` that names a page, are readers with `mode: pinned`), and the name its screen wrote as its `role`, so no client maps old names and `tile=role:reader` names the same tile in both doors. As built (sweep 2): a new-note rule's `only` and `unless` are resolved the same way, and a kind's row says which of the names it `replaces` it serves now (`serves`: one kind a name, the last to take it). A tile made in the window is written by the name screens write (`KindRow::written`) and found through `serves`; the layout's rules know every kind by that name (`App::known_as`), as a policy's `accepts` is written. The asker says which drawers it has; a kind served for one it hasn't is said on the tile.
- **The live arrangement:** a state file per outline, `native-<outline>.layout.json` beside the control socket, as the door keeps `desk.json`. No machinery note until the door moves too. As built (W7): a window that switches outline keeps each outline's file, and the one it left parked in memory as it stood; a window torn from another keeps no arrangement, on the outline it was torn on or on one it switches to, only what is written in it (`native-<outline>.<window>.drafts.json`, which the next run's first window on that outline brings back).
- **The kitchen** (W7): `kitchen` is a screen of the screens extension, so both doors list it: tiles and a toolbar that show the parts each wave added. Today it holds W7's: the extensions and the outlines as list tiles, the bar on each, a tile torn out.

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
- `lists.read` (watched, a module of its own: `list-producers.ts`), `from:` a producer: `children`, `search`, `query`, `lanes`, `facets`, `links`, `properties`, `activity`, `clients`, `screens`, and `sources` (the producers as rows). Each answers a `ListAnswer` around a `ListPrimitive`: rows with `chips`, the `act` line a pick runs, and for a tree `depth`, `folds`, `open` (`arrange: tree` joined `list-row.ts`); `open` says which folders are answered. `sources` answers each source as it says of itself (`ListSource`: its parameters, whether a bar lists it, whether its answer carries facets), which is what a client reads. `links` reads a note's groups as a page's `::links` does (`readLinks`): the groups, their labels and "every group when none is named" are outline-core's `link-blocks`. As built it is its own action, not a `site.answer` producer: `site.answer` is bound to a note, and a tree or a search has none. As built (W6, `about-producers.ts` beside the table): `threads`, `proposals`, `revisions` (a note's, by `of`), `actions` (the asker's own action rows, handed over as `actions`, answered as the ways to press them, the keys of the screen the asker names first: any door's keys screen) and `components` (every component schema; an open one carries its example lowered through the page's own walk). A row may show something under itself (`ListRow.view`, a page primitive), a press of its own inside a row is a cell with its `act`, and `open` names the rows that are open in any list whose rows fold, not only a tree's folders. A change between two texts is a `diff` primitive (`note-page.ts`), found by the service (`text-diff.ts`). Not built: `sessions` (the service keeps no registry of agent sessions: the door reads them off its own pty tiles, so a producer would list nothing true until W8's host has one).
- `notes.page`: its row says `watch: "later"` (a module answers it over a turn and keeps the watch) and it is in `WATCHABLE_ACTIONS`, as `screens.list` is. As built in W4: a part is `{type: "part", kind, block, span, line, …, view}`: the note it is written in, its UTF-16 span in that note's text, its first line, the service's word on its answer, and the primitive to draw. A figure is the catalogue primitives outline-core's `figure-primitive.ts` lowers its answered props to (a kind with no form: the service's Markdown, else its lines as `source`); a button is a `button` with the line a press names it by, and the slots its line leaves empty as `needs` (what stops a press: any other word the service has on a button, a look it doesn't read, is said and stops none, as in the door); a box holds the parts written inside it. Every press in a part carries the act line it runs (`act`, stamped by outline-core's `withActs` with the one rule, `actOf`: a list's row, a card, a text, a table's row and cell), a row is keyed by the note it opens, and the notes under the note are the one list too (`under`). Which component a line starts is one function, outline-core's `componentAt`, asked by the published page, `notes.page` and the door's reader. A comment on the note is a block under it and no note of it (outline-core's `isMarkType`): `children` and `under` leave it out, as the published page does, and `lists.read from=threads` has it (W6). Not built yet: an extension's component and a `::use`'s body as primitives (both are `source`); script parts cached by script, props and deps.
- `completion.rows` takes `{text, cursor}` in place of a detected `target` (W5, `outliner/src/completion-at.ts`): the host runs `completionTargetAtCursor`, asks its sources as for any client, merges with `mergeSourceAnswers` and answers `{token, rows, heading, message, pickKey}`: the token to replace (UTF-16 offsets of the text) and rows ready to draw and to write (`insert`, `select`, `pick`). What the list says of itself is outline-core's `completionSaid`, which the door's completer calls too. Not built yet: a row that makes something when chosen (a page nobody wrote, an anchor on a heading, a new component) is left out of this form, and the door's own sources (its actions, a fence's settings, a button's steps) have no thin form.
- `draft.patch` for a holder that places nothing (W5, `outliner/src/draft-place.ts`; PROBES §10): a new ask kind, `place`, beside `read`, `patch` and `revert`. Asked to `patch`, the native window answers with its draft as it stands; the service decides with outline-core's `placeDraftPatch` (the door's guard, moved there, and still what the door runs over its own buffer) and sends back the spans to replace, taken only while the text is the version they were found in. No hold flag and no client kind: the holder says it by what it answers.
- `lists.read` gains two sources a bar lists (W7, `outliner/src/list-extensions.ts`): `extensions` (a row a thing to do with one: open its page, its settings, install one, and once words are typed remove one, each with its act line) and `outlines` (`outlines.known`: this machine's outlines and each forwarded machine's own list, answered by the host through `outline-links.ts`; it opens and makes none).
- `tiles.view` (W7, watched as `notes.page` is; `outliner/src/tile-view.ts`): what a tile of a kind an extension's script renders shows, as one view primitive with every press said as its act line (`withActs`). `screens.list` says the drawer for such a kind (`view`), and `list` over its question for a kind that lists a query, so neither needs client code. An extension's settings reach the scripts it ships as props (`settingProps`), each its default when unset: a setting changes what a rendered tile draws in every client.
- `events.subscribe` takes client kind `native` (W4): the window registers as itself and hears `scripts.act` and `scripts.ended`, so an act a script has for a window reaches its dispatcher and is answered (`scripts.answer`). Not built yet: `door.act` aimed at a native window.

**Client-side:** layout, ops, placement, focus, the key table, cursor and scroll, the draft buffer, drawing, picture decode, cells, windows, the arrangement file, the control socket.

## 4. One owner each

| Decision | Owner |
|---|---|
| Who acts, and whether | `rule()` in `actions/mod.rs`, the one check `App::act` makes: the actor against what the row declares (`touches`, `while`, and `person` for what is the person's own). An agent's `touches: screen` act waits until the person has been idle 2 s (`Whereabouts.idle`) |
| Who a write is recorded as | `Store::write` stamps `mutation.actorId` |
| Which tile has focus | `Layout.focus`, changed only in `apply` (`Op::Focus`, and what a load leaves); an agent's act never moves it. `keys::follow`, in `poll`, is the one reconciler and the only caller of `Tx::focus`: a press inside a tile becomes `tile.focus`, and the tile the layout names is the one Rune focuses. Each tile's root holds the keys through `keys::tile` |
| Who has the keys | `App::person() -> Whereabouts`: the bar while it is open, else the tile `Layout.focus` names, in its draft when a block is being written there, in that draft's completion list while it is open (a layer over the draft's: `Layer::stack`; one with nothing to choose from keeps only the key that puts it away). Which of those layers a block's keys are in is `App::writing`, which the hint row under its field reads too. (A float and a `takes_keys` tile join when W8 builds them) |
| Which keys mean what | `keys.rs`: the open screen's own first (its spec's `keys` in the names screens write them, `ScreenBind`: asked while a tile has the keys, on the kinds each says (`screen::holds_on`, the one reading of `only` and `unless`, a new-note rule's too; the kinds are the ones tiles carry, resolved by `screens.list`), run as a request already read; each key's name is read as a chord by `chord_named`, held to outline-core's `isKeyName` by `core-contract.json`), then the row defaults. Not built yet: the door's `keybindings.json` in its own chord names (`ctrl+w q`) |
| How a field passes keys | one `field()` adapter in `keys.rs`: table first, text second, unhandled up |
| Where an open lands | `layout::place`, in the door's order (own wire, opens-into, home, flow next, first unpinned reader). The screen's `lands` reaches it as `Ctx.lands` for an open from outside any tile, and a new note asks it with the screen's `newNote` rule. `nav::land` is the one caller. Not built yet: an activation's `where` as an open rule (`actOf` writes `open id=` alone, and `open` takes no rule) |
| Where a screen's `lands` points | `Layout::lands`: a tile's name, else a container's key (the screen validator's reading). Placement reads it, and `App::landing` (the reader an act about the open note means, and a list's home) |
| Which tile an act is about when it names none | `App::target(About)` in `actions/app.rs`: the tile aimed at when it is of the sort the action wants, else the one with the keys when it is, else (a reader) where the screen lands, else the first of the sort. The dispatcher asks it once an act, checks the actor against that tile and the action runs in it (`App::about`); a tile named that is not of the sort is refused. Where a press happened is no name: a button's act, a row's pick and a script's call come from their tile (`App::act_from`, in the dispatcher) and are about it only when the action acts in a tile of that sort, else about the tile this rule finds |
| How a request is written as a line | `actline::word`, held to outline-core's `actionLine` by `core-contract.json`. A request already read (a script's call, a row's pick, a rule's action) goes to `act_request` and is never written to be read again |
| Whether a layout changes | `layout::apply`, with policy and agent limits. A step undone and a screen opened are operations too: `Op::Load` carries the arrangement that would take this one's place, so what would go is asked what a close is asked |
| Which tile an address names | `Layout::resolve` (`layout/address.rs`), for `tile=`, `to=` and a follower's source; the door's resolver by language, held to it by `address-contract.json` |
| What Esc closes | one step list in `keys.rs`; the hint row reads it. A border's drag has its own way back (`layout.resize` to the share at the press), never `layout.undo` |
| What a screen or kind is | `screens.list` (its `kinds` are `extensions.list`'s rows), read once in `App::served`; a kind is found by `App::kind_row`: the row by that name, else the one the service says `serves` it. What an open screen says of itself (`lands`, its toolbar, its new-note rule) is the served row's spec, read each time (`App::spec_now`, by `screen::Spec`); the arrangement's file keeps the screen's name and a mark of the spec it was laid out from, and a screen changed under its arrangement is said |
| Which new-note rule of a screen applies | outline-core's `newNoteRule`, ported once as `Spec::new_note` and asked once, with the kind the tile is; held by `core-contract.json` |
| What a list's rows are, and what a pick runs | the service: `lists.read` for a tile and the bar, `notes.page` for a list in a note. The window maps no answer to rows and writes no act line for one: a pick runs the row's `act` (`list.pick` in a tile, which also folds a folder's row; `tree.pick` is the door's name for the same run) |
| How a list is drawn | `tiles/list.rs`, for a list tile and for a `list` on a page (`list::on_page`): the same sections (`ListView::sections`, the one port of `listSections`, held by `core-contract.json`), headers and rows, built in view |
| What a list is asked for | `App::ask_of`: the parameters its source says it reads, by name, for a tile (`list_ask`) and the bar (`bar::ask`) alike |
| What a follower's subject is | its fields: `subject: follows` follows its home's note; left unsaid it keeps the note it first listed (`App::subject_of`), as in the door |
| What a picked value adds to a question | `query::narrowed`, the one port of outline-core's `selectionQuery` (held by `core-contract.json`): a list tile's narrowing and the bar's. The source a question is typed on is the one the service says carries facets (`bar::questions`) |
| Which component a line of a note starts | outline-core's `componentAt`, asked by the published page's walk, `notes.page` and the door's reader |
| How a part of a page is drawn | `PRIMS` in `tiles/prim.rs`, by the primitive's type; the page drawer walks and matches nothing |
| Where a button's press runs | `button.press` in `actions/script.rs`: here when its one act line is an action here, else the service (`scripts.sequence`); whether it can run at all is the part's `needs`, never its `error`; a script's act for a window is read and answered by the store (`scripts.answer`) |
| Which host and outline a window opens, and where its control socket is | the door's `resolveTarget` and `placeFor`, asked every time through `resolve.ts`; the socket's name is the door's `DOORS`. A switch asks the same rule by name (`--to <outline> [<machine>]`, `client::way`) |
| Which outlines there are to switch to | the service: `outlines.known`, asked each time by `outline.switch` (`actions/outline.rs`). Only a listed one opens; one this window left is known and asked of nobody. Nothing is made |
| What an extension is and adds, and what its rows in the bar are | the service: `extensions.list` held by `ext.rs` (its settings' schema, its actions), `lists.read from=extensions` for the rows. The window lists and names none |
| What a setting typed is | `ext::SettingField::typed`: the value its schema's type says; whether the schema allows it is the service's (`extensions.configure`) |
| Which window an agent's request is for | `control.rs`: the request's `window` (or `window=` among an act's words), else the run's first; `control::Windows` is the one registry, kept by the shell as it opens a window and by the window as it closes |
| Whose a thing the service says with no asker is | the store's hub: a write's answer to the window that wrote, a script's act to the window that pressed (`Store::pressing`), a draft's ask to the window that holds it (`Store::holding`) |
| Which door answers `act` | `controlFor` in `session/place.ts`, with `--door native` |
| Whether a patch may land in a live draft, and where | outline-core's `placeDraftPatch`: the door asks it of its own buffer, the service asks it for a holder that places nothing (`draft-place.ts`). The window compares no passage and knows no paragraph: it hands over its text and takes back ranges |
| Where the caret is after a patch | outline-core's `mapCursor` (a span says `stays` or `apart`); ported once as `draft::map_cursor`, held by `core-contract.json` |
| Whose the editor is | the rows: every action that opens, types in, saves or closes a draft says `person`, and `rule()` refuses an agent. An agent's way in is `draft.patch`, which the service places |
| Which token the caret is in, and what completes it | the service (`completion.rows` with the text and the caret): the window finds no token, merges no rows and writes the row's own `insert` |
| What a held draft answers the service | `actions/draft.rs` `asked`, through `Store::held` (`drafts.answer`); the hold itself is asked, renewed and let go there too (`App::beat`) |
| Where unsaved text is kept | `draft::Recovery`: one file an outline beside the arrangement's, written by `App::remember` on every change |
| What is listed about a note, and what a row's own press runs | the service: `lists.read from=threads\|proposals\|revisions`, each press a cell's `act`, by the door's names (`reply`, `resolve`, `proposal.apply`, `proposal.dismiss`, `revision.restore`). The window has one action a write (`actions/review.rs`) and writes no line for a row |
| What changed between two texts | the service (`text-diff.ts`, the `diff` primitive); `tiles/diff.rs` draws its lines and compares nothing. Left: the door's own compare (`revisionDiff`, `diffRows`) still diffs in the door |
| What a draft writes when it is saved | `DraftSession.writes`, read by `edit.save` (`actions/draft.rs` for a block, `review::send` for a comment or a reply) |
| Where a comment's words are in the note | the service (`annotations.batch`'s `block-comment`, outline-core's `findPassage`): the window sends the words quoted and anchors nothing |
| Which words a comment asked for is on | the reader's `passage` (`passage.select`, as a selection is made). A press on the toolbar leaves the selection (`keeps_text_selection`, in `shell.rs` alone); the bar keeps the words while it has the keys and lets them go when it is put away (`App::unselect`, from the bar's actions alone) |
| What names a request about a note | `request_id` in `actions/review.rs`: the send it is (`DraftSession.send`, or a new `draft::send_name` for words sent at once) and its words. A draft tried again is the same request; the same words another time are another |
| Which reader a press in a list about a note acts in | `App::act_from` in the dispatcher, asking `App::home_of` (the list's `source`, else the reader when it follows) |
| Which row of a list is open | the tile's own state (`TileUi.unfolded`), handed to the service as `open`; `list.pick` folds a row that only folds, in a list whose source reads `open` |
| What the keys screen lists | the action rows (`actions::rows`, handed to `lists.read from=actions` in `App::ask_of`): the key table (`keys.rs`) reads the same rows. The open screen's own keys are listed first: the asker names its screen (`screen`), and the producer reads that screen's `keys` from `screens.list`, the spec the key table reads. Not built yet: `keybindings.json`, in either |
| Meaning of notes | the service |

## 5. Agents, tests, headless

- **Control:** native serves `native.sock` beside `door.sock`, with the door's verbs. `act` runs `AppHandle::update(|s, _| s.act(line, agent))`, taking no pointer, focus or selection; the status line names the actor.
- **`peek`:** `{screen, focus, whereabouts, watches, tiles: [{id, name, kind, facts, asks}]}`. Element keys are `tile/<name>/…`.
- **Headless:** `--screen <name> --act file.act --snap out.png --tree` on `App::headless_runtime`, on a scratch outline. A headless run serves no control socket (it is one frame, with no one to answer). Not built yet: `peek`'s element tree and `snap` over the control socket, which need a drawn frame (PROBES §4); `control.rs` answers `peek` from state, `actions` and `act`.
- **Tests, four levels:**
  - **Contract tables,** generated from the door's own functions and run by both suites: `{layout, op, actor}` to layout or refusal, `{layout, open}` to `{tile, why}`, act lines to requests, `{tiles, address, from}` to the tile or the refusal. `core-contract.json` is the same for outline-core's own rules (made by `outline-core/scripts/core-contract.ts`): a request written as a line, a list's sections, the new-note rule that applies, a screen filled with its target, a question narrowed by picks, a links list's groups.
  - **Garden over `Standin`,** asserting the wire.
  - **Window tests** with a parity table: every row runs by its chord, its bar row pressed and its act line, giving one step record.
  - **Drafts, as a person works** (`drafts.rs`, W5): typed, completed and saved by keys through the window; held, read and patched by lines the host says; kept as typed and found back by a second window on the same file. The sentence whole runs against a scratch host in `live.rs`, with the agent over the control socket.
  - **`one_owner.rs`:** `place(` only in the open's own file; `Op::` only in `actions/` and `layout.rs`; `.on_key(` and `Tx::focus` only in `keys.rs`; `virtual_rows` only in `list.rs`; the arrangement written and a load issued only in `actions/layout.rs`; no refusal for whose a thing is in an action's run; an address read only by the layout's resolver; no outline or host setting read by the window. Since W3: no kind catalogue, compiled screen or list read but `lists.read`, no act line written for a list's row, and Rune named only by what draws. Since W4: a primitive is built only by the registry, and no builder or drawer reads what a part was written as. Since sweep 2: one writer of a line's word, one drawer of a list, no activation read and no open written anywhere, `App::target` the one chooser of a tile, `lands` read one way, and Rune named only behind the seam with no file excepted (a field's text is `keys::Text`, the decoded pictures `tiles::picture::Pictures`, a waker `client::Waker`). Since W7: the hub behind a cell only in `store.rs`, a window's first arrangement and a parked one put only by `actions/layout.rs`, the extensions asked in one place and no bar row made from them, the windows opened only by the shell from `main.rs`'s poll. Since W6: each write about a note asked by its own action in one file, no read of a note's threads, proposals or revisions but `lists.read`, no act line written for a row's own press, one builder of a change that compares nothing, one session type whatever is written, a selection read only by the page drawer, the action rows handed over in one place, and a screen's keys read only by the key table. Since W5: one session a block (no whole-note editor), the hold asked only by the draft's actions and answered only by the store, `completion.rows` asked only by the session with the text and the caret, no passage or token read anywhere in the window, one `map_cursor`, and nothing about a draft in the open's file. `owners.rs` and `sweep2.rs` hold the same by what the window does.
- **Frame cost:** each tile draws in `memo(tile.id, version)` over its spec, slot generations, focus, cursor, scroll and draft revision.
- **Every visible wave** carries a scene and its headless snapshot under `docs/`. The `kitchen` screen in `extensions/screens` holds a wave's visible parts, and a wave adds its own: the outline, the extensions and the outlines as tiles on its left, a reader with its properties and the last callers behind it, and the tiles about the reader's note (its comments, proposals and revisions) on its right. Not built yet: a wiretext Sketch for each, and the earlier waves' parts (a board's lanes, a table, the bar) on the kitchen screen. Tests split into `src/tests/*.rs`; actions and drawers register per module.

## 6. The three likeliest hydras

1. **A second layout decider.** Rust `apply` and `place` sit beside the door's, by language. Both suites run the one generated table, and every open reaches `place` only through the `open` action.
2. **A second vocabulary.** One kind catalogue, one validator and one address resolver, all served; one action-row fixture. A portability test opens every shipped screen in both doors, and the fork check copies each into a scratch outline as a note.
3. **A second key or list.** One field adapter, one table, and one `list.rs` for tree, bar, lanes and followers.

## 7. Judges' items, resolved

- **Arrangement store, write cost:** a state file; no outline write per op.
- **Built-in screens twice:** the screens extension. `target` has `fills: <tile>.<field>` (W3: the navigator's query is data; the window fills it by `Spec::filled`, the port of `targetFilled`). The door's `shipped-screens.test.ts` lists the door literals left: thirteen, each made from the door's own state or of kinds only the door has.
- **Rows three ways, search:** `from:` only; `search` calls `tree.search`'s ranker.
- **Figures:** served primitives own the look; the door's `graphs.ts` stays until a figure has a service builder.
- **Templating:** none; act lines only.
- **Wire table:** a checked-in dump of the `actions.ts` flags, kept true by a test; answer shapes are serde structs checked against recorded answers.
- **Pty hosts:** one, the door's pty host protocol, for native alone; libghostty-vt only parses cells. Sharing a session's programs between the door and native needs viewers in that protocol first (PROBES §8).
- **Watch budget:** equal asks share a slot; hidden tabs release theirs and keep `last()`; `dropped` re-asks when next drawn; lanes are one grouped query.
- **Row caps, `whole` latency:** the tree answers visible rows and `truncated` draws a row that re-roots; bar typing is measured in W1, and a fix is the host row's flag.
- **More outlines:** an Ask is keyed by outline and machine; the reader keeps `outline=` and `machine=`.
- **Draft safety:** drafts belong to the App. As built (W5): what is typed is written to a file of the window's own as it is typed (`native-<outline>.drafts.json` beside the arrangement's), and a window that ended without saving finds it back in its block. It is not `edit-recovery.*`: that is the service's record of a merge after a conflict, which this window doesn't start. Not built yet: a closed tile's dirty draft moving to a float (the layout refuses to close a tile a block is being written in, as the door's rule does), and a merge offered when a save is refused as stale (the text stays, with why).
- **Comments on a span:** by quoted text, through `quote`; no anchor maths in Rust.
- **Undo, reset, restore:** `layout.undo` over a journal, `screen.reset`; a restart reads the file and recovery. Both go through `apply` (`Op::Load` with the arrangement). A screen changed in the outline under an arrangement (while the window is open or shut) is said once, with the act that lays it out again.
- **Mouse:** dividers and title bars use `on_drag`; a drop point becomes `tile.move to= side=`. Rows cross tiles by action.
- **Typed handlers, windows:** the shell keeps `HashMap<TileId, TileUi>` and uses no `PaneState` or kit `Tree`; windows share one Store and budget, each with its own layout. As built (W7): each window is an `App` of its own over the shared hub, opened by `rune::open_window` with the state the act made (`App::born`, PROBES §13).
- **Authoring:** arrange, then `screen.save`; a problem draws on the tile. Not built yet: kinds and fields completing inside a screen note, and the problem drawn on the note.
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
| **W3 Lists** | …opens navigator, board and lastcall from the bar in both doors; tree, lanes, matches and backlinks are one list. | W2 | `tiles/list.rs` arranges over `list.rs`'s virtual rows; outliner `list-producers.ts` (as built: `lists.read`, not a `site.ts` producer), outline-core `list-row.ts`, `extensions/screens/`; door `screen-specs.ts`, `builtin-tiles.ts`; `scripts/native-forkable` | `tiles/tree.rs` and `tiles/about.rs` (`tree_row`, `levels`, `inspector()`); the door's moved screen literals and kind descriptions | one list over each producer; fork check; install and uninstall on a scratch outline | W4, W8 |
| **W4 Page and parts** | …opens a note with figures, boxes and a button, presses the button, and it runs here. | W2 | `tiles/page.rs`, `prim.rs`, `actions/script.rs`; outliner `note-page.ts`, `actions.ts` | `component()`, `stat_tiles`, `note()`, `chips()` in `tiles/page.rs` | every primitive type has a builder; button answers `scripts.answer`; action-row fixture | W3, W8 |
| **W5 Draft** | …edits one block with completions while an agent patches it, quits mid-word and finds the text back. | W4 | `draft.rs`, `actions/draft.rs`, `tiles/page.rs`; outline-core `draft-patch-place.ts`; outliner `completion-at.ts`, `draft-place.ts`; door `edit.ts` (its guard now outline-core's) | `Editing`, the whole-note `TextArea`, the guards in `open()` and `note.new` | capture-first tests re-aimed; hold, patch, release; recovery; the sentence live | W7, W8 |
| **W6 About the note** | …comments on a selection, reviews a proposal and a revision in tiles that follow the reader, and opens the keys and library screens. | W3, W5 | `tiles/diff.rs`, `actions/review.rs`, `draft.rs` (`Writes`); `extensions/screens/` rows (five kinds, the keys, library and kitchen screens); outliner `about-producers.ts`, `list-producer.ts`, `text-diff.ts`; outline-core `ListRow.view`, the `diff` primitive | nothing left of the spike | follow wire; a comment on a selection, a reply, a thread resolved; apply and dismiss on the wire; a revision restored; keys screen equals the rows (live, against the service) | W7, W8 |
| **W7 Extensions and outlines** | …installs Waiting from the bar, uses, configures and uninstalls it, switches outline, and tears a tab into a second window. | W3, W4 | `ext.rs`, `actions/ext.rs`, `actions/outline.rs`, `actions/window.rs`, `tiles/rendered.rs`, `store.rs` (the hub), `shell.rs` windows; outliner `list-extensions.ts`, `tile-view.ts`, `outline-links.ts`; the `kitchen` screen | nothing | install, use, configure, uninstall on the stand-in and on a scratch host; two links in one Store; switch outline and back with a draft held; a second window drawn headless; the control socket naming a window | W5, W6, W8 |
| **W8 Terminal and agents** | …opens a shell and an agent beside a note, detaches, returns, and jumps between agents from a list. | W2 and W0's measurement | `tiles/pty.rs`, `pty/`, `Cargo.toml` feature; a new `extensions/terminal/` manifest | nothing | `takes_keys` whereabouts; a scripted pty host; redraw cost recorded | W3 to W7 |
# ep0ch, native

ep0ch as a native window: the outline's tree, the open note and what the service knows about it, drawn on the GPU
with [Rune](https://github.com/anomalyco/rune) and its `rune-kit` components. It is a third client of the same
outline, beside the door and the Herdr console, and a thin host like every small client: it draws, and nothing in it
reads Blockdown.

![A note with a query-backed component, light](docs/note-light.png)
![Live figures answered by the service, dark](docs/figures-dark.png)
![A query with the facets its matches carry, dark](docs/query-dark.png)
![A header image, pictures, an svg fence and a mermaid fence, light](docs/pictures-light.png)
![The command bar with an action typed, its keycap from the key table, dark](docs/bar-dark.png)

## Run it

```sh
cd packages/native
cargo run --release -- -- --ws pie                    # the window; any outline the usual rule names
cargo run --release -- -- --ws pie --machine float-2  # another machine's, over its forward
```

Everything after the second `--` names the outline as every client does: `--ws`, then `EP0CH_WS`, then the nearest
`.ep0ch`. That rule is the door's own, run once at launch (`resolve.ts`, with `bun` on the PATH or `EP0CH_BUN`);
after that the window speaks the host's socket itself and runs nothing else. `EP0CH_SOCKET` with a named outline
skips the lookup.

Linux builds need `libxkbcommon-dev` and `libwayland-dev`; a machine with no GPU draws through lavapipe
(`mesa-vulkan-drivers`, `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`).

## What Evan can do in it

| Do | How |
|---|---|
| Walk the outline | The sidebar's tree: a press opens a note, a press on the open note folds or unfolds it |
| Read a note | Prose as Markdown, links that open, callouts, code; `::links`, `::fields`, `::view` and query-backed `::graph-table` as rows that open; `::graph-stat` as tiles and the other figures with the service's results |
| See its pictures | The header image (`[layout::hero]`) as a band above the title; `[img::…]` lines (PNG, JPEG, SVG) where they stand; an ```svg fence as the picture its text is; a ```mermaid fence as a diagram |
| Follow anything | A link, a child, a backlink, a row in a component; `back` goes back |
| Do anything | The command bar: every action there is, by a word of its name or of what it does, with its keys beside it. A whole act line typed runs as written (`open id=…`) |
| Write | `edit` opens the note's Blockdown source; `edit.save` saves at the revision it read and keeps you in the editor; Esc leaves once everything is saved |
| Make, move, bin | `note.new` under the open one; `note.move` up, down, in, out; `note.trash` (the notice has Undo) |
| Find | The bar, with words: the service's search, under the actions that match |
| Query | The bar on a query: the views' grammar (`type=letter mail=waiting`), with the facets the matches carry as chips that narrow it; a header chip on a note opens the query for it |
| See it change | An edit from the door, an agent or another machine redraws what's open |

**The keys are the actions' own.** Each action's row says its chords (`src/actions/*.rs`), and the key table, the
keycap on a button, the bar's rows and `actions` over the control socket all read the row. The defaults:

<!-- keys: the key table, as keys.rs reads it from the rows (a test keeps this true) -->
| Chord | Act line | Where | Does |
|---|---|---|---|
| `mod+[` | `back` | everywhere | back |
| `mod+n` | `note.new` | everywhere | a new note under the open one |
| `mod+backspace` | `note.trash` | tile | move the open note to the Trash |
| `alt+up` | `note.move step=up` | tile | move the note up |
| `alt+down` | `note.move step=down` | tile | move the note down |
| `alt+right` | `note.move step=in` | tile | move the note in, under the one above |
| `alt+left` | `note.move step=out` | tile | move the note out, after its parent |
| `mod+e` | `edit` | everywhere | edit the open note |
| `mod+s` | `edit.save` | everywhere | save |
| `mod+enter` | `edit.save` | draft | save, from the note's source |
| `escape` | `edit.close` | draft | leave the editor, when everything is saved |
| `mod+k` | `bar.open` | everywhere | open the bar on everything |
| `mod+l` | `bar.open scope=query` | everywhere | open the bar on a query |
| `escape` | `bar.close` | bar | put the bar away |
| `enter` | `bar.pick` | bar | pick the lit row |
| `down` | `bar.move by=1` | bar | the next row |
| `up` | `bar.move by=-1` | bar | the row before |
| `mod+shift+b` | `dock.toggle side=left` | everywhere | show or hide the tree |
| `mod+i` | `dock.toggle side=right` | everywhere | show or hide the details |
| `escape` | `notice.dismiss` | tile | dismiss the notice |
<!-- /keys -->

`mod` is ⌘ on a Mac and Ctrl elsewhere. Where: a chord that is a tile's (`alt+up`) is the editor's own while a note
is being written, and Esc closes one thing at a time (the bar, then the editor, then the notice). Both docks resize
by their inner edge.

Capture comes first here too. Saving never ends editing, so a key typed around a save always has somewhere to
land. A save the service refuses (the note changed underneath) leaves every word in the editor and says why.
Leaving the editor with unsaved text is refused, and so is opening another note over it: only Discard, by name,
drops words.

## How it fits

```text
src/ (Rust, Rune)                                      the outline host
  view.rs, bar.rs   draw; a press runs an act line
  keys.rs           chord -> act line, by where the person is
  control.rs        an agent's act line, over native.sock
        │ an act line, whoever asks
        ▼
  actions/          the one dispatcher; one module a noun     ────────▶ update, create, move, delete
  store.rs          one slot an ask; 64 watches a link        ◀───────  notes.page, blocks.read, blocks.query
  client.rs         the socket                                ◀───────  queries.changed
  page.rs           the wire's shapes
  list.rs           the one virtualised list
  actline.rs        the act-line grammar
```

- **Every change is an act line through one dispatcher** (`App::act`, `actions/mod.rs`). A key, a press and an
  agent say the same thing (`note.trash`, `open id=…`); the dispatcher reads the line, types its arguments by the
  action's row, checks the actor against what the row touches, runs it and records the step. `App`'s state is
  private to `actions/`: a view reads everything and changes nothing except by a line.
- **An action describes itself** (`actions/row.rs`, outline-core's `ActionRow`): its name, summary, arguments,
  what it touches, its keys and its menu labels. Nothing restates them: a button names its act line and is
  labelled from the row.
- **Every read is an ask in the store** (`store.rs`): an outline, a wire action, its parameters, watched or not.
  Equal asks share a slot; a tile is a slot's user; a slot nobody shows keeps its answer and gives its watch to
  the next ask. `peek` lists the slots, who shows each and how much of the budget is held.
- **The service answers a note whole** (`notes.page`, outline-core's `note-page.ts`): title, chips, properties, the
  body as parts (prose as Markdown; each component with its answer in it), and the notes above, under and linking
  to it. It walks the note as a published page does and asks the same questions; where a page writes HTML, it
  hands over data.
- **The window is a function of what's chosen and what's answered** (`actions/app.rs`). The open note, each
  unfolded folder and the bar's words each want an ask; an answer lands in the slot of its own ask, or nowhere.
  There is no "is this answer still for what's on screen?" to get wrong.
- **Changes arrive as answers, not events to interpret.** A watched read (ADR 0004) is registered under one of the
  link's 64 keys: the service says which answer moved and the slot reads it by generation, when someone shows it.
  The window never works out what a change touches.
- **The tree is asked a folder at a time** (`blocks.read` with `under`): only what's unfolded, so a large outline
  costs what's on screen.
- **Pictures are parts too.** The page names each picture (its path, or an svg fence's own text) and how the note
  lays it out; the window reads a file's bytes with `media.read`, hands them to Rune's image cache to decode off
  the UI thread, and keeps only the open page's. One the host can't read says so, in the host's words, where it
  would be.
- **It holds no grammar and names no property.** `view.rs` is `rune-kit`'s shell (`SplitView`, `Sidebar`,
  `Toolbar`), `Markdown` and `Badge`; `bar.rs` is its `Dialog` over the one list; every field is `keys.rs`'s. A `graph-stat` is drawn as tiles from its props; a
  figure kind with no drawing here shows the service's Markdown for it; a component the service answers nothing
  for shows its source. Nothing is hidden.
- **`PROTOCOL` is the checkout's**: `build.rs` reads it from outline-core's `protocol.ts`, and a host on another
  number is refused with the side to update, as every client does.

## An agent in it

The window serves a control socket that speaks the door's control protocol (`control.rs`; the door's
`src/control.ts`): `native.sock` beside the outline's `door.sock`, or `--control <path>` after the second `--`
(`EP0CH_NATIVE_CONTROL`). So the door's own client reaches it:

```sh
ep0ch act --door native note.trash --as compost-agent   # the same action a key runs, recorded as the agent's
ep0ch peek --door native --json                         # {screen, focus, whereabouts, watches, tiles, …, text}
ep0ch actions --door native                             # every action, as its row
```

- **An act is attributed.** Its write carries `mutation: {author: "agent", actorId}`, its step says who, and the
  sidebar's status line names the agent and the action.
- **An act takes nothing of the person's.** Not their keys, not the bar they have open or its lit row, not the
  editor: `edit`, `edit.save`, `edit.close`, `bar.close` and `notice.dismiss` are refused to an agent with why,
  and an agent's `open` is refused while the person types in the reader.
- **`peek` is state, not a frame:** a hidden window answers it. The element tree and a picture of a live window
  are not served yet; `--snap` and `--tree` draw headless.

## Check it

```sh
cargo test                          # the window over a stand-in link that answers by wire action
cargo test -- --ignored live        # the same window against a scratch outline host it starts (needs bun)
bun run check                       # resolve.ts
```

`src/tests/` has one file a kind of test: the garden (what the window asks and does with the answers), the window
drawn and pressed, the parity table (every action by its chord, by its bar row pressed and by its act line, one
step record), the store (one slot an ask, the budget, what the service dropped), the fixtures (the act-line grammar
and the action rows against `outline-core/fixtures/`), the control socket, and `one_owner.rs`, which scans the
source for a second place that binds a key, writes to the wire, lists rows or labels a button.

The service's side is `packages/outliner/test/notes-page.test.ts`.

Rune renders headless, so a change can be looked at without a display, on a scratch outline:

```sh
target/debug/ep0ch-native --snap out.png --scene bar --theme dark -- --ws scratch
target/debug/ep0ch-native --snap out.png -- --ws scratch --act steps.act
target/debug/ep0ch-native --tree tree.json -- --ws scratch
```

A scene is a file of act lines, `scenes/<name>.act`: `bar`, `edit`, `find`, `query`, and `plan`, `figures`,
`callouts` (which open notes of the showcase outline by title). `--act <file>` runs any file of them before the
first frame. A Rune `--script` taps by element key (`find`, `edit`, `save`, `done`, `tree/<id>`, `child/<id>`,
`part/<n>/<id>`, `chip/<key>/<value>`, `bar/field`, `bar/row/<source>/<key>`, `bar/facet/<key>/<value>`).

## Not here yet

- Editing is the whole note's source in one text area: no per-block outliner editing, completions or live drafts
  an agent can patch (`drafts.hold`).
- Comments, proposals, revisions and marks aren't shown.
- Figure kinds other than `stat` draw as the service's Markdown, not as native widgets; a view draws as rows
  whatever its layout; embeds, buttons and templates show their source.
- Pictures: text inside an SVG isn't drawn (Rune rasterises without fonts); a header image crops to its middle
  (`hero-focus`, `blur`, `tint`, `fade` and a title over it aren't read); artifacts and video stay as written;
  a view's card covers and pictures in properties aren't shown.
- Switching outlines from inside the window; the outline is named when it starts.
- A connection keeps at most 64 watched answers (the host's bound): the page, the bar's query and one per unfolded
  folder. Past the budget an answer is read unwatched and registered when a key is free (`peek` says which).
- One tile, the reader: `tile=` takes `reader` and nothing else until there is a layout. The bar's notes come from
  `tree.search`, not yet a `from: search` list producer. Keys are the rows' defaults: a screen's own keys and the
  person's `keybindings.json` aren't read yet.
- After its own write the window reads what it shows at once rather than waiting for the watch to say so.
- The bar's list bounds itself to seven rows (`list::bounded`): `rune-kit`'s `Dialog` doesn't bound a scroll view in its body.
- Rune is pre-release and pinned by rev in `Cargo.toml`. Windows builds also need Rune's `wgpu-hal` patch
  (its README, "Add it"), and the socket is a Unix one.

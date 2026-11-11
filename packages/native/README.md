# ep0ch, native

ep0ch as a native window: the outline's tree, the open note and what the service knows about it, drawn on the GPU
with [Rune](https://github.com/anomalyco/rune) and its `rune-kit` components. It is a third client of the same
outline, beside the door and the Herdr console, and a thin host like every small client: it draws, and nothing in it
reads Blockdown.

![A note with a query-backed component, light](docs/note-light.png)
![Live figures answered by the service, dark](docs/figures-dark.png)
![A query with the facets its matches carry, dark](docs/query-dark.png)

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
| Follow anything | A link, a child, a backlink, a row in a component; ⌘[ goes back |
| Write | ⌘E opens the note's Blockdown source; ⌘S saves at the revision it read and keeps you in the editor; Esc leaves once everything is saved |
| Make, move, bin | ⌘N a note under the open one; ⌥↑ ⌥↓ ⌥→ ⌥← move it up, down, in, out; ⌘⌫ to the Trash (the notice has Undo) |
| Find | ⌘K: words, ranked by the service |
| Query | ⌘L: the views' grammar (`type=letter mail=waiting`), with the facets the matches carry as chips that narrow it; a header chip on a note opens the query for it |
| See it change | An edit from the door, an agent or another machine redraws what's open |

⇧⌘B hides the sidebar and ⌘I the details pane; both resize by their inner edge.

Capture comes first here too. Saving never ends editing, so a key typed around a save always has somewhere to
land. A save the service refuses (the note changed underneath) leaves every word in the editor and says why.
Leaving the editor with unsaved text is refused, and so is opening another note over it: only Discard, by name,
drops words.

## How it fits

```text
src/ (Rust, Rune)                                  the outline host
  view.rs    draws                       ◀───────  notes.page      a note, whole, as parts
  model.rs   slots keyed by what's wanted ◀──────  blocks.read     the notes under a note
  page.rs    the wire's shapes           ────────▶ update, create, move, delete
  client.rs  the socket                  ◀───────  queries.changed which watched answer moved
```

- **The service answers a note whole** (`notes.page`, outline-core's `note-page.ts`): title, chips, properties, the
  body as parts (prose as Markdown; each component with its answer in it), and the notes above, under and linking
  to it. It walks the note as a published page does and asks the same questions; where a page writes HTML, it
  hands over data.
- **The window is a function of what's wanted** (`model.rs`). The open note, each unfolded folder and the finder's
  words each have a slot named by their key; an answer lands in the slot whose key it carries, or nowhere. There is
  no "is this answer still for what's on screen?" to get wrong.
- **Changes arrive as answers, not events to interpret.** Every read is a watched read (ADR 0004): the service says
  which answer moved and the slot reads it by generation. The window never works out what a change touches.
- **The tree is asked a folder at a time** (`blocks.read` with `under`): only what's unfolded, so a large outline
  costs what's on screen.
- **It holds no grammar and names no property.** `view.rs` is `rune-kit`'s shell (`SplitView`, `Sidebar`,
  `Toolbar`), `Markdown`, `TextArea`, `Dialog` and `Badge`. A `graph-stat` is drawn as tiles from its props; a
  figure kind with no drawing here shows the service's Markdown for it; a component the service answers nothing
  for shows its source. Nothing is hidden.
- **`PROTOCOL` is the checkout's**: `build.rs` reads it from outline-core's `protocol.ts`, and a host on another
  number is refused with the side to update, as every client does.

## Check it

```sh
cargo test                          # the window over a stand-in link that answers by wire action
cargo test -- --ignored live        # the same window against a scratch outline host it starts (needs bun)
bun run check                       # resolve.ts
```

The service's side is `packages/outliner/test/notes-page.test.ts`.

Rune renders headless, so a change can be looked at without a display, on a scratch outline:

```sh
target/debug/ep0ch-native --snap out.png --scene query --theme dark -- --ws scratch
target/debug/ep0ch-native --script steps.json --snap out.png --at 3.5 -- --ws scratch
target/debug/ep0ch-native --tree tree.json -- --ws scratch
```

Scenes: `plan`, `figures`, `callouts`, `edit`, `find`, `query` (they open notes of the showcase outline by title).
A script taps by key (`find`, `edit`, `save`, `done`, `tree/<id>`, `child/<id>`, `part/<n>/<id>`, `chip/<key>/<value>`).

## Not here yet

- Editing is the whole note's source in one text area: no per-block outliner editing, completions or live drafts
  an agent can patch (`drafts.hold`).
- Comments, proposals, revisions and marks aren't shown.
- Figure kinds other than `stat` draw as the service's Markdown, not as native widgets; a view draws as rows
  whatever its layout; images, embeds, buttons and templates show their source.
- Switching outlines from inside the window; the outline is named when it starts.
- A connection keeps at most 64 watched answers (the host's bound): the page, the finder and one per unfolded
  folder. Past about sixty unfolded folders the oldest are dropped and asked for again.
- After its own write the window reads what it shows at once rather than waiting for the watch to say so.
- The finder's height is computed here (`FOUND_ROW`): `rune-kit`'s `Dialog` doesn't bound a scroll view in its body.
- Rune is pre-release and pinned by rev in `Cargo.toml`. Windows builds also need Rune's `wgpu-hal` patch
  (its README, "Add it"), and the socket is a Unix one.

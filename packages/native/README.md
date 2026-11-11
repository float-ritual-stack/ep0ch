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

Everything after the second `--` goes to the bridge, which names the outline as every client does: `--ws`, then
`EP0CH_WS`, then the nearest `.ep0ch`. It needs `bun` on the PATH (`EP0CH_BUN` names another) and this checkout:
the bridge runs from `bridge/main.ts` beside the crate (`EP0CH_NATIVE_BRIDGE` names another).

Linux builds need `libxkbcommon-dev` and `libwayland-dev`; a machine with no GPU draws through lavapipe
(`mesa-vulkan-drivers`, `VK_ICD_FILENAMES=/usr/share/vulkan/icd.d/lvp_icd.json`).

## What Evan can do in it

| Do | How |
|---|---|
| Walk the outline | The sidebar's tree: a press opens a note, a press on the open note folds or unfolds it |
| Read a note | Prose as Markdown, links that open, callouts, code; `::links`, `::view` and query-backed `::graph-table` as rows that open; `::graph-*` figures with the service's results |
| Follow anything | A link, a child, a backlink, a row in a component; ⌘[ goes back |
| Write | ⌘E opens the note's Blockdown source, ⌘S saves at the revision it read, Esc cancels |
| Make, move, bin | ⌘N a note under the open one; ⌥↑ ⌥↓ ⌥→ ⌥← move it up, down, in, out; ⌘⌫ to the Trash (the notice has Undo) |
| Find | ⌘K: words, ranked by the service |
| Query | ⌘L: the views' grammar (`type=letter mail=waiting`), with the facets the matches carry as chips that narrow it; a header chip on a note opens the query for it |
| See it change | An edit from the door, an agent or another machine redraws what's open |

⇧⌘B hides the sidebar and ⌘I the details pane; both resize by their inner edge.

Capture comes first here too. A save the service refuses (the note changed underneath) leaves the editor open
with every word and says why; typing on while a save is out stays in the editor on the saved revision; a note
changed by someone else while it's being typed in is said, never loaded over the draft; and another note won't
open over unsaved text.

## How it fits

```text
src/ (Rust, Rune)            bridge/ (TypeScript, bun)                 the outline host
  view.rs   draws      ◀──── page.ts   a note as parts          ◀────  blocks.records, blocks.query,
  model.rs  state      ────▶ main.ts   one JSON line per ask    ────▶  tree.index, update, move, …
  bridge.rs the link         (the door's SocketBoard, outline-core)    events
```

- **The bridge is the thin host.** It reaches the outline through the door's `SocketBoard` (which outline, a
  machine's forward, the protocol check, reconnects, the change feed) and parses with outline-core
  (`headerLine`, `linkOccurrences`, `componentBlocks`, `viewSpec`, `calloutBlocks`). The service answers every
  query, search, facet, backlink and refusal.
- **A page is parts** (`bridge/page.ts`): prose as Markdown, the render target `rune-kit`'s `Markdown` draws, with
  Blockdown links written as Markdown links; and components, each with its rows (a query's answer), its results
  (a figure's, as the door's page copy gives them) or its source as written. A component the window doesn't draw
  yet shows its source; nothing is hidden.
- **The app holds no grammar.** `model.rs` is what's open, folded and being typed; `view.rs` is `rune-kit`'s
  shell (`SplitView`, `Sidebar`, `Toolbar`), `Markdown`, `TextArea`, `Dialog` and `Badge`.
- **Properties are open.** Chips, facets and component columns are whatever keys the notes carry; no key is named
  in the app or the bridge.

The bridge speaks one JSON object a line. Asks: `hello`, `tree`, `page`, `follow`, `save`, `create`, `move`,
`trash`, `restore`, `search`, `query`. Events: `ready`, `changed`, `connection`, `fatal`.

## Check it

```sh
bun run check && bun test          # the bridge, against a scratch host it starts
cargo test                         # the window against a stand-in bridge
```

Rune renders headless, so a change can be looked at without a display, on a scratch outline:

```sh
target/debug/ep0ch-native --snap out.png --scene query --theme dark -- --ws scratch
target/debug/ep0ch-native --script steps.json --snap out.png --at 3.5 -- --ws scratch
target/debug/ep0ch-native --tree tree.json -- --ws scratch
```

Scenes: `plan`, `figures`, `callouts`, `edit`, `find`, `query` (they open notes of the showcase outline by title).
A script taps by key (`find`, `edit`, `save`, `tree/<id>`, `child/<id>`, `part/<n>/<id>`, `chip/<key>/<value>`).

## Not here yet

- Editing is the whole note's source in one text area: no per-block outliner editing, completions or live drafts
  an agent can patch (`drafts.hold`).
- Comments, proposals, revisions and marks aren't shown.
- `::view` layouts other than rows, images, embeds, buttons and templates show their source.
- Switching outlines from inside the window; the outline is named when it starts.
- Rune is pre-release and pinned by rev in `Cargo.toml`. Windows builds also need Rune's `wgpu-hal` patch
  (its README, "Add it").

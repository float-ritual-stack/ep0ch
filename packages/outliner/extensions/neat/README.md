# neat: a worked layout script

`neat` puts two notes side by side, folds the other shown main-screen tiles to spines, and opens the left note's links in the drawer. Selecting or opening a link targets the right reader; alt-open targets the left.

Install from the power bar: ctrl+k, type `&neat`, and pick **install Neat** (Enter or a double click).
An agent runs `ep0ch act extensions.install id=neat`. Then run `neat` from the power bar, or press a button in a note:

```text
::button{label="neat" of=neat page=[[Garden plan]] page=[[Shed repairs]]}
```

Each `page=` is a reference `read` understands: a page, block reference, id or Work ID. The first slot chooses the left reader, the second the right. Without the first slot, it uses this outline's `[welcome::1]` note, then `[page::home]`, then the current note's top ancestor. Without the second slot, it uses the reader with the person's keys. Press from a reader when using these defaults.

Leave the pages for the press to ask: `::button{label="two up" of=neat page={page1} page={page2} page1= page2=}` asks for page 1 of 2, then page 2, from your notes (neat's second line, `// [form-field::page note]`, says a page is a note), writes each on the line, and the next press arranges them.

The manifest declares `scripts/neat.js` as the script `neat`. An outline's own `[script::neat]` note wins over it. Edit that note to customize your arrangement; no setting or copied layout engine is needed.

Remove it with `ep0ch act extensions.uninstall id=neat demo=keep`, or the power bar's remove row. The button stays in your note and names the reinstall command when pressed.

## Follow the script

The complete runnable source is [scripts/neat.js](./scripts/neat.js). It is a file script: its first line opts in with `// ep0ch-script effects=write`. Extension `scripts/` folders use the same runtime as an outline's `.ep0ch/scripts/` files and script notes. `ep0ch install --apply` brings the bundled source with the checkout and refreshes unchanged installed extension copies.

1. `props.page` holds the repeated slots. `read(ref)` resolves each explicit reference before any arrangement changes. `q` asks the service for the welcome or home note.
2. `act('layout.get')` reads the screen's tiles and layers. The layer's `focus` is a tile id; `showing.id` is the note id. These identify different things.
3. `readerFor` reuses a main-screen reader already showing each note, or opens a held reader with `tile.open`. It keeps the returned tile id for every later action; a tile's name can change.
4. `reader.follow` stops either reader following another tile. `tile.collapse` unfolds the pair, `layout.move` places the second to the right of the first, then the remaining shown main-screen tiles fold through `tile.collapse`. `layout.even` shares the space after the links are placed.
5. `links` returns the left reader's links tile id. `tile.drawer on=true` puts that tile in the drawer even on a screen whose links normally open below the reader. Three `tile.link` calls wire `select` and `open` to the right reader and `alt` to the left.

The script uses the `step`/`failed` pattern: catch a refused action, remember its name and reason, and continue the remaining steps. Its final answer lists every refusal instead of claiming success. This is useful for layout scripts, where a locked screen or protected tile may refuse a step; it does not change the shared layout rules.

Try it in `ep0ch --showcase`, section **neat**. The made-up notes there exercise this source through a real button and scratch outline in `test/showcase/neat-builtin.test.ts`.

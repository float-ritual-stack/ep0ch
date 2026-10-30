# Neat

Two notes side by side, the other tiles folded to spines, and the left note's links open in the drawer.

## What you do

- **Install:** from the power bar, ctrl+k, type `&neat`, and pick **install Neat** (Enter or a double click).
  - An agent runs `ep0ch act extensions.install id=neat`.
- **Run it:** run `neat` from the power bar, or press a button in a note.

```text
::button{label="neat" of=neat page=[[Garden plan]] page=[[Shed repairs]]}
```

- **Pick the pages:** each `page=` is a reference `read` understands: a page, block reference, id or Work ID.
  - The first is the left reader, the second the right.
- **Leave them to the press:** `::button{label="two up" of=neat page={page1} page={page2} page1= page2=}` asks for page 1, then page 2, from your notes.
  - The last pick arranges them; later presses use what the line holds.
- **Follow links:** selecting or opening a link targets the right reader; alt-open targets the left.
- **Remove:** `ep0ch act extensions.uninstall id=neat demo=keep`, or the power bar's remove row.
  - The button stays in your note and names the reinstall command when pressed.

## Defaults

- **No first page:** it uses this outline's `[welcome::1]` note, then `[page::home]`, then the current note's top ancestor.
- **No second page:** it uses the reader with the person's keys.
- **Press from a reader** when you use these defaults.

## Make it yours

- **Edit the script:** an outline's own `[script::neat]` note wins over the bundled one; edit that note to customize.
  - No setting or copied layout engine is needed.
- **Try it:** `ep0ch --showcase`, section **neat**; its made-up notes run this source through a real button in `test/showcase/neat-builtin.test.ts`.

## Follow the script

The complete source is [scripts/neat.js](./scripts/neat.js), a file script whose first line opts in with `// ep0ch-script effects=write`.

1. **Pages:** `props.page` holds the repeated slots.
   - `read(ref)` resolves each explicit reference before anything changes; `q` asks the service for the welcome or home note.
   - A form field (neat's second line, `// [form-field::page note]`) says a page is a note.
2. **Layout:** `act('layout.get')` reads the tiles and layers.
   - The layer's `focus` is a tile id; `showing.id` is the note id.
3. **Readers:** `readerFor` reuses a main-screen reader already showing each note, or opens a held one with `tile.open`.
   - It keeps the returned tile id, because a tile's name can change.
4. **Arrange:** `reader.follow` stops either reader following another tile.
   - `tile.collapse` unfolds the pair, `layout.move` puts the second to the right, and the rest fold through `tile.collapse`.
   - `layout.even` shares the space after the links are placed.
5. **Links:** `links` returns the left reader's links tile id, and `tile.drawer on=true` puts it in the drawer.
   - Three `tile.link` calls wire `select` and `open` to the right reader and `alt` to the left.
6. **Refusals:** the `step`/`failed` pattern catches a refused action, remembers its name and reason, and continues.
   - The final answer lists every refusal instead of claiming success; the shared layout rules don't change.

- **Same runtime** as an outline's `.ep0ch/scripts/` files and script notes.
- **Updates:** `ep0ch install --apply` brings the bundled source with the checkout and refreshes unchanged installed copies.

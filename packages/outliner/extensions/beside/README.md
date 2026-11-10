# Beside

A card of facts about the note you are reading, kept beside it. The first extension that attaches a surface to a reader.

- **Open it:** `act attachment.open target=beside.facts` (the same from the power bar's actions), beside, floating, in a popup or in a tile as the reader's other attachments are.
  - It follows the reader: another note shown, the card is drawn for that one.
  - `attachment.place target=beside.facts place=floating` moves it; `attachment.close target=beside.facts` puts it away.
- **What it shows:** the note's title, its properties and how many notes sit under it.
- **Remove:** the extensions screen's row (ctrl+k, then `&`), or `ep0ch act extensions.uninstall id=beside`. The kind goes with it: `target=beside.facts` is refused again.

## How it's made

| Need | The part that's there |
|---|---|
| The kind | `extension.json` `attachments[]`: `{ kind, noun, render }`; the host names it `beside.facts` on `extensions.list` |
| The rows | the `beside` render script (`scripts.render`, the note as `props.note`), the same call a render tile makes |
| Placement, layering, float, tile | the door's attachment layer, through its one generic adapter (`src/surface/extension-attachment.ts`) |

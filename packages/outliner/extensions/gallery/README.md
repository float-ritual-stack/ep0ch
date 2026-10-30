# Gallery

Pictures as cards: write `gallery::` on a note and the notes under it show as a row, each with its cover picture.

## What you do

- **Show a gallery:** write `gallery::` on a note.
  - Each note under it is a card; its `[cover::path]` is the picture.
  - The card is what opens its note.
- **Change the height:** `gallery:: 4` makes the rows four tall (1 to 60; the default is six).
- **Show one picture:** `pic:: path`, with its note's title as the alt text.

## Good to know

- **Narrow screens:** under 22 characters a card, the row stacks.
- **Nothing is written** to the outline.
- **Each reader draws it its own way.**
  - The door uses its graphics, dimmed dark-first.
  - A web page shows the image it serves, when the publish roots allow the file.
  - Anywhere else you get its words and its file.

## How it works

- **Both use the shared `image` primitive:** `{ type: "image", src, alt?, size?, fit?, height?, caption? }`.
- **Cards show the picture alone** (`caption: false`).
- See the extensions README's primitive table (PIE-827).

# Gallery

Pictures in an extension's view (PIE-827), drawn the way each reader draws a note's `[img::]` line: the door with its
graphics, dimmed dark-first; a web page with the image it serves when the publish roots allow the file; anywhere else
its words and its file. Nothing is written to the outline.

- `gallery::` on a note draws the notes under it as a row of cards, each with the picture its `[cover::path]` names
  as its cover (six rows tall; `gallery:: 4` makes it four, up to 60), the picture alone (`caption: false`): the card
  is what opens its note. Under 22 characters a card, the
  row stacks.
- `pic:: path` draws one picture, its note's title as its alt text.

Both use the shared `image` primitive: `{ type: "image", src, alt?, size?, fit?, height?, caption? }` (see the extensions
README's primitive table).

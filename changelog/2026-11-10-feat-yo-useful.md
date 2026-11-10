### yo finds notes, fits its answer to the ask, and hears every ask (PIE-1711, PIE-1712, PIE-1722)

- **A find ask answers with the notes:** `@yo find me all hub items that are not sent yet` lists up to ten notes as links, the query that found them and how it read each word, with buttons to open it in a facets tile, edit it on that tile's query line, or save it as a view. The words go through the service's `query.suggest` over the outline's own facets (now open to extensions); nothing found names the nearest keys.
- **Query words read filler and plurals:** "all … items that are … yet" no longer becomes text clauses that match nothing, and "hub items" reads as `hub-item`.
- **The answer fits the ask:** `backlinks.view step=kind` names its one key (`K: by kind`) and its button says `▸ by kind`. An action's key rows can carry the arguments they press with (`KeyRow.args`), and `links` says it opens the backlinks tile (`ActionDef.opens`), so the button opens the links first, then groups them.
- **A sequence step lands where it can run:** a backlinks step in a button pressed from a reader goes to the screen's backlinks tile, not the reader.
- **Every ask is heard:** a note's ninth `@name` line was never seen (a cap counted answered lines); now every line is asked, and the same words again further down are an ask of their own.
- **A note action pressed in yo's answer acts on your note:** `note.rename`, `note.trash`, `block.mark`, `block.mark-toggle` and `tile.header` work where they're pressed; `note.rename` pressed by you while you edit changes the title in your edit.
- **Run:** `ep0ch install --apply` (host and door together).

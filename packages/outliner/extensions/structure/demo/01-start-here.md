Structure: start here
Three notes below to try it on. Select words in a note and press `a` then `x` to extract them; `ctrl+z` puts them back, child and all. The sorts ask what to sort by: open a note, then `ctrl+k`, `>`, "sort", and pick `by` and `order` from what the rows have. From a shell, `ep0ch ext act structure extract --block <note id> --quote "<the words>"`, `ep0ch ext act structure sort-blocks --block <note id> --arg by=title`, and `ep0ch ext undo <id>` with the id it prints.

- ((plan|Garden plan)) has a passage and a list item to extract. Its last item ends in `^s5`, which ((diary|Garden diary)) links to: extract that item (select the whole line) and the anchor goes with it, and the diary's link points at the new child, with nothing left behind to forward it.
- ((seeds|Seed list)) is a list to sort by name, or by price.
- ((beds|Beds)) has children to sort by title, created or `bed-size`.

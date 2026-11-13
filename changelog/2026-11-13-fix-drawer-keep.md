### The drawer and groups never lose a tile (PIE-1792)

- **^W a on an answer tile keeps it:** it said it went to the drawer and closed there, out of its reader's reach. Now it's refused with why ("the answer goes with its reader, detail: it stays beside it"), and nothing closes. A tile kind may refuse a carry by its own rule (`TileKind.carryRefusal`).
- **^W G inside a group of one nests nothing:** it says why ("a group of one already") and how to gather it with a neighbour.
- **A tab set marks the tab a note just landed in:** the drawer's `*` no longer sits by the shell when the note landed in another tab.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.

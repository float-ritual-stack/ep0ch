# Structure

Three things you do to notes by hand, as actions: **extract** a passage into its own child block, **sort a list**
inside a block, **sort a block's children**. All are the extension's own writes (`ext:structure`), so every surface
shows who wrote them. Every saying in the demo is made up.

| Action | Acts on | Does |
|---|---|---|
| `extract` (`x`) | a passage | The passage becomes a new last child of the note and is replaced in place by `!((child))`. A whole list item (with its sub-items) becomes a child titled by the item, and the note keeps its bullet: `- !((child))`. |
| `sort-selection` (`s`) | a passage | Sorts the list items the selection touches, each with its sub-items. |
| `sort-list` (`l`) | a block | Sorts the block's first list (`list=2`: the second). |
| `sort-blocks` (`o`) | a block | Sorts the block's child blocks. |

**How to say what to sort by.** The sorts declare their arguments: `by` (`title`, the default, `created` for children,
or any property the items or children have) and `order` (`asc` or `desc`). Run by key or from the power bar, the door
asks for them, offering the keys the rows actually have; an agent says them, `act ext.structure.sort-list block=<id>
by=price order=desc` (`ep0ch ext act structure sort-list --block <id> --arg by=price --arg order=desc`). A note can
say its own default, `[sort-by::price] [sort-order::desc]`, and the service fills it in. Numbers sort as numbers,
words without regard to case, an item without the property goes last. A property nobody has is refused with the
nearest keys that exist.

**Each action is one step.** Extract makes the child and rewrites the note in one write group (the child named `child`
and linked as `!((child))`): both land or neither does, and `ctrl+z` in the reader (or `ep0ch ext undo <id>`) takes both
back. If the person has the note open in a draft, the pair waits as one proposal beside the note. Sort blocks is one
`order` write: the children in their new order, refused if a child came or went meanwhile. Mind that a child that is
also embedded in its parent shows twice.

Install: `outliner ext add structure`. Remove: `outliner ext remove structure`.

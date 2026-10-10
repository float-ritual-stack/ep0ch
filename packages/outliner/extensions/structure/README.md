# Structure

Three things you do to notes by hand, as actions: **extract** a passage into its own child block, **sort a list**
inside a block, **sort a block's children**. All are the extension's own writes (`ext:structure`), so every surface
shows who wrote them. Every saying in the demo is made up.

| Action | Acts on | Does |
|---|---|---|
| `extract` (`x`) | a passage | The passage becomes a new last child of the note and is replaced in place by `!((child))`. A whole list item (with its sub-items) becomes a child titled by the item, and the note keeps its bullet: `- !((child))`. |
| `sort-selection` (`s`) | a passage | Sorts the list items the selection touches, each with its sub-items. |
| `sort-list` (`l`) | a block | Sorts the block's first list (`with={"list":"2"}`: the second). |
| `sort-blocks` (`o`) | a block | Sorts the block's child blocks. |

**How to say what to sort by.** `by` is `title` (the default), `created` (children only), or any property name; `order`
is `asc` or `desc`. Say it in the call, `act ext.structure.sort-list block=<id> with='{"by":"price","order":"desc"}'`
(`ep0ch ext act structure sort-list --block <id> --arg by=price --arg order=desc`), or write it on the block:
`[sort-by::price] [sort-order::desc]`, and the action reads it, so a key or a click needs no prompt. Numbers sort as
numbers, words without regard to case, an item without the property goes last. A property nobody has is refused with
the nearest keys that exist.

**Extract keeps the note reading the same, and is not one undo step**: it creates the child, then rewrites the note
(two writes). If the note changes in between, it trashes the child and says so; nothing is half done. Mind that a
child that is also embedded in its parent shows twice.

**Sort blocks is a series of moves**, one per block out of place, each revision-checked; it is refused on a block a
person has a draft open in.

Install: `outliner ext add structure`. Remove: `outliner ext remove structure`.

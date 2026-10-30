# Structure

Tidy-ups you'd do by hand, as actions: pull a passage into its own note, sort a list, sort a note's children.

## What you do

- **Extract (`x`):** select a passage; it becomes a new last child of the note, and `!((child))` takes its place.
  - A whole list item with its sub-items becomes a child titled by the item; the note keeps `- !((child))`.
  - An anchor at the end of an extracted line (`^s5`) goes with it, and every link to it follows.
- **Sort a selection (`s`):** sorts the list items the selection touches, each with its sub-items.
- **Sort a list (`l`):** sorts the block's first list (`list=2` for the second).
- **Sort the children (`o`):** sorts the block's child blocks.
- **Undo:** `ctrl+z` in the reader, or `ep0ch ext undo <id>`, takes the whole step back.

## Saying what to sort by

- **`by`:** `title` (the default), `created` for children, or any property the items or children have.
- **`order`:** `asc` or `desc`.
- **In the door,** running by key or from the power bar asks for both, offering the keys the rows actually have.
- **From a shell:** `ep0ch ext act structure sort-list --block <id> --arg by=price --arg order=desc`.
- **A note's own default:** write `[sort-by::price] [sort-order::desc]` on it.
- **How it compares:** numbers as numbers, words without regard to case, an item without the property last.
- **A property nobody has** is refused, with the nearest keys that exist.

## Good to know

- **Each action is one step.** Extract writes the child and the rewritten note as one group: both land or neither.
- **An open draft waits.** If you have the note open in a draft, the pair waits as one proposal beside the note.
- **Sort children is one write.** It's refused if a child came or went meanwhile.
- **A child embedded in its parent** shows twice.
- **Who wrote it:** every write is `ext:structure`, so every surface says so.

## Setup

- **Install:** `outliner ext add structure`.
- **Remove:** `outliner ext remove structure`.
- **The demo:** every saying in it is made up.

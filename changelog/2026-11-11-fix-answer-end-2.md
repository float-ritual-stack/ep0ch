### Undo goes past a save made after ctrl+End's line, and the answer tile says what f folds first (PIE-1741)

- **ctrl+End, delete the ask, save:** the edit opened again takes the history up, and ctrl+z past the save brings the ask and yo's answer back; the line ctrl+End added is no step of the history and is never saved, whatever is taken out above it.
- **The answer tile's hint row starts with `f`:** "f fold/unfold in the edit" (or "in the reader") reads whole in a 38-column tile, before scroll and follow.
- **Run:** `ep0ch install --apply` (the door).

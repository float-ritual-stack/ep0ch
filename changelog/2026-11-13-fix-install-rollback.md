### Install's way back: the code apart from the data, the archive in place of copies (PIE-1786)

- **The data's way back is the archive once it's proved:** while a served restore drill passed in the last 7 days, install archives every outline's log, says each one's rollback point and the `ep0ch backup restore … --at …` that returns to it, and copies nothing. Without that drill, or when the archive fails, it says why in one line and copies as before.
- **The served drill:** `ep0ch backup drill --serve` restores each outline from restic, replays it and opens it with a scratch host of its own, reading its notes, timing each part.
- **The code's way back:** `ep0ch install --apply --sha <earlier> --back` resets the checkout to an earlier origin/main commit and leaves the outlines as they are; across a schema step it refuses and names the copy and the restore.
- **A schema step keeps one copy per outline:** checked (integrity and its notes counted), the older ones removed.
- **Run:** `ep0ch install --apply` on each machine, then `ep0ch backup drill --serve` there: install keeps copying until that drill has passed. No PROTOCOL, GRAMMAR or schema change.

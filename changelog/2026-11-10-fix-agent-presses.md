### What an agent or a press moves is named and can be taken back (PIE-1700, PIE-1699, PIE-1697)

- **An agent's press comes back whole:** `button.slot note=… line=… run=true` (the line the door hands an agent, with no tile) followed by `sources.undo` in a reader now takes back the title or layout the press changed with the words, or says why it stays. Before, only the words came back.
- **A press that changed nothing offers no undo:** `button.press` on a button that had nothing to do answers "nothing to undo" and no `undo` id.
- **The answer tile's buttons press:** yo's answer beside the line you're typing draws its button live; a click on it, or its number with the keys in the tile, presses it there through the note's own press, before you save. `answer.follow n=` presses a button through `act` too.
- **Leaving a section names every terminal it sent:** "pty, pty2, pty3 went into your drawer", once, in the order the drawer shows them, its groups' terminals with its own.
- **Run:** `ep0ch install --apply` (door, outline-core and the service). PROTOCOL, GRAMMAR and the schema don't move.

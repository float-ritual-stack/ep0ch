### One undo takes back a save and the answer yo removed with it (PIE-1733)

- **Undo goes through an agent's write after your save:** delete an answered ask and save, yo takes its answer out, and in the edit opened again ctrl+z (twice: it asks at the save first) brings the ask and the answer back together, said as "undid your save and yo's removal of its answer"; ctrl+y puts both back. Any agent's writes straight after a save are carried, each named; a person's write in between ends the history there, as before.
- **An answer put back by an undo is still the agent's:** taking the ask out again takes it again, and a retype replaces it instead of stacking a second one (the service keeps a removed answer's hash).
- **The answer tile's "its ask is gone" message wraps** to the tile's width, so "x closes this tile" shows at the default desk.
- **A dead answer tile isn't saved in the desk layout:** the layout saves when its ask goes, so a second door doesn't bring it back.
- **An edit opened again on an answered ask folds the answer** as the live edit does, instead of drawing its callout's raw lines.
- **Run:** `ep0ch install --apply` (host and door together).

### Writing after a yo answer keeps it folded, and leaving an answer shuts it (PIE-1741)

- **ctrl+End under an answer that ends the note** goes to a line of its own after it, the answer still one folded row; nothing is saved until you type there.
- **An answer the cursor opened shuts when the cursor leaves it:** → into it opens it, ↑ or ↓ out folds it again; one opened by a click on its row or the answer tile's `f` stays open until shut the same way.
- **A click out of an open answer lands where you clicked:** the answer folds once the click is over, so the cursor goes to the line under the pointer, not one the fold moved there; a click on its row shuts it.
- **An agent's fold never moves your cursor:** with your cursor in the answer, its fold is refused.
- **A ctrl+z after its 5 s window says so:** "late · saved · ctrl+z again in 5s undoes …", instead of asking again as if it were the first press.
- **An answered ask's row reads one way:** `· answered` in the door that watched the answer land and in a fresh one, and the words stay put when the cursor reaches the ask's end.
- **The answer tile's `f` says what it folds:** "fold/unfold in the edit" while one is open, "in the reader" (its callout) otherwise.
- **Run:** `ep0ch install --apply` (the door).

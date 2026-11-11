### A saved yo answer stays folded while you edit beside its ask (PIE-1738)

- **The cursor at an ask leaves its answer folded:** arrows, End, a click or an undo landing on an answered ask no longer draw the answer's raw lines (twenty `::button` rows); → at the ask's end goes into the answer and opens it, and the answer tile's `f` opens and shuts it.
- **A saved answer has the live one's fold row:** the ask says `· answered` under or beside it, and a click on that row opens or shuts the answer, so a folded answer is never just missing lines.
- **An undo that brings an ask back lands at the ask's end,** its answer folded under it, instead of inside the callout.
- **The undo's second press says its window:** "saved · ctrl+z again in 4s undoes …", counted down each second, in two rows of a 44-column reader; `draft.undo`'s answer still names the revision the note keeps.
- **Jev's pages go under the Extensions hub:** a fresh outline's Records page (and the reviews page and its rule) is made under `Extensions`, not at the top level; an outline that already has them keeps them where they are.
- **Run:** `ep0ch install --apply` (host and door together).

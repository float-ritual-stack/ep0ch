### Today's plan reads whole on a hub page and scrolls in place (PIE-1720)

- **A query embed:** `!((query: type=plan sort: day desc))` draws the first note a query matches, whole, where it is written, and moves to a newer one by itself; with no `sort:` it is the note edited last. A query nothing answers says why after MISSING TARGET, with the nearest keys. The door, Detail and published pages draw it as any embed.
- **`::links` takes `height:` and `sort:`:** `height:` is the preview's rows (16 when left out, then `⋮ n more rows · ⏎ opens it`), and `height: fill` draws the previewed note whole, so the wheel scrolls through it with the note and the keys stay there. `sort:` orders a query's matches in the views' words (`day desc`), the first one previewed; published pages list them in that order too.
- **Typing one is quiet:** the `((` completer offers no notes once `!((query: ` is typed, and a save gives no "not a reference" warning for it.
- **Problems wrap:** a component's problem and an embed's refusal (a query the grammar refuses, with its fix) wrap at the reading width instead of being cut.
- **Kitchen sink:** the `plan-preview` section, a bakery hub with both.
- **Run:** `ep0ch install --apply` (the host answers query targets in `transclusions.read`). GRAMMAR 49; PROTOCOL stays 320 and the schema doesn't move.

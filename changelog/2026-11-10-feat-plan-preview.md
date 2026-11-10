### Today's plan reads whole on a hub page and scrolls in place (PIE-1720)

- **A query embed:** `!((query: type=plan sort: day desc))` draws the first note a query matches, whole, where it is written, and moves to a newer one by itself; with no `sort:` it is the note edited last. A query nothing answers says why after MISSING TARGET, with the nearest keys. The door, Detail and published pages draw it as any embed.
- **`::links` takes `height:` and `sort:`:** `height:` is the preview's rows (16 when left out, then `⋮ n more rows · ⏎ opens it`), and `height: fill` draws the previewed note whole, so the wheel scrolls through it with the note and the keys stay there. `sort:` orders a query's matches in the views' words (`day desc`), the first one previewed.
- **A component's problem wraps** on its frame instead of being cut at the reading width.
- **Kitchen sink:** the `plan-preview` section, a bakery hub with both.
- **Run:** `ep0ch install --apply` (the host answers query targets in `transclusions.read`; GRAMMAR 49).

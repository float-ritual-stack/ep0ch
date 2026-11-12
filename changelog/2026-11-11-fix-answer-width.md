### An answer beside a 44-column edit leaves it room to type (PIE-1757)

- **The edit keeps its width:** an answer tile beside a reader too narrow to halve opens below it, so a 44-column edit stays 40 columns wide and the ask doesn't wrap; a wide reader keeps it beside, on the side last chosen. In a pane too short for that (44×16), it opens as a tab behind the edit, which stays whole.
- **The ask's row says where:** `beside ▸`, `below ▾`, `◂ beside` or `in a tab`, as the tile sits now.
- **One ↑ sends a wrapped ask:** an ask longer than the edit wraps; one ↑ up its wrap counts as leaving it, and it's sent (the cursor moves as before).
- **A put-aside edit's tile reads the saved ask:** typed on an answered ask, then put aside (esc, esc), the tile says the saved ask's answer, never "its ask is gone".
- **No place reads:** a tile opened beside one that leaves no place reading takes the place nearest reading, never a 0-row strip below it.
- **Run:** `ep0ch install --apply` (door only; no protocol, grammar or schema change).

### A short 44-column edit keeps its room when an answer opens (PIE-1757)

- **A tab behind, at any short height:** in a 44-column door 7 to 12 rows tall, the answer tile opens as a tab behind the edit, which stays whole; before, below 11 rows it split the edit to 24 columns and the ask wrapped. Evan's desk tiles are 9 to 13 rows.
- **The rule:** the tab is taken whenever every place beside the edit would cut it under what it keeps (28×11) or under what it has, if that's less. With nothing reading and no tab, the place that leaves the target its room comes first.
- **Run:** `ep0ch install --apply` (door only; no protocol, grammar or schema change).

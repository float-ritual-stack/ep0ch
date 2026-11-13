### A delete in pie logs one note, not the whole outline (PIE-1786)

- **Trash and moves write only the rows they change:** a delete, restore or purge worked out every block's Trash root again and wrote all of them back unchanged, and the change log recorded each one whole. In pie that was all 28,700 blocks, about 47 MB a delete; EchoNet's half-hourly toss made it 281 MB in 2.5 hours. Moves and reorders also rewrote unchanged sibling positions.
- **Run:** `ep0ch install --apply` on float-2; EchoNet's toss can resume in pie after it. No PROTOCOL, GRAMMAR or schema change. The 281 MB already logged stays until compaction (the next PR).

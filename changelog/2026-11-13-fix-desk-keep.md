### The desk comes back as Evan left it, and groups keep his tiles (PIE-1783, PIE-1782, PIE-1777)

- **No more wires after a deploy:** a tile wired to open into another came back from its save with a select wire beside it, on every deploy. An open-only link now saves as only opened into. A desk that already gained the wire keeps it until `tile.link verb=select` clears it.
- **An agent's group keeps the answer tile:** `tile.group tile=answer with=detail3` grouped both and then dropped the answer; it stays now, reading its reader across the group's edge.
- **^W P and the tile menu in a narrow group are readable:** a group's overlays draw over the whole screen, not in its tile (they were 5 columns wide at 44).
- **^W G's question is one overlay,** and a ^W chord typed next leaves it and runs.
- **One key's undo says what it put back** ("· close"), not "· 2 steps".
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.

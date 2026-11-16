### A fresh drawer keeps its shell (PIE-1798)

- **`^W B` after a pair's first move into a drawer never opened** takes back the move, not the drawer's shell: the drawer is made before the pair's move begins, as a single tile's move already made it.
- **A drag onto the drawer chip** moves a reader with its answer, as `^W a` does, instead of refusing it.
- **The bar after a pair move** names both: "put detail and its answer in your drawer".
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.

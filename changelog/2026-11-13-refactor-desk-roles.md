### A tile's behaviour lives in one place: DeskApi by role, one record per tile (PIE-1781)

- **One record per tile:** what the desk keeps about a tile beyond its instance (a kind nobody registers, a source's tile, one moved in from the drawer, a select seed, an arrival, the frame's caches) is one record in `tile-records.ts`, dropped whole as the tile leaves; `outOfStep` checks none outlives its tile.
- **The held gesture has one owner:** `gestures.ts` (`HeldGesture`) holds what the mouse button is doing, and ends a gesture its tile was part of when the tile leaves.
- **DeskApi is five roles:** `TileHost`, `ListHost`, `ReaderHost`, `RiverHost` and `KindHooks`; keys-window, the tree, tune and the blank tile take only theirs.
- **The board's card composer is its own module:** `card-composer.ts`, on the nine things it asks of the board; `lanes.ts` is 1,407 lines from 1,845.
- **^W P rows say the action they run,** and the panel runs that.
- **Esc's desk steps are typed,** with no `any`; `layout.stop` and `layout.undo anywhere` live in their actions.
- **Nothing on screen changes.**
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.

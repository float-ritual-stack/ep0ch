### The desk's first parts move out of desk.ts, with nothing on screen changed (PIE-1778)

- **A tile's title has one home:** what the tile bar, its tabs, a spine, the frame and `layout.get` call a tile is `src/desk/tile-title.ts`, pure over the tile. The tile frame is desk.ts's busiest span.
- **What placement remembers between opens has one owner:** the tile each open goes beside, and the tiles opened into a container, are `src/desk/placement-memory.ts`. Before, the desk wrote, read and pruned them in nine places.
- **A saved layout's wires come back in one function:** `reviveWires` in `src/desk/saved-wires.ts`, pure, out of the desk's `build`.
- **The overlay pickers take six members, not the desk:** `desk-overlays.ts` names its `OverlayHost` and imports nothing of the desk.
- **Copies removed:** four copies of the layout's "an agent leaves the person's tile alone" refusal are one, `autoName` is `freeName`, and `DeskApi` declares `perform` once.
- **Where each part lives:** a row in the door's reuse map, and the inventory under PIE-1778 names what's still to cut.
- **Run:** nothing; no PROTOCOL, GRAMMAR or schema change.

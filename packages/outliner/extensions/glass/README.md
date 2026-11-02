# Glass

Hover a link and its note shows in a post-it on the glass, above every screen (PIE-1481; an extension since PIE-1505).

- **Turn it on:** click ◇ on the status bar, or alt+u: off → on → sticky → off.
  - **on:** a post-it opens once the pointer rests on a link, a cut-off title or a note row, and closes after it leaves.
  - **sticky:** each hover stays as a post-it until you dismiss it.
  - alt-hover keeps one sticky, even with hover off.
- **In a post-it:** ← → flip through what you hovered before (the wheel over its title too).
  - p keeps it (◇ ◆ on its title), alt+E peels the shown note into its own post-it, alt+X drops it from the stack.
  - Esc dismisses it; alt+U, or an alt-click on ◇, clears the glass.
- **Shelves:** `glass.shelf name=seeds colour=amber` makes a named, coloured shelf; drag post-its onto it, or `glass.shelve ref=<id> shelf=seeds`.
  - v switches it between a list and a grid, c its colour.
- **Delays and limits:** Tune → Glass (G): open, close and grace delays, the hover history's length, the pinned soft limit. `glass.tune name=open value=150` from anywhere.
- **On by default:** a default-on built-in (`defaultOn`): the host installs it at start wherever it runs, unless you uninstalled it there.
- **Remove:** `ep0ch act extensions.uninstall id=glass demo=keep`.
  - Hover then does nothing and ◇ is gone; `glass.*` says how to bring it back: `ep0ch act extensions.install id=glass`.
  - The glass itself stays: `tile.float to=glass` (^W U) still keeps any tile above every screen.

## How it's made

| Need | The part that's there |
|---|---|
| What is under the pointer | the door's hover event (`src/hover.ts`): never while a button is down or over chrome; `door.hover` on the door event wire once the pointer rests |
| ◇ on the status bar | an extension's status chip (`src/status-chips.ts`): its text, click (`glass.toggle`) and alt-click (`glass.clear`) |
| Where post-its go | the float layer (`src/float-layer.ts`): put, dock, tuck, drag off |
| Tune → Glass | a Tune section (`registerTuneSection`, `src/desk/tune.ts`) |
| Running in the door | `"door": "glass"` in `extension.json`: the door runs its shipped module `packages/door/ext/glass` while this extension is served (`src/door-modules.ts`) |

## Your own hover behaviour

Write one as an extension of your own: its program hears every resting hover with `events.subscribe` and
`kinds: ["door.hover"]`, and a rule runs one of its actions on the hovered note with `on: { events: { "door.hover":
"<action>" } }` (the extensions README, "`on`: change and open triggers"). The envelope names the tile, the note, the
link and the words under the pointer.

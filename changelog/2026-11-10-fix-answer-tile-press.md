### A button in the answer tile acts on your reader; the 44-column bar reads from its start (PIE-1699, PIE-1707)

- **A tile-relative button pressed beside the line acts where you type:** yo's `[▸ agent]` (`tile.agent`, no `tile=`) pressed in the answer tile, by click, its number key or `answer.follow`, changes the reader you're typing in, as it does in the note, never the answer tile itself. Every press made in a reader places a tile's action (`tile.agent`, `tile.title`, `tile.zoom`) in that reader, wherever the keys are; a landing (`open`) and a screen-wide change keep their scope.
- **The status bar's message reads from its first word at 44 columns:** a message the bar cuts ends in `…` and stays put, instead of scrolling to a window from its middle; the whole message is still said above the bar.
- **The edit confirm names its key:** "Open this note for editing? ⏎ opens it; any other key keeps reading."
- **Run:** `ep0ch install --apply` (the door only). PROTOCOL, GRAMMAR and the schema don't move.

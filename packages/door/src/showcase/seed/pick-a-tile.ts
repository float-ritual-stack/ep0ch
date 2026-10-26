// The showcase's "Pick a tile" section (PIE-1297, PIE-1298, PIE-1312): a button whose slot is empty asks for its value, a
// tile's or a note's menu copies its address, and the editor marks a button that won't run. Fictional: the tiles are the
// section's own.
export const PICK_A_TILE = [
  "Pick a tile instead of typing its id",
  "Press pop it. Its target= is empty, so the door asks which tile: click one, or press its number. A tile whose place has a name of its own (the drawer's program) asks once more: this tile exactly, or whichever fills its place. The choice is written on the line, ctrl+z takes it back, and the next press lifts that tile above the drawer. Alt+click chooses again.",
  '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}',
  "A button that reads differently than it was written runs nothing, and says what to write (nested quotes ended act= early):",
  '::button{label="misread" act="tile.zoom reach="column" tile="t-a6125371"}',
  "Open any tile's menu (the ⋯ in its header): it is headed with the tile's name and id. Copy id and copy reference under Tile put the tile's address on your clipboard; under Note, the note's id or ((id|title)).",
  "Press e and write a button on a new line: its names, values and action are coloured as you type, what won't run is underlined, and the row under it says what it runs or why not.",
].join("\n");

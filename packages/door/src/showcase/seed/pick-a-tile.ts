// The showcase's "Pick a tile" section (PIE-1297, PIE-1298): a button whose slot is empty asks for its value, and a tile's
// menu copies the address that fills it. Fictional: the tiles are the section's own.
export const PICK_A_TILE = [
  "Pick a tile instead of typing its id",
  "Press pop it. Its target= is empty, so the door asks which tile: click one, or press its number. A tile that fills a role asks whether you mean this tile or the role it fills. The choice is written on the line, ctrl+z takes it back, and the next press lifts that tile above the drawer. Alt+click chooses again.",
  '::button{label="pop it" act="tile.zoom tile={target} reach=column" target=}',
  "A button that reads differently than it was written runs nothing, and says what to write (nested quotes ended act= early):",
  '::button{label="misread" act="tile.zoom reach="column" tile="t-a6125371"}',
  "Open any tile's menu (the ⋯ in its header): it is headed with the tile's name and id, and copy id and copy reference put the address on your clipboard.",
].join("\n");

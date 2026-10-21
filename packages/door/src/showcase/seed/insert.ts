import { SEED } from "./names";

export const INSERT = [
  SEED.insert,
  "",
  "Press e, then Enter to edit. Click [insert] or press Ctrl+T to open the picker beside this draft.",
  "The picker title shows its folder: the nearest cwd:: in this note or its ancestors, then the outline folder, then home.",
  "Choose two files and press Enter. Each becomes its own absolute - [file::...] line; references stay space-separated.",
  "Move this draft to the drawer with tile.drawer and enter it: the picker still opens beside the draft.",
  "Television shows its marks inside its own window.",
  "",
].join("\n");

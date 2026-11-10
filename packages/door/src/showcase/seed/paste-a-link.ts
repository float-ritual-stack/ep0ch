// The showcase's "Paste a link" section (PIE-1401, PIE-1316, PIE-1390): a note's web link or `ep0ch://` address pasted bare
// into a note is a link that opens it, and every place a note is seen copies those addresses. Fictional: the rota, its
// days and the rules page are made up; the two addresses are the service's for the rota, read at seed time.
import { SEED } from "./names";

/** The note the section's links open: a rota with lines to copy a reference to. */
export const KEY_ROTA = [
  `${SEED.keyRota}`,
  "Who has the shed key each weekend.",
  "## Saturday",
  "- Ana opens at nine and waters the seedlings.",
  "## Sunday",
  "- Ravi locks up after the swap table.",
].join("\n");

/** The note to paste into, with the rota's web link and `ep0ch://` address already pasted bare, each on a line. */
export const pasteALink = (id: string, link: string, uri: string) => [
  SEED.pasteALink,
  "A note's address pasted bare is a link: click it (or ⏎ on it) and the note opens where a reference's would.",
  `- Its web link: ${link}`,
  `- Its ep0ch:// address: ${uri}`,
  "- Any other web page opens in the browser: https://example.org/allotment-rules",
  `- The same note by reference, which the links tile lists: ((${id}|the rota))`,
  "Copy one yourself: open the ⋯ menu of the rota (or right-click a row in the links tile) and pick copy note web link, or put the cursor on a line of the rota and pick copy line reference. Press e here, paste it on a line of its own, save, and click it.",
  "- Paste here:",
].join("\n");

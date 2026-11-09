import { SEED } from "./names";

// PIE-1237: marks, the outline's: made here by key, click or act, and gathered by a query.
export const MARKING = `${SEED.marking} [page::marks demo]

Mark what you're looking at, from anywhere, then ask what you gathered.
- **Key:** alt+m on the reader beside marks its note; alt+m again takes your mark off.
- **Click:** right-click a row (or the tile's ⋯) and choose mark this note.
- **Agents:** act block.mark-toggle tile=bed, or block.mark id=… reason=… for a "look here" frame.
- alt+' steps through the marks; a click on a ◆ label takes it off.
A mark lives in the outline, so your other door, the web page and an agent's query see it at once.

Marked today, live:

::view{query="marked:today" layout=table}`;
export const MARK_POTATOES = `${SEED.markPotatoes}\nChit them on the windowsill, eyes up, six weeks before planting.`;
export const MARK_FROST = `${SEED.markFrost}\nPeg the cloth over the brassicas before the first hard frost.`;

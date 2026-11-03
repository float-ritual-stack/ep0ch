// A reader's facts (PIE-1523), in a module of its own: the river column and the settings card take it, and importing it
// from builtin-tiles (which registers the river column's kind) made a cycle that broke the door's start (PIE-1526).
import { ReaderPane, sessionName, type Pane } from "./panes";
import type { KindFacts, KindFactsAsk } from "./tile-kinds";

/**
 * A reader's facts: its trail (history), its pin, the edit it holds and the person's keys in it. Any kind whose tiles
 * are readers answers with it (a river column, the settings card, a screen's own reader).
 */
export function readerFacts(p: Pane, ask: KindFactsAsk): KindFacts {
  // A function, not a const: kinds made as their modules load (the settings card) take it through an import cycle.
  if (!(p instanceof ReaderPane)) return {};
  return {
    history: true, lists: false, pinned: p.pinned, holdable: p.pinnable,
    ...(p.holdsKeys ? { holdsKeys: true } : {}),
    ...(p.editing && !(ask.leavesDraft && p.surface.drafting) ? { editing: sessionName(p) } : {}),
  };
}

// An anchor: a place on drawn text that other things attach to. A part of a page (`PagePart`, note-page.ts), named
// by the line of its note it starts on, and a range of the text its view is drawn from. A comment thread's passage
// is the first thing attached this way (`PartMark`, kind `thread`); a proposal's passage, a range somebody just
// wrote and a card that hovers over words are the next, and attach the same way: nothing here is about comments.
//
// Why a range of the view's text: a client that can't run this package (the native window, a web view) draws a part
// from the text the service handed it (a prose part's Markdown) and has no reading of the note's source. So the
// service says where in *that* text the words are, and the client marks them there. Where a span of the source is
// in a text written from it is asked of the one reading every renderer shares (drawn-passage.ts's `spanIn`): both are
// read as drawn, and the same drawn words are the same place. No client maps a source offset.
//
// Offsets are UTF-16, as everywhere on the wire. Types only: the reading is drawn-passage.ts's.

/**
 * A place in a part's drawn words: the range of the text its view is drawn from (`view.text`; `end` exclusive).
 * Neither: the part whole (a figure, a list, a button: something drawn from more than words).
 */
export interface PartAnchor { start?: number; end?: number }

/**
 * Something attached to a part's drawn words: where (its anchor), what it is, the thing by its id, and the act a
 * press on the marked words runs (the service's word, as a row's `act` is). `kind` is open: a client draws the kinds
 * it knows and leaves the rest.
 */
export interface PartMark extends PartAnchor {
  kind: "thread";
  id: string;
  /** What a press on it runs. */
  act?: string;
}

// The controls must read the same in a terminal font and the CP437 font.
export const FRAME_GLYPHS = {
  select: "s", open: "o", alt: "a",
  foldLeft: "\u25c4", // black left-pointing pointer
  foldDown: "\u25bc", // black down-pointing triangle
  menu: "\u2261", // identical to
  close: "x",
  follows: "\u00ab", // left-pointing double angle quotation mark
  float: "\u25d8", // inverse bullet
  hold: "\u25cb", // white circle
  held: "\u2022", // bullet
} as const;

export const FRAME_LEGEND = `s where a select lands - o where an open lands - a where an alt-open lands - ${FRAME_GLYPHS.foldLeft}/${FRAME_GLYPHS.foldDown} fold - ${FRAME_GLYPHS.menu} menu - x close - ${FRAME_GLYPHS.follows} follows a reader - ${FRAME_GLYPHS.float} float or put back - ${FRAME_GLYPHS.hold}/${FRAME_GLYPHS.held} follow or hold`;

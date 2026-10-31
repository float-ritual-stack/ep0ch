// The controls must read the same in a terminal font and the CP437 font.
export const FRAME_GLYPHS = {
  select: "○", open: "»", alt: "^", hover: "◇",
  foldLeft: "\u25c4", // black left-pointing pointer
  foldDown: "\u25bc", // black down-pointing triangle
  menu: "\u2261", // identical to
  close: "x",
  follows: "\u00ab", // left-pointing double angle quotation mark
  float: "\u25d8", // inverse bullet
  hold: "°", // degree sign
  held: "\u2022", // bullet
} as const;

export const FRAME_LEGEND = `${FRAME_GLYPHS.select} where a select lands - ${FRAME_GLYPHS.open} where an open lands - ${FRAME_GLYPHS.alt} where an alt-open lands - ${FRAME_GLYPHS.foldLeft}/${FRAME_GLYPHS.foldDown} fold - ${FRAME_GLYPHS.menu} menu - x close - ${FRAME_GLYPHS.follows} follows a reader - ${FRAME_GLYPHS.float} float or put back - ${FRAME_GLYPHS.hold}/${FRAME_GLYPHS.held} follow or hold`;

// Fictional notes whose links and anchors the service and the door must read alike: outline-core's scan, the
// outliner's references and fragments (test/references.test.ts), and the door's reader over a scratch host
// (test/link-syntax.test.ts) run these same notes.

/** The note a labelled reference points at. */
export const PAINT_ID = "dddddddd-4444-4444-8444-444444444444";

/** A label with parentheses: it runs to the `))` that balances them. */
export const PAREN_LABEL = "Rough edges (x)";
export const PAREN_LABEL_NOTE = `Shed door\nSand the ((${PAINT_ID}|${PAREN_LABEL})) before the first coat.`;

/** A page link with a blank label is no link (it stays text); the labelled one beside it is. */
export const BLANK_LABEL_NOTE = "Plot plan\nThe [[Garden| ]] stays text, and [[Garden|the garden]] is a link.";
export const BLANK_LABEL_PAGES = [{ address: "Garden", label: "the garden" }];

/**
 * Lines that end in a fragment anchor, and the id each names: after any blank (a tab, a no-break space), with blanks
 * after it, or alone on its line (naming the line above). The last two are no anchor.
 */
export const ANCHOR_LINES: [string, string | null][] = [
  ["## Beds ^beds", "beds"],
  ["Sow the leeks\t^leeks", "leeks"],
  ["Stake the peas ^peas  ", "peas"],
  ["Water the beans\u00a0^water", "water"],
  ["^tail", "tail"],
  ["Ratio 2^8", null],
  ["Ends ^bad!", null],
];
export const ANCHOR_NOTE = ["Allotment anchors", ...ANCHOR_LINES.map(([line]) => line)].join("\n");

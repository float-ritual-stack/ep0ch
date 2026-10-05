// Shared fixtures for every reader of component blocks (outline-core's componentBlocks, the door's render, folds,
// links and export, the service's sections, the Claude mod's detail view, which holds a copy of COMARK_NOTE because a
// plugin test can't import outside its folder): one note, one answer everywhere.

/** A figure whose Markdown body documents Comark syntax in a code fence, with a bare `::` inside it. */
export const FENCED_FIGURE = [
  "::graph-annotate",
  "```md",
  "::graph-stat",
  "---",
  "title: Example",
  "---",
  "::",
  "```",
  "1. the example figure",
  "::",
];

/** A second figure, after a heading. */
export const SECOND_FIGURE = ["::graph-stat", "---", "title: Open", "---", "::"];

/** A note: its title, the fenced figure, a heading, then the second figure and a closing line. */
export const COMARK_NOTE = ["Comark notes", ...FENCED_FIGURE, "", "## Second", "", ...SECOND_FIGURE, "", "after"];

/** Where each component block of COMARK_NOTE starts and ends (inclusive), as componentBlocks answers. */
export const COMARK_NOTE_BLOCKS = [
  { name: "graph-annotate", args: null, start: 1, end: 10 },
  { name: "graph-stat", args: null, start: 14, end: 18 },
];

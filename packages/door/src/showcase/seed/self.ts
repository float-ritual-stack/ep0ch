// The notes that read themselves (PIE-533 S3): one page that lists where it wrote a key and draws a body only while it
// matches, and two project pages carrying the same figure, each listing its own tickets. Made up for the showcase.

/**
 * One key (`connectTo`) written in every form a note has (a header chip, two front-matter lines, one holding a list, an
 * inline chip, a line of its own), a `::fields` listing each occurrence with its line, a second `::fields` on the
 * hashtags (key `tag`), and two `::if` bodies, one that holds and one that doesn't.
 */
export const VENT_RAIL = [
  "Where a key is written [status::active] [owner::sam] [connectTo::in the header] #greenhouse",
  "- connectTo:: in the front matter",
  "- connectTo:: ['a list', 'is a row each']",
  "",
  "The header chip and the two front-matter lines are in the property panel (i); the rows below list them too. In the body it is written [connectTo::inline in a sentence] and again on a line of its own, with a #spring tag:",
  "connectTo:: a line of its own",
  "",
  "::fields{key=connectTo title=\"Every connectTo in this note\"}",
  "",
  "A hashtag is the key tag:",
  "",
  "::fields{key=tag title=\"Hashtags (key tag)\"}",
  "",
  "::if{where=\"status=active\"}",
  "The rail is live: this paragraph is drawn only while the note is active.",
  "::",
  "",
  "::if{where=\"status=paused\"}",
  "The rail is paused: this paragraph is drawn only while the note is paused.",
  "::",
].join("\n");

/** The figure both project pages carry: `this` is the page it is drawn on. */
export const PROJECT_FIGURE = ["::graph-table", "---", "title: Tickets for this project", "query: type=ticket project={{this.project}}", "columns: [title]", "---", "::"].join("\n");

export const PROJECT_TICKETS = [
  { title: "Sort the bricks", project: "lego-night" },
  { title: "Build the tower", project: "lego-night" },
  { title: "Water the beans", project: "garden-club" },
  { title: "Mend the cold frame", project: "garden-club" },
  { title: "Order the seed potatoes", project: "garden-club" },
] as const;

// The notes that read themselves (PIE-533 S3): one page that lists where it wrote a key and draws a body only while it
// matches, and two project pages carrying the same figure, each listing its own tickets. Made up for the showcase.

/** A key written on several lines, a `::fields` that lists them, and two `::if` bodies, one that holds and one that doesn't. */
export const VENT_RAIL = [
  "Vent rail demo [status::active] [owner::sam]",
  "",
  "Notes on the vent rail for the greenhouse.",
  "- first pass [connectTo::demonstrating by doing]",
  "- second pass [connectTo::shacks not cathedrals]",
  "",
  "::fields{key=connectTo title=\"Said so far\"}",
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

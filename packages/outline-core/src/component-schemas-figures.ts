// The `::graph-*` figures' schemas (PIE-701): one per kind the readers draw, so the component library, the completer and
// `ep0ch library --brief` know every figure without a line of per-figure code. A figure's options are its YAML (between
// the `---` lines); its rows are Markdown after them (`- label: 12`, outline-core's figure-markdown.ts), written into the
// source a variation shows, and its live form (`query:`/`view:`) is asked of the outline, so the library says it isn't
// drawn there. A kind's name is the id (`graph-rank`); the door's `GRAPH_KINDS` is what a test holds this list to
// (packages/door/test/component-coverage.test.ts). Pure: no I/O; types only from component-schema.ts.
import type { ComponentSchema, PropSchema, PropValue } from "./component-schema";

const enumOf = (meanings: Record<string, string>): PropValue[] => Object.entries(meanings).map(([value, meaning]) => ({ value, meaning }));
const yaml = (key: string, type: PropSchema["type"], meaning: string, extra: Partial<PropSchema> = {}): PropSchema => ({ key, where: "yaml", type, meaning, ...extra });

const TITLE = yaml("title", "text", "the title in the figure's frame", { samples: ["Plot jobs", "Moth counts"] });
const CAPTION = yaml("caption", "text", "a quiet line under the figure", { samples: ["the last seven days"] });
const QUERY = yaml("query", "query", "makes the figure live: the blocks this query holds for are its rows, asked of the outline", { samples: ["type=task", "type=roadmap-item project=house"] });
const VIEW = yaml("view", "ref", "a saved view ((id)) whose query makes the figure live, in place of `query:`");
const LIMIT = yaml("limit", "int", "the most results a live figure asks for", { min: 1, max: 1000, default: "200" });
const SORT = yaml("sort", "text", "a live figure's sort field (updated when left out)", { default: "updated", samples: ["updated", "created", "title"] });
const DIRECTION = yaml("direction", "enum", "a live figure's sort direction", { default: "desc", values: enumOf({ asc: "oldest or smallest first", desc: "newest or largest first" }) });
const LIVE = [QUERY, VIEW];
const DENSITY = yaml("density", "enum", "how many lines a row's title takes (the reader's choice, `=`, goes over this)", { default: "compact", values: enumOf({ compact: "one line a row", cozy: "two lines", comfortable: "three lines, a blank between rows" }) });

const LIVE_WORDS = "\n\nWith `query:` or `view:` the figure is live: it is drawn from the outline's blocks and refreshed as they change. The library has no outline to ask, so it shows the static form and says so here.";

interface Kind {
  kind: string; title: string; intro: string; props: PropSchema[];
  /** The rows under the YAML, as a variation writes them. */
  rows?: string;
  example: Record<string, string>; sweep: string[]; grids?: [string, string][]; space?: string[];
  where?: string;
}

function figure(k: Kind): ComponentSchema {
  const id = `graph-${k.kind}`;
  return {
    id, title: `${k.title} (::${id})`, intro: k.intro, where: k.where ?? `a \`::${id}\` block: its options in the YAML between \`---\` lines, its rows in Markdown after them`,
    props: k.props, source: { use: `::${id}\n---\n{yaml}\n---\n${k.rows ? `${k.rows}\n` : ""}::` }, example: k.example,
    sweep: k.sweep, grids: k.grids ?? [], space: k.space ?? k.sweep,
  };
}

const FIGURES: Kind[] = [
  {
    kind: "stat", title: "Stat", intro: "Big numbers with labels under them, tiles that wrap into rows when they don't fit: the counts a note wants at a glance. The bold row (or `accent: true`) is the accent; with none, the last. A live item counts the blocks its own `query:` holds." + LIVE_WORDS,
    props: [TITLE, yaml("items", "list", "the tiles, each { value, label } and optionally { query } to count live", { samples: ["[{ value: \"18\", label: outbox }, { value: \"8\", label: waiting }]", "[{ value: \"3\", label: drafts }]"] })],
    example: { title: "this week", items: "[{ value: \"18\", label: outbox }, { value: \"8\", label: waiting }, { value: \"2\", label: drafts }]" }, sweep: ["items"],
  },
  {
    kind: "kpi", title: "KPI", intro: "The same figure as `::graph-stat`, by its other name: big numbers with labels, the last (or the bold one) in the accent. Rows are `- label: value`.",
    props: [TITLE, yaml("items", "list", "the tiles, each { value, label }", { samples: ["[{ value: \"98%\", label: uptime }, { value: \"41\", label: notes }]"] })],
    example: { title: "this month", items: "[{ value: \"98%\", label: uptime }, { value: \"41\", label: notes }]" }, sweep: ["items"],
  },
  {
    kind: "rank", title: "Rank", intro: "Bars sized by a count, longest first as written; the accent row is bold (`accent: true`), a receding one italic (`muted: true`). Rows are `- label: 12`. Live, the results are counted by the value of the `group:` property." + LIVE_WORDS,
    props: [TITLE, yaml("items", "list", "the bars, each { label, value }, optionally accent or muted", { samples: ["[{ label: docs, value: 12 }, { label: code, value: 30, accent: true }]", "[{ label: a, value: 3 }, { label: b, value: 1, muted: true }]"] }), ...LIVE,
      yaml("group", "text", "a live figure's property whose values are counted", { default: "status", samples: ["status", "type"] })],
    example: { title: "where the work went", items: "[{ label: docs, value: 12 }, { label: code, value: 30, accent: true }]" }, sweep: ["items"],
  },
  {
    kind: "funnel", title: "Funnel", intro: "Steps that narrow, drawn as bars: how many made it to each stage. Rows are `- label: value`; `display:` shows words instead of the number.",
    props: [TITLE, yaml("steps", "list", "the steps in order, each { label, value } and optionally { display }", { samples: ["[{ label: seen, value: 100 }, { label: tried, value: 40 }, { label: kept, value: 12 }]", "[{ label: asked, value: 9, display: nine }, { label: done, value: 3, display: three }]"] })],
    example: { title: "from seen to kept", steps: "[{ label: seen, value: 100 }, { label: tried, value: 40 }, { label: kept, value: 12 }]" }, sweep: ["steps"],
  },
  {
    kind: "waterfall", title: "Waterfall", intro: "A running total: the first and last items are totals, the ones between are changes (negative in blue) stepped from the first.",
    props: [TITLE, yaml("items", "list", "the bars in order, each { label, value }: the first is the start, the last the end", { samples: ["[{ label: start, value: 100 }, { label: gained, value: 30 }, { label: lost, value: -20 }, { label: end, value: 110 }]"] })],
    example: { title: "the budget", items: "[{ label: start, value: 100 }, { label: gained, value: 30 }, { label: lost, value: -20 }, { label: end, value: 110 }]" }, sweep: ["items"],
  },
  {
    kind: "plot", title: "Plot", intro: "A sparkline with `labels:` naming the first and last point: the same bars, with where the run began and ended said under them. Rows `- Mon: 2` label the points.",
    props: [TITLE, yaml("data", "list", "the numbers, in order", { samples: ["[3, 5, 2, 8, 6, 9]", "[1, 2, 4, 8, 16]"] }), yaml("labels", "list", "a name for each number; the first and last are said", { samples: ["[Mon, Tue, Wed, Thu, Fri, Sat]", "[jan, feb, mar, apr, may]"] }), CAPTION],
    example: { title: "Visits", data: "[3, 5, 2, 8, 6, 9]", labels: "[Mon, Tue, Wed, Thu, Fri, Sat]" }, sweep: ["data", "labels"],
  },
  {
    kind: "gantt", title: "Gantt", intro: "Bars on a shared timeline: each item starts and ends as a share of the whole (0 to 1), and `complete:` fills it. An item part done is the accent; `progress:` marks now with a ▾ and `ticks:` label the axis.",
    props: [TITLE, yaml("items", "list", "the bars, each { label, start, end, complete } with start, end and complete from 0 to 1", { samples: ["[{ label: plan, start: 0, end: 0.3, complete: 1 }, { label: build, start: 0.2, end: 0.8, complete: 0.5 }, { label: ship, start: 0.8, end: 1 }]"] }),
      yaml("ticks", "list", "the axis labels, spread across", { samples: ["[Oct, Nov, Dec]", "[w1, w2, w3, w4]"] }), yaml("progress", "number", "where now is, 0 to 1", { samples: ["0.35", "0.7"] })],
    example: { title: "the plot", items: "[{ label: plan, start: 0, end: 0.3, complete: 1 }, { label: build, start: 0.2, end: 0.8, complete: 0.5 }, { label: ship, start: 0.8, end: 1 }]", ticks: "[Oct, Nov, Dec]" }, sweep: ["ticks", "progress"],
  },
  {
    kind: "tree", title: "Tree", intro: "Nested labels drawn with branches, each node optionally a quiet `meta` beside it and an accent.",
    props: [TITLE, yaml("nodes", "list", "the nodes, each { label, meta, accent, children: [...] }", { samples: ["[{ label: garden, children: [{ label: beds, meta: 4 }, { label: shed, accent: true }] }]", "[{ label: a }, { label: b, children: [{ label: c }] }]"] })],
    example: { title: "the garden", nodes: "[{ label: garden, children: [{ label: beds, meta: 4 }, { label: shed, accent: true }] }]" }, sweep: ["nodes"],
  },
  {
    kind: "check", title: "Checklist", intro: "A list with boxes: `- [x] done`, `- [ ] open`, or a bold row without a box for done; a muted side note after an em dash. Live, each result is an item and a note's `done:` is the results that are done, `now:` those under way." + LIVE_WORDS,
    props: [TITLE, ...LIVE, yaml("note", "text", "a live figure's property whose value is each item's side note", { samples: ["owner", "when"] })],
    rows: "- [x] Order the seed\n- [x] Dig the beds — before the frost\n- [ ] Water at nine\n- [ ] Cover the tomatoes",
    example: { title: "Saturday" }, sweep: [],
  },
  {
    kind: "timeline", title: "Timeline", intro: "Events down a spine: `- 2026-03: label`, a bold row is now (●, in the accent), an italic one is next (○), a side note after an em dash. Live, each result is an event dated by its updated time, or by the property `date:` names." + LIVE_WORDS,
    props: [TITLE, ...LIVE, yaml("date", "text", "a live figure's property that dates each event", { samples: ["when", "due"] }), yaml("sort", "enum", "which time dates a live event (when `date:` isn't set)", { default: "updated", values: enumOf({ updated: "when it last changed", created: "when it was written" }) })],
    rows: "- 2026-03: seeds sown\n- 2026-05: first flowers — early\n- **2026-08: the open garden**\n- *2026-10: seed collecting*",
    example: { title: "The garden year" }, sweep: [],
  },
  {
    kind: "table", title: "Table", intro: "Rows and columns: `headers:`, `rows:` (a list of rows), an optional `footer:`, and `align:` per column. Live, the results are rows and `columns:` name the properties (title and updated when left out); a row opens its note. Narrow, only the title column and one more are drawn and the rest are counted." + LIVE_WORDS,
    props: [TITLE, yaml("headers", "list", "the column names", { samples: ["[Agent, Tokens, Time]", "[Name, Count]"] }), yaml("rows", "list", "the rows, each a list of cells", { samples: ["[[Inks, \"115,207\", 16m], [Patterns, \"186,716\", 18m]]", "[[a, 1], [b, 2]]"] }),
      yaml("footer", "list", "a closing row, ruled off", { samples: ["[Total, \"301,923\", 34m]"] }), yaml("align", "list", "left or right for each column", { samples: ["[left, right, right]", "[left, left, right]"] }),
      yaml("columns", "list", "a live table's properties, one a column (title and updated: the defaults)", { samples: ["[title, status, updated]", "[ticket, title, owner]"] }), yaml("titleColumn", "int", "which column is the title, the one density wraps", { min: 0, max: 8, default: "0" }), DENSITY, ...LIVE, LIMIT, SORT, DIRECTION],
    example: { title: "what the research cost", headers: "[Agent, Tokens, Time]", rows: "[[Inks, \"115,207\", 16m], [Patterns, \"186,716\", 18m]]", footer: "[Total, \"301,923\", 34m]", align: "[left, right, right]" }, sweep: ["align", "footer", "density"], grids: [["align", "footer"]],
  },
  {
    kind: "tabs", title: "Tabs", intro: "A live query's results grouped by a property, a tab each with its count, the chosen tab's rows drawn as a table. Tabs switch by a click, `tab` and `shift+tab`, or `figure.tab`. It is always live: the library shows its frame and says so." + LIVE_WORDS,
    props: [TITLE, ...LIVE, yaml("group", "text", "the property whose values make the tabs", { default: "status", samples: ["status", "work-stage"] }), yaml("order", "list", "tabs listed first, even when empty; the rest follow alphabetically", { samples: ["[doing, review, queued]"] }),
      yaml("columns", "list", "each tab's table columns (title and updated: the defaults)", { samples: ["[title, updated]"] }), yaml("limit", "int", "rows a tab shows before saying how many more", { min: 1, max: 1000, default: "50" }), DENSITY],
    example: { title: "Jobs by stage", query: "type=task", group: "status" }, sweep: ["group", "order"],
  },
  {
    kind: "decision", title: "Decision", intro: "The options weighed: chosen (●), rejected (×) or still open (○), each with its reason, then what was decided in prose with its status and date. Rows are `- **chosen** — reason`, `- *rejected* — reason`, `- open — reason`. Live, each result is an option and its `decision-state` says which glyph." + LIVE_WORDS,
    props: [TITLE, yaml("status", "text", "where the decision stands", { samples: ["decided", "open"] }), yaml("date", "text", "when", { samples: ["2026-10-03"] }), ...LIVE, yaml("reason", "text", "a live figure's property that holds each option's reason", { default: "reason", samples: ["reason"] })],
    rows: "- **Bun workspaces** — one lockfile\n- *pnpm + turbo* — two tools\n- nx — not tried\n\nWe chose what we already run.",
    example: { title: "one repo", status: "decided", date: "2026-10-03" }, sweep: ["status", "date"],
  },
  {
    kind: "chat", title: "Chat", intro: "A few turns of a conversation: the first speaker (or `you:`) gets the `>` prompt, a speaker who speaks again isn't named again, an italic turn is an aside, drawn dim. Rows are `- name: words`.",
    props: [TITLE, yaml("you", "text", "the speaker who gets the prompt (the first speaker when left out)", { samples: ["shypht", "loki"] }), yaml("messages", "list", "the turns, each { from, text, aside } (the YAML form of the rows)", { samples: ["[{ from: shypht, text: did the backups run? }, { from: loki, text: \"yes, at 03:00\" }]"] })],
    rows: "- shypht: did the backups run?\n- loki: yes, at 03:00\n- loki: fourteen snapshots\n- daddy: *goes to make tea*",
    example: { title: "at the board" }, sweep: ["you"],
  },
  {
    kind: "keys", title: "Keys", intro: "A keymap cheat sheet, each key drawn as keycaps (`ctrl+k` is [ctrl][k], `g then d` is [g] then [d]); a bold row is one to learn first. Or `actions:` names a scope and the door's own keys are read from the action registry, so the sheet never drifts from what the keys do. Rows are `- ctrl+k: the command palette`.",
    props: [TITLE, yaml("actions", "list", "scopes of the door's action registry whose keys are listed (in place of rows)", { samples: ["note", "desk", "[note, desk]"] }), yaml("learn", "list", "action names drawn as learn-first", { samples: ["[edit, comment.start]"] }), yaml("limit", "int", "the most keys listed from the registry", { min: 1, max: 200, default: "40" })],
    rows: "- **e: edit the note**\n- g then d: the desk\n- ctrl+k: the command palette",
    example: { title: "the reader" }, sweep: [],
  },
  {
    kind: "uptime", title: "Uptime", intro: "A glyph a day: ok, degraded, down or nothing recorded. Rows are runs of states, `ok*20 degraded ok*9 down`, from `from:`. Live, each result is a day by its `date` property and `status`; `last: 30` is the thirty days to today, and `source: backups` reads the backup runs." + LIVE_WORDS,
    props: [TITLE, yaml("from", "text", "the first day, YYYY-MM-DD", { samples: ["2026-09-01"] }), yaml("to", "text", "the last day, YYYY-MM-DD (today when left out)", { samples: ["2026-09-30"] }), yaml("last", "int", "a live figure's window: this many days to today (or `to:`)", { min: 1, max: 365, samples: ["14", "30"] }),
      yaml("wrap", "int", "days to a line", { min: 5, max: 90, default: "30" }), ...LIVE, yaml("date", "text", "a live figure's property with each result's day", { default: "date", samples: ["date"] }), yaml("state", "text", "a live figure's property with each result's state", { default: "status", samples: ["status"] }), yaml("source", "enum", "a known source of runs", { values: enumOf({ backups: "the backup-run notes a timer writes" }) })],
    rows: "- ok*20 degraded ok*9 down ok*3",
    example: { title: "backups", from: "2026-09-01", to: "2026-10-04" }, sweep: ["wrap", "from"],
  },
  {
    kind: "activity", title: "Activity", intro: "A contribution grid: a column a week, a row a weekday, shaded by the count that day. Rows are a week each from a date, `- 2026-03-02: 0 1 4 2 0*3`. Live, each result counts toward the day it was created, updated, or the property `count:` names." + LIVE_WORDS,
    props: [TITLE, yaml("weeks", "int", "how many weeks to draw", { min: 1, max: 53, default: "26" }), yaml("to", "text", "the last day, YYYY-MM-DD (today for a live figure)", { samples: ["2026-03-15"] }), yaml("weekStartsOn", "text", "the weekday a column starts on, 0 (Sunday) to 6, or a day's name", { default: "0", samples: ["0", "mon", "sat"] }),
      yaml("count", "text", "what a live result counts toward", { default: "created", samples: ["created", "updated", "due"] }), ...LIVE],
    rows: "- 2026-03-02: 0 1 4 2 0*3\n- 2026-03-09: 5 3 0 0 1 2 8",
    example: { title: "notes written", to: "2026-03-15" }, sweep: ["weekStartsOn", "weeks"], grids: [["weekStartsOn", "weeks"]],
  },
  {
    kind: "calendar", title: "Calendar", intro: "One month: marked days with their labels. Rows are `- 12: **launch**` (a bold one is the accent). Live, the results are marked on the day of the property `date:` names, within `year:` and `month:`." + LIVE_WORDS,
    props: [TITLE, yaml("year", "int", "the year", { min: 1970, max: 2200, samples: ["2026"] }), yaml("month", "int", "the month", { min: 1, max: 12 }), yaml("weekStartsOn", "text", "the weekday a week starts on, 0 (Sunday) to 6, or a day's name", { default: "mon", samples: ["sun", "mon", "sat"] }),
      yaml("date", "text", "a live figure's property with each result's day", { default: "date", samples: ["date", "due"] }), ...LIVE],
    rows: "- 12: **launch**\n- 20: the plot committee",
    example: { title: "Garden days", year: "2026", month: "3" }, sweep: ["month", "weekStartsOn"], grids: [["month", "weekStartsOn"]],
  },
  {
    kind: "annotate", title: "Annotate", intro: "Code with numbered callouts. A line ending in a `// (1)` or `# (1)` marker (also `-- (1)`, `; (1)`) is bright with `[1]` in its gutter, the rest dim; the ordered list after the fence says what each is. The YAML form is `code:` and `notes:`.",
    props: [TITLE, yaml("code", "text", "the code, with its markers (the YAML form of the fence)", { samples: ["const host = \"float-2\" // (1)"] }), yaml("notes", "list", "what each marker says, in order", { samples: ["[the box it runs on]"] })],
    rows: "```sh\nsqlite3 \"$db\" \".backup '$stage'\"  # (1)\nrestic backup \"$stage\"            # (2)\n```\n1. a consistent copy, never the live file\n2. encrypted, to the storage box",
    example: { title: "the snapshot" }, sweep: [],
  },
  {
    kind: "quadrant", title: "Quadrant", intro: "Blocks placed by two properties, a cell per (x, y): the verdict is the shape, which corner is full and which is empty. Rows are `- label: x, y`, a bold one the accent. `xs:` and `ys:` give the axes' order (the first y is at the top). Narrow, a cell shows a dot per point and the labels move to a legend. Live, a point is a note, placed by the properties `x:` and `y:` name." + LIVE_WORDS,
    props: [TITLE, yaml("xs", "list", "the x axis values, left to right", { samples: ["[cheap, costly]", "[low, medium, high]"] }), yaml("ys", "list", "the y axis values, top to bottom", { samples: ["[prevents, helps, nothing]", "[done, doing, queued]"] }), yaml("quadrants", "list", "a name for each cell group, in reading order", { samples: ["[edges, \"\", \"\", the hard ones]"] }),
      ...LIVE, yaml("x", "text", "a live figure's property for the x axis", { samples: ["priority"] }), yaml("y", "text", "a live figure's property for the y axis", { samples: ["work-stage"] }), yaml("label", "text", "a live figure's property to label a point with (its title when left out)", { samples: ["title"] })],
    rows: "- untyped wire: cheap, prevents\n- **identity by name: costly, nothing**\n- extra tests: cheap, helps",
    example: { title: "bug classes", xs: "[cheap, costly]", ys: "[prevents, helps, nothing]" }, sweep: ["xs", "ys", "quadrants"], grids: [["xs", "ys"]],
  },
  {
    kind: "matrix", title: "Matrix", intro: "Counts over two properties, a heatmap: cells are toned by their share of the largest, an empty cell is a dot. Rows are `- CodeRabbit: edges=80 identity=2`. Live, `down:` makes the rows and `across:` the columns, each cell counting the results with that pair (or summing `value:`)." + LIVE_WORDS,
    props: [TITLE, yaml("order-down", "list", "the row names in this order", { samples: ["[ultrareview, CodeRabbit]"] }), yaml("order-across", "list", "the column names in this order", { samples: ["[edges, identity, parsers]", "[doing, review, queued, done]"] }),
      ...LIVE, yaml("down", "text", "a live figure's property that makes the rows", { samples: ["arc"] }), yaml("across", "text", "a live figure's property that makes the columns", { samples: ["work-stage"] }), yaml("value", "text", "a live figure's numeric property to sum in each cell (a count when left out)", { samples: ["points"] })],
    rows: "- CodeRabbit: edges=80 identity=2\n- ultrareview: identity=4 parsers=1",
    example: { title: "who catches what" }, sweep: ["order-across", "order-down"],
  },
  {
    kind: "compare", title: "Compare", intro: "Two or three columns of rows, aligned by their label, so \"A against B\" reads across instead of as two notes or a wide table. A cell is the text between `|`s, a bold row is the accent, an italic one recedes. Under 60 columns the block stacks: each row is its label, then one line per column.",
    props: [TITLE, yaml("columns", "list", "the column names (two or three)", { samples: ["[Raised beds, Grow bags]", "[A, B, C]"] })],
    rows: "- cost: £60 of boards | £12 a bag\n- drainage: good on clay | fine\n- **lasts: ten years | two seasons**",
    example: { title: "beds", columns: "[Raised beds, Grow bags]" }, sweep: ["columns"],
  },
  {
    kind: "flow", title: "Flow", intro: "Where things came from and where they went, two stages. A row `- a → b: 7`. Each source is a bar sized by its total with its flows under it, the line's weight by the flow's share of the source (═ half or more, ─ a fifth or more, ┄ less); the targets' totals close the figure. Live, `from:` and `to:` name two properties and each pair is counted." + LIVE_WORDS,
    props: [TITLE, yaml("targets", "text", "the words over the targets' totals", { default: "where they went", samples: ["where they went", "what became of them"] }), ...LIVE, yaml("from", "text", "a live figure's property for the source", { samples: ["area"] }), yaml("to", "text", "a live figure's property for the target", { samples: ["stage"] })],
    rows: "- main → recorded: 5\n- main → fixed: 2\n- Effect → fixed: 4",
    example: { title: "the review's findings" }, sweep: ["targets"],
  },
];

/** Every `::graph-*` figure's schema, in the order the library lists them. */
export const FIGURE_COMPONENT_SCHEMAS: readonly ComponentSchema[] = FIGURES.map(figure);

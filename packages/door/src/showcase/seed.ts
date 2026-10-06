// The showcase outline (PIE-439): a fictional household's notes that exercise every shared door part.
// Written through the service API (create, work-ids.configure, roadmap.items.create, properties.patch,
// annotations.*), never into SQLite, so seeding runs the same write paths the door does and keeps
// working across schema migrations. The same seed serves `scripts/try-it.sh --showcase`, the tests
// (`Scratch.seedShowcase`) and `bun scripts/snap.ts showcase`.
//
// Deterministic: the same blocks, text and order every run. Ids and timestamps are the service's, so
// everything that reads the seed finds it by title under the root, never by id.
import { join } from "node:path";
import { titleLine, type Msg } from "../board";
import type { Actor, SocketBoard } from "../socket";
import { installExamples, installTickets, refreshTicket, registerTicket, SHOWCASE_TICKETS, ticketSource } from "./tickets/install";

/** The root's marker: the showcase screen finds its outline by this property, and never seeds itself. */
export const SHOWCASE_MARK = { key: "type", value: "showcase" } as const;
export const SEED_AGENT: Actor = { kind: "agent", id: "showcase-seed" };
export const WORK_PREFIX = "HOME";

/** Every seeded note the screen and the tests look up, by its title (the first line, without properties). */
export const SEED = {
  root: "Kitchen sink",
  queue: "House jobs",
  hub: "House board",
  chores: "Chores",
  gardenView: "Garden chores",
  notebook: "Allotment notebook",
  whiteboard: "Kitchen whiteboard",
  shed: "Bike shed",
  figures: "Allotment figures",
  plotJobs: "Plot jobs by stage",
  recipe: "Lentil soup",
  finding: "Finding things in the house notes",
  errand: "Seed order for the plot",
  tickets: "Depot supplier call about ACME-12",
  omens: "Omens for the allotment week",
  brief: "Daily brief — 2026-03-11",
  briefBefore: "Daily brief — 2026-03-10",
  callouts: "Callouts, as Obsidian writes them",
  calloutType: "Recipe callouts",
  images: "Pictures of the plot",
  markdownFigures: "Figures, written in Markdown",
  keys: "The reader's keys",
  newNotes: "New notes from anywhere",
} as const;
export type SeedName = keyof typeof SEED;

/** The board's lanes, in delivery order: saved views (virtual branches) over the house's roadmap items. */
export const LANES = ["Queued", "Doing", "Review", "Done"] as const;
const laneQuery = (stage: string) => `type=roadmap-item project=house work-stage=${stage}`;

/** The cards: roadmap items through the workboard's allocator, then moved on by a property patch. */
export const CARDS: { title: string; body: string; stage: "queued" | "doing" | "review" | "done"; priority: string; arc: string; tracks: string[] }[] = [
  { title: "Fix the back gate latch", body: "The latch drops when the wind gets up.\n\n- [ ] buy a new spring\n- [ ] oil the hinge", stage: "queued", priority: "medium", arc: "garden", tracks: ["allotment"] },
  { title: "Bleed the radiators", body: "The landing radiator is cold at the top.", stage: "queued", priority: "low", arc: "home", tracks: ["heating"] },
  { title: "True the front wheel", body: "It rubs the brake pad on every turn.\n\n- [x] find the spoke key\n- [ ] true it on the stand", stage: "doing", priority: "high", arc: "bikes", tracks: ["bikes"] },
  { title: "Descale the kettle", body: "Vinegar, then two boils of clean water.", stage: "doing", priority: "medium", arc: "home", tracks: ["kitchen"] },
  { title: "Sharpen the kitchen knives", body: "The whetstone is in the drawer under the kettle.", stage: "review", priority: "low", arc: "home", tracks: ["kitchen"] },
  { title: "Patch the bike shed roof", body: "Felt and tacks from the hardware shop.", stage: "done", priority: "high", arc: "bikes", tracks: ["bikes", "allotment"] },
];

/**
 * Plain blocks with properties, for the live figures and the saved view. `rank` orders the chore queue figure
 * (`sort: rank`): 2 before 10 because ranks compare as numbers; the chore without one comes last.
 */
export const CHORES: { title: string; area: string; stage: "todo" | "done"; due: string; rank?: number }[] = [
  { title: "Water the beans", area: "garden", stage: "done", due: "Mon", rank: 10 },
  { title: "Turn the compost", area: "garden", stage: "todo", due: "Wed", rank: 2 },
  { title: "Net the brassicas", area: "garden", stage: "todo", due: "Thu" },
  { title: "Wipe the hob", area: "kitchen", stage: "done", due: "Tue", rank: 3 },
  { title: "Empty the food caddy", area: "kitchen", stage: "todo", due: "Fri", rank: 1 },
];
/** The chore queue figure's rows, in the order `sort: rank` `direction: asc` gives them. */
export const CHORE_QUEUE = ["Empty the food caddy", "Turn the compost", "Wipe the hob", "Water the beans", "Net the brassicas"] as const;

/**
 * The plot's jobs, plain blocks under the tabs note, grouped by stage in its `::graph-tabs` figure: two titles long
 * enough to wrap (a work id, then words), so cozy and comfortable show a hanging indent. No job is in `validate`:
 * the figure lists it in `order:`, so its tab shows, empty.
 */
export const PLOT_JOBS: { title: string; stage: string; priority: string }[] = [
  { title: "PLOT-1 — Rebuild the leaning raised bed by the water butt before the first frost comes in", stage: "doing", priority: "high" },
  { title: "PLOT-2 — Sow the broad beans", stage: "doing", priority: "low" },
  { title: "PLOT-3 — Mend the netting over the brassica cage where the pigeons got in last week and tore a corner loose from the frame", stage: "review", priority: "medium" },
  { title: "PLOT-4 — Order the seed potatoes", stage: "queued", priority: "medium" },
  { title: "PLOT-5 — Clear the bindweed from the path", stage: "queued", priority: "low" },
  { title: "PLOT-6 — Lift and dry the onions", stage: "done", priority: "high" },
];

/** Every `::graph-*` kind the door draws (src/graphs.ts); the figures note has one of each. */
export const FIGURE_KINDS = ["check", "stat", "kpi", "rank", "table", "tabs", "timeline", "meter", "funnel", "waterfall", "spark", "plot", "gantt", "tree"] as const;
/** The kinds the Markdown figures note shows (src/figures/), each in its Markdown form; the keys note has `keys`. */
export const MARKDOWN_KINDS = ["decision", "chat", "uptime", "activity", "calendar", "annotate"] as const;

const fig = (kind: string, yaml: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", "::", ""];
/** A figure with YAML props and Markdown rows after them. */
const mdFig = (kind: string, yaml: string[], md: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", ...md, "::", ""];

function notebookText(whiteboardId: string, kettleId: string, tapId: string): string {
  return [
    `${SEED.notebook} [page::${SEED.notebook}]`,
    "[season::autumn] [plot::14b] [to::the plot committee]",
    "",
    `Our plot at the Elm Row allotments. Links: [[${SEED.shed}]], ((${kettleId}|the kettle job)), and a soft link: ${WORK_PREFIX}-001 is the gate latch.`,
    "The water butt is half full [level::half] after Sunday's rain.",
    `A label can hold parentheses: ((${kettleId}|the kettle (the dented one))) needs a new lid.`,
    "",
    "> [!note] Gate code",
    "> The gate code changed on Saturday; it is on the shed door.",
    "",
    "> [!warning]- Slugs (a folded callout)",
    "> They are back on bed two. Copper tape before the beer traps.",
    "",
    "## Beds",
    "- Bed one: beans",
    "  - runner beans up the canes",
    "  - dwarf beans along the front",
    "- Bed two: squash",
    "- Bed three: resting under cardboard",
    "",
    "## Harvest log",
    "harvest:: two courgettes and a marrow",
    "- [x] lift the onions",
    "- [ ] pick the last tomatoes",
    "",
    "## Formatting",
    `**Bold**, *italic*, ~~struck out~~ and \`code\`, as Detail draws them. Ask [the allotment society](https://example.org/allotments), or open [the shed page](pi-outliner://page/${encodeURIComponent(SEED.shed)}).`,
    "",
    "## A literal region",
    "<!-- literal -->",
    `Typed as is: [mode::loud] and #loud stay text here; links still work: [[${SEED.shed}]].`,
    "<!-- /literal -->",
    "",
    "## A tilde fence",
    "~~~text",
    "**Not bold**, [mode::quiet] and #quiet are code here: a ~~~ fence is code, as the service reads it.",
    "~~~",
    "",
    "## From the whiteboard",
    `!((${whiteboardId}))`,
    // An anchored embed: just the step (PIE-424), a control like the note's own steps (PIE-472).
    "Just the tap:",
    `!((${tapId}^t-7a9c11))`,
  ].join("\n");
}

const WHITEBOARD = [
  `${SEED.whiteboard} [page::${SEED.whiteboard}]`,
  "[room::kitchen]",
  "",
  "Shopping: oats, lemons, washing-up liquid.",
  "Rota: whoever cooks doesn't wash up.",
  "- Saturday",
  "  - clean the oven, then the fridge shelves nobody has touched since the spring clean",
  "    - [ ] buy the oven cleaner",
  "Press e to edit; type [[ for a page, (( for a block, [file:: for a file; ctrl+t puts in notes or files another program picks (tv ep0ch).",
  "In a list, Enter starts the next item at the same level; Tab and Shift+Tab nest it; Ctrl+P previews.",
].join("\n");

// A labelled block ref inside italics (PIE-541): the link keeps its colour inside the emphasis.
const shedText = (whiteboardId: string) => [
  `${SEED.shed} [page::${SEED.shed}] [room::garden]`,
  "",
  "Three bikes, one pump, and a lock that sticks in the cold.",
  "The spare inner tubes hang on the left hook.",
  `_The pump's spare valves are on ((${whiteboardId}|the kitchen whiteboard))._`,
  "Tyre pressures are on the maker's page: [web::https://example.org/bike-care/tyres] (a Resource: b lists it with the note's links).",
  "",
  "::links",
].join("\n");

/**
 * The callouts section's note (PIE-538): Obsidian's own examples (https://obsidian.md/help/callouts) in every form the
 * reader draws — nested three deep, folded and open with - and +, title-only, custom titles, several paragraphs — and
 * a type this outline declares (`recipe`, from the note after it).
 */
export const CALLOUTS = [
  SEED.callouts,
  "",
  "Obsidian's examples. ( ) then f, or a click on a title, folds one; ⏎ or a click on its icon or type changes its type; z opens them all; e, then > [! offers the types.",
  "",
  "> [!note] note",
  "> body",
  "> > [!warning] warning",
  "> > body body",
  "",
  "> [!note]- collapse",
  "> can you see me",
  "",
  "> [!note]+ expando",
  "> feel the power",
  "",
  "> [!question] Can callouts be nested?",
  "> > [!todo] Yes!, they can.",
  "> > > [!example]  You can even use multiple layers of nesting.",
  "",
  "> [!faq]- Are callouts foldable?",
  "> Yes! In a foldable callout, the contents are hidden when the callout is collapsed.",
  "",
  "> [!tip] Title-only callout",
  "",
  "> [!tip] Callouts can have custom titles",
  "> Like this one.",
  "",
  "> [!info]",
  "> Here's a callout block.",
  "> It supports **Markdown** and [[Bike shed|links]].",
  ">",
  "> - and lists",
  "> - inside it",
  ">",
  "> A second paragraph, after a blank quoted line.",
  "",
  "> [!dish] Soup stock",
  "> Bones, an onion, two bay leaves; `dish` is an alias of this outline's own recipe type.",
].join("\n");

/** The showcase's own pictures (fictional, drawn for it): a JPEG, a WebP and a bright PNG, so decoding and dimming are shown on every platform. */
export const SHOWCASE_ASSETS = join(import.meta.dir, "assets");

/**
 * The images section's note (PIE-532): a header image, and images sized, placed and given alt text by the properties
 * on their lines; the reader's keys, its caption controls and image.* change them.
 */
export const imagesText = (dir = SHOWCASE_ASSETS) => [
  SEED.images,
  `- [img::${dir}/allotment-dusk.jpg] [layout::hero] [alt::the plot at dusk]`,
  "",
  "The picture above the title is this note's header, the hero layout on its line: the reader draws it the full width, at most a third of its height, cropped to fill. [ ] to an image, then + and - size it, ← → move it, H makes it the header, or click the controls at the end of its caption. ctrl+z puts a change back.",
  "",
  `[img::${dir}/seed-packet.webp] [size::25%] [align::center] [alt::a packet of beetroot seed]`,
  "",
  "A quarter of the reader's width, centred. The one below is half, on the right:",
  "",
  `[img::${dir}/allotment-dusk.jpg] [size::50%] [align::right]`,
  "",
  `- [img::${dir}/seed-packet.webp] [height::6]`,
  "  - six rows tall, its width from its shape",
  "",
  "The notice board is paper white: it's dimmed as it's drawn, as every bright image is, so no image is brighter than the door. [dim::0.5] on its line would set how much.",
  "",
  `[img::${dir}/allotment-notice.png] [size::50%] [alt::the notice board, dimmed]`,
].join("\n");

/** A callout type this outline declares (PIE-538): the reader, the completer and the type choice all offer it. */
export const CALLOUT_TYPE = [
  `${SEED.calloutType} [callout-type::recipe] [callout-icon::♨] [callout-tone::green] [callout-aliases::dish]`,
  "",
  "Declares a callout type: `> [!recipe]` (or `> [!dish]`) draws with this icon and tone, and offers it wherever types are offered.",
].join("\n");

/**
 * The new-notes section's note (PIE-544): ctrl+n and + make a note where the placement rule puts it; a page nobody
 * wrote yet is offered, then made; a lone `[page::x]` titles itself. The link is left missing on purpose.
 */
export const NEW_NOTES = [
  SEED.newNotes,
  "",
  "**ctrl+n** on any screen makes a new note and opens it to be written. From a reader, it goes under the note the reader shows (here: under this one, last); anywhere else, and from **+** on the main menu, at the top of the Inbox. Where it goes is the outline's placement rule, which the service keeps: the door only says which note you were in. Esc on it still empty puts it in the trash.",
  "",
  "A page nobody has written yet: [[Seed swap ledger]]. The first ⏎ or click on it offers it; the next makes `Seed swap ledger [page::Seed swap ledger]` in the Inbox and opens it. From then on the link finds it.",
  "",
  "A note whose first line is only `[page::2026-03-12]` names itself: ⏎ on that line in the editor, or the save, makes it `2026-03-12 [page::2026-03-12]`. A title already there is kept.",
].join("\n");

/** The search section's note: what the forgiving search finds, tried on this outline's own titles. */
const FINDING = [
  SEED.finding,
  "",
  "Press / (on the river, g) and type. The outline host ranks what you type, the same way for every client:",
  "",
  "- **Typos:** the search above was opened with a letter missing from each word, and the notebook on the plot is still first; a longer word may be off by a letter or two.",
  "- **Any order:** `whiteboard kitchen` finds the Kitchen whiteboard.",
  "- **Punctuation folds:** `bike-shed` is `bike shed`.",
  "- **All but one word:** a note holding every word but one still shows, below every full match.",
  "- **In a draft:** `[[` and `((` ask the same ranker from the note you're writing, nearer notes first. Press esc, then e here, and type `((` and the notebook's name with a letter missing from each word.",
  "",
  "> [!note] Jev",
  "> Where the outline host has a Jev key, a pause in `/`, `((` or `[[` asks Jev to re-order the same hits, told the note you're in: the footer says `jev…`, then `jev ranked`, and what you picked stays picked. Without a key the order is the text ranker's.",
  "",
  "From a shell, `ep0ch find` with the same words prints the same hits; `ep0ch show <id>` prints a note as a reader draws it.",
  "",
  "## From a shell: queries and files",
  "",
  "- **A query:** `ep0ch find --query \"type=errand tag=spring\" --ids` prints `((id))` a line, as the outline evaluates it (the saved views' grammar, with `updated >= -7d` and the like); `--view <id>` reads a view, `--under <id>` a subtree, `--sort <key>` orders by any property (numbers as numbers, notes without it last), and `--updated-after 2026-03-01` only writes the query.",
  "- **Into show:** `ep0ch show $(ep0ch find --ids --query type=errand)` draws each one.",
  `- **As files:** \`ep0ch export --query type=errand --children --out ./notes\` writes Markdown: the Seed order note's header line becomes front matter (\`ctx\` stays a string, the two \`tag\`s a list), its children nested lists. \`--format json\` writes block records.`,
].join("\n");

/** The search section's errand: a header line with ` - ` between its chips, for `find --query` and `export`. */
const ERRAND = [
  `${SEED.errand} [type::errand] - [area::garden] - [ctx::2026-03-09 @ 09:27:29 AM] [tag::seeds] [tag::spring]`,
  "Broad beans and leeks, two packets each.",
  "when:: before Friday",
  "- [ ] order the beans",
  "- [x] measure the bed",
].join("\n");

const RECIPE = [
  `${SEED.recipe} [serves::4]`,
  "",
  "Soften an onion, two carrots and a stick of celery in oil.",
  "Add 250g red lentils, a tin of tomatoes and a litre of stock.",
  "Simmer for twenty minutes, then blend half of it.",
  "Squeeze in a lemon just before serving.",
  "",
  "Drag across these lines, or press v and move, to select; y copies.",
].join("\n");

/** A tabs figure over the plot's jobs (PLOT_JOBS, its children): a tab per stage, `=` or its ≡ control for density. */
const PLOT_JOBS_NOTE = [
  `${SEED.plotJobs} [page::${SEED.plotJobs}]`,
  "",
  "One live figure, a tab per stage. [ ] to a tab, then ← → or tab and shift+tab switch; = changes the density.",
  "",
  ...fig("tabs", ["title: Plot jobs", 'query: "type=plot-job"', "group: stage", "order: [doing, review, validate]", "columns: [title, priority]", "sort: created", "direction: asc"]),
].join("\n").trimEnd();

function figuresText(gardenViewId: string): string {
  return [
    `${SEED.figures} [page::${SEED.figures}]`,
    "",
    "Live figures ask the outline on every render; the others are drawn from their own values.",
    "",
    ...fig("check", ["title: Garden chores (live query)", 'query: "type=chore area=garden"', 'done: "stage=done"', "note: due"]),
    ...fig("stat", ["title: House jobs now (live)", "items:", '  - { label: queued, query: "type=roadmap-item project=house work-stage=queued" }', '  - { label: doing, query: "type=roadmap-item project=house work-stage=doing" }', '  - { label: done, query: "type=roadmap-item project=house work-stage=done" }']),
    ...fig("kpi", ["title: Plot 14b", "items:", "  - { label: beds, value: 3 }", "  - { label: courgettes, value: 11 }", "  - { label: kg of onions, value: 4 }"]),
    ...fig("rank", ["title: House jobs by arc (live)", 'query: "type=roadmap-item project=house"', "group: arc"]),
    ...fig("table", ["title: House jobs (live)", 'query: "type=roadmap-item project=house"', "columns: [title, work-stage, priority]", "headers: [Job, Stage, Priority]"]),
    ...fig("tabs", ["title: House jobs by stage (live)", 'query: "type=roadmap-item project=house"', "group: work-stage", "order: [doing, review, queued, done]", "columns: [title, priority]"]),
    ...fig("timeline", ["title: Chores (live)", 'query: "type=chore"', "date: due", 'now: "stage=todo"']),
    ...fig("meter", ["title: Chores done (live)", 'query: "type=chore"', 'done: "stage=done"']),
    ...fig("table", ["title: Chore queue by rank (live)", 'query: "type=chore"', "sort: rank", "direction: asc", "columns: [title, rank, area]", "headers: [Chore, Rank, Area]"]),
    ...fig("check", ["title: Garden chores (saved view)", `view: ((${gardenViewId}))`, 'done: "stage=done"']),
    ...fig("funnel", ["title: Seed to plate", "steps:", "  - { label: sown, value: 40 }", "  - { label: sprouted, value: 31 }", "  - { label: planted out, value: 24 }", "  - { label: harvested, value: 18 }"]),
    ...fig("waterfall", ["title: The food budget", "items:", "  - { label: start, value: 120 }", "  - { label: market, value: -45 }", "  - { label: plot saved, value: 20 }", "  - { label: end, value: 95 }"]),
    ...fig("spark", ["title: Rain this week (mm)", "data: [2, 0, 5, 11, 3, 0, 7]", "caption: Mon to Sun"]),
    ...fig("plot", ["title: Courgettes picked", "data: [1, 3, 4, 2, 6, 5]", "labels: [Jul, Aug, Sep, Oct, Nov, Dec]"]),
    ...fig("gantt", ["title: Autumn on the plot", "progress: 0.4", "ticks: [Sep, Oct, Nov]", "items:", "  - { label: dig over, start: 0, end: 0.3, complete: 1 }", "  - { label: plant garlic, start: 0.25, end: 0.6, complete: 0.5 }", "  - { label: mulch, start: 0.55, end: 1, complete: 0 }"]),
    ...fig("tree", ["title: The shed", "nodes:", "  - label: shelves", "    children:", "      - { label: pots }", "      - { label: seed tins, accent: true }", "  - label: hooks", "    children:", "      - { label: inner tubes, meta: left }", "      - { label: pump }"]),
  ].join("\n").trimEnd();
}

/** The plot's decisions: notes the live decision figure and the live calendar read (`decision-state`, `date`). */
export const DECISIONS: { title: string; state: string; reason: string; date: string }[] = [
  { title: "Raised beds for the squash", state: "chosen", reason: "the clay stays wet", date: "2026-03-04" },
  { title: "A second water butt", state: "open", reason: "if the shed gutter holds", date: "2026-03-18" },
  { title: "Netting the whole plot", state: "rejected", reason: "the birds get in anyway", date: "2026-03-09" },
];

/**
 * Backup runs of the household's photo drive, as scripts/backup-runs.ts writes them: what `::graph-uptime` with
 * `source: backups` draws. Twenty-four days, one bad and one shaky.
 */
export const BACKUP_RUNS: { date: string; status: string }[] = Array.from({ length: 24 }, (_, i) => ({
  date: new Date(Date.UTC(2026, 1, 16 + i)).toISOString().slice(0, 10),
  status: i === 9 ? "down" : i === 15 ? "degraded" : "ok",
}));

/**
 * The Markdown figures (ideas from mdxcn.dev): every kind in src/figures/ written as Markdown rows, the first kinds'
 * Markdown (timeline, rank, stat, spark), live ones over the plot's decisions and the backup runs, a quote's byline,
 * and a figure block whose rows are its child bullets, transcluded.
 */
function markdownFiguresText(figureBlockId: string): string {
  return [
    `${SEED.markdownFigures} [page::${SEED.markdownFigures}]`,
    "",
    "A figure's rows can be Markdown after its YAML: **bold** is now or chosen, *italic* next or rejected, `- label: value` a row, `x — note` a side note, `a → b` a path, `ok*40` a run of forty. Where the YAML says the same thing, the YAML wins.",
    "",
    ...mdFig("decision", ["title: Squash beds", "status: decided", "date: 2026-03-04"], [
      "- **Raised beds** — the clay stays wet", "- *Straight into the clay* — they rotted last year", "- Grow bags — if the beds run late", "",
      "Two beds of scaffold boards, filled from the compost bays.",
    ]),
    ...fig("decision", ["title: The plot's decisions (live)", 'query: "type=decision"']),
    ...mdFig("chat", ["title: At the allotment gate"], [
      "- Ada: is the gate code still 1066?", "- Bo: changed on Saturday", "- Bo: it's on the shed door", "- Cy: *goes to look*", "- Ada: found it, thanks",
    ]),
    ...mdFig("uptime", ["title: Photo drive backups"], ["- 2026-02-01: ok*12 degraded ok*8 down ok*6"]),
    ...fig("uptime", ["title: Photo drive backups (live)", "source: backups"]),
    ...mdFig("activity", ["title: Seeds sown", "weekStartsOn: mon"], [
      "- 2026-01-05: 0 1 0 2 0*3", "- 2026-01-19: 3 0 1 4 2 0 6", "- 2026-02-02: 1*5 0 0", "- 2026-02-16: 0 5 8 2 0 3 9",
    ]),
    ...fig("activity", ["title: Chores written (live)", 'query: "type=chore"', "count: created", "weeks: 8"]),
    ...mdFig("calendar", ["title: March on the plot", "today: 2026-03-11", "weekStartsOn: mon"], [
      "- 2026-03-12: **seed potatoes in**", "- 2026-03-20: the plot committee", "- 2026-03-28: *the spring fair, maybe*",
    ]),
    ...fig("calendar", ["title: Decisions this month (live)", 'query: "type=decision"', "year: 2026", "month: 3", "today: 2026-03-11"]),
    ...mdFig("annotate", ["title: The water butt's tap"], [
      "```sh", "close the tap        # (1)", "unscrew the fitting", "wrap the thread      # (2)", "screw it back", "```",
      "1. a quarter turn past snug", "2. three turns of PTFE tape, clockwise",
    ]),
    ...mdFig("timeline", ["title: The plot's year"], ["- Feb: dig over", "- **Mar: seed potatoes** — after the frost", "- *Apr: beans*"]),
    ...mdFig("rank", ["title: Weeds pulled"], ["- bindweed: 40", "- **couch grass: 25**", "- *nettles: 6*"]),
    ...mdFig("stat", ["title: The shed"], ["- forks: 2", "- **trowels: 5**", "- seed tins: 9"]),
    ...mdFig("spark", ["title: Courgettes a day", "caption: two weeks of July"], ["1 0 2 3 3*2 5 4 6 2 0 1*3"]),
    "> [!quote] On sheds",
    "> A shed is a room that admits it is temporary.",
    ">",
    "> — Ada, the allotment newsletter",
    "",
    "A figure block: its own note, its rows its child bullets (each opens its note):",
    `!((${figureBlockId}))`,
  ].join("\n");
}

/**
 * The figure block the Markdown figures note transcludes: a note whose body is a figure (nothing above it but its
 * title), its child bullets its rows.
 */
const FIGURE_BLOCK = ["Bean rows", "::graph-timeline", "---", "title: Bean rows (child bullets)", "---", "::"].join("\n");
const FIGURE_BLOCK_ROWS = ["Apr: sow under glass", "**May: plant out** — when the nights are warm", "*Jun: first picking*"];

/** The keys note: the reader's keys from the action registry, and a sheet written by hand. */
const KEYS_TEXT = [
  `${SEED.keys} [page::${SEED.keys}]`,
  "",
  "Read from the door's own action registry, so it says what the keys do now:",
  "",
  ...fig("keys", ["title: The reader (from the registry)", "actions: note", "learn: [edit, comment, element.open]", "limit: 14"]),
  ...mdFig("keys", ["title: Getting about"], ["- **g then d: the desk**", "- ctrl+k: the command palette", "- ( ) then f: fold a heading", "- esc: close what popped up · q: back"]),
].join("\n");

/**
 * The daily brief (PIE-435): two mornings of a made-up household, as an agent drafts them
 * (skills/daily-brief/SKILL.md). The newer one has every section: a headline, what needs you, yesterday as a
 * story, today, live figures (a stat over the board's lanes by `view: ((…))`, a saved view's checklist),
 * jump points, earlier briefs and a folded Sources callout. Prose never restates a figure's number.
 */
function briefText(o: { lanes: Msg[]; cards: Msg[]; hub: Msg; gardenView: Msg }): string {
  const [queued, doing, review, done] = o.lanes;
  const card = (i: number, label: string) => `((${o.cards[i]!.id}|${label}))`;
  return [
    `${SEED.brief} [type::daily-brief] [brief-date::2026-03-11] [feed-sequence::42]`,
    "",
    "> [!summary] Good morning. Nothing is on fire.",
    "> **First thing:** true the front wheel before Saturday's ride. The kettle can wait until the afternoon.",
    "",
    "## Needs you",
    "",
    `- **Say yes or no to the knives.** ${card(4, "Sharpen the kitchen knives")} is waiting in Review.`,
    `- **Find the spoke key** for ${card(2, "the front wheel")}; it was last seen in the shed.`,
    "",
    "## Yesterday, as a story",
    "",
    `**The shed stopped leaking.** The felt went on in the afternoon, so ${card(5, "the shed roof")} is done and the bikes are dry.`,
    "",
    `**On the plot** the beans were watered before the rain; the notes are in [[${SEED.notebook}]].`,
    "",
    "## Today",
    "",
    "1. **True the wheel** on the stand.",
    `2. **Descale the kettle**: vinegar, then two boils of clean water (${card(3, "the kettle job")}).`,
    "3. **Turn the compost** if it stays dry.",
    "",
    "## The board right now",
    "",
    "07:40, from the board's lanes (live below):",
    "",
    ...fig("stat", ["title: house jobs, live", "items:",
      `  - { label: queued, view: ((${queued!.id})) }`, `  - { label: doing, view: ((${doing!.id})) }`,
      `  - { label: review, view: ((${review!.id})) }`, `  - { label: done, view: ((${done!.id})) }`]),
    ...fig("check", ["title: garden chores (saved view)", `view: ((${o.gardenView.id}))`, 'done: "stage=done"']),
    "## Jump points",
    "",
    `- **Board:** ((${o.hub.id}|${SEED.hub})) · **Plot:** [[${SEED.notebook}]] · **Shed:** [[${SEED.shed}]]`,
    "",
    "## Earlier briefs",
    "",
    ...fig("table", ["title: earlier briefs", 'query: "type=daily-brief"', "sort: created", "limit: 7", "columns: [brief-date, title]", "headers: [Day, Brief]"]),
    "> [!note]- Sources (drafted 07:40 by showcase-seed)",
    "> - Change feed from sequence 17 to 42.",
    "> - `updated >= -1d` over the house's jobs and chores.",
    "> - The allotment notebook and the kitchen whiteboard.",
    "> - Prose is as of 07:40. Figures are live.",
  ].join("\n");
}

const BRIEF_BEFORE = [
  `${SEED.briefBefore} [type::daily-brief] [brief-date::2026-03-10] [feed-sequence::17]`,
  "",
  "> [!summary] A quiet one.",
  "> **First thing:** get felt and tacks for the shed roof before the rain on Wednesday.",
  "",
  "## Needs you",
  "",
  "- nothing",
  "",
  "## Yesterday, as a story",
  "",
  "**The kitchen got a rota.** Whoever cooks doesn't wash up; it is on the whiteboard.",
  "",
  "## Today",
  "",
  "1. **The shed roof**, if the hardware shop has felt.",
  "",
  "> [!note]- Sources (drafted 07:55 by showcase-seed)",
  "> - The first brief: no earlier checkpoint, so `updated >= -1d` only.",
].join("\n");

/**
 * Resource projections (PIE-445): a call that names made-up tickets. Under each `jira::` line a reader
 * shows the ticket the line above names: a fetched one, a registered one not fetched yet (compact), two keys
 * on one line (ambiguous) and one never registered. Its child is a ticket page, shown at its top.
 */
const TICKETS = [
  SEED.tickets,
  "What we agreed about switching the depot's supplier.",
  "jira::",
  "The label printer problem is ACME-14.",
  "jira:: --compact",
  "Either ACME-20 or ACME-21 covers the invoices; check which.",
  "jira::",
  "ACME-30 came up at the end.",
  "jira::",
].join("\n");
const TICKET_PAGE = "Rollout ticket [jira::ACME-12]\nOur own notes under the ticket: book the van for the 14th.\njira:: --comments";

/**
 * The tickets' Source and Resources. With `ticketsConfig` (the service's XDG_CONFIG_HOME) the made-up
 * ticket extension is installed there and ACME-12 is fetched through it; without it both are only
 * registered. Nothing contacts a real provider.
 */
async function seedTickets(board: SocketBoard, ticketsConfig?: string) {
  const sourceId = await ticketSource(board);
  if (!ticketsConfig) {
    for (const [key, t] of Object.entries(SHOWCASE_TICKETS)) await board.request("resources.intern", { input: { sourceId, address: { kind: "jira", entityId: t.id, key } } });
    return;
  }
  installTickets(ticketsConfig, SHOWCASE_TICKETS);
  const ready = await registerTicket(board, "ACME-12");
  await registerTicket(board, "ACME-14");
  await refreshTicket(board, ready);
}

/**
 * The four extension kinds (PIE-507, drawn by the door since PIE-512): a record (`moon::`), an inline output
 * (`horoscope::`), a rich component (`fancy-horror::`, its `w` wards an omen) and an `@tidy` request that
 * tidies the line above it. With the outliner's examples installed they run; without, they are properties.
 */
const OMENS = [
  SEED.omens,
  "moon:: 2026-10-26",
  "horoscope:: virgo",
  "fancy-horror:: virgo",
  "",
  "water   the  leeks  before   noon",
  "@tidy",
].join("\n");

/** What `seedShowcase` wrote: each seeded note by name, the lanes, cards and chores in order. */
export interface Seeded {
  notes: Record<SeedName, Msg>;
  lanes: Msg[];
  cards: Msg[];
  chores: Msg[];
  comments: { open: string; resolved: string };
}

/**
 * Write the showcase outline into an empty workspace. Refuses when one is already there (`findShowcase`),
 * so a half-finished run is never seeded on top of: reset the workspace instead.
 */
export async function seedShowcase(board: SocketBoard, opts: { ticketsConfig?: string; outliner?: string } = {}): Promise<Seeded> {
  if (await findShowcase(board)) throw new Error("this outline already has a showcase; reset it (scripts/try-it.sh --showcase --reset) rather than seeding twice");
  const make = (parentId: string | null, text: string, actor: Actor = { kind: "user" }) => board.createBlock(parentId, text, actor);
  const notes = {} as Record<SeedName, Msg>;

  notes.root = await make(null, [`${SEED.root} [${SHOWCASE_MARK.key}::${SHOWCASE_MARK.value}]`, "",
    "A made-up household's outline for the door's showcase: every shared part, on notes you can edit, move and comment on.",
    "Nothing here is real. `scripts/try-it.sh --showcase --reset` puts it all back."].join("\n"));

  // The workboard's allocator needs a Work-ID prefix and the project's one active work queue.
  await board.request("work-ids.configure", { prefix: WORK_PREFIX });
  notes.queue = await make(notes.root.id, `${SEED.queue} [type::work-queue] [project::house]`);
  notes.hub = await make(notes.root.id, `${SEED.hub}\nThe house's jobs, one lane per work stage.`);
  const lanes: Msg[] = [];
  for (const lane of LANES)
    lanes.push(await make(notes.hub.id, `${lane} [type::virtual-branch] [query::${laneQuery(lane.toLowerCase())}] [summary-properties::work-id,priority,arc]`));

  const cards: Msg[] = [];
  for (const c of CARDS) {
    // The allocator creates in queued, doing or review; a done card is moved there afterwards, as people do.
    const r = await board.createRoadmapItem({ title: c.title, body: c.body, priority: c.priority, workStage: c.stage === "done" ? "review" : c.stage, project: "house", arc: c.arc, tracks: c.tracks }, SEED_AGENT);
    let card = r.block;
    if (c.stage === "done") {
      const { revision, tokens } = await board.propertyTokens(card.id, "work-stage");
      card = await board.patchProperties(card.id, revision, [{ op: "replace", ordinal: tokens[0]!.ordinal, value: "done" }], SEED_AGENT);
    }
    cards.push(card);
  }

  notes.chores = await make(notes.root.id, `${SEED.chores}\nPlain blocks with properties, for the live figures and the saved view.`);
  const chores: Msg[] = [];
  for (const c of CHORES) chores.push(await make(notes.chores.id, `${c.title} [type::chore] [area::${c.area}] [stage::${c.stage}] [due::${c.due}]${c.rank === undefined ? "" : ` [rank::${c.rank}]`}`, c.area === "garden" ? SEED_AGENT : { kind: "user" }));
  notes.gardenView = await make(notes.root.id, `${SEED.gardenView} [type::virtual-branch] [query::type=chore area=garden]`);

  notes.whiteboard = await make(notes.root.id, WHITEBOARD);
  notes.shed = await make(notes.root.id, shedText(notes.whiteboard.id));
  await make(notes.shed.id, "Puncture kit\nPatches, glue, two tyre levers.");
  await make(notes.shed.id, "Chain oil\nThe dry lube, not the wet one.", SEED_AGENT);
  // A small checklist under the whiteboard, for the notebook's anchored embed of one step.
  const tap = await make(notes.whiteboard.id, "Kitchen tap\n- [~] fix the dripping tap ^t-7a9c11\n  - [ ] buy a washer\n- [ ] tighten the hinge");
  notes.notebook = await make(notes.root.id, notebookText(notes.whiteboard.id, cards[3]!.id, tap.id));
  notes.figures = await make(notes.root.id, figuresText(notes.gardenView.id));
  notes.plotJobs = await make(notes.root.id, PLOT_JOBS_NOTE);
  for (const j of PLOT_JOBS) await make(notes.plotJobs.id, `${j.title} [type::plot-job] [stage::${j.stage}] [priority::${j.priority}]`);
  notes.recipe = await make(notes.root.id, RECIPE);
  notes.finding = await make(notes.root.id, FINDING);
  notes.errand = await make(notes.root.id, ERRAND);
  await make(notes.errand.id, "Ask the neighbour about netting\nShe has a spare roll.");
  notes.calloutType = await make(notes.root.id, CALLOUT_TYPE);
  notes.callouts = await make(notes.root.id, CALLOUTS);
  notes.images = await make(notes.root.id, imagesText());
  // The Markdown figures: the note first (its children need it), then its text once the figure block it transcludes is there.
  notes.markdownFigures = await make(notes.root.id, SEED.markdownFigures);
  for (const d of DECISIONS) await make(notes.markdownFigures.id, `${d.title} [type::decision] [decision-state::${d.state}] [reason::${d.reason}] [date::${d.date}]`);
  const runs = await make(notes.markdownFigures.id, "Backup runs [type::backup-log]", SEED_AGENT);
  for (const r of BACKUP_RUNS) await make(runs.id, `photos backup ${r.date} [type::backup-run] - [status::${r.status}] - [date::${r.date}] - [source::photos]`, SEED_AGENT);
  const block = await make(notes.markdownFigures.id, FIGURE_BLOCK);
  for (const row of FIGURE_BLOCK_ROWS) await make(block.id, row);
  notes.markdownFigures = await board.update(notes.markdownFigures.id, markdownFiguresText(block.id), notes.markdownFigures.revision!);
  notes.keys = await make(notes.root.id, KEYS_TEXT);
  notes.newNotes = await make(notes.root.id, NEW_NOTES);
  await seedTickets(board, opts.ticketsConfig);
  notes.tickets = await make(notes.root.id, TICKETS);
  await make(notes.tickets.id, TICKET_PAGE);
  // The outliner's example extensions, in the scratch service's own user folder, read before the note is
  // written so its @tidy line is a new request.
  const examples = !!opts.ticketsConfig && !!opts.outliner && installExamples(opts.ticketsConfig, opts.outliner).length > 0;
  if (examples) await board.listExtensions(true);
  notes.omens = await make(notes.root.id, OMENS);
  // @tidy answers once the note is quiet: wait for it (10 s at most), so the door opens on the tidied note.
  if (examples) {
    const end = Date.now() + 10_000;
    const settled = (s?: string) => !!s && !["queued", "running", "not-asked"].includes(s);
    while (Date.now() < end) {
      const read = await board.readResourceProjections(notes.omens.id).catch(() => null);
      if (settled(read?.projections.find(p => p.kind === "agent")?.agent?.status)) break;
      await Bun.sleep(200);
    }
  }
  notes.briefBefore = await make(notes.root.id, BRIEF_BEFORE, SEED_AGENT);
  notes.brief = await make(notes.root.id, briefText({ lanes, cards, hub: notes.hub, gardenView: notes.gardenView }), SEED_AGENT);

  // Comment threads on the shed: one open, one resolved with a reply.
  const quote = (text: string, q: string) => ({ quote: q, start: text.indexOf(q) });
  const open = await board.comment("showcase-open", notes.shed.id, notes.shed.revision!, "Is the lock still sticking? A drop of graphite might do it.", quote(notes.shed.text, "a lock that sticks in the cold"), SEED_AGENT);
  const resolved = await board.comment("showcase-resolved", notes.shed.id, notes.shed.revision!, "Which hook are the inner tubes on?", quote(notes.shed.text, "The spare inner tubes"));
  await board.reply("showcase-reply", resolved.id, "The left one; I've written it in.", SEED_AGENT);
  await board.setLifecycle(resolved.id, "resolved");

  // Re-read what later writes changed (the shed gained comments and children).
  for (const k of Object.keys(notes) as SeedName[]) notes[k] = (await board.get(notes[k].id)) ?? notes[k];
  return { notes, lanes, cards, chores, comments: { open: open.id, resolved: resolved.id } };
}

/** The showcase's root on this outline, or null when the outline has none. */
export async function findShowcase(board: SocketBoard): Promise<Msg | null> {
  const hits = await board.byProp(SHOWCASE_MARK.key, SHOWCASE_MARK.value, 5);
  return hits.find(m => m.parentId === null) ?? null;
}

/** The first line without its property tokens: how the seed names a note. */
export const titleOf = (m: Msg) => titleLine(m.text).text.replace(/\s{2,}/g, " ").trim();

/** The seeded notes on this outline by name, found by title under the root (null: no showcase here). */
export async function loadShowcase(board: SocketBoard): Promise<{ root: Msg; notes: Partial<Record<SeedName, Msg>> } | null> {
  const root = await findShowcase(board);
  if (!root) return null;
  const kids = await board.children(root.id);
  const notes: Partial<Record<SeedName, Msg>> = { root };
  for (const [name, title] of Object.entries(SEED) as [SeedName, string][]) {
    if (name === "root") continue;
    const hit = kids.find(k => titleOf(k) === title);
    if (hit) notes[name] = (await board.get(hit.id)) ?? hit;
  }
  return { root, notes };
}

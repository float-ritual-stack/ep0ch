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
import { resourceNote } from "../authored";
import { WELCOME_VIEW_TEXT } from "../hub/welcome";
import { installExamples, installTickets, refreshTicket, registerTicket, RULE_EXAMPLES, SHOWCASE_TICKETS, ticketSource } from "./tickets/install";

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
  hero: "An evening on the plot",
  title: "A title you can find",
  markdownFigures: "Figures, written in Markdown",
  keys: "The reader's keys",
  newNotes: "New notes from anywhere",
  recentFiles: "Files a session touched",
  headings: "Headings and dividers",
  spacingLab: "Spacing lab",
  looksLab: "Looks lab",
  rules: "Allotment committee, Saturday",
  remoteWrites: "Remote writes and the netmail queue",
  overscroll: "The long row of runner beans",
  labels: "Jar labels",
  logBeans: "Bean row log",
  logCompost: "Compost bay log",
  logShed: "Shed door log",
  rota: "Greenhouse watering rota",
  hedge: "Hedge trimming plan",
  compost: "Compost bay rules",
  swap: "Seed swap thread",
  dayPlan: "Plan for Saturday",
  outbox: "Letters to send",
  society: "Allotment society",
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
export const FIGURE_KINDS = ["check", "stat", "kpi", "rank", "table", "tabs", "timeline", "meter", "funnel", "waterfall", "spark", "plot", "gantt", "tree", "quadrant", "matrix", "compare", "flow"] as const;
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

/**
 * The title section's note (PIE-657): the reader's header as it is now, with the old one written out to compare. Its
 * properties give the byline's meta line something to hold (the summary values are links).
 */
export const titleText = (whiteboardId = "00000000-0000-4000-8000-000000000000") => [
  `${SEED.title} [type::roadmap-item] [work-stage::doing] [priority::high] [track::allotment]`,
  "",
  "The header leads with the title: the note's breadcrumb is a dim eyebrow above it, the title is the one bright, bold line (twice the height where the terminal has Kitty's text sizing and the title fits that wide), and one dim line under it holds the author, the day, the work id, the property count and the summary values, which are still links. The tile's frame bar says only `detail`: the title is not written twice.",
  "",
  "Before:",
  "",
  "```",
  "3 note detail · A title you can find · …",
  "A title you can find",
  "stage doing · priority high · track allotment",
  "you · 03-11-26 (09:12) · i 5 properties",
  "# Allotment notebook",
  "```",
  "",
  "Now (this reader, the tile with the keys, and the same note in the tile beside it): the focused tile's title is the theme's brightest and bold; the other tile's is a clear step down.",
  "",
  "A tile too short for the header (two rows) keeps the title in its frame bar, as before; so does a narrow terminal without text sizing, where the title is bold on one row.",
  "",
  "A link that wraps keeps its colour and its click on every row (the narrow tile shows it):",
  "",
  `- ((${whiteboardId}|The kitchen whiteboard, with the pump's spare valves · Oct 8 done, Oct 9 plan))`,
  "- [Tyre pressures from the maker, the long page about winter and summer, with the valve notes](https://example.org/bike-care/tyres)",
  "- [status::waiting on the supplier] and [[Allotment notebook and the long page name that runs on]]",
].join("\n");

/**
 * The hero section's note (PIE-598): its first block is a picture, so as it scrolls up under the reader's header the
 * header takes it as a dimmed backdrop, centred on the lit shed (`[hero-focus::…]`). Long enough to scroll.
 */
export const heroText = (dir = SHOWCASE_ASSETS) => [
  `${SEED.hero} [season::autumn]`,
  `[img::${dir}/evening-beds.jpg] [hero-focus::0.85,0.6] [alt::the beds at dusk, the shed lit]`,
  "",
  "Scroll down (j, the wheel, space): as the picture goes up under the header, the title, the byline and the crumbs take it as their background, dimmed and muted so they stay readable. It fades in from the background by steps.",
  "",
  "The crop follows the lit shed: `[hero-focus::0.85,0.6]` on the picture's line moves it (across, then down). An image marked `[layout::hero]` does the same once it scrolls away above the title.",
  "",
  "`reader.hero on=false` (an agent's `act`, or `ep0ch act reader.hero on=false`) turns it off in every reader, kept for the next start; on=true brings it back. `mode=follow` makes the header follow each picture as it scrolls under; `mode=first` keeps it on this one.",
  "",
  "With `reader.hero on=true mode=follow` the header follows the pictures: this one takes over as it scrolls under, fading in over the first.",
  "",
  `[img::${dir}/allotment-dusk.jpg] [size::60%] [alt::the plot at dusk, from the gate]`,
  "",
  "## The beds this week",
  "",
  ...Array.from({ length: 14 }, (_, i) => `- Bed ${i + 1}: ${["garlic, in by the first frost", "broad beans for spring", "leeks, earthed up", "green manure", "kale and chard", "the rhubarb crowns, mulched", "onion sets"][i % 7]}`),
  "",
  "## Jobs before the clocks go back",
  "",
  ...["Lift the last of the potatoes and dry them on the bench", "Clean and oil the hoe, the rake and the shears", "Empty the water butts below the tap line", "Cover the compost bays with the old carpet", "Net the brassicas against the pigeons", "Stack the canes in the shed, tallest at the back", "Sow sweet peas in root trainers on the windowsill", "Mend the gate latch (it drops in the wind)", "Order the seed potatoes before the catalogue runs out", "Leave the seed heads standing for the finches"].map(j => `- ${j}`),
  "",
  "## Notes",
  "",
  "The frost pocket by the lower fence gets it first: nothing tender goes in there before May. The pond needs its leaves skimmed weekly until December.",
  "",
  "The neighbour on plot 14 swaps her leek seedlings for our spare broad beans; we owe her a dozen in March.",
  "",
  "",
  "## The year on the plot",
  "",
  ...["January: plan the beds, order seed", "February: chit the potatoes", "March: broad beans and onions in", "April: first earlies, carrots under fleece", "May: beans up the canes after the last frost", "June: weed, water, net the fruit", "July: pick, pick, pick", "August: sow the winter salads", "September: lift the maincrop", "October: garlic in, green manure down", "November: mulch the rhubarb", "December: mend the tools, read the catalogues"].map(m => `- ${m}`),
  "",
  "The light goes early now. The shed's lamp is on a timer; the watering can by the door is still full from the morning.",
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
  "Each one floats over the screen, a draft of its own, a little lower and to the right of the last: press **ctrl+n** as often as you like, in an edit too (what you typed there is saved first). Drag a float by its title to move it; onto a tile's header it docks as a tab there, onto the screen's edge as a column. Its **×** closes it: written, it's saved; still empty, it goes to the trash. On the board's lanes, ctrl+n is a new card in that lane instead.",
  "",
  "A page nobody has written yet: [[Seed swap ledger]]. The first ⏎ or click on it offers it; the next makes `Seed swap ledger [page::Seed swap ledger]` in the Inbox and opens it. From then on the link finds it.",
  "",
  "A note whose first line is only `[page::2026-03-12]` names itself: ⏎ on that line in the editor, or the save, makes it `2026-03-12 [page::2026-03-12]`. A title already there is kept.",
].join("\n");

/**
 * The overscroll note (PIE-622): long enough to scroll, so End puts its last line on the reader's bottom edge and,
 * pressed again, brings it up to the middle with blank rows under it.
 */
export const OVERSCROLL = [
  SEED.overscroll,
  "",
  "End (or G) goes to the last line: it sits on the bottom edge. Press it again, or keep scrolling with the wheel, j or space, and the last line comes up to the middle of the reader, with nothing under it. Home comes back to the top.",
  "",
  "`ep0ch act reader.overscroll rows=none` stops every reader and draft at its last line as before; `rows=half` is the default, and a number of rows scrolls that far past the end. It's kept for the next start, as the theme is.",
  "",
  "In a draft (e), typing on the last line keeps a few blank rows under the cursor, and the wheel scrolls past the end as the reader does.",
  "",
  ...Array.from({ length: 36 }, (_, i) => `- Cane ${i + 1}: ${["two plants, tied in", "flowers setting", "first pods, thin them", "picked on Saturday"][i % 4]}.`),
  "",
  "The last cane: the compost bin is behind it.",
].join("\n");

/** The remote client the showcase's remote writes come from (PIE-615), and the line its patch proposes to change. */
export const REMOTE_CLIENT = { sub: "user_showcase", clientId: "https://chat.example.test/oauth/client-metadata" } as const;
export const REMOTE_LINE = "Bought two bags of compost for the beds.";

/**
 * The undo section's note (PIE-621): one earlier revision (the first text, kept by the outline when the second replaced
 * it), so the tile menu's "an earlier revision" has something to go back to.
 */
export const LABELS_BEFORE = [`${SEED.labels} [page::${SEED.labels}]`, "[room::pantry]", "", "Write the date on every lid."].join("\n");
export const LABELS = [`${SEED.labels} [page::${SEED.labels}]`, "[room::pantry]", "", "Write the date on every lid.", "Rota: whoever fills a jar labels it.",
  "Drag across text in an edit and it's copied; ctrl+z undoes, ctrl+y redoes; the tile menu's \"an earlier revision\" goes back past a save."].join("\n");

/**
 * The kept-edits section's three notes (PIE-637): each was written, then changed once by someone else (`after`), and the
 * person has an unsent edit from the text it began as (`before`, which the outline's history keeps): `draft`. The rota's
 * edit adds a line the note lacks (still new); the hedge's edit is a line the note has since gained (already in it);
 * the compost's edit rewrites a line the note rewrote differently (a conflict).
 */
const keptNote = (title: string, ...lines: string[]) => [`${title} [page::${title}]`, "", ...lines].join("\n");
export const KEPT = {
  rota: {
    before: keptNote(SEED.rota, "Water the tomatoes at dawn.", "Shut the vents at dusk."),
    after: keptNote(SEED.rota, "Water the tomatoes at dawn.", "Shut the vents at dusk.", "Wipe the shelves on Sundays."),
    draft: keptNote(SEED.rota, "Water the tomatoes at dawn.", "Shut the vents at dusk.", "Check the seed trays on Fridays."),
  },
  hedge: {
    before: keptNote(SEED.hedge, "Trim in late summer.", "Leave the nesting corner alone."),
    after: keptNote(SEED.hedge, "Trim in late summer.", "Leave the nesting corner alone.", "Bag the clippings by the gate."),
    draft: keptNote(SEED.hedge, "Trim in late summer.", "Leave the nesting corner alone.", "Bag the clippings by the gate."),
  },
  compost: {
    before: keptNote(SEED.compost, "Cover the bays with carpet.", "Turn the heap monthly."),
    after: keptNote(SEED.compost, "Cover the bays with carpet.", "Turn the heap every fortnight."),
    draft: keptNote(SEED.compost, "Cover the bays with carpet.", "Turn the heap weekly in summer."),
  },
} as const;

/**
 * The remote writes note (PIE-615): what the gateway's writes become, and where the queue for another machine's outline
 * shows. Under it, at seed time, a remote client's patch at `propose` (a proposal) and its comment, made through the
 * gateway's own write path (src/mcp-writes.ts).
 */
/** The notes the what-changed section's scripted agent edits, with the line it writes (a round number follows). */
export const LOGS = [["logBeans", "Staked and tied, round"], ["logCompost", "Turned the heap, round"], ["logShed", "Oiled the hinges, round"]] as const;

export const REMOTE_WRITES = [
  SEED.remoteWrites,
  "",
  "A conversation on claude.ai, or on the phone, can write here through the remote MCP gateway (`ep0ch mcp serve --http`), as far as this outline's access lets it: `ep0ch mcp access propose` takes proposals, `full` applies writes against the revision they read, and `read` takes none. Each write is an agent's, and says two things: the principal that auth proved (the OAuth client, `claude.ai`; or the client on the machine for stdio and the Claude mod, `claude-code@float-2`) and, on top, the persona it declared (`EP0CH_MCP_PERSONAS`, `OUTLINER_ACTOR`): `loki (claude-code@float-2)`. A persona never crosses principals. The door says it on its status line as it lands.",
  "",
  "An agent can also make a place of its own for the fleeting things (a link spree, the day's discourse) with `outline_new`: it is made on this machine, the agent gets `full` on it and the other principals `read`, its root note carries `[created-by::…] [purpose::…] [kind::scratch]`, and the door's home base and `ep0ch outline list` show who made it and why. `ep0ch outline archive <name>` (or `outline_archive`) puts it away and keeps the database; nothing deletes over MCP.",
  "",
  "At `propose`, the patch below became a proposal under this note (apply it anyway, or dismiss it), and a comment started a thread:",
  "",
  REMOTE_LINE,
  "",
  "An outline whose home is another machine (the laptop's) is read from a mirror here, and its writes never touch the mirror. They wait in the netmail queue on the gateway's machine until that machine dials in: its backup job pulls them every fifteen minutes while it's online (or `ep0ch mcp pull` does it now), applies each one, and a note that changed meanwhile gets a proposal, never an overwrite.",
  "",
  "Where the queue shows:",
  "- `ep0ch mcp queue status` on the gateway's machine: how many writes wait for each machine, the oldest, its last pull, and what the latest ones became",
  "- `list_outlines`, the MCP tool: a mirrored outline's `writes: queued` and its `queue`",
  "- `outline_write_status`, the MCP tool: one queued write by its `queueId` (queued with the machine's last pull, applied with its revision, proposed with the proposal's URI, superseded, or rejected with why); and `outline_read` lays the caller's own still-queued edits over the mirror's text, marked {{pending}}",
  "- `ep0ch doctor` and `ep0ch backup status`: a netmail line for each machine, and on the home machine its last pull",
  "- the door's status bar: an alert once writes have waited a day while their machine was online",
].join("\n");

/**
 * The files a made-up Claude session touched (PIE-602), as the Claude mod files them: under the day, the project and
 * the session, one block per file with its touches and lines; `[file::]` opens the file (the showcase's own assets).
 */
export const recentFilesText = () => [
  SEED.recentFiles,
  "",
  "A Claude session in a door edited two files in the allotment folder. The Claude mod filed each one as it was touched, as it files every Edit and Write in the outline its folder names: under the day, the project and the session, one block per file, its count, last time and lines brought up to date on each touch (the outliner's `agent touch-file`). The real ones live under [[recent-files]]; By project there has one view per project, newest first.",
  "",
  "Open a file from its block's `[file::]` link (the file Resource reader), or from the Edit row in Claude: `ep0ch open file:<path>` puts it where opens land, Markdown drawn as the preview draws it; `diff=true` shows its changes.",
].join("\n");
export const RECENT_FILES = (dir = SHOWCASE_ASSETS) => [
  { file: join(dir, "bed-plan.md"), shown: "bed-plan.md", touches: 3, at: "2026-03-11T09:42:00.000Z", added: 6, removed: 2 },
  { file: join(dir, "seed-list.txt"), shown: "seed-list.txt", touches: 1, at: "2026-03-11T09:31:00.000Z", added: 4, removed: 0 },
];
export const RECENT_SESSION = "7c1e2f30-5a4b-4c3d-9e8f-0a1b2c3d4e5f";

/** The search section's note: what the forgiving search finds, tried on this outline's own titles. */
const FINDING = [
  SEED.finding,
  "",
  "Press / (on the river, g) and type. The outline host ranks what you type, the same way for every client:",
  "",
  "- **Typos:** type the notebook's name with a letter missing from each word, and the notebook on the plot is still first; a longer word may be off by a letter or two.",
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

/**
 * The notes that mention the allotment society (PIE-745): each links to its page, carrying a crop and a season (two
 * properties no code knows); the society page links back to the first `linkedBack`. The page's watched questions list
 * the rest (`links:this NOT linkedfrom:this`) and group them by either property.
 */
export const SOCIETY_NOTES: { title: string; crop: string; season: string }[] = [
  { title: "Committee minutes, January", crop: "none", season: "winter" },
  { title: "Water butt rota agreed", crop: "none", season: "spring" },
  { title: "Rhubarb crowns from the society shop", crop: "rhubarb", season: "winter" },
  { title: "Seed potato order closes Friday", crop: "potatoes", season: "spring" },
  { title: "Blight warning for the potato beds", crop: "potatoes", season: "summer" },
  { title: "Earthing up the second earlies", crop: "potatoes", season: "summer" },
  { title: "Bean poles from the coppice day", crop: "beans", season: "spring" },
  { title: "Runner bean trench, plot 14b", crop: "beans", season: "spring" },
  { title: "Broad bean blackfly tips", crop: "beans", season: "summer" },
  { title: "Leek trench depth from the show judge", crop: "leeks", season: "summer" },
  { title: "Leek rust on plot 9", crop: "leeks", season: "autumn" },
  { title: "Onion sets in the bulk order", crop: "onions", season: "spring" },
  { title: "Onion fly netting share", crop: "onions", season: "summer" },
  { title: "Squash for the harvest show", crop: "squash", season: "autumn" },
  { title: "Squash curing in the shed", crop: "squash", season: "autumn" },
  { title: "Courgette glut swap table", crop: "squash", season: "summer" },
  { title: "Brassica collars from the society", crop: "brassicas", season: "spring" },
  { title: "Pigeon netting over the kale", crop: "brassicas", season: "winter" },
  { title: "Sprouts for the Christmas stall", crop: "brassicas", season: "winter" },
  { title: "Strawberry runners to give away", crop: "fruit", season: "summer" },
  { title: "Fruit cage repair day", crop: "fruit", season: "autumn" },
  { title: "Gooseberry sawfly on the old bushes", crop: "fruit", season: "spring" },
  { title: "Compost bay inspection", crop: "none", season: "autumn" },
  { title: "Manure delivery to the top gate", crop: "none", season: "winter" },
  { title: "Garlic in before the first frost", crop: "garlic", season: "autumn" },
  { title: "Shallots split for the show", crop: "onions", season: "autumn" },
];
/** How many of the society notes its page links back to (the first ones): the rest are what it hasn't. */
export const SOCIETY_LINKED_BACK = 6;

function societyText(linkedBack: readonly Msg[]): string {
  const question = "links:this NOT linkedfrom:this";
  return [
    `${SEED.society} [page::${SEED.society}]`,
    "",
    `Everything that mentions the society links here. Linked back so far: ${linkedBack.map(m => `((${m.id}))`).join(" ")}`,
    "",
    "## Not linked back yet",
    `::links{query="${question}" title="Not linked back"}`,
    "::",
    "",
    "The same question, grouped by the service: by crop in tabs, by season as a rank. Link one back (or write a new note that mentions the society) and every list here changes on its own: the service says the answer changed.",
    "",
    ...fig("tabs", ["title: By crop", `query: "${question}"`, "group: crop", "columns: [title, season]", "sort: title", "direction: asc", "limit: 6"]),
    ...fig("rank", ["title: By season", `query: "${question}"`, "group: season"]),
  ].join("\n").trimEnd();
}

/** A tabs figure over the plot's jobs (PLOT_JOBS, its children): a tab per stage, `=` or its ≡ control for density. */
const PLOT_JOBS_NOTE = [
  `${SEED.plotJobs} [page::${SEED.plotJobs}]`,
  "",
  "One live figure, a tab per stage. [ ] to a tab, then ← → or tab and shift+tab switch; = changes the density.",
  "",
  ...fig("tabs", ["title: Plot jobs", 'query: "type=plot-job"', "group: stage", "order: [doing, review, validate]", "columns: [title, priority]", "sort: created", "direction: asc"]),
].join("\n").trimEnd();

function figuresText(gardenViewId: string, choresId: string): string {
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
    ...fig("check", ["title: Chores still to do, by relation (live)", `query: "under:((${choresId})) type=chore NOT stage=done NOT title~hob"`, "note: due"]),
    ...fig("funnel", ["title: Seed to plate", "steps:", "  - { label: sown, value: 40 }", "  - { label: sprouted, value: 31 }", "  - { label: planted out, value: 24 }", "  - { label: harvested, value: 18 }"]),
    ...fig("waterfall", ["title: The food budget", "items:", "  - { label: start, value: 120 }", "  - { label: market, value: -45 }", "  - { label: plot saved, value: 20 }", "  - { label: end, value: 95 }"]),
    ...fig("spark", ["title: Rain this week (mm)", "data: [2, 0, 5, 11, 3, 0, 7]", "caption: Mon to Sun"]),
    ...fig("plot", ["title: Courgettes picked", "data: [1, 3, 4, 2, 6, 5]", "labels: [Jul, Aug, Sep, Oct, Nov, Dec]"]),
    ...fig("gantt", ["title: Autumn on the plot", "progress: 0.4", "ticks: [Sep, Oct, Nov]", "items:", "  - { label: dig over, start: 0, end: 0.3, complete: 1 }", "  - { label: plant garlic, start: 0.25, end: 0.6, complete: 0.5 }", "  - { label: mulch, start: 0.55, end: 1, complete: 0 }"]),
    ...fig("tree", ["title: The shed", "nodes:", "  - label: shelves", "    children:", "      - { label: pots }", "      - { label: seed tins, accent: true }", "  - label: hooks", "    children:", "      - { label: inner tubes, meta: left }", "      - { label: pump }"]),
    "The comparison kinds (PIE-575 to PIE-579): two properties at once, columns aligned by label, flows, a budget.",
    "",
    ...fig("quadrant", ["title: House jobs by priority and stage (live)", 'query: "type=roadmap-item project=house"', "x: priority", "xs: [low, medium, high]", "y: work-stage", "ys: [done, review, doing, queued]"]),
    ...mdFig("quadrant", ["title: Where to put the beds", "xs: [shade, sun]", "ys: [wet, dry]", "quadrants: [the bog, '', '', the best bed]"], ["- the far corner: shade, wet", "- by the shed: shade, dry", "- **the middle beds: sun, dry**", "- under the apple: sun, wet"]),
    ...fig("matrix", ["title: House jobs by arc and stage (live)", 'query: "type=roadmap-item project=house"', "down: arc", "across: work-stage", "order-across: [doing, review, queued, done]"]),
    ...mdFig("compare", ["title: Raised beds or grow bags", "columns: [Raised beds, Grow bags]"], ["- cost: £60 of scaffold boards | £12 a bag", "- drainage: good on the clay | fine", "- **lasts: ten years | two seasons**", "- moving: never | in an afternoon"]),
    ...fig("flow", ["title: Chores by area and stage (live)", 'query: "type=chore"', "from: area", "to: stage"]),
    ...mdFig("flow", ["title: Seed to plate"], ["- sown → sprouted: 31", "- sown → lost: 9", "- **sprouted → planted out: 24**", "- sprouted → eaten by slugs: 7", "- planted out → harvested: 18"]),
    ...mdFig("meter", ["title: Startup budget", "limit: 150", "unit: ms"], ["- the door alone: 90", "- with Schema: 138", "- **with the barrel: 181**"]).slice(0, -1),
    "^budget",
    "",
    "The anchor alone after the meter's `::` names the figure (PIE-580): `((id^budget))` lands on it.",
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

/**
 * Rules (PIE-600): a meeting the outliner's `meeting-card` rule draws a card over (it matches `[type::meeting]`), its
 * `## ` headings drawn as bands by a rule note under it (no code), and a line `shout` draws as a band in its place.
 * Under it, the rule note and a job `done-stamp` stamps when its status becomes done.
 */
const RULES_NOTE = [
  `${SEED.rules} [type::meeting] [when::Sat 10:00] [where::the shed] [attendees::Ann, Bo, Cy]`,
  "",
  "The committee meets in the shed. The rules in this outline draw on this note, and its text is only what you see with R:",
  "the card above is meeting-card's (it matches the meeting's type), the bands are a rule note's under it (no code), and",
  "the last line is shout's.",
  "",
  "## Agenda",
  "- Water rota for August",
  "- Who keeps the shed key",
  "",
  "## Actions",
  "- [ ] Order the new hose",
  "",
  "Close the cold frame tonight!!!",
].join("\n");

/** What `seedShowcase` wrote: each seeded note by name, the lanes, cards and chores in order. */
export interface Seeded {
  notes: Record<SeedName, Msg>;
  lanes: Msg[];
  cards: Msg[];
  chores: Msg[];
  comments: { open: string; resolved: string; resource: string };
}

/**
 * Write the showcase outline into an empty workspace. Refuses when one is already there (`findShowcase`),
 * so a half-finished run is never seeded on top of: reset the workspace instead.
 */
export async function seedShowcase(board: SocketBoard, opts: { ticketsConfig?: string; outliner?: string; rulesFrom?: string } = {}): Promise<Seeded> {
  if (await findShowcase(board)) throw new Error("this outline already has a showcase; reset it (scripts/try-it.sh --showcase --reset) rather than seeding twice");
  const make = (parentId: string | null, text: string, actor: Actor = { kind: "user" }) => board.createBlock(parentId, text, actor);
  const notes = {} as Record<SeedName, Msg>;
  let resourceThread = "";

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

  // The Welcome screen's notes (C): marked by [welcome::true], in the Welcome view's hand-set order, the first read on opening.
  // Under a note of their own, the view with them: beside the garden view it would make the root a second board hub.
  const landing = await make(notes.root.id, "Landing\nWhat the Welcome screen reads first.");
  const welcomeNotes = [
    await make(landing.id, `Start here [welcome::true]\nThe house's jobs are on [[${SEED.hub}]]; the bikes are in [[${SEED.shed}]].`),
    await make(landing.id, "House rules [welcome::true]\nWipe the counter. The last one up turns the heating down."),
  ];
  const welcomeView = await make(landing.id, WELCOME_VIEW_TEXT);
  await board.moveInView({ view: welcomeView.id, blocks: welcomeNotes.map(m => m.id) }, { kind: "user" });

  notes.whiteboard = await make(notes.root.id, WHITEBOARD);
  notes.shed = await make(notes.root.id, shedText(notes.whiteboard.id));
  await make(notes.shed.id, "Puncture kit\nPatches, glue, two tyre levers.");
  await make(notes.shed.id, "Chain oil\nThe dry lube, not the wet one.", SEED_AGENT);
  // A day's plan with its outbox in it (PIE-693): a ::links block over a query, the waiting letters listed beside a
  // preview of the one selected; the letters themselves live under a note of their own.
  notes.outbox = await make(notes.root.id, `${SEED.outbox}\nWhat's written and waiting to go, one note a letter.`);
  await make(notes.outbox.id, "Ask Ana about the bean seed [type::letter] [mail::waiting]\nTwo jars of runner beans for the swap. She said Thursday, so ask by Wednesday night.");
  await make(notes.outbox.id, "Write to the allotment society about the gate [type::letter] [mail::waiting]\nThe latch drops when the wind gets up. Ask whether they'll pay for a new spring, or if we buy it.");
  await make(notes.outbox.id, "Order the fruit-cage netting [type::letter] [mail::waiting]\n- [ ] measure the cage\n- [ ] 2 cm mesh, not 4");
  await make(notes.outbox.id, "Thank the swap hosts [type::letter] [mail::done]\nSent on Monday.", SEED_AGENT);
  notes.dayPlan = await make(notes.root.id, [
    `${SEED.dayPlan} [type::daily-plan]`,
    "Morning on the plot, then the letters that are waiting.",
    "",
    "## Outbox",
    '::links{query="type=letter mail=waiting" preview=right title="Outbox"}',
    "::",
    "",
    "[ ] steps onto a letter and the preview beside the list shows it; ⏎ on a letter opens it, ⏎ on the frame's ⏎ in goes into the list (j k, / to filter, esc out).",
    "",
    "## On the plot",
    "- Water the beans before ten.",
    "- Lift the last of the onions.",
  ].join("\n"));
  // A thread whose replies carry stages (PIE-693): the links tile's Children group, narrowed by Stage like any other group.
  notes.swap = await make(notes.root.id, `${SEED.swap} [type::thread]\nWho brings what to the seed swap on Saturday. The table goes by [[${SEED.shed}]].`);
  await make(notes.swap.id, "Ana: runner beans to swap [type::offer] [status::waiting]\nTwo jars, saved from last year's best row.");
  await make(notes.swap.id, "Ben: took the leek seedlings [type::offer] [status::done]\nThank you, they're in.", SEED_AGENT);
  await make(notes.swap.id, "Cal: labels and a pencil [type::offer] [status::active]\nI'll write the labels on the day.");
  await make(notes.swap.id, "Dee: a question about the time\nIs it ten or eleven?");
  // A small checklist under the whiteboard, for the notebook's anchored embed of one step.
  const tap = await make(notes.whiteboard.id, "Kitchen tap\n- [~] fix the dripping tap ^t-7a9c11\n  - [ ] buy a washer\n- [ ] tighten the hinge");
  notes.notebook = await make(notes.root.id, notebookText(notes.whiteboard.id, cards[3]!.id, tap.id));
  notes.figures = await make(notes.root.id, figuresText(notes.gardenView.id, notes.chores.id));
  notes.plotJobs = await make(notes.root.id, PLOT_JOBS_NOTE);
  for (const j of PLOT_JOBS) await make(notes.plotJobs.id, `${j.title} [type::plot-job] [stage::${j.stage}] [priority::${j.priority}]`);
  // The society page and the notes that mention it (PIE-745): its page first, so their [[links]] resolve; then its text
  // once they're there, linking back to the first few.
  notes.society = await make(notes.root.id, `${SEED.society} [page::${SEED.society}]`);
  const mentions = await make(notes.root.id, "Society mentions\nNotes that mention the allotment society, one a note.");
  const society: Msg[] = [];
  for (const m of SOCIETY_NOTES) society.push(await make(mentions.id, `${m.title} [type::society-note] [crop::${m.crop}] [season::${m.season}]\nFrom the [[${SEED.society}]].`));
  notes.society = await board.update(notes.society.id, societyText(society.slice(0, SOCIETY_LINKED_BACK)), notes.society.revision!);
  notes.recipe = await make(notes.root.id, RECIPE);
  notes.finding = await make(notes.root.id, FINDING);
  notes.errand = await make(notes.root.id, ERRAND);
  await make(notes.errand.id, "Ask the neighbour about netting\nShe has a spare roll.");
  notes.calloutType = await make(notes.root.id, CALLOUT_TYPE);
  notes.callouts = await make(notes.root.id, CALLOUTS);
  notes.images = await make(notes.root.id, imagesText());
  notes.hero = await make(notes.root.id, heroText());
  notes.title = await make(notes.root.id, titleText(notes.whiteboard.id));
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
  notes.recentFiles = await make(notes.root.id, recentFilesText());
  {
    const day = await make(notes.recentFiles.id, "2026-03-11 [file-day::2026-03-11]", SEED_AGENT);
    const project = await make(day.id, "allotment [file-project::allotment]", SEED_AGENT);
    const session = await make(project.id, `session ${RECENT_SESSION.slice(0, 8)} [file-session::${RECENT_SESSION}]`, SEED_AGENT);
    const touches: Msg[] = [];
    for (const f of RECENT_FILES()) touches.push(await make(session.id, `${f.shown} [file::${f.file}] [type::file-touch] [day::2026-03-11] [project::allotment] [session::${RECENT_SESSION}] [touches::${f.touches}] [last-touch::${f.at}] [added::${f.added}] [removed::${f.removed}]`, SEED_AGENT));
    // A comment on the bed plan, a Resource (PIE-650): quoted from the file's own Markdown, opened from the block whose link
    // names it, so the thread shows as a backlink there. The file is never written.
    const plan = RECENT_FILES()[0]!, followed = await board.followAuthored({ kind: "filesystem", path: plan.file }, SEED_AGENT);
    const note = resourceNote(await board.describeResource(followed.id), touches[0]!.id);
    const quoted = "Net the brassicas before the pigeons find them.";
    resourceThread = (await board.commentOnResource("showcase-resource", note.resource!, note.revision!, "Netting goes on before the first leaves show, or the pigeons get there first.", { quote: quoted, start: note.text.indexOf(quoted) }, SEED_AGENT)).id;
  }
  notes.remoteWrites = await make(notes.root.id, REMOTE_WRITES);
  // What changed (PIE-647): three notes a scripted agent edits when the section opens.
  for (const [key, line] of LOGS) notes[key] = await make(notes.root.id, `${SEED[key]}\n${line} 0`);
  const labels = await make(notes.root.id, LABELS_BEFORE);
  notes.labels = await board.update(labels.id, LABELS, labels.revision!);
  {
    // Through the gateway's own write path, at propose: a patch that becomes a proposal, and a comment.
    const { actorOf, applyWrite } = await import("../mcp-writes");
    const o = { level: "propose" as const, actor: actorOf(REMOTE_CLIENT), uri: (id: string) => id };
    const at = notes.remoteWrites.text.indexOf(REMOTE_LINE);
    await applyWrite(board, { tool: "outline_patch", blockId: notes.remoteWrites.id, revision: notes.remoteWrites.revision!, input: { policy: "edit", patches: [{ observed: "two bags", replacement: "three bags", range: { start: at + 7, end: at + 15 } }] } }, o);
    await applyWrite(board, { tool: "outline_comment", blockId: notes.remoteWrites.id, input: { quote: "two bags of compost", body: "Was that the peat-free kind?", requestId: "showcase-remote-comment" } }, o);
  }
  for (const [name, k] of [["rota", KEPT.rota], ["hedge", KEPT.hedge], ["compost", KEPT.compost]] as const) {
    const first = await make(notes.root.id, k.before);
    notes[name] = await board.update(first.id, k.after, first.revision!);
  }
  notes.headings = await make(notes.root.id, HEADINGS);
  notes.looksLab = await make(notes.root.id, LOOKS_LAB);
  notes.spacingLab = await make(notes.root.id, SPACING_LAB);
  notes.overscroll = await make(notes.root.id, OVERSCROLL);
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
  // The example rules, last: a trigger starts from what matches when it's installed, so nothing seeded before is stamped.
  const rulesFrom = opts.outliner ?? opts.rulesFrom;
  if (opts.ticketsConfig && rulesFrom && installExamples(opts.ticketsConfig, rulesFrom, RULE_EXAMPLES).length) {
    const end = Date.now() + 10_000;
    while (Date.now() < end && !(await board.listExtensions(true).catch(() => null))?.rules?.some(r => r.key === "ext:done-stamp/stamp")) await Bun.sleep(100);
  }
  notes.rules = await make(notes.root.id, RULES_NOTE);
  await make(notes.rules.id, `Headings in the committee's notes are bands [rule-name::committee-bands] [rule-under::((${notes.rules.id}))] [rule-kind::heading:2] [rule-decorate::band] [rule-pattern::stack] [rule-align::center]`);
  await make(notes.rules.id, "Mend the water butt [status::todo]\nSetting its status to done stamps the day it was done (done-stamp); setting it back takes the stamp off.");

  // Comment threads on the shed: one open, one resolved with a reply.
  const quote = (text: string, q: string) => ({ quote: q, start: text.indexOf(q) });
  const open = await board.comment("showcase-open", notes.shed.id, notes.shed.revision!, "Is the lock still sticking? A drop of graphite might do it.", quote(notes.shed.text, "a lock that sticks in the cold"), SEED_AGENT);
  const resolved = await board.comment("showcase-resolved", notes.shed.id, notes.shed.revision!, "Which hook are the inner tubes on?", quote(notes.shed.text, "The spare inner tubes"));
  await board.reply("showcase-reply", resolved.id, "The left one; I've written it in.", SEED_AGENT);
  await board.setLifecycle(resolved.id, "resolved");

  // Re-read what later writes changed (the shed gained comments and children).
  for (const k of Object.keys(notes) as SeedName[]) notes[k] = (await board.get(notes[k].id)) ?? notes[k];
  return { notes, lanes, cards, chores, comments: { open: open.id, resolved: resolved.id, resource: resourceThread } };
}

/** The showcase's root on this outline, or null when the outline has none. */
export async function findShowcase(board: SocketBoard): Promise<Msg | null> {
  const hits = await board.byProp(SHOWCASE_MARK.key, SHOWCASE_MARK.value, 5);
  return hits.find(m => m.parentId === null) ?? null;
}

/** The outline's own style, the seed order's, declared on a line of the note as a person writes one: dots, two rows, left, on the top row, green. */
export const HEADING_STYLE_LINE = "# Plot style [heading-style::plot] [heading-pattern::dots] [heading-rows::2] [heading-align::left] [heading-row::top] [heading-tone::green]";

/**
 * Heading styles (PIE-599): the three ways to write one, each working. A style named on a heading (every built-in
 * pattern, alignment and row), one heading's own fields (`[heading-tone::amber]` over its style, and fields alone over
 * the base style), and a style the outline declares on a line of this note (the seed order's), so the look changes
 * with no door change; a styled rule, a plain one and a plain heading; each with a body to fold.
 */
/**
 * The style section's page (PIE-673): drawn by the named style the Looks lab note declares ([style::lab]): a paragraph
 * long enough to wrap at any width, a list for the gap and dividers, and a box with a look of its own.
 */
export const SPACING_LAB = [
  `${SEED.spacingLab} [page::${SEED.spacingLab}] [style::lab]`,
  "This page is drawn by the lab style, which the Looks lab note declares: its measure holds the text to 64 columns, centred in a wide tile, its padding keeps it off the frame, and its list has a blank row and a dotted line between items. Nudge any value in the tune inspector beside it and the page moves in the next frame; s writes it to the level you pick, and every door on the outline draws it.",
  "",
  "## Seed trays",
  "- Tomatoes on the warm shelf, the ones from [[Headings and dividers]]",
  "- Chillies in the propagator",
  "- Basil by the kitchen window",
  "- Peppers, pricked out in May",
  "",
  "## Hardy ones [style.list.gap::0] [style.list.divider::none]",
  "This list is tight: its own heading says so (this list), whatever the lab style gives the page's other lists.",
  "- Kale",
  "- Leeks",
  "",
  "::box{list.gap=0 list.zebra list.zebra.bg=green list.zebra.strength=4 margin.x=4 edge=bar tone=green}",
  "A box sets its own look: no gap, every other row on a green stripe, a green bar down its side, four columns in.",
  "- Leeks",
  "- Onion sets",
  "- Garlic",
  "::",
  "",
  "::box{bg=sunken border=round tone=amber pad=1 list.gap=2 list.divider=glyph list.divider.glyph=✦}",
  "A sunken box in an amber frame. Its list's divider is a glyph of its own, centred in the gap.",
  "- Broad beans",
  "- Runner beans",
  "::",
  "",
  "## The header's picture",
  "Scroll this picture up under the title: the header takes it as its backdrop, cropped a little higher than its middle by the lab style's header.image.y, its own violet surface yielding to it.",
  `[img::${SHOWCASE_ASSETS}/evening-beds.jpg] [alt::the beds at dusk, the shed lit]`,
  "",
  "The end of the lab.",
].join("\n");

/** The style section's declaration: the named style the Spacing lab page uses, edited in place to restyle it live. */
export const LOOKS_LAB = [
  `${SEED.looksLab} [style-for::lab] [style.measure::64] [style.pad::1] [style.list.gap::1] [style.list.divider::dots] [style.narrow.list.gap::0] [style.bg::raised] [style.edge::bar] [style.tone::violet] [style.header.bg::violet] [style.header.bg.opacity::40] [style.header.image::evening-beds.jpg] [style.header.image.y::-15]`,
  "This note declares the lab style, which [[Spacing lab]] uses. Its fields are the look: e here, change a value, ctrl+s, and every reader of that page restyles at once, in every door on the outline. Under 60 columns (narrow) the lab drops its list gap.",
  "",
  "Surfaces are theme roles, never colours: raised, sunken or a tone (blue, green, violet, amber, coral, neutral), each drawn dark in every theme. The lab tile sits on a raised surface with a violet bar down its side; its header on violet at 40%, taking the beds picture once it scrolls under, the crop moved up 15%.",
  "",
  "A tile kind has its own: `[style-for::tile:backlinks] [style.list.zebra::on]` on any line would stripe every links tile.",
].join("\n");

const HEADINGS = [
  `${SEED.headings} [page::${SEED.headings}]`,
  "A heading keeps its Markdown; a style draws it inside a band. Name a style, give one heading its own fields, or declare a style on any line. Narrow, it is the heading as written.",
  "",
  HEADING_STYLE_LINE,
  "",
  "# Your calls [heading::band]",
  "The ones only you can make this week.",
  "",
  "## The plot [heading::tab]",
  "Four raised beds, one left fallow.",
  "",
  "## Beds [heading::waffle]",
  "Leeks, then the brassicas under netting.",
  "",
  "### Water butts [heading::uptime]",
  "Two full, one leaking at the tap.",
  "",
  "--- [rule::fade]",
  "",
  "## Seed order [heading::plot]",
  "Peas, broad beans and the climbing French beans.",
  "",
  "## Compost [heading::rule]",
  "Turn the left bay in April.",
  "",
  "## Odd jobs [heading::dots] [heading-tone::amber]",
  "Oil the shed hinge.",
  "",
  "## Greenhouse [heading::waffle] [heading-margin::2 0 1]",
  "Its heading-margin is 2 0 1: two blank rows above the band, no columns, one below.",
  "",
  "## Tool shed [heading-pattern::uptime] [heading-rows::1] [heading-align::right]",
  "The spade, the fork, the good trowel.",
  "",
  "---",
  "",
  "A plain rule above, and a plain heading below.",
  "",
  "## Plain",
  "As Markdown writes it.",
].join("\n");
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

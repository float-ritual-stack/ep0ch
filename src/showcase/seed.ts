// The showcase outline (PIE-439): a fictional household's notes that exercise every shared door part.
// Written through the service API (create, work-ids.configure, roadmap.items.create, properties.patch,
// annotations.*), never into SQLite, so seeding runs the same write paths the door does and keeps
// working across schema migrations. The same seed serves `scripts/try-it.sh --showcase`, the tests
// (`Scratch.seedShowcase`) and `bun scripts/snap.ts showcase`.
//
// Deterministic: the same blocks, text and order every run. Ids and timestamps are the service's, so
// everything that reads the seed finds it by title under the root, never by id.
import type { Msg } from "../board";
import type { Actor, SocketBoard } from "../socket";
import { installExamples, installTickets, refreshTicket, registerTicket, SHOWCASE_TICKETS, ticketSource } from "./tickets/install";
import { withoutPropertyTokens } from "../vendor/property-grammar";

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
  recipe: "Lentil soup",
  tickets: "Depot supplier call about ACME-12",
  omens: "Omens for the allotment week",
  brief: "Daily brief — 2026-03-11",
  briefBefore: "Daily brief — 2026-03-10",
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

/** Plain blocks with properties, for the live figures and the saved view. */
export const CHORES: { title: string; area: string; stage: "todo" | "done"; due: string }[] = [
  { title: "Water the beans", area: "garden", stage: "done", due: "Mon" },
  { title: "Turn the compost", area: "garden", stage: "todo", due: "Wed" },
  { title: "Net the brassicas", area: "garden", stage: "todo", due: "Thu" },
  { title: "Wipe the hob", area: "kitchen", stage: "done", due: "Tue" },
  { title: "Empty the food caddy", area: "kitchen", stage: "todo", due: "Fri" },
];

/** Every `::graph-*` kind the door draws (src/graphs.ts); the figures note has one of each. */
export const FIGURE_KINDS = ["check", "stat", "kpi", "rank", "table", "timeline", "meter", "funnel", "waterfall", "spark", "plot", "gantt", "tree"] as const;

const fig = (kind: string, yaml: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", "::", ""];

function notebookText(whiteboardId: string, kettleId: string, tapId: string): string {
  return [
    `${SEED.notebook} [page::${SEED.notebook}]`,
    "[season::autumn] [plot::14b] [to::the plot committee]",
    "",
    `Our plot at the Elm Row allotments. Links: [[${SEED.shed}]], ((${kettleId}|the kettle job)), and a soft link: ${WORK_PREFIX}-001 is the gate latch.`,
    "The water butt is half full [level::half] after Sunday's rain.",
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
    "```component:status",
    "Beds dug :: 2 of 3",
    "[Waiting on seeds](https://example.org/seeds) :: **4**",
    "Harvested :: 5",
    "```",
    "",
    "## A literal region",
    "<!-- literal -->",
    `Typed as is: [mode::loud] and #loud stay text here; links still work: [[${SEED.shed}]].`,
    "<!-- /literal -->",
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
  "Press e to edit; type [[ for a page, (( for a block, [file:: for a file.",
  "In a list, Enter starts the next item at the same level; Tab and Shift+Tab nest it; Ctrl+P previews.",
].join("\n");

const SHED = [
  `${SEED.shed} [page::${SEED.shed}] [room::garden]`,
  "",
  "Three bikes, one pump, and a lock that sticks in the cold.",
  "The spare inner tubes hang on the left hook.",
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
    ...fig("timeline", ["title: Chores (live)", 'query: "type=chore"', "date: due", 'now: "stage=todo"']),
    ...fig("meter", ["title: Chores done (live)", 'query: "type=chore"', 'done: "stage=done"']),
    ...fig("check", ["title: Garden chores (saved view)", `view: ((${gardenViewId}))`, 'done: "stage=done"']),
    ...fig("funnel", ["title: Seed to plate", "steps:", "  - { label: sown, value: 40 }", "  - { label: sprouted, value: 31 }", "  - { label: planted out, value: 24 }", "  - { label: harvested, value: 18 }"]),
    ...fig("waterfall", ["title: The food budget", "items:", "  - { label: start, value: 120 }", "  - { label: market, value: -45 }", "  - { label: plot saved, value: 20 }", "  - { label: end, value: 95 }"]),
    ...fig("spark", ["title: Rain this week (mm)", "data: [2, 0, 5, 11, 3, 0, 7]", "caption: Mon to Sun"]),
    ...fig("plot", ["title: Courgettes picked", "data: [1, 3, 4, 2, 6, 5]", "labels: [Jul, Aug, Sep, Oct, Nov, Dec]"]),
    ...fig("gantt", ["title: Autumn on the plot", "progress: 0.4", "ticks: [Sep, Oct, Nov]", "items:", "  - { label: dig over, start: 0, end: 0.3, complete: 1 }", "  - { label: plant garlic, start: 0.25, end: 0.6, complete: 0.5 }", "  - { label: mulch, start: 0.55, end: 1, complete: 0 }"]),
    ...fig("tree", ["title: The shed", "nodes:", "  - label: shelves", "    children:", "      - { label: pots }", "      - { label: seed tins, accent: true }", "  - label: hooks", "    children:", "      - { label: inner tubes, meta: left }", "      - { label: pump }"]),
  ].join("\n").trimEnd();
}

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
    if (!r) throw new Error("this service has no roadmap allocator (roadmap.items.create); the showcase needs protocol 82 or later");
    let card = r.block;
    if (c.stage === "done") {
      const { revision, tokens } = await board.propertyTokens(card.id, "work-stage");
      card = await board.patchProperties(card.id, revision, [{ op: "replace", ordinal: tokens[0]!.ordinal, value: "done" }], SEED_AGENT);
    }
    cards.push(card);
  }

  notes.chores = await make(notes.root.id, `${SEED.chores}\nPlain blocks with properties, for the live figures and the saved view.`);
  const chores: Msg[] = [];
  for (const c of CHORES) chores.push(await make(notes.chores.id, `${c.title} [type::chore] [area::${c.area}] [stage::${c.stage}] [due::${c.due}]`, c.area === "garden" ? SEED_AGENT : { kind: "user" }));
  notes.gardenView = await make(notes.root.id, `${SEED.gardenView} [type::virtual-branch] [query::type=chore area=garden]`);

  notes.whiteboard = await make(notes.root.id, WHITEBOARD);
  notes.shed = await make(notes.root.id, SHED);
  await make(notes.shed.id, "Puncture kit\nPatches, glue, two tyre levers.");
  await make(notes.shed.id, "Chain oil\nThe dry lube, not the wet one.", SEED_AGENT);
  // A small checklist under the whiteboard, for the notebook's anchored embed of one step.
  const tap = await make(notes.whiteboard.id, "Kitchen tap\n- [~] fix the dripping tap ^t-7a9c11\n  - [ ] buy a washer\n- [ ] tighten the hinge");
  notes.notebook = await make(notes.root.id, notebookText(notes.whiteboard.id, cards[3]!.id, tap.id));
  notes.figures = await make(notes.root.id, figuresText(notes.gardenView.id));
  notes.recipe = await make(notes.root.id, RECIPE);
  await seedTickets(board, opts.ticketsConfig);
  notes.tickets = await make(notes.root.id, TICKETS);
  await make(notes.tickets.id, TICKET_PAGE);
  // The outliner's example extensions, in the scratch service's own user folder, read before the note is
  // written so its @tidy line is a new request.
  if (opts.ticketsConfig && opts.outliner && installExamples(opts.ticketsConfig, opts.outliner).length) await board.listExtensions(true);
  notes.omens = await make(notes.root.id, OMENS);
  notes.briefBefore = await make(notes.root.id, BRIEF_BEFORE, SEED_AGENT);
  notes.brief = await make(notes.root.id, briefText({ lanes, cards, hub: notes.hub, gardenView: notes.gardenView }), SEED_AGENT);

  // Comment threads on the shed: one open, one resolved with a reply.
  const quote = (text: string, q: string) => ({ quote: q, start: text.indexOf(q) });
  const open = await board.comment("showcase-open", notes.shed.id, notes.shed.revision!, "Is the lock still sticking? A drop of graphite might do it.", quote(SHED, "a lock that sticks in the cold"), SEED_AGENT);
  const resolved = await board.comment("showcase-resolved", notes.shed.id, notes.shed.revision!, "Which hook are the inner tubes on?", quote(SHED, "The spare inner tubes"));
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
export const titleOf = (m: Msg) => withoutPropertyTokens(m.text.split("\n")[0]!).replace(/\s{2,}/g, " ").trim();

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

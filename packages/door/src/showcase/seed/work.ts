// The showcase seed's work (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { type Msg } from "../../board";
import { SEED } from "./names";
import { fig, mdFig } from "./figures";

/** The board's lanes, in delivery order: saved views (virtual branches) over the house's roadmap items. */
export const LANES = ["Queued", "Doing", "Review", "Done"] as const;

export const laneQuery = (stage: string) => `type=roadmap-item project=house work-stage=${stage}`;

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

export function societyText(linkedBack: readonly Msg[]): string {
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

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** The day `n` days from the seeding day on the machine's clock, written the ways people write one (PIE-769). */
export function seedDay(n: number, now = new Date()): { iso: string; short: string; slashed: string; dayFirst: string } {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + n);
  const [y, m, dd] = [d.getFullYear(), d.getMonth() + 1, d.getDate()];
  return { iso: `${y}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`, short: `${MONTH_NAMES[m - 1]} ${dd}`, slashed: `${m}/${dd}`, dayFirst: `${dd} ${MONTH_NAMES[m - 1]}` };
}

/**
 * The plot's dates (PIE-769), children of the calendar note: due days written four ways and one that isn't a date,
 * days to wait until, and windows (spans). Relative to the day the showcase is seeded, so the answers are live.
 */
export const PLOT_DATES = (now = new Date()): { title: string; props: string }[] => [
  { title: "Order the seed potatoes", props: `[due::${seedDay(-1, now).iso}]` },
  { title: "Collect the manure delivery", props: `[due::${seedDay(1, now).short}]` },
  { title: "Pay the plot rent", props: `[due::${seedDay(3, now).slashed}]` },
  { title: "Prune the gooseberries", props: `[due::${seedDay(10, now).dayFirst}]` },
  { title: "Lift the dahlias", props: "[due::after the frost]" },
  { title: "Ask the committee about the shed again", props: `[wait-until::${seedDay(0, now).iso}]` },
  { title: "Chase the water board", props: `[wait-until::${seedDay(4, now).iso}]` },
  { title: "Seed swap", props: `[window::${seedDay(-1, now).iso}..${seedDay(2, now).iso}]` },
  { title: "Bulb sale", props: `[window::${seedDay(6, now).iso}..${seedDay(9, now).iso}]` },
];

/** The calendar note: live figures asking dates of any property, as the views ask them. */
export const PLOT_DATES_NOTE = [
  `${SEED.dates} [page::${SEED.dates}]`,
  "",
  "Dates on any property, written however people write them: 2026-10-20, Oct 20, 10/20, 20 Oct, or a span 2026-10-20..2026-10-24. Asked the way the views ask: `due <= +3d`, `wait-until <= today`, `window = today`. Nothing here knows these keys; tomorrow the answers move on their own.",
  "",
  ...fig("table", ["title: Due in three days, overdue too", 'query: "type=plot-date due <= +3d"', "sort: due", "direction: asc", "columns: [title, due]"]),
  ...fig("table", ["title: Done waiting", 'query: "type=plot-date wait-until <= today"', "columns: [title, wait-until]"]),
  ...fig("table", ["title: In its window today", 'query: "type=plot-date window = today"', "columns: [title, window]"]),
  ...fig("tabs", ["title: By the week it's due", 'query: "type=plot-date due"', "group: due:week", "sort: due", "direction: asc", "columns: [title, due]"]),
].join("\n").trimEnd();

/** The calendar's board: a lane per question, each a saved view. */
export const PLOT_DATE_LANES = [
  "Due in three days [type::virtual-branch] [query::type=plot-date due <= +3d] [sort::due] [direction::asc] [summary-properties::due]",
  "Waiting until today [type::virtual-branch] [query::type=plot-date wait-until <= today] [summary-properties::wait-until]",
  "Window open today [type::virtual-branch] [query::type=plot-date window = today] [summary-properties::window]",
];

/** A tabs figure over the plot's jobs (PLOT_JOBS, its children): a tab per stage, `=` or its ≡ control for density. */
export const PLOT_JOBS_NOTE = [
  `${SEED.plotJobs} [page::${SEED.plotJobs}]`,
  "",
  "One live figure, a tab per stage. [ ] to a tab, then ← → or tab and shift+tab switch; = changes the density.",
  "",
  ...fig("tabs", ["title: Plot jobs", 'query: "type=plot-job"', "group: stage", "order: [doing, review, validate]", "columns: [title, priority]", "sort: created", "direction: asc"]),
].join("\n").trimEnd();

/**
 * The daily brief (PIE-435): two mornings of a made-up household, as an agent drafts them
 * (skills/daily-brief/SKILL.md). The newer one has every section: a headline, what needs you, yesterday as a
 * story, today, live figures (a stat over the board's lanes by `view: ((…))`, a saved view's checklist),
 * jump points, earlier briefs and a folded Sources callout. Prose never restates a figure's number.
 */
export function briefText(o: { lanes: Msg[]; cards: Msg[]; hub: Msg; gardenView: Msg }): string {
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

export const BRIEF_BEFORE = [
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
 * A build log whose decisions are steps the person answers from their box (PIE-811): approved is their yes, rejected
 * their no, each written as the mark it's drawn with; an agent reads them with `tasks` or `checklist.query`.
 */
export const BUILD_LOG = [
  `${SEED.buildLog} [page::${SEED.buildLog}]`,
  "> [!summary] The felt is on. Two calls are yours: Approve or Reject each from its box (⏎ or a click, then + or -).",
  "## Needs you",
  "- [ ] felt from the merchant, not the DIY shop ^t-b1d001",
  "- [ ] patch the gutter until spring, or replace it now ^t-b1d002",
  "## Decided",
  "- [✓] screws, not nails, for the battens",
  "- [✗] paint it green this year",
  "## Done",
  "- [x] measure the roof",
  "- [~] the merchant's delivery slot",
].join("\n");

/**
 * A test plan whose steps are a `::graph-check` (PIE-864): its rows' code spans copy, its links follow and its boxes
 * take a checklist step's marks, as the same words on a plain line above do. The live figure lists the note's own jobs;
 * a mark on one writes that job's `status`.
 */
export const TEST_PLAN = [
  `${SEED.testPlan} [page::${SEED.testPlan}]`,
  "Open `http://localhost:4175/gate?code=7` and lift the latch, as [[Shed roof build log]] says.",
  "- [ ] the same step on a plain line: open `http://localhost:4175/gate?code=7`",
  "",
  ...mdFig("check", ["title: You test"], [
    "- [ ] open `http://localhost:4175/gate?code=7` — as **Ana**, from [[Shed roof build log]]",
    "- [ ] lift the latch twice",
    "- [~] the new hinge pins",
  ]),
  ...fig("check", ["title: The door's jobs (live)", 'query: "parent:this type=door-job"', 'done: "status=done"']),
].join("\n");

export const TEST_PLAN_JOBS = ["Plane the door's bottom edge [type::door-job] [status::todo]", "Oil the hinges [type::door-job] [status::done]"];

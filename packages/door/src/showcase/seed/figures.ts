// The showcase seed's figures (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { SEED } from "./names";

/** Every `::graph-*` kind the door draws (src/graphs.ts); the figures note has one of each. */
export const FIGURE_KINDS = ["check", "stat", "kpi", "rank", "table", "tabs", "timeline", "meter", "funnel", "waterfall", "spark", "plot", "gantt", "tree", "quadrant", "matrix", "compare", "flow"] as const;

/** The kinds the Markdown figures note shows (src/figures/), each in its Markdown form; the keys note has `keys`. */
export const MARKDOWN_KINDS = ["decision", "chat", "uptime", "activity", "calendar", "annotate"] as const;

export const fig = (kind: string, yaml: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", "::", ""];

/** A figure with YAML props and Markdown rows after them. */
export const mdFig = (kind: string, yaml: string[], md: string[]) => [`::graph-${kind}`, "---", ...yaml, "---", ...md, "::", ""];

export function figuresText(gardenViewId: string, choresId: string): string {
  return [
    `${SEED.figures} [page::${SEED.figures}]`,
    "",
    "Live figures ask the outline on every render; the others are drawn from their own values.",
    "",
    ...fig("check", ["title: Garden chores (live query)", 'query: "type=chore area=garden"', 'done: "stage=done"', "note: due"]),
    ...fig("stat", ["title: Garden chores by address (live)", "items:", `  - { label: by block, view: ((${gardenViewId})) }`, "  - { label: by page, view: [[garden-chores|Garden chores]] }"]),
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
export function markdownFiguresText(figureBlockId: string): string {
  return [
    `${SEED.markdownFigures} [page::${SEED.markdownFigures}]`,
    "",
    "A figure's rows can be Markdown after its YAML: **bold** is now or chosen, *italic* next or rejected, `- label: value` a row, `x — note` a side note, `a → b` a path, `ok*40` a run of forty. Where the YAML says the same thing, the YAML wins.",
    "",
    "Click an activity day, or select it with [ ] and press Enter, to list that day's notes below this reader.",
    ...fig("activity", ["title: Chores written (live)", 'query: "type=chore"', "count: created", "weeks: 1"]),
    ...fig("activity", ["title: Chores updated (live)", 'query: "type=chore"', "count: updated", "weeks: 1"]),
    ...fig("activity", ["title: Decisions by date (live)", 'query: "type=decision"', "date: date", "to: 2026-03-18", "weeks: 3"]),
    "A figure block: its own note, its rows its child bullets (each opens its note):",
    `!((${figureBlockId}))`,
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
  ].join("\n");
}

/**
 * The figure block the Markdown figures note transcludes: a note whose body is a figure (nothing above it but its
 * title), its child bullets its rows.
 */
export const FIGURE_BLOCK = ["Bean rows", "::graph-timeline", "---", "title: Bean rows (child bullets)", "---", "::"].join("\n");

export const FIGURE_BLOCK_ROWS = ["Apr: sow under glass", "**May: plant out** — when the nights are warm", "*Jun: first picking*"];

/** The keys note: the reader's keys from the action registry, and a sheet written by hand. */
export const KEYS_TEXT = [
  `${SEED.keys} [page::${SEED.keys}]`,
  "",
  "Read from the door's own action registry, so it says what the keys do now:",
  "",
  ...fig("keys", ["title: The reader (from the registry)", "actions: note", "learn: [edit, comment, element.open]", "limit: 14"]),
  ...mdFig("keys", ["title: Getting about"], ["- **g then d: the desk**", "- ctrl+k: the command palette", "- ( ) then f: fold a heading", "- esc: close what popped up · q: back"]),
].join("\n");

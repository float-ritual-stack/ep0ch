// The showcase seed's notes (split out of seed.ts): its notes' text and fixtures. Exported through ../seed.ts as before.
import { SEED, WORK_PREFIX } from "./names";
import { SHOWCASE_ASSETS } from "./media";

export const BOLD_DEMO = [
  "**Done when**",
  "- Before **bold in a list** returns to body text.",
  "",
  "Before **inline bold** returns to body text.",
  "[A link with **bold words** and its usual colour](https://example.org/garden)",
  "**Bold around [a link](https://example.org/garden) returns to strong** then body text.",
  "",
  "### A heading with **bold words** keeps its look",
  "",
  "> [!note] A callout with emphasis",
  "> Before **bold in a callout** returns to body text.",
].join("\n");

export function notebookText(whiteboardId: string, kettleId: string, tapId: string): string {
  return [
    `${SEED.notebook} [page::${SEED.notebook}] [subtitle::Growing together through the seasons]`,
    "[season::autumn] [plot::14b] [to::the plot committee] #allotment #beds",
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
    "copies of ~/.claude/~/projects/x at the same paths",
    "~178 orphaned … ~ stays as written; only ~~this~~ is struck through.",
    "",
    BOLD_DEMO,
    "",
    "## Quoting the syntax",
    "Code is opaque (PIE-764): `((transcript^t0817|at 08:17))`, `[[Compost heap]]`, `!((transcript))` and `[key::value]` in backticks are text, never a link, a property, a warning or a popup; so is a fence:",
    "```blockdown",
    "[[Compost heap]] and ((transcript^t0817|at 08:17))",
    "!((transcript)) [status::example]",
    "```",
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

export const WHITEBOARD = [
  `${SEED.whiteboard} [page::${SEED.whiteboard}]`,
  "[room::kitchen]",
  "",
  "Shopping: oats, lemons, washing-up liquid. #kitchen #shopping",
  "Rota: whoever cooks doesn't wash up.",
  "- Saturday",
  "  - clean the oven, then the fridge shelves nobody has touched since the spring clean",
  "    - [ ] buy the oven cleaner",
  "Press e to edit; type `[[` for a page, `((` for a block, `[file::` for a file; ctrl+t puts in notes or files another program picks (tv ep0ch).",
  "In a list, Enter starts the next item at the same level; Tab and Shift+Tab nest it; Ctrl+P previews.",
  `In an edit, ctrl+l opens the link the cursor is on beside it, and the edit stays open: [[${SEED.shed}]]. So does an alt- or ctrl-click on one, or a click on one in the preview. In \`[[\`, a name no page has yet is offered as a new page.`,
].join("\n");

// A labelled block ref inside italics (PIE-541): the link keeps its colour inside the emphasis.
export const shedText = (whiteboardId: string) => [
  `${SEED.shed} [page::${SEED.shed}] [room::garden]`,
  "",
  "Three bikes, one pump, and a lock that sticks in the cold. #bikes #tools",
  "The spare inner tubes hang on the left hook.",
  `_The pump's spare valves are on ((${whiteboardId}|the kitchen whiteboard))._`,
  "Tyre pressures are on the maker's page: [web::https://example.org/bike-care/tyres] (a Resource: b lists it with the note's links).",
  "",
  "::links",
].join("\n");

export const FRONT_MATTER = [
  SEED.frontMatter,
  "- [ctx::2026-10-15 @ 10:19:21 PM] - [project::garden] - [mode::evening]",
  "- re:: whether to sow early",
  "- connectTo:: ['beans', 'frost']",
  "- relatedTo:: PLOT-1",
  "- tags:: ['neat']",
  "",
  "The seedlings are sheltered with #spring and [inline::data] in the notebook.",
  "",
  "- key:: stuff",
  "",
  "anotherkey:: stuff",
].join("\n");

export const FRONT_MATTER_AGENT = `${SEED.frontMatterAgent} [ctx::2026-10-15 @ 10:23:44 PM] #epic\n\nLeave space for the bean poles.`;

/**
 * The title section's note (PIE-657): the reader's header as it is now, with the old one written out to compare. Its
 * properties give the byline's meta line something to hold (the summary values are links).
 */
export const titleText = (whiteboardId = "00000000-0000-4000-8000-000000000000") => [
  `${SEED.title} [type::roadmap-item] [work-id::${WORK_PREFIX}-042] [work-stage::doing] [priority::high] [track::allotment]`,
  "",
  "The header leads with the title: the note's breadcrumb is a dim eyebrow above it, the title is the one bold line in the heading colour (twice the height where the terminal has Kitty's text sizing and the title fits that wide), and its Work ID first in the accent (PIE-809), and one dim line under it holds the author, the day, the property count and the summary values, which are still links. The tile's top border says the title too, Work ID first, then what the tile is (`detail`, `held`), dim: the border is where the eye lands.",
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
 * The move-note section's note (PIE-943): three notes to move about under it and the Greenhouse to move one into.
 */
export const MOVING_NOTES = [
  SEED.moving,
  "",
  "**Z** moves the note you're reading under another (the picker lists its parents and the notes changed lately first, then the Inbox; type to find any other). **alt+↑ alt+↓** put the note you read up or down among its siblings. In the outline on the left, **alt+↑ alt+↓** (or **K J**) do the same for the selected row, **I** moves it in under the note above and **O** out after its parent; **ctrl+z** puts the last move back. Drag a row onto another to move it under that row, or onto its ▸ mark to put it beside it.",
].join("\n");

/**
 * The routing section's note (PIE-1010): a shelf, a tin, a recipe to route by hand, and two rule notes under it.
 */
export const ROUTING_NOTES = [
  SEED.routing,
  "",
  "A **routing rule** is a note: `[type::route]`, a `[query::…]` in the saved views' grammar and a `[route-to::((id))]`. The first rule whose query holds for a note moves it there, as `ext:route`, in one revision, with a history under the rule. The **Routing** view at the root lists every rule; its order is the rules' order.",
  "",
  "**alt+z** on *Pickled walnuts* (the reader on the right) routes it: the first rule here, by command only, sends recipes to the *Recipe shelf*; **alt+Z** says what would move without moving it; **ctrl+z** puts it back. **ctrl+n**, then `Nasturtium [type::seed]` and ctrl+s, esc: a moment after you stop typing the note is in the *Seed tin* (the second rule routes new notes by itself). `ep0ch route --all --dry-run` says what every rule would do.",
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
  "A page link can hold another: [[[[2026-03-12]] - seed swap notes]] is one link to the page \"[[2026-03-12]] - seed swap notes\" (the brackets are counted, never matched by the first `]]`), and the 2026-03-12 page lists this note among its backlinks too.",
  "",
  "A note whose first line is only `[page::2026-03-12]` names itself: ⏎ on that line in the editor, or the save, makes it `2026-03-12 [page::2026-03-12]`. A title already there is kept.",
].join("\n");

/**
 * A half-written note (PIE-669): a fence and a page link left open. Each costs only itself: the fence its paragraph,
 * the link its line; the link and tag after the fence still count, and the reader says both, with how to close them.
 */
export const HALF_WRITTEN = [
  SEED.halfWritten,
  "Typed in a hurry: the fence below was never closed, and neither was the link on the last line.",
  "```ts",
  "const jars = 12",
  "",
  `After the code, the [[${SEED.shed}]] page and this tag still count. #seed-jars`,
  "Ask about [[Seed tr",
].join("\n");

/**
 * The overscroll note (PIE-622): long enough to scroll, so End puts its last line on the reader's bottom edge and,
 * pressed again, brings it up to the middle with blank rows under it.
 */
export const OVERSCROLL = [
  SEED.overscroll,
  "",
  "End (or G) goes to the last line: it sits on the bottom edge. Press it again, or keep scrolling with the wheel, PgDn or space, and the last line comes up to the middle of the reader, with nothing under it. Home comes back to the top.",
  "",
  "`ep0ch act reader.overscroll rows=none` stops every reader and draft at its last line as before; `rows=half` is the default, and a number of rows scrolls that far past the end. It's kept for the next start, as the theme is.",
  "",
  "In a draft (e), typing on the last line keeps a few blank rows under the cursor, and the wheel scrolls past the end as the reader does.",
  "",
  ...Array.from({ length: 36 }, (_, i) => `- Cane ${i + 1}: ${["two plants, tied in", "flowers setting", "first pods, thin them", "picked on Saturday"][i % 4]}.`),
  "",
  "The last cane: the compost bin is behind it.",
].join("\n");

/**
 * The undo section's note (PIE-621): one earlier revision (the first text, kept by the outline when the second replaced
 * it), so the tile menu's "an earlier revision" has something to go back to.
 */
export const LABELS_BEFORE = [`${SEED.labels} [page::${SEED.labels}]`, "[room::pantry]", "", "Write the date on every lid."].join("\n");

export const LABELS = [`${SEED.labels} [page::${SEED.labels}]`, "[room::pantry]", "", "Write the date on every lid.", "Rota: whoever fills a jar labels it.",
  "Drag across text in an edit and it's copied; ctrl+z undoes, ctrl+y redoes; opened again after a save, ctrl+z stops at the save and asks before taking saved text back; the tile menu's \"an earlier revision\" goes back past a save."].join("\n");

/**
 * The kept-edits section's three notes (PIE-637): each was written, then changed once by someone else (`after`), and the
 * person has an unsent edit from the text it began as (`before`, which the outline's history keeps): `draft`. The rota's
 * edit adds a line the note lacks (still new); the hedge's edit is a line the note has since gained (already in it);
 * the compost's edit rewrites a line the note rewrote differently (a conflict).
 */
export const keptNote = (title: string, ...lines: string[]) => [`${title} [page::${title}]`, "", ...lines].join("\n");

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
/**
 * The proposals section's guide (PIE-725): two agents patch its sowing line at one revision. @fern's lands; @moss's
 * loses the race and is refused. @moss deliberately offers a suggestion; repeating that suggestion is deduped.
 */
export const RACE_LINE = "Sow the beans   in May, two to a pot.";

export const RACE_AGENTS = { winner: "fern", loser: "moss" } as const;

export const RACE_PATCH = { winner: { observed: "beans   in May", replacement: "beans in late May" }, loser: { observed: "beans   in May", replacement: "beans in May" } } as const;

export const RACE = [
  SEED.race,
  "",
  `Two agents tidied this guide at the same moment. @${RACE_AGENTS.winner}'s patch landed first. @${RACE_AGENTS.loser}'s, read at the same revision, changed the same words, so it was refused with the current revision and instructions to re-read and retry. No proposal or waiting task was made. @${RACE_AGENTS.loser} then explicitly asked to propose a suggestion (propose: true); that is the proposal beside the guide, with [apply] and [dismiss]. The guide's text and revision stayed as @${RACE_AGENTS.winner} left them, so the next writer doesn't lose too.`,
  "",
  `@${RACE_AGENTS.loser} then sent the same patch again. The service returned the open proposal (deduped), not a second copy.`,
  "",
  RACE_LINE,
  "Water the seed trays from below.",
].join("\n");

/** The notes the what-changed section's scripted agent edits, with the line it writes (a round number follows). */
export const LOGS = [["logBeans", "Staked and tied, round"], ["logCompost", "Turned the heap, round"], ["logShed", "Oiled the hinges, round"]] as const;

/** The search section's note: what the forgiving search finds, tried on this outline's own titles. */
export const FINDING = [
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
export const ERRAND = [
  `${SEED.errand} [type::errand] - [area::garden] - [ctx::2026-03-09 @ 09:27:29 AM] [tag::seeds] [tag::spring]`,
  "Broad beans and leeks, two packets each.",
  "when:: before Friday",
  "- [ ] order the beans",
  "- [x] measure the bed",
].join("\n");

/**
 * The deep links section (PIE-762): a meeting with two anchors already (`^a10` on a paragraph, `^decision` on a
 * heading) and passages with none, and the guide a comment is written on.
 */
export const MEETING = [
  SEED.meeting,
  "",
  "Present: Ana, Bo and Cy, in the greenhouse at ten.",
  "",
  "We agreed to water the seedlings every morning, before the glass warms. ^a10",
  "",
  "## Decision ^decision",
  "Buy a second water butt for the north side.",
  "",
  "## Actions",
  "- Ana mends the vent hinge",
  "- Bo orders the shade netting",
  "",
  "> [!quote] What Cy said",
  "> The seedlings don't mind the cold.",
  "> They mind the draught from the door.",
].join("\n");

/**
 * The write review section (PIE-1388): a status note as an agent writes one when nobody reviews it, stacked bullets and a
 * count typed in, kept as the agent left it; the seed asks the review of it and keeps what it said, as a write's answer
 * does, so Jev's suggestions page has its row.
 */
export const WRITE_REVIEW = [
  SEED.writeReview,
  "",
  "- The shed roof went on at nine and the felt was cut to size. The tacks ran out halfway, which slowed the job. Then the second box came and nothing leaked.",
  "- Board: 2 queued and 1 in review, with more coming tomorrow.",
].join("\n");

/** The same note once its writer split the stacked bullet (PIE-1433's at-revision section opens revision 1 beside it). */
export const WRITE_REVIEW_FIXED = [
  SEED.writeReview,
  "",
  "- **Roof on** at nine; the felt was cut to size.",
  "- **Tacks ran out** halfway; the second box came.",
  "- **Nothing leaked.**",
  "- Board: 2 queued and 1 in review, with more coming tomorrow.",
].join("\n");

/**
 * The search section (PIE-1197, PIE-1198): a made-up eval run, both models side by side, as `ep0ch search eval` scores
 * one (search-eval.ts ModelScore). The numbers are invented; the page around them is the real one.
 */
const score = (model: string, hit1: number, hit5: number, sureRight: number, sureNothing: number) => ({
  model, cases: 24, positives: 12, reachable: 11, negatives: 12, asked: 22, unavailable: 0, hit1, hit5, lexHit1: 5, lexHit5: 9,
  existsAnswered: 0.81, existsNot: 0.34, sureRight, sureWrong: 1, sureNothing, quietRight: 14, quietWrong: 2, tokensIn: 41000, tokensOut: 90, setIn: 41000, setOut: 90,
});
export const SEARCH_EVAL_SCORES = [score("jev-1.13.0", 7, 10, 6, 1), score("jev-1.14.0", 7, 10, 6, 2)];
export const SEARCH_EVAL_SWEEP = [
  { exists: 0.7, strong: 2, sureRight: 7, sureWrong: 2, sureNothing: 3, quietWrong: 1 },
  { exists: 0.8, strong: 2, sureRight: 6, sureWrong: 1, sureNothing: 1, quietWrong: 2 },
];

/** The completion sources section (PIE-1340): an extension's rows under [[, ranked with the pages. */
export const SOURCES = [
  SEED.sources,
  "",
  "A comment is open on this note, ending in `[[seed`. The list holds this outline's pages and the open issues the **Issues** extension offers under the same `[[` (it adds no sigil of its own), ranked together by one matcher: a title that starts with the word first, one that only holds it after.",
  "",
  "- **What a row is:** its kind at the right (`page`, `issue`), a dim detail, and its docs beside the list.",
  "- **Picks come first:** choose an issue twice and it rises among equals, here, in Detail and in every door on this outline (the host keeps the picks).",
  "- **Its own key:** `[issue::` lists the open issues too; `[issue::21` finds #21 by its number.",
  "- **A query completes the grammar (PIE-1472):** in a view note's `[query::`, a lens line's `query=\"`, a figure's `query:` or a settings field, Tab offers `under:this`, `parent:`, `links:`, `#tag`, `NOT`/`AND`/`OR`, `{{this.page}}` and, after `updated >=`, `-7d` or `today`, each with the grammar's own words beside it, then the keys and values the notes have.",
  "- **Take it away:** remove Issues in the power bar (`&issues`): the issue rows go, the pages stay. Install it again from the same row.",
].join("\n");

/**
 * The sticky pad section (PIE-1247): a long plan whose figure has no heading over it, a callout and a list, and a pad
 * that embeds one part of it by its page. The figure asks `parent:this`: in the pad it still reads the plan's children.
 */
export const STICKY_PLAN = [
  `${SEED.stickyPlan} [page::${SEED.stickyPlan}]`,
  "A long plan for the season. Nothing over its figure is a heading: the figure has an anchor of its own.",
  "",
  "::graph-table ^bed-jobs",
  "---",
  "title: Bed jobs",
  'query: "parent:this"',
  "---",
  "::",
  "",
  "> [!tip] Water early",
  "> Before nine, so the leaves dry by noon.",
  "",
  "- stake the peas",
  "- net the brassicas",
  "",
  "The rest of the plan: rotations, seed orders, who has the van.",
].join("\n");
export const STICKY_JOBS = ["Turn the compost", "Mend the north bed"];
/** The one completer (PIE-1076): a list to sort from inside its own edit, with the keys that do it written beside it. */
export const ONE_COMPLETER = [
  SEED.oneCompleter,
  "",
  "- Water the leeks",
  "- Label the chilli trays",
  "- Sow the broad beans",
  "",
  "- **From where you type:** in the edit, ctrl+k (or `/` first on a line) lists the actions that apply here; type `sort list` and ⏎.",
  "- **Its arguments in place:** `o` then tab gives `order=`, ↓ and ⏎ choose `desc`; ⏎ on the line runs it and saves the note; ctrl+z in the reader takes it back.",
  "- **The same list in the power bar:** ctrl+k outside the edit, `tile.zoom t`, tab gives `tile=`, and the list is this screen's tiles by the names `tile=` takes; `%` first in a value lists tiles whatever it takes.",
].join("\n");

/** Asking an agent from the bar (PIE-1437): a note to ask about, with the keys written beside it. */
export const ASK_AGENT = [
  SEED.askAgent,
  "",
  "- Sam waters on Mondays, Robin on Thursdays.",
  "- The seed trays go out once the frost has gone.",
  "",
  "- **Ask from the bar:** ctrl+k, then `@wr` and tab gives `@wren `; type what you ask.",
  `- **Each reference by its sigil:** \`[[\` a page (\`[[${SEED.stickyPlan}\`), \`((\` a note by its words or a short id, \`%\` a tile on this screen (\`%rota\`).`,
  "- **⏎ sends it:** a comment naming @wren on this note, which wren's sessions hear and answer in the thread; @ on a row of the agent panel starts the same line.",
].join("\n");

export const STICKY_PAD = [
  SEED.stickyPad,
  `One part of the [[${SEED.stickyPlan}]], kept beside the long note:`,
  "",
  `![[${SEED.stickyPlan}^bed-jobs]]`,
  "",
  "- **Any element:** a figure, a callout, a list item or a paragraph takes an `^anchor` at the end of its line; the figure's is on its `::graph-table` line.",
  "- **Written for you:** in an edit, type `!((Raised` and the plan's figure, callout and list items are listed with the anchor each would get; choose one and it's added to the plan's line.",
  `- **By page:** \`![[${SEED.stickyPlan}^\` lists the same parts; \`[[${SEED.stickyPlan}^bed-jobs]]\` links straight to the figure.`,
  "- **Who aims where:** the links tile on the right groups the plan's backlinks by the anchor each one aims at.",
].join("\n");

/**
 * The detach section (PIE-1247 slice 2): a plan whose parts come out by alt+drag, alt+D or act, and a pad to drop
 * them into. Nothing here has an anchor yet: each is written when a part is detached or dropped.
 */
export const SHED_PLAN = [
  `${SEED.shedPlan} [page::${SEED.shedPlan}]`,
  "Everything the shed needs before winter, in one long note.",
  "",
  "::graph-table",
  "---",
  "title: Shed jobs",
  'query: "parent:this"',
  "---",
  "::",
  "",
  "> [!warning] Paint the door last",
  "> The primer needs two dry days.",
  "",
  "- order the felt",
  "- borrow a ladder",
].join("\n");
export const SHED_JOBS = ["Clear the gutter", "Fix the latch"];
export const SHED_PAD = [
  SEED.shedPad,
  "Drop a part of the plan here.",
  "",
  "- **alt+drag** a part of the plan (its figure, the callout, a list item) onto this note: choose embed or copy.",
  "- **alt+drag** it onto a tile's side, its header or the screen's edge: it detaches into a tile of its own.",
  "- **alt+D** on the plan detaches the part you're on; agents: `element.detach`, `element.quote`.",
].join("\n");

/**
 * The zoom section (PIE-780): a long note whose figure, table and heading's section each zoom to fill the reader, by W,
 * a click on the ⤢ at its right edge, or act; back returns.
 */
/**
 * The trail (PIE-208): a walk round the garden, five notes each linking the next, so a reader that follows them has a
 * trail to list. `next` is the following stop's id; the last has none.
 */
export const TRAIL_STOPS = ["the gate", "the pond", "the orchard", "the shed", "the compost heap"] as const;
export function trailStopText(i: number, next: string | null): string {
  const title = `Garden walk: ${TRAIL_STOPS[i]}`;
  if (!next) return `${title}\nThe end of the walk.\n\n- **alt+T** (or the ≡ trail beside ← back, or the tile menu): every stop you've passed, by title.\n- Pick one and the reader goes straight there; ← back and forward → walk the same trail.`;
  return `${title}\nStop ${i + 1} of ${TRAIL_STOPS.length}. Walk on: ((${next}|${TRAIL_STOPS[i + 1]})).`;
}

/**
 * Back anywhere (PIE-1426): a detail up top whose opens and picks go to a preview below, a links tile beside it whose
 * pick shows there too. The hub links two jobs; two notes link the hub; one links a job, so `b` on it lists something.
 */
export const backHubText = (beans: string, shed: string) => `${SEED.backHub}\nFirst ((${beans}|the beans)), then ((${shed}|the shed)). Pick a row in the links tile, open a link up here, press b in the preview: alt+← in the preview steps back through each, in order. alt+← in the links tile lists what it listed before b.`;
export const backJobText = (title: string, body: string, link?: string) => `${title}\n${body}${link ? ` For ((${link})).` : ""}`;

export const ZOOM_PLAN = [
  SEED.zoomPlan,
  "Everything the orchard needs this winter. Click in the figure, the table or a section: a ⤢ shows at its right edge; click it (or press W) and that part fills the reader. Esc, alt+← or a click on the top row comes back.",
  "",
  "::graph-table",
  "---",
  "title: Winter jobs",
  'query: "parent:this"',
  "---",
  "::",
  "",
  "| tree | rootstock | prune |",
  "| --- | --- | --- |",
  "| Bramley | MM106 | January |",
  "| Egremont | M26 | February |",
  "| Conference | Quince A | late February |",
  "",
  "## Pruning",
  "Cut out the dead, the diseased and the crossing wood first.",
  "",
  "- open the centre of each apple",
  "- leave the plums until summer",
  "",
  "## Next spring",
  "Graft two new Egremonts onto M26.",
].join("\n");
export const ZOOM_JOBS = ["Prune the Bramley", "Grease-band the trunks", "Mulch the young trees"];

export const DEEP_LINKS = [
  SEED.deepLinks,
  "",
  `A comment is open on this note, with the ${SEED.meeting.split(",")[0]} beside it. Type \`((Gree\` in the comment: the meeting is listed with its anchors (\`^a10\`, \`^decision\`) right under it, each at the front of its row.`,
  "",
  "- **Read before inserting:** the completion floats across the screen, beyond this tile. Click a row to preview its note; wheel over the preview or PgUp/PgDn scrolls it. Enter or double click inserts. The next `((` starts with notes again.",
  "- **Refine a reference:** choose the meeting itself, then type `^` straight after its `))`: the popup searches inside the meeting, its anchors first. Choose `^a10`.",
  "- **A passage with no anchor:** type `^` after another reference and choose a line that says `adds ^…`: the anchor is added to the meeting (the reader beside shows it) and the reference points at it, in one choice.",
  "- **Reopen one later:** click inside a finished `((…))` and type `^` (every passage) or `#` (headings).",
  "- **Embed a part without visiting it:** type `!((Gree`: under the meeting are its headings, quotes and callouts with no anchor yet (`[!] What Cy said`). Choose one: it gets its anchor in the meeting, and `!((…^what-cy-said))` embeds the whole callout, every line of it.",
  "- **Mistakes land:** an unclosed `((` or a title in place of an id is sent as written, with a warning and a did-you-mean.",
  "- **The mouse:** drag across words and press backspace; ctrl+z undoes.",
].join("\n");

/**
 * The composer section (PIE-770): a note four readers show, each writing a comment on one of its last lines in another
 * placement (inline, floating, split, popup). The lines the composers are on, by placement.
 */
export const MARGIN_LINES = {
  inline: "The shed roof needs two new sheets of felt before the frost.",
  floating: "The rain barrel overflows onto the path after a storm.",
  split: "The compost thermometer reads warm in the middle of the heap.",
  popup: "The seed tray lids are stacked behind the potting bench.",
} as const;

export const MARGIN = [
  SEED.margin,
  "",
  "A comment is written where you read it. Select words with the mouse (or v) and press C: the box opens right under them, the note still readable and scrollable around it. ctrl+s saves, and the thread sits where the box was.",
  "",
  "- **Four places:** inline (the default), floating beside the passage, split (the note beside the composer) or a popup. ctrl+o, or a click on the box's chip, moves the one you're writing; `composer.place` sets where new ones open.",
  "- **One editor:** the mouse selects and deletes, ctrl+z undoes, `((` links a note and `^` after it picks a passage; ctrl+p previews references and embeds as the reader draws them.",
  `- **It stays with you:** click another tile and back, and the box is there as you left it. Drag a floating box by its top edge, size it by its ◢ corner (or ctrl+g, then the arrows), for this sitting only. Follow a link like [[${SEED.shed}]] with a comment unsent and you're asked: save and continue, keep writing, or discard.`,
  "",
  ...Object.values(MARGIN_LINES).flatMap(l => [l, ""]),
].join("\n").trimEnd();

/** The comment editor's note (PIE-846): long enough that a comment written beside it can't hide it, with a whole-note thread. */
export const WHOLE_NOTE = [
  SEED.wholeNote,
  "",
  "The seed library opens on Saturday mornings from nine, in the shed by the north gate. Bring seeds in paper packets, labelled with the variety and the year saved.",
  "",
  "- **Taking:** two packets a visit, more in March when the swap table fills up.",
  "- **Giving:** anything you grew yourself and let go to seed; no F1 hybrids, they don't come true.",
  "- **Labels:** the variety, the year, the plot it came from, and anything odd (\"crossed with the yellow ones\").",
  "",
  "In winter the library moves indoors, to the shelf above the kettle in the committee room. The key is with whoever has the Saturday shift.",
  "",
  "Write a comment on the whole note with C (nothing selected) or the [comment] after the date: it sits at the top, where the one already there is.",
].join("\n");

/** The whole-note comment on it, with a picture in it (drawn under Kitty graphics, said elsewhere). */
export const WHOLE_NOTE_COMMENT = (dir = SHOWCASE_ASSETS) => `Could we pin the opening hours on the gate too?\n\n[img::${dir}/allotment-notice.png] [size::40%] [alt::the notice on the gate]`;

export const RECIPE = [
  `${SEED.recipe} [serves::4]`,
  "",
  "Soften an onion, two carrots and a stick of celery in oil.",
  "Add 250g red lentils, a tin of tomatoes and a litre of stock.",
  "Simmer for twenty minutes, then blend half of it.",
  "Squeeze in a lemon just before serving. #kitchen #soup",
  "",
  "Drag across these lines, or press v and move, to select; y copies.",
].join("\n");

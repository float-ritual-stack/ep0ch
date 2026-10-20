// The showcase outline (PIE-439): a fictional household's notes that exercise every shared door part.
// Written through the service API (create, work-ids.configure, roadmap.items.create, properties.patch,
// annotations.*), never into SQLite, so seeding runs the same write paths the door does and keeps
// working across schema migrations. The same seed serves `scripts/try-it.sh --showcase`, the tests
// (`Scratch.seedShowcase`) and `bun scripts/snap.ts showcase`.
//
// Deterministic: the same blocks, text and order every run. Ids and timestamps are the service's, so
// everything that reads the seed finds it by title under the root, never by id.
//
// The notes' text and fixtures are by area in seed/ (names, work, figures, notes, media, margin, extensions, looks,
// echonet); this file keeps the order they are written in. A new section's content is a new file there.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { outputRegionText } from "@ep0ch/outline-core/output-region";
import { titleLine, type Msg } from "../board";
import { USER, hostRequest, type Actor, SocketBoard } from "../socket";
import { resourceNote } from "../authored";
import { WELCOME_VIEW_TEXT } from "../hub/welcome";
import { CARD_EXAMPLES, DEMO_EXAMPLES, FORM_EXAMPLES, installExamples, PROGRAM_EXAMPLES, RULE_EXAMPLES, VIEW_EXAMPLES } from "./tickets/install";

import { SEED, SEED_AGENT, SHOWCASE_MARK, type SeedName, WORK_PREFIX } from "./seed/names";
import { ECHO_COPIES, ECHO_NODELIST, ECHO_POSTS, ECHO_SEEN_BY, ECHO_TOSSER, ECHO_TOSSES } from "./seed/echonet";
import { PROJECT_FIGURE, PROJECT_TICKETS, VENT_RAIL } from "./seed/self";
import { BRIEF_BEFORE, BUILD_LOG, CARDS, CHORES, LANES, PLOT_DATES, PLOT_DATES_NOTE, PLOT_DATE_LANES, PLOT_JOBS, PLOT_JOBS_NOTE, SOCIETY_LINKED_BACK, SOCIETY_NOTES, TEST_PLAN, TEST_PLAN_JOBS, briefText, laneQuery, societyText } from "./seed/work";
import { BACKUP_RUNS, DECISIONS, FIGURE_BLOCK, FIGURE_BLOCK_ROWS, KEYS_TEXT, figuresText, markdownFiguresText } from "./seed/figures";
import { DEEP_LINKS, ERRAND, FINDING, FRONT_MATTER, FRONT_MATTER_AGENT, HALF_WRITTEN, KEPT, LABELS, LABELS_BEFORE, LOGS, MARGIN, MEETING, MOVING_NOTES, NEW_NOTES, OVERSCROLL, RACE, RACE_AGENTS, RACE_PATCH, RECIPE, ROUTING_NOTES, WHITEBOARD, WHOLE_NOTE, WHOLE_NOTE_COMMENT, notebookText, shedText, titleText } from "./seed/notes";
import { CALLOUTS, CALLOUT_TYPE, SPAN_COPY, SHOWCASE_ASSETS, artifactsText, galleryCards, galleryText, heroText, imagesText, placeArtifacts } from "./seed/media";
import { MARGINALIA_NOTEBOOK, MARGINALIA_PLAN, RECENT_FILES, RECENT_REPLIES, RECENT_SESSION, REMOTE_CLIENT, REMOTE_LINE, REMOTE_WRITES, recentFilesText } from "./seed/margin";
import { ALMANAC, FORM_READING, FORM_REPAIRS, HELD_ASK, OMENS, RULES_NOTE, TICKETS, TICKET_PAGE, seedTickets } from "./seed/extensions";
import { HEADINGS, LOOKS_LAB, SPACING_LAB, DISPATCH_SKIN } from "./seed/looks";
import { seedAccess } from "./seed/access";
import { scriptExamples } from "@ep0ch/outliner/script-examples";
import { VENT_PERSON, VENT_PROJECT, VENT_RECIPE, ventRailText } from "./seed/values";
import { DAILY_NOTES, DAILY_TEMPLATE, MEETING_ACTIONS, MEETING_PAGES, MEETING_TEMPLATE } from "./seed/templates";

// The seed's notes and fixtures live beside it, by area (seed/*.ts); the tests and the screen import them from here.
export * from "./seed/names";
export * from "./seed/echonet";
export * from "./seed/work";
export * from "./seed/figures";
export * from "./seed/notes";
export * from "./seed/media";
export * from "./seed/margin";
export * from "./seed/extensions";
export * from "./seed/looks";

/** What `seedShowcase` wrote: each seeded note by name, the lanes, cards and chores in order. */
export interface Seeded {
  notes: Record<SeedName, Msg>;
  /** The proposals section's race (PIE-725): the loser's proposal, and whether its retry was returned as that one. */
  race: { proposal: string; retry: { proposalId: string; deduped?: boolean } };
  lanes: Msg[];
  cards: Msg[];
  chores: Msg[];
  comments: { open: string; resolved: string; resource: string };
}

/**
 * Write the showcase outline into an empty workspace. Refuses when one is already there (`findShowcase`),
 * so a half-finished run is never seeded on top of: reset the workspace instead.
 */
/**
 * The race (PIE-725): @fern and @moss read the guide at one revision and patch the same words. @fern's applies; @moss's
 * is refused; @moss then deliberately offers a suggestion, whose retry is deduped.
 */
export async function seedRace(board: SocketBoard, note: Msg): Promise<{ note: Msg; race: Seeded["race"] }> {
  const at = note.text.indexOf(RACE_PATCH.winner.observed);
  const patch = (actorId: string, span: { observed: string; replacement: string }, propose = false) => board.request<{ outcome: string; proposalId?: string; deduped?: boolean }>("draft.patch", {
    blockId: note.id, revision: note.revision, propose, mutation: { author: "agent", actorId },
    patches: [{ ...span, range: { start: at, end: at + span.observed.length }, unit: "utf16" }],
  });
  await patch(RACE_AGENTS.winner, RACE_PATCH.winner);
  try {
    await patch(RACE_AGENTS.loser, RACE_PATCH.loser);
    throw new Error("the showcase's conflicting patch should be refused");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("read it again and send the patch")) throw error;
  }
  const lost = await patch(RACE_AGENTS.loser, RACE_PATCH.loser, true);
  if (lost.outcome !== "proposed" || !lost.proposalId) throw new Error(`the showcase's race: @${RACE_AGENTS.loser}'s patch was ${lost.outcome}, not proposed`);
  const retry = await patch(RACE_AGENTS.loser, RACE_PATCH.loser, true);
  return { note: (await board.get(note.id))!, race: { proposal: lost.proposalId, retry: { proposalId: retry.proposalId ?? "", ...(retry.deduped ? { deduped: true } : {}) } } };
}

/** The Fantasia script's code (PIE-959). */
export const FANTASIA = "const beats = Math.max(1, Math.min(12, Number(props.beats && props.beats[0]) || 4));\nconst tempo = Math.max(150, Math.min(3000, Number(props.tempo && props.tempo[0]) || 500));\nconst style = (props.motion && props.motion[0]) || 'fantasia';\nconst home = (props.layout && props.layout[0]) || '';\nconst stay = !!(props.stay && props.stay[0]);\nconst before = await act('layout.get');\nif (before.locked) return 'fantasia: the screen is locked; alt+k unlocks it, then run again';\nconst dancers = (before.tiles || []).filter(t => t.shown && t.kind !== 'drawer.own').map(t => ({ id: t.id, name: t.name }));\nconst notes = [], floated = [];\nfor (const d of dancers) {\n  try { const r = await act('tile.float', { tile: d.id, on: true, motion: style }); floated.push({ id: r && r.now && r.now !== d.name ? r.now : d.id, name: d.name }); }\n  catch (e) { notes.push(d.name + ' stayed put: ' + (e && e.message || e)); }\n}\nif (!floated.length) return 'fantasia: no tile would float. ' + notes.join('; ');\nconst drift = [[7, -2], [-5, 3], [6, 2], [-8, -3], [4, 4], [-4, -4], [9, 1], [-6, 2]];\nfor (let beat = 0; beat < beats; beat++) {\n  for (let i = 0; i < floated.length; i++) {\n    const [dx, dy] = drift[(beat + i * 3) % drift.length];\n    try { await act('float.place', { tile: floated[i].id, dx: i % 2 ? -dx : dx, dy, motion: style }); }\n    catch (e) { notes.push('beat ' + (beat + 1) + ', ' + floated[i].name + ': ' + (e && e.message || e)); }\n  }\n  await wait(tempo);\n}\nlet settled = '';\nif (stay) settled = 'and left where they danced (layout.undo puts them back)';\nif (!settled && home) {\n  try { await act('layout.load', { name: home, motion: 'settle' }); settled = 'into the screen ' + home; }\n  catch (e) { notes.push('layout.load ' + home + ': ' + (e && e.message || e)); }\n}\nif (!settled) {\n  // No layout asked: the run's own changes are taken back, so the screen is as it began.\n  try { await act('layout.undo'); settled = 'the layout as it began'; } catch (e) { notes.push('layout.undo: ' + (e && e.message || e)); }\n}\nif (!settled) settled = 'left where they danced (layout.undo, or ctrl+z, puts them back)';\nreturn 'fantasia: ' + floated.length + ' tile' + (floated.length === 1 ? '' : 's') + ' danced ' + beats + ' beat' + (beats === 1 ? '' : 's') + ' at ' + tempo + ' ms, ' + settled + (notes.length ? '\\nnotes: ' + notes.join('; ') : '');";

export async function seedShowcase(board: SocketBoard, opts: { ticketsConfig?: string; outliner?: string; rulesFrom?: string } = {}): Promise<Seeded> {
  if (await findShowcase(board)) throw new Error("this outline already has a showcase; reset it (scripts/try-it.sh --showcase --reset) rather than seeding twice");
  const make = (parentId: string | null, text: string, actor: Actor = { kind: "user" }) => board.createBlock(parentId, text, actor);
  const notes = {} as Record<SeedName, Msg>;
  let resourceThread = "";

  notes.root = await make(null, [`${SEED.root} [${SHOWCASE_MARK.key}::${SHOWCASE_MARK.value}]`, "",
    "A made-up household's outline for the door's showcase: every shared part, on notes you can edit, move and comment on.",
    "Nothing here is real. `scripts/try-it.sh --showcase --reset` puts it all back."].join("\n"));

  await hostRequest(board.path, "outlines.attach", { name: "showcase-orchard", create: true });
  const orchard = new SocketBoard(board.path, undefined, "showcase-orchard");
  try {
    await orchard.info();
    const neighbour = await orchard.createBlock(null, "Pear tree [page::pear-tree]\nWater deeply on dry days.");
    const journal = await orchard.createBlock(null, `Orchard journal\nWater the pear tree. See [[pear-tree]] or ((${neighbour.id}|the tree)).`);
    notes.crossOutline = await make(notes.root.id, `${SEED.crossOutline} [foreign-note::${journal.id}]\nThe reader beside this one holds a note in showcase-orchard. Edit or comment there: the save belongs to that outline. Its tinted frame names the outline.\n[Open the orchard journal](https://my.ep0ch.sh/pub/o/showcase-orchard/p/${journal.id})\n[web::https://my.ep0ch.sh/pub/o/showcase-orchard/p/${journal.id}]\nQualified page: [[showcase-orchard:pear-tree]]. Qualified note: ((showcase-orchard:${journal.id}|the journal)). Bare UUID: ((${neighbour.id})).\n!((showcase-orchard:${neighbour.id}))\nPress / and type outline:showcase-orchard pear to search that outline without leaving this screen.`);
  } finally { orchard.close(); }

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
  notes.gardenView = await make(notes.root.id, `${SEED.gardenView} [page::garden-chores] [type::virtual-branch] [query::type=chore area=garden]`);

  // The Welcome screen's notes (C): marked by [welcome::true], in the Welcome view's hand-set order, the first read on opening.
  // Under a note of their own, the view with them: beside the garden view it would make the root a second board hub.
  const landing = await make(notes.root.id, "Landing\nWhat the Welcome screen reads first.");
  const welcomeNotes = [
    await make(landing.id, `Start here [welcome::true]\nThe house's jobs are on [[${SEED.hub}]]; the bikes are in [[${SEED.shed}]].`),
    await make(landing.id, "House rules [welcome::true]\nWipe the counter. The last one up turns the heating down."),
  ];
  const welcomeView = await make(landing.id, WELCOME_VIEW_TEXT);
  await board.moveInView({ view: welcomeView.id, blocks: welcomeNotes.map(m => m.id) }, { kind: "user" });

  notes.asks = await make(notes.root.id, `${SEED.asks}\n\nBare \`@tidy\` fixes list nesting and spacing above. \`@tidy wrap each item in a callout\` rewrites the passage as asked (Haiku by default, or tidy config.answer). It lands as one lit, attributed edit: ctrl+z undoes it. Every ask says what changed or why it could not run.\n\nPress e, go to the end, and write @planter show the seed counts on its own line. Keep typing on the next line. The answer stays folded and its running view opens beside this note. Open the fold to edit or keep the script. Or ask @planter describe the beds: its plain answer streams beside you as you keep writing.\n\n`);
  if (opts.ticketsConfig) {
    const folder = join(opts.ticketsConfig, "pi-herdr-outliner", "extensions", "showcase-planter");
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, "extension.json"), JSON.stringify({ contract: 2, id: "showcase-planter", version: 1, name: "Planter", run: ["bun", "respond.ts"], agents: [{ name: "planter", effects: "write" }] }));
    const reply = 'Seed counts [script::seed-counts]\n```js\nreturn { data: null, view: view.table({ columns: ["Crop", "Packets"], rows: [["Peas", 3], ["Beans", 5]] }) };\n```';
    writeFileSync(join(folder, "respond.ts"), `
const request = await Bun.stdin.json();
if (request.input.request === "describe the beds") {
  for (const reply of ["Sow peas along the fence.", "\\n\\nWater the beds in the evening."]) {
    console.log(JSON.stringify({reply}));
    await Bun.sleep(750);
  }
  console.log(JSON.stringify({ok: true, value: {}}));
} else console.log(JSON.stringify({ok: true, value: {reply: ${JSON.stringify(reply)}}}));`);
  }
  notes.scriptTarget = await make(notes.root.id, "Planting checklist\n- [ ] Prepare the seed labels");
  notes.scripts = await make(notes.root.id, [
    "Seed report [script::seed-report] [results::keep] [effects::write] [keys::alt+S]",
    "Scripts default to read. This example declares [effects::write]; its run and writes belong to script:seed-report, with the requester recorded separately. Files opt in with // ep0ch-script under .ep0ch/scripts/; ext ls explains ignored files.",
    "Press alt+S, or type seed-report in the power bar or / search. Keep typing; its progress arrives below. One ext.undo takes back the run. Keys never interrupt an edit; a clash says which action holds the key.",
    "The Seed count example below runs from @seed-count in a note, or [rule-on::script:seed-count] on a rule. Agent-written asks run by default; loop guards can hold them for r.",
    "Record a layout with alt+Q (or the status bar's ⇧⌥Q), do your actions, then alt+Q or REC stop. The saved script is editable action lines. Replace an argument value with {tag}; the power bar asks for it when you run the script.",
    "```ts",
    "const dispatcher = await act('layout.get');",
    "await act('task.status', { n: 1, to: 'done' });",
    "await tools.outline_create({ parent: self.id, text: 'Labels for planting' });",
    "return { message: 'Ready for planting', dispatcher };",
    "```", '::links{preview=below title="Runs"}',
  ].join("\n"));
  await make(notes.scripts.id, "Seed count [script::seed-count]\n```js\nreturn (await q('script')).blocks.length;\n```");
  await make(notes.scripts.id, "Beds table [script::beds-table] [mode::render]\n```js\nconst owner = (await resolve('this.owner')).values[0];\nreturn view.table({ columns: ['Owner', 'Week', 'Crop'], rows: [[owner, props.week[0], this.title]] });\n```");
  notes.scriptsInPlace = await make(notes.root.id, [
    `${SEED.scriptsInPlace} [owner::Sam] [crop::beans] [publish::public:scripts-in-place]`,
    "A script written with [mode::render] draws where a line asks for it, and again when a note it read changes. It writes nothing: this note stays as you typed it.",
    "[[showcase-published-script-lines|Published script lines]] demonstrates visible-only counts, embeds and ::use on its public page.",
    "To write at an anchor instead: tools.outline_edit({ ref: this.id, expectedRevision: this.revision, append: \"One more entry\", at: \"^log\" }) uses output-region placement, including a held draft (Scripts: PROGRAMMABLE-NOTES.md task 4).",
    "beds-table:: week=42",
    "A ::= line is the same in one line, with this, props, q, read and resolve:",
    "::= (await resolve('this.owner')).values[0] + ' sows ' + (await resolve('this.crop')).values[0]",
  ].join("\n"));
  const publicSeeds = await make(notes.root.id, "Showcase seeds [type::virtual-branch] [query::showcase-seed] [publish::public]");
  await make(notes.root.id, "Bean packet [showcase-seed::yes] [publish::public]");
  await make(notes.root.id, "Pea packet [showcase-seed::yes] [publish::never]");
  await make(notes.scripts.id, `Published seed count [script::published-seed-count] [mode::render] [publish::public]\n\`\`\`js\nconst found = await tools.outline_find({ view: "${publicSeeds.id}", limit: 1 });\nreturn "Seeds shown here: " + found.total;\n\`\`\``);
  await make(notes.scripts.id, 'Private script label [script::private-script-label] [mode::render] [publish::never] [secret::PRIVATE_SCRIPT_SECRET]\n```js\nreturn self.properties.find(p => p.key === "secret").values[0];\n```');
  const publicShelf = await make(notes.root.id, "Published shelf [publish::public]");
  await make(publicShelf.id, "Private packet [publish::never]");
  await make(notes.scripts.id, `Published shelf read [script::published-shelf-read] [mode::render] [publish::public]\n\`\`\`js\nconst read = await tools.outline_read({ ref: "${publicShelf.id}", depth: 0 });\nreturn "Shelf complete: " + read.complete + "; children: " + read.children.length;\n\`\`\``);
  const publishedCount = await make(notes.root.id, "Seed count template [page::showcase-seed-count] [publish::public:showcase-seed-count]\npublished-seed-count::\npublished-shelf-read::\nprivate-script-label::");
  await make(notes.root.id, `Published script lines [page::showcase-published-script-lines] [publish::public:published-script-lines]\nOn a published page each drawing says Seeds shown here: 1, although the outline holds two packets. The locked packet does not count. The shelf read is complete with zero children because its only packet is private. Both forms draw the script through the same handler as its own page. The private script says not shared.\n\n!((${publishedCount.id}))\n\n::use{of=[[showcase-seed-count]]}`);
  // A view that can be pressed (PIE-981): a render script draws the board, each free square a press that runs the move script.
  const tttOutcome = "const outcome = b => { for (const [a, c, d] of [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]]) if (b[a] !== '.' && b[a] === b[c] && b[a] === b[d]) return b[a] + ' wins'; return b.includes('.') ? '' : 'draw'; };";
  await make(notes.scripts.id, `Noughts board [script::ttt-board] [mode::render]
\`\`\`js
${tttOutcome}
const b = (await resolve('this.board')).values[0] ?? '.........';
const ended = outcome(b);
const square = i => b[i] === '.' ? view.badge({ label: ended ? '.' : String(i + 1), ...(ended ? {} : { act: 'ttt-move at=' + (i + 1) }) }) : view.badge({ label: b[i], tone: b[i] === 'x' ? 'accent' : 'warn' });
return view.stack({ children: [...[0, 3, 6].map(r => view.row({ minWidth: 4, children: [square(r), square(r + 1), square(r + 2)] })), ...(ended ? [view.text({ text: ended })] : [])] });
\`\`\``);
  await make(notes.scripts.id, `Noughts move [script::ttt-move] [effects::write]
\`\`\`js
${tttOutcome}
const at = Number(props.at[0]);
const b = [...(await resolve('this.board')).values[0]];
if (outcome(b)) throw new Error(outcome(b) + '; press New game to play again');
if (!(at >= 1 && at <= 9) || b[at - 1] !== '.') throw new Error('That square is not free; choose a numbered square');
b[at - 1] = 'x';
let answer = 'x on ' + at;
if (!outcome(b)) {
  const reply = b.indexOf('.');
  b[reply] = 'o';
  answer += ' · o answers on ' + (reply + 1);
}
await tools.outline_set_property({ ref: this.id, key: 'board', value: b.join(''), revision: this.revision });
return answer + (outcome(b) ? ' · ' + outcome(b) : '');
\`\`\``);
  await make(notes.scripts.id, "Noughts reset [script::ttt-reset] [effects::write]\n\`\`\`js\nawait tools.outline_set_property({ ref: this.id, key: 'board', value: '.........', revision: this.revision });\nreturn 'New game';\n\`\`\`");
  notes.press = await make(notes.root.id, [
    `${SEED.press} [board::.........]`,
    "The board is drawn by a render script, which writes nothing. Each free square is a press (a button in the view): a click, or ⏎ on it, runs the move script as you. Your click is the consent: it runs at once, and ctrl+z or ext.undo takes it back. The script answers with an o.",
    "ttt-board::",
    '::button{label="New game" of=ttt-reset}',
    '::button{label="Desk" act="layout.load name=daily"}',
    '::button{label="Waiting on me" act="host.waiting"}',
    '::button{label="Board" act="screen.open name=board"}',
    "In prose it is a link: [start over](act: ttt-reset).",
  ].join("\n"));
  // Generated regions in prose (PIE-956): the render script's table, a ::= sentence and a written output region, each read like the page.
  notes.outputRegions = await make(notes.root.id, [
    `${SEED.outputRegions} [owner::Sam] [crop::beans]`,
    "Sam's sowing plan for week 42 is a script's table, drawn as if it were written here:",
    "beds-table:: week=42",
    "Below it, one sentence is generated too:",
    "::= (await resolve('this.owner')).values[0] + ' sows ' + (await resolve('this.crop')).values[0]",
    "Neither shows who ran it, when, or a button: the one dim mark in the margin beside each is all that says so. Put the cursor on it (the [ ] keys), or click it, to see when it ran and to run it again. A script that writes leaves its output in the note, as a region you can edit:",
    outputRegionText({ label: "last week's rota", producer: notes.scripts.id, anchor: "out-rota-7c2e", body: `- Mon: Sam waters the beans\n- Wed: Robin thins the carrots\n- Fri: Sam picks the first peas\n\n[img::${SHOWCASE_ASSETS}/seed-packet.webp] [height::4] [alt::the seeds for next week]` }),
    "Change a word inside it and it is yours: the script's next run waits as a proposal beside it.",
    "A running script's place() follows the line that asked it, even if you insert paragraphs above it before the answer lands. Changing or duplicating that caller leaves a reason in the run note; run it again or name an ^anchor.",
    "Press S for Sources. Open the table, then c downloads its raw rows as CSV and J as JSON; the same controls are clickable. Published pages have the same Query, Transform and Result folds behind Sources.",
  ].join("\n"));
  // Motion (PIE-958): a button runs a script whose layout changes glide; its tiles float, wander and settle, then land where the layout is.
  await make(notes.scripts.id, "Shuffle tiles [script::shuffle-tiles] [results::keep] [effects::write]\n```js\nfor (const n of ['source', 'extra']) await act('tile.float', { tile: n, on: true, motion: 'fantasia' });\nawait wait(1400);\nawait act('float.place', { tile: 'source', dx: 10, dy: 3, motion: 'fantasia' });\nawait act('float.place', { tile: 'extra', dx: -8, dy: 2, motion: 'fantasia' });\nawait wait(1400);\nfor (const n of ['source', 'extra']) await act('tile.float', { tile: n, on: false, motion: 'fantasia' });\nreturn 'settled';\n```");
  notes.motion = await make(notes.root.id, [
    `${SEED.motion}`,
    "Press the button: its script floats the two tiles beside this one, moves them, and settles them back. Each change glides from where the tile was to where it is (a script asks for motion=fantasia; the setting caps it: motion.set mode=calm or off). Nothing flashes or changes brightness, and any key or click snaps it. ctrl+z puts the whole run's layout back.",
    '::button{label="✦ Shuffle the tiles" of=shuffle-tiles}',
  ].join("\n"));
  // Fantasia (PIE-959): the acceptance script. A press floats every tile it may, dances them with motion=fantasia and settles them.
  await make(notes.scripts.id, "Fantasia [script::fantasia] [results::keep] [effects::write]\n```js\n"+FANTASIA+"\n```");
  notes.fantasia = await make(notes.root.id, [
    SEED.fantasia,
    "Press the button: a script floats the tiles, dances them a few beats with motion=fantasia and settles them back into the layout. Your press invites it, so it may move the tile you are in too; an agent's run (act ext.<id>.run) leaves that one where it is. Nothing you type is touched. esc stops it between beats and the layout is put back; ctrl+z (layout.undo) takes the whole run back in one step.",
    '::button{label="✦ Fantasia" of=fantasia beats=3 tempo=450 motion=fantasia}',
  ].join("\n"));
  // The worked examples of the scripts reference (PIE-982), pasted as notes. Read from the page at seed time on purpose: the page is the one source of the example text, and its test runs these same notes, so a copy in the seed could only drift from both.
  notes.scriptExamples = await make(notes.root.id, `${SEED.scriptExamples}\nThe worked examples of the scripts reference (packages/outliner/docs/scripts.md), pasted as notes beneath this one. ${SEED.exampleOrder} draws a table of its children with a computed column; ${SEED.exampleGame} is tic-tac-toe, played with ttt-play cell=5 from the power bar; Bed 4 reads its properties into a sentence; a rule stamps a checklist under every #shipit note.`);
  const pasted = new Map<string, Msg>();
  for (const example of scriptExamples()) {
    for (const note of example.notes) {
      pasted.set(note.label, await make(note.parent ? pasted.get(note.parent)!.id : notes.scriptExamples.id, note.text));
      // A rule or a script is read once the service has loaded it; the note it acts on comes after.
      if (/\[(?:script|rule-name)::/.test(note.text.split("\n")[0]!)) await Bun.sleep(150);
    }
  }
  notes.exampleOrder = pasted.get("ex2-order")!;
  notes.exampleGame = pasted.get("ex3-game")!;
  notes.whiteboard = await make(notes.root.id, WHITEBOARD);
  notes.richEdit = await make(notes.root.id, [
    SEED.richEdit, "", "Edit the cells here. Ctrl+O switches the same draft to raw source and back.", "",
    "| Crop | Packets |", "| --- | ---: |", "| Beans | 4 |", "| Peas | 2 |", "",
    "::graph-table", "---", "title: Next sowing", 'headers: ["Crop", "Trays"]', "rows:", '  - ["Lettuce", "3"] # keep this row comment', '  - ["Radish", "1"]', "# keep this YAML comment", "---", "rows: keep this prose after the YAML", "headers: [These, are, prose]", "::", "",
    "Keep typing while an agent adds another table: its fields are editable in this same draft.",
  ].join("\n"));
  notes.shed = await make(notes.root.id, shedText(notes.whiteboard.id));
  await make(notes.shed.id, "Puncture kit\nPatches, glue, two tyre levers.");
  await make(notes.shed.id, "Chain oil\nThe dry lube, not the wet one.", SEED_AGENT);
  // Notes to trash and bring back (PIE-878): the heap, with two notes under it.
  notes.heap = await make(notes.root.id, `${SEED.heap}\nOld leaves and kitchen peelings, no meat.`);
  await make(notes.heap.id, "Turning log\nTurned on Sunday, steaming.");
  await make(notes.heap.id, "Lid\nCracked; the new one comes with the order.");
  // A day's plan with its outbox in it (PIE-693): a ::links block over a query, the waiting letters listed beside a
  // preview of the one selected; the letters themselves live under a note of their own.
  notes.outbox = await make(notes.root.id, `${SEED.outbox}\nWhat's written and waiting to go, one note a letter.`);
  await make(notes.outbox.id, "Ask Ana about the bean seed [type::letter] [mail::waiting]\nTwo jars of runner beans for the swap. She said Thursday, so ask by Wednesday night.");
  await make(notes.outbox.id, "Write to the allotment society about the gate [type::letter] [mail::waiting]\nThe latch drops when the wind gets up. Ask whether they'll pay for a new spring, or if we buy it.");
  await make(notes.outbox.id, "Order the fruit-cage netting [type::letter] [mail::waiting]\n- [ ] measure the cage\n- [ ] 2 cm mesh, not 4");
  await make(notes.outbox.id, "Thank the swap hosts [type::letter] [mail::done]\nSent on Monday.", SEED_AGENT);
  for (const [key, lines] of [["rowsOne", 1], ["rowsTwo", 2], ["rowsTruncate", 0]] as const) {
    notes[key] = await make(notes.root.id, `${SEED[key]}\n::links{groups=children lines=${lines}}\n::`);
    await make(notes[key].id, "Carry the trestle tables across the garden before the evening gathering");
    await make(notes[key].id, "Ask the allotment society to repair the gate before the autumn seed swap");
  }
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
    "## A query it can't read",
    '::links{query="type!=letter" title="Not letters"}',
    "::",
    "",
    "## On the plot",
    "- Water the beans before ten.",
    "- Lift the last of the onions.",
  ].join("\n"));
  // Tags as links (PIE-800): a note whose #tags open the notes carrying them, and those notes (one under a nested tag).
  notes.frost = await make(notes.root.id, [
    `${SEED.frost}`,
    "What has to happen before the nights turn cold. #frost-jobs lists every job tagged for it; #compost the bay's.",
    "",
    "A click on a tag lists the notes carrying it beside this reader: a click there previews one, a double click opens it here, an alt-click beside.",
  ].join("\n"));
  await make(notes.root.id, "Fleece over the brassicas\nTwo layers on the north bed; weigh the edges with bricks. #frost-jobs");
  await make(notes.root.id, "Lift the dahlias\nDry the tubers in the shed; the stems go on the heap. #frost-jobs #compost");
  await make(notes.root.id, "Lag the standpipe\nThe lagging is in the shed, top shelf. #frost-jobs/water");
  // A thread whose replies carry stages (PIE-693): the links tile's Children group, narrowed by Stage like any other group.
  // Where it meets is a property whose value is a link (PIE-874): the shed lists the swap among its backlinks, as "meets-at".
  notes.swap = await make(notes.root.id, `${SEED.swap} [type::thread] [meets-at::[[${SEED.shed}]]]\nWho brings what to the seed swap on Saturday.`);
  await make(notes.swap.id, "Ana: runner beans to swap [type::offer] [status::waiting]\nTwo jars, saved from last year's best row.");
  await make(notes.swap.id, "Ben: took the leek seedlings [type::offer] [status::done]\nThank you, they're in.", SEED_AGENT);
  await make(notes.swap.id, "Cal: labels and a pencil [type::offer] [status::active]\nI'll write the labels on the day.");
  // A thread three deep, its replies stamped replyTo as R writes them (PIE-944): eight answers to the question, the fifth with
  // two answers of its own, the second of those the note the thread panel is opened on, with two replies under it.
  notes.thread = await make(notes.root.id, `${SEED.thread}\nFor the new bed by the water butt, about a dozen.`);
  const answer = (parent: Msg, text: string, by?: Actor) => make(parent.id, `${text}\n[replyTo::${parent.id}]`, by);
  const answers: Msg[] = [];
  for (const t of ["Ana: I have a tray going spare", "Cal: ask the plot 14 neighbour", "Dee: the garden centre has them", "Eli: not this year, sorry", "Fay: I can bring some on Saturday", "Gus: try the seed swap", "Hal: mine bolted", "Ivy: last year's were tiny"]) answers.push(await answer(notes.thread, t, answers.length % 2 ? SEED_AGENT : undefined));
  await answer(answers[4]!, "Ana: how many do you need?");
  notes.threadHere = await answer(answers[4]!, SEED.threadHere);
  await answer(notes.threadHere, "Fay: no rush, Saturday is fine", SEED_AGENT);
  await answer(notes.threadHere, "Ana: I'll hold a dozen back");
  // A status the built-in families don't know (PIE-819): named as written, and a rule note in Rules puts it in done.
  await make(notes.swap.id, "Dee: a question about the time [status::answered]\nIs it ten or eleven? Ten, said Ana.");
  // A small checklist under the whiteboard, for the notebook's anchored embed of one step.
  const tap = await make(notes.whiteboard.id, "Kitchen tap\n- [~] fix the dripping tap ^t-7a9c11\n  - [ ] buy a washer\n- [ ] tighten the hinge");
  notes.notebook = await make(notes.root.id, notebookText(notes.whiteboard.id, cards[3]!.id, tap.id));
  notes.figures = await make(notes.root.id, figuresText(notes.gardenView.id, notes.chores.id));
  const parcels = await make(notes.root.id, "Parcels [type::virtual-branch] [query::type=showcase-parcel] [sort::title] [direction::asc]");
  notes.inlineLists = await make(notes.root.id, `${SEED.inlineLists}\nBefore the list: use down to enter its first row.\n\n!((${parcels.id}))\n\nAfter the list: up returns to its last row.\n\nWheel over the rows scrolls the box; at either end it scrolls the note. Enter opens a row, alt+Enter opens beside.`);
  for (let i = 1; i <= 60; i++) await make(notes.root.id, `Parcel ${String(i).padStart(2, "0")} [type::showcase-parcel]\nA fictional parcel for the inline list.`);

  notes.plotJobs = await make(notes.root.id, PLOT_JOBS_NOTE);
  for (const j of PLOT_JOBS) await make(notes.plotJobs.id, `${j.title} [type::plot-job] [stage::${j.stage}] [priority::${j.priority}]`);
  notes.dates = await make(notes.root.id, PLOT_DATES_NOTE);
  for (const d of PLOT_DATES()) await make(notes.dates.id, `${d.title} [type::plot-date] ${d.props}`);
  notes.datesBoard = await make(notes.root.id, `${SEED.datesBoard}\nThe plot calendar's questions, a lane each: saved views over dates.`);
  for (const lane of PLOT_DATE_LANES) await make(notes.datesBoard.id, lane);
  // The society page and the notes that mention it (PIE-745): its page first, so their [[links]] resolve; then its text
  // once they're there, linking back to the first few.
  notes.society = await make(notes.root.id, `${SEED.society} [page::${SEED.society}]`);
  const mentions = await make(notes.root.id, "Society mentions\nNotes that mention the allotment society, one a note.");
  const society: Msg[] = [];
  for (const m of SOCIETY_NOTES) society.push(await make(mentions.id, `${m.title} [type::society-note] [crop::${m.crop}] [season::${m.season}]\nFrom the [[${SEED.society}]].`));
  notes.society = await board.update(notes.society.id, societyText(society.slice(0, SOCIETY_LINKED_BACK)), notes.society.revision!);
  // Notes that read themselves (PIE-533 S3): the tickets, then two project pages with the one figure, and the vent rail.
  for (const t of PROJECT_TICKETS) await make(notes.root.id, `${t.title} [type::ticket] [project::${t.project}]`);
  notes.projectLego = await make(notes.root.id, `${SEED.projectLego} [project::lego-night]\n\n${PROJECT_FIGURE}`);
  notes.projectGarden = await make(notes.root.id, `${SEED.projectGarden} [project::garden-club]\n\n${PROJECT_FIGURE}`);
  notes.fieldsRail = await make(notes.root.id, VENT_RAIL);
  notes.recipe = await make(notes.root.id, RECIPE);
  notes.finding = await make(notes.root.id, FINDING);
  notes.meeting = await make(notes.root.id, MEETING);
  notes.deepLinks = await make(notes.root.id, DEEP_LINKS);
  notes.margin = await make(notes.root.id, MARGIN);
  notes.wholeNote = await make(notes.root.id, WHOLE_NOTE);
  notes.errand = await make(notes.root.id, ERRAND);
  await make(notes.errand.id, "Ask the neighbour about netting\nShe has a spare roll.");
  notes.calloutType = await make(notes.root.id, CALLOUT_TYPE);
  notes.callouts = await make(notes.root.id, CALLOUTS);
  const spanCopy = await make(notes.callouts.id, SPAN_COPY);
  await board.comment("showcase-span-copy", spanCopy.id, spanCopy.revision!, "Try `comment-copy`.", { quote: "Paragraph `paragraph-copy`.", start: SPAN_COPY.indexOf("Paragraph `paragraph-copy`.") }, SEED_AGENT);
  notes.images = await make(notes.root.id, imagesText());
  notes.hero = await make(notes.root.id, heroText());
  notes.artifacts = await make(notes.root.id, artifactsText(await placeArtifacts(board)));
  notes.replies = await make(notes.root.id, `${SEED.replies} [thread::orchard]\n\nR writes beside this message. Save keeps the reply; Esc closes it. Select words and press R to quote.\n\n${Array.from({ length: 35 }, (_, i) => `Orchard row ${i + 1}: leave the small apples for the birds.`).join("\n")}`);
  notes.snapshot = await make(notes.root.id, `${SEED.snapshot}\n\nUse the power bar (ctrl+k), > outline.snapshot, to copy a one-time snapshot link. The link expires in 15 minutes; ep0ch share revoke ends it sooner. It includes private notes.\n\nFrom a shell on this machine:\n\n\`\`\`sh\nep0ch outline snapshot showcase --out /tmp/showcase.sqlite\nsqlite3 -readonly /tmp/showcase.sqlite 'select count(*) from blocks;'\n\`\`\`\n\nWith a publisher running: ep0ch outline snapshot showcase --link prints a curl command. Fetch it, then run the same query. A finished download uses the link once; a headers-only preview or an interrupted download leaves it usable until expiry. A second finished fetch is refused. Share the curl command in a code block to avoid chat link previews. The snapshot record logs each attempt without its token. Add ?gz=1 for gzip.\n\nRemote MCP clients receive a notifications/tools/list_changed notification on the authenticated event stream, including when they reconnect after a gateway deploy. A listening client can refresh its tools without restarting the chat app.\n`);
  notes.frontMatter = await make(notes.root.id, FRONT_MATTER);
  notes.frontMatterAgent = await make(notes.root.id, FRONT_MATTER_AGENT);
  notes.title = await make(notes.root.id, titleText(notes.whiteboard.id));
  // The Markdown figures: the note first (its children need it), then its text once the figure block it transcludes is there.
  notes.markdownFigures = await make(notes.root.id, SEED.markdownFigures);
  for (const d of DECISIONS) await make(notes.markdownFigures.id, `${d.title} [type::decision] [decision-state::${d.state}] [reason::${d.reason}] [date::${d.date}]`);
  const runs = await make(notes.markdownFigures.id, "Backup runs [type::backup-log]", SEED_AGENT);
  for (const r of BACKUP_RUNS) await make(runs.id, `photos backup ${r.date} [type::backup-run] [machine::backup] - [status::${r.status}] - [date::${r.date}] - [source::photos]`, SEED_AGENT);
  const block = await make(notes.markdownFigures.id, FIGURE_BLOCK);
  for (const row of FIGURE_BLOCK_ROWS) await make(block.id, row);
  notes.markdownFigures = await board.update(notes.markdownFigures.id, markdownFiguresText(block.id), notes.markdownFigures.revision!);
  notes.keys = await make(notes.root.id, KEYS_TEXT);
  notes.newNotes = await make(notes.root.id, NEW_NOTES);
  notes.moving = await make(notes.root.id, MOVING_NOTES);
  for (const t of ["Cold frame\nThe lid wants new hinges.", "Seed trays\nWashed and stacked by the door.", "Potting bench\nA coat of oil before spring."]) await make(notes.moving.id, t);
  // Routing (PIE-1010): the recipe is written before its rule, so only alt+z (or ep0ch route) moves it; the seed rule routes new notes by itself.
  notes.routing = await make(notes.root.id, ROUTING_NOTES);
  notes.recipeShelf = await make(notes.routing.id, `${SEED.recipeShelf}\nJars and the recipes that filled them.`);
  notes.seedTin = await make(notes.routing.id, `${SEED.seedTin}\nPackets by the month they go in.`);
  notes.pickled = await make(notes.routing.id, `${SEED.pickled} [type::recipe]\nPick them green in July, before the shells set. Brine for a week, then the spiced vinegar.`);
  await make(notes.routing.id, `Recipes go to the shelf [type::route] [query::type=recipe] [route-to::((${notes.recipeShelf.id}))] [route-when::command]`);
  await make(notes.routing.id, `Seeds go to the tin [type::route] [query::type=seed] [route-to::((${notes.seedTin.id}))]`);
  notes.greenhouse = await make(notes.root.id, `${SEED.greenhouse}\nWhere the seedlings go once they have two leaves.`);
  notes.recentFiles = await make(notes.root.id, recentFilesText());
  {
    const day = await make(notes.recentFiles.id, "2026-03-11 [file-day::2026-03-11] [machine::file-touch]", SEED_AGENT);
    const project = await make(day.id, "allotment [file-project::allotment] [machine::file-touch]", SEED_AGENT);
    const session = await make(project.id, `session ${RECENT_SESSION.slice(0, 8)} [file-session::${RECENT_SESSION}] [machine::file-touch]`, SEED_AGENT);
    const touches: Msg[] = [];
    for (const f of RECENT_FILES()) touches.push(await make(session.id, `${f.shown} [file::${f.file}] [type::file-touch] [machine::file-touch] [day::2026-03-11] [project::allotment] [session::${RECENT_SESSION}] [touches::${f.touches}] [last-touch::${f.at}] [added::${f.added}] [removed::${f.removed}]`, SEED_AGENT));
    // A comment on the bed plan, a Resource (PIE-650): quoted from the file's own Markdown, opened from the block whose link
    // names it, so the thread shows as a backlink there. The file is never written.
    const plan = RECENT_FILES()[0]!, followed = await board.followAuthored({ kind: "filesystem", path: plan.file }, SEED_AGENT);
    const note = resourceNote(await board.describeResource(followed.id), touches[0]!.id);
    const quoted = "Net the brassicas before the pigeons find them.";
    resourceThread = (await board.commentOnResource("showcase-resource", note.resource!, note.revision!, "Netting goes on before the first leaves show, or the pigeons get there first.", { quote: quoted, start: note.text.indexOf(quoted) }, SEED_AGENT)).id;
  }
  notes.remoteWrites = await make(notes.root.id, REMOTE_WRITES);
  notes.buildLog = await make(notes.root.id, BUILD_LOG);
  notes.testPlan = await make(notes.root.id, TEST_PLAN);
  for (const job of TEST_PLAN_JOBS) await make(notes.testPlan.id, job);
  // Notes that read themselves (PIE-533 S2): the fixture under a project, with the notes its placeholders read from.
  // Templates (PIE-533 S4): the meeting template, three pages that use it live, the daily template and where its stamp lands.
  await make(notes.root.id, "Meeting greeting [page::meeting-greeting] [type::template]\n[form-field::with text required]\nWelcome {{props.with}} to {{this.title}}.");
  notes.templateMeeting = await make(notes.root.id, MEETING_TEMPLATE);
  notes.templateDaily = await make(notes.root.id, DAILY_TEMPLATE);
  notes.dailyNotes = await make(notes.root.id, DAILY_NOTES);
  const [sowing, potting, unfinished] = MEETING_PAGES;
  notes.meetingSowing = await make(notes.root.id, `${sowing.title} [project::${sowing.project}]\n\n${sowing.call}`);
  notes.meetingPotting = await make(notes.root.id, `${potting.title} [project::${potting.project}]\n\n${potting.call}`);
  notes.meetingUnfinished = await make(notes.root.id, `${unfinished.title} [project::${unfinished.project}]\n\n${unfinished.call}`);
  for (const a of MEETING_ACTIONS) await make(notes.root.id, `${a.title} [type::action] [project::${a.project}]`);
  notes.ventProject = await make(notes.root.id, VENT_PROJECT);
  notes.ventPerson = await make(notes.root.id, VENT_PERSON);
  notes.ventRecipe = await make(notes.root.id, VENT_RECIPE);
  notes.ventRail = await make(notes.ventProject.id, ventRailText(notes.ventRecipe.id));
  notes.waitingDecision = await make(notes.root.id, `${SEED.waitingDecision} [needs::sysop: glass or shade cloth?]`, { kind: "agent", id: "garden-agent" });
  notes.waitingCalls = await make(notes.root.id, `${SEED.waitingCalls} [type::capability]\n\n## Decisions for Evan\n- [ ] Choose the north wall\n- [x] Choose the door\n## Supplies\n- [ ] Buy hinges`);
  const race = await seedRace(board, await make(notes.root.id, RACE));
  notes.race = race.note;
  // What changed (PIE-647): three notes a scripted agent edits when the section opens.
  for (const [key, line] of LOGS) notes[key] = await make(notes.root.id, `${SEED[key]}\n${line} 0`);
  const labels = await board.request<{ id: string; revision: number }>("create", { parentId: notes.root.id, text: LABELS_BEFORE, author: "agent", provenance: { actorId: "cowboy", taskId: "via:yolo" } });
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
  await make(notes.root.id, DISPATCH_SKIN);
  const dispatch = await make(notes.root.id, "Garden dispatch [page::Garden dispatch] [publish::public:garden-dispatch] [publish-skin::dispatch]\n> [!abstract] Field notes\n> The weekly news from the allotment.\n\n## This week\nThe greenhouse is ready for seedlings.\n\n## Open loops\n- [ ] Mend the gate\n- [x] Label the seed trays");
  await make(dispatch.id, "Seed report [page::Seed report] [publish::public:seed-report]\nThe peas are up. This page inherits the dispatch skin.");
  notes.overscroll = await make(notes.root.id, OVERSCROLL);
  notes.halfWritten = await make(notes.root.id, HALF_WRITTEN);
  await seedTickets(board, opts.ticketsConfig);
  notes.tickets = await make(notes.root.id, TICKETS);
  await make(notes.tickets.id, TICKET_PAGE);
  // The outliner's example extensions, in the scratch service's own user folder, read before the note is
  // written so its @tidy line is a new request.
  const examples = !!opts.ticketsConfig && !!opts.outliner && installExamples(opts.ticketsConfig, opts.outliner).length > 0;
  if (examples) await board.listExtensions(true);
  notes.omens = await make(notes.root.id, OMENS);
  // The page almanac (a scheduled program, PIE-754) writes its dated notes under: somewhere other than any note it's asked about.
  notes.almanac = await make(notes.root.id, ALMANAC);
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
  // Show the default wake, then a cap-held ask in the waiting-on-you list.
  const tidyFrom = opts.outliner ?? opts.rulesFrom;
  if (examples || (opts.ticketsConfig && tidyFrom && installExamples(opts.ticketsConfig, tidyFrom, ["tidy"]).length > 0)) {
    if (!examples) await board.listExtensions(true);
    await make(notes.root.id, "Showcase wake cap [invoke-from::showcase-seed] [invoke-to::tidy] [cap::1/day]");
    await make(notes.root.id, "Agents wake by default\n*  tidy  this  automatically\n@tidy", SEED_AGENT);
    await make(notes.root.id, HELD_ASK, SEED_AGENT);
  }
  notes.briefBefore = await make(notes.root.id, BRIEF_BEFORE, SEED_AGENT);
  notes.brief = await make(notes.root.id, briefText({ lanes, cards, hub: notes.hub, gardenView: notes.gardenView }), SEED_AGENT);
  // The example rules, last: a trigger starts from what matches when it's installed, so nothing seeded before is stamped.
  const rulesFrom = opts.outliner ?? opts.rulesFrom;
  if (opts.ticketsConfig && rulesFrom && installExamples(opts.ticketsConfig, rulesFrom, [...RULE_EXAMPLES, ...PROGRAM_EXAMPLES, ...CARD_EXAMPLES, ...FORM_EXAMPLES, ...VIEW_EXAMPLES]).length) {
    const end = Date.now() + 10_000;
    while (Date.now() < end) {
      const listed = await board.listExtensions(true).catch(() => null);
      if (listed?.rules?.some(r => r.key === "ext:done-stamp/stamp") && listed.extensions.some(e => e.id === "gallery" && e.state === "active")) break;
      await Bun.sleep(100);
    }
  }
  // A form written in each note it's used on (PIE-828): one action, ext.form.fill, asks each note for its own fields.
  notes.formReading = await make(notes.root.id, FORM_READING);
  notes.formRepairs = await make(notes.root.id, FORM_REPAIRS);
  // The gallery (PIE-827): its cards first, so the line's first run draws them.
  // Machinery (PIE-867): one question asked twice, of what people wrote and of what tools stamped for their own bookkeeping.
  const MACHINERY_QUERY = "[query::type=chore OR type=toss OR type=backup-run OR type=file-touch]";
  notes.machineryPeople = await make(notes.root.id, `${SEED.machineryPeople} [type::virtual-branch] ${MACHINERY_QUERY}`);
  notes.machineryTools = await make(notes.root.id, `${SEED.machineryTools} [type::virtual-branch] ${MACHINERY_QUERY} [machinery::only]`);
  notes.gallery = await make(notes.root.id, galleryText());
  for (const card of galleryCards()) await make(notes.gallery.id, card);
  // Marginalia (PIE-753): its kit installed as the rules are; the plan, the notebook, a highlight and an answered question.
  if (opts.ticketsConfig && rulesFrom && installExamples(opts.ticketsConfig, rulesFrom, ["marginalia", "intake"]).length) {
    const end = Date.now() + 10_000;
    while (Date.now() < end && !(await board.listExtensions(true).catch(() => null))?.extensions.some(e => e.id === "marginalia" && e.state === "active")) await Bun.sleep(100);
  }
  notes.marginalia = await make(notes.root.id, MARGINALIA_PLAN());
  notes.marginaliaNotebook = await make(notes.root.id, MARGINALIA_NOTEBOOK);
  {
    const plan = notes.marginalia, q = (words: string) => ({ quote: words, start: plan.text.indexOf(words) });
    await board.comment("showcase-highlight", plan.id, plan.revision!, "", q("before the glass warms"), { kind: "user" }, { kind: "highlight", color: "warn", tags: "watering" });
    await board.comment("showcase-whole-comment", plan.id, plan.revision!, "Keep this plan beside the seed trays.", null, { kind: "user" });
    const asked = await board.comment("showcase-ask", plan.id, plan.revision!, "Why ten days, not a week?", q("harden them off for ten days"), { kind: "user" }, { kind: "question" });
    await board.reply("showcase-ask-answer", asked.id, "Leeks are slow to toughen; ten days of the lid open a little wider each morning keeps the tips from scorching.", SEED_AGENT);
    // A note to self in the same thread: no @margin, so nothing answers it.
    await board.reply("showcase-ask-aside", asked.id, "Try the lid half open on day one and see.", { kind: "user" });
  }
  notes.recentReplies = await make(notes.root.id, RECENT_REPLIES);
  // Extensions that ship demo notes (each one's page under the Extensions hub): the notifications hub on its made-up
  // sources, pulled once so its demo boards have cards, and the runbook with its demo runbook.
  if (opts.ticketsConfig && rulesFrom && installExamples(opts.ticketsConfig, rulesFrom, DEMO_EXAMPLES).length) {
    writeFileSync(join(opts.ticketsConfig, "pi-herdr-outliner", "extensions", "notify", "config.json"), JSON.stringify({ config: {
      sources: ["gmail", "jira", "slack"], days: 3650, fixtures: { gmail: "fixtures/gmail.json", jira: "fixtures/jira.json", slack: "fixtures/slack.json" },
    } }));
    // Their pages are written once the service reads the folders (a reload answers after it).
    const end = Date.now() + 15_000;
    while (Date.now() < end) {
      const listed = await board.listExtensions(true).catch(() => null);
      if (DEMO_EXAMPLES.every(id => listed?.pages?.[id])) break;
      await Bun.sleep(100);
    }
    await board.request("extensions.schedule.run", { extension: "notify", entry: "action:pull" }).catch(() => null);
  }
  // EchoNet (PIE-779): a mini network. Plot chat starts here, a view named as an area, with a note posted to it by its
  // tag; Seed swap is a subscription to the society's area, its posts copied onto the society's source board by the
  // tosser (as the tosser writes them); the nodelist says who answered the last toss. Fictional nodes, as all of it.
  notes.echoArea = await make(notes.root.id, `${SEED.echoArea} [echo::plot.chat] [query::type=plot-post]\nThe allotment's own echo area: a view named with [echo::], and every note tagged [echo::plot.chat] posts to it. The tosser copies its posts to every outline subscribed to it.`);
  for (const [title, body, by] of ECHO_POSTS) {
    const post = await make(notes.echoArea.id, `${title} [type::plot-post] [by::${by}]\n${body}`);
    // Seen by: a whole-note mark per node it reached, as the tosser leaves them.
    for (const node of ECHO_SEEN_BY) await board.request("annotations.batch", {
      requestId: `showcase-seen-${node}-${post.id}`, author: "agent", provenance: { actorId: ECHO_TOSSER.id },
      operations: [{ operationId: "seen", type: "block-comment", input: { blockId: post.id, expectedRevision: post.revision, source: "agent", body: `also in: ${node} (${SEED.echoArea})`, properties: { kind: "echo-seen-by", "echo.node": node, via: `echonet:${node}` } } }],
    });
  }
  notes.echoPosted = await make(notes.root.id, `${SEED.echoPosted} [echo::plot.chat] [by::june]\nThree bins, by the gate. Posted to Plot chat by its tag, from wherever it's written.`);
  notes.echoSub = await make(notes.root.id, `${SEED.echoSub} [subscribe::society@box-a] [echo::seed.swap] [since::2026-03-01]\nThe allotment society's seed swap, carried here: each post on its board is a copy the tosser brought.`);
  const echoBoard = await make(notes.echoSub.id, "society@box-a [echo-source::society@box-a] [waiting::2]", ECHO_TOSSER);
  for (const c of ECHO_COPIES) await make(echoBoard.id, c, ECHO_TOSSER);
  notes.nodelist = await make(notes.root.id, ECHO_NODELIST, ECHO_TOSSER);
  for (const t of ECHO_TOSSES) await make(notes.nodelist.id, t, ECHO_TOSSER);
  notes.rules = await make(notes.root.id, RULES_NOTE);
  await make(notes.rules.id, `Headings in the committee's notes are bands [rule-name::committee-bands] [rule-under::((${notes.rules.id}))] [rule-kind::heading:2] [rule-decorate::band] [rule-pattern::stack] [rule-align::center]`);
  await make(notes.rules.id, "Mend the water butt [status::todo]\nSetting its status to done stamps the day it was done (done-stamp); setting it back takes the stamp off.");
  // The outline's own status families (PIE-819): `answered` is done here, so Dee's answered reply counts as done.
  await make(notes.rules.id, "answered [status-family::done]");
  // A rule note whose settings card (`,`) sets its fields with pickers (PIE-786), and the job it badges.
  notes.settings = await make(notes.root.id, `${SEED.settings} [rule-name::bay-badges] [rule-match::type=bay-job] [rule-decorate::badge] [rule-label::{{this.status}}] [rule-tone::accent]\nA rule note is configured, not typed: , opens its card, each field a picker (the tone's values, a query over this outline's own properties, the actions extensions offer, whose saves set it off).`);
  await make(notes.settings.id, "Turn the compost bay [type::bay-job] [status::todo]");

  // Comment threads on the shed: one open, one resolved with a reply.
  const quote = (text: string, q: string) => ({ quote: q, start: text.indexOf(q) });
  const open = await board.comment("showcase-open", notes.shed.id, notes.shed.revision!, "Is the lock still sticking? A drop of graphite might do it.", quote(notes.shed.text, "a lock that sticks in the cold"), SEED_AGENT);
  const resolved = await board.comment("showcase-resolved", notes.shed.id, notes.shed.revision!, "Which hook are the inner tubes on?", quote(notes.shed.text, "The spare inner tubes"));
  await board.reply("showcase-reply", resolved.id, "The left one; I've written it in.", SEED_AGENT);
  await board.setLifecycle(resolved.id, "resolved");

  // A comment on the whole note (PIE-846), no passage: it sits at the top of the note, a picture in it.
  await board.comment("showcase-whole-note", notes.wholeNote.id, notes.wholeNote.revision!, WHOLE_NOTE_COMMENT(), null, SEED_AGENT);

  // Attention, not tickets (PIE-791): a note whose margin holds one current comment, one kept with its TL;DR (the
  // card's face), and one seen (on the earlier shelf, out of the margin).
  notes.attention = await make(notes.root.id, `${SEED.attention}\n\nJune pumps the water butt on Mondays, Sam on Thursdays.\nThe hose reel sticks: oil it in spring.\nThe tap washer was replaced in March.\n\nIn a dry week both of us water the beds on Saturday morning.\nThe rota's kept on the shed door, written in pencil.\nAsk before borrowing the long hose.`);
  const at = notes.attention;
  await board.comment("showcase-attention-open", at.id, at.revision!, "Could we swap Thursdays in August?", quote(at.text, "Sam on Thursdays"));
  const kept = await board.comment("showcase-attention-kept", at.id, at.revision!, "Which oil? The bike oil gums it up.", quote(at.text, "oil it in spring"));
  await board.reply("showcase-attention-kept-reply", kept.id, "Sewing machine oil: thin, and it doesn't gum.", SEED_AGENT);
  await board.setLifecycle(kept.id, "kept");
  await board.tldr(kept.id, USER, "Sewing machine oil on the hose reel, each spring.");
  const seen = await board.comment("showcase-attention-seen", at.id, at.revision!, "Who has the spare washers?", quote(at.text, "tap washer was replaced"));
  await board.setLifecycle(seen.id, "seen");

  // Re-read what later writes changed (the shed gained comments and children).
  for (const k of Object.keys(notes) as SeedName[]) notes[k] = (await board.get(notes[k].id)) ?? notes[k];
  await seedAccess(board);
  return { notes, lanes, cards, chores, race: race.race, comments: { open: open.id, resolved: resolved.id, resource: resourceThread } };
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
  // The thread's reply the panel opens on sits deeper than the root's children (PIE-944): found down the thread.
  for (let level = notes.thread ? [notes.thread] : []; level.length && !notes.threadHere;) {
    level = (await Promise.all(level.map(m => board.children(m.id)))).flat();
    const hit = level.find(k => titleOf(k) === SEED.threadHere);
    if (hit) notes.threadHere = (await board.get(hit.id)) ?? hit;
  }
  // The routing section's shelf, tin and recipe sit under its note (PIE-1010).
  if (notes.routing) {
    const under = await board.children(notes.routing.id);
    for (const name of ["recipeShelf", "seedTin", "pickled"] as const) {
      const hit = under.find(k => titleOf(k) === SEED[name]);
      if (hit) notes[name] = (await board.get(hit.id)) ?? hit;
    }
  }
  // The script examples' two notes the section opens on sit beneath the examples' note.
  if (notes.scriptExamples) {
    const under = await board.children(notes.scriptExamples.id);
    for (const name of ["exampleOrder", "exampleGame"] as const) {
      const hit = under.find(k => titleOf(k) === SEED[name]);
      if (hit) notes[name] = (await board.get(hit.id)) ?? hit;
    }
  }
  // The fixture of "Notes that read themselves" (PIE-533) sits under its project, so its `parent` has a project to read.
  if (notes.ventProject) {
    const hit = (await board.children(notes.ventProject.id)).find(k => titleOf(k) === SEED.ventRail);
    if (hit) notes.ventRail = (await board.get(hit.id)) ?? hit;
  }
  return { root, notes };
}

// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { unsent } from "../src/draft-session";
import { osc52 } from "../src/surface/selection";
import { surfaceBg } from "../src/style";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { GRAPH_KINDS } from "../src/graphs";
import { liveBoard } from "../src/live";
import { Help, MainMenu } from "../src/screens";
import { CHORE_QUEUE, FIGURE_KINDS, LABELS_BEFORE, LANES, MARKDOWN_KINDS, loadShowcase, RECENT_FILES, RECENT_SESSION, REMOTE_CLIENT, REMOTE_LINE, SEED, seedShowcase, type Seeded } from "../src/showcase/seed";
import { gardenRound, SECTIONS, Showcase, SHOWCASE_ACTIONS } from "../src/showcase/showcase";
import { SocketBoard } from "../src/socket";
import { drawNote } from "../src/notes-cli";
import { C, fg } from "../src/style";
import { jevOff } from "../src/surface/completer";
import { hyperOn, useHyper } from "../src/hyper";
import { KeyDecoder, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

test("the README's showcase says what SECTIONS registers by key, never a count; the action's summary names every key", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  expect(readme).toContain("act section name=<n|key>");
  expect(readme).not.toMatch(/live, in [a-z-]+ sections|name=<1-\d+\|key>/);
  const summary = SHOWCASE_ACTIONS.list().find((a: any) => a.name === "section")!.summary;
  expect(summary).toContain(`name=<1-${SECTIONS.length}>`);
  for (const s of SECTIONS) expect(summary).toContain(s.key);
  // The map rows without a section are the ones the README names.
  const grammar = readFileSync(join(import.meta.dir, "../docs/UI-GRAMMAR.md"), "utf8");
  const map = grammar.slice(grammar.indexOf("## Before adding a feature"), grammar.indexOf("## TL;DR"));
  const rows = map.split("\n").filter(l => /^\| [a-z]/.test(l) && !l.startsWith("| The feature"));
  expect(rows.length - SECTIONS.length).toBe(6);
  expect(readme).toContain("its list-picker and line-input rows (in the panes section's ^W P and ^W r,\nthe board's g m s), its elements and reading-ruler row (PIE-441) and its terminal-output row (PIE-510");
});

test("the help screen says which screens write to the outline, not that the door is read-only", () => {
  const text = new Help().render({ t: { cols: 140 } } as any).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
  expect(text).not.toContain("Read-only");
  expect(text).toContain("Kanban, Quay, Desk, Today, Waiting, Claude·now, Showcase and the message reader write");
  expect(text).toContain("recorded as you, or as the agent that did them");
});

test("the showcase has every ::graph-* kind the door draws: the figures note the first ones, the Markdown figures and keys notes the newer", () => {
  expect([...FIGURE_KINDS, ...MARKDOWN_KINDS, "keys"].sort() as string[]).toEqual([...GRAPH_KINDS].sort());
});

describe.skipIf(!outliner)("the showcase seed", () => {
  const scratch = new Scratch();
  let board: SocketBoard, seeded: Seeded;
  beforeAll(async () => {
    await scratch.start();
    seeded = await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    await board.info();
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("every seeded note is found by title under the marked root", async () => {
    const s = await loadShowcase(board);
    expect(s).not.toBeNull();
    expect(Object.keys(s!.notes).sort()).toEqual(Object.keys(SEED).sort());
    expect((await board.roots()).filter(r => r.props.type === "showcase").length).toBe(1);
  });

  test("the remote writes note (PIE-615): a remote client's patch at propose is a proposal under it, its comment a thread, the note unchanged", async () => {
    const note = seeded.notes.remoteWrites;
    const now = (await board.get(note.id))!;
    expect(now.text).toContain(REMOTE_LINE);
    const proposal = (await board.children(note.id)).find(m => m.props.type === "draft-proposal");
    expect(proposal?.text).toContain("from @mcp:chat.example.test: not applied, because its writer may propose changes here, not make them");
    expect(now.text).toContain(`!((${proposal!.id}))`);
    expect((await board.comments(note.id))).toEqual([expect.objectContaining({ body: "Was that the peat-free kind?", quote: "two bags of compost", open: true })]);
  });

  test("a board hub whose lanes are saved views, with cards in every stage", async () => {
    const lanes = (await board.children(seeded.notes.hub.id)).filter(k => k.props.type === "virtual-branch");
    expect(lanes.map(l => l.text.split(" [")[0])).toEqual([...LANES]);
    const counts: Record<string, number> = {};
    for (const l of lanes) { const r = await board.readSavedView(l.id); expect(r?.status).toBe("ready"); counts[l.text.split(" [")[0]!] = r!.blocks.length; }
    expect(counts).toEqual({ Queued: 2, Doing: 2, Review: 1, Done: 1 });
    // Roadmap items through the allocator: work-ids, under the project's work queue.
    expect(seeded.cards.map(c => c.props["work-id"])).toEqual(["HOME-001", "HOME-002", "HOME-003", "HOME-004", "HOME-005", "HOME-006"]);
    expect(seeded.cards.every(c => c.parentId === seeded.notes.queue.id)).toBe(true);
    const garden = await board.readSavedView(seeded.notes.gardenView.id);
    expect(garden?.blocks.map(b => b.text.split(" [")[0])).toEqual(expect.arrayContaining(["Water the beans", "Turn the compost", "Net the brassicas"]));
  });

  test("the relation atoms: under:, NOT and title~ in a live figure's query (PIE-554)", async () => {
    const choresId = seeded.notes.chores.id;
    expect(seeded.notes.figures.text).toContain(`query: "under:((${choresId})) type=chore NOT stage=done NOT title~hob"`);
    // The service parses the expression, as a live figure asks it (src/live.ts); board.query splits plain clauses itself.
    const ask = async (expression: string) => board.toMsgs((await board.request<{ blocks: any[] }>("blocks.query", { query: { expression, limit: 50 } })).blocks);
    const titles = (await ask(`under:((${choresId})) type=chore NOT stage=done NOT title~hob`)).map(b => b.text.split(" [")[0]);
    expect(titles.sort()).toEqual(["Empty the food caddy", "Net the brassicas", "Turn the compost"]);
    // links: reads the reference index: the notebook links the shed page.
    expect((await ask(`links:[[${SEED.shed}]] #nothing OR links:[[${SEED.shed}]]`)).map(b => b.id)).toContain(seeded.notes.notebook.id);
  });

  test("the notebook: callouts, links and soft links, folds, a literal region, a tilde fence, a transclusion, properties in every scope", async () => {
    const t = seeded.notes.notebook.text;
    for (const piece of ["> [!note] Gate code", "> [!warning]- Slugs", `[[${SEED.shed}]]`, `((${seeded.cards[3]!.id}|the kettle job))`, "HOME-001 is the gate latch",
      "## Beds", "  - runner beans", `((${seeded.cards[3]!.id}|the kettle (the dented one)))`, "<!-- literal -->", "<!-- /literal -->", "~~~text", `!((${seeded.notes.whiteboard.id}))`])
      expect(t).toContain(piece);
    const scope = async (key: string) => (await board.propertyTokens(seeded.notes.notebook.id, key)).tokens.map(x => x.scope);
    expect(await scope("season")).toEqual(["block"]);
    expect(await scope("harvest")).toEqual(["line"]);
    expect(await scope("level")).toEqual(["inline"]);
    // The literal region's and the ~~~ fence's properties are text, not properties.
    expect(await scope("mode")).toEqual([]);
    // The reader draws the ~~~ fence as code, as the service reads it: its **bold** as typed, in the code box.
    const drawn = (await drawNote(board, seeded.notes.notebook.id, 120))!.map(plain);
    expect(drawn.some(l => l.includes("│ **Not bold**, [mode::quiet] and #quiet are code here"))).toBe(true);
    // A label with parentheses is read whole, as the service reads it: the link is "the kettle (the dented one)".
    expect(drawn.some(l => l.includes("A label can hold parentheses: the kettle (the dented one) needs a new lid."))).toBe(true);
    expect((await board.backlinks(seeded.notes.shed.id)).sources.map(b => b.blockId)).toContain(seeded.notes.notebook.id);
    expect((await board.resolvePage(SEED.shed)).status).toBe("resolved");
  });

  test("comment threads, open and resolved; children; every figure kind", async () => {
    const threads = await board.comments(seeded.notes.shed.id);
    expect(threads.map(c => [c.open, c.replies.length])).toEqual([[true, 0], [false, 1]]);
    expect((await board.children(seeded.notes.shed.id)).filter(k => !k.props.type?.startsWith("annotation")).map(k => k.text.split("\n")[0])).toEqual(["Puncture kit", "Chain oil"]);
    for (const k of FIGURE_KINDS) expect(seeded.notes.figures.text).toContain(`::graph-${k}\n`);
    expect(seeded.notes.figures.text).toContain(`view: ((${seeded.notes.gardenView.id}))`);
    for (const k of MARKDOWN_KINDS) expect(seeded.notes.markdownFigures.text).toContain(`::graph-${k}\n`);
    expect(seeded.notes.keys.text).toContain("::graph-keys\n");
    // The figure block it transcludes: a note that is a figure, its rows its child bullets.
    const block = (await board.children(seeded.notes.markdownFigures.id)).find(k => k.text.startsWith("Bean rows\n::graph-timeline"))!;
    expect(seeded.notes.markdownFigures.text).toContain(`!((${block.id}))`);
    expect((await board.children(block.id)).map(k => k.text)).toEqual(["Apr: sow under glass", "**May: plant out** — when the nights are warm", "*Jun: first picking*"]);
    // The chore queue figure sorts by a property: ranks as numbers, the chore without one last.
    const drawn = (await drawNote(board, seeded.notes.figures.id, 120))!.join("\n");
    const queue = drawn.slice(drawn.indexOf("CHORE QUEUE"));
    const at = CHORE_QUEUE.map(t => queue.indexOf(t));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("every figure fits its width (PIE-581): the figures note drawn at 40, 80 and 160 columns has no line past the edge", async () => {
    for (const w of [40, 80, 160]) {
      const lines = (await drawNote(board, seeded.notes.figures.id, w))!.map(plain);
      const wide = lines.filter(l => Bun.stringWidth(l) > w);
      expect(wide, `at ${w}: ${wide.slice(0, 3).join(" | ")}`).toEqual([]);
      // The comparison kinds drew with the seeded data, not a refusal.
      // (A narrow frame cuts a long title with …, so the stems.)
      for (const title of ["HOUSE JOBS BY PRIORITY", "HOUSE JOBS BY ARC", "RAISED BEDS OR GROW BAGS", "CHORES BY AREA", "STARTUP BUDGET"]) expect(lines.join("\n")).toContain(title);
      expect(lines.join("\n")).not.toMatch(/name the two properties|no (points|cells|flows|rows):/);
    }
    // The live data drew: the quadrant placed every house job, the matrix's totals are the stage counts, the flow
    // counted the chores by area, and the budget meter's last row is over its limit.
    const at80 = (await drawNote(board, seeded.notes.figures.id, 80))!.map(plain).join("\n");
    expect(at80).toMatch(/HOUSE JOBS BY PRIORITY AND STAGE[\s\S]*live · 6 results/);
    expect(at80).toMatch(/HOUSE JOBS BY ARC AND STAGE[\s\S]*\n ┊\s+2\s+1\s+2\s+1\s+┊/);
    expect(at80).toMatch(/CHORES BY AREA AND STAGE[\s\S]*garden\s+3 █/);
    expect(at80).toMatch(/with the barrel\s+█+┃\s+181 \/ 150 ms\s+┊\n ┊\s+31 ms over/);
  }, 20_000);

  test("a figure can be linked to (PIE-580): the service slices the whole block for an anchor alone after its ::", async () => {
    const read = await board.readFragment(seeded.notes.figures.id, "budget");
    expect(read.status).toBe("resolved");
    if (read.status !== "resolved") return;
    const lines = seeded.notes.figures.text.split("\n");
    expect(lines[read.fragment.startLine]).toBe("::graph-meter");
    expect(lines[read.fragment.endLine]).toBe("::");
    expect(lines[read.fragment.endLine + 1]).toBe("^budget");
    expect(read.fragment.text).toContain("title: Startup budget");
  });

  test("files a session touched (PIE-602): a made-up session's branch, day › project › session › one block per file, each naming its file", async () => {
    const [day] = await board.children(seeded.notes.recentFiles.id);
    const [project] = await board.children(day!.id);
    const [session] = await board.children(project!.id);
    expect([day!.props["file-day"], project!.props["file-project"], session!.props["file-session"]]).toEqual(["2026-03-11", "allotment", RECENT_SESSION]);
    const files = await board.children(session!.id);
    expect(files.map(f => [f.props.file, f.props.type, f.props.touches])).toEqual(RECENT_FILES().map(f => [f.file, "file-touch", String(f.touches)]));
    for (const f of RECENT_FILES()) expect(existsSync(f.file)).toBe(true);
  });

  test("heading styles (PIE-599): banded wide, as written narrow, nothing past the edge; the outline's own style changes the look with no door change", async () => {
    const drawn = async (w: number) => (await drawNote(board, seeded.notes.headings.id, w))!.map(plain);
    for (const w of [40, 80, 160]) {
      const lines = await drawn(w), text = lines.join("\n");
      const wide = lines.filter(l => Bun.stringWidth(l) > w);
      expect(wide, `at ${w}: ${wide.slice(0, 3).join(" | ")}`).toEqual([]);
      expect(text).not.toMatch(/\[heading::|\[heading-|\[rule::/);
      // Greenhouse's margin "2 0 1": two blank rows above its band (or heading), kept narrow too.
      const gh = lines.findIndex(l => /Greenhouse/.test(l));
      expect(gh, `at ${w}: Greenhouse`).toBeGreaterThan(2);
      const bandTop = gh - (w === 40 ? 0 : 1);
      expect(lines.slice(bandTop - 2, bandTop).map(l => l.trim()), `at ${w}: the margin above`).toEqual(["", ""]);
      if (w === 40) {
        for (const h of ["# Your calls", "## The plot", "## Beds", "### Water butts", "## Seed order", "## Compost", "## Odd jobs", "## Tool shed", "## Plain"]) expect(lines.map(l => l.trim())).toContain(`▾ ${h}`);
        expect(lines.map(l => l.trim()).filter(l => l === "---").length).toBe(2);
      } else {
        expect(text).toMatch(/[▓▒░]{3}.*Y O U R   C A L L S.*[▓▒░]{3}/);
        expect(text).toMatch(/THE PLOT +▓/);
        expect(text).toMatch(/─  (?:▾ )?COMPOST  ─/);
        // The styled rule fades in from both edges; the plain one is as written.
        expect(lines.some(l => /^ ?▓.*▓\s*$/.test(l) && !/[A-Za-z]/.test(l))).toBe(true);
        expect(text).toContain("▾ ## Plain");
        // One heading's own fields: Odd jobs on the dots band, Tool shed on one row of uptime bars, right-aligned.
        expect(text).toMatch(/^ +▾ Odd jobs +·/m);
        expect(text).toMatch(/[▓▒░·].* ▾ Tool shed\s*$/m);
        expect(text).not.toContain("## Beds");
      }
    }
    // The plot style is declared on a line of the note (drawn as what it declares, not its tokens): dots on the top
    // row. Restyled to the rule pattern there, the seed order is drawn on a rule band, by the same door.
    expect((await drawn(100)).join("\n")).toContain("style plot  dots · 2 rows · left/top · green");
    const before = (await drawn(100)).find(l => l.includes("Seed order"))!;
    expect(before).toMatch(/Seed order.*·/);
    const style = seeded.notes.headings.id;
    const { revision, tokens } = await board.propertyTokens(style, "heading-pattern");
    expect(tokens[0]!.value).toBe("dots");
    await board.patchProperties(style, revision, [{ op: "replace", ordinal: tokens[0]!.ordinal, value: "rule" }], { kind: "user" });
    // A door that connects now (as `ep0ch show` does) asks for the outline's styles and draws the new look.
    const fresh = new SocketBoard(scratch.sock);
    try {
      await fresh.info();
      expect((await drawNote(fresh, seeded.notes.headings.id, 100))!.map(plain).join("\n")).toMatch(/Seed order  ═{20,}/);
    } finally { fresh.close(); }
  }, 20_000);

  test("seeding twice is refused", async () => {
    await expect(seedShowcase(board)).rejects.toThrow(/already has a showcase/);
  });
});


describe.skipIf(!outliner)("the showcase screen", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, sc: Showcase, seeded: Seeded;
  let key: (k: Key) => void = () => {};
  const written: string[] = [];
  let painted: string[] = [];
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const screen = () => sc.render(app).lines.map(plain).join("\n");
  const S = () => sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    // e arms the edit here, as in the door (test/preload.ts turns it off): ⏎ opens it.
    process.env.EP0CH_EDIT_ARM = "60000";
    await scratch.start();
    seeded = await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write(s: string) { written.push(s); }, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    // As the door does at start: the extensions and rules the service lists (the seed installed the example rules).
    await app.loadExtensions(true);
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; process.env.EP0CH_EDIT_ARM = "off"; });

  // What each section's own part draws, once it has read the outline.
  const marks: Record<string, string[]> = {
    note: ["Allotment notebook", "the same NoteSurface, as the BBS reader · src/screens.ts", "Subj: Allotment notebook", "↗"],
    // The detail screen spec on the notebook: the detail tile's own frame and keys around the same surface.
    detail: ["─ detail", "Allotment notebook", "Our plot at the Elm Row allotments.", "p follow · [ ] elements"],
    // A long note to scroll past the end of (PIE-622), a short one beside it.
    scroll: ["The long row of runner beans", "End (or G) goes to the last line", "Bike shed"],
    // The list scrolls: the note set's header and the registry are on screen; the desk set is further down.
    actions: ["NOTE_ACTIONS · src/surface/note.ts", "the action registry · src/surface/actions.ts"],
    edit: ["Kitchen whiteboard", "properties · 6"],
    // The finding note: what / (the power bar's notes scope) finds, typos and all.
    search: ["Finding things in the house notes", "Press / (on the river, g) and type"],
    // The draft session: an edit open on the left, a comment being written on the right.
    drafts: ["editing · Kitchen whiteboard", "comment · Allotment notebook", "[add them]"],
    // Three kept edits against notes that moved on: one with a new line, one the note already has (settled), one old (a chip).
    kept: ["Greenhouse watering rota", "from your edit yesterday", "[add them]", "was already in the note", "1 old edit"],
    // An edit with a whole document pasted in by mistake, one step, and the page token selected with its [copy].
    undo: ["editing · Jar labels", "pasted 42 lines · ctrl+z undoes", "[copy]"],
    panes: ["outline", "children", "│ 4 activity", "Kitchen sink"],
    folds: ["outline", "children", "◂", "▾"],
    screens: ["daily brief · 2026-03-11", "2 of 2 briefs"],
    kinds: ["tile kinds", "tree ^W o t", "backlinks ^W o l"],
    terminal: ["a terminal tile: sh in a pty the door owns", "shell"],
    drawer: ["the kettle: a terminal tile to put in your drawer", "kettle"],
    // A fake deploy reporting its status (OSC 7501) beside the waiting-on-you list that follows it.
    status: ["a fake deploy, saying what it does with OSC 7501", "waiting on you"],
    changes: ["what changed", "garden-agent edited the three log notes"],
    // Three readers at the three levels of what an agent may do to a tile: the chips on the edit and hands-off tiles.
    agents: ["say what an agent may do to each tile", "✎ agents: edit only", "⊘ agents: hands off"],
    preview: ["preview · tree", "outline"],
    "reader-modes": ["outline", "· held", "· pinned"],
    screen: ["board ·", "· lanes", "preview · board"],
    spine: ["Queued", "Doing", "Review", "Done", "HOME-003"],
    entity: ["Bike shed", "The pump's spare valves are on the kitchen whiteboard.", "↓ children (2)", "Puncture kit", "← backlinks (", "resources (1)"],
    "links-open": ["Bike shed", "links · Bike shed", "preview"],
    // The swap thread, its links with every group, and the same tile with Children alone (its replies).
    children: ["Seed swap thread", "links · Seed swap thread", "children · Seed swap", "↓ children (4)", "Ana: runner beans to swap"],
    // The day's plan with its outbox: the waiting letters listed, the first one previewed beside the list.
    "links-block": ["Plan for Saturday", "OUTBOX", "Ask Ana about the bean seed", "3 matches", "⏎ in"],
    presence: ["who's online", "last callers · live"],
    live: ["GARDEN CHORES (LIVE QUERY)", "live · 3 results", "HOUSE JOBS BY ARC (LIVE)"],
    tabs: ["PLOT JOBS", "doing 2 · review 1 · validate 0 · done 1 · queued 2", "≡ compact"],
    "resource-comments": ["bed-plan.md", "Net the brassicas before the pigeons find them.", "1 open comment"],
    projection: ["Jira ACME-12 · Rollout checklist for the vendor switch", "Jira ACME-14 · Label printer drops the last line", "Jira · ambiguous: ACME-20, ACME-21", "Jira ACME-30 · not registered", "can't fetch: item was not found"],
    // Without the outliner's examples installed (this scratch seeds with the tickets only), the lines are properties.
    extensions: ["Omens for the allotment week", "extensions"],
    // The outliner's example rules, installed by the seed: meeting-card's card, shout's band, the job done-stamp watches.
    rules: ["Allotment committee, Saturday", "[meeting]", "CLOSE THE COLD FRAME TONIGHT", "Mend the water butt"],
    selection: ["Lentil soup", "Drag across these lines"],
    service: ["views.read ((Garden chores))", "ready · 3 block(s)", "references.backlinks (Bike shed)"],
    // This door runs in its own terminal (the test's App), so the section says so; in a session it lists the terminals.
    session: ["this door runs in its own terminal (--no-daemon)", "session"],
    // Obsidian's examples, nested three deep; the right reader declares a type of the outline's own.
    callouts: ["Callouts, as Obsidian writes them", "Can callouts be nested?", "Yes!, they can.", "Recipe callouts"],
    // This test's terminal has no Kitty graphics: each image's line says what it is, with its controls.
    images: ["Pictures of the plot", "▀ header allotment-dusk.jpg", "▣ seed-packet.webp · no Kitty graphics in this terminal", "[−][+] [◂][▸] [▀]", "▣ allotment-notice.png"],
    // A note whose first block is a picture: scrolled, the header takes it as its background (PIE-598).
    hero: ["An evening on the plot", "▣ evening-beds.jpg", "hero-focus"],
    // The reader's header (PIE-657): the title in it, the dim line, the old header written out to compare.
    title: ["A title you can find", "Before:", "3 note detail · A title you can find"],
    // The Markdown figures on the left (a decision first), the keys read from the registry on the right.
    figures: ["Figures, written in Markdown", "SQUASH BEDS", "Raised beds", "The reader's keys", "[e]"],
    // A guide note with a [[page]] nobody wrote yet, for ctrl+n, the offer and the page title fill.
    newnotes: ["New notes from anywhere", "Seed swap ledger", "ctrl+n"],
    // A reader and a terminal whose program asked for the mouse, each with its ⋯.
    menu: ["Allotment notebook", "this program asked for the mouse", "⋯"],
    wkeys: ["Allotment notebook", "Bike shed"],
    // A blank screen: its rows, each a first step.
    made: ["A blank screen. Start it with a tile here:", "t  the outline", "o  open a screen…"],
    // Two readers to zoom one of, a link to light and a menu to open: the Esc rule's three nested things.
    esc: ["Allotment notebook", "Bike shed"],
    // The shed note folded to a spine (the keys on it) beside the notebook: a key the spine refuses says why on its frame.
    refusals: ["Allotment notebook", "Bike shed"],
    // One note in two readers: the wide one bands its headings, the narrow one draws them as written.
    headings: ["Headings and dividers", "▾ ## Beds", "Water butts"],
    // The Spacing lab page in its look, the tune inspector beside it, the links tile, the Looks lab note that declares it.
    style: ["Spacing lab", "tune · lab", "list.gap", "Looks lab"],
    // The component library on the heading styles' page: its tabs, its parts, the minimal example.
    library: ["Heading styles", "1 overview", "Minimal example"],
    // The outline beside a reader over two details, the second folded to a spine: the tiles the power bar lists as a tree.
    bar: ["outline", "Kitchen whiteboard", "Bike shed"],
    // A reader and a shell for a hyper chord to reach the door from, and the part's line.
    hyper: ["Allotment notebook", "a terminal tile: with the layer on", "reach the door"],
  };

  test("one section per reuse-map row, in the map's order, each labelled with its part and file, drawn by the part", async () => {
    expect(SECTIONS.map(s => s.key)).toEqual(Object.keys(marks));
    for (let i = 0; i < SECTIONS.length; i++) {
      if (i < 10) ch(i === 9 ? "0" : String(i + 1)); else ch("j");   // past ten: the next one down
      const s = SECTIONS[i]!;
      await until(() => marks[s.key]!.every(m => screen().includes(m)), `section ${s.key}: ${marks[s.key]!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
      const text = screen();
      expect(text).toContain(`${i + 1} · ${s.need} · ${s.part}`.slice(0, 120));
      expect(text).toContain(s.files.slice(0, 60));
      expect(S().focus).toBe("index");
    }
  }, 60_000);

  test("the note section shows one reader (PIE-426): the BBS message reader is the same surface, not a parallel version", async () => {
    ch("1");
    await until(() => marks.note!.every(m => screen().includes(m)), "the note section");
    const stage = screen();
    expect(stage).not.toContain("parallel version");
    expect(stage).not.toContain("BBS Reader");
  });

  test("the index works by mouse: a click picks a section; a click in the part gives it the keys, esc gives them back", async () => {
    const spine = SECTIONS.findIndex(s => s.key === "spine");
    press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + spine * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + spine * 2 });
    expect(S().sel).toBe(spine);
    const r = S().stageRect;
    press({ kind: "mouse", action: "down", button: 0, x: r.col + 5, y: r.row + 5 }); press({ kind: "mouse", action: "up", button: 0, x: r.col + 5, y: r.row + 5 });
    expect(S().focus).toBe("stage");
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
  });

  test("editing works in a section, by keys: e, type, ctrl+s writes to the showcase outline", async () => {
    ch("5"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // e arms the edit (edit.arm): the reader's frame asks, nothing opens until ⏎.
    ch("e");
    const desk = () => S().stages.get(4).top;
    expect(screen()).toContain("✎ edit? ");
    expect(desk().describe().panes[0].editing).toBeFalsy();
    press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    for (let i = 0; i < 5; i++) press({ kind: "pgdn" });            // to the last line, however it wraps
    press({ kind: "end" });
    for (const c of " Mind the oven.") ch(c);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !desk().describe().panes[0].editing?.dirty, "the save", 5000);
    const wb = await board.get(seeded.notes.whiteboard.id);
    expect(wb!.text.split("\n").at(-1)).toContain("Mind the oven.");
    // Esc backs out through the part (a draft first, if still open), then to the index; never past it.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("agents: act shows a section, never while the person is in one, and reaches the section's own actions", async () => {
    ch("1"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // The person is working in section 1: an agent can't move them out of it (once they've paused, too).
    (app as any).lastInput = 0;
    await expect(app.act({ action: "section", args: { name: "selection" }, as: "test-agent" })).rejects.toThrow(/the person is in section 1/);
    expect(S().focus).toBe("stage");
    expect(S().sel).toBe(0);
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
    (app as any).lastInput = 0;
    const r = await app.act({ action: "section", args: { name: "selection" }, as: "test-agent" }) as any;
    expect(r).toEqual({ section: SECTIONS.findIndex(s => s.key === "selection") + 1, key: "selection" });
    expect(S().focus).toBe("index");
    expect((app as any).message).toContain(`an agent (test-agent) showed section ${SECTIONS.findIndex(s => s.key === "selection") + 1}`);
    const listed = (app.actions() as any).actions.map((a: any) => a.name);
    expect(listed).toContain("section");
    expect(listed).toContain("select");
    // A note action runs in the section's reader, attributed to the agent.
    const sel = await app.act({ action: "select", args: { text: "red lentils" }, as: "test-agent" }) as any;
    expect(JSON.stringify(sel)).toContain("red lentils");
    expect(app.describe()).toMatchObject({ screen: "showcase", state: { kind: "showcase", section: { key: "selection" }, focus: "index" } });
    await expect(app.act({ action: "section", args: { name: "nope" }, as: "test-agent" })).rejects.toThrow(/no section nope/);
    // The shell's actions stay the App's on the showcase: the stage takes only its own (PIE-514).
    expect(await app.act({ action: "screen.list", as: "test-agent" })).toMatchObject({ stack: expect.any(Array) });
  }, 20_000);

  test("a remote MCP client's write is said on the status line with the note's title (PIE-615)", async () => {
    const { actorOf, applyWrite } = await import("../src/mcp-writes");
    const note = seeded.notes.remoteWrites;
    await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Compost delivered.", requestId: "showcase-flash" } }, { level: "full", actor: actorOf(REMOTE_CLIENT), uri: id => id });
    await until(() => String((app as any).message ?? "").includes("chat.example.test"), "the remote write said", 8000);
    await until(() => String((app as any).message).includes("commented on “Remote writes"), "the comment said by its note", 8000);
    expect((app as any).message).toBe("chat.example.test commented on “Remote writes and the netmail queue” · a remote MCP write");
    // A persona within its principal is said with it (PIE-679).
    await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Seeds ordered.", requestId: "showcase-persona" } }, { level: "full", actor: actorOf({ sub: "stdio", clientId: "claude-code" }, { EP0CH_MCP_PERSONAS: "claude-code@float-2=loki" }, "float-2"), uri: id => id });
    await until(() => String((app as any).message).startsWith("loki (claude-code@float-2) commented on"), "the persona said with its principal", 8000);
  });

  test("the headings section (PIE-599): the wide reader bands its headings, the narrow one beside it draws them as written; ) stops on a styled heading and f folds its section", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "headings" }, as: "test-agent" })).toMatchObject({ key: "headings" });
    await until(() => screen().includes("Water butts") && screen().includes("▾ ## Beds"), "both readers on the headings note", 8000);
    expect(screen()).toMatch(/[▓▒░]{3}.*▾ Y O U R   C A L L S.*[▓▒░]/);
    // The person goes in: ( ) in the wide reader stops on the first heading, f folds its section there only.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch(")");
    ch("f");
    await until(() => /▸ Y O U R   C A L L S · \d+ lines? folded/.test(screen()), "the first heading folded", 5000);
    expect(screen()).toContain("▾ # Your calls");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("the style section (PIE-673): the lab page in its named style; the tune inspector shows where each value comes from, a nudge through act draws at once and saves onto the style note that set it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "style" }, as: "test-agent" })).toMatchObject({ key: "style" });
    await until(() => marks.style!.every(m => screen().includes(m)) && /· · · ·/.test(screen()), "the lab, its dividers and the inspector", 8000);
    expect(screen()).toMatch(/list\.gap +1 +← style lab/);
    const gap = () => { const l = screen().split("\n"); return l.findIndex(x => x.includes("Chillies in")) - l.findIndex(x => x.includes("Tomatoes on")); };
    const before = gap();
    // An agent's nudge goes where the value is set (the lab style), drawn in the next frame, said on the screen.
    expect(await app.act({ action: "tune.nudge", args: { row: "list.gap", by: 1 }, tile: "tune", as: "test-agent" })).toMatchObject({ value: "2", at: expect.stringContaining("style lab") });
    expect(gap()).toBe(before + 1);
    expect(screen()).toMatch(/list\.gap +2 +● style lab/);
    // Saved: onto the Looks lab note, which every door reads; then put back, so the outline is as seeded.
    expect(await app.act({ action: "tune.save", tile: "tune", as: "test-agent" })).toMatchObject({ saved: true });
    expect((await board.get(seeded.notes.looksLab.id))!.text).toMatch(/\[style\.(narrow\.)?list\.gap::2\]/);
    expect(await app.act({ action: "tune.set", args: { row: "list.gap", value: "1" }, tile: "tune", as: "test-agent" })).toMatchObject({ value: "1" });
    expect(await app.act({ action: "tune.save", tile: "tune", as: "test-agent" })).toMatchObject({ saved: true });
    // The person's keys: into the stage, 2 to the inspector, + nudges the measure a step (4 columns), u takes it back.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("2");
    ch("+");
    await until(() => /measure +68 +● style lab/.test(screen()), "the measure nudged by the person's +", 5000);
    ch("u");
    await until(() => /measure +64 +← style lab/.test(screen()), "the nudge taken back", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 30_000);

  test("the style section's surfaces and frames (PIE-675): a raised tile with a violet bar, a box's stripe, a round amber frame with ✦ dividers, a row taken back and the header's picture moved, all through act; the drawing is never copied", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "style" }, as: "test-agent" })).toMatchObject({ key: "style" });
    await until(() => screen().includes("Broad beans") && screen().includes("╭"), "the lab's boxes", 8000);
    const raw = () => sc.render(app).lines;
    const labPane = () => S().stage(SECTIONS.findIndex(s => s.key === "style")).top.pane("lab") as any;
    const peekHeader = () => labPane()?.surface.headerBackdrop() as { backdrop: { image: string; focus?: { x: number; y: number } } | null } | undefined;
    const rows = screen().split("\n");
    // The second box: a round frame round its text, its list's divider a ✦ row centred in the gap, all drawn.
    const beans = rows.findIndex(l => l.includes("Broad beans")), runner = rows.findIndex(l => l.includes("Runner beans"));
    expect(rows[beans]).toMatch(/│ +∙ Broad beans +│/);
    expect(rows.slice(beans + 1, runner).some(l => /(✦ ){4}/.test(l))).toBe(true);
    expect(rows.slice(0, beans).some(l => /╭─+╮/.test(l))).toBe(true);
    // Their surfaces, theme roles drawn dark: the box's sunken one inside its frame, the lab tile's raised one under its text.
    const sunken = surfaceBg("sunken", 2), raised = surfaceBg("raised", 2);
    expect(raw()[beans]).toContain(sunken);
    // The lab tile's violet bar down its left side (edge=bar, tone=violet from the lab style).
    const lab = rows.findIndex(l => l.includes("This page is drawn by the lab style"));
    expect(raw()[lab]).toContain(raised);
    expect(rows[lab]).toMatch(/^.*▌/);
    // The inspector lists the new values and where each comes from, a swatch beside a surface's.
    await until(() => /bg +raised .*← style lab/.test(screen()), "the bg row", 5000);
    const tunePane = () => S().stage(SECTIONS.findIndex(s => s.key === "style")).top.pane("tune") as any;
    expect(tunePane().describe(S().stage(SECTIONS.findIndex(s => s.key === "style")).top).values).toMatchObject({ "header.image": { value: "evening-beds.jpg", from: "style lab" }, "header.image.y": { value: "-15" } });
    // An agent sets the zebra's surface, then takes the tile's bg back to the level under it: the built-in none.
    expect(await app.act({ action: "tune.set", args: { row: "bg", value: "amber" }, tile: "tune", as: "test-agent" })).toMatchObject({ value: "amber", at: "style lab" });
    await until(() => raw().some(l => l.includes(surfaceBg("amber", 2))), "the amber surface drawn", 5000);
    // Reset value: the lab style's own bg is taken away (not just the nudge): what it inherits, the built-in none.
    expect(await app.act({ action: "tune.unset", args: { row: "bg" }, tile: "tune", as: "test-agent" })).toMatchObject({ row: "bg", value: "none", from: "built-in" });
    await until(() => !raw()[lab]!.includes(raised) && !raw()[lab]!.includes(surfaceBg("amber", 2)), "the tile's surface taken away", 5000);
    await expect(app.act({ action: "tune.unset", args: { row: "bg" }, tile: "tune", as: "test-agent" })).rejects.toThrow(/built-in already/);
    // Two steps back: the amber nudge, then the lab's raised.
    expect(await app.act({ action: "tune.undo", tile: "tune", as: "test-agent" })).toMatchObject({ undone: "bg", words: "bg taken away → amber at style lab" });
    expect(await app.act({ action: "tune.undo", tile: "tune", as: "test-agent" })).toMatchObject({ undone: "bg", words: "bg amber → the outline's at style lab" });
    await until(() => raw()[lab]!.includes(raised), "the surface back", 5000);
    // The header's picture: scrolled under the title, the header takes it, its crop moved up by header.image.y.
    // End twice: the last line on the edge, then in the middle (PIE-622), so the picture's line is above the top.
    await app.act({ action: "scroll", args: { to: "end" }, tile: "lab", as: "test-agent" });
    expect(await app.act({ action: "scroll", args: { to: "end" }, tile: "lab", as: "test-agent" })).toMatchObject({ atEnd: true });
    await until(() => { screen(); return peekHeader()?.backdrop?.image === "evening-beds.jpg"; }, "the header's backdrop", 8000);
    expect(peekHeader()?.backdrop).toMatchObject({ image: "evening-beds.jpg", focus: { x: 0.5, y: 0.35 } });
    // A drag over the framed box copies the list as written: no frame, no ✦, no padding.
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    await app.act({ action: "scroll", args: { to: "top" }, tile: "lab", as: "test-agent" });
    // Down until the whole box is in view (the page is longer than the tile).
    for (let i = 0; i < 20 && !(screen().includes("Broad beans") && screen().includes("Runner beans")); i++) await app.act({ action: "scroll", args: { by: 2 }, tile: "lab", as: "test-agent" });
    await until(() => screen().includes("Broad beans") && screen().includes("Runner beans"), "the box in view", 5000);
    const now = screen().split("\n"), y0 = now.findIndex(l => l.includes("Broad beans")), y1 = now.findIndex(l => l.includes("Runner beans"));
    const x0 = now[y0]!.indexOf("∙ Broad"), x1 = now[y1]!.indexOf("Runner beans") + "Runner beans".length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y: y0 });
    press({ kind: "mouse", action: "drag", button: 0, x: x0 + 3, y: y0 });
    press({ kind: "mouse", action: "drag", button: 0, x: x1, y: y1 });
    press({ kind: "mouse", action: "up", button: 0, x: x1, y: y1 });
    await until(() => copies().length > 0, "the drag copied");
    expect(copies()).toEqual([osc52("- Broad beans\n- Runner beans")]);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);

  test("the scroll section (PIE-622): End puts the last line on the edge, End again brings it to the middle, blank under it; by keys and act; reader.overscroll none stops at the edge", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "scroll" }, as: "test-agent" })).toMatchObject({ key: "scroll" });
    await until(() => screen().includes("End (or G) goes to the last line"), "the long note", 8000);
    const scroll = (args: Record<string, unknown>) => app.act({ action: "scroll", args, tile: "reader", as: "test-agent" }) as Promise<any>;
    // What an agent's view.get says (the viewport the person's keys left, read once it's painted).
    const view = async () => { screen(); return ((await app.act({ action: "view.get", tile: "reader", as: "test-agent" })) as any).viewport; };
    // (The agent's first act adds its line to the reader's header, a row less room: read where it is once painted.)
    expect(await scroll({ to: "end" })).toMatchObject({ atEnd: true, past: 0 });
    await until(() => screen().includes("The last cane"), "the last line drawn", 5000);
    const edge = await view();
    expect(edge).toMatchObject({ atEnd: true, past: 0, top: edge.total - edge.room });
    const half = await scroll({ to: "end" });
    expect(half).toMatchObject({ atEnd: true, past: Math.floor(edge.room / 2), top: edge.top + Math.floor(edge.room / 2) });
    expect(await view()).toMatchObject({ top: half.top, past: half.past });
    // The wheel's rows past that stop there.
    expect(await scroll({ by: 5 })).toMatchObject({ top: half.top });
    // The same by the person's keys: Home, End, End.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    press({ kind: "home" });
    expect(await view()).toMatchObject({ top: 0, atEnd: false });
    press({ kind: "end" });
    expect(await view()).toMatchObject({ top: edge.top, atEnd: true, past: 0 });
    ch("G");
    expect(await view()).toMatchObject({ top: half.top, atEnd: true, past: half.past });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // none: kept for the next start, and End stays on the edge.
    (app as any).lastInput = 0;
    expect(await app.act({ action: "reader.overscroll", args: { rows: "none" }, as: "test-agent" })).toEqual({ rows: "none" });
    expect(JSON.parse(readFileSync(join(process.env.EP0CH_STATE!, "reader-overscroll.json"), "utf8"))).toEqual({ rows: "none" });
    screen();
    expect(await scroll({ to: "end" })).toMatchObject({ top: edge.top, past: 0 });
    expect(await scroll({ to: "end" })).toMatchObject({ top: edge.top, past: 0 });
    await expect(app.act({ action: "reader.overscroll", args: { rows: "most" }, as: "test-agent" })).rejects.toThrow(/half, none or a number/);
    expect(await app.act({ action: "reader.overscroll", args: { rows: 4 }, as: "test-agent" })).toEqual({ rows: 4 });
    expect(await app.act({ action: "reader.overscroll", args: { rows: "half" }, as: "test-agent" })).toEqual({ rows: "half" });
  }, 20_000);

  test("the library section (PIE-618): an agent picks through every combination and copies a variation's source; the outline's own style is a value", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "library" }, as: "test-agent" })).toMatchObject({ key: "library" });
    await until(() => screen().includes("Minimal example"), "the library's overview", 8000);
    expect(await app.act({ action: "library.pick", args: { axis: "heading-pattern", value: "dots" }, as: "test-agent" })).toMatchObject({ on: true, matching: 486 });
    expect(await app.act({ action: "library.pick", args: { axis: "heading-tone", value: "green" }, as: "test-agent" })).toMatchObject({ matching: 81 });
    await until(() => screen().includes("81 of 2430 match · 1–8 shown"), "the picked space drawn", 5000);
    const copy: any = await app.act({ action: "library.copy", args: { n: 1 }, as: "test-agent" });
    expect(copy.source).toContain("[heading-pattern::dots]");
    expect(copy.source).toContain("[heading-tone::green]");
    await app.act({ action: "library.axis", args: { key: "heading" }, as: "test-agent" });
    // The outline's own style joins the values once the service's answer is in (the built-ins stand until then).
    const values = () => (S().stage(SECTIONS.findIndex(s => s.key === "library")).top.describe().library.variations as any[]).map(v => v.values.heading);
    await until(() => (screen(), values().includes("plot")), "the outline's plot style among the values", 8000);
    await app.act({ action: "library.clear", args: {}, as: "test-agent" });
    // Every component the readers draw has a page (PIE-701): the section lists as many as there are schemas, the figures and the box among them.
    const listed = () => (S().stage(SECTIONS.findIndex(s => s.key === "library")).top.describe().library.components as string[]);
    expect(listed()).toHaveLength(BUILTIN_COMPONENT_SCHEMAS.length);
    for (const id of ["graph-stat", "graph-table", "graph-quadrant", "links", "box", "image", "hero-image", "embed", "code-fence"]) expect(listed()).toContain(id);
    expect(await app.act({ action: "library.component", args: { name: "graph-quadrant" }, as: "test-agent" })).toMatchObject({});
    await app.act({ action: "library.part", args: { part: "overview" }, as: "test-agent" });
    await until(() => screen().includes("Quadrant (::graph-quadrant)") && screen().includes("Minimal example"), "a figure's overview", 5000);
  }, 20_000);

  test("the actions section's registry list: the wheel and keys pick through registry.pick; an agent's pick leaves the person's selection", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "actions" }, as: "test-agent" })).toMatchObject({ key: "actions" });
    const list = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.pane("registry"); };
    await until(() => !!list(), "the registry list", 5000);
    const before = list().picked;
    const r = await app.act({ action: "registry.pick", args: { n: 3 }, as: "test-agent" }) as any;
    expect(r).toMatchObject({ tile: "registry", n: 3, ran: false });
    expect(typeof r.action).toBe("string");
    expect(list().picked).toBe(before);
    // The person's wheel over the list moves their selection, through the same action.
    const at = S().stageRect, t = (S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.describe().panes as any[]).find(x => x.name === "registry");
    press({ kind: "mouse", action: "wheel-down", button: 0, x: at.col + t.rect.col + 3, y: at.row + t.rect.row + 3 });
    await until(() => list().picked === before + 1, "the wheel's pick", 3000);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("tile.preview, driven by an agent: the reader's opens land in a detail opened beside it, the reader keeps its note", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    await until(() => stage().layoutGet().tiles.find((t: any) => t.name === "reader")?.showing?.id === seeded.notes.notebook.id, "the notebook in the reader", 5000);
    const r = await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" }) as any;
    expect(r).toMatchObject({ tile: "reader-preview", kind: "reader", from: "reader" });
    const tiles = () => stage().layoutGet().tiles as any[];
    expect(tiles().find(t => t.name === "reader").link).toBe("reader-preview");
    // A link followed in the reader lands in the preview; the reader still shows the notebook.
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBeTruthy();
    await until(() => tiles().find(t => t.name === "reader-preview")?.showing?.id === f.opened, "the link in the preview", 5000);
    expect(tiles().find(t => t.name === "reader").showing.id).toBe(seeded.notes.notebook.id);
    // Again: that preview, not a second one.
    expect(await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" })).toMatchObject({ tile: "reader-preview", existing: true });
    expect(tiles().filter(t => t.name.startsWith("reader-preview")).length).toBe(1);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("reader modes (PIE-705): the section's readers follow, hold and pin; an agent switches each by reader.mode, attributed, and never takes the person's keys", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "reader-modes" }, as: "test-agent" })).toMatchObject({ key: "reader-modes" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "reader-modes")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const tile = (name: string) => tiles().find(t => t.name === name);
    await until(() => tile("now")?.showing?.id === seeded.notes.notebook.id && tile("detail")?.showing?.id === seeded.notes.shed.id, "the held and the pinned reader on their notes", 5000);
    expect(tile("reader")).toMatchObject({ kind: "reader", mode: "follows" });
    expect(tile("detail")).toMatchObject({ kind: "reader", mode: "held" });
    expect(tile("now")).toMatchObject({ kind: "reader", mode: "pinned", page: seeded.notes.notebook.props.page });
    // The held one lets go and follows the outline's selection; held again, it keeps what it shows.
    expect(await app.act({ action: "reader.mode", tile: "detail", args: { mode: "follows" }, as: "test-agent" })).toMatchObject({ tile: "detail", mode: "follows", held: false });
    expect((app as any).message).toContain("test-agent");
    expect(tile("detail").mode).toBe("follows");
    expect(await app.act({ action: "reader.mode", tile: "reader", args: { mode: "held" }, as: "test-agent" })).toMatchObject({ tile: "reader", mode: "held", held: true });
    expect(await app.act({ action: "reader.mode", tile: "now", args: { mode: "follows" }, as: "test-agent" })).toMatchObject({ tile: "now", mode: "follows" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("a session's files (PIE-602): an agent's open file= lands the Markdown file drawn as the preview draws it, any other through the file Resource reader, diff=true its changes", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    const showing = () => (stage().layoutGet().tiles as any[]).map(t => t.showing?.id).filter(Boolean) as string[];
    const [md, txt] = RECENT_FILES();
    const opened = await app.act({ action: "open", args: { file: md!.file }, as: "test-agent" }) as any;
    expect(opened.id).toBe(`file:${md!.file}`);
    await until(() => showing().includes(`file:${md!.file}`), "the bed plan where opens land", 5000);
    await until(() => screen().includes("Net the brassicas before the pigeons find them."), "the Markdown drawn", 5000);
    const other = await app.act({ action: "open", args: { file: txt!.file }, as: "test-agent" }) as any;
    expect(other.id).toStartWith("resource:");
    await until(() => screen().includes("Scarlet Emperor"), "the seed list through the Resource reader", 8000);
    const diff = await app.act({ action: "open", args: { file: md!.file, diff: true }, as: "test-agent" }) as any;
    expect(diff.id).toBe(`file-diff:${md!.file}`);
    await expect(app.act({ action: "open", args: { file: "beds/plan.md" }, as: "test-agent" })).rejects.toThrow(/absolute path/);
    await expect(app.act({ action: "open", args: {}, as: "test-agent" })).rejects.toThrow(/id=<block id> or file=/);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("links (PIE-541): a labelled ref inside italics is drawn in its link colour, italic, with every escape whole; an agent follows it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "entity" }, as: "test-agent" })).toMatchObject({ key: "entity" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "entity")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    await until(() => tiles().find(t => t.name === "reader")?.showing?.id === seeded.notes.shed.id, "the shed in the reader", 5000);
    await until(() => screen().includes("The pump's spare valves are on the kitchen whiteboard."), "the italic line drawn", 5000);
    const raw = sc.render(app).lines;
    expect(raw.join("\n").match(/(?<!\x1b)\[[\d;]*m/g)).toBeNull();
    const row = raw.find(l => plain(l).includes("The pump's spare valves"))!;
    const at = row.indexOf("the kitchen whiteboard");
    expect(row.slice(0, at)).toContain("\x1b[3m");
    expect(row.slice(0, at).split("\x1b[").at(-1)).toBe(fg(C.lcyan).slice(2));
    // The note's first link is the one in italics.
    expect(JSON.stringify(await app.act({ action: "link.select", tile: "reader", args: { n: 1 }, as: "test-agent" }))).toContain("the kitchen whiteboard");
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBe(seeded.notes.whiteboard.id);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("resource comments (PIE-650): a Resource's text takes a comment from an agent's act, quoting the file's source, the file untouched; its seeded thread is placed in the text and is a backlink of the block whose link opened it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "resource-comments" }, as: "test-agent" })).toMatchObject({ key: "resource-comments" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "resource-comments")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const resTile = () => tiles().find(t => String(t.showing?.id ?? "").startsWith("resource:"));
    await until(() => !!resTile() && screen().includes("Net the brassicas before the pigeons find them."), "the bed plan as a Resource", 8000);
    const tile = resTile().name as string;
    const plan = RECENT_FILES()[0]!;
    const before = readFileSync(plan.file, "utf8");
    // The seeded thread is read for the Resource and placed in its text (the note has a header before the file's own text).
    await until(() => screen().includes("1 open comment"), "the seeded thread counted", 8000);
    const threads = await app.act({ action: "threads", tile, as: "test-agent" }) as any;
    expect(threads.threads).toHaveLength(1);
    // An agent comments on a passage of the rendered Markdown: the quote is the source's own (`**Bed 2:**` keeps its asterisks).
    const quote = "**Bed 2:** runner beans up the wigwam";
    const sent = await app.act({ action: "comment", tile, args: { quote, body: "Is the wigwam tall enough this year?" }, as: "test-agent" }) as any;
    expect(sent).toBeDefined();
    const after = await app.act({ action: "threads", tile, as: "test-agent" }) as any;
    expect(after.threads).toHaveLength(2);
    expect(after.threads.some((t: any) => t.quote === quote)).toBe(true);
    // Stored in the outline against the Resource, with the block that opened it as its reference context; never in the file.
    const touch = (await board.byProp("file", plan.file, 1))[0]!;
    const resourceId = String(resTile().showing.id).slice("resource:".length);
    const stored = await board.request<any[]>("annotations.list", { query: { subject: { kind: "resource", resourceId }, includeResolved: true } });
    expect(stored).toHaveLength(2);
    expect(stored.every(t => t.originalTarget.referenceContext?.representation.subject.blockId === touch.id)).toBe(true);
    expect(stored.find(t => t.originalTarget.anchor.exact === quote)).toBeDefined();
    expect(readFileSync(plan.file, "utf8")).toBe(before);
    // A ticket-like or unreadable Resource says why instead (the reader's refusal), and a note that is not a block still can't be edited.
    await expect(app.act({ action: "edit", tile, as: "test-agent" })).rejects.toThrow();
    expect(S().focus).toBe("index");
  }, 30_000);

  test("links-open (PIE-646): a detail, its links tile and a preview: the preview follows the pick, ⏎ opens it in the detail, alt+⏎ in a new detail", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "links-open" }, as: "test-agent" })).toMatchObject({ key: "links-open" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "links-open")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const shows = (name: string) => tiles().find(t => t.name === name)?.showing?.id;
    await until(() => shows("detail") === seeded.notes.shed.id && tiles().find(t => t.name === "backlinks")?.backlinks?.rows?.some((r: any) => r.id), "the shed and its links", 8000);
    const rows = tiles().find(t => t.name === "backlinks").backlinks.rows as { n: number; id?: string }[];
    const first = rows.find(r => r.id && r.id !== seeded.notes.shed.id)!;
    // The header's controls narrow all three groups, and the counters say which; the controls keep their cells.
    const links = () => tiles().find(t => t.name === "backlinks").backlinks;
    const cellOf = (what: string) => { const ls = screen().split("\n"), y = ls.findIndex(l => l.includes(what)); return [y, y < 0 ? -1 : ls[y]!.indexOf(what)]; };
    const sortAt = cellOf("Sort: ");
    expect(links().status).toMatch(/^\d+ of \d+ match · →\d+\/\d+ ♦\d+\/\d+ ←\d+\/\d+/);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { stage: "open", sort: "title" }, as: "test-agent" });
    expect(links().status).toContain("Stage: open · Sort: Title");
    expect(cellOf("Sort: ")).toEqual(sortAt);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { stage: "all", sort: "updated-desc" }, as: "test-agent" });
    // A pick previews; the detail keeps the shed.
    await app.act({ action: "backlinks.pick", tile: "backlinks", args: { n: first.n }, as: "test-agent" });
    await until(() => shows("preview") === first.id, "the preview following the pick", 5000);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // alt+⏎ is a new detail beside the first, which keeps its note.
    const before = tiles().length;
    await app.act({ action: "backlinks.open", tile: "backlinks", args: { n: first.n, where: "new" }, as: "test-agent" });
    await until(() => tiles().length === before + 1, "a new detail", 5000);
    expect(tiles().find(t => t.kind === "reader" && t.mode === "held" && t.name !== "detail")?.showing?.id).toBe(first.id);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // ⏎ opens it in the detail the links came from, and the links tile lists that note's links now.
    await app.act({ action: "backlinks.open", tile: "backlinks", args: { n: first.n }, as: "test-agent" });
    await until(() => shows("detail") === first.id, "⏎: the detail holds it", 5000);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("children (PIE-693): a thread's replies are a group of its links, narrowed by Stage; a tile's groups are chosen by act and saved; ⏎ opens a reply in the reader", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "children" }, as: "test-agent" })).toMatchObject({ key: "children" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "children")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const tile = (name: string) => tiles().find(t => t.name === name);
    const childRows = (name: string) => (tile(name)?.backlinks?.rows ?? []).filter((r: any) => r.kind === "child");
    await until(() => tile("reader")?.showing?.id === seeded.notes.swap.id && childRows("replies").length === 4 && childRows("links").length === 4, "the swap thread, its links and its replies", 8000);
    // The replies tile lists Children alone; the links tile every group, the counters across all four.
    expect(tile("replies").backlinks.linkGroups).toEqual(["children"]);
    expect(tile("replies").backlinks.rows.some((r: any) => r.kind === "outlink" || r.kind === "backlink")).toBe(false);
    expect(tile("links").backlinks.status).toMatch(/→\d+\/\d+ ♦\d+\/\d+ ←\d+\/\d+ ↓4\/4/);
    // Stage narrows the children as every group: open keeps Ana's (waiting) and Cal's (active).
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "open" }, as: "test-agent" });
    expect(childRows("replies").map((r: any) => r.text).sort()).toEqual(["Ana: runner beans to swap", "Cal: labels and a pencil"]);
    expect(tile("replies").backlinks.status).toContain("2 of 4 match");
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "all" }, as: "test-agent" });
    // An agent chooses the links tile's groups: said, saved with the layout, refused past the last one.
    const focus = S().focus;
    expect(await app.act({ action: "backlinks.groups", tile: "links", args: { show: "children,backlinks" }, as: "test-agent" })).toMatchObject({ groups: ["backlinks", "children"] });
    expect(tile("links").backlinks.rows.some((r: any) => r.kind === "outlink")).toBe(false);
    expect(JSON.stringify(stage().layoutSpec())).toContain('"linkGroups":"backlinks,children"');
    await app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "outlinks" }, as: "test-agent" });
    expect(tile("replies").backlinks.linkGroups).toEqual(["outlinks", "children"]);
    await app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "outlinks" }, as: "test-agent" });
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "children" }, as: "test-agent" })).rejects.toThrow(/only group/);
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { show: "kids" }, as: "test-agent" })).rejects.toThrow(/isn't a group/);
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { choose: true }, as: "test-agent" })).rejects.toThrow(/person's/);
    await app.act({ action: "backlinks.groups", tile: "links", args: { show: "all" }, as: "test-agent" });
    // ⏎ on a reply opens it where the list's opens land: the reader whose children these are.
    const ana = childRows("replies").find((r: any) => r.text.startsWith("Ana"));
    await app.act({ action: "backlinks.open", tile: "replies", args: { n: ana.n }, as: "test-agent" });
    await until(() => tile("reader")?.showing?.id === ana.id, "the reply opened in the reader", 5000);
    expect(S().focus).toBe(focus);
  }, 30_000);

  test("links-block (PIE-693): an outbox in a day's plan: the query's matches listed, the selection previewed; [ ] and a pick move it, an agent's moves nothing; ⏎ opens where opens land; going in is the person's", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "links-block" }, as: "test-agent" })).toMatchObject({ key: "links-block" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "links-block")).top; };
    const reader = () => stage().pane("reader") as any;
    const blocks = async () => ((await app.act({ action: "links.blocks", tile: "reader", as: "test-agent" })) as any).blocks;
    await until(() => reader()?.surface.linkBlocksDrawn[0]?.rows.length === 3, "the outbox's three waiting letters", 8000);
    let b = (await blocks())[0];
    expect(b).toMatchObject({ n: 1, title: "Outbox", query: "type=letter mail=waiting", groups: ["matches"], entered: false });
    expect(b.rows.map((r: any) => r.text).sort()).toEqual(["Ask Ana about the bean seed", "Order the fruit-cage netting", "Write to the allotment society about the gate"]);
    // A query it can't read (PIE-729) shows the service's whole refusal in its frame: the query, what was read, a fix.
    await until(() => /Invalid property filter key/.test(screen()), "the unreadable query's refusal drawn", 8000);
    const refused = screen().replace(/\x1b\[[\d;]*m/g, "");
    expect(refused).toContain("query: type!=letter");
    expect(refused).toContain("Did you mean NOT type=letter");
    expect(refused).toContain("Example: type=thread");
    expect(refused).not.toContain("Invalid property fi…");
    // The first row is selected and previewed beside the list, drawn as an embed of it is.
    const first = b.rows.find((r: any) => r.selected);
    expect(first.n).toBe(1);
    expect(b.preview).toBe(first.id);
    // An agent's pick answers the row and moves nothing of the person's.
    const read = await app.act({ action: "links.pick", tile: "reader", args: { n: 2 }, as: "test-agent" }) as any;
    expect(read).toMatchObject({ row: 2, moved: false });
    expect((await blocks())[0].rows.find((r: any) => r.selected).n).toBe(1);
    // The person's pick (a key or a click) moves the selection, the [ ] position with it, and the preview follows.
    await stage().dispatch.act({ action: "links.pick", tile: "reader", args: { n: 2 } }, { kind: "user" });
    await until(() => reader().surface.linkBlocksDrawn[0]?.preview === read.id, "the preview following the pick", 5000);
    // The preview is the reader's own drawing of an embed of it: its » title, then its text.
    await until(() => screen().includes(`» ${read.text.slice(0, 20)}`), "the picked letter drawn in the preview", 8000);
    expect(reader().surface.inView()?.link?.linksBlock?.row).toBeDefined();
    // Going in is the person's.
    await expect(app.act({ action: "links.enter", tile: "reader", as: "test-agent" })).rejects.toThrow(/the person's/);
    await stage().dispatch.act({ action: "links.enter", tile: "reader" }, { kind: "user" });
    expect(reader().surface.linksIn).toBe(reader().surface.linkBlocksDrawn[0].key);
    await stage().dispatch.act({ action: "links.enter", tile: "reader", args: { on: false } }, { kind: "user" });
    expect(reader().surface.linksIn).toBeNull();
    // ⏎ on a row opens it where the reader's opens land: here, the reader itself.
    await app.act({ action: "links.open", tile: "reader", args: { n: 3 }, as: "test-agent" });
    await until(() => reader().surface.msg?.id === b.rows[2].id, "the third letter in the reader", 5000);
    await app.act({ action: "back", tile: "reader", as: "test-agent" });
    await until(() => reader().surface.msg?.id === seeded.notes.dayPlan.id, "back on the plan", 5000);
    expect(S().focus).toBe("index");
  }, 30_000);

  test("terminal: the tile's program copies (OSC 52), and the door passes it on to the person's terminal, said as the tile's", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "terminal" }, as: "test-agent" })).toMatchObject({ key: "terminal" });
    await until(() => screen().includes("copy from it as Claude Code does"), "the shell in the stage", 8000);
    const copying = (what: string, done: string) => `printf '\\033]52;c;?\\007'; printf '\\033]52;c;%s\\007' "$(printf '${what}' | base64)"; echo ${done}-$((6*7))`;
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    // An agent typing it into the shell: the person isn't using the tile, so it isn't passed on, and the toast says so.
    for (let i = 0; ; i++) {
      try { await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Pull the bindweed", "agent") + "\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => screen().includes("agent-42"), "the agent's command to run", 8000);
    await until(() => (app as any).toast?.text === "not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again", "the toast", 5000);
    app.redraw(); await until(() => painted.map(plain).join("\n").includes("✗ not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again"), "the toast drawn", 3000);
    expect(copies()).toEqual([]);
    // The person clicks in the tile and types it.
    const r = S().stageRect, t = (S().stages.get(SECTIONS.findIndex(s => s.key === "terminal")).top.describe().panes as any[]).find(x => x.kind === "pty");
    const at = { x: r.col + t.rect.col + 3, y: r.row + t.rect.row + 3 };
    press({ kind: "mouse", action: "down", button: 0, ...at }); press({ kind: "mouse", action: "up", button: 0, ...at });
    for (const c of copying("Turn the compost", "copied")) ch(c);
    press({ kind: "enter" });
    await until(() => copies().length > 0, "the copy written to the terminal", 8000);
    await Bun.sleep(150);
    expect(copies()).toEqual([osc52("Turn the compost")]);
    expect((app as any).toast?.text).toBe("copied from sh · 16 chars");
    app.redraw(); await until(() => painted.map(plain).join("\n").includes("✓ copied from sh · 16 chars"), "the toast drawn", 3000);
    // Back to the door: the click a moment ago still counts, so the same agent's copy now reaches the person.
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Mulch the roses", "again") + "\\n" }, as: "test-agent" });
    await until(() => copies().length > 1, "the second copy written to the terminal", 8000);
    expect(copies().at(-1)).toBe(osc52("Mulch the roses"));
    // A drag across the line it printed: the door selects it and copies on release (PIE-716).
    const line = painted.map(plain).findIndex(l => l.includes("Plant out the courgettes")), x0 = painted.map(plain)[line]!.indexOf("Plant");
    const n = copies().length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y: line }); press({ kind: "mouse", action: "drag", button: 0, x: x0 + 4, y: line }); press({ kind: "mouse", action: "up", button: 0, x: x0 + 4, y: line });
    await until(() => copies().length > n, "the drag's copy written to the terminal", 5000);
    expect(copies().at(-1)).toBe(osc52("Plant"));
    press({ kind: "char", ch: "]", ctrl: true });                // the press went into the tile, as a click does
    press({ kind: "esc" });
  }, 20_000);

  test("the menu section (PIE-492): an agent's tile.menu answers rows; the ⋯ and a right-click open it; a row runs as the person; the terminal keeps its right-click", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "menu" }, as: "test-agent" });
    await until(() => marks.menu!.every(m => screen().includes(m)), "the menu section");
    const stage = () => S().stages.get(S().sel).top;
    const overlay = () => stage().overlays.top() as { name: string; items: any[] } | null;
    // An agent: the rows as data, nothing drawn.
    const out = await app.act({ action: "tile.menu", tile: "reader", args: {}, as: "test-agent" }) as any;
    expect(out.rows.map((r: any) => r.group)).toEqual(expect.arrayContaining(["Tile", "Note"]));
    expect(out.rows.find((r: any) => r.action === "tile.zoom")).toMatchObject({ label: "zoom", key: "ctrl+w z" });
    expect(overlay()).toBeNull();
    const at = S().stageRect, tiles = () => stage().describe().panes as any[];
    const click = (x: number, y: number, button = 0) => { press({ kind: "mouse", action: "down", button, x, y }); press({ kind: "mouse", action: "up", button, x, y }); };
    // The person: a click on the reader's ⋯ opens it; one click on zoom runs it.
    sc.render(app);
    const b = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "reader");
    click(at.col + b.from, at.row + b.row);
    await until(() => overlay()?.name === "tile menu", "the ⋯ opens the reader's menu");
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /\bzoom\s+\^W z/.test(l));
    expect(y).toBeGreaterThan(0);
    // The menu's row, not the index's "open, split, zoom" a scrolled index can put on the same row.
    click(rows[y]!.search(/\bzoom\s+\^W z/), y);
    await until(() => stage().zoom !== null, "zoom ran from the menu");
    expect(overlay()).toBeNull();
    await app.act({ action: "tile.zoom", tile: "reader", args: { on: false }, as: "test-agent" }).catch(() => stage().dispatch.press("tile.zoom", { on: false }, "reader"));
    // A right-click in the reader opens it at the pointer; esc puts it away.
    sc.render(app);
    const r = tiles().find(x => x.name === "reader").rect;
    click(at.col + r.col + 4, at.row + r.row + 4, 2);
    await until(() => overlay()?.name === "tile menu", "a right-click opens the reader's menu");
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The terminal's program asked for the mouse: its right-click is the program's, and its ⋯ still opens the menu.
    await until(() => stage().pane("clicks")?.wantsMouse?.() === true, "the program asked for the mouse");
    sc.render(app);
    const t = tiles().find(x => x.name === "clicks").rect;
    click(at.col + t.col + 4, at.row + t.row + 4, 2);
    expect(overlay()).toBeNull();
    sc.render(app);
    const tb = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "clicks");
    click(at.col + tb.from, at.row + tb.row);
    await until(() => overlay()?.name === "tile menu", "the terminal's ⋯ opens its menu");
    expect(overlay()!.items.map(x => x.group)).toContain("Terminal");
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The right-click went into the terminal (a click there types in it): ctrl+] leaves it, then esc to the index.
    press({ kind: "char", ch: "]", ctrl: true });
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("made, by the person: a blank screen started from a detail; a click on its + New note runs note.new, as ctrl+n does, and writes in that detail", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // d: a detail in the blank's place (its row, as the person picks it).
    press({ kind: "char", ch: "d" });
    await until(() => (stage().layoutGet().tiles as any[]).some(t => t.kind === "reader" && t.mode === "held"), "a detail in the blank's place");
    await until(() => screen().includes("+ New note"), "the empty detail's + New note");
    // A click on + New note, as a mouse event on the screen: the same note.new ctrl+n runs.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("+ New note")), x = rows[y]!.indexOf("+ New note") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    const detail = () => stage().pane((stage().layoutGet().tiles as any[]).find(t => t.kind === "reader" && t.mode === "held").name);
    await until(() => !!detail()?.surface?.draft, "the new note's edit in the detail, by the click", 8000);
    const id = detail().surface.draft.blockId;
    expect(await board.get(id)).toBeTruthy();
    // Nothing typed: esc puts it in the trash, and the detail is empty again.
    press({ kind: "esc" });
    const end = Date.now() + 5000;
    while (!(await board.isTrashed(id))) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    for (let i = 0; i < 6 && S().focus === "stage"; i++) press({ kind: "esc" });
    // Put back as the next test expects it: a fresh blank stage.
    S().stages.delete(S().sel);
  }, 20_000);

  test("made (PIE-565): a blank screen built through act, saved as a screen note, opened again by name, then deleted", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().layoutGet().tiles as any[];
    await app.act({ action: "blank.fill", tile: "blank", args: { kind: "tree" }, as: "test-agent" });
    await app.act({ action: "tile.open", tile: "tree", args: { kind: "detail", where: "right" }, as: "test-agent" });
    await app.act({ action: "tile.link", tile: "tree", args: { to: "detail" }, as: "test-agent" });
    expect(tiles().map(t => t.kind)).toEqual(["tree", "reader"])   // kind=detail opens a held reader (PIE-705); the tile keeps the name "detail";
    const saved = await app.act({ action: "screen.save", args: { name: "Allotment work" }, as: "test-agent" }) as any;
    // Named the way it is typed: the title is kept, the answer says the slug it saved under.
    expect(saved).toMatchObject({ screen: "allotment-work", title: "Allotment work", slug: "allotment-work", created: true, tiles: ["tree", "detail"] });
    const note = await board.get(saved.note);
    expect(note!.props).toMatchObject({ type: "screen", screen: "allotment-work" });
    expect(note!.author).toBe("test-agent");               // attributed to the agent that saved it
    // Opened again by name, as `ep0ch --screen allotment-work` does: the same tiles, the outline's opens landing in the detail.
    await app.act({ action: "screen.open", args: { name: "allotment work" }, as: "test-agent" });
    const top = () => app.screens().at(-1) as any;
    await until(() => top().name === "allotment-work", "the saved screen opened");
    expect((top().layoutGet().tiles as any[]).map(t => [t.name, t.link ?? null])).toEqual([["tree", "detail"], ["detail", null]]);
    await app.act({ action: "screen.back", args: {}, as: "test-agent" });
    await until(() => top() === sc, "back on the showcase");
    expect(await app.act({ action: "screen.delete", args: { name: "allotment-work" }, as: "test-agent" })).toMatchObject({ trashed: true });
    expect(await board.isTrashed(saved.note)).toBe(true);
  }, 20_000);

  test("drafts: the shed reader's kept-edit line, by act: [show them] opens the edit's own change against the note beside it, and [add them] puts it into an edit", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drafts" }, as: "test-agent" });
    await until(() => marks.drafts!.every(m => screen().includes(m)), "the drafts section");
    const stage = () => S().stages.get(S().sel).top;
    const name = "reader3";                                        // the third reader shows the shed
    // An agent reads the diff as data (nothing drawn); the person's [diff] opens a reader beside.
    expect(await app.act({ action: "unsent.diff", tile: name, args: {}, as: "test-agent" })).toMatchObject({ diff: expect.stringContaining("+ Oil the padlock before winter.") });
    const els = await app.act({ action: "elements", tile: name, args: {}, as: "test-agent" }) as any;
    const diff = (els.elements as any[]).find(e => e.control === "diff");
    expect(diff).toBeTruthy();
    await stage().dispatch.press("element.open", { n: diff.n }, name);
    const diffView = () => (stage().describe().panes as any[]).map(x => stage().pane(x.name)).find((p: any) => p?.msg?.id?.startsWith?.("unsent:"));
    await until(() => !!diffView(), "the diff beside the shed");
    expect(diffView().msg.text).toContain("+ Oil the padlock before winter.");
    expect(diffView().readOnly).toBe(true);
    // [add them]: the shed reader opens its edit with the unsent line in it, lit as a patch.
    await stage().dispatch.press("unsent.add", {}, name);
    await until(() => !!stage().pane(name).surface.draft, "the edit open");
    expect(stage().pane(name).surface.draft.text).toContain("Oil the padlock before winter.");
    await stage().dispatch.press("edit.close", { discard: true }, name);
    press({ kind: "esc" });
  }, 20_000);

  test("kept edits: the three cases by act: a new line is shown and added as one patch, an edit the note has settles itself, an old conflict folds to a chip and compares both versions", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "kept" }, as: "test-agent" });
    await until(() => marks.kept!.every(m => screen().includes(m)), `the kept section: ${marks.kept!.filter(m => !screen().includes(m)).join(" | ")}`);
    const stage = () => S().stages.get(S().sel).top;
    // Still new: the rota's edit adds a line the note lacks; the note's other change since isn't in the comparison.
    const rota = await app.act({ action: "unsent.diff", tile: "rota", args: {}, as: "test-agent" }) as any;
    expect(rota).toMatchObject({ basis: "three-way", verdict: "new", said: expect.stringContaining("1 line from your edit") });
    expect(rota.diff).toContain("+ Check the seed trays on Fridays.");
    expect(rota.diff).not.toContain("Wipe the shelves");
    await stage().dispatch.press("unsent.add", {}, "rota");
    await until(() => !!stage().pane("rota").surface.draft, "the rota's edit open");
    expect(stage().pane("rota").surface.draft.text).toContain("Shut the vents at dusk.\nCheck the seed trays on Fridays.\nWipe the shelves on Sundays.");
    await stage().dispatch.press("edit.close", { discard: true }, "rota");
    // Already in the note: settled when the reader opened; a copy is kept, and nothing is asked.
    const hedge = S().notes.hedge;
    expect(unsent(`edit:${hedge.id}`)).toBeNull();
    await expect(app.act({ action: "unsent.diff", tile: "hedge", args: {}, as: "test-agent" })).rejects.toThrow("nothing is kept here (edit)");
    // An old edit with a conflict: folded to a chip; [show] opens it, and the comparison shows both versions.
    await app.act({ action: "unsent.show", tile: "compost", args: {}, as: "test-agent" });
    const compost = await app.act({ action: "unsent.diff", tile: "compost", args: {}, as: "test-agent" }) as any;
    expect(compost).toMatchObject({ verdict: "conflict", hunks: [{ state: "conflict", removed: ["Turn the heap monthly."], added: ["Turn the heap weekly in summer."], now: ["Turn the heap every fortnight."] }] });
    expect(compost.diff).toContain("the note now: Turn the heap every fortnight.");
    press({ kind: "esc" });
  }, 20_000);

  test("undo (PIE-621): a big paste is one step, ctrl+z and ctrl+y by keys; copy by a drag's release and by shift+arrows then alt+c; an agent's undo and redo through act, its own only", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "undo" }, as: "test-agent" });
    await until(() => marks.undo!.every(m => screen().includes(m)), `the undo section: ${marks.undo!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const draft = () => stage().pane("reader").surface.draft;
    expect(draft().text).toContain("# Pantry inventory");
    // An agent can't take back the person's paste: its undo is its own.
    await expect(app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).rejects.toThrow("this agent has no edit to undo");
    // The person, by keys: into the stage and into the edit (⏎ enters one the keys aren't in yet), ctrl+z takes the
    // whole paste back, ctrl+y puts it back, ctrl+z again.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    press({ kind: "enter" });
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "the paste undone in one step");
    expect(draft().note).toContain("undid the paste (42 lines)");
    press({ kind: "char", ch: "y", ctrl: true });
    await until(() => draft().text.includes("Pantry"), "the paste redone");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "undone again");
    expect(draft().dirty).toBe(false);
    // By mouse: a drag across [page::…] on the first line, and its release copies it (OSC 52).
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    const rows = sc.render(app).lines.map(plain);
    const y = rows.findIndex(l => l.includes("Jar labels [page::Jar labels]"));
    expect(y).toBeGreaterThan(0);
    const x0 = rows[y]!.indexOf("[page::"), x1 = x0 + "[page::Jar labels]".length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x0 + 4, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x1, y });
    press({ kind: "mouse", action: "up", button: 0, x: x1, y });
    await until(() => copies().length > 0, "the drag's selection copied on release");
    expect(copies()).toEqual([osc52("[page::Jar labels]")]);
    expect(draft().text).not.toContain("Pantry");                    // copying never types
    // By keys: home, shift+→ over the title, then alt+c (cmd+c where the terminal sends it).
    press({ kind: "home" });
    for (let i = 0; i < "Jar".length; i++) press({ kind: "right", shift: true });
    expect(draft().selectedText()).toBe("Jar");
    press({ kind: "alt", ch: "c" });
    await until(() => copies().length > 1, "alt+c copied the selection");
    expect(copies().at(-1)).toBe(osc52("Jar"));
    expect(screen()).toContain("[copy]");
    // A double click's word, copied once it's selected.
    const rows2 = sc.render(app).lines.map(plain), y2 = rows2.findIndex(l => l.includes("Rota: whoever fills")), x2 = rows2[y2]!.indexOf("whoever") + 2;
    for (let i = 0; i < 2; i++) { press({ kind: "mouse", action: "down", button: 0, x: x2, y: y2 }); press({ kind: "mouse", action: "up", button: 0, x: x2, y: y2 }); }
    await until(() => copies().length > 2, "the double click's word copied");
    expect(copies().at(-1)).toBe(osc52("whoever"));
    await stage().dispatch.press("edit.close", { discard: true }, "reader");
    await until(() => !draft(), "the person's edit closed");
    // An agent in an edit of its own, through act: its paste, its undo, its redo.
    await app.act({ action: "edit", tile: "reader", as: "test-agent" });
    await until(() => !!draft(), "the agent's edit open");
    await app.act({ action: "draft.place", tile: "reader", args: { line: 1 }, as: "test-agent" });
    expect(await app.act({ action: "draft.paste", tile: "reader", args: { text: " (wiped Sunday)" }, as: "test-agent" })).toMatchObject({ line: 1 });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    expect(await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).toMatchObject({ left: 0, redo: 1 });
    expect(draft().text.split("\n")[0]).not.toContain("wiped");
    expect(await app.act({ action: "draft.redo", tile: "reader", as: "test-agent" })).toMatchObject({ redone: "redid the paste" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    // The note's earlier revision (the seed saved it twice), into its own edit as one step, and taken back.
    expect(await app.act({ action: "revision.restore", tile: "reader", as: "test-agent" })).toMatchObject({ revision: 1, current: 2 });
    expect(draft().text).toBe(LABELS_BEFORE);
    await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    await app.act({ action: "edit.close", tile: "reader", args: { discard: true }, as: "test-agent" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("the esc section: three nested things open (a zoom, a lit link, the tile menu); each Esc closes one, innermost first, then the keys come back to the index, then nothing to close, and the screen stays", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "esc" }, as: "test-agent" });
    await until(() => marks.esc!.every(m => screen().includes(m)), "the esc section");
    const stage = () => S().stages.get(S().sel).top;
    const overlay = () => stage().overlays.top() as { name: string } | null;
    const lit = () => (stage().pane("reader").describe().elements?.current ?? null) as unknown;
    const message = () => (app as any).message as string;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // The person's keys: zoom the reader, light a link in it, open its menu.
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "z" });
    expect(stage().zoom).not.toBeNull();
    press({ kind: "char", ch: "]" });
    await until(() => lit() !== null, "a link lit in the reader");
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "." });
    await until(() => overlay()?.name === "tile menu", "the reader's menu");
    // Esc: the menu, then the link, then the zoom, one each.
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    expect(lit()).not.toBeNull();
    expect(stage().zoom).not.toBeNull();
    press({ kind: "esc" });
    expect(lit()).toBeNull();
    expect(stage().zoom).not.toBeNull();
    press({ kind: "esc" });
    expect(stage().zoom).toBeNull();
    // Nothing left in the stage: the keys come back to the index (section.leave); then nothing to close, and it stays.
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
    (app as any).message = "";
    press({ kind: "esc" });
    expect(message()).toBe("nothing to close · q leaves");
    expect(app.describe()).toMatchObject({ screen: "showcase" });
  }, 20_000);

  test("the refusals section (PIE-727): a key the spine refuses says why on its frame, loud the second time, gone on another key; the status bar keeps its copy", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "refusals" }, as: "test-agent" });
    await until(() => marks.refusals!.every(m => screen().includes(m)), "the refusals section");
    const stage = () => S().stages.get(S().sel).top;
    await until(() => stage().describe().panes.find((p: any) => p.name === "shed")?.collapsed === true, "the shed folded to a spine");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    expect(stage().layoutGet().focus).toBe("shed");
    // x on the spine: refused, said on the spine's own frame (where the keys are) and on the status bar.
    press({ kind: "char", ch: "x" });
    const why = app.refusal()!;
    expect(why).toMatchObject({ loud: false });
    expect(why.text).toContain("is collapsed to a spine");
    expect((app as any).message).toBe(why.text);
    await until(() => screen().includes(`✗ ${why.text.slice(0, 12)}`), "the refusal on the spine's frame");
    // x again: loud (bold, on the warning surface), and it stays.
    press({ kind: "char", ch: "x" });
    expect(app.refusal()).toEqual({ text: why.text, loud: true });
    const raw = sc.render(app).lines.find(l => plain(l).includes(`✗ ${why.text.slice(0, 12)}`))!;
    expect(raw).toContain("\x1b[1m");
    expect(raw).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
    // Another key (Tab, to the notebook): gone.
    press({ kind: "tab" });
    expect(app.refusal()).toBeNull();
    expect(screen()).not.toContain(`✗ ${why.text.slice(0, 12)}`);
    expect(stage().layoutGet().focus).toBe("reader");
    // ^W x on the notebook's reader: the screen is locked, and the reader's own bottom edge says so; again, loud.
    const close = () => { press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "x" }); };
    close();
    const locked = app.refusal()!;
    expect(locked).toMatchObject({ loud: false });
    const edge = () => screen().split("\n").find(l => l.includes(`✗ ${locked.text.slice(0, 12)}`)) ?? null;
    await until(() => edge() !== null, "the refusal on the reader's frame");
    expect(edge()).toMatch(/[╚└]/);
    close();
    expect(app.refusal()).toEqual({ text: locked.text, loud: true });
    expect(stage().layoutGet().tiles.map((t: any) => t.name)).toEqual(expect.arrayContaining(["shed", "reader"]));
    // A click (the mouse is first-class): the reader's ⋯, then its dimmed close row, says why the same way.
    press({ kind: "char", ch: "j" });
    expect(app.refusal()).toBeNull();
    const at = S().stageRect;
    sc.render(app);
    const b = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "reader");
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    click(at.col + b.from, at.row + b.row);
    await until(() => stage().overlays.top()?.name === "tile menu", "the reader's menu");
    const row = (stage().overlays.top().items as any[]).find(r => r.action === "tile.close");
    expect(row?.refused).toBeTruthy();
    const lines = sc.render(app).lines.map(plain), y = lines.findIndex(l => l.includes(` ${row.label} `) && l.includes("^W x"));
    expect(y).toBeGreaterThan(0);
    const x = lines[y]!.indexOf(` ${row.label} `) + 2;
    click(x, y);
    expect(app.refusal()).toEqual({ text: row.refused, loud: false });
    await until(() => screen().includes(`✗ ${String(row.refused).slice(0, 12)}`), "the click's refusal on the reader's frame");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("a screen in a tile (the screen section's board): Esc with nothing left in the board goes on to the desk's steps (its zoom), then back to the index", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    await stage().dispatch.press("tile.focus", {}, "board");
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "z" });
    expect(stage().zoom).not.toBeNull();
    for (let i = 0; i < 6 && stage().zoom !== null; i++) press({ kind: "esc" });   // the board's own things first, if any
    expect(stage().zoom).toBeNull();
    expect(S().focus).toBe("stage");                                                 // the zoom went before the stage did
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("the Welcome on the seeded outline: [welcome::true] notes in the Welcome view's hand-set order, moved through act", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "screen.open", args: { name: "welcome" }, as: "test-agent" });
    const top = () => app.screens().at(-1) as any;
    const items = () => (top().pane?.("welcome")?.items ?? null) as { text: string; id: string }[] | null;
    await until(() => top().name === "welcome" && items()?.length === 2, "the two seeded welcome notes");
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["Start here", "House rules"]);
    await app.act({ action: "welcome.move", args: { id: items()![1]!.id, to: 1 }, as: "test-agent" });
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["House rules", "Start here"]);
    await app.act({ action: "welcome.move", args: { id: items()![1]!.id, to: 1 }, as: "test-agent" });
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["Start here", "House rules"]);
    await app.act({ action: "screen.back", args: {}, as: "test-agent" });
    await until(() => top() === sc, "back on the showcase");
  }, 20_000);

  test("the drawer section, driven through act: the kettle goes in, a section switch keeps it (the same pid), and it comes out into another section", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = () => S().stages.get(S().sel).top;
    const kettle = () => stage().pane("kettle");
    await until(() => kettle()?.running === true, "the kettle runs");
    const pid = kettle().pid;
    const out = await app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: "test-agent" }) as any;
    expect(out).toMatchObject({ tile: "kettle", inDrawer: true });
    expect(stage().pane("kettle")).toBeUndefined();
    expect((app as any).message).toContain("an agent (test-agent) put kettle in your drawer");
    // Another section: a screen switch. The drawer still has it, the same program.
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" });
    expect(app.drawer.tabs().map(t => t.name)).toContain("kettle");
    expect((app.drawer.desk!.pane("kettle") as any).pid).toBe(pid);
    expect((app.describe() as any).drawer.tiles.map((t: any) => t.name)).toContain("kettle");
    // Pulled up by the agent (the person's keys stay put), then taken out into this section beside its tree.
    (app as any).lastInput = 0;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    expect(app.drawer.open).toBe(true);
    expect(app.drawer.entered).toBe(false);
    // A tab in the drawer has its × (tile.close): the kettle's program runs, so a click asks first and closes nothing yet.
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "kettle" }, { kind: "user" });
    (app as any).paint();
    const row = app.drawer.rect!.row + 1, col = plain(painted[row] ?? "").lastIndexOf("×");
    expect(col).toBeGreaterThan(0);
    for (const action of ["down", "up"] as const) press({ kind: "mouse", action, button: 0, x: col, y: row });
    expect((app as any).message).toContain("closing ends it");
    expect(app.drawer.tabs().map(t => t.name)).toContain("kettle");
    press({ kind: "char", ch: "]", ctrl: true });
    (app as any).lastInput = 0;
    const back = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "right" }, tile: "kettle", as: "test-agent" }) as any;
    expect(back).toMatchObject({ tile: "kettle", inDrawer: false });
    expect(stage().pane("kettle").pid).toBe(pid);
    expect(stage().pane("kettle").running).toBe(true);
    // The drawer's own first tab comes out too: an ordinary terminal tile in this section, its program running on; a
    // new own tab takes its place in the drawer.
    const own = app.drawer.tile!;
    await until(() => own.running, "the drawer's own program runs");
    const ownPid = own.pid;
    (app as any).lastInput = 0;
    const left = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "down" }, tile: "drawer.agent", as: "test-agent" }) as any;
    expect(left).toMatchObject({ inDrawer: false, fresh: true });
    expect(stage().pane(left.tile)).toBe(own);
    expect(stage().pane(left.tile).pid).toBe(ownPid);
    expect(app.drawer.tile).not.toBe(own);
    expect(app.drawer.tabs()[0]!.name).toBe("drawer.agent");
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" });
  }, 20_000);

  test("the program status section (PIE-614): a fake deploy reports each state; its header, the status bar, the list, peek and status.list follow it; answering it ends done; going to it clears it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status" }, as: "test-agent" });
    await until(() => marks.status!.every(m => screen().includes(m)), "the status section");
    const stage = () => S().stages.get(S().sel).top;
    const deploy = () => stage().pane("deploy");
    const bar = () => { (app as any).paint(); return plain(painted.at(-1) ?? ""); };
    // Working, with its progress, on its header (an earlier visit to the section may have found it further on).
    await until(() => ["working", "blocked"].includes(deploy()?.status.urgent()?.state), "it reports", 8000);
    if (deploy().status.urgent().state === "working") expect(screen()).toMatch(/[◴◷◶◵] (20|60)% \d deploy/);
    // Blocked on a permission: the header's ◆, the list's row, the status bar's count, peek and status.list.
    await until(() => deploy()?.status.urgent()?.state === "blocked", "blocked", 8000);
    await until(() => /◆ \d deploy/.test(screen()) && screen().includes("deploy · needs you · Deploy v2.4.1 to production?"), "the header and the list", 5000);
    expect(bar()).toContain("◆1 on you");
    const listed = await app.act({ action: "status.list", args: {}, as: "test-agent" }) as any;
    expect(listed.waiting[0]).toMatchObject({ n: 1, name: "deploy", state: "blocked", kind: "permission", app: "deploy", msg: "Deploy v2.4.1 to production?" });
    expect(JSON.stringify(app.describe())).toContain("\"status\":[{\"id\":\"\",\"state\":\"blocked\",\"kind\":\"permission\",\"app\":\"deploy\",\"msg\":\"Deploy v2.4.1 to production?\"}]");
    // Going to it is the person's: an agent's is refused, its keys stay put.
    await expect(app.act({ action: "status.go", tile: "waiting", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();
    // The agent answers the program itself (tile.type), and it rolls out, then finishes done.
    await app.act({ action: "tile.type", tile: "deploy", args: { text: "y\\n" }, as: "test-agent" });
    await until(() => deploy()?.status.urgent()?.state === "done", "done", 8000);
    await until(() => /✓ \d deploy/.test(screen()) && screen().includes("deploy · done · Deployed v2.4.1 to 3 regions"), "done on the header and the list", 5000);
    expect(bar()).toContain("✓1 on you");
    // alt+w: the same list in your drawer.
    (app as any).lastInput = 0;
    press({ kind: "alt", ch: "w" });
    await until(() => app.drawer.tabs().some(t => t.kind === "waiting-you"), "the list in the drawer", 5000);
    expect(app.drawer.open).toBe(true);
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
    // The person goes to it from the list (⏎ on its row runs status.go): the keys go to the deploy, and its done is seen.
    await stage().dispatch.press("status.go", { n: 1 }, "waiting");
    await until(() => deploy()?.status.records.size === 0, "seen once the person is in it", 5000);
    expect(bar()).not.toContain("on you");
    press({ kind: "char", ch: "]", ctrl: true });
    press({ kind: "esc" });
  }, 30_000);

  test("the what-changed section (PIE-647): a scripted agent changes three notes, the status bar counts 3, a click opens the list in the drawer, a row opens its note, and the count clears", async () => {
    (app as any).lastInput = 0;
    app.whatChanged.markSeen();
    await app.act({ action: "section", args: { name: "changes" }, as: "test-agent" });
    await until(() => marks.changes!.every(m => screen().includes(m)), "the what-changed section");
    const stage = () => S().stages.get(S().sel).top;
    const bar = () => { (app as any).paint(); return plain(painted.at(-1) ?? ""); };
    // The section's agent ran when it was first built (an earlier visit may have): a round more, after the person looked.
    app.whatChanged.markSeen();
    await gardenRound(board, seeded.notes);
    await until(() => app.whatChanged.count() === 3, "three notes counted", 8000);
    expect(bar()).toContain("+3 new");
    // The list on the stage: the three, who and what, titles read; an agent's read changes nothing of the person's.
    // (rows other tests' agents changed stay in the list, seen; the three logs are the unseen ones)
    const logs = () => stage().pane("changes").rows().filter((r: any) => !r.seen) as { blockId: string; title?: string }[];
    await until(() => logs().length === 3 && logs().every(r => r.title), "the rows with titles");
    const listed = await app.act({ action: "changes.list", args: {}, as: "test-agent" }) as any;
    expect(listed.changed.filter((r: any) => !r.seen).map((r: any) => [r.title, r.who, r.kind, r.seen]).sort()).toEqual([["Bean row log", "garden-agent", "edited", false], ["Compost bay log", "garden-agent", "edited", false], ["Shed door log", "garden-agent", "edited", false]]);
    expect(app.whatChanged.count()).toBe(3);
    // A click on +3 new opens the list in the drawer, and looking clears the count.
    const at = (app as any).changedAt;
    expect(at).not.toBeNull();
    press({ kind: "mouse", action: "down", button: 0, x: at.from + 1, y: at.row });
    await until(() => app.drawer.tabs().some(t => t.kind === "what-changed"), "the list in the drawer", 5000);
    expect(app.drawer.open).toBe(true);
    expect(app.whatChanged.count()).toBe(0);
    expect(bar()).not.toContain("new");
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
    // A row opens its note where opens land (the reader beside the list).
    const first = logs()[0] ?? stage().pane("changes").rows()[0];
    await stage().dispatch.press("changes.go", { id: first.blockId }, "changes");
    await until(() => stage().pane("reader").msg?.id === first.blockId, "the note in the reader");
    // d shows the change under the row.
    await stage().dispatch.press("changes.diff", { id: first.blockId }, "changes");
    const diffOf = () => stage().pane("changes").describe().find((r: any) => r.id === first.blockId).diff as string[] | null;
    await until(() => (diffOf() ?? ["…"])[0] !== "…", "the diff read");
    expect(diffOf()!.join("\n")).toMatch(/^[ +-] /m);
    press({ kind: "esc" });
  }, 30_000);

  test("the power bar section (PIE-656): the stage's tiles listed as their tree, the folded one a spine; ctrl+k then %pears and ⏎ opens it from its spine and gives it the keys; an agent's bar.open answers and opens nothing", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "bar" }, as: "test-agent" });
    await until(() => marks.bar!.every(m => screen().includes(m)), "the power bar section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    await until(() => !!stage().tileOutline().find(t => t.name === "pears")?.collapsed, "the second detail folded");
    // An agent's: the rows, nothing opened.
    const r = await app.act({ action: "bar.open", args: { scope: "tiles" }, as: "test-agent" }) as any;
    const row = (name: string) => r.rows.find((x: any) => x.label.startsWith(`${name} ·`));
    expect(row("outline").depth ?? 0).toBe(0);
    expect(row("reader").depth).toBe(1);
    expect(row("pears")).toMatchObject({ depth: 2, label: "pears · Allotment notebook" });
    expect(row("pears").detail).toContain("a spine");
    expect((app as any).bar).toBeNull();
    // / with nothing typed: the notes changed most recently, newest first, none twice; typed, the one search finds a work item by its id.
    const recent = await app.act({ action: "bar.open", args: { scope: "notes" }, as: "test-agent" }) as any;
    expect(recent.rows.length).toBeGreaterThan(3);
    expect(new Set(recent.rows.map((x: any) => x.key)).size).toBe(recent.rows.length);
    const byId = await app.act({ action: "bar.open", args: { scope: "notes", query: "PLOT-4" }, as: "test-agent" }) as any;
    expect(byId.rows[0].label).toMatch(/^PLOT-4 .*Order the seed potatoes/);
    // The person's: ctrl+k, %pears, ⏎.
    press({ kind: "char", ch: "k", ctrl: true });
    for (const c of "%pears") press({ kind: "char", ch: c });
    expect((app as any).bar.describe()).toMatchObject({ scope: "tiles", query: "pears" });
    press({ kind: "enter" });
    await until(() => { const t = stage().tileOutline().find(x => x.name === "pears")!; return !t.collapsed && t.focused; }, "pears opened and given the keys");
    expect((app as any).bar).toBeNull();
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);

  test("the ^W keys section (PIE-704): ^W lists the grouped keys once; ? opens the whole list on the bar; typing finds a key and ⏎ presses it; an agent's bar.open answers the same rows", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "wkeys" }, as: "test-agent" });
    await until(() => marks.wkeys!.every(m => screen().includes(m)), "the ^W keys section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    if (S().focus !== "stage") press({ kind: "enter" });
    const r = await app.act({ action: "bar.open", args: { scope: "actions", query: "^W " }, as: "test-agent" }) as any;
    expect(r.rows.some((x: any) => x.keycap === "ctrl+w G" && x.group === "mounts & groups")).toBe(true);
    expect((app as any).bar).toBeNull();
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "?" });
    await until(() => (app as any).bar?.describe().scope === "actions", "the ^W list opened");
    for (const c of "float") press({ kind: "char", ch: c });
    await until(() => (app as any).bar.describe().rows[0]?.keycap === "ctrl+w f", "float found by its letters");
    press({ kind: "enter" });
    await until(() => stage().layoutGet().floats.length === 1, "the tile floated by the list");
    expect((app as any).bar).toBeNull();
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "f" });
    await until(() => stage().layoutGet().floats.length === 0, "put back by its key");
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);

  test("the agent policy section (PIE-639): free, edit only and hands off tiles; an agent's open is refused or lands, its edit of the middle note goes through, peek says the limits, the person's keys are never limited", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "agents" }, as: "test-agent" });
    await until(() => marks.agents!.every(m => screen().includes(m)), `the agents section: ${marks.agents!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const recipe = seeded.notes.recipe.id;
    // Peek says the limits before an agent acts.
    const seen = JSON.stringify(stage().describe());
    expect(seen).toContain('"agentLimits":[{"tile":"edit"');
    expect(seen).toContain('"level":"off"');
    // Saved with the layout: the edit tile's own level in its spec.
    expect(JSON.stringify(stage().layoutSpec())).toContain('"agents":"edit"');
    // Refused, naming the policy and the person's command; nothing moved.
    await expect(app.act({ action: "open", tile: "edit", args: { id: recipe }, as: "test-agent" })).rejects.toThrow(/edit is edit only for agents: open is refused .*tile\.agent policy=free tile=edit/);
    await expect(app.act({ action: "open", tile: "off", args: { id: recipe }, as: "test-agent" })).rejects.toThrow(/off is hands off for agents: open is refused · peek reads it/);
    await expect(app.act({ action: "tile.close", tile: "edit", as: "test-agent" })).rejects.toThrow(/tile\.close is refused/);
    expect(stage().pane("edit").msg.title ?? stage().pane("edit").title()).not.toContain("Lentil");
    // An open that names no tile lands in a free tile, never the limited ones.
    const landed = await app.act({ action: "open", args: { id: recipe }, as: "test-agent" }) as any;
    expect(landed.reader).toBe("free");
    expect(stage().pane("edit").msg.id).toBe(seeded.notes.errand.id);
    expect(stage().pane("off").msg.id).toBe(seeded.notes.shed.id);
    // The edit tile's note can be edited by an agent (its draft closed again at once); the hands-off tile's cannot.
    await app.act({ action: "edit.text", tile: "edit", args: { text: "Seed order for the plot\n\nTea, and two packets of beans." }, as: "test-agent" });
    expect(stage().pane("edit").surface.draft.text).toContain("two packets of beans");
    await stage().dispatch.press("edit.close", { discard: true }, "edit");
    await expect(app.act({ action: "edit.text", tile: "off", args: { text: "x" }, as: "test-agent" })).rejects.toThrow(/off is hands off for agents/);
    // An agent may tighten a free tile, never loosen a limited one.
    await app.act({ action: "tile.agent", tile: "free", args: { policy: "edit" }, as: "test-agent" });
    await expect(app.act({ action: "tile.agent", tile: "free", args: { policy: "free" }, as: "test-agent" })).rejects.toThrow(/edit only for agents/);
    await app.act({ action: "tile.agent", tile: "free", args: { policy: "off" }, as: "test-agent" });   // edit to off: through the dispatcher
    expect(stage().agentNow("free").level).toBe("off");
    await expect(app.act({ action: "tile.agent", tile: "free", args: { policy: "edit" }, as: "test-agent" })).rejects.toThrow(/hands off for agents: loosening its own limit is refused/);
    await stage().dispatch.press("tile.agent", { policy: "inherit" }, "free");
    // The person's own keys are never limited: they open into the hands-off tile, and free it by action.
    await stage().dispatch.press("open", { id: recipe }, "off");
    await until(() => stage().pane("off").msg?.id === recipe, "the person's open in the hands-off tile");
    await stage().dispatch.press("tile.agent", { policy: "free" }, "off");
    await app.act({ action: "open", tile: "off", args: { id: seeded.notes.shed.id }, as: "test-agent" });
    // ^W g cycles the focused tile; a click on its chip does too.
    await stage().dispatch.press("tile.focus", {}, "free");
    press({ kind: "enter" });
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "g" });
    expect(stage().agentNow("free")).toMatchObject({ level: "edit" });
    await stage().dispatch.press("tile.agent", { policy: "inherit" }, "free");
    // A click on the chip does the same (edit only to hands off), the keys staying where they are.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("✎ agents: edit only"));
    expect(y).toBeGreaterThan(0);
    const x = rows[y]!.indexOf("agents: edit only") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => stage().agentNow("edit").level === "off", "the chip's click");
    press({ kind: "esc" });
  }, 30_000);

  test("search, driven by an agent: the section's own desk answers the service's forgiving search, the person's overlay left alone", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    const r = await app.act({ action: "search", args: { query: "alotment notebok" }, as: "test-agent" }) as any;
    expect(r.query).toBe("alotment notebok");
    expect(r.hits[0]).toMatchObject({ n: 1, title: "Allotment notebook" });
    expect(r.hits.map((h: any) => h.title)).toContain("Allotment figures");
    // Any word order, punctuation folded.
    const lentil = await app.act({ action: "search", args: { query: "soup, lentil" }, as: "test-agent" }) as any;
    expect(lentil.hits[0].title).toBe("Lentil soup");
    expect(S().focus).toBe("index");
  }, 20_000);

  test("search, from a shell (PIE-534): the section opened through act; find --query, show $(find --ids) and export answer from the same outline", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    // The section's note says what to try from a shell, under the search overlay the section opens with.
    await until(() => screen().includes("From a shell"), "the finding note's shell section");
    expect(SECTIONS.find(x => x.key === "search")!.aside).toContain("ep0ch export");
    const cli = async (...args: string[]) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_SOCKET: scratch.sock, EP0CH_WS: scratch.name, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock" } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { out, err, code };
    };
    const errand = seeded.notes.errand.id;
    const found = await cli("find", "--query", "type=errand tag=spring", "--ids");
    expect(found.out.trim()).toBe(`((${errand}))`);
    const shown = await cli("show", "--width", "70", found.out.trim());
    expect(shown.out.split("\n")[0]).toBe("Seed order for the plot");          // the ` - ` separators aren't in the title
    const out = mkdtempSync(join(tmpdir(), "ep0ch-sink-export-"));
    try {
      expect((await cli("export", "--query", "type=errand", "--children", "--out", out)).code).toBe(0);
      const file = readFileSync(join(out, `seed-order-for-the-plot-${errand.slice(0, 8)}.md`), "utf8");
      expect(file).toContain('type: "errand"\narea: "garden"\nctx: "2026-03-09 @ 09:27:29 AM"\ntag:\n  - "seeds"\n  - "spring"\n---\nSeed order for the plot\nBroad beans');
      expect(file).toContain("\n- Ask the neighbour about netting\n  She has a spare roll.\n");
    } finally { rmSync(out, { recursive: true, force: true }); }
    expect(S().focus).toBe("index");
  }, 30_000);

  test("search: (( forgives a typo and another order through act, from the note read there; the bar's notes scope asks from that note, then Jev keeps the pick", async () => {
    (app as any).lastInput = 0;
    const finding = seeded.notes.finding.id;
    const asked: { query: string; semantic: boolean; near?: string }[] = [];
    const real = board.searchBlocks.bind(board);
    // Jev, as a host with a key would answer: the same hits, reversed, said "ranked".
    board.searchBlocks = async (text, opts = {}) => {
      asked.push({ query: text, semantic: !!opts.semantic, near: opts.near });
      const r = await real(text, { ...opts, semantic: false });
      return opts.semantic ? { ...r, matches: [...r.matches].reverse(), semantic: { status: "ranked" } } : r;
    };
    // A scratch host has no Jev key (test/scratch.ts): the bar that said so is asked again, of the stand-in.
    jevOff.delete(board);
    try {
      expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
      // The person's / on the section's desk: the power bar's notes scope, typed in.
      press({ kind: "enter" });
      await until(() => S().focus === "stage", "in the stage");
      press({ kind: "char", ch: "/" });
      await until(() => (app as any).bar?.scope === "notes", "the bar's notes scope", 5000);
      for (const c of "alotment notebok") press({ kind: "char", ch: c });
      const bar = () => (app as any).bar;
      await until(() => bar()?.items.length > 0, "the hits", 5000);
      // (( in the reader's note: the same search a draft's popup asks, with a typo in each word, then another order.
      const typo = await app.act({ action: "complete", args: { text: "((alotment notebok" }, as: "test-agent" }) as any;
      expect(typo).toMatchObject({ kind: "block", query: "alotment notebok" });
      expect(typo.items[0]).toMatchObject({ n: 1, label: "Allotment notebook", insertion: `((${seeded.notes.notebook.id}))` });
      const order = await app.act({ action: "complete", args: { text: "((soup lentl" }, as: "test-agent" }) as any;
      expect(order.items[0].label).toBe("Lentil soup");
      expect(asked.filter(a => a.query === "soup lentl").map(a => a.near)).toEqual([finding]);
      // The bar asked from the note under it; after a pause, Jev's order with the pick kept.
      await until(() => bar()?.describe().said?.notes === "jev ranked", "Jev's order in the bar", 5000);
      expect(asked.some(a => a.query === "alotment notebok" && a.semantic && a.near === finding)).toBe(true);
      const drawn = () => { (app as any).paint(); return painted.map(plain).join("\n"); };
      expect(drawn().split("\n").find(l => l.includes("› alotment notebok"))).toContain("jev ranked");
      // Jev's order (the stand-in reversed it) puts another note first, and the notebook, picked before, is still lit.
      const d = bar().describe();
      expect(d.rows[0].label).not.toBe("Allotment notebook");
      expect(d.rows[d.selected - 1].label).toBe("Allotment notebook");
      press({ kind: "esc" });
      press({ kind: "esc" });
      expect(S().focus).toBe("index");
    } finally {
      board.searchBlocks = real;
      // Whatever failed above, the next test starts at the index with no bar open.
      if ((app as any).bar) press({ kind: "esc" });
      if (S().focus === "stage") press({ kind: "esc" });
    }
  }, 20_000);

  test("edit (PIE-626): completion on every line: a property's value and a filter's words, through act, from the same completer", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "edit" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(s => s.key === "edit") + 1, key: "edit" });
    // The property panel's value for [heading::]: the schemas' values with this outline's own plot style among them.
    const value = await app.act({ action: "complete", args: { text: "pl", key: "heading" }, as: "test-agent" }) as any;
    expect(value).toMatchObject({ kind: "filter-value", query: "pl" });
    expect(value.items.map((i: any) => i.insertion)).toContain("plot");
    // A key in a draft: the same list [head offers while typing.
    const key = await app.act({ action: "complete", args: { text: "[heading-p" }, as: "test-agent" }) as any;
    expect(key.items.map((i: any) => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
  }, 20_000);

  test("callouts (PIE-538): Obsidian's examples drawn nested and folded; folds, types and starts by keys, mouse and act", async () => {
    const id = seeded.notes.callouts.id, text = async () => (await board.get(id))!.text;
    const reads = async (has: (t: string) => boolean, what: string) => { const end = Date.now() + 5000; while (!has(await text())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); } };
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "callouts" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(s => s.key === "callouts") + 1, key: "callouts" });
    await until(() => screen().includes("You can even use multiple") && screen().includes("♨ Soup stock"), "the nested example drawn, with the outline's own type", 8000);
    let shown = screen();
    expect(shown).toContain("feel the power");                             // [!note]+ starts open
    expect(shown).not.toContain("can you see me");                         // [!note]- starts folded
    expect(shown).toContain("♨ Soup stock");                               // dish: an alias of the outline's own recipe type
    expect(shown).toMatch(/│ │ ╭─ ◆ You can even use multiple/);           // a frame in a frame in a frame
    // The list, as an agent reads it: every callout outermost first, and the outline's types.
    const list = await app.act({ action: "callout.list", as: "test-agent" }) as any;
    expect(list.callouts.map((c: any) => [c.type, c.title, c.starts])).toEqual([
      ["note", "note", "open"], ["warning", "warning", "open"], ["note", "collapse", "folded"], ["note", "expando", "open"],
      ["question", "Can callouts be nested?", "open"], ["todo", "Yes!, they can.", "open"], ["example", "You can even use multiple layers of nesting.", "open"],
      ["faq", "Are callouts foldable?", "folded"], ["tip", "Title-only callout", "open"], ["tip", "Callouts can have custom titles", "open"], ["info", "Info", "open"], ["dish", "Soup stock", "open"],
    ]);
    expect(list.types.find((t: any) => t.name === "recipe")).toMatchObject({ icon: "♨", tone: "green", aliases: ["dish"], declaredIn: seeded.notes.calloutType.id });
    // An agent unfolds one: reading state only, the text untouched.
    expect(await app.act({ action: "unfold", args: { text: "collapse" }, as: "test-agent" })).toMatchObject({ kind: "callout", folded: false });
    await until(() => screen().includes("can you see me"), "the folded callout opened");
    // An agent changes a type and a start through the note's save, attributed; its undo puts the line back.
    const typed = await app.act({ action: "callout.type", args: { n: 2, to: "danger" }, as: "test-agent" }) as any;
    expect(typed).toMatchObject({ changed: true, header: "> > [!danger] warning", recordedAs: { author: "agent", actorId: "test-agent" } });
    expect(await text()).toContain("> > [!danger] warning\n> > body body");
    await app.act({ action: "callout.undo", as: "test-agent" });
    expect(await text()).toContain("> > [!warning] warning");
    await app.act({ action: "callout.start", args: { line: (await text()).split("\n").indexOf("> [!note]+ expando") + 1, folded: true }, as: "test-agent" });
    expect(await text()).toContain("> [!note]- expando");
    await expect(app.act({ action: "callout.menu", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();   // the type choice is the person's
    // The person, by keys: into the stage, [ ] to the first callout's icon, ⏎ opens the type choice, j ⏎ picks the next type.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]"); ch("]");
    press({ kind: "enter" });
    await until(() => screen().includes("note · now") && screen().includes("make it start folded (-)"), "the type choice, every choice drawn", 5000);
    expect(screen()).toContain("note · now");
    ch("j"); press({ kind: "enter" });
    await reads(t => t.includes("> [!abstract] note"), "the type changed");
    // ctrl+z: the last change here (the callout's) put back.
    press({ kind: "char", ch: "z", ctrl: true });
    await reads(t => t.includes("> [!note] note\n"), "the change undone");
    // By mouse: a click on the nested warning's title folds it.
    await until(() => screen().includes("body body"), "the nested warning drawn");
    // In the left reader (the right one shows the type's declaration).
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /╭─ ▾ ⚠ warning/.test(l)), x = rows[y]!.search(/╭─ ▾ ⚠ warning/) + 8;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !screen().includes("body body"), "the nested callout folded by a click");
    expect(await text()).toContain("> > [!warning] warning");                // folding never writes
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("copy a block (PIE-638): the callouts' ⧉ copies a callout's text as written by click, y and act; a drag across a frame copies the words", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "callouts" }, as: "test-agent" })).toMatchObject({ key: "callouts" });
    await until(() => screen().includes("Callouts, as Obsidian writes them"), "the callouts drawn", 8000);
    await app.act({ action: "scroll", tile: "reader", args: { to: "end" }, as: "test-agent" });
    await until(() => screen().includes("♨ Soup stock"), "the last callout drawn", 8000);
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    // An agent lists them and copies one: the text comes back, the clipboard is untouched.
    const listed = await app.act({ action: "blocks", tile: "reader", as: "test-agent" }) as any;
    const soup = listed.blocks.findIndex((b: any) => b.text.startsWith("Bones, an onion")) + 1;
    expect(soup).toBeGreaterThan(0);
    const theirs = await app.act({ action: "block.copy", tile: "reader", args: { n: soup }, as: "test-agent" }) as any;
    expect(theirs).toMatchObject({ kind: "callout", clipboard: false, text: "Bones, an onion, two bay leaves; `dish` is an alias of this outline's own recipe type." });
    expect(copies()).toEqual([]);
    // The person clicks its ⧉ (top right of the frame): it reaches the clipboard, said as lines.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("♨ Soup stock")), x = [...rows[y]!].indexOf("⧉");
    expect(x).toBeGreaterThan(0);
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => copies().length > 0, "the callout copied by its ⧉");
    expect(copies()).toEqual([osc52("Bones, an onion, two bay leaves; `dish` is an alias of this outline's own recipe type.")]);
    expect((app as any).message).toContain("copied 1 line");
    // An inline code span (`dish`) is a click target too: its contents, without the backticks.
    const rows2 = sc.render(app).lines.map(plain), sy = rows2.findIndex(l => l.includes("Bones, an onion")), sx = rows2[sy]!.indexOf("dish is an alias");
    press({ kind: "mouse", action: "down", button: 0, x: sx + 1, y: sy }); press({ kind: "mouse", action: "up", button: 0, x: sx + 1, y: sy });
    await until(() => copies().length > 1, "the code span copied");
    expect(copies().at(-1)).toBe(osc52("dish"));
    expect((app as any).message).toContain("copied 4 chars");
    // A drag across the framed lines copies the words, with no bar or edge.
    const a = rows.findIndex(l => l.includes("Here's a callout block.")), z = rows.findIndex(l => l.includes("A second paragraph"));
    const x0 = rows[a]!.indexOf("Here's"), x1 = rows[z]!.indexOf("paragraph") + 8;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y: a }); press({ kind: "mouse", action: "drag", button: 0, x: x0 + 3, y: a });
    press({ kind: "mouse", action: "drag", button: 0, x: x1, y: z }); press({ kind: "mouse", action: "up", button: 0, x: x1, y: z });
    await until(() => copies().length > 2, "the drag copied");
    const dragged = Buffer.from(copies().at(-1)!.split(";")[2]!.replace("\x07", ""), "base64").toString("utf8");
    expect(dragged).toContain("Here's a callout block.\nIt supports Markdown and links.");
    expect(dragged).toContain("- and lists\n- inside it");              // the list markers as the note has them
    for (const bad of ["│", "╭", "╰", "╮", "╯", "∙"]) expect(dragged).not.toContain(bad);
    // The whole note: an agent's note.copy gets its source back (the clipboard untouched); Y, with nothing selected, copies it for the person.
    const whole = await app.act({ action: "note.copy", tile: "reader", as: "test-agent" }) as any;
    expect(whole.clipboard).toBe(false);
    expect(whole.text).toContain("Here's a callout block.");
    const n = copies().length;
    press({ kind: "esc" });
    press({ kind: "char", ch: "Y" });
    await until(() => copies().length > n, "Y copied the whole note");
    expect(copies().at(-1)).toBe(osc52(whole.text));
    expect((app as any).message).toContain(`copied the note, ${whole.lines} lines`);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("rules (PIE-600): a rule note's bands, meeting-card's card, shout's band; the card goes and comes with its property through act; R shows it as written; done-stamp stamps once", async () => {
    const id = seeded.notes.rules.id, text = async (of = id) => (await board.get(of))!.text;
    const at = SECTIONS.findIndex(s => s.key === "rules");
    const reader = (n = 0) => S().stages.get(at)?.top.pane(n ? "reader2" : "reader")?.describe() as any;
    const drawn = () => (reader()?.decorations?.drawn ?? []) as { rule: string; place: string; status: string; on: string; line: number }[];
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "rules" }, as: "test-agent" })).toEqual({ section: at + 1, key: "rules" });
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT") && screen().includes("[meeting]") && drawn().filter(d => d.status === "ready").length === 4, "the card, the bands and the shout", 12_000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}\n${JSON.stringify(reader())?.slice(0, 2000)}`); });
    // The rule note's bands are in the headings' places, shout's in the line's; the card above the note.
    expect(drawn().map(d => [d.rule, d.place, d.on, d.line])).toEqual([
      ["meeting-card/card", "above", "block", 0], ["shout/shout", "replace", "text", 13],
      ["committee-bands", "replace", "construct", 6], ["committee-bands", "replace", "construct", 10],
    ]);
    let shown = screen();
    expect(shown).not.toContain("Close the cold frame tonight!!!");
    expect(shown).toContain("Ann, Bo, Cy");
    // Through act, as an agent: the meeting's type changed, the card goes (the text keeps everything else); back, it comes back.
    const before = await text();
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "chat" }, as: "test-agent" });
    await until(() => !drawn().some(d => d.rule === "meeting-card/card") && !screen().includes("[meeting]"), "the card gone", 8000);
    expect(await text()).toBe(before.replace("[type::meeting]", "[type::chat]"));
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "meeting" }, as: "test-agent" });
    await until(() => drawn().some(d => d.rule === "meeting-card/card" && d.status === "ready") && screen().includes("[meeting]"), "the card back", 10_000);
    expect(await text()).toBe(before);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // A band is still its heading: ( ) stops on it and f folds what's under it, the band drawn over the hidden lines.
    ch(")");
    await until(() => String(reader().folds?.selected ?? "").includes("Agenda"), "( ) on the Agenda band", 5000);
    ch("f");
    await until(() => !screen().includes("Water rota for August") && screen().includes("2 lines folded"), "the Agenda band folded", 5000);
    ch("f");
    await until(() => screen().includes("Water rota for August"), "unfolded", 5000);
    // R: the note as written, and back; nothing written.
    ch("R");
    await until(() => screen().includes("Close the cold frame tonight!!!") && screen().includes("## Agenda"), "the note as written", 5000);
    expect(reader().decorations).toMatchObject({ raw: true, drawn: expect.any(Array) });
    expect(screen()).not.toContain("CLOSE THE COLD FRAME TONIGHT");
    ch("R");
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT"), "decorated again", 5000);
    expect(await text()).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // done-stamp: the job's status set to done through act stamps it once, as the extension, and its own write sets nothing off.
    const job = (await board.children(id)).find(k => k.text.startsWith("Mend the water butt"))!;
    await until(() => reader(1)?.showing?.id === job.id, "the job beside", 5000);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "done" }, as: "test-agent" });
    const has = async (re: RegExp) => { const end = Date.now() + 10_000; while (!re.test(await text(job.id))) { if (Date.now() > end) throw new Error(`timed out waiting for ${re}`); await Bun.sleep(50); } };
    await has(/\[done-at::\d{4}-\d\d-\d\d\]/);
    const stamped = (await board.get(job.id))!;
    await Bun.sleep(2500);
    expect((await board.get(job.id))!.revision).toBe(stamped.revision);
    expect((await text(job.id)).match(/done-at/g)).toHaveLength(1);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "todo" }, as: "test-agent" });
    await has(/^(?![\s\S]*done-at)/);
  }, 60_000);

  test("tabs: a live figure's tabs and density, switched through act, by keys and by click; the note never written", async () => {
    const id = seeded.notes.plotJobs.id, before = (await board.get(id))!.text;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "tabs" }, as: "test-agent" })).toMatchObject({ key: "tabs" });
    await until(() => screen().includes("doing 2 · review 1 · validate 0 · done 1 · queued 2"), "the tab bar", 8000);
    const left = (l: string) => l.slice(S().stageRect.col, S().stageRect.col + Math.floor(S().stageRect.cols / 2));
    const half = () => sc.render(app).lines.map(plain).map(left).join("\n");
    // The first tab listed in order: doing, its rows; the others' rows aren't drawn.
    expect(half()).toContain("PLOT-2 — Sow the broad beans");
    expect(half()).not.toContain("PLOT-4");
    // An agent reads the figures, then switches the left reader's tab (a reader the person isn't typing in).
    const figs = await app.act({ action: "figures", tile: "1", as: "test-agent" }) as any;
    expect(figs.figures).toEqual([expect.objectContaining({ n: 1, kind: "tabs", title: "Plot jobs", density: "compact", tab: "doing" })]);
    expect(figs.figures[0].tabs.map((t: any) => `${t.value} ${t.count}`)).toEqual(["doing 2", "review 1", "validate 0", "done 1", "queued 2"]);
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "queued" }, as: "test-agent" })).toMatchObject({ tab: "queued", count: 2 });
    await until(() => half().includes("PLOT-4 — Order the seed potatoes"), "the queued tab");
    expect(half()).not.toContain("PLOT-2");
    // Only that reader: the other one on the same note still shows doing.
    expect(((await app.act({ action: "figures", tile: "2", as: "test-agent" })) as any).figures[0].tab).toBe("doing");
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "2" }, as: "test-agent" })).toMatchObject({ tab: "review" });
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "nope" }, as: "test-agent" })).rejects.toThrow(/no tab nope; its tabs: 1 doing, 2 review/);
    // element.open on a tab, as an agent, is figure.tab (its rules, its provenance): the right reader's 5th tab.
    const els = await app.act({ action: "elements", tile: "2", as: "test-agent" }) as any;
    const queued = els.elements.find((e: any) => e.kind === "figure" && e.label.startsWith("queued"));
    expect(await app.act({ action: "element.open", tile: "2", args: { n: queued.n }, as: "test-agent" })).toMatchObject({ tab: "queued" });
    expect(await app.act({ action: "figure.tab", tile: "2", args: { tab: "doing" }, as: "test-agent" })).toMatchObject({ tab: "doing" });
    // Density: compact cuts the long title with …; cozy wraps it to two lines, hanging past "PLOT-3 — "; comfortable three.
    await until(() => half().includes("PLOT-3 — Mend"), "the review tab");
    expect(half()).toMatch(/PLOT-3 — Mend the netting[^\n]*…/);
    expect(await app.act({ action: "figure.density", tile: "1", args: { to: "cozy" }, as: "test-agent" })).toMatchObject({ density: "cozy" });
    await until(() => half().includes("≡ cozy"), "cozy");
    const hang = () => { const rows = half().split("\n"), i = rows.findIndex(r => r.includes("PLOT-3 — Mend")); return { first: rows[i]!, next: rows[i + 1]!, third: rows[i + 2]! }; };
    let h = hang();
    const textAt = h.first.indexOf("Mend");
    expect(h.next.slice(0, textAt).replace(/[│║┊ ]/g, "")).toBe("");          // the second line starts under "Mend", past the id
    expect(h.next.slice(textAt, textAt + 1)).toMatch(/\S/);
    expect(h.next).toContain("…");
    expect(await app.act({ action: "figure.density", tile: "1", as: "test-agent" })).toMatchObject({ density: "comfortable" });
    await until(() => half().includes("≡ comfortable"), "comfortable");
    h = hang();
    expect(h.third.slice(textAt, textAt + 1)).toMatch(/\S/);
    await expect(app.act({ action: "figure.density", tile: "1", args: { to: "roomy" }, as: "test-agent" })).rejects.toThrow(/compact, cozy, comfortable/);
    // The person, by keys: into the stage (the left reader), [ ] onto the first element (a tab), → and tab step on.
    await app.act({ action: "figure.density", tile: "1", args: { to: "compact" }, as: "test-agent" });
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]");
    press({ kind: "right" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("validate");
    await until(() => half().includes("nothing in validate"), "the empty validate tab, listed in order");
    press({ kind: "tab" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("done");
    press({ kind: "backtab" }); press({ kind: "left" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("review");
    ch("=");
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].density).toBe("cozy");
    // By mouse: a click on the queued label in the left reader's bar.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => left(l).includes("queued 2")), x = left(rows[y]!).indexOf("queued 2") + S().stageRect.col + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => half().includes("PLOT-5 — Clear the bindweed"), "the queued tab, clicked");
    // The person types in the left reader (an edit): an agent's switch there is refused; the right reader's isn't.
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "doing" }, as: "test-agent" })).rejects.toThrow(/isn't typing in/);
    expect(await app.act({ action: "figure.tab", tile: "2", args: { by: 1 }, as: "test-agent" })).toMatchObject({ tab: "review" });
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
    // Every switch was reading state: the note's text is as seeded.
    expect((await board.get(id))!.text).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("hero header (PIE-598): the opening picture, scrolled under the header, becomes its dimmed background; reader.hero on=false keeps it plain", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "hero" }, as: "test-agent" })).toMatchObject({ key: "hero" });
    await until(() => screen().includes("▣ evening-beds.jpg") && !screen().includes("loading…"), "the hero note, its picture read", 8000);
    const reader = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes[0]; };
    const raw = () => sc.render(app).lines as string[];
    // The title rows inside the tiles (not a frame's label): the reader's is the row's first, the column's beside it.
    const titleRows = () => raw().filter(l => plain(l).includes("│An evening on the plot"));
    const titleRow = () => titleRows()[0]!;
    // At the top the picture is in view: the header knows its hero, at step 0, and is plain.
    expect(reader().header).toEqual({ backdrop: { image: "evening-beds.jpg", line: 2, step: 0, of: 3, mode: "first", drawn: null, focus: { x: 0.85, y: 0.6 } }, on: true, mode: "first" });
    expect(titleRow()).not.toContain("\x1b[48;2;");
    // Scrolled past it (an agent's scroll, through act): the header takes it, in this terminal's cells, by steps.
    await app.act({ action: "scroll", args: { by: 1 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.drawn === "cells", "the first step drawn", 8000);
    expect(reader().header.backdrop).toMatchObject({ image: "evening-beds.jpg", line: 2, step: 1, of: 3 });
    await app.act({ action: "scroll", args: { by: 4 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.step === 3 && reader().header.backdrop?.drawn === "cells", "the full step drawn", 8000);
    // Each header cell has its colour, dark (no channel above a third of full), the title's text on top.
    const bgs = [...titleRow().matchAll(/\x1b\[48;2;(\d+);(\d+);(\d+)m/g)].map(x => [+x[1]!, +x[2]!, +x[3]!]);
    expect(bgs.length).toBeGreaterThan(20);
    expect(Math.max(...bgs.flat())).toBeLessThan(90);
    expect(new Set(bgs.map(c => c.join(","))).size).toBeGreaterThan(1);
    expect(plain(titleRow())).toContain("An evening on the plot");
    // Turned off: every reader's header is plain, and the setting is kept for the next start.
    expect(await app.act({ action: "reader.hero", args: { on: false }, as: "test-agent" })).toEqual({ on: false, mode: "first" });
    expect(JSON.parse(readFileSync(join(process.env.EP0CH_STATE!, "reader-hero.json"), "utf8"))).toEqual({ on: false, mode: "first" });
    expect(reader().header).toEqual({ backdrop: null, on: false, mode: "first" });
    expect(titleRow()).not.toContain("\x1b[48;2;");
    expect(await app.act({ action: "reader.hero", args: { on: true }, as: "test-agent" })).toEqual({ on: true, mode: "first" });
    await until(() => reader().header.backdrop?.step === 3, "back on", 8000);
    // First mode: scrolled past the second picture, the header keeps the hero.
    await app.act({ action: "scroll", args: { to: "end" }, as: "test-agent" });
    await until(() => reader().header.backdrop?.image === "evening-beds.jpg" && reader().header.backdrop?.step === 3, "still the hero", 8000);
    // Follow mode: the second picture takes over as it scrolls under, fading in over the first, then alone.
    expect(await app.act({ action: "reader.hero", args: { on: true, mode: "follow" }, as: "test-agent" })).toEqual({ on: true, mode: "follow" });
    await until(() => reader().header.backdrop?.image === "allotment-dusk.jpg" && reader().header.backdrop?.step === 3, "the second picture", 8000);
    const second = reader().header.backdrop.line;
    await app.act({ action: "scroll", args: { to: "top" }, as: "test-agent" });
    // Step down until its line has just gone under: the first step, over the hero at full.
    for (let i = 0; i < 80 && reader().header.backdrop?.image !== "allotment-dusk.jpg"; i++) await app.act({ action: "scroll", args: { by: 1 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.drawn === "cells", "the crossfade drawn", 8000);
    expect(reader().header.backdrop).toMatchObject({ image: "allotment-dusk.jpg", line: second, step: 1, mode: "follow", over: "evening-beds.jpg" });
    expect(titleRow()).toContain("\x1b[48;2;");
    expect(await app.act({ action: "reader.hero", args: { on: true, mode: "first" }, as: "test-agent" })).toEqual({ on: true, mode: "first" });
    await expect(app.act({ action: "reader.hero", args: { on: true, mode: "every" }, as: "test-agent" })).rejects.toThrow(/first or follow/);
    // The river column beside it keeps the reader's header above its own scroll, and takes the picture there too.
    const column = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes[1]; };
    await until(() => !!column().column?.showing, "the column's note", 8000);
    const colTitle = () => (plain(titleRows()[0] ?? "").match(/│An evening on the plot/g) ?? []).length;
    expect(colTitle()).toBe(2);
    expect(column().column.header.backdrop).toMatchObject({ image: "evening-beds.jpg", step: 0 });
    const coloured = () => (titleRows()[0]!.match(/\x1b\[48;2;/g) ?? []).length, before = coloured();
    await app.act({ action: "column.scroll", args: { by: 12 }, tile: column().name, as: "test-agent" });
    await until(() => column().column.header.backdrop?.step === 3 && column().column.header.backdrop?.drawn === "cells", "the column's header, with the picture", 8000);
    // Scrolled, its title is still on screen (sticky), over the picture's colours.
    expect(colTitle()).toBe(2);
    expect(coloured()).toBeGreaterThan(before + 20);
  }, 30_000);

  test("title (PIE-657): the header leads with the breadcrumb and the title; the frame bar doesn't repeat it; the focused tile's title is brighter", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "title" }, as: "test-agent" })).toMatchObject({ key: "title" });
    await until(() => screen().includes("Before:") && !screen().includes("reading the note"), "the title note, read", 8000);
    const raw = () => sc.render(app).lines as string[];
    const readers = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes; };
    // Each reader's rows start with the breadcrumb, then the title, the dim byline under it; the title is data too.
    const rows = raw().map(plain);
    const at = rows.findIndex(l => /│A title you can find/.test(l));
    expect(at).toBeGreaterThan(0);
    expect(rows[at - 1]).toMatch(/│(…|top level|Kitchen sink|# )/);   // the breadcrumb, once its ancestors are read
    // Where the terminal does not scale text (this one, like Herdr or tmux), the title is one bold row and the byline is the very next: no blank row.
    expect(rows[at + 1]).toMatch(/i \d+ properties/);
    expect(readers().map((p: any) => p.showing?.title ?? p.title)).toContain("A title you can find");
    // The frame bar of a reader that shows its header says the tile, not the title again.
    const frames = rows.filter(l => /[╔┌].*(reader|detail)/.test(l));
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) expect(f).not.toContain("A title you can find");
    // The tile with the keys has the brighter title: the same title, the same row, two shades.
    const row = raw().find(l => (plain(l).match(/A title you can find/g) ?? []).length === 2)!;
    expect(row).toBeDefined();
    const shades = [...row.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m(?:\x1b\[1m)?A title you can find/g)].map(x => +x[1]! + +x[2]! + +x[3]!);
    expect(shades.length).toBe(2);
    expect(shades[0]).toBeGreaterThan(shades[1]! + 100);
  });

  test("wrapping links (title section): a link that wraps keeps its colour and its click on every row, in the narrow reader too", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "title" }, as: "test-agent" })).toMatchObject({ key: "title" });
    await until(() => screen().includes("winter") || screen().includes("valves"), "the links, read", 8000);
    const raw = () => sc.render(app).lines as string[];
    const sgr = (row: string, word: string, from = 0) => { const at = row.indexOf(word, from); return at < 0 ? null : row.slice(0, at).split("\x1b[").at(-1)!.split("m")[0]!; };
    const rowsWith = (word: string) => raw().map((r, y) => ({ r, y })).filter(x => plain(x.r).includes(word));
    // The first row of each link says its colour; every later word of it is drawn in the same one.
    const lead = (word: string) => sgr(rowsWith(word)[0]!.r, word)!;
    for (const [first, rest] of [["whiteboard,", ["valves", "Oct 9", "plan"]], ["Tyre pressures", ["winter", "summer", "valve notes"]]] as const) {
      const colour = lead(first);
      expect(colour).not.toBe(fg(C.grey).slice(2, -1));
      for (const w of rest) for (const { r } of rowsWith(w)) expect(sgr(r, w)).toBe(colour);
    }
    // At least one of the links wraps in the narrow reader, so a continuation row was checked.
    expect(rowsWith("valves").length + rowsWith("winter").length).toBeGreaterThan(2);
    // The element list names every link once, wrapped or not (a wrapped link is one element).
    const els = (await app.act({ action: "elements", tile: "reader", args: {}, as: "test-agent" }) as any).elements as any[];
    expect(els.filter(e => /kitchen whiteboard/i.test(e.label)).length).toBe(1);
    expect(els.filter(e => /Tyre pressures/.test(e.label)).length).toBe(1);
    // A click on the last row of the reference, in the narrow reader, follows the same link as a click on its first row.
    const panes = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes as any[]; };
    const half = Math.floor(plain(raw()[0]!).length * 0.55);
    const cont = raw().map((r, y) => ({ x: plain(r).indexOf("plan", half), y })).find(c => c.x >= 0)!;
    expect(cont).toBeDefined();
    expect(panes().map(p => p.showing?.title ?? p.title)).not.toContain("Kitchen whiteboard");
    press({ kind: "mouse", action: "down", button: 0, x: cont.x, y: cont.y }); press({ kind: "mouse", action: "up", button: 0, x: cont.x, y: cont.y });
    await until(() => panes().some(p => (p.showing?.title ?? p.title) === "Kitchen whiteboard"), "the click followed the link from its last row", 5000);
    // The click put the person on the stage: back to the index, where the next section is chosen.
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("images (PIE-532): sized, placed and the header, by act, by keys and by a click on a caption control; ctrl+z undoes", async () => {
    const id = seeded.notes.images.id, text = async () => (await board.get(id))!.text;
    const reads = async (has: (t: string) => boolean, what: string) => { const end = Date.now() + 5000; while (!has(await text())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${await text()}`); await Bun.sleep(30); } };
    const line = async (n: number) => (await text()).split("\n")[n - 1]!;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "images" }, as: "test-agent" })).toMatchObject({ key: "images" });
    await until(() => screen().includes("▣ seed-packet.webp") && !screen().includes("loading…"), "the images, read (a JPEG, a WebP and a PNG)", 8000);
    // An agent lists them, with the layout each line writes and what's wrong with none.
    const list = (await app.act({ action: "images", as: "test-agent" }) as any).images;
    expect(list.map((x: any) => [x.n, x.line, x.path.split("/").pop(), x.size ?? null, x.align ?? null, x.layout ?? null])).toEqual([
      [1, 2, "allotment-dusk.jpg", null, null, "hero"], [2, 6, "seed-packet.webp", "25%", "center", null], [3, 10, "allotment-dusk.jpg", "50%", "right", null], [4, 12, "seed-packet.webp", null, null, null],
      [5, 17, "allotment-notice.png", "50%", null, null],
    ]);
    expect(list[0].alt).toBe("the plot at dusk");
    // Sized, placed and made the header through the note's save, attributed; the header moves (one save, two lines).
    expect(await app.act({ action: "image.size", args: { n: 2, to: "40" }, as: "test-agent" })).toMatchObject({ changed: true, recordedAs: { author: "agent", actorId: "test-agent" } });
    expect(await line(6)).toContain("[size::40] [align::center]");
    await app.act({ action: "image.align", args: { line: 6, to: "left" }, as: "test-agent" });
    expect(await line(6)).not.toContain("[align::");
    await app.act({ action: "image.hero", args: { n: 4 }, as: "test-agent" });
    expect(await line(12)).toBe(`- [img::${list[3].path}] [height::6] [layout::hero]`);
    expect(await line(2)).not.toContain("[layout::hero]");
    await expect(app.act({ action: "image.align", args: { n: 4, to: "right" }, as: "test-agent" })).rejects.toThrow(/full width/);
    await expect(app.act({ action: "image.size", args: { n: 2, to: "huge" }, as: "test-agent" })).rejects.toThrow(/cells \(40\), a share \(50%\) or full/);
    await expect(app.act({ action: "image.size", args: { to: "50%" }, as: "test-agent" })).rejects.toThrow(/say which image/);
    await expect(app.act({ action: "image.size", args: { n: 2, by: 5 }, as: "test-agent" })).rejects.toThrow(/by is 1 or -1/);
    // How the header shows when it's too tall (whole, or cropped to fill), and how much an image is dimmed.
    await app.act({ action: "image.fit", args: { n: 1, to: "contain" }, as: "test-agent" });
    expect(await line(2)).toContain("[fit::contain]");
    await app.act({ action: "image.dim", args: { n: 5, to: "0.5" }, as: "test-agent" });
    expect(await line(17)).toContain("[dim::0.5]");
    await expect(app.act({ action: "image.dim", args: { n: 5, to: "bright" }, as: "test-agent" })).rejects.toThrow(/0 \(as it is\) to 1/);
    for (let i = 0; i < 2; i++) await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(2)).not.toContain("[fit::");
    expect(await line(17)).not.toContain("[dim::");
    // Its own undo puts each change back, newest first.
    for (let i = 0; i < 2; i++) await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(2)).toContain("[layout::hero]");
    expect(await line(6)).toContain("[size::40] [align::center]");
    await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(6)).toContain("[size::25%] [align::center]");
    // The person, by keys: into the stage, [ ] to the seed packet (the header's caption is the first element), + a step bigger.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]"); ch("]");
    ch("+");
    await reads(t => t.split("\n")[5]!.includes("[size::33%]"), "a step bigger: a third");
    press({ kind: "right" });
    await reads(t => t.split("\n")[5]!.includes("[align::right]"), "→ moved it right");
    ch("H");
    await reads(t => t.split("\n")[5]!.includes("[layout::hero]") && !t.split("\n")[1]!.includes("[layout::hero]"), "H made it the header");
    press({ kind: "char", ch: "z", ctrl: true });
    await reads(t => t.split("\n")[1]!.includes("[layout::hero]"), "ctrl+z: the header back");
    // By mouse: a click on the right-hand image's [−] (on its caption).
    const rows = sc.render(app).lines.map(plain);
    const y = rows.findIndex(l => l.includes("allotment-dusk.jpg") && l.includes("[◂]")), x = rows[y]!.indexOf("[−]") + 1;
    expect(y).toBeGreaterThan(0);
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await reads(t => t.split("\n")[9]!.includes("[size::33%]"), "a click on [−]: a step smaller");
    // The person writes in the note (an edit open): an agent's change is refused, the line untouched.
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "image.align", args: { n: 3, to: "left" }, as: "test-agent" })).rejects.toThrow(/open in a draft|typing in/);
    expect(await line(10)).toContain("[align::right]");
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
  }, 30_000);

  test("new notes (PIE-544): ctrl+n under the note read, a missing [[page]] offered then made, [page::x] titled; by keys, mouse and act", async () => {
    const guide = seeded.notes.newNotes.id;
    // Out of the stage the test before left the keys in: an agent changes sections only from the index.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    const inbox = (await board.roots()).find(r => r.props["system-view"] === "inbox")!.id;
    const reads = async (ok: () => Promise<boolean>, what: string) => { const end = Date.now() + 5000; while (!await ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); } };
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    expect(await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" })).toEqual({ section: n, key: "newnotes" });
    await until(() => screen().includes("Seed swap ledger ◌"), "the guide, its link missing", 8000);
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    // The person, by keys: into the stage, ] to the link, ⏎ offers the page (nothing made yet), ⏎ again makes it.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    reader().surface.selectLink(0);
    press({ kind: "enter" });
    await until(() => screen().includes("no page [[Seed swap ledger]]"), "the offer under the header");
    expect((await board.resolvePage("Seed swap ledger")).status).toBe("missing");
    // By mouse: a click on the link again makes it.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("Seed swap ledger ◌")), x = rows[y]!.indexOf("Seed swap ledger") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await reads(async () => (await board.resolvePage("Seed swap ledger")).status === "resolved", "the page made");
    const page = (await board.resolvePage("Seed swap ledger")).block!;
    expect(await board.get(page.id)).toMatchObject({ text: "Seed swap ledger [page::Seed swap ledger]", parentId: inbox });
    await until(() => reader().msg?.id === page.id, "the page opened in the reader");
    // Back (alt+←), as the reader's history goes.
    press({ kind: "alt-left" });
    await until(() => reader().msg?.id === guide, "back on the guide");
    // ctrl+n in the reader: a note under the guide, its edit open with the keys; ⏎ on [page::x] titles it, ctrl+s saves.
    press({ kind: "char", ch: "n", ctrl: true });
    // It opens in a detail beside the reader (as O opens one); this stage's reader follows what's current, so it shows it too.
    const writing = () => [...stage().panes.values()].find((p: any) => p.surface?.draft) as any;
    await until(() => !!writing(), "the new note's edit", 8000);
    const id = writing().surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(guide);
    expect(writing()).not.toBe(reader());
    for (const c of "[page::2026-03-12]") press({ kind: "char", ch: c });
    press({ kind: "enter" });
    expect(writing().surface.draft.text).toBe("2026-03-12 [page::2026-03-12]\n");
    for (const c of "Swapped borlotti for chard.") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    await reads(async () => (await board.get(id))!.text === "2026-03-12 [page::2026-03-12]\nSwapped borlotti for chard.", "the new note saved");
    // An agent: note.new and page.create through act, attributed, the person's keys and reader untouched.
    const before = reader().msg?.id;
    const made = await app.act({ action: "note.new", args: { text: "[page::2026-03-13]" }, as: "test-agent" }) as any;
    expect(made).toMatchObject({ rule: "inbox", parentId: inbox, title: "2026-03-13" });
    expect(await board.get(made.id)).toMatchObject({ text: "2026-03-13 [page::2026-03-13]", author: "test-agent" });
    const pg = await app.act({ action: "page.create", args: { address: "Pea trellis" }, as: "test-agent" }) as any;
    expect(pg).toMatchObject({ created: true });
    expect(await board.get(pg.id)).toMatchObject({ text: "Pea trellis [page::Pea trellis]", parentId: inbox, author: "test-agent" });
    expect(reader().msg?.id).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("new notes float (PIE-591): five rapid ctrl+n make five floating drafts; one docked by its title's drag, one saved, one from an edit; × on an empty one trashes it", async () => {
    const guide = seeded.notes.newNotes.id;
    for (let i = 0; i < 8 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" });
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    await until(() => reader()?.msg?.id === guide, "the guide in the reader", 8000);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // Floats left by the test before (its saved new note) aren't this test's.
    const old = new Set((stage().describe().floats as any[]).map(f => f.tile));
    const floats = () => (stage().describe().floats as any[]).filter(f => f.newNote && !old.has(f.tile));
    const before = (await board.children(guide)).length;
    // Five, as fast as the keys go: each a float of its own with its edit open, none waiting on the last.
    for (let i = 0; i < 5; i++) press({ kind: "char", ch: "n", ctrl: true });
    await until(() => floats().length === 5 && floats().every(f => f.writing), `five floating drafts, each in its edit (${JSON.stringify(stage().describe().floats)})`, 10_000);
    const kids = await board.children(guide);
    expect(kids.length).toBe(before + 5);
    // Siblings under the note read, never a chain of one under the next.
    for (const f of floats()) expect((await board.get(f.id))!.parentId).toBe(guide);
    // Cascaded, the newest on top with the keys, and the person in its edit.
    const rects = floats().map(f => f.rect);
    expect(new Set(rects.map(r => `${r.col},${r.row}`)).size).toBe(5);
    const top = floats().at(-1)!;
    expect(stage().describe().focusName).toBe(top.tile);
    await until(() => stage().newNoteWhileTyping(), "the person in the newest float's edit", 5000);
    // Saved: typed in the newest, ctrl+s.
    for (const c of "Chard seed: 2 rows") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    const saved = async (id: string, text: string) => { const end = Date.now() + 5000; while ((await board.get(id))?.text !== text) { if (Date.now() > end) throw new Error(`timed out waiting for ${text}`); await Bun.sleep(30); } };
    await saved(top.id, "Chard seed: 2 rows");
    // From an edit: into the fourth (its edit open, the keys elsewhere: e enters it), typed, then ctrl+n: saved, a sixth floats.
    const fourth = floats()[3]!;
    await stage().dispatch.press("tile.focus", {}, fourth.tile);
    press({ kind: "char", ch: "e" });
    await until(() => stage().newNoteWhileTyping() && stage().describe().focusName === fourth.tile, "in the fourth's edit", 5000);
    for (const c of "Leek trench") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "n", ctrl: true });
    await saved(fourth.id, "Leek trench");
    await until(() => floats().length === 6 && floats().at(-1)!.writing, "a sixth float from the edit", 8000);
    expect((await board.get(floats().at(-1)!.id))!.parentId).toBe(guide);
    // Docked by mouse: the first float's title dragged onto the reader's header joins its tabs.
    const first = floats()[0]!;
    const rows = () => sc.render(app).lines.map(plain);
    const titleRow = rows().findIndex(l => l.includes(`⧉ `) && l.includes(` ${first.tile} `));
    const fx = rows()[titleRow]!.indexOf(` ${first.tile} `) + 2;
    const head = rows().findIndex(l => /┌─ \d+ reader /.test(l));
    expect(titleRow).toBeGreaterThan(head);
    expect(head).toBeGreaterThan(0);
    const hx = rows()[head]!.indexOf(" reader ") + 2;
    press({ kind: "mouse", action: "down", button: 0, x: fx, y: titleRow });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head + 1 });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head });
    expect(plain(sc.render(app).lines.join("\n"))).toContain("release docks it");
    press({ kind: "mouse", action: "up", button: 0, x: hx, y: head });
    await until(() => !floats().some(f => f.id === first.id), "the first float docked", 5000);
    // A tab beside the reader now, in the layout: one tab set holding both.
    expect(((await stage().dispatch.press("layout.get")) as any).tree).toMatchObject({ tabs: ["reader", first.tile], active: first.tile });
    expect(stage().describe().focusName).toBe(first.tile);
    // × (tile.close) on an empty one: nothing typed, so it goes to the trash and its float with it.
    const empty = floats().find(f => f.id !== top.id && f.id !== fourth.id)!;
    await stage().dispatch.press("tile.close", {}, empty.tile);
    await until(() => !floats().some(f => f.id === empty.id), "the empty float closed", 5000);
    const end = Date.now() + 5000;
    while ((await board.children(guide)).some(k => k.id === empty.id)) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    // An agent's: made and shown floating for the person, attributed; their keys stay where they are.
    const keysOn = stage().describe().focusName;
    const made = await app.act({ action: "note.new", args: { text: "Bean poles: 12", opens: "float" }, as: "test-agent" }) as any;
    expect(made.reader).toBeTruthy();
    expect(stage().describe().focusName).toBe(keysOn);
    expect(await board.get(made.id)).toMatchObject({ author: "test-agent" });
    // Put the rest away, so the next test finds the stage as it was: each closed (saved, or trashed when empty).
    for (const f of [...floats(), ...(stage().describe().floats as any[]).filter(f => old.has(f.tile))]) await stage().dispatch.press("tile.close", {}, f.tile);
    await until(() => (stage().describe().floats as any[]).length === 0, "the floats put away", 8000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);

  test("figures (mdxcn): every Markdown kind drawn, live ones answered; a figure block's child bullets open their notes by act, keys and mouse", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "figures" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(x => x.key === "figures") + 1, key: "figures" });
    // Each kind, by what its Markdown drew; the live decision and uptime answered from the seeded notes.
    const shown = [
      "● Raised beds", "× Straight into the clay", "○ Grow bags",                       // decision, from Markdown
      "THE PLOT'S DECISIONS (LIVE)", "Netting the whole plot",                          // decision, live
      "> Ada", "Bo", "goes to look",                                                   // chat
      "PHOTO DRIVE BACKUPS (LIVE)", "2026-02-16", "2026-03-11",                         // uptime, live (source: backups)
      "SEEDS SOWN", "March 2026", "[11]", "seed potatoes in",                            // activity, calendar
      "[1] close the tap", "[2] three turns of PTFE tape",                              // annotate
      "— Ada, the allotment newsletter",                                               // a quote's byline
      "BEAN ROWS (CHILD BULLETS)", "May  plant out", "live · child notes",                                    // the figure block's child bullets
    ];
    // The whole note as a reader draws it (`ep0ch show`'s drawing, the surface itself): every kind there.
    // On a connection of its own, as `ep0ch show` from a shell beside the door would be.
    const own = new SocketBoard(scratch.sock);
    await own.info();
    const drawn = (await drawNote(own, seeded.notes.markdownFigures.id, 100))!.map(plain).join("\n");
    for (const m of shown) expect(drawn).toContain(m);
    // Narrow, the timeline of child bullets wraps its note whole (no · cut) with the spine beside it.
    const narrow = (await drawNote(own, seeded.notes.markdownFigures.id, 40))!.map(plain);
    const tlAt = narrow.findIndex(l => l.includes("plant out"));
    expect(tlAt, narrow.join("\n")).toBeGreaterThan(-1);
    expect(narrow.slice(tlAt, tlAt + 3).join("\n")).toMatch(/plant out[\s\S]*│\s+when the nights are warm/);
    const keys = (await drawNote(own, seeded.notes.keys.id, 100))!.map(plain).join("\n");
    own.close();
    for (const m of ["THE READER (FROM THE REGISTRY)", "[e]", "edit", "[g] then [d]", "[ctrl][k]"]) expect(keys).toContain(m);
    // drawNote listened for the door's answers: it never took the door's live connection.
    expect(liveBoard()).toBe((app as any).board);
    // The left reader scrolls: read every element's label instead of the screen for what's below it.
    const els = async () => ((await app.act({ action: "elements", tile: "reader", as: "test-agent" })) as any).elements as { n: number; kind: string; label: string; current?: boolean }[];
    for (let end = Date.now() + 8000; !(await els()).some(e => e.kind === "row" && e.label.includes("plant out")); await Bun.sleep(50))
      if (Date.now() > end) throw new Error("timed out waiting for the figure block's child rows as elements");
    const rows = (await els()).filter(e => e.kind === "row");
    // The live decision's rows and the child bullets are rows; the Markdown ones (no note behind them) aren't.
    expect(rows.map(r => r.label)).toEqual(expect.arrayContaining(["Raised beds for the squash", "sow under glass", "plant out", "first picking"]));
    expect(rows.some(r => r.label === "Raised beds")).toBe(false);
    const may = rows.find(r => r.label === "plant out")!;
    // An agent opens a child bullet's note in another reader (never the person's).
    const opened = await app.act({ action: "element.open", tile: "reader", args: { n: may.n, fresh: true }, as: "test-agent" }) as any;
    expect(JSON.stringify(opened)).toContain("plant out");
    // The person, by keys: into the stage, [ ] to the row, ⏎ opens its note in the reader.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    for (let i = 0; i < 80 && !(await els()).find(e => e.current && e.label === "sow under glass"); i++) ch("]");
    expect((await els()).find(e => e.current)?.label).toBe("sow under glass");
    press({ kind: "enter" });
    await until(() => screen().includes("Apr: sow under glass") && !screen().includes("SQUASH BEDS"), "the child bullet's note open in the reader", 5000);
    // Back (backspace), where the reader was, then by mouse: a click on another child row opens its note.
    press({ kind: "backspace" });
    // Back where it was, the figure block's row on screen (the reader keeps its place).
    const rowAt = () => sc.render(app).lines.map(plain).findIndex(l => /┊ ●  Apr  sow under glass/.test(l));
    await until(() => rowAt() >= 0, "back on the figures note, the child row on screen", 5000);
    const y = rowAt(), x = sc.render(app).lines.map(plain)[y]!.indexOf("sow under glass") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !screen().includes("BEAN ROWS (CHILD BULLETS)"), "the child bullet's note opened by a click", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);

  test("spine: the board's lanes are ordered by hand: card.reorder through act, alt+↓ and a drag", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "spine" }, as: "test-agent" })).toMatchObject({ key: "spine" });
    const desk = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "spine")).top as any; };
    const model = () => desk().modelFor("lanes") as any;
    await until(() => !!model()?.lanes?.length && model().lanes.every((l: any) => l.items), "the board's lanes", 8000);
    const queued = () => model().lanes.find((l: any) => l.name === "Queued");
    const ids = () => queued().items.map((m: any) => m.id);
    const first = ids();
    expect(first.length).toBeGreaterThan(1);
    // An agent puts the last card first.
    expect(await app.act({ action: "card.reorder", args: { card: first.at(-1), to: 0 }, as: "test-agent" })).toMatchObject({ lane: "Queued", position: 0 });
    await until(() => ids()[0] === first.at(-1), "the agent's reorder");
    // The person's alt+↓ on the first card.
    press({ kind: "enter" });
    model().lane = model().lanes.indexOf(queued()); queued().sel = 0;
    press({ kind: "alt-down" });
    await until(() => ids()[1] === first.at(-1), "alt+↓");
    // A drag of the second card onto the first's row.
    // The stage's tiles are placed inside the showcase's stage: a click is offset by where the stage is.
    const r = desk().rectOf(queued()), l = queued(), at = S().stageRect;
    const yOf = (i: number) => { for (let y = r.row + 1; y < r.row + r.rows; y++) if (l.rowAt(y - r.row - 1) === i) return y + at.row; throw new Error(`no row ${i}`); };
    const x = r.col + 4 + at.col, from = yOf(1), to = yOf(0), moving = ids()[1];
    press({ kind: "mouse", action: "down", button: 0, x, y: from });
    press({ kind: "mouse", action: "drag", button: 32, x, y: to });
    press({ kind: "mouse", action: "up", button: 0, x, y: to });
    await until(() => ids()[0] === moving, "the drag");
    press({ kind: "esc" });
  }, 30_000);

  test("folds: a tile folds to a spine by the glyph's click, alt+click, alt+h and act, and a click on the spine opens it at its size", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "folds" }, as: "test-agent" })).toMatchObject({ key: "folds" });
    await until(() => marks.folds!.every(m => screen().includes(m)), "the folds section");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    const at = () => S().stageRect;
    const click = (x: number, y: number, mods?: number) => { press({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); press({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); };
    const glyph = (name: string) => { sc.render(app); return (stage().foldButtons as any[]).find(b => stage().nameOf(b.id) === name); };
    const clickGlyph = (name: string, mods?: number) => { const g = glyph(name); expect(g).toBeDefined(); click(at().col + g.from, at().row + g.row, mods); sc.render(app); };
    // By mouse: the outline folds down the side (3 cells), the reader folds into one row with alt+click; each a click on its spine opens it.
    const before = { tree: tile("tree").rect, reader: tile("reader").rect };
    clickGlyph("tree");
    expect(tile("tree").collapsed).toBe(true);
    expect(tile("tree").rect.cols).toBe(3);
    click(at().col + tile("tree").rect.col + 1, at().row + tile("tree").rect.row + 3); sc.render(app);
    expect(tile("tree").collapsed).toBeUndefined();
    expect(tile("tree").rect).toEqual(before.tree);
    clickGlyph("reader", 8);
    expect(tile("reader")).toMatchObject({ collapsed: true, collapsedDir: "h" });
    expect(tile("reader").rect.rows).toBe(1);
    expect(sc.render(app).lines.map(plain).join("\n")).toContain("▸ ");
    click(at().col + tile("reader").rect.col + 2, at().row + tile("reader").rect.row); sc.render(app);
    expect(tile("reader").collapsed).toBeUndefined();
    expect(tile("reader").rect).toEqual(before.reader);
    // By keys: alt+h on the focused tile and again.
    if (S().focus !== "stage") press({ kind: "enter" });
    const focused = tiles().find(x => x.focused).name;
    press({ kind: "alt", ch: "h" });
    expect(tile(focused).collapsed).toBe(true);
    press({ kind: "alt", ch: "h" });
    expect(tile(focused).collapsed).toBeUndefined();
    // By bare keys (PIE-699): - folds the focused tile, + and = open it, and - on a spine opens it too.
    press({ kind: "char", ch: "-" });
    expect(tile(focused).collapsed).toBe(true);
    press({ kind: "char", ch: "+" });
    expect(tile(focused).collapsed).toBeUndefined();
    press({ kind: "char", ch: "-" });
    press({ kind: "char", ch: "=" });
    expect(tile(focused).collapsed).toBeUndefined();
    press({ kind: "char", ch: "-" });
    press({ kind: "char", ch: "-" });
    expect(tile(focused).collapsed).toBeUndefined();
    // By act: an agent folds a tile the person doesn't have, horizontally, and opens it; the keys stay.
    const other = tiles().find(x => x.name === "activity" && !x.focused)?.name ?? "activity";
    const focus0 = tiles().find(x => x.focused).name;
    expect(await app.act({ action: "tile.collapse", tile: other, args: { dir: "v" }, as: "test-agent" })).toMatchObject({ collapsed: true, dir: "v" });
    expect(tile(other)).toMatchObject({ collapsed: true, collapsedBy: "test-agent" });
    expect(await app.act({ action: "tile.expand", tile: other, args: {}, as: "test-agent" })).toMatchObject({ collapsed: false });
    expect(tiles().find(x => x.focused).name).toBe(focus0);
    await expect(app.act({ action: "tile.collapse", tile: focus0, args: { on: true }, as: "test-agent" })).rejects.toThrow(/has the person's keys/);
    press({ kind: "esc" });
  }, 30_000);

  test("hyper (PIE-699): mods-15 Kitty reports reach the door from a draft and from a terminal tile once the layer is on; keys.probe shows what a chord arrived as", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "hyper" }, as: "test-agent" })).toMatchObject({ key: "hyper" });
    await until(() => marks.hyper!.every(m => screen().includes(m)), "the hyper section");
    if (S().focus !== "stage") press({ kind: "enter" });
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    /** A terminal's bytes through the door's own decoder, the keys it makes pressed as the terminal's would be. */
    const sent = (bytes: string) => {
      const seen: Key[] = [], d = new KeyDecoder({ cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: false } as any);
      d.keyHandler = k => seen.push(k);
      d.rawSink = stage().rawKeys?.() ? () => () => {} : null;
      d.feed(bytes);
      (app as any).term.lastSeq = d.lastSeq;
      for (const k of seen) press(k);
      return seen;
    };
    const reader = tiles().find(x => x.kind === "reader").name;
    // Off (the default): the chord is super+K, nothing folds, and the hint row has no chip.
    expect(hyperOn()).toBe(false);
    expect(sent("\x1b[45;16u")).toEqual([{ kind: "super", ch: "-" }]);
    expect(tile(reader).collapsed).toBeUndefined();
    expect(stage().hyperChip).toBeNull();
    // On: ✦- folds the focused tile, ✦= opens it; the chip is on the hint row.
    useHyper(true);
    try {
      app.redraw(); screen(); expect(stage().hyperChip).not.toBeNull();
      const focused = tiles().find(x => x.focused).name;
      expect(sent("\x1b[45;16u")).toEqual([{ kind: "hyper", ch: "-" }]);
      expect(tile(focused).collapsed).toBe(true);
      sent("\x1b[61:43;16u");                                                            // ✦= as the terminal sends it: = with shift, mods 15
      expect(tile(focused).collapsed).toBeUndefined();
      // From a draft: the edit stays on the spine, whole.
      press({ kind: "mouse", action: "down", button: 0, x: S().stageRect.col + tile(reader).rect.col + 4, y: S().stageRect.row + tile(reader).rect.row + 4 });
      press({ kind: "mouse", action: "up", button: 0, x: S().stageRect.col + tile(reader).rect.col + 4, y: S().stageRect.row + tile(reader).rect.row + 4 });
      press({ kind: "char", ch: "e" }); press({ kind: "char", ch: "e" });
      await until(() => !!stage().panes.get(stage().focus)?.draft, "the draft", 8000);
      for (const c of " seeds") press({ kind: "char", ch: c });
      sent("\x1b[45;16u");
      expect(tile(reader).collapsed).toBe(true);
      expect(stage().panes.get(stage().idNamed?.(reader) ?? stage().focus)?.draft).toBeTruthy();
      sent("\x1b[61;16u");
      expect(tile(reader).collapsed).toBeUndefined();
      press({ kind: "esc" }); press({ kind: "esc" });
      // From the terminal tile the person types in: the chord stays the door's (the decoder keeps it from the program).
      const shell = tiles().find(x => x.kind === "pty").name;
      await app.act({ action: "tile.focus", tile: shell, as: "test-agent" }).catch(() => {});
      void stage().dispatch.act({ action: "tile.focus", tile: shell }, { kind: "user" });
      void stage().dispatch.act({ action: "tile.enter", tile: shell }, { kind: "user" });
      await until(() => stage().rawKeys(), "typing in the shell", 5000);
      expect(sent("\x1b[45;16u")).toEqual([{ kind: "hyper", ch: "-" }]);
      expect(tile(shell).collapsed).toBe(true);
      sent("\x1b[61;16u");
      expect(tile(shell).collapsed).toBeUndefined();
      // keys.probe: describes the next chord, runs none; esc ends it.
      await app.dispatch.press("keys.probe");
      expect((app as any).term.rawSink()).toBeNull();                                      // probing in a terminal tile: nothing goes to its program
      sent("\x1b[107;16u");
      const said = (app as any).message as string;
      expect(said).toContain("bytes CSI 107;16u");
      expect(said).toContain("modifiers ⌃⌥⇧⌘");
      expect(said).toContain("hyper+k");
      expect(tile(shell).collapsed).toBeUndefined();
      press({ kind: "esc" });
      expect((app as any).message).toContain("key probe ended");
      // An agent can't probe: it would swallow the person's keys.
      await expect(app.act({ action: "keys.probe", args: {}, as: "test-agent" })).rejects.toThrow(/person/);
    } finally { useHyper(null); press({ kind: "char", ch: "]", ctrl: true }); press({ kind: "esc" }); press({ kind: "esc" }); }
  }, 40_000);

  test("mounts (PIE-651): the board mounted live folds to a spine named for it and opens by click, alt+h and act; it pops out to the full board and back; its lanes alone; a tab holding a group", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" })).toMatchObject({ key: "screen" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().describe().panes as any[];
    const tile = (name: string) => tiles().find(x => x.name === name);
    const at = () => S().stageRect;
    const click = (x: number, y: number, mods?: number) => { press({ kind: "mouse", action: "down", button: 0, x, y, ...(mods ? { mods } : {}) }); press({ kind: "mouse", action: "up", button: 0, x, y, ...(mods ? { mods } : {}) }); };
    const get = async () => (await app.act({ action: "layout.get", args: {}, as: "test-agent" })) as any;
    // layout.get: each mount says what it mounts, and its own layout under its own ids; the lanes alone are filled, the place holder gone.
    await until(() => { sc.render(app); const m = stage().pane("lanes")?.layoutOf(true).mount; return m?.layout?.tiles.length > 0 && m.layout.tiles.every((t: any) => t.kind === "query"); }, "the lanes mount filled", 8000);
    const l0 = await get();
    const bm = l0.tiles.find((t: any) => t.name === "board");
    expect(bm).toMatchObject({ kind: "screen", mount: { screen: "board", group: false, layout: { focus: expect.any(String) } } });
    expect(bm.mount.layout.tiles.map((t: any) => t.name)).toEqual(expect.arrayContaining(["preview", "tree", "backlinks"]));
    expect(l0.tiles.find((t: any) => t.name === "lanes").mount).toMatchObject({ screen: "board", part: "lanes" });
    await until(() => /^board · /.test(tile("board").title), "the board's title");
    const before = tile("board").rect;
    // By act: the person's folds and opens the board (it has their keys, so an agent's is refused); an agent's folds the lanes mount.
    expect(tiles().find(x => x.focused).name).toBe("board");
    await expect(app.act({ action: "tile.collapse", tile: "board", args: {}, as: "test-agent" })).rejects.toThrow(/has the person's keys/);
    expect(await stage().dispatch.press("tile.collapse", {}, "board")).toMatchObject({ collapsed: true });
    expect(await stage().dispatch.press("tile.expand", {}, "board")).toMatchObject({ collapsed: false });
    expect(await app.act({ action: "tile.collapse", tile: "lanes", args: {}, as: "test-agent" })).toMatchObject({ collapsed: true });
    expect(tile("lanes").title).toMatch(/^board · .* · lanes$/);
    expect(await app.act({ action: "tile.expand", tile: "lanes", args: {}, as: "test-agent" })).toMatchObject({ collapsed: false });
    // A tile inside the mount by its path: the board's own preview folds there, and nothing out here moves.
    expect(await app.act({ action: "tile.collapse", tile: "board/preview", args: { on: true }, as: "test-agent" })).toMatchObject({ tile: "board/preview", collapsed: true });
    expect((await get()).tiles.find((t: any) => t.name === "board").mount.layout.tiles.find((t: any) => t.name === "preview").collapsed).toBe(true);
    await app.act({ action: "tile.expand", tile: "board/preview", args: {}, as: "test-agent" });
    // A tab holding a split: the reader and the thread gathered into a group in the reader's tab.
    const grouped = await app.act({ action: "tile.group", tile: "reader", args: { with: "replies" }, as: "test-agent" }) as any;
    expect(grouped).toMatchObject({ grouped: ["reader", "replies"] });
    const gt = (await get()).tiles.find((t: any) => t.name === grouped.tile);
    expect(gt.tabs).toEqual([grouped.tile, "activity"]);
    expect(gt.mount).toMatchObject({ group: true, layout: { tree: { split: "row" } } });
    expect(gt.mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["reader", "replies"]);
    await expect(app.act({ action: "tile.group", tile: grouped.tile, args: { on: false }, as: "test-agent" })).rejects.toThrow(/is a tab/);
    // Pop out (the person's): the full board over this screen, its own instance; screen.mount (as q does) comes back to the mount where it was.
    expect(await stage().dispatch.press("mount.out", {}, "board")).toMatchObject({ screen: "board" });
    await until(() => stage().spec?.name === "board", "the full board");
    expect(stage().poppedFrom).toBeTruthy();
    expect(await stage().dispatch.press("screen.mount", {})).toMatchObject({ back: true, tile: "board" });
    await until(() => stage().spec?.name === "showcase", "back on the stage");
    expect(tile("board")).toMatchObject({ kind: "screen", rect: before });
    // By mouse: the ▾ on its frame folds it (stacked over the lanes: a horizontal spine named for the screen); a click on the spine opens it at its size.
    sc.render(app);
    const g = (stage().foldButtons as any[]).find(b => stage().nameOf(b.id) === "board");
    click(at().col + g.from, at().row + g.row); sc.render(app);
    expect(tile("board")).toMatchObject({ collapsed: true, collapsedDir: "h", title: expect.stringMatching(/^board · /) });
    expect(sc.render(app).lines.map(plain).join("\n")).toMatch(/▸ board · /);
    click(at().col + tile("board").rect.col + 2, at().row + tile("board").rect.row); sc.render(app);
    expect(tile("board").collapsed).toBeUndefined();
    expect(tile("board").rect).toEqual(before);
    // By keys, with the keys on it (the spine's click gave them): alt+h folds and opens it; ^W e goes in, ctrl+] comes out.
    expect(tiles().find(x => x.focused).name).toBe("board");
    press({ kind: "alt", ch: "h" });
    expect(tile("board").collapsed).toBe(true);
    press({ kind: "alt", ch: "h" });
    expect(tile("board").collapsed).toBeUndefined();
    press({ kind: "char", ch: "w", ctrl: true }); ch("e");
    expect(tile("board").title).toMatch(/· in$/);
    press({ kind: "char", ch: "]", ctrl: true });
    expect(tile("board").title).not.toMatch(/· in$/);
    press({ kind: "esc" });
  }, 40_000);

  test("gathering into a group (PIE-696): shift+click picks tiles and ^W G gathers them, a tile's title dragged onto a group goes in and back out, ^W G in a split asks, and a preview across the group's edge keeps following", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" })).toMatchObject({ key: "screen" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    const at = () => S().stageRect;
    const get = async () => (await app.act({ action: "layout.get", args: {}, as: "test-agent" })) as any;
    const tile = async (name: string) => (await get()).tiles.find((t: any) => t.name === name);
    const groups = async () => (await get()).tiles.filter((t: any) => t.mount?.group).map((t: any) => t.name) as string[];
    const mouse = (action: "down" | "drag" | "up", x: number, y: number, mods?: number) => { press({ kind: "mouse", action, button: 0, x, y, ...(mods ? { mods } : {}) }); sc.render(app); };
    const drag = (a: [number, number], b: [number, number]) => { mouse("down", ...a); mouse("drag", a[0] + 1, a[1]); mouse("drag", ...b); mouse("up", ...b); };
    const title = async (name: string): Promise<[number, number]> => { const r = (await tile(name)).rect; return [at().col + r.col + 3, at().row + r.row]; };
    sc.render(app);
    // The mounts test above left a group in the reader's tab: it comes out of the tab set (^W T) and spills, so the stage is as laid out.
    for (const g of await groups()) { await stage().dispatch.press("layout.move", { to: g, where: "right" }, g); await stage().dispatch.press("tile.group", { on: false }, g); }
    sc.render(app);
    const focus0 = (await get()).focus;
    mouse("down", ...(await title("lanes")), 4); mouse("up", ...(await title("lanes")), 4);
    mouse("down", ...(await title("card")), 4); mouse("up", ...(await title("card")), 4);
    expect((await tile("lanes")).picked).toBe(true);
    expect((await tile("card")).picked).toBe(true);
    expect((await get()).focus).toBe(focus0);                 // picking moves no keys
    // An agent's pick of the same tile is its own, and shows beside the person's.
    expect(await app.act({ action: "tile.select", tile: "card", args: {}, as: "test-agent" })).toMatchObject({ selected: ["card"] });
    expect((await tile("card")).pickedBy).toEqual(["test-agent"]);
    await app.act({ action: "tile.select", args: { clear: true }, as: "test-agent" });
    // ^W G: the picked two, gathered side by side.
    const before = await groups();
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "G" }); sc.render(app);
    const made = (await groups()).find(g => !before.includes(g))!;
    expect(made).toBeDefined();
    const gt = await tile(made);
    expect(gt.mount.layout.tiles.map((t: any) => t.name).sort()).toEqual(["card", "lanes"]);
    // A tile's title dragged onto the group goes in where its drop zone says; the preview "card" follows the board across the edge.
    expect(await tile("card")).toBeUndefined();
    const reader = await title("reader"), r = (await tile(made)).rect;
    drag(reader, [at().col + r.col + r.cols - 3, at().row + r.row + Math.floor(r.rows / 2)]);
    expect((await tile(made)).mount.layout.tiles.map((t: any) => t.name)).toContain("reader");
    // Out again by dragging its title past the group, onto the board's lower edge.
    const g2 = (await tile(made)).mount.layout.tiles.find((t: any) => t.name === "reader").rect, g1 = (await tile(made)).rect;
    const b = (await tile("board")).rect;
    drag([at().col + g1.col + 1 + g2.col + 3, at().row + g1.row + 1 + g2.row], [at().col + b.col + b.cols - 2, at().row + b.row + Math.floor(b.rows / 2)]);
    expect(await tile("reader")).toBeDefined();
    // ^W G in a split asks: this tile or the whole split.
    await stage().dispatch.press("tile.focus", {}, "board");
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "G" }); sc.render(app);
    const ask = stage().overlays.top() as { name: string; items: { label: string }[] } | null;
    expect(ask).toMatchObject({ name: "gather" });
    expect(ask!.items[0]!.label).toMatch(/^this tile · board/);
    expect(ask!.items[1]!.label).toMatch(/^the whole split · /);
    press({ kind: "esc" });
    expect(stage().overlays.top()).toBeFalsy();
    // Spill the gathered group: the tiles are back as they were.
    await stage().dispatch.press("tile.group", { on: false }, made);
    sc.render(app);
    expect(await tile("lanes")).toBeDefined();
    expect(await tile("card")).toBeDefined();
  }, 40_000);

  test("on an outline without the showcase it says so and writes nothing", async () => {
    const other = new Scratch();
    const b = new SocketBoard(await other.start());
    await b.info();
    const before = (await b.roots()).length;
    const t = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const a = new App(t as any, b, Date.now(), () => {});
    const s = new Showcase();
    a.push(s);
    await until(() => (s as any).problem !== "", "the answer", 5000);
    expect(s.render(a).lines.map(plain).join("\n")).toContain("This outline has no showcase");
    expect((await b.roots()).length).toBe(before);
    a.quit(); b.close(); await other.dispose();
  }, 20_000);
});


// `ep0ch --showcase --reset` while a showcase door stays open: the reset stops the host, deletes the outline and
// seeds a new one, and the open door reconnects to it. The new seed's notes are new blocks, and the same seed ends
// on the same sequence, so the catch-up finds nothing missed: the screen has to notice its root is another one and
// read the notes again, or the notebook it keeps embeds ids the new outline doesn't have (each read `◌`).
describe.skipIf(!outliner)("the showcase screen across a --reset", () => {
  const scratch = new Scratch(undefined, "showcase");
  let board: SocketBoard, app: App, sc: Showcase;
  const screen = () => sc.render(app).lines.map(plain).join("\n");
  const S = () => sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    await scratch.start();
    await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    board.reconnectMs = 50;
    await board.info();
    // Tall enough that the notebook's embeds, near its end, are on screen.
    const term = { info: { cols: 200, rows: 130, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const embeds = ["» Kitchen whiteboard", "Shopping: oats, lemons, washing-up liquid.", "» Kitchen tap ^t-7a9c11", "[~] fix the dripping tap"];

  test("the notebook's embeds show their notes after the outline is reset under the open door", async () => {
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), "the notebook's embeds before the reset", 8000);
    const before = S().notes.root.id;
    // The person has the help over it meanwhile: the showcase isn't on top, so the outline's events don't reach it.
    app.push(new Help());
    // What try-it.sh --reset does: stop the host, delete the outline, start again and seed it anew.
    await scratch.stop();
    rmSync(scratch.outlines, { recursive: true, force: true });
    mkdirSync(scratch.outlines, { recursive: true });
    await scratch.start();
    await scratch.seedShowcase();
    await until(() => (app.reconnects ?? 0) > 0, "the door reconnected", 10_000);
    app.pop();
    screen();
    await until(() => S().notes?.root?.id !== before && !!S().notes?.root, "the showcase read again", 15_000);
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), `the notebook's embeds after the reset: ${embeds.filter(m => !screen().includes(m)).join(" | ")}`, 10_000);
    expect(screen()).not.toContain("◌");
  }, 60_000);
});

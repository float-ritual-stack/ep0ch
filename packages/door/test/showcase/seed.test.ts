// PIE-439: the showcase. Its seed (every section's content, written through the service). The screen's own tests are the
// files beside this one (harness.ts); the `scripts/try-it.sh --showcase` script (seeding, --reset, its pidfile) is
// test/try-it.test.ts's. Scratch services only; the seed is fictional.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Desk } from "../../src/desk/desk";
import { GRAPH_KINDS } from "../../src/graphs";
import { Help } from "../../src/screens";
import { CHORE_QUEUE, FIGURE_KINDS, LANES, MARKDOWN_KINDS, loadShowcase, RECENT_FILES, RECENT_SESSION, REMOTE_LINE, SEED, seedShowcase, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase, SHOWCASE_ACTIONS } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { drawNote } from "../../src/notes-cli";
import { C } from "../../src/style";
import { outliner, Scratch, until } from "../scratch";
import { prop } from "../../src/props";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");


test("the README's showcase says what SECTIONS registers by key, never a count; the action's summary names every key", () => {
  const readme = readFileSync(join(import.meta.dir, "../../README.md"), "utf8");
  expect(readme).toContain("act section name=<n|key>");
  expect(readme).not.toMatch(/live, in [a-z-]+ sections|name=<1-\d+\|key>/);
  const summary = SHOWCASE_ACTIONS.list().find((a: any) => a.name === "section")!.summary;
  expect(summary).toContain(`name=<1-${SECTIONS.length}>`);
  for (const s of SECTIONS) expect(summary).toContain(s.key);
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
    expect((await board.roots()).filter(r => prop(r, "type") === "showcase").length).toBe(1);
  });

  test("no seeded note leaves a construct open but the half-written one, so no reader shows a ⚠ by accident (PIE-669)", async () => {
    const { syntaxWarnings } = await import("@ep0ch/outline-core/syntax-warnings");
    const open: string[] = [];
    for (const [name, m] of Object.entries(seeded.notes)) {
      const text = (await board.get(m.id))?.text ?? "";
      // Pick a tile's "misread" button is its demo of a button that runs nothing (PIE-1312): that one warning, and no other.
      const meant = (w: { message: string }) => name === "pickATile" && w.message.startsWith("the ::button on line 5 runs nothing: act= ends early");
      if (name !== "halfWritten") open.push(...syntaxWarnings(text).filter(w => !meant(w)).map(w => `${name}: ${w.message}`));
    }
    expect(open).toEqual([]);
    expect(syntaxWarnings((await board.get(seeded.notes.pickATile.id))!.text).filter(w => w.message.includes("runs nothing"))).toHaveLength(1);
    expect(syntaxWarnings(seeded.notes.halfWritten.text).map(w => w.kind)).toEqual(["fence", "page-link"]);
  });

  test("the remote writes note (PIE-615): a remote client's patch at propose is a proposal under it, its comment a thread, the note unchanged", async () => {
    const note = seeded.notes.remoteWrites;
    const now = (await board.get(note.id))!;
    expect(now.text).toContain(REMOTE_LINE);
    const proposal = (await board.children(note.id)).find(m => prop(m, "type") === "draft-proposal");
    expect(proposal?.text).toContain("from @chat.example.test: not applied, because its writer may propose changes here, not make them");
    // Beside the note (PIE-725): its text names no proposal.
    expect(now.text).not.toContain(proposal!.id);
    expect((await board.comments(note.id))).toEqual([expect.objectContaining({ body: "Was that the peat-free kind?", quote: "two bags of compost", open: true })]);
  });

  test("a board hub whose lanes are saved views, with cards in every stage", async () => {
    const lanes = (await board.children(seeded.notes.hub.id)).filter(k => prop(k, "type") === "virtual-branch");
    expect(lanes.map(l => l.text.split(" [")[0])).toEqual([...LANES]);
    const counts: Record<string, number> = {};
    for (const l of lanes) { const r = await board.readSavedView(l.id); expect(r?.status).toBe("ready"); counts[l.text.split(" [")[0]!] = r!.blocks.length; }
    expect(counts).toEqual({ Queued: 2, Doing: 2, Review: 1, Done: 1 });
    // Roadmap items through the allocator: work-ids, under the project's work queue.
    expect(seeded.cards.map(c => prop(c, "work-id"))).toEqual(["HOME-001", "HOME-002", "HOME-003", "HOME-004", "HOME-005", "HOME-006"]);
    expect(seeded.cards.every(c => c.parentId === seeded.notes.queue.id)).toBe(true);
    const garden = await board.readSavedView(seeded.notes.gardenView.id);
    expect(garden?.blocks.map(b => b.text.split(" [")[0])).toEqual(expect.arrayContaining(["Water the beans", "Turn the compost", "Net the brassicas"]));
  });

  test("the relation atoms: under:, NOT and title~ in a live figure's query (PIE-554)", async () => {
    const choresId = seeded.notes.chores.id;
    expect(seeded.notes.figures.text).toContain(`query: "under:((${choresId})) type=chore NOT stage=done NOT title~hob"`);
    // The service parses the expression, as a live figure asks it (src/live.ts); board.query splits plain clauses itself.
    const ask = async (where: string) => board.toMsgs((await board.request<{ blocks: any[] }>("blocks.query", { query: { where, limit: 50 } })).blocks);
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
    // Quoting the syntax (PIE-764): what backticks and a fence hold is drawn as written, and is no link or property.
    expect(drawn.some(l => l.includes("((transcript^t0817|at 08:17))"))).toBe(true);
    expect(await scope("key")).toEqual([]);
    const links = await board.authoredLinks(seeded.notes.notebook.id);
    if (links.kind !== "ready") throw new Error(links.kind);
    expect(links.outlinks.entries.map(e => e.label).filter(l => ["at 08:17", "Compost heap", "transcript"].includes(l))).toEqual([]);
  });

  test("comment threads, open and resolved; children; every figure kind", async () => {
    const threads = await board.comments(seeded.notes.shed.id);
    expect(threads.map(c => [c.open, c.replies.length])).toEqual([[true, 0], [false, 1]]);
    expect((await board.children(seeded.notes.shed.id)).filter(k => !prop(k, "type")?.startsWith("annotation")).map(k => k.text.split("\n")[0])).toEqual(["Puncture kit", "Chain oil"]);
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
    expect([prop(day!, "file-day"), prop(project!, "file-project"), prop(session!, "file-session")]).toEqual(["2026-03-11", "allotment", RECENT_SESSION]);
    const files = await board.children(session!.id);
    expect(files.map(f => [prop(f, "file"), prop(f, "type"), prop(f, "touches")])).toEqual(RECENT_FILES().map(f => [f.file, "file-touch", String(f.touches)]));
    for (const f of RECENT_FILES()) expect(existsSync(f.file)).toBe(true);
  });

  test("heading styles (PIE-599): banded wide, their words narrow, nothing past the edge; the outline's own style changes the look with no door change", async () => {
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
        // A styled heading's words, without its #s (PIE-1302); the plain one as Markdown writes it.
        for (const h of ["Your calls", "The plot", "Beds", "Water butts", "Seed order", "Compost", "Odd jobs", "Tool shed", "## Plain"]) expect(lines.map(l => l.trim())).toContain(`▾ ${h}`);
        // A checklist step wraps whole, and a table cell's next row starts at the cell's edge.
        expect(text).not.toContain("first fro…");
        expect(text.replace(/[┊\s]+/g, " ")).toContain("Order the seed trays for the raised beds before the first frost comes in");
        const job = lines.findIndex(l => l.includes("SHED-4 /")), col = lines[job]!.indexOf("SHED-4");
        expect(lines[job + 1]!.slice(col), "the cell's next row at its edge").toMatch(/^\S/);
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

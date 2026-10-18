// PIE-439: the showcase screen, how a note looks: headings, styles, images, callouts, titles. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { osc52 } from "../../src/surface/selection";
import { surfaceBg } from "../../src/style";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../../src/app";
import { REMOTE_CLIENT, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { C, fg, tailFrom } from "../../src/style";
import { external } from "../../src/open";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: how a note looks: headings, styles, images, callouts, titles", () => {
  const origin = process.env.EP0CH_ARTIFACT_ORIGIN;
  beforeAll(() => { process.env.EP0CH_ARTIFACT_ORIGIN = "https://artifacts.example.test"; });
  afterAll(() => { if (origin === undefined) delete process.env.EP0CH_ARTIFACT_ORIGIN; else process.env.EP0CH_ARTIFACT_ORIGIN = origin; });
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


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
    // A note action runs in the section's reader, attributed to the agent (the door has drawn a frame since: the section's reader is entered).
    screen();
    const sel = await app.act({ action: "select", args: { text: "red lentils" }, as: "test-agent" }) as any;
    expect(JSON.stringify(sel)).toContain("red lentils");
    expect(app.describe()).toMatchObject({ screen: "showcase", state: { kind: "showcase", section: { key: "selection" }, focus: "index" } });
    await expect(app.act({ action: "section", args: { name: "nope" }, as: "test-agent" })).rejects.toThrow(/no section nope/);
    // The shell's actions stay the App's on the showcase: the stage takes only its own (PIE-514).
    expect(await app.act({ action: "screen.list", as: "test-agent" })).toMatchObject({ stack: expect.any(Array) });
  }, 20_000);


  test("a remote MCP client's write is said on the status line with the note's title (PIE-615)", async () => {
    const { actorOf, applyWrite } = await import("../../src/mcp-writes");
    const note = seeded.notes.remoteWrites;
    await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Compost delivered.", requestId: "showcase-flash" } }, { level: "full", actor: actorOf(REMOTE_CLIENT), uri: id => id });
    await until(() => String((app as any).message ?? "").includes("chat.example.test"), "the remote write said", 8000);
    await until(() => String((app as any).message).includes("commented on “Remote writes"), "the comment said by its note", 8000);
    expect((app as any).message).toBe("chat.example.test commented on “Remote writes and the netmail queue” · a remote MCP write");
    // A persona within its principal is said with it (PIE-679).
    await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Seeds ordered.", requestId: "showcase-persona" } }, { level: "full", actor: actorOf({ sub: "stdio", clientId: "claude-code" }, { EP0CH_MCP_PERSONAS: "claude-code@float-2=loki" }, "float-2"), uri: id => id });
    await until(() => String((app as any).message).startsWith("loki (claude-code@float-2) commented on"), "the persona said with its principal", 8000);
    // A folder's .ep0ch names who works in it (ADR 0003): a stdio write from there carries that persona, recorded, never refused.
    const { mkdtempSync, rmSync, writeFileSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const folder = mkdtempSync(`${tmpdir()}/showcase-persona-`);
    try {
      writeFileSync(`${folder}/.ep0ch`, 'ws = "showcase"\nagent = "testbot"\n');
      await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Beds weeded.", requestId: "showcase-folder-persona" } }, { level: "full", actor: actorOf({ sub: "stdio", clientId: "claude-code", folder }, {}, "float-2"), uri: id => id });
      await until(() => String((app as any).message).startsWith("testbot (claude-code@float-2) commented on"), "the folder's persona said with its principal", 8000);
    } finally { rmSync(folder, { recursive: true, force: true }); }
  });


  test("the facets section (PIE-881): every property the notes have, a tag among them, opened to its values with uses; a value is included, another excluded, the selection is the views' query text; ⏎ steps a value include → exclude → off; x clears", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "facets" }, as: "test-agent" })).toMatchObject({ key: "facets" });
    await until(() => /#frost-jobs\/ +3/.test(screen()) && /#bikes +1/.test(screen()), "the tags facet's values", 8000);
    // An agent includes #frost-jobs and excludes #compost: the notes it leaves are listed, the query is shown as text.
    await app.act({ action: "facets.set", args: { key: "tag", value: "frost-jobs" }, tile: "tags", as: "test-agent" });
    await app.act({ action: "facets.set", args: { key: "tag", value: "compost", mode: "exclude" }, tile: "tags", as: "test-agent" });
    await until(() => screen().includes("? #frost-jobs NOT #compost") && screen().includes("+ #frost-jobs") && screen().includes("− #compost"), "the picks and their query", 5000);
    expect(screen()).not.toMatch(/#bikes +\d/);
    // The person goes in: ⏎ on the first row steps it, x clears the selection.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("x");
    await until(() => screen().includes("every note") && /#bikes +1/.test(screen()), "the selection cleared", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);


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


  // PIE-669, the human workflow: a person opens a half-written note, types a fence mid-note and leaves it open, saves;
  // nothing after it is lost or read as code, and the reader says each construct left open, with how to close it.
  test("a half-written note: a fence typed and left open mid-note costs only its paragraph, the save keeps the rest, the reader says each open construct", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "note" }, as: "test-agent" });
    await until(() => marks.note!.every(m => screen().includes(m)), "the note section");
    const stage = () => S().stages.get(S().sel).top;
    const note = seeded.notes.halfWritten.id;
    await app.act({ action: "open", tile: "reader", args: { id: note }, as: "test-agent" });
    await until(() => screen().includes("⚠ the ``` on line 3 isn't closed: lines 3–4 are code"), "the open fence said", 8000);
    expect(screen()).toContain("⚠ the [[Seed tr on line 7 isn't closed with ]]");
    // What follows the fence's paragraph is the note, as the service reads it.
    expect((await board.get(note))!.properties).toContainEqual({ key: "tag", value: "seed-jars" });
    // The person's keys: into the stage, e then ⏎ opens the edit; down to the line after the blank one, a fence typed
    // and left open on a paragraph of its own, then ctrl+s.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    await until(() => stage().describe().focusName === "reader", "the reader has the keys");
    ch("e"); press({ kind: "enter" });
    const draft = () => stage().pane("reader").surface.draft;
    await until(() => !!draft()?.text, "the edit open", 8000);
    // A click at the start of the line after the blank one puts the cursor there (the person's mouse).
    const rows = () => sc.render(app).lines.map(plain);
    const at = () => { const r = rows(); const y = r.findIndex(l => l.includes("After the code, the") && l.indexOf("After the code, the") > 50); return { y, x: y >= 0 ? r[y]!.indexOf("After the code, the") : -1 }; };
    await until(() => at().y > 0, "the line in the edit", 8000);
    const line = at();
    press({ kind: "mouse", action: "down", button: 0, x: line.x, y: line.y }); press({ kind: "mouse", action: "up", button: 0, x: line.x, y: line.y });
    for (const c of "~~~") ch(c);
    press({ kind: "enter" }); press({ kind: "enter" });
    expect(draft()!.text.split("\n").slice(4, 8)).toEqual(["", "~~~", "", "After the code, the [[Bike shed]] page and this tag still count. #seed-jars"]);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !draft(), "saved, the person reading", 8000);
    const saved = (await board.get(note))!;
    expect(saved.text.split("\n")).toContain("~~~");
    expect(saved.properties).toContainEqual({ key: "tag", value: "seed-jars" });
    await until(() => screen().includes("⚠ the ~~~ on line 6 isn't closed: it holds no code yet"), "the new open fence said", 8000);
    // Drawn as the note, not as code: the link drawn as a link (its brackets gone).
    expect(screen()).toContain("After the code, the Bike shed page and this tag still count.");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // The section's reader back on its own note, for the tests after.
    await app.act({ action: "open", tile: "reader", args: { id: seeded.notes.notebook.id }, as: "test-agent" });
  }, 40_000);


  test("the scroll section (PIE-622): End puts the last line on the edge, End again brings it to the middle, blank under it; by keys and act; reader.overscroll none stops at the edge", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "scroll" }, as: "test-agent" })).toMatchObject({ key: "scroll" });
    await until(() => screen().includes("End (or G) goes to the last line"), "the long note", 8000);
    const scroll = (args: Record<string, unknown>) => app.act({ action: "scroll", args, tile: "reader", as: "test-agent" }) as Promise<any>;
    // What an agent's view.get says (the viewport the person's keys left, read once it's h.painted).
    const view = async () => { screen(); return ((await app.act({ action: "view.get", tile: "reader", as: "test-agent" })) as any).viewport; };
    // (The agent's first act adds its line to the reader's header, a row less room: read where it is once h.painted.)
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
    // ...and the installed extensions' (EchoNet's subscription and area, for the settings card).
    expect(listed()).toHaveLength(BUILTIN_COMPONENT_SCHEMAS.length + 2);
    expect(listed()).toEqual(expect.arrayContaining(["echonet-subscription", "echonet-area"]));
    for (const id of ["graph-stat", "graph-table", "graph-quadrant", "links", "box", "image", "hero-image", "embed", "code-fence"]) expect(listed()).toContain(id);
    expect(await app.act({ action: "library.component", args: { name: "graph-quadrant" }, as: "test-agent" })).toMatchObject({});
    await app.act({ action: "library.part", args: { part: "overview" }, as: "test-agent" });
    await until(() => screen().includes("Quadrant (::graph-quadrant)") && screen().includes("Minimal example"), "a figure's overview", 5000);
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
    ch("]");
    press({ kind: "enter" });
    await until(() => screen().includes("note · now") && screen().includes("make it start folded (-)"), "the type choice, every choice drawn", 5000);
    expect(screen()).toContain("note · now");
    // The reader records the person's change once its save has answered, which can come after the service has the text
    // (a loaded CI runner): ctrl+z before that has nothing of theirs to undo.
    const stage = S().stages.get(SECTIONS.findIndex(s => s.key === "callouts")).top as any;
    const mine = () => [...stage.panes.values()].map((p: any) => p.surface?.msg && p.surface.calloutHistory?.last("you", p.surface.msg.id)).find(Boolean);
    const had = mine();
    ch("j"); press({ kind: "enter" });
    await reads(t => t.includes("> [!abstract] note"), "the type changed");
    await until(() => mine() !== had, "the change recorded for undo");
    // The type choice holds the keys until the change has answered (it is recorded a little before): ctrl+z before it closes is its.
    await until(() => !screen().includes("make it start folded (-)"), "the type choice closed");
    // ctrl+z: the last change here (the callout's) put back.
    press({ kind: "char", ch: "z", ctrl: true });
    await reads(t => t.includes("> [!note] note\n"), "the change undone");
    // By mouse: a click on the nested warning's title folds it.
    await until(() => screen().includes("body body"), "the nested warning drawn");
    // In the left reader (the right one shows the type's declaration).
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /╭─ ▾ ⚠ warning/.test(l)), x = rows[y]!.indexOf("▾", S().stageRect.col);
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


  test("hero header (PIE-598): the opening picture, scrolled under the header, becomes its dimmed background; reader.hero on=false keeps it plain", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "hero" }, as: "test-agent" })).toMatchObject({ key: "hero" });
    await until(() => screen().includes("▣ evening-beds.jpg") && !screen().includes("loading…"), "the hero note, its picture read", 8000);
    const reader = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes[0]; };
    const raw = () => sc.render(app).lines as string[];
    // The title rows inside the tiles (not a frame's label): the reader's is the row's first, the column's beside it.
    const titleRows = () => raw().filter(l => /│ *An evening on the plot/.test(plain(l)));
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
    const colTitle = () => (plain(titleRows()[0] ?? "").match(/│ *An evening on the plot/g) ?? []).length;
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
    // A note with a Work ID shows it first on the title line (PIE-809), and not on the byline.
    const at = rows.findIndex(l => /│ *HOME-042 · A title you can find/.test(l));
    expect(at).toBeGreaterThan(0);
    expect(rows[at + 1]).not.toContain("HOME-042");
    expect(rows[at - 1]).toMatch(/│ *(…|top level|Kitchen sink|# )/);   // the breadcrumb, once its ancestors are read
    // Where the terminal does not scale text (this one, like Herdr or tmux), the title is one bold row and the byline is the very next: no blank row.
    expect(rows[at + 1]).toMatch(/i \d+ properties/);
    expect(readers().map((p: any) => p.showing?.title ?? p.title)).toContain("A title you can find");
    // The header owns the full title; the frame keeps its Work ID and tile facts.
    const frames = rows.flatMap(l => [...l.matchAll(/[╔┌][─═] \d+ HOME-042 · [^─═]*/g)].map(x => x[0]));
    expect(frames.length).toBe(2);
    for (const f of frames) expect(f).toMatch(/[╔┌][─═] \d HOME-042 · (reader|detail)/);
    // The tile with the keys has the brighter title: the same title, the same row, two shades.
    // The note's own header row carries both copies, one in each reader.
    const row = raw().find(l => (plain(l).match(/A title you can find/g) ?? []).length === 2 && !/[┌╔]/.test(plain(l)))!;
    expect(row).toBeDefined();
    const shades = [...row.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m(?:\x1b\[1m)?A title you can find/g)].map(x => +x[1]! + +x[2]! + +x[3]!);
    expect(shades.length).toBe(2);
    expect(shades[0]).toBeGreaterThan(shades[1]! + 100);
    // The Work ID is in the accent, bold, ahead of the title.
    const colour = (word: string) => new RegExp(`\\x1b\\[(38;[\\d;]+)m(?:\\x1b\\[1m)?${word}`).exec(row)?.[1];
    expect(colour("HOME-042")).toBeDefined();
    expect(colour("HOME-042")).not.toBe(colour("A title you can find"));
  });


  test("wrapping links (title section): a link that wraps keeps its colour and its click on every row, in the narrow reader too", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "title" }, as: "test-agent" })).toMatchObject({ key: "title" });
    await until(() => screen().includes("winter") || screen().includes("valves"), "the links, read", 8000);
    const raw = () => sc.render(app).lines as string[];
    const sgr = (row: string, word: string, from = 0) => { const at = row.indexOf(word, from); return at < 0 ? null : row.slice(0, at).split("\x1b[").at(-1)!.split("m")[0]!; };
    // The index can name the same words (the figure-steps section says "test plan"). Check the readers only.
    const rowsWith = (word: string) => raw().map((r, y) => ({ r: tailFrom(r, (S() as any).stageRect.col), y })).filter(x => plain(x.r).includes(word));
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


  test("artifacts: live and pinned cards open the static URLs by key, mouse and agent action", async () => {
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "artifacts" }, as: "test-agent" });
    await until(() => screen().includes("Orbit lamp pinned"), "the live and snapshot cards", 8000);
    const list = (await app.act({ action: "images", as: "test-agent" }) as any).images;
    const live = await board.request<{ url: string }>("artifacts.show", { name: list[0].path });
    const pinned = await board.request<{ url: string }>("artifacts.show", { name: list[1].path });
    expect(pinned.url).toContain("showcase-orbit%401/");
    expect(await app.act({ action: "artifact.open", args: { n: 2 }, as: "test-agent" })).toMatchObject({ outside: "browser", url: pinned.url, launched: false });
    const opened: string[][] = [], run = external.run;
    external.run = cmd => { opened.push(cmd); };
    try {
      press({ kind: "enter" }); ch("]"); ch("]"); press({ kind: "enter" });
      await until(() => opened.length === 1, "Enter opened the snapshot", 5000);
      expect(opened[0]!.at(-1)).toBe(pinned.url);
      const rows = sc.render(app).lines.map(plain);
      const y = rows.findIndex(l => l.includes("Orbit lamp") && !l.includes("pinned") && l.includes("[open ↗]")), x = rows[y]!.indexOf("[open ↗]") + 2;
      press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
      await until(() => opened.length === 2, "Click opened the live folder", 5000);
      expect(opened[1]!.at(-1)).toBe(live.url);
    } finally { external.run = run; }
  }, 30_000);

});

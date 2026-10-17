// PIE-956 (S6): a generated region (a handler's output, a component, `::use`, a materialized `[!output]` callout) draws
// as the note's own content, and `r` with no position never runs every line. Against a scratch service with the
// outliner's example extensions in the scratch outline's own `extensions/` folder; fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { SHADE } from "../src/embeds";
import { outputRegionText } from "@ep0ch/outline-core/output-region";
import { bindExtensions } from "../src/extensions";
import { forgetProjectionAnswers } from "../src/projection";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("generated regions in a door, against a scratch service", () => {
  const scratch = new Scratch();
  const extDir = join(scratch.workspace, "extensions");
  let board: SocketBoard, app: App;
  const flashes: string[] = [];
  let host: SurfaceHost;
  let refreshes: unknown[][] = [];

  /** A reader on a new note, drawn once its lines have been read. */
  async function reader(text: string, ready: RegExp): Promise<{ note: Msg; s: NoteSurface; lines: () => string[]; text: () => string }> {
    const note = await board.createBlock(null, text);
    forgetProjectionAnswers();
    const s = new NoteSurface();
    s.show((await board.get(note.id))!, host);
    const lines = () => s.render(120, 80, host).lines.map(plain);
    await until(() => ready.test(lines().join("\n")), `${ready} drawn`, 20_000);
    return { note, s, lines, text: () => lines().join("\n") };
  }

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    mkdirSync(extDir, { recursive: true });
    for (const id of ["horoscope", "fancy-horror"]) cpSync(join(outliner!, "extensions", id), join(extDir, id), { recursive: true });
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    const flash = app.flash.bind(app);
    app.flash = (m: string, ms?: number) => { flashes.push(m); flash(m, ms); };
    app.push(new MainMenu());
    await app.loadExtensions(true);
    host = { ctx: app as any, redraw() {}, navigate() {} };
    const ask = board.refreshProjections.bind(board);
    board.refreshProjections = ((...a: Parameters<typeof ask>) => { refreshes.push(a); return ask(...a); }) as typeof ask;
  }, 40_000);

  afterAll(async () => {
    bindExtensions(null);
    app?.quit();
    board?.close();
    await scratch.dispose();
  });

  describe("a region draws as the note's own content (PIE-956)", () => {
    test("flush with the text around it: no tint, no head row, no controls; one dim mark in the gutter holds the rest", async () => {
      const { s, lines } = await reader("Omens\nSome prose before.\n\nhoroscope:: virgo\n\nProse after the output.", /Virgo, \d{4}/);
      const rows = lines();
      const out = rows.findIndex(l => l.includes("Virgo, ")), prose = rows.findIndex(l => l.includes("Some prose before."));
      expect(rows[out]!.indexOf("Virgo, ")).toBe(rows[prose]!.indexOf("Some prose before."));
      expect(rows[out]!.startsWith("≡")).toBe(false);                            // zero chrome: no mark drawn until `[ ]` is in the region
      s.key(char("]"), host);
      expect(lines()[out]!.startsWith("≡")).toBe(true);                          // then the one dim mark, in the first row's gutter cell
      const text = rows.join("\n");
      expect(text).not.toMatch(/ran (just now|\d+ min ago)/);
      expect(text).not.toContain("run again");
      expect(text).not.toContain("[keep]");
      expect(s.render(120, 80, host).lines.some(l => l.includes(SHADE))).toBe(false);   // no tint under the region
    }, 40_000);

    test("a click on the mark shows what is behind it (name, when it ran, keep, run again) as one dim row; a second click closes it", async () => {
      const { s, lines } = await reader("Omens\nhoroscope:: virgo\n\nProse after the output.", /Virgo, \d{4}/);
      const row = lines().findIndex(l => l.includes("Virgo, "));
      expect(row).toBeGreaterThan(0);
      const before = lines().length;
      s.click(0, row, host);
      await until(() => /Horoscope virgo · ran (just now|\d+ min ago)/.test(lines().join("\n")), "the row behind the mark", 5000);
      const open = lines().find(l => l.includes("Horoscope virgo · ran"))!;
      expect(open).toContain("[keep]");
      expect(open).toContain("[r run again]");
      expect(s.describe().elements!.current!.label).toBe("Horoscope virgo");     // the mark is the [ ] position
      s.click(0, row, host);
      await until(() => !lines().join("\n").includes("run again"), "closed again", 5000);
      await Bun.sleep(50);
      expect(lines()).toHaveLength(before);
    }, 40_000);
  });

  describe("a materialized output region (an `[!output]` callout)", () => {
    const region = (body: string, producer: string) => outputRegionText({ label: "weekly", producer, anchor: "out-weekly-7c2e", body });

    test("draws flush like the note's own words, behind the same mark; the click shows the label and a source link", async () => {
      const producer = (await board.createBlock(null, "A script note")).id;
      const text = `Planning\nSome prose before.\n\n${region("| day | done |\n| --- | --- |\n| mon | 2 |", producer)}\n\nProse after the table.`;
      const { s, lines } = await reader(text, /Prose after the table/);
      const rows = lines();
      const table = rows.findIndex(l => l.includes("day")), prose = rows.findIndex(l => l.includes("Some prose before."));
      expect(rows[table]!.indexOf("day")).toBeGreaterThanOrEqual(rows[prose]!.indexOf("Some prose before."));
      expect(rows.join("\n")).not.toMatch(/\[!output\]|output-hash|output-of|╭─|╰─/);         // no callout frame, no header chips
      const mark = rows.findIndex(l => l.includes("┌"));
      expect(mark).toBeGreaterThan(prose);
      expect(rows.slice(mark, mark + 4).join("\n")).toContain("mon");
      s.click(0, mark, host);
      await until(() => lines().join("\n").includes("weekly · written by a script"), "the row behind the mark", 5000);
      expect(lines().join("\n")).toContain("[source]");
    }, 40_000);

    test("[ ] on the open row's [source] control keeps the row open; a region inside a ::box has its mark too", async () => {
      const producer = (await board.createBlock(null, "A script note")).id;
      const { s, lines } = await reader(`Planning\n${region("one", producer)}\n\nProse after.`, /Prose after/);
      s.key(char("]"), host); lines();                                    // the mark
      expect(s.describe().elements!.current!.kind).toBe("embed");
      s.key(char("]"), host); lines();                                    // [source]
      expect(s.describe().elements!.current!.label).toBe("[source]");
      expect(lines().join("\n")).toContain("[source]");
      const boxed = await reader(`Planning\n::box{margin.x=2}\n${region("words in a box", producer)}\n::\n\nProse after the box.`, /Prose after the box/);
      boxed.s.key(char("]"), host);
      expect(boxed.lines().filter(l => l.includes("≡"))).toHaveLength(1);
    }, 40_000);

    test("a region its person edited says so, behind the text they left", async () => {
      const producer = (await board.createBlock(null, "A script note")).id;
      const edited = region("one", producer).replace("> one", "> one, and my own words");
      const { lines } = await reader(`Planning\n${edited}\n\nProse after.`, /my own words/);
      expect(lines().join("\n")).toContain("edited here: it is yours now");
    }, 40_000);
  });

  describe("the Sources inspector (PIE-956 S6b)", () => {
    const AGENT = { kind: "agent" as const, id: "sources-agent" };
    const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
    const SOURCES_NOTE = async () => {
      const template = (await board.createBlock(null, "Meeting template [type::template] [form-field::who text]\nWho: {{props.who}}")).id;
      const r = await reader(`Omens\nhoroscope:: virgo\n\nfancy-horror:: virgo\n\n::use{of=((${template})) who=Kit}`, /Virgo, \d{4}/);
      return { ...r, template };
    };

    test("the header says the note generates something; S lists every generated region; ⏎ opens one with its three folds", async () => {
      const { s, lines, text } = await SOURCES_NOTE();
      expect(text()).toContain("[sources]");
      s.key(char("S"), host);
      await until(() => text().includes("Sources · 3 generated regions"), "the list", 15_000);
      const list = text();
      expect(list).toMatch(/horoscope[\s\S]*fancy-horror[\s\S]*::use/);
      expect(list).toContain("Updated");
      s.key(char("j"), host); s.key(char("j"), host);
      s.key({ kind: "enter" }, host);
      await until(() => text().includes("Transform"), "the open source", 5000);
      const open = text();
      expect(open).toContain("Query");
      expect(open).toContain("Result");
      expect(open).toMatch(/who\s+Kit/);
      expect(open).toContain("Meeting template");           // the transform: the template it is drawn from
      s.key({ kind: "esc" }, host); s.key({ kind: "esc" }, host);
      await until(() => !text().includes("Sources ·") && !text().includes("Transform"), "closed", 5000);
      expect(lines().length).toBeGreaterThan(0);
    }, 60_000);

    test("a parameter is written back onto the line, attributed and undoable; the person is asked, an agent passes it", async () => {
      const { s, note, text } = await SOURCES_NOTE();
      await NOTE_ACTIONS.run("sources.open", {}, { surface: s, host }, USER);
      await until(() => text().includes("Sources ·"), "the list", 15_000);
      await NOTE_ACTIONS.run("sources.pick", { n: 3 }, { surface: s, host }, USER);
      await NOTE_ACTIONS.run("sources.enter", {}, { surface: s, host }, USER);
      await expect(NOTE_ACTIONS.run("sources.set", { param: "who" }, { surface: s, host }, AGENT)).rejects.toThrow(/give the new value/);
      await NOTE_ACTIONS.run("sources.set", { param: "who", value: "Ada" }, { surface: s, host }, USER);
      expect((await board.get(note.id))!.text).toContain("who=Ada");
      expect((await board.get(note.id))!.text).not.toContain("who=Kit");
      await until(() => /who\s+Ada/.test(text()), "the field reads Ada", 15_000);
      s.key(ctrl("z"), host);
      const end = Date.now() + 8000;
      while (!(await board.get(note.id))!.text.includes("who=Kit") && Date.now() < end) await Bun.sleep(30);
      expect((await board.get(note.id))!.text).toContain("who=Kit");
    }, 60_000);

    test("an agent reads the same list and opens nothing in the person's reader; a region without a field says it is written in the note", async () => {
      const { s, note, text } = await SOURCES_NOTE();
      const a = await NOTE_ACTIONS.run("sources.open", {}, { surface: s, host }, AGENT) as { opened: boolean; sources: { name: string; kind: string }[] };
      expect(a.opened).toBe(false);
      expect(a.sources.map(x => x.kind)).toEqual(["handler", "handler", "use"]);
      expect(text()).not.toContain("Sources ·");
      const at = await NOTE_ACTIONS.run("sources.at", { line: 6 }, { surface: s, host }, AGENT) as { at: number };
      expect(at.at).toBe(3);
      await expect(NOTE_ACTIONS.run("sources.at", { line: 1 }, { surface: s, host }, AGENT)).rejects.toThrow(/no generated region holds line 1/);
      expect(note.id).toBeTruthy();
    }, 60_000);

    test("an agent writes a parameter by naming the source, never needing the person's inspector", async () => {
      const { s, note, text } = await SOURCES_NOTE();
      const r = await NOTE_ACTIONS.run("sources.set", { source: "3", param: "who", value: "Zed" }, { surface: s, host }, AGENT) as { recordedAs: unknown };
      expect(r.recordedAs).toBeTruthy();
      expect((await board.get(note.id))!.text).toContain("who=Zed");
      expect(text()).not.toContain("Sources ·");
    }, 60_000);

    test("the inspector closes when the reader moves to another note, so a parameter never lands on the wrong one", async () => {
      const { s, text } = await SOURCES_NOTE();
      s.key(char("S"), host);
      await until(() => text().includes("Sources ·"), "open", 15_000);
      const other = await board.createBlock(null, "Another note");
      s.show((await board.get(other.id))!, host);
      expect(s.render(120, 80, host).lines.map(plain).join("\n")).not.toContain("Sources ·");
      expect(s.sourcesMode).toBeNull();
    }, 60_000);

    test("select words in a generated region and the passage toolbar offers Where from; a then w opens that source", async () => {
      const { s, text } = await SOURCES_NOTE();
      await NOTE_ACTIONS.run("select", { text: "Virgo," }, { surface: s, host }, USER);
      s.render(120, 80, host);
      expect(s.passageChoices().map(c => c.label)).toContain("Where from");
      s.key(char("a"), host); s.key(char("w"), host);
      await until(() => /Transform/.test(text()) && /horoscope/.test(text()), "the source opened at the selection", 15_000);
    }, 60_000);
  });

  describe("r with no position (PIE-956)", () => {
    test("before the note's lines are read r asks the service nothing: it can't know what would run", async () => {
      const note = await board.createBlock(null, "Omens\nhoroscope:: virgo\n\nfancy-horror:: virgo");
      forgetProjectionAnswers();
      const s = new NoteSurface();
      s.show((await board.get(note.id))!, host);
      refreshes = []; flashes.length = 0;
      s.key(char("r"), host);
      await until(() => flashes.some(f => f.includes("reading what this note runs")), "the refusal said", 5000);
      expect(refreshes).toEqual([]);
    }, 40_000);

    test("a note with two lines that run: r runs neither, says which there are, and asks nothing of the service", async () => {
      const { s } = await reader("Omens\nhoroscope:: virgo\n\nSome prose between.\n\nfancy-horror:: virgo", /Virgo, \d{4}/);
      s.letGo();
      refreshes = []; flashes.length = 0;
      s.key(char("r"), host);
      await until(() => flashes.some(f => /2 lines run/.test(f)), "the refusal said", 5000);
      expect(flashes.find(f => /2 lines run/.test(f))).toMatch(/Horoscope|horoscope/);
      expect(flashes.find(f => /2 lines run/.test(f))).toContain("nothing ran");
      expect(refreshes).toEqual([]);
    }, 40_000);

    test("with [ ] on one of them r runs that line only; a note with one such line runs it with no position", async () => {
      const two = await reader("Omens\nhoroscope:: virgo\n\nfancy-horror:: virgo", /Virgo, \d{4}/);
      let tries = 0;
      while (two.s.describe().elements?.current?.label !== "Horoscope virgo" && tries++ < 30) { two.s.key(char("["), host); two.lines(); }
      refreshes = []; flashes.length = 0;
      two.s.key(char("r"), host);
      await until(() => flashes.some(f => f.includes("horoscope:: virgo ran")), "the run", 15_000);
      expect(refreshes).toHaveLength(1);
      expect(refreshes[0]![1]).toBe(1);                              // the line index of `horoscope:: virgo`
      const one = await reader("Just one\nhoroscope:: leo", /Leo, \d{4}/);
      one.s.letGo();
      refreshes = []; flashes.length = 0;
      one.s.key(char("r"), host);
      await until(() => flashes.some(f => f.includes("horoscope:: leo ran")), "the one line run", 15_000);
      expect(refreshes).toHaveLength(1);
      expect(refreshes[0]![1]).toBe(1);
    }, 60_000);
  });
});

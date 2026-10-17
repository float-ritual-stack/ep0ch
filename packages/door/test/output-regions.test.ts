// PIE-956 (S6): a generated region (a handler's output, a component, `::use`, a materialized `[!output]` callout) draws
// as the note's own content, and `r` with no position never runs every line. Against a scratch service with the
// outliner's example extensions in the scratch outline's own `extensions/` folder; fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { SHADE } from "../src/embeds";
import { bindExtensions } from "../src/extensions";
import { forgetProjectionAnswers } from "../src/projection";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
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
      expect(rows[out]!.startsWith("≡")).toBe(true);                             // the mark: the first row's gutter cell
      const text = rows.join("\n");
      expect(text).not.toMatch(/ran (just now|\d+ min ago)/);
      expect(text).not.toContain("run again");
      expect(text).not.toContain("[keep]");
      expect(s.render(120, 80, host).lines.some(l => l.includes(SHADE))).toBe(false);   // no tint under the region
    }, 40_000);

    test("a click on the mark shows what is behind it (name, when it ran, keep, run again) as one dim row; a second click closes it", async () => {
      const { s, lines } = await reader("Omens\nhoroscope:: virgo\n\nProse after the output.", /Virgo, \d{4}/);
      const row = lines().findIndex(l => l.startsWith("≡"));
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

  describe("r with no position (PIE-956)", () => {
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

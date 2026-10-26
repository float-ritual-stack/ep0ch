// PIE-1361: a header picture is set one way. The note's own `[img::…] [layout::hero]` line is the only header picture,
// its look is that line's properties, and the tune's Hero rows and the header's two drags write them there at once. Each
// bug a person hit setting one (Oct 26) is reproduced first: a tile-level picture on every note, the picture drawn twice,
// a control that waited for a scroll, the margin left behind, the wrong one of two heroes. Fictional notes and pictures,
// against a scratch outline only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import sharp from "sharp";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { media } from "../src/media";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); }
};
const BODY = Array.from({ length: 40 }, (_, i) => `The ${i + 1}th row of runner beans, staked and tied.`).join("\n\n");

describe.skipIf(!outliner)("one header picture, the note's own (PIE-1361)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const pic = (name: string) => join(scratch.root, name);
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "user" });
  const text = async (id: string) => (await board.get(id))!.text as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 40, g: 30, b: 60 } } }).png().toFile(pic("dusk.png"));
    await sharp({ create: { width: 1200, height: 600, channels: 3, background: { r: 20, g: 60, b: 30 } } }).png().toFile(pic("shed.png"));
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  /** A Kitty-capable door at `cols` × `rows` on the detail screen of note `id`. */
  async function door(id: string, drawn: string, cols = 120, rows = 70) {
    let key: (k: Key) => void = () => {};
    const term = { info: { cols, rows, cellW: 9, cellH: 18, kitty: true }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    app.video = "kitty";
    const sub = board.subscribe(e => app.event(e));
    const desk = openScreen("detail", { note: id, persist: false }) as Desk;
    app.push(new MainMenu()); app.push(desk);
    const view = () => desk.render((desk as any).ctx);
    const lines = () => view().lines.map(plain);
    await until(() => lines().some(l => l.includes(drawn)), `the note drawn at ${cols}`, 10_000);
    const heroes = (): any[] => (view().placements ?? []).filter((p: any) => /(^|:)hero:/.test(p.key));
    const backdrops = () => (view().placements ?? []).filter((p: any) => /(^|:)hero-backdrop:/.test(p.key));
    const mouse = (action: "down" | "drag" | "up" | "wheel-up" | "wheel-down", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y } as Key);
    const tune = () => [...(desk as any).panes.values()].find((p: any) => p.kind === "tune");
    const act = (action: string, args: Record<string, unknown> = {}, tile = "tune") => app.act({ action, args, tile, as: "hero-agent" });
    const reader = () => [...(desk as any).panes.values()].find((p: any) => p.surface) as any;
    return { app, desk, reader, view, lines, heroes, backdrops, mouse, key, tune, act, close: () => { app.pop(); app.pop(); (sub as any)?.(); } };
  }
  const ready = async (path: string) => until(() => media(path, "img").state === "ready", path, 10_000);

  test("a picture set at a level is never drawn: a tile-level header.image on a note with none shows nothing, and says where it went", async () => {
    await ready(pic("shed.png"));
    const style = await create(null, `Old header look [style-for::tile:detail] [style.header.image::${pic("shed.png")}] [style.header.image.y::-15]`);
    const plainNote = await create(null, `Seed order [style.header.image.dim::0.4]\nBroad beans, two packets.`);
    const d = await door(plainNote.id, "Broad beans");
    try {
      // Before PIE-1361 the tile's picture was the header of every note opened in a detail tile.
      await Bun.sleep(300);
      expect(d.heroes()).toEqual([]);
      expect(d.backdrops()).toEqual([]);
      await d.act("tile.tune", {}, "detail");
      await until(() => d.tune()?.describe(d.desk).problems?.length > 0, "the style note's problem", 5000);
      const said = d.tune().describe(d.desk);
      expect(said.problems.join("\n")).toMatch(/style\.header\.image is gone: a header picture's look is written on its own \[layout::hero\] line/);
      expect(said.problems.join("\n")).toMatch(/page: style\.header\.image\.dim is gone/);
      expect(said.hero).toBeNull();
      expect(d.lines().join("\n")).toContain("this note has no header picture: H on one of its images");
      expect(said.values["header.image"]).toBeUndefined();
    } finally { d.close(); await board.request("trash", { id: style.id }).catch(() => {}); }
  }, 30_000);

  test("one picture, drawn once: a page-level header.image naming no picture of the note (quoted, as it was typed) adds no second copy behind the header", async () => {
    await ready(pic("dusk.png"));
    const n = await create(null, `Dusk on the plot [style.header.image::'${pic("dusk.png")}'] [style.header.bg::raised]\n[img::${pic("dusk.png")}] [layout::hero]\n\n${BODY}`);
    const d = await door(n.id, "Dusk on the plot");
    try {
      await until(() => d.heroes().length === 1, "the hero", 10_000);
      // At the top, the hero is above the title and nothing is behind the header (it was: the same picture, a parallax double).
      await Bun.sleep(300);
      expect(d.heroes()).toHaveLength(1);
      expect(d.backdrops()).toEqual([]);
    } finally { d.close(); }
  }, 30_000);

  test("one hero: of two [layout::hero] lines the first is the header, the second an image in the text that says so", async () => {
    await ready(pic("dusk.png")); await ready(pic("shed.png"));
    const n = await create(null, `Two pictures\n[img::${pic("shed.png")}] [layout::hero]\n\nBetween them.\n\n[img::${pic("dusk.png")}] [layout::hero]\n\nAfter.`);
    const d = await door(n.id, "Between them");
    try {
      await until(() => d.heroes().length === 1, "the hero", 10_000);
      expect(d.reader().surface.heroInfo(d.reader().surface.msg)).toMatchObject({ line: 1, name: "shed.png" });
      expect(d.lines().join("\n")).toContain("another image is the header already");
    } finally { d.close(); }
  }, 30_000);

  test("the tune's Hero rows write the hero line at once, by act, by a click on [+] and ×, and by the wheel; the picture and the title move in the same frame", async () => {
    await ready(pic("dusk.png"));
    const n = await create(null, `Lantern night\n[img::${pic("dusk.png")}] [layout::hero]\n\n${BODY}`);
    const d = await door(n.id, "Lantern night");
    try {
      await until(() => d.heroes().length === 1, "the hero", 10_000);
      await d.act("tile.tune", {}, "detail");
      await until(() => d.heroes().length === 1, "the hero above its inspector", 10_000);
      await until(() => d.lines().some(l => l.includes("▾ Hero · this note's · line 2 · dusk.png")), "the Hero group", 5000);
      expect(d.tune().describe(d.desk).hero).toMatchObject({ line: 2, image: "dusk.png", values: { tint: { value: "0", from: "built in" } } });
      // An agent: tint a step, and the line says it; the picture drawn next is the tinted one, no scroll needed.
      const before = d.heroes()[0]!.image.key;
      expect(await d.act("tune.nudge", { row: "hero.tint", by: 1 })).toMatchObject({ row: "hero.tint", value: "0.25", at: "the hero line" });
      expect(await text(n.id)).toContain(`[img::${pic("dusk.png")}] [layout::hero] [tint::0.25]`);
      await until(() => d.heroes()[0]?.image.key !== undefined && d.heroes()[0]!.image.key !== before, "the tinted picture, drawn without a scroll", 10_000);
      // The title over the picture: the title row moves up into the header's rows in the same frame.
      const titleRow = () => d.lines().findIndex(l => l.includes("Lantern night") && !/[┌╔╭─═]{2}/.test(l));
      const below = titleRow();
      await d.act("tune.set", { row: "hero.title", value: "over" });
      expect(await text(n.id)).toContain("[title::over]");
      await until(() => titleRow() < below, "the title over the picture", 5000);
      // A person: a click on the fade row's [+], then its ×.
      const row = () => { const ls = d.lines(); const y = ls.findIndex(l => /^\W*│? *fade +/.test(l.replace(/^[^│]*│/, "")) || / fade {2,}/.test(l)); return { y, line: ls[y]! }; };
      await until(() => row().y >= 0, "the fade row", 5000);
      const plus = () => { const r = row(); return { x: r.line.indexOf("[+]") + 1, y: r.y }; };
      d.mouse("down", plus().x, plus().y); d.mouse("up", plus().x, plus().y);
      await untilAsync(async () => (await text(n.id)).includes("[fade::0.25]"), "fade by the click", 5000);
      d.mouse("wheel-up", d.lines()[row().y]!.indexOf("0.25"), row().y);
      await untilAsync(async () => (await text(n.id)).includes("[fade::0.5]"), "fade by the wheel", 5000);
      const x = row().line.indexOf("× [−]");
      d.mouse("down", x, row().y); d.mouse("up", x, row().y);
      await untilAsync(async () => !(await text(n.id)).includes("[fade::"), "fade taken off the line by ×", 5000);
      // ctrl+z in the reader puts the person's line back as it was before their last change.
      await d.app.dispatch.press("image.undo", {}, "detail");
      await untilAsync(async () => (await text(n.id)).includes("[fade::0.5]"), "the undo", 5000);
      // A bad value says what it can be; nothing written.
      await expect(d.act("tune.set", { row: "hero.blur", value: "99" })).rejects.toThrow(/blur is soften it, 0 \(sharp\) to 24/);
    } finally { d.close(); }
  }, 60_000);

  test("drag the header's bottom edge to size it and the picture to move its focus: one save each, the rows following the pointer", async () => {
    await ready(pic("dusk.png"));
    const n = await create(null, `Gate at dusk\n[img::${pic("dusk.png")}] [layout::hero]\n\n${BODY}`);
    const d = await door(n.id, "Gate at dusk");
    try {
      await until(() => d.heroes().length === 1, "the hero", 10_000);
      const h = d.heroes()[0]!;
      const edge = h.row + h.rows - 1, x = h.col + 10;
      const titleRow = () => d.lines().findIndex(l => l.includes("Gate at dusk") && !/[┌╔╭─═]{2}/.test(l));
      const gap = titleRow() - edge;
      d.mouse("down", x, edge);
      d.mouse("drag", x, edge + 2); d.mouse("drag", x, edge + 3);
      expect(d.lines().join("\n")).toContain(`↕ ${h.rows + 3} rows · let go to write it on the hero line`);
      d.mouse("up", x, edge + 3);
      await untilAsync(async () => (await text(n.id)).includes(`[height::${h.rows + 3}]`), "the height written", 5000);
      // The title follows the header's edge: no margin left behind (it was: a big gap, Oct 26).
      await until(() => d.heroes()[0]?.rows === h.rows + 3 && titleRow() - (h.row + h.rows + 2) === gap, "the title under the new edge", 10_000);
      // The picture dragged right: the crop shows more of its left (focus.x down), written as hero-focus.
      const y = h.row + 2;
      d.mouse("down", x, y); d.mouse("drag", x + 12, y); d.mouse("up", x + 12, y);
      await untilAsync(async () => /\[hero-focus::0\.\d+,0\.5\]/.test(await text(n.id)), "the focus written", 5000);
      const fx = Number(/\[hero-focus::(0\.\d+),/.exec(await text(n.id))![1]);
      expect(fx).toBeLessThan(0.5);
      // A press that doesn't move is the click it was: the picture becomes the [ ] position.
      d.mouse("down", x, y); d.mouse("up", x, y);
      await until(() => d.lines().some(l => l.includes("▀ header dusk.png") && l.includes("[")), "the header selected", 5000);
    } finally { d.close(); }
  }, 60_000);
});

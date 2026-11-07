// PIE-1615: a press in a reader is one gesture, as on the desk (src/surface/reader-pointer.ts). One thing happens per
// press, the release ends it, and a press whose release never came, a tile closing or a mode opening ends it too. Every
// case is the terminal's own SGR bytes through the door's decoder, against a scratch host; the notes are made up.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { SHOWCASE_ASSETS } from "../src/showcase/seed/media";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { KeyDecoder, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const USER = { kind: "user" } as const;
const TIMELINE = "::graph-timeline\n---\ntitle: Resize log\nquery: type=gesture-landing\ndate: landed\nheight: 4\n---\n::";

describe.skipIf(!outliner)("a press in a reader is one gesture (PIE-1615)", () => {
  const scratch = new Scratch();
  const writes: string[] = [];
  let board: SocketBoard, app: App, desk: Desk, key: (k: Key) => void = () => {};
  let beans: Msg, plan: Msg, hero: Msg, sized: Msg, form: Msg, long: Msg, titled: Msg;
  const INFO = { cols: 120, rows: 44, cellW: 9, cellH: 16, kitty: true };
  const decoder = new KeyDecoder(INFO);
  const D = () => desk as any;

  // ── the terminal's bytes ───────────────────────────────────────────────────────────────────────────────────────────
  const sgr = (button: number, x: number, y: number, end: "M" | "m") => decoder.feed(`\x1b[<${button};${x + 1};${y + 1}${end}`);
  const down = (x: number, y: number) => sgr(0, x, y, "M");
  const drag = (x: number, y: number) => sgr(32, x, y, "M");
  const up = (x: number, y: number) => sgr(0, x, y, "m");
  /** The pointer moving with no button held: what a terminal reports after a release it never sent. */
  const hover = (x: number, y: number) => sgr(35, x, y, "M");

  const copied = () => [...writes.join("").matchAll(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g)].map(m => Buffer.from(m[1]!, "base64").toString("utf8"));
  const frame = () => D().render(D().ctx).lines.map(plain) as string[];
  const T = "reader";
  const reader = (name = T) => desk.pane(name) as ReaderPane;
  const surface = (name = T) => reader(name).surface;
  /** The reader's content, on screen. */
  const tile = (name = T): { col: number; row: number; cols: number; rows: number } => { frame(); return D().origin(D().idOf(reader(name)), desk.rectOf(reader(name))); };
  /** Where `text` starts on screen, in the reader. */
  const where = (text: string, name = T) => {
    const r = tile(name), lines = frame();
    for (let y = r.row; y < r.row + r.rows; y++) {
      const x = (lines[y] ?? "").indexOf(text, r.col);
      if (x >= 0 && x + text.length <= r.col + r.cols) return { x, y };
    }
    throw new Error(`"${text}" isn't drawn in the reader:\n${lines.join("\n")}`);
  };
  /** The note in the reader, the keys in it, nothing held over from the last case. */
  const open = async (m: Msg, drawn: string, name = T) => {
    await D().dispatch.press("open", { id: m.id }, name);
    await D().dispatch.press("tile.focus", {}, name);
    await until(() => { try { where(drawn, name); return surface(name).msg?.id === m.id && !surface(name).msg?.partial; } catch { return false; } }, `"${drawn}" drawn`);
    surface(name).clearSelections();
    await Bun.sleep(500);                                                       // no press before counts toward a double click
    writes.length = 0;
  };
  /** Counts what a release does on `s`: its clicks and its actions, from now on. */
  const watch = (s: ReaderPane["surface"]) => {
    const did: string[] = [], o = s as any, click = o.click, runKey = o.runKey;
    o.click = function (...a: unknown[]) { did.push("click"); return click.apply(this, a); };
    o.runKey = function (name: string, ...a: unknown[]) { did.push(name); return runKey.call(this, name, ...a); };
    return { did, stop() { o.click = click; o.runKey = runKey; } };
  };
  /** Readers showing the linked note: a followed link is one more. */
  const showingBeans = () => [...D().panes.values()].filter((p: any) => p.surface?.msg?.id === beans.id).length;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start(), 2000);
    await board.info();
    beans = await board.createBlock(null, "Stake the beans\nCanes along the fence.");
    plan = await board.createBlock(null, `Plan the allotment\nSow peas, see ((${beans.id})) first.\nWater the seedlings every morning.\n\n## Compost\nTurn the heap in March.\n\n## Sheds\nOil the hinges.`);
    hero = await board.createBlock(null, `Evening beds\n[img::${SHOWCASE_ASSETS}/evening-beds.jpg] [layout::hero] [height::8] [fit::cover]\n\nThe beds at dusk, with the shed lit.\nWater them before the light goes.`);
    for (const n of [1, 2, 3]) await board.createBlock(null, `Landing ${n} [type::gesture-landing] [landed::2026-10-2${n}]`);
    sized = await board.createBlock(null, `Sizing log\n\n${TIMELINE}\n\nThe log ends here.`);
    form = await board.createBlock(null, "Tea order\n[form-field::tea text required]");
    long = await board.createBlock(null, `Long bed\n\n${Array.from({ length: 80 }, (_, i) => `Row ${i + 1} of the bed.`).join("\n")}`);
    const svg = join(scratch.root, "roof.svg");
    await Bun.write(svg, `<svg xmlns='http://www.w3.org/2000/svg' width='800' height='200' viewBox='0 0 800 200'><rect width='800' height='200' fill='#223'/><a href='((${beans.id}))'><rect x='0' y='0' width='400' height='200' fill='#354'/><text x='20' y='100' fill='#fff' font-size='20'>the beans</text></a></svg>`);
    titled = await board.createBlock(null, `Under the shed roof\n[img::${svg}] [layout::hero] [height::10]\n\nThe roof leaks by the door.`);
    const term = { info: INFO, write(s: string) { writes.push(s); }, paint() {}, invalidate() {}, onKey(f: (k: Key) => void) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    decoder.keyHandler = k => key(k);
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    frame();
  }, 60_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  beforeEach(async () => {
    writes.length = 0;
    // One case's failure stays its own.
    if (surface()?.sourcesMode) await D().dispatch.press("sources.close", {}, T).catch(() => {});
    if (surface()?.draft) await D().dispatch.press("edit.close", { discard: true }, T).catch(() => {});
  });

  describe("each kind: press, drag, release, then a second gesture starts clean", () => {
    /** A drag across a body line selects those words and only those. */
    const selectClean = (text: string) => {
      const w = where(text);
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      expect(surface().describe().selection?.text).toBe(text.slice(0, 5));
    };

    test("text: the drag selects and copies, a click on the same words lets go of it", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Water the");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y);
      expect(copied()).toEqual([]);
      up(w.x + 4, w.y);
      expect(copied()).toEqual(["Water"]);
      await Bun.sleep(500);
      down(w.x + 2, w.y); up(w.x + 2, w.y);
      expect(surface().describe().selection).toBeNull();
      selectClean("Water the seedlings");
    });

    test("split: the divider sizes it, its release ends it, and a drag in the note selects", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "split" }, T);
      await until(() => { frame(); return surface().attachments.splitDrawn.length > 0; }, "the split drawn");
      const s = surface().attachments.splitDrawn[0]!, o = tile();
      const at = (x: number, y: number) => ({ x: x + o.col, y: y + o.row });
      const edge = s.beside ? at(s.edge, 6) : at(6, s.edge);
      const share = () => surface().attachments.splits.sources?.share;
      down(edge.x, edge.y); drag(edge.x + (s.beside ? -6 : 0), edge.y + (s.beside ? 0 : -4));
      await until(() => share() !== undefined, "the divider moved");
      const sizedTo = share();
      up(edge.x + (s.beside ? -6 : 0), edge.y + (s.beside ? 0 : -4));
      selectClean("Water the seedlings");
      expect(share()).toBe(sizedTo);
      await D().dispatch.press("sources.close", {}, T);
    });

    test("hero: its picture moves the focus on release, once, and a drag in the note selects", async () => {
      await open(hero, "The beds at dusk");
      const rows = surface().drawn!.heroRows;
      expect(rows).toBeGreaterThan(2);
      const o = tile();
      const base = (await board.get(hero.id))!.revision!;
      down(o.col + 10, o.row + 1); drag(o.col + 14, o.row + 2); up(o.col + 14, o.row + 2);
      await until(() => /hero-focus::/.test(surface().msg?.text ?? ""), "the focus saved");
      expect((await board.get(hero.id))!.revision).toBe(base + 1);
      await until(() => !frame().join("\n").includes("saving"), "the save landed");
      selectClean("Water them before");
    });

    test("frame: a floating part's top edge moves it, its release ends it, and a drag in the note selects", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "floating" }, T);
      await until(() => !!surface().sourcesMode?.frame, "the floating part drawn");
      frame();
      const o = tile(), f = surface().sourcesMode!.frame!;
      const grip = { x: o.col + f.col + 3, y: o.row + f.row };
      down(grip.x, grip.y); drag(grip.x, grip.y - 2);
      await until(() => surface().sourcesMode!.float?.row === f.row - 2, "the frame moved");
      up(grip.x, grip.y - 2);
      frame();
      const moved = { ...surface().sourcesMode!.float! };
      await D().dispatch.press("sources.close", {}, T);
      selectClean("Water the seedlings");
      expect(moved.row).toBe(f.row - 2);
    });

    test("sources: a drag over its rows selects and copies, and a drag in the note then selects there", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "split" }, T);
      await until(() => { try { where("generated"); return true; } catch { return false; } }, "the Sources rows");
      const r = where("generated");
      writes.length = 0;
      const spy = watch(surface());
      down(r.x, r.y); drag(r.x + 1, r.y); drag(r.x + 4, r.y);
      expect(surface().sourcesMode!.view.pressed).not.toBeNull();
      up(r.x + 4, r.y);
      spy.stop();
      expect(spy.did).toEqual(["sources.select", "sources.select", "sources.select", "sources.copy"]);
      expect(surface().sourcesMode!.view.pressed).toBeNull();
      await D().dispatch.press("sources.close", {}, T);
      selectClean("Water the seedlings");
    });

    test("figure: the held edge previews, its release saves once, and a drag in the note selects", async () => {
      await open(sized, "The log ends here");
      await until(() => frame().join("\n").includes("Landing 1"), "the figure's rows");
      const lines = frame(), y = lines.findIndex(l => l.includes("↔ fit"));
      const x = lines[y]!.indexOf("+") + 8;
      const before = (await board.get(sized.id))!.revision!;
      down(x, y); drag(x, y + 2);
      expect(surface().figureSizing.drag).not.toBeNull();
      up(x, y + 2);
      await until(() => !surface().figureSizing.drag, "the figure's save landed");
      await until(() => /height: 6/.test(surface().msg?.text ?? ""), "the height saved");
      expect((await board.get(sized.id))!.revision).toBe(before + 1);
      selectClean("The log ends");
    });

    test("draft place: a press places the cursor, a drag selects and copies, a second press starts clean", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("edit", {}, T);
      await until(() => !!surface().draft, "the edit");
      const d = surface().draft!;
      const w = where("Water the");
      down(w.x, w.y); up(w.x, w.y);
      expect(d.selectedText()).toBeFalsy();
      await Bun.sleep(500);
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      await until(() => copied().includes("Wate"), "the draft's selection copied");
      await Bun.sleep(500);
      const r = d.row;
      down(w.x + 8, w.y); up(w.x + 8, w.y);
      expect(d.selectedText()).toBeFalsy();
      expect(d.row).toBe(r);
      await D().dispatch.press("edit.close", { discard: true }, T);
      await until(() => !surface().editing, "the edit closed");
    });
  });

  describe("a release that never came ends what it held", () => {
    test("split: a press after a lost release doesn't size it again", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "split" }, T);
      await until(() => { frame(); return surface().attachments.splitDrawn.length > 0; }, "the split drawn");
      const s = surface().attachments.splitDrawn[0]!, o = tile();
      const edge = s.beside ? { x: o.col + s.edge, y: o.row + 6 } : { x: o.col + 6, y: o.row + s.edge };
      const off = s.beside ? { x: edge.x - 6, y: edge.y } : { x: edge.x, y: edge.y - 3 };
      down(edge.x, edge.y); drag(off.x, off.y);                                  // the button comes up outside the window: no release reaches the door
      await until(() => surface().attachments.splits.sources?.share !== undefined, "the divider moved");
      const held = surface().attachments.splits.sources!.share;
      const w = where("Water the");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      await surface().inTurn(async () => {});
      expect(surface().attachments.splits.sources!.share).toBe(held);
      expect(surface().describe().selection?.text).toBe("Water");
      await D().dispatch.press("sources.close", {}, T);
    });

    test("frame: a press after a lost release doesn't move it again", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "floating" }, T);
      await until(() => { frame(); return !!surface().sourcesMode?.frame; }, "the floating part drawn");
      const o = tile(), f = surface().sourcesMode!.frame!;
      const grip = { x: o.col + f.col + 3, y: o.row + f.row };
      down(grip.x, grip.y); drag(grip.x, grip.y - 2);                            // no release
      await until(() => surface().sourcesMode!.float?.row === f.row - 2, "the frame moved");
      const held = { ...surface().sourcesMode!.float! };
      frame();
      const away = where("Water the");
      down(away.x, away.y); drag(away.x + 3, away.y); up(away.x + 3, away.y);
      await surface().inTurn(async () => {});
      expect(surface().sourcesMode!.float).toEqual(held);
      await D().dispatch.press("sources.close", {}, T);
    });

    test("a press on the tile's border after a lost release: the frame isn't moved by the next drag", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "floating" }, T);
      await until(() => { frame(); return !!surface().sourcesMode?.frame; }, "the floating part drawn");
      const o = tile(), f = surface().sourcesMode!.frame!;
      const grip = { x: o.col + f.col + 3, y: o.row + f.row };
      down(grip.x, grip.y); drag(grip.x, grip.y - 2);                            // no release
      await until(() => surface().sourcesMode!.float?.row === f.row - 2, "the frame moved");
      const held = { ...surface().sourcesMode!.float! };
      const border = { x: o.col + 4, y: desk.rectOf(reader())!.row + desk.rectOf(reader())!.rows - 1 };
      down(border.x, border.y); drag(border.x + 1, border.y); up(border.x + 1, border.y);
      await surface().inTurn(async () => {});
      expect(surface().sourcesMode!.float).toEqual(held);
      await D().dispatch.press("sources.close", {}, T);
    });

    test("hero: the pointer moving with no button lets go of it, unsaved, and the next drag selects", async () => {
      await open(hero, "The beds at dusk");
      const o = tile();
      const before = (await board.get(hero.id))!.text;
      down(o.col + 10, o.row + 1); drag(o.col + 16, o.row + 2);                  // no release
      hover(o.col + 20, o.row + 12);
      const w = where("Water them");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      await surface().inTurn(async () => {});
      expect(surface().describe().selection?.text).toBe("Water");
      expect((await board.get(hero.id))!.text).toBe(before);
    });
  });

  describe("the release comes wherever the pointer went", () => {
    test("a selection let go on the status bar: selected to the edge, copied, and over", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Water the");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 3, 43); up(w.x + 3, 43);
      await until(() => copied().length === 1, "the selection copied");
      expect(copied()[0]).toContain("Water the seedlings every morning.");
      expect(copied()[0]).toContain("Turn the heap");
      await Bun.sleep(500);
      const a = where("Water the");
      down(a.x + 2, a.y); up(a.x + 2, a.y);
      expect(surface().describe().selection).toBeNull();
    });
  });

  describe("what ends a press under it", () => {
    test("a press on Sources' rows whose release never came is let go by the next press", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "split" }, T);
      await until(() => { try { where("generated"); return true; } catch { return false; } }, "the Sources rows");
      const r = where("generated");
      down(r.x, r.y); drag(r.x + 2, r.y);
      const w = where("Water the");
      down(w.x, w.y);
      expect(surface().sourcesMode!.view.pressed).toBeNull();
      up(w.x, w.y);
      await D().dispatch.press("sources.close", {}, T);
    });

    test("a tile closing: the release on its link opens nothing", async () => {
      const made = await app.act({ action: "tile.open", args: { kind: "reader", note: plan.id, where: "right" }, as: "gesture-test" }) as { name: string };
      await open(plan, "Water the", made.name);
      const pane = reader(made.name), w = where("Stake", made.name), spy = watch(pane.surface);
      down(w.x + 2, w.y);
      await D().dispatch.press("tile.close", {}, made.name);
      expect(desk.pane(made.name)).toBeFalsy();
      up(w.x + 2, w.y);
      spy.stop();
      expect(spy.did).toEqual([]);
      await D().dispatch.press("tile.focus", {}, T);
    });

    test("a mode opening: the press that began in the note doesn't click in the edit", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Water the");
      down(w.x + 6, w.y);
      await D().dispatch.press("edit", {}, T);
      await until(() => !!surface().draft, "the edit");
      const d = surface().draft!, was = { row: d.row, col: d.col }, spy = watch(surface());
      up(w.x + 6, w.y);
      spy.stop();
      expect(spy.did).toEqual([]);
      expect({ row: d.row, col: d.col }).toEqual(was);
      await D().dispatch.press("edit.close", { discard: true }, T);
      await until(() => !surface().editing, "the edit closed");
    });

    test("a selection drag a mode opens over: its release copies nothing of the edit's", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Water the");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y);
      await D().dispatch.press("edit", {}, T);
      await until(() => !!surface().draft, "the edit");
      const d = surface().draft!;
      d.place(1, 0); d.place(1, 3, true);
      writes.length = 0;
      up(w.x + 4, w.y);
      await surface().inTurn(async () => {});
      await Bun.sleep(30);
      expect(copied()).toEqual([]);
      await D().dispatch.press("edit.close", { discard: true }, T);
      await until(() => !surface().editing, "the edit closed");
    });

    test("a mode closing: a press in the edit, the edit closed under it, and the release doesn't follow the link there", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("edit", {}, T);
      await until(() => !!surface().draft, "the edit");
      const w = where("Sow peas");
      down(w.x + 1, w.y);
      await D().dispatch.press("edit.close", { discard: true }, T);
      await until(() => !surface().editing, "the edit closed");
      const link = where("Stake"), spy = watch(surface());
      up(link.x + 2, link.y);
      spy.stop();
      expect(spy.did).toEqual([]);
      expect(surface().msg?.id).toBe(plan.id);
    });

    test("the note changing: a hero held on the last note is over, nothing saved on either", async () => {
      await open(hero, "The beds at dusk");
      const o = tile();
      const before = (await board.get(hero.id))!.text;
      down(o.col + 10, o.row + 1); drag(o.col + 14, o.row + 2);
      await D().dispatch.press("open", { id: plan.id }, T);
      await until(() => { try { where("Water the seedlings"); return true; } catch { return false; } }, "the other note");
      const spy = watch(surface());
      up(o.col + 14, o.row + 2);
      spy.stop();
      expect(spy.did).toEqual([]);
      expect((await board.get(hero.id))!.text).toBe(before);
      expect((await board.get(plan.id))!.text).toBe(plan.text);
    });

    test("a hero's save under way: a press on the note isn't lost to it", async () => {
      await open(hero, "The beds at dusk");
      const o = tile(), s = surface() as any, runKey = s.runKey;
      let land = () => {};
      s.runKey = function (name: string, ...a: unknown[]) { return name === "image.look" ? new Promise<void>(r => { land = r; }) : runKey.call(this, name, ...a); };
      down(o.col + 10, o.row + 1); drag(o.col + 14, o.row + 2); up(o.col + 14, o.row + 2);
      const w = where("Water them");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      s.runKey = runKey;
      expect(surface().describe().selection?.text).toBe("Water");
      land();
    });
  });

  describe("each part as it worked", () => {
    const answer = async (value: string) => {
      await open(form, "Tea order");
      await D().dispatch.press("form.set", { field: "tea", value }, T);
      await until(() => { try { where(value); return true; } catch { return false; } }, "the answer drawn");
      await D().dispatch.press("form.leave", {}, T);
      return where(value);
    };

    test("a form field: a drag from outside the form selects to where it ends, and a click only places", async () => {
      const w = await answer("Sencha");
      down(w.x, w.y);
      await surface().inTurn(async () => {});
      drag(w.x + 1, w.y);
      await surface().inTurn(async () => {});
      drag(w.x + 6, w.y);
      await surface().inTurn(async () => {});
      up(w.x + 6, w.y);
      await surface().inTurn(async () => {});
      expect(surface().form!.draft("tea").selectedText()).toBe("Sencha");
      await D().dispatch.press("form.leave", {}, T);
    });

    test("a form field already focused: the same drag, with no awaits between its bytes", async () => {
      const w = await answer("Sencha");
      await D().dispatch.press("form.focus", { field: "tea" }, T);
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 6, w.y); up(w.x + 6, w.y);
      await surface().inTurn(async () => {});
      expect(surface().form!.draft("tea").selectedText()).toBe("Sencha");
      await D().dispatch.press("form.leave", {}, T);
    });

    test("the copy control: a click copies what's selected, and doesn't let go of it or select under it", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Water the");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      expect(copied()).toEqual(["Water"]);
      const c = where("[y copy]");
      await Bun.sleep(500);
      down(c.x + 2, c.y); up(c.x + 2, c.y);
      await until(() => copied().length === 2, "the control's copy");
      expect(copied()).toEqual(["Water", "Water"]);
      expect(surface().describe().selection?.text).toBe("Water");
    });

    test("the wheel during a drag scrolls, the drag goes on, and its release copies once", async () => {
      await open(long, "Row 1 of the bed");
      const w = where("Row 2 of the bed");
      const top = surface().scroll;
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y);
      sgr(65, w.x + 4, w.y, "M"); sgr(65, w.x + 4, w.y, "M");
      expect(surface().scroll).toBeGreaterThan(top);
      drag(w.x + 6, w.y); up(w.x + 6, w.y);
      await until(() => copied().length > 0, "the copy");
      expect(copied()).toHaveLength(1);
      expect(copied()[0]).toStartWith("Row 2");
      expect(surface().describe().selection?.text).toBe(copied()[0]);
    });

    test("a link in the header's SVG: a click, an alt-click and a middle-click each open it once, a drag from it doesn't", async () => {
      const closeBeside = async () => {
        for (const [id, p] of [...D().panes] as [number, any][]) if (p.surface?.msg?.id === beans.id && p !== reader()) await D().dispatch.press("tile.close", {}, D().nameOf(id));
      };
      const ready = async () => {
        await closeBeside();
        await open(titled, "Under the shed roof");
        await until(() => { frame(); return (surface() as any).heroHits.length > 0; }, "the header's link");
        const hit = (surface() as any).heroHits[0] as { row: number; from: number }, o = tile();
        return { x: o.col + hit.from + 2, y: o.row + hit.row };
      };
      for (const [what, button] of [["alt", 8], ["middle", 1], ["plain", 0]] as const) {
        const at = await ready(), spy = watch(surface());
        sgr(button, at.x, at.y, "M");
        expect(spy.did, `${what}: nothing on the press`).toEqual([]);
        sgr(button, at.x, at.y, "m");
        spy.stop();
        expect(spy.did.filter(d => d === "click"), what).toHaveLength(1);
        await until(() => showingBeans() > 0, `${what}: the link opened`, 5000);
        expect(showingBeans(), what).toBe(1);
      }
      const at = await ready(), spy = watch(surface());
      down(at.x, at.y); drag(at.x + 1, at.y); drag(at.x + 3, at.y); up(at.x + 3, at.y);
      spy.stop();
      expect(spy.did).not.toContain("click");
      expect(surface().msg?.id).toBe(titled.id);
      await closeBeside();
      // The next note has no header: where the link was drawn is nothing of its.
      await open(plan, "Water the seedlings");
      await Bun.sleep(500);
      down(at.x, at.y); up(at.x, at.y);
      await surface().inTurn(async () => {});
      await Bun.sleep(100);
      expect(surface().msg?.id).toBe(plan.id);
      expect(showingBeans()).toBe(0);
    });

    test("a river reader column: a drag selects and copies, a click on the same words lets go, a link follows", async () => {
      const was = desk;
      await app.dispatch.press("screen.open", { name: "river" });
      desk = (app as any).stack.at(-1);
      try {
        const name = (await D().dispatch.press("open", { id: plan.id }) as { name: string }).name;
        await until(() => { try { where("Water the", name); return true; } catch { return false; } }, "the column");
        await D().dispatch.press("tile.focus", {}, name);
        await Bun.sleep(500);
        writes.length = 0;
        const w = where("Water the", name);
        down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
        await until(() => copied().length === 1, "the column's copy");
        expect(copied()).toEqual(["Water"]);
        await Bun.sleep(500);
        down(w.x + 2, w.y); up(w.x + 2, w.y);
        expect(surface(name).describe().selection).toBeNull();
      } finally {
        await app.dispatch.press("screen.back", {});
        desk = was;
      }
    });
  });

  describe("a press that becomes a drag never also clicks", () => {
    test("a menu row pressed and dragged off chooses nothing, selects nothing, and a plain click still chooses", async () => {
      await open(plan, "Water the seedlings");
      await D().dispatch.press("sources.open", {}, T);
      await D().dispatch.press("sources.place", { place: "inline" }, T);
      await D().dispatch.press("placement.menu", { target: "sources" }, T);
      await until(() => frame().join("\n").includes("floating"), "the placement menu");
      const row = where("floating");
      const place = () => surface().sourcesMode?.place;
      const was = place();
      down(row.x + 1, row.y); drag(row.x + 3, row.y + 1); up(row.x + 3, row.y + 1);
      await surface().inTurn(async () => {});
      expect(place()).toBe(was);
      expect(surface().describe().selection).toBeNull();
      await D().dispatch.press("sources.close", {}, T);
    });

    test("a link pressed and dragged selects and doesn't follow; a click still follows", async () => {
      await open(plan, "Water the seedlings");
      const w = where("Stake");
      down(w.x, w.y); drag(w.x + 1, w.y); drag(w.x + 4, w.y); up(w.x + 4, w.y);
      await surface().inTurn(async () => {});
      expect(surface().msg?.id).toBe(plan.id);
      expect(surface().describe().selection?.text).toBe("Stake");
      await Bun.sleep(500);
      const showing = showingBeans();
      down(w.x + 1, w.y); up(w.x + 1, w.y);
      await until(() => showingBeans() > showing, "the link followed");
    });

    test("a fold clicks once; double-clicking a word selects it, copied once", async () => {
      await open(plan, "Turn the heap");
      const h = where("▾ ## Compost");
      down(h.x, h.y); up(h.x, h.y);
      await until(() => !frame().join("\n").includes("Turn the heap"), "the heading folded");
      await Bun.sleep(500);
      const r = where("Water the");
      down(r.x + 1, r.y); up(r.x + 1, r.y); down(r.x + 1, r.y); up(r.x + 1, r.y);
      expect(surface().describe().selection?.text).toBe("Water");
      expect(copied().filter(t => t === "Water")).toHaveLength(1);
      await D().dispatch.press("fold.toggle", { n: 1 }, T).catch(() => {});
    });
  });
});

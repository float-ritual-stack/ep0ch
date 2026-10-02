// PIE-441: keyboard navigation through a reader. `[ ]` walk every element in reading order (links, folds,
// figure rows, embeds, comment marks), ⏎ acts on the current one (a link follows, in place in a detail
// and into a detail from the preview; a fold toggles; a row or an embed opens its note; a comment mark
// expands its thread inline, PIE-420), alt+⏎ opens a link in a new reader, and a click does what ⏎ does and sets the position.
// The block the current element is in gets the reading ruler's tint, and an agent can set a focus mark
// (the door side of PIE-423) that never moves the person's position, selection or keys. Tab still
// switches areas. Fictional notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "../src/desk/screen-specs";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { RULER_BG } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
type Rect = { col: number; row: number; cols: number; rows: number };

describe("without a service", () => {
  const note = (text: string) => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {} });
  const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });

  test("[ ] reach the folds; the footer names the current element; j lets go, and ⏎ is the host's again", () => {
    const s = new NoteSurface(), h = host();
    s.show(note("Plan the allotment\nIntro.\n## Beds\n- dig\n  - edge\n## Water\nThe hose."), h);
    s.render(60, 30, h);
    expect(s.hint()).toContain("[ ] elements");
    expect(s.hint()).not.toContain("[ ] links");
    s.key(char("]"), h); s.render(60, 30, h);
    expect(s.describe().elements!.current).toMatchObject({ n: 1, kind: "fold", label: "## Beds" });
    s.key(char("]"), h); s.render(60, 30, h);
    expect(s.describe().elements!.current).toMatchObject({ n: 2, kind: "fold", label: "- dig" });
    expect(s.hint()).toStartWith("fold 2/3 - dig · ⏎ f fold");
    s.key(char("["), h); s.key(char("["), h); s.render(60, 30, h);   // wraps round to the last
    expect(s.describe().elements!.current).toMatchObject({ n: 3, label: "## Water" });
    expect(s.key({ kind: "enter" }, h)).toBe(true);
    expect(s.describe().folds!.folded).toEqual(["## Water"]);
    expect(s.key({ kind: "alt-enter" }, h)).toBe(false);          // alt+⏎ opens links, rows and embeds only
    s.key(char("j"), h);
    expect(s.describe().elements!.current).toBeNull();
    expect(s.key({ kind: "enter" }, h)).toBe(false);
  });

  test("the ruler tints the current element's block, and moves with it", () => {
    const s = new NoteSurface(), h = host();
    s.show(note("Plan\nIntro line.\n## Beds\nBeans here.\n## Water\nThe hose."), h);
    const ruled = () => s.render(60, 30, h).lines.flatMap((l, i) => (l.includes(RULER_BG) ? [plain(l).trim()] : []));
    expect(ruled()).toEqual([]);
    s.key(char("]"), h);
    expect(ruled()).toEqual(["▾ ## Beds"]);
    s.key(char("]"), h);
    expect(ruled()).toEqual(["▾ ## Water"]);
    s.key({ kind: "esc" }, h);
    expect(ruled()).toEqual([]);
  });
});

describe.skipIf(!outliner)("elements in readers, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk, hub: any;
  const n: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const B = () => BV.view(b);
  const AS = "test-agent-441";
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as?: string) => app.act({ action, args, reader, as });
  const whole = (p: ReaderPane, id?: string) => until(() => !!p.msg && !p.msg.partial && (!id || p.msg.id === id), `the whole note${id ? ` ${id.slice(0, 8)}` : ""}`);
  const frame = () => b.render(B().ctx).lines;
  const rect = (region: string): Rect => { b.render(B().ctx); return BV.rectOf(b, region); };
  const where = (lines: string[], text: string, r: Rect) => {
    for (let y = r.row; y < r.row + r.rows; y++) {
      const l = plain(lines[y] ?? ""), x = l.indexOf(text, r.col);
      if (x >= r.col && x + text.length <= r.col + r.cols) return { x: x + 1, y };
    }
    throw new Error(`"${text}" isn't drawn in ${JSON.stringify(r)}`);
  };
  const shows = (region: string, text: string) => until(() => { try { where(frame(), text, rect(region)); return true; } catch { return false; } }, `"${text}" in ${region}`);
  const click = (at: { x: number; y: number }) => { key({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y }); key({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y }); };
  const current = (p: ReaderPane) => p.surface.describe().elements?.current ?? null;
  const kinds = (p: ReaderPane) => p.surface.describeElements().map(e => `${e.kind} ${e.label}`);
  /** Step `[ ]` in the focused reader until the current element's label starts with `label`. */
  const stepTo = (p: ReaderPane, label: string) => {
    for (let i = 0; i < 20; i++) { key(char("]")); frame(); if (current(p)?.label.startsWith(label)) return; }
    throw new Error(`[ ] never reached ${label}: ${kinds(p).join(" | ")}`);
  };
  /** A fresh board, the preview on the jobs card with everything in it drawn. */
  const fresh = async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    b = boardScreen(hub.id);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1, "the lane", 10_000);
    await whole(B().preview, n.jobs.id);
    await until(() => B().preview.surface.comments?.length === 1, "the comment");
    await shows("preview", "Stake the beans");                          // its links resolved to titles
    await shows("preview", "» Paint the shed");
    await shows("preview", "Turn the compost");
    BV.at(b, "preview");
  };
  /** The jobs card in detail 1, drawn, with the keys there. */
  const detail = async () => {
    await fresh();
    key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d, n.jobs.id);
    await until(() => d.surface.comments?.length === 1, "the comment in the detail");
    await shows("detail0", "Stake the beans");
    await shows("detail0", "» Paint the shed");
    await shows("detail0", "Turn the compost");
    expect(BV.where(b)).toBe("detail0");
    return d;
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.OUTLINER_PROPERTY_SUMMARY_KEYS = "stage,related";
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.plan = (await board.request<any>("pages.follow", { address: "Garden plan", author: "agent" })).block;
    n.beans = await create(null, "Stake the beans\nCanes along the fence.");
    n.shed = await create(null, "Paint the shed\nTwo coats, green.");
    n.water = await create(null, "Water the seedlings [type::garden-job]");
    await Bun.sleep(5);                                   // the figure sorts by creation time: no same-millisecond tie
    n.compost = await create(null, "Turn the compost [type::garden-job]");
    const figure = `::graph-check\n---\ntitle: Garden jobs\nquery: "type=garden-job"\nsort: created\ndirection: asc\n---\n::`;
    n.jobs = await create(null, `Weekend jobs [stage::queued] [related::((${n.plan.id}))]\nFirst ((${n.beans.id})), then [[Garden plan]].\n\n## Beds\n- dig the north bed\n  - edge it with boards\n\n${figure}\n\n!((${n.shed.id}))`);
    const quote = "dig the north bed";
    await board.comment(`seed-${crypto.randomUUID()}`, n.jobs.id, n.jobs.revision, "Use the long spade.", { quote, start: n.jobs.text.indexOf(quote) });
    hub = await create(null, "Garden board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
    delete process.env.OUTLINER_PROPERTY_SUMMARY_KEYS;
  }, 20_000);

  test("[ ] walk every element kind in reading order, and elements lists the same order", async () => {
    await fresh();
    const p = B().preview as ReaderPane;
    expect(kinds(p)[0]).toBe(`link related ((${n.plan.id}))`);   // the summary line's value, as it's drawn
    expect(kinds(p).slice(1)).toEqual([
      "link Stake the beans",
      "link Garden plan",
      "fold ## Beds",
      "comment \"dig the north bed\" · user",         // the comment mark, in the margin before the item
      "fold - dig the north bed",
      "row Water the seedlings",
      "row Turn the compost",
      "embed » Paint the shed",
    ]);
    const seen: string[] = [];
    for (let i = 0; i < 9; i++) { key(char("]")); frame(); seen.push(current(p)!.kind); }
    expect(seen).toEqual(["link", "link", "link", "fold", "comment", "fold", "row", "row", "embed"]);
    key(char("]")); frame();
    expect(current(p)!.n).toBe(1);                                   // round to the first again
    key(char("[")); frame();
    expect(current(p)!.kind).toBe("embed");
    expect((await act("elements", {}, "preview", AS) as any).elements.map((e: any) => e.kind)).toEqual(["link", "link", "link", "fold", "comment", "fold", "row", "row", "embed"]);
    // link.select picks the element it's drawn as, so the ruler and ⏎ agree with it.
    const beans = p.surface.describe().links.findIndex(l => l.block === n.beans.id) + 1;
    // (The person's: their preview has their keys, so an agent's would be refused there.)
    await (app as any).stack.at(-1).dispatch.act({ action: "link.select", args: { n: beans }, reader: "preview" }, { kind: "user" });
    frame();
    expect(current(p)).toMatchObject({ kind: "link", label: "Stake the beans" });
  }, 30_000);

  test("⏎ in a detail: a link follows in place, a fold toggles, a row and an embed open their note in place, a comment mark expands its thread", async () => {
    let d = await detail();
    stepTo(d, "Stake the beans");
    expect(frame().map(plain).some(l => l.includes("[ ] 2/9 · link Stake the beans · ⏎ follow · alt⏎ new"))).toBe(true);   // the reader's footer
    key({ kind: "enter" });
    await whole(d, n.beans.id);
    expect(B().details.length).toBe(1);
    d = await detail();
    stepTo(d, "## Beds");
    key({ kind: "enter" });
    expect(d.surface.describe().folds!.folded).toEqual(["## Beds"]);
    key({ kind: "enter" });
    expect(d.surface.describe().folds!.folded).toEqual([]);
    stepTo(d, "Turn the compost");
    key({ kind: "enter" });
    await whole(d, n.compost.id);
    d = await detail();
    stepTo(d, "» ");
    key({ kind: "enter" });
    await whole(d, n.shed.id);
    d = await detail();
    stepTo(d, "\"dig the north bed\"");
    key({ kind: "enter" });
    await shows("detail0", "Use the long spade.");                   // the thread, inline under its passage (PIE-420)
    expect(d.surface.session).toBeNull();
    expect(d.surface.expanded.size).toBe(1);
    key({ kind: "enter" });
    frame();
    expect(d.surface.expanded.size).toBe(0);
    expect(current(d)!.kind).toBe("comment");
  }, 40_000);

  test("⏎ in the preview: links, rows and embeds open in a detail and the preview stays; a fold toggles there; a comment mark expands its thread there", async () => {
    for (const [label, target] of [["Garden plan", "plan"], ["Water the seedlings", "water"], ["» ", "shed"]] as const) {
      await fresh();
      const p = B().preview as ReaderPane;
      stepTo(p, label);
      key({ kind: "enter" });
      await until(() => B().details[0]?.msg?.id === n[target].id, `${label} in a detail`);
      expect(p.msg!.id).toBe(n.jobs.id);
      expect(BV.where(b)).toBe("detail0");
      expect(current(p)!.label.startsWith(label)).toBe(true);        // the preview keeps its place
    }
    await fresh();
    const p = B().preview as ReaderPane;
    stepTo(p, "- dig");
    key({ kind: "enter" });
    expect(p.surface.describe().folds!.folded).toEqual(["- dig the north bed"]);
    expect(B().details.length).toBe(0);
    stepTo(p, "\"dig");
    key({ kind: "enter" });
    await shows("preview", "Use the long spade.");
    expect(p.surface.session).toBeNull();
    expect(B().details.length).toBe(0);
    key({ kind: "enter" });
    frame();
    expect(p.surface.expanded.size).toBe(0);
    // With nothing current, ⏎ opens the preview's note in a detail, as before.
    key({ kind: "esc" });
    BV.at(b, "preview");
    key({ kind: "enter" });
    await until(() => B().details[0]?.msg?.id === n.jobs.id, "the card in a detail");
  }, 40_000);

  test("alt+⏎ on a link opens a new detail, from a detail and from the preview", async () => {
    const d = await detail();
    stepTo(d, "Stake the beans");
    key({ kind: "alt-enter" });
    await until(() => B().details.length === 2 && B().details[1].msg?.id === n.beans.id, "a new detail");
    expect(d.msg!.id).toBe(n.jobs.id);                                // the first detail keeps its note
    await fresh();
    key({ kind: "enter" });                                            // detail 1 on the card
    await whole(B().details[0], n.jobs.id);
    BV.at(b, "preview");
    stepTo(B().preview, "Garden plan");
    key({ kind: "alt-enter" });
    await until(() => B().details.length === 2 && B().details[1].msg?.id === n.plan.id, "a new detail from the preview");
    expect(B().details[0].msg.id).toBe(n.jobs.id);
  }, 30_000);

  test("a click does what ⏎ does and sets the [ ] position: a fold, a comment mark, a figure row", async () => {
    await fresh();
    const p = B().preview as ReaderPane;
    click(where(frame(), "## Beds", rect("preview")));
    expect(p.surface.describe().folds!.folded).toEqual(["## Beds"]);
    expect(current(p)).toMatchObject({ kind: "fold", label: "## Beds" });
    click(where(frame(), "## Beds", rect("preview")));
    // The comment mark sits in the margin, one cell left of the item.
    const item = where(frame(), "dig the north bed", rect("preview"));
    const r = rect("preview");
    click({ x: r.col + 1, y: item.y });
    await shows("preview", "Use the long spade.");                     // expanded inline (PIE-420)
    expect(current(p)!.kind).toBe("comment");                          // and it's the [ ] position
    click({ x: r.col + 1, y: item.y });
    frame();
    expect(p.surface.expanded.size).toBe(0);
    click(where(frame(), "Turn the compost", rect("preview")));
    await until(() => B().details[0]?.msg?.id === n.compost.id, "the row's note in a detail");
    expect(current(p)).toMatchObject({ kind: "row", label: "Turn the compost" });
    // A drag across the same row still selects text, and opens nothing.
    const d0 = B().details.length, at = where(frame(), "Water the seedlings", rect("preview"));
    key({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
    key({ kind: "mouse", action: "drag", button: 0, x: at.x + 6, y: at.y });
    key({ kind: "mouse", action: "up", button: 0, x: at.x + 6, y: at.y });
    await Bun.sleep(100);
    expect(p.surface.selection).not.toBeNull();
    expect(B().details.length).toBe(d0);
    expect(B().details[0].msg.id).toBe(n.compost.id);
  }, 30_000);

  test("the ruler follows the current element in a board reader", async () => {
    await fresh();
    const r = rect("preview");
    const ruled = () => frame().slice(r.row, r.row + r.rows).flatMap(l => (l.includes(RULER_BG) ? [plain(l).slice(r.col + 1, r.col + r.cols - 1).trim()] : []));
    expect(ruled()).toEqual([]);
    stepTo(B().preview, "## Beds");
    expect(ruled()).toEqual(["▾ ## Beds"]);
    stepTo(B().preview, "Water the seedlings");
    expect(ruled()).toHaveLength(1);
    expect(ruled()[0]).toContain("Water the seedlings");
  }, 20_000);

  test("an agent's focus mark: tinted, named in the header, and the person's position, selection and keys stay", async () => {
    await fresh();
    const p = B().preview as ReaderPane;
    stepTo(p, "Stake the beans");
    // The person's own selection: a drag across "First" on the first body row.
    const w0 = where(frame(), "First", rect("preview"));
    key({ kind: "mouse", action: "down", button: 0, x: w0.x - 1, y: w0.y });
    key({ kind: "mouse", action: "drag", button: 0, x: w0.x + 3, y: w0.y });
    key({ kind: "mouse", action: "up", button: 0, x: w0.x + 3, y: w0.y });
    const r = rect("preview");
    const before = { cur: current(p), scroll: p.surface.scroll, focus: BV.where(b), selection: p.surface.describe().selection };
    expect(before.selection).toMatchObject({ text: "First" });
    const out = await act("focus.set", { quote: "edge it with boards" }, "preview", AS) as any;
    expect(out).toMatchObject({ reader: "preview", marked: "\"edge it with boards\"", by: AS });
    const lines = frame().slice(r.row, r.row + r.rows);
    expect(lines.map(plain).some(l => l.includes(`focus · an agent (${AS}) marked "edge it with boards"`))).toBe(true);
    const ruled = lines.flatMap(l => (l.includes(RULER_BG) ? [plain(l).slice(r.col + 1, r.col + r.cols - 1).trim()] : []));
    expect(ruled.some(l => l.includes("edge it with boards"))).toBe(true);
    expect(ruled.some(l => l.includes("Stake the beans"))).toBe(true);         // the person's own ruler stays too
    expect(current(p)).toEqual(before.cur);
    expect(p.surface.scroll).toBe(before.scroll);                               // already in view: nothing moved
    expect(BV.where(b)).toBe(before.focus);
    expect(p.surface.describe().selection).toEqual(before.selection);
    expect(p.surface.describe().focus).toMatchObject({ by: AS, quote: "edge it with boards" });
    // The position is the person's: an agent can't move it, and ⏎ still acts on theirs.
    await expect(act("element.select", { n: 1 }, "preview", AS)).rejects.toThrow("the [ ] position is the person's");
    key({ kind: "enter" });
    await until(() => B().details[0]?.msg?.id === n.beans.id, "the person's link");
    // Refusals say why; focus.clear (or the person's esc once nothing else is selected) takes it away.
    await expect(act("focus.set", { quote: "not in the note" }, "preview", AS)).rejects.toThrow("isn't in the note's current text");
    await expect(act("focus.set", { line: 3, quote: "x" }, "preview", AS)).rejects.toThrow("say what to mark");
    // A block it embeds: the embed's region is tinted. The note itself with a passage: the passage's lines.
    await act("focus.set", { block: n.shed.id.slice(0, 8) }, "preview", AS);
    expect(frame().filter(l => l.includes(RULER_BG)).map(plain).some(l => l.includes("» Paint the shed"))).toBe(true);
    expect(await act("focus.set", { block: n.jobs.id, quote: "dig the north bed" }, "preview", AS)).toMatchObject({ marked: "\"dig the north bed\"" });
    await expect(act("focus.set", { block: n.shed.id, quote: "Two coats" }, "preview", AS)).rejects.toThrow("a passage is found in the note this reader shows");
    expect(await act("focus.clear", {}, "preview", AS)).toMatchObject({ cleared: true, by: AS });
    expect(p.surface.describe().focus).toBeNull();
  }, 30_000);

  test("an agent's focus mark scrolls a long note to it; the person's position stays, and [ ] steps on from it", async () => {
    const long = await create(null, `Year plan [stage::later]\nSee [[Garden plan]] first.\n${Array.from({ length: 80 }, (_, i) => `Week ${i + 1}: weed the beds.`).join("\n")}\n## Autumn\nMulch everything.`);
    await fresh();
    await act("open", { id: long.id }, "detail", AS);
    const d = B().details[0] as ReaderPane;
    await whole(d, long.id);
    BV.at(b, "detail0");
    stepTo(d, "Garden plan");
    expect(d.surface.scroll).toBe(0);
    await act("focus.set", { quote: "Mulch everything." }, "detail1", AS);
    frame();
    expect(d.surface.scroll).toBeGreaterThan(40);                     // brought into view
    expect(frame().filter(l => l.includes(RULER_BG)).map(plain).some(l => l.includes("Mulch everything."))).toBe(true);
    expect(current(d)).toMatchObject({ n: 1, label: "Garden plan" });   // the person's position is where it was
    expect(frame().map(plain).some(l => l.includes("[ ] 1/2 · link Garden plan · out of view"))).toBe(true);
    key({ kind: "enter" });                                               // not in view: ⏎ isn't the reader's
    await Bun.sleep(100);
    expect(d.msg!.id).toBe(long.id);
    key(char("]")); frame();
    expect(current(d)).toMatchObject({ n: 2, kind: "fold", label: "## Autumn" });   // on from it, not from the view
    await act("element.open", { n: 2 }, "detail1", AS);              // the agent toggles it; the position stays
    expect(d.surface.describe().folds!.folded).toEqual(["## Autumn"]);
    frame();
    expect(current(d)).toMatchObject({ n: 2 });
  }, 30_000);

  test("Tab still switches areas while an element is current", async () => {
    await fresh();
    key({ kind: "enter" });
    await whole(B().details[0], n.jobs.id);
    BV.at(b, "preview");
    stepTo(B().preview, "## Beds");
    const at = current(B().preview);
    const order: string[] = [];
    for (let i = 0; i < 3; i++) { key({ kind: "tab" }); order.push(BV.where(b)); }
    expect(order).toEqual(["detail0", "lanes", "preview"]);
    expect(current(B().preview)).toEqual(at);                         // Tab didn't step
  }, 20_000);

  test("the desk: alt+⏎ on a link opens a new reader holding it; ⏎ follows in place", async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    const desk = new Desk(), D = desk as any;
    app.push(desk);
    try {
      await act("open", { id: n.jobs.id }, undefined, AS);
      const readers = () => [...D.panes.values()].filter((x: any) => x.kind === "reader") as ReaderPane[];
      const r0 = readers()[0]!;
      await whole(r0, n.jobs.id);
      D.focus = [...D.panes.entries()].find(([, x]: any) => x === r0)![0];
      desk.render(D.ctx);
      for (let i = 0; i < 20 && !current(r0)?.label.startsWith("Stake"); i++) { key(char("]")); desk.render(D.ctx); }
      key({ kind: "alt-enter" });
      await until(() => readers().length === 2 && readers()[1]!.msg?.id === n.beans.id, "a new desk reader");
      expect(r0.msg!.id).toBe(n.jobs.id);
      expect(readers()[1]!.describe().held).toBe(true);
    } finally { app.pop(); }
  }, 30_000);

  test("the river: alt+⏎ on a selected link opens the link in a new column, not the card", async () => {
    if ((app as any).stack.at(-1) instanceof Desk) app.pop();
    const river = openScreen("river") as Desk, V = () => riverView(river);
    app.push(river);
    try {
      await act("open", { id: n.jobs.id }, undefined, AS);
      await until(() => !!V().byNote(n.jobs.id), "the jobs column");
      const p = V().byNote(n.jobs.id)!;
      river.focusPane(p, USER);
      await until(() => !!p.items, "the column's rows");
      river.render(river.ctx);
      key(char("]"));                                                    // the river steps links (it draws its own body)
      expect(p.surface.describe().links.find((l: any) => l.selected)).toBeTruthy();
      const cols = V().columns.length;
      key({ kind: "alt-enter" });
      await until(() => V().columns.length === cols + 1, "a new column");
      // The new column holds the link's note (the person's keys went to it), not the jobs card.
      await until(() => !!(river.focusedPane() as ReaderPane).msg, "the new column's note");
      const id = (river.focusedPane() as ReaderPane).msg!.id;
      expect([n.plan.id, n.beans.id, n.shed.id]).toContain(id);
      expect(id).not.toBe(n.jobs.id);
    } finally { app.pop(); }
  }, 30_000);
});

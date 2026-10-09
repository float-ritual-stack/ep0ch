// PIE-673: the look (spacing and list density from the outline's style notes, src/look.ts) drawn by the desk and the
// reader, and never leaking into the text: a copy, a click, a paste and an export see the note's source whatever the
// padding, measure, margin, gap and dividers. And the tune inspector's nudge: drawn in the next frame, nothing read.
// Fictional notes, against a scratch outline only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { exportFiles, readRecords } from "../src/export";
import { lookFor, sheetsReady, Tuning, tuningOf } from "../src/look";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { renderDoc } from "../src/doc";
import { rowsOf, Selection } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

/** A paragraph long enough to wrap differently at 40, 80 and 160 columns. */
const PARA = "Sow the broad beans in a double row along the north fence, two hands apart, and push a hazel twig in beside every fifth one so the wind off the allotment path doesn't flatten them before they flower in May.";
const ITEMS = ["- Net the brassicas", "- Turn the left compost bay", "- Oil the shed hinge"];
const BODY = [PARA, "", ...ITEMS].join("\n");

describe("the doc renderer's list rows and soft wraps (no service)", () => {
  const values = (o: Record<string, unknown>) => ({ ...lookFor(null, {}, 80).values, ...o }) as any;
  const env = (look?: Record<string, unknown>) => ({ width: 40, cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: false, ...(look ? { look: { values: values(look), layers: [], width: 80 } } : {}) });
  /** The whole document selected and copied, as a reader's rows give it (its trims are the drawing; its wraps join). */
  const copy = (d: ReturnType<typeof renderDoc>, w: number) => {
    const rows = rowsOf(d.lines, () => 0, r => d.trims.get(r));
    return new Selection({ row: 0, col: 0 }, { row: d.lines.length - 1, col: 999 }).text({ ...rows, joins: r => d.wraps?.get(r + 1) });
  };

  test("gap and divider rows sit between items, and are edge rows: a copy joins the items with one newline", () => {
    const d = renderDoc(BODY, env({ "list.gap": 2, "list.divider": "dots", "list.zebra": true }));
    const text = d.lines.map(plain);
    const at = (s: string) => text.findIndex(l => l.includes(s));
    expect(at("Turn the left") - at("Net the brassicas")).toBe(4);      // 2 blank rows and a divider between
    expect(text[at("Net the brassicas") + 3]).toMatch(/^(· )+·?$/);
    // The zebra tints the second item's own rows, not the gap or divider under it.
    expect(d.zebra).toEqual([[at("Turn the left"), at("Turn the left") + 1]]);
    expect(copy(d, 40)).toBe(BODY);
  });

  test("a wrapped paragraph copies to its one source line at every width", () => {
    for (const width of [40, 80, 160]) {
      const d = renderDoc(BODY, { ...env({ "list.gap": 1 }), width });
      expect(copy(d, width)).toBe(BODY);
    }
  });

  test("a copy joins a wrap by what the wrap took: a word that fills its row and the next aren't run together; a word cut across rows is", () => {
    const e = { ...env(), width: 10 };
    expect(copy(renderDoc("abcdefghij next", e), 10)).toBe("abcdefghij next");
    expect(copy(renderDoc("abcdefghijklmnopqrstuv end", e), 10)).toBe("abcdefghijklmnopqrstuv end");
    expect(copy(renderDoc("- one two three four five six", e), 10)).toBe("- one two three four five six");
  });

  test("without a look, nothing changes: no gap rows, no zebra", () => {
    const d = renderDoc(BODY, env());
    expect(d.zebra).toBeUndefined();
    expect(d.lines.map(plain).filter(l => /Net|Turn|Oil/.test(l))).toHaveLength(3);
    expect(d.lines.length).toBe(renderDoc(BODY, env({})).lines.length);
  });

  test("a box: its lines inset by its own margin, its list by its own tokens, the inset never copied", () => {
    const src = ["Before", "::box{margin.x=4 list.gap=0}", "- one", "- two", "::", "After"].join("\n");
    const d = renderDoc(src, env({ "list.gap": 2 }));
    const text = d.lines.map(plain);
    expect(text.find(l => l.includes("one"))).toStartWith("    ");
    expect(text.findIndex(l => l.includes("two")) - text.findIndex(l => l.includes("one"))).toBe(1);
    expect(copy(d, 40)).toBe("Before\n- one\n- two\nAfter");
  });
});

describe("the tuning (no service)", () => {
  const A = { kind: "agent" as const, id: "agent-a" }, B = { kind: "agent" as const, id: "agent-b" }, YOU = { kind: "user" as const };
  test("an agent undoes only its own, and not once someone changed that value again", () => {
    const t = new Tuning();
    t.set("global", "list.gap", "1", A);
    t.set("global", "list.gap", "2", B);
    expect(() => t.undo(A)).toThrow("list.gap was changed again since (by agent-b)");
    expect(t.get("global", "list.gap")?.value).toBe("2");
    expect(t.undo(B)?.field).toBe("list.gap");
    expect(t.get("global", "list.gap")?.value).toBe("1");
    // The person's undo takes back the last change, whoever made it.
    t.set("global", "measure", "72", A);
    expect(t.undo(YOU)?.field).toBe("measure");
  });
  test("a save marks saved only the values it wrote: one nudged again meanwhile stays unsaved", () => {
    const t = new Tuning();
    t.set("tile:detail", "measure", "72", YOU);
    const written = t.unsaved()[0]!.fields;
    t.set("tile:detail", "measure", "76", YOU);
    t.markSaved("tile:detail", written);
    expect(t.unsavedCount()).toBe(1);
    expect(t.get("tile:detail", "measure")).toMatchObject({ value: "76" });
  });
  test("a nudge goes into the declaration it tunes: its width variant keeps winning, live as after the save", async () => {
    const sheets = [{ for: "global", block: "g", fields: { "list.gap": "1", "narrow.list.gap": "0" } }];
    const src = { board: { styleSheets: async () => ({ sheets, problems: [] }) }, redraw() {} };
    await sheetsReady(src);
    const t = tuningOf(src.board);
    t.set("global", "list.gap", "2", YOU);
    // Narrow, the declaration's own narrow.list.gap still wins (as it will once saved there); normal width takes the nudge.
    expect(lookFor(src, {}, 40).values["list.gap"]).toBe(0);
    expect(lookFor(src, {}, 80).values["list.gap"]).toBe(2);
    expect(lookFor(src, {}, 80).sources["list.gap"]).toMatchObject({ level: "global", block: "g" });
  });
});

describe.skipIf(!outliner)("the look on the desk, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, note: any, style: any;
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "user" });

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    // The detail screen's look: padded, a measure, a margin, a gap and dotted dividers between items.
    style = await create(null, "Comfort [style-for::screen:detail] [style.pad::1] [style.measure::56] [style.margin.x::3] [style.list.gap::1] [style.list.divider::dots]");
    note = await create(null, `Bean row\n${BODY}`);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  /** A door at `cols` columns on the detail screen of the note, its terminal's writes kept. */
  async function door(cols: number) {
    const writes: string[] = [];
    let key: (k: Key) => void = () => {};
    const term = { info: { cols, rows: 46, cellW: 9, cellH: 16, kitty: false }, write(s: string) { writes.push(s); }, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    const sub = board.subscribe(e => app.event(e));
    const desk = openScreen("detail", { note: note.id, persist: false }) as Desk;
    app.push(new MainMenu()); app.push(desk);
    const lines = () => desk.render((desk as any).ctx).lines.map(plain);
    await until(() => lines().some(l => l.includes("Oil the shed")) && lines().some(l => /· · ·/.test(l)), `the note drawn with its look at ${cols}`, 10_000);
    const mouse = (action: "down" | "drag" | "up", x: number, y: number) => key({ kind: "mouse", action, button: 0, x, y });
    const where = (text: string) => {
      const ls = lines();
      for (let y = 0; y < ls.length; y++) { const x = ls[y]!.indexOf(text); if (x >= 0) return { x, y }; }
      throw new Error(`"${text}" isn't drawn:\n${ls.join("\n")}`);
    };
    const copied = () => [...writes.join("").matchAll(/\x1b\]52;c;([A-Za-z0-9+/=]*)\x07/g)].map(m => Buffer.from(m[1]!, "base64").toString("utf8"));
    const reader = () => [...(desk as any).panes.values()].find((p: any) => p.surface) as any;
    return { app, desk, lines, key, mouse, where, copied, reader, close: () => { app.pop(); app.pop(); (sub as any)?.(); } };
  }

  for (const cols of [40, 80, 160]) {
    test(`at ${cols} columns: a drag across the padded, centred reader and its gapped list copies the source lines`, async () => {
      const d = await door(cols);
      try {
        const first = d.where("Sow the broad"), last = d.where("Oil the shed hinge");
        // The text starts past the frame, the padding (2 columns), the margin (3) and, wide, the measure's centring.
        expect(first.x).toBeGreaterThanOrEqual(1 + 2 + 3);
        if (cols === 160) expect(first.x).toBeGreaterThan(40);
        d.mouse("down", first.x, first.y); d.mouse("drag", first.x + 1, first.y); d.mouse("drag", last.x + 18, last.y); d.mouse("up", last.x + 18, last.y);
        await until(() => d.copied().length > 0, "the drag's copy", 5000);
        expect(d.copied().at(-1)).toBe(BODY);
        // An agent's select.copy gives the same clean text.
        const r = await d.app.act({ action: "select", args: { text: "Sow the broad" }, tile: "detail", as: "look-agent" }) as any;
        expect(r.chars).toBe(13);
        // peek reports the look, and its text has no spacing in it.
        const peek = await d.app.act({ action: "view.get", tile: "detail", as: "look-agent" }) as any;
        expect(JSON.stringify(peek)).not.toMatch(/ {3}Sow the broad/);
      } finally { d.close(); }
    }, 30_000);
  }

  test("a press in the padding or beside the measure is the nearest cell of the text; a click on the first character after the margin places the edit's cursor there; a paste lands at it", async () => {
    const d = await door(120);
    try {
      d.key({ kind: "char", ch: "e" });
      await until(() => !!d.reader()?.surface.draft, "the edit", 5000);
      const draft = d.reader().surface.draft;
      const at = d.where("Sow the broad");
      d.mouse("down", at.x, at.y); d.mouse("up", at.x, at.y);
      expect([draft.row, draft.col]).toEqual([1, 0]);
      // In the gutter left of the text, on the same row: the line's start too.
      d.mouse("down", 2, at.y); d.mouse("up", 2, at.y);
      expect(draft.row).toBe(1);
      d.key({ kind: "paste", text: "Early. " });
      expect(draft.lines[1]).toStartWith("Early. Sow the broad");
      d.key({ kind: "esc" }); d.key({ kind: "esc" });
    } finally { d.close(); }
  }, 30_000);

  test("a nudge draws in the next frame and reads nothing from the outline; the tune inspector says where each value comes from", async () => {
    const d = await door(140);
    try {
      expect(await d.app.act({ action: "tile.tune", tile: "detail", as: "look-agent" })).toMatchObject({ tunes: "detail" });
      await until(() => d.lines().some(l => l.includes("list.gap")), "the inspector", 5000);
      // The inspector's own read (what peek gives an agent): each value and where it comes from.
      const tune = [...(d.desk as any).panes.values()].find((p: any) => p.kind === "tune");
      expect(tune.describe(d.desk).values).toMatchObject({ "list.gap": { value: "1", from: "screen detail", note: style.id }, measure: { value: "56" }, "pad.x": { value: "2" } });
      const gapBefore = d.where("Turn the left").y - d.where("Net the brassicas").y;
      const asked: string[] = [];
      const request = board.request.bind(board);
      (board as any).request = (action: string, params: any) => { asked.push(action); return request(action, params); };
      try {
        const r = await d.app.act({ action: "tune.nudge", args: { row: "list.gap", by: 1 }, tile: "tune", as: "look-agent" }) as any;
        expect(r).toMatchObject({ value: "2", at: "screen detail" });
        // The very next frame has it.
        expect(d.where("Turn the left").y - d.where("Net the brassicas").y).toBe(gapBefore + 1);
        expect(asked.filter(a => a !== "ping" && a !== "clients.heartbeat")).toEqual([]);
      } finally { (board as any).request = request; }
      // Unsaved, it says so; the door's quit says so too.
      expect(tuningOf(board).unsavedCount()).toBe(1);
      expect((d.app as any).confirmQuit()).toBe(false);
      expect(String((d.app as any).message)).toStartWith("unsaved tuning, s to save");
      // Saved: onto the style note that set it, attributed to the agent, and the sheets say the same.
      expect(await d.app.act({ action: "tune.save", tile: "tune", as: "look-agent" })).toMatchObject({ saved: true, at: "screen detail" });
      const m = await board.get(style.id);
      expect(m!.text).toContain("[style.list.gap::2]");
      expect(tuningOf(board).unsavedCount()).toBe(0);
    } finally { d.close(); }
  }, 30_000);

  test("an edit to a style note restyles a door that's open, through the change feed", async () => {
    const d = await door(100);
    try {
      const gap = () => d.where("Turn the left").y - d.where("Net the brassicas").y;
      const before = gap();
      const m = (await board.get(style.id))!;
      await board.update(m.id, m.text.replace(/\[style\.list\.gap::\d\]/, "[style.list.gap::0]"), m.revision!);
      await until(() => gap() < before, "the gap gone", 10_000);
    } finally { d.close(); }
  }, 30_000);

  test("ep0ch export leaves the look out: the note's source, whatever the style notes say", async () => {
    const { byId } = await readRecords(board, [note.id], false);
    const [file] = exportFiles([byId.get(note.id)!], byId, { format: "md", children: false, split: false, resolveLinks: false });
    expect(file!.content).toContain(`${PARA}\n\n${ITEMS.join("\n")}`);
    expect(file!.content).not.toMatch(/· ·|^ {2,}Sow/m);
  });
});

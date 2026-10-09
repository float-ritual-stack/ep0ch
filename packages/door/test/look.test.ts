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
import { lookFor, sheetsReady, stepWords, Tuning, tuningOf, UNSET } from "../src/look";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { renderDoc } from "../src/doc";
import { rowsOf, Selection } from "../src/surface/selection";
import { bgRgb, fg, surfaceBg } from "../src/style";
import { surfaceMix } from "../src/theme";
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
    // Centred in the gap by default (list.divider.align).
    expect(text[at("Net the brassicas") + 2]).toMatch(/^(· )+·?$/);
    // The zebra tints the second item's own rows, not the gap or divider under it.
    expect(d.tints?.map(t => t.rows)).toEqual([[at("Turn the left"), at("Turn the left") + 1]]);
    expect(copy(d, 40)).toBe(BODY);
  });

  test("a divider's style, glyph and place in the gap (PIE-675): all drawing, never copied", () => {
    const rowAfter = (look: Record<string, unknown>, k: number) => {
      const d = renderDoc(BODY, env({ "list.gap": 2, ...look }));
      const text = d.lines.map(plain), from = text.findIndex(l => l.includes("Net the brassicas"));
      expect(copy(d, 40)).toBe(BODY);
      return text[from + k]!;
    };
    expect(rowAfter({ "list.divider": "line", "list.divider.align": "top" }, 1)).toMatch(/^─+$/);
    expect(rowAfter({ "list.divider": "double", "list.divider.align": "bottom" }, 3)).toMatch(/^═+$/);
    expect(rowAfter({ "list.divider": "dashed" }, 2)).toMatch(/^╌+$/);
    expect(rowAfter({ "list.divider": "glyph", "list.divider.glyph": "✦" }, 2)).toMatch(/^(✦ )+✦?$/);
    expect(rowAfter({ "list.divider": "glyph", "list.divider.glyph": "┄" }, 2)).toMatch(/^┄+$/);
    // fade: the rule's track (PIE-599) where it fits; at 40 columns (narrow) a plain line.
    expect(rowAfter({ "list.divider": "fade" }, 2)).toMatch(/^─+$/);
    const wide = renderDoc(BODY, { ...env({ "list.gap": 0, "list.divider": "fade" }), width: 80 }).lines.map(plain);
    expect(wide.some(l => /^▓+▒+░+/.test(l))).toBe(true);
  });

  test("this list (PIE-675): a list's own tokens on its section's heading or its lead-in line; a sibling list stays tight; nothing of it copied", () => {
    const body = ["## Climbers [style.list.gap::2] [style.list.divider::dots]", "- runner beans", "- sweet peas", "", "## Ground", "- clover", "- thyme", "", "Herbs: [style.list.zebra::on]", "- mint", "- sage"].join("\n");
    const d = renderDoc(body, env({ "list.gap": 0 }));
    const text = d.lines.map(plain), at = (x: string) => text.findIndex(l => l.includes(x));
    expect(at("sweet peas") - at("runner beans")).toBe(4);           // 2 blank rows and a divider (centred)
    expect(at("thyme") - at("clover")).toBe(1);                       // the page's: tight
    expect(d.tints?.map(t => t.rows)).toEqual([[at("sage"), at("sage") + 1]]);   // the lead-in's zebra, on its own list only
    // The tuning over a line's own (the reader's lists callback): Ground made airy in memory.
    const tuned = renderDoc(body, { ...env({ "list.gap": 0 }), look: { ...env({ "list.gap": 0 }).look!, lists: (n: number, f: Readonly<Record<string, string>>) => (n === 4 ? { ...f, "list.gap": "1" } : { ...f }) } });
    const t2 = tuned.lines.map(plain);
    expect(t2.findIndex(l => l.includes("thyme")) - t2.findIndex(l => l.includes("clover"))).toBe(2);
  });

  test("a box's surface, frame and bar (PIE-675): drawn round its text, the text copies as written", () => {
    const BOX = ["::box{bg=amber border=round tone=amber pad=1}", "- Net the brassicas", "- Oil the shed hinge", "::"].join("\n");
    const d = renderDoc(BOX, { ...env({}), width: 40 });
    const text = d.lines.map(plain);
    expect(text[0]).toMatch(/^╭─+╮$/);
    expect(text.at(-1)).toMatch(/^╰─+╯$/);
    expect(text.find(l => l.includes("Net the"))).toMatch(/^│ {2}∙ Net the brassicas +│$/);
    // Its surface: inside the frame, over its padding rows and its text's.
    expect(d.tints).toEqual([{ rows: [1, d.lines.length - 1], cols: [1, 39], bg: expect.stringMatching(/^\x1b\[48;2;/) }]);
    expect(copy(d, 40)).toBe("- Net the brassicas\n- Oil the shed hinge");
    const barred = renderDoc(["::box{edge=bar tone=green}", "Keep the gate shut.", "::"].join("\n"), { ...env({}), width: 40 });
    expect(barred.lines.map(plain)[0]).toBe("▌ Keep the gate shut.");
    expect(copy(barred, 40)).toBe("Keep the gate shut.");
    // Inset clamped in a narrow tile: its surface is where its text is drawn, never past either edge.
    const narrow = renderDoc(["::box{margin.x=24 bg=raised}", "Keep the gate shut.", "::"].join("\n"), { ...env({}), width: 12 });
    const [t0] = narrow.tints!;
    expect(t0!.cols![0]).toBeGreaterThanOrEqual(0);
    expect(t0!.cols![1]).toBeLessThanOrEqual(12);
    expect(t0!.cols![0]).toBeLessThanOrEqual(narrow.lines.map(plain).find(l => l.trim())!.search(/\S/));
    // Too narrow for a frame: inset, as before.
    expect(renderDoc(BOX, { ...env({}), width: 12 }).lines.map(plain).some(l => l.includes("╭"))).toBe(false);
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
    expect(d.tints).toBeUndefined();
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
  test("an agent undoes only its own, and not once someone changed that value again; redo does it again", () => {
    const t = new Tuning();
    const undo = (by: typeof A | typeof YOU) => { const s = t.nextUndo(by); if (s) t.undone(s); return s; };
    t.set("global", "list.gap", "1", A);
    t.set("global", "list.gap", "2", B);
    expect(() => t.nextUndo(A)).toThrow("list.gap was changed again since (by agent-b)");
    expect(t.get("global", "list.gap")?.value).toBe("2");
    expect(undo(B)).toMatchObject({ field: "list.gap" });
    expect(t.get("global", "list.gap")?.value).toBe("1");
    // The person's undo takes back the last change, whoever made it; and steps back through every one.
    t.set("global", "measure", "72", A);
    t.set("global", "measure", "76", YOU);
    expect(stepWords(undo(YOU)!, true)).toBe("measure 76 → 72 at global");
    expect(stepWords(undo(YOU)!, true)).toBe("measure 72 → the outline's at global");
    expect(stepWords(undo(YOU)!, true)).toBe("list.gap 1 → the outline's at global");
    expect(t.get("global", "list.gap")).toBeUndefined();
    // Redo, in order; an agent can't redo another's (the last taken back is agent-a's list.gap).
    expect(() => t.nextRedo(B)).toThrow("isn't yours");
    const redo = () => { const s = t.nextRedo(YOU)!; t.redone(s); return s; };
    expect(stepWords(redo(), false)).toBe("list.gap the outline's → 1 at global");
    expect(stepWords(redo(), false)).toBe("measure the outline's → 72 at global");
    expect(t.get("global", "measure")?.value).toBe("72");
    // A new nudge ends what can be redone.
    t.set("global", "pad.x", "4", YOU);
    expect(t.nextRedo(YOU)).toBeNull();
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

describe("taking a value away (PIE-675, no service)", () => {
  const YOU = { kind: "user" as const };
  test("it leaves only the declaration it came from: an older one still shows, as it will after the save; the outline's answer settles it", async () => {
    const sheets = [{ for: "global", block: "g1", fields: { bg: "blue" } as Record<string, string> }, { for: "global", block: "g2", fields: { bg: "raised" } as Record<string, string> }];
    const src = { board: { styleSheets: async () => ({ sheets, problems: [] }) }, redraw() {} };
    await sheetsReady(src);
    const t = tuningOf(src.board);
    expect(lookFor(src, {}, 80).values.bg).toBe("raised");
    t.set("global", "bg", UNSET, YOU, "g2");
    expect(lookFor(src, {}, 80).values.bg).toBe("blue");
    expect(lookFor(src, {}, 80).sources.bg).toMatchObject({ level: "global", block: "g1" });
    // Saved, it stays over the outline until the note it came from no longer sets it; then it's let go.
    t.markSaved("global", t.unsaved()[0]!.fields);
    expect(lookFor(src, {}, 80).values.bg).toBe("blue");
    delete sheets[1]!.fields.bg;
    expect(lookFor(src, {}, 80).values.bg).toBe("blue");
    expect(t.get("global", "bg")).toBeUndefined();
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
  async function door(cols: number, board0: SocketBoard = board, show?: { id: string; drawn: string }) {
    const board = board0;
    const writes: string[] = [];
    let key: (k: Key) => void = () => {};
    const term = { info: { cols, rows: 46, cellW: 9, cellH: 16, kitty: false }, write(s: string) { writes.push(s); }, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term as any, board, Date.now(), () => {});
    const sub = board.subscribe(e => app.event(e));
    const desk = openScreen("detail", { note: show?.id ?? note.id, persist: false }) as Desk;
    app.push(new MainMenu()); app.push(desk);
    const lines = () => desk.render((desk as any).ctx).lines.map(plain);
    await until(() => (show ? lines().some(l => l.includes(show.drawn)) : lines().some(l => l.includes("Oil the shed")) && lines().some(l => /· · ·/.test(l))), `the note drawn with its look at ${cols}`, 10_000);
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

  test("PIE-675: x and a row's × take one value back to the level under it (by key, by click, through act), and a save removes it from its note; a tile's border, surface and header surface draw from the look", async () => {
    const d = await door(140);
    try {
      expect(await d.app.act({ action: "tile.tune", tile: "detail", as: "look-agent" })).toMatchObject({ tunes: "detail" });
      const tune = () => [...(d.desk as any).panes.values()].find((p: any) => p.kind === "tune");
      const value = (t: string) => tune().describe(d.desk).values[t];
      await until(() => d.lines().some(l => /measure +56 +← screen detail/.test(l)), "the inspector", 5000);
      const textX = () => d.where("Sow the broad").x;
      const before = textX();
      // A click on the measure row's ×: the screen's 56 is taken away, the detail tile's own 88 shows, drawn at once.
      const y = d.lines().findIndex(l => /measure +56 +← screen detail/.test(l)), x = d.lines()[y]!.indexOf("× [−]");
      d.mouse("down", x, y); d.mouse("up", x, y);
      await until(() => value("measure")?.value === "88", "the measure back to the tile's own", 5000);
      expect(value("measure")).toMatchObject({ from: "built-in detail" });
      expect(textX()).toBeLessThan(before);
      expect(tuningOf(board).unsavedCount()).toBe(1);
      // u puts it back (the person's keys: 2 is the inspector); x on the picked row takes it away again.
      d.key({ kind: "char", ch: "2" });
      await until(() => (d.desk as any).focusName?.() === "tune" || tune() === (d.desk as any).panes.get((d.desk as any).focus), "the inspector focused", 5000);
      d.key({ kind: "char", ch: "u" });
      await until(() => value("measure")?.value === "56", "taken back", 5000);
      // (An agent can't act in the inspector while it has the person's keys: 1 gives them back to the reader.)
      d.key({ kind: "char", ch: "x" });
      await until(() => value("measure")?.value === "88", "x took it away", 5000);
      d.key({ kind: "char", ch: "1" });
      // Saved: the property is gone from the screen's style note, attributed; the outline's answer settles the tuning.
      expect(await d.app.act({ action: "tune.save", tile: "tune", as: "look-agent" })).toMatchObject({ saved: true, at: "screen detail", fields: "style.measure removed" });
      expect((await board.get(style.id))!.text).not.toContain("[style.measure::");
      await until(() => tuningOf(board).unsavedCount() === 0, "nothing unsaved", 5000);
      // A value a shorthand gives (the screen's [style.pad::1]) can't be taken away alone: the note is edited.
      await expect(d.app.act({ action: "tune.unset", args: { row: "pad.x" }, tile: "tune", as: "look-agent" })).rejects.toThrow(/also set by style\.pad|shorthand/);
      // A built-in can't be taken further back.
      await expect(d.app.act({ action: "tune.unset", args: { row: "measure" }, tile: "tune", as: "look-agent" })).rejects.toThrow(/built-in already/);
      // Frames, surfaces and the header's surface, set globally in memory: the inspector's frame at rest, the reader's surfaces.
      for (const [row, v] of [["border", "round"], ["bg", "raised"], ["header.bg", "blue"], ["header.bg.opacity", "60"], ["edge", "box"], ["tone", "amber"]] as const)
        expect(await d.app.act({ action: "tune.set", args: { row, value: v, level: "global" }, tile: "tune", as: "look-agent" })).toMatchObject({ value: v, at: "global" });
      await until(() => d.lines().some(l => /╭─.*tune/.test(l)), "the inspector's frame round, at rest", 5000);
      const raw = () => d.desk.render((d.desk as any).ctx).lines;
      const titleRow = d.lines().findIndex(l => l.includes("Bean row"));
      expect(raw()[titleRow]).toContain(bgRgb(surfaceMix("blue", 0.6)!));
      const bodyRow = d.where("Net the brassicas").y;
      expect(raw()[bodyRow]).toContain(surfaceBg("raised", 2));
      // The inspector's frame in the tone (edge=box, amber) at rest.
      expect(raw().find(l => plain(l).includes("╭─") && plain(l).includes("tune"))).toContain(fg(14));
      // Six steps back, the agent's own: nothing was written, nothing is left.
      for (let i = 0; i < 6; i++) await d.app.act({ action: "tune.undo", tile: "tune", as: "look-agent" });
      await until(() => tuningOf(board).unsavedCount() === 0 && !d.lines().some(l => l.includes("╭─")), "the nudges taken back", 5000);
    } finally { d.close(); }
  }, 40_000);

  test("PIE-675: a level picked shows its own values; a row something nearer wins is marked, and a nudge there asks (anyway, instead, clear); the width trap: narrow, then all widths", async () => {
    // A connection of its own: its own session of the inspector.
    const b2 = new SocketBoard(scratch.sock);
    await b2.info();
    const d = await door(120, b2);
    try {
      expect(await d.app.act({ action: "tile.tune", tile: "detail", as: "look-agent" })).toMatchObject({ tunes: "detail" });
      const tune = () => [...(d.desk as any).panes.values()].find((p: any) => p.kind === "tune");
      // Read as drawn: a frame first (the inspector reads the look the tile was last drawn with).
      const v = (tk: string) => { d.lines(); return tune().describe(d.desk).values[tk]; };
      await until(() => !!tune()?.describe(d.desk).values, "the inspector", 5000);
      d.lines();
      expect(tune().describe(d.desk).breakpoint).toBe("narrow");
      const act = (action: string, args: Record<string, unknown> = {}) => d.app.act({ action, args, tile: "tune", as: "look-agent" }) as Promise<any>;
      // The page picked: each row says what the page sets itself (nothing yet), beside the value in force.
      await act("tune.level", { level: "page" });
      expect(v("pad.x")).toMatchObject({ value: "2", from: "screen detail", at: { level: "this page", value: null } });
      await until(() => d.lines().some(l => /in force +page +from/.test(l)) && d.lines().some(l => /pad\.x +2 +— +← scree/.test(l)), "the page's column:\n" + d.lines().join("\n"), 5000);
      // Global picked: the screen's style wins over it, so the row is marked, and an agent's nudge there says why and what it can do.
      await act("tune.level", { level: "global" });
      expect(v("pad.x").overridden).toBe("screen detail overrides");
      await until(() => d.lines().some(l => /pad\.x .*⊘/.test(l)), "the shadowed row marked", 5000);
      await expect(act("tune.nudge", { row: "pad.x", by: 1 })).rejects.toThrow(/screen detail overrides: shadow=anyway .*shadow=instead .*shadow=clear/);
      // Anyway: written to global, shown only where nothing nearer sets it (so pad.x stays the screen's 2 here).
      expect(await act("tune.nudge", { row: "pad.x", by: 1, shadow: "anyway" })).toMatchObject({ at: "global", shadow: "anyway" });
      expect(v("pad.x")).toMatchObject({ value: "2", at: { level: "global", value: "4" } });
      expect(await act("tune.undo")).toMatchObject({ undone: "pad.x" });
      // The width trap: at a narrow tile, the page's narrow width, then all widths.
      await act("tune.level", { level: "page" });
      await act("tune.width", { scope: "this" });
      expect(await act("tune.nudge", { row: "pad.x", by: 1 })).toMatchObject({ at: "this page, narrow only" });
      expect(v("pad.x")).toMatchObject({ value: "4", from: "page · narrow" });
      await act("tune.width", { scope: "all" });
      expect(v("pad.x").overridden).toBe("narrow overrides at this width");
      await expect(act("tune.nudge", { row: "pad.x", by: 1 })).rejects.toThrow(/narrow overrides at this width: .*shadow=instead \(nudge narrow instead\).*shadow=clear \(clear narrow so every width shows it\)/);
      // The person: + on that row holds the nudge and offers the choice in place; c clears the variant and nudges every width.
      d.key({ kind: "tab" });
      await until(() => (d.desk as any).panes.get((d.desk as any).focus) === tune(), "the inspector has the keys", 3000);
      while (tune().sel !== 2) { const was = tune().sel; d.key({ kind: was < 2 ? "down" : "up" }); await until(() => tune().sel !== was, "the pick moved", 3000); }
      expect(tune().describe(d.desk).selected).toBe("pad.x");
      d.key({ kind: "char", ch: "+" });
      await until(() => tune().describe(d.desk).offer?.why === "narrow overrides at this width", "the offer", 5000);
      expect(tune().describe(d.desk).offer.choices).toEqual(["anyway", "instead", "clear"]);
      expect(d.lines().some(l => l.includes("[a nudge page anyway]"))).toBe(true);
      d.key({ kind: "char", ch: "c" });
      await until(() => v("pad.x").from === "page", "the variant cleared, every width's value in force", 5000);
      expect(v("pad.x")).toMatchObject({ value: "4", at: { level: "this page", value: "4" } });
      expect(v("pad.x").overridden).toBeUndefined();
      // Reset value clears a variant first, then the plain value: narrow again, then x twice.
      d.key({ kind: "char", ch: "w" });
      d.key({ kind: "char", ch: "+" });
      await until(() => v("pad.x").from === "page · narrow", "the narrow nudge", 5000);
      d.key({ kind: "char", ch: "x" });
      await until(() => v("pad.x").from === "page", "the variant reset first", 5000);
      d.key({ kind: "char", ch: "x" });
      await until(() => v("pad.x").from === "screen detail", "then the plain value: the screen's shows", 5000);
      // Reset level asks in place, in the person's inspector: X shows [confirm]; any other key keeps them.
      d.key({ kind: "char", ch: "+" });
      await until(() => tuningOf(b2).unsavedCount() > 0, "a nudge on the page", 5000);
      d.key({ kind: "char", ch: "X" });
      await until(() => d.lines().some(l => l.includes("[confirm]")), "asked in place", 5000);
      expect(tune().describe(d.desk).armed).toMatchObject({ action: "tune.resetlevel" });
      d.key({ kind: "char", ch: "j" });
      await until(() => !tune().describe(d.desk).armed, "kept", 5000);
      d.key({ kind: "tab" });
    } finally { d.close(); b2.close(); }
  }, 40_000);

  test("PIE-675: back to as if nothing was done: undo and redo through nudges and saves, reset value, reset level (asked in place), revert all after a save, refused on a note changed since", async () => {
    const b3 = new SocketBoard(scratch.sock);
    await b3.info();
    const page = await create(null, "Pea trellis [style.measure::60]\n- Net\n- Twine");
    const level = await create(null, "Trellis look [style-for::screen:detail] [style.list.gap::2] [style.list.divider::line]");
    const d = await door(140, b3, { id: page.id, drawn: "Twine" });
    try {
      expect(await d.app.act({ action: "tile.tune", tile: "detail", as: "look-agent" })).toMatchObject({ tunes: "detail" });
      const tune = () => [...(d.desk as any).panes.values()].find((p: any) => p.kind === "tune");
      const v = (tk: string) => { d.lines(); return tune().describe(d.desk).values[tk]; };
      const act = (action: string, args: Record<string, unknown> = {}) => d.app.act({ action, args, tile: "tune", as: "look-agent" }) as Promise<any>;
      const text = async (id: string) => (await b3.get(id))!.text;
      await until(() => !!tune()?.describe(d.desk).values, "the inspector", 5000);
      const target = page.id;
      await act("tune.level", { level: "page" });
      // Three nudges, two undone, one redone: each said, in order.
      const m0 = Number(v("measure").value);
      for (let i = 0; i < 3; i++) await act("tune.nudge", { row: "measure", by: 1 });
      expect(v("measure").value).toBe(String(m0 + 12));
      expect((await act("tune.undo")).words).toBe(`measure ${m0 + 12} → ${m0 + 8} at this page`);
      expect((await act("tune.undo")).words).toBe(`measure ${m0 + 8} → ${m0 + 4} at this page`);
      expect((await act("tune.redo")).words).toBe(`measure ${m0 + 4} → ${m0 + 8} at this page`);
      expect(v("measure").value).toBe(String(m0 + 8));
      // Saved, then the save taken back: the note as it was, the nudge unsaved again; redone, written again.
      expect(await act("tune.save")).toMatchObject({ saved: true });
      expect(await text(target)).toContain(`[style.measure::${m0 + 8}]`);
      expect((await act("tune.undo")).words).toContain("save of style.measure");
      expect(await text(target)).not.toContain(`[style.measure::${m0 + 8}]`);
      expect(tuningOf(b3).unsavedCount()).toBe(1);
      await act("tune.redo");
      expect(await text(target)).toContain(`[style.measure::${m0 + 8}]`);
      // Two saves to one note, both taken back and done again: each step names the revision the session left it at.
      await act("tune.nudge", { row: "list.gap", by: 1 }); await act("tune.save");
      await act("tune.nudge", { row: "list.gap", by: -1 }); await act("tune.save");
      const gap2 = (await text(target)).match(/\[style\.list\.gap::(\d)\]/)![1];
      const back4 = async () => { const said: string[] = []; for (let i = 0; i < 4; i++) said.push((await act("tune.undo")).words); return said; };
      expect(await back4()).toEqual([expect.stringContaining("save of style.list.gap"), expect.stringContaining("list.gap"), expect.stringContaining("save of style.list.gap"), expect.stringContaining("list.gap")]);
      expect(await text(target)).not.toContain("[style.list.gap::");
      for (let i = 0; i < 4; i++) await act("tune.redo");
      expect(await text(target)).toContain(`[style.list.gap::${gap2}]`);
      await back4();
      expect(await text(target)).not.toContain("[style.list.gap::");
      // Reset value: the page's own measure taken away, then saved off the note.
      expect(await act("tune.unset", { row: "measure" })).toMatchObject({ row: "measure" });
      await act("tune.save");
      expect(await text(target)).not.toContain("[style.measure::");
      // Reset level, asked in place: the screen's style notes lose every value they set here; undone, back.
      await act("tune.level", { level: "screen" });
      // An agent is told to confirm; the person's inspector isn't armed by it.
      expect(await act("tune.resetlevel")).toMatchObject({ armed: true, confirm: expect.stringContaining("confirm=true"), words: expect.stringMatching(/^reset screen detail: \d+ values off \d+ style notes?/) });
      expect(tune().describe(d.desk).armed).toBeUndefined();
      expect(await text(level.id)).toContain("[style.list.gap::2]");
      expect(await act("tune.resetlevel", { confirm: true })).toMatchObject({ reset: "screen detail" });
      expect(await text(level.id)).not.toMatch(/\[style\./);
      expect((await act("tune.undo")).words).toBe("reset of screen detail");
      expect(await text(level.id)).toContain("[style.list.gap::2]");
      // Revert all, after a save: every note this session wrote as it was when it started.
      await act("tune.level", { level: "page" });
      await act("tune.nudge", { row: "list.gap", by: 1 });
      await act("tune.save");
      expect(await text(target)).toContain("[style.list.gap::");
      expect(await act("tune.revert")).toMatchObject({ armed: true });
      expect(await act("tune.revert", { confirm: true })).toMatchObject({ reverted: true });
      expect(await text(target)).not.toContain("[style.list.gap::");
      expect(await text(target)).toContain("[style.measure::60]");
      expect(await text(level.id)).toContain("[style.list.gap::2]");
      // Taken back too, as one step.
      expect((await act("tune.undo")).words).toBe("revert of the session");
      expect(await text(target)).toContain("[style.list.gap::");
      // A note changed since by someone else: revert refuses, naming it, and writes nothing.
      const m = (await b3.get(level.id))!;
      await b3.update(level.id, m.text + " (edited elsewhere)", m.revision!);
      await expect(act("tune.revert", { confirm: true })).rejects.toThrow(new RegExp(`note ${level.id.slice(0, 8)} changed since you started`));
      expect(await text(target)).toContain("[style.list.gap::");
    } finally { d.close(); b3.close(); }
  }, 60_000);

  test("PIE-675: this tile: one links tile airy while another stays tight, saved in its tile spec and back with the layout; this list: one list airy while its sibling stays tight, saved on its heading", async () => {
    const b4 = new SocketBoard(scratch.sock);
    await b4.info();
    const garden = await create(null, "Garden lists\n## Climbers\n- runner beans\n- sweet peas\n\n## Ground\n- clover\n- thyme");
    const d = await door(160, b4, { id: garden.id, drawn: "thyme" });
    try {
      const desk = d.desk as any, act = (action: string, args: Record<string, unknown> = {}, tile = "tune") => d.app.act({ action, args, tile, as: "look-agent" }) as Promise<any>;
      // Two links tiles on the reader.
      await desk.openTile({ kind: "backlinks", source: "tile:detail" }, "detail", "right", { kind: "agent", id: "look-agent" });
      await desk.openTile({ kind: "backlinks", source: "tile:detail" }, "detail", "down", { kind: "agent", id: "look-agent" });
      d.lines();
      const links = () => [...desk.panes.entries()].filter(([, p]: any) => p.kind === "backlinks").map(([id, p]: any) => ({ id, p, name: desk.nameOf(id) }));
      expect(links()).toHaveLength(2);
      const [a, b] = links();
      expect(await act("tile.tune", {}, a!.name)).toBeTruthy();
      await act("tune.aim", { tile: a!.name });
      await act("tune.set", { row: "list.gap", value: "2", level: "instance" });
      d.lines();
      const gapOf = (x: { p: unknown }) => desk.lookOf(x.p).values["list.gap"];
      expect(gapOf(a!)).toBe(2);
      expect(desk.lookOf(a!.p).sources["list.gap"]).toMatchObject({ level: "instance", label: "this tile" });
      expect(gapOf(b!)).not.toBe(2);
      // Saved: into that tile's spec, nothing written to the outline; the layout keeps it, and it comes back.
      expect(await act("tune.save", { level: "instance" })).toMatchObject({ saved: true, at: "this tile" });
      expect(a!.p.instanceLook).toEqual({ "list.gap": "2" });
      const saved = desk.layoutSpec();
      expect(JSON.stringify(saved)).toContain('"look":{"list.gap":"2"}');
      desk.build(saved, false);
      d.lines();
      const again = links();
      expect(again.map(x => gapOf(x)).sort()).toEqual([gapOf(again.find(x => !x.p.instanceLook)!), 2].sort());
      expect(again.filter(x => x.p.instanceLook?.["list.gap"] === "2")).toHaveLength(1);
      // This list: the reader's [ ] on the Ground list; the inspector offers this list and saves onto its heading.
      const reader = () => [...desk.panes.values()].find((p: any) => p.surface && p.kind !== "backlinks") as any;
      await act("tune.aim", { tile: "detail" }).catch(() => {});
      desk.run("tile.focus", {}, "detail");
      d.lines();
      for (let i = 0; i < 40 && reader().surface.listAt()?.first !== 6; i++) { d.key({ kind: "char", ch: "]" }); await Bun.sleep(5); d.lines(); }
      expect(reader().surface.listAt()).toMatchObject({ target: `list:${garden.id}:5`, first: 6 });
      const gap = (x: string, y: string) => d.where(y).y - d.where(x).y;
      const climbers = gap("runner beans", "sweet peas"), ground = gap("clover", "thyme");
      expect(await act("tune.set", { row: "list.gap", value: "2", level: "list" })).toMatchObject({ at: "this list" });
      d.lines();
      expect(gap("clover", "thyme")).toBeGreaterThan(ground);
      expect(gap("runner beans", "sweet peas")).toBe(climbers);
      expect(await act("tune.save", { level: "list" })).toMatchObject({ saved: true });
      expect((await b4.get(garden.id))!.text.split("\n")[5]).toBe("## Ground [style.list.gap::2]");
      // Undone: the heading as it was.
      expect((await act("tune.undo")).words).toContain("save of style.list.gap");
      expect((await b4.get(garden.id))!.text.split("\n")[5]).toBe("## Ground");
    } finally { d.close(); b4.close(); }
  }, 60_000);

  test("ep0ch export leaves the look out: the note's source, whatever the style notes say", async () => {
    const { byId } = await readRecords(board, [note.id], false);
    const [file] = exportFiles([byId.get(note.id)!], byId, { format: "md", children: false, split: false, resolveLinks: false });
    expect(file!.content).toContain(`${PARA}\n\n${ITEMS.join("\n")}`);
    expect(file!.content).not.toMatch(/· ·|^ {2,}Sow/m);
  });
});

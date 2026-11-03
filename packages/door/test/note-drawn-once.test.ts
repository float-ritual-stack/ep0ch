// PIE-1543: a note draws once for the reader and the river. The reader and a river column on the same note draw the
// same banners and press the same targets: the header's [comment], [sources], comment count, crumbs and a whole-note
// [+] work by click in a column as in a reader, and the column's Y copies the note's source. Fictional notes; scratch
// services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import type { RiverColumn } from "../src/river/column";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { agentWords } from "../src/surface/actions";
import { outliner, Scratch, until } from "./scratch";
import { view } from "./river-view";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe.skipIf(!outliner)("a river column draws and presses its note as a reader does", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, river: Desk;
  const notes: Record<string, any> = {};
  const AGENT = "mender/claude-code@shed";
  const V = () => view(river);
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.act({ action, args, tile, as: "drawn-once-test" });
  let col!: RiverColumn, name = "";
  const S = () => col.surface as any;
  /** The column's rows at `w` columns, as drawn. */
  const rows = (w: number) => col.render(w, 30, true, river).lines.map(plain);
  /** Press and release at the first cell of `text` in the column's rows. */
  const click = (w: number, text: string, nth = 0) => {
    const lines = rows(w);
    let seen = 0;
    for (let y = 0; y < lines.length; y++) {
      let x = lines[y]!.indexOf(text);
      while (x >= 0) {
        if (seen++ === nth) {
          col.mouse({ kind: "mouse", action: "down", button: 0, x: x + 1, y }, x + 1, y, river);
          col.mouse({ kind: "mouse", action: "up", button: 0, x: x + 1, y }, x + 1, y, river);
          return { x: x + 1, y };
        }
        x = lines[y]!.indexOf(text, x + 1);
      }
    }
    throw new Error(`no "${text}" in the column:\n${lines.join("\n")}`);
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    notes.plot = await create(null, "Allotment plot 9\nThe beds by the gate.");
    notes.queued = await create(notes.plot.id, "Queued beds [type::virtual-branch] [query::stage=queued]");
    notes.tips = await create(notes.plot.id, "Watering\nAt dusk.\n\n> [!tip] Water\n> Twice a week in June.\n\nSow these:\n```\nleeks\nchard\n```");
    notes.long = await create(notes.plot.id, "Long beds\n" + Array.from({ length: 80 }, (_, i) => `Bed ${i + 1}: rows of onions.`).join("\n"));
    await board.request("annotations.batch", { requestId: "drawn-once-long", operations: [{ operationId: "one", type: "block-comment", input: { blockId: notes.long.id, expectedRevision: notes.long.revision, body: "Too many beds?", source: "user" } }] });
    notes.beans = await create(notes.plot.id, "Stake the beans\nCanes along the fence, as ((" + notes.plot.id + ")) says.\n\n```\ntwine: 4 m\n```\n\nTie them loosely.");
    // A note on the whole of it, so the byline counts it and a [+] follows the title.
    await board.request("annotations.batch", { requestId: "drawn-once-whole", operations: [{ operationId: "one", type: "block-comment", input: { blockId: notes.beans.id, expectedRevision: notes.beans.revision, body: "Bamboo or hazel?", source: "user" } }] });
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    river = openScreen("river") as Desk;
    app.push(new MainMenu()); app.push(river);
    await until(() => !!V().column(1)?.items?.length, "the Library", 10_000);
    const o: any = await act("open", { id: notes.beans.id });
    name = o.name;
    col = V().tiles.find(c => V().name(c) === name)!;
    await until(() => !!col.root && rows(80).some(l => l.includes("[comment]")), "the column's header", 10_000);
  }, 30_000);

  afterAll(async () => {
    app?.quit(); board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("an agent's line under the note says the agent in the reader's words", async () => {
    S().agent = { id: AGENT, did: "saved this note", at: Date.now() };
    const text = rows(80).join("\n");
    expect(text).toContain(`an agent (${agentWords(AGENT)}) saved this note`);
    S().agent = null;
  });

  test("[comment] in the column's byline starts a comment on the whole note", async () => {
    for (const w of [80, 160]) {
      await Bun.sleep(500);                                    // two clicks, not a double click
      click(w, "[comment]");
      await until(() => S().session?.mode === "compose", `the comment at ${w} columns`);
      expect(S().session.target).toMatchObject({ kind: "note" });
      await river.dispatch.act({ action: "comment.close", args: {}, tile: name }, USER);
      await until(() => !S().session, "closed");
    }
  });

  test("the byline's comment count cycles the margin, as M does", async () => {
    const was = S().marginMode;
    click(80, "comment ·");
    await until(() => S().marginMode !== was, "the next margin mode");
    while (S().marginMode !== was) await act("margin", {}, name);
  });

  test("a whole-note [+] after the title selects its thread, which the column lists as a reply", async () => {
    // Marks only: the whole-note thread is a [+] after the title.
    for (let i = 0; i < 4 && !rows(80).some(l => l.includes("[+]")); i++) await act("margin", {}, name);
    const id = S().comments[0].id;
    click(80, "[+]");
    await until(() => (col as any).flat()[(col as any).sel]?.m.id === id, "the thread's card selected");
  });

  test("a crumb in the column's header shows that ancestor's links, as in a reader, at 44 and 160 columns", async () => {
    const asked: string[] = [], runKey = S().runKey.bind(S());
    S().runKey = (a: string, args: any, h: SurfaceHost) => { asked.push(a); return runKey(a, args, h); };
    try {
      for (const w of [44, 160]) {
        asked.length = 0;
        await Bun.sleep(500);                                  // two clicks, not a double click
        click(w, "Allotment plot 9");
        expect(asked).toEqual(["button.press"]);
      }
    } finally { S().runKey = runKey; }
    // What the crumb presses is the reader's action, a river column's too (never refused for its kind).
    await expect(river.dispatch.act({ action: "reader.crumb", args: { id: notes.plot.id }, tile: name }, USER)).resolves.toBeDefined();
  });

  test("← back under the title goes back along the river's trail, as the reader's does", async () => {
    await Bun.sleep(500);
    const before = V().focus;
    click(80, "← back");
    await until(() => V().focus !== before, "back along the trail");
    await act("open", { id: notes.beans.id });
    col = V().tiles.find(c => V().name(c) === name) ?? V().byNote(notes.beans.id)!;
    name = V().name(col);
    await until(() => rows(80).some(l => l.includes("[comment]")), "the beans column again");
  });

  test("[sources] in a column's byline opens the Sources inspector there, drawn in the column", async () => {
    const o: any = await act("open", { id: notes.queued.id });
    const q = V().tiles.find(c => V().name(c) === o.name)!, was = col;
    col = q;
    try {
      await until(() => rows(80).some(l => l.includes("[sources]")), "the view note's [sources]");
      await Bun.sleep(500);
      click(80, "[sources]");
      await until(() => !!(q.surface as any).sourcesMode, "the Sources inspector");
      await until(() => rows(80).join("\n").includes("Collection"), "the inspector drawn in the column");
    } finally { col = was; }
  });

  /** Open `id` in a column and make it the one `click` and `rows` use, for `f`; then back to the beans column. */
  const inColumn = async (id: string, f: () => Promise<void>) => {
    const o: any = await act("open", { id });
    const was = col;
    col = V().tiles.find(c => V().name(c) === o.name)!;
    try { await until(() => !!col.root && rows(80).length > 3, "the note's column"); await f(); } finally { col = was; }
  };
  /** Drag across `n` cells from the first cell of `text`, then column.copy source=true. */
  const dragCopy = async (text: string, n: number) => {
    const at = click(80, text);
    at.x -= 1;
    col.mouse({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y }, at.x, at.y, river);
    col.mouse({ kind: "mouse", action: "drag", button: 0, x: at.x + n, y: at.y }, at.x + n, at.y, river);
    col.mouse({ kind: "mouse", action: "up", button: 0, x: at.x + n, y: at.y }, at.x + n, at.y, river);
    return act("column.copy", { source: true }, V().name(col));
  };

  test("a callout's ⧉ in a column copies it, as the reader's does, never folds it", async () => {
    await inColumn(notes.tips.id, async () => {
      const asked: string[] = [], s = col.surface as any, runKey = s.runKey.bind(s);
      s.runKey = (a: string, args: any, h: SurfaceHost) => { asked.push(a); return runKey(a, args, h); };
      try {
        await Bun.sleep(500);
        const lines = rows(80), y = lines.findIndex(l => l.includes("Water") && l.includes("⧉"));
        expect(y).toBeGreaterThanOrEqual(0);
        const x = [...lines[y]!].indexOf("⧉");
        col.mouse({ kind: "mouse", action: "down", button: 0, x, y }, x, y, river);
        col.mouse({ kind: "mouse", action: "up", button: 0, x, y }, x, y, river);
        expect(asked).toEqual(["block.copy"]);
      } finally { s.runKey = runKey; }
    });
  });

  test("Y on a note's last code block copies its contents, not only its opening fence", async () => {
    await inColumn(notes.tips.id, async () => {
      expect(await dragCopy("leeks", 5)).toMatchObject({ text: "leeks" });
    });
  });

  test("a whole-note [+] on a long note brings its thread's card into view, even when it was already selected", async () => {
    await inColumn(notes.long.id, async () => {
      await until(() => rows(80).some(l => l.includes("1 comment")), "the comment counted");
      for (let i = 0; i < 4 && !rows(80).some(l => l.includes("[+]")); i++) await act("margin", {}, V().name(col));
      const c = col as any;
      await until(() => c.flat().some((r: any) => r.m.text.includes("Too many beds")), "the comment among the replies");
      const n = c.flat().findIndex((r: any) => r.m.text.includes("Too many beds"));
      expect(c.sel).toBe(n);                                   // already the selected card
      const seen = () => rows(80).some(l => l.includes("Too many beds?"));
      expect(seen()).toBe(false);                              // under eighty beds
      await Bun.sleep(500);
      click(80, "[+]");
      await until(seen, "the thread's card in view");
    });
  });

  test("Y with text selected in a column copies the note's source, as a reader's does", async () => {
    // Select the code block's row by drag, then Y: its fence lines as written.
    const at = click(80, "twine: 4 m");
    at.x -= 1;
    col.mouse({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y }, at.x, at.y, river);
    col.mouse({ kind: "mouse", action: "drag", button: 0, x: at.x + 9, y: at.y }, at.x + 9, at.y, river);
    col.mouse({ kind: "mouse", action: "up", button: 0, x: at.x + 9, y: at.y }, at.x + 9, at.y, river);
    expect(await act("column.copy", { source: true }, name)).toMatchObject({ text: "twine: 4 m" });
    // Words drawn differently from their markup (a reference by its title) copy the line they're drawn from.
    const link = click(80, "Allotment plot 9", 1);
    link.x -= 1;
    col.mouse({ kind: "mouse", action: "down", button: 0, x: link.x, y: link.y }, link.x, link.y, river);
    col.mouse({ kind: "mouse", action: "drag", button: 0, x: link.x + 8, y: link.y }, link.x + 8, link.y, river);
    col.mouse({ kind: "mouse", action: "up", button: 0, x: link.x + 8, y: link.y }, link.x + 8, link.y, river);
    expect(await act("column.copy", { source: true }, name)).toMatchObject({ text: `Canes along the fence, as ((${notes.plot.id})) says.` });
  });
});

describe("the one drawing: the reader and the digest index the same header targets", () => {
  const note = { id: "41111111-2222-4333-8444-555555555555", text: "Sow the leeks\nIn the cold frame.\n\n```\nrows: 3\n```", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, properties: [] };
  const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, graphics: false } as any, redraw() {}, navigate() {} });

  test("a reader's render and a digest press the same kinds of targets on the note", () => {
    for (const w of [44, 160]) {
      const reader = new NoteSurface(), h = host();
      reader.show(note as any, h);
      reader.render(w, 30, h);
      const kinds = (hits: any[]) => [...new Set(hits.map(x => Object.keys(x).filter(k => !["row", "from", "to", "elem", "value"].includes(k))[0]))].sort();
      const readerKinds = kinds((reader as any).hits);
      const river = new NoteSurface(), hr = host();
      river.show(note as any, hr);
      const drawn = river.digest(note as any, w, hr);
      const digestKinds = kinds([...drawn.header.targets, ...drawn.targets]);
      // The same header rows, as the reader draws them above its body.
      const head = drawn.header.lines.map(plain);
      expect(reader.render(w, 30, h).lines.slice(0, head.length).map(plain).map(l => l.trimEnd())).toEqual(head.map(l => l.trimEnd()));
      expect(digestKinds).toEqual(readerKinds.filter(k => k !== "history"));
      // The copy control is in the digest's rows, where its target is.
      const copy = drawn.targets.find((t: any) => "block" in t)!;
      expect(plain(drawn.lines[copy.row]!)).toContain("⧉");
    }
  });
});

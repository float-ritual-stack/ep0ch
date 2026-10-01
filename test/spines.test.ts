// PIE-440: one spine part for river columns, board lanes and board readers. On the board, c collapses
// the preview or a detail to a spine showing its note's title (C comments now), c ⏎ or a click opens it,
// alt+c opens everything collapsed, and agents do the same through reader.collapse / reader.expand. A
// collapsed reader keeps its draft, comment or property panel exactly. Scratch services and fictional
// notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { Canvas } from "../src/canvas";
import { Desk } from "../src/desk/desk";
import { BOARD_ACTIONS, DeliveryBoard } from "../src/desk/delivery";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { drawSpine, spineImage } from "../src/spine";
import { C, fg, RESET } from "../src/style";
import { Term, type Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const note = (title: string, stage: string) => `${title} [stage::${stage}]\n${Array.from({ length: 30 }, (_, i) => `${title} line ${i + 1}: the rake leans on the shed.`).join("\n")}`;

describe("the spine part", () => {
  const v = (graphics: boolean) => ({ graphics, t: { cellW: 9, cellH: 16 } });

  // The river's spine before PIE-440, kept here to hold the shared part to it exactly.
  const riverBefore = (canvas: Canvas, r: { col: number; row: number; cols: number; rows: number }, title: string, colour: number, mark: string, uid: number, graphics: boolean) => {
    const out: any[] = [];
    for (let y = r.row; y < r.row + r.rows; y++) canvas.text(r.col + r.cols - 1, y, fg(C.blue) + "│" + RESET, 1);
    canvas.text(r.col, r.row, mark, 1);
    const t = { cellW: 9, cellH: 16 };
    if (graphics) {
      const maxChars = Math.max(1, Math.floor(((r.rows - 2) * t.cellH * 16) / (2 * t.cellW * 9)));
      const text = title.length > maxChars ? title.slice(0, maxChars - 1) + "…" : title;
      const img = spineImage(text, colour);
      const rowsNeeded = Math.max(1, Math.ceil((img.height * (2 * t.cellW / img.width)) / t.cellH));
      out.push({ key: `spine:${uid}`, image: img, col: r.col, row: r.row + 1, cols: 2, rows: Math.min(rowsNeeded, r.rows - 1), z: -1 });
    } else [...title].slice(0, r.rows - 1).forEach((ch, i) => canvas.text(r.col, r.row + 1 + i, fg(colour) + ch + RESET, 1));
    return out;
  };

  test("draws a river spine exactly as the river did: border, mark, rotated title under Kitty, stacked letters in cells", () => {
    for (const graphics of [true, false]) for (const [title, rows] of [["Sow the peas", 20], ["A very long column title that will not fit down here", 8], ["x", 3]] as const) {
      const r = { col: 4, row: 1, cols: 3, rows };
      const a = new Canvas(12, 24), b = new Canvas(12, 24);
      const mark = fg(C.yellow) + "✎" + RESET;
      const want = riverBefore(a, r, title, C.lcyan, mark, 7, graphics);
      const got = drawSpine(b, r, { key: "spine:7", title, colour: C.lcyan, marks: [mark] }, v(graphics));
      expect(b.lines()).toEqual(a.lines());
      expect(got ? [got] : []).toEqual(want);
    }
  });

  test("the title under Kitty is VGA text turned a quarter clockwise: 16px wide, 9px per character down", () => {
    const p = drawSpine(new Canvas(6, 30), { col: 0, row: 0, cols: 3, rows: 30 }, { key: "k", title: "Queued 4", colour: C.white }, v(true))!;
    expect([p.image as any].map(i => [i.width, i.height])).toEqual([[16, 9 * 8]]);
    expect([p.col, p.row, p.cols, p.z]).toEqual([0, 0, 2, -1]);
  });
});

describe("alt+c", () => {
  test("ESC and a letter in one read is alt+letter, its own key; ESC before [ O P _ ] keeps its meaning", () => {
    const t = new Term(), keys: Key[] = [];
    t.onKey(k => keys.push(k));
    (t as any).feed("\x1bc");
    (t as any).feed("\x1b[A");
    expect(keys).toEqual([{ kind: "alt", ch: "c" }, { kind: "up" }]);
  });
});

test("the board's collapse and expand are actions with keys", () => {
  const names = BOARD_ACTIONS.list().map(a => a.name);
  expect(names).toContain("reader.collapse");
  expect(names).toContain("reader.expand");
});

describe.skipIf(!outliner)("board readers collapse to spines, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: DeliveryBoard, hub: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const AS = "spine-agent-440";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const message = () => (app as any).message as string;
  const frame = () => b.render(B().ctx).lines.map(plain);
  const hints = () => frame().at(-1)!;
  const rect = (region: string) => { b.render(B().ctx); return BV.rectOf(b, region); };
  /** A pane's fold, as the desk keeps it (its tile id). */
  const folded = (p: any) => B().collapsed.get(B().idOf(p));
  const foldedLanes = () => B().laneIds().filter((id: number) => B().collapsed.has(id)).length;
  const foldedReaders = () => [...B().collapsed.keys()].filter((id: number) => !B().isLane(id)).length;
  /** A folded reader's spine: its tile, drawn three columns wide. */
  const spine = (region: string): any => { b.render(B().ctx); const r = BV.rectOf(b, region); return r && r.cols === 3 ? r : undefined; };
  const click = (r: { col: number; row: number; cols: number; rows: number }) => {
    const at = { x: r.col, y: r.row + Math.floor(r.rows / 2) };
    key({ kind: "mouse", action: "down", button: 0, ...at }); key({ kind: "mouse", action: "up", button: 0, ...at });
  };
  const whole = (p: ReaderPane, id?: string) => until(() => !!p.msg && !p.msg.partial && (!id || p.msg.id === id), "the whole note");
  const state = () => JSON.parse(readFileSync(join(scratch.root, "door", "delivery.json"), "utf8"));
  /** The names of the tiles saved folded in the board's layout. */
  const savedFolds = (): string[] => { const out: string[] = []; const walk = (n: any) => { if (!n || typeof n !== "object") return; if (n.t === "leaf") { if (n.collapsed) out.push(n.name); return; } for (const k of [...(n.kids ?? []), ...(n.tabs ?? []), n.kid, n.a, n.b]) walk(k); }; walk(state().layout?.root); return out; };
  /** A new board on the same hub, nothing collapsed, the lanes loaded and the preview on the first Queued card. */
  const fresh = async () => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard || (app as any).stack.at(-1) instanceof Desk) app.pop();
    b = new DeliveryBoard(hub.id);
    app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items?.length), "the lanes", 10_000);
    B().collapsed.clear(); B().save();
    await whole(B().preview);
  };
  /** The preview and one detail on another card. */
  const withDetail = async () => {
    await fresh();
    key(char("j")); key({ kind: "enter" });
    const d = B().details[0] as ReaderPane;
    await whole(d);
    key({ kind: "esc" }); key(char("k"));
    await whole(B().preview, B().lanes[0].items[0].id);
    return d;
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    other = new SocketBoard(board.path);
    await board.info();
    hub = await create(null, "Allotment board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
    cards.beans = await create(null, note("Stake the beans", "queued"));
    cards.squash = await create(null, note("Plant the squash", "queued"));
    cards.gate = await create(null, note("Fix the gate", "doing"));
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("c in the preview collapses it to a spine with its note's title; the detail takes the width; c opens it again", async () => {
    await withDetail();
    const before = rect("detail0").cols;
    key({ kind: "tab" });
    expect(BV.where(b)).toBe("preview");
    key(char("c"));
    expect(!!folded(B().preview)).toBe(true);
    const s = spine("preview");
    expect(s.cols).toBe(3);
    expect(before).toBeLessThan(120);
    expect(rect("detail0").cols).toBe(180 - 3);                         // the freed width went to the detail
    // Stacked letters of the title in cells, under the "nothing held" mark.
    const title = B().preview.msg.text.split("\n")[0].slice(0, 6);
    const col = frame().slice(s.row + 1, s.row + 1 + 6).map(l => l[s.col]).join("");
    expect(col).toBe(title);
    expect(hints()).toContain("preview · collapsed");
    expect(message()).toContain("preview collapsed");
    expect(savedFolds()).toEqual(["preview"]);
    // Its own keys don't reach the hidden note: j scrolls nothing and says how to open it.
    key(char("j"));
    expect(B().preview.surface.scroll).toBe(0);
    expect(message()).toContain("preview is collapsed");
    key(char("c"));
    expect(!!folded(B().preview)).toBe(false);
    expect(rect("preview")).toBeDefined();
    expect(rect("detail0").cols).toBe(before);
    expect(savedFolds()).toEqual([]);
    // ⏎ on a focused spine opens it too.
    key(char("c")); key({ kind: "enter" });
    expect(!!folded(B().preview)).toBe(false);
  });

  test("a detail collapses too, and a click on its spine opens and focuses it", async () => {
    const d = await withDetail();
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(BV.where(b)).toBe("detail0");
    key(char("c"));
    expect(!!folded(d)).toBe(true);
    const s = spine("detail0");
    expect(s.col + s.cols).toBe(180);                                   // the preview took the width
    expect(rect("preview").cols).toBe(180 - 3);
    key({ kind: "esc" });
    expect(BV.where(b)).toBe("lanes");
    click(s);
    expect(!!folded(d)).toBe(false);
    expect(BV.where(b)).toBe("detail0");
    expect(rect("detail0")).toBeDefined();
  });

  test("the preview's collapse is saved with the layout and restored by the next board", async () => {
    await fresh();
    key({ kind: "tab" }); key(char("c"));
    expect(savedFolds()).toEqual(["preview"]);
    const again = new DeliveryBoard(hub.id);
    expect((again as any).collapsed.has((again as any).idOf((again as any).preview))).toBe(true);
    key(char("c"));
  });

  test("C comments now, in a reader and from the lanes; c no longer does", async () => {
    await fresh();
    key(char("C"));                                                       // from the lanes: in the preview
    await until(() => !!B().preview.session, "the passage picker");
    expect(B().preview.surface.state()).toBe("quoting");
    key({ kind: "esc" });
    expect(B().preview.session).toBeNull();
    key({ kind: "esc" });
    key({ kind: "tab" });
    key(char("c"));
    await Bun.sleep(50);
    expect(B().preview.session).toBeNull();
    expect(!!folded(B().preview)).toBe(true);
    key(char("c"));
    expect(B().preview.hint()).toContain("C comment");
    expect(B().preview.hint()).not.toContain("c comment");
  });

  test("alt+c opens every collapsed lane and reader", async () => {
    const d = await withDetail();
    key(char("c"));                                                       // the Queued lane
    key({ kind: "tab" }); key(char("c"));                                 // the preview
    key({ kind: "tab" }); key(char("c"));                                 // the detail
    expect([foldedLanes(), foldedReaders()]).toEqual([1, 2]);
    key({ kind: "alt", ch: "c" });
    expect([foldedLanes(), foldedReaders()]).toEqual([0, 0]);
    expect(!!folded(d)).toBe(false);
    expect(savedFolds()).toEqual([]);
    // Before, alt+c arrived as esc then c: to the lanes, and a lane collapsed.
    expect(BV.where(b)).toBe("detail0");
  });

  test("in the person's own edit, c is typed: it never collapses the reader they're writing in", async () => {
    const d = await withDetail();
    key({ kind: "tab" }); key({ kind: "tab" });
    key(char("e"));
    await until(() => !!d.draft, "the draft");
    await Bun.sleep(20);
    key({ kind: "end" });
    for (const ch of " and oil the hinge") key(char(ch));
    key(char("c"));
    expect(d.draft!.text.split("\n")[0]).toEndWith("and oil the hingec");
    expect(!!folded(d)).toBe(false);
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(d.draft).toBeNull();
  });

  test("a reader holding a draft collapses and keeps it exactly: nothing saved or dropped, and reopening returns to it", async () => {
    const d = await withDetail();
    const id = d.msg!.id, was = (await other.get(id))!.text;
    const text = was + "\nOil the hinge before the frost.";
    expect(await act("edit.text", { text }, "detail1")).toMatchObject({ dirty: true });
    const draft = d.draft!;
    key({ kind: "tab" }); key({ kind: "tab" });
    expect(BV.where(b)).toBe("detail0");
    key(char("c"));                                                       // not in the agent's edit: c collapses
    expect(!!folded(d)).toBe(true);
    expect(message()).toContain("keeping an agent's");
    expect(d.draft).toBe(draft);
    expect([draft.text, draft.dirty]).toEqual([text, true]);
    expect(b.unsaved()).toBe(true);                                      // the unsaved guard still counts it
    const s = spine("detail0");
    expect(frame()[s.row]![s.col]).toBe("✎");
    expect(hints()).toContain("keeps an agent's");
    // e doesn't enter an edit the person can't see, and nothing is typed into it.
    key(char("e"));
    expect(message()).toContain("detail 1 is collapsed");
    key(char("x"));                                                       // nor closed
    expect(message()).toContain("not closed: it holds an agent's");
    expect(B().details).toContain(d);
    expect(d.draft!.text).toBe(text);
    expect(b.keepDrafts().some(p => readFileSync(p, "utf8").includes("Oil the hinge"))).toBe(true);
    expect((await other.get(id))!.text).toBe(was);                       // nothing was written
    key(char("c"));
    expect(!!folded(d)).toBe(false);
    expect(d.draft).toBe(draft);
    expect(d.draft!.text).toBe(text);
    key(char("e"));                                                       // enters it, as before collapsing
    key(char("!"));
    expect(d.draft!.text.length).toBe(text.length + 1);
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(d.draft).toBeNull();
    expect((await other.get(id))!.text).toBe(was);
  });

  test("an agent collapses and reopens readers through act, attributed, never the one the person has", async () => {
    const d = await withDetail();
    expect(BV.where(b)).toBe("lanes");
    expect(await act("reader.collapse", {}, "detail1")).toMatchObject({ reader: "detail1", collapsed: true });
    expect(folded(d)).toMatchObject({ by: AS });
    expect(message()).toContain(AS);
    expect(message()).toContain("collapsed detail 1");
    expect(BV.where(b)).toBe("lanes");
    const peek = (app.describe() as any).state;
    expect(peek.collapsedReaders).toEqual(["detail1"]);
    expect(peek.readers.find((r: any) => r.name === "detail1")).toMatchObject({ collapsed: true, collapsedBy: AS });
    // A note action there would change what the person can't see.
    await expect(act("edit", {}, "detail1")).rejects.toThrow(/collapsed.*reader.expand reader=detail1/);
    expect(await act("reader.expand", {}, "detail1")).toMatchObject({ reader: "detail1", collapsed: false });
    expect(BV.where(b)).toBe("lanes");
    // The reader the person has (here, in its property panel) isn't the agent's to collapse.
    key({ kind: "tab" });
    key(char("i"));
    expect(B().preview.surface.panel).not.toBeNull();
    await expect(act("reader.collapse", {}, "preview")).rejects.toThrow(/the person is in preview/);
    expect(!!folded(B().preview)).toBe(false);
    key({ kind: "esc" });
    await act("reader.collapse", {}, "detail1");
    key(char("j"));                                                       // the person's keys stay theirs
    expect(await act("reader.expand", {}, "all")).toMatchObject({ reopened: ["detail1"] });
    expect(foldedReaders()).toBe(0);
    await expect(act("reader.collapse", {}, "all")).rejects.toThrow(/only reopens/);
  });

  test("an agent's comment on a collapsed reader's note marks its spine", async () => {
    await withDetail();
    await act("reader.collapse", {}, "detail1");
    const d = B().details[0] as ReaderPane;
    await until(() => d.comments !== null, "the comments read");
    expect((app.describe() as any).state.readers.find((r: any) => r.name === "detail1").newComments).toBe(0);
    const m = (await other.get(d.msg!.id))!;
    await other.comment(crypto.randomUUID(), m.id, m.revision!, "Mulch around them first.", { quote: m.text.slice(0, 10), start: 0 }, { kind: "agent", id: "someone-else" });
    await until(() => (d.comments?.length ?? 0) > 0, "the new comment", 5000);
    expect((app.describe() as any).state.readers.find((r: any) => r.name === "detail1").newComments).toBe(1);
    const s = spine("detail0");
    expect(frame()[s.row + 1]![s.col]).toBe("■");
    await act("reader.expand", {}, "detail1");
  });

  test("under Kitty graphics, lane and reader spines are rotated titles placed on screen", async () => {
    await withDetail();
    key(char("c")); key({ kind: "tab" }); key(char("c"));
    (app as any).video = "kitty";
    try {
      const keys = b.render(B().ctx).placements!.map(p => p.key);
      expect(keys).toContain(`spine:${B().laneIds()[0]}`);
      expect(keys).toContain(`spine:${B().idNamed("preview")}`);
    } finally { (app as any).video = "cells"; }
    key({ kind: "alt", ch: "c" });
  });

  test("the desk: C comments in its reader, and c says what it does now", async () => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard) app.pop();
    const desk = new Desk();
    app.push(desk);
    desk.openBlock((await board.get(cards.gate.id))!);
    desk.focusOn("reader");                                             // `open` (an agent's) never moves the person's keys
    const reader = () => (desk as any).panes.get((desk as any).focus) as ReaderPane;
    await until(() => reader()?.msg?.id === cards.gate.id && !reader().msg!.partial, "the desk reader");
    key(char("c"));
    await Bun.sleep(50);
    expect(reader().session).toBeNull();
    expect(message()).toContain("C comments");
    key(char("C"));
    await until(() => !!reader().session, "the passage picker");
    key({ kind: "esc" });
    app.pop();
  });
});

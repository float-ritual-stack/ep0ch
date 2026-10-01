// PIE-420: comment threads inline. A comment mark (▐ in the margin, yellow while open, dim once resolved)
// expands its thread under the quoted passage by ⏎ or a click, and collapses it the same way. The thread
// shows its comment and replies, with Select, Reply and Resolve (or Reopen) controls that `[ ]` reaches and
// ⏎ or a click uses, through the same comment code as the thread list. The passage is highlighted while
// it's expanded. Which threads are expanded is the person's: an agent's actions work on the thread and
// leave that alone. Fictional notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { DeliveryBoard } from "../src/desk/delivery";
import type { ReaderPane } from "../src/desk/panes";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { C, fg } from "../src/style";
import { NOTE_ACTIONS, NoteSurface } from "../src/surface/note";
import { THREAD_BG } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
type Rect = { col: number; row: number; cols: number; rows: number };

describe("a thread inline, without a service", () => {
  const TEXT = "Shed jobs\nOil the chain before the frost.\nThe pump lives by the door.";
  const quote = "Oil the chain";
  const comment = { id: "c0ffee00-1111-4222-8333-444444444444", author: "sam", body: "Use the dry lube.", quote, at: Date.now() - 60_000, open: true, start: TEXT.indexOf(quote), end: TEXT.indexOf(quote) + quote.length, replies: [] };
  const host = () => ({ ctx: { board: { ancestors: async () => [], comments: async () => [comment] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });

  test("in a narrow reader every control is drawn whole, on as many rows as it takes, and is an element", async () => {
    for (const w of [18, 24, 40, 80]) {
      const s = new NoteSurface(), h = host();
      s.show({ id: "5eed0000-1111-4222-8333-444444444444", text: TEXT, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 1, props: {} }, h);
      await until(() => s.comments?.length === 1, "the comment");
      s.setExpanded(comment.id, true);
      const text = s.render(w, 40, h).lines.map(plain).join("\n");
      for (const c of ["[Select]", "[Reply]", "[Resolve]"]) expect({ w, drawn: text.includes(c) }).toEqual({ w, drawn: true });
      const controls = s.describeElements().filter(e => e.kind === "control");
      expect(controls.map(e => e.control)).toEqual(["select", "reply", "resolve"]);
    }
  });
});

describe.skipIf(!outliner)("comment threads inline, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, hub: any, note: any;
  const t = { canes: "", water: "" };
  let key: (k: Key) => void = () => {};
  const B = () => b as any;
  const AS = "test-agent-420";
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as?: string) => app.act({ action, args, reader, as });
  const frame = () => b.render(B().ctx).lines;
  const rect = (region: string): Rect => { b.render(B().ctx); return BV.rectOf(b, region); };
  const find = (lines: string[], text: string, r: Rect) => {
    for (let y = r.row; y < r.row + r.rows; y++) {
      const l = plain(lines[y] ?? ""), x = l.indexOf(text, r.col);
      if (x >= r.col && x + text.length <= r.col + r.cols) return { x: x + 1, y };
    }
    return null;
  };
  const where = (lines: string[], text: string, r: Rect) => find(lines, text, r) ?? (() => { throw new Error(`"${text}" isn't drawn in the preview`); })();
  const drawn = (text: string) => !!find(frame(), text, rect("preview"));
  const shows = (text: string) => until(() => drawn(text), `"${text}" in the preview`);
  const click = (at: { x: number; y: number }) => { key({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y }); key({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y }); };
  const P = () => B().preview as ReaderPane;
  const current = () => P().surface.describe().elements?.current ?? null;
  const stepTo = (label: string) => {
    for (let i = 0; i < 30; i++) { key(char("]")); frame(); if (current()?.label.startsWith(label)) return; }
    throw new Error(`[ ] never reached ${label}: ${P().surface.describeElements().map(e => `${e.kind} ${e.label}`).join(" | ")}`);
  };
  /** The mark in the margin beside `passage`: one cell left of the body. */
  const markAt = (passage: string) => { const r = rect("preview"), at = where(frame(), passage, r); return { x: r.col + 1, y: at.y }; };
  /** The colour the mark beside `passage` is drawn in (whatever tint is under it). */
  const markIn = (passage: string, colour: number) => { const l = frame()[markAt(passage).y]!; return l.slice(0, l.indexOf("▐")).split("\x1b[0m").at(-1)!.includes(fg(colour)); };
  const thread = (id: string) => P().surface.comments?.find(c => c.id === id);
  const fresh = async () => {
    if ((app as any).stack.at(-1) instanceof DeliveryBoard) app.pop();
    b = new DeliveryBoard(hub.id);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1, "the lane", 10_000);
    await until(() => P().msg?.id === note.id && !P().msg!.partial, "the whole note");
    await until(() => P().surface.comments?.length === 2, "the comments");
    await shows("Canes along the fence");
    BV.at(b, "preview");
  };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    note = await create(null, "Bean trench [stage::queued]\nDig a trench a spade deep.\nCanes along the fence, tied at the top.\n\nWater them in on Sunday.");
    const q1 = "Canes along the fence", q2 = "Water them in on Sunday.";
    t.canes = (await board.comment(`seed-${crypto.randomUUID()}`, note.id, note.revision, "Use the hazel poles.", { quote: q1, start: note.text.indexOf(q1) })).id;
    await board.reply(`seed-${crypto.randomUUID()}`, t.canes, "The ones behind the shed?", { kind: "agent", id: "garden-helper" });
    const now = (await board.get(note.id))!;
    t.water = (await board.comment(`seed-${crypto.randomUUID()}`, note.id, now.revision!, "Or Saturday, if it's dry.", { quote: q2, start: now.text.indexOf(q2) })).id;
    await board.setLifecycle(t.water, "resolved", USER);
    hub = await create(null, "Allotment board");
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
  }, 20_000);

  test("⏎ on a mark expands its thread under the passage, with its replies and controls, the passage highlighted; ⏎ again collapses it", async () => {
    await fresh();
    expect(drawn("Use the hazel poles.")).toBe(false);
    stepTo("\"Canes along the fence\"");
    expect(P().surface.hint()).toContain("⏎ expand its thread");
    key({ kind: "enter" });
    await shows("Use the hazel poles.");
    expect(P().surface.session).toBeNull();                              // no thread list, no session: still reading
    const r = rect("preview"), lines = frame();
    const passage = where(lines, "Canes along the fence", r).y, body = where(lines, "Use the hazel poles.", r).y;
    expect(body).toBeGreaterThan(passage);
    expect(body).toBeLessThan(where(lines, "Water them in", r).y);        // under its passage, before the next line
    expect(drawn("The ones behind the shed?")).toBe(true);                // the reply
    expect(drawn("[Select] · [Reply] · [Resolve]")).toBe(true);
    // The quoted passage is highlighted while the thread is open (the ruler is on the mark, so step off first).
    key(char("]")); frame();
    expect(frame()[passage]).toContain(THREAD_BG);
    key(char("[")); frame();
    expect(P().surface.hint()).toContain("⏎ collapse its thread");
    key({ kind: "enter" });
    frame();
    expect(drawn("Use the hazel poles.")).toBe(false);
    expect(frame()[passage]).not.toContain(THREAD_BG);
    expect(current()!.kind).toBe("comment");
  }, 30_000);

  test("a click on a mark expands and collapses it; a resolved thread's mark is dim and expands the same way", async () => {
    await fresh();
    expect(markIn("Canes along the fence", C.yellow)).toBe(true);
    expect(markIn("Water them in", C.dark)).toBe(true);
    click(markAt("Water them in"));
    await shows("Or Saturday, if it's dry.");
    expect(drawn("resolved")).toBe(true);
    expect(drawn("[Select] · [Reply] · [Reopen]")).toBe(true);
    expect(current()).toMatchObject({ kind: "comment" });
    click(markAt("Water them in"));
    frame();
    expect(drawn("Or Saturday, if it's dry.")).toBe(false);
    expect(P().surface.expanded.size).toBe(0);
  }, 30_000);

  test("[ ] reaches the controls; Reply by ⏎ writes the reply in the person's session and comes back to the expanded thread once it's sent", async () => {
    await fresh();
    stepTo("\"Canes along the fence\"");
    key({ kind: "enter" });
    await shows("[Reply]");
    stepTo("Reply");
    expect(current()).toMatchObject({ kind: "control" });
    expect(P().surface.hint()).toContain("⏎ reply");
    key({ kind: "enter" });
    await until(() => P().surface.session?.mode === "compose", "the reply being written");
    expect(B().entered.in(P())).toBe(true);                              // the person's keys go to it
    expect(P().surface.session!.target).toMatchObject({ kind: "reply" });
    for (const c of "Yes, those.") key(char(c));
    key({ kind: "char", ch: "s", ctrl: true });
    await until(() => P().surface.session === null, "back to reading once the reply landed");
    await until(() => thread(t.canes)?.replies.length === 2, "the reply saved");
    expect(thread(t.canes)!.replies[1]!.body).toBe("Yes, those.");
    await shows("Yes, those.");                                          // still expanded, with the new reply
    expect(P().surface.expanded.has(t.canes)).toBe(true);
  }, 30_000);

  test("Reply by a click, then esc: back to reading, nothing sent", async () => {
    await fresh();
    P().surface.setExpanded(t.canes, true);
    await shows("[Reply]");
    const replies = thread(t.canes)!.replies.length;
    click(where(frame(), "[Reply]", rect("preview")));
    await until(() => P().surface.session?.mode === "compose", "the reply being written");
    key({ kind: "esc" });
    await until(() => P().surface.session === null, "back to reading");
    await shows("[Reply]");
    expect(thread(t.canes)!.replies.length).toBe(replies);
  }, 30_000);

  test("Resolve and Reopen, by a click and by ⏎: the lifecycle changes, the mark dims and brightens, the control's word follows", async () => {
    await fresh();
    P().surface.setExpanded(t.canes, true);
    await shows("[Resolve]");
    click(where(frame(), "[Resolve]", rect("preview")));
    await until(() => thread(t.canes)?.open === false, "resolved");
    await shows("[Reopen]");
    expect(markIn("Canes along the fence", C.dark)).toBe(true);
    expect(P().surface.expanded.has(t.canes)).toBe(true);                // it stays expanded
    stepTo("Reopen");
    key({ kind: "enter" });
    await until(() => thread(t.canes)?.open === true, "reopened");
    await shows("[Resolve]");
    expect(markIn("Canes along the fence", C.yellow)).toBe(true);
  }, 30_000);

  test("Select selects the quoted passage as the person's text selection, so y copies it", async () => {
    await fresh();
    P().surface.setExpanded(t.canes, true);
    await shows("[Select]");
    click(where(frame(), "[Select]", rect("preview")));
    frame();
    expect(P().surface.describeSelection(P().surface.selection)?.text).toBe("Canes along the fence");
  }, 30_000);

  test("agents: reply and resolve work on an expanded thread and leave it expanded; expanding, collapsing and the controls are the person's", async () => {
    await fresh();
    P().surface.setExpanded(t.canes, true);
    await shows("[Reply]");
    await expect(act("thread.toggle", { thread: t.canes }, "preview", AS)).rejects.toThrow(/person's reading state/);
    await expect(act("thread.toggle", { thread: t.water, expand: true }, "preview", AS)).rejects.toThrow(/person's reading state/);
    const els = P().surface.describeElements();
    const reply = els.find(e => e.kind === "control" && e.control === "reply")!;
    await expect(act("element.open", { n: reply.n }, "preview", AS)).rejects.toThrow(/reply thread=/);
    const mark = els.find(e => e.kind === "comment" && e.thread === t.canes)!;
    await act("element.open", { n: mark.n }, "preview", AS);             // its own thread list, as before
    expect(P().surface.expanded.has(t.canes)).toBe(true);
    await act("comment.close", {}, "preview", AS);
    const r = await act("resolve", { thread: t.canes }, "preview", AS) as any;
    expect(r.lifecycle).toBe("resolved");
    await act("comment.close", {}, "preview", AS);
    expect(P().surface.expanded).toEqual(new Set([t.canes]));            // the person's view is as they left it
    await shows("[Reopen]");
    await act("resolve", { thread: t.canes, open: true }, "preview", AS);
    await act("comment.close", {}, "preview", AS);
    // The person's own thread.toggle (the action the key and the click share) does it.
    await NOTE_ACTIONS.run("thread.toggle", { thread: t.canes.slice(0, 8) }, { surface: P().surface, host: P().host(B()) } as any, USER);
    expect(P().surface.expanded.size).toBe(0);
    expect(P().surface.describe().comments!.threads.map(x => x.expanded)).toEqual([false, false]);
  }, 30_000);
});

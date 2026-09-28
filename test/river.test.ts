// The river's columns host the shared note surface: edit, quote a passage, comment, reply and resolve
// from a column by keys and by agent, with the same code as the board's readers. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { BANNER_MS, River, RIVER_ACTIONS } from "../src/river/river";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

test("every river action has keys and a summary", () => {
  const list = RIVER_ACTIONS.list();
  expect(list.map(a => a.name)).toEqual(["open", "focus", "select", "replies", "split", "pin", "close"]);
  for (const a of list) { expect(a.summary.length).toBeGreaterThan(10); expect(a.keys).toBeTruthy(); }
});

describe.skipIf(!outliner)("river columns host the note surface, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, river: River;
  const notes: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const type = (s: string) => { for (const c of s) key(char(c)); };
  const AS = "river-agent-3";
  const R = () => river as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const lastBy = async (id: string, author: "agent" | "user") => {
    const log = await other.request("activity.recent", { author, limit: 50 });
    const e = log.entries.find((x: any) => x.block.id === id);
    return e && [e.author, e.actorId];
  };
  const threads = (id: string) => other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: id }, includeResolved: true } });
  const column = (n: number) => R().cols[n - 1];
  const surfaceOf = (n: number) => column(n).panes[column(n).pane].surface;
  // Screen text without colours (a failed toContain then prints something readable).
  const screen = () => (R().render(app).lines.join("\n") as string).replace(/\x1b\[[0-9;]*m/g, "");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");   // before the river reads river.json
    board = new SocketBoard(await scratch.start());
    other = new SocketBoard(board.path);
    notes.beans = await create(null, "Stake the beans [stage::queued]\nCanes along the fence.\n\nTie them loosely; the wind is strong there.");
    notes.squash = await create(null, "Plant the squash [stage::queued]\nBy the compost heap.");
    notes.peas = await create(null, "Sow the peas\nTwo rows, see ((" + notes.beans.id + ")).");
    notes.shoot = await create(notes.peas.id, "First shoots\nThey came up on Tuesday.");
    notes.thin = await create(notes.peas.id, "Thin the seedlings\nOne every hand's width.");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    river = new River();
    app.push(new MainMenu()); app.push(river);
    await until(() => !!column(1)?.panes[0].items?.length, "the Library", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  const panesNow = (): any[] => R().panes();
  const paneOf = (reader: string) => panesNow().find(p => `r${p.id}` === reader);
  const readerOf = (id: string) => ((app.describe() as any).state.columns.flatMap((c: any) => c.panes).find((p: any) => p.source.kind === "block" && p.source.id === id))?.reader as string;
  const coverOf = (reader: string) => (app.describe() as any).state.columns.find((c: any) => c.panes.some((p: any) => p.reader === reader))?.cover;
  const focusedUid = () => R().cols[R().focus].uid;
  const focusOnReader = (reader: string) => {   // the person's h l, never the agent's `focus`
    const target = R().cols.findIndex((c: any) => c.panes.some((p: any) => `r${p.id}` === reader));
    for (let i = 0; i < 20 && R().focus > target; i++) key(char("h"));
    for (let i = 0; i < 20 && R().focus < target; i++) key(char("l"));
    expect(R().focus).toBe(target);
  };
  let beansR = "";

  test("an agent's open returns a stable reader id and leaves the person's focus; the person moves there and edits with e", async () => {
    const o: any = await act("open", { id: notes.beans.id });
    expect(o).toMatchObject({ at: "2", id: notes.beans.id });
    expect(o.reader).toMatch(/^r\d+$/);
    beansR = o.reader;
    expect(R().focus).toBe(0);                                   // still the Library: the agent didn't take the keys
    key(char("l"));
    expect(R().focus).toBe(1);
    await until(() => !!column(2).panes[0].root, "the column's note");
    key(char("e"));
    await until(() => !!surfaceOf(2).draft, "the draft");
    expect(screen()).toContain("editing · Stake the beans");
    expect((app.describe() as any).state.columns[1]).toMatchObject({ cover: "full", panes: [{ reader: beansR, at: "2", note: { id: notes.beans.id }, surface: { editing: { dirty: false } } }] });
    key({ kind: "down" }); key({ kind: "end" }); type(" Two per plant.");
    expect(river.unsaved()).toBe(true);
    key(ctrl("s"));
    await until(() => !surfaceOf(2).draft, "the save");
    expect((await current(notes.beans.id)).text).toContain("Canes along the fence. Two per plant.");
    expect((await lastBy(notes.beans.id, "user"))?.[0]).toBe("user");
    await until(() => screen().includes("Two per plant."), "the saved text in the column");
    expect(screen()).not.toContain("editing ·");
  });

  test("i opens the property panel in a river column; it holds the person's keys until Esc", async () => {
    focusOnReader(beansR);
    const at = R().focus;
    key(char("i"));
    await until(() => !!surfaceOf(at + 1).panel, "the panel");
    key(char("h"));                                              // a panel key, not a column move
    expect(R().focus).toBe(at);
    key({ kind: "esc" });
    expect(surfaceOf(at + 1).panel).toBeNull();
    key(char("h"));
    expect(R().focus).toBe(at - 1);
    key(char("l"));
  });

  test("c: pick a passage in the column, write, ctrl+s sends the comment", async () => {
    key(char("c"));
    await until(() => surfaceOf(2).session?.mode === "select", "the passage picker");
    expect(screen()).toContain("quoting");
    key({ kind: "enter" }); type("Which canes, bamboo?");
    key(ctrl("s"));
    await until(() => surfaceOf(2).session?.mode === "threads", "the sent comment", 8000);
    const t = await threads(notes.beans.id);
    expect(t.map(x => x.body)).toContain("Which canes, bamboo?");
    key({ kind: "esc" });
    expect(surfaceOf(2).session).toBeNull();
  });

  test("an agent's edit in the focused column doesn't take the person's keys; its line clears on their next key there", async () => {
    const text = (await current(notes.beans.id)).text.replace("Tie them loosely", "Tie them loosely with twine");
    expect(await act("edit.text", { text }, beansR)).toMatchObject({ reader: beansR, at: "2", dirty: true });
    // h and l still move between columns; nothing is typed into the agent's draft.
    key(char("h"));
    expect(R().focus).toBe(0);
    key(char("l"));
    expect(R().focus).toBe(1);
    expect(surfaceOf(2).draft.text).toBe(text);
    expect(screen()).toContain("enter an agent's (river-agent-3) edit");
    // x doesn't close it and says how to get in.
    key(char("x"));
    expect(column(2)).toBeTruthy();
    expect((app as any).message).toContain("e or ⏎ enters it");
    expect(await act("edit.save", {}, beansR)).toMatchObject({ reader: beansR, saved: true });
    expect(await lastBy(notes.beans.id, "agent")).toEqual(["agent", AS]);
    expect(screen()).toContain(`an agent (${AS}) saved this note`);
    key(char("j"));                                              // the person acts in that column: read
    expect(screen()).not.toContain(`an agent (${AS}) saved this note`);
    const c: any = await act("comment", { quote: "the wind is strong there", body: "Stake on the lee side." }, notes.beans.id.slice(0, 8));
    expect(c).toMatchObject({ reader: beansR, sent: "comment" });
    const mine = (await threads(notes.beans.id)).find(x => x.body === "Stake on the lee side.");
    expect(mine.originalTarget.anchor.exact).toBe("the wind is strong there");
    expect([mine.block.author, mine.block.actorId]).toEqual(["agent", AS]);
    expect(await act("reply", { thread: mine.block.id, body: "Done." }, beansR)).toMatchObject({ sent: "reply" });
    expect(await act("resolve", { thread: mine.block.id }, beansR)).toMatchObject({ lifecycle: "resolved" });
    await act("comment.close", {}, beansR);
  });

  test("with an agent's thread list open, the person's x doesn't resolve; e enters it", async () => {
    const open = async () => (await threads(notes.beans.id)).filter(t => t.lifecycle === "open").map(t => t.block.id).sort();
    const before = await open();
    expect(before.length).toBeGreaterThan(0);
    await act("threads", {}, beansR);
    expect(surfaceOf(2).session?.mode).toBe("threads");
    key(char("x"));
    await Bun.sleep(400);
    expect(await open()).toEqual(before);
    expect(surfaceOf(2).session?.mode).toBe("threads");
    key(char("e"));                                              // in it now: keys are the thread list's
    key({ kind: "esc" });
    expect(surfaceOf(2).session).toBeNull();
  });

  test("esc, esc on an agent's unsaved draft copies it to disk before closing", async () => {
    const text = (await current(notes.beans.id)).text + "\nAn agent's unsaved line.";
    await act("edit.text", { text }, beansR);
    const d = surfaceOf(2).draft;
    key({ kind: "enter" });                                      // the person enters the agent's edit
    key({ kind: "esc" }); key({ kind: "esc" });
    expect(surfaceOf(2).draft).toBeNull();
    expect(d.savedCopy).toBeTruthy();
    expect(readFileSync(d.savedCopy, "utf8")).toContain("An agent's unsaved line.");
    expect((app as any).message).toContain(d.savedCopy);
  });

  test("after an agent's focus moves the person away, coming back by h l doesn't put their keys in the edit", async () => {
    key(char("e"));                                              // the person's own edit in the beans column
    await until(() => !!surfaceOf(2).draft, "the draft");
    key(char("x"));                                              // in it: x is typed
    expect(surfaceOf(2).draft.text).toContain("x");
    await act("focus", {}, "1");
    expect(R().focus).toBe(0);
    key(char("l"));
    expect(R().focus).toBe(1);
    const before = surfaceOf(2).draft.text;
    key(char("q"));
    expect(surfaceOf(2).draft.text).toBe(before);
    expect(screen()).toContain("enter the edit");
    key({ kind: "enter" }); key({ kind: "esc" }); key({ kind: "esc" });
    expect(surfaceOf(2).draft).toBeNull();
  });

  test("in the Library the selected note is the one e and c act on", async () => {
    expect(await act("select", { id: notes.squash.id }, "1")).toMatchObject({ at: "1", selected: notes.squash.id });
    expect(await act("edit.text", { text: "Plant the squash [stage::queued]\nBy the compost heap, in June." }, "1")).toMatchObject({ at: "1", dirty: true });
    expect(surfaceOf(1).draft.blockId).toBe(notes.squash.id);
    await expect(act("close", {}, "1")).rejects.toThrow("editing");
    expect(await act("edit.save", {}, "1")).toMatchObject({ saved: true });
    expect((await current(notes.squash.id)).text).toContain("in June.");
  });

  test("column numbers shift; an agent's edit carries on only in the pane that holds it", async () => {
    const uid = focusedUid();
    const text = (await current(notes.beans.id)).text + "\nPositional.";
    expect(await act("edit.text", { text }, "2")).toMatchObject({ reader: beansR, at: "2" });
    // A column opens before it: the beans column is 3 now, and the person's focus stays on it.
    const peas: any = await act("open", { id: notes.peas.id }, "1");
    expect(peas.at).toBe("2");
    expect(focusedUid()).toBe(uid);
    await until(() => !!paneOf(peas.reader).root, "the peas column");
    // The agent's old number now names the peas column: refused, and told the pane's id.
    await expect(act("edit.text", { text }, "2")).rejects.toThrow(`reader ${beansR}`);
    await expect(act("edit.save", {}, "2")).rejects.toThrow(`reader ${beansR}`);
    expect(paneOf(peas.reader).surface.draft).toBeNull();
    expect(await act("edit.close", { discard: true }, beansR)).toMatchObject({ reader: beansR, at: "3", closed: true });
    expect(await act("close", {}, peas.reader)).toMatchObject({ closed: peas.reader });
    expect(readerOf(notes.peas.id)).toBeUndefined();
  });

  test("an agent's up, link.follow and split leave the person's focus and pane", async () => {
    const uid = focusedUid();
    const shoot: any = await act("open", { id: notes.shoot.id }, beansR);
    expect(focusedUid()).toBe(uid);
    await until(() => !!paneOf(shoot.reader).root, "the shoot column");
    if (coverOf(shoot.reader) !== "full") expect(await act("pin", { docked: true }, shoot.reader)).toMatchObject({ docked: true });
    expect(focusedUid()).toBe(uid);
    expect(await act("up", {}, shoot.reader)).toMatchObject({ opened: notes.peas.id });
    expect(focusedUid()).toBe(uid);
    const peasR = readerOf(notes.peas.id);
    expect(peasR).toBeTruthy();
    await until(() => !!paneOf(peasR).root, "the parent's column");
    // The peas column may be squeezed now; docking widens it without moving the person.
    await act("pin", { docked: false }, shoot.reader);
    if (coverOf(peasR) !== "full") await act("pin", { docked: true }, peasR);
    expect(await act("link.follow", { n: 1 }, peasR)).toMatchObject({ opened: notes.beans.id });
    expect(focusedUid()).toBe(uid);
    const sp: any = await act("split", {}, "1");
    expect(R().cols[0].pane).toBe(0);
    expect(R().cols[0].panes).toHaveLength(2);
    expect(sp.reader).toMatch(/^r\d+$/);
    await act("close", {}, sp.reader);
    expect(R().cols[0].panes).toHaveLength(1);
  });

  test("a block id prefers the full-width column opened on the note over a list selecting it", async () => {
    const peasR = readerOf(notes.peas.id);
    await act("select", { id: notes.peas.id }, "1");
    for (let i = 0; i < 20 && R().focus > 0; i++) key(char("h"));                        // the person is in the Library
    if (coverOf(peasR) !== "full") await act("pin", { docked: true }, peasR);
    expect(coverOf(peasR)).toBe("full");
    expect(await act("link.select", { n: 1 }, notes.peas.id)).toMatchObject({ reader: peasR });
  });

  test("clicking or wheeling a card clears a selected link, so ⏎ opens the clicked card", async () => {
    const peasR = readerOf(notes.peas.id), p = paneOf(peasR);
    await until(() => (p.items?.length ?? 0) >= 2, "the peas replies");
    await act("link.select", { n: 1 }, peasR);
    expect(R().linked(p)).toBe(true);
    screen();
    const hit = R().hits.find((h: any) => R().cols[h.col].panes[h.pane] === p);
    const other = p.sel === 0 ? 1 : 0;
    const y = hit.rect.row + hit.rows.findIndex((r: any) => r.card === other);
    key({ kind: "mouse", action: "down", button: 0, x: hit.rect.col + 2, y });
    expect(p.sel).toBe(other);
    expect(R().linked(p)).toBe(false);
    const clicked = R().flat(p)[other].m.id;
    key({ kind: "enter" });
    expect(R().cols[R().focus].panes[0].source.id).toBe(clicked);
    // The wheel too.
    await act("link.select", { n: 1 }, peasR);
    screen();
    const h2 = R().hits.find((h: any) => R().cols[h.col].panes[h.pane] === p);
    key({ kind: "mouse", action: "wheel-down", button: 0, x: h2.rect.col + 2, y: h2.rect.row + 1 });
    expect(R().linked(p)).toBe(false);
  });

  test("a property notice and an agent line in a column the person isn't in clear once shown a while", async () => {
    const peasR = readerOf(notes.peas.id), p = paneOf(peasR);
    const text = (await current(notes.peas.id)).text.replace("Sow the peas", "Sow the peas [stage::doing]");
    await act("edit.text", { text }, peasR);
    expect(await act("edit.save", {}, peasR)).toMatchObject({ saved: false });   // the property warning first
    expect(await act("edit.save", {}, peasR)).toMatchObject({ saved: true });
    expect(screen()).toContain("properties changed: +stage=doing");
    expect(screen()).toContain(`an agent (${AS}) saved this note`);
    expect(R().paneS).not.toBe(p);                              // the person is in the column they opened last
    key(char("j"));                                              // elsewhere, and not long after: still there
    expect(screen()).toContain("properties changed: +stage=doing");
    p.shown.at -= BANNER_MS;
    key(char("k"));
    expect(screen()).not.toContain("properties changed: +stage=doing");
    expect(screen()).not.toContain(`an agent (${AS}) saved this note`);
  });

  test("an edit already open in a compressed column still takes its agent's actions; starting one there says pin, not focus", async () => {
    const cols = () => (app.describe() as any).state.columns;
    const dockOnly = async (reader: string) => {   // at 180 cells: the focused column and one docked one are full
      for (const c of cols()) if (c.pinned && c.panes[0].reader !== reader) await act("pin", { docked: false }, c.panes[0].reader);
      await act("pin", { docked: true }, reader);
    };
    const shootR = readerOf(notes.shoot.id);
    focusOnReader(beansR);
    await dockOnly(shootR);
    expect(coverOf(shootR)).toBe("full");
    const text = (await current(notes.shoot.id)).text + "\nSqueezed.";
    await act("edit.text", { text }, shootR);
    await act("pin", { docked: false }, shootR);
    // Two docked columns after it, the person elsewhere: the column holding the agent's edit is squeezed.
    for (const id of [notes.squash.id, notes.beans.id]) {
      const o: any = await act("open", { id, duplicate: true }, String(R().cols.length));
      await act("pin", { docked: true }, o.reader);
    }
    expect(coverOf(shootR)).not.toBe("full");
    expect(await act("edit.text", { text: text + " Still mine." }, shootR)).toMatchObject({ reader: shootR, dirty: true });
    expect(await act("edit.save", {}, shootR)).toMatchObject({ saved: true });
    expect((await current(notes.shoot.id)).text).toContain("Squeezed. Still mine.");
    // Starting something new in a squeezed column is refused, pointing at pin (which doesn't move the person).
    const squeezed = cols().find((c: any) => c.cover !== "full" && !c.pinned && !c.focused);
    const r = squeezed.panes[0].reader;
    const refusal = await act("edit.text", { text: "x" }, r).then(() => "", (e: Error) => e.message);
    expect(refusal).toContain(`pin reader=${r}`);
    expect(refusal).not.toContain("focus");
    const uid = focusedUid();
    await dockOnly(r);
    expect(coverOf(r)).toBe("full");
    expect(focusedUid()).toBe(uid);
  });

  test("another client's save marks the column's draft, never replaces it; leaving copies it out", async () => {
    focusOnReader(beansR);
    await act("edit.text", { text: (await current(notes.beans.id)).text + "\nMine, unsaved." }, beansR);
    const now = await current(notes.beans.id);
    await other.request("update", { blockId: notes.beans.id, text: now.text.replace("Canes", "Hazel canes"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "other-writer" } });
    const s = paneOf(beansR).surface;
    await until(() => s.draft?.changedElsewhere, "changed elsewhere", 8000);
    expect(s.draft.text).toContain("Mine, unsaved.");
    expect(screen()).toContain("editing · unsaved");
    expect(river.unsaved()).toBe(true);
    const kept = river.keepDrafts();
    expect(kept).toHaveLength(1);
    expect(existsSync(kept[0]!)).toBe(true);
    expect(readFileSync(kept[0]!, "utf8")).toContain("Mine, unsaved.");
    await act("edit.close", { discard: true }, beansR);
    expect(river.unsaved()).toBe(false);
  });
});

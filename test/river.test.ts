// The river's columns host the shared note surface: edit, quote a passage, comment, reply and resolve
// from a column by keys and by agent, with the same code as the board's readers. Scratch services only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { River, RIVER_ACTIONS } from "../src/river/river";
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
  const screen = () => R().render(app).lines.join("\n") as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");   // before the river reads river.json
    board = new SocketBoard(await scratch.start());
    other = new SocketBoard(board.path);
    notes.beans = await create(null, "Stake the beans [stage::queued]\nCanes along the fence.\n\nTie them loosely; the wind is strong there.");
    notes.squash = await create(null, "Plant the squash [stage::queued]\nBy the compost heap.");
    notes.peas = await create(null, "Sow the peas\nTwo rows, see ((" + notes.beans.id + ")).");
    notes.shoot = await create(notes.peas.id, "First shoots\nThey came up on Tuesday.");
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

  test("open beside, then e: edit the column's note in the column, ctrl+s saves it", async () => {
    expect(await act("open", { id: notes.beans.id })).toEqual({ reader: "2", id: notes.beans.id });
    expect(R().focus).toBe(1);
    await until(() => !!column(2).panes[0].root, "the column's note");
    key(char("e"));
    await until(() => !!surfaceOf(2).draft, "the draft");
    expect(screen()).toContain("editing · Stake the beans");
    expect((app.describe() as any).state.columns[1]).toMatchObject({ cover: "full", panes: [{ note: { id: notes.beans.id }, surface: { editing: { dirty: false } } }] });
    key({ kind: "down" }); key({ kind: "end" }); type(" Two per plant.");
    expect(river.unsaved()).toBe(true);
    key(ctrl("s"));
    await until(() => !surfaceOf(2).draft, "the save");
    expect((await current(notes.beans.id)).text).toContain("Canes along the fence. Two per plant.");
    expect((await lastBy(notes.beans.id, "user"))?.[0]).toBe("user");
    // Reading again: the river's own card for the note, with the saved text.
    await until(() => screen().includes("Two per plant."), "the saved text in the column");
    expect(screen()).not.toContain("editing ·");
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

  test("an agent edits and comments in a column by number, recorded as the agent", async () => {
    const text = (await current(notes.beans.id)).text.replace("Tie them loosely", "Tie them loosely with twine");
    expect(await act("edit.text", { text }, "2")).toMatchObject({ reader: "2", dirty: true });
    expect(await act("edit.save", {}, "2")).toMatchObject({ reader: "2", saved: true });
    expect(await lastBy(notes.beans.id, "agent")).toEqual(["agent", AS]);
    expect(screen()).toContain(`an agent (${AS}) saved this note`);
    const c: any = await act("comment", { quote: "the wind is strong there", body: "Stake on the lee side." }, notes.beans.id.slice(0, 8));
    expect(c).toMatchObject({ reader: "2", sent: "comment" });
    const mine = (await threads(notes.beans.id)).find(x => x.body === "Stake on the lee side.");
    expect(mine.originalTarget.anchor.exact).toBe("the wind is strong there");
    expect([mine.block.author, mine.block.actorId]).toEqual(["agent", AS]);
    expect(await act("reply", { thread: mine.block.id, body: "Done." }, "2")).toMatchObject({ sent: "reply" });
    expect(await act("resolve", { thread: mine.block.id }, "2")).toMatchObject({ lifecycle: "resolved" });
    await act("comment.close", {}, "2");
  });

  test("in the Library the selected note is the one e and c act on", async () => {
    expect(await act("select", { id: notes.squash.id }, "1")).toMatchObject({ reader: "1", selected: notes.squash.id });
    expect(await act("edit.text", { text: "Plant the squash [stage::queued]\nBy the compost heap, in June." }, "1")).toMatchObject({ reader: "1", dirty: true });
    expect(surfaceOf(1).draft.blockId).toBe(notes.squash.id);
    // Holding the edit, the column refuses to close.
    await expect(act("close", {}, "1")).rejects.toThrow("editing");
    expect(await act("edit.save", {}, "1")).toMatchObject({ saved: true });
    expect((await current(notes.squash.id)).text).toContain("in June.");
  });

  test("a followed link opens beside the column; u opens the parent beside", async () => {
    await act("open", { id: notes.shoot.id });
    const n = R().focus + 1;
    expect(await act("up", {}, String(n))).toMatchObject({ opened: notes.peas.id });
    expect(column(R().focus + 1).panes[0].source.id).toBe(notes.peas.id);
    await until(() => !!column(R().focus + 1).panes[0].root, "the parent's column");
    expect(await act("link.follow", { n: 1 }, String(R().focus + 1))).toMatchObject({ opened: notes.beans.id });
    expect(column(R().focus + 1).panes[0].source.id).toBe(notes.beans.id);    // went to the column it already has
  });

  test("compressed columns are read-only views: a note action there is refused until it's focused", async () => {
    for (const id of [notes.squash.id, notes.peas.id, notes.shoot.id]) await act("open", { id, duplicate: true });
    const cols = (app.describe() as any).state.columns;
    const squeezed = cols.find((c: any) => c.cover !== "full" && !c.pinned);
    expect(squeezed).toBeTruthy();
    await expect(act("edit.text", { text: "x" }, String(squeezed.n))).rejects.toThrow("compressed columns are read-only");
    await act("focus", {}, String(squeezed.n));
    expect((app.describe() as any).state.columns[squeezed.n - 1].cover).toBe("full");
  });

  test("another client's save marks the column's draft, never replaces it; leaving copies it out", async () => {
    await act("open", { id: notes.beans.id });
    const n = String(R().focus + 1);
    await act("edit.text", { text: (await current(notes.beans.id)).text + "\nMine, unsaved." }, n);
    const now = await current(notes.beans.id);
    await other.request("update", { blockId: notes.beans.id, text: now.text.replace("Canes", "Hazel canes"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "other-writer" } });
    const s = surfaceOf(Number(n));
    await until(() => s.draft?.changedElsewhere, "changed elsewhere", 8000);
    expect(s.draft.text).toContain("Mine, unsaved.");
    expect(screen()).toContain("editing · unsaved");
    // The river reports it unsaved (leaving asks twice), and a signal copies the draft to disk.
    expect(river.unsaved()).toBe(true);
    const kept = river.keepDrafts();
    expect(kept).toHaveLength(1);
    expect(existsSync(kept[0]!)).toBe(true);
    expect(readFileSync(kept[0]!, "utf8")).toContain("Mine, unsaved.");
    await act("edit.close", { discard: true }, n);
    expect(river.unsaved()).toBe(false);
  });
});

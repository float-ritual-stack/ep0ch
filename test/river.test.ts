// The river's columns host the shared note surface: edit, quote a passage, comment, reply and resolve
// from a column by keys and by agent, with the same code as the board's readers. Scratch services only.
// PIE-515: the River is a screen spec on the desk; its columns are `river.column` tiles in a flow, named as any tile
// (`library`, `column2`…), and widen, dock, close, back and forward are the engine's tile actions.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { BANNER_MS, COLUMN_ACTIONS, type RiverColumn } from "../src/river/column";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import { view } from "./river-view";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

test("every river column action has keys and a summary", () => {
  const list = COLUMN_ACTIONS.list();
  expect(list.map(a => a.name)).toEqual(["column.select", "column.replies", "column.scroll", "column.filter", "column.tag", "column.split", "column.copy"]);
  for (const a of list) { expect(a.summary.length).toBeGreaterThan(10); expect(a.keys).toBeTruthy(); }
});

describe.skipIf(!outliner)("river columns host the note surface, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, river: Desk;
  const notes: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const type = (s: string) => { for (const c of s) key(char(c)); };
  const AS = "river-agent-3";
  const V = () => view(river);
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, tile: reader, as: AS });
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => river.dispatch.act({ action, args, tile: reader }, USER);
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const lastBy = async (id: string, author: "agent" | "user") => {
    const log = await other.request("activity.recent", { author, limit: 50 });
    const e = log.entries.find((x: any) => x.block.id === id);
    return e && [e.author, e.actorId];
  };
  const threads = (id: string) => other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: id }, includeResolved: true } });
  const column = (n: number) => V().column(n);
  const surfaceOf = (n: number) => column(n).surface as any;
  // Screen text without colours (a failed toContain then prints something readable).
  const screen = () => (river.render(river.ctx).lines.join("\n") as string).replace(/\x1b\[[0-9;]*m/g, "");

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
    river = openScreen("river") as Desk;
    app.push(new MainMenu()); app.push(river);
    await until(() => !!column(1)?.items?.length, "the Library", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  const paneOf = (reader: string) => V().tiles.find(c => V().name(c) === reader)!;
  const readerOf = (id: string) => { const c = V().byNote(id); return c ? V().name(c) : undefined; };
  const coverOf = (reader: string) => { screen(); return V().coverOf(paneOf(reader)); };
  const focused = () => V().focused;
  const lib = () => V().name(column(1));
  const focusOnReader = (reader: string) => {   // the person's h l, never the agent's `focus`
    const target = V().columns.indexOf(paneOf(reader));
    for (let i = 0; i < 20 && V().focus > target; i++) key(char("h"));
    for (let i = 0; i < 20 && V().focus < target; i++) key(char("l"));
    expect(V().focus).toBe(target);
  };
  const readOnReader = (reader: string) => { focusOnReader(reader); key(char("w")); };   // the keys there, then the person's widen
  let beansR = "";

  test("an agent's open lands in the next column and leaves the person's focus; the person moves there and edits with e", async () => {
    const o: any = await act("open", { id: notes.beans.id });
    expect(o).toMatchObject({ id: notes.beans.id });
    beansR = o.reader;
    expect(V().columns.map(c => V().name(c))).toEqual([lib(), beansR]);
    expect(V().focus).toBe(0);                                   // still the Library: the agent didn't take the keys
    key(char("l"));
    expect(V().focus).toBe(1);
    await until(() => !!column(2).root, "the column's note");
    key(char("e"));
    await until(() => !!surfaceOf(2).draft, "the draft");
    expect(screen()).toContain("editing · Stake the beans");
    expect(coverOf(beansR)).toBe("full");
    expect(column(2).describe()).toMatchObject({ note: { id: notes.beans.id }, editing: { dirty: false } });
    key({ kind: "down" }); key({ kind: "end" }); type(" Two per plant.");
    expect(river.unsaved()).toBe(true);
    key(ctrl("s"));
    await until(() => !surfaceOf(2).draft, "the save");
    expect((await current(notes.beans.id)).text).toContain("Canes along the fence. Two per plant.");
    expect((await lastBy(notes.beans.id, "user"))?.[0]).toBe("user");
    await until(() => screen().includes("Two per plant."), "the saved text in the column");
    expect(screen()).not.toContain("editing ·");
  });

  test("i opens the property panel in a river column; it holds the person's keys, a value field takes typing, Esc steps out", async () => {
    focusOnReader(beansR);
    const at = V().focus, S = () => surfaceOf(at + 1);
    key(char("i"));
    await until(() => !!S().panel, "the panel");
    key(char("h"));                                              // a panel key, not a column move
    expect(V().focus).toBe(at);
    // an agent doesn't start an edit under the person's open panel
    await expect(act("edit.text", { text: "agent text" }, beansR)).rejects.toThrow(/property panel|the person is typing in/);
    expect(S().draft).toBeNull();
    key({ kind: "enter" });                                      // edit the selected value
    await until(() => !!S().panel?.field, "the value field");
    const before = S().panel.field.text;
    type("zz");
    expect(S().panel.field.text).toBe(before + "zz");           // typing reaches the field, not the river
    expect(V().focus).toBe(at);
    key({ kind: "esc" });                                        // closes the field, not the river
    expect(S().panel?.field ?? null).toBeNull();
    key({ kind: "esc" });                                        // closes the panel
    expect(S().panel).toBeNull();
    expect((app.describe() as any).screen).toBe(river.title);    // still in the river
    key(char("h"));
    expect(V().focus).toBe(at - 1);
    key(char("l"));
  });

  test("an agent's focus on the column the person is typing in leaves them in their edit", async () => {
    focusOnReader(beansR);
    const at = V().focus, S = () => surfaceOf(at + 1);
    key(char("e"));
    await until(() => !!S().draft, "the draft");
    // Moving their keys while they type is refused (the actor rule), even onto the column they're in.
    await expect(act("tile.focus", {}, beansR)).rejects.toThrow(/not moved/);
    key({ kind: "end" }); type("Q");                             // still the person's edit: typed, not a river key
    expect(S().draft.text).toContain("Q");
    expect(V().focus).toBe(at);
    key({ kind: "esc" }); key({ kind: "esc" });                  // discard (copied out) and close
    await until(() => !S().draft, "closed");
  });

  test("C: pick a passage in the column, write, ctrl+s sends the comment", async () => {
    key(char("C"));
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
    expect(await act("edit.text", { text }, beansR)).toMatchObject({ dirty: true });
    // h and l still move between columns; nothing is typed into the agent's draft.
    key(char("h"));
    expect(V().focus).toBe(0);
    key(char("l"));
    expect(V().focus).toBe(1);
    expect(surfaceOf(2).draft.text).toBe(text);
    expect(screen()).toContain("enter an agent's (river-agent-3) edit");
    // x doesn't close it and says how to get in.
    key(char("x"));
    expect(paneOf(beansR)).toBeTruthy();
    expect((app as any).message).toContain("e or ⏎ enters it");
    expect(await act("edit.save", {}, beansR)).toMatchObject({ saved: true });
    expect(await lastBy(notes.beans.id, "agent")).toEqual(["agent", AS]);
    expect(screen()).toContain(`an agent (${AS}) saved this note`);
    key(char("j"));                                              // the person acts in that column: read
    expect(screen()).not.toContain(`an agent (${AS}) saved this note`);
    const c: any = await act("comment", { quote: "the wind is strong there", body: "Stake on the lee side." }, beansR);
    expect(c).toMatchObject({ sent: "comment" });
    const mine_ = (await threads(notes.beans.id)).find(x => x.body === "Stake on the lee side.");
    expect(mine_.originalTarget.anchor.exact).toBe("the wind is strong there");
    expect([mine_.block.author, mine_.block.actorId]).toEqual(["agent", AS]);
    expect(await act("reply", { thread: mine_.block.id, body: "Done." }, beansR)).toMatchObject({ sent: "reply" });
    // Resolving opens the thread list over the note: refused in the column the person has (round 3, C3); fine once they're elsewhere.
    await expect(act("resolve", { thread: mine_.block.id }, beansR)).rejects.toThrow(/has the person's keys; the thread list would cover what they're reading/);
    key(char("h"));
    expect(await act("resolve", { thread: mine_.block.id }, beansR)).toMatchObject({ lifecycle: "resolved" });
    key(char("l"));
    await act("comment.close", {}, beansR);
  });

  test("with an agent's thread list open, the person's x doesn't resolve; e enters it", async () => {
    const open = async () => (await threads(notes.beans.id)).filter(t => t.lifecycle === "open").map(t => t.block.id).sort();
    const before = await open();
    expect(before.length).toBeGreaterThan(0);
    // The agent lists threads in the column while the person is in the Library; then they come to it.
    key(char("h"));
    await act("threads", {}, beansR);
    key(char("l"));
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

  test("after the person moves away, coming back by h l doesn't put their keys in the edit", async () => {
    key(char("e"));                                              // the person's own edit in the beans column
    await until(() => !!surfaceOf(2).draft, "the draft");
    key(char("x"));                                              // in it: x is typed
    expect(surfaceOf(2).draft.text).toContain("x");
    // An agent doesn't move their keys out of their edit (the actor rule); the person's own move does.
    await expect(act("tile.focus", {}, lib())).rejects.toThrow(/not moved/);
    await mine("tile.focus", {}, lib());
    expect(V().focus).toBe(0);
    key(char("l"));
    expect(V().focus).toBe(1);
    const before = surfaceOf(2).draft.text;
    key(char("q"));
    expect(surfaceOf(2).draft.text).toBe(before);
    expect(screen()).toContain("enter the edit");
    key({ kind: "enter" }); key({ kind: "esc" }); key({ kind: "esc" });
    expect(surfaceOf(2).draft).toBeNull();
  });

  test("in the Library the selected note is the one e and C act on", async () => {
    expect(await act("column.select", { id: notes.squash.id }, lib())).toMatchObject({ selected: notes.squash.id });
    await until(() => surfaceOf(1).msg?.id === notes.squash.id, "the Library's note");
    expect(await act("edit.text", { text: "Plant the squash [stage::queued]\nBy the compost heap, in June." }, lib())).toMatchObject({ dirty: true });
    expect(surfaceOf(1).draft.blockId).toBe(notes.squash.id);
    await expect(act("tile.close", {}, lib())).rejects.toThrow(/edit|keeps/);
    expect(await act("edit.save", {}, lib())).toMatchObject({ saved: true });
    expect((await current(notes.squash.id)).text).toContain("in June.");
  });

  test("a column keeps its name as columns open around it; an agent's edit carries on only in the column that holds it", async () => {
    const was = focused();
    const text = (await current(notes.beans.id)).text + "\nPositional.";
    expect(await act("edit.text", { text }, beansR)).toMatchObject({ dirty: true });
    // A column opens after the Library, before the beans: the beans column keeps its name, and the person's focus stays.
    const peas: any = await act("open", { id: notes.peas.id, from: lib() });
    expect(V().columns.map(c => V().name(c)).indexOf(peas.reader)).toBe(1);
    expect(focused()).toBe(was);
    await until(() => !!paneOf(peas.reader).root, "the peas column");
    expect(paneOf(peas.reader).surface.draft).toBeNull();
    expect(await act("edit.close", { discard: true }, beansR)).toMatchObject({ closed: true });
    expect(await act("tile.close", {}, peas.reader)).toMatchObject({ tile: peas.reader });
    expect(readerOf(notes.peas.id)).toBeUndefined();
  });

  test("an agent's up, link.follow and column.split leave the person's focus and column", async () => {
    const was = focused();
    const shoot: any = await act("open", { id: notes.shoot.id, from: beansR });
    expect(focused()).toBe(was);
    await until(() => !!paneOf(shoot.reader).root, "the shoot column");
    if (coverOf(shoot.reader) !== "full") expect(await act("tile.dock", { on: true }, shoot.reader)).toMatchObject({ docked: true });
    expect(focused()).toBe(was);
    expect(await act("up", {}, shoot.reader)).toMatchObject({ opened: notes.peas.id });
    expect(focused()).toBe(was);
    const peasR = readerOf(notes.peas.id)!;
    expect(peasR).toBeTruthy();
    await until(() => !!paneOf(peasR).root, "the parent's column");
    // The peas column may be squeezed now; docking widens it without moving the person.
    await act("tile.dock", { on: false }, shoot.reader);
    if (coverOf(peasR) !== "full") await act("tile.dock", { on: true }, peasR);
    expect(await act("link.follow", { n: 1 }, peasR)).toMatchObject({ opened: notes.beans.id });
    expect(focused()).toBe(was);
    await act("column.select", { id: notes.beans.id }, lib());
    const sp: any = await act("column.split", {}, lib());
    expect(V().stack(1).map(c => V().name(c))).toEqual([lib(), sp.tile]);
    expect(focused()).toBe(was);
    await act("tile.close", {}, sp.tile);
    expect(V().stack(1)).toHaveLength(1);
  });

  test("clicking or wheeling a card clears a selected link, so ⏎ opens the clicked card", async () => {
    const peasR = readerOf(notes.peas.id)!, p = paneOf(peasR);
    await until(() => (p.items?.length ?? 0) >= 2, "the peas replies");
    await mine("tile.focus", {}, lib());
    await act("tile.widen", {}, peasR);
    await act("link.select", { n: 1 }, peasR);
    expect(p.surface.describe().links.some(l => l.selected)).toBe(true);
    screen();
    const r = river.rectOf(p)!, rows = screen().split("\n");
    const other = p.sel === 0 ? 1 : 0, title = p.flat()[other]!.m.text.split("\n")[0]!;
    const y = rows.findIndex((l, i) => i > r.row && i < r.row + r.rows && l.slice(r.col, r.col + r.cols).includes(title));
    key({ kind: "mouse", action: "down", button: 0, x: r.col + 3, y }); key({ kind: "mouse", action: "up", button: 0, x: r.col + 3, y });
    expect(p.sel).toBe(other);
    expect(p.surface.describe().links.some(l => l.selected)).toBe(false);
    const clicked = p.flat()[other]!.m.id;
    key({ kind: "enter" });
    await until(() => (focused().source as { id?: string }).id === clicked, "the clicked card's column");
    // The wheel too.
    await mine("tile.focus", {}, lib());
    await act("link.select", { n: 1 }, peasR);
    screen();
    const r2 = river.rectOf(p)!;
    key({ kind: "mouse", action: "wheel-down", button: 0, x: r2.col + 2, y: r2.row + 2 });
    expect(p.surface.describe().links.some(l => l.selected)).toBe(false);
  });

  test("a property notice and an agent line in a column the person isn't in clear once shown a while", async () => {
    const peasR = readerOf(notes.peas.id)!, p = paneOf(peasR);
    await mine("tile.focus", {}, lib());
    if (coverOf(peasR) !== "full") await act("tile.dock", { on: true }, peasR);
    const text = (await current(notes.peas.id)).text.replace("Sow the peas", "Sow the peas [stage::doing]");
    await act("edit.text", { text }, peasR);
    expect(await act("edit.save", {}, peasR)).toMatchObject({ saved: false });   // the property warning first
    expect(await act("edit.save", {}, peasR)).toMatchObject({ saved: true });
    expect(screen()).toContain("properties changed: +stage=doing");
    expect(screen()).toContain(`an agent (${AS}) saved this note`);
    expect(focused()).not.toBe(p);
    key(char("j"));                                              // elsewhere, and not long after: still there
    expect(screen()).toContain("properties changed: +stage=doing");
    (p as unknown as { shown: { at: number } }).shown.at -= BANNER_MS;
    key(char("k"));
    expect(screen()).not.toContain("properties changed: +stage=doing");
    expect(screen()).not.toContain(`an agent (${AS}) saved this note`);
    await act("tile.dock", { on: false }, peasR);
  });

  test("another client's save marks the column's draft, never replaces it; leaving copies it out", async () => {
    readOnReader(beansR);
    await act("edit.text", { text: (await current(notes.beans.id)).text + "\nMine, unsaved." }, beansR);
    const now = await current(notes.beans.id);
    await other.request("update", { blockId: notes.beans.id, text: now.text.replace("Canes", "Hazel canes"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "other-writer" } });
    const s = paneOf(beansR).surface as any;
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

  test("a column shows the whole note and scrolls like a reader; it jumps to a reply only when you move to it (PIE-465)", async () => {
    const lines = Array.from({ length: 70 }, (_, i) => `Row ${i + 1} of the long seed list.`);
    const long = await create(null, `The long seed list\n${lines.join("\n")}`);
    await create(long.id, "Order more\nFrom the usual place.");
    const r = (await act("open", { id: long.id })) as { reader: string };
    await mine("tile.focus", {}, r.reader);                           // the person goes to it
    await act("tile.widen", {}, r.reader);
    const p = paneOf(r.reader);
    await until(() => (p.items?.length ?? 0) >= 1, "the long note's reply");
    let s = screen();
    expect(s).toContain("Row 1 of the long seed list.");     // opens at the top of the note, not at its reply
    expect(p.top).toBe(0);
    // The wheel scrolls the column by lines, to the end of the note.
    const rect = river.rectOf(p)!;
    for (let i = 0; i < 30; i++) key({ kind: "mouse", action: "wheel-down", button: 0, x: rect.col + 2, y: rect.row + 2 });
    s = screen();
    expect(s).toContain("Row 70 of the long seed list.");
    const scrolled = p.top;
    expect(scrolled).toBeGreaterThan(0);
    expect(p.sel).toBe(0);                                     // scrolling moved no selection
    screen();
    expect(p.top).toBe(scrolled);                               // a repaint leaves the scroll alone
    // Page keys scroll too.
    key({ kind: "pgup" }); screen();
    expect(p.top).toBeLessThan(scrolled);
    key({ kind: "home" }); key({ kind: "pgdn" }); screen();
    expect(p.top).toBeGreaterThan(0);
  });

  test("an agent's filter and same-property column work through act, are said on the status bar, and leave the person's keys where they are", async () => {
    focusOnReader(lib());                                        // the person's keys on the Library
    const was = focused();
    // The column the person has the keys in is theirs: its filter, scroll and cursor aren't an agent's to move.
    await expect(act("column.filter", { query: "squash" }, lib())).rejects.toThrow("has the person's keys");
    await expect(act("column.scroll", { by: 3 }, lib())).rejects.toThrow("has the person's keys");
    await expect(act("column.select", { by: 1 }, lib())).rejects.toThrow("has the person's keys");
    // A column of its own (peas lists its two replies): filtered, said on the status bar.
    const own = (await act("open", { id: notes.peas.id, from: lib(), fresh: true })) as { reader: string };
    await until(() => (paneOf(own.reader).items?.length ?? 0) === 2, "the peas' replies");
    const out = (await act("column.filter", { query: "Thin" }, own.reader)) as { filter: string; listed: number };
    expect(out.filter).toBe("Thin");
    expect(out.listed).toBe(1);
    expect((app as any).message).toContain(`an agent (${AS}) filtered`);
    expect(focused()).toBe(was);
    expect(river.holdsKeys()).toBe(false);                       // the person's filter input was never opened
    await act("tile.close", {}, own.reader);
    // search lists notes; open from= puts one in the next column, the person's focus stays.
    const found = (await act("search", { query: "Plant the squash" })) as { hits: { id: string }[] };
    expect(found.hits[0]!.id).toBe(notes.squash.id);
    const opened = (await act("open", { id: notes.squash.id, from: lib(), fresh: true })) as { reader: string };
    expect(paneOf(opened.reader).source).toMatchObject({ kind: "block", id: notes.squash.id });
    expect(focused()).toBe(was);
    await act("tile.close", {}, opened.reader);
    // Picking a note by id there is moving their cursor too (round 3, H1): refused, their selection as it was.
    const lib0 = column(1), before = lib0.sel;
    const other = lib0.flat().find((r: { m: { id: string } }, i: number) => i !== before)!.m.id;
    await expect(act("column.select", { id: other }, lib())).rejects.toThrow(/has the person's keys; an agent doesn't move their cursor there/);
    expect(lib0.sel).toBe(before);
    // tag: a #queued column (the stage named, since the Library's selection is the person's), beside the Library; the person stays on it.
    const tag = (await act("column.tag", { key: "stage", value: "queued" }, lib())) as { tile: string; value: string };
    expect(tag.value).toBe("queued");
    expect(paneOf(tag.tile).titleOf()).toBe("#queued");
    expect(focused()).toBe(was);
    await act("tile.close", {}, tag.tile);
    // back is the person's: an agent's is refused, with its way (open beside) named.
    await expect(act("tile.travel", {}, lib())).rejects.toThrow("an agent opens beside");
  });

  test("the person's / filters this column and # offers the note's properties; both end in the same actions as an agent's", async () => {
    readOnReader(lib());
    key(char("/")); type("squash");
    expect(river.holdsKeys()).toBe(true);                        // typing a filter holds the keys
    expect(screen()).toContain("type:hub -status:done author:codex word");
    key({ kind: "enter" });
    await until(() => focused().filter.length === 1, "the filter");
    expect(river.holdsKeys()).toBe(false);
    key(char("/"));
    for (let i = 0; i < 10; i++) key({ kind: "backspace" });
    key({ kind: "enter" });
    await until(() => focused().filter.length === 0, "the filter cleared");
    // #: the selected note's properties to follow (same property), or why there are none.
    await expect(act("column.select", { id: notes.squash.id }, lib())).rejects.toThrow("has the person's keys");
    await mine("column.select", { id: notes.squash.id }, lib());
    key(char("#"));
    expect(screen()).toContain("same property");
    expect(screen()).toContain("stage:: queued");                 // in the hint row
    key({ kind: "esc" });
    await mine("column.select", { id: notes.peas.id }, lib());
    key(char("#"));
    expect(screen()).toContain("this note has no properties to follow");
    key({ kind: "esc" });
    expect(river.holdsKeys()).toBe(false);
  });

  test("in a note column f and ( ) fold and [ ] move between its elements, as in every reader", async () => {
    const r = readerOf(notes.peas.id)!;
    await mine("tile.focus", {}, r);
    await mine("tile.widen", {}, r);
    screen();
    const s = paneOf(r).surface as any;
    key(char("]"));
    expect(s.describe().links.some((l: any) => l.selected) || s.currentKind() !== null).toBe(true);
    key(char("["));
    key({ kind: "esc" });
    key(char("f"));                                              // the folds key, never the filter now
    expect(focused().mode).toBe("");
    expect(river.holdsKeys()).toBe(false);
  });

  test("a note column folds as a reader does: fold n=1 hides its section; ( ) f and a click on the heading unfold it (round 3, W4)", async () => {
    const plan = await create(null, "Garden plan\nWhat goes where.\n\n## Beds\nCarrots by the shed, leeks by the gate.\n\n## Paths\nGravel between the beds.");
    const o: any = await act("open", { id: plan.id, from: lib() });
    const r = o.reader as string;
    await until(() => !!paneOf(r).root, "the plan column");
    await mine("tile.focus", {}, r);
    await mine("tile.widen", {}, r);
    expect(screen()).toContain("Carrots by the shed");
    const done: any = await act("fold", { n: 1 }, r);
    expect(done.foldedNow).toEqual([expect.stringContaining("Beds")]);
    let text = screen();
    expect(text).not.toContain("Carrots by the shed");
    expect(text).toContain("Beds");
    expect(text).toContain("Gravel between the beds.");     // the next section is drawn
    // The person's keys: ( selects a fold point, f toggles it, as in every reader.
    const s = paneOf(r).surface as any;
    key(char("("));
    expect(s.describe().folds.selected).toBeTruthy();
    while (!String(s.describe().folds.selected).includes("Beds")) key(char(")"));
    key(char("f"));
    await until(() => !s.folded.size, "unfolded by f");
    expect(screen()).toContain("Carrots by the shed");
    // The mouse: a click on the heading folds it (press and release on the same cell).
    const col = paneOf(r) as any, row = col.rows.findIndex((h: any) => h.fold);
    expect(row).toBeGreaterThanOrEqual(0);
    const y = row + col.headRows;
    col.mouse({ kind: "mouse", action: "down", button: 0, x: 2, y }, 2, y, river);
    col.mouse({ kind: "mouse", action: "up", button: 0, x: 2, y }, 2, y, river);
    await until(() => s.folded.size === 1, "folded by a click");
    text = screen();
    expect(text).not.toContain("Carrots by the shed");
    await act("unfold", { all: true }, r);
    await mine("tile.close", {}, r);
  });

  test("the Library stays (the river is made around it), so a restarted river comes back with its columns (round 3, B-M2)", async () => {
    const o: any = await act("open", { id: notes.squash.id, from: lib() });
    await until(() => !!paneOf(o.reader).root, "the squash column");
    await expect(act("tile.close", {}, lib())).rejects.toThrow(/library stays: its place \(g\d+\) keeps it \(closable off\)/);
    await expect(mine("tile.close", {}, lib())).rejects.toThrow(/closable off/);
    // The hint row offers x only where it closes something: in the note column, not in the Library.
    const hintRow = () => screen().split("\n").find(l => l.includes("h l columns")) ?? "";
    await mine("tile.focus", {}, o.reader);
    expect(hintRow()).toContain("x close");
    await mine("tile.focus", {}, lib());
    expect(hintRow()).toContain("h l columns");
    expect(hintRow()).not.toContain("x close");
    expect(await act("layout.policy", {}, lib())).toMatchObject({ effective: { closable: false } });   // the spec says it, as policy
    (river as any).save();
    // The river opened again, as a restarted door does: its saved columns come back.
    const again = openScreen("river") as Desk;
    const titles = view(again).columns.map(c => view(again).name(c));
    expect(titles).toContain("library");
    expect(titles).toContain(o.reader);
    expect((again as any).policyAt((again as any).idNamed("library")).closable).toBe(false);
    await act("tile.close", {}, o.reader);
  });
});

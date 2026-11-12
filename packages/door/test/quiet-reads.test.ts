// PIE-1772: an agent that only reads the person's layout says nothing on their screen (writes still say who did them),
// and closing a reader whose opens land in an empty detail beside it hands that detail its note, so the note stays on
// screen. The door as Evan has it at 44×30, keys typed as he types them; a scratch outline, made-up notes and agents.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
import type { LNode } from "../src/desk/layout";
import { apply, init, type Ctx, type TileFacts } from "../src/desk/screen-layout";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });

describe.skipIf(!outliner)("quiet reads and a close that keeps its note (PIE-1772)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, key: (k: Key) => void = () => {};
  const n = {} as { bees: { id: string }; honey: { id: string } };
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })) as { id: string };
  const message = () => String((app as any).message ?? "");
  const paint = () => (app as any).paint();

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.honey = await create("Jar the honey\nWarm the jars first.");
    n.bees = await create(`Check the hives [apiary::north]\nLift each frame; then ((${n.honey.id})).`);
    const term = { info: { cols: 44, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  /** The detail screen on `note`, as `ep0ch --screen detail <id>` opens it, at 44×30. */
  async function detailOn(note: string): Promise<Desk> {
    const desk = openScreen("detail", { note, persist: false }) as Desk;
    app.push(desk);
    await until(() => (desk as any).layoutGet().tiles.some((t: any) => t.name === "detail" && t.showing?.id === note), "the note in its detail");
    paint();
    return desk;
  }
  const tiles = (desk: Desk) => (desk as any).layoutGet().tiles.map((t: any) => ({ ...t, note: t.showing?.id as string | undefined })) as { tile: string; name: string; kind: string; note?: string }[];

  test("an agent reading the layout says nothing on screen; its write is said with who did it", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      (app as any).flash("the person's own words");
      const reads = async () => {
        for (const action of ["layout.get", "view.get", "layout.list", "tile.menu", "marks.list"]) {
          await app.act({ action, args: {}, ...(action === "tile.menu" ? { tile: "detail" } : {}), as: "hive-reader" });
          expect({ action, said: message() }).toEqual({ action, said: "the person's own words" });
        }
      };
      await reads();
      // Quiet in yolo too: the person handing the door over doesn't make loki's every layout.get a flash again.
      await app.dispatch.act({ action: "agents.yolo", args: { on: true } }, { kind: "user" });
      (app as any).flash("the person's own words");
      try { await reads(); } finally { await app.dispatch.act({ action: "agents.yolo", args: { on: false } }, { kind: "user" }); }
      // A read says what it is: `actions` lists it as one, so an agent (and the action pages) can tell before calling.
      const listed = desk.dispatch.list().actions.find(a => a.name === "layout.get");
      expect(listed?.reads).toBe(true);
      expect(desk.dispatch.list().actions.find(a => a.name === "tile.close")?.reads).toBeUndefined();
      // A write is still said, and names the agent.
      await app.act({ action: "tile.title", args: { text: "hives" }, tile: "detail", as: "hive-reader" });
      expect(message()).toContain("an agent (hive-reader)");
    } finally { app.pop(); }
  }, 20_000);

  test("^W v then ^W x on the reader: the detail beside it takes its note, the note stays on screen", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      // A stop behind it first: the honey note opened in the reader, the hives a step back (kept beside it as a spine).
      await desk.dispatch.act({ action: "open", args: { id: n.honey.id }, tile: "detail" }, { kind: "user" });
      await until(() => tiles(desk).find(t => t.name === "detail")?.note === n.honey.id, "the reader on the honey note");
      const reader = tiles(desk).find(t => t.name === "detail")!;
      key(ctrl("w")); key(char("v")); paint();
      const preview = tiles(desk).find(t => t.name === "detail-preview")!;
      expect(preview?.note).toBeUndefined();                          // empty: it keeps what's opened into it
      key(ctrl("w")); key(char("x")); paint();
      const heir = () => tiles(desk).find(t => t.tile === preview.tile);
      expect(tiles(desk).some(t => t.tile === reader.tile)).toBe(false);   // the reader closed, the detail stays
      expect(heir()?.note).toBe(n.honey.id);                                // with the note it held
      expect(message()).not.toContain("empty");
      // And its trail: back (alt+← in it) goes where the reader's went, forward comes back.
      await desk.dispatch.act({ action: "tile.focus", args: {}, tile: preview.name }, { kind: "user" });
      key({ kind: "alt-left" } as Key); paint();
      await until(() => heir()?.note === n.bees.id, "back to the hives in the detail");
      key({ kind: "alt-right" } as Key); paint();
      await until(() => heir()?.note === n.honey.id, "forward to the honey again");
      // Undone: the reader is back with its note (the detail keeps what it was handed: layout.undo takes back shapes, not opens).
      await desk.dispatch.act({ action: "layout.undo", args: {} }, { kind: "user" });
      await until(() => tiles(desk).some(t => t.name === "detail" && t.note === n.honey.id), "the reader back with its note");
    } finally { app.pop(); }
  }, 20_000);

  test("a detail already showing a note keeps it when the reader that opened it closes", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      key(ctrl("w")); key(char("v")); paint();
      await desk.dispatch.act({ action: "link.follow", args: { n: 1 }, tile: "detail" }, { kind: "user" });
      await until(() => tiles(desk).find(t => t.name === "detail-preview")?.note === n.honey.id, "the link in the detail beside");
      await desk.dispatch.act({ action: "tile.focus", args: {}, tile: "detail" }, { kind: "user" });   // the keys back on the reader, as a click there gives them
      key(ctrl("w")); key(char("x")); paint();
      expect(tiles(desk).map(t => t.note)).toEqual([n.honey.id]);
    } finally { app.pop(); }
  }, 20_000);

  test("an agent closing the reader beside the empty detail the person is in hands it nothing: their reader stays as it is", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      key(ctrl("w")); key(char("v")); paint();
      await desk.dispatch.act({ action: "tile.focus", args: {}, tile: "detail-preview" }, { kind: "user" });   // the person's keys in the empty detail
      await app.act({ action: "tile.close", args: {}, tile: "detail", as: "hive-closer" });
      expect(tiles(desk).map(t => [t.name, t.note])).toEqual([["detail-preview", undefined]]);
      expect(message()).toContain("an agent (hive-closer)");
    } finally { app.pop(); }
  }, 20_000);

  // Codex on #1472 (loki, Nov 12): a read stays a read in everything it does, not only in the toast.
  test("an agent's reads leave the person's hint card, the menu and the status line alone, yolo or not", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      // A hint card the person has up stays up through an agent's polling (beforeAction cleared it for any action).
      await desk.dispatch.act({ action: "hints.set", args: { id: "hint.show", to: "card" } }, { kind: "user" });
      await desk.dispatch.act({ action: "hint.show", args: { text: "Lift the frames slowly" } }, { kind: "user" });
      expect((desk as any).hintCard).toBeTruthy();
      await app.act({ action: "layout.get", args: {}, as: "hive-reader" });
      expect((desk as any).hintCard).toBeTruthy();
      // Reads that say something to the person themselves (status.speed, share.list) say nothing for an agent.
      (app as any).flash("the person's own words");
      for (const action of ["status.speed", "share.list"]) {
        await app.act({ action, args: {}, as: "hive-reader" }).catch(() => {});
        expect({ action, said: message() }).toEqual({ action, said: "the person's own words" });
      }
      // props.copy is a read: an agent gets the value and nothing is said or copied.
      expect(desk.dispatch.list().actions.find(a => a.name === "props.copy")?.reads).toBe(true);
      expect(await app.act({ action: "props.copy", args: { key: "apiary" }, tile: "detail", as: "hive-reader" })).toMatchObject({ key: "apiary", value: "north" });
      expect(message()).toBe("the person's own words");
      // In yolo an agent's tile.menu is still data: no menu opens over the person's keys.
      await app.dispatch.act({ action: "agents.yolo", args: { on: true } }, { kind: "user" });
      try {
        const overlays = (desk as any).overlays.length;
        const menu = await app.act({ action: "tile.menu", args: {}, tile: "detail", as: "hive-reader" }) as { open?: boolean; rows: unknown[] };
        expect(menu.rows.length).toBeGreaterThan(0);
        expect(menu.open).toBeUndefined();
        expect((desk as any).overlays.length).toBe(overlays);
      } finally { await app.dispatch.act({ action: "agents.yolo", args: { on: false } }, { kind: "user" }); }
    } finally { app.pop(); }
  }, 20_000);

  test("the detail in the drawer takes the note too: the heir is found where opens land, across desks", async () => {
    const desk = await detailOn(n.bees.id);
    try {
      key(ctrl("w")); key(char("v")); paint();
      const preview = tiles(desk).find(t => t.name === "detail-preview")!;
      await desk.dispatch.act({ action: "tile.drawer", args: {}, tile: preview.name }, { kind: "user" });
      await app.dispatch.act({ action: "host.toggle", args: { open: true } }, { kind: "user" });
      paint();
      await desk.dispatch.act({ action: "tile.focus", args: {}, tile: "detail" }, { kind: "user" });
      await desk.dispatch.act({ action: "tile.close", args: {}, tile: "detail" }, { kind: "user" });
      paint();
      const inDrawer = () => ((app.drawer.desk as any).layoutGet().tiles as any[]).find(t => t.tile === preview.tile);
      await until(() => inDrawer()?.showing?.id === n.bees.id, "the note in the drawer's detail");
    } finally {
      await app.dispatch.act({ action: "host.toggle", args: { open: false } }, { kind: "user" }).catch(() => {});
      await app.drawer.desk?.dispatch.act({ action: "tile.close", args: {}, tile: "detail-preview" }, { kind: "user" }).catch(() => {});
      app.pop();
    }
  }, 20_000);

  test("an agent's close in a desk the person's keys aren't in hands the note to its remembered focus", () => {
    const tree = { t: "split", dir: "row", weights: [0.5, 0.5], kids: [{ t: "leaf", id: 1 }, { t: "leaf", id: 2 }] } as unknown as LNode<number>;
    const s = init({ tree, names: new Map([[1, "reader"], [2, "preview"]]), wires: [{ from: 1, verb: "open", to: 2 }] });
    const facts = (id: number): TileFacts => (id === 1 ? { kind: "reader", notes: true, showing: "note-hives" } : { kind: "reader", notes: true });
    const ctx = (here: boolean): Ctx<number> => ({ actor: { kind: "agent", id: "hive-closer" }, standing: false, protectTyping: true, area: { col: 0, row: 0, cols: 88, rows: 30 }, tile: facts, person: { focus: 2, typingIn: null, busy: false, here }, kinds: { all: ["reader"], notes: ["reader"] } });
    const close = (here: boolean) => { const r = apply(s, { op: "close", tile: 1, heir: true }, ctx(here)); return r.ok ? r.answer.heir : `refused: ${r.refused}`; };
    expect(close(false)).toBe("preview");      // the person is elsewhere: the remembered focus is no one's keys
    expect(close(true)).toBeUndefined();        // the person's keys are in it: an agent hands it nothing
  });
});

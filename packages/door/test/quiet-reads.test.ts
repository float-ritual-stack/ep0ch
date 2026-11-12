// PIE-1772: an agent that only reads the person's layout says nothing on their screen (writes still say who did them),
// and closing a reader whose opens land in an empty detail beside it hands that detail its note, so the note stays on
// screen. The door as Evan has it at 44×30, keys typed as he types them; a scratch outline, made-up notes and agents.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Desk } from "../src/desk/desk";
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
    n.bees = await create(`Check the hives\nLift each frame; then ((${n.honey.id})).`);
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
});

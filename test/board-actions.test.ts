// PIE-506: the board's keys and clicks are actions, and agents run the same ones without taking the
// person's keys. The hub picker is `board.hub`; the lane cursor is `card.select`; lanes, the outline
// drawer, floats and the backlinks rows have theirs. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { boardScreen } from "./board-view";
import type { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import { traceActions } from "../src/surface/actions";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const char = (ch: string): Key => ({ kind: "char", ch });

describe.skipIf(!outliner)("the board's actions, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: Desk, garden: any, kitchen: any;
  let key: (k: Key) => void = () => {};
  const AS = "board-agent-506";
  const B = () => BV.view(b);
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, as: AS, ...(reader ? { tile: reader } : {}) });
  const message = () => (app as any).message as string;
  const ran = (f: () => void) => { const names: string[] = []; const stop = traceActions(r => names.push(r.name)); try { f(); } finally { stop(); } return names; };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    for (const [t, s] of [["Sow the beans", "todo"], ["Turn the compost", "todo"], ["Mend the gate", "done"], ["Oil the shears", "done"]]) await make(null, `${t} [type::job] [area::garden] [stage::${s}]`);
    await make(null, "Descale the kettle [type::job] [area::kitchen] [stage::todo]");
    garden = await make(null, "Garden jobs");
    await make(garden.id, "To do [type::virtual-branch] [query::type=job area=garden stage=todo]");
    await make(garden.id, "Done [type::virtual-branch] [query::type=job area=garden stage=done]");
    kitchen = await make(null, "Kitchen jobs");
    await make(kitchen.id, "To do [type::virtual-branch] [query::type=job area=kitchen stage=todo]");
    await make(kitchen.id, "Done [type::virtual-branch] [query::type=job area=kitchen stage=done]");
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    b = boardScreen(garden.id, false);
    app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("an agent's board.hub lists the boards without opening the picker; with id it shows that board, said on screen", async () => {
    const r: any = await act("board.hub");
    expect(r.current).toBe(garden.id);
    expect(r.hubs.map((h: any) => h.title).sort()).toEqual(["Garden jobs", "Kitchen jobs"]);
    expect(B().hubPicker).toBeNull();
    const s: any = await act("board.hub", { id: kitchen.id });
    expect(s.title).toBe("Kitchen jobs");
    expect(B().hub.id).toBe(kitchen.id);
    expect(message()).toContain(`an agent (${AS})`);
    expect(message()).toContain("Kitchen jobs");
    await expect(act("board.hub", { id: (await board.request<any>("create", { parentId: null, text: "Not a board" })).id })).rejects.toThrow("isn't a board");
  });

  test("the board's open takes from= (E2): a tile's link is honoured, unlinked it lands in the detail, an unknown tile is named", async () => {
    const card = B().lanes[0].items[0];
    await expect(act("open", { id: card.id, from: "nowhere" })).rejects.toThrow(/no tile nowhere/);
    const tiles = (await act("layout.get") as any).tiles as any[];
    // A lane's opens land in the readers row (the screen's opensInto), as its ⏎ does: from= a lane, a detail there.
    const lane = tiles.find(t => t.kind === "query")!;
    expect(await act("open", { id: card.id, from: lane.name })).toMatchObject({ reader: expect.stringMatching(/^detail/), id: card.id });
    // An unlinked tile (the outline drawer's tree): where the board's own open puts a note, its detail.
    expect(tiles.find(t => t.name === "tree").link ?? null).toBeNull();
    const unlinked = await act("open", { id: card.id, from: "tree" }) as any;
    expect(unlinked.id).toBe(card.id);
    expect(unlinked.reader).toMatch(/^detail/);
    expect(message()).toContain(`an agent (${AS})`);
  });

  test("an agent's open naming no reader (`ep0ch open <id>`) lands in a detail and leaves the person's keys where they are", async () => {
    const card = B().lanes[0].items[0];
    BV.at(b, "preview");
    const focus = BV.where(b);
    const r = await act("open", { id: card.id }) as any;
    expect(r.id).toBe(card.id);
    expect(r.reader).toMatch(/^detail/);
    expect(BV.where(b)).toBe(focus);
    expect(message()).toContain(`an agent (${AS})`);
  });

  test("the person's g is board.hub: the picker holds the keys, and ⏎ on a board runs board.hub with its id", async () => {
    expect(ran(() => key(char("g")))).toEqual(["board.hub"]);
    await until(() => !!B().hubPicker, "the picker");
    expect(b.holdsKeys()).toBe(true);
    // While the person picks, an agent doesn't switch the board under them.
    await expect(act("board.hub", { id: garden.id })).rejects.toThrow("typing");
    const i = B().hubPicker.items.findIndex((x: any) => x.hub.id === garden.id);
    while (B().hubPicker.sel < i) key(char("j"));
    while (B().hubPicker.sel > i) key(char("k"));
    expect(ran(() => key({ kind: "enter" }))).toEqual(["board.hub"]);
    await until(() => B().hub?.id === garden.id && B().lanes.every((l: any) => l.items), "the garden board");
    expect(B().hubPicker).toBeNull();
    // The lanes are the garden's, read again (both boards name their lanes the same: their cards tell them apart).
    await until(() => B().lanes.some((l: any) => l.items?.some((m: any) => m.text.startsWith("Sow the beans"))), "the garden's cards in its lanes");
    // esc puts the picker away as it was (board.hub close=true), the person's own.
    key(char("g")); await until(() => !!B().hubPicker, "the picker");
    expect(ran(() => key({ kind: "esc" }))).toEqual(["board.hub"]);
    expect(B().hubPicker).toBeNull();
    expect(B().hub.id).toBe(garden.id);
    await expect(act("board.hub", { close: true })).rejects.toThrow("the person's");
  });

  test("the lane cursor is card.select: the person's keys move it; an agent's step moves only its own selection", async () => {
    B().lane = 0; B().lanes[0].sel = 0; BV.at(b, "lanes");
    expect(ran(() => key(char("j")))).toEqual(["card.select"]);
    expect(B().lanes[0].sel).toBe(1);
    expect(ran(() => key(char("l")))).toEqual(["card.select"]);
    expect(B().lane).toBe(1);
    key(char("h")); key(char("k"));
    const before = { lane: B().lane, sel: B().lanes[0].sel, preview: B().preview.msg?.id };
    const r: any = await act("card.select", { by: 1 });
    expect(r.selected).toBeTruthy();
    expect({ lane: B().lane, sel: B().lanes[0].sel, preview: B().preview.msg?.id }).toEqual(before);
    expect(message()).toContain("your cursor stays");
    // An agent's own card in the other lane: its next step goes on from there, not from that lane's top.
    const other = B().lanes[1].items;
    expect(other.length).toBeGreaterThan(1);
    {
      await act("card.select", { id: other[0].id });
      const step: any = await act("card.select", { by: 1 });
      expect(step.selected).toBe(other[1].id);
    }
    // The person's tab moves the keys without saying so (only an agent's focus is said).
    (app as any).message = "";
    key({ kind: "tab" });
    expect(message()).not.toContain("gave the keys");
    key({ kind: "esc" });
  });

  test("the wheel over another lane moves that lane's cursor only: the current lane and the keys stay", () => {
    B().lane = 0; BV.at(b, "lanes"); B().lanes[1].sel = 0;
    b.render(B().ctx);
    const r = BV.rectOf(b, B().lanes[1].name);
    expect(ran(() => key({ kind: "mouse", action: "wheel-down", button: 0, x: r.col + 2, y: r.row + 2 }))).toEqual(["card.select"]);
    expect(B().lanes[1].sel).toBe(Math.min(1, B().lanes[1].items.length - 1));
    expect(B().lane).toBe(0);
  });

  test("d d is card.trash: the first d arms it (no confirm), the second trashes; an agent always says confirm", async () => {
    await expect(act("card.trash", {})).rejects.toThrow("confirm");
    B().lane = 0; B().lanes[0].sel = 0; BV.at(b, "lanes");
    const id = B().lanes[0].items[0].id;
    expect(ran(() => key(char("d")))).toEqual(["card.trash"]);
    await until(() => B().trashArm?.id === id, "armed");
    expect(b.holdsKeys()).toBe(false);
    expect(ran(() => key(char("d")))).toEqual(["card.trash"]);
    await until(() => B().trashed?.id === id, "trashed");
    expect(ran(() => key(char("u")))).toEqual(["card.restore"]);
    await until(() => !B().trashed, "restored");
  });

  test("lanes collapse, the outline drawer opens and floats move by actions; an agent's leaves the person's keys", async () => {
    // The lane's own action, which folds its tile by the desk's.
    expect(ran(() => key(char("c")))).toEqual(["lane.collapse", "tile.collapse"]);
    expect(B().collapsed.size).toBe(1);
    await act("lane.collapse", { on: false, lane: "To do" });
    expect(B().collapsed.size).toBe(0);
    expect(message()).toContain("opened the lane To do");
    await act("tile.drawer", { open: true }, "tree");
    expect(B().treeOpen).toBe(true);
    expect(BV.where(b)).toBe("lanes");
    await act("tile.drawer", { open: false }, "tree");
    expect(ran(() => key(char("t")))).toEqual(["tile.drawer"]);
    expect(BV.where(b)).toBe("tree");
    await expect(act("tile.drawer", { open: false }, "tree")).rejects.toThrow(/the person|their keys|keys/);
    key({ kind: "esc" });
    expect(B().treeOpen).toBe(false);
    // A float: o on the preview pops a copy out; H J K L move it by float.place, as an agent's does.
    key({ kind: "tab" });
    await until(() => !!B().preview.msg, "the preview's note");
    expect(ran(() => key(char("o")))).toEqual(["tile.float"]);
    const at = () => { b.render(B().ctx); return B().rect("float0")!.col; }, col = at();
    expect(ran(() => key(char("L")))).toEqual(["float.place"]);
    expect(at()).toBe(col + 4);
    await act("float.place", { dx: -4 }, B().name(B().floats[0]));
    expect(at()).toBe(col);
    key(char("x"));
    expect(B().floats.length).toBe(0);
  });
});

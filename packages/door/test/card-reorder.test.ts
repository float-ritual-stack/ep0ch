// A lane's hand-set order (a view with no [sort::]): card.reorder by alt+↑ alt+↓, by a drag up or down its lane, and
// by `act`; `ep0ch view order` from a shell. Each against a scratch outline it starts itself, fictional cards only.
import { afterAll, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import type { Desk } from "../src/desk/desk";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { viewCommand } from "../src/view-cli";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import { outliner, Scratch, until } from "./scratch";

setDefaultTimeout(20_000);

describe.skipIf(!outliner)("a lane's hand-set order", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: Desk, queue: any, recent: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const B = () => BV.view(b) as any;
  const make = (parentId: string | null, text: string) => other.request("create", { parentId, text, author: "agent" });
  const lane = (name: string) => B().lanes.find((l: any) => l.name === name);
  const titles = (name: string) => (lane(name).items ?? []).map((m: Msg) => m.text.split(" [")[0]);
  const order = async () => (await other.viewOrder(queue.id)).blockIds;
  const settled = () => until(() => B().lanes.every((l: any) => l.items && !l.want), "lanes", 8000);
  const select = (name: string, title: string) => {
    BV.at(b, "lanes");
    B().lane = B().lanes.indexOf(lane(name)); lane(name).sel = titles(name).indexOf(title); B().follow();
  };
  const moves = async (author: "user" | "agent") => (await other.request("activity.recent", { author, kinds: ["move"], limit: 50 })).entries;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    other = new SocketBoard(board.path);
    await other.info();
    await other.request("work-ids.configure", { prefix: "SHED" });
    const hub = await make(null, "Shed jobs");
    queue = await make(hub.id, "Queue [type::virtual-branch] [query::type=shed-job]");
    recent = await make(hub.id, "Recent [type::virtual-branch] [query::type=shed-job] [sort::updated]");
    for (const t of ["Oil the hinges", "Sweep the floor", "Sort the screws", "Fix the window"]) cards[t] = await make(null, `${t} [type::shed-job]`);
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = boardScreen(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("alt+↓ and alt+↑ move the selected card down and up; the cursor stays on it; the person is recorded", async () => {
    expect(titles("Queue")).toEqual(["Oil the hinges", "Sweep the floor", "Sort the screws", "Fix the window"]);
    select("Queue", "Oil the hinges");
    key({ kind: "alt-down" });
    await until(() => titles("Queue")[1] === "Oil the hinges", "moved down");
    await settled();
    expect(lane("Queue").card().id).toBe(cards["Oil the hinges"].id);
    key({ kind: "alt-down" });
    await until(() => titles("Queue")[2] === "Oil the hinges", "moved down again");
    key({ kind: "alt-up" });
    await until(() => titles("Queue")[1] === "Oil the hinges", "moved up");
    expect(await order()).toEqual(["Sweep the floor", "Oil the hinges", "Sort the screws", "Fix the window"].map(t => cards[t].id));
    expect((await moves("user")).find((e: any) => e.block.id === cards["Oil the hinges"].id)).toMatchObject({ kind: "move", author: "user" });
  });

  test("a card dragged onto another's row in its lane goes there", async () => {
    await settled();
    b.render(B().ctx);
    const l = lane("Queue"), r = BV.rectOf(b, "Queue");
    const yOf = (title: string) => { for (let y = r.row + 1; y < r.row + r.rows; y++) if (l.items[l.rowAt(y - r.row - 1)]?.text.startsWith(title)) return y; throw new Error(`no row for ${title}`); };
    const from = yOf("Fix the window"), to = yOf("Sweep the floor"), x = r.col + 4;
    key({ kind: "mouse", action: "down", button: 0, x, y: from });
    key({ kind: "mouse", action: "drag", button: 32, x, y: to });
    expect(B().cardDrag?.onto).toBe(cards["Sweep the floor"].id);
    key({ kind: "mouse", action: "up", button: 0, x, y: to });
    await until(() => titles("Queue")[0] === "Fix the window", "dragged to the top");
    expect(titles("Queue")).toEqual(["Fix the window", "Sweep the floor", "Oil the hinges", "Sort the screws"]);
  });

  test("an agent's card.reorder is its own: recorded as the agent, the person's cursor stays on their card", async () => {
    await settled();
    select("Queue", "Sweep the floor");
    const answer: any = await app.act({ action: "card.reorder", args: { card: cards["Sort the screws"].id, to: 0 }, as: "shed-agent" });
    expect(answer).toMatchObject({ card: cards["Sort the screws"].id, lane: "Queue", position: 0, of: 4 });
    await until(() => titles("Queue")[0] === "Sort the screws", "the agent's reorder");
    await settled();
    expect(lane("Queue").card().id).toBe(cards["Sweep the floor"].id);
    expect((await moves("agent")).find((e: any) => e.block.id === cards["Sort the screws"].id)).toMatchObject({ actorId: "shed-agent" });
    await app.act({ action: "card.reorder", args: { card: cards["Sort the screws"].id, after: cards["Oil the hinges"].id }, as: "shed-agent" });
    expect(await order()).toEqual(["Fix the window", "Sweep the floor", "Oil the hinges", "Sort the screws"].map(t => cards[t].id));
    await expect(app.act({ action: "card.reorder", args: { card: cards["Sort the screws"].id, by: 1, to: 0 }, as: "shed-agent" })).rejects.toThrow("takes one of");
  });

  test("a sorted lane has no hand-set order: refused, naming the [sort::] to remove", async () => {
    await expect(app.act({ action: "card.reorder", args: { lane: "Recent", card: cards["Sort the screws"].id, by: -1 }, as: "shed-agent" }))
      .rejects.toThrow(`This view sorts by updated desc, so it has no hand-set order: remove [sort::updated] from ((${recent.id})) to order it by hand`);
  });

  test("the person's alt+↓ on a sorted lane says how to order it by hand, and nothing moves", async () => {
    await settled();
    const flashes: string[] = [], ctx = B().ctx, flash = ctx.flash;
    ctx.flash = (m: string, ...rest: unknown[]) => { flashes.push(m); return flash.call(ctx, m, ...rest); };
    try {
      select("Recent", titles("Recent")[0]);
      const before = titles("Recent");
      key({ kind: "alt-down" });
      await until(() => flashes.some(f => f.includes("so it has no hand-set order")), "the refusal");
      expect(flashes.find(f => f.includes("hand-set"))).toBe(`not reordered: This view sorts by updated desc, so it has no hand-set order: remove [sort::updated] from ((${recent.id})) to order it by hand`);
      expect(titles("Recent")).toEqual(before);
    } finally { ctx.flash = flash; }
  });

  test("a lane read again mid-drag: the drop goes by the cards' ids, not the rows they were on", async () => {
    await settled();
    b.render(B().ctx);
    const l = lane("Queue"), r = BV.rectOf(b, "Queue");
    const yOf = (title: string) => { for (let y = r.row + 1; y < r.row + r.rows; y++) if (l.items[l.rowAt(y - r.row - 1)]?.text.startsWith(title)) return y; throw new Error(`no row for ${title}`); };
    const start = titles("Queue"), dragged = start[3], onto = start[1], x = r.col + 4, over = yOf(onto);
    key({ kind: "mouse", action: "down", button: 0, x, y: yOf(dragged) });
    key({ kind: "mouse", action: "drag", button: 32, x, y: over });
    expect(B().cardDrag?.onto).toBe(cards[onto].id);
    // An agent puts the hovered card first while the person drags: the lane is read again, its rows shift.
    await other.moveInView({ view: queue.id, blocks: [cards[onto].id], to: 0 }, { kind: "agent", id: "shed-agent" });
    await until(() => titles("Queue")[0] === onto, "the lane read again mid-drag");
    // Released on the same row, which now holds another card: the drop is onto the card it was over, by id (now
    // first), above it.
    expect(yOf(onto)).not.toBe(over);
    key({ kind: "mouse", action: "up", button: 0, x, y: over });
    await until(() => titles("Queue")[0] === dragged, "dropped above the card it was over");
    expect(titles("Queue")[1]).toBe(onto);
  });

  test("ep0ch view order: lists the order, puts ids or Work IDs first, --json, --as", async () => {
    const out: string[] = [], err: string[] = [];
    const io = { out: (s: string) => out.push(s), err: (s: string) => err.push(s) };
    process.env.EP0CH_SOCKET = board.path;
    try {
      const window = await other.request("work-ids.allocate", { blockId: cards["Fix the window"].id, expectedRevision: (await other.get(cards["Fix the window"].id))!.revision });
      const workId = window.block.properties.find((p: any) => p.key === "work-id").value;
      expect(await viewCommand(["view", "order", queue.id, cards["Oil the hinges"].id, workId.toLowerCase(), "--as", "shell-agent", "--json", "--ws", "scratch"], io)).toBe(0);
      const json = JSON.parse(out.at(-1)!);
      const rest = titles("Queue").filter((t: string) => t !== "Oil the hinges" && t !== "Fix the window");
      expect(json.order.map((o: any) => o.title)).toEqual(["Oil the hinges", "Fix the window", ...rest]);
      expect(json.order[1]).toMatchObject({ workId });
      expect((await moves("agent")).find((e: any) => e.block.id === cards["Fix the window"].id)).toMatchObject({ actorId: "shell-agent" });
      expect(await viewCommand(["view", "order", `((${queue.id}))`, "--ws", "scratch"], io)).toBe(0);
      expect(out.at(-4)).toContain("Oil the hinges");
      expect(await viewCommand(["view", "order", recent.id, cards["Oil the hinges"].id, "--ws", "scratch"], io)).toBe(1);
      expect(err.at(-1)).toContain(`remove [sort::updated] from ((${recent.id}))`);
    } finally { delete process.env.EP0CH_SOCKET; }
  });
});

// PIE-510 (A1): the board's fixed shape is policy, not code kept by tile name. The preview and the lanes stay
// (draggable off, the preview closable off, read back by layout.policy and enforced by the desk's one close and
// move path; a lane closes only when its view goes, the desk's rule for a tile a source supplies);
// the drawers' lists stay in their drawers; a board saved before the shape was policy gets it when it loads;
// and a readers row taken apart (its policy changed so the preview could move) refuses a detail with the
// reason instead of throwing. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { DeliveryBoard } from "../src/desk/delivery";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { outliner, Scratch, until } from "./scratch";

const term = () => ({ info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} });

describe.skipIf(!outliner)("the board's fixed shape is policy", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, b: DeliveryBoard, garden: { id: string }, card: string;
  // An agent's, unless `as` is null: the person's (as their key runs it).
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string, as: string | null = "claude-7") =>
    as ? app.act({ action, args, as, ...(reader ? { reader } : {}) }) : b.dispatch.act({ action, args, ...(reader ? { reader } : {}) }, USER);
  const open = async (persist: boolean) => {
    app = new App(term() as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    b = new DeliveryBoard(garden.id, persist);
    app.push(b);
    await until(() => (b as any).lanes.length === 2 && (b as any).lanes.every((l: any) => l.items), "lanes", 10_000);
  };
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const make = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" }) as Promise<{ id: string }>;
    card = (await make(null, "Sow the beans [type::job] [area::garden] [stage::todo]")).id;
    await make(null, "Mend the gate [type::job] [area::garden] [stage::done]");
    garden = await make(null, "Garden jobs");
    await make(garden.id, "To do [type::virtual-branch] [query::type=job area=garden stage=todo]");
    await make(garden.id, "Done [type::virtual-branch] [query::type=job area=garden stage=done]");
    await open(true);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("layout.policy reads the preview's and the lanes' rules back, and the close and move paths keep them", async () => {
    const pv: any = await act("layout.policy", {}, "preview");
    expect(pv.effective).toMatchObject({ draggable: false, closable: false, droppable: false });
    const lane: any = await act("layout.policy", {}, "To-do");
    expect(lane.effective).toMatchObject({ draggable: false, accepts: ["query"] });
    await expect(act("tile.close", {}, "preview")).rejects.toThrow(/preview stays: .* \(closable off\)/);
    await expect(act("pane.close", {}, "preview")).rejects.toThrow(/closable off/);
    // A lane is its view's: it closes when the view goes (the desk's rule for a tile a source supplies).
    await expect(act("tile.close", {}, "To-do")).rejects.toThrow(/To-do stays: hub:\S+ supplies it, .* to drop it, take its view out of the hub/);
    await expect(act("layout.move", { where: "edge-left" }, "preview")).rejects.toThrow(/preview stays where it is: .* \(draggable off\)/);
    await expect(act("layout.move", { where: "edge-left" }, "tree")).rejects.toThrow(/draggable off/);
    // The person's x on the preview runs the same close, and the screen says why it stays.
    await act("focus", {}, "preview", null);
    (b as any).key({ kind: "char", ch: "x" }, (b as any).ctx);
    await until(() => /preview stays: .*closable off/.test((app as any).message ?? ""), "x on the preview says why it stays", 3000);
    expect((b as any).idNamed("preview")).toBeDefined();
    // A detail opens, and it closes and moves as any tile does.
    const r: any = await act("open", { id: card }, "new-detail");
    expect(r.reader).toMatch(/^detail\d+$/);
    // It took the keys (an agent's open does, unless the person is in an edit): the person closes it.
    await act("tile.close", {}, r.reader, null);
    expect((b as any).detailTiles()).toHaveLength(0);
  });

  test("a tree tile of the person's own beside the preview closes; the drawer's tree shuts its drawer (by place, not by name)", async () => {
    await act("tile.open", { kind: "tree", name: "tree-mine", where: "right" }, "preview", null);
    expect((b as any).idNamed("tree-mine")).toBeDefined();
    await act("tile.close", {}, "tree-mine", null);
    expect((b as any).idNamed("tree-mine")).toBeUndefined();
    expect((b as any).idNamed("tree")).toBeDefined();
  });

  test("a readers row taken apart opens no detail and says why (no TypeError), and the board comes back whole", async () => {
    const pv: any = await act("layout.policy", {}, "preview");
    const holder = pv.containers.at(-1);
    // The policy can be changed (it is the screen's, not code); then the preview can move out of the row.
    await act("layout.policy", { node: holder, draggable: true });
    await act("layout.move", { where: "edge-left" }, "preview");
    // The note opens in the preview instead, and the answer (and the screen) says why: nothing throws.
    const r1: any = await act("open", { id: card }, "new-detail");
    expect(r1).toMatchObject({ reader: "preview", id: card });
    expect(r1.why).toMatch(/readers row is gone .*opening a detail/);
    expect((b as any).detailTiles()).toHaveLength(0);
    // Reopened, the board is whole again: the saved layout without a readers row isn't taken back.
    await open(true);
    const again: any = await act("layout.policy", {}, "preview");
    expect(again.effective.draggable).toBe(false);
    const r: any = await act("open", { id: card }, "new-detail");
    expect(r.reader).toMatch(/^detail\d+$/);
  });

  test("a board saved before its shape was policy gets the rules when it loads", async () => {
    const file = join(process.env.EP0CH_STATE!, "delivery.json");
    const saved = JSON.parse(readFileSync(file, "utf8"));
    // The shape as an older door saved it: no policies but the drawers', the preview a bare tile in the readers row.
    const strip = (n: any): any => {
      if (!n || typeof n !== "object") return n;
      if (n.t === "tabs" && n.tabs?.length === 1) return n.tabs[0];
      const out: any = { ...n };
      if (n.t !== "drawer") delete out.policy;
      for (const k of ["kids", "tabs"]) if (Array.isArray(n[k])) out[k] = n[k].map(strip);
      for (const k of ["kid", "a", "b"]) if (n[k]) out[k] = strip(n[k]);
      return out;
    };
    saved.layout.root = strip(saved.layout.root);
    expect(JSON.stringify(saved.layout.root)).not.toContain("closable");
    writeFileSync(file, JSON.stringify(saved));
    await open(true);
    const pv: any = await act("layout.policy", {}, "preview");
    expect(pv.effective).toMatchObject({ draggable: false, closable: false });
    await expect(act("tile.close", {}, "preview")).rejects.toThrow(/closable off/);
    const tree: any = await act("layout.policy", {}, "tree");
    expect(tree.effective.draggable).toBe(false);
  });
});

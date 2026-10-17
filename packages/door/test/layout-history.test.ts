// PIE-957 (S7, design §4.9): one layout history for every actor. The desk records each change to the screen's shape with who
// made it; layout.undo (ctrl+z, the tile menu's row, act) takes the newest back; txn=<id> and motion=<style> are the
// dispatcher's own arguments, open to every actor; a transaction is one entry and closes by layout.txn.end, with an end rule
// that puts a stopped one back; nobody undoes over someone else. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { LayoutHistory } from "../src/desk/layout-history";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { INVITES } from "../src/surface/invite";
import { extensionList } from "../src/extensions";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

const AGENT = { kind: "agent", id: "history-agent" } as const;
const spec = (n: number) => ({ root: { t: "leaf", kind: "blank", name: `t${n}` } }) as never;

describe("the layout history", () => {
  test("a transaction's steps are one entry, a drag's resizes are one, and an idle transaction is found", () => {
    const h = new LayoutHistory();
    h.join("run-1", AGENT, spec(0), 1000);
    h.record(spec(0), AGENT, "close", 1000, "run-1");
    h.record(spec(1), AGENT, "float", 1100, "run-1");
    h.record(spec(2), AGENT, "move", 1200, "run-1");
    expect(h.size).toBe(1);
    expect(h.forTxn("run-1")).toMatchObject({ steps: 3, what: "3 steps", before: spec(0) });
    h.record(spec(3), USER, "resize", 5000);
    h.record(spec(4), USER, "resize", 5400);
    expect(h.size).toBe(2);
    h.record(spec(5), AGENT, "resize", 5500);
    expect(h.size).toBe(3);
    expect(h.idle(1000 + 59_000)).toEqual([]);
    expect(h.idle(1200 + 60_000).map(t => t.id)).toEqual(["run-1"]);
  });
});

describe.skipIf(!outliner)("layout.undo, transactions and the reserved arguments, on the desk", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const D = () => desk as any;
  const AS = "history-agent";
  // The person has not touched a key: an agent's act is allowed (the keys of the first test set the clock).
  const act = (action: string, args: Record<string, unknown> = {}, tile?: string, as = AS) => { (app as any).lastInput = 0; return app.act({ action, args, ...(tile ? { tile } : {}), as }); };
  const person = (action: string, args: Record<string, unknown> = {}, tile?: string) => app.dispatch.act({ action, args, ...(tile ? { tile } : {}) }, USER);
  const names = () => (D().layoutGet() as { tiles: { name: string }[] }).tiles.map(t => t.name);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "sh";
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    desk.render(D().ctx);
    await until(() => D().panes.size > 0 && names().length >= 4, "the desk's tiles");
  }, 30_000);

  afterAll(async () => {
    D().dispose();
    board?.close();
    await scratch.dispose();
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) delete process.env[k];
  });

  test("the person's change is an entry; ctrl+z takes it back, and so do act and the menu's row", async () => {
    const before = names();
    const victim = before.find(n => n !== D().layoutGet().focus)!;
    await person("tile.close", {}, victim);
    expect(names()).not.toContain(victim);
    expect(D().history.size).toBeGreaterThan(0);
    key({ kind: "char", ch: "z", ctrl: true });
    await until(() => names().includes(victim), "ctrl+z put the tile back");
    expect(names().sort()).toEqual(before.sort());
    // By act, the same: close it again and take it back through the action.
    await person("tile.close", {}, victim);
    const r = await act("layout.undo", {}, undefined, "someone-else").catch((e: Error) => e.message);
    expect(String(r)).toContain("only its own");
    await person("layout.undo");
    expect(names()).toContain(victim);
    const menu = app.dispatch.list().actions.find(a => a.name === "layout.undo");
    expect(menu?.keys).toContain("ctrl+z");
  });

  test("txn=<id> and motion=<style> are open to every action; motion needs a txn; a bad id is refused with the shape", async () => {
    await act("tile.focus", { txn: "t-open" }, names()[0]);
    await act("tile.focus", { txn: "t-open", motion: "fantasia" }, names()[0]);
    await expect(act("tile.focus", { motion: "fantasia" }, names()[0])).rejects.toThrow("motion= is part of a transaction");
    await expect(act("tile.focus", { txn: "bad id!" }, names()[0])).rejects.toThrow("txn= is an id");
  });

  test("a transaction is one entry for every layout change in it; layout.txn.end closes it; layout.undo txn= takes all of it back", async () => {
    const before = names();
    const [a, b] = before.filter(n => n !== D().layoutGet().focus);
    const size = D().history.size;
    await act("tile.close", { txn: "run-a" }, a);
    await act("tile.close", { txn: "run-a" }, b);
    expect(D().history.size).toBe(size + 1);
    expect(names()).not.toContain(a);
    const ended = await act("layout.txn.end", { txn: "run-a" }) as { steps: number; putBack: boolean };
    expect(ended).toMatchObject({ steps: 2, putBack: false });
    expect(D().history.isOpen?.("run-a") ?? D().history.openIds().includes("run-a")).toBeFalsy();
    await act("layout.undo", { txn: "run-a" });
    expect(names().sort()).toEqual(before.sort());
  });

  test("a transaction that ends early puts its start back and says so; nobody undoes over someone else", async () => {
    const before = names();
    const [a, b] = before.filter(n => n !== D().layoutGet().focus);
    await act("tile.close", { txn: "run-b" }, a);
    expect(names()).not.toContain(a);
    D().endTxn("run-b", "stopped", { kind: "agent", id: AS });
    expect(names().sort()).toEqual(before.sort());
    expect(() => D().endTxn("run-b", "done")).toThrow("no open transaction");
    // The agent's change, then the person's: the agent's undo is refused over it, naming who changed the layout since.
    await act("tile.close", { txn: "run-c" }, a);
    await person("tile.close", {}, b);
    await expect(act("layout.undo", { txn: "run-c" })).rejects.toThrow("the layout changed since (you");
    await person("layout.undo");
    await act("layout.undo", { txn: "run-c" });
    expect(names().sort()).toEqual(before.sort());
  });

  test("a script run is one transaction: a press invites it to move the tiles the person is at the keys of, its layout changes are one entry, they close when it ends, and ext.undo's broadcast takes them back", async () => {
    const before = names();
    const [a, b] = before.filter(n => n !== D().layoutGet().focus);
    // It gives the keys to one tile (what the person's own keys are the screen's about), then closes two others.
    await board.request("create", { author: "user", text: 'Tidy tiles [script::tidy-tiles] [effects::write]\n```js\nawait act("tile.focus", { tile: props.f[0] });\nawait act("tile.close", { tile: props.a[0] });\nawait act("tile.close", { tile: props.b[0] });\nreturn "closed two";\n```' });
    const note = await board.request<{ id: string }>("create", { author: "user", text: "Scratch note for the script" });
    await board.request("extensions.list", { reload: true });
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "tidy-tiles"), "the script loaded");
    const ext = extensionList()!.extensions.find(e => e.name === "tidy-tiles")!;
    const text = async (run: { written: string[] }) => (await board.get(run.written[0]!))?.text ?? "";
    const settled = async (run: { written: string[] }) => untilAsync(async () => !(await text(run)).split("\n")[0]!.includes("· working"), "the run to finish");
    // The person has just clicked: without the press's invitation the script's moves are refused while they are at the keys.
    (app as any).lastInput = Date.now();
    const bare = await person(`ext.${ext.id}.run`, { block: note.id, a, b, f: D().layoutGet().focus }) as { undo: string; written: string[] };
    await settled(bare);
    expect(await text(bare)).toContain("at the keys");
    expect(names().sort()).toEqual(before.sort());
    // With the press's invitation the same run moves them, as one entry in the layout's history.
    (app as any).lastInput = Date.now();
    const size = D().history.size;
    const run = await person(`ext.${ext.id}.run`, { block: note.id, a, b, f: D().layoutGet().focus, invitation: INVITES.mint("you") }) as { undo: string; written: string[] };
    await settled(run);
    expect(await text(run)).toContain("· done");
    expect(names()).not.toContain(a);
    expect(names()).not.toContain(b);
    expect(D().history.size).toBe(size + 1);
    await untilAsync(async () => !D().history.isOpen(run.undo), "the run's end closed its transaction", 10_000);
    expect(D().history.forTxn(run.undo)).toMatchObject({ steps: 2 });
    // The service takes the run's writes back and says so (scripts.undone): the door takes the layout back with them.
    await board.undoExtension(run.undo, USER);
    await untilAsync(async () => names().includes(a) && names().includes(b), "the layout is back", 8000);
    expect(names().sort()).toEqual(before.sort());
  }, 60_000);

  test("a run that is stopped ends its transaction early: the layout it changed is put back, and the screen says so", async () => {
    const before = names();
    const b = before.find(n => n !== D().layoutGet().focus)!;
    await board.request("create", { author: "user", text: 'Slow tidy [script::slow-tidy] [effects::write]\n```js\nawait act("tile.close", { tile: props.b[0] });\nawait wait(30000);\nreturn "never";\n```' });
    const note = await board.request<{ id: string }>("create", { author: "user", text: "Another scratch note" });
    await board.request("extensions.list", { reload: true });
    await app.loadExtensions(true);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "slow-tidy"), "the script loaded");
    const ext = extensionList()!.extensions.find(e => e.name === "slow-tidy")!;
    (app as any).lastInput = Date.now();
    const run = await person(`ext.${ext.id}.run`, { block: note.id, b, invitation: INVITES.mint("you") }) as { undo: string };
    await untilAsync(async () => !names().includes(b), "the run closed a tile");
    expect(D().history.isOpen(run.undo)).toBe(true);
    await board.stopScript(run.undo, USER);
    await untilAsync(async () => names().includes(b), "the stopped run's layout put back", 8000);
    expect(names().sort()).toEqual(before.sort());
    expect(D().history.isOpen(run.undo)).toBe(false);
    expect(D().history.forTxn(run.undo)).toBeNull();
  }, 60_000);
});

// One links model (src/links.ts): a block's Outlinks, Resources and Backlinks, the same rows in the tree, the links
// tile and the inline `::links` component; `b` in any reader shows them in the screen's links tile (one opened
// beside it where there's none), its preview showing the selected row (a Resource's stored content, read only);
// and every list's mouse escalating as its keys do (RowView.press). The parsing and the gestures without a
// service; the rest against a throwaway outliner (never a real outline), with fictional notes and files.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { BacklinksPane } from "../src/desk/backlinks-pane";
import type { PreviewPane } from "../src/desk/preview";
import type { ReaderPane } from "../src/desk/panes";
import { linkBlockAt } from "../src/links";
import { presentLinks } from "../src/refs";
import { DOUBLE_MS, RowPresses, SidewaysWheel, SWIPE_GAP_MS, SWIPE_REPORTS } from "../src/scroll";
import { KeyDecoder } from "../src/term";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until as untilQuick } from "./scratch";

const until = (ok: () => boolean, what: string, ms = 15_000) => untilQuick(ok, what, Math.max(ms, 15_000));
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

describe("a press on a list's row escalates as the keys do", () => {
  test("a click selects; a second on the same row within the double-click time opens; another row, or later, selects again", () => {
    const p = new RowPresses();
    expect(p.press(3, { now: 1000 })).toBe("select");
    expect(p.press(3, { now: 1000 + DOUBLE_MS - 1 })).toBe("open");
    expect(p.press(3, { now: 1000 + DOUBLE_MS + 50 })).toBe("select");          // a third press starts afresh
    expect(p.press(4, { now: 1000 + DOUBLE_MS + 100 })).toBe("select");         // another row: not a double
    expect(p.press(4, { now: 1000 + 3 * DOUBLE_MS })).toBe("select");           // too slow: two single clicks
  });

  test("the press that gives the list the keys only selects, whatever it carries; its second press is still a double click", () => {
    const p = new RowPresses();
    expect(p.press(1, { focusing: true, mods: 8, now: 0 })).toBe("focus");
    expect(p.press(1, { now: 100 })).toBe("open");
  });

  test("an alt- or ctrl-click, or the middle button, is alt+⏎; shift isn't (terminals keep it for their own selection)", () => {
    const p = new RowPresses();
    expect(p.press(1, { mods: 8, now: 0 })).toBe("fresh");
    expect(p.press(2, { mods: 16, now: 1000 })).toBe("fresh");
    expect(p.press(3, { button: 1, now: 2000 })).toBe("fresh");
    expect(p.press(4, { mods: 4, now: 3000 })).toBe("select");
  });
});

describe("the sideways wheel", () => {
  test("SGR buttons 66 and 67 are wheel-left and wheel-right, their modifiers kept; 64 and 65 stay up and down", () => {
    const d = new KeyDecoder({} as never), keys: Key[] = [];
    d.keyHandler = k => keys.push(k);
    d.feed("\x1b[<66;5;6M\x1b[<67;5;6M\x1b[<75;5;6M\x1b[<64;5;6M\x1b[<65;5;6M");
    expect(keys.map(k => (k.kind === "mouse" ? `${k.action}${k.mods ? `+${k.mods}` : ""}` : k.kind))).toEqual(["wheel-left", "wheel-right", "wheel-right+8", "wheel-up", "wheel-down"]);
  });

  test("a swipe's burst of reports is one step, then one more every few reports; a pause or a turn starts a new swipe", () => {
    const w = new SidewaysWheel();
    const steps = Array.from({ length: 20 }, (_, i) => w.step(1, 1000 + i * 5));
    expect(steps.filter(Boolean).length).toBe(1 + Math.floor(19 / SWIPE_REPORTS));
    expect(w.step(1, 1000 + 19 * 5 + SWIPE_GAP_MS + 1)).toBe(1);                // a new swipe
    expect(w.step(-1, 1000 + 19 * 5 + SWIPE_GAP_MS + 2)).toBe(-1);              // a turn
  });
});

describe("the inline component's forms", () => {
  test("one line: the words after the name filter, a ((ref)) names whose", () => {
    expect(linkBlockAt(["::resources jira"], 0)).toEqual({ spec: { kind: "resources", of: null, filter: "jira", title: null }, end: 0 });
    const id = "0b0c4d58-1a2b-4c3d-8e9f-001122334455";
    expect(linkBlockAt([`::backlinks ((${id}))`], 0)!.spec.of).toBe(id);
    expect(linkBlockAt(["::links"], 0)).toEqual({ spec: { kind: "links", of: null, filter: "", title: null }, end: 0 });
    expect(linkBlockAt(["::graph-check"], 0)).toBeNull();
    expect(linkBlockAt(["see ::links here"], 0)).toBeNull();
  });

  test("a block to its `::`: of, filter, title, groups, or bare words as the filter; Comark's --- lines are skipped", () => {
    const id = "0b0c4d58-1a2b-4c3d-8e9f-001122334455";
    const lines = ["intro", "::links", "---", `of: ((${id}|the plan))`, "title: Around the plan", "groups: resources", "---", "::", "after"];
    expect(linkBlockAt(lines, 1)).toEqual({ spec: { kind: "resources", of: id, filter: "", title: "Around the plan" }, end: 7 });
    expect(linkBlockAt(["::backlinks", "onion sets", "::"], 0)).toEqual({ spec: { kind: "backlinks", of: null, filter: "onion sets", title: null }, end: 2 });
    expect(linkBlockAt(["::links", "of: nowhere", "::"], 0)!.spec.problem).toContain("of: needs a ((block))");
    // Where it ends is outline-core's component-block rule: a blank line doesn't end it, a heading does (unclosed: the
    // first line alone, and what follows is the note's); with arguments, a blank line ends it.
    expect(linkBlockAt(["::links", "a paragraph", "", "::"], 0)!.end).toBe(3);
    expect(linkBlockAt(["::links", "a paragraph", "## Next", "::"], 0)!.end).toBe(0);
    expect(linkBlockAt(["::resources jira", "", "::"], 0)!.end).toBe(0);
    expect(linkBlockAt(["::resources jira", "title: Around", "::"], 0)).toEqual({ spec: { kind: "resources", of: null, filter: "jira", title: "Around" }, end: 2 });
  });

  test("its lines are left as typed when links are presented: an of: ((id)) still names the id", () => {
    const id = "0b0c4d58-1a2b-4c3d-8e9f-001122334455";
    const text = `before ((${id}))\n::links\nof: ((${id}))\n::\nafter`;
    const out = presentLinks(text, true, null).split("\n");
    expect(out[2]).toBe(`of: ((${id}))`);
    expect(out[0]).not.toContain(`((${id}))`);                                       // a link outside it is presented
  });
});

describe.skipIf(!outliner)("the links tile, b, and the inline component, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const n = {} as Record<"plan" | "shed" | "notes" | "inline", Msg>;
  const D = () => desk as any;
  const list = () => desk.pane("backlinks") as BacklinksPane;
  const preview = () => [...D().panes.values()].find((p: any) => p.kind === "preview") as PreviewPane;
  const reader = () => desk.pane("reader") as ReaderPane;
  const focusName = () => D().nameOf(D().focus) as string;
  const rows = () => ((list()?.describe() as any)?.rows ?? []) as any[];
  const lines = () => desk.render(D().ctx).lines.map(plain);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    mkdirSync(join(scratch.workspace, "beds"), { recursive: true });
    writeFileSync(join(scratch.workspace, "beds", "rota.md"), "# Watering rota\n\n- Mondays: the north beds.\n");
    const create = (parentId: string | null, text: string) => board.createBlock(parentId, text);
    n.shed = await create(null, "Tool shed inventory\nTwo spades and a fork.");
    n.plan = await create(null, `Weekend plan\nSee ((${n.shed.id}|the shed list)).\nRota: [file::beds/rota.md]`);
    n.notes = await create(null, `Compost notes\nSee ((${n.plan.id})) for when.`);
    n.inline = await create(null, `Plan's corner\n::resources\nof: ((${n.plan.id}))\n::\n\n::backlinks ((${n.plan.id}))`);
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk({ name: "one", title: "one reader", layout: { root: { t: "leaf", kind: "reader", name: "reader" }, focus: "reader" } });
    app.push(desk);
    desk.setCurrent(n.plan);
    await until(() => reader().msg?.id === n.plan.id && !reader().msg!.partial, "the plan in the reader");
  }, 60_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("b on a screen with only a reader opens a links tile below it with a preview beside: Outlinks, Resources, Backlinks", async () => {
    key({ kind: "char", ch: "b" });
    await until(() => !!list() && rows().some(r => r.kind === "resource") && rows().some(r => r.kind === "kind"), "the three groups");
    expect(rows().filter(r => r.kind === "group").map(r => r.text)).toEqual(["→ outlinks (1)", "♦ resources (1)", "← backlinks (2)"]);
    expect(focusName()).toBe("backlinks");
    expect(preview()).toBeDefined();
    // The first link is selected and shown in the preview.
    await until(() => preview().msg?.id === n.shed.id, "the shed note in the preview");
  }, 60_000);

  test("moving onto a resource shows its stored content in the preview, read only: nothing is registered", async () => {
    const before = board.sent.length;
    for (let i = 0; i < 6 && rows().find(r => r.selected)?.kind !== "resource"; i++) key({ kind: "char", ch: "j" });
    await until(() => preview().msg?.id.startsWith("resource:") ?? false, "the resource in the preview");
    expect(preview().msg!.text).toContain("not registered yet");
    expect(board.sent.slice(before)).not.toContain("resources.follow-authored");
    // ⏎ registers it (one step) and shows what it holds.
    key({ kind: "enter" });
    await until(() => (desk.current?.text ?? "").includes("Mondays: the north beds"), "the file's text, opened");
    expect(board.sent.slice(before)).toContain("resources.follow-authored");
    // The reader shows the file now (a Resource has no links); back on the plan, its row says it's registered.
    desk.setCurrent(n.plan);
    await until(() => (rows().find(r => r.kind === "resource")?.context ?? "").includes("filesystem"), "the row says it's registered");
  }, 60_000);

  test("the filter narrows all three groups; . folds a group", async () => {
    desk.setCurrent(n.plan);
    D().focus = D().idNamed("backlinks");
    await until(() => rows().some(r => r.kind === "outlink"), "the plan's links");
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { filter: "shed" } });
    expect(rows().filter(r => r.kind !== "group").map(r => r.text)).toEqual(["the shed list → Tool shed inventory"]);
    // outline-core's matcher, as the backlinks' filter: a typo and another word order still find the link.
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { filter: "inventroy shde" } });
    expect(rows().filter(r => r.kind !== "group").map(r => r.text)).toEqual(["the shed list → Tool shed inventory"]);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { filter: "rota bedz" } });
    expect(rows().filter(r => r.kind === "resource").length).toBe(1);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { filter: "" } });
    await D().dispatch.act({ action: "backlinks.fold", tile: "backlinks", args: { kind: "outlinks" } }, USER);
    expect(rows().find(r => r.group === "outlinks").open).toBe(false);
    expect(rows().some(r => r.kind === "outlink")).toBe(false);
    await D().dispatch.act({ action: "backlinks.fold", tile: "backlinks", args: { kind: "outlinks" } }, USER);
  }, 60_000);

  test("an agent's links reads them: the person's keys, their list's note and its selection stay as they were", async () => {
    D().focus = D().idNamed("reader");
    desk.setCurrent(n.notes);
    await until(() => reader().msg?.id === n.notes.id && list().target?.id === n.notes.id && !!list().data, "another note in the reader, its links listed");
    await Bun.sleep(200);
    const was = { target: list().target?.id, sel: list().sel };
    const r: any = await app.act({ action: "links", tile: "reader", as: "walker-3" });
    expect(r.tile).toBe("backlinks");
    expect(r.opened).toBe(false);
    expect(r.links.rows.some((x: any) => x.kind === "outlink" && x.id === n.plan.id)).toBe(true);
    expect(focusName()).toBe("reader");
    await Bun.sleep(100);
    expect({ target: list().target?.id, sel: list().sel }).toEqual(was);
    // What `ep0ch actions` tells an agent says the same: its call reads, it never aims the person's list.
    const summary = ((app.actions() as any).actions as any[]).find(a => a.name === "links").summary as string;
    expect(summary).not.toMatch(/agent's opens or aims/);
    expect(summary).toContain("never aims the person's");
  }, 60_000);

  test("refusals: a resource has no links; a screen without room says so; an agent doesn't fold a river column's groups", async () => {
    // A Resource shown in the reader isn't a block.
    const res = { id: "resource:made-up", text: "rota.md\n\nnothing", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "resource", props: {} };
    desk.setCurrent(res as Msg);
    await until(() => reader().msg?.id === res.id, "the resource in the reader");
    await expect(D().dispatch.act({ action: "links", tile: "reader" }, USER)).rejects.toThrow("isn't a block");
    desk.setCurrent(n.plan);
    await until(() => reader().msg?.id === n.plan.id, "the plan again");
  }, 60_000);

  test("::resources and ::backlinks in a note draw the same rows inline; a row is a link the reader opens", async () => {
    desk.setCurrent(n.inline);
    await until(() => lines().join("\n").includes("rota.md") && lines().join("\n").includes("Compost notes"), "the inline rows");
    const drawn = lines().join("\n");
    expect(drawn).toContain("[ RESOURCES ]");
    expect(drawn).toContain("[ BACKLINKS ]");
    expect(drawn).toMatch(/♦ rota\.md · (Filesystem|not registered)/);
    expect(drawn).toMatch(/← Compost notes —/);
    // A click on the backlink row opens its note in this reader (where its links go).
    const ls = lines(), y = ls.findIndex(l => l.includes("← Compost notes")), x = ls[y]!.indexOf("Compost notes") + 2;
    D().focus = D().idNamed("reader");
    key({ kind: "mouse", action: "down", button: 0, x, y });
    key({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => desk.current?.id === n.notes.id, "the backlink's note opened from the inline row");
  }, 60_000);
});

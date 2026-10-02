// PIE-472, PIE-425, PIE-424's door side: transclusion renders like Detail and nests to the service's
// bounded depth; an anchored embed shows only its slice; a followed `((id^anchor))` opens the note at the
// fragment, marked; checklist steps in the note and inside embeds are controls, by keys, clicks and `act`,
// through `checklist.update` with provenance, with Undo; and `[ ]` stops on steps inside embeds. Fictional
// notes, against a throwaway outliner service only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { outlineChanged as outlineChangedForTest } from "../src/refs";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const AGENT = "fixture-agent-472";

describe.skipIf(!outliner)("steps and transclusions, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const flashes: string[] = [], copied: string[] = [];
  const n: Record<string, any> = {};
  const create = (text: string) => board.request<any>("create", { parentId: null, text, author: "user" });
  const textOf = async (id: string) => (await board.get(id))!.text;
  /** A surface on its own host: navigation opens in place, as a held reader's does. */
  const reader = () => {
    const s = new NoteSurface();
    const host: SurfaceHost = {
      ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false, copy: (t: string) => copied.push(t) } as any,
      redraw() {}, navigate: (m) => { s.show(m, host); },
    };
    return { s, host, draw: (w = 72, h = 60) => s.render(w, h, host).lines.map(plain) };
  };
  const settle = async (draw: () => string[], ok: (text: string) => boolean, what: string) =>
    until(() => ok(draw().join("\n")), what, 10_000);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    n.garden = await create([
      "Allotment checklist",
      "## Spring ^spring",
      "1. [x] Turn the compost ^t-a1b2c3",
      "2. [ ] Sow the beans ^t-d4e5f6",
      "   Soak them overnight first.",
      "   - [~] Buy canes ^t-0a0b0c",
      "3. [!] Fix the water butt",
      "## Summer",
      "- [ ] Net the brassicas",
    ].join("\n"));
    n.hub = await create("Hub of hubs");
    n.plan = await create([
      "Week plan",
      "This week:",
      `!((${n.garden.id}))`,
      "Just the beans:",
      `!((${n.garden.id}^t-d4e5f6))`,
      `!((${n.hub.id}))`,
      "- [ ] Ring the plot office",
      `Where it started: ((${n.garden.id}^spring)).`,
    ].join("\n"));
    // The hub embeds a step of the garden and the plan itself: a cycle back to the note it's shown in.
    await board.update(n.hub.id, `Hub of hubs\n!((${n.garden.id}^t-0a0b0c))\n!((${n.plan.id}))\n!((${n.garden.id}^t-nothere))`, n.hub.revision);
  }, 30_000);

  afterAll(async () => {
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  }, 20_000);

  test("an embed shows its note rendered; an anchored one only its slice; embeds nest and stop at a cycle in the service's words", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("CYCLE") && t.includes("MISSING FRAGMENT"), "the nested embeds");
    const lines = draw();
    const at = (text: string) => lines.findIndex(l => l.includes(text));
    // The whole note, rendered: its heading and its numbered steps, not raw Markdown, anchors hidden.
    expect(lines[at("» Allotment checklist") + 1]).toContain("## Spring");
    expect(lines.join("\n")).not.toContain("^t-a1b2c3");
    expect(lines[at("» Allotment checklist") + 2]).toContain("1. [x] Turn the compost");
    // The slice: the step with its continuation and nested step, and nothing else of the note.
    const slice = at("» Allotment checklist ^t-d4e5f6");
    expect(lines.slice(slice + 1, slice + 4).map(l => l.trim())).toEqual(["▌ 2. [ ] Sow the beans", "▌    Soak them overnight first.", "▌    ∙ [~] Buy canes"]);
    expect(lines[slice + 4]).toContain("» Hub of hubs");
    // Nested one level in, with a second gutter; the cycle and the missing fragment are said where they are.
    const hub = at("» Hub of hubs");
    expect(lines[hub + 1]).toMatch(/▌ ▌» Allotment checklist \^t-0a0b0c/);
    expect(lines[hub + 2]).toMatch(/▌ ▌ ∙ \[~\] Buy canes/);
    expect(lines[hub + 3]).toContain(`!((${n.plan.id.slice(0, 8)}…)) · CYCLE · this embed is already open above it`);
    expect(lines[hub + 4]).toContain("^t-nothere)) · MISSING FRAGMENT");
  }, 30_000);

  test("[ ] stops on steps inside embeds; ⏎ opens the status choice, x marks done in the source note, ctrl+z undoes it", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("CYCLE"), "the embeds");
    const steps = (await s.act("tasks", {}, host, { kind: "user" }) as any).steps;
    expect(steps.map((t: any) => `${t.status} ${t.text} · ${t.in === "this note" ? "note" : t.in.includes("^") ? "slice" : "embed"}`)).toEqual([
      "done Turn the compost · embed", "todo Sow the beans · embed", "waiting Buy canes · embed", "problem Fix the water butt · embed", "todo Net the brassicas · embed",
      "todo Sow the beans · slice", "waiting Buy canes · slice", "waiting Buy canes · slice", "todo Ring the plot office · note",
    ]);
    // Walk to the slice's "Sow the beans" with the keys.
    let guard = 0;
    while (!(s.describe().elements?.current?.kind === "task" && s.describe().elements!.current!.label.includes("Sow the beans · in !((") && s.describe().elements!.current!.label.includes("^t-d4e5f6"))) {
      s.key(char("]"), host); draw();
      if (++guard > 40) throw new Error("[ ] never reached the slice's step");
    }
    expect(s.hint()).toContain("step [ ] Sow the beans · in !((");
    expect(s.hint()).toContain("⏎ status · space done/to do · ctrl+z undo");
    s.key({ kind: "enter" }, host);
    const menu = draw().join("\n");
    expect(menu).toContain("[x] Mark done");
    expect(menu).toContain("[~] Mark waiting");
    expect(menu).toContain("[!] Mark problem");
    expect(menu).toContain("Copy step link");
    expect(s.choosing).toBe(true);
    expect(s.holdsKeys).toBe(false);                     // not a session: it holds no note
    s.key(char("x"), host);
    await until(() => s.picker === null, "the choice to land");
    expect(await textOf(n.garden.id)).toContain("2. [x] Sow the beans ^t-d4e5f6");
    expect(flashes.at(-1)).toBe(`set "Sow the beans" to do → done · in !((${n.garden.id.slice(0, 8)}…^t-d4e5f6))`);
    // Both places it's drawn follow: the whole note's embed and the slice.
    await settle(draw, t => (t.match(/\[x\] Sow the beans/g) ?? []).length === 2, "both embeds redrawn");
    // Still on the same step, so space toggles it back to do, and ctrl+z undoes that toggle.
    expect(s.describe().elements!.current!.label).toContain("Sow the beans");
    s.key(char(" "), host);
    await until(() => flashes.at(-1)?.includes("done → to do") ?? false, "space to toggle");
    expect(await textOf(n.garden.id)).toContain("2. [ ] Sow the beans ^t-d4e5f6");
    s.key({ kind: "char", ch: "z", ctrl: true }, host);
    await until(() => flashes.at(-1)?.startsWith("undid") ?? false, "the undo");
    expect(flashes.at(-1)).toBe('undid: "Sow the beans" to do → done');
    expect(await textOf(n.garden.id)).toContain("2. [x] Sow the beans ^t-d4e5f6");
    s.key({ kind: "char", ch: "z", ctrl: true }, host);
    await until(() => flashes.at(-1)?.startsWith("undid: \"Sow the beans\" done → to do") ?? false, "the second undo");
    s.key({ kind: "char", ch: "z", ctrl: true }, host);
    await until(() => flashes.at(-1) === "no step change to undo in this note", "nothing left to undo");
  }, 30_000);

  test("a click on a box opens the choice; a click on Mark waiting sets it; a step without an id gets one", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("CYCLE"), "the embeds");
    const click = (x: number, y: number) => { s.press(x, y, host); s.release(x, y, host); };
    // "Fix the water butt" has no id yet.
    let lines = draw();
    let y = lines.findIndex(l => l.includes("3. [!] Fix the water butt"));
    let x = lines[y]!.indexOf("[!]");
    click(x + 1, y);
    lines = draw();
    expect(lines[y + 1]).toContain(" [!] Fix the water butt ");
    const waiting = lines.findIndex(l => l.includes("[~] Mark waiting"));
    expect(lines[waiting]).toContain(" w ");
    click(4, waiting);
    await until(() => s.picker === null || /not changed/.test(s.picker.note), "the click to land");
    expect(s.picker?.note ?? null).toBeNull();
    const text = await textOf(n.garden.id);
    expect(text).toMatch(/3\. \[~\] Fix the water butt \^t-[0-9a-f]{6,}/);   // the service gave it a short id
    await settle(draw, t => t.includes("3. [~] Fix the water butt"), "the embed redrawn");
    // A click anywhere else closes an open choice without changing anything.
    lines = draw();
    y = lines.findIndex(l => l.includes("Ring the plot office"));
    x = lines[y]!.indexOf("[ ]");
    click(x + 1, y);
    expect(s.picker).not.toBeNull();
    click(30, 0);
    expect(s.picker).toBeNull();
    expect(await textOf(n.plan.id)).toContain("- [ ] Ring the plot office");
  }, 30_000);

  test("an agent's change is recorded as its own, said on screen, and moves nobody's position or scroll", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("CYCLE"), "the embeds");
    s.key(char("]"), host); s.key(char("]"), host); draw();
    const before = s.describe().elements!.current;
    const scroll = s.scroll;
    const agent = { kind: "agent" as const, id: AGENT };
    const r = await s.act("task.status", { id: "t-0a0b0c", to: "problem" }, host, agent) as any;
    expect(r).toMatchObject({ status: "problem", from: "waiting", changed: true, recordedAs: { author: "agent", actorId: AGENT } });
    expect(s.describe().elements!.current).toEqual(before);
    expect(s.scroll).toBe(scroll);
    expect(s.describe().agent).toMatchObject({ id: AGENT, did: `set "Buy canes" waiting → problem · in !((${n.garden.id.slice(0, 8)}…))` });
    expect(flashes.at(-1)).toBe(`an agent (${AGENT}) · set "Buy canes" waiting → problem · in !((${n.garden.id.slice(0, 8)}…))`);
    expect(draw().some(l => l.includes(`an agent (${AGENT}) set "Buy canes"`))).toBe(true);
    // The service recorded it as the agent's.
    const activity = await board.activity(20);
    expect(activity.find(a => a.block.id === n.garden.id && a.actor === AGENT)).toBeTruthy();
    // Its undo is its own; the person has nothing of theirs to undo here.
    await expect(s.act("task.undo", {}, host, { kind: "user" })).rejects.toThrow("no step change to undo in this note");
    expect(await s.act("task.undo", {}, host, agent)).toMatchObject({ status: "waiting", recordedAs: { author: "agent", actorId: AGENT } });
    // Names that don't resolve are refused with the list; an agent can't open the person's status choice.
    await expect(s.act("task.status", { id: "t-nothere", to: "done" }, host, agent)).rejects.toThrow("no step ^t-nothere is drawn");
    await expect(s.act("task.status", { n: 1, to: "maybe" }, host, agent)).rejects.toThrow("to is done, todo, waiting or problem");
    await expect(s.act("task.menu", { n: 1 }, host, agent)).rejects.toThrow("the status choice is the person's");
    // Copy step link: the person's goes to their clipboard; the link names the step's note and id.
    const link = await s.act("task.link", { id: "t-d4e5f6" }, host, { kind: "user" }) as any;
    expect(link.link).toBe(`((${n.garden.id}^t-d4e5f6))`);
    expect(copied.at(-1)).toBe(link.link);
  }, 30_000);

  test("an agent's change to the step the person is on keeps their [ ] there; space, space toggles it back and forth (S1)", async () => {
    const errands = await create("Errands\n- [ ] Post the parcel\n- [ ] Return the library book");
    const { s, host, draw } = reader();
    s.show(await board.get(errands.id), host);
    await settle(draw, t => t.includes("Post the parcel"), "the note");
    await until(() => { draw(); return (s.describe().steps?.drawn ?? 0) === 2; }, "the note's steps");
    s.key(char("]"), host); draw();
    const on = () => s.describe().elements?.current?.label ?? "";
    expect(on()).toContain("Post the parcel");
    await s.act("task.status", { n: 1, to: "done" }, host, { kind: "agent", id: AGENT });
    // Every render in the moment the steps are read again, and after, keeps the person on the step.
    for (let i = 0; i < 20; i++) { draw(); expect(on()).toContain("Post the parcel"); await Bun.sleep(10); }
    expect(await textOf(errands.id)).toMatch(/- \[x\] Post the parcel \^t-/);
    s.key(char(" "), host);
    await until(() => flashes.at(-1)?.includes("done → to do") ?? false, "space: back to to do");
    draw(); expect(on()).toContain("Post the parcel");
    s.key(char(" "), host);
    await until(() => flashes.at(-1)?.includes("to do → done") ?? false, "space again: done");
    draw(); expect(on()).toContain("Post the parcel");
    expect(await textOf(errands.id)).toMatch(/- \[x\] Post the parcel \^t-[0-9a-f]+\n- \[ \] Return the library book$/);
  }, 30_000);

  test("steps without an id are themselves by their text: a reorder while a choice is open never changes another step (S2)", async () => {
    const shop = await create("Shopping\n- [ ] Buy bread\n- [ ] Buy milk");
    const { s, host, draw } = reader();
    s.show(await board.get(shop.id), host);
    await until(() => { draw(); return (s.describe().steps?.drawn ?? 0) === 2; }, "the steps");
    s.key(char("]"), host); draw();
    expect(s.describe().elements!.current!.label).toContain("Buy bread");
    s.key({ kind: "enter" }, host); draw();
    expect(s.picker).not.toBeNull();
    // Someone else reorders the list: "Buy milk" now sits where "Buy bread" was.
    const now = (await board.get(shop.id))!;
    await board.update(shop.id, "Shopping\n- [ ] Buy milk\n- [ ] Buy bread", now.revision!);
    s.refresh((await board.get(shop.id))!);
    outlineChangedForTest([shop.id]);
    await until(() => { draw(); return (s.describe().steps?.drawn ?? 0) === 2 && draw().join("\n").indexOf("Buy milk") < draw().join("\n").indexOf("Buy bread"); }, "the reordered note");
    s.key(char("x"), host);
    await until(() => s.picker === null, "the choice to land or close");
    const text = await textOf(shop.id);
    expect(text).toContain("- [ ] Buy milk\n");                      // untouched
    expect(text).toMatch(/- \[x\] Buy bread \^t-|- \[ \] Buy bread$/); // the step under the choice, or nothing
  }, 30_000);

  test("an agent's link.follow is refused in the person's focused reader; elsewhere it's marked as the agent's (S3)", async () => {
    const make = (focused: boolean) => {
      const s = new NoteSurface();
      const host: SurfaceHost = { ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate: m => { s.show(m, host); }, focused };
      return { s, host, draw: () => s.render(160, 12, host).lines.map(plain) };
    };
    const long = await create(["Long notes", ...Array.from({ length: 40 }, (_, i) => `Line ${i}`), "## Far down ^far", "The end."].join("\n"));
    const pointer = await create(`Pointer\nSee ((${long.id}^far)).`);
    for (const focused of [true, false]) {
      const { s, host, draw } = make(focused);
      s.show((await board.get(pointer.id))!, host);
      await until(() => draw().join("\n").includes("Long notes"), "the link's title");
      // The person's focused reader: the follow is refused outright (round 3, C3), nothing scrolled, marked or moved.
      if (focused) {
        await expect(s.act("link.follow", { n: 1 }, host, { kind: "agent", id: AGENT })).rejects.toThrow(/has the person's keys; following a link there/);
        expect(s.msg!.id).toBe(pointer.id);
        expect(s.scroll).toBe(0); expect(s.describe().focus).toBeNull();
        continue;
      }
      await s.act("link.follow", { n: 1 }, host, { kind: "agent", id: AGENT });
      expect(s.msg!.id).toBe(long.id);
      await Bun.sleep(300); draw();
      { expect(s.describe().focus).toMatchObject({ by: AGENT, marked: "^far" }); expect(draw().some(l => l.includes(`an agent (${AGENT}) followed it`))).toBe(true); }
    }
  }, 30_000);

  test("a step changed elsewhere since it was read is refused, never overwritten", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("CYCLE"), "the embeds");
    const steps = (await s.act("tasks", {}, host, { kind: "user" }) as any).steps;
    const brassicas = steps.findIndex((t: any) => t.text === "Net the brassicas") + 1;
    // Someone rewords the step after this reader read it.
    const g = (await board.get(n.garden.id))!;
    await board.update(g.id, g.text.replace("Net the brassicas", "Net the kale"), g.revision!);
    await expect(s.act("task.status", { n: brassicas, to: "done" }, host, { kind: "user" })).rejects.toThrow("not changed");
    expect(await textOf(n.garden.id)).toContain("- [ ] Net the kale");
  }, 30_000);

  test("following ((id^anchor)) opens the note at the fragment, marked; missing ones say so", async () => {
    const { s, host, draw } = reader();
    s.show(await board.get(n.plan.id), host);
    await settle(draw, t => t.includes("Where it started"), "the plan");
    const link = s.describe().links.findIndex(l => l.fragment === "spring") + 1;
    await s.act("link.follow", { n: link }, host, { kind: "user" });
    await until(() => s.describe().focus?.marked === "^spring", "the fragment mark");
    expect(s.msg!.id).toBe(n.garden.id);
    expect(s.describe().focus).toMatchObject({ line: 2, to: 7 });   // ## Spring through "Fix the water butt"
    expect(draw().some(l => l.includes("◆ ^spring · the fragment the link names"))).toBe(true);
    // Back still works.
    await s.act("back", {}, host, { kind: "user" });
    expect(s.msg!.id).toBe(n.plan.id);
    // A link to an anchor that isn't there opens the note and says so.
    const odd = await create(`Odd link\nSee ((${n.garden.id}^t-gone)).`);
    s.show(await board.get(odd.id), host);
    draw();
    await s.act("link.follow", { n: 1 }, host, { kind: "user" });
    await until(() => flashes.some(f => f.includes("Missing fragment: no ^t-gone")), "the missing fragment said");
  }, 30_000);

  test("on the desk: live in every reader, and the keys reach a step inside an embed", async () => {
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    const desk = new Desk(), D = desk as any;
    app.push(desk);
    await app.act({ action: "open", args: { id: n.plan.id } });
    const readers = () => [...D.panes.values()].filter((x: any) => x.kind === "reader") as ReaderPane[];
    const r0 = readers()[0]!;
    await until(() => r0.msg?.id === n.plan.id && !r0.msg?.partial, "the plan in the reader");
    D.focus = [...D.panes.entries()].find(([, x]: any) => x === r0)![0];
    const draw = () => desk.render(D.ctx).lines.map(plain).join("\n");
    await until(() => draw().includes("CYCLE"), "the embeds on the desk", 10_000);
    for (let i = 0; i < 40 && !(r0.surface.describe().elements?.current?.label ?? "").includes("Ring the plot office"); i++) { key(char("]")); draw(); }
    key({ kind: "enter" });
    draw();
    expect(r0.surface.picker).not.toBeNull();
    key(char("w"));                                        // the choice holds the keys: w is waiting, not the desk's
    await until(() => r0.surface.picker === null, "the choice to land");
    expect(await textOf(n.plan.id)).toMatch(/- \[~\] Ring the plot office \^t-/);
    await until(() => draw().includes("[~] Ring the plot office"), "the reader redrawn from the change");
    // An agent changes a step in the garden: the plan's embeds follow, in this reader too.
    await app.act({ action: "task.status", args: { id: "t-a1b2c3", to: "todo" }, as: AGENT });
    await until(() => draw().includes("1. [ ] Turn the compost"), "the embed live after the agent's change", 10_000);
    app.pop();
  }, 40_000);

  test("in a river column: the note's body is the surface's, embeds nested, and [ ] reaches a step inside one", async () => {
    const river = openScreen("river") as Desk, R = () => riverView(river);
    app.push(river);
    try {
      await until(() => !!R().column(1)?.items?.length, "the Library", 10_000);
      await app.act({ action: "open", args: { id: n.plan.id } });
      const col = () => R().byNote(n.plan.id);
      await until(() => !!col(), "the plan's column");
      await river.dispatch.act({ action: "tile.focus", tile: R().name(col()!) }, USER);
      const draw = () => (river.render(river.ctx).lines.join("\n") as string).replace(/\x1b\[[0-9;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
      await until(() => draw().includes("CYCLE") && draw().includes("» Allotment checklist ^t-d4e5f6"), "the embeds in the column", 10_000);
      expect(draw()).not.toContain("embed not expanded here");
      const s = col()!.surface as NoteSurface;
      // "Net the kale": an earlier test reworded it.
      for (let i = 0; i < 40 && !(s.describe().elements?.current?.label ?? "").includes("Net the kale"); i++) { key(char("]")); draw(); }
      expect(s.describe().elements!.current).toMatchObject({ kind: "task" });
      key(char(" "));                                     // space on a step toggles it; it doesn't open replies
      await until(() => draw().includes("[x] Net the"), "the column redrawn", 10_000);
      expect(await textOf(n.garden.id)).toContain("- [x] Net the");
      key({ kind: "enter" });                             // ⏎ opens its status choice in the column
      await until(() => draw().includes("[~] Mark waiting"), "the choice in the column");
      key(char("o"));
      await until(() => draw().includes("[ ] Net the") && !draw().includes("Mark waiting"), "back to to do");
    } finally { app.pop(); }
  }, 40_000);
});

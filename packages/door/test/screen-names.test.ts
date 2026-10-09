// PIE-665: a screen is named the way a person types it ("daily test"), kept under its slug (daily-test): saved, listed by its
// title, opened by title or slug, a name that can't be saved says why in the prompt as it's typed and keeps the prompt open;
// an agent's save answers the slug. And a made screen can't hold itself, however deep (mountProblem): a mount that would is
// refused, a saved one that does comes back with a place holder saying why. Scratch services, fictional screens.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { forgetScreenNotes, loadScreenNotes, readScreenNote, register, screenNoteText } from "../src/desk/screen-notes";
import { MAX_MOUNT_DEPTH, madeScreen, mountProblem, readSpec, resolveScreen, screenSlug, screenTitle, screenTitleProblem } from "../src/desk/screen-spec";
import { layoutNames } from "../src/desk/tiles";
import { openScreen } from "../src/desk/screen-specs";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

describe("the name a title is kept under", () => {
  test("lowercase, spaces to -, other characters dropped, at most 40", () => {
    expect(screenSlug("daily test")).toBe("daily-test");
    expect(screenSlug("  Daily   Test  ")).toBe("daily-test");
    expect(screenSlug("Bob's beds (2026)!")).toBe("bobs-beds-2026");
    expect(screenSlug("v1.2_final-cut")).toBe("v1.2_final-cut");
    expect(screenSlug("x".repeat(60))).toHaveLength(40);
  });
  test("a title with spaces and capitals is fine; empty, no letters to start with, brackets and a built-in's name say why and what would work", () => {
    expect(screenTitleProblem("daily test")).toBeNull();
    expect(screenTitleProblem("Garden Work")).toBeNull();
    expect(screenTitleProblem("")).toContain("type a name");
    expect(screenTitleProblem("   ")).toContain("type a name");
    expect(screenTitleProblem("3 beds")).toContain("starts with a letter");
    expect(screenTitleProblem("3 beds")).toContain('try "beds"');
    expect(screenTitleProblem("!!!")).toContain("needs letters");
    expect(screenTitleProblem("a [b]")).toContain('try "a b"');
    expect(screenTitleProblem("Desk")).toContain("built-in screen's name");
    expect(screenTitleProblem("Desk")).toContain("desk-2");
  });
  test("a screen note keeps the title as typed in its header and the slug as its name; a renamed property is the name and title both", () => {
    const spec = readSpec({ name: "daily-test", title: "daily test", layout: { focus: "tree", root: { t: "leaf", kind: "tree", name: "tree" } } });
    const text = screenNoteText(spec);
    expect(text.split("\n")[0]).toBe("daily test [type::screen] [screen::daily-test]");
    expect(text).toContain('--screen "daily test"');
    const m = { id: "n1", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "user", props: { type: "screen", screen: "daily-test" }, revision: 1 };
    expect(readScreenNote(m)).toMatchObject({ name: "daily-test", title: "daily test", spec: { name: "daily-test", title: "daily test" } });
    expect(readScreenNote({ ...m, props: { type: "screen", screen: "seedlings" } })).toMatchObject({ name: "seedlings", title: "seedlings" });
  });
});

describe.skipIf(!outliner)("naming screens, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const info = { cols: 180, rows: 44, cellW: 9, cellH: 16, kitty: false };
  const top = () => app.screens().at(-1) as Desk & Record<string, any>;
  const text = () => top().render((top() as any).ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
  const mine = (action: string, args: Record<string, unknown> = {}, tile?: string) => top().dispatch.act({ action, args, tile }, { kind: "user" });
  const type = (s: string) => { for (const ch of s) key({ kind: "char", ch }); };

  beforeAll(async () => {
    process.env.EP0CH_STATE = `${scratch.root}/door`;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    forgetScreenNotes();
    await app.loadScreens();
    key({ kind: "char", ch: "M" });
    await until(() => top()?.name === "blank", "the blank screen");
    await mine("blank.fill", { kind: "tree" }, "blank");
    await mine("tile.open", { kind: "detail", where: "right" }, "tree");
  }, 30_000);
  afterAll(async () => { for (const s of app?.screens() ?? []) (s as any).dispose?.(); forgetScreenNotes(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the prompt says what a name would be as it's typed, and why when it can't be; ⏎ on one that can't be keeps the prompt open with what was typed", async () => {
    await mine("screen.save", {});
    expect(text()).toContain("save this screen as");
    expect(text()).toContain("type a name for the screen");
    key({ kind: "enter" });                                            // empty: nothing is saved, the prompt stays
    expect(text()).toContain("save this screen as");
    type("Desk");
    expect(text()).toContain("built-in screen's name");
    key({ kind: "enter" });
    expect(text()).toContain("save this screen as");
    expect(text()).toContain("Desk");                                  // nothing lost
    expect(madeScreen("desk")).toBeUndefined();
    for (let i = 0; i < 4; i++) key({ kind: "backspace" });
    type("daily test");
    expect(text()).toContain("saves as daily-test");
    key({ kind: "enter" });
    await until(() => !!madeScreen("daily-test"), "the screen saved");
    expect(text()).not.toContain("save this screen as");               // closed once it saved
  });

  test("the title is kept as typed: the note's header, the screen's title, ^W r and the screens picker show it, and a list answers both", async () => {
    const m = madeScreen("daily-test")!;
    const note = (await board.get(m.id))!;
    expect(note.text.split("\n")[0]).toBe("daily test [type::screen] [screen::daily-test]");
    expect(note.props).toMatchObject({ screen: "daily-test" });
    expect(screenTitle("daily-test")).toBe("daily test");
    expect(top().title).toBe("daily test");
    expect(layoutNames().find(l => l.name === "daily-test")).toMatchObject({ title: "daily test", saved: true });
    // Listed at once: ^W r and the power bar's @screens (screen.list).
    await mine("layout.load", {});
    expect(text()).toContain("daily test · a screen you made");
    key({ kind: "esc" });
    const list = await app.dispatch.act({ action: "screen.list" }, { kind: "user" }) as any;
    expect(list.named.find((n: any) => n.name === "daily-test")).toMatchObject({ made: true, title: "daily test" });
    // An agent's bar.open answers the rows it would list, opening nothing.
    const bar = await app.act({ action: "bar.open", args: { scope: "screens", query: "daily" }, as: "namer-665" }) as any;
    expect(JSON.stringify(bar)).toContain("daily test");
  });

  test("opened by the title as typed (any case) or the slug; layout.load and screen.delete take either too", async () => {
    expect(resolveScreen("daily test")).toBe("daily-test");
    expect(resolveScreen("Daily Test")).toBe("daily-test");
    expect(resolveScreen("daily-test")).toBe("daily-test");
    expect(resolveScreen("no such screen")).toBeNull();
    for (const asked of ["daily test", "daily-test", "Daily Test"]) {
      const n = app.screens().length;
      await app.dispatch.act({ action: "screen.open", args: { name: asked } }, { kind: "user" });
      await until(() => app.screens().length === n + 1 && top().name === "daily-test", `${asked} opened`);
      expect(top().title).toBe("daily test");
      await app.dispatch.act({ action: "screen.back" }, { kind: "user" });
      await until(() => app.screens().length === n, "back");
    }
    await mine("layout.load", { name: "daily test" });
    expect(top().layoutGet().layout).toBe("daily-test");
    await expect(app.dispatch.act({ action: "screen.open", args: { name: "no such screen" } }, { kind: "user" })).rejects.toThrow(/no screen/);
  });

  test("a save the service refuses after all puts the prompt back with what was typed", async () => {
    // Another client edits the note since this screen read it: the save is refused (changed since), the prompt comes back.
    const m = madeScreen("daily-test")!;
    const now = (await board.get(m.id))!;
    await board.update(now.id, now.text.replace("A screen made in the door", "A screen made in the door (tidied)"), now.revision!, { kind: "agent", id: "tidier" });
    await mine("screen.save", {});
    key({ kind: "enter" });                                            // the prompt's text is the screen's own title
    await until(() => text().includes("save this screen as"), "the prompt came back");
    key({ kind: "esc" });
  }, 15_000);

  test("an agent's save of daily test answers the slug it saved under; the same refusals, nothing silent", async () => {
    const saved = await app.act({ action: "screen.save", args: { name: "Night Shift" }, as: "namer-665" }) as any;
    expect(saved).toMatchObject({ screen: "night-shift", title: "Night Shift", slug: "night-shift", created: true });
    expect((await board.get(saved.note))!.author).toBe("namer-665");
    await expect(app.act({ action: "screen.save", args: { name: "desk" }, as: "namer-665" })).rejects.toThrow(/built-in screen's name/);
    await expect(app.act({ action: "screen.save", args: { name: "  " }, as: "namer-665" })).rejects.toThrow(/needs name=/);
    await expect(app.act({ action: "screen.save", args: { name: "!!" }, as: "namer-665" })).rejects.toThrow(/needs letters/);
    // Another door reads it from the outline: the title and the slug both survive.
    forgetScreenNotes();
    await loadScreenNotes(board);
    expect(screenTitle("night-shift")).toBe("Night Shift");
    expect(resolveScreen("night shift")).toBe("night-shift");
  });
});

describe.skipIf(!outliner)("a made screen can't hold itself", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const top = () => app.screens().at(-1) as Desk & Record<string, any>;
  const mountOf = (name: string) => `{"t":"leaf","kind":"screen","name":"${name}-mount","screen":"${name}"}`;
  /** A made screen `name` (in memory, as a screen note read) whose layout mounts `holds` beside a tree. */
  const made = (name: string, holds: string[]) => register({
    name, title: name, id: `00000000-0000-4000-8000-${String(madeIds++).padStart(12, "0")}`, revision: 1,
    spec: readSpec({ name, title: name, layouts: true, layout: { focus: "tree", root: holds.length ? { t: "split", dir: "row", weights: holds.map(() => 1).concat([1]), kids: [{ t: "leaf", kind: "tree", name: "tree" }, ...holds.map(h => JSON.parse(mountOf(h)))] } : { t: "leaf", kind: "tree", name: "tree" } } }),
  });
  let madeIds = 1;
  const shown = (name: string) => { const d = openScreen(name) as Desk & Record<string, any>; app.push(d); d.render(d.ctx); return d; };
  const mounts = (d: Desk & Record<string, any>) => (d.layoutGet().tiles as any[]).filter(t => t.kind === "screen");

  beforeAll(async () => {
    process.env.EP0CH_STATE = `${scratch.root}/door`;
    board = new SocketBoard(await scratch.start());
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    app.push(new MainMenu());
    forgetScreenNotes();
  }, 30_000);
  afterAll(async () => { for (const s of app?.screens() ?? []) (s as any).dispose?.(); forgetScreenNotes(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("the rule: itself, A and B holding each other, a chain too deep; the message is the chain", () => {
    made("loop-self", ["loop-self"]);
    made("loop-a", ["loop-b"]); made("loop-b", ["loop-a"]);
    expect(mountProblem(["loop-self"], "loop-self")).toBe("a screen can't hold itself: loop-self → loop-self");
    expect(mountProblem(["loop-a"], "loop-b")).toBe("a screen can't hold itself: loop-a → loop-b → loop-a");
    expect(mountProblem([], "loop-a")).toContain("loop-a → loop-b → loop-a");
    made("deep-1", ["deep-2"]); made("deep-2", ["deep-3"]); made("deep-3", ["deep-4"]); made("deep-4", ["deep-5"]); made("deep-5", []);
    expect(MAX_MOUNT_DEPTH).toBe(4);
    expect(mountProblem(["deep-1"], "deep-2")).toBe(`mounts nest at most 4 deep: deep-1 → deep-2 → deep-3 → deep-4 → deep-5`);
    expect(mountProblem(["deep-2"], "deep-3")).toBeNull();
    expect(mountProblem(["desk"], "daily-test-not-a-screen")).toBeNull();
  });

  test("tile.open kind=screen refuses a mount of the screen it is on, of one that holds it, and one that nests too deep", async () => {
    made("fresh", []);
    const d = shown("fresh");
    await expect(d.dispatch.act({ action: "tile.open", args: { kind: "screen", screen: "fresh" }, tile: "tree" }, { kind: "user" })).rejects.toThrow("a screen can't hold itself: fresh → fresh");
    made("holder", ["fresh"]);                                         // holder mounts fresh: fresh can't mount holder
    await expect(d.dispatch.act({ action: "tile.open", args: { kind: "screen", screen: "holder" }, tile: "tree" }, { kind: "user" })).rejects.toThrow("fresh → holder → fresh");
    const e = shown("deep-1");
    expect(mounts(e).map(t => t.mount.problem)).toEqual([expect.stringContaining("mounts nest at most 4 deep")]);
    app.pop(); app.pop();
  });

  test("a saved screen that holds itself (or A and B each other) comes back with the inner mount a place holder saying why; nothing crashes", () => {
    const a = shown("loop-a");
    // loop-a mounts loop-b, which mounts loop-a: the loop is seen from the first mount (its saved spec is walked), so
    // that one is the place holder; the screen itself still opens.
    const [m1] = mounts(a);
    expect(m1.mount).toMatchObject({ screen: "loop-b", problem: "a screen can't hold itself: loop-a → loop-b → loop-a" });
    expect(m1.title).toContain("a screen can't hold itself");
    expect(a.render(a.ctx).lines.join("\n")).toContain("a screen can't hold itself");
    const s = shown("loop-self");
    expect(mounts(s)[0].mount.problem).toBe("a screen can't hold itself: loop-self → loop-self");
    expect(s.render(s.ctx).lines.join("\n")).toContain("a screen can't hold itself");
    // The cyclic save, as a restart reads it: a new desk from the saved state, the same place holder.
    const saved = JSON.parse(JSON.stringify((s as any).savedState()));
    const again = new Desk(readSpec({ name: "loop-self", title: "loop-self", layouts: true, layout: { root: { t: "leaf", kind: "tree", name: "tree" } } }), { saved, writes: false, chain: [] }) as Desk & Record<string, any>;
    app.push(again); again.render(again.ctx);
    expect(mounts(again)[0]?.mount.problem).toBe("a screen can't hold itself: loop-self → loop-self");
  });
});

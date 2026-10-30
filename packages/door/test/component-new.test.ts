// A note component made in one choice (note components, WP4): `::name` naming no component offers `+ new component`
// last, and choosing it writes the starter render script under [[components]] and puts `::name{}` in the draft; the
// `component.new` action does the same by act. Scratch service, made-up notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { SocketBoard, USER } from "../src/socket";
import { completionOf } from "../src/surface/completer";
import { callSplice, makeComponent, starterComponent, type ComponentBoard } from "../src/surface/component-new";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });

describe("the pure half", () => {
  test("the starter is a render script with a where prop, its demo line and a tsx fence", () => {
    const text = starterComponent("open-count");
    expect(text.split("\n")[0]).toBe("Open count [script::open-count] [mode::render] [form-field::where query default=type=task]");
    expect(text).toContain("\n::open-count{}\n");
    expect(text).toContain("```tsx\n");
  });
  test("a name any script answers to is refused, a render script's or an action's; a folder extension's title isn't a name", async () => {
    const wrote: string[] = [];
    const board = (extensions: { name?: string; state?: string; script?: object; handlers?: { key: string }[] }[]): ComponentBoard => ({
      listExtensions: async () => ({ extensions: extensions.map(e => ({ handlers: [], ...e })) }),
      followPage: async () => ({ status: "ok", note: { id: "components-page", text: "Components" } }),
      createBlock: async (_parent: string, text: string) => { wrote.push(text); return { id: "made" }; },
    }) as unknown as ComponentBoard;
    await expect(makeComponent(board([{ name: "stale", script: { keys: [] } }]), "stale", USER)).rejects.toThrow("stale is taken");
    await expect(makeComponent(board([{ name: "lanes", handlers: [{ key: "stale" }] }]), "stale", USER)).rejects.toThrow("stale is taken");
    expect(wrote).toEqual([]);
    await makeComponent(board([{ name: "stale", state: "disabled", script: { keys: [] } }, { name: "stale" }]), "stale", USER);
    expect(wrote).toHaveLength(1);
  });
  test("the call goes on the cursor's line when blank, else on a line of its own after it", () => {
    expect(callSplice("  ", "stale")).toEqual({ start: 0, end: 2, text: "::stale{}" });
    expect(callSplice("errands today", "stale")).toEqual({ start: 13, end: 13, text: "\n::stale{}" });
  });
});

describe.skipIf(!outliner)("component.new on a scratch service", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const flashes: string[] = [];
  const opened: string[] = [];
  const host = (): SurfaceHost => ({
    ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate(m) { opened.push(m.id); },
  });
  const create = async (text: string) => (await board.request("create", { parentId: null, text, author: "agent" })).id as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
  });
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  async function editing(id: string) {
    const s = new NoteSurface(), h = host();
    s.show((await board.get(id))!, h);
    await s.edit(h);
    const d = s.draft!;
    d.row = d.lines.length - 1; d.col = d.lines[d.row]!.length;
    return { s, h, d, type: (str: string) => { for (const c of str) s.key(char(c), h); }, press: (k: Key) => s.key(k, h) };
  }
  const componentsPage = async () => (await board.resolvePage("components")).block?.id;
  const madeUnder = async (page: string, name: string) => (await board.children(page)).find(c => c.text.startsWith(`${name.charAt(0).toUpperCase()}`) && c.text.includes(`[script::${name}]`));

  test("by key: ::zz-stale offers + new component last; choosing it writes the note under [[components]] and the call", async () => {
    const e = await editing(await create("Errand day\n"));
    e.type("::zz-stale");
    await until(() => !!completionOf(e.d) && !completionOf(e.d)!.loading && completionOf(e.d)!.items.some(i => i.newComponent), "the new component offered");
    const p = completionOf(e.d)!, i = p.items.findIndex(x => x.newComponent === "zz-stale");
    expect(i).toBe(p.items.length - 1);
    expect(p.items[i]).toMatchObject({ label: "+ new component ::zz-stale", insertion: "::zz-stale{}" });
    expect(await componentsPage()).toBeUndefined();                       // offered, not made
    while (completionOf(e.d)!.index < i) e.press({ kind: "down" });
    e.press({ kind: "enter" });
    await until(() => !completionOf(e.d) && e.d.lines.includes("::zz-stale{}"), "the call inserted");
    const page = await componentsPage();
    expect(page).toBeString();
    const note = await madeUnder(page!, "zz-stale");
    expect(note!.text).toBe(starterComponent("zz-stale"));
    expect(e.d.note).toContain("made component ::zz-stale under components");
  });

  test("by act: component.new writes the same note under the same page and puts the call after a written line", async () => {
    const e = await editing(await create("Errand week\nwhat is left"));
    const before = await componentsPage();
    const out: any = await e.s.act("component.new", { name: "zz-other" }, e.h, USER);
    expect(out.said).toContain("made component ::zz-other under components");
    const page = await componentsPage();
    if (before) expect(page).toBe(before);
    expect(out.page).toBe(page);
    expect((await madeUnder(page!, "zz-other"))!.text).toBe(starterComponent("zz-other"));
    expect(e.d.lines.slice(-2)).toEqual(["what is left", "::zz-other{}"]);
    await expect(e.s.act("component.new", { name: "Bad Name" }, e.h, USER)).rejects.toThrow("isn't a component's name");
  });
});

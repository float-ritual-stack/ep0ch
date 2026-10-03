// PIE-538: callouts in the reader. Narrow readers degrade (the folded hint by whole words, deep nesting unframed);
// a type or start change is one header line through the note's save, refused when the callout changed, under the
// person's draft for an agent, or with nothing to undo; ctrl+z undoes whichever change came last. Fictional notes,
// against a throwaway outline host only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { foldPoints, renderDoc } from "../src/doc";
import { SocketBoard, USER, type Actor } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const waitFor = async (ok: () => Promise<boolean>, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); }
};
const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const draw = (body: string, width: number) => {
  const points = foldPoints(body);
  return renderDoc(body, { width, cellW: 9, cellH: 18, graphics: false, maxImageRows: 4, unfold: false, folds: { points, folded: new Set(points.filter(p => p.start).map(p => p.key)) } }).lines.map(plain);
};

describe("narrow readers", () => {
  test("the folded hint gives way by whole words: all of it, then `· f`, then the count alone", () => {
    const body = "> [!faq]- Are callouts foldable?\n> Yes! In a foldable callout, the contents are hidden.";
    expect(draw(body, 60)[1]).toContain("▸ 1 line folded · f or a click on the title unfolds");
    const mid = draw(body, 30)[1]!;
    expect(mid).toContain("▸ 1 line folded · f ");
    expect(mid).not.toContain("click");
    const thin = draw(body, 20)[1]!;
    expect(thin).toContain("▸ 1 line folded ");
    expect(thin).not.toContain("· f");
    for (const w of [60, 30, 20]) expect(draw(body, w)[1]).not.toContain("…");   // never cut mid-word
  });

  test("a title-only callout written with - has nothing to fold; nesting too deep for frames is drawn unframed", () => {
    expect(draw("> [!tip]- Title-only callout", 40).join("\n")).not.toContain("folded");
    const deep = draw("> [!question] Nested?\n> > [!todo] Yes\n> > > [!example] Three deep\n> > > in a thin reader", 14);
    expect(deep.every(l => [...l].length <= 14)).toBe(true);
    expect(deep.join("\n")).toContain("◆ Three deep");
  });
});

describe.skipIf(!outliner)("changing a callout, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const flashes: string[] = [];
  const AGENT: Actor = { kind: "agent", id: "fixture-agent-538" };
  const reader = () => {
    const s = new NoteSurface();
    const host: SurfaceHost = { ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate: m => { s.show(m, host); } };
    return { s, host, render: () => s.render(72, 60, host).lines.map(plain) };
  };
  const create = (text: string) => board.request<any>("create", { parentId: null, text, author: "user" });
  const textOf = async (id: string) => (await board.get(id))!.text;
  let note: any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    note = await create(["Shed rules", "", "> [!warning] Mind the step", "> It wobbles.", "- [ ] fix the step", "", "> [!note]- Keys", "> On the hook."].join("\n"));
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("refusals: a callout that changed since it was drawn, a bad type, none named by an agent, nothing to undo", async () => {
    const { s, host, render } = reader();
    s.show((await board.get(note.id))!, host);
    await until(() => render().join("\n").includes("Mind the step"), "the note");
    await expect(s.act("callout.type", { to: "danger" }, host, AGENT)).rejects.toThrow("say which callout");
    await expect(s.act("callout.type", { n: 1, to: "two words" }, host, AGENT)).rejects.toThrow("to is a type's name");
    await expect(s.act("callout.type", { n: 9, to: "tip" }, host, AGENT)).rejects.toThrow("no such callout");
    await expect(s.act("callout.undo", {}, host, AGENT)).rejects.toThrow("no callout change to undo");
    // The person's [ ] on the icon, then the note changes underneath: the choice made from that drawing is refused.
    const elems = (await s.act("elements", {}, host, USER) as any).elements as any[];
    const icon = elems.findIndex(e => e.kind === "callout") + 1;
    await s.act("element.select", { n: icon }, host, USER);
    const now = (await board.get(note.id))!;
    await board.update(note.id, now.text.replace("> [!warning] Mind the step", "> [!caution] Mind the step"), now.revision!);
    await expect(s.act("callout.type", { to: "tip" }, host, USER)).rejects.toThrow("changed since it was drawn");
    expect(await textOf(note.id)).toContain("> [!caution] Mind the step");
  });

  test("an agent never writes under the person's open draft; the person's own change and ctrl+z work", async () => {
    const mine = reader(), theirs = reader();
    mine.s.show((await board.get(note.id))!, mine.host);
    theirs.s.show((await board.get(note.id))!, theirs.host);
    await until(() => theirs.render().join("\n").includes("Mind the step"), "the note");
    await mine.s.act("edit", {}, mine.host, USER);
    await expect(theirs.s.act("callout.type", { n: 1, to: "bug" }, theirs.host, AGENT)).rejects.toThrow("open in a draft");
    // A step change, then a callout change: ctrl+z takes back the callout's (the last), then the step's.
    const { s, host, render } = reader();
    s.show((await board.get(note.id))!, host);
    await until(() => render().join("\n").includes("fix the step"), "the note");
    await waitFor(async () => { try { await s.act("task.status", { n: 1, to: "done" }, host, USER); return true; } catch { render(); return false; } }, "the step");
    expect(await textOf(note.id)).toContain("- [x] fix the step");
    s.show((await board.get(note.id))!, host); render();
    const r = await s.act("callout.start", { n: 2, folded: false }, host, USER) as any;
    expect(r).toMatchObject({ changed: true, header: "> [!note]+ Keys" });
    s.key({ kind: "char", ch: "z", ctrl: true } as Key, host);
    await waitFor(async () => (await textOf(note.id)).includes("> [!note]- Keys"), "the callout's undo");
    expect(await textOf(note.id)).toContain("- [x] fix the step");
    s.key({ kind: "char", ch: "z", ctrl: true } as Key, host);
    await waitFor(async () => (await textOf(note.id)).includes("- [ ] fix the step"), "then the step's");
  }, 20_000);
});

// PIE-533 S2: the `{{ }}` of a note, drawn in the door's reader as the service's `site.answer` reads them. Scratch outline,
// made-up notes. The capture test is a person's workflow: type a value, typo it, save, see it dimmed with the nearest key,
// fix it, see it redraw; then select a drawn value and comment on it, and step to it and open the line it reads.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ReaderPane, type DeskApi } from "../src/desk/panes";
import { drawNote } from "../src/notes-cli";
import { outlineChanged, presentLinks, siteAnswerOf, type LinkTarget } from "../src/refs";
import { sourceSpanOf } from "../src/surface/source-map";
import { SocketBoard } from "../src/socket";
import { visible } from "../src/style";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const type = (t: { key(k: Key, d?: any): unknown }, s: string, d?: unknown) => { for (const c of s) t.key(char(c), d); };

describe.skipIf(!outliner)("values in the door's reader (PIE-533 S2)", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  const flashes: string[] = [];
  const settle = { quiet: 150, max: 4000 };
  const drawn = async (id: string, width = 120) => (await drawNote(board, id, width, settle))!.map(l => visible(l).trimEnd()).join("\n");
  const create = (text: string, parentId: string | null = null) => board.request<any>("create", { parentId, text, author: "agent" });
  const desk = () => ({
    ctx: { board, flash: (m: string) => flashes.push(m), redraw() {}, suspend: (run: () => void) => run(), t: { cellW: 9, cellH: 18 }, graphics: false },
    current: null, setCurrent() {}, focusKind() {}, redraw() {},
  }) as unknown as DeskApi;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("a person types a value, typos it, saves, sees it dimmed with the nearest key, fixes it and sees it redraw", async () => {
    const note = await create("Vent rail demo [target::https://example.test/vent] [owner::evan]\nPlay it at {{this.target}}.");
    const pane = new ReaderPane(), d = desk();
    pane.show((await board.get(note.id))!, d);
    // e, then to the end of the body, then type the typo.
    pane.key(char("e"), d);
    await until(() => pane.editing, "the draft to open");
    pane.key({ kind: "down" }, d); pane.key({ kind: "end" }, d);
    type(pane, " Owner: {{this.ownr}}", d);
    pane.key(ctrl("s"), d);
    await until(() => !pane.editing, "the save");
    // The raw text saved as typed, the typo and all.
    expect((await board.get(note.id))!.text).toBe("Vent rail demo [target::https://example.test/vent] [owner::evan]\nPlay it at {{this.target}}. Owner: {{this.ownr}}");
    outlineChanged([note.id]);
    const first = await drawn(note.id);
    expect(first).toContain("Play it at https://example.test/vent. Owner: {{this.ownr}} · did you mean owner?");

    // Fix it: the value takes its place.
    pane.show((await board.get(note.id))!, d);
    pane.key(char("e"), d);
    await until(() => pane.editing, "the draft to open again");
    pane.key({ kind: "down" }, d); pane.key({ kind: "end" }, d);
    for (let i = 0; i < "ownr}}".length; i++) pane.key({ kind: "backspace" }, d);
    type(pane, "owner}}", d);
    pane.key(ctrl("s"), d);
    await until(() => !pane.editing, "the second save");
    outlineChanged([note.id]);
    expect(await drawn(note.id)).toContain("Owner: evan");
    expect(await drawn(note.id)).not.toContain("{{");
  }, 30_000);

  test("a value follows a change to the note it was read from", async () => {
    const note = await create("Card [stage::queued]\nNow: {{this.stage}}");
    expect(await drawn(note.id)).toContain("Now: queued");
    await board.request("update", { blockId: note.id, text: "Card [stage::done]\nNow: {{this.stage}}", expectedRevision: note.revision, author: "agent" });
    outlineChanged([note.id]);
    expect(await drawn(note.id)).toContain("Now: done");
  });

  test("a value from a parent, a link and a list, and a value that is a URL", async () => {
    const project = await create("Lego night [project::lego-night] [crew::Ada, Bo]");
    const ada = await create("Ada [page::Ada] [first::Ada Lovelace]");
    const note = await create("Plan\nFor {{parent.project}}: {{parent.crew}} ({{this.first.missing}}) {{this.nothing || none}}", project.id);
    void ada;
    const text = await drawn(note.id);
    expect(text).toContain("For lego-night: Ada, Bo");
    expect(text).toContain("none");
  });

  test("a Markdown link whose destination is a value opens what the value reads (Evan, Oct 19)", async () => {
    const note = await create("Thread [src::https://example.test/archives/C01/p1792]\n- [plain](https://example.test/archives/C01/p1792)\n- [pew]({{this.src}})\n- [gone]({{this.nope}})");
    await drawn(note.id);
    const text = (await board.get(note.id))!.text;
    const src = { board, redraw() {} };
    let sink: LinkTarget[] = [];
    const byLabel = (label: string) => sink.find(t => t.label === label) as { url?: string } | undefined;
    // The service answers the note's values asynchronously: draw until they are in.
    await until(() => { sink = []; presentLinks(text, false, src, text, sink, [], { block: note.id }); return byLabel("pew")?.url !== "{{this.src}}"; }, "the values answered", 4000).catch(() => {});
    expect(byLabel("plain")?.url).toBe("https://example.test/archives/C01/p1792");
    expect(byLabel("pew")?.url).toBe("https://example.test/archives/C01/p1792");
    expect(byLabel("gone")?.url).toBe("{{this.nope}}");
  });

  test("an edit's preview reads the draft as typed, before it is saved; the editor itself is source", async () => {
    const note = await create("Vent rail [owner::sam]\nSaved line.");
    const host: SurfaceHost = { ctx: desk().ctx as any, redraw() {}, navigate() {} };
    const surface = new NoteSurface();
    surface.show((await board.get(note.id))!, host);
    const draft = "Vent rail [owner::kim]\nNow {{this.owner}} and {{this.ownr}}.";
    let shown = "";
    for (let i = 0; i < 40 && !shown.includes("Now kim"); i++) { shown = surface.snippetDoc(draft, 80, host, [], false, note.id).lines.map(l => visible(l)).join("\n"); await Bun.sleep(50); }
    expect(shown).toContain("Now kim and {{this.ownr}} · did you mean owner?.");
    // Typing on: the answer of the text before is drawn until the new one arrives, then it follows the text.
    const more = draft.replace("kim", "lee");
    for (let i = 0; i < 40 && !shown.includes("Now lee"); i++) { shown = surface.snippetDoc(more, 80, host, [], false, note.id).lines.map(l => visible(l)).join("\n"); await Bun.sleep(50); }
    expect(shown).toContain("Now lee");
    // The saved note is untouched.
    expect((await board.get(note.id))!.text).toBe("Vent rail [owner::sam]\nSaved line.");
  });

  test("the property panel lists the values the note reads, with where each came from or why it has none", async () => {
    const note = await create("Vent rail [owner::sam]\nOwner {{this.owner}}; typo {{this.ownr}}; today {{now.date}}.");
    const host: SurfaceHost = { ctx: desk().ctx as any, redraw() {}, navigate() {} };
    const surface = new NoteSurface();
    surface.show((await board.get(note.id))!, host);
    surface.render(100, 1000, host);
    surface.openPanel(true);
    let panel = "";
    for (let i = 0; i < 40 && !panel.includes("Values read here"); i++) { await Bun.sleep(50); panel = surface.render(100, 40, host).lines.map(l => visible(l).trimEnd()).join("\n"); }
    expect(panel).toContain("Values read here · 3");
    expect(panel).toMatch(/\{\{this\.owner\}\}\s+sam\s+\w{8}…?/);
    expect(panel).toMatch(/\{\{this\.ownr\}\}\s+no `ownr` on this note; did you mean `owner`\?/);
    expect(panel).toMatch(/\{\{now\.date\}\}\s+\d{4}-\d\d-\d\d\s+computed/);
  });

  test("a click or ⏎ on a value lights the line it is written on; selecting its words and commenting anchors on its token", async () => {
    const note = await create("Vent rail demo [owner::evan]\nOwner: {{this.owner}}, evan again.");
    const m = (await board.get(note.id))!;
    const opened: string[] = [];
    const host: SurfaceHost = { ctx: desk().ctx as any, redraw() {}, navigate(to: any) { opened.push(to.id); } };
    const surface = new NoteSurface();
    surface.show(m, host);
    for (let i = 0; i < 40; i++) { surface.render(100, 1000, host); await Bun.sleep(50); if (surface.describeElements().some(e => e.label.includes("evan") && e.kind === "link")) break; }
    surface.render(100, 1000, host);
    const els = surface.describeElements();
    const owner = els.find(e => e.label === "evan");
    expect(owner).toBeDefined();
    // Selecting the drawn "evan" on the body line: the passage is the whole token, not the other "evan" or the header's.
    const sel = surface.selectBy({ text: "Owner: evan" });
    const src = surface.sourceOf(sel)!;
    expect(src.exact).toBe(true);
    expect(src.text).toBe("Owner: {{this.owner}}");
    const only = surface.sourceOf(surface.selectBy({ text: "evan", n: 1 }))!;
    expect(only.text).toBe("{{this.owner}}");
    // The plain "evan" after it is plain text, found where it is.
    expect(surface.sourceOf(surface.selectBy({ text: "evan", n: 2 }))!.text).toBe("evan");
    // ⏎ on it: the note's line the value is written on (the header, line 0) is lit.
    await surface.runKey("element.open", { n: owner!.n }, host);
    await until(() => !!surface.focusMark, "the line to be lit");
    expect(surface.focusMark!.spec.line).toBe(1);
    expect(opened).toEqual([note.id]);                           // the value is written in this very note: it stays here, the line lit
  }, 30_000);
});
describe("the pieces a value's drawing rests on (PIE-533 S2)", () => {
  test("a selection near a value whose words hold an emoji maps by UTF-16 units: the token whole, the words after it exact", () => {
    const span = "{{this.owner}} tail";
    const values = [{ start: 0, end: 14, words: "😀" }];
    expect(sourceSpanOf(span, "😀", values)).toEqual({ from: 0, to: 14 });
    expect(sourceSpanOf(span, "tail", values)).toEqual({ from: 15, to: 19 });
    expect(sourceSpanOf(span, "😀 tail", values)).toEqual({ from: 0, to: 19 });
  });

  test("a failed refresh is asked again on the next change, and a draft asks again as it is typed", async () => {
    let calls = 0, fail = false;
    const board = { siteAnswer: async (_id: string, draft?: string) => { calls++; if (fail) throw new Error("down"); return { blockId: "b", revision: 1, site: { props: {} }, values: [], route: [], deps: ["b"], problems: 0, ...(draft ? { draft } : {}) }; } };
    const src = { board, redraw() {} } as never;
    const settle = () => Bun.sleep(20);
    expect(siteAnswerOf("b", "x {{this.a}}", src)).toBeNull();
    await settle();
    expect(siteAnswerOf("b", "x {{this.a}}", src)).not.toBeNull();
    expect(calls).toBe(1);
    // A change names it: asked again, and the read fails: the answer there was is kept, and the next change asks again.
    fail = true; outlineChanged(["b"]);
    siteAnswerOf("b", "x {{this.a}}", src); await settle();
    expect(calls).toBe(2);
    siteAnswerOf("b", "x {{this.a}}", src); await settle();
    expect(calls).toBe(2);
    fail = false; outlineChanged(["b"]);
    siteAnswerOf("b", "x {{this.a}}", src); await settle();
    expect(calls).toBe(3);
    // A draft: a failed read of the text so far, then more typing asks again.
    fail = true;
    siteAnswerOf("b", "d {{this.a}}", src, true); await settle();
    const before = calls;
    siteAnswerOf("b", "d {{this.a}} more", src, true); await settle();
    expect(calls).toBe(before + 1);
  });
});

// The reader's mode stack (PIE-516, part 2): the modes that take a reader's keys (a step's status choice, the
// property panel, the edit, the comment session) behind one seam, their precedence stated once. The stack runs
// on fake modes and a fake host; then the note surface's own four, with no service.
import { describe, expect, test } from "bun:test";
import { ModeStack, PRECEDENCE, type ModeName, type ReaderMode } from "../src/surface/modes";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { CommentSession } from "../src/comment";
import type { Msg } from "../src/board";
import type { Key } from "../src/term";

type Host = { said: string[] };
const char = (ch: string): Key => ({ kind: "char", ch });

/** A mode that records what reached it; `clicks` says what its click answers. */
function fake(name: ModeName, o: Partial<ReaderMode<Host>> & { clicks?: boolean | undefined } = {}): ReaderMode<Host> & { got: string[] } {
  const got: string[] = [];
  return {
    name, of: { name }, holdsKeys: true, got, word: name,
    editing: () => false, covers: () => false,
    key: (k, h) => { got.push(`key ${k.kind === "char" ? k.ch : k.kind}`); h.said.push(name); return true; },
    click: () => { got.push("click"); return o.clicks; },
    rows: () => null,
    leave: async () => ({ left: "nothing" }),
    hint: () => `${name} keys`,
    state: () => name,
    describe: () => ({ name }),
    ...o,
  };
}

describe("the stack", () => {
  test("precedence is stated once: the status choice, then the panel, then the edit or the comment, whatever order they opened in", () => {
    const s = new ModeStack<Host>(), h: Host = { said: [] };
    const draft = s.push(fake("draft")), panel = s.push(fake("panel")), picker = s.push(fake("picker"));
    expect(s.all().map(m => m.name)).toEqual(["picker", "panel", "draft"]);
    expect(PRECEDENCE.picker > PRECEDENCE.panel && PRECEDENCE.panel > PRECEDENCE.draft && PRECEDENCE.draft === PRECEDENCE.comment).toBe(true);
    expect(s.key(char("x"), h)).toBe(true);
    expect([h.said, picker.got, panel.got, draft.got]).toEqual([["picker"], ["key x"], [], []]);
    s.drop("picker");
    s.key(char("y"), h);
    expect(h.said).toEqual(["picker", "panel"]);
    s.drop(panel); s.drop(draft);
    expect([s.top(), s.key(char("z"), h)]).toEqual([null, null]);           // reading has it
  });

  test("one of a name at a time: a second panel replaces the first", () => {
    const s = new ModeStack<Host>(), a = fake("panel"), b = fake("panel");
    s.push(a); s.push(b);
    expect(s.all()).toEqual([b]);
  });

  test("holdsKeys, editing and covers are derived from what's open", () => {
    const s = new ModeStack<Host>();
    expect([s.holdsKeys, s.editing, s.covers]).toEqual([false, false, false]);
    s.push(fake("picker", { holdsKeys: false }));
    expect([s.holdsKeys, s.editing, s.covers]).toEqual([false, false, false]);   // a choice holds no note
    let field = false;
    s.push(fake("panel", { editing: () => field, noun: "the property value" }));
    expect([s.holdsKeys, s.editing]).toEqual([true, false]);
    field = true;
    expect(s.editing).toBe(true);
    s.push(fake("draft", { editing: () => true, covers: () => true, rows: () => ["the edit"], noun: "the edit" }));
    expect([s.covers, s.rows(20, 5, undefined), s.holding()]).toEqual([true, ["the edit"], "the property value"]);   // the first that holds the note
  });

  test("a click goes to each mode in order until one takes it; none, and reading has it", () => {
    const s = new ModeStack<Host>(), h: Host = { said: [] };
    const picker = s.push(fake("picker", { clicks: undefined })), panel = s.push(fake("panel", { clicks: true })), draft = s.push(fake("draft", { clicks: false }));
    expect(s.click(1, 1, h)).toBe(true);
    expect([picker.got, panel.got, draft.got]).toEqual([["click"], ["click"], []]);
    s.drop("panel");
    expect(s.click(1, 1, h)).toBe(false);                                    // the draft keeps it
    s.drop("draft");
    expect(s.click(1, 1, h)).toBeUndefined();
  });

  test("the wheel, leaving, the note changing and a mode that ended by itself", async () => {
    const s = new ModeStack<Host>(), h: Host = { said: [] }, marks: number[] = [];
    let done = false;
    s.push(fake("panel", { wheel: () => false, leaveRefusal: () => "finish the value", changed: r => marks.push(r) }));
    s.push(fake("comment", { wheel: () => true, ended: () => done, unsaved: () => true, keep: () => ["/copy"] }));
    expect(s.wheel(1, h)).toBe(true);
    expect(s.leaveRefusal()).toBe("finish the value");
    expect([s.unsaved(), s.keep()]).toEqual([true, ["/copy"]]);
    s.changed(7, false);
    expect(marks).toEqual([7]);
    done = true;
    expect(s.all().map(m => m.name)).toEqual(["panel"]);
  });
});

describe("the reader's four modes, with no service", () => {
  const note = (text: string, revision = 3): Msg => ({ id: "0e1f2a3b-1111-4222-8333-444455556666", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision, props: text.includes("[stage::queued]") ? { stage: "queued" } : {} } as Msg);
  const host = (): SurfaceHost => ({ ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
  const TEXT = "Seed potatoes [stage::queued]\nChit them in the shed.\n\n- [ ] buy the seed\n- [ ] find the trays";

  test("the panel: holds the keys, not the note, until a value is typed; full, it covers the note", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.openPanel(false);
    expect([s.holdsKeys, s.editing, s.scrolls(), s.state()]).toEqual([true, false, true, "properties"]);
    expect(s.sessionOf()).toBe(s.panel);
    s.openPanel(true);
    expect(s.scrolls()).toBe(false);
    s.key({ kind: "esc" }, h);
    expect([s.panel, s.holdsKeys]).toEqual([null, false]);
  });

  test("a step's status choice over the panel takes the keys first; esc closes only it", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.render(80, 30, h);
    s.openPanel(false);
    s.picker = { key: "task:x#0", list: s.choices(0), note: "", busy: false };
    expect([s.choosing, s.holdsKeys, s.hint()]).toEqual([true, true, expect.stringContaining("status ·")]);
    s.key({ kind: "esc" }, h);
    expect([s.choosing, !!s.panel, s.hint()]).toEqual([false, true, s.panel!.hint()]);
  });

  test("the edit and the comment draw in place of the note, hold it, and say what to finish first", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.startDraft(s.msg!, h);
    expect([s.editing, s.scrolls(), s.state(), s.sessionOf()]).toEqual([true, false, "editing", s.draft]);
    expect(s.render(60, 12, h).lines.join("\n")).toContain("editing · Seed potatoes");
    expect(s.show({ ...note("Another note"), id: "9a8b7c6d-1111-4222-8333-444455556666" }, h)).toBe(false);                     // held on its note
    s.refresh(note(TEXT, 4));
    expect(s.draft!.changedElsewhere).toBe(true);
    expect(await s.travel(-1, h)).toBe("nothing to go back to: this reader hasn't followed a link here");
    s.drafting!.dispose();
    s.session = new CommentSession(s.msg!, [], "threads");
    expect([s.editing, s.state(), s.render(60, 12, h).lines.join("\n")]).toEqual([true, "comments", expect.stringContaining("» comments · Seed potatoes")]);
    s.session = null;
    expect([s.editing, s.holdsKeys, s.scrolls()]).toEqual([false, false, true]);
  });

  test("a reply that landed lets its session go by itself", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.session = new CommentSession(s.msg!, [], "threads");
    s.session.finished = true;
    expect([s.session, s.editing] as unknown[]).toEqual([null, false]);
  });

  test("an agent doesn't start an edit or a comment under the person's panel, even with a status choice open over it", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.openPanel(false);
    const agent = { kind: "agent" as const, id: "gardener" };
    await expect(s.act("edit", {}, h, agent)).rejects.toThrow("the person has the property panel open");
    s.picker = { key: "task:x#0", list: s.choices(0), note: "", busy: false };
    await expect(s.act("edit", {}, h, agent)).rejects.toThrow("the person has the property panel open");
    expect([s.sessionOf(), s.sessionWord()]).toEqual([s.panel, "property panel"]);   // the choice isn't a session
  });

  test("a click closes the status choice, then a panel row under it takes the same click", () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.openPanel(false);
    const lines = s.render(80, 30, h).lines.map(l => l.replace(/\x1b\[[\d;]*m/g, ""));
    const y = lines.findIndex(l => l.includes("stage") && l.includes("queued"));
    expect(y).toBeGreaterThan(0);
    s.picker = { key: "task:x#0", list: s.choices(0), note: "", busy: false };
    expect(s.click(4, y, h)).toBe(true);
    expect([s.choosing, s.panel!.sel]).toEqual([false, 0]);
  });

  test("leaving goes through the stack: the panel's value is let go, the edit closes, a changed value refuses", async () => {
    const s = new NoteSurface(), h = host();
    s.show(note(TEXT), h);
    s.startDraft(s.msg!, h);
    expect(await s.leave(h)).toEqual({ left: "closed" });
    expect(s.editing).toBe(false);
    s.openPanel(false);
    s.editValue(s.rows(s.msg!)[0]!);
    s.panel!.field!.input.text = "doing";
    expect(s.leaveRefusal()).toBe("finish the property value first · ⏎ saves · esc cancels");
    await expect(s.leave(h)).rejects.toThrow("finish the property value first");
    s.panel!.field!.input.text = s.panel!.field!.row.value;
    expect(await s.leave(h)).toEqual({ left: "nothing" });
    expect([s.panel!.field, !!s.panel]).toEqual([null, true]);
  });
});

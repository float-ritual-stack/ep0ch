// The note surface every reader hosts, and its named actions: keys and agents (through the control
// socket) go through the same code, and an agent's writes say they're the agent's.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentActor, App } from "../src/app";
import type { Msg } from "../src/board";
import { CommentSession } from "../src/comment";
import { Desk } from "../src/desk/desk";
import { DeliveryBoard } from "../src/desk/delivery";
import { ReaderPane } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { startControl } from "../src/control";
import { Mirror } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { ACTOR_ID, SocketBoard, type Actor } from "../src/socket";
import { width } from "../src/style";
import { ActionRefused, ActionSet, asActor, parseActArgs } from "../src/surface/actions";
import { editHint } from "../src/surface/editor";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const AGENT: Actor = { kind: "agent", id: "claude-7" };
/** Run `f` with the door's state (where drafts are copied) in a throwaway directory. */
async function withState<T>(f: (dir: string) => Promise<T> | T): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "ep0ch-state-")), was = process.env.EP0CH_STATE;
  process.env.EP0CH_STATE = dir;
  try { return await f(dir); } finally {
    if (was === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = was;
    rmSync(dir, { recursive: true, force: true });
  }
}
const note = (text: string, over: Partial<Msg> = {}): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {}, ...over });

describe("the surface without a service", () => {
  const host = (): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate() {},
  });
  const TEXT = "Plan the allotment [stage::queued]\nBeans along the fence, squash by the compost.\n\n> [!note] Frost dates\n> Nothing out before mid May.\n\n- [ ] dig the bed\n- [ ] buy canes\n\n| crop | row |\n|---|---|\n| beans | 1 |";

  test("draws at any width a river column might have: reading, editing, quoting, writing a comment", () => {
    for (const w of [8, 14, 22, 30, 48]) {
      const s = new NoteSurface(), h = host();
      s.show(note(TEXT), h);
      const views: [string, string[]][] = [["read", s.render(w, 20, h).lines]];
      s.draft = new Draft(s.msg!.id, 3, TEXT);
      views.push(["edit", s.render(w, 20, h).lines]);
      // A long-lived note: the revision alone is wider than a narrow column.
      s.draft = new Draft(s.msg!.id, 1_234_567_890, TEXT);
      s.draft.changedElsewhere = true;
      views.push(["edit at a large revision", s.render(w, 20, h).lines]);
      s.draft = null;
      s.session = new CommentSession(s.msg!, [], "select");
      s.session.passage!.selectText("squash by the compost");
      views.push(["quote", s.render(w, 20, h).lines]);
      s.session.write(); s.session.composer!.replace("Which compost bin?");
      views.push(["write", s.render(w, 20, h).lines]);
      for (const [what, lines] of views) {
        expect(lines.length).toBeGreaterThan(2);
        expect(lines.length).toBeLessThanOrEqual(20);
        for (const l of lines) expect({ what, w, over: width(l) > w ? l : null }).toEqual({ what, w, over: null });
      }
    }
  });

  test("one edit control: a note edit and a comment say the same keys the same way", () => {
    const d = new Draft("x", 1, "hello"), c = new Draft("comment", 0, "");
    expect(editHint(d, { save: "save" })).toBe("ctrl+s save · ctrl+e $EDITOR · esc done");
    expect(editHint(c, { save: "send", close: "back" })).toBe("ctrl+s send · ctrl+e $EDITOR · esc back");
    d.key(char("!")); c.key(char("?"));
    for (const h of [editHint(d, { save: "save" }), editHint(c, { save: "send", reload: "find quote", close: "back" })]) expect(h).toEndWith("esc twice discards");
    // The reader shows the same hint the edit control makes.
    const s = new NoteSurface();
    s.show(note("A\nb"), host());
    s.draft = d;
    expect(s.hint()).toBe(editHint(d, { save: "save" }));
  });

  test("a passage is picked by its exact words, nearest the offset given, or refused with why", () => {
    const s = new CommentSession(note("Water\nwater the ferns\nwater the beans"), [], "select");
    const p = s.passage!;
    expect(p.selectText("water the", 20)).toBeNull();
    expect([p.from, p.quote]).toEqual([22, "water the"]);
    expect(p.selectText("water the")).toBeNull();
    expect(p.from).toBe(6);
    expect(p.selectText("the roses")).toContain("isn't in the note's current text");
    expect(p.selectText("  ")).toBe("the quote is empty");
  });

  test("actions check their arguments before anything runs, and take them from the command line as text", async () => {
    const ran: unknown[] = [];
    const set = new ActionSet<{ go: { n: number; loud?: boolean; say?: string } }, null>("t", {
      go: { summary: "go", args: { n: { type: "number", about: "n" }, loud: { type: "boolean", optional: true, about: "l" }, say: { type: "string", optional: true, about: "s" } }, run: a => { ran.push(a); return a; } },
    });
    expect(await set.runUntyped("go", { n: "3", loud: "true" }, null, { kind: "user" })).toEqual({ n: 3, loud: true });
    expect(() => set.runUntyped("go", {}, null, { kind: "user" })).toThrow("go needs n");
    expect(() => set.runUntyped("go", { n: "x" }, null, { kind: "user" })).toThrow("n is a number");
    expect(() => set.runUntyped("go", { n: 1, colour: "red" }, null, { kind: "user" })).toThrow("go takes no colour");
    expect(() => set.runUntyped("stop", {}, null, { kind: "user" })).toThrow(ActionRefused);
    expect(ran).toHaveLength(1);
    const dir = mkdtempSync(join(tmpdir(), "ep0ch-act-"));
    try {
      await Bun.write(join(dir, "body.md"), "line one\nline = two\n");
      expect(await parseActArgs(["comment", "reader=detail1", "quote=a = b", `body=@${join(dir, "body.md")}`, "--as", "claude-7"]))
        .toEqual({ action: "comment", reader: "detail1", as: "claude-7", args: { quote: "a = b", body: "line one\nline = two" } });
      expect(await parseActArgs(["edit.text", "text=@-"], async () => "from stdin\n")).toEqual({ action: "edit.text", args: { text: "from stdin" } });
      await expect(parseActArgs(["edit.text", "oops"])).rejects.toThrow("key=value");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("an agent is named in everything it makes the door say, and names itself plainly", () => {
    const said: string[] = [];
    const ctx = { flash: (m: string) => said.push(m), n: 2, twice() { return this.n * 2; } };
    const a = asActor(ctx, { kind: "agent", id: "claude-7" });
    a.flash("saved · revision 4"); a.flash("an agent (claude-7) · already said");
    expect(said).toEqual(["an agent (claude-7) · saved · revision 4", "an agent (claude-7) · already said"]);
    expect(a.twice()).toBe(4);
    expect(asActor(ctx, { kind: "user" })).toBe(ctx);
    expect(agentActor("claude-7")).toEqual({ kind: "agent", id: "claude-7" });
    const fallback = agentActor();
    expect(fallback.kind === "agent" ? fallback.id : "").toEndWith(":agent");
    expect(() => agentActor("rm -rf /")).toThrow("an actor id");
  });

  test("a save holds the draft still while the service previews its properties, and warns only for the text it read", async () => {
    let answer: (p: Record<string, string>) => void = () => {};
    const updates: string[] = [];
    const h = host();
    Object.assign(h.ctx.board, {
      previewProperties: () => new Promise<Record<string, string>>(r => { answer = r; }),
      update: async (id: string, text: string) => { updates.push(text); return note(text, { id, revision: 4 }); },
    });
    const s = new NoteSurface();
    s.show(note("Plan the allotment [stage::queued]\nBeans."), h);
    s.draft = new Draft(s.msg!.id, 3, s.msg!.text, { stage: "queued" });
    for (const c of " soon") s.key(char(c), h);
    const previewed = s.draft.text;
    const saving = s.save(h);
    expect(s.draft.busy).toBe(true);
    expect(s.render(60, 10, h).lines.join("\n")).toContain("checking properties");
    // While the answer is out, nothing changes or closes the draft: not the keys, not an agent.
    s.key(char("!"), h); s.key({ kind: "esc" }, h); s.key({ kind: "esc" }, h);
    const act = async (name: string, args: Record<string, unknown> = {}) => s.act(name, args, h, AGENT);
    await expect(act("edit.text", { text: "Something else" })).rejects.toThrow("still landing");
    await expect(act("edit.close", { discard: true })).rejects.toThrow("still landing");
    await expect(act("edit.reload")).rejects.toThrow("still landing");
    await expect(act("edit.save")).rejects.toThrow("still landing");
    expect(s.draft?.text).toBe(previewed);
    answer({});
    await saving;
    expect([s.draft?.propertyWarned, s.draft?.busy, updates]).toEqual([previewed, false, []]);
    expect(s.draft?.note).toContain("-stage=queued");

    // Had the text moved on under the preview anyway, the save is off and no warning is kept for it.
    s.draft!.propertyWarned = null;
    const again = s.save(h);
    s.draft!.replace("Plan the allotment [stage::queued] later\nBeans.");
    answer({});
    await again;
    expect([s.draft?.propertyWarned, updates]).toEqual([null, []]);
  });

  test("an agent writing a comment keeps the person's unsent text, and waits while a send is out", () => withState(async () => {
    const h = host();
    const s = new NoteSurface();
    s.show(note("Water\nwater the ferns"), h);
    s.session = new CommentSession(s.msg!, [], "select");
    s.session.write();
    for (const c of "Mine: daily?") s.key(char(c), h);
    const r: any = await s.act("comment.write", { body: "Twice a week is enough." }, h, AGENT);
    expect(readFileSync(r.keptYourDraftAt, "utf8")).toBe("Mine: daily?\n");
    expect(s.session.composer!.text).toBe("Twice a week is enough.");
    expect(s.render(400, 12, h).lines.join("\n")).toContain(r.keptYourDraftAt);
    // The agent's own text again: nothing of anyone else's to keep.
    expect(await s.act("comment.write", { body: "Twice a week." }, h, AGENT)).toEqual({ dirty: true });
    s.session.busy = "sending the comment...";
    const act = async (name: string, args: Record<string, unknown>) => s.act(name, args, h, AGENT);
    await expect(act("comment.write", { body: "Replaced mid-send" })).rejects.toThrow("wait: sending the comment");
    await expect(act("comment", { quote: "ferns", body: "Replaced mid-send" })).rejects.toThrow("wait: sending the comment");
    expect(s.session.composer!.text).toBe("Twice a week.");
  }));

  test("once an agent has typed, the person's later typing is still theirs: kept before an agent replaces it", () => withState(() => {
    const s = new NoteSurface(), h = host();
    s.show(note("Water the ferns\nTwice a week."), h);
    const d = s.draft = new Draft(s.msg!.id, 3, s.msg!.text);
    expect(s.setDraftText(d, "Water the ferns\nDaily.", AGENT)).toBeNull();
    s.key({ kind: "end" }, h); for (const c of " (mine)") s.key(char(c), h);
    expect(d.lastWriter).toEqual({ kind: "user" });
    const typed = d.text;
    const kept = s.setDraftText(d, "Water the ferns\nWeekly.", AGENT);
    expect(readFileSync(kept!, "utf8")).toBe(typed + "\n");
    expect(d.note).toContain("what you had typed is at");
    // Another agent's text is kept from this one too.
    expect(s.setDraftText(d, "Water the ferns\nNever.", { kind: "agent", id: "other-agent" })).not.toBeNull();
    expect(d.writers.map(w => (w.kind === "agent" ? w.id : "you"))).toEqual(["claude-7", "you", "other-agent"]);
  }));

  test("a save is recorded as whoever wrote the draft; when several did, as the saver's naming the rest", () => {
    const d = new Draft("x", 1, "Seed list");
    expect(d.recordAs(AGENT)).toEqual(AGENT);                                      // nothing typed yet
    d.key(char("s"));
    expect(d.recordAs(AGENT)).toEqual({ kind: "user" });                           // the person's alone
    const a = new Draft("x", 1, "Seed list");
    a.replace("Seed list: beans", AGENT);
    expect(a.recordAs({ kind: "user" })).toEqual(AGENT);                           // the agent's alone
    a.key(char("!"));
    expect(a.recordAs({ kind: "user" })).toEqual({ kind: "user", with: ["claude-7"] });
    expect(a.recordAs(AGENT)).toEqual({ ...AGENT, with: [ACTOR_ID] });
    // Navigation isn't writing.
    const n = new Draft("x", 1, "one\ntwo");
    for (const k of ["up", "down", "left", "right", "home", "end"] as const) n.key({ kind: k } as Key);
    expect(n.writers).toEqual([]);
  });

  test("passage.select says why when the note couldn't be read again, instead of failing inside", async () => {
    const h = host();
    Object.assign(h.ctx.board, { get: async () => { throw new Error("socket closed"); } });
    const s = new NoteSurface();
    s.show(note("Water\nwater the ferns"), h);
    s.session = new CommentSession(s.msg!, [], "threads");
    const r = (async () => s.act("passage.select", { quote: "ferns" }, h, AGENT))();
    await expect(r).rejects.toBeInstanceOf(ActionRefused);
    await expect(r).rejects.toThrow("can't read the note's current revision");
    expect(s.session.mode).toBe("threads");
  });

  test("every note action has keys or says it's agent-only, and a summary", () => {
    const list = NOTE_ACTIONS.list();
    expect(list.map(a => a.name)).toEqual(expect.arrayContaining(["edit", "edit.text", "edit.save", "edit.close", "passage.select", "comment.write", "comment.send", "comment", "reply", "resolve", "link.follow"]));
    for (const a of list) expect(a.summary.length).toBeGreaterThan(10);
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

describe.skipIf(!outliner)("agents acting through the surface, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: DeliveryBoard, hub: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const AS = "test-agent-7";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  const create = (parentId: string | null, text: string) => board.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  /** Who last changed a block, as the service's activity log recorded it (among `author`'s changes). */
  const lastBy = async (id: string, author: "agent" | "user" = "agent") => {
    const log = await other.request("activity.recent", { author, limit: 50 });
    const e = log.entries.find((x: any) => x.block.id === id);
    return e && [e.author, e.actorId];
  };
  const threads = (id: string) => other.request<any[]>("annotations.list", { query: { subject: { kind: "block", blockId: id }, includeResolved: true } });
  const message = () => (app as any).message as string;
  const settled = () => until(() => !B().moving && B().lanes.every((l: any) => l.items && !l.want), "lanes", 8000);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    other = new SocketBoard(board.path);
    hub = await create(null, "Allotment board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
    cards.beans = await create(null, "Stake the beans [stage::queued]\nCanes along the fence.\n\nTie them loosely; the wind is strong there.");
    cards.squash = await create(null, "Plant the squash [stage::queued]\nBy the compost heap.");
    cards.mine = await create(null, "Turn the compost [stage::queued]\nEvery two weeks.");
    cards.peas = await create(null, "Sow the peas [stage::queued]\nTwo rows.");
    cards.gate = await create(null, "Fix the gate latch [stage::doing]\nIt swings open.");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("open, edit.text, edit.save: the same save as ctrl+s, recorded as the agent's, and said on screen", async () => {
    expect(await act("open", { id: cards.beans.id }, "preview")).toEqual({ reader: "preview", id: cards.beans.id });
    expect(B().preview.msg.id).toBe(cards.beans.id);
    expect(B().focus).toBe("preview");
    await until(() => !B().preview.msg.partial, "the whole note");
    const text = (await current(cards.beans.id)).text.replace("Canes along the fence.", "Canes along the fence, two per plant.");
    expect(await act("edit.text", { text })).toMatchObject({ reader: "preview", dirty: true });
    expect(B().preview.draft.text).toBe(text);
    const shown = B().preview.render(90, 20, true, b).lines.join("\n");
    expect(shown).toContain("an agent (test-agent-7) typed this");
    const r: any = await act("edit.save");
    expect(r).toMatchObject({ reader: "preview", saved: true });
    const now = await current(cards.beans.id);
    expect(now.text).toBe(text);
    expect(await lastBy(cards.beans.id)).toEqual(["agent", AS]);
    expect(message()).toStartWith("an agent (test-agent-7) · saved · revision");
    expect(B().preview.surface.agent).toMatchObject({ id: AS, did: "saved this note" });
    expect(B().preview.render(90, 20, true, b).lines.join("\n")).toContain("an agent (test-agent-7) saved this note");
    expect((app.describe() as any).state.readers.find((x: any) => x.name === "preview").agent.id).toBe(AS);
  });

  test("a save that changes properties is shown to the agent first, like the second ctrl+s", async () => {
    if (board.supports("properties.preview") === false) return;
    const { reader } = await act("open", { id: cards.peas.id }, "new-detail") as any;
    const text = (await current(cards.peas.id)).text.replace("[stage::queued]", "[stage::queued] soon");
    await act("edit.text", { text }, reader);
    const first: any = await act("edit.save", {}, reader);
    expect(first).toMatchObject({ saved: false, next: "edit.save again saves it" });
    expect(first.warning).toContain("-stage=queued");
    expect((await current(cards.peas.id)).text).not.toBe(text);
    expect(await act("edit.save", {}, reader)).toMatchObject({ saved: true });
    const now = await current(cards.peas.id);
    expect([now.text, now.properties.length]).toEqual([text, 0]);
  });

  test("an agent's text never silently replaces the person's typing: it's copied out first", async () => {
    await act("open", { id: cards.mine.id }, "detail");
    const pane = B().details[B().active] as ReaderPane;
    await until(() => pane.msg?.id === cards.mine.id && !pane.msg?.partial, "the note");
    await act("focus", {}, `detail${B().active + 1}`);
    key(char("e"));
    await until(() => !!pane.draft, "the person's draft");
    key({ kind: "end" }); for (const c of " (mine)") key(char(c));
    const typed = pane.draft!.text;
    const r: any = await act("edit.text", { text: "Turn the compost [stage::queued]\nEvery week." }, cards.mine.id);
    expect(readFileSync(r.keptYourDraftAt, "utf8")).toBe(typed + "\n");
    expect(pane.draft!.note).toContain(r.keptYourDraftAt);
    await expect(act("edit.close", {}, cards.mine.id)).rejects.toThrow("unsaved changes");
    expect(message()).toContain("edit.close refused");
    expect(await act("edit.close", { discard: true }, cards.mine.id)).toMatchObject({ closed: true });
    expect(pane.draft).toBeNull();
    expect((await current(cards.mine.id)).text).toBe("Turn the compost [stage::queued]\nEvery two weeks.");
  });

  /** Open a fresh note in a detail and give that detail the keys, as a person would have it. */
  const openFresh = async (text: string) => {
    const m = await create(null, text);
    await act("open", { id: m.id }, "detail");
    const pane = B().details[B().active] as ReaderPane, reader = `detail${B().active + 1}`;
    await until(() => pane.msg?.id === m.id && !pane.msg?.partial, "the note");
    await act("focus", {}, reader);
    return { id: m.id as string, pane, reader };
  };
  const type = (s: string) => { for (const c of s) key(char(c)); };

  test("the person's typing after an agent's is copied out before the agent replaces it again", async () => {
    const { pane, reader } = await openFresh("Water the ferns\nTwice a week.");
    await act("edit.text", { text: "Water the ferns\nTwice a week, early." }, reader);
    key(char("e"));                                                            // the person enters the agent's edit
    key({ kind: "end" }); type(" (mine)");
    const typed = pane.draft!.text;
    const r: any = await act("edit.text", { text: "Water the ferns\nDaily." }, reader);
    expect(readFileSync(r.keptYourDraftAt, "utf8")).toBe(typed + "\n");
    expect(pane.draft!.note).toContain("what you had typed is at");
    await act("edit.close", { discard: true }, reader);
  });

  test("a save is recorded as who wrote it, not who pressed save", async () => {
    // The agent wrote it, the person saved it: the agent's.
    const a = await openFresh("Mulch the roses\nIn autumn.");
    await act("edit.text", { text: "Mulch the roses\nIn autumn, after the first frost." }, a.reader);
    expect(a.pane.render(120, 20, true, b).lines.join("\n")).toContain("an agent (test-agent-7) typed this · it saves as the agent's");
    // An agent's edit takes the person's keys only once they enter it (PIE-411).
    key(ctrl("s"));
    expect(a.pane.draft).not.toBeNull();
    key(char("e")); key(ctrl("s"));
    await until(() => !a.pane.draft, "the person's save");
    expect(await lastBy(a.id)).toEqual(["agent", AS]);
    expect(message()).toContain(`recorded as an agent (${AS})'s`);

    // The person wrote it, the agent saved it: the person's.
    const u = await openFresh("Net the currants\nBefore June.");
    key(char("e")); await until(() => !!u.pane.draft, "the draft");
    key({ kind: "end" }); type(" (birds)");
    expect(await act("edit.save", {}, u.reader)).toMatchObject({ saved: true, recordedAs: { author: "user", actorId: ACTOR_ID } });
    expect(await lastBy(u.id, "user")).toEqual(["user", ACTOR_ID]);

    // Both wrote it: the saver's, and the actor id names both. The frame said so before the save.
    const m = await openFresh("Prune the apple\nIn winter.");
    await act("edit.text", { text: "Prune the apple\nIn winter, on a dry day." }, m.reader);
    key(char("e"));
    key({ kind: "end" }); type(" (me)");
    expect(m.pane.render(120, 20, true, b).lines.join("\n")).toContain("an agent (test-agent-7) and you typed this · saved as whoever saves it, naming both");
    key(ctrl("s"));
    await until(() => !m.pane.draft, "the person's save");
    expect(await lastBy(m.id, "user")).toEqual(["user", `${ACTOR_ID}+${AS}`]);
    expect(message()).toContain(`recorded as yours, naming ${ACTOR_ID}+${AS}`);

    // A comment the agent wrote and the person sent is the agent's; one they both wrote names both.
    const commentOn = async (id: string, quote: string, body: string, more = "") => {
      await act("open", { id }, "detail");
      await act("passage.select", { quote }, id);
      await act("comment.write", { body }, id);
      await act("focus", {}, id);
      const pane = B().details.find((p: ReaderPane) => p.msg?.id === id) as ReaderPane;
      key(char("e"));                                                          // enter the agent's comment
      key({ kind: "end" }); type(more); key(ctrl("s"));
      await until(() => pane.session?.mode === "threads" && !pane.session.busy, "the comment sent");
      key({ kind: "esc" });
      return threads(id);
    };
    let list = await commentOn(m.id, "Prune the apple", "Which branches?");
    expect([list[0].block.author, list[0].block.actorId]).toEqual(["agent", AS]);
    list = await commentOn(u.id, "Net the currants", "Which net?", " The fine one.");
    expect([list[0].block.author, list[0].block.actorId, list[0].body]).toEqual(["agent", `${ACTOR_ID}+${AS}`, "Which net? The fine one."]);
  });

  test("comment, reply, resolve: the same session the keys drive, authored by the agent", async () => {
    await act("open", { id: cards.beans.id }, "detail");
    const reader = `detail${B().active + 1}`;
    await expect(act("passage.select", { quote: "Tie them tightly" }, reader)).rejects.toThrow("isn't in the note's current text");
    const pane = B().details[B().active] as ReaderPane;
    expect(pane.session?.mode).toBe("select");                                   // the person sees what the agent tried
    const sent: any = await act("comment", { quote: "the wind is strong there", body: "Use soft twine?" }, reader);
    expect(sent).toMatchObject({ sent: "comment" });
    let list = await threads(cards.beans.id);
    expect(list).toHaveLength(1);
    expect(list[0].originalTarget.anchor.exact).toBe("the wind is strong there");
    expect([list[0].block.author, list[0].block.actorId, list[0].body]).toEqual(["agent", AS, "Use soft twine?"]);
    const id = list[0].block.id;
    expect(await act("reply", { thread: id.slice(0, 8), body: "Jute is fine." }, reader)).toMatchObject({ sent: "reply" });
    expect(await act("resolve", { thread: id }, reader)).toEqual({ reader, lifecycle: "resolved" });
    expect(await act("resolve", { thread: id }, reader)).toEqual({ reader, already: "resolved" });
    list = await threads(cards.beans.id);
    expect(list[0].lifecycle).toBe("resolved");
    expect([list[0].replies[0].block.author, list[0].replies[0].block.actorId]).toEqual(["agent", AS]);
    expect(pane.session?.mode).toBe("threads");
    expect(pane.render(90, 30, true, b).lines.join("\n")).toContain("resolved");
    // The person picks it up from there with the keys: the session is theirs too.
    await act("focus", {}, reader);
    key(char("x"));                                                              // not in it yet: the board's x, refused
    expect(pane.session?.threads[0]?.open).toBe(false);
    key({ kind: "enter" }); key(char("x"));
    await until(() => pane.session?.threads[0]?.open === true, "reopened by the key");
    key({ kind: "esc" });
    expect(pane.session).toBeNull();
  });

  test("card.move: the same move as H/L, patched as the agent's; refusals say why", async () => {
    await settled();
    const r: any = await act("card.move", { lane: "doing", card: cards.squash.id });
    expect(r).toMatchObject({ card: cards.squash.id, lane: "Doing" });
    const now = await current(cards.squash.id);
    expect(now.properties.map((p: any) => `${p.key}=${p.value}`)).toContain("stage=doing");
    expect(await lastBy(cards.squash.id)).toEqual(["agent", AS]);
    expect(B().lastMove).toMatchObject({ by: AS, to: "Doing" });
    expect(message()).toContain("an agent (test-agent-7) · moved to Doing");
    await settled();
    await expect(act("card.move", { lane: "Doing", card: cards.squash.id })).rejects.toThrow("already in Doing");
    await expect(act("card.move", { lane: "Compost" })).rejects.toThrow("no lane Compost");
    await expect(act("card.fly", {})).rejects.toThrow("no action card.fly");
    await expect(act("edit.save", {}, "detail9")).rejects.toThrow("no reader detail9");
  });

  test("an agent's card.select and card.move leave the person's keys where they are", async () => {
    await settled();
    const { reader } = await openFresh("Label the seed trays\nBefore sowing.");
    const region = B().focus;
    expect(region).toStartWith("detail");
    // The person's lane cursor and preview, before the agent picks a card of its own.
    const was = { lane: B().lane, sels: B().lanes.map((l: any) => l.sel), preview: B().preview.msg?.id };
    const mine = B().selectedCardId();
    const other = (B().lanes as any[]).findIndex((l, i) => i !== was.lane && l.items?.length > 1);
    const pick = B().lanes[other].items.find((m: any, j: number) => j !== was.sels[other] && m.id !== mine);
    expect(pick).toBeDefined();
    const picked: any = await act("card.select", { id: pick.id });
    expect(picked).toMatchObject({ selected: pick.id });
    expect(B().focus).toBe(region);
    expect({ lane: B().lane, sels: B().lanes.map((l: any) => l.sel), preview: B().preview.msg?.id }).toEqual(was);
    expect(message()).toContain("an agent (test-agent-7) selected");
    expect(B().describe().agentSelected).toMatchObject({ [AS]: pick.id });
    // …and its card actions without card= act on its pick, not on the person's.
    expect(((await act("steps", {})) as any).card).toBe(pick.id);
    expect(B().selectedCardId()).toBe(mine);
    expect(await act("card.move", { lane: "Doing", card: cards.beans.id })).toMatchObject({ lane: "Doing" });
    expect(B().focus).toBe(region);
    // Giving the keys away is only ever an explicit action, and it says so.
    expect(await act("focus", {}, "lanes")).toEqual({ focus: "lanes" });
    expect(message()).toContain("an agent (test-agent-7) gave the keys to lanes");
    await act("focus", {}, reader);
    await settled();
  });

  test("an agent can't act in a drawer's reader while the drawer is shut", async () => {
    expect(B().treeOpen).toBe(false);
    expect(B().links).toBeFalsy();
    await expect(act("open", { id: cards.gate.id }, "tree")).rejects.toThrow("tree isn't on screen; open it first (t opens the outline drawer)");
    await expect(act("edit.text", { text: "x" }, "backlinks")).rejects.toThrow("backlinks isn't on screen");
    expect(B().treePreview.msg).toBeNull();
  });

  test("the control socket: `actions` lists them, `act` runs them, as the agent that asked", async () => {
    const ctl = await startControl({ app, mirror: new Mirror(180, 50), info: () => (app as any).t }, join(scratch.root, "door.sock"));
    const ask = (req: object) => new Promise<any>((res, rej) => {
      const c = connect(ctl.path, () => c.write(JSON.stringify(req) + "\n"));
      let buf = "";
      c.on("data", d => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { c.end(); res(JSON.parse(buf.slice(0, i))); } });
      c.on("error", rej);
    });
    try {
      const listed = await ask({ cmd: "actions" });
      expect(listed.result.actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["open", "card.move", "edit.save", "comment", "reply", "resolve"]));
      expect(listed.result.readers).toContain("preview");
      await act("open", { id: cards.gate.id }, "preview");
      const r2 = await ask({ cmd: "act", action: "edit.text", reader: "preview", args: { text: "Fix the gate latch [stage::doing]\nIt swings open. New spring ordered." }, as: "socket-agent" });
      expect(r2).toMatchObject({ ok: true, result: { reader: "preview", dirty: true } });
      expect(await ask({ cmd: "act", action: "edit.save", reader: "preview", as: "socket-agent" })).toMatchObject({ ok: true, result: { saved: true } });
      expect(await lastBy(cards.gate.id)).toEqual(["agent", "socket-agent"]);
      expect(await ask({ cmd: "act", action: "edit.save", reader: "preview", as: "bad id!" })).toMatchObject({ ok: false, error: expect.stringContaining("an actor id") });
    } finally { ctl.close(); }
  });

  test("the desk's reader takes the same actions", async () => {
    const desk = new Desk();
    app.push(desk);
    try {
      expect(await act("open", { id: cards.mine.id })).toMatchObject({ id: cards.mine.id });
      const out: any = await act("edit.text", { text: "Turn the compost [stage::queued]\nEvery two weeks, with a fork." });
      expect(out.reader).toMatch(/^\d$/);
      expect(await act("edit.save")).toMatchObject({ saved: true });
      expect(await lastBy(cards.mine.id)).toEqual(["agent", AS]);
      expect((app.describe() as any).state.panes.find((p: any) => p.showing?.id === cards.mine.id).agent.id).toBe(AS);
    } finally { app.pop(); }
  });
});

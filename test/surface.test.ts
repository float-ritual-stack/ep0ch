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
import { SocketBoard } from "../src/socket";
import { width } from "../src/style";
import { ActionRefused, ActionSet, asActor, parseActArgs } from "../src/surface/actions";
import { editHint } from "../src/surface/editor";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const char = (ch: string): Key => ({ kind: "char", ch });
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const note = (text: string, over: Partial<Msg> = {}): Msg => ({ id: "11111111-2222-4333-8444-555555555555", text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision: 3, props: {}, ...over });

describe("the surface without a service", () => {
  const host = (): SurfaceHost => ({
    ctx: { board: { ancestors: async () => [], comments: async () => [] }, flash() {}, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() {}, navigate() {},
  });
  const TEXT = "Plan the allotment [stage::queued]\nBeans along the fence, squash by the compost.\n\n> [!note] Frost dates\n> Nothing out before mid May.\n\n- [ ] dig the bed\n- [ ] buy canes\n\n| crop | row |\n|---|---|\n| beans | 1 |";

  test("draws at any width a river column might have: reading, editing, quoting, writing a comment", () => {
    for (const w of [14, 22, 30, 48]) {
      const s = new NoteSurface(), h = host();
      s.show(note(TEXT), h);
      const views: [string, string[]][] = [["read", s.render(w, 20, h).lines]];
      s.draft = new Draft(s.msg!.id, 3, TEXT);
      views.push(["edit", s.render(w, 20, h).lines]);
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
  /** Who last changed a block, as the service's activity log recorded it. */
  const lastBy = async (id: string) => {
    const log = await other.request("activity.recent", { author: "agent", limit: 50 });
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
    key(char("x"));
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

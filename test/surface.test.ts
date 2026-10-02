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
import { boardScreen } from "../src/desk/screen-specs";
import { ReaderPane } from "../src/desk/panes";
import { Draft } from "../src/edit";
import { draftRule, recordAs } from "../src/draft-session";
import { startControl } from "../src/control";
import { Mirror } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { ACTOR_ID, SocketBoard, type Actor } from "../src/socket";
import { width } from "../src/style";
import { ActionRefused, ActionSet, asActor, parseActArgs, traceActions, type ActionRun } from "../src/surface/actions";
import { editHint } from "../src/surface/editor";
import { NOTE_ACTIONS, NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

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
      s.startDraft({ ...s.msg!, revision: 3, text: TEXT }, h);
      views.push(["edit", s.render(w, 20, h).lines]);
      // A long-lived note: the revision alone is wider than a narrow column.
      s.drafting!.dispose();
      s.startDraft({ ...s.msg!, revision: 1_234_567_890, text: TEXT }, h);
      s.draft!.changedElsewhere = true;
      views.push(["edit at a large revision", s.render(w, 20, h).lines]);
      s.drafting!.dispose();
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
    const s = new NoteSurface();
    s.show(note("A\nb"), host());
    const d = s.startDraft({ ...s.msg!, revision: 1, text: "hello" }, host()).draft, c = new Draft("comment", 0, "");
    expect(editHint(d, { save: "save" })).toBe("ctrl+s save · esc done · ctrl+e $EDITOR · tab indent · shift+tab out · ctrl+p preview");
    expect(editHint(c, { save: "send", close: "back" })).toBe("ctrl+s send · esc back · ctrl+e $EDITOR · tab indent · shift+tab out · ctrl+p preview");
    d.key(char("!")); c.key(char("?"));
    for (const h of [editHint(d, { save: "save" }), editHint(c, { save: "send", reload: "find quote", close: "back" })]) expect(h).toContain(" · esc twice puts it aside · ");
    // The reader shows the same hint the edit control makes.
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
      go: { summary: "go", touches: "nothing", replay: "safe", args: { n: { type: "number", about: "n" }, loud: { type: "boolean", optional: true, about: "l" }, say: { type: "string", optional: true, about: "s" } }, run: a => { ran.push(a); return a; } },
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
      // tile= names the tile; reader= and --reader, its older names, still do (A5).
      expect(await parseActArgs(["tile.close", "tile=detail2"])).toEqual({ action: "tile.close", reader: "detail2", args: {} });
      expect(await parseActArgs(["tile.close", "--tile", "3"])).toEqual({ action: "tile.close", reader: "3", args: {} });
      expect(await parseActArgs(["tile.close", "--reader", "3"])).toEqual({ action: "tile.close", reader: "3", args: {} });
      // Both, naming one tile, is that tile; naming two is refused, never one picked silently.
      expect(await parseActArgs(["tile.close", "tile=3", "reader=3"])).toEqual({ action: "tile.close", reader: "3", args: {} });
      await expect(parseActArgs(["tile.close", "tile=3", "reader=detail1"])).rejects.toThrow("tile= and reader= name two tiles (3, detail1)");
      await expect(parseActArgs(["tile.close", "--reader", "2", "--tile", "3"])).rejects.toThrow("name two tiles");
      await expect(parseActArgs(["edit.text", "oops"])).rejects.toThrow("key=value");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  test("an alias runs its action's one def: listed once with its aliases, traced by the action's name and keys (A4)", async () => {
    const runs: ActionRun[] = [], stop = traceActions(r => runs.push(r));
    try {
      const set = new ActionSet<{ "tile.fold": { on?: boolean } }, { said: string[] }>("t", {
        "tile.fold": {
          summary: "fold", keys: "^W c", touches: "nothing", replay: "safe",
          aliases: ["pane.fold", { name: "reader.shut", keys: "c on a reader", args: {}, map: () => ({ on: true }) }],
          args: { on: { type: "boolean", optional: true, about: "on" } },
          run: ({ on }, h) => { h.said.push(String(on)); return { on }; },
        },
      });
      const h = { said: [] as string[] };
      expect(set.list()).toEqual([{ name: "tile.fold", summary: "fold", keys: "^W c; c on a reader", args: { on: { type: "boolean", optional: true, about: "on" } }, scope: "t", aliases: ["pane.fold", "reader.shut"], touches: "nothing", replay: "safe" }]);
      expect(await set.runUntyped("pane.fold", { on: "false" }, h, { kind: "user" })).toEqual({ on: false });
      expect(await set.runUntyped("reader.shut", {}, h, { kind: "user" })).toEqual({ on: true });
      expect(() => set.runUntyped("reader.shut", { on: "false" }, h, { kind: "user" })).toThrow("reader.shut takes no on");
      expect(runs.map(r => [r.name, r.keys])).toEqual([["tile.fold", "^W c; c on a reader"], ["tile.fold", "^W c; c on a reader"]]);
      expect([set.has("pane.fold"), set.canonical("pane.fold"), set.canonical("tile.fold")]).toEqual([true, "tile.fold", "tile.fold"]);
      // An alias that answered differently gives its older answer; the action's own name gives the action's.
      const answered = new ActionSet<{ "tile.pin": Record<string, never> }, null>("t", { "tile.pin": { summary: "", touches: "nothing", replay: "safe", args: {}, aliases: [{ name: "pane.pin", answer: (r: { tile: string }) => ({ ...r, pane: r.tile }) }], run: () => ({ tile: "tree" }) } });
      expect(await answered.runUntyped("pane.pin", {}, null, { kind: "user" })).toEqual({ tile: "tree", pane: "tree" });
      expect(await answered.runUntyped("tile.pin", {}, null, { kind: "user" })).toEqual({ tile: "tree" });
      // An action defined later under an alias's name (an extension's) is that action.
      answered.define("pane.pin", { summary: "", touches: "nothing", replay: "safe", args: {}, run: () => "its own" });
      expect(await answered.runUntyped("pane.pin", {}, null, { kind: "user" })).toBe("its own");
      expect(() => new ActionSet<{ a: object; b: object }, null>("t", { a: { summary: "", touches: "nothing", replay: "safe", aliases: ["b"], args: {}, run: () => 0 }, b: { summary: "", touches: "nothing", replay: "safe", args: {}, run: () => 0 } })).toThrow("b is already an action");
      // An action defined again (an extension reloaded) takes its aliases with it.
      set.forget("tile.fold");
      expect(set.has("pane.fold")).toBe(false);
    } finally { stop(); }
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
    s.startDraft({ ...s.msg!, revision: 3, props: { stage: "queued" } }, h);
    for (const c of " soon") s.key(char(c), h);
    const previewed = s.draft!.text;
    const saving = s.save(h);
    expect(s.draft!.busy).toBe(true);
    expect(s.render(60, 10, h).lines.join("\n")).toContain("checking properties");
    // While the answer is out, nothing changes or closes the draft: not the keys, not an agent.
    s.key(char("!"), h); s.key({ kind: "esc" }, h); s.key({ kind: "esc" }, h);
    const act = async (name: string, args: Record<string, unknown> = {}) => s.act(name, args, h, AGENT);
    // Replacing the text is the agent's to ask (the person's is copied out first), and waits for the save; leaving or
    // reloading the person's draft is never an agent's (the draft rule, checked before the action runs).
    await expect(act("edit.text", { text: "Something else" })).rejects.toThrow("the person is typing in reader; an agent doesn't replace their text");
    await expect(act("edit.close", { discard: true })).rejects.toThrow("the person is in this edit");
    await expect(act("edit.reload")).rejects.toThrow("this draft is the person's");
    await expect(act("edit.save")).rejects.toThrow("the person is in this edit");
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

  test("an agent never replaces a comment the person is writing: refused while they type, and while they don't (round 3, deferred)", () => withState(async () => {
    const h = host();
    const s = new NoteSurface();
    s.show(note("Water\nwater the ferns"), h);
    s.session = new CommentSession(s.msg!, [], "select");
    s.session.write();
    for (const c of "Mine: daily?") s.key(char(c), h);
    const act = async (name: string, args: Record<string, unknown>) => s.act(name, args, h, AGENT);
    // Typed in: refused before anything runs, their text and cursor as they were.
    await expect(act("comment.write", { body: "Twice a week is enough." })).rejects.toThrow("the person is typing in reader; an agent doesn't replace their text · block.mark gets their attention");
    expect([s.session.composer!.text, s.session.composer!.row, s.session.composer!.col, s.session.composer!.note]).toEqual(["Mine: daily?", 0, 12, ""]);
    // Theirs while they aren't typing in it too: the draft rule says whose it is, and names the way in.
    expect(draftRule(AGENT, "text", { session: s.session.writing })).toBe(`the person is writing the comment on “Water” here; an agent doesn't replace their text · block.mark gets their attention, or wait until it's sent or closed (an @claude-7 line in it invites one reply)`);
    // Picking a passage in it is typing in the person's comment: the draft rule refuses it before anything runs.
    await expect(act("comment", { quote: "ferns", body: "Replaced" })).rejects.toThrow("this draft is the person's");
    expect(s.session.composer!.text).toBe("Mine: daily?");
  }));

  test("invited by the person's @name line, an agent's comment.write rewrites the text above it, once; nothing else opens", () => withState(async () => {
    const h = host();
    const s = new NoteSurface();
    s.show(note("Water\nwater the ferns"), h);
    s.session = new CommentSession(s.msg!, [], "select");
    s.session.write();
    for (const c of "how often, daily") s.key(char(c), h);
    s.key({ kind: "enter" }, h);
    for (const c of "@claude-7 tidy") s.key(char(c), h);
    const c = s.session.composer!, at = [c.row, c.col];
    const act = async (args: Record<string, unknown>) => s.act("comment.write", { body: "How often: daily?", ...args }, h, AGENT);
    // No invitation yet, a made-up one, or one without the base it was written on: refused, their text as it was.
    await expect(act({ invitation: "inv-made-up", base: "0" })).rejects.toThrow("no open invitation inv-made-up for claude-7");
    const inv = s.session.writing!.invite("claude-7")!;
    await expect(act({ invitation: inv.id })).rejects.toThrow("invitation= needs base=");
    await expect(s.act("comment.write", { body: "x", invitation: inv.id, base: inv.base }, h, { kind: "agent", id: "other-agent" })).rejects.toThrow(`no open invitation ${inv.id} for other-agent`);
    // edit.text takes no invitation: an invitation= sent with it opens nothing.
    await expect(s.act("edit.text", { text: "x", invitation: inv.id }, h, AGENT)).rejects.toThrow("edit.text takes no invitation");
    expect(c.text).toBe("how often, daily\n@claude-7 tidy");
    // Invited: the range above the line is rewritten, the line and the cursor's place in it kept; one reply.
    expect(await act({ invitation: inv.id, base: inv.base })).toEqual({ applied: true, dirty: true });
    expect(c.text).toBe("How often: daily?\n@claude-7 tidy");
    expect([c.row, c.col]).toEqual(at);
    await expect(act({ invitation: inv.id, base: inv.base })).rejects.toThrow(`no open invitation ${inv.id}`);
  }));

  test("once an agent has typed, the person's later typing is still theirs: kept before an agent replaces it", () => withState(() => {
    const s = new NoteSurface(), h = host();
    s.show(note("Water the ferns\nTwice a week."), h);
    const ds = s.startDraft({ ...s.msg!, revision: 3 }, h), d = ds.draft;
    expect(ds.replace("Water the ferns\nDaily.", AGENT)).toBeNull();
    s.key({ kind: "end" }, h); for (const c of " (mine)") s.key(char(c), h);
    expect(d.lastWriter).toEqual({ kind: "user" });
    const typed = d.text;
    const kept = ds.replace("Water the ferns\nWeekly.", AGENT);
    expect(readFileSync(kept!, "utf8")).toBe(typed + "\n");
    expect(d.note).toContain("what you had typed is at");
    // Another agent's text is kept from this one too.
    expect(ds.replace("Water the ferns\nNever.", { kind: "agent", id: "other-agent" })).not.toBeNull();
    expect(d.writers.map(w => (w.kind === "agent" ? w.id : "you"))).toEqual(["claude-7", "you", "other-agent"]);
  }));

  test("a save is recorded as whoever wrote the draft; when several did, as the saver's naming the rest", () => {
    const d = new Draft("x", 1, "Seed list");
    expect(recordAs(d, AGENT)).toEqual(AGENT);                                      // nothing typed yet
    d.key(char("s"));
    expect(recordAs(d, AGENT)).toEqual({ kind: "user" });                           // the person's alone
    const a = new Draft("x", 1, "Seed list");
    a.replace("Seed list: beans", AGENT);
    expect(recordAs(a, { kind: "user" })).toEqual(AGENT);                           // the agent's alone
    a.key(char("!"));
    expect(recordAs(a, { kind: "user" })).toEqual({ kind: "user", with: ["claude-7"] });
    expect(recordAs(a, AGENT)).toEqual({ ...AGENT, with: [ACTOR_ID] });
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
  let board: SocketBoard, other: SocketBoard, app: App, b: Desk, hub: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const AS = "test-agent-7";
  const B = () => BV.view(b);
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, reader, as: AS });
  /** The person has been away from the keys longer than the idle window (an agent may move their screen). */
  const idle = () => { (app as any).lastInput = 0; };
  /** The person's own action, through the board's dispatcher (their key's path). */
  const mine = (action: string, args: Record<string, unknown> = {}, reader?: string) => b.dispatch.act({ action, args, reader }, { kind: "user" });
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
    b = boardScreen(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 2 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("open, edit.text, edit.save: the same save as ctrl+s, recorded as the agent's, and said on screen", async () => {
    const was = BV.where(b);
    // The preview the person reads the lanes through is theirs (round 3, C3): an agent opens beside it.
    await expect(act("open", { id: cards.beans.id }, "preview")).rejects.toThrow(/preview has the person's keys; opening a note there would move what they're reading/);
    const { reader } = await act("open", { id: cards.beans.id }, "new-detail") as { reader: string };
    const P = () => B().details.find((d: ReaderPane) => d.msg?.id === cards.beans.id) as ReaderPane;
    expect(P()).toBeTruthy();
    expect(BV.where(b)).toBe(was);                                  // naming the reader never moves the person's keys (PIE-514)
    await until(() => !P().msg!.partial, "the whole note");
    const text = (await current(cards.beans.id)).text.replace("Canes along the fence.", "Canes along the fence, two per plant.");
    expect(await act("edit.text", { text }, reader)).toMatchObject({ reader, dirty: true });
    expect(P().draft!.text).toBe(text);
    const shown = P().render(90, 20, true, b).lines.join("\n");
    expect(shown).toContain("an agent (test-agent-7) typed this");
    const r: any = await act("edit.save", {}, reader);
    expect(r).toMatchObject({ reader, saved: true });
    const now = await current(cards.beans.id);
    expect(now.text).toBe(text);
    expect(await lastBy(cards.beans.id)).toEqual(["agent", AS]);
    expect(message()).toStartWith("an agent (test-agent-7) · saved · revision");
    expect(P().surface.agent).toMatchObject({ id: AS, did: "saved this note" });
    expect(P().render(90, 20, true, b).lines.join("\n")).toContain("an agent (test-agent-7) saved this note");
    expect((app.describe() as any).state.readers.find((x: any) => x.name === reader).agent.id).toBe(AS);
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

  test("an agent never replaces the person's draft: edit.text is refused in their edit, which stays theirs (round 3, C2)", async () => {
    await act("open", { id: cards.mine.id }, "detail");
    const pane = B().details[B().active] as ReaderPane, reader = `detail${B().active + 1}`;
    await until(() => pane.msg?.id === cards.mine.id && !pane.msg?.partial, "the note");
    await mine("focus", {}, reader);
    key(char("e"));
    await until(() => !!pane.draft, "the person's draft");
    key({ kind: "end" }); for (const c of " (mine)") key(char(c));
    const typed = pane.draft!.text;
    // Typing in it: refused before anything runs, the agent's ways said.
    await expect(act("edit.text", { text: "Turn the compost [stage::queued]\nEvery week." }, cards.mine.id)).rejects.toThrow(/the person is typing in .*; an agent doesn't replace their text · draft.patch lands in their draft, or comment on the note or block.mark it/);
    expect(pane.draft!.text).toBe(typed);
    expect(pane.draft!.note).not.toContain("replaced");
    // Theirs even when they aren't typing in it right now: the draft rule says whose it is.
    expect(draftRule(AGENT, "replace", { session: pane.surface.draftSession() })).toMatch(/the person has this note open in an edit here; an agent doesn't replace their draft/);
    // Nothing of the agent's in it: the preview and the draft don't say an agent is editing.
    expect(pane.surface.describe().agent?.did ?? "").not.toContain("is editing");
    await expect(act("edit.close", { discard: true }, cards.mine.id)).rejects.toThrow("the person is in this edit");
    expect(await mine("edit.close", { discard: true }, cards.mine.id)).toMatchObject({ closed: true });
    expect(pane.draft).toBeNull();
    expect((await current(cards.mine.id)).text).toBe("Turn the compost [stage::queued]\nEvery two weeks.");
  });

  /** Open a fresh note in a detail and give that detail the keys, as a person would have it. */
  const openFresh = async (text: string) => {
    const m = await create(null, text);
    await act("open", { id: m.id }, "detail");
    const pane = B().details[B().active] as ReaderPane, reader = `detail${B().active + 1}`;
    await until(() => pane.msg?.id === m.id && !pane.msg?.partial, "the note");
    await mine("focus", {}, reader);
    return { id: m.id as string, pane, reader };
  };
  const type = (s: string) => { for (const c of s) key(char(c)); };

  test("an agent acts while the person types a comment, then an edit: comment.write and complete insert= are refused, said, and nothing of theirs moves (round 3, deferred)", async () => {
    const { pane, reader } = await openFresh("Stake the raspberries\nAlong the north wall.");
    // The person's comment: C picks a passage, enter writes under it, then they type.
    key(char("C"));
    await until(() => pane.session?.mode === "select" && !pane.session.busy, "the passage picker");
    key({ kind: "enter" });
    await until(() => pane.session?.mode === "compose", "the comment");
    type("Which canes?");
    const c = pane.session!.composer!;
    const theirs = () => ({ text: c.text, cursor: [c.row, c.col], focus: BV.where(b), mode: pane.session?.mode });
    const was = theirs();
    expect(was.text).toBe("Which canes?");
    await expect(act("comment.write", { body: "Tie them in pairs." }, reader)).rejects.toThrow(/the person is typing in .*; an agent doesn't replace their text · block.mark gets their attention/);
    expect(message()).toContain("comment.write refused: the person is typing in");
    await expect(act("complete", { insert: 1 }, reader)).rejects.toThrow("this draft is the person's; an agent doesn't type in it");
    expect(message()).toContain("complete refused: this draft is the person's");
    expect(theirs()).toEqual(was);
    expect(c.writers.map(w => w.kind)).toEqual(["user"]);
    key({ kind: "esc" }); key({ kind: "esc" });                               // put aside as unsent, as esc twice does
    await until(() => pane.session?.mode !== "compose", "the comment put aside");
    if (pane.session) key({ kind: "esc" });                                   // and back out of the passage picker
    await until(() => !pane.session, "the comment session closed");

    // The person's edit: e, then typing a reference the agent could complete.
    key(char("e"));
    await until(() => !!pane.draft, "the person's edit");
    key({ kind: "end" }); type(" see ((Stake the");
    const d = pane.draft!;
    const editing = () => ({ text: d.text, cursor: [d.row, d.col], focus: BV.where(b) });
    const before = editing();
    await expect(act("complete", { insert: 1 }, reader)).rejects.toThrow("this draft is the person's; an agent doesn't type in it");
    await expect(act("edit.text", { text: "Stake the raspberries\nTie them in pairs." }, reader)).rejects.toThrow(/the person is typing in/);
    // A lookup only reads: the agent may still ask what the popup would offer.
    expect(await act("complete", {}, reader)).toMatchObject({ kind: expect.any(String) });
    expect(editing()).toEqual(before);
    expect(d.writers.map(w => w.kind)).toEqual(["user"]);
    expect(await mine("edit.close", { discard: true }, reader)).toMatchObject({ closed: true });
  });

  test("an agent's own edit the person entered and types in: edit.text is refused while they type", async () => {
    const { pane, reader } = await openFresh("Water the ferns\nTwice a week.");
    await act("edit.text", { text: "Water the ferns\nTwice a week, early." }, reader);
    key(char("e"));                                                            // the person enters the agent's edit
    key({ kind: "end" }); type(" (mine)");
    const typed = pane.draft!.text;
    await expect(act("edit.text", { text: "Water the ferns\nDaily." }, reader)).rejects.toThrow(/the person is typing in/);
    expect(pane.draft!.text).toBe(typed);
    // The person typed in it too: it's no longer the agent's alone to close (the draft rule); the person closes it.
    await expect(act("edit.close", { discard: true }, reader)).rejects.toThrow("someone else is typing in this draft");
    await mine("edit.close", { discard: true }, reader);
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

    // The person wrote it: an agent doesn't save it under them (the draft rule); their save is theirs.
    const u = await openFresh("Net the currants\nBefore June.");
    key(char("e")); await until(() => !!u.pane.draft, "the draft");
    key({ kind: "end" }); type(" (birds)");
    await expect(act("edit.save", {}, u.reader)).rejects.toThrow("the person is in this edit");
    expect(await mine("edit.save", {}, u.reader)).toMatchObject({ saved: true, recordedAs: { author: "user", actorId: ACTOR_ID } });
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
      await mine("focus", {}, id);
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
    // Resolving opens the thread list over the note: refused in the reader the person has (round 3, C3).
    await mine("focus", {}, reader);
    await expect(act("resolve", { thread: id }, reader)).rejects.toThrow(/has the person's keys; the thread list would cover what they're reading/);
    BV.at(b, "lanes");
    expect(await act("resolve", { thread: id }, reader)).toEqual({ reader, lifecycle: "resolved" });
    expect(await act("resolve", { thread: id }, reader)).toEqual({ reader, already: "resolved" });
    list = await threads(cards.beans.id);
    expect(list[0].lifecycle).toBe("resolved");
    expect([list[0].replies[0].block.author, list[0].replies[0].block.actorId]).toEqual(["agent", AS]);
    expect(pane.session?.mode).toBe("threads");
    expect(pane.render(90, 30, true, b).lines.join("\n")).toContain("resolved");
    // The person picks it up from there with the keys: the session is theirs too.
    await mine("focus", {}, reader);
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
    await expect(act("edit.save", {}, "detail9")).rejects.toThrow("no tile detail9");
  });

  test("an agent's card.select and card.move leave the person's keys where they are", async () => {
    await settled();
    const { reader } = await openFresh("Label the seed trays\nBefore sowing.");
    const region = BV.where(b);
    expect(region).toStartWith("detail");
    // The person's lane cursor and preview, before the agent picks a card of its own.
    const was = { lane: B().lane, sels: B().lanes.map((l: any) => l.sel), preview: B().preview.msg?.id };
    const mine = B().selectedCardId();
    const other = (B().lanes as any[]).findIndex((l, i) => i !== was.lane && l.items?.length > 1);
    const pick = B().lanes[other].items.find((m: any, j: number) => j !== was.sels[other] && m.id !== mine);
    expect(pick).toBeDefined();
    const picked: any = await act("card.select", { id: pick.id });
    expect(picked).toMatchObject({ selected: pick.id });
    expect(BV.where(b)).toBe(region);
    expect({ lane: B().lane, sels: B().lanes.map((l: any) => l.sel), preview: B().preview.msg?.id }).toEqual(was);
    expect(message()).toContain("an agent (test-agent-7) selected");
    expect(B().describe().agentSelected).toMatchObject({ [AS]: pick.id });
    // …and its card actions without card= act on its pick, not on the person's.
    expect(((await act("steps", {})) as any).card).toBe(pick.id);
    expect(B().selectedCardId()).toBe(mine);
    expect(await act("card.move", { lane: "Doing", card: cards.beans.id })).toMatchObject({ lane: "Doing" });
    expect(BV.where(b)).toBe(region);
    // Giving the keys away is only ever an explicit action, once the person is idle, and it says so.
    idle();
    const lane = B().lanes[B().lane].name;
    expect(await act("focus", {}, "lanes")).toEqual({ tile: lane, focus: lane });
    expect(message()).toContain(`an agent (test-agent-7) gave the keys to ${lane}`);
    await b.dispatch.act({ action: "focus", reader }, { kind: "user" });
    await settled();
  });

  test("an agent can't act in a drawer's reader while the drawer is shut", async () => {
    expect(B().treeOpen).toBe(false);
    expect(B().describe().backlinks).toBeNull();
    await expect(act("open", { id: cards.gate.id }, "tree")).rejects.toThrow("tree-preview isn't on screen (its drawer is shut)");
    await expect(act("edit.text", { text: "x" }, "backlinks")).rejects.toThrow("backlinks-preview isn't on screen");
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
      expect(listed.result.tiles).toContain("preview");
      await act("open", { id: cards.gate.id }, "preview");
      const r2 = await ask({ cmd: "act", action: "edit.text", reader: "preview", args: { text: "Fix the gate latch [stage::doing]\nIt swings open. New spring ordered." }, as: "socket-agent" });
      expect(r2).toMatchObject({ ok: true, result: { reader: "preview", dirty: true } });
      // tile= on the wire names the tile, as reader= (its older name) does (A5).
      expect(await ask({ cmd: "act", action: "edit.save", tile: "preview", reader: "detail1", as: "socket-agent" })).toMatchObject({ ok: false, error: expect.stringContaining("name two tiles") });
      expect(await ask({ cmd: "act", action: "edit.save", tile: "preview", as: "socket-agent" })).toMatchObject({ ok: true, result: { saved: true } });
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
      expect(out.reader).toBe("reader");                               // the tile's name, not its place (PIE-491)
      expect(await act("edit.save")).toMatchObject({ saved: true });
      expect(await lastBy(cards.mine.id)).toEqual(["agent", AS]);
      expect((app.describe() as any).state.panes.find((p: any) => p.showing?.id === cards.mine.id).agent.id).toBe(AS);
    } finally { app.pop(); }
  });
});

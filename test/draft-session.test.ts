// The draft session (PIE-516): one lifecycle for every draft, through one interface. Open (bringing back what
// was put aside), type, write or leave, put aside as unsent, restore, the service hold, a stale refusal,
// recordAs, the agent rule and an invitation. The lifecycle runs on a fake target and a fake hold; the three
// target adapters run against a scratch outliner service (never a real outline). Fictional notes throughout.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { blockTarget, cardTarget, commentTarget, DraftSession, hasUnsent, Outgoing, rangeHash, recordAs, shelve, unsent, unsentAll, unsentOn, agentRefusal, type DraftCommand, type DraftTarget, type Outcome } from "../src/draft-session";
import { Draft, DRAFT_DAYS, DRAFT_KEEP } from "../src/edit";
import { SocketBoard, USER, type Actor, type DraftAnswer, type DraftRequest } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import type { Key } from "../src/term";
import { outliner, Scratch } from "./scratch";

const AGENT: Actor = { kind: "agent", id: "tidy" };
const OTHER: Actor = { kind: "agent", id: "sorter" };
const char = (ch: string): Key => ({ kind: "char", ch });

/** A target that records what it was asked to write and answers from `answers` (default: written). */
function fake(over: Partial<DraftTarget> = {}, answers: Outcome[] = []) {
  const sent: { text: string; by: Actor; asked: Actor; away: boolean }[] = [];
  const t: DraftTarget = {
    place: "edit:note-fern", back: "e brings it back", label: "note-fer", what: "the edit to “Fern”", verb: "save", blockId: "note-fern", leaveWrites: true,
    async submit(s, by, { asked, away }) { sent.push({ text: s.draft.text, by, asked, away }); return answers.shift() ?? { ok: true }; },
    ...over,
  };
  return { t, sent };
}

/** A fake connection holding drafts: what was held and released, and the answer callback to ask through. */
function fakeHolds() {
  const held = new Map<string, (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>>(), released: string[] = [], touched: string[] = [];
  const board = {
    holdDraft(blockId: string, _rev: number, answer: (r: DraftRequest) => DraftAnswer | Promise<DraftAnswer>) {
      held.set(blockId, answer);
      return { revise() {}, release: () => { released.push(blockId); held.delete(blockId); }, touched: () => touched.push(blockId) };
    },
  };
  return { board, held, released, touched };
}

/** Type into a session as the person's keys, collecting the commands they ask the host to run. */
function keys(s: DraftSession, ks: (Key | string)[]): DraftCommand[] {
  const ran: DraftCommand[] = [];
  for (const k of ks) for (const one of typeof k === "string" ? [...k].map(char) : [k]) s.key(one, { run: c => ran.push(c) });
  return ran;
}
const ESC: Key = { kind: "esc" };

describe("the lifecycle, on a fake target", () => {
  test("esc on nothing typed asks to close; esc, esc on typed text asks to discard, which puts it aside with a copy", () => {
    const { t } = fake({ place: "comment:note-lantern", back: "C and a passage bring it back", label: "lantern-comment", verb: "send", blockId: undefined, leaveWrites: false });
    const s = DraftSession.open(t, {});
    expect(keys(s, [ESC])).toEqual(["close"]);
    expect(keys(s, ["- keep the brass ones", ESC])).toEqual([]);
    expect(s.draft.note).toContain("esc again puts it aside");
    expect(keys(s, [ESC])).toEqual(["discard"]);
    const r = s.close(true);
    expect([s.open, s.ended, r.said]).toEqual([false, "aside", expect.stringContaining("put aside as unsent · C and a passage bring it back · a copy is at")]);
    const u = unsent("comment:note-lantern")!;
    expect(u.text).toBe("- keep the brass ones");
    expect(readFileSync(u.copy!, "utf8")).toBe("- keep the brass ones\n");
    // Opened again at the same place: it comes back, said; esc twice on it unchanged drops it, its copy kept.
    const again = DraftSession.open(t, {});
    expect(again.draft.text).toBe("- keep the brass ones");
    expect(again.draft.note).toContain("brought back your unsent draft");
    expect(unsent("comment:note-lantern")).toBeNull();
    expect(keys(again, [ESC, ESC])).toEqual(["discard"]);
    expect(again.close(true).said).toContain("dropped the unsent draft · a copy stays at");
    expect(unsentAll().some(x => x.key === "comment:note-lantern")).toBe(false);
  });

  test("a draft put aside on an older revision isn't laid over the newer block; it says where its copy is", () => {
    const { t } = fake({ place: "edit:note-a", blockId: "note-a" });
    const old = DraftSession.open(t, { text: "Title\nold body", base: 3 });
    keys(old, [" more"]);
    old.close(true);
    const u = unsent("edit:note-a")!;
    expect(existsSync(u.copy!)).toBe(true);
    const newer = DraftSession.open(t, { text: "Title\nnew body", base: 4 });
    expect(newer.draft.text).toBe("Title\nnew body");
    expect(newer.draft.note).toContain(u.copy!);
    newer.dispose();
  });

  test("a screen closing keeps the draft the same way; an agent's own text is only copied, never put aside over the person's", () => {
    const { t } = fake({ place: "edit:note-tarp", blockId: "note-tarp" });
    const p = DraftSession.open(t, { text: "Tarp", base: 2 });
    keys(p, [" and pegs"]);
    const copy = p.keep();
    expect(unsent("edit:note-tarp")?.copy).toBe(copy);
    p.dispose();
    const a = DraftSession.open(t, { text: "Tarp", base: 2, by: AGENT });
    expect(a.draft.text).toBe("Tarp");                                       // an agent's never picks up the person's
    a.replace("Tarp, by the agent", AGENT);
    expect(readFileSync(a.keep(), "utf8")).toBe("Tarp, by the agent\n");
    expect(unsent("edit:note-tarp")?.text).toBe("Tarp and pegs");
    a.dispose();
  });

  test("text brought back keeps who wrote it: a write names the agent that had a hand in it (recordAs)", async () => {
    const { t, sent } = fake({ place: "edit:note-lamp", blockId: "note-lamp" });
    const d = DraftSession.open(t, { text: "Lamp", base: 1 });
    keys(d, [" oil"]);
    d.replace(`${d.draft.text}\n- wick, from the agent`, AGENT);
    d.keep(); d.dispose();
    const again = DraftSession.open(t, { text: "Lamp", base: 1 });
    expect(again.draft.writers.map(w => w.kind)).toEqual(["user", "agent"]);
    expect(await again.submit(USER)).toEqual({ ok: true });
    expect(sent[0]!.by).toEqual({ kind: "user", with: [AGENT.id] });
    expect(again.ended).toBe("written");
  });

  test("the unsent index is bounded like the draft copies: old entries past the newest DRAFT_KEEP go", () => {
    const old = Date.now() - (DRAFT_DAYS + 5) * 86_400_000;
    for (let i = 0; i < DRAFT_KEEP + 10; i++) { const d = new Draft(`n${i}`, 1, `text ${i}`); shelve(`edit:bulk-${i}`, d, null, old + i); }
    const { t } = fake({ place: "edit:bulk-fresh", blockId: "bulk-fresh" });
    const fresh = DraftSession.open(t, { base: 1 });
    keys(fresh, ["today"]);
    fresh.keep();
    const all = unsentAll();
    expect(all.length).toBe(DRAFT_KEEP);
    expect(all[0]!.key).toBe("edit:bulk-fresh");
    expect(all.some(u => u.key === "edit:bulk-0")).toBe(false);
    fresh.dispose();
  });

  test("the reader's line names an edit or a comment put aside on a note", () => {
    const { t } = fake({ place: "edit:note-gate", blockId: "note-gate" });
    const s = DraftSession.open(t, { text: "Gate" });
    keys(s, ["!"]); s.keep(); s.dispose();
    expect(unsentOn("note-gate")).toEqual([expect.stringMatching(/^■ unsent edit from .* · e brings it back$/)]);
  });

  test("an edit put aside and brought back untouched isn't saved by a click away: it's put aside again", async () => {
    const sent: string[] = [];
    const said: string[] = [];
    const t = (): DraftTarget => ({ place: "edit:note-quince", back: "e brings it back", label: "quince", what: "the edit to “Quince”", verb: "save", blockId: "note-quince", leaveWrites: true,
      async submit(s) { sent.push(s.draft.text); return { ok: true }; } });
    const a = DraftSession.open(t(), { text: "Quince jam", base: 3 });
    keys(a, [" -- wrong idea"]); a.close(true);                       // esc esc
    const b = DraftSession.open(t(), { text: "Quince jam", base: 3 }, { said: m => said.push(m) });   // e brings it back
    expect(b.dirty).toBe(true);
    expect(await b.leave()).toMatchObject({ left: "kept", said: "the edit to “Quince” was kept as unsent, not saved: it came back unsent and nothing was typed since · e brings it back" });
    expect(said).toHaveLength(1);
    expect(sent).toEqual([]);
    expect(unsent("edit:note-quince")?.text).toBe("Quince jam -- wrong idea");
    // Brought back and typed in, a click away saves it as any edit.
    const c = DraftSession.open(t(), { text: "Quince jam", base: 3 });
    keys(c, ["!"]);
    expect(await c.leave()).toMatchObject({ left: "saved" });
    expect(sent).toEqual(["Quince jam -- wrong idea!"]);
  });

  test("an edit put aside on an older revision stays put aside (and on the reader's line) when the note has moved on", () => {
    const { t } = fake({ place: "edit:note-medlar", blockId: "note-medlar" });
    const a = DraftSession.open(t, { text: "Medlar", base: 2 });
    keys(a, [" bletted"]); a.close(true);
    const b = DraftSession.open(t, { text: "Medlar, picked", base: 5 });
    expect([b.dirty, b.draft.text, b.draft.note]).toEqual([false, "Medlar, picked", expect.stringContaining("was on revision 2; the note changed since")]);
    expect(unsent("edit:note-medlar")?.text).toBe("Medlar bletted");
    expect(unsentOn("note-medlar")).toEqual([expect.stringMatching(/^■ unsent edit from /)]);
    b.dispose();
  });

  test("a new card is put aside under its lane's view: two hubs' lanes of one name never share it, and the reminder knows it", async () => {
    const made: string[] = [];
    const lane = (view: string, name = "Doing") => cardTarget({ kind: "card", lane: name, view, create: async text => { made.push(`${view}:${text}`); return {}; } });
    const a = DraftSession.open(lane("view-plum-doing"), {});
    keys(a, ["Prune the plum"]);
    expect(await a.leave()).toMatchObject({ left: "kept", said: "the new card in Doing was kept as unsent, not created · n in Doing brings it back" });
    expect(hasUnsent("card:view-plum-doing")).toBe(true);
    expect(unsentOn("view-plum-doing")).toEqual([expect.stringMatching(/^■ unsent new card from .* · n in this lane brings it back$/)]);
    // Another hub's "Doing" lane opens empty, and creating there never creates the plum card.
    const b = DraftSession.open(lane("view-pear-doing"), {});
    expect(b.draft.text).toBe("");
    keys(b, ["Net the pears"]);
    expect(await b.submit(USER)).toMatchObject({ ok: true });
    expect(made).toEqual(["view-pear-doing:Net the pears"]);
    // Its own lane brings it back.
    const c = DraftSession.open(lane("view-plum-doing"), {});
    expect(c.draft.text).toBe("Prune the plum");
    c.dispose();
  });

  test("put-aside places whose names differ only in punctuation keep their own files; an older card:<lane> file is ignored", () => {
    shelve("card:To do", new Draft("x", 0, "Weed the beds"), null);
    shelve("card:To-do", new Draft("x", 0, "Sow the carrots"), null);
    expect([unsent("card:To do")?.text, unsent("card:To-do")?.text]).toEqual(["Weed the beds", "Sow the carrots"]);
    const s = DraftSession.open(cardTarget({ kind: "card", lane: "To do", view: "view-veg-todo", create: async () => ({}) }), {});
    expect(s.draft.text).toBe("");
    s.dispose();
  });

  test("the reader's line names a new note put aside under a card", () => {
    const parent = { id: "card-hedge", text: "Trim the hedge" } as any;
    const s = DraftSession.open(cardTarget({ kind: "child", parent, create: async () => ({}) }), {});
    keys(s, ["Borrow the shears"]); s.keep(); s.dispose();
    expect(unsentOn("card-hedge")).toEqual([expect.stringMatching(/^■ unsent note under this from .* · N on the card brings it back$/)]);
  });

  test("leave: unchanged closes; a changed edit is written; refused, it's kept as unsent with why; a comment is never sent", async () => {
    const unchanged = fake();
    const a = DraftSession.open(unchanged.t, { text: "Fern", base: 1 });
    expect(await a.leave()).toEqual({ left: "closed" });
    expect(unchanged.sent).toEqual([]);

    const ok = fake({ place: "edit:note-ok", blockId: "note-ok" }, [{ ok: true, revision: 2 }]);
    const b = DraftSession.open(ok.t, { text: "Fern", base: 1 });
    keys(b, ["s"]);
    expect(await b.leave()).toEqual({ left: "saved", revision: 2 });
    expect(ok.sent.map(x => x.away)).toEqual([true]);                       // a click never confirms a second save

    const offline = fake({ place: "edit:note-off", blockId: "note-off" }, [{ ok: false, why: "offline · the outline isn't answering" }]);
    const c = DraftSession.open(offline.t, { text: "Fern", base: 1 });
    keys(c, ["s"]);
    const kept = await c.leave();
    expect(kept).toMatchObject({ left: "kept", said: "not saved: offline · the outline isn't answering · the edit to “Fern” was kept as unsent · e brings it back" });
    expect(unsent("edit:note-off")?.text).toBe("Ferns");

    const stale = fake({ place: "edit:note-stale", blockId: "note-stale" }, [{ ok: false, stale: true, why: "changed elsewhere since you started · not saved" }]);
    const d = DraftSession.open(stale.t, { text: "Fern", base: 1 });
    keys(d, ["s"]);
    const r = await d.leave();
    expect(r).toMatchObject({ left: "kept", why: "it changed elsewhere since you started" });
    expect(r.left === "kept" && r.said).toMatch(/· a copy is at /);

    const comment = fake({ place: "comment:note-c", blockId: undefined, verb: "send", leaveWrites: false, what: "the comment on “Fern”", back: "C and a passage bring it back" });
    const e = DraftSession.open(comment.t, {});
    keys(e, ["How deep?"]);
    expect(await e.leave()).toMatchObject({ left: "kept", said: "the comment on “Fern” was kept as unsent, not sent · C and a passage bring it back" });
    expect(comment.sent).toEqual([]);
  });

  test("a stale refusal keeps the draft as typed, copies it and says so; any other keeps it with the reason; a write in flight holds it", async () => {
    let release: (o: Outcome) => void = () => {};
    // The adapter marks its write in flight (Draft.saving) until the service answers.
    const { t } = fake({ async submit(s) { s.draft.saving = true; const o = await new Promise<Outcome>(r => { release = r; }); s.draft.saving = false; return o; } });
    const s = DraftSession.open(t, { text: "Fern", base: 1 });
    keys(s, ["s"]);
    const writing = s.submit(USER);
    expect(await s.submit(USER)).toEqual({ ok: false, why: "the save is still landing" });
    expect(keys(s, ["x", ESC])).toEqual([]);                                // keys wait too
    expect(await s.leave()).toEqual({ left: "saving" });
    release({ ok: false, stale: true, why: "changed elsewhere since you started · not saved" });
    expect(await writing).toMatchObject({ ok: false, stale: true });
    expect([s.open, s.draft.text, s.draft.conflict]).toEqual([true, "Ferns", "changed elsewhere since you started · not saved"]);
    expect(readFileSync(s.draft.savedCopy!, "utf8")).toBe("Ferns\n");
    expect(s.draft.note).toContain("your draft is kept and copied to");
    s.dispose();
  });

  test("the hold: a block's draft is held while open, the person's typing is told, an agent's patch lands, and it's let go at the end", async () => {
    const h = fakeHolds(), did: string[] = [];
    const { t } = fake({ place: "edit:note-held", blockId: "note-held" });
    const s = DraftSession.open(t, { text: "Beds\nrake  them   flat\n\nnotes", base: 4 }, { board: h.board, agentDid: (_, x) => did.push(x) });
    expect(s.held).toBe(true);
    s.draft.place(3, 5);
    keys(s, ["!"]);
    expect(h.touched).toEqual(["note-held"]);
    const ask = h.held.get("note-held")!;
    expect(await ask({ kind: "read", requestId: "r", holdId: "h", blockId: "note-held" })).toEqual({ text: "Beds\nrake  them   flat\n\nnotes!", revision: 4 });
    const patch = await ask({ kind: "patch", requestId: "r", holdId: "h", blockId: "note-held", patchId: "p1", revision: 4, patches: [{ observed: "rake  them   flat", replacement: "rake them flat" }], mutation: { author: "agent", actorId: "tidy" } });
    expect(patch).toEqual({ applied: true });
    expect(did).toEqual(["edited text above your cursor"]);
    expect(s.draft.text).toBe("Beds\nrake them flat\n\nnotes!");
    s.dispose();
    expect([s.held, h.released]).toEqual([false, ["note-held"]]);
    await expect(Promise.resolve().then(() => ask({ kind: "read", requestId: "r", holdId: "h", blockId: "note-held" }))).rejects.toThrow("the draft was closed");
  });
});

describe("the agent rule, stated once", () => {
  test("in the person's draft an agent neither types (draft.*) nor leaves; in its own, it does, until someone else types", () => {
    const { t } = fake({ blockId: undefined, place: "edit:none" });
    const mine = DraftSession.open(t, {});
    expect(agentRefusal(AGENT, mine)).toBe("this draft is the person's; send the whole text with edit.text or comment.write");
    expect(agentRefusal(AGENT, mine, { op: "leave" })).toContain("an agent doesn't save or close it");
    expect(agentRefusal(USER, mine, { op: "leave" })).toBeNull();
    const its = DraftSession.open(t, { by: AGENT });
    its.replace("- a\n- b", AGENT);
    expect(agentRefusal(AGENT, its)).toBeNull();
    expect(agentRefusal(OTHER, its)).toContain("the person's");
    keys(its, ["!"]);
    expect(agentRefusal(AGENT, its)).toBe("someone else is typing in this draft; send the whole text with edit.text or comment.write");
    mine.dispose(); its.dispose();
  });

  test("an agent doesn't run the draft's own actions in the person's draft; its save of it names who typed; in its own it does both", async () => {
    const { t, sent } = fake({ blockId: undefined, place: "edit:none-2" });
    const theirs = DraftSession.open(t, { text: "Fern" });
    keys(theirs, ["s"]);
    await expect(theirs.act("draft.indent", {}, AGENT)).rejects.toThrow("this draft is the person's");
    expect(await theirs.submit(AGENT)).toEqual({ ok: true });
    expect(sent.map(x => [x.by, x.asked])).toEqual([[USER, AGENT]]);           // recorded as the person's, who typed it
    const its = DraftSession.open(t, { by: AGENT });
    its.replace("- a\n- b", AGENT);
    expect(await its.act("draft.indent", { from: 2 }, AGENT)).toEqual({ lines: 1 });
    expect(await its.submit(AGENT)).toEqual({ ok: true });
    theirs.dispose();
  });

  test("an agent never writes a block the person has open in a draft, nor opens a second draft of it; the person is never refused", async () => {
    const h = fakeHolds();
    const { t } = fake({ place: "edit:note-rope", blockId: "note-rope", what: "the edit to “Rope”" });
    const theirs = DraftSession.open(t, { text: "Rope", base: 1 }, { board: h.board });
    keys(theirs, ["s"]);
    const why = agentRefusal(AGENT, { board: h.board, blockId: "note-rope" });
    expect(why).toBe("the person has “Rope” open in a draft with unsaved changes; an agent doesn't write it underneath · draft.patch lands in their draft, or wait until it's saved or closed");
    expect(() => DraftSession.open(t, { text: "Rope", base: 1, by: AGENT }, { board: h.board })).toThrow("the person has “Rope” open in a draft");
    expect(agentRefusal(USER, { board: h.board, blockId: "note-rope" })).toBeNull();
    expect(agentRefusal(AGENT, { board: h.board, blockId: "note-other" })).toBeNull();
    expect(agentRefusal(AGENT, { board: {}, blockId: "note-rope" })).toBeNull();      // another connection's drafts aren't this one's
    theirs.dispose();
    expect(agentRefusal(AGENT, { board: h.board, blockId: "note-rope" })).toBeNull();
    // An agent's own draft of a block, with the person's open too, can't be written underneath theirs.
    const own = DraftSession.open(t, { text: "Rope", base: 1, by: AGENT }, { board: h.board });
    own.replace("Rope, coiled", AGENT);
    const person = DraftSession.open(t, { text: "Rope", base: 1 }, { board: h.board });
    expect(await own.submit(AGENT)).toMatchObject({ ok: false, why: expect.stringContaining("the person has “Rope” open in a draft") });
    person.dispose();
    expect(await own.submit(AGENT)).toEqual({ ok: true });
  });

  test("an invitation (an @name line in the person's draft) lets that agent reply once for the text above it", () => {
    const h = fakeHolds(), did: string[] = [];
    const { t } = fake({ place: "edit:note-yo", blockId: "note-yo" });
    const s = DraftSession.open(t, { text: "Seed list\nbeans  peas\nsquash", base: 3 }, { board: h.board, agentDid: (_, x) => did.push(x) });
    s.draft.place(2, 6);
    const ENTER: Key = { kind: "enter" };
    keys(s, [ENTER, "@yo tidy this up", ENTER, "and the"]);
    expect(agentRefusal({ kind: "agent", id: "yo" }, { board: h.board, blockId: "note-yo" })).toContain("the person has");   // uninvited
    expect(s.invite("nobody")).toBeNull();
    const inv = s.invite("yo")!;
    expect(inv).toMatchObject({ agent: "yo", mark: "@yo tidy this up", snapshot: "Seed list\nbeans  peas\nsquash", base: rangeHash("Seed list\nbeans  peas\nsquash") });
    const YO: Actor = { kind: "agent", id: "yo" };
    expect(agentRefusal(YO, { board: h.board, blockId: "note-yo" }, { invitation: inv.id })).toBeNull();
    expect(agentRefusal(OTHER, s, { invitation: inv.id })).toContain("no open invitation");
    expect(() => s.reply(inv.id, inv.base, "x", OTHER)).toThrow("no open invitation");
    expect(() => s.reply(inv.id, "0000", "x", YO)).toThrow("another base");
    keys(s, [" seeds"]);                                                     // the person keeps typing below
    const before = { row: s.draft.row, col: s.draft.col };
    expect(s.reply(inv.id, inv.base, "Seed list\n- beans\n- peas\n- squash", YO)).toEqual({ applied: true });
    expect(s.draft.text).toBe("Seed list\n- beans\n- peas\n- squash\n@yo tidy this up\nand the seeds");
    expect([s.draft.row, s.draft.col]).toEqual([before.row + 1, before.col]);  // the cursor shifted with it
    expect(did).toEqual(["rewrote the text above its @ line, as you asked"]);
    expect(s.draft.patches.map(p => p.by)).toEqual([YO]);                    // one undo step (ctrl+z)
    expect(() => s.reply(inv.id, inv.base, "again", YO)).toThrow("no open invitation");   // once
    s.dispose();
  });

  test("a reply to an invitation whose range the person changed meanwhile is offered, never applied by itself", () => {
    const { t } = fake({ place: "edit:note-yo2", blockId: "note-yo2" });
    const s = DraftSession.open(t, { text: "Seed list\nbeans  peas\n@yo tidy\n", base: 3 });
    const inv = s.invite("yo")!;
    s.draft.place(1, 0);
    keys(s, ["runner "]);                                                     // the person edits inside the range
    const YO: Actor = { kind: "agent", id: "yo" };
    expect(s.reply(inv.id, inv.base, "Seed list\n- beans\n- peas", YO)).toEqual({ applied: false, suggested: true });
    expect(s.draft.text).toBe("Seed list\nrunner beans  peas\n@yo tidy\n");
    expect(s.suggestions.map(x => x.replacement)).toEqual(["Seed list\n- beans\n- peas"]);
    expect(s.accept()).toBe(true);                                           // one key takes it (a later ticket binds it)
    expect(s.draft.text).toBe("Seed list\n- beans\n- peas\n@yo tidy\n");
    s.dispose();
  });
});

describe.skipIf(!outliner)("the three target adapters, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard;
  const create = async (text: string, parentId: string | null = null) => (await board.request("create", { parentId, text, author: "agent" })).id as string;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(() => {});
    other = new SocketBoard(scratch.sock);
    await other.info();
  }, 30_000);
  afterAll(async () => { board?.close(); other?.close(); await scratch.dispose(); });

  test("a block: saved against its revision, held while open; a stale one is refused and kept; ctrl+r starts over", async () => {
    const id = await create("Prune the apple\nin winter");
    const m = (await board.get(id))!;
    const saved: string[] = [];
    const s = DraftSession.open(blockTarget(m, { board, saved: x => saved.push(x.text) }), { text: m.text, base: m.revision, props: m.props }, { board });
    expect(s.held).toBe(true);
    keys(s, [" tree"]);
    expect(await s.submit(USER)).toMatchObject({ ok: true, result: USER });
    expect((await board.get(id))!.text).toBe("Prune the apple tree\nin winter");
    expect([s.ended, s.held, saved]).toEqual(["written", false, ["Prune the apple tree\nin winter"]]);

    const n = (await board.get(id))!;
    const t = DraftSession.open(blockTarget(n, { board }), { text: n.text, base: n.revision, props: n.props }, { board });
    keys(t, ["s"]);
    await other.update(id, "Prune the apple tree\nin late winter", n.revision!, OTHER);
    const r = await t.submit(USER);
    expect(r).toMatchObject({ ok: false, stale: true });
    expect([t.open, t.draft.text, t.draft.conflict]).toEqual([true, "Prune the apple trees\nin winter", "changed elsewhere since you started · not saved"]);
    expect((await board.get(id))!.text).toBe("Prune the apple tree\nin late winter");     // theirs stands
    await t.reload();
    expect(t.draft.text).toBe("Prune the apple tree\nin late winter");
    expect(t.draft.note).toContain("your earlier draft is at");
    t.dispose();
  }, 30_000);

  test("a block: a save that changes properties is shown first and needs a second; a click away never confirms it", async () => {
    const id = await create("Sow the peas [stage::queued]\nby the fence");
    const m = (await board.get(id))!;
    const s = DraftSession.open(blockTarget(m, { board }), { text: m.text, base: m.revision, props: m.props }, { board });
    s.replace("Sow the peas [stage::doing]\nby the fence", USER);
    const left = await s.leave();
    expect(left).toMatchObject({ left: "kept", why: expect.stringContaining("it changes properties (-stage=queued +stage=doing)") });
    const again = DraftSession.open(blockTarget(m, { board }), { text: m.text, base: m.revision, props: m.props }, { board });
    expect(again.draft.text).toBe("Sow the peas [stage::doing]\nby the fence");               // brought back
    expect(await again.submit(USER)).toMatchObject({ ok: false, again: true });
    expect(await again.submit(USER)).toMatchObject({ ok: true });
    expect((await board.get(id))!.props.stage).toBe("doing");
  }, 30_000);

  test("a comment and a reply: sent once with a request id, recorded as who wrote it; a stale passage is refused and kept", async () => {
    const id = await create("Mulch the roses\nwith bark from the heap");
    const m = (await board.get(id))!;
    let where: { kind: "quote"; blockId: string; revision: number; passage: { quote: string; start: number } } = { kind: "quote", blockId: id, revision: m.revision!, passage: { quote: "bark", start: m.text.indexOf("bark") } };
    const landed: string[] = [];
    const out = new Outgoing();
    const s = DraftSession.open(commentTarget({ where: () => where, note: m, board: () => board, out, landed: async r => { landed.push(r.id); } }), {});
    expect(s.target.place).toBe(`comment:${id}`);
    expect(await s.submit(USER)).toEqual({ ok: false, why: "write the comment first" });
    keys(s, ["How much bark?"]);
    s.replace("How much bark? A barrow.", AGENT);
    const sent = await s.submit(USER);
    expect(sent.ok).toBe(true);
    const threads = await board.comments(id);
    expect(threads.map(c => [c.body, c.id === landed[0]])).toEqual([["How much bark? A barrow.", true]]);

    const thread = threads[0]!;
    const reply = DraftSession.open(commentTarget({ where: () => ({ kind: "reply", thread }), note: m, board: () => board, out: new Outgoing(), landed: async () => {} }), {});
    expect(reply.target.place).toBe(`reply:${thread.id}`);
    keys(reply, ["A full one."]);
    expect(await reply.submit(USER)).toMatchObject({ ok: true });
    expect((await board.comments(id))[0]!.replies.map(r => r.body)).toEqual(["A full one."]);

    // The note moves on under a quote: refused as stale, the text kept and copied.
    const n = (await board.get(id))!;
    await other.update(id, "Mulch the roses\nwith bark from the far heap", n.revision!, OTHER);
    where = { kind: "quote", blockId: id, revision: n.revision!, passage: { quote: "bark", start: n.text.indexOf("bark") } };
    const late = DraftSession.open(commentTarget({ where: () => where, note: n, board: () => board, out: new Outgoing(), landed: async () => {} }), {});
    keys(late, ["And the tulips?"]);
    expect(await late.submit(USER)).toMatchObject({ ok: false, stale: true, why: expect.stringContaining("the note changed since you picked the passage") });
    expect([late.open, late.draft.text, existsSync(late.draft.savedCopy!)]).toEqual([true, "And the tulips?", true]);
    late.dispose();
  }, 30_000);

  test("a card or a child: created through its create path, recorded as who wrote it; refused, the text is kept and copied", async () => {
    const parent = await create("Allotment jobs");
    const pm = (await board.get(parent))!;
    const made: { text: string; by: Actor }[] = [];
    const child = DraftSession.open(cardTarget({ kind: "child", parent: pm, create: async (text, by) => { made.push({ text, by }); return board.createBlock(parent, text, by); } }), {});
    expect(child.target).toMatchObject({ place: `child:${parent}`, back: "N on the card brings it back", verb: "create", leaveWrites: false });
    keys(child, ["Turn the compost"]);
    expect(await child.submit(USER)).toMatchObject({ ok: true });
    expect(made).toEqual([{ text: "Turn the compost", by: USER }]);
    expect((await board.get(parent))!.childIds.length).toBe(1);

    const card = DraftSession.open(cardTarget({ kind: "card", lane: "Doing", view: "view-allotment-doing", create: async () => { throw new Error("Doing makes roadmap items through the allocator"); } }), {});
    keys(card, ["Fix the shed door"]);
    expect(await card.submit(USER)).toEqual({ ok: false, why: "not created: Doing makes roadmap items through the allocator" });
    expect([card.open, card.draft.note]).toEqual([true, expect.stringContaining("your text is kept (and copied to")]);
    expect(await card.leave()).toMatchObject({ left: "kept", said: "the new card in Doing was kept as unsent, not created · n in Doing brings it back" });
    expect(unsent("card:view-allotment-doing")?.text).toBe("Fix the shed door");
  }, 30_000);

  test("in readers: an agent's edit, property or step under the person's open draft is refused, and its draft.patch lands", async () => {
    const id = await create("Stake the beans [stage::queued]\n- [ ] cut canes\n\nnotes");
    const flashes: string[] = [];
    const host = (): SurfaceHost => ({ ctx: { board, flash: (m: string) => flashes.push(m), t: { cellW: 9, cellH: 16 }, graphics: false } as any, redraw() {}, navigate() {} });
    const mine = new NoteSurface(), theirs = new NoteSurface(), h = host(), a = host();
    mine.show((await board.get(id))!, h); theirs.show((await board.get(id))!, a);
    await mine.edit(h);
    mine.draft!.place(3, 5);
    for (const c of " today") mine.key(char(c), h);
    const AS: Actor = { kind: "agent", id: "gardener" };
    await expect(theirs.act("edit.text", { text: "Stake the beans\nnow" }, a, AS)).rejects.toThrow("the person has “Stake the beans” open in a draft with unsaved changes");
    expect(theirs.drafting).toBeNull();
    await theirs.whole();
    await expect(theirs.act("props.edit", { key: "stage", value: "doing" }, a, AS)).rejects.toThrow("open in a draft");
    expect((await board.get(id))!.props.stage).toBe("queued");
    // Its patch goes through the person's draft (the hold), where the compare decides: away from their typing, it lands.
    const m = (await board.get(id))!;
    const r = await other.request("draft.patch", { blockId: id, revision: m.revision, patches: [{ observed: "cut canes", replacement: "cut hazel canes" }], mutation: { author: "agent", actorId: "gardener" } });
    expect(r).toMatchObject({ outcome: "applied", edits: [{ route: "draft" }] });
    expect(mine.draft!.text).toBe("Stake the beans [stage::queued]\n- [ ] cut hazel canes\n\nnotes today");
    expect(await mine.act("edit.save", {}, h, USER)).toMatchObject({ saved: true });
    // Saved and closed: the agent writes as it likes again.
    theirs.show((await board.get(id))!, a);
    expect(await theirs.act("props.edit", { key: "stage", value: "doing" }, a, AS)).toBeTruthy();
  }, 30_000);
});

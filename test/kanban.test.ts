// PIE-406: writing from the kanban board. Create a card in a lane (born with what the lane's query
// needs), add a note under a card, check off checklist steps, trash and restore, and move cards into
// lanes whose query has an OR / NOT group. Each by keys and through the control socket, against a
// throwaway outliner service it starts itself (never a real outline). Pure planning is tested anywhere.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { connect } from "node:net";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import { startControl } from "../src/control";
import { DeliveryBoard } from "../src/desk/delivery";
import { composeCardText, pickParent } from "../src/desk/writes";
import { Mirror } from "../src/mirror";
import { createMisses, planCreate, planMove } from "../src/move";
import { holds, parseQuery } from "../src/query";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { queryShape, type ViewRead } from "../src/views";
import { outliner, Scratch, until } from "./scratch";

const card = (props: Record<string, string>, over: Partial<Msg> = {}): Msg => ({
  id: "c1", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, revision: 1, props,
  properties: Object.entries(props).map(([key, value]) => ({ key, value })), ...over,
});
const lane = (name: string, q: string, defProps: Record<string, string> = {}, items: Msg[] = []) => {
  const shape = queryShape(q);
  const read: ViewRead = { status: "ready", items, limit: 200, truncated: false, errors: [], filters: [], by: "service", ...shape };
  return { name, read, def: card({ type: "virtual-branch", query: q, ...defProps }, { id: `lane-${name}` }) };
};
const ALL_WORK = (stage: string) => `type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=${stage}`;

describe("the query grammar, as the outliner reads it", () => {
  test.skipIf(!outliner)("parses and evaluates like block-query.ts, OR / NOT / groups / ranges included", async () => {
    const theirs = await import(join(outliner!, "src/block-query.ts"));
    const queries = [ALL_WORK("doing"), "a=1 OR b=2", "not a=1", "NOT (a=1 b=2) c", "(a=1 OR (b=2 AND NOT c)) d=4", "a=1 and b=2", "x=f(y)", "(x=f(y))",
      'title="two words" OR a', "updated >= -7d a=1", "created<2026-01-01", "a OR", "(a=1", "a=1)", "NOT", "() a", "deleted=true OR a", "updated > nonsense", "stage=Done"];
    const subjects = [
      { props: [], created: "2026-09-01T00:00:00Z" },
      { props: [["a", "1"]], created: "2025-06-01T00:00:00Z" },
      { props: [["a", "1"], ["b", "2"]], created: "2026-09-27T00:00:00Z" },
      { props: [["b", "2"], ["d", "4"], ["c", "x"]], created: "2026-09-27T00:00:00Z" },
      { props: [["title", "two words"], ["x", "f(y)"], ["stage", "done"]], created: "2026-09-27T00:00:00Z" },
    ];
    const now = Date.parse("2026-09-28T12:00:00Z");
    for (const q of queries) {
      let mine: unknown, ref: unknown;
      try { mine = parseQuery(q).expr; } catch { mine = "error"; }
      try { ref = theirs.parseQueryExpression(q); } catch { ref = "error"; }
      expect({ q, parsed: mine }).toEqual({ q, parsed: ref });
      if (ref === "error") continue;
      const f = theirs.compileQueryExpression(ref, now);
      for (const s of subjects) {
        const properties = s.props.map(([key, value]) => ({ key: key!, value: value! }));
        const at = Date.parse(s.created);
        expect({ q, s, v: holds(mine as any, { properties, createdAt: at, updatedAt: at }, now) })
          .toEqual({ q, s, v: f({ createdAt: s.created, updatedAt: s.created }, properties) });
      }
    }
  });
});

describe("planning writes into a lane", () => {
  test("a new card is born with the plain clauses; an OR group is left for the text or the lane's create:: default", () => {
    expect(planCreate(lane("Doing", "stage=doing track=door"))).toEqual({ kind: "create", props: [{ key: "stage", value: "doing" }, { key: "track", value: "door" }], needs: [] });
    const p = planCreate(lane("Doing", ALL_WORK("doing")));
    expect(p.kind === "create" && p.props).toEqual([{ key: "type", value: "roadmap-item" }, { key: "work-stage", value: "doing" }]);
    expect(p.kind === "create" && p.needs.length).toBe(1);
    expect(planCreate(lane("Queued", ALL_WORK("queued"), { create: "project=ep0ch-door" })))
      .toEqual({ kind: "create", props: [{ key: "type", value: "roadmap-item" }, { key: "work-stage", value: "queued" }, { key: "project", value: "ep0ch-door" }], needs: [] });
    // Lanes that can't define a card say why.
    expect(planCreate(lane("Odd", "stage=a stage=b"))).toEqual({ kind: "refused", reason: "Odd asks for stage to be a and b at once; a card has one value" });
    expect(planCreate(lane("Old", "stage=doing created < 2020-01-01"))).toEqual({ kind: "refused", reason: "Old needs created < 2020-01-01, which a new card doesn't meet" });
    expect(planCreate(lane("Clash", "stage=doing", { create: "stage=done" }))).toEqual({ kind: "refused", reason: "Clash's create:: default stage=done contradicts its query (stage=doing)" });
    expect(planCreate({ name: "Broken", read: { status: "invalid", items: [], limit: 200, truncated: false, errors: ["Unclosed ("], filters: [] } })).toEqual({ kind: "refused", reason: "Broken is invalid: Unclosed (" });
  });

  test("the text: needed properties go on the first line, unless the text says so; a contradiction is refused", () => {
    const born = [{ key: "type", value: "roadmap-item" }, { key: "work-stage", value: "doing" }];
    expect(composeCardText("Mend the fence\nThe north side.", born, [])).toEqual({ text: "Mend the fence [type::roadmap-item] [work-stage::doing]\nThe north side." });
    expect(composeCardText("Mend the fence [work-stage::Doing]", born, [{ key: "work-stage", value: "Doing" }])).toEqual({ text: "Mend the fence [work-stage::Doing] [type::roadmap-item]" });
    expect(composeCardText("Mend the fence [work-stage::queued]", born, [{ key: "work-stage", value: "queued" }])).toEqual({ refused: "the text sets work-stage::queued, but the lane needs work-stage=doing" });
    // A card with the group met by a typed property passes; one without is refused with the term.
    const l = lane("Doing", ALL_WORK("doing"));
    expect(createMisses(l, [...born, { key: "project", value: "pi-outliner" }])).toBeNull();
    expect(createMisses(l, [...born, { key: "project", value: "garden" }])).toBe("Doing needs (project=pi-outliner OR project=ep0ch-door) and the card would have project=garden");
    expect(createMisses(l, born)).toBe("Doing needs (project=pi-outliner OR project=ep0ch-door) and the card would have no project");
  });

  test("where a new card goes: the lane's create-parent, else where most of its (or the board's) cards live, else refused", () => {
    const at = (parentId: string | null, id: string) => card({}, { id, parentId });
    expect(pickParent("Doing", card({ "create-parent": "p9" }), [], [])).toEqual({ id: "p9", why: "Doing's create-parent" });
    expect(pickParent("Doing", undefined, [at("p1", "a"), at("p1", "b"), at("p2", "c")], [])).toEqual({ id: "p1", why: "where 2 of 3 Doing's cards live" });
    expect(pickParent("Doing", undefined, [], [at("p1", "a"), at("p1", "a"), at("p2", "c"), at("p2", "d"), at("p2", "e")])).toEqual({ id: "p2", why: "where 3 of 4 the board's cards live" });
    expect(pickParent("Doing", undefined, [at("p1", "a"), at("p2", "b")], [at("p1", "a"), at("p2", "b")])).toEqual({ refused: "the board's cards live under different parents; give Doing a [create-parent::<block id>] to say where new cards go" });
    // Rows whose parent isn't known never vote for "top level".
    expect(pickParent("Doing", undefined, [at(null, "a"), at(null, "b")], [])).toEqual({ refused: "there's no card on the board to take a parent from; give Doing a [create-parent::<block id>]" });
  });

  test("the acceptance case: an All-work lane patches only work-stage for a card already in one of its projects", () => {
    const c = card({ type: "roadmap-item", project: "pi-outliner", "work-stage": "queued" });
    expect(planMove(c, lane("Doing", ALL_WORK("doing")))).toEqual({ kind: "patch", changes: [{ key: "work-stage", to: "doing", from: "queued" }] });
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

describe.skipIf(!outliner)("writing from the board, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: DeliveryBoard, hub: any, queue: any, elsewhere: any;
  const cards: Record<string, any> = {};
  let key: (k: Key) => void = () => {};
  const AS = "test-agent-406";
  const B = () => b as any;
  const act = (action: string, args: Record<string, unknown> = {}) => app.act({ action, args, as: AS });
  const make = (parentId: string | null, text: string) => other.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const press = (k: Key) => key(k);
  const type = (s: string) => { for (const ch of s) press(ch === "\n" ? { kind: "enter" } : { kind: "char", ch }); };
  const ctrl = (ch: string) => press({ kind: "char", ch, ctrl: true });
  const message = () => (app as any).message as string;
  const laneIndex = (name: string) => B().lanes.findIndex((l: any) => l.name === name);
  const laneIds = (name: string): string[] => (B().lanes[laneIndex(name)].items ?? []).map((m: Msg) => m.id);
  const settled = () => until(() => !B().moving && B().lanes.every((l: any) => l.items && !l.want), "lanes", 8000);
  const select = async (name: string, id: string) => {
    await until(() => laneIds(name).includes(id), `${id} in ${name}`, 8000);
    B().focus = "lanes"; B().lane = laneIndex(name); B().lanes[B().lane].sel = laneIds(name).indexOf(id); B().follow();
  };
  const lastBy = async (id: string, author: "agent" | "user") => {
    const log = await other.request("activity.recent", { author, limit: 50 });
    const e = log.entries.find((x: any) => x.block.id === id);
    return e && [e.author, e.actorId, e.kind];
  };
  /** Who a block was created by, as the service stored it. */
  const createdBy = async (id: string) => { const m = await current(id); return [m.author, m.actorId]; };
  const hints = () => b.render(B().ctx).lines.at(-1)!.replace(/\x1b\[[\d;]*m/g, "");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();                                                       // as the door does: learn the capabilities
    other = new SocketBoard(board.path);
    // The All-work shape: one board over two projects, lanes grouping them with OR.
    queue = await make(null, "Work queue");
    elsewhere = await make(null, "Older work");
    hub = await make(null, "All work Delivery Flow");
    await make(hub.id, `Queued [type::virtual-branch] [query::${ALL_WORK("queued")}] [create::project=ep0ch-door] [create-parent::${queue.id}]`);
    for (const s of ["doing", "review", "done"]) await make(hub.id, `${s[0]!.toUpperCase()}${s.slice(1)} [type::virtual-branch] [query::${ALL_WORK(s)}]`);
    await make(hub.id, "Everything [type::virtual-branch] [query::type=roadmap-item]");
    cards.kettle = await make(queue.id, "Descale the kettle [type::roadmap-item] [project::ep0ch-door] [work-stage::queued]");
    cards.shelf = await make(queue.id, "Level the shelf [type::roadmap-item] [project::pi-outliner] [work-stage::queued]\n\n- [ ] find the spirit level\n- [ ] loosen the brackets\n- [x] clear the books ^books");
    cards.bulb = await make(queue.id, "Swap the porch bulb [type::roadmap-item] [project::pi-outliner] [work-stage::doing]");
    cards.club = await make(elsewhere.id, "Plan the garden club rota [type::roadmap-item] [project::garden-club] [work-stage::queued]");
    cards.tap = await make(queue.id, "Fix the dripping tap [type::roadmap-item] [project::ep0ch-door] [work-stage::review]");
    await make(cards.tap.id, "Washer size is 1/2 inch.");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 5 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(async () => {
    board?.close(); other?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("moving into an OR lane: a card already in the group moves by patching work-stage alone", async () => {
    await select("Queued", cards.kettle.id);
    press({ kind: "char", ch: "H" });                                          // stage order: Doing is left of Queued
    await settled();
    const now = await current(cards.kettle.id);
    expect(now.text).toBe("Descale the kettle [type::roadmap-item] [project::ep0ch-door] [work-stage::doing]");
    expect(now.revision).toBe(cards.kettle.revision + 1);
    expect(laneIds("Doing")).toContain(cards.kettle.id);
    expect(message()).toBe("moved to Doing · work-stage queued -> doing · still in Everything too");
  });

  test("a card outside the group is refused with the term and what it has; nothing is written", async () => {
    await select("Everything", cards.club.id);
    const before = await current(cards.club.id);
    B().mover = null; press({ kind: "char", ch: "m" });
    const plan = B().mover.plans[laneIndex("Doing")];
    expect(plan).toEqual({ kind: "refused", reason: "Doing needs (project=pi-outliner OR project=ep0ch-door) and the card has project=garden-club; a move sets only the plain clauses beside it" });
    press({ kind: "esc" });
    await expect(act("card.move", { lane: "Doing", card: cards.club.id })).rejects.toThrow("Doing needs (project=pi-outliner OR project=ep0ch-door) and the card has project=garden-club");
    expect((await current(cards.club.id)).revision).toBe(before.revision);
  });

  test("n in a lane with create:: defaults: born with every property, under its create-parent, and in the lane through the change feed", async () => {
    await settled(); await Bun.sleep(400); await settled();                // the last move's own change records have been read
    B().focus = "lanes"; B().lane = laneIndex("Queued");
    const full = B().refreshes.full, asked = B().asked.length;
    press({ kind: "char", ch: "n" });
    await until(() => !!B().composer, "the composer");
    expect(B().composer.born).toEqual([{ key: "type", value: "roadmap-item" }, { key: "work-stage", value: "queued" }, { key: "project", value: "ep0ch-door" }]);
    expect(B().composer.parent).toMatchObject({ id: queue.id, why: "Queued's create-parent" });
    await until(() => B().composer.parent.title === "Work queue", "the parent's title");
    // While it's open every key is the text's, board keys included.
    type("Oil the hinges\nThe back door squeaks.");
    expect(B().composer.draft.text).toBe("Oil the hinges\nThe back door squeaks.");
    expect(b.unsaved()).toBe(true);
    ctrl("s");
    await until(() => !B().composer, "the create");
    const made = B().lastWrite.id;
    const m = await current(made);
    expect(m.text).toBe("Oil the hinges [type::roadmap-item] [work-stage::queued] [project::ep0ch-door]\nThe back door squeaks.");
    expect(m.parentId).toBe(queue.id);
    expect(await createdBy(made)).toEqual(["user", undefined]);
    expect(message()).toBe("created in Queued · Oil the hinges · born with type=roadmap-item work-stage=queued project=ep0ch-door");
    // The change feed brings it in: only the lanes that could hold it are asked, no full reload.
    await until(() => laneIds("Queued").includes(made), "the new card in Queued", 8000);
    expect(B().refreshes.full).toBe(full);
    expect(new Set(B().asked.slice(asked))).toEqual(new Set(["Queued", "Everything"]));
    expect(B().lanes[B().lane].items[B().lanes[B().lane].sel].id).toBe(made);   // selected
  });

  test("n in an OR lane without a default: the text must meet the group; a refusal keeps the text", async () => {
    await settled();
    B().focus = "lanes"; B().lane = laneIndex("Doing");
    press({ kind: "char", ch: "n" });
    await until(() => !!B().composer, "the composer");
    expect(B().composer.needs).toEqual(["(project=pi-outliner OR project=ep0ch-door)"]);
    // No create-parent: the parent most of the lane's cards share.
    expect(B().composer.parent).toMatchObject({ id: queue.id, why: "where Doing's cards live" });
    type("Replace the doormat");
    ctrl("s");
    await until(() => B().composer?.draft.note.startsWith("not created"), "the refusal");
    expect(B().composer.draft.note).toContain("not created: Doing needs (project=pi-outliner OR project=ep0ch-door) and the card would have no project");
    expect(B().composer.draft.text).toBe("Replace the doormat");               // kept
    type(" [project::pi-outliner]");
    ctrl("s");
    await until(() => !B().composer, "the create");
    const m = await current(B().lastWrite.id);
    expect(m.text).toBe("Replace the doormat [project::pi-outliner] [type::roadmap-item] [work-stage::doing]");
    await until(() => laneIds("Doing").includes(m.id), "the new card in Doing", 8000);
  });

  test("esc on a typed card asks twice; a click can't take the keys; an agent's create never touches it", async () => {
    await settled();
    B().focus = "lanes"; B().lane = laneIndex("Review");
    press({ kind: "char", ch: "n" });
    await until(() => !!B().composer, "the composer");
    type("Paint the railings");
    press({ kind: "mouse", action: "down", button: 0, x: 5, y: 5 });
    expect(B().composer).not.toBeNull();
    const r: any = await act("card.create", { lane: "Review", text: "Sweep the chimney [project::ep0ch-door]" });
    expect(r).toMatchObject({ lane: "Review", parent: queue.id, recordedAs: `agent ${AS}` });
    expect(B().composer.draft.text).toBe("Paint the railings");
    expect(await createdBy(r.id)).toEqual(["agent", AS]);
    expect(message()).toBe(`an agent (${AS}) · created in Review · Sweep the chimney · born with type=roadmap-item work-stage=review`);
    press({ kind: "esc" });
    expect(B().composer).not.toBeNull();
    press({ kind: "esc" });
    expect(B().composer).toBeNull();
    await expect(act("card.create", { lane: "Review", text: "Mow the lawn [project::garden-club]" })).rejects.toThrow("Review needs (project=pi-outliner OR project=ep0ch-door) and the card would have project=garden-club");
    await expect(act("card.create", { lane: "Review", text: "Mow the lawn [work-stage::doing] [project::ep0ch-door]" })).rejects.toThrow("the text sets work-stage::doing, but the lane needs work-stage=review");
  });

  test("typing straight after n or N is the card's text: no board key fires, nothing moves or opens", async () => {
    await settled();
    await select("Doing", cards.kettle.id);
    const before = await current(cards.kettle.id);
    press({ kind: "char", ch: "n" });
    type("Level the Hedge, then mend it");                                  // L, H, e, m, d: all board keys
    expect(B().composer.draft.text).toBe("Level the Hedge, then mend it");
    expect(B().details.some((d: any) => d.editing) || B().preview.editing).toBe(false);
    expect(B().mover).toBeNull();
    press({ kind: "esc" }); press({ kind: "esc" });
    press({ kind: "char", ch: "N" });
    type("Hmm, descale it monthly");
    expect(B().composer.draft.text).toBe("Hmm, descale it monthly");
    press({ kind: "esc" }); press({ kind: "esc" });
    expect(B().composer).toBeNull();
    await Bun.sleep(300);
    expect((await current(cards.kettle.id)).revision).toBe(before.revision);
    expect(B().trashArm).toBeNull();
  });

  test("N and note.create: a note under the card, as typed", async () => {
    await select("Review", cards.tap.id);
    press({ kind: "char", ch: "N" });
    await until(() => !!B().composer, "the composer");
    type("Bought two, just in case.");
    ctrl("s");
    await until(() => !B().composer, "the create");
    const kids = await other.request("children", { parentId: cards.tap.id });
    expect(kids.map((k: any) => k.text)).toEqual(["Washer size is 1/2 inch.", "Bought two, just in case."]);
    const r: any = await act("note.create", { text: "Fitted on Sunday.", parent: cards.tap.id });
    expect(r.parent).toBe(cards.tap.id);
    expect(await createdBy(r.id)).toEqual(["agent", AS]);
  });

  test("s: check off a step with space; the service gives it an id; an agent sets another; a stale step is refused", async () => {
    await select("Queued", cards.shelf.id);
    press({ kind: "char", ch: "s" });
    await until(() => !!B().steps?.read, "the steps");
    expect(B().describe().steps.items.map((i: any) => [i.status, i.text])).toEqual([["todo", "find the spirit level"], ["todo", "loosen the brackets"], ["done", "clear the books"]]);
    press({ kind: "char", ch: " " });
    await until(() => !B().steps.busy && B().steps.read.items[0].status === "done", "the step to change");
    const t1 = (await current(cards.shelf.id)).text;
    expect(t1).toMatch(/- \[x\] find the spirit level \^task-[\w-]+\n- \[ \] loosen the brackets\n- \[x\] clear the books \^books/);
    expect(message()).toMatch(/^checked off: find the spirit level · Level the shelf · the step now has an id \(\^task-/);
    expect(await lastBy(cards.shelf.id, "user")).toEqual(["user", expect.stringMatching(/^ep0ch-door:/), "text"]);
    press({ kind: "esc" });
    expect(B().steps).toBeNull();

    expect(await act("step.set", { card: cards.shelf.id, step: "books", status: "waiting" })).toMatchObject({ step: 3, status: "waiting", changed: true });
    expect(await lastBy(cards.shelf.id, "agent")).toEqual(["agent", AS, "text"]);
    expect(await act("steps", { card: cards.shelf.id })).toMatchObject({ steps: [{ n: 1, status: "done" }, { n: 2, status: "todo" }, { n: 3, status: "waiting", id: "books" }] });

    // The step is read, then someone rewords it: the change is refused and nothing is written.
    await select("Queued", cards.shelf.id);
    press({ kind: "char", ch: "s" });
    await until(() => !!B().steps?.read && !B().steps.busy, "the steps");
    press({ kind: "down" });
    const now = await current(cards.shelf.id);
    await other.request("update", { blockId: cards.shelf.id, text: now.text.replace("loosen the brackets", "loosen both brackets"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "someone-else" } });
    const rev = (await current(cards.shelf.id)).revision;
    press({ kind: "char", ch: "x" });
    await until(() => message().startsWith("not changed"), "the refusal");
    expect((await current(cards.shelf.id)).revision).toBe(rev);
    await until(() => !B().steps.busy, "the re-read");
    expect(B().describe().steps.items[1].text).toBe("loosen both brackets");
    press({ kind: "esc" });
  });

  test("d d trashes with the count of notes under it; the banner offers u, which restores", async () => {
    await settled();
    await select("Review", cards.tap.id);
    press({ kind: "char", ch: "d" });
    await until(() => message().startsWith("d again"), "the confirmation");
    expect(message()).toBe('d again trashes "Fix the dripping tap" and the 3 notes under it · any other key keeps it');
    press({ kind: "char", ch: "j" });                                     // any other key: kept
    press({ kind: "char", ch: "k" });
    press({ kind: "char", ch: "d" });
    await until(() => B().trashArm !== null && message().startsWith("d again"), "armed again");
    press({ kind: "char", ch: "d" });
    await until(() => B().trashed?.id === cards.tap.id, "the trash");
    expect(message()).toBe('trashed "Fix the dripping tap" and 3 notes under it · u restores it');
    expect(hints()).toContain('TRASHED "Fix the dripping tap" · u restores');
    await until(() => !laneIds("Review").includes(cards.tap.id), "gone from Review", 8000);
    press({ kind: "char", ch: "u" });
    await until(() => laneIds("Review").includes(cards.tap.id), "back in Review", 8000);
    expect(message()).toBe('restored "Fix the dripping tap"');
    expect(B().trashed).toBeNull();
    expect((await other.request("children", { parentId: cards.tap.id })).length).toBe(3);
  });

  test("card.trash needs confirm=<that card's id>; a card changed since it was shown is refused; card.restore brings it back", async () => {
    await settled();
    await expect(act("card.trash", { card: cards.bulb.id, confirm: cards.kettle.id })).rejects.toThrow("doesn't name");
    // Changed after the board showed it: refused, nothing trashed.
    const shown = B().lanes[laneIndex("Doing")].items.find((m: Msg) => m.id === cards.bulb.id);
    const now = await current(cards.bulb.id);
    await other.request("update", { blockId: cards.bulb.id, text: now.text + "\nNeeds a ladder.", expectedRevision: now.revision, mutation: { author: "agent", actorId: "someone-else" } });
    await expect(act("card.trash", { card: cards.bulb.id, confirm: cards.bulb.id })).rejects.toThrow(`the card changed since the board showed it (revision ${shown.revision} -> ${shown.revision + 1})`);
    expect((await current(cards.bulb.id)).deletedAt).toBeUndefined();
    await until(() => B().lanes[laneIndex("Doing")].items.find((m: Msg) => m.id === cards.bulb.id)?.revision === shown.revision + 1, "the lane to catch up", 8000);
    const r: any = await act("card.trash", { card: cards.bulb.id, confirm: cards.bulb.id.slice(0, 8) });
    expect(r).toMatchObject({ trashed: cards.bulb.id, lane: "Doing", recordedAs: "not recorded: the service's delete takes no author" });
    expect((await current(cards.bulb.id)).deletedAt).toBeDefined();
    expect(hints()).toContain(`TRASHED "Swap the porch bulb" by an agent (${AS}) · u restores`);
    expect(await act("card.restore")).toMatchObject({ restored: cards.bulb.id });
    expect((await current(cards.bulb.id)).deletedAt).toBeUndefined();
    await expect(act("card.restore", { id: cards.bulb.id })).rejects.toThrow("Block is not a direct Trash root");
  });

  test("a card held by an edit isn't trashed, stepped or moved under it", async () => {
    await settled();
    await select("Queued", cards.shelf.id);
    press({ kind: "enter" });
    await Bun.sleep(100);
    press({ kind: "char", ch: "e" });
    await until(() => B().details.some((d: any) => d.editing), "the draft");
    press({ kind: "char", ch: "!" });
    B().focus = "lanes";
    const why = "it's open for editing with unsaved changes · save (ctrl+s) or close (esc) the edit first";
    await expect(act("card.trash", { card: cards.shelf.id, confirm: cards.shelf.id })).rejects.toThrow(why);
    await expect(act("step.set", { card: cards.shelf.id, step: "2" })).rejects.toThrow(why);
    B().focus = `detail${B().details.findIndex((d: any) => d.editing)}`;
    press({ kind: "esc" }); press({ kind: "esc" });
    expect(b.unsaved()).toBe(false);
  });

  test("the control socket: the new actions are listed and run as the agent that asked", async () => {
    const ctl = await startControl({ app, mirror: new Mirror(180, 50), info: () => (app as any).t }, join(scratch.root, "door.sock"));
    const ask = (req: object) => new Promise<any>((res, rej) => {
      const c = connect(ctl.path, () => c.write(JSON.stringify(req) + "\n"));
      let buf = "";
      c.on("data", d => { buf += d; const i = buf.indexOf("\n"); if (i >= 0) { c.end(); res(JSON.parse(buf.slice(0, i))); } });
      c.on("error", rej);
    });
    try {
      const listed = await ask({ cmd: "actions" });
      expect(listed.result.actions.map((a: any) => a.name)).toEqual(expect.arrayContaining(["card.create", "note.create", "steps", "step.set", "card.trash", "card.restore", "card.move"]));
      const made = await ask({ cmd: "act", action: "card.create", args: { lane: "Queued", text: "Bleed the radiators" }, as: "socket-agent" });
      expect(made).toMatchObject({ ok: true, result: { lane: "Queued", parent: queue.id, bornWith: ["type=roadmap-item", "work-stage=queued", "project=ep0ch-door"] } });
      await until(() => laneIds("Queued").includes(made.result.id), "the socket card in Queued", 8000);
      const moved = await ask({ cmd: "act", action: "card.move", args: { lane: "Done", card: made.result.id }, as: "socket-agent" });
      expect(moved).toMatchObject({ ok: true, result: { lane: "Done", result: expect.stringMatching(/^moved: work-stage queued -> done/) } });
      const trash = await ask({ cmd: "act", action: "card.trash", args: { card: made.result.id }, as: "socket-agent" });
      expect(trash).toMatchObject({ ok: false, error: expect.stringContaining("card.trash needs confirm") });
    } finally { ctl.close(); }
  });
});

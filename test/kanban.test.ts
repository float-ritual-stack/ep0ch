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
import { pickParent } from "../src/desk/writes";
import { Mirror } from "../src/mirror";
import { MainMenu } from "../src/screens";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const card = (props: Record<string, string>, over: Partial<Msg> = {}): Msg => ({
  id: "c1", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, revision: 1, props,
  properties: Object.entries(props).map(([key, value]) => ({ key, value })), ...over,
});

const ALL_WORK = (stage: string) => `type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=${stage}`;

// What a card is born with, and what a move patches, are the service's plans (views.planWrite, PIE-490);
// pi-herdr-outliner's test/view-writes.test.ts covers that planning. Where a new card goes is the door's.
describe("where a new card goes", () => {
  test("where a new card goes: the lane's create-parent, else where most of its (or the board's) cards live, else refused", () => {
    const at = (parentId: string | null, id: string) => card({}, { id, parentId });
    expect(pickParent("Doing", card({ "create-parent": "p9" }), [], [])).toEqual({ id: "p9", why: "Doing's create-parent" });
    expect(pickParent("Doing", undefined, [at("p1", "a"), at("p1", "b"), at("p2", "c")], [])).toEqual({ id: "p1", why: "where 2 of 3 Doing's cards live" });
    expect(pickParent("Doing", undefined, [], [at("p1", "a"), at("p1", "a"), at("p2", "c"), at("p2", "d"), at("p2", "e")])).toEqual({ id: "p2", why: "where 3 of 4 the board's cards live" });
    expect(pickParent("Doing", undefined, [at("p1", "a"), at("p2", "b")], [at("p1", "a"), at("p2", "b")])).toEqual({ refused: "the board's cards live under different parents; give Doing a [create-parent::<block id>] to say where new cards go" });
    // Rows whose parent isn't known never vote for "top level".
    expect(pickParent("Doing", undefined, [at(null, "a"), at(null, "b")], [])).toEqual({ refused: "there's no card on the board to take a parent from; give Doing a [create-parent::<block id>]" });
  });

});

// ── against a scratch outliner service ────────────────────────────────────────

describe.skipIf(!outliner)("writing from the board, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, app: App, b: DeliveryBoard, hub: any, queue: any, queue2: any, elsewhere: any, chores: any;
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
    // The All-work shape: one board over two projects, lanes grouping them with OR. Each project has
    // one active work queue and the outline a Work-ID prefix, as the workboard's allocator requires.
    await other.request("work-ids.configure", { prefix: "HOME" });
    queue = await make(null, "Door work queue [type::work-queue] [project::ep0ch-door]");
    queue2 = await make(null, "Outliner work queue [type::work-queue] [project::pi-outliner]");
    elsewhere = await make(null, "Older work");
    chores = await make(null, "Chores");
    hub = await make(null, "All work Delivery Flow");
    await make(hub.id, `Queued [type::virtual-branch] [query::${ALL_WORK("queued")}] [create::project=ep0ch-door]`);
    for (const s of ["doing", "review", "done"]) await make(hub.id, `${s[0]!.toUpperCase()}${s.slice(1)} [type::virtual-branch] [query::${ALL_WORK(s)}]`);
    await make(hub.id, "Everything [type::virtual-branch] [query::type=roadmap-item]");
    // An ordinary (not roadmap) lane with an OR group and a create:: default.
    await make(hub.id, `Chores [type::virtual-branch] [query::type=chore (area=kitchen OR area=garden) stage=todo] [create::area=kitchen] [create-parent::${chores.id}]`);
    cards.kettle = await make(queue.id, "Descale the kettle [type::roadmap-item] [project::ep0ch-door] [work-stage::queued]");
    cards.shelf = await make(queue2.id, "Level the shelf [type::roadmap-item] [project::pi-outliner] [work-stage::queued]\n\n- [ ] find the spirit level\n- [ ] loosen the brackets\n- [x] clear the books ^books");
    cards.bulb = await make(queue2.id, "Swap the porch bulb [type::roadmap-item] [project::pi-outliner] [work-stage::doing]");
    cards.pantry = await make(queue2.id, "Stock the pantry [type::roadmap-item] [project::pi-outliner] [work-stage::doing]\n\n- [ ] buy rice\n- [ ] buy beans");
    cards.club = await make(elsewhere.id, "Plan the garden club rota [type::roadmap-item] [project::garden-club] [work-stage::queued]");
    cards.tap = await make(queue.id, "Fix the dripping tap [type::roadmap-item] [project::ep0ch-door] [work-stage::review]");
    await make(cards.tap.id, "Washer size is 1/2 inch.");
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    b = new DeliveryBoard(hub.id);
    app.push(new MainMenu()); app.push(b);
    await until(() => B().lanes.length === 6 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
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
    await until(() => !!B().mover?.plans, "the service's plans");
    const plan = B().mover.plans[laneIndex("Doing")];
    expect(plan).toEqual({ kind: "refused", reason: "Doing needs (project=pi-outliner OR project=ep0ch-door) and the note has project=garden-club; a move sets only the plain clauses beside it" });
    press({ kind: "esc" });
    await expect(act("card.move", { lane: "Doing", card: cards.club.id })).rejects.toThrow("Doing needs (project=pi-outliner OR project=ep0ch-door) and the note has project=garden-club");
    expect((await current(cards.club.id)).revision).toBe(before.revision);
  });

  test("n in a roadmap lane: the workboard's allocator makes the item, issues its work-id and files it in its project's queue", async () => {
    await settled(); await Bun.sleep(400); await settled();                // the last move's own change records have been read
    B().focus = "lanes"; B().lane = laneIndex("Queued");
    const full = B().refreshes.full, asked = B().asked.length, sent = board.sent.length;
    press({ kind: "char", ch: "n" });
    await until(() => B().composer && !B().composer.planning, "the composer and the lane's plan");
    expect(B().composer.born).toEqual([{ key: "type", value: "roadmap-item" }, { key: "work-stage", value: "queued" }]);
    expect(B().composer.defaults).toEqual([{ key: "project", value: "ep0ch-door" }]);
    expect(B().composer.parent).toBeNull();                                  // the allocator places it
    // Without priority, arc and track the allocator can't make it: refused before any write, text kept.
    type("Oil the hinges\nThe back door squeaks.");
    ctrl("s");
    await until(() => B().composer?.draft.note.startsWith("not created"), "the refusal");
    expect(B().composer.draft.note).toContain("not created: Queued makes roadmap items through the workboard's allocator, which needs priority, arc and a track: add [priority::high|medium|low] [arc::…] [track::…] to the text");
    expect(B().composer.draft.text).toBe("Oil the hinges\nThe back door squeaks.");
    press({ kind: "esc" }); press({ kind: "esc" });
    press({ kind: "char", ch: "n" });
    await until(() => !!B().composer, "the composer");
    type("Oil the hinges [priority::medium] [arc::home] [track::doors]\nThe back door squeaks.");
    ctrl("s");
    await until(() => !B().composer, "the create");
    const made = B().lastWrite.id;
    const m = await current(made);
    const workId = m.properties.find((p: any) => p.key === "work-id").value;
    expect(workId).toMatch(/^HOME-\d+$/);
    expect(m.text).toBe(`${workId} — Oil the hinges [type::roadmap-item] [priority::medium] [work-stage::queued] [project::ep0ch-door] [arc::home] [track::doors] [work-id::${workId}]\n\nThe back door squeaks.`);
    expect(m.parentId).toBe(queue.id);                                      // ep0ch-door's work queue
    expect(await createdBy(made)).toEqual(["user", undefined]);
    expect(board.sent.slice(sent)).toContain("roadmap.items.create");
    expect(board.sent.slice(sent)).not.toContain("create");                   // never a plain create
    expect(message()).toBe(`created ${workId} in Queued · Oil the hinges · priority=medium arc=home track=doors project=ep0ch-door`);
    // The change feed brings it in: only the lanes that could hold it are asked, no full reload.
    await until(() => laneIds("Queued").includes(made), "the new item in Queued", 8000);
    expect(B().refreshes.full).toBe(full);
    expect(new Set(B().asked.slice(asked))).toEqual(new Set(["Queued", "Everything"]));
    expect(B().lanes[B().lane].items[B().lanes[B().lane].sel].id).toBe(made);   // the person's own create is selected
  });

  test("a typed project in the lane's OR group wins over its create:: default (B3); one outside it is refused", async () => {
    await settled();
    const r: any = await act("card.create", { lane: "Queued", text: "Tune the piano [project::pi-outliner] [priority::low] [arc::music] [track::keys]" });
    expect(r).toMatchObject({ lane: "Queued", parent: queue2.id, workId: expect.stringMatching(/^HOME-\d+$/), recordedAs: `agent ${AS}` });
    const m = await current(r.id);
    expect(m.properties.filter((p: any) => p.key === "project").map((p: any) => p.value)).toEqual(["pi-outliner"]);
    expect(await createdBy(r.id)).toEqual(["agent", AS]);
    await expect(act("card.create", { lane: "Queued", text: "Mow the lawn [project::garden-club] [priority::low] [arc::a] [track::t]" }))
      .rejects.toThrow("Queued needs (project=pi-outliner OR project=ep0ch-door) and the note would have project=garden-club");
    // The same rule on an ordinary lane: the text's area wins; without one, the default applies.
    const weed: any = await act("card.create", { lane: "Chores", text: "Weed the beds [area::garden]" });
    expect((await current(weed.id)).text).toBe("Weed the beds [area::garden] [type::chore] [stage::todo]");
    expect(weed).toMatchObject({ parent: chores.id, bornWith: ["type=chore", "stage=todo"] });
    const wipe: any = await act("card.create", { lane: "Chores", text: "Wipe the counters" });
    expect((await current(wipe.id)).text).toBe("Wipe the counters [type::chore] [stage::todo] [area::kitchen]");
    expect(wipe.bornWith).toEqual(["type=chore", "stage=todo", "area=kitchen"]);
    await until(() => laneIds("Chores").includes(weed.id) && laneIds("Chores").includes(wipe.id), "both chores listed", 8000);
  });

  test("n in an OR roadmap lane without a default: the text must meet the group; a refusal keeps the text", async () => {
    await settled();
    B().focus = "lanes"; B().lane = laneIndex("Doing");
    press({ kind: "char", ch: "n" });
    await until(() => B().composer && !B().composer.planning, "the composer and the lane's plan");
    expect(B().composer.needs).toEqual(["(project=pi-outliner OR project=ep0ch-door)"]);
    type("Replace the doormat [priority::low] [arc::home] [track::doors]");
    ctrl("s");
    await until(() => B().composer?.draft.note.startsWith("not created"), "the refusal");
    expect(B().composer.draft.note).toContain("not created: Doing makes roadmap items through the workboard's allocator, which needs project: add [project::…] to the text");
    expect(B().composer.draft.text).toBe("Replace the doormat [priority::low] [arc::home] [track::doors]");   // kept
    type(" [project::pi-outliner]");
    ctrl("s");
    await until(() => !B().composer, "the create");
    const m = await current(B().lastWrite.id);
    expect(m.text).toMatch(/^HOME-\d+ — Replace the doormat \[type::roadmap-item\] \[priority::low\] \[work-stage::doing\] \[project::pi-outliner\]/);
    expect(m.parentId).toBe(queue2.id);
    await until(() => laneIds("Doing").includes(m.id), "the new item in Doing", 8000);
  });

  test("Review, Validate and Done lanes refuse a new roadmap item: create in Queued or Doing, then move", async () => {
    await settled();
    B().focus = "lanes"; B().lane = laneIndex("Review");
    press({ kind: "char", ch: "n" });
    await until(() => !B().composer, "the refusal closes the empty composer");
    expect(message()).toBe("can't create in Review: Review lists work-stage=review: roadmap items are created in Queued or Doing, then moved");
    await expect(act("card.create", { lane: "Done", text: "Paint the railings [project::ep0ch-door] [priority::low] [arc::a] [track::t]" }))
      .rejects.toThrow("Done lists work-stage=done: roadmap items are created in Queued or Doing, then moved");
    await expect(act("card.create", { lane: "Everything", text: "Paint the railings [work-stage::review] [project::ep0ch-door] [priority::low] [arc::a] [track::t]" }))
      .rejects.toThrow("roadmap items aren't created in review: create in Queued or Doing, then move");
    await expect(act("card.create", { lane: "Queued", text: "Paint it [priority::low] [arc::a] [track::t]", parent: chores.id }))
      .rejects.toThrow("the workboard's allocator puts them under their project's work queue, so parent= can't be chosen");
  });

  test("an agent's create or restore never moves the person's selection, focus or collapsed lanes (B1)", async () => {
    await settled();
    await select("Doing", cards.kettle.id);
    const q = B().lanes[laneIndex("Queued")];
    const queuedSel = q.items[q.sel].id;
    B().collapsed.add("Queued"); B().save();
    const r: any = await act("card.create", { lane: "Queued", text: "Clean the gutters [priority::low] [arc::home] [track::roof]" });
    await until(() => laneIds("Queued").includes(r.id), "the agent's item in Queued", 8000);
    await settled();
    expect(B().lane).toBe(laneIndex("Doing"));
    expect(B().card()?.id).toBe(cards.kettle.id);
    expect(q.items[q.sel].id).toBe(queuedSel);
    expect(B().collapsed.has("Queued")).toBe(true);
    expect(JSON.parse(await Bun.file(join(scratch.root, "door", "delivery.json")).text()).collapsed).toContain("Queued");
    B().collapsed.delete("Queued"); B().save();
    // An agent trashes and restores another card in the person's lane: the person stays on theirs.
    await act("card.trash", { card: cards.bulb.id, confirm: cards.bulb.id });
    await until(() => !laneIds("Doing").includes(cards.bulb.id), "bulb gone", 8000);
    await select("Doing", cards.kettle.id);
    await act("card.restore");
    await until(() => laneIds("Doing").includes(cards.bulb.id), "bulb back", 8000);
    await settled();
    expect(B().card()?.id).toBe(cards.kettle.id);
  });

  test("a drawer pins into the layout by T or by a click on its [ ] pin, and unpins the same way", async () => {
    await settled();
    B().focus = "lanes";
    const drawn = () => b.render(B().ctx).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
    const clickPin = () => {
      const r = B().rects.get("pin:tree");
      press({ kind: "mouse", action: "down", button: 0, x: r.col + 1, y: r.row });
      press({ kind: "mouse", action: "up", button: 0, x: r.col + 1, y: r.row });
    };
    press({ kind: "char", ch: "t" });
    expect(drawn()).toContain("[ ] pin · outline");          // a drawer: slides over, not pinned
    expect(B().treePinned).toBe(false);
    clickPin();
    expect(B().treePinned).toBe(true);
    expect(drawn()).toContain("[x] pin · outline");
    expect(drawn()).toContain("T unpin");
    clickPin();
    expect(B().treePinned).toBe(false);
    press({ kind: "char", ch: "T" });                         // the key is the same toggle
    expect(B().treePinned).toBe(true);
    press({ kind: "char", ch: "T" });
    press({ kind: "esc" });
    expect(B().treePinned).toBe(false);
  });

  test("esc on a typed card asks twice; a click can't take the keys; an agent's create never touches it", async () => {
    await settled();
    B().focus = "lanes"; B().lane = laneIndex("Doing");
    press({ kind: "char", ch: "n" });
    await until(() => !!B().composer, "the composer");
    type("Paint the railings");
    press({ kind: "mouse", action: "down", button: 0, x: 5, y: 5 });
    expect(B().composer).not.toBeNull();
    const r: any = await act("card.create", { lane: "Doing", text: "Sweep the chimney [project::ep0ch-door] [priority::high] [arc::home] [track::roof]" });
    expect(r).toMatchObject({ lane: "Doing", parent: queue.id, recordedAs: `agent ${AS}` });
    expect(B().composer.draft.text).toBe("Paint the railings");
    expect(await createdBy(r.id)).toEqual(["agent", AS]);
    expect(message()).toBe(`an agent (${AS}) · created ${r.workId} in Doing · Sweep the chimney · priority=high arc=home track=roof project=ep0ch-door`);
    press({ kind: "esc" });
    expect(B().composer).not.toBeNull();
    press({ kind: "esc" });
    expect(B().composer).toBeNull();
    await expect(act("card.create", { lane: "Doing", text: "Mow the lawn [work-stage::queued] [project::ep0ch-door] [priority::low] [arc::a] [track::t]" })).rejects.toThrow("the text sets work-stage::queued, but Doing needs work-stage=doing");
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
    expect(t1).toMatch(/- \[x\] find the spirit level \^t-[0-9a-f]+\n- \[ \] loosen the brackets\n- \[x\] clear the books \^books/);
    expect(message()).toMatch(/^checked off: find the spirit level · Level the shelf · the step now has an id \(\^t-/);
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

  test("the steps overlay follows the note; step.set step=N reads the steps fresh, never the overlay (B2)", async () => {
    await settled();
    await select("Doing", cards.pantry.id);
    press({ kind: "char", ch: "s" });
    await until(() => !!B().steps?.read && !B().steps.busy, "the steps");
    const stale = B().steps.read;
    const texts = () => B().describe().steps.items.map((i: any) => i.text);
    expect(texts()).toEqual(["buy rice", "buy beans"]);
    // Someone else puts a step first: the open overlay reads the note again from its change record.
    const now = await current(cards.pantry.id);
    await other.request("update", { blockId: cards.pantry.id, text: now.text.replace("- [ ] buy rice", "- [ ] find the list\n- [ ] buy rice"), expectedRevision: now.revision, mutation: { author: "agent", actorId: "someone-else" } });
    await until(() => texts()[0] === "find the list", "the overlay to follow the note", 8000);
    // Even with the overlay behind the note, a numbered step means the note's step as it is now.
    B().steps.read = stale;
    expect(await act("step.set", { card: cards.pantry.id, step: "1" })).toMatchObject({ step: 1, status: "done", changed: true });
    const text = (await current(cards.pantry.id)).text;
    expect(text).toMatch(/- \[x\] find the list \^t-[0-9a-f]+\n- \[ \] buy rice\n- \[ \] buy beans/);
    press({ kind: "esc" });
  });

  test("a trash whose answer was lost, but which landed, is reported as trashed with its undo (B4)", async () => {
    await settled();
    const rev = (await current(cards.pantry.id)).revision;
    await until(() => B().lanes[laneIndex("Doing")].items.find((m: Msg) => m.id === cards.pantry.id)?.revision === rev, "the lane to catch up", 8000);
    const real = board.trash.bind(board);
    try {
      // The delete lands, then the answer is lost.
      board.trash = async (id: string) => { await real(id); throw new Error("delete timed out"); };
      const r: any = await act("card.trash", { card: cards.pantry.id, confirm: cards.pantry.id });
      expect(r).toMatchObject({ trashed: cards.pantry.id, lane: "Doing" });
      expect(message()).toBe(`an agent (${AS}) · trashed "Stock the pantry" · u restores it (the outline's answer was lost: delete timed out; it is in Trash)`);
      expect(hints()).toContain(`TRASHED "Stock the pantry" by an agent (${AS}) · u restores`);
      expect(await act("card.restore")).toMatchObject({ restored: cards.pantry.id });
      await until(() => laneIds("Doing").includes(cards.pantry.id), "pantry back", 8000);
      // Lost before it reached the outline: the card is still there, and it says so.
      board.trash = async () => { throw new Error("delete timed out"); };
      await expect(act("card.trash", { card: cards.pantry.id, confirm: cards.pantry.id })).rejects.toThrow("delete timed out; the card is still there");
      expect(B().trashed).toBeNull();
    } finally { board.trash = real; }
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
      const made = await ask({ cmd: "act", action: "card.create", args: { lane: "Queued", text: "Bleed the radiators [priority::low] [arc::heating] [track::radiators]" }, as: "socket-agent" });
      expect(made).toMatchObject({ ok: true, result: { lane: "Queued", parent: queue.id, workId: expect.stringMatching(/^HOME-\d+$/), bornWith: ["type=roadmap-item", "priority=low", "work-stage=queued", "project=ep0ch-door", "arc=heating", "track=radiators"] } });
      await until(() => laneIds("Queued").includes(made.result.id), "the socket card in Queued", 8000);
      const moved = await ask({ cmd: "act", action: "card.move", args: { lane: "Done", card: made.result.id }, as: "socket-agent" });
      expect(moved).toMatchObject({ ok: true, result: { lane: "Done", result: expect.stringMatching(/^moved: work-stage queued -> done/) } });
      const trash = await ask({ cmd: "act", action: "card.trash", args: { card: made.result.id }, as: "socket-agent" });
      expect(trash).toMatchObject({ ok: false, error: expect.stringContaining("card.trash needs confirm") });
    } finally { ctl.close(); }
  });
});

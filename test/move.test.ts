// EPD-002: moving cards between board lanes. The plan is pure and tested anywhere; the moves run
// through the real board (keys, the move picker, a mouse drag) against a throwaway outliner service
// it starts itself (never a real outline), and skip without one.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Subprocess } from "bun";
import type { Msg } from "../src/board";
import { DeliveryBoard } from "../src/desk/delivery";
import { planMove, type LaneLike } from "../src/move";
import { ACTOR_ID, EditConflict, SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { parseFilterExpression, readView, type ViewRead } from "../src/views";

const until = async (ok: () => boolean, what: string, ms = 5000) => {
  const end = Date.now() + ms;
  while (!ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(20); }
};
const card = (props: [string, string][], revision = 1): Msg => ({
  id: "c1", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, revision,
  props: Object.fromEntries(props), properties: props.map(([key, value]) => ({ key, value })),
});
const lane = (name: string, query: string): LaneLike => {
  let read: ViewRead;
  try { read = { status: "ready", items: [], limit: 200, truncated: false, errors: [], filters: parseFilterExpression(query) }; }
  catch (e) { read = { status: "invalid", items: [], limit: 200, truncated: false, errors: [`Invalid virtual branch query: ${(e as Error).message}`], filters: [] }; }
  return { name, read };
};

describe("planning a move", () => {
  test("one clause: replace the differing value", () => {
    expect(planMove(card([["stage", "queued"]]), lane("Doing", "stage=doing"))).toEqual({ kind: "patch", changes: [{ key: "stage", to: "doing", from: "queued" }] });
  });
  test("several clauses: only the values that differ, appending what's missing", () => {
    const p = planMove(card([["stage", "queued"], ["track", "door"]]), lane("Review", "stage=review track=door owner::sam"));
    expect(p).toEqual({ kind: "patch", changes: [{ key: "stage", to: "review", from: "queued" }, { key: "owner", to: "sam", from: null }] });
  });
  test("values compare case-insensitively, like the outliner's matcher", () => {
    expect(planMove(card([["stage", "Done"]]), lane("Done", "stage=done"))).toEqual({ kind: "already" });
  });
  test("a presence clause the card already satisfies is fine; one it lacks is refused", () => {
    expect(planMove(card([["stage", "queued"], ["owner", "sam"]]), lane("Mine", "owner stage=doing")).kind).toBe("patch");
    const p = planMove(card([["stage", "queued"]]), lane("Owned", "owner"));
    expect(p).toEqual({ kind: "refused", reason: "Owned asks for any owner:: value; a move can't choose one" });
    // A bare word is a presence clause in this grammar, not a text search.
    expect(planMove(card([["stage", "queued"]]), lane("Urgent", "urgent stage=doing")).kind).toBe("refused");
  });
  test("two values for one key can't both be set", () => {
    const p = planMove(card([["stage", "queued"]]), lane("Odd", "stage=a stage=b"));
    expect(p.kind === "refused" && p.reason).toBe("Odd asks for stage to be a and b at once; a move sets one value");
  });
  test("a card with two values for the key isn't guessed at", () => {
    const p = planMove(card([["stage", "queued"], ["stage", "doing"]]), lane("Done", "stage=done"));
    expect(p.kind === "refused" && p.reason).toContain("the card has 2 stage:: values (queued, doing)");
  });
  test("negation, OR and AND are not in the grammar: the lane is invalid and refused with the parser's reason", () => {
    for (const q of ["stage=done or stage=review", "not stage=done", "stage=done and track=door", "-stage=done", "stage:done", "1stage=x", 'stage="done" extra"', ""]) {
      const p = planMove(card([["stage", "queued"]]), q ? lane("Weird", q) : { name: "Weird", read: { status: "invalid", items: [], limit: 200, truncated: false, errors: ["Virtual branch query cannot be empty"], filters: [] } });
      expect(p.kind).toBe("refused");
    }
    const p = planMove(card([["stage", "queued"]]), lane("Weird", "stage=done or stage=review"));
    expect(p.kind === "refused" && p.reason).toBe("Weird is invalid: Invalid virtual branch query: Boolean operator or is not supported");
  });
  test("a lane that hasn't loaded, or failed, is refused", () => {
    expect(planMove(card([]), { name: "Later" }).kind).toBe("refused");
    expect(planMove(card([]), { name: "Broken", read: { status: "failed", items: [], limit: 200, truncated: false, errors: ["socket closed"], filters: [] } })).toEqual({ kind: "refused", reason: "Broken is failed: socket closed" });
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

const outliner = [process.env.EP0CH_OUTLINER, resolve(import.meta.dir, "../../pi-herdr-outliner")]
  .find(p => p && existsSync(join(p, "src/server-main.ts")));

describe.skipIf(!outliner)("parser parity with the outliner", () => {
  test("the door parses (or rejects) every query the way block-query.ts does", async () => {
    const theirs = await import(join(outliner!, "src/block-query.ts"));
    const queries = ["stage=done", "stage::done", "Stage=Done track=door", 'title="two words"', 'x="a \\"q\\" b"', "owner", "urgent stage=doing",
      "stage=done or stage=review", "not stage=done", "and", "-stage=done", "stage:done", "1stage=x", "_x=1", "a.b-c_d=1",
      'stage="done" extra"', 'stage="unterminated', 'x="bad \\n escape"', "stage=", "=done", "x=a]b", "  stage=done   track=door  ", 'x=" padded "'];
    for (const q of queries) {
      let mine: unknown, ref: unknown;
      try { mine = parseFilterExpression(q); } catch { mine = "error"; }
      try { ref = theirs.parsePropertyFilterExpression(q); } catch { ref = "error"; }
      expect({ q, parsed: mine }).toEqual({ q, parsed: ref });
    }
  });
});

describe.skipIf(!outliner)("moving cards against a scratch outline", () => {
  let root = "", proc: Subprocess | null = null, sock: SocketBoard, other: SocketBoard;
  let hub: any, cards: Record<string, any> = {};
  const flashes: string[] = [];
  const T = { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false };
  let b: DeliveryBoard;
  const B = () => b as any;
  const create = (parentId: string | null, text: string) => sock.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const props = async (id: string) => (await current(id)).properties.map((p: any) => `${p.key}=${p.value}`);
  const laneIndex = (name: string) => B().lanes.findIndex((l: any) => l.name === name);
  const laneIds = (name: string): string[] => (B().lanes[laneIndex(name)].items ?? []).map((m: Msg) => m.id);
  const press = (k: Key) => b.key(k, B().ctx);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const settled = () => until(() => !B().moving && B().lanes.every((l: any) => l.items && !l.want), "the move to land and lanes to reload");
  const reload = async () => { B().loadLanes(); await Bun.sleep(50); await until(() => B().lanes.every((l: any) => l.items), "lanes"); await Bun.sleep(200); };
  const select = async (laneName: string, id: string) => {
    await reload();
    const i = laneIndex(laneName);
    const at = laneIds(laneName).indexOf(id);
    if (at < 0) throw new Error(`${id} isn't in ${laneName}: ${laneIds(laneName)}`);
    B().focus = "lanes"; B().lane = i; B().lanes[i].sel = at;
  };
  /** The move picker by keys: m, j/k to the lane, enter. */
  const pick = (name: string) => {
    ch("m");
    const to = laneIndex(name);
    for (let n = 0; B().mover && B().mover.sel !== to && n < 20; n++) ch(B().mover.sel < to ? "j" : "k");
    press({ kind: "enter" });
  };
  const selected = () => { const l = B().lanes[B().lane]; return { lane: l.name, id: l.items?.[l.sel]?.id }; };

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), "ep0ch-move-test-"));
    for (const d of ["ws", "state", "config", "door"]) mkdirSync(join(root, d));
    process.env.EP0CH_STATE = join(root, "door");       // the board's layout file goes here, not into real state
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      OUTLINER_STATE_DIR: join(root, "state"), OUTLINER_WORKSPACE_ROOT: join(root, "ws"), XDG_CONFIG_HOME: join(root, "config"),
      OUTLINER_INBOX_AGENT: "0", OUTLINER_NOTE_ASSISTANCE: "0",
    };
    for (const k of ["HERDR_ENV", "HERDR_SOCKET_PATH", "HERDR_PANE_ID", "HERDR_WORKSPACE_ID", "HERDR_TAB_ID"]) delete env[k];
    proc = Bun.spawn(["bun", "src/server-main.ts"], { cwd: outliner, env, stdout: "ignore", stderr: "ignore" });
    let path = "";
    await until(() => {
      const dirs = existsSync(join(root, "state")) ? readdirSync(join(root, "state")) : [];
      path = dirs.map(d => join(root, "state", d, "outliner.sock")).find(existsSync) ?? "";
      return !!path;
    }, "the scratch service socket", 15_000);
    sock = new SocketBoard(path);
    other = new SocketBoard(path);
    const info = await sock.info();
    expect(info.workspace).toBe(join(root, "ws"));      // it really is the scratch outline

    hub = await create(null, "Scratch move board");
    for (const [name, q] of [
      ["Queued", "[query::work-stage=queued]"], ["Doing", "[query::work-stage=doing]"],
      ["Review", "[query::work-stage=review track=door]"], ["Done", "[query::work-stage=done]"],
      ["Either", "[query::work-stage=blocked or work-stage=waiting]"], ["Not done", "[query::not work-stage=done]"],
      ["Owned", "[query::owner]"], ["Two stages", "[query::work-stage=a work-stage=b]"],
      ["Newest", "[sort::updated]"], ["First five", "[limit::5]"],
    ]) await create(hub.id, `${name} [type::virtual-branch] ${q}`);
    const mk = async (k: string, text: string) => { cards[k] = await create(null, text); };
    await mk("one", "Card one [work-stage::queued] [track::door]\nA simple card.");
    await mk("two", "Card two [work-stage::queued] [track::river]\nNeeds both values changed for Review.");
    await mk("three", "Card three [work-stage::queued]\nHas no track yet.");
    // Tokens the service doesn't count as this card's work-stage: an inline code span, a hashtag
    // (which is a property, so it shifts ordinals), prose-scoped tokens in the body, a fenced block.
    await mk("four", "Card four `[x::y]` #tagged [work-stage::queued]\nSee [work-stage::prose-mention] in the body.\n```\n[work-stage::in-fence]\n```");
    await mk("dup", "Card dup [work-stage::queued] [work-stage::doing]\nTwo stages.");
    await mk("stale", "Card stale [work-stage::queued]\nSomeone else edits this.");
    await mk("draft", "Card draft [work-stage::queued]\nOpen for editing.");
    await mk("drag", "Card drag [work-stage::queued]\nDragged with the mouse.");

    b = new DeliveryBoard(hub.id);
    const ctx = { board: sock, t: T, workspace: info.workspace, host: "test", flash: (m: string) => flashes.push(m), redraw() {}, pop() {}, cycleVideo() {}, suspend: (r: () => void) => r(), graphics: false };
    await b.enter(ctx as any);
    await until(() => B().lanes.length === 10 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  }, 30_000);

  afterAll(() => {
    sock?.close(); other?.close(); proc?.kill();
    delete process.env.EP0CH_STATE;
    if (root) rmSync(root, { recursive: true, force: true });
  });

  test("one clause: L/H patch work-stage, attributed to the door; the card lands in the lane, still selected", async () => {
    await select("Queued", cards.one.id);
    const qi = laneIndex("Queued"), di = laneIndex("Doing");
    ch(di < qi ? "H" : "L");                                           // Doing is the neighbour (stage order)
    await settled();
    expect(await props(cards.one.id)).toEqual(["work-stage=doing", "track=door"]);
    const now = await current(cards.one.id);
    expect(now.text).toBe("Card one [work-stage::doing] [track::door]\nA simple card.");
    expect(now.revision).toBe(cards.one.revision + 1);
    expect(selected()).toEqual({ lane: "Doing", id: cards.one.id });
    expect(laneIds("Queued")).not.toContain(cards.one.id);
    expect(flashes.at(-1)).toBe("moved to Doing · work-stage queued -> doing");
    const log = await other.request("activity.recent", { author: "user", limit: 20 });
    const entry = log.entries.find((e: any) => e.block.id === cards.one.id);
    expect(entry?.actorId).toBe(ACTOR_ID);
    expect(entry?.kind).toBe("properties");
  });

  test("several clauses: the picker patches only what differs, appending what's missing", async () => {
    await select("Queued", cards.two.id);
    ch("m");
    const M = B().mover;
    expect(M.plans[laneIndex("Review")]).toEqual({ kind: "patch", changes: [{ key: "work-stage", to: "review", from: "queued" }, { key: "track", to: "door", from: "river" }] });
    const to = laneIndex("Review");
    while (M.sel !== to) ch(M.sel < to ? "j" : "k");
    press({ kind: "enter" });
    await settled();
    expect(await props(cards.two.id)).toEqual(["work-stage=review", "track=door"]);
    expect(selected()).toEqual({ lane: "Review", id: cards.two.id });

    // Card one already has track=door: only work-stage changes (one token replaced, nothing appended).
    await select("Doing", cards.one.id);
    const before = (await current(cards.one.id)).text;
    pick("Review");
    await settled();
    expect((await current(cards.one.id)).text).toBe(before.replace("[work-stage::doing]", "[work-stage::review]"));
    expect(flashes.at(-1)).toBe("moved to Review · work-stage doing -> review");

    // Card three has no track: it is appended beside its metadata, where the service reads it as a property.
    await select("Queued", cards.three.id);
    pick("Review");
    await settled();
    expect(await props(cards.three.id)).toEqual(["work-stage=review", "track=door"]);
    expect(laneIds("Review")).toContain(cards.three.id);
    expect(flashes.at(-1)).toBe("moved to Review · work-stage queued -> review · track + door");
  });

  test("ordinals come from the service: code spans, hashtags, prose and fences are left alone", async () => {
    await select("Queued", cards.four.id);
    pick("Done");
    await settled();
    expect((await current(cards.four.id)).text).toBe("Card four `[x::y]` #tagged [work-stage::done]\nSee [work-stage::prose-mention] in the body.\n```\n[work-stage::in-fence]\n```");
    expect(await props(cards.four.id)).toEqual(["tag=tagged", "work-stage=done"]);
    expect(selected()).toEqual({ lane: "Done", id: cards.four.id });
  });

  test("lanes a patch can't satisfy are refused with the reason, and nothing is written", async () => {
    await select("Queued", cards.stale.id);
    const before = await current(cards.stale.id);
    const reasons: Record<string, string> = {};
    for (const name of ["Either", "Not done", "Owned", "Two stages", "Newest", "First five"]) {
      await select("Queued", cards.stale.id);
      pick(name);
      await settled();
      reasons[name] = flashes.at(-1)!;
      expect(selected()).toEqual({ lane: "Queued", id: cards.stale.id });
    }
    expect(reasons).toEqual({
      "Either": "can't move to Either: Either is invalid: Invalid virtual branch query: Boolean operator or is not supported",
      "Not done": "can't move to Not done: Not done is invalid: Invalid virtual branch query: Boolean operator not is not supported",
      "Owned": "can't move to Owned: Owned asks for any owner:: value; a move can't choose one",
      "Two stages": "can't move to Two stages: Two stages asks for work-stage to be a and b at once; a move sets one value",
      "Newest": "can't move to Newest: Newest is invalid: Virtual branch query cannot be empty",
      "First five": "can't move to First five: First five is invalid: Virtual branch query cannot be empty",
    });
    const after = await current(cards.stale.id);
    expect(after.revision).toBe(before.revision);
    expect(after.text).toBe(before.text);

    // A card carrying two work-stage values is in both lanes; the door won't guess which to change.
    await select("Queued", cards.dup.id);
    pick("Done");
    await settled();
    expect(flashes.at(-1)).toContain("the card has 2 work-stage:: values (queued, doing)");
    expect((await current(cards.dup.id)).revision).toBe(cards.dup.revision);
  });

  test("a stale card is refused: someone else changed it after the board loaded", async () => {
    await select("Queued", cards.stale.id);
    const shown = B().lanes[B().lane].items[B().lanes[B().lane].sel] as Msg;
    await other.request("update", { blockId: cards.stale.id, text: "Card stale [work-stage::queued]\nChanged by another writer.", expectedRevision: shown.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
    pick("Done");
    await settled();
    expect(flashes.at(-1)).toBe(`not moved: the card changed since the board loaded (revision ${shown.revision} -> ${shown.revision! + 1})`);
    expect((await current(cards.stale.id)).text).toBe("Card stale [work-stage::queued]\nChanged by another writer.");
    expect(selected()).toEqual({ lane: "Queued", id: cards.stale.id });

    // The service's own check, for a write that races past the door's: properties.patch at an old revision.
    const now = await current(cards.stale.id);
    const err = await sock.patchProperties(cards.stale.id, now.revision - 1, [{ op: "replace", ordinal: 0, value: "done" }]).catch(e => e);
    expect(err).toBeInstanceOf(EditConflict);
    expect((await current(cards.stale.id)).revision).toBe(now.revision);
  });

  test("a card open as a draft isn't moved under it; after the edit closes it moves", async () => {
    await select("Queued", cards.draft.id);
    press({ kind: "enter" });                                          // open it in a detail
    await Bun.sleep(100);
    ch("e");                                                           // edit there (the detail has focus)
    await until(() => B().details.some((d: any) => d.editing), "the draft");
    ch("x");                                                           // typed into the draft, not a board key
    expect(B().details.find((d: any) => d.editing).draft.dirty).toBe(true);
    // Keys and clicks can't reach the lanes while it's open; if focus got there anyway, the move still refuses.
    B().focus = "lanes"; B().lane = laneIndex("Queued");
    ch("m");
    expect(B().mover).toBeNull();
    ch("L"); ch("H");
    await settled();
    expect(flashes.at(-1)).toBe("not moved: it's open for editing with unsaved changes · save (ctrl+s) or close (esc) the edit first");
    expect((await current(cards.draft.id)).revision).toBe(cards.draft.revision);
    // Close the edit (esc twice discards), then the move goes through.
    B().focus = `detail${B().details.findIndex((d: any) => d.editing)}`;
    press({ kind: "esc" }); press({ kind: "esc" });
    expect(B().details.some((d: any) => d.editing)).toBe(false);
    await select("Queued", cards.draft.id);
    pick("Done");
    await settled();
    expect(await props(cards.draft.id)).toEqual(["work-stage=done"]);
  });

  test("dragging a card onto another lane moves it", async () => {
    await select("Queued", cards.drag.id);
    b.render(B().ctx);                                                  // lays out lane rectangles for the mouse
    const from = B().laneRects.find((r: any) => r.lane === laneIndex("Queued")).rect;
    const to = B().laneRects.find((r: any) => r.lane === laneIndex("Doing")).rect;
    const y = from.row + 1 + (B().lanes[laneIndex("Queued")].sel - B().lanes[laneIndex("Queued")].top) * 2;
    const mouse = (action: "down" | "drag" | "up", x: number, yy: number) => press({ kind: "mouse", action, button: 0, x, y: yy });
    mouse("down", from.col + 3, y);
    mouse("drag", to.col + 4, to.row + 3);
    expect(B().drag.over).toBe(laneIndex("Doing"));
    const frame = b.render(B().ctx).lines.join("\n");
    expect(frame.replace(/\x1b\[[\d;]*m/g, "")).toContain("release to move into Doing · work-stage queued -> doing");   // says what the drop will do
    mouse("up", to.col + 4, to.row + 3);
    await settled();
    expect(await props(cards.drag.id)).toEqual(["work-stage=doing"]);
    expect(selected()).toEqual({ lane: "Doing", id: cards.drag.id });
  });

  test("after the moves, every lane matches src/views.ts and the outliner's own evaluator", async () => {
    const { readSavedView } = await import(join(outliner!, "src/saved-view-read.ts"));
    const client = { request: ({ action, ...rest }: any) => sock.request(action, rest) };
    const defs = await sock.children(hub.id);
    let compared = 0;
    for (const def of defs) {
      const mine = await readView(sock, def);
      const theirs = await readSavedView(client, def.id);
      expect({ lane: def.id, status: mine.status }).toEqual({ lane: def.id, status: theirs.status });
      expect({ lane: def.id, ids: mine.items.map(m => m.id) }).toEqual({ lane: def.id, ids: theirs.blocks.map((x: any) => x.id) });
      compared++;
    }
    expect(compared).toBe(10);
    // And the board shows the same thing the evaluators do.
    await reload();
    for (const def of defs) expect(laneIds(def.text.split(" [")[0]!)).toEqual((await readView(sock, def)).items.map(m => m.id));
    expect(laneIds("Done")).toEqual(expect.arrayContaining([cards.four.id, cards.draft.id]));
    expect(laneIds("Review")).toEqual(expect.arrayContaining([cards.one.id, cards.two.id, cards.three.id]));
  });
});

// PIE-514: one action dispatcher per screen host, with the person-or-agent rule checked once at its door.
//
// - The table: every action in every set × the person or an agent × the person typing, at the keys or idle, against
//   what the action declares it touches. The rule is `actorRule`; the dispatcher asks it before anything runs.
// - The declarations the agent interface promises (docs/AGENT-INTERFACE.md, "Agent paths that could touch the
//   person's keys"), checked by name.
// - The dispatcher on a fake host: one tile= grammar (a name, an id, a number, an alias, focused, a block id), place
//   words, tile-valued arguments, expected=, which set owns a name, what an agent's run says.
// - Routing on real screens (#105, #106 were each fixed in one screen): tile.type and open on the desk, the board and
//   the river, through the App, every way a tile is named. Scratch services and fictional notes only.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import "../src/screens";
import { Desk } from "../src/desk/desk";
import { boardScreen } from "./board-view";
import * as BV from "./board-view";
import { ReaderPane } from "../src/desk/panes";
import { openScreen } from "../src/desk/screen-specs";
import { view as riverView } from "./river-view";
import { MainMenu } from "../src/screens";
import { SocketBoard, USER, type Actor } from "../src/socket";
import { ActionRefused, ActionSet, allActionSets, type ActionDef, type Touches } from "../src/surface/actions";
import { actorRule, Dispatcher, type TileRef } from "../src/surface/dispatch";
import { DraftSession, draftRule } from "../src/draft-session";
import { NOBODY, SHELL_IDLE_MS, type Whereabouts } from "../src/whereabouts";
import { outliner, Scratch, until } from "./scratch";

const AGENT: Actor = { kind: "agent", id: "table-agent-514" };
const TILE = "middle";

/** Where the person is, three ways: typing in the tile, at the keys (a key a moment ago), idle. */
const STATES: Record<"typing" | "at the keys" | "idle", Whereabouts> = {
  typing: { ...NOBODY, focus: TILE, typingIn: TILE, busy: true, why: "the person is typing in middle", idle: 0, screen: "desk" },
  "at the keys": { ...NOBODY, focus: TILE, typingIn: null, busy: false, idle: 100, screen: "desk" },
  idle: { ...NOBODY, focus: TILE, typingIn: null, busy: false, idle: SHELL_IDLE_MS * 10, screen: "desk" },
};

/**
 * What the declarations promise, written out apart from the rule: null (it runs), or what its refusal says. The
 * person is never refused by it; an agent by what the action touches of theirs.
 */
function promised(def: ActionDef<unknown, unknown>, actor: Actor, state: keyof typeof STATES): RegExp | string | null {
  if (actor.kind !== "agent") return null;
  if (def.person) return def.person;
  const t: Touches = def.touches;
  if (t === "nothing" || t === "shape") return null;
  // Replacing a tile's whole draft (an edit's, a comment's): never while the person types there; else the draft rule's (whose draft it is).
  if (t === "draft") return (def.draft === "replace" || def.draft === "text") && state === "typing" ? /the person is typing in middle; an agent doesn't replace their text/ : "the draft rule's answer";
  if (t === "tile") {
    if (state === "typing") return /the person is typing in middle/;
    return def.while === "typing" ? null : /middle has the person's keys/;
  }
  // screen: never while they type, never within the idle window.
  return state === "typing" ? /the person is typing in middle; not moved/ : state === "at the keys" ? /the person is at the keys/ : null;
}


/** A screen of two readers that keep their own notes, `middle` and `side` (the host's own tiles, given by name). */
const twoReaders = () => new Desk(
  { name: "test", title: "desk", layout: { root: { t: "split", dir: "row", ratio: 0.5, a: { t: "leaf", kind: "reader", name: "middle" }, b: { t: "leaf", kind: "reader", name: "side" } } } },
  { given: new Map([["middle", new ReaderPane()], ["side", new ReaderPane()]]) },
);
describe("the actor rule, for every action (PIE-514)", () => {
  const actions = () => allActionSets().flatMap(set => set.names().map(name => ({ set, name, def: set.def(name)! })));

  test("every action declares what it touches of the person's and whether a restarted door may run it again", () => {
    const all = actions();
    expect(all.length).toBeGreaterThan(180);
    const kinds: Touches[] = ["nothing", "tile", "shape", "draft", "screen"];
    for (const { set, name, def } of all) {
      expect({ action: `${set.scope}:${name}`, touches: kinds.includes(def.touches), replay: def.replay === "safe" || def.replay === "ask" }).toEqual({ action: `${set.scope}:${name}`, touches: true, replay: true });
      if (def.while) expect({ action: name, while: def.touches }).toEqual({ action: name, while: "tile" });
      if (def.draft) expect({ action: name, draft: def.touches }).toEqual({ action: name, draft: "draft" });
      // An action that writes to the outline or reaches outside the door isn't run again by itself after a restart.
      if (def.touches === "draft" && (def.draft === "write" || def.draft === "replace")) expect({ action: name, replay: def.replay }).toEqual({ action: name, replay: "ask" });
    }
  });

  test("the table: every action × the person or an agent × the person typing, at the keys, idle", () => {
    const rows: string[] = [];
    let checked = 0;
    for (const { set, name, def } of actions()) {
      for (const actor of [USER, AGENT]) {
        for (const state of Object.keys(STATES) as (keyof typeof STATES)[]) {
          const got = actorRule(def, actor, STATES[state], { tile: { name: TILE }, draft: () => "the draft rule's answer" });
          const want = promised(def, actor, state);
          checked++;
          const ok = want === null ? got === null : typeof want === "string" ? got === want : !!got && want.test(got);
          if (!ok) rows.push(`${set.scope}:${name} · ${actor.kind} · ${state}: wanted ${want === null ? "it to run" : String(want)}, got ${got ?? "it runs"}`);
        }
      }
    }
    expect(rows).toEqual([]);
    expect(checked).toBeGreaterThan(1000);
  });

  test("an action in a tile the person isn't in runs for an agent, whatever it touches there", () => {
    for (const { name, def } of actions()) {
      if (def.touches !== "tile" || def.person) continue;
      expect({ name, refused: actorRule(def, AGENT, STATES.typing, { tile: { name: "side" } }) }).toEqual({ name, refused: null });
    }
  });

  test("the declarations the agent interface promises", () => {
    const of = (name: string) => {
      const set = allActionSets().find(s => s.has(name));
      if (!set) throw new Error(`no action ${name}`);
      return set.def(name)!;
    };
    const touches = (names: string[], t: Touches) => { for (const n of names) expect({ n, t: of(n).touches }).toEqual({ n, t }); };
    // Moving the person's keys or screen: never while they type, never within the idle window.
    touches(["tile.focus", "marks.next", "layout.load", "screen.open", "screen.back", "screen.help", "menu.select", "list.select", "list.open", "host.toggle", "brief.step", "welcome.select", "waiting.pick", "message.next"], "screen");
    // The layout's shape: the layout engine decides each operation.
    touches(["layout.move", "tile.open", "tile.close", "tile.float", "tile.dock", "tile.collapse", "tab.select", "tile.zoom", "layout.lock", "layout.policy", "pane.split"], "shape");
    // In a tile: refused in the person's (typing in it, for these).
    for (const n of ["tile.type", "view.scrollTo", "agent.type", "host.size", "agent.restart"]) expect({ n, t: of(n).touches, w: of(n).while }).toEqual({ n, t: "tile", w: "typing" });
    for (const n of ["tile.restart", "tile.herdr"]) expect({ n, t: of(n).touches, w: of(n).while }).toEqual({ n, t: "tile", w: "typing" });
    // Round 3: what moves the reader the person reads is refused there (back and forward were already).
    touches(["link.follow", "element.open", "up", "props.follow", "threads", "resolve", "back", "forward", "column.select"], "tile");
    // Opening something outside the door, or keeping a choice for the next start: a restarted door asks first.
    for (const n of ["link.follow", "props.follow", "element.open", "tree.pick", "theme.set", "theme.cycle"]) expect({ n, replay: of(n).replay }).toEqual({ n, replay: "ask" });
    // By its arguments: column.select id= is the person's cursor too; the desk's open moves the reader it names; clearing tile.herdr is anyone's.
    expect(of("column.select").touchesWith).toBeUndefined();
    const open = allActionSets().find(s => s.scope === "desk")!.def("open")!;
    expect([open.touchesWith!({}, "side"), open.touchesWith!({}, undefined)]).toEqual(["tile", "nothing"]);
    expect([of("tile.herdr").touchesWith!({ on: false }), of("tile.herdr").touchesWith!({ pane: "door-claude" })]).toEqual(["nothing", "tile"]);
    // Pointing at something, writing what the service attributes: no actor rule.
    touches(["block.mark", "block.unmark", "block.tint", "projection.refresh", "tree.links", "tree.pick", "search", "who.refresh"], "nothing");
    // The person's own: refused to any agent, with its way said.
    for (const n of ["screen.shell", "changes.extensions", "host.enter", "host.leave", "tile.enter", "tile.leave", "element.select", "select.mode", "callouts", "fold.select", "thread.toggle", "task.menu", "keys.more", "section.try", "composer.leave", "composer.close"]) {
      expect({ n, person: !!of(n).person }).toEqual({ n, person: true });
    }
    // The person's draft: the draft session's rule.
    for (const [n, use] of [["edit.save", "leave"], ["edit.close", "leave"], ["session.leave", "leave"], ["comment.send", "leave"], ["edit.text", "replace"], ["props.edit", "write"], ["task.status", "write"], ["draft.newline", "type"], ["comment.write", "text"], ["complete", "type"]] as const) {
      expect({ n, t: of(n).touches, use: of(n).draft }).toEqual({ n, t: "draft", use });
    }
    // A lookup reads; complete insert= types at the cursor (round 3, deferred).
    expect([of("complete").touchesWith!({}), of("complete").touchesWith!({ text: "[[HOME" }), of("complete").touchesWith!({ insert: 1 })]).toEqual(["nothing", "nothing", "draft"]);
    // Only these take an invitation (and spend it): anywhere else invitation= opens nothing.
    expect(allActionSets().flatMap(s => s.names().filter(n => s.argsOf(n)?.invitation)).sort()).toEqual(["comment.write", "complete"]);
  });
});

describe("the draft rule, for the person's draft and an agent's (round 3, deferred: comment.write, complete insert=)", () => {
  /** A comment being written (no block of its own), and an edit of a block: opened by whom, typed in by whom. */
  const comment = (by: Actor) => DraftSession.open({ place: `comment:${by.kind}`, back: "C brings it back", label: "c", what: "the comment on “Sow the leeks”", verb: "send", leaveWrites: false, submit: async () => ({ ok: true }) }, { by });
  const edit = (by: Actor, blockId: string) => DraftSession.open({ place: `edit:${blockId}`, back: "e brings it back", label: "e", what: "the edit to “Sow the leeks”", verb: "save", blockId, leaveWrites: true, submit: async () => ({ ok: true }) }, { by, text: "Sow the leeks" });
  const PERSONS = /^the person is writing the comment on “Sow the leeks” here; an agent doesn't replace their text/;
  const TYPE = /^this draft is the person's; an agent doesn't type in it/;

  test("each use × whose draft: the person's is theirs, an agent's own is its own, an invitation is the one way in", () => {
    const sessions: DraftSession[] = [];
    const s = <T extends DraftSession>(x: T) => { sessions.push(x); return x; };
    // Open with no connection: the person's edit of …0b is in the same (loose) registry the rule asks.
    const theirs = s(comment(USER)), ours = s(comment(AGENT)), their = s(edit(USER, "aaaaaaaa-0000-4000-8000-00000000000a"));
    s(edit(USER, "aaaaaaaa-0000-4000-8000-00000000000b"));
    const invited = s(comment(USER));
    invited.draft.replace("Leeks in March?\n@table-agent-514", USER);
    const inv = invited.invite("table-agent-514")!;
    const rows: [string, Parameters<typeof draftRule>, RegExp | null][] = [
      // comment.write (`text`): the person's comment is refused; the agent's own is its own; a note open in an edit elsewhere doesn't stop a comment.
      ["comment.write in the person's comment", [AGENT, "text", { session: theirs }], PERSONS],
      ["comment.write in the agent's own comment", [AGENT, "text", { session: ours }], null],
      ["comment.write while the note is open in an edit elsewhere", [AGENT, "text", { blockId: "aaaaaaaa-0000-4000-8000-00000000000b", session: ours }], null],
      ["comment.write invited", [AGENT, "text", { session: invited }, { invitation: inv.id }], null],
      ["comment.write with another's invitation", [AGENT, "text", { session: theirs }, { invitation: inv.id }], /no open invitation/],
      ["comment.write invited, with nothing written", [AGENT, "text", { session: null }, { invitation: inv.id }], /nothing is being written here to be invited into/],
      // complete insert= (`type`): only a draft the agent opened and alone typed in, or one it's invited into.
      ["complete insert= in the person's comment", [AGENT, "type", { session: theirs }], TYPE],
      ["complete insert= in the person's edit", [AGENT, "type", { session: their }], TYPE],
      ["complete insert= in the agent's own", [AGENT, "type", { session: ours }], null],
      ["complete insert= invited", [AGENT, "type", { session: invited }, { invitation: inv.id }], null],
      // edit.text (`replace`) as it was: the person's edit refused, and a note they edit elsewhere.
      ["edit.text in the person's edit", [AGENT, "replace", { session: their }], /^the person has this note open in an edit here/],
      ["edit.text under the person's edit elsewhere", [AGENT, "replace", { blockId: "aaaaaaaa-0000-4000-8000-00000000000b" }], /^the person has “Sow the leeks” open in a draft/],
      // The person is never refused.
      ["the person's own, every use", [USER, "text", { session: ours }], null],
    ];
    const bad = rows.flatMap(([what, args, want]) => {
      const got = draftRule(...args);
      return (want === null ? got === null : !!got && want.test(got)) ? [] : [`${what}: wanted ${want ?? "it to run"}, got ${got ?? "it runs"}`];
    });
    expect(bad).toEqual([]);
    for (const x of sessions) x.dispose();
  });

  test("invited, the actor rule lets the draft rule decide even while the person types; uninvited it refuses first", () => {
    const def = { touches: "draft" as const, draft: "text" as const };
    expect(actorRule(def, AGENT, STATES.typing, { tile: { name: TILE }, draft: () => null })).toMatch(/^the person is typing in middle; an agent doesn't replace their text · block.mark gets their attention/);
    expect(actorRule(def, AGENT, STATES.typing, { tile: { name: TILE }, invited: true, draft: () => null })).toBeNull();
    expect(actorRule(def, AGENT, STATES.typing, { tile: { name: TILE }, invited: true, draft: () => "no open invitation" })).toBe("no open invitation");
  });
});

// ── the dispatcher on a fake screen ─────────────────────────────────────────────

/** A screen with three tiles, a revision, and a log of what ran where. */
function fakeScreen(person: Partial<Whereabouts> = {}) {
  const ran: { name: string; tile?: string; place?: string; actor: string }[] = [];
  const flashes: string[] = [];
  let rev = 7;
  const tiles: TileRef[] = [
    { name: "tree", id: "t1", n: 1, kind: "tree" },
    { name: "middle", id: "t2", n: 2, kind: "reader", shows: "aaaaaaaa-1111-4000-8000-000000000001", aliases: ["detail"] },
    { name: "side", id: "t3", n: 3, kind: "reader", shows: "bbbbbbbb-2222-4000-8000-000000000002", editing: true, holds: a => a.kind === "agent" && a.id === (AGENT as { id: string }).id },
  ];
  type On = { tile?: string; place?: string };
  const def = (touches: Touches, extra: Partial<ActionDef<any, On>> = {}): ActionDef<{ to?: string }, On> => (<ActionDef<{ to?: string }, On>>{
    summary: touches, touches, replay: "safe", args: { to: { type: "string", optional: true, tile: true, about: "a tile" } },
    run(args, on, actor) { ran.push({ name: `${touches}${args.to ? `→${args.to}` : ""}`, ...(on.tile ? { tile: on.tile } : {}), ...(on.place ? { place: on.place } : {}), actor: actor.kind }); return { ok: true }; },
    ...extra,
  });
  const screenSet = new ActionSet<Record<string, { to?: string }>, On>("fake-screen", {
    "go.nothing": def("nothing", { says: () => "went nowhere", places: ["new"] }),
    "go.shape": def("shape", { says: () => "moved it", confirms: true }),
    "go.screen": def("screen"),
  });
  const tileSet = new ActionSet<Record<string, { to?: string }>, On>("fake-tile", {
    "go.tile": def("tile", { way: "an agent does it elsewhere" }),
    "go.typing": def("tile", { while: "typing" }),
    "go.draft": def("draft", { draft: "type" }),
    "go.mine": def("nothing", { person: "that's the person's" }),
  });
  const where: Whereabouts = { ...NOBODY, focus: "middle", screen: "fake", ...person };
  const d = new Dispatcher({
    title: "fake", ctx: () => ({ flash: (m: string) => flashes.push(m), redraw() {}, person: () => where }),
    tiles: () => tiles,
    revision: x => (Number(x) === rev ? null : `the layout changed since revision ${x}; it's ${rev} now`),
    draftOf: t => (t.editing ? { board: null, blockId: t.shows ?? null, session: null } : null),
  }, [
    { set: screenSet, takes: "screen", on: at => ({ tile: at.name, place: at.place }) },
    { set: tileSet, takes: "tile", in: t => t.kind === "reader", noun: "a reader", pick: "first", on: at => ({ tile: at.tile?.name }) },
  ]);
  return { d, ran, flashes, where, tiles, tileSet, bump: () => { rev++; } };
}

describe("the dispatcher, on a fake screen", () => {
  test("tile= is one grammar: a name, an id, a number, an alias, focused, a block id; an answer names the tile", async () => {
    const { d, ran } = fakeScreen();
    for (const sel of ["side", "t3", "3", "#3", "bbbbbbbb", "bbbbbbbb-2222-4000-8000-000000000002"]) await d.act({ action: "go.nothing", tile: sel }, USER);
    expect(ran.map(r => r.tile)).toEqual(["side", "side", "side", "side", "side", "side"]);
    ran.length = 0;
    await d.act({ action: "go.nothing", tile: "detail" }, USER);                 // an alias: a place, like a number
    await d.act({ action: "go.nothing", tile: "focused" }, USER);
    await d.act({ action: "go.nothing" }, USER);                                     // none named: the action's own default
    expect(ran.map(r => r.tile)).toEqual(["middle", "middle", undefined]);
    await expect(d.act({ action: "go.nothing", tile: "nope" }, USER)).rejects.toThrow("no tile nope on the fake; tiles: #1 tree (t1), #2 middle (t2), #3 side (t3), focused, or a block id");
    // A place word the action takes instead of a tile (the board's new-detail), passed as it is.
    await d.act({ action: "go.nothing", tile: "new" }, USER);
    expect(ran.at(-1)).toMatchObject({ place: "new" });
    // An argument that names a tile is read the same way.
    await d.act({ action: "go.nothing", args: { to: "#1" } }, USER);
    expect(ran.at(-1)!.name).toBe("nothing→tree");
    await expect(d.act({ action: "go.nothing", args: { to: "t9" } }, USER)).rejects.toThrow("no tile t9 here");
  });

  test("an action in one kind of tile: the focused one, else the first; another kind is refused saying what it is", async () => {
    const { d, ran } = fakeScreen();
    await d.act({ action: "go.tile", tile: "side" }, USER);
    await d.act({ action: "go.tile" }, USER);
    expect(ran.map(r => r.tile)).toEqual(["side", "middle"]);
    await expect(d.act({ action: "go.tile", tile: "tree" }, USER)).rejects.toThrow("tree is an outline tile: go.tile is for a reader; here: middle, side");
    await expect(d.act({ action: "go.tile", tile: "cccccccc" }, USER)).rejects.toThrow("no reader shows cccccccc");
  });

  test("a block id prefers the tile holding the agent's own edit, then one on screen editing it, then showing it", async () => {
    const { d, ran } = fakeScreen();
    await d.act({ action: "go.tile", tile: "bbbbbbbb" }, AGENT);
    expect(ran.at(-1)!.tile).toBe("side");
    // Named by place while its own edit is elsewhere: refused, told the tile's id.
    await expect(d.act({ action: "go.draft", tile: "2" }, AGENT)).rejects.toThrow("2 isn't where your edit or comment is: that's tile t3 (side now)");
  });

  test("a tile that's a read-only view now (a peek, a spine) refuses an agent's note action, never the person's own key", async () => {
    const { ran, tiles, tileSet } = fakeScreen();
    const seen = new Dispatcher({ title: "fake", ctx: () => ({ flash() {}, redraw() {}, person: () => ({ ...NOBODY, focus: "middle" }) }), tiles: () => tiles.map(t => (t.name === "middle" ? { ...t, readOnly: "middle is a peek" } : t)) },
      [{ set: tileSet, takes: "tile", seen: true, in: t => t.kind === "reader", on: at => ({ tile: at.tile?.name }) }]);
    await expect(seen.act({ action: "go.typing", tile: "middle" }, AGENT)).rejects.toThrow("middle is a peek");
    await seen.pressIn(tileSet, "go.typing", {}, "middle");
    expect(ran.at(-1)).toMatchObject({ tile: "middle", actor: "user" });
  });

  test("expected= is checked against the layout's revision before anything runs", async () => {
    const { d, ran, bump } = fakeScreen();
    await d.act({ action: "go.shape", args: { expected: 7 } }, USER);
    bump();
    await expect(d.act({ action: "go.shape", args: { expected: 7 } }, AGENT)).rejects.toThrow("the layout changed since revision 7");
    expect(ran).toHaveLength(1);
  });

  test("the actor rule runs once, before the action: an agent refused with the reason, nothing run; the person never", async () => {
    const typing = fakeScreen({ typingIn: "middle", busy: true, why: "the person is typing in middle", idle: 0 });
    await expect(typing.d.act({ action: "go.tile" }, AGENT)).rejects.toThrow("the person is typing in middle; an agent does it elsewhere");
    await expect(typing.d.act({ action: "go.typing", tile: "middle" }, AGENT)).rejects.toThrow("the person is typing in middle");
    await expect(typing.d.act({ action: "go.screen" }, AGENT)).rejects.toThrow("the person is typing in middle; not moved");
    await expect(typing.d.act({ action: "go.mine" }, AGENT)).rejects.toThrow("that's the person's");
    expect(typing.ran).toEqual([]);
    for (const a of ["go.tile", "go.typing", "go.screen", "go.mine", "go.shape", "go.nothing"]) await typing.d.act({ action: a }, USER);
    expect(typing.ran.map(r => r.actor)).toEqual(["user", "user", "user", "user", "user", "user"]);
    // Elsewhere than the person's tile, an agent's runs while they type.
    await typing.d.act({ action: "go.tile", tile: "side" }, AGENT);
    expect(typing.ran.at(-1)).toMatchObject({ tile: "side", actor: "agent" });
  });

  test("a key is the same action: a refusal is said, never thrown; what an agent did is said after it", async () => {
    const { d, ran, flashes } = fakeScreen({ idle: 0 });
    expect(await d.press("go.mine")).toEqual({ ok: true });                         // the person's own runs
    expect(await d.press("go.tile", {}, "tree")).toBeUndefined();                    // a refusal: said, not thrown
    expect(flashes.at(-1)).toBe("tree is an outline tile: go.tile is for a reader; here: middle, side");
    await d.act({ action: "go.nothing" }, AGENT);
    expect(flashes.at(-1)).toBe("an agent (table-agent-514) went nowhere");
    await d.press("go.shape");                                                       // a confirmation the screen doesn't show
    expect(flashes.at(-1)).toBe("moved it");
    await d.press("go.nothing");                                                     // the person sees their own
    expect(flashes.at(-1)).toBe("moved it");
    expect(ran.map(r => r.actor)).toEqual(["user", "agent", "user", "user"]);
  });

  test("which set owns a name: the order sets were registered in, a screen's own first", async () => {
    const first = new ActionSet<{ "go.nothing": object }, null>("first", { "go.nothing": { summary: "", touches: "nothing", replay: "safe", args: {}, run: () => "first" } });
    const { d } = fakeScreen();
    d.register([{ set: first as unknown as ActionSet<any, any>, takes: "none", on: () => null }], true);
    expect(await d.act({ action: "go.nothing" }, USER)).toBe("first");
    expect(d.list().actions.filter(a => a.name === "go.nothing")).toHaveLength(1);
    await expect(d.act({ action: "go.nowhere" }, USER)).rejects.toThrow(ActionRefused);
  });
});

// ── routing on real screens (#105, #106: each fixed in one screen once) ───────────

describe.skipIf(!outliner)("routing on the desk, the board and the river: tile.type and open, every way a tile is named", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  const AS = "router-514";
  const act = (action: string, args: Record<string, unknown> = {}, reader?: string) => app.act({ action, args, ...(reader !== undefined ? { tile: reader } : {}), as: AS }) as Promise<any>;
  const notes: Record<string, any> = {};

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
    const hub = await create(null, "Router board");
    await create(hub.id, "Queued [type::virtual-branch] [query::stage=queued]");
    await create(hub.id, "Doing [type::virtual-branch] [query::stage=doing]");
    notes.beans = await create(null, "Stake the beans [stage::queued]\nCanes along the fence.");
    notes.peas = await create(null, "Sow the peas [stage::doing]\nTwo rows.");
    notes.hub = hub;
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
  }, 30_000);
  afterAll(async () => {
    for (const s of [...(app as any).stack]) s.dispose?.();
    board?.close();
    await scratch.dispose();
    delete process.env.EP0CH_STATE;
  });

  test("the desk: tile.type by name, id, number and focused reaches the terminal; a reader is refused, saying what it is", async () => {
    const desk = twoReaders();
    app.push(desk);
    const D = desk as any;
    const t = await act("tile.open", { kind: "pty", name: "shell", cmd: "sh" }, "side");
    await until(() => D.layoutGet().tiles.find((x: any) => x.name === "shell")?.terminal?.running, "the shell running");
    const n = String(D.layoutGet().tiles.findIndex((x: any) => x.name === "shell") + 1);
    for (const sel of ["shell", t.id, n, `#${n}`]) expect(await act("tile.type", { text: "true\\n" }, sel)).toMatchObject({ tile: "shell" });
    // The terminal is the only one: none named reaches it; named by a reader's name, refused in the kind's words.
    expect(await act("tile.type", { text: "true\\n" })).toMatchObject({ tile: "shell" });
    await expect(act("tile.type", { text: "x" }, "middle")).rejects.toThrow("middle is a reader tile: tile.type is for a terminal tile; here: shell");
    // The person typing in it: an agent's is refused there (the actor rule), said on the status bar.
    D.focus = D.idNamed("shell"); D.ptyIn = D.panes.get(D.focus);
    await expect(act("tile.type", { text: "x" }, "shell")).rejects.toThrow("the person is typing in shell");
    expect((app as any).message).toContain("tile.type refused");
    D.ptyIn = null; D.focus = D.idNamed("middle");
    // open: by name, id, number, a block id it shows; the person's focus never moves for an agent's.
    const focus = D.focus;
    expect(await act("open", { id: notes.beans.id }, "side")).toMatchObject({ reader: "side", id: notes.beans.id });
    expect(await act("open", { id: notes.peas.id }, D.layoutGet().tiles.find((x: any) => x.name === "side").id)).toMatchObject({ reader: "side" });
    expect(await act("open", { id: notes.beans.id }, "2")).toMatchObject({ reader: "side" });
    // A block id names the tile showing it (a detail keeps its note).
    await act("tile.open", { kind: "detail", name: "keep", note: notes.peas.id }, "side");
    await until(() => D.layoutGet().tiles.find((x: any) => x.name === "keep")?.showing?.id === notes.peas.id, "the kept note");
    expect(await act("open", { id: notes.beans.id }, notes.peas.id.slice(0, 8))).toMatchObject({ reader: "keep" });
    await expect(act("open", { id: notes.peas.id }, "shell")).rejects.toThrow("shell is a terminal tile, not a reader");
    expect(D.focus).toBe(focus);
    // A whole screen in a tile (the river) is reached by its tile's name, id and number. (Its columns' own actions,
    // column.*, are the inner screen's tiles' kind's: the desk's kind check refuses them on the outer tile.)
    const q = await act("tile.open", { kind: "river", name: "quay" }, "side");
    const qn = String(D.layoutGet().tiles.findIndex((x: any) => x.name === "quay") + 1);
    for (const sel of ["quay", q.id, qn, `#${qn}`]) expect(await act("tile.info", {}, sel)).toMatchObject({ name: "quay", kind: "river" });
    await act("tile.close", {}, "quay");
    // Its program ended (an agent doesn't end one by closing it): left running, leaving would carry it into the drawer.
    await act("tile.type", { text: "exit\\n" }, "shell");
    await until(() => !D.layoutGet().tiles.find((x: any) => x.name === "shell")?.terminal?.running, "the shell ended");
    app.pop();
  }, 30_000);

  test("the board: open by its words (detail, new-detail, float, preview), a reader's name or a block id; tile.type the same as the desk", async () => {
    const b = boardScreen(notes.hub.id, false), B: any = BV.view(b);
    app.push(b);
    await until(() => B.lanes.length === 2 && B.lanes.every((l: any) => l.items), "the lanes", 10_000);
    const where = () => BV.where(b);
    const was = where();
    expect(await act("open", { id: notes.beans.id }, "detail")).toMatchObject({ reader: "detail1", id: notes.beans.id });
    expect(await act("open", { id: notes.peas.id }, "new-detail")).toMatchObject({ reader: "detail2", id: notes.peas.id });
    expect(await act("open", { id: notes.beans.id }, "detail1")).toMatchObject({ reader: "detail1" });
    // A block id names the reader showing it: on screen first, the one with the person's keys first among equals
    // (the lanes have them, so the preview following them does). That reader is theirs: an agent's open there is
    // refused (round 3, C3), by its name or by the block it shows.
    await expect(act("open", { id: notes.peas.id }, notes.peas.id)).rejects.toThrow(/preview has the person's keys; opening a note there would move what they're reading/);
    await expect(act("open", { id: notes.peas.id }, "preview")).rejects.toThrow(/preview has the person's keys/);
    const fl = await act("open", { id: notes.beans.id }, "float");
    expect(fl.reader).toMatch(/^detail\d+$/);
    expect(where()).toBe(was);                                                        // an agent's open never moves the keys
    // No terminal on the board yet: tile.type says so; one opened is reached by name, number and id.
    await expect(act("tile.type", { text: "x" })).rejects.toThrow("no terminal tile on the board");
    const t = await act("tile.open", { kind: "pty", name: "shell", cmd: "sh", where: "edge-right" });
    await until(() => B.layoutGet().tiles.find((x: any) => x.name === "shell")?.terminal?.running, "the board's shell");
    for (const sel of ["shell", t.id]) expect(await act("tile.type", { text: "true\\n" }, sel)).toMatchObject({ tile: "shell" });
    await expect(act("tile.type", { text: "x" }, "preview")).rejects.toThrow("preview is a preview tile: tile.type is for a terminal tile; here: shell");
    await act("tile.type", { text: "exit\\n" }, "shell");
    await until(() => !B.layoutGet().tiles.find((x: any) => x.name === "shell")?.terminal?.running, "the board's shell ended");
    app.pop();
  }, 30_000);

  test("the river: open beside a column by its name or id, or a block id; tile.type isn't the river's", async () => {
    const r = openScreen("river") as Desk, V = () => riverView(r);
    app.push(r);
    await until(() => (V().column(1)?.items?.length ?? 0) > 0, "the Library");
    const lib = V().name(V().column(1));
    const a = await act("open", { id: notes.beans.id, from: lib });
    expect(a).toMatchObject({ id: notes.beans.id });
    expect(V().columns.map(c => V().name(c))).toEqual([lib, a.reader]);
    const b = await act("open", { id: notes.peas.id, from: a.reader });
    expect(V().columns.map(c => V().name(c))).toEqual([lib, a.reader, b.reader]);
    await act("tile.hold", { on: true }, b.reader);                                    // held: resists compression; its note actions run
    expect(await act("open", { id: notes.beans.id, from: lib })).toMatchObject({ reader: a.reader });   // its own column, found
    // A note action by the block a column shows, by its name and by its stable id.
    expect(await act("folds", {}, notes.peas.id)).toMatchObject({ reader: b.reader });
    expect(await act("folds", {}, b.reader)).toMatchObject({ reader: b.reader });
    const id = (r.layoutGet() as any).tiles.find((x: any) => x.name === b.reader).id;
    expect(await act("folds", {}, id)).toMatchObject({ reader: b.reader });
    const focus = V().focused;
    const sp = await act("column.split", {}, lib);                                          // the Library's selected card, stacked
    expect(V().stack(1).map(c => V().name(c))).toEqual([lib, sp.tile]);
    expect(V().focused).toBe(focus);                                                   // an agent's never moves the keys
    await expect(act("tile.type", { text: "x" })).rejects.toThrow(/no terminal tile/);
    await expect(act("open", { id: notes.beans.id }, "nope")).rejects.toThrow("no tile nope");
    app.pop();
  }, 30_000);

  /**
   * Every action a screen lists, run by an agent with no arguments on the tile the person has their keys in: whatever
   * it answers (most refuse for a missing argument, some for the actor rule), the person's keys stay where they were.
   * Screen moves (`touches: "screen"`) wait for the person, who has just pressed a key here; the person's own are refused.
   */
  async function sweep(screen: string) {
    const before = app.person();
    (app as any).lastInput = Date.now();
    const skip = new Set(["screen.shell", "screen.back", "screen.open", "tile.restart", "agent.restart", "layout.load", "layout.load"]);
    for (const a of app.actions().actions) {
      if (skip.has(a.name) || a.name.startsWith("ext.")) continue;
      const out = await Promise.race([act(a.name, {}, before.focus ?? undefined).then(() => "ran", (e: Error) => `refused: ${e.message}`), Bun.sleep(1500).then(() => "waiting")]);
      if (a.person) expect(out, `${screen} ${a.name}`).toStartWith("refused");
      if (a.touches === "screen" && !a.varies) expect(out, `${screen} ${a.name}`).not.toBe("ran");
      const now = app.person();
      expect({ action: a.name, screen: now.screen, focus: now.focus, typingIn: now.typingIn }).toEqual({ action: a.name, screen: before.screen, focus: before.focus, typingIn: before.typingIn });
    }
  }
  test("every action an agent runs on the desk, the board and the river leaves the person's keys where they are", async () => {
    const desk = twoReaders();
    app.push(desk);
    await desk.dispatch.act({ action: "tile.focus", tile: "side" }, USER);
    await act("open", { id: notes.beans.id }, "middle");
    await desk.dispatch.act({ action: "tile.focus", tile: "middle" }, USER);
    await sweep("desk");
    app.pop();
    const b = boardScreen(notes.hub.id, false), B: any = BV.view(b);
    app.push(b);
    await until(() => B.lanes.length === 2 && B.lanes.every((l: any) => l.items), "the lanes", 10_000);
    await sweep("board");
    app.pop();
    const r = openScreen("river") as Desk;
    app.push(r);
    await until(() => (riverView(r).column(1)?.items?.length ?? 0) > 0, "the Library");
    await sweep("river");
    app.pop();
  }, 120_000);
});

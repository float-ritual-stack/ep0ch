// PIE-639: what an agent may do to each tile (free, edit, off), a screen default and exceptions. The layout module
// refuses an agent's navigating, moving, closing or retargeting of a limited tile and names the policy and the
// person's command; the person's own operations are never limited. Plain states, no App, no Scratch. Fictional tiles.
import { describe, expect, test } from "bun:test";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import { actorRule } from "../src/surface/dispatch";
import { NOBODY } from "../src/whereabouts";
import {
  agentLevel, apply, init, leaf, policyOf, refusal, splitOf, serialize,
  type Ctx, type LayoutState, type LNode, type Op, type TileFacts,
} from "../src/desk/screen-layout";

const AREA: Rect = { col: 0, row: 0, cols: 160, rows: 46 };
const PERSON: Actor = { kind: "user" };
const AGENT: Actor = { kind: "agent", id: "seed-agent-639" };
const NAMES = new Map([[1, "tree"], [2, "reader"], [3, "detail"], [4, "notes"]]);
const tree = (): LNode => splitOf("row", [leaf(1), leaf(2), leaf(3), leaf(4)], [1, 1, 1, 1]);
const facts = (id: number): TileFacts => ({ kind: id === 1 ? "tree" : "reader", notes: id !== 1 });
const ctx = (actor: Actor): Ctx => ({ actor, area: AREA, tile: facts, person: { focus: 2, typingIn: null, busy: false }, kinds: { all: ["reader", "tree"], notes: ["reader"] } });
const run = (s: LayoutState, op: Op, actor: Actor = PERSON) => { const r = apply(s, op, ctx(actor)); if (!r.ok) throw new Error(`refused: ${r.refused}`); return r.state; };
const no = (s: LayoutState, op: Op, re: RegExp, actor: Actor = AGENT) => { const r = refusal(s, op, ctx(actor)); expect(r).toMatch(re); };
const fresh = (agents: [number, "free" | "edit" | "off"][] = [], policy = {}) => init({ tree: tree(), names: NAMES, agents: new Map(agents), policy: policyOf(policy) });
const level = (s: LayoutState, id: number) => agentLevel(s, id, facts(id));

describe("a tile's level and the screen's default", () => {
  test("free by default; a tile's own wins over the screen's default, which wins over nothing", () => {
    expect(level(fresh(), 3)).toEqual({ level: "free", by: "screen" });
    const s = fresh([[3, "free"]], { agents: "edit" });
    expect(level(s, 2)).toEqual({ level: "edit", by: "screen" });
    expect(level(s, 3)).toEqual({ level: "free", by: "tile" });
    // "yolo the screen, except this one thing": the screen free, one tile edit.
    expect(level(fresh([[3, "edit"]]), 3)).toEqual({ level: "edit", by: "tile" });
    expect(level(fresh([[3, "edit"]]), 2).level).toBe("free");
  });
  test("a container's default sits between the screen's and the tile's own", () => {
    const t = splitOf("row", [leaf(1), splitOf("col", [leaf(2), leaf(3)], [1, 1])], [1, 1]);
    (t as any).kids[1].policy = { agents: "off" };
    const s = init({ tree: t, names: NAMES, policy: { agents: "edit" } });
    expect(level(s, 1).level).toBe("edit");
    expect(level(s, 3).level).toBe("off");
  });
  test("a stray value in a save is dropped", () => {
    expect(policyOf({ agents: "yolo" })).toEqual({});
    expect(policyOf({ agents: "edit" })).toEqual({ agents: "edit" });
  });
});

describe("the layout refuses an agent, never the person", () => {
  const s = fresh([[3, "edit"], [4, "off"]]);
  test("edit: no closing, moving, swapping, floating, folding, zooming or retargeting; the refusal names the policy and the command", () => {
    no(s, { op: "close", tile: 3 }, /detail is edit only for agents: closing it is refused .*\^W g.*tile\.agent policy=free tile=detail/);
    no(s, { op: "move", tile: 3, to: { kind: "edge", dir: "left" } }, /moving it is refused/);
    no(s, { op: "move", tile: 2, to: { kind: "tabs", target: 3 } }, /putting another tile in its tabs is refused/);
    no(s, { op: "swap", tile: 2, with: 3 }, /swapping it is refused/);
    no(s, { op: "float", tile: 3 }, /floating it is refused/);
    no(s, { op: "collapse", tile: 3 }, /folding it is refused/);
    no(s, { op: "zoom", tile: 3 }, /zooming it is refused/);
    no(s, { op: "link", tile: 2, to: 3 }, /linking opens into it is refused/);
    no(s, { op: "link", tile: 3, to: 2 }, /changing where its opens land is refused/);
    no(s, { op: "open", tile: 9, kind: "reader", at: { kind: "tabs", target: 3 } }, /opening a tile into its tabs is refused/);
  });
  test("off: the same, and says peek reads it", () => {
    no(s, { op: "close", tile: 4 }, /notes is hands off for agents: closing it is refused · peek reads it/);
  });
  test("the person's own operations are never limited", () => {
    expect(refusal(s, { op: "close", tile: 4 }, ctx(PERSON))).toBeNull();
    expect(refusal(s, { op: "move", tile: 3, to: { kind: "edge", dir: "left" } }, ctx(PERSON))).toBeNull();
  });
  test("a free tile is unaffected, and an agent splitting beside a limited tile is its own business", () => {
    expect(refusal(s, { op: "close", tile: 1 }, ctx(AGENT))).toBeNull();
    expect(refusal(s, { op: "open", tile: 9, kind: "reader", at: { kind: "split", target: 3, dir: "right" } }, ctx(AGENT))).toBeNull();
  });
  test("a default from the screen is named as the screen's", () => {
    no(fresh([], { agents: "edit" }), { op: "close", tile: 1 }, /tree is edit only for agents \(the screen's default\)/);
  });
  test("laying the screen out again would replace a limited tile: refused to an agent", () => {
    no(s, { op: "load", name: "river" }, /laying the screen out as river .* is refused/);
    expect(String(refusal(fresh(), { op: "load", name: "river" }, ctx(AGENT)))).not.toMatch(/for agents/);
  });
});

describe("setting it", () => {
  test("the person sets any level; null takes the tile's own away", () => {
    let s = run(fresh(), { op: "agents", tile: 3, level: "edit" });
    expect(level(s, 3)).toEqual({ level: "edit", by: "tile" });
    s = run(s, { op: "agents", tile: 3, level: "off" });
    expect(level(s, 3).level).toBe("off");
    s = run(s, { op: "agents", tile: 3, level: null });
    expect(level(s, 3).level).toBe("free");
  });
  test("an agent tightens (free to edit to off), never loosens: the refusal names the person's command", () => {
    let s = run(fresh(), { op: "agents", tile: 3, level: "edit" }, AGENT);
    expect(level(s, 3).level).toBe("edit");
    no(s, { op: "agents", tile: 3, level: "free" }, /loosening its own limit is refused .*tile\.agent policy=free tile=detail/);
    no(s, { op: "agents", tile: 3, level: null }, /loosening/);
    s = run(s, { op: "agents", tile: 3, level: "off" }, AGENT);
    expect(level(s, 3).level).toBe("off");
    no(s, { op: "agents", tile: 3, level: "edit" }, /loosening/);
  });
  test("a closed tile takes its level with it", () => {
    const s = run(run(fresh(), { op: "agents", tile: 3, level: "edit" }), { op: "close", tile: 3 });
    expect(s.agents.has(3)).toBe(false);
  });
  test("it is saved with the tile's own spec by the desk, and the screen's default with its policy", () => {
    const s = fresh([[3, "edit"]], { agents: "edit" });
    expect(serialize(s, id => ({ t: "leaf", id })).policy).toEqual({ agents: "edit" });
  });
});

describe("the dispatcher's actor rule", () => {
  const where = NOBODY;
  const gate = (level: "edit" | "off") => ({ tile: { name: "detail" }, gate: { action: "open", agents: { level, by: "tile" } } });
  const rule = (touches: any, replay: any, level: "edit" | "off") => actorRule({ touches, replay }, AGENT, where, gate(level));
  test("edit lets a draft action and a write through, refuses navigation", () => {
    expect(rule("draft", "ask", "edit")).toBeNull();
    expect(rule("nothing", "ask", "edit")).toBeNull();
    expect(rule("tile", "safe", "edit")).toMatch(/detail is edit only for agents: open is refused/);
    expect(rule("screen", "safe", "edit")).toMatch(/edit only/);
    expect(rule("shape", "safe", "edit")).toMatch(/edit only/);
  });
  test("off lets a read through and nothing else", () => {
    expect(rule("nothing", "safe", "off")).toBeNull();
    expect(rule("nothing", "ask", "off")).toMatch(/hands off for agents/);
    expect(rule("draft", "ask", "off")).toMatch(/hands off/);
    expect(rule("tile", "safe", "off")).toMatch(/hands off/);
  });
  test("the person is never limited", () => {
    expect(actorRule({ touches: "tile", replay: "safe" }, PERSON, where, gate("off"))).toBeNull();
  });
});

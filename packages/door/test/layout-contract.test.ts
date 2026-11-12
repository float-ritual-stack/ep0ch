// The contract tables (packages/outline-core/fixtures/, made by scripts/layout-contract.ts) are what the door's own
// functions answer: `apply` for a layout operation, `placement` for an open, the act line reader, every action's row and
// the built-in screens. A second implementation (native's Rust) is tested against them, so they must be true: this test
// makes them again and fails when a checked-in table is stale, and counts what they ask against the door's source, so a
// new operation, container, policy field or open rule can't arrive without a row.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ALT_RULES, OPEN_RULES, POLICY_KEYS, WIRE_VERBS, AGENT_LEVELS } from "@ep0ch/outline-core/screen-spec";

const FIXTURES = join(import.meta.dir, "../../outline-core/fixtures");
const FILES = ["layout-contract.json", "place-contract.json", "act-lines.json", "action-rows.json", "screens.json"];
const made = Object.fromEntries(FILES.map(file => [file, readFileSync(join(FIXTURES, file), "utf8")]));
const parsed = <T>(file: string): T => JSON.parse(made[file]!) as T;

interface Row {
  name: string; layout: { root: unknown; policy?: Record<string, unknown>; floats?: unknown[] }; tiles: Record<string, { kind: string }>;
  actor: { kind: "user" | "agent" }; person: { yolo?: boolean; typingIn: string | null; busy: boolean }; setup?: { op: { op: string } }[];
}
interface LayoutRow extends Row { op: Record<string, any> & { op: string }; result: { ok: boolean; refused?: string; changed?: boolean } }
interface PlaceRow extends Row { request: Record<string, any>; lands: { tile: string | null; kind: string; why: string | null }; placement: { destination: { kind: string } } }
const layoutRows = parsed<{ cases: LayoutRow[] }>("layout-contract.json").cases;
const placeRows = parsed<{ cases: PlaceRow[] }>("place-contract.json").cases;

/** Every node of a saved tree (a leaf, a container), and each policy said on the way. */
function nodes(n: any): any[] {
  if (!n || typeof n !== "object") return [];
  return [n, ...[...(Array.isArray(n.kids) ? n.kids : []), ...(Array.isArray(n.tabs) ? n.tabs : []), n.kid].flatMap(nodes)];
}
const policiesOf = (r: Row) => [r.layout.policy, ...nodes(r.layout.root).map(n => n.policy)].filter(Boolean) as Record<string, unknown>[];

describe("the contract tables are what the door answers", () => {
  test("made again by the door, in a process of its own, no table is stale", () => {
    // Its own process: the tables name every tile kind and action set the door has, and this run's other files have
    // registered theirs (a test's fixture set, a showcase's kinds). The environment is this run's (test/preload.ts: no
    // settings of the person's, a state folder of its own), passed on as it is.
    const r = Bun.spawnSync([process.execPath, join(import.meta.dir, "../scripts/layout-contract.ts"), "--check"], { cwd: join(import.meta.dir, ".."), env: { ...process.env, NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" });
    // A stale table says its first row that differs and the command that writes them again.
    expect(r.stderr.toString().trim()).toBe("");
    expect(r.exitCode).toBe(0);
  }, 120_000);
});

describe("the tables ask everything the door's layout decides", () => {
  const source = readFileSync(join(import.meta.dir, "../src/desk/screen-layout.ts"), "utf8");
  // The operations there are: the cases of the one switch that runs them (Step.dispatch).
  const dispatch = source.slice(source.indexOf("private dispatch(op: Op<I>) {"));
  const ops = [...new Set([...dispatch.slice(0, dispatch.indexOf("\n  }\n")).matchAll(/case "([\w.]+)":/g)].map(m => m[1]!))];

  test("the door's source still names its operations where this test reads them", () => {
    expect(ops.length).toBeGreaterThan(35);
    for (const op of ["open", "close", "move", "flow.travel", "remember"]) expect(ops).toContain(op);
  });

  test("every layout operation is done once and, where it can be, refused once", () => {
    const done = new Set(layoutRows.filter(r => r.result.ok).map(r => r.op.op)), refused = new Set(layoutRows.filter(r => !r.result.ok).map(r => r.op.op));
    expect(ops.filter(op => !done.has(op))).toEqual([]);
    // These refuse nothing of their own: bookkeeping the desk does (names reconciled, a dock's policy kept, a peek let go).
    expect(ops.filter(op => !refused.has(op)).sort()).toEqual(["names", "peek.release", "remember"]);
    // And no row asks an operation the door hasn't.
    expect([...new Set(layoutRows.map(r => r.op.op))].filter(op => !ops.includes(op))).toEqual([]);
  });

  test("every operation an agent's limits gate is asked by an agent", () => {
    // agentGate's cases: what an agent may not do to a tile it is limited on.
    const gate = source.slice(source.indexOf("private agentGate(op: Op<I>) {"));
    const gated = [...new Set([...gate.slice(0, gate.indexOf("\n  /** Tile `id`'s own level")).matchAll(/case "([\w.]+)":/g)].map(m => m[1]!))];
    expect(gated.length).toBeGreaterThan(25);
    const byAgent = new Set(layoutRows.filter(r => r.actor.kind === "agent").map(r => r.op.op));
    expect(gated.filter(op => !byAgent.has(op)).sort()).toEqual([]);
  });

  // What the source declares, read where it is declared: the kinds of node a saved tree has (outline-core's saved forms)
  // and the places a tile can be put (`At`, its `Place`s and a `Beside`, with the ways a `Beside` prefers).
  const core = readFileSync(join(import.meta.dir, "../../outline-core/src/screen-spec.ts"), "utf8");
  const declared = (text: string, from: string, to: string, word: string): string[] => {
    const at = text.indexOf(from);
    return at < 0 ? [] : [...new Set([...text.slice(at, text.indexOf(to, at)).matchAll(new RegExp(`\\b${word}: "([\\w.-]+)"`, "g"))].map(m => m[1]!))].sort();
  };
  const src = (file: string) => readFileSync(join(import.meta.dir, "../src/desk", file), "utf8");
  const nodeKinds = [...new Set([...declared(core, "// ── saved forms ──", "\nconst DIRS", "t"), ...declared(core, "export interface TileSpec {", "\n}", "t")])].sort();
  const placeKinds = [...new Set([...declared(source, "export type At<I = number> =", ";\n", "kind"), ...declared(src("layout.ts"), "export type Place<I> =", ";\n", "kind"), ...declared(src("landing.ts"), "export interface Beside<I = number> {", "\n}", "kind")])].sort();
  const prefers = [...src("landing.ts").slice(src("landing.ts").indexOf("export type Prefers =")).split(";")[0]!.matchAll(/"([\w-]+)"/g)].map(m => m[1]!);

  test("the source still declares its node kinds and places where this test reads them", () => {
    for (const kind of ["leaf", "split", "tabs"]) expect(nodeKinds).toContain(kind);
    for (const kind of ["split", "tabs", "edge", "beside"]) expect(placeKinds).toContain(kind);
    expect(prefers.length).toBeGreaterThan(3);
  });

  test("every container kind, floats too, in both tables", () => {
    for (const rows of [layoutRows, placeRows] as Row[][]) {
      const kinds = new Set(rows.flatMap(r => nodes(r.layout.root).map(n => n.t)));
      expect([...kinds].sort()).toEqual(nodeKinds);
      expect(rows.some(r => r.layout.floats?.length)).toBe(true);
      expect(new Set(rows.flatMap(r => nodes(r.layout.root).filter(n => n.t === "split").map(n => n.dir)))).toEqual(new Set(["row", "col"]));
    }
  });

  test("every policy field, on a layout or set by an operation", () => {
    const said = new Set([...layoutRows, ...placeRows].flatMap(r => policiesOf(r).flatMap(p => Object.keys(p))));
    for (const r of layoutRows) if (r.op.op === "policy") for (const k of [...Object.keys(r.op.set), ...r.op.clear]) said.add(k);
    expect(POLICY_KEYS.filter(k => !said.has(k))).toEqual([]);
  });

  test("every agent level, on a tile, a container and the screen; the person, an agent, and an agent in yolo", () => {
    const tiles = new Set(layoutRows.flatMap(r => nodes(r.layout.root).map(n => (n.t === "leaf" ? n.agents : undefined))));
    const above = new Set(layoutRows.flatMap(r => policiesOf(r).map(p => p.agents)));
    for (const level of AGENT_LEVELS) expect(tiles.has(level) || above.has(level)).toBe(true);
    for (const level of ["edit", "off"]) { expect(tiles.has(level)).toBe(true); expect(above.has(level)).toBe(true); }
    for (const rows of [layoutRows, placeRows] as Row[][]) {
      expect(rows.some(r => r.actor.kind === "user")).toBe(true);
      expect(rows.some(r => r.actor.kind === "agent" && !r.person.yolo)).toBe(true);
      expect(rows.some(r => r.actor.kind === "agent" && r.person.yolo)).toBe(true);
      expect(rows.some(r => r.actor.kind === "agent" && r.person.typingIn !== null)).toBe(true);
    }
  });

  test("every place a new tile can be put", () => {
    const at = new Set(layoutRows.filter(r => r.op.op === "open" && r.op.at).map(r => r.op.at.kind));
    expect([...at].sort()).toEqual(placeKinds);
    expect(new Set(layoutRows.filter(r => r.op.op === "open" && r.op.at?.kind === "beside").map(r => r.op.at.prefers))).toEqual(new Set(prefers));
    expect(layoutRows.some(r => r.op.op === "open" && r.op.placement)).toBe(true);
  });

  test("every open rule, alt rule and wire verb is asked of placement, and every kind of landing comes back", () => {
    const policies = placeRows.flatMap(policiesOf);
    // `reader` is the rule when none is said: a row with no route.
    const opens = new Set([...policies.map(p => p.opens), ...placeRows.map(r => r.layout && (r.layout as { rule?: string }).rule)]);
    expect(OPEN_RULES.filter(rule => rule !== "reader" && !opens.has(rule))).toEqual([]);
    expect(placeRows.some(r => (r.placement as { route?: unknown }).route === null && r.lands.kind === "swap")).toBe(true);
    const wires = placeRows.flatMap(r => nodes(r.layout.root).flatMap(n => (n.wires ?? []) as { verb: string; rule?: string }[]));
    const alt = new Set([...policies.map(p => p.altOpens), ...wires.map(w => w.rule), ...placeRows.map(r => r.request.rule)]);
    expect(ALT_RULES.filter(rule => !alt.has(rule))).toEqual([]);
    const verbs = new Set([...wires.map(w => w.verb), ...layoutRows.filter(r => r.op.op === "link").map(r => r.op.verb ?? "open"), ...layoutRows.flatMap(r => nodes(r.layout.root).flatMap(n => (n.wires ?? []).map((w: { verb: string }) => w.verb)))]);
    expect(WIRE_VERBS.filter(v => !verbs.has(v))).toEqual([]);
    expect([...new Set(placeRows.map(r => r.placement.destination.kind))].sort()).toEqual(["across", "action", "new", "none", "swap"]);
    expect(new Set(placeRows.map(r => r.request.where).filter(Boolean))).toEqual(new Set(["current", "beside", "float", "full"]));
    // What an open may say beyond its tile: each asked.
    for (const field of ["to", "fresh", "rule", "keep", "history", "at", "container", "newNote", "default", "keys", "inspect", "act", "verb"]) expect(placeRows.some(r => r.request[field] !== undefined)).toBe(true);
    // Each landing says the tile, and why when the door says why.
    expect(placeRows.filter(r => r.lands.kind === "swap" && !r.lands.tile).map(r => r.name)).toEqual([]);
    expect(placeRows.filter(r => r.lands.why).length).toBeGreaterThan(8);
  });

  test("a row is asked once, by a name that says what it shows, with made-up tiles", () => {
    for (const rows of [layoutRows, placeRows] as Row[][]) {
      expect(new Set(rows.map(r => r.name)).size).toBe(rows.length);
      for (const r of rows) expect(Object.keys(r.tiles).length).toBeGreaterThan(0);
    }
    for (const text of Object.values(made)) expect(text).not.toMatch(/\/(?:home|Users|root)\//);
  });
});

describe("the action rows, the screens and the act lines", () => {
  test("an action has one row under its set's scope, and the rows hold the layout's own actions", () => {
    const rows = parsed<{ rows: { scope: string; id: string; summary: string; touches: string; args: object }[] }>("action-rows.json").rows;
    expect(new Set(rows.map(r => `${r.scope}:${r.id}`)).size).toBe(rows.length);
    for (const r of rows) { expect(r.summary.length).toBeGreaterThan(0); expect(["nothing", "tile", "shape", "draft", "screen"]).toContain(r.touches); }
    // What `act` reaches a layout by: each a row, none an extension's (they come and go with it).
    for (const id of ["tile.open", "tile.close", "tile.collapse", "tile.dock", "tile.slide", "tile.zoom", "tile.link", "tile.agent", "layout.move", "layout.swap", "layout.resize", "layout.even", "layout.lock", "layout.policy", "layout.load", "screen.open", "open"]) expect(rows.some(r => r.id === id)).toBe(true);
    expect(rows.filter(r => r.id.startsWith("ext.")).length).toBe(0);
  });

  test("the door's screens are there as specs, the desk and the board among them", () => {
    const screens = parsed<{ screens: { name: string; target?: string; spec: { name: string; layout: { root: unknown } } }[] }>("screens.json").screens;
    for (const name of ["desk", "welcome", "brief", "pinned", "board", "river", "blank", "library", "keys", "settings", "detail", "home", "navigator", "who", "lastcall"]) expect(screens.some(s => s.name === name)).toBe(true);
    for (const s of screens) { expect(s.spec.name).toBe(s.name); expect(nodes(s.spec.layout.root).some(n => n.t === "leaf")).toBe(true); }
    expect(screens.find(s => s.name === "board")!.target).toBe("hub");
  });

  test("every act line reads as a request or is refused with why; a typed one by a real action", () => {
    const t = parsed<{ lines: { line: string; request?: object; refused?: string; args?: object; argsRefused?: string }[]; addresses: { address: { kind: string } }[] }>("act-lines.json");
    for (const l of t.lines) expect(!!l.request !== !!l.refused).toBe(true);
    expect(t.lines.some(l => l.args)).toBe(true);
    expect(t.lines.some(l => l.argsRefused)).toBe(true);
    expect(new Set(t.addresses.map(a => a.address.kind))).toEqual(new Set(["id", "role", "slot", "relative", "name"]));
  });
});

// The contract tables (packages/native/docs/DESIGN.md §5): what the door's own functions answer, written down as data
// for a second implementation to be tested against (native's Rust `apply` and `place`, its act line reader, its action
// rows and screens). Nothing here decides anything: each table is made by calling the door's function on made-up input
// (scripts/layout-contract/cases.ts) and recording what came back.
//
//   scripts/agent-env <name> -- bun packages/door/scripts/layout-contract.ts            write the five tables to packages/outline-core/fixtures/
//   scripts/agent-env <name> -- bun packages/door/scripts/layout-contract.ts --check    write nothing; exit 1 naming each table that is stale
//
//   layout-contract.json   { layout, tiles, actor, person, op }      → the layout after, or the refusal   (apply)
//   place-contract.json    { layout, tiles, actor, person, request } → where the open lands, and why      (placement)
//   act-lines.json         an act line → its words, the request, and its arguments typed by the action    (lineWords, actRequestOf, coerceActionArgs)
//                          a `tile=` → the address it is                                                  (parseTileAddress)
//   action-rows.json       every action the door has, as its row                                          (ActionSet, actionRow)
//   screens.json           the door's built-in screens, each as its spec                                  (screenSpec, specData)
//
// test/layout-contract.test.ts makes them again and fails when a checked-in table is stale, so a change to a layout rule
// shows as a changed row in the same PR. It runs this script as a process of its own: the tables name every tile kind and
// action set the door has, and in a test run other files have registered theirs. A layout here is the door's saved form (LayoutSpec); a tile is named, and its
// name is its id (a renamed tile's leaf says both).
import "./layout-contract/env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import "../src/app";
import "../src/screens";
import "../src/desk/screen-specs";
import type { Rect } from "../src/canvas";
import type { Actor } from "../src/socket";
import { actionRow, actRequestOf, allActionSets, coerceActionArgs, lineWords, type ActionRow, type ArgSpec } from "../src/surface/actions";
import { isAgentLevel, type AgentLevel } from "../src/surface/agent-level";
import { layoutStanding } from "../src/surface/dispatch";
import { visible } from "../src/style";
import {
  apply, init, leaves, node, placement, policyOf, reviveTree, serialize,
  type AcrossWire, type Ctx, type Float, type Fold, type LayoutState, type Op, type Person, type Policy, type TileFacts, type Wire,
} from "../src/desk/screen-layout";
import { builtinScreen, readSpec, screenNames, screenSpec, screenTargetArg, specData } from "../src/desk/screen-spec";
import { tileKind, tileKinds } from "../src/desk/tile-kinds";
import { canonSpec, tileKindNames, type LayoutSpec, type TileSpec } from "../src/desk/tiles";
import { parseTileAddress } from "../src/desk/tile-address";
import { ACT_LINES, AREA, LAYOUT_CASES, PLACE_CASES, TILE_ADDRESSES, type CaseCtx, type LayoutCase, type PlaceCase, type Scene } from "./layout-contract/cases";

/** Where the tables are checked in: outline-core's, so both suites read one copy. */
export const FIXTURES = join(import.meta.dir, "../../outline-core/fixtures");
const BY = "packages/door/scripts/layout-contract.ts";

// ── a scene: a saved layout as the layout module's state, and what each of its tiles is ──

/** What a kind says of every tile of it (the desk's facts() adds what a tile's own pane says: the scene's `tiles`). */
function kindFacts(kind: string): TileFacts {
  const k = tileKind(kind);
  return {
    kind, notes: !!k?.accepts?.notes,
    ...(k?.policy ? { policy: k.policy } : {}), ...(k?.stays ? { stays: k.stays } : {}), ...(k?.accepts?.tiles ? { tabs: k.accepts.tiles } : {}),
    ...(k?.placeholder ? { placeholder: true } : {}), ...(k?.follower ? { follower: true } : {}), ...(k?.opensOnScreen ? { opensOut: true } : {}),
  };
}

interface Built { state: LayoutState<string>; kinds: Map<string, string> }

/**
 * A saved layout as the state `apply` takes: the tree revived, each leaf read as the desk reads one (`canonSpec`: a
 * link is its wires, a preview's source the tile it follows), its name its id, then its folds, agent levels and wires.
 */
function build(layout: LayoutSpec): Built {
  const names = new Map<string, string>(), kinds = new Map<string, string>(), folded = new Map<string, Fold>(), agents = new Map<string, AgentLevel>(), altReaders = new Set<string>();
  const wantWires: { from: string; verb: Wire["verb"]; to: string; rule?: Wire["rule"] }[] = [], wantSources: [string, string][] = [];
  const leafOf = (given: TileSpec): string => {
    const l = canonSpec(given);
    if (!l.name) throw new Error(`a scene's tile has a name (a ${l.kind} tile has none)`);
    if (names.has(l.name)) throw new Error(`two tiles named ${l.name} in one scene`);
    names.set(l.name, l.name); kinds.set(l.name, l.kind);
    for (const w of l.wires ?? []) wantWires.push({ from: l.name, ...w });
    if (l.selectFrom) wantSources.push([l.name, l.selectFrom]);
    if (l.altReader) altReaders.add(l.name);
    if (l.collapsed) folded.set(l.name, l.collapsed === "h" ? { dir: "h" } : {});
    if (isAgentLevel(l.agents)) agents.set(l.name, l.agents);
    return l.name;
  };
  const tree = reviveTree(layout.root, leafOf);
  const floats: Float<string>[] = (layout.floats ?? []).map(f => ({ id: leafOf(f.tile), rect: { ...f.rect }, ...(f.peekOf !== undefined ? { peekOf: f.peekOf } : {}) }));
  const wires: Wire<string>[] = [], across: AcrossWire<string>[] = [];
  const sourceWires: typeof wantWires = [];
  for (const [to, source] of wantSources) for (const from of names.has(source) ? [source] : node(tree, source) ? leaves(node(tree, source)!) : []) sourceWires.push({ from, verb: "select", to });
  for (const { from, verb, to, rule } of [...sourceWires, ...wantWires]) {
    // One wire a verb, the last said (a selection may feed several tiles).
    if (verb !== "select") { for (const list of [wires, across] as { from: string; verb: string }[][]) for (let i = list.length - 1; i >= 0; i--) if (list[i]!.from === from && list[i]!.verb === verb) list.splice(i, 1); }
    if (!names.has(to)) { across.push({ from, to, verb, ...(rule ? { rule } : {}) }); continue; }
    if (to === from && !rule && verb !== "open") continue;
    if (!wires.some(w => w.from === from && w.verb === verb && w.to === to)) wires.push({ from, verb, to, ...(rule ? { rule } : {}) });
  }
  const policy: Policy = { ...policyOf(layout.policy), ...(layout.rule === "next" ? { opens: "next" as const } : {}) };
  return { state: init({ tree, names, floats, collapsed: folded, wires, across, altReaders, agents, policy }), kinds };
}

/** Each tile's facts: its kind's, then what the scene says of this one. A tile an operation brings (`opens`) has its kind's. */
function factsOf(scene: Scene, kinds: ReadonlyMap<string, string>, bring: Record<string, string> = {}): { all: Record<string, TileFacts>; of: (id: string) => TileFacts } {
  const all: Record<string, TileFacts> = {};
  for (const [name, kind] of [...kinds, ...Object.entries(bring)]) all[name] = { ...kindFacts(kind), ...scene.tiles?.[name] };
  for (const name of Object.keys(scene.tiles ?? {})) if (!all[name]) throw new Error(`the scene says what ${name} is, and has no such tile`);
  return { all, of: id => all[id] ?? kindFacts("tile") };
}

/** The person as the case says, at their defaults: the keys on the layout's focus, not typing, not busy. */
function personOf(given: Partial<Person<string>> | undefined, focus: string): Person<string> {
  return { focus, typingIn: null, busy: false, ...given };
}

/** What `apply` and `placement` are told: who acts and how they stand (the door's one rule, `layoutStanding`), where the person is, what each tile is. */
function ctxOf(actor: Actor, person: Person<string>, tile: (id: string) => TileFacts, area: Rect, more: CaseCtx = {}): { ctx: Ctx<string>; standing: { standing: boolean; keys: boolean; protectTyping: boolean } } {
  const who = layoutStanding(actor, { keys: "screen", screen: "contract", idle: 60_000, away: null, focus: person.focus, typingIn: person.typingIn, busy: person.busy, ...(person.yolo ? { yolo: true as const } : {}) });
  const { beside, opened, ...plain } = more;
  return {
    standing: { standing: who.standing, keys: who.keys, protectTyping: who.protectTyping },
    ctx: {
      actor, standing: who.standing, keys: who.keys, protectTyping: who.protectTyping, person, tile, area,
      kinds: { all: tileKindNames(), notes: tileKinds().filter(k => k.accepts?.notes).map(k => k.kind) },
      ...plain,
      ...(beside ? { beside: new Map(Object.entries(beside)) } : {}),
      ...(opened ? { opened: new Map(Object.entries(opened)) } : {}),
    },
  };
}

/** The focus a scene starts with: its layout's (a name), else its first tile. */
const focusOf = (layout: LayoutSpec, s: LayoutState<string>): string => (typeof layout.focus === "string" && s.names.has(layout.focus) ? layout.focus : leaves(s.tree)[0] ?? s.floats[0]?.id ?? "");

/**
 * The state as a saved layout again (the door's `serialize`), each leaf with its kind, its name, its fold, its agent
 * level and its wires, and under `also` what a saved layout doesn't hold: the zoom, a lift, agents' locks, the order
 * tiles were touched, who folded what, the revision.
 */
function saved(s: LayoutState<string>, focus: string, tile: (id: string) => TileFacts): Record<string, unknown> {
  const name = (id: string) => s.names.get(id) ?? id;
  const leafOf = (id: string) => {
    const fold = s.collapsed.get(id), level = s.agents.get(id);
    const wires = [...s.wires.filter(w => w.from === id).map(w => ({ verb: w.verb, to: name(w.to), ...(w.rule ? { rule: w.rule } : {}) })), ...s.across.filter(w => w.from === id).map(w => ({ verb: w.verb, to: w.to, ...(w.rule ? { rule: w.rule } : {}) }))];
    return {
      t: "leaf" as const, kind: tile(id).kind, name: name(id), ...(name(id) !== id ? { id } : {}),
      ...(fold ? { collapsed: fold.dir === "h" ? "h" as const : true as const } : {}), ...(level ? { agents: level } : {}), ...(s.altReaders.has(id) ? { altReader: true } : {}),
      ...(wires.length ? { wires } : {}),
    };
  };
  const out = serialize(s, leafOf);
  const folds = Object.fromEntries([...s.collapsed].filter(([, f]) => f.by).map(([id, f]) => [name(id), f.by]));
  const opened = Object.fromEntries([...s.openedFrom].map(([id, o]) => [name(id), { ...o, from: name(o.from) }]));
  const remembered = Object.fromEntries(s.remembered);
  const also = {
    ...(s.zoom !== null ? { zoom: name(s.zoom) } : {}),
    ...(s.lift ? { lift: { ...s.lift, tile: name(s.lift.tile) } } : {}),
    ...(s.locks.length ? { locks: [...s.locks] } : {}),
    ...(s.touched.length ? { touched: s.touched.map(name) } : {}),
    ...(Object.keys(folds).length ? { foldedBy: folds } : {}),
    ...(Object.keys(opened).length ? { openedFrom: opened } : {}),
    ...(Object.keys(remembered).length ? { remembered } : {}),
    rev: s.rev,
  };
  return {
    focus: name(focus), root: out.root, ...(out.policy ? { policy: out.policy } : {}),
    ...(out.floats ? { floats: out.floats.map(f => ({ ...f, ...(f.peekOf !== undefined ? { peekOf: name(f.peekOf) } : {}) })) } : {}),
    also,
  };
}

/** The tiles an operation brings that the scene hasn't: each by the kind the operation says. */
function brought(op: Op<string>): Record<string, string> {
  if (op.op === "open") return { [op.tile]: op.kind ?? "reader" };
  if (op.op === "replace" || op.op === "group") return { [op.with]: op.kind };
  if (op.op === "fill") return Object.fromEntries((op.fresh ?? []).map(t => [t.id, t.kind]));
  return {};
}

// ── the tables ──

/**
 * The scene as its case starts: its layout built, then each `setup` step applied (what a saved layout can't hold: a
 * zoom, a lift, an agent's lock, the tile a tile was opened from), the person's keys following each. A setup step
 * that is refused is a broken case, never a row.
 */
function start(c: LayoutCase | PlaceCase, bring: Record<string, string>) {
  const built = build(c.scene.layout);
  const facts = factsOf(c.scene, built.kinds, { ...Object.assign({}, ...(c.setup ?? []).map(s => brought(s.op))), ...bring }), area = c.area ?? AREA;
  let state = built.state, focus = focusOf(c.scene.layout, state);
  for (const step of c.setup ?? []) {
    const r = apply(state, step.op, ctxOf(step.by ?? USER, personOf(undefined, focus), facts.of, area, c.ctx).ctx);
    if (!r.ok) throw new Error(`${c.name}: its setup step ${step.op.op} was refused (${r.refused})`);
    state = r.state; focus = r.focus;
  }
  const actor = c.by ?? USER, person = personOf(c.person, focus);
  const { ctx, standing } = ctxOf(actor, person, facts.of, area, c.ctx);
  // What a case is asked with, as its row says it: enough for another implementation to ask the same.
  const asked = { name: c.name, layout: c.scene.layout, tiles: facts.all, ...(c.setup ? { setup: c.setup.map(s => ({ ...(s.by ? { actor: s.by } : {}), op: s.op })) } : {}), actor, standing, person, ...(c.area ? { area } : {}), ...(c.ctx ? { ctx: c.ctx } : {}) };
  return { state, facts, ctx, asked };
}
const USER: Actor = { kind: "user" };

function layoutRow(c: LayoutCase) {
  const { state, facts, ctx, asked } = start(c, { ...brought(c.op), ...c.brings });
  const r = apply(state, c.op, ctx);
  return { ...asked, op: c.op, result: r.ok ? { ok: true, layout: saved(r.state, r.focus, facts.of), changed: r.changed, answer: r.answer } : { ok: false, refused: r.refused } };
}

/** The new tile an open in the place table makes, when its landing asks for one. */
const SPROUT = "sprout";

function placeRow(c: PlaceCase) {
  const { state, facts, ctx, asked } = start(c, { [SPROUT]: "reader" });
  const plan = placement(state, c.request, ctx);
  const dest = plan.destination;
  // The landing applied, as the desk applies it (the same request through `apply`): the layout an open leaves.
  const r = dest.kind === "swap" || dest.kind === "new" ? apply(state, { op: "open", placement: c.request, tile: SPROUT, kind: "reader" }, ctx) : null;
  const made = r?.ok ? r.state.names.get(SPROUT) : undefined;
  // The tile the note is read in: the one that takes it, or the new one made for it. `keeps`: the new spine a reader's
  // old note stays in. An open that goes elsewhere (another screen, an action of the screen's) or nowhere lands in none.
  const tile = r && !r.ok ? null : dest.kind === "swap" ? state.names.get(dest.tile)! : dest.kind === "new" ? made ?? null : null;
  return {
    ...asked, request: c.request,
    lands: {
      tile, kind: dest.kind, why: plan.why ?? (dest.kind === "none" ? dest.reason : null),
      ...(dest.kind === "new" && tile !== null ? { new: true } : {}), ...(dest.kind === "swap" && made !== undefined ? { keeps: made } : {}), ...(r && !r.ok ? { refused: r.refused } : {}),
    },
    placement: plan,
    ...(r ? { after: r.ok ? { ok: true, layout: saved(r.state, r.focus, facts.of) } : { ok: false, refused: r.refused } } : {}),
  };
}

/** Every built-in action once, by its set's scope and its name (an extension's actions come and go with it). */
function actionRows(): (ActionRow & { scope: string })[] {
  const rows = new Map<string, ActionRow & { scope: string }>();
  for (const set of allActionSets()) for (const id of set.names()) {
    if (id.startsWith("ext.")) continue;
    const row = { scope: set.scope, ...actionRow(id, set.def(id)!) }, key = `${set.scope}\0${id}`, had = rows.get(key);
    if (had && JSON.stringify(had) !== JSON.stringify(row)) throw new Error(`two sets of scope ${set.scope} describe ${id} differently`);
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => (a.scope === b.scope ? (a.id < b.id ? -1 : 1) : a.scope < b.scope ? -1 : 1));
}

function actLine(c: { line: string; repeats?: "list"; typed?: true }, specs: ReadonlyMap<string, Record<string, ArgSpec>>) {
  let words: string[];
  try { words = lineWords(c.line); } catch (e) { return { line: c.line, refused: (e as Error).message }; }
  try {
    const request = actRequestOf(words, c.repeats ? { repeats: c.repeats } : {});
    if (!c.typed) return { line: c.line, ...(c.repeats ? { repeats: c.repeats } : {}), words, request };
    const spec = specs.get(request.action);
    if (!spec) throw new Error(`act line ${JSON.stringify(c.line)} is typed by an action the door hasn't: ${request.action}`);
    // The arguments as the action's own row types them (a number, a boolean), or why it refuses them.
    try { return { line: c.line, words, request, args: coerceActionArgs(request.action, spec, request.args ?? {}) }; }
    catch (e) { return { line: c.line, words, request, argsRefused: (e as Error).message }; }
  } catch (e) {
    if ((e as Error).name !== "ActionRefused") throw e;
    return { line: c.line, ...(c.repeats ? { repeats: c.repeats } : {}), words, refused: (e as Error).message };
  }
}

/** The five tables, by file name, as text. */
export function contractTables(): Record<string, string> {
  const layout = LAYOUT_CASES.map(layoutRow), place = PLACE_CASES.map(placeRow);
  for (const [what, rows] of [["layout", layout], ["place", place]] as const) {
    const seen = new Set<string>();
    for (const r of rows) { if (seen.has(r.name)) throw new Error(`two ${what} cases named ${JSON.stringify(r.name)}`); seen.add(r.name); }
  }
  const rows = actionRows();
  const specs = new Map(rows.map(r => [r.id, r.args] as const));
  const screens = screenNames().filter(builtinScreen).map(name => {
    const made = specData(screenSpec(name)!) as { hint?: string | Record<string, string> };
    // What the door ships reads back through the one validator, its tiles' kinds among those the door has.
    readSpec(made, true);
    // A hint a screen drew as it made its spec (EchoNet's: a strip in the theme's colours, each segment a click by a
    // number the process hands out) isn't data: the table holds its words, and says which field was drawn.
    const drawn = JSON.stringify(made.hint ?? "").includes("\\u001b");
    const words = (h: string) => visible(h);
    const spec = !drawn ? made : { ...made, hint: typeof made.hint === "string" ? words(made.hint) : Object.fromEntries(Object.entries(made.hint!).map(([k, v]) => [k, words(v)])) };
    return { name, ...(screenTargetArg(name) ? { target: screenTargetArg(name) } : {}), ...(drawn ? { drawn: ["hint"] } : {}), spec };
  });
  return {
    "layout-contract.json": table({ about: "A layout, an operation and who asks: the layout after, or the refusal. Made by the door's apply(); never edited by hand.", by: BY, reading: READING, area: AREA, kinds: kindsAsked() }, { cases: layout }),
    "place-contract.json": table({ about: "A layout and an open: the tile the note lands in and why (lands), the door's whole answer (placement), and the layout the open leaves (after). Made by the door's placement() and apply(); never edited by hand.", by: BY, reading: [...READING, `lands.tile is the tile the note is read in; an open that needs a new tile makes one with the id ${SPROUT} (a reader), and lands.keeps names it when it is the spine an old note stays in.`], area: AREA, kinds: kindsAsked() }, { cases: place }),
    "act-lines.json": table({ about: "An act line: its words, the request it is, and (typed) its arguments as the action's row types them. A tile= is one of five kinds of address. Made by lineWords(), actRequestOf(), the door's coerceActionArgs() and parseTileAddress(); never edited by hand.", by: BY }, { lines: ACT_LINES.map(c => actLine(c, specs)), addresses: TILE_ADDRESSES.map(tile => ({ tile, address: parseTileAddress(tile) })) }),
    "action-rows.json": table({ about: "Every action the door has, as its row (outline-core's ActionRow) under the scope of its set. Made from the door's action sets; never edited by hand.", by: BY }, { rows }),
    "screens.json": table({ about: "The door's built-in screens, each as its spec (outline-core's ScreenSpec) and the argument a target fills. drawn names a field the screen drew as it made its spec (a hint row's strip): the table holds its words, without the colours and click marks. Made from the door's screen registry; never edited by hand.", by: BY }, { screens }),
  };
}

/** The tile kinds every row was asked with (`Ctx.kinds`): a refusal that lists them is said from these. */
const kindsAsked = () => ({ all: tileKindNames(), notes: tileKinds().filter(k => k.accepts?.notes).map(k => k.kind) });

/** How a layout row reads, said in the tables themselves. */
const READING = [
  "layout is the door's saved form (outline-core's LayoutSpec); a tile's name is its id, and a leaf says both once they differ.",
  "tiles says what each tile is, as the layout's rules read it (TileFacts): its kind's facts from the door's registry, then what the case says of that tile.",
  "setup, when a case has it, is applied first, each step by the person unless it names an actor; standing is how the door's one rule reads the actor (layoutStanding).",
  "A layout in a result holds what the layout module holds of a tile (kind, name, fold, agent level, wires), and under also what no saved layout does (zoom, lift, locks, touched, foldedBy, openedFrom, remembered, rev).",
  "A share is the number the door computed (an IEEE double): compare shares to within 1e-9.",
  "kinds is the tile kinds every row was asked with: all of them, and the ones that take notes (a refusal that lists kinds lists these).",
];

/** A table as text: its head, then each list one row a line, so a changed rule is a changed line. */
function table(head: Record<string, unknown>, lists: Record<string, readonly unknown[]>): string {
  const lines = Object.entries(head).map(([k, v]) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
  const rows = Object.entries(lists).map(([k, list]) => `  ${JSON.stringify(k)}: [\n${list.map(r => `    ${JSON.stringify(r)}`).join(",\n")}\n  ]`);
  return `{\n${[...lines, ...rows].join(",\n")}\n}\n`;
}

/**
 * The tables whose checked-in text isn't what the door answers now, each with the first row that differs (the rule
 * that moved); the whole table is never printed.
 */
export function staleTables(dir = FIXTURES): { file: string; at: string }[] {
  return Object.entries(contractTables()).flatMap(([file, text]) => {
    const kept = existsSync(join(dir, file)) ? readFileSync(join(dir, file), "utf8") : null;
    if (kept === text) return [];
    if (kept === null) return [{ file, at: "it isn't checked in" }];
    const a = kept.split("\n"), b = text.split("\n"), i = b.findIndex((line, n) => line !== a[n]);
    return [{ file, at: i < 0 ? `it has ${a.length - b.length} rows the door no longer answers` : `line ${i + 1}, as the door answers now: ${(b[i] ?? "").trim().slice(0, 240)}` }];
  });
}

if (import.meta.main) {
  if (process.argv.includes("--check")) {
    const stale = staleTables();
    for (const t of stale) console.error(`${t.file} is stale (${t.at})`);
    if (stale.length) { console.error(`if the door's answer is the one meant, write the tables again: scripts/agent-env <your name> -- bun ${BY}`); process.exit(1); }
    console.log("the contract tables are what the door answers");
  } else {
    mkdirSync(FIXTURES, { recursive: true });
    for (const [file, text] of Object.entries(contractTables())) { writeFileSync(join(FIXTURES, file), text); console.log(`${file}: ${text.split("\n").filter(l => l.startsWith("    {")).length} rows`); }
  }
  process.exit(0);
}

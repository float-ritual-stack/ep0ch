// Moving a card between board lanes, and what a new card in a lane is born with. A lane is a saved
// view; a write plans against its query:
//   - plain top-level clauses (`key` present, or `key=value` with a case-insensitive value) are what a
//     write sets: a value clause replaces the card's one block-scope token for that key, or appends one;
//     clauses the card already satisfies are left alone (only differing values are patched);
//   - everything else in the query (an OR group, a NOT, a created/updated range; PIE-398) must already
//     hold. The whole query is evaluated on the card as the patch would leave it (src/query.ts), so a
//     group that mentions a patched key can't be broken by the patch. For example, on a board whose
//     lanes read `type=roadmap-item (project=pi-outliner OR project=ep0ch-door) work-stage=doing`, a
//     card already in one of those projects moves by patching work-stage alone; any other card is
//     refused, with the term it doesn't meet;
//   - everything a patch can't satisfy is refused before any write, with the reason.
// A bare word is a presence clause (`urgent` means "has an urgent:: property"), refused when the card
// lacks it, because a patch would have to invent the value.
import type { Msg } from "./board";
import { holds, keysOf, parseQuery, showExpr, type QueryExpr, type WritableQuery } from "./query";
import { EditConflict, USER, type Actor, type PropertyPatch, type SocketBoard } from "./socket";
import { type PropertyFilter, type ViewRead } from "./views";

export interface Change { key: string; to: string; from: string | null }
export type MovePlan =
  | { kind: "patch"; changes: Change[] }
  | { kind: "already" }
  | { kind: "refused"; reason: string };

export interface LaneLike { name: string; read?: ViewRead; def?: Msg }

type Prop = { key: string; value: string };
const propsOf = (m: Msg): Prop[] => m.properties ?? Object.entries(m.props).map(([key, value]) => ({ key, value }));
const when = (t: number) => (t > 0 ? t : undefined);

/** The lane's query as a write sees it, or why there is nothing to plan against. */
function writable(lane: LaneLike): { q: WritableQuery } | { refused: string } {
  const read = lane.read;
  if (!read) return { refused: `${lane.name} is still loading` };
  if (read.status !== "ready") return { refused: `${lane.name} is ${read.status}: ${read.errors[0] ?? "no reason given"}` };
  if (read.unpatchable) return { refused: `${lane.name}'s query ${read.unpatchable}` };
  if (read.query) return { q: read.query };
  if (!read.filters.length) return { refused: `${lane.name} has no query clauses to satisfy` };
  const expr: QueryExpr = { kind: "and", operands: read.filters.map(f => ({ kind: "property" as const, ...f })) };
  return { q: { expr, plain: read.filters, rest: [] } };
}

/** "project=garden", "no project" — what the card has for the keys a term names. */
function has(props: Prop[], term: QueryExpr): string {
  const keys = keysOf(term);
  if (!keys.length) return "";
  return keys.map(k => { const v = props.filter(p => p.key === k).map(p => p.value); return v.length ? `${k}=${v.join(",")}` : `no ${k}`; }).join(", ");
}

/** The terms of `q` that `props` doesn't meet (false), or can't be told (undefined). */
function unmet(q: WritableQuery, s: { properties: Prop[]; createdAt?: number; updatedAt?: number }) {
  return q.rest.map(term => ({ term, ok: holds(term, s) })).filter(x => x.ok !== true);
}

/** What moving `card` into `lane` would patch, or why it can't. Pure: nothing is read or written. */
export function planMove(card: Msg, lane: LaneLike): MovePlan {
  const w = writable(lane);
  if ("refused" in w) {
    if (lane.read?.status === "ready" && lane.read.items.some(m => m.id === card.id)) return { kind: "already" };   // the service lists it there
    return { kind: "refused", reason: w.refused };
  }
  const { q } = w;
  const props = propsOf(card);
  const now = { properties: props, createdAt: when(card.createdAt), updatedAt: when(card.updatedAt) };
  if (holds(q.expr, now) === true) return { kind: "already" };
  const listed = lane.read!.items.some(m => m.id === card.id);        // the service's word on membership wins

  const byKey = new Map<string, PropertyFilter[]>();
  for (const f of q.plain) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);
  const changes: Change[] = [];
  for (const [key, clauses] of byKey) {
    const have = props.filter(p => p.key === key);
    if (clauses.every(c => have.some(p => c.value === undefined || p.value.toLowerCase() === c.value.toLowerCase()))) continue;   // this key already agrees
    const values = [...new Map(clauses.filter(c => c.value !== undefined).map(c => [c.value!.toLowerCase(), c.value!])).values()];
    if (values.length === 0)
      return { kind: "refused", reason: `${lane.name} asks for any ${key}:: value; a move can't choose one` };
    if (values.length > 1)
      return { kind: "refused", reason: `${lane.name} asks for ${key} to be ${values.join(" and ")} at once; a move sets one value` };
    if (have.length > 1)
      return { kind: "refused", reason: `the card has ${have.length} ${key}:: values (${have.map(h => h.value).join(", ")}); the door won't guess which one moves` };
    changes.push({ key, to: values[0]!, from: have[0]?.value ?? null });
  }
  // The rest of the query must hold on the card as the patch leaves it (and a patch makes it updated now).
  const after = applyChanges(props, changes);
  const missing = unmet(q, { properties: after, createdAt: now.createdAt, updatedAt: Date.now() });
  if (missing.length) {
    if (listed) return { kind: "already" };
    const { term, ok } = missing[0]!;
    const what = has(after, term);
    return { kind: "refused", reason: ok === undefined
      ? `${lane.name} needs ${showExpr(term, true)}, which the door can't check for this card`
      : `${lane.name} needs ${showExpr(term, true)}${what ? ` and the card has ${what}` : ""}; a move sets only the plain clauses beside it` };
  }
  return changes.length && !listed ? { kind: "patch", changes } : { kind: "already" };
}

/** Properties after a plan's changes: each changed key's one value replaced, or appended. */
export function applyChanges(props: Prop[], changes: Change[]): Prop[] {
  const out = props.map(p => ({ ...p }));
  for (const c of changes) {
    const at = out.findIndex(p => p.key === c.key);
    if (at >= 0) out[at] = { key: c.key, value: c.to }; else out.push({ key: c.key, value: c.to });
  }
  return out;
}

// ── a new card in a lane ─────────────────────────────────────────────────────

export type CreatePlan =
  | {
      kind: "create";
      /** The properties the card is born with: the lane's plain clauses, plus its [create::key=value] default. */
      props: Prop[];
      /** Terms the born-with properties don't meet (an OR group, a presence clause): the text must, or it's refused on save. */
      needs: QueryExpr[];
    }
  | { kind: "refused"; reason: string };

/** A lane's `[create::key=value]` default, when it has one. Throws the reason when it can't be read. */
export function createDefault(def: Msg | undefined): Prop | null {
  const raw = def?.properties?.filter(p => p.key === "create") ?? (def?.props.create !== undefined ? [{ key: "create", value: def.props.create }] : []);
  if (!raw.length) return null;
  if (raw.length > 1) throw new Error("it has more than one create:: default");
  const { expr } = parseQuery(raw[0]!.value);
  if (expr.kind !== "property" || expr.value === undefined) throw new Error(`its create:: default must be one key=value, not ${raw[0]!.value}`);
  return { key: expr.key, value: expr.value };
}

/** What a new card in `lane` is born with, or why the lane can't define one. Pure. */
export function planCreate(lane: LaneLike): CreatePlan {
  const w = writable(lane);
  if ("refused" in w) return { kind: "refused", reason: w.refused };
  const { q } = w;
  let dflt: Prop | null;
  try { dflt = createDefault(lane.def); } catch (e) { return { kind: "refused", reason: `${lane.name}'s ${(e as Error).message}` }; }
  const props: Prop[] = [];
  const needs: QueryExpr[] = [];
  const byKey = new Map<string, PropertyFilter[]>();
  for (const f of q.plain) byKey.set(f.key, [...(byKey.get(f.key) ?? []), f]);
  for (const [key, clauses] of byKey) {
    const values = [...new Map(clauses.filter(c => c.value !== undefined).map(c => [c.value!.toLowerCase(), c.value!])).values()];
    if (values.length > 1) return { kind: "refused", reason: `${lane.name} asks for ${key} to be ${values.join(" and ")} at once; a card has one value` };
    if (values.length === 1) props.push({ key, value: values[0]! });
    else if (dflt?.key !== key) needs.push({ kind: "property", key });      // a presence clause: the text has to say which value
  }
  if (dflt) {
    const same = props.find(p => p.key === dflt!.key);
    if (same && same.value.toLowerCase() !== dflt.value.toLowerCase())
      return { kind: "refused", reason: `${lane.name}'s create:: default ${dflt.key}=${dflt.value} contradicts its query (${dflt.key}=${same.value})` };
    if (!same) props.push(dflt);
  }
  const at = Date.now();
  const missing = unmet(q, { properties: props, createdAt: at, updatedAt: at });
  if (missing.some(m => m.ok === false && !keysOf(m.term).length))
    return { kind: "refused", reason: `${lane.name} needs ${showExpr(missing.find(m => !keysOf(m.term).length)!.term, true)}, which a new card doesn't meet` };
  needs.push(...missing.map(m => m.term));
  return { kind: "create", props, needs };
}

/**
 * Why a new card with `props` (as the service would store its text) isn't one `lane` lists, or null
 * when it is. Checked on save, after the person or agent typed the text.
 */
export function createMisses(lane: LaneLike, props: Prop[]): string | null {
  const w = writable(lane);
  if ("refused" in w) return w.refused;
  const at = Date.now();
  const s = { properties: props, createdAt: at, updatedAt: at };
  for (const f of w.q.plain) {
    const have = props.filter(p => p.key === f.key);
    if (f.value !== undefined && have.length && !have.some(p => p.value.toLowerCase() === f.value!.toLowerCase()))
      return `the text sets ${f.key}::${have.map(p => p.value).join(",")}, but ${lane.name} needs ${f.key}=${f.value}`;
  }
  if (holds(w.q.expr, s) === true) return null;
  const miss = unmet(w.q, s)[0];
  const plainMiss = w.q.plain.find(f => !props.some(p => p.key === f.key && (f.value === undefined || p.value.toLowerCase() === f.value.toLowerCase())));
  const term = miss?.term ?? (plainMiss ? { kind: "property" as const, ...plainMiss } : w.q.expr);
  const what = has(props, term);
  return `${lane.name} needs ${showExpr(term, true)}${what ? ` and the card would have ${what}` : ""}`;
}

/** The patch in words, for flashes and the move picker: `stage queued -> done · track + door`. */
export const describeChanges = (changes: Change[]) =>
  changes.map(c => (c.from === null ? `${c.key} + ${c.to}` : `${c.key} ${c.from} -> ${c.to}`)).join(" · ");

/** A move the door refused before writing, or that the service's revision check refused. */
export class MoveRefused extends Error {
  constructor(message: string, readonly stale = false) { super(message); this.name = "MoveRefused"; }
}

/**
 * Apply a plan with one `properties.patch`, checked against the revision the card was shown at.
 * Token ordinals come from the service at that same revision; if the card moved on in between,
 * nothing is written. Returns the card as the service now has it.
 */
export async function applyMove(board: SocketBoard, card: Msg, changes: Change[], actor: Actor = USER): Promise<Msg> {
  const expected = card.revision;
  if (expected === undefined) throw new MoveRefused("the outline didn't say which revision this card is at");
  const operations: PropertyPatch[] = [];
  for (const c of changes) {
    const { revision, tokens } = await board.propertyTokens(card.id, c.key);
    if (revision !== expected) throw new MoveRefused(`the card changed since the board loaded (revision ${expected} -> ${revision}) · not moved`, true);
    const own = tokens.filter(t => t.scope === "block");
    if (own.length > 1) throw new MoveRefused(`the card has ${own.length} ${c.key}:: values; the door won't guess which one moves`);
    const t = own[0];
    if ((t?.value.toLowerCase() ?? null) !== (c.from?.toLowerCase() ?? null)) throw new MoveRefused(`the card's ${c.key}:: isn't what the board showed · not moved`, true);
    operations.push(t ? { op: "replace", ordinal: t.ordinal, value: c.to } : { op: "append", key: c.key, value: c.to });
  }
  try {
    return await board.patchProperties(card.id, expected, operations, actor);
  } catch (e) {
    if (e instanceof EditConflict) throw new MoveRefused("the card changed elsewhere before the move landed · not moved", true);
    throw e;
  }
}

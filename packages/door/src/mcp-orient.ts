// Orienting from an outline (PIE-674): what an agent arriving cold needs from outline_query, outline_read and
// outline_find is a few KB of titles, with a body paid for only when it is new. Four moves, none of them a second
// reader (the service sorts, scopes and answers the query; this file shapes what comes back):
//   projection  `fields` picks a row's columns; a projected row never carries the body (outline_read does).
//   folding     deliveries, comment threads and proposals collapse into the note they belong to, with a count.
//   dedupe      within one response a body goes once (`see`); a derived block points at its target (`target: id@rev`)
//               instead of copying it; and `seen: ["id@rev"]` turns a block the caller holds at that revision into a stub.
//   layer 4     (a content hash across outlines and mirrors) is a follow-up: see the README's orient recipe.
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import type { DraftPatchSpan } from "@ep0ch/outline-core/draft-patch-compare";
import type { IndexBlock } from "./socket";
import type { NotesBoard } from "./notes-cli";

// ── sort ─────────────────────────────────────────────────────────────────────

/** `updated desc`, `-created`, `due`: the service's sort (created, updated or a property key) and its direction. */
export function parseSort(v: unknown): { field: string; direction: "asc" | "desc" } | { error: string } {
  const bad = (got: unknown) => ({ error: `sort is a field and a direction, "updated desc": the field is created, updated or a property key, the direction asc (the default) or desc; got ${JSON.stringify(got)}.` });
  if (typeof v !== "string") return bad(v);
  const m = /^\s*(-?)([A-Za-z][A-Za-z0-9_.-]*)(?:[\s:]+(asc|desc))?\s*$/i.exec(v);
  if (!m || (m[1] && m[3])) return bad(v);
  return { field: m[2]!, direction: ((m[3] ?? (m[1] ? "desc" : "asc")).toLowerCase()) as "asc" | "desc" };
}

// ── projection ───────────────────────────────────────────────────────────────

/** The columns every client can name; any other name is a property key. */
export const FIELD_NAMES = ["id", "uri", "title", "revision", "updated", "created", "author", "actor", "parent", "path"] as const;
const PROPERTY_KEY = /^[A-Za-z][A-Za-z0-9_.-]*$/;

/** `fields`: "id,title,updated" or a list. id and revision are always in a row (the pair `seen` is made of). */
export function parseFields(v: unknown): { fields: string[] } | { error: string } {
  const names = typeof v === "string" ? v.split(",") : Array.isArray(v) && v.every(x => typeof x === "string") ? (v as string[]).flatMap(x => x.split(",")) : null;
  if (!names) return { error: `fields is the columns of a row, "id,title,updated,actor,path" (or a list), plus any property key; got ${JSON.stringify(v)}.` };
  const fields = [...new Set(names.map(n => n.trim()).filter(Boolean))];
  if (!fields.length) return { error: `fields names at least one column: ${FIELD_NAMES.join(", ")}, or a property key.` };
  for (const f of fields) {
    if (["body", "text", "header", "links", "backlinks", "children", "resources", "tasks", "fields", "properties"].includes(f)) {
      return { error: `fields never carries ${f}: a projected row is titles and facts, and a body is read on demand with outline_read (ref: the row's id).` };
    }
    if (!PROPERTY_KEY.test(f)) return { error: `${JSON.stringify(f)} isn't a column: ${FIELD_NAMES.join(", ")}, or a property key (a letter, then letters, digits, _ . or -).` };
  }
  return { fields };
}

export interface RowContext { uri: string; path?: string }

/** One row of a projected answer: id and revision always, then the fields in the order asked. Never the body. */
export function projectRecord(r: BlockRecord, fields: readonly string[], ctx: RowContext): Record<string, unknown> {
  const row: Record<string, unknown> = { id: r.id, revision: r.revision };
  for (const f of fields) {
    switch (f) {
      case "id": case "revision": break;
      case "uri": row.uri = ctx.uri; break;
      case "title": row.title = r.title; break;
      case "updated": row.updated = r.updated; break;
      case "created": row.created = r.created; break;
      case "author": row.author = r.author; break;
      case "actor": if (r.actor) row.actor = r.actor; break;
      case "parent": row.parent = r.parent; break;
      case "path": row.path = ctx.path ?? ""; break;
      default: {
        const p = r.properties.find(x => x.key === f);
        if (p) row[f] = p.values.length === 1 ? p.values[0] : p.values;
      }
    }
  }
  return row;
}

// ── folding ──────────────────────────────────────────────────────────────────

export type DerivedKind = "proposal" | "comment" | "delivery";
const KIND_OF_TYPE: Record<string, DerivedKind> = { "draft-proposal": "proposal", annotation: "comment", "annotation-reply": "comment", delivery: "delivery" };
/** What a block's `type` makes it, when it only exists because of another block: a proposal, a comment or a delivery. */
export const derivedKindOf = (type: string | undefined): DerivedKind | undefined => (type && Object.hasOwn(KIND_OF_TYPE, type) ? KIND_OF_TYPE[type] : undefined);
export const typeOf = (r: Pick<BlockRecord, "properties">) => r.properties.find(p => p.key === "type")?.values[0];

export interface Changes { count: number; proposals: number; comments: number; deliveries: number; summary: string; ids: string[] }
export interface FoldedRow { id: string; changes?: Changes }
const IDS_SHOWN = 12;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "3 changes (1 proposal, 2 comments)". */
export function changesSummary(c: Pick<Changes, "count" | "proposals" | "comments" | "deliveries">): string {
  const parts = [c.proposals && plural(c.proposals, "proposal"), c.comments && plural(c.comments, "comment"), c.deliveries && plural(c.deliveries, "delivery", "deliveries")].filter(Boolean);
  return `${plural(c.count, "change")} (${parts.join(", ")})`;
}

/**
 * The ids in the service's order with each derived block folded into the note it hangs from (its nearest ancestor that
 * isn't itself derived, so a reply folds into the note its thread is on). The note takes the place of its first
 * derived block when it isn't among the ids. A derived block whose note the index doesn't hold stays a row of its own.
 */
export function foldIds(ids: readonly string[], index: readonly IndexBlock[]): FoldedRow[] {
  const by = new Map(index.map(b => [b.id, b]));
  const kindOf = (id: string) => derivedKindOf(by.get(id)?.props.type);
  const targetOf = (id: string): string | null => {
    let at = by.get(id)?.parentId ?? null;
    for (let hops = 0; at && hops < 24; hops++) {
      if (!kindOf(at)) return by.has(at) ? at : null;
      at = by.get(at)?.parentId ?? null;
    }
    return null;
  };
  const rows = new Map<string, FoldedRow & { counts: { proposal: number; comment: number; delivery: number }; all: string[] }>();
  const row = (id: string) => rows.get(id) ?? (rows.set(id, { id, counts: { proposal: 0, comment: 0, delivery: 0 }, all: [] }), rows.get(id)!);
  for (const id of ids) {
    const kind = kindOf(id), target = kind ? targetOf(id) : null;
    if (kind && target) { const r = row(target); r.counts[kind]++; r.all.push(id); }
    else row(id);
  }
  return [...rows.values()].map(({ id, counts, all }) => {
    if (!all.length) return { id };
    const c = { count: all.length, proposals: counts.proposal, comments: counts.comment, deliveries: counts.delivery };
    return { id, changes: { ...c, summary: changesSummary(c), ids: all.slice(0, IDS_SHOWN) } };
  });
}

// ── dedupe ───────────────────────────────────────────────────────────────────

/** `seen`: the "id@revision" pairs the caller already holds. A block at one of them comes back as a stub. */
export function parseSeen(v: unknown): Set<string> | { error: string } {
  const bad = { error: `seen is a list of "id@revision" strings, the blocks you already hold at that revision (the id and revision of an earlier answer, up to ${SEEN_MAX}); got ${JSON.stringify(v)?.slice(0, 120)}.` };
  if (!Array.isArray(v) || v.length > SEEN_MAX) return bad;
  const out = new Set<string>();
  for (const e of v) {
    const m = typeof e === "string" ? /^(.+)@(\d+)$/.exec(e.trim()) : null;
    if (!m) return bad;
    out.add(`${m[1]}@${Number(m[2])}`);
  }
  return out;
}
export const SEEN_MAX = 1000;
export const pairOf = (id: string, revision: number) => `${id}@${revision}`;

/**
 * One response's memory (a batch is one response): the bodies it has sent, so a block that comes up again is
 * `{id, revision, see}`, pointing at where its body already is. `rpc` is the request being answered.
 */
export class ResponseScope {
  rpc: string | number | null = null;
  private sent = new Map<string, string>();
  /** Where this block's body already went in this response, or null (and now it is: the caller sends it at `where`). */
  claim(outline: string, id: string, revision: number, form: "full" | "pointer", where: string): string | null {
    // The outline is in the key (an imported or mirrored copy can share id@revision), and so is the form: a pointer is not the stored body.
    const key = `${outline}/${pairOf(id, revision)}/${form}`, first = this.sent.get(key);
    if (first) return first;
    this.sent.set(key, `${this.rpc ?? "-"}:${where}`);
    return null;
  }
}

export const unchangedStub = (id: string, revision: number, uri?: string) => ({ id, revision, ...(uri ? { uri } : {}), unchanged: true });
export const seeStub = (id: string, revision: number, see: string, uri?: string) => ({ id, revision, ...(uri ? { uri } : {}), see });

/** The proposal a block holds (the outliner's draft-patch.ts, the one that wrote it), loaded by a name the door's type check doesn't follow, as mcp-writes loads the agent tools. */
interface ProposalPatch { edits: { blockId: string; revision: number; patches: DraftPatchSpan[] }[]; reason: string; actor?: { author?: string; actorId?: string } }
const DRAFT_PATCH_MODULE = "@ep0ch/outliner/draft-patch";
type DraftPatchModule = { parseProposal(text: string): ProposalPatch | null };
let draftPatch: Promise<DraftPatchModule> | null = null;
const loadDraftPatch = (): Promise<DraftPatchModule> => draftPatch ??= import(DRAFT_PATCH_MODULE) as Promise<DraftPatchModule>;

// ── derived blocks point at their target ─────────────────────────────────────

const prop = (r: Pick<BlockRecord, "properties">, key: string) => r.properties.find(p => p.key === key)?.values[0];
const who = (r: BlockRecord) => r.actor ? `@${r.actor}` : r.author;

/** The target revisions a pointer names, read once (a body is not sent from them). */
async function revisionsOf(board: NotesBoard, ids: string[]): Promise<Map<string, number>> {
  const have = new Map<string, number>();
  const want = [...new Set(ids)].slice(0, 8);
  if (want.length) for (const r of (await board.records(want).catch(() => ({ records: [] as BlockRecord[] }))).records) have.set(r.id, r.revision);
  return have;
}
const ref = (id: string, revs: Map<string, number>) => revs.has(id) ? pairOf(id, revs.get(id)!) : id;

/**
 * A proposal or a comment as a pointer: a proposal is its diff and the id@revision of the note it changes, a comment its
 * own words and the span of the note it is about. Neither copies the note. Null for any other block, and for a
 * proposal whose patch can't be read (it is then sent as it is stored).
 */
export async function derivedPointer(board: NotesBoard, r: BlockRecord): Promise<Record<string, unknown> | null> {
  const kind = derivedKindOf(typeOf(r));
  if (kind === "proposal") {
    const p = (await loadDraftPatch()).parseProposal(r.text);
    if (!p) return null;
    const revs = await revisionsOf(board, p.edits.map(e => e.blockId));
    // The diff names the revision it was proposed against; `now` says where a target has moved on since.
    const moved = [...new Set(p.edits.filter(e => revs.has(e.blockId) && revs.get(e.blockId) !== e.revision).map(e => ref(e.blockId, revs)))];
    return {
      kind: "proposal", id: r.id, revision: r.revision, status: prop(r, "proposal-status") ?? "open",
      ...(prop(r, "proposal-applies") === "no" ? { applies: false } : {}),
      proposedBy: p.actor?.actorId ? `@${p.actor.actorId}` : who(r), reason: p.reason, changes: p.edits.reduce((n, e) => n + e.patches.length, 0),
      diff: p.edits.flatMap(e => e.patches.map(s => ({ target: pairOf(e.blockId, e.revision), observed: s.observed, replacement: s.replacement }))),
      ...(moved.length ? { now: moved } : {}),
    };
  }
  if (kind === "comment" && r.parent) {
    // The note a comment is about: the nearest ancestor that isn't itself a comment (a reply hangs from its thread).
    let owner: string | null = r.parent;
    for (let hops = 0; owner && hops < 6; hops++) {
      const up: BlockRecord | undefined = (await board.records([owner]).catch(() => ({ records: [] as BlockRecord[] }))).records[0];
      if (!up || derivedKindOf(typeOf(up)) !== "comment") break;
      owner = up.parent;
    }
    if (!owner) return null;
    const revs = await revisionsOf(board, [owner]);
    const threads = await board.comments(owner).catch(() => []);
    const thread = threads.find(t => t.id === r.id), reply = thread ? undefined : threads.find(t => t.replies.some(x => x.id === r.id));
    const on = thread ?? reply;
    // The comment's own words: not the "Comment on “…”" heading (a quote of the note) nor its property line.
    const chips = /^\s*(\[[A-Za-z][\w.-]*::[^\]]*\]\s*)+$/;
    const body = r.body.split("\n").filter((line, i) => !(i === 0 && line.startsWith("Comment on ")) && !chips.test(line)).join("\n").trim();
    return {
      kind: "comment", id: r.id, revision: r.revision, status: prop(r, "annotation-status") ?? "open",
      ...(typeOf(r) === "annotation-reply" ? { reply: true } : {}), author: who(r), at: r.created,
      target: ref(owner, revs), thread: on?.id ?? r.id,
      anchor: on && on.start !== null ? { start: on.start, end: on.end } : null,
      body,
    };
  }
  return null;
}

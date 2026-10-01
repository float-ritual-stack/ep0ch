// Transclusions in read mode, as Detail projects them: `!((id))` shows the target note rendered, in a
// shaded region; `!((id^fragment))` shows just the fragment's slice (a step with its nested content, a
// heading's section, a paragraph); a virtual-branch target shows its results (views.read). Embeds nest to
// the service's bounded depth and stop at a cycle, and each document projects at most 16. Every failure
// says what it is, in the service's words, instead of looking empty. Embeds refresh when any note they
// show changes.
//
// The service owns the rules (pi-herdr-outliner PIE-424, `transclusions.read`): what a fragment covers,
// where a cycle is, how deep embeds go and what each failure is called. The door asks and draws. Against an
// older service (no `transclusions.read`) an embed shows its whole note once, not nested, and says why.
//
// Steps inside an embed are the service's too (PIE-472): each ready projection carries the checklist steps
// in what it shows, so the reader can offer their status controls where they're drawn.
import type { Msg } from "./board";
import { subject } from "./board";
import type { DocEnv } from "./doc";
import { printable, summarySegments, viewSummaryKeys, type Source } from "./props";
import { anyChangeSince, changeClock, changedSince, LINK_OFF, LINK_ON, outlineChanged, type LinkTarget } from "./refs";
import type { ChecklistStep, SocketBoard, TransclusionNode } from "./socket";
import { C, fg, LINK_END, linkTag, pad, RESET } from "./style";
import { readView, type ViewRead } from "./views";

/** Embeds one document projects (the service's `maxPerDocument`, the same as Detail's). */
export const MAX_EMBEDS = 16;

type State =
  | { kind: "loading" }
  // An older service's answers (no transclusions.read): the target read whole, never nested.
  | { kind: "missing" } | { kind: "deleted"; title: string } | { kind: "failed"; error: string }
  | { kind: "fragment-missing" } | { kind: "fragment-duplicate" }
  | { kind: "note"; target: Msg }
  | { kind: "view"; target: Msg; view: ViewRead }
  // The service's projection: the embed and everything nested in it, with each view's results read.
  | { kind: "node"; node: TransclusionNode; views: Map<TransclusionNode, ViewRead> };
/** `deps`: the notes the answer shows (a change to one re-reads it); `volatile`: any change may alter it (a view's results). */
interface Entry { state: State; at: number; asking: boolean; deps: string[]; volatile: boolean }

const cacheBy = new WeakMap<object, Map<string, Entry>>();
const askingBy = new WeakMap<object, number>();
/** Embeds being read again on this connection: a reader keeps the person's `[ ]` on a step inside one meanwhile. */
export const embedsLoading = (board: object) => (askingBy.get(board) ?? 0) > 0;

/**
 * A step this door just changed in note `block`: every kept projection of that note takes its new text,
 * revision and step at once (the redraw that follows re-reads them), so a step inside an embed stays
 * offered, with its new evidence, in the moment between.
 */
export function embedStepChanged(board: object, block: Msg, before: ChecklistStep, after: ChecklistStep) {
  const same = (x: ChecklistStep) => (before.itemId ? x.itemId === before.itemId : x.span.start === before.span.start && x.evidence === before.evidence);
  const visit = (n: TransclusionNode) => {
    if (n.blockId === block.id && n.status === "ready" && n.block) {
      n.block = block; n.revision = block.revision;
      if (n.checklist) n.checklist = n.checklist.map(x => (same(x) ? after : x));
    }
    n.embeds?.forEach(visit);
  };
  for (const e of cacheBy.get(board)?.values() ?? []) if (e.state.kind === "node") visit(e.state.node);
}
/** Everything changed: every embed is read again on the next render (what it showed stays meanwhile). */
export function invalidateEmbeds() { outlineChanged(null); }

/**
 * Stale after a note it shows changes (refs.ts `outlineChanged`), nested ones included. A view's results
 * can change with any block, and a failure is worth asking again after any change.
 */
const stale = (e: Entry) => changedSince(e.at, e.deps) || ((e.volatile || e.state.kind === "failed") && anyChangeSince(e.at));

const refOf = (id: string, fragment?: string) => `${id}${fragment ? `^${fragment}` : ""}`;

// ── asking the service ────────────────────────────────────────────────────────────────────────────────

type Waiter = { resolve: (n: TransclusionNode | null) => void; reject: (e: Error) => void };
const queued = new WeakMap<object, Map<string, Map<string, Waiter[]>>>();

/**
 * An embed as the service projects it, or null when it can't (no `transclusions.read`). The embeds one
 * render asks for in one note go out together, as one `transclusions.read` naming that note (so embedding it
 * again is a cycle).
 */
function readNode(b: SocketBoard, host: string, id: string, fragment?: string): Promise<TransclusionNode | null> {
  let byHost = queued.get(b);
  if (!byHost) { queued.set(b, (byHost = new Map())); setTimeout(() => void flush(b), 0); }
  let q = byHost.get(host);
  if (!q) byHost.set(host, (q = new Map()));
  const k = refOf(id, fragment);
  const waiting = q.get(k) ?? [];
  q.set(k, waiting);
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

async function flush(b: SocketBoard) {
  const byHost = queued.get(b);
  queued.delete(b);
  for (const [host, q] of byHost ?? []) {
    const keys = [...q.keys()];
    for (let from = 0; from < keys.length; from += 64) {
      // The service takes 64 targets at a time.
      const part = keys.slice(from, from + 64);
      const targets = part.map(k => { const [blockId, fragmentId] = k.split("^"); return { blockId: blockId!, ...(fragmentId ? { fragmentId } : {}) }; });
      try {
        const r = await b.readTransclusions(targets, host || undefined);
        part.forEach((k, i) => q.get(k)!.forEach(w => w.resolve(r ? r.results[i] ?? null : null)));
      } catch (e) {
        for (const k of part) q.get(k)!.forEach(w => w.reject(e as Error));
      }
    }
  }
}

/** The notes a projection shows or names, and whether a view's results are in it. */
function depsOf(n: TransclusionNode, out: { ids: Set<string>; volatile: boolean } = { ids: new Set(), volatile: false }) {
  out.ids.add(n.blockId);
  if (n.kind === "view") out.volatile = true;
  for (const e of n.embeds ?? []) depsOf(e, out);
  return out;
}

async function viewsIn(b: SocketBoard, n: TransclusionNode, out = new Map<TransclusionNode, ViewRead>()) {
  if (n.status === "ready" && n.kind === "view" && n.block) out.set(n, await readView(b, n.block));
  for (const e of n.embeds ?? []) await viewsIn(b, e, out);
  return out;
}

async function project(b: SocketBoard, host: string, id: string, fragment?: string): Promise<{ state: State; deps: string[]; volatile: boolean }> {
  if (b.supports?.("transclusions.read") !== false && typeof b.readTransclusions === "function") {
    let node: TransclusionNode | null;
    try { node = await readNode(b, host, id, fragment); } catch (e) { return { state: { kind: "failed", error: (e as Error).message }, deps: [id], volatile: false }; }
    if (node) {
      const d = depsOf(node);
      return { state: { kind: "node", node, views: await viewsIn(b, node) }, deps: [...d.ids], volatile: d.volatile };
    }
  }
  return { state: await legacy(b, id, fragment), deps: [id], volatile: false };
}

// ── an older service: one read per target, the whole note, never nested ──────────────────────────────

type BlockWaiter = { resolve: (m: Msg | null) => void; reject: (e: Error) => void };
const blockQueue = new WeakMap<object, Map<string, BlockWaiter[]>>();
/**
 * An embed's target, whole. The targets one render asks for go out together as one `blocks.read`
 * (PIE-400); a trashed one is read on its own for its title, and a service without `blocks.read` gets
 * one read per target.
 */
function readTarget(b: SocketBoard, id: string): Promise<Msg | null> {
  if (typeof b.readBlocks !== "function") return b.read(id);
  let q = blockQueue.get(b);
  if (!q) { blockQueue.set(b, (q = new Map())); setTimeout(() => void flushBlocks(b), 0); }
  const waiting = q.get(id) ?? [];
  q.set(id, waiting);
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

async function flushBlocks(b: SocketBoard) {
  const q = blockQueue.get(b);
  blockQueue.delete(b);
  if (!q) return;
  const settle = (id: string, p: Promise<Msg | null>) => p.then(m => q.get(id)!.forEach(w => w.resolve(m)), (e: Error) => q.get(id)!.forEach(w => w.reject(e)));
  let got: Awaited<ReturnType<SocketBoard["readBlocks"]>>;
  try { got = await b.readBlocks([...q.keys()]); } catch (e) { for (const id of q.keys()) settle(id, Promise.reject(e)); return; }
  for (const id of q.keys()) {
    const found = got?.blocks.find(m => m.id === id);
    const gone = got?.unavailable.find(u => u.id === id);
    settle(id, found ? Promise.resolve(found) : gone?.status === "missing" ? Promise.resolve(null) : b.read(id));
  }
}

async function legacy(b: SocketBoard, id: string, fragment?: string): Promise<State> {
  let target: Msg | null;
  try { target = await readTarget(b, id); } catch (e) { return { kind: "failed", error: (e as Error).message }; }
  if (!target) return { kind: "missing" };
  if (target.deleted) return { kind: "deleted", title: subject(target) };
  if (fragment) {
    const [r] = await b.resolveReferences(`((${id}^${fragment}))`);
    if (r?.status === "stale") return { kind: "fragment-missing" };
    if (r?.status === "duplicate") return { kind: "fragment-duplicate" };
  }
  if ((target.props.type ?? "").toLowerCase() === "virtual-branch") return { kind: "view", target, view: await readView(b, target) };
  return { kind: "note", target };
}

/**
 * The last projection of `!((id^fragment))` in note `host`, refreshed in the background when a note it
 * shows has changed.
 */
export function embedState(id: string, fragment: string | undefined, src: Source | null | undefined, host = ""): State {
  if (!src) return { kind: "failed", error: "no outline connection" };
  let cache = cacheBy.get(src.board);
  if (!cache) cacheBy.set(src.board, (cache = new Map()));
  const k = `${host}|${refOf(id, fragment)}`, c = cache;
  const hit = cache.get(k);
  if (hit && (hit.asking || !stale(hit))) return hit.state;
  const at = changeClock();
  cache.set(k, { state: hit?.state ?? { kind: "loading" }, at, asking: true, deps: hit?.deps ?? [id], volatile: hit?.volatile ?? false });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  const b = src.board;
  askingBy.set(b, (askingBy.get(b) ?? 0) + 1);
  const done = () => askingBy.set(b, Math.max(0, (askingBy.get(b) ?? 1) - 1));
  Promise.resolve().then(() => project(src.board, host, id, fragment)).then(
    ({ state, deps, volatile }) => { done(); c.set(k, { state, at, asking: false, deps, volatile }); src.redraw(); },
    (e: Error) => { done(); c.set(k, { state: { kind: "failed", error: e.message }, at, asking: false, deps: [id], volatile: false }); src.redraw(); },
  );
  return hit?.state ?? { kind: "loading" };
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────────

/** A shaded region's background (a dim navy under the default text), and the gutter that marks it. */
export const SHADE = "\x1b[48;2;18;24;44m";
// A quiet bar: embedding is ordinary here, so an embed is set apart, not announced.
const GUTTER = fg(C.dark) + "▌";

/** One shaded line: the background survives the resets inside `s`, and fills the whole width. */
export function shade(s: string, w: number): string {
  return SHADE + GUTTER + pad(s, Math.max(0, w - 1)).split(RESET).join(RESET + SHADE) + RESET;
}

/**
 * How the reader draws a note's body inside an embed (src/surface/note.ts): `part` null for the whole
 * readable note, else a fragment's slice (its text, line for line from note line `startLine`). `env.embed`
 * draws the embeds inside it; `env.task` its step boxes, told the note line (from 0, the subject) each is on.
 */
export type EmbedBody = (target: Msg, part: { text: string; startLine: number } | null, width: number, env: { embed: NonNullable<DocEnv["embed"]>; task: (noteLine: number, box: string) => string | null }) => string[];

/**
 * The region for the `n`th embed (from 0) of a document, `w` wide, in note `host`. `body` draws a note's
 * body the way the reader does. With a sink, the title, a view's results, the links in the embedded text
 * and its step boxes are tagged, so `[ ]` stops on them and a click acts on them (PIE-415, PIE-441, PIE-472).
 */
export function embedRegion(id: string, fragment: string | undefined, n: number, w: number, src: Source | null | undefined, body: EmbedBody, sink?: LinkTarget[], host = ""): string[] {
  const S = (line: string) => shade(line, w);
  if (n >= MAX_EMBEDS) return [S(fg(C.lred) + `${shortRef(id, fragment)} · EMBED LIMIT · maximum ${MAX_EMBEDS}` + RESET)];
  const st = embedState(id, fragment, src, host);
  if (st.kind === "node") return nodeRegion(st.node, st.views, w, body, sink);
  return legacyRegion(st, id, fragment, w, body, sink);
}

const shortRef = (id: string, fragment?: string) => `!((${id.length > 12 ? id.slice(0, 8) + "…" : id}${fragment ? `^${fragment}` : ""}))`;

/** Tag `text` as link `to` in `sink` (or leave it as text without one). */
const tagged = (sink: LinkTarget[] | undefined, to: LinkTarget, text: string) => (sink ? linkTag(sink.push(to) - 1) + text + LINK_END : text);

/** An agent's proposal that hasn't been applied (PIE-501): `A`, `X` and its `[apply]` `[dismiss]` controls act on it. */
export const isOpenProposal = (m: Msg) => m.props.type === "draft-proposal" && m.props["proposal-status"] === "open";

/** A proposal's controls, as its embed's source line and an opened proposal's header draw them. */
export const PROPOSAL_OPS = ["apply", "dismiss"] as const;

/** ` [apply] [dismiss]` for proposal `id`, each tagged as its control in `sink` (text without one). */
export function proposalControls(id: string, sink: LinkTarget[] | undefined): string {
  return PROPOSAL_OPS.map(op => " " + fg(C.lcyan) + tagged(sink, { block: id, role: "control", proposal: { id, op } }, `[${op}]`)).join("");
}
const CONTROLS_WIDTH = PROPOSAL_OPS.reduce((n, op) => n + op.length + 3, 0);

/**
 * The embed's source line: a dim, clickable "» note" (a view's "≡ view"). Problems keep their loud colour.
 * An open proposal's line ends in its `[apply] [dismiss]` controls, the title cut to leave them room.
 */
function heading(id: string, fragment: string | undefined, text: string, w: number, sink: LinkTarget[] | undefined, colour: number = C.dark, proposal = false) {
  const loud = colour !== C.dark;
  const room = Math.max(1, w - 1 - CONTROLS_WIDTH);
  const shown = proposal && [...text].length > room ? [...text].slice(0, Math.max(0, room - 1)).join("") + "…" : text;
  const to: LinkTarget = { block: id, ...(fragment ? { fragment } : {}), role: "embed", ...(proposal ? { proposal: { id } } : {}) };
  return shade(fg(colour) + (loud ? "\x1b[1m" : "") + tagged(sink, to, shown) + (loud ? "\x1b[22m" : "") + (proposal ? proposalControls(id, sink) : "") + RESET, w);
}

/** A virtual branch's results, as Detail lists them. */
function viewRegion(target: Msg, v: ViewRead, w: number, sink: LinkTarget[] | undefined): string[] {
  const S = (line: string) => shade(line, w), title = printable(subject(target));
  const head = (text: string, colour?: number) => heading(target.id, undefined, text, w, sink, colour);
  if (v.status === "invalid") return [head(`≡ ${title} · CONFIG ERROR`, C.lred), ...v.errors.map(e => S(fg(C.lred) + "  " + printable(e) + RESET))];
  if (v.status !== "ready") return [head(`≡ ${title} · QUERY FAILED`, C.lred), ...(v.errors.length ? v.errors : [v.status]).map(e => S(fg(C.lred) + "  " + printable(e) + RESET))];
  if (!v.items.length) return [head(`≡ ${title} · EMPTY`)];
  const count = `${v.items.length} result${v.items.length === 1 ? "" : "s"}${v.truncated ? ` · TRUNCATED at ${v.limit}` : ""}`;
  const keys = viewSummaryKeys(target) ?? [];
  return [head(`≡ ${title} · ${count}`), ...v.items.map(m => {
    const summary = summarySegments(m.properties ?? [], keys).map(s => s.plain).join(" · ");
    return S(fg(C.lcyan) + "  ∙ " + fg(C.white) + tagged(sink, { block: m.id, role: "row" }, printable(subject(m))) + (summary ? fg(C.brown) + " · " + summary : "") + RESET);
  })];
}

/**
 * One projected embed and everything nested in it. A ready note or fragment is drawn by the reader's own
 * body renderer, a nested embed inside it by this again (so it sits one gutter further in), and each step
 * the service found in what's shown gets its status control.
 */
function nodeRegion(node: TransclusionNode, views: Map<TransclusionNode, ViewRead>, w: number, body: EmbedBody, sink: LinkTarget[] | undefined): string[] {
  const S = (line: string) => shade(line, w);
  const ref = shortRef(node.blockId, node.fragmentId);
  if (node.status !== "ready" || !node.block) {
    // Nesting limits are the note working as meant; failures are red.
    const calm = node.status === "cycle" || node.status === "depth-limit" || node.status === "limit" || node.status === "budget" || node.status === "too-large";
    return [S(fg(calm ? C.yellow : C.lred) + `${ref} · ${printable(node.message ?? node.status).slice(0, 240)}` + RESET)];
  }
  const target = node.block;
  if (node.kind === "view") {
    const v = views.get(node);
    return v ? viewRegion(target, v, w, sink) : [S(fg(C.dark) + `${ref} · reading…` + RESET)];
  }
  const title = printable(node.title ?? subject(target));
  const out = [heading(node.blockId, node.fragmentId, node.fragmentId ? `» ${title} ^${node.fragmentId}` : `» ${title}`, w, sink, C.dark, !node.fragmentId && isOpenProposal(target))];
  // The embeds inside, matched to the service's list by what they name, in order.
  const children = new Map<string, TransclusionNode[]>();
  for (const e of node.embeds ?? []) { const k = refOf(e.blockId, e.fragmentId); children.set(k, [...(children.get(k) ?? []), e]); }
  const embed = (cid: string, cfrag: string | undefined, n: number, width: number) => {
    // The service stops listing a document's embeds at the one past the limit; the rest are the limit too.
    if (n >= MAX_EMBEDS) return [shade(fg(C.yellow) + `${shortRef(cid, cfrag)} · EMBED LIMIT · maximum ${MAX_EMBEDS}` + RESET, width)];
    const child = children.get(refOf(cid, cfrag))?.shift();
    return child ? nodeRegion(child, views, width, body, sink) : [shade(fg(C.dark) + `${shortRef(cid, cfrag)} · not projected here` + RESET, width)];
  };
  const task = (noteLine: number, box: string) => {
    const step = node.checklist?.find(s => s.span.startLine === noteLine);
    if (!step || !sink || node.revision === undefined) return null;
    return LINK_ON + tagged(sink, { role: "task", block: node.blockId, task: { block: node.blockId, revision: node.revision, step, via: ref } }, box) + LINK_OFF;
  };
  const part = node.fragment ? { text: node.fragment.text, startLine: node.fragment.startLine } : null;
  for (const l of body(target, part, Math.max(4, w - 2), { embed, task })) out.push(S(" " + l));
  return out;
}

/** An older service's projection: the whole note, its own embeds left as they are. */
function legacyRegion(st: Exclude<State, { kind: "node" }>, id: string, fragment: string | undefined, w: number, body: EmbedBody, sink: LinkTarget[] | undefined): string[] {
  const ref = shortRef(id, fragment);
  const S = (line: string) => shade(line, w);
  const fail = (what: string) => [S(fg(C.lred) + `${ref} · ${what}` + RESET)];
  switch (st.kind) {
    case "loading": return [S(fg(C.dark) + `${ref} · reading…` + RESET)];
    case "missing": return fail("MISSING TARGET");
    case "deleted": return fail(`IN TRASH · ${printable(st.title)}`);
    case "failed": return fail(`TARGET FAILED · ${printable(st.error).slice(0, 200)}`);
    case "fragment-missing": return fail("MISSING FRAGMENT");
    case "fragment-duplicate": return fail("DUPLICATE FRAGMENT");
    case "view": return viewRegion(st.target, st.view, w, sink);
    case "note": {
      const title = printable(subject(st.target));
      const out = [heading(id, fragment, fragment ? `» ${title} ^${fragment}` : `» ${title}`, w, sink, C.dark, !fragment && isOpenProposal(st.target))];
      if (fragment) out.push(S(fg(C.dark) + "the whole note: this service can't slice fragments" + RESET));
      const none = (cid: string, cfrag: string | undefined, _n: number, width: number) => [shade(fg(C.dark) + `${shortRef(cid, cfrag)} · not nested with this service` + RESET, width)];
      for (const l of body(st.target, null, Math.max(4, w - 2), { embed: none, task: () => null })) out.push(S(" " + l));
      return out;
    }
  }
}

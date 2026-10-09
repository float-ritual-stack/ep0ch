// Transclusions in read mode, as Detail projects them: `!((id))` shows the target note rendered, in a
// shaded region; `!((id^fragment))` shows just the fragment's slice (a step with its nested content, a
// heading's section, a paragraph); a virtual-branch target shows its results (views.read). Embeds nest to
// the service's bounded depth and stop at a cycle, and each document projects at most 16. Every failure
// says what it is, in the service's words, instead of looking empty. Embeds refresh when any note they
// show changes.
//
// The service owns the rules (pi-herdr-outliner PIE-424, `transclusions.read`): what a fragment covers,
// where a cycle is, how deep embeds go and what each failure is called. The door asks and draws.
//
// Steps inside an embed are the service's too (PIE-472): each ready projection carries the checklist steps
// in what it shows, so the reader can offer their status controls where they're drawn.
import type { Msg } from "./board";
import { subject } from "./board";
import type { DocEnv } from "./doc";
import { printable, summarySegments, viewSummaryKeys, type Source } from "./props";
import { anyChangeSince, changeClock, changedSince, LINK_OFF, LINK_ON, MISSING_MARK, outlineChanged, shortId, type LinkTarget } from "./refs";
import type { ChecklistStep, ProposalsBeside, SocketBoard, TransclusionNode } from "./socket";
import { BOLD, C, ellipsize, fg, LINK_END, linkTag, pad, RESET, tint, UNBOLD } from "./style";
import { themed } from "./theme";
import { readView, type ViewRead } from "./views";

/** Embeds one document projects (the service's `maxPerDocument`, the same as Detail's). */
export const MAX_EMBEDS = 16;

type State =
  | { kind: "loading" } | { kind: "failed"; error: string }
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
 * An embed as the service projects it. The embeds one render asks for in one note go out together, as one `transclusions.read` naming that note (so embedding it
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
        part.forEach((k, i) => q.get(k)!.forEach(w => w.resolve(r.results[i] ?? null)));
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
  let node: TransclusionNode | null;
  try { node = await readNode(b, host, id, fragment); } catch (e) { return { state: { kind: "failed", error: (e as Error).message }, deps: [id], volatile: false }; }
  if (!node) return { state: { kind: "failed", error: "the service projected nothing for it" }, deps: [id], volatile: false };
  const d = depsOf(node);
  return { state: { kind: "node", node, views: await viewsIn(b, node) }, deps: [...d.ids], volatile: d.volatile };
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

// ── proposals beside a note (PIE-725) ─────────────────────────────────────────────────────────────────

/** One open proposal beside a note: the note line it is drawn after. */
export type ProposalBeside = ProposalsBeside["proposals"][number];
interface BesideEntry { list: readonly ProposalBeside[]; at: number; asking: boolean }
const besideBy = new WeakMap<object, Map<string, BesideEntry>>();

/**
 * The open proposals beside note `m` (a patch that didn't apply sits beside its note, never in its text), from the
 * last answer; asked again in the background when the note, one of them, or what was made under it changes. The
 * reader draws each as an embed of it after its line, where its embed line used to go.
 */
export function proposalsBeside(m: Msg, src: Source | null | undefined): readonly ProposalBeside[] {
  if (!src || m.partial || m.deleted) return [];
  let cache = besideBy.get(src.board);
  if (!cache) besideBy.set(src.board, (cache = new Map()));
  const hit = cache.get(m.id);
  if (hit && (hit.asking || !changedSince(hit.at, [m.id, ...hit.list.map(p => p.id)]))) return hit.list;
  const at = changeClock(), c = cache;
  c.set(m.id, { list: hit?.list ?? [], at, asking: true });
  if (c.size > 200) c.delete(c.keys().next().value!);
  Promise.resolve().then(() => src.board.proposalsBeside(m.id)).then(
    r => { const was = c.get(m.id)?.list ?? []; c.set(m.id, { list: r.proposals, at, asking: false }); if (r.proposals.length || was.length) src.redraw(); },
    () => { c.set(m.id, { list: hit?.list ?? [], at, asking: false }); },
  );
  return hit?.list ?? [];
}

// ── drawing ───────────────────────────────────────────────────────────────────────────────────────────

/** A shaded region's background (a dim navy under the default text), and the gutter that marks it. */
export let SHADE = "";
// A quiet bar: embedding is ordinary here, so an embed is set apart, not announced.
let GUTTER = "";
themed(() => { SHADE = tint("embed"); GUTTER = fg(C.dark) + "▌"; });

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
  if (st.kind === "loading") return [S(fg(C.dark) + `${shortRef(id, fragment)} · reading…` + RESET)];
  return [S(fg(C.lred) + `${shortRef(id, fragment)} · TARGET FAILED · ${printable(st.error).slice(0, 200)}` + RESET)];
}

const shortRef = (id: string, fragment?: string) => `!((${shortId(id)}${fragment ? `^${fragment}` : ""}))`;

/** Tag `text` as link `to` in `sink` (or leave it as text without one). */
const tagged = (sink: LinkTarget[] | undefined, to: LinkTarget, text: string) => (sink ? linkTag(sink.push(to) - 1) + text + LINK_END : text);

/**
 * An agent's proposal still waiting (PIE-501): open (not applied or dismissed), and not in the Trash
 * (dismissing one trashes it). `A`, `X` and its `[apply]` `[dismiss]` controls act on it.
 */
export const isOpenProposal = (m: Msg) => m.props.type === "draft-proposal" && m.props["proposal-status"] === "open" && !m.deleted;

/**
 * Whether "apply anyway" can place it: the service marks one whose passage was already gone when it was
 * proposed `[proposal-applies::no]` (PIE-510), and only dismiss is offered.
 */
export const proposalApplies = (m: Msg) => m.props["proposal-applies"] !== "no";

/** Why `A` is refused on a proposal that can't be applied: said by the action, and by the hint instead of the key. */
export const NOT_APPLICABLE = "the passage it changes was already gone when it was proposed, so it can't be applied; dismiss it (X) and edit the note by hand";

/** A proposal's controls, as its embed's source line and an opened proposal's header draw them. */
export const PROPOSAL_OPS = ["apply", "dismiss"] as const;

/** The controls proposal `m` offers: `[apply] [dismiss]`, or only `[dismiss]` when it can't be applied. */
export const proposalOps = (m: Msg) => PROPOSAL_OPS.filter(op => op !== "apply" || proposalApplies(m));

/** ` [apply] [dismiss]` for proposal `m`, each tagged as its control in `sink` (text without one). */
export function proposalControls(m: Msg, sink: LinkTarget[] | undefined): string {
  return proposalOps(m).map(op => " " + fg(C.lcyan) + tagged(sink, { block: m.id, role: "control", proposal: { id: m.id, op } }, `[${op}]`)).join("");
}
const controlsWidth = (m: Msg) => proposalOps(m).reduce((n, op) => n + op.length + 3, 0);

/**
 * The embed's source line: a dim, clickable "» note" (a view's "≡ view"). Problems keep their loud colour.
 * An open proposal's line ends in its `[apply] [dismiss]` controls, the title cut to leave them room.
 */
function heading(id: string, fragment: string | undefined, text: string, w: number, sink: LinkTarget[] | undefined, colour: number = C.dark, proposal: Msg | null = null) {
  const loud = colour !== C.dark;
  const room = Math.max(1, w - 1 - (proposal ? controlsWidth(proposal) : 0));
  const shown = proposal ? ellipsize(text, room) : text;
  const to: LinkTarget = { block: id, ...(fragment ? { fragment } : {}), role: "embed", ...(proposal ? { proposal: { id } } : {}) };
  return shade(fg(colour) + (loud ? BOLD : "") + tagged(sink, to, shown) + (loud ? UNBOLD : "") + (proposal ? proposalControls(proposal, sink) : "") + RESET, w);
}

/**
 * A view note's own results, under its body in a reader (and so in `ep0ch show`), drawn as an embedded view is:
 * the service's projection of the note (`transclusions.read`, then `views.read`), so the service says whether it is
 * a view. Only a note typed a virtual branch is asked; null for any other, or one the service says isn't a view.
 */
export function viewResults(m: Msg, w: number, src: Source | null | undefined, sink?: LinkTarget[]): string[] | null {
  if ((m.props.type ?? "").toLowerCase() !== "virtual-branch") return null;
  const st = embedState(m.id, undefined, src);
  if (st.kind === "loading") return [shade(fg(C.dark) + "≡ reading the view's results…" + RESET, w)];
  if (st.kind !== "node" || st.node.kind !== "view") return null;
  return nodeRegion(st.node, st.views, w, () => [], sink);
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
    // A target that doesn't exist yet gets the links' one quiet mark, not words (refs.ts MISSING_MARK).
    if (node.status === "missing") return [S(fg(C.dark) + `${ref} ${MISSING_MARK}` + RESET)];
    return [S(fg(calm ? C.yellow : C.lred) + `${ref} · ${printable(node.message ?? node.status).slice(0, 240)}` + RESET)];
  }
  const target = node.block;
  if (node.kind === "view") {
    const v = views.get(node);
    return v ? viewRegion(target, v, w, sink) : [S(fg(C.dark) + `${ref} · reading…` + RESET)];
  }
  const title = printable(node.title ?? subject(target));
  const out = [heading(node.blockId, node.fragmentId, node.fragmentId ? `» ${title} ^${node.fragmentId}` : `» ${title}`, w, sink, C.dark, !node.fragmentId && isOpenProposal(target) ? target : null)];
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

// Transclusions in read mode, as Detail projects them: `!((id))` shows the target note once, read-only,
// in a shaded region; a virtual-branch target shows its results (views.read); `!((id^fragment))` names the
// fragment. Embeds refresh when the outline changes, are never recursive (an embed's own `!((…))` is not
// expanded), and stop at 16 per document. Every failure says what it is instead of looking empty.
//
// Fragment slices: the service resolves whether a fragment exists (`references.resolve`) but doesn't
// offer the slice itself, and the door doesn't re-derive the fragment rules, so a good fragment shows the
// whole target with a note that the slice needs PIE-404.
import type { Msg } from "./board";
import { subject } from "./board";
import { printable, summarySegments, viewSummaryKeys, type Source } from "./props";
import { anyChangeSince, changeClock, changedSince, outlineChanged } from "./refs";
import type { SocketBoard } from "./socket";
import { C, fg, pad, RESET } from "./style";
import { readView, type ViewRead } from "./views";

export const MAX_EMBEDS = 16;

type State =
  | { kind: "loading" }
  | { kind: "missing" } | { kind: "deleted"; title: string } | { kind: "failed"; error: string }
  | { kind: "fragment-missing" } | { kind: "fragment-duplicate" }
  | { kind: "note"; target: Msg }
  | { kind: "view"; target: Msg; view: ViewRead };
interface Entry { state: State; at: number; asking: boolean }

const cacheBy = new WeakMap<object, Map<string, Entry>>();
/** Everything changed: every embed is read again on the next render (what it showed stays meanwhile). */
export function invalidateEmbeds() { outlineChanged(null); }

/**
 * Stale after its target changes (refs.ts `outlineChanged`). A view's results can change with any block,
 * and a failure is worth asking again after any change; a note embed waits for its own target.
 */
const stale = (id: string, e: Entry) => changedSince(e.at, [id]) || ((e.state.kind === "view" || e.state.kind === "failed") && anyChangeSince(e.at));

const key = (id: string, fragment?: string) => `${id}${fragment ? `^${fragment}` : ""}`;

type Waiter = { resolve: (m: Msg | null) => void; reject: (e: Error) => void };
const queued = new WeakMap<object, Map<string, Waiter[]>>();
/**
 * An embed's target, whole. The targets one render asks for go out together as one `blocks.read`
 * (PIE-400); a trashed one is read on its own for its title, and a service without `blocks.read` gets
 * one read per target.
 */
function readTarget(b: SocketBoard, id: string): Promise<Msg | null> {
  if (typeof b.readBlocks !== "function") return b.read(id);
  let q = queued.get(b);
  if (!q) { queued.set(b, (q = new Map())); setTimeout(() => void flush(b), 0); }
  const waiting = q.get(id) ?? [];
  q.set(id, waiting);
  return new Promise((resolve, reject) => waiting.push({ resolve, reject }));
}

async function flush(b: SocketBoard) {
  const q = queued.get(b);
  queued.delete(b);
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

async function project(b: SocketBoard, id: string, fragment?: string): Promise<State> {
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

/** The last projection of `!((id^fragment))`, refreshed in the background when the outline has changed. */
export function embedState(id: string, fragment: string | undefined, src: Source | null | undefined): State {
  if (!src) return { kind: "failed", error: "no outline connection" };
  let cache = cacheBy.get(src.board);
  if (!cache) cacheBy.set(src.board, (cache = new Map()));
  const k = key(id, fragment), c = cache;
  const hit = cache.get(k);
  if (hit && (hit.asking || !stale(id, hit))) return hit.state;
  const at = changeClock();
  cache.set(k, { state: hit?.state ?? { kind: "loading" }, at, asking: true });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  Promise.resolve().then(() => project(src.board, id, fragment)).then(
    state => { c.set(k, { state, at, asking: false }); src.redraw(); },
    (e: Error) => { c.set(k, { state: { kind: "failed", error: e.message }, at, asking: false }); src.redraw(); },
  );
  return hit?.state ?? { kind: "loading" };
}

/** A shaded region's background (a dim navy under the default text), and the gutter that marks it. */
export const SHADE = "\x1b[48;2;18;24;44m";
const GUTTER = fg(C.cyan) + "▌";

/** One shaded line: the background survives the resets inside `s`, and fills the whole width. */
export function shade(s: string, w: number): string {
  return SHADE + GUTTER + pad(s, Math.max(0, w - 1)).split(RESET).join(RESET + SHADE) + RESET;
}

/**
 * The region for the `n`th embed (from 0) of a document, `w` wide. `body` renders a note's body the way
 * the reader does (without expanding embeds), at the width it is given.
 */
export function embedRegion(id: string, fragment: string | undefined, n: number, w: number, src: Source | null | undefined, body: (m: Msg, width: number) => string[]): string[] {
  const ref = `!((${id.length > 12 ? id.slice(0, 8) + "…" : id}${fragment ? `^${fragment}` : ""}))`;
  const S = (line: string) => shade(line, w);
  const head = (text: string, colour: number = C.lcyan) => S(fg(colour) + "\x1b[1m" + text + "\x1b[22m" + RESET);
  const fail = (what: string) => [S(fg(C.lred) + `${ref} · ${what}` + RESET)];
  if (n >= MAX_EMBEDS) return fail(`EMBED LIMIT · maximum ${MAX_EMBEDS} per note`);
  const st = embedState(id, fragment, src);
  switch (st.kind) {
    case "loading": return [S(fg(C.dark) + `${ref} · reading…` + RESET)];
    case "missing": return fail("MISSING TARGET");
    case "deleted": return fail(`IN TRASH · ${printable(st.title)}`);
    case "failed": return fail(`TARGET FAILED · ${printable(st.error).slice(0, 200)}`);
    case "fragment-missing": return fail("MISSING FRAGMENT");
    case "fragment-duplicate": return fail("DUPLICATE FRAGMENT");
    case "note": {
      const title = printable(subject(st.target));
      const out = [head(fragment ? `Embedded fragment · ${title} ^${fragment}` : `Embedded block · ${title}`)];
      if (fragment) out.push(S(fg(C.dark) + "the whole note is shown: fragment slices need PIE-404" + RESET));
      for (const l of body(st.target, Math.max(4, w - 2))) out.push(S(" " + l));
      return out;
    }
    case "view": {
      const v = st.view, title = printable(subject(st.target));
      if (v.status === "invalid") return [head(`Embedded view · ${title} · CONFIG ERROR`, C.lred), ...v.errors.map(e => S(fg(C.lred) + "  " + printable(e) + RESET))];
      if (v.status !== "ready") return [head(`Embedded view · ${title} · QUERY FAILED`, C.lred), ...(v.errors.length ? v.errors : [v.status]).map(e => S(fg(C.lred) + "  " + printable(e) + RESET))];
      if (!v.items.length) return [head(`Embedded view · ${title} · EMPTY`)];
      const count = `${v.items.length} result${v.items.length === 1 ? "" : "s"}${v.truncated ? ` · TRUNCATED at ${v.limit}` : ""}`;
      const keys = viewSummaryKeys(st.target) ?? [];
      return [head(`Embedded view · ${title} · ${count}`), ...v.items.map(m => {
        const summary = summarySegments(m.properties ?? [], keys).map(s => s.plain).join(" · ");
        return S(fg(C.lcyan) + "  ∙ " + fg(C.white) + printable(subject(m)) + (summary ? fg(C.brown) + " · " + summary : "") + RESET);
      })];
    }
  }
}

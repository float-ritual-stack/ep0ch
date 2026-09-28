// Links in read mode, as Detail shows them: `((id))` and `[[address]]` become the target's title or the
// authored label, without delimiters; a missing target reads `label · Missing target`. The service
// resolves (`references.resolve`, `pages.resolve`); the door keeps the answers until the outline changes.
// Edit mode, comments and storage keep the raw text: this is presentation only.
import type { Source } from "./props";
import type { ReferenceResolution, PageResolution, SocketBoard } from "./socket";

/** The service's exact reference: `((id))`, `((id^fragment))`, `((id|label))`, `((id^fragment|label))`. */
export const REF = /\(\(([A-Za-z0-9_-]{8,})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?(?:\|((?:(?!\)\))[^\r\n])+))?\)\)/g;
/** A transclusion (Detail's pattern: no label). */
export const EMBED = /!\(\(([A-Za-z0-9_-]{8,})(?:\^([A-Za-z0-9][A-Za-z0-9_-]{0,63}))?\)\)/g;
/** A symbolic link, `[[address]]` or `[[address|label]]`. */
export const PAGE = /\[\[([^\]|\r\n]+)(?:\|([^\]\r\n]+))?\]\]/g;

/** Markers around a resolved link / an unlinked missing one in prepared text; colourBody styles them. */
export const LINK_ON = "", MISSING_ON = "", LINK_OFF = "";
export const stripMarks = (s: string) => s.replace(/[-]/g, "");

export const refKey = (id: string, fragment?: string, label?: string) => `${id}${fragment ? `^${fragment}` : ""}${label !== undefined ? `|${label}` : ""}`;
const short = (id: string) => (id.length > 12 ? `${id.slice(0, 8)}…` : id);

// ── what changed: a cached answer is asked again only when a change could have altered it ──────────

let tick = 0, allAt = 0, anyAt = 0, configAt = 0;
const changedAt = new Map<string, number>();
/**
 * The outline changed. `ids`: the blocks a change record names (an edit, a create), so only answers
 * about them are asked again (plus the ones any change can alter: missing pages, views, failures).
 * null: anything may have changed (a move or trash takes a subtree along; a reset; a service without
 * change records). `config`: the workspace may differ too (a reconnect), so its Work-ID prefix is re-read.
 */
export function outlineChanged(ids: readonly string[] | null, config = false) {
  tick++; anyAt = tick;
  if (config) configAt = tick;
  if (!ids || changedAt.size > 5000) { allAt = tick; changedAt.clear(); }
  for (const id of ids ?? []) { changedAt.delete(id); changedAt.set(id, tick); }
}
/** Now, for an answer being asked: later changes make it stale. */
export const changeClock = () => tick;
/** Did a block in `ids` (or everything) change after `at`? */
export function changedSince(at: number, ids: Iterable<string>): boolean {
  if (allAt > at) return true;
  for (const id of ids) if ((changedAt.get(id) ?? 0) > at) return true;
  return false;
}
/** Did anything change after `at`? */
export const anyChangeSince = (at: number) => anyAt > at;
/** Everything is asked again (a reset, or tests). Answers stay visible until re-read. */
export function invalidateReferences() { outlineChanged(null, true); }

interface Cached<T> { value: T | null; error?: string; at: number; asking: boolean }
const refsBy = new WeakMap<object, Map<string, Cached<Map<string, ReferenceResolution>>>>();
const pagesBy = new WeakMap<object, Map<string, Cached<PageResolution>>>();

function ask<T>(by: WeakMap<object, Map<string, Cached<T>>>, src: Source | null | undefined, key: string, fetch: (b: SocketBoard) => Promise<T>, stale: (c: Cached<T>) => boolean): Cached<T> | null {
  if (!src) return null;
  let cache = by.get(src.board);
  if (!cache) by.set(src.board, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && (hit.asking || !stale(hit))) return hit;
  const at = tick, c = cache;
  const entry: Cached<T> = { value: hit?.value ?? null, error: hit?.error, at, asking: true };
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  Promise.resolve().then(() => fetch(src.board)).then(v => { c.set(key, { value: v, at, asking: false }); src.redraw(); },
    (e: Error) => { c.set(key, { value: hit?.value ?? null, error: e.message, at, asking: false }); src.redraw(); });
  return entry;
}

const BLOCK_ID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
/**
 * The references a note's text holds, in one canonical form: every `((…))`, and each bare block id (a
 * `[related-to::<id>]` value) as `((id))`. The note's links, its body and its property panel all look
 * their targets up in this one answer, so a note's references are resolved once.
 */
function refsOf(text: string): { text: string; ids: string[] } {
  const refs = new Set<string>(), ids = new Set<string>();
  for (const m of text.matchAll(REF)) { refs.add(m[0]); ids.add(m[1]!); }
  for (const m of text.replace(REF, " ").matchAll(BLOCK_ID)) { refs.add(`((${m[0]}))`); ids.add(m[0]); }
  return { text: [...refs].sort().join(" "), ids: [...ids] };
}

/**
 * Every `((…))` in `text` (a note's whole text) as the service reads it, keyed by refKey; also its bare
 * block ids, keyed by id. null while the first answer is on its way. Asked again only when one of those
 * blocks changes.
 */
export function referencesIn(text: string, src: Source | null | undefined): Map<string, ReferenceResolution> | null {
  const refs = refsOf(text);
  if (!refs.text) return new Map();
  return ask(refsBy, src, refs.text, async b => new Map((await b.resolveReferences(refs.text)).map(r => [refKey(r.blockId, r.fragmentId, r.label), r])),
    c => changedSince(c.at, refs.ids))?.value ?? null;
}

const prefixBy = new WeakMap<object, Map<string, Cached<string | null>>>();
/** The workspace's Work-ID prefix: a string, null when none is configured (or unknown), undefined until asked. */
export function workIdPrefix(src: Source | null | undefined): string | null | undefined {
  // Configuration, not content: asked again after a reconnect or reset, or after a change when it failed.
  const c = ask(prefixBy, src, "prefix", b => b.workIdPrefix(), c => configAt > c.at || (!!c.error && anyChangeSince(c.at)));
  if (!c) return null;
  return c.value !== null || !c.asking ? c.value : undefined;
}

/**
 * What `[[address]]` points at; null while asking (or when it couldn't be asked). A found page is asked
 * again when its block changes; a missing one after any change (any edit or create can add the address).
 */
export function pageOf(address: string, src: Source | null | undefined): PageResolution | null {
  return ask(pagesBy, src, address.trim().toLowerCase(), b => b.resolvePage(address.trim()),
    c => (c.value?.block ? changedSince(c.at, [c.value.block.id]) : anyChangeSince(c.at)) || (c.value?.status !== "resolved" && anyChangeSince(c.at)))?.value ?? null;
}

export interface LinkView { text: string; missing: boolean }

/** How a `((…))` reads: the label or title (with `^fragment`), and what's wrong with it, as Detail says it. */
export function refView(id: string, fragment: string | undefined, label: string | undefined, r: ReferenceResolution | undefined): LinkView {
  if (!r) return { text: label ?? short(id) + (fragment ? `^${fragment}` : ""), missing: false };
  if (r.status === "missing") return { text: `${label ?? short(id)} · Missing target`, missing: true };
  const title = (label ?? r.title ?? short(id)) + (label === undefined && fragment ? `^${fragment}` : "");
  const suffix = r.status === "deleted" ? " · Trash" : r.status === "stale" ? " · Missing fragment" : r.status === "duplicate" ? " · Duplicate fragment" : "";
  return { text: title + suffix, missing: false };
}

/** How a `[[address]]` reads: its label or address, or `address · Missing target`. */
export function pageView(address: string, label: string | undefined, r: PageResolution | null): LinkView {
  const text = (label ?? address).trim();
  if (r?.status === "missing") return { text: `${text} · Missing target`, missing: true };
  return { text: text + (r?.status === "deleted" ? " · Trash" : ""), missing: false };
}

/**
 * Body text with links replaced by how they read, between markers colourBody styles. Code fences and
 * inline code keep their text. Transclusions (`!((…))`) are left for the renderer when `embeds` is on;
 * inside an embed (off) they read as a link that says it isn't expanded: embeds are never recursive.
 */
export function presentLinks(text: string, embeds: boolean, src: Source | null | undefined, noteText = text): string {
  // `noteText`: the whole note `text` was cut from, so it shares that note's one references answer.
  const resolved = referencesIn(noteText, src) ?? new Map<string, ReferenceResolution>();
  let fenced = false;
  return text.split("\n").map(line => {
    if (/^\s*```/.test(line)) { fenced = !fenced; return line; }
    if (fenced) return line;
    return line.split(/(`[^`]*`)/).map((part, i) => {
      if (i % 2) return part;
      const mark = (v: LinkView) => (v.missing ? MISSING_ON : LINK_ON) + v.text + LINK_OFF;
      return part
        .replace(new RegExp(`(!?)${REF.source}`, "g"), (all, bang: string, id: string, frag?: string, label?: string) => {
          if (label !== undefined && !label.trim()) return all;
          if (bang && !label && embeds) return all;
          const v = refView(id, frag, label, resolved.get(refKey(id, frag, label)));
          return bang && !label ? `!${mark(v)} · embed not expanded here` : bang + mark(v);
        })
        .replace(PAGE, (_all, address: string, label?: string) => mark(pageView(address, label, pageOf(address, src))));
    }).join("");
  }).join("\n");
}

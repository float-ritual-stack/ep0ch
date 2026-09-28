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

let generation = 0;
/** The outline changed: titles, trash state and pages may have too. Answers stay visible until re-read. */
export function invalidateReferences() { generation++; }

interface Cached<T> { value: T | null; error?: string; at: number; asking: boolean }
const refsBy = new WeakMap<object, Map<string, Cached<Map<string, ReferenceResolution>>>>();
const pagesBy = new WeakMap<object, Map<string, Cached<PageResolution>>>();

function ask<T>(by: WeakMap<object, Map<string, Cached<T>>>, src: Source | null | undefined, key: string, fetch: (b: SocketBoard) => Promise<T>): Cached<T> | null {
  if (!src) return null;
  let cache = by.get(src.board);
  if (!cache) by.set(src.board, (cache = new Map()));
  const hit = cache.get(key);
  if (hit && (hit.at >= generation || hit.asking)) return hit;
  const at = generation, c = cache;
  const entry: Cached<T> = { value: hit?.value ?? null, error: hit?.error, at, asking: true };
  cache.set(key, entry);
  if (cache.size > 500) cache.delete(cache.keys().next().value!);
  Promise.resolve().then(() => fetch(src.board)).then(v => { c.set(key, { value: v, at, asking: false }); src.redraw(); },
    (e: Error) => { c.set(key, { value: hit?.value ?? null, error: e.message, at, asking: false }); src.redraw(); });
  return entry;
}

/** Every `((…))` in `text` as the service reads it, keyed by refKey; null while the first answer is on its way. */
export function referencesIn(text: string, src: Source | null | undefined): Map<string, ReferenceResolution> | null {
  const refsText = [...text.matchAll(REF)].map(m => m[0]).join(" ");
  if (!refsText) return new Map();
  return ask(refsBy, src, refsText, async b => new Map((await b.resolveReferences(refsText)).map(r => [refKey(r.blockId, r.fragmentId, r.label), r])))?.value ?? null;
}

/** What `[[address]]` points at; null while asking (or when it couldn't be asked). */
export function pageOf(address: string, src: Source | null | undefined): PageResolution | null {
  return ask(pagesBy, src, address.trim().toLowerCase(), b => b.resolvePage(address.trim()))?.value ?? null;
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
export function presentLinks(text: string, embeds: boolean, src: Source | null | undefined): string {
  const resolved = referencesIn(text, src) ?? new Map<string, ReferenceResolution>();
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

// Resource projections in read mode, as Detail draws them (PIE-445): a Resource's stored details (a Jira
// ticket first) shown read-only under the `jira::` line that names it, or at the top of a ticket page. The
// service decides everything (which lines are provider lines, which key the context names, the status,
// its reason, the allowed fields) through `resources.projection.read`; the door lays the answer out in
// Detail's words (pi-herdr-outliner src/detail-embeds.ts `resourceProjectionLayout`, parity-tested) and
// paints the fetched time's age when it draws. It never registers, refreshes or contacts a provider.
//
// Answers are kept per connection and per note, like embeds (src/embeds.ts): read again when the note (or
// the block its key came from) changes, or when a `resource-catalog` event names a Resource it shows.
// Without the `resources.projection` capability nothing is read and nothing extra is drawn.
import type { Msg } from "./board";
import { shade } from "./embeds";
import { printable, type Source } from "./props";
import { anyChangeSince, changeClock, changedSince, type LinkTarget } from "./refs";
import type { SocketBoard } from "./socket";
import { C, fg, LINK_END, linkTag, RESET } from "./style";
import { wrap } from "./text";

/** The statuses the service sends today; a newer one is drawn generically, with its reason. */
export type ResourceProjectionStatus = "ready" | "stale" | "not-fetched" | "not-registered" | "ambiguous" | "no-key" | "unavailable";

/** One projection, as `resources.projection.read` sends it (pi-herdr-outliner src/resource-projection.ts). */
export interface ResourceProjection {
  /** `line`: the index, in the note's whole text, of the line the projection follows. */
  anchor: { kind: string; line: number; start: number; end: number };
  provider: string;
  label?: string;
  propertyKey?: string;
  options: { comments?: number; compact?: true; full?: true; unknown: readonly string[] };
  status: ResourceProjectionStatus | (string & {});
  reason?: string;
  key?: string;
  candidates?: readonly string[];
  resolvedFrom?: { step: string; blockId: string; line: number };
  resourceId?: string;
  sourceId?: string;
  summary?: string;
  fields: readonly { label: string; value: string }[];
  updatedAt?: string;
  fetchedAt?: string;
  externalUrl?: string;
}
export interface ResourceProjectionRead { blockId: string; revision: number; projections: ResourceProjection[] }

/**
 * The property keys that name a projection (the service's RESOURCE_DIRECTIVE_PROVIDERS, parity-tested).
 * Only a note that mentions one is asked about: this is a cheap filter, never the service's parse.
 */
export const PROJECTION_KEYS = ["jira"] as const;
const MENTIONS = new RegExp(`(?:${PROJECTION_KEYS.join("|")})::`, "i");
export const mayHaveProjections = (text: string) => text.includes("::") && MENTIONS.test(text);

// ── Detail's layout (src/detail-embeds.ts), as it reads once drawn ──────────────────────────────────

/**
 * Detail's `generatedInline` as it reads once drawn: control characters become spaces, brackets become
 * parentheses and `((` is broken, so no generated text reads as a property or a reference. Detail also
 * escapes Markdown characters, which its renderer then draws as typed; the door draws them as typed.
 */
export function drawnInline(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").replace(/\[/g, "(").replace(/\]/g, ")").replace(/\(\(/g, "( (").trim();
}

/** Detail's `localTime`: `2026-09-20 10:00` in the reader's time zone. */
export function localTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const p = (v: number) => String(v).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Detail's `relativeAge`: "12 min ago", painted when drawn, never kept. */
export function relativeAge(fromIso: string, now: number): string {
  const elapsed = now - Date.parse(fromIso);
  if (!Number.isFinite(elapsed)) return "";
  const minutes = Math.max(0, Math.floor(elapsed / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

const STATUS_LABELS: Readonly<Record<string, string>> = {
  "not-fetched": "not fetched yet",
  "not-registered": "not registered",
  "no-key": "no key found",
  unavailable: "unavailable",
};

/**
 * Where the parts of one line came from, so the reader can colour them: `head` is the first line (its
 * `key` is the link), `fields`, `fetched`, `reason` and `note` (comments, unknown options) the rest.
 */
export type LineKind = "head" | "fields" | "fetched" | "reason" | "note";
export interface ProjectionLayout {
  /** The text Detail draws, line for line (`- ` is its list item; the rest are its continuation lines). */
  lines: string[];
  kinds: LineKind[];
  /** The line that ends with the fetched time: the age is painted after it. */
  fetchedLine?: number;
  /** The key as drawn in the head line (the part a click opens), or "" when there is none. */
  key: string;
  /** The head line's title part (`Jira ACME-12`), which the link covers. */
  title: string;
}

/** Detail's `resourceProjectionLayout`, as its lines read once drawn. */
export function projectionLayout(p: ResourceProjection): ProjectionLayout {
  const key = p.key ? drawnInline(p.key) : "";
  const title = [drawnInline(p.label ?? p.provider), key].filter(Boolean).join(" ");
  const reason = p.reason ? drawnInline(p.reason) : "";
  const lines: string[] = [], kinds: LineKind[] = [];
  const add = (kind: LineKind, line: string) => { kinds.push(kind); lines.push(line); };
  let fetchedLine: number | undefined;
  if ((p.status === "ready" || p.status === "stale") && p.summary !== undefined) {
    const fetched = p.fetchedAt ? `fetched ${localTime(p.fetchedAt)}` : "";
    add("head", `- ${title} · ${drawnInline(p.summary)}${p.options.compact && fetched ? ` · ${fetched}` : ""}`);
    if (p.options.compact && fetched) fetchedLine = 0;
    if (!p.options.compact) {
      const fields = p.fields.map(f => `${drawnInline(f.label)}: ${drawnInline(f.value)}`);
      if (p.updatedAt) fields.push(`Updated: ${localTime(p.updatedAt)}`);
      if (fields.length) add("fields", `  ${fields.join(" · ")}`);
      if (fetched) { fetchedLine = lines.length; add("fetched", `  ${fetched}`); }
    }
    if (p.status === "stale" && reason) add("reason", `  ${reason}`);
  } else {
    const status = p.status === "ambiguous"
      ? `ambiguous: ${(p.candidates ?? []).map(drawnInline).join(", ")}`
      : STATUS_LABELS[p.status] ?? drawnInline(String(p.status));
    add("head", `- ${title} · ${status}`);
    if (reason) add("reason", `  ${reason}`);
  }
  if (p.options.comments !== undefined) add("note", "  Comments are not stored yet; --comments shows them once the provider returns them.");
  for (const option of p.options.unknown) add("note", `  unknown option ${drawnInline(option)}`);
  return { lines, kinds, ...(fetchedLine !== undefined ? { fetchedLine } : {}), key, title };
}

/** The layout with the age painted after the fetched time, as Detail's reader paints it. */
export function projectionText(p: ResourceProjection, now: number): string[] {
  const l = projectionLayout(p);
  const age = p.fetchedAt && l.fetchedLine !== undefined ? relativeAge(p.fetchedAt, now) : "";
  return l.lines.map((line, i) => (age && i === l.fetchedLine ? `${line} (${age})` : line));
}

/**
 * What a click or ⏎ on a projection opens: the ticket's web page (`externalUrl`), through the reader's
 * link opener. `reason` says why there's nothing to open (no key, not fetched yet, …).
 */
export function projectionTarget(p: ResourceProjection): LinkTarget {
  const l = projectionLayout(p);
  return {
    role: "resource", label: l.key || l.title,
    ...(p.externalUrl ? { url: p.externalUrl } : { reason: nothingToOpen(p) }),
  };
}

function nothingToOpen(p: ResourceProjection): string {
  const what = [p.label ?? p.provider, p.key].filter(Boolean).join(" ");
  const why = p.reason ?? STATUS_LABELS[p.status] ?? p.status;
  return `nothing to open for ${printable(what)}: ${printable(why)}`;
}

// ── drawing ──────────────────────────────────────────────────────────────────────────────────────

const COLOUR: Record<LineKind, number> = { head: C.white, fields: C.brown, fetched: C.dark, reason: C.yellow, note: C.yellow };

/**
 * The shaded, read-only region for the projections that follow one line, `w` wide, indented like that
 * line. `link` tags the head's title (label and key) as the projection's link, so `[ ]` stops on it and a
 * click opens it; without it (a preview of a draft) the region is text.
 */
export function projectionRegion(ps: readonly ResourceProjection[], w: number, indent: number, now: number, link?: (to: LinkTarget, text: string) => string): string[] {
  const out: string[] = [];
  const lead = " ".repeat(Math.max(0, Math.min(indent, Math.floor(w / 3))));
  const inner = Math.max(4, w - 1 - lead.length);
  for (const p of ps) {
    const l = projectionLayout(p), text = projectionText(p, now);
    text.forEach((line, i) => {
      const kind = l.kinds[i]!;
      if (kind === "head") {
        // `- Jira ACME-12 · summary`: the bullet as the reader draws one, the title as the link.
        const rest = line.slice(2 + l.title.length);
        const title = link ? link(projectionTarget(p), l.title) : l.title;
        const bad = p.status !== "ready" && p.status !== "stale";
        wrap(title + rest, inner - 2).forEach((row, k) => {
          const body = k ? row : row.replace(title, fg(C.lcyan) + "\x1b[1m" + title + "\x1b[22m" + fg(bad ? C.yellow : C.white));
          out.push(shade(lead + (k ? "  " : fg(C.lcyan) + "∙ ") + fg(bad ? C.yellow : C.white) + body + RESET, w));
        });
        return;
      }
      for (const row of wrap(line.trimStart(), inner - 2)) out.push(shade(lead + "  " + fg(COLOUR[kind]) + row + RESET, w));
    });
  }
  return out;
}

// ── the answers, per connection and note ─────────────────────────────────────────────────────────

interface Entry { read: ResourceProjectionRead | null; failed: boolean; at: number; rat: number; asking: boolean }
const cacheBy = new WeakMap<object, Map<string, Entry>>();
const caches = new Set<WeakRef<Map<string, Entry>>>();

// Resource changes (`resource-catalog` events) have their own clock: they aren't outline changes.
let rtick = 0, rAllAt = 0, rAnyAt = 0;
const rChangedAt = new Map<string, number>();

/** The blocks a note's projections depend on: the note and each block a key was found in. */
const blocksOf = (id: string, e: Entry) => [id, ...(e.read?.projections ?? []).flatMap(p => (p.resolvedFrom ? [p.resolvedFrom.blockId] : []))];
/** A projection with no Resource yet (a key not registered, no Source): any new Resource could be it. */
const unresolved = (e: Entry) => (e.read?.projections ?? []).some(p => !p.resourceId && p.status !== "no-key" && p.status !== "ambiguous");
/** A projection that found no key (or two): a change in any ancestor could settle it. */
const contextual = (e: Entry) => (e.read?.projections ?? []).some(p => p.status === "no-key" || p.status === "ambiguous");

function resourceStale(e: Entry): boolean {
  if (rAllAt > e.rat) return true;
  if (unresolved(e) && rAnyAt > e.rat) return true;
  return (e.read?.projections ?? []).some(p => !!p.resourceId && (rChangedAt.get(p.resourceId) ?? 0) > e.rat);
}
const stale = (id: string, e: Entry) => changedSince(e.at, blocksOf(id, e)) || ((e.failed || contextual(e)) && anyChangeSince(e.at)) || resourceStale(e);

/**
 * A `resource-catalog` event: the Resource it names changed (null: any may have, e.g. a new Source, or a
 * reconnect, which doesn't replay them). True when a projection the door has read could show it, so the
 * reader should redraw (and read those again); other events cost nothing.
 */
export function resourceChanged(resourceId: string | null): boolean {
  // The answers this event makes stale (ones already stale are read again on their next render anyway).
  const shown: Entry[] = [];
  for (const ref of caches) {
    const cache = ref.deref();
    if (!cache) { caches.delete(ref); continue; }
    for (const e of cache.values()) if (!e.asking && !resourceStale(e)) shown.push(e);
  }
  rtick++; rAnyAt = rtick;
  if (resourceId === null || rChangedAt.size > 5000) { rAllAt = rtick; rChangedAt.clear(); }
  else rChangedAt.set(resourceId, rtick);
  return shown.some(resourceStale);
}

/** Whether this connection reads projections: only a service that says it has them. */
export const projectionsServed = (b: SocketBoard) => typeof b.supports === "function" && b.supports("resources.projection") === true;

/**
 * The projections to draw in note `m`, from the last answer (read again in the background when it may
 * have changed; the reader redraws when it lands). Empty without the capability, for a note that names no
 * provider, after a failed read, and while the answer is for another revision of the note.
 */
export function projectionsOf(m: Msg, src: Source | null | undefined): readonly ResourceProjection[] {
  if (!src || m.partial || !mayHaveProjections(m.text) || !projectionsServed(src.board)) return [];
  let cache = cacheBy.get(src.board);
  if (!cache) { cacheBy.set(src.board, (cache = new Map())); caches.add(new WeakRef(cache)); }
  const hit = cache.get(m.id);
  const fresh = hit && (hit.asking || !stale(m.id, hit));
  if (!fresh) {
    const entry: Entry = { read: hit?.read ?? null, failed: hit?.failed ?? false, at: changeClock(), rat: rtick, asking: true };
    const c = cache;
    c.set(m.id, entry);
    if (c.size > 200) c.delete(c.keys().next().value!);
    Promise.resolve().then(() => src.board.readResourceProjections(m.id)).then(
      read => { c.set(m.id, { ...entry, read, failed: false, asking: false }); src.redraw(); },
      // A failed read keeps what was shown (nothing, the first time: the note as it was), and is asked
      // again after the next change.
      () => { c.set(m.id, { ...entry, failed: true, asking: false }); src.redraw(); },
    );
  }
  const read = cache.get(m.id)?.read;
  // An answer for another revision waits for the read the change brings: its lines may have moved.
  if (!read || (m.revision !== undefined && read.revision !== m.revision)) return [];
  return read.projections;
}

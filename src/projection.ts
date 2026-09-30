// Resource projections in read mode, as Detail draws them (PIE-445): a Resource's stored details (a Jira
// ticket first) shown read-only under the `jira::` line that names it, or at the top of a ticket page. The
// service decides everything (which lines are provider lines, which key the context names, the status,
// its reason, the allowed fields) through `resources.projection.read`; the door lays the answer out in
// Detail's words (pi-herdr-outliner src/detail-embeds.ts `resourceProjectionLayout`, parity-tested) and
// paints the fetched time's age when it draws. It never contacts a provider itself: `r` asks the service
// to refresh (`resources.projection.refresh`), and the service fetches.
//
// Answers are kept per connection and per note, like embeds (src/embeds.ts): read again when the note (or
// the block its key came from) changes, or when a `resource-catalog` event names a Resource it shows.
// Without the `resources.projection` capability nothing is read and nothing extra is drawn.
import { subject, type Msg } from "./board";
import { shade } from "./embeds";
import { printable, type Source } from "./props";
import { anyChangeSince, changeClock, changedSince, type LinkTarget } from "./refs";
import { LIST_FIELDS, type SocketBoard } from "./socket";
import { isPropertyTokenLine, withoutPropertyTokens } from "./vendor/property-grammar";
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
  /** How old the stored copy reads: `stale` past the provider's stale age (15 minutes for Jira). */
  freshness?: string;
  /** The service is fetching it now (the save's or the open's background fetch, or `r`). */
  fetching?: boolean;
  /** Why the service's last fetch failed ("no Jira credentials on this machine"). */
  fetchError?: string;
  /**
   * The block the ticket is kept as (the extension's record, pi-herdr-outliner src/extension-records.ts),
   * its comment blocks, and when the service last wrote or confirmed it.
   */
  record?: { blockId: string; pageBlockId: string; syncedAt: string; commentBlockIds: readonly string[] };
}
export interface ResourceProjectionRead { blockId: string; revision: number; projections: ResourceProjection[] }

/**
 * The property keys that name a projection (the service's RESOURCE_DIRECTIVE_PROVIDERS, parity-tested).
 * Only a note that mentions one is asked about: this is a cheap filter, never the service's parse.
 */
export const PROJECTION_KEYS = ["jira"] as const;
// A provider line (`jira::`) or a ticket block's own `[jira.key::…]`, which shows its ticket's header.
const MENTIONS = new RegExp(`(?:${PROJECTION_KEYS.join("|")})(?:\\.key)?::`, "i");
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
    // A fetch that failed says why below; "saving fetches it" would only contradict it.
    const fetchSays = !!p.fetchError && (p.status === "not-registered" || p.status === "not-fetched");
    if (reason && !fetchSays) add("reason", `  ${reason}`);
  }
  if (p.fetching) add("note", "  fetching…");
  else if (p.fetchError) add("reason", `  can't fetch: ${drawnInline(p.fetchError.replace(/^Resource extension: /, ""))}`);
  // Detail's words: a ticket kept as a block draws its comments from its blocks instead (ticketRegion).
  if (p.options.comments !== undefined && !p.record) add("note", "  Comments are not stored yet; --comments shows them once the provider returns them.");
  for (const option of p.options.unknown) add("note", `  unknown option ${drawnInline(option)}`);
  return { lines, kinds, ...(fetchedLine !== undefined ? { fetchedLine } : {}), key, title };
}

// ── a ticket kept as a block (the extension's record, PIE-445 wave A) ────────────────────────────────

/** The ticket's own blocks as the door read them: the record and its comments (oldest first). */
export interface TicketBlocks { record: Msg; comments: Msg[] }

/** Where a ticket region sits: under a page's line (all of it), or on the ticket block itself (its header on top, its comments below). */
export type TicketPart = "page" | "head" | "comments";

/** A comment block's first line and its words: `Lee Park · 2026-01-02 10:00` then what they wrote. */
function commentParts(m: Msg): { who: string; body: string } {
  const [first = "", ...rest] = m.text.split("\n");
  const body = rest.map(l => withoutPropertyTokens(l)).join(" ").replace(/\s+/g, " ").trim();
  return { who: first.replace(/^\\/, ""), body };
}

/** The ticket's fields as a compact line, from its block's `jira.*` properties, in the order people scan them. */
export function ticketFields(record: Msg | null, p: ResourceProjection): string {
  const props = record?.properties ?? [];
  const all = (key: string) => props.filter(x => x.key === `jira.${key}`).map(x => x.value);
  const one = (key: string) => all(key)[0];
  if (!record) return p.fields.map(f => drawnInline(f.value)).join(" · ");
  const labels = all("label");
  return [one("status"), one("assignee"), one("sprint"), one("priority"), one("type"), labels.length ? labels.join(", ") : undefined]
    .filter((v): v is string => !!v).map(drawnInline).join(" · ");
}

/** The body's first lines, without the title and property lines, for a page's excerpt. */
function excerpt(record: Msg, rows: number): string[] {
  const lines = record.text.split("\n").slice(1).filter(l => !isPropertyTokenLine(l));
  return lines.map(l => l.trimEnd()).filter((l, i, a) => l || (i > 0 && a[i - 1])).join("\n").trim().split("\n").filter(Boolean).slice(0, rows);
}

/** What the age line says: fetching, why it can't, or how old the copy is, with `r` to refresh. */
function ageLine(p: ResourceProjection, now: number): { text: string; bad: boolean } {
  const when = p.fetchedAt ?? p.record?.syncedAt;
  const age = when ? `fetched ${relativeAge(when, now)}` : "";
  if (p.fetching) return { text: [age, "fetching…"].filter(Boolean).join(" · "), bad: false };
  if (p.fetchError) return { text: `can't fetch: ${drawnInline(p.fetchError.replace(/^Resource extension: /, ""))}${age ? ` · ${age}` : ""}`, bad: true };
  return { text: `${age || "not fetched"}${p.freshness === "stale" ? " · stale" : ""} · r refresh`, bad: false };
}

/**
 * The rows of a ticket region, `w` wide: the head (its title opens the ticket block), the fields, the age
 * (a click refreshes), then on a page the body's first lines, then the comments. On the ticket block itself
 * the head part leaves the body to the note and the comments part is only the comments.
 */
export function ticketRegion(p: ResourceProjection, t: TicketBlocks | null, part: TicketPart, w: number, indent: number, now: number, link?: (to: LinkTarget, text: string) => string): string[] {
  const out: string[] = [];
  const lead = " ".repeat(Math.max(0, Math.min(indent, Math.floor(w / 3))));
  const inner = Math.max(8, w - 1 - lead.length);
  const row = (text: string, colour: number, prefix = "  ") => { for (const r of wrap(text, inner - 2)) out.push(shade(lead + prefix + fg(colour) + r + RESET, w)); };
  const label = [drawnInline(p.label ?? p.provider), p.key ? drawnInline(p.key) : ""].filter(Boolean).join(" ");
  if (part !== "comments") {
    const summary = drawnInline(t ? subject(t.record) : p.summary ?? "");
    const openIt: LinkTarget = p.record ? { block: p.record.blockId, role: "resource", label } : projectionTarget(p);
    const title = link && part === "page" ? link(openIt, label) : label;
    wrap(`${title}${summary ? ` · ${summary}` : ""}`, inner - 2).forEach((r, k) => {
      const body = k ? r : r.replace(title, fg(C.lcyan) + "\x1b[1m" + title + "\x1b[22m" + fg(C.white));
      out.push(shade(lead + (k ? "  " : fg(C.lcyan) + "∙ ") + fg(C.white) + body + RESET, w));
    });
    const compact = part === "page" && !!p.options.compact;
    const fields = ticketFields(t?.record ?? null, p);
    if (fields && !compact) row(fields, C.brown);
    const age = ageLine(p, now);
    // A ticket kept as a block refreshes through that block (its one Resource), whichever note's line asked
    // for it: a key has one ticket block, often under another note (pi-herdr-outliner extensionRecordHome).
    const refreshOf = p.record?.blockId ?? p.resolvedFrom?.blockId;
    const shown = link && refreshOf
      ? link({ refresh: refreshOf, ...(!p.record && p.anchor.kind !== "page" ? { refreshLine: p.anchor.line } : {}), label: `refresh ${label}`, role: "resource" }, age.text)
      : age.text;
    // --compact: the head, the fields on one line, the age only when something is wrong or running.
    if (compact) { if (fields) row(fields, C.brown); if (age.bad || p.fetching) row(shown, age.bad ? C.yellow : C.dark); }
    else row(shown, age.bad ? C.yellow : C.dark);
    if (part === "page" && t && !compact) for (const l of excerpt(t.record, 4)) row(`│ ${printable(l)}`, C.grey);
  }
  if (part !== "head" && t) {
    for (const c of t.comments) {
      const { who, body } = commentParts(c);
      // ` · `, not a dash: the CRT font draws `—` as `?`.
      row(`${printable(who)}${body ? ` · ${printable(body)}` : ""}`, C.grey);
    }
  }
  return out;
}

// The ticket blocks, per connection: read again when one of them changes or the service rewrote them.
interface TicketEntry { blocks: TicketBlocks | null; at: number; synced: string; asking: boolean }
const ticketsBy = new WeakMap<object, Map<string, TicketEntry>>();

/** The record and comment blocks a projection names, from the last read (asked again in the background). */
export function ticketBlocksOf(p: ResourceProjection, src: Source | null | undefined): TicketBlocks | null {
  if (!p.record || !src) return null;
  let cache = ticketsBy.get(src.board);
  if (!cache) ticketsBy.set(src.board, (cache = new Map()));
  const id = p.record.blockId, ids = [id, ...p.record.commentBlockIds];
  const hit = cache.get(id);
  const fresh = hit && (hit.asking || (!changedSince(hit.at, ids) && hit.synced === p.record.syncedAt && (hit.blocks?.comments.length ?? 0) === p.record.commentBlockIds.length));
  if (!fresh) {
    const entry: TicketEntry = { blocks: hit?.blocks ?? null, at: changeClock(), synced: p.record.syncedAt, asking: true };
    const c = cache;
    c.set(id, entry);
    if (c.size > 200) c.delete(c.keys().next().value!);
    Promise.resolve().then(() => src.board.readMany(ids, [...LIST_FIELDS, "text"])).then(
      read => {
        const record = read.find(m => m.id === id) ?? null;
        c.set(id, { ...entry, asking: false, blocks: record ? { record, comments: p.record!.commentBlockIds.flatMap(cid => read.filter(m => m.id === cid)) } : null });
        src.redraw();
      },
      () => { c.set(id, { ...entry, asking: false }); },
    );
  }
  return cache.get(id)?.blocks ?? null;
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

/** Tests: stop tracking every connection's answers seen so far, so an event only reaches readers created after. */
export function forgetProjectionAnswers(): void { caches.clear(); }

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

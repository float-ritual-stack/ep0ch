// A block's authored links as the outliner's Tree shows them (PIE-259, PIE-324, PIE-329): its Outlinks and
// Resources from `blocks.authored-links`, its Backlinks from `references.backlinks` (grouped as Detail groups
// them, src/backlinks.ts), and a Resource's stored content shown as a note in a reader.
//
// The service owns the meaning: which links a block has, where each resolves, whether a Resource is
// registered and what is stored for it. The door only lays the answer out. The row words mirror the
// outliner's `renderAuthoredLinkDisplay` (src/tree-renderer.ts) and `authoredHeaderStateText`, with PIE-329's
// concise labels: a label that repeats its target's title or Work ID reads once.
import { basename, dirname, extname } from "node:path";
import type { Msg } from "./board";
import { printable } from "./text";
import { resourceTextRevision } from "@ep0ch/outline-core/protocol";
import { parseResourceRef } from "@ep0ch/outline-core/resource-ref";

// ── the wire (pi-herdr-outliner src/authored-links.ts, src/resource-references.ts, src/resources.ts) ──

export type AuthoredResourceReference =
  | { kind: "resource"; resourceId: string }
  | { kind: "filesystem"; path: string }
  | { kind: "web"; url: string }
  /** An extension provider's entity by key (`[jira::PC-12]`): `kind` is `ext:<id>` (Jira's `ext:jira`). */
  | { kind: `ext:${string}`; key: string }
  | { kind: "application"; uri: string };

export interface AuthoredLinkDiagnostic { span: { start: number; end: number }; message: string }
export type AuthoredLinkCompleteness = { kind: "complete" } | { kind: "limited"; reason: string; shown: number };

/** What an Outlink's or Resource's target block is (the service's `linkTargetFacets`): for Kind, Stage and Sort. */
export interface AuthoredTargetFacets {
  kind: string; kindLabel: string;
  stage?: { property: string; value: string; bucket?: "waiting" | "draft" | "active" | "done" };
  createdAt: string; updatedAt: string;
}

interface EntryBase { key: string; label: string; firstSpan: { start: number; end: number }; occurrenceCount: number }

export type AuthoredOutlinkResolution =
  | { kind: "ready"; target: { kind: "block"; blockId: string; fragmentId?: string }; title: string; facets?: AuthoredTargetFacets }
  | { kind: "deleted"; blockId: string; fragmentId?: string; title: string; reason: string }
  | { kind: "unregistered-page"; address: string; reason: string }
  | { kind: "missing"; reason: string };
export interface AuthoredOutlink extends EntryBase { kind: "outlink"; referenceKind: "block" | "page" | "work-id"; resolution: AuthoredOutlinkResolution }

export type AuthoredResourceResolution =
  | { kind: "ready"; target: { kind: "resource"; resourceId: string }; sourceName: string; provider: string; addressLabel: string }
  | { kind: "unregistered"; reference: AuthoredResourceReference; reason: string }
  | { kind: "missing"; reason: string };
export interface AuthoredResourceLink extends EntryBase {
  kind: "resource"; resourceId?: string;
  /** The block the Resource is kept as (a Jira ticket the extension owns, PIE-445): ⏎ opens it. */
  recordBlockId?: string;
  /** What the record block is (a ticket kept as a block). */
  facets?: AuthoredTargetFacets;
  resolution: AuthoredResourceResolution;
}

export interface AuthoredLinkGroup<E> { entries: E[]; completeness: AuthoredLinkCompleteness; invalidCount: number; diagnostics: AuthoredLinkDiagnostic[] }

export type AuthoredLinksSnapshot =
  | { kind: "ready"; ownerId: string; ownerTextDigest: string; outlinks: AuthoredLinkGroup<AuthoredOutlink>; resources: AuthoredLinkGroup<AuthoredResourceLink> }
  | { kind: "owner-unavailable"; ownerId: string; reason: "missing" | "deleted" }
  | { kind: "source-too-large"; ownerId: string; maximumUtf16Units: number };

/** What `resources.describe` sends that the door reads: the Resource, its Source and what is stored. */
export interface ResourceDescription {
  resource: { id: string; provider: string; mediaType: string | null; address: Record<string, unknown> & { kind: string }; createdAt: string; updatedAt: string };
  source: { id: string; name: string; provider: string; policy?: { deniedCapabilities?: string[] } };
  filesystem?: { text: string; capturedAt: string; contentHash?: string } | null;
  pdf?: unknown;
  web?: { markdown: string; sourceSnapshot?: { fetchedAt: string | null }; representation?: { contentHash: string } } | null;
  webError?: string;
  remoteEntity?: { title: string; markdown: string; externalUrl: string; metadata: Record<string, string | string[] | null>; sourceSnapshot?: { fetchedAt: string } } | null;
  remoteError?: string;
  computed?: { markdown: string; derivedAt: string } | null;
  /** What the service allows for this Resource here: `refresh.status` is `unavailable` when it won't fetch it. */
  capabilities?: { refresh?: { status: string; reason?: string } };
}


/** Something is stored for the Resource to show: a file's text, a fetched page, a ticket, a computed document. */
export function resourceStored(d: ResourceDescription): boolean {
  return !!(d.filesystem || d.web || d.remoteEntity || d.computed);
}

// ── a Resource shown in a reader ─────────────────────────────────────────────────────────────────────

/** The id a Resource shown as a note carries: never a block id, so nothing writes to it. */
export const RESOURCE_NOTE = "resource:";

/**
 * A note that isn't a block in the outline: a file a preview follows (`file:`) or a Resource shown in a reader
 * (`resource:`). It is read, never edited or asked for its backlinks. A Resource's text takes comments (PIE-650).
 */
/** A view of what's put aside as unsent on a note (its diff, its copy: src/unsent.ts): read here, never written. */
export const UNSENT_NOTE = "unsent:";
export const isOutlineNote = (m: Msg | null | undefined): boolean => !!m && !m.id.startsWith("file:") && !m.id.startsWith(RESOURCE_NOTE) && !m.id.startsWith(UNSENT_NOTE);

const MARKDOWN = new Set([".md", ".markdown", ".mdx", ""]);

/** The service reads a file of at most this many bytes (pi-herdr-outliner src/files.ts `MAX_TEXT_FILE_BYTES`). */
export const SERVICE_FILE_LIMIT = 2 * 1024 * 1024;
/** The most of a Resource's text a reader is given (the surface draws the whole body each paint): a longer one is cut, and says so. */
export const SHOWN_LIMIT = 40_000;

/**
 * Text from outside the outline (a file, a fetched page, a ticket) as the reader may draw it: no terminal
 * controls (an escape sequence in a file would reach the person's terminal), tabs as spaces, CRLF as LF.
 */
export function readable(text: string): string {
  return printable(text.replace(/\r\n?/g, "\n").replace(/\t/g, "  "), "", { lines: true });
}

/** The service read these bytes as UTF-8, but they aren't text: a NUL, or many undecodable bytes. */
export function looksBinary(text: string): boolean {
  const head = text.slice(0, 8000);
  if (head.includes("\0")) return true;
  const bad = head.match(/\uFFFD/g)?.length ?? 0;
  return head.length > 0 && bad / head.length > 0.05;
}

/** A long text cut at a line break before `SHOWN_LIMIT`, and how much was left out. */
function cut(text: string): { text: string; note: string } {
  if (text.length <= SHOWN_LIMIT) return { text, note: "" };
  const at = text.lastIndexOf("\n", SHOWN_LIMIT);
  const shown = text.slice(0, at > 0 ? at : SHOWN_LIMIT);
  const lines = (t: string) => t.split("\n").length;
  return { text: shown, note: `*Showing the first ${lines(shown).toLocaleString("en")} of ${lines(text).toLocaleString("en")} lines · Detail shows the whole file.*\n\n` };
}

/** The address as the service labels it (`resourceAddressLabel`). */
function addressLabel(a: ResourceDescription["resource"]["address"]): string {
  const v = a.path ?? a.url ?? a.key ?? a.identifier ?? a.uri;
  if (typeof v === "string") return v;
  if (a.kind === "github") return `${a.entity} #${a.number}`;
  return a.kind;
}

/**
 * A Resource's stored content as a note the reader draws: a title, a line saying where it's from, then the
 * content (Markdown as it is, any other file in a fence). Nothing stored yet says so.
 */
export function resourceNote(d: ResourceDescription, from?: string): Msg {
  const r = d.resource, where = addressLabel(r.address);
  let title = where, body = "", when = "";
  // The stored text a comment can quote, and where it sits in `body` when `body` draws it as it is.
  let source: { raw: string; hash: string | undefined; at: number | null } | null = null;
  let why: string | undefined;
  if (d.remoteEntity) {
    title = `${where} · ${d.remoteEntity.title}`;
    // The ticket's fields as the provider sent them (status, assignee, …), then its text.
    const fields = Object.entries(d.remoteEntity.metadata).filter(([k, v]) => k !== "key" && v !== null && (!Array.isArray(v) || v.length)).map(([k, v]) => `${k} ${Array.isArray(v) ? v.join(", ") : v}`);
    body = readable((fields.length ? fields.join(" · ") + "\n\n" : "") + cut(d.remoteEntity.markdown.replace(/^# .*\n+/, "")).text);
    when = d.remoteEntity.sourceSnapshot?.fetchedAt ?? "";
    why = "a ticket's fields aren't a text to quote; its block takes comments";
  } else if (d.filesystem) {
    title = basename(where);
    const ext = extname(where).toLowerCase();
    when = d.filesystem.capturedAt;
    if (looksBinary(d.filesystem.text)) { body = `A binary file${r.mediaType ? ` (${r.mediaType})` : ""}: the door shows text files only.`; why = "a binary file has no text to quote"; }
    else {
      const { text, note } = cut(readable(d.filesystem.text));
      // A fence long enough that a fence inside the file doesn't close it.
      const fence = "`".repeat(Math.max(3, ...[...text.matchAll(/^\s*(`{3,})/gm)].map(m => m[1]!.length + 1)));
      const head = note + (MARKDOWN.has(ext) ? "" : fence + ext.slice(1) + "\n");
      body = note + (MARKDOWN.has(ext) ? text : fence + ext.slice(1) + "\n" + text.replace(/\n$/, "") + "\n" + fence);
      source = { raw: d.filesystem.text, hash: d.filesystem.contentHash, at: !note && text === d.filesystem.text ? head.length : null };
    }
  } else if (d.web) {
    const shown = cut(readable(d.web.markdown));
    body = shown.text; when = d.web.sourceSnapshot?.fetchedAt ?? "";
    source = { raw: d.web.markdown, hash: d.web.representation?.contentHash, at: !shown.note && shown.text === d.web.markdown ? 0 : null };
  }
  else if (d.computed) { body = cut(readable(d.computed.markdown)).text; when = d.computed.derivedAt; why = "a computed document isn't stored text to quote"; }
  else if (d.pdf || r.mediaType === "application/pdf") { body = "A PDF: the door doesn't draw PDFs yet. Detail shows it."; why = "a PDF's passages are commented on in Detail"; }
  else if (d.source.policy?.deniedCapabilities?.includes("read")) { body = `The workspace's policy doesn't let ${d.source.name} be read.`; why = "the workspace's policy doesn't let this Resource be read"; }
  // The service reads a file each time it's asked; nothing means it couldn't (src/files.ts `readFileContents`).
  else if (r.provider === "filesystem") { body = `The file can't be read now: it's gone, isn't a regular file, or is over ${SERVICE_FILE_LIMIT / 1024 / 1024} MiB.`; why = "the file can't be read now: its threads stay, but nothing new can be quoted"; }
  else { body = readable(d.remoteError ?? d.webError ?? "Nothing is stored for this Resource yet."); why = "nothing is stored for this Resource yet"; }
  const provider = providerWords(r.provider);
  const said = [d.source.name, d.source.name.toLowerCase().startsWith(provider) ? "" : provider, where !== title ? where : "", when ? `read ${localTime(when)}` : ""].filter(Boolean).join(" · ");
  const at = Date.parse(r.updatedAt) || Date.now();
  const line = (t: string) => readable(t).replace(/\n/g, " ");
  const header = `${line(title)}\n*${line(said)}*\n\n`;
  const commentable = !!source?.hash;
  if (source && !source.hash) why = "the service didn't say which version of the text this is";
  return {
    id: `${RESOURCE_NOTE}${r.id}`, text: header + body, parentId: null, childIds: [], createdAt: Date.parse(r.createdAt) || at, updatedAt: at, author: "resource", props: {},
    ...(commentable ? { revision: resourceTextRevision(source!.hash!) } : {}),
    resource: { id: r.id, ...(from ? { from } : {}), sourceAt: source?.at == null ? null : header.length + source.at, ...(commentable ? {} : { uncommentable: why ?? "nothing to quote here" }) },
  };
}

/**
 * Comments on a Resource's note placed where its text is drawn: the service places a quote in the Resource's own
 * text, and the note has a header (and maybe a fence) before it. A text not drawn as it is has no places.
 */
export function alignComments<C extends { start: number | null; end: number | null }>(comments: C[], on: Msg | null | undefined): C[] {
  const r = on?.resource;
  if (!r) return comments;
  return comments.map(c => ({ ...c, start: r.sourceAt !== null && c.start !== null ? c.start + r.sourceAt : null, end: r.sourceAt !== null && c.end !== null ? c.end + r.sourceAt : null }));
}

/** The same Resource's note read again (its text may have changed), still opened from the note it was opened from. */
export function rereadResource(fresh: Msg, was: Msg): Msg {
  return fresh.resource && was.resource?.from ? { ...fresh, resource: { ...fresh.resource, from: was.resource.from } } : fresh;
}

/** An ISO time as the person's local "YYYY-MM-DD HH:MM". */
function localTime(iso: string): string {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}`;
}

/** Where an authored resource row leads: its registered Resource, one to register first, or why neither. */
export function resourceTarget(link: AuthoredResourceLink): { resourceId: string } | { reference: AuthoredResourceReference } | { refused: string } {
  const r = link.resolution;
  if (r.kind === "ready") return { resourceId: r.target.resourceId };
  if (r.kind === "unregistered") return { reference: r.reference };
  return { refused: `${link.label} · ${r.reason}` };
}

/**
 * Open a Resource as a note: register it when it isn't yet (`resources.follow-authored`), then read what is
 * stored, fetching it once when nothing is (`resources.describe`, `resources.refresh`). One step, as the
 * outliner's Tree's ⏎ is.
 */
export async function openResource<A>(board: { followAuthored(r: AuthoredResourceReference, actor?: A): Promise<{ id: string; created: boolean }>; describeResource(id: string, fetch?: boolean): Promise<ResourceDescription> }, to: { resourceId: string } | { reference: AuthoredResourceReference }, actor?: A, from?: string): Promise<{ note: Msg; registered: boolean }> {
  const followed = "resourceId" in to ? { id: to.resourceId, created: false } : await board.followAuthored(to.reference, actor);
  return { note: resourceNote(await board.describeResource(followed.id, true), from), registered: followed.created };
}

/**
 * What an extension's Resource ref (PIE-754: `file:/path`, `web:https://…`, `resource:<id>`, outline-core's
 * resource-ref.ts) opens, as `openResource` takes it; why not when it can't be used.
 */
export function resourceRefTarget(ref: string): { resourceId: string } | { reference: AuthoredResourceReference } | { refused: string } {
  const r = parseResourceRef(ref);
  if ("problem" in r) return { refused: r.problem };
  if (r.kind === "resource") return { resourceId: r.resourceId };
  return { reference: r.kind === "filesystem" ? { kind: "filesystem", path: r.path } : { kind: "web", url: r.url } };
}

// ── the rows' words ──────────────────────────────────────────────────────────────────────────────────

/** A Work ID needs a token boundary: PIE-18 is not a prefix of PIE-181 (PIE-329). */
export const redundantLabel = (label: string, title: string) =>
  label === title || (/^[A-Z][A-Z0-9]*-\d+$/i.test(label) && title.startsWith(label) && /^(?:\s|[—–:])/u.test(title.slice(label.length)));

const occurrences = (n: number) => (n > 1 ? `${n} occurrences` : "");

/** An outlink's row: its text (the target, once) and dim context (fragment, reference kind, count, or why). */
export function outlinkWords(l: AuthoredOutlink): { text: string; context: string; problem: boolean } {
  const r = l.resolution, label = l.label.trim();
  if (r.kind === "ready") {
    const title = r.title.trim();
    return { text: redundantLabel(label, title) ? title : `${label} → ${title}`, context: [r.target.fragmentId ? `^${r.target.fragmentId}` : "", l.referenceKind, occurrences(l.occurrenceCount)].filter(Boolean).join(" · "), problem: false };
  }
  if (r.kind === "deleted") return { text: redundantLabel(label, r.title) ? r.title : `${label} → ${r.title}`, context: ["Trash", l.referenceKind, occurrences(l.occurrenceCount)].filter(Boolean).join(" · "), problem: false };
  if (r.kind === "unregistered-page") return { text: label, context: ["page not registered", occurrences(l.occurrenceCount)].filter(Boolean).join(" · "), problem: true };
  return { text: label, context: [`unavailable: ${r.reason}`, occurrences(l.occurrenceCount)].filter(Boolean).join(" · "), problem: true };
}

/** A resource's row: its label and dim context (where it's registered, or that ⏎ registers it, or why not). */
/** A provider as people read it: an extension's by its id (`ext:jira` → `jira`), a built-in one as it is. */
export const providerWords = (provider: string): string => provider.startsWith("ext:") ? provider.slice(4) : provider;

export function resourceWords(l: AuthoredResourceLink): { text: string; context: string; problem: boolean } {
  const r = l.resolution;
  const n = occurrences(l.occurrenceCount);
  // A file reads as its name; the rest of its path is context (a tree row is narrow).
  const file = (r.kind === "ready" && r.provider === "filesystem") || (r.kind === "unregistered" && r.reference.kind === "filesystem");
  const text = file && l.label.includes("/") ? basename(l.label) : l.label;
  const dir = text !== l.label ? dirname(l.label) : "";
  if (r.kind === "ready") return { text, context: [`${r.sourceName} · ${providerWords(r.provider)}`, r.addressLabel !== text ? r.addressLabel : "", l.recordBlockId ? "⏎ opens the ticket" : "", n].filter(Boolean).join(" · "), problem: false };
  if (r.kind === "unregistered") return { text, context: ["not registered · ⏎ registers and shows it", dir, n].filter(Boolean).join(" · "), problem: false };
  return { text, context: [`unavailable: ${r.reason}`, n].filter(Boolean).join(" · "), problem: true };
}

/** A group's dim state, as the Tree's header says it: its count's extras (invalid, limited, diagnostics). */
export function groupNote(g: AuthoredLinkGroup<unknown>): string {
  const parts: string[] = [];
  if (g.invalidCount > 0) parts.push(`${g.invalidCount} invalid reference${g.invalidCount === 1 ? "" : "s"}`);
  if (g.completeness.kind === "limited") parts.push("results limited");
  if (g.diagnostics.length) parts.push(g.diagnostics.map(d => d.message).join("; "));
  return parts.join(" · ");
}

/** Whether an Outlinks or Resources group is shown: the Tree hides one with nothing to say (Backlinks always shows). */
export const groupHasSomething = (g: AuthoredLinkGroup<unknown>) => g.entries.length > 0 || g.invalidCount > 0 || g.diagnostics.length > 0 || g.completeness.kind === "limited";

/** Why a snapshot has no groups (the owner is gone or too long), or null. */
export function snapshotProblem(s: AuthoredLinksSnapshot): string | null {
  if (s.kind === "owner-unavailable") return s.reason === "deleted" ? "the note is in the Trash" : "the note is missing";
  if (s.kind === "source-too-large") return `the note is longer than ${s.maximumUtf16Units} UTF-16 units`;
  return null;
}

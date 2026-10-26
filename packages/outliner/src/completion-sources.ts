// `completion.rows` (PIE-1340, ADR 0004 §4): the service's completion sources, each answering on outline-core's one row
// contract (completion-source.ts), and the extensions' completion sources beside them. The service sources are the
// lookups the door's completer used to branch on (pages, blocks and their fragments, files, agents), moved here so
// Detail and the door ask the same ones: a client merges these answers with its own sources' (`mergeSourceAnswers`).
// Each source asks the service's own read actions (`pages.complete`, `tree.search`, `fragments.candidates`,
// `files.complete`, `blocks.context`, `extensions.list`); none keeps an index or a ranking of its own.
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { pageAddressCompletion, pageCompletionLookupQuery, parseFragmentCompletionQuery, type PageAddressMatch } from "@ep0ch/outline-core/completion-triggers";
import { pickKey, sourceAnswers, triggerOf, type Picks, type SourceAsk, type SourceDecl, type SourceRow } from "@ep0ch/outline-core/completion-source";
import { qualifiedReference, tryNormalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import type { CompletionRowsRequest, CompletionRowsResult, CompletionSourceAnswer, ExtensionCompletionSource } from "@ep0ch/outline-core/protocol";

/** At most this many candidates per lookup. */
export const COMPLETION_LIMIT = 20;
/** How long an extension's completion source has before the list goes on without it. */
const EXTENSION_SOURCE_MS = 1500;
/** Where the picks are kept (the metadata table: not note content). */
export const PICKS_METADATA_KEY = "completion.picks";

/** The service's own reads, as the sources ask them. */
export interface CompletionService { request<T>(action: string, input: Record<string, unknown>): Promise<T> }

interface Search { matches: { block: { id: string }; title: string; subtitle?: string; path: string; snippet: string; reason?: "linked" | "near" | "yours" }[]; completeness: { kind: string; limit?: number | null }; semantic?: { status: string; message?: string } }
interface Pages { outlines?: string[]; addresses: PageAddressMatch[]; completeness: { kind: string; limit?: number | null }; semantic?: { status: string; message?: string } }
interface Fragment { blockId: string; title: string; revision: number; kind: string; label: string; lineIndex: number; fragmentId?: string; anchor?: { fragmentId: string; line: string } }
interface Fragments { items: Fragment[]; completeness: { kind: string; limit?: number | null } }
interface Wire { id: string; text: string; title?: string }

/** What a service source is asked: the ask, plus the draft and the note it writes in. */
interface Asked extends SourceAsk { near?: string; draft?: { blockId: string; text: string }; offset?: number; semantic?: boolean; prefix: string | null }
type Answer = Omit<CompletionSourceAnswer, "source">;
interface ServiceSource { decl: SourceDecl; rows(ask: Asked, svc: CompletionService): Promise<Answer> }

const notConfigured = (s?: { status: string; message?: string }) => s?.status === "unavailable" && /not configured/i.test(s.message ?? "");
const REASON = { linked: "linked from here", near: "near here", yours: "you edited" } as const;
const clean = (lines: string[]) => lines.map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim();
/** The service's snippet of a hit, its first line left out when it's the title the row already shows. */
const hitSnippet = (title: string, text: string) => {
  const lines = text.split(/\r?\n/);
  return clean(withoutPropertyTokens(lines[0] ?? "").trim().startsWith(title.slice(0, 24)) ? lines.slice(1) : lines);
};

/**
 * `[[Seed swap` naming no page yet (PIE-592): a last row offers it new, `[[Seed swap]]` written and the page made in one
 * choice. Not for an address a page already has, one no page can have, or a Work ID's shape.
 */
function newPageRow(query: string, have: readonly { address: string }[], prefix: string | null): SourceRow | null {
  const bar = query.indexOf("|"), named = (bar < 0 ? query : query.slice(0, bar)).trim(), label = bar < 0 ? "" : query.slice(bar + 1).trim();
  const wanted = tryNormalizePageAddress(named);
  if (!wanted || /^[A-Z][A-Z0-9]*-\d+$/.test(named) || (prefix && named.toUpperCase().startsWith(prefix.toUpperCase()))) return null;
  if (have.some(a => tryNormalizePageAddress(a.address)?.normalizedAddress === wanted.normalizedAddress)) return null;
  return { label: `new page · ${named}`, filter: named, insert: label ? `[[${named}|${label}]]` : `[[${named}]]`, kind: "new", newPage: named, fallback: true, docs: "made where new notes go when you choose it · ctrl+l then opens it beside" };
}

/**
 * `[[Spring plan^` (PIE-1247): the parts of the page the address names, as `((note^` lists a note's, each written
 * `[[Spring plan^anchor]]` (an anchor added where it has none). Null when the address before `^` names no page, so a
 * page whose name holds a `^` is still found by its name.
 */
async function pageFragmentRows(ask: Asked, svc: CompletionService): Promise<Answer | null> {
  const caret = ask.query.lastIndexOf("^");
  if (caret <= 0 || ask.query.includes("|")) return null;
  const address = ask.query.slice(0, caret).trim(), part = ask.query.slice(caret + 1);
  if (!/^[A-Za-z0-9_-]*$/.test(part) || !tryNormalizePageAddress(address)) return null;
  const page = await svc.request<{ status: string; block?: { id: string } }>("pages.resolve", { address }).catch(() => null);
  if (page?.status !== "resolved" || !page.block) return null;
  const r = await svc.request<Fragments>("fragments.candidates", { query: { blockIds: [page.block.id], fragmentQuery: part, mode: "passage", limit: ask.limit || COMPLETION_LIMIT, ...(ask.draft ? { draft: ask.draft } : {}) } });
  return {
    rows: r.items.map(c => ({ ...fragmentRow(c, true), insert: `[[${address}^${c.fragmentId ?? c.anchor!.fragmentId}]]` })),
    heading: `in ${address}`, empty: `nothing in ${address} matches ${JSON.stringify(part)}`,
  };
}

const pages: ServiceSource = {
  decl: { id: "pages", title: "pages", triggers: ["[["], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const parts = await pageFragmentRows(ask, svc);
    if (parts) return parts;
    const r = await svc.request<Pages>("pages.complete", {
      ...(pageCompletionLookupQuery(ask.query, ask.prefix) ? { query: pageCompletionLookupQuery(ask.query, ask.prefix) } : {}), limit: COMPLETION_LIMIT,
      ...(ask.semantic ? { semantic: true } : {}), ...(ask.near ? { contextBlockId: ask.near } : {}),
    });
    const rows: SourceRow[] = (r.outlines ?? []).map(name => ({ label: `${name}:`, insert: `[[${name}:`, kind: "outline", docs: `the outline ${name}: its pages next` }));
    for (const a of r.addresses) {
      const { label, insertion } = pageAddressCompletion(a, ask.query, ask.prefix);
      rows.push({ label, insert: insertion, ...(a.subtitle ? { detail: a.subtitle } : {}), blockId: a.blockId, address: a.address, kind: a.kind, filter: a.address });
    }
    const made = qualifiedReference(ask.query).outline ? null : newPageRow(ask.query, r.addresses, ask.prefix);
    if (made) rows.push(made);
    return {
      rows, ...(r.completeness.kind === "truncated" ? { truncated: r.completeness.limit ?? COMPLETION_LIMIT } : {}),
      ...(made && rows.length === 1 ? { partial: `no page is named ${made.newPage} yet · ↓ then ⏎ makes it` } : {}),
      empty: "no matching named addresses; [[target|label]] labels a target, ((...)) searches blocks",
      ...(r.semantic?.status === "ranked" ? { jev: "ranked" as const } : {}), ...(notConfigured(r.semantic) ? { jevOff: true } : {}),
    };
  },
};

/** How many of the top notes a `((words` list shows the anchors of, and how many each. */
const ANCHORED_NOTES = 4, ANCHORS_PER_NOTE = 3;
/**
 * The parts of the first note `((words` lists under it with no anchor yet (PIE-592; components and list items,
 * PIE-1247), and how many: chosen in this order, so a long note's figures and callouts come before its many list items.
 */
const EMBEDDABLE = ["component", "callout", "heading", "quote", "list-item"], PARTS_OF_TOP = 6, PASSAGES_ASKED = 100;
/** How many notes `((words^` and `((words#` search inside: the first ones `((words` listed. */
const NOTES_SEARCHED = 3;

/**
 * A fragment as a row: an anchor it has already leads the row (`^a10  Greenhouse meeting » We agreed…`); one without
 * says the anchor choosing it adds. `under`: listed under its note's own row, so the note's title isn't repeated.
 */
function fragmentRow(c: Fragment, oneNote: boolean, under = false): SourceRow {
  const id = c.fragmentId ?? c.anchor!.fragmentId;
  const what = c.kind === "heading" ? `# ${c.label}` : c.kind === "quote" ? `> ${c.label}` : c.kind === "callout" ? `[!] ${c.label}`
    : c.kind === "component" ? (c.label.startsWith("::") ? c.label : `:: ${c.label}`) : c.kind === "list-item" ? `- ${c.label}` : c.label;
  const where = oneNote || under ? "" : `${c.title} » `;
  return {
    label: c.fragmentId ? `${under ? "  " : ""}^${id}  ${where}${what}` : `${under ? "  " : ""}${where}${what} · adds ^${id}`, ...(under ? { under: true } : {}),
    blockId: c.blockId, fragmentId: id, passageLine: c.lineIndex,
    ...(!c.fragmentId ? { addition: ` · adds ^${id}` } : {}), kind: c.fragmentId ? "anchor" : c.kind, insert: `((${c.blockId}^${id}))`,
    docs: `${c.kind} in ${c.title}${c.fragmentId ? "" : `: choosing it adds ^${id} to that line`}`,
    ...(c.anchor ? { anchor: { lineIndex: c.lineIndex, line: c.anchor.line, revision: c.revision } } : {}),
  };
}

const blocks: ServiceSource = {
  decl: { id: "blocks", title: "references", triggers: ["(("], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const fragment = parseFragmentCompletionQuery(ask.query), draft = ask.draft ? { draft: ask.draft } : {};
    const anchors = (query: Record<string, unknown>) => svc.request<Fragments>("fragments.candidates", { query }).catch(() => null);
    const search = (query: string, semantic = ask.semantic) => svc.request<Search>("tree.search", {
      query, ...(ask.limit ? { limit: ask.limit } : {}), ...(semantic ? { semantic: true } : {}), ...(ask.near ? { contextBlockId: ask.near } : {}),
    });
    if (fragment) {
      // `((note#…` / `((note^…`: a block id is that one note; words are the notes `((words` listed; nothing is every note.
      const note = fragment.blockQuery;
      let blockIds: string[] | undefined;
      if (BLOCK_ID_PATTERN.test(note)) blockIds = [note];
      else if (note) {
        blockIds = (await search(note, false)).matches.slice(0, NOTES_SEARCHED).map(m => m.block.id);
        if (!blockIds.length) return { rows: [], empty: `no note matches ${JSON.stringify(note)}` };
      }
      const mode = blockIds ? (fragment.mode === "id" ? "passage" : "heading") : fragment.mode;
      const r = await svc.request<Fragments>("fragments.candidates", { query: { ...(blockIds ? { blockIds } : {}), fragmentQuery: fragment.fragmentQuery, mode, limit: ask.limit || COMPLETION_LIMIT, ...(ask.offset ? { offset: ask.offset } : {}), ...draft } });
      const one = blockIds?.length === 1, title = one ? r.items[0]?.title : undefined;
      const truncated = r.completeness.kind === "truncated" ? r.completeness.limit ?? COMPLETION_LIMIT : null;
      return {
        rows: r.items.map(c => fragmentRow(c, one)), truncated, ...(truncated ? { partial: `showing the first ${truncated} fragments` } : {}),
        empty: one ? `nothing in that note matches ${JSON.stringify(fragment.fragmentQuery)}${mode === "heading" ? "; ^ searches its passages too" : ""}` : "no matching fragments",
        ...(one ? { heading: title ? `in ${title}` : "in that note" } : {}),
      };
    }
    // `((words`: the one search, and (PIE-762) the anchors that are valid targets already: an anchor whose id starts
    // with what's typed first, then each top note followed by its own anchors, then the other notes.
    const q = ask.query.trim(), anchored = q.length >= 2;
    const [r, named] = await Promise.all([
      search(ask.query),
      anchored && /^[A-Za-z0-9_-]+$/.test(q) ? anchors({ fragmentQuery: q, mode: "id", limit: COMPLETION_LIMIT, ...draft }) : null,
    ]);
    const notes: SourceRow[] = r.matches.map(m => ({
      label: m.title, blockId: m.block.id, kind: "block", insert: `((${m.block.id}))`,
      ...(m.subtitle || m.reason ? { detail: [m.subtitle, m.reason ? REASON[m.reason] : ""].filter(Boolean).join(" · ") } : {}),
      docs: [m.path, hitSnippet(m.title, m.snippet)].filter(Boolean).join(" » "),
    }));
    const top = notes.slice(0, ANCHORED_NOTES).map(n => n.blockId!);
    const [theirs, parts] = anchored && top.length ? await Promise.all([
      anchors({ blockIds: top, fragmentQuery: "", mode: "id", limit: COMPLETION_LIMIT, ...draft }),
      anchors({ blockIds: top.slice(0, 1), fragmentQuery: "", mode: "passage", limit: PASSAGES_ASKED, ...draft }),
    ]) : [null, null];
    const rows: SourceRow[] = [], seen = new Set<string>(), lower = q.toLowerCase();
    const add = (row: SourceRow) => { const t = row.insert as string; if (!seen.has(t)) { seen.add(t); rows.push(row); } };
    for (const c of named?.items ?? []) if (c.fragmentId?.toLowerCase().startsWith(lower) && rows.length < 3) add({ ...fragmentRow(c, false), filter: c.fragmentId });
    for (const n of notes) {
      add(n);
      for (const c of (theirs?.items ?? []).filter(c => c.blockId === n.blockId && c.fragmentId).slice(0, ANCHORS_PER_NOTE)) add({ ...fragmentRow(c, false, true), filter: n.label });
      // Chosen by kind (figures and callouts first), listed in reading order.
      const offered = (parts?.items ?? []).filter(c => c.blockId === n.blockId && !c.fragmentId && EMBEDDABLE.includes(c.kind))
        .sort((a, b) => EMBEDDABLE.indexOf(a.kind) - EMBEDDABLE.indexOf(b.kind) || a.lineIndex - b.lineIndex).slice(0, PARTS_OF_TOP);
      for (const c of offered.sort((a, b) => a.lineIndex - b.lineIndex)) add({ ...fragmentRow(c, false, true), filter: n.label });
    }
    return {
      rows, truncated: r.completeness.kind === "truncated" ? r.completeness.limit ?? r.matches.length : null, empty: "no matching blocks",
      ...(r.semantic?.status === "ranked" ? { jev: "ranked" as const } : {}), ...(notConfigured(r.semantic) ? { jevOff: true } : {}),
    };
  },
};

const files: ServiceSource = {
  decl: { id: "files", title: "files", triggers: ["[file::"], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const found = await svc.request<{ sourcePath: string; isDirectory: boolean }[]>("files.complete", { prefix: ask.query });
    return {
      rows: found.slice(0, COMPLETION_LIMIT).map(f => ({ label: f.sourcePath, kind: f.isDirectory ? "folder" : "file", insert: `[file::${f.sourcePath}${f.isDirectory ? "" : "]"}` })),
      ...(found.length > COMPLETION_LIMIT ? { truncated: COMPLETION_LIMIT } : {}), empty: "no matching files",
    };
  },
};

interface Listed { extensions: { state: string; directory?: string; handlers: { key: string; kind: string; description?: string }[]; agents?: { name: string; description?: string; threads?: boolean }[]; script?: { blockId?: string; file?: string; code: string } }[] }

const agents: ServiceSource = {
  decl: { id: "agents", title: "agents", triggers: ["@"], priority: 10, by: "service" },
  async rows(ask, svc) {
    const listed = await svc.request<Listed>("extensions.list", {});
    const all = listed.extensions.filter(e => e.state === "active" || e.state === "failed").flatMap(extension => (extension.agents ?? []).map(agent => ({ ...agent, extension })));
    const rows = await Promise.all(all.map(async (a): Promise<SourceRow> => {
      const script = a.extension.script;
      const note = script?.blockId ? (await svc.request<{ selected: Wire | null }>("blocks.context", { blockId: script.blockId }).catch(() => ({ selected: null }))).selected : null;
      const definition = script ? note ? [`[g] ${note.title ?? note.text.split("\n")[0]} ((${note.id}))`, ...note.text.split("\n").slice(1)] : [script.file ?? "", ...script.code.split("\n")]
        : [a.extension.directory ?? "", `handler @${a.name}`, ...a.extension.handlers.map(h => `${h.key}:: ${h.description ?? h.kind}`)];
      const context = a.threads ? "in a note, or a comment on a passage: its answer lands in that thread" : "runs on the text above this line once the line is quiet (1.5 s), as an attributed edit · r on the line asks again";
      return {
        label: `@${a.name}`, insert: `@${a.name} `, kind: "agent", ...(a.description ? { detail: a.description } : {}),
        docs: [context, "", ...definition.slice(0, 40)].join("\n"), ...(note ? { definition: note.id } : {}),
      };
    }));
    return { rows, empty: all.length ? `no agent is called @${ask.query}: ${all.map(a => `@${a.name}`).join(", ")} answer here` : "" };
  },
};

/** The service's sources, in the order their rows come among equals. */
export const SERVICE_SOURCES: readonly ServiceSource[] = [pages, blocks, files, agents];

/** An extension's completion source answering through its `source` operation (`ExtensionCalls.complete`). */
export type AskExtension = (source: ExtensionCompletionSource, ask: Asked, signal: AbortSignal) => Promise<SourceRow[]>;

/**
 * Every service-side source the token's trigger reaches, asked at once: the built-ins and the extensions' completion
 * sources. A source that fails or runs past its time answers no rows and says why (`problem`); the others still answer.
 */
export async function completionRows(svc: CompletionService, request: CompletionRowsRequest, extensions: readonly ExtensionCompletionSource[], askExtension: AskExtension, picks: Picks): Promise<CompletionRowsResult> {
  const t = request.target, trigger = triggerOf(t.kind);
  const prefix = await svc.request<{ workIdPrefix?: string }>("references.resolve", { text: "" }).then(r => r.workIdPrefix ?? null, () => null);
  const ask: Asked = {
    trigger, kind: t.kind, query: t.query, ...(t.key ? { key: t.key } : {}), ...(t.component ? { component: t.component } : {}),
    limit: request.limit ?? COMPLETION_LIMIT, prefix, ...(request.near ? { near: request.near } : {}), ...(request.draft ? { draft: request.draft } : {}),
    ...(request.offset ? { offset: request.offset } : {}), ...(request.semantic ? { semantic: true } : {}),
  };
  const asks: Promise<CompletionSourceAnswer>[] = [];
  for (const s of SERVICE_SOURCES) if (sourceAnswers(s.decl, ask)) {
    // A source that fails says so in its own answer: the others' rows still come.
    asks.push(s.rows(ask, svc).then(a => ({ source: s.decl, ...a }), error => ({ source: s.decl, rows: [], problem: `${s.decl.title}: ${error instanceof Error ? error.message : String(error)}` })));
  }
  for (const e of extensions) if (sourceAnswers(e, ask)) {
    const decl = { id: e.name, title: e.title, priority: 0, by: e.extension };
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(new Error("took too long")), EXTENSION_SOURCE_MS);
    asks.push(askExtension(e, ask, controller.signal).then(
      rows => ({ source: decl, rows }),
      error => ({ source: decl, rows: [], problem: `${e.title}: ${controller.signal.aborted ? `no answer in ${EXTENSION_SOURCE_MS / 1000}s` : error instanceof Error ? error.message : String(error)}` }),
    ).finally(() => clearTimeout(timer)));
  }
  return { answers: await Promise.all(asks), picks: picks[pickKey(ask)] ?? {} };
}

/** The picks the outline keeps, read from their metadata value; a value that can't be read is no picks. */
export function readPicks(raw: string | undefined): Picks {
  if (!raw) return {};
  try { const v = JSON.parse(raw); return v && typeof v === "object" && !Array.isArray(v) ? v as Picks : {}; } catch { return {}; }
}


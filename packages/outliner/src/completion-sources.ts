// `completion.rows` (PIE-1340, ADR 0004 §4): the service's completion sources, each answering on outline-core's one row
// contract (completion-source.ts), and the extensions' completion sources beside them. The service sources are the
// lookups the door's completer used to branch on (pages, blocks and their fragments, files, agents; components,
// properties and callout types, PIE-1344; a filter's keys and values, a figure's YAML values and a component's
// attributes, PIE-1366), moved here so Detail, Tree, Quick Capture and the door ask the same ones: a
// client merges these answers with its own sources' (`mergeSourceAnswers`). Each source asks the service's own read
// actions (`pages.complete`, `tree.search`, `fragments.candidates`, `files.complete`, `blocks.context`,
// `extensions.list`, `components.schemas`, `components.usage`, `properties.catalog`, `callouts.types`); none keeps an
// index or a ranking of its own. What a row draws is the client's: a row says what to draw (`example`).
import { BLOCK_ID_PATTERN } from "@ep0ch/outline-core/addressable-resource";
import { workIdTitle } from "@ep0ch/outline-core/work-id-title";
import { pageAddressCompletion, pageCompletionLookupQuery, parseFragmentCompletionQuery, type PageAddressMatch } from "@ep0ch/outline-core/completion-triggers";
import { pickKey, sourceAnswers, triggerOf, VALUE_TRIGGERS, type Picks, type SourceAsk, type SourceDecl, type SourceRow } from "@ep0ch/outline-core/completion-source";
import { FRAGMENT_ID_SOURCE, qualifiedReference, tryNormalizePageAddress } from "@ep0ch/outline-core/link-syntax";
import { withoutPropertyTokens } from "@ep0ch/outline-core/property-grammar";
import type { CompletionRowsRequest, CompletionRowsResult, CompletionSourceAnswer, ExtensionCompletionSource, QuestionFacet, SearchCertainty } from "@ep0ch/outline-core/protocol";
import { axisValues, keyCandidates, sweep, valueCandidates, variation, yamlKeyCandidates, yamlScalar, attributeScalar, type ComponentSchema, type PropSchema, type PropertyCandidate } from "@ep0ch/outline-core/component-schema";
import { blockReferenceOccurrences } from "@ep0ch/outline-core/link-syntax";
import { querySuggestions } from "@ep0ch/outline-core/query-suggestions";
import type { PropsSpec } from "@ep0ch/outline-core/site";
import { COMPONENT_OPEN } from "@ep0ch/outline-core/component-block";
import { propSchemaOfField } from "@ep0ch/outline-core/script-component";
import { calloutRegistry, type CalloutType } from "@ep0ch/outline-core/callouts";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import { matchesSearchText, rankTextSearchMatches } from "@ep0ch/outline-core/search-match";

/** At most this many candidates per lookup. */
export const COMPLETION_LIMIT = 20;
/** How long an extension's completion source has before the list goes on without it. */
const EXTENSION_SOURCE_MS = 1500;
/** Where the picks are kept (the metadata table: not note content). */
export const PICKS_METADATA_KEY = "completion.picks";

/** The service's own reads, as the sources ask them. */
export interface CompletionService { request<T>(action: string, input: Record<string, unknown>): Promise<T> }

type Semantic = { status: string; message?: string } & Partial<SearchCertainty>;
interface Search { matches: { block: { id: string }; title: string; subtitle?: string; path: string; snippet: string; score?: number; reason?: "linked" | "near" | "yours" }[]; completeness: { kind: string; limit?: number | null }; semantic?: Semantic }
interface Pages { outlines?: string[]; addresses: PageAddressMatch[]; completeness: { kind: string; limit?: number | null }; semantic?: Semantic }
/** How sure a ranked list is, as the service decided it (search-ranking.ts), for the list to say. */
const sureOf = (semantic: Semantic | undefined): { sure?: SearchCertainty } => semantic?.status === "ranked" && semantic.verdict ? { sure: { verdict: semantic.verdict, said: semantic.said ?? "", ...(semantic.label ? { label: semantic.label } : {}), ...(semantic.exists !== undefined ? { exists: semantic.exists } : {}), ...(semantic.top !== undefined ? { top: semantic.top } : {}) } } : {};
/** A ranked row's Score, beside what the row already says. */
const scored = (detail: string | undefined, score: number | undefined) => [detail, score !== undefined ? `${score.toFixed(1)}/3` : ""].filter(Boolean).join(" · ") || undefined;
interface Fragment { blockId: string; title: string; revision: number; kind: string; label: string; lineIndex: number; fragmentId?: string; anchor?: { fragmentId: string; line: string } }
interface Fragments { items: Fragment[]; completeness: { kind: string; limit?: number | null } }
interface Wire { id: string; text: string; title?: string }

/** What a service source is asked: the ask, plus the draft and the note it writes in. */
interface Asked extends SourceAsk, Pick<CompletionRowsRequest["target"], "headingShort" | "attrs" | "quote" | "existingValue" | "words"> {
  near?: string; draft?: { blockId: string; text: string }; offset?: number; semantic?: boolean; prefix: string | null;
}
type Answer = Omit<CompletionSourceAnswer, "source">;
interface ServiceSource { decl: SourceDecl; rows(ask: Asked, svc: CompletionService): Promise<Answer> }

const notConfigured = (s?: { status: string; message?: string }) => s?.status === "unavailable" && /not configured/i.test(s.message ?? "");
const REASON = { linked: "linked from here", near: "near here", yours: "you edited" } as const;
const clean = (lines: string[]) => lines.map(withoutPropertyTokens).join(" ").replace(/\s+/g, " ").trim();
/**
 * The service's snippet of a hit, its first line left out when it's the title the row already shows: the title as
 * written, or (a Work ID put first, `HUB-062 · …`, outline-core's headedTitle) the same words after that ID.
 */
const hitSnippet = (title: string, text: string) => {
  const lines = text.split(/\r?\n/), first = withoutPropertyTokens(lines[0] ?? "").trim();
  const dot = title.indexOf(" · "), id = dot > 0 ? title.slice(0, dot) : null;
  const same = first.startsWith(title.slice(0, 24)) || (id !== null && workIdTitle(first, id).title.startsWith(title.slice(dot + 3, dot + 3 + 24)));
  return clean(same ? lines.slice(1) : lines);
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
  if ((part && !new RegExp(`^${FRAGMENT_ID_SOURCE}$`).test(part)) || !tryNormalizePageAddress(address)) return null;
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
      const detail = scored(a.subtitle, a.score);
      rows.push({ label, insert: insertion, ...(detail ? { detail } : {}), blockId: a.blockId, address: a.address, kind: a.kind, filter: a.address });
    }
    const made = qualifiedReference(ask.query).outline ? null : newPageRow(ask.query, r.addresses, ask.prefix);
    if (made) rows.push(made);
    return {
      rows, ...(r.completeness.kind === "truncated" ? { truncated: r.completeness.limit ?? COMPLETION_LIMIT } : {}),
      ...(made && rows.length === 1 ? { partial: `no page is named ${made.newPage} yet · ↓ then ⏎ makes it` } : {}),
      empty: "no matching named addresses; [[target|label]] labels a target, ((...)) searches blocks",
      ...(r.semantic?.status === "ranked" ? { jev: "ranked" as const } : {}), ...sureOf(r.semantic), ...(notConfigured(r.semantic) ? { jevOff: true } : {}),
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
      ...(m.subtitle || m.reason || m.score !== undefined ? { detail: scored([m.subtitle, m.reason ? REASON[m.reason] : ""].filter(Boolean).join(" · "), m.score) } : {}),
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
      ...(r.semantic?.status === "ranked" ? { jev: "ranked" as const } : {}), ...sureOf(r.semantic), ...(notConfigured(r.semantic) ? { jevOff: true } : {}),
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

interface Listed { extensions: { state: string; name?: string; description?: string; directory?: string; handlers: { key: string; kind: string; description?: string }[]; agents?: { name: string; description?: string; threads?: boolean }[]; script?: { blockId?: string; file?: string; code: string } }[] }

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

/** The component the schema writes (`graph-stat` for `::graph-stat`), or null for one written another way (a heading style). */
const componentName = (schema: ComponentSchema) => COMPONENT_OPEN.exec(schema.source.use.split("\n")[0]!)?.[1] ?? null;
const titleOf = (schema: ComponentSchema) => schema.title.replace(/ \(::.*\)$/, "");
const schemasOf = (svc: CompletionService) => svc.request<{ schemas: ComponentSchema[] }>("components.schemas", {}).then(r => r.schemas);

/** The property keys a component's example names: those the note being written (or the one it's about) carries. */
async function noteKeys(ask: Asked, svc: CompletionService): Promise<string[]> {
  const text = ask.draft?.text ?? (ask.near ? (await svc.request<{ selected: Wire | null }>("blocks.context", { blockId: ask.near }).catch(() => ({ selected: null }))).selected?.text : undefined);
  return [...new Set(parsePropertyRecords(text ?? "").map(p => p.key))];
}

/** A schema whose property-typed props sample the note's own keys, so its example names one of them. */
function contextualSchema(schema: ComponentSchema, keys: string[]): ComponentSchema {
  if (!keys.length) return schema;
  const props = schema.props.map(p => p.type === "property" ? { ...p, samples: keys } : p);
  const example = { ...schema.example };
  for (const p of props) if (p.type === "property" && example[p.key] !== undefined) example[p.key] = keys[0]!;
  return { ...schema, props, example };
}

/** A variation as a row: its source written, the first YAML value selected so the next keys replace it. */
function variationRow(schema: ComponentSchema, v: ReturnType<typeof variation>, label: string): SourceRow {
  const yaml = v.use.indexOf("\n---\n");
  const first = yaml >= 0 ? /^([^:\n]+:[ \t]*)([^\n]+)$/m.exec(v.use.slice(yaml + 5)) : null;
  const at = first ? yaml + 5 + first.index + first[1]!.length : -1;
  return {
    label, kind: "component", group: schema.group, component: schema.id,
    insert: at >= 0 ? { snippet: v.use, select: { start: at, end: at + first![2]!.length } } : v.use,
    docs: `${titleOf(schema)}: ${schema.intro.split(/\n|,|(?<=\.) /)[0]!.replace(/[`*_]/g, "")}`,
    example: { use: v.use, ...(v.note ? { note: v.note } : {}) },
  };
}

// The component schemas (PIE-618, `components.schemas`): the answer the library draws its pages from, no list of its
// own. Grouped, used ones first: it orders its own rows (the matcher still ranks what's typed).
const components: ServiceSource = {
  decl: { id: "components", title: "components", triggers: ["::"], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const [schemas, recent, keys] = await Promise.all([schemasOf(svc), svc.request<Record<string, number>>("components.usage", {}), noteKeys(ask, svc)]);
    const all = schemas.flatMap(schema => { const id = componentName(schema); return id ? [{ id, title: `${id} ${schema.title}`, text: schema.intro, schema }] : []; });
    const q = ask.query.trim();
    const ordered = q ? rankTextSearchMatches(all.filter(c => matchesSearchText(q, [c.id, c.title, c.text])), q).map(m => m.document)
      : all.sort((a, b) => (recent[b.id] ?? 0) - (recent[a.id] ?? 0));
    const groupOf = (c: typeof all[number]) => `${c.schema.group}${recent[c.id] !== undefined ? " · used" : ""}`;
    const groups = [...new Set(ordered.map(groupOf))];
    const rows: SourceRow[] = groups.flatMap(group => ordered.filter(c => groupOf(c) === group).map(({ id, schema: original }): SourceRow => {
      const schema = contextualSchema(original, keys), seen = new Set<string>();
      const swept = schema.sweep.flatMap(axis => sweep(schema, axis).flatMap(v => {
        if (seen.has(v.use)) return [];
        seen.add(v.use);
        return [variationRow(schema, v, v.use.replace(/\n/g, " "))];
      }));
      // Its arguments, each written `::name{key=""}` with the cursor between the quotes.
      const args = schema.props.map((p): SourceRow => {
        const text = `::${id}{${p.key}=""}`;
        return { label: p.key, detail: p.type, docs: p.meaning, kind: "property", insert: { snippet: text, select: { start: text.length - 2, end: text.length - 2 } } };
      });
      const definition = noteOf(original);
      return { ...variationRow(schema, variation(schema, {}), titleOf(schema)), id, group, filter: id, ...(definition ? { definition } : {}), variations: [...swept, ...args] };
    }));
    const made = newComponentRow(q, all.map(c => c.id));
    if (made) rows.push(made);
    return { rows };
  },
};

/** The note a note component's script is in (its origin `note:((id))`): `g` on its row opens it beside. */
const noteOf = (schema: ComponentSchema) => /^note:\(\(([^()\s]+)\)\)$/.exec(schema.origin ?? "")?.[1];

/**
 * `::stale` naming no component yet: a row offers it new, its starter note written under [[components]], the call
 * inserted and the note opened beside, in one choice (`component.new`). Only for a name a component can have. It comes
 * first, so Enter makes it, unless a component's name holds what was typed: a match on a schema's words doesn't take Enter.
 */
function newComponentRow(query: string, have: readonly string[]): SourceRow | null {
  const name = query.trim();
  if (!/^[a-z][a-z0-9-]*$/.test(name) || have.includes(name)) return null;
  return {
    label: `+ new component ::${name}`, filter: name, insert: `::${name}{}`, kind: "new", newComponent: name, ...(have.some(id => id.includes(name)) ? { fallback: true } : { preselect: true }),
    docs: `writes a render script note [script::${name}] [mode::render] under [[components]], puts ::${name}{} here and opens the note beside: what its fence returns draws under every ::${name}{} line`,
  };
}

/** A schema's key or value as a row: where it goes and what it means; a value draws what it makes. */
function candidateRow(schemas: readonly ComponentSchema[], c: PropertyCandidate, ask: Asked, kind: string): SourceRow {
  const schema = c.value === undefined ? undefined : schemas.find(s => s.id === c.component);
  const v = schema ? variation(schema, { [c.key]: c.value! }, c.key) : null;
  return {
    label: c.label, kind, docs: c.detail, insert: ask.headingShort ? `[heading::${c.insertion}` : c.insertion,
    ...(v ? { example: { use: v.use, ...(v.note ? { note: v.note } : {}), inline: true } } : {}),
  };
}

type Catalog = { key: string; value: string; count: number }[];
const catalogOf = (svc: CompletionService, input: { key?: string; keys?: true }, prefix: string, limit = 100) =>
  svc.request<Catalog>("properties.catalog", { ...input, prefix, limit }).catch((): Catalog => []);
const notes = (n: number) => `${n} note${n === 1 ? "" : "s"}`;

// Properties are open (AGENTS.md): `[key` offers the keys the outline's notes carry (`properties.catalog`, most used
// first), then the keys the component schemas give a meaning; `[key::` the values that key has, then the schema's.
const properties: ServiceSource = {
  decl: { id: "properties", title: "properties", triggers: ["[key", "key::", "yaml-key"], priority: 10, by: "service" },
  async rows(ask, svc) {
    const q = ask.query.trim(), schemas = await schemasOf(svc);
    if (ask.kind === "yaml-key") return { rows: yamlKeyCandidates(schemas, ask.component ?? "", q).map(c => candidateRow(schemas, c, ask, "property")) };
    const catalog = await catalogOf(svc, ask.kind === "value" ? { key: ask.key } : { keys: true }, q.toLowerCase());
    const rows: SourceRow[] = [], seen = new Set<string>();
    if (ask.kind === "key") {
      // What the notes carry first, most used first, with a schema's meaning where one has it; then the schemas' others.
      const known = new Map(keyCandidates(schemas, "").map(c => [c.key, c]));
      for (const c of catalog) {
        seen.add(c.key);
        const meant = known.get(c.key);
        rows.push({ label: c.key, kind: "property", detail: notes(c.count), insert: `[${c.key}::`, ...(meant ? { docs: meant.detail } : {}) });
      }
      for (const c of keyCandidates(schemas, q)) if (!seen.has(c.key)) { seen.add(c.key); rows.push(candidateRow(schemas, c, ask, "property")); }
    } else {
      // The values the notes have first, drawn and explained where a schema knows them; then the schema's others.
      const meant = new Map(valueCandidates(schemas, ask.key ?? "", q).map(c => [c.label, c]));
      for (const c of catalog) if (!/[\]\n]/.test(c.value) && !seen.has(c.value)) {
        seen.add(c.value);
        const m = meant.get(c.value);
        rows.push(m ? { ...candidateRow(schemas, m, ask, "value"), detail: notes(c.count) }
          : { label: c.value, kind: "value", detail: notes(c.count), insert: ask.headingShort ? `[heading::${c.value}]` : `${c.value}]` });
      }
      for (const [label, c] of meant) if (!seen.has(label)) { seen.add(label); rows.push(candidateRow(schemas, c, ask, "value")); }
    }
    return { rows };
  },
};

// A filter's word (`type:note st`, a river column's filter, PIE-626): the same two sources as `[key`, the notes' keys
// and values first, then the schemas', each written as the filter writes it (`stage:`, `done`). It orders its own rows,
// most used first.
const filters: ServiceSource = {
  decl: { id: "filters", title: "properties", triggers: ["filter-key", "filter-value"], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const value = ask.kind === "filter-value", q = ask.query.trim().toLowerCase();
    const [catalog, schemas] = await Promise.all([catalogOf(svc, value ? { key: ask.key } : { keys: true }, q), schemasOf(svc).catch(() => [])]);
    const rows: SourceRow[] = [], seen = new Set<string>();
    if (!value) {
      const counts = new Map<string, number>();
      for (const c of catalog) counts.set(c.key, (counts.get(c.key) ?? 0) + c.count);
      for (const [key, n] of [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) { seen.add(key); rows.push({ label: `${key} (${n})`, filter: key, insert: `${key}:`, kind: "property", docs: `${n} block${n === 1 ? "" : "s"} carry it` }); }
      for (const c of keyCandidates(schemas, q)) if (!seen.has(c.key) && c.key.toLowerCase().startsWith(q)) { seen.add(c.key); rows.push({ label: c.key, insert: `${c.key}:`, kind: "property", docs: c.detail }); }
    } else {
      // A filter's word has no spaces to hold: a value with one is left out there (a field's value may have them).
      const fits = (v: string) => !ask.words || !/\s/.test(v);
      for (const c of catalog) if (!seen.has(c.value) && fits(c.value)) { seen.add(c.value); rows.push({ label: `${c.value} (${c.count})`, filter: c.value, insert: c.value, kind: "value", docs: `${c.count} block${c.count === 1 ? "" : "s"} have ${ask.key}:${c.value}` }); }
      for (const c of valueCandidates(schemas, ask.key ?? "", q, false)) if (!seen.has(c.label) && fits(c.label) && c.label.toLowerCase().startsWith(q)) { seen.add(c.label); rows.push({ label: c.label, insert: c.insertion, kind: "value", docs: c.detail }); }
    }
    return { rows: rows.slice(0, COMPLETION_LIMIT), ...(value ? { empty: `no ${ask.key} value starts ${JSON.stringify(ask.query)}` } : {}) };
  },
};

/** A component's props: its schema's, and those of the template its `propsFrom` attribute names (`template.props`). */
async function componentProps(schema: ComponentSchema, ask: Asked, svc: CompletionService): Promise<PropSchema[]> {
  const producer = schema.propsFrom ? ask.attrs?.find(a => a.key === schema.propsFrom)?.value : undefined;
  // A template still being named (`::use{of="Templ`) has no props yet: the schema's own still answer.
  const spec: PropsSpec = producer ? await svc.request<{ spec: PropsSpec }>("template.props", { of: producer }).then(r => r.spec, (): PropsSpec => ({})) : {};
  return [...schema.props, ...Object.entries(spec).map(([key, p]) => propSchemaOfField({ name: key, type: p.kind, options: p.choices, required: p.required, default: p.default }, `a prop of ${producer}`))];
}

/**
 * The property keys a `property`-typed prop offers: those of the note its `of` names (a reference, a `[[page]]` or an
 * id), else of the note being written or the one it's about.
 */
async function scopedKeys(schema: ComponentSchema, ask: Asked, svc: CompletionService): Promise<string[]> {
  const of = schema.propsFrom === "of" ? undefined : ask.attrs?.find(a => a.key === "of")?.value;
  if (!of) return noteKeys(ask, svc);
  const ref = blockReferenceOccurrences(of)[0];
  const id = ref?.blockId ?? (of.startsWith("[[") ? await svc.request<{ status: string; block?: { id: string } }>("pages.resolve", { address: of.slice(2, -2) }).then(r => r.status === "resolved" ? r.block?.id : undefined, () => undefined) : of);
  const text = id && ask.draft?.blockId === id ? ask.draft.text : id ? (await svc.request<{ selected: Wire | null }>("blocks.context", { blockId: id }).catch(() => ({ selected: null }))).selected?.text : undefined;
  return [...new Set(parsePropertyRecords(text ?? "").map(p => p.key))];
}

/**
 * The keys a call's `where=` rows carry (`::board{where="type=errand" group=`), most carried first: one `blocks.query`
 * with every key's facet, asked from the note being written (`this`). Null when the call has no where or it can't be
 * read, so the note's own keys answer instead.
 */
async function whereKeys(ask: Asked, svc: CompletionService): Promise<(({ key: string; count: number })[] & { matched: number }) | null> {
  const where = ask.attrs?.find(a => a.key === "where")?.value.trim();
  if (!where) return null;
  const near = ask.draft?.blockId ?? ask.near;
  const r = await svc.request<{ blocks: unknown[]; facets?: QuestionFacet[]; completeness: { kind: string; matched?: number } }>("blocks.query", { query: { where, facets: true, limit: 1, ...(near ? { this: near } : {}) } }).catch(() => null);
  if (!r?.facets?.length) return null;
  const keys = r.facets.filter(f => f.count > 0).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).map(f => ({ key: f.key, count: f.count }));
  return Object.assign(keys, { matched: r.completeness.kind === "truncated" ? r.completeness.matched ?? keys[0]?.count ?? 0 : r.blocks.length });
}

/** Whether a prop's values are found in the outline (propValues' searches) rather than the schema's own choices. */
const foundValues = (prop: PropSchema) => prop.complete === "query" || prop.type === "property" || prop.type.startsWith("property:") || prop.type === "script" || prop.type === "ref";

/** The values a prop can take, by its type: what the outline has (keys, values, notes, scripts, queries), else the schema's. */
async function propValues(schema: ComponentSchema, prop: PropSchema, ask: Asked, svc: CompletionService): Promise<{ label: string; value: string; detail?: string }[]> {
  const q = ask.query;
  if (prop.complete === "query") return (await querySuggestions(q, (key, prefix) => catalogOf(svc, key ? { key } : {}, prefix))).map(r => ({ label: r.value, value: r.value, detail: r.detail }));
  if (prop.type === "property") {
    const faceted = await whereKeys(ask, svc);
    if (faceted) return faceted.filter(f => f.key.startsWith(q)).map(f => ({ label: f.key, value: f.key, detail: `${f.count} of the ${notes(faceted.matched)} where= holds carry it` }));
    const keys = await scopedKeys(schema, ask, svc);
    return (keys.length ? keys : axisValues(prop)).filter(key => key.startsWith(q)).map(key => ({ label: key, value: key }));
  }
  if (prop.type.startsWith("property:")) return (await catalogOf(svc, { key: prop.type.slice("property:".length) }, q)).map(f => ({ label: f.value, value: f.value }));
  if (prop.type === "script") {
    const listed = await svc.request<Listed>("extensions.list", ask.draft ? { blockId: ask.draft.blockId, draft: { text: ask.draft.text } } : {});
    return listed.extensions.filter(e => e.script && (e.state === "active" || e.state === "failed") && e.name?.startsWith(q)).map(e => ({ label: e.name!, value: e.name!, ...(e.description ? { detail: e.description } : {}) }));
  }
  if (prop.type === "ref") {
    // The notes `((` finds (the built-in search; an extension's `((` source isn't asked here), written as their reference.
    const found = await blocks.rows({ ...ask, trigger: "((", kind: "block" }, svc);
    return found.rows.filter(r => !r.under).map(r => ({ label: r.label, value: r.insert as string, ...(r.docs ? { detail: r.docs } : {}) }));
  }
  // An action's live list is the client's (the door's own actions, beside these): the service offers the schema's samples.
  return axisValues(prop).filter(v => v.toLowerCase().startsWith(q.toLowerCase())).map(value => ({ label: value, value, ...(prop.values?.find(v => v.value === value)?.meaning ? { detail: prop.values.find(v => v.value === value)!.meaning } : {}) }));
}

// A component's props and their values (PIE-1366): `::box{li` its props (the schema's and a template's), `::box{pad.x="`
// and a figure's `density: ` the values each can take, by its type. A YAML value draws what it makes (`example`).
const attributes: ServiceSource = {
  decl: { id: "attributes", title: "values", triggers: ["attribute", "attribute-value", "yaml-value"], priority: 10, ranked: true, by: "service" },
  async rows(ask, svc) {
    const schema = (await schemasOf(svc)).find(s => componentName(s) === ask.component);
    if (!schema) return { rows: [] };
    const props = await componentProps(schema, ask, svc);
    if (ask.kind === "attribute") {
      const used = new Set(ask.attrs?.map(a => a.key));
      return { heading: "attributes", rows: props.filter(p => !used.has(p.key) && p.key.startsWith(ask.query)).map((p): SourceRow => ({
        label: p.key, detail: p.type, docs: p.meaning, kind: "property",
        insert: ask.existingValue ? p.key : { snippet: `${p.key}=""`, select: { start: p.key.length + 2, end: p.key.length + 2 } },
      })) };
    }
    const prop = props.find(p => p.key === ask.key);
    if (!prop) return { rows: [] };
    const values = await propValues(schema, prop, ask, svc);
    // A glimpse after the label shows how a value looks (a density, a tone); a value found in the outline (a query, a key,
    // a note, a script) changes what is drawn, not how, so its row is its words alone (PIE-1392).
    const looks = !foundValues(prop);
    return { rows: values.map((v): SourceRow => {
      const docs = v.detail ?? prop.meaning;
      if (ask.kind === "yaml-value") {
        const made = variation(schema, { [prop.key]: v.value }, prop.key);
        return { label: v.label, kind: "value", docs, insert: yamlScalar(v.value), example: { use: made.use, ...(made.note ? { note: made.note } : {}), ...(looks ? { inline: true } : {}) } };
      }
      return { label: v.label, kind: "value", docs, insert: attributeScalar(v.value, ask.quote) };
    }) };
  },
};

// The outline's callout types (PIE-538, `callouts.types` over outline-core's built-ins): the one list the reader draws
// and the type choice offers, each written `[!name]`.
const callouts: ServiceSource = {
  decl: { id: "callouts", title: "callout types", triggers: ["> [!"], priority: 10, by: "service" },
  async rows(ask, svc) {
    const declared = await svc.request<{ types: CalloutType[] }>("callouts.types", {}).then(r => r.types, () => []);
    return {
      rows: calloutRegistry(declared).types.map(t => ({
        id: t.name, label: `${t.icon} ${t.name}${t.aliases.length ? ` (${t.aliases.join(", ")})` : ""}`, filter: t.title,
        insert: `[!${t.name}]`, kind: "callout", ...(t.block ? { detail: "this outline's" } : {}),
        example: { use: `> [!${t.name}] ${t.title}\n> An example callout.` },
        docs: `${t.title}${t.aliases.length ? ` · also ${t.aliases.map(a => `[!${a}]`).join(" ")}` : ""}`,
      })),
      empty: `no callout type is ${JSON.stringify(ask.query)}; [!${ask.query}] still draws, in neutral (declare it with [callout-type::${ask.query || "name"}])`,
    };
  },
};

/** The service's sources, in the order their rows come among equals. */
export const SERVICE_SOURCES: readonly ServiceSource[] = [pages, blocks, files, agents, components, properties, filters, attributes, callouts];

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
    ...(t.attrs ? { attrs: t.attrs } : {}), ...(t.quote ? { quote: t.quote } : {}), ...(t.existingValue ? { existingValue: true } : {}), ...(t.words ? { words: true } : {}),
    limit: request.limit ?? COMPLETION_LIMIT, prefix, ...(t.headingShort ? { headingShort: true } : {}), ...(request.near ? { near: request.near } : {}), ...(request.draft ? { draft: request.draft } : {}),
    ...(request.offset ? { offset: request.offset } : {}), ...(request.semantic ? { semantic: true } : {}),
  };
  const asks: Promise<CompletionSourceAnswer>[] = [];
  // A key an extension's source names (`[issue::`) is that source's: the properties source steps aside, so a value
  // isn't offered twice with two different inserts.
  const claimed = VALUE_TRIGGERS.has(ask.trigger) && extensions.some(e => e.keys?.length && sourceAnswers(e, ask));
  for (const s of SERVICE_SOURCES) if (sourceAnswers(s.decl, ask) && !(claimed && (s === properties || s === attributes))) {
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


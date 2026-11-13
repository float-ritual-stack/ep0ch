/*
 * `lists.read` (packages/native/docs/DESIGN.md §3): one list, whatever it is of. A client names what to list (`from`)
 * and the service answers a `ListAnswer` (outline-core's list-row.ts): rows that say what they show and the act line a
 * pick runs, how they are arranged, the columns a table has, the groups lanes are, the facets the listed notes carry.
 * A tree, a query's matches, a search, a note's links, lanes, facets, the screens and who is here are all it, so a
 * client draws one list and maps no answer to rows itself.
 *
 * - **A producer is a row plus a read.** The row (`ListSource`) says what it lists and the parameters it reads;
 *   `from: "sources"` lists the rows, so a bar's sources and an agent's question come from the same place.
 * - **Properties are open.** `group`, `sort` and `columns` are property names as the asker wrote them, handed to the
 *   views' own question (`blocks.query`); nothing here lists which keys a list may be grouped, sorted or filtered by.
 * - **The service asks itself** (`own`) for every read, the same reads any client makes: the tree's levels
 *   (`blocks.read`), the views' matcher (`blocks.query`), the one search (`tree.search`), a note's links as a page's
 *   `::links` reads them (publish-live's `readLinks`). No second matcher or ranker lives here: words over rows are
 *   outline-core's `listRowMatches`, a group's label and the groups there are its `link-blocks`, a picked value as a
 *   term of a question its `clauseText`.
 *
 * Watched as `notes.page` is (`watch: "later"`): answered now and again on each pass that reaches it.
 */
import { ALL_LINK_GROUPS, LINK_GROUP_LABELS, linkGroupsNamed } from "@ep0ch/outline-core/link-blocks";
import { listRowMatches, type ListAnswer, type ListGroup, type ListPrimitive, type ListRow, type ListSource } from "@ep0ch/outline-core/list-row";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import type { QuestionFacet, QuestionGroup } from "@ep0ch/outline-core/protocol";
import { clauseText } from "@ep0ch/outline-core/query-clauses";
import { isNoteUnder } from "@ep0ch/outline-core/derived";
import { Refusal } from "@ep0ch/outline-core/refusal";
import { prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { ABOUT_PRODUCERS } from "./about-producers";
import { capped, names, opens, row, runs, subject, titled, type Answered, type Listed, type ListsRequest, type Own, type Producer } from "./list-producer";
import { readLinks, type LiveHost } from "./publish-live";
import { EXTENSION_PRODUCERS } from "./list-extensions";
import type { ScreensList } from "./screens";

export type { ListsRequest } from "./list-producer";

/**
 * What a row of notes reads of each: its list title, and whether notes are under it (`hasNotes`, the store's answer by
 * `isNoteUnder`: the reading `level` lists by, so a row that folds always opens onto a note).
 */
const NOTE_FIELDS = ["title", "hasNotes"] as const;
const day = (iso: string | undefined) => iso?.slice(0, 10) ?? "";

/**
 * The notes under `parent` (null: the top level), in outline order, each with its list title. A comment on the note
 * and an edit proposed beside it are blocks under it and no notes of it (outline-core's `isNoteUnder`, the one answer:
 * a page's own list and a links list's Children leave out the same ones).
 */
async function level(own: Own, parent: string | null): Promise<Listed[]> {
  const { blocks } = await own.request<{ blocks: (Listed & { properties?: { key: string; value: string }[] })[] }>({ action: "blocks.read", under: parent, fields: [...NOTE_FIELDS, "properties"] });
  return blocks.filter(block => isNoteUnder(block.properties?.find(p => p.key === "type")?.value)).map(({ properties: _, ...note }) => note);
}

/**
 * The outline as a tree: every note under `of` (left out: the top level), and under each folder named in `open` its
 * own notes, in the order a tree draws them. A row says how deep it sits, whether it folds and whether it is open;
 * `open` answers the folders that were listed, so a client knows which levels it holds.
 */
async function tree(own: Own, request: ListsRequest): Promise<Answered> {
  const wanted = new Set(request.open ?? []), most = capped(request.limit), rows: ListRow[] = [], answered: string[] = [];
  let truncated = false;
  const walk = async (parent: string | null, depth: number): Promise<void> => {
    const notes = await level(own, parent);
    for (const note of notes) {
      if (rows.length >= most) { truncated = true; return; }
      const open = wanted.has(note.id) && !!note.hasNotes;
      const at = rows.push(row({ id: note.id, label: titled(note.title), depth, ...(note.hasNotes ? { folds: true } : {}), ...(open ? { open: true } : {}), do: opens(note.id) })) - 1;
      if (!open) continue;
      const before = rows.length;
      await walk(note.id, depth + 1);
      answered.push(note.id);
      // How many notes are under it, said once they are listed: the ones one level down.
      rows[at] = { ...rows[at]!, kids: rows.slice(before).filter(r => r.depth === depth + 1).length };
    }
  };
  await walk(typeof request.of === "string" && request.of ? request.of : null, 0);
  return { list: { type: "list", arrange: "tree", rows, empty: "No notes yet." }, open: answered, ...(truncated ? { truncated, total: rows.length } : {}) };
}

type Found = { blocks: Listed[]; groups?: QuestionGroup[]; facets?: QuestionFacet[]; hint?: string; completeness: { kind: "complete" } | { kind: "truncated"; limit: number; matched?: number } };

/** The views' question, asked once: the matches with what a row shows of each, their groups, their facets and the service's hint. */
async function asked(own: Own, request: ListsRequest, more: { facets: boolean; limit?: number }): Promise<Found> {
  const where = (request.query ?? "").trim();
  return own.request<Found>({
    action: "blocks.query",
    query: {
      where, limit: more.limit ?? Math.min(capped(request.limit), 200),
      ...(request.group ? { group: request.group } : {}), ...(request.sort ? { sort: request.sort } : {}),
      ...(more.facets ? { facets: true, facetValues: 8 } : {}),
    },
    fields: [...NOTE_FIELDS, "timestamps", "properties"],
  });
}

/** A column's cell for a note: one of its own facts (`title`, `updated`, `created`), else every value of the property so named. */
function cell(note: Listed, column: string): string {
  if (column === "title") return titled(note.title);
  if (column === "updated") return day(note.updatedAt);
  if (column === "created") return day(note.createdAt);
  return (note.properties ?? []).filter(p => p.key === column).map(p => p.value).join(", ");
}

const facetsOf = (found: Found) => found.facets?.length ? { facets: found.facets.map(f => ({ key: f.key, count: f.count, values: f.values.map(v => ({ value: v.value, count: v.count })), ...(f.more ? { more: f.more } : {}) })) } : {};
const countOf = (found: Found) => found.completeness.kind === "truncated" ? { truncated: true, ...(found.completeness.matched !== undefined ? { total: found.completeness.matched } : {}) } : {};

/** How a question's matches may be arranged when the asker says (the list primitive's own words, bar a tree's). */
const ARRANGED = ["rows", "table", "lanes", "grid"] as const;

/** The most property columns a table has when its asker names none. */
const TABLE_COLUMNS = 6;

/**
 * A question's matches (`query`, the views' grammar) as rows: sorted and grouped by the property names asked, each row
 * with the properties it carries as chips and, when `columns` names some (or it is asked as a table), a cell a column. Grouped, the groups are the
 * list's sections (`arrange: "lanes"` draws each as a lane); the facets are counted over every match.
 */
async function matches(own: Own, request: ListsRequest, lanes = false): Promise<Answered> {
  if (lanes && !request.group?.trim()) throw new Refusal("invalid", "lists.read from=lanes groups its matches into lanes: name the property with group=<a property name>");
  const found = await asked(own, request, { facets: true });
  const named = names(request.columns);
  const arrange = lanes ? "lanes" : ARRANGED.find(a => a === request.arrange) ?? (named.length ? "table" : "rows");
  // A table nobody named columns for shows the title and the properties its matches carry (the facets' keys, as counted): no list of keys is kept here.
  const columns = named.length || arrange !== "table" ? named : ["title", ...(found.facets ?? []).slice(0, TABLE_COLUMNS).map(f => f.key)];
  const rows = found.blocks.map(note => row({
    id: note.id, label: titled(note.title), detail: day(note.updatedAt),
    ...(note.properties?.length ? { chips: note.properties.slice(0, 8).map(p => ({ key: p.key, value: p.value })) } : {}),
    ...(columns.length ? { cells: columns.map(column => cell(note, column)) } : {}),
    ...(note.hasNotes ? { folds: true } : {}),
    do: opens(note.id),
  }));
  const groups: ListGroup[] | undefined = found.groups?.map(g => ({ name: g.value ?? "", label: g.value ?? `no ${request.group}`, count: g.count, ids: g.ids }));
  const list: ListPrimitive = {
    type: "list", arrange, rows, ...(columns.length ? { columns, headers: columns } : {}), ...(groups ? { groups } : {}),
    empty: (request.query ?? "").trim() ? "Nothing matches." : "Every note matches an empty question: say which with a property (type=bed).",
  };
  return { list, ...facetsOf(found), ...(found.hint ? { hint: found.hint } : {}), ...countOf(found), ...(request.sort ? { sort: request.sort } : {}), ...(request.group ? { group: request.group } : {}) };
}

/**
 * The properties a question's matches carry, as rows to narrow it by: a group a key, a row a value with how many
 * matches carry it. A pick narrows the list it is in (`facets.set`, the facets tile's own action in every door).
 */
async function facets(own: Own, request: ListsRequest): Promise<Answered> {
  const found = await asked(own, request, { facets: true, limit: 1 });
  const listed = found.facets ?? [];
  const rows = listed.flatMap(f => f.values.map(v => row({ id: `${f.key}=${v.value}`, label: v.value, detail: String(v.count), group: f.key, do: runs("facets.set", { key: f.key, value: v.value }) })));
  const groups: ListGroup[] = listed.map(f => ({ name: f.key, label: f.key, count: f.count, ...(f.more ? { note: `${f.more} more` } : {}) }));
  // The rows are the facets: the answer carries no second copy of them as chips, and no count of notes it doesn't list.
  return { list: { type: "list", arrange: "rows", rows, groups, empty: "The matches carry no properties." }, ...(found.hint ? { hint: found.hint } : {}) };
}

/** Notes by the words typed, ranked by the one search (`tree.search`): a row says where its note sits. */
async function search(own: Own, request: ListsRequest): Promise<Answered> {
  const words = (request.query ?? "").trim();
  if (!words) return { list: { type: "list", arrange: "rows", rows: [], empty: "Type to search." } };
  const found = await own.request<{ matches: { block: { id: string }; title: string; path: string }[]; completeness: Found["completeness"] }>({ action: "tree.search", query: words, limit: Math.min(capped(request.limit), 30), semantic: false });
  const rows = found.matches.map(m => row({ id: m.block.id, label: titled(m.title), ...(m.path ? { detail: m.path } : {}), do: opens(m.block.id) }));
  return { list: { type: "list", arrange: "rows", rows, empty: "Nothing matches." }, ...(found.completeness.kind === "truncated" ? { truncated: true } : {}) };
}

/**
 * A note's links (`of`), a group a relation, read as a page's `::links` reads them (`readLinks`: the one reading of a
 * note's outlinks, resources, backlinks and children). `linkGroups` names some (as a links tile saves them); left
 * out, every group the note has (outline-core's `ALL_LINK_GROUPS`), as a links tile shows when nobody chose.
 */
async function links(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const wanted = linkGroupsNamed(names(request.linkGroups));
  if ("bad" in wanted) throw new Refusal("invalid", `${wanted.bad} isn't a group this list has; its groups are ${ALL_LINK_GROUPS.join(", ")} (or all)`);
  const titles = async (ids: readonly string[]) => new Map(ids.length ? (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", ids: [...new Set(ids)], fields: ["title"] })).blocks.map(b => [b.id, b.title ?? ""] as const) : []);
  const host: LiveHost = { request: input => own.request(input as { action: string }), shown: async ids => new Set(ids), titles, href: id => id };
  const read = await readLinks(host, { kind: "links", of: null, filter: "", title: null, groups: wanted, query: null, preview: "none", stages: null }, of);
  if (read.problem) throw new Refusal("invalid", read.problem);
  const rows: ListRow[] = [], groups: ListGroup[] = [], seen = new Set<string>();
  for (const [at, g] of read.groups.entries()) {
    const group = wanted[at]!;
    for (const [n, r] of g.rows.entries()) {
      // A note in two groups is two rows: the second is keyed by its group too, so every row's id is its own. A row
      // that stands for no note (a link that leads nowhere, a Resource nobody registered) opens nothing: it is words.
      const id = r.id === null ? `${group}:${n}` : seen.has(r.id) ? `${group}:${r.id}` : r.id;
      if (r.id !== null) seen.add(r.id);
      rows.push(row({ id, label: titled(r.text), ...(r.note ? { detail: r.note } : {}), ...(wanted.length > 1 ? { group } : {}), ...(r.id !== null ? { do: opens(r.id) } : {}) }));
    }
    groups.push({ name: group, label: LINK_GROUP_LABELS[group], glyph: g.glyph, count: g.rows.length, ...(g.rows.length ? {} : { note: g.note }) });
  }
  const one = wanted.length === 1 ? groups[0]! : null;
  return { list: { type: "list", arrange: "rows", rows, ...(one ? { title: `${one.label} · ${rows.length}` } : { groups }), empty: one?.note ?? "This note has no links." } };
}

/** A note's properties (`of`), a row a value, then its record: a table of two columns, each value a question to open. */
async function properties(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const { records } = await own.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [of] });
  const record = records[0];
  if (!record) throw new Refusal("not-found", `no note ${of}`);
  const rows: ListRow[] = record.properties.flatMap(p => p.values.map((value, i) => row({
    id: `${p.key}=${value}#${i}`, label: p.key, detail: value, cells: [p.key, value], group: "properties", chips: [{ key: p.key, value }],
    do: runs("bar.open", { scope: QUESTIONS, query: clauseText({ key: p.key, value, mode: "include" }) }),
  })));
  const fact = (label: string, value: string | undefined) => value ? [row({ id: `record:${label}`, label, detail: value, cells: [label, value], group: "record", do: { copy: value } })] : [];
  rows.push(...fact("revision", String(record.revision)), ...fact("updated", record.updated?.slice(0, 16).replace("T", " ")), ...fact("by", record.actor ?? record.author), ...fact("id", record.id));
  const count = (group: string) => rows.filter(r => r.group === group).length;
  return { list: { type: "list", arrange: "table", columns: ["property", "value"], headers: ["property", "value"], rows, groups: [{ name: "properties", label: "Properties", count: count("properties"), ...(count("properties") ? {} : { note: "None." }) }, { name: "record", label: "Record", count: count("record") }], title: titled(record.title) } };
}

/** What changed lately, newest first: a row a note someone edited, by whom and when; a pick opens it. People's edits and agents' alike. */
async function activity(own: Own, request: ListsRequest): Promise<Answered> {
  type Entry = { cursor: number; block: { id: string }; author: string; actorId?: string; kind: string; editedAt: string };
  const limit = Math.min(capped(request.limit), 100);
  // The record is kept an author: each is asked, and the newest of them all come first.
  const pages = await Promise.all(["user", "agent"].map(author => own.request<{ entries: Entry[] }>({ action: "activity.recent", author, limit })));
  const entries = pages.flatMap(page => page.entries).sort((a, b) => b.cursor - a.cursor).slice(0, limit);
  const ids = [...new Set(entries.map(e => e.block.id))];
  const read = ids.length ? (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", ids, fields: ["title"] })).blocks : [];
  const title = new Map(read.map(b => [b.id, titled(b.title)] as const));
  // An edit of a note that is gone (purged since) has nothing to open: it isn't listed.
  const rows = entries.filter(e => title.has(e.block.id)).map(e => row({ id: `${e.cursor}`, label: title.get(e.block.id)!, detail: `${e.actorId ?? e.author} · ${e.kind} · ${e.editedAt.slice(0, 16).replace("T", " ")}`, do: opens(e.block.id) }));
  return { list: { type: "list", arrange: "rows", rows, empty: "Nothing has changed yet." } };
}

/** Who is attached to the outline now: a row a client, with what it is and where it runs. */
async function clients(own: Own): Promise<Answered> {
  const here = await own.request<{ clientId: string; role: string; app?: string; outline?: string; runtime?: { hostname?: string }; currentTarget?: { blockId?: string } }[]>({ action: "clients.list" });
  const rows = here.map(c => row({ id: c.clientId, label: c.clientId, detail: [c.app ?? c.role, c.runtime?.hostname].filter(Boolean).join(" · "), ...(c.currentTarget?.blockId ? { do: opens(c.currentTarget.blockId) } : {}) }));
  return { list: { type: "list", arrange: "rows", rows, empty: "Nobody else is here." } };
}

/** The screens there are to open (`screens.list`'s rows): a pick lays the window out as one. What is wrong with one is said on its row. */
async function screens(own: Own, request: ListsRequest): Promise<Answered> {
  const listed = await own.request<ScreensList>({ action: "screens.list", ...(request.kinds ? { kinds: request.kinds } : {}), ...(request.drawers ? { drawers: request.drawers } : {}) });
  // Words leave the rows the one matcher leaves (`listRowMatches`: a quoted phrase, a folded accent), over what a row shows; its name is its mark.
  const words = prepareSearchQuery(request.query ?? "");
  const rows = listed.screens.filter(s => s.spec).map(s => ({ name: s.name, shown: row({
    id: s.name, label: s.title || s.name, detail: [s.from === "extension" ? `the ${s.extension} extension's` : "a screen note", ...s.problems.map(p => p.said)].join(" · "),
    ...(s.problems.length ? { tone: "warn" as const } : {}), do: runs("screen.open", { name: s.name }),
  }) })).filter(s => listRowMatches({ label: s.shown.label, detail: s.shown.detail, mark: s.name }, words)).map(s => s.shown);
  return { list: { type: "list", arrange: "rows", rows, empty: "No screens here: the screens extension adds the ones every door ships (extensions.install id=screens)." }, ...(listed.problems.length ? { hint: listed.problems.join(" · ") } : {}) };
}

/** The source a question in the views' grammar is asked of: what a row that opens one names (`bar.open scope=`). */
const QUESTIONS = "query";
const QUERY = { name: "query", about: "a question in the views' grammar (type=bed NOT stage=done): any property" };
const LIMIT = { name: "limit", about: "the most rows" };
const OPEN_FOLDERS = { name: "open", about: "the folders whose notes are listed under them" };

const PRODUCERS: readonly Producer[] = [
  { row: { from: "children", about: "The outline", params: [{ name: "of", about: "the note at its top (left out: the outline's top level)" }, OPEN_FOLDERS, LIMIT] }, read: tree },
  { row: { from: "search", about: "Notes", placeholder: "Words in a title or a note", params: [{ name: "query", about: "words in a title or a note", required: true }, LIMIT], bar: { main: true } }, read: search },
  { row: { from: QUESTIONS, about: "Query", placeholder: "type=letter mail=waiting · any property, as views read it", params: [QUERY, { name: "sort", about: "a property name, or created, updated, title; then asc or desc" }, { name: "group", about: "a property name: its values are the list's sections" }, { name: "columns", about: "the property names a table shows" }, { name: "arrange", about: `${ARRANGED.join(", ")}` }, LIMIT], bar: { facets: true } }, read: (own, request) => matches(own, request) },
  { row: { from: "lanes", about: "Lanes", params: [QUERY, { name: "group", about: "the property name whose values are the lanes", required: true }, { name: "sort", about: "the order in each lane" }, LIMIT] }, read: (own, request) => matches(own, request, true) },
  { row: { from: "facets", about: "Facets", params: [QUERY] }, read: facets },
  { row: { from: "links", about: "Links", params: [{ name: "of", about: "the note", required: true }, { name: "linkGroups", about: `which relations: ${ALL_LINK_GROUPS.join(", ")} or all (left out: all)` }] }, read: links },
  { row: { from: "properties", about: "Properties", params: [{ name: "of", about: "the note", required: true }] }, read: properties },
  { row: { from: "activity", about: "Last callers", params: [LIMIT] }, read: activity },
  { row: { from: "clients", about: "Who's here", params: [] }, read: own => clients(own) },
  ...ABOUT_PRODUCERS,
  { row: { from: "screens", about: "Screens", placeholder: "A screen's name", params: [{ name: "query", about: "words of its name" }, { name: "kinds", about: "the tile kinds the asker draws" }, { name: "drawers", about: "the drawers the asker has" }], bar: {} }, read: screens },
];

/** Every producer: the ones here, then the ones a module of its own adds (read when asked: the modules import each other). */
const producers = (): readonly Producer[] => [...PRODUCERS, ...EXTENSION_PRODUCERS];

/** The producers themselves, a row each: what a client may ask a list of, and which a command bar lists. */
function sources(): Answered {
  const rows = producers().map(({ row: s }) => row({
    id: s.from, label: s.about, ...(s.placeholder ? { detail: s.placeholder } : {}), cells: [s.from, s.params.map(p => `${p.name}${p.required ? "" : "?"}`).join(" ")],
    // What it reads, a chip a parameter: a client hands a list its tile's fields by these names, and keeps no list of them.
    chips: s.params.map(p => ({ key: p.name, value: p.about })),
  }));
  // The rows are for a person to read; `sources` is each source as it says of itself, which a client reads.
  return { list: { type: "list", arrange: "table", columns: ["from", "params"], headers: ["from", "params"], rows }, sources: listSources() };
}

/** Every list source as it says of itself. */
export const listSources = (): ListSource[] => producers().map(p => p.row);

/** `lists.read`: the list `from` names, by its producer; a name none has is refused with the ones there are. */
export async function readList(own: Own, request: ListsRequest): Promise<ListAnswer> {
  const from = typeof request.from === "string" ? request.from : "";
  if (from === "sources") return { from, ...sources(), anyChange: true };
  const producer = producers().find(p => p.row.from === from);
  if (!producer) throw new Refusal("invalid", `lists.read lists ${producers().map(p => p.row.from).join(", ")} (from=sources says what each reads), not ${JSON.stringify(from)}`);
  return { from, ...await producer.read(own, request), anyChange: true };
}

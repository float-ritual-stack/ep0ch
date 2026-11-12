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
 *   (`blocks.read`), the views' matcher (`blocks.query`), the one search (`tree.search`), the backlink relation
 *   (`references.backlinks`). No second matcher, ranker or title reading lives here.
 *
 * Watched as `notes.page` is (`watch: "later"`): answered now and again on each pass that reaches it.
 */
import { LINK_GROUPS, type LinkGroupName } from "@ep0ch/outline-core/link-blocks";
import { actOf, LIST_MAX_ROWS, type Activation, type ListAnswer, type ListGroup, type ListPrimitive, type ListRow, type ListSource } from "@ep0ch/outline-core/list-row";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import type { QuestionFacet, QuestionGroup } from "@ep0ch/outline-core/protocol";
import { Refusal } from "@ep0ch/outline-core/refusal";
import type { ScreensList } from "./screens";

/** What a client asks a list of. Declared here, beside the producers: types.ts names it once in the request union. */
export interface ListsRequest {
  id: string; action: "lists.read"; watch?: string; generation?: number;
  /** What to list: a producer's name (`sources` lists them). */
  from: string;
  /** The note it is about (a tree's top, a note's links and properties). */
  of?: string | null;
  /** Words (a search) or a question in the views' grammar (a query, lanes, facets). */
  query?: string;
  /** A tree: the folders whose notes are listed under them. */
  open?: string[];
  /** A property name to group by (lanes), as `blocks.query` reads `group`. */
  group?: string;
  /** `"<property|created|updated|title>[ asc|desc]"`, as `blocks.query` reads `sort`. */
  sort?: string;
  /** How the rows are arranged, when the asker says: `rows`, `table`, `lanes`, `grid`. */
  arrange?: string;
  /** The property names a table shows, in order (`title`, `updated` and `created` are the note's own). */
  columns?: string[] | string;
  /** A note's links: which groups (`children`, `outlinks,backlinks`), as a links tile saves them. */
  linkGroups?: string[] | string;
  limit?: number;
  /** The screens: the kinds and drawers the asker draws, as `screens.list` takes them. */
  kinds?: string[]; drawers?: string[];
}

type Own = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
type Listed = { id: string; title?: string; hasChildren?: boolean; parentId?: string | null; updatedAt?: string; createdAt?: string; properties?: { key: string; value: string }[] };
type Answered = Omit<ListAnswer, "from" | "anyChange">;
interface Producer { row: ListSource; read(own: Own, request: ListsRequest): Promise<Answered> }

const NOTE_FIELDS = ["title", "hasChildren"] as const;
const titled = (title: string | undefined) => title?.trim() ? title : "untitled";
const row = (r: Omit<ListRow, "act">): ListRow => { const act = actOf(r.do); return act ? { ...r, act } : r; };
const opens = (id: string): Activation => ({ open: id });
const runs = (action: string, args: Record<string, string>): Activation => ({ run: { action, args } });
const names = (v: string[] | string | undefined): string[] => (typeof v === "string" ? v.split(/[\s,]+/) : v ?? []).map(s => s.trim()).filter(Boolean);
const day = (iso: string | undefined) => iso?.slice(0, 10) ?? "";
const capped = (limit: number | undefined) => Math.max(1, Math.min(typeof limit === "number" && Number.isFinite(limit) ? Math.floor(limit) : LIST_MAX_ROWS, LIST_MAX_ROWS));

/** The notes under `parent` (null: the top level), in outline order, each with its list title. */
async function level(own: Own, parent: string | null): Promise<Listed[]> {
  return (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", under: parent, fields: [...NOTE_FIELDS] })).blocks;
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
      const open = wanted.has(note.id) && !!note.hasChildren;
      const at = rows.push(row({ id: note.id, label: titled(note.title), depth, ...(note.hasChildren ? { folds: true } : {}), ...(open ? { open: true } : {}), do: opens(note.id) })) - 1;
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
    fields: ["title", "hasChildren", "timestamps", "properties"],
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

/**
 * A question's matches (`query`, the views' grammar) as rows: sorted and grouped by the property names asked, each row
 * with the properties it carries as chips and, when `columns` names some, a cell a column. Grouped, the groups are the
 * list's sections (`arrange: "lanes"` draws each as a lane); the facets are counted over every match.
 */
async function matches(own: Own, request: ListsRequest, lanes = false): Promise<Answered> {
  if (lanes && !request.group?.trim()) throw new Refusal("invalid", "lists.read from=lanes groups its matches into lanes: name the property with group=<a property name>");
  const found = await asked(own, request, { facets: true });
  const columns = names(request.columns);
  const rows = found.blocks.map(note => row({
    id: note.id, label: titled(note.title), detail: day(note.updatedAt),
    ...(note.properties?.length ? { chips: note.properties.slice(0, 8).map(p => ({ key: p.key, value: p.value })) } : {}),
    ...(columns.length ? { cells: columns.map(column => cell(note, column)) } : {}),
    ...(note.hasChildren ? { folds: true } : {}),
    do: opens(note.id),
  }));
  const groups: ListGroup[] | undefined = found.groups?.map(g => ({ name: g.value ?? "", label: g.value ?? `no ${request.group}`, count: g.count, ids: g.ids }));
  const arrange = lanes ? "lanes" : (["rows", "table", "lanes", "grid"] as const).find(a => a === request.arrange) ?? (columns.length ? "table" : "rows");
  const list: ListPrimitive = {
    type: "list", arrange, rows, ...(columns.length ? { columns, headers: columns } : {}), ...(groups ? { groups } : {}),
    empty: (request.query ?? "").trim() ? "Nothing matches." : "Every note matches an empty question: say which with a property (type=bed).",
  };
  return { list, ...facetsOf(found), ...(found.hint ? { hint: found.hint } : {}), ...countOf(found), ...(request.sort ? { sort: request.sort } : {}), ...(request.group ? { group: request.group } : {}) };
}

/**
 * The properties a question's matches carry, as rows to narrow it by: a group a key, a row a value with how many
 * matches carry it. A pick narrows the list it is in (`list.narrow`); the same facets ride on the answer for chips.
 */
async function facets(own: Own, request: ListsRequest): Promise<Answered> {
  const found = await asked(own, request, { facets: true, limit: 1 });
  const listed = found.facets ?? [];
  const rows = listed.flatMap(f => f.values.map(v => row({ id: `${f.key}=${v.value}`, label: v.value, detail: String(v.count), group: f.key, chips: [{ key: f.key, value: v.value }], do: runs("list.narrow", { key: f.key, value: v.value }) })));
  const groups: ListGroup[] = listed.map(f => ({ name: f.key, label: f.key, count: f.count, ...(f.more ? { note: `${f.more} more` } : {}) }));
  return { list: { type: "list", arrange: "rows", rows, groups, empty: "The matches carry no properties." }, ...facetsOf(found), ...(found.hint ? { hint: found.hint } : {}), ...countOf(found) };
}

/** Notes by the words typed, ranked by the one search (`tree.search`): a row says where its note sits. */
async function search(own: Own, request: ListsRequest): Promise<Answered> {
  const words = (request.query ?? "").trim();
  if (!words) return { list: { type: "list", arrange: "rows", rows: [], empty: "Type to search." } };
  const found = await own.request<{ matches: { block: { id: string }; title: string; path: string }[]; completeness: Found["completeness"] }>({ action: "tree.search", query: words, limit: Math.min(capped(request.limit), 30), semantic: false });
  const rows = found.matches.map(m => row({ id: m.block.id, label: titled(m.title), ...(m.path ? { detail: m.path } : {}), do: opens(m.block.id) }));
  return { list: { type: "list", arrange: "rows", rows, empty: "Nothing matches." }, ...(found.completeness.kind === "truncated" ? { truncated: true } : {}) };
}

/** The note a list about one note is of: asked by `of`, refused in words when none is named. */
function subject(request: ListsRequest): string {
  if (typeof request.of !== "string" || !request.of) throw new Refusal("invalid", `lists.read from=${request.from} is about one note: name it with of=<a block id>`);
  return request.of;
}

const LINKS: readonly LinkGroupName[] = ["outlinks", "backlinks", "children"];
const LINK_LABELS: Record<string, string> = { outlinks: "Links to", backlinks: "Linked from", children: "Under it" };

/**
 * A note's links (`of`), a group a relation: the notes it links to, the notes that link to it and the notes under it.
 * `linkGroups` names some (as a links tile saves them); left out, the notes that link to it.
 */
async function links(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const askedFor = names(request.linkGroups).map(n => n.toLowerCase());
  const bad = askedFor.find(n => n !== "all" && !LINKS.includes(n as LinkGroupName));
  if (bad) throw new Refusal("invalid", `${bad} isn't a group this list has; its groups are ${LINKS.join(", ")} (or all)`);
  const wanted = !askedFor.length ? ["backlinks"] : askedFor.includes("all") ? [...LINKS] : LINKS.filter(g => askedFor.includes(g));
  const glyph = (group: string) => LINK_GROUPS.find(g => g.group === group)?.glyph;
  const listed = async (ids: readonly string[]): Promise<Listed[]> => {
    if (!ids.length) return [];
    const read = (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", ids: [...new Set(ids)], fields: [...NOTE_FIELDS] })).blocks;
    return ids.flatMap(id => read.filter(b => b.id === id));
  };
  const rows: ListRow[] = [], groups: ListGroup[] = [], seen = new Set<string>();
  // A note in two groups is two rows: the second is keyed by its group too, so every row's id is its own.
  const add = (group: string, id: string, label: string, detail?: string) => {
    rows.push(row({ id: seen.has(id) ? `${group}:${id}` : id, label, ...(detail ? { detail } : {}), ...(wanted.length > 1 ? { group } : {}), do: opens(id) }));
    seen.add(id);
  };
  for (const group of wanted) {
    const before = rows.length;
    if (group === "backlinks") {
      const back = await own.request<{ sources: { blockId: string; title: string; parentContext: string }[] }>({ action: "references.backlinks", query: { targetBlockId: of, limit: 200 } });
      for (const s of back.sources) if (s.blockId !== of) add(group, s.blockId, titled(s.title), s.parentContext);
    } else if (group === "children") {
      for (const note of await level(own, of)) add(group, note.id, titled(note.title));
    } else {
      const { records } = await own.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [of] });
      const targets = (records[0]?.links ?? []).flatMap(link => link.target ? [link.target] : []);
      for (const note of await listed(targets)) add(group, note.id, titled(note.title));
    }
    const g = glyph(group);
    groups.push({ name: group, label: LINK_LABELS[group] ?? group, ...(g ? { glyph: g } : {}), count: rows.length - before });
  }
  const one = wanted.length === 1 ? wanted[0]! : null;
  return { list: { type: "list", arrange: "rows", rows, ...(one ? { title: `${LINK_LABELS[one]} · ${rows.length}` } : { groups }), empty: one === "backlinks" ? "No note links here." : one === "children" ? "Nothing is under it." : "It links to no note." } };
}

/** A note's properties (`of`), a row a value, then its record: a table of two columns, each value a question to open. */
async function properties(own: Own, request: ListsRequest): Promise<Answered> {
  const of = subject(request);
  const { records } = await own.request<{ records: BlockRecord[] }>({ action: "blocks.records", ids: [of] });
  const record = records[0];
  if (!record) throw new Refusal("not-found", `no note ${of}`);
  const rows: ListRow[] = record.properties.flatMap(p => p.values.map((value, i) => row({
    id: `${p.key}=${value}#${i}`, label: p.key, detail: value, cells: [p.key, value], group: "properties", chips: [{ key: p.key, value }],
    do: runs("bar.open", { scope: "query", query: `${p.key}=${/[\s"']/.test(value) ? JSON.stringify(value) : value}` }),
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
  const read = ids.length ? (await own.request<{ blocks: Listed[] }>({ action: "blocks.read", ids, fields: [...NOTE_FIELDS] })).blocks : [];
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
  const words = (request.query ?? "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  const rows = listed.screens.filter(s => s.spec).filter(s => words.every(w => `${s.name} ${s.title}`.toLowerCase().includes(w))).map(s => row({
    id: s.name, label: s.title || s.name, detail: [s.from === "extension" ? `the ${s.extension} extension's` : "a screen note", ...s.problems.map(p => p.said)].join(" · "),
    ...(s.problems.length ? { tone: "warn" as const } : {}), do: runs("screen.open", { name: s.name }),
  }));
  return { list: { type: "list", arrange: "rows", rows, empty: "No screens here: the screens extension adds the ones every door ships (extensions.install id=screens)." }, ...(listed.problems.length ? { hint: listed.problems.join(" · ") } : {}) };
}

const QUERY = { name: "query", about: "a question in the views' grammar (type=bed NOT stage=done): any property" };
const LIMIT = { name: "limit", about: "the most rows" };

const PRODUCERS: readonly Producer[] = [
  { row: { from: "children", about: "The outline", params: [{ name: "of", about: "the note at its top (left out: the outline's top level)" }, { name: "open", about: "the folders whose notes are listed under them" }, LIMIT] }, read: tree },
  { row: { from: "search", about: "Notes", placeholder: "Words in a title or a note", params: [{ name: "query", about: "words in a title or a note", required: true }, LIMIT], bar: { main: true } }, read: search },
  { row: { from: "query", about: "Query", placeholder: "type=letter mail=waiting · any property, as views read it", params: [QUERY, { name: "sort", about: "a property name, or created, updated, title; then asc or desc" }, { name: "group", about: "a property name: its values are the list's sections" }, { name: "columns", about: "the property names a table shows" }, { name: "arrange", about: "rows, table, lanes or grid" }, LIMIT], bar: {} }, read: (own, request) => matches(own, request) },
  { row: { from: "lanes", about: "Lanes", params: [QUERY, { name: "group", about: "the property name whose values are the lanes", required: true }, { name: "sort", about: "the order in each lane" }, LIMIT] }, read: (own, request) => matches(own, request, true) },
  { row: { from: "facets", about: "Facets", params: [QUERY] }, read: facets },
  { row: { from: "links", about: "Links", params: [{ name: "of", about: "the note", required: true }, { name: "linkGroups", about: `which relations: ${LINKS.join(", ")} or all (left out: backlinks)` }] }, read: links },
  { row: { from: "properties", about: "Properties", params: [{ name: "of", about: "the note", required: true }] }, read: properties },
  { row: { from: "activity", about: "Last callers", params: [LIMIT] }, read: activity },
  { row: { from: "clients", about: "Who's here", params: [] }, read: own => clients(own) },
  { row: { from: "screens", about: "Screens", placeholder: "A screen's name", params: [{ name: "query", about: "words of its name" }, { name: "kinds", about: "the tile kinds the asker draws" }, { name: "drawers", about: "the drawers the asker has" }], bar: {} }, read: screens },
];

/** The producers themselves, a row each: what a client may ask a list of, and which a command bar lists. */
function sources(): Answered {
  const rows = PRODUCERS.map(({ row: s }) => row({
    id: s.from, label: s.about, ...(s.placeholder ? { detail: s.placeholder } : {}), cells: [s.from, s.params.map(p => `${p.name}${p.required ? "" : "?"}`).join(" ")],
    // What it reads, a chip a parameter: a client hands a list its tile's fields by these names, and keeps no list of them.
    chips: s.params.map(p => ({ key: p.name, value: p.about })),
    ...(s.bar ? { group: "bar", ...(s.bar.main ? { mark: "main" } : {}) } : {}),
  }));
  return { list: { type: "list", arrange: "table", columns: ["from", "params"], headers: ["from", "params"], rows } };
}

/** Every list source as it says of itself. */
export const listSources = (): ListSource[] => PRODUCERS.map(p => p.row);

/** `lists.read`: the list `from` names, by its producer; a name none has is refused with the ones there are. */
export async function readList(own: Own, request: ListsRequest): Promise<ListAnswer> {
  const from = typeof request.from === "string" ? request.from : "";
  if (from === "sources") return { from, ...sources(), anyChange: true };
  const producer = PRODUCERS.find(p => p.row.from === from);
  if (!producer) throw new Refusal("invalid", `lists.read lists ${PRODUCERS.map(p => p.row.from).join(", ")} (from=sources says what each reads), not ${JSON.stringify(from)}`);
  return { from, ...await producer.read(own, request), anyChange: true };
}

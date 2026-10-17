// What a published page asks the service for its built-in components (src/publish-figures.ts draws them): a
// `::graph-*` figure's question and what its answer becomes (outline-core's figure-props.ts and figure-live.ts, the
// same reading the door's figures use), a `::links` component's groups, and a saved view's rows. The service owns the
// meaning: views are read with `views.read` (its order, limit and sort), queries with `blocks.query`, links with
// `blocks.authored-links` and `references.backlinks`; nothing here evaluates a view or a query. A row the page may
// not show (locked, outside a share, not public on a public page) is left out, never named.
import { linkingLineId } from "./publish-anchors";
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { siteBlockAt, type SiteBlock } from "@ep0ch/outline-core/site-blocks";
import { askProps, asksPerItem, CHILDREN_QUERY, figureQuestion, keepGroups, liveAsk, liveMark, liveProps, liveStatus, NONE, type FigureAnswer, type FigureItem } from "@ep0ch/outline-core/figure-live";
import type { SiteAnswer, SiteProduced, SiteProducer } from "@ep0ch/outline-core/site";
import { figureProps, figureSource, graphKind, type Props, type Row } from "@ep0ch/outline-core/figure-props";
import { figureRow } from "@ep0ch/outline-core/figure-markdown";
import { recordProperties } from "@ep0ch/outline-core/block-record";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { blockGroups, LINK_GROUPS, linkBlockAt, type LinkBlockSpec, type LinkGroupName } from "@ep0ch/outline-core/link-blocks";
import { matchesSearchText, prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import type { AuthoredLinksSnapshot } from "./authored-links";
import { componentSentinel, MAX_PUBLISHED_COMPONENTS } from "./publish-components";
import { componentSourceHtml, fieldsHtml, figureBodyHtml, figureFrame, linksHtml, viewLaneHtml, type FigureRows, type LinkGroupHtml, type LinkRowHtml, type ViewLane, type ViewRow } from "./publish-figures";
import { checklistItems } from "./checklist-items";
import { placeFigureStep, type PublishedStep } from "./publish-steps";
import { DEFAULT_PROPERTY_SUMMARY_KEYS, parsePropertySummaryKeys, propertySummarySegments } from "./property-summary";
import type { BacklinkCollection, BlockProperty, ProjectedBlockCollection, SavedViewReadResult, VisibleBlock } from "./types";

/** What the components on one page ask of the publisher: the service, and what this page may show and link. */
export interface LiveHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /** Which of `ids` this page shows: not locked, inside its share, public on a public page. */
  shown(ids: readonly string[]): Promise<Set<string>>;
  /** Each note's title as a page shows it. */
  titles(ids: readonly string[]): Promise<Map<string, string>>;
  /** Where a shown note opens from this page. */
  href(blockId: string): string | null;
}

/** A component drawn in place of its lines (`start` to `end`, inclusive): its sentinel's Markdown. */
export interface DrawnComponent { end: number; markdown: string }

const ms = (iso: string | undefined) => (iso ? Date.parse(iso) || 0 : 0);
const CHILDREN = CHILDREN_QUERY;

/**
 * The built-in components in each note's text, drawn: each `::graph-*` figure and `::links` component's HTML is pushed
 * onto `components` and its lines map to its sentinel. `first`: the note whose first line is the page's title (a
 * component there keeps the title above it).
 */
export async function drawNoteComponents(
  host: LiveHost, notes: readonly { id: string; text: string; revision?: number }[], components: string[], first?: { id: string; title: string },
  rows: { steps?: PublishedStep[]; inline?: (text: string) => string } = {},
): Promise<Map<string, Map<number, DrawnComponent>>> {
  const out = new Map<string, Map<number, DrawnComponent>>();
  for (const note of notes) {
    const lines = note.text.split("\n");
    if (!lines.some(line => /^ {0,3}::[a-z]/.test(line))) continue;
    const structure = noteStructure(lines);
    const byStart = new Map(componentBlocks(lines).map(block => [block.start, block]));
    const drawn = new Map<number, DrawnComponent>();
    for (let i = 0; i < lines.length && components.length < MAX_PUBLISHED_COMPONENTS; i++) {
      if (structure[i] !== -1 && structure[i] !== i) continue;
      const links = linkBlockAt(lines, i, byStart);
      const block = byStart.get(i), kind = block && graphKind(block);
      const site = !links && !kind ? siteBlockAt(lines, i, byStart) : null;
      // `::if`: its body stays in the page's Markdown when `this` matches (only its two lines go), else it all goes.
      if (site?.kind === "if") {
        const held = await holds(host, note.id, site.spec.where, site.spec.problem);
        if (held) { drawn.set(i, { end: i + 1, markdown: "" }); drawn.set(site.end, { end: site.end + 1, markdown: "" }); }
        else drawn.set(i, { end: site.end + 1, markdown: "" });
        i = site.end;
        continue;
      }
      if (!links && !kind && !site) continue;
      const end = links ? links.end : site ? site.end : block!.end;
      let html: string;
      try {
        html = site ? await drawFields(host, site as Extract<SiteBlock, { kind: "fields" }>, note.id)
          : links ? await drawLinks(host, links.spec, note.id)
          : await drawFigure(host, kind!, lines.slice(i + 1, end), note.id, lines.slice(0, i).every(line => !line.trim()), lines.slice(i, end + 1), figureRows(note, i + 1, rows), block!.attrs);
      } catch (error) {
        html = componentSourceHtml(lines.slice(i, end + 1), `couldn't ask the outline: ${(error as Error).message}`);
      }
      components.push(html);
      const sentinel = componentSentinel(components.length - 1);
      drawn.set(i, { end: end + 1, markdown: i === 0 && first?.id === note.id ? `${first.title}\n\n${sentinel}` : sentinel });
      i = end;
    }
    if (drawn.size) out.set(note.id, drawn);
  }
  return out;
}

// ── `::fields` and `::if` ──────────────────────────────────────────────────────────────────────────

/** Whether an `::if` draws its body on this page: the service says `this` matches. A query it can't read hides the body. */
async function holds(host: LiveHost, note: string, where: string, problem: string | undefined): Promise<boolean> {
  if (problem) return false;
  try { return (await produced(host, note, { kind: "if", where }) as Extract<SiteProduced, { kind: "if" }>).holds; }
  catch { return false; }
}

/** A `::fields`: the occurrences of a key in this note (or in `of:`, when this page shows it). A row is a line of a note the page shows, so a link in it shows only a note the page does. */
async function drawFields(host: LiveHost, block: Extract<SiteBlock, { kind: "fields" }>, note: string): Promise<string> {
  const { spec } = block;
  const title = spec.title ?? spec.key;
  if (spec.problem) return fieldsHtml(title, [], "", spec.problem);
  if (spec.of && !(await host.shown([spec.of])).has(spec.of)) return fieldsHtml(title, [], "", "a note not shown here");
  const a = await produced(host, note, { kind: "fields", key: spec.key, ...(spec.of ? { of: spec.of } : {}) }) as Extract<SiteProduced, { kind: "fields" }>;
  if (a.problem) return fieldsHtml(title, [], "", a.problem.message);
  const linked = await host.shown(a.rows.flatMap(row => row.link ? [row.link.id] : []));
  const rows = a.rows.map(row => row.link
    ? (linked.has(row.link.id) ? { text: row.link.title, line: row.line, href: host.href(row.link.id) } : { text: "a note not shown here", line: row.line })
    : { text: row.value, line: row.line });
  return fieldsHtml(title, rows, `live · ${rows.length} occurrence${rows.length === 1 ? "" : "s"}`);
}

// ── figures ────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What a page lends a figure's rows (PIE-864): their words drawn as the note's are, and each check row's box a step,
 * pushed onto the page's `steps` (a written row by where it starts in its note, a live row by its own note).
 */
function figureRows(note: { id: string; text: string; revision?: number }, first: number, rows: { steps?: PublishedStep[]; inline?: (text: string) => string }): (at: number) => FigureRows {
  return at => {
    const steps = rows.steps;
    const written = steps ? new Map(checklistItems(note.text, undefined, { figures: true }).filter(item => item.figure).map(item => [item.span.startLine, item])) : null;
    return {
      ...(rows.inline ? { inline: rows.inline } : {}),
      ...(steps ? { box: (it: Props) => {
        if (typeof it.line === "number") {
          const item = written!.get(first + at + it.line);
          return item ? placeFigureStep(steps, { block: note.id, revision: note.revision ?? 0, start: item.span.start, evidence: item.evidence, status: item.status }) : null;
        }
        if (typeof it.block !== "string" || !it.mark) return null;
        return placeFigureStep(steps, { block: it.block, revision: note.revision ?? 0, start: 0, evidence: `live:${it.block}`, status: it.status ?? (it.done ? "done" : "todo"), live: { note: note.id, figure: first - 1 } });
      } } : {}),
    };
  };
}

async function drawFigure(host: LiveHost, kind: string, body: readonly string[], note: string, block: boolean, source: readonly string[], rows?: (at: number) => FigureRows, attrs?: string): Promise<string> {
  const src = figureSource(body, note, block, attrs);
  // A figure block's child bullets are rows too (figureProps says when it wants them): asked once, then read again.
  let wanted = false;
  let read = figureProps(kind, src, () => { wanted = true; return { rows: [], waiting: true }; });
  if (wanted) {
    const rows = await childRows(host, note);
    read = figureProps(kind, src, () => ({ rows, waiting: false }));
  }
  if ("error" in read) return figureFrame(kind, kind, "", "", read.error);
  let props = read.props, foot = read.children ? "live · child notes" : "", error = "";
  const live = await answerFigure(host, kind, props, note, read.args);
  if (live) { props = live.props; foot = live.status; error = live.error ?? ""; }
  // Props written without their `---` lines (PIE-941): said in the figure, whatever it then draws.
  if (read.warning) error = [error, read.warning].filter(Boolean).join(" · ");
  const html = figureBodyHtml(kind, props, id => host.href(id), rows?.(src.at ?? 0));
  if (html === null) return componentSourceHtml(source);
  return figureFrame(kind, String(props.title ?? ""), html || `<p class="dim">no results</p>`, foot, error);
}

/**
 * What a mark on live row `row` of a `::graph-check` in `note` writes (PIE-864), read from the figure itself and checked
 * against its answer: the property its `done:` names, or null when no figure there lists that row with a `done:` of one
 * `key=value`. A page never takes the property from the request.
 */
export async function liveRowMark(host: Pick<LiveHost, "request">, note: { id: string; text: string }, row: string, figure: number): Promise<{ key: string; done: string } | null> {
  const lines = note.text.split("\n");
  // Every row is asked about as is: whether the page may show it was settled when it was drawn.
  const all: LiveHost = { request: host.request, shown: async ids => new Set(ids), titles: async () => new Map(), href: () => null };
  for (const block of componentBlocks(lines)) {
    if (block.start !== figure || block.end <= block.start || graphKind(block) !== "check") continue;
    const read = figureProps("check", figureSource(lines.slice(block.start + 1, block.end), note.id, undefined, block.attrs));
    if ("error" in read) continue;
    const mark = liveMark(read.props), asking = liveAsk("check", read.props);
    const question = mark && !asking.error ? figureQuestion(asking.ask, asking.group) : null;
    if (!question || "error" in question) continue;
    try { if ((await produced(all, note.id, { kind: "figure", figure: "check", props: askProps(read.props) }, read.args) as Extract<SiteProduced, { kind: "figure" }>).blocks.some(item => (item as { id: string }).id === row)) return mark; }
    catch { /* a figure that can't be asked lists nothing */ }
  }
  return null;
}

/** A note's child bullets as figure rows (each standing for its note), in the note's order. */
async function childRows(host: LiveHost, note: string): Promise<Row[]> {
  const found = await produced(host, note, { kind: "children" }) as Extract<SiteProduced, { kind: "children" }>;
  const blocks = found.blocks as { id: string; text?: string }[];
  const shown = await host.shown(blocks.map(block => block.id));
  return blocks.flatMap(block => {
    const prose = shown.has(block.id) ? headerLine(block.text ?? "").prose.trim() : "";
    return prose ? [{ ...figureRow(prose), block: block.id }] : [];
  });
}

/** What a producer in a note asks of its Site, answered by the service (`site.answer`): the one orchestration, here and in the door. */
async function produced(host: Pick<LiveHost, "request"> & Partial<Pick<LiveHost, "shown">>, note: string, produce: SiteProducer, args?: Record<string, string>): Promise<SiteProduced> {
  const props = args && Object.keys(args).length ? Object.fromEntries(Object.entries(args).map(([k, v]) => [k, [v]])) : undefined;
  // As a page's `{{ }}` values are read (publish-values.ts): asked again naming the notes the page may not show, when the
  // answer was computed from any, so a `{{ }}` operand never reads through one.
  const hidden = new Set<string>();
  for (let round = 0; round < 4; round++) {
    const answer = await host.request<SiteAnswer>({ action: "site.answer", blockId: note, produce, ...(props ? { props } : {}), ...(hidden.size ? { hidden: [...hidden] } : {}) });
    if (!answer.produced) throw new Error("the service answered no figure");
    const touched = answer.deps.filter(id => id !== note);
    const shown = host.shown && touched.length ? await host.shown(touched) : new Set(touched);
    const fresh = touched.filter(id => !shown.has(id) && !hidden.has(id));
    if (!fresh.length) return answer.produced;
    for (const id of fresh) hidden.add(id);
  }
  throw new Error("this reads a note that isn't shown here");
}

/** A live figure's props from the service's answer, or null when it asks nothing. */
async function answerFigure(host: LiveHost, kind: string, p: Props, note: string, args?: Record<string, string>): Promise<{ props: Props; status: string; error?: string } | null> {
  const asking = liveAsk(kind, p);
  const perItem = asksPerItem(kind, p);
  if (!perItem && asking.error) return { props: p, status: "live", error: asking.error };
  const question = figureQuestion(asking.ask, asking.group);
  if (!perItem && !question) return null;
  if (!perItem && question && "error" in question) return { props: p, status: "live", error: question.error };
  let a: Extract<SiteProduced, { kind: "figure" }>;
  try { a = await produced(host, note, { kind: "figure", figure: kind, props: askProps(p) }, args) as typeof a; }
  catch (e) { return { props: p, status: "live", error: (e as Error).message }; }
  if (perItem) {
    // Each item's count is of the results this page may show.
    const items = await Promise.all((p.items as Props[]).map(async (item, k) => {
      const c = a.counts?.[k];
      if (!c || !(item?.query || item?.view)) return item;
      if (c.error) return { ...item, value: "?" };
      const kept = await host.shown(c.ids);
      return { ...item, value: `${kept.size}${c.truncated ? "+" : ""}` };
    }));
    const error = a.counts?.find(c => c.error)?.error;
    return { props: { ...p, items }, status: "live", ...(error ? { error } : {}) };
  }
  if (a.error && !a.blocks.length) return { props: p, status: "live", error: a.error };
  const items = await itemsOf(host, a.blocks as never);
  const kept = new Set(items.map(item => item.id));
  // A group counts every match; the ones this page can't show come off its count, and a group whose every member is hidden goes.
  const groups = keepGroups(a.groups, kept);
  const answer: FigureAnswer = {
    items, truncated: a.truncated, ...(groups ? { groups } : {}),
    ...(a.done ? { done: new Set(a.done) } : {}), ...(a.now ? { now: new Set(a.now) } : {}), ...(a.hint ? { hint: a.hint } : {}),
  };
  const drawn = liveProps(kind, asking.props, answer);
  const error = drawn.error ?? a.error ?? answer.hint;
  return { props: drawn.props, status: liveStatus(answer), ...(error ? { error } : {}) };
}

async function itemsOf(host: LiveHost, blocks: readonly { id: string; properties?: BlockProperty[]; createdAt?: string; updatedAt?: string; author?: string }[]): Promise<FigureItem[]> {
  const shown = await host.shown(blocks.map(block => block.id));
  const visible = blocks.filter(block => shown.has(block.id));
  const titles = await host.titles(visible.map(block => block.id));
  return visible.map(block => ({
    id: block.id, title: titles.get(block.id) || "untitled", properties: recordProperties(block.properties ?? []),
    createdAt: ms(block.createdAt), updatedAt: ms(block.updatedAt), author: block.author ?? null,
  }));
}

// ── `::links` and its kin ──────────────────────────────────────────────────────────────────────────────

const GROUP_NAMES: Record<LinkGroupName, string> = { outlinks: "Outlinks", resources: "Resources", backlinks: "Backlinks", children: "Children", matches: "Matches" };

async function drawLinks(host: LiveHost, spec: LinkBlockSpec, note: string): Promise<string> {
  const groups = blockGroups(spec);
  const title = spec.title ?? (spec.query && spec.kind === "links" && !spec.groups ? "matches" : spec.kind);
  if (spec.problem) return figureFrame("links", title, "", "", spec.problem);
  const of = spec.of ?? note;
  // Another note's links only when this page shows that note.
  if (spec.of && !(await host.shown([spec.of])).has(spec.of)) return figureFrame("links", title, `<p class="dim">a note not shown here</p>`);
  const has = (g: LinkGroupName) => groups.includes(g);
  const [authored, backlinks, children, matches] = await Promise.all([
    has("outlinks") || has("resources") ? host.request<AuthoredLinksSnapshot>({ action: "blocks.authored-links", ownerBlockId: of }) : null,
    has("backlinks") ? host.request<BacklinkCollection>({ action: "references.backlinks", query: { targetBlockId: of, limit: 200 } }) : null,
    has("children") ? host.request<ProjectedBlockCollection>({ action: "blocks.query", query: { where: CHILDREN, this: of, limit: 1000 }, fields: ["title"] }) : null,
    spec.query ? host.request<ProjectedBlockCollection>({ action: "blocks.query", query: { where: spec.query, this: note, limit: 200 }, fields: ["title"] }).catch((e: Error) => e) : null,
  ]);
  if (matches instanceof Error) {
    return figureFrame("links", title, `<p class="dim">query: <code>${spec.query!.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`)}</code></p>`, "live · query not read", matches.message);
  }
  // Every note a row stands for, asked once whether this page shows it.
  const ids: string[] = [];
  if (authored?.kind === "ready") {
    for (const entry of authored.outlinks.entries) if (entry.resolution.kind === "ready") ids.push(entry.resolution.target.blockId);
    for (const entry of authored.resources.entries) if (entry.recordBlockId) ids.push(entry.recordBlockId);
  }
  for (const source of backlinks?.sources ?? []) ids.push(source.blockId);
  for (const block of [...(children?.blocks ?? []), ...(matches?.blocks ?? [])]) ids.push(block.id);
  const shown = await host.shown([...new Set(ids)]);
  const titles = await host.titles([...new Set([...(children?.blocks ?? []), ...(matches?.blocks ?? [])].map(block => block.id).filter(id => shown.has(id)))]);
  const to = (id: string) => (shown.has(id) ? host.href(id) : null);
  const filter = prepareSearchQuery(spec.filter);
  const keep = (rows: LinkRowHtml[]) => rows.filter(row => matchesSearchText(filter, [row.text, row.note ?? ""]));
  const rows: Record<LinkGroupName, LinkRowHtml[]> = { outlinks: [], resources: [], backlinks: [], children: [], matches: [] };
  const notes: Partial<Record<LinkGroupName, string>> = {};
  if (authored && authored.kind !== "ready") notes.outlinks = notes.resources = authored.kind === "owner-unavailable" ? `the note is ${authored.reason}` : "the note is too long to read its links";
  if (authored?.kind === "ready") {
    rows.outlinks = authored.outlinks.entries.flatMap((entry): LinkRowHtml[] => {
      const r = entry.resolution;
      if (r.kind === "ready") return shown.has(r.target.blockId) ? [{ text: r.title || entry.label, href: to(r.target.blockId) }] : [];
      return [{ text: entry.label, href: null, note: r.kind === "deleted" ? "in Trash" : r.reason }];
    });
    rows.resources = authored.resources.entries.flatMap((entry): LinkRowHtml[] => {
      if (entry.recordBlockId && !shown.has(entry.recordBlockId)) return [];
      const r = entry.resolution;
      const href = entry.recordBlockId ? to(entry.recordBlockId) : null;
      return [r.kind === "ready" ? { text: r.addressLabel || entry.label, href, note: r.sourceName } : { text: entry.label, href, note: r.reason }];
    });
  }
  rows.backlinks = (backlinks?.sources ?? []).filter(source => shown.has(source.blockId)).map(source => {
    // The door's backlinkLine selects the same occurrence: prefer the authored block link.
    const occurrence = source.occurrences.find(o => o.kind === "block") ?? source.occurrences[0];
    const href = to(source.blockId);
    return { text: source.title || "untitled", href: href && occurrence ? `${href}#${linkingLineId(occurrence.start)}` : href,
      ...(occurrence?.snippet ? { note: `“${occurrence.snippet}”` } : {}) };
  });
  const listed = (found: ProjectedBlockCollection | null) => (found?.blocks ?? []).filter(block => shown.has(block.id)).map(block => ({ text: titles.get(block.id) || "untitled", href: to(block.id) }));
  rows.children = listed(children);
  rows.matches = listed(matches instanceof Error ? null : matches);
  const drawn: LinkGroupHtml[] = groups.map(group => ({
    name: GROUP_NAMES[group], glyph: LINK_GROUPS.find(g => g.group === group)?.glyph ?? "·", rows: keep(rows[group]),
    note: notes[group] ?? (spec.filter ? `nothing matches ${spec.filter}` : "nothing here yet"),
  }));
  const counted = drawn.reduce((n, g) => n + g.rows.length, 0);
  const what = spec.query ? `${counted} match${counted === 1 ? "" : "es"}` : `${counted} link${counted === 1 ? "" : "s"}`;
  return linksHtml(title, drawn, `live · ${what}${spec.filter ? ` · ${spec.filter}` : ""}`);
}

// ── saved views ────────────────────────────────────────────────────────────────────────────────────────

const property = (properties: readonly BlockProperty[] | undefined, key: string) =>
  [...(properties ?? [])].reverse().find(candidate => candidate.key.toLowerCase() === key)?.value;

/**
 * A saved view as the service reads it (`views.read`: its members in its order, its sort and limit), with the rows
 * this page may show: each its title, a link, and its summary properties (`[summary-properties::]`, else the Tree's
 * default keys) as chips; grouped by `[group::<property>]` when it says so, in the order the rows come, rows without
 * the property last.
 */
export async function readViewLane(host: LiveHost, view: { id: string; properties?: BlockProperty[] }, title: string): Promise<ViewLane> {
  const query = property(view.properties, "query") ?? "";
  const base: ViewLane = { title, href: host.href(view.id), rows: [], count: 0, truncated: false, query };
  let read: SavedViewReadResult;
  try { read = await host.request<SavedViewReadResult>({ action: "views.read", viewId: view.id }); }
  catch (error) { return { ...base, problem: `couldn't read the view: ${(error as Error).message}` }; }
  if (read.status !== "ready") return { ...base, problem: `view ${read.status}${read.errors.length ? `: ${read.errors.join("; ")}` : ""}` };
  const blocks = read.blocks as VisibleBlock[];
  const shown = await host.shown(blocks.map(block => block.id));
  const visible = blocks.filter(block => shown.has(block.id));
  const titles = await host.titles(visible.map(block => block.id));
  const keys = parsePropertySummaryKeys(property(view.properties, "summary-properties")) ?? DEFAULT_PROPERTY_SUMMARY_KEYS;
  const rows: ViewRow[] = visible.map(block => ({
    id: block.id, title: titles.get(block.id) ?? "", href: host.href(block.id),
    chips: propertySummarySegments(block.properties, keys).map(segment => ({ label: segment.label, value: segment.value })),
  }));
  // Counted from the rows shown: the view's total would count notes this page can't see.
  const lane: ViewLane = { ...base, rows, count: rows.length, truncated: read.completeness?.kind === "truncated" || read.nextOffset !== undefined };
  const group = property(view.properties, "group")?.trim().toLowerCase();
  if (group) {
    const byValue = new Map<string, ViewRow[]>();
    visible.forEach((block, i) => {
      const value = property(block.properties, group) ?? NONE;
      byValue.set(value, [...(byValue.get(value) ?? []), rows[i]!]);
    });
    const none = byValue.get(NONE);
    byValue.delete(NONE);
    lane.groups = [...byValue].map(([value, members]) => ({ value, rows: members }));
    if (none) lane.groups.push({ value: `no ${group}`, rows: none });
  }
  return lane;
}

/** A view drawn as one lane (an embed of it, a folder's view child). */
export async function drawViewLane(host: LiveHost, view: { id: string; properties?: BlockProperty[] }, title: string): Promise<string> {
  return viewLaneHtml(await readViewLane(host, view, title));
}

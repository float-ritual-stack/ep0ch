// One links model: a block's Outlinks, Resources and Backlinks, as the outliner's Tree shows them under a block
// (PIE-259, PIE-324, PIE-329) and Detail groups its backlinks (PIE-442), and its Children (PIE-693: the notes under
// it; a thread's replies), which the links tile lists where the thread tile once did. Three places draw it, from
// this one model and this one row renderer:
//
//   - the tree's links under a row (`L`, src/desk/tree.ts), one panel per row;
//   - the links tile (kind `backlinks`, src/desk/backlinks-pane.ts), the list beside a reader, whose preview
//     companion shows the selected row: a note, a ticket's block, a Resource's stored content;
//   - the inline component in a note (`::links`, `::resources`, `::backlinks`), drawn by the body's renderer
//     (src/doc.ts) inside a figure's frame, each row an element the reader steps to and opens.
//
// The service owns the meaning: which links a block has and where each resolves (`blocks.authored-links`), what
// links to it (`references.backlinks`), whether a Resource is registered and what is stored for it
// (`resources.describe`). This module only lays the answers out, in the Tree's words (src/authored.ts) and
// Detail's backlink view (src/backlinks.ts). Showing a row (a preview) never writes: an unregistered Resource
// says ⏎ registers it, and only ⏎ (or a double click, or `open=true`) does.
import { referencedBlock } from "@ep0ch/outline-core/link-syntax";
import {
  groupHasSomething, groupNote, openResource, outlinkWords, resourceNote, resourceTarget, resourceWords, snapshotProblem,
  RESOURCE_NOTE, type AuthoredLinksSnapshot, type AuthoredOutlink, type AuthoredResourceLink, type AuthoredTargetFacets,
} from "./authored";
import {
  backlinkRows, backlinkRowSuffix, backlinkStageSummary, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, fitBacklinkRow, isOpenBacklinkStage,
  type BacklinkAcross, type BacklinkCollection, type BacklinkSource, type BacklinkStageFilter, type BacklinkViewGroup, type BacklinkViewOptions,
} from "./backlinks";
import { subject, type Msg } from "./board";
import { ago } from "./text";
import { COMPONENT_OPEN, componentAttrs, componentBlocks, type ComponentBlock } from "@ep0ch/outline-core/component-block";
import { matchesSearchText, prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { backlinkCollectionOf, LIST_FIELDS, USER, type Actor, type SocketBoard } from "./socket";
import { BACKLINK_QUERY_LIMIT } from "./backlinks";
import { watchedOn, type Watching } from "./watched";
import type { LinkTarget } from "./refs";
import { ActionRefused } from "./surface/actions";
import { C, ellipsize, fg, pad, RESET, selected as lit, width } from "./style";

// ── the model ────────────────────────────────────────────────────────────────────────────────────────

export type LinkGroupName = "outlinks" | "resources" | "backlinks" | "children" | "matches";
/**
 * The Tree's groups in its order, then the notes under the block, then a query's matches (PIE-693: an inline
 * `::links{query=…}`'s rows), each with the glyph the door draws.
 */
export const LINK_GROUPS: readonly { group: LinkGroupName; glyph: string }[] = [
  { group: "outlinks", glyph: "→" }, { group: "resources", glyph: "♦" }, { group: "backlinks", glyph: "←" }, { group: "children", glyph: "↓" }, { group: "matches", glyph: "≡" },
];
/** A block's own groups, in order: what a links tile shows when nobody chose (a query's matches are an inline block's). */
export const ALL_LINK_GROUPS: readonly LinkGroupName[] = ["outlinks", "resources", "backlinks", "children"];
export const isLinkGroup = (s: string): s is LinkGroupName => LINK_GROUPS.some(g => g.group === s);

export type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };
/**
 * One note under the block (PIE-693): the child as the service sent it, with its kind, stage and dates as the
 * service computes them for any row (`blocks.facets`, the backlinks' rules), so Kind, Stage and Sort narrow it.
 */
export interface ChildLink { block: Msg; facets?: AuthoredTargetFacets }
/**
 * What the service sent for one block: its authored links and its backlinks, each as it came (or why not), and the
 * notes under it where the list reads them (the links tile; the tree's rows are its children already).
 */
export interface LinkData { links: Load<AuthoredLinksSnapshot>; backlinks: Load<BacklinkCollection>; children?: Load<ChildLink[]>; matches?: Load<ChildLink[]> }

/** A comment or its reply is a block under the note too; it lists with Backlinks (kind Comment), never as a child. */
export const isAnnotationBlock = (m: Msg) => m.props.type === "annotation" || m.props.type === "annotation-reply";

/**
 * The notes under `id` as the Children group lists them: the service's children (comments left out), each with the
 * facets the service computes (`blocks.facets`). A child the facets read doesn't know any more keeps no facets.
 */
export async function readChildren(board: Pick<SocketBoard, "children" | "facets">, id: string): Promise<ChildLink[]> {
  const kids = (await board.children(id)).filter(m => !isAnnotationBlock(m));
  if (!kids.length) return [];
  const { facets } = await board.facets(kids.map(k => k.id));
  return kids.map(block => (facets[block.id] ? { block, facets: facets[block.id] } : { block }));
}

/** One row of a block's links: a group's header, a backlink kind's header, or a link. `key` is stable across reads. */
export type LinkRow =
  | { kind: "group"; key: string; depth: number; group: LinkGroupName; open: boolean; count: number | null; note: string }
  | { kind: "kind"; key: string; depth: number; group: BacklinkViewGroup; expanded: boolean }
  | { kind: "outlink"; key: string; depth: number; link: AuthoredOutlink }
  | { kind: "resource"; key: string; depth: number; link: AuthoredResourceLink }
  | { kind: "backlink"; key: string; depth: number; source: BacklinkSource }
  | { kind: "child"; key: string; depth: number; child: ChildLink }
  | { kind: "match"; key: string; depth: number; child: ChildLink };

/** How the rows are shown: the person's folds and filters, kept by the list that draws them. */
export interface LinkView {
  /** Groups folded to their header. */
  shut: ReadonlySet<LinkGroupName>;
  /** Backlink kind groups opened (Detail's rule: folded, but their open sources show). */
  kinds: ReadonlySet<string>;
  /** Detail's backlink options: filter, kind, stage, resolved, related, sort. */
  backlinks: Readonly<BacklinkViewOptions>;
  /** Only these groups (the inline `::resources`, a links tile's chosen groups); every group otherwise. */
  only?: ReadonlySet<LinkGroupName>;
  /** The sort (`backlinks.sortField`) orders Outlinks and Resources too, as it does Backlinks (the links tile); else they stay in the note's order. */
  sortAll?: boolean;
}

/** Separates a row's key from its group's (the tree nests a row's own links under its key). */
export const SEP = " > ";

/**
 * The rows of one block's links, in the Tree's order (Outlinks, Resources, Backlinks), each group's entries under
 * its header while it's open. An Outlinks or Resources group with nothing to say isn't shown; Backlinks always is.
 * The filter (`view.backlinks.filter`) narrows all three. `prefix` keys the rows (a tree row's key), `depth` is the
 * groups' own.
 */
export function linkRows(data: LinkData, view: LinkView, prefix = "", depth = 0): LinkRow[] {
  const out: LinkRow[] = [];
  // The one matcher (outline-core's search-match.ts), as the backlinks' filter: prepared once for every row.
  const filter = prepareSearchQuery(view.backlinks.filter ?? "");
  for (const { group } of LINK_GROUPS) {
    if (view.only && !view.only.has(group)) continue;
    const key = prefix + group;
    let count: number | null = null, note = "";
    const entries: LinkRow[] = [];
    if (group === "children" || group === "matches") {
      const c = group === "children" ? data.children : data.matches;
      // Read only where the list asks for them (the links tile); elsewhere the group isn't there.
      if (!c) continue;
      if (c.kind === "loading") note = "asking the service…";
      else if (c.kind === "error") note = c.message;
      else {
        // No children: the group says nothing, as an empty Outlinks doesn't, unless it's all the list shows (the replies).
        if (!c.value.length && !(view.only?.size === 1)) continue;
        const rows: LinkRow[] = c.value.map(child => ({ kind: group === "children" ? "child" : "match", key: key + SEP + child.block.id, depth: depth + 1, child }));
        entries.push(...narrowRows(rows, view.backlinks, filter, !!view.sortAll));
        count = entries.length;
      }
    } else if (group === "backlinks") {
      const b = data.backlinks;
      if (b.kind === "loading") note = "asking the service…";
      else if (b.kind === "error") note = b.message;
      else {
        const bv = backlinkView(b.value, view.backlinks);
        count = bv.matching.length;
        const c = b.value.completeness;
        note = [bv.hiddenRelated ? `${bv.hiddenRelated} this note hidden` : "", bv.hiddenResolved ? `${bv.hiddenResolved} resolved hidden` : "",
          c.kind === "truncated" ? `first ${c.limit ?? b.value.sources.length} sources` : ""].filter(Boolean).join(" · ");
        for (const r of backlinkRows(bv, view.backlinks, view.kinds)) {
          if (r.kind === "group") entries.push({ kind: "kind", key: `${key}${SEP}kind:${r.group.kind}`, depth: depth + 1, group: r.group, expanded: r.expanded });
          else entries.push({ kind: "backlink", key: key + SEP + r.source.blockId, depth: depth + (bv.faceted ? 2 : 1), source: r.source });
        }
      }
    } else {
      const l = data.links;
      if (l.kind === "loading") note = "asking the service…";
      else if (l.kind === "error") note = l.message;
      else {
        const why = snapshotProblem(l.value);
        if (why) note = why;
        else if (l.value.kind === "ready") {
          const g = l.value[group];
          if (!groupHasSomething(g)) continue;
          note = groupNote(g);
          for (const row of authoredRows(g.entries, group, key, depth + 1, view.backlinks, filter, !!view.sortAll).rows) entries.push(row);
          count = entries.length;
        }
      }
    }
    const open = !view.shut.has(group);
    out.push({ kind: "group", key, depth, group, open, count, note });
    if (open) out.push(...entries);
  }
  return out;
}


// ── Kind, Stage and Sort on every group ──────────────────────────────────────────────────────────────

/**
 * What a row's target is, for Kind, Stage and Sort: a backlink's own facets, an Outlink's or a Resource's
 * (a ticket kept as a block) as the service sent them with its links. Null for a link with no target block:
 * unregistered, missing, in the Trash. Such a row stays while nothing narrows by kind or stage, and drops out
 * when something does; sorted by date it goes last.
 */
export function rowFacets(r: LinkRow): { kind: string; kindLabel: string; bucket?: string; createdAt: string; updatedAt: string; title: string } | null {
  if (r.kind === "child" || r.kind === "match") {
    const f = r.child.facets;
    return f ? { kind: f.kind, kindLabel: f.kindLabel, ...(f.stage?.bucket ? { bucket: f.stage.bucket } : {}), createdAt: f.createdAt, updatedAt: f.updatedAt, title: linkWords(r).text } : null;
  }
  if (r.kind === "backlink") {
    const f = r.source.facets;
    return f ? { kind: f.kind, kindLabel: f.kindLabel, ...(f.stage?.bucket ? { bucket: f.stage.bucket } : {}), createdAt: r.source.createdAt, updatedAt: r.source.updatedAt, title: r.source.title } : null;
  }
  const f: AuthoredTargetFacets | undefined = r.kind === "outlink" ? (r.link.resolution.kind === "ready" ? r.link.resolution.facets : undefined) : r.kind === "resource" ? r.link.facets : undefined;
  return f ? { kind: f.kind, kindLabel: f.kindLabel, ...(f.stage?.bucket ? { bucket: f.stage.bucket } : {}), createdAt: f.createdAt, updatedAt: f.updatedAt, title: linkWords(r).text } : null;
}

const stageMatches = (bucket: string | undefined, stage: BacklinkStageFilter) =>
  stage === "all" || (stage === "open" ? isOpenBacklinkStage(bucket as never) : bucket === stage);

/** An Outlink's or Resource's rows after the text, kind and stage filters and the sort the Backlinks group answers to; `total` is how many there were. */
function authoredRows(entries: readonly (AuthoredOutlink | AuthoredResourceLink)[], group: "outlinks" | "resources", key: string, depth: number, o: Readonly<BacklinkViewOptions>, filter: ReturnType<typeof prepareSearchQuery>, sort: boolean): { rows: LinkRow[]; total: number } {
  const rows: LinkRow[] = entries.map(e => group === "outlinks"
    ? { kind: "outlink", key: key + SEP + e.key, depth, link: e as AuthoredOutlink }
    : { kind: "resource", key: key + SEP + e.key, depth, link: e as AuthoredResourceLink });
  return { rows: narrowRows(rows, o, filter, sort), total: entries.length };
}

/** Rows that aren't backlinks after the text, kind and stage filters, sorted as the Backlinks group is when `sort`. */
function narrowRows(all: readonly LinkRow[], o: Readonly<BacklinkViewOptions>, filter: ReturnType<typeof prepareSearchQuery>, sort: boolean): LinkRow[] {
  const rows: LinkRow[] = [];
  for (const row of all) {
    const w = linkWords(row), f = rowFacets(row);
    if (!matchesSearchText(filter, [w.text, w.context, f?.kindLabel ?? "", ...(f?.bucket ? [f.bucket] : [])])) continue;
    if (o.kind !== null && f?.kind !== o.kind) continue;
    if (o.stage !== "all" && !(f && stageMatches(f.bucket, o.stage))) continue;
    rows.push(row);
  }
  const dir = o.sortDirection === "asc" ? 1 : -1, field = o.sortField;
  const cmp = (a: LinkRow, b: LinkRow): number => {
    const fa = rowFacets(a), fb = rowFacets(b);
    // As the backlinks: open items first; a link with no target block after the rest, whatever the sort.
    const open = Number(isOpenBacklinkStage(fb?.bucket as never)) - Number(isOpenBacklinkStage(fa?.bucket as never));
    if (open) return open;
    if (!fa || !fb) return Number(!fa) - Number(!fb) || linkWords(a).text.localeCompare(linkWords(b).text);
    const primary = field === "title" ? fa.title.localeCompare(fb.title, undefined, { sensitivity: "base" })
      : (field === "created" ? fa.createdAt : fa.updatedAt).localeCompare(field === "created" ? fb.createdAt : fb.updatedAt);
    return dir * primary || fa.title.localeCompare(fb.title) || a.key.localeCompare(b.key);
  };
  if (sort) rows.sort(cmp);
  return rows;
}

/**
 * How many links match in each group, and the kinds present anywhere, across all three: the links tile's
 * counters and Kind control. A group still being read, or with nothing, counts as unknown (null).
 */
export function linkAcross(data: LinkData, o: Readonly<BacklinkViewOptions>, only?: ReadonlySet<LinkGroupName>): BacklinkAcross {
  const filter = prepareSearchQuery(o.filter ?? "");
  const shows = (g: LinkGroupName) => !only || only.has(g);
  const by: BacklinkAcross["by"] = {};
  for (const g of ["outlinks", "resources", "backlinks"] as const) if (shows(g)) by[g] = null;
  const kinds = new Map<string, string>();
  const note = (f: { kind: string; kindLabel: string } | undefined) => { if (f && !kinds.has(f.kind)) kinds.set(f.kind, f.kindLabel); };
  if (data.backlinks.kind === "ready" && shows("backlinks")) {
    const bv = backlinkView(data.backlinks.value, o), all = backlinkView(data.backlinks.value, { ...o, kind: null, stage: "all", filter: "" });
    by.backlinks = { matching: bv.matching.length, total: bv.total, filtered: bv.filtered };
    for (const k of all.kinds) kinds.set(k.kind, k.label);
  }
  if (data.links.kind === "ready" && data.links.value.kind === "ready") {
    for (const group of ["outlinks", "resources"] as const) {
      if (!shows(group)) continue;
      const g = data.links.value[group];
      const { rows, total } = authoredRows(g.entries, group, group, 1, o, filter, true);
      by[group] = { matching: rows.length, total, filtered: total - rows.length };
      for (const e of g.entries) note(group === "outlinks" ? (e as AuthoredOutlink).resolution.kind === "ready" ? ((e as AuthoredOutlink).resolution as { facets?: AuthoredTargetFacets }).facets : undefined : (e as AuthoredResourceLink).facets);
    }
  }
  for (const g of ["children", "matches"] as const) {
    const d = data[g];
    if (!d || !shows(g)) continue;
    if (d.kind !== "ready") { by[g] = null; continue; }
    const all = d.value.map((child): LinkRow => ({ kind: g === "children" ? "child" : "match", key: child.block.id, depth: 1, child }));
    const rows = narrowRows(all, o, filter, false);
    by[g] = { matching: rows.length, total: all.length, filtered: all.length - rows.length };
    for (const c of d.value) note(c.facets);
  }
  const sum = (f: (x: { matching: number; total: number; filtered: number }) => number) => Object.values(by).reduce<number>((n, x) => n + (x ? f(x) : 0), 0);
  return { matching: sum(x => x.matching), total: sum(x => x.total), filtered: sum(x => x.filtered), by, kinds: [...kinds].map(([kind, label]) => ({ kind, label })) };
}

/** The block a row stands for: a resolved outlink's target, a backlink's source (a ticket's block is `linkOpens`'). */
export function linkBlock(r: LinkRow | { kind: string } | undefined): string | null {
  if (!r) return null;
  const x = r as LinkRow;
  if (x.kind === "outlink") return x.link.resolution.kind === "ready" ? x.link.resolution.target.blockId : null;
  if (x.kind === "backlink") return x.source.blockId;
  if (x.kind === "child" || x.kind === "match") return x.child.block.id;
  return null;
}

/** Whether ⏎ on a row opens something (a note, a ticket, a Resource) rather than folding a group. */
export const isLinkEntry = (r: LinkRow | undefined): r is Extract<LinkRow, { kind: "outlink" | "resource" | "backlink" | "child" | "match" }> =>
  !!r && (r.kind === "outlink" || r.kind === "resource" || r.kind === "backlink" || r.kind === "child" || r.kind === "match");

/**
 * A row as words: its mark, its text and its dim context (`peek`, agents, and the drawing). `nest`: whether a row
 * that stands for a note shows its own links beneath it (the tree's ▾), not, or null where rows don't nest.
 */
export function linkWords(r: LinkRow, nest: boolean | null = null): { mark: string; text: string; context: string; problem?: boolean } {
  switch (r.kind) {
    case "group": {
      const g = LINK_GROUPS.find(x => x.group === r.group)!;
      return { mark: r.open ? "▾" : "▸", text: `${g.glyph} ${r.group}${r.count === null ? "" : ` (${r.count})`}`, context: r.note };
    }
    case "kind": return { mark: r.expanded ? "−" : "+", text: `${r.group.label} ${r.group.sources.length}`, context: backlinkStageSummary(r.group).trim() };
    case "outlink": { const w = outlinkWords(r.link); return { mark: w.problem ? "!" : nest === null ? "→" : linkBlock(r) ? (nest ? "▾" : "▸") : "·", ...w }; }
    case "resource": { const w = resourceWords(r.link); return { mark: w.problem ? "!" : "♦", ...w }; }
    case "backlink": return { mark: nest === null ? "←" : nest ? "▾" : "▸", text: r.source.title, context: backlinkRowSuffix(r.source) };
    case "child": case "match": {
      const b = r.child.block, f = r.child.facets;
      return { mark: nest === null ? (r.kind === "child" ? "↓" : "∙") : nest ? "▾" : "▸", text: subject(b), context: [f?.stage ? f.stage.value : "", b.author ?? "", ago(b.updatedAt)].filter(Boolean).join(" · ") };
    }
  }
}

/**
 * One row as drawn, `cols` wide: indented by its depth, its mark, its text and dim context, lit while selected
 * (`focused`: the list has the keys). `tag` wraps the row's text (the inline component tags it as a link the
 * reader steps to). The tree, the links tile and the inline component all draw a row with this.
 */
export function linkRowLine(r: LinkRow, o: { cols: number; selected?: boolean; focused?: boolean; nest?: boolean | null; indent?: string; tag?: (text: string) => string }): string {
  const words = linkWords(r, o.nest ?? null);
  const head = `${o.indent ?? "  ".repeat(r.depth)}${words.mark} `;
  let text = words.text, context = words.context;
  const room = Math.max(4, o.cols - width(head));
  if (r.kind === "backlink") { const f = fitBacklinkRow(text, context, room); text = f.title; context = f.suffix; }
  else if (width(text) > room) { text = ellipsize(text, room); context = ""; }
  const tail = context ? (r.kind === "backlink" ? " — " : r.kind === "kind" ? " " : " · ") + context : "";
  const shown = o.tag ? o.tag(text) : text;
  if (o.selected) return lit(o.focused ?? true, "idleRow") + pad(head + shown + tail, o.cols) + RESET;
  const colour = words.problem ? C.lred : r.kind === "group" ? C.yellow : r.kind === "kind" ? C.brown : r.kind === "resource" ? C.lgreen : C.white;
  return pad(`${fg(C.lcyan)}${head}${fg(colour)}${shown}${fg(C.dark)}${tail}`, o.cols) + RESET;
}

/** A row for agents and `peek`: its kind, its words, and what it stands for. */
export function describeLinkRow(r: LinkRow, n: number, sel: boolean) {
  const w = linkWords(r);
  const res = r.kind === "resource" ? r.link : null;
  return {
    n, kind: r.kind, text: w.text, ...(w.context ? { context: w.context } : {}),
    ...(r.kind === "group" ? { group: r.group, open: r.open } : r.kind === "kind" ? { group: r.group.kind, open: r.expanded } : {}),
    ...(linkBlock(r) ? { id: linkBlock(r)! } : {}),
    ...(res ? { resource: res.resourceId ?? (res.resolution.kind === "ready" ? res.resolution.target.resourceId : null), ...(res.recordBlockId ? { ticket: res.recordBlockId } : {}), ...(w.problem ? { unavailable: true } : {}) } : {}),
    ...(r.kind === "backlink" ? { stage: r.source.facets?.stage?.bucket } : {}),
    ...(sel ? { selected: true } : {}),
  };
}

// ── what a row shows and opens ───────────────────────────────────────────────────────────────────────

/** What the service answers that a row's note is read from. */
export type LinkBoard = Pick<SocketBoard, "get" | "resolvePage" | "describeResource" | "followAuthored">;

/** An authored reference not registered yet, as a note that says so: previewing it registers nothing. */
function unregisteredNote(link: AuthoredResourceLink): Msg {
  const w = resourceWords(link), at = Date.now();
  const text = `${link.label}\n*not registered yet*\n\nThis resource isn't registered in the outline yet, so nothing is stored for it. ⏎ (or a double click) registers it and shows what it holds.`;
  return { id: `${RESOURCE_NOTE}unregistered:${link.key}`, text: w.problem ? `${link.label}\n\n${w.context}` : text, parentId: null, childIds: [], createdAt: at, updatedAt: at, author: "resource", props: {} };
}

/**
 * The note a row stands for. `show` (a preview following the list): read only, never a write or a fetch (a
 * Resource's stored content as it is, an unregistered one saying so). `open` (⏎, a double click): a Resource is
 * registered if it must be and fetched once when nothing is stored (`openResource`), as the Tree's ⏎ does.
 * Refused, with the reason, for a row that leads nowhere. `from`: the note whose links these are, kept on a comment
 * made on the Resource as its reference context (PIE-650).
 */
export async function linkNote(r: LinkRow, board: LinkBoard, how: "show" | "open", actor: Actor = USER, from?: string): Promise<{ note: Msg; registered?: boolean; ticket?: string }> {
  if (r.kind === "group" || r.kind === "kind") throw new ActionRefused("a group's header stands for no note: ⏎ folds it");
  if (r.kind === "backlink") {
    const m = await board.get(r.source.blockId);
    if (!m) throw new ActionRefused("that source isn't in the outline any more");
    return { note: m };
  }
  if (r.kind === "child" || r.kind === "match") {
    const m = await board.get(r.child.block.id);
    if (!m) throw new ActionRefused(r.kind === "child" ? "that note isn't under this one any more" : "that note isn't in the outline any more");
    return { note: m };
  }
  if (r.kind === "outlink") {
    const res = r.link.resolution;
    if (res.kind === "unregistered-page") {
      const p = await board.resolvePage(res.address).catch(() => null);
      if (!p?.block) throw new ActionRefused(`[[${res.address}]] isn't a page yet · the door doesn't create one`);
      return { note: p.block.partial ? await board.get(p.block.id) ?? p.block : p.block };
    }
    if (res.kind !== "ready") throw new ActionRefused(`${r.link.label} · ${outlinkWords(r.link).context}`);
    const m = await board.get(res.target.blockId);
    if (!m) throw new ActionRefused(`nothing answers at ${res.target.blockId.slice(0, 8)}`);
    return { note: m };
  }
  // A ticket the Jira extension keeps as a block (PIE-445): that block, a note like any other.
  if (r.link.recordBlockId) {
    const m = await board.get(r.link.recordBlockId);
    if (!m) throw new ActionRefused(`${r.link.label}'s ticket block isn't there any more`);
    return { note: m, ticket: r.link.label };
  }
  const to = resourceTarget(r.link);
  if ("refused" in to) throw new ActionRefused(to.refused);
  if (how === "show") {
    if ("reference" in to) return { note: unregisteredNote(r.link) };
    return { note: resourceNote(await board.describeResource(to.resourceId, false), from) };
  }
  return openResource(board, to, actor, from).catch((e: Error) => { throw new ActionRefused(`couldn't show ${r.link.label}: ${e.message}`); });
}

/** A row's place as a link a reader's elements open (the inline component's rows), or null for a header. */
export function linkTargetOf(r: LinkRow): LinkTarget | null {
  if (r.kind === "backlink") return { block: r.source.blockId, role: "row" };
  if (r.kind === "child" || r.kind === "match") return { block: r.child.block.id, role: "row" };
  if (r.kind === "outlink") {
    const res = r.link.resolution;
    if (res.kind === "ready") return { block: res.target.blockId, ...(res.target.fragmentId ? { fragment: res.target.fragmentId } : {}), role: "row" };
    if (res.kind === "unregistered-page") return { page: res.address };
    return { role: "resource", reason: `${r.link.label} · ${outlinkWords(r.link).context}` };
  }
  if (r.kind === "resource") return r.link.recordBlockId ? { block: r.link.recordBlockId, role: "row" } : { resource: r.link, label: r.link.label };
  return null;
}

/** A note's links as an agent reads them: every row as the list numbers them, every group open, nobody's view changed. */
export async function readLinks(board: Pick<SocketBoard, "authoredLinks" | "backlinks" | "children" | "facets">, id: string) {
  const ask = <T>(p: Promise<T>): Promise<Load<T>> => p.then(value => ({ kind: "ready" as const, value }), (e: Error) => ({ kind: "error" as const, message: `couldn't ask: ${e.message}` }));
  const [links, backlinks, children] = await Promise.all([ask(board.authoredLinks(id)), ask(board.backlinks(id)), ask(readChildren(board, id))]);
  const kinds = backlinks.kind === "ready" ? new Set(backlinkView(backlinks.value, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds.map(k => k.kind)) : new Set<string>();
  return { rows: linkRows({ links, backlinks, children }, { shut: new Set(), kinds, backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS }).map((r, i) => describeLinkRow(r, i + 1, false)) };
}

// ── the inline component: `::links`, `::resources`, `::backlinks` ────────────────────────────────────

/** The inline component's names: every group, or one. */
export const LINK_BLOCK_KINDS = ["links", "outlinks", "resources", "backlinks"] as const;
export type LinkBlockKind = (typeof LINK_BLOCK_KINDS)[number];
/** Where an inline component draws its selected row (PIE-693): beside the list, under it, or not at all. */
export type LinkPreview = "right" | "below" | "none";
const PREVIEWS: readonly LinkPreview[] = ["right", "below", "none"];
/** The narrowest frame a preview goes beside the list in; narrower, the list alone. */
export const PREVIEW_MIN_WIDTH = 70;
/** The most rows a preview draws: the rest is the note's, a ⏎ away. */
const PREVIEW_ROWS = 16;

/**
 * What an inline component asks: whose links (default the note it's in), which groups, a filter, a title; and
 * (PIE-693) a query whose matches it lists, and where it previews the selected row.
 */
export interface LinkBlockSpec {
  kind: LinkBlockKind; of: string | null; filter: string; title: string | null;
  /** The groups written (`groups:`), or null for its name's. */
  groups: LinkGroupName[] | null;
  /** A query in the saved views' grammar: its matches are the `matches` group. */
  query: string | null;
  preview: LinkPreview;
  problem?: string;
}

/** The groups an inline component lists: its `groups:`, else its name's (`::links`: every group of the block, or a query's matches alone). */
export function blockGroups(spec: LinkBlockSpec): LinkGroupName[] {
  if (spec.groups) return spec.groups;
  if (spec.kind !== "links") return [spec.kind];
  return spec.query ? ["matches"] : [...ALL_LINK_GROUPS];
}

/** A `groups:` value: `links` (every group of the block), or group names, comma- or space-separated. */
function groupsFrom(v: string): LinkGroupName[] | string {
  const names = v.split(/[\s,]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  if (!names.length) return "groups: names at least one group";
  const out = new Set<LinkGroupName>();
  for (const n of names) {
    if (n === "links") ALL_LINK_GROUPS.forEach(g => out.add(g));
    else if (isLinkGroup(n)) out.add(n);
    else return `groups: is links or ${LINK_GROUPS.map(g => g.group).join(", ")}, not ${n}`;
  }
  return LINK_GROUPS.map(g => g.group).filter(g => out.has(g));
}

/**
 * The inline component starting at line `i`, or null. Where it ends (`end`, inclusive) is outline-core's
 * component-block rule (`blocks`: the lines' componentBlocks by first line, when the caller has them). Three forms:
 *
 *     ::resources jira                 one line: the words after the name filter the rows; `::links` alone,
 *                                        unclosed, is every link
 *
 *     ::links                          a block to its `::`: each line inside is `of:` (whose links),
 *     of: ((id))                         `filter:`, `title:`, `groups:`, `query:` or `preview:`, or else the
 *     filter: offer                      filter's words; `---` lines (Comark's YAML fence) are skipped
 *     ::
 *
 *     ::links{query="type=outbox-item status=waiting" preview=right}
 *                                      the same keys in braces (outline-core's componentAttrs), closed by `::`
 *                                        or on its line alone
 */
export function linkBlockAt(lines: readonly string[], i: number, blocks: ReadonlyMap<number, ComponentBlock> = new Map(componentBlocks(lines).map(c => [c.start, c]))): { spec: LinkBlockSpec; end: number } | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  const block: ComponentBlock | null = blocks.get(i) ?? (open && !open[2] ? { name: open[1]!, args: null, start: i, end: i, ...(open[3] ? { attrs: open[3].slice(1, -1) } : {}) } : null);
  if (!block || !(LINK_BLOCK_KINDS as readonly string[]).includes(block.name)) return null;
  const rest = (block.args ?? "").trim(), end = block.end;
  const spec: LinkBlockSpec = { kind: block.name as LinkBlockKind, of: null, filter: "", title: null, groups: null, query: null, preview: "none" };
  const idOf = (s: string) => referencedBlock(s)?.blockId ?? null;
  const words: string[] = [];
  let preview: string | null = null;
  const set = (k: string, v: string) => {
    if (k === "of") { spec.of = idOf(v); if (!spec.of) spec.problem = `of: needs a ((block)) or a block id, not ${v}`; }
    else if (k === "filter") words.push(v);
    else if (k === "title") spec.title = v;
    else if (k === "query") spec.query = v.trim() || null;
    else if (k === "preview") preview = v.trim().toLowerCase();
    else if (k === "groups") { const g = groupsFrom(v); if (typeof g === "string") spec.problem = g; else spec.groups = g; }
    else return false;
    return true;
  };
  // Its attributes, in braces on the first line.
  for (const a of componentAttrs(block.attrs ?? "").pairs) if (!set(a.key.toLowerCase(), a.value)) spec.problem = `${a.key} isn't one of ::${block.name}'s keys (of, filter, title, groups, query, preview)`;
  // Its arguments: `::links ((id))` names whose; anything else is the filter.
  if (rest) { const id = idOf(rest); if (id) spec.of = id; else words.push(rest); }
  for (const line of lines.slice(i + 1, end)) {
    if (/^\s*---\s*$/.test(line)) continue;
    const kv = /^\s*(of|filter|title|groups|query|preview)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) { words.push(line.trim()); continue; }
    set(kv[1]!, kv[2]!.replace(/^["']|["']$/g, ""));
  }
  spec.filter = words.filter(Boolean).join(" ");
  if (preview !== null && !(PREVIEWS as readonly string[]).includes(preview)) spec.problem = `preview: is right, below or none, not ${preview}`;
  spec.preview = (preview as LinkPreview | null) ?? (spec.query ? "right" : "none");
  if (spec.groups?.includes("matches") && !spec.query) spec.problem = "groups: matches lists a query's blocks: add query: (type=outbox-item status=waiting)";
  if (spec.kind !== "links" && (spec.query || spec.groups)) spec.problem = `::${spec.kind} lists its own group; ::links takes query: and groups:`;
  return { spec, end };
}

// What the service answers for the inline components (a block's links and backlinks, its children, a query's
// matches): watched reads (src/watched.ts), told when their answer changed, so a redraw never asks and nothing is
// asked again on a change that didn't touch it. One holder per connection: the inline components of every reader
// share it.
type LinksBoard = Pick<SocketBoard, "request" | "facets" | "toMsgs"> & { watched?: SocketBoard["watched"] };
let source: LinksBoard | null = null;
let redraw: () => void = () => {};
let unlisten: () => void = () => {};
/** Also told when an answer arrives (besides the connection's own redraw), until the returned function is called. */
const listeners = new Set<() => void>();
export function listenLinks(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { redraw(); for (const fn of listeners) fn(); };

/** The door's outline connection and its repaint, for the inline components. */
export function setLinksSource(b: LinksBoard | null, repaint: () => void) {
  unlisten();
  source = b; redraw = repaint;
  unlisten = b ? watchedOn(b).listen(changed) : () => {};
}
/** The connection and its repaint now, to put back after borrowing it (drawNote). */
export const linksSource = (): { board: LinksBoard | null; redraw: () => void } => ({ board: source, redraw });

/** A watched read as the links model's Load. */
function loaded<T>(read: Watching<T>): Load<T> {
  if (read.state === "ready") return { kind: "ready", value: read.value };
  // A key nobody has written is the service's hint (`no notes have <key>; nearest: …`), said as it is.
  if (read.state === "error") return read.value !== undefined ? { kind: "ready", value: read.value } : { kind: "error", message: read.error.startsWith("no notes have ") ? read.error : `couldn't ask: ${read.error}` };
  return { kind: "loading" };
}

/** Block `id`'s links and backlinks, as last answered (watched: the service says when either changed). */
export function linksOf(id: string): LinkData | null {
  if (!source) return null;
  const watched = watchedOn(source);
  return {
    links: loaded(watched.read("blocks.authored-links", { ownerBlockId: id }, (r: AuthoredLinksSnapshot) => r)),
    backlinks: loaded(watched.read("references.backlinks", { query: { targetBlockId: id, limit: BACKLINK_QUERY_LIMIT } }, (r: BacklinkCollection) => backlinkCollectionOf(r, id))),
  };
}

/**
 * A question's matches with the facets the service computes for each (`blocks.facets`), in the service's order: a
 * block's children (`parent:this`, comments left out) or an inline component's `query`, whose `this` is the note it
 * sits in. Watched: asked again only when the service says the answer changed.
 */
function questionRows(b: LinksBoard, question: { where: string; this?: string }, limit: number): Load<ChildLink[]> {
  return loaded(watchedOn(b).read("blocks.query", { query: { ...question, limit }, fields: LIST_FIELDS }, async (r: { blocks: any[]; hint?: string }) => {
    const notes = b.toMsgs(r.blocks);
    if (!notes.length && r.hint) throw new Error(r.hint);
    if (!notes.length) return [];
    const { facets } = await b.facets(notes.map(n => n.id));
    return notes.map(block => (facets[block.id] ? { block, facets: facets[block.id] } : { block }));
  }));
}
/** The notes under block `id` (the Children group of an inline component), comments left out. */
const childLinks = (b: LinksBoard, id: string) => questionRows(b, { where: "parent:this NOT type=annotation NOT type=annotation-reply", this: id }, 1000);

/**
 * The reader's hold on a note's inline components (PIE-693), as FiguresEnv is on its figures: which row each has
 * selected and whether the person is in it, how its rows, its `⏎ in` control and its preview are tagged and drawn,
 * and what each drew. Without it (an embed, a draft's preview, `ep0ch show`) a component draws its list as text.
 */
export interface LinkBlocksEnv {
  /** Counted as the components are drawn (one env for a layout): a component's key is its title and how many before it had it. */
  drawn?: { n: number; titles: Map<string, number> };
  ui?(key: string): { sel?: string; entered?: boolean; typing?: string } | undefined;
  /** Tag a row, its target `to`, as row `row` of component `key`. */
  row?(key: string, row: string, to: LinkTarget, text: string): string;
  /** Tag the frame's control that goes in (or out). */
  control?(key: string, text: string): string;
  /** Block `id` drawn `width` wide, as the reader draws an embed of it. */
  preview?(id: string, width: number): string[];
  seen?(info: LinkBlockInfo): void;
}
/** One inline component as drawn: its key and place, its rows (each its row key, the block it stands for, its words), the selection, what's previewed. */
export interface LinkBlockInfo {
  key: string; n: number; title: string;
  rows: { key: string; id: string | null; text: string; kind: LinkRow["kind"] }[];
  sel: string | null; preview: string | null; previews: boolean; entered: boolean; typing: string | null;
  query: string | null; groups: LinkGroupName[];
}

/**
 * An inline component drawn `W` wide: the rows of its groups (`spec.of`'s, else `note`'s, the note it's in, and a
 * query's matches) in a figure's frame (src/graphs.ts `frame`), every backlink kind open, each row tagged by `tag`
 * (or `blocks.row`) as a link the reader opens. With `blocks` (the reader's) and a preview, the selected row (the
 * person's, else the first) is drawn beside the list or under it, as an embed of it is. `frame` is passed in
 * (graphs.ts imports this module's caller).
 */
export function renderLinkBlock(spec: LinkBlockSpec, note: string | undefined, W: number, frame: (title: string, body: string[], W: number, footer?: string, control?: string) => string[], tag?: (to: LinkTarget, text: string) => string, blocks?: LinkBlocksEnv): string[] {
  const groups = blockGroups(spec);
  const title = spec.title ?? (spec.query && spec.kind === "links" && !spec.groups ? "matches" : spec.kind);
  // Its key in the reader: its title and how many before it had that title, as a figure's.
  const count = blocks ? (blocks.drawn ??= { n: 0, titles: new Map() }) : { n: 0, titles: new Map<string, number>() };
  const n = ++count.n, same = count.titles.get(title) ?? 0;
  count.titles.set(title, same + 1);
  const key = `links:${title}#${same}`;
  if (spec.problem) return frame(title, [fg(C.lred) + spec.problem + RESET], W);
  const own = groups.some(g => g !== "matches");
  const of = spec.of ?? note;
  if (own && (!of || of.startsWith(RESOURCE_NOTE) || of.startsWith("file:"))) return frame(title, [fg(C.dark) + "a resource or a file has no links here · of: ((block)) names whose" + RESET], W);
  const has = (g: LinkGroupName) => groups.includes(g);
  if (!source) return frame(title, [fg(C.dark) + "no outline connection" + RESET], W);
  const links = has("outlinks") || has("resources") || has("backlinks") ? linksOf(of!)! : { links: { kind: "loading" }, backlinks: { kind: "loading" } } as LinkData;
  const children = has("children") ? childLinks(source, of!) : undefined;
  // `this` in the query is the note the component sits in (`links:this NOT linkedfrom:this`).
  const matches = spec.query ? questionRows(source, { where: spec.query, ...(note ? { this: note } : {}) }, 200) : undefined;
  const data: LinkData = { ...links, ...(children ? { children } : {}), ...(matches ? { matches } : {}) };
  const ui = blocks?.ui?.(key), typing = ui?.typing ?? null, entered = !!ui?.entered;
  const filter = [spec.filter, typing ?? ""].filter(Boolean).join(" ");
  const kinds = data.backlinks.kind === "ready" ? new Set(backlinkView(data.backlinks.value, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds.map(k => k.kind)) : new Set<string>();
  const rows = linkRows(data, { shut: new Set(), kinds, backlinks: { ...DEFAULT_BACKLINK_VIEW_OPTIONS, filter }, only: new Set(groups) });
  // One group alone: its header is the frame's title, so its entries stand one level up.
  const alone = groups.length === 1;
  const shown = alone ? rows.filter(r => r.kind !== "group") : rows;
  const entries = shown.filter(isLinkEntry);
  // The selection: the person's row while it's still listed, else the first (only where it shows: a preview, or in it).
  const previewing = spec.preview !== "none" && !!blocks?.preview;
  const sel = entries.find(r => r.key === ui?.sel)?.key ?? (previewing || entered ? entries[0]?.key ?? null : null);
  const selRow = entries.find(r => r.key === sel);
  const inner = Math.max(10, W - 4);
  const beside = previewing && spec.preview === "right" && W >= PREVIEW_MIN_WIDTH;
  const lw = beside ? Math.max(20, Math.floor(inner * 0.42)) : inner, pw = beside ? inner - lw - 3 : inner;
  const list = shown.map(r => {
    const to = linkTargetOf(r);
    const tagRow = to && blocks?.row ? (t: string) => blocks.row!(key, r.key, to, t) : to && tag ? (t: string) => tag(to, t) : undefined;
    return linkRowLine(alone ? { ...r, depth: Math.max(0, r.depth - 1) } : r, { cols: lw, selected: r.key === sel && (previewing || entered), focused: entered, ...(tagRow ? { tag: tagRow } : {}) });
  });
  const head = rows.find(r => r.kind === "group");
  if (!list.length) list.push(fg(C.dark) + (head?.kind === "group" && head.note ? head.note : filter ? `nothing matches ${filter}` : "nothing here yet") + RESET);
  if (typing !== null) list.unshift(fg(C.yellow) + pad(`/ ${typing}▌`, lw) + RESET);
  // The preview: the selected row's note, drawn as an embed of it (the reader's own renderer, its links its elements).
  const previewId = selRow ? linkBlock(selRow) : null;
  let pv: string[] = [];
  if (previewing && selRow) {
    if (!previewId) pv = [fg(C.dark) + "a Resource: ⏎ opens it" + RESET];
    else {
      const all = blocks!.preview!(previewId, pw);
      pv = all.length > PREVIEW_ROWS ? [...all.slice(0, PREVIEW_ROWS - 1), fg(C.dark) + `… ${all.length - PREVIEW_ROWS + 1} more rows · ⏎ opens it` + RESET] : all;
    }
  }
  const body = beside
    ? Array.from({ length: Math.max(list.length, pv.length) }, (_, i) => pad(list[i] ?? "", lw) + fg(C.dark) + " │ " + RESET + (pv[i] ?? ""))
    : [...list, ...(pv.length ? [fg(C.dark) + "─".repeat(Math.min(inner, 40)) + RESET, ...pv] : [])];
  const counted = entries.length;
  const loading = [data.links, data.backlinks, data.children, data.matches].some((l, i) => l?.kind === "loading" && (i > 1 || own));
  const what = spec.query ? `${counted} match${counted === 1 ? "" : "es"}` : `${counted} link${counted === 1 ? "" : "s"}`;
  const word = entered ? "esc out" : "⏎ in";
  const control = blocks?.control ? blocks.control(key, word) : "";
  blocks?.seen?.({
    key, n, title, rows: entries.map(r => ({ key: r.key, id: linkBlock(r), text: linkWords(r).text, kind: r.kind })),
    sel: sel ?? null, preview: previewing && previewId ? previewId : null, previews: previewing, entered, typing, query: spec.query, groups,
  });
  return frame(title, body, W, `${loading ? "asking… · " : ""}live · ${what}${filter ? ` · ${filter}` : ""}${spec.of ? ` · of ${of!.slice(0, 8)}` : ""}`, control);
}

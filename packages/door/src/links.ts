// One links model: a block's Outlinks, Resources and Backlinks, as the outliner's Tree shows them under a block
// (PIE-259, PIE-324, PIE-329) and Detail groups its backlinks (PIE-442). Three places draw it, from this one
// model and this one row renderer:
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
  RESOURCE_NOTE, type AuthoredLinksSnapshot, type AuthoredOutlink, type AuthoredResourceLink,
} from "./authored";
import {
  backlinkRows, backlinkRowSuffix, backlinkStageSummary, backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, fitBacklinkRow,
  type BacklinkCollection, type BacklinkSource, type BacklinkViewGroup, type BacklinkViewOptions,
} from "./backlinks";
import type { Msg } from "./board";
import { COMPONENT_OPEN, componentBlocks, type ComponentBlock } from "@ep0ch/outline-core/component-block";
import { matchesSearchText, prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import { USER, type Actor, type SocketBoard } from "./socket";
import type { LinkTarget } from "./refs";
import { ActionRefused } from "./surface/actions";
import { C, ellipsize, fg, pad, RESET, selected as lit, width } from "./style";

// ── the model ────────────────────────────────────────────────────────────────────────────────────────

export type LinkGroupName = "outlinks" | "resources" | "backlinks";
/** The Tree's groups in its order, each with the glyph the door draws. */
export const LINK_GROUPS: readonly { group: LinkGroupName; glyph: string }[] = [
  { group: "outlinks", glyph: "→" }, { group: "resources", glyph: "♦" }, { group: "backlinks", glyph: "←" },
];
export const isLinkGroup = (s: string): s is LinkGroupName => LINK_GROUPS.some(g => g.group === s);

export type Load<T> = { kind: "loading" } | { kind: "ready"; value: T } | { kind: "error"; message: string };
/** What the service sent for one block: its authored links and its backlinks, each as it came (or why not). */
export interface LinkData { links: Load<AuthoredLinksSnapshot>; backlinks: Load<BacklinkCollection> }

/** One row of a block's links: a group's header, a backlink kind's header, or a link. `key` is stable across reads. */
export type LinkRow =
  | { kind: "group"; key: string; depth: number; group: LinkGroupName; open: boolean; count: number | null; note: string }
  | { kind: "kind"; key: string; depth: number; group: BacklinkViewGroup; expanded: boolean }
  | { kind: "outlink"; key: string; depth: number; link: AuthoredOutlink }
  | { kind: "resource"; key: string; depth: number; link: AuthoredResourceLink }
  | { kind: "backlink"; key: string; depth: number; source: BacklinkSource };

/** How the rows are shown: the person's folds and filters, kept by the list that draws them. */
export interface LinkView {
  /** Groups folded to their header. */
  shut: ReadonlySet<LinkGroupName>;
  /** Backlink kind groups opened (Detail's rule: folded, but their open sources show). */
  kinds: ReadonlySet<string>;
  /** Detail's backlink options: filter, kind, stage, resolved, related, sort. */
  backlinks: Readonly<BacklinkViewOptions>;
  /** Only these groups (the inline `::resources`); every group otherwise. */
  only?: ReadonlySet<LinkGroupName>;
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
    if (group === "backlinks") {
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
          for (const e of g.entries) {
            const row: LinkRow = e.kind === "outlink"
              ? { kind: "outlink", key: key + SEP + e.key, depth: depth + 1, link: e }
              : { kind: "resource", key: key + SEP + e.key, depth: depth + 1, link: e as AuthoredResourceLink };
            const w = linkWords(row);
            if (matchesSearchText(filter, [w.text, w.context])) entries.push(row);
          }
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

/** The block a row stands for: a resolved outlink's target, a backlink's source (a ticket's block is `linkOpens`'). */
export function linkBlock(r: LinkRow | { kind: string } | undefined): string | null {
  if (!r) return null;
  const x = r as LinkRow;
  if (x.kind === "outlink") return x.link.resolution.kind === "ready" ? x.link.resolution.target.blockId : null;
  if (x.kind === "backlink") return x.source.blockId;
  return null;
}

/** Whether ⏎ on a row opens something (a note, a ticket, a Resource) rather than folding a group. */
export const isLinkEntry = (r: LinkRow | undefined): r is Extract<LinkRow, { kind: "outlink" | "resource" | "backlink" }> =>
  !!r && (r.kind === "outlink" || r.kind === "resource" || r.kind === "backlink");

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
 * Refused, with the reason, for a row that leads nowhere.
 */
export async function linkNote(r: LinkRow, board: LinkBoard, how: "show" | "open", actor: Actor = USER): Promise<{ note: Msg; registered?: boolean; ticket?: string }> {
  if (r.kind === "group" || r.kind === "kind") throw new ActionRefused("a group's header stands for no note: ⏎ folds it");
  if (r.kind === "backlink") {
    const m = await board.get(r.source.blockId);
    if (!m) throw new ActionRefused("that source isn't in the outline any more");
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
    return { note: resourceNote(await board.describeResource(to.resourceId, false)) };
  }
  return openResource(board, to, actor).catch((e: Error) => { throw new ActionRefused(`couldn't show ${r.link.label}: ${e.message}`); });
}

/** A row's place as a link a reader's elements open (the inline component's rows), or null for a header. */
export function linkTargetOf(r: LinkRow): LinkTarget | null {
  if (r.kind === "backlink") return { block: r.source.blockId, role: "row" };
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
export async function readLinks(board: Pick<SocketBoard, "authoredLinks" | "backlinks">, id: string) {
  const ask = <T>(p: Promise<T>): Promise<Load<T>> => p.then(value => ({ kind: "ready" as const, value }), (e: Error) => ({ kind: "error" as const, message: `couldn't ask: ${e.message}` }));
  const [links, backlinks] = await Promise.all([ask(board.authoredLinks(id)), ask(board.backlinks(id))]);
  const kinds = backlinks.kind === "ready" ? new Set(backlinkView(backlinks.value, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds.map(k => k.kind)) : new Set<string>();
  return { rows: linkRows({ links, backlinks }, { shut: new Set(), kinds, backlinks: DEFAULT_BACKLINK_VIEW_OPTIONS }).map((r, i) => describeLinkRow(r, i + 1, false)) };
}

// ── the inline component: `::links`, `::resources`, `::backlinks` ────────────────────────────────────

/** The inline component's names: every group, or one. */
export const LINK_BLOCK_KINDS = ["links", "outlinks", "resources", "backlinks"] as const;
export type LinkBlockKind = (typeof LINK_BLOCK_KINDS)[number];

/** What an inline component asks: whose links (default the note it's in), which groups, a filter, a title. */
export interface LinkBlockSpec { kind: LinkBlockKind; of: string | null; filter: string; title: string | null; problem?: string }


/**
 * The inline component starting at line `i`, or null. Where it ends (`end`, inclusive) is outline-core's
 * component-block rule (`blocks`: the lines' componentBlocks by first line, when the caller has them). Two forms:
 *
 *     ::resources jira                 one line: the words after the name filter the rows; `::links` alone,
 *                                        unclosed, is every link
 *
 *     ::links                          a block to its `::`: each line inside is `of:` (whose links),
 *     of: ((id))                         `filter:`, `title:` or `groups:`, or else the filter's words; `---`
 *     filter: offer                      lines (Comark's YAML fence) are skipped
 *     ::
 */
export function linkBlockAt(lines: readonly string[], i: number, blocks: ReadonlyMap<number, ComponentBlock> = new Map(componentBlocks(lines).map(c => [c.start, c]))): { spec: LinkBlockSpec; end: number } | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  const block = blocks.get(i) ?? (open && !open[2] ? { name: open[1]!, args: null, start: i, end: i } : null);
  if (!block || !(LINK_BLOCK_KINDS as readonly string[]).includes(block.name)) return null;
  const rest = (block.args ?? "").trim(), end = block.end;
  const spec: LinkBlockSpec = { kind: block.name as LinkBlockKind, of: null, filter: "", title: null };
  const idOf = (s: string) => referencedBlock(s)?.blockId ?? null;
  const words: string[] = [];
  // Its arguments: `::links ((id))` names whose; anything else is the filter.
  if (rest) { const id = idOf(rest); if (id) spec.of = id; else words.push(rest); }
  for (const line of lines.slice(i + 1, end)) {
    if (/^\s*---\s*$/.test(line)) continue;
    const kv = /^\s*(of|filter|title|groups)\s*:\s*(.*?)\s*$/.exec(line);
    if (!kv) { words.push(line.trim()); continue; }
    const v = kv[2]!.replace(/^["']|["']$/g, "");
    if (kv[1] === "of") { spec.of = idOf(v); if (!spec.of) spec.problem = `of: needs a ((block)) or a block id, not ${v}`; }
    else if (kv[1] === "filter") words.push(v);
    else if (kv[1] === "title") spec.title = v;
    else if (kv[1] === "groups") { const g = v.trim().toLowerCase(); if ((LINK_BLOCK_KINDS as readonly string[]).includes(g)) spec.kind = g as LinkBlockKind; else spec.problem = `groups: is links, outlinks, resources or backlinks, not ${v}`; }
  }
  spec.filter = words.filter(Boolean).join(" ");
  return { spec, end };
}

// What the service answered for a block, kept while the outline doesn't change (asked again after it does), so a
// redraw never asks. One per door: the inline components of every reader share it.
type LinksBoard = Pick<SocketBoard, "authoredLinks" | "backlinks">;
let source: LinksBoard | null = null;
let redraw: () => void = () => {};
/** Also told when an answer arrives (besides the connection's own redraw), until the returned function is called. */
const listeners = new Set<() => void>();
export function listenLinks(fn: () => void): () => void { listeners.add(fn); return () => listeners.delete(fn); }
const changed = () => { redraw(); for (const fn of listeners) fn(); };
let generation = 0;
const cache = new Map<string, { data: LinkData; at: number }>();

/** The door's outline connection and its repaint, for the inline components. */
export function setLinksSource(b: LinksBoard | null, repaint: () => void) {
  // A new generation: an answer still on its way from the outline before is never kept as this one's.
  source = b; redraw = repaint; cache.clear(); generation++;
}
/** The connection and its repaint now, to put back after borrowing it (drawNote). */
export const linksSource = (): { board: LinksBoard | null; redraw: () => void } => ({ board: source, redraw });
let settling: Timer | null = null;
/**
 * The outline changed: every component asks again on its next draw, once the burst settles (500 ms, as the links
 * tile waits), so a run of changes asks once; what it showed stays meanwhile.
 */
export function invalidateLinks() {
  if (settling) return;
  settling = setTimeout(() => { settling = null; generation++; changed(); }, 500);
}

/** Block `id`'s links as last answered, asked for in the background when there's no answer or it's stale. */
export function linksOf(id: string): LinkData | null {
  if (!source) return null;
  const hit = cache.get(id);
  if (hit && hit.at === generation) return hit.data;
  const at = generation, b = source;
  const data: LinkData = hit ? { ...hit.data } : { links: { kind: "loading" }, backlinks: { kind: "loading" } };
  cache.set(id, { data, at });
  if (cache.size > 200) cache.delete(cache.keys().next().value!);
  const why = (e: unknown) => `couldn't ask: ${e instanceof Error ? e.message : String(e)}`;
  const put = (k: keyof LinkData, v: LinkData[keyof LinkData]) => { const e = cache.get(id); if (e && e.at === at) { e.data = { ...e.data, [k]: v }; changed(); } };
  b.authoredLinks(id).then(v => put("links", { kind: "ready", value: v }), e => put("links", { kind: "error", message: why(e) }));
  b.backlinks(id).then(v => put("backlinks", { kind: "ready", value: v }), e => put("backlinks", { kind: "error", message: why(e) }));
  return data;
}

/**
 * An inline component drawn `W` wide: the rows of `spec.of` (else `note`, the note it's in) in a figure's frame
 * (src/graphs.ts `frame`), every backlink kind open, each row tagged by `tag` as a link the reader opens. `frame`
 * is passed in (graphs.ts imports this module's caller).
 */
export function renderLinkBlock(spec: LinkBlockSpec, note: string | undefined, W: number, frame: (title: string, body: string[], W: number, footer?: string) => string[], tag?: (to: LinkTarget, text: string) => string): string[] {
  const title = spec.title ?? spec.kind;
  if (spec.problem) return frame(title, [fg(C.lred) + spec.problem + RESET], W);
  const of = spec.of ?? note;
  if (!of || of.startsWith(RESOURCE_NOTE) || of.startsWith("file:")) return frame(title, [fg(C.dark) + "a resource or a file has no links here · of: ((block)) names whose" + RESET], W);
  const data = linksOf(of);
  if (!data) return frame(title, [fg(C.dark) + "no outline connection" + RESET], W);
  const only = spec.kind === "links" ? undefined : new Set<LinkGroupName>([spec.kind]);
  const kinds = data.backlinks.kind === "ready" ? new Set(backlinkView(data.backlinks.value, DEFAULT_BACKLINK_VIEW_OPTIONS).kinds.map(k => k.kind)) : new Set<string>();
  const rows = linkRows(data, { shut: new Set(), kinds, backlinks: { ...DEFAULT_BACKLINK_VIEW_OPTIONS, filter: spec.filter }, ...(only ? { only } : {}) });
  // One group alone: its header is the frame's title, so its entries stand one level up.
  const alone = !!only, inner = Math.max(10, W - 4);
  const shown = alone ? rows.filter(r => r.kind !== "group") : rows;
  const body = shown.map(r => {
    const to = tag ? linkTargetOf(r) : null;
    return linkRowLine(alone ? { ...r, depth: Math.max(0, r.depth - 1) } : r, { cols: inner, ...(to && tag ? { tag: (t: string) => tag(to, t) } : {}) });
  });
  const head = rows.find(r => r.kind === "group");
  if (!body.length) body.push(fg(C.dark) + (head?.kind === "group" && head.note ? head.note : spec.filter ? `nothing matches ${spec.filter}` : "nothing here yet") + RESET);
  const counted = rows.filter(isLinkEntry).length;
  const loading = data.links.kind === "loading" || data.backlinks.kind === "loading";
  return frame(title, body, W, `${loading ? "asking… · " : ""}live · ${counted} link${counted === 1 ? "" : "s"}${spec.filter ? ` · ${spec.filter}` : ""}${spec.of ? ` · of ${of.slice(0, 8)}` : ""}`);
}

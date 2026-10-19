// The inline links components a note can hold (`::links`, `::outlinks`, `::resources`, `::backlinks`): what each
// asks, read from its block. Every client that draws one (the door's reader, the publisher's pages) reads it here and
// asks the service for the answer (`blocks.authored-links`, `references.backlinks`, `blocks.query`). Pure: no I/O.

import { COMPONENT_OPEN, componentAttrs, componentBlocks, type ComponentBlock } from "./component-block";
import { referencedBlock } from "./link-syntax";

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

/** The inline component's names: every group, or one. */
export const LINK_BLOCK_KINDS = ["links", "outlinks", "resources", "backlinks"] as const;
export type LinkBlockKind = (typeof LINK_BLOCK_KINDS)[number];
/** Where an inline component draws its selected row (PIE-693): beside the list, under it, or not at all. */
export type LinkPreview = "right" | "below" | "none";
const PREVIEWS: readonly LinkPreview[] = ["right", "below", "none"];

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
  /**
   * The stage values its group headers and Stage name, in order (`stages: [next, doing, waiting]`, PIE-819), or null
   * for every value its rows carry. Rows with another value stay listed, said as "other".
   */
  stages: string[] | null;
  lines?: number;
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
  const spec: LinkBlockSpec = { kind: block.name as LinkBlockKind, of: null, filter: "", title: null, groups: null, query: null, preview: "none", stages: null };
  const idOf = (s: string) => referencedBlock(s)?.blockId ?? null;
  const words: string[] = [];
  let preview: string | null = null;
  const set = (k: string, v: string) => {
    if (k === "of") { spec.of = idOf(v); if (!spec.of) spec.problem = `of: needs a ((block)) or a block id, not ${v}`; }
    else if (k === "lines") {
      if (/^\d+$/.test(v) && Number.isSafeInteger(Number(v))) spec.lines = Number(v);
      else spec.problem = `lines: needs a non-negative whole number, not ${v}`;
    }
    else if (k === "filter") words.push(v);
    else if (k === "title") spec.title = v;
    else if (k === "query") spec.query = v.trim() || null;
    else if (k === "preview") preview = v.trim().toLowerCase();
    else if (k === "groups") { const g = groupsFrom(v); if (typeof g === "string") spec.problem = g; else spec.groups = g; }
    else if (k === "stages") { const l = v.replace(/^\s*\[|\]\s*$/g, "").split(",").map((x) => x.trim()).filter(Boolean); spec.stages = l.length ? l : null; }
    else return false;
    return true;
  };
  // Its attributes, in braces on the first line.
  for (const a of componentAttrs(block.attrs ?? "").pairs) if (!set(a.key.toLowerCase(), a.value)) spec.problem = `${a.key} isn't one of ::${block.name}'s keys (of, filter, title, groups, query, preview, stages, lines)`;
  // Its arguments: `::links ((id))` names whose; anything else is the filter.
  if (rest) { const id = idOf(rest); if (id) spec.of = id; else words.push(rest); }
  for (const line of lines.slice(i + 1, end)) {
    if (/^\s*---\s*$/.test(line)) continue;
    const kv = /^\s*(of|filter|title|groups|query|preview|stages|lines)\s*:\s*(.*?)\s*$/.exec(line);
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


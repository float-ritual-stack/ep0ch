// The built-in components that read their Site rather than the outline at large (PIE-533 S3): `::fields` lists the
// occurrences of a key in a note, `::if` draws its body only when the note matches a query. Both are read here, once,
// for every client that draws a note (the door's reader, the publisher's pages); the service answers them through
// `site.answer` (`produce`), and each client draws that answer. Pure: no I/O.
//
//     ::fields{key=connectTo}                one row per occurrence of the key in this note, each opening its line
//     ::fields{key=connectTo of=((id))}      the same for another note
//     ::fields connectTo                     the key as its argument
//
//     ::if{where="status=active"}            the lines to its `::` are drawn only when `this` matches the query
//     … body …                               (the views' query atoms; `{{this.key}}` operands are bound, never pasted)
//     ::
import { COMPONENT_OPEN, componentAttrs, componentBlocks, noteCodeFences, type ComponentBlock } from "./component-block";
import { referencedBlock } from "./link-syntax";

const fieldsOf = (value: string) => value === "parent" ? value : (referencedBlock(value) ?? referencedBlock(`((${value}))`))?.blockId ?? null;

/** The names this module reads. */
export const SITE_BLOCK_NAMES = ["fields", "if"] as const;

/** What a `::fields` asks: which key, in whose note, and its title. */
export interface FieldsSpec { key: string; of: string | null; title: string | null; problem?: string }
/** What an `::if` asks: the query `this` must match. */
export interface IfSpec { where: string; problem?: string }

export type SiteBlock =
  | { kind: "fields"; spec: FieldsSpec; start: number; end: number }
  /** `end` is the closing `::` line; the body is the lines between (`start + 1` to `end - 1`). */
  | { kind: "if"; spec: IfSpec; start: number; end: number };

/**
 * The `::fields` or `::if` starting at line `i`, or null. `::fields` may stand alone on its line (like `::links{…}`) or
 * be closed by `::`; `::if` is closed by `::` (an unclosed one is plain text, as every component is). `blocks`: the
 * lines' componentBlocks by first line, when the caller has them.
 */
export function siteBlockAt(lines: readonly string[], i: number, blocks: ReadonlyMap<number, ComponentBlock> = new Map(componentBlocks(lines).map(c => [c.start, c]))): SiteBlock | null {
  const open = COMPONENT_OPEN.exec((lines[i] ?? "").replace(/\r$/, ""));
  if (!open || !(SITE_BLOCK_NAMES as readonly string[]).includes(open[1]!)) return null;
  const found = blocks.get(i);
  const attrs = open[3] ? open[3].slice(1, -1) : "";
  const pairs = componentAttrs(attrs).pairs;
  const arg = (k: string) => pairs.find(p => p.key.toLowerCase() === k)?.value;
  if (open[1] === "fields") {
    const known = ["key", "of", "title"];
    const spec: FieldsSpec = { key: "", of: null, title: null };
    for (const p of pairs) {
      const k = p.key.toLowerCase();
      if (k === "key") spec.key = p.value.trim();
      else if (k === "of") { spec.of = fieldsOf(p.value); if (!spec.of) spec.problem = `of: needs parent, a ((block)) or a block id, not ${p.value}`; }
      else if (k === "title") spec.title = p.value;
      else spec.problem = `${p.key} isn't one of ::fields' keys (${known.join(", ")})`;
    }
    // The key may be the argument (`::fields connectTo`) or a `key:` line in a block.
    const rest = open[2]?.trim();
    if (rest && !spec.key) spec.key = rest;
    const end = found ? found.end : i;
    if (found) for (const line of lines.slice(i + 1, end)) {
      const kv = /^\s*(key|of|title)\s*:\s*(.*?)\s*$/.exec(line);
      if (!kv) continue;
      const v = kv[2]!.replace(/^["']|["']$/g, "");
      if (kv[1] === "key") spec.key = v;
      else if (kv[1] === "title") spec.title = v;
      else { spec.of = fieldsOf(v); if (!spec.of) spec.problem = `of: needs parent, a ((block)) or a block id, not ${v}`; }
    }
    if (!spec.key && !spec.problem) spec.problem = "::fields needs a key: ::fields{key=connectTo}";
    // A one-line opener with arguments belongs to no block; without them it is its own line.
    return { kind: "fields", spec, start: i, end };
  }
  // ::if needs its closing line.
  if (!found || found.end <= i) return null;
  const where = arg("where") ?? arg("query");
  const spec: IfSpec = { where: where?.trim() ?? "" };
  if (!spec.where) spec.problem = "::if needs a query: ::if{where=\"status=active\"}";
  else for (const p of pairs) if (!["where", "query"].includes(p.key.toLowerCase())) spec.problem = `${p.key} isn't one of ::if's keys (where)`;
  return { kind: "if", spec, start: i, end: found.end };
}

/** Every `::fields` a note's text holds, in order (outside code fences): what a client checks a drawn component against before acting on it. */
export function fieldsBlocksOf(text: string): FieldsSpec[] {
  const lines = text.split("\n");
  const blocks = new Map(componentBlocks(lines).map(c => [c.start, c]));
  const fences = new Set<number>();
  for (const f of noteCodeFences(lines)) for (let j = f.start; j <= f.end; j++) fences.add(j);
  const out: FieldsSpec[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (fences.has(i)) continue;
    const found = siteBlockAt(lines, i, blocks);
    if (found?.kind === "fields") { out.push(found.spec); i = found.end; }
    else if (found) i = found.end;
  }
  return out;
}

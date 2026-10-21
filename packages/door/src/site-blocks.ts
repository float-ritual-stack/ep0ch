// `::fields` and `::if` in the reader (PIE-533 S3): the components that read their note's Site. The service answers
// both through `site.answer` (the watched `produce` read, src/live.ts); this module only draws the answer. `::fields`
// is a frame of rows, one per occurrence of a key, each a link that opens its own line lit (a reader finds it by the
// text it was written as, so it still works after edits above it) and a `¶` that anchors the line when asked: a render
// never writes. `::if` draws its body only while `this` matches.
import type { FieldRow, SiteProduced } from "@ep0ch/outline-core/site";
import type { FieldsSpec } from "@ep0ch/outline-core/site-blocks";
import { frame } from "./graphs";
import { siteProduced, type LiveSite } from "./live";
import type { LinkTarget } from "./refs";
import { C, drawEllipsized, fg, RESET } from "./style";

import { rowLines } from "./text";

/** One `::fields` as the reader last drew it: the note it read, that note's revision, and its rows. */
export interface DrawnFields { from: string; revision: number; key: string; of: string | null; rows: FieldRow[] }

/** The fields in one reader layout; discarded when that reader draws its next layout. */
export type FieldsDrawing = Map<string, DrawnFields>;

/** The fields currently drawn for `key` (or the only component), or why the choice is ambiguous. */
export function fieldsDrawn(drawn: FieldsDrawing, key?: string): { found: DrawnFields } | { problem: string } {
  const all = [...drawn.values()];
  if (!all.length) return { problem: "this note draws no ::fields" };
  const named = key === undefined ? all : all.filter(d => d.key.toLowerCase() === key.toLowerCase());
  if (!named.length) return { problem: `this note draws no ::fields{key=${key}} (it draws ${all.map(d => d.key).join(", ")})` };
  if (named.length > 1) return { problem: `this note draws ${named.length} ::fields${key === undefined ? `: say key= (${named.map(d => d.key).join(", ")})` : ` for ${key}: ${named.map(d => `of ${d.of ?? "this note"}`).join(", ")}`}` };
  return { found: named[0]! };
}

const problemLines = (message: string, didYouMean: readonly string[]) =>
  [fg(C.lred) + message + RESET, ...(didYouMean.length ? [fg(C.dark) + `did you mean ${didYouMean.join(", ")}?` + RESET] : [])];

/**
 * A `::fields` drawn `W` wide. `tag`: how the reader makes a row an element it can step to and open (without one the rows are text).
 */
export function renderFields(spec: FieldsSpec, note: string | undefined, W: number, tag?: (to: LinkTarget, text: string) => string, site?: LiveSite, drawn?: FieldsDrawing, answer?: Extract<SiteProduced, { kind: "fields" }>): string[] {
  const title = spec.title ?? spec.key ?? "fields";
  if (spec.problem) return frame(title, [fg(C.lred) + spec.problem + RESET], W);
  if (!note && !answer) return frame(title, [fg(C.dark) + "a note's fields: this one is drawn outside a note" + RESET], W);
  const read = answer ? { state: "ready", value: answer } as const : siteProduced(note, { kind: "fields", key: spec.key, ...(spec.of ? { of: spec.of } : {}) }, site);
  if (!read) return frame(title, [fg(C.dark) + "no outline connection" + RESET], W);
  if (read.state === "loading") return frame(title, [fg(C.dark) + "asking the outline…" + RESET], W, "live");
  if (read.state === "error" && !read.value) return frame(title, [fg(C.lred) + read.error + RESET], W, "live");
  const a = read.value as Extract<SiteProduced, { kind: "fields" }>;
  if (a.problem) return frame(title, problemLines(a.problem.message, a.problem.didYouMean), W, "live");
  drawn?.set(`${note}\0${spec.key.toLowerCase()}\0${spec.of ?? ""}`, { from: a.from, revision: a.revision, key: spec.key, of: spec.of, rows: a.rows });
  const inner = Math.max(10, W - 4);
  const body = a.rows.flatMap((row, n) => {
    const words = row.link ? row.link.title : row.value;
    const to: LinkTarget = { block: a.from, role: "row", ...(row.offset !== undefined ? { at: row.offset, ...(row.token ? { atLabel: row.token } : {}), atSays: "the line it was written on" } : {}) };
    const anchor: LinkTarget = { block: a.from, role: "row", anchor: { key: spec.key, n: n + 1 } };
    const text = (tag ? tag(to, words) : words);
    const control = tag ? tag(anchor, "¶") : "¶";
    return rowLines(fg(C.white) + "∙ " + RESET + text + fg(C.dark) + ` · line ${row.line + 1} ` + RESET + control, inner);
  });
  if (!body.length) {
    body.push(fg(C.dark) + `no ${spec.key} written in ${spec.of ? "that note" : "this note"}'s lines yet` + RESET);
    // A #hashtag is the property `tag` (outline-core's property grammar), so the plural a person types finds none.
    if (/^(tags|hashtags?)$/i.test(spec.key)) body.push(fg(C.dark) + "a #hashtag is the key tag: try ::fields{key=tag}" + RESET);
  }
  return frame(title, body, W, `live · ${a.rows.length} occurrence${a.rows.length === 1 ? "" : "s"}`);
}

/**
 * Whether an `::if` draws its body: `holds` once the service has answered that `this` matches; `problem` (its message)
 * when the query can't be read, the body staying hidden; `hidden` while it asks or when it doesn't match. Outside a note
 * (the component library's example) there is nothing to match, so the body is drawn, showing what it holds.
 */
export function ifState(where: string, note: string | undefined, site?: LiveSite): { state: "holds" | "hidden" } | { state: "problem"; message: string; didYouMean: string[] } {
  if (!note) return { state: "holds" };
  const read = siteProduced(note, { kind: "if", where }, site);
  // A failed read is said where the body would be, and the last answer is not left standing as if it were current.
  if (read?.state === "error") return { state: "problem", message: read.error, didYouMean: [] };
  const a = read?.value as Extract<SiteProduced, { kind: "if" }> | undefined;
  if (!a) return { state: "hidden" };
  if (a.problem) return { state: "problem", message: a.problem.message, didYouMean: a.problem.didYouMean };
  return { state: a.holds ? "holds" : "hidden" };
}

/** An `::if` whose query can't be read, said where its body would be (the body stays hidden). */
export const ifProblemLines = (message: string, W: number): string[] => frame("if", [fg(C.lred) + drawEllipsized(message, Math.max(10, W - 4)) + RESET], W);

// `::fields` and `::if` in the reader (PIE-533 S3): the components that read their note's Site. The service answers
// both through `site.answer` (the watched `produce` read, src/live.ts); this module only draws the answer. `::fields`
// is a frame of rows, one per occurrence of a key, each a link that opens its own line lit (a reader finds it by the
// text it was written as, so it still works after edits above it) and a `⚓` that anchors the line when asked: a render
// never writes. `::if` draws its body only while `this` matches.
import type { FieldRow, SiteProduced } from "@ep0ch/outline-core/site";
import type { FieldsSpec } from "@ep0ch/outline-core/site-blocks";
import { frame } from "./graphs";
import { siteProduced, type LiveSite } from "./live";
import type { LinkTarget } from "./refs";
import { C, ellipsize, fg, RESET } from "./style";

/** What the reader last drew for the note's `::fields` components, by note: `fields.anchor` acts on these rows, by number. */
const drawn = new Map<string, { block: number; from: string; revision: number; key: string; rows: FieldRow[] }[]>();

/** The rows of the `block`th (from 1) `::fields` the reader last drew for `note`, or null. */
export function fieldsDrawn(note: string, block = 1) {
  return drawn.get(note)?.[block - 1] ?? null;
}

const problemLines = (message: string, didYouMean: readonly string[]) =>
  [fg(C.lred) + message + RESET, ...(didYouMean.length ? [fg(C.dark) + `did you mean ${didYouMean.join(", ")}?` + RESET] : [])];

/**
 * A `::fields` drawn `W` wide. `ordinal`: it is the nth `::fields` of the note as drawn (1-based), which `fields.anchor`
 * names it by. `tag`: how the reader makes a row an element it can step to and open (without one the rows are text).
 */
export function renderFields(spec: FieldsSpec, note: string | undefined, W: number, ordinal: number, tag?: (to: LinkTarget, text: string) => string, site?: LiveSite): string[] {
  const title = spec.title ?? spec.key ?? "fields";
  if (spec.problem) return frame(title, [fg(C.lred) + spec.problem + RESET], W);
  if (!note) return frame(title, [fg(C.dark) + "a note's fields: this one is drawn outside a note" + RESET], W);
  const read = siteProduced(note, { kind: "fields", key: spec.key, ...(spec.of ? { of: spec.of } : {}) }, site);
  if (!read) return frame(title, [fg(C.dark) + "no outline connection" + RESET], W);
  if (read.state === "loading") return frame(title, [fg(C.dark) + "asking the outline…" + RESET], W, "live");
  if (read.state === "error" && !read.value) return frame(title, [fg(C.lred) + read.error + RESET], W, "live");
  const a = read.value as Extract<SiteProduced, { kind: "fields" }>;
  if (a.problem) return frame(title, problemLines(a.problem.message, a.problem.didYouMean), W, "live");
  const list = drawn.get(note) ?? [];
  list[ordinal - 1] = { block: ordinal, from: a.from, revision: a.revision, key: spec.key, rows: a.rows };
  list.length = Math.max(list.length, ordinal);
  drawn.set(note, list);
  const inner = Math.max(10, W - 4);
  const body = a.rows.map((row, n) => {
    const words = ellipsize(row.link ? row.link.title : row.value, Math.max(6, inner - 14));
    const to: LinkTarget = { block: a.from, role: "row", ...(row.offset !== undefined ? { at: row.offset, ...(row.token ? { atLabel: row.token } : {}) } : {}) };
    const anchor: LinkTarget = { block: a.from, role: "row", anchor: { block: ordinal, n: n + 1 } };
    const text = (tag ? tag(to, words) : words);
    const control = tag ? tag(anchor, "⚓") : "⚓";
    return fg(C.white) + "∙ " + RESET + text + fg(C.dark) + ` · line ${row.line + 1} ` + RESET + control;
  });
  if (!body.length) body.push(fg(C.dark) + `no ${spec.key} written in ${spec.of ? "that note" : "this note"}'s lines yet` + RESET);
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
  const a = read?.value as Extract<SiteProduced, { kind: "if" }> | undefined;
  if (!a) return { state: "hidden" };
  if (a.problem) return { state: "problem", message: a.problem.message, didYouMean: a.problem.didYouMean };
  return { state: a.holds ? "holds" : "hidden" };
}

/** An `::if` whose query can't be read, said where its body would be (the body stays hidden). */
export const ifProblemLines = (message: string, W: number): string[] => frame("if", [fg(C.lred) + ellipsize(message, Math.max(10, W - 4)) + RESET], W);

// A note's block-level tags (PIE-880): the `#tag`s written in its metadata, not in its prose. The service parser gives
// every hashtag block scope (a query's `#tag` and `tag=` match them wherever they sit); this file says which of them
// sit where a reader hides the note's metadata, so a reader can draw them as one row of tags under the byline instead
// of losing them with the properties. It sits on the property grammar and the media line, does no I/O, and is the one
// definition the door, Detail and the web pages share; a change to what it matches bumps PROTOCOL.
//
// Metadata-only lines within the first paragraph are hidden. Prose and lines after its first blank stay in place.
import { frontMatterLines } from "./header-line";
import { isMediaLine } from "./media-line";
import { isPropertyTokenLine } from "./property-grammar";

/** The part of the service's property record this file reads. */
export interface TagRecord {
  key: string;
  value: string;
  line: number;
  scope: string;
  placement: string;
  syntax: string;
}

/**
 * The line numbers (0 = subject) a reader leaves out of the body because they hold block metadata only. `tokens`: the
 * service's records of the text; while they load (null), only `[key::value]`-only lines in front matter are hidden.
 */
export function metadataLines(text: string, tokens: readonly TagRecord[] | null): Set<number> {
  const out = new Set<number>();
  const meta = tokens ? new Set(tokens.filter(t => t.scope === "block" && t.placement === "metadata-line").map(t => t.line)) : null;
  const lines = text.split("\n");
  for (const i of frontMatterLines(text)) {
    if (i > 0 && (meta ? meta.has(i) : isPropertyTokenLine(lines[i]!) && !isMediaLine(lines[i]!))) out.add(i);
  }
  return out;
}

/** A line of only tags, bulleted or dashed (`- #a - #b`, `#a #b`): what a hand-made tag row looks like. */
const TAG_ONLY_LINE = /^[ \t]*(?:[-*+][ \t]+)?#[^\s#]+(?:[ \t]+(?:-[ \t]+)?#[^\s#]+)*[ \t]*$/;

/**
 * The tags a reader draws as a row: the hashtags written on the metadata lines (the ones it hides), once each in order
 * of appearance, with the first line of the body's own tags left out when that line is only tags (it is the row
 * already). `line`: the note line the row stands for (the first metadata line holding a tag), or -1 when there is none.
 */
export function blockTags(text: string, tokens: readonly TagRecord[] | null): { tags: string[]; line: number } {
  if (!tokens || !text.includes("#")) return { tags: [], line: -1 };
  const hidden = metadataLines(text, tokens);
  const found = tokens.filter(t => t.syntax === "hashtag" && t.scope === "block" && hidden.has(t.line)).sort((a, b) => a.line - b.line);
  if (!found.length) return { tags: [], line: -1 };
  const lines = text.split("\n");
  let first = 1;
  while (first < lines.length && (hidden.has(first) || !lines[first]!.trim())) first++;
  const own = first < lines.length && TAG_ONLY_LINE.test(lines[first]!)
    ? new Set(tokens.filter(t => t.syntax === "hashtag" && t.line === first).map(t => t.value.toLowerCase())) : new Set<string>();
  const tags: string[] = [];
  for (const t of found) if (!own.has(t.value.toLowerCase()) && !tags.some(x => x.toLowerCase() === t.value.toLowerCase())) tags.push(t.value);
  return { tags, line: tags.length ? found[0]!.line : -1 };
}

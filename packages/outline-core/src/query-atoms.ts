// The relation and text atoms of the query grammar: `#tag`, `links:`, `under:`, `title~` and `text~`. This file is the
// one place that says what an atom looks like and what a malformed one is told; the service's query parser
// (outliner `block-query.ts`) calls it and evaluates the result (the reference index, the tree, the text). Every
// atom combines with AND, OR, NOT and parentheses like `key=value` does. Pure: no I/O.
//
// A change to what an atom matches bumps PROTOCOL (protocol.ts).

import { HASHTAG_VALUE_PATTERN } from "./property-grammar";

export type QueryAtom =
  | { kind: "tag"; tag: string }
  | { kind: "links"; target: string }
  | { kind: "under"; target: string }
  | { kind: "title"; text: string }
  | { kind: "text"; text: string };

/** A malformed atom: the message names the atom and shows a working example. */
export class QueryAtomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryAtomError";
  }
}

/** The atoms, for docs, `--help-query` and the skill: generated from here so nobody learns a stale grammar. */
export const QUERY_ATOM_HELP: readonly { atom: string; means: string; example: string }[] = [
  { atom: "#tag", means: "blocks carrying the tag; #jazz also matches nested tags like jazz/hands", example: "#jazz" },
  { atom: "links:<target>", means: "blocks whose text or properties link to the target (the backlink index)", example: "links:[[garden]]  links:((8f3a2c1d))  links:PIE-123" },
  { atom: "under:<target>", means: "blocks in the target's subtree, the target itself included", example: "under:[[projects]]  under:((8f3a2c1d))" },
  { atom: "title~text", means: "blocks whose title contains the text, ignoring case; quote it for spaces", example: 'title~roadmap  title~"weekly review"' },
  { atom: "text~text", means: "blocks whose whole text contains the text, ignoring case", example: 'text~"watering can"' },
];

/** A word starting `links:` or `under:`: its `[[page name]]` may hold spaces, so the tokenizer keeps it whole. */
export const QUERY_RELATION_PREFIX = /^(?:links|under):/i;

const ATOM_HEAD = /^(?:#|(?:links|under):|(?:title|text)~)/i;

/** Whether `word` is written as an atom (it may still be malformed: `parseQueryAtom` says how). */
export function isQueryAtomWord(word: string): boolean {
  return ATOM_HEAD.test(word);
}

const TAG_FULL = new RegExp(`^${HASHTAG_VALUE_PATTERN.source}$`, "u");
const LETTER = /\p{L}/u;
const WORK_ID = /^[A-Za-z][A-Za-z0-9]*-\d+$/;
const BARE_ID = /^[0-9a-f]{8,}(?:-[0-9a-f]+)*$/i;

function unquote(raw: string, atom: string, example: string): string {
  if (!raw.startsWith('"')) return raw;
  let out = "";
  for (let i = 1; i < raw.length; i += 1) {
    const c = raw[i]!;
    if (c === '"') {
      if (i !== raw.length - 1) throw new QueryAtomError(`${atom} has text after its closing quote; write it like ${example}`);
      return out;
    }
    if (c === "\\") {
      const next = raw[i + 1];
      if (next !== "\\" && next !== '"') throw new QueryAtomError(`${atom} quotes only escape \\\\ and \\"; write it like ${example}`);
      out += next;
      i += 1;
      continue;
    }
    out += c;
  }
  throw new QueryAtomError(`${atom} has an unterminated quote; write it like ${example}`);
}

function targetOf(name: "links" | "under", raw: string): string {
  const examples = name === "links"
    ? "links:[[garden]], links:((8f3a2c1d)) or links:PIE-123"
    : "under:[[projects]] or under:((8f3a2c1d))";
  if (!raw) throw new QueryAtomError(`${name}: needs a target after the colon, like ${examples}`);
  if (raw.startsWith("[[")) {
    if (!raw.endsWith("]]") || raw.length < 5) throw new QueryAtomError(`${name}:${raw} has an unclosed [[; write ${examples}`);
    const inner = raw.slice(2, -2);
    const page = inner.split("|")[0]!.trim();
    if (!page || page.includes("[") || page.includes("]")) throw new QueryAtomError(`${name}:${raw} names no page; write ${examples}`);
    return `[[${page}]]`;
  }
  if (raw.startsWith("((")) {
    if (!raw.endsWith("))") || raw.length < 5) throw new QueryAtomError(`${name}:${raw} has an unclosed ((; write ${examples}`);
    const id = raw.slice(2, -2).split("|")[0]!.trim();
    if (!id || /[()\s]/.test(id)) throw new QueryAtomError(`${name}:${raw} names no block id; write ${examples}`);
    return `((${id}))`;
  }
  if (WORK_ID.test(raw) || BARE_ID.test(raw)) return raw;
  throw new QueryAtomError(
    `${name}:${raw} is not a target: give a [[page]], a ((block id)) or a Work ID. Write ${examples}`,
  );
}

/**
 * Read one query word as an atom. Null when the word is no atom (a property clause or a range); throws
 * `QueryAtomError` for a malformed atom, naming it and giving a working example.
 */
export function parseQueryAtom(word: string): QueryAtom | null {
  if (!ATOM_HEAD.test(word)) return null;
  if (word.startsWith("#")) {
    const tag = word.slice(1);
    if (!tag) throw new QueryAtomError("# needs a tag after it, like #jazz or #garden/beds");
    if (!TAG_FULL.test(tag) || !LETTER.test(tag)) {
      throw new QueryAtomError(`${word} is not a tag: letters, digits, _ and - with / between segments, like #jazz or #garden/beds`);
    }
    return { kind: "tag", tag };
  }
  const colon = word.indexOf(":");
  if (colon > 0 && word[colon - 1] !== "~") {
    const name = word.slice(0, colon).toLowerCase() as "links" | "under";
    if (name === "links" || name === "under") return { kind: name, target: targetOf(name, word.slice(colon + 1)) };
  }
  const tilde = word.indexOf("~");
  const name = word.slice(0, tilde).toLowerCase() as "title" | "text";
  const example = `${name}~roadmap or ${name}~"two words"`;
  const raw = word.slice(tilde + 1);
  if (!raw) throw new QueryAtomError(`${name}~ needs text after the ~, like ${example}`);
  const text = unquote(raw, `${name}~`, example);
  if (!text.trim()) throw new QueryAtomError(`${name}~ needs text to look for, like ${example}`);
  return { kind: name, text };
}

/** An atom as it is written, for echoing a normalised query. */
export function showQueryAtom(atom: QueryAtom): string {
  switch (atom.kind) {
    case "tag": return `#${atom.tag}`;
    case "links": return `links:${atom.target}`;
    case "under": return `under:${atom.target}`;
    case "title":
    case "text":
      return /[\s"\\()]/.test(atom.text) || !atom.text
        ? `${atom.kind}~"${atom.text.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
        : `${atom.kind}~${atom.text}`;
  }
}

/** Whether a block carrying `values` (its `tag` properties) holds `tag`: equal, or a nested tag below it. */
export function tagMatches(values: readonly string[], tag: string): boolean {
  const want = tag.toLowerCase();
  return values.some(value => {
    const have = value.trim().toLowerCase().replace(/^#/, "");
    return have === want || have.startsWith(`${want}/`);
  });
}

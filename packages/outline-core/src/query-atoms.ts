// The relation and text atoms of the query grammar: `#tag`, `links:`, `linkedfrom:`, `under:`, `parent:`, `title~`,
// `text~`, `call:`, and the reader's `unread:` and `thread:`. A relation's target may be `this`, a role (ADR 0001): the block the question is asked for, which
// the service binds (`blocks.query`'s `this`) and refuses a question without. This file is the
// one place that says what an atom looks like and what a malformed one is told; the service's query parser
// (outliner `block-query.ts`) calls it and evaluates the result (the reference index, the tree, the text). Every
// atom combines with AND, OR, NOT and parentheses like `key=value` does. Pure: no I/O.
//
// A change to what an atom matches bumps GRAMMAR (protocol.ts).

import { CALL_PATTERN } from "./attribution";
import { HASHTAG_VALUE_PATTERN } from "./property-grammar";

export type QueryAtom =
  | { kind: "tag"; tag: string }
  | { kind: "links"; target: string }
  | { kind: "linkedfrom"; target: string }
  | { kind: "under"; target: string }
  | { kind: "parent"; target: string }
  | { kind: "title"; text: string }
  | { kind: "text"; text: string }
  | { kind: "call"; call: string }
  /** Blocks `reader` hasn't read at their current revision (PIE-708: never read, or changed since). */
  | { kind: "unread"; reader: string }
  /** Comments and replies in the threads `reader` started or wrote in. */
  | { kind: "thread"; reader: string }
  /** Blocks whose latest write was by `who`: an author (`user`, `agent`, `system`) or an actor id (PIE-867). */
  | { kind: "by"; who: string };

/** A reader's atom names who reads: `me` (the person: the door, the web client and the CLI read as them) or an agent's actor id. */
export type QueryReaderAtom = "unread" | "thread";
export const ME_READER = "me";
const READER = /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,127}$/;

/** A malformed atom: the message names the atom and shows a working example. */
/** The relation atoms: each names a target block (a page, a block id, a Work ID or `this`). */
export type QueryRelationAtom = "links" | "linkedfrom" | "under" | "parent";
const RELATIONS: readonly QueryRelationAtom[] = ["links", "linkedfrom", "under", "parent"];
export const isQueryRelationAtom = (kind: string): kind is QueryRelationAtom => (RELATIONS as readonly string[]).includes(kind);

/** The target `this` stands for the block a question is asked for (ADR 0004): a component's note, a tile's aim. */
export const THIS_TARGET = "this";

/**
 * `expression` with each relation's `this` target (`parent:this`, `links:this`) written as the block it stands for,
 * `((id))`: the same question asked from where `this` means nothing (a shell's `ep0ch find`, an MCP query).
 */
export function withThisAs(expression: string, id: string): string {
  return expression.replace(new RegExp(`\\b(${RELATIONS.join("|")}):${THIS_TARGET}\\b`, "gi"), (_, atom: string) => `${atom}:((${id}))`);
}

export class QueryAtomError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QueryAtomError";
  }
}

/** The atoms, for docs, `--help-query` and the skill: generated from here so nobody learns a stale grammar. */
export const QUERY_ATOM_HELP: readonly { atom: string; means: string; example: string; gist: string }[] = [
  { atom: "#tag", gist: "blocks carrying the tag", means: "blocks carrying the tag; #jazz also matches nested tags like jazz/hands", example: "#jazz" },
  { atom: "links:<target>", gist: "blocks that link to the target", means: "blocks whose text or properties link to the target (the backlink index)", example: "links:[[garden]]  links:((8f3a2c1d))  links:PIE-123  links:this" },
  { atom: "linkedfrom:<target>", gist: "blocks the target links to", means: "blocks the target links to (its outlinks that are blocks): the counterpart of links:", example: "linkedfrom:[[garden]]  links:this NOT linkedfrom:this" },
  { atom: "under:<target>", gist: "the target and everything under it", means: "blocks in the target's subtree, the target itself included", example: "under:[[projects]]  under:((8f3a2c1d))" },
  { atom: "parent:<target>", gist: "the target's direct children", means: "the target's direct children (under: is the whole subtree)", example: "parent:[[projects]]  parent:this" },
  { atom: "this", gist: "the note the question is asked for", means: "as a target, the block the question is asked for: the note a component sits in, the note a tile is aimed at", example: "links:this  parent:this" },
  { atom: "title~text", gist: "title contains the text", means: "blocks whose title contains the text, ignoring case; quote it for spaces", example: 'title~roadmap  title~"weekly review"' },
  { atom: "call:<id>", gist: "changed by that MCP call", means: "blocks whose latest change (else their creation) came from that call (an MCP caller's visit; the id list_outlines tells a caller, recorded with every write it makes; the MCP server also takes its readable handle and swaps in the id)", example: "call:c-7f3a1c" },
  { atom: "text~text", gist: "text contains the text", means: "blocks whose whole text contains the text, ignoring case", example: 'text~"watering can"' },
  { atom: "child:<clause>", gist: "a direct child has the property", means: "blocks with a direct child that matches the clause; child>=2: wants at least two such children", example: "child:type=virtual-branch  child>=2:status=open" },
  { atom: "{{this.key}}", gist: "this note's own value for key", means: "as a value, what the note the question is asked for has for key; {{this.page}} is its page address (a daily note's date): one line serves every note", example: "owner={{this.owner}}  when={{this.page}}" },
  { atom: "unread:<reader>", gist: "blocks the reader hasn't read", means: "blocks the reader hasn't read at their current revision (never opened, or changed since); me is the person, and an agent names its own actor id", example: "unread:me  type=annotation-reply unread:me" },
  { atom: "by:<who>", gist: "last written by user, agent or an actor id", means: "blocks whose latest write was by who: an author (user, agent, system) or an actor id (claude-code@float-2, loki, ext:jira); with revision >= 2 and NOT machine, what people wrote", example: "by:user  by:agent NOT machine  by:loki updated >= today  revision >= 2" },
  { atom: "thread:<reader>", gist: "comments in the reader's threads", means: "comments and replies in the threads the reader started or wrote in; me is the person, an agent names its actor id", example: "type=annotation-reply thread:me NOT annotation-source=user" },
];

/** `AND`, `OR`, `NOT` and the group: how clauses combine, described here so completion reads them from the grammar's table. */
export const QUERY_CONNECTIVE_HELP: readonly { word: string; means: string }[] = [
  { word: "AND", means: "both clauses hold (writing two clauses side by side means the same)" },
  { word: "OR", means: "either clause holds" },
  { word: "NOT", means: "the next clause does not hold" },
  { word: "(", means: "group clauses so AND and OR combine as you mean" },
];

/** What `by:` takes besides an actor id. */
export const QUERY_BY_AUTHORS: readonly string[] = ["user", "agent", "system"];

/** The range keys every block has: compared to a date (`updated >= -7d`), see QUERY_DATE_HELP in dates.ts. */
export const QUERY_RANGE_HELP: readonly { key: string; means: string }[] = [
  { key: "updated", means: "when the block last changed" },
  { key: "created", means: "when the block was made" },
];

const ATOM_HEAD = /^(?:#|(?:links|linkedfrom|under|parent|call|unread|thread|by):|(?:title|text)~)/i;

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

const TARGET_EXAMPLES: Record<QueryRelationAtom, string> = {
  links: "links:[[garden]], links:((8f3a2c1d)), links:PIE-123 or links:this",
  linkedfrom: "linkedfrom:[[garden]], linkedfrom:((8f3a2c1d)) or linkedfrom:this",
  under: "under:[[projects]], under:((8f3a2c1d)) or under:this",
  parent: "parent:[[projects]], parent:((8f3a2c1d)) or parent:this",
};

function targetOf(name: QueryRelationAtom, raw: string): string {
  const examples = TARGET_EXAMPLES[name];
  if (!raw) throw new QueryAtomError(`${name}: needs a target after the colon, like ${examples}`);
  if (raw.toLowerCase() === THIS_TARGET) return THIS_TARGET;
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
    `${name}:${raw} is not a target: give a [[page]], a ((block id)), a Work ID or this. Write ${examples}`,
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
    const name = word.slice(0, colon).toLowerCase();
    if (name === "call") {
      const id = word.slice(colon + 1);
      if (!CALL_PATTERN.test(id)) throw new QueryAtomError(`call:${id} is not a call id: write call:c-7f3a1c (letters, digits, . _ -; the id list_outlines tells a call)`);
      return { kind: "call", call: id };
    }
    if (name === "by") {
      const who = word.slice(colon + 1);
      if (!READER.test(who)) throw new QueryAtomError(`by:${who} names no writer: write by:user, by:agent, by:system or by:<an actor id> (claude-code@float-2, loki)`);
      return { kind: "by", who };
    }
    if (name === "unread" || name === "thread") {
      const reader = word.slice(colon + 1);
      if (!READER.test(reader)) throw new QueryAtomError(`${name}:${reader} names no reader: write ${name}:me (the person asking) or ${name}:<an agent's actor id>`);
      return { kind: name, reader: reader.toLowerCase() === ME_READER ? ME_READER : reader };
    }
    if (isQueryRelationAtom(name)) return { kind: name, target: targetOf(name, word.slice(colon + 1)) } as QueryAtom;
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
    case "links":
    case "linkedfrom":
    case "under":
    case "parent":
      return `${atom.kind}:${atom.target}`;
    case "call": return `call:${atom.call}`;
    case "by": return `by:${atom.who}`;
    case "unread":
    case "thread":
      return `${atom.kind}:${atom.reader}`;
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

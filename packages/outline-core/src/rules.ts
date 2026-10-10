// User-land rules (PIE-600): "when a block matches this, draw this, or run this". One grammar for both tiers: a rule
// note in the outline (`[rule-name::name]` with `rule-*` properties, no code, like `[callout-type::]`) and a rule in an
// extension's `extension.json` (`rules[]`, code behind it). The service answers which blocks match and what they're
// decorated with; every client draws what it says. This module is the part both sides share: a note's constructs
// (heading, callout, list, rule, image), a text pattern's hits outside code and literal regions, the kind grammar,
// a built-in decoration's spec, the templates its words are written in, and a rule note read into a rule. Pure: no I/O.

import { calloutBlocks } from "./callouts";
import { codeSpanRanges, literalLines } from "./code-ranges";
import { noteStructure } from "./component-block";
import { BAND_ALIGNS as ALIGNS, BAND_PATTERNS, HEADING_STYLE_NAME, type BandAlign as Align, type BandPattern } from "./heading-styles";
import { unsafePatternReason } from "./pattern-safety";
import { propertyTokenMatches } from "./property-grammar";

// ── constructs ──────────────────────────────────────────────────────────────────────────────────────────

/** What a construct is: a Markdown heading, a callout, a list (a run of items), a thematic break, an image line. */
export const CONSTRUCT_KINDS = ["heading", "callout", "list", "rule", "image"] as const;
export type ConstructKind = (typeof CONSTRUCT_KINDS)[number];

/**
 * A construct in a note's text, by whole-text line (0 is the title line): `line` its first, `end` the line after its
 * last. `level` is a heading's level (1–6), a list's indent, a callout's quote depth; `type` a callout's type; `text`
 * its words as written (a heading without its `#`, a callout's title, a list's first item, an image's path).
 */
export interface Construct { kind: ConstructKind; line: number; end: number; level: number; text: string; type?: string }

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)[ \t]*#*[ \t]*$/;
const ITEM = /^([ \t]*)(?:[-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const THEMATIC = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
// An image line: Markdown's `![alt](path)`, or the door's media line (`[img::path]`, `img:: path`, any layout tokens after).
const MARKDOWN_IMAGE = /^[ \t]*(?:[-*+][ \t]+)?!\[[^\]\n]*\]\(([^)\n]+)\)[ \t]*$/;
const MEDIA_LINE = /^[ \t]*(?:[-*+][ \t]+)?(?:\[(?:img|image|video)::([^\]\n]+)\]|(?:img|image|video)::[ \t]*(\S[^\n]*?))(?:[ \t]*\[[A-Za-z][A-Za-z0-9_.-]*::[^\]\n]*\])*[ \t]*$/i;
/** A line's trailing block anchor (` ^beds`): bookkeeping, not words. */
const ANCHOR = /[ \t]+\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}[ \t]*$/;

/**
 * The constructs of a note's text in reading order, each found once. A line inside a code fence, a component block
 * (`::graph-*`) or a literal region is never one. The title line is a heading only when it's written as one (`# Plan`).
 */
export function noteConstructs(text: string): Construct[] {
  const lines = text.split("\n").map(l => l.replace(/\r$/, ""));
  const structure = noteStructure(lines), { inside, markers } = literalLines(text);
  const plain = (i: number) => structure[i] === -1 && !inside.has(i) && !markers.has(i);
  const out: Construct[] = [];
  const callouts = new Map(calloutBlocks(lines).filter(c => c.depth === 1).map(c => [c.line, c]));
  for (let i = 0; i < lines.length; i++) {
    if (!plain(i)) continue;
    const line = lines[i]!;
    const callout = callouts.get(i);
    if (callout) {
      out.push({ kind: "callout", line: i, end: callout.end, level: callout.depth, text: callout.title, type: callout.type });
      i = callout.end - 1;
      continue;
    }
    const heading = HEADING.exec(line);
    if (heading) { out.push({ kind: "heading", line: i, end: i + 1, level: heading[1]!.length, text: heading[2]!.replace(ANCHOR, "") }); continue; }
    if (THEMATIC.test(line)) { out.push({ kind: "rule", line: i, end: i + 1, level: 0, text: "" }); continue; }
    const image = MARKDOWN_IMAGE.exec(line) ?? MEDIA_LINE.exec(line);
    if (image) { out.push({ kind: "image", line: i, end: i + 1, level: 0, text: (image[1] ?? image[2] ?? "").trim() }); continue; }
    const item = ITEM.exec(line);
    if (item) {
      // A list runs over its items, the lines indented under them, and blank lines between items.
      const indent = item[1]!.length;
      let last = i;
      for (let j = i + 1; j < lines.length; j++) {
        const l = lines[j]!;
        if (!l.trim()) continue;
        const nested = ITEM.exec(l);
        if ((nested && nested[1]!.length >= indent) || l.length - l.trimStart().length > indent || structure[j] !== -1) { last = j; continue; }
        break;
      }
      out.push({ kind: "list", line: i, end: last + 1, level: indent, text: item[2]!.replace(ANCHOR, "") });
      i = last;
    }
  }
  return out;
}

// ── a kind to match ─────────────────────────────────────────────────────────────────────────────────────

/** `heading`, `heading:2` (or `h2`), `callout`, `callout:warning`, `list`, `rule`, `image`. */
export interface KindSpec { kind: ConstructKind; level?: number; type?: string }

/** The kind a rule names, or why it isn't one. */
export function parseKindSpec(raw: string): KindSpec | { problem: string } {
  const value = raw.trim().toLowerCase();
  const h = /^h([1-6])$/.exec(value);
  if (h) return { kind: "heading", level: Number(h[1]) };
  const [kind, arg] = value.split(":", 2) as [string, string | undefined];
  if (!(CONSTRUCT_KINDS as readonly string[]).includes(kind)) return { problem: `kind ${JSON.stringify(raw)} is one of ${CONSTRUCT_KINDS.join(", ")} (heading:1 to heading:6, callout:<type>)` };
  if (arg === undefined || arg === "") return { kind: kind as ConstructKind };
  if (kind === "heading") {
    if (!/^[1-6]$/.test(arg)) return { problem: `heading:${arg} isn't a level (1 to 6)` };
    return { kind: "heading", level: Number(arg) };
  }
  if (kind === "callout" && /^[a-z0-9_-]{1,40}$/.test(arg)) return { kind: "callout", type: arg };
  return { problem: `${kind} takes no ${JSON.stringify(arg)}` };
}

const fitsKind = (c: Construct, k: KindSpec) => c.kind === k.kind && (k.level === undefined || c.level === k.level) && (k.type === undefined || c.type === k.type);

// ── what a rule matched in a note ───────────────────────────────────────────────────────────────────────

/**
 * One place a rule matched in a note: the whole block (no text or kind asked), a construct (`kind`), or a line a
 * text pattern hit (`text`), with the pattern's captures (`$0` the whole hit). Lines are whole-text lines; `end` is
 * the line after the last.
 */
export interface RuleHit {
  at: "block" | "construct" | "text"; line: number; end: number; text: string; level?: number; kind?: ConstructKind; captures?: string[];
  /** A text hit's characters: UTF-16 offsets of the hit (`$0`) in the note's whole text, what a `span` place marks. */
  span?: { start: number; end: number };
}

/** At most this many hits per rule in one note: a rule that hits every line decorates the first 16. */
export const MAX_RULE_HITS = 16;
/** A text pattern sees this much of a line: its cost grows with a power of the length (see pattern-safety.ts). */
const MAX_PATTERN_LINE = 400;

/**
 * Where a text pattern hits a note: line by line, never inside a code fence, a component block, a code span, a
 * property token or a literal region, each line once (its first hit). With `kind` too, only the lines of a construct of that kind.
 */
export function ruleHits(text: string, match: { text?: RegExp; kind?: KindSpec }, limit = MAX_RULE_HITS): RuleHit[] {
  if (!match.text && !match.kind) return [{ at: "block", line: 0, end: text.split("\n").length, text: text.split("\n", 1)[0]! }];
  const constructs = match.kind ? noteConstructs(text).filter(c => fitsKind(c, match.kind!)) : [];
  if (!match.text) {
    return constructs.slice(0, limit).map(c => ({ at: "construct" as const, line: c.line, end: c.end, text: c.text, level: c.level, kind: c.kind }));
  }
  const lines = text.split("\n").map(l => l.replace(/\r$/, ""));
  const structure = noteStructure(lines), { inside, markers } = literalLines(text);
  const pattern = new RegExp(match.text.source, match.text.flags.replace(/[gy]/g, ""));
  const out: RuleHit[] = [];
  const lineStart: number[] = [];
  for (let i = 0, o = 0; i < lines.length; i++) { lineStart.push(o); o = text.indexOf("\n", o) + 1 || text.length + 1; }
  for (let i = 0; i < lines.length && out.length < limit; i++) {
    if (structure[i] !== -1 || inside.has(i) || markers.has(i)) continue;
    const owner = match.kind ? constructs.find(c => i >= c.line && i < c.end) : undefined;
    if (match.kind && !owner) continue;
    const line = lines[i]!.slice(0, MAX_PATTERN_LINE);
    // Code spans and property tokens are never prose: `[rule-text::!!(.+)!!]` doesn't match its own rule note.
    const code = [...codeSpanRanges(line), ...propertyTokenMatches(line).map(t => ({ start: t.start, end: t.end }))];
    const global = new RegExp(pattern.source, pattern.flags + "g");
    for (const hit of line.matchAll(global)) {
      if (!hit[0]) break;
      const start = hit.index, end = start + hit[0].length;
      if (code.some(c => c.start < end && start < c.end)) continue;
      out.push({ at: "text", line: i, end: i + 1, text: line, captures: [...hit].map(x => x ?? ""), span: { start: lineStart[i]! + start, end: lineStart[i]! + end }, ...(owner ? { kind: owner.kind, level: owner.level } : {}) });
      break;
    }
  }
  return out;
}

/** A text pattern as a rule writes it, compiled (`u`, and `i` when it starts `(?i)`), or why it can't be. */
export function compileRulePattern(raw: string): RegExp | { problem: string } {
  if (raw.length > 300) return { problem: "the text pattern is longer than 300 characters" };
  // Every line of every note is tested on the service, with no deadline and no way to interrupt a regex: a pattern
  // that can backtrack without bound (`((a+))+`, `(a|aa)*`, a backreference, a pile of `.*`) is refused.
  const insensitive = raw.startsWith("(?i)");
  const unsafe = unsafePatternReason(insensitive ? raw.slice(4) : raw, insensitive ? "iu" : "u");
  if (unsafe) return { problem: `the text pattern ${JSON.stringify(raw)} can take forever on one line: ${unsafe}; use a character class ([ab]+), repeat the inside or the group not both, or match once` };
  try {
    const pattern = new RegExp(insensitive ? raw.slice(4) : raw, insensitive ? "iu" : "u");
    if (pattern.test("")) return { problem: `the text pattern ${JSON.stringify(raw)} matches nothing at all (an empty hit)` };
    return pattern;
  } catch (error) {
    return { problem: `the text pattern ${JSON.stringify(raw)} isn't a regular expression (${error instanceof Error ? error.message : String(error)})` };
  }
}

// ── built-in decorations: what a rule draws with no code ────────────────────────────────────────────────

/**
 * Where a decoration goes: above or below what matched, in its place, or around it; or (ADR 0004 contract 6) `span`, on
 * the characters a text pattern hit (a tone on the words), and `margin`, a card beside them (in the reader's margin
 * column when there's room, folded under the passage when there isn't).
 */
export const PLACES = ["above", "below", "replace", "around", "span", "margin"] as const;
export type Place = (typeof PLACES)[number];

/**
 * The built-in decorations (the no-code tier): `band` a heading in a band of glyph tracks (PIE-599's banner, drawn
 * in place of a heading), `card` a header card of the block's properties, `badge` a short label, `text` words in a
 * tone, `box` a frame around what matched, `divider` a plain track (a hard page divider).
 */
export const BUILT_IN_DECORATIONS = ["band", "card", "badge", "text", "box", "divider"] as const;
export type BuiltInDecoration = (typeof BUILT_IN_DECORATIONS)[number];
/** A band's glyph tracks and where its words sit: the heading styles' own lists (PIE-599), one list for both. */
export { BAND_PATTERNS, BAND_ALIGNS as ALIGNS, type BandPattern, type BandAlign as Align } from "./heading-styles";
/** The tones a decoration is drawn in: the component primitives' (`good`, `warn`, … ). */
export const RULE_TONES = ["default", "good", "warn", "bad", "dim", "accent"] as const;
export type RuleTone = (typeof RULE_TONES)[number];

/**
 * A built-in decoration, as a rule note's `rule-*` properties or a manifest rule's `decorate.use` write it. `label` is
 * a template (`{title}`, `{text}`, `{$1}`, `{level}`, any property of the block: `{status}`); `fields` the block's
 * properties a card shows.
 */
export interface BuiltInSpec {
  use: BuiltInDecoration;
  label?: string;
  tone?: RuleTone;
  fields?: string[];
  pattern?: BandPattern;
  align?: Align;
  /** A band's or divider's heading style by name (`[heading-style::…]`, PIE-599), resolved where it's drawn. */
  style?: string;
}

/** The place a decoration goes when its rule doesn't say: a band and a divider take the line's place, a box goes around, the rest above. */
export function defaultPlace(use: BuiltInDecoration | null, hit: "block" | "construct" | "text"): Place {
  if (use === "band" || use === "divider") return hit === "block" ? "above" : "replace";
  if (use === "box") return "around";
  return "above";
}

/** Reads a built-in spec from loose fields (a rule note's properties, a manifest's `decorate`), or why it can't be one. */
export function builtInSpec(fields: { use?: string; label?: string; tone?: string; fields?: string | readonly string[]; pattern?: string; align?: string; style?: string }): { spec: BuiltInSpec; problems: string[] } | { problem: string } {
  const use = fields.use?.trim().toLowerCase();
  if (!use || !(BUILT_IN_DECORATIONS as readonly string[]).includes(use)) return { problem: `decorate ${JSON.stringify(fields.use ?? "")} is one of ${BUILT_IN_DECORATIONS.join(", ")}` };
  const problems: string[] = [];
  const spec: BuiltInSpec = { use: use as BuiltInDecoration };
  if (fields.label !== undefined && fields.label.trim()) spec.label = fields.label.trim().slice(0, 300);
  const pick = <T extends string>(name: string, raw: string | undefined, options: readonly T[]): T | undefined => {
    if (raw === undefined || !raw.trim()) return undefined;
    const v = raw.trim().toLowerCase();
    if ((options as readonly string[]).includes(v)) return v as T;
    problems.push(`${name} ${JSON.stringify(raw)} is one of ${options.join(", ")}`);
    return undefined;
  };
  const tone = pick("tone", fields.tone, RULE_TONES), pattern = pick("pattern", fields.pattern, BAND_PATTERNS), align = pick("align", fields.align, ALIGNS);
  if (tone) spec.tone = tone;
  if (pattern) spec.pattern = pattern;
  if (fields.style !== undefined && fields.style.trim()) {
    const name = fields.style.trim().toLowerCase();
    if (HEADING_STYLE_NAME.test(name)) spec.style = name;
    else problems.push(`style ${JSON.stringify(fields.style)} isn't a heading style's name`);
  }
  if (align) spec.align = align;
  const list = typeof fields.fields === "string" ? fields.fields.split(",") : fields.fields ?? [];
  const keys = list.map(k => k.trim()).filter(Boolean);
  for (const k of keys) if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(k)) problems.push(`field ${JSON.stringify(k)} isn't a property key`);
  const good = keys.filter(k => /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(k)).slice(0, 12);
  if (good.length) spec.fields = good;
  return { spec, problems };
}

/**
 * A template's words for one hit: `{title}` the block's title, `{text}` what matched (a heading's words, the line),
 * `{level}`, `{$0}`…`{$9}` a text pattern's captures, and any other `{key}` the block's property of that name
 * (several values joined with `, `). A name with nothing behind it is empty.
 */
export function expandTemplate(template: string, values: { title: string; text: string; level?: number; captures?: readonly string[]; property: (key: string) => readonly string[] }): string {
  return template.replace(/\{([A-Za-z$][A-Za-z0-9_.$-]{0,63})\}/g, (_, name: string) => {
    if (name === "title") return values.title;
    if (name === "text") return values.text;
    if (name === "level") return values.level === undefined ? "" : String(values.level);
    const capture = /^\$([0-9])$/.exec(name);
    if (capture) return values.captures?.[Number(capture[1])] ?? "";
    return values.property(name).join(", ");
  });
}

// ── a rule note: the no-code tier ───────────────────────────────────────────────────────────────────────

/** A rule's name: what `[rule-name::name]` writes. */
export const RULE_NAME = /^[a-z0-9][a-z0-9_-]{0,39}$/;

/**
 * What a rule matches. Every condition given must hold: `query` (the saved views' grammar, `type=meeting`, which is
 * also the property case), `view` (a saved view's query, by its block), `under` (only blocks under this one), `text`
 * (a pattern, line by line, outside code) and `kind` (a construct). Without `text` or `kind` the whole block matches.
 */
export interface RuleMatch { query?: string; view?: string; under?: string; text?: string; kind?: string }

/** A rule read from a note (`[rule-name::name]` and its `rule-*` properties). */
export interface NoteRule { name: string; block: string; match: RuleMatch; place?: Place; decorate: BuiltInSpec }

/** A note that might declare a rule: its id and its block properties. */
export interface RuleDeclaringBlock { id: string; properties: readonly { key: string; value: string }[] }

/** `((id))`, `((id|label))` or a bare id: the id. */
const blockRef = (raw: string) => /^\(\(([0-9a-f-]{36})(?:\|[^)]*)?\)\)$/i.exec(raw.trim())?.[1] ?? (/^[0-9a-f-]{36}$/i.test(raw.trim()) ? raw.trim() : null);

/**
 * The rules an outline's notes declare. A note with `[rule-name::name]` declares one; on the same note:
 * - what it matches: `[rule-match::type=meeting]` (a query), `[rule-view::((id))]`, `[rule-under::((id))]`,
 *   `[rule-text::!!(.+)!!]` (a pattern; `]` written `\x5d`), `[rule-kind::heading:1]`; at least one of match, view,
 *   text or kind;
 * - what it draws: `[rule-decorate::band]` (band, card, badge, text, box, divider), `[rule-place::replace]` (above,
 *   below, replace, around), `[rule-label::{title}]`, `[rule-tone::accent]`, `[rule-fields::attendees, when]`,
 *   `[rule-pattern::stack]`, `[rule-align::center]`, `[rule-style::plot]` (a heading style by name, PIE-599: a band or
 *   divider draws with it, the pattern and align above over it).
 * What can't be used is said in `problems` (a bad tone or pattern is left out and the rest still works); the first
 * note to take a name has it.
 */
export function rulesFromBlocks(blocks: readonly RuleDeclaringBlock[]): { rules: NoteRule[]; problems: string[] } {
  const rules: NoteRule[] = [], problems: string[] = [];
  for (const b of blocks) {
    const prop = (k: string) => b.properties.find(p => p.key.toLowerCase() === k)?.value.trim();
    const raw = prop("rule-name");
    if (raw === undefined) continue;
    const name = raw.toLowerCase(), where = `note ${b.id.slice(0, 8)}`;
    if (!RULE_NAME.test(name)) { problems.push(`${where}: rule-name ${JSON.stringify(raw)} isn't a name (lowercase letters, digits, - and _)`); continue; }
    if (rules.some(r => r.name === name)) { problems.push(`${where}: rule ${name} is declared already`); continue; }
    const match: RuleMatch = {};
    const query = prop("rule-match"), text = prop("rule-text"), kind = prop("rule-kind");
    if (query) match.query = query;
    if (text) {
      const compiled = compileRulePattern(text);
      if ("problem" in compiled) { problems.push(`${where}: ${compiled.problem}`); continue; }
      match.text = text;
    }
    if (kind) {
      const spec = parseKindSpec(kind);
      if ("problem" in spec) { problems.push(`${where}: ${spec.problem}`); continue; }
      match.kind = kind.trim().toLowerCase();
    }
    // A scope that can't be read leaves the rule out: without it a scoped rule would apply everywhere.
    let scoped = true;
    for (const [key, field] of [["rule-view", "view"], ["rule-under", "under"]] as const) {
      const value = prop(key);
      if (value === undefined) continue;
      const id = blockRef(value);
      if (!id) { problems.push(`${where}: ${key} ${JSON.stringify(value)} isn't a block ((id)), so rule ${name} is left out`); scoped = false; continue; }
      match[field] = id;
    }
    if (!scoped) continue;
    if (!match.query && !match.view && !match.text && !match.kind) { problems.push(`${where}: rule ${name} matches nothing: add rule-match, rule-view, rule-text or rule-kind`); continue; }
    const read = builtInSpec({ use: prop("rule-decorate") ?? "", label: prop("rule-label"), tone: prop("rule-tone"), fields: prop("rule-fields"), pattern: prop("rule-pattern"), align: prop("rule-align"), style: prop("rule-style") });
    if ("problem" in read) { problems.push(`${where}: ${read.problem}`); continue; }
    problems.push(...read.problems.map(p => `${where}: ${p}`));
    const placeRaw = prop("rule-place")?.toLowerCase();
    let place: Place | undefined;
    if (placeRaw) {
      if ((PLACES as readonly string[]).includes(placeRaw)) place = placeRaw as Place;
      else problems.push(`${where}: rule-place ${JSON.stringify(placeRaw)} is one of ${PLACES.join(", ")}`);
    }
    rules.push({ name, block: b.id, match, ...(place ? { place } : {}), decorate: read.spec });
  }
  return { rules, problems };
}

/** The `rule-*` keys a rule note writes: its own words, never matched as the block's own properties by a card. */
export const RULE_KEYS = ["rule-name", "rule-match", "rule-view", "rule-under", "rule-text", "rule-kind", "rule-decorate", "rule-place", "rule-label", "rule-tone", "rule-fields", "rule-pattern", "rule-align", "rule-style"] as const;

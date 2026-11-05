// The note-routing component was `route`; it is note-mover now (PIE-1314), so "route" is free for tiles. This is the
// one place that knows both names: what an old rule note means now, what saving one says (syntax-warnings.ts lists it
// on every write path), and the rewrite `scripts/rename-route-to-note-mover.ts` applies. An old rule keeps working, so
// nobody's rule stops the day this ships. `[route::…]` was never the component's, and stays an ordinary open property.
// Pure: no I/O.

import { parsePropertyRecords, type PropertyRecord } from "./property-parse";

export const NOTE_MOVER = "note-mover";
export const NOTE_MOVER_HISTORY = "note-mover-history";
export const OLD_RULE_TYPE = "route";
export const OLD_HISTORY_TYPE = "route-history";
/** The rule's own properties: their old names, then what they're called now. */
export const OLD_RULE_KEYS: Readonly<Record<string, string>> = {
  "route-to": NOTE_MOVER, "route-when": "note-mover-when", "route-order": "note-mover-order", "route-at": "note-mover-at",
};
/** The view's seeded words before the rename: replaced only when they stand as seeded; anything else in the note is a person's. */
const OLD_VIEW_WORDS = [
  "Notes route themselves by the rules listed here, and a rule is a note anywhere in the outline: its properties are type (route), query (which notes, in the saved views' grammar: type=recipe) and route-to (where they go: a note's ((id)), a [[page]], a Work ID, inbox or root). Optional: route-when (create, the default: new notes; edit: every save; command: only when asked), route-order (a number; lower first) and route-at (top, the default, or end).",
  "",
  "First match wins: by route-order, then the order of this view, then the order written. A match moves the note as ext:route, one revision, with a history under the rule. `ep0ch route <note> --dry-run` says what would move where and why; `ep0ch route --all` routes every note; in the door, alt+z routes the note you read.",
].join("\n");
/** What the Note mover view says under its title. */
export const NOTE_MOVER_VIEW_WORDS = [
  "Notes move themselves by the rules listed here, and a rule is a note anywhere in the outline: its properties are note-mover (where they go: a note's ((id)), a [[page]], a Work ID, inbox or root) and query (which notes, in the saved views' grammar: type=recipe). Optional: note-mover-when (create, the default: new notes; edit: every save; command: only when asked), note-mover-order (a number; lower first) and note-mover-at (top, the default, or end).",
  "",
  "First match wins: by note-mover-order, then the order of this view, then the order written. A match moves the note as ext:note-mover, one revision, with a history under the rule. `ep0ch route <note> --dry-run` says what would move where and why; `ep0ch route --all` moves every note; in the door, alt+z moves the note you read.",
].join("\n");

/** A component id as it's called now: a page asked for by the old name opens the new one. */
export const currentComponentId = (id: string) => (id === OLD_RULE_TYPE ? NOTE_MOVER : id);

const WRITE_A_RULE = "a rule is a note's own [note-mover::((id))] [query::…]";
const blockRecords = (text: string): PropertyRecord[] => parsePropertyRecords(text).filter(r => r.scope === "block");
const isOldType = (r: PropertyRecord) => r.key === "type" && r.value.trim().toLowerCase() === OLD_RULE_TYPE;

/** What a `::name` line that isn't a block says, for the rule's old name and its new one; null for any other name. */
export function moverLineWarning(name: string, line: number): string | null {
  if (name === OLD_RULE_TYPE) return `the ::route on line ${line + 1} is renamed to note-mover, and it draws nothing: ${WRITE_A_RULE}`;
  if (name === NOTE_MOVER) return `the ::note-mover on line ${line + 1} draws nothing: ${WRITE_A_RULE}`;
  return null;
}

/** What saving a note declared `[type::route]` says: on the type's line, with the rule it means now. */
export function oldRuleWarning(text: string): { line: number; message: string } | null {
  const records = blockRecords(text);
  const old = records.find(isOldType);
  if (!old) return null;
  const said = records.flatMap(r => {
    if (r.key === "query") return [`[query::${r.value}]`];
    const now = OLD_RULE_KEYS[r.key];
    return now ? [`[${now}::${r.value}]`] : [];
  });
  if (!records.some(r => r.key === "route-to")) said.push("[note-mover::((id))]");
  return { line: old.line, message: `the [type::route] rule on line ${old.line + 1} is renamed to note-mover: did you mean ${said.join(" ")}?` };
}

/** `text` with these spans replaced, last first so the earlier offsets hold. */
function spliced(text: string, edits: readonly { start: number; end: number; with: string }[]): string {
  return [...edits].sort((a, b) => b.start - a.start).reduce((out, e) => out.slice(0, e.start) + e.with + out.slice(e.end), text);
}

/**
 * The token gone. Alone on its line, the line goes too: a blank line there would end the note's properties, and the
 * rule's query and target under it would stop being the note's. Otherwise the space before it (or after it, first on its line).
 */
function dropped(text: string, r: PropertyRecord): { start: number; end: number; with: string } {
  const lineStart = text.lastIndexOf("\n", r.start - 1) + 1;
  const next = text.indexOf("\n", r.end);
  const lineEnd = next < 0 ? text.length : next;
  if (!text.slice(lineStart, r.start).trim() && !text.slice(r.end, lineEnd).trim()) {
    return next >= 0 ? { start: lineStart, end: next + 1, with: "" } : { start: Math.max(0, lineStart - 1), end: lineEnd, with: "" };
  }
  if (r.start > 0 && /[ \t]/.test(text[r.start - 1]!)) return { start: r.start - 1, end: r.end, with: "" };
  return { start: r.start, end: /[ \t]/.test(text[r.end] ?? "") ? r.end + 1 : r.end, with: "" };
}

/** A token as written with its key renamed: the parser lowercases a record's key, the raw keeps what the person typed. */
const withKey = (r: PropertyRecord, now: string): string => {
  const at = r.raw.toLowerCase().indexOf(r.key);
  return r.raw.slice(0, at) + now + r.raw.slice(at + r.key.length);
};

/** A token as written with its value replaced, whichever way it's written (`[key::value]` or `key:: value`). */
const withValue = (r: PropertyRecord, now: string): string => {
  const at = r.raw.lastIndexOf(r.value);
  return r.raw.slice(0, at) + now + r.raw.slice(at + r.value.length);
};

/**
 * An old rule note as note-mover writes it, or null for a note that isn't one, or one with no target yet: its
 * `[type::route]` is all that says what it's meant to be, and its warning already asks for the rest.
 */
export function renamedRuleText(text: string): string | null {
  const records = blockRecords(text);
  if (!records.some(isOldType) || !records.some(r => r.key === "route-to")) return null;
  return spliced(text, records.flatMap(r => {
    if (isOldType(r)) return [dropped(text, r)];
    const now = OLD_RULE_KEYS[r.key];
    return now ? [{ start: r.start, end: r.end, with: withKey(r, now) }] : [];
  }));
}

/** A rule's history note under the new names, or null for any other note. */
export function renamedHistoryText(text: string): string | null {
  const records = blockRecords(text);
  const isOldHistory = (r: PropertyRecord) => r.key === "type" && r.value.toLowerCase() === OLD_HISTORY_TYPE;
  if (!records.some(isOldHistory)) return null;
  const out = spliced(text, records.flatMap(r => {
    if (isOldHistory(r)) return [{ start: r.start, end: r.end, with: withValue(r, NOTE_MOVER_HISTORY) }];
    if (r.key === "machine" && r.value.toLowerCase() === OLD_RULE_TYPE) return [{ start: r.start, end: r.end, with: withValue(r, NOTE_MOVER) }];
    return [];
  }));
  return out.replace(/^Routing history\b/, "Moves");
}

const OLD_IN_QUERY = /\btype\s*=\s*route(-history)?\b(?!-)/g;

/**
 * A saved view over the old name under the new one, or null for a note that doesn't need it. Only the note's own
 * properties count, however they're written; a `[query::type=route]` in its prose is words about one. The seeded view
 * (its `[system-view::routing]`) lists a half-written old rule too, and takes the new title, page and words unless a
 * person has given it their own; a person's own view just asks for the new name.
 */
export function renamedView(text: string): string | null {
  const records = blockRecords(text);
  const seeded = records.some(r => r.key === "system-view" && r.value === "routing");
  const edits = records.flatMap(r => {
    const to = (now: string) => [{ start: r.start, end: r.end, with: withValue(r, now) }];
    if (seeded && (r.key === "system-view" || r.key === "page") && r.value === "routing") return to(NOTE_MOVER);
    if (r.key !== "query" || /(^|[^\w-])note-mover($|[^\w-])/.test(r.value)) return [];
    if (seeded && r.value === `type=${OLD_RULE_TYPE}`) return to(`${NOTE_MOVER} OR type=${OLD_RULE_TYPE}`);
    const now = r.value.replace(OLD_IN_QUERY, (_, history) => (history ? `type=${NOTE_MOVER_HISTORY}` : NOTE_MOVER));
    return now === r.value ? [] : to(now);
  });
  if (!edits.length) return null;
  const rewritten = spliced(text, edits);
  if (!seeded) return rewritten;
  return rewritten.replace(/^Routing(?=\s|$)/, "Note mover").replace(OLD_VIEW_WORDS, () => NOTE_MOVER_VIEW_WORDS);
}

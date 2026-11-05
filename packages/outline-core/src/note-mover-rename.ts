// The note-routing component was `route`; it is note-mover now (PIE-1314), so "route" is free for tiles. This is the
// one place that knows both names: what an old rule note means now, what saving one says (syntax-warnings.ts lists it
// on every write path), and the rewrite `scripts/rename-route-to-note-mover.ts` applies. An old rule keeps working, so
// nobody's rule stops the day this ships. `[route::…]` was never the component's, and stays an ordinary open property.
// Pure: no I/O.

import { parsePropertyRecords, type PropertyRecord } from "./property-parse";
import { replacePropertyTokens } from "./property-grammar";

export const NOTE_MOVER = "note-mover";
export const NOTE_MOVER_HISTORY = "note-mover-history";
export const OLD_RULE_TYPE = "route";
export const OLD_HISTORY_TYPE = "route-history";
/** The rule's own properties: their old names, then what they're called now. */
export const OLD_RULE_KEYS: Readonly<Record<string, string>> = {
  "route-to": NOTE_MOVER, "route-when": "note-mover-when", "route-order": "note-mover-order", "route-at": "note-mover-at",
};
/** The first line of the view's seeded words before the rename: a view still opening with it takes the new ones. */
const OLD_VIEW_OPENING = "Notes route themselves by the rules listed here";
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

/** The token gone, with the space before it (or after it, first on its line). */
function dropped(text: string, r: PropertyRecord): { start: number; end: number; with: string } {
  if (r.start > 0 && /[ \t]/.test(text[r.start - 1]!)) return { start: r.start - 1, end: r.end, with: "" };
  return { start: r.start, end: /[ \t]/.test(text[r.end] ?? "") ? r.end + 1 : r.end, with: "" };
}

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
    return now ? [{ start: r.start, end: r.end, with: r.raw.replace(r.key, now) }] : [];
  }));
}

/** A rule's history note under the new names, or null for any other note. */
export function renamedHistoryText(text: string): string | null {
  const records = blockRecords(text);
  if (!records.some(r => r.key === "type" && r.value.trim() === OLD_HISTORY_TYPE)) return null;
  const out = spliced(text, records.flatMap(r => {
    if (r.key === "type" && r.value.trim() === OLD_HISTORY_TYPE) return [{ start: r.start, end: r.end, with: r.raw.replace(OLD_HISTORY_TYPE, NOTE_MOVER_HISTORY) }];
    if (r.key === "machine" && r.value.trim() === OLD_RULE_TYPE) return [{ start: r.start, end: r.end, with: r.raw.replace(OLD_RULE_TYPE, NOTE_MOVER) }];
    return [];
  }));
  return out.replace(/^Routing history\b/, "Moves");
}

const OLD_IN_QUERY = /\btype\s*=\s*route(-history)?\b(?!-)/g;

/**
 * A saved view over the old name under the new one, or null for a note that doesn't need it. The seeded view (its
 * `[system-view::routing]`) lists a half-written old rule too, and takes the new title, page and words unless a person
 * has given it their own; a person's own view just asks for the new name.
 */
export function renamedView(text: string): string | null {
  const seeded = blockRecords(text).some(r => r.key === "system-view" && r.value.trim() === "routing");
  const rewritten = replacePropertyTokens(text, t => {
    if (seeded && t.key === "system-view" && t.value.trim() === "routing") return `[system-view::${NOTE_MOVER}]`;
    if (seeded && t.key === "page" && t.value.trim() === "routing") return `[page::${NOTE_MOVER}]`;
    if (t.key !== "query" || /(^|[^\w-])note-mover($|[^\w-])/.test(t.value)) return t.raw;
    if (seeded && t.value.trim() === `type=${OLD_RULE_TYPE}`) return `[query::${NOTE_MOVER} OR type=${OLD_RULE_TYPE}]`;
    return `[query::${t.value.replace(OLD_IN_QUERY, (_, history) => (history ? `type=${NOTE_MOVER_HISTORY}` : NOTE_MOVER))}]`;
  });
  if (rewritten === text) return null;
  if (!seeded) return rewritten;
  const lines = rewritten.split("\n");
  lines[0] = lines[0]!.replace(/^Routing(?=\s|$)/, "Note mover");
  const opening = lines.findIndex(l => l.startsWith(OLD_VIEW_OPENING));
  return (opening > 0 ? [...lines.slice(0, opening), NOTE_MOVER_VIEW_WORDS] : lines).join("\n");
}

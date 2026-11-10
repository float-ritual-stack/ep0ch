// The note-routing component was `route`; it is note-mover now (PIE-1314), so "route" is free for tiles. This is the
// one place that knows both names: what an old rule note means now and what saving one says (syntax-warnings.ts lists
// it on every write path). An old rule keeps working. `[route::…]` was never the component's, and stays an ordinary open property.
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

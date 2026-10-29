// Machinery (PIE-867): what a tool writes for its own bookkeeping, as against what a person or an agent chose to say.
// A producer stamps its records with one property, `[machine::<producer>]` (`file-touch`, `echonet`, `delivery`,
// `intake`, `backup`); the key is the same for all of them, so no client lists types and a new producer joins by
// writing it (properties are open). Proofs, patch notes, tickets and carried comments are not stamped: someone chose
// those words, and a carried comment keeps its source's author.
//
// One predicate (`isMachinery`) and one flag (`machinery: hide | only | show`) say what a list, a feed or a query holds.
// The service answers the flag; every client passes it on and never decides for itself which notes are machinery.
// Pure: no I/O. A change to what counts as machinery bumps GRAMMAR (protocol.ts).

import { replacePropertyTokens } from "./property-grammar";

/** The property a producer stamps on its own records. */
export const MACHINE_KEY = "machine";

/** `hide` leaves machinery out (the default of every reader), `only` holds just that, `show` holds everything. */
export type MachineryMode = "hide" | "only" | "show";
export const MACHINERY_MODES: readonly MachineryMode[] = ["hide", "only", "show"];
export const DEFAULT_MACHINERY: MachineryMode = "hide";

/** The mode a request asks for (`undefined` is the default); anything else is refused with what is allowed. */
export function parseMachineryMode(value: unknown, field = "machinery"): MachineryMode {
  if (value === undefined || value === null) return DEFAULT_MACHINERY;
  if (typeof value === "string" && (MACHINERY_MODES as readonly string[]).includes(value)) return value as MachineryMode;
  throw new Error(`${field} is hide, only or show (hide is the default: it leaves out what tools write for their own bookkeeping), not ${JSON.stringify(value)}`);
}

/** The producer a block's properties name, when it is stamped: `[machine::echonet]` gives `echonet`. */
export function machineryProducer(properties: readonly { key: string; value: string }[]): string | undefined {
  return properties.find(property => property.key === MACHINE_KEY && property.value.trim() !== "")?.value.trim();
}

/** Whether a block is machinery: it carries `[machine::…]`. The one rule every reader uses. */
export const isMachinery = (properties: readonly { key: string; value: string }[]): boolean => machineryProducer(properties) !== undefined;

/** Whether a mode lets a block through. */
export const machineryAllows = (mode: MachineryMode, machinery: boolean): boolean =>
  mode === "show" || (mode === "only" ? machinery : !machinery);

/**
 * Whether a text change touched only `[key::value]` tokens (a stage move, a stamp, a sync): the words around them are
 * the same. Such a revision says nothing was written, only that something was marked.
 */
export function bookkeepingOnly(before: string, after: string): boolean {
  const bare = (text: string) => replacePropertyTokens(text, () => "").replace(/[ \t]+$/gm, "");
  return before !== after && bare(before) === bare(after);
}

/** What the notifications hub stamps on each notification it fetched (PIE-1427): its own kind, so a reader can ask for them on purpose (`machine=notification`). */
export const NOTIFICATION_MACHINE = "notification";

/** Whether a query reads recent activity: it compares `updated` (`updated >= -1d`). Such a read says what machinery it left out. */
export const readsRecentActivity = (where: string | undefined): boolean => !!where && /\bupdated\s*(?:<=|>=|<|>|=)/i.test(where);

/** What a read left out, by producer (`[machine::<producer>]`), as one count and one sentence that says how to get them back. */
export interface MachineryLeftOut { count: number; by: Record<string, number>; said: string }

/**
 * The left-out count a hiding read reports (PIE-1427), from the service's facet counts of `machine` over the same
 * question asked with `machinery: only`: "212 notifications and bookkeeping notes left out (machinery: show brings them
 * back)". Undefined when nothing was left out.
 */
export function machineryLeftOut(by: Record<string, number>, bringBack = "machinery: show brings them back"): MachineryLeftOut | undefined {
  const count = Object.values(by).reduce((sum, n) => sum + n, 0);
  if (!count) return undefined;
  const notifications = by[NOTIFICATION_MACHINE] ?? 0, rest = count - notifications;
  const what = notifications && rest ? "notifications and bookkeeping notes"
    : notifications ? (notifications === 1 ? "notification" : "notifications")
    : rest === 1 ? "bookkeeping note" : "bookkeeping notes";
  return { count, by, said: `${count} ${what} left out (${bringBack})` };
}

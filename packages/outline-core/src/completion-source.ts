// Completion sources (ADR 0004 §4, PIE-1340): one contract every source answers on, built-in or an extension's, and the
// one merge that ranks their rows together. A source declares the triggers it answers (outline-core's
// completion-triggers.ts names which one the cursor is in) and answers rows for what's typed; the completer asks every
// source for the trigger, built-ins first, and merges their answers here: preselect, then source priority, then how well the search matcher
// (search-match.ts) matches the row, then recent and frequent picks, each source's own
// order kept. The door and Detail both merge with this, so they show the same rows. Pure: no I/O.
import { prepareSearchQuery, scoreSearchDocument, searchMatchSpans, type SearchMatchKind } from "./search-match";
import type { CompletionKind } from "./completion-triggers";
import type { SnippetSlot } from "./completion-snippet";
import { slotReferences } from "./button-call";

/**
 * The triggers a source can join, as an extension's manifest writes them. No source adds a sigil of its own: these are
 * the ones the detector knows (`key::` is a property's value, narrowed by the source's `keys`).
 */
export const EXTENSION_TRIGGERS = ["[[", "((", "@", "::", "[key", "key::", "yaml-key", "yaml-value", "[file::", "> [!"] as const;
/**
 * Every trigger the sources answer: the extensions', and those only the service's built-ins answer (a component's
 * attributes and a filter's words, PIE-1366), whose insert needs what the ask carries (the quote, the filter's words).
 */
export const SOURCE_TRIGGERS = [...EXTENSION_TRIGGERS, "attribute", "attribute-value", "filter-key", "filter-value", "query", "| as", "/", "%", "button-step", "fence-setting"] as const;
export type SourceTrigger = (typeof SOURCE_TRIGGERS)[number];

const TRIGGER_OF: Partial<Record<CompletionKind, SourceTrigger>> = {
  query: "query", formatter: "| as", action: "/", tile: "%", "button-step": "button-step", "fence-setting": "fence-setting",
  page: "[[", block: "((", agent: "@", component: "::", key: "[key", value: "key::", "yaml-key": "yaml-key", "yaml-value": "yaml-value",
  attribute: "attribute", "attribute-value": "attribute-value", "filter-key": "filter-key", "filter-value": "filter-value", file: "[file::", callout: "> [!",
};
/** The triggers that complete one property's (or one prop's) value: a source's `keys` narrow them, and picks are kept per key. */
export const VALUE_TRIGGERS: ReadonlySet<SourceTrigger | null> = new Set(["key::", "yaml-value", "attribute-value", "filter-value"]);

/** The trigger a detected target asks its sources for. */
export const triggerOf = (kind: CompletionKind): SourceTrigger | null => TRIGGER_OF[kind] ?? null;

/** What choosing a row writes in place of the token: text, or a snippet whose `select` span is selected once it's in. */
export type SourceInsert = string | { snippet: string; select?: SnippetSlot; slots?: SnippetSlot[] };

/**
 * One row a source answers. It draws from these fields alone (marker, label with its matched letters lit, detail dim,
 * kind at the right), and the docs panel beside the list wraps `docs`. The reference fields say what an insert checks
 * with the service first (the note still there, the anchor still once) and what it makes (a new page, an anchor).
 */
export interface SourceRow {
  querySuggestion?: import("./query-words").QueryWords;
  queryOutcome?: "accepted" | "edited";
  queryCorrections?: { from: string[]; clause: string }[];
  /** Unique within its source's answer; the insert's text when absent. */
  id?: string;
  label: string;
  /** One short word for the right-hand column: block, page, anchor, property, component, agent, action, value, issue… */
  kind?: string;
  /** One dim line after the label: where it is, a signature, why it's offered. */
  detail?: string;
  /** Blockdown the docs panel wraps for the lit row: what it is, where it sits, how it starts. */
  docs?: string;
  /** Words the matcher reads besides the label (a component's name when its label is its title); never the docs, whose prose would match any two letters. */
  filter?: string;
  insert: SourceInsert;
  /** Lit first when the list opens, above every match (one per list: the first wins). */
  preselect?: boolean;
  /** A row may override its source's priority. */
  priority?: number;
  /** Until a deliberate choice, Enter belongs to the field; Tab still inserts. */
  enter?: "new line" | "applies";
  /** Offered after every match, from any source (a new page to make from what's typed). */
  fallback?: boolean;
  /** Listed under the row before it (a note's anchor under the note): it moves with that row, never on its own. */
  under?: boolean;
  /** Rows are grouped under headings by this, when it changes. */
  group?: string;
  blockId?: string;
  address?: string;
  fragmentId?: string;
  passageLine?: number;
  /** Words at the label's end drawn dim (` · adds ^a10`). */
  addition?: string;
  /** A heading that gets its anchor when chosen: that line's new text, if its note is still at `revision`. */
  anchor?: { lineIndex: number; line: string; revision: number };
  /** A page nobody has written yet: choosing it makes it (`pages.follow`, attributed) and links it. */
  newPage?: string;
  /**
   * A note component nobody has written yet (`::stale`): choosing it writes its starter note under [[components]]
   * (`component.new`, attributed), inserts the call and opens the note beside.
   */
  newComponent?: string;
  /** The note that defines it (an agent's script note): `g` opens it beside. */
  definition?: string;
  /**
   * Blockdown that shows what choosing it makes (a component's variation, a value set on its component, a callout of its
   * type), with the declaring note it needs, for a client to draw beside the list; `inline` draws a glimpse after the label too.
   */
  example?: { use: string; note?: string; inline?: boolean };
  /** The component (its schema id) the row writes: a client that draws its properties table finds it by this. */
  component?: string;
  /** What the row opens into (→): its variations and arguments, each a row of its own. */
  variations?: SourceRow[];
}

/** What a source is: its id, the triggers it answers, and where its rows sit among equals. */
export interface SourceDecl {
  /** `pages`, `blocks`, `components`…, or an extension's `ext.<extension>.<id>`. */
  id: string;
  title: string;
  description?: string;
  triggers: readonly SourceTrigger[];
  /** For a value (`key::`, `yaml-value`, `attribute-value`, `filter-value`): only these property keys; every key when absent. */
  keys?: readonly string[];
  /** Higher first after preselect; ordinary built-ins and extensions share priority 0. */
  priority?: number;
  /** The source orders its own rows (the service's notes search, Jev): the merge never reorders them among themselves. */
  ranked?: boolean;
  /** `door`, `service`, or the extension's id. */
  by: string;
}

/** What the completer asks a source: the trigger, what's typed, and (for a value or YAML) the key and component. */
export interface SourceAsk {
  trigger: SourceTrigger | null;
  kind: CompletionKind;
  query: string;
  key?: string;
  component?: string;
  limit: number;
  /** Aborted when the person types on or the list closes: a slow source stops and its answer is dropped. */
  signal?: AbortSignal;
}

/** Whether a source answers this ask: its trigger, and for a value its keys. */
export function sourceAnswers(decl: Pick<SourceDecl, "triggers" | "keys">, ask: Pick<SourceAsk, "trigger" | "key">): boolean {
  if (!ask.trigger || !decl.triggers.includes(ask.trigger)) return false;
  if (VALUE_TRIGGERS.has(ask.trigger) && decl.keys?.length) return !!ask.key && decl.keys.includes(ask.key.toLowerCase());
  return true;
}

/** One source's answer to an ask, as the merge takes it. */
export interface SourceAnswer<R extends SourceRow = SourceRow> {
  source: Pick<SourceDecl, "id" | "title" | "priority" | "ranked" | "by">;
  rows: readonly R[];
  /** Why it has no rows when it should (failed, timed out): said in the list's footer, never instead of the others' rows. */
  problem?: string;
}

/** How often and how lately a row's insert was chosen for a trigger: the outline host keeps these, so every client agrees. */
export interface PickRecord { n: number; at: string }
/** Per trigger (`[[`, `key::issue`…), per pick identity. */
export type Picks = Record<string, Record<string, PickRecord>>;

/** The key picks are kept under for an ask: the trigger, and for a value its property key. */
export const pickKey = (ask: Pick<SourceAsk, "trigger" | "kind" | "key">): string =>
  `${ask.trigger ?? ask.kind}${ask.key && (VALUE_TRIGGERS.has(ask.trigger) || !ask.trigger) ? ask.key : ""}`;

/** The text an insert writes. */
export const insertText = (insert: SourceInsert): string => typeof insert === "string" ? insert : insert.snippet;
/** Pick history keeps a stable identity, so a large snippet never becomes a metadata key. */
export function pickId(text: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) hash = BigInt.asUintN(64, (hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n);
  return hash.toString(16);
}
/** The span a snippet selects once it's in, if any. */
export const insertSelection = (insert: SourceInsert): { start: number; end: number } | undefined => typeof insert === "string" ? undefined : insert.select;
/** Explicit spans select example values; named placeholders share the button's {slot} grammar. */
export const insertSlots = (insert: SourceInsert): SnippetSlot[] => typeof insert === "string" ? []
  : insert.slots ?? [...(insert.select ? [insert.select] : []), ...slotReferences(insert.snippet)
    .filter(s => !insert.select || s.start >= insert.select.end || s.end <= insert.select.start)]
    .sort((a, b) => a.start - b.start);

/** At most this many picks are kept per trigger: the oldest go. */
export const PICKS_PER_TRIGGER = 200;

/** A pick added to `picks` (a new object): its count up one, its time now; the trigger's oldest dropped past the cap. */
export function recordPick(picks: Picks, key: string, insert: string, now: Date): Picks {
  const was = picks[key] ?? {}, mine = was[insert];
  const next = { ...was, [insert]: { n: (mine?.n ?? 0) + 1, at: now.toISOString() } };
  const kept = Object.entries(next).sort((a, b) => b[1].at.localeCompare(a[1].at)).slice(0, PICKS_PER_TRIGGER);
  return { ...picks, [key]: Object.fromEntries(kept) };
}

/** Frecency: how often, halved every two weeks since the last pick; 0 for never. */
export function frecency(pick: PickRecord | undefined, now: Date): number {
  if (!pick) return 0;
  const days = Math.max(0, (now.getTime() - Date.parse(pick.at)) / 86_400_000);
  return pick.n * Math.pow(0.5, days / 14);
}

/** How well a row matches, coarsely: the label as typed, the label holding it, the text holding it, typos, letters in order. */
const TIER: Record<SearchMatchKind, number> = {
  "exact-id": 0, "id-prefix": 0, "exact-title": 0, "title-prefix": 0,
  "title-contains": 1, "title-terms": 1,
  "text-contains": 2, "text-terms": 2,
  "typo-terms": 3, "partial-terms": 3, "some-terms": 3,
  "title-fuzzy": 4, "text-fuzzy": 4,
};
/** A ranked source's row the local matcher can't place (its text matched in the service, or Jev chose it). */
const UNPLACED = 5;

/** A merged row: the row, the source it came from (`from`, its id), and the tier it matched at (lower is better). */
export type MergedRow<R extends SourceRow = SourceRow> = R & { from: string; tier: number; matches: number[] };

/**
 * Every source's rows as one list, best first: a preselected row (and a fallback row last); then source priority and tier (search-match's rungs, coarsened: as
 * typed in the label, held in the label, in the text, with typos, letters in order); then picked more often and more
 * lately; with the last pick breaking a frecency tie. A source's own order is kept among its rows (`ranked` keeps it entirely; the
 * rest are sorted by the same key first), and a row whose insert an earlier row has is left out. An unranked source's
 * row the matcher doesn't match at all is left out: one matcher decides what matches what's typed.
 */
export function mergeSourceAnswers<R extends SourceRow>(answers: readonly SourceAnswer<R>[], query: string, opts: { picks?: Record<string, PickRecord>; now?: Date; limit?: number } = {}): MergedRow<R>[] {
  const q = prepareSearchQuery(query, "completion"), now = opts.now ?? new Date(), picks = opts.picks ?? {};
  type Entry = { row: MergedRow<R>; pre: number; tier: number; f: number; at: string; p: number; score: number; i: number };
  const lists: Entry[][] = answers.map(a => {
    const entries: Entry[] = [];
    a.rows.forEach((row, i) => {
      const text = insertText(row.insert), pick = picks[pickId(text)];
      const m = q ? scoreSearchDocument({ id: row.id ?? text, title: row.label, text: row.filter ?? "" }, q) : null;
      if (q && !m && !a.source.ranked) return;
      const tier = !q ? 0 : m ? TIER[m.kind] : UNPLACED;
      entries.push({ row: { ...row, from: a.source.id, tier, matches: searchMatchSpans(row.label, query, "completion") } as MergedRow<R>, pre: row.preselect ? 0 : row.fallback ? 2 : 1, tier, f: frecency(pick, now), at: pick?.at ?? "", p: row.priority ?? a.source.priority ?? 0, score: m?.score ?? 0, i });
    });
    if (!a.source.ranked) {
      entries.sort((x, y) => x.pre - y.pre || y.p - x.p || x.tier - y.tier || y.f - x.f || y.at.localeCompare(x.at) || y.score - x.score || x.i - y.i);
      return entries;
    }
    // A ranked source's order stands: each row takes the best tier of any row it put after it, so an incidental row
    // (an anchor listed under its note) never sinks the strong ones after it, and the source compares with the others
    // as its best remaining row does. Among rows of one tier, what was picked before rises.
    let best = Infinity;
    for (let i = entries.length - 1; i >= 0; i--) {
      const e = entries[i]!;
      if (e.pre === 2) continue;   // a fallback row (a new page) lends nothing: it is offered last whatever it matches
      best = e.tier = Math.min(e.tier, best);
    }
    // Rows listed under another move with it, so a note picked before rises with its anchors.
    const groups: Entry[][] = [];
    for (const e of entries) if (e.row.under && groups.length) groups.at(-1)!.push(e); else groups.push([e]);
    groups.sort(([x], [y]) => x!.pre - y!.pre || x!.tier - y!.tier || y!.f - x!.f || y!.at.localeCompare(x!.at) || x!.i - y!.i);
    entries.splice(0, entries.length, ...groups.flat());
    for (const e of entries) e.row.tier = e.tier;
    return entries;
  });
  // Fuzzy guesses drop out when any source has every term as typed. Service-ranked notes remain its decision.
  if (q && lists.some(list => list.some(e => e.score >= 20000))) {
    for (const [i, list] of lists.entries()) if (!answers[i]!.source.ranked) lists[i] = list.filter(e => e.pre !== 1 || e.score >= 20000);
  }
  const better = (x: Entry, y: Entry) => x.pre - y.pre || y.p - x.p || x.tier - y.tier || y.f - x.f || y.at.localeCompare(x.at);
  const out: MergedRow<R>[] = [], seen = new Set<string>(), heads = lists.map(() => 0);
  let preselected = false;
  for (;;) {
    let best = -1;
    for (let s = 0; s < lists.length; s++) {
      const e = lists[s]![heads[s]!];
      if (e && (best < 0 || better(e, lists[best]![heads[best]!]!) < 0)) best = s;
    }
    if (best < 0) break;
    const e = lists[best]![heads[best]!++]!, text = insertText(e.row.insert);
    if (seen.has(text)) continue;
    seen.add(text);
    if (e.row.preselect) { if (preselected) e.row.preselect = undefined; preselected = true; }
    out.push(e.row);
    if (opts.limit !== undefined && out.length >= opts.limit) break;
  }
  return out;
}

// The facets tile's Matches (PIE-1443): the notes a selection leaves, as the one ListView draws them. The service groups
// them (`group=updated:recent`: Today, Yesterday, Previous 7 days, Previous 30 days, then months) and answers each note's
// excerpt; the notes carrying the tile's pin key come first under Pinned, from a question of their own. This file only
// turns those answers into rows: a header per group, and per note its title, its excerpt and its chips (the keys the
// tile shows, never a list in code) with when it was last changed. Nothing here groups, counts or narrows.
import type { QuestionGroup } from "@ep0ch/outline-core/protocol";
import { splitPropertyValue } from "@ep0ch/outline-core/property-grammar";
import { headedTitle, type Msg } from "../board";
import { propValues } from "../props";
import type { ListViewRow } from "../surface/list-view";
import { ago } from "../text";

/** The group the pinned notes are drawn under. */
export const PINNED = "Pinned";
const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** A group's value as a heading: `2026-09` is September 2026; no value is the notes without one. */
export function bucketLabel(value: string | null): string {
  if (value === null) return "No date";
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  return m ? `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}` : value;
}

/** A note's chips for `keys`, as written: `#tag` for a tag, `key: value` for anything else. */
export function chipsOf(m: Msg, keys: readonly string[]): string[] {
  return keys.flatMap(key => {
    const values = [...new Set(propValues(m, key).flatMap(v => splitPropertyValue(v)).concat(key === "tag" ? propValues(m, "tags").flatMap(v => splitPropertyValue(v)) : []))];
    return values.map(v => (key === "tag" ? `#${v}` : `${key}: ${v}`));
  });
}

/** A run of notes under a heading: the pinned ones, or one of the service's groups; `more` of its notes not read yet. */
export interface MatchGroup { value: string | null; label: string; count: number; notes: Msg[]; more: number }

/** The row that reads the rest of a group (PIE-1448): picking it asks the service for that group's notes. */
export const MORE = "\u0000more:";

/**
 * The groups as drawn: Pinned first (its own question's notes), then every one of the service's groups in its order,
 * each holding the returned notes its ids name and those read for it since (`extra`, by group label), and how many are
 * still to read. A pinned note isn't listed a second time under its day; ungrouped, one group of them all.
 */
export function matchGroups(notes: readonly Msg[], groups: readonly QuestionGroup[] | undefined, pinned: readonly Msg[], matched: number, extra: ReadonlyMap<string, readonly Msg[]> = new Map(), extraMore: ReadonlyMap<string, boolean> = new Map()): MatchGroup[] {
  const pins = new Set(pinned.map(m => m.id));
  const byId = new Map(notes.map(m => [m.id, m]));
  const out: MatchGroup[] = pinned.length ? [{ value: PINNED, label: PINNED, count: pinned.length, notes: [...pinned], more: 0 }] : [];
  if (!groups) { const mine = notes.filter(m => !pins.has(m.id)); return [...out, { value: null, label: "Matches", count: matched, notes: mine, more: 0 }]; }
  for (const g of groups) {
    const label = bucketLabel(g.value);
    const read = extra.get(label);
    const mine = read ? read.filter(m => !pins.has(m.id)) : g.ids.flatMap(id => (pins.has(id) ? [] : byId.has(id) ? [byId.get(id)!] : []));
    // Its count leaves out the pinned notes it holds, which are counted under Pinned.
    const count = g.count - g.ids.filter(id => pins.has(id)).length;
    // Read in full, a group has no more; read a page at a time past 1,000, it keeps its more row until the last page.
    if (count > 0) out.push({ value: g.value, label, count, notes: mine, more: read && !extraMore.get(label) ? 0 : Math.max(0, count - mine.length) });
  }
  return out;
}

import { MONTH_ABBREVIATIONS as MONTH_ABBR } from "@ep0ch/outline-core/figure-props";
/** When a note last changed, as a row says it: the time today, the day this year, the day and year before. */
export function whenOf(ms: number, now = new Date()): string {
  const at = new Date(ms), hm = `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
  if (at.toDateString() === now.toDateString()) return hm;
  return `${MONTH_ABBR[at.getMonth()]} ${at.getDate()}${at.getFullYear() === now.getFullYear() ? "" : ` ${at.getFullYear()}`} ${hm}`;
}

/**
 * The rows the ListView draws: a heading per group (it can't be picked), its notes as cards (title; the excerpt; the
 * chips, when it changed and where it lives), and a row that reads the rest of the group when there is more.
 */
export function matchRows(groups: readonly MatchGroup[], keys: readonly string[], pin: string, parentOf: (m: Msg) => string | undefined = () => undefined): ListViewRow<Msg>[] {
  return groups.flatMap(g => [
    { id: `\u0000group:${g.label}`, label: g.label, detail: String(g.count), mark: "▾", tone: "warn" as const, pick: false, group: g.label },
    ...g.notes.map((m): ListViewRow<Msg> => {
      const chips = chipsOf(m, keys.filter(k => k !== pin)), home = parentOf(m);
      return {
        id: m.id, label: headedTitle(m), mark: g.label === PINNED ? "◆" : "·", group: g.label, depth: 0, do: { open: m.id }, source: m,
        body: [...(m.excerpt ? [m.excerpt] : []), [...chips, [whenOf(m.updatedAt), ago(m.updatedAt), ...(home ? [`in ${home}`] : [])].join(" · ")].join("  ")],
      };
    }),
    ...(g.more ? [{ id: `${MORE}${g.label}`, label: `▸ ${g.more} more in ${g.label}`, mark: " ", tone: "dim" as const, pick: true, group: g.label }] : []),
  ]);
}

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

/** A run of notes under a heading: the pinned ones, or one of the service's groups. */
export interface MatchGroup { value: string | null; label: string; count: number; notes: Msg[] }

/**
 * The groups as drawn: Pinned first (its own question's notes), then the service's groups in its order, each holding the
 * returned notes its ids name. A pinned note isn't listed a second time under its day; ungrouped, one group of them all.
 */
export function matchGroups(notes: readonly Msg[], groups: readonly QuestionGroup[] | undefined, pinned: readonly Msg[], matched: number): MatchGroup[] {
  const pins = new Set(pinned.map(m => m.id));
  const byId = new Map(notes.map(m => [m.id, m]));
  const out: MatchGroup[] = pinned.length ? [{ value: PINNED, label: PINNED, count: pinned.length, notes: [...pinned] }] : [];
  if (!groups) return [...out, { value: null, label: "Matches", count: matched, notes: notes.filter(m => !pins.has(m.id)) }];
  for (const g of groups) {
    const mine = g.ids.flatMap(id => (pins.has(id) ? [] : byId.has(id) ? [byId.get(id)!] : []));
    if (mine.length) out.push({ value: g.value, label: bucketLabel(g.value), count: g.count, notes: mine });
  }
  return out;
}

/** The rows the ListView draws: a heading per group (it can't be picked), then its notes as cards. */
export function matchRows(groups: readonly MatchGroup[], keys: readonly string[], pin: string): ListViewRow<Msg>[] {
  return groups.flatMap(g => [
    { id: `\u0000group:${g.label}`, label: g.label, detail: String(g.count), mark: "▾", tone: "warn" as const, pick: false, group: g.label },
    ...g.notes.map((m): ListViewRow<Msg> => {
      const chips = chipsOf(m, keys.filter(k => k !== pin));
      return {
        id: m.id, label: headedTitle(m), mark: g.label === PINNED ? "◆" : "·", group: g.label, depth: 0, do: { open: m.id }, source: m,
        body: [...(m.excerpt ? [m.excerpt] : []), [...chips, ago(m.updatedAt)].join("  ")],
      };
    }),
  ]);
}

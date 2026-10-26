// A note's title as every client heads it (PIE-809, PIE-1356): a note with a Work ID shows it first, `HUB-011 · <title>`,
// and the metadata line no longer carries it. Many titles already start with their Work ID (`PIE-809 — A note's
// title…`): it isn't said twice. This is the one rule for every place a note's name is drawn (the reader's header,
// the tile bar and its tabs, spines, lists, completion rows, the power bar, backlinks, `ep0ch show`, the publisher's
// page title): `workIdTitle` gives the two parts, for a client that draws the ID in its accent; `headedTitle` the one
// string. A room too short cuts the title from its end, so the ID always shows. A change to it bumps GRAMMAR.
import { parsePropertyRecords } from "./property-parse";

/** The Work ID to put first (null when the note has none), and the title without it at its start. */
export function workIdTitle(title: string, workId: string | null | undefined): { workId: string | null; title: string } {
  const id = workId?.trim();
  if (!id) return { workId: null, title };
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // The Work ID at the start, then a dash, colon or dot (or only a blank), as titles write it.
  const rest = title.replace(new RegExp(`^\\s*${esc}(?:\\s*[—–:·-]\\s*|\\s+|$)`, "i"), "");
  return { workId: id, title: rest };
}

/** A note's title as one string: `HUB-062 · <title>` with a Work ID (said once), the title as it is without one. */
export function headedTitle(title: string, workId: string | null | undefined): string {
  const named = workIdTitle(title, workId);
  return named.workId ? (named.title ? `${named.workId} · ${named.title}` : named.workId) : title;
}

/** A note's Work ID: its first block-scope `[work-id::…]`, read from its `properties` when given, else its text. */
export function workIdOf(source: { text?: string; properties?: readonly ({ key: string; values: readonly string[] } | { key: string; value: string })[] }): string | undefined {
  const property = (source.properties ?? parsePropertyRecords(source.text ?? "").filter(p => p.scope === "block")).find(p => p.key.toLowerCase() === "work-id");
  const value = property ? ("values" in property ? property.values[0] : property.value) : undefined;
  return value?.trim() || undefined;
}

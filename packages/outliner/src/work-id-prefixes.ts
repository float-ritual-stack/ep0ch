// The Work ID prefixes an outline uses, which every read that resolves a reference asks for (`workIdAllocatorStatus`):
// one scan per change to the outline (PIE-1546: it was a door's costliest small read). Held by the outline's sequence: a
// write rolled back after asking leaves its answer for that sequence, a suggestion list at worst, until the next change.
import type { Database } from "bun:sqlite";

const memo = new WeakMap<Database, { sequence: number; asked: string; prefixes: string[] }>();

/**
 * The prefixes a ticket key may have to be one here: the allocator's, the reserved ids', the `[work-id::]` values
 * notes carry (an imported or echoed item), the pages named like a key (`[page::PC-7]`) and the ticket pages' keys
 * (`[jira::KEY-1]`). Any other `LETTERS-digits` (a synth's name, `FM-1`) is plain text.
 */
export function workIdPrefixesInUse(database: Database, sequence: number, configured: string | null, observed: readonly string[], ticketPages: () => Iterable<string>): string[] {
  const asked = `${configured ?? ""}\0${observed.join("\0")}`;
  const held = memo.get(database);
  if (held?.sequence === sequence && held.asked === asked) return held.prefixes;
  const prefixes = new Set<string>([...(configured ? [configured] : []), ...observed]);
  const values = database.query(
    "SELECT DISTINCT upper(trim(property.value)) AS value FROM block_properties property JOIN blocks block ON block.id = property.block_id WHERE property.scope = 'block' AND property.key = 'work-id' AND block.effective_deleted_root_id IS NULL",
  ).all() as Array<{ value: string }>;
  const pages = database.query(
    "SELECT upper(display_address) AS value FROM page_addresses WHERE kind IN ('page', 'alias')",
  ).all() as Array<{ value: string }>;
  for (const key of [...values, ...pages].map((row) => row.value).concat([...ticketPages()])) {
    const match = /^([A-Z][A-Z0-9]{0,15})-\d+$/.exec(key);
    if (match) prefixes.add(match[1]!);
  }
  const sorted = [...prefixes].sort();
  memo.set(database, { sequence, asked, prefixes: sorted });
  return sorted;
}

// What a query being typed can become next (the views' grammar, `block-query.ts`'s atoms): the words typed kept, the
// last clause offered as the outline's own properties and values. The settings card's picker and the service's
// completion of a `query`-typed prop (completion-sources.ts) both ask this one. Pure: the catalog is passed in.

/** `properties.catalog`: the keys starting with `prefix` (each value counted), or `key`'s values starting with it. */
export type PropertyCatalog = (key: string | undefined, prefix: string) => Promise<readonly { key: string; value: string; count: number }[]>;

/**
 * A query being built: the words typed, the last clause offered as the outline's own properties and values
 * (`type=request`, `child:triage=done`), the rest kept. Never a list in code: whatever keys the notes have.
 */
export async function querySuggestions(typed: string, catalog: PropertyCatalog): Promise<{ value: string; detail: string }[]> {
  const m = /^(.*?)(\S*)$/s.exec(typed)!;
  const before = m[1]!, token = m[2]!;
  // NOT, AND and OR are words of their own (kept in `before`); a clause may open a group and be a child's.
  const rel = /^(\(*(?:child(?:>=\d+)?:)?)(.*)$/i.exec(token)!;
  const lead = rel[1]!, clause = rel[2]!;
  const eq = clause.indexOf("=");
  const rows = eq >= 0
    ? await catalog(clause.slice(0, eq), clause.slice(eq + 1))
    : await catalog(undefined, clause);
  const seen = new Set<string>();
  const out: { value: string; detail: string }[] = [];
  for (const r of rows) {
    const value = `${before}${lead}${r.key}=${r.value}`;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push({ value, detail: `${r.count} note${r.count === 1 ? "" : "s"}` });
  }
  return out;
}

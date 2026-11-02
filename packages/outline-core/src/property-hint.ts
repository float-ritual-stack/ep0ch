function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0]!;
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const kept = row[j]!;
      row[j] = Math.min(row[j]! + 1, row[j - 1]! + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = kept;
    }
  }
  return row[b.length]!;
}

/** The same spelling hint for a Question and a picker over its facets. */
export function missingPropertyHint(key: string, known: readonly string[]): string {
  const nearest = known.map(k => ({ k, d: distance(key, k) })).sort((a, b) => a.d - b.d || a.k.localeCompare(b.k)).slice(0, 3).map(x => x.k);
  return `no notes have ${key}${nearest.length ? `; nearest: ${nearest.join(", ")}` : ""}`;
}

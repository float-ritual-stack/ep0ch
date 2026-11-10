// Which `@name` line is which when the same words are asked twice in a note (PIE-1722). A line's request key is its words
// and how many lines above it say the same (agent-requests.ts requestLines), so a line written above an answered one in
// the same words would take that line's key and its answer. Here an edit is read as an edit: the lines both texts keep (a
// longest common run of lines) keep their request, and only the line written now is new.

/** Each line index of `before` that `after` keeps, mapped to its index there (the longest common subsequence of lines). */
export function keptLines(before: readonly string[], after: readonly string[]): Map<number, number> {
  // The common head and tail first: most edits touch a few lines, so the table is small.
  let head = 0;
  while (head < before.length && head < after.length && before[head] === after[head]) head++;
  let tail = 0;
  while (tail < before.length - head && tail < after.length - head && before[before.length - 1 - tail] === after[after.length - 1 - tail]) tail++;
  const kept = new Map<number, number>();
  for (let i = 0; i < head; i++) kept.set(i, i);
  for (let i = 0; i < tail; i++) kept.set(before.length - 1 - i, after.length - 1 - i);
  const a = before.slice(head, before.length - tail), b = after.slice(head, after.length - tail);
  if (!a.length || !b.length || a.length * b.length > 4_000_000) return kept;
  const run: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) run[i]![j] = a[i] === b[j] ? run[i + 1]![j + 1]! + 1 : Math.max(run[i + 1]![j]!, run[i]![j + 1]!);
  for (let i = 0, j = 0; i < a.length && j < b.length;) {
    if (a[i] === b[j]) { kept.set(head + i, head + j); i++; j++; }
    else if (run[i + 1]![j]! >= run[i]![j + 1]!) i++;
    else j++;
  }
  return kept;
}

/**
 * The requests an edit moved among lines saying the same words: old key → new key. A line both texts keep whose key
 * changed (a line in the same words was written above it, or taken out above it) is the same request under its new key.
 * Lines whose words appear once are never in it.
 */
export function movedRequests(before: { text: string; lines: readonly { line: number; requestKey: string; wordsKey: string }[] }, after: { text: string; lines: readonly { line: number; requestKey: string; wordsKey: string }[] }): Map<string, string> {
  const moved = new Map<string, string>();
  const repeated = (lines: readonly { wordsKey: string }[]) => lines.some((l, i) => lines.findIndex(o => o.wordsKey === l.wordsKey) !== i);
  if (!repeated(before.lines) && !repeated(after.lines)) return moved;
  const kept = keptLines(before.text.split("\n"), after.text.split("\n"));
  const at = new Map(after.lines.map(l => [l.line, l]));
  for (const old of before.lines) {
    const now = kept.has(old.line) ? at.get(kept.get(old.line)!) : undefined;
    if (now && now.wordsKey === old.wordsKey && now.requestKey !== old.requestKey) moved.set(old.requestKey, now.requestKey);
  }
  return moved;
}

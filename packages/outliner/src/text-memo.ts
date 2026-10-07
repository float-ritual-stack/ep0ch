/*
 * Memos for what is a pure function of a note's text (PIE-625). A tree read, a view and a query each derive titles and
 * labels from every note's text, and every client asks again after every change: computed once per text, a read of the
 * whole outline costs a lookup per note instead of a parse. Keyed by the text itself, so an edit is a new key and
 * nothing is ever invalidated; the oldest entries go when it is full. Only for values nobody mutates (strings).
 */
export function textMemo<T extends string | undefined>(compute: (text: string) => T, limit = 8_192): (text: string) => T {
  const memo = new Map<string, T>();
  return (text: string): T => {
    if (memo.has(text)) {
      const value = memo.get(text) as T;
      // Most recently used goes last, so the oldest is first out.
      memo.delete(text);
      memo.set(text, value);
      return value;
    }
    const value = compute(text);
    memo.set(text, value);
    if (memo.size > limit) memo.delete(memo.keys().next().value!);
    return value;
  };
}

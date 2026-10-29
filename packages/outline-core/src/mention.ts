// An `@name` in a comment: who it is addressed to. The one matcher: the gateway's thread inbox (`outline_threads
// mentions:`) and the Claude mod's addressed check (PIE-1404) both read it, so "is this addressed to loki" has one
// answer. A word: `@loki` is loki, `@loki-sr` and `@lokis` aren't, and an address in an email (`a@loki`) isn't either.

/** Whether a text mentions `@name` (the @ is optional in the name), as a word, ignoring case. */
export function mentions(text: string, name: string): boolean {
  const bare = name.trim().replace(/^@/, "");
  return !!bare && new RegExp(`(^|[^\\w])@${bare.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w-])`, "i").test(text);
}

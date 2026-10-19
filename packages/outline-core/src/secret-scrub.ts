/** Terminal escapes and control characters (all but newline and tab) out. */
export function plainText(text: string): string {
  return text
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "")
    .replace(/\x1b[@-_]/g, "")
    .replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
}

/** The forms of a secret the scrub finds: as it is, base64 and URL-encoded; longest first. */
export function secretForms(secrets: readonly string[]): string[] {
  const forms = new Set<string>();
  for (const secret of secrets) {
    if (!secret) continue;
    forms.add(secret);
    forms.add(Buffer.from(secret).toString("base64"));
    forms.add(encodeURIComponent(secret));
  }
  return [...forms].sort((a, b) => b.length - a.length);
}

export function scrubCredentials(
  value: unknown,
  secrets: readonly string[],
  depth = 0,
  failure: (message: string) => Error = message => new Error(message),
): unknown {
  if (depth > 64) throw failure("response exceeds nesting limit");
  if (typeof value === "string") {
    if (!secrets.length) return value;
    // Escapes out first, so a value split by one ("ab\x1b[0mcd") is found whole; then each form of each value.
    value = plainText(value);
    for (const token of secretForms(secrets))
      value = (value as string).split(token).join("[redacted]");
    return value;
  }
  if (Array.isArray(value))
    return value.map((item) => scrubCredentials(item, secrets, depth + 1, failure));
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        scrubCredentials(key, secrets, depth + 1, failure),
        scrubCredentials(item, secrets, depth + 1, failure),
      ]),
    );
  return value;
}

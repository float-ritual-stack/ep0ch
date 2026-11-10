/**
 * An id or a word a request names (a mark id, a client id, a workflow command): `value` trimmed, refused unless it is a
 * string of 1 to `maximum` characters with no control characters. `label` names it in the refusal.
 */
export function printable(value: unknown, label: string, maximum = 500): string {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error(`${label} must be 1-${maximum} printable characters`);
  }
  return normalized;
}

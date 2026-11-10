/** `text` on one line (runs of white space as one space), cut to `max` characters with an ellipsis when longer. */
export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

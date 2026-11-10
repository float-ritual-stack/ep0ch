// The publisher's one HTML escaper (PIE-1647): text and attribute values alike, `& < > " '`. Every page part imports
// it from here rather than writing its own. It is not `Bun.escapeHTML`, which writes `'` as `&#x27;`: the pages have
// always said `&#39;`, and publish-components' unescape reads that spelling back.

const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

/** `text` safe as HTML text or inside a quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ENTITIES[character]!);
}

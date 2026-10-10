/**
 * An extension's own HTML (a component's `targets.html`) kept to the page's markup: the tags a reading page uses,
 * `class`, and safe links, nothing else. Scripts, styles, frames, forms, event handlers, `style` and `id` attributes
 * and comments never reach a page; what they held is dropped (a script's text, a style sheet) or kept as text (an
 * unknown tag's words). Tags are balanced, so an extension's markup can't close the page's own around it.
 */

const ALLOWED = new Set([
  "a", "article", "b", "blockquote", "br", "code", "dd", "del", "details", "div", "dl", "dt", "em", "figcaption",
  "figure", "footer", "h1", "h2", "h3", "h4", "h5", "h6", "header", "hr", "i", "img", "kbd", "li", "mark", "meter",
  "ol", "p", "pre", "s", "section", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "th",
  "thead", "tr", "u", "ul",
]);
const VOID = new Set(["br", "hr", "img"]);
/** Dropped with everything inside them. */
const DROPPED = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "svg", "math", "title", "head", "textarea", "select"]);
const SAFE_HREF = /^(?:https?:|mailto:|\/|#|\.{0,2}\/|[^:]*$)/i;
const SAFE_SRC = /^(?:https?:|\/|\.{0,2}\/|[^:]*$)/i;
const NUMBER = /^-?\d+(?:\.\d+)?$/;

const TOKEN = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^\s"'>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>|[<>"']|&(?!(?:#\d{1,7}|#x[0-9a-f]{1,6}|[a-z][a-z0-9]{1,31});)/gi;
const ATTRIBUTE = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
/** An attribute's value as written, its entities read (so `&#106;avascript:` is seen for what it is). */
const decoded = (value: string) => value
  .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000))
  .replace(/&#(\d+);?/g, (_, decimal: string) => String.fromCodePoint(Number(decimal) % 0x110000))
  .replace(/&(?:colon|tab|newline);/gi, (entity) => ({ "&colon;": ":", "&tab;": "\t", "&newline;": "\n" })[entity.toLowerCase()]!)
  .replace(/&amp;/gi, "&")
  .replace(/[\u0000- ]+/g, "");

function attributes(tag: string, raw: string): string {
  const kept: string[] = [];
  for (const match of raw.matchAll(ATTRIBUTE)) {
    const name = match[1]!.toLowerCase();
    const value = match[2] ?? match[3] ?? match[4] ?? "";
    if (name === "class") {
      const classes = value.split(/\s+/).filter((word) => /^[A-Za-z][\w-]{0,63}$/.test(word));
      if (classes.length) kept.push(`class="${classes.join(" ")}"`);
    } else if (name === "href" && tag === "a" && SAFE_HREF.test(decoded(value))) kept.push(`href="${escape(value)}"`);
    else if (name === "src" && tag === "img" && SAFE_SRC.test(decoded(value))) kept.push(`src="${escape(value)}"`);
    else if ((name === "alt" || name === "title") && value) kept.push(`${name}="${escape(value)}"`);
    else if ((name === "colspan" || name === "rowspan") && /^\d{1,3}$/.test(value)) kept.push(`${name}="${value}"`);
    else if (tag === "meter" && (name === "value" || name === "min" || name === "max") && NUMBER.test(value)) kept.push(`${name}="${value}"`);
    else if (tag === "details" && name === "open") kept.push("open");
  }
  if (tag === "a" && kept.some((attribute) => attribute.startsWith("href="))) kept.push('rel="noopener noreferrer"');
  return kept.length ? ` ${kept.join(" ")}` : "";
}

export function safeExtensionHtml(source: string): string {
  let out = "", cursor = 0;
  const open: string[] = [];
  let dropping: string | null = null;
  for (const match of source.matchAll(TOKEN)) {
    const text = source.slice(cursor, match.index);
    cursor = match.index + match[0].length;
    if (!dropping) out += text;
    const [whole, slash, rawName, rawAttributes] = match;
    if (!rawName) {
      // A comment goes; a stray `<`, `>`, quote or `&` is text.
      if (!dropping && !whole.startsWith("<!--")) out += escape(whole);
      continue;
    }
    const tag = rawName.toLowerCase();
    if (dropping) {
      if (slash && tag === dropping) dropping = null;
      continue;
    }
    if (DROPPED.has(tag)) {
      if (!slash && !whole.endsWith("/>")) dropping = tag;
      continue;
    }
    if (!ALLOWED.has(tag)) continue;
    if (slash) {
      const at = open.lastIndexOf(tag);
      if (at < 0) continue;
      while (open.length > at) out += `</${open.pop()}>`;
      continue;
    }
    out += `<${tag}${attributes(tag, rawAttributes ?? "")}>`;
    if (!VOID.has(tag)) open.push(tag);
  }
  if (!dropping) out += source.slice(cursor);
  while (open.length) out += `</${open.pop()}>`;
  return out;
}

// Text helpers shared by the BBS screens and the desk panes.
import { balanceStyles, balanceTags, C, fg, MARKS, RESET, stripTags, styleMarks, width } from "./style";
import { isEscapedAt, propertyTokenPattern } from "./vendor/property-grammar";

export const ago = (ms: number) => {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  if (s < 90) return `${Math.round(s)}s`;
  if (s < 5400) return `${Math.round(s / 60)}m`;
  if (s < 129600) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
};
export const bbsDate = (ms: number) => {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getMonth() + 1)}-${p(d.getDate())}-${String(d.getFullYear()).slice(2)} (${p(d.getHours())}:${p(d.getMinutes())})`;
};

/** The first `w` visible characters of `s` (link tags ride along) and the rest. */
function cut(s: string, w: number): [string, string] {
  const chars = [...s];
  let n = 0, i = 0;
  for (; i < chars.length && n < w; i++) if (!/^[\u{100000}-\u{10FFFD}\uE000-\uE008]$/u.test(chars[i]!)) n++;
  return [chars.slice(0, i).join(""), chars.slice(i).join("")];
}

/** Visible characters: link tags and presentation marks (src/style.ts) take no room. */
const len = (s: string) => (NO_ROOM.test(s) ? [...stripTags(s).replace(MARKS, "")] : [...s]).length;
const NO_ROOM = /[\uE000-\uE008\u{100000}-\u{10FFFD}]/u;

/** `text` in rows of at most `w` visible characters. A width under 1 (a narrow pane, deep indentation) wraps at 1: `cut` must always make progress. */
export function wrap(text: string, w: number): string[] {
  w = w >= 1 ? Math.floor(w) : 1;
  const out: string[] = [];
  for (const raw of text.split("\n")) {
    if (!raw.length) { out.push(""); continue; }
    // `n`: the line's width so far, kept as words are added (measuring the whole line for each word made a
    // long paragraph's wrap quadratic).
    let line = "", n = 0;
    for (const word of raw.split(/(\s+)/)) {
      const wl = len(word);
      if (n + wl > w && line.trim()) { out.push(line.trimEnd()); line = word.trimStart(); n = len(line); }
      else { line += word; n += wl; }
      while (n > w) { const [head, tail] = cut(line, w); out.push(head); line = tail; n = len(line); }
    }
    out.push(line);
  }
  // A link cut by the wrap is closed at each line's end and re-opened on the next, and a bold or italic
  // span carries on, so each row stands alone.
  return balanceStyles(balanceTags(out));
}

/** Colour one body line the way a BBS message reader would: quotes, headings, links, properties. */
/** `literal`: the line is in a literal region (PIE-422), where `[key::value]` is text, not a property. */
export function colourBody(line: string, literal = false): string {
  if (/^#{1,6} /.test(line)) return fg(C.white) + styleMarks(line) + RESET;
  if (/^> ?/.test(line)) return fg(C.lgreen) + styleMarks(line) + RESET;
  if (/^\s*[-*] /.test(line)) line = line.replace(/^(\s*)([-*]) /, `$1${fg(C.lcyan)}∙${fg(C.grey)} `);
  return fg(C.grey) + line
    .replace(/\[\[([^\]]+)\]\]/g, `${fg(C.lcyan)}[[$1]]${fg(C.grey)}`)
    .replace(/\(\(([0-9a-f-]{8})[0-9a-f-]*\)\)/g, `${fg(C.cyan)}(($1…))${fg(C.grey)}`)
    .replace(propertyTokenPattern(), (all: string, k: string, v: string, at: number, s: string) => literal || isEscapedAt(s, at) ? all : `${fg(C.dark)}[${fg(C.brown)}${k}${fg(C.dark)}::${fg(C.yellow)}${v}${fg(C.dark)}]${fg(C.grey)}`)
    .replace(/`([^`]+)`/g, `${fg(C.lmagenta)}$1${fg(C.grey)}`)
    // Links already resolved for read mode (src/refs.ts): the title or label, or an unlinked missing target.
    .replace(/\uE000/g, fg(C.lcyan)).replace(/\uE002/g, fg(C.brown)).replace(/\uE001/g, fg(C.grey))
    // Inline Markdown (src/inline.ts): bold, italic, strikethrough, as Detail draws them.
    .replace(/[\uE003-\uE008]+/g, m => styleMarks(m)) + RESET;
}

export const rule = (w: number, label = "") => {
  const l = label ? `${fg(C.blue)}──(${fg(C.lcyan)} ${label} ${fg(C.blue)})` : "";
  return fg(C.blue) + l + "─".repeat(Math.max(0, w - width(l))) + RESET;
};

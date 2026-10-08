// Inline Markdown in read mode, as Detail draws it: `**strong**` / `__strong__` bold, `*em*` / `_em_`
// italic, `~~del~~` / `~del~` struck through, and `\*` an escaped character. Detail parses with marked
// (pi-herdr-outliner src/attributed-markdown.ts); the door has no Markdown dependency, so this mirrors
// CommonMark's delimiter-run rules (flanking, `_` not inside words, the rule of three) and
// test/inline.test.ts checks it against marked itself. Code spans and links are atoms: emphasis may wrap
// them but never reaches inside. The result carries style marks (src/style.ts) that colourBody turns into
// SGR after wrapping.
import { STYLE } from "./style";

/** A link as presentLinks marks it (colour on, its text and tags, colour off), or a code span. */
const ATOM = /[][^]*|(`+)[^`]*?\1(?!`)/g;
const HOLD = "￼";
/**
 * The escapes resolved here: a delimiter or a backslash. Detail resolves every ASCII punctuation escape; the
 * door leaves the others as typed, since its own colouring still reads `[`, `(`, `#` from the text.
 */
const ESCAPABLE = /[*_~\\]/;
const WS = /\s/u;
// CommonMark counts Unicode punctuation and symbols; an atom (a link, a code span) stands in as a symbol.
const PUNCT = /[\p{P}\p{S}]/u;

interface Run { ch: "*" | "_" | "~"; node: number; len: number; orig: number; open: boolean; close: boolean }

/** `text` (one line, links already presented) with its emphasis as style marks and its escapes resolved. */
export function emphasis(text: string): string {
  if (!/[*_~\\]/.test(text) || text.includes(HOLD)) return text;
  const atoms: string[] = [];
  const held = text.replace(ATOM, a => { atoms.push(a); return HOLD; });
  // Nodes: plain text, and each delimiter run on its own so a match can shorten it.
  const nodes: { text: string; before: string[]; after: string[] }[] = [];
  const runs: Run[] = [];
  const chars = [...held];
  let buf = "";
  const flush = () => { if (buf) { nodes.push({ text: buf, before: [], after: [] }); buf = ""; } };
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]!;
    if (c === "\\" && i + 1 < chars.length && ESCAPABLE.test(chars[i + 1]!)) { buf += chars[++i]!; continue; }
    if (c !== "*" && c !== "_" && c !== "~") { buf += c; continue; }
    let j = i;
    while (j < chars.length && chars[j] === c) j++;
    const len = j - i;
    const prev = i > 0 ? chars[i - 1]! : " ", next = j < chars.length ? chars[j]! : " ";
    const prevWs = WS.test(prev), nextWs = WS.test(next), prevP = PUNCT.test(prev), nextP = PUNCT.test(next);
    const left = !nextWs && (!nextP || prevWs || prevP);
    const right = !prevWs && (!prevP || nextWs || nextP);
    let open = left, close = right;
    if (c === "_") { open = left && (!right || prevP); close = right && (!left || nextP); }
    // Strikethrough is one or two tildes; a longer run is text.
    if (c === "~" && len > 2) { open = close = false; }
    flush();
    nodes.push({ text: c.repeat(len), before: [], after: [] });
    if (open || close) runs.push({ ch: c, node: nodes.length - 1, len, orig: len, open, close });
    i = j - 1;
  }
  flush();
  // CommonMark's "process emphasis": each closer, from the left, takes the nearest opener it can.
  const bottom = new Map<string, number>();
  for (let k = 0; k < runs.length; ) {
    const closer = runs[k]!;
    if (!closer.close) { k++; continue; }
    const key = `${closer.ch}${closer.open}${closer.orig % 3}`;
    let o = k - 1;
    for (; o >= (bottom.get(key) ?? 0); o--) {
      const opener = runs[o]!;
      if (opener.ch !== closer.ch || !opener.open) continue;
      if (closer.ch === "~") { if (opener.len === closer.len) break; continue; }
      if ((opener.close || closer.open) && (opener.orig + closer.orig) % 3 === 0 && !(opener.orig % 3 === 0 && closer.orig % 3 === 0)) continue;
      break;
    }
    if (o < (bottom.get(key) ?? 0)) {
      bottom.set(key, k);
      if (!closer.open) runs.splice(k, 1); else k++;
      continue;
    }
    const opener = runs[o]!;
    const n = closer.ch === "~" ? closer.len : opener.len >= 2 && closer.len >= 2 ? 2 : 1;
    const [on, off] = closer.ch === "~" ? STYLE.strike : n === 2 ? STYLE.bold : STYLE.italic;
    opener.len -= n; closer.len -= n;
    nodes[opener.node]!.text = nodes[opener.node]!.text.slice(n);
    nodes[closer.node]!.text = nodes[closer.node]!.text.slice(n);
    // The innermost match sits next to the text; later (outer) ones go outside it.
    nodes[opener.node]!.after.unshift(on);
    nodes[closer.node]!.before.push(off);
    // Delimiters between them can't match across this span any more.
    runs.splice(o + 1, k - o - 1);
    k = o + 1;
    if (opener.len === 0) { runs.splice(o, 1); k--; }
    if (closer.len === 0) runs.splice(k, 1);
  }
  let out = nodes.map(n => n.before.join("") + n.text + n.after.join("")).join("");
  let a = 0;
  out = out.replace(new RegExp(HOLD, "g"), () => atoms[a++] ?? HOLD);
  return out;
}

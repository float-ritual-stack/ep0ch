// What a mark is, on one line, with no I/O: the words it quotes, the chips it writes and takes off, and what counts as
// answered. The judgment (does this line ask?) is the service's (`blocks.asks`); this is only where it lands.

export const NEEDS = "needs", MAYBE = "maybe-needs";
/** Beside a chip this extension wrote, and only there: what may be taken off. A hand-written `[needs::…]` never has it. */
export const DERIVED = "[asks.derived::review]";
const WORDS = 100;

const PAIR = /[ \t]*\[(?:needs|maybe-needs)::[^\]\n]*\][ \t]*\[asks\.derived::[^\]\n]*\]/g;
const CHIP = /\[[\w.-]+::[^\]\n]*\]/g;
const LEAD = /^[ \t>]*(?:[-*+][ \t]+(?:\[.\][ \t]+)?|\d+[.)][ \t]+)?/;
const ANSWERED = /^[ \t>]*(?:[-*+]|\d+[.)])[ \t]+\[[^ \]]\]/;
const INDENT = /^[ \t>]*/;

/** A line's own words: no chips, no list mark, links as their labels, nothing a chip's value can't hold. */
export function wordsOf(line: string): string {
  const flat = line.replace(CHIP, " ").replace(LEAD, "")
    .replace(/\(\([^)|]*\|([^)]*)\)\)/g, "$1").replace(/\(\([^)]*\)\)/g, " ")
    .replace(/\[\[([^\]|]*)(?:\|([^\]]*))?\]\]/g, (_, page: string, label?: string) => label ?? page)
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1").replace(/[`*[\]]/g, "")
    .replace(/\s+/g, " ").trim();
  return flat.length > WORDS ? `${flat.slice(0, WORDS - 1).trimEnd()}…` : flat;
}

/** The chip a line gets: the one `needs` the waiting list reads, or the unsure lane's. */
export const chipFor = (reads: "yes" | "unsure", line: string) => reads === "yes" ? `[${NEEDS}::sysop: ${wordsOf(line)}]` : `[${MAYBE}::sysop]`;

/** A line a chip may be written on: never one that already says it, by hand or by us. */
export const carries = (line: string) => !/\[(?:needs|maybe-needs)::/.test(line);

export const withMark = (line: string, chip: string) => `${line.trimEnd()} ${chip} ${DERIVED}`;
export const isMarked = (line: string) => line.includes("[asks.derived::");
export const withoutMark = (line: string) => line.replace(PAIR, "");
/** A ticked box, any mark but the open one. */
export const isAnswered = (line: string) => ANSWERED.test(line);

/** The lines right under line `i` that sit deeper than it: what a reply under it adds to. */
export function linesUnder(lines: readonly string[], i: number): number {
  const depth = INDENT.exec(lines[i]!)![0].length;
  let n = 0;
  for (let k = i + 1; k < lines.length; k++) {
    if (!lines[k]!.trim()) { if (n) break; continue; }
    if (INDENT.exec(lines[k]!)![0].length <= depth) break;
    n++;
  }
  return n;
}

/** Stable for the same words, whatever chips or marks the line has since: what "this line again" means. */
export function hashOf(line: string): string {
  return Bun.hash(wordsOf(line).toLowerCase()).toString(36);
}

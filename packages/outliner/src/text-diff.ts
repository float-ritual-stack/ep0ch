/*
 * A change to a text as lines a client draws (outline-core's `DiffPrimitive`): the service finds what changed, once,
 * and a client that draws a proposal or a revision diffs nothing itself (packages/native/docs/DESIGN.md, W6). The
 * lines are the `diff` package's (`diffLines`, the door's own for its revision compare); a long run both sides
 * share is said in a line of words instead of listed.
 */
import { diffLines } from "diff";
import type { DiffLine, DiffPrimitive } from "@ep0ch/outline-core/note-page";

/** How many lines the same are kept each side of a change; a longer run is said, not listed. */
const AROUND = 3;

const same = (n: number): DiffLine => ({ op: "skip", text: `${n} line${n === 1 ? "" : "s"} the same` });

/** `lines` with each run the two sides share cut to `AROUND` lines beside a change, the rest said in one `skip` line. */
function folded(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = [];
  for (let i = 0; i < lines.length;) {
    if (lines[i]!.op !== "same") { out.push(lines[i++]!); continue; }
    let end = i;
    while (end < lines.length && lines[end]!.op === "same") end++;
    // A run at the very start keeps only its tail, one at the very end only its head.
    const head = i === 0 ? 0 : AROUND, tail = end === lines.length ? 0 : AROUND, run = end - i;
    if (run <= head + tail + 1) out.push(...lines.slice(i, end));
    else out.push(...lines.slice(i, i + head), same(run - head - tail), ...lines.slice(end - tail, end));
    i = end;
  }
  return out;
}

/** What turns `from` into `to`, line by line. `sides` names the two in words ("revision 3", "the note now"). */
export function textDiff(from: string, to: string, sides: { from?: string; to?: string } = {}): DiffPrimitive {
  const lines: DiffLine[] = [];
  let added = 0, removed = 0;
  // Both end in a line break, so a last line isn't read as changed for want of one.
  for (const part of diffLines(`${from}\n`, `${to}\n`)) {
    const texts = part.value.replace(/\n$/, "").split("\n");
    const op = part.added ? "add" : part.removed ? "del" : "same";
    if (op === "add") added += texts.length; else if (op === "del") removed += texts.length;
    for (const text of texts) lines.push({ op, text });
  }
  return { type: "diff", ...sides, lines: added || removed ? folded(lines) : [{ op: "skip", text: "The same text." }], added, removed };
}

/** Several changes as one: each under a line of words that says where it is. */
export function diffsJoined(parts: readonly { head?: string; diff: DiffPrimitive }[], sides: { from?: string; to?: string } = {}): DiffPrimitive {
  return {
    type: "diff", ...sides,
    lines: parts.flatMap(part => [...(part.head ? [{ op: "skip" as const, text: part.head }] : []), ...part.diff.lines]),
    added: parts.reduce((n, part) => n + part.diff.added, 0), removed: parts.reduce((n, part) => n + part.diff.removed, 0),
  };
}

// `::graph-annotate`: code with numbered callouts. A line ending in a `// (1)` or `# (1)` marker (also `-- (1)`,
// `; (1)`) is bright with `[1]` in its gutter, the rest dim; the ordered list after the fence says what each is.
//
//   ::graph-annotate                     code: |                         (the YAML form)
//   ---                                    const host = "float-2" // (1)
//   title: the snapshot                  notes: [the box it runs on]
//   ---
//   ```sh
//   sqlite3 "$db" ".backup '$stage'"  # (1)
//   restic backup "$stage"            # (2)
//   ```
//   1. a consistent copy, never the live file
//   2. encrypted, to the storage box
//   ::
import { ellipsize, fg, RESET } from "../style";
import { wrap } from "../text";
import type { Markdown } from "./markdown";
import { ACCENT, DIM, HI, INK, type Props } from "./palette";

const MARKER = /\s*(?:\/\/|#|--|;)\s*\((\d+)\)\s*$/;

export function drawAnnotate(p: Props, w: number): string[] {
  const code = String(p.code ?? "").replace(/\n$/, "").split("\n");
  const notes: string[] = (p.notes ?? []).map(String);
  const gw = 4;
  const out = code.map(line => {
    const m = MARKER.exec(line);
    const text = ellipsize(m ? line.slice(0, m.index) : line, Math.max(4, w - gw));
    return m ? fg(ACCENT) + `[${m[1]}]`.padEnd(gw) + fg(HI) + text + RESET : " ".repeat(gw) + fg(DIM) + text + RESET;
  });
  if (notes.length) {
    out.push("");
    notes.forEach((n, i) => wrap(n, Math.max(6, w - gw)).forEach((l, j) => out.push((j ? " ".repeat(gw) : fg(ACCENT) + `[${i + 1}]`.padEnd(gw)) + fg(INK) + l + RESET)));
  }
  return out;
}

/** The first fence is the code; the ordered list after it, the notes (numbered as written, or in order). */
export function annotateMarkdown(md: Markdown): Props {
  const fence = md.fences[0];
  const listed = md.rows.filter(r => r.depth === 0);
  const notes: string[] = [];
  listed.forEach((r, i) => { notes[(r.ordinal ?? i + 1) - 1] = r.text + (r.note ? ` — ${r.note}` : ""); });
  return { ...(fence ? { code: fence.lines.join("\n"), lang: fence.lang } : {}), ...(notes.length ? { notes: Array.from(notes, n => n ?? "") } : {}) };
}

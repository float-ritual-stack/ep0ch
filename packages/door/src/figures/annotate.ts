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
import { rowLines } from "../text";
import { ACCENT, DIM, HI, INK, type Props } from "./palette";

const MARKER = /\s*(?:\/\/|#|--|;)\s*\((\d+)\)\s*$/;

export function drawAnnotate(p: Props, w: number): string[] {
  const code = String(p.code ?? "").replace(/\n$/, "").split("\n");
  const notes: string[] = (p.notes ?? []).map(String);
  const gw = 4;
  const out = code.flatMap(line => {
    const m = MARKER.exec(line);
    return rowLines(m ? line.slice(0, m.index) : line, Math.max(4, w - gw)).map((text, i) => m && !i ? fg(ACCENT) + `[${m[1]}]`.padEnd(gw) + fg(HI) + text + RESET : " ".repeat(gw) + fg(DIM) + text + RESET);
  });
  if (notes.length) {
    out.push("");
    notes.forEach((n, i) => rowLines(n, Math.max(6, w - gw)).forEach((l, j) => out.push((j ? " ".repeat(gw) : fg(ACCENT) + `[${i + 1}]`.padEnd(gw)) + fg(INK) + l + RESET)));
  }
  return out;
}


// A view's pictures in a reader (PIE-827): an `image` primitive laid out as a note's image line is, and placed where the
// view put it; a script's own SVG drawing (PIE-1555) made into a file first, its links the reader's elements.
import { fencePicture, PICTURE_SCALE, pictureRoom } from "../diagrams";
import { mediaRows, type Doc, type DocEnv } from "../doc";
import { imagePrimitiveSpec, media, type ImagePrimitive } from "../media";
import { C, ellipsize, fg, RESET } from "../style";
import { tagInto as tagged } from "./blockdown-context";
import type { LinkTarget as Link } from "../refs";

/**
 * An extension view's picture (PIE-827) as rows `width` wide, laid out as a note's image line is (doc.ts mediaRows: its
 * box kept dark while it loads, dimmed dark-first, its caption; graphics off, the caption says why). Its first row
 * carries a zero-width tag naming the picture, so wherever the view puts it (a card, a box, one side of a row)
 * placePictures finds it; its caption is a link to the file, so `[ ]` stops on it and ⏎ opens it, as on a note's image.
 */
export function pictureRows(node: ImagePrimitive, width: number, env: DocEnv, drawn: Link[]): string[] {
  // A script's own drawing (PIE-1555, `svg` in place of `src`): made into an SVG file once by its content, as a ```svg
  // fence is (src/diagrams.ts), then drawn as that file. Its alt text says it until it's ready, or why it can't be.
  let spec = node.svg === undefined ? imagePrimitiveSpec(node) : null;
  if (node.svg !== undefined) {
    const made = env.graphics ? fencePicture("svg", node.svg, pictureRoom(width, env.cellW, env.cellH)) : null;
    const what = node.alt?.trim() || made?.label || "svg picture";
    if (!made || made.state !== "ready") {
      const why = !made ? "" : made.state === "drawing" ? " · drawing" : ` · ✗ ${made.reason}`;
      return [fg(made?.state === "error" ? C.lred : C.dark) + ellipsize(`${made ? "◌" : "▣"} ${what}${why}`, width) + RESET];
    }
    const entry = media(made.path, "img"), own = entry.state !== "error" && entry.width ? Math.ceil(entry.width / PICTURE_SCALE / env.cellW) : width;
    spec = { ...imagePrimitiveSpec({ ...node, svg: undefined, src: made.path }), ...(node.size === undefined ? { size: { cells: Math.max(1, Math.min(width, own)) } } : {}) };
  }
  // Its links (an SVG's <a href>) are the reader's elements, as a link in the text is.
  const r = mediaRows(spec!, width, { ...env, image: undefined, tag: (to, text) => tagged(drawn, to, text) }, -1);
  // A script's drawing is named by what it says it is, not by the file it was made into.
  if (node.svg !== undefined) r.lines[r.caption] = fg(C.dark) + ellipsize(`▣ ${node.alt?.trim() || "svg picture"}`, width) + RESET;
  const lines = [...r.lines];
  if (r.image) lines[r.image.line] = " ".repeat(r.image.col) + tagged(drawn, { role: "picture", picture: r.image }, " ".repeat(r.image.cols));
  // `caption: false` (PIE-839): the picture alone, once its rows are kept for it; where it isn't drawn, the caption says what it is.
  if (node.caption === false && r.caption > 0) return lines.slice(0, r.caption);
  // A file's caption opens the file; a script's drawing has no file a person keeps.
  if (node.svg === undefined) lines[r.caption] = tagged(drawn, { media: r.entry.path }, lines[r.caption]!);
  return lines;
}

/** The pictures extension views drew in `doc` (pictureRows), each placed where its tag landed. */
export function placePictures(doc: Doc, drawn: readonly Link[]): void {
  const seen = new Set<number>();
  for (const r of doc.links) {
    const picture = drawn[r.n]?.picture;
    if (!picture || seen.has(r.n)) continue;
    seen.add(r.n);
    doc.images.push({ ...picture, line: r.line, col: r.from });
  }
}

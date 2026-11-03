// A view's pictures in a reader (PIE-827): an `image` primitive laid out as a note's image line is, and placed where the
// view put it; a script's own SVG drawing (PIE-1555) made into a file first, its links the reader's elements.
import { fencePicture, PICTURE_SCALE, pictureLinks, pictureLinkTarget, pictureRoom } from "../diagrams";
import { mediaRows, type Doc, type DocEnv } from "../doc";
import { imagePrimitiveSpec, media, parseMediaLine, type ImagePrimitive, type MediaSpec } from "../media";
import { C, ellipsize, fg, RESET } from "../style";
import { tagInto as tagged } from "./blockdown-context";
import type { ImageRef, LinkTarget as Link } from "../refs";

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

// ── a header drawn by a script (PIE-1555) ─────────────────────────────────────

/** The room a script's header picture is laid out in: a wide reader's (an svg ignores it; it names the cache file). */
const HERO_ROOM = pictureRoom(160, 9, 18);

/** The first `svg` image primitive in a view, depth first: a script's drawing. */
export function viewSvg(view: unknown): { svg: string; alt?: string } | null {
  if (!view || typeof view !== "object") return null;
  const n = view as { type?: unknown; svg?: unknown; alt?: unknown; children?: unknown };
  if (n.type === "image" && typeof n.svg === "string") return { svg: n.svg, ...(typeof n.alt === "string" ? { alt: n.alt } : {}) };
  for (const c of Array.isArray(n.children) ? n.children : []) { const found = viewSvg(c); if (found) return found; }
  return null;
}

/**
 * The header a render line draws (PIE-1555): a `name::` line that carries `[layout::hero]` (and the hero line's other
 * properties, `[height::…]`, `[fit::…]`, `[dim::…]`) and whose script returns an svg image is the note's header picture,
 * as a `[img::…] [layout::hero]` line is: its SVG made into a cached file, its spec read from the line's properties.
 * Null while the line has no answer yet, or its picture isn't made yet (a redraw follows).
 */
export function scriptHero(m: { id: string; text: string }, projections: readonly { kind?: string; anchor: { line: number }; output?: { component?: { view?: unknown } | null } | null }[]): { ref: ImageRef & { spec: MediaSpec }; svg: string } | null {
  const lines = m.text.split("\n");
  for (const p of projections) {
    const source = lines[p.anchor.line] ?? "";
    if (!/\[layout::hero\]/i.test(source)) continue;
    const drawn = viewSvg(p.output?.component?.view);
    if (!drawn) continue;
    const made = fencePicture("svg", drawn.svg, HERO_ROOM);
    if (made?.state !== "ready") return null;
    // The hero properties written on the render line, read by the media line's own grammar.
    const tokens = source.match(/\[[A-Za-z-]+::[^\]]*\]/g) ?? [];
    const spec = parseMediaLine(`[img::${made.path}] ${tokens.join(" ")}`) ?? { kind: "img" as const, path: made.path, problems: [], layout: "hero" as const };
    return { ref: { block: m.id, line: p.anchor.line, source, path: made.path, spec: { ...spec, path: made.path, ...(drawn.alt ? { alt: drawn.alt } : {}) } }, svg: drawn.svg };
  }
  return null;
}

/**
 * Where a header picture's links are, in its rows (PIE-1555): each SVG link's box in the cells the picture is drawn
 * in (`box`, `crop` the part of the picture shown), as press spans by row from the top of the header.
 */
export function heroLinkSpans(path: string, box: { col: number; cols: number; rows: number; crop?: { x: number; y: number; w: number; h: number } }, at: number, cut: number): { row: number; from: number; to: number; link: Link }[] {
  const out: { row: number; from: number; to: number; link: Link }[] = [];
  const crop = box.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  for (const l of pictureLinks(path) ?? []) {
    const to = pictureLinkTarget(l.href, l.label);
    if (!to) continue;
    // The link's box in the part shown, then in cells.
    const x0 = (l.box.x - crop.x) / crop.w, x1 = (l.box.x + l.box.w - crop.x) / crop.w, y0 = (l.box.y - crop.y) / crop.h, y1 = (l.box.y + l.box.h - crop.y) / crop.h;
    if (x1 <= 0 || x0 >= 1 || y1 <= 0 || y0 >= 1) continue;
    const from = box.col + Math.max(0, Math.round(x0 * box.cols)), toCol = box.col + Math.min(box.cols, Math.max(Math.round(x0 * box.cols) + 1, Math.round(x1 * box.cols)));
    const r0 = Math.max(0, Math.round(y0 * box.rows)), r1 = Math.min(box.rows, Math.max(r0 + 1, Math.round(y1 * box.rows)));
    for (let r = r0; r < r1; r++) if (r - cut >= 0) out.push({ row: at + r - cut, from, to: toCol, link: to });
  }
  return out;
}

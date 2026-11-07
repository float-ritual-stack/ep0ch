// A view's pictures in a reader (PIE-827): an `image` primitive laid out as a note's image line is, and placed where the
// view put it; a script's own SVG drawing (PIE-1555) made into a file first, its links the reader's elements.
import { fencePicture, pictureLinks, pictureLinkTarget, pictureRoom } from "../diagrams";
import { mediaRows, rowsControls, type Doc, type DocEnv, type ImageControl } from "../doc";
import { ActionRefused } from "@ep0ch/outline-core/action-line";
import { noteCodeFences } from "@ep0ch/outline-core/component-block";
import { sourceLines } from "@ep0ch/outline-core/code-ranges";
import { drawingLayout, drawingSpec, imagePrimitiveSpec, locatePicture, media, picturesIn, pictureStep, rewritePicture, type Drawing, type ImagePrimitive, type MediaAttr, type MediaSpec, type Picture, type PictureStep, type StepRoom } from "../media";
import { C, ellipsize, fg, RESET, width as vwidth } from "../style";
import { putCell } from "./selection";
import { tagInto as tagged } from "./blockdown-context";
import type { ImageRef, LinkTarget as Link } from "../refs";

/**
 * An extension view's picture (PIE-827) as rows `width` wide, laid out as a note's image line is (doc.ts mediaRows: its
 * box kept dark while it loads, dimmed dark-first, its caption; graphics off, the caption says why). Its first row
 * carries a zero-width tag naming the picture, so wherever the view puts it (a card, a box, one side of a row)
 * placePictures finds it; its caption is a link to the file, so `[ ]` stops on it and ⏎ opens it, as on a note's image.
 */
export function pictureRows(node: ImagePrimitive, width: number, env: DocEnv, drawn: Link[], own?: DrawingControls): string[] {
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
    spec = drawingLayout(node, own?.ref.source, made.path);
    delete spec.layout;
  }
  // Its links (an SVG's <a href>) are the reader's elements, as a link in the text is.
  const r = mediaRows(spec!, width, { ...env, image: undefined, tag: (to, text) => tagged(drawn, to, text) }, -1);
  // A script's drawing is named by what it says it is, not by the file it was made into.
  if (node.svg !== undefined) r.lines[r.caption] = drawingCaption("▣", node, width, own, r.entry.path, drawn);
  const lines = [...r.lines];
  // One cell says where it goes: the rest of its row stays what the view tagged it (a card's row, so a click picks the card).
  if (r.image) lines[r.image.line] = " ".repeat(r.image.col) + tagged(drawn, { role: "picture", picture: r.image }, " ") + " ".repeat(r.image.cols - 1);
  // `caption: false` (PIE-839): the picture alone, once its rows are kept for it; where it isn't drawn, the caption says what it is.
  if (node.caption === false && r.caption > 0) return lines.slice(0, r.caption);
  // A file's caption opens the file; a script's drawing has no file a person keeps.
  if (node.svg === undefined) lines[r.caption] = tagged(drawn, { media: r.entry.path }, lines[r.caption]!);
  return lines;
}

/** What a caption control of an image does, said as its element's label. */
export const imageControlLabel = (c: ImageControl) => "size" in c ? `size ${c.size > 0 ? "+" : "−"}` : "align" in c ? `align ${c.align > 0 ? "▸" : "◂"}` : "fit" in c ? (c.fit === "contain" ? "show it whole" : "crop it to fill") : "open" in c ? "open it on its web page" : "share" in c ? "share it with a link" : c.hero ? "make it the header" : "not the header";
/** Picture `p` of note `m` as the reader names it. */
export const imageRefTo = (m: { id: string }, p: Picture): ImageRef => ({ block: m.id, id: p.id, kind: p.kind, line: p.line, source: p.source, path: p.spec.path });

/**
 * A note's pictures (picture.ts), read once per text and service answer: the reader asks every draw. While the service
 * reads a change again (`loaded` false) what a render line last drew stands, if it's still that line: a step on a script's
 * header changes its words, not its drawing, so the header never drops out for a frame.
 */
export class NotePictures {
  private read: { text: string; projections: readonly unknown[]; drawings: Drawing[]; pictures: Picture[] } | null = null;
  of(text: string, projections: Parameters<typeof drawingsOf>[0], loaded: boolean): Picture[] {
    const was = this.read;
    if (was?.text === text && (was.projections === projections || (!was.projections.length && !projections.length))) return was.pictures;
    const lines = text.split("\n"), named = (src: string[] | undefined, line: number) => src?.[line]?.split("::")[0]?.trim();
    const before = was?.text.split("\n");
    const drawings = loaded ? drawingsOf(projections) : (was?.drawings ?? []).filter(d => named(before, d.line) === named(lines, d.line));
    this.read = { text, projections, drawings, pictures: picturesIn(text, drawings) };
    return this.read.pictures;
  }
}

/** A note's header, the one place that decides it (picture.ts): a script's drawing as the file it was made into. Null while that isn't made yet, or when it has none. */
export function headerRef(m: { id: string }, pictures: readonly Picture[]): (ImageRef & { spec: MediaSpec }) | null {
  const p = pictures.find(x => x.header), spec = p && (p.kind === "drawing" ? madeDrawing(p) : p.spec);
  return p && spec ? { ...imageRefTo(m, p), path: spec.path, spec } : null;
}

/** The line edits that lay out these pictures, each found by who it is in `text`; `stale`'s refusal when one can't be told. */
export function pictureEdits(text: string, changes: readonly { id: string; kind: Picture["kind"]; set: Partial<Record<MediaAttr, string | null>> }[], stale: () => Error) {
  return changes.flatMap(x => {
    const at = locatePicture(text, x.id);
    if (!at) throw stale();
    const after = rewritePicture(x.kind, at.source, x.set);
    if (after === null) throw new ActionRefused("that line isn't an image any more");
    return after === at.source ? [] : [{ line: at.line, before: at.source, after, picture: x.id }];
  });
}

/** What a script's drawing is on its render line: `ref`, and `control` tagging a caption control as the reader's. */
export interface DrawingControls { ref: ImageRef; control: (c: ImageControl, text: string) => string }

/** Note `m`'s drawing on note line `line`, for its caption: its ref and its controls, tagged as a media line's are. */
export function drawingControls(m: { id: string }, pictures: readonly Picture[], line: number, drawn: Link[]): DrawingControls | undefined {
  const p = pictures.find(x => x.kind === "drawing" && x.line === line);
  if (!p) return undefined;
  const ref = imageRefTo(m, p);
  return { ref, control: (control, text) => tagged(drawn, { role: "image", label: imageControlLabel(control), image: { ...ref, control } }, text) };
}

/** One step for `ref` (picture.ts pictureStep), from how it's drawn now or, not drawn, its file's pixels. */
export function stepOf(ref: ImageRef & { spec: MediaSpec }, by: number, now: DrawnImage | undefined, pictures: readonly Picture[], room: Omit<StepRoom, "px" | "drawn">): PictureStep {
  const shown = now && "cols" in now ? now : null, drawing = ref.kind === "drawing" ? pictures.find(p => p.id === ref.id) : undefined, made = drawing ? madeDrawing(drawing) : null;
  const entry = shown ? null : made ? media(made.path, "img") : ref.kind !== "drawing" && !ref.spec.fence && ref.spec.kind === "img" ? media(ref.path, "img") : null;
  return pictureStep({ kind: ref.kind, spec: ref.spec, header: ref.spec.layout === "hero" }, by, { ...room, drawn: shown, px: shown?.px ?? (entry && entry.state !== "error" && entry.width && entry.height ? { width: entry.width, height: entry.height } : null) });
}

/** A script's drawing's caption: what it says it is; on a render line, an element holding its rows control. `path`: what was drawn. */
export function drawingCaption(mark: string, node: ImagePrimitive, width: number, own: DrawingControls | undefined, path: string, drawn: Link[]): string {
  const controls = own ? rowsControls((c, text) => fg(C.cyan) + own.control(c, text) + fg(C.dark)) : "";
  const text = ellipsize(`${mark} ${node.alt?.trim() || "svg picture"}`, Math.max(4, width - vwidth(controls)));
  return fg(C.dark) + (own ? tagged(drawn, { media: path, image: own.ref, label: node.alt?.trim() || "svg picture" }, text) : text) + controls + RESET;
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

/** The first `svg` image primitive in a view, depth first: a script's drawing. Not a card's cover (`caption: false`): that's the card's. */
export function viewSvg(view: unknown): { svg: string; alt?: string } | null {
  if (!view || typeof view !== "object") return null;
  const n = view as { type?: unknown; svg?: unknown; alt?: unknown; children?: unknown };
  if (n.type === "image" && typeof n.svg === "string" && (view as { caption?: unknown }).caption !== false) return { svg: n.svg, ...(typeof n.alt === "string" ? { alt: n.alt } : {}) };
  for (const c of Array.isArray(n.children) ? n.children : []) { const found = viewSvg(c); if (found) return found; }
  return null;
}

/** A note's script drawings, from the service's answer for it: the render lines whose script returned an svg image. */
export function drawingsOf(projections: readonly { anchor: { line: number }; output?: { component?: { view?: unknown } | null } | null }[]): Drawing[] {
  return projections.flatMap(p => { const d = viewSvg(p.output?.component?.view); return d ? [{ line: p.anchor.line, ...d }] : []; });
}

/**
 * A script's drawing as the file it was made into (PIE-1555), so it's a picture like any other: its spec read from its
 * line (the hero line's `[height::…]`, `[fit::…]`, `[dim::…]`). Null while the file isn't made yet (a redraw follows).
 */
export function madeDrawing(p: Picture): MediaSpec | null {
  const made = fencePicture("svg", p.svg ?? "", HERO_ROOM);
  return made?.state === "ready" ? drawingSpec(p.source, made.path, p.spec.alt) : null;
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

/** How an image is drawn now: its cells, where it sits and its file's pixels, or the header's rows. */
export type DrawnImage = { cols: number; rows: number; col: number; px: { width: number; height: number } } | { header: number };
/** How each image is drawn now, by its note line: its cells and where it sits, or the header's rows. */
export function drawnImagesOf(d: { doc: Doc; lines: readonly number[] } | null, hero: { line: number; full: number } | null): Map<number, DrawnImage> {
  const out = new Map<number, DrawnImage>();
  if (hero) out.set(hero.line, { header: hero.full });
  for (const x of d?.doc.media ?? []) {
    const im = x.image !== undefined ? d!.doc.images[x.image] : undefined, line = d!.lines[x.line];
    if (im && line !== undefined) out.set(line, { cols: im.cols, rows: im.rows, col: im.col, px: { width: im.media.width, height: im.media.height } });
  }
  return out;
}

/** An image action's image, refused when it takes a size and a place and nothing else: an artifact (PIE-793), a picture fence (PIE-1583). */
export const notArtifact = <T extends { spec: MediaSpec }>(ref: T): T => {
  if (ref.spec.kind === "artifact") throw new ActionRefused("that's an artifact, not an image: it takes a size, a height and a place (image.size, image.align), and artifact.open runs it");
  if (ref.spec.fence) throw new ActionRefused("that's a picture fence: it takes a size, a height and a place (image.size, image.align); a header is an [img::] line");
  return ref;
};

/**
 * The fence a selection with no words in it is over, read from the doc as drawn: a picture draws none, so its text as
 * written is what the selection counts and copies (PIE-1583). Null when it is over no picture fence.
 */
export function pictureSourceOf(s: { start: { row: number }; end: { row: number } }, d: { top: number; doc: Doc; lines: readonly number[] }, note: string): { text: string; exact: boolean; from: number; to: number; lines: [number, number] } | null {
  for (const x of d.doc.media) {
    const im = x.image !== undefined ? d.doc.images[x.image] : undefined, at = d.lines[x.line];
    if (!x.spec.fence || !im || at === undefined || s.end.row < d.top + im.line || s.start.row >= d.top + im.line + im.rows) continue;
    const lines = note.split("\n"), fence = noteCodeFences(lines).find(f => f.start === at);
    if (!fence) continue;
    const from = sourceLines(note)[at + 1]!.start, text = lines.slice(at + 1, fence.end).join("\n");
    return { text, exact: true, from, to: from + text.length, lines: [at + 1, fence.end - 1] };
  }
  return null;
}

// ── the band beside a picture (PIE-1630) ──────────────────────────────────────

/** The rows `images` take, `at` rows down: drawn or still being made (their rows are kept for them either way). */
export const pictureRowsOf = (images: readonly { line: number; rows: number }[], at: number): Set<number> =>
  new Set(images.flatMap(im => Array.from({ length: im.rows }, (_, k) => at + im.line + k)));

/** The band's mark on a picture's rows: a thin bar of its colour at the body's edge. */
const BAND_GLYPH = "▎";
/**
 * A picture's row under a band (the ruler, the reading band, a thread's tint), `bx` columns of inset before the body:
 * beside a narrow picture a fill would be a wall of colour round it, so the row keeps the ground and the band's place is
 * said by a thin bar of its colour on the body's edge, dark first. No inset, no bar (the picture may start there).
 */
export function bandBesidePicture(line: string, bx: number, bg: string): string {
  return bx > 0 ? putCell(line, bx - 1, BAND_GLYPH, bg.replace("\x1b[48;", "\x1b[38;")) ?? line : line;
}

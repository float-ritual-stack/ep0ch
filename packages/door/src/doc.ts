// Render a note body into terminal lines: headings, lists, code fences, Obsidian-style
// callouts as boxes, Markdown tables as real tables with wrapped multi-line cells, and
// media lines as image slots the caller fills with Kitty placements.
import { brightness, media, parseMediaLine, sizeText, type Focus, type Media, type MediaSpec } from "./media";
import { ADORN, balanceStyles, balanceTags, BOLD, C, chip, extractLinks, fg, headOf, type LinkRange, pad, RESET, splitVisible, stripTags, styleMarks, trimTagged, UNBOLD, width as vwidth } from "./style";
import { colourBody, wrap } from "./text";
import { componentBlocks, noteCodeFences, noteStructure } from "@ep0ch/outline-core/component-block";
import { figureSource, frame, graphKind, reframeAscii, renderGraph, type FiguresEnv } from "./graphs";
import { linkBlockAt, renderLinkBlock } from "./links";
import { stripMarks, type LinkTarget } from "./refs";
import { codeSpanRanges } from "@ep0ch/outline-core/code-ranges";
import { embedPattern, linkOccurrences, withoutFragmentAnchor } from "@ep0ch/outline-core/link-syntax";
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, quoteByline, stripQuotes, type CalloutBlock, type CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { TONE } from "./callouts";
import { BASE_HEADING_STYLE, BUILTIN_HEADING_STYLE_REGISTRY, headingStyleDeclaration, headingStyleWith, liveTokensInLine, styledLine, withoutTokens, type HeadingStyle, type HeadingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import { bandLetters, drawBand, drawTrack, withMargin } from "./figures/banner";

export interface DocEnv {
  width: number; cellW: number; cellH: number; graphics: boolean; maxImageRows: number; unfold: boolean;
  /**
   * Why images aren't drawn (`graphics` off): said on each image's line ("no Kitty graphics in this terminal").
   * Without it (an embed, a draft's preview) the line names the image and says nothing about graphics.
   */
  noImages?: string;
  /**
   * Draw the `n`th transclusion (`!((id))`, `!((id^fragment))`) of the document, `width` wide (an embedded
   * note's own are drawn by its region, nested as the service projects them). Without it the token stays
   * text.
   */
  embed?: (id: string, fragment: string | undefined, n: number, width: number) => string[];
  /**
   * The body's fold points (from `foldPoints` of the same body, line for line), which of them are folded,
   * and the one selected by the keys. Without it nothing folds (an embed, a draft's preview).
   */
  folds?: { points: readonly FoldPoint[]; folded: ReadonlySet<string>; selected?: string | null };
  /**
   * Tag `text` as a link to a row's note (a live figure's check item, event or table row), so the reader
   * can step to it and a click opens it (PIE-441). Without it (an embed, a draft's preview) rows are text.
   */
  link?: (block: string, text: string, figure?: string) => string;
  /**
   * The reader's hold on the body's live figures (src/graphs.ts FiguresEnv): each one's chosen tab and density, its
   * tabs and density as controls, and what each drew. Without it (an embed, a draft's preview) a figure draws its first
   * tab at its YAML's density, as text.
   */
  figures?: FiguresEnv;
  /**
   * Tag `text` as a link to any target (an inline `::links` component's rows: a note, a ticket's block, a
   * Resource), so the reader steps to it and opens it. Without it the rows are text.
   */
  tag?: (to: LinkTarget, text: string) => string;
  /**
   * The block whose body this is: an inline `::links` component lists its links unless it names another, and a figure
   * that is the note's figure block (its first line) takes the note's child bullets as rows.
   */
  note?: string;
  /** A part of the body drawn on its own (a callout's): a figure in it isn't the note's figure block. */
  nested?: boolean;
  /**
   * The body lines (by index) inside a literal region (PIE-422): `[key::value]` there is text, drawn
   * plain. Links and Markdown still render, as the service and Detail treat them.
   */
  literal?: ReadonlySet<number>;
  /**
   * Rows the reader inserts after body line `line` (-1: above the first), drawn once that line's construct
   * is (after a whole table, fence or callout), and not when a fold hides the line: a resource projection's
   * region (src/projection.ts). Without it (an embed, a draft's preview) nothing is inserted.
   */
  after?: (line: number, width: number) => string[];
  /**
   * A list item's step box (`[ ]`, `[x]`, `[~]`, `[!]`) on body line `line`: the text to draw in its place
   * (the reader tags it, so `[ ]` stops on it and a click opens its status choice, PIE-472), or null to
   * leave it as text. The reader offers it only where the service reads a checklist step. Without it (a
   * draft's preview) boxes are text.
   */
  task?: (line: number, box: string) => string | null;
  /**
   * Keep link tags in the returned lines (and leave `links` empty): an embed's body, drawn inside the
   * note's own document, whose tags the note's render turns into places (src/embeds.ts).
   */
  keepTags?: boolean;
  /** The outline's callout types (src/callouts.ts): what `[!type]` draws as. Without it, the built-ins. */
  callouts?: CalloutRegistry;
  /**
   * The outline's heading styles (src/heading-styles.ts, PIE-599): what `## x [heading::band]`, `--- [rule::fade]` and
   * a level's default draw as. Without it, the built-ins (named styles still draw; no level has a default).
   */
  headings?: HeadingStyleRegistry;
  /**
   * A callout's icon and type on body line `line` (its header): what tags them both as one control (the reader's
   * type choice, PIE-538), or null to leave them text. Without it (a draft's preview, an embed) they're text.
   */
  callout?: (line: number, block: CalloutBlock) => ((text: string) => string) | null;
  /**
   * The reader draws the note's header image itself (PIE-532), above the title: the first `[layout::hero]` image's
   * line is then only its caption, and `Doc.hero` names it. Without it (a river column, an embed, `ep0ch show`) the
   * header image is drawn where it is written, the full width, cropped to at most `maxImageRows`.
   */
  hero?: boolean;
  /**
   * Tag `text` as a control of the image on body line `line` (its caption's − + ◂ ▸ ▀), so a click runs that
   * change. Without it (an embed, a draft's preview, `ep0ch show`) the caption has no controls.
   */
  image?: (line: number, control: ImageControl, text: string) => string;
  /** Drawn for print (`ep0ch show`): an image's caption names its whole path, and says nothing about graphics. */
  printed?: boolean;
  /**
   * A rule's decoration in the place of body lines from `line` to `end` (PIE-600, src/projection.ts): `rows` drawn
   * instead of them (`replace`: a heading's band), or a frame titled `title` in `colour` drawn around them
   * (`around`). A heading it replaces keeps its fold point: ( ) stops on it and f folds what's under it. Without it
   * (an embed, a draft's preview, the reader's raw view) the lines are drawn as written.
   */
  decorate?: (line: number, width: number) => { end: number; rows?: string[]; headRow?: number; frame?: { title: string; colour: number } } | null;
}
/** A control on an image's caption: a size step, an alignment step, or the header on or off. */
export type ImageControl = { size: 1 | -1 } | { align: 1 | -1 } | { hero: boolean } | { fit: "cover" | "contain" };
/**
 * An image laid out on the body's rows: `col` cells in, `cols` × `rows` cells; `crop` the part of it shown, as
 * fractions of the image (a header's cover crop).
 */
export interface DocImage { line: number; col: number; rows: number; cols: number; media: Extract<Media, { state: "ready" }>; crop?: { x: number; y: number; w: number; h: number }; dim?: number }
/**
 * A media line as drawn: the file, its kind, the row naming it (its caption), the body line it's on, what the line says
 * of its layout, and `image`, its index in `Doc.images` when it's laid out there.
 */
export interface DocMedia { path: string; kind: string; row: number; line: number; spec: MediaSpec; image?: number }
/**
 * `links`: where the body's tagged links (src/style.ts linkTag) landed, by row of `lines`. `media[i].row`:
 * the row that names the image or video (its caption, or the line in its place). `source[r]`: the
 * body line rendered row `r` comes from (the first line of a table, callout, fence or figure for all of its
 * rows). `heads`: each fold point drawn, at its row, with the columns of its disclosure (a heading's whole
 * row, a list item's indent and mark).
 */
export interface Doc {
  lines: string[]; images: DocImage[]; media: DocMedia[]; links: LinkRange[]; source: number[]; heads: { key: string; row: number; cols: number }[];
  /** The drawing a copy leaves out, by row of `lines` (only rows that have some). */
  trims: Map<number, DocTrim>;
  /** The code blocks, quotes and callouts drawn, in reading order: what the copy control copies. */
  blocks: DocBlock[];
  /** The header image (`env.hero`): the first `[layout::hero]` image, drawn by the reader above the title. */
  hero?: DocMedia & { media: Media };
}

/**
 * Drawing that is not the note's text, in a row's cells: `cuts` are cell ranges [from, to) (`to` may be Infinity) a
 * selection's copy leaves out (a quote's bar, a frame's edges, a bullet glyph, a fold arrow); `edge`: the row is only
 * decoration (a frame's top or bottom edge), left out whole.
 */
export interface DocTrim { cuts: [number, number, string?][]; edge?: true }
/**
 * A fenced code block, a quote or a callout as drawn (PIE-638): `row`, `rows` where it is in `lines`; `line`, `end` the
 * source lines [line, end) it is; `inner` the source lines [from, to) that are its content, `strip` how many levels of `>` its
 * lines lose to be that (the reader copies them from the note as written, which this document's lines are not: links and
 * styles are marks by now); `text` that content as this document has it (for what has no note behind it); `col` the cell of
 * `row` its copy control `⧉` sits in (drawn when that cell is blank or a rule).
 */
export interface DocBlock { kind: "code" | "quote" | "callout" | "span"; row: number; rows: number; line: number; end: number; inner: [number, number]; strip: number; text: string; col: number;
  /** An inline code span (`kind: "span"`, one row, `col` to `to`): `text` its contents without the backticks. It has no control; a click on it copies. */
  to?: number }

/**
 * A place the reader can fold: a heading (hiding everything through the next heading of the same or a
 * higher level), a list item with nested items or continuation lines under it, or a callout with a body
 * (PIE-538: `level` is its quote depth; `start` folded for `[!type]-`, which the reader folds when it first sees it). `line` is its body
 * line, `end` the line after the last it hides (trailing blank lines stay shown), `hidden` how many of
 * those have text. `key` names it across edits elsewhere in the note: its anchor (`^beds`) when it has
 * one, else its kind, level and text (without a step's box) with how many identical headings or items
 * come before it, folding or not.
 */
export interface FoldPoint { key: string; kind: "heading" | "list" | "callout"; level: number; text: string; line: number; end: number; hidden: number; start?: "folded" }

// Inline Markdown (bold, italic, strikethrough) arrives as style marks from presentLinks, placed before the
// text was wrapped; colourBody turns them into SGR.
const inlineOf = (s: string, literal = false) => colourBody(s, literal);
/** Rows colourBody colours: a code span the wrap cuts stays code on both rows. */
const BODY = { code: true };

const HEADING = /^(#{1,6})\s+(.*)$/;
const ITEM = /^(\s*)([-*]|\d+[.)])\s+(.*)$/;
/** The fewest columns a list item's text keeps when its indentation would take the whole width. */
const MIN_ITEM_TEXT = 8;
const indentOf = (l: string) => l.length - l.trimStart().length;


/**
 * The media lines of a body (PIE-532), by line: the one scan the reader draws from and the image actions read (not
 * inside a fence or a figure). The first `[layout::hero]` is the header; a later one says it isn't.
 */
export function mediaLines(src: readonly string[]): Map<number, MediaSpec> {
  const block = noteStructure(src), out = new Map<number, MediaSpec>();
  let hero = false;
  src.forEach((l, i) => {
    const spec = block[i] === -1 ? parseMediaLine(l) : null;
    if (!spec) return;
    if (spec.layout === "hero") { if (hero) { spec.problems.push("another image is the header already"); delete spec.layout; } hero = true; }
    out.set(i, spec);
  });
  return out;
}

/**
 * The fold points of a body, computed from its source text (before links are presented, so a link's
 * title arriving later never renames a fold). Headings and list markers inside a fence or a figure are
 * text; a media line or a transclusion isn't a fold point. `anchors[i]` is line i's stable anchor, if any.
 */
export function foldPoints(body: string, anchors: readonly (string | undefined)[] = []): FoldPoint[] {
  const src = body.split("\n");
  const block = noteStructure(src), images = mediaLines(src);
  // A line declaring a heading style draws as what it declares, never a heading (`# Plot style [heading-style::plot]`).
  const foldable = (i: number) => block[i] === -1 && !images.has(i) && !embedPattern().test(src[i]!) && !headingStyleDeclaration(src[i]!);
  const trim = (from: number, to: number) => { while (to > from && !src[to - 1]!.trim()) to--; return to; };
  const out: FoldPoint[] = [];
  const seen = new Map<string, number>();
  const add = (kind: FoldPoint["kind"], level: number, text: string, line: number, end: number, start?: "folded") => {
    const plain = withoutFragmentAnchor(text).trim().replace(/\s+/g, " ");
    // A step's box ([ ] or [x]) isn't part of its name: ticking it keeps its fold. Every occurrence counts
    // toward the ordinal, empty ones too, so an earlier `## Notes` gaining a body doesn't renumber this one.
    const base = `${kind}:${level}:${plain.replace(/^\[.\]\s+/, "")}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (end <= line + 1) return;
    const hidden = src.slice(line + 1, end).filter(l => l.trim()).length;
    out.push({ key: anchors[line] ? `^${anchors[line]}` : `${base}#${n}`, kind, level, text: plain, line, end, hidden, ...(start ? { start } : {}) });
  };
  // A callout is named by its depth and its title as written, never its type: choosing another type keeps its fold.
  const callouts = new Map(calloutBlocks(src).map(c => [c.line, c]));
  for (let i = 0; i < src.length; i++) {
    if (!foldable(i)) continue;
    const line = src[i]!;
    const cb = callouts.get(i);
    if (cb) {
      const shown = cb.title || BUILTIN_CALLOUT_REGISTRY.style(cb.type).title;
      add("callout", cb.depth, cb.title, i, cb.end, cb.fold === "-" ? "folded" : undefined);
      // Its label is the title as drawn (the type's own title when it has none).
      const p = out.at(-1);
      if (p?.line === i && p.kind === "callout") p.text = shown;
      continue;
    }
    const h = line.match(HEADING);
    if (h) {
      const level = h[1]!.length;
      let j = i + 1;
      while (j < src.length && !(block[j] === -1 && (src[j]!.match(HEADING)?.[1]!.length ?? 7) <= level)) j++;
      // A heading's style (`[heading::band]`) isn't part of its name: restyling it keeps its fold.
      add("heading", level, (styledLine(line)?.text ?? line).match(HEADING)?.[2] ?? h[2]!, i, trim(i + 1, j));
      continue;
    }
    const li = line.match(ITEM);
    if (li) {
      // Nested items and continuation lines are indented past the item's own marker; a fence or figure
      // opened among them belongs to the item as a whole, however its lines are indented.
      const indent = li[1]!.length;
      let last = i;
      for (let j = i + 1; j < src.length; j++) {
        const l = src[j]!;
        if (block[j]! > i && block[j]! <= last) { last = j; continue; }
        if (!l.trim()) continue;
        if (indentOf(l) > indent) { last = j; continue; }
        break;
      }
      add("list", indent, li[3]!, i, last + 1);
    }
  }
  return out;
}

export function renderDoc(body: string, env: DocEnv): Doc {
  const out: string[] = [];
  const images: DocImage[] = [];
  const mediaRefs: Doc["media"] = [];
  let hero: Doc["hero"];
  let embeds = 0;
  const W = Math.max(10, env.width);
  // A checklist step's stable id (` ^task-<uuid>`, added by the service, e.g. when a step gets a comment)
  // is bookkeeping, not prose.
  // A block anchor at the end of a line (`^books`, `^t-8a6d7f`, the older `^task-<uuid>`) is hidden when a note is
  // drawn, as Detail hides it (outline-core's anchor rule, the service's); it stays in the source, so folds and links
  // still find it. A line of code or of a figure keeps its text (`mask = flags ^bit`).
  const raw = body.split("\n"), rawStructure = noteStructure(raw);
  const src = raw.map((l, i) => (rawStructure[i] === -1 ? withoutFragmentAnchor(l) : l));
  const mediaAt = mediaLines(src);
  const source: number[] = [], heads: Doc["heads"] = [];
  const trims = new Map<number, DocTrim>(), blocks: DocBlock[] = [];
  const cut = (row: number, ...cuts: [number, number, string?][]) => { const t = trims.get(row); if (t) t.cuts.push(...cuts); else trims.set(row, { cuts }); };
  const edge = (row: number) => trims.set(row, { cuts: [[0, Infinity]], edge: true });
  /**
   * A sub-document's rows taken in at `base`: its trims and blocks moved by `dx` cells and `off` lines. `frame`: its rows sit
   * inside a frame `│ … │` (2 cells each side, the text `inner` wide), which is decoration too.
   */
  const adopt = (sub: Doc, base: number, dx: number, off: number, frame?: { inner: number }, quoted = 0) => {
    sub.lines.forEach((_, r) => {
      const t = sub.trims.get(r);
      if (t?.edge) { edge(base + r); return; }
      const cuts: [number, number, string?][] = (t?.cuts ?? []).map(([a, b, r]) => [a + dx, b + dx, r]);
      if (frame) cuts.push([0, dx], [dx + frame.inner, Infinity]);
      if (cuts.length) cut(base + r, ...cuts);
    });
    for (const b of sub.blocks) if (b.kind !== "span") blocks.push({ ...b, row: base + b.row, line: b.line + off, end: b.end + off, inner: [b.inner[0] + off, b.inner[1] + off], strip: b.strip + quoted, col: b.col + dx });
  };
  const at = new Map((env.folds?.points ?? []).map(p => [p.line, p]));
  const callouts = new Map(calloutBlocks(src).map(c => [c.line, c]));
  const componentAt = new Map(componentBlocks(src).map(c => [c.start, c]));
  const fenceAt = new Map(noteCodeFences(src).map(f => [f.start, f]));
  const lit = (i: number) => !!env.literal?.has(i);
  // Each row comes from the line its construct started on: rows pushed since then are filled in here.
  let from = 0;
  const mark = () => { while (source.length < out.length) source.push(from); };
  // Inserted rows (env.after) for each body line before `to`, once: they belong to the line they follow.
  let inserted = 0;
  const insert = (to: number) => {
    for (; inserted < to; inserted++) {
      const rows = env.after?.(inserted, W) ?? [];
      out.push(...rows);
      for (const _ of rows) source.push(Math.max(0, inserted));
    }
  };
  if (env.after) inserted = -1;
  for (let i = 0; i < src.length; i++) {
    mark();
    insert(i);
    from = i;
    const line = src[i]!;

    // A rule's decoration in these lines' place, or around them (PIE-600).
    const deco = env.decorate?.(i, W);
    if (deco && deco.end > i) {
      const fp = at.get(i), folded = !!fp && !!env.folds && fp.kind !== "callout" && env.folds.folded.has(fp.key);
      if (deco.rows) {
        // In a heading's place the fold point stays, on the row with its words (a band's text row).
        if (fp && env.folds) heads.push({ key: fp.key, row: out.length + Math.min(Math.max(0, deco.rows.length - 1), deco.headRow ?? Math.floor(Math.max(0, deco.rows.length - 1) / 2)), cols: W });
        out.push(...deco.rows);
        if (folded && fp) {
          out.push(fg(C.dark) + `▸ ${fp.hidden} line${fp.hidden === 1 ? "" : "s"} folded` + RESET);
          mark(); insert(i + 1); inserted = fp.end; i = fp.end - 1;
        } else i = deco.end - 1;
        continue;
      }
      if (deco.frame) {
        // Around them: drawn in a frame by this renderer, their folds kept (a folded one inside stays folded).
        const inner = Math.max(8, W - 4), off = i, end = deco.end, colour = deco.frame.colour, inside = (n: number) => n >= off && n < end;
        const sub = renderDoc(src.slice(i, end).join("\n"), {
          ...env, nested: true, width: inner, graphics: false, keepTags: true, embed: undefined, after: undefined, task: undefined,
          callout: undefined, decorate: undefined, literal: new Set([...(env.literal ?? [])].filter(inside).map(n => n - off)),
          folds: env.folds && { ...env.folds, points: env.folds.points.filter(p => inside(p.line)).map(p => ({ ...p, line: p.line - off, end: Math.min(p.end, end) - off })) },
        });
        const title = deco.frame.title ? ` ${headOf(deco.frame.title, Math.max(0, W - 6))} ` : "";
        out.push(fg(colour) + "╭─" + title + "─".repeat(Math.max(0, W - 3 - vwidth(title))) + "╮" + RESET);
        mark();
        const base = out.length;
        sub.lines.forEach((l, r) => { out.push(fg(colour) + "│ " + RESET + pad(l, inner) + fg(colour) + " │" + RESET); source.push(off + (sub.source[r] ?? 0)); });
        for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
        edge(base - 1);
        adopt(sub, base, 2, off, { inner });
        out.push(fg(colour) + "╰" + "─".repeat(Math.max(0, W - 2)) + "╯" + RESET);
        edge(out.length - 1);
        i = end - 1;
        continue;
      }
    }

    // A heading or a list item the reader can fold: its disclosure, and nothing it hides when folded.
    const fp = at.get(i);
    if (fp && env.folds && fp.kind !== "callout") {
      const folded = env.folds.folded.has(fp.key), selected = env.folds.selected === fp.key;
      const disclosure = { folded, selected, hidden: fp.hidden };
      const styled = fp.kind === "heading" ? styledHeading(line, W, env, lit(i), disclosure) : null;
      const rows = styled?.rows ?? prose(line, W, disclosure, lit(i), env.task && (box => env.task!(i, box)));
      if (!styled) proseCuts(line, W, disclosure).forEach((c, k) => { if (c.length && k < rows.length) cut(out.length + k, ...c); });
      heads.push({ key: fp.key, row: out.length + (styled?.headRow ?? 0), cols: fp.kind === "heading" ? W : fp.level + line.trimStart().search(/\s/) + 2 });
      out.push(...rows);
      if (folded) { mark(); insert(i + 1); inserted = fp.end; i = fp.end - 1; }
      continue;
    }

    // The inline links component (src/links.ts): ::links, ::resources, ::backlinks, ::outlinks, one line or a block
    // to its `::`, drawn with the links tile's rows in a figure's frame, each row a link the reader opens.
    const lb = linkBlockAt(src, i, componentAt);
    if (lb) {
      out.push(...renderLinkBlock(lb.spec, env.note, W, frame, env.tag));
      i = lb.end;
      continue;
    }

    // mdxcn Comark figure: ::graph-kind, --- yaml ---, ::
    const figure = componentAt.get(i), gk = figure && graphKind(figure);
    if (figure && gk) {
      // Its YAML and its Markdown rows; the note's figure block (the first line of a note's own body) takes its child
      // bullets as rows too.
      const block = !env.nested && src.slice(0, i).every(l => !l.trim());
      out.push(...renderGraph(gk, figureSource(src.slice(i + 1, figure.end), env.note, block), W, env.link, env.figures));
      i = figure.end;
      continue;
    }

    // Code fence.
    const fence = fenceAt.get(i);
    if (fence) {
      const code = src.slice(i + 1, fence.closed ? fence.end : fence.end + 1);
      i = fence.end;
      const figure = reframeAscii(code, W);
      if (figure) { out.push(...figure); continue; }
      const first = out.length;
      if (fence.fence.info) { out.push(fg(C.dark) + `╭ ${fence.fence.info}` + RESET); edge(first); }
      // A ```diff fence colours its lines by their mark: + added, - removed, @@ a hunk, the rest dim (the unsent diff).
      const diff = /^diff\b/.test(fence.fence.info);
      const ink = (c: string) => (!diff ? C.lcyan : c.startsWith("+") ? C.lgreen : c.startsWith("-") ? C.lred : c.startsWith("@@") ? C.cyan : C.grey);
      for (const c of code) for (const piece of chunk(c, W - 2)) { cut(out.length, [0, 2]); out.push(fg(C.blue) + "│ " + fg(ink(c)) + piece + RESET); }
      blocks.push({ kind: "code", row: first, rows: out.length - first, line: fence.start, end: fence.end + 1, inner: [fence.start + 1, fence.start + 1 + code.length], strip: 0, text: code.join("\n"), col: W - 1 });
      continue;
    }

    // Media line (PIE-532): the image laid out as its properties say, its caption under it with the controls that
    // change them; the header image is only its caption here when the reader draws it above the title.
    const spec = mediaAt.get(i);
    if (spec) {
      const entry = media(spec.path, spec.kind);
      const ref: DocMedia = { path: entry.path, kind: spec.kind, row: out.length, line: i, spec };
      mediaRefs.push(ref);
      const isHero = spec.layout === "hero";
      if (isHero && env.hero) {
        hero = { ...ref, media: entry };
        out.push(caption(entry, spec, W, env, i, true));
        continue;
      }
      // Its rows from its size, which its header gives before it's decoded: kept dark while it loads, so the note
      // doesn't move when it arrives.
      const size = entry.state === "ready" ? entry : entry.state === "loading" && entry.width && entry.height ? { width: entry.width, height: entry.height } : null;
      if (size && env.graphics) {
        const box = isHero ? heroBox(size, spec, W, Math.min(spec.height ?? Infinity, env.maxImageRows), env.cellW, env.cellH) : imageBox(size, spec, W, env);
        if (entry.state === "ready") ref.image = images.push({ line: out.length, media: entry, ...(spec.dim !== undefined ? { dim: spec.dim } : {}), ...box }) - 1;
        for (let r = 0; r < box.rows; r++) out.push("");
        ref.row = out.length;
      }
      out.push(caption(entry, spec, W, env, i, isHero));
      continue;
    }

    // Callout (PIE-538): > [!type]± title, then its lines, each quoted at least as deep; one quoted deeper is a
    // callout inside it, drawn by this same renderer in its frame, to any depth.
    const cb = callouts.get(i);
    if (cb) {
      const t = (env.callouts ?? BUILTIN_CALLOUT_REGISTRY).style(cb.type), colour = TONE[t.tone];
      let body = src.slice(i + 1, cb.end).map(l => stripQuotes(l, cb.depth));
      const written = body.join("\n").trimEnd();
      // A quote's last `— name, source` line is its byline (outline-core's quoteByline, as Detail reads it): drawn
      // after the body, to the right, the source muted.
      const byline = t.name === "quote" ? quoteByline(body) : null;
      if (byline) { body = body.slice(0, byline.line); while (body.length && !body.at(-1)!.trim()) body.pop(); }
      const bylineRow = (room: number) => {
        if (!byline) return "";
        const text = fg(C.white) + BOLD + "— " + byline.name + UNBOLD + (byline.source ? fg(C.dark) + ", " + byline.source : "") + RESET;
        const shown = vwidth(text) > room ? pad(text, room) : text;
        return " ".repeat(Math.max(0, room - vwidth(shown))) + shown;
      };
      // The reader's fold point folds it; without one (an embed, `ep0ch show`), `-` starts it folded unless unfolded.
      const fp2 = env.folds ? at.get(i) : undefined;
      // A title-only callout has nothing to fold, whatever its `-` says.
      const folded = body.length > 0 && (fp2 ? env.folds!.folded.has(fp2.key) : cb.fold === "-" && !env.unfold);
      const selected = !!fp2 && env.folds!.selected === fp2.key;
      // Too narrow for a frame inside a frame (deep nesting in a thin reader): its title, then its body, unframed.
      if (W < 16) {
        const tag = env.callout?.(i, cb) ?? ((x: string) => x);
        out.push(fg(colour) + pad(`${tag(t.icon)} ${BOLD}${cb.title || t.title}${UNBOLD}`, W) + RESET);
        if (body.length && !folded) {
          const sub = renderDoc(body.join("\n"), { ...env, nested: true, keepTags: true, embed: undefined, after: undefined, task: undefined, folds: undefined, callout: undefined, decorate: undefined, literal: undefined });
          mark();
          const base0 = out.length;
          sub.lines.forEach((l, r) => { out.push(l); source.push(i + 1 + (sub.source[r] ?? 0)); });
          adopt(sub, base0, 0, i + 1, undefined, cb.depth);
          if (byline) { out.push(bylineRow(W)); source.push(i + 1 + byline.line); }
        }
        i = cb.end - 1;
        continue;
      }
      const bw = Math.max(12, W), inner = bw - 4;
      const tag = env.callout?.(i, cb) ?? ((x: string) => x);
      const glyph = fp2 ? (selected ? fg(C.yellow) : "") + (folded ? "▸" : "▾") + fg(colour) + " " : "";
      // The type, named on the top edge when the title is the author's own; with the icon, the control that changes it.
      const typeName = cb.title && cb.title.toLowerCase() !== t.title.toLowerCase() ? cb.type : "";
      // A title too long for the top edge keeps a short head there and flows the rest into the box.
      let title = cb.title || t.title;
      let spill = "";
      // Counted and cut in visible characters: a link's tags take no room and are never split, and a link
      // open at the cut is closed on the top edge (a folded callout drops the spill) and re-opened in it.
      const room = bw - 8 - [...t.icon].length - (glyph ? 2 : 0);
      if (vwidth(title) > room) {
        const seen = [...stripTags(title)];
        const cut = seen.lastIndexOf(" ", room - 1);
        const [h, rest] = splitVisible(title, cut > room * 0.4 ? cut : room - 1);
        spill = trimTagged(rest);
        title = trimTagged(h) + " …";
      }
      const head = ` ${glyph}${tag(t.icon)} ${selected ? fg(C.yellow) : ""}${title}${fg(colour)} `;
      const label = typeName && bw - 3 - vwidth(head) >= typeName.length + 4 ? ` ${tag(typeName)} ` : "";
      if (fp2) heads.push({ key: fp2.key, row: out.length, cols: W });
      const top = out.length;
      edge(top);
      out.push(fg(colour) + "╭─" + BOLD + head + UNBOLD + "─".repeat(Math.max(0, bw - 3 - vwidth(head) - vwidth(label) - (label ? 1 : 0))) + (label ? fg(C.dark) + label + fg(colour) + "─" : "") + "╮" + RESET);
      const framed = (l: string) => { cut(out.length, [0, 2], [2 + inner, Infinity]); return fg(colour) + "│ " + RESET + pad(l, inner) + fg(colour) + " │" + RESET; };
      if (folded) {
        const n = body.filter(l => l.trim()).length, said = `▸ ${n} line${n === 1 ? "" : "s"} folded`;
        // The hint gives way by width, whole words at a time, never cut mid-word.
        const hint = (fp2 ? [`${said} · f or a click on the title unfolds`, `${said} · f`] : [`${said} · z unfolds`]).find(x => vwidth(x) <= inner) ?? said;
        cut(out.length, [0, 2], [2 + inner, Infinity]);
        out.push(fg(colour) + "│ " + fg(C.dark) + pad(hint, inner) + fg(colour) + " │" + RESET);
      } else {
        for (const l of spill ? wrap(spill, inner) : []) { cut(out.length, [0, 2], [2 + inner, Infinity]); out.push(fg(colour) + "│ " + BOLD + pad(l, inner) + UNBOLD + " │" + RESET); }
        // A title-only callout is just the titled frame; no empty row inside.
        if (body.length) {
          const off = i + 1, inside = (n: number) => n > i && n < cb.end;
          const sub = renderDoc(body.join("\n"), {
            ...env, nested: true, width: inner, graphics: false, keepTags: true, embed: undefined, after: undefined, task: undefined, decorate: undefined,
            literal: new Set([...(env.literal ?? [])].filter(inside).map(n => n - off)),
            folds: env.folds && { ...env.folds, points: env.folds.points.filter(p => inside(p.line)).map(p => ({ ...p, line: p.line - off, end: p.end - off })) },
            callout: env.callout && ((n, b) => env.callout!(n + off, { ...b, line: b.line + off, end: b.end + off, depth: b.depth + cb.depth })),
          });
          mark();
          const base = out.length;
          sub.lines.forEach((l, r) => { out.push(framed(l)); source.push(off + (sub.source[r] ?? 0)); });
          for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
          adopt(sub, base, 2, off, { inner }, cb.depth);
          if (byline) { out.push(framed(bylineRow(inner))); source.push(off + byline.line); }
        }
      }
      edge(out.length);
      out.push(fg(colour) + "╰" + "─".repeat(bw - 2) + "╯" + RESET);
      blocks.push({ kind: "callout", row: top, rows: out.length - top, line: i, end: cb.end, inner: [i + 1, cb.end], strip: cb.depth, text: written, col: bw - 2 });
      i = cb.end - 1;
      continue;
    }

    // Table: header row, separator row, body rows.
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(src[i + 1] ?? "")) {
      const rows: string[] = [line];
      for (i++; i < src.length && /^\s*\|/.test(src[i]!); i++) rows.push(src[i]!);
      i--;
      out.push(...table(rows, W, lit(i)));
      continue;
    }

    // Transclusions: each `!((…))` becomes its shaded region; the text around it stays where it was.
    // Inline code keeps its text (fences are consumed above): an embed in a code span is its text.
    if (env.embed && line.includes("!((")) {
      const pieces: (string | { id: string; fragment?: string })[] = [];
      const code = codeSpanRanges(line);
      let at = 0;
      for (const l of linkOccurrences(line)) {
        if (l.kind !== "block" || !l.embed || code.some(c => c.start < l.end && l.start < c.end)) continue;
        pieces.push(line.slice(at, l.start), { id: l.blockId, fragment: l.fragmentId });
        at = l.end;
      }
      if (pieces.length) {
        pieces.push(line.slice(at));
        pieces.forEach((p, k) => {
          if (typeof p !== "string") { out.push(...env.embed!(p.id, p.fragment, embeds++, W)); return; }
          const t = k === 0 ? p.trimEnd() : p.trim();
          if (t.trim() && !/^\s*([-*]|\d+[.)])\s*$/.test(t)) out.push(...prose(t, W, undefined, lit(i)));
        });
        continue;
      }
    }
    // A heading or a rule with a style (PIE-599): its band or track, else as written without the style's property.
    // A `---` under a paragraph line is that line's setext underline, never a rule; `***` and `___` always are rules.
    const prev = i ? src[i - 1]! : "";
    const setext = /^ {0,3}-/.test(line) && !!prev.trim() && !HEADING.test(prev);
    const declared = lit(i) ? null : styleDeclaration(line, W);
    if (declared) { out.push(...declared); continue; }
    const styled = styledHeading(line, W, env, lit(i)) ?? (rawStructure[i] === -1 && !setext ? styledRule(line, W, env) : null);
    if (styled) { out.push(...styled.rows); continue; }
    const rows = prose(line, W, undefined, lit(i), env.task && (box => env.task!(i, box)));
    proseCuts(line, W).forEach((c, k) => { if (c.length && k < rows.length) cut(out.length + k, ...c); });
    // A run of `>` lines is one quote: its copy control is on the first.
    if (/^\s*>/.test(line)) {
      const text = line.replace(/^\s*> ?/, ""), last = blocks.at(-1);
      if (last?.kind === "quote" && last.end === i && last.row + last.rows === out.length) { last.rows += rows.length; last.end = i + 1; last.inner[1] = i + 1; last.text += "\n" + text; }
      else blocks.push({ kind: "quote", row: out.length, rows: rows.length, line: i, end: i + 1, inner: [i, i + 1], strip: 1, text, col: W - 1 });
    }
    out.push(...rows);
  }
  mark();
  insert(src.length);
  // The inline code spans as drawn (nested documents' are found again in the rows they were framed into), and every block in reading order.
  const finish = (lines: string[]) => { blocks.push(...codeSpans(lines, source)); blocks.sort((a, b) => a.row - b.row || a.col - b.col); return blocks; };
  // A glyph the drawing adds after a link (the ↗ of a link to the web) is marked ADORN: its cell is a cut, drawn and never copied.
  out.forEach((row, r) => { for (let at = row.indexOf(ADORN); at >= 0; at = row.indexOf(ADORN, at + 1)) { const col = vwidth(row.slice(0, at)); cut(r, [col, col + 1]); } });
  if (env.keepTags) { const lines = out.map(stripMarks); return { lines, images, media: mediaRefs, links: [], source, heads, trims, blocks: finish(lines), ...(hero ? { hero } : {}) }; }
  const { lines, ranges } = extractLinks(out.map(stripMarks));
  return { lines, images, media: mediaRefs, links: ranges, source, heads, trims, blocks: finish(lines), ...(hero ? { hero } : {}) };
}

/** Rows `cols` cells of `m` take, its aspect kept. */
const rowsFor = (m: { width: number; height: number }, cols: number, env: DocEnv) => Math.max(1, Math.round((cols * env.cellW * m.height) / m.width / env.cellH));
const colsFor = (m: { width: number; height: number }, rows: number, env: DocEnv) => Math.max(1, Math.round((rows * env.cellH * m.width) / m.height / env.cellW));

/**
 * Where an image goes in a body `W` wide: its width from `[size::…]` (cells, a share of the body, or all of it) or
 * from `[height::…]`, else about half its own pixels (a small image isn't blown up to the full width); its aspect
 * kept, inside both when both are written, at most `maxImageRows` tall; then placed by `[align::…]`.
 */
export function imageBox(m: { width: number; height: number }, spec: MediaSpec, W: number, env: DocEnv): { col: number; cols: number; rows: number } {
  const s = spec.size;
  let cols = s === "full" ? W : s && "percent" in s ? Math.round((W * s.percent) / 100) : s ? s.cells
    : spec.height ? colsFor(m, spec.height, env) : Math.max(Math.min(W, 24), Math.round((m.width / env.cellW) * 0.5));
  cols = Math.max(1, Math.min(W, cols));
  let rows = rowsFor(m, cols, env);
  const most = Math.min(env.maxImageRows, spec.height ?? Infinity);
  if (rows > most) { rows = Math.max(1, most); cols = Math.max(1, Math.min(W, colsFor(m, rows, env))); }
  const col = spec.align === "center" ? Math.floor((W - cols) / 2) : spec.align === "right" ? W - cols : 0;
  return { col, cols, rows };
}

/**
 * Where a header image goes in a width of `W` cells, at most `cap` rows tall: the full width, the whole image, when it
 * fits under the cap; taller, cropped to fill the cap around its middle (`[fit::cover]`, the default), or shown whole
 * in the middle of the cap's rows (`[fit::contain]`).
 */
export function heroBox(m: { width: number; height: number }, spec: MediaSpec, W: number, cap: number, cellW: number, cellH: number): { col: number; cols: number; rows: number; crop?: { x: number; y: number; w: number; h: number } } {
  const own = Math.max(1, Math.round((W * cellW * m.height) / m.width / cellH)), most = Math.max(1, cap);
  if (own <= most) return { col: 0, cols: W, rows: own };
  if (spec.fit === "contain") {
    const cols = Math.max(1, Math.min(W, Math.round((most * cellH * m.width) / m.height / cellW)));
    return { col: Math.floor((W - cols) / 2), cols, rows: most };
  }
  const crop = coverCrop(m, W * cellW, most * cellH, spec.focus);
  return { col: 0, cols: W, rows: most, ...(crop ? { crop } : {}) };
}

/**
 * The part of `m` (as fractions of it) that fills a box `pxW` × `pxH` pixels with its aspect kept, around `focus`
 * (`[hero-focus::x,y]`; its middle when there's none), kept inside the image.
 */
export function coverCrop(m: { width: number; height: number }, pxW: number, pxH: number, focus: Focus = { x: 0.5, y: 0.5 }): { x: number; y: number; w: number; h: number } | undefined {
  const box = pxW / pxH, own = m.width / m.height;
  const at = (f: number, span: number) => Math.max(0, Math.min(1 - span, f - span / 2));
  if (Math.abs(box - own) / own < 0.01) return undefined;
  if (own > box) { const w = box / own; return { x: at(focus.x, w), y: 0, w, h: 1 }; }
  const h = own / box;
  return { x: 0, y: at(focus.y, h), w: 1, h };
}

/**
 * An image's caption: what it is (its name, size in pixels, alt text, the layout written), what's wrong with what's
 * written, and its controls when the reader tags them (− + its size, ◂ ▸ where it sits, ▀ the header). It is also
 * the row the image's `[ ]` element is on.
 */
function caption(entry: Media, spec: MediaSpec, W: number, env: DocEnv, line: number, hero: boolean): string {
  const name = env.printed ? entry.path : entry.path.split("/").pop()!;
  const label = hero ? "▀ header" : spec.kind === "video" ? "▶" : "▣";
  const facts = [
    entry.state === "ready" ? `${entry.width}×${entry.height}${spec.kind === "video" ? " poster frame" : ""}` : "",
    hero ? [spec.height ? `${spec.height} rows` : "", spec.fit ?? ""].filter(Boolean).join(" ") : sizeText(spec.size),
    hero ? "" : spec.align && spec.align !== "left" ? spec.align : "",
    spec.dim !== undefined ? `dim ${spec.dim}` : entry.state === "ready" && brightness(entry.mean) < 1 ? "dimmed" : "",
    spec.alt ? `“${spec.alt}”` : "",
  ].filter(Boolean);
  // Its controls, at the right end, kept whole: the text before them is cut first.
  const tag = env.image;
  const ctl = (c: ImageControl, text: string) => fg(C.cyan) + tag!(line, c, text) + fg(C.dark);
  const controls = !tag || entry.state === "error" ? ""
    : hero ? ` ${ctl({ size: -1 }, "[−]")}${ctl({ size: 1 }, "[+]")} rows ${spec.fit === "contain" ? ctl({ fit: "cover" }, "[fill]") : ctl({ fit: "contain" }, "[whole]")} ${ctl({ hero: false }, "[▀ ✓]")}`
    : ` ${ctl({ size: -1 }, "[−]")}${ctl({ size: 1 }, "[+]")} ${ctl({ align: -1 }, "[◂]")}${ctl({ align: 1 }, "[▸]")} ${ctl({ hero: true }, "[▀]")}`;
  const room = Math.max(4, W - vwidth(controls));
  const fit = (x: string) => (vwidth(x) > room ? splitVisible(x, room - 1)[0] + "…" : x);
  if (entry.state === "loading") return fg(C.dark) + pad(fit(`◌ ${label} ${name} · loading…`), room) + controls + RESET;
  if (entry.state === "error") return fg(C.lred) + pad(`✗ ${label} ${name} · ${entry.reason}`, W) + RESET;
  const off = !env.graphics && env.noImages && !env.printed ? ` · ${env.noImages}` : "";
  const problems = spec.problems.length ? ` · ⚠ ${spec.problems.join(" · ")}` : "";
  // Why it isn't drawn comes before what it is: cut short, the facts go first.
  const head = fit([`${label} ${name}${off}`, ...facts].join(" · ") + problems);
  // What's wrong is said in yellow, after what it is.
  const at = problems ? head.lastIndexOf(" · ⚠") : -1;
  const text = at >= 0 ? head.slice(0, at) + fg(C.yellow) + head.slice(at) + fg(C.dark) : head;
  return (env.graphics ? fg(C.dark) : fg(C.cyan)) + pad(text, room) + controls + RESET;
}

/**
 * How a fold point is drawn: every one shows its disclosure, a click target as much as a sign (▾ open,
 * ▸ folded, with what it hides); the one the keys selected is yellow.
 */
interface Disclosure { folded: boolean; selected: boolean; hidden: number }
const foldedNote = (d: Disclosure) => fg(C.dark) + ` · ${d.hidden} line${d.hidden === 1 ? "" : "s"} folded` + RESET;

/** A list item's step box at the start of its text. */
const BOX = /^\[[ xX~!]\](?=\s|$)/;

/**
 * The style a heading or rule line draws with: the one it names, else its level's (or every rule's) default, with the
 * line's own fields (`[heading-tone::amber]`) over it; a line with fields and no style gets the base style (a rule, the
 * fade). A style it names that nothing declares: none, drawn as written.
 */
function styleOf(line: string, env: DocEnv): { style: HeadingStyle | null; text: string; level: number; kind: "heading" | "rule" } | null {
  const sl = styledLine(line);
  if (!sl) return null;
  const reg = env.headings ?? BUILTIN_HEADING_STYLE_REGISTRY;
  const named = sl.style !== null ? reg.style(sl.style) : sl.kind === "heading" ? reg.forLevel(sl.level) : reg.forRule();
  const base = named ?? (sl.style !== null || !sl.fields.length ? null : sl.kind === "rule" ? reg.style("fade") ?? BASE_HEADING_STYLE : BASE_HEADING_STYLE);
  return { style: base && headingStyleWith(base, sl.fields).style, text: sl.text, level: sl.level, kind: sl.kind };
}

/** A property token left on a heading in a band (`[who::sam]`): a chip after the heading, never its text. */
const propertyChip = (t: { key: string; value: string }) => chip(C.dark, C.grey) + ` ${t.key}::${t.value} ` + RESET;

/**
 * A line that declares a heading style (`# Plot style [heading-style::plot] [heading-pattern::dots] …`, anywhere in a
 * note): what it declares, as chips, and a small band drawn by it; never its tokens (raw and the editor show them).
 * Null for any other line.
 */
function styleDeclaration(line: string, W: number): string[] | null {
  const d = headingStyleDeclaration(line);
  if (!d) return null;
  const s = d.style;
  const text = d.text.replace(/^#{1,6}\s+/, "");
  const facts = s ? [
    s.pattern, `${s.rows} row${s.rows === 1 ? "" : "s"}`, `${s.align}/${s.row}`,
    ...(s.tone !== "neutral" ? [s.tone] : []), ...(s.letters !== "plain" ? [s.letters] : []),
    ...(s.padding.rows || s.padding.cols !== 2 ? [`padding ${s.padding.rows} ${s.padding.cols}`] : []),
    ...(s.margin.top || s.margin.cols || s.margin.bottom ? [`margin ${s.margin.top} ${s.margin.cols} ${s.margin.bottom}`] : []),
    ...(s.defaults.length ? [`default for ${s.defaults.map(x => (x === "rule" ? "---" : "#".repeat(x))).join(" ")}`] : []),
  ] : [];
  const name = s?.name ?? liveTokensInLine(line).find(t => t.key === "heading-style")?.value ?? "";
  const summary = chip(C.dark, C.white) + ` style ${name} ` + RESET + fg(C.grey) + (facts.length ? " " + facts.join(" · ") : "") + RESET
    + (d.problems.length ? fg(C.yellow) + " · ⚠ " + d.problems.join(" · ") + RESET : "")
    + (text ? fg(C.dark) + "  " + text + RESET : "");
  const out = [headOf(summary, W) + RESET];
  // The preview: the style drawn on its own name, in the room a narrow note leaves.
  const band = s && drawBand(s, Math.min(W, 56), 2, BOLD + (s.tone !== "neutral" ? fg(TONE[s.tone]) : fg(C.white)) + bandLetters(text || name, s.letters) + UNBOLD + RESET, text || name);
  if (band) out.push(...band.rows);
  return out;
}

/**
 * A heading with a style (PIE-599): its band (src/figures/banner.ts) and the row its text is on; or, narrower than the
 * figures' tier rule or too long for the band, the heading as `#` draws it, without the style's property. Null for a
 * line that isn't a heading, or a heading with no style and no property.
 */
function styledHeading(line: string, W: number, env: DocEnv, literal: boolean, fold?: Disclosure): { rows: string[]; headRow: number } | null {
  const st = styleOf(line, env);
  if (!st || st.kind !== "heading" || (st.style === null && st.text === line)) return null;
  // `## [heading::band]` is a heading with no text: drawn as written.
  const h = st.text.match(HEADING);
  if (!h) return { rows: prose(st.text, W, fold, literal), headRow: 0 };
  const band = st.style && drawBand(st.style, W, st.level, headingLabel(h[2]!, st.level, st.style, fold), stripMarks(h[2]!));
  if (band) return { rows: band.rows, headRow: band.textRow };
  const margin = st.style?.margin;
  const plain = prose(st.text, W, fold, literal);
  if (!margin) return { rows: plain, headRow: 0 };
  const m = withMargin(margin, plain, 0);
  return { rows: m.rows, headRow: m.textRow };
}

/** A rule (`---`) with a style: its track, or as written when narrow. Null for a line that isn't one, or a plain one. */
function styledRule(line: string, W: number, env: DocEnv): { rows: string[] } | null {
  const st = styleOf(line, env);
  if (!st || st.kind !== "rule" || (st.style === null && st.text === line)) return null;
  const track = st.style && drawTrack(st.style, W);
  if (track) return { rows: track };
  const rows = wrap(st.text.trim(), W).map(l => fg(C.dark) + l + RESET);
  return { rows: st.style ? withMargin(st.style.margin, rows, 0).rows : rows };
}

/**
 * A styled heading's text as its band draws it: its disclosure, its letters as the style says, in the heading's bold
 * and the style's tone (neutral: the accent for a #, white for ##, grey deeper), and what a fold hides.
 */
function headingLabel(text: string, level: number, style: HeadingStyle, fold?: Disclosure): string {
  const glyph = fold ? (fold.folded ? "▸" : "▾") : "";
  const ink = fold?.selected ? C.yellow : style.tone !== "neutral" ? TONE[style.tone] : level <= 1 ? C.lcyan : level === 2 ? C.white : C.grey;
  const props = liveTokensInLine(text), words = props.length ? withoutTokens(text, props).trim() : text;
  return (glyph ? (fold!.selected ? fg(C.yellow) : fg(C.lcyan)) + glyph + " " : "") + BOLD + fg(ink) + styleMarks(bandLetters(words, style.letters), { bold: false }) + UNBOLD + RESET
    + props.map(t => " " + propertyChip(t)).join("") + (fold?.folded ? foldedNote(fold) : "");
}

/** Blockquote, heading, list item or paragraph. `task`: what a list item's step box is drawn as (DocEnv.task). */
function prose(line: string, W: number, fold?: Disclosure, literal = false, task?: (box: string) => string | null): string[] {
  const out: string[] = [];
  const inline = (s: string) => inlineOf(s, literal);
  if (/^\s*>/.test(line)) { for (const l of wrap(line.replace(/^\s*> ?/, ""), W - 2, BODY)) out.push(fg(C.green) + "▌ " + RESET + inline(l)); return out; }
  const glyph = fold ? (fold.folded ? "▸" : "▾") : "";
  const tint = fold?.selected ? fg(C.yellow) : fg(C.lcyan);
  const h = line.match(HEADING);
  if (h) return [(glyph ? tint + glyph + " " : "") + fg(C.dark) + h[1] + " " + RESET + BOLD + fg(fold?.selected ? C.yellow : C.white) + styleMarks(h[2]!, { bold: false }) + RESET + (fold?.folded ? foldedNote(fold) : "")];
  const li = line.match(ITEM);
  if (li) {
    const indent = li[1]!.length, num = /\d/.test(li[2]!);
    // A folded bullet becomes its disclosure; a number keeps its place with the disclosure after it.
    const mark = num ? li[2]! + glyph : glyph || "∙";
    // Deep indentation in a narrow reader keeps some room for the text: the indent gives way first.
    const room = Math.min(MIN_ITEM_TEXT, W - mark.length - 1);
    const lead = " ".repeat(Math.max(0, Math.min(indent, W - mark.length - 1 - room))) + mark + " ";
    const box = task ? li[3]!.match(BOX)?.[0] : undefined;
    const drawn = box ? task!(box) : null;
    const rows = wrap(drawn !== null ? drawn + li[3]!.slice(box!.length) : li[3]!, W - lead.length, BODY);
    rows.forEach((l, k) => out.push((k ? " ".repeat(lead.length) : (fold ? tint : fg(C.lcyan)) + lead + RESET) + inline(l) + (fold?.folded && k === rows.length - 1 ? foldedNote(fold) : "")));
    return out;
  }
  if (!line.trim()) return [""];
  return wrap(line, W, BODY).map(inline);
}

const CODE_ON = fg(C.lmagenta), CODE_OFF = fg(C.grey), TAG_CHAR = /[\u{100000}-\u{10FFFD}]/u;
/**
 * The inline code spans in drawn `lines`, as colourBody draws them (magenta, then back to grey: nothing else ends that way), one block
 * each (`kind: "span"`). A span the wrap cut across rows is one: its text joined with a space.
 */
function codeSpans(lines: readonly string[], source: readonly number[]): DocBlock[] {
  const out: DocBlock[] = [];
  const cellsOfRow = (l: string) => l.split(/\x1b\[[\d;]*m/).join("").split("").filter(c => !TAG_CHAR.test(c));
  lines.forEach((line, row) => {
    const parts = line.split(/(\x1b\[[\d;]*m)/);
    let col = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.startsWith("\x1b[")) {
        const text = parts[i + 1] ?? "";
        if (p === CODE_ON && parts[i + 2] === CODE_OFF && text.replace(TAG_CHAR, "").trim()) {
          const t = [...text].filter(c => !TAG_CHAR.test(c)).join("");
          out.push({ kind: "span", row, rows: 1, line: source[row] ?? 0, end: (source[row] ?? 0) + 1, inner: [0, 0], strip: 0, text: t, col, to: col + [...t].length });
        }
        continue;
      }
      col += [...p].filter(c => !TAG_CHAR.test(c)).length;
    }
  });
  // A span the wrap cut: the last on its row, then the first on the next, with only blanks, bars and a list's lead around them.
  const merged: DocBlock[] = [];
  for (const b of out) {
    const prev = merged.at(-1);
    if (prev && prev.row + prev.rows === b.row) {
      const before = cellsOfRow(lines[b.row]!).slice(0, b.col).join(""), after = cellsOfRow(lines[prev.row]!).slice(prev.to!).join("");
      const firstOnRow = !out.some(o => o !== b && o.row === b.row && o.col < b.col), lastOnRow = !out.some(o => o !== prev && o.row === prev.row && o.col > prev.col);
      if (firstOnRow && lastOnRow && /^[\s│▌∙]*$/.test(before) && /^[\s│]*$/.test(after)) { prev.text += " " + b.text; prev.rows += 1; continue; }
    }
    merged.push({ ...b });
  }
  return merged;
}

/**
 * The cells of `prose(line, W, fold)`'s rows that are drawing, not the note's words (a copy leaves them out): a quote's bar, a
 * bullet glyph or fold arrow with the space after it, and the indent a wrapped item's next rows are drawn with.
 */
function proseCuts(line: string, W: number, fold?: Disclosure): [number, number, string?][][] {
  if (/^\s*>/.test(line)) {
    const body = line.replace(/^\s*> ?/, ""), item = /^(\s*)([-*]) /.exec(body);
    // colourBody draws a quoted "- " as a bullet glyph: copied as the note's own marker.
    return wrap(body, W - 2, BODY).map((_, k) => (k === 0 && item ? [[0, 2], [2 + item[1]!.length, 4 + item[1]!.length, item[2]! + " "]] : [[0, 2]]));
  }
  const glyph = fold ? (fold.folded ? "▸" : "▾") : "";
  if (HEADING.test(line)) return [glyph ? [[0, 2]] : []];
  const li = line.match(ITEM);
  if (!li) return [];
  const indent = li[1]!.length, num = /\d/.test(li[2]!);
  const mark = num ? li[2]! + glyph : glyph || "∙";
  const room = Math.min(MIN_ITEM_TEXT, W - mark.length - 1);
  const at = Math.max(0, Math.min(indent, W - mark.length - 1 - room)), lead = at + mark.length + 1;
  // The box of a step is drawn in place of its text: what `wrap` makes of the rest isn't known here, so the rows after
  // the first are cut by the indent they are drawn with (rows past those the item has are ignored).
  // A bullet glyph is the list marker as the note has it ("- ", "* ") when copied; a number is drawn as written.
  const first: [number, number, string?][] = !num ? [[at, lead, li[2]! + " "]] : glyph ? [[at + li[2]!.length, at + mark.length]] : [];
  return [first, ...Array.from({ length: 64 }, () => [[at, lead]] as [number, number][])];
}

function chunk(s: string, w: number): string[] {
  if (vwidth(s) <= w) return [s];
  const out: string[] = [];
  for (let rest = s; rest; ) { const [head, tail] = splitVisible(rest, w); out.push(head); rest = tail; }
  return balanceStyles(balanceTags(out));
}

function cells(row: string): string[] {
  const parts: string[] = [];
  let cur = "", esc = false;
  for (const ch of row.trim()) {
    if (esc) { cur += ch; esc = false; continue; }
    if (ch === "\\") { esc = true; continue; }
    if (ch === "|") { parts.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur.trim());
  if (row.trim().startsWith("|")) parts.shift();
  if (row.trim().endsWith("|")) parts.pop();
  return parts;
}

/** A real table: columns sized to fit, long cells wrap onto more lines instead of truncating. */
export function table(rows: string[], W: number, literal = false): string[] {
  const head = cells(rows[0]!);
  const align = cells(rows[1]!).map(a => (a.startsWith(":") && a.endsWith(":") ? "c" : a.endsWith(":") ? "r" : "l"));
  const body = rows.slice(2).map(cells);
  const n = Math.max(head.length, ...body.map(r => r.length));
  const all = [head, ...body].map(r => Array.from({ length: n }, (_, k) => r[k] ?? ""));
  // Measured as drawn: link and style marks take no room.
  const natural = Array.from({ length: n }, (_, k) => Math.max(1, ...all.map(r => vwidth(r[k]!))));
  const longestWord = Array.from({ length: n }, (_, k) => Math.max(1, ...all.flatMap(r => r[k]!.split(/\s+/).map(w => vwidth(w)))));
  const avail = Math.max(n * 3, W - (n + 1) - n * 2);
  let widths = natural.slice();
  if (widths.reduce((a, b) => a + b, 0) > avail) {
    const min = natural.map((v, k) => Math.min(v, Math.max(4, Math.min(longestWord[k]!, 18))));
    const spare = avail - min.reduce((a, b) => a + b, 0);
    const want = natural.map((v, k) => v - min[k]!);
    const total = want.reduce((a, b) => a + b, 0) || 1;
    widths = min.map((m, k) => m + Math.max(0, Math.floor((spare * want[k]!) / total)));
  }
  const B = (s: string) => fg(C.cyan) + s + RESET;
  const rule = (l: string, m: string, r: string) => B(l + widths.map(w => "─".repeat(w + 2)).join(m) + r);
  const fit = (s: string, w: number, a: string) => {
    const v = vwidth(s);
    if (v >= w) return pad(s, w);
    const gap = w - v;
    return a === "r" ? " ".repeat(gap) + s : a === "c" ? " ".repeat(gap >> 1) + s + " ".repeat(gap - (gap >> 1)) : s + " ".repeat(gap);
  };
  const line = (r: string[], header: boolean) => {
    const wrapped = r.map((c, k) => (c ? wrap(c, widths[k]!, BODY) : [""]));
    const h = Math.max(...wrapped.map(w => w.length));
    const out: string[] = [];
    for (let y = 0; y < h; y++)
      out.push(B("│") + wrapped.map((w, k) => " " + fit(header ? BOLD + fg(C.white) + (w[y] ?? "") + RESET : inlineOf(w[y] ?? "", literal), widths[k]!, align[k] ?? "l") + " ").join(B("│")) + B("│"));
    return out;
  };
  const out = [rule("┌", "┬", "┐"), ...line(all[0]!, true), rule("╞", "╪", "╡").replace(/─/g, "═")];
  all.slice(1).forEach((r, k) => { out.push(...line(r, false)); if (k < all.length - 2) out.push(rule("├", "┼", "┤")); });
  out.push(rule("└", "┴", "┘"));
  return out;
}

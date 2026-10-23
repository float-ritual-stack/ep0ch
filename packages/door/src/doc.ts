import { expandsEmbeds } from "./embed-policy";
import { clipText } from "./overflow";
import { componentRowFields } from "./look";
import { heroLook } from "./surface/hero-look";
import { isArtifactName } from "@ep0ch/outline-core/artifacts";
import { startsTable, tableEnd, tableCells, tableAligns } from "@ep0ch/outline-core/table-shape";
// Render a note body into terminal lines: headings, lists, code fences, Obsidian-style
// callouts as boxes, Markdown tables as real tables with wrapped multi-line cells, and
// media lines as image slots the caller fills with Kitty placements.
import { ARTIFACT_KIND_LABELS, brightness, fileName, media, parseMediaLine, sizeText, type Focus, type Media, type MediaSpec } from "./media";
import { artifactFacts, type ArtifactFacts } from "./artifacts";
import { ADORN, balanceStyles, balanceTags, BOLD, C, chip, drawEllipsized, extractLinks, fg, fgRgb, surfaceBg, type LinkRange, pad, RESET, splitVisible, stripTags, visible, styleMarks, trimTagged, UNBOLD, width as vwidth } from "./style";
import { colourBody, wrap } from "./text";
import { componentBlocks, noteCodeFences, noteStructure } from "@ep0ch/outline-core/component-block";
import { figureSource, frame, graphKind, reframeAscii, renderGraph, type FiguresEnv, type RowInline } from "./graphs";
import { linkBlockAt, renderLinkBlock, type LinkBlocksEnv } from "./links";
import { siteBlockAt } from "@ep0ch/outline-core/site-blocks";
import { ifProblemLines, ifState, renderFields, type FieldsDrawing } from "./site-blocks";
import { regionTail, type RegionBook } from "./output-region";
import { outputHeader, type OutputRegion } from "@ep0ch/outline-core/output-region";
import { useCallAt, type UseCall } from "@ep0ch/outline-core/template-use";
import { buttonCallAt, buttonCallsOf, type ButtonCall } from "@ep0ch/outline-core/button-call";
import type { LiveSite } from "./live";
import { stripMarks, type LinkTarget } from "./refs";
import { codeFenceInfo, SCRIPT_FENCE } from "@ep0ch/outline-core/code-fence";
import { codeSpanRanges } from "@ep0ch/outline-core/code-ranges";
import { linkOccurrences, withoutFragmentAnchor } from "@ep0ch/outline-core/link-syntax";
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, quoteDepth, quoteByline, stripQuotes, type CalloutBlock, type CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { TONE } from "./callouts";
import { BASE_HEADING_STYLE, BUILTIN_HEADING_STYLE_REGISTRY, headingStyleDeclaration, headingStyleWith, liveTokensInLine, styledLine, withoutTokens, type HeadingStyle, type HeadingStyleRegistry } from "@ep0ch/outline-core/heading-styles";
import { bandLetters, drawBand, drawTrack, withMargin } from "./figures/banner";
import { BORDER_BOXES } from "./canvas";
import { dividerLine, gapSlots } from "./list-look";
import { zebraBg } from "./surface/selection";
import { theme } from "./theme";
import { BASE_STYLE, headingComponentLayer, listLayers, parseStyleAttrs, resolveStyle, styleFieldsOf, type StyleLayer, type StyleValues } from "@ep0ch/outline-core/style-cascade";
import { STEP_BOX, type ChecklistStatus } from "@ep0ch/outline-core/checklist-marks";

export interface DocEnv {
  fields?: FieldsDrawing;
  fieldsAnswer?: Extract<import("@ep0ch/outline-core/protocol").SiteProduced, { kind: "fields" }>;
  width: number; cellW: number; cellH: number; graphics: boolean; maxImageRows: number; unfold: boolean;
  /**
   * The look (PIE-673): its list rows (gap, divider, zebra) and heading spacing, and the layers it came from, which a
   * heading's style and a `::box{…}` add theirs to. Without it the body is drawn as it always was.
   */
  look?: {
    values: StyleValues; layers: readonly StyleLayer[]; width: number;
    /**
     * A list's own fields (PIE-675, `this list`) on body line `line` (`written`: what the line says), with the tuning
     * over them: the reader's, mapping its body line to the note's. Without it, the line as written.
     */
    lists?: (line: number, written: Readonly<Record<string, string>>) => Record<string, string>;
  };
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
   * Draw the `::use` call on body line `line` (PIE-533 S4, src/template-use.ts): a template drawn live, its body in place with
   * `this` the note the line is in. Without it (an embed, a draft's preview, an export) the line stays text.
   */
  use?: (call: UseCall, line: number, width: number) => string[] | AfterRows;
  /** A `::button` (PIE-957) drawn: a chip the reader tags as a press. Without it the line is drawn as written. */
  button?: (call: ButtonCall, line: number, width: number) => string[];
  /** Where generated regions (a `::use`, an `[!output]` callout) keep their mark and whether one is open (src/output-region.ts). */
  regions?: RegionBook;
  /** The output regions of the note's body by their header line (outline-core output-region.ts, read from the text as written): the producer, hash and anchor the presented lines have lost. */
  outputs?: ReadonlyMap<number, OutputRegion>;
  /**
   * The Site this body is drawn in when it is a template's (a `::use` draws it): the chain of invocations and the call's
   * props. Its figures, `::fields` and `::if` read `this` through it (the host), and `{{props.x}}` as the call passed it.
   */
  site?: LiveSite;
  /**
   * The body's fold points (from `foldPoints` of the same body, line for line), which of them are folded,
   * and the one selected by the keys. Without it nothing folds (an embed, a draft's preview).
   */
  folds?: { points: readonly FoldPoint[]; folded: ReadonlySet<string>; selected?: string | null; preview?: ReadonlySet<string> };
  /**
   * Tag `text` as a link to a row's note (a live figure's check item, event or table row), so the reader
   * can step to it and a click opens it (PIE-441). Without it (an embed, a draft's preview) rows are text.
   */
  link?: import("./figures/palette").RowLink;
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
   * The reader's hold on the body's inline `::links` components (PIE-693, src/links.ts LinkBlocksEnv): each one's
   * selected row and whether the person is in it, its rows and `⏎ in` tagged, its preview drawn as an embed. Without
   * it (an embed, a draft's preview) a component draws its list as text.
   */
  linkBlocks?: LinkBlocksEnv;
  inlineList?: import("./surface/inline-list").InlineListDraw;
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
  after?: (line: number, width: number) => string[] | AfterRows;
  /**
   * A list item's step box (`[ ]`, `[x]`, `[~]`, `[!]`, `[✓]`, `[✗]`: outline-core's checklist-marks.ts) on body line `line`: the text to draw in its place
   * (the reader tags it, so `[ ]` stops on it and a click opens its status choice, PIE-472), or null to
   * leave it as text. The reader offers it only where the service reads a checklist step. Without it (a
   * draft's preview) boxes are text.
   */
  task?: (line: number, box: string) => string | null;
  /**
   * A live `::graph-check` row's box (PIE-864): the row's note `block`, its status, its words and what a mark writes
   * (outline-core's liveMark: the property its `done:` names). The text to draw in its place (the reader tags it as a
   * step, so the choice opens on it and a mark writes that property), or null to leave it text.
   */
  liveStep?: (row: { block: string; status: ChecklistStatus; label: string; mark: { key: string; done: string } }, box: string) => string | null;
  /**
   * A component's words as the reader presents a line of the note (PIE-864: presentLinks with the reader's sink), so a
   * figure row's links follow, its `#tags` and `[[pages]]` open and its code spans copy. `linked`: the row is itself a
   * link to its note, so its links aren't elements of their own. Without it (an embed, a draft's preview, an export) a
   * row is drawn as written.
   */
  present?: (text: string, linked: boolean) => string;
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
  heroLine?: number;
  /**
   * Tag `text` as a control of the image on body line `line` (its caption's − + ◂ ▸ ▀), so a click runs that
   * change. Without it (an embed, a draft's preview, `ep0ch show`) the caption has no controls.
   */
  image?: (line: number, control: ImageControl, text: string) => string;
  /**
   * An artifact line's facts for its card (PIE-793, src/artifacts.ts): its kind and title, its file read through the
   * service. Without it (an embed, `ep0ch show`) the card names its file.
   */
  artifact?: (spec: MediaSpec) => ArtifactFacts;
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
/** A control on an image's caption: a size step, an alignment step, or the header on or off; on an artifact's card, open. */
export type ImageControl = { size: 1 | -1 } | { align: 1 | -1 } | { hero: boolean } | { fit: "cover" | "contain" } | { open: true };
/**
 * An image laid out on the body's rows: `col` cells in, `cols` × `rows` cells; `crop` the part of it shown, as
 * fractions of the image (a header's cover crop).
 */
export interface DocImage { line: number; col: number; rows: number; cols: number; media: Extract<Media, { state: "ready" }>; crop?: { x: number; y: number; w: number; h: number }; dim?: number; look?: import("./media").Look }
/**
 * A media line as drawn: the file, its kind, the row naming it (its caption), the body line it's on, what the line says
 * of its layout, and `image`, its index in `Doc.images` when it's laid out there.
 */
export interface DocMedia { path: string; kind: string; row: number; line: number; spec: MediaSpec; image?: number }
/**
 * `links`: where the body's tagged links (src/style.ts linkTag) landed, by row of `lines`. `media[i].row`:
 * the row that names the image or video (its caption, or the line in its place). `source[r]`: the
 * body line rendered row `r` comes from (the first line of a fence or figure for all of its
 * rows; -1 for decoration without source text). `heads`: each fold point drawn, at its row, with the columns of its disclosure (a heading's whole
 * row, a list item's indent and mark).
 */
export interface Doc {
  lines: string[]; images: DocImage[]; media: DocMedia[]; links: LinkRange[]; source: number[]; heads: { key: string; row: number; cols: number }[];
  /** The generated regions drawn (`env.after`'s `regions`), by row of `lines`. */
  regions?: DocRegion[];
  /** The drawing a copy leaves out, by row of `lines` (only rows that have some). */
  trims: Map<number, DocTrim>;
  /** The code blocks, quotes and callouts drawn, in reading order: what the copy control copies. */
  blocks: DocBlock[];
  /** The header image (`env.hero`): the first `[layout::hero]` image, drawn by the reader above the title. */
  hero?: DocMedia & { media: Media };
  /**
   * Backgrounds the look draws under rows (PIE-673, PIE-675): every other list item's zebra stripe, a box's surface.
   * Painted in order (a later one over an earlier), under the ruler and a thread's tint.
   */
  tints?: DocTint[];
  /**
   * Rows that carry on the row before them (a paragraph or list item soft-wrapped), each with what joins it to that row:
   * the whitespace the wrap took, or "" where it cut a word (src/text.ts wrap's `joins`). A copy joins by it, so the text
   * is the source at any width.
   */
  wraps?: Map<number, string>;
}

/**
 * Rows `env.after` inserts, with where the generated regions among them are (PIE-956): `at` is the row of `rows` a region's
 * first row is, `rows` how many it spans (its body and the panel under it). The reader draws each one's mark in the gutter.
 */
export interface AfterRows { rows: string[]; regions?: { key: string; at: number; rows: number }[] }
/** A generated region as drawn: where its rows are in `lines`, and the key the reader knows it by. */
export interface DocRegion { key: string; row: number; rows: number }

/** A background under rows [from, to) of `lines`, across cells [from, to) (`cols`; the whole row without), in `bg` (an SGR). */
export interface DocTint { rows: [number, number]; cols?: [number, number]; bg: string }

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
  /** An inline code span (`kind: "span"`, first row `col` to `to`): `text` its contents without the backticks. It has no control; a click on it copies. */
  to?: number;
  /** Each painted segment of a span, including its wrapped continuation rows. */
  cells?: { row: number; from: number; to: number }[] }

/**
 * A place the reader can fold: a heading (hiding everything through the next heading of the same or a
 * higher level), a list item with nested items or continuation lines under it, or a callout with a body
 * (PIE-538: `level` is its quote depth; `start` folded for `[!type]-`, which the reader folds when it first sees it). `line` is its body
 * line, `end` the line after the last it hides (trailing blank lines stay shown), `hidden` how many of
 * those have text. `key` names it across edits elsewhere in the note: its anchor (`^beds`) when it has
 * one, else its kind, level and text (without a step's box) with how many identical headings or items
 * come before it, folding or not.
 */
export interface FoldPoint { list?: { key: string; line: number; preview: boolean }; key: string; kind: "heading" | "list" | "callout"; level: number; text: string; line: number; end: number; hidden: number; start?: "folded" }

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
  const quoted = src.map(quoteDepth);
  const calloutList = calloutBlocks(src);
  const inCallout = src.map((_, i) => calloutList.some(c => i > c.line && i < c.end));
  const content = src.map((l, i) => inCallout[i] ? quoted[i]!.content : l);
  const block = noteStructure(src), images = mediaLines(src);
  // Scan each quoted body in its own scope: an unfinished fence ends with its callout.
  for (const c of calloutList) {
    const off = c.line + 1;
    const inside = noteStructure(src.slice(off, c.end).map(l => stripQuotes(l, c.depth)));
    inside.forEach((start, n) => { if (start >= 0 && block[off + n] === -1) block[off + n] = off + start; });
  }
  // A line declaring a heading style draws as what it declares, never a heading (`# Plot style [heading-style::plot]`).
  const foldable = (i: number) => block[i] === -1 && !images.has(i) && !linkOccurrences(src[i]!, "inline").some(l => l.kind === "block" && l.embed) && !headingStyleDeclaration(src[i]!);
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
  const callouts = new Map(calloutList.map(c => [c.line, c]));
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
    const li = content[i]!.match(ITEM);
    if (li) {
      // Nested items and continuation lines are indented past the item's own marker; a fence or figure
      // opened among them belongs to the item as a whole, however its lines are indented.
      const indent = li[1]!.length;
      let last = i;
      for (let j = i + 1; j < src.length; j++) {
        if (inCallout[i] && quoted[j]!.depth < quoted[i]!.depth) break;
        const l = inCallout[i] ? stripQuotes(src[j]!, quoted[i]!.depth) : src[j]!;
        if (block[j]! > i && block[j]! <= last) { last = j; continue; }
        if (!l.trim()) continue;
        if (indentOf(l) > indent) { last = j; continue; }
        break;
      }
      add("list", indent, li[3]!, i, last + 1);
    }
  }
  for (const p of out) if (p.kind === "list") {
    let first = p.line;
    for (let i = p.line - 1; i >= 0; i--) {
      if (quoted[i]!.depth !== quoted[p.line]!.depth) break;
      const l = content[i]!;
      if (!l.trim() || indentOf(l) > p.level) continue;
      if (l.match(ITEM)?.[1]!.length === p.level) first = i;
      else break;
    }
    const callout = calloutList.findLast(c => c.line < first && first < c.end);
    p.list = { key: `list:${out.find(q => q.kind === "list" && q.level === p.level && q.line >= first && q.line <= p.line && quoted[q.line]!.depth === quoted[p.line]!.depth)!.key}`, line: first, preview: !!callout?.metadata.includes("preview") || content[first - 1]?.trim() === "[children::preview]" };
  }
  return out;
}

/** A child's hooks stay in the owning note's coordinates; only its drawing is local. */
export function childEnv(env: DocEnv, { off, end, width }: { off: number; end: number; width: number }): DocEnv {
  const inside = (n: number) => n >= off && n < end;
  return {
    ...env, nested: true, width, keepTags: true,
    // Only the note's own first line can supply its header, never a child's first line.
    hero: false, heroLine: env.heroLine !== undefined && inside(env.heroLine) ? env.heroLine - off : -1,
    after: env.after && ((n, w) => n < 0 ? [] : env.after!(n + off, w)),
    task: env.task && ((n, box) => env.task!(n + off, box)),
    use: env.use && ((call, n, w) => env.use!(call, n + off, w)),
    button: env.button && ((call, n, w) => env.button!(call, n + off, w)),
    callout: env.callout && ((n, block) => env.callout!(n + off, { ...block, line: block.line + off, end: block.end + off })),
    image: env.image && ((n, control, text) => env.image!(n + off, control, text)),
    decorate: env.decorate && ((n, w) => { const d = env.decorate!(n + off, w); return d && { ...d, end: Math.min(d.end, end) - off }; }),
    outputs: env.outputs && new Map([...env.outputs].filter(([n]) => inside(n)).map(([n, region]) => [n - off, region])),
    look: env.look && { ...env.look, lists: env.look.lists && ((n, fields) => env.look!.lists!(n + off, fields)) },
    literal: env.literal && new Set([...env.literal].filter(inside).map(n => n - off)),
    folds: env.folds && { ...env.folds, points: env.folds.points.filter(p => inside(p.line)).map(p => ({ ...p, line: p.line - off, end: Math.min(p.end, end) - off, ...(p.list ? { list: { ...p.list, line: p.list.line - off } } : {}) })) },
  };
}

export function renderDoc(body: string, env: DocEnv): Doc {
  const out: string[] = [];
  const images: DocImage[] = [];
  const mediaRefs: Doc["media"] = [];
  let hero: Doc["hero"];
  let embeds = 0;
  const children = { ...env, embed: env.embed && ((id: string, fragment: string | undefined, _n: number, width: number) => env.embed!(id, fragment, embeds++, width)) };
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
  // A heading's or rule's margin rows (its style's, or the look's heading.margin) are spacing: edge rows, never copied.
  const wraps = new Map<number, string>();
  // A prose line's rows after its first carry it on, joined as the wrap said (a quote's don't: each row is a `>` line again).
  const wrapped = (at: number, joins: readonly (string | undefined)[]) => joins.forEach((j, k) => { if (k > 0 && j !== undefined) wraps.set(at + k, j); });
  const marginEdges = (at: number, h: { rows: string[]; margin?: { top: number; bottom: number } }) => {
    if (!h.margin) return;
    for (let r = 0; r < h.margin.top; r++) edge(at + r);
    for (let r = 0; r < h.margin.bottom; r++) edge(at + h.rows.length - 1 - r);
  };
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
    for (const [r, j] of sub.wraps ?? []) wraps.set(base + r, j);
    for (const r of sub.regions ?? []) regions.push({ ...r, row: base + r.row });
    for (const b of sub.blocks) if (b.kind !== "span") blocks.push({ ...b, row: base + b.row, line: b.line + off, end: b.end + off, inner: [b.inner[0] + off, b.inner[1] + off], strip: b.strip + quoted, col: b.col + dx });
  };
  const adoptMedia = (sub: Doc, base: number, dx: number, off: number) => {
    const imageBase = images.length;
    for (const im of sub.images) images.push({ ...im, line: im.line + base, col: im.col + dx });
    for (const x of sub.media) mediaRefs.push({ ...x, row: x.row + base, line: x.line + off, ...(x.image !== undefined ? { image: x.image + imageBase } : {}) });
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
  const regions: DocRegion[] = [];
  const insert = (to: number) => {
    for (; inserted < to; inserted++) {
      const got = env.after?.(inserted, W) ?? [];
      const rows = Array.isArray(got) ? got : got.rows;
      if (!Array.isArray(got)) for (const r of got.regions ?? []) regions.push({ key: r.key, row: out.length + r.at, rows: r.rows });
      out.push(...rows);
      for (const _ of rows) source.push(Math.max(0, inserted));
    }
  };
  if (env.after) inserted = -1;
  const look = env.look;
  const componentLines = (line: number, attrs = "", lines?: number) => {
    const own = { ...(lines !== undefined ? { "rows.lines": String(lines) } : {}), ...componentRowFields(attrs) };
    const fields = look?.lists ? look.lists(line, own) : own;
    return resolveStyle([...(look?.layers ?? []), { level: "block", label: "this component", fields }], look?.width ?? W).values["rows.lines"];
  };
  // A list's run: how many items so far, and its look (the page's, with the list's own over it: PIE-675's `this list`).
  let run: { n: number; v: StyleValues; stripe: string } | null = null, zebraFrom: number | null = null;
  const tints: DocTint[] = [];
  const endZebra = () => { if (zebraFrom !== null && out.length > zebraFrom && run?.stripe) tints.push({ rows: [zebraFrom, out.length], bg: run.stripe }); zebraFrom = null; };
  const runLook = (first: number): StyleValues => {
    const own = listLayers(src, first).map(l => (look!.lists ? { ...l, fields: look!.lists(l.line!, l.fields) } : l));
    return own.some(l => Object.keys(l.fields).length) ? resolveStyle([...look!.layers, ...own], look!.width).values : look!.values;
  };
  // The closing lines of the `::if` bodies drawn (not text).
  const ifCloses = new Set<number>();
  for (let i = 0; i < src.length; i++) {
    mark();
    insert(i);
    from = i;
    if (ifCloses.has(i)) continue;
    const line = src[i]!;

    // The look's list rows (PIE-673): blank rows and a divider between one item and the next, every other item tinted.
    // Drawn, never text: the gap and the divider are edge rows, so a copy across them joins the items with one newline.
    if (look && rawStructure[i] === -1 && !lit(i)) {
      if (ITEM.test(line)) {
        if (run) {
          endZebra();
          // list-look's one painter: the gap's rows, the divider at the top, centre or bottom of them, in its style.
          for (const slot of gapSlots(run.v, true)) { edge(out.length); out.push("divider" in slot ? dividerLine(run.v, W, (env.headings ?? BUILTIN_HEADING_STYLE_REGISTRY).style("fade")) : ""); }
          run.n++;
        } else { const v = runLook(i); run = { n: 0, v, stripe: zebraBg(v) }; }
        if (run.v["list.zebra"] && run.n % 2 === 1) zebraFrom = out.length;
      } else if (line.trim() && indentOf(line) === 0) { endZebra(); run = null; }
    }

    // A box (`::box{margin.x=2 list.gap=1}` … `::`, PIE-549's block attributes): the lines inside drawn by this same
    // renderer with the box as the block level of the look, inset by its margin and padding (drawn, never copied).
    const boxed = componentAt.get(i);
    if (boxed && boxed.name === "box" && boxed.attrs !== undefined) {
      const attrs = parseStyleAttrs(boxed.attrs);
      const layers = [...(look?.layers ?? []), { level: "block" as const, label: "box", fields: attrs.fields }];
      // At the tile's width (the look's), so a width variant means the same inside the box as around it.
      const at = look?.width ?? W;
      const v = resolveStyle(layers, at).values;
      // A box's own margin and padding are its own (as CSS's aren't inherited); the list tokens carry on from the page.
      const own = resolveStyle([{ level: "block", label: "box", fields: attrs.fields }], at);
      const mine = (t: "margin.x" | "pad.x" | "margin.y" | "pad.y") => (own.sources[t].level === "block" ? own.values[t] : 0);
      // Its surface and frame are its own too (PIE-675): a box's `bg`, `border` and `edge`; its tone and strength carry on.
      const bgRole = own.sources.bg.level === "block" ? own.values.bg : "none", accent = own.sources.edge.level === "block" ? own.values.edge : "none";
      const lineSet = own.sources.border.level === "block" ? own.values.border : "auto";
      const glyphs = lineSet !== "auto" && lineSet !== "none" && lineSet !== "joined" ? BORDER_BOXES[lineSet] : accent === "box" ? BORDER_BOXES.line : null;
      // Margin outside the frame (or the bar, and a space after it), padding inside it; none where less than 8 columns of text would be left.
      const mx = mine("margin.x"), px = mine("pad.x"), my = mine("margin.y"), py = mine("pad.y");
      const framed = !!glyphs && W - 2 * (mx + 1 + px) >= 8, bar = !framed && accent === "bar" && W - 2 * (mx + px) - 2 >= 8;
      const left = framed ? mx + 1 + px : bar ? mx + 2 + px : Math.max(0, Math.min(Math.floor((W - 10) / 2), mx + px));
      const inner = framed ? W - 2 * left : bar ? W - left - mx - px : Math.max(8, W - 2 * left);
      // The frame and the bar in the tone (theme.edge.tile for neutral): lines, never words.
      const ink = v.tone === "neutral" ? fgRgb(theme().edge.tile) : fg(TONE[v.tone]);
      const off = i + 1, end = boxed.end;
      const child = childEnv(children, { off, end, width: inner });
      const sub = renderDoc(src.slice(off, end).join("\n"), {
        ...child, look: { values: v, layers, width: at, lists: child.look?.lists },
      });
      endZebra(); run = null;
      mark();
      const g = glyphs ?? BORDER_BOXES.line;
      // A row of the box: its text (or nothing, a padding row) between its frame's sides, after its bar, or inset.
      const row = (l: string) => framed ? " ".repeat(mx) + ink + g.side + RESET + " ".repeat(px) + pad(l, inner) + " ".repeat(px) + ink + g.side + RESET
        : bar ? " ".repeat(mx) + ink + "▌" + RESET + " ".repeat(1 + px) + l : " ".repeat(left) + l;
      // Drawing only (margins, the frame's edges, padding): edge rows, never copied.
      const drawn = (text: string, n: number, at: number) => { for (let k = 0; k < n; k++) { edge(out.length); out.push(text); source.push(at); } };
      const frameEdge = (l: string, r: string) => " ".repeat(mx) + ink + l + g.top.repeat(Math.max(0, W - 2 * mx - 2)) + r + RESET;
      drawn("", my, i);
      if (framed) drawn(frameEdge(g.tl, g.tr), 1, i);
      const surfaceFrom = out.length;
      drawn(framed || bar ? row("") : "", py, i);
      const base = out.length;
      sub.lines.forEach((l, r) => { out.push(row(l)); source.push(sub.source[r]! < 0 ? -1 : off + sub.source[r]!); });
      for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
      adopt(sub, base, left, off, framed ? { inner } : undefined);
      if (!framed) sub.lines.forEach((_, r) => { if (left > 0 && !trims.get(base + r)?.edge) cut(base + r, [0, left]); });
      drawn(framed || bar ? row("") : "", py, end);
      // Its surface, inside its frame (from after its bar) and its margin, over its padding and its text.
      const surface = bgRole !== "none" ? surfaceBg(bgRole, v["bg.strength"]) : "";
      // (Inset only, the margin is what's left of the inset after the padding: a narrow tile clamps it.)
      const outside = framed || bar ? mx : Math.max(0, left - px);
      if (surface) tints.push({ rows: [surfaceFrom, out.length], cols: [outside + (framed || bar ? 1 : 0), Math.max(outside + 1, W - outside - (framed ? 1 : 0))], bg: surface });
      for (const t of sub.tints ?? []) tints.push({ rows: [base + t.rows[0], base + t.rows[1]], cols: t.cols ? [t.cols[0] + left, t.cols[1] + left] : [left, left + inner], bg: t.bg });
      adoptMedia(sub, base, left, off);
      if (framed) drawn(frameEdge(g.bl, g.br), 1, end);
      drawn("", my, end);
      inserted = end;
      i = end;
      continue;
    }

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
        const inner = Math.max(8, W - 4), off = i, end = deco.end, colour = deco.frame.colour;
        const child = childEnv(children, { off, end, width: inner });
        // The frame already being drawn must not decorate itself again.
        const sub = renderDoc(src.slice(i, end).join("\n"), { ...child, decorate: child.decorate && ((n, w) => n === 0 ? null : child.decorate!(n, w)) });
        const title = deco.frame.title ? ` ${clipText(deco.frame.title, Math.max(0, W - 6))} ` : "";
        out.push(fg(colour) + "╭─" + title + "─".repeat(Math.max(0, W - 3 - vwidth(title))) + "╮" + RESET);
        mark();
        const base = out.length;
        sub.lines.forEach((l, r) => { out.push(fg(colour) + "│ " + RESET + pad(l, inner) + fg(colour) + " │" + RESET); source.push(sub.source[r]! < 0 ? -1 : off + sub.source[r]!); });
        for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
        edge(base - 1);
        adopt(sub, base, 2, off, { inner });
        adoptMedia(sub, base, 2, off);
        inserted = end;
        out.push(fg(colour) + "╰" + "─".repeat(Math.max(0, W - 2)) + "╯" + RESET); source.push(-1);
        edge(out.length - 1);
        i = end - 1;
        continue;
      }
    }

    // A heading or a list item the reader can fold: its disclosure, and nothing it hides when folded.
    const fp = at.get(i);
    if (fp && env.folds && fp.kind !== "callout") {
      const folded = env.folds.folded.has(fp.key), selected = env.folds.selected === fp.key;
      const disclosure = { folded, selected, hidden: fp.hidden, preview: env.folds.preview?.has(fp.key) };
      const styled = fp.kind === "heading" ? headingRows(line, W, env, lit(i), disclosure) : null;
      const joins: (string | undefined)[] = [];
      const rows = styled?.rows ?? prose(line, W, disclosure, lit(i), env.task && (box => env.task!(i, box)), joins);
      if (!styled || styled.plainAt !== undefined) proseCuts(line, W, disclosure).forEach((c, k) => { if (c.length && k < rows.length) cut(out.length + (styled?.plainAt ?? 0) + k, ...c); });
      heads.push({ key: fp.key, row: out.length + (styled?.headRow ?? 0), cols: fp.kind === "heading" ? W : fp.level + line.trimStart().search(/\s/) + 2 });
      if (styled) marginEdges(out.length, styled);
      else wrapped(out.length, joins);
      out.push(...rows);
      if (folded) { mark(); insert(i + 1); inserted = fp.end; i = fp.end - 1; }
      continue;
    }

    // The inline links component (src/links.ts): ::links, ::resources, ::backlinks, ::outlinks, one line or a block
    // to its `::`, drawn with the links tile's rows in a figure's frame, each row a link the reader opens.
    const lb = linkBlockAt(src, i, componentAt);
    if (lb) {
      const rows = renderLinkBlock({ ...lb.spec, lines: componentLines(i, componentAt.get(i)?.attrs, lb.spec.lines) }, env.note, W, frame, env.tag, env.linkBlocks, componentLines(i, componentAt.get(i)?.attrs));
      out.push(...(env.inlineList ? env.inlineList(rows, W) : rows));
      i = lb.end;
      continue;
    }

    // `::use` (src/template-use.ts): a template drawn live in place of its line.
    const used = env.use ? useCallAt(src, i) : null;
    if (used) {
      const drawn = env.use!(used, i, W);
      if (!Array.isArray(drawn)) for (const r of drawn.regions ?? []) regions.push({ key: r.key, row: out.length + r.at, rows: r.rows });
      out.push(...(Array.isArray(drawn) ? drawn : drawn.rows));
      continue;
    }

    // `::button` (outline-core's button-call.ts): a labelled press.
    const button = env.button ? buttonCallAt(src, i) : null;
    if (button) {
      out.push(...env.button!(button, i, W));
      i = button.endLine;
      continue;
    }

    // `::fields` and `::if` (src/site-blocks.ts): the components that read their note's Site, drawn from the service's
    // answer. An `::if` whose query holds draws its body in place of its two lines; any other state draws nothing.
    const sb = siteBlockAt(src, i, componentAt);
    if (sb?.kind === "fields") {
      out.push(...renderFields(sb.spec, env.note, W, env.tag, env.site, env.fields, env.fieldsAnswer));
      i = sb.end;
      continue;
    }
    if (sb?.kind === "if") {
      const held = sb.spec.problem ? { state: "problem" as const, message: sb.spec.problem, didYouMean: [] } : ifState(sb.spec.where, env.note, env.site);
      if (held.state === "holds") { ifCloses.add(sb.end); continue; }
      if (held.state === "problem") out.push(...ifProblemLines(held.message, W));
      i = sb.end;
      continue;
    }

    // mdxcn Comark figure: ::graph-kind, --- yaml ---, ::
    const figure = componentAt.get(i), gk = figure && graphKind(figure);
    if (figure && gk) {
      // Its YAML and its Markdown rows; the note's figure block (the first line of a note's own body) takes its child
      // bullets as rows too.
      const block = !env.nested && src.slice(0, i).every(l => !l.trim());
      // Drawn through a `::use`: its chain and the call's props, so `this` is the host and `{{props.x}}` the call's (S4).
      const source = { ...figureSource(src.slice(i + 1, figure.end), env.note, block, figure.attrs), ...(env.site?.chain?.length ? { chain: env.site.chain } : {}), ...(env.site?.props ? { props: env.site.props } : {}) }, at = i + 1 + (source.at ?? 0);
      // Its rows' words drawn as the note's are, and a check row's box a step (PIE-864): a written row's by its body
      // line (the service reads it as a step), a live row's by its note and what its `done:` names.
      const rows: RowInline | undefined = env.present && {
        present: env.present,
        box: (it, box) => typeof it.line === "number" ? env.task?.(at + it.line, box) ?? null
          : typeof it.block === "string" && it.mark && env.liveStep ? env.liveStep({ block: it.block, status: it.status ?? (it.done ? "done" : "todo"), label: String(it.label ?? ""), mark: it.mark }, box) : null,
      };
      const tunedLines = look?.lists?.(i, componentRowFields(figure.attrs ?? ""))["rows.lines"];
      if (tunedLines !== undefined) source.yaml = source.yaml.replace(/^lines:.*$/m, "") + `\nlines: ${tunedLines}`;
      if (env.figures) env.figures.drawn ??= { n: 0, titles: new Map() };
      const graph = renderGraph(gk, source, W, env.link, { ...env.figures, lines: componentLines(i, figure.attrs) }, rows, env.site);
      out.push(...(env.inlineList ? env.inlineList(graph, W) : graph));
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
      if (fence.fence.info) {
        const { language, attrs } = codeFenceInfo(fence.fence.info);
        const name = SCRIPT_FENCE.languages.includes(language) && fence.closed ? attrs.script : undefined;
        const run = name ? env.button?.({ line: fence.start, endLine: fence.start, steps: [{ kind: "script", source: name }], sequence: false, label: `Run ${name}`, act: name }, fence.start, W)?.join(" ") : undefined;
        out.push(fg(C.dark) + `╭ ${fence.fence.info}` + RESET + (run ? ` ${run}` : ""));
        edge(first);
        if (name) for (const button of buttonCallsOf(src.join("\n")).filter(b => b.act?.split(/\s/)[0] === name)) {
          out.push(fg(C.dark) + `│ used by ::button ${button.label}` + RESET);
        }
      }
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
    if (spec?.kind === "artifact") {
      const facts = env.artifact?.(spec) ?? artifactFacts(spec);
      const ref: DocMedia = { path: spec.path, kind: spec.kind, row: out.length, line: i, spec };
      mediaRefs.push(ref);
      artifactCard(spec, facts, W, env, i, ref, out, edge);
      continue;
    }
    if (spec) {
      const entry = media(spec.path, spec.kind);
      const ref: DocMedia = { path: entry.path, kind: spec.kind, row: out.length, line: i, spec };
      mediaRefs.push(ref);
      if (env.heroLine !== undefined ? i === env.heroLine : spec.layout === "hero" && env.hero) {
        hero = { ...ref, media: entry };
        out.push(caption(entry, spec, W, env, i, true));
        continue;
      }
      const drawn = mediaRows(spec, W, env, i, entry);
      if (drawn.image) ref.image = images.push({ ...drawn.image, line: out.length + drawn.image.line }) - 1;
      ref.row = out.length + drawn.caption;
      out.push(...drawn.lines);
      continue;
    }

    // Callout (PIE-538): > [!type]± title, then its lines, each quoted at least as deep; one quoted deeper is a
    // callout inside it, drawn by this same renderer in its frame, to any depth.
    const cb = callouts.get(i);
    // An output region (outline-core output-region.ts: a script's or an @name's `> [!output]-` callout): the body is the note's
    // own content, flush, behind one gutter mark (src/output-region.ts). A fold on it is the person's to ask for, not drawn.
    const known = cb && cb.depth === 1 ? env.outputs?.get(i) : undefined;
    const og = known ?? (cb && cb.depth === 1 ? outputHeader(src[i]!) : null);
    if (cb && og) {
      const off = i + 1;
      const body = src.slice(off, cb.end).map(l => stripQuotes(l, cb.depth));
      const sub = renderDoc(body.join("\n"), childEnv(children, { off, end: cb.end, width: W }));
      mark();
      const base = out.length;
      sub.lines.forEach((l, r) => { out.push(l); source.push(sub.source[r]! < 0 ? -1 : off + sub.source[r]!); });
      for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
      adopt(sub, base, 0, off, undefined, cb.depth);
      adoptMedia(sub, base, 0, off);
      const key = `${env.note ?? ""}:#${og.anchor ?? i}`;
      const source0 = og.producer && env.tag ? env.tag({ block: og.producer, role: "control", label: `source of ${og.label || "this output"}` }, "[source]") : "";
      const edited = !!known?.edited;
      // The body is already in `out`; what follows it is what is wrong with it and the row behind the mark.
      out.push(...regionTail({
        key, label: og.label || "output", target: og.producer ? { block: og.producer, role: "embed" as const, label: og.label } : { role: "resource" as const, label: og.label }, body: sub.lines,
        notes: edited ? [fg(C.dark) + "edited here: it is yours now, and the next output waits as a proposal" + RESET] : [],
        facts: [og.label || "output", og.type === "answer" ? "an agent's answer" : "written by a script"], controls: source0 ? [fg(C.lcyan) + source0 + RESET] : [], width: W,
      }, env.regions));
      regions.push({ key, row: base, rows: out.length - base });
      mark();
      insert(i + 1);
      inserted = cb.end;
      i = cb.end - 1;
      continue;
    }
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
          const sub = renderDoc(body.join("\n"), childEnv(children, { off: i + 1, end: cb.end, width: W }));
          mark();
          const base0 = out.length;
          sub.lines.forEach((l, r) => { out.push(l); source.push(sub.source[r]! < 0 ? -1 : i + 1 + sub.source[r]!); });
          adopt(sub, base0, 0, i + 1, undefined, cb.depth);
          adoptMedia(sub, base0, 0, i + 1);
          if (byline) { out.push(bylineRow(W)); source.push(i + 1 + byline.line); }
        }
        mark();
        insert(i + 1);
        inserted = cb.end;
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
        const hint = (fp2 ? [`${said} · f, gutter or … unfolds`, `${said} · f`] : [`${said} · z unfolds`]).find(x => vwidth(x) <= inner) ?? said;
        cut(out.length, [0, 2], [2 + inner, Infinity]);
        out.push(fg(colour) + "│ " + fg(C.dark) + pad(hint, inner) + fg(colour) + " │" + RESET);
      } else {
        for (const l of spill ? wrap(spill, inner) : []) { cut(out.length, [0, 2], [2 + inner, Infinity]); out.push(fg(colour) + "│ " + BOLD + pad(l, inner) + UNBOLD + " │" + RESET); }
        // A title-only callout is just the titled frame; no empty row inside.
        if (body.length) {
          const off = i + 1;
          const sub = renderDoc(body.join("\n"), childEnv(children, { off, end: cb.end, width: inner }));
          mark();
          const base = out.length;
          sub.lines.forEach((l, r) => { out.push(framed(l)); source.push(sub.source[r]! < 0 ? -1 : off + sub.source[r]!); });
          for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
          adopt(sub, base, 2, off, { inner }, cb.depth);
          adoptMedia(sub, base, 2, off);
          if (byline) { out.push(framed(bylineRow(inner))); source.push(off + byline.line); }
        }
      }
      mark();
      edge(out.length);
      out.push(fg(colour) + "╰" + "─".repeat(bw - 2) + "╯" + RESET); source.push(-1);
      blocks.push({ kind: "callout", row: top, rows: out.length - top, line: i, end: cb.end, inner: [i + 1, cb.end], strip: cb.depth, text: written, col: bw - 2 });
      mark();
      insert(i + 1);
      inserted = cb.end;
      i = cb.end - 1;
      continue;
    }

    // Table: header row, separator row, body rows.
    if (startsTable(src, i)) {
      const end = tableEnd(src, i), rows = src.slice(i, end);
      const mapped: number[] = [];
      const drawn = table(rows, W, lit(end - 1), box => { mapped[box.y] = i + (box.row ? box.row + 1 : 0); });
      for (let y = 0; y < drawn.length; y++) {
        out.push(drawn[y]!); source.push(mapped[y] ?? -1);
      }
      i = end - 1;
      continue;
    }

    // Transclusions: each `!((…))` becomes its shaded region; the text around it stays where it was.
    // Inline code keeps its text (fences are consumed above): an embed in a code span is its text.
    if (expandsEmbeds(!!env.embed) && line.includes("!((")) {
      const pieces: (string | { id: string; fragment?: string })[] = [];
      const code = codeSpanRanges(line);
      let at = 0;
      for (const l of linkOccurrences(line, code)) {
        if (l.kind !== "block" || !l.embed) continue;
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
    const styled = headingRows(line, W, env, lit(i)) ?? (rawStructure[i] === -1 && !setext ? styledRule(line, W, env) : null);
    if (styled) {
      const plainAt = "plainAt" in styled ? styled.plainAt as number | undefined : undefined;
      if (plainAt !== undefined) proseCuts(line, W).forEach((c, k) => { if (c.length) cut(out.length + plainAt + k, ...c); });
      marginEdges(out.length, styled);
      out.push(...styled.rows);
      continue;
    }
    const joins: (string | undefined)[] = [];
    const rows = prose(line, W, undefined, lit(i), env.task && (box => env.task!(i, box)), joins);
    proseCuts(line, W).forEach((c, k) => { if (c.length && k < rows.length) cut(out.length + k, ...c); });
    // A run of `>` lines is one quote: its copy control is on the first.
    if (/^\s*>/.test(line)) {
      const text = line.replace(/^\s*> ?/, ""), last = blocks.at(-1);
      if (last?.kind === "quote" && last.end === i && last.row + last.rows === out.length) { last.rows += rows.length; last.end = i + 1; last.inner[1] = i + 1; last.text += "\n" + text; }
      else blocks.push({ kind: "quote", row: out.length, rows: rows.length, line: i, end: i + 1, inner: [i, i + 1], strip: 1, text, col: W - 1 });
    }
    wrapped(out.length, joins);
    out.push(...rows);
  }
  endZebra();
  mark();
  insert(src.length);
  // The inline code spans as drawn (nested documents' are found again in the rows they were framed into), and every block in reading order.
  const finish = (lines: string[]) => { blocks.push(...codeSpans(lines, source)); blocks.sort((a, b) => a.row - b.row || a.col - b.col); return blocks; };
  // A glyph the drawing adds after a link (the ↗ of a link to the web) is marked ADORN: its cell is a cut, drawn and never copied.
  out.forEach((row, r) => { for (let at = row.indexOf(ADORN); at >= 0; at = row.indexOf(ADORN, at + 1)) { const col = vwidth(row.slice(0, at)); cut(r, [col, col + 1]); } });
  const z = { ...(tints.length ? { tints } : {}), ...(wraps.size ? { wraps } : {}) };
  if (env.keepTags) { const lines = out.map(stripMarks); return { lines, images, media: mediaRefs, links: [], source, heads, trims, blocks: finish(lines), ...(regions.length ? { regions } : {}), ...(hero ? { hero } : {}), ...z }; }
  const { lines, ranges } = extractLinks(out.map(stripMarks));
  return { lines, images, media: mediaRefs, links: ranges, source, heads, trims, blocks: finish(lines), ...(regions.length ? { regions } : {}), ...(hero ? { hero } : {}), ...z };
}

/** Rows `cols` cells of `m` take, its aspect kept. */
const rowsFor = (m: { width: number; height: number }, cols: number, env: DocEnv) => Math.max(1, Math.round((cols * env.cellW * m.height) / m.width / env.cellH));
const colsFor = (m: { width: number; height: number }, rows: number, env: DocEnv) => Math.max(1, Math.round((rows * env.cellH * m.width) / m.height / env.cellW));

/**
 * Where an image goes in a body `W` wide: its width from `[size::…]` (cells, a share of the body, or all of it) or
 * from `[height::…]`, else about half its own pixels (a small image isn't blown up to the full width); its aspect
 * kept, inside both when both are written, at most `maxImageRows` tall; then placed by `[align::…]`.
 */
/**
 * A media line's rows `W` wide (PIE-532): the picture's box, kept dark while it loads (its rows come from its header, so
 * nothing moves when it arrives), then its caption (row `caption`). `image`: the picture to place, at `line` of these
 * rows, once it's decoded. A note's image line is drawn with it, and so is an extension view's `image` primitive
 * (PIE-827, the reader's `PrimitiveDraw.image`). `line`: the body line the caption's controls change.
 */
export function mediaRows(spec: MediaSpec, W: number, env: DocEnv, line: number, entry: Media = media(spec.path, spec.kind === "video" ? "video" : "img")): { lines: string[]; caption: number; entry: Media; image?: DocImage } {
  const lines: string[] = [];
  const isHero = spec.layout === "hero";
  const hero = isHero ? heroLook(spec, env.look?.values ?? BASE_STYLE) : null;
  const size = entry.state === "ready" ? entry : entry.state === "loading" && entry.width && entry.height ? { width: entry.width, height: entry.height } : null;
  let image: DocImage | undefined;
  if (size && env.graphics) {
    const box = isHero ? heroBox(size, hero!, W, Math.min(hero!.height ?? env.maxImageRows, env.maxImageRows), env.cellW, env.cellH) : imageBox(size, spec, W, env);
    if (entry.state === "ready") image = { line: 0, media: entry, ...(hero ? { look: hero.pixels } : {}), ...(spec.dim !== undefined ? { dim: spec.dim } : {}), ...box };
    for (let r = 0; r < box.rows; r++) lines.push("");
  }
  lines.push(caption(entry, spec, W, env, line, isHero));
  return { lines, caption: lines.length - 1, entry, ...(image ? { image } : {}) };
}

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
 * An artifact's card (PIE-793): no script runs in a terminal, so the line is drawn as what it is, its kind on the frame,
 * its title, its file and what's wrong with its line, and [open ↗], which opens it running on its web page (artifact.open).
 * `ref.row` is its title's row: the element a click or [ ] lands on.
 */
function artifactCard(spec: MediaSpec, facts: ArtifactFacts, W: number, env: DocEnv, line: number, ref: DocMedia, out: string[], edge: (row: number) => void) {
  const kind = facts.kind ? `${ARTIFACT_KIND_LABELS[facts.kind]} artifact` : "artifact";
  const name = env.printed ? spec.path : fileName(spec.path);
  const open = env.image && (facts.kind || isArtifactName(spec.path)) ? fg(C.cyan) + env.image(line, { open: true }, "[open ↗]") + RESET : "";
  const said = [
    facts.state === "missing" ? `✗ can't read it: ${facts.reason ?? "missing"}` : facts.state === "reading" ? "◌ reading…" : "",
    ...(facts.warning ? [`⚠ ${facts.warning}`] : []),
    ...spec.problems.map(p => `⚠ ${p}`),
  ].filter(Boolean);
  const facts2 = [name !== facts.title ? name : "", spec.height ? `${spec.height} rows` : "", sizeText(spec.size), facts.kind ? "runs on its web page" : ""].filter(Boolean).join(" · ");
  const ink = facts.state === "missing" ? C.lred : C.magenta;
  // Too narrow for a frame: one line, its kind, title and open.
  if (W < 24) {
    ref.row = out.length;
    out.push(fg(ink) + pad(`◇ ${facts.title}`, Math.max(4, W - vwidth(open))) + RESET + open);
    return;
  }
  const inner = W - 4;
  const fit = (x: string, room: number) => (vwidth(x) > room ? splitVisible(x, room - 1)[0] + "…" : x);
  const head = ` ◇ ${kind} `;
  edge(out.length);
  out.push(fg(ink) + "╭─" + BOLD + head + UNBOLD + "─".repeat(Math.max(0, W - 3 - vwidth(head))) + "╮" + RESET);
  const row = (text: string) => fg(ink) + "│ " + RESET + text + fg(ink) + " │" + RESET;
  ref.row = out.length;
  const title = fit(facts.title, Math.max(4, inner - vwidth(open) - 1));
  out.push(row(fg(C.white) + BOLD + title + UNBOLD + RESET + " ".repeat(Math.max(1, inner - vwidth(title) - vwidth(open))) + open));
  if (facts2) out.push(row(fg(C.dark) + pad(fit(facts2, inner), inner) + RESET));
  for (const x of said) out.push(row(fg(x.startsWith("✗") ? C.lred : x.startsWith("⚠") ? C.yellow : C.dark) + pad(fit(x, inner), inner) + RESET));
  edge(out.length);
  out.push(fg(ink) + "╰" + "─".repeat(Math.max(0, W - 2)) + "╯" + RESET);
}

/**
 * How a fold point is drawn: every one shows its disclosure, a click target as much as a sign (▾ open,
 * ▸ folded, with what it hides); the one the keys selected is yellow.
 */
interface Disclosure { folded: boolean; selected: boolean; hidden: number; preview?: boolean }
const foldedNote = (d: Disclosure) => fg(C.dark) + ` · ${d.hidden} line${d.hidden === 1 ? "" : "s"} folded` + RESET;

/** A list item's step box at the start of its text. */
const BOX = new RegExp(`^${STEP_BOX}(?=\\s|$)`);

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
  const style = base && headingStyleWith(base, sl.fields).style;
  return { style: style && base ? cascaded(style, base, sl.fields, env) : style, text: sl.text, level: sl.level, kind: sl.kind };
}

/**
 * A heading style's margin and padding through the look's cascade (PIE-673, one system with PIE-599): the style is the
 * component level, the outline's levels over it, the heading's own `heading-margin` and `heading-padding` the block
 * level over those. Without a look the style is as written.
 */
function cascaded(style: HeadingStyle, base: HeadingStyle, fields: readonly { key: string; value: string }[], env: DocEnv): HeadingStyle {
  if (!env.look) return style;
  const own = styleFieldsOf(fields, "this heading", []);
  const v = resolveStyle([...env.look.layers, headingComponentLayer(base), { level: "block", label: "this heading", fields: own }], env.look.width).values;
  return { ...style, margin: v["heading.margin"], padding: v["heading.padding"] };
}

/**
 * A heading's rows: styled (headingStyle), or plain with the look's heading margin around it (`plainAt`: the row its
 * prose starts on, for its cuts), with the margin it took. Null for a line that isn't a heading, or a plain heading
 * with no margin.
 */
function headingRows(line: string, W: number, env: DocEnv, literal: boolean, fold?: Disclosure): { rows: string[]; headRow: number; margin?: { top: number; bottom: number }; plainAt?: number } | null {
  const styled = styledHeading(line, W, env, literal, fold);
  if (styled) return styled;
  const m = env.look?.values["heading.margin"];
  if (!m || (!m.top && !m.bottom) || !HEADING.test(line) || literal) return null;
  const rows = prose(line, W, fold, literal);
  return { rows: [...Array(m.top).fill(""), ...rows, ...Array(m.bottom).fill("")], headRow: m.top, margin: m, plainAt: m.top };
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
  const out = [clipText(summary, W) + RESET];
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
function styledHeading(line: string, W: number, env: DocEnv, literal: boolean, fold?: Disclosure): { rows: string[]; headRow: number; margin?: { top: number; bottom: number } } | null {
  const st = styleOf(line, env);
  if (!st || st.kind !== "heading" || (st.style === null && st.text === line)) return null;
  // `## [heading::band]` is a heading with no text: drawn as written.
  const h = st.text.match(HEADING);
  if (!h) return { rows: prose(st.text, W, fold, literal), headRow: 0 };
  const band = st.style && drawBand(st.style, W, st.level, headingLabel(h[2]!, st.level, st.style, fold), stripMarks(h[2]!));
  if (band) return { rows: band.rows, headRow: band.textRow, ...(st.style ? { margin: st.style.margin } : {}) };
  const margin = st.style?.margin;
  const plain = prose(st.text, W, fold, literal);
  if (!margin) return { rows: plain, headRow: 0 };
  const m = withMargin(margin, plain, 0);
  return { rows: m.rows, headRow: m.textRow, margin };
}

/** A rule (`---`) with a style: its track, or as written when narrow. Null for a line that isn't one, or a plain one. */
function styledRule(line: string, W: number, env: DocEnv): { rows: string[]; margin?: { top: number; bottom: number } } | null {
  const st = styleOf(line, env);
  if (!st || st.kind !== "rule" || (st.style === null && st.text === line)) return null;
  const track = st.style && drawTrack(st.style, W);
  if (track) return { rows: track, ...(st.style ? { margin: st.style.margin } : {}) };
  const rows = wrap(st.text.trim(), W).map(l => fg(C.dark) + l + RESET);
  return st.style ? { rows: withMargin(st.style.margin, rows, 0).rows, margin: st.style.margin } : { rows };
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
function prose(line: string, W: number, fold?: Disclosure, literal = false, task?: (box: string) => string | null, joins?: (string | undefined)[]): string[] {
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
    // Leave room for the reader's trailing fold control, which never covers text.
    if (fold?.preview) return [tint + lead + RESET + drawEllipsized(inline(drawn !== null ? drawn + li[3]!.slice(box!.length) : li[3]!) + (fold.folded ? foldedNote(fold) : ""), W - lead.length - 4)];
    const rows = wrap(drawn !== null ? drawn + li[3]!.slice(box!.length) : li[3]!, W - lead.length, { ...BODY, joins });
    rows.forEach((l, k) => out.push((k ? " ".repeat(lead.length) : (fold ? tint : fg(C.lcyan)) + lead + RESET) + inline(l) + (fold?.folded && k === rows.length - 1 ? foldedNote(fold) : "")));
    return out;
  }
  if (!line.trim()) return [""];
  return wrap(line, W, { ...BODY, joins }).map(inline);
}

const CODE_ON = fg(C.lmagenta), CODE_OFF = fg(C.grey), TAG_CHAR = /[\u{100000}-\u{10FFFD}]/u;
/**
 * The inline code spans in drawn `lines`, as colourBody draws them (magenta, then back to grey: nothing else ends that way), one block
 * each (`kind: "span"`). A span the wrap cut across rows is one: its text joined with a space.
 */
export function codeSpans(lines: readonly string[], source: readonly number[]): DocBlock[] {
  const out: DocBlock[] = [];
  const cellsOfRow = (l: string) => [...l.split(/\x1b\[[\d;]*m/).join("")].filter(c => !TAG_CHAR.test(c));
  lines.forEach((line, row) => {
    const parts = line.split(/(\x1b\[[\d;]*m)/);
    let col = 0;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p.startsWith("\x1b[")) {
        const text = parts[i + 1] ?? "";
        if (p === CODE_ON && parts[i + 2] === CODE_OFF && text.replace(TAG_CHAR, "").trim()) {
          const t = [...text].filter(c => !TAG_CHAR.test(c)).join("");
          out.push({ kind: "span", row, rows: 1, line: source[row] ?? 0, end: (source[row] ?? 0) + 1, inner: [0, 0], strip: 0, text: t, col, to: col + [...t].length, cells: [{ row, from: col, to: col + [...t].length }] });
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
      const last = prev.cells!.at(-1)!;
      const before = cellsOfRow(lines[b.row]!).slice(0, b.col).join(""), after = cellsOfRow(lines[last.row]!).slice(last.to).join("");
      const firstOnRow = !out.some(o => o !== b && o.row === b.row && o.col < b.col), lastOnRow = !out.some(o => o !== prev && o.row === prev.row + prev.rows - 1 && o.col > prev.cells!.at(-1)!.from);
      if (firstOnRow && lastOnRow && /^[\s│▌∙]*$/.test(before) && /^[\s│]*$/.test(after)) { prev.text += " " + b.text; prev.rows += 1; prev.cells!.push(...b.cells!); continue; }
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

const cells = (row: string) => tableCells(row).map(c => c.text);

/** A real table: columns sized to fit, long cells wrap onto more lines instead of truncating. */
export interface TableCellBox { row: number; col: number; x: number; y: number; width: number; offset: number; inset: number; text: string }
export function table(rows: string[], W: number, literal = false, cell?: (box: TableCellBox) => void): string[] {
  const head = cells(rows[0]!);
  const align = tableAligns(rows[1]!);
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
  const line = (r: string[], header: boolean, row: number, base: number) => {
    const seams: (string | undefined)[][] = r.map(() => []);
    const wrapped = r.map((c, k) => (c ? wrap(c, widths[k]!, { ...BODY, joins: seams[k] }) : [""]));
    const offsets = r.map(() => 0);
    const h = Math.max(...wrapped.map(w => w.length));
    const out: string[] = [];
    for (let y = 0; y < h; y++) {
      let x = 1;
      widths.forEach((width, col) => {
        const text = visible(wrapped[col]![y] ?? "");
        offsets[col]! += visible(seams[col]![y] ?? "").length;
        const gap = Math.max(0, width - vwidth(text));
        const inset = 1 + (align[col] === "r" ? gap : align[col] === "c" ? gap >> 1 : 0);
        cell?.({ row, col, x, y: base + y, width: width + 2, offset: offsets[col]!, inset, text });
        offsets[col]! += text.length;
        x += width + 3;
      });
      out.push(B("│") + wrapped.map((w, k) => " " + fit(header ? BOLD + fg(C.white) + (w[y] ?? "") + RESET : inlineOf(w[y] ?? "", literal), widths[k]!, align[k] ?? "l") + " ").join(B("│")) + B("│"));
    }
    return out;
  };
  const out = [rule("┌", "┬", "┐"), ...line(all[0]!, true, 0, 1), rule("╞", "╪", "╡").replace(/─/g, "═")];
  all.slice(1).forEach((r, k) => { out.push(...line(r, false, k + 1, out.length)); if (k < all.length - 2) out.push(rule("├", "┼", "┤")); });
  out.push(rule("└", "┴", "┘"));
  return out;
}

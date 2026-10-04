// Render a note body into terminal lines: headings, lists, code fences, Obsidian-style
// callouts as boxes, Markdown tables as real tables with wrapped multi-line cells, and
// media lines as image slots the caller fills with Kitty placements.
import { isMediaLine, media, parseMediaLine, sizeText, type Media, type MediaSpec } from "./media";
import { balanceTags, BOLD, C, extractLinks, fg, type LinkRange, pad, RESET, splitVisible, stripTags, styleMarks, trimTagged, UNBOLD, width as vwidth } from "./style";
import { colourBody, wrap } from "./text";
import { frame, isGraphStart, reframeAscii, renderGraph, type FiguresEnv } from "./graphs";
import { linkBlockLines, linkBlockAt, renderLinkBlock } from "./links";
import { EMBED, stripMarks, type LinkTarget } from "./refs";
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, stripQuotes, type CalloutBlock, type CalloutRegistry } from "@ep0ch/outline-core/callouts";
import { TONE } from "./callouts";

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
  /** The block whose body this is: an inline `::links` component lists its links unless it names another. */
  note?: string;
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
}
/** A control on an image's caption: a size step, an alignment step, or the header on or off. */
export type ImageControl = { size: 1 | -1 } | { align: 1 | -1 } | { hero: boolean };
/**
 * An image laid out on the body's rows: `col` cells in, `cols` × `rows` cells; `crop` the part of it shown, as
 * fractions of the image (a header's cover crop).
 */
export interface DocImage { line: number; col: number; rows: number; cols: number; media: Extract<Media, { state: "ready" }>; crop?: { x: number; y: number; w: number; h: number } }
/** A media line as drawn: the file, its kind, the row naming it, the body line it's on and what the line says of its layout. */
export interface DocMedia { path: string; kind: string; row: number; line: number; spec: MediaSpec }
/**
 * `links`: where the body's tagged links (src/style.ts linkTag) landed, by row of `lines`. `media[i].row`:
 * the row that names the image or video (its caption, or the line in its place). `source[r]`: the
 * body line rendered row `r` comes from (the first line of a table, callout, fence or figure for all of its
 * rows). `heads`: each fold point drawn, at its row, with the columns of its disclosure (a heading's whole
 * row, a list item's indent and mark).
 */
export interface Doc {
  lines: string[]; images: DocImage[]; media: DocMedia[]; links: LinkRange[]; source: number[]; heads: { key: string; row: number; cols: number }[];
  /** The header image (`env.hero`): the first `[layout::hero]` image, drawn by the reader above the title. */
  hero?: DocMedia & { media: Media };
}

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
/**
 * A block anchor at the end of a line (`^books`, `^t-8a6d7f`, the older `^task-<uuid>`), hidden when a note is
 * drawn, as Detail hides it. The id pattern is the service's (FRAGMENT_ID_SOURCE in pi-herdr-outliner's
 * src/fragments.ts); the anchor stays in the source, so folds and links still find it.
 */
const TASK_ID = /(^|[ \t])\^[A-Za-z0-9][A-Za-z0-9_-]{0,63}[ \t]*$/gm;
const indentOf = (l: string) => l.length - l.trimStart().length;

/**
 * The fold points of a body, computed from its source text (before links are presented, so a link's
 * title arriving later never renames a fold). Headings and list markers inside a fence or a figure are
 * text; a media line or a transclusion isn't a fold point. `anchors[i]` is line i's stable anchor, if any.
 */
export function foldPoints(body: string, anchors: readonly (string | undefined)[] = []): FoldPoint[] {
  const src = body.split("\n");
  // Which fence or figure each line is part of (the line that opened it), or -1 for plain structure.
  const block: number[] = [];
  let open = -1, kind: "fence" | "graph" | null = null;
  // An inline links component (`::links`, src/links.ts) is a figure too: its lines are its question, not structure.
  const linkLines = linkBlockLines(src);
  src.forEach((l, i) => {
    if (kind) { block.push(open); if (kind === "fence" ? /^\s*```/.test(l) : /^\s*::\s*$/.test(l)) kind = null; return; }
    if (linkLines.has(i)) { block.push(i); return; }
    if (/^\s*```/.test(l)) { open = i; kind = "fence"; block.push(i); return; }
    if (isGraphStart(l)) { open = i; kind = "graph"; block.push(i); return; }
    block.push(-1);
  });
  const foldable = (i: number) => block[i] === -1 && !isMediaLine(src[i]!) && !new RegExp(EMBED.source).test(src[i]!);
  const trim = (from: number, to: number) => { while (to > from && !src[to - 1]!.trim()) to--; return to; };
  const out: FoldPoint[] = [];
  const seen = new Map<string, number>();
  const add = (kind: FoldPoint["kind"], level: number, text: string, line: number, end: number, start?: "folded") => {
    const plain = text.replace(TASK_ID, "").trim().replace(/\s+/g, " ");
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
      add("heading", level, h[2]!, i, trim(i + 1, j));
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
  const src = body.split("\n").map(l => l.replace(TASK_ID, ""));
  const source: number[] = [], heads: Doc["heads"] = [];
  const at = new Map((env.folds?.points ?? []).map(p => [p.line, p]));
  const callouts = new Map(calloutBlocks(src).map(c => [c.line, c]));
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

    // A heading or a list item the reader can fold: its disclosure, and nothing it hides when folded.
    const fp = at.get(i);
    if (fp && env.folds && fp.kind !== "callout") {
      const folded = env.folds.folded.has(fp.key), selected = env.folds.selected === fp.key;
      const rows = prose(line, W, { folded, selected, hidden: fp.hidden }, lit(i), env.task && (box => env.task!(i, box)));
      heads.push({ key: fp.key, row: out.length, cols: fp.kind === "heading" ? W : fp.level + line.trimStart().search(/\s/) + 2 });
      out.push(...rows);
      if (folded) { mark(); insert(i + 1); inserted = fp.end; i = fp.end - 1; }
      continue;
    }

    // The inline links component (src/links.ts): ::links, ::resources, ::backlinks, ::outlinks, one line or a block
    // to its `::`, drawn with the links tile's rows in a figure's frame, each row a link the reader opens.
    const lb = linkBlockAt(src, i);
    if (lb) {
      out.push(...renderLinkBlock(lb.spec, env.note, W, frame, env.tag));
      i = lb.end;
      continue;
    }

    // mdxcn Comark figure: ::graph-kind, --- yaml ---, ::
    const gk = isGraphStart(line);
    if (gk) {
      const yaml: string[] = [];
      let dashes = 0;
      for (i++; i < src.length && !/^\s*::\s*$/.test(src[i]!); i++) { if (/^\s*---\s*$/.test(src[i]!)) { dashes++; continue; } if (dashes === 1) yaml.push(src[i]!); }
      out.push(...renderGraph(gk, yaml.join("\n"), W, env.link, env.figures));
      continue;
    }

    // Code fence.
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const code: string[] = [];
      for (i++; i < src.length && !/^\s*```/.test(src[i]!); i++) code.push(src[i]!);
      const figure = reframeAscii(code, W);
      if (figure) { out.push(...figure); continue; }
      if (fence[1]) out.push(fg(C.dark) + `╭ ${fence[1].trim()}` + RESET);
      for (const c of code) for (const piece of chunk(c, W - 2)) out.push(fg(C.blue) + "│ " + fg(C.lcyan) + piece + RESET);
      continue;
    }

    // Media line (PIE-532): the image laid out as its properties say, its caption under it with the controls that
    // change them; the header image is only its caption here when the reader draws it above the title.
    const spec = parseMediaLine(line);
    if (spec) {
      const entry = media(spec.path, spec.kind);
      const ref: DocMedia = { path: entry.path, kind: spec.kind, row: out.length, line: i, spec };
      mediaRefs.push(ref);
      const isHero = spec.layout === "hero" && !hero;
      if (spec.layout === "hero" && !isHero) spec.problems.push("another image is the header already");
      if (isHero && env.hero) {
        hero = { ...ref, media: entry };
        out.push(caption(entry, spec, W, env, i, true));
        continue;
      }
      if (entry.state === "ready" && env.graphics) {
        const box = isHero ? heroBox(entry, spec, W, env) : imageBox(entry, spec, W, env);
        images.push({ line: out.length, media: entry, ...box });
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
      const body = src.slice(i + 1, cb.end).map(l => stripQuotes(l, cb.depth));
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
          const sub = renderDoc(body.join("\n"), { ...env, keepTags: true, embed: undefined, after: undefined, task: undefined, folds: undefined, callout: undefined, literal: undefined });
          mark();
          sub.lines.forEach((l, r) => { out.push(l); source.push(i + 1 + (sub.source[r] ?? 0)); });
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
      out.push(fg(colour) + "╭─" + BOLD + head + UNBOLD + "─".repeat(Math.max(0, bw - 3 - vwidth(head) - vwidth(label) - (label ? 1 : 0))) + (label ? fg(C.dark) + label + fg(colour) + "─" : "") + "╮" + RESET);
      const framed = (l: string) => fg(colour) + "│ " + RESET + pad(l, inner) + fg(colour) + " │" + RESET;
      if (folded) {
        const n = body.filter(l => l.trim()).length, said = `▸ ${n} line${n === 1 ? "" : "s"} folded`;
        // The hint gives way by width, whole words at a time, never cut mid-word.
        const hint = (fp2 ? [`${said} · f or a click on the title unfolds`, `${said} · f`] : [`${said} · z unfolds`]).find(x => vwidth(x) <= inner) ?? said;
        out.push(fg(colour) + "│ " + fg(C.dark) + pad(hint, inner) + fg(colour) + " │" + RESET);
      } else {
        for (const l of spill ? wrap(spill, inner) : []) out.push(fg(colour) + "│ " + BOLD + pad(l, inner) + UNBOLD + " │" + RESET);
        // A title-only callout is just the titled frame; no empty row inside.
        if (body.length) {
          const off = i + 1, inside = (n: number) => n > i && n < cb.end;
          const sub = renderDoc(body.join("\n"), {
            ...env, width: inner, graphics: false, keepTags: true, embed: undefined, after: undefined, task: undefined,
            literal: new Set([...(env.literal ?? [])].filter(inside).map(n => n - off)),
            folds: env.folds && { ...env.folds, points: env.folds.points.filter(p => inside(p.line)).map(p => ({ ...p, line: p.line - off, end: p.end - off })) },
            callout: env.callout && ((n, b) => env.callout!(n + off, { ...b, line: b.line + off, end: b.end + off, depth: b.depth + cb.depth })),
          });
          mark();
          const base = out.length;
          sub.lines.forEach((l, r) => { out.push(framed(l)); source.push(off + (sub.source[r] ?? 0)); });
          for (const h of sub.heads) heads.push({ ...h, row: base + h.row, cols: W });
        }
      }
      out.push(fg(colour) + "╰" + "─".repeat(bw - 2) + "╯" + RESET);
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
    // Inline code keeps its text (fences are consumed above): only what's outside backticks is split.
    if (env.embed && line.includes("!((")) {
      const pieces: (string | { id: string; fragment?: string })[] = [];
      let text = "";
      line.split(/(`[^`]*`)/).forEach((part, j) => {
        if (j % 2) { text += part; return; }
        const parts = part.split(new RegExp(EMBED.source, "g"));
        for (let k = 0; k < parts.length; k += 3) {
          text += parts[k]!;
          if (k + 1 < parts.length) { pieces.push(text, { id: parts[k + 1]!, fragment: parts[k + 2] || undefined }); text = ""; }
        }
      });
      if (pieces.length) {
        pieces.push(text);
        pieces.forEach((p, k) => {
          if (typeof p !== "string") { out.push(...env.embed!(p.id, p.fragment, embeds++, W)); return; }
          const t = k === 0 ? p.trimEnd() : p.trim();
          if (t.trim() && !/^\s*([-*]|\d+[.)])\s*$/.test(t)) out.push(...prose(t, W, undefined, lit(i)));
        });
        continue;
      }
    }
    out.push(...prose(line, W, undefined, lit(i), env.task && (box => env.task!(i, box))));
  }
  mark();
  insert(src.length);
  if (env.keepTags) return { lines: out.map(stripMarks), images, media: mediaRefs, links: [], source, heads, ...(hero ? { hero } : {}) };
  const { lines, ranges } = extractLinks(out.map(stripMarks));
  return { lines, images, media: mediaRefs, links: ranges, source, heads, ...(hero ? { hero } : {}) };
}

type Ready = Extract<Media, { state: "ready" }>;
/** Rows `cols` cells of `m` take, its aspect kept. */
const rowsFor = (m: Ready, cols: number, env: DocEnv) => Math.max(1, Math.round((cols * env.cellW * m.height) / m.width / env.cellH));
const colsFor = (m: Ready, rows: number, env: DocEnv) => Math.max(1, Math.round((rows * env.cellH * m.width) / m.height / env.cellW));

/**
 * Where an image goes in a body `W` wide: its width from `[size::…]` (cells, a share of the body, or all of it) or
 * from `[height::…]`, else about half its own pixels (a small image isn't blown up to the full width); its aspect
 * kept, inside both when both are written, at most `maxImageRows` tall; then placed by `[align::…]`.
 */
export function imageBox(m: Ready, spec: MediaSpec, W: number, env: DocEnv): { col: number; cols: number; rows: number } {
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
 * A header image drawn where it is written (no reader to draw it above the title): the full width, at most
 * `[height::…]` or `maxImageRows` tall, cropped to fill that (cover), around its middle.
 */
function heroBox(m: Ready, spec: MediaSpec, W: number, env: DocEnv): Omit<DocImage, "line" | "media"> {
  const rows = Math.max(1, Math.min(rowsFor(m, W, env), spec.height ?? Infinity, env.maxImageRows));
  return { col: 0, cols: W, rows, crop: coverCrop(m, W * env.cellW, rows * env.cellH) };
}

/** The part of `m` (as fractions of it) that fills a box `pxW` × `pxH` pixels with its aspect kept, around its middle. */
export function coverCrop(m: { width: number; height: number }, pxW: number, pxH: number): { x: number; y: number; w: number; h: number } | undefined {
  const box = pxW / pxH, own = m.width / m.height;
  if (Math.abs(box - own) / own < 0.01) return undefined;
  if (own > box) { const w = box / own; return { x: (1 - w) / 2, y: 0, w, h: 1 }; }
  const h = own / box;
  return { x: 0, y: (1 - h) / 2, w: 1, h };
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
    hero ? (spec.height ? `${spec.height} rows` : "") : sizeText(spec.size),
    hero ? "" : spec.align && spec.align !== "left" ? spec.align : "",
    spec.alt ? `“${spec.alt}”` : "",
  ].filter(Boolean);
  // Its controls, at the right end, kept whole: the text before them is cut first.
  const tag = env.image;
  const ctl = (c: ImageControl, text: string) => fg(C.cyan) + tag!(line, c, text) + fg(C.dark);
  const controls = !tag || entry.state === "error" ? ""
    : hero ? ` ${ctl({ size: -1 }, "[−]")}${ctl({ size: 1 }, "[+]")} rows ${ctl({ hero: false }, "[▀ ✓]")}`
    : ` ${ctl({ size: -1 }, "[−]")}${ctl({ size: 1 }, "[+]")} ${ctl({ align: -1 }, "[◂]")}${ctl({ align: 1 }, "[▸]")} ${ctl({ hero: true }, "[▀]")}`;
  const room = Math.max(4, W - vwidth(controls));
  const fit = (x: string) => (vwidth(x) > room ? splitVisible(x, room - 1)[0] + "…" : x);
  if (entry.state === "loading") return fg(C.dark) + pad(fit(`◌ ${label} ${name} · loading…`), room) + controls + RESET;
  if (entry.state === "error") return fg(C.lred) + pad(`✗ ${label} ${name} · ${entry.reason}`, W) + RESET;
  const off = !env.graphics && env.noImages && !env.printed ? ` · ${env.noImages}` : "";
  const problems = spec.problems.length ? ` · ⚠ ${spec.problems.join(" · ")}` : "";
  const head = fit([`${label} ${name}`, ...facts].join(" · ") + off + problems);
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

function chunk(s: string, w: number): string[] {
  if (vwidth(s) <= w) return [s];
  const out: string[] = [];
  for (let rest = s; rest; ) { const [head, tail] = splitVisible(rest, w); out.push(head); rest = tail; }
  return balanceTags(out);
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

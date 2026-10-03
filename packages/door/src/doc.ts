// Render a note body into terminal lines: headings, lists, code fences, Obsidian-style
// callouts as boxes, Markdown tables as real tables with wrapped multi-line cells, and
// media lines as image slots the caller fills with Kitty placements.
import { media, MEDIA_LINE, type Media } from "./media";
import { balanceTags, BOLD, C, extractLinks, fg, type LinkRange, pad, RESET, splitVisible, stripTags, STYLE, styleMarks, trimTagged, UNBOLD, width as vwidth } from "./style";
import { ComponentCatalog, documentComponent } from "./components";
import { colourBody, wrap } from "./text";
import { isGraphStart, reframeAscii, renderGraph } from "./graphs";
import { EMBED, presentLinks, stripMarks } from "./refs";

export interface DocEnv {
  width: number; cellW: number; cellH: number; graphics: boolean; maxImageRows: number; unfold: boolean;
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
  link?: (block: string, text: string) => string;
  /**
   * The body lines (by index) inside a literal region (PIE-422): `[key::value]` there is text, drawn
   * plain. Links and Markdown still render, as the service and Detail treat them.
   */
  literal?: ReadonlySet<number>;
  /**
   * The renderers this note load resolved (src/components.ts), so a redraw never reads their files again.
   * Without it each render resolves them afresh.
   */
  components?: ComponentCatalog;
  /**
   * Present text the renderer takes from inside a fence: a component's labels and values, which support
   * links and Markdown as Detail's do. The reader passes presentLinks with its link list, so they are
   * links `[ ]` stops on. Without it they read as links do without a service (labels, short ids).
   */
  present?: (text: string) => string;
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
}
export interface DocImage { line: number; rows: number; cols: number; media: Extract<Media, { state: "ready" }> }
/**
 * `links`: where the body's tagged links (src/style.ts linkTag) landed, by row of `lines`. `media[i].row`:
 * the row that names the image or video (its caption, or the line in its place). `source[r]`: the
 * body line rendered row `r` comes from (the first line of a table, callout, fence or figure for all of its
 * rows). `heads`: each fold point drawn, at its row, with the columns of its disclosure (a heading's whole
 * row, a list item's indent and mark).
 */
export interface Doc { lines: string[]; images: DocImage[]; media: { path: string; kind: string; row: number }[]; links: LinkRange[]; source: number[]; heads: { key: string; row: number; cols: number }[] }

/**
 * A place the reader can fold: a heading (hiding everything through the next heading of the same or a
 * higher level) or a list item with nested items or continuation lines under it. `line` is its body
 * line, `end` the line after the last it hides (trailing blank lines stay shown), `hidden` how many of
 * those have text. `key` names it across edits elsewhere in the note: its anchor (`^beds`) when it has
 * one, else its kind, level and text (without a step's box) with how many identical headings or items
 * come before it, folding or not.
 */
export interface FoldPoint { key: string; kind: "heading" | "list"; level: number; text: string; line: number; end: number; hidden: number }

// Inline Markdown (bold, italic, strikethrough) arrives as style marks from presentLinks, placed before the
// text was wrapped; colourBody turns them into SGR.
const inlineOf = (s: string, literal = false) => colourBody(s, literal);

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
  src.forEach((l, i) => {
    if (kind) { block.push(open); if (kind === "fence" ? /^\s*```/.test(l) : /^\s*::\s*$/.test(l)) kind = null; return; }
    if (/^\s*```/.test(l)) { open = i; kind = "fence"; block.push(i); return; }
    if (isGraphStart(l)) { open = i; kind = "graph"; block.push(i); return; }
    block.push(-1);
  });
  const foldable = (i: number) => block[i] === -1 && !MEDIA_LINE.test(src[i]!) && !new RegExp(EMBED.source).test(src[i]!);
  const trim = (from: number, to: number) => { while (to > from && !src[to - 1]!.trim()) to--; return to; };
  const out: FoldPoint[] = [];
  const seen = new Map<string, number>();
  const add = (kind: FoldPoint["kind"], level: number, text: string, line: number, end: number) => {
    const plain = text.replace(TASK_ID, "").trim().replace(/\s+/g, " ");
    // A step's box ([ ] or [x]) isn't part of its name: ticking it keeps its fold. Every occurrence counts
    // toward the ordinal, empty ones too, so an earlier `## Notes` gaining a body doesn't renumber this one.
    const base = `${kind}:${level}:${plain.replace(/^\[.\]\s+/, "")}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    if (end <= line + 1) return;
    const hidden = src.slice(line + 1, end).filter(l => l.trim()).length;
    out.push({ key: anchors[line] ? `^${anchors[line]}` : `${base}#${n}`, kind, level, text: plain, line, end, hidden });
  };
  for (let i = 0; i < src.length; i++) {
    if (!foldable(i)) continue;
    const line = src[i]!;
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

const CALLOUT: Record<string, [string, number]> = {
  note: ["✎", C.lcyan], info: ["ℹ", C.lcyan], todo: ["☐", C.lcyan],
  tip: ["✦", C.lgreen], hint: ["✦", C.lgreen], important: ["✦", C.lgreen], success: ["✓", C.lgreen], check: ["✓", C.lgreen], done: ["✓", C.lgreen],
  question: ["?", C.yellow], help: ["?", C.yellow], faq: ["?", C.yellow],
  warning: ["⚠", C.yellow], caution: ["⚠", C.yellow], attention: ["⚠", C.yellow],
  danger: ["✗", C.lred], error: ["✗", C.lred], bug: ["✗", C.lred], failure: ["✗", C.lred], fail: ["✗", C.lred], missing: ["✗", C.lred], problem: ["!", C.lred],
  summary: ["≡", C.lmagenta], abstract: ["≡", C.lmagenta], tldr: ["≡", C.lmagenta],
  example: ["◆", C.lblue], quote: ["❝", C.grey], cite: ["❝", C.grey],
};

export function renderDoc(body: string, env: DocEnv): Doc {
  const out: string[] = [];
  const images: DocImage[] = [];
  const mediaRefs: Doc["media"] = [];
  let embeds = 0;
  const W = Math.max(10, env.width);
  // A checklist step's stable id (` ^task-<uuid>`, added by the service, e.g. when a step gets a comment)
  // is bookkeeping, not prose.
  const src = body.split("\n").map(l => l.replace(TASK_ID, ""));
  const source: number[] = [], heads: Doc["heads"] = [];
  const at = new Map((env.folds?.points ?? []).map(p => [p.line, p]));
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
    if (fp && env.folds) {
      const folded = env.folds.folded.has(fp.key), selected = env.folds.selected === fp.key;
      const rows = prose(line, W, { folded, selected, hidden: fp.hidden }, lit(i), env.task && (box => env.task!(i, box)));
      heads.push({ key: fp.key, row: out.length, cols: fp.kind === "heading" ? W : fp.level + line.trimStart().search(/\s/) + 2 });
      out.push(...rows);
      if (folded) { mark(); insert(i + 1); inserted = fp.end; i = fp.end - 1; }
      continue;
    }

    // mdxcn Comark figure: ::graph-kind, --- yaml ---, ::
    const gk = isGraphStart(line);
    if (gk) {
      const yaml: string[] = [];
      let dashes = 0;
      for (i++; i < src.length && !/^\s*::\s*$/.test(src[i]!); i++) { if (/^\s*---\s*$/.test(src[i]!)) { dashes++; continue; } if (dashes === 1) yaml.push(src[i]!); }
      out.push(...renderGraph(gk, yaml.join("\n"), W, env.link));
      continue;
    }

    // Code fence.
    const fence = line.match(/^\s*```(.*)$/);
    if (fence) {
      const code: string[] = [];
      for (i++; i < src.length && !/^\s*```/.test(src[i]!); i++) code.push(src[i]!);
      // A component fence (```component:status): its renderer's panel, or why there isn't one above the
      // code as typed, as Detail shows it.
      const component = documentComponent(fence[1]!.trim(), code.join("\n"), env.components ?? new ComponentCatalog());
      if (component?.kind === "labelled-values") { out.push(...labelledValues(component.entries, W, env.present ?? (t => presentLinks(t, false, null)))); continue; }
      if (component) for (const l of wrap(`Component unavailable: ${component.reason}`, W)) out.push(fg(C.yellow) + l + RESET);
      const figure = component ? null : reframeAscii(code, W);
      if (figure) { out.push(...figure); continue; }
      if (fence[1]) out.push(fg(C.dark) + `╭ ${fence[1].trim()}` + RESET);
      for (const c of code) for (const piece of chunk(c, W - 2)) out.push(fg(C.blue) + "│ " + fg(C.lcyan) + piece + RESET);
      continue;
    }

    // Media line.
    const m = line.match(MEDIA_LINE);
    if (m) {
      const kind = m[1]!.toLowerCase() === "video" ? "video" : "img";
      const entry = media(m[2]!, kind);
      const ref = { path: entry.path, kind, row: out.length };
      mediaRefs.push(ref);
      const name = entry.path.split("/").pop()!;
      const label = kind === "video" ? "▶ video" : "▣ image";
      if (entry.state === "ready" && env.graphics) {
        const img = entry.image;
        let cols = Math.min(W, Math.round((img.width / env.cellW) * 0.5));   // don't blow small images up to full width
        cols = Math.max(Math.min(W, 24), cols);
        let rows = Math.max(1, Math.round((cols * env.cellW * img.height) / img.width / env.cellH));
        if (rows > env.maxImageRows) { rows = env.maxImageRows; cols = Math.max(4, Math.min(W, Math.round((rows * env.cellH * img.width) / img.height / env.cellW))); }
        images.push({ line: out.length, rows, cols, media: entry });
        for (let r = 0; r < rows; r++) out.push("");
        ref.row = out.length;
        out.push(fg(C.dark) + pad(`${label} · ${name} · ${img.width}×${img.height}${kind === "video" ? " · poster frame" : ""} · [ ] then ⏎ opens it`, W) + RESET);
      } else if (entry.state === "ready") {
        out.push(fg(C.cyan) + pad(`${label} · ${name} · ${entry.image.width}×${entry.image.height} (Kitty graphics off)`, W) + RESET);
      } else if (entry.state === "loading") {
        out.push(fg(C.dark) + pad(`◌ ${label} · ${name} · loading…`, W) + RESET);
      } else {
        out.push(fg(C.lred) + pad(`✗ ${label} · ${name} · ${entry.reason}`, W) + RESET);
      }
      continue;
    }

    // Callout: > [!type]± title, then > lines.
    const co = line.match(/^\s*>\s*\[!(\w+)\]([+-]?)\s*(.*)$/);
    if (co) {
      const body: string[] = [], bodyLit: boolean[] = [];
      for (i++; i < src.length && /^\s*>/.test(src[i]!); i++) { body.push(src[i]!.replace(/^\s*> ?/, "")); bodyLit.push(lit(i)); }
      i--;
      const type = co[1]!.toLowerCase();
      const [icon, colour] = CALLOUT[type] ?? ["▌", C.cyan];
      const folded = co[2] === "-" && !env.unfold;
      const bw = Math.max(12, W);
      const inner = bw - 4;
      // A title too long for the top edge keeps a short head there and flows the rest into the box.
      let title = co[3]?.trim() || type[0]!.toUpperCase() + type.slice(1);
      let spill = "";
      // Counted and cut in visible characters: a link's tags take no room and are never split, and a link
      // open at the cut is closed on the top edge (a folded callout drops the spill) and re-opened in it.
      const room = bw - 8 - [...icon].length;
      if (vwidth(title) > room) {
        const seen = [...stripTags(title)];
        const cut = seen.lastIndexOf(" ", room - 1);
        const [h, t] = splitVisible(title, cut > room * 0.4 ? cut : room - 1);
        spill = trimTagged(t);
        title = trimTagged(h) + " …";
      }
      const head = ` ${icon} ${title} `;
      out.push(fg(colour) + "╭─" + BOLD + head + UNBOLD + "─".repeat(Math.max(0, bw - 3 - vwidth(head))) + "╮" + RESET);
      if (folded) {
        out.push(fg(colour) + "│ " + fg(C.dark) + pad(`▸ ${body.length} line${body.length === 1 ? "" : "s"} folded · z unfolds`, inner) + fg(colour) + " │" + RESET);
      } else {
        for (const l of spill ? wrap(spill, inner) : []) out.push(fg(colour) + "│ " + BOLD + pad(l, inner) + UNBOLD + " │" + RESET);
        // A title-only callout is just the titled frame; no empty row inside.
        body.forEach((b, k) => { for (const l of b ? wrap(b, inner) : [""])
          out.push(fg(colour) + "│ " + RESET + pad(inlineOf(l, bodyLit[k]), inner) + fg(colour) + " │" + RESET); });
      }
      out.push(fg(colour) + "╰" + "─".repeat(bw - 2) + "╯" + RESET);
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
  if (env.keepTags) return { lines: out.map(stripMarks), images, media: mediaRefs, links: [], source, heads };
  const { lines, ranges } = extractLinks(out.map(stripMarks));
  return { lines, images, media: mediaRefs, links: ranges, source, heads };
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
  if (/^\s*>/.test(line)) { for (const l of wrap(line.replace(/^\s*> ?/, ""), W - 2)) out.push(fg(C.green) + "▌ " + RESET + inline(l)); return out; }
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
    const rows = wrap(drawn !== null ? drawn + li[3]!.slice(box!.length) : li[3]!, W - lead.length);
    rows.forEach((l, k) => out.push((k ? " ".repeat(lead.length) : (fold ? tint : fg(C.lcyan)) + lead + RESET) + inline(l) + (fold?.folded && k === rows.length - 1 ? foldedNote(fold) : "")));
    return out;
  }
  if (!line.trim()) return [""];
  return wrap(line, W).map(inline);
}

/**
 * Detail's `labelled-values` layout: `label: value` items, the label bold, on one row joined by ` · ` when
 * they all fit, else one item to a row, wrapped. `present` gives a label or value its links and styles.
 */
function labelledValues(entries: readonly { label: string; value: string }[], W: number, present: (s: string) => string): string[] {
  const [on, off] = STYLE.bold;
  const items = entries.map(e => on + present(e.label) + off + ": " + present(e.value));
  const natural = items.reduce((n, it) => n + vwidth(it), 0) + (items.length - 1) * 3;
  if (natural <= W) return [inlineOf(items.join(" · "))];
  return items.flatMap(it => wrap(it, W).map(l => inlineOf(l)));
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
    const wrapped = r.map((c, k) => (c ? wrap(c, widths[k]!) : [""]));
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

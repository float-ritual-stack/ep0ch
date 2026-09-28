// Render a note body into terminal lines: headings, lists, code fences, Obsidian-style
// callouts as boxes, Markdown tables as real tables with wrapped multi-line cells, and
// media lines as image slots the caller fills with Kitty placements.
import { media, MEDIA_LINE, type Media } from "./media";
import { balanceTags, C, extractLinks, fg, pad, RESET, splitVisible, stripTags, trimTagged, width as vwidth, type LinkRange } from "./style";
import { colourBody, wrap } from "./text";
import { isGraphStart, reframeAscii, renderGraph } from "./graphs";
import { EMBED, stripMarks } from "./refs";

export interface DocEnv {
  width: number; cellW: number; cellH: number; graphics: boolean; maxImageRows: number; unfold: boolean;
  /**
   * Draw the `n`th transclusion (`!((id))`, `!((id^fragment))`) of the document, `width` wide. Without it
   * (inside an embed) the token stays text: embeds are never expanded recursively.
   */
  embed?: (id: string, fragment: string | undefined, n: number, width: number) => string[];
}
export interface DocImage { line: number; rows: number; cols: number; media: Extract<Media, { state: "ready" }> }
/** `links`: where the body's tagged links (src/style.ts linkTag) landed, by row of `lines`. */
export interface Doc { lines: string[]; images: DocImage[]; media: { path: string; kind: string }[]; links: LinkRange[] }

const BOLD = "\x1b[1m", UNBOLD = "\x1b[22m";
const inline = (s: string) => colourBody(s).replace(/\*\*(.+?)\*\*/g, `${BOLD}$1${UNBOLD}`);

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
  const src = body.split("\n").map(l => l.replace(/ \^task-[0-9a-f]{8}-[0-9a-f-]{27}(?=\s|$)/g, ""));
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;

    // mdxcn Comark figure: ::graph-kind, --- yaml ---, ::
    const gk = isGraphStart(line);
    if (gk) {
      const yaml: string[] = [];
      let dashes = 0;
      for (i++; i < src.length && !/^\s*::\s*$/.test(src[i]!); i++) { if (/^\s*---\s*$/.test(src[i]!)) { dashes++; continue; } if (dashes === 1) yaml.push(src[i]!); }
      out.push(...renderGraph(gk, yaml.join("\n"), W));
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

    // Media line.
    const m = line.match(MEDIA_LINE);
    if (m) {
      const kind = m[1]!.toLowerCase() === "video" ? "video" : "img";
      const entry = media(m[2]!, kind);
      mediaRefs.push({ path: entry.path, kind });
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
      const body: string[] = [];
      for (i++; i < src.length && /^\s*>/.test(src[i]!); i++) body.push(src[i]!.replace(/^\s*> ?/, ""));
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
        for (const b of body) for (const l of b ? wrap(b, inner) : [""])
          out.push(fg(colour) + "│ " + RESET + pad(inline(l), inner) + fg(colour) + " │" + RESET);
      }
      out.push(fg(colour) + "╰" + "─".repeat(bw - 2) + "╯" + RESET);
      continue;
    }

    // Table: header row, separator row, body rows.
    if (/^\s*\|/.test(line) && /^\s*\|?\s*:?-{2,}/.test(src[i + 1] ?? "")) {
      const rows: string[] = [line];
      for (i++; i < src.length && /^\s*\|/.test(src[i]!); i++) rows.push(src[i]!);
      i--;
      out.push(...table(rows, W));
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
          if (t.trim() && !/^\s*([-*]|\d+[.)])\s*$/.test(t)) out.push(...prose(t, W));
        });
        continue;
      }
    }
    out.push(...prose(line, W));
  }
  const { lines, ranges } = extractLinks(out.map(stripMarks));
  return { lines, images, media: mediaRefs, links: ranges };
}

/** Blockquote, heading, list item or paragraph. */
function prose(line: string, W: number): string[] {
  const out: string[] = [];
  if (/^\s*>/.test(line)) { for (const l of wrap(line.replace(/^\s*> ?/, ""), W - 2)) out.push(fg(C.green) + "▌ " + RESET + inline(l)); return out; }
  const h = line.match(/^(#{1,6})\s+(.*)$/);
  if (h) return [fg(C.dark) + h[1] + " " + RESET + BOLD + fg(C.white) + h[2] + RESET];
  const li = line.match(/^(\s*)([-*]|\d+[.)])\s+(.*)$/);
  if (li) {
    const indent = li[1]!.length, mark = /\d/.test(li[2]!) ? li[2]! : "∙";
    const lead = " ".repeat(indent) + mark + " ";
    wrap(li[3]!, W - lead.length).forEach((l, k) => out.push((k ? " ".repeat(lead.length) : fg(C.lcyan) + lead + RESET) + inline(l)));
    return out;
  }
  if (!line.trim()) return [""];
  return wrap(line, W).map(inline);
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
export function table(rows: string[], W: number): string[] {
  const head = cells(rows[0]!);
  const align = cells(rows[1]!).map(a => (a.startsWith(":") && a.endsWith(":") ? "c" : a.endsWith(":") ? "r" : "l"));
  const body = rows.slice(2).map(cells);
  const n = Math.max(head.length, ...body.map(r => r.length));
  const all = [head, ...body].map(r => Array.from({ length: n }, (_, k) => r[k] ?? ""));
  const natural = Array.from({ length: n }, (_, k) => Math.max(1, ...all.map(r => [...r[k]!].length)));
  const longestWord = Array.from({ length: n }, (_, k) => Math.max(1, ...all.flatMap(r => r[k]!.split(/\s+/).map(w => [...w].length))));
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
      out.push(B("│") + wrapped.map((w, k) => " " + fit(header ? BOLD + fg(C.white) + (w[y] ?? "") + RESET : inline(w[y] ?? ""), widths[k]!, align[k] ?? "l") + " ").join(B("│")) + B("│"));
    return out;
  };
  const out = [rule("┌", "┬", "┐"), ...line(all[0]!, true), rule("╞", "╪", "╡").replace(/─/g, "═")];
  all.slice(1).forEach((r, k) => { out.push(...line(r, false)); if (k < all.length - 2) out.push(rule("├", "┼", "┤")); });
  out.push(rule("└", "┴", "┘"));
  return out;
}

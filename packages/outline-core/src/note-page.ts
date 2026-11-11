// A note as parts a client draws (`notes.page`, ADR 0002: one answer, a renderer per client): its title and header
// chips, then its body in order, each part prose or a component with the service's answer in it. A client that can't
// run this package (a native window, a web view, a chat app) reads Blockdown through this and parses nothing: the
// service finds the components, asks their questions (`site.answer`) and says what each holds. Pure: no I/O.
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, quoteDepth, type CalloutRegistry } from "./callouts";
import { noteCodeFences } from "./component-block";
import { linkOccurrences } from "./link-syntax";
import type { ListPrimitive } from "./list-row";

/** One row of a `::links` group or a `::fields`: what it says, the note it opens (none: it opens nothing here), a quiet word after it. */
export interface PageRow { text: string; id?: string; note?: string }

/** What every component part carries: its name as written, its title, the lines it was written as, and the service's word on its answer. */
interface ComponentPart {
  name: string;
  title?: string;
  /** Its lines as written: what a client shows when it draws nothing better, and beside an `error`. */
  source: string;
  /** How fresh the answer is, as a page's footer says it ("live · 3 results"). */
  status?: string;
  /** Why it has no answer, or what is wrong with the one it has: the service's words. */
  error?: string;
}

export type PagePart =
  /** Prose as Markdown (the render target): Blockdown links written as Markdown links (`blockHref`, `pageHref`). */
  | { kind: "prose"; markdown: string }
  /**
   * A `::graph-*` figure: `figure` is its kind (`stat`, `check`, `table`…), `props` what it draws from once the outline
   * has answered (outline-core's `liveProps`), and `markdown` the same results as Markdown for a client with no drawing
   * of that kind (outline-core's `figureResultsMarkdown`).
   */
  | ({ kind: "figure"; figure: string; props: Record<string, unknown>; markdown?: string } & ComponentPart)
  /** A `::view` or a query-backed `::graph-table`: the view's own list, as every client draws it. */
  | ({ kind: "view"; view: ListPrimitive; query?: string; truncated?: boolean } & ComponentPart)
  /** A `::links` (and `::outlinks`, `::backlinks`, `::resources`) or a `::fields`: named groups of rows. */
  | ({ kind: "rows"; groups: { name: string; rows: PageRow[]; empty?: string }[]; query?: string } & ComponentPart)
  /** A component the service has no answer for (a button, a box, an extension's): its source. */
  | ({ kind: "component" } & ComponentPart);

/** `notes.page`'s answer. */
export interface NotePage {
  blockId: string;
  revision: number;
  /** The title as every list shows it: the header line without its chips. */
  title: string;
  /** The header line's chips, in order. */
  chips: { key: string; value: string }[];
  /** The Blockdown source: what an editor opens on and a save sends back at `revision`. */
  text: string;
  parts: PagePart[];
}

/** A note rendered as its published page renders it (`notes.render`, PIE-767). */
export interface RenderedNote {
  blockId: string;
  /** Its title as the page shows it. */
  title: string;
  format: "markdown" | "html";
  /** The Markdown, or the HTML article (no page, styles or scripts around it). */
  text: string;
  /** Whether it is published itself (rendering doesn't need it to be). */
  published: boolean;
}

/** The address a link in a page's prose opens: a note by its id, or a page by its address (resolved when followed, `pages.resolve`). */
export const blockHref = (id: string) => `ep0ch:b/${id}`;
export const pageHref = (address: string) => `ep0ch:p/${encodeURIComponent(address)}`;

const label = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");

/** The ids `text` refers to without a label: a page reads their titles once, for `proseMarkdown`. */
export function unlabelledReferences(text: string): string[] {
  return [...new Set(linkOccurrences(text).flatMap(l => l.kind === "block" && l.label === undefined ? [l.blockId] : []))];
}

/**
 * Blockdown prose as Markdown for a Markdown renderer: each reference and page link a Markdown link (`titles`: what an
 * unlabelled reference reads as), each callout's `[!type] title` a bold lead in its quote, and two written lines two
 * lines (a hard break where Markdown would run them together). Code is left as written.
 */
export function proseMarkdown(text: string, titles: ReadonlyMap<string, string>, callouts: CalloutRegistry = BUILTIN_CALLOUT_REGISTRY): string {
  let out = "", at = 0;
  for (const l of linkOccurrences(text)) {
    if (l.kind === "markdown" || l.kind === "url" || (l.kind === "page" && l.nested) || l.start < at) continue;
    out += text.slice(at, l.start) + (l.kind === "block"
      ? `[${label(l.label ?? titles.get(l.blockId) ?? l.blockId.slice(0, 8))}](${blockHref(l.blockId)})`
      : `[${label(l.label ?? l.displayAddress)}](${pageHref(l.displayAddress)})`);
    at = l.end;
  }
  const lines = (out + text.slice(at)).split("\n");
  for (const c of calloutBlocks(lines)) {
    const type = callouts.style(c.type), line = lines[c.line]!;
    lines[c.line] = `${line.slice(0, line.length - quoteDepth(line).content.length)}**${type.icon} ${c.title || type.title}**`;
  }
  const code = new Set(noteCodeFences(lines).flatMap(f => Array.from({ length: f.end - f.start + 1 }, (_, i) => f.start + i)));
  return lines.map((line, i) => !code.has(i) && !code.has(i + 1) && line.trim() && lines[i + 1]?.trim() && !line.endsWith("  ") ? `${line}  ` : line).join("\n");
}

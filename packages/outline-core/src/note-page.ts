// A note as parts a client draws (`notes.page`, ADR 0002: one answer, a renderer per client): its title and header
// chips, then its body in order, each part prose or a component with the service's answer in it. A client that can't
// run this package (a native window, a web view, a chat app) reads Blockdown through this and parses nothing: the
// service finds the components, asks their questions (`site.answer`) and says what each holds. Pure: no I/O.
import { BUILTIN_CALLOUT_REGISTRY, calloutBlocks, quoteDepth, type CalloutRegistry } from "./callouts";
import { noteCodeFences } from "./component-block";
import { linkOccurrences, pageAddressReferences } from "./link-syntax";
import type { SourceRange } from "./code-ranges";
import type { ComponentKind } from "./component-at";
import type { Primitive } from "./primitive";
import { readContentSize, type Align, type ContentWidth, type Focus, type MediaSpec } from "./media-line";

/**
 * A picture a note shows (a media line, `[img::path]`; or an ```svg fence, whose text is the picture): where its bytes
 * are and how the note asks for it to be laid out. A client reads a file's bytes with `media.read`.
 */
export interface PagePicture {
  /** The file's path as written: `media.read` answers its bytes. None for a picture drawn from the note's own text. */
  path?: string;
  /** An ```svg fence's text: the picture itself. */
  svg?: string;
  alt?: string;
  /** `fit` keeps the reading measure; `full` fills the width there is. */
  width: ContentWidth;
  /** Its height in terminal rows, when the note says one. */
  height?: number;
  align?: Align;
  /** A header's: crop to fill its band (`cover`) or show it whole (`contain`). */
  fit?: "cover" | "contain";
  /** The point a crop keeps in view, as fractions across and down. */
  focus?: Focus;
  /** 0 as it is … 1 black. */
  dim?: number;
  /** What's written on its line that isn't a layout value: said under it. */
  problems?: string[];
}

/** A media line or picture fence as the picture a page shows. */
export function pagePicture(spec: MediaSpec, svg?: string): PagePicture {
  const size = readContentSize({ width: spec.width, height: spec.height, size: spec.size });
  return {
    ...(svg !== undefined ? { svg } : { path: spec.path }), width: size.width, ...(size.height !== undefined ? { height: size.height } : {}),
    ...(spec.alt ? { alt: spec.alt } : {}), ...(spec.align ? { align: spec.align } : {}), ...(spec.fit ? { fit: spec.fit } : {}),
    ...(spec.focus ? { focus: spec.focus } : {}), ...(spec.dim !== undefined ? { dim: spec.dim } : {}), ...(spec.problems.length ? { problems: spec.problems } : {}),
  };
}

/**
 * What a part of a page is drawn as: a primitive of the catalogue (primitive.ts), or one of the four a page adds.
 * A client draws each by its `type` and reads nothing else of the note.
 */
export type PagePrimitive =
  | Exclude<Primitive, { type: "box" }>
  /** A box: its children are the parts written inside it. */
  | { type: "box"; title?: string; children: PagePrimitive[] }
  /** Prose as Markdown (the render target): Blockdown links written as Markdown links (`blockHref`, `pageHref`). */
  | { type: "markdown"; text: string }
  /** A picture where it stands in the note. (The note's header image is the page's `hero`, not a part.) */
  | ({ type: "picture" } & PagePicture)
  /** Lines as they were written: a component nobody has an answer or a drawing for. Never hidden. */
  | { type: "source"; text: string }
  | PagePart;

/** The primitive types a page adds to the catalogue's, each with the fields it takes (a part's are `PagePart`'s). */
export const PAGE_PRIMITIVE_FIELDS = {
  markdown: ["text"],
  picture: ["path", "svg", "alt", "width", "height", "align", "fit", "focus", "dim", "problems"],
  source: ["text"],
  part: ["kind", "block", "span", "line", "name", "figure", "title", "query", "status", "error", "truncated", "sequence", "view"],
} as const satisfies { [T in Exclude<PagePrimitive["type"], Primitive["type"]>]: readonly string[] };

/** What a part was written as: `componentAt`'s kinds (component-at.ts), prose, and a picture. Said for a reader of the data; nothing draws by it. */
export type PagePartKind = ComponentKind | "prose" | "picture";

/**
 * One part of a note's body, in order: where it is written, the service's word on its answer, and what to draw
 * (`view`). The frame is the same for every part; a part of prose has only its place and its view.
 */
export interface PagePart {
  type: "part";
  kind: PagePartKind;
  /** The note it is written in. */
  block: string;
  /** Where its lines are in that note's text, in UTF-16 code units (`end` exclusive): `text.slice(start, end)` is it as written. */
  span: SourceRange;
  /** The line of the note (from 0) it starts on: how a press names a button (`scripts.sequence`). */
  line: number;
  /** A component's name as written (`graph-stat`, `links`, `button`). */
  name?: string;
  /** A figure's kind (`stat`, `check`…). */
  figure?: string;
  title?: string;
  /** The question it asks, in the views' grammar: a client opens it as a query. */
  query?: string;
  /** How fresh the answer is, as a page's footer says it ("live · 3 results"). */
  status?: string;
  /** Why it has no answer, or what is wrong with the one it has: the service's words. */
  error?: string;
  /** More matched than the view holds. */
  truncated?: true;
  /** A button whose press is the service's to run (several steps, or a script): `scripts.sequence` with `block` and `line`. */
  sequence?: true;
  view: PagePrimitive;
}

/** A note in a list, as every list of a page names one: its id, its title as lists show it, and where it sits. */
export interface NoteRow { id: string; title: string; hasChildren?: boolean; /** The titles above it, outermost first, as a breadcrumb. */ context?: string }

/** `notes.page`'s answer: everything a client draws of one note, in one read. */
export interface NotePage {
  blockId: string;
  revision: number;
  /** The title as every list shows it: the header line without its chips. */
  title: string;
  /** The header line's chips, in order. */
  chips: { key: string; value: string }[];
  /** Every property the note carries, the header's and the body's, as the service read them. */
  properties: { key: string; value: string }[];
  /** The Blockdown source: what an editor opens on and a save sends back at `revision`. */
  text: string;
  parts: PagePart[];
  /** The note's header image (its first `[layout::hero]` media line), drawn above the title. */
  hero?: PagePicture;
  /** The notes above it, outermost first. */
  ancestors: NoteRow[];
  /** The notes under it, in order. */
  children: NoteRow[];
  /** The notes that link to it. */
  backlinks: NoteRow[];
  updated: string;
  /** Who last wrote it: the actor when one is recorded, else the author. */
  author: string;
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

/**
 * The address a link in a page's prose opens: a note by its id. A page link whose page exists is written to its note
 * (`blockHref`); one whose page isn't there yet keeps its address (`pageHref`), which opens nothing until it is.
 */
export const blockHref = (id: string) => `ep0ch:b/${id}`;
export const pageHref = (address: string) => `ep0ch:p/${encodeURIComponent(address)}`;

/** The page addresses `text` links to, as written: a page resolves each once (`pages.resolve`), for `proseMarkdown`. */
export function pageAddresses(text: string): string[] {
  return [...new Set(pageAddressReferences(text).filter(p => !p.nested).map(p => p.displayAddress))];
}

const label = (s: string) => s.replace(/([\[\]\\])/g, "\\$1");

/** The ids `text` refers to without a label: a page reads their titles once, for `proseMarkdown`. */
export function unlabelledReferences(text: string): string[] {
  return [...new Set(linkOccurrences(text).flatMap(l => l.kind === "block" && l.label === undefined ? [l.blockId] : []))];
}

/**
 * Blockdown prose as Markdown for a Markdown renderer: each reference and page link a Markdown link (`titles`: what an
 * unlabelled reference reads as; `pages`: the note each page address resolves to), each callout's `[!type] title` a bold lead in its quote, and two written lines two
 * lines (a hard break where Markdown would run them together). Code is left as written.
 */
export function proseMarkdown(text: string, titles: ReadonlyMap<string, string>, pages: ReadonlyMap<string, string> = new Map(), callouts: CalloutRegistry = BUILTIN_CALLOUT_REGISTRY): string {
  let out = "", at = 0;
  for (const l of linkOccurrences(text)) {
    if (l.kind === "markdown" || l.kind === "url" || (l.kind === "page" && l.nested) || l.start < at) continue;
    out += text.slice(at, l.start) + (l.kind === "block"
      ? `[${label(l.label ?? titles.get(l.blockId) ?? l.blockId.slice(0, 8))}](${blockHref(l.blockId)})`
      : `[${label(l.label ?? l.displayAddress)}](${pages.has(l.displayAddress) ? blockHref(pages.get(l.displayAddress)!) : pageHref(l.displayAddress)})`);
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

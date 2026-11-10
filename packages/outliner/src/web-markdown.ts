import { createHash } from "node:crypto";
import type { ResourceRepresentationAdapter } from "./resources";

export interface WebSnapshotInput {
  readonly html: string;
  readonly url: string;
}

export interface WebMarkdownExtractor {
  readonly adapter: ResourceRepresentationAdapter;
  extract(snapshot: WebSnapshotInput): string;
}

export const BASIC_WEB_MARKDOWN_ADAPTER: ResourceRepresentationAdapter = {
  id: "builtin.basic-html-to-markdown",
  version: 1,
};

/**
 * A page that is already text (Markdown or plain) is its own representation: no extractor touches it. A stored
 * snapshot's representations carry this adapter, which is how a later refresh knows the snapshot was never HTML.
 */
export const WEB_TEXT_ADAPTER: ResourceRepresentationAdapter = {
  id: "builtin.web-text",
  version: 1,
};

/** What a fetched page's body is: HTML, for the extractor, or text, read as it is. */
export type WebBodyKind = "html" | "text";

/** The adapter that makes a snapshot of this kind's representation: the extractor for HTML, none for text. */
export function webAdapterFor(kind: WebBodyKind, extractor: WebMarkdownExtractor): ResourceRepresentationAdapter {
  return kind === "text" ? WEB_TEXT_ADAPTER : extractor.adapter;
}

/** A snapshot's representation: the text as it is, or the extractor's Markdown of the HTML. */
export function webMarkdown(kind: WebBodyKind, extractor: WebMarkdownExtractor, snapshot: WebSnapshotInput): string {
  return kind === "text" ? snapshot.html : extractor.extract(snapshot);
}

/** Whether a stored representation was made by an adapter in use now (the text one, or this extractor). */
export function webAdapterCurrent(id: string, version: number, extractor: WebMarkdownExtractor): boolean {
  return [WEB_TEXT_ADAPTER, extractor.adapter].some((adapter) => adapter.id === id && adapter.version === version);
}

const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
// The WHATWG sniffing standard's HTML signatures, after an optional byte-order mark: a Markdown autolink
// (`<https://…>`) is not one.
const HTML_SIGNATURE = /^\uFEFF?\s*(?:<!doctype html|<(?:html|head|script|iframe|h1|div|font|table|a|style|title|b|body|br|p)|<!--)[\s>]/i;
const TEXT_MEDIA_TYPES = new Set(["text/markdown", "text/x-markdown", "text/plain"]);

/** The media types a web Resource asks for and reads, in the Accept header's order. */
export const WEB_ACCEPT = "text/html,application/xhtml+xml,text/markdown,text/plain;q=0.9";

/**
 * The kind of a page by its media type (lowercased, no parameters; "" when it named none), or why it can't be read.
 * With no media type the body decides: one that opens with an HTML signature is HTML, other text is text, a body with control
 * bytes is not a page this reads.
 */
export function webBodyKind(mediaType: string, body: string): WebBodyKind | { readonly refused: string } {
  if (HTML_MEDIA_TYPES.has(mediaType)) return "html";
  if (TEXT_MEDIA_TYPES.has(mediaType)) return "text";
  const unsupported = unsupportedWebMediaType(mediaType);
  if (unsupported) return { refused: unsupported };
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000e-\u001a\u001c-\u001f]/.test(body.slice(0, 4096))) {
    return { refused: "Web provider returned no media type, and the page isn't text" };
  }
  return HTML_SIGNATURE.test(body) ? "html" : "text";
}

/**
 * Why a page of this media type isn't read, said before its body is fetched; null for one that is read, and for none
 * named (its body decides, in `webBodyKind`).
 */
export function unsupportedWebMediaType(mediaType: string): string | null {
  if (!mediaType || HTML_MEDIA_TYPES.has(mediaType) || TEXT_MEDIA_TYPES.has(mediaType)) return null;
  return `Web provider returned unsupported media type: ${mediaType} (it reads text/html, text/markdown and text/plain)`;
}

function decodeHtmlEntities(value: string): string {
  const named: Readonly<Record<string, string>> = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: '"',
  };
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith("#x")) {
      const codePoint = Number.parseInt(entity.slice(2), 16);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    if (entity.startsWith("#")) {
      const codePoint = Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : match;
    }
    return named[entity.toLowerCase()] ?? match;
  });
}

function absoluteLink(href: string, baseUrl: string): string {
  try {
    return new URL(decodeHtmlEntities(href), baseUrl).href;
  } catch {
    return decodeHtmlEntities(href);
  }
}

export class BasicWebMarkdownExtractor implements WebMarkdownExtractor {
  readonly adapter = BASIC_WEB_MARKDOWN_ADAPTER;

  extract(snapshot: WebSnapshotInput): string {
    let markdown = snapshot.html
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|noscript|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
      .replace(/<a\b[^>]*\bhref\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a\s*>/gi, (_match, _quote, href: string, label: string) => {
        const text = label.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
        return text ? `[${text}](${absoluteLink(href, snapshot.url)})` : absoluteLink(href, snapshot.url);
      })
      .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi, (_match, level: string, text: string) => `\n\n${"#".repeat(Number(level))} ${text}\n\n`)
      .replace(/<li\b[^>]*>/gi, "\n- ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/(?:p|div|section|article|main|header|footer|nav|aside|ul|ol|pre|blockquote)\s*>/gi, "\n\n")
      .replace(/<(?:p|div|section|article|main|header|footer|nav|aside|ul|ol|pre|blockquote)\b[^>]*>/gi, "\n")
      .replace(/<strong\b[^>]*>([\s\S]*?)<\/strong\s*>/gi, "**$1**")
      .replace(/<b\b[^>]*>([\s\S]*?)<\/b\s*>/gi, "**$1**")
      .replace(/<em\b[^>]*>([\s\S]*?)<\/em\s*>/gi, "*$1*")
      .replace(/<i\b[^>]*>([\s\S]*?)<\/i\s*>/gi, "*$1*")
      .replace(/<code\b[^>]*>([\s\S]*?)<\/code\s*>/gi, "`$1`")
      .replace(/<[^>]+>/g, " ");
    markdown = decodeHtmlEntities(markdown)
      .replace(/[\t\f\v ]+/g, " ")
      .replace(/ *\n */g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    return markdown;
  }
}

/** The SHA-256 of a text (as UTF-8) or of bytes, as hex: the content hash a Resource's snapshots carry. */
export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

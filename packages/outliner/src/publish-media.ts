// A note's media lines on a published page (PIE-532's grammar, outline-core's media-line.ts): an image the page may
// serve is drawn as one, sized, aligned and dimmed as the line says; one it may not (outside the publish roots, missing,
// a type it doesn't serve, a service on another machine, a page with no address) shows its alt text and its file's name,
// never an empty bullet and never its path. The image's address names the block and the line that holds it, never a
// path: the publisher reads the line again when it's asked (publish.ts `serveMedia`), so a URL can only reach an image a
// shown note names.
//
// An artifact line (PIE-793, `[artifact::path]`) runs inline: a sandboxed frame of the artifact's own page
// (`/p/<id>/artifact/<line>`, publish.ts `serveArtifact`, through the [file::] pipeline of publish-artifacts.ts), kept
// dark until it draws, with a link that opens it on a page of its own.
import { noteStructure } from "@ep0ch/outline-core/component-block";
import { ARTIFACT_KIND_LABELS, artifactKind, fileName, parseMediaLine, type MediaSpec } from "@ep0ch/outline-core/media-line";
import { componentSentinel, MAX_PUBLISHED_COMPONENTS } from "./publish-components";
import type { DrawnComponent } from "./publish-live";

/**
 * Where line `line` of note `blockId` serves its image, below the page's base; with `image`, the `image`th image
 * primitive of the component that line draws (PIE-827).
 */
export const mediaPath = (blockId: string, line: number, image?: number) => `/p/${blockId}/media/${line}${image === undefined ? "" : `/${image}`}`;
/** `/p/<id>/media/<line>` or `/p/<id>/media/<line>/<image>`: the block, the line and the component's image, or null. */
export const MEDIA_PATH = /^\/p\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/media\/(\d{1,6})(?:\/(\d{1,3}))?$/;
/** `/p/<id>/artifact/<line>` (outline-core's artifactPagePath): the block and the line, or null. */
export const ARTIFACT_PATH = /^\/p\/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\/artifact\/(\d{1,6})$/;

/** The media lines of a note's text, by line (none inside a fence or a component): the door's reading of it too. */
export function noteMediaLines(text: string): Map<number, MediaSpec> {
  const lines = text.split("\n"), structure = noteStructure(lines), out = new Map<number, MediaSpec>();
  let hero = false;
  lines.forEach((line, at) => {
    const spec = structure[at] === -1 ? parseMediaLine(line) : null;
    if (!spec) return;
    // The first `[layout::hero]` is the header; a later one is an image like any other, as the door reads it.
    if (spec.layout === "hero") { if (hero) delete spec.layout; hero = true; }
    out.set(at, spec);
  });
  return out;
}

export { fileName };

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);

/** A width as the page draws it: a terminal cell is about a character wide. */
function width(spec: MediaSpec): string | undefined {
  if (spec.layout === "hero" || spec.size === "full") return "100%";
  if (!spec.size) return undefined;
  return "percent" in spec.size ? `${spec.size.percent}%` : `min(100%,${spec.size.cells}ch)`;
}

/**
 * An image as HTML: dark behind it until it loads, held a little below full brightness unless `[dim::]` says how much
 * (0 none … 1 black), its alt text its caption.
 */
export function mediaHtml(spec: MediaSpec, src: string | null, title?: string): string {
  if (spec.kind === "artifact") return artifactHtml(spec, src, title ?? fileName(spec.path));
  const alt = spec.alt ?? "";
  const align = spec.align ?? (spec.layout === "hero" ? "center" : "left");
  if (!src || spec.kind !== "img") {
    const what = spec.kind === "video" ? "video" : "image";
    return `<figure class="media media-missing media-${align}"><span class="media-what">${what}</span> ` +
      `${alt ? `${escapeHtml(alt)} ` : ""}<code>${escapeHtml(fileName(spec.path))}</code></figure>`;
  }
  const styles: string[] = [];
  const w = width(spec);
  if (w) styles.push(`width:${w}`);
  if (spec.height) styles.push(`max-height:${(spec.height * 1.25).toFixed(2)}rem`, `object-fit:${spec.fit ?? "contain"}`);
  else if (spec.layout === "hero") styles.push("max-height:40vh", `object-fit:${spec.fit ?? "cover"}`);
  if (spec.focus) styles.push(`object-position:${Math.round(spec.focus.x * 100)}% ${Math.round(spec.focus.y * 100)}%`);
  styles.push(`filter:brightness(${spec.dim !== undefined ? Math.round((1 - spec.dim) * 100) / 100 : 0.9})`);
  return `<figure class="media media-${align}${spec.layout === "hero" ? " media-hero" : ""}">` +
    `<img src="${escapeHtml(src)}" alt="${escapeHtml(alt)}" loading="lazy" decoding="async" style="${styles.join(";")}">` +
    `${alt ? `<figcaption>${escapeHtml(alt)}</figcaption>` : ""}</figure>`;
}

/** The permissions an artifact's frame runs with: claude.ai's, never this page's origin (no allow-same-origin). */
export const ARTIFACT_SANDBOX = "allow-scripts allow-popups allow-popups-to-escape-sandbox allow-forms allow-modals allow-downloads";
/** An artifact's frame height when its line gives none: a phone's screen, less the page around it. */
const ARTIFACT_HEIGHT = "min(36rem,75vh)";

/**
 * An artifact in its note (PIE-793): its own page in a sandboxed frame, as wide and tall as its line says (`height` in
 * rows, as an image's), dark behind until its page draws, its kind and title under it with a link to it on a page of its
 * own. One the page may not run (outside the publish roots, missing, not an artifact's kind) is a card with its words.
 */
function artifactHtml(spec: MediaSpec, src: string | null, title: string): string {
  const kind = artifactKind(spec.path), label = kind ? ARTIFACT_KIND_LABELS[kind] : "artifact";
  const align = spec.align ?? "left";
  if (!src || !kind) {
    return `<figure class="media media-missing media-${align}"><span class="media-what">${escapeHtml(label)} artifact</span> ` +
      `${escapeHtml(title)}${title !== fileName(spec.path) ? ` <code>${escapeHtml(fileName(spec.path))}</code>` : ""}</figure>`;
  }
  const styles = [`height:${spec.height ? `${(spec.height * 1.25).toFixed(2)}rem` : ARTIFACT_HEIGHT}`];
  const w = width(spec);
  if (w) styles.push(`width:${w}`);
  return `<figure class="media artifact media-${align}"><div class="artifact-frame" style="${styles.join(";")}">` +
    `<iframe src="${escapeHtml(src)}" title="${escapeHtml(title)}" sandbox="${ARTIFACT_SANDBOX}" allow="autoplay; fullscreen; clipboard-write" ` +
    `loading="lazy" referrerpolicy="no-referrer"></iframe></div>` +
    `<figcaption><span class="media-what">${escapeHtml(label)}</span> ${escapeHtml(title)} · ` +
    `<a href="${escapeHtml(src)}" target="_blank" rel="noopener">open full page</a></figcaption></figure>`;
}

/** An image as Markdown: the image itself where it's served, else its alt text and its file's name. */
export function mediaMarkdown(spec: MediaSpec, src: string | null, title?: string): string {
  if (spec.kind === "artifact") {
    const kind = artifactKind(spec.path), what = `${kind ? ARTIFACT_KIND_LABELS[kind] : "an"} artifact: ${(title ?? fileName(spec.path)).replace(/[[\]\\*]/g, "")}`;
    return src && kind ? `*${what}* ([open](${src}))` : `*${what}* \`${fileName(spec.path).replace(/`/g, "'")}\``;
  }
  const alt = (spec.alt ?? "").replace(/[[\]\\]/g, "");
  if (src && spec.kind === "img") return `![${alt}](${src})`;
  const name = fileName(spec.path).replace(/`/g, "'");
  return `*${spec.kind === "video" ? "video" : "image"}${alt ? `: ${alt}` : ""}* \`${name}\``;
}

export const MEDIA_STYLE = `
.media{margin:1rem 0}
.media img{display:block;max-width:100%;height:auto;background:#1a1a18;border-radius:.25rem}
.media-center img{margin:0 auto}.media-right img{margin-left:auto}
.media-center figcaption{text-align:center}.media-right figcaption{text-align:right}
.media figcaption{color:var(--dim);font-size:.85em;margin-top:.35rem}
.media-missing{color:var(--dim);border:1px dashed var(--rule);border-radius:.25rem;padding:.5rem .75rem}
.media-missing .media-what,.artifact .media-what{font:12px/1.4 ui-monospace,Menlo,monospace;text-transform:uppercase;letter-spacing:.05em}
.artifact-frame{max-width:100%;background:#141413;border:1px solid var(--rule);border-radius:.25rem;overflow:hidden}
.media-center .artifact-frame{margin:0 auto}.media-right .artifact-frame{margin-left:auto}
.artifact iframe{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:light}
`;

/**
 * Each note's media lines, drawn in their lines' place (`drawn`, beside the figures already there, which keep theirs):
 * in HTML a component (its sentinel), in Markdown the image or its words. `src` answers where a line's image (or
 * artifact) is served from, or null when it isn't; `title` an artifact's title. `first`: the page's own note, whose first
 * line is its title (kept above an image there).
 */
export function drawNoteMedia(
  notes: readonly { id: string; text: string }[], format: "markdown" | "html", components: string[],
  drawn: Map<string, Map<number, DrawnComponent>>, src: (blockId: string, line: number, spec: MediaSpec) => string | null,
  first?: { id: string; title: string }, title?: (blockId: string, line: number, spec: MediaSpec) => string | undefined,
): void {
  for (const note of notes) {
    if (!/\[?(?:img|image|video|artifact)::/i.test(note.text)) continue;
    const own = drawn.get(note.id) ?? new Map<number, DrawnComponent>();
    const taken = (line: number) => [...own].some(([at, component]) => at <= line && line < component.end);
    for (const [line, spec] of noteMediaLines(note.text)) {
      if (taken(line)) continue;
      const at = src(note.id, line, spec), named = spec.kind === "artifact" ? title?.(note.id, line, spec) : undefined;
      let shown: string;
      if (format === "html") {
        if (components.length >= MAX_PUBLISHED_COMPONENTS) break;
        components.push(mediaHtml(spec, at, named));
        shown = componentSentinel(components.length - 1);
      } else shown = mediaMarkdown(spec, at, named);
      own.set(line, { end: line + 1, markdown: line === 0 && first?.id === note.id ? `${first.title}\n\n${shown}` : shown });
    }
    if (own.size) drawn.set(note.id, own);
  }
}

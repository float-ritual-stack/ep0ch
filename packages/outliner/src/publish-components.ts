// What a handler line draws on a published page (an extension's output or component, src/extension-calls.ts), and
// the look of the shared primitives' HTML (`ext-*` classes, src/component-primitives.ts). A component's HTML is the
// service's (`extensions.render`, its own HTML kept to the page's markup); it rides through the Markdown renderer as a
// private-use sentinel on a line of its own and is put in its place after (drawComponents), as marginalia's marks do.
// A line with nothing to draw yet shows its source as code: never dropped.
import { buttonCallsOf } from "@ep0ch/outline-core/button-call";
import { buttonHtml } from "./component-primitives";
import type { DrawnComponent } from "./publish-live";
import type { ResourceProjection } from "./resource-projection";

/** At most this many components on one page: each takes one private-use sentinel character. */
export const MAX_PUBLISHED_COMPONENTS = 255;
const MARK = "", BASE = 0xE200;
const SENTINEL = /(?:<p>)?([-])(?:<\/p>)?/g;

/** Dark, quiet, and in the page's own type: a row is a grid that stacks below its children's `minWidth`. */
export const COMPONENT_STYLE = `
.ext-component{margin:1rem 0}
.ext-row{display:grid;gap:1rem;grid-template-columns:repeat(auto-fit,minmax(min(100%,var(--ext-min,12ch)),1fr))}
.ext-stack>*+*{margin-top:.75rem}
.ext-box,.ext-card{border:1px solid var(--rule);border-radius:.35rem;padding:.75rem 1rem;min-width:0;overflow-wrap:anywhere}
.ext-box>h4{margin:0 0 .5rem;font:600 14px/1.4 ui-sans-serif,system-ui,sans-serif;color:var(--dim);letter-spacing:.02em}
.ext-blockdown{white-space:pre-wrap}
.ext-blockdown.ext-read{white-space:normal}
.ext-blockdown.ext-read>:first-child{margin-top:0}
.ext-blockdown.ext-read>:last-child{margin-bottom:0}
.ext-text{margin:.25rem 0}
.ext-label,.ext-subtitle{color:var(--dim)}
.ext-badge{font:12px/1.4 ui-monospace,Menlo,monospace;border:1px solid var(--rule);border-radius:.25rem;padding:0 .35rem}
.ext-good{color:#8fc79a}.ext-warn{color:#d9b46a}.ext-bad{color:#dd8a80}.ext-dim{color:var(--dim)}.ext-accent{color:var(--link)}
.ext-source code{color:var(--dim)}
.ep-button{display:inline-block;font:14px/1.4 ui-monospace,Menlo,monospace;font-weight:600;padding:.15rem .6rem;border-radius:.3rem;color:var(--link);border:1px solid transparent}
.ep-button.tone-primary{color:#e0c060}.ep-button.tone-danger{color:#dd8a80}
.ep-button[class*=frame-]{border-color:currentColor}.ep-button.frame-box{border-radius:0}.ep-button.frame-heavy{border-width:2px}.ep-button.frame-double{border-style:double;border-width:3px}
.ep-button.fill{background:#1c2a44;color:#e8e6df}.ep-button.fill.tone-primary{background:#3a3014;color:#e0c060}.ep-button.fill.tone-danger{background:#3f1d1a;color:#e8e6df}
`;

/** Each note's one-line `::button`s in their lines' place (`drawn`), as components; a line already drawn keeps its drawing. */
export function drawNoteButtons(notes: readonly { id: string; text: string }[], components: string[], drawn: Map<string, Map<number, DrawnComponent>>): void {
  for (const note of notes) {
    const own = drawn.get(note.id) ?? new Map<number, DrawnComponent>();
    for (const b of buttonCallsOf(note.text)) {
      if (b.endLine !== b.line || own.has(b.line) || components.length >= MAX_PUBLISHED_COMPONENTS) continue;
      components.push(buttonHtml(b.label, b.look));
      own.set(b.line, { end: b.line + 1, markdown: componentSentinel(components.length - 1) });
    }
    if (own.size) drawn.set(note.id, own);
  }
}

export const componentSentinel = (index: number) => `${MARK}${String.fromCharCode(BASE + index)}${MARK}`;
/** Whether `text` is one component's sentinel and nothing else. */
export const isComponentSentinel = (text: string) => text.length === 3 && text[0] === MARK && text[2] === MARK;

/** The rendered page with each component's HTML in its sentinel's place. */
export function drawComponents(html: string, components: readonly string[]): string {
  return components.length ? html.replace(SENTINEL, (_, at: string) => components[at.charCodeAt(0) - BASE] ?? "") : html;
}

/** A line's source as Markdown code, with a fence of backticks longer than any it holds. */
export function lineSource(line: string): string {
  const longest = Math.max(0, ...[...line.matchAll(/`+/g)].map((run) => run[0].length));
  const ticks = "`".repeat(longest + 1);
  return `${ticks}${longest ? " " : ""}${line.trim()}${longest ? " " : ""}${ticks}`;
}

const unescape = (text: string) => text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) =>
  ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]!);

/** A component's `blockdown` primitives (escaped source in the service's HTML) drawn by the page's own reader. */
export function readBlockdown(html: string, read: (source: string) => string): string {
  return html.replace(/<div class="ext-blockdown">([^<]*)<\/div>/g, (_, source: string) => `<div class="ext-blockdown ext-read">${read(unescape(source))}</div>`);
}

/**
 * A component's `image` primitives (PIE-827), each a placeholder in the service's HTML (`data-ext-image="<n>"`, n its
 * order in the view), as `draw(n)` draws it: the page's image where it may serve the file, else its words. A
 * placeholder `draw` has nothing for stays as it is: the words and the file's name.
 */
export function readImages(html: string, draw: (image: number) => string | null): string {
  return html.replace(/<figure class="media media-missing ext-image" data-ext-image="(\d+)">[\s\S]*?<\/figure>/g, (whole, n: string) => draw(Number(n)) ?? whole);
}

/** A handler line's projection that a page draws: an output or a component, not a data record (a block of its own). */
export const drawnLine = (projection: ResourceProjection) => projection.kind === "output" || projection.kind === "component";

/** Whether a line has a result to show. */
export const hasResult = (projection: ResourceProjection) =>
  (projection.status === "ready" || projection.status === "stale") && !!projection.output;

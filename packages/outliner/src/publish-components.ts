// What a handler line draws on a published page (an extension's output or component, src/extension-calls.ts), and
// the look of the shared primitives' HTML (`ext-*` classes, src/component-primitives.ts). A component's HTML is the
// service's (`extensions.render`, its own HTML kept to the page's markup); it rides through the Markdown renderer as a
// private-use sentinel on a line of its own and is put in its place after (drawComponents), as marginalia's marks do.
// A line with nothing to draw yet shows its source as code: never dropped.
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
`;

export const componentSentinel = (index: number) => `${MARK}${String.fromCharCode(BASE + index)}${MARK}`;

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

/** A handler line's projection that a page draws: an output or a component, not a data record (a block of its own). */
export const drawnLine = (projection: ResourceProjection) => projection.kind === "output" || projection.kind === "component";

/** Whether a line has a result to show. */
export const hasResult = (projection: ResourceProjection) =>
  (projection.status === "ready" || projection.status === "stale") && !!projection.output;

// A checklist step's box on a page (PIE-811): drawn as its state (☐, ✔, ✓ approved, ✗ rejected, ~ waiting, ! problem)
// rather than Markdown's disabled checkbox, which knows only `[ ]` and `[x]`. On the owner's tailnet page it's a button:
// a tap opens the step's choices (Approve, Reject, Mark done, Mark to do, waiting, problem), and the choice lands as one
// `checklist.update` through the page's write route, checked against the step as the page drew it. A share link's and a
// public page's boxes are the same glyphs, read-only.
//
// It rides through the Markdown renderer as a private-use sentinel the length of the box it replaces (three characters),
// so offsets other parts place by (decorations, components) still land; `drawSteps` puts the control in its place.
import { checklistItems } from "./checklist-items";
import { statusWord, stepClosed, type ChecklistStatus } from "@ep0ch/outline-core/checklist-marks";

const MARK = "", BASE = 0xE400;
const SENTINEL = /([-])([-])/g;
/** At most this many steps on one page: two private-use characters each. */
export const MAX_PUBLISHED_STEPS = 256 * 256;

/**
 * A step as a page drew it: the note it's in, the revision read, and how `checklist.update` addresses it. `live` (PIE-864):
 * a live `::graph-check` row, `block` its own note and `note` the one the figure is in; a choice writes the property its
 * figure's `done:` names (outline-core's liveMark, read again from the figure when the choice comes) to the row's note.
 */
export interface PublishedStep {
  block: string; revision: number; start: number; itemId?: string; evidence: string; status: ChecklistStatus;
  live?: { note: string; figure: number };
}

/** Step `index`'s sentinel, three characters: what a box is replaced by until drawSteps draws it. */
const stepSentinel = (index: number) => `${MARK}${String.fromCharCode(BASE + (index >> 8))}${String.fromCharCode(BASE + (index & 0xFF))}`;

/**
 * A figure's row as a step on the page (PIE-864: a `::graph-check` row, written or live): numbered after the page's
 * others, its sentinel to draw in its box's place; null past the page's limit.
 */
export function placeFigureStep(steps: PublishedStep[], step: PublishedStep): string | null {
  if (steps.length >= MAX_PUBLISHED_STEPS) return null;
  steps.push(step);
  return stepSentinel(steps.length - 1);
}

/** How each state is drawn on a page, and said. */
export const STEP_GLYPHS: Readonly<Record<ChecklistStatus, string>> = {
  todo: "☐", done: "✔", waiting: "~", problem: "!", approved: "✓", rejected: "✗",
};

/**
 * `text` (a block's own text, as stored) with each step's box replaced by its sentinel; `steps` collects each step,
 * numbered page-wide. Only the block's own steps: a step an embed brings stays Markdown.
 */
export function placeStepSentinels(text: string, block: { id: string; revision: number }, steps: PublishedStep[]): string {
  // A note that holds the sentinel's own character already (pasted from somewhere) keeps its boxes as Markdown.
  if (text.includes(MARK)) return text;
  const items = checklistItems(text);
  if (!items.length) return text;
  let out = text;
  const placed: { at: number; index: number }[] = [];
  for (const item of items) {
    if (steps.length >= MAX_PUBLISHED_STEPS) break;
    placed.push({ at: item.markerStart, index: steps.length });
    steps.push({ block: block.id, revision: block.revision, start: item.span.start, ...(item.itemId && item.identity === "unique" ? { itemId: item.itemId } : {}), evidence: item.evidence, status: item.status });
  }
  for (const { at, index } of placed.reverse()) {
    out = `${out.slice(0, at)}${stepSentinel(index)}${out.slice(at + 3)}`;
  }
  return out;
}

const attr = (text: string) => text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The page's HTML with each step's sentinel as its box: a button on a page that may write (`writable`), else a glyph. */
export function drawSteps(html: string, steps: readonly PublishedStep[], writable: boolean): string {
  if (!steps.length) return html;
  // Each step once, and only in text (never inside a tag's attribute): anything else is left as it was.
  const drawn = new Set<number>();
  return html.replace(SENTINEL, (whole: string, high: string, low: string, at: number) => {
    const index = ((high.charCodeAt(0) - BASE) << 8) + low.charCodeAt(0) - BASE;
    const step = steps[index];
    if (!step || drawn.has(index) || html.lastIndexOf("<", at) > html.lastIndexOf(">", at)) return whole;
    drawn.add(index);
    const said = `${statusWord(step.status)}${stepClosed(step.status) ? "" : " (open)"}`;
    const glyph = STEP_GLYPHS[step.status];
    // The glyph is drawn by the style (`data-glyph`), so it's never part of words selected across the step.
    if (!writable) return `<span class="step s-${step.status}" role="img" aria-label="${attr(said)}" data-glyph="${glyph}"></span>`;
    return `<button type="button" class="step s-${step.status}" aria-haspopup="menu" aria-label="${attr(`${said}: change`)}"`
      + ` data-step-block="${attr(step.block)}" data-step-revision="${step.revision}" data-step-start="${step.start}"`
      + `${step.itemId ? ` data-step-id="${attr(step.itemId)}"` : ""} data-step-evidence="${attr(step.evidence)}" data-step-status="${step.status}" data-glyph="${glyph}"`
      + `${step.live ? ` data-step-note="${attr(step.live.note)}" data-step-figure="${step.live.figure}"` : ""}></button>`;
  });
}

/** How a page draws a box: one square cell whatever it holds, its state in a muted colour (dark, nothing bright). */
export const STEP_STYLE = `
.step{display:inline-block;width:1.15em;height:1.15em;line-height:1.1em;margin:0 .4em 0 0;padding:0;vertical-align:-.12em;text-align:center;font:inherit;font-size:.95em;color:var(--dim);background:none;border:1px solid var(--rule);border-radius:.2em}
.step::before{content:attr(data-glyph)}
button.step{cursor:pointer;position:relative;touch-action:manipulation;-webkit-tap-highlight-color:transparent;-webkit-touch-callout:none;user-select:none}
button.step::after{content:"";position:absolute;left:50%;top:50%;width:44px;height:44px;transform:translate(-50%,-50%)}
button.step:focus-visible{outline:1px solid var(--link);outline-offset:1px}
.step.s-done{color:var(--link);border-color:var(--link)}
.step.s-approved{color:#8fc98f;border-color:#5f8f5f}
.step.s-rejected{color:#d08a7a;border-color:#8f5f55}
.step.s-waiting{color:#d6c27a}
.step.s-problem{color:#d08a7a}
li:has(> .step:first-child),li:has(> p:first-child > .step:first-child){list-style:none}
@media (pointer:coarse){li:has(> .step:first-child),li:has(> p:first-child > .step:first-child){padding:max(0px,calc((44px - 1.6em) / 2)) 0}}
`;

/** The choices' menu, on a tailnet page only (the reader script opens it): above the page, a thumb's targets. */
export const STEP_MENU_STYLE = `
.step-menu{position:absolute;z-index:30;display:flex;flex-direction:column;gap:.25rem;min-width:11rem;padding:.35rem;background:#1b1a18;border:1px solid var(--rule);border-radius:.4rem}
.step-menu button{text-align:left;white-space:pre}
.step-menu button:focus-visible{outline:1px solid var(--link)}
.step-menu button[aria-current=true]{color:var(--dim)}
`;

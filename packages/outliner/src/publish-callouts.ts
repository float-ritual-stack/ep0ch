import type { TokenizerAndRendererExtension } from "marked";
import {
  BUILTIN_CALLOUT_REGISTRY,
  calloutBlocks,
  calloutRegistry,
  stripQuotes,
  type CalloutHeader,
  type CalloutRegistry,
  type CalloutTone,
  type CalloutType,
} from "@ep0ch/outline-core/callouts";

/**
 * A published page's callouts (PIE-783): `> [!type]± Title` drawn as a box with the type's icon and title, by
 * outline-core's grammar (the header, the quote depth) and the outline's own types (`callouts.types`). The Markdown
 * view keeps the source as written; only the HTML draws. Nested callouts nest (the body is rendered again), and a
 * `-` callout is a native `<details>`, closed (`+` open), so folding needs no script.
 */

/** The outline's callout types as the service answers them, as a registry; the built-ins when it can't answer. */
export function publishedCalloutRegistry(types: readonly CalloutType[] | undefined): CalloutRegistry {
  return types ? calloutRegistry(types) : BUILTIN_CALLOUT_REGISTRY;
}

const esc = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Which tone a class names: styled in PAGE_STYLE's `.callout-<tone>`. */
const toneClass = (tone: CalloutTone) => `callout-${tone}`;

/** A callout found in the source: its header as written, its body (the lines inside, one quote level off), and its source. */
interface CalloutToken { type: "callout"; raw: string; header: CalloutHeader; body: string }

/**
 * Marked's block extension for callouts. Where a callout starts and ends is outline-core's (`calloutBlocks`: it runs
 * over the lines quoted at least as deep as its header, and a callout inside it is quoted deeper), not CommonMark's
 * quote, which would fold a later `> [!type]` line into a nested quote's paragraph. Any other quote is marked's own.
 */
export function calloutExtension(registry: () => CalloutRegistry, body: (markdown: string) => string): TokenizerAndRendererExtension {
  return {
    name: "callout",
    level: "block",
    start: (src) => { const m = /(^|\n) {0,3}>/.exec(src); return m ? m.index + m[1]!.length : undefined; },
    tokenizer(src): CalloutToken | undefined {
      if (!/^ {0,3}>/.test(src)) return undefined;
      // The run of quoted lines the callout can be in, and no further.
      const all = src.split("\n");
      let run = 0;
      while (run < all.length && /^ {0,3}>/.test(all[run]!)) run++;
      const lines = all.slice(0, run);
      const first = calloutBlocks(lines).find(block => block.line === 0 && block.depth === 1);
      if (!first) return undefined;
      const { fold, title, type } = first;
      const end = first.end;
      return {
        type: "callout",
        raw: all.slice(0, end).join("\n") + (end < all.length ? "\n" : ""),
        header: { type, fold, title },
        body: lines.slice(1, end).map(line => stripQuotes(line, 1)).join("\n"),
      };
    },
    renderer(token) {
      const { header, body: source } = token as unknown as CalloutToken;
      const type = registry().style(header.type);
      const title = header.title || type.title;
      const inner = body(source);
      const open = `class="callout ${toneClass(type.tone)}" data-callout="${esc(type.name)}"`;
      const heading = `<span class="callout-icon" aria-hidden="true">${esc(type.icon)}</span><span class="callout-title">${esc(title)}</span>`;
      const content = `<div class="callout-body">${inner}</div>`;
      return header.fold
        ? `<details ${open}${header.fold === "+" ? " open" : ""}><summary>${heading}</summary>${content}</details>\n`
        : `<div ${open}><div class="callout-head">${heading}</div>${content}</div>\n`;
    },
  };
}

/** Dark tints only: a thin coloured edge and a barely lifted surface, never a bright fill. */
export const CALLOUT_STYLE = `
.callout{margin:1rem 0;padding:.6rem .85rem;border:1px solid var(--rule);border-left:3px solid var(--tone,var(--dim));border-radius:.3rem;background:color-mix(in srgb,var(--tone,var(--dim)) 9%,var(--bg))}
.callout-head,.callout>summary{font:600 14px/1.5 ui-sans-serif,system-ui,sans-serif;color:var(--tone,var(--fg));display:flex;gap:.5rem;align-items:baseline;min-height:1.5rem}
.callout>summary{cursor:pointer;list-style:none}
.callout>summary::-webkit-details-marker{display:none}
.callout>summary::after{content:"+";margin-left:auto;color:var(--dim)}
.callout[open]>summary::after{content:"\\2212"}
.callout-icon{flex:none}
.callout-body{margin-top:.3rem}
.callout-body>:first-child{margin-top:0}
.callout-body>:last-child{margin-bottom:0}
.callout-blue{--tone:#7da6d9}.callout-green{--tone:#7cc09a}.callout-violet{--tone:#a893d6}
.callout-amber{--tone:#cfa95e}.callout-coral{--tone:#d98a7d}.callout-neutral{--tone:#9a988f}
`;

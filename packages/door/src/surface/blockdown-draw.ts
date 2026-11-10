// The light half of Blockdown drawn in context (blockdown-context.ts): the contexts, drawIn, drawPage and the link sink,
// with nothing behind them but doc.ts and the link tags. A screen or the library that draws its own Blockdown (home.ts,
// library/draw.ts) imports this, never blockdown-context.ts, whose reader hooks reach the desk and the dispatcher: that
// import, loaded early, made an import cycle start a module before it was ready (the door's showcase seed failed to load).
import { childEnv, renderDoc, type Doc, type DocEnv } from "../doc";
import type { LinkTarget } from "../refs";
import { LINK_END, linkTag } from "../style";

/**
 * Where Blockdown is drawn:
 * - `note`: a note's own body, with everything the reader gives it (folds, steps, links, embeds, regions).
 * - `embed`: an embedded note's body (`!((…))`) or one of its parts, nested, without the host's folds, regions or
 *   header picture; its own links and steps.
 * - `template`: a template's body under a `::use`, nested, its fold keys its call's own; nothing after its lines.
 * - `extension-text`: an extension's Markdown (an output, a decoration, an embedded note's region): inert, flush with
 *   the note's text, no links to follow, no properties, no pictures, no folds.
 * - `view`: a view's Blockdown (a section a component lays out): drawn as the body is, its links links here, but
 *   nothing of the note's own (folds, steps, embeds, decorations, regions).
 * - `snippet`, `preview`: text written about the note (a comment, a reply, an edit's preview), drawn as given.
 * - `page`: Blockdown a screen or the library writes itself, with no note behind it (the home screen, a component's
 *   example): drawn as given, its links recorded where the caller gives a sink (drawPage).
 */
export type BlockdownContext = "note" | "embed" | "template" | "extension-text" | "view" | "snippet" | "preview" | "page";

/** What each context drops from the environment it is drawn in, and what it sets. */
const CONTEXTS: Record<BlockdownContext, (env: DocEnv, width: number, end: number) => DocEnv> = {
  note: env => env,
  snippet: env => env,
  preview: env => env,
  page: env => env,
  embed: (env, width, end) => ({ ...childEnv(env, { off: 0, end, width }), heroLine: -1, graphics: false, noImages: undefined, keepTags: true, folds: undefined, regions: undefined, outputs: undefined }),
  template: (env, width, end) => ({ ...childEnv(env, { off: 0, end, width }), heroLine: -1, graphics: false, noImages: undefined, keepTags: true, after: undefined, regions: undefined, outputs: undefined }),
  "extension-text": (env, width) => ({
    ...env, width, graphics: false, keepTags: false,
    noImages: undefined, folds: undefined, after: undefined, embed: undefined, task: undefined, link: undefined, literal: undefined, regions: undefined, outputs: undefined,
  }),
  view: (env, width) => ({
    ...env, width, nested: true, keepTags: true, graphics: false,
    noImages: undefined, folds: undefined, after: undefined, embed: undefined, task: undefined, link: undefined, literal: undefined, decorate: undefined, callout: undefined, regions: undefined, outputs: undefined,
  }),
};

/** Where in the outer drawing: its `width`, and (a nested body) how many lines it has, past which the host's hooks don't reach. */
export interface DrawnAt { width?: number; end?: number }

/** The environment Blockdown is drawn with in `context`, from the one it's drawn inside, plus the caller's own hooks. */
export function envIn(context: BlockdownContext, env: DocEnv, own: Partial<DocEnv> = {}, at: DrawnAt = {}): DocEnv {
  return { ...CONTEXTS[context](env, at.width ?? env.width, at.end ?? Number.MAX_SAFE_INTEGER), ...own };
}

/** `body` drawn in `context`: renderDoc with that context's environment (envIn). */
export function drawIn(context: BlockdownContext, body: string, env: DocEnv, own: Partial<DocEnv> = {}, at: DrawnAt = {}): Doc {
  return renderDoc(body, envIn(context, env, own, at));
}

/**
 * `body` a screen or the library writes itself, drawn in the `page` context (the home screen, a library example): the
 * plain environment with `own` on top, and, when `drawn` is given, every link drawn recorded in it (linkSink).
 */
export function drawPage(body: string, width: number, own: Partial<DocEnv> = {}, drawn?: LinkTarget[]): Doc {
  const env: DocEnv = { width, cellW: 9, cellH: 18, graphics: false, maxImageRows: 0, unfold: true };
  return drawIn("page", body, env, { ...own, ...(drawn ? linkSink(drawn) : {}) });
}

/** Text drawn as a link to `to`, recorded in `drawn` (its index is the tag a click or `[ ]` reads back). */
export const tagInto = (drawn: LinkTarget[], to: LinkTarget, text: string) => linkTag(drawn.push(to) - 1) + text + LINK_END;

/**
 * The link sink, once: a figure's row (`link`: a block, a query, a revision, a grid's cell) and any other target
 * (`tag`) drawn into `drawn`, for every context that draws links (the note, an embed, a template body).
 */
export function linkSink(drawn: LinkTarget[]): Required<Pick<DocEnv, "link" | "tag">> {
  return {
    link: (block, text, figure, query, at, cell) => tagInto(drawn, { ...(query ? { query, label: query } : { block, ...(at !== undefined ? { revision: at } : {}) }), role: "row", ...(figure ? { figure: { figure } } : {}), ...(cell ? { cell: true } : {}) }, text),
    tag: (to, text) => tagInto(drawn, to, text),
  };
}

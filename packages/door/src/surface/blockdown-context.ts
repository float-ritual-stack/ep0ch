// Blockdown drawn in context (PIE-1543, the Nov 3 deepening review's card 3). The reader draws Blockdown in several
// places: the note's own body, an embedded note, a template's body under a `::use`, an extension's inert text, a view's
// section, a snippet (a comment, a reply) and a draft's preview. Each keeps some of the note's drawing environment
// (DocEnv) and drops the rest; this module names them, so a caller says which context it draws in rather than
// building the 45-key environment by hand and clearing its own subset. The link sink (every link drawn is recorded
// in `drawn`, so a click or `[ ]` finds what it points at) is written once here too. The grammar stays outline-core's;
// renderDoc stays doc.ts's.
import type { Ctx } from "../app";
import { isOutlineNote } from "../authored";
import { titleLine, type Msg } from "../board";
import { outlineBoards } from "../desk/outline-boards";
import { childEnv, foldPoints, renderDoc, type Doc, type DocEnv } from "../doc";
import { expandsEmbeds } from "../embed-policy";
import { embedRegion, type EmbedBody } from "../embeds";
import { mentionsExtension as mentionsExtensionLine, mentionsStamp } from "../extensions";
import type { LinkBlocksEnv } from "../links";
import type { LiveSite } from "../live";
import type { RegionBook } from "../output-region";
import { extensionRegion, projectionsOf, regionsByLine } from "../projection";
import { metadataLines, printable, tokensOf, type Source } from "../props";
import { LINK_OFF, LINK_ON, presentLinks, type LinkTarget, type SiteCall } from "../refs";
import { errorDetails } from "../status-log";
import { liveRowStep, STEP_BOXES, stepsOf, stepStillOn } from "../steps";
import { C, fg, LINK_END, linkTag, RESET } from "../style";
import { useRegion, type UseSite } from "../template-use";
import { blockTags } from "@ep0ch/outline-core/block-tags";
import type { ButtonCall } from "@ep0ch/outline-core/button-call";
import { boxStatus } from "@ep0ch/outline-core/checklist-marks";
import { codeFenceLines } from "@ep0ch/outline-core/code-fence";
import { literalLines } from "@ep0ch/outline-core/code-ranges";
import { headerLine } from "@ep0ch/outline-core/header-line";
import { embedOccurrences, fragmentAnchorMatch } from "@ep0ch/outline-core/link-syntax";
import { buttonRows, pressState } from "./button";

type Link = LinkTarget;

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
 */
export type BlockdownContext = "note" | "embed" | "template" | "extension-text" | "view" | "snippet" | "preview";

/** What each context drops from the environment it is drawn in, and what it sets. */
const CONTEXTS: Record<BlockdownContext, (env: DocEnv, width: number, end: number) => DocEnv> = {
  note: env => env,
  snippet: env => env,
  preview: env => env,
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

/**
 * A sequence's first step when it is an action (its refusal now is exact: nothing has run before it), else null: a script
 * first, or a slot still to fill, can change what the later steps find.
 */
export function sequenceStart(call: ButtonCall): string | null {
  const first = call.steps[0];
  return call.sequence && first?.kind === "act" && !first.source.includes("{") ? first.source : null;
}

/** A note that is only embeds (a figure or a part shown on its own), properties aside: nothing of its own to head. */
export function embedOnly(m: Pick<Msg, "text">): boolean {
  const embeds = embedOccurrences(m.text);
  if (!embeds.length) return false;
  let rest = "", at = 0;
  for (const e of embeds) { rest += m.text.slice(at, e.start); at = e.end; }
  rest += m.text.slice(at);
  const h = headerLine(rest);
  return h.line < 0 || (!h.prose.trim() && rest.split("\n").slice(h.line + 1).every(l => !l.trim()));
}

/**
 * The readable body before its links are presented, line for line: `lines[i]` is the note line (from 0,
 * the subject) body line i comes from, `anchors[i]` the fragment anchor read mode hid from it. Matched
 * literal-region markers (PIE-422) are hidden, as Detail hides them; `literal` holds the body lines inside
 * a region, where `[key::value]` is text, and `unterminated` the note line of an opener without a closer.
 */
export function readableSource(m: Msg, src: Source | null): ReadableSource {
  // A function of the text and the tokens the service gave it, asked several times a frame by a reader and by what it draws
  // (the folds, the cursor, the hint): answered once while none of what it reads changes: the text, the tokens, the extensions listed.
  const tokens = tokensOf(m.text, src), given = tokens?.state === "ready" ? tokens.tokens : tokens?.state ?? null, mentions = mentionsStamp();
  const kept = READABLE.get(m.text);
  if (kept && kept.given === given && kept.mentions === mentions) return kept.read;
  const read = readableSourceOf(m, tokens);
  if (READABLE.size >= 200) READABLE.clear();
  READABLE.set(m.text, { given, mentions, read });
  return read;
}
type ReadableSource = { text: string; lines: number[]; anchors: (string | undefined)[]; literal: Set<number>; unterminated: number | null };
const READABLE = new Map<string, { given: unknown; mentions: RegExp | null; read: ReadableSource }>();
function readableSourceOf(m: Msg, tokens: ReturnType<typeof tokensOf>): ReadableSource {
  const hidden = metadataLines(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  const lit = literalLines(m.text);
  // The title may come from a later line (a marker or a props-only line first): what's above it isn't body.
  const title = Math.max(0, titleLine(m.text).line);
  const all = m.text.split("\n"), code = codeFenceLines(all);
  // A note that is only embeds (PIE-1248) has its first embed on the title line: it is the body, drawn as its words
  // without the chips (its header starts as none, so nothing else would show it).
  const head = embedOnly(m) ? headerLine(m.text) : null, embedTitle = head?.line === title ? head : null;
  const rows = all.map((l, i) => ({ l: embedTitle && i === title ? embedTitle.prose : l, i })).filter(({ i }) => (i > title || (!!embedTitle && i === title)) && (!hidden.has(i) || mentionsExtensionLine(all[i]!)) && !lit.markers.has(i))
    // A stable fragment anchor (`## Beds ^beds`) is an address, not prose: read mode hides it, as Detail does.
    .map(({ l, i }) => {
      const a = code[i]! >= 0 ? null : fragmentAnchorMatch(l);
      return a ? { l: l.slice(0, a.index).trimEnd(), i, anchor: a[1] } : { l, i };
    });
  // Blank lines before the first line with text aren't drawn.
  let lead = 0;
  while (lead < rows.length - 1 && rows[lead]!.l === "") lead++;
  const kept: { l: string; i: number; anchor?: string }[] = rows.slice(lead);
  // The block-level tags (PIE-880, outline-core's blockTags) are the first row of the body, so hiding the properties
  // doesn't hide them: one row under the byline, each a tag link, then a blank row. The row stands for its metadata line.
  const row = blockTags(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  if (row.tags.length) kept.unshift({ l: row.tags.map(t => `#${t}`).join(" "), i: row.line }, ...(kept.length ? [{ l: "", i: row.line }] : []));
  const literal = new Set<number>();
  kept.forEach((r, k) => { if (lit.inside.has(r.i)) literal.add(k); });
  return { text: kept.map(r => r.l).join("\n"), lines: kept.map(r => r.i), anchors: kept.map(r => ("anchor" in r ? r.anchor : undefined)), literal, unterminated: lit.unterminated };
}

/** What the Blockdown hooks read of the reader drawing them (its other outlines, presses, folds, lists): a preview has none. */
export interface HookReader {
  readonly context?: Ctx;
  refusedPress(act: string): string | null;
  readonly folded: Set<string>;
  readonly foldSel: string | null;
  readonly listEnv?: LinkBlocksEnv;
}
/** A preview's (a draft's ctrl+p, a bar row, a library entry): no reader behind it. */
export const NO_READER: HookReader = { refusedPress: () => null, folded: new Set(), foldSel: null };

/**
 * The hooks that draw a note's Blockdown in context (PIE-1543): embeds (an embedded note's body, nested), template
 * bodies under a `::use`, buttons, steps, live steps and components' words, each recording its links in `drawn`.
 * `reader`: what they read of the reader drawing them (NO_READER for a preview, which needs no surface).
 */
export function blockdownHooks(reader: HookReader, m: Msg | null, noteLines: readonly number[], env: DocEnv, src: Source | null, drawn: Link[]): Pick<DocEnv, "embed" | "task" | "present" | "liveStep" | "use"> & { preview?: (id: string, width: number, bodyOnly?: boolean) => string[]; spanPreview: (startLine: number, endLine: number, width: number) => string[] } {
  // How many embedded bodies and template bodies are being drawn inside one another: an embed starts a fresh `::use`
  // depth and a template body a fresh embed one, so a note that embeds a template that embeds it back is stopped here.
  let nest = 0;
  const tooDeep = (): string[] => [`${fg(C.dark)}drawn inside itself too many times${RESET}`];
  const nested = <T>(draw: () => T, stop: () => T): T => {
    if (nest >= 8) return stop();
    nest++;
    try { return draw(); } finally { nest--; }
  };
  const inner: EmbedBody = (target, part, width, hooks) => nested(() => {
    let source = src;
    if (target.address && reader.context) {
      const pool = outlineBoards(reader.context);
      const ctx = pool.peek(target.address);
      if (!ctx) { void pool.on(target.address).then(() => src?.redraw(), (error: Error) => reader.context?.flash(error.message, undefined, errorDetails(error))); return ["reading the other outline..."]; }
      source = { board: ctx.board, redraw: () => src?.redraw() };
    }
    const firstLink = drawn.length;
    let text: string, lines: number[], lit: Set<number>;
    if (part) {
      text = part.text;
      lines = text.split("\n").map((_, i) => part.startLine + i);
      const inside = target.text.includes("<!--") ? literalLines(target.text).inside : new Set<number>();
      lit = new Set(lines.flatMap((l, i) => (inside.has(l) ? [i] : [])));
    } else ({ text, lines, literal: lit } = readableSource(target, source));
    const projections = isOutlineNote(target) ? projectionsOf(target, source) : [];
    const projected = regionsByLine(projections, lines, { slice: !!part });
    const inert = (text: string, width: number) => drawIn("extension-text", text, env, {}, { width }).lines;
    const rendered = drawIn("embed", presentLinks(text, expandsEmbeds(!!hooks.embed, target), source, target.text, drawn, undefined, isOutlineNote(target) ? { block: target.id } : undefined), env, {
      literal: lit, ...linkSink(drawn),
      // A fragment's figure isn't its note's figure block: the note's child bullets are the whole note's rows.
      nested: !!part,
      decorate: (line, width) => {
        const ps = projected.get(line)?.filter(({ p }) => p.output?.component?.placement === "replace");
        return ps?.length ? { end: line + 1, rows: ps.flatMap(({ p }) => extensionRegion(p, width, Date.now(), (to, text) => tagInto(drawn, to, text), { note: target.id, markdown: inert }).rows) } : null;
      },
      after: (line, width) => {
        const ps = projected.get(line)?.filter(({ p }) => p.output?.component?.placement !== "replace");
        return ps ? { rows: ps.flatMap(({ p }) => extensionRegion(p, width, Date.now(), (to, text) => tagInto(drawn, to, text), { note: target.id, markdown: inert, row: (block, text) => tagInto(drawn, { block, role: "row" }, text) }).rows) } : [];
      },
      // The template is the definition (`self`); the chain says the host is `this`, so a figure over `{{this.project}}` reads the host.
      note: target.id,
      embed: hooks.embed, task: (i, box) => hooks.task(lines[i] ?? -1, box),
      // A `::use` in an embedded note hosts that note: a fresh Site, as an embed starts one.
      use: isOutlineNote(target) ? useHook(target.id, lines, undefined, 0) : undefined,
      present: presenter(target.text), liveStep,
    }, { width, end: lines.length }).lines;
    if (target.address) for (const link of drawn.slice(firstLink)) {
      if (!link.outline && (link.block || link.page)) Object.assign(link, target.address);
    }
    return rendered;
  }, tooDeep);
  // A call keeps its own fold keys; figures share this reader's controls and read the call's Site.
  const templateBody = (depth: number, scope: string) => (target: Msg, site: LiveSite, width: number): Doc | string[] => nested<Doc | string[]>(() => {
    const { text, lines, literal, anchors } = readableSource(target, src);
    const points = foldPoints(text, anchors).map(p => ({ ...p, key: `${scope}/${p.key}`, ...(p.list ? { list: { ...p.list, key: `${scope}/${p.list.key}` } } : {}) }));
    const call: SiteCall = { ...(site.chain?.length ? { chain: site.chain } : {}), ...(site.props ? { props: site.props } : {}) };
    return drawIn("template", presentLinks(text, true, src, target.text, drawn, undefined, { block: target.id, call }), env, {
      literal, folds: { points, folded: reader.folded, selected: reader.foldSel }, ...linkSink(drawn),
      componentLine: line => lines[line]!,
      figures: env.figures && { ...env.figures, fullWidth: width, seen: f => env.figures!.seen?.({ ...f, ...(f.note === target.id ? { revision: target.revision, line: f.line === undefined ? undefined : lines[f.line] } : {}) }) },
      note: target.id,
      embed: embedHook, task: () => null, present: presenter(target.text), liveStep, site,
      use: useHook(target.id, lines, { ...(site.chain?.length ? { chain: site.chain } : {}), ...(site.props ? { props: site.props } : {}) }, depth + 1, undefined, scope),
    }, { width, end: lines.length });
  }, tooDeep);
  // The `::use` on body line `i`, drawn: `block` is the note whose text holds the line, `lines` its body lines' note lines.
  const useHook = (block: string, lines: readonly number[], site: UseSite | undefined, depth: number, book?: RegionBook, scope = ""): DocEnv["use"] => (call, i, width) => {
    const line = lines[i] ?? -1;
    if (line < 0) return [];
    return useRegion({ call, line, host: block, ...(site ? { site } : {}), top: m?.id ?? "", width, src, sink: drawn, depth, body: templateBody(depth, `${scope}/${block}:${line}`), ...(book ? { book } : {}) });
  };
  // A `::button` on body line `i` (PIE-957): the button part, a press of its action line on this note, in its press's state or
  // disabled with the action's refusal now (PIE-1287).
  const buttonHook = (block: string, lines: readonly number[]): DocEnv["button"] => (call, i) => {
    const line = lines[i] ?? -1, label = printable(call.label);
    if (call.act === null || line < 0) return [fg(C.yellow) + `[${label}] ${call.problem ?? ""}` + RESET];
    const pressed = pressState(block, line, call.label), start = call.sequence ? sequenceStart(call) : call.act, refused = pressed.state || call.empty.length || !start ? null : reader.refusedPress(start);
    return buttonRows(label, { ...call.look, ...pressed, ...(refused ? { state: "disabled", why: refused } : {}) },
      t => tagInto(drawn, { role: "control", label, press: { act: call.act!, steps: call.steps, ...(call.alt ? { alt: call.alt } : {}), block, line, label: call.label } }, t));
  };
  const embedHook = (id: string, fragment: string | undefined, n: number, width: number) => embedRegion(id, fragment, n, width, src, inner, drawn, m?.id ?? "", env.inlineList, undefined, reader.listEnv);
  // A component's words as a line of the note (PIE-864): its links elements, unless its row is itself a link.
  const presenter = (noteText: string) => (t: string, linked: boolean) => presentLinks(t, false, src, noteText, linked ? undefined : drawn);
  // A live ::graph-check row's box: a step of its own note, whose mark writes the property its `done:` names.
  const liveStep: DocEnv["liveStep"] = (row, box) => LINK_ON + tagInto(drawn, { role: "task", block: row.block, task: { block: row.block, revision: 0, step: liveRowStep(row), live: row.mark } }, box) + LINK_OFF;
  // A Resource or a file shown as a note has no steps, and its `!((…))` isn't the outline's to transclude.
  const outline = expandsEmbeds(!!src, m ?? undefined);
  const steps = m && isOutlineNote(m) ? stepsOf(m, src) : null;
  const stepAt = new Map((steps?.items ?? []).map(st => [st.span.startLine, st]));
  const task: NonNullable<DocEnv["task"]> = (i, box) => {
    if (!m) return null;
    const line = noteLines[i] ?? -1, st = stepAt.get(line);
    if (st && steps && steps.revision !== m.revision && !stepStillOn(st, m.text, line)) return null;
    const shown = boxStatus(box) === st?.status ? STEP_BOXES[st.status] : box;
    return st && steps ? LINK_ON + tagInto(drawn, { role: "task", block: m.id, task: { block: m.id, revision: steps.revision, step: st } }, shown) + LINK_OFF : null;
  };
  return {
    spanPreview: (startLine, endLine, width) => m ? embedRegion(m.id, undefined, 0, width, src, inner, drawn, m.id, env.inlineList, { note: m, startLine, endLine, task: (line, box) => task(noteLines.indexOf(line), box) }, reader.listEnv) : [],
    present: presenter(m?.text ?? ""), ...(outline ? { liveStep } : {}),
    ...(outline ? { embed: embedHook } : {}),
    ...(m && outline ? { use: useHook(m.id, noteLines, undefined, 0, env.regions), button: buttonHook(m.id, noteLines) } : {}),
    // An inline ::links component's preview of its selected row (PIE-693): that note drawn as an embed of it is.
    ...(outline ? { preview: (id: string, width: number, bodyOnly = false) => embedRegion(id, undefined, 0, width, src, inner, drawn, m?.id ?? "", undefined, undefined, undefined, bodyOnly) } : {}),
    task,
  };
}


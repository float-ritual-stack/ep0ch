// The reader's link model: a note's links as the reader follows them (outline-core's scan, made into LinkTargets),
// how a link reads and is written as a ref=, and how an element's link in one draw is known for the same in the next
// (the element keys of a step, a callout and a figure's control). Pure: no surface state.
import { calloutBlocks } from "@ep0ch/outline-core/callouts";
import { linkOccurrences, referencedBlock, type LinkOccurrence } from "@ep0ch/outline-core/link-syntax";
import type { Msg } from "../board";
import type { FigureControl } from "../graphs";
import type { Source } from "../props";
import { pageOf, pageView, refKey, refView, referencesIn, type CalloutRef, type LinkTarget } from "../refs";
import type { StepRef } from "../steps";

export type Link = LinkTarget;
/** A figure's control, named across renders (its figure's key, then which). */
export const figureElemBase = (c: FigureControl) => `figure:${c.figure}|${c.tab !== undefined ? `tab:${c.tab}` : c.row !== undefined ? `row:${c.row}` : c.size ? "size" : "density"}`;
/** Two links name the same target the same way (a click finds the `[ ]` link it is). */
const softKey = (l: Link) => (l.soft ? JSON.stringify([l.soft.name, l.soft.line]) : undefined);
export const sameLink = (a: Link, b: Link) => a.tag === b.tag && softKey(a) === softKey(b) && a.resource?.key === b.resource?.key && a.block === b.block && a.fragment === b.fragment && a.label === b.label && a.page === b.page && a.media === b.media && a.url === b.url;
/** The same element's link in another draw: a press by its button's place, anything else as sameLink, of the same role. */
export const sameElementLink = (a: Link, b: Link) => a.press || b.press
  ? !!a.press && !!b.press && a.press.block === b.press.block && a.press.line === b.press.line && a.label === b.label
  : a.role === b.role && sameLink(a, b) && same(a.task, b.task, taskBase) && same(a.callout, b.callout, calloutBase)
    && same(a.figure, b.figure, figureElemBase) && a.inlineList?.key === b.inlineList?.key && a.inlineList?.row === b.inlineList?.row
    && a.listRow?.key === b.listRow?.key && a.listRow?.row === b.listRow?.row && a.listRow?.group === b.listRow?.group
    && a.proposal?.op === b.proposal?.op && a.proposal?.id === b.proposal?.id && a.unsent?.op === b.unsent?.op;
export const same = <T,>(a: T | undefined, b: T | undefined, base: (x: T) => unknown) => (a && b ? base(a) === base(b) : !a === !b);
/**
 * The note's links in reading order, as outline-core's scan finds them: `((…))` (transclusions too), `[[…]]` and
 * Markdown `[text](url)`.
 */
export const linksOf = (m: Msg): Link[] => linkOccurrences(m.text).map(linkOf);
/** One link of outline-core's scan as the reader follows it. */
export const linkOf = (l: LinkOccurrence): Link => {
  if (l.kind === "block") return { block: l.blockId, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
  if (l.kind === "page") return { page: l.displayAddress, ...(l.fragmentId ? { fragment: l.fragmentId } : {}), ...(l.label !== undefined ? { label: l.label } : {}) };
  return { url: l.url, label: l.kind === "markdown" ? l.text : l.url };
};
/**
 * A link a draft's preview draws as `edit.follow`'s `ref=` (PIE-592): `((id^fragment))`, `[[page]]`, a URL or `#tag`;
 * null for one that has no such words (a resource token, a picture).
 */
export const refOfLink = (l: Link): string | null =>
  l.block ? `((${l.block}${l.fragment ? `^${l.fragment}` : ""}))` : l.page !== undefined ? `[[${l.page}${l.fragment ? `^${l.fragment}` : ""}]]` : l.url !== undefined ? l.url : l.tag !== undefined ? `#${l.tag}` : null;
/** `edit.follow`'s `ref=` back to the link it names: what `refOfLink` writes, or one link written whole. */
export function linkOfRef(ref: string): Link | null {
  const text = ref.trim();
  if (text.startsWith("#") && text.length > 1) return { tag: text.slice(1) };
  const [l] = linkOccurrences(text, []);
  if (l && l.start === 0 && l.end === text.length) return linkOf(l);
  if (/^[a-z][a-z0-9+.-]*:\S+$/i.test(text)) return { url: text };
  const b = referencedBlock(text);
  return b ? { block: b.blockId, ...(b.fragment ? { fragment: b.fragment } : {}) } : null;
}
/** How a link reads in the hint and `peek`: its title or label, as the note shows it. */
export const linkText = (l: Link, text: string, src: Source | null) => l.block
  ? refView(l.block, l.fragment, l.label, referencesIn(text, src)?.get(refKey(l.block, l.fragment))).text
  : l.soft ? l.label ?? "" : l.page ? pageView(l.page, l.label, pageOf(l.page, src)).text : l.url !== undefined ? l.label ?? l.url : l.media?.split("/").pop() ?? "";
/**
 * A step's element key, before its `#n` (which occurrence: the same step shown twice): by its id, or,
 * without one, by its evidence (its text), never by where it sits, so a step moved by an edit elsewhere is
 * still itself and another step that moved into its place is not it.
 */
export const taskBase = (t: StepRef) => `task:${t.block}|${t.step.itemId ? `^${t.step.itemId}` : `ev:${t.step.evidence}`}`;
/**
 * A callout's element key, before its `#n`: its note, depth and title as written, never its line or its type, so
 * choosing another type keeps the `[ ]` position on it (as its fold point's key does).
 */
export const calloutBase = (c: CalloutRef) => { const b = calloutBlocks([c.header])[0]; return `callout:${c.block}|${b?.depth ?? 0}|${b?.title ?? c.header.trim()}`; };
/** A callout's title as written, else its type's. */
export const calloutTitle = (c: CalloutRef) => calloutBlocks([c.header])[0]?.title || c.type;

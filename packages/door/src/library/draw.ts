// A component's variation drawn as the reader draws it (PIE-618): its text through the readers' own body renderer
// (`renderDoc`, after `presentLinks`), with the outline's callout types and heading styles plus what the variation's
// declaring note declares (a `[heading-style::mine]` note is a style for this drawing alone, never written to the
// outline), and a rule note's decorations as the service draws them (`rules.preview`, asked once per variation and
// kept), placed by `planDecorations`. Nothing here knows a component: a schema's source is drawn by what draws it in
// any note.
import { calloutRegistry, calloutTypesFromBlocks } from "@ep0ch/outline-core/callouts";
import type { Variation } from "@ep0ch/outline-core/component-schema";
import { headingStyleRegistry, headingStylesFromBlocks } from "@ep0ch/outline-core/heading-styles";
import { propertyTokensInLine } from "@ep0ch/outline-core/property-grammar";
import { calloutsOf } from "../callouts";
import { planDecorations } from "../decorations";
import { renderDoc, type DocEnv } from "../doc";
import { headingStylesOf } from "../heading-styles";
import type { ListSource } from "../outline-lists";
import type { Decoration } from "../projection";
import { presentLinks } from "../refs";

type PreviewBoard = { rulePreview?: (note: string, text: string) => Promise<{ decorations: Decoration[] }> };
interface Kept { decorations: Decoration[] | null; answer: Promise<void> }
const previews = new WeakMap<object, Map<string, Kept>>();

/**
 * A rule note's decorations of a variation's text, as the service draws them: kept per connection once answered; null
 * while it's asked (the drawing is repainted when it lands), and none on a connection that can't be asked.
 */
function ruleDecorations(v: Variation, src: ListSource | null): { decorations: Decoration[] | null; answer?: Promise<void> } {
  const board = src?.board as (PreviewBoard & object) | undefined;
  if (!v.note || !/\[rule-name::/i.test(v.note) || !board || typeof board.rulePreview !== "function") return { decorations: [] };
  let kept = previews.get(board);
  if (!kept) previews.set(board, (kept = new Map()));
  const key = `${v.note}\0${v.use}`;
  const hit = kept.get(key);
  if (hit) return hit;
  const entry: Kept = { decorations: null, answer: Promise.resolve() };
  entry.answer = board.rulePreview(v.note, v.use).then(
    r => { entry.decorations = r.decorations; src!.redraw(); },
    () => { entry.decorations = []; },
  );
  kept.set(key, entry);
  if (kept.size > 400) kept.delete(kept.keys().next().value!);
  return entry;
}

/** Whether `v`'s drawing still waits for the service (a rule's decorations being asked for). */
export const drawingWaits = (v: Variation, src: ListSource | null) => ruleDecorations(v, src).decorations === null;

/** `v` once what it waits for is answered (a CLI writing a page): `drawVariation` then draws it whole. */
export async function variationReady(v: Variation, src: ListSource | null): Promise<void> {
  await ruleDecorations(v, src).answer;
}

/**
 * Variation `v` drawn `width` columns wide, in colour, as a reader on `src`'s outline draws its text: the outline's own
 * styles and types, and those its declaring note declares.
 */
export function drawVariation(v: Variation, width: number, src: ListSource | null = null): string[] {
  const declared = v.note ? [{ id: "library-declaring-note", properties: propertyTokensInLine(v.note).map(t => ({ key: t.key, value: t.value })) }] : [];
  const headings = headingStyleRegistry([...headingStylesOf(src).styles.filter(s => s.block), ...headingStylesFromBlocks(declared).styles]);
  const callouts = calloutRegistry([...calloutsOf(src).types.filter(t => t.block), ...calloutTypesFromBlocks(declared).types]);
  const env: DocEnv = { width: Math.max(10, width), cellW: 9, cellH: 18, graphics: false, maxImageRows: 8, unfold: true, callouts, headings };
  const body = v.use.split("\n");
  const decorations = ruleDecorations(v, src).decorations ?? [];
  if (decorations.length) {
    const plan = planDecorations(decorations, body.map((_, i) => i), { headings, markdown: (text, mw) => renderDoc(text, { ...env, width: mw }).lines }, body);
    env.after = (line, aw) => (plan.after.get(line) ?? []).flatMap(f => f(aw));
    env.decorate = (line, dw) => { const p = plan.place.get(line), r = p?.draw(dw); return p && r ? { end: p.end, ...r } : null; };
  }
  return renderDoc(presentLinks(v.use, false, src as never, v.use), env).lines;
}

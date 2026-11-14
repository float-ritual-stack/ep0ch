/**
 * Whether a patch may land in a live draft, and what it does there (PIE-501): the one decision, made over the draft
 * as its holder has it now (its text, the revision it stands on, where the cursor and the selection's other end are).
 *
 * Two callers, one rule. The door asks it of its own buffer (`Draft.applyPatch`). The service asks it for a holder
 * that reads no Blockdown (the native window): that holder answers a `patch` with its draft as it stands, the service
 * decides here, and sends back the spans to replace (`draft.place`). So "the block being typed in" is found by one
 * function whichever window the person types in.
 *
 * Pure: no I/O. `draft-patch-compare.ts` finds a span; this says whether it may change.
 */
import { applyLocated, blockStartAt, locateSpans, markStart, type DraftPatchSpan, type LocatedSpan } from "./draft-patch-compare";
import { parsePropertyRecords } from "./property-parse";

/** A live draft as its holder has it: offsets are UTF-16 units of `text`. */
export interface DraftStands {
  text: string;
  /** The saved revision the draft stands on. */
  base: number;
  cursor: number;
  /** The selection's other end; the cursor when nothing is selected. */
  anchor: number;
  /** A save is under way. */
  busy?: boolean;
}

/** What of a holder's `patch` ask the decision reads. */
export interface DraftPatchAsked {
  revision: number;
  patches: readonly DraftPatchSpan[];
  replyTo?: string;
  mark?: string;
  output?: boolean;
  force?: boolean;
}

/**
 * A span to replace, and what it does to an offset beside it (`mapCursor`). `stays`: an offset at its start stays
 * before it (an answer opens below the ask's own line). `apart`: it moves no offset (a paragraph of its own added at
 * the very end opens below the cursor).
 */
export interface PlacedSpan extends LocatedSpan { caret?: "stays" | "apart" }

export type DraftPlacement =
  /** `askEnd`: where an answer's ask line ends (-1 without `replyTo`). */
  | { ok: true; spans: PlacedSpan[]; askEnd: number }
  | { ok: false; reason: string };

/** A text's words with its property chips taken out (the shared property grammar), spacing folded. */
const wordsOf = (text: string) => { let out = "", at = 0; for (const p of parsePropertyRecords(text)) { out += text.slice(at, p.start); at = p.end; } return (out + text.slice(at)).replace(/\s+/g, " ").trim(); };
const chipsIn = (text: string) => parsePropertyRecords(text).map(p => text.slice(p.start, p.end)).join("\u0000");
/** A change of property chips alone (a stamp, PIE-1756): the chips differ, and the words around them are the same. */
const chipsOnly = (before: string, after: string) => chipsIn(before) !== chipsIn(after) && wordsOf(before) === wordsOf(after);
/** A paragraph of its own added at the very end of `text`, in place of nothing or of its trailing blank lines. */
const belowAll = (text: string, sp: LocatedSpan) => sp.end === text.length && !text.slice(sp.start).trim() && sp.replacement.startsWith("\n");
/** Where the line holding `offset` starts and ends in `text`. */
const lineStartAt = (text: string, offset: number) => text.lastIndexOf("\n", offset - 1) + 1;
const lineEndAt = (text: string, offset: number) => { const end = text.indexOf("\n", offset); return end < 0 ? text.length : end; };

/**
 * An agent's patch, if its compare holds against the draft as typed now: every span's observed text still there, at or
 * near where it was seen; the draft still on the revision the agent read; none around the cursor; and, when the patch
 * names a mark (the `@request` line), every span above it, or above the block the cursor is in when the person went
 * back up above the mark to write. Without a mark the only limit is the block being typed in (the cursor's paragraph,
 * list item or heading): an agent's ordinary edit of a note the person has open lands anywhere else, above or below.
 * `force`: "apply anyway", the person's own choice, placed by its passage wherever it is now, with no revision or
 * cursor check, but still above the mark when the draft has it (PIE-510). `own`: the person's own write into the draft
 * they're typing in (a part they dropped there, PIE-1357) is theirs to place: no cursor or typing guard, as their own
 * keys have none.
 */
export function placeDraftPatch(draft: DraftStands, p: DraftPatchAsked, own: boolean): DraftPlacement {
  const no = (reason: string): DraftPlacement => ({ ok: false, reason });
  if (draft.busy) return no("the draft is being saved");
  if (!p.force && p.revision !== draft.base) return no(`the draft is on revision ${draft.base}, not the ${p.revision} it was read at`);
  const text = draft.text;
  const located = locateSpans(text, p.patches, !!p.force);
  if (!located.ok) return no(located.reason);
  let spans: PlacedSpan[] = located.spans;
  // An answer leaves its ask line word for word (the service checks): what it changes is below that line, so the ask's
  // own text is out of the patch: the cursor may be on it (PIE-1585), and the undo unit is the answer alone.
  const askEnd = p.replyTo ? spans[0]!.start + p.replyTo.length : -1;
  // The whole line, as it was read: typed on since (`?` after it), it is a new ask, and the next quiet asks it.
  if (p.replyTo && ((askEnd < text.length && text[askEnd] !== "\n") || (spans[0]!.start > 0 && text[spans[0]!.start - 1] !== "\n"))) return no("the ask was typed on since it was read");
  // A cursor at the ask's end stays there, on the line it was typing: the answer opens below it.
  if (p.replyTo) spans = [{ ...spans[0]!, start: askEnd, replacement: spans[0]!.replacement.slice(p.replyTo.length), caret: "stays" }];
  if (p.force && p.mark !== undefined) {
    // A mark line the person took out holds nothing back: the passage is placed by its own text.
    const mark = markStart(text, p.mark);
    if (mark >= 0 && spans.some(sp => sp.end > mark)) return no("it reaches the mark or below it; a patch changes only text above the mark");
  }
  if (!p.force && !p.output && !own) {
    const c = draft.cursor, a = draft.anchor;
    if (p.replyTo && spans.some(sp => sp.start < c && c <= sp.end)) return no("the cursor is in the answer");
    if (spans.some(sp => (sp.start < c && c < sp.end) || (sp.start < a && a < sp.end))) return no("the cursor is in that passage");
    // With a mark: above it; and when the person went back up above the mark to write, above the block they're in.
    if (p.mark !== undefined) {
      const mark = markStart(text, p.mark);
      if (mark < 0) return no("the mark isn't in the draft");
      const at = Math.min(c, a);
      const limit = at > mark ? mark : blockStartAt(text, at);
      if (spans.some(sp => sp.end > limit)) return no(`it reaches ${limit === mark ? "the mark" : "the block being typed in"} or below it; a patch changes only text above it`);
    } else if (!p.replyTo) {
      const typing = [...new Set([blockStartAt(text, c), blockStartAt(text, a)])];
      // A chip changed on another line of that block (a stamp under the title while the person types below it,
      // PIE-1756) leaves the words being typed alone: only the cursor's own line holds it back.
      // Judged on the whole draft, so a chip inside a code fence is the fence's text, never a property (CodeRabbit on #1458).
      const stamp = (sp: LocatedSpan) => chipsOnly(text, text.slice(0, sp.start) + sp.replacement + text.slice(sp.end)) && [c, a].every(at => sp.end < lineStartAt(text, at) || sp.start > lineEndAt(text, at));
      // A paragraph of its own added at the very end (a restore's dated line, PIE-1760) changes nothing typed: it
      // opens below the cursor, which stays where it is.
      if (spans.some(sp => !stamp(sp) && !belowAll(text, sp) && typing.some(block => blockStartAt(text, sp.start) === block || (sp.start < block && block < sp.end)))) {
        return no("it changes the block being typed in");
      }
    }
  }
  // A paragraph added at the end opens below the cursor: an offset at the end stays put (PIE-1760).
  if (!p.replyTo) spans = spans.map(sp => belowAll(text, sp) ? { ...sp, caret: "apart" as const } : sp);
  return { ok: true, spans, askEnd };
}

/**
 * Where an offset of the draft is once placed spans are replaced: the cursor, the selection's other end, the view.
 * As `mapOffset`, but a span that says `apart` moves nothing, and an offset at the start of one that says `stays`
 * stays before it.
 */
export function mapCursor(offset: number, spans: readonly PlacedSpan[]): number {
  let delta = 0;
  for (const span of spans) {
    if (span.caret === "apart") continue;
    if (offset < span.start || (offset === span.start && (span.end > span.start || span.caret === "stays"))) break;
    if (offset < span.end) return span.start + delta + span.replacement.length;
    delta += span.replacement.length - (span.end - span.start);
  }
  return offset + delta;
}

/** One span a patch changed, as the text it left has it: what it wrote at `start`, what was there, and a little either side. */
export interface PatchedSpan { start: number; text: string; was: string; before: string; after: string }

/** What a patch's spans changed, in the text they left (`after`): what taking it back is compared against. */
export function patchedSpans(before: string, after: string, spans: readonly LocatedSpan[]): PatchedSpan[] {
  let delta = 0;
  return spans.map(sp => {
    const start = sp.start + delta;
    delta += sp.replacement.length - (sp.end - sp.start);
    return { start, text: sp.replacement, was: before.slice(sp.start, sp.end), before: after.slice(Math.max(0, start - 8), start), after: after.slice(start + sp.replacement.length, start + sp.replacement.length + 8) };
  });
}

/**
 * The spans that take a patch back out of `text`, or null when what it wrote has changed since. Undo is a
 * compare-and-swap too: the patched text (and a little either side) must still be there. Typing since may have moved
 * it further than the compare looks from its range: then its one copy anywhere, with the text either side, and failing
 * that the patched text alone when it is in the draft just once.
 */
export function revertSpans(text: string, patched: readonly PatchedSpan[]): LocatedSpan[] | null {
  const spans: DraftPatchSpan[] = patched.map(sp => {
    const start = sp.start - sp.before.length;
    const observed = sp.before + sp.text + sp.after;
    return { observed, replacement: sp.before + sp.was + sp.after, range: { start, end: start + observed.length } };
  });
  const located = [spans, spans.map(({ range: _, ...sp }) => sp), patched.map(sp => ({ observed: sp.text, replacement: sp.was }))]
    .map(tried => tried.some(sp => !sp.observed) ? null : locateSpans(text, tried))
    .find(r => r?.ok);
  return located?.ok ? located.spans : null;
}

/** `text` with these patches taken back, the newest first; null when one of them has changed since. */
export function withoutPatched(text: string, patches: readonly (readonly PatchedSpan[])[]): string | null {
  let out = text;
  for (const patched of [...patches].reverse()) {
    const spans = revertSpans(out, patched);
    if (!spans) return null;
    out = applyLocated(out, spans);
  }
  return out;
}

/** What an agent's patch did in a draft, as the person is told: by what the ask says it was. */
export function patchDid(asked: { output?: boolean; force?: boolean; proposal?: { op: "apply" | "dismiss" }; standsOn?: unknown }): string {
  return asked.proposal?.op === "dismiss" ? "took a dismissed proposal's line out of your draft" : asked.output ? "placed output in your draft" : asked.proposal || asked.force ? "applied a proposal in your draft"
    : asked.standsOn ? "set a property: saved, and in your draft beside your words" : "edited text above your cursor";
}

// Highlights and margin notes in a reader (ADR 0004 contract 6): what the door draws for a note's annotations.
//
// - **Span** (`place: span`): an annotation's words in its tone, a capped-dark background (theme.ts surfaceMix, the
//   look's surfaces: never light, every text colour reads on it). A highlight is an annotation with no body: only this.
// - **Margin** (`place: margin`): a card for each annotation with a body, beside its passage. A wide reader gives the
//   cards a column of their own on the right (they never shift the words: the column is laid out once, when there are
//   cards); a narrow one folds each under its passage, one row (`trim`) or with its body and replies (`full`). The
//   source never changes: cards are a side layer over the note, as the annotations are a layer beside it (the Floatty
//   Reader overlay's shape).
// - **The passage toolbar**: with text selected, what can be done with the passage, on the selection's line, each a
//   click and, after `a`, a key: Comment, Ask, Explain, and each extension's passage action (marginalia's Highlight,
//   Define, Cite).
//
// The annotations' properties are read through outline-core (annotation-marks.ts), so the tone and the kind mean the
// same in the door, Detail and a published page.

import { annotationKind, annotationTone } from "@ep0ch/outline-core/annotation-marks";
import type { RuleTone } from "@ep0ch/outline-core/rules";
import type { CalloutTone } from "@ep0ch/outline-core/callouts";
import { SURFACE_STEPS } from "@ep0ch/outline-core/style-cascade";
import { type Comment } from "../socket";
import { C, ellipsize, fg, pad, RESET, surfaceBg } from "../style";
import { printable } from "../text";

/** How the margin shows its cards: one row each, whole, or not at all (the spans stay). The person's reading state. */
export type MarginMode = "trim" | "full" | "off";
export const MARGIN_MODES: readonly MarginMode[] = ["trim", "full", "off"];

/** A rule tone as the look's surface it's drawn on: the callouts' families. */
const SURFACE_OF: Readonly<Record<RuleTone, CalloutTone>> = { default: "blue", good: "green", warn: "amber", bad: "coral", accent: "violet", dim: "neutral" };
/** The ink a tone's mark and card edge are drawn in. */
const INK_OF: Readonly<Record<RuleTone, number>> = { default: C.lcyan, good: C.lgreen, warn: C.yellow, bad: C.lred, accent: C.lmagenta, dim: C.grey };

/** The background an annotation's words are drawn on: its tone's surface, capped dark. */
export function spanBg(props: Comment["props"]): string {
  return surfaceBg(SURFACE_OF[annotationTone(props ?? {})], Math.round(SURFACE_STEPS * 0.6));
}

/** A rule decoration's span (place: span) in its tone. */
export function toneBg(tone: string | undefined): string {
  const t = (tone && tone in SURFACE_OF ? tone : "default") as RuleTone;
  return surfaceBg(SURFACE_OF[t], Math.round(SURFACE_STEPS * 0.6));
}

/** The ink of an annotation's tone: its card's edge and kind word. */
export const toneInk = (props: Comment["props"]) => INK_OF[annotationTone(props ?? {})];

/** What an annotation is, in a word: `highlight`, `question`, `define`, `comment`… */
export const kindOf = (c: Comment) => annotationKind(c.props ?? {}, c.body);

/** An annotation drawn as a card: one with something to read (a body, or replies). */
export const hasCard = (c: Comment) => !!c.body.trim() || c.replies.length > 0;

/**
 * The margin column's width at reader width `w`: room for cards beside the words when the reader is wide (a third of
 * it, 24 to 36 cells), else 0 (the cards fold under their passages).
 */
export function marginColumn(w: number, mode: MarginMode, cards: number): number {
  if (mode === "off" || cards === 0 || w < 100) return 0;
  return Math.max(24, Math.min(36, Math.floor(w * 0.28)));
}

/**
 * Cards placed in the side column: each at its passage's first row, or below the card above it (one blank row
 * between), so none overlap. `at` is the content row each starts on; `rows` its drawn rows.
 */
export function placeCards<T extends { thread: string; row: number; rows: string[] }>(cards: readonly T[]): (T & { at: number })[] {
  let free = -Infinity;
  return [...cards].sort((a, b) => a.row - b.row).map(c => {
    const at = Math.max(c.row, free);
    free = at + c.rows.length + 1;
    return { ...c, at };
  });
}

/** A passage action as the toolbar offers it: what it runs, its label, and the key after `a`. */
export interface PassageChoice { action: string; label: string; key?: string }

/** The toolbar's chips in one row, `w` cells at most: `a ▸ [Highlight h] [Comment c] …`, and where each landed. */
export function toolbarRow(choices: readonly PassageChoice[], armed: boolean, w: number): { text: string; hits: { from: number; to: number; action: string }[] } {
  const hits: { from: number; to: number; action: string }[] = [];
  let text = fg(armed ? C.yellow : C.grey) + (armed ? "a ▸ " : "a: "), col = width0(armed ? "a ▸ " : "a: ");
  for (const c of choices) {
    const shown = `[${c.label}${c.key ? ` ${c.key}` : ""}]`;
    if (col + shown.length + 1 > w) break;
    text += (armed ? fg(C.white) : fg(C.lcyan)) + shown + RESET + " ";
    hits.push({ from: col, to: col + shown.length, action: c.action });
    col += shown.length + 1;
  }
  return { text: text + RESET, hits };
}

const width0 = (s: string) => [...s].length;

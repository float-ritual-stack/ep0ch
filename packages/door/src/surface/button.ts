// The one button part (PIE-1287): how anything pressable looks, wherever it is drawn: a note's `::button`, a script view's button,
// an output region's and a proposal's controls, a thread's row of controls, the empty screen's, the status bar's. Its look is
// what the line says (outline-core's button-call.ts reads glyph, tone, frame and fill); its state is the press's own (running,
// done, failed, from the press itself and `scripts.ended`) or the action's refusal now (disabled, Dispatcher.refusedNow). Under
// the pointer it is drawn lit through the Overflow pass (litText), the same for every place; a failed or disabled button's why
// is the value that pass reads in full.
import type { ButtonFrame, ButtonLookWords, ButtonTone } from "@ep0ch/outline-core/button-call";
import { BORDER_BOXES, LINE_BOX, type BoxGlyphs } from "../canvas";
import { fullText, litText } from "../overflow";
import { bg, BOLD, C, fg, RESET, width } from "../style";

export type ButtonState = "idle" | "running" | "done" | "failed" | "disabled";
export interface ButtonLook extends ButtonLookWords { state?: ButtonState; why?: string }

/** A tone is a theme role: its colour as text, and as a background (dark-first: a fill is never a bright colour). */
const TONES: Readonly<Record<ButtonTone, { text: number; fill: number; on: number }>> = {
  quiet: { text: C.lcyan, fill: C.blue, on: C.white },
  primary: { text: C.yellow, fill: C.brown, on: C.yellow },
  danger: { text: C.lred, fill: C.red, on: C.white },
};
/** What a state draws in place of the author's glyph, and its colour (none keeps the tone's). */
const STATES: Readonly<Record<ButtonState, { glyph?: string; text?: number }>> = {
  idle: {}, running: { glyph: "◐", text: C.yellow }, done: { glyph: "✓", text: C.lgreen }, failed: { glyph: "!", text: C.lred }, disabled: { text: C.dark },
};
const FRAMES: Readonly<Record<Exclude<ButtonFrame, "none">, BoxGlyphs>> = { box: LINE_BOX, ...BORDER_BOXES };

/**
 * The words on a button: the label after its glyph, whose place a state takes (◐ running, ✓ done) and `…` while it runs. A button
 * with no glyph says running and done by colour alone, so its words stay what was written; failed always says `!`, until pressed again.
 */
export function buttonWords(label: string, look: ButtonLook = {}): string {
  const state = look.state ?? "idle", glyph = look.glyph || state === "failed" ? STATES[state].glyph ?? look.glyph : undefined;
  return `${glyph ? `${glyph} ` : ""}${label}${state === "running" && look.glyph ? "…" : ""}`;
}

/**
 * A button's rows: one with `frame` none (`[label]`, or a filled band with `fill`), three with a frame of the box glyphs.
 * `press` wraps the pressable words (a link tag, a hit box): the label row's, the one a click or ⏎ finds.
 */
export function buttonRows(label: string, look: ButtonLook = {}, press: (drawn: string) => string = s => s): string[] {
  const tone = TONES[look.tone ?? "quiet"], state = STATES[look.state ?? "idle"], words = buttonWords(label, look);
  const disabled = look.state === "disabled";
  const ink = fg(state.text ?? tone.text), back = look.fill && !disabled ? bg(tone.fill) + fg(state.text ?? tone.on) : "";
  const lit = (text: string) => fg(C.white) + BOLD + (look.fill ? bg(tone.fill) : "") + text + RESET;
  // Under the pointer: lit, or, for one that can't run or didn't, the why read in full in its place.
  const hover = (styled: string, plain: string) => look.why && (disabled || look.state === "failed") ? fullText(look.why, styled) : litText(styled, lit(plain));
  const frame = look.frame && look.frame !== "none" ? FRAMES[look.frame] : null;
  if (!frame) {
    const plain = look.fill && !disabled ? ` ${words} ` : disabled ? `(${words})` : `[${words}]`;
    return [press(hover((back || ink + BOLD) + plain + RESET, plain))];
  }
  const inner = ` ${words} `, edge = ink + (disabled ? "" : BOLD);
  const across = frame.top.repeat(width(inner));
  return [
    edge + frame.tl + across + frame.tr + RESET,
    edge + frame.side + RESET + press(hover((back || edge) + inner + RESET, inner)) + edge + frame.side + RESET,
    edge + frame.bl + frame.bottom.repeat(width(inner)) + frame.br + RESET,
  ];
}

/** One row, whatever the frame says: the status bar's, a strip's (the same button, sized to the row). */
export const buttonText = (label: string, look: ButtonLook = {}, press?: (drawn: string) => string): string => buttonRows(label, { ...look, frame: "none" }, press)[0]!;

// ── a press's state, per button ─────────────────────────────────────────────

interface Pressed { state: "running" | "done" | "failed"; why?: string; run?: string; at: number }
/** How long a press that ended well shows done before it is a button again. */
export const DONE_MS = 3000;
const presses = new Map<string, Pressed>();
const keyOf = (block: string, line: number) => `${block}:${line}`;

/** The press of the button on `line` of `block`, as the person last saw it: running, done (for DONE_MS), failed until pressed again. */
export function pressState(block: string, line: number): Pick<ButtonLook, "state" | "why"> {
  const p = presses.get(keyOf(block, line));
  if (!p || (p.state === "done" && Date.now() - p.at > DONE_MS)) return {};
  return { state: p.state, ...(p.why ? { why: p.why } : {}) };
}

/** A press that answers sooner than this never shows running, nor done after: only one that took a while needs saying. */
export const RUNNING_MS = 150;

/**
 * Run `press` as the button on `line` of `block`: running once it has taken RUNNING_MS, then done; failed with its words at
 * once. A script run that outlasts the service's wait answers `state: "running"` and its id (`undo`): it stays running until
 * `scripts.ended` (pressEnded).
 */
export async function pressing<T>(block: string, line: number, redraw: () => void, press: () => Promise<T>): Promise<T> {
  const key = keyOf(block, line), settle = (p: Omit<Pressed, "at">) => {
    presses.set(key, { ...p, at: Date.now() });
    redraw();
    if (p.state === "done") setTimeout(redraw, DONE_MS + 50);
  };
  presses.delete(key);
  let shown = false;
  const slow = setTimeout(() => { shown = true; presses.set(key, { state: "running", at: Date.now() }); redraw(); }, RUNNING_MS);
  try {
    const r = await press();
    const answer = r && typeof r === "object" ? r as { state?: string; message?: string; undo?: string } : {};
    if (answer.state === "running" && answer.undo) settle({ state: "running", run: answer.undo });
    else if (answer.state === "failed") settle({ state: "failed", why: answer.message ?? "it failed" });
    else if (shown) settle({ state: "done" });
    else presses.delete(key);
    return r;
  } catch (e) {
    settle({ state: "failed", why: e instanceof Error ? e.message : String(e) });
    throw e;
  } finally { clearTimeout(slow); }
}

/** A script run ended (`scripts.ended`): the button that started it is done, or failed, or a button again when it was stopped. */
export function pressEnded(run: string, reason: "done" | "stopped" | "failed", message?: string): boolean {
  for (const [key, p] of presses) {
    if (p.run !== run) continue;
    if (reason === "stopped") presses.delete(key);
    else presses.set(key, { state: reason, ...(reason === "failed" ? { why: message || "the run failed" } : {}), at: Date.now() });
    return true;
  }
  return false;
}

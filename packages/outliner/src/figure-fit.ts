// Which of the outline's figures a note would read best as (PIE-721), so an agent hears "this reads as a timeline"
// when it writes one as a list, and nobody has to go round the outline saying "don't we have a component for this".
// One Jev request (the skill-suggestion pattern): a Choice over the outline's own figures, each described by its
// schema (built-ins and extensions' alike, nothing listed here), and two Noul gates, "is most of it structured data"
// and, inverted, "is it prose whose wording is the point". A suggestion needs the gate and the choice's confidence over
// their thresholds, so prose is never nagged. The same function is the write receipt's suggestion, the sweep's margin
// note and the eval's subject (scripts/evals/figure-fit.ts), so what the eval scores is what agents are told.
import { componentBlocks, noteStructure } from "@ep0ch/outline-core/component-block";
import { componentGist, type ComponentSchema } from "@ep0ch/outline-core/component-schema";
import { loadFigureFitPrompt, type PromptRevision } from "./ai-prompts";
import { JEV_ENDPOINT, JEV_MODEL, jevKey } from "./search-ranking";

/** Where a suggestion is made: the gate (the mean of the two Noul answers, prose inverted) and the choice's confidence. */
export interface FigureFitThresholds { gate: number; confidence: number }
/** Until the eval says otherwise: over half sure it is data, and a choice that isn't spread across several figures. */
export const FIGURE_FIT_THRESHOLDS: FigureFitThresholds = { gate: 0.6, confidence: 0.4 };

/** A note's text holds at most this much of itself in the request: a figure's shape shows in its first lines. */
const MAX_TEXT = 4000;
/** Rows a note needs before it has a shape a figure draws. */
const MIN_ROWS = 3;

export interface FigureFit {
  /** The figure's id (`graph-timeline`). */
  component: string;
  /** What to tell the writer, in a sentence: the figure, what it draws, where its properties are. */
  said: string;
  gate: number;
  confidence: number;
  /** The choice's probability for the figure named. */
  probability: number;
}

/** Jev's answers for one note, kept whole for the eval: every figure's probability and both gates. */
export interface FigureFitReading {
  choice: string;
  probabilities: Record<string, number>;
  confidence: number;
  structured: number;
  prose: number;
  gate: number;
  model: string;
  prompt: PromptRevision[];
}

export type FigureFitAnswer =
  | { fit: FigureFit; reading: FigureFitReading }
  | { fit: null; why: "no-shape" | "has-figure" | "below-gate" | "unsure"; reading?: FigureFitReading }
  | { unavailable: string };

/** The figures a suggestion can name: the outline's own (its `figures` group, extensions' included), each described by its schema. */
export function figureOptions(schemas: readonly ComponentSchema[]): Record<string, string> {
  return Object.fromEntries(schemas.filter(s => s.group === "figures").map(s => [s.id, `${figureWord(s)}: ${componentGist(s, 160)}`]));
}

/** A figure's own name for itself: its title before the `(::graph-…)`. */
const figureWord = (s: ComponentSchema) => s.title.replace(/\s*\(.*$/, "").trim() || s.id;

/**
 * Whether the text has a shape a figure could draw, before anything is asked: at least three list items, table rows
 * or dated lines outside code and components, and no `::graph-` of its own (a note that has one chose already).
 */
export function figureShape(text: string): "shaped" | "no-shape" | "has-figure" {
  const lines = text.split("\n");
  if (componentBlocks(lines).some(b => b.name.startsWith("graph-"))) return "has-figure";
  const structure = noteStructure(lines);
  const rows = lines.filter((line, i) => structure[i] === -1 && /^\s*(?:[-*+]\s+\S|\d+[.)]\s+\S|\|.*\||(?:[-*+]\s*)?\d{4}-\d{2}(?:-\d{2})?\b)/.test(line)).length;
  return rows >= MIN_ROWS ? "shaped" : "no-shape";
}

/** The request: the note as state, the Choice over the figures, the two gates. */
export function figureFitRequest(text: string, options: Record<string, string>, prompt: { instructions: string; structured: string; prose: string }, title?: string) {
  return {
    model: JEV_MODEL,
    state: { title: title ?? text.split("\n", 1)[0]!.slice(0, 200), text: text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…` : text },
    questions: {
      which: { type: "choice", instructions: prompt.instructions, criteria: options },
      "gate::structured": { type: "noul", instructions: prompt.structured },
      "gate::prose": { type: "noul", instructions: prompt.prose },
    },
  };
}

type JevAnswers = { model?: string; answers?: Record<string, { type?: string; choice?: string; probabilities?: Record<string, number>; confidence?: number; noul?: number }> };

/** Jev's answer read, or why it can't be: every number in range, the choice one of the options. */
export function readFigureFit(response: JevAnswers, options: Record<string, string>, prompt: PromptRevision[]): FigureFitReading | { error: string } {
  const which = response.answers?.which, structured = response.answers?.["gate::structured"]?.noul, prose = response.answers?.["gate::prose"]?.noul;
  const unit = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  if (which?.type !== "choice" || typeof which.choice !== "string" || !(which.choice in options) || !unit(which.confidence) || !unit(structured) || !unit(prose)) {
    return { error: "Jev's figure-fit answer didn't read" };
  }
  return {
    choice: which.choice, probabilities: which.probabilities ?? {}, confidence: which.confidence, structured, prose,
    gate: (structured + (1 - prose)) / 2, model: response.model ?? JEV_MODEL, prompt,
  };
}

/** The suggestion a reading makes at these thresholds, or why it makes none. */
export function fitOf(reading: FigureFitReading, schemas: readonly ComponentSchema[], thresholds: FigureFitThresholds = FIGURE_FIT_THRESHOLDS): FigureFitAnswer {
  if (reading.gate < thresholds.gate) return { fit: null, why: "below-gate", reading };
  if (reading.confidence < thresholds.confidence) return { fit: null, why: "unsure", reading };
  const schema = schemas.find(s => s.id === reading.choice)!;
  const said = `this reads as a ${figureWord(schema).toLowerCase()}: ::${schema.id} would draw it (${componentGist(schema)}); outline_components ${schema.id} gives its properties and an example`;
  return { fit: { component: schema.id, said, gate: round(reading.gate), confidence: round(reading.confidence), probability: round(reading.probabilities[schema.id] ?? 0) }, reading };
}

const round = (n: number) => Math.round(n * 100) / 100;

export interface FigureFitOptions {
  title?: string;
  thresholds?: FigureFitThresholds;
  apiKey?: string; endpoint?: string; timeoutMs?: number; promptDirectory?: string;
  fetch?: (url: string, init: RequestInit) => Promise<Response>;
  /** Where the key is looked up (`TYPESAFE_API_KEY`, `WITH_SECRETS_DIR`); a test passes its own. */
  env?: NodeJS.ProcessEnv;
}

/**
 * Jev's whole reading of a note (every figure's probability, both gates), or why it can't be had: no key, a timeout, an
 * answer that doesn't read. Asks whatever the note's shape; the eval keeps these and scores every threshold from them.
 */
export async function askFigureFit(text: string, schemas: readonly ComponentSchema[], o: FigureFitOptions = {}): Promise<FigureFitReading | { unavailable: string }> {
  const options = figureOptions(schemas);
  if (Object.keys(options).length < 2) return { unavailable: "the outline has no figures to suggest" };
  const apiKey = o.apiKey ?? await jevKey(o.env);
  if (!apiKey) return { unavailable: "Jev is not configured: with-secrets --add typesafe TYPESAFE_API_KEY" };
  try {
    const prompt = await loadFigureFitPrompt(o.promptDirectory);
    // OUTLINER_JEV_ENDPOINT: a test's fake Jev (or a proxy); Jev's own otherwise.
    const response = await (o.fetch ?? fetch)(o.endpoint ?? (o.env ?? process.env).OUTLINER_JEV_ENDPOINT ?? JEV_ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, redirect: "error",
      body: JSON.stringify(figureFitRequest(text, options, prompt, o.title)),
      signal: AbortSignal.timeout(o.timeoutMs ?? 2500),
    });
    if (!response.ok) return { unavailable: `Jev HTTP ${response.status}` };
    const reading = readFigureFit(await response.json() as JevAnswers, options, prompt.revisions);
    return "error" in reading ? { unavailable: reading.error } : reading;
  } catch (e) {
    return { unavailable: (e as Error).name === "TimeoutError" ? "Jev didn't answer in time" : `Jev: ${(e as Error).message}` };
  }
}

/**
 * The figure the text would read best as, when it has the shape of one and Jev is sure enough; `unavailable` (with
 * why) when Jev can't be asked. Never throws: a write never waits on it past `timeoutMs` or fails for it.
 */
export async function suggestFigure(text: string, schemas: readonly ComponentSchema[], o: FigureFitOptions = {}): Promise<FigureFitAnswer> {
  const shape = figureShape(text);
  if (shape !== "shaped") return { fit: null, why: shape };
  const reading = await askFigureFit(text, schemas, o);
  return "unavailable" in reading ? reading : fitOf(reading, schemas, o.thresholds);
}

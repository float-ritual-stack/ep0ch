// What every `::graph-*` figure draws with (src/graphs.ts and the kinds in this folder): the one accent, the dim frame
// and muted text, the ink of a row, the bright of a chosen one. Nothing outside these four.
import { C } from "../style";

export const ACCENT = C.lcyan, DIM = C.dark, INK = C.grey, HI = C.white;

/** A figure's props, from its YAML (or its Markdown, or the outline). */
export type Props = Record<string, any>;

/**
 * Tags a row as a link to its note (PIE-441): the reader's `DocEnv.link`, or nothing (text stays text). `figure`: the
 * key of the figure the row is in, so the figure's keys (tabs, density) work while the row is the current element.
 */
export type RowLink = (block: string, text: string, figure?: string) => string;
export const rowLink = (link: RowLink | undefined, block: unknown, text: string, figure?: string) => (link && typeof block === "string" ? link(block, text, figure) : text);

/** A kind's drawing: its rows at `w` columns inside the frame. */
export type Draw = (p: Props, w: number, link?: RowLink) => string[];

/**
 * How much room a figure has (PIE-581): `narrow` under 48 columns (a river column, a drawer), `cozy` under 90 (a
 * detail beside another tile), `wide` past it. Each kind says once what it does per tier; the tier is the
 * reader's width, never the terminal's.
 */
export type Tier = "narrow" | "cozy" | "wide";
export const tier = (w: number): Tier => (w < 48 ? "narrow" : w < 90 ? "cozy" : "wide");

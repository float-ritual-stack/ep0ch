// What the door needs from the outline, independent of the wire protocol.
import { literalLines } from "./literal";

export interface Msg {
  id: string;
  text: string;
  parentId: string | null;
  childIds: string[];
  createdAt: number;   // epoch ms
  updatedAt: number;
  author: string | null;
  props: Record<string, string>;
  /** The service's revision of this text; a save names it so a stale draft is refused. */
  revision?: number;
  /** Block-scope properties in order, repeats kept (`props` keeps only the last of a key). */
  properties?: { key: string; value: string }[];
  /**
   * A list row: title, properties and revision without the note's full text (`text` is just the title).
   * Readers fetch the whole note before showing, editing or commenting on it.
   */
  partial?: boolean;
  /** In the Trash (it or an ancestor was deleted); still readable. */
  deleted?: boolean;
}

export interface Caller {
  id: string;
  name: string;        // what the client calls itself
  host: string;
  activity: string;
  since: number | null;
  target?: string | null;  // block id the caller is looking at
}

export interface BoardInfo { host: string; workspace: string; protocol: number; blocks: number | null; capabilities?: string[] | null }

export interface Board {
  info(): Promise<BoardInfo>;
  roots(): Promise<Msg[]>;
  get(id: string): Promise<Msg | null>;
  children(id: string): Promise<Msg[]>;
  /** Blocks whose updatedAt is after `since`, newest first. */
  changedSince(since: number, limit: number): Promise<Msg[]>;
  search(text: string, limit: number): Promise<Msg[]>;
  callers(): Promise<Caller[]>;
  close(): void;
}

/**
 * Where a note's title comes from, as the service picks it (`firstLineWithoutPropertyTokens`): the first
 * line with text once its `[key::value]` tokens are taken out, skipping literal-region marker lines
 * (PIE-422). Inside a region a token is text, so it stays. `line` is -1 when no line has text.
 */
export function titleLine(text: string): { line: number; text: string } {
  const lines = text.split("\n");
  const lit = text.includes("<!--") ? literalLines(text) : null;
  let first = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lit?.markers.has(i)) continue;
    const l = lines[i]!;
    if (first < 0 && l.trim()) first = i;
    const t = (lit?.inside.has(i) ? l : l.replace(/\[[\w-]+::[^\]]*\]/g, "")).trim();
    if (t) return { line: i, text: t };
  }
  return { line: first, text: "" };
}
/**
 * The lines after a note's title, for a digest (the river's cards, the desk's search preview): matched
 * literal-region markers hidden, each line saying whether it's inside a region, where `[key::value]` is text.
 */
export function bodyLinesOf(text: string): { text: string; literal: boolean }[] {
  const lit = text.includes("<!--") ? literalLines(text) : null;
  const from = Math.max(0, titleLine(text).line) + 1;
  return text.split("\n").flatMap((l, i) => (i < from || lit?.markers.has(i) ? [] : [{ text: l, literal: !!lit?.inside.has(i) }]));
}
export const subject = (m: Msg) => { const t = titleLine(m.text); return t.text || (t.line < 0 ? "(empty)" : "(untitled)"); };

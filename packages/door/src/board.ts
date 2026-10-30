// What the door needs from the outline, independent of the wire protocol.
import { headedTitle as titleWithWorkId } from "@ep0ch/outline-core/work-id-title";
import { literalLines } from "@ep0ch/outline-core/code-ranges";
import { noteTitleLine } from "@ep0ch/outline-core/property-parse";
import { printable } from "./text";
import { presentLinks, stripMarks } from "./refs";
import { prop } from "./props";

import type { PropertyMatch } from "@ep0ch/outline-core/protocol";
import { statusWord } from "@ep0ch/outline-core/checklist-marks";

export interface Msg {
  /** Door-local provenance, carried between tiles; never sent as block data. */
  address?: import("./desk/outline-boards").NoteAddress;
  id: string;
  text: string;
  parentId: string | null;
  position?: number;
  childIds: string[];
  createdAt: number;   // epoch ms
  updatedAt: number;
  author: string | null;
  /** The service's revision of this text; a save names it so a stale draft is refused. */
  revision?: number;
  /** Block-scope properties in order, repeats kept, as the service sends them. Read one with `prop(m, key)` / `propValues(m, key)` (props.ts). */
  properties: { key: string; value: string }[];
  /**
   * A list row: title, properties and revision without the note's full text (`text` is just the title).
   * Readers fetch the whole note before showing, editing or commenting on it.
   */
  partial?: boolean;
  /** The words after the title as one line, when a list asked for it (the service's `excerpt` field). */
  excerpt?: string;
  /** In the Trash (it or an ancestor was deleted); still readable. */
  deleted?: boolean;
  /**
   * A Resource shown as a note (`resourceNote`, src/authored.ts; id `resource:<id>`). It is read, never written, but a
   * passage of its stored text can be commented on (PIE-650): the thread lives in the outline beside it.
   * `revision` is then `resourceTextRevision` of the text the note was drawn from.
   */
  resource?: {
    id: string;
    /** The note whose link opened it: kept on the comment as its reference context (the thread is a backlink there). */
    from?: string;
    /** Where the Resource's source text begins in `text` when it is drawn as it is, else null (a quote then carries no offset). */
    sourceAt: number | null;
    /** Why a passage can't be commented on (a ticket, a PDF, a file that can't be read); absent when it can. */
    uncommentable?: string;
  };
  /**
   * Where a question that reads line chips matched this row (PIE-1277: a view's `[property-scope::all]`): each chip's
   * offset and line (from 0) in the note's text, its scope, and on a checklist step the step's status. Opening the row
   * lands on the first one off the note's own header.
   */
  propertyMatches?: PropertyMatch[];
}

/** The first chip a row matched on a line of its own, not the note's header: where the row opens. */
export const bodyMatch = (m: Pick<Msg, "propertyMatches">): PropertyMatch | undefined => m.propertyMatches?.find(x => x.scope !== "block");

/** Where a row matched, as its row says it: "line 12 to do club-ask: members: Saturday or Sunday". */
export const matchWords = (x: PropertyMatch, withValue = true) =>
  `line ${x.line + 1}${x.task ? ` ${statusWord(x.task)}` : ""} ${x.key}${withValue ? `: ${x.value}` : ""}`;

export interface Caller {
  id: string;
  name: string;        // what the client calls itself
  host: string;
  activity: string;
  since: number | null;
  target?: string | null;  // block id the caller is looking at
}

export interface BoardInfo {
  host: string; workspace: string; protocol: number; blocks: number | null;
  /** The machine's name in `ep0ch://` URIs, as its host says (the name its person gave it); absent from an older one. */
  machine?: string;
  /** The outline's name when the service is an outline host (PIE-457); absent from a single-outline service. */
  outline?: string;
  /** Stable identity of the outline database instance; changes on restore/reset/import/recreate. */
  outlineInstanceId?: string;
}

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
 * Where a note's title comes from: outline-core's `noteTitleLine`, the service's own answer, cached. `line` is -1
 * when no line has text.
 */
export function titleLine(text: string): { line: number; text: string } {
  // A function of the text alone, asked for every row of every list each frame (a showcase load asks it ~10⁴ times): answered once per text.
  const known = TITLES.get(text);
  if (known) return { ...known };
  const found = noteTitleLine(text);
  if (kept.room(text)) TITLES.clear();
  TITLES.set(text, found);
  return { ...found };
}
const TITLES = new Map<string, { line: number; text: string }>();
/**
 * What the two title caches may hold: a few thousand notes' texts, at most about 2 MB of them together (a text is the key, so a long
 * one held for each edit of it would add up). Past either, the caches start again: a list is a screenful of rows, asked each frame.
 */
const kept = {
  entries: 0, chars: 0, generation: 0,
  /** `text` is about to be kept: true when the caches are full and should start again first. */
  room(text: string): boolean {
    if (this.entries >= 5000 || this.chars + text.length > 2_000_000) { this.entries = 0; this.chars = 0; this.generation++; return true; }
    this.entries++; this.chars += text.length;
    return false;
  },
};
/**
 * The lines after a note's title, for a digest (the river's cards, the desk's search preview): matched
 * literal-region markers hidden, each line saying whether it's inside a region, where `[key::value]` is text.
 */
export function bodyLinesOf(text: string): { text: string; literal: boolean }[] {
  const lit = text.includes("<!--") ? literalLines(text) : null;
  const from = Math.max(0, titleLine(text).line) + 1;
  return text.split("\n").flatMap((l, i) => (i < from || lit?.markers.has(i) ? [] : [{ text: l, literal: !!lit?.inside.has(i) }]));
}
/** A note's title as drawn: its first line, nothing in it a terminal acts on (an extension's write can store an escape). */
export const subject = (m: Msg) => {
  // A function of the text alone (links read with no source), drawn for every row of every list each frame: answered once per text.
  const known = SUBJECTS.get(m.text);
  if (known !== undefined) return known;
  const t = titleLine(m.text), title = printable(stripMarks(presentLinks(t.text, false, null)), " ").trim() || (t.line < 0 ? "(empty)" : "(untitled)");
  if (subjectsAt !== kept.generation) { SUBJECTS.clear(); subjectsAt = kept.generation; }   // the titles started again: so do their subjects
  SUBJECTS.set(m.text, title);
  return title;
};
const SUBJECTS = new Map<string, string>();
let subjectsAt = 0;
/** What a list filter matches a note by (outline-core's matcher, as every bar scope): its work id, its page name and its title. */
export const identityFields = (workId: string | undefined, page: string | undefined, title: string): string[] => [titleWithWorkId(title, workId), workId ?? "", page ?? ""].filter(Boolean);

/**
 * A note's name wherever it's drawn (PIE-809, PIE-1356): its title with its Work ID first, `HUB-062 · <title>`, said
 * once (outline-core's `headedTitle`). The tile bar and its tabs, spines, lists, completion and the power bar read it.
 */
export const headedTitle = (m: Msg): string => {
  // Drawn for every row of every list each frame, as `subject`: answered once per text and Work ID.
  const id = prop(m, "work-id"), key = id ? `${id}\n${m.text}` : m.text, known = HEADED.get(key);
  if (known !== undefined && headedAt === kept.generation) return known;
  if (headedAt !== kept.generation) { HEADED.clear(); headedAt = kept.generation; }
  const title = titleWithWorkId(subject(m), id);
  HEADED.set(key, title);
  return title;
};
const HEADED = new Map<string, string>();
let headedAt = 0;

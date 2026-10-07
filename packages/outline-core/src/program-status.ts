// Program status (OSC 7501, the Program Status Protocol, spec rev 0.2: superlogical.com/rex/docs/build/program-status):
// a program tells its terminal what it is doing, `ESC ] 7501 ; state=…:id=…:kind=…:progress=…:app=…:title=…:msg=… ST`.
// This is the one reader and writer of it, for every side: the door's terminal tiles read it (src/desk/pty.ts), the
// door reports its own, and the emitters (the Claude mod, `ep0ch install`, `ep0ch backup run`, the scripts, the
// outliner's panes) write it. The terminal's records follow the spec exactly: one record per id, each report
// replacing its record whole, `clear` taking a record and everything beneath it, the limits checked on every pair
// before any record is touched, and text with a control character refused. Pure: no I/O, no globals beyond the
// language's own (base64 and UTF-8 are done here), so the Claude mod's copy runs where there is no Node.

/** The OSC number. */
export const PROGRAM_STATUS_OSC = 7501;
/** The states a record holds, in the spec's order. `clear` is not one: it removes records. */
export const PROGRAM_STATES = ["idle", "working", "done", "blocked", "error"] as const;
export type ProgramState = (typeof PROGRAM_STATES)[number];
/** What a `blocked` record waits for: approval, a typed answer, a login or token. */
export const BLOCKED_KINDS = ["permission", "question", "auth"] as const;
export type BlockedKind = (typeof BLOCKED_KINDS)[number];

/**
 * The spec's hard caps, per report and per terminal. `sequence` is OSC through ST: a body is measured with a two-byte
 * ST (`ESC \`), so a report ended by BEL is held to one byte less (terminals MAY choose lower limits).
 */
export const PROGRAM_STATUS_LIMITS = {
  sequence: 4096, key: 16, msgEncoded: 2732, msgDecoded: 2048, titleEncoded: 256, titleDecoded: 192, app: 32,
  id: 128, segment: 32, depth: 8, records: 256,
} as const;

/** Feature detection: a program sends it, and a terminal that supports the protocol answers with the same bytes. */
export const PROGRAM_STATUS_QUERY = "\x1b]7501;?\x1b\\";
/** The terminfo capability a supporting terminal adds (extended string, `tic -x`): the report with its body as the one parameter. */
export const PROGRAM_STATUS_TERMINFO = "Pst=\\E]7501;%p1%s\\E\\\\";

/** One report as read: `id` "" is the root record. */
export interface StatusReport {
  state: ProgramState | "clear";
  id: string;
  kind?: BlockedKind;
  progress?: number;
  app?: string;
  title?: string;
  msg?: string;
}
/** A record the terminal holds: a report's fields (never `clear`). */
export type StatusRecord = Omit<StatusReport, "state"> & { state: ProgramState };

/** What a body (the text between `7501;` and ST) is: the feature query, a report, or nothing to apply and why. */
export type ParsedStatus = { t: "query" } | { t: "report"; report: StatusReport } | { t: "ignored"; why: string };

const KEY = /^[a-z]+$/;
const VALUE = /^[A-Za-z0-9_.,+/=-]*$/;
const SEGMENT = /^[A-Za-z0-9_.+-]{1,32}$/;
const APP = /^[A-Za-z0-9_.+-]{1,32}$/;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;
/** The prefix and the longest ST: what a body's bytes are added to for the sequence limit. */
const FRAME_BYTES = "\x1b]7501;".length + 2;

/**
 * Read one report's body. Malformed pairs (no `=`, an empty or non-`[a-z]` key, a value outside the set) are skipped;
 * unknown keys are ignored; a repeated key's last value wins. A broken limit, base64 that doesn't decode (or isn't
 * UTF-8), or decoded text with a control character discards the whole report. No `state`, an unknown one, or an id
 * outside the grammar ignores it (an id is never taken as the root's).
 */
export function parseProgramStatus(body: string): ParsedStatus {
  if (utf8Length(body) + FRAME_BYTES > PROGRAM_STATUS_LIMITS.sequence) return { t: "ignored", why: "longer than 4096 bytes" };
  if (body.trim() === "?") return { t: "query" };
  const pairs = new Map<string, string>();
  /** msg and title as text, decoded and checked pair by pair. */
  const texts = new Map<string, string>();
  for (const raw of body.split(":")) {
    const eq = raw.indexOf("=");
    if (eq < 0) continue;
    const key = raw.slice(0, eq).trim(), value = raw.slice(eq + 1).trim();
    if (utf8Length(key) > PROGRAM_STATUS_LIMITS.key) return { t: "ignored", why: `key longer than ${PROGRAM_STATUS_LIMITS.key} bytes` };
    if (!KEY.test(key) || !VALUE.test(value)) continue;
    // Every pair is held to its limits, a repeated one too: nothing of a report that broke one is applied.
    const over = overLimit(key, value);
    if (over) return { t: "ignored", why: over };
    if (key === "msg" || key === "title") {
      const text = decodeText(value);
      if (text === null) return { t: "ignored", why: `${key} is not base64 of UTF-8` };
      if (utf8Length(text) > (key === "msg" ? PROGRAM_STATUS_LIMITS.msgDecoded : PROGRAM_STATUS_LIMITS.titleDecoded)) return { t: "ignored", why: `${key} too long decoded` };
      if (hasControl(text)) return { t: "ignored", why: `${key} holds a control character` };
      texts.set(key, text);
    }
    pairs.set(key, value);
  }
  const state = pairs.get("state");
  if (state === undefined) return { t: "ignored", why: "no state" };
  if (state !== "clear" && !(PROGRAM_STATES as readonly string[]).includes(state)) return { t: "ignored", why: `unknown state ${state}` };
  const id = pairs.get("id");
  if (id !== undefined && !id.split("/").every(s => SEGMENT.test(s))) return { t: "ignored", why: "id outside the grammar" };
  const report: StatusReport = { state: state as StatusReport["state"], id: id ?? "" };
  for (const field of ["msg", "title"] as const) {
    const text = texts.get(field);
    if (text !== undefined) report[field] = text;
  }
  const app = pairs.get("app");
  if (app !== undefined && APP.test(app)) report.app = app;
  const kind = pairs.get("kind");
  if (state === "blocked" && kind !== undefined && (BLOCKED_KINDS as readonly string[]).includes(kind)) report.kind = kind as BlockedKind;
  const progress = pairs.get("progress");
  if ((state === "working" || state === "blocked") && progress !== undefined && /^\d{1,3}$/.test(progress) && Number(progress) <= 100) report.progress = Number(progress);
  return { t: "report", report };
}

/** The limit `key=value` breaks, or null. */
function overLimit(key: string, value: string): string | null {
  const L = PROGRAM_STATUS_LIMITS;
  if (key === "msg" && value.length > L.msgEncoded) return `msg longer than ${L.msgEncoded} bytes encoded`;
  if (key === "title" && value.length > L.titleEncoded) return `title longer than ${L.titleEncoded} bytes encoded`;
  if (key === "app" && value.length > L.app) return `app longer than ${L.app} bytes`;
  if (key === "id") {
    if (value.length > L.id) return `id longer than ${L.id} bytes`;
    const segments = value.split("/");
    if (segments.length > L.depth) return `id deeper than ${L.depth} levels`;
    if (segments.some(s => s.length > L.segment)) return `id segment longer than ${L.segment} bytes`;
  }
  return null;
}

/** How much a state asks of the person, most first: blocked, error, done, working, idle. */
export const ATTENTION: Readonly<Record<ProgramState, number>> = { blocked: 4, error: 3, done: 2, working: 1, idle: 0 };
/** The state that asks most of the person, or null for none. */
export function mostUrgent(states: Iterable<ProgramState>): ProgramState | null {
  let out: ProgramState | null = null;
  for (const s of states) if (out === null || ATTENTION[s] > ATTENTION[out]) out = s;
  return out;
}

/**
 * One terminal's records (the spec's "a terminal holds a set of records, one per id"). Each report replaces its record
 * whole; past the cap, the record updated least recently goes. Lifetimes are the terminal's events: `exited` (the
 * process attached to it exited) and `prompt` (OSC 133 A) drop `working` and `blocked`; `reset` (RIS) drops all;
 * `seen` drops `done` and `error`, which the terminal decides (here: the person came back to the terminal).
 */
export class StatusRecords {
  /** In order of last update: the first is the least recently updated. */
  private records = new Map<string, StatusRecord>();
  constructor(private readonly cap: number = PROGRAM_STATUS_LIMITS.records) {}

  /** Apply one report: true when the records changed. */
  apply(r: StatusReport): boolean {
    if (r.state === "clear") return this.drop(id => r.id === "" || id === r.id || id.startsWith(`${r.id}/`));
    const { state, ...rest } = r;
    const had = this.records.has(r.id);
    this.records.delete(r.id);
    if (!had) while (this.records.size >= this.cap) this.records.delete(this.records.keys().next().value!);
    this.records.set(r.id, { ...rest, state });
    return true;
  }
  /** The process attached to the terminal exited. */
  exited(): boolean { return this.drop((_, s) => s === "working" || s === "blocked"); }
  /** A new shell prompt began (OSC 133 A). */
  prompt(): boolean { return this.exited(); }
  /** A full reset (RIS): every record goes. */
  reset(): boolean { return this.drop(() => true); }
  /** The person saw what was finished: `done` and `error` go. */
  seen(): boolean { return this.drop((_, s) => s === "done" || s === "error"); }

  private drop(f: (id: string, s: ProgramState) => boolean): boolean {
    let changed = false;
    for (const [id, r] of [...this.records]) if (f(id, r.state)) { this.records.delete(id); changed = true; }
    return changed;
  }

  get size(): number { return this.records.size; }
  /** The record at `id`, as stored. */
  get(id: string): StatusRecord | undefined { return this.records.get(id); }
  /**
   * Every record, root first then by id, each with its `app` as shown: its own, else its nearest ancestor's (the
   * spec's inheritance).
   */
  list(): StatusRecord[] {
    return [...this.records.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => {
      if (r.app !== undefined) return r;
      const app = this.inherited(r.id);
      return app === undefined ? r : { ...r, app };
    });
  }
  private inherited(id: string): string | undefined {
    let at = id;
    while (at !== "") {
      at = at.includes("/") ? at.slice(0, at.lastIndexOf("/")) : "";
      const app = this.records.get(at)?.app;
      if (app !== undefined) return app;
    }
    return undefined;
  }
  /** The record that asks most of the person (blocked over error over done over working over idle), or null. */
  urgent(): StatusRecord | null {
    let out: StatusRecord | null = null;
    for (const r of this.list()) if (!out || ATTENTION[r.state] > ATTENTION[out.state]) out = r;
    return out;
  }
}

// ── writing ──────────────────────────────────────────────────────────────────

/** What an emitter says: `msg` and `title` as text (encoded here), cut to the limits and made one line. */
export interface StatusInput {
  state: ProgramState | "clear";
  id?: string;
  kind?: BlockedKind;
  progress?: number;
  app?: string;
  title?: string;
  msg?: string;
}

/**
 * The whole report sequence for `r` (ST is `ESC \`). Text is made one line (control characters become spaces) and cut
 * at a character to its limit; an `app` or `progress` outside the grammar is left out; an id outside the grammar
 * throws (a program's own mistake: a terminal would ignore the report).
 */
export function encodeProgramStatus(r: StatusInput): string {
  const pairs: string[] = [`state=${r.state}`];
  if (r.id) {
    if (!r.id.split("/").every(s => SEGMENT.test(s)) || r.id.length > PROGRAM_STATUS_LIMITS.id || r.id.split("/").length > PROGRAM_STATUS_LIMITS.depth) throw new Error(`not a program status id: ${r.id}`);
    pairs.push(`id=${r.id}`);
  }
  if (r.state === "blocked" && r.kind) pairs.push(`kind=${r.kind}`);
  if ((r.state === "working" || r.state === "blocked") && r.progress !== undefined && Number.isInteger(r.progress) && r.progress >= 0 && r.progress <= 100) pairs.push(`progress=${r.progress}`);
  if (r.app !== undefined && APP.test(r.app)) pairs.push(`app=${r.app}`);
  if (r.title) pairs.push(`title=${encodeText(r.title, PROGRAM_STATUS_LIMITS.titleDecoded)}`);
  if (r.msg) pairs.push(`msg=${encodeText(r.msg, PROGRAM_STATUS_LIMITS.msgDecoded)}`);
  return `\x1b]7501;${pairs.join(":")}\x1b\\`;
}

/** A name made an id segment: the characters the grammar allows (others become `-`), at most 32, never empty. */
export function statusSegment(name: string): string {
  const s = name.replace(/[^A-Za-z0-9_.+-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, PROGRAM_STATUS_LIMITS.segment);
  return s || "x";
}

/** A reply to the feature query: the body starts with `?` (a later revision may add pairs after it). */
export function isStatusQueryReply(body: string): boolean { return body.startsWith("?"); }

/**
 * Text from a record made safe to show outside the terminal's grid: text direction overrides and other invisible
 * formatting characters (zero-width, bidi isolates, the BOM, soft hyphen) taken out. Control characters never get
 * this far: a report holding one is refused.
 */
export function statusDisplayText(s: string): string {
  return s.replace(/[­؜᠎​-‏‪-‮⁠-⁤⁦-⁯﻿￹-￻]/g, "");
}

/** One line of text, control characters as spaces, cut at a character to `max` UTF-8 bytes, as standard base64. */
function encodeText(text: string, max: number): string {
  const line = text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
  const bytes: number[] = [];
  for (const ch of line) {
    const b = utf8(ch.codePointAt(0)!);
    if (bytes.length + b.length > max) break;
    bytes.push(...b);
  }
  return base64(bytes);
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: readonly number[]): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!, b = bytes[i + 1], c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (b === undefined ? "=" : B64[(n >> 6) & 63]!) + (c === undefined ? "=" : B64[n & 63]!);
  }
  return out;
}

/** Standard base64 (padding optional, but right where it's there) of UTF-8, decoded; null when it isn't. */
function decodeText(v: string): string | null {
  if (!BASE64.test(v)) return null;
  const s = v.replace(/=+$/, ""), pad = v.length - s.length;
  if (s.length % 4 === 1) return null;
  // Padding, when given, fills the last group exactly: two after two characters, one after three.
  if (pad && (v.length % 4 !== 0 || pad !== 4 - (s.length % 4))) return null;
  const bytes: number[] = [];
  let acc = 0, bits = 0;
  for (const ch of s) {
    acc = (acc << 6) | B64.indexOf(ch);
    bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((acc >> bits) & 255); }
  }
  return fromUtf8(bytes);
}

/** Strict UTF-8: null for an invalid, overlong or surrogate sequence. */
function fromUtf8(b: readonly number[]): string | null {
  let out = "";
  for (let i = 0; i < b.length;) {
    const x = b[i]!;
    const n = x < 0x80 ? 0 : x >= 0xc2 && x < 0xe0 ? 1 : x >= 0xe0 && x < 0xf0 ? 2 : x >= 0xf0 && x < 0xf5 ? 3 : -1;
    if (n < 0) return null;
    let cp = n === 0 ? x : x & (0x3f >> n);
    for (let k = 1; k <= n; k++) {
      const c = b[i + k];
      if (c === undefined || (c & 0xc0) !== 0x80) return null;
      cp = (cp << 6) | (c & 0x3f);
    }
    if ((n === 2 && (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff))) || (n === 3 && (cp < 0x10000 || cp > 0x10ffff))) return null;
    out += String.fromCodePoint(cp);
    i += n + 1;
  }
  return out;
}

function utf8(cp: number): number[] {
  if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
  if (cp < 0x80) return [cp];
  if (cp < 0x800) return [0xc0 | (cp >> 6), 0x80 | (cp & 63)];
  if (cp < 0x10000) return [0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
  return [0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 63), 0x80 | ((cp >> 6) & 63), 0x80 | (cp & 63)];
}

function utf8Length(s: string): number {
  let n = 0;
  for (const ch of s) n += utf8(ch.codePointAt(0)!).length;
  return n;
}

const hasControl = (s: string) => /[\u0000-\u001f\u007f-\u009f]/.test(s);

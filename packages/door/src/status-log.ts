import { ActionRefused } from "@ep0ch/outline-core/action-line";
import { readingMs as readingTime } from "@ep0ch/outline-core/reading-time";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { outlineState } from "./state";
import { printable } from "./text";
import { referenceWords } from "./refs";
import { width } from "./style";

/**
 * How long a message stays up so a person can read it, at any width (PIE-1729): a moment to look, then about 14
 * characters a second, at most 30 s (the message log keeps it after). `App.showMessage` keeps each message at least
 * this long; a short one keeps its caller's time. The numbers are outline-core's (reading-time.ts), which the native
 * window's status line reads too; the columns are this door's cells.
 */
export function readingMs(text: string): number {
  return readingTime(width(referenceWords(printable(text, " "))));
}

/** `tile` is the tile's id, what a return to it (enter in the log) addresses; `tileName` its name, what the log says (PIE-1732: never a raw id). */
export interface MessageContext { action?: string; tile?: string; tileName?: string; note?: string }
/**
 * `passing`: a status the screen says too (entering a tile: its hint row reads `reader 1 · writing`), shown in the bar as
 * it fits and never said whole above it, where it would cover a tile's own hint row (PIE-1701).
 * `background`: news of the door's own work that answers no press (an extension reload's "added"): it never replaces a
 * message still up, which answers something the person did (a save's "run it from ^K", PIE-1727); the log keeps it.
 */
export interface MessageDetails extends MessageContext { trace?: string; kind?: "status" | "warning" | "refusal" | "error"; stack?: string; href?: string; passing?: boolean; background?: boolean }
export interface StatusMessage extends MessageContext { id: string; time: string; kind: NonNullable<MessageDetails["kind"]>; message: string }
export function errorDetails(error: unknown): MessageDetails {
  return { kind: error instanceof ActionRefused ? "refusal" : "error", stack: error instanceof Error ? error.stack : new Error(String(error)).stack };
}
/** Keep the cause readable on one terminal row; the stack belongs in the message log. */
export function actionFailure(action: string, error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `could not run ${action}: ${message.split(/\r?\n/, 1)[0]}`;
}
export const messageContext = new AsyncLocalStorage<MessageDetails>();
export const messageLogPath = (dir = outlineState()) => join(dir, "messages.jsonl");
const MAX_BYTES = 1_048_576;

export class StatusLog {
  readonly rows: StatusMessage[] = [];
  /** `message` appended unless it is among the latest rows already: a why read under the pointer, past what the rows above the bar hold, is logged once however often it's drawn (alt+M reads it whole). */
  appendOnce(message: string, details: MessageDetails = {}) { const m = printable(message, " ", { lines: true }); if (!this.rows.slice(-20).some(r => r.message === m)) this.append(message, details); }
  append(message: string, details: MessageDetails = {}) {
    const { stack, passing: _passing, background: _background, ...meta } = { ...messageContext.getStore(), ...details };
    const row: StatusMessage = { id: randomUUID(), time: new Date().toISOString(), kind: "status", ...meta, message: printable(message, " ", { lines: true }) };
    this.rows.push(row);
    if (this.rows.length > 500) this.rows.shift();
    const path = messageLogPath();
    try {
      mkdirSync(outlineState(), { recursive: true, mode: 0o700 });
      const line = JSON.stringify({ ...row, ...(stack ? { stack } : {}) }) + "\n";
      if (existsSync(path) && statSync(path).size + Buffer.byteLength(line) > MAX_BYTES) renameSync(path, path + ".1");
      appendFileSync(path, line, { mode: 0o600 });
    } catch (e) {
      // A full disk must leave the message readable in the session's in-memory log.
      process.stderr.write(`message log: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}

export function readMessageLog(dir: string): string {
  return [messageLogPath(dir) + ".1", messageLogPath(dir)].filter(existsSync).map(p => readFileSync(p, "utf8")).join("");
}

export async function logCommand(args: string[]): Promise<number> {
  const { pickSession } = await import("./session/place");
  const place = await pickSession(args, "log");
  if ("error" in place) { console.error(place.error); return 1; }
  const seen = readMessageLog(place.dir);
  await Bun.write(Bun.stdout, seen);
  if (!args.includes("--follow")) return 0;
  // Keep the last complete record across rotation, so a tail never repeats the old file.
  let last = seen.trimEnd().split("\n").at(-1);
  for (;;) {
    await Bun.sleep(200);
    const lines = readMessageLog(place.dir).trimEnd().split("\n").filter(Boolean);
    const at = last ? lines.lastIndexOf(last) : -1;
    const fresh = lines.slice(at + 1);
    if (fresh.length) { await Bun.write(Bun.stdout, fresh.join("\n") + "\n"); last = fresh.at(-1); }
  }
}

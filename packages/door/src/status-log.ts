import { ActionRefused } from "@ep0ch/outline-core/action-line";
import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { outlineState } from "./state";
import { printable } from "./text";

export interface MessageContext { action?: string; tile?: string; note?: string }
export interface MessageDetails extends MessageContext { kind?: "status" | "warning" | "refusal" | "error"; stack?: string }
export interface StatusMessage extends MessageContext { id: string; time: string; kind: NonNullable<MessageDetails["kind"]>; message: string }
export function errorDetails(error: unknown): MessageDetails {
  return { kind: error instanceof ActionRefused ? "refusal" : "error", stack: error instanceof Error ? error.stack : new Error(String(error)).stack };
}
export const messageContext = new AsyncLocalStorage<MessageDetails>();
export const messageLogPath = (dir = outlineState()) => join(dir, "messages.jsonl");
const MAX_BYTES = 1_048_576;

export class StatusLog {
  readonly rows: StatusMessage[] = [];
  append(message: string, details: MessageDetails = {}) {
    const { stack, ...meta } = { ...messageContext.getStore(), ...details };
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

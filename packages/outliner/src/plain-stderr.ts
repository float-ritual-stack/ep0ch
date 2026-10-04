// Colour only to a terminal. Bun paints console.error and console.warn red, and its report of an uncaught error,
// whenever FORCE_COLOR is set, even into a pipe; Claude Code's shells set it. A refusal another program parses (the
// Claude mod's cards and tools, `door-open`, a test) would then arrive in escape codes, its `error: ` or `ep0ch: `
// unseen. Every CLI whose stderr a program reads calls this first: the outliner's CLI and Herdr opener, and the door's
// `ep0ch` (packages/door/src/main.ts imports it, a declared export).
import { writeSync } from "node:fs";
import { formatWithOptions } from "node:util";

/** Writes all of `text` before returning: a pipe's `process.stderr.write` can be cut short by the `process.exit` after it. */
function writeAll(text: string): void {
  const bytes = Buffer.from(text);
  // A pipe may be non-blocking: a write takes part of the text, or none yet (EAGAIN) while the reader catches up.
  for (let at = 0; at < bytes.length;) {
    try { at += writeSync(2, bytes, at); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EAGAIN") throw error; }
  }
}

/**
 * On a stderr that isn't a terminal, `console.error` and `console.warn` write plain text, and an uncaught error is
 * reported plainly (`error: <message>`, then its stack) with exit 1, as Bun's own report is. A terminal keeps colour.
 * A program with its own handler for that error (the door's, which restores the terminal) keeps it: this one steps
 * aside whenever another is registered.
 */
export function colourOnlyToATerminal(isTerminal = !!process.stderr.isTTY, write: (text: string) => void = writeAll): void {
  if (isTerminal) return;
  const plain = (...args: unknown[]) => { write(`${formatWithOptions({ colors: false }, ...args)}\n`); };
  console.error = plain;
  console.warn = plain;
  const crash = (event: "uncaughtException" | "unhandledRejection") => (error: unknown) => {
    if (process.listenerCount(event) > 1) return;
    // Read by shape, not `instanceof Error`: a thrown object or another realm's error still says its message.
    const { message, stack } = (error ?? {}) as { message?: unknown; stack?: unknown };
    const reason = typeof message === "string" ? message : formatWithOptions({ colors: false }, error);
    const trace = typeof stack === "string" ? stack.split("\n").filter(line => /^\s+at\s/.test(line)).join("\n") : "";
    write(`error: ${reason}\n${trace ? `${trace}\n` : ""}`);
    process.exit(1);
  };
  process.on("uncaughtException", crash("uncaughtException"));
  process.on("unhandledRejection", crash("unhandledRejection"));
}

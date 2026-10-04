// Colour only to a terminal. Bun paints console.error and console.warn red whenever FORCE_COLOR is set, even
// into a pipe, and Claude Code's shells set it, so a refusal another program parses (the Claude mod's cards and
// tools, `door-open`, a test) would arrive wrapped in escape codes. Every CLI entry calls this first with its own
// stderr; it does no I/O of its own.

import { formatWithOptions } from "node:util";

type Stderr = { isTTY?: boolean; write(text: string): unknown };

/** On a stderr that isn't a terminal, make `console.error` and `console.warn` write plain text to it. */
export function colourOnlyToATerminal(stderr: Stderr, target: Console): void {
  if (stderr.isTTY) return;
  const plain = (...args: unknown[]) => { stderr.write(`${formatWithOptions({ colors: false }, ...args)}\n`); };
  target.error = plain;
  target.warn = plain;
}

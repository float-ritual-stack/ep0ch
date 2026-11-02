// The one yes/no a command asks on the terminal (PIE-1293): asked on stderr (the door's stdout is its screen), the
// safe answer the default (`[y/N]`: anything but y or yes is no), and no terminal means no. `ep0ch outline delete`
// and `ep0ch session end` both ask through it.
import { createInterface } from "node:readline/promises";

/** A line read from the terminal, asked on stderr. */
export async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(question); } finally { rl.close(); }
}

/** A yes/no question on the terminal, `[y/N]` added: only y or yes is yes, and no terminal means no. */
export async function cliConfirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  return /^y(es)?$/i.test((await askLine(`${question.replace(/\s*\[y\/N\]\s*$/, "")} [y/N] `)).trim());
}

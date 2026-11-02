// PIE-1173's gate, written (PIE-1293): a hint row, a foot or a keys line names keys from a key table (modeHint,
// partsHint, keysText over an action's own keys), never as a sentence typed in the code. A literal list goes stale
// the first time a key moves (a rebind, a key-clash fix) and says a key the screen no longer takes. This reads the
// door's source and fails on each literal hint, by file and line, with the shared part to use instead.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SRC = join(import.meta.dir, "../src");
/** The showcase's prose and the generated summaries describe keys to a reader; they aren't hint rows. */
const SKIP = /^(showcase|summary)\//;

/** A key as hint rows write one: j k, an arrow pair, ⏎, Esc, Enter, or a modifier chord. */
const KEY = String.raw`(?:\bj k\b|↑↓|↑ ↓|←→|⏎|\b[Ee]sc\b|\bEnter\b|\b(?:ctrl|alt)\+\S)`;
/** A string literal (quotes or a template) holding a key and a ` · ` between two parts: a typed list of keys. */
const LITERAL = new RegExp(String.raw`(["\x60])((?:(?!\1)[^\n\\]|\\.)*?${KEY}(?:(?!\1)[^\n\\]|\\.)* · (?:(?!\1)[^\n\\]|\\.)*)\1`);
/**
 * Messages that say what happened (a flash, a draft's note, a refusal, an action's summary, says or keys, a CLI line)
 * may name a key in passing: they aren't hint rows. An action's `keys` is the action describing itself.
 */
const MESSAGE = /\b(?:flash|refused|refuse|ActionRefused|throw|leaveRefusal|console\.\w+|err)\s*\(|\b(?:summary|says|keys|does|about|description|why)\s*:|\.note\s*=|\bsay\(/;

/**
 * A line that says what happened or what one row does (a draft's note, an exited program's line, a prompt's row) and
 * is not a list of keys carries this comment. Few do; the second test keeps it that way.
 */
const SAYS = "// says, not a hint row";

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

export function literalHints(): string[] {
  const out: string[] = [];
  for (const file of files(SRC)) {
    const rel = relative(SRC, file);
    if (SKIP.test(rel)) continue;
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      const code = line.trim();
      if (code.startsWith("//") || code.startsWith("*") || code.startsWith("/*")) return;
      if (MESSAGE.test(line) || line.includes(SAYS)) return;
      const m = LITERAL.exec(line);
      if (m) out.push(`${rel}:${i + 1}: ${m[2]!.slice(0, 90)}`);
    });
  }
  return out;
}

export function saysLines(): number {
  return files(SRC).reduce((n, f) => n + readFileSync(f, "utf8").split(SAYS).length - 1, 0);
}

test("the lines excused as messages stay few: a hint row is never excused", () => {
  expect(saysLines()).toBeLessThanOrEqual(12);
});

test("no hint row is a literal list of keys: each comes from a key table (modeHint, partsHint, keysText)", () => {
  expect(literalHints()).toEqual([]);
});

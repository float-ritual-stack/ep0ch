// The words `ep0ch` knows (PIE-547): its commands, and the door's own flags. A word it doesn't know is said, with the
// closest one it does, and never opens the door; `--help`, `-h` and `help` print usage (a command's own, when one is
// named) from any position. main.ts asks `checkWords` before anything else runs; each command still parses its own
// flags (outline, session, find…): only the door's are checked here, since the door is what a typo would open.

/** Every first word main.ts runs as a command. */
export const COMMANDS = ["help", "doctor", "install", "try", "find", "show", "export", "where", "session", "peek", "snap", "open",
  "actions", "act", "subscribe", "outline", "status", "init", "clients"] as const;
const KNOWN = new Set<string>(COMMANDS);

/** Commands whose words are data (a search, an id, an action's arguments): `help` there is a word, not a request. */
const FREE_TEXT = new Set(["find", "show", "open", "act", "export", "snap", "try"]);

/**
 * The door's flags (main.ts's USAGE): `value` takes one, `optional` may (`--board [<hub-id>]`), `none` takes none;
 * `rest`: what follows is another's to read (`--remote`'s door flags go to that machine, `--skill`'s to skillCommand).
 */
const DOOR_FLAGS: Record<string, "value" | "optional" | "none" | "rest"> = {
  "--ws": "value", "--machine": "value", "--layout": "value", "--board": "optional",
  "--create": "none", "--no-create": "none", "--here": "none", "--desk": "none", "--river": "none", "--brief": "none", "--welcome": "none",
  "--showcase": "none", "--reset": "none", "--no-daemon": "none", "--daemon": "none",
  "--remote": "rest", "--skill": "rest",
};
const HELP = new Set(["--help", "-h"]);
const LISTS = "ep0ch --help lists them all";

/** Edit distance (Levenshtein). */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** The word of `words` closest to `typed` by edit distance, when it is close (a third of its length, at least 2); else null. */
export function closest(typed: string, words: readonly string[]): string | null {
  let best: string | null = null, bestD = Infinity;
  for (const w of words) { const d = distance(typed, w); if (d < bestD) { best = w; bestD = d; } }
  return best !== null && bestD <= Math.max(2, Math.floor(typed.length / 3)) ? best : null;
}

const noCommand = (word: string) => {
  const near = closest(word, COMMANDS.filter(c => c !== "help"));
  return { error: `no command "${word}"${near ? ` · did you mean: ep0ch ${near}` : ""} · ${LISTS}` };
};

/**
 * What `args` ask before anything runs: null to go on (the door, or a command that parses its own flags); `help` to
 * print usage (`""`: all of it, else that command's); or what's wrong (exit 2). Words after `--` are data. A word with
 * a `/` goes on, for the rule's own refusal (a socket path is named by EP0CH_SOCKET).
 */
export function checkWords(argsIn: readonly string[]): { help: string } | { error: string } | null {
  const end = argsIn.indexOf("--");
  const args = end >= 0 ? argsIn.slice(0, end) : argsIn;
  const first = args[0];
  if (first === "help") {
    const of = args[1];
    if (of !== undefined && !of.startsWith("-") && !KNOWN.has(of)) return noCommand(of);
    return { help: of && !of.startsWith("-") ? of : "" };
  }
  if (first !== undefined && !first.startsWith("-")) {
    if (!KNOWN.has(first)) return first.includes("/") ? null : noCommand(first);
    if (args.some(a => HELP.has(a)) || (args[1] === "help" && !FREE_TEXT.has(first))) return { help: first };
    return null;
  }
  if (args.some(a => HELP.has(a))) return { help: "" };
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!, kind = DOOR_FLAGS[a.startsWith("--no-create=") ? "--no-create" : a];
    if (kind === "rest") return null;
    if (kind === "none") continue;
    if (kind === "value") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("-")) return { error: `${a} needs a value (${a === "--ws" ? "an outline's name" : a === "--machine" ? "an ssh config name" : "a layout's name"}) · ${LISTS}` };
      i++;
      continue;
    }
    if (kind === "optional") { if (args[i + 1] !== undefined && !args[i + 1]!.startsWith("-")) i++; continue; }
    if (a.startsWith("-")) {
      const near = closest(a, Object.keys(DOOR_FLAGS));
      return { error: `no flag "${a}"${near ? ` · did you mean: ${near}` : ""} · ${LISTS}` };
    }
    if (a.includes("/")) continue;
    return { error: `"${a}" isn't a door flag's value, and only a first word is a command · ${LISTS}` };
  }
  return null;
}

/**
 * `usage`'s entries for `command` (each entry is a line starting `  ep0ch ` and the lines indented under it), or all of
 * it for none or a command it has no entry for.
 */
export function usageFor(usage: string, command: string): string {
  if (!command) return usage;
  const entries: string[][] = [];
  for (const line of usage.split("\n")) {
    if (/^ {2}ep0ch /.test(line)) entries.push([line]);
    else if (entries.length && /^ {3,}\S/.test(line)) entries.at(-1)!.push(line);
    else if (entries.length) entries.push([]);
  }
  const head = new RegExp(`(^ {2}ep0ch |\\| )${command.replace(/[^a-z-]/g, "")}\\b`);
  const mine = entries.filter(e => e.length && head.test(e[0]!));
  return mine.length ? mine.map(e => e.join("\n")).join("\n") : usage;
}

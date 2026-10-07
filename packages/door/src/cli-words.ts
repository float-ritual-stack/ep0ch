// The words `ep0ch` knows (PIE-547): its commands, and the door's own flags. A word it doesn't know is said, with the
// closest one it does, and never opens the door; `--help`, `-h` and `help` print usage (a command's own, when one is
// named) from any position. main.ts asks `checkWords` before anything else runs; each command still parses its own
// flags (outline, session, find…): only the door's are checked here, since the door is what a typo would open.

/** Every first word main.ts runs as a command. */
export const COMMANDS = ["help", "doctor", "install", "try", "find", "show", "mcp", "new", "export", "where", "session", "peek", "snap", "open",
  "actions", "act", "subscribe", "outline", "status", "init", "clients", "view", "backup", "library", "revisions"] as const;
const KNOWN = new Set<string>(COMMANDS);

/** Commands whose words are data (a search, an id, an action's arguments): `help` there is a word, not a request. */
const FREE_TEXT = new Set(["find", "show", "new", "open", "act", "export", "snap", "try", "view", "revisions"]);

/**
 * The door's flags (main.ts's USAGE): `value` takes one, `none` takes none; `--screen` takes a name and maybe a
 * target; `rest`: what follows is another's to read (`--remote`'s door flags go to that machine, `--skill`'s to
 * skillCommand).
 */
const DOOR_FLAGS: Record<string, "value" | "none" | "rest" | "screen"> = {
  "--ws": "value", "--machine": "value", "--layout": "value",
  "--create": "none", "--no-create": "none", "--here": "none",
  "--screen": "screen", "--json": "none", "--showcase": "none", "--reset": "none", "--no-daemon": "none", "--daemon": "none",
  "--remote": "rest", "--skill": "rest",
};

/**
 * The landing flags `--screen <name> [<target>]` replaced (one version: no aliases). Each is refused with the exact
 * command; `--board`'s hub is its target.
 */
const RETIRED: Record<string, string> = { "--board": "board", "--desk": "desk", "--river": "river", "--brief": "brief", "--welcome": "welcome" };

/** `--screen <name> [<target>]` in `args`: the name, and the target when one follows (not another flag). */
export function screenArg(args: readonly string[]): { name: string; target?: string } | null {
  const at = args.indexOf("--screen");
  if (at < 0) return null;
  const name = args[at + 1], target = args[at + 2];
  if (name === undefined || name.startsWith("-")) return null;
  return { name, ...(target !== undefined && !target.startsWith("-") ? { target } : {}) };
}
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
    if (RETIRED[a]) {
      const v = args[i + 1], hub = a === "--board" && v !== undefined && !v.startsWith("-") ? ` ${v}` : "";
      return { error: `${a} is gone: ep0ch --screen ${RETIRED[a]}${hub} · --screen <name> [<target>] opens any screen by name` };
    }
    if (kind === "screen") {
      const name = args[i + 1];
      if (name === undefined || name.startsWith("-")) return { error: "--screen needs a screen's name · ep0ch --screen board, ep0ch --screen detail <ep0ch://...> · ep0ch act screen.list names them" };
      i += args[i + 2] !== undefined && !args[i + 2]!.startsWith("-") ? 2 : 1;
      continue;
    }
    if (kind === "none") continue;
    if (kind === "value") {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("-")) return { error: `${a} needs a value (${a === "--ws" ? "an outline's name" : a === "--machine" ? "an ssh config name" : "a layout's name"}) · ${LISTS}` };
      i++;
      continue;
    }
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

/**
 * The door's arguments for `--screen <name> <uri>`: the URI's outline as `--ws`, its machine as `--here` or
 * `--machine` (none when EP0CH_SOCKET names the host outright: a test door's scratch host stays its host), and the
 * block id in place of the URI. A URI never makes an outline (PIE-545's mayCreate): `--no-create`, so one nobody has
 * is refused with the commands, and a `--create` beside it is dropped.
 */
export function screenUriArgs(args: readonly string[], uri: { outline: string; machine: string; blockId: string }, o: { local: boolean; socket: boolean }): string[] {
  const drop = new Set(["--ws", "--machine"]);
  const rest = args.filter((a, i) => a !== "--here" && a !== "--create" && !a.startsWith("--no-create") && !drop.has(a) && !drop.has(args[i - 1] ?? ""));
  const at = rest.indexOf("--screen");
  const where = o.socket ? [] : o.local ? ["--here"] : ["--machine", uri.machine];
  return [...rest.slice(0, at), "--ws", uri.outline, ...where, "--no-create", "--screen", rest[at + 1]!, uri.blockId, ...rest.slice(at + 3)];
}

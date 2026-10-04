// PIE-547: a typo'd `ep0ch` command says so and suggests the right one; it never opens the door. `--help`, `-h` and
// `help` print usage (the subcommand's when one is named) from any position. Run as the person would, without a
// terminal, on a scratch state dir: a door that started anyway would say so on stderr (no outline named here) and
// exit 1, never 2.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { checkWords, closest, COMMANDS } from "../src/cli-words";

const MAIN = join(resolve(import.meta.dir, ".."), "src/main.ts");
const dir = mkdtempSync(join(tmpdir(), "ep0ch-words-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function ep0ch(...args: string[]) {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("EP0CH_")) env[k] = v;
  Object.assign(env, { HOME: dir, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: join(dir, "c.sock"), EP0CH_DAEMON: "0" });
  const r = Bun.spawnSync([process.execPath, MAIN, ...args], { cwd: dir, env, stdin: "ignore" });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe("a word ep0ch doesn't know", () => {
  test("a typo'd command exits 2, opens no door, and names the closest command", () => {
    const r = ep0ch("sessionss");
    expect(r.code).toBe(2);
    expect(r.err).toContain('ep0ch: no command "sessionss" · did you mean: ep0ch session');
    expect(r.err).toContain("ep0ch --help");
    expect(r.out).toBe("");
  });

  test("an unknown command with --help is still an unknown command, and nothing close is said as none", () => {
    for (const args of [["sessionss", "--help"], ["whackadooodle-do", "--help"]]) {
      const r = ep0ch(...args);
      expect(r.code).toBe(2);
      expect(r.err).toContain(`ep0ch: no command "${args[0]}"`);
      expect(r.err).toContain("ep0ch --help lists them all");
    }
    expect(ep0ch("whackadooodle-do").err).not.toContain("did you mean");
  });

  test("an unknown flag is an error with a suggestion; a door flag missing its value says so", () => {
    const r = ep0ch("--dsk");
    expect(r.code).toBe(2);
    expect(r.err).toContain('ep0ch: no flag "--dsk" · did you mean: --desk');
    const stray = ep0ch("--desk", "garden");
    expect(stray.code).toBe(2);
    expect(stray.err).toContain('"garden"');
    const bare = ep0ch("--ws");
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("--ws needs");
  });
});

describe("--help, -h and help, anywhere", () => {
  test("print usage and open no door: the whole of it, or the subcommand's", () => {
    for (const args of [["--help"], ["-h"], ["help"], ["--desk", "--help"], ["--ws", "garden", "-h"]]) {
      const r = ep0ch(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("ep0ch: a BBS door into an outline");
    }
    for (const args of [["session", "--help"], ["session", "end", "-h"], ["help", "session"], ["session", "help"]]) {
      const r = ep0ch(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("ep0ch session list");
      expect(r.out).not.toContain("ep0ch outline list");
    }
    expect(ep0ch("outline", "attach", "fern", "--help").out).toContain("ep0ch outline list");
    expect(ep0ch("act", "--help").out).toContain("act <action>");
  });
});

describe("the rule, without a process", () => {
  test("bare ep0ch and the door's flags go on to the door; subcommands go on to theirs", () => {
    for (const args of [[], ["--ws", "garden"], ["--desk"], ["--board"], ["--board", "hub-1", "--no-daemon"], ["--layout", "daily"],
      ["--machine", "box-a", "--ws", "garden", "--create"], ["--remote", "box-a", "status", "--json"], ["--showcase", "--reset"],
      ["--no-daemon", "--ws", "showcase", "--showcase"], ["--skill", "--all", "ep0ch-core"], ["find", "help"], ["session", "list", "--json"]]) {
      expect(checkWords(args)).toBeNull();
    }
  });
  test("closest: by edit distance, and only when it is close", () => {
    expect(closest("sessionss", ["session", "show", "status"])).toBe("session");
    expect(closest("outlin", ["outline", "open"])).toBe("outline");
    expect(closest("whackadooodle-do", ["session", "show"])).toBeNull();
  });
});

describe("the word lists say what the code reads", () => {
  const src = (f: string) => readFileSync(join(import.meta.dir, "../src", f), "utf8");
  test("every first word main.ts runs is a command, and every command is one main.ts runs", () => {
    const main = src("main.ts");
    const run = new Set([...main.matchAll(/args\[0\] === "([a-z]+)"/g)].map(m => m[1]!));
    for (const m of main.matchAll(/\[((?:"[a-z]+", )*"[a-z]+")\]\.includes\(args\[0\]/g)) for (const w of m[1]!.matchAll(/"([a-z]+)"/g)) run.add(w[1]!);
    run.add("help");   // checkWords answers it itself
    expect([...run].sort()).toEqual([...COMMANDS].sort());
  });
  test("every door flag the door reads is one checkWords knows", () => {
    // The door's own readers: main.ts, discover.ts (which outline), daemon.ts's screenFlags (which screen), the showcase route.
    const flags = new Set([src("main.ts"), src("discover.ts"), src("session/daemon.ts").slice(src("session/daemon.ts").indexOf("export function screenFlags")), src("showcase/route.ts")]
      .flatMap(t => [...t.matchAll(/"(--[a-z-]+)"/g)].map(m => m[1]!)));
    expect(flags.size).toBeGreaterThan(8);
    for (const f of flags) expect(checkWords([f, "x"]) ?? { ok: f }).not.toMatchObject({ error: expect.stringContaining("no flag") });
  });
});

test("ep0ch view order is a command, its ids data; help names its usage", () => {
  expect(checkWords(["view", "order", "PIE-12", "help"])).toBeNull();
  expect(checkWords(["veiw", "order"])).toEqual({ error: expect.stringContaining("did you mean: ep0ch view") });
});

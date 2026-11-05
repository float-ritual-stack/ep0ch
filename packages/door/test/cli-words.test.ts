// PIE-547: a typo'd `ep0ch` command says so and suggests the right one; it never opens the door. `--help`, `-h` and
// `help` print usage (the subcommand's when one is named) from any position. Run as the person would, without a
// terminal, on a scratch state dir: a door that started anyway would say so on stderr (no outline named here) and
// exit 1, never 2.
import { afterAll, describe, expect, test } from "bun:test";
import { createServer } from "node:net";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { readFileSync } from "node:fs";
import { checkWords, closest, COMMANDS, screenUriArgs } from "../src/cli-words";
import { CLI_COMMANDS, SESSION_COMMANDS } from "../src/cli-commands";
import { EXT_FLAGS } from "@ep0ch/outliner/extension-flags";
import { renderHelp } from "../src/cli-help";
import { canonicalLocalMachineName } from "../src/notes-cli";
import { hostRequest } from "../src/socket";
import { ScratchHost } from "./scratch";
import { earlyScreenRefusal } from "../src/screens";

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

describe("--screen never silently does nothing", () => {
  test("a name no screen could have is refused before the showcase starts, with a command that works", () => {
    const r = ep0ch("--showcase", "--screen", "!!!");
    expect(r.code).toBe(2);
    expect(r.err).toContain('no screen "!!!"');
    expect(r.err).toContain("try ep0ch --screen ");
    expect(r.out).not.toContain("door → the showcase");
  }, 60_000);

  test("an extension's screen or a made one is the door's to find, the showcase's too (PIE-1533)", () => {
    // Waiting is an extension's screen; "daily test" is a title a person's screen note may have. Neither is known before
    // the outline is read, so neither is refused here: the door opens it, or says it has none once it has read the outline.
    for (const name of ["waiting", "daily test"]) expect(earlyScreenRefusal(name)).toBeNull();
    expect(earlyScreenRefusal("desk")).toBeNull();
    expect(earlyScreenRefusal("!!!")).toContain('no screen "!!!"');
  });
});

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
    const r = ep0ch("--scren", "desk");
    expect(r.code).toBe(2);
    expect(r.err).toContain('ep0ch: no flag "--scren" · did you mean: --screen');
    const stray = ep0ch("--here", "garden");
    expect(stray.code).toBe(2);
    expect(stray.err).toContain('"garden"');
    const bare = ep0ch("--ws");
    expect(bare.code).toBe(2);
    expect(bare.err).toContain("--ws needs");
  });
});

describe("--help, -h and help, anywhere", () => {
  test("every command tells the person its purpose, flags and two runnable examples", () => {
    for (const command of [...COMMANDS, "launch", ...SESSION_COMMANDS.map(c => `session ${c.name}`)]) {
      const r = ep0ch("help", ...command.split(" "));
      expect(r.code).toBe(0);
      expect(r.out.split("\n")[0], command).toMatch(/^.+ — \S.+/);
      expect(r.out, command).toContain("Usage: ep0ch ");
      expect(r.out, command).toMatch(/Flag\s+What it does/);
      expect(r.out.split("Examples:\n")[1]?.match(/^  ep0ch .+/gm)?.length, command).toBeGreaterThanOrEqual(2);
    }
  }, 60_000);

  test("the detailed rules remain reachable, and session help says where each command acts", () => {
    expect(ep0ch("help", "launch", "--more").out).toContain("EP0CH_LANDING");
    expect(ep0ch("help", "find", "--more").out).toContain("whole UTC day");
    expect(ep0ch("help", "act", "--more").out).toContain("a key written twice a list");
    const sessions = ep0ch("help", "session").out;
    expect(sessions.trimEnd().split("\n").length).toBeLessThanOrEqual(50);
    for (const command of SESSION_COMMANDS) expect(sessions).toContain(command.name);
    expect(ep0ch("help", "session", "list").out).toContain("--machine <ssh-name>");
    expect(sessions).toContain("list --machine lists that machine's sessions");
    expect(ep0ch("help", "ext").out).toContain("ep0ch ext add");
    // What ext remove and update take is the command's own table: help lists every flag it parses (PIE-1548).
    for (const verb of ["remove", "update", "add"] as const) {
      const help = ep0ch("help", "ext", verb).out;
      for (const flag of EXT_FLAGS[verb]) expect(help).toContain(`--${flag.name}`);
    }
  });

  test("shell completion finds commands and session flags through the printed Bash script", () => {
    const script = join(dir, "completion.bash");
    const completion = ep0ch("completions", "bash");
    expect(completion.code).toBe(0);
    writeFileSync(script, `ep0ch() { "${process.execPath}" "${MAIN}" "$@"; }\n${completion.out}\nCOMP_WORDS=(ep0ch session list --mach)\nCOMP_CWORD=3\n_ep0ch_complete\nprintf '%s\\n' "\${COMPREPLY[@]}"\n`);
    const r = Bun.spawnSync(["bash", script], { cwd: dir, env: { ...process.env, EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: join(dir, "c.sock"), EP0CH_OUTLINES: join(dir, "outlines") } });
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("--machine");
    expect(ep0ch("completions", "--", "sess").out).toContain("session");
    expect(ep0ch("completions", "--", "session", "li").out).toContain("list");
    expect(ep0ch("completions", "--", "session", "end", "--mach").out.trim()).toBe("");
  });

  test("print usage and open no door: the whole of it, or the subcommand's", () => {
    for (const args of [["--help"], ["-h"], ["help"], ["--screen", "desk", "--help"], ["--ws", "garden", "-h"]]) {
      const r = ep0ch(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("ep0ch: a BBS door into an outline");
    }
    for (const args of [["session", "--help"], ["help", "session"], ["session", "help"]]) {
      const r = ep0ch(...args);
      expect(r.code).toBe(0);
      expect(r.out).toContain("ep0ch session list");
      expect(r.out).not.toContain("ep0ch outline list");
    }
    expect(ep0ch("session", "end", "-h").out).toBe(ep0ch("help", "session", "end").out);
    expect(ep0ch("outline", "attach", "fern", "--help").out).toContain("outline attach <name>");
    expect(ep0ch("outline", "--help").out).toContain("delete     Move an outline to .deleted/, after asking");
    expect(ep0ch("act", "--help").out).toContain("act <action>");
  }, 60_000);
});

describe("the rule, without a process", () => {
  test("every command describes itself: a summary, two runnable examples and a rules section for --more", () => {
    const paths = CLI_COMMANDS.flatMap(c => [[c.name || "launch", c] as const, ...(c.children ?? []).map(child => [`${c.name} ${child.name}`, child] as const)]);
    expect(paths.length).toBeGreaterThan(CLI_COMMANDS.length + SESSION_COMMANDS.length);
    for (const [path, command] of paths) {
      expect(command.summary.trim(), path).not.toBe("");
      expect(command.examples.length, path).toBe(2);
      for (const example of command.examples) expect(example, path).toMatch(/^ep0ch /);
      // --more reads the command's section of docs/cli.md; a missing or misnamed heading has to fail here, never in use.
      const help = renderHelp(path);
      expect(help.trimEnd().split("\n").length, path).toBeLessThanOrEqual(50);
      for (const line of help.split("\n")) expect(line, path).not.toMatch(/\s$/);
      const more = renderHelp(path, true);
      expect(more, path).toContain(command.summary);
      expect(more.length, path).toBeGreaterThan(renderHelp(path).length);
    }
  });
  test("bare ep0ch and the door's flags go on to the door; subcommands go on to theirs", () => {
    for (const args of [[], ["--ws", "garden"], ["--screen", "desk"], ["--screen", "board"], ["--screen", "board", "hub-1", "--no-daemon"], ["--layout", "daily"],
      ["--screen", "detail", "ep0ch://garden@box-a/b/a1111111-1111-4111-8111-111111111111"], ["--screen", "detail", "((a1111111-1111-4111-8111-111111111111))"],
      ["--screen", "someone-registered"],
      ["--machine", "box-a", "--ws", "garden", "--create"], ["--remote", "box-a", "status", "--json"], ["--showcase", "--reset"],
      ["--no-daemon", "--ws", "showcase", "--showcase"], ["--skill", "--all", "ep0ch-core"], ["find", "help"], ["session", "list", "--json"]]) {
      expect(checkWords(args)).toBeNull();
    }
  });
  test("every subcommand the outline parser accepts is a row of help outline", () => {
    // outlines.ts's parseCommand: `snapshot` has its own branch, the rest are `case "<op>"`; init is `ep0ch init`, its own command.
    const source = readFileSync(join(import.meta.dir, "../src/outlines.ts"), "utf8").split("function parseCommand(")[1]!.split("\n}\n")[0]!;
    const accepted = new Set([...source.matchAll(/case "([a-z]+)"|args\[0\] === "([a-z]+)"/g)].map(m => m[1] ?? m[2]!));
    accepted.delete("init"); accepted.delete("status");
    expect(accepted.size).toBeGreaterThan(8);
    const rows = new Set(CLI_COMMANDS.find(c => c.name === "outline")!.children!.map(c => c.name));
    for (const op of accepted) expect(rows, op).toContain(op);
  });
  test("--screen needs a name; the landing flags it replaced are refused with the exact command", () => {
    const error = (args: string[]) => {
      const r = checkWords(args);
      return r && "error" in r ? r.error : "";
    };
    expect(error(["--screen"])).toContain("--screen needs a screen's name");
    expect(error(["--screen", "--no-daemon"])).toContain("--screen needs a screen's name");
    expect(error(["--board", "hub-1"])).toBe("--board is gone: ep0ch --screen board hub-1 · --screen <name> [<target>] opens any screen by name");
    expect(error(["--board"])).toStartWith("--board is gone: ep0ch --screen board ·");
    for (const name of ["desk", "river", "brief", "welcome"]) expect(error([`--${name}`])).toStartWith(`--${name} is gone: ep0ch --screen ${name} ·`);
  });
  test("--screen <name> <uri> names the URI's outline, never makes it, and keeps a host named outright", () => {
    const uri = { outline: "garden", machine: "box-a", blockId: "a1111111-1111-4111-8111-111111111111" };
    const args = ["--ws", "fern", "--here", "--create", "--screen", "detail", "ep0ch://garden@box-a/b/a1111111-1111-4111-8111-111111111111", "--no-daemon"];
    expect(screenUriArgs(args, uri, { local: false, socket: false }))
      .toEqual(["--ws", "garden", "--machine", "box-a", "--no-create", "--screen", "detail", uri.blockId, "--no-daemon"]);
    expect(screenUriArgs(args, uri, { local: true, socket: false }))
      .toEqual(["--ws", "garden", "--here", "--no-create", "--screen", "detail", uri.blockId, "--no-daemon"]);
    expect(screenUriArgs(args, uri, { local: false, socket: true }))
      .toEqual(["--ws", "garden", "--no-create", "--screen", "detail", uri.blockId, "--no-daemon"]);
  });
  test("closest: by edit distance, and only when it is close", () => {
    expect(closest("sessionss", ["session", "show", "status"])).toBe("session");
    expect(closest("outlin", ["outline", "open"])).toBe("outline");
    expect(closest("whackadooodle-do", ["session", "show"])).toBeNull();
  });
});

describe("the word lists say what the code reads", () => {
  const src = (f: string) => readFileSync(join(import.meta.dir, "../src", f), "utf8");
  test("every door flag the door reads is one checkWords knows", () => {
    // The door's own readers: main.ts, discover.ts (which outline), daemon.ts's screenFlags (which screen), the showcase route.
    const flags = new Set([src("main.ts"), src("discover.ts"), src("session/daemon.ts").slice(src("session/daemon.ts").indexOf("export function screenFlags")), src("showcase/route.ts")]
      .flatMap(t => [...t.matchAll(/"(--[a-z-]+)"/g)].map(m => m[1]!)));
    // --as is act, open and peek's (an agent naming itself), after the command: discover.ts lists it only so its value
    // is never read as a socket path. Before any command it opens a door, which has no --as.
    flags.delete("--as");
    // --more belongs to a help request; it is not a flag for opening the door.
    flags.delete("--more");
    expect(checkWords(["act", "tile.tune", "--as", "loki"])).toBeNull();
    expect(flags.size).toBeGreaterThan(8);
    for (const f of flags) expect(checkWords([f, "x"]) ?? { ok: f }).not.toMatchObject({ error: expect.stringContaining("no flag") });
  });
});

test("ep0ch view order is a command, its ids data; help names its usage", () => {
  expect(checkWords(["view", "order", "PIE-12", "help"])).toBeNull();
  expect(checkWords(["viw", "order"])).toEqual({ error: expect.stringContaining("did you mean: ep0ch view") });
});

describe("--screen with a name nobody knows", () => {
  // A name a screen could have may be a screen note in the outline (PIE-565): the door, once it has read them, refuses it.
  test("one no screen can have is refused before the door starts, with the names there are and the command to try", () => {
    const r = ep0ch("--screen", "!?");
    expect(r.code).toBe(2);
    expect(r.err).toContain('ep0ch: no screen "!?", built in or made (a screen note) · screens: ');
    for (const name of ["board", "desk", "detail", "brief", "welcome", "river"]) expect(r.err).toContain(name);
    expect(r.err).toContain("try ep0ch --screen ");
    expect(r.out).toBe("");
  });
  test("the old landing flags are refused with the exact replacement", () => {
    const r = ep0ch("--board", "hub-1");
    expect(r.code).toBe(2);
    expect(r.err).toContain("ep0ch: --board is gone: ep0ch --screen board hub-1");
  });
});

describe("--screen detail <uri> on a host named by EP0CH_SOCKET", () => {
  test("an outline that host doesn't have is refused with the commands, and nothing is created", async () => {
    const host = new ScratchHost();
    try {
      const sock = await host.start();
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("EP0CH_")) env[k] = v;
      Object.assign(env, host.env, { EP0CH_SOCKET: sock, EP0CH_STATE: join(host.root, "door"), EP0CH_CONTROL: join(host.root, "door", "c.sock"), EP0CH_DAEMON: "0" });
      const uri = `ep0ch://mistyped@${canonicalLocalMachineName()}/b/a1111111-1111-4111-8111-111111111111`;
      const r = Bun.spawnSync([process.execPath, MAIN, "--screen", "detail", uri], { cwd: host.folder("plain"), env, stdin: "ignore" });
      const err = r.stderr.toString();
      expect(r.exitCode).toBe(1);
      expect(err).toContain("has no outline mistyped");
      expect(err).toContain("Nothing was created");
      expect(err).toContain("ep0ch --ws mistyped --create");
      const { outlines } = await hostRequest(sock, "outlines.list");
      expect(outlines.map(o => o.name)).not.toContain("mistyped");
    } finally {
      await host.dispose();
    }
  }, 30_000);
});

// PIE-1230: a script's name is resolved before a command suggestion, so bare `ep0ch neat` runs neat (it is one letter from `new`).
describe("a script's name typed as a command", () => {
  test("a word close to a command, with no slots, is asked of the door as script.run before it is called a typo", async () => {
    const sock = join(dir, "c.sock");
    const seen: any[] = [];
    const server = createServer(c => c.on("data", d => { seen.push(JSON.parse(d.toString().split("\n")[0]!)); c.end(JSON.stringify({ ok: true, result: { message: "neat: done" } }) + "\n"); }));
    await new Promise<void>(r => server.listen(sock, r));
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("EP0CH_")) env[k] = v;
      Object.assign(env, { HOME: dir, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: sock, EP0CH_DAEMON: "0" });
      const p = Bun.spawn([process.execPath, MAIN, "neat"], { cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const code = await p.exited;
      expect({ code, seen: seen.map(r => [r.action, r.args]) }).toEqual({ code: 0, seen: [["script.run", { of: "neat" }]] });
    } finally { server.close(); }
  });
});

// PIE-1230: the CLI's global flags go around a script's name as they go around a command.
describe("a script's name with the global flags", () => {
  const run = async (argv: string[]) => {
    const sock = join(dir, "g.sock");
    const seen: any[] = [];
    const server = createServer(c => c.on("data", d => { seen.push(JSON.parse(d.toString().split("\n")[0]!)); c.end(JSON.stringify({ ok: true, result: { message: "neat: done" } }) + "\n"); }));
    await new Promise<void>(r => server.listen(sock, r));
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("EP0CH_")) env[k] = v;
      Object.assign(env, { HOME: dir, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: sock, EP0CH_DAEMON: "0" });
      const p = Bun.spawn([process.execPath, MAIN, ...argv], { cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const code = await p.exited;
      return { code, err: await new Response(p.stderr).text(), seen: seen.map(r => [r.action, r.args, r.as]) };
    } finally { server.close(); }
  };

  test("--ws, --machine and --as are accepted after the slots and before the name, and are not slots", async () => {
    const want = (as?: string) => ({ code: 0, err: "", seen: [["script.run", { of: "neat", page: "[[a]]" }, as]] });
    expect(await run(["neat", "page=[[a]]", "--ws", "showcase"])).toEqual(want());
    expect(await run(["--ws", "showcase", "neat", "page=[[a]]"])).toEqual(want());
    expect(await run(["--machine", "box", "neat", "page=[[a]]", "--as", "me"])).toEqual(want("me"));
    expect(await run(["neat", "--json", "--ws", "showcase", "page=[[a]]"])).toEqual(want());
  }, 30_000);
});

// PIE-1469: a script run that said steps failed is a refusal in a shell (exit 1, each step on stderr); one that passed exits 0.
describe("a script run's answer as a shell's exit", () => {
  const run = async (result: Record<string, unknown>) => {
    const sock = join(dir, "x.sock");
    const server = createServer(c => c.on("data", () => c.end(JSON.stringify({ ok: true, result }) + "\n")));
    await new Promise<void>(r => server.listen(sock, r));
    try {
      const env: Record<string, string> = {};
      for (const [k, v] of Object.entries(process.env)) if (v !== undefined && !k.startsWith("EP0CH_")) env[k] = v;
      Object.assign(env, { HOME: dir, EP0CH_OUTLINES: join(dir, "outlines"), EP0CH_STATE: join(dir, "state"), EP0CH_CONTROL: sock, EP0CH_DAEMON: "0" });
      const p = Bun.spawn([process.execPath, MAIN, "neat", "page=[[Bike shd]]", "right=%nothing"], { cwd: dir, env, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
      const code = await p.exited;
      return { code, out: await new Response(p.stdout).text(), err: await new Response(p.stderr).text() };
    } finally { server.close(); }
  };

  test("failed steps exit 1 with each one named on stderr, and the answer's text still printed", async () => {
    const message = "neat: 2 steps failed · [[Bike shd]]: no page Bike shd · tile.info: no tile nothing";
    const r = await run({ message, state: "done", failed: ["[[Bike shd]]: no page Bike shd", "tile.info: no tile nothing"] });
    expect(r.code).toBe(1);
    expect(r.err).toBe("ep0ch: 2 steps failed:\n  [[Bike shd]]: no page Bike shd\n  tile.info: no tile nothing\n");
    expect(r.out).toContain(message);
  }, 30_000);

  test("a run whose steps all passed exits 0 with nothing on stderr", async () => {
    const r = await run({ message: "neat: a | b", state: "done" });
    expect({ code: r.code, err: r.err }).toEqual({ code: 0, err: "" });
  }, 30_000);
});

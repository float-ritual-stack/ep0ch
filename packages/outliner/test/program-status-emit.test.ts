import { describe, expect, test } from "bun:test";
import { emitterTo, programStatusEmitter, reportWhile, statusSetting } from "../src/program-status-emit";

const b64 = (s: string) => Buffer.from(s).toString("base64");
const tty = () => { const out: string[] = []; return { out, stream: { isTTY: true, write: (s: string) => out.push(s) } }; };

describe("a program's side of OSC 7501", () => {
  test("EP0CH_PROGRAM_STATUS says it outright; anything else leaves it to the terminal", () => {
    expect(statusSetting({ EP0CH_PROGRAM_STATUS: "1" })).toBe(true);
    expect(statusSetting({ EP0CH_PROGRAM_STATUS: "off" })).toBe(false);
    expect(statusSetting({ EP0CH_PROGRAM_STATUS: "maybe" })).toBeNull();
    expect(statusSetting({})).toBeNull();
  });

  test("nothing goes to what isn't a terminal, or where the setting says no", async () => {
    const { out, stream } = tty();
    expect((await programStatusEmitter("x", { env: { EP0CH_PROGRAM_STATUS: "1" }, out: { write: (s: string) => out.push(s) } })).on).toBe(false);
    expect((await programStatusEmitter("x", { env: { EP0CH_PROGRAM_STATUS: "0" }, out: stream })).on).toBe(false);
    // No Pst (TERM dumb), and not asking: nothing either.
    expect((await programStatusEmitter("x", { env: { TERM: "dumb" }, out: stream, ask: false })).on).toBe(false);
    expect(out).toEqual([]);
  });

  test("every report carries the program's app; the same report twice is sent once", async () => {
    const { out, stream } = tty();
    const e = await programStatusEmitter("ep0ch-install", { env: { EP0CH_PROGRAM_STATUS: "1" }, out: stream });
    e.report({ state: "working", progress: 10, msg: "step 1" });
    e.report({ state: "working", progress: 10, msg: "step 1" });
    e.report({ state: "done", msg: "installed" });
    expect(out).toEqual([`\x1b]7501;state=working:progress=10:app=ep0ch-install:msg=${b64("step 1")}\x1b\\`, `\x1b]7501;state=done:app=ep0ch-install:msg=${b64("installed")}\x1b\\`]);
    emitterTo("a", stream).report({ state: "clear" });
    expect(out.at(-1)).toBe("\x1b]7501;state=clear\x1b\\");
  });

  test("a wait is working while it lasts, cleared when it's done, an error with why when it fails", async () => {
    const { out, stream } = tty();
    const env = { EP0CH_PROGRAM_STATUS: "1" };
    expect(await reportWhile("ep0ch-tree", "waiting for the outline host", async () => 7, { env, out: stream })).toBe(7);
    expect(out).toEqual([`\x1b]7501;state=working:app=ep0ch-tree:msg=${b64("waiting for the outline host")}\x1b\\`, "\x1b]7501;state=clear\x1b\\"]);
    out.length = 0;
    await expect(reportWhile("ep0ch-tree", "waiting", async () => { throw new Error("no host on its socket"); }, { env, out: stream })).rejects.toThrow("no host");
    expect(out.at(-1)).toBe(`\x1b]7501;state=error:app=ep0ch-tree:msg=${b64("no host on its socket")}\x1b\\`);
  });
});

test("the shell scripts' reporter: a report from a script reaches a terminal that speaks it, and nothing else", async () => {
  const script = new URL("../scripts/program-status.ts", import.meta.url).pathname;
  const run = (args: string[], env: Record<string, string>) => Bun.spawnSync([process.execPath, script, ...args], { env: { PATH: process.env.PATH!, ...env }, stdout: "pipe", stderr: "pipe" });
  // Piped, not a terminal: nothing, exit 0 (a status line never fails the script around it).
  const piped = run(["done", "--app", "box-test", "all", "passed"], { EP0CH_PROGRAM_STATUS: "1" });
  expect(piped.exitCode).toBe(0);
  expect(piped.stderr.toString() + piped.stdout.toString()).toBe("");
  expect(run(["--probe"], { EP0CH_PROGRAM_STATUS: "1" }).exitCode).toBe(1);
  expect(run(["paused"], {}).exitCode).toBe(2);
  expect(run(["working", "--progress", "140"], {}).exitCode).toBe(2);
});

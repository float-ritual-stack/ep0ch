// An outline on another machine (EP0CH_MACHINE, a `.ep0ch`'s `machine = "<ssh-name>"`): the outliner's side of the
// forward. The rule is outline-core's `ensureForward` (src/machine.ts there), the same one the door applies; this file
// gives it the outliner's I/O. Every client of a machine's outline (Tree, Detail, the CLI the Claude mod runs) calls
// `forwardFor` before it connects and whenever its connection is gone, so the first one to need the forward starts it
// and the rest share it. EP0CH_SSH names the ssh to run (tests give a fake one).
import { closeSync, mkdirSync, openSync, rmSync, statSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureForward, type Forward, type MachineIO } from "@ep0ch/outline-core/machine";

/** Whether an outline host answers on `socket`: `outlines.list` answered, not only a connect (ssh accepts on a forward's end either way). */
function hostAnswers(socket: string, timeoutMs = 3_000): Promise<boolean> {
  return new Promise(settle => {
    const s = connect(socket);
    let buffer = "";
    const done = (ok: boolean) => { clearTimeout(timer); s.destroy(); settle(ok); };
    const timer = setTimeout(() => done(false), timeoutMs);
    s.setEncoding("utf8");
    s.once("connect", () => s.write(`${JSON.stringify({ id: "forward", action: "outlines.list" })}\n`));
    s.on("data", (chunk: string) => {
      buffer += chunk;
      const newline = buffer.indexOf("\n");
      if (newline < 0) return;
      try { done(JSON.parse(buffer.slice(0, newline)).ok === true); } catch { done(false); }
    });
    s.once("error", () => done(false));
    s.once("close", () => done(false));
  });
}

async function run(argv: string[], timeoutMs: number): Promise<{ code: number; out: string; err: string }> {
  try {
    const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    // `ssh -f` leaves its connection holding these pipes: read until the command exits, not until they close.
    const out = new Response(child.stdout).text(), err = new Response(child.stderr).text();
    const code = await child.exited;
    clearTimeout(timer);
    const settle = (text: Promise<string>) => Promise.race([text, sleep(200).then(() => "")]);
    return { code, out: await settle(out), err: await settle(err) };
  } catch (error) {
    return { code: 127, out: "", err: error instanceof Error ? error.message : String(error) };
  }
}

export const outlinerMachineIO: MachineIO = {
  run,
  answers: socket => hostAnswers(socket),
  privateDir(dir) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const stat = statSync(dir);
    if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
      throw new Error(`${dir} isn't yours alone (it needs mode 700): no forward`);
    }
  },
  remove(path) { rmSync(path, { force: true }); },
  createExclusive(path) {
    try { closeSync(openSync(path, "wx", 0o600)); return true; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
  },
  ageMs(path) { try { return Date.now() - statSync(path).mtimeMs; } catch { return null; } },
  sleep: ms => sleep(ms),
};

/**
 * The machine's forward in `outlines` (the outlines folder the client resolved, whose `.remote/` holds it), answering:
 * found up, or started. Throws with what went wrong and what to do.
 */
export function forwardFor(machine: string, outlines: string, env: NodeJS.ProcessEnv = process.env): Promise<Forward> {
  return ensureForward(machine, { ssh: env.EP0CH_SSH?.trim() || "ssh", outlines, io: outlinerMachineIO });
}

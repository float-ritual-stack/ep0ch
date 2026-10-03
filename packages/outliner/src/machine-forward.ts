// An outline on another machine (EP0CH_MACHINE, a `.ep0ch`'s `machine = "<ssh-name>"`): the Node side of the forward.
// The rule is outline-core's `ensureForward` (src/machine.ts there); this file is the one `MachineIO` it is given, the
// outliner's and the door's (packages/door/src/machine.ts imports it). Every client of a machine's outline (Tree,
// Detail, the CLI the Claude mod runs, the door) starts the forward before it connects and whenever its connection is
// gone, so the first one to need it starts it and the rest share it. EP0CH_SSH names the ssh to run (tests give a
// fake one).
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";
import { ensureForward, type Forward, type ForwardOptions, type MachineIO } from "@ep0ch/outline-core/machine";

/** Whether an outline host answers on `socket`: `outlines.list` answered, not only a connect (ssh accepts on a forward's end either way). */
export function hostAnswers(socket: string, timeoutMs = 3_000): Promise<boolean> {
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

/** The world as the forward rule touches it, for a process with environment `env` (what ssh is run with). */
export function nodeMachineIO(env: NodeJS.ProcessEnv = process.env): MachineIO {
  return {
    async run(argv, timeoutMs, how) {
      try {
        // A detached run (`ssh -f`) leaves its connection behind: it gets none of this process's pipes to hold.
        const io = how?.detached ? "ignore" as const : "pipe" as const;
        const child = Bun.spawn(argv, { stdin: "ignore", stdout: io, stderr: io, env: { ...env } });
        const timer = setTimeout(() => child.kill(), timeoutMs);
        const [out, err, code] = await Promise.all([
          io === "pipe" ? new Response(child.stdout as ReadableStream).text() : "",
          io === "pipe" ? new Response(child.stderr as ReadableStream).text() : "",
          child.exited,
        ]);
        clearTimeout(timer);
        return { code, out, err };
      } catch (error) {
        return { code: 127, out: "", err: error instanceof Error ? error.message : String(error) };
      }
    },
    answers: socket => hostAnswers(socket),
    privateDir(dir) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const stat = statSync(dir);
      if (!stat.isDirectory() || (process.getuid && stat.uid !== process.getuid()) || (stat.mode & 0o077) !== 0) {
        throw new Error(`${dir} isn't yours alone (it needs mode 700): no forward`);
      }
    },
    read(path) { try { return readFileSync(path, "utf8"); } catch { return null; } },
    remove(path) { rmSync(path, { force: true }); },
    createExclusive(path, text) {
      let fd: number;
      try { fd = openSync(path, "wx", 0o600); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error; }
      try { writeSync(fd, text); } finally { closeSync(fd); }
      return true;
    },
    pid: process.pid,
    alive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; } },
    now: () => Date.now(),
    sleep: ms => sleep(ms),
  };
}

/** What `ensureForward` and `forwardState` are given for the outlines folder `outlines` (its `.remote/` holds the forward). */
export function forwardOptions(outlines: string, env: NodeJS.ProcessEnv = process.env): ForwardOptions {
  return { ssh: env.EP0CH_SSH?.trim() || "ssh", outlines, io: nodeMachineIO(env) };
}

/** The machine's forward in `outlines`, answering: found up, or started. Throws with what went wrong and what to do. */
export function forwardFor(machine: string, outlines: string, env: NodeJS.ProcessEnv = process.env): Promise<Forward> {
  return ensureForward(machine, forwardOptions(outlines, env));
}

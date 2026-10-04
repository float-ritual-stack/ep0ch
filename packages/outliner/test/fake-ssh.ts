// A fake ssh for tests, the outliner's and the door's (EP0CH_SSH points at a script that runs this): "another machine" is this one, with its own
// HOME and outlines folder, so a test can run `--machine` and `--remote` end to end against a scratch host without an
// sshd. It does what the door and the outliner ask of ssh, and nothing more:
//
//   ssh [opts] -- <machine> <command>              runs <command> in `sh -c` as the other machine (FAKE_SSH_HOME,
//                                                  FAKE_SSH_OUTLINES, `ep0ch` on PATH from FAKE_SSH_BIN)
//   ssh -f -N -M -S <ctl> … -L <local>:<remote> -- <machine>
//                                                  forwards <local> to <remote> from a process of its own (its pid in
//                                                  <ctl>), once it listens; `StreamLocalBindUnlink` replaces a dead file
//   ssh -S <ctl> -O check|exit -- <machine>       whether that process runs; ending it
//
// Every call is appended to FAKE_SSH_LOG (one JSON argv per line). FAKE_SSH_DOWN=1: every connection fails, as an
// unreachable machine's does (exit 255).
import { appendFileSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { connect, createServer } from "node:net";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { colourOnlyToATerminal } from "@ep0ch/outline-core/plain-stderr";

// ssh writes plain text into a pipe; so does this, whatever FORCE_COLOR says.
colourOnlyToATerminal(process.stderr, console);

const argv = process.argv.slice(2);
// Never the person's machine: "the other machine" is a scratch HOME and outlines folder under the temp dir, or nothing.
const scratch = (p: string | undefined) => !!p && resolve(p).startsWith(resolve(tmpdir()) + "/");
if (argv[0] !== "--serve" && !argv.includes("-O") && !(scratch(process.env.FAKE_SSH_HOME) && scratch(process.env.FAKE_SSH_OUTLINES))) {
  console.error("fake ssh: FAKE_SSH_HOME and FAKE_SSH_OUTLINES must be scratch folders under the temp dir");
  process.exit(255);
}
if (process.env.FAKE_SSH_LOG) appendFileSync(process.env.FAKE_SSH_LOG, JSON.stringify(argv) + "\n");

const opt = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
const sep = argv.indexOf("--");
const machine = sep >= 0 ? argv[sep + 1] : undefined;
const command = sep >= 0 ? argv[sep + 2] : undefined;
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
const pidIn = (ctl: string) => { try { return Number(readFileSync(ctl, "utf8").trim()) || 0; } catch { return 0; } };

if (argv[0] === "--serve") {
  // The forwarding process: <local> <remote> <ctl>.
  const [, local, remote, ctl] = argv as [string, string, string, string];
  rmSync(local, { force: true });
  const server = createServer(c => {
    const r = connect(remote);
    c.pipe(r); r.pipe(c);
    const end = () => { c.destroy(); r.destroy(); };
    c.on("error", end); r.on("error", end); c.on("close", end); r.on("close", end);
  });
  server.listen(local, () => writeFileSync(ctl, String(process.pid)));
  const quit = () => { server.close(); rmSync(local, { force: true }); rmSync(ctl, { force: true }); process.exit(0); };
  process.on("SIGTERM", quit);
  process.on("SIGINT", quit);
} else if (argv.includes("-O")) {
  const ctl = opt("-S")!, op = opt("-O"), pid = pidIn(ctl);
  if (!pid || !alive(pid)) { console.error(`Control socket connect(${ctl}): No such file or directory`); process.exit(255); }
  if (op === "exit") { process.kill(pid, "SIGTERM"); for (let i = 0; i < 50 && alive(pid); i++) await Bun.sleep(20); console.error("Exit request sent."); }
  else console.error(`Master running (pid=${pid})`);
  process.exit(0);
} else if (process.env.FAKE_SSH_DOWN === "1") {
  console.error(`ssh: connect to host ${machine} port 22: Connection refused`);
  process.exit(255);
} else if (argv.includes("-L")) {
  const [local, remote] = opt("-L")!.split(":") as [string, string];
  if (!scratch(remote)) { console.error(`fake ssh: refusing to forward ${remote}, which isn't under the temp dir`); process.exit(255); }
  const ctl = opt("-S")!;
  if (existsSync(ctl)) { console.error(`ControlSocket ${ctl} already exists, disabling multiplexing`); process.exit(255); }
  const child = Bun.spawn([process.execPath, import.meta.path, "--serve", local, remote, ctl], { stdio: ["ignore", "ignore", "ignore"], detached: true } as any);
  child.unref();
  for (let i = 0; i < 250 && !existsSync(ctl); i++) await Bun.sleep(20);
  if (!existsSync(ctl)) { console.error("Error: forwarding didn't start"); process.exit(255); }
  process.exit(0);
} else {
  if (!machine || command === undefined) { console.error("usage: ssh [opts] -- <machine> <command>"); process.exit(255); }
  const env: Record<string, string> = {
    PATH: `${process.env.FAKE_SSH_BIN}:${process.env.PATH}`, HOME: process.env.FAKE_SSH_HOME!, SHELL: "/bin/sh",
    EP0CH_OUTLINES: process.env.FAKE_SSH_OUTLINES!, TERM: process.env.TERM ?? "dumb",
    ...(process.env.FAKE_SSH_STATE ? { EP0CH_STATE: process.env.FAKE_SSH_STATE } : {}),
  };
  const p = Bun.spawn(["sh", "-c", command], { env, stdio: ["inherit", "inherit", "inherit"] });
  process.exit(await p.exited);
}

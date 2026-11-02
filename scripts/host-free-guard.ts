// The agreement tests (scripts/agreement-tests.txt, run by every `bun run check`) only check that two things agree:
// a doc and the code, a key row and its action, a package and its imports. None starts a host or a process. Under
// EP0CH_TEST_HOST_FREE=1 (set by scripts/agreement-tests.ts) a listen on a socket or a spawned process throws here,
// naming the test file, so a file added to the list that starts one fails the check instead of slowing it (PIE-1504).
// Loaded by every package's test preload: one guard, whichever folder the run starts in.
import { Server } from "node:net";
import child from "node:child_process";

if (process.env.EP0CH_TEST_HOST_FREE === "1") {
  const refuse = (what: string) => {
    throw new Error(`${what} in an agreement test (${process.env.EP0CH_TEST_FILE ?? Bun.main}): the files in scripts/agreement-tests.txt start no host and no process; run this one in the focused gate instead`);
  };
  Server.prototype.listen = function () { return refuse("a socket listen"); } as typeof Server.prototype.listen;
  for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"] as const) {
    (child as unknown as Record<string, unknown>)[name] = () => refuse(`a process (${name})`);
  }
  const bun = Bun as unknown as Record<string, unknown>;
  bun.spawn = () => refuse("a process (Bun.spawn)");
  bun.spawnSync = () => refuse("a process (Bun.spawnSync)");
  bun.listen = () => refuse("a socket listen (Bun.listen)");
  bun.serve = () => refuse("a server (Bun.serve)");
}

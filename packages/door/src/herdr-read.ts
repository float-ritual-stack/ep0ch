// Read-only Herdr inspection for ep0ch where. The door owns no agent panes.
export interface Ran { code: number; out: string; err: string }
export type HerdrRun = (args: string[]) => Promise<Ran>;
/** The Herdr inspected by ep0ch where: EP0CH_HERDR_BIN, else `herdr` on PATH; null when there's none. */
export const herdrBin = (env = process.env) => env.EP0CH_HERDR_BIN || Bun.which("herdr");

/** Runs `herdr` commands; one that takes longer than `timeoutMs` (a wedged server) is killed and fails. */
export function herdrRunner(bin: string, timeoutMs = 10_000): HerdrRun {
  return async args => {
    const p = Bun.spawn([bin, ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
    let timer: Timer | undefined;
    const late = new Promise<Ran>(res => {
      timer = setTimeout(() => {
        try { p.kill("SIGKILL"); } catch { /* gone */ }
        res({ code: 124, out: "", err: `herdr ${args.slice(0, 2).join(" ")} didn't answer in ${timeoutMs / 1000}s` });
      }, timeoutMs);
    });
    const ran = Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]).then(([out, err, code]) => ({ code, out, err }));
    try { return await Promise.race([ran, late]); } finally { clearTimeout(timer); }
  };
}


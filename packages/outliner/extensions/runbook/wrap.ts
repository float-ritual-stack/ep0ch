// Runs one command and hands back its exit code and output (escapes and carriage returns out). The step's secrets are
// in its environment; the service scrubs their values from whatever the runbook writes, so nothing here has to.
//   bun wrap.ts <timeoutMs> <command>
const [timeoutArg = "120000", command = ""] = process.argv.slice(2);
const plain = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -\/]*[@-~]/g, "").replace(/\r/g, "");

// Its own session, so a timeout stops the command's children too, not only the shell.
const child = Bun.spawn(["setsid", "sh", "-c", `exec 2>&1; ${command}`], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); } }, Number(timeoutArg));
const drained = new Response(child.stdout).text();
const out = await Promise.race([drained, child.exited.then(() => Bun.sleep(1500)).then(() => drained)]).catch(() => "");
const code = await child.exited;
clearTimeout(timer);
process.stdout.write(JSON.stringify({ exit: timedOut ? 124 : code, timedOut, output: plain(out).slice(-65_536) }));

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
// A command that left something holding its output open is given a moment after it exits, then its output so far is taken.
// That moment is a timer to cancel once the output is in: left pending it kept this process alive 1.5 s after every step.
let grace: ReturnType<typeof setTimeout> | undefined;
let taken = false;
const lingering = child.exited.then(() => new Promise<void>((resolve) => { if (!taken) grace = setTimeout(resolve, 1500); else resolve(); })).then(() => drained);
const out = await Promise.race([drained, lingering]).catch(() => "");
taken = true;
clearTimeout(grace);
const code = await child.exited;
clearTimeout(timer);
clearTimeout(grace);
process.stdout.write(JSON.stringify({ exit: timedOut ? 124 : code, timedOut, output: plain(out).slice(-65_536) }));

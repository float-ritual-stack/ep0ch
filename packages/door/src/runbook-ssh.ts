export {};
// Send the environment after the remote terminal has disabled echo. None of its values is an ssh argument.
const ready = "EP0CH_RUNBOOK_INPUT_READY\n";
const program = `import os,sys,json,termios
fd=0
saved=termios.tcgetattr(fd)
quiet=termios.tcgetattr(fd)
quiet[3] &= ~(termios.ECHO | termios.ICANON)
termios.tcsetattr(fd,termios.TCSANOW,quiet)
os.write(1,b"EP0CH_RUNBOOK_INPUT_READY\\n")
data=b""
while not data.endswith(b"\\n"):
 data += os.read(fd,1)
payload=json.loads(data)
termios.tcsetattr(fd,termios.TCSANOW,saved)
env=dict(os.environ,**payload["env"])
shell=env.get("SHELL","/bin/sh")
os.execvpe(shell,[shell,"-c",payload["command"]],env)`;
const quoted = "'" + program.replaceAll("'", "'\\''") + "'";
const child = Bun.spawn([process.env.EP0CH_SSH || "ssh", "-tt", "--", process.argv[2]!, `python3 -c ${quoted}`], { stdin: "pipe", stdout: "pipe", stderr: "inherit" });
if (process.stdin.isTTY) process.stdin.setRawMode(true);
let pending = "", sent = false;
process.stdin.on("data", data => { child.stdin.write(data); child.stdin.flush(); });
for await (const chunk of child.stdout) {
  if (sent) { process.stdout.write(chunk); continue; }
  pending += Buffer.from(chunk).toString("utf8");
  const normalized = pending.replaceAll("\r\n", "\n"), at = normalized.indexOf(ready);
  if (at < 0) {
    let keep = 0;
    for (let n = 1; n <= Math.min(normalized.length, ready.length); n++) if (ready.startsWith(normalized.slice(-n))) keep = n;
    process.stdout.write(normalized.slice(0, normalized.length - keep));
    pending = normalized.slice(normalized.length - keep);
    continue;
  }
  process.stdout.write(normalized.slice(0, at) + normalized.slice(at + ready.length));
  child.stdin.write(JSON.stringify({ command: process.env.RUNBOOK_COMMAND, env: JSON.parse(process.env.RUNBOOK_ENV!) }) + "\n");
  child.stdin.flush();
  delete process.env.RUNBOOK_ENV; delete process.env.RUNBOOK_COMMAND;
  sent = true;
}
if (!sent) process.stdout.write(pending);
process.exit(await child.exited);

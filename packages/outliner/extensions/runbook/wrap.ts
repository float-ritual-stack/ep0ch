// Runs one command under `with-secrets` and hands back its exit code and output, with the group's values scrubbed.
// It runs INSIDE with-secrets, so the values are in its environment (the names come in argv, never the values), and
// it is the only place that sees both the values and the output: nothing leaves it unscrubbed.
//   with-secrets <group> -- bun wrap.ts <NAME,NAME…> <timeoutMs> <command>
const [names = "", timeoutArg = "120000", command = ""] = process.argv.slice(2);
const values = names.split(",").filter(Boolean).map((name) => process.env[name] ?? "").filter((value) => value.length > 0);
const forms = new Set<string>();
for (const value of values) {
  forms.add(value);
  forms.add(Buffer.from(value).toString("base64"));
  forms.add(encodeURIComponent(value));
}
const scrub = (text: string) => [...forms].sort((a, b) => b.length - a.length).reduce((out, form) => out.split(form).join("[secret]"), text);

const child = Bun.spawn(["sh", "-c", `exec 2>&1; ${command}`], { stdout: "pipe", stderr: "pipe", stdin: "ignore", env: process.env });
let timedOut = false;
const timer = setTimeout(() => { timedOut = true; child.kill("SIGKILL"); }, Number(timeoutArg));
const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
clearTimeout(timer);
process.stdout.write(JSON.stringify({ exit: timedOut ? 124 : code, timedOut, output: scrub(out).slice(-65_536) }));

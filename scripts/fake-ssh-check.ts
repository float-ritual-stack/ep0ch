// Check-ins count forwards; --clean stops only those from the named agent's scratch folders, including older runs.
import { readFileSync, readdirSync } from "node:fs";

const [mode, state, temp] = process.argv.slice(2);
let count = 0, stopped = 0;
for (const entry of readdirSync("/proc")) {
  if (!/^\d+$/.test(entry)) continue;
  try {
    const args = readFileSync(`/proc/${entry}/cmdline`, "utf8").split("\0");
    if (!args.some(arg => arg.endsWith("/fake-ssh.ts")) || !args.includes("--serve")) continue;
    const env = readFileSync(`/proc/${entry}/environ`, "utf8").split("\0");
    count++;
    if (mode === "--clean" && (env.includes(`TMPDIR=${temp}`) || env.includes(`EP0CH_STATE=${state}/state`)
      || env.some(value => value.startsWith(`FAKE_SSH_OWNER_FILE=${temp}/`)))) {
      process.kill(Number(entry), "SIGTERM");
      stopped++;
    }
  } catch (error) {
    if (!["ENOENT", "ESRCH", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
  }
}
console.error(`fake-ssh: ${count} forward(s)${mode === "--clean" ? `; stopped ${stopped} from this agent` : ""}`);
if (count > 10) console.error("LEAK: more than 10 fake-ssh forwards; inspect the owning test runs");
if (mode !== "--clean" && count > 10) process.exitCode = 1;

// Substitute only launchd/systemd: execute the written unit against a real host and SQLite files in the test's home.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [manager, ...args] = process.argv.slice(2);
const home = process.env.HOME!, mac = manager === "launchctl";
const verb = args[0] === "--user" ? args[1] : args[0];
const pidFile = join(home, "host-pid");
const pid = existsSync(pidFile) ? Number(readFileSync(pidFile, "utf8")) : 0;
const alive = () => { try { if (pid) { process.kill(pid, 0); return true; } } catch {} return false; };
if (verb === "print" || verb === "show") {
  if (!alive()) process.exit(1);
  console.log(mac ? `job = {\n\tstate = running\n\tpid = ${pid}\n}` : `ActiveState=active\nSubState=running\nMainPID=${pid}\nExecMainStatus=0`);
  process.exit(0);
}
if (verb === "enable" || verb === "daemon-reload") process.exit(0);
if (existsSync(join(home, "fail"))) { console.error("service manager refused the start"); process.exit(1); }
if (["stop", "bootout", "restart"].includes(verb!) || args.includes("-k")) {
  if (alive()) {
    process.kill(pid, "SIGTERM");
    const end = Date.now() + 5000;
    while (existsSync(join(process.env.EP0CH_OUTLINES!, ".host/host.sock")) && Date.now() < end) await Bun.sleep(20);
  }
  if (verb === "stop" || verb === "bootout") process.exit(0);
} else if (alive()) process.exit(0);

const file = join(home, mac ? "Library/LaunchAgents/io.ep0ch.outliner-host.plist" : ".config/systemd/user/outliner-host.service");
const text = readFileSync(file, "utf8");
const decode = (s: string) => s.replaceAll("&lt;", "<").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const argv = mac
  ? [...text.match(/<key>ProgramArguments<\/key><array>(.*?)<\/array>/s)![1]!.matchAll(/<string>(.*?)<\/string>/g)].map(m => decode(m[1]!))
  : [...text.match(/^ExecStart=(.*)$/m)![1]!.matchAll(/"((?:\\.|[^"\\])*)"/g)].map(m => m[1]!.replace(/\\(.)/g, "$1").replaceAll("%%", "%"));
const env = { ...process.env };
if (mac) {
  const pairs = text.match(/<key>EnvironmentVariables<\/key><dict>(.*?)<\/dict>/s)![1]!;
  for (const m of pairs.matchAll(/<key>(.*?)<\/key><string>(.*?)<\/string>/g)) env[decode(m[1]!)] = decode(m[2]!);
} else {
  for (const m of text.matchAll(/^Environment="([^=]+)=(.*)"$/gm)) env[m[1]!] = m[2]!.replace(/\\(.)/g, "$1").replaceAll("%%", "%");
}
const child = Bun.spawn(argv, { env, cwd: home, stdio: ["ignore", "ignore", Bun.file(join(home, "host.log"))], detached: true });
child.unref();
writeFileSync(pidFile, String(child.pid));

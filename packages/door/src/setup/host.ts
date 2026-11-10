// Installing and starting the local host is shared by install and the first outline opened on a new machine.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { hostLive, hostSocketOf, outlinesDir } from "../discover";
import { hostReady } from "./apply";
import { hostUnit, hostUnitPath, run, unitState } from "./facts";
import { sh } from "./links";
import { detectPlatform, type HostUnit, type Platform } from "./model";
import { hostUnitArgv, hostUnitCommand } from "./plan";
import { plistText, unitWord } from "./service-words";

type Env = Record<string, string | undefined>;
const hostProgram = resolve(import.meta.dir, "../../../outliner/src/host-main.ts");

/** The missing host's service definition; existing units remain owned by their installer. */
/**
 * The unit install would write, or null when it can't: no bun, no service manager, or a file already at that name
 * (`taken`, a fact: another folder's host, or a scratch one; never overwritten). The plan stays off the file system.
 */
export function hostInstall(o: { platform: Platform; home: string; bun: string | null; program: string; outlines: string; path: string; taken?: string | null }) {
  const at = hostUnitPath(o.platform, o.home);
  if (!at || !o.bun || o.taken) return null;
  const mac = o.platform === "macos";
  const { name, path } = at;
  const argv = [o.bun, o.program];
  const log = join(o.home, "Library/Logs/ep0ch-outliner-host.log");
  const text = mac
    ? `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0"><dict><key>Label</key><string>${name}</string><key>ProgramArguments</key><array>${argv.map(a => `<string>${plistText(a)}</string>`).join("")}</array><key>EnvironmentVariables</key><dict><key>EP0CH_OUTLINES</key><string>${plistText(o.outlines)}</string><key>PATH</key><string>${plistText(o.path)}</string></dict><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>StandardErrorPath</key><string>${plistText(log)}</string></dict></plist>\n`
    : `[Unit]\nDescription=ep0ch outline host\n\n[Service]\nExecStart=${argv.map(unitWord).join(" ")}\nEnvironment=${unitWord(`EP0CH_OUTLINES=${o.outlines}`)}\nEnvironment=${unitWord(`PATH=${o.path}`)}\nRestart=on-failure\n\n[Install]\nWantedBy=default.target\n`;
  const unit: HostUnit = { kind: mac ? "launchd" : "systemd", name, path, program: o.program, outlines: o.outlines, stale: [], ...(mac ? { state: { active: false, detail: "not loaded in launchd" } } : {}) };
  const prepare = mac ? [] : [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", name]];
  return { unit, text, log, prepare, commands: [...prepare.map(argv => argv.map(sh).join(" ")), hostUnitCommand(unit, "start")] };
}

async function command(argv: string[], env: Env) {
  const r = await run(argv, { env, timeoutMs: 30_000 });
  if (r.code) throw new Error(`${argv.map(sh).join(" ")}: ${r.err.trim() || r.out.trim() || `exit ${r.code}`} · run ep0ch install --apply`);
}

/** Write the planned unit, then let the platform's service manager own it. */
export async function installHost(install: NonNullable<ReturnType<typeof hostInstall>>, env: Env) {
  mkdirSync(dirname(install.unit.path), { recursive: true });
  if (install.unit.kind === "launchd") mkdirSync(dirname(install.log), { recursive: true });
  writeFileSync(install.unit.path, install.text);
  for (const argv of install.prepare) await command(argv, env);
  await command(hostUnitArgv(install.unit, "start", process.getuid?.() ?? 0), env);
}

/** Recovery for this machine, using the same unit and start command install uses. */
export async function localHostHelp(socket: string, env: Env = process.env): Promise<string> {
  const home = env.HOME || homedir(), platform = detectPlatform(), outlines = outlinesDir(env), unit = hostUnit(platform, home, outlines);
  if (!unit) {
    const other = hostUnit(platform, home, null);
    if (other) {
      const command = ["env", `EP0CH_OUTLINES=${outlines}`, ...(env.XDG_CONFIG_HOME ? [`XDG_CONFIG_HOME=${env.XDG_CONFIG_HOME}`] : []), process.execPath, hostProgram].map(sh).join(" ");
      return `${other.name} already serves another folder · run in another terminal: ${command} · then try again · its folder: ${other.outlines}`;
    }
  }
  const start = unit ? hostUnitCommand({ ...unit, state: await unitState(unit, undefined, env) }, "start") : "ep0ch install --apply";
  return `no outline host · run ${start} · socket ${socket}`;
}

/** Only a local open/create starts a host. A read or a socket naming another host never does. */
export async function ensureLocalHost(socket: string, env: Env = process.env): Promise<void> {
  if (env.EP0CH_SOCKET || socket !== hostSocketOf(env) || await hostLive(socket)) return;
  const home = env.HOME || homedir(), platform = detectPlatform(), outlines = outlinesDir(env);
  let unit = hostUnit(platform, home, outlines);
  if (unit) {
    unit = { ...unit, state: await unitState(unit, undefined, env) };
    await command(hostUnitArgv(unit, "start", process.getuid?.() ?? 0), env);
  } else {
    const at = hostUnitPath(platform, home);
    const install = hostInstall({ platform, home, outlines, bun: process.execPath, program: hostProgram, path: env.PATH ?? "", taken: at && existsSync(at.path) ? at.path : null });
    if (!install) throw new Error(await localHostHelp(socket, env));
    await installHost(install, env);
    unit = install.unit;
  }
  if (!await hostReady({ host: { socket, unit } }, "start", undefined, 10_000, hostLive, undefined, 0))
    throw new Error(await localHostHelp(socket, env));
}

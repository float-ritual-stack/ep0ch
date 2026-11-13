// The disk keeper's place in `ep0ch install` and `ep0ch doctor` (PIE-1787). On Linux, where the settings name a storage
// box (EP0CH_DISK_BOX in ~/.config/ep0ch/disk.env, or given to install), install writes the keeper's timer and the
// weekly sweep's from scripts/disk/ with the backup job's unit writer, puts offload in ~/.local/bin the way it puts
// with-secrets there, and loads both timers. A unit without install's mark is the person's: said, and left alone.
import { shippedScript } from "@ep0ch/outliner/with-secrets";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Platform } from "../setup/model";
import { settingsText, systemdUnitFiles, type UnitFile, unitVars, unitWrites } from "../backup/setup";
import { JOURNALD_CAP, percent } from "./keeper";
import { diskSettingsFile, diskStateDir, readDisk } from "./state";
import { ageSince } from "@ep0ch/outline-core/age";
import { size } from "../setup/progress";

type Env = Record<string, string | undefined>;
type Run = (argv: string[], o: { env?: Env; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>;

export const DISK_UNITS = ["ep0ch-disk.service", "ep0ch-disk.timer", "offload-sweep.service", "offload-sweep.timer"] as const;
export const DISK_TIMERS = ["ep0ch-disk.timer", "offload-sweep.timer"] as const;

export interface DiskSetupFacts {
  platform: Platform;
  /** The storage box's ssh name, from what install was given or the settings file; null: none named, no keeper here. */
  box: string | null;
  settings: { path: string; text: string | null; given: string | null };
  units: UnitFile[];
  offload: ReturnType<typeof shippedScript>;
  /** Both timers active and enabled; null when systemd couldn't be asked. */
  loaded: boolean | null;
  /** journald's SystemMaxUse, where /etc/systemd/journald.conf(.d) sets one. */
  journalCap: string | null;
  stateDir: string;
}

const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };

/** SystemMaxUse from journald.conf and its drop-ins (the last one read wins, as journald reads them). */
export function journalCap(etc = "/etc/systemd"): string | null {
  const files = [join(etc, "journald.conf"), ...(() => { try { return readdirSync(join(etc, "journald.conf.d")).filter(n => n.endsWith(".conf")).sort().map(n => join(etc, "journald.conf.d", n)); } catch { return []; } })()];
  let cap: string | null = null;
  for (const f of files) for (const m of (read(f) ?? "").matchAll(/^\s*SystemMaxUse\s*=\s*(\S+)\s*$/gm)) cap = m[1]!;
  return cap;
}

export async function diskSetupFacts(o: { platform: Platform; home: string; env: Env; bun: string | null; main: string; repoRoot: string; run: Run; etc?: string }): Promise<DiskSetupFacts> {
  const env: Env = { ...o.env, HOME: o.home };
  const path = diskSettingsFile(env);
  const text = read(path);
  const given = env.EP0CH_DISK_BOX?.trim() || null;
  const inFile = text ? (/^\s*(?:export\s+)?EP0CH_DISK_BOX\s*=\s*["']?([^"'\s]+)/m.exec(text)?.[1] ?? null) : null;
  const units = o.platform === "linux" && o.bun ? systemdUnitFiles({ templates: join(o.repoRoot, "scripts/disk"), names: DISK_UNITS, home: o.home, env, vars: unitVars({ bun: o.bun, main: o.main, home: o.home }) }) : [];
  const ask = async (argv: string[]) => (await o.run(argv, { env, timeoutMs: 5000 })).code === 0;
  const loaded = o.platform === "linux"
    ? await Promise.all(DISK_TIMERS.flatMap(t => [ask(["systemctl", "--user", "is-active", t]), ask(["systemctl", "--user", "is-enabled", t])])).then(a => a.every(Boolean), () => null)
    : null;
  return {
    platform: o.platform, box: given ?? inFile, settings: { path, text, given }, units,
    offload: shippedScript("offload", join(o.repoRoot, "scripts/disk/offload"), join(o.home, ".local/bin/offload")),
    loaded, journalCap: o.platform === "linux" ? journalCap(o.etc) : null, stateDir: diskStateDir(env),
  };
}

export interface DiskPlan { status: "do" | "skip" | "manual"; why: string; commands: string[]; writes: { path: string; text: string; mode?: number }[] }

export function diskPlan(f: DiskSetupFacts): DiskPlan {
  if (f.platform !== "linux") return { status: "skip", why: "the disk keeper is a systemd user timer; this machine has none", commands: [], writes: [] };
  if (!f.box) return { status: "skip", why: "no storage box named for cold files here: EP0CH_DISK_BOX=<its ssh name> ep0ch install --apply turns the disk keeper on", commands: [], writes: [] };
  const { writes, foreign } = unitWrites(f.units);
  if (foreign.length) {
    return { status: "manual", why: `${foreign.join(", ")} ${foreign.length === 1 ? "is" : "are"} yours (no "Written by \`ep0ch install\`" line): systemctl --user disable --now ${foreign.map(p => p.slice(p.lastIndexOf("/") + 1)).join(" ")}; mkdir -p ~/backups/units && mv ${foreign.join(" ")} ~/backups/units/ && ep0ch install --apply`, commands: [], writes: [] };
  }
  const all: DiskPlan["writes"] = [...writes];
  if (f.offload.older) all.push({ path: f.offload.installed, text: readFileSync(f.offload.source, "utf8"), mode: 0o755 });
  const settings = settingsText(f.settings.text, { EP0CH_DISK_BOX: f.box }, "# ep0ch disk keeper (PIE-1787): EP0CH_DISK_BOX names the storage box; EP0CH_DISK_SWEEP_AT, EP0CH_DISK_ALERT_AT, EP0CH_DISK_WORSE_AT and EP0CH_DISK_FILL_HOURS move its lines.");
  if (settings.text !== f.settings.text) all.push({ path: f.settings.path, text: settings.text, mode: 0o600 });
  if (!all.length && f.loaded) return { status: "skip", why: `already running: ep0ch-disk.timer every 15 minutes, offload-sweep.timer weekly; cold files go to ${f.box}`, commands: [], writes: [] };
  const said = [...(all.length ? [`write ${all.map(w => w.path).join(", ")}`] : []), ...(f.loaded ? [] : [`load the timers: the keeper looks every 15 minutes and sweeps cold files to ${f.box} past 75%; the sweep also runs weekly`])];
  return { status: "do", why: said.join("; "), commands: loadArgv().map(a => a.join(" ")), writes: all };
}

export const loadArgv = (): string[][] => [["systemctl", "--user", "daemon-reload"], ...DISK_TIMERS.flatMap(t => [["systemctl", "--user", "enable", t], ["systemctl", "--user", "restart", t]])];

export interface DiskCheck { name: string; status: "ok" | "behind" | "missing" | "info"; detail: string; fix?: string }

/** Doctor's disk rows: the keeper as installed, what it last saw, what's open, and journald's cap. */
export function diskChecks(f: DiskSetupFacts, now = Date.now()): DiskCheck[] {
  const out: DiskCheck[] = [];
  const p = diskPlan(f);
  if (f.platform !== "linux") return out;
  out.push(p.status === "skip" ? { name: "disk keeper", status: f.box ? "ok" : "info", detail: p.why } : { name: "disk keeper", status: p.status === "manual" ? "missing" : "behind", detail: p.why, fix: "ep0ch install --apply" });
  const s = readDisk(f.stateDir);
  for (const mount of [...new Set(s.samples.map(x => x.mount))]) {
    const x = s.samples.filter(y => y.mount === mount).at(-1)!;
    const late = now - Date.parse(x.at) > 3_600_000 && f.box;
    out.push({ name: `disk ${mount}`, status: late ? "behind" : "ok", detail: `${percent(x)}% full, ${size(x.avail)} free of ${size(x.size)}; looked ${ageSince(x.at, now, "ago")}${late ? ": the keeper runs every 15 minutes, so it has stopped" : ""}`, ...(late ? { fix: "systemctl --user status ep0ch-disk.timer ep0ch-disk.service; ep0ch disk keep" } : {}) });
  }
  for (const i of s.incidents) out.push({ name: i.title, status: "missing", detail: i.detail, fix: i.fix });
  if (f.box) out.push(f.journalCap
    ? { name: "journald cap", status: "ok", detail: `SystemMaxUse=${f.journalCap}: the system and user journals together` }
    : { name: "journald cap", status: "behind", detail: "no SystemMaxUse: the journal grows to 10% of the disk (the user journal is in the same files; there's no cap of its own)", fix: JOURNALD_CAP });
  return out;
}

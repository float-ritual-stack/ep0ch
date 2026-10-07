// The backup job's place in `ep0ch install` and `ep0ch doctor` (PIE-607). Install writes the job's units from the
// templates in the checkout's scripts/backup/ (a systemd timer on Linux, a launchd agent on macOS) and the settings
// file naming this machine, and loads them. They are install's own: a file it finds without its "Written by `ep0ch
// install`" line is the person's, said and left alone. restic and the secrets are the person's to add: install says
// the commands. Gathering is read-only and needs no network: the units, the settings, `with-secrets --list` (names,
// never values), and the job's own state and alert.
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import type { Platform } from "../setup/model";
import { type Alert, type BackupState, readAlert, readBackupState } from "./alert";
import { backupConfig, configFileOf, type Env, KEPT_SETTINGS, machineNameOf } from "./config";

export const UNIT_MARK = "Written by `ep0ch install`";
export const SYSTEMD_UNITS = ["ep0ch-backup.service", "ep0ch-backup.timer"] as const;
export const LAUNCHD_LABEL = "io.ep0ch.backup";

export interface UnitFile { path: string; want: string; have: string | null }
export interface BackupSetupFacts {
  platform: Platform;
  units: UnitFile[];
  /** systemd: the timer is active; launchd: the agent is loaded. null when it couldn't be asked. */
  loaded: boolean | null;
  /** `named`: the machine's name was given (EP0CH_BACKUP_MACHINE, or the settings file), not taken from the host name. */
  config: {
    path: string; exists: boolean; machine: string; named: boolean; error?: string;
    /** Settings given where install runs (EP0CH_BACKUP_MACHINE, KEPT_SETTINGS): the job reads the file, so they go into it. */
    kept?: Record<string, string>;
    /** The settings file as it is, when there is one. */
    text?: string;
  };
  restic: string | null;
  /** The with-secrets groups there are (names only), or null when with-secrets isn't here. */
  groups: string[] | null;
  secrets: string[];
  /** Whether restic's password comes from the environment instead (RESTIC_PASSWORD…). */
  passwordInEnv: boolean;
  repo: string;
  state: BackupState | null;
  alert: Alert | null;
  stateDir: string;
}

/** A template with its {{NAME}}s filled. */
export const fill = (text: string, vars: Record<string, string>, quote: (v: string) => string = v => v) =>
  text.replace(/\{\{([A-Z]+)\}\}/g, (m, k) => (vars[k] !== undefined ? quote(vars[k]!) : m));

/** A value in a systemd line: % doubled, and quoted when it has a space or a quote. */
export const systemdValue = (v: string) => { const e = v.replace(/%/g, "%%"); return /[\s"'\\]/.test(e) ? `"${e.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : e; };
/** A value in a plist's <string>. */
export const xmlValue = (v: string) => v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The PATH the job runs with: bun's folder, ~/.local/bin (restic, with-secrets), Homebrew's, the system's. */
export const jobPath = (bun: string, home: string) =>
  // (A folder with a space is left out: systemd's Environment= line can't quote one inside the value.)
  [...new Set([dirname(bun), join(home, ".local/bin"), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"])].filter(d => !/\s/.test(d)).join(":");

export function unitFiles(o: { platform: Platform; home: string; bun: string; main: string; repoRoot: string; env: Env }): UnitFile[] {
  const vars = { BUN: o.bun, MAIN: o.main, PATH: jobPath(o.bun, o.home), HOME: o.home };
  const read = (p: string) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
  const templates = join(o.repoRoot, "scripts/backup");
  if (o.platform === "linux") {
    const dir = join(o.env.XDG_CONFIG_HOME || join(o.home, ".config"), "systemd/user");
    return SYSTEMD_UNITS.map(n => ({ path: join(dir, n), want: fill(read(join(templates, n)) ?? "", vars, systemdValue), have: read(join(dir, n)) }));
  }
  if (o.platform === "macos") {
    const path = join(o.home, "Library/LaunchAgents", `${LAUNCHD_LABEL}.plist`);
    return [{ path, want: fill(read(join(templates, `${LAUNCHD_LABEL}.plist`)) ?? "", vars, xmlValue), have: read(path) }];
  }
  return [];
}

export async function backupSetupFacts(o: { platform: Platform; home: string; env: Env; bun: string | null; main: string; repoRoot: string;
  run: (argv: string[], o: { env?: Env; timeoutMs?: number }) => Promise<{ code: number; out: string; err: string }>; which: (n: string) => string | null }): Promise<BackupSetupFacts> {
  const env: Env = { ...o.env, HOME: o.home };
  const c = backupConfig(env);
  const file = configFileOf(env);
  const units = o.bun ? unitFiles({ ...o, bun: o.bun, env }) : [];
  const loaded = o.platform === "linux"
    ? await o.run(["systemctl", "--user", "is-active", "ep0ch-backup.timer"], { timeoutMs: 5000 }).then(r => r.out.trim() === "active" ? true : r.out.trim() ? false : null, () => null)
    : o.platform === "macos"
      ? await o.run(["launchctl", "print", `gui/${process.getuid?.() ?? 0}/${LAUNCHD_LABEL}`], { timeoutMs: 5000 }).then(r => r.code === 0, () => null)
      : null;
  const ws = o.which("with-secrets");
  const groups = ws ? await o.run([ws, "--list"], { env, timeoutMs: 5000 }).then(r => r.code === 0 ? r.out.split("\n").map(l => l.split(/\s+/)[0]!).filter(Boolean) : null, () => null) : null;
  const machine = "error" in c ? (env.EP0CH_BACKUP_MACHINE?.trim() || machineNameOf(hostname())) : c.machine;
  return {
    platform: o.platform, units, loaded,
    config: { path: file, exists: existsSync(file), machine, named: "error" in c ? !!env.EP0CH_BACKUP_MACHINE?.trim() : c.machineFrom !== "hostname", ...("error" in c ? { error: c.error } : {}),
      kept: Object.fromEntries(["EP0CH_BACKUP_MACHINE", ...KEPT_SETTINGS].flatMap(k => (env[k]?.trim() ? [[k, env[k]!.trim()]] : []))),
      ...(existsSync(file) ? { text: (() => { try { return readFileSync(file, "utf8"); } catch { return ""; } })() } : {}) },
    restic: "error" in c ? o.which("restic") : c.restic.includes("/") ? (existsSync(c.restic) ? c.restic : null) : o.which(c.restic),
    groups,
    secrets: "error" in c ? [] : c.secrets,
    passwordInEnv: ["RESTIC_PASSWORD", "RESTIC_PASSWORD_FILE", "RESTIC_PASSWORD_COMMAND"].some(k => env[k]),
    repo: "error" in c ? "" : c.repoOf(c.machine),
    state: "error" in c || !existsSync(join(c.state, "state.json")) ? null : readBackupState(c.state),
    alert: "error" in c ? null : readAlert(c.state),
    stateDir: "error" in c ? "" : c.state,
  };
}

/** What install does for the backups: commands a person could type, and the files it writes. */
export interface BackupPlan {
  status: "do" | "skip" | "manual";
  why: string;
  commands: string[];
  writes: { path: string; text: string }[];
  /** What a person must do first (restic, the secrets): said, never done. */
  missing: string[];
}

const loadCommands = (f: BackupSetupFacts) => f.platform === "linux"
  ? ["systemctl --user daemon-reload", "systemctl --user enable --now ep0ch-backup.timer"]
  : [`launchctl bootout gui/$(id -u)/${LAUNCHD_LABEL} 2>/dev/null; launchctl bootstrap gui/$(id -u) ${f.units[0]?.path ?? ""}`];

export function backupPlan(f: BackupSetupFacts): BackupPlan {
  if (f.platform === "other") return { status: "skip", why: "backups run from a systemd timer or a launchd agent; this platform has neither", commands: [], writes: [], missing: [] };
  if (f.config.error) return { status: "manual", why: f.config.error, commands: [], writes: [], missing: [f.config.error] };
  // The machine's name is what the other machines mirror it by (their EP0CH_BACKUP_MIRRORS, the MCP gateway's
  // <outline>@<machine>), so it's asked for, never taken from the host name silently: a laptop called
  // evans-macbook-pro would back up where float-2, mirroring "laptop", never looks.
  if (!f.config.named) {
    const ask = `name this machine for its backups (other machines mirror it by that name: on float-2, EP0CH_BACKUP_MIRRORS=<name>=<ssh-name>): EP0CH_BACKUP_MACHINE=${f.platform === "macos" ? "laptop" : f.config.machine} ep0ch install --apply`;
    return { status: "manual", why: `first: ${ask}`, commands: [], writes: [], missing: [ask] };
  }
  const missing: string[] = [];
  if (!f.restic) missing.push(`restic isn't installed: ${f.platform === "macos" ? "brew install restic" : "download restic 0.17 or newer into ~/.local/bin (https://github.com/restic/restic/releases)"}`);
  // The timer's runs get restic's keys through with-secrets: a password in this shell's environment doesn't reach them.
  {
    if (!f.groups) missing.push("with-secrets isn't on PATH (~/.local/bin/with-secrets, from the dotfiles); restic gets its keys through it");
    else for (const g of f.secrets.filter(g => !f.groups!.includes(g))) {
      missing.push(g === "restic"
        ? `the secrets group restic (RESTIC_PASSWORD: the same password on every machine, so each can read the others' backups): ${f.platform === "macos"
          ? "scp float-2:.config/secrets/restic.env ~/.config/secrets/restic.env && chmod 600 ~/.config/secrets/restic.env"
          : "printf 'RESTIC_PASSWORD=%s\\n' \"$(openssl rand -base64 30)\" > ~/.config/secrets/restic.env && chmod 600 ~/.config/secrets/restic.env (once, on the first machine; copy it to the others)"}`
        : `the secrets group ${g} (AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY for the bucket): ~/.config/secrets/${g}.env, mode 600`);
    }
  }
  const writes: BackupPlan["writes"] = [];
  const foreign: string[] = [];
  for (const u of f.units) {
    if (u.have === u.want) continue;
    if (u.have !== null && !u.have.includes(UNIT_MARK)) { foreign.push(u.path); continue; }
    writes.push({ path: u.path, text: u.want });
  }
  // The settings file: made with the machine's name, or brought up to what this run was given (a renamed machine:
  // the timer's job reads the file, never the shell install ran in, so a name only in the shell would change nothing).
  const settings = settingsText(f.config.exists ? f.config.text ?? "" : null, { EP0CH_BACKUP_MACHINE: f.config.machine, ...(f.config.kept ?? {}) });
  const changedSettings = settings.changed;
  // Written whenever what it would hold differs from what it holds (an empty file too), not only when a line said so.
  if (!f.config.exists || settings.text !== f.config.text) writes.push({ path: f.config.path, text: settings.text });
  if (foreign.length) missing.push(`${foreign.join(", ")} ${foreign.length === 1 ? "is" : "are"} yours (no "${UNIT_MARK}" line); move ${foreign.length === 1 ? "it" : "them"} away and rerun to let install write ${foreign.length === 1 ? "it" : "them"}`);
  if (missing.length) return { status: "manual", why: `first: ${missing.join("; ")}`, commands: [], writes: [], missing };
  const units = writes.filter(w => w.path !== f.config.path);
  if (!writes.length && f.loaded) return { status: "skip", why: `${f.platform === "linux" ? "ep0ch-backup.timer is active" : `${LAUNCHD_LABEL} is loaded`}; ${f.config.machine} backs up to ${f.repo}`, commands: [], writes: [], missing };
  const said = [...(units.length ? [`${units.length === f.units.length && f.units.every(u => u.have === null) ? "write" : "update"} ${units.map(w => w.path).join(", ")}`] : []),
    ...(!f.config.exists ? [`write ${f.config.path} naming this machine ${f.config.machine} (its backups: ${f.repo})`]
      : changedSettings.length ? [`update ${f.config.path}: ${changedSettings.join(", ")} (the job reads the file; the next run backs up every outline to ${f.repo})`] : []),
    ...(f.loaded ? [] : [`load the ${f.platform === "linux" ? "timer" : "agent"}: every 15 minutes, each outline that changed goes to restic`])];
  return { status: "do", why: said.join("; "), commands: units.length || !f.loaded ? loadCommands(f) : [], writes, missing };
}

/**
 * The settings file with these values set: lines for other keys and comments kept, a key given replaced in place, a new
 * one added. `changed` says what moved in a file that was there (`EP0CH_BACKUP_MACHINE evans-macbook-pro → laptop`);
 * `existing` null: no file yet.
 */
export function settingsText(existing: string | null, set: Record<string, string>): { text: string; changed: string[] } {
  const lines = existing?.trim() ? existing.replace(/\n$/, "").split("\n") : ["# ep0ch backups (PIE-607): this machine's settings; packages/door/src/backup/config.ts lists them."];
  const changed: string[] = [];
  for (const [k, v] of Object.entries(set)) {
    const at = lines.findIndex(l => new RegExp(`^\\s*(?:export\\s+)?${k}\\s*=`).test(l));
    const was = at >= 0 ? lines[at]!.replace(/^[^=]*=\s*/, "").replace(/^(["'])(.*)\1$/, "$2").trim() : null;
    if (was === v) continue;
    if (at >= 0) lines[at] = `${k}=${v}`; else lines.push(`${k}=${v}`);
    if (existing !== null) changed.push(was === null ? `${k}=${v}` : `${k} ${was} → ${v}`);
  }
  return { text: `${lines.join("\n")}\n`, changed };
}

/** The argv install runs to load the units after writing them. */
export function loadArgv(f: BackupSetupFacts, uid: number): string[][] {
  return f.platform === "linux"
    ? [["systemctl", "--user", "daemon-reload"], ["systemctl", "--user", "enable", "--now", "ep0ch-backup.timer"]]
    : [["launchctl", "bootout", `gui/${uid}/${LAUNCHD_LABEL}`], ["launchctl", "bootstrap", `gui/${uid}`, f.units[0]!.path]];
}

type Status = "ok" | "behind" | "missing" | "info" | "unknown";
export interface SetupCheck { name: string; status: Status; detail: string; fix?: string }

/** Doctor's lines for the restic job: its setup, each outline's newest backup, the mirrors, the drill, the alert. */
export function resticChecks(f: BackupSetupFacts, now = Date.now()): SetupCheck[] {
  const out: SetupCheck[] = [];
  const p = backupPlan(f);
  if (f.platform === "other") return [{ name: "restic job", status: "info", detail: p.why }];
  if (p.status === "manual") out.push({ name: "restic job", status: "missing", detail: p.why, fix: `${p.missing.join("; then ")}; then ep0ch install --apply` });
  else if (p.status === "do") out.push({ name: "restic job", status: f.state ? "behind" : "missing", detail: p.why, fix: "ep0ch install --apply" });
  else out.push({ name: "restic job", status: "ok", detail: p.why });
  if (!f.state) { out.push({ name: "restic", status: "info", detail: `no run recorded in ${f.stateDir} yet` }); return out; }
  const s = f.state;
  const hours = (iso: string) => (now - Date.parse(iso)) / 3_600_000;
  const ago = (iso: string) => { const h = hours(iso); return h < 1 ? `${Math.round(h * 60)}m ago` : h < 48 ? `${h.toFixed(1)}h ago` : `${Math.round(h / 24)}d ago`; };
  if (s.lastRun) out.push({ name: "restic last run", status: s.lastRun.ok ? (hours(s.lastRun.at) > 1 ? "behind" : "ok") : "missing",
    detail: `${ago(s.lastRun.at)}: ${s.lastRun.detail}${hours(s.lastRun.at) > 1 ? "; the job runs every 15 minutes, so it has stopped" : ""}`,
    ...(!s.lastRun.ok || hours(s.lastRun.at) > 1 ? { fix: f.platform === "linux" ? "systemctl --user status ep0ch-backup.timer ep0ch-backup.service; ep0ch backup run" : `launchctl print gui/$(id -u)/${LAUNCHD_LABEL}; ep0ch backup run` } : {}) });
  const incidents = new Map((f.alert?.incidents ?? []).map(i => [i.key, i]));
  const machine = f.config.machine;
  for (const [name, o] of Object.entries(s.outlines).sort()) {
    const inc = incidents.get(`outline:${machine}/${name}`);
    const newest = o.at ? `newest snapshot ${ago(o.at)} (change ${o.seq ?? "?"})` : "never snapshotted";
    out.push(inc ? { name: `restic ${name}`, status: "missing", detail: inc.detail, fix: inc.fix }
      : { name: `restic ${name}`, status: "ok", detail: `${newest}${o.pendingSince ? `; changes since ${ago(o.pendingSince)} upload with the next run${o.error ? ` (the last try: ${o.error})` : ""}` : ", as the outline"}` });
  }
  for (const [key, m] of Object.entries(s.mirrors).sort()) {
    const inc = incidents.get(`mirror:${key}`) ?? incidents.get(`pending:${key}`);
    const where = m.folder?.includes("/.restic/") ? `${m.folder} (beside the Litestream follower until it's retired)` : m.folder;
    out.push(inc ? { name: `mirror ${key}`, status: "missing", detail: inc.detail, fix: inc.fix }
      : { name: `mirror ${key}`, status: m.error ? "unknown" : "ok", detail: `${m.at ? `${m.source} copy of ${ago(m.at)} (change ${m.seq ?? "?"})` : "no copy yet"} in ${where}${m.remoteAt ? `; its machine answered ${ago(m.remoteAt)} at change ${m.remoteSeq}` : ""}${m.error ? `; ${m.error}` : ""}` });
  }
  for (const [from, x] of Object.entries(s.sources ?? {}).sort()) {
    if (x.missing) out.push({ name: `mirror ${from}`, status: "info", detail: `${from} has no backups yet (restic/${from}), so nothing is mirrored from it; if it backs up under another name (its ep0ch backup status says which), name it ${from}`,
      fix: `on ${from}: EP0CH_BACKUP_MACHINE=${from} ep0ch install --apply (a machine set up under another name: set EP0CH_BACKUP_MACHINE=${from} in its ~/.config/ep0ch/backup.env, then ep0ch backup run)` });
    else if (x.error && !incidents.has(`source:${from}`)) out.push({ name: `mirror ${from}`, status: "unknown", detail: `can't read ${from}'s backups${x.failingSince ? ` since ${ago(x.failingSince)}` : ""}: ${x.error}` });
    else if (incidents.has(`source:${from}`)) { const i = incidents.get(`source:${from}`)!; out.push({ name: `mirror ${from}`, status: "missing", detail: i.detail, fix: i.fix }); }
  }
  if (s.drill) out.push({ name: "restore drill", status: s.drill.ok ? "ok" : "missing", detail: `${ago(s.drill.at)}: ${s.drill.detail}`, ...(s.drill.ok ? {} : { fix: "ep0ch backup drill" }) });
  // The push channel: Herdr's notification always; ntfy to the phone when its secrets group is there.
  if (f.groups && !f.groups.includes("heartbeat")) out.push({ name: "heartbeat", status: "info", detail: "no dead-man's ping: a job that stops running is only noticed here (the status bar's ? backup); a secrets group heartbeat with HEARTBEAT_URL (a healthchecks.io check, every 15 minutes) pings after each clean run", fix: "printf 'HEARTBEAT_URL=%s\\n' '<your check URL>' > ~/.config/secrets/heartbeat.env && chmod 600 ~/.config/secrets/heartbeat.env" });
  if (f.groups && !f.groups.includes("ntfy")) out.push({ name: "push", status: "info", detail: "stale backups are announced in Herdr and on the door's status bar; for a phone push too, add a secrets group ntfy with NTFY_URL=https://ntfy.sh/<a private topic>", fix: "printf 'NTFY_URL=https://ntfy.sh/%s\\n' \"ep0ch-$(openssl rand -hex 8)\" > ~/.config/secrets/ntfy.env && chmod 600 ~/.config/secrets/ntfy.env (then subscribe to that topic in the ntfy app)" });
  return out;
}

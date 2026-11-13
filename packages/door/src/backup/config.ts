// Where an outline's restic backups go and what this machine does about them (PIE-607). Every machine runs the same
// job (`ep0ch backup run`, every 15 minutes from a systemd timer or a launchd agent that `ep0ch install` writes): it
// snapshots its own outlines that changed into its own restic repository, refreshes the read-only mirrors of other
// machines' outlines from theirs, and checks how fresh all of it is.
//
// The settings are environment variables, read from ~/.config/ep0ch/backup.env first (KEY=value lines; install writes
// it with the machine's name) and then from the environment, which wins:
//
//   EP0CH_BACKUP_MACHINE   this machine's name in the backups (its repository, `<mirrors>/<name>/` elsewhere): laptop
//   EP0CH_BACKUP_REPO      the repository, `{machine}` for the name: s3:https://hel1.your-objectstorage.com/ep0ch/restic/{machine}
//   EP0CH_BACKUP_MIRRORS   other machines whose outlines are mirrored here: laptop, or laptop=<ssh-name> to also ask
//                          its host over ssh how far each outline is (changes no snapshot holds yet are said)
//   EP0CH_BACKUP_SECRETS   the with-secrets groups restic runs with when its password isn't in the environment: hetzner-s3,restic
//   EP0CH_RESTIC           the restic binary (default: restic on PATH)
//   EP0CH_BACKUP_PRUNE_MINUTES   how long the daily prune may run before it's stopped (default 40; the unit allows 50)
//   EP0CH_OUTLINES, EP0CH_MCP_MIRROR_DIR   the outlines and the mirrors, where they aren't the defaults
//   EP0CH_MCP_HUB          the ssh name of the machine whose remote MCP gateway queues writes for this one's outlines
//                          (netmail, PIE-615): each run pulls them and applies them here. Unset: nothing is pulled.
//                          It is also where a snapshot goes when the repository is out of reach (backup/relay.ts)
//
// Secrets never pass through here: restic gets them from `with-secrets <groups> --`, so they reach only restic.
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { existsSync, readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { join, resolve } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { outlinesDir } from "../discover";
import { defaultStateDir } from "../state";

export type Env = Record<string, string | undefined>;

/** The settings install keeps in the file when they're set where it runs: the timer doesn't inherit that shell. */
export const KEPT_SETTINGS = ["EP0CH_BACKUP_REPO", "EP0CH_BACKUP_MIRRORS", "EP0CH_BACKUP_SECRETS", "EP0CH_RESTIC", "EP0CH_OUTLINES", "EP0CH_MCP_MIRROR_DIR", "EP0CH_MCP_MIRRORS", "EP0CH_MCP_HUB"] as const;

/** The bucket, under its own prefix: one repository per machine. */
export const DEFAULT_REPO = "s3:https://hel1.your-objectstorage.com/ep0ch/restic/{machine}";
export const DEFAULT_SECRETS = "hetzner-s3,restic";
/**
 * The gateway machine a Mac pulls its queued MCP writes from, when its settings file names none: install writes it
 * there (the laptop's ssh name for float-2). An empty `EP0CH_MCP_HUB=` line in the file says "none" and stays.
 */
export const DEFAULT_HUB = "float-2";
/** How long systemd lets one run take (`TimeoutStartSec` in scripts/backup/ep0ch-backup.service): the job's deadline. */
export const RUN_LIMIT_MS = 50 * 60_000;
/** The tag every outline snapshot carries; `outline=<name>` and `seq=<change>` say which and how far. */
export const OUTLINE_TAG = "ep0ch-outline";

export interface MirrorSource { machine: string; ssh?: string }

export interface BackupConfig {
  machine: string;
  /** Where the machine's name came from, for doctor. */
  machineFrom: "env" | "file" | "hostname";
  repoOf: (machine: string) => string;
  outlines: string;
  /**
   * The outline host's socket (EP0CH_SOCKET, else `<outlines>/.host/host.sock`): the job asks it for each outline's change
   * and for its copies, and never opens an outline's file (PIE-1750).
   */
  host: string;
  /** The job's own state (state.json) and the alert the door reads (alert.json): `<door state>/backup`. */
  state: string;
  /** `<mirrors>/<machine>/<outline>.sqlite`: the MCP gateway's mirrors (EP0CH_MCP_MIRROR_DIR, else ~/outline-mirrors). */
  mirrorsDir: string;
  /** What this machine follows into `mirrorsDir` (EP0CH_MCP_MIRRORS), as `<outline>@<machine>`. */
  following: string[];
  mirrors: MirrorSource[];
  restic: string;
  /** How long the daily prune may run (EP0CH_BACKUP_PRUNE_MINUTES, default 40 minutes). */
  pruneTimeoutMs: number;
  secrets: string[];
  /** The gateway's machine (its ssh name) this one pulls its queued MCP writes from, if any. */
  hub?: string;
  /** The settings file, read when it's there. */
  file: string;
  env: Env;
}

/** The settings file: `$XDG_CONFIG_HOME/ep0ch/backup.env`. */
export const configFileOf = (env: Env) => join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "ep0ch", "backup.env");

/** A machine's name as the backups say it: a short host name, lowercase. */
export const machineNameOf = (host: string) => host.split(".")[0]!.toLowerCase().replace(/[^a-z0-9-]/g, "-");
export const MACHINE_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;

export function parseMirrors(spec: string): MirrorSource[] | { error: string } {
  const out: MirrorSource[] = [];
  for (const item of spec.split(",").map(s => s.trim()).filter(Boolean)) {
    const [machine, ssh] = item.split("=").map(s => s.trim());
    if (!machine || !MACHINE_NAME.test(machine)) return { error: `EP0CH_BACKUP_MIRRORS: ${JSON.stringify(item)} isn't <machine> or <machine>=<ssh-name> (e.g. laptop=my-laptop)` };
    out.push({ machine, ...(ssh ? { ssh } : {}) });
  }
  return out;
}

export function backupConfig(env: Env = process.env): BackupConfig | { error: string } {
  const home = resolve(env.HOME || homedir());
  const file = configFileOf({ ...env, HOME: home });
  const fromFile = existsSync(file) ? (() => { try { return parseEnvFile(readFileSync(file, "utf8")); } catch { return {}; } })() : {};
  const get = (k: string) => (env[k]?.trim() || fromFile[k]?.trim() || undefined);
  const named = get("EP0CH_BACKUP_MACHINE");
  const machine = named ?? machineNameOf(env.EP0CH_HOSTNAME || hostname());
  if (!MACHINE_NAME.test(machine)) return { error: `EP0CH_BACKUP_MACHINE=${machine} isn't a machine name (lowercase letters, digits and -): set it in ${file}` };
  const mirrors = parseMirrors(get("EP0CH_BACKUP_MIRRORS") ?? "");
  if ("error" in mirrors) return mirrors;
  if (mirrors.some(m => m.machine === machine)) return { error: `EP0CH_BACKUP_MIRRORS names this machine (${machine}); it lists other machines` };
  const repo = get("EP0CH_BACKUP_REPO") ?? DEFAULT_REPO;
  const hub = get("EP0CH_MCP_HUB");
  if (hub && !/^[A-Za-z0-9_][A-Za-z0-9_.@-]*$/.test(hub)) return { error: `EP0CH_MCP_HUB=${hub} isn't an ssh name: set it in ${file}` };
  const outlines = outlinesDir({ EP0CH_OUTLINES: get("EP0CH_OUTLINES"), HOME: home });
  const state = join(env.EP0CH_STATE ?? defaultStateDir({ ...env, HOME: home }), "backup");
  return {
    machine, machineFrom: env.EP0CH_BACKUP_MACHINE?.trim() ? "env" : named ? "file" : "hostname",
    repoOf: m => repo.replaceAll("{machine}", m),
    outlines,
    host: env.EP0CH_SOCKET?.trim() || outlineLayout(outlines).socket,
    state,
    mirrorsDir: resolve(get("EP0CH_MCP_MIRROR_DIR") || join(home, "outline-mirrors")),
    following: (get("EP0CH_MCP_MIRRORS") ?? "").split(",").map(s => s.trim()).filter(Boolean),
    mirrors,
    restic: get("EP0CH_RESTIC") ?? "restic",
    pruneTimeoutMs: (Number(get("EP0CH_BACKUP_PRUNE_MINUTES")) > 0 ? Number(get("EP0CH_BACKUP_PRUNE_MINUTES")) : 40) * 60_000,
    secrets: (get("EP0CH_BACKUP_SECRETS") ?? DEFAULT_SECRETS).split(",").map(s => s.trim()).filter(Boolean),
    ...(hub ? { hub } : {}),
    file,
    env: { ...env, HOME: home },
  };
}

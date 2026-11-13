// Where the disk keeper's settings and state live (PIE-1787), apart from its run so install and doctor read them cheaply.
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { readJson } from "../backup/alert";
import { defaultStateDir } from "../state";
import { type DiskState, emptyDisk } from "./keeper";

type Env = Record<string, string | undefined>;

/** The keeper's settings: ~/.config/ep0ch/disk.env (EP0CH_DISK_BOX names the storage box), under what the environment says. */
export const diskSettingsFile = (env: Env) => join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "ep0ch", "disk.env");
export function diskSettings(env: Env): Env {
  const file = diskSettingsFile(env);
  const fromFile = existsSync(file) ? (() => { try { return parseEnvFile(readFileSync(file, "utf8")); } catch { return {}; } })() : {};
  return { ...fromFile, ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")) };
}

/** Where the keeper keeps disk.json: beside the backup job's alert.json, so doctor and the status bar read one folder. */
export const diskStateDir = (env: Env) => join(env.EP0CH_STATE ?? defaultStateDir(env), "backup");
export const readDisk = (dir: string): DiskState => ({ ...emptyDisk(), ...readJson<DiskState>(join(dir, "disk.json")) });


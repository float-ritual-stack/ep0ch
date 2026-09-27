// Where the door keeps per-user state (last call, desk layout).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const DIR = join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door");

export function readState<T>(name: string): T | null {
  try { return JSON.parse(readFileSync(join(DIR, name), "utf8")) as T; } catch { return null; }
}

export function writeState(name: string, value: unknown): void {
  try { mkdirSync(DIR, { recursive: true }); writeFileSync(join(DIR, name), JSON.stringify(value)); } catch { /* not fatal */ }
}

// Where the door keeps per-user state (last call, desk layout).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Read at call time so scripts (the snapshot harness) can point it elsewhere first.
export const stateDir = () => join(process.env.EP0CH_STATE ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door"));

export function readState<T>(name: string): T | null {
  try { return JSON.parse(readFileSync(join(stateDir(), name), "utf8")) as T; } catch { return null; }
}

export function writeState(name: string, value: unknown): void {
  try { mkdirSync(stateDir(), { recursive: true }); writeFileSync(join(stateDir(), name), JSON.stringify(value)); } catch { /* not fatal */ }
}

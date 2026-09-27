// Where the door keeps per-user state (last call, desk layout).
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Read at call time so scripts (the snapshot harness) can point it elsewhere first.
const dir = () => join(process.env.EP0CH_STATE ?? join(process.env.XDG_STATE_HOME ?? join(process.env.HOME!, ".local/state"), "ep0ch-door"));

export function readState<T>(name: string): T | null {
  try { return JSON.parse(readFileSync(join(dir(), name), "utf8")) as T; } catch { return null; }
}

export function writeState(name: string, value: unknown): void {
  try { mkdirSync(dir(), { recursive: true }); writeFileSync(join(dir(), name), JSON.stringify(value)); } catch { /* not fatal */ }
}

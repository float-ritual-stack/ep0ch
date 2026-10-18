// The files that say who can reach what on one machine (PIE-1034, PIE-1037): the gateway's caps (`EP0CH_MCP_PATH_ACCESS`
// in `~/.config/ep0ch/mcp.env`) and its usage records (`<state>/mcp-usage/<day>.jsonl`). The MCP gateway writes them on
// the machine it runs on, so only that machine's host can read them; the host answers `mcp.access.files` with them and
// the door's access view reads them from the host of the machine that serves the gateway, whichever machine its own
// terminal is on. The door's `ep0ch mcp usage` and the gateway's cap reader use the same functions here, never a copy.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { canonicalLocalMachineName } from "./machine-name";
import { parseEnvFile } from "./env-file";

export const CAP_KEY = "EP0CH_MCP_PATH_ACCESS";
const DAY = 86_400_000;
/** The window the matrix counts calls in. */
export const MATRIX_DAYS = 7;

/** The file the MCP settings are read from: `~/.config/ep0ch/mcp.env` (under `XDG_CONFIG_HOME` when that is set). */
export const mcpEnvFile = (env: Record<string, string | undefined>): string =>
  join(env.XDG_CONFIG_HOME || join(env.HOME || homedir(), ".config"), "ep0ch", "mcp.env");

/** An MCP setting: the environment's, else `mcp.env`'s. */
export function mcpSetting(env: Record<string, string | undefined>, key: string): string | undefined {
  const value = env[key];
  if (value !== undefined) return value;
  try {
    const file = mcpEnvFile(env);
    return existsSync(file) ? parseEnvFile(readFileSync(file, "utf8"))[key] : undefined;
  } catch { return undefined; }
}

/** The door's state directory as the door resolves it (`EP0CH_STATE`, else `$XDG_STATE_HOME/ep0ch-door`): where usage is recorded. */
export const mcpUsageDir = (env: Record<string, string | undefined> = process.env): string =>
  join(env.EP0CH_STATE ?? join(env.XDG_STATE_HOME ?? join(env.HOME || homedir(), ".local/state"), "ep0ch-door"), "mcp-usage");

/** The usage records of the last `since` milliseconds in `dir`, oldest file first. */
export function readUsageRows<T extends { time: string }>(since: number, now: number, dir: string): { rows: T[]; cutoff: string; dir: string } {
  const cutoff = new Date(now - since).toISOString();
  let files: string[];
  try { files = readdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; files = []; }
  const rows: T[] = [];
  for (const file of files.sort()) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && file.slice(0, 10) >= cutoff.slice(0, 10)) {
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) if (line) {
      const row: T = JSON.parse(line);
      if (row.time >= cutoff) rows.push(row);
    }
  }
  return { rows, cutoff, dir };
}

/** The cap settings and where they came from. */
export function capSettings(env: Record<string, string | undefined> = process.env): { spec: string; from: "environment" | "file" | "none"; file: string } {
  const file = mcpEnvFile(env), spec = mcpSetting(env, CAP_KEY);
  return { spec: spec ?? "", from: spec === undefined ? "none" : env[CAP_KEY] !== undefined ? "environment" : "file", file };
}

/** What a usage record gives the matrix: when, who, and which outline (never the tool, its shape or its sizes). */
export interface UsageFact { time: string; actor: string; outline: string | null }

/** `mcp.access.files`: this machine's caps and the last week's usage, as the host reads them. */
export interface McpAccessFiles {
  machine: string;
  caps: ReturnType<typeof capSettings>;
  usage: { rows: UsageFact[]; dir: string; days: number };
}

/** `env` says where the caps are (a demo's own folder); the usage is the process's, in `usage` (the host's, or a door's state). */
export function readMcpAccessFiles(env: Record<string, string | undefined> = process.env, now = Date.now(), usage: string = mcpUsageDir()): McpAccessFiles {
  const { rows, dir } = readUsageRows<UsageFact>(MATRIX_DAYS * DAY, now, usage);
  return { machine: canonicalLocalMachineName(), caps: capSettings(env), usage: { rows: rows.map(r => ({ time: r.time, actor: r.actor, outline: r.outline })), dir, days: MATRIX_DAYS } };
}

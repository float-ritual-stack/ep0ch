// The backup job's netmail part (PIE-615): the one loop every machine runs every 15 minutes also carries the remote
// MCP gateway's queued writes (src/mcp-netmail.ts).
//
//   on the gateway's machine   each other machine's queue (how many wait, the oldest, its last pull) into the job's
//                              state, beside when that machine was last seen online, for doctor, status and the alert
//   on a home machine          with EP0CH_MCP_HUB set, a pull: its queued writes taken from the hub over ssh, applied to
//                              its own outlines, and what each became told back
import { type BackupState, type NetmailState } from "./alert";
import { backupConfig, type BackupConfig, type Env } from "./config";
import { takeLock } from "./jobs";
import { netmailFile, pullNetmail, readSummaries, type PullResult } from "../mcp-netmail";
import type { NotesBoard } from "../notes-cli";

type Say = (line: string) => void;

/** The newest sign a machine was online: its mirrors' newest snapshot or sqlite3_rsync copy, an ssh answer, a pull. */
function lastSeen(s: BackupState, machine: string, lastPull: string | null): string | null {
  const signs = [lastPull, ...Object.entries(s.mirrors).filter(([k]) => k.startsWith(`${machine}/`)).flatMap(([, m]) => [m.at, m.remoteAt])]
    .filter((x): x is string => !!x);
  return signs.sort().at(-1) ?? null;
}

/** The queues this machine holds for others, read into the job's state. */
export function readQueues(c: BackupConfig, s: BackupState): NetmailState["queues"] {
  const queues: NonNullable<NetmailState["queues"]> = {};
  for (const q of readSummaries(netmailFile(c.env))) queues[q.machine] = { waiting: q.waiting, oldest: q.oldest, lastPull: q.lastPull, lastSeen: lastSeen(s, q.machine, q.lastPull) };
  return queues;
}

/** One pull, recorded in the job's state (a failure since when, for the alert). */
export async function pull(c: BackupConfig, s: BackupState, o: { now?: () => number; say?: Say; open?: (outline: string) => Promise<NotesBoard | { error: string }> } = {}): Promise<PullResult | null> {
  if (!c.hub) return null;
  const now = o.now ?? Date.now;
  const r = await pullNetmail({ hub: c.hub, machine: c.machine, state: c.state, env: c.env, now, ...(o.say ? { say: o.say } : {}), ...(o.open ? { open: o.open } : {}) });
  const at = new Date(now()).toISOString(), was = s.netmail?.pull;
  s.netmail = { ...s.netmail, pull: { hub: c.hub, at, ok: r.ok, detail: r.detail, ...(r.ok ? {} : { failingSince: was && !was.ok && was.failingSince ? was.failingSince : at }) } };
  return r;
}

/** The job's netmail part: the queues held here, then this machine's own pull. Each stands alone. */
export async function netmailStep(c: BackupConfig, s: BackupState, o: { now?: () => number; say?: Say } = {}): Promise<void> {
  const say = o.say ?? (() => {});
  try {
    const queues = readQueues(c, s);
    s.netmail = { ...s.netmail, queues };
    for (const [m, q] of Object.entries(queues ?? {})) if (q.waiting) say(`netmail: ${q.waiting} queued for ${m} since ${q.oldest} (its last pull: ${q.lastPull ?? "never"})`);
  } catch (e) { say(`✗ netmail queues: ${(e as Error).message}`); }
  const r = await pull(c, s, o).catch(e => { say(`✗ netmail pull: ${(e as Error).message}`); return null; });
  if (r && (r.taken || !r.ok)) say(`${r.ok ? "✓" : "✗"} netmail from ${c.hub}: ${r.detail}`);
}

/** `ep0ch mcp pull [--from <ssh-name>]`: one pull now, as the job's run does it (one at a time). */
export async function pullCommand(args: readonly string[], io: { out: Say; err: Say }, env: Env = process.env): Promise<number> {
  const i = args.indexOf("--from");
  const from = i >= 0 ? args[i + 1] : undefined;
  if (i >= 0 && (!from || from.startsWith("-"))) { io.err("ep0ch mcp pull: --from needs the gateway machine's ssh name"); return 2; }
  const c = backupConfig(from ? { ...env, EP0CH_MCP_HUB: from } : env);
  if ("error" in c) { io.err(`ep0ch mcp pull: ${c.error}`); return 2; }
  if (!c.hub) { io.err(`ep0ch mcp pull: no gateway to pull from; pass --from <its ssh name>, or set EP0CH_MCP_HUB=<its ssh name> in ${c.file} so the backup job pulls every run`); return 2; }
  const release = takeLock(c);
  if (typeof release === "string") { io.err(`ep0ch mcp pull: ${release}`); return 1; }
  try {
    const { readBackupState, writeBackupState } = await import("./alert");
    const s = readBackupState(c.state);
    const r = await pull(c, s, { say: io.out });
    writeBackupState(c.state, s);
    io.out(`${r!.ok ? "✓" : "✗"} ${c.machine} ← ${c.hub}: ${r!.detail}`);
    return r!.ok ? 0 : 1;
  } finally { release(); }
}

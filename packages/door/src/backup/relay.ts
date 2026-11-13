// The backup relay (PIE-645, ADR 0009): when a machine can't reach the restic repository (the laptop on a work VPN that
// blocks Hetzner object storage), its backup job hands each outline's archived log to the hub over the ssh path the
// netmail pull uses (EP0CH_MCP_HUB, float-2). The hub, which can reach the bucket, adds what its own archive of that
// machine's outline lacks (never over a log that differs) and uploads it to that machine's repository on its behalf.
//
//   sender    the outline's archive of its current log (log-archive.ts `archivedRanges`), one range a line, streamed
//             over ssh to `ep0ch backup receive` in a login shell; no scp: it travels on the ssh command's stdin
//   receiver  `ep0ch backup receive --machine <m> --outline <n> --sha256 H` with the ranges on stdin: into a private
//             incoming folder, checked (sha256, one log, meeting the archive), appended to `<state>/log/<m>/<n>/`, then
//             the upload (restic with `--host <m>`, then retention)
//
// Secrets stay on each machine: the hub uses its own keys for the upload; nothing here reads or prints them.
import type { DrillTimes } from "./jobs";
import { chmodSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { LogRange } from "@ep0ch/outliner/change-log";
import { appendToArchive, archivedRanges } from "@ep0ch/outliner/log-archive";
import { lastJson, ssh } from "../mcp-netmail";
import { type BackupConfig, MACHINE_NAME } from "./config";
import { archiveRoot, ensureRepo, takeLock } from "./jobs";
import { backupFolder, forget, OUTLINE_NAME } from "./restic";

/** The hub's answer to a relayed log. */
export interface Received {
  ok: boolean;
  /** The newest entry the hub's archive holds now. */
  lsn?: number;
  /** The snapshot the hub made in the machine's repository, or why it couldn't. */
  snapshot?: string;
  uploadError?: string;
  error?: string;
}

/** Why a repository can't be reached, asked quickly (no answer from its host within `timeoutMs`), or null. Only s3: repositories are probed. */
export async function unreachable(repo: string, timeoutMs = 8_000): Promise<string | null> {
  const m = /^s3:(https?:\/\/)?([^/]+)/.exec(repo);
  if (!m) return null;
  try { await fetch(`${m[1] ?? "https://"}${m[2]}`, { method: "HEAD", signal: AbortSignal.timeout(timeoutMs) }); return null; }
  catch (e) { return `${m[2]} doesn't answer (${(e as Error).name === "TimeoutError" ? `no reply in ${Math.round(timeoutMs / 1000)}s` : (e as Error).message.split("\n")[0]})`; }
}

const sha256 = (bytes: Uint8Array | string) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

/** One outline's archived log sent to the hub; what the hub made of it. */
export async function relay(c: BackupConfig, hub: string, o: { outline: string; logId: string; schema: number; root: string; timeoutMs?: number }): Promise<Received> {
  if (!OUTLINE_NAME.test(o.outline)) return { ok: false, error: `${o.outline} isn't an outline name` };
  if (!MACHINE_NAME.test(c.machine)) return { ok: false, error: "the relay's arguments aren't plain names" };
  // Read once: the checksum is of exactly the bytes sent.
  const text = archivedRanges(o.root, o.outline, o.logId).map(r => JSON.stringify(r)).join("\n") + "\n";
  const bytes = new TextEncoder().encode(text);
  const r = await ssh(c.env, hub, `ep0ch backup receive --machine ${c.machine} --outline ${o.outline} --sha256 ${sha256(bytes)}`, new Blob([bytes]), o.timeoutMs ?? 600_000).catch(e => ({ code: 255, out: "", err: (e as Error).message }));
  try { return lastJson(r.out) as Received; } catch { /* no answer from the command itself */ }
  const why = r.code === 255 ? `${hub} doesn't answer over ssh` : r.code === 127 || /not found/.test(r.err) ? `${hub} has no ep0ch on a login shell's PATH` : `ep0ch backup receive on ${hub} failed (${r.code}): ${r.err.trim().split("\n").at(-1) ?? ""}`;
  return { ok: false, error: why };
}

/**
 * The restore drill on the hub, for this machine (PIE-810): `ep0ch backup drill --machine <this> --json` there restores
 * this machine's snapshots from its repository, which the hub can reach. Its answer, or why there is none.
 */
export async function drillVia(c: BackupConfig, hub: string, timeoutMs = 900_000, serve = false): Promise<{ ok: boolean; detail: string; served?: DrillTimes[]; repo?: string; machine?: string } | { error: string; unreachable: boolean }> {
  if (!MACHINE_NAME.test(c.machine)) return { error: `${c.machine} isn't a machine name`, unreachable: false };
  const r = await ssh(c.env, hub, `ep0ch backup drill --machine ${c.machine} --json${serve ? " --serve" : ""}`, undefined, timeoutMs).catch(e => ({ code: 255, out: "", err: (e as Error).message }));
  try {
    const d = lastJson(r.out) as { ok?: unknown; detail?: unknown; error?: unknown; served?: unknown; repo?: unknown; machine?: unknown };
    if (typeof d.error === "string") return { error: `${hub} couldn't drill it: ${d.error}`, unreachable: false };
    // A served drill's times and what it covered come back with it (Codex on #1502), so the gate can read them.
    if (typeof d.ok === "boolean" && typeof d.detail === "string") return { ok: d.ok, detail: d.detail, ...(serve && Array.isArray(d.served) && typeof d.repo === "string" && typeof d.machine === "string" ? { served: d.served as DrillTimes[], repo: d.repo, machine: d.machine } : {}) };
  } catch { /* no answer from the command itself */ }
  // Only a hub that doesn't answer is a wait; one that answers and fails is a failed drill (an incident).
  return r.code === 255 ? { error: `${hub} doesn't answer over ssh`, unreachable: true }
    : { error: `ep0ch backup drill on ${hub} failed (${r.code}): ${r.err.trim().split("\n").at(-1) ?? ""}`, unreachable: false };
}

/** The hub's incoming folder for a machine's copies: private, in the job's state. */
export const incomingDir = (c: BackupConfig, machine: string) => join(c.state, "incoming", machine);

/** Waits for the backup job's lock (a relay arrives while the hub's own run may hold it). */
async function lockFor(c: BackupConfig, waitMs: number): Promise<(() => void) | string> {
  const until = Date.now() + waitMs;
  for (;;) {
    const got = takeLock(c);
    if (typeof got !== "string" || Date.now() >= until) return got;
    await Bun.sleep(Math.min(2_000, Math.max(50, waitMs / 10)));
  }
}

/**
 * The receiving side: ranges at `part` (already written under `incomingDir`), claimed to be `outline`'s log on
 * `machine`. Checked, added to this machine's archive of it, uploaded to `machine`'s repository.
 */
export async function receive(c: BackupConfig, o: { machine: string; outline: string; sha256?: string; part: string; lockWaitMs?: number }): Promise<Received> {
  if (!MACHINE_NAME.test(o.machine) || o.machine === c.machine) return { ok: false, error: `${o.machine} isn't another machine's name` };
  if (!c.mirrors.some(m => m.machine === o.machine)) return { ok: false, error: `${c.machine} doesn't take ${o.machine}'s relays: add it to EP0CH_BACKUP_MIRRORS in ${c.file}` };
  if (!OUTLINE_NAME.test(o.outline)) return { ok: false, error: `${o.outline} isn't an outline name` };
  const text = readFileSync(o.part, "utf8");
  if (o.sha256 && sha256(text) !== o.sha256) return { ok: false, error: "the log arrived damaged (sha256 differs); the next run sends it again" };
  let ranges: LogRange[];
  try { ranges = text.split("\n").filter(Boolean).map(l => JSON.parse(l) as LogRange); }
  catch { return { ok: false, error: "the log that arrived isn't one range a line" }; }
  if (!ranges.length) return { ok: false, error: "no log arrived" };
  if (ranges.some(r => r.logId !== ranges[0]!.logId || !Array.isArray(r.entries))) return { ok: false, error: "the ranges that arrived aren't of one log" };
  const release = await lockFor(c, o.lockWaitMs ?? 90_000);
  if (typeof release === "string") return { ok: false, error: `${release}; the next run sends it again` };
  try {
    const root = archiveRoot(c, o.machine);
    let lsn: number;
    try { lsn = appendToArchive(root, o.outline, ranges).lsn; } catch (e) { return { ok: false, error: (e as Error).message }; }
    // The upload, for the machine that can't make it: its repository, its host name, then its retention.
    const repo = c.repoOf(o.machine);
    const problem = await ensureRepo(c, repo, () => {});
    if (problem) return { ok: true, lsn, uploadError: problem };
    const up = await backupFolder(c, repo, join(root, o.outline), o.outline, lsn, ranges.at(-1)!.schema, o.machine, ranges[0]!.logId);
    if ("error" in up) return { ok: true, lsn, uploadError: up.error };
    // A short wait: the sender's ssh waits on this answer, per outline; a lock that stays is the next relay's.
    await forget(c, repo, { host: o.machine, wait: "30s" });
    return { ok: true, lsn, snapshot: up.id };
  } finally { release(); }
}

/** All of stdin, read through node's stream: `Bun.stdin.stream()` throws "Non-regular files aren't supported yet" when
 *  stdin is the socket sshd hands a command (Bun 1.4.2), which is exactly how the relay arrives. */
async function readStdin(): Promise<Blob> {
  const parts: Buffer[] = [];
  for await (const chunk of process.stdin) parts.push(chunk as Buffer);
  return new Blob([Buffer.concat(parts)]);
}

/** `ep0ch backup receive …` (over ssh, from the relaying machine's job): the ranges on stdin; one JSON line out. */
export async function receiveCommand(args: readonly string[], c: BackupConfig, io: { out: (s: string) => void }, stdin: () => ReadableStream<Uint8Array> | Blob | Promise<Blob> = readStdin): Promise<number> {
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const machine = flag("--machine") ?? "", outline = flag("--outline") ?? "";
  const say = (r: Received) => { io.out(JSON.stringify(r)); return r.ok ? 0 : 1; };
  if (!MACHINE_NAME.test(machine) || !OUTLINE_NAME.test(outline) || outline.includes("..")) return say({ ok: false, error: "ep0ch backup receive --machine <name> --outline <name> [--sha256 H], the log's ranges on stdin" });
  const dir = incomingDir(c, machine);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const part = join(dir, `.${outline}.jsonl.part-${process.pid}`);
  try {
    await Bun.write(part, new Response(await stdin() as BodyInit));
    chmodSync(part, 0o600);
    return say(await receive(c, { machine, outline, ...(flag("--sha256") ? { sha256: flag("--sha256")! } : {}), part }));
  } catch (e) { return say({ ok: false, error: (e as Error).message }); }
  finally { rmSync(part, { force: true }); }
}

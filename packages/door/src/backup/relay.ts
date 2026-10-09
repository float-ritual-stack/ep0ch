// The backup relay (PIE-645): when a machine can't reach the restic repository (the laptop on a work VPN that blocks
// Hetzner object storage), its backup job hands each snapshot to the hub over the ssh path the netmail pull uses
// (EP0CH_MCP_HUB, float-2). The hub, which can reach the bucket, verifies it, installs it as its mirror of that machine
// (never an older schema, never an older change) and uploads it to that machine's repository on its behalf.
//
//   sender    a consistent copy (jobs.ts copyDatabase) streamed over ssh to `ep0ch backup receive` in a login shell;
//             no scp: the file travels on the ssh command's stdin, so the fake ssh and the real one carry it the same
//   receiver  `ep0ch backup receive --machine <m> --outline <n> --seq N --schema V --sha256 H` with the file on stdin:
//             into a private incoming folder, checked (sha256, integrity_check, user_version, change feed), then the
//             mirror (one rename) and the upload (restic with `--host <m>`, then retention)
//
// Secrets stay on each machine: the hub uses its own keys for the upload; nothing here reads or prints them.
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { lastJson, ssh } from "../mcp-netmail";
import { type BackupState, readBackupState, writeBackupState } from "./alert";
import { type BackupConfig, MACHINE_NAME } from "./config";
import { changeSeq, copyDatabase, ensureRepo, integrity, mirrorFolder, newer, replaceMirror, schemaVersion, takeLock } from "./jobs";
import { backupFile, forget, OUTLINE_NAME } from "./restic";

/** The hub's answer to a relayed copy. */
export interface Received {
  ok: boolean;
  /** `installed` as the mirror, `current` (the mirror already had this change or a later one), `older` (a newer schema is there). */
  mirror?: "installed" | "current" | "older";
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

const sha256 = (path: string) => new Bun.CryptoHasher("sha256").update(readFileSync(path)).digest("hex");

/** One outline's checked copy sent to the hub; what the hub made of it. */
export async function relay(c: BackupConfig, hub: string, copy: string, o: { outline: string; seq: number | null; schema: number | null; timeoutMs?: number }): Promise<Received> {
  if (!OUTLINE_NAME.test(o.outline)) return { ok: false, error: `${o.outline} isn't an outline name` };
  if (!MACHINE_NAME.test(c.machine) || !/^\d+$/.test(String(o.seq ?? 0)) || !/^\d+$/.test(String(o.schema ?? 0))) return { ok: false, error: "the relay's arguments aren't plain names and numbers" };
  // Read once: the checksum is of exactly the bytes sent.
  const bytes = readFileSync(copy);
  const argv = `--machine ${c.machine} --outline ${o.outline}${o.seq !== null ? ` --seq ${o.seq}` : ""}${o.schema !== null ? ` --schema ${o.schema}` : ""} --sha256 ${new Bun.CryptoHasher("sha256").update(bytes).digest("hex")}`;
  const r = await ssh(c.env, hub, `ep0ch backup receive ${argv}`, new Blob([bytes]), o.timeoutMs ?? 600_000).catch(e => ({ code: 255, out: "", err: (e as Error).message }));
  try { return lastJson(r.out) as Received; } catch { /* no answer from the command itself */ }
  const why = r.code === 255 ? `${hub} doesn't answer over ssh` : r.code === 127 || /not found/.test(r.err) ? `${hub} has no ep0ch on a login shell's PATH` : `ep0ch backup receive on ${hub} failed (${r.code}): ${r.err.trim().split("\n").at(-1) ?? ""}`;
  return { ok: false, error: why };
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
 * The receiving side: a copy at `part` (already written under `incomingDir`), claimed to be `outline` of `machine` at
 * `seq`/`schema`. Verified, installed as the mirror, uploaded to `machine`'s repository.
 */
export async function receive(c: BackupConfig, o: { machine: string; outline: string; seq: number | null; schema: number | null; sha256?: string; part: string; lockWaitMs?: number; now?: () => number }): Promise<Received> {
  const now = o.now ?? Date.now;
  if (!MACHINE_NAME.test(o.machine) || o.machine === c.machine) return { ok: false, error: `${o.machine} isn't another machine's name` };
  if (!c.mirrors.some(m => m.machine === o.machine)) return { ok: false, error: `${c.machine} doesn't mirror ${o.machine}: add it to EP0CH_BACKUP_MIRRORS in ${c.file}` };
  if (!OUTLINE_NAME.test(o.outline)) return { ok: false, error: `${o.outline} isn't an outline name` };
  if (o.sha256 && sha256(o.part) !== o.sha256) return { ok: false, error: "the copy arrived damaged (sha256 differs); the next run sends it again" };
  const verdict = integrity(o.part);
  if (verdict !== "ok") return { ok: false, error: `the copy failed its integrity check: ${verdict}` };
  const got = schemaVersion(o.part), seq = changeSeq(o.part);
  // A file with no readable change feed has no order to compare by: it never replaces a mirror.
  if (seq === null || got === null) return { ok: false, error: "the copy has no readable change feed or schema version, so it can't be ordered against the mirror" };
  if (o.schema !== null && got !== o.schema) return { ok: false, error: `the copy is schema ${got ?? "?"}, not the ${o.schema} it was sent as` };
  if (o.seq !== null && seq !== o.seq) return { ok: false, error: `the copy is at change ${seq ?? "?"}, not the ${o.seq} it was sent as` };
  const release = await lockFor(c, o.lockWaitMs ?? 90_000);
  if (typeof release === "string") return { ok: false, error: `${release}; the next run sends it again` };
  const tmpFiles: string[] = [];
  try {
    const s: BackupState = readBackupState(c.state);
    const key = `${o.machine}/${o.outline}`, m = s.mirrors[key] ??= {};
    const folder = await mirrorFolder(c, o.machine, o.outline);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    const file = join(folder, `${o.outline}.sqlite`);
    const have = existsSync(file) ? schemaVersion(file) : null, haveSeq = existsSync(file) ? changeSeq(file) : null;
    let mirror: NonNullable<Received["mirror"]>;
    // A newer schema there stays; the same schema takes a later change, never an earlier one (#286's rule).
    if (have !== null && got < have) mirror = "older";
    else if (!existsSync(file) || (have !== null && got > have) || haveSeq === null || newer({ seq }, { seq: haveSeq })) {
      const tmp = join(folder, `.${o.outline}.sqlite.incoming-${process.pid}`);
      tmpFiles.push(tmp);
      copyFileSync(o.part, tmp); chmodSync(tmp, 0o600);
      if (integrity(tmp) !== "ok") return { ok: false, error: "the copy failed its integrity check after it was copied into the mirror folder" };
      replaceMirror(tmp, file);
      m.folder = folder;
      Object.assign(m, { seq, at: new Date(now()).toISOString(), source: "relay", refreshed: new Date(now()).toISOString() });
      delete m.snapshot; delete m.behindSince; delete m.error;
      mirror = "installed";
    } else mirror = "current";
    writeBackupState(c.state, s);
    // The upload, for the machine that can't make it: its repository, its host name, then its retention.
    const repo = c.repoOf(o.machine);
    const problem = await ensureRepo(c, repo, () => {});
    if (problem) return { ok: true, mirror, uploadError: problem };
    const up = await backupFile(c, repo, o.part, o.outline, seq, got, o.machine);
    if ("error" in up) return { ok: true, mirror, uploadError: up.error };
    await forget(c, repo, false, o.machine);
    return { ok: true, mirror, snapshot: up.id };
  } finally {
    for (const f of tmpFiles) rmSync(f, { force: true });
    release();
  }
}

/** All of stdin, read through node's stream: `Bun.stdin.stream()` throws "Non-regular files aren't supported yet" when
 *  stdin is the socket sshd hands a command (Bun 1.4.2), which is exactly how the relay arrives. */
async function readStdin(): Promise<Blob> {
  const parts: Buffer[] = [];
  for await (const chunk of process.stdin) parts.push(chunk as Buffer);
  return new Blob([Buffer.concat(parts)]);
}

/** `ep0ch backup receive …` (over ssh, from the relaying machine's job): the file on stdin; one JSON line out. */
export async function receiveCommand(args: readonly string[], c: BackupConfig, io: { out: (s: string) => void }, stdin: () => ReadableStream<Uint8Array> | Blob | Promise<Blob> = readStdin): Promise<number> {
  const flag = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
  const num = (v: string | undefined) => (v !== undefined && /^\d+$/.test(v) ? Number(v) : null);
  const machine = flag("--machine") ?? "", outline = flag("--outline") ?? "";
  const say = (r: Received) => { io.out(JSON.stringify(r)); return r.ok ? 0 : 1; };
  if (!MACHINE_NAME.test(machine) || !OUTLINE_NAME.test(outline) || outline.includes("..")) return say({ ok: false, error: "ep0ch backup receive --machine <name> --outline <name> [--seq N] [--schema V] [--sha256 H], the file on stdin" });
  const dir = incomingDir(c, machine);
  mkdirSync(dir, { recursive: true, mode: 0o700 }); chmodSync(dir, 0o700);
  const part = join(dir, `.${outline}.sqlite.part-${process.pid}`);
  try {
    await Bun.write(part, new Response(await stdin() as BodyInit));
    chmodSync(part, 0o600);
    return say(await receive(c, { machine, outline, seq: num(flag("--seq")), schema: num(flag("--schema")), ...(flag("--sha256") ? { sha256: flag("--sha256")! } : {}), part }));
  } catch (e) { return say({ ok: false, error: (e as Error).message }); }
  finally { rmSync(part, { force: true }); }
}

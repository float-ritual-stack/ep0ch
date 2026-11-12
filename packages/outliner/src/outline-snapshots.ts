import { existsSync, linkSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { OutlineSnapshot, ShareSession } from "@ep0ch/outline-core/protocol";
import type { MutationProvenance } from "./types";
import type { OutlinerStore } from "./store";
import { copyOutlineFile } from "./outline-file";
import { ShareSessions, shareOnWire, shareTtlMs } from "./share-sessions";

/**
 * Copies and download lifetimes belong to the host; tokens and revocation belong to ShareSessions. Each snapshot gets a
 * record note in the outline, except on a read-only copy (`records` false: another machine's outline, PIE-1091), whose
 * session in the shares file is its only record.
 */
export class OutlineSnapshots {
  private timer?: ReturnType<typeof setInterval>;
  private readonly downloading = new Map<string, { at: string; ip: string; userAgent: string; method: string }>();
  constructor(private readonly store: OutlinerStore, private readonly shares: ShareSessions, private readonly folder: string, private readonly records = true) {}

  start(): void {
    this.sweep();
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }
  stop(): void { clearInterval(this.timer); }
  private path(id: string): string { return join(this.folder, `${id}.sqlite`); }

  async create(input: { ttl?: string | number; out?: string; mutation?: MutationProvenance }, origin?: string): Promise<OutlineSnapshot> {
    const ttlMs = shareTtlMs(input.ttl ?? "15m");
    const outline = basename(this.store.database.filename, ".sqlite");
    if (!input.out && !origin) throw new Error(`No snapshot download address: no publisher on this host has a public listener; use ep0ch outline snapshot ${outline} --out ${outline}.snapshot.sqlite on this machine`);
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const temporary = this.path(crypto.randomUUID());
    const destination = input.out ?? temporary;
    const metadata = await this.copy(destination);
    const by = input.mutation?.author === "agent" ? input.mutation.actorId ?? "agent" : "you";
    const record = !this.records ? { id: "" } : this.store.create(`Snapshot of ${outline} [type::snapshot] [machine::snapshot] [publish::never]\n\nWho: ${by}\nOutline: ${outline}\nAs of: ${metadata.asOf}\nBytes: ${metadata.bytes}\nSHA-256: ${metadata.sha256}\nSchema: ${metadata.schema}\nState: ${input.out ? "saved to file" : "waiting"}`, null, "system");
    if (input.out) return { ...metadata, path: destination };
    try {
      const share = this.shares.start({ scope: { kind: "outline" }, ttlMs, comments: false, by, snapshot: { ...metadata, recordId: record.id, base: origin! } });
      renameSync(temporary, this.path(share.id));
      const url = shareOnWire(share, origin).url!;
      return { ...metadata, url, expiresAt: share.expiresAt, shareId: share.id, curl: `curl --fail --location '${url}' --output '${outline}.snapshot.sqlite'` };
    } catch (error) { rmSync(temporary, { force: true }); throw error; }
  }

  /**
   * The checked copy at `destination` (PIE-1750): made by the host in a worker of its own (`copyOutlineFile`, off the
   * host's loop), checked in a process of its own, then published by a hard link, so `destination` is never half a copy
   * and an existing file is never touched.
   */
  private async copy(destination: string): Promise<Pick<OutlineSnapshot, "bytes" | "sha256" | "schema" | "asOf">> {
    if (existsSync(destination)) throw new Error(`${destination} already exists; not overwritten`);
    const folder = mkdtempSync(join(dirname(destination), ".ep0ch-snapshot-"));
    const copy = join(folder, "copy.sqlite");
    try {
      const asOf = new Date().toISOString();
      await copyOutlineFile(this.store.database.filename, copy);
      const check = Bun.spawn([process.execPath, join(import.meta.dir, "snapshot-database.ts"), "--check", copy], { stdout: "pipe", stderr: "pipe" });
      const [stdout, stderr, code] = await Promise.all([new Response(check.stdout).text(), new Response(check.stderr).text(), check.exited]);
      if (code !== 0) throw new Error(`Snapshot copy failed: ${stderr.trim()}`);
      try { linkSync(copy, destination); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${destination} already exists; not overwritten`);
        throw error;
      }
      return { ...(JSON.parse(stdout) as { bytes: number; sha256: string; schema: number }), asOf };
    } finally { rmSync(folder, { recursive: true, force: true }); }
  }

  take(token: string, attempt: { ip: string; userAgent: string; method: string }): { path: string; shareId: string; bytes: number } | null {
    this.sweep();
    const share = this.shares.resolve(token);
    if (!share?.snapshot) return null;
    const details = { at: new Date().toISOString(), ip: attempt.ip, userAgent: attempt.userAgent, method: attempt.method };
    // Headers are untrusted text; even a caller echoing the secret must not put it in the record.
    details.ip = details.ip.replaceAll(token, "[redacted]");
    details.userAgent = details.userAgent.replaceAll(token, "[redacted]");
    details.method = details.method.replaceAll(token, "[redacted]");
    if (share.state !== "active" || this.downloading.has(share.id) || !["GET", "HEAD"].includes(attempt.method)) {
      this.log(share, { ...details, bytes: 0, outcome: "refused" });
      return null;
    }
    if (attempt.method === "HEAD") this.log(share, { ...details, bytes: 0, outcome: "complete" });
    else this.downloading.set(share.id, details);
    return { path: this.path(share.id), shareId: share.id, bytes: share.snapshot.bytes };
  }

  finish(id: string, fetched: boolean, bytes: number): void {
    const attempt = this.downloading.get(id);
    this.downloading.delete(id);
    const share = this.shares.list(true).find(s => s.id === id);
    if (!share?.snapshot || !attempt) return;
    this.log(share, { ...attempt, bytes, outcome: fetched ? "complete" : `aborted at ${bytes} bytes` });
    if (fetched) {
      this.shares.revoke(id);
      this.remove(share, "fetched");
    }
  }

  private log(share: ShareSession, attempt: { at: string; ip: string; userAgent: string; method: string; bytes: number; outcome: string }): void {
    if (!this.records) return;
    const note = this.store.get(share.snapshot!.recordId);
    if (note) this.store.update(note.id, `${note.text}\nAttempt: ${JSON.stringify(attempt)}`, note.revision, { author: "system" });
  }

  sweep(): void {
    for (const share of this.shares.list(true)) {
      if (!share.snapshot || share.snapshot.removed) continue;
      if (Date.parse(share.expiresAt) <= Date.now()) {
        this.remove(share, "expired");
      } else if (share.state !== "active" && !this.downloading.has(share.id)) this.remove(share, "revoked");
    }
  }

  private remove(share: ShareSession, state: string): void {
    rmSync(this.path(share.id), { force: true });
    const note = this.records ? this.store.get(share.snapshot!.recordId) : null;
    if (note?.text.includes("State: waiting")) this.store.update(note.id, note.text.replace(/State: waiting(?=\n|$)/, `State: ${state}\nEnded: ${new Date().toISOString()}`), note.revision, { author: "system" });
    this.shares.snapshotRemoved(share.id);
  }
}

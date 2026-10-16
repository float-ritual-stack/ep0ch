import { mkdirSync, renameSync, rmSync } from "node:fs";
import { basename, join } from "node:path";
import type { OutlineSnapshot, ShareSession } from "@ep0ch/outline-core/protocol";
import type { MutationProvenance } from "./types";
import type { OutlinerStore } from "./store";
import { ShareSessions, shareOnWire, shareTtlMs } from "./share-sessions";

/** Copies and download lifetimes belong to the host; tokens and revocation belong to ShareSessions. */
export class OutlineSnapshots {
  private timer?: ReturnType<typeof setInterval>;
  private readonly downloading = new Set<string>();
  constructor(private readonly store: OutlinerStore, private readonly shares: ShareSessions, private readonly folder: string) {}

  start(): void {
    this.sweep();
    this.timer = setInterval(() => this.sweep(), 1000);
    this.timer.unref();
  }
  stop(): void { clearInterval(this.timer); }
  private path(id: string): string { return join(this.folder, `${id}.sqlite`); }

  async create(input: { ttl?: string | number; out?: string; mutation?: MutationProvenance }, origin?: string): Promise<OutlineSnapshot> {
    const ttlMs = shareTtlMs(input.ttl ?? "15m");
    if (!input.out && !origin) throw new Error("No snapshot download address: start the publisher with --url or --public-url, or use ep0ch outline snapshot <name> --out <file> on this machine");
    mkdirSync(this.folder, { recursive: true, mode: 0o700 });
    const temporary = this.path(crypto.randomUUID());
    const destination = input.out ?? temporary;
    const copy = Bun.spawn([process.execPath, join(import.meta.dir, "snapshot-database.ts"), this.store.database.filename, destination], { stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, code] = await Promise.all([new Response(copy.stdout).text(), new Response(copy.stderr).text(), copy.exited]);
    if (code !== 0) throw new Error(`Snapshot copy failed: ${stderr.trim()}`);
    const metadata = JSON.parse(stdout) as Pick<OutlineSnapshot, "bytes" | "sha256" | "schema" | "asOf">;
    const by = input.mutation?.author === "agent" ? input.mutation.actorId ?? "agent" : "you";
    const outline = basename(this.store.database.filename, ".sqlite");
    const record = this.store.create(`Snapshot of ${outline} [type::snapshot] [machine::snapshot] [publish::never]\n\nWho: ${by}\nOutline: ${outline}\nAs of: ${metadata.asOf}\nBytes: ${metadata.bytes}\nSHA-256: ${metadata.sha256}\nSchema: ${metadata.schema}\nState: ${input.out ? "saved to file" : "waiting"}`, null, "system");
    if (input.out) return { ...metadata, path: destination };
    try {
      const share = this.shares.start({ scope: { kind: "outline" }, ttlMs, comments: false, by, snapshot: { ...metadata, recordId: record.id, base: origin! } });
      renameSync(temporary, this.path(share.id));
      const url = shareOnWire(share, origin).url!;
      return { ...metadata, url, expiresAt: share.expiresAt, shareId: share.id, curl: `curl --fail --location '${url}' --output '${outline}.snapshot.sqlite'` };
    } catch (error) { rmSync(temporary, { force: true }); throw error; }
  }

  take(token: string): { path: string; shareId: string } | null {
    this.sweep();
    const share = this.shares.resolve(token);
    if (!share?.snapshot || share.state !== "active") return null;
    // Consume before yielding to a second request; the copy stays until streaming finishes or its deadline.
    this.downloading.add(share.id);
    this.shares.revoke(share.id);
    return { path: this.path(share.id), shareId: share.id };
  }

  finish(id: string, fetched: boolean): void {
    this.downloading.delete(id);
    const share = this.shares.list(true).find(s => s.id === id);
    if (share?.snapshot) this.remove(share, fetched ? "fetched" : "download interrupted");
  }

  sweep(): void {
    for (const share of this.shares.list(true)) {
      if (!share.snapshot || share.snapshot.removed) continue;
      if (Date.parse(share.expiresAt) <= Date.now()) {
        this.downloading.delete(share.id);
        this.remove(share, "expired");
      } else if (share.state !== "active" && !this.downloading.has(share.id)) this.remove(share, "revoked");
    }
  }

  private remove(share: ShareSession, state: string): void {
    rmSync(this.path(share.id), { force: true });
    const note = this.store.get(share.snapshot!.recordId);
    if (note?.text.endsWith("State: waiting")) this.store.update(note.id, note.text.replace(/State: waiting$/, `State: ${state}\nEnded: ${new Date().toISOString()}`), note.revision, { author: "system" });
    this.shares.snapshotRemoved(share.id);
  }
}

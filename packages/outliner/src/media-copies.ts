// Pictures a note names, copied to the media bucket on save (PIE-1634). The outline host hears every saved note
// (server.ts `publishChanges`); for each picture line it names (`[img::path]`, outline-core's noteMediaLines) it reads
// the file on this machine, keys it by its content's sha256 and uploads it to the bucket (media-bucket.ts) unless that
// hash is already there. A save never waits on it: the note is saved first and the copy follows, one at a time.
//
// What it copies: any picture a note names (a type a page shows, at most a page's size), wherever it is on the machine;
// the note is the person's own, and the bucket is private. The record (`media_copies`, by path) is beside the blocks,
// never a property: the path, its hash, size and mtime when copied, the note that last named it, and when the upload
// landed or why it didn't. A picture changed on disk is hashed again on the next save of a note that names it.
//
// What it answers: `media.copies` (which of a page's pictures have a copy, with a short-lived address in the bucket) for
// the publisher, which redirects a page's picture there, and `media.read` (a picture's bytes, the file here else its
// copy) for the door, when the file isn't on the door's machine. A read-only copy of an outline answers both from the
// records it carries.
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { extname } from "node:path";
import { notePicturePaths } from "@ep0ch/outline-core/picture-address";
import type { MediaCopies, MediaCopy, MediaRead, MediaRequest } from "@ep0ch/outline-core/media-copy";
import { resolveReferencedPath } from "./files";
import { MediaBucket, mediaBucketConfig, type MediaBucketConfig } from "./media-bucket";
import { MAX_PUBLISHED_IMAGE_BYTES, PUBLISHED_IMAGE_TYPES } from "./publish-attachments";
import type { OutlinerStore } from "./store";

interface Row { path: string; sha256: string; mime: string; bytes: number; mtime_ns: string; block_id: string; copied_at: string | null; error: string | null }

export interface MediaCopierOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  log?: (line: string) => void;
}

/** How long the bucket's settings are kept before they're read again (a group file edited while the host runs). */
const CONFIG_MS = 60_000;

export class MediaCopier {
  private queue: Promise<void> = Promise.resolve();
  private config?: { at: number; value: ReturnType<typeof mediaBucketConfig> };
  private bucketFor?: { config: MediaBucketConfig; bucket: MediaBucket };
  private readonly log: (line: string) => void;
  /** Uploads made since the host started: what a test counts. */
  uploads = 0;
  /** Where the bucket's settings are read (media-bucket.ts): the process's environment unless a test names its own. */
  env: NodeJS.ProcessEnv;

  constructor(private readonly store: OutlinerStore, private readonly options: MediaCopierOptions = {}) {
    this.log = options.log ?? (() => {});
    this.env = options.env ?? process.env;
  }

  private settings(): ReturnType<typeof mediaBucketConfig> {
    const now = Date.now();
    if (!this.config || now - this.config.at > CONFIG_MS) this.config = { at: now, value: mediaBucketConfig(this.env) };
    return this.config.value;
  }

  private bucket(): MediaBucket | null {
    const config = this.settings();
    if (!config || "problem" in config) return null;
    if (this.bucketFor?.config !== config) this.bucketFor = { config, bucket: new MediaBucket(config) };
    return this.bucketFor.bucket;
  }

  /** The absolute path a note's picture path names on this machine, or null when it can't name one. */
  resolve(path: string): string | null {
    try { return resolveReferencedPath(path.trim(), this.store.workspaceRoot || process.cwd(), this.options.home ?? homedir()); } catch { return null; }
  }

  /** A note was saved: its pictures are copied after the save, in order with every other copy. */
  blockChanged(blockId: string): void {
    const text = this.store.get(blockId)?.text;
    const paths = text ? notePicturePaths(text) : [];
    if (!paths.length) return;
    this.queue = this.queue.then(() => this.copyAll(blockId, paths)).catch((error) => this.log(`media: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Every copy asked for so far has landed or failed. */
  settled(): Promise<void> { return this.queue; }

  private row(path: string): Row | null {
    return this.store.database.query("SELECT * FROM media_copies WHERE path = ?").get(path) as Row | null;
  }

  private async copyAll(blockId: string, paths: readonly string[]): Promise<void> {
    for (const written of new Set(paths)) {
      const path = this.resolve(written);
      if (path) await this.copyOne(blockId, path);
    }
  }

  private async copyOne(blockId: string, path: string): Promise<void> {
    const mime = PUBLISHED_IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mime) return;
    let stat;
    try { stat = statSync(path, { bigint: true }); } catch { return; }
    if (!stat.isFile() || stat.size > BigInt(MAX_PUBLISHED_IMAGE_BYTES)) return;
    const mtime = stat.mtimeNs.toString(), size = Number(stat.size);
    const row = this.row(path);
    if (row && row.copied_at && row.mtime_ns === mtime && row.bytes === size) return;
    let bytes: Buffer;
    try { bytes = readFileSync(path); } catch { return; }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Copied already, under this path or another: recorded as landed, nothing uploaded.
    const landed = (row?.sha256 === sha256 && row.copied_at) || (this.store.database.query("SELECT copied_at FROM media_copies WHERE sha256 = ? AND copied_at IS NOT NULL LIMIT 1").get(sha256) as { copied_at: string } | null)?.copied_at || null;
    this.store.database.query(`INSERT INTO media_copies (path, sha256, mime, bytes, mtime_ns, block_id, copied_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, mime = excluded.mime, bytes = excluded.bytes, mtime_ns = excluded.mtime_ns,
        block_id = excluded.block_id, copied_at = excluded.copied_at, error = NULL`).run(path, sha256, mime, size, mtime, blockId, landed);
    if (landed) return;
    const config = this.settings();
    if (!config) return;
    const fail = (error: string) => { this.store.database.query("UPDATE media_copies SET error = ? WHERE path = ?").run(error, path); this.log(`media: ${path}: ${error}`); };
    if ("problem" in config) return fail(config.problem);
    const bucket = this.bucket()!;
    try {
      if (!(await bucket.has(sha256))) { await bucket.put(sha256, bytes, mime); this.uploads++; }
      this.store.database.query("UPDATE media_copies SET copied_at = ?, error = NULL WHERE sha256 = ?").run(new Date().toISOString(), sha256);
    } catch (error) {
      fail(`the upload to ${config.bucket} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async request(request: MediaRequest): Promise<MediaCopies | MediaRead> {
    if (request.action === "media.copies") return this.copies(request.paths, !!request.presign);
    return this.read(request.path);
  }

  /** Which of `paths` have a copy (by the path as asked), each with an address in the bucket when `presign`. */
  copies(paths: readonly string[], presign: boolean): MediaCopies {
    const config = this.settings(), bucket = this.bucket();
    const copies: MediaCopy[] = [];
    for (const asked of new Set(paths)) {
      const path = this.resolve(asked), row = path ? this.row(path) : null;
      if (!row) continue;
      const copied = !!row.copied_at;
      copies.push({
        path: asked, sha256: row.sha256, mime: row.mime, bytes: row.bytes, copied,
        ...(presign && copied && bucket ? { url: bucket.presign(row.sha256) } : {}),
        ...(row.error ? { error: row.error } : {}),
      });
    }
    return { bucket: !!bucket, ...(config && "problem" in config ? { problem: config.problem } : {}), copies };
  }

  /** A picture's bytes: the file on this machine when it's there, else its bucket copy. */
  async read(asked: string): Promise<MediaRead> {
    const path = this.resolve(asked);
    if (!path) throw new Error(`${asked} isn't a path this outline can name`);
    const mime = PUBLISHED_IMAGE_TYPES[extname(path).toLowerCase()];
    if (!mime) throw new Error(`${asked} isn't a picture a page shows`);
    try {
      const stat = statSync(path);
      if (stat.isFile() && stat.size <= MAX_PUBLISHED_IMAGE_BYTES) return { path, mime, from: "file", base64: readFileSync(path).toString("base64") };
    } catch { /* not here: its copy */ }
    const row = this.row(path), bucket = this.bucket();
    if (!row?.copied_at) throw new Error(`${asked} isn't on ${this.store.workspaceRoot ? "the outline's machine" : "this machine"}, and no copy of it is in the media bucket`);
    if (!bucket) throw new Error(`${asked} has a copy in the media bucket, but this host has no bucket settings to read it with`);
    return { path, mime: row.mime, from: "bucket", sha256: row.sha256, base64: Buffer.from(await bucket.get(row.sha256)).toString("base64") };
  }
}

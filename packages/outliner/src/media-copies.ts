// Pictures and artifact files a note names, copied to the media bucket on save (PIE-1634, PIE-1644). The outline host hears every saved note
// (server.ts `publishChanges`); for each picture line it names (`[img::path]`, outline-core's noteMediaLines) it reads
// the file on this machine, keys it by its content's sha256 and uploads it to the bucket (media-bucket.ts) unless that
// hash is already there. A save never waits on it: the note is saved first and the copy follows, one at a time.
//
// What it copies: any picture a note names (a type a page shows, at most a page's size) and any artifact file
// (`[artifact::path]`, a file a page runs, at most an artifact's size), wherever it is on the machine; the note is the
// person's own, and the bucket is private. A file named by an absolute path that isn't on this machine is asked of the
// machines this one reaches (artifact-machine.ts: the artifact machine first), and its bytes copied from there (PIE-1644). The record (`media_copies`, by path) is beside the blocks,
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
import { extname, isAbsolute } from "node:path";
import { artifactKind } from "@ep0ch/outline-core/media-line";
import { noteArtifactPaths, notePicturePaths } from "@ep0ch/outline-core/picture-address";
import type { MediaCopies, MediaCopy, MediaRead, MediaRequest } from "@ep0ch/outline-core/media-copy";
import type { ElsewhereRead } from "./artifact-machine";
import { artifactLimit } from "./artifact-inbox";
import { packTar } from "./artifact-archive";
import { folderFingerprint, readFolderArtifact } from "./artifact-store";
import { resolveReferencedPath } from "./files";
import { MediaBucket, mediaBucketConfig, type MediaBucketConfig } from "./media-bucket";
import { hiddenPath, MAX_PUBLISHED_IMAGE_BYTES, PUBLISHED_IMAGE_TYPES } from "./publish-attachments";
import { realpathSync } from "node:fs";
import type { OutlinerStore } from "./store";

interface Row { path: string; sha256: string; mime: string; bytes: number; mtime_ns: string; block_id: string; copied_at: string | null; error: string | null }

/** The types an artifact file is kept as (a picture's are the page's). */
const ARTIFACT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8", ".htm": "text/html; charset=utf-8", ".jsx": "text/javascript; charset=utf-8", ".tsx": "text/javascript; charset=utf-8",
  ".mermaid": "text/plain; charset=utf-8", ".mmd": "text/plain; charset=utf-8",
};

/** A folder an artifact line names is kept as one archive of its files (artifact-archive.ts packTar). */
const FOLDER_TYPE = "application/x-tar";

/**
 * What the bucket keeps a path as: a picture, an artifact file or, when an artifact line names it (`folders`) and it has
 * no extension, a folder that runs whole; its type and the most it copies. Null for anything else.
 */
export function copyKind(path: string, folders = false): { mime: string; cap: number; artifact: boolean; folder?: true } | null {
  const extension = extname(path).toLowerCase();
  const picture = PUBLISHED_IMAGE_TYPES[extension];
  if (picture) return { mime: picture, cap: MAX_PUBLISHED_IMAGE_BYTES, artifact: !!artifactKind(path) };
  if (artifactKind(path)) return { mime: ARTIFACT_TYPES[extension] ?? "text/plain; charset=utf-8", cap: artifactLimit(), artifact: true };
  if (folders && !extension) return { mime: FOLDER_TYPE, cap: artifactLimit(), artifact: true, folder: true };
  return null;
}

/**
 * Why an artifact line's path is never copied: it, or what a link in it leads to, is hidden (the attachments' rule,
 * `hiddenPath`). Undefined when it isn't, or isn't there to look at. A picture keeps PIE-1634's rule: copied wherever it is.
 */
export function hiddenArtifact(path: string): string | undefined {
  let real: string;
  try { real = realpathSync(path); } catch { return hiddenPath(path) ? `${path} is hidden (a name starting with “.” on its way): an artifact line never copies it, so move it somewhere visible` : undefined; }
  return hiddenPath(real) ? `${path} is hidden (${real === path ? "a name starting with “.” on its way" : `it leads to ${real}`}): an artifact line never copies it, so move it somewhere visible` : undefined;
}

/** A folder's files packed the same way every time, and what tells when they changed without reading them. */
const packFolder = (path: string) => packTar(readFolderArtifact(path));

/**
 * The file at absolute `path` on this machine's disk, read whole: what a host answers another machine's `media.read`
 * with (no outline: its disk alone, never its bucket). Throws saying why it can't.
 */
export function readMachineFile(path: string, machine?: string, artifact = false): MediaRead {
  if (!isAbsolute(path)) throw new Error(`${path} isn't a path on a machine (it needs to start with /)`);
  const hidden = artifact ? hiddenArtifact(path) : undefined;
  if (hidden) throw new Error(hidden);
  const kind = copyKind(path, true);
  if (!kind) throw new Error(`${path} isn't a picture or a page`);
  let size: number;
  try {
    const stat = statSync(path);
    if (kind.folder && stat.isDirectory()) return { path, mime: kind.mime, from: "file", base64: packFolder(path).toString("base64"), ...(machine ? { machine } : {}) };
    if (kind.folder) throw new Error(`${path} isn't a picture or a page`);
    if (!stat.isFile()) throw new Error("not a file");
    size = stat.size;
  } catch (error) { throw new Error(error instanceof Error && !/ENOENT|ENOTDIR|not a file/.test(error.message) ? error.message : `${path} isn't on ${machine ?? "this machine"}`); }
  if (size > kind.cap) throw new Error(`${path} is ${size} bytes, over the ${kind.cap} a copy holds`);
  return { path, mime: kind.mime, from: "file", base64: readFileSync(path).toString("base64"), ...(machine ? { machine } : {}) };
}

export interface MediaCopierOptions {
  env?: NodeJS.ProcessEnv;
  home?: string;
  log?: (line: string) => void;
  /** A read-only copy of an outline: it answers from the records it carries and never writes one. */
  readOnly?: boolean;
  /** Asks the machines this one reaches for a file that isn't on its disk (artifact-machine.ts `readElsewhere`). */
  elsewhere?: (path: string, artifact: boolean) => Promise<ElsewhereRead>;
  /** Which absolute paths are on this machine's disk: all of them, unless a test's two machines share one. */
  filesHere?: (path: string) => boolean;
}

/**
 * What copying one path came to: its record when there is one, else the machines asked, or why not. `bytes`: what was
 * read, when no bucket took it (a machine with no bucket keys hands them on).
 */
export interface CopyOutcome { row?: Row; tried?: { machine: string; said: string }[]; problem?: string; bytes?: Buffer }

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

  /** Whether this host can put a copy in the bucket itself. */
  hasBucket(): boolean { return !this.bucketProblem(); }

  /** Why nothing can be copied: no bucket named, or one half set up; undefined when there is one. */
  bucketProblem(): string | undefined {
    const config = this.settings();
    return !config ? "this machine has no media bucket (EP0CH_MEDIA_BUCKET)" : "problem" in config ? config.problem : undefined;
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

  /** Whether `path` is on this machine's disk as far as the copier is concerned. */
  private here(path: string): boolean { return this.options.filesHere?.(path) ?? true; }

  /** A note was saved: its pictures and artifact files are copied after the save, in order with every other copy. */
  blockChanged(blockId: string): void {
    if (this.options.readOnly) return;
    const text = this.store.get(blockId)?.text;
    // An artifact line's path may be a folder; a picture's never is.
    const paths: [string, boolean][] = text ? [...notePicturePaths(text).map(path => [path, false] as [string, boolean]), ...noteArtifactPaths(text).map(path => [path, true] as [string, boolean])] : [];
    if (!paths.length) return;
    this.queue = this.queue.then(() => this.copyAll(blockId, paths)).catch((error) => this.log(`media: ${error instanceof Error ? error.message : String(error)}`));
  }

  /** Every copy asked for so far has landed or failed. */
  settled(): Promise<void> { return this.queue; }

  /**
   * `written` (as a note writes it) copied now if it isn't yet, in line with every other copy: its record, else the
   * machines asked for it. What `artifacts.show` waits on, so a card asked straight after a save, or a note saved before
   * this existed, finds its copy.
   */
  async ensure(written: string, blockId = ""): Promise<CopyOutcome & { path: string | null }> {
    const path = this.resolve(written);
    if (!path) return { path, problem: `${written} isn't a path this outline can name` };
    if (this.options.readOnly) { const row = this.row(path); return { path, ...(row ? { row } : { problem: "this copy of the outline holds no copy of it" }) }; }
    let outcome: CopyOutcome = {};
    const run = this.queue.then(async () => { outcome = await this.copyOne(blockId, path, isAbsolute(written.trim()), false, true); });
    this.queue = run.catch((error) => this.log(`media: ${error instanceof Error ? error.message : String(error)}`));
    await run;
    return { path, ...outcome };
  }

  private row(path: string): Row | null {
    return this.store.database.query("SELECT * FROM media_copies WHERE path = ?").get(path) as Row | null;
  }

  private async copyAll(blockId: string, paths: readonly [string, boolean][]): Promise<void> {
    const seen = new Set<string>();
    for (const [written, folders] of paths) {
      const path = this.resolve(written);
      if (!path || seen.has(path)) continue;
      seen.add(path);
      await this.copyOne(blockId, path, isAbsolute(written.trim()), true, folders);
    }
  }

  /**
   * One path copied: the file here, else (when `ask`, an absolute path) the first machine that has it. `refresh`: ask
   * that machine again though a copy from it landed already (a save; a show takes the copy it has).
   */
  private async copyOne(blockId: string, path: string, ask: boolean, refresh: boolean, folders = false): Promise<CopyOutcome> {
    const kind = copyKind(path, folders);
    if (!kind) return { problem: `${path} isn't a picture or a page` };
    // `folders`: an artifact line names it, so nothing hidden is copied (a picture line's svg still is).
    const hidden = folders ? hiddenArtifact(path) : undefined;
    if (hidden) return { problem: hidden };
    let stat;
    try { stat = this.here(path) ? statSync(path, { bigint: true }) : undefined; } catch { /* not on this machine */ }
    if (!stat) {
      const row = this.row(path);
      if (!ask || !this.options.elsewhere) return row ? { row } : {};
      // A save asks that machine again (the file may have changed there); a show takes the copy it has.
      if (row?.mtime_ns.startsWith("@") && !refresh && (row.copied_at || !this.hasBucket())) return { row };
      const asked = await this.options.elsewhere(path, folders);
      if ("tried" in asked) return row?.copied_at ? { row, tried: asked.tried } : { tried: asked.tried };
      const bytes = Buffer.from(asked.found.base64, "base64");
      if (bytes.length > kind.cap) return { problem: `${path} is ${bytes.length} bytes on ${asked.found.machine}, over the ${kind.cap} a copy holds` };
      return this.record(blockId, path, bytes, kind.mime, `@${asked.found.machine}`, row);
    }
    if (kind.folder && stat.isDirectory()) {
      const fingerprint = `dir:${folderFingerprint(path)}`, row = this.row(path);
      if (row?.copied_at && row.mtime_ns === fingerprint) return { row };
      try { return await this.record(blockId, path, packFolder(path), kind.mime, fingerprint, row); }
      catch (error) { return { problem: error instanceof Error ? error.message : String(error) }; }
    }
    if (kind.folder || !stat.isFile()) return { problem: `${path} isn't a ${kind.folder ? "page an artifact line runs" : "file"}` };
    if (stat.size > BigInt(kind.cap)) return { problem: `${path} is ${stat.size} bytes, over the ${kind.cap} a copy holds` };
    const mtime = stat.mtimeNs.toString(), size = Number(stat.size);
    const row = this.row(path);
    if (row && row.copied_at && row.mtime_ns === mtime && row.bytes === size) return { row };
    let bytes: Buffer;
    try { bytes = readFileSync(path); } catch (error) { return { problem: `${path} can't be read: ${(error as Error).message}` }; }
    return this.record(blockId, path, bytes, kind.mime, mtime, row);
  }

  /** `bytes` recorded for `path` by its sha256 and uploaded unless that hash landed already, here or under another path. */
  private async record(blockId: string, path: string, bytes: Buffer, mime: string, mtime: string, row: Row | null): Promise<CopyOutcome> {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    // Copied already, under this path or another: recorded as landed, nothing uploaded.
    const landed = (row?.sha256 === sha256 && row.copied_at) || (this.store.database.query("SELECT copied_at FROM media_copies WHERE sha256 = ? AND copied_at IS NOT NULL LIMIT 1").get(sha256) as { copied_at: string } | null)?.copied_at || null;
    this.store.database.query(`INSERT INTO media_copies (path, sha256, mime, bytes, mtime_ns, block_id, copied_at, error) VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
      ON CONFLICT(path) DO UPDATE SET sha256 = excluded.sha256, mime = excluded.mime, bytes = excluded.bytes, mtime_ns = excluded.mtime_ns,
        block_id = COALESCE(NULLIF(excluded.block_id, ''), media_copies.block_id), copied_at = excluded.copied_at, error = NULL`).run(path, sha256, mime, bytes.length, mtime, blockId, landed);
    if (landed) return { row: this.row(path)! };
    const config = this.settings();
    if (!config) return { row: this.row(path)!, bytes };
    const fail = (error: string, kept?: Buffer): CopyOutcome => { this.store.database.query("UPDATE media_copies SET error = ? WHERE path = ?").run(error, path); this.log(`media: ${path}: ${error}`); return { row: this.row(path)!, ...(kept ? { bytes: kept } : {}) }; };
    if ("problem" in config) return fail(config.problem, bytes);
    const bucket = this.bucket()!;
    try {
      if (!(await bucket.has(sha256))) { await bucket.put(sha256, bytes, mime); this.uploads++; }
      this.store.database.query("UPDATE media_copies SET copied_at = ?, error = NULL WHERE sha256 = ?").run(new Date().toISOString(), sha256);
    } catch (error) {
      return fail(`the upload to ${config.bucket} failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return { row: this.row(path)! };
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

  /** A picture's or artifact file's bytes: the file on this machine when it's there, else its bucket copy. */
  async read(asked: string): Promise<MediaRead> {
    const path = this.resolve(asked);
    if (!path) throw new Error(`${asked} isn't a path this outline can name`);
    const kind = copyKind(path);
    if (!kind) throw new Error(`${asked} isn't a picture or a page`);
    try {
      const stat = this.here(path) ? statSync(path) : undefined;
      if (stat?.isFile() && stat.size <= kind.cap) return { path, mime: kind.mime, from: "file", base64: readFileSync(path).toString("base64") };
    } catch { /* not here: its copy */ }
    const row = this.row(path), bucket = this.bucket();
    if (!row?.copied_at) throw new Error(`${asked} isn't on ${this.store.workspaceRoot ? "the outline's machine" : "this machine"}, and no copy of it is in the media bucket`);
    if (!bucket) throw new Error(`${asked} has a copy in the media bucket, but this host has no bucket settings to read it with`);
    return { path, mime: row.mime, from: "bucket", sha256: row.sha256, base64: Buffer.from(await bucket.get(row.sha256)).toString("base64") };
  }
}

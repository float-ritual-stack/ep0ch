// The media bucket (PIE-1634): one S3-compatible bucket, private, holding each picture a note names once, at
// `sha256/<hex>`. Hetzner Object Storage today; R2 or any S3 is a change of endpoint and keys, nothing else. Bun's own S3
// client signs (path-style, so any endpoint works, a test's fake one too).
//
// Settings, first match wins per name: the process's environment, then the with-secrets group (`EP0CH_MEDIA_SECRETS`,
// `hetzner-s3` when unset) as a `.env` file, so putting the lines in that group is the whole setup:
//
//   EP0CH_MEDIA_BUCKET     the bucket's name
//   EP0CH_MEDIA_ENDPOINT   its endpoint, `https://hel1.your-objectstorage.com`
//   EP0CH_MEDIA_REGION     its signing region (else the endpoint's first label, `hel1`)
//   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY   its keys, as `with-secrets hetzner-s3` gives them
//
// Nothing here logs or returns a key.
import { groupValues, secretsDirectory, SECRET_GROUP_PATTERN } from "./extension-secrets";
import { join } from "node:path";
import { readFileSync, statSync } from "node:fs";

export interface MediaBucketConfig { bucket: string; endpoint: string; region: string; accessKeyId: string; secretAccessKey: string }

/** The settings, or `null` (no bucket named: nothing is copied), or a `problem` naming what's missing and where to add it. */
export function mediaBucketConfig(env: NodeJS.ProcessEnv = process.env): MediaBucketConfig | null | { problem: string } {
  const group = env.EP0CH_MEDIA_SECRETS || "hetzner-s3";
  let file: Record<string, string> = {};
  const path = join(secretsDirectory(env), `${group}.env`);
  if (new RegExp(SECRET_GROUP_PATTERN).test(group)) {
    try {
      const mode = statSync(path).mode;
      if (!(mode & 0o077)) file = groupValues(readFileSync(path, "utf8"));
    } catch { /* no group file: the environment alone */ }
  }
  const at = (name: string) => env[name] || file[name] || "";
  const bucket = at("EP0CH_MEDIA_BUCKET"), endpoint = at("EP0CH_MEDIA_ENDPOINT").replace(/\/+$/, "");
  if (!bucket && !endpoint) return null;
  const missing = ["EP0CH_MEDIA_BUCKET", "EP0CH_MEDIA_ENDPOINT", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"].filter((name) => !at(name));
  if (missing.length) return { problem: `the media bucket is missing ${missing.join(", ")}: add ${missing.length === 1 ? "it" : "them"} to ${path} (with-secrets --add ${group} ${missing[0]})` };
  let region = at("EP0CH_MEDIA_REGION");
  if (!region) { try { region = new URL(endpoint).hostname.split(".")[0] || "auto"; } catch { region = "auto"; } }
  return { bucket, endpoint, region, accessKeyId: at("AWS_ACCESS_KEY_ID"), secretAccessKey: at("AWS_SECRET_ACCESS_KEY") };
}

/** How long a presigned address lasts: a page's pictures load well inside it. */
export const PRESIGN_SECONDS = 600;

export class MediaBucket {
  private readonly client: Bun.S3Client;
  constructor(readonly config: MediaBucketConfig) {
    this.client = new Bun.S3Client({ ...config, virtualHostedStyle: false });
  }
  static key(sha256: string): string { return `sha256/${sha256}`; }
  has(sha256: string): Promise<boolean> { return this.client.exists(MediaBucket.key(sha256)); }
  async put(sha256: string, bytes: Uint8Array, mime: string): Promise<void> { await this.client.write(MediaBucket.key(sha256), bytes, { type: mime }); }
  async get(sha256: string): Promise<Uint8Array> { return new Uint8Array(await this.client.file(MediaBucket.key(sha256)).arrayBuffer()); }
  presign(sha256: string, seconds = PRESIGN_SECONDS): string { return this.client.presign(MediaBucket.key(sha256), { expiresIn: seconds, method: "GET" }); }
}

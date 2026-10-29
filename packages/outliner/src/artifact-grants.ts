// The artifact host's access (PIE-1266). An artifact is code, so it is served from an origin of its own
// (artifacts.ep0ch.sh), where it can never act as the person with their session; that origin therefore knows nobody and
// opens a path only for a grant in it, made by the one place that already decided who may see what:
//   `/k/<expires>.<mac>/<ref>/…`            the signed-in owner's page, for a short while
//   `/s/<outline>/<share>.<mac>/<ref>/…`    a share's page, for as long as that share is open (the host is asked)
// The mac binds the grant to one artifact (`name` or `name@n`), so a link to one opens no other. The key is a file
// beside the store, made on first use and read by both the service that mints and the server that checks.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ArtifactReader } from "@ep0ch/outline-core/artifacts";

/** How long a path the owner's page hands its frame keeps working: the frame loads its own files from it. */
export const OWNER_GRANT_MS = 60 * 60_000;
/** Where a share made without an outline name (a lone service) is recorded in a grant: not a valid outline name. */
export const DEFAULT_OUTLINE = "_";

export type Grant = { kind: "owner"; expires: number } | { kind: "share"; outline: string; share: string };

const keyFile = (root: string) => join(root, "key");
const keys = new Map<string, Buffer>();

/** The store's grant key, made (0600) when `create` and it is not there yet; undefined when it is not and not asked. */
export function artifactKey(root: string, create = false): Buffer | undefined {
  const known = keys.get(root);
  if (known) return known;
  const path = keyFile(root);
  if (!existsSync(path) && create) {
    try { writeFileSync(path, randomBytes(32).toString("base64url"), { flag: "wx", mode: 0o600 }); } catch { /* A concurrent maker won: read theirs. */ }
  }
  if (!existsSync(path)) return undefined;
  const key = Buffer.from(readFileSync(path, "utf8").trim(), "base64url");
  if (key.length < 32) return undefined;
  keys.set(root, key);
  return key;
}

const mac = (key: Buffer, ...parts: (string | number)[]) => createHmac("sha256", key).update(parts.join("\0")).digest("base64url");
const same = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** The path below the artifact host's origin that opens `ref` for `reader`. */
export function grantPath(key: Buffer, reader: ArtifactReader, ref: string, options: { now?: number; outline?: string } = {}): string {
  const now = options.now ?? Date.now();
  const name = encodeURIComponent(ref);
  if ("owner" in reader) {
    const expires = Math.floor((now + OWNER_GRANT_MS) / 1000);
    return `/k/${expires}.${mac(key, "owner", expires, ref)}/${name}/`;
  }
  const where = options.outline || DEFAULT_OUTLINE;
  return `/s/${where}/${reader.share.id}.${mac(key, "share", where, reader.share.id, ref)}/${name}/`;
}

export interface ParsedGrant { grant: Grant; ref: string; rest: string[] }

/**
 * A request path's grant, when it carries a genuine one for the artifact it names: the pieces after it (the file inside
 * the artifact). Whether a share is still open is the caller's to ask; an owner's expiry is checked here.
 */
export function parseGrant(key: Buffer | undefined, parts: string[], now = Date.now()): ParsedGrant | "expired" | null {
  if (!key) return null;
  if (parts[0] === "k" && parts.length >= 3) {
    const [expires, given] = parts[1]!.split(".");
    const ref = parts[2]!;
    if (!expires || !given || !/^\d{1,12}$/.test(expires) || !same(given, mac(key, "owner", expires, ref))) return null;
    if (Number(expires) * 1000 < now) return "expired";
    return { grant: { kind: "owner", expires: Number(expires) }, ref, rest: parts.slice(3) };
  }
  if (parts[0] === "s" && parts.length >= 4) {
    const outline = parts[1]!;
    const [share, given] = parts[2]!.split(".");
    const ref = parts[3]!;
    if (!share || !given || !/^[a-z0-9_-]{1,32}$/.test(outline) || !/^[0-9a-f]{8}$/.test(share) || !same(given, mac(key, "share", outline, share, ref))) return null;
    return { grant: { kind: "share", outline, share }, ref, rest: parts.slice(4) };
  }
  return null;
}

/** The web client's mount on its origin (`publish serve --base-path`, `/pub` everywhere it runs). */
export const WEB_ROOT = "/pub";

/** Where the web client is reached when EP0CH_WEB_URL names nowhere: the signed-in origin. */
export const DEFAULT_WEB_ORIGIN = "https://my.ep0ch.sh";

/** The web client's address with its base path (`https://my.ep0ch.sh/pub`), from EP0CH_WEB_URL (its first origin), or none. */
export function webBase(env: Record<string, string | undefined> = process.env): string | undefined {
  const first = env.EP0CH_WEB_URL?.split(",").map(origin => origin.trim()).find(Boolean);
  return first && URL.canParse(first) ? `${new URL(first).origin}${WEB_ROOT}` : undefined;
}

/** The page that opens artifact `ref` in the web client (signed in, or by a share), or none when no web client is known. */
export function artifactPageUrl(ref: string, env: Record<string, string | undefined> = process.env): string | undefined {
  const base = webBase(env);
  return base ? `${base}/a/${encodeURIComponent(ref)}/` : undefined;
}

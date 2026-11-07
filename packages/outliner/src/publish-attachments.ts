import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, extname, isAbsolute, relative, sep } from "node:path";
import { MAX_TEXT_FILE_BYTES, resolveReferencedPath } from "./files";

/**
 * Which files the publisher may serve. A published block's `[file::path]` is
 * read through the service's `files.read` (the same attachment model Detail
 * uses); this module decides first whether that path may leave the machine.
 */

export type PublishedFileType = "html" | "markdown" | "text" | "react" | "svg" | "mermaid";

/**
 * What each extension is served as. The claude.ai artifact kinds are here:
 * HTML, React (`.jsx`/`.tsx`, compiled by `publish-artifacts.ts`), SVG,
 * mermaid and markdown; a code artifact downloads under its language's
 * extension and is served as plain text, as claude.ai shows it.
 */
export const PUBLISHED_FILE_TYPES: Readonly<Record<string, PublishedFileType>> = {
  ".html": "html",
  ".htm": "html",
  ".md": "markdown",
  ".markdown": "markdown",
  ".txt": "text",
  ".jsx": "react",
  ".tsx": "react",
  ".svg": "svg",
  ".mermaid": "mermaid",
  ".mmd": "mermaid",
  ...Object.fromEntries([
    ".js", ".mjs", ".ts", ".py", ".css", ".json", ".csv", ".sh", ".yaml", ".yml", ".toml", ".sql",
    ".rs", ".go", ".java", ".c", ".h", ".cpp", ".rb", ".php", ".swift", ".kt", ".lua",
  ].map((extension) => [extension, "text" as const])),
};

export type AttachmentRefusal =
  | "parent-segment"
  | "outside-roots"
  | "hidden-path"
  | "missing"
  | "not-a-file"
  | "too-large"
  | "unsupported-type"
  | "no-roots"
  | "remote-service";

export type AttachmentCheck =
  | {
    ok: true;
    /** The canonical path (symlinks resolved) that is inside an allowed root. */
    path: string;
    type: PublishedFileType;
    size: number;
    mtimeNs: string;
    updatedAt: string;
  }
  | { ok: false; refusal: AttachmentRefusal; reason: string };

export interface AttachmentPolicy {
  /** Canonical allowed roots (see `canonicalPublishRoots`). */
  readonly roots: readonly string[];
  /** Relative `[file::]` paths resolve against this, as the service resolves them. */
  readonly workspaceRoot: string;
  readonly maxBytes: number;
  readonly homeDirectory?: string;
  /** The service reads files on another machine, so no local check can vouch for them. */
  readonly remoteService?: boolean;
}

/**
 * Resolves each configured root to its real path. A root that does not exist is
 * dropped (and reported); `/` and the home folder are refused outright, since
 * they would allow nearly every file (the folder rule never binds them either).
 */
export function canonicalPublishRoots(
  roots: readonly string[],
  homeDirectory = homedir(),
): { roots: string[]; problems: string[] } {
  let home: string | null = null;
  try { home = realpathSync(homeDirectory); } catch { /* no home folder to refuse */ }
  const canonical: string[] = [];
  const problems: string[] = [];
  for (const root of roots) {
    let real: string;
    try {
      real = realpathSync(root);
      if (!statSync(real).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      problems.push(`publish root ${root} is unavailable: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    if (real === sep) {
      problems.push(`publish root ${root} is the filesystem root; refused`);
      continue;
    }
    if (real === home) {
      problems.push(`publish root ${root} is the home folder; refused (pass a narrower --root)`);
      continue;
    }
    if (!canonical.includes(real)) canonical.push(real);
  }
  return { roots: canonical, problems };
}

function refuse(refusal: AttachmentRefusal, reason: string): { ok: false; refusal: AttachmentRefusal; reason: string } {
  return { ok: false, refusal, reason };
}

/** The path of `path` below `root`, or null when it is not inside it. */
function inside(root: string, path: string): string | null {
  const fromRoot = relative(root, path);
  if (fromRoot === "") return "";
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) return null;
  return fromRoot;
}

/**
 * Decides whether an attachment may be served. Checks, in order: no `..`
 * segment in the authored path; the real path (every symlink resolved) lies
 * inside an allowed root; no hidden segment below that root (`.git`, `.env`,
 * `.ssh`); a regular file (not a device, FIFO, socket or directory); within the
 * size cap; and a servable type. It reads no content.
 */
export function checkAttachment(sourcePath: string, policy: AttachmentPolicy): AttachmentCheck {
  return checkServable(sourcePath, policy, Math.min(policy.maxBytes, MAX_TEXT_FILE_BYTES), (extension) => PUBLISHED_FILE_TYPES[extension]);
}

/** The image types a published page shows (a media line's `[img::path]`), each with the type it is served as. */
export const PUBLISHED_IMAGE_TYPES: Readonly<Record<string, string>> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

/** An image is larger than a text attachment can be: a screenshot or a photo. */
export const MAX_PUBLISHED_IMAGE_BYTES = 20 * 1024 * 1024;

export type ImageCheck =
  | { ok: true; path: string; mime: string; size: number; mtimeNs: string; updatedAt: string; dev: bigint; ino: bigint }
  | { ok: false; refusal: AttachmentRefusal; reason: string };

/** Whether a media line's image may be served: the attachment rules (roots, no `..`, nothing hidden), image types only. */
export function checkImage(sourcePath: string, policy: AttachmentPolicy): ImageCheck {
  const check = checkServable(sourcePath, policy, MAX_PUBLISHED_IMAGE_BYTES, (extension) => PUBLISHED_IMAGE_TYPES[extension]);
  return check.ok ? { ok: true, path: check.path, mime: check.type, size: check.size, mtimeNs: check.mtimeNs, updatedAt: check.updatedAt, dev: check.dev, ino: check.ino } : check;
}

/**
 * The bytes of an image `checkImage` allowed, or null: read from one open file that is the very file checked (its
 * device and inode), so a link swapped in after the check, here or in a folder above it, is never followed out.
 */
export function readCheckedImage(check: Extract<ImageCheck, { ok: true }>): Buffer | null {
  let fd: number | undefined;
  try {
    fd = openSync(check.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== check.dev || opened.ino !== check.ino || opened.size > BigInt(MAX_PUBLISHED_IMAGE_BYTES)) return null;
    return readFileSync(fd);
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function checkServable<T>(sourcePath: string, policy: AttachmentPolicy, cap: number, typeOf: (extension: string) => T | undefined):
  | { ok: true; path: string; type: T; size: number; mtimeNs: string; updatedAt: string; dev: bigint; ino: bigint }
  | { ok: false; refusal: AttachmentRefusal; reason: string } {
  if (policy.remoteService) return refuse("remote-service", "The service runs on another machine");
  if (!policy.roots.length) return refuse("no-roots", "No publish roots are configured");
  if (sourcePath.includes("\0")) return refuse("parent-segment", "Attachment path contains a NUL byte");
  if (sourcePath.split(/[\\/]/).includes("..")) {
    return refuse("parent-segment", "Attachment path contains a .. segment");
  }
  let resolved: string;
  try {
    resolved = resolveReferencedPath(sourcePath, policy.workspaceRoot, policy.homeDirectory);
  } catch {
    // The resolver's message quotes the path; the reason is shown to readers, so it doesn't.
    return refuse("outside-roots", "Attachment path is not supported");
  }
  let real: string;
  try {
    real = realpathSync(resolved);
  } catch {
    // A dangling link or a missing file: say only that it is missing.
    try { lstatSync(resolved); } catch { return refuse("missing", "Attachment does not exist"); }
    return refuse("missing", "Attachment is a dangling link");
  }
  let below: string | null = null;
  for (const root of policy.roots) {
    below = inside(root, real);
    if (below !== null) break;
  }
  if (below === null || below === "") return refuse("outside-roots", "Attachment is outside the publish roots");
  if (below.split(sep).some((segment) => segment.startsWith("."))) {
    return refuse("hidden-path", "Attachment is in a hidden file or folder");
  }
  let stat;
  try {
    stat = statSync(real, { bigint: true });
  } catch {
    return refuse("missing", "Attachment does not exist");
  }
  if (!stat.isFile()) return refuse("not-a-file", "Attachment is not a regular file");
  if (stat.size > BigInt(cap)) return refuse("too-large", `Attachment exceeds ${cap} bytes`);
  const type = typeOf(extname(real).toLowerCase());
  if (type === undefined) return refuse("unsupported-type", `Attachment type ${extname(real) || "(none)"} is not served`);
  return {
    ok: true,
    path: real,
    type,
    size: Number(stat.size),
    mtimeNs: stat.mtimeNs.toString(),
    updatedAt: new Date(Number(stat.mtimeMs)).toISOString(),
    dev: stat.dev,
    ino: stat.ino,
  };
}

/**
 * Where a picture on a page is served from (`at`) when `shown` and `checkImage` allows it; when it doesn't, the
 * signed-in owner's reason with the line that fixes it (PIE-1633), and null for anyone else.
 */
export function imageSource(policy: AttachmentPolicy | null, path: string, at: string, shown: boolean, owner: boolean, outline: string | undefined): string | { said: string } | null {
  if (!shown || !policy) return null;
  const check = checkImage(path, policy);
  return check.ok ? at : owner ? { said: imageRefusalWhy(check, path, policy, publisherUnit(outline)) } : null;
}

/**
 * The systemd unit this publisher runs as, named in a fix (PIE-1633): its own `outliner-publish…` unit when its
 * cgroup says so, else `outliner-publish-<outline>`, the name an install gives it.
 */
export function publisherUnit(outline: string | undefined, cgroup = (() => { try { return readFileSync("/proc/self/cgroup", "utf8"); } catch { return ""; } })()): string {
  return /\/(outliner-publish[^/\s]*)\.service\b/.exec(cgroup)?.[1] ?? (outline ? `outliner-publish-${outline}` : "outliner-publish");
}

/**
 * Why an image `checkImage` refused isn't on the page, and the line that fixes it, for the signed-in owner only
 * (PIE-1633; a refusal's own `reason` is what a reader may see, so it never names a path): the folder to add for one
 * outside the roots, on `publisher` (its systemd unit). Commands are in backticks.
 */
export function imageRefusalWhy(check: Extract<ImageCheck, { ok: false }>, sourcePath: string, policy: AttachmentPolicy, publisher: string): string {
  let where = sourcePath;
  try { where = resolveReferencedPath(sourcePath, policy.workspaceRoot, policy.homeDirectory); } catch { /* said as written */ }
  let real = where;
  try { real = realpathSync(where); } catch { /* missing: said as resolved */ }
  switch (check.refusal) {
    case "outside-roots": {
      const folder = dirname(real);
      return `${folder} is outside this publisher's roots. Add \`--root ${folder}\` to \`${publisher}\`, then \`systemctl --user restart ${publisher}\`.`;
    }
    case "no-roots": return `This publisher has no roots to serve pictures from. Add \`--root ${dirname(real)}\` to \`${publisher}\`, then \`systemctl --user restart ${publisher}\`.`;
    case "missing": return `${where} isn't there${check.reason.includes("dangling") ? " (a link to nothing)" : ""}: fix the path on the line, or put the file back.`;
    case "unsupported-type": return `Pages show ${listed(Object.keys(PUBLISHED_IMAGE_TYPES))} pictures, not ${extname(real) || "a file with no extension"}.`;
    case "remote-service": return `The outline's service runs on another machine, so this publisher can't read its files: run \`${publisher}\` on that machine.`;
    case "too-large": return `${where} is larger than a page serves (${MAX_PUBLISHED_IMAGE_BYTES / 1024 / 1024} MB).`;
    case "hidden-path": return `${where} is in a hidden file or folder, which a page never serves: move it out.`;
    case "not-a-file": return `${where} isn't a regular file.`;
    case "parent-segment": return `The path has a .. in it, which a page never serves: write it without one.`;
  }
}

const listed = (items: readonly string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

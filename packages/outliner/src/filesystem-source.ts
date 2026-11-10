// A filesystem Source's root and what may be read under it: the root's binding (the directory it was registered
// against, by path, device and inode), how the root drifted since, the rebind command a refusal names, and the
// confinement check every filesystem read and save passes (no escape from the root, no symlinks, no file in the
// middle of a path). `ResourceCatalog` (resource-catalog.ts) asks these; files.ts reads the bytes.
import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { ResourceCatalogError, type ResourceAddress } from "./resources";

/** Whether a path relative to a root (`relative(root, path)`) leaves it: up past it, or onto another drive. The root itself ("") is inside. */
export function escapesRoot(fromRoot: string): boolean {
  return fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot);
}

export function filesystemRootBinding(root: string): string {
  try {
    const canonical = realpathSync(root);
    const stat = statSync(canonical, { bigint: true });
    if (!stat.isDirectory()) throw new Error("root is not a directory");
    return JSON.stringify({
      path: canonical,
      device: stat.dev.toString(),
      inode: stat.ino.toString(),
    });
  } catch (error) {
    throw new ResourceCatalogError(
      "source-unavailable",
      `Filesystem source root is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * How a filesystem Source's root compares with the directory it was bound to: the same directory; the same place
 * holding a new directory (deleted and made again, a sync's rename into place: a new inode); or a place that now
 * resolves to another directory (a symlink retargeted, a folder moved over it).
 */
export function filesystemRootDrift(
  root: string,
  rootBinding: string,
): { kind: "same" } | { kind: "recreated"; binding: string } | { kind: "moved"; was: string; now: string } {
  const binding = filesystemRootBinding(root);
  if (binding === rootBinding) return { kind: "same" };
  const now = (JSON.parse(binding) as { path: string }).path;
  let was: string | undefined;
  try {
    was = (JSON.parse(rootBinding) as { path?: unknown }).path as string | undefined;
  } catch {
    was = undefined;
  }
  return was === now ? { kind: "recreated", binding } : { kind: "moved", was: was ?? "an unknown folder", now };
}

/** A path as a person reads it: under their home, from `~`. */
export function homeWords(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(`${home}${sep}`) ? `~${path.slice(home.length)}` : path;
}

/** A path as a shell takes it: quoted when it has anything but the plain characters. */
function shellWord(path: string): string {
  return /^[\w@%+=:,./~-]+$/.test(path) ? path : `'${path.replaceAll("'", `'\\''`)}'`;
}

/**
 * The command that binds a Source's root to the directory it resolves to now (`ep0ch resource rebind`). The path is
 * the host's, in full: a `~` would be the home of whichever machine's shell runs it.
 */
export function rebindCommand(root: string, outline?: string): string {
  return `ep0ch resource rebind ${shellWord(root)}${outline ? ` --ws ${shellWord(outline)}` : ""}`;
}

export function sourceMoved(root: string, was: string, now: string, outline?: string): ResourceCatalogError {
  return new ResourceCatalogError(
    "source-moved",
    `${homeWords(root)} now leads to ${homeWords(now)}, not ${homeWords(was)} where its files were registered, so they aren't read from it. ` +
      `If ${homeWords(now)} is where they live now: ${rebindCommand(root, outline)}`,
  );
}

export function assertFilesystemConfinement(
  root: string,
  rootBinding: string | null,
  address: Extract<ResourceAddress, { kind: "filesystem" }>,
  outline?: string,
): void {
  if (!rootBinding) {
    throw new ResourceCatalogError("source-unavailable", "Filesystem source has no root binding");
  }
  const drift = filesystemRootDrift(root, rootBinding);
  if (drift.kind === "moved") throw sourceMoved(root, drift.was, drift.now, outline);
  if (drift.kind === "recreated") {
    throw new ResourceCatalogError(
      "source-unavailable",
      `${homeWords(root)} was replaced during this read or save of one of its files; try again`,
    );
  }
  const boundRoot = realpathSync(root);
  const candidate = join(boundRoot, ...address.path.split("/"));
  const fromRoot = relative(boundRoot, candidate);
  if (escapesRoot(fromRoot)) {
    throw new ResourceCatalogError(
      "outside-source",
      "Filesystem resource path cannot escape its source root",
    );
  }
  let current = boundRoot;
  for (const segment of address.path.split("/")) {
    if (segment === ".") continue;
    current = join(current, segment);
    try {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        throw new ResourceCatalogError(
          "symlink-disallowed",
          `Filesystem resource path contains a symbolic link: ${segment}`,
        );
      }
      if (!stat.isDirectory() && current !== candidate) {
        throw new ResourceCatalogError(
          "outside-source",
          `Filesystem resource path descends through a non-directory: ${segment}`,
        );
      }
    } catch (error) {
      if (error instanceof ResourceCatalogError) throw error;
      if (
        typeof error === "object" && error !== null && "code" in error &&
        error.code === "ENOENT"
      ) {
        return;
      }
      throw new ResourceCatalogError(
        "source-unavailable",
        `Filesystem resource prefix is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

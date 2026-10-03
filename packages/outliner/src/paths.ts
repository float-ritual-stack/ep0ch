import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import {
  DOT_EP0CH,
  formatDotEp0ch,
  type LocationReader,
  nearestDotEp0ch,
  outlineLayout,
  outlinesFolder,
  whichOutline,
  type WhichOutline,
} from "@ep0ch/outline-core/outline-location";

export { isOutlineName, OUTLINE_NAME_PATTERN, slugifyOutlineName } from "@ep0ch/outline-core/outline-location";

/*
 * Where outlines live and which one a client opens (PIE-530). The rule itself is outline-core's
 * `whichOutline` (`--ws`, then EP0CH_WS, then the nearest `.ep0ch`); this file applies it with the disk and the
 * environment for every outliner process. The door applies the same function.
 */

export interface OutlinerPaths {
  /** Where this process keeps its own files for the outline: the host's side folder, or a client's `.clients/<name>/`. */
  stateDir: string;
  /** `<outlines>/<name>.sqlite`; empty when the outline is on another machine or none is named. */
  database: string;
  socket: string;
  /** The folder this client acts for (OUTLINER_WORKSPACE_ROOT, else the current directory). */
  workspaceRoot: string;
}

/**
 * How a client reaches its outline: `host` is this machine's outline host; `remote` is EP0CH_SOCKET, a host
 * elsewhere (an SSH-forwarded socket). Either way `outline` names it.
 */
export interface OutlinerClientPaths extends OutlinerPaths {
  mode: "host" | "remote";
  /** The outline every request names; absent when nothing names one (`unnamed` says why). */
  outline?: string;
  /** How `outline` was chosen: EP0CH_WS (an opener passes `--ws` on as it), a `.ep0ch`, or the invoking pane's outline (Herdr actions). */
  outlineSource?: "env" | "file" | "pane";
  /** The `.ep0ch` that named it. */
  configPath?: string;
  /** Nothing names an outline here: init (with `guess`), pick or import. A client for these paths refuses every request. */
  unnamed?: string;
  guess?: { name: string; folder: string };
}

/** The disk, as the location rule reads it. */
export const diskReader: LocationReader = {
  readFile(path) {
    try { return readFileSync(path, "utf8"); }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT" || code === "ENOTDIR") return undefined;
      throw new Error(`Could not read ${path}`, { cause: error });
    }
  },
  exists: existsSync,
};

function homeOf(env: NodeJS.ProcessEnv): string {
  return resolve(env.HOME?.trim() || homedir());
}

/** The outlines folder: EP0CH_OUTLINES, else `~/outlines`. */
export function resolveOutlinesFolder(env: NodeJS.ProcessEnv = process.env): string {
  return outlinesFolder({ EP0CH_OUTLINES: env.EP0CH_OUTLINES }, homeOf(env));
}

/** The outlines folder's layout (outline-core `outlineLayout`). */
export function outlinesLayout(env: NodeJS.ProcessEnv = process.env) {
  return outlineLayout(resolveOutlinesFolder(env));
}

/** The folder a client acts for: OUTLINER_WORKSPACE_ROOT (a Herdr pane runs from the plugin's root), else the current directory. */
export function invocationFolder(env: NodeJS.ProcessEnv = process.env): string {
  return resolve(env.OUTLINER_WORKSPACE_ROOT?.trim() || process.cwd());
}

/** The rule for `folder`: EP0CH_WS, else the nearest `.ep0ch`, else unnamed with the guess offered at init. */
export function whichOutlineFor(folder: string, env: NodeJS.ProcessEnv = process.env): WhichOutline {
  return whichOutline({ env: env.EP0CH_WS, folder, home: homeOf(env), fs: diskReader });
}

/** The folder that names an outline for `folder` (its nearest `.ep0ch`), never a guess; undefined when none does. */
export function boundFolderOf(folder: string): { folder: string; configPath: string; outline: string } | undefined {
  const dot = nearestDotEp0ch(folder, diskReader);
  return dot ? { folder: dot.folder, configPath: dot.file, outline: dot.name } : undefined;
}

/**
 * Names `folder`'s outline: writes `<folder>/.ep0ch`. Refuses (code EEXIST) to replace one that names another
 * outline unless `replace` (the outline switcher). Written beside and renamed over, so a reader never sees half.
 */
export function writeDotEp0ch(folderInput: string, name: string, options: { replace?: boolean } = {}): string {
  const folder = resolve(folderInput);
  const file = join(folder, DOT_EP0CH);
  const text = formatDotEp0ch(name);
  const current = diskReader.readFile(file);
  if (current === text) return file;
  if (current !== undefined && !options.replace) {
    const error = new Error(`${file} already names an outline; it was left as it is`) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  mkdirSync(folder, { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o644 });
  renameSync(temporary, file);
  return file;
}

/** The socket clients use: EP0CH_SOCKET (a host elsewhere) when set, else this machine's host. */
export function clientSocket(env: NodeJS.ProcessEnv = process.env): { socket: string; remote: boolean } {
  const configured = env.EP0CH_SOCKET?.trim();
  if (!configured) return { socket: outlinesLayout(env).socket, remote: false };
  if (!isAbsolute(configured)) throw new Error("EP0CH_SOCKET must be an absolute Unix socket path");
  return { socket: configured, remote: true };
}

/**
 * Where a client connects and which outline it names: the socket (EP0CH_SOCKET, else this machine's host under
 * the outlines folder) and the outline by `whichOutlineFor` the invoking folder. Reads only; creates nothing.
 */
export function resolveClientPaths(env: NodeJS.ProcessEnv = process.env): OutlinerClientPaths {
  const workspaceRoot = invocationFolder(env);
  const { socket, remote } = clientSocket(env);
  const layout = outlinesLayout(env);
  const mode = remote ? "remote" as const : "host" as const;
  const which = whichOutlineFor(workspaceRoot, env);
  if (which.kind === "unnamed") {
    return {
      mode, socket, workspaceRoot, database: "", stateDir: join(layout.root, ".clients"),
      unnamed: which.reason, ...(which.guess ? { guess: which.guess } : {}),
    };
  }
  return {
    mode, socket, workspaceRoot, outline: which.name,
    outlineSource: which.source === "file" ? "file" : "env",
    ...(which.file ? { configPath: which.file } : {}),
    database: remote ? "" : layout.database(which.name),
    stateDir: layout.clientDir(which.name),
  };
}

/** What says where a client's outline is; every pane or popup an outliner process opens is given these as it has them. */
export const OUTLINE_ENV = ["EP0CH_OUTLINES", "EP0CH_SOCKET", "EP0CH_WS"] as const;

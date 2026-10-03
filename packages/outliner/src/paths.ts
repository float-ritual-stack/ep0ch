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
 * How a client reaches its outline: `host` is this machine's outline host; `remote` is another machine's, through the
 * forward to `machine` (EP0CH_MACHINE, a `.ep0ch`'s `machine`), or a socket named outright (EP0CH_SOCKET). Either way
 * `outline` names it.
 */
export interface OutlinerClientPaths extends OutlinerPaths {
  mode: "host" | "remote";
  /** The machine the host is on, by its ssh config name; its forward is started before a client connects. */
  machine?: string;
  /** The outlines folder this was resolved in (EP0CH_OUTLINES, else ~/outlines). */
  outlinesFolder: string;
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

/**
 * The rule for `folder`: EP0CH_WS, else the nearest `.ep0ch`, else unnamed with the guess offered at init; the machine
 * by EP0CH_MACHINE, else that `.ep0ch`'s.
 */
export function whichOutlineFor(folder: string, env: NodeJS.ProcessEnv = process.env): WhichOutline {
  return whichOutline({ env: env.EP0CH_WS, machineEnv: env.EP0CH_MACHINE, folder, home: homeOf(env), fs: diskReader });
}

/** The folder that names an outline for `folder` (its nearest `.ep0ch`), never a guess; undefined when none does. */
export function boundFolderOf(folder: string): { folder: string; configPath: string; outline: string; machine?: string } | undefined {
  const dot = nearestDotEp0ch(folder, diskReader);
  return dot ? { folder: dot.folder, configPath: dot.file, outline: dot.name, ...(dot.machine ? { machine: dot.machine } : {}) } : undefined;
}

/**
 * Names `folder`'s outline (and its machine, when it is on another one): writes `<folder>/.ep0ch`. Refuses (code
 * EEXIST) to replace one that names another outline unless `replace` (the outline switcher). Written beside and
 * renamed over, so a reader never sees half.
 */
export function writeDotEp0ch(folderInput: string, name: string, options: { replace?: boolean; machine?: string } = {}): string {
  const folder = resolve(folderInput);
  const file = join(folder, DOT_EP0CH);
  const text = formatDotEp0ch(name, options.machine);
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

/**
 * The socket clients use: EP0CH_SOCKET (any host's socket, named outright) when set, else the forward to `machine`
 * when one is named, else this machine's host. `machine` is said back only when its forward is the socket.
 */
export function clientSocket(env: NodeJS.ProcessEnv = process.env, machine?: string): { socket: string; remote: boolean; machine?: string } {
  const configured = env.EP0CH_SOCKET?.trim();
  if (configured) {
    if (!isAbsolute(configured)) throw new Error("EP0CH_SOCKET must be an absolute Unix socket path");
    return { socket: configured, remote: true };
  }
  if (machine) return { socket: outlinesLayout(env).remote(machine).socket, remote: true, machine };
  return { socket: outlinesLayout(env).socket, remote: false };
}

/** The machine a host-level request from `env`'s folder goes to (EP0CH_MACHINE, else its `.ep0ch`'s), or none. */
export function machineFor(env: NodeJS.ProcessEnv = process.env): string | undefined {
  try { return whichOutlineFor(invocationFolder(env), env).machine; } catch { return env.EP0CH_MACHINE?.trim() || undefined; }
}

/**
 * Where a client connects and which outline it names: the socket (EP0CH_SOCKET, else the named machine's forward,
 * else this machine's host under the outlines folder) and the outline by `whichOutlineFor` the invoking folder. Reads
 * only; creates nothing and starts no forward (a client does, `createOutlinerClient`).
 */
export function resolveClientPaths(env: NodeJS.ProcessEnv = process.env): OutlinerClientPaths {
  const workspaceRoot = invocationFolder(env);
  const which = whichOutlineFor(workspaceRoot, env);
  const { socket, remote, machine } = clientSocket(env, which.machine);
  const layout = outlinesLayout(env);
  const mode = remote ? "remote" as const : "host" as const;
  const on = { outlinesFolder: layout.root, ...(machine ? { machine } : {}) };
  if (which.kind === "unnamed") {
    return {
      mode, socket, workspaceRoot, database: "", stateDir: join(layout.root, ".clients"), ...on,
      unnamed: which.reason, ...(which.guess ? { guess: which.guess } : {}),
    };
  }
  return {
    mode, socket, workspaceRoot, outline: which.name, ...on,
    outlineSource: which.source === "file" ? "file" : "env",
    ...(which.file ? { configPath: which.file } : {}),
    database: remote ? "" : layout.database(which.name),
    stateDir: layout.clientDir(which.name),
  };
}

/** What to check when the host of a `remote` client doesn't answer: the machine's forward, or whatever serves EP0CH_SOCKET. */
export function remoteHint(paths: { machine?: string }): string {
  return paths.machine
    ? `Check the forward to ${paths.machine} (\`ep0ch --machine ${paths.machine}\` starts it; \`ssh ${paths.machine} true\` must log in without asking) and the outline host there (\`ssh ${paths.machine} ep0ch status\`).`
    : "Check what serves EP0CH_SOCKET and the outline host at its other end.";
}

/** What says where a client's outline is; every pane or popup an outliner process opens is given these as it has them. */
export const OUTLINE_ENV = ["EP0CH_OUTLINES", "EP0CH_SOCKET", "EP0CH_WS", "EP0CH_MACHINE"] as const;

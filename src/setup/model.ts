// `ep0ch doctor` and `ep0ch install` (PIE-450): what a machine's stack looks like, as plain data. `facts.ts`
// gathers it (read-only: git, Herdr, the outline sockets, the file system); `doctor.ts` and `plan.ts` only
// read it, so the tests describe a machine instead of needing one.
import type { HostedOutline } from "../socket";

export type Platform = "linux" | "macos" | "other";

/** The platform by Node's name for it. Nothing else here assumes systemd or launchd. */
export function detectPlatform(platform: string = process.platform): Platform {
  return platform === "linux" ? "linux" : platform === "darwin" ? "macos" : "other";
}

/** A git checkout compared with origin/main (after a fetch, when it could reach origin). */
export interface Checkout {
  root: string;
  git: boolean;
  /** The branch checked out; null when HEAD is detached. */
  branch: string | null;
  head: string | null;
  /** origin/main's commit, as last fetched; null when there is none. */
  upstream: string | null;
  ahead: number;
  behind: number;
  /** Tracked files changed (untracked files don't block a fast-forward). */
  dirty: boolean;
  /** Why `git fetch` failed; the comparison is then against the last fetch. */
  fetchError?: string;
}

/** Whether `bun install` is needed in a checkout, and why. */
export interface Deps { needed: boolean; why: string }

export interface PluginFacts {
  id: string;
  /** local: a checkout linked with `herdr plugin link`; github: a managed install. */
  kind: "local" | "github";
  root: string;
  manifestPath: string;
  enabled: boolean;
  /** A managed install's source, as Herdr records it. */
  source?: { owner?: string; repo?: string; ref?: string; commit?: string };
  /** The plugin root as a git checkout (a linked one; a managed one when Herdr keeps .git). */
  checkout: Checkout | null;
  /** A managed install: the source ref's commit on GitHub now (`git ls-remote`), or why it's unknown. */
  remote?: { commit: string | null; error?: string };
  /** From the installed code (src/types.ts): its wire protocol and the capabilities its service offers. */
  protocol: number | null;
  capabilities: string[] | null;
  deps: Deps | null;
  /** The plugin's action ids Herdr registered. */
  actions: string[];
}

/** A per-folder outline service: `<state>/<hash>/`, its socket and database. */
export interface ServiceFacts {
  stateDir: string;
  socket: string;
  database: string | null;
  running: boolean;
  name?: string;
  root?: string;
  protocol?: number;
  capabilities?: string[] | null;
  /** The Herdr pane running it (`service-pane.json`), when the Outliner started it in one. */
  paneId?: string;
}

export interface HostFacts {
  socket: string;
  /** An outline host is set up here (its `outlines/` folder). */
  configured: boolean;
  running: boolean;
  defaultOutline?: string;
  outlines: HostedOutline[];
  protocol?: number;
  capabilities?: string[] | null;
  /** The service unit that runs it, when there is one. Install restarts the host through it; it never edits it. */
  unit: HostUnit | null;
}

/** A launchd agent (macOS) or a systemd user unit (Linux) that runs the outline host's host-main.ts. */
export interface HostUnit {
  kind: "systemd" | "launchd";
  path: string;
  /** What launchctl or systemctl calls it: launchd's Label (else the file's name), the systemd unit's file name. */
  name: string;
  /** The host-main.ts it runs, as its file says. */
  program?: string;
  /** What launchd or systemd says about it now (absent when it wasn't asked). */
  state?: UnitState;
}

/** A unit's state: `active` null when launchd or systemd couldn't say. */
export interface UnitState { active: boolean | null; pid?: number; lastExit?: string; detail: string }

/** An outline database on this machine, and the name its backup takes. */
export interface DatabaseFacts { name: string; path: string; from: "host" | "folder" }

export interface Facts {
  platform: Platform;
  home: string;
  /** PATH, in order. */
  pathDirs: string[];
  bun: { path: string | null; version: string | null };
  herdr: {
    path: string | null; version: string | null;
    /** The server answers `herdr status server`; null when there's no herdr to ask. */
    server: boolean | null;
    /** This command runs in a Herdr pane (HERDR_ENV=1): the Outliner's launcher only starts services there. */
    inside: boolean;
    configPath: string;
    /** The key bound to each of the plugin's actions in config.toml (action id → key). */
    keys: Record<string, string>;
  };
  plugin: PluginFacts | null;
  door: { checkout: Checkout; deps: Deps; entry: string };
  /** The first `ep0ch` on PATH, what it resolves to, and whether that's this checkout. */
  ep0ch: { found: string | null; target: string | null; pointsHere: boolean };
  /** The link directories in preference order, whether each is on PATH and writable. */
  linkDirs: { dir: string; onPath: boolean; writable: boolean; existing?: "link" | "broken-link" | "file" }[];
  host: HostFacts;
  services: ServiceFacts[];
  databases: DatabaseFacts[];
  claude: {
    settingsPath: string;
    /** CLAUDE_CODE_PLUGIN_DIRS in Claude Code's settings (what new sessions load); null when unset. */
    settingsDirs: string[] | null;
    /** CLAUDE_CODE_PLUGIN_DIRS in this process's environment. */
    envDirs: string[] | null;
    forceHyperlink?: string;
  };
  /** What a current service offers: the door's capabilities and the installed plugin's. */
  expected: string[];
}

/** The plugin's actions the Outliner installer binds keys to. */
export const KEYED_ACTIONS = ["open-here", "open-tree", "comment-selection", "capture"] as const;
export const PLUGIN_ID = "float.pi-outliner";
export const PLUGIN_SOURCE = "float-ritual-stack/pi-herdr-outliner";
export const MIN_BUN = "1.3.0";

/** A running service is old when it lacks a capability the current code offers, or speaks an older protocol. */
export function staleness(s: { protocol?: number; capabilities?: string[] | null }, expected: readonly string[], protocol: number | null): string[] {
  const why: string[] = [];
  if (protocol !== null && s.protocol !== undefined && s.protocol < protocol) why.push(`protocol ${s.protocol} < ${protocol}`);
  const offered = new Set(s.capabilities ?? []);
  if (s.capabilities) why.push(...expected.filter(c => !offered.has(c)));
  return why;
}

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");

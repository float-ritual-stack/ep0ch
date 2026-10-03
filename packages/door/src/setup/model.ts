// `ep0ch doctor` and `ep0ch install` (PIE-450): what a machine's stack looks like, as plain data. `facts.ts`
// gathers it (read-only: git, Herdr, the outline host's socket, the file system); `doctor.ts` and `plan.ts` only
// read it, so the tests describe a machine instead of needing one.
//
// The stack is one checkout (the ep0ch repo: packages/outliner is the Herdr plugin and the outline host,
// packages/door is `ep0ch`, the Claude mod is in it too) and one outline host serving `<outlines>/<name>.sqlite`
// by name (PIE-530).
import type { DoorAgent } from "../desk/agent-env";
import type { HostedOutline } from "../socket";

import type { ExtFacts } from "./ext-links";
import type { StaleLink } from "./links";
import type { SkillLinkFacts } from "./skill-links";

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
  /** From the installed code (outline-core's protocol.ts): the wire protocol its service speaks. */
  protocol: number | null;
  deps: Deps | null;
  /** The plugin's action ids Herdr registered. */
  actions: string[];
}

/** The ep0ch checkout: one repo, its packages, and the protocol its code speaks. */
export interface RepoFacts {
  /** The repo root (the git checkout). */
  root: string;
  checkout: Checkout;
  /** `bun install` at the repo root (one workspace for every package). */
  deps: Deps;
  /** packages/door/src/main.ts: what `ep0ch` on PATH links to. */
  entry: string;
  /** packages/door: the door's code, what a door session runs. */
  door: string;
  /** packages/outliner: the Herdr plugin's root and the outline host's code. */
  outliner: string;
  /** The Claude mod's folder (packages/claude-mod, or packages/outliner/claude-mod), when there is one. */
  claudeMod: string | null;
  /** The Claude mod's installer script, when there is one. */
  claudeModInstaller: string | null;
  /** The protocol this checkout's code speaks (packages/outline-core/src/protocol.ts, read in a fresh process). */
  protocol: number | null;
}

export interface HostFacts {
  /** The outlines folder: EP0CH_OUTLINES, else ~/outlines. */
  folder: string;
  socket: string;
  running: boolean;
  outlines: HostedOutline[];
  protocol?: number;
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
  /** The outlines folder it serves: its EP0CH_OUTLINES, else ~/outlines. */
  outlines: string;
  /** What it still sets from before outlines by name (PIE-530): settings the host no longer reads. */
  stale: string[];
  /** What launchd or systemd says about it now (absent when it wasn't asked). */
  state?: UnitState;
}

/** A unit's state: `active` null when launchd or systemd couldn't say. */
export interface UnitState { active: boolean | null; pid?: number; lastExit?: string; detail: string }

/** An outline database on this machine (`<outlines>/<name>.sqlite`), by its name. */
export interface DatabaseFacts { name: string; path: string }

/** Which outline this folder opens (discover.resolveTarget): its name and why, or why none; and on which machine. */
export interface HereFacts { folder: string; outline?: string; why?: string; unnamed?: string; guess?: string; machine?: string }

/** Another machine the person opens outlines on (src/machine.ts): its forward as it is, and its outlines when it answers. */
export interface MachineFacts { machine: string; socket: string; answers: boolean; connected: boolean; outlines: string[] | null; here?: boolean }

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
    configPath: string;
    /** The key bound to each of the plugin's actions in config.toml (action id → key). */
    keys: Record<string, string>;
  };
  plugin: PluginFacts | null;
  repo: RepoFacts;
  /** The first `ep0ch` on PATH, what it resolves to, and whether that's this checkout. */
  ep0ch: { found: string | null; target: string | null; pointsHere: boolean };
  /** The link directories in preference order, whether each is on PATH and writable. */
  linkDirs: { dir: string; onPath: boolean; writable: boolean; existing?: "link" | "broken-link" | "file" }[];
  host: HostFacts;
  databases: DatabaseFacts[];
  /** The machines opened from the state dir, and the one this folder names: each one's forward. */
  machines?: MachineFacts[];
  /** Which outline the folder install runs in opens. */
  here?: HereFacts;
  claude: {
    settingsPath: string;
    /** CLAUDE_CODE_PLUGIN_DIRS in Claude Code's settings (what new sessions load); null when unset. */
    settingsDirs: string[] | null;
    /** CLAUDE_CODE_PLUGIN_DIRS in this process's environment. */
    envDirs: string[] | null;
    /**
     * The mod's folder list in Claude Code's settings: whether PI_OUTLINER_MENTIONS_WORKSPACES lists any, and
     * PI_OUTLINER_MENTIONS_MODE. A list with no mode is an allowlist from before folder mode (PIE-526).
     */
    mentions?: { listed: boolean; mode?: string };
    forceHyperlink?: string;
    /**
     * The Claude processes started in a door tile or a door's Herdr pane, each judged against the mod Claude
     * loads (src/desk/agent-env.ts); undefined when not looked for.
     */
    agents?: DoorAgent[];
  };
  /**
   * The door sessions in the person's state dir (PIE-418), one per outline: each one's outline and machine, its daemon,
   * the checkout and commit it runs, its attached terminals and the programs in its tiles. Undefined when not looked for.
   */
  sessions?: SessionFact[];
  /** The door's userland extensions (packages/door/ext/) and the links they ask for; undefined when not looked for. */
  ext?: { root: string; exts: ExtFacts[]; stale: StaleLink[]; record?: string };
  /** The shipped agent skills' links (Claude Code's skills folder, and ~/.agents/skills); undefined when not looked for. */
  skills?: SkillLinkFacts;
}

/** The plugin's actions the Outliner installer binds keys to. */
export const KEYED_ACTIONS = ["open-here", "open-tree", "comment-selection", "capture"] as const;
export const PLUGIN_ID = "float.pi-outliner";
/** A managed install of the plugin: the repo, and the plugin's folder in it. */
export const PLUGIN_SOURCE = "float-ritual-stack/ep0ch/packages/outliner";
export const MIN_BUN = "1.3.0";

/** A running host is stale when it speaks another protocol than the current code (outline-core's PROTOCOL). */
export function staleness(s: { protocol?: number }, protocol: number | null): string[] {
  return protocol !== null && s.protocol !== undefined && s.protocol !== protocol ? [`protocol ${protocol} (runs ${s.protocol})`] : [];
}

export const short = (sha: string | null | undefined) => (sha ? sha.slice(0, 7) : "?");

/** A door session as doctor and install see it. */
export interface SessionFact { outline: string; machine?: string; socket?: string; pid: number; dir: string; commit: string | null; clients: number; programs: number }

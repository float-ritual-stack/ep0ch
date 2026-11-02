// Door modules (PIE-1505, docs/adr/0008-extension-first.md): an extension's part that runs in the door's own process,
// for a behaviour that has to answer the pointer and the keys within a frame (a service program is a socket away, and
// on another machine for a door that calls in). The extension is an ordinary one on the service: its folder, its page,
// the extensions screen's install and uninstall, `defaultOn`. Its manifest names the module (`"door": "glass"`), and the
// door runs the module of that name it ships (packages/door/ext/<name>/) while `extensions.list` says the extension is
// served, and stops it when it isn't. A module stands on the door's primitives only: the hover event (src/hover.ts),
// a status chip (src/status-chips.ts), a Tune section (src/desk/tune.ts), the float layer (src/float-layer.ts), tile
// kinds and action sets; nothing in core names one.
import type { App } from "./app";
import type { Key } from "./term";

/** What a running module answers the door: how to stop it, and the hooks it uses. */
export interface ActiveModule {
  /** Stop: every listener, chip, section, action set and tile kind it added goes. */
  dispose(): void;
  /** A key or mouse report before the screens see it (App.route); true when it took it. */
  key?(k: Key): boolean;
  /** After each frame is painted. */
  painted?(): void;
  /** What it adds to the door's `describe` (peek --json), under its id. */
  describe?(): Record<string, unknown>;
}
export interface DoorModule {
  id: string;
  activate(app: App): ActiveModule;
}

/** The modules the door ships, by the name a manifest's `door` gives, loaded when first started (a module cycle never meets them half-built). */
const SHIPPED: Record<string, () => DoorModule> = {
  glass: () => (require("../ext/glass/glass") as typeof import("../ext/glass/glass")).GLASS_MODULE,
};
export const shippedModules = (): string[] => Object.keys(SHIPPED);

let host: App | null = null;
let wanted = new Set<string>();
const running = new Map<string, ActiveModule>();

function sync() {
  for (const [name, m] of [...running]) if (!host || !wanted.has(name)) { running.delete(name); m.dispose(); }
  if (!host) return;
  for (const name of wanted) if (!running.has(name) && SHIPPED[name]) running.set(name, SHIPPED[name]!().activate(host));
}

/**
 * The modules the served extensions name now (bindExtensions): one newly named starts, one no longer named stops.
 * Answers the names the door doesn't ship, for the bind to say.
 */
export function useDoorModules(names: Iterable<string>): string[] {
  wanted = new Set(names);
  sync();
  return [...wanted].filter(n => !SHIPPED[n]);
}
/** The door whose modules run (its App): another door taking over stops the first one's. */
export function hostDoorModules(app: App | null) {
  if (host === app) return;
  host = null; sync();
  host = app; sync();
}
/** The door `app` ended: its modules stop. */
export function releaseDoorModules(app: App) { if (host === app) hostDoorModules(null); }
export const runningModules = (): [string, ActiveModule][] => [...running];

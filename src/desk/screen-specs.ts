// The screens the door knows by name (PIE-515): each a spec (src/desk/screen-spec.ts) on the one screen host, the
// desk, and the tile kinds those specs use, registered once as the door starts. `openScreen` makes one.
import type { Screen } from "../app";
import { briefKind, briefSpec } from "../brief/brief";
import { pinnedKind, pinnedSpec } from "../hub/pinned";
import { WAITING_KIND, waitingSpec } from "../hub/waiting";
import { welcomeKinds, welcomeSpec } from "../hub/welcome";
import { boardSpec } from "./delivery";
import { riverSpec } from "../river/column";
import { Desk, deskSpec } from "./desk";
import { registerScreen, screenNames, screenSpec } from "./screen-spec";
import { registerTileKind, tileKind } from "./tile-kinds";

/** The built-in screens' kinds and specs (once: every module that opens a screen asks). */
export function registerBuiltinScreens(): void {
  for (const k of [WAITING_KIND, ...welcomeKinds(), briefKind(), pinnedKind()]) if (!tileKind(k.kind)) registerTileKind(k);
  const have = new Set(screenNames());
  const add = (name: string, of: Parameters<typeof registerScreen>[1]) => { if (!have.has(name)) registerScreen(name, of); };
  add("desk", () => deskSpec());
  add("waiting", () => waitingSpec());
  add("welcome", () => welcomeSpec());
  add("brief", () => briefSpec());
  add("pinned", args => pinnedSpec(args));
  add("board", args => boardSpec(args));
  add("river", () => riverSpec());
}
registerBuiltinScreens();

/**
 * The screen named `name`, made from its spec: a new desk showing it (the desk itself comes back running when it was
 * left with programs: `Desk.resume`). Throws when there's no such screen.
 */
export function openScreen(name: string, args?: Record<string, unknown>): Screen {
  if (name === "desk") return Desk.resume();
  const spec = screenSpec(name, args);
  if (!spec) throw new Error(`no screen ${name}; screens: ${screenNames().join(", ")}`);
  return new Desk(spec);
}

/** The delivery board (`--board <hub>`, the menu's K): `persist: false` keeps it in memory (the showcase's). */
export function boardScreen(hub?: string, persist = true): Desk {
  return new Desk(boardSpec({ ...(hub ? { hub } : {}), persist }));
}

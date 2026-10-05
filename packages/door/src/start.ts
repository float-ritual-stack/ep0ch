// Where the door opens: a start flag goes straight to its screen (over the main menu, so q comes back to
// it); without one, the logon, then the main menu, the newest daily brief (EP0CH_LANDING=brief) or the
// welcome notes (EP0CH_LANDING=welcome).
import type { Screen } from "./app";
import { Desk } from "./desk/desk";
import { openScreen } from "./desk/screen-specs";
import { MainMenu } from "./screens";
import { Showcase } from "./showcase/showcase";

/** Where the door lands after the logon: the main menu (the default), the newest daily brief, or the welcome notes. */
export type Landing = "menu" | "brief" | "welcome";
export function landingOf(env: Record<string, string | undefined>): Landing {
  const l = env.EP0CH_LANDING?.trim().toLowerCase();
  return l === "brief" || l === "welcome" ? l : "menu";
}

export interface ScreenRequest { name: string; note?: string }

export function screenRequest(args: readonly string[]): ScreenRequest | null {
  const screenAt = args.indexOf("--screen");
  if (screenAt < 0) return null;
  const name = args[screenAt + 1];
  const target = args[screenAt + 2];
  if (name !== "detail") throw new Error(`--screen supports detail; got ${name ?? "nothing"}`);
  if (!target || target.startsWith("--")) throw new Error("--screen detail needs a block id");
  return { name, note: target };
}

/**
 * The screens to push, bottom first. `logon` builds the logon screen with what it opens after the main
 * menu (nothing, or the brief).
 */
export function startScreens(args: readonly string[], env: Record<string, string | undefined>, logon: (then?: () => Screen) => Screen): Screen[] {
  const req = screenRequest(args);
  if (req) return [new MainMenu(), openScreen(req.name, req.note ? { note: req.note } : {})];
  const boardAt = args.indexOf("--board");
  if (boardAt >= 0) return [new MainMenu(), openScreen("board", args[boardAt + 1]?.startsWith("--") ? {} : { hub: args[boardAt + 1] })];
  if (args.includes("--showcase")) return [new MainMenu(), new Showcase()];
  if (args.includes("--river")) return [new MainMenu(), openScreen("river")];
  const layoutAt = args.indexOf("--layout");
  if (layoutAt >= 0 && args[layoutAt + 1]) return [new MainMenu(), new Desk(undefined, { layout: args[layoutAt + 1] })];
  if (args.includes("--desk")) return [new MainMenu(), new Desk()];
  if (args.includes("--brief")) return [new MainMenu(), openScreen("brief")];
  if (args.includes("--welcome")) return [new MainMenu(), openScreen("welcome")];
  const landing = landingOf(env);
  return [landing === "brief" ? logon(() => openScreen("brief")) : landing === "welcome" ? logon(() => openScreen("welcome")) : logon()];
}

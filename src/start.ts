// Where the door opens: a start flag goes straight to its screen (over the main menu, so q comes back to
// it); without one, the logon, then the main menu, or the newest daily brief when EP0CH_LANDING=brief.
import type { Screen } from "./app";
import { Brief } from "./brief/brief";
import { DeliveryBoard } from "./desk/delivery";
import { Desk } from "./desk/desk";
import { River } from "./river/river";
import { MainMenu } from "./screens";
import { Showcase } from "./showcase/showcase";

/** Where the door lands after the logon: the main menu (the default), or the newest daily brief. */
export type Landing = "menu" | "brief";
export function landingOf(env: Record<string, string | undefined>): Landing {
  return env.EP0CH_LANDING?.trim().toLowerCase() === "brief" ? "brief" : "menu";
}

/**
 * The screens to push, bottom first. `logon` builds the logon screen with what it opens after the main
 * menu (nothing, or the brief).
 */
export function startScreens(args: readonly string[], env: Record<string, string | undefined>, logon: (then?: () => Screen) => Screen): Screen[] {
  const boardAt = args.indexOf("--board");
  if (boardAt >= 0) return [new MainMenu(), new DeliveryBoard(args[boardAt + 1]?.startsWith("--") ? undefined : args[boardAt + 1])];
  if (args.includes("--showcase")) return [new MainMenu(), new Showcase()];
  if (args.includes("--river")) return [new MainMenu(), new River()];
  const layoutAt = args.indexOf("--layout");
  if (layoutAt >= 0 && args[layoutAt + 1]) return [new MainMenu(), new Desk(undefined, { layout: args[layoutAt + 1] })];
  if (args.includes("--desk")) return [new MainMenu(), new Desk()];
  if (args.includes("--brief")) return [new MainMenu(), new Brief()];
  return [landingOf(env) === "brief" ? logon(() => new Brief()) : logon()];
}

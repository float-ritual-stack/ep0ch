// Where the door opens. `--screen <name> [<target>]` is the one landing flag: the screen by name (a menu item or any
// registered screen, `screen.open`'s lookup), over the main menu so q comes back to it. Without it, the logon, then
// the main menu, or the screen EP0CH_LANDING names (brief, welcome, any `--screen` name) over it, through the same
// action. `--layout <name>` opens the desk laid out by name; `--showcase` the showcase.
import type { Screen } from "./app";
import { screenArg } from "./cli-words";
import { Desk } from "./desk/desk";
import { MainMenu } from "./screens";
import { Showcase } from "./showcase/showcase";

/** A screen to open by name, with its target: `screen.open`'s arguments. */
export interface ScreenRequest { name: string; target?: string }

/** The screen `--screen <name> [<target>]` asks for, or null. */
export function screenRequest(args: readonly string[]): ScreenRequest | null {
  return screenArg(args);
}

/** The screen the door lands on after the logon: EP0CH_LANDING's name (none: the main menu). */
export function landingOf(env: Record<string, string | undefined>): ScreenRequest | null {
  const name = env.EP0CH_LANDING?.trim();
  return name && name.toLowerCase() !== "menu" ? { name } : null;
}

/**
 * The screens to push, bottom first, and the screen to open over them through `screen.open` (one path for the flag,
 * a session's attach and the landing). `logon` builds the logon screen with what it opens after the main menu.
 */
export function startScreens(args: readonly string[], env: Record<string, string | undefined>, logon: (then?: ScreenRequest) => Screen): { screens: Screen[]; open?: ScreenRequest } {
  const req = screenRequest(args);
  if (req) return { screens: [new MainMenu()], open: req };
  if (args.includes("--showcase")) return { screens: [new MainMenu(), new Showcase()] };
  const layoutAt = args.indexOf("--layout");
  if (layoutAt >= 0 && args[layoutAt + 1]) return { screens: [new MainMenu(), new Desk(undefined, { layout: args[layoutAt + 1] })] };
  const landing = landingOf(env);
  return { screens: [landing ? logon(landing) : logon()] };
}

// Drop to shell: the BBS's "drop to DOS" door. The door steps aside (the same suspend as $EDITOR's ctrl+e:
// the alt screen left, the mouse off, the terminal cooked) and the person's own login shell runs in their
// real terminal; when it exits, the door takes the terminal back and repaints where it was. Only the person
// drops to a shell: it takes their terminal, so an agent's `screen.shell` is refused (src/screens.ts).
//
// Unlike $EDITOR's spawnSync, the shell is awaited: the door's event loop keeps running under it, so its
// terminal tiles keep being read (a busy agent in a tile doesn't stall on a full pty) and its control socket
// keeps answering (`peek` says `suspended: "shell"`). Nothing is painted until the shell exits.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { appendNest, doorNest, shellLayer } from "./nest";
import { DOOR_START_VARS } from "./desk/pty";
import { controlPath } from "./control";

export const SHELL_BANNER = "ep0ch · shell · exit returns to the door";

/** The person's login shell: $SHELL, else sh. */
export const loginShell = (env: Record<string, string | undefined> = process.env): string => env.SHELL?.trim() || "sh";

/**
 * The drop shell's environment: the door's own, plus EP0CH_IN_DOOR=1 (a login shell's landing guard, such as
 * float-2's ~/.bashrc, doesn't start a second door in it), EP0CH_CONTROL (this door's control socket) and
 * EP0CH_NEST with a `shell:<door pid>` layer after the ones the door inherited. It runs in the door's own
 * terminal and Herdr pane, so those variables stay; how this door was started (DOOR_START_VARS) doesn't, and
 * neither does a tile of an outer door the door itself runs in (EP0CH_TILE, EP0CH_TILE_ID): EP0CH_CONTROL
 * now names this door, which has no such tile.
 */
export function shellEnv(env: Record<string, string | undefined>, control: string | null, pid = process.pid): Record<string, string> {
  const drop = new Set<string>([...DOOR_START_VARS, "EP0CH_TILE", "EP0CH_TILE_ID"]);
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(env)) if (v !== undefined && !drop.has(k)) out[k] = v;
  out.EP0CH_IN_DOOR = "1";
  if (control) out.EP0CH_CONTROL = control; else delete out.EP0CH_CONTROL;
  out.EP0CH_NEST = appendNest(doorNest(env), shellLayer(pid));
  return out;
}

/** Where the shell starts: the door's folder, else $HOME. */
export function shellCwd(cwd = process.cwd(), home = process.env.HOME || homedir()): string {
  return cwd && existsSync(cwd) ? cwd : home;
}

/** Run the person's login shell in the terminal (already handed over by `suspend`); its exit code. */
export async function runLoginShell(control: string | null = controlPath): Promise<number | null> {
  const shell = loginShell();
  if (process.stdout.isTTY) process.stdout.write(`\x1b[2J\x1b[H${SHELL_BANNER}\n`);
  const opts = { cwd: shellCwd(), env: shellEnv(process.env, control), stdio: ["inherit", "inherit", "inherit"] as ["inherit", "inherit", "inherit"] };
  let p;
  try { p = Bun.spawn([shell, "-l"], opts); }
  catch { p = Bun.spawn(["sh", "-l"], opts); }   // $SHELL names a program that isn't there
  return await p.exited;
}

/** How `screen.shell` runs the shell once the terminal is handed over (a test gives its own). */
export const shellRunner: { run: () => Promise<number | null> } = { run: () => runLoginShell() };

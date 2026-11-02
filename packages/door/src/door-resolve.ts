// Which door a program reaches, as one sentence and a rule (PIE-715). The order the ep0ch skill states: the door on
// EP0CH_CONTROL (followed to its outline's session by EP0CH_PLACE, outline-core's door-reach.ts), else the door of the
// outline this folder names, else the only door running. `ep0ch where`, `ep0ch doctor` and the Claude mod all ask this
// one function, so a Claude that doesn't descend from a tile (a background job, a resumed session) still finds the door.
// A dead EP0CH_CONTROL outside its EP0CH_PLACE is refused (PIE-1363), and nothing falls through after it: an agent that set
// its own socket with the person's place inherited reaches no door, never theirs by folder.
// A program in an ssh session that came from a machine whose doors a link carries here (PIE-1242: Claude on float-box,
// in a terminal tile of the laptop's door, ssh'd in) reaches that machine's door, the one the person is looking at,
// before the folder's: `ssh` (src/remote-doors.ts).
import { listening } from "./jsonl";
import { reachControl } from "./control";
import { controlFor, placeFor, placeLabel } from "./session/place";

/** `control`: EP0CH_CONTROL (or its outline's session by EP0CH_PLACE); `folder`: the outline this folder names; `only`: the one door running; `none`. */
export type DoorRule = "control" | "ssh" | "folder" | "only" | "none";
export interface DoorResolution {
  rule: DoorRule;
  /** The control socket to use; null for `none`. */
  path: string | null;
  /** The outline whose door it is (a `folder` match), when known. */
  outline: string | null;
  /** Plain words: which rule matched and what it means for the keys; for `none`, why and the command to start one. */
  text: string;
  /** EP0CH_CONTROL was refused (PIE-1363): `none` because the program's own socket answers nothing, not for want of a door. */
  refused?: true;
}

const NOT_TILE = "you are not in a tile of it, so your keys are not the person's: act as an agent (`--as <your name>`), never as their keys";

export async function resolveDoor(env: Record<string, string | undefined> = process.env, cwd = process.cwd(), args: readonly string[] = []): Promise<DoorResolution> {
  const given = env.EP0CH_CONTROL?.trim() || null;
  const reached = await reachControl(env).catch(() => null);
  if (reached?.refused) return { rule: "none", path: null, outline: null, text: reached.refused, refused: true };
  if (reached?.path && await listening(reached.path)) {
    return { rule: "control", path: reached.path, outline: null, text: `reached the door on EP0CH_CONTROL${reached.stale ? ` (${reached.stale})` : ""}` };
  }
  const gone = given ? `EP0CH_CONTROL (${given}) has no door now; ` : "";
  const from = (env.SSH_CONNECTION || env.SSH_CLIENT)?.trim().split(/\s+/)[0];
  if (from && env.EP0CH_DOOR_SSH !== "0") {
    const { machineAtAddress, reachMachineDoor } = await import("./remote-doors");
    const machine = await machineAtAddress(from, env).catch(() => null);
    if (machine) {
      const named = placeFor(args, env, cwd);
      const outline = named && !("error" in named) ? named.outline : undefined;
      // The door on this folder's outline there, else the one the person typed in last.
      let reached = outline ? await reachMachineDoor(machine, { outline }, env) : null;
      if (!reached || "error" in reached) reached = await reachMachineDoor(machine, {}, env);
      if (!("error" in reached)) {
        return { rule: "ssh", path: reached.control, outline: reached.door.outline, text: `${gone}reached ${machine}'s door on ${reached.door.key}, where this ssh session comes from${reached.via ? ` (through ${reached.via}'s link)` : " (through its link)"}; act there as an agent (\`--as <your name>\`), never as the person's keys` };
      }
    }
  }
  const found = await controlFor(env, cwd, args);
  if (typeof found === "object") return { rule: "none", path: null, outline: null, text: `${gone}${found.error}` };
  const named = placeFor(args, env, cwd);
  if (named && !("error" in named)) {
    return { rule: "folder", path: found, outline: named.outline, text: `${gone}reached ${placeLabel(named)}'s door session by folder (the outline this folder names); ${NOT_TILE}` };
  }
  return { rule: "only", path: found, outline: null, text: `${gone}reached the only door running (this folder names no outline); ${NOT_TILE}` };
}

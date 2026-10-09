// Which door a program reaches, as one sentence and a rule (PIE-715). The order the ep0ch skill states: the door on
// EP0CH_CONTROL (followed to its outline's session by EP0CH_PLACE, outline-core's door-reach.ts), else the door of the
// outline this folder names, else the only door running. `ep0ch where`, `ep0ch doctor` and the Claude mod all ask this
// one function, so a Claude that doesn't descend from a tile (a background job, a resumed session) still finds the door.
import { listening } from "./jsonl";
import { reachControl } from "./control";
import { controlFor, placeFor, placeLabel } from "./session/place";

/** `control`: EP0CH_CONTROL (or its outline's session by EP0CH_PLACE); `folder`: the outline this folder names; `only`: the one door running; `none`. */
export type DoorRule = "control" | "folder" | "only" | "none";
export interface DoorResolution {
  rule: DoorRule;
  /** The control socket to use; null for `none`. */
  path: string | null;
  /** The outline whose door it is (a `folder` match), when known. */
  outline: string | null;
  /** Plain words: which rule matched and what it means for the keys; for `none`, why and the command to start one. */
  text: string;
}

const NOT_TILE = "you are not in a tile of it, so your keys are not the person's: act as an agent (`--as <your name>`), never as their keys";

export async function resolveDoor(env: Record<string, string | undefined> = process.env, cwd = process.cwd()): Promise<DoorResolution> {
  const given = env.EP0CH_CONTROL?.trim() || null;
  const reached = await reachControl(env).catch(() => null);
  if (reached?.path && await listening(reached.path)) {
    return { rule: "control", path: reached.path, outline: null, text: `reached the door on EP0CH_CONTROL${reached.stale ? ` (${reached.stale})` : ""}` };
  }
  const gone = given ? `EP0CH_CONTROL (${given}) has no door now; ` : "";
  const found = await controlFor(env, cwd);
  if (typeof found === "object") return { rule: "none", path: null, outline: null, text: `${gone}${found.error}` };
  const named = placeFor([], env, cwd);
  if (named && !("error" in named)) {
    return { rule: "folder", path: found, outline: named.outline, text: `${gone}reached ${placeLabel(named)}'s door session by folder (the outline this folder names); ${NOT_TILE}` };
  }
  return { rule: "only", path: found, outline: null, text: `${gone}reached the only door running (this folder names no outline); ${NOT_TILE}` };
}

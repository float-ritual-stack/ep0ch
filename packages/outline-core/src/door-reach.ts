// Which door a program in a door's tile reaches now (PIE-604): one rule for `ep0ch act|peek|open|where`, the
// outliner's `door-open` and so the Claude mod, which runs them. It does no I/O of its own: callers pass `DoorReachIO`,
// as machine.ts's callers pass `MachineIO`.
//
// A tile's program is told two things as it starts (the door's agentVars):
// - EP0CH_CONTROL: the socket its door served on then;
// - EP0CH_PLACE: the folder of the outline's session in the state dir (src/session/place.ts in the door), where that
//   outline's door serves `door.sock`, whichever process it is now.
//
// The socket alone goes stale: a session handed over to new code (`ep0ch install --apply`) or restarted serves from a
// new process, and a door that started beside another on its outline served on `door-<pid>.sock`, gone with it. The
// place doesn't: the program follows its outline's session there. EP0CH_CONTROL is still taken when it answers from
// inside that folder; a link is followed first, so one pointing at another outline's door is never taken. (The Herdr
// agent's pane, whose EP0CH_CONTROL is a link each door re-points as it attaches it, has no EP0CH_PLACE: its link is
// taken as it is.)
import { isAbsolute, join, relative, resolve } from "node:path";

/** What the rule asks of the world. */
export interface DoorReachIO {
  /** Whether a door answers on the socket now. */
  listening(path: string): Promise<boolean>;
  /** Where a symbolic link points (absolute), or null when the path is no link. */
  linkTarget(path: string): string | null;
}

/** The socket an outline's door serves on, in its session folder. */
export const doorSocketIn = (place: string) => join(place, "door.sock");

export interface DoorReach {
  /** The socket to use; null with neither variable set. */
  path: string | null;
  /** EP0CH_CONTROL, as the program was given it. */
  given: string | null;
  /** The session folder, as given (EP0CH_PLACE). */
  place: string | null;
  /** Why EP0CH_CONTROL wasn't used: the program's environment is older than its door. Null when it was, or none was given. */
  stale: string | null;
}

const inside = (root: string, p: string) => {
  const rel = relative(resolve(root), resolve(p));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

/**
 * The door a program reaches, from what it was given as it started. Without EP0CH_PLACE (a door older than it, or one
 * whose control socket was moved out of its outline's folder on purpose, as a test door's is) EP0CH_CONTROL is taken
 * as it is.
 */
export async function reachDoor(given: string | null | undefined, place: string | null | undefined, io: DoorReachIO): Promise<DoorReach> {
  const g = given?.trim() || null, p = place?.trim() || null;
  if (!p) return { path: g, given: g, place: null, stale: null };
  const own = doorSocketIn(p);
  const givenLive = g ? await io.listening(g) : false;
  // The socket it names, a link followed: taken only from inside the outline's session folder.
  const target = g ? io.linkTarget(g) ?? g : null;
  if (g && givenLive && inside(p, g) && inside(p, target!)) return { path: g, given: g, place: p, stale: null };
  if (g && resolve(g) === resolve(own)) return { path: g, given: g, place: p, stale: null };
  if (await io.listening(own)) {
    const stale = !g ? null
      : !givenLive ? `EP0CH_CONTROL (${g}) has no door now; following the outline's session to ${own}`
        : `EP0CH_CONTROL (${g}) is another outline's door; following this tile's outline's session to ${own}`;
    return { path: own, given: g, place: p, stale };
  }
  // No door serves the outline now: its own socket, whose "no door" is the true answer (never another outline's door).
  return { path: own, given: g, place: p, stale: g && givenLive ? `EP0CH_CONTROL (${g}) is another outline's door; this tile's outline has none running (${own})` : null };
}

// Who's online's action (PIE-506), one over two hosts: the BBS Who's Online screen (W) and the desk's who tile.
// The same argument and the same answer: the callers as last read, while the new answer is asked for.
import { ActionSet } from "./surface/actions";

/** One caller: a Tree, Detail, door or agent attached to the outline. */
export interface WhoRow { n: number; name: string; host: string; activity: string; target: string | null; reading: string | null }
export interface WhoHost { refresh(): void; rows(): WhoRow[] }

export const WHO_ACTIONS = new ActionSet<{ "who.refresh": Record<string, never> }, { pane: WhoHost }>("who", {
  "who.refresh": {
    summary: "ask the outline again who is attached (every Tree, Detail, door and agent); answers the callers as they were before the new answer lands", keys: "r R, click on R refresh",
    args: {},
    run(_, { pane }) { pane.refresh(); return { callers: pane.rows() }; },
  },
});

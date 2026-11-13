// A refusal as data: why not, and each way out as an act. The layout's rules (the door's desk/screen-layout.ts, the
// native window's layout/, by port) and the rules about the person's keys (whereabouts) answer this, never a sentence
// with a key in it: a key is a door's own, read from that door's key table when the refusal is said. So the layout
// names what to do (`layout.policy node=s3 closable=true`), and each door words it: its key for the person, the act
// line for an agent, and nothing for an action it hasn't (no refusal names an action that is no row there).
// `fixtures/layout-contract.json` holds both doors to the same reason and the same acts.

/** An argument of a way's act, as an act line writes it. */
export type WayArg = string | number | boolean;

/** One way out of a refusal. */
export interface Way {
  /** The action that is the way out, by its id. */
  act: string;
  /** The arguments it runs with. */
  args?: Record<string, WayArg>;
  /** The tile it is run in (`tile=`), by name. */
  tile?: string;
  /** What it does, in the words that follow however it is said: "unlocks it", "turns closable on". */
  does: string;
  /** Where the person's keys are for its key to mean this ("there", "in it"): said with a key, never with an act line, whose arguments name the place. */
  at?: string;
  /** A control drawn on screen that does the same by a click, in the words on it (a lock's chip): said to a person in a door that draws it. */
  on?: string;
  /** It follows the way before it (", then"); left out, it is another way (", or"). */
  then?: true;
  /** Only the person takes it: an agent is told it as theirs. */
  theirs?: true;
}

/** Why something wasn't done, and the ways out. */
export interface Why { reason: string; ways: Way[] }

/** A way out: the act, then what it does. */
export const way = (act: string, does: string, more: Omit<Way, "act" | "does"> = {}): Way => ({ act, ...more, does });

/** A refusal: the reason, then its ways out. */
export const whyNot = (reason: string, ...ways: readonly Way[]): Why => ({ reason, ways: [...ways] });

/** A refusal with more ways out after its own. */
export const withWays = (w: Why, ...ways: readonly Way[]): Why => ({ reason: w.reason, ways: [...w.ways, ...ways] });

/**
 * Ways out said, one after another: each in the words `said` has for it (null: this door hasn't the action, so the way
 * is left out), after the one before as its `then` says (", then": it follows; else ", or": it is another way).
 */
export function waysSaid(ways: readonly Way[], said: (way: Way) => string | null): string {
  let out = "";
  for (const each of ways) {
    const words = said(each);
    if (words === null) continue;
    out += out ? `${each.then ? ", then " : ", or "}${words}` : words;
  }
  return out;
}

/** A refusal said: the reason, then its ways out as `waysSaid` joins them. With no way said, the reason alone. */
export function whySaid(w: Why, said: (way: Way) => string | null): string {
  const ways = waysSaid(w.ways, said);
  return ways ? `${w.reason} · ${ways}` : w.reason;
}

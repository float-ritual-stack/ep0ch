// How a refusal's way out is said in this door: the one place. The layout's rules and the rules about the person's
// keys answer a way as an act (outline-core's way-out.ts: an action and its arguments, never a key), and this words
// it for whoever reads the refusal: the key the door's own key tables give that act now (the ^W keys first, then the
// keys the action's def declares, both with the person's keymap applied) for the person, the act line for an agent,
// and nothing for an action this door hasn't. So a key moved in keybindings.json is the key every refusal names, and no
// refusal names an action that is no row here. The guard test (test/one-owner.test.ts) fails when a layout file spells
// a key or an action in a sentence again.
import { waysSaid, whySaid, type Way, type Why } from "@ep0ch/outline-core/way-out";
import { wChordOf } from "../desk/wkeys";
import type { Actor } from "../socket";
import { hyperLabel } from "../hyper";
import { allActionSets, chordName, declaredKeys, keyCaption, shownLine } from "./actions";
import { keysNow } from "./keymap";

/** The ways a key row names that are no key: said by a control's own words (`Way.on`), never as a key. */
const GESTURES = new Set(["click", "drag", "wheel", "hover", "sideways", "double-click"]);

/** A key as its keycap shows it (`^W x`, `✦p`), as the keys window lists it. */
const capOf = (key: string) => (key.startsWith("hyper+") ? hyperLabel(key.slice(6)) : keyCaption(key));

/** The def of an action some set of this door has, or undefined: the door hasn't the action. */
const defOf = (action: string) => allActionSets().find(s => s.has(action))?.def(action);

/** A way's act as an act line: what an agent runs, and what the person reads when no key runs it. */
export const wayLine = (w: Way): string => shownLine(w.act, w.args ?? {}, w.tile);

/**
 * The key that runs a way's act now, as a keycap shows it (`^W P`), or null when none does: the ^W key that runs it
 * whole, else the first key its def declares (its rows' own, the person's keymap applied to both).
 */
export function wayKey(w: Way): string | null {
  const chord = wChordOf(w.act, w.args ?? {});
  if (chord) return capOf(chord);
  const keys = keysNow(w.act, defOf(w.act)?.keys);
  if (!keys) return null;
  const rows = typeof keys === "string" ? [{ keys }] : keys;
  // A row that binds arguments is that run's key, not the action's: the act has them, or the row is passed over.
  const fits = (r: { args?: Readonly<Record<string, unknown>> }) => Object.entries(r.args ?? {}).every(([k, v]) => String((w.args ?? {})[k]) === String(v));
  for (const r of rows) {
    if (!("keys" in r) || !fits(r as { args?: Readonly<Record<string, unknown>> })) continue;
    const key = firstKey(r.keys);
    if (key) return capOf(key);
  }
  return null;
}

/**
 * The first key a row of keys names, by its one name: its leading chord whole (`^W P then ⏎` is `ctrl+w P`, never the
 * `^W` it starts with), else the first key the row declares that is no gesture.
 */
function firstKey(keys: string): string | null {
  const lead = chordName(keys.split(/\s+then\s+|[,;(]/)[0]!.trim());
  if (lead && !GESTURES.has(lead)) return lead;
  for (const k of declaredKeys(keys)) if (!GESTURES.has(k)) return k;
  return null;
}

/**
 * One way out in this door's words, for `actor`, or null (the door has no such action). The person reads the key
 * (with where their keys are for it to mean this), a control to click where the layout names one, or the act line
 * when no key runs it; an agent reads the act line, and for a way that is the person's alone, that it is theirs, by
 * their key.
 */
export function waySaid(w: Way, actor: Actor): string | null {
  if (!defOf(w.act)) return null;
  const key = wayKey(w), line = wayLine(w);
  if (actor.kind === "agent") return w.theirs ? `the person's ${key ? `${key} (${line})` : line} ${w.does}` : `${line} ${w.does}`;
  const keyed = key ? `${key}${w.at ? ` ${w.at}` : ""}` : null;
  const how = w.on ? `a click on ${w.on}${keyed ? ` (or ${keyed})` : ""}` : keyed ?? line;
  return `${how} ${w.does}`;
}

/** Ways out as this door says them to `actor` (what a lock answers: how it is undone). */
export const waysOutSaid = (ways: readonly Way[], actor: Actor): string => waysSaid(ways, each => waySaid(each, actor));

/** A refusal as this door says it to `actor`: its reason, then the ways out the door has. */
export const refusalSaid = (w: Why, actor: Actor): string => whySaid(w, each => waySaid(each, actor));

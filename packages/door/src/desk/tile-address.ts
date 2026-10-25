// The one grammar `tile=` reads for a tile that is not on the screen you are asking from (PIE-1286). Four kinds of
// address, matched in this order, and nothing else decides which tile a request means:
//
//   t-<uuid>            this exact tile: a unique prefix of 8+ characters after `t-` works, as a block id's does
//   role:<role>[@scope] a tile of this kind, wherever it is: `role:agent` is the drawer's own program, `role:reader` a
//                       reader. The role lives on the tile (set when it is made, saved with its id), so a restart, a
//                       handover or a restore keeps it. `@scope` narrows it to the drawer or to one screen
//   <slot>@<screen>     the place, whatever fills it now: a slot the screen declares (its spec's tile names, where
//                       opens land: `detail`, a docked tile) on that screen
//   <name>              the label a person typed. Matched last, and never the identity of anything
//
// `drawer.agent` stays as the alias of `role:agent`. Pure: the desk lists the tiles it has (AddressCandidate), this
// module says which one an address means, or why none does and what to run.
import { ActionRefused } from "../surface/actions";

export type TileAddress =
  | { kind: "id"; id: string; text: string }
  | { kind: "role"; role: string; scope?: string; text: string }
  | { kind: "slot"; slot: string; screen: string; text: string }
  | { kind: "name"; name: string; text: string };

/** The drawer's own program, by its name from before roles: an alias for `role:agent`. */
export const AGENT_ALIAS = "drawer.agent";
/** The role of the drawer's own program. */
export const ROLE_AGENT = "agent";
/** Whether `sel` names the drawer's own program (`drawer.agent`, `role:agent`, `role:agent@drawer`). */
export const namesAgent = (sel: string | undefined): boolean => {
  if (sel === undefined) return false;
  const a = parseTileAddress(sel);
  return a.kind === "role" && a.role === ROLE_AGENT;
};
/** A tile id's shortest prefix that names it (after `t-`), the rule block ids follow. */
export const MIN_ID_PREFIX = 8;

const ID = new RegExp(`^t-[0-9a-f][0-9a-f-]{${MIN_ID_PREFIX - 1},}$`, "i");

/** What `sel` is an address of. A bare name, a number or a path is a `name` here: the dispatcher reads those itself. */
export function parseTileAddress(sel: string): TileAddress {
  if (sel === AGENT_ALIAS) return { kind: "role", role: ROLE_AGENT, text: sel };
  if (ID.test(sel)) return { kind: "id", id: sel.toLowerCase(), text: sel };
  if (sel.startsWith("role:")) {
    const [role, scope] = sel.slice(5).split("@", 2) as [string, string | undefined];
    return { kind: "role", role, ...(scope ? { scope } : {}), text: sel };
  }
  const at = sel.indexOf("@");
  if (at > 0 && !sel.includes("/") && at < sel.length - 1) return { kind: "slot", slot: sel.slice(0, at), screen: sel.slice(at + 1), text: sel };
  return { kind: "name", name: sel, text: sel };
}

/** A tile as the resolver reads it: what it is, never how it is shown. `value` is what the caller gets back. */
export interface AddressCandidate<T> {
  value: T;
  /** Its `t-<uuid>`. */
  id: string;
  name: string;
  /** Its role: set on the tile, else its kind. */
  role: string;
  /** The slots it fills on its screen now (a spec's tile name, `detail`, a column's key). */
  slots: readonly string[];
  /** Its screen's name (`drawer` for the drawer's own desk). */
  screen: string;
  /** Where to find it, for a refusal that lists several. */
  where: string;
}

const list = <T>(cs: readonly AddressCandidate<T>[]) => cs.map(c => `${c.where} (${c.id})`).join(", ");
const inScope = <T>(c: AddressCandidate<T>, scope: string | undefined) => scope === undefined || c.screen === scope;

/** The tiles `a` names (an id, a role or a slot), none or several included. A `name` is not decided here. */
export function matches<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): AddressCandidate<T>[] {
  if (a.kind === "id") return cs.filter(c => c.id.startsWith(a.id));
  if (a.kind === "role") return cs.filter(c => c.role === a.role && inScope(c, a.scope));
  if (a.kind === "slot") return cs.filter(c => c.screen === a.screen && c.slots.includes(a.slot));
  return [];
}

/**
 * The one tile an address means, or null when none does; several is a refusal that lists them with the ids to type. A
 * `name` is null here: the caller's own names come after, and are never the identity of anything.
 */
export function resolveAddress<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): AddressCandidate<T> | null {
  const hits = matches(a, cs);
  if (hits.length > 1) throw new ActionRefused(`${a.text} names ${hits.length} tiles: ${list(hits)}; use tile=<id>${a.kind === "role" ? ` or ${a.text}@<screen>` : ""}`);
  return hits[0] ?? null;
}

/** Why `a` names no tile, with what to type instead (an id, role or slot that exists), or null for a plain name. */
export function whyNone<T>(a: TileAddress, cs: readonly AddressCandidate<T>[]): string | null {
  const roles = [...new Set(cs.map(c => c.role))].sort();
  if (a.kind === "id") {
    const near = cs.filter(c => c.id.startsWith(a.id.slice(0, 6)));
    return `no tile has the id ${a.text}${near.length ? `; did you mean ${near.slice(0, 3).map(c => c.id).join(", ")}?` : `; tile.list shows the ids`}`;
  }
  if (a.kind === "role") {
    const scoped = a.scope !== undefined && !cs.some(c => c.screen === a.scope);
    if (scoped) return `no screen ${a.scope} is on show to look for role:${a.role} in; screens: ${[...new Set(cs.map(c => c.screen))].join(", ")}`;
    return `no tile has the role ${a.role}${a.scope ? ` on ${a.scope}` : ""}; roles here: ${roles.join(", ")}`;
  }
  if (a.kind === "slot") {
    const onScreen = cs.filter(c => c.screen === a.screen);
    if (!onScreen.length) return `no screen ${a.screen} is on show or mounted here; screens: ${[...new Set(cs.map(c => c.screen))].join(", ")}`;
    return `${a.screen} has no slot ${a.slot}; its slots: ${[...new Set(onScreen.flatMap(c => c.slots))].join(", ") || "none"}`;
  }
  return null;
}

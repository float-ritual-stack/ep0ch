// The doors a machine link carries (PIE-1242): the connector (the laptop) says which door sessions run on it, and the
// server (float-2) gives each one's control socket a local end, as it gives the connector's outline host one at
// `<machine>.link.sock`. A program here reaches a door on that machine the way it reaches one here: EP0CH_CONTROL at
// the socket, `ep0ch peek|act|…`, the mod's door tools. Attribution and the door's refusals (an agent never takes the
// person's focus or keys) are the door's own; the link's key is the only gate, as for the host.
//
// On the server, beside the link's other files in `<outlines>/.remote/`:
//   <machine>.doors/<key>.sock    one per door session there (mode 0600, in a folder of mode 0700)
//   <machine>.doors.json          which doors those are, and the connector's addresses (LinkDoorsRecord)
// The same two names are used on a machine that reaches those doors through the server over ssh (`via`, the door's
// src/remote-doors.ts), so every machine finds a machine's doors in one place.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** One door session on the connector, as the link announces it. */
export interface LinkDoor {
  /** Which session: its outline, and `@<machine>` when that outline is on another machine (`pie@float-2`). */
  key: string;
  outline: string;
  machine?: string;
  /** Since the person last typed in it, in ms (the least over its attached terminals); null with none attached. */
  idle: number | null;
  /** Terminals attached to it now. */
  clients: number;
  /** The screen it shows, when it says. */
  screen?: string | null;
}

/** A door as a machine here reaches it: the local end of its control socket. */
export interface ReachableDoor extends LinkDoor { control: string }

/** What `<machine>.doors.json` holds. */
export interface LinkDoorsRecord {
  machine: string;
  /** The connector's own addresses (its network interfaces): an ssh session from one of them came from that machine. */
  addresses: string[];
  /** Set where the doors are reached through another machine's link: that machine's ssh name. */
  via?: string;
  doors: ReachableDoor[];
  /** When it was written (ms). */
  at: number;
}

const NAME = "[A-Za-z0-9._-]{1,64}";
export const DOOR_KEY = new RegExp(`^${NAME}(@${NAME})?$`);
export const doorKey = (outline: string, machine?: string) => (machine ? `${outline}@${machine}` : outline);

export const linkDoorsDir = (outlines: string, machine: string) => join(outlines, ".remote", `${machine}.doors`);
export const linkDoorsFile = (outlines: string, machine: string) => join(outlines, ".remote", `${machine}.doors.json`);

/** Where door `key`'s control socket answers here: its name, or a hash of it when the path would be too long for a socket. */
export function linkDoorSocket(outlines: string, machine: string, key: string): string {
  const dir = linkDoorsDir(outlines, machine), path = join(dir, `${key}.sock`);
  return Buffer.byteLength(path) < 100 ? path : join(dir, `${createHash("sha256").update(key).digest("hex").slice(0, 12)}.sock`);
}

/** A connector's announcement, checked: what isn't a door is refused (the link closes, with why). */
export function parseLinkDoors(value: unknown): LinkDoor[] {
  if (!Array.isArray(value) || value.length > 64) throw new Error("invalid door list");
  return value.map(d => {
    if (!d || typeof d !== "object") throw new Error("invalid door");
    const { key, outline, machine, idle, clients, screen } = d as Record<string, unknown>;
    if (typeof key !== "string" || !DOOR_KEY.test(key) || typeof outline !== "string" || key !== doorKey(outline, typeof machine === "string" ? machine : undefined)) throw new Error("invalid door key");
    if (!(idle === null || (typeof idle === "number" && idle >= 0)) || typeof clients !== "number") throw new Error("invalid door state");
    return { key, outline, ...(typeof machine === "string" ? { machine } : {}), idle: idle as number | null, clients, ...(typeof screen === "string" || screen === null ? { screen } : {}) };
  });
}

/** `<machine>.doors.json` here, or null. */
export function readLinkDoors(outlines: string, machine: string): LinkDoorsRecord | null {
  try {
    const r = JSON.parse(readFileSync(linkDoorsFile(outlines, machine), "utf8")) as LinkDoorsRecord;
    return r && Array.isArray(r.doors) ? r : null;
  } catch { return null; }
}

/**
 * The door an agent means among a machine's: the one on `outline` (and `machine`, when given) when named, else the
 * only one, else the one the person typed in most recently. Null with the reason when none fits.
 */
export function pickLinkDoor<T extends LinkDoor>(doors: readonly T[], want: { outline?: string; machine?: string } = {}): T | { error: string } {
  const named = want.outline ? doors.filter(d => d.outline === want.outline && (want.machine === undefined || d.machine === want.machine)) : [...doors];
  if (!named.length) return { error: want.outline ? `no door runs on ${want.outline} there (${doors.map(d => d.key).join(", ") || "none runs"})` : "no door runs there" };
  if (named.length === 1) return named[0]!;
  const typed = named.filter(d => d.idle !== null).sort((a, b) => a.idle! - b.idle!);
  if (typed.length) return typed[0]!;
  return { error: `${named.length} doors run there and none has the person: name one with --ws (${named.map(d => d.key).join(", ")})` };
}

// Who has the person's keys (PIE-1592): one record for the door, written where a tile opens, closes, carries, is entered
// or undone, and read by the router, the foot and the hints (App.person answers from it). What it holds is what no layout
// holds: the host layer's answer, the drawer's lift or glass the person went into, a terminal they went into on each desk
// and the last ctrl+]. A desk's focus is the layout's own answer (`Desk.commit`), which tile keys come back to, kept there.
// `wayOut` is the one rule for what ctrl+] does now: it steps out one mode at a time, innermost first.
import type { Pane } from "./panes";
import type { PtyPane } from "./pty";
import type { Actor } from "../socket";

/** How soon a second ctrl+] counts as the second of two: it goes to the program left, or back into the drawer left. */
export const CHORD_MS = 1500;

/** What ctrl+] does on a desk's own tiles: out of the program, to the program (a second soon after), out of the group, or none here. `exited`: out of a program that ended. */
export type DeskWay = "program" | "exited" | "send" | "group" | null;
/** What ctrl+] does now, for the door. `drawer-send`: back into the drawer it just left, sending the program a ctrl+]. */
export type WayOut = "program" | "send" | "group" | "drawer" | "drawer-send" | "into-drawer" | "none";

/** One desk's answer: a program here, a second press for one, else the group the keys are in (its own way first). */
export function deskWay(f: { typing: boolean; exited: boolean; armed: boolean; inGroup: boolean; inner: DeskWay }): DeskWay {
  if (f.typing) return f.exited ? "exited" : "program";
  if (f.armed) return "send";
  if (!f.inGroup) return null;
  return f.inner === "exited" ? "program" : f.inner ?? "group";   // an exited program in a group still steps out to the group, never past it
}

/** The door's answer: what the desk with the keys answers, around the drawer they are in, or left, or that is up. */
export function wayOut(f: { inDrawer: boolean; desk: DeskWay; drawerUp: boolean; leftDrawer: boolean }): WayOut {
  if (f.inDrawer) return f.desk === null || f.desk === "exited" ? "drawer" : f.desk;
  if (f.drawerUp && f.leftDrawer) return "drawer-send";
  if (f.desk) return f.desk === "exited" ? "program" : f.desk;
  return f.drawerUp ? "into-drawer" : "none";
}

/** The glass tile the person went into, and where the keys go back to. */
export interface GlassKeys { keys: string; focus: string | null; tile: string }

/** The fact as a reader takes it: which desk, which tile, typing or not, and the way out. */
export interface KeysFact {
  /** The layer they are in: the screen, the drawer, a glass tile, or a drawer tile lifted with the drawer down. */
  layer: "screen" | "drawer" | "glass" | "lift";
  /** The tile that has them, by its address through mounted desks, or null. */
  tile: string | null;
  typing: boolean;
  /** What ctrl+] does now. */
  wayOut: WayOut;
}

export class DoorKeys<Lift = unknown> {
  /** The host layer's answer: the screen slot, or the drawer. */
  host: string;
  /** The drawer's lift the person went into with the drawer down, else null. */
  lift: Lift | null = null;
  glass: GlassKeys | null = null;
  /** The person went into the drawer before its terminal started: their keys go into it once it has. */
  want: { send?: string } | null = null;
  /** The terminal the person went into, by the desk it's on. A desk keeps it while the person is on another layer. */
  private programs = new WeakMap<object, PtyPane>();
  /** The last ctrl+]: out of a program (its second goes to it), out of the drawer (its second goes back in), or by to a screen with no tiles of its own that has a program (its second is that screen's too). */
  private chord: { pane: PtyPane; at: number } | { drawer: true; at: number } | { passed: true; at: number } | null = null;

  constructor(host: string) { this.host = host; }

  // ── written where the keys move ──
  hostAt(focus: string) { this.host = focus; }
  intoLift(lift: Lift | null) { this.lift = lift; }
  intoGlass(from: Omit<GlassKeys, "tile">, tile: string) { this.glass ??= { ...from, tile }; this.glass.tile = tile; this.lift = null; this.want = null; }
  outOfGlass() { this.glass = null; }
  wantIn(w: { send?: string } | null) { this.want = w; }
  /** `desk`'s terminal `p` has the keys now. */
  typeIn(desk: object, p: PtyPane) { this.programs.set(desk, p); this.chord = null; }
  /** Nobody types on `desk` now (only if in `p`, when named). */
  stopTyping(desk: object, p?: unknown) { if (!p || this.programs.get(desk) === p) this.programs.delete(desk); }
  /** ctrl+] left the program on `desk`: a second soon after goes to it. */
  leftProgram(desk: object, p: PtyPane, now = Date.now()) { this.programs.delete(desk); this.chord = { pane: p, at: now }; }
  /** The person left the drawer by keys: a second ctrl+] soon after goes back in. */
  leftDrawer(now = Date.now()) { this.chord = { drawer: true, at: now }; }
  /** A ctrl+] went by to a screen that frames its program. */
  passedOn(now = Date.now()) { this.chord = { passed: true, at: now }; }
  /** Whatever the last ctrl+] left is over (they went in again, or its tile went). */
  chordSpent(p?: unknown) { if (!p || (this.chord && "pane" in this.chord && this.chord.pane === p)) this.chord = null; }

  // ── read ──
  typingOn(desk: object): PtyPane | null { return this.programs.get(desk) ?? null; }
  /** A second ctrl+] now goes to `p`, the program just left. */
  armed(p: unknown, now = Date.now()): boolean { const c = this.chord; return !!c && "pane" in c && c.pane === p && c.pane.running && now - c.at < CHORD_MS; }
  /** A second ctrl+] now goes by to that screen. */
  justPassed(now = Date.now()): boolean { const c = this.chord; return !!c && "passed" in c && now - c.at < CHORD_MS; }
  /** A second ctrl+] now goes back into the drawer just left. */
  justLeftDrawer(now = Date.now()): boolean { const c = this.chord; return !!c && "drawer" in c && now - c.at < CHORD_MS; }
}

/** The keys to `p` wherever under `root` it is, a group's tile included: focused here and each mount around it. The outermost tile, or null when `root` doesn't hold it. */
export function keysThrough<D extends { descend(): D[]; nameOfPane(p: Pane): string; focusPane(p: Pane, actor: Actor): void; holder: { tile: Pane; desk(): D | null } | null }>(root: D, p: Pane, actor: Actor): Pane | null {
  let d = root.descend().find(x => x.nameOfPane(p)), top = p;
  if (!d) return null;
  for (;;) {
    d.focusPane(top, actor);
    const up: D | null | undefined = d.holder?.desk();
    if (!up) return top;
    top = d.holder!.tile; d = up;
  }
}

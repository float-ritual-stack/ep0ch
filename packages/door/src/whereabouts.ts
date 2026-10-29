// Where the person is (PIE-514): one answer, owned by the shell, to "where are their keys and focus, which tile are
// they typing in, are they busy". Every rule about an agent and the person's keys reads it: the dispatcher's actor
// rule (src/surface/dispatch.ts), the layout engine's `ctx.person` (src/desk/screen-layout.ts, the desk's and the
// host layer's), and through them the draft session's rule. Before, each screen asked its own questions
// (holdsKeys, personIn, isEntered, drawerHoldsKeys, holdsFocus, `=== this.focus`) and each rule picked
// some of them; now a screen says once where the person's keys are on it (`Screen.keys`), the App adds the host
// layer, the shell and the clock, and every rule asks the same thing.

/** Where the person's keys are on one screen, as that screen says it (Screen.keys). Tiles by the name `tile=` uses. */
export interface ScreenKeys {
  /** Stable address of the tile under the keys, through mounted desks. */
  address?: string | null;
  /** The tile that has their focus (the keys come back to it from the host layer), or null on a screen with no tiles. */
  focus: string | null;
  /** The tile they're typing in (an edit, a comment, a panel, a terminal, a filter), or null. */
  typingIn: string | null;
  /** Their keys are held here: typing in a tile, a picker, a palette, a panel or a chord open. */
  busy: boolean;
  /** What holds them, in words for a refusal ("in an edit on middle", "typing a filter"). */
  why?: string;
  /** `busy` is a hold on navigation, not typing (the showcase keeps agents from moving its sections): a run the person's press invited may still move tiles. */
  navHold?: true;
}

/** Where the person is, everywhere: the screen's answer with the host layer, the shell and the clock added. */
export interface Whereabouts extends ScreenKeys {
  /** The layer their keys are in: the screen, or the host layer's drawer (the agent). */
  keys: "screen" | "host";
  /** The screen shown, by its title. */
  screen: string | null;
  /** Milliseconds since their last key or click. */
  idle: number;
  /** Why nothing may move for them at all: not logged on yet, or the door is suspended under a shell or editor. */
  away: string | null;
  /**
   * Agents are in yolo (`agents.yolo`): the person handed them the door, so no person guard holds an agent back
   * (typing, focus, idle, tile limits, locks). What keeps state valid (revisions, the layout's own shape) still does.
   */
  yolo?: true;
}

/** The host layer's agent tile, as `typingIn` names it while the person types in the drawer. */
export const HOST_AGENT = "drawer.agent";
/** The host layer's drawer holds the drawer's desk: one leaf, its tiles the drawer's tabs (re-exported by src/drawer.ts). */
export const HOST_TILES = "drawer.tiles";

export interface AgentPointer {
  agent: string;
  screen: string;
  tile: string;
  name: string;
  note?: string;
  line?: number;
}

/** Explicit pointers live only as long as the screen and tile they name. */
export class AgentPointers {
  private entries = new Map<string, { scope: object; read: () => AgentPointer | null }>();
  set(agent: string, scope: object, read: () => AgentPointer | null) { this.entries.set(agent, { scope, read }); }
  clear(agent: string) { this.entries.delete(agent); }
  dropTile(scope: object, tile: string) {
    for (const p of this.list(scope)) if (p.tile === tile) this.clear(p.agent);
  }
  drop(scope: object) { for (const [agent, p] of this.entries) if (p.scope === scope) this.clear(agent); }
  get(agent: string, scope?: object): AgentPointer | undefined {
    const entry = this.entries.get(agent);
    if (!entry) return;
    const p = entry.read();
    if (!p) { this.clear(agent); return; }
    return scope === undefined || entry.scope === scope ? p : undefined;
  }
  list(scope?: object): AgentPointer[] {
    return [...this.entries.keys()].flatMap(agent => { const p = this.get(agent, scope); return p ? [p] : []; });
  }
}

/** How long the person has to have been away from the keys and the mouse before an agent moves what they see. */
export const SHELL_IDLE_MS = 2000;

/** Nobody at the keys: a screen with no person (a test's, a screen built for a snapshot). */
export const NOBODY: Whereabouts = { focus: null, typingIn: null, busy: false, keys: "screen", screen: null, idle: Infinity, away: null };

/**
 * The person's whereabouts from the parts the App has: the top screen's own answer, whether they're in the host
 * layer's drawer, whether the door is suspended under a program, whether they're logged on, and the clock.
 */
export function whereabouts(o: {
  screen: string | null;
  keys: ScreenKeys | null;
  inHost: boolean;
  /** In the drawer, the tile they type in: its own (HOST_AGENT), else `drawer:<name>` (a tile in the drawer). */
  hostTile?: string | null;
  hostAddress?: string | null;
  suspended: string | null;
  loggedOn: boolean;
  idle: number;
}): Whereabouts {
  const k = o.keys ?? { focus: null, typingIn: null, busy: false };
  const away = !o.loggedOn ? `the door is at the ${o.screen ?? "logon"}; the person hasn't logged on`
    : o.suspended ? `the person is in the door's ${o.suspended} (the door waits under it)` : null;
  if (o.inHost) return { address: o.hostAddress, focus: k.focus, typingIn: o.hostTile ?? HOST_AGENT, busy: true, why: `the person is typing in ${hostTyping(o.hostTile)}`, keys: "host", screen: o.screen, idle: o.idle, away };
  const why = k.busy ? (k.why ?? `the person is typing on the ${o.screen ?? "screen"}`) : undefined;
  return { address: k.address, focus: k.focus, typingIn: k.typingIn, busy: k.busy || !!o.suspended, ...(k.busy && k.navHold && !o.suspended ? { navHold: true as const } : {}), ...(why ? { why } : o.suspended ? { why: away! } : {}), keys: "screen", screen: o.screen, idle: o.idle, away };
}

/** The drawer's tile the person types in, as a refusal names it: `<its name> in the drawer`, or the drawer itself (never its container's id, `drawer.tiles`). */
function hostTyping(tile: string | null | undefined): string {
  const name = tile && tile !== HOST_AGENT ? tile.replace(/^drawer:/, "") : "";
  return name && name !== HOST_TILES ? `${name} in the drawer` : "the drawer";
}

/**
 * A screen's whereabouts as seen from inside a tile that frames it (a board in a desk tile): the tile's screen has
 * the person's focus only while its tile does; their busy-ness and the clock are everywhere's.
 */
export function within(outer: Whereabouts, focused: boolean, inner: ScreenKeys | null): Whereabouts {
  if (!focused || outer.keys === "host") return { ...outer, focus: null, typingIn: outer.keys === "host" ? outer.typingIn : null };
  const k = inner ?? { focus: null, typingIn: null, busy: false };
  return { ...outer, focus: k.focus, typingIn: k.typingIn, busy: outer.busy || k.busy, ...(k.busy && k.why ? { why: k.why } : {}), ...(k.busy && k.navHold && !outer.busy ? { navHold: true as const } : {}) };
}

/** A screen's own answer (Screen.keys), or for a screen without tiles whether it holds the person's keys at all. */
export function screenKeys(s: { title: string; keys?(): ScreenKeys; holdsKeys?(): boolean; rawKeys?(): boolean }): ScreenKeys {
  const own = s.keys?.();
  if (own) return own;
  const raw = !!s.rawKeys?.(), held = raw || !!s.holdsKeys?.();
  return { focus: null, typingIn: null, busy: held, ...(held ? { why: raw ? `the person is typing in a terminal tile on the ${s.title}` : `the person is in an edit, a comment or the property panel on the ${s.title} (or typing a filter, or choosing)` } : {}) };
}

/**
 * Why a reader won't take another note: it holds an edit or a comment there (PIE-761), so it stays on its note. The one
 * wording every screen says it in (PIE-1294): placement()'s refusal, ReaderPane.keepsOff (the welcome detail, the brief,
 * EchoNet's reader, a river column, the reader's own mode and follow), MessageReader's open. The guard test
 * (test/one-owner.test.ts) fails when a screen words it again.
 */
export const holdsEdit = (label: string, what = "an edit or a comment"): string => `${label} holds ${what}; it stays on its note until that's saved or closed`;

/** What an agent does instead of interrupting the person: the tail most typing refusals end with. */
export const MARK_THEM = "block.mark gets their attention";
/**
 * Why an agent is held back by what the person is doing (`why`: "the person is typing in r1", or the screen's own
 * whereabouts sentence): `<why>; an agent doesn't <what> · <way>`. The one shape every typing refusal is said in
 * (PIE-1294: the layout's guards, the actor rule, the draft rule); the guard test (test/one-owner.test.ts) fails when
 * a file words one itself.
 */
export const heldBack = (why: string, what: string, way: string | null = MARK_THEM): string => `${why}; an agent doesn't ${what}${way ? ` · ${way}` : ""}`;
/** `heldBack` for the tile, draft or passage the person is typing in (`label`: its name, or "this draft"). */
export const typingIn = (label: string, what: string, way: string | null = MARK_THEM): string => heldBack(`the person is typing in ${label}`, what, way);
/**
 * `heldBack` for the tile that has the person's keys (`typing`: they type in it, said as `typingIn` says it; else it's
 * only focused). Every layout guard about the person's tile words it here (PIE-1428).
 */
export const keysIn = (label: string, what: string, typing = false, way: string | null = MARK_THEM): string =>
  typing ? typingIn(label, what, way) : heldBack(`${label} has the person's keys`, what, way);

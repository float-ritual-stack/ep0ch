// Where the person is (PIE-514): one answer, owned by the shell, to "where are their keys and focus, which tile are
// they typing in, are they busy". Every rule about an agent and the person's keys reads it: the dispatcher's actor
// rule (src/surface/dispatch.ts), the layout engine's `ctx.person` (src/desk/screen-layout.ts, the desk's and the
// host layer's), and through them the draft session's rule. Before, each screen asked its own questions
// (holdsKeys, personIn, isEntered, drawerHoldsKeys, holdsFocus, `=== this.focus`) and each rule picked
// some of them; now a screen says once where the person's keys are on it (`Screen.keys`), the App adds the host
// layer, the shell and the clock, and every rule asks the same thing.

/** Where the person's keys are on one screen, as that screen says it (Screen.keys). Tiles by the name `tile=` uses. */
export interface ScreenKeys {
  /** The tile that has their focus (the keys come back to it from the host layer), or null on a screen with no tiles. */
  focus: string | null;
  /** The tile they're typing in (an edit, a comment, a panel, a terminal, a filter), or null. */
  typingIn: string | null;
  /** Their keys are held here: typing in a tile, a picker, a palette, a panel or a chord open. */
  busy: boolean;
  /** What holds them, in words for a refusal ("in an edit on middle", "typing a filter"). */
  why?: string;
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
}

/** The host layer's agent tile, as `typingIn` names it while the person types in the drawer. */
export const HOST_AGENT = "drawer.agent";

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
  suspended: string | null;
  loggedOn: boolean;
  idle: number;
}): Whereabouts {
  const k = o.keys ?? { focus: null, typingIn: null, busy: false };
  const away = !o.loggedOn ? `the door is at the ${o.screen ?? "logon"}; the person hasn't logged on`
    : o.suspended ? `the person is in the door's ${o.suspended} (the door waits under it)` : null;
  if (o.inHost) return { focus: k.focus, typingIn: o.hostTile ?? HOST_AGENT, busy: true, why: `the person is typing in the drawer${o.hostTile && o.hostTile !== HOST_AGENT ? ` (${o.hostTile.replace(/^drawer:/, "")})` : ""}`, keys: "host", screen: o.screen, idle: o.idle, away };
  const why = k.busy ? (k.why ?? `the person is typing on the ${o.screen ?? "screen"}`) : undefined;
  return { focus: k.focus, typingIn: k.typingIn, busy: k.busy || !!o.suspended, ...(why ? { why } : o.suspended ? { why: away! } : {}), keys: "screen", screen: o.screen, idle: o.idle, away };
}

/**
 * A screen's whereabouts as seen from inside a tile that frames it (a board in a desk tile): the tile's screen has
 * the person's focus only while its tile does; their busy-ness and the clock are everywhere's.
 */
export function within(outer: Whereabouts, focused: boolean, inner: ScreenKeys | null): Whereabouts {
  if (!focused || outer.keys === "host") return { ...outer, focus: null, typingIn: outer.keys === "host" ? outer.typingIn : null };
  const k = inner ?? { focus: null, typingIn: null, busy: false };
  return { ...outer, focus: k.focus, typingIn: k.typingIn, busy: outer.busy || k.busy, ...(k.busy && k.why ? { why: k.why } : {}) };
}

/** A screen's own answer (Screen.keys), or for a screen without tiles whether it holds the person's keys at all. */
export function screenKeys(s: { title: string; keys?(): ScreenKeys; holdsKeys?(): boolean; rawKeys?(): boolean }): ScreenKeys {
  const own = s.keys?.();
  if (own) return own;
  const raw = !!s.rawKeys?.(), held = raw || !!s.holdsKeys?.();
  return { focus: null, typingIn: null, busy: held, ...(held ? { why: raw ? `the person is typing in a terminal tile on the ${s.title}` : `the person is in an edit, a comment or the property panel on the ${s.title} (or typing a filter, or choosing)` } : {}) };
}

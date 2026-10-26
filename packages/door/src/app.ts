import { Canvas, type Rect } from "./canvas";
import { NoteSurface, NOTE_ACTIONS, type SurfaceHost } from "./surface/note";
import { StatusBarNote, STATUS_BAR_ACTIONS, separated, statusHits, statusText, type StatusItem, type StatusHit } from "./status-bar";
import { OSC8, OSC8_CLOSE } from "./hyperlink";
import { fullPlainText } from "./overflow";
import { Overflow } from "./overflow";
import { linkUpdateLabel } from "@ep0ch/outliner/link";
import { outlinesDir } from "./discover";
import { actionFailure, errorDetails } from "./status-log";
import { StatusLog, messageContext, type MessageDetails } from "./status-log";
import { WaitingAsks } from "./waiting-asks";
import { RUNBOOK_ACTIONS } from "./runbook";
import { outlineBoards, readNote } from "./desk/outline-boards";
import { INVITES } from "./surface/invite";
import { MacroRecording, MACRO_ACTIONS } from "./macros";
// The door: a stack of screens, one status bar, one paint per change.
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { lookFor, tuningOf } from "./look";
import { nextFrame, onMediaChange } from "./media";
import { onResizeEnd, resizing } from "./resize";
import { uncover, type Placement } from "./kitty";
import { isDisplay, Painter, type Display, type RawTerm, type Video } from "./display";
import { AGENT_ACTOR_ID, Offline, type Actor, type SocketBoard, type OutlineEvent } from "./socket";
import { ActionRefused, actionSet, asActor, agentLabel, traceActions, keyName, type ActRequest } from "./surface/actions";
import { POINTER_ACTIONS, Dispatcher, GONE_ACTIONS, notePressRedraw, type TileRef } from "./surface/dispatch";
import { stopCompletion, useCompletion } from "./surface/completer";
import { lineCompletionHooks } from "./surface/line-hooks";
import { AgentPointers, screenKeys, whereabouts, type ScreenKeys, type Whereabouts } from "./whereabouts";
import { SHELL_ACTIONS } from "./screens";
import { NEW_NOTE_ACTIONS } from "./new-note";
import { TEMPLATE_ACTIONS } from "./template-stamp";
import { COPY_MAX, isCopyKey, osc52, uncopied, type Uncopied } from "./surface/selection";
import { bg, BOLD, C, chip, fg, headOf, pad, RESET, tailFrom, UNBOLD, width } from "./style";
import { isBarKey } from "./shell-keys";
import { printable, withRowLimit } from "./text";
import { SpeedMeter } from "./speed";
import { isHover, OPTION_AS_ALT_HINT, OPTION_KEYS, optionKeysOn, pasteKeys, type Handover, type Key, type KeyDecoder, type Term, type TermInfo, type TileProgram } from "./term";
import { paintingScroll } from "./scroll";
import { connectFigures } from "./graphs";
import { resourceChanged } from "./projection";
import { unbindExtensions, EXT_ACTIONS, EXTENSION_INSTALL_ACTIONS, loadExtensions, scriptBindings, scriptInstallWords, connectScriptActions, scriptPressMessage } from "./extensions";
import { loadScreenNotes, screenNotesAffected } from "./desk/screen-notes";
import { invalidatePropertyErrors } from "./props";
import { outlineChanged } from "./refs";
import { componentsChanged } from "./component-schemas";
import { doorNest } from "./nest";
import { groundSeq, setTheme as useTheme, theme, type ThemeName } from "./theme";
import { stateDir, writeState } from "./state";
import { alertMark, readAlert } from "./backup/alert";
import type { AgentSession } from "./desk/agent-sessions";
import { AgentDrawer, DRAWER_ACTIONS, HOST_TILE_ACTIONS, overlay, type DrawerRun } from "./drawer";
import { namesAgent, type ResolveOpts } from "./desk/tile-address";
import type { HostMode } from "./desk/screen-layout";
import type { Desk, MovedTile } from "./desk/desk";
import type { Pane } from "./desk/panes";
import type { TileDone, Where } from "./desk/tile-actions";
import type { HomeChoice } from "./home";
import { confirms, disarms, type Arm } from "./arm";
import { hyperBinding, hyperLabel, hyperOn, HYPER_KEYS } from "./hyper";
import { describeKey } from "./key-probe";
import { WhatChanged } from "./desk/what-changed";
import { overBar, PowerBar } from "./bar/bar";
import { tilesOf } from "./bar/sources";
import { BAR_ACTIONS, type BarOn } from "./bar/actions";
import { onBarSources, type BarHost } from "./bar/source";
import type { Msg } from "./board";
import { HeldAsks } from "./held-asks";
import { DoorReporter, onStatusChange, statusHolders, waitingCounts, waitingOnYou } from "./desk/program-status";

const STATUS_BUTTON_ACTIONS = actionSet<{ surface: NoteSurface; host: SurfaceHost; standing: boolean }>()("note", { "button.press": NOTE_ACTIONS.def("button.press")!, "button.slot": NOTE_ACTIONS.def("button.slot")! });

/** Changes whose record names the one block they touched (a move or trash carries a subtree). */
const SCOPED = new Set(["edit", "create", "annotate", "reorder"]);

export interface Frame { lines: string[]; placements?: Placement[] }

/**
 * The terminal App reads keys from and draws on: the door's own (Term, drawn through a Painter), a test's fake, or a
 * session's (src/session/session-term.ts: every attached client, a Display itself, handing over the terminal of the
 * client with the person's keys).
 */
export type AppTerm = Pick<Term, "info" | "write" | "onKey" | "onResize" | "invalidate" | "stop" | "resume">
  & Partial<Pick<Term, "onBatch" | "setGround" | "paint" | "paintRow" | "frame" | "rawSink" | "lastSeq">>
  & {
    /** Let go of the terminal the person is typing on (a session's), or the one `from` names: true when one was attached. */
    detachActive?(from?: unknown): boolean;
    /** The terminal the person is typing on now (a session's client), as `detachActive` takes it. */
    typingOn?(): unknown;
    /** The session's terminals, for `peek` (a session's). */
    session?(): unknown;
    /** How each attached terminal's frames-in-flight window stands (a session's): unanswered frames, skipped, the answer's round trip (PIE-1163). */
    speed?(): unknown;
  };

export type { Video };

/** The host layer's drawer as a screen's tiles reach it (PIE-498): `tile.drawer` moves a tile in or out through it. */
export interface HostLayer {
  /** `d` is the drawer's own desk (its tiles, the drawer's tabs). */
  isDrawer(d: unknown): boolean;
  /** The desks a tile can be on now: the drawer's (once made) and the screen shown's tiles. Followers follow across them. */
  desks(): Desk[];
  /**
   * What `tile=` names across layers, asked first by every screen host's dispatcher (PIE-1285), a desk or not: a tile's
   * id, `drawer.agent`, an `@screen/tile` path, a program's told id (`program`). Never a screen's own names. The drawer's
   * desk answers (it reads every layer); none made yet, nothing.
   */
  resolveTile(sel: string, o?: ResolveOpts): { tile: TileRef; dispatch: Dispatcher; desk: Desk } | null;
  /** Why `sel` names no tile in the host layer, in words and with the command to run (the drawer's own program closed, or out on a screen not shown), or null: the dispatcher's refusal says it. */
  unnamed(sel: string): string | null;
  /** Tile `name` of screen `from` into the drawer, whole, as a tab unless `to`/`where` place it in the drawer's layout; `keys`: the person's go into it there (a new note to write). */
  put(from: Desk, name: string, actor: Actor, keys?: boolean, to?: string, where?: Where): TileDone;
  /** Tiles still running on a screen that goes for good, kept in the drawer instead of ended (tabs behind the one shown): the panes it took. */
  keep(moved: MovedTile[]): Pane[];
  /** Why tiles like these couldn't be kept in the drawer now, or null. */
  keepRefusal(moved: Pick<MovedTile, "name" | "spec">[]): string | null;
  /** The tile the drawer shows now (not its own tab), or null. */
  shownTab(): string | null;
  /**
   * Go to tile `p` wherever it is now (the "waiting on you" list's status.go): in the drawer, the drawer up and its tab
   * shown with the keys in it; on the screen shown, the drawer put away and the keys given to it. Refused for a tile on
   * a screen under this one.
   */
  goTo(p: Pane, actor: Actor, o?: { zoom?: boolean }): { tile: string; in: "drawer" | "screen"; raised?: string };
  /** Open block `id` on the screen shown, where its opens land (a detail; `fresh`: a new one), for a tile in the drawer, which has none of its own; `from`: that tile, whose link to a tile of the screen (alt+l) takes it first. */
  openOnScreen(id: string, fresh: boolean, actor: Actor, from?: string, reveal?: import("./reveal").Reveal): Promise<{ tile: string | null; name?: string; id: string }>;
  /** Tile `name` in the drawer back into the screen shown, beside `to` (where). */
  take(name: string, to: string | undefined, where: Where | undefined, actor: Actor): TileDone;
  /** Fold the drawer to a strip at its edge (a tile in it with nothing beside it, folded: `tile.collapse`); on=false opens it as it was. */
  collapse(name: string, on: boolean | undefined, actor: Actor): TileDone;
  /** The drawer is folded to a strip. */
  readonly folded: boolean;
  /** Where the drawer is drawn now (its strip while folded), or null when it is put away: what `peek` reports. */
  drawnRect(): Rect | null;
  /** Why `actor` can't fold the drawer now (an agent, and the person is in it), or null. */
  foldRefusal(actor: Actor): string | null;
  /** Put the drawer away from its tile `name` (drawer.away, host.toggle open=false): its tiles stay as they are. */
  away(name: string, actor: Actor): TileDone;
  /** Every agent session this door holds (PIE-737): the agent panel's rows. */
  sessions?(): AgentSession[];
}

/** The test run's registry of Apps (test/preload.ts), by a global symbol so the app needs no import from the tests. */
/** A refusal of the person's key or click (Ctx.refuse), as the focused tile's frame says it. */
export interface Refusal { text: string; loud: boolean }

/** What a key or click is, to tell the same one pressed again: a key whole, a click by where it landed. Null: not a press. */
export function pressOf(k: Key): string | null {
  if (k.kind !== "mouse") return JSON.stringify(k);
  return k.action === "down" ? `click:${k.button}:${k.x},${k.y}` : null;
}

export const TEST_APPS = Symbol.for("ep0ch.test.apps");

export interface Ctx {
  /** Local extension undo owns the layout receipt; consume its broadcast without undoing twice. */
  readonly scriptUndos?: Set<string>;
  agentPointers?: AgentPointers;
  t: TermInfo;
  /** The host layer's drawer, where a tile goes to travel across screens (absent: none here). */
  readonly hostLayer?: HostLayer;
  /** Where the person's keys are (PIE-1346): the desk holding their focused tile (your drawer's, a group's), else the screen shown. */
  keysScreen?(): Screen | undefined;
  /** "What changed" includes machinery (`changes.machinery`); off by default. */
  machineryChanges?: boolean;
  /** Agents are in yolo (`agents.yolo`): no person guard holds one back. Off by default, for this door's run. */
  agentsYolo?: boolean;
  /** What others changed since the person last looked (PIE-647), from the change feed. */
  whatChanged?: WhatChanged;
  /** Requests an agent or an extension wrote that wait for the person's `r` (PIE-888): the status bar's count and the waiting-on-you list. */
  heldAsks?: HeldAsks;
  waitingAsks?: WaitingAsks;
  /** The backup job's alert on this machine (PIE-607): the status bar's mark and what it says, or null. */
  backupAlert?(): { text: string; say: string } | null;
  board: SocketBoard;
  host: string;
  workspace: string;
  /** The outline's name on an outline host (PIE-466); absent on a single-outline service. */
  outline?: string;
  /** The ssh name of the machine the outline is on, when the door reached it there; absent: this machine. */
  readonly machine?: string | undefined;
  video: Video;
  get graphics(): boolean;
  push(s: Screen): void;
  pop(): void;
  /** The screens on the stack, the top last (absent: a context with no stack). */
  screens?(): readonly Screen[];
  replace(s: Screen): void;
  quit(): void;
  redraw(): void;
  readonly overflow?: Overflow;
  readonly messages?: StatusLog;
  /** How fast the door keeps up (src/speed.ts): `status.speed` and `peek` read it. */
  readonly speed?: SpeedMeter;
  readonly dispatch?: Dispatcher;
  flash(msg: string, ms?: number, details?: MessageDetails): void;
  /**
   * The person's own key or click was refused (PIE-727): `msg` says why. The status bar has it, as `flash`'s, and the
   * focused tile says it on its frame (`refusal`). The same key refused again makes it loud: it stays up, highlighted,
   * until a different key. An agent's refusal is never this: it is said with who it is (`flash`).
   */
  refuse?(msg: string, at?: number): void;
  /** Which of the person's keys or clicks is being answered now (refuse's `at`, taken as an action begins). */
  pressNow?(): number;
  /** The refusal said now, for the focused tile's frame to show: its words, and loud when the same key was refused again. */
  refusal?(): Refusal | null;
  /**
   * Esc reached a screen with nothing left to close (src/shell-keys.ts `nothingToClose`): what the frame around it does
   * instead of saying so (the showcase's stage hands the keys back to its index). The door's own Ctx leaves it out.
   */
  nothingToClose?(leave: string): void;
  /**
   * Put text on the terminal's clipboard (OSC 52; Herdr and Ghostty pass it on), and say "copied to clipboard" over the
   * screen; `from`: a terminal tile's name, when its program copied it ("copied from <tile>"). False when nothing was
   * copied (over COPY_MAX, or a tile's copy the door didn't pass on: `Uncopied`), and the toast says why.
   */
  copy?(text: string | Uncopied, from?: string, write?: (bytes: string) => boolean | void): boolean;
  cycleVideo(): void;
  /**
   * `keys.probe` (PIE-699): the next keys are described instead of run (the bytes they arrived as, the modifiers, what the
   * door reads them as); esc, or the action again, ends it. `on` left out toggles. The new state.
   */
  probeKeys?(on?: boolean): boolean;
  /** Draw in this theme from now on (`theme.set`): every screen at once, the terminal's ground too, and kept for next time. */
  setTheme?(name: ThemeName): void;
  /**
   * The door is about to quit (the menu's logoff): true when it may. With programs running in a screen (even
   * one in the background) or an unsaved edit, the first ask says so and refuses; again within 3s goes.
   */
  confirmQuit?(): boolean;
  /**
   * The person logs off (the menu's Goodbye, ctrl+c): in a session, their terminal detaches and everything goes on
   * running (`detaches`); in the door's own terminal, the door quits.
   */
  logoff?(from?: unknown): void;
  /** Logging off only detaches this terminal: the door is a session (src/session/), which goes on without it. */
  readonly detaches?: boolean;
  /**
   * End the door, and with it the session (`session.end`): null once it's ending; else why not, as said (programs
   * run or a draft is unsaved: again within 3s ends it). `force` ends it anyway, the drafts copied to disk first.
   */
  end?(force: boolean): string | null;
  /**
   * The session onto new code (`session.upgrade`): handed to a new daemon, or with `clients` only its terminals started
   * again; what happened. Absent: this door runs in its own terminal, not as a session.
   */
  upgradeSession?(clients: boolean): Promise<{ ok: boolean; message: string }>;
  /** Which terminal the person is typing on now (a session's client), for a logoff begun there: `logoff(from)` lets go of that one. */
  typingOn?(): unknown;
  /**
   * Hand the person's terminal to another program for the duration of `run`, then repaint: $EDITOR (ctrl+e, ctrl+x ctrl+e), the drop
   * shell (`screen.shell`). `run` starts its program through the Handover it is given (src/drop.ts): in the door's own
   * terminal, or, in a session, the terminal of the client with the person's keys. The door waits with its event loop
   * running (tiles read, the control socket answering); nothing is painted to that terminal meanwhile. `what` is said by `peek`.
   */
  suspend(run: (terminal: Handover) => Promise<unknown>, what?: string): Promise<void>;
  /** What has the terminal while the door is suspended ("shell", "editor"), or null. */
  suspended?(): string | null;
  /**
   * Run a program for a moment in a terminal tile beside the note instead of suspending the door (PIE-417): $EDITOR's
   * editor, ctrl+t's picker. True when the screen has tiles and opened one; `done` is called with its exit code when it
   * ends, and the tile closes.
   */
  inTile?(p: TileProgram, done: (code: number | null) => void): boolean;
  lastCall: number;
  events: number;          // outline changes seen since the menu last looked (the people's: machinery apart)
  /** Every change seen since the menu last looked, machinery too. */
  eventsAll?: number;
  /** Times the outline connection came back (a `reconnected` or `reset`): a screen that wasn't on top then checks on its next render. */
  reconnects?: number;
  /** The note in the reader the person is in, else the note the screen shows as its current one (the power bar's `near`). */
  noteInFront?(): string | null;
  /** The screen stack, bottom first (the shell's actions read it: `screen.list`, what `screen.back` leaves). */
  screens?(): readonly Screen[];
  /** Screens left with programs running in them, kept in the background until opened again (the desk's terminals). */
  kept?(): readonly Screen[];
  /**
   * Bring screen `s` to the top (PIE-656, the power bar going to a tile on it): one under the top moves up, the others
   * keep their order; one kept in the background is opened again. Nothing is left or ended.
   */
  raise?(s: Screen): void;
  /** Milliseconds since the person last pressed a key or used the mouse: an agent moves their screen only when they're idle. */
  idleFor?(): number;
  /**
   * The home base's door (src/home.ts): before a door is on an outline, `choose` ends it with the outline the person or
   * an agent chose, and the door opens on that. Absent on a door that is on an outline.
   */
  home?: { choose(c: HomeChoice): void; cancel?(): void };
  /**
   * Where the person is (PIE-514): their keys and focus, the tile they type in, whether they're busy, how long idle.
   * The shell's one answer (src/whereabouts.ts); a frame around a screen answers it as seen from inside.
   */
  person?(): Whereabouts;
  recordAction?(req: ActRequest, replay: import("./surface/actions").Replay, run: () => unknown): unknown;
  /** Run an action as the person through the door's own dispatcher (its every screen's: `note.new`, `open`, `edit`); a refusal is said. */
  press?(name: string, args?: Record<string, unknown>, tile?: string): Promise<unknown>;
  /**
   * Arm an edit (src/arm.ts, `edit.arm`): the status bar asks, the next key opens it (⏎, or the arming key again) or
   * lets it go and does what it does; the window running out lets it go. Absent: the edit opens at once.
   */
  arm?(a: Arm): void;
  /** The edit armed now, or null: the screen draws its tile in the edit's colour. */
  armed?(): Arm | null;
  /** Let an armed edit go without a key (a frame's screen changed under it). */
  disarm?(): void;
}

export interface Screen {
  title: string;
  /**
   * What the screen is, by name (a screen spec's, PIE-515: `desk`, `board`, `welcome`; the river's, the showcase's):
   * a menu item that keeps state opens only one screen of its name at a time.
   */
  readonly name?: string;
  /** Arguments that reopen this named screen through `screen.open` after a session handoff. */
  openArgs?(): Record<string, unknown> | null;
  /** Rows available = t.rows - 1 (the last row is the status bar). */
  render(ctx: Ctx): Frame;
  key(k: Key, ctx: Ctx): void;
  enter?(ctx: Ctx): void;
  /** Visibility of a kept screen; hidden time does not age its arrival accents. */
  shownAs?(on: boolean): void;
  /** Called ~30×/s while it returns true (modem-speed reveals). */
  tick?(ctx: Ctx): boolean;
  onEvent?(e: OutlineEvent, ctx: Ctx): void;
  /** True while the screen holds a draft that hasn't been saved; closing it or quitting then asks twice. */
  unsaved?(): boolean;
  /** The screen is being closed with unsaved drafts: copy them to disk, return where they went. */
  keepDrafts?(): string[];
  /** The door is ending or handing over (PIE-643): save what a restart would bring back that isn't saved as it changes (readers' places). */
  keepPlace?(): void;
  /** The door is ending (any way): copy what an editor still has open for a draft (ctrl+e) to disk, return where. */
  keepEdits?(): string[];
  /** The screen wants every key, even those a frame around it keeps (an edit, a comment, a property panel). */
  holdsKeys?(): boolean;
  /**
   * The person is typing in something here (an edit, a comment, a panel) and a hyper chord (PIE-699) is about to move the
   * keys to another tile: leave it as a click elsewhere leaves it (saved, or kept as unsent). False when it can't be left
   * (said), and the chord does nothing.
   */
  leaveTyping?(): boolean;
  /**
   * Where the person's keys are on this screen (PIE-514), by the names `tile=` uses: the tile with their focus, the
   * one they type in, whether anything here holds their keys. The shell's whereabouts query reads it.
   */
  keys?(): ScreenKeys;
  /** What this screen shows, for agents (`ep0ch-door peek`). */
  describe?(): unknown;
  /** Put a block in front of the user (`ep0ch-door open <id>`). */
  openBlock?(m: import("./board").Msg): void;
  /** The note in the reader the person is in here, where a new note goes under (PIE-544, `note.new`); none: the Inbox. */
  noteContext?(): string | null;
  /**
   * A new note for the person to write (PIE-544): opened where `how` says on this screen (PIE-591: a float by default,
   * a tab, the drawer, or where its opens land; a screen without tiles opens it where its opens land), given their
   * keys, its edit open (the reader's `edit`, the one editor and draft session). The reader's name, or null when none took it.
   */
  editNew?(m: import("./board").Msg, how?: import("./new-note").NewNoteHow): Promise<string | null>;
  /** What this screen's spec says ctrl+n does where the person is now (PIE-591: `ScreenSpec.newNote`), or null. */
  newNoteRule?(): import("./desk/screen-spec").NewNoteRule | null;
  /** An agent's new note shown here for the person (note.new opens=), never taking their keys: the tile's name, or null. */
  showNew?(m: import("./board").Msg, opens: import("./desk/screen-spec").NewNoteOpens, actor: Actor): Promise<string | null>;
  /** The person is typing in an edit here, where ctrl+n is still a new note (PIE-591; not a filter, a picker or a terminal). */
  newNoteWhileTyping?(): boolean;
  /**
   * The screen's dispatcher (PIE-514): the action sets it registered, run by its keys and clicks and by `act`
   * (`ep0ch-door actions` lists them). A screen without one has only the shell's.
   */
  readonly dispatch?: Dispatcher;
  /** A script run ended (PIE-957): the screen closes the layout transaction that run held, by its end rule. */
  scriptEnded?(run: string, reason: "done" | "stopped" | "failed"): void;
  /** A script run's writes were taken back (`ext.undo`): the screen takes back the layout it changed in that run. */
  scriptUndone?(run: string): void;
  /** The service was lost and found again: transactions waiting on a run's end end early. */
  scriptsLost?(): void;
  /** A script run is rearranging this screen (a dance): the status bar offers a click that stops it (layout.stop, as Esc does). */
  dancing?(): boolean;
  /** Snap any motion to the settled screen (a peek or a snapshot reads that, never frames in flight); true when something was moving. */
  settle?(): boolean;
  /** Every key is the screen's, ctrl+c included, and a paste goes to it whole: the person is typing in a terminal tile (PIE-417). */
  rawKeys?(): boolean;
  /** Where raw input bytes go right now (a running terminal tile the person is in), or null to decode keys. */
  rawInput?(): ((bytes: string) => void) | null;
  /** Leaving the screen would end something (programs running in tiles): said, and asked twice. */
  leaveWarning?(): string | null;
  /**
   * The screen is left (popped or replaced). It ends what it started, or answers "keep": it has programs
   * running (the desk's terminal tiles) and stays alive in the background until it's opened again or the
   * door quits.
   */
  dispose?(): void | "keep";
  /** Why the screen can't be left now (it would end something and has no way back), or null. */
  leaveRefusal?(): string | null;
  /** Leaving it loses something it doesn't keep itself (a screen built and not saved): said, and leaving asks twice. */
  shapeWarning?(): string | null;
  /** See Ctx.inTile. */
  inTile?(p: TileProgram, done: (code: number | null) => void): boolean;
  /** What the person sees, for `view.subscribe`: diffed after every paint and pushed as events. */
  viewState?(): ViewState;
  /** The edits open here, by tile: what a session's next daemon opens again after a handoff (src/session/restore.ts). */
  reopen?(): (import("./session/restore").Step & { tile: string })[];
  /** No drawer and no chip here (the logon, the logoff: the person isn't in yet, or is leaving). */
  noDrawer?: boolean;
  /**
   * Where the host layer (the drawer) may appear over this screen, as its spec says (PIE-513, its policy's
   * `host`): `over` it (the default), `beside` it (the screen drawn shorter), or `none` (it keeps the whole screen).
   */
  hostMode?(): HostMode;
  /** The tiles shown here, when they're a desk inside this screen (the showcase's stage): where a tile taken out of the drawer lands. */
  tilesHere?(): Desk | undefined;
  /** A click in a tile lifted out of this screen enters its existing tile host. */
  enterTiles?(): void;
}

/**
 * What a screen shows, as `view.subscribe` publishes it: which tile has the keys (and what it shows), the
 * layout's shape, each tile's viewport (what's in view) and cursor or selection, and the attention marks.
 */
export interface ViewState {
  focus: { tile: string; name?: string; block?: string | null; file?: string | null };
  layout: unknown;
  tiles: { tile: string; name?: string; viewport: unknown; cursor?: unknown }[];
  marks?: unknown;
}
/** One event of the live feed: `focus.changed`, `layout.changed`, `viewport`, `cursor`, `marks.changed`, `screen`. */
export interface ViewEvent { type: string; at: number; [k: string]: unknown }

/** An agent's actor id: what it calls itself, or `ep0ch-door:<host>:agent`. Kept to plain, short ids. */
export function agentActor(as?: string): Actor {
  const id = (as ?? "").trim() || AGENT_ACTOR_ID;
  if (!/^[\w.:@/-]{1,80}$/.test(id)) throw new ActionRefused(`an actor id is 1-80 letters, digits and . : @ / - _, not ${JSON.stringify(id)}`);
  // `ext:<id>` is an extension's, and only the service's extension runtime writes as one (it refuses a
  // client that names it). An agent runs an extension's action as itself: `act ext.<id>.<action>`.
  if (/^ext:/i.test(id)) throw new ActionRefused(`${id} is an extension's actor id: only the outline service writes as an extension; name yourself (--as <your id>) and run its action (act ext.${id.slice(4)}.<action>)`);
  return { kind: "agent", id };
}

/** A frame: no screen paints more often than this, and no hover report is handled more often (App.redraw, App.key). */
const FRAME_MS = 16;

export class App implements Ctx {
  readonly overflow = new Overflow();
  /** The host layer's drawer, as a screen's tiles reach it (`tile.drawer`). */
  get hostLayer(): HostLayer { return this.drawer; }
  private stack: Screen[] = [];
  /** Where frames go: this terminal (a Painter over it), or every client of a session (src/session/). */
  private readonly display: Display;
  private message = "";
  private messageUntil = 0;
  private timer: Timer | null = null;
  /** Stops hearing resizes end (src/resize.ts): the door ended or was retired. */
  private offResize: () => void = () => {};
  private started: number;
  /** The status bar's clock and uptime as last painted: a minute later, the bar alone is repainted. */
  private shownTime = "";
  private quitArmed = 0;
  /** When the person last pressed a key or used the mouse (Date.now()). */
  lastInput = 0;
  host = "";
  workspace = "";
  outline: string | undefined;
  /** The ssh name of the machine the outline is on, when the door reached it there (`--machine`, a `.ep0ch`'s `machine`). */
  machine: string | undefined;
  /** The video mode (the display's: in a session, the client with the person's keys). */
  get video(): Video { return this.display.video; }
  set video(v: Video) { this.display.video = v; }
  /** How many notes others changed since the person looked (what the welcome and the status bar say). */
  get events(): number { return this.whatChanged.count(); }
  get eventsAll(): number { return this.whatChanged.allCount(); }
  /** The notes others changed since the person last looked: the status bar's `+N new` and the what-changed list. */
  readonly whatChanged = new WhatChanged();
  /** The requests held for the person's `r` (PIE-888), as the service lists them. */
  readonly heldAsks = new HeldAsks();
  readonly waitingAsks = new WaitingAsks();
  reconnects = 0;
  /** Whether "what changed" (the +N count, newscan) includes what tools wrote for their own bookkeeping: `changes.machinery`. */
  machineryChanges = false;
  /** This door's person turned yolo on (`agents.yolo`): the door's guards lift, and the service is told (PIE-973). Kept only across a session handover. */
  private yoloHere = false;
  /** The service says yolo is on for the outline: this door's, or another door's (`agents` events, `mcp.access.status`). */
  private yoloService = false;
  /**
   * Agents are in yolo: the person handed them the door, and (PIE-973) the service's own rules too, as long as a door
   * of theirs says so. On when this door turned it on or the service says another did; setting it tells the service,
   * which drops it when this door's connection does.
   */
  get agentsYolo(): boolean { return this.yoloHere || this.yoloService; }
  set agentsYolo(on: boolean) { void this.setAgentsYolo(on); }
  /** Only this door's grant belongs in its handover, never another door's grant. */
  get ownsYolo(): boolean { return this.yoloHere; }
  async setAgentsYolo(on: boolean): Promise<void> {
    this.yoloHere = on;
    if (!on) this.yoloService = false;
    await this.tellYolo(on);
  }
  /** Bumped by every change of yolo this door hears or makes: an answer that was asked before the latest one is stale and dropped. */
  private yoloEpoch = 0;
  async syncYolo(): Promise<void> {
    const epoch = ++this.yoloEpoch;
    const said = (await this.board.mcpAccessStatus().catch(() => undefined))?.yolo === true;
    if (epoch !== this.yoloEpoch) return;
    // The service holds this door's yolo by its connection: after a reconnect it is gone (a restarted service or a dropped
    // connection ends it, and another door may have taken it back meanwhile). The person turns it on again.
    if (this.yoloHere && !said) this.flash("YOLO ended: the connection to the outline dropped. Turn it on again (ctrl+k > agents.yolo) if you still want it", 8000);
    this.yoloHere = false;
    this.yoloService = said;
    this.redraw();
  }
  private async tellYolo(on: boolean): Promise<void> {
    const epoch = ++this.yoloEpoch;
    try {
      const said = await this.board.setAgentsYolo(on);
      if (epoch === this.yoloEpoch) this.yoloService = said;
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      if (on) { this.yoloHere = false; this.flash(`YOLO is off: the outline service didn't take it (${why})`, 8000, errorDetails(e)); }
      else {
        // A take-back that didn't reach the service must not look done: what the service says is what shows, and a click tries again.
        const said = (await this.board.mcpAccessStatus().catch(() => undefined))?.yolo === true;
        if (epoch === this.yoloEpoch) this.yoloService = said;
        if (said) this.flash(`YOLO is still on: the outline service didn't take it back (${why}); click YOLO to try again`, 8000, errorDetails(e));
      }
    }
    this.redraw();
  }
  /** The service says yolo changed (an `agents` event): off is off for every door, this one's own hand-over included. */
  private heardYolo(on: boolean): void {
    this.yoloEpoch++;
    this.yoloService = on;
    if (!on) this.yoloHere = false;
    this.redraw();
  }
  private backupRead: { at: number; mark: { text: string; say: string; status?: boolean } | null } = { at: -Infinity, mark: null };
  /** The backup job's alert (src/backup/alert.ts, in the state dir's backup/), read at most once a minute. */
  backupAlert(): { text: string; say: string; status?: boolean } | null {
    const now = this.now();
    if (now - this.backupRead.at >= 60_000) this.backupRead = { at: now, mark: alertMark(readAlert(`${stateDir()}/backup`), now) };
    return this.backupRead.mark;
  }
  /** The event connection to the service is down; the door is reconnecting. */
  offline = false;
  /** The home base's door: what ends it with the outline chosen (Ctx.home); absent on a door that is on an outline. */
  home?: { choose(c: HomeChoice): void; cancel?(): void };
  private readonly offStatus: () => void;
  private reportTimer: Timer | null = null;
  /**
   * The door's own program status to its terminal, through `DoorReporter`: the root says what a person away needs (a tile
   * blocked on them, a failure, a long job's done) once it has held a few seconds, the tiles are children for a terminal
   * that shows them, and none of it is sent more than five times a second however fast its programs report: the spec
   * asks a terminal to rate-limit what a record causes outside it, and the door is that terminal for its tiles.
   */
  private readonly reports = new DoorReporter(() => this.outline ?? this.location, () => this.now());
  private reportStatus() {
    if (this.reportTimer || this.closed) return;
    this.reportTimer = setTimeout(() => { this.reportTimer = null; if (this.closed) return; try { this.display.programStatus?.(this.reports.report(statusHolders(this.drawer))); } catch { /* a report the terminal can't take is left out, never the door */ } }, 200);
  }
  /** The agent that stays with the person on every screen, pulled up from the status bar (PIE-498). */
  readonly drawer: AgentDrawer;

  /** The power bar while it's open (PIE-656): over every screen and the drawer, with the person's keys. */
  bar: PowerBar | null = null;
  /** The note in the reader the person is in, else the note the screen shows as its current one. */
  noteInFront(): string | null {
    try { const s = this.stack.at(-1); return s?.noteContext?.() ?? tilesOf(s)?.current?.id ?? null; } catch { return null; }
  }
  /** What the bar's sources reach: this door, its dispatcher, its screens, the note the person is on. */
  private readonly barRuns: import("./bar/command").BarRun[] = [];
  barHost(): BarHost {
    return {
      ctx: this, runs: this.barRuns, dispatch: this.dispatch, screens: () => this.stack, kept: () => this.background,
      near: () => this.noteInFront(),
      note: id => readNote(this, id),
    };
  }
  /** What the bar's actions run on (BAR_ACTIONS). */
  private readonly barOn: BarOn = {
    bar: () => this.bar,
    open: o => {
      for (const d of this.drawer.desks()) d.liftedDesk?.dropLift();
      this.bar?.close();
      const b = new PowerBar(this.barHost(), (n, alt) => { void this.dispatch.press("bar.pick", { n, alt }); }, o);
      this.bar = b;
      this.redraw();
      return b;
    },
    unseen: async o => {
      const b = new PowerBar(this.barHost(), () => {}, { ...o, quick: true });
      const out = await b.settled();
      if (out.length) { b.close(); throw new ActionRefused(`${out.join(", ")} didn't answer in time; ask again`); }
      return b;
    },
    close: () => { this.bar?.close(); this.bar = null; this.redraw(); },
    host: () => this.barHost(),
  };
  private statusBoxes: StatusHit[] = [];
  private readonly statusButtons = new NoteSurface();
  readonly statusNote: StatusBarNote;
  private drawerRun: DrawerRun;

  /** `now`: the clock the status bar reads (a test's fake one). */
  constructor(private readonly term: AppTerm, readonly board: SocketBoard, public lastCall: number, private readonly done: () => void, private readonly now: () => number = Date.now) {
    this.statusNote = new StatusBarNote(board, () => this.redraw(), text => this.flash(text, 12_000, { kind: "warning" }));
    this.started = now();
    this.speed = new SpeedMeter(now);
    this.display = isDisplay(term) ? term : new Painter(term as RawTerm);
    // The door's own terminal: an image it lost is uploaded and placed again (PIE-795).
    const decoder = (term as { decoder?: KeyDecoder }).decoder, painter = this.display;
    if (decoder && painter instanceof Painter) decoder.kittyError = id => painter.imageLost(id);
    this.ground();
    // The host layer (PIE-513): above every screen, kept across switches; the agent is its drawer's first tab.
    this.drawer = new AgentDrawer({ statusChip: () => {
      const hit = this.statusBoxes.find(h => h.item.id === "drawer");
      return hit ? { from: hit.from, to: hit.to, row: this.term.info.rows - 1 } : null;
    }, redraw: () => this.redraw(), statusChanged: () => this.statusChanged(), flash: (m, ms) => this.flash(m, ms), screen: () => this.stack.at(-1), person: () => this.person(), ctx: () => this });
    // The drawer's keys and clicks run the host layer's actions as the person, through the App's dispatcher.
    this.drawerRun = (name, args) => { void this.dispatch.pressIn(DRAWER_ACTIONS, name, args); };
    this.drawer.run = (name, args) => this.dispatch.pressIn(DRAWER_ACTIONS, name, args);
    term.onKey(k => this.key(k));
    term.onBatch?.(run => this.batched(run));
    // Raw input while the person types in the drawer or a terminal tile: the drawer first, then the
    // screen says where it goes (Term keeps mouse and ctrl+]).
    // In the drawer, the person's bytes are the drawer's alone (a picker, a reader tab): never the screen's terminal under it.
    (term as { rawSink?: unknown }).rawSink = () => {
      const sink = this.probing ? null : this.drawer.shown && this.drawer.entered ? this.drawer.rawInput(this.drawerRun) : this.stack.at(-1)?.rawInput?.() ?? null;
      return sink ? (bytes: string) => {
        this.drawer.desks().map(d => d.liftedDesk).find(Boolean)?.dropLiftElsewhere();
        sink(bytes);
      } : null;
    };
    connectFigures(board, () => this.redraw());
    // Every line typed in completes outline text from this connection by default (PIE-626: LineField, src/surface/line.ts).
    useCompletion(board, () => this.redraw(), () => this.barHost());
    // A cut or copy in any line field goes to the door's clipboard (PIE-1290).
    lineCompletionHooks.copy = text => { this.copy(text); };
    // A terminal tile's program said what it's doing (OSC 7501): its header, the chip and the status bar's count.
    // It goes to the terminal the door runs in too, when that terminal speaks the protocol (the door as a program).
    this.offStatus = onStatusChange(() => { this.redraw(); this.reportStatus(); }, this.drawer);
    this.reportStatus();
    this.whatChanged.subscribe(() => { this.bar?.refresh(true); this.redraw(); });
    this.waitingAsks.subscribe(() => this.redraw());
    this.heldAsks.subscribe(() => this.redraw());
    // A source that came or went (an extension added or removed) is asked, or dropped, by the open bar at once.
    onBarSources(() => { this.bar?.refresh(true); this.redraw(); });
    // An image scaled (or dimmed, or read again after a change on disk) is drawn in the next frame.
    onMediaChange(() => this.redraw());
    board.onConnection = (state, detail) => { this.offline = state === "lost"; this.flash(state === "lost" ? detail : `reconnected · ${detail}`); };
    // A terminal being resized sends a size a moment: a resize (src/resize.ts) until they stop. When one ends, the
    // frame after lays out and scales for where it ended.
    term.onResize(() => { resizing(); this.redraw(); });
    this.offResize = onResizeEnd(() => this.redraw());
    this.timer = setInterval(() => this.tick(), 33);
    this.display.onSeen?.(() => this.catchUp());
    // The test run's registry (test/preload.ts), when there is one: an App a test file leaves running is retired once
    // the next file starts, so it never paints against that file's boards. Nothing outside tests sets it.
    (globalThis as { [TEST_APPS]?: { add(app: App): void } })[TEST_APPS]?.add(this);
  }

  /**
   * Stops it ticking and painting, and nothing else (no draft copied out, no `done`): what the test run does with an
   * App a finished test file left running (test/preload.ts).
   */
  retire(): void {
    this.closed = true;
    stopCompletion(this.board);
    this.offResize();
    if (this.timer) clearInterval(this.timer);
    if (this.paintTimer) clearTimeout(this.paintTimer);
    if (this.hoverTimer) clearTimeout(this.hoverTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.timer = null; this.paintTimer = null; this.publishTimer = null;
  }

  /**
   * The screen layer's terminal: the whole of it, or (the host layer pulled up beside a screen that asks for that) the
   * rows above the drawer. Screens read their size only here, so their drawing, their hit rows and their keys agree.
   */
  get t() {
    const i = this.term.info, beside = this.drawer.besideRows(i.rows, i.cols);
    return beside ? { ...i, rows: Math.max(2, i.rows - beside) } : i;
  }
  screens(): readonly Screen[] { return this.stack; }
  kept(): readonly Screen[] { return this.background; }
  raise(s: Screen) {
    if (this.stack.at(-1) === s) return;
    if (this.stack.includes(s)) { this.stack.at(-1)?.shownAs?.(false); this.disarm(); this.stack = this.stack.filter(x => x !== s); this.stack.push(s); s.enter?.(this); this.redraw(); this.onStack?.(); return; }
    this.push(s);
  }
  idleFor(): number { return Date.now() - this.lastInput; }
  /** An action as the person, through the door's dispatcher (Ctx.press): `note.new`'s open and edit on a screen without readers. */
  press(name: string, args: Record<string, unknown> = {}, tile?: string): Promise<unknown> { return this.dispatch.press(name, args, tile); }
  get graphics() { return this.video !== "cells"; }

  /** Screens left with programs still running in them (the desk's terminals): alive until reopened or the door quits. */
  background: Screen[] = [];
  /**
   * Every screen holding the person's text when the door ends or is handed over: the stack, the background, and the
   * drawer's desk (a reader in the drawer's edit or comment is theirs as much as a shown one's).
   */
  holders(): Screen[] { return [...this.stack, ...this.background, ...(this.drawer.made ? [this.drawer.made] : [])]; }
  push(s: Screen) { this.stack.at(-1)?.shownAs?.(false); this.disarm(); this.background = this.background.filter(x => x !== s); this.stack.push(s); s.enter?.(this); this.redraw(); this.onStack?.(); }
  /** The screens changed (one opened, left or kept in the background): a session checkpoints them (src/session/restore.ts). */
  onStack: (() => void) | null = null;
  pop() {
    const last = this.stack.length === 1;
    if (!this.leaving(last ? [...this.stack, ...this.background] : [this.stack.at(-1)], last)) return;
    this.leave();
    if (!this.stack.length) return this.quit();
    this.redraw();
    this.onStack?.();
  }
  replace(s: Screen) { if (!this.leaving([this.stack.at(-1)])) return; this.leave(); this.push(s); }
  /** The top screen goes: it ends what it started, or keeps running in the background (its programs). */
  private leave() {
    // An armed edit is the screen's that goes: it goes with it.
    this.disarm();
    const top = this.stack.pop();
    top?.shownAs?.(false);
    this.stack.at(-1)?.shownAs?.(true);
    if (top?.dispose?.() === "keep") { this.background.push(top); this.flash(`${top.leaveWarning?.() ?? top.title} · still running · D on the menu comes back`, 6000); }
  }

  /**
   * Closing screens that hold unsaved edits asks twice. The second time goes ahead, but the drafts are
   * copied to disk first, so typed text is never simply dropped.
   */
  /**
   * Leaving screens (or, `quitting`, the door): an unsaved edit asks twice, and so does quitting while programs
   * run in a screen. Leaving a screen that keeps its programs alive (the desk) doesn't ask: nothing ends.
   * A screen that can't be left says why and stays.
   */
  private leaving(screens: (Screen | undefined)[], quitting = false): boolean {
    const refusal = quitting ? null : screens.map(s => s?.leaveRefusal?.()).find(Boolean);
    if (refusal) { this.flash(refusal); return false; }
    // Quitting, a reader in the drawer's unsaved edit asks too (its programs are the drawer's own warning).
    const dirty = [...screens, ...(quitting && this.drawer.made ? [this.drawer.made] : [])].filter((s): s is Screen => !!s?.unsaved?.());
    // Quitting with the tune inspector's nudges unwritten (PIE-673): they live in memory, so say so once, never lose them silently.
    const tuned = quitting ? tuningOf(this.board).unsavedCount() : 0;   // this door's own connection, never another App's in the same process
    const tuning = tuned ? `unsaved tuning, s to save (${tuned} value${tuned === 1 ? "" : "s"}, alt+y opens the tune inspector) · again within 3s quits without ${tuned === 1 ? "it" : "them"}` : null;
    const warn = (quitting ? screens.map(s => s?.leaveWarning?.()).find(Boolean) ?? this.drawer.leaveWarning() ?? this.quitWarning?.() ?? tuning : null) ?? screens.map(s => s?.shapeWarning?.()).find(Boolean) ?? null;
    if (!dirty.length && !warn) return true;
    if (Date.now() - this.quitArmed < 3000) { this.quitArmed = 0; dirty.forEach(s => s.keepDrafts?.()); return true; }
    this.quitArmed = Date.now();
    this.flash(dirty.length ? "an edit isn't saved · ctrl+s saves it · again within 3s leaves (the draft is copied to disk)" : warn!);
    return false;
  }
  inTile(p: TileProgram, done: (code: number | null) => void): boolean { return (this.drawer.entered ? this.drawer.desk : this.stack.at(-1))?.inTile?.(p, done) ?? false; }
  confirmQuit(): boolean { return this.leaving([...this.stack, ...this.background], true); }
  get detaches(): boolean { return !!this.term.detachActive; }
  typingOn(): unknown { return this.term.typingOn?.() ?? null; }
  logoff(from?: unknown): void {
    if (!this.term.detachActive) return this.quit();
    // The session stays where the person was, not on the Goodbye.
    if (this.stack.at(-1)?.title === "logoff") this.stack.pop();
    this.term.detachActive(from);
    this.redraw();
  }
  /** A session's own: hand it over, restart its terminals (src/session/daemon.ts). */
  session: { upgrade(): Promise<{ ok: boolean; message: string }>; reload(): string } | null = null;
  /** Something more that ends with the door, to ask about first (a session's programs kept for screens not open yet). */
  quitWarning: (() => string | null) | null = null;
  async upgradeSession(clients: boolean): Promise<{ ok: boolean; message: string }> {
    if (!this.session) return { ok: false, message: "this door runs in its own terminal, not as a session" };
    return clients ? { ok: true, message: this.session.reload() } : this.session.upgrade();
  }
  /** Paint now (a restore: the screen it opened is drawn at once, so its tiles adopt their programs). */
  flush(): void { if (this.paintTimer) { clearTimeout(this.paintTimer); this.paintTimer = null; } if (!this.closed) this.paint(true); }
  /**
   * The frame skipped while nobody saw the screen (a session with no terminal attached), drawn now: before a control
   * command reads it (peek, snap, an act whose rows come from the last frame) and when a terminal attaches.
   */
  catchUp(): void {
    // What a control command reads is the settled screen, never a transition's frames (PIE-958).
    const snapped = this.stack.at(-1)?.settle?.() === true;
    if (this.skipped || this.paintTimer || snapped) this.flush();
  }
  /** A frame was due while nobody saw the screen, and wasn't rendered. */
  private skipped = false;
  end(force: boolean): string | null {
    if (force) { this.terminate(); return null; }
    if (!this.leaving([...this.stack, ...this.background], true)) return this.message;
    this.quit();
    return null;
  }
  private messageWarning = true;
  readonly messages = new StatusLog();
  private showMessage(msg: string, ms: number, warning: boolean, details: MessageDetails = {}) {
    const meta = { ...messageContext.getStore(), ...details };
    const focus = this.person().focus;
    const desk = focus?.startsWith("drawer:") ? this.drawer.desk : tilesOf(this.stack.at(-1));
    const tile = meta.tile === undefined ? desk?.tileOutline().find(t => t.focused) : undefined;
    this.messages.append(msg, { tile: tile?.id ?? focus ?? undefined, note: tile?.showing?.id, ...meta });
    this.messageWarning = warning; this.message = printable(msg, " ");
    if (details.href) this.message = `\x1b]8;;${new URL(details.href).href}\x1b\\${this.message}${OSC8_CLOSE}`;
    this.messageUntil = Date.now() + ms; this.flashes++; this.redraw();
  }
  /** A message in the status bar: untrusted text stays plain; an explicit href supplies its clickable destination. */
  flash(msg: string, ms = 4000, details: MessageDetails = {}) { this.showMessage(fullPlainText(msg), ms, true, details); }

  // ── a refusal of the person's key or click (PIE-727): said on the status bar and on the focused tile's frame ──
  /**
   * The person's gestures: a key or a click (pressOf), with the ones after it while the screen held the keys for it (^W
   * then x, the ⋯ then a row of its menu) joined to it. `gestures` counts them; `pressCount` counts every press, so a
   * refusal says which it answers.
   */
  private gesture: string[] = [];
  private gestures = 0;
  private pressCount = 0;
  /** The screen held the keys after the last press (a chord waiting, a menu open): the next press continues its gesture. */
  private heldAfter = false;
  /** The refusal shown now (null once a key moved on), and the last one said: its words, its gesture, the flash after it. */
  private refusedNow: (Refusal & { press: string | null }) | null = null;
  private refusedLast: { text: string; gesture: string; n: number; flashes: number } | null = null;
  /** Which key or click is being answered now: a refusal that lands later (an action's promise) says which it answers. */
  pressNow(): number { return this.pressCount; }
  /**
   * `at`: the press it answers (pressNow when the action began). One that lands after another key came (the person moved
   * on) is said on the status bar alone: it belongs to no tile now.
   */
  refuse(msg: string, at = this.pressCount) {
    const text = printable(msg, " ");
    if (at !== this.pressCount) { this.flash(msg, 4000, { kind: messageContext.getStore()?.kind ?? "refusal" }); return; }
    const gesture = this.gesture.join(" "), last = this.refusedLast;
    // The same refusal again, by the same gesture right after it (x x on a spine, ^W x ^W x on a locked screen, the same
    // menu row twice), with nothing else said between: loud, and up until a different key (Evan pressed q seven times
    // before he saw why). A different key between them (x j x) starts over.
    const loud = !!last && !!gesture && last.text === text && last.gesture === gesture && last.n === this.gestures - 1 && last.flashes === this.flashes;
    this.refusedNow = { text, loud, press: this.gesture.at(-1) ?? null };
    messageContext.run({ ...messageContext.getStore(), kind: messageContext.getStore()?.kind ?? "refusal" }, () => this.flash(msg, loud ? Infinity : 4000));
    this.refusedLast = { text, gesture, n: this.gestures, flashes: this.flashes };
  }
  refusal(): Refusal | null {
    const r = this.refusedNow;
    // A quiet one goes with its status bar copy (its time ran out, or something else was said over it).
    if (!r || (!r.loud && (this.message !== r.text || Date.now() > this.messageUntil))) return null;
    return { text: r.text, loud: r.loud };
  }
  /**
   * A key or click came: what the tile's frame said goes (it comes back, loud, if this gesture is refused the same way
   * again); a loud one's status bar copy goes with a different key, and with the same one it times out as any message does.
   */
  private pressed(k: Key) {
    const p = pressOf(k);
    if (p === null) return;
    const r = this.refusedNow;
    if (r?.loud && this.message === r.text) { if (p !== r.press) this.message = ""; else this.messageUntil = Date.now() + 4000; }
    this.refusedNow = null;
    if (this.heldAfter && this.gesture.length && this.gesture.length < 4) this.gesture.push(p);
    else { this.gesture = [p]; this.gestures++; }
    this.pressCount++;
  }

  // ── an armed edit (src/arm.ts): the next key opens it or lets it go ──
  private armedNow: { a: Arm; timer: ReturnType<typeof setTimeout> } | null = null;
  arm(a: Arm) {
    this.disarm();
    // The window running out lets it go quietly: its question and its tile's colour go.
    const timer = setTimeout(() => { if (this.armedNow?.a === a) { this.disarm(); this.redraw(); } }, a.ms);
    this.armedNow = { a, timer };
    this.flash(a.say, a.ms);
  }
  armed(): Arm | null { return this.armedNow?.a ?? null; }
  disarm() {
    const s = this.armedNow;
    if (!s) return;
    clearTimeout(s.timer);
    this.armedNow = null;
    if (this.message === printable(s.a.say, " ")) this.message = "";
  }
  /** Flashes said so far: a key that said nothing and ran nothing is found by it (cmd+c with nothing to copy). */
  private flashes = 0;

  // ── the live feed (view.subscribe): what the person sees, pushed as it changes ──
  private viewers = new Set<(e: ViewEvent) => void>();
  private shown: { screen: string; focus: string; layout: string; tiles: Map<string, string>; cursors: Map<string, string>; marks: string } | null = null;

  /** Hear every change to what the person sees. The first event is the whole state (`hello`). */
  subscribe(f: (e: ViewEvent) => void): () => void {
    this.catchUp();
    const s = this.stack.at(-1);
    const state = s?.viewState?.() ?? null;
    f({ type: "hello", at: Date.now(), screen: s?.title ?? null, state });
    this.viewers.add(f);
    // Every subscriber starts from what the hello said: what changes after it comes as events.
    if (s && state && !this.shown) this.shown = this.snapshot(s.title, state);
    return () => { this.viewers.delete(f); };
  }

  private snapshot(screen: string, v: ViewState) {
    return { screen, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.viewport)] as const)), cursors: new Map(v.tiles.map(t => [t.tile, JSON.stringify(t.cursor ?? null)] as const)), marks: JSON.stringify(v.marks ?? null) };
  }

  /** After paints: the feed is published at most every 50ms, from what's on screen then. */
  private publishTimer: Timer | null = null;
  private schedulePublish() {
    if (!this.viewers.size) { this.shown = null; return; }
    if (this.publishTimer) return;
    this.publishTimer = setTimeout(() => { this.publishTimer = null; const s = this.stack.at(-1); if (s) this.publishView(s); }, 50);
  }

  /** After a paint: what changed since the last one, as events to every subscriber. */
  private publishView(s: Screen) {
    if (!this.viewers.size) { this.shown = null; return; }
    const v = s.viewState?.();
    const at = Date.now();
    const send = (e: Omit<ViewEvent, "at">) => { for (const f of this.viewers) { try { f({ ...e, at } as ViewEvent); } catch { /* a subscriber's own problem */ } } };
    if (!v) { if (this.shown?.screen !== s.title) send({ type: "screen", screen: s.title }); this.shown = { screen: s.title, focus: "", layout: "", tiles: new Map(), cursors: new Map(), marks: "" }; return; }
    const was = this.shown?.screen === s.title ? this.shown : null;
    const now = { screen: s.title, focus: JSON.stringify(v.focus), layout: JSON.stringify(v.layout), tiles: new Map<string, string>(), cursors: new Map<string, string>(), marks: JSON.stringify(v.marks ?? null) };
    if (this.shown && this.shown.screen !== s.title) send({ type: "screen", screen: s.title });
    if (was?.layout !== now.layout) send({ type: "layout.changed", layout: v.layout });
    if (was?.focus !== now.focus) send({ type: "focus.changed", ...v.focus });
    for (const t of v.tiles) {
      const vp = JSON.stringify(t.viewport), cu = JSON.stringify(t.cursor ?? null);
      now.tiles.set(t.tile, vp); now.cursors.set(t.tile, cu);
      if (was?.tiles.get(t.tile) !== vp) send({ type: "viewport", tile: t.tile, name: t.name, viewport: t.viewport });
      if (t.cursor !== undefined && was?.cursors.get(t.tile) !== cu) send({ type: "cursor", tile: t.tile, name: t.name, cursor: t.cursor });
    }
    if (was?.marks !== now.marks && v.marks !== undefined) send({ type: "marks.changed", marks: v.marks });
    this.shown = now;
  }
  /**
   * The person's clipboard (OSC 52), and a "copied to clipboard" toast over the bottom of the screen for a
   * moment, as Herdr's `ui.toast.clipboard` shows: the status bar's "copied N chars" is easy to miss. Every
   * copy in the door comes here (a reader's selection, a property's value, a step's link), and a terminal tile's
   * program's own OSC 52 (`from`: the tile's name), passed on. Never an agent's. In a session it goes to the client
   * with the keys, never a watcher (SessionTerm.write). Over COPY_MAX it says so and copies nothing.
   */
  copy(text: string | Uncopied, from?: string, write: (bytes: string) => boolean | void = bytes => this.term.write(bytes)): boolean {
    const no: Uncopied | null = typeof text !== "string" ? text : Buffer.byteLength(text) > COPY_MAX ? { tooBig: Buffer.byteLength(text) } : null;
    if (no || typeof text !== "string") {
      // Long enough to read why, and what to do (click in the tile, then copy again).
      this.toast = { text: uncopied(no ?? (text as Uncopied), from), until: Date.now() + TOAST_MS * 3, ok: false };
      this.redraw();
      return false;
    }
    if (write(osc52(text)) === false) {
      this.toast = { text: "not copied: the pressing terminal is no longer available", until: Date.now() + TOAST_MS, ok: false };
      this.redraw();
      return false;
    }
    this.toast = { text: `${from ? `copied from ${from}` : "copied to clipboard"} · ${[...text].length} chars`, until: Date.now() + TOAST_MS, ok: true };
    this.redraw();
    return true;
  }
  /** What the toast says and until when (App.copy); the tick takes it away. */
  toast: { text: string; until: number; ok: boolean } | null = null;
  /** The terminal's default text and background are the theme's (OSC 10, 11), so uncoloured cells sit on its ground. */
  private grounded = false;
  private ground() {
    // Classic sets no ground; its reset only undoes one this door set (a person's own OSC 10/11 colours stay).
    if (!theme().ground && !this.grounded) return;
    this.grounded = !!theme().ground;
    const t = this.term as Partial<Term>;
    if (t.setGround) t.setGround(groundSeq());
    else this.term.write(groundSeq());
  }
  setTheme(name: ThemeName) {
    if (useTheme(name)) {
      this.ground();
      this.term.invalidate();
      writeState("theme.json", { name });
    }
    this.flash(`theme: ${theme().name} · ${theme().about}`);
    this.redraw();
  }
  cycleVideo() {
    const no = this.display.cycleVideo();
    this.flash(no ?? `video: ${this.video}`);
  }

  /** What has the terminal while the door is suspended, or null (see Ctx.suspend). */
  private away: string | null = null;
  suspended(): string | null { return this.away; }
  async suspend(run: (terminal: Handover) => Promise<unknown>, what = "editor"): Promise<void> {
    if (this.away) throw new Error(`the terminal is already handed over (${this.away})`);
    // The display hands over the person's terminal (in a session, the client's with their keys: the others go on
    // showing the session) and paints nothing to it until the program gives it back.
    this.away = what;
    try { await run({ run: (argv, o) => this.display.handOver(argv, o ?? {}) }); }
    finally { this.away = null; this.redraw(); }
  }

  readonly scriptUndos = new Set<string>();

  private scriptEvent(e: OutlineEvent) {
    const screens = [...this.stack, ...this.background];
    if (e.ended) {
      INVITES.spendRun(e.ended.run);
      for (const s of screens) s.scriptEnded?.(e.ended.run, e.ended.sequence ? "done" : e.ended.reason);
      if (e.ended.targetClientId === this.board.clientId) {
        const by = e.ended.requestedBy;
        const actor: Actor = by.author === "agent" ? { kind: "agent", id: by.actorId ?? "agent" } : { kind: "user" };
        const said = scriptPressMessage(e.ended.message, e.ended.undo);
        const say = e.ended.reason === "done" ? { flash: (message: string) => this.showMessage(message, 4000, false) } : this;
        asActor(say, actor).flash(said);
      }
    } else if (e.undone && !this.scriptUndos.delete(e.undone.run)) for (const s of screens) s.scriptUndone?.(e.undone.run);
    this.redraw();
  }

  event(e: OutlineEvent) {
    this.heldAsks.heard(e);
    this.waitingAsks.heard(e);
    // The service's extensions changed (a folder added, removed or edited, PIE-507): read the list again and
    // bind it, so what came shows up and what went goes away without a restart (PIE-512).
    if (e.domain === "extensions") { componentsChanged(this.board); void this.loadExtensions(); return; }
    // A script run ended or was undone (PIE-957): the screens holding its layout transaction close or take it back.
    if (e.domain === "script") { this.scriptEvent(e); return; }
    // Yolo went on or off in the service (PIE-973): this door's chip and the guards it lifts follow.
    if (e.domain === "agents") { this.heardYolo(e.yolo === true); return; }
    // A reconnected service forgot a yolo this door handed over: say it again (a restarted service starts with it off).
    if (e.action === "reconnected" || e.action === "reset") {
      void this.syncYolo();
      // A script run's layout transaction can't hear its end any more: it ends early, and its start is put back (PIE-957).
      for (const s of [...this.stack, ...this.background]) s.scriptsLost?.();
    }
    // A Resource registered or refreshed (PIE-445): only readers showing a projection of it redraw, and
    // those read it again. It isn't an outline change, so nothing else is asked again. An extension's line that
    // ran (`extensions.output`) or an agent that answered (`extensions.agent`) names its note.
    if (e.domain === "resource-catalog") { if (resourceChanged(e.resourceId ?? null, e.resourceId ? undefined : e.blockId)) this.redraw(); return; }
    if (!forScreens(e)) return;
    if (e.change?.kind !== "draft") {
      // Live figures and inline ::links aren't asked again here: their reads are watched, and the service says
      // when an answer changed (src/watched.ts).
      // A change record names its block: only the links, pages and embeds that show it are asked again.
      // A move or trash takes a subtree along, and an event without a record could be anything.
      const c = e.change;
      // A block made under a note changes what is drawn beside it (a proposal, PIE-725): the note is named too.
      if (c) outlineChanged(c.blockId && SCOPED.has(c.kind) ? [c.blockId, ...(c.kind === "create" && c.parentId ? [c.parentId] : [])] : null);
      else if (e.action === "reconnected") outlineChanged([], true);   // the missed changes were replayed first
      else outlineChanged(null, e.action === "reset");
      // Resource events aren't in the change feed, so none were replayed: projections are read again, and the
      // extensions (a restarted service may serve others) are listed again.
      if (!c && (e.action === "reconnected" || e.action === "reset")) { this.reconnects++; resourceChanged(null); void this.loadExtensions(); }
      // A screen note made, changed or trashed (here, by another door or an agent), or anything after a reconnect: read them again.
      if (c ? screenNotesAffected(c) : e.action === "reconnected" || e.action === "reset") this.screensSoon();
      void this.statusNote.refresh(this.statusItems());
      invalidatePropertyErrors();
    }
    // What an extension wrote (a Jira ticket refreshed, PIE-445) isn't news unless the person asks for it.
    const remote = remoteWrite(e);
    if (remote) void this.sayRemoteWrite(remote);
    // The status bar's count is the feed's distinct notes others changed since the person looked (src/desk/what-changed.ts).
    this.whatChanged.heard(e);
    this.stack.at(-1)?.onEvent?.(e, this);
    // The drawer's desk is on every screen: its readers hear the outline change as the screen shown does.
    this.drawer.made?.onEvent(e);
    this.redraw();
  }

  /** A remote MCP client's write, said on the status line with the note's title (whatever the screen shows). */
  private async sayRemoteWrite(w: RemoteWrite): Promise<void> {
    const read = async (id: string) => (await this.board.records([id]).catch(() => null))?.records[0];
    let verb = w.verb, r = w.blockId ? await read(w.blockId) : undefined;
    // A comment or a proposal is a block of its own: said as what it does to the note it's under.
    const type = r?.properties.find(p => p.key === "type")?.values[0];
    if (r?.parent && (type === "annotation" || type === "draft-proposal")) { verb = type === "annotation" ? "commented on" : "proposed a change to"; r = await read(r.parent); }
    // An edit of the note right after a proposal of it (an older proposal's embed line): the proposal is what's said.
    const said = this.remoteSaid, now = this.now();
    if (verb === "changed" && said && said.id === r?.id && said.verb !== "changed" && now - said.at < 3000) return;
    this.remoteSaid = { id: r?.id, verb, at: now };
    this.flash(`${actorLabel(w.actor)} ${verb} ${r?.title ? `“${r.title}”` : "a note"} · a remote MCP write`, 6000);
  }
  private remoteSaid: { id?: string; verb: string; at: number } | null = null;

  describe() {
    const s = this.stack.at(-1);
    const b = this.board;
    const service = { protocol: b.protocol, offline: this.offline, sequence: b.lastSequence };
    // pid and nest: which process this door is and what it runs in (`ep0ch where` checks them against EP0CH_NEST).
    return { screen: s?.title, stack: this.stack.map(x => x.title), pid: process.pid, ...(this.term.session ? { session: this.term.session() } : {}),
      nest: doorNest(process.env) || null, suspended: this.away, video: this.video, host: this.host, workspace: this.workspace,
      ...(this.outline ? { outline: this.outline } : {}), ...(this.machine ? { machine: this.machine } : {}), service, drawer: this.drawer.describe(), ...(this.bar ? { bar: this.bar.describe() } : {}),
      messages: this.messages.rows,
      pointers: this.agentPointers.list(),
      // How the door is keeping up (a475084a): frames drawn against reports handled, the hover reports a busier moment folded into the newest, and the settle: the last input of a burst to the frame that shows it.
      // Per attached terminal (a session's): the frames it hasn't answered (a stalled link holds them) and the answer's round trip (PIE-1163).
      speed: { ...this.speed.describe(), ...(this.term.speed ? { clients: this.term.speed() } : {}) },
      // Where the pointer rests on a cut-short value, and whether that value is being read in full (the pointer is the person's: this only says).
      hover: this.overflow.describe(),
      // Where the person is (PIE-514): the same answer every agent rule reads, so an agent can see why it was refused.
      layout: this.hostLayer.desks().find(d => !this.hostLayer.isDrawer(d))?.layoutAll() ?? this.drawer.made?.layoutAll(),
      person: (({ idle, ...w }) => ({ ...w, idle: Number.isFinite(idle) ? Math.round(idle) : null }))(this.person()),
      ...(this.armedNow ? { armed: { edit: this.armedNow.a.what, ms: this.armedNow.a.ms } } : {}), state: s?.describe?.() ?? null };
  }

  /**
   * The screen's actions, then the shell's (`screen.*`, and `open` where the screen has none of its own), the
   * host layer's (`host.*`, `agent.*`) and the extensions' (`ext.*`, a handler line's or a block's), which work on
   * every screen: one list, in the order the App's dispatcher looks a name up.
   */
  actions() {
    const s = this.stack.at(-1);
    const d = this.dispatch.list();
    return { screen: s?.title ?? null, actions: d.actions, tiles: s?.dispatch?.list().tiles ?? [] };
  }

  /**
   * Read the service's extensions and bind them (src/extensions.ts): handler lines the readers ask about, the
   * `ext.*` actions, the tile kinds. What came or went is said; the readers read their lines again.
   */
  async loadExtensions(reload = false): Promise<void> {
    await this.statusNote.refresh(this.statusItems());
    connectScriptActions(this);
    const r = await loadExtensions(this.board, reload);
    if (!r) return;
    // A read that failed keeps what was bound, and says so; a service without extensions says nothing here
    // (an extension's tile and lines say why where they'd be).
    if ("error" in r) { this.flash(`couldn't read the outline's extensions: ${r.error}`); return; }
    resourceChanged(null);
    for (const binding of scriptBindings()) {
      const problem = this.dispatch.bindingProblem(binding);
      if (problem) r.problems.push(problem);
    }
    const said = [r.added.length ? `${r.added.join(", ")} added` : "", r.removed.length ? `${r.removed.join(", ")} removed` : ""].filter(Boolean);
    if (said.length && this.extensionsSeen) this.flash(`extensions: ${said.join(" · ")}`);
    if (r.problems.length) this.flash(`extensions: ${r.problems.join(" · ")}`, 12_000, { kind: "warning" });
    if (!this.extensionsSeen) await (await import("./runbook")).recoverRuns(this).catch(e => this.flash(`Run recovery: ${e.message}`, undefined, errorDetails(e)));
    this.extensionsSeen = true;
    this.redraw();
  }
  private extensionsSeen = false;

  /**
   * Read the outline's screen notes and register each as a screen (PIE-565, src/desk/screen-notes.ts): what came or
   * went is said once the first read is done, and what's wrong with one (a built-in's name, a name two share) always.
   */
  async loadScreens(): Promise<void> {
    // One read at a time: a change while one is out reads again after it, so the last read is the newest.
    if (this.screensLoading) { this.screensAgain = true; return this.screensLoading; }
    this.screensLoading = this.readScreens();
    try { await this.screensLoading; } finally { this.screensLoading = null; }
    if (this.screensAgain) { this.screensAgain = false; await this.loadScreens(); }
  }
  private screensLoading: Promise<void> | null = null;
  private screensAgain = false;
  private async readScreens(): Promise<void> {
    try {
      const r = await loadScreenNotes(this.board);
      // A save or delete of this door's landed meanwhile: read again rather than take an older answer.
      if (r.stale) { this.screensAgain = true; return; }
      const said = [r.added.length ? `${r.added.join(", ")} added` : "", r.removed.length ? `${r.removed.join(", ")} gone` : ""].filter(Boolean);
      if (said.length && this.screensSeen) this.flash(`screens: ${said.join(" · ")}`);
      // What's wrong is said when it's new, not again on every change to a screen note.
      const wrong = r.problems.join(" · ");
      if (wrong && wrong !== this.screensWrong) this.flash(`screens: ${wrong}`, 12_000, { kind: "warning" });
      this.screensWrong = wrong;
    } catch (e) { this.flash(`couldn't read the outline's screen notes: ${(e as Error).message}`, undefined, errorDetails(e)); }
    this.screensSeen = true;
    this.redraw();
  }
  private screensSeen = false;
  private screensWrong = "";
  private screensTimer: ReturnType<typeof setTimeout> | null = null;
  /** Read the screen notes again shortly: a burst of changes reads them once. */
  private screensSoon() {
    if (this.screensTimer) return;
    this.screensTimer = setTimeout(() => { this.screensTimer = null; void this.loadScreens(); }, 300);
  }

  /**
   * The App's dispatcher (PIE-514): the host layer's actions, the shell's and the extensions', on every screen, then
   * the top screen's own (its dispatcher). A screen's action of a shell action's name is the screen's (the desk's,
   * the board's, the river's `open`). An extension's action a tile kind also lists (tarot's keep) is the tile's when
   * the request names the tile (tile=) or no block; with block= it runs on that block, tile or none.
   */
  readonly agentPointers = new AgentPointers();
  keysScreen(): Screen | undefined { return this.hostLayer.desks()[0]?.focusedDesk() ?? this.stack.at(-1); }
  readonly recording = new MacroRecording();
  recordAction(req: ActRequest, replay: import("./surface/actions").Replay, run: () => unknown) { return this.board.inScriptRun ? run() : this.recording.run(req, replay, run); }

  readonly dispatch: Dispatcher = new Dispatcher({ title: "door", ctx: () => this }, [
    { set: HOST_TILE_ACTIONS, takes: "screen", claims: req => req.action === "tile.herdr" && namesAgent(req.tile), on: () => ({ drawer: this.drawer }) },
    { set: DRAWER_ACTIONS, takes: "none", fixed: () => this.drawer.agentRef(), on: (_, how) => ({ drawer: this.drawer, ctx: how.ctx, here: this.stack.at(-1), again: (name: string, args: Record<string, unknown>, tile?: string) => this.dispatch.act({ action: name, args, ...(tile ? { tile } : {}) }, how.actor) }) },
    { set: NEW_NOTE_ACTIONS, takes: "none", on: (_, how) => ({ ctx: how.ctx, standing: how.standing, here: how.standing ? this.keysScreen() : this.stack.at(-1) }) },
    { set: TEMPLATE_ACTIONS, takes: "none", on: (_, how) => ({ ctx: how.ctx, standing: how.standing, here: this.stack.at(-1) }) },
    { set: MACRO_ACTIONS, takes: "none", on: () => ({ ctx: this, recording: this.recording }) },
    { set: STATUS_BUTTON_ACTIONS, takes: "none", claims: req => (req.action === "button.press" || req.action === "button.slot") && req.args?.note !== undefined && req.tile === undefined,
      on: (_, how) => ({ surface: this.statusButtons, standing: how.standing, host: { ctx: this, redraw: () => this.redraw(), navigate() {} } }) },
    { set: STATUS_BAR_ACTIONS, takes: "none", on: () => ({
      note: this.statusNote, builtins: () => this.statusItems(), items: () => this.describeStatusItems(),
      open: (id: string, actor: Actor) => this.hostLayer.openOnScreen(id, true, actor),
    }) },
    { set: BAR_ACTIONS, takes: "none", on: (_, how) => ({ on: this.barOn, standing: how.standing }) },
    { set: SHELL_ACTIONS, takes: "none", claims: req => SHELL_ACTIONS.has(req.action) && !this.stack.at(-1)?.dispatch?.has(req.action), on: (_, how) => ({ ctx: how.ctx, here: this.stack.at(-1), again: (name: string, args: Record<string, unknown>) => this.dispatch.act({ action: name, args }, how.actor) }) },
    { set: RUNBOOK_ACTIONS, takes: "none", on: (_, how) => ({ ctx: how.ctx }) },
    { set: EXTENSION_INSTALL_ACTIONS, takes: "none", on: (_, how) => ({ ctx: how.ctx }) },
    { set: EXT_ACTIONS, takes: "none", claims: req => EXT_ACTIONS.has(req.action) && !(!!this.stack.at(-1)?.dispatch?.has(req.action) && (req.tile !== undefined || req.args?.block === undefined)), on: (_, how) => ({ ctx: how.ctx }) },
    { claims: req => req.action.startsWith("layout.") || req.action.startsWith("tile."), delegate: () => (this.hostLayer.desks().find(d => !this.hostLayer.isDrawer(d)) ?? this.hostLayer.desks()[0])?.dispatch },
    { delegate: () => this.stack.at(-1)?.dispatch },
    { set: POINTER_ACTIONS, takes: "screen", on: at => ({ dispatcher: this.dispatch, at }) },
  ]);

  /**
   * Where the person is (PIE-514): the top screen's own answer (its `keys`; else whether it holds their keys), the host
   * layer's drawer they may be typing in, the shell or editor the door is suspended under, and how long they've been idle.
   */
  person(): Whereabouts {
    const s = this.stack.at(-1);
    const w0 = whereabouts({ screen: s?.title ?? null, keys: s ? screenKeys(s) : null, inHost: this.drawer.shown && this.drawer.entered, hostAddress: this.drawer.made?.keys().address, hostTile: ((t: string | null) => (t ? `drawer:${t}` : null))(this.drawer.typingTile()), suspended: this.away, loggedOn: !!s && !s.noDrawer, idle: this.idleFor() });
    const w: Whereabouts = this.agentsYolo ? { ...w0, yolo: true } : w0;
    // The power bar holds their keys while it's open.
    // (A hold on navigation alone, the showcase's, doesn't count as busy here: a real hold replaces it.)
    const free = !w.busy || !!w.navHold;
    if (this.bar && free) { const { navHold: _n, ...rest } = w; return { ...rest, busy: true, why: "the person has the power bar open (ctrl+k)" }; }
    // An armed edit holds the next key: the person is mid-gesture.
    const a = this.armedNow?.a;
    if (a && free) { const { navHold: _n, ...rest } = w; return { ...rest, busy: true, why: `the person is about to edit ${a.what} (e pressed; ⏎ opens it)` }; }
    return w;
  }

  /**
   * An agent acts (`ep0ch-door act`), through the App's dispatcher. Never silent: the status bar names the agent and
   * the action before it runs, a refusal says why, and anything it says while it lands is "an agent (<id>) · …".
   */
  async act(req: ActRequest): Promise<unknown> {
    const actor = agentActor(req.as);
    const who = agentLabel(actor);
    return messageContext.run({ action: req.action, ...(req.tile ? { tile: req.tile } : {}) }, async () => {
      try {
        if (!this.dispatch.takes(req, actor)) throw new ActionRefused(GONE_ACTIONS[req.action] ?? scriptInstallWords(req.action) ?? this.dispatch.unknownAction(req.action));
        this.flash(`${who} · ${req.action}${req.tile ? ` in ${req.tile}` : ""}`);
        const r = await this.dispatch.act(req, actor);
        this.redraw();
        return r;
      } catch (e) {
        const refused = e instanceof ActionRefused || e instanceof Offline;
        this.flash(refused ? `${who} · ${req.action} refused: ${e.message}` : `${who} · ${actionFailure(req.action, e)}`, 4000, { kind: refused ? "refusal" : "error", ...(!refused && e instanceof Error ? { stack: e.stack } : {}) });
        throw e;
      }
    });
  }

  /**
   * SIGTERM or SIGHUP: there is no one to ask. Every screen's unsaved edits and comments are copied to
   * disk first, then the door quits.
   */
  terminate(): string[] {
    const kept: string[] = [];
    for (const s of this.holders()) { try { kept.push(...(s.keepDrafts?.() ?? [])); } catch { /* keep going: the rest still get copied */ } }
    this.keptOnExit = kept;
    this.quit();
    return this.keptOnExit;
  }
  /** Every screen saves the places a restart brings back (PIE-643): readers' history and scroll. */
  keepPlaces() { for (const s of this.holders()) { try { s.keepPlace?.(); } catch { /* the rest still save */ } } }
  /** Where `terminate` (and any quit, for ctrl+e editors) copied unsaved text, for the exit message. */
  keptOnExit: string[] = [];

  quit() {
    // Whatever way the door ends, a ctrl+e editor's text is copied out and said (its tile ends with the door).
    for (const s of this.holders()) { try { this.keptOnExit.push(...(s.keepEdits?.() ?? [])); } catch { /* the rest still get copied */ } }
    this.keepPlaces();
    this.closed = true;
    this.offResize();
    if (this.timer) clearInterval(this.timer);
    if (this.paintTimer) clearTimeout(this.paintTimer);
    if (this.publishTimer) clearTimeout(this.publishTimer);
    this.offStatus();
    if (this.reportTimer) clearTimeout(this.reportTimer);
    // What the door reported to its terminal goes with it (OSC 7501 clear).
    this.display.programStatus?.(null);
    this.disarm();
    this.waitingAsks.stop();
    // The extensions it bound (their actions, tile kinds, passage choices) go with the door that read them.
    unbindExtensions(this.board);
    outlineBoards(this).close();
    this.display.dispose();
    this.done();
  }

  /**
   * Hover reports (the pointer moving with no button, ?1003h: one for every cell it crosses) are handled at most once a
   * frame, and the one handled is the newest (PIE-1300): the pointer is where the last report put it, so the cells it
   * crossed on the way aren't drawn. The newest is held until the batch being read ends, or, when one was handled less
   * than a frame ago, until the frame is up: across reads, whatever size the link delivers them in. The one owner of
   * that is here, beside `redraw`'s own once-a-frame rule. A click, a key, a press, a release or a drag with a button
   * held is never held or dropped: it flushes the held hover first, so it is handled after it, at once.
   */
  private hovering: Key | null = null;
  private hoverTimer: Timer | null = null;
  private hoverAt = 0;
  /** What the door counts about its own speed, always on and free (a475084a, src/speed.ts): read by `peek`. */
  readonly speed: SpeedMeter;
  private flushHover() {
    if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    const held = this.hovering;
    this.hovering = null;
    if (!held || this.closed) return;
    this.hoverAt = Date.now();
    this.pressKey(held);
  }
  /** The held hover is handled now when a frame has passed since the last one, else when it has. */
  private settleHover() {
    if (!this.hovering) return;
    const wait = FRAME_MS - (Date.now() - this.hoverAt);
    if (wait <= 0) this.flushHover();
    else if (!this.hoverTimer) this.hoverTimer = setTimeout(() => { this.hoverTimer = null; this.batched(() => this.flushHover()); }, wait);
  }
  private key(typed: Key) {
    this.speed.input();
    this.keying++;
    try {
      if (isHover(typed)) {
        if (this.hovering) this.speed.motionCoalesced++;
        this.hovering = typed;
        if (!this.batching) this.settleHover();
        return;
      }
      this.flushHover();
      this.pressKey(typed);
    } finally { this.keying--; }
  }
  /** An input report is being handled: a redraw asked meanwhile is the frame that shows it (SpeedMeter's settle). */
  private keying = 0;
  private pressKey(typed: Key) {
    if (!isHover(typed)) this.lastInput = Date.now();
    if (!(typed.kind === "mouse" && (typed.action === "wheel-up" || typed.action === "wheel-down"))) this.changed = true;
    // An Option character standing for an alt key is that key everywhere after this, the drawer's alt+a too.
    const k = this.optionAsAlt(typed);
    this.pressed(k);
    try { this.route(k); }
    finally {
      // A chord waiting for its next key, a menu or picker open: the next press continues this gesture (refuse).
      if (pressOf(k) !== null) this.heldAfter = !!this.stack.at(-1)?.holdsKeys?.();
      // Said once, after the key did its work, so the hint isn't covered by what the key said.
      if (k !== typed && !this.saidOptionKeys) {
        this.saidOptionKeys = true;
        this.flash(`${(typed as { ch: string }).ch} read as alt+${(k as { ch: string }).ch}: this terminal types Option as characters; ${OPTION_AS_ALT_HINT}`, 10_000);
      }
    }
  }

  /** Where a key goes: the status bar's chips, the host layer's drawer, then the top screen. */
  private xrayLeader = false;
  private route(k: Key) {
    if (k.kind === "alt" && k.ch === "?") { void this.dispatch.press("text.reveal"); return; }
    if (k.kind === "mouse" && isHover(k)) void this.dispatch.press("text.hover", { x: k.x, y: k.y });
    else if (k.kind === "mouse") this.overflow.clear();
    else this.overflow.keys();
    if (k.kind === "modifier") {
      if (!this.bar && this.dispatch.has("xray")) void this.dispatch.press("xray", k.event === "tap" ? {} : { on: k.event === "press" });
      return;
    }
    const leader = this.xrayLeader;
    if (k.kind !== "mouse") this.xrayLeader = !this.bar && k.kind === "char" && !!k.ctrl && k.ch === "]";
    if (!this.bar && leader && k.kind === "char" && !k.ctrl && k.ch === "?" && this.dispatch.has("xray")) { void this.dispatch.press("xray"); return; }

    // keys.probe (PIE-699): describe the key, run nothing. A click still works (the status bar's chip, a tile), and esc ends it.
    if (this.probing && k.kind !== "mouse") {
      if (k.kind === "esc") this.probeKeys(false);
      else if (k.kind === "paste") { this.flash(`✦ probe · a paste of ${[...k.text].length} characters (bracketed paste) · esc ends the probe`, 60_000); this.redraw(); }
      else { this.flash(describeKey(k, (this.term as { lastSeq?: string }).lastSeq ?? ""), 60_000); this.redraw(); }
      return;
    }
    // An armed edit (e in a reader, src/arm.ts) takes the next key first: ⏎ or the arming key again opens it; any
    // other key (a click too) lets it go, then does what it does, wherever it goes.
    const armed = this.armedNow?.a;
    if (armed && disarms(k)) {
      this.disarm();
      this.redraw();
      if (confirms(armed, k)) { armed.run(k); return; }
    }
    // The power bar (PIE-656), while it's open, takes every key and click: esc or a click outside puts it away.
    if (this.bar) {
      if (!this.bar.ended()) this.bar.key(k, this);
      if (this.bar?.ended()) { this.bar.close(); this.bar = null; this.redraw(); }
      return;
    }
    if (k.kind === "mouse" && k.y === this.term.info.rows - 1 && k.action === "down") {
      // The bar is chrome over the screen, not "elsewhere" (PIE-1189): work that moves to it must not land under a lift, so
      // a lift the click's action left as it found it drops. One an action itself lifted, dropped or moved (agent.lift,
      // tile.zoom: a bar button that toggles the lift) is that action's; dropping it first made the second click lift again.
      const lifts = this.drawer.desks().flatMap(d => d.liftedDesk ? [{ desk: d.liftedDesk, was: d.liftedDesk.lifted }] : []);
      const dropUntouched = () => { for (const l of lifts) if (l.desk.lifted === l.was) l.desk.dropLift(); };
      const hit = this.statusBoxes.find(h => k.x >= h.from && k.x < h.to);
      const alt = k.button === 2 || ((k.mods ?? 0) & 8) !== 0;
      const req = hit ? (alt ? hit.item.alt ?? hit.item.click : k.x === hit.to - 1 && hit.item.lastCell ? hit.item.lastCell : hit.item.click) : { action: alt ? "status.bar.edit" : "status.log" };
      if (req) void this.dispatch.press(req.action, req.args, req.tile).finally(dropUntouched);
      else dropUntouched();
      return;
    }
    // The hyper layer (PIE-699): ⌃⌥⇧⌘ and a key, before any tile's own keys (a draft's and a terminal tile's too). Each chord
    // presses an action that has other keys and a click (src/hyper.ts); the layer is off unless turned on.
    if (k.kind === "hyper") { this.hyper(k.ch); return; }
    const lifted = this.drawer.desks().map(d => d.liftedDesk).find(Boolean);
    if (lifted?.liftInput(k, () => {
      if (this.drawer.made?.liftedDesk === lifted) this.drawerRun("host.enter", {});
      else {
        this.stack.at(-1)?.enterTiles?.();
        if (this.drawer.entered) this.drawerRun("host.leave", { quiet: true });
      }
    })) return;
    // Your drawer's ^W panel, over the screen (PIE-1338): a click on it is its.
    if (this.drawer.shown && this.drawer.desk?.keyPanelInput(k)) return;
    // The drawer first (PIE-498): its keys while the person is in it, alt+a anywhere, its chip and its rows.
    if (this.drawer.key(k, this.stack.at(-1), this.term.info.rows, this.drawerRun)) return;
    if (k.kind === "mouse" && k.y === this.term.info.rows - 1) {
      if (k.action === "down") void this.dispatch.press("status.log");
      return;
    }
    if (k.kind === "alt" && k.ch === "Q" && !this.stack.at(-1)?.rawKeys?.() && (this.recording.active || !this.stack.at(-1)?.holdsKeys?.())) {
      void this.dispatch.press(this.recording.active ? "macro.stop" : "macro.record"); return;
    }
    // alt+v and alt+t turn the video mode and the theme on every screen (but in a terminal tile, whose keys are its program's).
    if (k.kind === "alt" && (k.ch === "v" || k.ch === "t") && !this.stack.at(-1)?.rawKeys?.()) { void this.dispatch.press(k.ch === "v" ? "video.cycle" : "theme.cycle"); return; }
    // alt+y: the tune inspector on the focused tile (tile.tune, PIE-673), on the desk's screens, never in a terminal tile.
    if (k.kind === "alt" && k.ch === "y" && !this.stack.at(-1)?.rawKeys?.() && !this.stack.at(-1)?.holdsKeys?.()) { void this.dispatch.press("tile.tune"); return; }
    if (k.kind === "alt" && k.ch === "M" && !this.stack.at(-1)?.rawKeys?.()) { void this.dispatch.press("status.log"); return; }
    // alt+w: what waits on you, the list in your drawer (host.waiting), on every screen but in a terminal tile (its program's).
    if (k.kind === "alt" && k.ch === "w" && !this.stack.at(-1)?.rawKeys?.() && !this.stack.at(-1)?.noDrawer) { void this.dispatch.press("host.waiting"); return; }
    // alt+o: what changed since you looked, the list in your drawer (changes.open), on the same screens.
    if (k.kind === "alt" && k.ch === "o" && !this.stack.at(-1)?.rawKeys?.() && !this.stack.at(-1)?.noDrawer) { void this.dispatch.press("changes.open"); return; }
    // The power bar's keys (isBarKey): on every screen, never while typing or in a terminal tile; the drawer asks the same of its tab.
    const kTop = this.stack.at(-1);
    if (isBarKey(k) && !kTop?.rawKeys?.() && !kTop?.holdsKeys?.() && !kTop?.noDrawer) { void this.dispatch.press("bar.open"); return; }
    // ctrl+n: a new note (PIE-544), on every screen, in an edit too (PIE-591), but never in a filter, a picker or a terminal tile.
    const nTop = this.stack.at(-1);
    if (k.kind === "char" && k.ctrl && k.ch === "n" && !nTop?.rawKeys?.() && (!nTop?.holdsKeys?.() || nTop.newNoteWhileTyping?.()) && !nTop?.noDrawer) { void this.dispatch.press("note.new"); return; }
    // A paste goes whole to a screen that takes it (a terminal tile); anywhere else it's typed, key by key.
    if (k.kind === "paste" && !this.stack.at(-1)?.rawKeys?.()) {
      // A paste of nothing at all (the clipboard held only a picture, PIE-592) is ctrl+v, which a draft takes as draft.image.
      if (k.text === "") { this.key({ kind: "char", ch: "v", ctrl: true }); return; }
      for (const key of pasteKeys(k.text)) this.key(key);
      return;
    }
    // ctrl+c: in a session the person's terminal detaches (nothing ends, nothing is asked); else the door quits, asking first.
    if (k.kind === "char" && k.ctrl && k.ch === "c" && !this.stack.at(-1)?.rawKeys?.()) {
      if (this.detaches) this.logoff();
      else if (this.leaving([...this.stack, ...this.background], true)) this.quit();
      return;
    }
    // cmd+c (super+c) is the copy wherever a reader or a draft has a selection (its copy action runs); where
    // nothing took it (no reader has the keys, or nothing ran and nothing was said), it says so. In a terminal
    // tile it's the program's, as it came (rawKeys).
    const top = this.stack.at(-1);
    if (isCopyKey(k) && top && !top.rawKeys?.()) {
      let ran = false;
      const said = this.flashes, stop = traceActions(() => { ran = true; });
      try { top.key(k, this); } finally { stop(); }
      if (!ran && this.flashes === said) this.refuse("nothing selected · drag across the text to copy it, or v and move then y");
      return;
    }
    if (!top?.holdsKeys?.() && !top?.rawKeys?.() && !(k.kind === "char" && k.pasted)) {
      const binding = scriptBindings().find(b => b.key === keyName(k));
      if (binding) {
        const problem = this.dispatch.bindingProblem(binding);
        if (problem) this.flash(problem);
        else { void this.dispatch.pressBinding(binding); return; }
      }
    }
    top?.key(k, this);
  }

  private probing = false;
  probeKeys(on = !this.probing): boolean {
    this.probing = on;
    this.flash(on ? `key probe · press a chord (hyper is ⌃⌥⇧⌘ and a key): it is described, not run · esc ends it · layer ${hyperOn() ? "on" : "off"}` : "key probe ended", on ? 60_000 : undefined);
    this.redraw();
    return on;
  }

  /** A hyper chord: its binding's action as the person, after leaving an edit when it moves the keys. */
  private hyper(key: string) {
    const b = hyperBinding(key), top = this.stack.at(-1);
    if (top?.noDrawer) return;
    if (!b) return void this.refuse(`${hyperLabel(key)} isn't bound · ${HYPER_KEYS.map(x => hyperLabel(x.key)).join(" ")}`);
    if (b.leaves && top?.leaveTyping && !top.leaveTyping()) return;
    // A chord for "this tile" addresses it by its id, as an act string would: pointing and naming are one path (PIE-1286). A screen
    // that can't name its focus here (the showcase's stage) leaves the action to find it, and the action refuses when there is none.
    const at = b.tile ?? (b.onFocus ? top?.dispatch?.tile("focused")?.id : undefined);
    this.dispatch.press(b.action, b.args ?? {}, at).catch(e => this.refuse(e instanceof Error ? e.message : String(e)));
  }

  /**
   * A Mac terminal that types Option as characters sends ¬ for alt+l. Where nobody is typing text (no edit,
   * filter, panel, terminal tile or the drawer holds the keys), such a character is the alt key it
   * stands for, and the first one says once which terminal setting sends alt itself. In text it stays what
   * was typed (façade, µm). Only on a US-like keyboard (optionKeysOn: by the locale, or EP0CH_OPTION_KEYS).
   */
  private optionAsAlt(k: Key): Key {
    if (!this.optionKeys || k.kind !== "char" || k.ctrl || k.pasted) return k;
    const alt = OPTION_KEYS[k.ch];
    if (!alt || this.person().busy) return k;
    return { kind: "alt", ch: alt };
  }
  private saidOptionKeys = false;
  /** Option characters are read as alt keys here (a test sets it). */
  optionKeys = optionKeysOn();

  private linkLabel = "";
  private linkChecked = 0;
  private tick() {
    // A change to what the door tells its terminal has held long enough (DoorReporter): say it.
    if (this.reports.due()) this.reportStatus();
    if (Date.now() - this.linkChecked >= 1000) {
      this.linkChecked = Date.now();
      this.linkLabel = linkUpdateLabel(outlinesDir());
    }
    const s = this.stack.at(-1);
    let expired = !!this.message && Date.now() > this.messageUntil;
    if (expired) this.message = "";
    if (this.toast && Date.now() > this.toast.until) { this.toast = null; expired = true; }
    const drawerChanged = this.drawer.made?.tick() ?? false;
    if (s?.tick?.(this) || drawerChanged || expired || this.overflow.tick(Date.now())) this.redraw();
    // An idle door still keeps time: once the clock or the uptime turns over, the status bar alone is
    // repainted (no screen render, no Kitty sync), so nothing being edited, selected or dragged moves.
    else if (s && this.timeShown() !== this.shownTime) this.paintStatus(s);
  }

  /** The status bar's time, as it would read now: the uptime and the clock; and the drawer's chip, which changes on its own. */
  private timeShown(): string {
    const now = this.now();
    return `${Math.floor((now - this.started) / 60000)}|${new Date(now).toTimeString().slice(0, 5)}|${this.drawer.active ? this.drawer.chipText() : ""}|${this.backupAlert()?.text ?? ""}|${this.speed.slow() ?? ""}|${waitingText({ ...waitingCounts(waitingOnYou(this.drawer)), held: this.heldAsks.count(), asks: this.waitingAsks.count() }).plain}|${this.whatChanged.count()}|${this.linkLabel}`;
  }

  /** The drawer's chip may have changed (its agent started or stopped working): the status bar alone, when it did. */
  private statusChanged() {
    const s = this.stack.at(-1);
    if (s && !this.paintTimer && this.timeShown() !== this.shownTime) this.paintStatus(s);
  }

  /** Just the status row, where the terminal can repaint a row alone; else the whole frame. */
  private paintStatus(s: Screen) {
    if (this.closed) return;
    const { cols, rows } = this.term.info;
    const status = this.overflow.updateRow(this.statusBar(s, cols), rows - 1);
    if (status.reading || !this.display.showRow(rows - 1, status.line)) this.redraw();
  }

  /**
   * A repaint: at most one a frame. The first comes at once; calls within the frame after it are one more
   * paint at its end, so a busy terminal tile (or several) never renders the screen more than 60 times a
   * second. The frame is 16ms from the end of the last paint, not its start: a screen that takes longer
   * than that to render (a long note) still leaves the door time to read what came in meanwhile.
   *
   * While a chunk of input is being read (`batched`), a redraw is only noted, and the chunk ends with one
   * paint, at once: a trackpad sends wheel reports by the hundred, and a paint for each (then one for each
   * report that arrived during that paint) kept the screen scrolling for seconds after the fingers stopped.
   * What comes in during a paint is read as one chunk after it, so input paints as fast as the screen
   * renders and no faster.
   */
  redraw() {
    this.redraws++; notePressRedraw();
    if (this.closed) return;               // the door has ended (a key in this chunk quit): nothing more is painted
    if (this.keying || this.batching) this.speed.asked();
    if (this.batching) { this.wanted = true; return; }
    this.changed = true;
    if (this.paintTimer) return;
    const since = Date.now() - this.lastPaint;
    if (since >= FRAME_MS) return this.paint();
    this.paintTimer = setTimeout(() => { this.paintTimer = null; this.paint(); }, FRAME_MS - since);
  }
  /** Repaints asked for, painted or folded into another (the parity pass counts them). */
  private redraws = 0;
  redrawsAsked(): number { return this.redraws; }
  private lastPaint = 0;
  private paintTimer: Timer | null = null;
  private batching = 0;
  private closed = false;
  private wanted = false;
  /** Something other than the wheel happened since the last paint (a key, a click, a redraw asked from outside input). */
  private changed = true;

  /** Read a chunk of input (Term's onBatch): every key in it is handled, then the screen is painted once. */
  private batched(run: () => void) {
    this.batching++;
    try { run(); }
    finally {
      try { if (this.batching === 1) this.settleHover(); }      // the held hover, even when the batch threw
      finally {
        if (--this.batching === 0 && this.wanted && !this.closed) {
          this.wanted = false;
          if (this.paintTimer) { clearTimeout(this.paintTimer); this.paintTimer = null; }
          this.paint();
        }
      }
    }
  }

  private paint(force = false) {
    // Ended (quit, or retired by the test run): every way to a paint (a tick, a media or figure change, the board's
    // events, the drawer) stops here.
    if (this.closed) return;
    // Nobody sees it (a session with no terminal attached and no live feed): rendered when someone looks (catchUp).
    if (!force && !this.viewers.size && this.display.unseen?.()) { this.skipped = true; this.lastPaint = Date.now(); return; }
    this.skipped = false;
    // A frame after nothing but wheel reports: views may move what they laid out last time (onlyScrolled).
    paintingScroll(!this.changed);
    this.changed = false;
    try { this.drawFrame(); } finally { paintingScroll(false); this.lastPaint = Date.now(); }
  }

  private drawFrame() {
    const s = this.stack.at(-1);
    if (!s) return;
    const { cols, rows } = this.term.info;
    // The drawer (the host layer's, PIE-513) is laid over the screen's bottom rows: over one, the screen drew at
    // its full size under it; beside one, the screen drew in the rows above it (App.t).
    this.drawer.active = !s.noDrawer;
    // What this frame draws stays in the media module's memory while it's on screen (nextFrame).
    nextFrame();
    const frame = withRowLimit(lookFor(this, { screen: s.title }, cols).values["rows.lines"], () => s.render(this));
    let lines = frame.lines.slice(0, rows - 1);
    while (lines.length < rows - 1) lines.push("");
    let placements = this.graphics ? [...(frame.placements ?? [])] : [];
    if (this.drawer.shown) {
      const d = this.drawer.render(cols, rows, s.title);
      lines = overlay(lines, d);
      // Images under the drawer would show through it; the drawer's tiles' own are drawn in it.
      // One running down under it is cut short at its edge (a spine's long title, PIE-794), not dropped whole.
      placements = [...uncover(placements, { col: 0, row: d.rect.row, cols, rows: rows - d.rect.row }), ...(this.graphics ? d.placements : [])];
      // Your drawer's ^W panel (PIE-1338), over the whole screen: the drawer's rows are too few for it.
      const keysDesk = this.drawer.desk;
      if (keysDesk?.keyPanelOpen()) {
        const canvas = new Canvas(cols, rows - 1);
        lines.forEach((line, row) => canvas.text(0, row, line, cols));
        const at = keysDesk.paintKeyPanel(canvas, cols, rows - 1);
        if (at) { lines = canvas.lines(); placements = uncover(placements, at); }
      }
    } else { this.drawer.rect = null; this.drawer.made?.shownAs(false); }
    const lifted = this.drawer.desks().map(d => d.liftedDesk).find(Boolean);
    if (lifted) {
      const canvas = new Canvas(cols, rows - 1);
      lines.forEach((line, row) => canvas.text(0, row, line, cols));
      const lift = lifted.paintLift(canvas, { col: 0, row: 0, cols, rows: rows - 1 });
      lines = lift.lines;
      placements = [...uncover(placements, lift.covered), ...(lift.placements ?? [])];
    }
    // The power bar over the screen and the drawer; images under it would show through it.
    if (this.bar) {
      const b = this.bar.draw(cols, rows - 1), r = b.rect;
      lines = overBar(lines, b, lookFor(this, { screen: s.title }, cols).values);
      placements = uncover(placements, r);
    }
    if (this.toast) lines = withToast(lines, this.toast.text, cols, this.toast.ok);
    lines.push(this.statusBar(s, cols));
    // The display draws it in its video mode (CP437 and the tube under kitty+crt; a terminal tile's program output too).
    const readable = this.overflow.draw(lines, cols, Date.now());
    if (readable.overlay) placements = uncover(placements, readable.overlay);
    this.display.show(readable.lines, placements);
    this.speed.frame();
    this.schedulePublish();
  }

  /** Where the door is: `host · outline` on an outline host, else `host:workspace root`. */
  get location(): string { return this.outline ? `${this.host} · ${this.outline}` : `${this.host}:${this.workspace}`; }

  /** The built-ins declare their text and the existing ActionDefs their gestures press. */
  private statusItems(s = this.stack.at(-1)): StatusItem[] {
    const [mins, clock] = this.timeShown().split("|");
    const right = (id: string, text: string, action?: string, args?: Record<string, unknown>): StatusItem => ({ id, text, place: "right", after: ` ${fg(C.lcyan)}│ `, ...(action ? { click: { action, args } } : {}) });
    const held = this.whatChanged.machineryCount();
    const ext = held ? `+${held} machine` : this.machineryChanges && this.whatChanged.hasMachinery() ? "machine on" : "";
    const backup = this.backupAlert();
    const slow = this.speed.slow();
    const count = this.whatChanged.count();
    const waiting = waitingText({ ...waitingCounts(waitingOnYou(this.drawer)), held: this.heldAsks.count(), asks: this.waitingAsks.count() });
    const items: StatusItem[] = [
      { id: "brand", text: `${fg(C.white)}ep0ch`, place: "left", before: " ", after: " ", click: { action: "status.log" } },
      { id: "power", text: `${fg(C.yellow)}^K`, place: "left", after: " ", ...(!s?.noDrawer ? { click: { action: "bar.open" } } : {}) },
      { id: "macro", text: `${fg(this.recording.active ? C.lred : C.yellow)}${this.recording.active ? "REC stop" : "⇧⌥Q"}`, place: "left", after: `${fg(C.lcyan)} │ `, ...(!s?.noDrawer ? { click: { action: this.recording.active ? "macro.stop" : "macro.record" } } : {}) },
      { id: "screen", text: s?.title ?? "", place: "left", after: " │ ", click: { action: "status.log" } },
      { id: "machine", text: this.location, place: "left", click: { action: "status.log" } },
      right("dance", s?.dancing?.() ? `${fg(C.yellow)}${BOLD}■ stop the dance${UNBOLD}` : "", "layout.stop"),
      right("yolo", this.agentsYolo ? `${fg(C.lred)}${BOLD}YOLO${UNBOLD}` : "", "agents.yolo", { on: false }),
      { ...right("drawer", this.drawer.active ? this.drawer.chip() : "", "host.toggle"), alt: { action: "host.agent" }, ...(this.drawer.offersRestart ? { lastCell: { action: "agent.restart" } } : {}) },
      right("waiting", waiting.styled, "host.waiting"),
      right("offline", this.offline ? `${fg(C.lred)}offline` : "", "status.log"),
      right("slow", slow ? `${fg(C.yellow)}${slow}` : "", "status.speed"),
      right("backup", backup ? `${fg(backup.status ? C.dark : C.lred)}${backup.text}` : "", "backups.alert"),
      right("new", count ? `${fg(C.yellow)}+${count} new` : "", "changes.open"),
      right("machinery", ext ? `${fg(C.dark)}${ext}` : "", "changes.machinery"),
      right("video", this.video, "video.cycle"),
      right("theme", theme().name, "theme.cycle"),
      right("uptime", `on ${mins}m`, "status.log"),
      { ...right("clock", clock ?? "", "status.log"), after: " " },
    ];
    return items;
  }

  private describeStatusItems() {
    const actions = this.dispatch.list().actions;
    return { note: this.statusNote.note?.id ?? null, builtins: this.statusItems().map(i => i.id), items: [...this.statusNote.items(this.statusItems()), ...this.statusBoxes.filter(h => h.item.id === "overflow").map(h => h.item)].map(item => {
      const hit = this.statusBoxes.find(h => h.item.id === item.id);
      const describe = (req: ActRequest | undefined) => req ? { ...req, definition: actions.find(a => a.name === req.action) } : undefined;
      return { ...item, click: describe(item.click), alt: describe(item.alt), lastCell: describe(item.lastCell), ...(hit ? { from: hit.from, to: hit.to } : {}) };
    }) };
  }

  private statusBar(s: Screen, cols: number): string {
    this.shownTime = this.timeShown();
    const items = this.statusNote.items(this.statusItems(s)).filter(i => width(i.text));
    let hidden = 0;
    const overflow = (): StatusItem => ({ id: "overflow", text: `+${hidden}`, place: "left", after: " │ ", click: { action: "status.bar.edit" } });
    // Keep the clock and drawer whole; later note lines yield their space first.
    while (width(statusText(items)) + (hidden ? width(statusText([overflow()])) : 0) + 3 > cols) {
      let last = items.length - 1;
      while (last >= 0 && (items[last]!.id === "clock" || items[last]!.id === "drawer")) last--;
      if (last < 0) break;
      items.splice(last, 1);
      hidden++;
    }
    if (hidden) items.push(overflow());
    const leftItems = separated(items.filter(i => i.place === "left"), "left"), rightItems = separated(items.filter(i => i.place === "right"), "right");
    const left = statusText(leftItems), right = statusText(rightItems);
    // A loud refusal (the same key refused again) is bold here too; the focused tile's frame says it in its place.
    const loud = this.refusedNow?.loud && this.refusedNow.text === this.message;
    const message = this.message || this.linkLabel;
    const middle = message ? ` ${fg(this.messageWarning ? C.yellow : C.lcyan)}${loud ? BOLD : ""}${message}${loud ? UNBOLD : ""}${fg(C.lcyan)}` : "";
    const room = Math.max(0, cols - width(right) - 3);
    const displaced = !!middle && width(left + middle) > room;
    this.statusBoxes = [
      ...(!displaced ? statusHits(leftItems, 0, room - (width(left) > room ? 1 : 0)) : []),
      ...statusHits(rightItems, Math.max(3, cols - width(right)), cols),
    ];
    return statusLine(left, middle, right, cols);
  }
}

/**
 * The status bar's waiting-on-you count (OSC 7501): `◆1 ✗1 ✓2 on you`, blocked, failed and done in their colours;
 * `plain` is "" when nothing waits.
 */
export function waitingText(n: { blocked: number; error: number; done: number; held?: number; asks?: number }): { plain: string; styled: string } {
  // `‼`: requests an agent or an extension wrote that wait for the person's r (held asks, PIE-888).
  const parts = ([["◆", n.blocked, C.lmagenta], ["✗", n.error, C.lred], ["✓", n.done, C.lgreen], ["‼", n.held ?? 0, C.yellow], ["?", n.asks ?? 0, C.yellow]] as const).filter(p => p[1] > 0);
  if (!parts.length) return { plain: "", styled: "" };
  return { plain: `${parts.map(p => `${p[0]}${p[1]}`).join(" ")} on you`, styled: `${parts.map(p => `${fg(p[2])}${p[0]}${p[1]}`).join(" ")}${fg(C.lcyan)} on you` };
}

/** How long the "copied to clipboard" toast stays. */
export const TOAST_MS = 1500;

/**
 * The toast laid over the screen's lines (the status bar not among them): one row, bottom centre, two rows above
 * the status bar, over whatever is drawn there; the rest of that row stays as it was.
 */
export function withToast(lines: string[], text: string, cols: number, ok = true): string[] {
  const t = ` ${ok ? "✓" : "✗"} ${text} `, w = Math.min(width(t), cols);
  const row = Math.max(0, lines.length - 2), at = Math.max(0, Math.floor((cols - w) / 2));
  const out = [...lines];
  const line = out[row] ?? "";
  out[row] = headOf(line, at) + RESET + chip(ok ? C.cyan : C.red) + pad(t, w) + RESET + tailFrom(line, at + w);
  return out;
}

/**
 * The status bar's three parts in `cols` cells: the right part (video, uptime, clock) always shows whole,
 * with a `│` between it and the rest, even when the rest fills its room exactly or is cut short. A
 * message outranks the location: in a narrow pane it replaces it rather than being cut off.
 */
export function statusLine(left: string, middle: string, right: string, cols: number): string {
  const sep = " │ ";
  const room = Math.max(0, cols - width(right) - sep.length);
  const body = pad(middle && width(left + middle) > room ? middle : left + middle, room);
  // A cut can drop the message's link terminator; RESET restores colours but cannot end a hyperlink.
  const endLink = OSC8.test(body) ? OSC8_CLOSE : "";
  return bg(C.blue) + fg(C.lcyan) + body + endLink + bg(C.blue) + fg(C.lcyan) + sep + right + RESET;
}

/**
 * Which service events the screens see: content changes, and change records in other domains (a
 * lane's reorder arrives with `domain: "view"`). Other view events (clients registering) aren't news.
 */
/** A change an extension wrote (`actorId` `ext:…`, a refreshed Jira ticket): not the person's news by default. */
export function isExtensionChange(e: OutlineEvent): boolean {
  return !!e.change?.actor?.actorId?.startsWith("ext:");
}



/** A write by a remote MCP client (PIE-615): an agent whose actor is `mcp:<client>`, live (not replayed). */
export interface RemoteWrite { actor: string; verb: string; blockId?: string }
const REMOTE_VERBS: Partial<Record<NonNullable<OutlineEvent["change"]>["kind"], string>> = { create: "added", edit: "changed", annotate: "commented on", move: "moved", delete: "trashed", restore: "restored" };
export function remoteWrite(e: OutlineEvent): RemoteWrite | null {
  const c = e.change;
  if (!c || e.catchUp || c.actor?.author !== "agent" || !c.actor.actorId?.startsWith("mcp:") || c.kind === "draft") return null;
  return { actor: c.actor.actorId, verb: REMOTE_VERBS[c.kind] ?? "changed", ...(c.blockId ? { blockId: c.blockId } : {}) };
}

export function forScreens(e: OutlineEvent): boolean {
  return e.domain === "content" || !!e.change;
}

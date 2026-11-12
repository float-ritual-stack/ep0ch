// An action's row: the description half of an action, as data. The door's `ActionDef` (packages/door/src/surface/actions.ts)
// extends it with what runs (`run`, the actor rules' hooks, how it replays and records); every client that lists, binds
// or draws an action reads this half and nothing else: the power bar's rows, the keys window, a menu, an action's page,
// and native's dispatcher, whose `ActionRow` is this shape (packages/native/docs/DESIGN.md §1). So a label, a keycap or
// an argument's meaning is written once, on the action.
//
// `ActionDescription` is the fields an action declares about itself; `ActionRow` is one as data, under its id
// (`actionRow`): what `fixtures/action-rows.json` holds for every action the door has. The key names here (`isKeyName`)
// are the one spelling a row's `keys`, a screen's key map and a keymap file share.
export type ArgType = "string" | "number" | "boolean";
/**
 * What kind of thing in the system an argument's value names (PIE-1031), so the power bar's form offers the values
 * there are (src/bar/arg-kinds.ts answers each from the system: the layout, the service), and `actions` says it:
 * - `tile`: a tile on the screen shown (`to=`); the dispatcher reads it with `tile=`'s one grammar, so the action is
 *   given that tile's name.
 * - `note`: a note, by the service's search (an id, a `((ref))`, a Work ID). `page`: a page's name (`[[name]]`).
 * - `screen`: a screen by name (screen.list). `view`: a saved view (a virtual branch's block id).
 * - `key`: a property's key; `value`: a value of the key the argument `of` names (the outline's property index).
 * - `tile-kind`: a kind of tile (the tile-kind registry). `agent`: a persona of the agents here (src/bar/ask-agent.ts).
 * A boolean needs none (true or false), nor does a value from a fixed list (`choices`).
 */
export type ArgKind = "outline" | "tile" | "note" | "page" | "screen" | "view" | "key" | "value" | "tile-kind" | "file" | "layout" | "agent" | "script";
/**
 * One argument: its type, whether it may be left out, and what it means; `kind`: the kind of thing it names (ArgKind);
 * `choices`: the values it takes, when they are a fixed list (`where=left|right|…`), offered first (with a kind, the
 * kind's values follow them: `inbox`, `root`, then any note).
 */
export interface ArgSpec {
  type: ArgType; optional?: boolean; about: string;
  kind?: ArgKind;
  /** `kind: "tile"`: the tile a program runs in (`open from=`), which a program names by what it was told (EP0CH_TILE, EP0CH_TILE_ID), not only by `tile=`'s grammar. */
  program?: true;
  choices?: readonly string[];
  /** At least one combination must hold; null means the argument is present. */
  implies?: readonly Readonly<Record<string, string | number | boolean | null>>[];
  /** These arguments cannot accompany this one, even when false. */
  conflicts?: readonly string[];
  /** `kind: "value"`: the argument naming the property whose values it takes. */
  of?: string;
  /** What a left-out optional one means, when it means one thing (`focused`, `1`): its page's default column. */
  default?: string;
  /**
   * The host binds it (the block in front, a passage, the button that pressed it): an agent's `act` names it, and a
   * person is never asked it, so no form or completion offers it (PIE-1076).
   */
  context?: true;
  /**
   * The door's own word on a request (an extension action's `door:via`, `door:asked`): its presses pass it and `act`
   * still takes it, but it isn't the part's argument, so what describes the action (`list`: `ep0ch actions`, its docs
   * page, the bar's form) leaves it out and names it only in `doorWords` (PIE-1705).
   */
  doorWord?: true;
  /** A word written more than once reaches the action as a list (a script's slot, `props.page`); every other argument takes the last. */
  many?: true;
}

/**
 * A real call of an action and what it does (PIE-1032): its page shows one or two, as `act` lines. `act` is the line
 * after `ep0ch act`, the action's name first (`layout.move tile=notes to=right`); `does` says what happens, in a few
 * words. `safe`: an agent may run it without asking (it only reads or changes the door's own view); left out, it is
 * read from the action's declarations (`touches: "nothing"`, `replay: "safe"`, not the person's), and `false` unmarks one.
 */
export interface ActionExample { act: string; does: string; safe?: boolean }

/**
 * What an action touches of the person's (PIE-514). The dispatcher (src/surface/dispatch.ts) checks it once, against
 * where the person is (src/whereabouts.ts), before the action runs; the action never asks who acts for this.
 * - `nothing`: a read; a mark; what the service writes and attributes (an extension's action, a refresh). Anyone, any time.
 * - `tile`: the tile it runs in: its view, cursor, selection or input. An agent's is refused in the tile that has the
 *   person's keys (`while: "typing"`: only while they type in it), with the agent's own way said (`way`).
 * - `shape`: the screen's layout. The layout engine decides each operation (src/desk/screen-layout.ts) from the same
 *   answer about where the person is (`ctx.person`).
 * - `draft`: a note the person may have open in a draft. The draft session's rule decides (`draftRule`).
 * - `screen`: what the person looks at, or where their keys go (another screen, their focus, a list's lit row, the
 *   board shown). An agent's waits until they aren't typing anywhere and have been idle `SHELL_IDLE_MS`.
 */
export type Touches = "nothing" | "tile" | "shape" | "draft" | "screen";

/**
 * One way to run an action (PIE-1048): `keys` in the keycap grammar `::graph-keys` reads (`alt+h`, `^W c`, `g then d`,
 * `j k`), or a mouse gesture (`click`, `double-click`, `drag`, `wheel`); `does`, what this way does, in a few words
 * (`on a spine opens it`). `via`, instead of keys: a way that is no key at all (the tile menu's "fold", the power bar).
 */
/**
 * One row of an action's keys: the keys and what they do under the action's heading (its page, `::graph-keys`), and
 * `says`, the whole sentence the keys window lists where `does` would read as a fragment after the action's words (PIE-1425).
 * `on`, the one screen or tile these keys are that place's own, by the name `in:` filters it (`menu`: the main menu's
 * letters, matched by its own key code; `tune`): the keys window then never says they take a key anywhere else (PIE-1439).
 */
/**
 * One way to press an action: its keys and what they do. `args`: the arguments that key presses it with, when the action's
 * keys differ by them (backlinks.view's K is step=kind): so a part answering "how do I group by kind" names that key alone
 * (yo, PIE-1712).
 */
export type KeyRow = { keys: string; does: string; says?: string; on?: string; args?: Readonly<Record<string, string | number | boolean>> } | { via: string };
/** An action's keys: rows (KeyRow), or one line that reads cleanly as them (declaredKeys, keyRows). */
export type Keys = string | readonly KeyRow[];
/** An action's keys as one line, for a listing (`actions`, a flash): each row's keys and what it does. */
export function keysText(keys: Keys | undefined): string | undefined {
  if (keys === undefined || typeof keys === "string") return keys;
  return keys.map(r => ("via" in r ? r.via : r.does ? `${r.keys}: ${r.does}` : r.keys)).join("; ") || undefined;
}

/** One field of an action's answer: its type, what it is, and the kind of thing it names when it names one. */
export interface AnswerField { type: string; about: string; kind?: ArgKind }

/**
 * One row of a tile's menu (PIE-492), as data: a few words under a group, the key its keycap shows (a name `declaredKeys`
 * finds in the action's `keys`: the menu's accelerator too), and the arguments the row runs the action with.
 */
export interface ActionMenuRow<Args = Record<string, unknown>> {
  label: string;
  /** "Tile", "Note", "Terminal", "Board": rows are grouped by it, in the order the dispatcher finds their sets. */
  group: string;
  /** Its keycap; left out, the first key the action's `keys` declares; `""`, none (an action with no key: layout.lock). */
  key?: string;
  args?: Args;
}

/**
 * What an action says about itself (PIE-1152: the implementation is what's displayed). `Args`: its arguments by name;
 * `Menu`: its menu rows (a client that runs actions adds what a row is now: the door's `MenuEntry.now`).
 */
export interface ActionDescription<Args extends object = Record<string, ArgSpec>, Menu extends ActionMenuRow<any> = ActionMenuRow> {
  /** What the action does, in the words `actions` and the README use. */
  summary: string;
  /**
   * Every way to press it (PIE-1048): rows of keys and what each does (KeyRow), or, for a key list that reads cleanly as
   * keycaps, one line of them ("j k ↓ ↑, or a click on a row"). `test/key-rows.test.ts` fails on a line that doesn't.
   */
  keys?: Keys;
  /** What it touches of the person's: the one actor rule, checked by the dispatcher (Touches). The most it can touch. */
  touches: Touches;
  /** `touches: "tile"`: refused in the tile with the person's keys (`focused`, the default), or only while they type in it. */
  while?: "focused" | "typing";
  args: Args;
  answer?: Readonly<Record<string, AnswerField>>;
  /** One or two real calls and what each does (ActionExample): its page's examples. An action with arguments has them (test/action-pages.test.ts). */
  examples?: readonly ActionExample[];
  /** Its rows in a tile's menu (`tile.menu`, PIE-492): absent, it isn't in one. */
  menu?: Menu | readonly Menu[];
}

/** An action as data, under the id `act` runs it by (`tile.close`): what a client that only reads actions holds. */
export interface ActionRow extends ActionDescription { id: string }

/**
 * The row of the action `id` that describes itself as `d`: its description as plain data, in one field order, with
 * nothing that runs (a menu row's `now`, an action's `run`) and nothing left `undefined`. Menu rows are a list.
 */
export function actionRow(id: string, d: ActionDescription<any, any>): ActionRow {
  const menu = (d.menu === undefined ? [] : Array.isArray(d.menu) ? d.menu : [d.menu]) as readonly ActionMenuRow[];
  return JSON.parse(JSON.stringify({
    id, summary: d.summary, args: d.args ?? {}, touches: d.touches,
    ...(d.keys !== undefined ? { keys: d.keys } : {}),
    ...(d.while ? { while: d.while } : {}),
    ...(menu.length ? { menu: menu.map(m => ({ label: m.label, group: m.group, ...(m.key !== undefined ? { key: m.key } : {}), ...(m.args !== undefined ? { args: m.args } : {}) })) } : {}),
    ...(d.examples?.length ? { examples: d.examples } : {}),
    ...(d.answer ? { answer: d.answer } : {}),
  })) as ActionRow;
}

// ── key names (PIE-506): one spelling for a key, from the words that name it ──

/** Named keys as the README, hints and `keys` write them, to the one name the door's `keyName` gives. */
export const NAMED_KEYS: Readonly<Record<string, string>> = {
  "⏎": "enter", enter: "enter", return: "enter", esc: "esc", escape: "esc", tab: "tab", backtab: "shift+tab", "shift+tab": "shift+tab",
  ctrl: "ctrl",
  space: "space", backspace: "backspace", "⌫": "backspace", delete: "delete", del: "delete",
  pgup: "pgup", pgdn: "pgdn", pageup: "pgup", pagedown: "pgdn", home: "home", end: "end",
  up: "up", down: "down", left: "left", right: "right", "↑": "up", "↓": "down", "←": "left", "→": "right",
  "alt+⏎": "alt+enter", "alt⏎": "alt+enter", "alt+enter": "alt+enter", "shift+enter": "shift+enter", "shift+⏎": "shift+enter", "ctrl+enter": "ctrl+enter",
  "alt+←": "alt+left", "alt+→": "alt+right", "alt+left": "alt+left", "alt+right": "alt+right",
  "alt+↑": "alt+up", "alt+↓": "alt+down", "alt+up": "alt+up", "alt+down": "alt+down",
  hover: "hover", click: "click", "right-click": "click", "ctrl-click": "click", "alt-click": "click", drag: "drag", wheel: "wheel",
};
/** Words that are a mouse gesture: in a hint, what follows them is what's clicked, not more keys. */
export const MOUSE_KEYS: ReadonlySet<string> = new Set(["click", "drag", "wheel"]);
/** Whether `s` is a key's one name (what `keyName` gives; never `exactKeyName`'s, which no screen matches): a screen's key map names its keys so. */
export const isKeyName = (s: unknown): s is string =>
  typeof s === "string" && (/^[^ ]$/u.test(s) || /^(alt|super|hyper)\+.$/u.test(s) || /^ctrl\+[^A-Z]$/u.test(s) || (Object.values(NAMED_KEYS).includes(s) && !MOUSE_KEYS.has(s)));

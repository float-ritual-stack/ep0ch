// The door's own hint parts and hot-line rows (PIE-1293): the keys a frame, a foot or a BBS list's hot line names,
// each on the action it runs, so a rebind shows wherever they're drawn (partsHint, hotParts). No literal key lists.
import { ESCAPE_CHORD } from "./desk/pty";
import { keyCaption } from "./surface/actions";
import { effective } from "./surface/keymap";
import { partsHint, type HintPart, type ModeKey } from "./surface/modes";
import type { Key } from "./term";

/** A held reader's hint parts (e or ⏎ go in, j k scroll it when it can), and an exited program's (⏎ again, the chord back): they follow a rebind. */
export const readerHeldParts = (scrolls: boolean, name = ""): HintPart[] => [{ key: "e", action: "tile.enter", label: `enter${name ? " " + name : ""}`, also: "⏎" }, ...(scrolls ? [{ key: "j", action: "element.scroll", label: "scroll", args: { by: 1 }, also: "k" }] : [])];
export const AGAIN_PART: HintPart = { action: "tile.enter", key: "enter", label: "runs it again" }, LEAVE_PART: HintPart = { action: "tile.leave", key: ESCAPE_CHORD, label: "back to the door" };

/** The drawer's own hint parts: its title row (folded) and its foot (entered) name these, so a rebind shows on them. */
const DRAWER_OPEN_PART: HintPart = { action: "tile.collapse", args: { on: false }, key: "+", also: "⏎", label: "opens it, or a click" }, DRAWER_FOLD_PART: HintPart = { action: "tile.collapse", args: { on: true }, key: "-", label: "folds it" };
const DRAWER_LEAVE_PART: HintPart = { action: "host.leave", key: "esc", label: "leaves" }, DRAWER_AWAY_PART: HintPart = { action: "host.toggle", args: { open: false }, key: "esc", label: "again puts it away" };

/** Hot line parts drawn from key rows (the keymap's, so a rebind shows): one part per label, its keys joined, a click on it sending the first. */
const sendOf = (key: string): Key => key === "enter" ? { kind: "enter" } : key === "up" || key === "down" ? { kind: key } : { kind: "char", ch: key };
export function hotParts(rows: readonly ModeKey[]): (string | [string, Key])[] {
  const groups = new Map<string, ModeKey[]>();
  for (const r of effective(rows)) groups.set(r.label ?? r.action, [...(groups.get(r.label ?? r.action) ?? []), r]);
  return [...groups].flatMap(([label, g], i): (string | [string, Key])[] => [...(i ? [" · "] : []), [`|15${g.map(r => keyCaption(r.key)).join("/")}|08 ${label}`, sendOf(g[0]!.key)]]);
}
/** The lists' own keys on their hot line: the lit row moves, ⏎ takes it, q goes back. */
export const listKeys = (enter: string, then: readonly ModeKey[] = []): readonly ModeKey[] => [{ key: "up", action: "list.select", label: "select" }, { key: "down", action: "list.select", label: "select" }, { key: "enter", action: "list.open", label: enter }, ...then];
export const BACK_KEY: readonly ModeKey[] = [{ key: "q", action: "screen.back", label: "back" }];
/** The BBS reader's n and p (message.next, message.previous): parts, so a click on each reads on as its key does. */
export const messageNavHint = () => partsHint([{ key: "n", action: "message.next", label: "next" }, { key: "p", action: "message.previous", label: "prev" }]);
/** The drawer's folded title row: + or ⏎ opens it, esc leaves. */
export const drawerTitleHint = () => partsHint([DRAWER_OPEN_PART, DRAWER_LEAVE_PART]);
/**
 * The drawer's foot: typing in a program there, ctrl+] steps out of it (Esc and every other key are the program's,
 * PIE-1554); entered, - folds it, esc steps out and esc again puts it away; else esc puts it away.
 */
export const drawerFoot = (entered: boolean, typing = false) => partsHint(entered && typing ? [{ ...LEAVE_PART, label: "steps out · esc is the program's" }]
  : entered ? [DRAWER_FOLD_PART, { ...DRAWER_LEAVE_PART, label: "steps out" }, DRAWER_AWAY_PART] : [{ ...DRAWER_AWAY_PART, label: "puts it away" }]);

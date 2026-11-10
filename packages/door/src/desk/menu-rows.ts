// The main menu's rows from screens (PIE-1525): any screen's spec may name a row (`menu`: a key, a label, its help
// words), an extension's (`screens[]` in its manifest) or one a person made. The menu (src/screens.ts) draws its
// built-in items, then these, in the order the screens were registered; `screen.menu` writes a person's row into their
// screen note, through screen.save's path, so every door on the outline shows the same rows and a restart keeps them.
import { ActionRefused } from "../surface/actions";
import { linePrompt } from "../surface/picker";
import { recordedAnswer, type Actor } from "../socket";
import type { Key } from "../term";
import type { Screen, Ctx } from "../app";
import type { Desk } from "./desk";
import { madeScreen, menuRowProblem, menuScreens, resolveScreen, screenNames, screensVersion, type ScreenSpec } from "./screen-spec";
import { saveScreenNote, screenNote } from "./screen-notes";

/**
 * A main-menu item. `one`: the class of a screen that keeps state or starts programs when it opens (the desk's terminal
 * tiles, the board's and the river's saved layouts): only one of it is on the stack, and `screen.open` of it while it's
 * there is refused (an agent's, on top of the person's desk, would start its programs twice). `action`: the item runs a
 * shell action instead of opening a screen (`!`, `screen.shell`). `screen`: the registered screen whose spec names this row; `about` what the help screen says of it;
 * `clash` why it has no key (`key` is "": another row, or the menu itself, holds it).
 */
export interface MenuItem { key: string; label: string; open: (ctx: Ctx) => Screen | null; one?: string; action?: "screen.shell" | "session.end" | "note.new"; screen?: string; about?: string; clash?: string }

/** A row's key as the menu's pointer sends it: its letter, or ⏎ for one without a key (the click lit it first). */
export const itemKey = (i: MenuItem): Key => (i.key ? { kind: "char", ch: i.key } : { kind: "enter" });

/** Keys the menu answers itself (video, keys, help): a screen's row can't take one. */
const MENU_OWN_KEYS: Record<string, string> = { V: "the menu's video key", H: "the menu's help key", "?": "the menu's keys window" };
let cache: { version: number; items: MenuItem[] } | null = null;

/**
 * The menu's rows: `builtins`, then every registered screen whose spec names a row. A row whose key another row (or the
 * menu) holds is kept without a key, its `clash` naming who holds it: capture never refuses.
 */
export function menuRows(builtins: readonly MenuItem[], openScreen: (name: string) => Screen): MenuItem[] {
  if (cache?.version === screensVersion()) return cache.items;
  const items = [...builtins];
  for (const s of menuScreens()) {
    const holder = items.find(i => i.key === s.menu.key)?.label ?? MENU_OWN_KEYS[s.menu.key];
    items.push({
      key: holder ? "" : s.menu.key, label: s.menu.label, open: () => openScreen(s.name), one: s.name, screen: s.name, about: s.menu.about ?? s.title,
      ...(holder ? { clash: `${s.menu.key} is ${holder}'s: ${s.menu.label} has no key (a click or screen.open name=${s.name} opens it; screen.menu gives it another)` } : {}),
    });
  }
  cache = { version: screensVersion(), items };
  return items;
}

/**
 * `screen.menu`: give the screen named `a.name` that a person made (left out: the one `d` shows) a row, `key` opening it
 * and `label` naming it; `off` takes the row away. Written into its screen note's spec, checked against the revision
 * this door read. The person's with no key opens the prompt ("Y Potting"). A key another row holds is kept, and the
 * answer says who holds it.
 */
export async function menuScreen(d: Desk, a: { name?: string; key?: string; label?: string; off?: boolean }, actor: Actor): Promise<Record<string, unknown>> {
  const name = a.name !== undefined ? resolveScreen(a.name) ?? a.name : d.madeName();
  if (!name) throw new ActionRefused("screen.menu adds a screen you made to the main menu: open one (^W r), or name it with name=<screen> (save this one first: ^W w)");
  const note = screenNote(name);
  if (!note) throw new ActionRefused(screenNames().includes(name) ? `${name} isn't a screen you made: its menu row is its own (a built-in's, or its extension's manifest)` : `no screen ${name} that a person made · screen.list names them`);
  const example = `screen.menu name=${name} key=Y label=${JSON.stringify(note.title.slice(0, 16))}`;
  if (!a.off && a.key === undefined && a.label === undefined) {
    if (actor.kind === "agent") throw new ActionRefused(`screen.menu needs key=<one character> and label=<a few words>, or off=true · e.g. ${example}`);
    d.overlay(menuRowPrompt(name, note.spec.menu ? `${note.spec.menu.key} ${note.spec.menu.label}` : `${note.title.trim()[0]?.toUpperCase() ?? "Y"} ${note.title.slice(0, 16)}`));
    return { prompt: true, screen: name };
  }
  const { menu: was, ...rest } = note.spec;
  let spec: ScreenSpec = rest;
  if (a.off && !was) return { screen: name, menu: null, changed: false };
  if (!a.off) {
    const row = { key: (a.key ?? was?.key ?? "").trim().toUpperCase(), label: (a.label ?? was?.label ?? note.title).trim() };
    const bad = menuRowProblem(row);
    if (bad) throw new ActionRefused(`${bad} · e.g. ${example}`);
    spec = { ...rest, menu: { ...(was?.about ? { about: was.about } : {}), ...row } };
  }
  const { note: saved } = await saveScreenNote(d.ctx.board, spec, actor, madeScreen(name) ?? null);
  d.noteWritten(name, { id: saved.id, revision: saved.revision });
  // Who holds its key, when someone does (the menu's own rows, read when it's asked: screens.ts is loaded by then).
  const clash = (await import("../screens")).menuItems().find(i => i.screen === name)?.clash;
  d.redraw();
  return { screen: name, menu: spec.menu ?? null, note: saved.id, revision: saved.revision, ...(clash ? { problem: clash } : {}), recordedAs: recordedAnswer(actor) };
}

/** The prompt: a key, then the row's label ("Y Potting"); ⏎ runs screen.menu as the person, refused it comes back with what was typed. */
function menuRowPrompt(name: string, text: string) {
  const split = (t: string) => { const [key, ...words] = t.trim().split(/\s+/); return { key: (key ?? "").toUpperCase(), label: words.join(" ") }; };
  return linePrompt<Desk>({
    name: "menu row", title: `add ${name} to the main menu: a key, then its label`, text, w: 80,
    doing: t => { const r = split(t); return `${r.key} ${r.label} opens ${name} from the main menu`; },
    hint: t => { const why = menuRowProblem(split(t)); return why ? { text: why, warn: true } : { text: "Y Potting: Y opens it, Potting is its row" }; },
    done: (t, d) => void d.dispatch.press("screen.menu", { name, ...split(t) }).then(r => { if (r === undefined) d.overlay(menuRowPrompt(name, t)); }),
  });
}

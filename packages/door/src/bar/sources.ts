import { overrideWords } from "@ep0ch/outliner/extension-update";
import { outlineBoards, readNote } from "../desk/outline-boards";
import { subtitleOf } from "@ep0ch/outline-core/block-record";
import { BLOCK_ID_PATTERN, formatEp0chBlockUri } from "@ep0ch/outline-core/addressable-resource";
import { blockRefText } from "@ep0ch/outline-core/link-syntax";
import { addressOf } from "../open";
import { ownOutline } from "../note-ref";
// The power bar's built-in sources (PIE-656), each a scope with its prefix: tiles (%), notes (/), actions (>),
// recent (+) and screens (@). None keeps a list of its own: tiles are the layout tree's (`Desk.tileOutline`) on every
// screen and in the drawer; notes are the service's one search (`board.search`, Goto's ranker, Jev re-ordering after
// a pause); actions are the dispatcher's (the focused tile's menu rows, then every action that needs no argument);
// recent is the what-changed store behind the status bar's `+N new`; screens are the shell's `screen.list`. A pick goes
// through the shared paths: the drawer's goTo, the `open` action, the dispatcher's press.
import { headedTitle as titleWithWorkId } from "@ep0ch/outline-core/work-id-title";
import { headedTitle, identityFields, subject, type Msg } from "../board";
import { Desk } from "../desk/desk";
import { PtyPane } from "../desk/pty";
import { tileKinds } from "../desk/tile-kinds";
import { wCaption, type WRow } from "../desk/wkeys";
import { ScreenTile } from "../desk/screen-tile";
import { notConfigured, jevOff } from "../surface/completer";
import { ActionRefused, actRequestOf, coerceActionArgs, declaredKeys, lineWords, shownLine, type ActionInfo, type ActRequest } from "../surface/actions";
import { authorName, USER } from "../socket";
import { ago } from "../text";
import { filtered } from "./filter";
import { hyperKeysOf, hyperOn } from "../hyper";
import { closest } from "../cli-words";
import { formFields, SELECTOR } from "./form";
import { actionLead, actionPage } from "../surface/action-page";
import type { Screen } from "../app";
import type { BarHost, BarRow, BarSource, PickHow } from "./source";
import { openNote, registerBarSource } from "./source";
import { extensionList, extensionParts, PART_KINDS, partKind, scriptActions, type ExtensionEntry, type ExtensionList } from "../extensions";
import { openActionForm } from "./form";
import { settingsChip, settingsMarkdown, shownValue } from "../extension-settings";

/** The arguments action `name` declares, as the door lists it now. */
const actionArgs = (host: BarHost, name: string) => host.dispatch.list().actions.find(a => a.name === name)?.args ?? {};

/** The tiles a screen holds: a desk, or the desk inside it (the showcase's section). */
export function tilesOf(s: Screen | undefined): Desk | null { return s instanceof Desk ? s : s?.tilesHere?.() ?? null; }

/** What a tile row carries: where the tile is (a screen, or the drawer) and its name there. */
interface TileAt {
  desk: Desk; name: string; screen: Screen | null; drawer: boolean; shows: string | null; kind: string;
  /** Its `mount/tile` path (PIE-651): the mounts it's inside, outermost first, then its own name. */
  path: string;
  /** The mounts it's inside, outermost first: each mount tile's desk and name. */
  mounts: { desk: Desk; name: string }[];
  /** What a query matches the note it shows by: work id, page name, title. */
  find: string[];
}

/**
 * A desk's tiles as rows, each followed by the tiles of a screen mounted in it (PIE-651), one level deeper, named by
 * their `mount/tile` path: the path `tile=` takes for a tile inside a mount.
 */
function tileRows(desk: Desk, at: string, group: string, screen: Screen | null, drawer: boolean, base = 0, prefix = "", mounts: { desk: Desk; name: string }[] = []): BarRow[] {
  return desk.tileOutline().flatMap(t => {
    const path = `${prefix}${t.name}`, p = desk.pane(t.name);
    const row: BarRow = {
      key: `${at}:${path}`, fill: path, label: t.showing ? titleWithWorkId(t.label, t.showing.workId) : t.label, depth: base + t.depth, group,
      mark: t.focused ? "●" : t.collapsed ? "▸" : t.float ? "⧉" : t.docked ? "⇤" : t.tab && !t.shown ? "⋯" : " ",
      detail: [path, t.kind, t.mode ?? "", t.collapsed ? "a spine" : "", t.float ? "floating" : "", t.docked ? "docked" : "", t.tab && !t.shown ? "a tab behind" : "", mounts.length ? "in a mount" : ""].filter(Boolean).join(" · "),
      data: { desk, name: t.name, screen, drawer, shows: t.showing?.id ?? null, kind: t.kind, path, mounts, find: [path, ...(t.showing ? identityFields(t.showing.workId, t.showing.page, t.showing.title) : [])] } satisfies TileAt,
    };
    const inner = p instanceof ScreenTile ? p.inner : null;
    return [row, ...(inner ? tileRows(inner, at, group, screen, drawer, base + t.depth + 1, `${path}/`, [...mounts, { desk, name: t.name }]) : [])];
  });
}

/**
 * The tiles of the screen shown (its mounts' too, by their `mount/tile` path) matching `q`: what `tile=` and an
 * argument that names a tile (ArgKind `tile`) reach. The form's tile fields list these (src/bar/arg-kinds.ts).
 */
export function shownTileRows(host: BarHost, q: string): BarRow[] {
  const shown = host.screens().at(-1), desk = tilesOf(shown);
  if (!desk) return [];
  return filtered(tileRows(desk, "0", `${shown?.title ?? "this screen"} · here`, shown ?? null, false), q, r => [r.label, ...(r.data as TileAt).find, r.detail ?? ""]);
}

const TILES: BarSource = {
  id: "tiles", title: "tiles", prefix: "%", by: "door",
  about: "the tiles open on every screen and in your drawer, indented as each screen's layout tree, with the note each shows; ⏎ goes to one (a spine opens, its screen comes up), alt+⏎ zooms it",
  main: { empty: true, typed: true, most: 8 },
  rows(q, host, scope) {
    const shown = host.screens().at(-1);
    const drawer = host.ctx.hostLayer?.desks().find(d => host.ctx.hostLayer!.isDrawer(d)) ?? null;
    const places: { desk: Desk; screen: Screen | null; group: string }[] = [];
    const add = (desk: Desk | null, screen: Screen | null, group: string) => { if (desk && !places.some(p => p.desk === desk)) places.push({ desk, screen, group }); };
    add(tilesOf(shown), shown ?? null, `${shown?.title ?? "this screen"} · here`);
    if (!q.trim() && !scope) return places.flatMap(({ desk, screen, group }, at) => tileRows(desk, String(at), group, screen, false));
    add(drawer, null, "your drawer");
    for (const s of [...host.screens()].reverse()) if (s !== shown) add(tilesOf(s), s, `${s.title} · under this one`);
    for (const s of host.kept()) add(tilesOf(s), s, `${s.title} · kept`);
    const rows = places.flatMap(({ desk, screen, group }, at) => tileRows(desk, String(at), group, screen, desk === drawer));
    return filtered(rows, q, r => [r.label, ...(r.data as TileAt).find, r.detail ?? "", r.group ?? ""]);
  },
  preview(row) {
    const t = row.data as TileAt;
    if (t.shows) return { note: t.shows };
    const p = t.desk.pane(t.name);
    if (p instanceof PtyPane) { const text = p.text(); while (text.length && !text.at(-1)!.trim()) text.pop(); return { lines: text.length ? text : ["(the terminal is blank)"] }; }
    return { lines: [`${t.name}: a ${t.kind} tile${t.screen ? ` on the ${t.screen.title}` : " in your drawer"}`, "", p?.title?.() ?? "", "", "⏎ goes to it · alt+⏎ zooms it"] };
  },
  async pick(row, host, how) {
    const t = row.data as TileAt, p = t.desk.pane(t.name);
    if (!p) throw new ActionRefused(`${t.path} isn't open any more`);
    // An agent goes through the tile actions on the screen shown (a tile in a mount by its path), so their rules are its:
    // it never moves the person's screen.
    if (!host.dispatch.standing(how.actor)) {
      if (t.screen !== host.screens().at(-1)) throw new ActionRefused(`${t.path} isn't on the screen shown: an agent doesn't move the person's screen or drawer from the bar`);
      const r = await host.dispatch.act({ action: "tile.focus", tile: t.path }, how.actor);
      return how.alt ? host.dispatch.act({ action: "tile.zoom", tile: t.path, args: { on: true } }, how.actor) : r;
    }
    const layer = host.ctx.hostLayer;
    if (!layer) throw new ActionRefused("this door has no tiles to go to");
    if (!t.mounts.length) return layer.goTo(p, how.actor, { zoom: how.alt });
    // In a mount: to the outermost mount (its screen up, its spine opened), then into each mount in turn, then the tile.
    const top = t.mounts[0]!, outer = top.desk.pane(top.name);
    if (!outer) throw new ActionRefused(`the mount ${top.name} isn't open any more`);
    layer.goTo(outer, how.actor);
    for (const m of t.mounts) {
      const mount = m.desk.pane(m.name);
      if (!(mount instanceof ScreenTile) || !mount.inner) throw new ActionRefused(`nothing is mounted in ${m.name} now`);
      if (m !== top) { if (m.desk.tileOutline().find(x => x.name === m.name)?.collapsed) m.desk.collapseTile(m.name, false, how.actor); m.desk.focusTile(m.name, how.actor); }
      mount.goIn(true);
    }
    if (t.desk.tileOutline().find(x => x.name === t.name)?.collapsed) t.desk.collapseTile(t.name, false, how.actor);
    t.desk.focusTile(t.name, how.actor);
    if (how.alt) t.desk.zoomTile(t.name, true, how.actor);
    return { tile: t.path, in: "mount" };
  },
};

/** A hit's row: its work id (when its title doesn't start with it) and its title. */
const noteRow = (m: Msg): BarRow => ({ key: m.id, label: headedTitle(m), subtitle: subtitleOf(m), fill: subject(m), note: { id: m.id } });

/** How many notes `/` lists with nothing typed. */
const RECENT_NOTES = 30;
/**
 * `/` with nothing typed: the notes most recently changed first. The service's own recency list (an empty `tree.search`
 * with no note to be near: every live note by when it was last edited, the person's edits and others') merged with what
 * others changed since the person looked (the `+` scope's store, so a change the feed holds is never missing), newest first.
 */
export async function recentNotes(host: BarHost): Promise<BarRow[]> {
  const found = new Map<string, { m: Msg; at: number; row: BarRow }>();
  for (const m of await host.ctx.board.search("", RECENT_NOTES)) found.set(m.id, { m, at: m.updatedAt, row: { ...noteRow(m), detail: `${authorName(m.author)} · ${ago(m.updatedAt)} ago` } });
  for (const r of host.ctx.whatChanged?.list().slice(0, RECENT_NOTES) ?? []) {
    // A change newer than the search's snapshot of the note: read it again (a rename, a trash), never the old words.
    const seen = found.get(r.blockId)?.m, m = seen && seen.updatedAt >= r.at ? seen : await host.ctx.board.get(r.blockId).catch(() => null);
    if (!m || m.deleted) { found.delete(r.blockId); continue; }
    found.set(r.blockId, { m, at: Math.max(r.at, m.updatedAt), row: { ...noteRow(m), mark: r.seen ? " " : "+", detail: `${r.kind} by ${authorName(r.who)} · ${ago(r.at)} ago` } });
  }
  return [...found.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_NOTES).map(x => x.row);
}

/**
 * What's typed is a note's address (PIE-1398: an id, a reference, another outline's reference, a line's, an `ep0ch://`
 * address or a web link, `addressOf`): that note's row, read where it lives (`readNote`, another outline's through its
 * board; a page or Work ID by `pages.resolve`), never a search for its words. Refused, it says which note it named.
 */
async function addressedRows(to: NonNullable<ReturnType<typeof addressOf>>, host: BarHost): Promise<BarRow[]> {
  const own = await ownOutline(host.ctx), outline = to.outline && to.outline !== own ? to.outline : undefined;
  const at = outline ? { outline, ...(to.machine ? { machine: to.machine } : {}) } : undefined;
  const where = outline ?? "this outline", named = "block" in to ? to.block : to.page;
  let m: Msg | null = null;
  if ("page" in to && to.page) m = (await (at ? (await outlineBoards(host.ctx).on(at)).board : host.ctx.board).resolvePage(to.page)).block ?? null;
  else if (BLOCK_ID_PATTERN.test(to.block!)) m = await readNote(host.ctx, to.block!, at);
  // A short id (its first 8+ characters, as a reference may write it): the service's reading of the reference.
  else {
    const [r] = await host.ctx.board.resolveReferences(blockRefText(to.block!, "", outline ? { outline } : {}));
    if (r?.status === "resolved") m = await readNote(host.ctx, r.blockId, r.outline && r.outline !== own ? { outline: r.outline, ...(r.machine ? { machine: r.machine } : {}) } : at);
  }
  if (!m || m.deleted) return [{ key: `address:${named}`, label: to.label ?? named!, exact: true, refused: `no note ${named} in ${where}` }];
  const there = m.address?.outline && m.address.outline !== own ? m.address : undefined;
  const c = there ? await outlineBoards(host.ctx).on(there) : null;
  const key = there ? formatEp0chBlockUri({ outline: there.outline, machine: there.machine ?? c!.machine ?? (await c!.board.info()).machine!, blockId: m.id }) : m.id;
  const detail = [there?.outline, to.fragment ? `line ^${to.fragment}` : ""].filter(Boolean).join(" · ");
  return [{ ...noteRow(m), key, exact: true, oneLine: true, ...(detail ? { detail, subtitle: undefined } : {}), note: { id: m.id, ...(there ? { outline: there.outline } : {}) }, data: { fragment: to.fragment } }];
}

const NOTES: BarSource = {
  id: "notes", title: "notes", prefix: "/", by: "door", asks: true,
  about: "outline:<name> words searches another outline on this host; otherwise the outline's notes by words (with nothing typed, the notes changed most recently, newest first): the service's one search (Goto's ranker, nearer notes first), re-ordered by Jev after a pause when it's set up; ⏎ opens one where opens land, alt+⏎ in a new detail; alt+m or a right-click on a hit is its menu: copy its id, reference or web link (note.copy-ref)",
  main: { empty: false, typed: true, most: 10 },
  async rows(q, host, _scope, signal) {
    const named = q.match(/^outline:([^\s]+)(?:\s+(.*))?$/);
    if (named) {
      const ctx = await outlineBoards(host.ctx).on({ outline: named[1]! });
      const info = await ctx.board.info();
      return (await ctx.board.search(named[2] ?? "", 30, { signal })).map(m => ({ ...noteRow(m), key: formatEp0chBlockUri({ outline: named[1]!, machine: ctx.machine ?? info.machine!, blockId: m.id }), detail: named[1], note: { id: m.id, outline: named[1]! } }));
    }
    const to = addressOf(q);
    if (to) return addressedRows(to, host);
    if (!q.trim()) return recentNotes(host);
    if (q.trim().length < 2) return [];
    return (await host.ctx.board.search(q.trim(), 30, { near: host.near() ?? undefined, signal })).map(noteRow);
  },
  later(q, rows, host, signal) {
    const board = host.ctx.board;
    if (q.startsWith("outline:") || rows[0]?.exact || q.trim().length < 3 || rows.length < 2 || jevOff.has(board)) return null;
    return board.search(q.trim(), 30, { semantic: true, near: host.near() ?? undefined, signal }).then(h => {
      if (h.semantic && notConfigured(h.semantic)) jevOff.add(board);
      return h.semantic?.status === "ranked" ? { rows: h.map(noteRow), said: "jev ranked" } : null;
    }, () => null);
  },
  preview: row => (row.refused ? { lines: [row.refused] } : { note: row.key }),
  pick(row, host, how) {
    if (row.refused) throw new ActionRefused(row.refused);
    return openNote(row.key, host, how, (row.data as { fragment?: string } | undefined)?.fragment);
  },
};

/** An action's first plain key (not a gesture, not a chord), for its keycap. */
const firstKey = (keys: string | undefined) => [...declaredKeys(keys)].find(k => k !== "click" && k !== "drag" && k !== "wheel" && !k.includes(" "));
/** An action anyone can run with no arguments, from the bar (the bar's own aren't listed). */
const bare = (a: ActionInfo) => !a.name.startsWith("bar.") && Object.values(a.args).every(s => s.optional);
/** An action the bar lists: any but its own; one that takes arguments opens its form (PIE-1031). */
const listed = (a: ActionInfo) => !a.name.startsWith("bar.");
/** It takes arguments: picked, its form opens (src/bar/form.ts). */
const takesArgs = (a: ActionInfo) => Object.keys(a.args).length > 0;

/** `^W` typed first in the actions scope (or `ctrl+w`): the desk's ^W keys, what's after it filtering them. */
const W_QUERY = /^\s*(?:\^w|ctrl\+w)\s*(.*)$/i;

/** What a ^W row carries to be picked: the keys after ^W that press it, and the action an agent runs instead. */
interface WData { chord: string; action: string; args: Record<string, unknown>; how: WRow["how"] }

/**
 * The desk's ^W keys as rows (PIE-704): the table in desk/wkeys.ts joined to each action's words (`Desk.wRows`), the
 * kinds' open keys after `^W o`, each with its keycap and, where the tile menu says the action would be refused
 * now, why. Under their group's heading with nothing more typed; typed, ranked by the bar's one matcher.
 */
function wKeyRows(desk: Desk, q: string, host: BarHost): BarRow[] {
  const refusals = new Map<string, string>();
  try { for (const m of keysDispatch(host)?.menu("focused", USER) ?? []) if (m.key && m.refused) refusals.set(m.key, m.refused); } catch { /* no menu here */ }
  const rows: BarRow[] = desk.wRows().map(r => ({
    key: `w:${r.key}`, label: r.label, detail: r.summary && r.summary !== r.label ? r.summary : r.action, keycap: r.chord, group: r.group,
    // The menu's word on a plain action only: a key the desk reads itself (a dock's d, a direction) may reach another tile.
    ...(r.how === "run" && refusals.get(r.chord) ? { refused: refusals.get(r.chord)! } : {}),
    data: { chord: r.key, action: r.action, args: r.args, how: r.how } satisfies WData,
  }));
  // The open keys: ^W o and then the kind's own.
  const at = rows.findIndex(r => r.key === "w:O") + 1;
  const kinds = tileKinds().flatMap(k => (k.keys ?? []).map(x => ({ key: x.key, label: x.label, kind: k.kind })));
  rows.splice(at, 0, ...kinds.map((k): BarRow => ({ key: `w:o ${k.key}`, label: `open ${k.label} beside`, detail: `tile.open kind=${k.kind}`, keycap: `ctrl+w o ${k.key}`, group: "open", data: { chord: `o ${k.key}`, action: "tile.open", args: { kind: k.kind }, how: "prefix" } satisfies WData })));
  const typed = !!q.trim();
  const hits = filtered(rows, q, r => [r.label, r.detail ?? "", r.group ?? "", wCaption((r.data as WData).chord)]);
  // Ranked by the matcher once something is typed, so no headings; in the table's order, under its groups, before.
  return typed ? hits.map(({ group: _g, ...r }) => r) : hits;
}

/**
 * The screen the person's keys are in (PIE-1346, the App's keysScreen): its focused tile's menu and its ^W keys are the
 * actions scope's, and a row runs there, so "unlock your drawer" is the drawer's when the keys are in it.
 */
const keysScreen = (host: BarHost) => host.ctx.keysScreen?.() ?? host.screens().at(-1);
const keysDispatch = (host: BarHost) => keysScreen(host)?.dispatch;

const ACTIONS: BarSource = {
  id: "actions", title: "actions", prefix: ">", by: "door",
  about: "what you can do here: the focused tile's menu (its ⋯), then every action of this screen and the door's, each with its key, found by its name or what it does; ⏎ runs one that takes nothing as its key would, and opens the form of one that takes arguments (alt+⏎ runs it as it is when it needs none)",
  main: { empty: false, typed: true, most: 6 },
  rows(q, host, scope) {
    const w = W_QUERY.exec(q);
    if (w) { const desk = tilesOf(keysScreen(host)); return desk ? wKeyRows(desk, w[1]!, host) : []; }
    const menu = (() => { try { return keysDispatch(host)?.menu("focused", USER) ?? []; } catch { return []; } })();
    // While the hyper layer is on (PIE-699) each action that has a chord shows it, as ✦-, beside its other keys.
    const hy = (action: string) => (hyperOn() ? hyperKeysOf(action) : []);
    const rows: BarRow[] = menu.map(m => ({ key: `menu:${m.action}:${JSON.stringify(m.args)}`, label: m.label, fill: m.action, detail: `${m.group} · ${m.action}${hy(m.action).length ? ` · ${hy(m.action).join(" ")}` : ""}`, ...(m.key ? { keycap: m.key } : {}), ...(m.refused ? { refused: m.refused } : {}), data: { action: m.action, args: m.args, tile: m.tile, summary: "" } }));
    const seen = new Set(menu.map(m => m.action));
    for (const a of host.dispatch.list().actions) {
      if (seen.has(a.name) || !listed(a)) continue;
      seen.add(a.name);
      const k = firstKey(a.keys);
      const script = scriptActions().find(s => s.action.name === a.name);
      rows.push({ key: a.name, fill: a.name, label: script?.extension.name ?? a.name, detail: `${a.summary}${hy(a.name).length ? ` · ${hy(a.name).join(" ")}` : ""}${takesArgs(a) ? " · ⏎ its form" : ""}`, ...(k ? { keycap: k } : hy(a.name).length ? { keycap: hy(a.name)[0]! } : {}), data: { action: a.name, args: {}, summary: a.summary, keys: a.keys, form: takesArgs(a), bare: bare(a) } });
    }
    // By name, and by what it says it does (its summary: an extension's action by its label and description).
    const found = filtered(rows, q, r => [r.label, r.fill ?? "", r.detail ?? "", (r.data as { summary?: string } | undefined)?.summary ?? ""]);
    const line = actionLine(q, host, scope === "actions" && !found.length);
    return line ? [line, ...found] : found;
  },
  named: (q, host) => actionLine(q, host),
  preview(row, host) {
    const d = row.data as { action: string; summary?: string; keys?: string };
    const info = host.dispatch.list().actions.find(a => a.name === d.action);
    // Its page (PIE-1032): the lead, its keys as keycaps, its arguments as a properties table, its examples.
    const page: ActionInfo = info ?? { name: d.action, summary: d.summary ?? "", ...(d.keys ? { keys: d.keys } : {}), args: {}, scope: "", touches: "nothing", replay: "ask" };
    return { markdown: actionPage(page, { title: row.label, ...(row.refused ? { refused: row.refused } : {}), ...(hyperOn() ? { hyper: hyperKeysOf(d.action) } : {}) }) };
  },
  async pick(row, host, how) {
    if (row.refused) throw new ActionRefused(row.refused);
    const d = row.data as { action: string; args: Record<string, unknown>; tile?: string; form?: boolean; bare?: boolean; missing?: string[] };
    if (row.key.startsWith("w:")) return pickW(row, host, how);
    // One that takes arguments opens its form (PIE-1031), a line typed with some of them answered; alt+⏎ runs one that needs none as it is.
    if (d.form && !(how.alt && d.bare)) {
      if (how.actor.kind === "agent") {
        if (d.missing?.length || !d.bare) throw new ActionRefused(`${d.action} needs ${(d.missing?.length ? d.missing : Object.entries(actionArgs(host, d.action)).filter(([, s]) => !s.optional).map(([k]) => k)).map(k => `${k}=`).join(" ")}: an agent runs it with them (ep0ch act ${d.action} …; bar.form op=open action=${d.action} answers its fields)`);
      } else return openActionForm(host, { action: d.action, args: d.args, ...(d.tile !== undefined ? { tile: d.tile } : {}) }, how.actor);
    }
    // A menu row runs in its tile on the dispatcher of the tiles the keys are in, as its ⋯ menu runs it; the rest on the door's.
    const keys = keysDispatch(host);
    const on = d.tile !== undefined && keys ? keys : host.dispatch;
    if (row.key.startsWith("line:") || row.key === d.action || how.actor.kind === "agent") return on.act({ action: d.action, args: d.args, ...(d.tile !== undefined ? { tile: d.tile } : {}) }, how.actor);
    return on.press(d.action, d.args, d.tile);
  },
};

/**
 * What's typed as an action line, as `ep0ch act` takes it (PIE-856): an action this door has, then its `key=value`
 * words, quoted as a shell quotes them (`tile.open kind=query query="#build-report"`), or the name alone of one that
 * needs arguments. Its row runs it as typed, as the person; an argument the action doesn't take, of the wrong type
 * or missing is said on the row (refused), and its summary and arguments are on the right. Anything else: none.
 */
function actionLine(q: string, host: BarHost, command = false): BarRow | null {
  // A note's address pasted (a web link, an ep0ch:// one) is the notes source's to open, never an action that isn't there.
  if (addressOf(q)) return null;
  const words = lineWords(q);
  let req: ActRequest;
  try { req = actRequestOf(words); } catch (e) {
    if (!q.includes("=") && !words[0]?.includes(".")) return null;
    return { key: `line:${q}`, label: q, fill: q, exact: true, refused: e instanceof Error ? e.message : String(e), data: { action: words[0], args: {} } };
  }
  const scripts = scriptActions().filter(s => s.extension.name === req.action);
  if (scripts.length === 1 && !host.dispatch.has(req.action)) req.action = scripts[0]!.action.name;
  const actions = host.dispatch.list().actions;
  const corrections: string[] = [];
  let info = actions.find(a => a.name === req.action);
  if (!info && (command || req.action.includes(".") || words.some(w => w.includes("=")))) {
    const near = closest(req.action, actions.map(a => a.name));
    if (near) { corrections.push(`did you mean ${req.action} -> ${near}`); req.action = near; info = actions.find(a => a.name === near); }
    else return { key: `line:${q}`, label: q, fill: q, exact: true, refused: `no action ${req.action} here; > lists actions`, data: { action: req.action, args: {} } };
  }
  if (info) {
    const fields = formFields(info);
    for (const key of Object.keys(req.args ?? {})) {
      if (fields.some(f => f.name === key)) continue;
      const names = fields.map(f => f.name);
      const prefixes = names.filter(n => key.startsWith(n));
      const near = closest(key, names) ?? (prefixes.length === 1 ? prefixes[0]! : null);
      if (near && req.args![near] === undefined && (near !== SELECTOR || req.tile === undefined)) {
        corrections.push(`${key} -> ${near}`);
        if (near === SELECTOR) req.tile = String(req.args![key]); else req.args![near] = req.args![key];
        delete req.args![key];
      }
    }
  }
  // A name alone that needs nothing is the action's own row already.
  if (!info || (words.length < 2 && bare(info) && !scripts.length && !corrections.length)) return null;
  // An argument it doesn't take or one of the wrong type: the row says which, as `ep0ch act` would. One it needs and
  // wasn't given opens its form (PIE-1031), the rest answered as typed.
  let refused: string | undefined;
  const missing = Object.entries(info.args).filter(([k, s]) => !s.optional && req.args?.[k] === undefined).map(([k]) => k);
  if (req.as !== undefined) refused = "the power bar runs it as you: leave out as=";
  else try {
    const spec = Object.fromEntries(Object.entries(info.args).map(([k, s]) => [k, missing.includes(k) ? { ...s, optional: true } : s]));
    for (const [key, value] of Object.entries(req.args ?? {})) {
      const spec = info.args[key];
      const choices = spec?.type === "boolean" ? ["true", "false"] : spec?.choices;
      if (spec?.type === "boolean" && ["yes", "no", "0", "1"].includes(String(value))) continue;
      if (choices?.length && !choices.includes(String(value)) && !info.args[key]?.kind) {
        const near = closest(String(value), choices);
        if (near) { corrections.push(`${key}=${value} -> ${key}=${near} (allowed: ${choices.join(", ")})`); req.args![key] = near; }
        else throw new ActionRefused(`${key}=${value}: allowed values: ${choices.join(", ")}`);
      }
    }
    req.args = coerceActionArgs(req.action, spec, req.args ?? {});
  } catch (e) { refused = e instanceof Error ? e.message : String(e); }
  const shown = shownLine(scripts.length === 1 ? scripts[0]!.extension.name! : req.action, req.args ?? {}, req.tile);
  return {
    key: `line:${shown}`, label: `run ${shown}`, fill: shown, detail: [...corrections, ...(missing.length && !refused ? [`needs ${missing.map(k => `${k}=`).join(" ")} · ⏎ its form`] : corrections.length ? [] : [actionLead(info.summary)])].join("; "), exact: true, ...(refused ? { refused } : {}),
    data: { action: req.action, args: req.args ?? {}, ...(req.tile !== undefined ? { tile: req.tile } : {}), summary: info.summary, keys: info.keys, ...(missing.length ? { form: true, missing } : {}) },
  };
}

/**
 * A ^W row picked: the person's presses its keys (the desk's own chord handler, so it is what ^W then the key does,
 * a key that waits for another leaves the desk waiting for it); an agent's runs the action it stands for, as itself,
 * and is told the action when the key is only a person's chord (a direction, a panel).
 */
async function pickW(row: BarRow, host: BarHost, how: PickHow): Promise<unknown> {
  const d = row.data as WData, desk = tilesOf(keysScreen(host));
  if (row.refused) throw new ActionRefused(row.refused);
  if (!desk) throw new ActionRefused("the screen shown has no ^W keys");
  if (how.actor.kind === "agent") {
    if (d.how !== "run") throw new ActionRefused(`^W ${d.chord} is the person's key chord; an agent runs ${d.action} with its arguments (ep0ch actions ${d.action})`);
    return keysDispatch(host)!.act({ action: d.action, args: d.args, tile: "focused" }, how.actor);
  }
  desk.wChord(d.chord);
  return { key: wCaption(d.chord), action: d.action };
}

const RECENT: BarSource = {
  id: "recent", title: "recent", prefix: "+", by: "door",
  about: "what others changed since you looked, newest first, found by title, work id or page name: the status bar's +N new, from the service's change feed (looking here doesn't mark it seen; alt+o does); ⏎ opens the note, alt+⏎ in a new detail",
  main: { empty: true, typed: true, most: 8 },
  rows(q, host) {
    const store = host.ctx.whatChanged;
    if (!store) return [];
    const rows = store.list().map((r): BarRow => ({ key: r.blockId, label: r.title === undefined ? "…" : titleWithWorkId(r.title, r.workId), data: { find: identityFields(r.workId, r.page, r.title ?? "") }, mark: r.seen ? " " : "+", detail: `${r.kind} by ${authorName(r.who)} · ${ago(r.at)} ago` }));
    // Titles not read yet come in a moment (the list's own read); the bar asks again when the store says so.
    if (store.list().some(r => r.title === undefined || r.retitle)) void store.titles(host.ctx.board);
    return filtered(rows, q, r => [r.label, ...((r.data as { find: string[] }).find), r.detail ?? ""]);
  },
  preview: row => ({ note: row.key }),
  pick: (row, host, how) => openNote(row.key, host, how),
};

interface ScreenListed { stack: string[]; screens: { key: string; label: string; about: string }[]; named: { name: string; title?: string; made?: boolean }[] }

const SCREENS: BarSource = {
  id: "screens", title: "screens", prefix: "@", by: "door",
  about: "the screens to open: the menu's and every registered one (the ones people made too); ⏎ opens it over this one (q comes back)",
  main: { empty: false, typed: true, most: 5 },
  async rows(q, host) {
    const l = await host.dispatch.act({ action: "screen.list" }, USER) as ScreenListed;
    const rows: BarRow[] = l.screens.filter(s => s.key !== "G" && s.key !== "E").map(s => ({ key: s.key, label: s.label, detail: `the menu's ${s.key}`, data: { name: s.key, about: s.about } }));
    for (const n of l.named) if (!rows.some(r => r.label.toLowerCase() === (n.title ?? n.name).toLowerCase())) rows.push({ key: `named:${n.name}`, label: n.title ?? n.name, detail: n.made ? "a screen you made" : "a screen", data: { name: n.name, about: n.made ? "a screen someone made and saved as a screen note (^W w)" : "" } });
    return filtered(rows, q, r => [r.label, r.detail ?? "", (r.data as { about: string }).about]);
  },
  preview: row => ({ markdown: `**${row.label}**\n\n${(row.data as { about: string }).about || "a screen"}\n\n⏎ opens it over this screen; q comes back.` }),
  pick(row, host, how) {
    const args = { name: (row.data as { name: string }).name };
    return how.actor.kind === "agent" ? host.dispatch.act({ action: "screen.open", args }, how.actor) : host.dispatch.press("screen.open", args);
  },
};

interface ExtRow { kind: "hub" | "page" | "install" | "remove" | "make" | "settings"; id: string; block?: string; demo?: "keep" | "remove"; notes?: number; about?: string; scripts?: { name: string; about: string }[] }

/** A description's first sentence: what an extension says it is, at a glance. */
const firstSentence = (text: string | undefined) => (text ?? "").replace(/\s+/g, " ").trim().match(/^.*?[.!?](?=\s|$)/)?.[0] ?? (text ?? "").trim();

/**
 * A row's words for an installed one, all its own (PIE-1284): a script's summary (its note's title, its extension's
 * about) or an extension's description, the first sentence; else a script file's name; else the first thing it adds.
 */
function summaryOf(e: ExtensionEntry, l: ExtensionList): string {
  const said = firstSentence(e.script ? e.summary : e.description);
  if (said) return said;
  if (e.script?.file) return `a script file, ${e.script.file.split("/").pop()}`;
  const part = extensionParts(e, l)[0];
  return part ? `${partKind(part.kind)} ${part.name}${part.about ? ` · ${firstSentence(part.about)}` : ""}` : "";
}

/** An installed extension as its preview reads it: its id and version, its state and settings, where it lives, its words, what it adds. */
function extensionFacts(e: ExtensionEntry, then: string): string {
  const parts = extensionParts(e);
  return [
    `**${e.name ?? e.id}** \`${e.id}\`${e.version !== undefined ? ` v${e.version}` : ""} · ${e.state}${e.settings ? ` · settings ${settingsChip(e.settings)}` : ""}`,
    ...(e.error ? ["", `> [!warning] ${e.error}`] : []), ...(e.script && e.summary ? ["", e.summary] : []), "", e.description ?? "",
    ...(parts.length ? ["", "It adds:", ...parts.map(p => `- ${partKind(p.kind)} **${p.name}**${p.about ? ` · ${p.about}` : ""}`)] : []),
    ...(e.directory ? ["", `\`${e.directory}\``] : []),
    // A copy of a built-in (PIE-1283): this copy runs, the built-in never does in place; both folders said.
    ...(e.builtIn ? ["", overrideWords(e.id, e.builtIn) ? `${overrideWords(e.id, e.builtIn)}: this copy runs; the built-in is \`${e.builtIn.directory}\`` : `installed from the built-in \`${e.builtIn.directory}\``] : []), "", then,
  ].join("\n");
}

/**
 * The outline's extensions (the service's `extensions.list`, as the extension binding last read it): the Extensions hub,
 * each installed extension's page (its README, what it adds, its demo notes), the repo's extensions not installed (⏎
 * installs one, `extensions.install`), and, once a name is typed, removing one (`extensions.uninstall`), keeping its demo
 * notes or not. `&` is the door's: an extension's bar source can't take it.
 */
const EXTENSIONS: BarSource = {
  id: "extensions", title: "extensions", prefix: "&", by: "door",
  about: "the outline's extensions: the Extensions hub, each installed one's page (⏎ opens it: its README, what it adds, its demo notes; its row says its settings: default, set, needs setup, failing), each one's settings (⏎ opens its form, drawn from its configSchema), the ones the repo has that aren't installed (⏎ installs one with its demo notes), and, with its name typed, removing one",
  main: { empty: false, typed: true, most: 4 },
  rows(q, host) {
    const l = extensionList();
    if (!l) return [];
    const rows: BarRow[] = [{ key: "make", label: "make your own", detail: "ep0ch-extend skill · ep0ch docs extensions", group: "make", oneLine: true, data: { kind: "make", id: "" } satisfies ExtRow }];
    // A script an extension ships is part of that extension's row, not one of its own (PIE-1283).
    const installed = l.extensions.filter(e => e.state !== "shadowed" && !e.partOf), all = installed.length + (l.available?.length ?? 0);
    if (l.hub) rows.push({ key: "hub", label: "Extensions", detail: `the hub · ${installed.length} of ${all} installed`, group: "installed", data: { kind: "hub", id: "", block: l.hub } satisfies ExtRow });
    // One line each, grouped under installed by what it adds first, that kind its chip (PIE-1284): the words are its own; the rest is the preview's.
    const kindOf = (e: ExtensionEntry) => extensionParts(e, l)[0]?.kind ?? "actions";
    for (const kind of PART_KINDS) {
      const these = installed.filter(e => kindOf(e) === kind);
      for (const e of these) rows.push({ key: `page:${e.id}`, label: e.name ?? e.id, detail: [e.state === "active" ? "" : e.state, e.builtIn ? overrideWords(e.id, e.builtIn) : "", e.settings ? settingsChip(e.settings) : "", summaryOf(e, l)].filter(Boolean).join(" · "), group: `installed · ${kind} · ${these.length}`, chip: partKind(kind), oneLine: true, ...(l.pages?.[e.id] ? {} : { refused: "its page isn't written yet" }), data: { kind: "page", id: e.id, ...(l.pages?.[e.id] ? { block: l.pages[e.id] } : {}), about: e.description } satisfies ExtRow });
    }
    // Its settings (PIE-1343): a row each, its chip the words; where config.json is, the preview's; ⏎ the form its configSchema draws.
    const configured = installed.filter(e => e.settings);
    for (const e of configured) rows.push({ key: `settings:${e.id}`, label: `settings ${e.name ?? e.id}`, detail: settingsChip(e.settings!), group: `settings · ${configured.length}`, oneLine: true, data: { kind: "settings", id: e.id } satisfies ExtRow });
    for (const a of l.available ?? []) rows.push({ key: `install:${a.id}`, label: `install ${a.name}`, detail: firstSentence(a.description), group: `not installed · ${l.available!.length}`, oneLine: true, data: { kind: "install", id: a.id, about: a.description, scripts: a.scripts } satisfies ExtRow });
    // Removing one is offered once its name is typed, both ways, so the demo notes never go by a stray ⏎.
    if (q.trim()) for (const e of installed) {
      const notes = l.demos?.[e.id] ?? 0, name = e.name ?? e.id;
      if (!notes) { rows.push({ key: `remove:${e.id}:keep`, label: `remove ${name}`, detail: e.id, group: "remove", data: { kind: "remove", id: e.id, demo: "keep" } satisfies ExtRow }); continue; }
      for (const demo of ["keep", "remove"] as const) rows.push({ key: `remove:${e.id}:${demo}`, label: `remove ${name}${demo === "keep" ? `, keep its ${notes} demo ${notes === 1 ? "note" : "notes"}` : ` and its ${notes} demo ${notes === 1 ? "note" : "notes"}`}`, detail: e.id, group: "remove", data: { kind: "remove", id: e.id, demo, notes } satisfies ExtRow });
    }
    const typed = !!q.trim();
    const hits = filtered(rows, q, r => [r.label, r.detail ?? "", (r.data as ExtRow).id]);
    return typed ? hits.map(({ group: _g, ...r }) => r) : hits;
  },
  preview(row) {
    const d = row.data as ExtRow;
    if (d.kind === "make") return { markdown: "To make the outline do something new (a button, a rule, a script, an extension), use the **ep0ch-extend** skill.\n\nFrom a shell: `ep0ch --skill ep0ch-extend`, then read that file.\n\nThe reference: `ep0ch docs extensions`. Over MCP: `ep0ch://skills/ep0ch-extend` and `ep0ch://docs/extensions`." };
    if (d.kind === "settings") {
      const e = extensionList()?.extensions.find(x => x.id === d.id && x.state !== "shadowed");
      return e?.settings ? { markdown: settingsMarkdown(e, e.settings) } : { lines: [`${d.id} has no settings now`] };
    }
    if (d.kind === "page") {
      const e = extensionList()?.extensions.find(x => x.id === d.id && x.state !== "shadowed");
      if (e) return { markdown: extensionFacts(e, d.block ? "⏎ opens its page: its README, what it adds, its demo notes." : "Its page isn't written yet.") };
    }
    if (d.block) return { note: d.block };
    if (d.kind === "install") {
      const a = extensionList()?.available?.find(x => x.id === d.id);
      return { markdown: [`**${row.label.replace(/^install /, "")}** \`${d.id}\`${a ? ` v${a.version}` : ""}`, "", d.about ?? "", "", ...(d.scripts ?? []).map(s => `Adds the script **${s.name}**: ${s.about}`), "", "⏎ installs it for every outline this host serves (`ep0ch ext add " + d.id + "`): its page goes under the outline's Extensions hub, with its README, what it adds and its demo notes."].join("\n") };
    }
    if (d.kind === "remove") return { markdown: [`**${row.label}**`, "", !d.notes ? "Its folder goes, and its lines and actions stop working. Its page goes with it." : d.demo === "keep" ? "Its folder goes, and its lines and actions stop working. Its demo notes stay under its page." : "Its folder goes, and its demo notes go to Trash: the ones nobody changed (the rest are kept, and named). Trash can restore them.", "", `The same from a shell: \`ep0ch ext remove ${d.id}${d.demo === "remove" ? " --demo remove" : ""}\``].join("\n") };
    return { lines: [row.label, "", row.refused ?? ""] };
  },
  async pick(row, host, how) {
    const d = row.data as ExtRow;
    if (row.refused) throw new ActionRefused(row.refused);
    if (d.kind === "make") {
      const message = "Use the ep0ch-extend skill: ep0ch --skill ep0ch-extend; reference: ep0ch docs extensions";
      host.ctx.flash(message);
      return { message };
    }
    if (d.kind === "settings") {
      // The form, its fields filled with what config.json has now (a secret's reference is shown, sent only when typed);
      // an agent's pick names no values, so it reads them.
      const e = extensionList()?.extensions.find(x => x.id === d.id && x.state !== "shadowed");
      if (!e?.settings) throw new ActionRefused(`${d.id} has no settings now`);
      const action = `ext.${d.id}.settings`;
      if (how.actor.kind === "agent") return host.dispatch.act({ action, args: {} }, how.actor);
      const now = Object.fromEntries([
        ...e.settings.fields.filter(f => f.value !== undefined).map(f => [f.name, shownValue(f, f.value)]),
        ...(e.settings.whole ? [["config", JSON.stringify(e.settings.config)]] : []),
      ]);
      return openActionForm(host, { action, args: now }, how.actor);
    }
    if (d.block) return openNote(d.block, host, how);
    const [action, args] = d.kind === "install" ? ["extensions.install", { id: d.id }] : ["extensions.uninstall", { id: d.id, demo: d.demo! }];
    return how.actor.kind === "agent" ? host.dispatch.act({ action, args }, how.actor) : host.dispatch.press(action, args);
  },
};

/** The door's own sources, in the order the bar's tabs show them. */
export const BUILT_IN_SOURCES = [TILES, NOTES, ACTIONS, RECENT, SCREENS, EXTENSIONS] as const;
for (const s of BUILT_IN_SOURCES) registerBarSource(s);


// The power bar's built-in sources (PIE-656), each a scope with its prefix: tiles (%), notes (/), actions (>),
// recent (+) and screens (@). None keeps a list of its own: tiles are the layout tree's (`Desk.tileOutline`) on every
// screen and in the drawer; notes are the service's one search (`board.search`, Goto's ranker, Jev re-ordering after
// a pause); actions are the dispatcher's (the focused tile's menu rows, then every action that needs no argument);
// recent is the what-changed store behind the status bar's `+N new`; screens are the shell's `screen.list`. A pick goes
// through the shared paths: the drawer's goTo, the `open` action, the dispatcher's press.
import { identityFields, noteLabel, withWorkId, type Msg } from "../board";
import { Desk } from "../desk/desk";
import { PtyPane } from "../desk/pty";
import { tileKinds } from "../desk/tile-kinds";
import { wCaption, type WRow } from "../desk/wkeys";
import { ScreenTile } from "../desk/screen-tile";
import { notConfigured, jevOff, SEARCH_JEV_PAUSE_MS } from "../surface/completer";
import { ActionRefused, declaredKeys, type ActionInfo } from "../surface/actions";
import { USER } from "../socket";
import { ago } from "../text";
import { matchesSearchText, prepareSearchQuery } from "@ep0ch/outline-core/search-match";
import type { Screen } from "../app";
import type { BarHost, BarRow, BarSource, PickHow } from "./source";
import { openNote, registerBarSource } from "./source";

/** The tiles a screen holds: a desk, or the desk inside it (the showcase's section). */
export function tilesOf(s: Screen | undefined): Desk | null { return s instanceof Desk ? s : s?.tilesHere?.() ?? null; }

/**
 * Rows kept whose fields match `q` (outline-core's matcher, as every filter over rows the door holds); those whose
 * label starts with what's typed, then holds it, come first, the rest keeping their order.
 */
function filtered(rows: BarRow[], q: string, fields: (r: BarRow) => string[]): BarRow[] {
  const query = prepareSearchQuery(q);
  if (!query) return rows;
  // No typo forgiveness over names and keys: a short tile name or action is matched as typed.
  const kept = rows.filter(r => matchesSearchText(query, fields(r), { typos: false })), t = q.trim().toLowerCase();
  const rank = (r: BarRow) => (r.label.toLowerCase().startsWith(t) ? 0 : r.label.toLowerCase().includes(t) ? 1 : 2);
  return kept.map((r, i) => ({ r, i, k: rank(r) })).sort((a, b) => a.k - b.k || a.i - b.i).map(x => x.r);
}

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
      key: `${at}:${path}`, label: t.showing ? `${path} · ${withWorkId(t.showing.workId, t.showing.title)}` : `${path} · ${t.title}`, depth: base + t.depth, group,
      mark: t.focused ? "●" : t.collapsed ? "▸" : t.float ? "⧉" : t.docked ? "⇤" : t.tab && !t.shown ? "⋯" : " ",
      detail: [t.kind, t.collapsed ? "a spine" : "", t.float ? "floating" : "", t.docked ? "docked" : "", t.tab && !t.shown ? "a tab behind" : "", mounts.length ? "in a mount" : ""].filter(Boolean).join(" · "),
      data: { desk, name: t.name, screen, drawer, shows: t.showing?.id ?? null, kind: t.kind, path, mounts, find: t.showing ? identityFields(t.showing.workId, t.showing.page, t.showing.title) : [] } satisfies TileAt,
    };
    const inner = p instanceof ScreenTile ? p.inner : null;
    return [row, ...(inner ? tileRows(inner, at, group, screen, drawer, base + t.depth + 1, `${path}/`, [...mounts, { desk, name: t.name }]) : [])];
  });
}

const TILES: BarSource = {
  id: "tiles", title: "tiles", prefix: "%", by: "door",
  about: "the tiles open on every screen and in your drawer, indented as each screen's layout tree, with the note each shows; ⏎ goes to one (a spine opens, its screen comes up), alt+⏎ zooms it",
  main: { empty: true, typed: true, most: 8 },
  rows(q, host) {
    const shown = host.screens().at(-1);
    const drawer = host.ctx.hostLayer?.desks().find(d => host.ctx.hostLayer!.isDrawer(d)) ?? null;
    const places: { desk: Desk; screen: Screen | null; group: string }[] = [];
    const add = (desk: Desk | null, screen: Screen | null, group: string) => { if (desk && !places.some(p => p.desk === desk)) places.push({ desk, screen, group }); };
    add(tilesOf(shown), shown ?? null, `${shown?.title ?? "this screen"} · here`);
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
    if (how.actor.kind === "agent") {
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
const noteRow = (m: Msg): BarRow => ({ key: m.id, label: noteLabel(m) });

/** How many notes `/` lists with nothing typed. */
const RECENT_NOTES = 30;
/**
 * `/` with nothing typed: the notes most recently changed first. The service's own recency list (an empty `tree.search`
 * with no note to be near: every live note by when it was last edited, the person's edits and others') merged with what
 * others changed since the person looked (the `+` scope's store, so a change the feed holds is never missing), newest first.
 */
async function recentNotes(host: BarHost): Promise<BarRow[]> {
  const found = new Map<string, { m: Msg; at: number; row: BarRow }>();
  for (const m of await host.ctx.board.search("", RECENT_NOTES)) found.set(m.id, { m, at: m.updatedAt, row: { ...noteRow(m), detail: `${m.author ?? "?"} · ${ago(m.updatedAt)} ago` } });
  for (const r of host.ctx.whatChanged?.list().slice(0, RECENT_NOTES) ?? []) {
    // A change newer than the search's snapshot of the note: read it again (a rename, a trash), never the old words.
    const seen = found.get(r.blockId)?.m, m = seen && seen.updatedAt >= r.at ? seen : await host.ctx.board.get(r.blockId).catch(() => null);
    if (!m || m.deleted) { found.delete(r.blockId); continue; }
    found.set(r.blockId, { m, at: Math.max(r.at, m.updatedAt), row: { ...noteRow(m), mark: r.seen ? " " : "+", detail: `${r.kind} by ${r.who} · ${ago(r.at)} ago` } });
  }
  return [...found.values()].sort((a, b) => b.at - a.at).slice(0, RECENT_NOTES).map(x => x.row);
}

const NOTES: BarSource = {
  id: "notes", title: "notes", prefix: "/", by: "door", asks: true,
  about: "the outline's notes by words (with nothing typed, the notes changed most recently, newest first): the service's one search (Goto's ranker, nearer notes first), re-ordered by Jev after a pause when it's set up; ⏎ opens one where opens land, alt+⏎ in a new detail",
  main: { empty: false, typed: true, most: 10 },
  async rows(q, host) {
    if (!q.trim()) return recentNotes(host);
    if (q.trim().length < 2) return [];
    return (await host.ctx.board.search(q.trim(), 30, { near: host.near() ?? undefined })).map(noteRow);
  },
  later(q, rows, host, alive) {
    const board = host.ctx.board;
    if (q.trim().length < 3 || rows.length < 2 || jevOff.has(board)) return null;
    // Asked only if the query is still the one typed after the pause, and the bar still open.
    return Bun.sleep(SEARCH_JEV_PAUSE_MS).then(() => (alive() ? board.search(q.trim(), 30, { semantic: true, near: host.near() ?? undefined }) : null)).then(h => {
      if (!h) return null;
      if (h.semantic && notConfigured(h.semantic)) jevOff.add(board);
      return h.semantic?.status === "ranked" ? { rows: h.map(noteRow), said: "jev ranked" } : null;
    }, () => null);
  },
  preview: row => ({ note: row.key }),
  pick: (row, host, how) => openNote(row.key, host, how),
};

/** An action's first plain key (not a gesture, not a chord), for its keycap. */
const firstKey = (keys: string | undefined) => [...declaredKeys(keys)].find(k => k !== "click" && k !== "drag" && k !== "wheel" && !k.includes(" "));
/** An action anyone can run with no arguments, from the bar (the bar's own aren't listed). */
const bare = (a: ActionInfo) => !a.name.startsWith("bar.") && Object.values(a.args).every(s => s.optional);

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
  try { for (const m of host.screens().at(-1)?.dispatch?.menu("focused", USER) ?? []) if (m.key && m.refused) refusals.set(m.key, m.refused); } catch { /* no menu here */ }
  const rows: BarRow[] = desk.wRows().map(r => ({
    key: `w:${r.key}`, label: r.label, detail: r.summary && r.summary !== r.label ? r.summary : r.action, keycap: r.chord, group: r.group,
    ...(refusals.get(r.chord) ? { refused: refusals.get(r.chord)! } : {}),
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

const ACTIONS: BarSource = {
  id: "actions", title: "actions", prefix: ">", by: "door",
  about: "what you can do here: the focused tile's menu (its ⋯), then every action of this screen and the door's that needs no argument, each with its key; ⏎ runs it as that key would",
  main: { empty: false, typed: true, most: 6 },
  rows(q, host) {
    const top = host.screens().at(-1);
    const w = W_QUERY.exec(q);
    if (w) { const desk = tilesOf(top); return desk ? wKeyRows(desk, w[1]!, host) : []; }
    const menu = (() => { try { return top?.dispatch?.menu("focused", USER) ?? []; } catch { return []; } })();
    const rows: BarRow[] = menu.map(m => ({ key: `menu:${m.action}:${JSON.stringify(m.args)}`, label: m.label, detail: `${m.group} · ${m.action}`, ...(m.key ? { keycap: m.key } : {}), ...(m.refused ? { refused: m.refused } : {}), data: { action: m.action, args: m.args, tile: m.tile, summary: "" } }));
    const seen = new Set(menu.map(m => m.action));
    for (const a of host.dispatch.list().actions) {
      if (seen.has(a.name) || !bare(a)) continue;
      seen.add(a.name);
      const k = firstKey(a.keys);
      rows.push({ key: a.name, label: a.name, detail: a.summary.split(/[.:;(]/)[0]!.slice(0, 80), ...(k ? { keycap: k } : {}), data: { action: a.name, args: {}, summary: a.summary, keys: a.keys } });
    }
    return filtered(rows, q, r => [r.label, r.detail ?? ""]);
  },
  preview(row, host) {
    const d = row.data as { action: string; summary?: string; keys?: string };
    const info = host.dispatch.list().actions.find(a => a.name === d.action);
    const args = Object.entries(info?.args ?? {});
    return { markdown: [`**${row.label}** \`${d.action}\``, "", info?.summary ?? d.summary ?? "", "", ...(info?.keys ?? d.keys ? [`Keys: ${info?.keys ?? d.keys}`] : []), ...(args.length ? ["", "Arguments:", ...args.map(([n, s]) => `- \`${n}\`${s.optional ? "" : " (needed)"}: ${s.about ?? s.type}`)] : []), ...(row.refused ? ["", `Not now: ${row.refused}`] : [])].join("\n") };
  },
  async pick(row, host, how) {
    if (row.refused) throw new ActionRefused(row.refused);
    const d = row.data as { action: string; args: Record<string, unknown>; tile?: string };
    const top = host.screens().at(-1);
    if (row.key.startsWith("w:")) return pickW(row, host, how);
    // A menu row runs in its tile on the screen's dispatcher, as its ⋯ menu runs it; the rest on the door's.
    const on = d.tile !== undefined && top?.dispatch ? top.dispatch : host.dispatch;
    return how.actor.kind === "agent" ? on.act({ action: d.action, args: d.args, ...(d.tile !== undefined ? { tile: d.tile } : {}) }, how.actor) : on.press(d.action, d.args, d.tile);
  },
};

/**
 * A ^W row picked: the person's presses its keys (the desk's own chord handler, so it is what ^W then the key does,
 * a key that waits for another leaves the desk waiting for it); an agent's runs the action it stands for, as itself,
 * and is told the action when the key is only a person's chord (a direction, a panel).
 */
async function pickW(row: BarRow, host: BarHost, how: PickHow): Promise<unknown> {
  const d = row.data as WData, desk = tilesOf(host.screens().at(-1));
  if (row.refused) throw new ActionRefused(row.refused);
  if (!desk) throw new ActionRefused("the screen shown has no ^W keys");
  if (how.actor.kind === "agent") {
    if (d.how !== "run") throw new ActionRefused(`^W ${d.chord} is the person's key chord; an agent runs ${d.action} with its arguments (ep0ch actions ${d.action})`);
    return host.screens().at(-1)!.dispatch!.act({ action: d.action, args: d.args, tile: "focused" }, how.actor);
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
    const rows = store.list().map((r): BarRow => ({ key: r.blockId, label: r.title === undefined ? "…" : withWorkId(r.workId, r.title), data: { find: identityFields(r.workId, r.page, r.title ?? "") }, mark: r.seen ? " " : "+", detail: `${r.kind} by ${r.who} · ${ago(r.at)} ago` }));
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

/** The door's own sources, in the order the bar's tabs show them. */
export const BUILT_IN_SOURCES = [TILES, NOTES, ACTIONS, RECENT, SCREENS] as const;
for (const s of BUILT_IN_SOURCES) registerBarSource(s);


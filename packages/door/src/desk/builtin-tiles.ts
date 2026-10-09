import { TUNE_ACTIONS, TunePane } from "./tune";
import { ch } from "../term";
// The built-in tile kinds (PIE-505), registered at startup in the registry an extension's kinds join
// (src/desk/tile-kinds.ts). Everything a kind does differently lives in its entry: how it's made, its keys
// under ^W o, its actions, what it holds and shows, how it starts, saves and describes itself. The desk asks
// the entry; it never asks which kind a tile is.
import { subject, type Msg } from "../board";
import { BACKLINKS_ACTIONS, BacklinksPane, linkGroupsFrom } from "./backlinks-pane";
import { ACTIVITY_ACTIONS, ActivityPane, ArtPane, READER_ACTIONS, ReaderPane, sessionName, TreePane, WHO_ACTIONS, WhoPane, type Pane } from "./panes";
import { ART_ACTIONS } from "../art-actions";
import { PreviewPane, sourceName, sourceOf } from "./preview";
import { PtyPane } from "./pty";
import { PTY_ACTIONS } from "./pty-actions";
import { mountKinds } from "./screen-tile";
import { laneTileName, QUERY_ACTIONS, QueryPane } from "./query";
import { HUB_SOURCE } from "./lanes";
import { riverColumnKind } from "../river/column";
import { kindOf, registerTileKind, registerTileSource, tileKind, tileSource, type TileKind } from "./tile-kinds";
import { DetailPane, dailyDraft, editor, shell } from "./tiles";
import { words } from "../text";
import { TREE_ACTIONS } from "./tree";
import { WAITING_YOU_KIND } from "./waiting-you";
import { WHAT_CHANGED_KIND } from "./what-changed";
import { recordFacts } from "./program-status";

/** A reader of any sort (reader, detail, preview): notes open into it, and an open edit is work. */
const reading: Pick<TileKind, "accepts" | "holdsWork" | "shows" | "view" | "take" | "describe"> = {
  accepts: { notes: true },
  // Its header's backdrop (PIE-598), when it draws one or the setting turned it off.
  describe: p => { const h = (p as ReaderPane).surface.headerBackdrop(); return h.backdrop || !h.on ? { header: h } : {}; },
  // A note opened into it is held, and kept in its history (PIE-453): back returns to what it showed.
  take: (p, m, desk) => {
    const r = p as ReaderPane;
    if (r.holdsKeys || r.editing) return `holds ${sessionName(r)}`;
    r.surface.track(() => r.hold(m, desk));
    return null;
  },
  holdsWork: p => (p as ReaderPane).unsaved() || (p as ReaderPane).editing,
  shows: p => (p as ReaderPane).msg,
  view: p => {
    const r = p as ReaderPane, m = r.msg, sel = r.surface.selection;
    return { viewport: { block: m?.id ?? null, title: m ? subject(m) : null, ...(r.surface.viewport() ?? {}) }, cursor: sel ? { selection: r.surface.describeSelection(sel) } : null };
  },
};
/** The note a tile shows or has selected, whatever its kind. */
/** A backlinks tile's saved groups, or every group (null) when they're left out or wrong (`check` says why). */
const linkGroupsOf = (spec: string | undefined) => { try { return linkGroupsFrom(spec); } catch { return null; } };
const groupsProblem = (spec: string | undefined): string | null => { try { linkGroupsFrom(spec); return null; } catch (e) { return (e as Error).message; } };
/** The tile a links tile lists the links of: its `tile:<name>` source, else the reader. */
const sourceTile = (spec: string | undefined) => { const src = spec && sourceOf(spec); return src && "tile" in src ? src.tile : "reader"; };
const showing = (p: Pane | undefined): Msg | null => (p ? kindOf(p)?.shows?.(p) ?? null : null);

/** The entries, made when they're registered (so a module cycle never meets them half-built). */
const builtins = (): TileKind[] => [
  {
    kind: "tree", previews: true, about: "the outline tree; ⏎ opens a note where its opens land", keys: [{ key: "t", label: "outline" }],
    make: () => new TreePane(), actions: TREE_ACTIONS,
    shows: p => (p as TreePane).selected(),
    view: p => { const m = (p as TreePane).selected(); return { viewport: { selected: m?.id ?? null, title: m ? subject(m) : null } }; },
    describe: (p, full) => (full ? { tree: (p as TreePane).describe() } : {}),
    // The outline as a screen shows it: open (on screen), pinned (in the layout, not in a dock), its side, and its rows when shown.
    peek: (p, desk) => { const open = desk.shownNow?.(p) ?? true; return { outline: { open, pinned: !desk.inDock?.(p), side: desk.sideOf?.(p) ?? "left", ...(open ? { rows: (p as TreePane).describe() } : {}) } }; },
  },
  { kind: "reader", about: "a reader that follows the current note", keys: [{ key: "r", label: "reader" }], make: s => { const r = new ReaderPane(true); if (s.nav) r.wantNav = s.nav; return r; }, ...reading, actions: READER_ACTIONS,
    // The note it showed when the layout was saved (a restart, a handover) is shown again, with its history (PIE-643), unless something is already there.
    start: (p, env) => {
      const r = p as ReaderPane, want = r.wantNote();
      // The outline's first selection may be shown first: the saved note replaces it, once, while the reader still wants it.
      if (want) env.desk.ctx.board.get(want).then(m => { if (m && r.wantNote() === want) { r.show(m, env.desk); env.desk.redraw(); } r.dropWant(); }, () => r.dropWant());
    },
  },
  {
    kind: "detail", about: "a reader that keeps its note (note=<id>, or page=<name> to pin [[name]])", keys: [{ key: "d", label: "detail" }],
    make: s => { const r = new DetailPane(); if (s.page) r.page = s.page; else if (s.note) r.want = s.note; if (s.label) r.label = s.label; if (s.nav) r.wantNav = s.nav; return r; },
    ...reading,
    start: (p, env) => {
      const d = p as DetailPane;
      if (d.page && !d.msg) {
        const page = d.page;
        env.desk.ctx.board.resolvePage(page).then(r => { if (r.status === "resolved" && r.block && !d.msg) { d.hold(r.block, env.desk); env.desk.redraw(); } }, () => {});
      }
      if (d.want && !d.msg) {
        const want = d.want;
        // A note the outline hasn't (purged, or the screen saved on another outline): the empty tile says so.
        env.desk.ctx.board.get(want).then(m => { if (m && !d.msg) d.hold(m, env.desk); else if (!m && !d.msg) d.missing = want; env.desk.redraw(); }, () => {});
      }
    },
  },
  {
    kind: "preview", about: "a reader following a tile's selection or a file (source=tile:<name> or file:<path>)",
    keys: [{ key: "p", label: "preview", spec: at => ({ source: `tile:${at.name}` }) }],
    make: s => { const p = new PreviewPane((s.source && sourceOf(s.source)) || (s.file ? { file: s.file } : { tile: "tree" })); if (s.label) p.label = s.label; return p; },
    ...reading,
    follower: true,
    // It follows the note sent to it, as it follows its source; back returns to what it showed (PIE-453).
    take: (p, m, desk) => { const pv = p as PreviewPane; if (pv.msg?.id !== m.id) pv.surface.track(() => pv.follow(m, desk)); return null; },
    save: p => { const pv = p as PreviewPane; return { ...pv.spec?.(), ...(pv.label ? { label: pv.label } : {}) }; },
    check: s => (s.source && !/^(tile|file):./.test(s.source) ? "a preview's source is tile:<name> or file:<path>" : null),
    defaults: (s, at) => (s.source ? {} : s.file ? { source: `file:${s.file}` } : { source: `tile:${at.name}` }),
    follows: p => { const s = (p as PreviewPane).source; return "tile" in s ? s.tile : null; },
    start: (p, env) => {
      const pv = p as PreviewPane;
      // Moved here whole, it keeps its note: a tile here that shares its source's name is another tile.
      if (!("tile" in pv.source) || env.moved) return;
      const src = env.tile(pv.source.tile);
      if (src instanceof PtyPane) pv.followFile(src.file, env.desk);
      const m = showing(src);
      if (m) pv.follow(m, env.desk);
    },
    describe: (p, full) => ({ ...reading.describe!(p, full), source: sourceName((p as PreviewPane).source) }),
  },
  {
    kind: "pty", about: "a program in a terminal (cmd=\"nvim draft.md\", file=<path it edits>, cwd=<folder>)", noun: "a terminal tile",
    keys: [
      { key: "e", label: "editor", spec: () => { const f = dailyDraft(); return { cmd: [...words(editor()), f], file: f, name: "editor" }; } },
      { key: "s", label: "shell" },
    ],
    make: s => { const p = new PtyPane({ cmd: s.cmd?.length ? s.cmd : [shell()], cwd: s.cwd, file: s.file, label: s.name }); if (typeof s.kept === "string" && s.kept) p.keptKey = s.kept; return p; },
    actions: PTY_ACTIONS,
    // ⏎ or e on a terminal the person isn't in, or a click in it while its program runs: they type in it.
    press: (p, k) => (k.kind === "mouse" ? ((p as PtyPane).running ? { action: "tile.enter" } : null) : k.kind === "enter" || ch(k) === "e" ? { action: "tile.enter" } : null),
    holdsWork: p => (p as PtyPane).running,
    whenFree: (p, then) => {
      const t = p as PtyPane, was = t.onExit;
      t.onExit = code => { was?.(code); then(); };
    },
    view: (p, mine) => {
      const t = p as PtyPane, nv = t.nvim?.view;
      return {
        // What its program says it's doing (OSC 7501): the live feed carries each change.
        viewport: { file: t.file ?? null, running: t.running, ...(nv ? { first: nv.top, last: nv.bottom } : {}), ...(t.status.records.size ? { status: t.status.records.list().map(recordFacts) } : {}) },
        // Only the focused terminal's cursor: another tile's (claude redrawing) would be noise in the feed.
        ...(mine ? { cursor: nv ? { file: nv.file, line: nv.line, col: nv.col, mode: nv.mode } : t.running ? { screen: t.cursor() } : null } : {}),
      };
    },
    start: (p, env) => {
      const t = p as PtyPane;
      // The program learns its tile's id (EP0CH_TILE_ID) as it starts, at the tile's first paint.
      t.tileId = env.id; t.tileName = env.name; t.place = env.place; t.home = env.home;
      // A terminal tile's view (nvim's buffer): previews following it show its file.
      t.onView = v => { for (const q of env.followers()) q.followFile?.(v.file, env.desk); };
    },
    describe: (p, full) => {
      const t = p as PtyPane;
      const status = t.status.records.size ? { status: t.status.records.list().map(recordFacts) } : {};
      return full ? { terminal: t.describe(), ...(t.herdr ? { herdr: t.herdr } : {}) } : { cmd: t.run.cmd, ...(t.socket ? { nvim: t.socket } : {}), ...(t.herdr ? { herdr: t.herdr } : {}), ...status };
    },
    previewSource: (p, name) => {
      const t = p as PtyPane;
      if (!t.file) throw new Error(`${name} runs ${t.run.cmd[0]} on no file; a preview follows the file an editor tile was opened on`);
      // nvim tells the door which buffer it's on, so the preview follows the tile; another editor, the file.
      return t.isNvim ? `tile:${name}` : `file:${t.file}`;
    },
  },
  // The thread tile is the links tile with Children alone (PIE-693): a layout saved with one gets that, and saves it so.
  { kind: "thread", about: "a links tile listing the children (replies) of what the reader shows: kind backlinks, linkGroups=children", make: s => new BacklinksPane(sourceTile(s.source), false, ["children"]), actions: BACKLINKS_ACTIONS },
  { kind: "activity", about: "recent edits by people and agents", keys: [{ key: "a", label: "activity" }], make: () => new ActivityPane(), actions: ACTIVITY_ACTIONS },
  { kind: "who", about: "who's attached to the outline", keys: [{ key: "w", label: "who" }], make: () => new WhoPane(), actions: WHO_ACTIONS },
  { kind: "art", about: "ANSI art from the packs", keys: [{ key: "b", label: "art" }], make: () => new ArtPane(), actions: ART_ACTIONS },
  // A screen mounted in a tile (PIE-651): any screen, a part of one, a group; the board and river by their older kinds.
  ...mountKinds(),
  {
    kind: "query", about: "the cards a saved view lists (view=<the virtual branch's block id>); a board lane is one",
    // ^W o q on a tile showing a saved view (the outline's row on a lane's block): a tile of its cards.
    keys: [{ key: "q", label: "query", spec: at => { const m = showing(at.pane); return m && (m.props.type ?? "").toLowerCase() === "virtual-branch" ? { view: m.id, name: laneTileName(subject(m)) } : {}; } }],
    make: s => new QueryPane(s.view ?? ""), actions: QUERY_ACTIONS,
    save: p => (p as QueryPane).spec(),
    check: s => (s.view ? null : "a query tile needs view=<a saved view's block id> (^W o q picks one)"),
    // The outline's saved views (virtual branches), newest first: ^W o q and the blank tile's Q pick one.
    choices: async desk => {
      const views = await desk.ctx.board.query("type=virtual-branch", 200);
      return { title: "a query lane: which saved view's cards", items: views.map(v => ({ label: subject(v), spec: { view: v.id, name: laneTileName(subject(v)) } })) };
    },
    shows: p => (p as QueryPane).card() ?? null,
    view: p => { const q = p as QueryPane, m = q.card(); return { viewport: { view: q.view, lane: q.name, selected: m?.id ?? null, title: m ? subject(m) : null } }; },
    describe: p => (p as QueryPane).describe(),
  },
  {
    kind: "tune", about: "the tune inspector on another tile (source=tile:<name>): its look's spacing, list, surface and frame values, where each comes from, nudged, taken back and saved (PIE-673, PIE-675)",
    keys: [{ key: "y", label: "tune", spec: at => ({ source: `tile:${at.name}` }) }],
    make: s => { const src = s.source && sourceOf(s.source); return new TunePane(src && "tile" in src ? src.tile : "reader"); },
    actions: TUNE_ACTIONS,
    check: s => (s.source && !/^tile:./.test(s.source) ? "a tune tile's source is tile:<name>" : null),
    defaults: (s, at) => (s.source ? {} : { source: `tile:${at.name}` }),
    describe: (p, full) => ({ source: `tile:${(p as TunePane).source}`, ...(full ? { tune: (p as TunePane).describe() } : {}) }),
    peek: (p, desk) => ({ tune: (p as TunePane).describe(desk) }),
  },
  {
    kind: "backlinks", about: "the links of what another tile shows (source=tile:<name>): its outlinks, resources, backlinks and children (linkGroups= names some)",
    aim: p => p as BacklinksPane, companion: "preview", previews: true,
    // A selection previews (a preview tile follows it), ⏎ opens: in the reader it lists the links of, or the tile linked to it as a target (PIE-646).
    linkRole: "target", origin: p => (p as BacklinksPane).source,
    keys: [{ key: "l", label: "backlinks", spec: at => ({ source: `tile:${at.name}` }) }, { key: "h", label: "children", spec: at => ({ source: `tile:${at.name}`, linkGroups: "children" }) }],
    make: s => new BacklinksPane(sourceTile(s.source), s.groups === "open", linkGroupsOf(s.linkGroups)),
    actions: BACKLINKS_ACTIONS,
    check: s => (s.source && !/^tile:./.test(s.source) ? "a backlinks tile's source is tile:<name>" : groupsProblem(s.linkGroups)),
    defaults: (s, at) => (s.source ? {} : { source: `tile:${at.name}` }),
    describe: (p, full) => ({ source: `tile:${(p as BacklinksPane).source}`, ...(full ? { backlinks: (p as BacklinksPane).describe() } : {}) }),
    // The backlinks as the screen shows them: what they list and from which tile, while they're on screen and aimed.
    peek: (p, desk) => { const L = p as BacklinksPane; return { backlinks: (desk.shownNow?.(p) ?? true) && L.target ? { from: L.source, pinned: !desk.inDock?.(p), ...L.describe() } : null }; },
  },
];

/** Register the built-ins (once: the desk's module and a test's both ask), and the hub source the board's lanes come from. */
export function registerBuiltinTiles(): void {
  for (const k of [...builtins(), riverColumnKind(), WAITING_YOU_KIND, WHAT_CHANGED_KIND]) if (!tileKind(k.kind)) registerTileKind(k);
  if (!tileSource(`${HUB_SOURCE.name}:`)) registerTileSource(HUB_SOURCE);
}

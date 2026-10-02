// The built-in tile kinds (PIE-505), registered at startup in the registry an extension's kinds join
// (src/desk/tile-kinds.ts). Everything a kind does differently lives in its entry: how it's made, its keys
// under ^W o, its actions, what it holds and shows, how it starts, saves and describes itself. The desk asks
// the entry; it never asks which kind a tile is.
import { subject, type Msg } from "../board";
import { BACKLINKS_ACTIONS, BacklinksPane } from "./backlinks-pane";
import { ACTIVITY_ACTIONS, ActivityPane, ArtPane, READER_ACTIONS, ReaderPane, sessionName, THREAD_ACTIONS, ThreadPane, TreePane, WhoPane, type Pane } from "./panes";
import { ART_ACTIONS } from "../art-actions";
import { WHO_ACTIONS } from "../who-actions";
import { PreviewPane, sourceName, sourceOf } from "./preview";
import { PtyPane } from "./pty";
import { PTY_ACTIONS } from "./pty-actions";
import { ScreenTile, type ScreenKind } from "./screen-tile";
import { HUB_SOURCE, laneTileName, QUERY_ACTIONS, QueryPane } from "./query";
import { kindOf, registerTileKind, registerTileSource, tileKind, tileSource, type TileKind } from "./tile-kinds";
import { DetailPane, dailyDraft, editor, shell, words } from "./tiles";
import { TREE_ACTIONS } from "./tree";

/** A reader of any sort (reader, detail, preview): notes open into it, and an open edit is work. */
const reading: Pick<TileKind, "accepts" | "holdsWork" | "shows" | "view" | "take"> = {
  accepts: { notes: true },
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
/** A whole screen in a tile: its card is what it shows; a draft in it is work. */
const screen = (kind: ScreenKind, key: string, about: string): TileKind => ({
  kind, about, keys: [{ key, label: kind }],
  make: s => new ScreenTile(kind, { preview: s.preview }),
  // A whole screen keeps its own keys while it's in an edit, answers its own actions (the board's card.*) and animates.
  takesKeys: p => (p as ScreenTile).holdsKeys(),
  dispatcher: p => (p as ScreenTile).screen?.dispatch ?? null,
  tick: p => (p as ScreenTile).tick(),
  holdsWork: p => (p as ScreenTile).unsaved(),
  shows: p => (p as ScreenTile).current(),
  view: p => { const t = p as ScreenTile, m = t.current(); return { viewport: { screen: t.screen?.title ?? null, selected: m?.id ?? null } }; },
});
/** The note a tile shows or has selected, whatever its kind. */
const showing = (p: Pane | undefined): Msg | null => (p ? kindOf(p)?.shows?.(p) ?? null : null);

/** The entries, made when they're registered (so a module cycle never meets them half-built). */
const builtins = (): TileKind[] => [
  {
    kind: "tree", about: "the outline tree; ⏎ opens a note where its opens land", keys: [{ key: "t", label: "outline" }],
    make: () => new TreePane(), actions: TREE_ACTIONS,
    shows: p => (p as TreePane).selected(),
    view: p => { const m = (p as TreePane).selected(); return { viewport: { selected: m?.id ?? null, title: m ? subject(m) : null } }; },
    describe: (p, full) => (full ? { tree: (p as TreePane).describe() } : {}),
  },
  { kind: "reader", about: "a reader that follows the current note", keys: [{ key: "r", label: "reader" }], make: () => new ReaderPane(true), ...reading, actions: READER_ACTIONS },
  {
    kind: "detail", about: "a reader that keeps its note (note=<id>, or page=<name> to pin [[name]])", keys: [{ key: "d", label: "detail" }],
    make: s => { const r = new DetailPane(); if (s.page) r.page = s.page; else if (s.note) r.want = s.note; return r; },
    ...reading,
    start: (p, env) => {
      const d = p as DetailPane;
      if (d.page && !d.msg) {
        const page = d.page;
        env.desk.ctx.board.resolvePage(page).then(r => { if (r.status === "resolved" && r.block && !d.msg) { d.hold(r.block, env.desk); env.desk.redraw(); } }, () => {});
      }
      if (d.want && !d.msg) {
        const want = d.want;
        env.desk.ctx.board.get(want).then(m => { if (m && !d.msg) { d.hold(m, env.desk); env.desk.redraw(); } }, () => {});
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
      if (!("tile" in pv.source)) return;
      const src = env.tile(pv.source.tile);
      if (src instanceof PtyPane) pv.followFile(src.file, env.desk);
      const m = showing(src);
      if (m) pv.follow(m, env.desk);
    },
    describe: p => ({ source: sourceName((p as PreviewPane).source) }),
  },
  {
    kind: "pty", about: "a program in a terminal (cmd=\"nvim draft.md\", file=<path it edits>, cwd=<folder>)", noun: "a terminal tile",
    keys: [
      { key: "e", label: "editor", spec: () => { const f = dailyDraft(); return { cmd: [...words(editor()), f], file: f, name: "editor" }; } },
      { key: "s", label: "shell" },
    ],
    make: s => new PtyPane({ cmd: s.cmd?.length ? s.cmd : [shell()], cwd: s.cwd, file: s.file, label: s.name }),
    actions: PTY_ACTIONS,
    // ⏎ or e on a terminal the person isn't in, or a click in it while its program runs: they type in it.
    press: (p, k) => (k.kind === "mouse" ? ((p as PtyPane).running ? { action: "tile.enter" } : null) : k.kind === "enter" || (k.kind === "char" && !k.ctrl && k.ch === "e") ? { action: "tile.enter" } : null),
    holdsWork: p => (p as PtyPane).running,
    whenFree: (p, then) => {
      const t = p as PtyPane, was = t.onExit;
      t.onExit = code => { was?.(code); then(); };
    },
    view: (p, mine) => {
      const t = p as PtyPane, nv = t.nvim?.view;
      return {
        viewport: { file: t.file ?? null, running: t.running, ...(nv ? { first: nv.top, last: nv.bottom } : {}) },
        // Only the focused terminal's cursor: another tile's (claude redrawing) would be noise in the feed.
        ...(mine ? { cursor: nv ? { file: nv.file, line: nv.line, col: nv.col, mode: nv.mode } : t.running ? { screen: t.cursor() } : null } : {}),
      };
    },
    start: (p, env) => {
      const t = p as PtyPane;
      // The program learns its tile's id (EP0CH_TILE_ID) as it starts, at the tile's first paint.
      t.tileId = env.id; t.tileName = env.name; t.place = env.place;
      // A terminal tile's view (nvim's buffer): previews following it show its file.
      t.onView = v => { for (const q of env.followers()) q.followFile?.(v.file, env.desk); };
    },
    describe: (p, full) => {
      const t = p as PtyPane;
      return full ? { terminal: t.describe(), ...(t.herdr ? { herdr: t.herdr } : {}) } : { cmd: t.run.cmd, ...(t.socket ? { nvim: t.socket } : {}), ...(t.herdr ? { herdr: t.herdr } : {}) };
    },
    previewSource: (p, name) => {
      const t = p as PtyPane;
      if (!t.file) throw new Error(`${name} runs ${t.run.cmd[0]} on no file; a preview follows the file an editor tile was opened on`);
      // nvim tells the door which buffer it's on, so the preview follows the tile; another editor, the file.
      return t.isNvim ? `tile:${name}` : `file:${t.file}`;
    },
  },
  { kind: "thread", about: "the current note's children", keys: [{ key: "h", label: "thread" }], make: () => new ThreadPane(), actions: THREAD_ACTIONS },
  { kind: "activity", about: "recent edits by people and agents", keys: [{ key: "a", label: "activity" }], make: () => new ActivityPane(), actions: ACTIVITY_ACTIONS },
  { kind: "who", about: "who's attached to the outline", keys: [{ key: "w", label: "who" }], make: () => new WhoPane(), actions: WHO_ACTIONS },
  { kind: "art", about: "ANSI art from the packs", keys: [{ key: "b", label: "art" }], make: () => new ArtPane(), actions: ART_ACTIONS },
  {
    ...screen("board", "k", "the kanban board as a tile; tile.preview gives its card to a preview tile"),
    // The board's own preview strip gives its place to the preview tile (collapsed to a spine, as its `c` does).
    previewSource: async (p, name, actor) => { await (p as ScreenTile).ownPreview(false, actor); return `tile:${name}`; },
  },
  screen("river", "v", "the river (Quay) as a tile, its columns and open rule its own"),
  {
    kind: "query", about: "the cards a saved view lists (view=<the virtual branch's block id>); a board lane is one",
    // ^W o q on a tile showing a saved view (the outline's row on a lane's block): a tile of its cards.
    keys: [{ key: "q", label: "query", spec: at => { const m = showing(at.pane); return m && (m.props.type ?? "").toLowerCase() === "virtual-branch" ? { view: m.id, name: laneTileName(subject(m)) } : {}; } }],
    make: s => new QueryPane(s.view ?? ""), actions: QUERY_ACTIONS,
    save: p => (p as QueryPane).spec(),
    check: s => (s.view ? null : "a query tile needs view=<a saved view's block id> (^W o q on a tile showing a view, say the outline's row on it)"),
    shows: p => (p as QueryPane).card() ?? null,
    view: p => { const q = p as QueryPane, m = q.card(); return { viewport: { view: q.view, lane: q.name, selected: m?.id ?? null, title: m ? subject(m) : null } }; },
    describe: p => (p as QueryPane).describe(),
  },
  {
    kind: "backlinks", about: "the backlinks of what another tile shows (source=tile:<name>)",
    keys: [{ key: "l", label: "backlinks", spec: at => ({ source: `tile:${at.name}` }) }],
    make: s => { const src = s.source && sourceOf(s.source); return new BacklinksPane(src && "tile" in src ? src.tile : "reader", s.groups === "open"); },
    actions: BACKLINKS_ACTIONS,
    check: s => (s.source && !/^tile:./.test(s.source) ? "a backlinks tile's source is tile:<name>" : null),
    defaults: (s, at) => (s.source ? {} : { source: `tile:${at.name}` }),
    describe: (p, full) => ({ source: `tile:${(p as BacklinksPane).source}`, ...(full ? { backlinks: (p as BacklinksPane).describe() } : {}) }),
  },
];

/** Register the built-ins (once: the desk's module and a test's both ask), and the hub source the board's lanes come from. */
export function registerBuiltinTiles(): void {
  for (const k of builtins()) if (!tileKind(k.kind)) registerTileKind(k);
  if (!tileSource(`${HUB_SOURCE.name}:`)) registerTileSource(HUB_SOURCE);
}

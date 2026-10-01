// The built-in tile kinds (PIE-505), registered at startup in the registry an extension's kinds join
// (src/desk/tile-kinds.ts). Everything a kind does differently lives in its entry: how it's made, its keys
// under ^W o, its actions, what it holds and shows, how it starts, saves and describes itself. The desk asks
// the entry; it never asks which kind a tile is.
import { subject, type Msg } from "../board";
import { BACKLINKS_ACTIONS, BacklinksPane } from "./backlinks-pane";
import { ActivityPane, ArtPane, ReaderPane, ThreadPane, TreePane, WhoPane, type Pane } from "./panes";
import { PreviewPane, sourceName, sourceOf } from "./preview";
import { PtyPane } from "./pty";
import { ScreenTile, type ScreenKind } from "./screen-tile";
import { kindOf, registerTileKind, tileKind, type TileKind } from "./tile-kinds";
import { DetailPane, dailyDraft, editor, sharedAgent, shell, words } from "./tiles";
import { TREE_ACTIONS } from "./tree";

/** A reader of any sort (reader, detail, preview): notes open into it, and an open edit is work. */
const reading: Pick<TileKind, "accepts" | "holdsWork" | "shows" | "view"> = {
  accepts: { notes: true },
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
  { kind: "reader", about: "a reader that follows the current note", keys: [{ key: "r", label: "reader" }], make: () => new ReaderPane(true), ...reading },
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
    make: s => new PreviewPane((s.source && sourceOf(s.source)) || (s.file ? { file: s.file } : { tile: "tree" })),
    ...reading,
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
    kind: "pty", about: "a program in a terminal (cmd=\"nvim draft.md\", file=<path it edits>, cwd=<folder>)",
    keys: [
      { key: "e", label: "editor", spec: () => { const f = dailyDraft(); return { cmd: [...words(editor()), f], file: f, name: "editor" }; } },
      { key: "s", label: "shell" },
    ],
    make: s => {
      const shared = s.agent ? sharedAgent()?.paneFor(s) : null;
      return shared ?? new PtyPane({ cmd: s.cmd?.length ? s.cmd : [shell()], cwd: s.cwd, file: s.file, label: s.name, ...(s.agent ? { agent: true } : {}) });
    },
    holdsWork: p => (p as PtyPane).running,
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
  { kind: "thread", about: "the current note's children", keys: [{ key: "h", label: "thread" }], make: () => new ThreadPane() },
  { kind: "activity", about: "recent edits by people and agents", keys: [{ key: "a", label: "activity" }], make: () => new ActivityPane() },
  { kind: "who", about: "who's attached to the outline", keys: [{ key: "w", label: "who" }], make: () => new WhoPane() },
  { kind: "art", about: "ANSI art from the packs", keys: [{ key: "b", label: "art" }], make: () => new ArtPane() },
  {
    ...screen("board", "k", "the kanban board as a tile; tile.preview gives its card to a preview tile"),
    // The board's own preview strip gives its place to the preview tile (collapsed to a spine, as its `c` does).
    previewSource: async (p, name, actor) => { await (p as ScreenTile).ownPreview(false, actor); return `tile:${name}`; },
  },
  screen("river", "v", "the river (Quay) as a tile, its columns and open rule its own"),
  screen("brief", "f", "the brief as a tile"),
  {
    kind: "backlinks", about: "the backlinks of what another tile shows (source=tile:<name>)",
    keys: [{ key: "l", label: "backlinks", spec: at => ({ source: `tile:${at.name}` }) }],
    make: s => { const src = s.source && sourceOf(s.source); return new BacklinksPane(src && "tile" in src ? src.tile : "reader"); },
    actions: BACKLINKS_ACTIONS,
    check: s => (s.source && !/^tile:./.test(s.source) ? "a backlinks tile's source is tile:<name>" : null),
    defaults: (s, at) => (s.source ? {} : { source: `tile:${at.name}` }),
    describe: (p, full) => ({ source: `tile:${(p as BacklinksPane).source}`, ...(full ? { backlinks: (p as BacklinksPane).describe() } : {}) }),
  },
];

/** Register the built-ins (once: the desk's module and a test's both ask). */
export function registerBuiltinTiles(): void {
  for (const k of builtins()) if (!tileKind(k.kind)) registerTileKind(k);
}

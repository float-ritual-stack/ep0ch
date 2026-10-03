// The showcase (PIE-439): every shared door part, live, on the seeded showcase outline. One section per
// row of the reuse map (docs/UI-GRAMMAR.md "Before adding a feature"), in the map's order; each is drawn
// by the part itself, hosted on a desk of its own spec or the real board, never a copy. A parallel version still
// in the code is shown beside the shared one and labelled, until consolidation removes it.
//
// It only runs on an outline the showcase seed wrote (src/showcase/seed.ts): `scripts/try-it.sh --showcase`
// starts one. On any other outline it says so and writes nothing.
import { shellKeyOf } from "../shell-keys";
import type { Ctx, Frame, Screen } from "../app";
import type { Msg } from "../board";
import { subject } from "../board";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, describeBacklinkView } from "../backlinks";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { Actor, OutlineEvent } from "../socket";
import { C, fg, pad, paint, RESET, selected } from "../style";
import { wrap } from "../text";
import { ch, isUp, isDown, type Key } from "../term";
import { ActionRefused, actionSet, def, type ActionInfo, type ActRequest } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { screenKeys } from "../whereabouts";
import { NOTE_ACTIONS } from "../surface/note";
import { DRAFT_ACTIONS } from "../edit";
import { Desk, DESK_ACTIONS } from "../desk/desk";
import { openScreen } from "../desk/screen-specs";
import { autoName, serializeTree } from "../desk/screen-layout";
import type { SavedTree, TileSpec } from "../desk/tiles";
import { TILE_ACTIONS } from "../desk/tile-actions";
import { PANE_ACTIONS } from "../desk/pane-actions";
import { BOARD_ACTIONS } from "../desk/lanes";
import { boardScreen } from "../desk/screen-specs";
import { COLUMN_ACTIONS } from "../river/column";
import { ActivityPane, ReaderPane, ThreadPane, TreePane, WhoPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import { MessageReader, SHELL_ACTIONS } from "../screens";
import { columnsOf, leaf, pair, splitOf, type LNode } from "../desk/screen-layout";
import { FramedScreen } from "./frame";
import { PreviewPane } from "../desk/preview";
import { PtyPane } from "../desk/pty";
import { serviceKind, tileKinds } from "../desk/tile-kinds";
import { extensionList } from "../extensions";
import { ScreenTile } from "../desk/screen-tile";
import { servingSession } from "../session/session-term";
import { loadShowcase, SEED, type SeedName } from "./seed";
import { PROPERTY_GRAMMAR_VERSION } from "../vendor/property-grammar";
import { RowView } from "../scroll";

type Notes = Partial<Record<SeedName, Msg>>;

/** One reuse-map row: what a feature needs, the part to use and where it lives, and how it's shown. */
export interface Section {
  /** The act name: `ep0ch-door act section name=<key>`. */
  key: string;
  need: string;
  part: string;
  files: string;
  /** A parallel version that can't be framed on its own, named here instead. */
  aside?: string;
  stage(n: Notes, show: Shower): Screen;
}
/** Put a note in a reader once its desk is open (readers on a stage keep their own notes). */
type Shower = (after: (ctx: Ctx) => void) => void;

/** Two panes side by side, the first `ratio` of the width. */
const row = (ratio: number, a: number, b: number): LNode => pair("row", ratio, leaf(a), leaf(b));

/** A stage: its tiles (made here, the exhibits), how they're laid out by their place (default side by side), its title. */
interface Stage { title: string; panes: Pane[]; layout?: (ids: number[]) => LNode }
/**
 * A stage as a screen spec (PIE-515) on the desk, its tiles given (the showcase makes its own exhibits): each named by
 * its kind (reader, reader2), laid out as the stage says.
 */
function stageDesk(st: Stage): Desk {
  const names = new Map<number, string>();
  st.panes.forEach((p, i) => names.set(i, autoName({ names }, p.kind)));
  const ids = st.panes.map((_, i) => i);
  const tree = st.layout ? st.layout(ids) : ids.slice(1).reduce<LNode>((a, id) => pair("row", 0.5, a, leaf(id)), leaf(0));
  const root = serializeTree(tree, (i: number): TileSpec => ({ t: "leaf", kind: st.panes[i]!.kind, name: names.get(i)! })) as SavedTree;
  return new Desk({ name: "showcase", title: st.title, layout: { root, focus: names.get(0) } }, { given: new Map(st.panes.map((p, i) => [names.get(i)!, p])) });
}
/** A stage whose readers show `notes` (one each, in order) once it opens. */
function deskOf(st: Stage, show: Shower, readers: [ReaderPane, Msg | undefined][], then?: (d: Desk) => void): Desk {
  const d = stageDesk(st);
  show(() => {
    for (const [r, m] of readers) if (m) r.show(m, d);
    then?.(d);
  });
  return d;
}

export const SECTIONS: Section[] = [
  {
    key: "note", need: "render or read a note", part: "NoteSurface, hosted through SurfaceHost (a ReaderPane; the BBS message reader)", files: "src/surface/note.ts, src/doc.ts, src/literal.ts, src/inline.ts, src/components.ts",
    aside: "the notebook's embeds read quietly: a dim, clickable » source line and a dim bar (src/embeds.ts); only a problem heading stays loud",
    stage(n, show) {
      const r = new ReaderPane();
      // The BBS message reader hosts the same surface (PIE-426): its header, the surface's body and keys.
      const bbs = new ScreenTile("exhibit", {}, { label: "the same NoteSurface in the BBS message reader · src/screens.ts", make: m => (m ? new MessageReader([m], 0) : null) });
      return deskOf({ title: "showcase · note", panes: [r, bbs], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "actions", need: "let a person or agent do anything", part: "the action registry: ActionDef in an ActionSet; keys and `act` call it", files: "src/surface/actions.ts, src/control.ts",
    stage(n, show) {
      const r = new ReaderPane();
      const list = new ActionsPane();
      const d = deskOf({ title: "showcase · actions", panes: [list, r], layout: ([a, b]) => row(0.55, a!, b!) }, show, [[r, n.whiteboard]]);
      list.run = (name, actor) => d.dispatch.act({ action: name, tile: "2" }, actor);
      return d;
    },
  },
  {
    key: "edit", need: "edit text, complete [[ (( [file::", part: "the editing component: Draft, edit control, completer, DRAFT_ACTIONS (lists, wrap, mouse, preview, unsent); the property panel (i, I)", files: "src/edit.ts, src/surface/editor.ts, src/surface/completer.ts, src/surface/props-panel.ts",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · edit", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.whiteboard], [b, n.notebook]], () => b.surface.openPanel(false));
    },
  },
  {
    key: "drafts", need: "write a draft somewhere: a note's text, a comment or reply, a new card", part: "the draft session (DraftSession): open with what was put aside, the hold, key and leave, submit, stale refusal, recordAs and the agent rule, behind three target adapters (blockTarget, commentTarget, cardTarget)", files: "src/draft-session.ts, src/comment.ts, src/desk/delivery.ts",
    aside: "the left reader is in an edit (a block's draft, held on the service), the right one writing a comment: click away from either and it's saved or kept as unsent the same way; the board's composer (n, N) is the third adapter",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · drafts", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.whiteboard], [b, n.notebook]], d => {
        // The person's own keys would do these: through the stage's dispatcher, in each reader's tile.
        void d.press(a, NOTE_ACTIONS, "edit");
        void d.press(b, NOTE_ACTIONS, "passage.select").then(() => d.press(b, NOTE_ACTIONS, "comment.write", { body: "" }));
      });
    },
  },
  {
    key: "panes", need: "open, split, zoom, close tiles; drawers; lock a shape", part: "the layout tree: tiles in containers (splits, tab sets, drawers, columns) with a policy each, floats and spines, one engine for the desk and the screens built on it, the board a preset (^W then o x z s HJKL < > + -, p a drawer, c a spine, f a float, P the policy; alt+k locks; the board's x o T B { } < >); tile.* layout.* actions (pane.* their older names); tile kinds from one registry", files: "src/desk/layout.ts, src/desk/drop.ts, src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/pane-actions.ts, src/desk/panes.ts, src/desk/desk.ts",
    aside: "the board (section 5) and the river are screen specs on this engine (PIE-511, PIE-515): the river's columns are a flow",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = new ThreadPane(), act = new ActivityPane();
      // The thread and the activity panes are one tab set (PIE-413): drag a header onto another to make one.
      // The outline is in a drawer on the left (PIE-505): it slides shut when the keys leave it, and its handle
      // on the hint row opens it again; a header dropped on the handle goes into it.
      return deskOf({
        title: "showcase · panes", panes: [tree, r, th, act],
        layout: ([t, rd, h, a]) => pair("row", 0.24, { t: "drawer", kid: leaf(t!), edge: "left", open: true }, pair("row", 0.62, leaf(rd!), { t: "tabs", ids: [h!, a!], active: 0 })),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook, { reveal: true }); });
    },
  },
  {
    key: "screens", need: "make a screen (the welcome, the brief, Waiting, a pinned page, the desk itself)", part: "a screen spec on the desk, the only screen host: containers and tiles by kind, a key map naming actions, a hint, a band, where opens land (ScreenSpec; specData and readSpec, screen.spec); what it does beyond layout is its tiles' kinds'", files: "src/desk/screen-spec.ts, src/desk/screen-specs.ts, src/brief/brief.ts",
    aside: "the brief here is its spec: one tile of the brief kind, which knows the briefs and steps them (, .); `act screen.spec` reads it as the data a note would hold",
    stage: () => openScreen("brief"),
  },
  {
    key: "kinds", need: "add a kind of tile (a built-in, or an extension's whole tile); fill a container from data", part: "the tile-kind registry: registerTileKind, one TileKind entry per kind (make, keys, actions, policy, accepts, save); serviceKind for a tile the service draws; a tile source fills columns (hub:<id>, one query tile per view)", files: "src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/query.ts",
    aside: "the left tile is a service-drawn kind (ServiceTile) whose rows are the registry itself; an extension's kind (PIE-507) registers the same way, its rows from the service. Over the reader, columns filled from the house board's hub: a query tile per view, as the board's lanes are",
    stage(n, show) {
      // The registry listed by a tile drawn the way an extension's is: its render answers rows, the door draws them.
      const list = serviceKind({
        kind: "showcase.kinds", about: "the registry, listed",
        render: async req => ({
          title: "tile kinds",
          lines: tileKinds().flatMap(k => [`${fg(C.lcyan)}${k.kind}${RESET}${k.keys?.length ? ` ${fg(C.dark)}^W o ${k.keys.map(x => x.key).join(" ")}${RESET}` : ""}`, `  ${fg(C.grey)}${k.about}${RESET}`.slice(0, req.cols + 20)]),
        }),
      }).make({ kind: "showcase.kinds" });
      const r = new ReaderPane();
      // The hub's views as query tiles: a columns container its tile source (hub:<id>) fills, as the board's lanes.
      const lanes = n.hub ? [columnsOf<number>([], { key: "lanes", source: `hub:${n.hub.id}` })] : [];
      return deskOf({ title: "showcase · kinds", panes: [list, r], layout: ([a, b]) => pair("row", 0.4, leaf(a!), lanes.length ? splitOf("col", [...lanes, leaf(b!)], [0.45, 0.55]) : leaf(b!)) }, show, [[r, n.notebook]]);
    },
  },
  {
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; ctrl+e edits a draft in one", files: "src/desk/pty.ts, src/surface/editor.ts",
    aside: "the agent drawer (src/dock.ts, PIE-498): the App's one agent tile, the host layer's first tab, pulled up over (or beside) any screen, this one too, by alt+a or a click on the status bar's ▲ chip; ctrl+] gives the keys back, alt+A or its top edge sizes it (host.toggle, host.size) · where a program runs: EP0CH_NEST, ep0ch where",
    stage(n, show) {
      const term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: sh in a pty the door owns'; exec sh"], label: "shell" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · terminal", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "preview", need: "follow a tile's selection or a file in a reader", part: "the preview tile: the note surface with a source, tile:<name> or file:<path> (re-read on save)", files: "src/desk/preview.ts",
    stage(n, show) {
      const tree = new TreePane(), p = new PreviewPane({ tile: "tree" });
      return deskOf({ title: "showcase · preview", panes: [tree, p], layout: ([a, b]) => row(0.4, a!, b!) }, show, []);
    },
  },
  {
    key: "screen", need: "put a whole screen in a tile (the board, the river, the brief)", part: "ScreenTile over FramedScreen: the screen itself in a rectangle, its selection followed by a preview tile", files: "src/desk/screen-tile.ts, src/showcase/frame.ts",
    stage(n, show) {
      const b = new ScreenTile("board"), p = new PreviewPane({ tile: "board" });
      return deskOf({ title: "showcase · screen", panes: [b, p], layout: ([a, c]) => pair("col", 0.65, leaf(a!), leaf(c!)) }, show, []);
    },
  },
  {
    key: "spine", need: "squeeze a tile to a title strip", part: "the spine part: drawSpine, SPINE (c collapses a lane or a reader, alt+c opens all)", files: "src/spine.ts, on the board: src/desk/delivery.ts",
    stage(n) { return boardScreen(n.hub?.id, false); },
  },
  {
    key: "entity", need: "show children, outlinks, backlinks, resources", part: "entity navigation: u, [ ] and ⏎ on links in the surface; children in the thread tile; a row's links in the tree (L)", files: "src/surface/note.ts, src/desk/tree.ts, src/authored.ts, references.backlinks in src/socket.ts, src/backlinks.ts",
    aside: "the tree's L (tree.links): a row's outlinks, resources and backlinks as the outliner's Tree shows them (blocks.authored-links); ⏎ on a resource shows what the service stores for it · backlinks: the board's drawer (section 5, b) and the backlinks tile (^W o l; the welcome's), one drawing, grouped and filtered as Detail does (src/backlinks.ts, src/desk/backlinks-pane.ts, PIE-442)",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = new ThreadPane();
      return deskOf({ title: "showcase · entity", panes: [tree, r, th], layout: ([a, b, c]) => pair("row", 0.34, leaf(a!), row(0.6, b!, c!)) }, show, [], d => { if (n.shed) { d.setCurrent(n.shed); void tree.showLinksOf(n.shed, d); } });
    },
  },
  {
    key: "presence", need: "show who's here or recent activity", part: "presence: WhoPane and ActivityPane over clients.list, activity.recent", files: "src/desk/panes.ts",
    stage(_n, show) {
      const who = new WhoPane(), act = new ActivityPane();
      return deskOf({ title: "showcase · presence", panes: [who, act], layout: ([a, b]) => pair("col", 0.35, leaf(a!), leaf(b!)) }, show, []);
    },
  },
  {
    key: "live", need: "put live data in a note", part: "live figures: ::graph-* blocks that read views with views.read and blocks.query", files: "src/live.ts, src/graphs.ts, src/views.ts",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · live", panes: [r] }, show, [[r, n.figures]]); },
  },
  {
    key: "projection", need: "show a Resource's stored details in a note", part: "resource projections: resources.projection.read (the open is the one step); a ticket the extension keeps as a block drawn by ticketRegion under its jira:: line or after a ticket page's notes ([ ] ⏎ opens the ticket block, r or a click on its age refreshes, y copies)", files: "src/projection.ts, src/surface/note.ts, src/doc.ts",
    aside: "made-up tickets from a made-up extension (src/showcase/tickets, a contract 2 folder); the service fetches and keeps them as blocks, the door only reads",
    stage(n, show) {
      const r = new ReaderPane(), th = new ThreadPane();
      return deskOf({ title: "showcase · projection", panes: [r, th], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.tickets]], d => { if (n.tickets) d.setCurrent(n.tickets); });
    },
  },
  {
    key: "extensions", need: "bind an extension the service runs, and draw a rich component's view", part: "the extension binding: extensions.list read at start and on every extensions event; handler lines and @name requests drawn by extensionRegion (a component through primitiveLines), their actions ext.* in EXT_ACTIONS (the line's key, a click on its control, act), tile kinds through serviceKind (^W o T for tarot)", files: "src/extensions.ts, src/components.ts, src/projection.ts, src/desk/tile-kinds.ts",
    aside: "the outliner's example extensions (moon, horoscope, fancy-horror, tarot, tidy), copied into the showcase's own config dir when try-it names the checkout; without them the lines are properties and the list on the left says so",
    stage(n, show) {
      // What the service's list bound, drawn the way a service tile is: each extension, what it answers, its actions' keys.
      const list = serviceKind({
        kind: "showcase.extensions", about: "the extensions bound, listed",
        render: async req => {
          const l = extensionList();
          const rows = !l ? [`${fg(C.yellow)}this service lists no extensions (it lacks extensions.list, or none are installed)${RESET}`]
            : l.extensions.flatMap(e => [
              `${fg(C.lcyan)}${e.name}${RESET} ${fg(C.dark)}${e.id} · ${e.state}${RESET}`,
              ...e.handlers.map(h => `  ${fg(C.grey)}${h.key}:: ${fg(C.dark)}${h.kind}${RESET}`),
              ...(e.agents ?? []).map(a => `  ${fg(C.grey)}@${a.name} ${fg(C.dark)}agent${RESET}`),
              ...e.actions.map(a => `  ${fg(C.white)}${a.name}${RESET}${a.key ? ` ${fg(C.dark)}${a.key}${RESET}` : ""}`),
            ]).concat(l.tileKinds.map(t => `${fg(C.lcyan)}${t.kind}${RESET} ${fg(C.dark)}tile kind${RESET}`));
          return { title: "extensions", lines: rows.map(x => x.slice(0, req.cols + 40)) };
        },
      }).make({ kind: "showcase.extensions" });
      const r = new ReaderPane();
      return deskOf({ title: "showcase · extensions", panes: [r, list], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.omens]], d => { if (n.omens) d.setCurrent(n.omens); });
    },
  },
  {
    key: "selection", need: "select or copy text a reader draws", part: "the selection model: Selection, Gesture (a mouse selection is copied on release), v, y Y cmd+c, select* actions; App.copy (OSC 52 and the copied-to-clipboard toast)", files: "src/surface/selection.ts, src/surface/note.ts, src/app.ts",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · selection", panes: [r] }, show, [[r, n.recipe]]); },
  },
  {
    key: "service", need: "know anything the service can answer", part: "ask the service: views.read, blocks.read, properties.preview, changes.since, references.*, protocol 82 with every capability, refused otherwise", files: "src/socket.ts",
    stage(n, show) { const p = new ServicePane(n); return deskOf({ title: "showcase · service", panes: [p] }, show, []); },
  },
  {
    key: "session", need: "keep the door running without a terminal: quit detaches, attach again, several terminals at once", part: "the door session: one daemon per state dir holds the App (screens, layouts, the dispatcher, drafts, terminal tiles, the service connection); clients attach over session.sock and are only terminals; SessionTerm is the App's terminal, a Painter per client (its size, video mode and Kitty images), the keys wherever the person last typed", files: "src/session/daemon.ts, src/session/client.ts, src/session/session-term.ts, src/session/protocol.ts, src/display.ts",
    aside: "G and ctrl+c detach the terminal you're on, and everything goes on; E on the main menu (or `ep0ch session end`) ends the session; `ep0ch session attach --watch` shows it read-only; `ep0ch session list` says who's attached",
    stage(n, show) {
      // The session's terminals as they are, drawn the way a service tile is.
      const list = serviceKind({
        kind: "showcase.session", about: "the terminals attached to this session",
        render: async req => {
          const s = servingSession();
          const rows = !s ? [`${fg(C.yellow)}this door runs in its own terminal (--no-daemon): quitting it ends it${RESET}`, `${fg(C.grey)}ep0ch (without --no-daemon) runs it as a session${RESET}`]
            : [`${fg(C.lcyan)}session ${process.pid}${RESET} ${fg(C.dark)}drawn at ${s.info.cols}×${s.info.rows}${RESET}`,
              ...s.list().map(c => `  ${c.active ? fg(C.white) : fg(C.grey)}#${c.id} ${c.tty ?? `pid ${c.pid}`} ${c.cols}×${c.rows} ${c.video}${c.active ? " · has the keys" : ""}${c.watch ? " · watching" : ""}${RESET}`)];
          return { title: "session", lines: rows.map(x => x.slice(0, req.cols + 40)) };
        },
      }).make({ kind: "showcase.session" });
      const r = new ReaderPane();
      return deskOf({ title: "showcase · session", panes: [r, list], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.notebook]]);
    },
  },
];

/** The index is wide enough for every need on one line when the terminal allows; narrow, it lists the keys only. */
const indexWidth = (cols: number) => (cols >= 160 ? 52 : cols >= 110 ? 34 : cols >= 60 ? 16 : 12);

export class Showcase implements Screen {
  title = "showcase";
  readonly name = "showcase";
  ctx!: Ctx;
  private notes: Notes | null = null;
  private problem = "";
  private sel = 0;
  /** Where the person's keys go: the index of sections, or the section's stage. */
  private focus: "index" | "stage" = "index";
  private stages = new Map<number, FramedScreen>();
  private stageRect: Rect = { col: 34, row: 4, cols: 80, rows: 20 };
  private indexW = 34;
  /** The index's cursor and scroll (sections from `indexTop`). */
  private readonly index = new RowView();
  private indexTop = 0;
  /** Where the mouse went down: the stage takes the drag and the release, wherever they land. */
  private pressed = false;

  enter(ctx: Ctx) {
    this.ctx = ctx;
    loadShowcase(ctx.board).then(s => {
      if (!s) this.problem = "This outline has no showcase: the showcase runs on its own seeded outline. From a shell: ep0ch try --showcase --outliner <pi-herdr-outliner checkout> (add --reset to start it over).";
      else this.notes = s.notes;
      ctx.redraw();
    }, e => { this.problem = `couldn't read the outline: ${e instanceof Error ? e.message : String(e)}`; ctx.redraw(); });
  }

  /** The stage of section `i`, built once and kept, so an edit or a layout survives moving between sections. */
  private stage(i: number): FramedScreen | null {
    if (!this.notes) return null;
    let f = this.stages.get(i);
    if (!f) {
      let after: ((ctx: Ctx) => void) | null = null;
      const screen = SECTIONS[i]!.stage(this.notes, a => { after = a; });
      f = new FramedScreen(screen, () => this.ctx, () => { this.focus = "index"; }, () => after?.(f!.ctx), () => this.focus === "stage" && this.sel === i);
      this.stages.set(i, f);
    }
    return f;
  }

  /** Screen.holdsKeys: the person is in the stage and its screen holds their keys (an edit, a comment, a panel). */
  holdsKeys(): boolean { return this.focus === "stage" && !!this.stages.get(this.sel)?.top.holdsKeys?.(); }
  /** Screen.rawKeys: the person is typing in the stage's terminal tile: ctrl+c and cmd+c are its program's, as on the desk. */
  rawKeys(): boolean { return this.focus === "stage" && !!this.stages.get(this.sel)?.top.rawKeys?.(); }

  /** Show section `i` (by key, click or act); the keys go to its stage only when the person asks. */
  pick(i: number, enter = false) {
    this.sel = Math.max(0, Math.min(SECTIONS.length - 1, i));
    this.focus = enter && this.notes ? "stage" : "index";
    this.ctx.redraw();
  }

  render(ctx: Ctx): Frame {
    const { cols, rows } = ctx.t;
    const H = rows - 1;
    const canvas = new Canvas(cols, H);
    canvas.text(0, 0, paint(`|09─=|11[ |15KITCHEN SINK |11]|09=─ |08every shared door part, live, on a seeded outline · |07made-up notes; |15--reset|07 puts them back`), cols);
    // The index: the reuse map's rows, in its order.
    this.indexW = Math.min(indexWidth(cols), cols);
    const idx: Rect = { col: 0, row: 1, cols: this.indexW, rows: H - 2 };
    canvas.box(idx, fg(this.focus === "index" ? C.lcyan : C.blue), `${fg(this.focus === "index" ? C.white : C.dark)}${idx.cols >= 30 ? "before adding a feature" : "sections"}`, "");
    const wide = idx.cols >= 30;
    // Two rows a section, its cursor a list's: the sections past the screen scroll into view.
    const fit = Math.floor((idx.rows - 2) / 2), top = (this.indexTop = this.index.place(this.sel, SECTIONS.length * 2, fit * 2, [this.sel * 2, this.sel * 2 + 1]) / 2);
    SECTIONS.slice(top, top + fit).forEach((s, j) => {
      const i = top + j, on = i === this.sel;
      const label = pad(` ${String(i + 1).padStart(2)} ${wide ? s.need : s.key}`, idx.cols - 2);
      canvas.text(1, 2 + j * 2, on ? (this.focus === "index" ? selected() : fg(C.yellow)) + label + RESET : fg(C.grey) + label + RESET, idx.cols - 2);
      if (wide) canvas.text(1, 3 + j * 2, fg(C.dark) + pad(`    ${s.key}`, idx.cols - 2) + RESET, idx.cols - 2);
    });
    const s = SECTIONS[this.sel]!;
    const x = idx.cols + 1, w = Math.max(1, cols - x);
    canvas.text(x, 1, paint(`|14${this.sel + 1} · ${s.need} |08· |15${s.part}`), w);
    canvas.text(x, 2, paint(`|08${s.files}`), w);
    if (s.aside) canvas.text(x, 3, paint(`|13${s.aside}`), w);
    let placements: Placement[] = [];
    this.stageRect = { col: x, row: 4, cols: w, rows: Math.max(1, H - 5) };
    if (this.problem) wrap(this.problem, w).forEach((line, i) => canvas.text(x, 5 + i, paint(`|12${line}`), w));
    else if (!this.notes) canvas.text(x, 5, paint("|08reading the showcase outline…"), w);
    else {
      const f = this.stage(this.sel)!;
      const r = this.stageRect;
      const frame = f.render(r.cols, r.rows, `s${this.sel}`);
      frame.lines.forEach((l, i) => canvas.text(r.col, r.row + i, l, r.cols));
      placements = (frame.placements ?? []).map(p => ({ ...p, col: p.col + r.col, row: p.row + r.row }));
    }
    canvas.text(0, H - 1, this.hints(cols), cols);
    return { lines: canvas.lines(), placements };
  }

  private hints(cols: number): string {
    return pad(paint(this.focus === "index"
      ? "|08 ↑↓ j k 1-9 0 section · |15⏎ → l tab|08 try it · click a section or the part · |15V|08 video · |15q|08 back"
      : `|14 in ${SECTIONS[this.sel]!.key}|08 · the part's own keys and mouse (its hints are on its bottom row) · |15esc|08 backs out, to the sections at last`), cols);
  }

  key(k: Key, ctx: Ctx) {
    if (k.kind === "mouse") return this.mouse(k);
    if (this.focus === "stage") { const f = this.stage(this.sel); if (f) f.key(k); else this.focus = "index"; return ctx.redraw(); }
    const c = ch(k);
    if (k.kind === "esc" || c === "q") return this.shell("screen.back");
    if (isUp(k)) return this.sel > 0 ? this.run("section", { name: String(this.sel) }) : undefined;
    if (isDown(k)) return this.sel + 1 < SECTIONS.length ? this.run("section", { name: String(this.sel + 2) }) : undefined;
    if (/^[0-9]$/.test(c)) return this.run("section", { name: c === "0" ? "10" : c });
    if (k.kind === "enter" || k.kind === "right" || k.kind === "tab" || c === "l") return this.run("section.try", {});
    if (c === "V") return this.shell("video.cycle");
  }

  /** A key or click on the index as the person: the showcase's own action. A refusal is said. */
  private run(name: "section" | "section.try", args: { name?: string }) { void this.dispatch.pressIn(SHOWCASE_ACTIONS, name, args); }
  /** The shell's q, Esc and V (src/shell-keys.ts: screens.ts imports this module). */
  private shell(name: "screen.back" | "video.cycle") { shellKeyOf(name, this, this.ctx); }

  private mouse(k: Extract<Key, { kind: "mouse" }>) {
    const r = this.stageRect;
    const inStage = k.x >= r.col && k.x < r.col + r.cols && k.y >= r.row && k.y < r.row + r.rows;
    const f = this.notes ? this.stage(this.sel) : null;
    const rel = { ...k, x: k.x - r.col, y: k.y - r.row };
    if (k.action === "up" || k.action === "drag") {
      if (this.pressed && f) f.key(rel);
      if (k.action === "up") this.pressed = false;
      return this.ctx.redraw();
    }
    if (k.action === "down") {
      if (inStage && f) { if (this.focus !== "stage") this.run("section.try", {}); this.pressed = true; f.key(rel); return this.ctx.redraw(); }
      const i = k.x < this.indexW && k.y >= 2 ? this.indexTop + Math.floor((k.y - 2) / 2) : -1;
      if (i >= 0 && i < SECTIONS.length && (i !== this.sel || this.focus !== "index")) return this.run("section", { name: String(i + 1) });
      return;
    }
    // The wheel: the stage under the pointer scrolls; over the index it moves between sections.
    if (inStage && f) { f.key(rel); return this.ctx.redraw(); }
    const to = this.sel + (k.action === "wheel-down" ? 1 : -1);
    if (k.x < this.indexW && to >= 0 && to < SECTIONS.length) this.run("section", { name: String(to + 1) });
  }

  tick(): boolean { return [...this.stages.values()].some(f => f.tick()); }
  onEvent(e: OutlineEvent) { for (const f of this.stages.values()) f.onEvent(e); }
  unsaved() { return [...this.stages.values()].some(f => f.unsaved()); }
  keepDrafts() { return [...this.stages.values()].flatMap(f => f.keepDrafts()); }
  dispose() { for (const f of this.stages.values()) f.dispose(); }
  openBlock(m: Msg) { const f = this.stage(this.sel); if (!f?.top.openBlock) throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section can't open blocks`); f.top.openBlock(m); }

  describe() {
    const f = this.stages.get(this.sel);
    return {
      kind: "showcase", seeded: !!this.notes, problem: this.problem || undefined, focus: this.focus,
      section: { n: this.sel + 1, key: SECTIONS[this.sel]!.key, need: SECTIONS[this.sel]!.need, part: SECTIONS[this.sel]!.part, files: SECTIONS[this.sel]!.files },
      sections: SECTIONS.map(s => s.key),
      stage: f?.top.describe?.() ?? null,
    };
  }

  /**
   * The showcase's dispatcher: its own actions (which section), then the shown section's stage: its screen's own
   * dispatcher, as if it were the screen shown.
   */
  readonly dispatch: Dispatcher = new Dispatcher({ title: "showcase", ctx: () => this.ctx, keys: () => this.keys() }, [
    { set: SHOWCASE_ACTIONS, takes: "none", on: () => this },
    {
      // Listing (no request) skips a stage that isn't ready; running an action there says why.
      delegate: (req?: ActRequest) => {
        const f = this.stage(this.sel);
        if (f?.top.dispatch) return f.top.dispatch;
        if (!req) return null;
        if (!f) throw new ActionRefused(this.problem || "the showcase outline is still being read");
        throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section has no actions`);
      },
      // The stage's own actions; while it isn't ready, anything not the showcase's (so the reason is said). The shell's
      // (`screen.list`, `screen.open`) and the host layer's stay the App's.
      claims: req => { if (SHOWCASE_ACTIONS.has(req.action)) return false; const d = this.stage(this.sel)?.top.dispatch; return d ? d.takes(req) : !SHELL_ACTIONS.has(req.action); },
    },
  ]);
  /**
   * Screen.keys: in the stage, its screen's, and held: the person works in a section, so an agent doesn't move them out
   * of it (`section` touches the screen); on the index, nothing holds them.
   */
  keys() {
    const f = this.focus === "stage" ? this.stages.get(this.sel) : undefined;
    return f ? { ...screenKeys(f.top), busy: true, why: `the person is in section ${this.sel + 1} (${SECTIONS[this.sel]!.key}); sections change from the index` } : { focus: null, typingIn: null, busy: false };
  }

  /** The section on screen, and where the person's keys are: the index or its stage. */
  get shown() { return this.sel; }
  focusName() { return this.focus; }

  /** By number (1-10) or key (note, actions, edit…). */
  sectionOf(name: string): number {
    const i = /^\d+$/.test(name) ? Number(name) - 1 : SECTIONS.findIndex(s => s.key === name);
    if (i < 0 || i >= SECTIONS.length) throw new ActionRefused(`no section ${name}; sections: ${SECTIONS.map((s, j) => `${j + 1} ${s.key}`).join(", ")}`);
    return i;
  }
}

/** The showcase's own actions: which section is shown. Keys and clicks on the index call the same code. */
export const SHOWCASE_ACTIONS = actionSet<Showcase>()("showcase", {
  "section.try": def({
    summary: "go into a section's stage (name=<1-19> or its key, else the one shown): the person's keys and mouse go to the part itself until its own esc brings them back to the index. The person's only: an agent acts in the stage with its actions (`act` reaches the shown section's)",
    keys: "⏎ → l tab, click in the stage",
    touches: "screen", replay: "safe", person: "going into a section gives it the person's keys; an agent runs the shown section's own actions instead",
    args: { name: { type: "string", optional: true, about: "the section's number or key; the one shown when left out" } },
    run({ name }, s) {
      const i = name === undefined ? s.shown : s.sectionOf(name);
      s.pick(i, true);
      return { section: i + 1, key: SECTIONS[i]!.key, in: s.focusName() === "stage" };
    },
  }),
  "section": def({
    summary: "show a section (name=<1-19> or its key: note, actions, edit, drafts, panes, screens, kinds, terminal, preview, screen, spine, entity, presence, live, projection, extensions, selection, service, session); refused to an agent while the person is in one", keys: "↑↓ j k, 1-9 0, click, wheel",
    touches: "screen", replay: "safe", says: r => `showed section ${r.section} (${r.key})`,
    args: { name: { type: "string", about: "the section's number or key" } },
    run({ name }, s) {
      // An agent never moves the person out of a section they are working in (the actor rule: the showcase says their
      // keys are held while they're in one, `keys`): sections change from the index.
      const i = s.sectionOf(name);
      s.pick(i, false);
      return { section: i + 1, key: SECTIONS[i]!.key };
    },
  }),
});

// ── the panes only the showcase has: the action list and what the service answers ──────────────────

const SETS: { name: string; file: string; list: () => ActionInfo[] }[] = [
  // The note set forwards the draft's actions (draft.*); they're listed once, as the draft's own.
  { name: "NOTE_ACTIONS", file: "src/surface/note.ts", list: () => NOTE_ACTIONS.list().filter(a => !DRAFT_ACTIONS.has(a.name)) },
  { name: "DESK_ACTIONS", file: "src/desk/desk.ts", list: () => DESK_ACTIONS.list() },
  { name: "TILE_ACTIONS", file: "src/desk/tile-actions.ts", list: () => TILE_ACTIONS.list() },
  { name: "PANE_ACTIONS", file: "src/desk/pane-actions.ts", list: () => PANE_ACTIONS.list() },
  { name: "DRAFT_ACTIONS", file: "src/edit.ts", list: () => DRAFT_ACTIONS.list() },
  { name: "BOARD_ACTIONS", file: "src/desk/lanes.ts", list: () => BOARD_ACTIONS.list() },
  { name: "COLUMN_ACTIONS", file: "src/river/column.ts", list: () => COLUMN_ACTIONS.list() },
  { name: "SHOWCASE_ACTIONS", file: "src/showcase/showcase.ts", list: () => SHOWCASE_ACTIONS.list() },
];

/**
 * Every action set, with each action's keys and its `act` name. ⏎ (or a double click) runs a note or desk
 * action that needs no arguments in the reader beside, as you: the same code its key runs.
 */
export class ActionsPane implements Pane {
  readonly kind = "exhibit";
  run: ((name: string, actor: Actor) => Promise<unknown>) | null = null;
  private rows: ({ head: string } | { a: ActionInfo })[] = SETS.flatMap(s => [{ head: `${s.name} · ${s.file}` }, ...s.list().map(a => ({ a }))]);
  private sel = 1;
  private view = new RowView();
  private lastClick = { at: 0, i: -1 };
  title() { return "the action registry · src/surface/actions.ts"; }
  hint() { return "↑↓ pick · ⏎ run it in the reader beside (no-argument note and desk actions)"; }
  private step(d: number) {
    let i = this.sel;
    do { i += d; } while (i > 0 && i < this.rows.length && "head" in this.rows[i]!);
    if (i > 0 && i < this.rows.length) this.sel = i;
  }
  render(w: number, h: number, focused: boolean): PaneView {
    const detail = 3;
    const room = Math.max(1, h - detail);
    this.view.place(this.sel, this.rows.length, room);
    const nameW = Math.min(20, Math.max(8, Math.floor(w * 0.3))), keysW = Math.min(18, Math.max(6, Math.floor(w * 0.22)));
    const lines = this.rows.slice(this.view.top, this.view.top + room).map((r, j) => {
      const i = this.view.top + j;
      if ("head" in r) return fg(C.lcyan) + pad(r.head, w) + RESET;
      const text = ` ${pad(r.a.name, nameW)} ${pad(r.a.keys ?? "—", keysW)} ${r.a.summary}`;
      return i === this.sel ? selected(focused) + pad(text, w) + RESET
        : fg(C.yellow) + " " + pad(r.a.name, nameW) + " " + fg(C.brown) + pad(r.a.keys ?? "—", keysW) + " " + fg(C.grey) + pad(r.a.summary, Math.max(1, w - nameW - keysW - 3)) + RESET;
    });
    while (lines.length < room) lines.push("");
    const cur = this.rows[this.sel];
    if (cur && "a" in cur) {
      const args = Object.entries(cur.a.args).map(([k, s]) => `${k}${s.optional ? "?" : ""}: ${s.type}`).join(", ") || "no arguments";
      lines.push(fg(C.blue) + "─".repeat(w) + RESET, fg(C.white) + pad(`ep0ch-door act ${cur.a.name}${Object.keys(cur.a.args).length ? " key=value…" : ""}`, w) + RESET, fg(C.dark) + pad(`${cur.a.scope} · ${args}`, w) + RESET);
    }
    return { lines, scroll: { top: this.view.top, room, total: this.rows.length } };
  }
  private runSelected(desk: DeskApi) {
    const cur = this.rows[this.sel];
    if (!cur || !("a" in cur)) return;
    const a = cur.a;
    const needs = Object.entries(a.args).filter(([, s]) => !s.optional).map(([k]) => k);
    if (!["note", "desk"].includes(a.scope)) return desk.ctx.flash(`${a.name} belongs to the ${a.scope}; try it there${a.keys ? ` (${a.keys})` : ""}`);
    if (needs.length) return desk.ctx.flash(`${a.name} needs ${needs.join(", ")}: use its key${a.keys ? ` (${a.keys})` : ""} in the reader, or ep0ch-door act ${a.name} ${needs.map(n => `${n}=…`).join(" ")}`);
    this.run?.(a.name, { kind: "user" }).then(() => desk.redraw(), e => desk.ctx.flash(`${a.name}: ${e instanceof Error ? e.message : String(e)}`));
  }
  key(k: Key, desk: DeskApi): boolean {
    if (isUp(k)) { this.step(-1); desk.redraw(); return true; }
    if (isDown(k)) { this.step(1); desk.redraw(); return true; }
    if (k.kind === "pgdn") { for (let i = 0; i < 10; i++) this.step(1); desk.redraw(); return true; }
    if (k.kind === "pgup") { for (let i = 0; i < 10; i++) this.step(-1); desk.redraw(); return true; }
    if (k.kind === "enter") { this.runSelected(desk); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) {
    const i = this.view.top + y;
    if (!this.rows[i] || "head" in this.rows[i]!) return;
    const again = this.lastClick.i === i && Date.now() - this.lastClick.at < 400;
    this.sel = i; this.lastClick = { at: Date.now(), i };
    if (again) this.runSelected(desk);
    desk.redraw();
  }
  wheel(dir: 1 | -1, desk: DeskApi) { this.step(dir); desk.redraw(); }
}

/** What the service says about the seed, asked the way the door asks it. `r` asks again. */
export class ServicePane implements Pane {
  readonly kind = "exhibit";
  private answers: string[] | null = null;
  constructor(private readonly notes: Notes) {}
  title() { return "SocketBoard · src/socket.ts"; }
  hint() { return "r asks again"; }
  init(desk: DeskApi) { void this.load(desk); }
  onEvent(desk: DeskApi) { void this.load(desk); }
  private async load(desk: DeskApi) {
    const b = desk.ctx.board, n = this.notes;
    const out: string[] = [];
    const say = (k: string, v: string) => out.push(`${fg(C.lcyan)}${pad(k, 34)}${fg(C.grey)}${v}${RESET}`);
    const tryIt = async (k: string, f: () => Promise<string>) => { try { say(k, await f()); } catch (e) { say(k, `${fg(C.lred)}${e instanceof Error ? e.message : String(e)}`); } };
    say("capabilities (ping)", b.capabilities ? [...b.capabilities].join(", ") || "none" : "not asked yet");
    out.push("");
    if (n.gardenView) await tryIt(`views.read ((${SEED.gardenView}))`, async () => { const r = await b.readSavedView(n.gardenView!.id); return `${r.status} · ${r.blocks.length} block(s): ${r.blocks.map(subject).join(", ")}`; });
    if (n.hub) await tryIt(`blocks.read (${SEED.hub}'s lanes)`, async () => { const kids = await b.children(n.hub!.id); const r = await b.readMany(kids.map(k => k.id), ["title", "properties"]); return r.map(subject).join(", "); });
    if (n.hub) await tryIt(`views.planWrite (a new card, first lane)`, async () => {
      const lane = (await b.children(n.hub!.id))[0];
      const p = lane ? await b.planCreate(lane.id) : null;
      return !lane || !p ? "no lanes" : p.kind === "refused" ? `refused: ${p.reason}` : `${subject(lane)}: born with ${p.born.map(x => `${x.key}=${x.value}`).join(" ") || "nothing"}${p.needs.length ? ` · needs ${p.needs.join(" and ")}` : ""}`;
    });
    say("property grammar (vendored)", `version ${PROPERTY_GRAMMAR_VERSION} · src/vendor/property-grammar.ts, the outliner's own file`);
    if (n.notebook) await tryIt("properties.preview (notebook text)", async () => { const r = await b.previewPropertyList(n.notebook!.text); return r.map(p => `${p.key}::${p.value}`).join(" "); });
    if (n.shed) await tryIt(`references.backlinks (${SEED.shed})`, async () => { const c = await b.backlinks(n.shed!.id); return `${describeBacklinkView(backlinkView(c, DEFAULT_BACKLINK_VIEW_OPTIONS), DEFAULT_BACKLINK_VIEW_OPTIONS, new Set()).status}: ${c.sources.map(x => x.title).join(", ") || "none"}`; });
    await tryIt("changes.since (last 5)", async () => { const r = await b.changesSince(Math.max(0, (b.lastSequence ?? 0) - 5), 5); return r.kind === "reset" ? `reset: ${r.reason}` : `${r.changes.length} change(s), next #${r.nextSequence}`; });
    this.answers = out;
    desk.redraw();
  }
  render(w: number): PaneView { return { lines: (this.answers ?? [fg(C.dark) + "asking the service…" + RESET]).map(l => pad(l, w)) }; }
  key(k: Key, desk: DeskApi): boolean { if (k.kind === "char" && k.ch === "r") { void this.load(desk); return true; } return false; }
}

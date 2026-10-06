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
import { USER, type Actor, type OutlineEvent } from "../socket";
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
import { COLUMN_ACTIONS } from "../river/column";
import { ActivityPane, ReaderPane, ThreadPane, TreePane, WhoPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import { BacklinksPane } from "../desk/backlinks-pane";
import { MessageReader, SHELL_ACTIONS } from "../screens";
import { columnsOf, leaf, pair, splitOf, type LNode } from "../desk/screen-layout";
import { FramedScreen } from "./frame";
import { PreviewPane } from "../desk/preview";
import { PtyPane } from "../desk/pty";
import { registerTileKind, serviceKind, tileKind, tileKinds, type KindHost, type TileKind } from "../desk/tile-kinds";
import { extensionList } from "../extensions";
import { ScreenTile } from "../desk/screen-tile";
import { servingSession } from "../session/session-term";
import { findShowcase, loadShowcase, SEED, type SeedName } from "./seed";
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
interface Stage { title: string; panes: Pane[]; layout?: (ids: number[]) => LNode; names?: string[] }
/**
 * A stage as a screen spec (PIE-515) on the desk, its tiles given (the showcase makes its own exhibits): each named by
 * its kind (reader, reader2), laid out as the stage says.
 */
function stageDesk(st: Stage): Desk {
  const names = new Map<number, string>();
  st.panes.forEach((p, i) => names.set(i, st.names?.[i] ?? autoName({ names }, p.kind)));
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
    key: "note", need: "render or read a note", part: "NoteSurface, hosted through SurfaceHost (a ReaderPane; the BBS message reader)", files: "src/surface/note.ts, src/doc.ts, outline-core src/code-ranges.ts, src/inline.ts",
    aside: "the notebook's embeds read quietly: a dim, clickable » source line and a dim bar (src/embeds.ts); only a problem heading stays loud",
    stage(n, show) {
      const r = new ReaderPane();
      // The BBS message reader hosts the same surface (PIE-426): its header, the surface's body and keys.
      const bbs = new ScreenTile("exhibit", {}, { label: "the same NoteSurface, as the BBS reader · src/screens.ts", make: m => (m ? new MessageReader([m], 0) : null) });
      return deskOf({ title: "showcase · note", panes: [r, bbs], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "detail", need: "open one addressed block as the whole screen", part: "the detail screen: a ScreenSpec hosting the detail tile's NoteSurface", files: "src/desk/screen-specs.ts, src/desk/builtin-tiles.ts, src/desk/tiles.ts, src/surface/note.ts",
    stage(n) {
      return openScreen("detail", { note: n.notebook?.id, persist: false });
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
    key: "search", need: "find a note by words", part: "the service's one search: tree.search, Goto's forgiving ranker (punctuation folded, any word order, a typo or two), behind the desk's / (and the river's g), (( in a draft and ep0ch find; [[ on pages.complete; from the note you're in, Jev after a pause", files: "src/socket.ts, src/desk/desk.ts, src/surface/completer.ts, src/notes-cli.ts, outline-core/src/search-match.ts, src/export.ts",
    aside: "the overlay opens with \"alotment notebok\" typed: two typos, the notebook still first, and notes holding all but one word below it · type to search again, ⏎ opens the hit in the reader · the note under it says what to try; esc puts the overlay away, then e in the note and (( with the same typos finds it the same way · `ep0ch find` answers the same from a shell · from a shell the outline also evaluates queries, views and subtrees (`ep0ch find --query … --ids`, `ep0ch export … --out <dir>`: the Seed order note's header line becomes front matter)",
    stage(n, show) {
      const r = new ReaderPane();
      // The overlay asks from the desk's current note, as the person's / does: nearer notes first, and Jev told it.
      return deskOf({ title: "showcase · search", panes: [r] }, show, [[r, n.finding]], d => { if (n.finding) d.setCurrent(n.finding); void d.searchNotes("alotment notebok", undefined, USER); });
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
    aside: "a click on a tile's × closes it (tile.close, as ^W x); the board (section 5) and the river are screen specs on this engine (PIE-511, PIE-515): the river's columns are a flow",
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
    aside: "the brief here is its spec: one tile of the brief kind, which knows the briefs and steps them (, .); `act screen.spec` reads it as the data a note would hold · the home base is a spec the same way (`home`): bare `ep0ch` in a folder that names no outline (no --ws, EP0CH_WS or .ep0ch) opens it, to open, make or import one here or on a machine; `--machine box-a --ws fern` where box-a has no fern makes nothing there: the home base says so and offers the one here, creating it there (`home.new name=fern machine=box-a`, or `--create`), or `home.cancel`",
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
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; ctrl+e edits a draft in one; its program's copy (OSC 52, Claude Code's) goes on to your clipboard through App.copy if you typed or clicked in the tile within 2 min, said \"copied from <tile>\" (or why not)", files: "src/desk/pty.ts, src/surface/editor.ts, src/surface/selection.ts",
    aside: "the dock (next section; src/dock.ts, PIE-498) runs a program of its own too, its first tab, pulled up over (or beside) any screen, this one too, by alt+a or a click on the status bar's ▲ chip; ctrl+] gives the keys back, alt+A or its top edge sizes it (host.toggle, host.size) · where a program runs: EP0CH_NEST, ep0ch where",
    stage(n, show) {
      const term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: sh in a pty the door owns'; echo 'copy from it as Claude Code does:'; printf '%s\\n' \"  printf '\\\\033]52;c;%s\\\\007' \\\"\\$(printf hello | base64)\\\"\"; exec sh"], label: "shell" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · terminal", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "dock", need: "carry a tile across screens (a terminal, a reader, the tree)", part: "the dock: the host layer's drawer of tabs on its own desk; host.dock moves a tile in or out whole", files: "src/dock.ts, src/desk/dock-program.ts",
    aside: "^W a on the kettle docks it (or drag its title onto the status bar's dock chip, or press a while dragging it): it leaves this section and joins the dock, the same program running · pick another section (a screen switch), alt+a pulls the dock up there and it's still in it · ^W a in the dock, or its tab dragged out onto the screen, puts it back · a docked tab's × (or ^W x in the dock) closes it, at once once its program has exited (exit in it, then ^W x) · `act host.dock tile=kettle` does it for an agent, attributed, never with the person's keys",
    stage(n, show) {
      const kettle = new PtyPane({ cmd: ["sh", "-c", "echo 'the kettle: a terminal tile to dock (^W a). Its pid:' $$; exec sh"], label: "kettle" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · dock", panes: [kettle, r], names: ["kettle", "reader"], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "preview", need: "follow a tile's selection or a file in a reader", part: "the preview tile: the note surface with a source, tile:<name> or file:<path> (re-read on save)", files: "src/desk/preview.ts",
    aside: "tile.preview (O in the reader, ^W v beside, ^W V below): a detail opens beside the reader on the right, linked, so a link followed there lands in it and the reader keeps the notebook; again, it shows that one",
    stage(n, show) {
      // The reader on the right is held on the notebook (p), so the outline's selection doesn't move it.
      const tree = new TreePane(), p = new PreviewPane({ tile: "tree" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · preview", panes: [tree, p, r], layout: ([a, b, c]) => pair("row", 0.3, leaf(a!), row(0.45, b!, c!)) }, show, [], d => { if (n.notebook) r.hold(n.notebook, d); });
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
    aside: "the board's lanes take a sideways wheel or a trackpad swipe as h and l, one lane a swipe (SidewaysWheel); a click selects a card, a double click opens it, an alt-, ctrl- or middle-click opens it in a new detail; alt+↑ alt+↓, or a card dragged up or down its lane, puts it in the lane's hand-set order (card.reorder, as `act` does; `ep0ch view order <view> <id>…` from a shell)",
    stage(n) { return openScreen("board", { hub: n.hub?.id, persist: false }); },
  },
  {
    key: "entity", need: "show children, outlinks, backlinks, resources", part: "entity navigation: u, [ ] and ⏎ on links in the surface; children in the thread tile; one links model (src/links.ts) drawn three ways: a row's links in the tree (L), the links tile (b in any reader), the inline ::links in a note", files: "src/surface/note.ts, src/links.ts, src/desk/tree.ts, src/desk/backlinks-pane.ts, src/authored.ts, references.backlinks in src/socket.ts, src/backlinks.ts",
    aside: "one model, one row: the tree's L (tree.links), the links tile under the reader (b; the board's drawer, section 5) and the shed note's own ::links are the same rows (src/links.ts linkRows, linkRowLine) · Outlinks and Resources from blocks.authored-links, Backlinks grouped and filtered as Detail does · moving onto a resource shows what the service stores for it, read only; ⏎ registers and opens · the mouse as the keys: a click selects, a double click is ⏎, an alt-, ctrl- or middle-click alt+⏎",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = new ThreadPane(), links = new BacklinksPane("reader", true);
      return deskOf({ title: "showcase · entity", panes: [tree, r, links, th], layout: ([a, b, c, e]) => pair("row", 0.3, leaf(a!), pair("row", 0.66, pair("col", 0.62, leaf(b!), leaf(c!)), leaf(e!))) }, show, [], d => { if (n.shed) { d.setCurrent(n.shed); void tree.showLinksOf(n.shed, d); } });
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
    key: "tabs", need: "switch a live figure's tabs, or how many lines its rows take", part: "a figure's reading state: ::graph-tabs (a query's results grouped by a property, a tab each) and a table's density, kept by the reader, switched by figure.tab and figure.density (tab shift+tab ← →, =, a click, act)", files: "src/graphs.ts, src/live.ts, src/surface/note.ts",
    aside: "[ ] onto a tab, then ← → or tab shift+tab switch; = steps compact, cozy, comfortable (titles wrap past PLOT-1 — ); a click on a tab or ≡ does the same; the note is never written; two readers of one note, each with its own tab and density",
    // Two readers on one note: each keeps its own tab and density.
    stage(n, show) { const a = new ReaderPane(), b = new ReaderPane(); return deskOf({ title: "showcase · tabs", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.plotJobs], [b, n.plotJobs]]); },
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
    key: "service", need: "know anything the service can answer", part: "ask the service: views.read, blocks.read, properties.preview, changes.since, references.*, one protocol (outline-core), refused when it differs", files: "src/socket.ts",
    stage(n, show) { const p = new ServicePane(n); return deskOf({ title: "showcase · service", panes: [p] }, show, []); },
  },
  {
    key: "session", need: "keep the door running without a terminal: quit detaches, attach again, several terminals at once", part: "the door session: one daemon per outline (its folder of the state dir, src/session/place.ts) holds the App (screens, layouts, the dispatcher, drafts, terminal tiles, the service connection); clients attach over session.sock and are only terminals; SessionTerm is the App's terminal, a Painter per client (its size, video mode and Kitty images), the keys wherever the person last typed", files: "src/session/place.ts, src/session/daemon.ts, src/session/client.ts, src/session/session-term.ts, src/session/protocol.ts, src/display.ts",
    aside: "G and ctrl+c detach the terminal you're on, and everything goes on; E on the main menu (or `ep0ch session end`) ends the session; `ep0ch session attach --watch` shows it read-only; `ep0ch session list` says who's attached · `ep0ch --remote <ssh-name>` is this terminal on the session running on that machine; `--machine <ssh-name>` keeps the door here and its outline there, over one shared ssh forward",
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
  {
    key: "callouts", need: "draw, fold, complete or change a callout", part: "one list of callout types (outline-core's built-ins plus the outline's [callout-type::] notes, callouts.types) behind the reader's frames (nested, each a fold point), the completer after > [! and the type choice (the step choice's ListPicker); callout.type and callout.start write through the note's save", files: "outline-core/src/callouts.ts, src/callouts.ts, src/doc.ts, src/surface/note.ts, src/surface/completer.ts",
    aside: "Obsidian's own examples, nested three deep, folded with - and open with + · ( ) then f, or a click on a title, folds one; z opens them all · ⏎ or a click on an icon opens the type choice (- and + there make it start folded or open) · e, then > [! offers the types with their icons · the right reader declares a type of this outline's own",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · callouts", panes: [a, b], layout: ([x, y]) => row(0.62, x!, y!) }, show, [[a, n.callouts], [b, n.calloutType]]);
    },
  },
  {
    key: "images", need: "draw an image or video in a note; size it, place it, make it the note's header", part: "the media line (PIE-532): [img::path] and the layout properties beside it ([size::] [height::] [align::] [layout::hero] [alt::]), parsed once (parseMediaLine), laid out by renderDoc into Kitty placements (scaled by sharp to the box, never up), the header drawn by NoteSurface above the title; image.size, image.align and image.hero write the line through the note's save", files: "src/media.ts, src/doc.ts, src/surface/note.ts, src/kitty.ts",
    aside: "[ ] to an image, then + - size it, ← → move it, H makes it the header (or click its caption's [−][+] [◂][▸] [▀]) · ctrl+z undoes · an agent: images, then image.size n=2 to=50%, image.align, image.hero · images draw under Kitty graphics; elsewhere each line says what it is",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · images", panes: [r], layout: ([a]) => leaf(a!) }, show, [[r, n.images]]);
      },
    },
  {
    key: "figures", need: "draw a decision, a chat, a keymap, days (uptime, activity, a month) or annotated code in a note; write a figure's rows in Markdown", part: "the figure kinds (src/graphs.ts KINDS, the newer ones in src/figures/), their rows from Markdown or a figure block's child bullets read by outline-core's figure grammar (figure-markdown.ts), drawn by the reader's NoteSurface; a quote callout's byline (quoteByline); ep0ch export writes each figure as its ASCII twin (figureAscii)", files: "outline-core/src/figure-markdown.ts, src/figures/, src/graphs.ts, src/live.ts, src/export.ts, outline-core/src/callouts.ts",
    aside: "every figure in the left reader is written as Markdown rows; the live ones read the plot's decision notes and the backup runs scripts/backup-runs.ts writes · the figure block at the bottom is a note whose rows are its child bullets: [ ] steps to them, ⏎ or a click opens one · the right reader's first sheet is read from the action registry, so it says what the reader's keys do now · ep0ch export writes each figure as plain ASCII in a fence",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · figures", panes: [a, b], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[a, n.markdownFigures], [b, n.keys]]);
    },
  },
  {
    key: "newnotes", need: "make a new note or page from anywhere", part: "note.new (ctrl+n on every screen, + on the menu, act) asks the service's notes.create, whose placement rule puts it (under the note in the reader you're in, else the top of the Inbox), then opens it where opens land through the reader's own edit; a missing [[page]] is offered, then made by page.create (pages.follow, the same rule); a lone [page::x] titles itself (outline-core's page-title rule, on ⏎ and on every save)", files: "src/new-note.ts, outline-core/src/page-title.ts, outliner src/note-placement.ts, src/surface/note.ts",
    aside: "go in (⏎), then ctrl+n: a note under this one opens to be written · ] to [[Seed swap ledger]], ⏎ offers it, ⏎ again makes it in the Inbox · type [page::2026-03-12] and ⏎ on the first line of a new note",
    stage(n, show) {
      const a = new ReaderPane();
      return deskOf({ title: "showcase · new notes", panes: [a] }, show, [[a, n.newNotes]]);
    },
  },
  {
    key: "menu", need: "show a tile's actions as a menu (its ⋯, a right-click in it)", part: "the tile menu: tile.menu lists the rows each action declares (ActionDef.menu) in the sets the dispatcher would run there (Dispatcher.menu): the tile operations, its kind's, a reader's note actions, a board lane's; a ListPicker on the desk's overlays, each row its label and its key as a keycap, one click, ⏎ or that key runs it as you", files: "src/desk/tile-menu.ts, src/surface/dispatch.ts, src/surface/actions.ts, src/desk/tile-actions.ts",
    aside: "click a tile's ⋯ (top right, beside the ×), or right-click anywhere in it, or ^W . in it: its menu, grouped Tile, then its kind's (Note, Reader, Terminal), each row with its key · a dimmed row says why it can't run now (its foot) · the terminal's program asked for the mouse, so a right-click there is its own: its ⋯ still opens the menu · `act tile.menu tile=reader` answers the same rows to an agent and draws nothing",
    stage(n, show) {
      // A program that asks for the mouse (as vim's mouse=a and claude do), so its right-clicks stay its own.
      const term = new PtyPane({ cmd: ["sh", "-c", "printf '\\033[?1000h\\033[?1006h'; echo 'this program asked for the mouse: a right-click here is its own; the ⋯ above opens the tile menu'; exec cat >/dev/null"], label: "clicks" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · menu", panes: [r, term], names: ["reader", "clicks"], layout: ([a, b]) => row(0.6, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
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
  /** The outline was reset under this door: its notes are read again once the new seed is whole. */
  private reseeding = false;
  private rereadTimer: Timer | null = null;
  /** `ctx.reconnects` when the root was last checked. */
  private reconnectsSeen = 0;
  private disposed = false;
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
    this.reconnectsSeen = ctx.reconnects ?? 0;
    loadShowcase(ctx.board).then(s => {
      if (!s) this.problem = "This outline has no showcase: the showcase runs on its own seeded outline. From a shell: ep0ch try --showcase (add --reset to start it over).";
      else this.notes = s.notes;
      ctx.redraw();
    }, e => { this.problem = `couldn't read the outline: ${e instanceof Error ? e.message : String(e)}`; ctx.redraw(); });
  }

  /**
   * After a reconnect, the host may serve a new showcase under the same name: `--reset` stopped it, deleted the
   * outline and is seeding it again while this door stays open. The new seed's notes are new blocks (and the same
   * seed ends on the same sequence, so the catch-up finds nothing missed): when the root is another one or gone, the
   * stages built on the old notes are dropped (an unsaved draft copied to disk first), and the notes are read again
   * once the seed is whole. Checked on the render after each reconnect, so a showcase under another screen then
   * checks when it is back on top.
   */
  private async recheck() {
    const root = await findShowcase(this.ctx.board).catch(() => undefined);
    if (this.disposed || root === undefined || this.reseeding || !this.notes || root?.id === this.notes.root?.id) return;
    const kept = this.keepDrafts();
    for (const f of this.stages.values()) f.dispose();
    this.stages.clear();
    this.notes = null;
    this.focus = "index";
    this.reseeding = true;
    this.problem = "The showcase outline was reset; its notes are read again once it is seeded.";
    if (kept.length) this.ctx.flash(`the showcase was reset · an unsaved draft is copied to ${kept.join(", ")}`, 6000);
    this.ctx.redraw();
    this.reread();
  }

  /** While reseeding: read the notes again once the outline has been quiet a moment, and take them when every one is there. */
  private reread() {
    if (this.rereadTimer) clearTimeout(this.rereadTimer);
    this.rereadTimer = setTimeout(() => {
      this.rereadTimer = null;
      loadShowcase(this.ctx.board).then(s => {
        if (this.disposed || !this.reseeding) return;
        // Not whole yet: the seed's next write reads again. A read that failed tries again by itself.
        if (!s || Object.keys(SEED).some(k => !s.notes[k as SeedName])) return;
        this.reseeding = false;
        this.notes = s.notes;
        this.problem = "";
        this.ctx.flash("the showcase was reset · its notes read again");
        this.ctx.redraw();
      }, () => { if (!this.disposed && this.reseeding) this.reread(); });
    }, 500);
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

  /** Screen.tilesHere: the section shown is a desk: a tile undocked here (host.dock on=false) lands in it. */
  tilesHere(): Desk | undefined { const t = this.stage(this.sel)?.top; return t instanceof Desk ? t : undefined; }
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
    if ((ctx.reconnects ?? 0) !== this.reconnectsSeen) { this.reconnectsSeen = ctx.reconnects ?? 0; void this.recheck(); }
    else if (this.reseeding && !this.rereadTimer) this.reread();
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
    if (k.action !== "wheel-up" && k.action !== "wheel-down") return;
    const to = this.sel + (k.action === "wheel-down" ? 1 : -1);
    if (k.x < this.indexW && to >= 0 && to < SECTIONS.length) this.run("section", { name: String(to + 1) });
  }

  tick(): boolean { return [...this.stages.values()].some(f => f.tick()); }
  onEvent(e: OutlineEvent) {
    for (const f of this.stages.values()) f.onEvent(e);
    if (this.reseeding && e.action !== "reconnected" && e.action !== "reset") this.reread();
  }
  unsaved() { return [...this.stages.values()].some(f => f.unsaved()); }
  keepDrafts() { return [...this.stages.values()].flatMap(f => f.keepDrafts()); }
  dispose() { this.disposed = true; for (const f of this.stages.values()) f.dispose(); if (this.rereadTimer) clearTimeout(this.rereadTimer); }
  /** The note in the reader the person is in on the shown stage (PIE-544): a new note goes under it. */
  noteContext(): string | null { return this.focus === "stage" ? this.stages.get(this.sel)?.top.noteContext?.() ?? null : null; }
  /** A new note opened to be written on the shown stage, as its desk opens one; the person's keys go into the stage. */
  async editNew(m: Msg): Promise<string | null> {
    const f = this.stage(this.sel);
    if (!f?.top.editNew) throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section has no reader to write a new note in`);
    const was = this.focus;
    this.focus = "stage";
    const at = await f.top.editNew(m).catch(e => { this.focus = was; throw e; });
    if (!at) this.focus = was;
    return at;
  }
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
    summary: "go into a section's stage (name=<1-" + SECTIONS.length + "> or its key, else the one shown): the person's keys and mouse go to the part itself until its own esc brings them back to the index. The person's only: an agent acts in the stage with its actions (`act` reaches the shown section's)",
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
    summary: `show a section (name=<1-${SECTIONS.length}> or its key: ${SECTIONS.map(x => x.key).join(", ")}); refused to an agent while the person is in one`, keys: "↑↓ j k, 1-9 0, click, wheel",
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
  readonly kind = "registry";
  run: ((name: string, actor: Actor) => Promise<unknown>) | null = null;
  private rows: ({ head: string } | { a: ActionInfo })[] = SETS.flatMap(s => [{ head: `${s.name} · ${s.file}` }, ...s.list().map(a => ({ a }))]);
  private sel = 1;
  private view = new RowView();
  private lastClick = { at: 0, i: -1 };
  title() { return "the action registry · src/surface/actions.ts"; }
  hint() { return "j k ↑↓ pick · ⏎ run it in the reader beside (no-argument note and desk actions)"; }
  /** The actions listed, in order (the set headers left out): what registry.pick's n counts. */
  private actionRows(): number[] { return this.rows.flatMap((r, i) => ("a" in r ? [i] : [])); }
  /** The selected action's place among them, from 1. */
  get picked(): number { return this.actionRows().indexOf(this.sel) + 1; }
  /** Action `n` (from 1), selected when `select` (the person's pick; an agent's leaves their selection be). */
  pick(n: number, select: boolean): ActionInfo {
    const at = this.actionRows();
    if (!Number.isInteger(n) || n < 1 || n > at.length) throw new ActionRefused(`the registry lists ${at.length} actions; n is 1-${at.length}`);
    if (select) this.sel = at[n - 1]!;
    return (this.rows[at[n - 1]!] as { a: ActionInfo }).a;
  }
  get count(): number { return this.actionRows().length; }
  private press(desk: DeskApi, args: Record<string, unknown>) { void desk.press?.(this, REGISTRY_ACTIONS, "registry.pick", args); }
  private step(by: number, desk: DeskApi) {
    const to = Math.max(1, Math.min(this.actionRows().length, this.picked + by));
    if (to !== this.picked) this.press(desk, { n: to });
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
  runAction(a: ActionInfo, desk: DeskApi, actor: Actor) {
    const needs = Object.entries(a.args).filter(([, s]) => !s.optional).map(([k]) => k);
    if (!["note", "desk"].includes(a.scope)) return desk.ctx.flash(`${a.name} belongs to the ${a.scope}; try it there${a.keys ? ` (${a.keys})` : ""}`);
    if (needs.length) return desk.ctx.flash(`${a.name} needs ${needs.join(", ")}: use its key${a.keys ? ` (${a.keys})` : ""} in the reader, or ep0ch-door act ${a.name} ${needs.map(n => `${n}=…`).join(" ")}`);
    this.run?.(a.name, actor).then(() => desk.redraw(), e => desk.ctx.flash(`${a.name}: ${e instanceof Error ? e.message : String(e)}`));
  }
  key(k: Key, desk: DeskApi): boolean {
    if (isUp(k)) { this.step(-1, desk); return true; }
    if (isDown(k)) { this.step(1, desk); return true; }
    if (k.kind === "pgdn") { this.step(10, desk); return true; }
    if (k.kind === "pgup") { this.step(-10, desk); return true; }
    if (k.kind === "enter") { this.press(desk, { run: true }); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) {
    const i = this.view.top + y;
    if (!this.rows[i] || "head" in this.rows[i]!) return;
    const again = this.lastClick.i === i && Date.now() - this.lastClick.at < 400;
    this.lastClick = { at: Date.now(), i };
    this.press(desk, { n: this.actionRows().indexOf(i) + 1, ...(again ? { run: true } : {}) });
  }
  wheel(dir: 1 | -1, desk: DeskApi) { this.step(dir, desk); }
}

/** The registry list's one action: the keys, a click, the wheel and `act` pick (and run) through it. */
export const REGISTRY_ACTIONS = actionSet<KindHost>()("registry", {
  "registry.pick": def({
    summary: "select action n (from 1, as the action registry tile lists them; the selected one when left out) in the showcase's registry list; run=true runs it in the reader beside, as ⏎ does (no-argument note and desk actions)",
    keys: "j k ↑ ↓ PgUp PgDn, click, wheel · ⏎, double click (run)",
    touches: "tile", replay: "safe", says: r => `picked ${r.action}`,
    args: { n: { type: "number", optional: true, about: "the action's place in the list, from 1" }, run: { type: "boolean", optional: true, about: "run it in the reader beside, as ⏎ does" } },
    run({ n, run }, { pane, desk }, actor) {
      const list = pane as ActionsPane, at = n ?? list.picked;
      const a = list.pick(at, actor.kind !== "agent");
      if (run) list.runAction(a, desk, actor);
      desk.redraw();
      return { n: at, of: list.count, action: a.name, keys: a.keys ?? null, ran: !!run };
    },
  }),
});

/** The registry list as a tile kind, so its keys and the wheel are its action's (no ^W o key: the showcase makes it). */
export const REGISTRY_KIND: TileKind = { kind: "registry", about: "the action registry, every set listed (the showcase's)", noun: "the registry list", make: () => new ActionsPane(), actions: REGISTRY_ACTIONS };
if (!tileKind(REGISTRY_KIND.kind)) registerTileKind(REGISTRY_KIND);

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
    say("protocol (ping)", b.protocol === null ? "not asked yet" : `protocol ${b.protocol}`);
    out.push("");
    if (n.gardenView) await tryIt(`views.read ((${SEED.gardenView}))`, async () => { const r = await b.readSavedView(n.gardenView!.id); return `${r.status} · ${r.blocks.length} block(s): ${r.blocks.map(subject).join(", ")}`; });
    if (n.hub) await tryIt(`blocks.read (${SEED.hub}'s lanes)`, async () => { const kids = await b.children(n.hub!.id); const r = await b.readMany(kids.map(k => k.id), ["title", "properties"]); return r.map(subject).join(", "); });
    if (n.hub) await tryIt(`views.planWrite (a new card, first lane)`, async () => {
      const lane = (await b.children(n.hub!.id))[0];
      const p = lane ? await b.planCreate(lane.id) : null;
      return !lane || !p ? "no lanes" : p.kind === "refused" ? `refused: ${p.reason}` : `${subject(lane)}: born with ${p.born.map(x => `${x.key}=${x.value}`).join(" ") || "nothing"}${p.needs.length ? ` · needs ${p.needs.join(" and ")}` : ""}`;
    });
    say("property grammar", "@ep0ch/outline-core/property-grammar, the file the service parses with");
    if (n.notebook) await tryIt("properties.preview (notebook text)", async () => { const r = await b.previewPropertyList(n.notebook!.text); return r.map(p => `${p.key}::${p.value}`).join(" "); });
    if (n.shed) await tryIt(`references.backlinks (${SEED.shed})`, async () => { const c = await b.backlinks(n.shed!.id); return `${describeBacklinkView(backlinkView(c, DEFAULT_BACKLINK_VIEW_OPTIONS), DEFAULT_BACKLINK_VIEW_OPTIONS, new Set()).status}: ${c.sources.map(x => x.title).join(", ") || "none"}`; });
    await tryIt("changes.since (last 5)", async () => { const r = await b.changesSince(Math.max(0, (b.lastSequence ?? 0) - 5), 5); return r.kind === "reset" ? `reset: ${r.reason}` : `${r.changes.length} change(s), next #${r.nextSequence}`; });
    this.answers = out;
    desk.redraw();
  }
  render(w: number): PaneView { return { lines: (this.answers ?? [fg(C.dark) + "asking the service…" + RESET]).map(l => pad(l, w)) }; }
  key(k: Key, desk: DeskApi): boolean { if (k.kind === "char" && k.ch === "r") { void this.load(desk); return true; } return false; }
}

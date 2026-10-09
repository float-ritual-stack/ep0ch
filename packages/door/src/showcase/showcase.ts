// The showcase (PIE-439): every shared door part, live, on the seeded showcase outline. One section per
// row of the reuse map (docs/UI-GRAMMAR.md "Before adding a feature"), in the map's order; each is drawn
// by the part itself, hosted on a desk of its own spec or the real board, never a copy. A parallel version still
// in the code is shown beside the shared one and labelled, until consolidation removes it.
//
// It only runs on an outline the showcase seed wrote (src/showcase/seed.ts): `scripts/try-it.sh --showcase`
// starts one. On any other outline it says so and writes nothing.
import { nothingToClose, shellKeyOf } from "../shell-keys";
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
import { keepUnsent, unsent } from "../draft-session";
import { Desk, DESK_ACTIONS } from "../desk/desk";
import { openScreen } from "../desk/screen-specs";
import { autoName, serializeTree } from "../desk/screen-layout";
import { type SavedTree, type TileSpec } from "../desk/tiles";
import type { NewNoteOpens, NewNoteRule } from "../desk/screen-spec";
import type { NewNoteHow } from "../new-note";
import { TILE_ACTIONS } from "../desk/tile-actions";
import { PANE_ACTIONS } from "../desk/pane-actions";
import { BOARD_ACTIONS } from "../desk/lanes";
import { COLUMN_ACTIONS, RiverColumn } from "../river/column";
import { ActivityPane, ReaderPane, TreePane, WhoPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import { BacklinksPane } from "../desk/backlinks-pane";
import { TunePane } from "../desk/tune";
import { MessageReader, SHELL_ACTIONS } from "../screens";
import { columnsOf, leaf, pair, splitOf, type LNode } from "../desk/screen-layout";
import { FramedScreen } from "./frame";
import { PreviewPane } from "../desk/preview";
import { PtyPane } from "../desk/pty";
import { AgentsPane } from "../desk/agents-panel";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { registerTileKind, serviceKind, tileKind, tileKinds, type KindHost, type TileKind } from "../desk/tile-kinds";
import { extensionList } from "../extensions";
import { ScreenTile } from "../desk/screen-tile";
import { servingSession } from "../session/session-term";
import { findShowcase, KEPT, loadShowcase, LOGS, RECENT_FILES, SEED, type SeedName } from "./seed";
import { openResource } from "../authored";
import { RowView } from "../scroll";
import { WaitingYouPane } from "../desk/waiting-you";
import { WhatChangedPane } from "../desk/what-changed";
import type { AgentLevel } from "../surface/agent-level";

type Notes = Partial<Record<SeedName, Msg>>;

/**
 * The program status section's fake deploy (OSC 7501): it reports each step to its terminal tile, waits for the person
 * to approve production, and finishes done (y) or failed (anything else); then it's a shell, to run it again.
 */
/** A reader held on the note opened into it (a detail): the exhibit builds one directly, as the desk would from `mode: held`. */
const detailPane = (): ReaderPane => { const r = new ReaderPane(true); r.holdOn(); return r; };

export const STATUS_DEMO = [
  `s() { printf '\\033]7501;%s\\033\\\\' "$1"; }`,
  `m() { printf '%s' "$1" | base64 | tr -d '\\n'; }`,
  `echo 'a fake deploy, saying what it does with OSC 7501 (state, progress, a message)'`,
  `s "state=working:app=deploy:progress=20:msg=$(m 'Building v2.4.1')"; sleep 1`,
  `s "state=working:app=deploy:progress=60:msg=$(m 'Pushing images')"; sleep 1`,
  `s "state=blocked:kind=permission:app=deploy:msg=$(m 'Deploy v2.4.1 to production?')"`,
  `printf 'Deploy v2.4.1 to production? (y/n) '; read a`,
  `s "state=working:app=deploy:progress=90:msg=$(m 'Rolling out')"; sleep 1`,
  `if [ "$a" = y ]; then s "state=done:app=deploy:msg=$(m 'Deployed v2.4.1 to 3 regions')"; echo deployed; else s "state=error:app=deploy:msg=$(m 'Stopped: production not approved')"; echo stopped; fi`,
  `exec sh`,
].join("\n");

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

/** The thread tile as it is now (PIE-693): a links tile listing the reader's note's Children alone. */
const repliesTile = () => new BacklinksPane("reader", false, ["children"]);

/** A stage: its tiles (made here, the exhibits), how they're laid out by their place (default side by side), its title. */
interface Stage { title: string; panes: Pane[]; layout?: (ids: number[]) => LNode; names?: string[]; agents?: (AgentLevel | undefined)[] }
/**
 * A stage as a screen spec (PIE-515) on the desk, its tiles given (the showcase makes its own exhibits): each named by
 * its kind (reader, reader2), laid out as the stage says.
 */
function stageDesk(st: Stage): Desk {
  const names = new Map<number, string>();
  st.panes.forEach((p, i) => names.set(i, st.names?.[i] ?? autoName({ names }, p instanceof ReaderPane && p.kind === "reader" && p.holding ? "detail" : p.kind)));
  const ids = st.panes.map((_, i) => i);
  const tree = st.layout ? st.layout(ids) : ids.slice(1).reduce<LNode>((a, id) => pair("row", 0.5, a, leaf(id)), leaf(0));
  const root = serializeTree(tree, (i: number): TileSpec => ({ t: "leaf", kind: st.panes[i]!.kind, name: names.get(i)!, ...(st.agents?.[i] ? { agents: st.agents[i]! } : {}) })) as SavedTree;
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

/**
 * The agent sessions section's stand-in agent (PIE-737): a made-up program that says where it runs and as whom, then
 * answers each line with its turn. Its turns are its conversation: moved between the drawer and a tile, they go on.
 */
export const DEMO_AGENT = [
  `echo "$1, a demo agent (made up for the showcase), in $PWD"`,
  `echo "type a line and ⏎: it answers with its turn. Move it (a or d in the agent panel) and the turns go on: the same process"`,
  `n=0; while IFS= read -r l; do n=$((n+1)); echo "$1 · turn $n: $l"; done`,
].join("\n");
/** The two made-up folders the section's sessions run in. */
export function demoFolders(): { shed: string; bench: string } {
  const root = joinPath(tmpdir(), "ep0ch-showcase-agents"), shed = joinPath(root, "garden-shed"), bench = joinPath(root, "potting-bench");
  for (const f of [shed, bench]) mkdirSync(f, { recursive: true });
  return { shed, bench };
}
/** The section's own actor: what pins fern to your drawer as the section opens, said like any agent's. */
const SHOWCASE_AGENT: Actor = { kind: "agent", id: "showcase" };

/** The scripted agent of the what-changed section: each log note one round on, as garden-agent. */
const GARDENER: Actor = { kind: "agent", id: "garden-agent" };
export async function gardenRound(board: Ctx["board"], n: Notes) {
  for (const [key, line] of LOGS) {
    const m = n[key] ? await board.get(n[key]!.id) : null;
    if (!m) continue;
    const round = Number(/ (\d+)$/.exec(m.text)?.[1] ?? 0) + 1;
    await board.update(m.id, `${m.text.split("\n")[0]}\n${line} ${round}`, m.revision!, GARDENER).catch(() => {});
  }
}

/** A whole Markdown document pasted into a note by mistake (fictional): the undo section's big paste. */
export const PANTRY_PASTE = ["", "# Pantry inventory", "", ...Array.from({ length: 36 }, (_, i) => `- ${["oats", "lentils", "rice", "flour", "honey", "tea"][i % 6]}, shelf ${1 + (i % 4)}, jar ${i + 1}`), "", "_Counted on a rainy Sunday._", ""].join("\n");

export const SECTIONS: Section[] = [
  {
    key: "note", need: "render or read a note", part: "NoteSurface, hosted through SurfaceHost (a ReaderPane; the BBS message reader)", files: "src/surface/note.ts, src/doc.ts, outline-core src/code-ranges.ts, src/inline.ts",
    aside: "the notebook's embeds read quietly: a dim, clickable » source line and a dim bar (src/embeds.ts); only a problem heading stays loud · a link to the web (the allotment society) is the theme's blue-violet with a ↗, apart from the cyan of a link into the outline (theme.external, PIE-646)",
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
    key: "scroll", need: "scroll a view: a note's last line up off the bottom edge to the middle, room kept under a draft's cursor", part: "past the end (PIE-622, src/scroll.ts): lastTop and endTop, the one rule every reader (NoteSurface, a river column) and draft (Draft.render, scrollOff) scrolls by; End, G and scroll to=end stop on the edge first, then go on to the middle; reader.overscroll half|none|<rows> sets how far, kept like the theme", files: "src/scroll.ts, src/surface/note.ts, src/edit.ts, src/river/column.ts, src/screens.ts (reader.overscroll)",
    aside: "End (or G) puts the last cane on the bottom edge; End again brings it up to the middle, blank under it · the wheel, j and space go on past the edge too · e opens it as a draft: typing on the last line keeps rows under the cursor · `act reader.overscroll rows=none` stops at the edge everywhere, `rows=half` (the default) or a number of rows (kept for the next start) · an agent's view.get says atEnd and past",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · past the end", panes: [a, b], names: ["reader", "short"], layout: ([x, y]) => row(0.62, x!, y!) }, show, [[a, n.overscroll], [b, n.shed]]);
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
    key: "edit", need: "edit text, complete [[ (( [file:: [key:: in any text input (a draft, a property value, a filter)", part: "the editing component: Draft, edit control, completer, DRAFT_ACTIONS (lists, wrap, mouse, preview, unsent); the property panel (i, I)", files: "src/edit.ts, src/surface/editor.ts, src/surface/completer.ts, src/surface/props-panel.ts, src/arm.ts",
    aside: "e asks first (edit.arm): the status bar says edit <title>? ⏎ · any other key cancels and the reader's frame turns the edit's yellow; ⏎ or e again opens it, any other key lets it go and does what it does, two seconds let it go quietly · the ⋯ menu's edit row and an agent's edit open at once · edit.arm.set on=false (or EP0CH_EDIT_ARM=off) opens on the first e · the tile with the keys is the double-lined one · every place you type outline text completes, with one attachment point (PIE-626): a Draft (a note, a comment or reply, the board's composer, a new note's float) and a LineInput (the property panel's value: i, ⏎ on a row, type; a river column's / filter: type:, -status:) offer [[ (( [file:: a callout's > [! and [key:: from the same completer (↑↓ ⏎ tab esc, a click, ctrl+space); a filter offers the outline's own keys and values, most used first, from the property index and the schemas; a line holding a name or plain words says so ({ complete: false}) · act: complete text=… (key=heading for a panel value), column.complete text=…",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · edit", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.whiteboard], [b, n.notebook]], () => b.surface.openPanel(false));
    },
  },
  {
    key: "search", need: "find a note by words", part: "the service's one search: tree.search, Goto's forgiving ranker (punctuation folded, any word order, a typo or two), behind the power bar's notes scope (the desk's /, the river's g, ctrl+k then /), (( in a draft and ep0ch find; [[ on pages.complete; from the note you're in, Jev after a pause", files: "src/socket.ts, src/bar/sources.ts, src/surface/completer.ts, src/notes-cli.ts, outline-core/src/search-match.ts, src/export.ts",
    aside: "go in (⏎) and press /: the power bar opens in its notes scope; type \"alotment notebok\": two typos, the notebook still first, and notes holding all but one word below it, the one lit read on the right · ⏎ opens it in the reader, alt+⏎ in a new detail · the note says what to try; e in the note and (( with the same typos finds it the same way · `ep0ch find` answers the same from a shell · from a shell the outline also evaluates queries, views and subtrees (`ep0ch find --query … --ids`, `ep0ch export … --out <dir>`: the Seed order note's header line becomes front matter)",
    stage(n, show) {
      const r = new ReaderPane();
      // The bar's notes scope asks from the desk's current note, as the person's / does: nearer notes first, and Jev told it.
      return deskOf({ title: "showcase · search", panes: [r] }, show, [[r, n.finding]], d => { if (n.finding) d.setCurrent(n.finding); });
    },
  },
  {
    key: "drafts", need: "write a draft somewhere: a note's text, a comment or reply, a new card", part: "the draft session (DraftSession): open with what was put aside, the hold, key and leave, submit, stale refusal, recordAs and the agent rule, behind three target adapters (blockTarget, commentTarget, cardTarget); what's put aside shows as a ■ unsent line with [diff] [open copy] [dismiss] [take it back] (unsent.*), and an edit opened by mistake closes on one esc (the stray rule)", files: "src/draft-session.ts, src/comment.ts, src/desk/delivery.ts, src/unsent.ts, src/stray.ts",
    aside: "the left reader is in an edit (a block's draft, held on the service), the middle one writing a comment: click away from either and it's saved or kept as unsent the same way; the board's composer (n, N) is the third adapter · the right one has an edit put aside on an older revision: [diff] shows it against the note now, [take it back] replays it into an edit (a passage changed since is left as it is), [dismiss] lets it go (src/unsent.ts) · e then a stray j, then esc: an edit opened by mistake closes at once, no ■ unsent line, and ctrl+z brings the j back (src/stray.ts)",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane(), c = new ReaderPane();
      // An edit put aside on the shed note a revision ago (fictional), so its ■ unsent line and controls are live here.
      const shed = n.shed;
      if (shed && !unsent(`edit:${shed.id}`)) keepUnsent({ key: `edit:${shed.id}`, text: `${shed.text}\n\nOil the padlock before winter.`, base: Math.max(0, (shed.revision ?? 1) - 1), at: Date.now(), copy: null, from: shed.text });
      return deskOf({ title: "showcase · drafts", panes: [a, b, c], layout: ([x, y, z]) => pair("row", 0.34, leaf(x!), row(0.5, y!, z!)) }, show, [[a, n.whiteboard], [b, n.notebook], [c, shed]], d => {
        // The person's own keys would do these: through the stage's dispatcher, in each reader's tile.
        void d.press(a, NOTE_ACTIONS, "edit");
        void d.press(b, NOTE_ACTIONS, "passage.select").then(() => d.press(b, NOTE_ACTIONS, "comment.write", { body: "" }));
      });
    },
  },
  {
    key: "kept", need: "see what an unsent edit changes against a note that has moved on, and add it, keep it or let it go", part: "the kept edit's three-way comparison (compareDraft: its base from the draft or the note's history, the draft, the note now): each of the edit's own changes is already in the note, still new or changed differently since; the reader's line says so in one sentence and offers [show them]/[compare] [add them] [keep as a note] [let it go] (unsent.*); an edit the note already has settles quietly, and an old one folds to a chip", files: "src/unsent-compare.ts, src/unsent.ts, src/draft-session.ts, src/surface/note.ts",
    aside: "left: an edit with a line the note lacks (the note changed once since, in another place): [show them] marks only the edit's own change, [add them] puts it into an edit as one patch (ctrl+z takes it back) · middle: an edit the note already has: it settled by itself when this reader opened, kept as a copy, one dim line · right: an edit from five days ago folds to \"1 old edit\"; [show] opens it: the line it rewrote was rewritten differently since, and [compare] shows both versions (src/unsent-compare.ts)",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane(), c = new ReaderPane();
      // Edits kept on three notes, each changed once since (fictional): the outline's history has the text they began as.
      const day = 86_400_000, put = (m: Msg | undefined, text: string, ago: number) => {
        if (m && !unsent(`edit:${m.id}`)) keepUnsent({ key: `edit:${m.id}`, text, base: Math.max(0, (m.revision ?? 1) - 1), at: Date.now() - ago, copy: null });
      };
      put(n.rota, KEPT.rota.draft, day); put(n.hedge, KEPT.hedge.draft, 2 * day); put(n.compost, KEPT.compost.draft, 5 * day);
      return deskOf({ title: "showcase · kept edits", panes: [a, b, c], names: ["rota", "hedge", "compost"], layout: ([x, y, z]) => pair("row", 0.34, leaf(x!), row(0.5, y!, z!)) }, show, [[a, n.rota], [b, n.hedge], [c, n.compost]]);
    },
  },
  {
    key: "undo", need: "copy text out of a draft; undo and redo anything typed or pasted, a big paste in one step", part: "the draft's one history (Draft.undos and redos behind draft.undo, ctrl+z, and draft.redo, ctrl+y or ctrl+shift+z: typing a word at a time, a paste or an agent's patch one step each, carried past a save when the note is opened again unchanged) and its copy (draft.copy: copy on select, a double click's word, shift+click and shift+arrows, cmd+c, alt+c, the frame's [copy]; OSC 52 through App.copy)", files: "src/edit.ts, src/surface/editor.ts, src/surface/note.ts, src/draft-session.ts, src/term.ts",
    aside: "the edit has a whole pantry list pasted into it by mistake: one step, said on the status line (pasted 42 lines · ctrl+z undoes) · ctrl+z takes it back, ctrl+y puts it back · the first line's [page::…] is selected: let go of a drag (or double-click a word, shift+click, shift+arrows then cmd+c or alt+c, or the frame's [copy]) and it's on your clipboard, \"copied N chars\" · an agent's draft.copy only returns the text, never your clipboard · the note has an earlier revision: the tile menu's \"an earlier revision\" (revision.restore) puts it in the edit, ctrl+s saves it, ctrl+z takes it back; `ep0ch revisions <id>` lists them from a shell",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · undo", panes: [r] }, show, [[r, n.labels]], d => {
        // The person's own keys would do these: through the stage's dispatcher, in the reader's tile.
        void d.press(r, NOTE_ACTIONS, "edit")
          .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 3 }))
          .then(() => d.press(r, NOTE_ACTIONS, "draft.paste", { text: PANTRY_PASTE }))
          .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 1, col: (n.labels?.text.indexOf("[page::") ?? 0) + 1 }))
          .then(() => d.press(r, NOTE_ACTIONS, "draft.place", { line: 1, extend: true }));
      });
    },
  },
  {
    key: "panes", need: "open, split, zoom, close tiles; docks; lock a shape", part: "the layout tree: tiles in containers (splits, tab sets, docks, columns) with a policy each, floats and spines, one engine for the desk and the screens built on it, the board a preset (^W then o x z s HJKL < > + -, p a dock, c a spine, f a float, P the policy; alt+k locks; the board's x o T B { } < >); tile.* layout.* actions (pane.* their older names); tile kinds from one registry", files: "src/desk/layout.ts, src/desk/drop.ts, src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/pane-actions.ts, src/desk/panes.ts, src/desk/desk.ts",
    aside: "a click on a tile's × closes it (tile.close, as ^W x); the board (section 5) and the river are screen specs on this engine (PIE-511, PIE-515): the river's columns are a flow",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = repliesTile(), act = new ActivityPane();
      // The replies (a links tile with Children alone) and the activity panes are one tab set (PIE-413): drag a header onto another to make one.
      // The outline is in a dock on the left (PIE-505): it slides shut when the keys leave it, and its handle
      // on the hint row opens it again; a header dropped on the handle goes into it.
      return deskOf({
        title: "showcase · panes", panes: [tree, r, th, act],
        layout: ([t, rd, h, a]) => pair("row", 0.24, { t: "dock", kid: leaf(t!), edge: "left", open: true }, pair("row", 0.62, leaf(rd!), { t: "tabs", ids: [h!, a!], active: 0 })),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook, { reveal: true }); });
    },
  },
  {
    key: "folds", need: "fold any tile to a spine with one click, and open it again", part: "the layout tree's fold (PIE-642): a ◂ or ▾ on every tile's frame beside ⋯ and ×, alt+click for a horizontal spine, alt+h alt+H, bare - + = (PIE-699), a click on the spine; tile.collapse dir=v|h and tile.expand (Fold in src/desk/screen-layout.ts; drawSpine, drawHSpine)", files: "src/desk/screen-layout.ts, src/desk/desk.ts, src/spine.ts, src/desk/tile-actions.ts",
    aside: "click the ◂ on the outline to fold it down the side, the ▾ on the reader to fold it up into one row (its height goes to the tile below); a click on a spine, or ⏎ on it, opens it at the size it had · alt+click folds the other way round, alt+h and alt+H do the focused tile, and so do a bare - (fold) and + or = (open) wherever the tile takes no text; a tile's own - + = win (the tune inspector, an image, a figure) · terminals pass alt in the mouse report where shift-click is taken for selection · `act tile.collapse tile=<t> dir=v|h`, `act tile.expand tile=<t>` do the same, and refuse the tile you are typing in",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = repliesTile(), act = new ActivityPane();
      // The outline beside the rest (a vertical spine), the reader over thread and activity side by side (a horizontal spine for the reader).
      return deskOf({
        title: "showcase · folds", panes: [tree, r, th, act],
        layout: ([t, rd, h, a]) => pair("row", 0.28, leaf(t!), pair("col", 0.55, leaf(rd!), pair("row", 0.5, leaf(h!), leaf(a!)))),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook, { reveal: true }); });
    },
  },
  {
    key: "screens", need: "make a screen (the welcome, the brief, Waiting, a pinned page, the desk itself)", part: "a screen spec on the desk, the only screen host: containers and tiles by kind, a key map naming actions, a hint, a band, where opens land (ScreenSpec; specData and readSpec, screen.spec); what it does beyond layout is its tiles' kinds'", files: "src/desk/screen-spec.ts, src/desk/screen-specs.ts, src/brief/brief.ts",
    aside: "the brief here is its spec: one tile of the brief kind, which knows the briefs and steps them (, .); `act screen.spec` reads it as the data a note would hold · the Welcome (C on the menu) is one too: notes marked [welcome::true], in its Welcome view's hand-set order (alt+↑ alt+↓ or a drag in its list, `act welcome.move`), the first read when it opens; this outline seeds two · the home base is a spec the same way (`home`): bare `ep0ch` in a folder that names no outline (no --ws, EP0CH_WS or .ep0ch) opens it, to open, make or import one here or on a machine; `--machine box-a --ws fern` where box-a has no fern makes nothing there: the home base says so and offers the one here, creating it there (`home.new name=fern machine=box-a`, or `--create`), or `home.cancel`",
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
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; $EDITOR on a draft runs in one (a reader's ctrl+e, a draft's ctrl+x ctrl+e); its program's copy (OSC 52, Claude Code's) goes on to your clipboard through App.copy if you typed or clicked in the tile within 2 min, said \"copied from <tile>\" (or why not)", files: "src/desk/pty.ts, src/surface/editor.ts, src/surface/selection.ts",
    aside: "the drawer (next section; src/drawer.ts, PIE-498) runs a program of its own too, its first tab, pulled up over (or beside) any screen, this one too, by alt+a or a click on the status bar's ▲ chip; ctrl+] gives the keys back, alt+A or its top edge sizes it (host.toggle, host.size) · where a program runs: EP0CH_NEST, ep0ch where",
    stage(n, show) {
      const term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: sh in a pty the door owns'; echo 'copy from it as Claude Code does:'; printf '%s\\n' \"  printf '\\\\033]52;c;%s\\\\007' \\\"\\$(printf hello | base64)\\\"\"; exec sh"], label: "shell" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · terminal", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "drawer", need: "carry a tile across screens (a terminal, a reader, the tree)", part: "your drawer: the host layer's tabs, above every screen, on a desk of its own; tile.drawer moves a tile in or out whole", files: "src/drawer.ts, src/desk/drawer-program.ts",
    aside: "^W a on the kettle puts it in your drawer (or drag its title onto the status bar's drawer chip, which says \"into your drawer: travels with you\", or press a while dragging it): it leaves this section and joins the drawer, the same program running · pick another section (a screen switch), alt+a pulls the drawer up there and it's still in it · ^W a in the drawer, or its tab dragged out onto the screen, takes it out · the drawer's own first tab comes out the same way, its program running on as an ordinary terminal tile, and the drawer starts a new one when it next comes up · leave a screen with a program running and it goes into your drawer · a tab in the drawer's × (or ^W x in the drawer) closes it, at once once its program has exited (exit in it, then ^W x) · `act tile.drawer tile=kettle` does it for an agent, attributed, never with the person's keys",
    stage(n, show) {
      const kettle = new PtyPane({ cmd: ["sh", "-c", "echo 'the kettle: a terminal tile to put in your drawer (^W a). Its pid:' $$; exec sh"], label: "kettle" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · drawer", panes: [kettle, r], names: ["kettle", "reader"], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "status", need: "show what a program in a terminal tile says it's doing (working, blocked on you, done, failed); report the door's own to its terminal", part: "program status (OSC 7501, PIE-614): outline-core's one reader and writer (records, ids, lifetimes, limits); each terminal tile's TileStatus, read through its emulator's OSC handler and answering the feature query, its glyph on the tile's header and tab, the drawer's chip, the status bar's count; the waiting-on-you list (a tile kind: host.waiting, alt+w, a click on the count; status.go, status.seen); doorReport to the door's own terminal", files: "outline-core/src/program-status.ts, src/desk/program-status.ts, src/desk/waiting-you.ts, src/desk/pty.ts, outliner src/program-status-emit.ts, claude-mod hooks/claude-status.ts",
    aside: "the deploy on the left is a script writing OSC 7501 to its terminal: building, pushing, then blocked on a permission until you answer y in it (click in it, y ⏎); its header's glyph, the status bar's ◆ and the list on the right follow it · ⏎ or a click on a row goes to that terminal, x marks it seen; being in the tile clears its done · alt+w opens the same list in your drawer, on any screen · the Claude mod reports Claude's own (a permission dialog, a question, done), ep0ch install --apply, ep0ch backup run, scripts/box-test and scripts/agent-env --test report theirs; the door reports its own to Ghostty or Rex (doorReport)",
    stage(_n, show) {
      const deploy = new PtyPane({ cmd: ["sh", "-c", STATUS_DEMO], label: "deploy" }), list = new WaitingYouPane();
      return deskOf({ title: "showcase · program status", panes: [deploy, list], names: ["deploy", "waiting"], layout: ([a, b]) => row(0.55, a!, b!) }, show, []);
    },
  },
  {
    key: "sessions", need: "talk to an agent here: start one in any folder, keep it running, show it in your drawer or a tile, see every one", part: "agent sessions (PIE-737, src/desk/agent-sessions.ts): a program (an agent config in the outline, [agent-config::<name>], or one installed), a folder and a persona, owned by the door session as a terminal tile's program; where it's shown (your drawer, a tile) isn't what it is, so moving it keeps the process and the conversation; agent.start (ep0ch agent from any folder, n in the panel) starts or attaches by folder and program, resuming the program's last conversation there; a claude typed in a ^W o s shell is one by itself (found as Herdr finds agents); the agent panel (a tile kind, agents.open, alt+g): agents.go, agents.drawer, agents.dock, agents.new, agents.list", files: "src/desk/agent-sessions.ts, src/desk/agents-panel.ts, src/drawer.ts (agent.start, agents.*), src/agent-cli.ts, src/desk/pty.ts (PtySpec.session)",
    aside: "two made-up sessions of a demo agent, fern in garden-shed and moss in potting-bench: fern was pinned to your drawer as the section opened (alt+a shows it), moss is the tile on the left · the panel on the right lists both, with folder, persona, what each is doing and where it's shown · j k pick, ⏎ or a click jumps to one, a pulls it into your drawer, d docks it here, n starts a new one (the program, then the folder) · type to moss (click in it, a line, ⏎), then a on its row and type again in the drawer: the turns go on, the same process · alt+g opens the same panel on any screen · `ep0ch agent` in any folder starts (or attaches) that folder's session here; `act agents.list` reads the rows",
    stage(_n, show) {
      const { shed, bench } = demoFolders();
      // temp: an exhibit no layout brings back (the drawer's saved tabs included), so a second showcase has two, not four.
      const agent = (name: string, cwd: string) => new PtyPane({ cmd: ["sh", "-c", DEMO_AGENT, "demo-agent", name], cwd, label: name, shows: "demo-agent", temp: true, session: { program: "demo-agent", persona: name } });
      const fern = agent("fern", shed), moss = agent("moss", bench), panel = new AgentsPane();
      return deskOf({ title: "showcase · agent sessions", panes: [moss, fern, panel], names: ["moss", "fern", "agents"], layout: ([a, b, c]) => pair("row", 0.55, leaf(a!), pair("col", 0.4, leaf(b!), leaf(c!))) }, show, [], d => {
        // fern goes to your drawer (the section's own agent's move: behind the tab shown, nobody's keys moved).
        const host = d.ctx?.hostLayer;
        if (host && d.pane("fern")) { try { fern.startNow(80, 20); host.put(d, "fern", SHOWCASE_AGENT); } catch { /* already moved, or the drawer won't take it */ } }
      });
    },
  },
  {
    key: "changes", need: "show what others changed since the person last looked, and take them to it", part: "what changed (PIE-647, src/desk/what-changed.ts): the status bar's +N new is the distinct notes others changed since you looked, from the service's change feed (the person's own edits aren't news); changes.open (alt+o, a click on +N new) opens the list in your drawer, a tile kind of its own: who, what and when, ⏎ or a click opens the note where opens land, alt+⏎ in a new detail, d shows the change (block.revisions); the person's looking marks it seen, kept per outline, an agent's never does", files: "src/desk/what-changed.ts, src/drawer.ts (changes.open, changes.list), src/app.ts (the status bar's count), src/showcase/seed.ts (LOGS)",
    aside: "garden-agent edited the three log notes when this section opened: the status bar says +3 new · the list on the left shows them newest first, with who changed each and what, a ● on the ones you haven't looked at; d on a row shows the change under it (the note's earlier text against the new) · ⏎ or a click opens the note in the reader on the right, alt+⏎ or an alt-click in a new detail · a click on +3 new, or alt+o on any screen, opens the same list in your drawer, and looking clears the count (x does too) · `act changes.list` reads the rows as an agent, `act changes.open` opens the tab behind yours, and neither clears what you haven't seen",
    stage(n, show) {
      const list = new WhatChangedPane(), r = new ReaderPane(true);
      // The scripted agent: three notes edited by garden-agent, each visit one round further.
      const withAgent: Shower = after => show(ctx => { void gardenRound(ctx.board, n); after(ctx); });
      return deskOf({ title: "showcase · what changed", panes: [list, r], names: ["changes", "reader"], layout: ([a, b]) => row(0.55, a!, b!) }, withAgent, [[r, n.logBeans]]);
    },
  },
  {
    key: "agents", need: "say what an agent may do to each tile (free, edit only, hands off), the screen's default and its exceptions", part: "the tile's agent level (PIE-639): Policy.agents for the screen and its containers, LayoutState.agents for a tile's own, saved with the layout; tile.agent (^W g, a click on the chip on the tile's frame, its ⋯ menu), layout.policy agents= for the default; enforced in the layout module's operations and the dispatcher's actor rule (agentRefusal), for agents only; reported in peek (agentLimits), layout.get and `ep0ch where`", files: "src/surface/agent-level.ts, src/desk/screen-layout.ts, src/desk/layout.ts, src/surface/dispatch.ts, src/desk/tile-actions.ts, src/desk/desk.ts",
    aside: "free (top), edit only (middle: ✎) and hands off (bottom: ⊘), each holding a note · an agent's open into the middle or right tile is refused, naming the policy and the person's command; its edit of the middle tile's note goes through; the left is free to navigate · ^W g cycles the focused tile, a click on a chip does too, and the person's own keys are never limited · try: ep0ch act open id=<a note> tile=<edit tile>",
    stage(n, show) {
      const free = new ReaderPane(true), edit = new ReaderPane(true), off = new ReaderPane(true);
      return deskOf({ title: "showcase · agent policy", panes: [free, edit, off], names: ["free", "edit", "off"], agents: [undefined, "edit", "off"], layout: ([a, b, c]) => splitOf("col", [leaf(a!), leaf(b!), leaf(c!)], [1, 1, 1]) }, show,
        [[free, n.notebook], [edit, n.errand], [off, n.shed]]);
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
    key: "reader-modes", need: "choose whether a reader follows the current note, keeps one, or is pinned to a page", part: "the reader tile's mode (PIE-705): ReaderPane.followMode and setMode, the mode chip on its frame (headControls), `p`, reader.mode; a saved `detail` reads as a held reader (canonSpec)", files: "src/desk/panes.ts, src/desk/builtin-tiles.ts, src/desk/tiles.ts",
    aside: "three readers, one kind: `reader` follows the outline's selection, `detail` is held on the shed note, `now` is pinned to the notebook's page · p in a reader toggles follows and held, a click on the chip on its frame (follows, held, pinned [[page]]) cycles all three, and `act reader.mode tile=<name> mode=follows|held|pinned` does it as an agent, attributed, without taking your keys · a detail is just a reader started held (^W o d); a layout saved before the merge with `kind: detail` comes back as a held reader (pinned if it had page=)",
    stage(n, show) {
      const tree = new TreePane(), follows = new ReaderPane(true), held = new ReaderPane(true), pinned = new ReaderPane(true);
      held.holdOn();
      if (n.notebook) pinned.pinTo(SEED.notebook);
      return deskOf({
        title: "showcase · reader modes", panes: [tree, follows, held, pinned], names: ["tree", "reader", "detail", "now"],
        layout: ([t, f, h, p]) => pair("row", 0.26, leaf(t!), pair("row", 0.34, leaf(f!), pair("row", 0.5, leaf(h!), leaf(p!)))),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); if (n.shed) held.hold(n.shed, d); });
    },
  },
  {
    key: "screen", need: "mount a screen in another (the board on the desk), a part of one (its lanes), or a group of tiles a tab can hold; pop one out to its full screen and back", part: "the mount (PIE-651): ScreenTile over FramedScreen, the screen's own spec on its own desk inside the tile (partSpec for a part, groupSpec for a group); its title is its spine's label; tile.open kind=screen, mount.out (^W u, ▲ full), mount.enter (^W e, ⏎ in), screen.mount (^W M) and screen.part (^W I) on a full screen, tile.group (^W G), tile.select (shift+click, ^W space), tile.into (^W i), layout.move into=/out= (a drag onto or out of a group); tile=<mount>/<tile> for act, links across the edge by path (ExtLink in src/desk/desk.ts)", files: "src/desk/screen-tile.ts, src/desk/screen-spec.ts (partSpec, groupSpec), src/desk/screen-specs.ts (mountDesk), src/showcase/frame.ts",
    aside: "the board here is the board's own spec, live, on its own desk inside the tile; the lanes under it are only its lanes row (part=lanes), whose ⏎ opens where this screen's opens land · ◂ on a mount folds it to a spine named for the screen, a click opens it · ▲ full (^W u) pops it out to the full board, q comes back to the mount where it was · ^W e (⏎ in) goes in: its own ^W and Tab, ctrl+] or esc comes out · on the reader in the tabs, ^W G gathers it into a group (`act tile.group tile=reader with=replies` puts the replies beside it): a tab holding a split · each mount keeps its own layout, selection and scroll, saved with this screen's; the cards are the outline's, shared · gathering (PIE-696): shift+click (or ^W space, tile.select) picks tiles, shown ◆ on their frames, and ^W G gathers the picked in the arrangement they had, esc lets go; ^W G in a split asks this tile or the whole split; drag a tile's title onto a group (its frame, or a drop zone inside it) to move it in, drag one out past the group's content to move it back out (layout.move into=<group> / out=true, ^W i); a link across the group's edge is a path (tile.link to=<group>/<tile>, ../<tile>) and survives all of it, the card preview here included",
    stage(n, show) {
      const args = n.hub ? { args: { hub: n.hub.id } } : {};
      const board = new ScreenTile("screen", { screen: "board", ...args }), lanes = new ScreenTile("screen", { screen: "board", part: "lanes", ...args });
      const p = new PreviewPane({ tile: "board" }), r = new ReaderPane(true), th = repliesTile(), act = new ActivityPane();
      return deskOf({
        title: "showcase · screen", panes: [board, lanes, p, r, th, act], names: ["board", "lanes", "card", "reader", "replies", "activity"],
        layout: ([b, l, c, rd, h, a]) => pair("row", 0.62, pair("col", 0.6, leaf(b!), leaf(l!)), pair("col", 0.45, leaf(c!), { t: "tabs", ids: [rd!, h!, a!], active: 0 })),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "spine", need: "squeeze a tile to a title strip", part: "the spine part: drawSpine, SPINE (c collapses a lane or a reader, alt+c opens all)", files: "src/spine.ts, on the board: src/desk/delivery.ts",
    aside: "the board's lanes take a sideways wheel or a trackpad swipe as h and l, one lane a swipe (SidewaysWheel); a click selects a card, a double click opens it, an alt-, ctrl- or middle-click opens it in a new detail; alt+↑ alt+↓, or a card dragged up or down its lane, puts it in the lane's hand-set order (card.reorder, as `act` does; `ep0ch view order <view> <id>…` from a shell)",
    stage(n) { return openScreen("board", { hub: n.hub?.id, persist: false }); },
  },
  {
    key: "entity", need: "show children, outlinks, backlinks, resources", part: "entity navigation: u, [ ] and ⏎ on links in the surface; one links model (src/links.ts: outlinks, resources, backlinks, children) drawn three ways: a row's links in the tree (L), the links tile (b in any reader), the inline ::links in a note", files: "src/surface/note.ts, src/links.ts, src/desk/tree.ts, src/desk/backlinks-pane.ts, src/authored.ts, references.backlinks in src/socket.ts, src/backlinks.ts",
    aside: "one model, one row: the tree's L (tree.links), the links tile under the reader (b; the board's dock, section 5) and the shed note's own ::links are the same rows (src/links.ts linkRows, linkRowLine) · Outlinks and Resources from blocks.authored-links, Backlinks grouped and filtered as Detail does · moving onto a resource shows what the service stores for it, read only; ⏎ registers and opens · the mouse as the keys: a click selects, a double click is ⏎, an alt-, ctrl- or middle-click alt+⏎",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = repliesTile(), links = new BacklinksPane("reader", true);
      return deskOf({ title: "showcase · entity", panes: [tree, r, links, th], layout: ([a, b, c, e]) => pair("row", 0.3, leaf(a!), pair("row", 0.66, pair("col", 0.62, leaf(b!), leaf(c!)), leaf(e!))) }, show, [], d => { if (n.shed) { d.setCurrent(n.shed); void tree.showLinksOf(n.shed, d); } });
    },
  },
  {
    key: "links-open", need: "open a picked link for real, not as a preview: in the reader it came from, or in a new detail", part: "the links tile's open (backlinks.open: ⏎ and a double click in the origin reader or the tile linked to it as a target, alt+⏎ and an alt-click in a new detail beside it) over one preview following its selection; a tile link's role (tile.link role=preview|target), said on the header", files: "src/desk/backlinks-pane.ts, src/desk/desk.ts (setCurrent, showFrom, openFrom), src/desk/screen-layout.ts (landing, defaultLinkRole)",
    aside: "the stage is what `b` makes in a detail: j k flip through the previews, ⏎ opens the pick in the detail (and the list now lists that note's links), alt+⏎ opens it in a new detail beside; tile.link role=target on a reader linked to the list keeps it still while the preview flips, and ⏎ lands in it · the header's Kind, Stage and Sort (K w s, or a click) narrow and order all three groups (a link's target decides: its kind, stage and dates), the counters X with →outlinks ♦resources ←backlinks beside it, and each control stays in its slot whatever its value · an agent's open is the same action, attributed, and never takes your keys",
    stage(n, show) {
      const d = detailPane(), links = new BacklinksPane("detail", true), p = new PreviewPane({ tile: "backlinks" });
      return deskOf({ title: "showcase · links-open", panes: [d, links, p], layout: ([a, b, c]) => pair("col", 0.4, leaf(a!), row(0.5, b!, c!)) }, show, [], dsk => { if (n.shed) d.hold(n.shed, dsk); });
    },
  },
  {
    key: "children", need: "list a note's children (a thread's replies) with its links; choose which groups a links tile lists", part: "the one links model's Children group (PIE-693): the notes under a block, with the kind and stage the service computes (blocks.facets), narrowed by Kind, Stage and Sort and counted with the rest; a links tile's groups (backlinks.groups: v, a click on the counters, the tile menu; saved with the layout); the thread tile is a links tile with Children alone", files: "src/links.ts (readChildren, ChildLink), src/desk/backlinks-pane.ts (groups, backlinks.groups), outliner src/store.ts (blockFacets)",
    aside: "left: the seed swap thread · middle: its links, every group: outlinks, resources, backlinks and ↓ children, the counters →♦←↓ across them · right: the same tile with Children alone (the replies) · w steps Stage (open keeps Ana's and Cal's), K the kind, s the sort, on every group · v (or a click on the counters) lists the groups, a click switches one · j k preview, ⏎ opens a reply in the reader, alt+⏎ in a new detail · `act backlinks.groups tile=links show=children,backlinks` does it for an agent, attributed; it never takes your keys",
    stage(n, show) {
      const r = new ReaderPane(), links = new BacklinksPane("reader", true), replies = repliesTile();
      return deskOf({ title: "showcase · children", panes: [r, links, replies], names: ["reader", "links", "replies"], layout: ([a, b, c]) => pair("row", 0.4, leaf(a!), row(0.5, b!, c!)) }, show, [[r, n.swap]]);
    },
  },
  {
    key: "links-block", need: "put a live list with a preview in a note (an outbox in a day's plan): ::links with a query, its rows and the selected one's preview inline", part: "the inline ::links component with query: and preview: (PIE-693): the links model's matches group from blocks.query and blocks.facets, the selected row previewed as the reader draws an embed of it; [ ] steps the rows, ⏎ opens one where opens land, alt+⏎ in a new detail; ⏎ on its ⏎ in goes into the list (a reader mode: j k, / filter, esc out); links.blocks, links.pick, links.open, links.enter", files: "src/links.ts (linkBlockAt, renderLinkBlock, matchesOf), src/surface/note.ts (linkBlockUI, linksMode), src/embeds.ts",
    aside: "the day's plan holds its outbox: `::links{query=\"type=letter mail=waiting\" preview=right}` lists the three waiting letters (the sent one isn't), the selected one drawn beside the list · [ ] onto a letter and the preview follows; your keys stay in the note · ⏎ opens it here, alt+⏎ in a new detail; a click selects, a double click opens · ⏎ on ⏎ in (or a click on it) goes in: j k move, / filters, esc comes out, any other key leaves and does what it does · `act links.blocks`, `links.pick n=2` (an agent's answers and moves nothing of yours), `links.open n=2`",
    stage(n, show) {
      const r = new ReaderPane(true);
      return deskOf({ title: "showcase · links block", panes: [r] }, show, [[r, n.dayPlan]]);
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
    key: "live", need: "put live data in a note", part: "live figures: ::graph-* blocks that read views with views.read and blocks.query; the comparison kinds (quadrant, matrix, compare, flow, a meter's limit) and one width rule for every kind (tier: narrow, cozy, wide)", files: "src/live.ts, src/graphs.ts, src/figures/, src/views.ts",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · live", panes: [r] }, show, [[r, n.figures]]); },
  },
  {
    key: "tabs", need: "switch a live figure's tabs, or how many lines its rows take", part: "a figure's reading state: ::graph-tabs (a query's results grouped by a property, a tab each) and a table's density, kept by the reader, switched by figure.tab and figure.density (tab shift+tab ← →, =, a click, act)", files: "src/graphs.ts, src/live.ts, src/surface/note.ts",
    aside: "[ ] onto a tab, then ← → or tab shift+tab switch; = steps compact, cozy, comfortable (titles wrap past PLOT-1 — ); a click on a tab or ≡ does the same; the note is never written; two readers of one note, each with its own tab and density",
    // Two readers on one note: each keeps its own tab and density.
    stage(n, show) { const a = new ReaderPane(), b = new ReaderPane(); return deskOf({ title: "showcase · tabs", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.plotJobs], [b, n.plotJobs]]); },
  },
  {
    key: "resource-comments", need: "comment on a Resource (a file, a fetched page): select text, C", part: "comments on a Resource's stored text (PIE-650): the reader showing a Resource takes C and m like a note; the thread is stored in the outline (annotations.batch resource-comment, threads through annotations.reconcile), quoting the selection from the file's own source and keeping the note whose link opened it as its reference context; the file is never written", files: "src/authored.ts (resourceNote, alignComments), src/socket.ts (commentOnResource, comments), src/desk/panes.ts (ReaderPane.refuses), src/draft-session.ts, outliner src/resource-comments.ts",
    aside: "left: the block whose [file::] link names the bed plan; right: the file as a Resource, one thread already on it (m lists it). Select a passage and press C (or click ⋯ comment), or act passage.select then comment.send · a file an agent rewrites keeps its threads: the service re-anchors a quote that is still there and shows the rest as they read when written · the thread also lists as a backlink of the left block",
    stage(n, show) {
      const note = new ReaderPane(), res = new ReaderPane();
      const plan = RECENT_FILES()[0]!;
      return deskOf({ title: "showcase · resource comments", panes: [note, res], layout: ([a, b]) => row(0.4, a!, b!) }, show, [], d => {
        void (async () => {
          const block = (await d.ctx.board.byProp("file", plan.file, 1))[0];
          if (!block) return;
          note.show(block, d);
          const opened = await openResource(d.ctx.board, { reference: { kind: "filesystem", path: plan.file } }, USER, block.id);
          res.show(opened.note, d);
          d.redraw();
        })().catch(() => {});
      });
    },
  },
  {
    key: "projection", need: "show a Resource's stored details in a note", part: "resource projections: resources.projection.read (the open is the one step); a ticket the extension keeps as a block drawn by ticketRegion under its jira:: line or after a ticket page's notes ([ ] ⏎ opens the ticket block, r or a click on its age refreshes, y copies)", files: "src/projection.ts, src/surface/note.ts, src/doc.ts",
    aside: "made-up tickets from a made-up extension (src/showcase/tickets, a contract 2 folder); the service fetches and keeps them as blocks, the door only reads",
    stage(n, show) {
      const r = new ReaderPane(), th = repliesTile();
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
    key: "rules", need: "decorate a block that matches a rule, or run something when it starts or stops matching",
    part: "rules (PIE-600): the service matches (a property, a query, a text pattern, a kind) and sends decorations with resources.projection.read; planDecorations lays them out and primitiveLines draws them (band, track, card) above, below, in place of or around what matched; R (decor.raw) shows the note as written",
    files: "src/decorations.ts, src/projection.ts, src/components.ts, src/doc.ts",
    aside: "meeting-card (decorate), done-stamp (on: start stamps [done-at::], stop takes it off) and shout (a text pattern) are the outliner's example rules; the bands are a rule note under the meeting, no code. Set the job's status to done (i on it) and watch it get stamped",
    stage(n, show) {
      const r = new ReaderPane(), job = new ReaderPane();
      const d = stageDesk({ title: "showcase · rules", panes: [r, job], layout: ([a, b]) => row(0.62, a!, b!) });
      show(ctx => {
        if (!n.rules) return;
        r.show(n.rules, d);
        d.setCurrent(n.rules);
        // The job done-stamp watches is under the meeting: read it, then show it beside.
        void ctx.board.children(n.rules.id).then(kids => { const m = kids.find(k => k.text.startsWith("Mend the water butt")); if (m) job.show(m, d); }, () => {});
      });
      return d;
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
    aside: "Obsidian's own examples, nested three deep, folded with - and open with + · ( ) then f, or a click on a title, folds one; z opens them all · ⏎ or a click on an icon opens the type choice (- and + there make it start folded or open) · e, then > [! offers the types with their icons · the right reader declares a type of this outline's own · every callout, quote and code block has a dim ⧉ at its top right edge: a click, y with [ ] on it, or `act block.copy n=…` copies its text as written, without the frame, bars or > markers, and says \"copied N lines\" (an agent's copy is returned, never put on your clipboard); a click on an inline `code span` copies its contents, backticks left out · Y (nothing selected), the tile menu's \"copy note\" or `act note.copy` copies the whole note's source, \"copied the note, N lines\" · a drag across them copies the words only (`act blocks` lists them)",
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
    key: "hero", need: "let a note's opening picture become its header's background as it scrolls away", part: "the header's backdrop (PIE-598, src/surface/hero-header.ts): NoteSurface finds the hero (the header image, a [layout::hero] image, or an image that is the note's first block) and how far it has gone under its sticky header; the media pipeline makes the muted, dimmed variant (src/media.ts Look mute, a PNG under Kitty graphics, one colour per cell otherwise); reader.hero turns it off, kept like the theme", files: "src/surface/hero-header.ts, src/media.ts, src/doc.ts (coverCrop), src/surface/note.ts, src/screens.ts (reader.hero)",
    aside: "j, the wheel or space scrolls the picture up under the header: the header takes it, dimmed, by steps · [hero-focus::x,y] on the picture's line says what the crop keeps · `act reader.hero on=false` turns it off everywhere, `mode=follow` makes the header follow each picture down the note (kept for the next start) · Kitty draws the picture under the text; cells colour each cell from it · the river column on the right keeps the same header above its scroll",
    stage(n, show) {
      // A reader and a river column on the same note: the column keeps the reader's header above its scroll too.
      const r = new ReaderPane(), col = new RiverColumn({ kind: "block", id: n.hero?.id ?? "" });
      return deskOf({ title: "showcase · hero header", panes: [r, col], layout: ([a, b]) => row(0.6, a!, b!) }, show, [[r, n.hero]], d => { if (n.hero) col.hold(n.hero, d); });
    },
  },
  {
    key: "title", need: "make a note's title the first thing the eye finds when it is open", part: "the reader's header (PIE-657, NoteSurface.headerBlock, one builder for every reader): the crumbs as a dim eyebrow, the title bold and bright (the theme's brightest in the focused tile, a step down in the others; twice the height through text sizing, OSC 66, src/text-sizing.ts, where the terminal answered the start-up query), one dim line under it for the byline, the property count and the summary values (links), one blank row; the tile's frame bar says the title only when the header is not on screen (NoteSurface.titleShown)", files: "src/surface/note.ts, src/text-sizing.ts, src/display.ts, src/desk/desk.ts",
    aside: "the left reader has the keys, the right one doesn't: compare the titles · a click on a value in the dim line still opens what it names · `peek` and `layout.get` keep the title as data (the tile's `title`, the reader's `showing`), and the reader's rows start with the breadcrumb, then the title · EP0CH_SIZED=0 turns the double height off, =1 forces it where the door doesn't ask (inside Herdr, tmux or screen it is off, and the title is bold on one row) · the narrow reader beside holds links that wrap: each keeps its colour and its click on every row · a copy over the title copies its text; a selection on it draws in cells",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · a title you can find", panes: [a, b], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.title], [b, n.title]]);
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
    key: "newnotes", need: "make a new note or page from anywhere", part: "note.new (ctrl+n on every screen, in an edit too, + on the menu, act) asks the service's notes.create, whose placement rule puts it (under the note in the reader you're in, else the top of the Inbox), then opens it where the screen spec's newNote says (PIE-591): a float over the screen by default, by the layout engine's own float (as many as you like, cascaded; its title drags it, onto a header or the edge docks it; × or esc on it still empty trashes it), a tab, your drawer, or the board's lanes' card.new; a missing [[page]] is offered, then made by page.create (pages.follow, the same rule); a lone [page::x] titles itself (outline-core's page-title rule, on ⏎ and on every save)", files: "src/new-note.ts, src/desk/desk.ts (editNew, openNoteTile, floatDock), src/desk/screen-spec.ts (newNote), outline-core/src/page-title.ts, outliner src/note-placement.ts, src/surface/note.ts",
    aside: "go in (⏎), then ctrl+n, ctrl+n, ctrl+n: a floating note each, under this one, the newest with your keys · type, ctrl+n again: what you typed is saved, the next floats · drag a float's title onto this reader's header: it docks as a tab · × or esc on an empty one puts it in the trash · ] to [[Seed swap ledger]], ⏎ offers it, ⏎ again makes it in the Inbox · type [page::2026-03-12] and ⏎ on the first line of a new note",
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
  {
    key: "wkeys", need: "see every ^W key, find one by its letters, and run it by key, mouse or act", part: "the ^W keys (PIE-704): one table (desk/wkeys.ts, W_KEYS) that the chord handler reads, the keys box and hint row are generated from, and the tile menu's `ctrl+w` rows agree with; each key's words are joined from its action (the menu row, else the summary). `^W ?` or a click on \"all keys\" opens the power bar's actions scope on the ^W prefix, grouped, filtered by the bar's matcher, ⏎ pressing the key", files: "src/desk/wkeys.ts, src/desk/desk.ts (command, wSpecial, wRows, wChord), src/bar/sources.ts (wKeyRows), src/surface/dispatch.ts (defOf)",
    aside: "press ^W: a box above the hint row lists the most-used keys, a line per group, and the hint row says only \"all keys · esc\" · ? (or a click on \"all keys\") opens the whole list: every ^W key under its group (focus & move, size & shape, tabs, open, mounts & groups, drawer, layouts & more) with its keycap · type to filter (\"gather\", \"drawer\", \"zoom\"), ⏎ or a click presses it, as the key would · a key that waits for another (m, t, o) leaves the desk waiting for it · `act bar.open scope=actions query=\"^W \"` answers the same rows to an agent, and `act bar.pick query=\"^W zoom\" scope=actions` runs one as the agent, never taking your focus",
    stage(n, show) {
      const a = new ReaderPane(true), b = detailPane();
      return deskOf({ title: "showcase · ^W keys", panes: [a, b], names: ["reader", "shed"], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[b, n.shed]], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "made", need: "make a screen of your own: start blank, build it, save it, open it by name", part: "the blank screen (one tile whose rows are blank.fill and blank.screens, the layout's replace) and screen notes: screen.save writes the screen as a [type::screen] note, its spec as data, which every door on the outline registers (screen.open, --screen, ^W r)", files: "src/desk/blank.ts, src/desk/screen-notes.ts, src/desk/screen-spec.ts, src/desk/tile-actions.ts",
    aside: "a blank screen: t r d s Q (or a click on a row) puts the outline, a reader, a detail, a terminal or a query lane in its place; ^W o, ^W v and alt+l build the rest; ^W w saves it as a screen note in this outline, and `ep0ch --screen <name>`, screen.open or the blank tile's o opens it again · name it the way you'd say it (allotment work is kept as typed and opened as allotment-work too; the prompt shows what it saves as, or why it can't, as you type) · `act blank.fill kind=tree tile=blank`, then `act screen.save name=allotment-work`: an agent builds and saves one the same way, and the answer says the slug",
    stage() { return openScreen("blank", { persist: false }); },
  },
  {
    key: "esc", need: "close what popped up (a picker, a menu, a box, a mode, a dock); say there's nothing left to close", part: "the Esc rule: Esc closes the innermost temporary thing (a picker or menu, the keys box, a ^W chord, link mode, a filter, a dock or the drawer, a zoom, a float's keys, an empty edit, a selection), each through its own action, and never leaves the screen: with nothing left, nothingToClose says so (q leaves)", files: "src/shell-keys.ts, src/desk/desk.ts, src/showcase/frame.ts",
    aside: "go in (⏎), then ^W z zooms the reader, ] lights a link in it and ^W . opens its menu: three things open · each Esc closes one, innermost first (the menu, the link, the zoom) · the next hands the keys back to this index, and one more says nothing to close · q leaves",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · esc", panes: [a, b], names: ["reader", "beside"], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[a, n.notebook], [b, n.shed]]);
    },
  },
  {
    key: "refusals", need: "say why a key or click did nothing, where the person is looking", part: "the refusal path (PIE-727): Ctx.refuse, which the dispatcher's press calls for every refused action of the person's key or click (ActionRefused), and which nothingToClose, a spine's keys, the tile menu's dimmed rows, a frame's unsaved pop and the hyper layer call through refused(); the desk's tile frame says it on the focused tile's hint row in the warning tone (refusalHint), loud (bold, on the amber surface capped dark, the frame amber) when the same key is refused again, until a different key; the status bar keeps its copy", files: "src/app.ts (refuse, refusal), src/shell-keys.ts (refused), src/surface/dispatch.ts (asPerson), src/desk/desk.ts (drawTile, refusalHint)",
    aside: "go in (⏎): the keys are on the shed note, folded to a spine, on a locked screen · press x: the spine has no edge to say it on, so the hint row under it says why, in amber (the status bar too) · Tab to the notebook and press ^W x: the screen is locked, and the reader's own bottom edge says so · ^W x again: it stays up, bold on a dim amber band, the frame amber, until you press a different key · a click on the dimmed close row of its ⋯ menu says why the same way · on a desk holding only a group, q leaves the screen as on any desk (it used to be refused, on the status bar alone)",
    stage(n, show) {
      const shed = detailPane(), a = new ReaderPane(true);
      return deskOf({ title: "showcase · refusals", panes: [shed, a], names: ["shed", "reader"], layout: ([x, y]) => row(0.35, x!, y!) }, show, [[shed, n.shed], [a, n.notebook]], d => { d.collapseTile("shed", true, USER); d.lockScreen(true, USER); });
    },
  },
  {
    key: "headings", need: "divide a page more strongly than a plain heading: a heading with a band, a rule that fades", part: "heading styles (PIE-599): ## text [heading::band] and --- [rule::fade] stay Markdown; the style (a glyph track of the figures', rows, alignment, padding, margin, tone, lettering) is the outline's, as callout types are (outline-core's built-ins plus [heading-style::name] declared on any line, headings.styles; a style can be a level's default; one heading's own [heading-tone::amber] restyles it alone), drawn by src/figures/banner.ts; under the figures' narrow tier, the heading or rule as written", files: "outline-core/src/heading-styles.ts, src/heading-styles.ts, src/outline-lists.ts, src/figures/banner.ts, src/doc.ts",
    aside: "the same note in two readers: the wide one draws the bands, the narrow one (under 48 columns) the headings as written · ( ) stops on a styled heading, f folds its section · three ways: a named style, one heading's own fields (Odd jobs takes amber, Tool shed its own pattern), and the plot style declared on a line of this note ([heading-style::plot], drawn as what it declares): change its [heading-pattern::] and the band changes, no door change · Detail and the publisher show the heading as written",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · headings", panes: [a, b], names: ["reader", "narrow"], layout: ([x, y]) => row(0.72, x!, y!) }, show, [[a, n.headings], [b, n.headings]]);
    },
  },
  {
    key: "style", need: "tune spacing, list density, surfaces and frames live, with no agent and no build: a tile's padding, a note's measure and margin, a list's gap, dividers and zebra, a tile's or a box's background, border and edge, a header's surface and picture, heading spacing, per width", part: "the style cascade (PIE-673, PIE-675): outline-core's style-cascade.ts resolves base → component → global → tile kind → screen → page → block, from [style-for::…] notes the service lists (styles.list, kept live as heading styles are), for every renderer; the desk draws a tile inside its padding and measure, the reader its margin and list rows, a list tile through one list painter; the tune inspector (alt+y, ^W o y, the tile menu, tile.tune) shows each value and where it comes from, nudges it in the next frame from memory, and saves it to the level picked; surfaces are the theme's roles (theme.ts surfaceMix: raised, sunken or a tone, capped dark), a tile's under its content and yielding to a header's picture, a box's inside its frame", files: "outline-core/src/style-cascade.ts, src/look.ts, src/desk/tune.ts, src/list-look.ts, src/theme.ts (surfaces), src/canvas.ts (BORDER_BOXES, under), src/desk/desk.ts (contentRect, drawTile), src/doc.ts, src/surface/note.ts (headerSurface, heroSources)",
    aside: "the Spacing lab page uses the lab style ([style::lab]) the Looks lab note declares ([style-for::lab]): e there, change [style.list.gap::1] to 2, ctrl+s, and the page restyles in every door · the tune inspector beside it lists each value and its source (built-in, global, the tile's kind, the screen, the page, a box): j k pick, + − or the wheel over a value nudge it (a row is about two columns, so pad moves 1 row and 2 columns), v the level it saves to, w for this width only (the breakpoint it's in now), s save, u and U undo and redo every nudge and save of the session (each said on the status line), x (or a row's ×) resets one value to what it inherits (a width variant first), X resets the level picked and R reverts every style note the session wrote (both asked in place: the key again, or [confirm]); with a level or a width picked, each row shows what that level says itself, and a row something nearer wins is marked ⊘: a nudge there offers a (anyway), o (nudge what wins) or c (clear it); levels go down to this tile (v to this tile, kept in the tile's spec) and this list (its heading or lead-in line, as Hardy ones does: [ ] onto its heading, v to this list); a surface's row shows a swatch of it, and + − on header.image steps through the note's pictures · the lab tile sits on a raised surface with a violet bar; its first box has a green stripe and bar, its second a sunken surface in a round amber frame with ✦ dividers; scroll the beds picture under the header and the header takes it, cropped 15% higher · quitting with nudges unsaved says so · spacing is drawn, never text: a drag copies the note's words, wrapped lines joined, with no margin, gap or divider in them (a terminal's own shift-drag copies the screen's spaces) · Detail and the publisher read the same tokens next (the publisher as CSS); ep0ch export leaves the look out",
    stage(n, show) {
      const lab = detailPane(), tune = new TunePane("lab"), links = new BacklinksPane("lab", true), looks = detailPane();
      return deskOf({ title: "showcase · style", panes: [lab, tune, links, looks], names: ["lab", "tune", "links", "looks"], layout: ([a, b, c, e]) => pair("row", 0.55, leaf(a!), pair("col", 0.55, leaf(b!), row(0.5, c!, e!))) }, show, [], d => { if (n.spacingLab) lab.hold(n.spacingLab, d); if (n.looksLab) looks.hold(n.looksLab, d); });
    },
  },
  {
    key: "library", need: "say what a component's properties are once: its docs page and completion for its keys and values", part: "component schemas (PIE-618, PIE-701): outline-core's component-schema.ts says each component's properties once (heading styles, callouts, rules, every ::graph-* figure, ::links and its kin, ::box, pictures and header images, embeds, code fences, tables: a test fails when a component the readers draw has none; an extension's in extension.json), the service merges the outline's own values in (components.schemas); the library screen draws a page per schema (an overview and its table, each value with its source, the grids, every combination behind a filter, at 40, 80 or 160 columns) through the readers' renderer, and the completer offers [key:: and its values from the same answer", files: "outline-core/src/component-schema.ts, outline-core/src/component-schemas-figures.ts, outline-core/src/component-schemas-blocks.ts, src/library/library.ts, src/library/draw.ts, src/component-schemas.ts, src/surface/completer.ts, src/library/cli.ts",
    aside: "the library on this outline: [heading::] lists the plot style its note declares · , . the component, 1-4 the part, ← → the property or grid, [ ] ← → space to pick in every combination (x clears, n p page), j k a variation, y copies its source, w its width; every one a click too · e in a reader, then [head or [heading-pattern:: completes from the same schema · ep0ch library --out <dir> writes the pages as Markdown for the publisher",
    stage() {
      return openScreen("library", { persist: false });
    },
  },
  {
    key: "bar", need: "find anything from anywhere: a tile on any screen, a note, an action, what changed, a screen, an extension's rows", part: "the power bar (PIE-656, src/bar/): one palette over every screen and the drawer (ctrl+k, cmd+k, the status bar's ^K; the desk's / and the river's g in its notes scope), a list picker with its line, scopes along the top (% tiles, / notes, > actions, + recent, @ screens, an extension's own prefix; tab cycles), the lit row read on the right by the readers' renderers; its rows are sources' (registerBarSource): the layout tree's tiles (Desk.tileOutline), the service's one search, the dispatcher's actions (the focused tile's menu, then every action needing no argument), the what-changed store, screen.list, and an extension's bar[] through extensions.bar; a pick is bar.pick, through the drawer's goTo (a spine opened, its screen brought up), open, the dispatcher's press or extensions.act", files: "src/bar/bar.ts, src/bar/source.ts, src/bar/sources.ts, src/bar/actions.ts, src/extensions.ts (bar sources), src/app.ts, outliner src/extension-calls.ts (extensions.bar)",
    aside: "ctrl+k (or a click on ^K at the status bar's left), anywhere: with nothing typed, the tiles open on every screen and in your drawer, indented as each screen's layout tree (● has the keys, ▸ a spine, ⧉ a float, ⇤ docked), then what others changed · type to look through everything at once, or start with % / > + @ (tab cycles) for one source · ⏎ or a double click goes: a tile gets the keys (the folded detail here opens from its spine; one on a screen under this one brings it up), a note opens where opens land, an action runs; alt+⏎ zooms a tile or opens a note in a new detail · esc puts it away · with the outliner's glyphs example installed, ~shade lists its rows, and on a note it offers to rule it · every scope finds a note by what names it: its title, its work id (PLOT-4) and its page name, and its rows read the way /notes does, `PLOT-4 Order the seed potatoes` · / with nothing typed lists the notes changed most recently first (the service's recency and what others changed, agents included), so / then ⏎ opens the latest; type and it runs the one search · `act bar.open query=… scope=…` answers the rows to an agent and opens nothing; `act bar.pick n=… query=…` picks as the agent, never your keys",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), a = detailPane(), b = detailPane();
      // The outline beside a reader over two details side by side: the tree's shape in the bar; the second detail folded to a spine.
      return deskOf({
        title: "showcase · power bar", panes: [tree, r, a, b], names: ["outline", "reader", "shed", "pears"],
        layout: ([t, rd, x, y]) => pair("row", 0.28, leaf(t!), pair("col", 0.5, leaf(rd!), pair("row", 0.5, leaf(x!), leaf(y!)))),
      }, show, [[a, n.shed], [b, n.notebook]], d => { if (n.whiteboard) d.setCurrent(n.whiteboard, { reveal: true }); void d.collapseTile("pears", true, USER); });
    },
  },
  {
    key: "hyper", need: "reach the door's own actions from anywhere, even while typing in a draft or a terminal tile, and see what a chord arrives as", part: "the hyper layer (PIE-699): ⌃⌥⇧⌘ and a key (Kitty modifiers 15) read before any tile's own keys, one keymap (HYPER_KEYS), optional and off by default (EP0CH_HYPER=1, or hyper.set on=true); keys.probe shows exactly what a chord arrived as; bare - + = fold and open the focused tile (the folds section)", files: "src/hyper.ts, src/key-probe.ts, src/kbd.ts, src/app.ts",
    aside: "off by default: `ep0ch act hyper.set on=true` (or EP0CH_HYPER=1) turns it on, and the hint row ends ✦ hyper · then ✦p the power bar, ✦h ✦j ✦k ✦l move the keys, ✦1-✦9 a tile, ✦- ✦= fold and open it, ✦z zoom, ✦n a new note, ✦g a screen: from inside a draft (the edit is left or kept as a click away would) and from inside the shell on the right · each is also a key, a click and an act · `ep0ch act keys.probe` (or a click on the ✦ hyper chip) then any chord: the status bar shows its bytes, modifiers and the key the door read, which is how you learn what your terminal, Herdr and ssh pass · a terminal that sends no Kitty reports can't send hyper at all",
    stage(n, show) {
      const r = new ReaderPane(true), term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: with the layer on, a hyper chord still reaches the door from here'; exec sh"], label: "shell" });
      return deskOf({ title: "showcase · hyper", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
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
      f = new FramedScreen(screen, () => this.ctx, () => { this.focus = "index"; }, () => after?.(f!.ctx), () => this.focus === "stage" && this.sel === i,
        () => void this.dispatch.pressIn(SHOWCASE_ACTIONS, "section.leave", {}));
      this.stages.set(i, f);
    }
    return f;
  }

  /** Screen.tilesHere: the section shown is a desk: a tile taken out of the drawer here (tile.drawer on=false) lands in it. */
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
    if (k.kind === "esc") return nothingToClose(ctx);
    if (c === "q") return this.shell("screen.back");
    if (isUp(k)) return this.sel > 0 ? this.run("section", { name: String(this.sel) }) : undefined;
    if (isDown(k)) return this.sel + 1 < SECTIONS.length ? this.run("section", { name: String(this.sel + 2) }) : undefined;
    if (/^[0-9]$/.test(c)) return this.run("section", { name: c === "0" ? "10" : c });
    if (k.kind === "enter" || k.kind === "right" || k.kind === "tab" || c === "l") return this.run("section.try", {});
    if (c === "V") return this.shell("video.cycle");
  }

  /** A key or click on the index as the person: the showcase's own action. A refusal is said. */
  private run(name: "section" | "section.try", args: { name?: string }) { void this.dispatch.pressIn(SHOWCASE_ACTIONS, name, args); }
  /** The shell's q and V (src/shell-keys.ts: screens.ts imports this module). */
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
  async editNew(m: Msg, how?: NewNoteHow): Promise<string | null> {
    const f = this.stage(this.sel);
    if (!f?.top.editNew) throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section has no reader to write a new note in`);
    const was = this.focus;
    this.focus = "stage";
    const at = await f.top.editNew(m, how).catch(e => { this.focus = was; throw e; });
    if (!at) this.focus = was;
    return at;
  }
  /** The shown stage's own new-note rule, and its edit where ctrl+n is still a note (PIE-591), while the keys are in it. */
  newNoteRule(): NewNoteRule | null { return this.focus === "stage" ? this.stages.get(this.sel)?.top.newNoteRule?.() ?? null : null; }
  /** Screen.leaveTyping: a hyper chord moving the keys (PIE-699) leaves the stage's edit first. */
  leaveTyping(): boolean { return this.focus !== "stage" || (this.stages.get(this.sel)?.top.leaveTyping?.() ?? true); }
  newNoteWhileTyping(): boolean { return this.focus === "stage" && !!this.stages.get(this.sel)?.top.newNoteWhileTyping?.(); }
  /** An agent's new note shown on the stage (note.new opens=), never taking the person's keys. */
  async showNew(m: Msg, opens: NewNoteOpens, actor: Actor): Promise<string | null> {
    const f = this.stage(this.sel);
    if (!f?.top.showNew) throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section has no tiles to show a new note in`);
    return f.top.showNew(m, opens, actor);
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
  "section.leave": def({
    summary: "the person's keys back from a section's stage to the index. The person's only, as going in is",
    keys: "esc in the stage once its part has nothing left to close (q where the part leaves)",
    touches: "screen", replay: "safe", person: "the person's keys are theirs: an agent doesn't take them out of a section",
    args: {},
    run(_, s) {
      s.pick(s.shown, false);
      return { section: s.shown + 1, key: SECTIONS[s.shown]!.key, in: s.focusName() === "stage" };
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

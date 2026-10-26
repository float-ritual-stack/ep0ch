import { LibraryPane } from "../library/library";
import { errorDetails } from "../status-log";
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
import { C, fg, pad, paint, RESET, selectedRow } from "../style";
import { wrap } from "../text";
import { ch, isUp, isDown, type Key } from "../term";
import { ActionRefused, actionSet, def, type ActionInfo, type ActRequest } from "../surface/actions";
import { Dispatcher } from "../surface/dispatch";
import { screenKeys } from "../whereabouts";
import { draftPreview, NOTE_ACTIONS } from "../surface/note";
import { actionPage } from "../surface/action-page";
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
import { FacetsPane } from "../desk/facets";
import { TunePane } from "../desk/tune";
import { MessageReader, StatusMessages, SHELL_ACTIONS } from "../screens";
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
import { findShowcase, KEPT, loadShowcase, LOGS, MARGIN_LINES, MARGINALIA_FILE, RECENT_FILES, SEED, type SeedName } from "./seed";
import { openResource } from "../authored";
import { RowView } from "../scroll";
import { WaitingYouPane } from "../desk/waiting-you";
import { AccessMatrixPane } from "../desk/access-matrix";
import { accessDemoEnv, seedAccessFiles } from "./seed/access";
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

/** The words the session section's half-written comment is on (the notebook's). */
export const SESSION_QUOTE = "The water butt is half full";

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
  const root = serializeTree(tree, (i: number): TileSpec => ({ t: "leaf", kind: st.panes[i]!.kind, name: names.get(i)!, ...(st.panes[i] instanceof PreviewPane && "tile" in st.panes[i].source ? { source: `tile:${st.panes[i].source.tile}` } : {}), ...(st.panes[i]!.deliberate ? { deliberate: true } : {}), ...(st.agents?.[i] ? { agents: st.agents[i]! } : {}) })) as SavedTree;
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
  const on = await board.get(n.logBeans!.id);
  await board.comment(crypto.randomUUID(), on!.id, on!.revision!, `See ((${n.title!.id}|HOME-042)) for the plan.\nThe log and the work item are different notes.`, null, GARDENER);
}

/** A whole Markdown document pasted into a note by mistake (fictional): the undo section's big paste. */
export const PANTRY_PASTE = ["", "# Pantry inventory", "", ...Array.from({ length: 36 }, (_, i) => `- ${["oats", "lentils", "rice", "flour", "honey", "tea"][i % 6]}, shelf ${1 + (i % 4)}, jar ${i + 1}`), "", "_Counted on a rainy Sunday._", ""].join("\n");

export const SECTIONS: Section[] = [
  {
    key: "note", need: "render or read a note", part: "NoteSurface, hosted through SurfaceHost (a ReaderPane; the BBS message reader)", files: "src/surface/note.ts, src/doc.ts, outline-core src/code-ranges.ts, src/inline.ts",
    aside: "the notebook's tags, written with its properties (#allotment #beds), are one row of tag links under the byline · the notebook's embeds read quietly: a dim, clickable » source line and a dim bar (src/embeds.ts); only a problem heading stays loud · a link to the web (the allotment society) is the theme's blue-violet with a ↗, apart from the cyan of a link into the outline (theme.external, PIE-646) · open “A note left half-written” (act open id=…): a fence and a [[ left open cost only themselves, the fence its paragraph, and ⚠ rows above the note say each and how to close it (PIE-669)",
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
    aside: "End (or G) puts the last cane on the bottom edge; End again brings it up to the middle, blank under it · the wheel, PgDn and space go on past the edge too · e opens it as a draft: typing on the last line keeps rows under the cursor · `act reader.overscroll rows=none` stops at the edge everywhere, `rows=half` (the default) or a number of rows (kept for the next start) · an agent's view.get says atEnd and past",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · past the end", panes: [a, b], names: ["reader", "short"], layout: ([x, y]) => row(0.62, x!, y!) }, show, [[a, n.overscroll], [b, n.shed]]);
    },
  },
  {
    key: "actions", need: "let a person or agent do anything",
    aside: "The page shows arguments and the answer shape from the action itself. Try act layout.move where=rigth: it suggests where=right. beside= needs into= or out=true, and tile.link ask= cannot also name to=. tile.open kind=reader note=<id> keeps that note; a tree refuses note= with the call it takes. Answers give tile=<id> and its name: pass tile back to tile.info. layout.get still answers while the message log is open.", part: "the action registry: ActionDef in an ActionSet; keys and `act` call it", files: "src/surface/actions.ts, src/control.ts",
    stage(n, show) {
      const r = new ReaderPane();
      const list = new ActionsPane();
      const d = deskOf({ title: "showcase · actions", panes: [list, r], layout: ([a, b]) => row(0.55, a!, b!) }, show, [[r, n.whiteboard]]);
      list.run = (name, actor) => d.dispatch.act({ action: name, tile: "2" }, actor);
      return d;
    },
  },
  {
    key: "edit", need: "edit text, complete ::component [[ (( [file:: [key:: in any text input (a draft, a property value, a filter)", part: "the editing component: Draft, edit control, completer, DRAFT_ACTIONS (lists, wrap, mouse, preview, unsent); the property panel (i, I)", files: "src/edit.ts, src/surface/editor.ts, src/surface/completer.ts, src/surface/props-panel.ts, src/arm.ts",
    aside: "Ctrl+p shows the live edit preview. Its header placement chip uses the comment box and Sources menu: choose beside to read draft and preview side by side, below, floating, popup or tile. Drag the divider to size beside; the choice is kept for next time. A floating preview moves and sizes across both margins of a centred reader, like comments and Sources, while the text column stays still. Ctrl+p still hides it. In raw edit, type :: alone on a source line: one row per component, grouped by its schema and ranked by recent use. Type words to search its name, title and description; right or > opens variations and arguments, left returns. After {, its schema offers attribute names; inside a value, its type offers properties, facet values, references, actions or enum choices. Arrows, wheel or a click select and preview. Enter, Tab or a double click inserts the ready example, with its first value selected; one undo removes it. Reference completion uses up to half the tile height, below the typing line or above it when needed, then beside it. Its header echoes the token and scope chips; matched letters light in the rows, and scrolling loads more results. The reader preview has one header line and opens at the matching passage. Type ((Gree, then ^: the passage stays in its note, scrolled to it and lit. Shift+up/down, wheel over the preview or PgUp/PgDn scrolls it; click previews, Enter or double click inserts. The next (( starts with notes again. act complete text=::graph offers the same ready blocks (PIE-1013). On a heading, type ## Calls :: or an open [heading:: to choose a style (PIE-1012). Type ## Plans for the heading: and press Enter: it makes a new line. Even with styles offered, Enter makes a new line until you choose with arrows or a click, or open the popup with Tab/ctrl+space. A closed ] opens nothing · ctrl+l on a link opens it beside the edit, which stays open; a click on a link in ctrl+p's preview too · ctrl+p's preview expands an embed as the reader does, before you save: paste !((…^t-7a9c11)) from the notebook and the tap's step shows under the edit; a wrong anchor says MISSING FRAGMENT with a did-you-mean you can click (PIE-852) · ctrl+v puts in the clipboard's picture, and a file dropped on the terminal goes in as a picture: kept in the outline's folder, [img::…] on its own line (PIE-592) · e asks first (edit.arm): the status bar says edit <title>? ⏎ · any other key cancels and the reader's frame turns the edit's yellow; ⏎ or e again opens it, any other key lets it go and does what it does, two seconds let it go quietly · while the edit reads its note, typing stays with that draft and repeats of the opening key are consumed; a command or mouse click cancels the open and runs normally · if the read fails, the reader offers tile menu: recover typed text, to copy it or open the edit with it inserted; a copy stays in drafts/ · the ⋯ menu's edit row and an agent's edit open at once · edit.arm.set on=false (or EP0CH_EDIT_ARM=off) opens on the first e · the tile with the keys is the double-lined one · an edit stays open when the keys go to another tile (a click, ^W, an agent's open elsewhere): dim, its title \"(kept open)\", nothing saved; a click or the keys back are in it at the same place (PIE-812) · every place you type outline text completes, with one attachment point (PIE-626): a Draft (a note, a comment or reply, the board's composer, a new note's float) and a LineInput (the property panel's value: i, ⏎ on a row, type; a river column's / filter: type:, -status:) offer [[ (( [file:: a callout's > [! and [key:: from the same completer (↑↓ ⏎ tab esc, a click, ctrl+space); a filter offers the outline's own keys and values, most used first, from the property index and the schemas; a line holding a name or plain words says so ({ complete: false}) · act: complete text=… (key=heading for a panel value), column.complete text=…",
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
    key: "deep-links", need: "link to a passage of a note: a ((reference)) refined to an anchor, adding one where there is none", part: "the completer (PIE-762): ((words lists the top notes with their ^anchors under them; ^ or # typed in a finished ((id)), or just after it, opens it again (reopenReference) and the popup searches inside that note (fragments.candidates with blockIds, mode passage: its anchors first, then headings, paragraphs, list items, quotes and callouts); choosing one with no anchor adds it through fragments.ensure, attributed, and links it as one choice; PIE-592: !((words lists the top note's headings, quotes and callouts with no anchor yet under it, and a quote's or callout's embed carries all of it; agents: complete refine=^ then insert=n",
    files: "src/surface/completer.ts, outliner src/fragment-search.ts, outliner src/fragments.ts",
    aside: "Reference completion floats beyond the tile, with the list beside the note. Shift+up/down, wheel over the preview or PgUp/PgDn scrolls it; click previews, Enter or double click inserts. A new (( starts with notes. Go in (⏎): the right reader is writing a comment on the guide, the left one shows the Greenhouse meeting · type ((Gree: the meeting, with ^a10 and ^decision under it · choose the meeting, then ^ right after its )): the meeting's anchors first, then its passages, each saying the anchor it would get · choose one of those and the meeting gains it (left), the comment gets ((id^anchor)) · click inside a finished ((…)) and type ^ or # to refine it again · an unclosed (( sends with a warning, never lost (PIE-761) · the triggers stay in the completer until ADR 0004's source contract (PIE-750) moves them to outline-core",
    stage(n, show) {
      const a = detailPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · deep links", panes: [a, b], names: ["meeting", "guide"] }, show, [[a, n.meeting], [b, n.deepLinks]], d => {
        // The person's own keys would do this: a comment on the guide, through the stage's dispatcher, in the guide's tile.
        void d.press(b, NOTE_ACTIONS, "passage.select").then(() => d.press(b, NOTE_ACTIONS, "comment.write", { body: "" }));
      });
    },
  },
  {
    key: "composer", need: "write a comment, question or reply where the person is reading: at the passage, floating beside it, split beside the note or in a popup",
    part: "the composer's placements (PIE-770, src/surface/composer.ts): the comment session's draft (CommentSession, one DraftSession, the one edit control: renderEditor) drawn in the reader's own note, a box of rows under the passage (inline), laid over it (floating, popup) or sharing the reader's rect (split); composer.place is the setting, comment.place (ctrl+o, the box's chip) moves the one being written; PIE-785: the comment stays open when the keys go to another tile (Desk.leaveSession, keepsOnFocusAway) and is the person's again when they come back, a floating box drags and sizes (comment.move: its top edge, its ◢ corner, ctrl+g's comment.grip mode) for this sitting only (CommentSession.float), and following a link with it unsent asks in the power bar (askInBar, src/bar/ask.ts; comment.leaving answers: save and continue keeps it unsent through its DraftSession, discard lets it go); a posted thread and the preview draw references and embeds through the reader's renderer (NoteSurface.snippet)",
    files: "src/surface/composer.ts, src/comment.ts (composerFrame), src/surface/note.ts (layOut, overComposer, renderSplit, comment.place, comment.move, comment.grip, comment.leaving, askLeave), src/surface/editor.ts, src/screens.ts (composer.place), src/desk/desk.ts (leaveSession, reenter)",
    aside: "four readers on one note, each writing a comment in another place: inline (top left, under its line), floating (top right), split (bottom left) and popup (bottom right) · select words with the mouse and press C: the box opens where you are, the note still scrolls around it · ctrl+o (or a click on the chip) moves it · drag a floating box's ≡ top edge to move it and its ◢ corner to size it, or ctrl+g then the arrows (shift: size); opened again, it's in its usual place · click another tile and back: the box is there as you left it · click a link while it's unsent: the power bar asks, save and continue, keep writing, or discard · ctrl+s saves and the thread sits in place, references and embeds drawn · an agent's comment lands as a thread, never in your box",
    stage(n, show) {
      const places = ["inline", "floating", "split", "popup"] as const;
      const readers = places.map(() => Object.assign(new ReaderPane(), { deliberate: true }));
      return deskOf({ title: "showcase · composer", panes: readers, names: [...places],
        layout: ([a, b, c, d]) => pair("col", 0.5, row(0.5, a!, b!), row(0.5, c!, d!)) }, show, readers.map(r => [r, n.margin] as [ReaderPane, Msg | undefined]), d => {
        // The person's own keys would do these: a comment on each reader's line, through the stage's dispatcher, then its place.
        places.forEach((place, i) => {
          const r = readers[i]!;
          void d.press(r, NOTE_ACTIONS, "passage.select", { quote: MARGIN_LINES[place] })
            .then(() => d.press(r, NOTE_ACTIONS, "comment.write", { body: "" }))
            .then(() => d.press(r, NOTE_ACTIONS, "comment.place", { place }));
        });
      });
    },
  },
  {
    key: "comment-tile", need: "write a comment and still see the whole note: on the whole note or on selected words, in a tile of its own that docks, its text and preview scrolling under the wheel, its pictures drawn",
    part: "the comment editor (PIE-846): one way in, C on selected words (as a c, or the selection's [Comment c]) writes on them, C with nothing selected or the byline's [comment] writes on the whole note (comment.note: the service's block-comment with no passage; its thread sits at the top of the note, its card on the margin's first row); the composer's fifth place, tile (comment.place place=tile, ctrl+o): AttachedTilePane, a tile beside the reader drawing that reader's own comment session through renderEditor, which moves, sizes and docks (tile.dock, ^W p) as any tile; the wheel over a box scrolls its text, or its preview (draft.scroll preview=true), and typing never scrolls the note out from under it; img:: in a comment drawn as the reader draws it, in the preview and the posted thread (snippetDoc with pictures, threadPanel's images)",
    files: "src/desk/attached-tile.ts, src/surface/note.ts (comment.note, commentOnNote, composerTile, composerPointer, threadPanel, isWholeNote), src/comment.ts (writeNote), src/draft-session.ts (the note target), src/surface/editor.ts (wheelTarget, previewRows), src/surface/composer.ts (the tile place), src/desk/desk.ts (composerTile)",
    aside: "a comment on the whole note, half written, in its own tile in the note's place beside it (the links tile on the right never moves) · type in it, ctrl+s sends it and the tile closes, the note's room back as it was · ctrl+g then ← → ↑ ↓, or the tile's last row, puts it on that side of the note; drag the border between them (or ^W < >) to size it, and it keeps that size round the note · ctrl+o puts it back in the note · m, then ctrl+o: the thread list there too, r writes a reply in it · the thread at the top of the note is on the whole note, a picture in it (drawn under Kitty graphics) · C with nothing selected, or the [comment] after the date, starts another · the wheel over a long comment scrolls it, and over its preview (ctrl+p) the preview",
    stage(n, show) {
      // Beside the note's links: the comment's tile takes its room from the note alone, wherever it goes round it.
      const r = new ReaderPane();
      return deskOf({ title: "showcase · comment tile", panes: [r, repliesTile()], names: ["reader", "links"], layout: ([a, b]) => row(0.7, a!, b!) }, show, [[r, n.wholeNote]], d => {
        // The person's own keys would do these: the thread on the whole note open, then a comment on the whole note in its own tile.
        void (async () => {
          await d.press(r, NOTE_ACTIONS, "comment.note");
          await d.press(r, NOTE_ACTIONS, "comment.write", { body: "The winter shelf needs a lock" });
          await d.press(r, NOTE_ACTIONS, "comment.place", { place: "tile" });
        })();
      });
    },
  },
  {
    key: "drafts", need: "write a draft somewhere: a note's text, a comment or reply, a new card", part: "the draft session (DraftSession): open with what was put aside, the hold, key and leave, submit, stale refusal, recordAs and the agent rule, behind four target adapters (blockTarget, commentTarget, cardTarget, and commentEditTarget for a posted comment's words: margin-attention shows it); what's put aside shows as a ■ unsent line with [diff] [open copy] [dismiss] [take it back] (unsent.*), and an edit opened by mistake closes on one esc (the stray rule)", files: "src/draft-session.ts, src/comment.ts, src/desk/delivery.ts, src/unsent.ts, src/stray.ts, src/reference-warnings.ts",
    aside: "the left reader is in an edit (a block's draft, held on the service), the middle one writing a comment: click away from either and it's saved or kept as unsent the same way; the board's composer (n, N) is the third adapter · the right one has an edit put aside on an older revision: [diff] shows it against the note now, [take it back] replays it into an edit (a passage changed since is left as it is), [dismiss] lets it go (src/unsent.ts) · e then a stray j, then esc: an edit opened by mistake closes at once, no ■ unsent line, and ctrl+z brings the j back (src/stray.ts) · what you write always lands (PIE-761): a ((reference left unclosed or naming nothing is sent as written and said after, with a did-you-mean (outline-core reference-warnings.ts); a refused send keeps the comment open with a copy on disk; and a reader with a comment open stays on its note whatever else opens",
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
    key: "proposals", need: "show an intentional suggestion after an agent patch was refused, beside the note it targets, and apply, resolve or dismiss it", part: "the proposal beside its note (PIE-725): a patch that cannot apply is refused; only an intentional suggestion or a queued delivery makes a proposal block under the note, never a line in its text, so the note's revision stays and the next writer doesn't lose too; the service lists the open ones with the line each follows (draft.proposals.list), the reader draws each as an embed of it there (proposalsBeside, the embed's [apply] [dismiss], A, X: proposal.apply, proposal.dismiss), and the same open patch from the same agent is returned again (deduped: true)", files: "outliner src/draft-patch-router.ts (propose, proposalsBeside), src/embeds.ts (proposalsBeside), src/surface/note.ts (besideRegions), outliner src/detail-embeds.ts",
    aside: "@fern and @moss patched the guide's sowing line at one revision: @fern's landed, @moss's was refused; @moss then deliberately offered the proposal after the guide's last line, its text and revision as @fern left them · ] to its source line, then A applies it anyway, r asks the outline agent to resolve its intent against the current note, or X dismisses it (any agent may, attributed) · @moss's retry of the same patch came back as this proposal, deduped, not a second copy · Detail draws it in the same place (outliner src/detail-embeds.ts) · an agent can dismiss by id without a reader: proposal.dismiss id=<proposal>, or outline_proposal_dismiss ref=<proposal> from the mod, MCP or host API; proposal.resolve block=<proposal> and outline_proposal_resolve ask the same tidy agent, preserving unrelated changes; conflicting readings stay open with a reason; the resolved edit carries its author and an undo receipt · tiles inside a mounted screen answer to their unique name or tile=<mount>/<tile>",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · proposals", panes: [r], names: ["guide"] }, show, [[r, n.race]]);
    },
  },
  {
    key: "undo", need: "copy text out of a draft; undo and redo anything typed or pasted, a big paste in one step", part: "the draft's one history (Draft.undos and redos behind draft.undo, ctrl+z, and draft.redo, ctrl+y or ctrl+shift+z: typing a word at a time, a paste or an agent's patch one step each, carried past a save when the note is opened again unchanged) and its copy (draft.copy: copy on select, a double click's word, shift+click and shift+arrows, cmd+c, alt+c, the frame's [copy]; OSC 52 through App.copy)", files: "src/edit.ts, src/surface/editor.ts, src/surface/note.ts, src/draft-session.ts, src/term.ts",
    aside: "the edit has a whole pantry list pasted into it by mistake: one step, said on the status line (pasted 42 lines · ctrl+z undoes) · ctrl+z takes it back, ctrl+y puts it back · the first line's [page::…] is selected: let go of a drag (or double-click a word, shift+click, shift+arrows then cmd+c or alt+c, or the frame's [copy]) and it's on your clipboard, \"copied N chars\" · an agent's draft.copy only returns the text, never your clipboard · the note has an earlier revision: the tile menu's \"an earlier revision\" (revision.restore) puts it in the edit, ctrl+s saves it, ctrl+z takes it back; `ep0ch revisions <id>` lists them from a shell; this earlier text was saved by cowboy under yolo: its history line says by cowboy · for evan · via yolo",
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
    key: "hints", need: "x-ray and hint cards", part: "HintCard and Canvas.float in the desk float layer, ActionDef hints, menuRow and keycaps", files: "src/surface/hint-card.ts, src/desk/desk.ts",
    aside: "Hover a clipped title or label to read it whole; Alt+? cycles clipped values, and values wider than the screen scroll. Linking has its instructions beside the tile. Click a destination; the card leaves the keys with you. The frame controls are ○ (select lands), » (open lands), ^ (alt-open lands), \u25c4/\u25bc (fold), \u2261 (menu), x (close), and \u25d8 (float or put back). Hover the menu or press ? on the frame for their meanings. The menu still opens its searchable action list. All floats share a raised panel and accent border; menus dim the screen, hints leave it readable. Hold ctrl for every tile's card, or ctrl+] then ? to toggle. hint.pin keeps a card; esc dismisses it. Fold source with tile.collapse, then hint.never: folding now gives one status line. [never] (Alt+Shift+N) saves that choice across restarts. Open tune and its Hints section to choose card, status or off for every declared hint, or reset all. hints.list reads the settings; hints.set id=tile.collapse to=status changes one.",
    stage(n, show) {
      const source = new ReaderPane(), reader = new ReaderPane();
      return deskOf({ title: "x-ray and hint cards", panes: [source, reader], names: ["source", "reader"] }, show, [[source, n.notebook], [reader, n.shed]], d => { void d.dispatch.press("tile.title", { text: "Allotment notebook: planting, watering and seed orders through the growing season" }, "source"); void d.dispatch.press("tile.link", { ask: true, verb: "select" }, "source"); });
    },
  },
  {
    key: "panes", need: "open, split, zoom, close tiles; docks; lock a shape", part: "the layout tree: tiles in containers (splits, tab sets, docks, columns) with a policy each, floats and spines, one engine for the desk and the screens built on it, the board a preset (^W then o x z s HJKL < > + -, p a dock, c a spine, f a float, P the policy; alt+k locks; the board's x o T B { } < >); tile.* layout.* actions (pane.* their older names); tile kinds from one registry", files: "src/desk/layout.ts, src/desk/drop.ts, src/desk/tile-kinds.ts, src/desk/builtin-tiles.ts, src/desk/pane-actions.ts, src/desk/panes.ts, src/desk/desk.ts",
    aside: "^W n or double click a title to rename; ^W N toggles without losing it. Reading {{this.title}} follows the notebook; Visitors is a written tab title. The frame card's close row closes the tile (tile.close, as ^W x); the board (section 5) and the river are screen specs on this engine (PIE-511, PIE-515): the river's columns are a flow",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = repliesTile(), act = new ActivityPane();
      // The replies (a links tile with Children alone) and the activity panes are one tab set (PIE-413): drag a header onto another to make one.
      // The outline is in a dock on the left (PIE-505): it slides shut when the keys leave it, and its handle
      // on the hint row opens it again; a header dropped on the handle goes into it.
      return deskOf({
        title: "showcase · panes", panes: [tree, r, th, act],
        layout: ([t, rd, h, a]) => pair("row", 0.24, { t: "dock", kid: leaf(t!), edge: "left", open: true }, pair("row", 0.62, leaf(rd!), { t: "tabs", ids: [h!, a!], active: 0 })),
      }, show, [], d => { Object.assign(r, { writtenTitle: "Reading {{this.title}}" }); Object.assign(act, { writtenTitle: "Visitors" }); if (n.notebook) d.setCurrent(n.notebook, { reveal: true }); });
    },
  },
  {
    key: "folds", need: "fold any tile to a spine with one click, and open it again", part: "the layout tree's fold (PIE-642): a ◂ or ▾ on every tile's frame beside ⋯ and ×, alt+click for a horizontal spine, alt+h alt+H, bare - + = (PIE-699), a click on the spine, in the drawer too (a lone drawer tile folds the drawer to a strip, PIE-1254; the drawer section shows it); tile.collapse dir=v|h and tile.expand (Fold in src/desk/screen-layout.ts; drawSpine, drawHSpine)", files: "src/desk/screen-layout.ts, src/desk/desk.ts, src/spine.ts, src/desk/tile-actions.ts",
    aside: "click the ◂ on the outline to fold it down the side, the ▾ on the reader to fold it up into one row (its height goes to the tile below); a click on a spine, or ⏎ on it, opens it with an even share of its row (a horizontal spine restores its height) · alt+click folds the other way round, alt+h and alt+H do the focused tile, and so do a bare - (fold) and + or = (open) wherever the tile takes no text; a tile's own - + = win (the tune inspector, an image, a figure) · terminals pass alt in the mouse report where shift-click is taken for selection · `act tile.collapse tile=<t> dir=v|h`, `act tile.expand tile=<t>` do the same, and refuse the tile you are typing in",
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
    key: "book-spines", need: "keep open pages together, with spines gathered like an open book",
    part: "the container's spines and min-width policy, placement(), the shared unfold path and layout.gather; the same layout tree on a screen or in a group",
    files: "src/desk/screen-layout.ts, src/desk/layout.ts, src/desk/tile-actions.ts, src/desk/wkeys.ts",
    aside: "Two pages open in the spread, page edges at the sides. Click a spine: it joins the spread with an even share. Below min-width (40), the page touched longest ago folds to its own side. A hand fold stays where it is. The container menu offers align left (^W {), centre (^W |) and right (^W }). Centre splits spines evenly, with an odd one on the right. Follow a link with alt+Enter, go back with alt+Left, then alt-open again three times: the note has one tile, never another copy in the spines. A split, tile.open or pinned reader stays yours. The alignment sticks as spines=end, centre or start; sides keeps book placement. invoker keeps the old placement toward the tile an open came from.",
    stage(n, show) {
      const readers = Array.from({ length: 16 }, () => { const r = new ReaderPane(true); r.holdOn(); return r; });
      const names = ["birch", "cedar", "elm", "fir", "oak", ...Array.from({ length: 11 }, (_, i) => `page-${i + 1}`)];
      const first = [n.whiteboard, n.shed, n.heap, n.notebook];
      const notes = [...first, ...Object.values(n).filter(m => !first.includes(m))].slice(0, readers.length);
      return deskOf({ title: "showcase · book spines", panes: readers, names,
        layout: ids => ({ t: "split", dir: "row", key: "spread", kids: ids.map(leaf), weights: ids.map(() => 1), policy: { spines: "book", "min-width": 40 } }),
      }, show, readers.map((r, i) => [r, notes[i]]), d => {
        for (const name of names.filter(name => name !== "cedar" && name !== "fir")) d.collapseTile(name, true, USER);
        d.gatherSpines("cedar", "centre", USER);
      });
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
          lines: tileKinds().flatMap(k => [`${fg(C.lcyan)}${k.kind}${RESET}${k.keys?.length ? ` ${fg(C.dark)}^W o ${k.keys.map(x => x.key).join(" ")}${RESET}` : ""}`, `  ${fg(C.grey)}${k.about}${RESET}`]),
        }),
      }).make({ kind: "showcase.kinds" });
      const r = new ReaderPane();
      // The hub's views as query tiles: a columns container its tile source (hub:<id>) fills, as the board's lanes.
      const lanes = n.hub ? [columnsOf<number>([], { key: "lanes", source: `hub:${n.hub.id}` })] : [];
      return deskOf({ title: "showcase · kinds", panes: [list, r], layout: ([a, b]) => pair("row", 0.4, leaf(a!), lanes.length ? splitOf("col", [...lanes, leaf(b!)], [0.45, 0.55]) : leaf(b!)) }, show, [[r, n.notebook]]);
    },
  },
  {
    key: "echonet", need: "read echomail: the message areas of every outline the door reaches (named views and tagged notes, and each subscription's source boards), a message with its FidoNet footer, the nodelist (EchoNet, PIE-779)",
    part: "a screen spec of four kinds (echo.areas, the model and the band; echo.messages; echo.reader, a ReaderPane with SurfaceHost.header and .footer on its outline's board; echo.nodelist), every list a blocks.query, new by unread:me, a message read by blocks.markRead; r and q in the shared composer (passage.act); a newer original is taken with the echonet extension's own actions",
    files: "src/echonet/screen.ts, src/echonet/net.ts, src/surface/note.ts (footer), src/socket.ts (markRead)",
    aside: "Plot chat starts in this outline: a view named with [echo::plot.chat], and a note elsewhere posted to it by its tag; Seed swap is a subscription to society@box-a, its posts the tosser's copies on the society's board (one says a newer version is upstream, to take with ext.echonet.take-newer or compare with ext.echonet.compare-newer; one says it's gone upstream; two more wait); the nodelist's attic is down. ⏎ ⏎ reads a message and marks it read; ] [ step, r replies, q quote-replies; the menu's A opens it, `ep0ch --screen echonet` too",
    stage: () => openScreen("echonet", { persist: false }),
  },
  {
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; $EDITOR on a draft runs in one (a reader's ctrl+e, a draft's ctrl+x ctrl+e); its program's copy (OSC 52, Claude Code's) goes on to your clipboard through App.copy if you typed or clicked in the tile within 2 min, said \"copied from <tile>\" (or why not); drag across its text and the door selects and copies it itself (PIE-716), in the drawer too: shift+drag (alt+drag where your terminal keeps shift) when its program has the mouse", files: "src/desk/pty.ts, src/surface/editor.ts, src/surface/selection.ts",
    aside: "The shell prints an OSC 8 link: use your terminal's link gesture on Example website » to open it in your browser. Resize the tile or scroll away and back: the link stays inside its text. Drag across the line in the shell: it's selected and copied when you let go (\"copied from sh\"), as in a reader; a program that has asked for the mouse (Claude Code's fullscreen, vim's mouse=a) keeps plain drags, and shift+drag or alt+drag selects for the door · `act terminal.copy tile=<tile>` copies the person's selection again (never an agent's) · the drawer (next section; src/drawer.ts, PIE-498) runs a program of its own too, its first tab, pulled up over (or beside) any screen, this one too, by alt+a or a click on the status bar's ▲ chip; ctrl+] gives the keys back, alt+A or its top edge sizes it (host.toggle, host.size) · where a program runs: EP0CH_NEST, ep0ch where",
    stage(n, show) {
      const term = new PtyPane({ cmd: ["sh", "-c", "echo 'a terminal tile: sh in a pty the door owns'; printf '\\033]8;id=example;https://example.com\\033\\\\Example website »\\033]8;;\\033\\\\\\n'; echo 'drag across this line: Plant out the courgettes'; echo 'copy from it as Claude Code does:'; printf '%s\\n' \"  printf '\\\\033]52;c;%s\\\\007' \\\"\\$(printf hello | base64)\\\"\"; exec sh"], label: "shell" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · terminal", panes: [r, term], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "lift", need: "lift a tile above the drawer, then return to work", part: "tile.zoom reach=column|full, the layout's transient lift and the host composition", files: "src/desk/screen-layout.ts, src/desk/desk.ts, src/app.ts",
    aside: "The frame's lift chip raises the briefing over the drawer. Work in the other tile or drawer to drop it. The tree stays exactly where it was. The power bar lists lift and the tile keys show its two reaches.",
    stage(n, show) {
      const brief = new ReaderPane(true), other = new ReaderPane(true);
      return deskOf({ title: "showcase · lift", panes: [brief, other], names: ["brief", "other"], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "drawer", need: "carry a tile across screens (a terminal, a reader, the tree)", part: "your drawer: the host layer's tabs, above every screen, on a desk of its own; tile.drawer moves a tile in or out whole, as a tab or beside one where a drag onto its zones drops it (to= where=, PIE-1263)", files: "src/drawer.ts, src/desk/drawer-program.ts",
    aside: "The drawer holds linkbox, a group with a links tile. Click its list, press alt+l then o, and click the screen reader: the wire starts at the links tile inside the group. Each verb has one destination: wiring it again replaces that destination. The group refuses a wire and names its inner tile. Press b on reader to pin its note in the links tile; opening another note into reader keeps those links until b re-aims them. The links hint names the same open and alt destinations as the wire chips. Its id stays the same when moved or renamed; layout.get and peek list every layer. Move kettle into the drawer with ^W a, then alt+l: the card lists screen tiles by number and name. Wire its open to reader, and open a note from kettle through act (as a chat link does); the drawer's own chat is wired the same way (alt+l on it), and a reference pressed in Claude there opens in that reader, found by the name the program was given. The landing wears a star in its title and a bright frame; click or focus it to clear, or leave it visible for 10 seconds. Use ids when two desks have the same name. Close every tile with ^W x, its menu, or its frame x. The last closes too: the screen or drawer shows home, with the power bar and New note / Shell / Agent buttons. Nothing starts itself; alt+s always opens a shell. In the drawer, ^W o d makes an empty detail; click New note to write in that same tile, then ctrl+s saves. Click the drawer agent chip every time you want its picker; choose a program to replace its one agent tab. Tab switches this outline / every outline, and the folder is editable. An EP0CH_DAILY_AGENT override is named on the chip and explained in the picker. Switch twice: no extra agent tab. alt+g with no agents shows New Agent and Shell buttons and Getting about. ^W a or a drag still carries a tile whole between the screen and drawer.",
    stage(n, show) {
      const kettle = new PtyPane({ cmd: ["sh", "-c", "echo 'the kettle: a terminal tile to put in your drawer (^W a). Its pid:' $$; " + STATUS_DEMO], label: "kettle" }), r = new ReaderPane(true);
      const links = new BacklinksPane("reader", true);
      const group = new ScreenTile("screen", { inner: { root: { t: "leaf", kind: "backlinks", name: "drawer-links" } } }, undefined, new Map([["drawer-links", links]]));
      return deskOf({ title: "showcase · drawer", panes: [kettle, r, group], names: ["kettle", "reader", "linkbox"] }, show, [], d => {
        if (n.notebook) d.setCurrent(n.notebook);
        if (d.pane("linkbox")) d.ctx.hostLayer?.put(d, "linkbox", SHOWCASE_AGENT);
      });
    },
  },
  {
    key: "status", need: "show what a program in a terminal tile says it's doing (working, blocked on you, done, failed); report the door's own to its terminal", part: "program status (OSC 7501, PIE-614): outline-core's one reader and writer (records, ids, lifetimes, limits); each terminal tile's TileStatus, read through its emulator's OSC handler and answering the feature query, its glyph on the tile's header and tab, the drawer's chip, the status bar's count; the waiting-on-you list (a tile kind: host.waiting, alt+w, a click on the count; status.go, status.seen); DoorReporter (doorReport, held a few seconds) to the door's own terminal", files: "outline-core/src/program-status.ts, src/desk/program-status.ts, src/desk/waiting-you.ts, src/desk/pty.ts, outliner src/program-status-emit.ts, claude-mod hooks/claude-status.ts",
    aside: "decisions, open proposals and unchecked calls appear above held requests and programs: select previews, Enter opens, alt+Enter opens beside; x clears a decision with a comment, A applies a proposal, X dismisses it; tick a call in its note to clear it · a held request is listed before the programs (‼ in the status bar): an agent's first @tidy line wakes by default, spending the showcase's daily cap; its next ask in 'Reply to the seed swap thread' waits for your r · ⏎ or a click on its row opens the note, r sends the request, as r on the line does (an agent can open it, never send it) · the deploy on the left is a script writing OSC 7501 to its terminal: building, pushing, then blocked on a permission until you answer y in it (click in it, y ⏎); its header's glyph, the status bar's ◆ and the list on the right follow it · ⏎ or a click on a row goes to that terminal, x marks it seen; being in the tile clears its done · alt+w opens the same list in your drawer, on any screen · the Claude mod reports Claude's own (a permission dialog, a question, done), ep0ch install --apply, ep0ch backup run, scripts/box-test and scripts/agent-env --test report theirs; the door tells its own terminal (Ghostty, Rex, Tern, Herdr) only what a person away needs, in words that say who, where and what: a tile blocked on you, a failure, a long job's done, the same few seconds after it holds (working and idle never leave the door); Herdr, which shows a sidebar, gets each tile as a child too (EP0CH_PROGRAM_STATUS=children says so for another, root for none, 0 for off)",
    stage(_n, show) {
      const deploy = new PtyPane({ cmd: ["sh", "-c", STATUS_DEMO], label: "deploy" }), list = new WaitingYouPane();
      return deskOf({ title: "showcase · program status", panes: [deploy, list], names: ["deploy", "waiting"], layout: ([a, b]) => row(0.55, a!, b!) }, show, []);
    },
  },
  {
    key: "access", need: "see which agent (a named path, a stdio client) can reach which outline and how far, and change it", part: "who can reach what (PIE-1034, src/mcp-access-matrix.ts, src/desk/access-matrix.ts): one matrix over the three places the answer lives (each outline's grant, `ep0ch mcp access`; each named path's cap, EP0CH_MCP_PATH_ACCESS in mcp.env; the usage records, `ep0ch mcp usage`), the effective level the lower of the grant and the cap (the gateway's own levelFor), as a tile kind (access.open in the power bar, then % lists it), `ep0ch mcp access --matrix`, and mcp.access.matrix for an agent; a change is planned (it says the command and whom it affects) and applied by the person only (access.plan, access.apply)", files: "src/mcp-access-matrix.ts, src/desk/access-matrix.ts, src/mcp-writes.ts (pathCapEntry, levelFor), src/mcp-usage.ts (readUsage), src/mcp.ts (mcp access --matrix, --cap), src/drawer.ts (access.open, mcp.access.matrix)",
    aside: "made-up callers on the showcase's private host: garden-bot (a named path, »), seed-sorter (a path nobody has called yet), claude-code@float-2 and kitty-batch (clients: no cap) against the showcase, garden, rotfield, gurgle and vault outlines · each cell is a glyph and a word: ● full, ♦ propose, ○ read, ✗ none; under it, calls in the last 7 days and how long ago · h j k l or a click pick a cell and the line under the table says why (\"rotfield allows full; garden-bot is capped at propose\") · n r p f, or a click on the chips, plan a level: it says the command that would run and whom it affects (a client's cell is the outline's grant, so it affects every caller there), ⏎ applies it · the cap file here is the showcase's own, never your ~/.config · `act mcp.access.matrix` reads the same as an agent, `act access.plan` asks what a change would do, and `access.apply` is refused to agents (what they may reach is yours to set)",
    stage(_n, show) {
      seedAccessFiles();
      return deskOf({ title: "showcase · who can reach what", panes: [new AccessMatrixPane(accessDemoEnv())], names: ["access"], layout: ([a]) => leaf(a!) }, show, []);
    },
  },
  {
    key: "sessions", need: "talk to an agent here: start one in any folder, keep it running, show it in your drawer or a tile, see every one", part: "agent sessions (PIE-737, src/desk/agent-sessions.ts): a program (an agent config in the outline, [agent-config::<name>], or one installed), a folder and a persona, owned by the door session as a terminal tile's program; where it's shown (your drawer, a tile) isn't what it is, so moving it keeps the process and the conversation; agent.start (ep0ch agent from any folder, n in the panel) starts or attaches by folder and program, resuming the program's last conversation there; a claude typed in a ^W o s shell is one by itself (known by its own OSC 7501 report, else found as Herdr finds agents); the agent panel (a tile kind, agents.open, alt+g): agents.go, agents.drawer, agents.dock, agents.new, agents.list", files: "src/desk/agent-sessions.ts, src/desk/agents-panel.ts, src/drawer.ts (agent.start, agents.*), src/agent-cli.ts, src/desk/pty.ts (PtySpec.session)",
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
    aside: "garden-agent edited the three log notes and posted a comment linking HOME-042: open the comment from what-changed, follow its outlink, or follow on back to the log · the status bar says +4 new · the list on the left shows them newest first, with who changed each and what, a ● on the ones you haven't looked at; d on a row shows the change under it (the note's earlier text against the new) · ⏎ or a click opens the note in the reader on the right, alt+⏎ or an alt-click in a new detail · a click on +4 new, or alt+o on any screen, opens the same list in your drawer, and looking clears the count (x does too) · `act changes.list` reads the rows as an agent, `act changes.open` opens the tab behind yours, and neither clears what you haven't seen",
    stage(n, show) {
      const list = new WhatChangedPane(), r = new ReaderPane(true), links = new BacklinksPane("reader", true);
      // The scripted agent: three notes edited by garden-agent, each visit one round further.
      const withAgent: Shower = after => show(ctx => { void gardenRound(ctx.board, n); after(ctx); });
      return deskOf({ title: "showcase · what changed", panes: [list, r, links], names: ["changes", "reader", "links"], layout: ([a, b, c]) => pair("row", 0.4, leaf(a!), pair("col", 0.7, leaf(b!), leaf(c!))) }, withAgent, [[r, n.logBeans]]);
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
    aside: "tile.preview (O in the reader, ^W v beside, ^W V below): a detail opens beside the reader on the right, linked, so a link followed there lands in it and the reader keeps the notebook; again, it shows that one · the preview of the tree (the tile between the outline and the notebook) has no frame: a tinted ground joined to the tree (border=joined, PIE-886; border=line frames it again)",
    stage(n, show) {
      // The reader on the right is held on the notebook (p), so the outline's selection doesn't move it.
      const tree = new TreePane(), p = new PreviewPane({ tile: "tree" }), r = new ReaderPane(true);
      return deskOf({ title: "showcase · preview", panes: [tree, p, r], layout: ([a, b, c]) => pair("row", 0.3, leaf(a!), row(0.45, b!, c!)) }, show, [], d => { if (n.notebook) r.hold(n.notebook, d); });
    },
  },
  {
    key: "reader-modes", need: "choose whether a reader follows the current note, keeps one, or is pinned to a page", part: "the reader tile's mode (PIE-705): ReaderPane.followMode and setMode, the mode chip on its frame (headControls), `p`, reader.mode; what it follows (PIE-814): the chip names it (follows · current, follows · tree (docked), held) and a click or P picks it, reader.follow source=current|none|<tile>, a tile's link with the preview role saved with the layout; a saved `detail` reads as a held reader (canonSpec)", files: "src/desk/panes.ts, src/desk/builtin-tiles.ts, src/desk/tiles.ts",
    aside: "three readers, one kind: reader shows the current note, detail stays put on the shed, now stays put with a page lock (▣) on the notebook · p switches states; the state chip or P opens Shows and the page lock in the policy panel · to show a selection here, use alt+l s on its source and click this reader · act reader.follow tile=detail source=tree and act reader.mode tile=<name> mode=follows|held|pinned do it as an agent, attributed, without taking your keys · a detail is a reader that starts in stays put (^W o d)",
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
    aside: "the board here is the board's own spec, live, on its own desk inside the tile; the lanes under it are only its lanes row (part=lanes), whose ⏎ opens where this screen's opens land · ◂ on a mount folds it to a spine named for the screen, a click opens it · ▲ full (^W u) pops it out to the full board, q comes back to the mount where it was · ^W e (⏎ in) goes in: its own ^W and Tab, ctrl+] or esc comes out · on the reader in the tabs, ^W G gathers it into a group (`act tile.group tile=reader with=replies` puts the replies beside it): a tab holding a split · each mount keeps its own layout, selection and scroll, saved with this screen's; the cards are the outline's, shared · gathering (PIE-696): shift+click (or ^W space, tile.select) picks tiles, shown ◆ on their frames, and ^W G gathers the picked in the arrangement they had, esc lets go; ^W G in a split asks this tile or the whole split; drag a tile's title onto a group (its frame, or a drop zone inside it) to move it in, drag one out past the group's content to move it back out (layout.move into=<group> / out=true, ^W i); a link across the group's edge is a path (tile.link to=<group>/<tile>, ../<tile>) and survives all of it, the card preview here included. Below, source in A opens into detail in B: alt+l then a click, a screen-wide number or h j k l chooses a target across groups or in the drawer. ^W v on source reveals that same detail. Group a reader's links and preview, then b in the reader reuses them. ^W a on a group carries it whole in the drawer between sections; ^W a in the drawer brings it back. A note's ::button can run host.toggle or tile.collapse tile=<group> to put it away and show it again",
    stage(n, show) {
      const args = n.hub ? { args: { hub: n.hub.id } } : {};
      const board = new ScreenTile("screen", { screen: "board", ...args }), lanes = new ScreenTile("screen", { screen: "board", part: "lanes", ...args });
      const p = new PreviewPane({ tile: "board" }), r = new ReaderPane(true), th = repliesTile(), act = new ActivityPane();
      const source = new ReaderPane(true), detail = new ReaderPane(true), outside = new ReaderPane(true);
      return deskOf({
        title: "showcase · screen", panes: [board, lanes, p, r, th, act, source, detail, outside], names: ["board", "lanes", "card", "reader", "replies", "activity", "source", "detail", "outside"],
        layout: ([b, l, c, rd, h, a, src, dst, out]) => pair("col", 0.65,
          pair("row", 0.62, pair("col", 0.6, leaf(b!), leaf(l!)), pair("col", 0.45, leaf(c!), { t: "tabs", ids: [rd!, h!, a!], active: 0 })),
          pair("row", 0.72, row(0.5, src!, dst!), leaf(out!))),
      }, show, [[source, n.shed], [detail, n.notebook], [outside, n.shed]], d => {
        if (n.notebook) d.setCurrent(n.notebook);
        d.linkTile("source", "detail", USER);
        d.groupTile("source", { name: "a", label: "Group A" }, USER);
        d.groupTile("detail", { name: "b", label: "Group B" }, USER);
        d.dispatch.press("tile.focus", {}, "board");
      });
    },
  },
  {
    key: "spine", need: "squeeze a tile to a title strip", part: "the spine part: drawSpine, SPINE (c collapses a lane or a reader, alt+c opens all)", files: "src/spine.ts, on the board: src/desk/delivery.ts",
    aside: "the board's lanes take a sideways wheel or a trackpad swipe as h and l, one lane a swipe (SidewaysWheel); a click selects a card, a double click opens it, an alt-, ctrl- or middle-click opens it in a new detail; alt+↑ alt+↓, or a card dragged up or down its lane, puts it in the lane's hand-set order (card.reorder, as `act` does; `ep0ch view order <view> <id>…` from a shell)",
    stage(n) { return openScreen("board", { hub: n.hub?.id, persist: false }); },
  },
  {
    key: "entity", need: "show children, outlinks, backlinks, resources", part: "entity navigation: u, [ ] and ⏎ on links in the surface; one links model (src/links.ts: outlinks, resources, backlinks, children; a link in a property's value is one too, labelled by its key, PIE-874: the seed swap's [meets-at::[[Bike shed]]]) drawn three ways: a row's links in the tree (L), the links tile (b in any reader), the inline ::links in a note", files: "src/surface/note.ts, src/links.ts, src/desk/tree.ts, src/desk/backlinks-pane.ts, src/authored.ts, references.backlinks in src/socket.ts, src/backlinks.ts",
    aside: "An away machine leaves the answering outlines visible, with a dim line naming its copy and time, or not asked (PIE-1057). One model, one row: the tree's L (tree.links), the links tile under the reader (b; the board's dock, section 5) and the shed note's own ::links are the same rows (src/links.ts linkRows, linkRowLines) · Outlinks and Resources from blocks.authored-links, Backlinks grouped and filtered as Detail does · moving onto a resource shows what the service stores for it, read only; ⏎ registers and opens · the mouse as the keys: a click selects, a double click is ⏎, an alt-, ctrl- or middle-click alt+⏎",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = repliesTile(), links = new BacklinksPane("reader", true);
      return deskOf({ title: "showcase · entity", panes: [tree, r, links, th], layout: ([a, b, c, e]) => pair("row", 0.3, leaf(a!), pair("row", 0.66, pair("col", 0.62, leaf(b!), leaf(c!)), leaf(e!))) }, show, [], d => { if (n.shed) { d.setCurrent(n.shed); void tree.showLinksOf(n.shed, d); } });
    },
  },
  {
    key: "cross-outline", need: "read and edit another outline on this screen", part: "one board per outline, the shared reader and DraftSession", files: "src/desk/outline-boards.ts, src/desk/panes.ts",
    stage(n, show) {
      const local = detailPane();
      const foreign = detailPane();
      foreign.noteAddress = { outline: "showcase-orchard" };
      foreign.want = n.crossOutline?.properties.find(p => p.key === "foreign-note")?.value ?? null;
      return deskOf({ title: "Two outlines", panes: [local, foreign], names: ["guide", "orchard-note"] }, show, [[local, n.crossOutline]]);
    },
  },
  {
    key: "select-open", need: "tree, preview, detail from scratch", part: "select wires show the picked row; open wires take Enter or double-click; opens swap in the destination; a kept note is born as an inner spine", files: "src/desk/screen-layout.ts, src/desk/desk.ts, src/desk/tree.ts, src/scroll.ts",
    aside: "Built with tile.preview (the tree's ^W V) and tile.link (alt+l, then click detail). Try alt+l, s, then click the preview; alt+l, a, then click detail's edge sets beside detail. Escape cancels. Click a frame's select, open or alt chip to pick that wire on screen; narrow frames use ○ » ^, with targets in the link-mode hint. ^W P has the same three rows and × clears each wire. A reader shows the current note or stays put; ▣ locks it to a page. Click or j k selects into the preview; Enter or double-click opens in detail; alt+Enter or alt-click uses the alt wire alone; a wire aimed at a tile replaces its note in place. Try ten wired opens into detail: its tile keeps its name and place, and alt+Left returns to the replaced note. No other reader folds. A click on a spine opens the kept note. tile.link verb=alt rule=tab to=detail opens tabs; rule=tile replaces there; rule=first-unheld reuses a free reader; rule=beside opens beside the named tile. layout.policy node=screen altOpens=beside sets the default. A plain click after alt-click still selects. Unlink the select wire and selections move the current note again.",
    stage(n, show) {
      const tree = new TreePane(), detail = detailPane();
      return deskOf({ title: "showcase · tree, preview, detail from scratch", panes: [tree, detail], names: ["tree", "detail"], layout: ([a, b]) => row(0.4, a!, b!) }, show, [], d => {
        void (async () => {
          if (n.shed) { await tree.reveal(n.shed, d); d.setCurrent(n.shed); detail.hold(n.shed, d); }
          await d.previewTile("tree", "down", USER);
          d.linkTile("tree", "detail", USER);
        })();
      });
    },
  },
  {
    key: "links-open", need: "open a picked link for real, not as a preview: in the reader it came from, or in a new detail", part: "the links tile's open (backlinks.open: ⏎ and a double click in its home reader or the tile linked to it as a target, alt+⏎ and an alt-click in a new detail beside it; the list keeps its subject until b) over one preview following its selection; independent select and open wires (tile.link verb=select|open), said on the header", files: "src/desk/backlinks-pane.ts, src/desk/desk.ts (setCurrent, showFrom, openFrom), src/desk/screen-layout.ts (placement, selectTargets)",
    aside: "each backlink row quotes the line that links here and the anchor it names; opening it lands on that line (marked, esc lets go) · the stage is what `b` makes in a detail: j k flip through the previews, ⏎ opens the pick in the detail (the list keeps the shed's links: ⏎ again opens the next row; b, in the detail or the list, aims it at what the detail shows now), alt+⏎ opens it in a new detail beside; tile.link verb=open to a reader from the list keeps it still while the preview flips, and ⏎ lands in it · the header's Kind, Stage and Sort (K w s, or a click) narrow and order all three groups (a link's target decides: its kind, stage and dates), the counters X with →outlinks ♦resources ←backlinks beside it, and each control stays in its slot whatever its value · an agent's open is the same action, attributed, and never takes your keys",
    stage(n, show) {
      const d = detailPane(), links = new BacklinksPane("detail", true), p = new PreviewPane({ tile: "backlinks" });
      return deskOf({ title: "showcase · links-open", panes: [d, links, p], layout: ([a, b, c]) => pair("col", 0.4, leaf(a!), row(0.5, b!, c!)) }, show, [], dsk => { if (n.shed) d.hold(n.shed, dsk); });
    },
  },
  {
    key: "trash", need: "trash a note from wherever it is seen, and bring it back", part: "note.trash and note.untrash (PIE-878, TILE_ACTIONS over src/note-trash.ts): d on a reader, a links list, the tree or a query tile says what would go (the note and the notes under it) and d again, Delete or a click on the first row trashes it, recorded as the actor's; ctrl+z (with nothing of the tile's own to undo) or the tile menu's row brings back the one the actor trashed last. A system note, the workspace root, a note in the Trash and a note with a draft open on it are refused with why; an agent says confirm=<the note's id>", files: "src/note-trash.ts, src/desk/tile-actions.ts, src/desk/desk.ts (subjectOf, the d and ctrl+z keys), Pane.subject in src/desk/panes.ts",
    aside: "the detail holds the Compost heap, its links tile lists the two notes under it · press d in the detail: the choice names the heap and the 2 notes that go with it · d again trashes them (the detail says it is in the Trash) · ctrl+z brings them back · Tab to the links tile, j to Lid, d and d trashes just that one · the tile menu (the ⋯) has the same row, an agent passes confirm=",
    stage(n, show) {
      const d = detailPane(), links = new BacklinksPane("detail", true);
      return deskOf({ title: "showcase · trash", panes: [d, links], names: ["detail", "links"], layout: ([a, b]) => pair("col", 0.5, leaf(a!), leaf(b!)) }, show, [], dsk => { if (n.heap) d.hold(n.heap, dsk); });
    },
  },
  {
    key: "tree-views", need: "see a virtual branch's matches in the outline tree beside the notes under it, and choose how far they open", part: "the tree's virtual branches (PIE-882, src/desk/tree.ts): a block with [type::virtual-branch] opened shows its physical children, then its matches as the service answers them (views.read: members in branch order within the view's limit, its child-depth), each match a row of its own opened to its children down to that depth; D (tree.depth) sets the depth for the view (results only, 1 to 8, or the view's own) and writes nothing; a more row reads the next page; the matches follow the outline's changes", files: "src/desk/tree.ts (TreePane: emit, branchRows, loadBranch, setDepth; TREE_ACTIONS tree.depth), src/views.ts (readView), outliner src/store.ts (readSavedView: childDepth)",
    aside: "Garden chores is a saved view (a [type::virtual-branch] note with a query): it is open in the outline on the left, its matches under it marked ◇ with the count in the tag (V:n) · l or a click on a match's ▸ opens it to its children, as far as the view's child-depth says · D steps how far for this view: results only, then 1, 2, 3 levels, then the view's own again; the results line says which · a view with more matches than its limit ends in a ▸ more row: ⏎ reads the next page · ⏎ on a match opens it in the reader · an agent does the same with act tree.depth",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true);
      return deskOf({ title: "showcase · tree views", panes: [tree, r], names: ["tree", "reader"], layout: ([a, b]) => pair("row", 0.45, leaf(a!), leaf(b!)) }, show, [], dsk => { if (n.gardenView) void tree.showOpen(n.gardenView, dsk); });
    },
  },
  {
    key: "lists-open", need: "open notes from any list the same way (a links tile, a ::links block in a note, a river column's links): select and preview, replace in the list's home, a new detail beside; and find where a held reader is in the outline", part: "one list model (PIE-794): a list's home and subject; Desk.setCurrent → landFrom asks landing() (its link, a container's opens-into, its home, a flow's next column), a reader's take keeps its mode, held means local; an inline row's click selects (SurfaceHost.preview → showFrom); reader.reveal (alt+r, a click on the crumbs); growth by room (the policy's readable, the layout's room operation) and a spine's ×", files: "src/desk/desk.ts (setCurrent, landFrom, revealInOutline, makeRoom), src/desk/screen-layout.ts (landing, room), src/desk/builtin-tiles.ts (take), src/surface/note.ts (inline rows, previewRow), src/desk/backlinks-pane.ts (home, subject)",
    aside: "the detail in the middle is held on the Bike shed, whose own ::links lists its links: a click on a row selects it and the preview on the right follows (it previews the detail's selection), as j k in a links tile · a double click (or ⏎ on the row) replaces the detail's note, kept in its history (alt+← comes back) · the detail is held, so its navigation is its own: the outline on the left stays where it was; alt+r, or a click on the detail's crumbs, shows the note there · in the Herdr Tree, alt+r likewise reveals the selected row at its physical source (PIE-995) · an alt-click opens a new detail beside it; keep alt-clicking and, past a readable width (the layout's `readable`, ^W P), the earlier details fold to spines (never the first), and a spine's × closes it without opening it · b in the detail opens its links tile, which keeps the shed's links as you open them, until b again",
    stage(n, show) {
      const tree = new TreePane(), d = detailPane(), p = new PreviewPane({ tile: "detail" });
      return deskOf({ title: "showcase · lists open", panes: [tree, d, p], names: ["tree", "detail", "preview"], layout: ([a, b, c]) => pair("row", 0.24, leaf(a!), row(0.55, b!, c!)) }, show, [], dsk => { if (n.shed) d.hold(n.shed, dsk); });
    },
  },
  {
    key: "tags", need: "open the notes carrying a #tag from the tag itself, in a note", part: "a #tag the service reads as a tag is a link (refs.ts presentLinks: LinkTarget.tag, from the service's property tokens, never re-parsed): [ ], ⏎, a click and element.open list the notes carrying it in a query tile beside the reader (Desk.openTag: query=#tag, the service's #tag atom, its home that reader), with a preview of its selection; the list opens as every list does (PIE-794); tile.hold holds it off its reader (PIE-855: TileKind.hold), so the next tag opens a new one", files: "src/refs.ts (tagsIn, presentLinks), src/surface/note.ts (followTarget, SurfaceHost.tag), src/desk/desk.ts (openTag, holdTile), src/desk/query.ts (query=, home, held)",
    aside: "the detail holds Before the first frost: #frost-jobs and #compost in its text are links · a click on #frost-jobs opens a list below the detail of every note tagged with it (the standpipe too: #frost-jobs/water is a nested tag, as views read it), a preview beside the list · j k or a click previews a job, ⏎ or a double click opens it in the detail (alt+← comes back), alt+⏎ in a new detail beside · a click on #compost asks the same list for the other tag · to keep a list, hold it: p in it, a click on the ○ on its frame (● while held) or its menu; held, it keeps its tag (dock it aside with ^W p) and the next tag opens a list of its own, while ⏎ in it still opens in the detail; p again lets it go · ◄ detail on a list's frame says it follows the detail's tags: a click on it (or on ⏎ detail) opens ^W P on the tile's own rows, what it follows and where its opens land, each with a row to change it and one to unlink it · `act element.open n=<the tag's element>` does it for an agent, and its list never takes your keys",
    stage(n, show) {
      const d = detailPane();
      return deskOf({ title: "showcase · tags", panes: [d], names: ["detail"] }, show, [], dsk => { if (n.frost) d.hold(n.frost, dsk); });
    },
  },
  {
    key: "children", need: "list a note's children (a thread's replies) with its links; choose which groups a links tile lists", part: "the one links model's Children group (PIE-693): the notes under a block, with the kind and stage the service computes (blocks.facets), narrowed by Kind, Stage and Sort and counted with the rest; a stage as the notes write it (Dee's answered, PIE-819: named on a group's header, offered by Stage) and the outline's status families (a `[status-family::done]` rule note in Rules); a links tile's groups (backlinks.groups: v, a click on the counters, the tile menu; saved with the layout); the thread tile is a links tile with Children alone", files: "src/links.ts (readChildren, ChildLink), src/desk/backlinks-pane.ts (groups, backlinks.groups), outliner src/store.ts (blockFacets)",
    aside: "left: the seed swap thread · middle: its links, every group: outlinks, resources, backlinks and ↓ children, the counters →♦←↓ across them · right: the same tile with Children alone (the replies) · w steps Stage (open keeps Ana's and Cal's), K the kind, s the sort, on every group · v (or a click on the counters) lists the groups, a click switches one · j k preview, ⏎ opens a reply in the reader, alt+⏎ in a new detail · `act backlinks.groups tile=links show=children,backlinks` does it for an agent, attributed; it never takes your keys",
    stage(n, show) {
      const r = new ReaderPane(), links = new BacklinksPane("reader", true), replies = repliesTile();
      return deskOf({ title: "showcase · children", panes: [r, links, replies], names: ["reader", "links", "replies"], layout: ([a, b, c]) => pair("row", 0.4, leaf(a!), row(0.5, b!, c!)) }, show, [[r, n.swap]]);
    },
  },
  {
    key: "thread", need: "read a thread as a tree, and pick a post without leaving the one you're reading: the root, the parents down to this note, the posts beside each, this note's replies, who wrote each and how long ago",
    part: "the reader's THREAD panel (PIE-944, note.thread): the thread as the service answers it (links.ts readThread: each post's replyTo, the replies at each level from the one membership query readReplies), drawn by the links model's rows (threadRows, linkRowLines) in the reader's own side list; the note you are on marked ►, a long level folded around it with a count (⏎ on the fold shows them); one click rule for every list's rows (RowPresses, src/scroll.ts): a click selects, a second click on the selected row, a double click or ⏎ opens; T the full list, b the outlinks and backlinks",
    files: "src/links.ts (readThread, threadRows, ThreadData), src/scroll.ts (RowPresses, `selected`), src/surface/note.ts (openReplyLinks, note.thread.pick, note.thread.open)",
    aside: "left: a reply three deep in the leek thread, its panel open on the right · the root, the chain down to this note, the eight answers to the question folded around the one it sits under (2 earlier, 1 later), this note's two replies under it · click a row: it only selects · double click or ⏎ opens it through the reader tile's open wire; alt+⏎ or alt-click uses its alt wire; a select wire previews the picked post · ⏎ on a ┄ row shows the folded posts · `act note.thread.pick n=3` and `act note.thread.open n=3` do it for an agent, attributed; they never take your keys",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · thread", panes: [r], names: ["reader"], layout: ([a]) => leaf(a!) }, show, [[r, n.threadHere]], d => { void d.press(r, NOTE_ACTIONS, "note.thread"); });
    },
  },
  {
    key: "links-rows", need: "read long row titles with a chosen line limit", part: "rowLines and rows.lines: word wrapping with a hanging indent; 0 truncates, positive values wrap", files: "src/text.ts, src/links.ts, src/desk/tune.ts",
    aside: "The same links at one line, two lines, and truncate. Tune rows.lines at global, screen, tile or page level; lines= on the component chooses its own limit. Every line opens the same row.",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true), c = new ReaderPane(true);
      return deskOf({ title: "showcase · links rows", panes: [a, b, c], names: ["one", "two", "truncate"], layout: ([x, y, z]) => pair("row", 1 / 3, leaf(x!), pair("row", 0.5, leaf(y!), leaf(z!))) }, show, [[a, n.rowsOne], [b, n.rowsTwo], [c, n.rowsTruncate]]);
    },
  },
  {
    key: "links-block", need: "put a live list with a preview in a note (an outbox in a day's plan): ::links with a query, its rows and the selected one's preview inline", part: "the inline ::links component with query: and preview: (PIE-693): the links model's matches group from blocks.query and blocks.facets, the selected row previewed as the reader draws an embed of it; [ ] steps the rows, ⏎ opens one where opens land, alt+⏎ in a new detail; ⏎ on its ⏎ in goes into the list (a reader mode: j k, / filter, esc out); links.blocks, links.pick, links.open, links.enter", files: "src/links.ts (linkBlockAt, renderLinkBlock, questionRows), src/surface/note.ts (linkBlockUI, linksMode), src/embeds.ts",
    aside: "the day's plan holds its outbox: `::links{query=\"type=letter mail=waiting\" preview=right}` lists the three waiting letters (the sent one isn't), the selected one drawn beside the list · [ ] onto a letter and the preview follows; your keys stay in the note · ⏎ opens it here, alt+⏎ in a new detail; a click selects, a double click opens · ⏎ on ⏎ in (or a click on it) goes in: j k move, / filters, esc comes out, any other key leaves and does what it does · a query the service can't read (`type!=letter`) shows its whole refusal in the frame: the query, what was read, the did-you-mean and an example · `act links.blocks`, `links.pick n=2` (an agent's answers and moves nothing of yours), `links.open n=2`",
    stage(n, show) {
      const r = new ReaderPane(true);
      return deskOf({ title: "showcase · links block", panes: [r] }, show, [[r, n.dayPlan]]);
    },
  },
  {
    key: "list-view", need: "get a real list (selectable, filterable, with a preview) in every client without a door feature: a ::links block, the links tile and an extension's view draw the same rows the same way", part: "the list primitive and the door's one ListView (PIE-747, ADR 0004 contract 3): outline-core's ListRow (one activation each: open, run, copy, insert) in the view primitives, a component's ^name its id, ListView over RowView with each actor's own pick and filter (an agent's drawn in its tint, never moving yours), one ActionSet for every list: list.blocks, list.pick, list.step, list.open, list.filter, list.enter; the links tile, the inline ::links and the tree's links rows are drawn by the same row drawer; Detail draws the rows as text, a page as <ul>", files: "src/surface/list-view.ts, src/surface/list-actions.ts, src/links.ts (linkListRow, renderLinkBlock), src/desk/backlinks-pane.ts, src/surface/note.ts (viewList, listHost), src/components.ts, outline-core src/list-row.ts, outliner src/component-primitives.ts",
    aside: "left, the note: a ::links block (^outbox) over a query with its preview beside, and under it an extension's list view (the seed-shelf script: view.list); right, the links tile on the same note · [ ] steps a note's rows, ⏎ on a frame's ⏎ in goes into a list: j k, / filters, esc comes out · a click selects and previews, a double click opens · the shelf's rows do one thing each: open a letter, copy their titles, run note.copy · agents act on any of them with act list.blocks / list.pick / list.open, tile=reader or tile=links: an agent's pick is its own, drawn in its tint on that row and a line under the list; yours does not move",
    stage(n, show) {
      const r = new ReaderPane(true), links = new BacklinksPane("reader", true);
      return deskOf({ title: "showcase · one list", panes: [r, links], names: ["reader", "links"], layout: ([a, b]) => pair("row", 0.62, leaf(a!), leaf(b!)) }, show, [[r, n.listDemo]]);
    },
  },
  {
    key: "agent-focus", need: "give each agent its own pointer without taking your keys", part: "the dispatcher targets explicit pointers kept by whereabouts; the tile footer and WhoPane show them", files: "src/surface/dispatch.ts, src/whereabouts.ts, src/desk/desk.ts, src/desk/panes.ts",
    aside: "@fern points to the game, @moss to its second reader. Click a dim name to take your keys there. Agents set agent.focus tile=game line=3; no arguments clears it. An agent without a pointer works where your focus is, as before.",
    stage(n, show) {
      const person = detailPane(), game = detailPane(), copy = detailPane(), who = new WhoPane();
      return deskOf({ title: "showcase · agent focus", panes: [person, game, copy, who], names: ["person", "game", "copy", "who"],
        layout: ([a, b, c, d]) => pair("row", 0.7, pair("col", 0.34, leaf(a!), row(0.5, b!, c!)), leaf(d!)) }, show,
        [[person, n.dayPlan], [game, n.press], [copy, n.press]], d => {
          void d.dispatch.act({ action: "agent.focus", tile: "game", args: { line: 3 } }, { kind: "agent", id: "fern" });
          void d.dispatch.act({ action: "agent.focus", tile: "copy", args: { line: 5 } }, { kind: "agent", id: "moss" });
        });
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
    key: "inline-lists", need: "scroll a list inside a note and walk its rows with the arrow keys", part: "NoteSurface elements with RowView: inline views, links, backlinks, tables and tabs share a viewport", files: "src/surface/inline-list.ts, src/surface/note.ts, src/doc.ts",
    aside: "60 fictional parcels: wheel over the list, then move into it with down; Enter opens, alt+Enter opens beside, a click previews. At either end the wheel and arrows return to the note.",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · inline lists", panes: [r], names: ["parcels"] }, show, [[r, n.inlineLists]]); },
  },
  {
    key: "live", need: "put live data in a note", part: "live figures: ::graph-* blocks that read views with views.read and blocks.query; the comparison kinds (quadrant, matrix, compare, flow, a meter's limit) and one width rule for every kind (tier: narrow, cozy, wide)", files: "src/live.ts, src/graphs.ts, src/figures/, src/views.ts",
    aside: "S opens the sources inspector; click it to give it keys, Esc returns to reading. The Sources header chip opens the shared placement menu: inline, floating, split, popup or tile; beside/below sets the split direction, its divider resizes it, and ctrl+o cycles. Open a comment too and float it: both remain drawn, the focused one on top. Zoom a sources tile to see Query, Transform and Result across its width. Enter or e on a figure property edits its YAML in place; density uses schema choices, group and columns use the result rows' properties. Enter saves, ctrl+z undoes; g reveals its line. Result rows select with j/k or a click; Enter opens, alt+Enter opens beside.",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · live", panes: [r] }, show, [[r, n.figures]]); },
  },
  {
    key: "questions", need: "ask the outline a question that stays answered: what links to a note that it doesn't link back, grouped by any property", part: "watched questions (ADR 0004 contract 1, PIE-745): this, linkedfrom: and parent: in the views' grammar; the service evaluates where, group and sort and counts every match (blocks.query's groups, facets, hint), and tells the connection when a watched answer changed (queries.changed); ::links and live figures read through the board's watched reads, never a cache of their own", files: "src/watched.ts, src/live.ts, src/links.ts, outliner src/query-watches.ts, src/question-answer.ts, outline-core src/query-atoms.ts",
    aside: "the society page asks one question three ways: `links:this NOT linkedfrom:this` (what mentions it that it doesn't link back) as a ::links list, as tabs grouped by crop and as a rank by season: properties no code knows, grouped by the service · link one back (or write a note that mentions the society) and all three change on their own: the service says the answer changed, the door asks nothing on paint · `group:` takes any property, or created:day|week|month",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · questions", panes: [r] }, show, [[r, n.society]]); },
  },
  {
    key: "fields-if", need: "see every place a note wrote a key, and draw a paragraph only while the note matches a query", part: "::fields and ::if (PIE-533 S3): outline-core's siteBlockAt reads them, the service answers them through site.answer (produce fields / if: the note's own Site, watched), src/site-blocks.ts draws the answer; a row opens its line lit, found again by the text it was written as (LinkTarget at + atLabel, revealAt), and its ¶ gives the line an anchor on request (fields.anchor, fragments.ensure)", files: "outline-core/src/site-blocks.ts, outliner/src/site-producers.ts, src/site-blocks.ts, src/doc.ts, src/surface/note.ts (fields.anchor)",
    aside: "one key, connectTo, written every way a note can: in the header, on two front-matter lines (one holding a list, a row per value), inline in a sentence and on a line of its own · ::fields{key=connectTo} lists each occurrence with the line it is on, and a second ::fields{key=tag} lists the #hashtags (a hashtag is the key tag) · edit (e, then Enter), open the preview (ctrl+p), and type a third `[connectTo::…]` line: its row appears before saving; ::if and {{this.connectTo}} follow the draft too · change a fields component's of= and its ¶ targets the new rows; removed components leave no cached anchor choices · the note also draws one of two ::if bodies: the one for status=active; change status to paused and the other is drawn · ⏎ or a click on a row opens its line lit · ⏎ on a row's ¶ (fields.anchor, or act) anchors that line, the only thing the component writes",
    stage(n, show) { const r = new ReaderPane(true); return deskOf({ title: "showcase · fields and if", panes: [r] }, show, [[r, n.fieldsRail]]); },
  },
  {
    key: "templates", need: "write a template once and use it two ways: drawn live where a page says ::use, or written out as a new note to edit", part: "templates (PIE-533 S4): a template's [form-field::…] chips declare its props (outline-core's form-fields.ts, props-spec.ts) and `[template-for::meeting]` says what it makes; ::use{of=[[meeting-template]] with=Ada} is read by outline-core's template-use.ts and answered by the service (`template.use`, watched: the template found, props resolved in the page's own Site and checked, defaults applied, the chain to draw the body in), then src/template-use.ts draws the template's body in place with `this` the page (the reader's own renderer, a figure over `{{this.project}}` lists each page's own); a prop left out is an offer (use.fill asks it in the power bar and writes it onto the line, ctrl+z undoes); template.stamp (src/template-stamp.ts, the service's template-stamp.ts) writes the filled text as a new note: props.*, self.* and now.* filled, this.*, parent.* and bare keys left as {{ }} (freeze=all writes them too), for= once per match", files: "outline-core/src/template-use.ts, src/props-spec.ts, src/form-fields.ts, src/component-schemas-use.ts, outliner src/template-use.ts, src/template-stamp.ts, src/templates.ts, src/template-stamp.ts (door), src/template-use.ts (door), src/surface/note.ts (use.fill, use.undo)",
    aside: "The nested Meeting greeting passes with= into a second template; Detail and publishing draw its resolved words too · left: Sowing meeting, right: Potting meeting, the same ::use of the same template, each with its own `this` (Filed on …) and its own actions in the figure · below them Unfinished meeting names no `with` and a mood the template doesn't offer: both are said where they are, with the nearest name, and `needs with · ⏎ asks` opens the picker, then writes with=… onto the line (ctrl+z takes it back) · `act template.stamp of=[[daily-template]] parent=[[daily notes]] title='{{now.date}}'` writes today's daily note (this and parent left to read where it lands), freeze=all writes those too · `act template.stamp of=type:meeting with='{\"with\":\"Jay\"}'` finds the template by what it makes",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true), c = new ReaderPane(true);
      return deskOf({ title: "showcase · templates", panes: [a, b, c], names: ["sowing", "potting", "unfinished"], layout: ([x, y, z]) => pair("col", 0.6, pair("row", 0.5, leaf(x!), leaf(y!)), leaf(z!)) }, show, [[a, n.meetingSowing], [b, n.meetingPotting], [c, n.meetingUnfinished]]);
    },
  },
  {
    key: "page-figure", need: "copy one figure onto two pages and have each list its own", part: "a figure over this (PIE-533 S3): query: type=ticket project={{this.project}} is a value operand bound from the page the figure sits on (never pasted into the query), so the same ::graph-table on two project pages lists each page's own tickets; the service answers it in the figure's Site (site.answer produce figure), the door and the publisher both draw that answer", files: "outliner/src/site-producers.ts, outliner/src/site-answer.ts, src/live.ts, outliner/src/publish-live.ts",
    aside: "two project pages carry the very same figure text · Lego night lists its two tickets, Garden club its three · a figure takes call-site args too (::graph-table{project=lego-night} reads {{props.project}}), and drawn through a template the host is `this`",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true);
      return deskOf({ title: "showcase · a figure on two pages", panes: [a, b], names: ["lego", "garden"], layout: ([x, y]) => pair("row", 0.5, leaf(x!), leaf(y!)) }, show, [[a, n.projectLego], [b, n.projectGarden]]);
    },
  },
  {
    key: "dates", need: "ask about dates and numbers on any property: what's due in three days, what's done waiting, which window today is inside, grouped by the week",
    part: "typed comparisons in the views' grammar (PIE-769): key < <= > >= a bound on any property, a date when the bound reads as one (today, tomorrow, -7d, +3d, 2026-10-20, Oct 20, 10/20, 20 Oct), else a number, else text; key=<date> is that day, or a span holding it; one reader of dates as people write them (outline-core dates.ts) for the evaluator, sorts, date groups (<key>:day|week|month|year) and the save warning; the service says which values it couldn't read (the answer's hint)",
    files: "outline-core src/dates.ts, outliner src/block-query.ts (compare), src/question-answer.ts (date groups, questionValueWarning), src/query-watches.ts (the day turning), outline-core src/reference-warnings.ts (dateWarnings)",
    aside: "the calendar note asks four questions of made-up dates written four ways, seeded relative to today; the lanes are saved views on the Plot calendar board ([query::type=plot-date due <= +3d] [sort::due] [direction::asc]); \"after the frost\" isn't a date, so it matches nothing and the figures say so under them; a release window 2026-10-20..2026-10-24 is = today while today is inside it, <= today once it has begun, >= today until it's over; at midnight every watched answer is asked again, so tomorrow's lanes fill themselves",
    stage(n, show) {
      // The calendar note held in its reader while a lane's selection moves (the lanes' previews go to the current note).
      const r = new ReaderPane(true);
      const lanes = n.datesBoard ? [columnsOf<number>([], { key: "lanes", source: `hub:${n.datesBoard.id}` })] : [];
      return deskOf({ title: "showcase · dates", panes: [r], names: ["calendar"], layout: ([a]) => lanes.length ? splitOf("row", [leaf(a!), ...lanes], [0.5, 0.5]) : leaf(a!) }, show, [], d => { if (n.dates) r.hold(n.dates, d); });
    },
  },
  {
    key: "tabs", need: "switch a live figure's tabs, or how many lines its rows take", part: "a figure's reading state: ::graph-tabs (a query's results grouped by a property, a tab each) and a table's density, kept by the reader, switched by figure.tab and figure.density (tab shift+tab ← →, =, a click, act)", files: "src/graphs.ts, src/live.ts, src/surface/note.ts",
    aside: "[ ] onto a tab, then ← → or tab shift+tab switch; ↑ ↓ select rows, Enter opens their notes, Esc leaves the figure; a click on a row selects it and shows its note where opens land; = steps compact, cozy, comfortable (titles wrap past PLOT-1 — ); a click on a tab or ≡ does the same; these are reading choices. S opens the shared inspector: Enter/e edits a property in its YAML, ctrl+z undoes; two readers of one note keep their own tab and density",
    // Two readers on one note: each keeps its own tab and density.
    stage(n, show) { const a = new ReaderPane(), b = new ReaderPane(); return deskOf({ title: "showcase · tabs", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.plotJobs], [b, n.plotJobs]]); },
  },
  {
    key: "steps", need: "tick a checklist step, or answer one: Approve (the person's yes) or Reject (their no)", part: "a step's box as a control (PIE-472, PIE-811): outline-core's checklist-marks.ts is the one box grammar (to do, done, waiting, problem, approved [✓], rejected [✗]; [+] and [-] read the same) for the service's checklist.query and checklist.update, Detail's step menu, the door's status choice (STEP_CHOICES, a ListPicker: x o + - w !, a click) and the web pages' step buttons; each change is checked against the step as read and recorded as whoever made it", files: "outline-core/src/checklist-marks.ts, src/steps.ts, src/surface/note.ts, outliner src/checklist-items.ts, src/publish-steps.ts",
    aside: "[ ] to a step under Needs you, ⏎ (or a click on its box) opens its choices: + approves, - rejects, x done, o to do; space reopens a closed one · ctrl+z undoes your last · `act task.status n=1 to=approved` does it for an agent, attributed; `act tasks` reads them, and an agent takes approved as your yes · the same choices are in Detail's menu and on the note's web page, a tap on the box",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · steps", panes: [r], names: ["build log"] }, show, [[r, n.buildLog]]); },
  },
  {
    key: "values", need: "write a value that lives in the note, its parent or another note into the prose, so it reads as that value in every reader and is edited where it is written: {{this.owner}}, {{parent.project}}, {{person.firstName}}, {{((id)).query}}, {{[[page]].key}}", part: "the Site's values (PIE-533): the service resolves each {{ }} (`site.answer`, outline-core's resolve-path.ts and interpolation.ts; the same answer feeds Detail, the web page, ep0ch show and outline_read) and the door only draws it: presentLinks puts the value in place as an element (italic: computed; a URL in a link's colour; one with no value dimmed as typed, with the nearest key); ⏎ or a click on it lights the line it is written on; a selection of the drawn words is the whole token (source-map.ts), so a comment anchors on it; the property panel lists them under the note's properties", files: "outline-core/src/site-values.ts, src/refs.ts (siteAnswerOf, presentLinks), src/surface/note.ts (followTarget, sourceOf), src/surface/source-map.ts, src/surface/props-panel.ts, outliner src/site-answer.ts, src/detail-embeds.ts, src/publish-values.ts",
    aside: "the reader shows the note as it reads: Owner, the project from its parent, the guide through the person link, the recipe's query through ((id)) and the first name through [[page]] · [ ] steps onto a value, ⏎ or a click lights the line it is written on (`act element.open n=…` for an agent, which leaves your cursor alone); `act select text=Ada` then `c` comments on the whole {{this.owner}} · {{this.ownr}} is saved as typed and drawn dimmed with its did-you-mean (owner): e, fix the typo, ctrl+s and it redraws · i opens the property panel, which lists every value read here and where it came from · `ep0ch show <id> --site` and outline_read return the same answer, the web page carries the values and leaves out any that read a note it may not show · the editor shows the source as written",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · notes that read themselves", panes: [r], names: ["vent rail"] }, show, [[r, n.ventRail]]); },
  },
  {
    key: "figure-steps", need: "work through a test plan in place: copy its URL, follow its link and tick each step, in a ::graph-check as on a plain line", part: "a component's words drawn through the reader's inline pipeline (PIE-864: palette.ts RowInline and inlineRows, DocEnv.present: code spans copy, links follow, emphasis drawn) and a ::graph-check row's box as a checklist step (outline-core's figureSteps; the service's checklist.query and checklist.update rewrite a written row's box; a live row's mark writes the property its done: names, liveMark); the same on the web page, the boxes as buttons", files: "outline-core/src/figure-props.ts (figureSteps), outline-core/src/figure-live.ts (liveMark), src/figures/palette.ts, src/graphs.ts, src/doc.ts, src/surface/note.ts (liveStep, markLiveRow), outliner src/checklist-items.ts, src/publish-live.ts, src/publish-figures.ts",
    aside: "a click on the URL in the You test figure copies it, as on the line above; [ ] stops on [[Shed roof build log]] in a row and ⏎ follows it · [ ] to a row's box, ⏎ (or a click) opens its choices: x done, o to do, + - w !, space toggles; the figure's line in the note gets the mark · the live jobs below are the note's children: x on one writes its [status::done], o writes [status::todo] · ctrl+z undoes either · `act task.status n=4 to=done` does it for an agent; on the note's web page the same boxes are buttons",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · figure steps", panes: [r], names: ["test plan"] }, show, [[r, n.testPlan]]); },
  },
  {
    key: "resource-comments", need: "comment on a Resource (a file, a fetched page): select text, C", part: "comments on a Resource's stored text (PIE-650): the reader showing a Resource takes C and m like a note; the thread is stored in the outline (annotations.batch resource-comment, threads through annotations.reconcile), quoting the selection from the file's own source and keeping the note whose link opened it as its reference context; the file is never written", files: "src/authored.ts (resourceNote, alignComments), src/socket.ts (commentOnResource, comments), src/desk/panes.ts (ReaderPane.refuses), src/draft-session.ts, outliner src/resource-comments.ts",
    aside: "left: the block whose [file::] link names the bed plan; right: the file as a Resource, one thread already on it (m lists it). Select a passage and press C (or click ⋯ comment), or act passage.select then comment.send · a file an agent rewrites keeps its threads: the service re-anchors a quote that is still there and shows the rest as they read when written · the thread also lists as a backlink of the left block",
    stage(n, show) {
      const note = new ReaderPane(), res = new ReaderPane();
      const plan = RECENT_FILES()[0]!;
      return deskOf({ title: "showcase · resource comments", panes: [note, res], layout: ([a, b]) => row(0.4, a!, b!) }, show, [], d => {
        void (async () => {
          const block = (await d.ctx.board.byProp("file", plan.file, 1, "show"))[0];
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
    key: "marginalia", need: "read with a pen: highlight a passage, comment on it, ask about it, look a word up, copy it with a citation; keep the margin and a notebook of it all, on a note and on a file",
    part: "the passage target (ADR 0004 contract 5: outline-core passage.ts, one find and check for every client; the reader's exact selection to source, src/surface/source-map.ts; passage.act and its toolbar on the selection's line, a then a key) and highlights and margin notes (contract 6: annotations with open properties, outline-core annotation-marks.ts; the reader's spans in a tone and margin cards, beside the text when wide, under the passage when narrow, src/surface/margin.ts); marginalia's kit is an extension folder (outliner extensions/marginalia: on: passage actions and an agent that answers in threads) plus a notebook note (a saved query)",
    files: "outline-core/src/passage.ts, outline-core/src/annotation-marks.ts, src/surface/source-map.ts, src/surface/margin.ts, src/surface/note.ts (passageFor, passage.act, margin), src/extensions.ts (passage actions), outliner src/extension-calls.ts (actOnPassage), outliner src/agent-requests.ts (threadWritten), outliner extensions/marginalia",
    aside: "left: a made-up greenhouse plan, one highlight and one answered question on it; right: the leaflet it's read beside (a file, as a Resource) and the notebook. Select words, then a h highlights, a d defines from the plan's glossary, a a asks @margin (its answer lands in the margin), a k copies with a citation; or click the chips on the selection's line, or act passage.act action=… quote=… · M: shown, full, or marks; [–] folds either thread to its fixed gutter [+], which opens just that thread",
    stage(n, show) {
      const plan = new ReaderPane(), file = new ReaderPane(), book = new ReaderPane();
      return deskOf({ title: "showcase · marginalia", panes: [plan, file, book], names: ["plan", "leaflet", "notebook"],
        layout: ([a, b, c]) => pair("row", 0.62, leaf(a!), pair("col", 0.55, leaf(b!), leaf(c!))) }, show, [[plan, n.marginalia], [book, n.marginaliaNotebook]], d => {
        void (async () => {
          const opened = await openResource(d.ctx.board, { reference: { kind: "filesystem", path: MARGINALIA_FILE() } }, USER, n.marginalia?.id);
          file.show(opened.note, d);
          d.redraw();
        })().catch(() => {});
      });
    },
  },
  {
    key: "margin-attention", need: "put a margin thread away once it's read, keep the good ones, and fold a talked-out thread behind a short summary, the same in every client: seen, keep and TL;DR instead of resolve (a curiosity or a thanks isn't a ticket to close)",
    part: "a mark's lifecycle as attention (PIE-791, outline-core annotation-marks.ts: open, seen, kept, resolved; markCurrent says what the margin shows by default), stored by the service (annotations.lifecycle; a new reply brings a seen thread back) and a thread's TL;DR (annotations.tldr: @margin writes a reply with [kind::tldr], or the person does; the newest is the thread's face). The door's thread list (s seen, p keep, t TL;DR; a current list, then the earlier shelf), an expanded thread's [Seen] [Keep] [TL;DR], the margin's cards current only; the web page's cards the same. And a posted comment or reply edited in the same editor (PIE-763): the service's annotations.update (revision-checked, marked edited, its earlier words its revisions), the draft session's commentEditTarget, e in the list and [Edit] on an expanded thread and each reply",
    files: "outline-core/src/annotation-marks.ts, outliner src/annotation-repository.ts (setLifecycle, reply, update), src/agent-requests.ts (tldr), src/server.ts (annotations.tldr, annotations.update), src/socket.ts (comments, setLifecycle, tldr, updateComment), src/comment.ts (attend, askTldr, editMark), src/draft-session.ts (commentEditTarget), src/surface/note.ts (thread.seen, thread.keep, thread.tldr, comment.edit), src/surface/note.ts (threadPanel)",
    aside: "the pump rota's margin: one current comment, one kept with its TL;DR as the card's face (its discussion behind it), and one seen, off the margin and on the thread list's earlier shelf. m opens the list (current, then earlier): s on a thread marks it seen or brings it back, p keeps or unkeeps it, t asks @margin for its TL;DR (with no model set up for @margin none is written, and it says how to set one up, PIE-860), T takes it away; ⏎ on a mark expands its thread with [Seen] [Keep] [TL;DR], and a thread with one shows it once, as its face, with [Edit TL;DR] [TL;DR again] [No TL;DR] · a seen thread leaves no card, in a narrow reader too · e on a thread edits its words in the comment editor, [Edit] on an expanded thread or a reply edits those (ctrl+s saves; it then says edited) · act thread.seen thread=<id>, thread.keep, thread.tldr (body= writes it yourself, remove=true takes it away), comment.edit thread=<id> reply=<id> body=…",
    stage(n, show) {
      const reader = new ReaderPane();
      return deskOf({ title: "showcase · margin attention", panes: [reader], names: ["rota"], layout: ([a]) => leaf(a!) }, show, [[reader, n.attention]]);
    },
  },
  {
    key: "margin-replies", need: "talk in the margin and find the answers later: a thread is one conversation (@margin there resumes it; a reply without it is a note to self, never answered), and every reply on your threads comes back to one place, the new ones unread until you open the thread; any mark quoted into a block of its own that traces back to it",
    part: "a margin thread's session (outliner agent-requests.ts answerInThread: the thread's [margin-session::] handed back to marginalia's respond; the whole thread and the page's other comments every time) and Recent replies: a saved view in the views' grammar (outline-core recent-replies.ts: thread:me, unread:me over the service's read marks, PIE-708), the same question the web client's /replies page asks; opening a thread marks it read (annotations.read: the person's thread.toggle, a click on its card or mark); a mark is a block, so quoting one (or several) into a new block is the service's marks.quote: each transcluded under [from::((mark))], each card then quoted in, one undo step (the door's quote action, q and space in the thread list, [Quote] on an open thread; the web page's Quote; MCP outline_quote)",
    files: "outline-core/src/recent-replies.ts, outline-core/src/query-atoms.ts (unread:, thread:), outliner src/read-marks.ts, src/agent-requests.ts, extensions/marginalia, src/publish.ts (serveReplies), src/surface/note.ts (readThread, quote), outliner src/mark-quote.ts, src/bar/ask.ts",
    aside: "left: the greenhouse plan, its question answered and a note to self after it (no @margin, so no answer); right: Recent replies, the answer on it. Click the question's card (or ⏎ on its mark) to open the thread: it's read, and unread:me no longer lists it. Write @margin in a reply to ask again in the same conversation · quote it: [Quote] on the open thread (or m, then q on a thread, space to pick several first) asks where in the power bar (the Inbox, under this note, or any note by its words); the new block transcludes each mark with a [from::] back-link, the card says quoted in (⏎ opens it), ctrl+z takes it back · act quote threads=<id>,<id> where=inbox",
    stage(n, show) {
      const plan = new ReaderPane(), replies = new ReaderPane();
      return deskOf({ title: "showcase · margin replies", panes: [plan, replies], names: ["plan", "replies"],
        layout: ([a, b]) => row(0.58, a!, b!) }, show, [[plan, n.marginalia], [replies, n.recentReplies]]);
    },
  },
  {
    key: "output-regions", need: "draw what a script, handler or agent generates as the note's own content, with its controls behind one mark", part: "the output-region rule: regionRows/regionTail (src/output-region.ts) behind extensionRegion, useRegion and the [!output] callout branch of renderDoc; the gutter mark, its click and `[ ]` stop in NoteSurface; outline-core's output-region.ts grammar", files: "src/output-region.ts, src/projection.ts, src/template-use.ts, src/doc.ts, src/surface/note.ts, outline-core src/output-region.ts",
    aside: "three generated regions in prose (a script's table, a ::= sentence, a written output region): flush with the text, no box or header · each has one dim ≡ in the margin: [ ] on it, or a click, shows its name, when it ran, keep and run again as one dim row; a second click lets go · hover isn't offered: the door asks the terminal for button events, not motion · r with no [ ] position runs nothing when a note has several lines that run, and says which · edit a word inside the written region and it is yours: its script's next output waits as a proposal · S opens Sources: its tile hint row says its bound keys once. Esc closes it from Sources or the reader beside it; Left returns from one source to the list. Its placement chip opens the comment box's menu: inline, floating, split, popup or tile. Beside/below sets a split's direction; drag its divider to size it. A wide Sources float or tile shows Query, Transform and Result side by side. Zoom the note, then float Sources and a comment: drag their grips past either side of the text column, or ctrl+g then shift+arrows to size them up to the tile border. The note keeps its text width. Enter opens the table, c downloads CSV and J JSON (also clickable); published pages use the same answer",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · regions in prose", panes: [a, b], names: ["notes", "source"], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.outputRegions], [b, n.scripts]]);
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
    aside: "in an edit, @ at a line's start offers the agents (@tidy) with what each does and when it runs (PIE-592) · the outliner's example extensions (moon, horoscope, fancy-horror, tarot, tidy, and almanac: a scheduled program whose ext.almanac.write-day, by act or at 06:05, writes a dated note under the Almanac page over its own connection, as ext:almanac), copied into the showcase's own config dir when try-it names the checkout; without them the lines are properties and the list on the left says so",
    stage(n, show) {
      // What the service's list bound, drawn the way a service tile is: each extension, what it answers, its actions' keys.
      const list = serviceKind({
        kind: "showcase.extensions", about: "the extensions bound, listed",
        render: async req => {
          const l = extensionList();
          const rows = !l ? [`${fg(C.yellow)}this service lists no extensions (it lacks extensions.list, or none are installed)${RESET}`]
            : l.extensions.flatMap(e => e.id.startsWith("script-")
            // A script is one line (its notes are in the sections that use them; four lines each would push the programs off a screen).
            ? [`${fg(C.lcyan)}${e.name}${RESET} ${fg(C.dark)}script · ${e.state}${RESET}`]
            : [
              `${fg(C.lcyan)}${e.name}${RESET} ${fg(C.dark)}${e.id} · ${e.state}${RESET}`,
              ...e.handlers.map(h => `  ${fg(C.grey)}${h.key}:: ${fg(C.dark)}${h.kind}${RESET}`),
              ...(e.agents ?? []).map(a => `  ${fg(C.grey)}@${a.name} ${fg(C.dark)}agent${RESET}`),
              ...e.actions.map(a => `  ${fg(C.white)}${a.name}${RESET}${a.key ? ` ${fg(C.dark)}${a.key}${RESET}` : ""}`),
              // Its schedules (PIE-754): when each runs, when next, and what the last run did.
              // Host-wide (PIE-767): once per host, and the outline it runs in when that's another.
              ...(e.schedules ?? []).flatMap(x => [`  ${fg(C.grey)}schedule ${x.entry} ${fg(C.dark)}${x.every ? `every ${x.every}` : `cron ${x.cron}`}${x.once === "host" ? ` · once per host${x.runsIn ? ` · runs in ${x.runsIn}` : ""}` : ""}${RESET}`,
                `    ${fg(C.dark)}${x.running ? "running · " : ""}${x.last ? `last ${x.last.ok ? x.last.message ?? "ok" : `failed: ${x.last.error ?? ""}`}` : "not run yet"} · next ${x.next.slice(0, 16).replace("T", " ")}${RESET}`]),
            ]).concat(l.tileKinds.map(t => `${fg(C.lcyan)}${t.kind}${RESET} ${fg(C.dark)}tile kind${RESET}`));
          return { title: "extensions", lines: rows };
        },
      }).make({ kind: "showcase.extensions" });
      const r = new ReaderPane();
      return deskOf({ title: "showcase · extensions", panes: [r, list], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.omens]], d => { if (n.omens) d.setCurrent(n.omens); });
    },
  },
  {
    key: "gallery", need: "show a picture in an extension's view (a card's cover, a gallery, a mood board)", part: "the image primitive (PIE-827): { type: \"image\", src, alt?, size?, fit?, height?, caption? } (caption: false, PIE-839: a card's cover drawn alone), outline-core's imagePrimitiveSpec turns it into the media line's spec, primitiveLines hands it to the reader's PrimitiveDraw.image, which lays it out as a note's [img::] line is (doc.ts mediaRows: the graphics budget, dark-first dimming, its caption); a zero-width tag on its first row says where the view put it, and the reader places the picture there, its cells on the terminal's own background (a terminal may draw it under a tinted cell)", files: "src/components.ts, src/doc.ts (mediaRows), src/surface/note.ts (pictureRows), outliner src/component-primitives.ts, outliner extensions/gallery",
    aside: "the outliner's gallery extension (installed with the rules): gallery:: draws the notes under it as cards with their [cover::] pictures, pic:: draws one · [ ] stops on a picture's caption and ⏎ opens it, a card's title opens its note · under Kitty graphics the pictures are drawn, dimmed as a note's are; elsewhere each caption says what it is · nothing is written to the outline: on a page each picture is served as a note's image is, when the publish roots allow it",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · gallery", panes: [r], layout: ([a]) => leaf(a!) }, show, [[r, n.gallery]]);
    },
  },
  {
    key: "machinery", need: "leave out what tools write for their own bookkeeping (tosses, file touches, deliveries, backup runs) so a list shows what people wrote, and find it again when you want it",
    part: "machinery (outline-core machinery.ts, PIE-867): a producer stamps its records [machine::<producer>]; one flag, machinery: hide|only|show, on blocks.query, tree.search, activity.recent, changes.since and a saved view's [machinery::] answers it in the service, and the door only passes it on. The main menu's newscan line reads \"73 · 12 by people\" (every change since logon, and the part that is not machinery); a click on it is the N key. The what-changed list and the status bar's +N machine hold it back until changes.machinery shows it. ep0ch machinery backfill stamps what was written before",
    files: "outline-core/src/machinery.ts, outliner src/block-query.ts (queryPredicate), src/change-feed.ts (machineryClause, bookkeeping), src/store.ts (recentEditActivity, searchTree), src/virtual-branches.ts, src/machinery-backfill.ts, src/desk/what-changed.ts, src/screens.ts (MainMenu, changes.machinery)",
    aside: "one question asked twice, of the same chores, tosses, backup runs and file touches: left, the people's view (machinery hidden, the default); right, the same query with [machinery::only]. The view notes carry nothing but their query; the stamps are on the tools' own notes",
    stage(n, show) {
      const people = new ReaderPane(), tools = new ReaderPane();
      return deskOf({ title: "showcase · machinery", panes: [people, tools], names: ["people", "tools"],
        layout: ([a, b]) => row(0.5, a!, b!) }, show, [[people, n.machineryPeople], [tools, n.machineryTools]]);
    },
  },
  {
    key: "runbook", need: "run a note's steps in a terminal and answer a masked prompt",
    part: "runbook extension plans and records; compact asks through askInBar and ListPicker; PtyPane through PtyBackend in the desk",
    files: "src/runbook.ts, src/bar/ask.ts, src/desk/pty.ts, outliner/extensions/runbook",
    aside: "run each fence by mouse or keyboard; context flows down the note, prompts stay private, and the Runs table keeps each result",
    stage(_n, show) {
      const reader = new ReaderPane();
      const d = stageDesk({ title: "showcase · runbook", panes: [reader], layout: ([a]) => leaf(a!) });
      show(ctx => void (async () => {
        const listed = extensionList() ?? await ctx.board.listExtensions();
        const page = listed.pages?.runbook;
        const book = page && (await ctx.board.children(page)).find(b => b.text.startsWith("Try a terminal runbook"));
        if (book) reader.show(book, d);
        ctx.redraw();
      })());
      return d;
    },
  },
  {
    key: "ext-pages", need: "give an extension a page in the outline that explains and demonstrates it (its README, what it adds, its demo notes), list what's installed and what isn't, install or remove one", part: "the extensions' pages (outliner src/extension-pages.ts, src/extension-demo.ts): the service writes the Extensions hub and a page per installed extension from its folder (README drawn as the note, what its manifest adds, its CHANGELOG's head), and its demo/ notes under the page once, as ext:<id>, with fresh ids; extensions.list says the hub, each page and what's available; extensions.install and extensions.uninstall (demo=keep|remove, never silently) are actions in EXTENSION_INSTALL_ACTIONS, reached by the power bar's extensions scope (&: ⏎ or a click on a row) and act; the pages are notes, read by the note surface; structure's extract of a line ending in ^s5 takes the anchor with it (a move-anchor in its write group, PIE-829): the Garden diary's link points at the new child, no forwarding line, one undo", files: "outliner src/extension-pages.ts, outliner src/extension-demo.ts, src/extensions.ts (EXTENSION_INSTALL_ACTIONS), src/bar/sources.ts (EXTENSIONS)",
    aside: "ctrl+k, & lists extensions: choose make your own for the ep0ch-extend skill and ep0ch docs extensions. The notifications hub (on made-up Gmail, Jira and Slack, pulled once) and the runbook extension, copied into the showcase's own config dir when try-it names the checkout; without them there is no hub, and the readers stay empty",
    stage(_n, show) {
      // The hub on the left; the notifications hub's page on the right, its demo boards under it, live.
      const hub = new ReaderPane(), page = new ReaderPane();
      const d = stageDesk({ title: "showcase · extension pages", panes: [hub, page], layout: ([a, b]) => row(0.5, a!, b!) });
      show(ctx => void (async () => {
        const l = extensionList() ?? await ctx.board.listExtensions().catch(() => null);
        const [h, p] = await Promise.all([l?.hub ? ctx.board.get(l.hub) : null, l?.pages?.notify ? ctx.board.get(l.pages.notify) : null]);
        if (h) hub.show(h, d);
        if (p) page.show(p, d);
        ctx.redraw();
      })().catch(() => {}));
      return d;
    },
  },
  {
    key: "forms", need: "enter data through a form written in the note it's for: one action, each note its own fields",
    part: "the action's arguments (PIE-784) from the note (PIE-828): an action with fieldsFrom: block asks for the [form-field::<name> <type> …] chips of the block it runs on (outline-core's form-fields.ts reads them; the service checks the answers as declared arguments, extensions.args lists them on that block); NoteSurface draws one form in place, text and number boxes using the shared Draft editor, choices as radio chips, defaults selected and required warnings kept beside the answers; ext.form.fill submits through the existing action; an agent gives them in with=; a chip that can't be read is saved and warned on, with a did-you-mean",
    files: "outline-core/src/form-fields.ts, outliner src/extension-calls.ts (argsOn), src/surface/note-form.ts, src/surface/note.ts, src/extensions.ts (askingFirst)",
    aside: "the outliner's example Form extension: click a box to type, or use [ ] then Enter to enter the form; Tab/shift+Tab moves between fields, left/right chooses a radio chip, Enter or the button submits, Esc leaves with answers kept; each entry lands under its note with its answers as properties · change a note's [form-field::] chips and the next run asks the new form · an agent: act ext.form.fill block=<id> with='{\"part\":\"roof\",\"what\":\"a slipped tile\"}'",
    stage(n, show) {
      const reading = new ReaderPane(), repairs = new ReaderPane();
      return deskOf({ title: "showcase · forms", panes: [reading, repairs], layout: ([a, b]) => row(0.5, a!, b!) }, show, [[reading, n.formReading], [repairs, n.formRepairs]]);
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
    key: "settings", need: "set up a configurable note (a rule, a view, a callout type, a heading style, an extension's component) without typing its properties",
    part: "the settings card (PIE-786, src/surface/settings-card.ts): the property panel's other face, its fields the note's component schema's (outline-core component-schema.ts, components.schemas: a note is configurable when it carries a schema's declaring property), each set with a picker in the power bar (askInBar, src/bar/ask.ts: an enum's values, a query built over this outline's own properties and values from properties.catalog, a note by search, the actions extensions offer, the writers a rule hears, a duration); settings.set and settings.clear write one properties.patch, attributed",
    files: "src/surface/settings-card.ts, src/surface/note.ts (settings, settings.set, settings.clear), src/surface/props-panel.ts, src/bar/ask.ts, outline-core/src/component-schema.ts",
    aside: ", on a rule note or a view opens its card; on the right, Plot chat is a view and an EchoNet area, so its card has a section for each · tab or j k to a field, ⏎ (or a click on the selected field) picks in the power bar, x clears it, i lists every property, esc closes · try rule-tone: the badge on the job beside changes colour · rule-match builds a query from what this outline's notes have · an agent: `act settings` lists the fields, `act settings.set key=rule-tone value=good`",
    stage(n, show) {
      const r = new ReaderPane(), view = new ReaderPane();
      return deskOf({ title: "showcase · settings", panes: [r, view], layout: ([a, b]) => row(0.6, a!, b!) }, show, [[r, n.settings], [view, n.echoArea]]);
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
    key: "session", need: "keep the door running without a terminal: quit detaches, attach again, several terminals at once", part: "the door session: one daemon per outline (its folder of the state dir, src/session/place.ts) holds the App (screens, layouts, the dispatcher, drafts, terminal tiles, the service connection); clients attach over session.sock and are only terminals; SessionTerm is the App's terminal, a Painter per client (its size, video mode and Kitty images), the keys wherever the person last typed. A handover to new code (`ep0ch session restart`, a deploy) restores from the checkpoint (src/session/restore.ts): the screens, the edits, and a comment being written as it sat (PIE-847: NoteSurface.reopenSteps, the actions that open it, place it, size it and put its cursor back, run by restore's reopen; its text the draft session's put-aside), and the tune inspector's unsaved nudges (look.nudge)", files: "src/session/place.ts, src/session/daemon.ts, src/session/client.ts, src/session/session-term.ts, src/session/protocol.ts, src/session/restore.ts, src/display.ts",
    aside: "G and ctrl+c detach the terminal you're on, and everything goes on; E on the main menu (or `ep0ch session end`) ends the session; `ep0ch session attach --watch` shows it read-only; `ep0ch session list` says who's attached · `ep0ch --remote <ssh-name>` is this terminal on the session running on that machine; `--machine <ssh-name>` keeps the door here and its outline there, over one shared ssh forward · the reader has a comment half written, floating: drag it, size it, type on, then `ep0ch session restart` in another terminal hands the session to new code and it comes back as you left it, the status line says so (a door run with --no-daemon has no handover)",
    stage(n, show) {
      // The session's terminals as they are, drawn the way a service tile is.
      const list = serviceKind({
        kind: "showcase.session", about: "the terminals attached to this session",
        render: async req => {
          const s = servingSession();
          const rows = !s ? [`${fg(C.yellow)}this door runs in its own terminal (--no-daemon): quitting it ends it${RESET}`, `${fg(C.grey)}ep0ch (without --no-daemon) runs it as a session${RESET}`]
            : [`${fg(C.lcyan)}session ${process.pid}${RESET} ${fg(C.dark)}drawn at ${s.info.cols}×${s.info.rows}${RESET}`,
              ...s.list().map(c => `  ${c.active ? fg(C.white) : fg(C.grey)}#${c.id} ${c.tty ?? `pid ${c.pid}`} ${c.cols}×${c.rows} ${c.video}${c.active ? " · has the keys" : ""}${c.watch ? " · watching" : ""}${RESET}`)];
          return { title: "session", lines: rows };
        },
      }).make({ kind: "showcase.session" });
      const r = new ReaderPane();
      return deskOf({ title: "showcase · session", panes: [r, list], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.notebook]], d => {
        // The person's own keys would do these: a comment half written on a line, floating, for a handover to keep (PIE-847).
        void d.press(r, NOTE_ACTIONS, "passage.select", { quote: SESSION_QUOTE })
          .then(() => d.press(r, NOTE_ACTIONS, "comment.write", { body: "Fill it from the tap by the gate" }))
          .then(() => d.press(r, NOTE_ACTIONS, "comment.place", { place: "floating" }));
      });
    },
  },
  {
    key: "callouts", need: "draw, fold, complete or change a callout, with embeds and buttons inside", part: "one list of callout types (outline-core's built-ins plus the outline's [callout-type::] notes, callouts.types) behind the reader's frames (nested, each a fold point), the completer after > [! and the type choice (the step choice's ListPicker); callout.type and callout.start write through the note's save", files: "outline-core/src/callouts.ts, src/callouts.ts, src/doc.ts, src/surface/note.ts, src/surface/completer.ts",
    aside: "The right note's callout embeds Seed spacing and its Cycle theme button works by click, Enter or button.press · Obsidian's own examples, nested three deep, folded with - and open with + · ( ) then f, or a click on a title, folds one; z opens them all · ⏎ or a click on an icon opens the type choice (- and + there make it start folded or open) · e, then > [! offers the types with their icons · the right reader declares a type of this outline's own · every callout, quote and code block has a dim ⧉ at its top right edge: a click, y with [ ] on it, or `act block.copy n=…` copies its text as written, without the frame, bars or > markers, and says \"copied N lines\" (an agent's copy is returned, never put on your clipboard); a click on an inline `code span` copies its contents, backticks left out · Y (nothing selected), the tile menu's \"copy note\" or `act note.copy` copies the whole note's source, \"copied the note, N lines\" · a drag across them copies the words only (`act blocks` lists them)",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · callouts", panes: [a, b], layout: ([x, y]) => row(0.62, x!, y!) }, show, [[a, n.callouts], [b, n.calloutType]]);
    },
  },
  {
    key: "list-folds", need: "preview a list item without moving its siblings", part: "foldPoints, embedRegion and the attached surface", files: "src/doc.ts, src/embeds.ts, src/surface/attached.ts, src/surface/note.ts",
    aside: "Five fictional garden calls. A click or j/k selects and previews children; Enter or a second click unfolds in place. The p fold chip or reader menu switches this list's preview. Click the preview's placement chip to move it, its text to edit.",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · callout list folds", panes: [r] }, show, [[r, n.listFolds]]);
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
    key: "hero", need: "tune a hero picture, its fade, title and scrolling", part: "the header's backdrop (PIE-598, src/surface/hero-header.ts): NoteSurface finds the hero (the header image, a [layout::hero] image, or an image that is the note's first block) and how far it has gone under its sticky header; the media pipeline makes the muted, dimmed variant (src/media.ts Look mute, a PNG under Kitty graphics, one colour per cell otherwise); reader.hero turns it off, kept like the theme", files: "src/surface/hero-header.ts, src/media.ts, src/doc.ts (coverCrop), src/surface/note.ts, src/screens.ts (reader.hero)",
    aside: "alt+y tunes header.image.blur, bleed, height, fit, dim, tint, fade, scroll and header.title at every level; the hero line wins. This demo uses blur=4, full bleed, height=33%, cover, dim=0.4, tint=0.5, fade=0.75, title=over and scroll=pinned. In cells, j, the wheel or space scrolls the picture up under the header: the header takes it, dimmed, by steps · [hero-focus::x,y] on the picture's line says what the crop keeps · `act reader.hero on=false` turns it off everywhere, `mode=follow` makes the header follow each picture down the note (kept for the next start) · Kitty draws the picture under the text; cells colour each cell from it · the river column on the right keeps the same header above its scroll",
    stage(n, show) {
      // A reader and a river column on the same note: the column keeps the reader's header above its scroll too.
      const r = new ReaderPane(), col = new RiverColumn({ kind: "block", id: n.hero?.id ?? "" });
      return deskOf({ title: "showcase · hero header", panes: [r, col], layout: ([a, b]) => row(0.6, a!, b!) }, show, [[r, n.hero]], d => { if (n.hero) col.hold(n.hero, d); });
    },
  },
  {
    key: "artifacts", need: "open a live artifact folder or a frozen snapshot without pasting source into notes", part: "the media line and NoteSurface artifact card; artifact.open asks artifacts.show for the artifact's page in the web client (never the artifact host's address, PIE-1266); put and the watcher reuse publish-artifacts.ts", files: "outline-core/src/artifacts.ts, src/artifacts.ts, src/doc.ts, src/surface/note.ts, outliner/src/artifact-store.ts, outliner/src/artifact-server.ts, outliner/src/publish-media.ts",
    aside: "[ ] to a card, then ⏎, or a click on it or its [open ↗]: it opens running in the browser, on the note's web page · [share] (artifact.share) gives someone outside a link to that artifact alone, copied for you, and ends with share.revoke · over ssh or on a headless host, your laptop link opens it on your own machine; without a link it is copied and the flash is clickable · an agent: images lists them (kind artifact), artifact.open n=1 gives the address · + - and ← → size and place it as an image's (its frame on the web page) · no script runs in the terminal",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · artifacts", panes: [r], layout: ([a]) => leaf(a!) }, show, [[r, n.artifacts]]);
    },
  },
  {
    key: "title", need: "make a note's title the first thing the eye finds when it is open", part: "the reader's header (PIE-657, NoteSurface.headerBlock, one builder for every reader): the crumbs as a dim eyebrow, the title bold in the theme's heading colour, a Work ID first in the accent (PIE-809: HOME-042 · <title>; the theme caps white near the body's grey, so a white title read as body) (a step down in the tile without the keys; normal cell width in every video mode), one dim line under it for the byline, the property count and the summary values (links), one blank row; the tile's top border carries only its short Work ID and tile facts (PIE-917, Desk.header)", files: "src/surface/note.ts, src/desk/desk.ts",
    aside: "the left reader has the keys, the right one doesn't: compare the titles · a click on a value in the dim line still opens what it names · `peek` and `layout.get` keep the content title as `label` and the frame text as `title` (the reader's note is `showing`), and the reader's rows start with the breadcrumb, then the title · the header owns the full title; the border keeps only the Work ID and tile facts · titles stay normal-width bold in Kitty, CRT and cells · the narrow reader beside holds links that wrap: each keeps its colour and its click on every row · a copy over the title copies its text; a selection on it draws in cells",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · a title you can find", panes: [a, b], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.title], [b, n.title]]);
    },
  },
  {
    key: "figures", need: "draw a decision, a chat, a keymap, days (uptime, activity, a month) or annotated code in a note; write a figure's rows in Markdown", part: "the figure kinds (src/graphs.ts KINDS, the newer ones in src/figures/), their rows from Markdown or a figure block's child bullets read by outline-core's figure grammar (figure-markdown.ts), drawn by the reader's NoteSurface; a quote callout's byline (quoteByline); ep0ch export writes each figure as its ASCII twin (figureAscii)", files: "outline-core/src/figure-markdown.ts, src/figures/, src/graphs.ts, src/live.ts, src/export.ts, outline-core/src/callouts.ts",
    aside: "activity: click a day or use [ ] and ⏎ to open its notes below the reader; element.open does the same for agents · every figure in the left reader is written as Markdown rows; the live ones read the plot's decision notes and the backup runs scripts/backup-runs.ts writes · the figure block after the activity charts is a note whose rows are its child bullets: [ ] steps to them, ⏎ or a click opens one · the right reader's first sheet is read from the action registry, so it says what the reader's keys do now · ep0ch export writes each figure as plain ASCII in a fence",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · figures", panes: [a, b], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[a, n.markdownFigures], [b, n.keys]]);
    },
  },
  {
    key: "focus", need: "see which tile, figure or table has the keys and which row inside it the cursor is on, in every theme", part: "the two focus levels (PIE-969): container focus, the tile's frame and the ruler's tint over the figure or block the cursor is in (theme.focus.container, theme.edge.focus); item focus, the row the cursor is on (theme.focus.item: a band and a left-edge bar, one style, style.ts selectedRow() for every list tile and NoteSurface's figure rows and panels), dark and 4.5:1 or better under every text colour (test/theme-focus.test.ts)", files: "src/theme.ts (focus), src/style.ts (selectedRow, itemStyle), src/surface/selection.ts (ITEM_BG), src/surface/note.ts (ITEM_KINDS)",
    aside: "the left reader has the keys: press ⏎ to go in, [ ] to walk the rows of the figures: the figure keeps its amber tint (it has the cursor) and the row under the cursor is a blue band with a bar at its left edge · the right reader doesn't have the keys · `act theme.set name=calm|night|classic` redraws both in each theme · classic uses readable grey text on the selected band, including formerly dim metadata and blue text; calm and night keep their row colours · click the outline tile on the right and press j/k: its selected row has the same band and ▌ marker; click back to the figures to see the outline's idle band (PIE-999)",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true);
      a.holdOn(); b.holdOn();
      return deskOf({ title: "showcase · focus levels", panes: [a, b, new TreePane()], names: ["figures", "reader", "outline"], layout: ([x, y, z]) => pair("row", 0.7, row(0.6, x!, y!), leaf(z!)) }, show, [[a, n.markdownFigures], [b, n.keys]]);
    },
  },
  {
    key: "move-note", need: "move a note under another, or up, down, in or out among its siblings", part: "note.move (PIE-943, src/note-move.ts) and tree.move (src/desk/tree.ts): the one step over the service's move (outliner moveBlock, the rule outline_move runs, for the person and an agent alike), the read revision checked atomically with destination resolution, recorded as who asks, put back by ctrl+z (MOVE_UNDO); Z in a reader (the tile menu's \"move to…\", act) asks in the power bar's ask scope (askInBar over the outline's one search): the note's parents and the notes changed lately first, the Inbox, any note by its words; in the outline tree alt+↑ alt+↓ (or K J) reorder, I indents under the note above, O outdents after the parent, a drag onto a row moves it under that row (onto its mark at the left: above or below it); a river column and a reader move their note by alt+↑ alt+↓ or K J and Z too; the reply panel and BBS message lists take K J, I O and Z on their selected row; an agent's goes by outline_move's rules (the outliner's moveBlock) and never takes the person's selection", files: "src/note-move.ts, src/desk/tree.ts (moveRow, TREE_ACTIONS tree.move), src/river/column.ts (column.move), src/surface/note.ts (note.move, note.move.undo), src/bar/ask.ts (parentsOf), outliner src/note-move.ts (atomic move), src/agent-tools.ts (moveBlock adapter)",
    aside: "the outline on the left has Moving notes open: click Cold frame, then alt+↓ or J (it goes down a place), I (in under the note above), O (out again), ctrl+z (put back) · drag Seed trays onto Greenhouse (under it), or onto a row's ▸ mark (beside it) · in the reader, Z asks where to move the note shown",
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true);
      return deskOf({ title: "showcase · move a note", panes: [tree, r], names: ["tree", "reader"], layout: ([a, b]) => pair("row", 0.45, leaf(a!), leaf(b!)) }, show, [[r, n.moving]], dsk => { if (n.moving) void tree.showOpen(n.moving, dsk); });
    },
  },
  {
    key: "routing", need: "let notes file themselves: a captured recipe lands in Recipes, a note moved to where its rule says, by hand or on its own", part: "routing rules as notes (PIE-1010, the outliner's src/note-routing.ts, a core extension of the service): a rule is a note [type::route] [query::…] [route-to::((id))], optional [route-when::create|edit|command] (default create), [route-order::N] and [route-at::top|end]; first match wins (route-order, then the Routing view's hand order, then when written); the match is the service's one query matcher (query.matches, the views' grammar: no property hard-coded), the move the service's one atomic move (note-move.ts, the rule outline_move runs), as author agent ext:route with who asked as requestedBy, one revision, a history line under the rule; notes.create asks routing first (the first placement rule, src/note-placement.ts), the change feed routes a bare note and a new note's first words once quiet, and a note a door holds a draft of waits for the draft to close; the Routing view (a saved view over type=route, seeded once) lists every rule; the door's note.route (alt+z in a reader, alt+Z a dry run, the tile menu's row, act) and ep0ch route [<note>|--all] [--dry-run] ask the service's notes.route and say what moved where and why", files: "outliner src/note-routing.ts, src/note-placement.ts, src/note-move.ts, src/route-cli.ts; door src/note-move.ts (routeNote), src/surface/note.ts (note.route), src/main.ts (ep0ch route)",
    aside: "the reader on the right shows Pickled walnuts, a recipe under this note: alt+z routes it to the Recipe shelf (the first rule, by command only), the status bar says which rule moved it, ctrl+z puts it back; alt+Z says what would move without moving · its ⋯ menu has \"route by rules\" · ctrl+n in the left reader, type Nasturtium [type::seed], ctrl+s, esc: once quiet it's in the Seed tin on its own · `act note.route dry=true` · the outline's Routing view lists both rules",
    stage(n, show) {
      const guide = new ReaderPane(true), r = new ReaderPane(true);
      return deskOf({ title: "showcase · notes that file themselves", panes: [guide, r], names: ["guide", "reader"], layout: ([a, b]) => pair("row", 0.5, leaf(a!), leaf(b!)) }, show, [[guide, n.routing], [r, n.pickled]]);
    },
  },
  {
    key: "newnotes", need: "make a new note or page from anywhere", part: "note.new (ctrl+n on every screen, in an edit too, + on the menu, act) asks the service's notes.create, whose placement rule puts it (under the note in the reader you're in, else the top of the Inbox), then opens it where the screen spec's newNote says (PIE-591): a float over the screen by default, by the layout engine's own float (as many as you like, cascaded; its title drags it, onto a header or the edge docks it; × or esc on it still empty trashes it), a tab, your drawer, or the board's lanes' card.new; a missing [[page]] is offered, then made by page.create (pages.follow, the same rule); a lone [page::x] titles itself (outline-core's page-title rule, on ⏎ and on every save)", files: "src/new-note.ts, src/desk/desk.ts (editNew, openNoteTile, floatDock), src/desk/screen-spec.ts (newNote), outline-core/src/page-title.ts, outliner src/note-placement.ts, src/surface/note.ts",
    aside: "go in (⏎), then ctrl+n, ctrl+n, ctrl+n: a floating note each, under this one, the newest with your keys · type, ctrl+n again: what you typed is saved, the next floats · drag a float's title onto this reader's header: it docks as a tab, while you write in it too, and its controls chip opens its hint card · its → row says where it lands, a click moves it (note.move) · the close row or esc on an empty one puts it in the trash · ] to [[Seed swap ledger]], ⏎ offers it, ⏎ again makes it in the Inbox · type [page::2026-03-12] and ⏎ on the first line of a new note",
    stage(n, show) {
      const a = new ReaderPane();
      return deskOf({ title: "showcase · new notes", panes: [a] }, show, [[a, n.newNotes]]);
    },
  },
  {
    key: "menu", need: "show a tile's actions as a menu (its ⋯, a right-click in it)", part: "the tile menu: tile.menu lists the rows each action declares (ActionDef.menu) in the sets the dispatcher would run there (Dispatcher.menu): the tile operations, its kind's, a reader's note actions, a board lane's; a ListPicker on the desk's overlays, each row its label and its key as a keycap, one click, ⏎ or that key runs it as you", files: "src/desk/tile-menu.ts, src/surface/dispatch.ts, src/surface/actions.ts, src/desk/tile-actions.ts",
    aside: "click a tile's controls chip, right-click anywhere in it, or press ^W . to open the searchable menu, grouped Tile, then its kind's (Note, Reader, Terminal), each row with its key · type to filter it (the power bar's matcher: the query on its top row, the letters that match lit, empty groups gone; backspace widens, esc clears the query, then closes; ⏎ runs the top row) · a dimmed row says why it can't run now (its foot) · the terminal's program asked for the mouse, so a right-click there is its own: its controls chip still opens the menu; hold ctrl or press ? over its frame for the controls card · `act tile.menu tile=reader` answers the same rows to an agent and draws nothing",
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
    aside: "go in (⏎): the keys are on the shed note, folded to a spine, on a locked screen · press x: the spine has no edge to say it on, so the hint row under it says why, in amber (the status bar too) · Tab to the notebook and press ^W x: the screen is locked, and the reader's own bottom edge says so · ^W x again: it stays up, bold on a dim amber band, the frame amber, until you press a different key · a click on the dimmed close row of its ⋯ card says why the same way · on a desk holding only a group, q leaves the screen as on any desk (it used to be refused, on the status bar alone)",
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
    aside: "the Spacing lab page uses the lab style ([style::lab]) the Looks lab note declares ([style-for::lab]): e there, change [style.list.gap::1] to 2, ctrl+s, and the page restyles in every door · the tune inspector under it lists each value and its source (built-in, global, the tile's kind, the screen, the page, a box): j k pick, + − or the wheel over a value nudge it (a row is about two columns, so pad moves 1 row and 2 columns), v the level it saves to, w for this width only (the breakpoint it's in now), s save, u and U undo and redo every nudge and save of the session (each said on the status line), x (or a row's ×) resets one value to what it inherits (a width variant first), X resets the level picked and R reverts every style note the session wrote (both asked in place: the key again, or [confirm]); with a level or a width picked, each row shows what that level says itself, and a row something nearer wins is marked ⊘: a nudge there offers a (anyway), o (nudge what wins) or c (clear it); levels go down to this tile (v to this tile, kept in the tile's spec) and this list (saved on its first item, over heading and lead-in defaults, as Hardy ones does: ( ) onto its heading, v to this list); a surface's row shows a swatch of it, and + − on header.image steps through the note's pictures · the lab tile sits on a raised surface with a violet bar; its first box has a green stripe and bar, its second a sunken surface in a round amber frame with ✦ dividers; the whole header shares one band with a bottom rule (header.rule and header.rule.tone); an empty header.image says when the note has no hero · scroll the beds picture under the header and the header takes it, cropped 15% higher · quitting with nudges unsaved says so · spacing is drawn, never text: a drag copies the note's words, wrapped lines joined, with no margin, gap or divider in them (a terminal's own shift-drag copies the screen's spaces) · Detail and the publisher read the same tokens next (the publisher as CSS); ep0ch export leaves the look out",
    stage(n, show) {
      const lab = detailPane(), tune = new TunePane("lab"), links = new BacklinksPane("lab", true), looks = detailPane();
      return deskOf({ title: "showcase · style", panes: [lab, tune, links, looks], names: ["lab", "tune", "links", "looks"], layout: ([a, b, c, e]) => pair("row", 0.55, leaf(a!), pair("col", 0.55, leaf(b!), row(0.5, c!, e!))) }, show, [], d => { if (n.spacingLab) lab.hold(n.spacingLab, d); if (n.looksLab) looks.hold(n.looksLab, d); });
    },
  },
  {
    key: "style-one-list", need: "style one list of several", part: "NoteSurface, the tune inspector, the shared list cascade and an authored button running the inspector actions", files: "outline-core/src/style-cascade.ts, src/surface/note.ts, src/desk/tune.ts, src/showcase/seed/looks.ts",
    aside: "Press Style the middle list: its script picks this list, sets gap, divider and zebra through tune, then saves. The first and last lists stay tight. Select any list to inspect its values; reopen the note to see the saved look. The first item's properties own just that list; a heading or lead-in still supplies defaults.",
    stage(n, show) {
      const lists = detailPane(), tune = new TunePane("lists");
      return deskOf({ title: "showcase · style one list of several", panes: [lists, tune], names: ["lists", "tune"], layout: ([a, b]) => row(0.55, a!, b!) }, show, [[lists, n.singleList]]);
    },
  },
  {
    key: "library", need: "say what a component's properties are once: its docs page and completion for its keys and values", part: "component schemas (PIE-618, PIE-701): outline-core's component-schema.ts says each component's properties once (heading styles, callouts, rules, every ::graph-* figure, ::links and its kin, ::box, pictures and header images, embeds, code fences, tables: a test fails when a component the readers draw has none; an extension's in extension.json), the service merges the outline's own values in (components.schemas); the library screen draws a page per schema (an overview and its table, each value with its source, the grids, every combination behind a filter, at 40, 80 or 160 columns) through the readers' renderer, and the completer offers [key:: and its values from the same answer", files: "outline-core/src/component-schema.ts, outline-core/src/component-schemas-figures.ts, outline-core/src/component-schemas-blocks.ts, src/library/library.ts, src/library/draw.ts, src/component-schemas.ts, src/surface/completer.ts, src/library/cli.ts",
    aside: "In the reader beside the library, edit (e, Enter), write [status::ready] [owner::Ada], then on a new source line type ::fie. Fields shows its purpose, a source line, its drawing and props. Right opens variations from this note's keys; choose with arrows, then y (or click [copy]) copies the source line, dragging copies drawn words. Shift+down scrolls the card. Type @ to see where an agent is defined: a script note and its fence ([g] opens it beside the draft), a file script and its code, or an extension folder and handler. Enter inserts one. Type ::fields{key=\" to choose a property, this note's first; Esc keeps the text. In the YAML form, key: offers the same draft keys, or the note named by of:. The library on this outline: after ## Calls, trailing :: lists the same styles as an open [heading::, including the plot style its note declares · , . the component, 1-4 the part, ← → the property or grid, [ ] ← → space to pick in every combination (x clears, n p page), j k a variation, y or copy copies its whole source; drag over source, drawing or properties to select and copy text, double click a word, triple click a line (the reader's selection, PIE-1025); library.select text= answers an agent without touching your clipboard; w its width; every one a click too · e in a reader, then [head or [heading-pattern:: completes from the same schema · ep0ch library --out <dir> writes the pages as Markdown for the publisher",
    stage(n, show) {
      const reader = new ReaderPane();
      return deskOf({ title: "showcase · library", panes: [new LibraryPane(), reader], layout: ([a, b]) => row(0.6, a!, b!) }, show, [[reader, n.whiteboard]]);
    },
  },
  {
    key: "bar", need: "find anything from anywhere: a tile on any screen, a note, an action, what changed, a screen, an extension's rows", part: "the power bar (PIE-656, src/bar/): one palette over every screen and the drawer (ctrl+k, cmd+k, the status bar's ^K; the desk's / and the river's g in its notes scope), a list picker with its line, scopes along the top (% tiles, / notes, > actions, + recent, @ screens, & extensions, an extension's own prefix; alt+← alt+→ cycle; tab fills the line with the lit row's words), the lit row read on the right by the readers' renderers; its rows are sources' (registerBarSource): the layout tree's tiles (Desk.tileOutline), the service's one search, the dispatcher's actions (the focused tile's menu, then every action; one that takes arguments opens its form, PIE-1031: a field per argument with its values from its ArgSpec's kind and choices, src/bar/arg-kinds.ts, and the act line under them, through askInBar), the what-changed store, screen.list, and an extension's bar[] through extensions.bar; a pick is bar.pick, through the drawer's goTo (a spine opened, its screen brought up), open, the dispatcher's press or extensions.act", files: "src/bar/bar.ts, src/bar/source.ts, src/bar/sources.ts, src/bar/actions.ts, src/bar/form.ts, src/bar/arg-kinds.ts, src/bar/ask.ts, src/extensions.ts (bar sources), src/app.ts, outliner src/extension-calls.ts (extensions.bar)",
    aside: "Try tile.colapse tile=reader on=true direction=h: the row marks both corrections; enter runs the corrected command and keeps its answer here. Tab or right at the end completes argument names and values from the form pickers. Alt+o copies ep0ch act, Alt+y copies a note button, Alt+i inserts it into your note as one unsaved draft step; Alt+m or right-click a command/run opens its copy menu. Up on an empty line recalls the last run. Wheel over the docs or Alt+j/k scrolls; drag selects and copies; Alt+v gives docs the keys (arrows, page up/down, y copy, enter on an example, esc back to the line). Click an example to edit it on the line. ctrl+k (or a click on ^K at the status bar's left), anywhere: with nothing typed, this screen's tiles, indented as its layout tree (● has the keys, ▸ a spine, ⧉ a float, ⇤ docked), then what others changed · type to look through everything at once, or start with % / > + @ (alt+← alt+→ cycle) for one source, and press tab to extend the matching rows' common prefix, then advance a word per press; the fill is selected, so typing replaces it and backspace removes it. Drag or double-click the line, or shift+arrows, to select; ctrl+x cuts, ctrl+z undoes, paste replaces the selection, alt+backspace or ctrl+w deletes a word and ctrl+u clears (the shared Draft editor) · type >so then backspace four times: actions stays scoped; alt+left changes scope explicitly (PIE-1101) · ⏎ or a double click goes: a tile gets the keys (the folded detail here opens from its spine; one on a screen under this one brings it up), a note opens where opens land, an action runs; type >layout.move and press ⏎: its form, a field per argument (tile, to, where...) with what each means, the act line under them; type shed and ⏎ (the tile field lists this screen's tiles), reader and ⏎, tabs and ⏎ (where= lists its choices), then click the act line and ⏎: the shed is a tab beside the reader. alt+⏎ answers and runs at once, shift+tab goes back a field, an example row fills the form; paste an action line with its arguments (tile.open kind=query query=\"#seeds\", quoted as a shell quotes) and it's the first row in any scope, ⏎ runs it as typed; try > agents.yolo on=true to hand the scratch door to agents, then > agents.yolo on=false to take it back (repeating either keeps that state); alt+⏎ zooms a tile or opens a note in a new detail · esc clears the line keeping its scope; esc again closes · with the outliner's glyphs example installed, ~shade lists its rows, and on a note it offers to rule it · every scope finds a note by what names it: its title, its work id (PLOT-4) and its page name, and its rows read the way /notes does, `PLOT-4 Order the seed potatoes` · / with nothing typed lists the notes changed most recently first (the service's recency and what others changed, agents included), so / then ⏎ opens the latest; type and it runs the one search · `act bar.open query=… scope=…` answers the rows to an agent and opens nothing; `act bar.pick n=… query=…` picks as the agent, never your keys",
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
  {
    key: "facets", need: "see the properties the notes have with how often each value is used and when it was last used, and narrow notes by including or excluding values", part: "the facets tile (PIE-881): a tile kind (`facets`, ^W o f; `tags` is the same opened on the tags facet, ^W o #) that asks the service (`blocks.query` with the selection as `where` and `facets=true`, which counts every match and says each value's last update), so the door never counts or narrows: every property is a facet and a tag is one of them; a value is included (+) or excluded (−), ORed within a facet and ANDed across facets; a path value (`plot=x/y/z`, a nested tag) is a tree, and picking x includes x/…; the selection is the views' query text (e edits it, facets.query sets it) and v saves it as a view; sorted by uses, name or last use; the first row always counts matches out of all notes; matching notes keep their own resizable share below the keys and open as every list's do (PIE-1220); whole-key picks write key or NOT key, with values still narrowing them", files: "src/desk/facets.ts, src/socket.ts (facetList), outline-core src/property-grammar.ts (path values), protocol.ts (QuestionFacet), outliner src/question-answer.ts",
    aside: "matches stay visible below the keys: drag the Matches divider, click less/more or press [ ] to resize their share · a key row has [+] to require any value and [-] to require its absence; + and - on the key do the same, and 0 drops it · the tags facet is open: ⏎ or a click on #frost-jobs includes it (+), again excludes it (−), again drops it · the query line shows the selection in the views' grammar (`#frost-jobs NOT #compost`): e types one, v saves it as a view on the board hub · ⏎ on a facet (▸) opens its values; path values group as a tree · s or a click on a header word sorts by uses, name or last use · z lists what the selection leaves at 0, dimmed · x clears · ⏎ on a note opens it in the reader beside · the tile is the service's answer: write a #tag or [key::value] in any note and the counts move · agents: facets.set key=tag value=compost mode=exclude, facets.query text=…, facets.save, facets.list",
    stage(n, show) {
      const t = new FacetsPane("tags"), r = new ReaderPane();
      return deskOf({ title: "showcase · tags", panes: [t, r], names: ["tags", "reader"], layout: ([x, y]) => row(0.45, x!, y!) }, show, [[r, n.notebook]], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "rich-edit", need: "edit component fields where they are drawn, using the same draft as raw edit",
    part: "ElementEditor source spans and drawing over DraftSession; Markdown tables and static graph-table rows, one history and one cursor, including streamed draft patches",
    files: "src/surface/element-editor.ts, src/surface/note.ts, outline-core/src/table-shape.ts",
    aside: "open the tile menu's rich edit, or edit then ctrl+o · click a cell or Tab/Shift+Tab and ↑↓ between cells · type, select and delete with the draft's editor · alt+r adds a row, alt+d removes it, alt+v adds a column, alt+x removes it; the buttons do the same · ctrl+z undoes, ctrl+s saves · ctrl+o or [raw] returns to source on the same draft",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · rich edit", panes: [r] }, show, [[r, n.richEdit]]);
    },
  },
  {
    key: "asks", need: "keep typing while an agent's answer arrives", part: "draft.patch, folds and the comment tile's dock pair", files: "src/edit.ts, src/desk/answer-tile.ts, outliner/src/agent-requests.ts",
    aside: "ctrl+n starts an unsaved note · bare @tidy fixes nesting and spacing above; @tidy wrap each item in a callout rewrites the passage as asked, lit as ext:tidy and undone with ctrl+z · each ask says what changed or why it could not run; an answer tile shows that result too · type a title, then @ask whats up: its inline warning names the agents here · @prior-art finds earlier related notes from this ask and the note without a reference · e edits the note · write @planter show the seed counts on a new line and keep typing below it · the answer opens beside without taking the keys · open its fold to edit the source · ctrl+s saves both your words and the answer",
    stage(n, show) {
      const r = new ReaderPane();
      return deskOf({ title: "showcase · asks", panes: [r], names: ["notes"] }, show, [[r, n.asks]]);
    },
  },
  {
    key: "neat", need: "install a script extension and arrange two notes", part: "script runtime, layout actions and drawer links", files: "outliner/extensions/neat/scripts/neat.js",
    aside: "The showcase installs neat. In the power bar, &neat removes or reinstalls it; its button names the reinstall command while absent. Press neat: two readers side by side, the other tiles as spines, and links in the drawer wired select/open to the right and alt to the left. Use page= twice to choose your own notes; without slots it uses this outline's welcome and the reader with your keys.",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true), c = new ReaderPane(true);
      return deskOf({ title: "showcase · neat", panes: [a, b, c], names: ["notes", "source", "extra"], layout: ([x, y, z]) => pair("col", 0.5, row(0.5, x!, y!), leaf(z!)) }, show, [[a, n.neat], [b, n.shed], [c, n.heap]]);
    },
  },
  {
    key: "wyrm", need: "play a door game whose state is notes", part: "script runtime, file render scripts, view presses and demo notes", files: "outliner/extensions/wyrm/scripts/ (wyrm.js, wyrm-sheet.js, wyrm-town.js), outliner/extensions/wyrm/demo/",
    aside: "Legend of the Ep0ch Wyrm, installed with its demo. Press join the realm on the town board for a player, open it and press forest, hit it, healer, inn or fields · every stat is a chip on the player's first line, so ctrl+z takes a move back · Dozing Gerald sleeps in the fields: his row on your sheet ambushes him · today's Daily News draws on the town · the two screens are file render scripts the extension ships (wyrm-sheet, wyrm-town: `// ep0ch-script mode=render`), so an update brings new ones; a note of your own with the same [script::] name and [mode::render] wins and is yours to edit",
    stage(n, show) {
      const a = new ReaderPane(true), b = new ReaderPane(true);
      return deskOf({ title: "showcase · wyrm", panes: [a, b], names: ["town", "player"] }, show, [[a, n.wyrm], [b, n.wyrmSleeper]]);
    },
  },
  {
    key: "scripts", need: "bind scripts to keys, names, rules and asks without waiting", part: "the dispatcher, action lines, QuickJS and run undo", files: "outliner/src/script-runs.ts, src/extensions.ts",
    aside: "alt+S runs seed-report · ^K or / then seed-report runs by name · slots are name=value · @seed-count runs in a note; rule-on::script:seed-count uses the same trigger path · alt+Q or click ⇧⌥Q starts recording · open a query tile with ^K tile.open kind=query query=\"#beans\" · alt+Q or REC stop saves a [script::] note · edit #beans to #{tag}; Run recording from ^K asks for tag · agent actions stay out · Run seed-report streams results below its source; ext.undo takes back its writes together",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · scripts", panes: [a, b], names: ["notes", "source"], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.scriptTarget], [b, n.scripts]]);
    },
  },
  {
    key: "button-sequences", need: "one press runs acts and scripts in order, with one undo group", part: "outline-core button-call and component bodies, actionScript, ScriptRuns, dispatcher transactions and Sources", files: "outline-core/src/button-call.ts, outliner/src/script-runs.ts, src/surface/note.ts",
    aside: "One button, two tiles: click Fold the bottom, then ctrl+z to unfold both · Sugar is the same ordered steps · Pipe shows three scripts with an act as tap · Refused stops before folding links · Nothing makes an undefined return visible · S opens Sources: each step carries its input, output, answer and remaining effects · one action per line; ((name)) runs a script",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane(), c = new ReaderPane();
      return deskOf({ title: "showcase · button sequences", panes: [a, b, c], names: ["notes", "links", "preview"],
        layout: ([x, y, z]) => pair("row", 0.6, leaf(x!), pair("col", 0.5, leaf(y!), leaf(z!))) }, show,
        [[a, n.buttonSequences], [b, n.scripts], [c, n.scriptsInPlace]]);
    },
  },
  {
    key: "scripts-in-place", need: "a script that knows its note and draws where it is written, live", part: "the Site's script globals (this, self, caller, props), render mode through ExtensionCalls' one producer path, and `::=` lines", files: "outliner/src/script-runs.ts, src/extension-calls.ts, src/script-runtime.ts",
    aside: "A cold ep0ch show of this note draws the handler output too; --source keeps the authored lines · The Published script lines link demonstrates a visible-only seed count on its public page, embedded and through ::use · beds-table:: week=42 draws the Beds table script's view under its line, and the ::= line draws a one-line script · both read this note's owner: edit [owner::Sam] (e, save) and they redraw · nothing is written for a drawing: no run note, the note's text stays yours · the script is [mode::render] and can't declare [effects::write] · Run seed-report from the other section runs with this note in front as `this` · scripts.stop run=<id> ends one run",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · scripts in place", panes: [a, b], names: ["notes", "source"], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.scriptsInPlace], [b, n.scripts]]);
    },
  },
  {
    key: "press", need: "press a square a script's view draws: a click or ⏎ runs the action it carries, as you", part: "a view primitive's `action` (the service's ViewAction), drawn as a control of the handler line (extensionRegion's press), run through EXT_ACTIONS as the person; edit and rich edit keep the line's last drawing under it", files: "outliner/src/component-primitives.ts, src/components.ts, src/projection.ts, src/edit.ts",
    aside: "Click a number (it runs at once, as you), or [ ] to it and ⏎ · the New game button and the prose link [start over](act: ttt-reset) are the same press · act: ext.<id>.run block=<the note> at=5 (ext ls names the script's id), element.open n=<its element> from another reader · a script you press may move your tiles: its layout changes are one transaction, ext.undo takes them back with its writes, ctrl+z undoes the layout (layout.undo) · e (then ⏎) to edit: the drawn board stays under its ttt-board:: line, read-only · the board is a [board::] property on the note, so the move is a revision you can ctrl+z",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · pressable views", panes: [a, b], names: ["notes", "source"], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.press], [b, n.scripts]]);
    },
  },
  {
    key: "status-bar", need: "keep a note's button on your status bar", part: "App's declared status items, StatusBarNote, outline-core button-call and button.press", files: "src/app.ts, src/status-bar.ts, src/surface/note.ts",
    aside: 'Right-click or alt+click an empty part of the bar, or ^K status bar: edit. The note orders built-ins with - <id> lines; leave one out to hide it. Append ::button{label="Collapse" act="tile.collapse tile=screen"}; alt= names an alternate action. A note button offers pin to status bar in its tile menu. status.bar.items describes the same actions the mouse presses. Missing or broken config keeps the default bar; malformed lines stay saved and are said in the message log.',
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · status bar", panes: [a, b], names: ["notes", "extra"] }, show, [[a, n.statusBar], [b, n.shed]]);
    },
  },
  {
    key: "message-log", need: "read a message after its status flash has gone", part: "App.flash appends to the session's StatusLog; the BBS list actions and RowView show every wrapped line, LineInput and the shared search matcher search it", files: "src/status-log.ts, src/app.ts, src/screens.ts",
    aside: "Click the status line or press alt+M from any screen. / searches whole messages, actions and tiles; r refreshes the rows; enter goes to the note or tile, PgUp/PgDn or the wheel reads a long message, q comes back. ep0ch log prints the session file; --follow tails it; peek includes the last 500 messages. Error stacks stay in the file.",
    stage(_n, show) {
      const list = new StatusMessages();
      show(ctx => { ctx.flash("The garden gate needs attention; this message stays in the log after its flash ends."); list.enter(ctx); list.reload(); });
      return list;
    },
  },
  {
    key: "motion", need: "see a layout change as movement: tiles glide from where they were to where they are, and a button can ask for more", part: "the desk's transition (src/motion.ts, Desk.startMotion, the tick and the ghosts drawn in render) driven by the layout history's changes (src/desk/layout-history.ts); the person's setting (motion.set, EP0CH_MOTION) caps every actor's hint", files: "src/motion.ts, src/desk/desk.ts, src/desk/layout-history.ts, src/screens.ts",
    aside: "click ✦ Shuffle the tiles (or ⏎ on it): the two tiles beside float out, wander and settle back, a script's motion=fantasia · motion.set mode=calm glides briefly, mode=off snaps · any key or a click snaps what is moving · ctrl+z puts the run's layout back · peek and snapshots read the settled layout, never the frames in flight · movement only: no fade, no flash",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane(), c = new ReaderPane();
      return deskOf({ title: "showcase · motion", panes: [a, b, c], names: ["notes", "source", "extra"], layout: ([x, y, z]) => pair("row", 0.4, leaf(x!), row(0.5, y!, z!)) }, show, [[a, n.motion], [b, n.scripts], [c, n.shed]]);
    },
  },
  {
    key: "fantasia", need: "press one button and watch the screen dance, then settle: the whole self-reference wave in one click", part: "a `::button` (outline-core button-call.ts) runs the fantasia script as you with a one-run invitation; the script's `act()` calls are one layout transaction (txn=<run id>, motion=fantasia) that the desk draws as movement, closes when scripts.ended says the run did, puts back if it stops early, and layout.undo / ext.undo take back in one step", files: "src/surface/note.ts (runPress), src/surface/invite.ts, src/surface/txn.ts, src/desk/layout-history.ts, src/motion.ts, outliner/src/script-runs.ts",
    aside: "click ✦ Fantasia (or ⏎ on it): the tiles float, wander and settle back; your press invited the run, so it may move the tile you are in too · act ext.<id>.run block=<this note> beats=3 as an agent runs the same script attributed to it: no invitation, so the tile you are in stays · script.stop run=<id> (or esc on the run) stops it between beats and puts the layout back · ctrl+z (layout.undo) or ext.undo takes the whole run back in one step (stay=1 leaves them floating where they danced: one undo is the 2x2 again) · motion.set mode=calm or off caps the dance · a locked screen refuses; your press may move a tile you type in, an unpressed run may not",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane(), c = new ReaderPane(), d2 = new ReaderPane();
      return deskOf({ title: "showcase · fantasia", panes: [a, b, c, d2], names: ["notes", "source", "extra", "more"], layout: ([w, x, y, z]) => pair("col", 0.5, row(0.5, w!, x!), row(0.5, y!, z!)) }, show, [[a, n.fantasia], [b, n.scripts], [c, n.shed], [d2, n.heap]]);
    },
  },
  {
    key: "script-examples", need: "learn the scripts surface from notes you can paste, and see each one run", part: "the scripts reference's worked examples (outliner docs/scripts.md) as notes: render scripts, an action script, a rule that stamps", files: "outliner/docs/scripts.md, outliner/src/script-examples.ts",
    aside: "Game 1 draws a tic-tac-toe board from its [board::] property · ^K then ttt-play cell=5 plays a cell as X, then O, and the drawing follows; the note's property is the whole state, so ctrl+z takes a move back · Seed order draws a table of its children with a Cost column: edit a [qty::] (e, save) or add a child and it redraws · Bed 4, the stamping rule and the other scripts sit under Script examples · the page prints exactly these notes, and its test runs them",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · script examples", panes: [a, b], names: ["game", "table"], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.exampleGame], [b, n.exampleOrder]]);
    },
  },
  {
    key: "one-place", need: "keep your place when reading, editing and returning to a held edit", part: "NoteSurface and Draft share source positions through Doc.source; DraftSession keeps the edit in the ReaderMode stack; PaneView.scroll draws its bar", files: "src/reader-position.ts, src/surface/note.ts, src/edit.ts, src/draft-session.ts",
    aside: "Scroll halfway, then e and Enter: the same line stays put. Click the shed, wheel the held edit, click back once to focus, again to place the cursor. Wheel away and type to return to the cursor. The scroll bar stays visible in both edits. Esc returns to reading at the same source line.",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · one place", panes: [a, b], names: ["reader", "short"], layout: ([x, y]) => row(0.62, x!, y!) }, show, [[a, n.overscroll], [b, n.shed]]);
    },
  },
  {
    key: "reading-line", need: "keep a reading line and move by blocks, sections or actions", part: "NoteSurface's ReaderPosition and Doc.source; the ruler and fixed comment gutter", files: "src/surface/note.ts, src/surface/selection.ts",
    aside: "Click a paragraph: the whole wrapped block lights. ↑↓ / j k read every bullet; ( ) jump sections; [ ] stop on actions. Wheel or PgUp/PgDn leave the reading line behind: its edge marker names the source line. Click a gutter chevron to fold, the trailing … to unfold. Click the other tile: the ruler stays dimmer. reader.ruler on=false turns it off. The notebook has links, nested items and a callout to try the three moves together.",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · reading line", panes: [a, b], names: ["reader", "structure"], layout: ([x, y]) => row(0.55, x!, y!) }, show, [[a, n.overscroll], [b, n.notebook]]);
    },
  },
  {
    key: "replies", need: "reply while the message stays visible, quote its words and follow the conversation", part: "NoteSurface's reader mode and shared split, the new-note editor and DraftSession child target, and the links model", files: "src/surface/note.ts, src/draft-session.ts, src/links.ts",
    aside: 'R replies · wheel over the message or PgUp/PgDn scrolls it while the draft keeps its place · ctrl+s saves · Esc twice discards typed text · select and R quotes · t opens replies, b shows links, T the full list · ~ toggles raw decoration',
    stage(n, show) {
      const a = new ReaderPane();
      return deskOf({ title: "showcase · replies", panes: [a], names: ["reader"], layout: ([x]) => leaf(x!) }, show, [[a, n.replies]]);
    },
  },
  {
    key: "snapshot", need: "take a SQLite copy for analysis", part: "ShareSessions tokens, OutlineSnapshots copies, publisher downloads and the shell ActionSet", files: "outliner/src/outline-snapshots.ts, outliner/src/share-sessions.ts, src/screens.ts",
    aside: "ctrl+k → > outline.snapshot copies a one-time link. The note shows the local CLI path, a SQLite query and how remote MCP clients refresh tools after a deploy; no database bytes enter chat.",
    stage(n, show) {
      const reader = new ReaderPane();
      return deskOf({ title: "showcase · SQLite snapshots", panes: [reader] }, show, [[reader, n.snapshot]]);
    },
  },
  {
    key: "upload", need: "hand a file to ep0ch from a shell, claude.ai or a phone", part: "the artifacts inbox and its watcher, the lease pattern (upload-tokens.ts), the publisher's token route and the shell ActionSet", files: "outliner/src/upload-tokens.ts, outliner/src/publish-upload.ts, outliner/src/artifact-store.ts, outliner/src/artifact-archive.ts, src/screens.ts",
    aside: "ctrl+k → > artifact.lease copies one curl command for one upload (an hour). The note says what is checked, where the card lands, and how a phone's Shortcut and a lost phone's revoke work. The lease here is real: curl a zip to it and the card appears in today's note.",
    stage(n, show) {
      const reader = new ReaderPane();
      return deskOf({ title: "showcase · hand a file over", panes: [reader] }, show, [[reader, n.upload]]);
    },
  },
  {
    key: "front-matter", need: "read and query the note's front matter", part: "outline-core header-line and property-grammar, the service property records and the reader's PropertyPanel", files: "outline-core/src/header-line.ts, outline-core/src/property-grammar.ts, src/surface/props-panel.ts",
    aside: "i or click the property count: block properties together, inline and line properties below, list values as chips · find connectTo=beans, connectto=frost, tag=neat or tag=epic · group=connectto puts the sowing note under beans and frost · the trailing #epic leaves the title; the source stays exactly as written",
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · front matter", panes: [a, b], layout: ([x, y]) => row(0.6, x!, y!) }, show, [[a, n.frontMatter], [b, n.frontMatterAgent]]);
    },
  },
  {
    key: "insert", need: "choose files or notes without leaving a draft", part: "draft.pick, pickInto, Site cwd scope and the desk's temporary terminal tile", files: "src/pick.ts, src/surface/note.ts, src/desk/desk.ts",
    aside: "e then Enter edits; [insert] or Ctrl+T opens the picker. Its title shows the folder. Mark two files and Enter inserts two absolute - [file::...] lines. Television owns its marks. Try the same draft in the drawer (tile.drawer).",
    stage(n, show) {
      const reader = new ReaderPane(), guide = new ReaderPane();
      return deskOf({ title: "showcase · insert", panes: [reader, guide], names: ["reader", "guide"], layout: ([a, b]) => row(0.65, a!, b!) }, show, [[reader, n.insert], [guide, n.insert]]);
    },
  },
  {
    key: "nested-mounts", need: "mount a screen inside a screen inside a screen and still see one box per tile and one hint row", part: "a mount's frame (PIE-1305): a tile with a screen of its own in it (Pane.nestsTiles) is its header and nothing else, and the outermost screen's hint row says the keys of the tile that has focus at any depth (Desk.hintDesk)", files: "src/desk/desk.ts (drawTile, hintDesk), src/desk/screen-tile.ts",
    aside: "calls is the last callers' screen, and who's online is mounted in it: each mount is a header (its name, ▲ full, ⏎ in) over tiles that keep their own frames, so no box sits inside another, and the one hint row at the bottom speaks for the focused tile wherever it is · reader is here and in calls: a click on either's ≡, or a right-click, opens that tile's menu, and an act names them calls/reader · ^W n renames the tile you are on, \"rename this tile\": its name, its path (calls/yo) and its title change together",
    stage(n, show) {
      const tree = new TreePane(), reader = new ReaderPane(true);
      const calls = new ScreenTile("screen", { screen: "lastcall", inner: { focus: "activity", root: { t: "split", dir: "row", weights: [0.34, 0.33, 0.33], kids: [{ t: "leaf", kind: "activity", name: "activity" }, { t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "screen", name: "who", screen: "who" }] } } });
      return deskOf({
        title: "showcase · nested mounts", panes: [tree, reader, calls], names: ["tree", "reader", "calls"],
        layout: ([t, r, c]) => pair("row", 0.2, leaf(t!), pair("row", 0.22, leaf(r!), leaf(c!))),
      }, show, [[reader, n.notebook]]);
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
  enterTiles() { void this.dispatch.pressIn(SHOWCASE_ACTIONS, "section.try", {}); }
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
      canvas.text(1, 2 + j * 2, on ? selectedRow(label, idx.cols - 2, this.focus === "index") : fg(C.grey) + label + RESET, idx.cols - 2);
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
      if (f.top instanceof Desk) f.top.screenOrigin = { col: r.col, row: r.row };
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
    if (k.action === "drag" && k.button === 3) {
      if (inStage && f) f.key(rel);
      return this.ctx.redraw();
    }
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

  private onScreen = true;
  shownAs(on: boolean) { this.onScreen = on; for (const [i, f] of this.stages) f.shownAs(on && i === this.sel); }
  tick(): boolean { return [...this.stages].map(([i, f]) => f.tick(this.onScreen && i === this.sel)).some(Boolean); }
  /** The shown stage's (the status bar's stop control acts on the stage in front, so it only offers what it can stop). */
  dancing(): boolean { return this.stages.get(this.sel)?.dancing() ?? false; }
  settle(): boolean { return [...this.stages.values()].map(f => f.settle()).some(Boolean); }
  scriptEnded(run: string, reason: "done" | "stopped" | "failed") { for (const f of this.stages.values()) f.scriptEnded(run, reason); }
  scriptUndone(run: string) { for (const f of this.stages.values()) f.scriptUndone(run); }
  scriptsLost() { for (const f of this.stages.values()) f.scriptsLost(); }
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

  inTile(p: import("../term").TileProgram, done: (code: number | null) => void): boolean { return this.stage(this.sel)?.top.inTile?.(p, done) ?? false; }

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
        if (f?.top.dispatch) { if (req) f.open(); return f.top.dispatch; }
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
    const inner = f ? screenKeys(f.top) : null;
    return f ? { ...inner!, busy: true, ...(inner!.busy ? {} : { navHold: true as const }), why: `the person is in section ${this.sel + 1} (${SECTIONS[this.sel]!.key}); sections change from the index` } : { focus: null, typingIn: null, busy: false };
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
    examples: [
      { act: "section.try", does: "puts the person's keys in the shown section's stage" },
      { act: "section.try name=note", does: "shows the note section and puts the person's keys in its stage" },
    ],
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
    examples: [
      { act: "section name=3", does: "shows the third section in the stage" },
      { act: "section name=note", does: "shows the note section in the stage" },
    ],
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
  hint() { return "j k ↑↓ pick: its page under the list · ⏎ run it in the reader beside (no-argument note and desk actions)"; }
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
    // Under the list, the selected action's page (PIE-1032): as the power bar's preview and `ep0ch actions --doc` draw it.
    const cur = this.rows[this.sel];
    const page = cur && "a" in cur ? draftPreview(actionPage(cur.a), Math.max(20, w), null) : [];
    const detail = page.length ? Math.min(page.length + 1, Math.max(3, Math.floor(h * 0.6))) : 0;
    const room = Math.max(1, h - detail);
    this.view.place(this.sel, this.rows.length, room);
    const nameW = Math.min(20, Math.max(8, Math.floor(w * 0.3))), keysW = Math.min(18, Math.max(6, Math.floor(w * 0.22)));
    const lines = this.rows.slice(this.view.top, this.view.top + room).map((r, j) => {
      const i = this.view.top + j;
      if ("head" in r) return fg(C.lcyan) + pad(r.head, w) + RESET;
      const text = ` ${pad(r.a.name, nameW)} ${pad(r.a.keys ?? "—", keysW)} ${r.a.summary}`;
      return i === this.sel ? selectedRow(text, w, focused)
        : fg(C.yellow) + " " + pad(r.a.name, nameW) + " " + fg(C.brown) + pad(r.a.keys ?? "—", keysW) + " " + fg(C.grey) + pad(r.a.summary, Math.max(1, w - nameW - keysW - 3)) + RESET;
    });
    while (lines.length < room) lines.push("");
    if (detail) lines.push(fg(C.blue) + "─".repeat(w) + RESET, ...page.slice(0, detail - 1));
    return { lines, scroll: { top: this.view.top, room, total: this.rows.length } };
  }
  runAction(a: ActionInfo, desk: DeskApi, actor: Actor) {
    const needs = Object.entries(a.args).filter(([, s]) => !s.optional).map(([k]) => k);
    if (!["note", "desk"].includes(a.scope)) return desk.ctx.flash(`${a.name} belongs to the ${a.scope}; try it there${a.keys ? ` (${a.keys})` : ""}`);
    if (needs.length) return desk.ctx.flash(`${a.name} needs ${needs.join(", ")}: use its key${a.keys ? ` (${a.keys})` : ""} in the reader, or ep0ch-door act ${a.name} ${needs.map(n => `${n}=…`).join(" ")}`);
    this.run?.(a.name, actor).then(() => desk.redraw(), e => desk.ctx.flash(`${a.name}: ${e instanceof Error ? e.message : String(e)}`, undefined, errorDetails(e)));
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
    examples: [
      { act: "registry.pick n=5 tile=registry", does: "selects the fifth action in the registry list" },
      { act: "registry.pick n=5 run=true tile=registry", does: "selects the fifth action and runs it in the reader beside", safe: false },
    ],
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

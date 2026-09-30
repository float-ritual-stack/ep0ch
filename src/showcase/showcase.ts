// The showcase (PIE-439): every shared door part, live, on the seeded showcase outline. One section per
// row of the reuse map (docs/UI-GRAMMAR.md "Before adding a feature"), in the map's order; each is drawn
// by the part itself, hosted on a preset desk or the real board, never a copy. A parallel version still
// in the code is shown beside the shared one and labelled, until consolidation removes it.
//
// It only runs on an outline the showcase seed wrote (src/showcase/seed.ts): `scripts/try-it.sh --showcase`
// starts one. On any other outline it says so and writes nothing.
import { wheelRows } from "../term";
import type { Ctx, Frame, Screen } from "../app";
import type { Msg } from "../board";
import { subject } from "../board";
import { backlinkView, DEFAULT_BACKLINK_VIEW_OPTIONS, describeBacklinkView } from "../backlinks";
import { Canvas, type Rect } from "../canvas";
import type { Placement } from "../kitty";
import type { Actor, Capability, OutlineEvent } from "../socket";
import { bg, C, fg, pad, paint, RESET } from "../style";
import { wrap } from "../text";
import type { Key } from "../term";
import { ActionRefused, ActionSet, agentLabel, type ActionInfo, type ActRequest } from "../surface/actions";
import { NOTE_ACTIONS } from "../surface/note";
import { DRAFT_ACTIONS } from "../edit";
import { Desk, DESK_ACTIONS, type DeskPreset } from "../desk/desk";
import { BOARD_ACTIONS, DeliveryBoard } from "../desk/delivery";
import { RIVER_ACTIONS } from "../river/river";
import { ActivityPane, ReaderPane, ThreadPane, TreePane, WhoPane, type DeskApi, type Pane, type PaneView } from "../desk/panes";
import { LastCallers, MessageReader, WhoOnline } from "../screens";
import { leaf, pair, type LNode } from "../desk/layout";
import { FramedScreen, ScreenPane } from "./frame";
import { PreviewPane } from "../desk/preview";
import { PtyPane } from "../desk/pty";
import { ScreenTile } from "../desk/screen-tile";
import { loadShowcase, SEED, type SeedName } from "./seed";
import { PROPERTY_GRAMMAR_VERSION } from "../vendor/property-grammar";

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
/** Put a note in a reader once its desk is open (readers on a preset desk keep their own notes). */
type Shower = (after: (ctx: Ctx) => void) => void;

const PARALLEL = "parallel version, to consolidate";
/** Two panes side by side, the first `ratio` of the width. */
const row = (ratio: number, a: number, b: number): LNode => pair("row", ratio, leaf(a), leaf(b));

/** A preset desk whose readers show `notes` (one each, in order) once it opens. */
function deskOf(preset: DeskPreset, show: Shower, readers: [ReaderPane, Msg | undefined][], then?: (d: Desk) => void): Desk {
  const d = new Desk(preset);
  show(() => {
    for (const [r, m] of readers) if (m) r.show(m, d);
    then?.(d);
  });
  return d;
}

export const SECTIONS: Section[] = [
  {
    key: "note", need: "render or read a note", part: "NoteSurface, hosted through SurfaceHost (a ReaderPane; the BBS message reader)", files: "src/surface/note.ts, src/doc.ts, src/literal.ts, src/inline.ts, src/components.ts",
    stage(n, show) {
      const r = new ReaderPane();
      // The BBS message reader hosts the same surface (PIE-426): its header, the surface's body and keys.
      const bbs = new ScreenPane("the same NoteSurface in the BBS message reader · src/screens.ts", m => (m ? new MessageReader([m], 0) : null), true);
      return deskOf({ title: "showcase · note", panes: [r, bbs], layout: ([a, b]) => row(0.5, a!, b!) }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook); });
    },
  },
  {
    key: "actions", need: "let a person or agent do anything", part: "the action registry: ActionDef in an ActionSet; keys and `act` call it", files: "src/surface/actions.ts, src/control.ts",
    stage(n, show) {
      const r = new ReaderPane();
      const list = new ActionsPane();
      const d = deskOf({ title: "showcase · actions", panes: [list, r], layout: ([a, b]) => row(0.55, a!, b!) }, show, [[r, n.whiteboard]]);
      list.run = (name, actor) => d.act({ action: name, reader: "2" }, actor);
      return d;
    },
  },
  {
    key: "edit", need: "edit text, complete [[ (( [file::", part: "the editing component: Draft, edit control, completer, DRAFT_ACTIONS (lists, wrap, mouse, preview, unsent); the property panel (i, I)", files: "src/edit.ts, src/surface/editor.ts, src/surface/completer.ts, src/surface/props-panel.ts",
    aside: `${PARALLEL}: the board's composer (src/desk/delivery.ts) draws the edit control without completion (F9)`,
    stage(n, show) {
      const a = new ReaderPane(), b = new ReaderPane();
      return deskOf({ title: "showcase · edit", panes: [a, b], layout: ([x, y]) => row(0.5, x!, y!) }, show, [[a, n.whiteboard], [b, n.notebook]], () => b.surface.openPanel(false));
    },
  },
  {
    key: "panes", need: "open, split, zoom, close panes", part: "the pane model: the layout tree, shared by the desk and the board (^W then o x z s HJKL < > + -; the board's x o T B { } < >); pane.* actions", files: "src/desk/layout.ts, src/desk/pane-actions.ts, src/desk/panes.ts, src/desk/desk.ts",
    aside: `${PARALLEL}: the river's strip (src/river/river.ts); the board (section 5) is on the tree since PIE-412`,
    stage(n, show) {
      const tree = new TreePane(), r = new ReaderPane(true), th = new ThreadPane(), act = new ActivityPane();
      // The thread and the activity panes are one tab set (PIE-413): drag a header onto another to make one.
      return deskOf({
        title: "showcase · panes", panes: [tree, r, th, act],
        layout: ([t, rd, h, a]) => pair("row", 0.24, leaf(t!), pair("row", 0.62, leaf(rd!), { t: "tabs", ids: [h!, a!], active: 0 })),
      }, show, [], d => { if (n.notebook) d.setCurrent(n.notebook, { reveal: true }); });
    },
  },
  {
    key: "terminal", need: "run a program beside the notes (nvim, claude, a shell)", part: "the terminal tile: a pty (Bun.Terminal) drawn through @xterm/headless; click or ⏎ types in it, ctrl+] leaves; ctrl+e edits a draft in one", files: "src/desk/pty.ts, src/surface/editor.ts",
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
    key: "spine", need: "squeeze a pane to a title strip", part: "the spine part: drawSpine, SPINE (c collapses a lane or a reader, alt+c opens all)", files: "src/spine.ts, on the board: src/desk/delivery.ts",
    stage(n) { return new DeliveryBoard(n.hub?.id, false); },
  },
  {
    key: "entity", need: "show children, outlinks, backlinks, resources", part: "entity navigation: u, [ ] and ⏎ on links in the surface; children in the thread pane", files: "src/surface/note.ts, src/desk/panes.ts, references.backlinks in src/socket.ts, src/backlinks.ts",
    aside: "backlinks: the board's drawer (section 5, b) and the backlinks tile (^W o l; the welcome's), one drawing, grouped and filtered as Detail does (src/backlinks.ts, src/desk/backlinks-pane.ts, PIE-442) · resources: no list yet (PIE-432)",
    stage(n, show) {
      const r = new ReaderPane(true), th = new ThreadPane();
      return deskOf({ title: "showcase · entity", panes: [r, th], layout: ([a, b]) => row(0.6, a!, b!) }, show, [], d => { if (n.shed) d.setCurrent(n.shed); });
    },
  },
  {
    key: "presence", need: "show who's here or recent activity", part: "presence: WhoPane and ActivityPane over clients.list, activity.recent", files: "src/desk/panes.ts",
    stage(_n, show) {
      const who = new WhoPane(), act = new ActivityPane();
      const whoBbs = new ScreenPane(`${PARALLEL} · WhoOnline · src/screens.ts`, () => new WhoOnline());
      const lastBbs = new ScreenPane(`${PARALLEL} · LastCallers · src/screens.ts`, () => new LastCallers());
      return deskOf({
        title: "showcase · presence", panes: [who, act, whoBbs, lastBbs],
        layout: ([a, b, c, e]) => pair("row", 0.5, pair("col", 0.35, leaf(a!), leaf(b!)), pair("col", 0.35, leaf(c!), leaf(e!))),
      }, show, []);
    },
  },
  {
    key: "live", need: "put live data in a note", part: "live figures: ::graph-* blocks that read views with views.read and blocks.query", files: "src/live.ts, src/graphs.ts, src/views.ts",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · live", panes: [r] }, show, [[r, n.figures]]); },
  },
  {
    key: "projection", need: "show a Resource's stored details in a note", part: "resource projections: resources.projection.read, laid out in Detail's words, drawn under the jira:: line or at a ticket page's top ([ ] ⏎ click y)", files: "src/projection.ts, src/surface/note.ts, src/doc.ts",
    aside: "made-up tickets from a made-up extension (src/showcase/tickets); the door only reads what the service stored",
    stage(n, show) {
      const r = new ReaderPane(), th = new ThreadPane();
      return deskOf({ title: "showcase · projection", panes: [r, th], layout: ([a, b]) => row(0.62, a!, b!) }, show, [[r, n.tickets]], d => { if (n.tickets) d.setCurrent(n.tickets); });
    },
  },
  {
    key: "selection", need: "select or copy text a reader draws", part: "the selection model: Selection, Gesture, v, y Y, select* actions", files: "src/surface/selection.ts, src/surface/note.ts",
    stage(n, show) { const r = new ReaderPane(); return deskOf({ title: "showcase · selection", panes: [r] }, show, [[r, n.recipe]]); },
  },
  {
    key: "service", need: "know anything the service can answer", part: "ask the service: views.read, blocks.read, properties.preview, changes.since, references.*, gated by Capability", files: "src/socket.ts",
    stage(n, show) { const p = new ServicePane(n); return deskOf({ title: "showcase · service", panes: [p] }, show, []); },
  },
];

/** The index is wide enough for every need on one line when the terminal allows; narrow, it lists the keys only. */
const indexWidth = (cols: number) => (cols >= 160 ? 52 : cols >= 110 ? 34 : cols >= 60 ? 16 : 12);

export class Showcase implements Screen {
  title = "showcase";
  ctx!: Ctx;
  private notes: Notes | null = null;
  private problem = "";
  private sel = 0;
  /** Where the person's keys go: the index of sections, or the section's stage. */
  private focus: "index" | "stage" = "index";
  private stages = new Map<number, FramedScreen>();
  private stageRect: Rect = { col: 34, row: 4, cols: 80, rows: 20 };
  private indexW = 34;
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
      f = new FramedScreen(screen, () => this.ctx, () => { this.focus = "index"; }, () => after?.(f!.ctx));
      this.stages.set(i, f);
    }
    return f;
  }

  /** Screen.holdsKeys: the person is in the stage and its screen holds their keys (an edit, a comment, a panel). */
  holdsKeys(): boolean { return this.focus === "stage" && !!this.stages.get(this.sel)?.top.holdsKeys?.(); }

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
    SECTIONS.forEach((s, i) => {
      const on = i === this.sel;
      const label = pad(` ${String(i + 1).padStart(2)} ${wide ? s.need : s.key}`, idx.cols - 2);
      canvas.text(1, 2 + i * 2, on ? (this.focus === "index" ? bg(C.blue) + fg(C.white) : fg(C.yellow)) + label + RESET : fg(C.grey) + label + RESET, idx.cols - 2);
      if (wide) canvas.text(1, 3 + i * 2, fg(C.dark) + pad(`    ${s.key}`, idx.cols - 2) + RESET, idx.cols - 2);
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
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (k.kind === "esc" || c === "q") return ctx.pop();
    if (k.kind === "up" || c === "k") return this.pick(this.sel - 1);
    if (k.kind === "down" || c === "j") return this.pick(this.sel + 1);
    if (/^[0-9]$/.test(c)) return this.pick(c === "0" ? 9 : Number(c) - 1);
    if (k.kind === "enter" || k.kind === "right" || k.kind === "tab" || c === "l") return this.pick(this.sel, true);
    if (c === "V") return ctx.cycleVideo();
  }

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
      if (inStage && f) { this.focus = "stage"; this.pressed = true; f.key(rel); return this.ctx.redraw(); }
      const i = k.x < this.indexW && k.y >= 2 ? Math.floor((k.y - 2) / 2) : -1;
      if (i >= 0 && i < SECTIONS.length) return this.pick(i);
      return;
    }
    // The wheel: the stage under the pointer scrolls; over the index it moves between sections.
    if (inStage && f) { f.key(rel); return this.ctx.redraw(); }
    if (k.x < this.indexW) this.pick(this.sel + (k.action === "wheel-down" ? 1 : -1));
  }

  tick(): boolean { return [...this.stages.values()].some(f => f.tick()); }
  onEvent(e: OutlineEvent) { for (const f of this.stages.values()) f.onEvent(e); }
  unsaved() { return [...this.stages.values()].some(f => f.unsaved()); }
  keepDrafts() { return [...this.stages.values()].flatMap(f => f.keepDrafts()); }
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

  actions() {
    const inner = this.stage(this.sel)?.top.actions?.() ?? { actions: [], readers: [] };
    return { actions: [...SHOWCASE_ACTIONS.list(), ...inner.actions], readers: inner.readers };
  }

  async act(req: ActRequest, actor: Actor): Promise<unknown> {
    if (SHOWCASE_ACTIONS.has(req.action)) return SHOWCASE_ACTIONS.runUntyped(req.action, { ...(req.args ?? {}) }, this, actor);
    const f = this.stage(this.sel);
    if (!f) throw new ActionRefused(this.problem || "the showcase outline is still being read");
    const top = f.top;
    if (!top.act) throw new ActionRefused(`the ${SECTIONS[this.sel]!.key} section has no actions`);
    return top.act(req, actor);
  }

  /** The section on screen, and whether the person's keys are in it (not on the index). */
  get shown() { return this.sel; }
  personInStage() { return this.focus === "stage"; }

  /** By number (1-10) or key (note, actions, edit…). */
  sectionOf(name: string): number {
    const i = /^\d+$/.test(name) ? Number(name) - 1 : SECTIONS.findIndex(s => s.key === name);
    if (i < 0 || i >= SECTIONS.length) throw new ActionRefused(`no section ${name}; sections: ${SECTIONS.map((s, j) => `${j + 1} ${s.key}`).join(", ")}`);
    return i;
  }
}

/** The showcase's own actions: which section is shown. Keys and clicks on the index call the same code. */
export const SHOWCASE_ACTIONS = new ActionSet<{ "section": { name: string } }, Showcase>("showcase", {
  "section": {
    summary: "show a section (name=<1-14> or its key: note, actions, edit, panes, terminal, preview, screen, spine, entity, presence, live, projection, selection, service); refused to an agent while the person is in one", keys: "↑↓ j k, 1-9 0, click",
    args: { name: { type: "string", about: "the section's number or key" } },
    run({ name }, s, actor) {
      const i = s.sectionOf(name);
      // An agent never moves the person out of a section they are working in: sections change from the index.
      if (actor.kind === "agent" && s.personInStage()) throw new ActionRefused(`the person is in section ${s.shown + 1} (${SECTIONS[s.shown]!.key}); sections change from the index`);
      s.pick(i, false);
      if (actor.kind === "agent") s.ctx.flash(`${agentLabel(actor)} showed section ${i + 1} (${SECTIONS[i]!.key})`);
      return { section: i + 1, key: SECTIONS[i]!.key };
    },
  },
});

// ── the panes only the showcase has: the action list and what the service answers ──────────────────

const SETS: { name: string; file: string; list: () => ActionInfo[] }[] = [
  // The note set forwards the draft's actions (draft.*); they're listed once, as the draft's own.
  { name: "NOTE_ACTIONS", file: "src/surface/note.ts", list: () => NOTE_ACTIONS.list().filter(a => !DRAFT_ACTIONS.has(a.name)) },
  { name: "DESK_ACTIONS", file: "src/desk/desk.ts", list: () => DESK_ACTIONS.list() },
  { name: "DRAFT_ACTIONS", file: "src/edit.ts", list: () => DRAFT_ACTIONS.list() },
  { name: "BOARD_ACTIONS", file: "src/desk/delivery.ts", list: () => BOARD_ACTIONS.list() },
  { name: "RIVER_ACTIONS", file: "src/river/river.ts", list: () => RIVER_ACTIONS.list() },
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
  private top = 0;
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
    if (this.sel < this.top) this.top = this.sel;
    if (this.sel >= this.top + room) this.top = this.sel - room + 1;
    const nameW = Math.min(20, Math.max(8, Math.floor(w * 0.3))), keysW = Math.min(18, Math.max(6, Math.floor(w * 0.22)));
    const lines = this.rows.slice(this.top, this.top + room).map((r, j) => {
      const i = this.top + j;
      if ("head" in r) return fg(C.lcyan) + pad(r.head, w) + RESET;
      const text = ` ${pad(r.a.name, nameW)} ${pad(r.a.keys ?? "—", keysW)} ${r.a.summary}`;
      return i === this.sel ? (focused ? bg(C.blue) : "\x1b[48;2;22;30;58m") + fg(C.white) + pad(text, w) + RESET
        : fg(C.yellow) + " " + pad(r.a.name, nameW) + " " + fg(C.brown) + pad(r.a.keys ?? "—", keysW) + " " + fg(C.grey) + pad(r.a.summary, Math.max(1, w - nameW - keysW - 3)) + RESET;
    });
    while (lines.length < room) lines.push("");
    const cur = this.rows[this.sel];
    if (cur && "a" in cur) {
      const args = Object.entries(cur.a.args).map(([k, s]) => `${k}${s.optional ? "?" : ""}: ${s.type}`).join(", ") || "no arguments";
      lines.push(fg(C.blue) + "─".repeat(w) + RESET, fg(C.white) + pad(`ep0ch-door act ${cur.a.name}${Object.keys(cur.a.args).length ? " key=value…" : ""}`, w) + RESET, fg(C.dark) + pad(`${cur.a.scope} · ${args}`, w) + RESET);
    }
    return { lines, scroll: { top: this.top, room, total: this.rows.length } };
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
    const c = k.kind === "char" && !k.ctrl ? k.ch : "";
    if (k.kind === "up" || c === "k") { this.step(-1); desk.redraw(); return true; }
    if (k.kind === "down" || c === "j") { this.step(1); desk.redraw(); return true; }
    if (k.kind === "pgdn") { for (let i = 0; i < 10; i++) this.step(1); desk.redraw(); return true; }
    if (k.kind === "pgup") { for (let i = 0; i < 10; i++) this.step(-1); desk.redraw(); return true; }
    if (k.kind === "enter") { this.runSelected(desk); return true; }
    return false;
  }
  click(_x: number, y: number, desk: DeskApi) {
    const i = this.top + y;
    if (!this.rows[i] || "head" in this.rows[i]!) return;
    const again = this.lastClick.i === i && Date.now() - this.lastClick.at < 400;
    this.sel = i; this.lastClick = { at: Date.now(), i };
    if (again) this.runSelected(desk);
    desk.redraw();
  }
  wheel(dir: 1 | -1, desk: DeskApi) { for (let i = 0; i < wheelRows; i++) this.step(dir); desk.redraw(); }
}

const CAPS: Capability[] = ["views.read", "blocks.read", "properties.preview", "changes.since", "query.expression", "references.backlinks.facets", "views.planWrite", "query.matches", "ping.propertyGrammar"];

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
    for (const c of CAPS) say(`  supports ${c}`, String(b.supports(c) ?? "untried"));
    say("roadmap allocator (protocol ≥ 82)", String(b.hasRoadmapAllocator() ?? "unknown"));
    out.push("");
    if (n.gardenView) await tryIt(`views.read ((${SEED.gardenView}))`, async () => { const r = await b.readSavedView(n.gardenView!.id); return r ? `${r.status} · ${r.blocks.length} block(s): ${r.blocks.map(subject).join(", ")}` : "this service can't read views"; });
    if (n.hub) await tryIt(`blocks.read (${SEED.hub}'s lanes)`, async () => { const kids = await b.children(n.hub!.id); const r = await b.readMany(kids.map(k => k.id), ["title", "properties"]); return r.map(subject).join(", "); });
    if (n.hub) await tryIt(`views.planWrite (a new card, first lane)`, async () => {
      const lane = (await b.children(n.hub!.id))[0];
      const p = lane ? await b.planCreate(lane.id) : null;
      return !lane ? "no lanes" : !p ? "this service can't plan writes" : p.kind === "refused" ? `refused: ${p.reason}` : `${subject(lane)}: born with ${p.born.map(x => `${x.key}=${x.value}`).join(" ") || "nothing"}${p.needs.length ? ` · needs ${p.needs.join(" and ")}` : ""}`;
    });
    say("property grammar (vendored)", `version ${PROPERTY_GRAMMAR_VERSION} · src/vendor/property-grammar.ts, the outliner's own file`);
    if (n.notebook) await tryIt("properties.preview (notebook text)", async () => { const r = await b.previewPropertyList(n.notebook!.text); return r ? r.map(p => `${p.key}::${p.value}`).join(" ") : "this service can't preview"; });
    if (n.shed) await tryIt(`references.backlinks (${SEED.shed})`, async () => { const c = await b.backlinks(n.shed!.id); return `${describeBacklinkView(backlinkView(c, DEFAULT_BACKLINK_VIEW_OPTIONS), DEFAULT_BACKLINK_VIEW_OPTIONS, new Set()).status}: ${c.sources.map(x => x.title).join(", ") || "none"}`; });
    await tryIt("changes.since (last 5)", async () => { const r = await b.changesSince(Math.max(0, (b.lastSequence ?? 0) - 5), 5); return !r ? "this service has no change feed" : r.kind === "reset" ? `reset: ${r.reason}` : `${r.changes.length} change(s), next #${r.nextSequence}`; });
    this.answers = out;
    desk.redraw();
  }
  render(w: number): PaneView { return { lines: (this.answers ?? [fg(C.dark) + "asking the service…" + RESET]).map(l => pad(l, w)) }; }
  key(k: Key, desk: DeskApi): boolean { if (k.kind === "char" && k.ch === "r") { void this.load(desk); return true; } return false; }
}

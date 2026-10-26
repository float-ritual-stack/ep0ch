import { wordEraseStart } from "@ep0ch/outline-core/graphemes";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { PositionRows } from "../reader-position";
// The one edit control: a Draft (src/edit.ts) drawn in the same frame, with the same keys and the same
// status line, wherever text is written — a note's whole text, a comment, a reply. Ctrl+E hands any of
// them to $VISUAL/$EDITOR and back through the same path.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DRAFT_ACTIONS, keepCopy, patchLabel, type Draft } from "../edit";
import { USER, type Actor } from "../socket";
import { stateSub } from "../state";
import { drawEllipsized, C, fg, pad, RESET, visible, width, type LinkRange } from "../style";
import { inWindow, type Placement } from "../kitty";
import type { LinkTarget } from "../refs";
import { rule, words } from "../text";
import { ownTerminal, type Handover, type TileProgram, type Key } from "../term";
import { agentLabel } from "./actions";
import { COMPLETION_HINT, COMPLETION_ROWS, completerOf, completionOf, renderCompletion } from "./completer";

export interface EditFrame {
  look?: StyleValues;
  /** What is being written, after the `»`: "editing · <note>", "comment · <note>", "reply to x · <note>". */
  title: string;
  /** Status lines under the title (already coloured): revision and state, the last thing that happened. */
  status: string[];
  /** Context between the status and the text, such as the quoted passage. */
  context?: string[];
  /** Who else typed into this draft (an agent), shown so it is never silent. */
  by?: string | null;
  /**
   * The host's reader renderer for a live preview of the draft (`snippetDoc` or `draftPreview` in the note surface:
   * the same body renderer every reader uses). With it the frame offers the preview (ctrl+p, or its control).
   * `pending`: something in it (an embed) is still being read, so it is drawn again on the redraw its answer brings.
   */
  preview?: (text: string, w: number, links: LinkTarget[]) => { lines: string[]; links: LinkRange[]; pending?: boolean; placements?: Placement[]; source: number[] };
  /**
   * The host follows a link: ctrl+l on the one the cursor is on, a click on one in the preview (PIE-592). Without it
   * the preview's links are only drawn.
   */
  follow?: boolean;
  /** The host draws this preview through the shared attached surface. */
  attachedPreview?: boolean;
  /** The host can insert from a picker (ctrl+t, src/pick.ts): the frame offers it as a control too. */
  pick?: boolean;
  /** Where a comment's composer sits (PIE-770, src/surface/composer.ts): a chip that switches it (ctrl+o), its name the label. */
  place?: string;
  /** Where a new note lands (PIE-883: `→ Inbox › 2026-10-14`): a row of its own under the status, a click moves it. */
  lands?: string;
  /**
   * The keys are on another tile (PIE-812): the draft is left open as it was, its text drawn dim and without its cursor
   * or selection, so the tile that has the keys is the one that looks like it.
   */
  away?: boolean;
}

/**
 * The frame every draft is drawn in: title, status, context, a rule, then the text with its cursor, and the
 * preview under it when it's on. Where the text and the controls landed is kept on the draft (`d.frame`),
 * so a click in the host's cells finds them (`editorClick`).
 */
export function renderEditor(d: Draft, f: EditFrame, w: number, h: number): string[] {
  // The controls, where there's room for them beside the title (a narrow river column has ctrl+t and ctrl+p).
  const pv = f.preview && w >= 40 ? (d.preview ? "[hide preview]" : "[preview]") : "";
  const pk = f.pick && w >= 56 ? "[insert]" : "";
  // With text selected, a [copy] control: the mouse's way to the draft's copy, wherever copy on select is off.
  const cp = d.selection() && w >= 32 ? "[copy]" : "";
  const pl = f.place && w >= 28 ? `[${f.place} ▸]` : "";
  const ctls = [...(cp ? [{ text: cp, action: "copy" as const }] : []), ...(pk ? [{ text: pk, action: "pick" as const }] : []), ...(pv ? [{ text: pv, action: "preview" as const }] : []), ...(pl ? [{ text: pl, action: "place" as const }] : [])];
  const cw = ctls.reduce((n, c) => n + c.text.length + 1, 0);
  const tw = Math.max(1, w - cw);
  const controls: NonNullable<Draft["frame"]>["controls"] = [];
  let x = tw + 1;
  for (const c of ctls) { controls.push({ row: 0, from: x, to: x + c.text.length, action: c.action }); x += c.text.length + 1; }
  // Where a new note lands, under the status: the whole row is its control.
  // The destination gives way first, so [move ▸] is always there to see.
  const lands = f.lands ? (() => { const mv = "  [move ▸]", room = Math.max(1, w - mv.length), at = drawEllipsized(f.lands, room), t = `${at}${mv}`; controls.push({ row: 1 + f.status.length, from: 0, to: Math.min(w, width(t)), action: "lands" }); return [fg(C.lcyan) + pad(t, w) + RESET]; })() : [];
  const top = [
    fg(C.yellow) + pad(`» ${f.title}`, tw) + ctls.map(c => " " + fg(C.lcyan) + c.text).join("") + RESET,
    ...f.status,
    ...lands,
    ...(f.by ? [fg(C.lmagenta) + pad(f.by, w) + RESET] : []),
    ...(f.context ?? []),
    rule(w),
  ];
  const all = Math.max(1, h - top.length);
  // The preview takes the lower half, once there's room for both.
  const ph = f.preview && !f.attachedPreview && d.preview && all >= 6 ? Math.floor(all / 2) : 0;
  const room = all - ph;
  // A preview tile can paint before its source reader (for example, on the left).
  const attached = f.attachedPreview && d.preview ? { preview: d.frame?.preview, links: d.frame?.links } : {};
  d.frame = { row: top.length, col: 1, rows: room, cols: Math.max(1, w - 2), controls, ...attached };
  const below = ph ? previewRows(d, f.preview!, w, ph, top.length + room) : [];
  const pop = completionOf(d), c = completerOf(d);
  if (c) c.drawn = null;
  if (f.away) {
    const text = d.render(Math.max(1, w - 2), room).map(l => " " + fg(C.dark) + visible(l) + RESET);
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  if (!pop || !c) {
    const text = d.render(Math.max(1, w - 2), room).map(l => " " + l);
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  if (c.screenLayer) {
    const text = d.render(Math.max(1, w - 2), room).map(l => " " + l);
    c.drawn = { row: top.length + d.cursorRow + 1, cols: w, anchor: 1 + d.cursorCol, items: [] };
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  // The completion popup opens under the cursor's row; the draft gives up that many rows to keep it.
  const cph = Math.min(COMPLETION_ROWS, Math.max(0, room - 1));
  const text = d.render(Math.max(1, w - 2), Math.max(1, room - cph)).map(l => " " + l);
  const at = Math.min(text.length, d.cursorRow + 1), rows: (number | null)[] = [];
  const popup = renderCompletion(pop, w, cph, rows, 1 + d.cursorCol, f.look);
  // Where it went, so a click on a candidate can choose it (NoteSurface.click).
  c.drawn = { row: top.length + at, cols: w, anchor: 1 + d.cursorCol, items: rows.slice(0, Math.max(0, room - at)) };
  const mid = [...text.slice(0, at), ...popup, ...text.slice(at)].slice(0, room);
  return [...top, ...mid, ...(below.length ? pad0(room - mid.length) : []), ...below];
}

/**
 * What the wheel at `x`, `y` (the host's cells) over a draft drawn by renderEditor scrolls (PIE-846): its preview when
 * the pointer is over the preview, its text when over the text, else null (the host's own: the note around a comment).
 */
export function wheelTarget(d: Draft, x: number, y: number): "text" | "preview" | null {
  const f = d.frame;
  if (!f) return null;
  if (f.preview && x >= f.preview.col && x < f.preview.col + f.preview.cols && y >= f.preview.row && y < f.preview.row + f.preview.rows) return "preview";
  if (x < f.col - 1 || x > f.col + f.cols) return null;
  return y >= f.row && y < f.row + f.rows ? "text" : null;
}

/** Empty rows, so the preview under the text stays put while the text is short. */
const pad0 = (n: number) => Array.from({ length: Math.max(0, n) }, () => "");

const previewCache = new WeakMap<Draft, { text: string; w: number; at: number; body: string[]; ranges: LinkRange[]; links: LinkTarget[]; pending: boolean; placements: Placement[]; source: number[] }>();

/**
 * The preview's rows: a labelled rule, then the rendered draft, the part around the cursor's line. Its links are kept on
 * the frame where they're drawn (from row `row`), so a click on one follows it (PIE-592).
 */
export function previewRows(d: Draft, render: NonNullable<EditFrame["preview"]>, w: number, h: number, row: number, col = 0, aligned = false): string[] {
  // Drawn again only when the text or width changed (a cursor move, a wheel or a blink repaints it for free),
  // after a moment, for link titles that arrived since, and while an embed in it is being read (PIE-852).
  const text = d.text, pw = Math.max(1, w - 2), hit = previewCache.get(d), now = Date.now();
  let shown = hit && hit.text === text && hit.w === pw && now - hit.at < 2000 && !hit.pending ? hit : null;
  if (!shown) {
    const links: LinkTarget[] = [], doc = render(text, pw, links);
    shown = { source: doc.source, text, w: pw, at: now, body: doc.lines, ranges: doc.links, links, pending: !!doc.pending, placements: doc.placements ?? [] };
    previewCache.set(d, shown);
  }
  const room = Math.max(0, h - 1);
  const cursorRow = aligned ? Math.max(0, (d.frame?.row ?? 1) + d.cursorRow - row - 1) : 0;
  const sourceRow = shown.source.findIndex(line => line >= d.row);
  const lead = aligned && sourceRow >= 0 ? Math.min(Math.max(0, room - 1), Math.max(0, cursorRow - sourceRow)) : 0;
  // Beside the draft, leave room below the last source line for alignment and manual scrolling.
  const body = [...pad0(lead), ...shown.body, ...pad0(aligned ? room - 1 : 0)], source = [...Array<number>(lead).fill(-1), ...shown.source];
  const last = Math.max(0, body.length - room);
  // Where the wheel put it (PIE-846), while the text is as it was then; else the part around the cursor's line.
  const scrolled = d.previewScroll?.text === text ? d.previewScroll : null;
  if (scrolled === null) d.previewScroll = null;
  const projected = new PositionRows({ ...d.position, view: { line: d.row + (scrolled?.lineDelta ?? 0), row: scrolled?.row ?? cursorRow } });
  projected.source = source;
  const at = Math.min(last, projected.top);
  // Its pictures (PIE-846) on the rows of the part shown, one column in as its text is.
  const placements = shown.placements.flatMap(p => { const q = inWindow({ ...p, row: p.row + lead }, at, room, row + 1); return q ? [{ ...q, col: q.col + col + 1 }] : []; });
  if (d.frame) d.frame.preview = { row, col, cols: w, rows: h, top: at, total: body.length, source, placements };
  if (d.frame) d.frame.links = shown.ranges.flatMap(r => {
    const target = shown.links[r.n];
    return target && r.line + lead >= at && r.line + lead < at + room ? [{ row: row + 1 + r.line + lead - at, from: col + 1 + r.from, to: col + 1 + r.to, target }] : [];
  });
  return [rule(w, "preview"), ...body.slice(at, at + room).map(l => " " + l)];
}

/**
 * A click (or the press of a drag) in the host's cells, over a draft drawn by `renderEditor`: on the
 * preview control it toggles the preview (a press, `on` left out, only finds it: the click runs it); on the insert control it runs the host's `pick` (its insert-from-a-picker
 * action); on the copy control it runs the host's `copy` (`draft.copy`, to the person's clipboard); on the text it
 * puts the cursor there (`extend`: a drag, selecting from where it was). All are actions. False when the click wasn't on any.
 */
export function editorClick(d: Draft, x: number, y: number, extend = false, actor: Actor = USER, on?: { pick?: () => void; copy?: () => void; place?: () => void; lands?: () => void; follow?: (to?: LinkTarget) => void }, mods = 0, preview = true): boolean {
  const f = d.frame;
  if (!f) return false;
  const ctl = !extend ? f.controls.find(c => c.row === y && x >= c.from && x < c.to) : undefined;
  // Without `on` it's a press: a control is hit, and its click (the release) runs it.
  if (ctl && !on) return true;
  // A link in the preview (PIE-592): its click follows it, beside the edit.
  const link = preview && !extend && !ctl ? f.links?.find(l => l.row === y && x >= l.from && x < l.to) : undefined;
  if (link) { if (on) on.follow?.(link.target); return true; }
  // An alt- or ctrl-click on a link in the text follows it too (ctrl+l's mouse way); the cursor goes there first.
  if (!extend && mods & (8 | 16) && on?.follow && y >= f.row && y < f.row + f.rows) {
    const p = d.posAt(x - f.col, y - f.row), follow = on.follow;
    if (d.linkAt(p.row, p.col)) { void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1 }, d, actor).then(() => follow()); return true; }
  }
  if (ctl?.action === "pick") { on?.pick?.(); return true; }
  if (ctl?.action === "copy") { on?.copy?.(); return true; }
  if (ctl?.action === "place") { on?.place?.(); return true; }
  if (ctl?.action === "lands") { on?.lands?.(); return true; }
  if (ctl) { void DRAFT_ACTIONS.run("draft.preview", {}, d, actor); return true; }
  // A press starts in the text (a click beside a box drawn over the note is the note's); a drag goes on wherever it is.
  if (!extend && (y < f.row || y >= f.row + f.rows || x < f.col - 1 || x > f.col + f.cols)) return false;
  const p = d.posAt(x - f.col, Math.max(0, Math.min(f.rows - 1, y - f.row)));
  void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1, extend }, d, actor);
  return true;
}

/** The keys line for a draft, the same words everywhere: `ctrl+s save · esc done · ctrl+x ctrl+e $EDITOR · …`. */
export function editHint(d: Draft, o: { save: "save" | "send" | "create"; reload?: string | null; close?: "done" | "back"; place?: string; move?: boolean; follow?: boolean }): string {
  if (completionOf(d)) return `${COMPLETION_HINT} · ctrl+s ${o.save}`;
  // The ways out first (a narrow hint row cuts the end), then the list keys and the preview.
  const last = d.undos.at(-1);
  const undo = last ? ` · ctrl+z undo${last.by.kind === "agent" ? ` ${patchLabel(last.by)}'s edit` : ""}` : "";
  return `ctrl+s ${o.save} · esc ${d.dirty ? "twice puts it aside" : o.close ?? "done"}${o.follow && d.linkAtCursor() ? " · ctrl+l open link" : ""}${undo}${o.place ? ` · ctrl+o ${o.place}` : ""}${o.move ? " · ctrl+g move" : ""}${d.redos.length ? " · ctrl+y redo" : ""}${d.selection() ? " · alt+c copy" : ""} · ctrl+x ctrl+e $EDITOR${o.reload ? ` · ctrl+r ${o.reload}` : ""} · ctrl+t insert · tab indent · shift+tab out · ctrl+p preview`;
}

/** A note draft's state, for its status line. */
export function draftState(d: Draft): string {
  return d.conflict ? fg(C.lred) + `! ${d.conflict}`
    : d.saving ? fg(C.grey) + "saving…"
    : d.previewing ? fg(C.grey) + "checking properties…"
    : d.changedElsewhere ? fg(C.yellow) + "!! changed elsewhere · saving checks it first"
    : d.dirty ? fg(C.yellow) + "unsaved" : fg(C.dark) + "no changes";
}

/**
 * The edit frame's "who typed this" line, saying what the save or send will record (null when only the
 * person typed). One writer: it is recorded as theirs whoever presses save. Several: as the saver's,
 * naming the others; a comment is then an agent's naming both, the only way the service can name both.
 */
export function writtenBy(d: Draft, verb: "save" | "send"): string | null {
  if (!d.writers.some(w => w.kind === "agent")) return null;
  const names = d.writers.map(w => (w.kind === "agent" ? agentLabel(w) : "you"));
  if (names.length === 1) return `${names[0]} typed this · it ${verb}s as the agent's`;
  const all = names.length > 2 ? "all" : "both";
  return `${names.join(" and ")} typed this · ${verb === "save" ? `saved as whoever saves it, naming ${all}` : `sent as the agent's, naming ${all}`}`;
}

export interface Suspender { suspend(run: (terminal: Handover) => Promise<unknown>, what?: string): Promise<void>; inTile?(p: TileProgram, done: (code: number | null) => void): boolean }

/**
 * Ctrl+E: the draft goes to $VISUAL/$EDITOR in a temp file and comes back, replacing the draft's text.
 * The base revision stays: the service still judges the save. Resolves once the draft is back.
 *
 * The editor's text is never dropped: when it can't go back into the draft (the editor failed or its terminal went,
 * the draft changed meanwhile from another terminal or an agent's patch, or nobody holds the draft any more: `held`
 * says whether its host still does), it's copied to disk (`drafts/`) and said.
 */
export function openInEditor(ctx: Suspender, d: Draft, held: () => boolean = () => true): Promise<void> {
  // In the door's state (edit/<pid>-…, private), not /tmp: if the door ends first, the file is copied to
  // drafts/ and said (keepEditFile), or, after a kill -9, by the next door (recoverEdits).
  const dir = mkdtempSync(join(stateSub("edit") ?? tmpdir(), `${process.pid}-`));
  const path = join(dir, `${d.blockId.slice(0, 8)}.md`);
  writeFileSync(path, d.text + "\n", { mode: 0o600 });
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  const sent = d.text;
  const back = (code: number | null) => {
    let text: string | null = null;
    try { text = readFileSync(path, "utf8"); } catch { /* the file went */ }
    const edited = text !== null && text.replace(/\n$/, "") !== sent;
    if (code === 0 && text !== null && d.text === sent && held()) {
      const before = d.text;
      d.replace(text);
      d.note = d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`;
      return;
    }
    const why = code !== 0 ? `${editor} exited ${code ?? "without a code (its terminal went)"}` : !held() ? "the draft was closed meanwhile" : "the draft changed while it was out";
    if (edited) d.note = `${why}: the draft is as it is here · ${editor}'s text is at ${keepCopy(text!, `${d.blockId.slice(0, 8)}-editor`)}`;
    else d.note = `${why}; the draft is unchanged`;
  };
  const tidyUp = () => rmSync(dir, { recursive: true, force: true });
  // Where the view has tiles, the editor runs in one beside the note (PIE-417); the draft comes back when it exits.
  if (ctx.inTile?.({ cmd: [...words(editor), path], file: path, name: "edit" }, c => { try { back(c); } finally { tidyUp(); } })) {
    d.note = `editing in ${editor} beside · the draft comes back when it exits`;
    return Promise.resolve();
  }
  // Else in the person's terminal (the door's own, or a session client's), the door stepping aside meanwhile.
  let code: number | null = null;
  return ctx.suspend(async terminal => { code = await (terminal ?? ownTerminal).run(["sh", "-c", `${editor} "$1"`, "sh", path]); }, "editor")
    .then(() => back(code), () => back(null))
    .finally(tidyUp);
}

/**
 * The door is ending while an editor still has a ctrl+e file open: its text is copied to drafts/ (the same
 * place and pruning as a draft's copy) and the file's folder removed. Returns where it went, or null.
 */
export function keepEditFile(path: string): string | null {
  try {
    if (!existsSync(path)) return null;
    return keepCopy(readFileSync(path, "utf8"), `${basename(path, ".md")}-editor`);
  } catch { return null; }
  finally { if (basename(dirname(path)).startsWith(`${process.pid}-`)) rmSync(dirname(path), { recursive: true, force: true }); }
}

/**
 * ctrl+e files left by doors that ended without copying them (kill -9, a power cut): each is copied to
 * drafts/ and its folder removed. A folder whose door still runs is left alone. Returns the copies.
 */
export function recoverEdits(alive: (pid: number) => boolean): string[] {
  const root = stateSub("edit");
  if (!root) return [];
  const kept: string[] = [];
  for (const d of readdirSync(root)) {
    const pid = Number(d.split("-")[0]);
    if (!pid || pid === process.pid || alive(pid)) continue;
    const dir = join(root, d);
    try {
      for (const f of readdirSync(dir).filter(f => f.endsWith(".md"))) kept.push(keepCopy(readFileSync(join(dir, f), "utf8"), `${basename(f, ".md")}-editor`));
      rmSync(dir, { recursive: true, force: true });
    } catch { /* the next door tries again */ }
  }
  return kept;
}

/** A query uses the same draft, with line breaks flattened at the input edge. */
export function editorLineKey(d: Draft, k: Key, copy: (text: string) => void): boolean {
  if (["enter", "esc", "tab", "backtab", "up", "down", "pgup", "pgdn", "mouse"].includes(k.kind)) return false;
  if (k.kind === "alt-backspace") k = { kind: "char", ch: "w", ctrl: true };
  if (k.kind === "char" && k.ctrl) {
    if (k.ch === "u") { d.splice(0, d.text.length, ""); return true; }
    if (k.ch === "w") {
      const selection = d.selection();
      const end = selection?.[1].col ?? d.col;
      const start = selection?.[0].col ?? wordEraseStart(d.text, end);
      d.splice(start, end, ""); return true;
    }
    if (k.ch === "x") {
      const text = d.selectedText();
      if (text) { copy(text); const selected = d.selection()!; d.splice(selected[0].col, selected[1].col, ""); }
      return true;
    }
  }
  const selected = d.selection();
  if (selected && (k.kind === "backspace" || k.kind === "delete")) {
    d.splice(selected[0].col, selected[1].col, ""); return true;
  }
  const input = k.kind === "paste" ? { ...k, text: k.text.replace(/[\r\n]+$/, "").replace(/\r\n?|\n|\t/g, " ") } : k;
  if (d.key(input) === "copy") { const text = d.selectedText(); if (text) copy(text); }
  return true;
}

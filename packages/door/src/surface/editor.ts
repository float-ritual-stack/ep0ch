import { draftView, type DraftFrame } from "../draft-view";
import { wordEraseStart } from "@ep0ch/outline-core/graphemes";
import type { StyleValues } from "@ep0ch/outline-core/style-cascade";
import { PositionRows } from "../reader-position";
// The one edit control: a Draft (src/edit.ts) drawn in the same frame, with the same keys and the same
// status line, wherever text is written — a note's whole text, a comment, a reply. Ctrl+E hands any of
// them to $VISUAL/$EDITOR and back through the same path.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DRAFT_ACTIONS, DRAFT_KEYS, keepCopy, patchLabel, type Draft } from "../edit";
import { USER, type Actor } from "../socket";
import { stateSub } from "../state";
import { drawEllipsized, C, fg, pad, RESET, visible, width, type LinkRange } from "../style";
import { inWindow, type Placement } from "../kitty";
import type { LinkTarget } from "../refs";
import { fitPaths, rowLines, rule, words } from "../text";
import { ownTerminal, type Handover, type TileExit, type TileProgram, type Key } from "../term";
import { agentLabel, declaredKeys, keyCaption } from "./actions";
import { modeHint, type ModeKey } from "./modes";
import { popupHint, completerOf, completionOf } from "./completer";
import { wordIn } from "./selection";

export interface EditFrame {
  look?: StyleValues;
  /** What is being written, after the `»`: "editing · <note>", "comment · <note>", "reply to x · <note>". */
  title: string;
  /** Status lines under the title (already coloured): revision and state, the last thing that happened. */
  status: string[];
  /** The draft's own status line first, drawn to the frame's width (PIE-1560): its state, and what it said (up to three rows). */
  draftStatus?: { state: boolean; said: string | null };
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
   * Open work the new item looks like (PIE-1258, the service's `roadmap.items.similar`): a row of its own under the
   * status, `looks like PIE-12 (doing) … [attach here] [file new]`, each a control. Never a block: ctrl+s files it new.
   */
  twin?: string;
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
  const pv = f.preview && w >= 40 ? (draftView(d).preview ? "[hide preview]" : "[preview]") : "";
  const pk = f.pick && w >= 56 ? "[insert]" : "";
  // With text selected, a [copy] control: the mouse's way to the draft's copy, wherever copy on select is off.
  const cp = d.selection() && w >= 32 ? "[copy]" : "";
  const pl = f.place && w >= 28 ? `[${f.place} ▸]` : "";
  const ctls = [...(cp ? [{ text: cp, action: "copy" as const }] : []), ...(pk ? [{ text: pk, action: "pick" as const }] : []), ...(pv ? [{ text: pv, action: "preview" as const }] : []), ...(pl ? [{ text: pl, action: "place" as const }] : [])];
  const cw = ctls.reduce((n, c) => n + c.text.length + 1, 0);
  const tw = Math.max(1, w - cw);
  const controls: DraftFrame["controls"] = [];
  let x = tw + 1;
  for (const c of ctls) { controls.push({ row: 0, from: x, to: x + c.text.length, action: c.action }); x += c.text.length + 1; }
  // Where a new note lands, under the status: the whole row is its control.
  // The destination gives way first, so [move ▸] is always there to see.
  const lands = f.lands ? (() => { const mv = "  [move ▸]", room = Math.max(1, w - mv.length), at = drawEllipsized(f.lands, room), t = `${at}${mv}`; controls.push({ row: 1 + f.status.length, from: 0, to: Math.min(w, width(t)), action: "lands" }); return [fg(C.lcyan) + pad(t, w) + RESET]; })() : [];
  const twin = f.twin ? (() => {
    const at = "[attach here]", nw = "[file new]", row = 1 + f.status.length + lands.length;
    // One row where the offer fits whole beside its controls; else the offer on its own row, its Work ID first, and the
    // controls whole under it (PIE-1439: at 40 columns the cut took the ticket it would attach to).
    const one = width(f.twin) + at.length + nw.length + 3 <= w;
    const said = one ? f.twin : drawEllipsized(f.twin, Math.max(1, w)), crow = one ? row : row + 1, x0 = one ? width(said) + 2 : 0;
    controls.push({ row: crow, from: x0, to: x0 + at.length, action: "attach" }, { row: crow, from: x0 + at.length + 1, to: x0 + at.length + 1 + nw.length, action: "file-new" });
    const ctl = fg(C.lcyan) + at + " " + nw + RESET;
    return one ? [fg(C.yellow) + said + "  " + ctl] : [fg(C.yellow) + said + RESET, ctl];
  })() : [];
  const top = [
    fg(C.yellow) + pad(`» ${f.title}`, tw) + ctls.map(c => " " + fg(C.lcyan) + c.text).join("") + RESET,
    ...(f.draftStatus?.state ? editState(d, w, "") : []),
    ...(f.draftStatus?.said ? saidRows(f.draftStatus.said, w, 3, C.yellow) : []),
    ...f.status,
    ...lands,
    ...twin,
    ...(f.by ? [fg(C.lmagenta) + pad(f.by, w) + RESET] : []),
    ...(f.context ?? []),
    rule(w),
  ];
  if (d.snippet) {
    let text = `slot ${d.snippet.index + 1}/${d.snippet.slots.length} `;
    for (const action of ["snippet.previous", "snippet.next", "snippet.end"] as const) {
      const from = width(text), chip = `[${action.slice("snippet.".length)}]`;
      controls.push({ row: top.length, from, to: from + width(chip), action });
      text += chip + " ";
    }
    top.push(fg(C.lcyan) + pad(text, w) + RESET);
  }
  const all = Math.max(1, h - top.length);
  // The preview takes the lower half, once there's room for both.
  const ph = f.preview && !f.attachedPreview && draftView(d).preview && all >= 6 ? Math.floor(all / 2) : 0;
  const room = all - ph;
  // A preview tile can paint before its source reader (for example, on the left).
  const attached = f.attachedPreview && draftView(d).preview ? { preview: draftView(d).frame?.preview, links: draftView(d).frame?.links } : {};
  draftView(d).frame = { row: top.length, col: 1, rows: room, cols: Math.max(1, w - 2), controls, ...attached };
  const below = ph ? previewRows(d, f.preview!, w, ph, top.length + room) : [];
  const pop = completionOf(d), c = completerOf(d);
  if (c) c.drawn = null;
  if (f.away) {
    const text = draftView(d).render(Math.max(1, w - 2), room).map(l => " " + fg(C.dark) + visible(l) + RESET);
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  if (!pop || !c) {
    const text = draftView(d).render(Math.max(1, w - 2), room).map(l => " " + l);
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  const text = draftView(d).render(Math.max(1, w - 2), room).map(l => " " + l);
  c.drawn = { row: top.length + draftView(d).cursorRow + 1, cols: w, anchor: 1 + draftView(d).cursorCol, items: [] };
  return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
}

/**
 * What the wheel at `x`, `y` (the host's cells) over a draft drawn by renderEditor scrolls (PIE-846): its preview when
 * the pointer is over the preview, its text when over the text, else null (the host's own: the note around a comment).
 */
/** What the draft says, on up to `rows` rows at `w`, a path in it shortened to its file rather than cut (PIE-1560). */
export function saidRows(said: string, w: number, rows: number, colour: number): string[] {
  return rowLines(fitPaths(said, w * rows, w), w, rows).map(l => fg(colour) + pad(l, w) + RESET);
}

export function wheelTarget(d: Draft, x: number, y: number): "text" | "preview" | null {
  const f = draftView(d).frame;
  if (!f) return null;
  if (f.preview && x >= f.preview.col && x < f.preview.col + f.preview.cols && y >= f.preview.row && y < f.preview.row + f.preview.rows) return "preview";
  if (x < f.col - 1 || x > f.col + f.cols) return null;
  return y >= f.row && y < f.row + f.rows ? "text" : null;
}

/** Empty rows, so the preview under the text stays put while the text is short. */
const pad0 = (n: number) => Array.from({ length: Math.max(0, n) }, () => "");

/**
 * The preview's rows: a labelled rule, then the rendered draft, the part around the cursor's line. Its links are kept on
 * the frame where they're drawn (from row `row`), so a click on one follows it (PIE-592).
 */
export function previewRows(d: Draft, render: NonNullable<EditFrame["preview"]>, w: number, h: number, row: number, col = 0, aligned = false): string[] {
  // Drawn again only when the text or width changed (a cursor move, a wheel or a blink repaints it for free),
  // after a moment, for link titles that arrived since, and while an embed in it is being read (PIE-852).
  const text = d.text, pw = Math.max(1, w - 2), hit = d.views.preview, now = Date.now();
  let shown = hit && hit.text === text && hit.w === pw && now - hit.at < 2000 && !hit.pending ? hit : null;
  if (!shown) {
    const links: LinkTarget[] = [], doc = render(text, pw, links);
    shown = { source: doc.source, text, w: pw, at: now, body: doc.lines, ranges: doc.links, links, pending: !!doc.pending, placements: doc.placements ?? [] };
    d.views.preview = shown;
  }
  const room = Math.max(0, h - 1);
  const cursorRow = aligned ? Math.max(0, (draftView(d).frame?.row ?? 1) + draftView(d).cursorRow - row - 1) : 0;
  const sourceRow = shown.source.findIndex(line => line >= d.row);
  const lead = aligned && sourceRow >= 0 ? Math.min(Math.max(0, room - 1), Math.max(0, cursorRow - sourceRow)) : 0;
  // Beside the draft, leave room below the last source line for alignment and manual scrolling.
  const body = [...pad0(lead), ...shown.body, ...pad0(aligned ? room - 1 : 0)], source = [...Array<number>(lead).fill(-1), ...shown.source];
  const last = Math.max(0, body.length - room);
  // Where the wheel put it (PIE-846), while the text is as it was then; else the part around the cursor's line.
  const scrolled = draftView(d).previewScroll?.text === text ? draftView(d).previewScroll : null;
  if (scrolled === null) draftView(d).previewScroll = null;
  const projected = new PositionRows({ ...d.position, view: { line: d.row + (scrolled?.lineDelta ?? 0), row: scrolled?.row ?? cursorRow } });
  projected.source = source;
  const at = Math.min(last, projected.top);
  // Its pictures (PIE-846) on the rows of the part shown, one column in as its text is.
  const placements = shown.placements.flatMap(p => { const q = inWindow({ ...p, row: p.row + lead }, at, room, row + 1); return q ? [{ ...q, col: q.col + col + 1 }] : []; });
  const fr = draftView(d).frame;
  if (fr) fr.preview = { row, col, cols: w, rows: h, top: at, total: body.length, source, placements };
  if (fr) fr.links = shown.ranges.flatMap(r => {
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
export function editorClick(d: Draft, x: number, y: number, extend = false, actor: Actor = USER, on?: { pick?: () => void; copy?: () => void; place?: () => void; lands?: () => void; attach?: () => void; fileNew?: () => void; follow?: (to?: LinkTarget) => void }, mods = 0, preview = true): boolean {
  const f = draftView(d).frame;
  if (!f) return false;
  const ctl = !extend ? f.controls.find(c => c.row === y && x >= c.from && x < c.to) : undefined;
  // Without `on` it's a press: a control is hit, and its click (the release) runs it.
  if (ctl && !on) return true;
  if (ctl && (ctl.action === "snippet.next" || ctl.action === "snippet.previous" || ctl.action === "snippet.end")) {
    void DRAFT_ACTIONS.run(ctl.action, {}, d, actor); return true;
  }
  // A link in the preview (PIE-592): its click follows it, beside the edit.
  const link = preview && !extend && !ctl ? f.links?.find(l => l.row === y && x >= l.from && x < l.to) : undefined;
  if (link) { if (on) on.follow?.(link.target); return true; }
  // An alt- or ctrl-click on a link in the text follows it too (ctrl+l's mouse way); the cursor goes there first.
  if (!extend && mods & (8 | 16) && on?.follow && y >= f.row && y < f.row + f.rows) {
    const p = draftView(d).posAt(x - f.col, y - f.row), follow = on.follow;
    if (d.linkAt(p.row, p.col)) { void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1 }, d, actor).then(() => follow()); return true; }
  }
  if (ctl?.action === "pick") { on?.pick?.(); return true; }
  if (ctl?.action === "copy") { on?.copy?.(); return true; }
  if (ctl?.action === "place") { on?.place?.(); return true; }
  if (ctl?.action === "lands") { on?.lands?.(); return true; }
  if (ctl?.action === "attach") { on?.attach?.(); return true; }
  if (ctl?.action === "file-new") { on?.fileNew?.(); return true; }
  if (ctl) { void DRAFT_ACTIONS.run("draft.preview", {}, d, actor); return true; }
  // A press starts in the text (a click beside a box drawn over the note is the note's); a drag goes on wherever it is.
  if (!extend && (y < f.row || y >= f.row + f.rows || x < f.col - 1 || x > f.col + f.cols)) return false;
  const p = draftView(d).posAt(x - f.col, Math.max(0, Math.min(f.rows - 1, y - f.row)));
  void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1, extend }, d, actor);
  return true;
}

/**
 * A double click's word (the one word rule, `wordIn`: by grapheme) or a triple click's line at the draft's cursor,
 * selected by two draft.place as a drag would (PIE-1542). Every field's multi-click is this: the reader's edit, a comment
 * in its tile, the board's composer, an inspector field. `run` is the host's way to run a draft action (attributed).
 */
export async function selectClicks(d: Draft, n: number, run: (name: string, args: Record<string, unknown>) => Promise<unknown> = (name, args) => DRAFT_ACTIONS.run(name as never, args as never, d, USER)): Promise<void> {
  if (n < 2) return;
  const line = d.lines[d.row] ?? "", span = n === 2 ? wordIn(line, d.col) : { start: 0, end: line.length };
  if (span.start === span.end) return;
  await run("draft.place", { line: d.row + 1, col: span.start + 1 });
  await run("draft.place", { line: d.row + 1, col: span.end + 1, extend: true });
}

/** A draft's keys as a hint row: each row names the action its key runs (the draft's own keys, edit.ts), drawn the way every mode's are. */
const draftKeys = (rows: readonly ModeKey[]): string => modeHint(rows, () => undefined);

/** The keys line for a draft, the same words everywhere: `ctrl+s save · esc done · ctrl+x ctrl+e $EDITOR · …`. */
export function editHint(d: Draft, o: { save: "save" | "send" | "create"; reload?: string | null; close?: "done" | "back"; place?: string; move?: boolean; follow?: boolean }): string {
  const pop = completionOf(d);
  if (pop) return `${popupHint(pop)} · ${draftKeys([{ key: "ctrl+s", action: "edit.save", label: o.save }])}`;
  if (d.snippet) return `slot ${d.snippet.index + 1}/${d.snippet.slots.length} · ` +
    (["snippet.next", "snippet.previous", "snippet.end", "draft.undo"] as const).map(name => {
      const action = DRAFT_ACTIONS.def(name)!;
      return `${keyCaption([...declaredKeys(action.keys)][0]!)} ${name.split(".")[1]}`;
    }).join(" · ");
  // The ways out first (a narrow hint row cuts the end), then the list keys and the preview. A key the table holds is
  // its built-in one here; the hint applies the keymap (modeHint's `effective`), so a rebind shows and an unbound one drops.
  const last = d.undos.at(-1);
  const row = (key: string, action: string, label: string): ModeKey[] => [{ key, action, label }];
  const bound = (action: string, label: string): ModeKey[] => { const r = DRAFT_KEYS.find(x => x.action === action); return r ? row(r.key, action, label) : []; };
  return draftKeys([
    ...bound("edit.save", o.save), ...row("esc", "edit.close", d.dirty ? "twice puts it aside" : o.close ?? "done"),
    ...(o.follow && d.linkAtCursor() ? bound("edit.follow", "open link") : []),
    ...(last ? bound("draft.undo", `undo${last.saved !== undefined ? " (asks: saved)" : last.by.kind === "agent" ? ` ${patchLabel(last.by)}'s edit` : ""}`) : []),
    ...(o.place ? row("ctrl+o", "draft.place", o.place) : []), ...(o.move ? row("ctrl+g", "comment.grip", "move") : []),
    ...(d.redos.length ? bound("draft.redo", "redo") : []), ...(d.selection() ? bound("draft.copy", "copy") : []),
    ...row("ctrl+x ctrl+e", "edit.external", "$EDITOR"), ...(o.reload ? bound("edit.reload", o.reload) : []),
    ...bound("draft.pick", "insert"), ...row("tab", "draft.indent", "indent"), ...row("shift+tab", "draft.outdent", "out"), ...bound("draft.preview", "preview"),
  ]);
}

/** A note draft's state, for its status line. */
export function draftState(d: Draft): string { return d.status.state(d.dirty); }

/**
 * An edit's state under its title, one row (an agent's patch or a status never moves the text down): `rev N · ` and the
 * state's words, its short form when they don't fit, so "not saved" is never what a cut takes (PIE-1560).
 */
export function editState(d: Draft, w: number, head = `rev ${d.base} · `): string[] {
  const st = d.status.stateParts(d.dirty);
  const words = width(head + st.words) <= w ? st.words : st.short;
  if (width(head) + 4 > w) return [fg(st.colour) + pad(drawEllipsized(words, w), w) + RESET];
  return [fg(C.brown) + head + fg(st.colour) + pad(drawEllipsized(words, Math.max(1, w - width(head))), Math.max(1, w - width(head))) + RESET];
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

export interface Suspender { suspend(run: (terminal: Handover) => Promise<unknown>, what?: string): Promise<void>; inTile?(p: TileProgram, done: TileExit): boolean }

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
      d.status.say(d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`);
      return;
    }
    const why = code !== 0 ? `${editor} exited ${code ?? "without a code (its terminal went)"}` : !held() ? "the draft was closed meanwhile" : "the draft changed while it was out";
    if (edited) d.status.say(`${why}: the draft is as it is here · ${editor}'s text is at ${keepCopy(text!, `${d.blockId.slice(0, 8)}-editor`)}`);
    else d.status.say(`${why}; the draft is unchanged`);
  };
  const tidyUp = () => rmSync(dir, { recursive: true, force: true });
  // Where the view has tiles, the editor runs in one beside the note (PIE-417); the draft comes back when it exits.
  if (ctx.inTile?.({ cmd: [...words(editor), path], file: path, name: "edit" }, c => { try { back(c); } finally { tidyUp(); } })) {
    d.status.say(`editing in ${editor} beside · the draft comes back when it exits`);
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

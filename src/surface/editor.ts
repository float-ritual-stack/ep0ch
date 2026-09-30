// The one edit control: a Draft (src/edit.ts) drawn in the same frame, with the same keys and the same
// status line, wherever text is written — a note's whole text, a comment, a reply. Ctrl+E hands any of
// them to $VISUAL/$EDITOR and back through the same path.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DRAFT_ACTIONS, keepCopy, patchLabel, type Draft } from "../edit";
import { USER, type Actor } from "../socket";
import { stateSub } from "../state";
import { C, fg, pad, RESET } from "../style";
import { rule } from "../text";
import { agentLabel } from "./actions";
import { COMPLETION_HINT, COMPLETION_ROWS, completerOf, completionOf, renderCompletion } from "./completer";

export interface EditFrame {
  /** What is being written, after the `»`: "editing · <note>", "comment · <note>", "reply to x · <note>". */
  title: string;
  /** Status lines under the title (already coloured): revision and state, the last thing that happened. */
  status: string[];
  /** Context between the status and the text, such as the quoted passage. */
  context?: string[];
  /** Who else typed into this draft (an agent), shown so it is never silent. */
  by?: string | null;
  /**
   * The host's reader renderer for a live preview of the draft (`draftPreview` in the note surface: the
   * same body renderer every reader uses). With it the frame offers the preview (ctrl+p, or its control).
   */
  preview?: (text: string, w: number) => string[];
}

/**
 * The frame every draft is drawn in: title, status, context, a rule, then the text with its cursor, and the
 * preview under it when it's on. Where the text and the controls landed is kept on the draft (`d.frame`),
 * so a click in the host's cells finds them (`editorClick`).
 */
export function renderEditor(d: Draft, f: EditFrame, w: number, h: number): string[] {
  // The control, where there's room for it beside the title (a narrow river column has ctrl+p).
  const ctl = f.preview && w >= 40 ? (d.preview ? "[hide preview]" : "[preview]") : "";
  const tw = Math.max(1, w - (ctl ? ctl.length + 1 : 0));
  const top = [
    fg(C.yellow) + pad(`» ${f.title}`, tw) + (ctl ? " " + fg(C.lcyan) + ctl : "") + RESET,
    ...f.status,
    ...(f.by ? [fg(C.lmagenta) + pad(f.by, w) + RESET] : []),
    ...(f.context ?? []),
    rule(w),
  ];
  const all = Math.max(1, h - top.length);
  // The preview takes the lower half, once there's room for both.
  const ph = f.preview && d.preview && all >= 6 ? Math.floor(all / 2) : 0;
  const room = all - ph;
  d.frame = { row: top.length, col: 1, rows: room, controls: ctl ? [{ row: 0, from: tw + 1, to: tw + 1 + ctl.length, action: "preview" }] : [] };
  const below = ph ? previewRows(d, f.preview!, w, ph) : [];
  const pop = completionOf(d), c = completerOf(d);
  if (c) c.drawn = null;
  if (!pop || !c) {
    const text = d.render(Math.max(1, w - 2), room).map(l => " " + l);
    return [...top, ...text, ...(below.length ? pad0(room - text.length) : []), ...below];
  }
  // The completion popup opens under the cursor's row; the draft gives up that many rows to keep it.
  const cph = Math.min(COMPLETION_ROWS, Math.max(0, room - 1));
  const text = d.render(Math.max(1, w - 2), Math.max(1, room - cph)).map(l => " " + l);
  const at = Math.min(text.length, d.cursorRow + 1), rows: (number | null)[] = [];
  const popup = renderCompletion(pop, w, cph, rows);
  // Where it went, so a click on a candidate can choose it (NoteSurface.click).
  c.drawn = { row: top.length + at, items: rows.slice(0, Math.max(0, room - at)) };
  const mid = [...text.slice(0, at), ...popup, ...text.slice(at)].slice(0, room);
  return [...top, ...mid, ...(below.length ? pad0(room - mid.length) : []), ...below];
}

/** Empty rows, so the preview under the text stays put while the text is short. */
const pad0 = (n: number) => Array.from({ length: Math.max(0, n) }, () => "");

const previewCache = new WeakMap<Draft, { text: string; w: number; at: number; body: string[] }>();

/** The preview's rows: a labelled rule, then the rendered draft, the part around the cursor's line. */
function previewRows(d: Draft, render: (text: string, w: number) => string[], w: number, h: number): string[] {
  // Drawn again only when the text or width changed (a cursor move, a wheel or a blink repaints it for free),
  // or after a moment, for link titles that arrived since.
  const text = d.text, pw = Math.max(1, w - 2), hit = previewCache.get(d), now = Date.now();
  const body = hit && hit.text === text && hit.w === pw && now - hit.at < 2000 ? hit.body : render(text, pw);
  if (body !== hit?.body) previewCache.set(d, { text, w: pw, at: now, body });
  const room = Math.max(0, h - 1);
  const at = d.lines.length > 1 ? Math.round((d.row / (d.lines.length - 1)) * Math.max(0, body.length - room)) : 0;
  return [rule(w, "preview · ctrl+p hides"), ...body.slice(at, at + room).map(l => " " + l)];
}

/**
 * A click (or the press of a drag) in the host's cells, over a draft drawn by `renderEditor`: on the
 * preview control it toggles the preview; on the text it puts the cursor there (`extend`: a drag, selecting
 * from where it was). Both are the draft's actions. False when the click wasn't on either.
 */
export function editorClick(d: Draft, x: number, y: number, extend = false, actor: Actor = USER): boolean {
  const f = d.frame;
  if (!f) return false;
  const ctl = !extend ? f.controls.find(c => c.row === y && x >= c.from && x < c.to) : undefined;
  if (ctl) { void DRAFT_ACTIONS.run("draft.preview", {}, d, actor); return true; }
  if (!extend && (y < f.row || y >= f.row + f.rows)) return false;
  const p = d.posAt(x - f.col, Math.max(0, Math.min(f.rows - 1, y - f.row)));
  void DRAFT_ACTIONS.run("draft.place", { line: p.row + 1, col: p.col + 1, extend }, d, actor);
  return true;
}

/** The keys line for a draft, the same words everywhere: `ctrl+s save · ctrl+e $EDITOR · … · esc done`. */
export function editHint(d: Draft, o: { save: "save" | "send"; reload?: string | null; close?: "done" | "back" }): string {
  if (completionOf(d)) return `${COMPLETION_HINT} · ctrl+s ${o.save}`;
  // The ways out first (a narrow hint row cuts the end), then the list keys and the preview.
  const last = d.patches.at(-1);
  return `ctrl+s ${o.save} · esc ${d.dirty ? "twice puts it aside" : o.close ?? "done"}${last ? ` · ctrl+z undo ${patchLabel(last.by)}'s edit` : ""} · ctrl+e $EDITOR${o.reload ? ` · ctrl+r ${o.reload}` : ""} · tab indent · shift+tab out · ctrl+p preview`;
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

export interface Suspender { suspend(run: () => void): void; editInTile?(path: string, cmd: string, done: (code: number | null) => void): boolean }

/**
 * Ctrl+E: the draft goes to $VISUAL/$EDITOR in a temp file and comes back, replacing the draft's text.
 * The base revision stays: the service still judges the save.
 */
export function openInEditor(ctx: Suspender, d: Draft): void {
  // In the door's state (edit/<pid>-…, private), not /tmp: if the door ends first, the file is copied to
  // drafts/ and said (keepEditFile), or, after a kill -9, by the next door (recoverEdits).
  const dir = mkdtempSync(join(stateSub("edit") ?? tmpdir(), `${process.pid}-`));
  const path = join(dir, `${d.blockId.slice(0, 8)}.md`);
  writeFileSync(path, d.text + "\n", { mode: 0o600 });
  const editor = process.env.VISUAL || process.env.EDITOR || "vi";
  // Where the view has tiles, the editor runs in one beside the note (PIE-417); the draft comes back when it exits.
  if (ctx.editInTile?.(path, editor, c => { try { back(c); } finally { rmSync(dir, { recursive: true, force: true }); } })) {
    d.note = `editing in ${editor} beside · the draft comes back when it exits`;
    return;
  }
  function back(code: number | null) {
    if (code !== 0) d.note = `${editor} exited ${code}; the draft is unchanged`;
    else {
      const before = d.text;
      d.replace(readFileSync(path, "utf8"));
      d.note = d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`;
    }
  }
  let code: number | null = null;
  try {
    ctx.suspend(() => {
      code = Bun.spawnSync(["sh", "-c", `${editor} "$1"`, "sh", path], { stdio: ["inherit", "inherit", "inherit"] }).exitCode;
    });
    if (code !== 0) d.note = `${editor} exited ${code}; the draft is unchanged`;
    else {
      const before = d.text;
      d.replace(readFileSync(path, "utf8"));
      d.note = d.text === before ? `no changes from ${editor}` : `back from ${editor} · ctrl+s saves`;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
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

// Comments from a reader (EPD-004): pick a passage of the note's source, write a comment on it, reply to
// a thread, resolve or reopen one. The service owns the rules: a comment names the note's revision and
// an exact quote with its offset, so a stale or moved passage is refused, never guessed at; every comment
// and reply carries a requestId, reused on retry, so a send whose answer was lost can't land twice.
import { scrolled, wheelRows } from "./scroll";
import type { Msg } from "./board";
import type { Draft } from "./edit";
import { commentTarget, DraftSession, Outgoing, type CommentWhere } from "./draft-session";
import { editHint, renderEditor, writtenBy } from "./surface/editor";
import type { Completer } from "./surface/completer";
import { USER, type Actor, type Comment, type CommentPassage, type SocketBoard } from "./socket";
import { bg, C, chip, fg, pad, RESET } from "./style";
import type { Key } from "./term";
import { ago, rule, wrap } from "./text";

const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");
/** CP437-safe marks, so snapshots and real VGA-font terminals draw them. */
const MARK = "▐", OPEN = "■", DONE = "·";

// ── passage selection ─────────────────────────────────────────────────────────

/**
 * A selection over the note's source text (subject line, body and properties, exactly as stored), so
 * the quote the service receives is always a real substring at a known offset. The reader's rendered
 * view drops and restyles text, so a selection made there couldn't promise that.
 */
export class Passage {
  readonly lines: string[];
  private readonly starts: number[] = [];
  private readonly words: { start: number; end: number }[];
  /** The selection, [from, to) in UTF-16 offsets of `text`. */
  from = 0;
  to = 0;
  private top = 0;
  note = "";

  constructor(readonly text: string, at?: { from: number; to: number }) {
    this.lines = text.split("\n");
    let o = 0;
    for (const l of this.lines) { this.starts.push(o); o += l.length + 1; }
    this.words = [...text.matchAll(/\S+/g)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
    if (at && at.from >= 0 && at.to <= text.length && at.from < at.to) { this.from = at.from; this.to = at.to; }
    else this.selectLine(this.nextFilled(0, 1) ?? this.nextFilled(0, 0) ?? 0);
  }

  get quote() { return this.text.slice(this.from, this.to); }

  /**
   * Select an exact quote of the source text, the way an agent picks a passage: the occurrence nearest
   * `near` (an offset), or the first. Returns why not when the words aren't there, or match only blanks.
   */
  selectText(quote: string, near?: number): string | null {
    if (!quote.trim()) return "the quote is empty";
    const hits: number[] = [];
    for (let i = this.text.indexOf(quote); i >= 0; i = this.text.indexOf(quote, i + 1)) hits.push(i);
    if (!hits.length) return `"${quote.length > 40 ? quote.slice(0, 39) + "…" : quote}" isn't in the note's current text`;
    const at = near === undefined ? hits[0]! : hits.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
    this.from = at; this.to = at + quote.length;
    return null;
  }
  get passage(): CommentPassage { return { quote: this.quote, start: this.from }; }
  get firstLine() { return this.lineOf(this.from); }
  get lastLine() { return this.lineOf(Math.max(this.from, this.to - 1)); }

  lineOf(off: number): number {
    let i = 0;
    while (i + 1 < this.starts.length && this.starts[i + 1]! <= off) i++;
    return i;
  }

  /** The whole line without its surrounding blanks. */
  private span(i: number) {
    const l = this.lines[i]!, s = this.starts[i]!;
    const lead = l.length - l.trimStart().length;
    return { from: s + lead, to: s + l.trimEnd().length };
  }
  private selectLine(i: number) { const s = this.span(i); this.from = s.from; this.to = s.to; }
  /** The next line (from `i + step`, walking by `step`) that has any text; step 0 checks `i` only. */
  private nextFilled(i: number, step: number): number | null {
    for (let j = i + step; j >= 0 && j < this.lines.length; j += step || this.lines.length) if (this.lines[j]!.trim()) return j;
    return null;
  }

  key(k: Key): "keep" | "compose" | "close" {
    const c = ch(k);
    this.note = "";
    if (k.kind === "esc") return "close";
    if (k.kind === "enter") {
      if (!this.quote.trim()) { this.note = "nothing selected: move to a line with text"; return "keep"; }
      return "compose";
    }
    const move = (d: number) => { const j = this.nextFilled(d > 0 ? this.lastLine : this.firstLine, d); if (j !== null) this.selectLine(j); };
    if (k.kind === "down" || c === "j") move(1);
    else if (k.kind === "up" || c === "k") move(-1);
    else if (k.kind === "pgdn") for (let i = 0; i < 10; i++) move(1);
    else if (k.kind === "pgup") for (let i = 0; i < 10; i++) move(-1);
    else if (c === "J") { const j = this.nextFilled(this.lastLine, 1); if (j !== null) this.to = this.span(j).to; }
    else if (c === "K") {
      const j = this.nextFilled(this.lastLine, -1);
      if (j !== null && j >= this.firstLine) this.to = Math.max(this.span(j).to, this.from + 1);
    }
    // Word steps: h/l move where the quote starts, H/L where it ends. The quote never gets empty.
    else if (k.kind === "right" || c === "l") { const w = this.words.find(w => w.start > this.from && w.start < this.to); if (w) this.from = w.start; }
    else if (k.kind === "left" || c === "h") { const w = this.words.findLast(w => w.start < this.from); if (w) this.from = w.start; }
    else if (c === "L") { const w = this.words.find(w => w.end > this.to); if (w) this.to = w.end; }
    else if (c === "H") { const w = this.words.findLast(w => w.end < this.to && w.end > this.from); if (w) this.to = w.end; }
    return "keep";
  }

  /** Source lines, soft-wrapped, the selection highlighted, a gutter mark where comments are anchored. */
  render(w: number, h: number, comments: Comment[] = []): string[] {
    const w1 = Math.max(4, w - 2);
    const out: string[] = [];
    let selTop = -1, selBottom = -1;
    const HI = chip(C.cyan, C.black), LO = fg(C.grey);
    this.lines.forEach((line, i) => {
      const s = this.starts[i]!, e = s + line.length;
      const onLine = comments.filter(c => c.start !== null && c.end !== null && c.start < Math.max(e, s + 1) && c.end > s);
      const gutter = onLine.some(c => c.open) ? fg(C.yellow) + MARK : onLine.length ? fg(C.dark) + MARK : " ";
      // Code points with their UTF-16 offsets, so highlighting matches the offsets the service gets.
      const cps: { c: string; off: number }[] = [];
      for (let j = 0; j < line.length;) { const cp = String.fromCodePoint(line.codePointAt(j)!); cps.push({ c: cp, off: s + j }); j += cp.length; }
      const rows = Math.max(1, Math.ceil(cps.length / w1));
      for (let r = 0; r < rows; r++) {
        const seg = cps.slice(r * w1, (r + 1) * w1);
        let str = "", inSel = false, touched = false;
        for (const x of seg) {
          const sel = x.off >= this.from && x.off < this.to;
          if (sel !== inSel || !str) { str += RESET + (sel ? HI : LO); inSel = sel; }
          if (sel) touched = true;
          str += x.c;
        }
        // An empty line inside a multi-line selection still shows as selected.
        if (!seg.length && s >= this.from && s < this.to) { str += HI + " "; touched = true; }
        if (touched) { if (selTop < 0) selTop = out.length; selBottom = out.length; }
        out.push((r === 0 ? gutter : " ") + RESET + " " + str + RESET);
      }
    });
    if (selTop >= 0) {
      if (selTop < this.top) this.top = selTop;
      if (selBottom >= this.top + h) this.top = Math.min(selTop, selBottom - h + 1);
    }
    this.top = Math.max(0, Math.min(this.top, Math.max(0, out.length - h)));
    return out.slice(this.top, this.top + h);
  }
}

// One requestId per thing the person means to send: the comment adapter's (src/draft-session.ts).
export { Outgoing };

// ── the session a reader holds while commenting ───────────────────────────────

export interface CommentEnv {
  board: Pick<SocketBoard, "comment" | "reply" | "setLifecycle">;
  fetch(id: string): Promise<Msg | null>;
  /** The reader shows the note as the service has it now. */
  setMsg(m: Msg): void;
  reloadComments(): Promise<Comment[]>;
  external(d: Draft): void;
  /** The composer's reference completion, when the connection can look references up. */
  complete?(d: Draft): Completer | null;
  /** Who sends what this session writes: the person at the keys unless an agent is acting. */
  actor?: Actor;
  flash(msg: string): void;
  redraw(): void;
}

type Target = CommentWhere;

export type CommentMode = "select" | "compose" | "threads";

export class CommentSession {
  mode: CommentMode;
  passage: Passage | null = null;
  /** The comment or reply being written: a draft session with the comment adapter (src/draft-session.ts). */
  writing: DraftSession | null = null;
  target: Target | null = null;
  sel = 0;
  busy: string | null = null;
  error: string | null = null;
  note = "";
  /** The last refusal was about the note moving on, so ctrl+r can find the quote again. */
  private stale = false;
  private readonly out = new Outgoing();
  /** The reader's environment, as the last key or send gave it (the adapter sends through its board). */
  private env: CommentEnv | null = null;
  private top = 0;
  /** The person scrolled the list themselves (wheel, PgUp/PgDn): the view stops following the selection until j or k. */
  private free = false;
  private room = 10;
  /** The last top that still fills the list (from the last render). */
  private maxTop = Infinity;
  /** Where Esc from the composer goes back to. */
  private back: CommentMode = "threads";
  /** The mode the session opened in; Esc there closes it. */
  private readonly origin: CommentMode;
  /**
   * A reply started from a thread expanded in the reader (PIE-420's Reply control): Esc from the composer
   * closes the session, and so does a reply that landed, so the person is back reading the note, the thread
   * still open under its passage. `finished` says the reply landed; the reader lets the session go.
   */
  inline = false;
  finished = false;

  constructor(public msg: Msg, public threads: Comment[], mode: "select" | "threads") {
    this.mode = this.origin = mode;
    if (mode === "select") this.passage = new Passage(msg.text);
  }

  get blockId() { return this.msg.id; }
  /** The text being written (the writing session's draft). */
  get composer(): Draft | null { return this.writing?.draft ?? null; }
  get dirty() { return !!this.composer?.dirty; }
  get requestId() { return this.out.requestId; }

  hint(): string {
    if (this.busy) return this.busy;
    if (this.mode === "select") return "j k line · J K extend · h l start · H L end · enter write · esc back";
    if (this.mode === "compose" && this.composer) return editHint(this.composer, { save: "send", reload: this.stale ? "find quote" : null, close: "back" });
    return "j k thread · PgUp PgDn or wheel scroll · r reply · x resolve/reopen · C comment on a passage · esc done";
  }

  /** The wheel over the thread list scrolls it (a long comment reads whole); j or k follows the selection again. */
  wheel(dir: 1 | -1) {
    if (this.mode !== "threads") return;
    this.top = scrolled(this.top, wheelRows(dir), this.maxTop); this.free = true;
  }

  key(k: Key, env: CommentEnv): "keep" | "close" {
    if (this.busy || k.kind === "mouse") return "keep";
    if (this.mode === "select") {
      const a = this.passage!.key(k);
      if (a === "close") {
        if (this.origin === "select" && !this.composer) return "close";
        this.passage = null; this.mode = this.composer ? "compose" : "threads";
      } else if (a === "compose") this.write();
      return "keep";
    }
    if (this.mode === "compose") {
      const w = this.writing!, d = w.draft;
      let out: "keep" | "close" = "keep";
      this.env = env;
      w.key(k, {
        completer: env.complete?.(d) ?? null,
        run: cmd => {
          if (cmd === "save") void this.send(env);
          else if (cmd === "editor") env.external(d);
          else if (cmd === "reload") void this.relocate(env);
          else if (cmd === "close" || cmd === "discard") {
            // Esc on nothing typed goes back; the second esc on typed text puts it aside as unsent (its session's).
            w.close(cmd === "discard");
            this.writing = null; this.target = null; this.error = null; this.note = ""; this.out.done();
            if (this.inline) out = "close";
            else if (this.back === "select" && this.passage) this.mode = "select";
            else if (this.origin === "select" && !this.threads.length) out = "close";
            else this.mode = "threads";
          }
        },
      });
      return out;
    }
    // threads
    const c = ch(k), n = this.threads.length;
    this.error = null;
    if (k.kind === "esc") return "close";
    if (k.kind === "pgdn" || k.kind === "pgup") { this.top = scrolled(this.top, (k.kind === "pgdn" ? 1 : -1) * Math.max(1, this.room - 1), this.maxTop); this.free = true; return "keep"; }
    if (k.kind === "down" || c === "j") { this.sel = Math.min(Math.max(0, n - 1), this.sel + 1); this.free = false; }
    else if (k.kind === "up" || c === "k") { this.sel = Math.max(0, this.sel - 1); this.free = false; }
    else if ((c === "r" || k.kind === "enter") && this.threads[this.sel]) this.replyTo(this.sel);
    else if (c === "x" && this.threads[this.sel]) void this.toggle(env);
    else if (c === "C") void this.pick(env);
    return "keep";
  }

  /** Enter on a picked passage: write the comment under it. The comment's text carries over from an earlier pick. */
  write(by: Actor = USER): string | null {
    const p = this.passage;
    if (this.mode !== "select" || !p) return "no passage is being picked";
    if (!p.quote.trim()) return "nothing selected";
    this.target = { kind: "quote", blockId: this.msg.id, revision: this.msg.revision!, passage: p.passage };
    // A comment put aside on this note (esc twice, a closed screen) comes back under the new passage; an
    // agent's comment is its own, and the person's put-aside text stays put aside (DraftSession.open).
    if (!this.writing) this.writing = this.open(by);
    this.back = "select"; this.mode = "compose"; this.error = null; this.stale = false;
    return null;
  }

  /** `r` on a thread: write a reply to it. */
  replyTo(i: number, by: Actor = USER): string | null {
    const t = this.threads[i];
    if (!t) return "no such thread";
    this.sel = i;
    this.target = { kind: "reply", thread: t };
    this.writing = this.open(by);
    this.back = "threads"; this.mode = "compose"; this.note = "";
    return null;
  }

  /** A draft session for the comment or reply `target` names, sent by the comment adapter. */
  private open(by: Actor): DraftSession {
    return DraftSession.open(commentTarget({
      where: () => this.target!,
      note: this.msg,
      board: () => this.env!.board,
      out: this.out,
      landed: (r, t) => this.landed(r, t),
      refused: (why, stale) => { this.busy = null; this.error = why; this.stale = stale; },
      relocate: () => this.relocate(this.env!),
    }), { by });
  }

  /** Select a passage on the note as the service has it now. */
  async pick(env: CommentEnv, carry = false): Promise<void> {
    this.busy = "reading the note..."; env.redraw();
    const fresh = await env.fetch(this.msg.id).catch(() => null);
    this.busy = null;
    if (!fresh || fresh.revision === undefined) { this.error = "can't read the note's current revision"; env.redraw(); return; }
    this.msg = fresh; env.setMsg(fresh);
    this.passage = new Passage(fresh.text);
    if (!carry) { this.writing?.dispose(); this.writing = null; this.target = null; this.out.done(); }
    this.mode = "select"; env.redraw();
  }

  /** Send it (ctrl+s, `comment.send`): through the writing session, recorded as whoever wrote the text. */
  async send(env: CommentEnv): Promise<void> {
    const w = this.writing, t = this.target;
    if (!w || !t) return;
    this.env = env;
    if (w.draft.text.trim()) { this.busy = t.kind === "quote" ? "sending the comment..." : "sending the reply..."; this.error = null; env.redraw(); }
    // A refusal is the adapter's to say (its error line, at once); one said on the draft itself (nothing typed) stays there.
    const r = await w.submit(env.actor ?? USER);
    if (!r.ok) this.busy = null;
    env.redraw();
  }

  /** A send landed: back to the thread list, reloaded, on the thread it went to. */
  private async landed(r: { id: string; deduplicated?: boolean }, t: Target): Promise<void> {
    const env = this.env!;
    this.writing = null; this.target = null; this.passage = null; this.stale = false; this.note = "";
    this.mode = "threads"; this.busy = "loading the thread...";
    // From an expanded thread: straight back to reading (the reader shows the reloaded thread there).
    if (this.inline) this.finished = true;
    env.flash(r.deduplicated ? `already saved: the service returned the ${t.kind === "quote" ? "comment" : "reply"} from the first send, not a second copy` : t.kind === "quote" ? "comment added" : "reply added");
    this.threads = await env.reloadComments();
    this.busy = null;
    const root = t.kind === "quote" ? r.id : t.thread.id;
    this.sel = Math.max(0, this.threads.findIndex(x => x.id === root));
    // A comment on a checklist step gives the step a stable id, which changes the note.
    if (t.kind === "quote") { const fresh = await env.fetch(t.blockId).catch(() => null); if (fresh) { this.msg = fresh; env.setMsg(fresh); } }
  }

  /** After a stale refusal: find the same quote in the note's current text, nearest where it was. */
  async relocate(env: CommentEnv): Promise<void> {
    this.env = env;
    const t = this.target;
    if (!t || t.kind !== "quote" || !this.stale) { if (this.composer) this.composer.note = "nothing to reload"; return; }
    this.busy = "reading the note..."; env.redraw();
    const fresh = await env.fetch(t.blockId).catch(() => null);
    this.busy = null;
    if (!fresh || fresh.revision === undefined) { this.error = "can't read the note's current revision"; env.redraw(); return; }
    this.msg = fresh; env.setMsg(fresh);
    const q = t.passage.quote, hits: number[] = [];
    for (let i = fresh.text.indexOf(q); i >= 0; i = fresh.text.indexOf(q, i + 1)) hits.push(i);
    if (hits.length) {
      const start = hits.reduce((a, b) => (Math.abs(b - t.passage.start) < Math.abs(a - t.passage.start) ? b : a));
      this.target = { ...t, revision: fresh.revision, passage: { quote: q, start } };
      this.stale = false; this.error = null;
      // Found again: the draft's own "refused, copied to …" line goes, so this one shows.
      if (this.writing) { this.writing.settled(); this.writing.draft.note = ""; }
      this.note = `found the quote again at revision ${fresh.revision}${hits.length > 1 ? ` (nearest of ${hits.length})` : ""} · ctrl+s sends`;
    } else {
      // The words are gone: pick again. The comment text rides along and comes back on Enter.
      this.passage = new Passage(fresh.text);
      this.passage.note = "the quote is gone from the current text · pick the passage again · Enter returns to your comment";
      this.stale = false; this.error = null; this.mode = "select";
      if (this.writing) { this.writing.settled(); this.writing.draft.note = ""; }
    }
    env.redraw();
  }

  async toggle(env: CommentEnv): Promise<void> {
    const t = this.threads[this.sel];
    if (!t) return;
    const to = t.open ? "resolved" : "open";
    this.busy = t.open ? "resolving..." : "reopening..."; env.redraw();
    try {
      await env.board.setLifecycle(t.id, to, env.actor ?? USER);
      env.flash(to === "resolved" ? "resolved" : "reopened");
      this.busy = null;
      this.threads = await env.reloadComments();
      this.sel = Math.max(0, this.threads.findIndex(x => x.id === t.id));
    } catch (e) {
      this.busy = null;
      // Resolve/reopen sets a state, so trying again after no answer can't double anything.
      this.error = `${to === "resolved" ? "resolve" : "reopen"} failed: ${e instanceof Error ? e.message : String(e)} · x tries again`;
    }
    env.redraw();
  }

  // ── drawing ─────────────────────────────────────────────────────────────────

  /** `preview`: the reader's renderer, for the comment's live preview (ctrl+p). */
  render(w: number, h: number, title: string, preview?: (text: string, w: number) => string[]): string[] {
    const status = (s: string, colour: number) => fg(colour) + pad(s, w) + RESET;
    const state = this.busy ? status(this.busy, C.grey)
      : this.error ? status(`! ${this.error}`, C.lred)
      : null;
    if (this.mode === "select" && this.passage) {
      const p = this.passage;
      const a = p.firstLine + 1, b = p.lastLine + 1;
      const head = [
        fg(C.yellow) + pad(`» comment on a passage · ${title}`, w) + RESET,
        fg(C.brown) + pad(`rev ${this.msg.revision} · line${a === b ? ` ${a}` : `s ${a}-${b}`} · ${p.quote.length} chars · the note's source text`, w) + RESET,
        state ?? status(p.note || this.note || "pick the words to quote; Enter writes the comment", p.note ? C.yellow : C.cyan),
        rule(w),
      ];
      return [...head, ...p.render(w, Math.max(1, h - head.length), this.threads)];
    }
    if (this.mode === "compose" && this.composer && this.target) {
      const d = this.composer, t = this.target;
      const quote = t.kind === "quote" ? t.passage.quote : t.thread.quote;
      const q = quote ? wrap(quote.replace(/\s+/g, " "), w - 4).slice(0, 3).map(l => fg(C.green) + "  " + MARK + " " + l + RESET) : [];
      if (t.kind === "reply") q.push(...wrap(t.thread.body, w - 4).slice(0, 2).map(l => fg(C.grey) + "    " + l + RESET));
      return renderEditor(d, {
        title: t.kind === "quote" ? `comment · ${title}` : `reply to ${t.thread.author} · ${title}`,
        status: [state ?? status(d.note || this.note || (d.dirty ? "unsent" : "type the comment"), d.note ? C.yellow : d.dirty ? C.yellow : C.dark)],
        context: q, by: writtenBy(d, "send"), preview,
      }, w, h);
    }
    // threads
    const open = this.threads.filter(t => t.open).length;
    const head = [
      fg(C.yellow) + pad(`» comments · ${title}`, w) + RESET,
      fg(C.brown) + pad(`${open} open · ${this.threads.length - open} resolved`, w) + RESET,
      state ?? status(this.note || (this.threads.length ? "" : "no comments yet · C comments on a passage"), C.cyan),
      rule(w),
    ];
    const lines: string[] = [];
    let selAt = 0, selEnd = 0;
    this.threads.forEach((t, i) => {
      if (i === this.sel) selAt = lines.length;
      const top = `${t.open ? OPEN : DONE} ${t.author} · ${ago(t.at)} · ${t.open ? "open" : "resolved"}${t.replies.length ? ` · ${t.replies.length} repl${t.replies.length === 1 ? "y" : "ies"}` : ""}`;
      lines.push(i === this.sel ? bg(C.blue) + fg(C.white) + pad(top, w) + RESET : fg(t.open ? C.yellow : C.dark) + pad(top, w) + RESET);
      if (t.quote) for (const l of wrap(`"${t.quote}"`, w - 4).slice(0, 2)) lines.push(fg(t.open ? C.green : C.dark) + "  " + MARK + " " + l + RESET);
      if (t.start === null && t.quote) lines.push(fg(C.brown) + "    (the quoted words moved; the service couldn't place them)" + RESET);
      // The selected thread shows whole; the others show their start and say how much more there is.
      const whole = i === this.sel;
      const more = (n: number, indent: string) => { if (n > 0) lines.push(indent + fg(C.dark) + `… ${n} more line${n === 1 ? "" : "s"}${whole ? "" : " · j k to select it and read it whole"}` + RESET); };
      const body = wrap(t.body, w - 4);
      for (const l of whole ? body : body.slice(0, 4)) lines.push("    " + fg(t.open ? C.white : C.grey) + l + RESET);
      if (!whole) more(body.length - 4, "    ");
      for (const r of t.replies) {
        const rl = wrap(`${r.author} · ${ago(r.at)}: ${r.body}`, w - 6);
        for (const [j, l] of (whole ? rl : rl.slice(0, 3)).entries()) lines.push(fg(C.cyan) + (j ? "      " : "    └ ") + l + RESET);
        if (!whole) more(rl.length - 3, "      ");
      }
      if (i === this.sel) selEnd = lines.length - 1;
      lines.push("");
    });
    const room = Math.max(1, h - head.length);
    this.room = room;
    if (!this.free) {
      if (selAt < this.top) this.top = selAt;
      if (selEnd >= this.top + room) this.top = Math.min(selAt, selEnd - room + 1);
    }
    this.maxTop = Math.max(0, lines.length - room);
    this.top = scrolled(this.top, 0, this.maxTop);
    return [...head, ...lines.slice(this.top, this.top + room)];
  }

  describe() {
    return {
      mode: this.mode, blockId: this.msg.id, revision: this.msg.revision,
      quote: this.mode === "select" ? this.passage?.quote : this.target?.kind === "quote" ? this.target.passage.quote : undefined,
      replyTo: this.target?.kind === "reply" ? this.target.thread.id : undefined,
      dirty: this.dirty, busy: this.busy, error: this.error, requestId: this.requestId, threads: this.threads.length,
    };
  }
}

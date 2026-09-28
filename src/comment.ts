// Comments from a reader (EPD-004): pick a passage of the note's source, write a comment on it, reply to
// a thread, resolve or reopen one. The service owns the rules: a comment names the note's revision and
// an exact quote with its offset, so a stale or moved passage is refused, never guessed at; every comment
// and reply carries a requestId, reused on retry, so a send whose answer was lost can't land twice.
import type { Msg } from "./board";
import { Draft } from "./edit";
import { Refused, type Comment, type CommentPassage, type SocketBoard } from "./socket";
import { bg, C, fg, pad, RESET } from "./style";
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
    const HI = bg(C.cyan) + fg(C.black), LO = fg(C.grey);
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

// ── request identity ──────────────────────────────────────────────────────────

/**
 * One requestId per thing the user means to send. A retry of the same text reuses it, so the service
 * answers with the comment it already saved. A changed text gets a new id; if the last send's outcome
 * is unknown, the session asks before sending, because both could land.
 */
export class Outgoing {
  private last: { key: string; id: string; unsure: boolean } | null = null;
  /** The requestId for this payload, and whether it replaces a send whose outcome is unknown. */
  peek(key: string): { requestId: string; replacesUnsure: boolean } {
    if (this.last?.key === key) return { requestId: this.last.id, replacesUnsure: false };
    return { requestId: "", replacesUnsure: !!this.last?.unsure };
  }
  begin(key: string): string {
    if (this.last?.key !== key) this.last = { key, id: `ep0ch-door-${crypto.randomUUID()}`, unsure: false };
    return this.last.id;
  }
  /** No answer: it may have been saved. */
  unsure() { if (this.last) this.last.unsure = true; }
  /** The service answered no: nothing was written under this id. */
  refused() { if (this.last) this.last.unsure = false; }
  done() { this.last = null; }
  get requestId() { return this.last?.id ?? null; }
}

// ── the session a reader holds while commenting ───────────────────────────────

export interface CommentEnv {
  board: Pick<SocketBoard, "comment" | "reply" | "setLifecycle">;
  fetch(id: string): Promise<Msg | null>;
  /** The reader shows the note as the service has it now. */
  setMsg(m: Msg): void;
  reloadComments(): Promise<Comment[]>;
  external(d: Draft): void;
  flash(msg: string): void;
  redraw(): void;
}

type Target =
  | { kind: "quote"; blockId: string; revision: number; passage: CommentPassage }
  | { kind: "reply"; thread: Comment };

export type CommentMode = "select" | "compose" | "threads";

export class CommentSession {
  mode: CommentMode;
  passage: Passage | null = null;
  composer: Draft | null = null;
  target: Target | null = null;
  sel = 0;
  busy: string | null = null;
  error: string | null = null;
  note = "";
  /** The last refusal was about the note moving on, so ctrl+r can find the quote again. */
  private stale = false;
  /** A changed comment after an unanswered send: the next ctrl+s sends it as new. */
  private confirmNew = false;
  private readonly out = new Outgoing();
  private top = 0;
  /** Where Esc from the composer goes back to. */
  private back: CommentMode = "threads";
  /** The mode the session opened in; Esc there closes it. */
  private readonly origin: CommentMode;

  constructor(public msg: Msg, public threads: Comment[], mode: "select" | "threads") {
    this.mode = this.origin = mode;
    if (mode === "select") this.passage = new Passage(msg.text);
  }

  get blockId() { return this.msg.id; }
  get dirty() { return !!this.composer?.dirty; }
  get requestId() { return this.out.requestId; }

  hint(): string {
    if (this.busy) return this.busy;
    if (this.mode === "select") return "j k line · J K extend · h l start · H L end · enter write · esc back";
    if (this.mode === "compose") return `ctrl+s send · ctrl+e $EDITOR${this.stale ? " · ctrl+r find quote" : ""} · esc ${this.dirty ? "twice discards" : "back"}`;
    return "j k thread · r reply · x resolve/reopen · c comment on a passage · esc done";
  }

  key(k: Key, env: CommentEnv): "keep" | "close" {
    if (this.busy || k.kind === "mouse") return "keep";
    if (this.mode === "select") {
      const a = this.passage!.key(k);
      if (a === "close") {
        if (this.origin === "select" && !this.composer) return "close";
        this.passage = null; this.mode = this.composer ? "compose" : "threads";
      } else if (a === "compose") {
        this.target = { kind: "quote", blockId: this.msg.id, revision: this.msg.revision!, passage: this.passage!.passage };
        this.composer ??= new Draft("comment", 0, "");
        this.back = "select"; this.mode = "compose"; this.error = null; this.stale = false;
      }
      return "keep";
    }
    if (this.mode === "compose") {
      const d = this.composer!;
      const a = d.key(k);
      if (a === "save") void this.send(env);
      else if (a === "editor") env.external(d);
      else if (a === "reload") void this.relocate(env);
      else if (a === "close") {
        this.composer = null; this.target = null; this.error = null; this.note = ""; this.out.done(); this.confirmNew = false;
        if (this.back === "select" && this.passage) this.mode = "select";
        else if (this.origin === "select" && !this.threads.length) return "close";
        else this.mode = "threads";
      }
      return "keep";
    }
    // threads
    const c = ch(k), n = this.threads.length;
    this.error = null;
    if (k.kind === "esc") return "close";
    if (k.kind === "down" || c === "j") this.sel = Math.min(Math.max(0, n - 1), this.sel + 1);
    else if (k.kind === "up" || c === "k") this.sel = Math.max(0, this.sel - 1);
    else if ((c === "r" || k.kind === "enter") && this.threads[this.sel]) {
      this.target = { kind: "reply", thread: this.threads[this.sel]! };
      this.composer = new Draft("reply", 0, "");
      this.back = "threads"; this.mode = "compose"; this.note = "";
    } else if (c === "x" && this.threads[this.sel]) void this.toggle(env);
    else if (c === "c") void this.pick(env);
    return "keep";
  }

  /** Select a passage on the note as the service has it now. */
  async pick(env: CommentEnv, carry = false): Promise<void> {
    this.busy = "reading the note..."; env.redraw();
    const fresh = await env.fetch(this.msg.id).catch(() => null);
    this.busy = null;
    if (!fresh || fresh.revision === undefined) { this.error = "can't read the note's current revision"; env.redraw(); return; }
    this.msg = fresh; env.setMsg(fresh);
    this.passage = new Passage(fresh.text);
    if (!carry) { this.composer = null; this.target = null; this.out.done(); }
    this.mode = "select"; env.redraw();
  }

  private payloadKey(t: Target, body: string) {
    return JSON.stringify(t.kind === "quote" ? ["comment", t.blockId, t.revision, t.passage.start, t.passage.quote, body] : ["reply", t.thread.id, body]);
  }

  async send(env: CommentEnv): Promise<void> {
    const d = this.composer, t = this.target;
    if (!d || !t) return;
    const body = d.text.trim();
    if (!body) { d.note = "write the comment first"; env.redraw(); return; }
    const key = this.payloadKey(t, body);
    if (this.out.peek(key).replacesUnsure && !this.confirmNew) {
      this.confirmNew = true;
      this.error = "the last send got no answer and may be saved; this text differs, so it would be a second comment · ctrl+s again sends it anyway";
      env.redraw(); return;
    }
    this.confirmNew = false;
    const requestId = this.out.begin(key);
    this.busy = t.kind === "quote" ? "sending the comment..." : "sending the reply..."; this.error = null; env.redraw();
    try {
      const r = t.kind === "quote"
        ? await env.board.comment(requestId, t.blockId, t.revision, body, t.passage)
        : await env.board.reply(requestId, t.thread.id, body);
      this.out.done();
      this.composer = null; this.target = null; this.passage = null; this.stale = false; this.note = "";
      this.mode = "threads"; this.busy = "loading the thread...";
      env.flash(r.deduplicated ? `already saved: the service returned the ${t.kind === "quote" ? "comment" : "reply"} from the first send, not a second copy` : t.kind === "quote" ? "comment added" : "reply added");
      this.threads = await env.reloadComments();
      this.busy = null;
      const root = t.kind === "quote" ? r.id : t.thread.id;
      this.sel = Math.max(0, this.threads.findIndex(x => x.id === root));
      // A comment on a checklist step gives the step a stable id, which changes the note.
      if (t.kind === "quote") { const fresh = await env.fetch(t.blockId).catch(() => null); if (fresh) { this.msg = fresh; env.setMsg(fresh); } }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.busy = null;
      if (e instanceof Refused) {
        this.out.refused();
        this.stale = t.kind === "quote" && /revision is stale|was not found|ambiguous/i.test(msg);
        this.error = /revision is stale/i.test(msg) ? "the note changed since you picked the passage · not sent · ctrl+r finds the quote in the current text"
          : /was not found/i.test(msg) ? "the quote isn't in the note's current text · not sent · ctrl+r picks it again"
          : `refused, not sent: ${msg}`;
      } else {
        this.out.unsure();
        this.error = `no answer from the outline (${msg}) · it may be saved · ctrl+s retries with the same request id, so it can't land twice`;
      }
    }
    env.redraw();
  }

  /** After a stale refusal: find the same quote in the note's current text, nearest where it was. */
  async relocate(env: CommentEnv): Promise<void> {
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
      this.note = `found the quote again at revision ${fresh.revision}${hits.length > 1 ? ` (nearest of ${hits.length})` : ""} · ctrl+s sends`;
    } else {
      // The words are gone: pick again. The comment text rides along and comes back on Enter.
      this.passage = new Passage(fresh.text);
      this.passage.note = "the quote is gone from the current text · pick the passage again · Enter returns to your comment";
      this.stale = false; this.error = null; this.mode = "select";
    }
    env.redraw();
  }

  async toggle(env: CommentEnv): Promise<void> {
    const t = this.threads[this.sel];
    if (!t) return;
    const to = t.open ? "resolved" : "open";
    this.busy = t.open ? "resolving..." : "reopening..."; env.redraw();
    try {
      await env.board.setLifecycle(t.id, to);
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

  render(w: number, h: number, title: string): string[] {
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
      const head = [
        fg(C.yellow) + pad(t.kind === "quote" ? `» comment · ${title}` : `» reply to ${t.thread.author} · ${title}`, w) + RESET,
        state ?? status(d.note || this.note || (d.dirty ? "unsent" : "type the comment"), d.note ? C.yellow : d.dirty ? C.yellow : C.dark),
      ];
      const q = quote ? wrap(quote.replace(/\s+/g, " "), w - 4).slice(0, 3).map(l => fg(C.green) + "  " + MARK + " " + l + RESET) : [];
      if (t.kind === "reply") q.push(...wrap(t.thread.body, w - 4).slice(0, 2).map(l => fg(C.grey) + "    " + l + RESET));
      const top = [...head, ...q, rule(w)];
      return [...top, ...d.render(w - 2, Math.max(1, h - top.length)).map(l => " " + l)];
    }
    // threads
    const open = this.threads.filter(t => t.open).length;
    const head = [
      fg(C.yellow) + pad(`» comments · ${title}`, w) + RESET,
      fg(C.brown) + pad(`${open} open · ${this.threads.length - open} resolved`, w) + RESET,
      state ?? status(this.note || (this.threads.length ? "" : "no comments yet · c comments on a passage"), C.cyan),
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
      for (const l of wrap(t.body, w - 4).slice(0, 4)) lines.push("    " + fg(t.open ? C.white : C.grey) + l + RESET);
      for (const r of t.replies) for (const [j, l] of wrap(`${r.author} · ${ago(r.at)}: ${r.body}`, w - 6).slice(0, 3).entries()) lines.push(fg(C.cyan) + (j ? "      " : "    └ ") + l + RESET);
      if (i === this.sel) selEnd = lines.length - 1;
      lines.push("");
    });
    const room = Math.max(1, h - head.length);
    if (selAt < this.top) this.top = selAt;
    if (selEnd >= this.top + room) this.top = Math.min(selAt, selEnd - room + 1);
    this.top = Math.max(0, Math.min(this.top, Math.max(0, lines.length - room)));
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

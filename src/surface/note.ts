// The note surface: one note, shown, edited and commented on the same way wherever it is hosted — the
// board's preview, details and floats, the desk's reader, and (next) a river column. It owns the note's
// rendering, links, the edit control (a Draft, with Ctrl+E handing it to $EDITOR), passage selection
// and comment threads, the property warning, "changed elsewhere", and keeping unsaved text safe.
//
// A host gives it a rectangle of any width and a SurfaceHost (the door's context, a redraw, and where
// a followed link opens). Everything a person can do here is also a named action (NOTE_ACTIONS), so an
// agent driving the door through its control socket goes through the same code as the keys.
import type { Ctx } from "../app";
import { subject, type Msg } from "../board";
import { CommentSession, type CommentEnv } from "../comment";
import { renderDoc } from "../doc";
import { Draft } from "../edit";
import type { Placement } from "../kitty";
import { EditConflict, USER, type Actor, type Comment } from "../socket";
import { C, fg, pad, RESET } from "../style";
import type { Key } from "../term";
import { bbsDate, rule } from "../text";
import { ActionRefused, ActionSet, agentLabel, asActor } from "./actions";
import { draftState, editHint, openInEditor, renderEditor } from "./editor";

/** What a surface needs from whatever hosts it. */
export interface SurfaceHost {
  ctx: Ctx;
  redraw(): void;
  /** A followed link or `u` (up): the host decides where the note opens (in place, or as the current note). */
  navigate(m: Msg): void;
}

export interface SurfaceView { lines: string[]; placements?: Placement[] }
export type Link = { block?: string; page?: string; media?: string };

const LINK = /\(\(([0-9a-f]{8}-[0-9a-f-]{27})\)\)|\[\[([^\]]+)\]\]/g;
const linksOf = (m: Msg): Link[] => [...m.text.matchAll(LINK)].map(x => (x[1] ? { block: x[1] } : { page: x[2]! }));
const ch = (k: Key) => (k.kind === "char" && !k.ctrl ? k.ch : "");
const dim = (s: string) => fg(C.dark) + s + RESET;
const isUp = (k: Key) => k.kind === "up" || ch(k) === "k";
const isDown = (k: Key) => k.kind === "down" || ch(k) === "j";

/** `-stage=queued +stage=doing`, or "" when the property set is the same. */
export function propertyChange(before: Record<string, string>, after: Record<string, string>): string {
  const out: string[] = [];
  for (const [k, v] of Object.entries(before)) if (after[k] !== v) out.push(`-${k}=${v}`);
  for (const [k, v] of Object.entries(after)) if (before[k] !== v) out.push(`+${k}=${v}`);
  return out.join(" ");
}

export class NoteSurface {
  msg: Msg | null = null;
  scroll = 0;
  private crumbs = "";
  /** Shown under the header after a save that changed the note's properties, until the surface moves on. */
  private notice = "";
  private links: Link[] = [];
  private unfold = false;
  private link = -1;
  /** An open edit of `msg`. While it exists every key goes to it and the surface stays on its note. */
  draft: Draft | null = null;
  /** Commenting on `msg` (picking a passage, writing, the thread list). Holds keys and the note like a draft. */
  session: CommentSession | null = null;
  /** The note's comment threads, for the count in the header and the marks while picking a passage. */
  comments: Comment[] | null = null;
  private commentsFor = "";
  private commentTimer: Timer | null = null;
  /** Why the whole note behind a list row couldn't be read; empty while reading or once read. */
  unread = "";
  /** The last thing an agent did here, shown in the header until the surface shows another note. */
  agent: { id: string; did: string; at: number } | null = null;
  /** An agent typed into the open draft or comment (`edit.text`, `comment.write`): who, for the edit frame. */
  private typedBy: string | null = null;

  get editing() { return this.draft !== null || this.session !== null; }
  /** Typed text that isn't saved or sent: an edit, or a comment being written. */
  unsaved() { return !!this.draft?.dirty || !!this.session?.dirty; }
  /** Copy unsaved text to disk (the screen is closing anyway). */
  keepDrafts(): string[] {
    const out: string[] = [];
    if (this.draft?.dirty) out.push(this.draft.copyOut());
    if (this.session?.composer?.dirty) out.push(this.session.composer.copyOut(`${this.session.blockId.slice(0, 8)}-comment`));
    return out;
  }

  /** "editing · unsaved", "writing", "quoting", "comments", or null while reading. For the host's title. */
  state(): string | null {
    if (this.session) return this.session.mode === "compose" ? `writing${this.session.dirty ? " · unsent" : ""}` : this.session.mode === "select" ? "quoting" : "comments";
    if (this.draft) return `editing${this.draft.dirty ? " · unsaved" : ""}`;
    return null;
  }

  /** The keys that work right now. `extra` goes before the reading keys (a host's own, like `p pin`). */
  hint(extra = ""): string {
    if (this.session) return this.session.hint();
    if (this.draft) return editHint(this.draft, { save: "save", reload: this.draft.conflict || this.draft.changedElsewhere ? "reload" : null });
    const l = this.links[this.link];
    return l ? `link ${this.link + 1}/${this.links.length} ${l.media ? `▣ ${l.media.split("/").pop()}` : l.block ? `((${l.block.slice(0, 8)}…))` : `[[${l.page}]]`} · ⏎ ${l.media ? "open" : "follow"}`
      : `${extra}[ ] links · z folds · u up · c comment · m comments`;
  }

  // ── which note ─────────────────────────────────────────────────────────────

  /**
   * Same note, new text: keep the scroll position and link selection. An open draft is never replaced;
   * it is marked "changed elsewhere" and the save's revision check decides.
   */
  refresh(m: Msg) {
    if (this.msg?.id !== m.id) return;
    const d = this.draft;
    if (d && !d.saving && m.revision !== undefined && m.revision !== d.base) d.changedElsewhere = true;
    if (m.partial && !this.msg.partial) return;           // a list row never replaces the whole note
    if (!m.partial) this.unread = "";
    this.msg = m;
    if (!d) this.links = linksOf(m);
  }

  /** Show a note (or nothing). Refused, returning false, while an edit or a comment holds the surface on its note. */
  show(m: Msg | null, host: SurfaceHost): boolean {
    if (this.draft && m?.id !== this.draft.blockId) return false;
    if (this.session && m?.id !== this.session.blockId) return false;
    if (m?.id !== this.msg?.id) { this.notice = ""; this.agent = null; }
    this.msg = m; this.scroll = 0; this.link = -1; this.crumbs = "…"; this.unread = "";
    this.links = m ? linksOf(m) : [];
    if (m?.id !== this.commentsFor) { this.comments = null; this.commentsFor = ""; }
    if (!m) return true;
    // Lists carry title, properties and revision only; the surface fetches the whole note.
    if (m.partial) this.readWhole(host);
    void this.loadComments(host);
    host.ctx.board.ancestors(m.id).then(a => {
      if (this.msg?.id !== m.id) return;
      this.crumbs = a.map(subject).join(" › ") || "top level"; host.redraw();
    }, () => {});
    return true;
  }

  /** A list row's whole note. A failure is shown, and `retry` (on reconnect) asks again. */
  private readWhole(host: SurfaceHost) {
    const id = this.msg?.id;
    if (!id) return;
    this.unread = "";
    host.ctx.board.get(id).then(full => {
      if (this.msg?.id !== id || !this.msg.partial) return;
      if (full) { this.msg = full; this.links = linksOf(full); }
      else this.unread = "it isn't in the outline any more";
      host.redraw();
    }, (e: Error) => {
      if (this.msg?.id !== id || !this.msg.partial) return;
      this.unread = e.message || String(e);
      host.redraw();
    });
  }

  /** Still showing a list row (its read failed or was cut off): read the whole note again. */
  retry(host: SurfaceHost) { if (this.msg?.partial) this.readWhole(host); }

  // ── drawing ────────────────────────────────────────────────────────────────

  /** The surface at any width: a board reader, a desk pane, or a narrow river column. */
  render(w: number, h: number, host?: SurfaceHost): SurfaceView {
    const m = this.msg;
    if (!m) return { lines: [dim("pick something in the outline")] };
    if (this.draft) return { lines: this.renderDraft(this.draft, m, w, h) };
    if (this.session) return { lines: this.session.render(w, h, subject(m), this.typedBy) };
    if (m.partial) return { lines: [fg(C.white) + pad(subject(m), w) + RESET, this.unread ? fg(C.lred) + pad(`couldn't read the note: ${this.unread}`, w) + RESET : dim("reading the note…"), ...(this.unread ? [dim("it's read again when the door reconnects")] : [])] };
    const meta = [m.author ?? "?", bbsDate(m.updatedAt), m.props.status ?? m.props.type, m.props["work-id"]].filter(Boolean).join(" · ");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    const said = this.comments?.length ? `${fg(open ? C.yellow : C.dark)} · ■ ${open ? `${open} open comment${open === 1 ? "" : "s"}` : `${this.comments.length} resolved`} (m)` : "";
    const head = [
      fg(C.white) + pad(subject(m), w) + RESET,
      pad(fg(C.brown) + meta + said, w) + RESET,
      fg(C.cyan) + pad(this.crumbs, w) + RESET,
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
      ...(this.agent ? [fg(C.lmagenta) + pad(`an agent (${this.agent.id}) ${this.agent.did}`, w) + RESET] : []),
      rule(w),
    ];
    const t = host?.ctx.t;
    const doc = renderDoc(m.text.split("\n").slice(1).join("\n").replace(/^\n+/, ""), {
      width: Math.max(1, w - 1), cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics: !!host?.ctx.graphics,
      maxImageRows: Math.max(4, Math.round((h - head.length) * 0.8)), unfold: this.unfold,
    });
    // Media become followable links too: [ ] selects, ⏎ opens with the system viewer.
    const mediaLinks = doc.media.map(x => ({ media: x.path }));
    if (this.links.filter(l => l.media).length !== mediaLinks.length) this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
    const body = doc.lines.map(l => " " + l);
    const room = Math.max(1, h - head.length);
    this.scroll = Math.max(0, Math.min(this.scroll, body.length - room));
    const placements: Placement[] = [];
    for (const im of doc.images) {
      const top = im.line - this.scroll, bottom = top + im.rows;
      if (bottom <= 0 || top >= room) continue;
      const cutTop = Math.max(0, -top), cutBottom = Math.max(0, bottom - room);
      const visible = im.rows - cutTop - cutBottom;
      const img = im.media.image;
      const crop = cutTop || cutBottom ? { x: 0, y: Math.round((cutTop / im.rows) * img.height), w: img.width, h: Math.max(1, Math.round((visible / im.rows) * img.height)) } : undefined;
      placements.push({ key: `img:${img.key}:${im.line}`, image: img, col: 1, row: head.length + Math.max(0, top), cols: im.cols, rows: visible, z: -1, crop });
    }
    return { lines: [...head, ...body.slice(this.scroll, this.scroll + room)], placements };
  }

  private renderDraft(d: Draft, m: Msg, w: number, h: number): string[] {
    const rev = `rev ${d.base} · `;
    return renderEditor(d, {
      title: `editing · ${subject(m)}`,
      status: [
        fg(C.brown) + rev + pad(draftState(d), Math.max(1, w - rev.length)) + RESET,
        fg(C.cyan) + pad(d.note || "whole text: subject, body and [key::value] properties", w) + RESET,
      ],
      by: this.typedBy,
    }, w, h);
  }

  // ── editing ────────────────────────────────────────────────────────────────

  /** Open a draft on the note as the service has it now, not as this surface last drew it. */
  async edit(host: SurfaceHost, external = false): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    const fresh = await host.ctx.board.get(m.id);
    if (!fresh || fresh.revision === undefined) { host.ctx.flash("can't edit: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    this.draft = new Draft(fresh.id, fresh.revision, fresh.text, fresh.props);
    this.typedBy = null;
    host.redraw();
    if (external) this.external(host);
  }

  private draftKey(k: Key, host: SurfaceHost): boolean {
    const d = this.draft!;
    if (d.saving) return true;
    const a = d.key(k);
    if (a === "save") void this.save(host);
    else if (a === "editor") this.external(host);
    else if (a === "reload") void this.reload(host);
    else if (a === "close") this.closeDraft();
    host.redraw();
    return true;
  }

  private closeDraft() {
    this.draft = null; this.typedBy = null;
    if (this.msg) this.links = linksOf(this.msg);
  }

  /** Whole-text update from the draft's base revision. A refusal keeps the draft and copies it to disk. */
  async save(host: SurfaceHost, actor: Actor = USER): Promise<void> {
    const d = this.draft;
    if (!d) return;
    if (!d.dirty) { this.closeDraft(); host.ctx.flash("nothing changed"); host.redraw(); return; }
    // Ask the service how it will read the draft's [key::value] tokens before writing, when it can say.
    if (d.propertyWarned !== d.text) {
      const next = await host.ctx.board.previewProperties(d.text).catch(() => null);
      const change = next ? propertyChange(d.baseProps, next) : "";
      if (change && this.draft === d) {
        d.propertyWarned = d.text;
        d.note = `this save changes properties: ${change} · ctrl+s again saves`;
        host.redraw();
        return;
      }
    }
    d.saving = true; d.note = "saving…"; host.redraw();
    try {
      const m = await host.ctx.board.update(d.blockId, d.text, d.base, actor);
      if (this.draft === d) this.closeDraft();
      this.msg = { ...m, childIds: this.msg?.id === m.id ? this.msg.childIds : m.childIds };
      this.links = linksOf(this.msg);
      // The service decides which [key::value] tokens are properties (a token followed by more text on
      // its line is plain text), so say plainly when a save changed them: a card can leave its lane.
      const change = propertyChange(d.baseProps, m.props);
      this.notice = change ? `properties changed: ${change}` : "";
      host.ctx.flash(change ? `saved · revision ${m.revision} · properties changed: ${change}` : `saved · revision ${m.revision}`);
    } catch (e) {
      d.saving = false;
      if (e instanceof EditConflict) {
        d.conflict = "changed elsewhere since you started · not saved";
        d.note = `your draft is kept and copied to ${d.copyOut()} · ctrl+r loads the current text`;
      } else {
        d.note = `not saved: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    host.redraw();
  }

  /** Drop the draft for the note's current text. Typed work is copied to disk first. */
  async reload(host: SurfaceHost): Promise<void> {
    const d = this.draft!;
    if (!d.conflict && !d.changedElsewhere) { d.note = "nothing newer to load"; return; }
    const copy = d.dirty ? d.copyOut() : d.savedCopy;
    const m = await host.ctx.board.get(d.blockId);
    if (this.draft !== d) return;
    if (!m) { d.note = "the note is gone from the outline"; host.redraw(); return; }
    this.msg = m;
    d.rebase(m);
    if (copy) d.note = `loaded revision ${d.base} · your earlier draft is at ${copy}`;
    host.redraw();
  }

  /** Ctrl+E: the draft (or a comment being written) goes to $EDITOR and comes back. */
  private external(host: SurfaceHost, d: Draft | null = this.draft) {
    if (!d) return;
    openInEditor(host.ctx, d);
    host.redraw();
  }

  // ── comments ───────────────────────────────────────────────────────────────

  async loadComments(host: SurfaceHost): Promise<void> {
    const id = this.msg?.id;
    if (!id) return;
    try {
      const c = await host.ctx.board.comments(id);
      if (this.msg?.id !== id) return;
      this.comments = c; this.commentsFor = id;
      if (this.session?.mode === "threads" && !this.session.busy) this.session.threads = c;
      host.redraw();
    } catch { /* comments are extra; the note still reads */ }
  }

  /** Outline changed: a comment on this note may have been added, answered or resolved anywhere. */
  onEvent(host: SurfaceHost) {
    if (!this.msg) return;
    if (this.commentTimer) clearTimeout(this.commentTimer);
    this.commentTimer = setTimeout(() => void this.loadComments(host), 700);
  }

  private commentEnv(host: SurfaceHost, actor: Actor = USER): CommentEnv {
    return {
      board: host.ctx.board,
      fetch: id => host.ctx.board.get(id),
      setMsg: m => { if (this.msg?.id === m.id) { this.msg = { ...m, childIds: m.childIds.length ? m.childIds : this.msg.childIds }; this.links = linksOf(this.msg); } },
      reloadComments: async () => { await this.loadComments(host); return this.comments ?? []; },
      external: d => this.external(host, d),
      flash: m => host.ctx.flash(m),
      redraw: () => host.redraw(),
      actor,
    };
  }

  /** `c`: pick a passage of the note as the service has it now; `m`: the thread list. */
  async comment(host: SurfaceHost, mode: "select" | "threads"): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    const fresh = mode === "select" || m.partial ? await host.ctx.board.get(m.id) : m;
    if (!fresh || fresh.revision === undefined) { host.ctx.flash("can't comment: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    if (this.commentsFor !== m.id) await this.loadComments(host);
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    this.typedBy = null;
    host.redraw();
  }

  // ── keys: each one is an action, the same ones an agent calls ─────────────

  key(k: Key, host: SurfaceHost): boolean {
    if (this.draft) return this.draftKey(k, host);
    if (this.session) {
      if (this.session.key(k, this.commentEnv(host)) === "close") { this.session = null; this.typedBy = null; }
      host.redraw();
      return true;
    }
    const c = ch(k);
    if (c === "c" && this.msg) { void this.comment(host, "select"); return true; }
    if (c === "m" && this.msg) { void this.comment(host, "threads"); return true; }
    if (c === "e" && this.msg) { void this.edit(host); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "e" && this.msg) { void this.edit(host, true); return true; }
    if (isUp(k)) { this.scroll = Math.max(0, this.scroll - 1); host.redraw(); return true; }
    if (isDown(k)) { this.scroll++; host.redraw(); return true; }
    if (k.kind === "pgdn" || c === " ") { this.scroll += 15; host.redraw(); return true; }
    if (k.kind === "pgup") { this.scroll = Math.max(0, this.scroll - 15); host.redraw(); return true; }
    if (c === "]" || c === "[") { this.stepLink(c === "]" ? 1 : -1); host.redraw(); return true; }
    if (c === "z") { this.unfold = !this.unfold; host.redraw(); return true; }
    if (k.kind === "enter" && this.links[this.link]) { void this.follow(this.link, host); return true; }
    if (c === "u" && this.msg?.parentId) { void this.up(host); return true; }
    return false;
  }

  wheel(dir: 1 | -1, host: SurfaceHost) { this.scroll = Math.max(0, this.scroll + dir * 3); host.redraw(); }

  private stepLink(d: 1 | -1) {
    const n = this.links.length;
    if (n) this.link = d === 1 ? (this.link + 1) % n : this.link <= 0 ? n - 1 : this.link - 1;
  }

  /** ⏎ on a selected link: media open in the system viewer, blocks and pages open through the host. */
  private async follow(i: number, host: SurfaceHost): Promise<Msg | null> {
    const l = this.links[i];
    if (!l) return null;
    if (l.media) { Bun.spawn(["open", l.media], { stdout: "ignore", stderr: "ignore" }); host.ctx.flash("opened in the system viewer"); return null; }
    let target: Msg | null = null;
    if (l.block) target = await host.ctx.board.get(l.block);
    else if (l.page) {
      const hits = await host.ctx.board.search(l.page, 25).catch(() => [] as Msg[]);
      const p = l.page.toLowerCase();
      target = hits.find(m => m.props["work-id"]?.toLowerCase() === p || m.props.page?.toLowerCase() === p)
        ?? hits.find(m => subject(m).toLowerCase().startsWith(p)) ?? null;
    }
    if (!target) { host.ctx.flash(`nothing answers at ${l.block ?? `[[${l.page}]]`}`); return null; }
    host.navigate(target);
    return target;
  }

  /** `u`: the note's parent. */
  private async up(host: SurfaceHost): Promise<Msg | null> {
    const id = this.msg?.parentId;
    if (!id) return null;
    const p = await host.ctx.board.get(id).catch(() => null);
    if (p) host.navigate(p);
    return p;
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /**
   * Run a named action as `actor`. Keys run the same code; what an agent adds is checking (a refusal
   * says why, nothing is half-done), waiting for the write to land, and saying on screen that it did it.
   */
  act(name: string, args: Record<string, unknown>, host: SurfaceHost, actor: Actor): Promise<unknown> {
    const h: SurfaceHost = actor.kind === "agent" ? { ...host, ctx: asActor(host.ctx, actor), redraw: () => host.redraw(), navigate: m => host.navigate(m) } : host;
    return NOTE_ACTIONS.runUntyped(name, args, { surface: this, host: h }, actor);
  }

  /** What the surface is doing, for `peek`. */
  describe() {
    const d = this.draft;
    return {
      showing: this.msg ? { id: this.msg.id, title: subject(this.msg), revision: this.msg.revision } : null,
      editing: d ? { id: d.blockId, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.changedElsewhere, conflict: d.conflict, savedCopy: d.savedCopy, note: d.note || null, typedBy: this.typedBy } : undefined,
      commenting: this.session ? this.session.describe() : undefined,
      comments: this.comments ? { open: this.comments.filter(c => c.open).length, total: this.comments.length, threads: this.comments.map(c => ({ id: c.id, open: c.open, author: c.author, quote: c.quote, replies: c.replies.length })) } : null,
      links: this.links.map((l, i) => ({ n: i + 1, ...l, selected: i === this.link })),
      agent: this.agent,
    };
  }

  // Used by the actions below: each wraps the key path with the checks an agent needs.

  /** Say in the surface what an agent just did (the flash says it too, but goes away). */
  noteAgent(actor: Actor, did: string) {
    if (actor.kind === "agent") this.agent = { id: actor.id, did, at: Date.now() };
  }

  requireNote(): Msg {
    if (!this.msg) throw new ActionRefused("this reader shows no note; open one first");
    return this.msg;
  }

  async ensureDraft(host: SurfaceHost): Promise<Draft> {
    if (this.session) throw new ActionRefused("this reader is commenting; finish or close the comment first (comment.close)");
    if (!this.draft) {
      this.requireNote();
      await this.edit(host);
      if (!this.draft) throw new ActionRefused("the note couldn't be opened for editing (its revision is unknown)");
    }
    return this.draft;
  }

  /** Replace the draft's text, as the $EDITOR handoff does. A person's unsaved typing is copied to disk first. */
  setDraftText(d: Draft, text: string, actor: Actor): string | null {
    let kept: string | null = null;
    if (actor.kind === "agent" && d.dirty && this.typedBy === null) kept = d.copyOut();
    d.replace(text);
    d.note = kept ? `${agentLabel(actor)} replaced the draft · what you had typed is at ${kept}` : "";
    this.typedBy = actor.kind === "agent" ? `${agentLabel(actor)} typed this · it saves as the agent's` : null;
    return kept;
  }

  closeDraftAction(discard: boolean): { closed: boolean; keptAt?: string } {
    const d = this.draft;
    if (!d) return { closed: false };
    if (d.saving) throw new ActionRefused("the save is still landing");
    let keptAt: string | undefined;
    if (d.dirty) {
      if (!discard) throw new ActionRefused("the draft has unsaved changes; edit.save saves it, discard=true closes it anyway (copied to disk first)");
      keptAt = d.copyOut();
    }
    this.closeDraft();
    return { closed: true, keptAt };
  }

  async ensureSession(host: SurfaceHost, mode: "select" | "threads"): Promise<CommentSession> {
    if (this.draft) throw new ActionRefused("this reader is editing; save or close the edit first (edit.save, edit.close)");
    if (!this.session) {
      this.requireNote();
      await this.comment(host, mode);
      if (!this.session) throw new ActionRefused("the note couldn't be opened for commenting (its revision is unknown)");
      return this.session;
    }
    const s = this.session;
    if (s.busy) throw new ActionRefused(`wait: ${s.busy}`);
    if (mode === "threads" && s.mode !== "threads") {
      if (s.dirty) throw new ActionRefused("a comment is being written here; send it (comment.send) or close it (comment.close discard=true)");
      s.composer = null; s.target = null; s.passage = null; s.mode = "threads";
    }
    if (mode === "select" && s.mode !== "select") {
      if (s.mode === "compose" && s.target?.kind === "reply") throw new ActionRefused("a reply is being written here; send or close it first");
      // `c` from the thread list, or picking again while writing: the text written so far rides along.
      await s.pick(this.commentEnv(host), s.mode === "compose");
    }
    return s;
  }

  env(host: SurfaceHost, actor: Actor) { return this.commentEnv(host, actor); }
  markTyped(actor: Actor) { this.typedBy = actor.kind === "agent" ? `${agentLabel(actor)} typed this · it sends as the agent's` : null; }
  closeSession() { this.session = null; this.typedBy = null; }
  followLink(i: number, host: SurfaceHost) { return this.follow(i, host); }
  selectLink(i: number) { if (!this.links[i]) throw new ActionRefused(`there is no link ${i + 1}; the note has ${this.links.length}`); this.link = i; }
  goUp(host: SurfaceHost) { return this.up(host); }
}

// ── the actions ──────────────────────────────────────────────────────────────

interface On { surface: NoteSurface; host: SurfaceHost }

/** Each action's arguments. */
export interface NoteActionArgs {
  "edit": { external?: boolean };
  "edit.text": { text: string };
  "edit.save": Record<string, never>;
  "edit.reload": Record<string, never>;
  "edit.close": { discard?: boolean };
  "link.select": { n: number };
  "link.follow": { n?: number };
  "up": Record<string, never>;
  "passage.select": { quote?: string; near?: number };
  "comment.write": { body: string };
  "comment.send": Record<string, never>;
  "comment": { quote: string; body: string; near?: number };
  "comment.close": { discard?: boolean };
  "threads": Record<string, never>;
  "reply": { thread: string; body: string };
  "resolve": { thread: string; open?: boolean };
}

const findThread = (s: CommentSession, id: string): number => {
  const i = s.threads.findIndex(t => t.id === id || (id.length >= 6 && t.id.startsWith(id)));
  if (i < 0) throw new ActionRefused(`no comment thread ${id} on this note; peek lists them under comments.threads`);
  return i;
};

/** A save, a send: done when the service answered. Throws with the surface's own words when it didn't take. */
async function saveDraft(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const d = surface.draft;
  if (!d) throw new ActionRefused("nothing is being edited here");
  if (d.saving) throw new ActionRefused("the save is still landing");
  const before = surface.msg?.revision;
  await surface.save(host, actor);
  if (surface.draft === d) {
    if (d.propertyWarned === d.text && d.note.startsWith("this save changes properties")) return { saved: false, warning: d.note, next: "edit.save again saves it" };
    throw new ActionRefused(d.conflict ? `${d.conflict} · ${d.note}` : d.note || "not saved");
  }
  surface.noteAgent(actor, "saved this note");
  return { saved: true, revision: surface.msg?.revision, from: before };
}

async function sendComment(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const s = surface.session;
  if (!s || s.mode !== "compose" || !s.composer) throw new ActionRefused("no comment is being written here; comment.write first");
  const kind = s.target?.kind;
  await s.send(surface.env(host, actor));
  if (s.error || s.mode === "compose") throw new ActionRefused(s.error ?? s.composer?.note ?? "not sent");
  surface.noteAgent(actor, kind === "reply" ? "replied to a comment" : "commented on this note");
  return { sent: kind === "reply" ? "reply" : "comment", threads: s.threads.map(t => ({ id: t.id, open: t.open, quote: t.quote, replies: t.replies.length })) };
}

export const NOTE_ACTIONS: ActionSet<NoteActionArgs, On> = new ActionSet<NoteActionArgs, On>("note", {
  "edit": {
    summary: "open the note for editing (its whole text, at the revision the service has now)", keys: "e, ctrl+e",
    args: { external: { type: "boolean", optional: true, about: "hand the draft to $EDITOR (the person's keys only)" } },
    async run({ external }, { surface, host }, actor) {
      if (external && actor.kind === "agent") throw new ActionRefused("the $EDITOR handoff takes over the person's terminal; send the text with edit.text");
      if (surface.draft) return { already: true, id: surface.draft.blockId, baseRevision: surface.draft.base };
      const d = await surface.ensureDraft(host);
      if (external) openInEditor(host.ctx, d);
      surface.noteAgent(actor, "opened this note for editing");
      return { id: d.blockId, baseRevision: d.base };
    },
  },
  "edit.text": {
    summary: "replace the draft's whole text (opens the edit first if needed); like text coming back from $EDITOR",
    args: { text: { type: "string", about: "subject line, body and [key::value] properties" } },
    async run({ text }, { surface, host }, actor) {
      const d = await surface.ensureDraft(host);
      if (d.saving) throw new ActionRefused("the save is still landing");
      const kept = surface.setDraftText(d, text, actor);
      surface.noteAgent(actor, "is editing this note");
      host.redraw();
      return { dirty: d.dirty, keptYourDraftAt: kept ?? undefined };
    },
  },
  "edit.save": {
    summary: "save the draft, checked against the revision it started from; a property change is shown first and needs a second save", keys: "ctrl+s",
    args: {},
    run: (_, { surface, host }, actor) => saveDraft(surface, host, actor),
  },
  "edit.reload": {
    summary: "after the note changed elsewhere: start over from its current text (the draft is copied to disk first)", keys: "ctrl+r",
    args: {},
    async run(_, { surface, host }) {
      if (!surface.draft) throw new ActionRefused("nothing is being edited here");
      await surface.reload(host);
      return { baseRevision: surface.draft?.base, note: surface.draft?.note };
    },
  },
  "edit.close": {
    summary: "close the edit; unsaved changes need discard=true (and are copied to disk)", keys: "esc (twice when unsaved)",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsaved changes" } },
    run({ discard }, { surface, host }) { const r = surface.closeDraftAction(!!discard); host.redraw(); return r; },
  },
  "link.select": {
    summary: "select the note's nth link (1 is the first)", keys: "[ ]",
    args: { n: { type: "number", about: "which link, from 1" } },
    run({ n }, { surface, host }) { surface.requireNote(); surface.selectLink(n - 1); host.redraw(); return surface.describe().links[n - 1]; },
  },
  "link.follow": {
    summary: "follow the selected link (or the nth); where it opens is the view's call", keys: "enter",
    args: { n: { type: "number", optional: true, about: "which link, from 1; default the selected one" } },
    async run({ n }, { surface, host }, actor) {
      surface.requireNote();
      if (n !== undefined) surface.selectLink(n - 1);
      const i = surface.describe().links.findIndex(l => l.selected);
      if (i < 0) throw new ActionRefused("no link is selected; pass n");
      const m = await surface.followLink(i, host);
      if (m) surface.noteAgent(actor, `followed a link to ${subject(m).slice(0, 40)}`);
      return m ? { opened: m.id, title: subject(m) } : { opened: null };
    },
  },
  "up": {
    summary: "go to the note's parent", keys: "u",
    args: {},
    async run(_, { surface, host }) {
      const m = await surface.goUp(host);
      if (!m) throw new ActionRefused("the note has no parent");
      return { opened: m.id, title: subject(m) };
    },
  },
  "passage.select": {
    summary: "start a comment: pick a passage of the note's source text by its exact words (default: the first line with text)", keys: "c, then j k J K h l H L",
    args: {
      quote: { type: "string", optional: true, about: "the exact words to quote, as stored" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    async run({ quote, near }, { surface, host }, actor) {
      const s = await surface.ensureSession(host, "select");
      const p = s.passage!;
      if (quote !== undefined) { const why = p.selectText(quote, near); if (why) { p.note = why; host.redraw(); throw new ActionRefused(why); } }
      surface.noteAgent(actor, "is quoting a passage");
      host.redraw();
      return { revision: s.msg.revision, quote: p.quote, start: p.from };
    },
  },
  "comment.write": {
    summary: "write the comment (or reply) text: on a picked passage this is Enter, then the text", keys: "enter, then typing",
    args: { body: { type: "string", about: "the comment's text" } },
    async run({ body }, { surface, host }, actor) {
      const s = surface.session;
      if (!s) throw new ActionRefused("no comment is being written here; passage.select or reply first");
      if (s.mode === "select") { const why = s.write(); if (why) throw new ActionRefused(why); }
      if (s.mode !== "compose" || !s.composer) throw new ActionRefused("pick a passage first (passage.select) or reply to a thread");
      s.composer.replace(body);
      surface.markTyped(actor);
      host.redraw();
      return { dirty: s.composer.dirty };
    },
  },
  "comment.send": {
    summary: "send the comment or reply; a retry of the same text can't land twice", keys: "ctrl+s",
    args: {},
    run: (_, { surface, host }, actor) => sendComment(surface, host, actor),
  },
  "comment": {
    summary: "comment on a passage in one step: passage.select, comment.write, comment.send",
    args: {
      quote: { type: "string", about: "the exact words to quote, as stored" },
      body: { type: "string", about: "the comment's text" },
      near: { type: "number", optional: true, about: "when the words occur more than once: the offset to be nearest" },
    },
    async run({ quote, body, near }, on, actor): Promise<unknown> {
      await NOTE_ACTIONS.run("passage.select", { quote, near }, on, actor);
      await NOTE_ACTIONS.run("comment.write", { body }, on, actor);
      return NOTE_ACTIONS.run("comment.send", {}, on, actor);
    },
  },
  "comment.close": {
    summary: "close the comment session; unsent text needs discard=true (and is copied to disk)", keys: "esc",
    args: { discard: { type: "boolean", optional: true, about: "close even with unsent text" } },
    run({ discard }, { surface, host }) {
      const s = surface.session;
      if (!s) return { closed: false };
      let keptAt: string | undefined;
      if (s.dirty) {
        if (!discard) throw new ActionRefused("the comment isn't sent; comment.send sends it, discard=true closes it anyway (copied to disk first)");
        keptAt = s.composer!.copyOut(`${s.blockId.slice(0, 8)}-comment`);
      }
      surface.closeSession(); host.redraw();
      return { closed: true, keptAt };
    },
  },
  "threads": {
    summary: "show the note's comment threads", keys: "m",
    args: {},
    async run(_, { surface, host }) {
      const s = await surface.ensureSession(host, "threads");
      host.redraw();
      return { threads: s.threads.map(t => ({ id: t.id, open: t.open, author: t.author, quote: t.quote, body: t.body, replies: t.replies.length })) };
    },
  },
  "reply": {
    summary: "reply to a comment thread and send it", keys: "m, j k, r, typing, ctrl+s",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, body: { type: "string", about: "the reply's text" } },
    async run({ thread, body }, on, actor) {
      const s = await on.surface.ensureSession(on.host, "threads");
      const why = s.replyTo(findThread(s, thread));
      if (why) throw new ActionRefused(why);
      s.composer!.replace(body);
      on.surface.markTyped(actor);
      return sendComment(on.surface, on.host, actor);
    },
  },
  "resolve": {
    summary: "resolve a comment thread, or reopen it with open=true", keys: "m, j k, x",
    args: { thread: { type: "string", about: "the thread's id (or its first 6+ characters)" }, open: { type: "boolean", optional: true, about: "reopen instead of resolving" } },
    async run({ thread, open }, { surface, host }, actor) {
      const s = await surface.ensureSession(host, "threads");
      const i = findThread(s, thread), t = s.threads[i]!;
      s.sel = i;
      const want = open ? "open" : "resolved";
      if (t.open === !!open) { host.redraw(); return { already: want }; }
      await s.toggle(surface.env(host, actor));
      if (s.error) throw new ActionRefused(s.error);
      surface.noteAgent(actor, open ? "reopened a comment" : "resolved a comment");
      return { lifecycle: want };
    },
  },
});

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
import { renderDoc, type DocEnv } from "../doc";
import { embedRegion } from "../embeds";
import { metadataLines, printable, setUserSummaryKeys, summaryKeys, summarySegments, tokensFor, tokensOf, type Source } from "../props";
import { PAGE, pageView, pageOf, presentLinks, REF, refKey, referencesIn, refView, workIdPrefix } from "../refs";
import { Draft, sameParty } from "../edit";
import type { Placement } from "../kitty";
import { actorIdOf, EditConflict, mutationFor, recordedActorId, USER, type Actor, type Comment, type PropertyRecord } from "../socket";
import { C, fg, pad, RESET, width } from "../style";
import type { Key } from "../term";
import { bbsDate, rule } from "../text";
import { ActionRefused, ActionSet, agentLabel, asActor } from "./actions";
import { draftState, editHint, openInEditor, renderEditor, writtenBy } from "./editor";
import { checkValue, propertyRows, PropertyPanel, valueView, type PropRow } from "./props-panel";

/** What a surface needs from whatever hosts it. */
export interface SurfaceHost {
  ctx: Ctx;
  redraw(): void;
  /** A followed link or `u` (up): the host decides where the note opens (in place, or as the current note). */
  navigate(m: Msg): void;
  /** The summary keys of the view this note is shown from (a lane's `[summary-properties::…]`), if any. */
  summaryKeys?(m: Msg): readonly string[] | null | undefined;
}

export interface SurfaceView { lines: string[]; placements?: Placement[] }
export type Link = { block?: string; fragment?: string; label?: string; page?: string; media?: string };

/** The note's links in reading order: exact `((…))` (transclusions too) and `[[…]]`, the service's syntax. */
const LINK = new RegExp(`${REF.source}|${PAGE.source}`, "g");
const linksOf = (m: Msg): Link[] => [...m.text.matchAll(LINK)].flatMap((x): Link[] => {
  if (x[1]) return x[3] !== undefined && !x[3].trim() ? [] : [{ block: x[1], ...(x[2] ? { fragment: x[2] } : {}), ...(x[3] !== undefined ? { label: x[3] } : {}) }];
  return [{ page: x[4]!.trim(), ...(x[5] !== undefined ? { label: x[5] } : {}) }];
});
/** How a link reads in the hint and `peek`: its title or label, as the note shows it. */
const linkText = (l: Link, text: string, src: Source | null) => l.block
  ? refView(l.block, l.fragment, l.label, referencesIn(text, src)?.get(refKey(l.block, l.fragment, l.label))).text
  : l.page ? pageView(l.page, l.label, pageOf(l.page, src)).text : l.media?.split("/").pop() ?? "";

/**
 * The body a reader draws: the note without its subject line and without the lines that only hold block
 * metadata (those are in the summary and the property panel), links as they read.
 */
export function readableBody(m: Msg, embeds: boolean, src: Source | null): string {
  const tokens = tokensOf(m.text, src);
  const hidden = metadataLines(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  let fenced = false;
  const body = m.text.split("\n").filter((_, i) => i > 0 && !hidden.has(i))
    // A stable fragment anchor (`## Beds ^beds`) is an address, not prose: read mode hides it, as Detail does.
    .map(l => (/^\s*```/.test(l) ? ((fenced = !fenced), l) : fenced ? l : l.replace(/ \^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, "")))
    .join("\n").replace(/^\n+/, "");
  return presentLinks(body, embeds, src, m.text);
}
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
  notice = "";
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
  /** The property panel, while open (`i`). It holds the reader's keys; editing a value also holds the note. */
  panel: PropertyPanel | null = null;
  /** The summary keys the host gave for the note shown (a lane's), refreshed on every render. */
  private viewKeys: readonly string[] | null = null;
  /** Where this reader's property, link and embed reads go (its host's connection), from the last host seen. */
  src: Source | null = null;
  private use(host: SurfaceHost | undefined): Source | null {
    if (host) this.src = { board: host.ctx.board, redraw: () => host.redraw() };
    return this.src;
  }

  /** An edit, a comment, or a property value being typed: the surface stays on its note and takes every key. */
  get editing() { return this.draft !== null || this.session !== null || !!this.panel?.field; }
  /**
   * The surface wants every key, the host's shortcuts included (Tab, o, …): while editing, and while the
   * property panel is open. Unlike `editing`, an open panel doesn't hold the note or refuse clicks.
   */
  get holdsKeys() { return this.editing || this.panel !== null; }
  /** Typed text that isn't saved or sent: an edit, or a comment being written. */
  unsaved() { return !!this.draft?.dirty || !!this.session?.dirty || (!!this.panel?.field && this.panel.field.text !== this.panel.field.row.value); }
  /** Copy unsaved text to disk (the screen is closing anyway). */
  keepDrafts(): string[] {
    const out: string[] = [];
    if (this.draft?.dirty) out.push(this.draft.copyOut());
    if (this.session?.composer?.dirty) out.push(this.session.composer.copyOut(`${this.session.blockId.slice(0, 8)}-comment`));
    return out;
  }

  /** "editing · unsaved", "writing", "quoting", "comments", or null while reading. For the host's title. */
  state(): string | null {
    if (this.panel?.field) return "editing a property";
    if (this.panel) return "properties";
    if (this.session) return this.session.mode === "compose" ? `writing${this.session.dirty ? " · unsent" : ""}` : this.session.mode === "select" ? "quoting" : "comments";
    if (this.draft) return `editing${this.draft.dirty ? " · unsaved" : ""}`;
    return null;
  }

  /** The keys that work right now. `extra` goes before the reading keys (a host's own, like `p pin`). */
  hint(extra = ""): string {
    if (this.panel) return this.panel.hint();
    if (this.session) return this.session.hint();
    if (this.draft) return editHint(this.draft, { save: "save", reload: this.draft.conflict || this.draft.changedElsewhere ? "reload" : null });
    const l = this.links[this.link];
    return l ? `link ${this.link + 1}/${this.links.length} ${l.media ? "▣ " : ""}${printable(linkText(l, this.msg?.text ?? "", this.src)).slice(0, 60)} · ⏎ ${l.media ? "open" : "follow"}`
      : `${extra}[ ] links · i properties · z folds · u up · c comment · m comments`;
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
    const f = this.panel?.field;
    if (f && !f.saving && m.revision !== undefined && m.revision !== f.revision && !m.partial) {
      f.changedElsewhere = true;
      f.note = "the note changed elsewhere since this value was read · saving would be refused · esc, then enter edits the current value";
    }
    if (m.partial && !this.msg.partial) return;           // a list row never replaces the whole note
    if (!m.partial) this.unread = "";
    this.msg = m;
    if (!d) this.links = linksOf(m);
  }

  /** Show a note (or nothing). Refused, returning false, while an edit or a comment holds the surface on its note. */
  show(m: Msg | null, host: SurfaceHost): boolean {
    this.use(host);
    if (this.draft && m?.id !== this.draft.blockId) return false;
    if (this.session && m?.id !== this.session.blockId) return false;
    if (this.panel?.field && m?.id !== this.msg?.id) return false;
    if (m?.id !== this.msg?.id) { this.notice = ""; this.agent = null; if (this.panel) { this.panel.sel = 0; this.panel.top = 0; this.panel.note = ""; } }
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
    if (this.session) return { lines: this.session.render(w, h, subject(m)) };
    if (m.partial) return { lines: [fg(C.white) + pad(subject(m), w) + RESET, this.unread ? fg(C.lred) + pad(`couldn't read the note: ${this.unread}`, w) + RESET : dim("reading the note…"), ...(this.unread ? [dim("it's read again when the door reconnects")] : [])] };
    this.viewKeys = host?.summaryKeys?.(m) ?? null;
    const src = this.use(host);
    const meta = [m.author ?? "?", bbsDate(m.updatedAt), m.props["work-id"]].filter(Boolean).join(" · ");
    const open = this.comments?.filter(c => c.open).length ?? 0;
    const said = this.comments?.length ? `${fg(open ? C.yellow : C.dark)} · ■ ${open ? `${open} open comment${open === 1 ? "" : "s"}` : `${this.comments.length} resolved`} (m)` : "";
    // Detail's summary line: the chosen keys only; everything else is in the property panel (`i`).
    const summary = this.summary(m).text;
    const count = this.rows(m).length;
    const head = [
      fg(C.white) + pad(subject(m), w) + RESET,
      ...(summary ? [pad(fg(C.lgreen) + summary + (this.panel ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`), w) + RESET] : []),
      pad(fg(C.brown) + meta + (summary || this.panel || !count ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`) + said, w) + RESET,
      fg(C.cyan) + pad(this.crumbs, w) + RESET,
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
      ...(this.agent ? [fg(C.lmagenta) + pad(`an agent (${this.agent.id}) ${this.agent.did}`, w) + RESET] : []),
    ];
    if (this.panel) {
      const rows = this.rows(m);
      const tokens = tokensOf(m.text, src);
      const info = { revision: m.revision, summary: this.summary(m).keys, source: this.summary(m).source, scopes: tokens === null ? "loading" as const : tokens.state === "ready" ? "ready" as const : "block" as const, src, text: m.text };
      if (this.panel.full) return { lines: [...head, ...this.panel.render(rows, w, Math.max(2, h - head.length), info)] };
      const ph = Math.min(rows.length + 2 + (this.panel.note || this.panel.field?.note ? 1 : 0), Math.max(4, Math.floor((h - head.length) * 0.5)));
      head.push(...this.panel.render(rows, w, ph, info));
    }
    head.push(rule(w));
    const t = host?.ctx.t;
    const env: DocEnv = {
      width: Math.max(1, w - 1), cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics: !!host?.ctx.graphics,
      maxImageRows: Math.max(4, Math.round((h - head.length) * 0.8)), unfold: this.unfold,
    };
    // Transclusions: the target drawn the way this reader draws a note, without expanding its own embeds.
    const inner = (target: Msg, width: number) => renderDoc(readableBody(target, false, src), { ...env, width, graphics: false }).lines;
    const doc = renderDoc(readableBody(m, true, src), { ...env, embed: (id, fragment, n, width) => embedRegion(id, fragment, n, width, src, inner) });
    // Media become followable links too: [ ] selects, ⏎ opens with the system viewer.
    const mediaLinks = doc.media.map(x => ({ media: x.path }));
    if (this.links.filter(l => l.media).length !== mediaLinks.length) this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
    // The document keeps a minimum width of its own (callouts, tables); a narrower column clips it.
    const body = doc.lines.map(l => (width(l) + 1 > w ? pad(" " + l, w) : " " + l));
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
    return { lines: [...head, ...body.slice(this.scroll, this.scroll + room)].slice(0, Math.max(1, h)), placements };
  }

  // ── properties ─────────────────────────────────────────────────────────────

  /** The summary line for `m`: its keys (the view's, yours, the environment's or the default) and text. */
  summary(m: Msg): { keys: string[]; source: string; text: string } {
    const { keys, source } = summaryKeys(this.viewKeys);
    return { keys, source, text: summarySegments(m.properties ?? [], keys).map(s => s.plain).join(" · ") };
  }

  /** The panel's rows for `m`: the service's tokens once it has answered, the block properties until then. */
  rows(m: Msg, tokens: PropertyRecord[] | null = null): PropRow[] {
    const t = tokens ? { state: "ready", tokens } : tokensOf(m.text, this.src);
    return propertyRows(m, t?.state === "ready" ? t.tokens : null, workIdPrefix(this.src) ?? null);
  }

  /** Open (or switch to full) the property panel. */
  openPanel(full = false) {
    if (!this.panel) this.panel = new PropertyPanel();
    this.panel.full = full;
  }

  closePanel(): boolean {
    if (this.panel?.field && this.panel.field.text !== this.panel.field.row.value && !this.panel.field.saving) return false;
    this.panel = null;
    return true;
  }

  /** The value of row `n` (from 1), after checking it exists. */
  row(m: Msg, n: number, rows = this.rows(m)): PropRow {
    const r = rows[n - 1];
    if (!r) throw new ActionRefused(`there is no property ${n}; the note has ${rows.length} (props lists them)`);
    return r;
  }

  /**
   * `y`: the value to the terminal's clipboard (OSC 52), as authored. Only for the person at the keys:
   * the clipboard is theirs, so an agent gets the value in its reply instead.
   */
  copyValue(r: PropRow, host: SurfaceHost) {
    host.ctx.copy?.(r.value);
    if (this.panel) this.panel.note = `copied ${r.key}: ${printable(r.value).slice(0, 60)}`;
  }

  /** `o`: open what a block, page or Work-ID value names. Pages resolve read-only (never creating a stub). */
  async followValue(r: PropRow, host: SurfaceHost): Promise<Msg | null> {
    const t = r.target;
    let target: Msg | null = null, why = "";
    if (!t) why = `${r.key} holds plain text; there is nothing to follow`;
    else if ("block" in t) { target = await host.ctx.board.get(t.block); if (!target) why = `nothing answers at ((${t.block.slice(0, 8)}…))`; }
    else {
      const p = await host.ctx.board.resolvePage(t.page).catch((e: Error) => ({ status: "failed", error: e.message } as const));
      if ("block" in p && p.block) target = p.block.partial ? await host.ctx.board.get(p.block.id) ?? p.block : p.block;
      else why = "error" in p ? `couldn't resolve ${t.page}: ${p.error}` : `${t.page} · Missing target`;
    }
    if (!target) { if (this.panel) this.panel.note = why; host.ctx.flash(why); host.redraw(); return null; }
    // The panel has done its job; the target opens to be read (in place or in another reader).
    this.panel = null;
    host.navigate(target);
    return target;
  }

  /** `⏎`/`e` on a value: a one-line field over it, at the revision the panel read. */
  editValue(r: PropRow): void {
    const m = this.msg!;
    if (!this.panel || m.revision === undefined) throw new ActionRefused("the note's revision is unknown, so a value edit couldn't be checked; open it again");
    this.panel.field = { row: r, text: r.value, cursor: r.value.length, revision: m.revision, saving: false, note: "", changedElsewhere: false };
  }

  /**
   * One `properties.patch` of `row`'s token in `m`, at `revision`: the revision `row`'s ordinal was read
   * from, so the service refuses it if the note has moved on. Returns the saved note (also shown here).
   */
  async patchValue(m: Msg, revision: number, row: PropRow, value: string, host: SurfaceHost, actor: Actor): Promise<Msg> {
    let ordinal = row.ordinal;
    if (ordinal === null) {
      // No properties.preview on this service: ask it for this key's tokens, at the same revision.
      const t = await host.ctx.board.propertyTokens(m.id, row.key);
      if (t.revision !== revision) throw new EditConflict(m.id, "changed since the panel read it");
      const nth = this.rows(m).filter(r => r.key === row.key && r.n <= row.n).length - 1;
      ordinal = t.tokens.filter(x => x.scope === "block")[nth]?.ordinal ?? null;
      if (ordinal === null) throw new Error(`the service doesn't list ${row.key} on the note any more`);
    }
    const saved = await host.ctx.board.patchProperties(m.id, revision, [{ op: "replace", ordinal, value }], actor);
    if (this.msg?.id === m.id) { this.refresh({ ...saved, childIds: this.msg.childIds }); this.links = linksOf(this.msg!); }
    return saved;
  }

  /**
   * Save the value being typed: one `properties.patch` of that token, refused by the service if the note
   * changed since the panel read it (nothing is retried over someone else's change). Returns the new
   * revision, or null with the reason in the field's note.
   */
  async saveValue(host: SurfaceHost, actor: Actor = USER): Promise<number | null> {
    const f = this.panel?.field, m = this.msg;
    if (!f || !m || f.saving) return null;
    const why = checkValue(f.row, f.text);
    if (why) { f.note = why; host.redraw(); return null; }
    const value = f.text.trim();
    if (value === f.row.value) { this.panel!.field = null; this.panel!.note = "unchanged"; host.redraw(); return m.revision ?? null; }
    f.saving = true; f.note = "saving…"; host.redraw();
    try {
      const saved = await this.patchValue(m, f.revision, f.row, value, host, actor);
      if (this.panel?.field === f) this.panel.field = null;
      const said = `saved · revision ${saved.revision} · ${f.row.key}: ${printable(f.row.value).slice(0, 30)} → ${printable(value).slice(0, 30)}`;
      if (this.panel) this.panel.note = said;
      host.ctx.flash(said);
      return saved.revision ?? null;
    } catch (e) {
      f.saving = false;
      if (e instanceof EditConflict) { f.changedElsewhere = true; f.note = "changed elsewhere since the panel read it · not saved · esc, then enter edits the current value"; }
      else f.note = `not saved: ${e instanceof Error ? e.message : String(e)}`;
      return null;
    } finally { host.redraw(); }
  }

  /** `s`: show or hide this key in the summary line, as your own choice (kept on this machine). */
  toggleSummary(key: string, host: SurfaceHost): { keys: string[]; source: string } {
    const cur = summaryKeys(null).keys;
    const k = key.toLowerCase();
    const next = cur.includes(k) ? cur.filter(x => x !== k) : [...cur, k];
    setUserSummaryKeys(next);
    const said = `summary shows ${next.join(", ") || "nothing"}${this.viewKeys ? " · this view's [summary-properties::] still decides here" : ""}`;
    if (this.panel) this.panel.note = said;
    host.ctx.flash(said);
    return { keys: next, source: "yours" };
  }

  private panelKey(k: Key, host: SurfaceHost): boolean {
    const P = this.panel!, m = this.msg;
    // Scrolling always works (PIE-411): PgDn, PgUp and Space (unless it's being typed) page the note,
    // or the property list when it fills the reader and the note isn't drawn.
    const page = k.kind === "pgdn" || (ch(k) === " " && !P.field) ? 1 : k.kind === "pgup" ? -1 : 0;
    if (page) {
      if (P.full && m && !m.partial) { const n = this.rows(m).length; if (n) P.sel = Math.max(0, Math.min(n - 1, P.sel + page * 15)); P.note = ""; }
      else this.scroll = Math.max(0, this.scroll + page * 15);
      host.redraw();
      return true;
    }
    if (!m || m.partial) { if (k.kind === "esc" || ch(k) === "i") this.panel = null; host.redraw(); return true; }
    const rows = this.rows(m);
    const intent = P.key(k, rows.length);
    const r = rows[P.sel];
    if (intent === "close") this.panel = null;
    else if (intent === "full") P.full = !P.full;
    else if (intent === "cancel") { P.field = null; P.note = ""; }
    else if (intent === "save") void this.saveValue(host);
    else if (r && intent === "copy") this.copyValue(r, host);
    else if (r && intent === "follow") void this.followValue(r, host);
    else if (r && intent === "summary") this.toggleSummary(r.key, host);
    else if (r && intent === "edit") { try { this.editValue(r); } catch (e) { P.note = (e as Error).message; } }
    host.redraw();
    return true;
  }

  private renderDraft(d: Draft, m: Msg, w: number, h: number): string[] {
    return renderEditor(d, {
      title: `editing · ${subject(m)}`,
      status: [
        fg(C.brown) + pad(`rev ${d.base} · ${draftState(d)}`, w) + RESET,
        fg(C.cyan) + pad(d.note || "whole text: subject, body and [key::value] properties", w) + RESET,
      ],
      by: writtenBy(d, "save"),
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
    host.redraw();
    if (external) this.external(host);
  }

  private draftKey(k: Key, host: SurfaceHost): boolean {
    const d = this.draft!;
    if (d.busy) return true;
    const a = d.key(k);
    if (a === "save") void this.save(host);
    else if (a === "editor") this.external(host);
    else if (a === "reload") void this.reload(host);
    else if (a === "close") {
      // Esc, esc discards typed text; an agent's part of it is never lost that way: it's copied out first.
      const at = keepAgents(d, () => d.copyOut());
      this.closeDraft();
      if (at) host.ctx.flash(`closed · the unsaved text an agent wrote is at ${at}`);
    }
    host.redraw();
    return true;
  }

  private closeDraft() {
    this.draft = null;
    if (this.msg) this.links = linksOf(this.msg);
  }

  /**
   * Whole-text update from the draft's base revision. A refusal keeps the draft and copies it to disk.
   * The write is recorded as whoever wrote the text (Draft.recordAs), which is not always `actor`, the
   * one who pressed save; returns that, or null when nothing was written.
   */
  async save(host: SurfaceHost, actor: Actor = USER): Promise<Actor | null> {
    const d = this.draft;
    if (!d || d.busy) return null;
    if (!d.dirty) { this.closeDraft(); host.ctx.flash("nothing changed"); host.redraw(); return null; }
    const text = d.text;
    // Ask the service how it will read the draft's [key::value] tokens before writing, when it can say.
    // Meanwhile the draft holds still: keys wait, and edit.text / edit.close / edit.reload are refused.
    if (d.propertyWarned !== text) {
      d.previewing = true; host.redraw();
      let next: Record<string, string> | null = null;
      try { next = await host.ctx.board.previewProperties(text).catch(() => null); } finally { d.previewing = false; }
      // Nothing should have changed it, but if the draft closed or its text moved on, this save is off.
      if (this.draft !== d || d.text !== text) { host.redraw(); return null; }
      const change = next ? propertyChange(d.baseProps, next) : "";
      if (change) {
        d.propertyWarned = text;
        d.note = `this save changes properties: ${change} · ctrl+s again saves`;
        host.redraw();
        return null;
      }
    }
    const by = d.recordAs(actor);
    d.saving = true; d.note = "saving…"; host.redraw();
    try {
      const m = await host.ctx.board.update(d.blockId, text, d.base, by);
      if (this.draft === d) this.closeDraft();
      this.msg = { ...m, childIds: this.msg?.id === m.id ? this.msg.childIds : m.childIds };
      this.links = linksOf(this.msg);
      // The service decides which [key::value] tokens are properties (a token followed by more text on
      // its line is plain text), so say plainly when a save changed them: a card can leave its lane.
      const change = propertyChange(d.baseProps, m.props);
      this.notice = change ? `properties changed: ${change}` : "";
      const whose = sameParty(by, actor) && !by.with?.length ? "" : ` · recorded as ${recordedAs(by)}`;
      host.ctx.flash(`saved · revision ${m.revision}${change ? ` · properties changed: ${change}` : ""}${whose}`);
      return by;
    } catch (e) {
      d.saving = false;
      if (e instanceof EditConflict) {
        d.conflict = "changed elsewhere since you started · not saved";
        d.note = `your draft is kept and copied to ${d.copyOut()} · ctrl+r loads the current text`;
      } else {
        d.note = `not saved: ${e instanceof Error ? e.message : String(e)}`;
      }
      return null;
    } finally {
      host.redraw();
    }
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
    host.redraw();
  }

  // ── keys: each one is an action, the same ones an agent calls ─────────────

  key(k: Key, host: SurfaceHost): boolean {
    this.use(host);
    if (this.panel) return this.panelKey(k, host);
    if (this.draft) return this.draftKey(k, host);
    if (this.session) {
      const s = this.session, composer = s.composer;
      if (s.key(k, this.commentEnv(host)) === "close") { this.session = null; }
      // A comment an agent was writing, closed by esc, esc: copied out first, like an edit.
      if (k.kind === "esc" && composer && s.composer !== composer) {
        const at = keepAgents(composer, () => composer.copyOut(`${s.blockId.slice(0, 8)}-comment`));
        if (at) host.ctx.flash(`closed · the unsent text an agent wrote is at ${at}`);
      }
      host.redraw();
      return true;
    }
    const c = ch(k);
    if ((c === "i" || c === "I") && this.msg) { this.openPanel(c === "I"); host.redraw(); return true; }
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
      // The service's page and Work-ID registry first (read-only: a dangling address isn't created).
      const p = await host.ctx.board.resolvePage(l.page).catch(() => null);
      if (p?.block) target = p.block.partial ? await host.ctx.board.get(p.block.id) ?? p.block : p.block;
      else if (p?.status === "missing") { host.ctx.flash(`[[${l.page}]] · Missing target`); return null; }
    }
    if (!target && l.page) {
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
    this.use(host);
    const h: SurfaceHost = actor.kind === "agent" ? { ...host, ctx: asActor(host.ctx, actor), redraw: () => host.redraw(), navigate: m => host.navigate(m) } : host;
    return NOTE_ACTIONS.runUntyped(name, args, { surface: this, host: h }, actor);
  }

  /** What the surface is doing, for `peek`. */
  describe() {
    const d = this.draft;
    return {
      showing: this.msg ? { id: this.msg.id, title: subject(this.msg), revision: this.msg.revision } : null,
      editing: d ? { id: d.blockId, baseRevision: d.base, dirty: d.dirty, changedElsewhere: d.changedElsewhere, conflict: d.conflict, savedCopy: d.savedCopy, note: d.note || null, writers: d.writers.map(actorIdOf), writtenBy: writtenBy(d, "save") } : undefined,
      commenting: this.session ? this.session.describe() : undefined,
      comments: this.comments ? { open: this.comments.filter(c => c.open).length, total: this.comments.length, threads: this.comments.map(c => ({ id: c.id, open: c.open, author: c.author, quote: c.quote, replies: c.replies.length })) } : null,
      links: this.links.map((l, i) => ({ n: i + 1, ...l, reads: printable(linkText(l, this.msg?.text ?? "", this.src)), selected: i === this.link })),
      summary: this.msg ? (({ keys, source, text }) => ({ keys, source, text }))(this.summary(this.msg)) : null,
      properties: this.panel && this.msg ? {
        open: this.panel.full ? "full" : "inline", selected: this.panel.sel + 1, note: this.panel.note || null,
        editing: this.panel.field ? { n: this.panel.field.row.n, key: this.panel.field.row.key, text: this.panel.field.text, revision: this.panel.field.revision, changedElsewhere: this.panel.field.changedElsewhere, note: this.panel.field.note || null } : null,
        rows: this.rows(this.msg).map(r => describeRow(r, this.src, this.msg!.text)),
      } : null,
      agent: this.agent,
    };
  }

  // Used by the actions below: each wraps the key path with the checks an agent needs.

  /** Say in the surface what an agent just did (the flash says it too, but goes away). */
  noteAgent(actor: Actor, did: string) {
    if (actor.kind === "agent") this.agent = { id: actor.id, did, at: Date.now() };
  }

  /** The whole note this reader shows, waiting a moment when only its list row has arrived. */
  async whole(ms = 5000): Promise<Msg> {
    const m = this.requireNote();
    for (const end = Date.now() + ms; this.msg?.id === m.id && this.msg.partial && !this.unread && Date.now() < end;) await Bun.sleep(25);
    const now = this.msg;
    if (!now || now.id !== m.id) throw new ActionRefused("the reader moved to another note");
    if (now.partial) throw new ActionRefused(this.unread ? `the note couldn't be read: ${this.unread}` : "the whole note isn't read yet; try again in a moment");
    return now;
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

  /**
   * Replace the draft's text, as the $EDITOR handoff does. Text someone else changed last (the person's
   * typing, or another agent's) is copied to disk first, however often each of them has typed before.
   */
  setDraftText(d: Draft, text: string, actor: Actor): string | null {
    const kept = keepOthers(d, actor, () => d.copyOut());
    d.replace(text, actor);
    d.note = kept ? `${agentLabel(actor)} replaced the draft · what ${kept.whose} had typed is at ${kept.at}` : "";
    return kept?.at ?? null;
  }

  /** The same for the comment or reply being written. */
  setComposerText(s: CommentSession, body: string, actor: Actor): string | null {
    const d = s.composer!;
    const kept = keepOthers(d, actor, () => d.copyOut(`${s.blockId.slice(0, 8)}-comment`));
    d.replace(body, actor);
    d.note = kept ? `${agentLabel(actor)} replaced the text · what ${kept.whose} had typed is at ${kept.at}` : "";
    return kept?.at ?? null;
  }

  closeDraftAction(discard: boolean): { closed: boolean; keptAt?: string } {
    const d = this.draft;
    if (!d) return { closed: false };
    if (d.busy) throw new ActionRefused("the save is still landing");
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
  closeSession() { this.session = null; }
  followLink(i: number, host: SurfaceHost) { return this.follow(i, host); }
  clearLink() { this.link = -1; }
  selectLink(i: number) { if (!this.links[i]) throw new ActionRefused(`there is no link ${i + 1}; the note has ${this.links.length}`); this.link = i; }
  goUp(host: SurfaceHost) { return this.up(host); }
}

/** A panel row as `peek` and the props actions report it. */
const describeRow = (r: PropRow, src: Source | null, text: string) => ({
  n: r.n, key: r.key, value: r.value, scope: r.scope, ...(r.placement ? { placement: r.placement } : {}),
  ordinal: r.ordinal, ...(r.target ? { target: r.target, reads: printable(valueView(r, src, text)) } : {}),
});

/** "yours", "an agent (x)'s", with anyone else who wrote part of it: how a save was recorded. */
function recordedAs(by: Actor): string {
  const whose = by.kind === "agent" ? `${agentLabel(by)}'s` : "yours";
  return by.with?.length ? `${whose}, naming ${recordedActorId(by)}` : whose;
}

/** Unsaved text an agent had a hand in, copied to disk before a key discards it: where it went, or null. */
function keepAgents(d: Draft, copy: () => string): string | null {
  return d.dirty && d.writers.some(w => w.kind === "agent") ? copy() : null;
}

/** Copy a draft out before `actor` replaces it, when someone else changed it last. Who that was, and where. */
function keepOthers(d: Draft, actor: Actor, copy: () => string): { at: string; whose: string } | null {
  const last = d.lastWriter;
  if (!d.dirty || !last || sameParty(last, actor)) return null;
  return { at: copy(), whose: last.kind === "user" ? "you" : agentLabel(last) };
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
  "props": { full?: boolean };
  "props.copy": { n?: number; key?: string };
  "props.follow": { n?: number; key?: string };
  "props.edit": { n?: number; key?: string; value: string; revision?: number };
  "props.close": Record<string, never>;
  "props.summary": { keys?: string; toggle?: string; reset?: boolean };
}

/**
 * The note's property rows as the service reads its current text (waiting for that answer), and the one
 * `n` or `key` names. A repeated key needs `n`.
 */
async function propRow(surface: NoteSurface, n: number | undefined, key: string | undefined): Promise<{ m: Msg; rows: PropRow[]; row: PropRow }> {
  const m = await surface.whole();
  const t = await tokensFor(m.text, surface.src);
  const rows = surface.rows(m, t.state === "ready" ? t.tokens : null);
  if (n !== undefined) return { m, rows, row: surface.row(m, n, rows) };
  if (!key) throw new ActionRefused("say which property: n (from props) or key");
  const hits = rows.filter(r => r.key === key.toLowerCase());
  if (!hits.length) throw new ActionRefused(`the note has no ${key} property; it has ${[...new Set(rows.map(r => r.key))].join(", ") || "none"}`);
  if (hits.length > 1) throw new ActionRefused(`the note has ${hits.length} ${key} values (${hits.map(r => `n=${r.n} ${r.value}`).join(", ")}); pass n`);
  return { m, rows, row: hits[0]! };
}

const ROW_ARGS = {
  n: { type: "number", optional: true, about: "which property, from 1, as props lists them" },
  key: { type: "string", optional: true, about: "the property's key, when it appears once" },
} as const;

const findThread = (s: CommentSession, id: string): number => {
  const i = s.threads.findIndex(t => t.id === id || (id.length >= 6 && t.id.startsWith(id)));
  if (i < 0) throw new ActionRefused(`no comment thread ${id} on this note; peek lists them under comments.threads`);
  return i;
};

/** A save, a send: done when the service answered. Throws with the surface's own words when it didn't take. */
async function saveDraft(surface: NoteSurface, host: SurfaceHost, actor: Actor) {
  const d = surface.draft;
  if (!d) throw new ActionRefused("nothing is being edited here");
  if (d.busy) throw new ActionRefused("the save is still landing");
  const before = surface.msg?.revision;
  const by = await surface.save(host, actor);
  if (surface.draft === d) {
    if (d.propertyWarned === d.text && d.note.startsWith("this save changes properties")) return { saved: false, warning: d.note, next: "edit.save again saves it" };
    throw new ActionRefused(d.conflict ? `${d.conflict} · ${d.note}` : d.note || "not saved");
  }
  surface.noteAgent(actor, "saved this note");
  return { saved: true, revision: surface.msg?.revision, from: before, recordedAs: by ? mutationFor(by) : undefined };
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
      if (d.busy) throw new ActionRefused("the save is still landing");
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
      if (surface.draft.busy) throw new ActionRefused("the save is still landing");
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
      // Picking reads the note again; when that fails the session stays where it was, with the reason.
      const p = s.mode === "select" ? s.passage : null;
      if (!p) throw new ActionRefused(s.error ?? "the passage couldn't be picked: the note's current text wasn't read");
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
      if (s.busy) throw new ActionRefused(`wait: ${s.busy}`);
      if (s.mode === "select") { const why = s.write(); if (why) throw new ActionRefused(why); }
      if (s.mode !== "compose" || !s.composer) throw new ActionRefused("pick a passage first (passage.select) or reply to a thread");
      const kept = surface.setComposerText(s, body, actor);
      host.redraw();
      return { dirty: s.composer.dirty, keptYourDraftAt: kept ?? undefined };
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
      on.surface.setComposerText(s, body, actor);
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
  "props": {
    summary: "open the property panel: every property token (repeats and block/line/inline scope kept), with the summary line's keys", keys: "i, I (full)",
    args: { full: { type: "boolean", optional: true, about: "fill the reader instead of sitting above the note" } },
    async run({ full }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      const m = await surface.whole();
      // The panel holds the reader's keys: an agent reads the rows in its reply and leaves the panel be.
      if (actor.kind === "user") surface.openPanel(!!full);
      const t = await tokensFor(m.text, surface.src);
      host.redraw();
      return { id: m.id, revision: m.revision, summary: surface.summary(m), scopes: t.state === "ready" ? "service" : "block only", rows: surface.rows(m, t.state === "ready" ? t.tokens : null).map(r => describeRow(r, surface.src, m.text)) };
    },
  },
  "props.copy": {
    summary: "a property's value, returned (the person's own y copies it to their clipboard; an agent's never does)", keys: "i, tab, y",
    args: ROW_ARGS,
    async run({ n, key }, { surface, host }, actor) {
      const { row } = await propRow(surface, n, key);
      // The clipboard and the panel are the person's: an agent gets the value here, and nothing moves.
      if (actor.kind === "user") {
        surface.openPanel(surface.panel?.full);
        surface.panel!.sel = row.n - 1;
        surface.copyValue(row, host);
      }
      host.redraw();
      return { key: row.key, value: row.value };
    },
  },
  "props.follow": {
    summary: "open what a block, page or Work-ID value names; where it opens is the view's call", keys: "i, tab, o",
    args: ROW_ARGS,
    async run({ n, key }, { surface, host }, actor) {
      const { row } = await propRow(surface, n, key);
      if (!row.target) throw new ActionRefused(`${row.key} holds plain text (${row.value}); there is nothing to follow`);
      const m = await surface.followValue(row, host);
      if (!m) throw new ActionRefused(surface.panel?.note || `nothing answers at ${row.value}`);
      surface.noteAgent(actor, `followed ${row.key} to ${subject(m).slice(0, 40)}`);
      return { opened: m.id, title: subject(m) };
    },
  },
  "props.edit": {
    summary: "replace one property value: a properties.patch of that token, refused if the note changed since it was read", keys: "i, tab, enter or e, typing, enter",
    args: {
      ...ROW_ARGS,
      value: { type: "string", about: "the new value (one line, no ])" },
      revision: { type: "number", optional: true, about: "the revision you read the properties at; refused if the note is past it" },
    },
    async run({ n, key, value, revision }, { surface, host }, actor) {
      if (surface.draft || surface.session) throw new ActionRefused("this reader is editing or commenting; close that first");
      const f = surface.panel?.field;
      if (f && (f.saving || f.text !== f.row.value)) throw new ActionRefused(f.saving ? "a value is being saved here" : `a value (${f.row.key}) is being typed here; it's someone else's until saved or cancelled`);
      const { m, row } = await propRow(surface, n, key);
      if (revision !== undefined && m.revision !== revision) throw new ActionRefused(`the note is at revision ${m.revision}, not ${revision}; read the properties again (props)`);
      if (m.revision === undefined) throw new ActionRefused("the note's revision is unknown, so a value edit couldn't be checked");
      // The ordinal belongs to the text it was read from: if the reader moved on meanwhile, don't guess.
      const now = surface.msg;
      if (!now || now.id !== m.id || now.revision !== m.revision || now.text !== m.text)
        throw new ActionRefused(`the note changed while its properties were read (now revision ${now?.id === m.id ? now.revision : "?"}); read them again (props)`);
      const why = checkValue(row, value);
      if (why) throw new ActionRefused(why);
      const to = value.trim();
      if (to === row.value) return { saved: false, unchanged: true, key: row.key, revision: m.revision };
      // Straight to the service at the revision the ordinal came from; the person's panel and keys are left alone.
      let saved: Msg;
      try { saved = await surface.patchValue(m, m.revision, row, to, host, actor); } catch (e) {
        throw new ActionRefused(e instanceof EditConflict ? "the note changed elsewhere since its properties were read · not saved; read them again (props)" : `not saved: ${e instanceof Error ? e.message : String(e)}`);
      }
      host.ctx.flash(`saved · revision ${saved.revision} · ${row.key}: ${printable(row.value).slice(0, 30)} → ${printable(to).slice(0, 30)}`);
      surface.noteAgent(actor, `set ${row.key} to ${to.slice(0, 40)}`);
      host.redraw();
      return { saved: true, key: row.key, from: row.value, to, revision: saved.revision ?? null, fromRevision: m.revision, recordedAs: mutationFor(actor) };
    },
  },
  "props.close": {
    summary: "close the property panel (a value being typed must be saved or cancelled first)", keys: "esc, i",
    args: {},
    run(_, { surface, host }) {
      if (!surface.panel) return { closed: false };
      if (!surface.closePanel()) throw new ActionRefused("a property value is being typed; enter saves it, esc cancels");
      host.redraw();
      return { closed: true };
    },
  },
  "props.summary": {
    summary: "choose the summary line's keys (yours, on this machine); a view's [summary-properties::] still decides for its notes", keys: "i, tab, s",
    args: {
      keys: { type: "string", optional: true, about: "comma-separated keys in order; empty shows no summary" },
      toggle: { type: "string", optional: true, about: "show or hide one key" },
      reset: { type: "boolean", optional: true, about: "forget your choice (back to OUTLINER_PROPERTY_SUMMARY_KEYS or the default)" },
    },
    run({ keys, toggle, reset }, { surface, host }) {
      if ([keys, toggle, reset].filter(x => x !== undefined).length !== 1) throw new ActionRefused("pass one of keys=a,b toggle=key reset=true");
      if (toggle) surface.toggleSummary(toggle, host);
      else { setUserSummaryKeys(reset ? null : keys!.split(",").map(k => k.trim().toLowerCase()).filter(Boolean)); host.redraw(); }
      const m = surface.msg;
      return { yours: summaryKeys(null), here: m ? surface.summary(m) : null };
    },
  },
});

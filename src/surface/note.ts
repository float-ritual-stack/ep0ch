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
import { foldPoints, renderDoc, type Doc, type DocEnv, type FoldPoint } from "../doc";
import { embedRegion, SHADE } from "../embeds";
import { metadataLines, printable, setUserSummaryKeys, summaryKeys, summarySegments, tokensFor, tokensOf, type Source } from "../props";
import { PAGE, pageView, pageOf, presentLinks, REF, refKey, referencesIn, refView, workIdPrefix, type LinkTarget } from "../refs";
import { Draft, sameParty } from "../edit";
import type { Placement } from "../kitty";
import type { Scroll } from "../canvas";
import { actorIdOf, EditConflict, mutationFor, recordedActorId, USER, type Actor, type Comment, type PropertyRecord } from "../socket";
import { C, fg, LINK_END, linkTag, pad, RESET, width } from "../style";
import type { Key } from "../term";
import { bbsDate, rule } from "../text";
import { ActionRefused, ActionSet, agentLabel, asActor } from "./actions";
import { draftState, editHint, openInEditor, renderEditor, writtenBy } from "./editor";
import { completerFor, completerOf, completionKey, insertCompletion, lookupCompletion, type CompletionBoard } from "./completer";
import { completionTargetAtCursor } from "../completion";
import { checkValue, propertyRows, PropertyPanel, valueTarget, valueView, type PropRow } from "./props-panel";
import { AGENT_BG, cellsOf, Gesture, lineAt, modeKey, paintRange, RULER_BG, SELECT_BG, Selection, selectionHint, wordAt, type Pos, type SelectRows } from "./selection";

/**
 * How a note is being opened (PIE-441), for the host to decide where: `link`, a link the person followed
 * (⏎ or a click; the board's preview opens it in a detail, as ⏎ on a card does); `fresh`, in a new reader
 * (alt+⏎: a new detail, a new desk reader, a new river column); `agent`, an agent's, which never takes the
 * person's focus. Neither link nor fresh: `u`, and whatever else opens.
 */
export interface OpenHow { link?: boolean; fresh?: boolean; agent?: boolean }

/** What a surface needs from whatever hosts it. */
export interface SurfaceHost {
  ctx: Ctx;
  redraw(): void;
  /** A followed link or `u` (up): the host decides where the note opens (in place, or as the current note). */
  navigate(m: Msg, how?: OpenHow): void;
  /** The summary keys of the view this note is shown from (a lane's `[summary-properties::…]`), if any. */
  summaryKeys?(m: Msg): readonly string[] | null | undefined;
  /**
   * Open the thread list as the person's `m` does, where the host keeps track of which session the person
   * is in (⏎ or a click on a comment mark). Without it the surface opens it itself.
   */
  startSession?(kind: "threads"): void;
}

/** `scroll`: where a reading view is in its note (the frames draw a thumb and `· NN%` from it). */
export interface SurfaceView { lines: string[]; placements?: Placement[]; scroll?: Scroll }
export type Link = LinkTarget;
/** Two links name the same target the same way (a click finds the `[ ]` link it is). */
const sameLink = (a: Link, b: Link) => a.block === b.block && a.fragment === b.fragment && a.label === b.label && a.page === b.page && a.media === b.media;
/**
 * Where a click lands in the last render, in the surface's own cells: a link (the body's, an embed's
 * title or result, a summary value), or a row of the property panel (`follow`: its value names a target).
 */
/** `value`: a summary-line value's property key; it follows as the panel's `o` does (followValue). */
/** `copy`: the selection's copy control (PIE-419), which copies what's drawn or its source. */
/** `elem`: the `[ ]` element the link is (PIE-441); `thread`: a comment mark in the margin. */
type Hit = { row: number; from: number; to: number } & ({ link: Link; value?: string; elem?: string } | { prop: number; follow: boolean } | { copy: "visible" | "source" } | { thread: string; elem: string });

/**
 * What `[ ]` stops on (PIE-441), in reading order: a link (in the text, the summary line, or an image or
 * video), a fold point (a heading or a list item with lines under it), a row that stands for a note (a live
 * figure's row, an embedded view's result), an embed (its title), and a comment mark (in the margin).
 */
export type ElementKind = "link" | "fold" | "row" | "embed" | "comment";
/**
 * One element where the last render drew it. Rows are content rows: the header's, then the body's (so the
 * header's stay put and the body's move with the scroll). `ruler`: the rows [from, to) of the block it's in,
 * which the reading ruler tints while it's current. `key` names it across renders.
 */
interface Element {
  key: string; kind: ElementKind; row: number; from: number; to: number; ruler: [number, number]; label: string;
  link?: Link; value?: string; fold?: string; thread?: string;
}
/** What ⏎ does on an element, for the hint. */
const verbOf = (e: Element, folded: boolean) =>
  e.kind === "fold" ? (folded ? "unfold" : "fold") : e.kind === "comment" ? "open its thread" : e.kind === "row" ? "open its note" : e.kind === "embed" ? "open it" : e.link?.media ? "open" : "follow";
/** Links, rows and embeds open a note, so alt+⏎ can open it in a new reader. */
const opens = (e: Element) => e.kind === "link" || e.kind === "row" || e.kind === "embed";

/**
 * An agent's (or the person's) focus mark in this reader (the door side of PIE-423): a block, and in it
 * maybe a passage, drawn with the reading ruler's tint and the one who set it named in the header. Kept as
 * what was named, and found again on each render, so a rewrap or a refresh keeps it on its text.
 */
export interface FocusSpec { block?: string; line?: number; to?: number; quote?: string; near?: number }
/** A comment mark: the margin row it's drawn on, and the rows of the lines its quote spans. */
interface Mark { thread: string; open: boolean; row: number; rows: [number, number]; label: string }

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
export function readableBody(m: Msg, embeds: boolean, src: Source | null, sink?: Link[]): string {
  return presentLinks(readableSource(m, src).text, embeds, src, m.text, sink);
}

/**
 * The readable body before its links are presented, line for line: `lines[i]` is the note line (from 0,
 * the subject) body line i comes from, `anchors[i]` the fragment anchor read mode hid from it.
 */
export function readableSource(m: Msg, src: Source | null): { text: string; lines: number[]; anchors: (string | undefined)[] } {
  const tokens = tokensOf(m.text, src);
  const hidden = metadataLines(m.text, tokens?.state === "ready" ? tokens.tokens : null);
  let fenced = false;
  const rows = m.text.split("\n").map((l, i) => ({ l, i })).filter(({ i }) => i > 0 && !hidden.has(i))
    // A stable fragment anchor (`## Beds ^beds`) is an address, not prose: read mode hides it, as Detail does.
    .map(({ l, i }) => {
      if (/^\s*```/.test(l)) { fenced = !fenced; return { l, i }; }
      const a = fenced ? null : l.match(/ \^([A-Za-z0-9][A-Za-z0-9_-]{0,63})$/);
      return a ? { l: l.slice(0, a.index), i, anchor: a[1] } : { l, i };
    });
  // Blank lines before the first line with text aren't drawn.
  let lead = 0;
  while (lead < rows.length - 1 && rows[lead]!.l === "") lead++;
  const kept = rows.slice(lead);
  return { text: kept.map(r => r.l).join("\n"), lines: kept.map(r => r.i), anchors: kept.map(r => ("anchor" in r ? r.anchor : undefined)) };
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

/** Agent actions that open an edit or a comment session on the note. */
const STARTS_SESSION = new Set(["edit", "edit.text", "passage.select", "comment.write", "comment", "threads", "reply", "resolve"]);

export class NoteSurface {
  msg: Msg | null = null;
  scroll = 0;
  /** The furthest the note scrolls, from its last render (keys and the wheel stop there). */
  private maxScroll = Infinity;
  private crumbs = "";
  /** Shown under the header after a save that changed the note's properties, until the surface moves on. */
  notice = "";
  private links: Link[] = [];
  /** What the last render put where, for clicks (PIE-415). */
  private hits: Hit[] = [];
  private unfold = false;
  /** The link `[ ]` or a click selected, as an index into `links` (the river steps these; it draws its own body). */
  private link = -1;
  /** The elements the last reading render drew, in reading order; empty until one (and in the river). */
  private elems: Element[] = [];
  /** The current element (its key): where `[ ]` is, what ⏎ acts on, what the ruler tints (PIE-441). */
  private cur: string | null = null;
  /** Bring the current element into view on the next render (after `[ ]`, `( )` or a fold). */
  private reveal = false;
  /** A focus mark an agent (or the person, through `act`) set here: never the person's `[ ]` position. */
  focusMark: { by: Actor; spec: FocusSpec; label: string; at: number } | null = null;
  private revealMark = false;
  /**
   * Folded headings and list items (their FoldPoint keys): this reader's reading state, never the note's
   * text. Kept while the note refreshes or is edited elsewhere; cleared when the reader shows another note.
   */
  folded = new Set<string>();
  /** The fold point selected (its key), which `f` and ⏎ fold or unfold: the current element, when it's a fold. */
  private get foldSel(): string | null { return this.cur?.startsWith("fold:") ? this.cur.slice(5) : null; }
  private set foldSel(key: string | null) {
    if (key !== null) { this.cur = `fold:${key}`; this.link = -1; }
    else if (this.foldSel !== null) this.cur = null;
  }
  private foldsOf: string | null = null;
  private foldCache: { text: string; points: FoldPoint[]; lines: number[] } | null = null;
  /** The last reading render: where the body starts, how far it's scrolled, and its rows' sources and fold heads. */
  private drawn: { w: number; top: number; scroll: number; room: number; doc: Doc; lines: number[]; head: string[]; body: string[] } | null = null;
  /**
   * The person's selected text (PIE-419), in content rows: the header's rows, then the body's, so it
   * stays on its text as the note scrolls. Only `y`, `Y` or the copy control copy it; selecting never does.
   */
  selection: Selection | null = null;
  /** What an agent selected here: drawn in its own tint, never the person's, never on their clipboard. */
  agentSelection: { id: string; sel: Selection } | null = null;
  private gesture = new Gesture();
  private dragging = false;
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
  /** The note itself is shown, so j k PgDn scroll it: not while a draft, a comment session or the full property panel is drawn instead. */
  scrolls(): boolean { return !this.draft && !this.session && !this.panel?.full; }
  /**
   * What holds the surface's keys now: the draft, the comment session or the property panel (null while
   * reading). Hosts compare it by identity to know whether the person is in this one (PIE-411).
   */
  sessionOf(): object | null { return this.draft ?? this.session ?? this.panel; }
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
    const rows = this.selection && this.selRows();
    if (rows) return selectionHint(this.selection!, [...this.selection!.text(rows)].length);
    const points = this.msg && !this.msg.partial ? this.visibleFolds(this.msg) : [];
    const sel = this.selectedFold(), f = sel ? points.indexOf(sel) : -1;
    if (f >= 0) { const p = points[f]!; return `fold ${f + 1}/${points.length} ${foldLabel(p).slice(0, 60)} · ⏎ f ${this.folded.has(p.key) ? "unfold" : "fold"} · F all · ( ) next · [ ] elements`; }
    // The current element, named (PIE-441); one an agent's mark scrolled away is named, but ⏎ waits for it.
    const away = !this.inView() && this.drawn ? this.elems.find(x => x.key === this.cur) : undefined;
    if (away) return `[ ] ${this.elems.indexOf(away) + 1}/${this.elems.length} · ${away.kind} ${printable(away.label).slice(0, 60)} · out of view · [ ] steps on from it`;
    const e = this.inView(), i = e ? this.elems.indexOf(e) : -1;
    if (e && e.kind !== "fold") return `[ ] ${i + 1}/${this.elems.length} · ${e.kind} ${e.link?.media ? "▣ " : ""}${printable(e.label).slice(0, 60)} · ⏎ ${verbOf(e, false)}${opens(e) ? " · alt⏎ new" : ""}`;
    // A link selected without a drawn body (the river's column, or one `link.select` named that isn't drawn).
    const l = !this.cur ? this.links[this.link] : undefined;
    if (l) return `link ${this.link + 1}/${this.links.length} ${l.media ? "▣ " : ""}${printable(linkText(l, this.msg?.text ?? "", this.src)).slice(0, 60)} · ⏎ ${l.media ? "open" : "follow"}`;
    return `${extra}[ ] elements · ( ) f folds · i properties · z callouts · u up · C comment · m comments`;
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
    if (m?.id !== this.msg?.id) { this.notice = ""; this.agent = null; this.focusMark = null; this.clearSelections(); if (this.panel) { this.panel.sel = 0; this.panel.top = 0; this.panel.note = ""; } }
    if ((m?.id ?? null) !== this.foldsOf) { this.folded.clear(); this.foldsOf = m?.id ?? null; }
    this.msg = m; this.scroll = 0; this.maxScroll = Infinity; this.letGo(); this.elems = []; this.crumbs = "…"; this.unread = "";
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
    this.hits = [];
    const m = this.msg;
    this.drawn = null;
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
    // A value that names a block, a page or a Work ID reads as a link, and a click opens it.
    const { text: summary, line: summaryLine, links: summaryLinks } = this.summaryView(m, src);
    const count = this.rows(m).length;
    const head = [
      fg(C.white) + pad(subject(m), w) + RESET,
      ...(summary ? [pad(fg(C.lgreen) + summaryLine + (this.panel ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`), w) + RESET] : []),
      pad(fg(C.brown) + meta + (summary || this.panel || !count ? "" : fg(C.dark) + ` · i ${count} propert${count === 1 ? "y" : "ies"}`) + said, w) + RESET,
      fg(C.cyan) + pad(this.crumbs, w) + RESET,
      ...(this.notice ? [fg(C.yellow) + pad(this.notice, w) + RESET] : []),
      ...(this.agent ? [fg(C.lmagenta) + pad(`an agent (${this.agent.id}) ${this.agent.did}`, w) + RESET] : []),
      // A focus mark says whose it is, in the ruler's own tint (PIE-423).
      ...(this.focusMark ? [RULER_BG + fg(C.lmagenta) + pad(`◆ focus · ${agentLabel(this.focusMark.by)} marked ${this.focusMark.label}`, w).split(RESET).join(RESET + RULER_BG) + RESET] : []),
    ];
    if (this.panel) {
      const rows = this.rows(m);
      const tokens = tokensOf(m.text, src);
      const info = { revision: m.revision, summary: this.summary(m).keys, source: this.summary(m).source, scopes: tokens === null ? "loading" as const : tokens.state === "ready" ? "ready" as const : "block" as const, src, text: m.text };
      const at = head.length;
      const panelHits = () => { for (const r of this.panel!.at) this.hits.push({ row: at + r.y, from: 0, to: w, prop: r.n, follow: false }, ...(r.target ? [{ row: at + r.y, from: r.from, to: w, prop: r.n, follow: true }] : [])); };
      if (this.panel.full) { const lines = [...head, ...this.panel.render(rows, w, Math.max(2, h - head.length), info)]; panelHits(); return { lines }; }
      const ph = Math.min(rows.length + 2 + (this.panel.note || this.panel.field?.note ? 1 : 0), Math.max(4, Math.floor((h - head.length) * 0.5)));
      head.push(...this.panel.render(rows, w, ph, info));
      panelHits();
    }
    head.push(rule(w));
    const t = host?.ctx.t;
    const env: DocEnv = {
      width: Math.max(1, w - 1), cellW: t?.cellW ?? 9, cellH: t?.cellH ?? 18, graphics: !!host?.ctx.graphics,
      maxImageRows: Math.max(4, Math.round((h - head.length) * 0.8)), unfold: this.unfold,
    };
    // Transclusions: the target drawn the way this reader draws a note, without expanding its own embeds.
    const inner = (target: Msg, width: number) => renderDoc(readableBody(target, false, src), { ...env, width, graphics: false }).lines;
    const { text: source, points, lines: noteLines } = this.foldsIn(m);
    // A fold whose heading or item is gone (or reworded) is dropped, so it never hides a different section.
    const keys = new Set(points.map(p => p.key));
    for (const k of this.folded) if (!keys.has(k)) this.folded.delete(k);
    if (this.foldSel && !keys.has(this.foldSel)) this.foldSel = null;
    // Every link drawn (the body's, an embed's title and results) is tagged with its place in `drawn`.
    const drawn: Link[] = [];
    const doc = renderDoc(presentLinks(source, true, src, m.text, drawn), {
      ...env, embed: (id, fragment, n, width) => embedRegion(id, fragment, n, width, src, inner, drawn),
      folds: { points, folded: this.folded, selected: this.foldSel },
      // A live figure's rows that stand for notes are links too (PIE-441).
      link: (block, text) => linkTag(drawn.push({ block, role: "row" }) - 1) + text + LINK_END,
    });
    // Media become followable links too: [ ] selects, ⏎ opens with the system viewer. Media in a folded
    // section aren't drawn, so they aren't links until it's unfolded.
    const mediaLinks = doc.media.map(x => ({ media: x.path }));
    if (this.links.filter(l => l.media).map(l => l.media).join("\n") !== mediaLinks.map(l => l.media).join("\n")) {
      const sel = this.links[this.link];
      this.links = [...this.links.filter(l => !l.media), ...mediaLinks];
      this.link = sel ? this.links.findIndex(l => (sel.media ? l.media === sel.media : l === sel)) : -1;
    }
    // The document keeps a minimum width of its own (callouts, tables); a narrower column clips it.
    const body = doc.lines.map(l => (width(l) + 1 > w ? pad(" " + l, w) : " " + l));
    const top = head.length;
    // Comment marks sit in the body's margin, on the first row of the lines each quote spans.
    const marks = this.commentMarks(m, doc, noteLines);
    for (const k of marks) body[k.row] = fg(k.open ? C.yellow : C.dark) + "▐" + RESET + body[k.row]!.slice(1);
    this.elems = this.elementsOf(doc, drawn, marks, summary ? summaryLinks : [], points, top, head);
    if (this.cur && !this.elems.some(e => e.key === this.cur)) this.letGo();
    // The body rows actually shown: none when the header fills the pane (then there's no scroll to show).
    const room = Math.max(0, h - top);
    this.maxScroll = Math.max(0, body.length - Math.max(1, room));
    // The element just stepped to, or the fold point just folded, comes into view; so does an agent's mark
    // (only as far as needed: one already in view doesn't move the note).
    const bringIn = (rows: [number, number]) => {
      const a = rows[0] - top, b = rows[1] - top;
      if (room <= 0 || b <= 0) return;
      if (a < this.scroll) this.scroll = Math.max(0, a);
      else if (b > this.scroll + room) this.scroll = Math.max(0, Math.min(a, b - room));
    };
    const current = this.elems.find(e => e.key === this.cur);
    if (this.reveal && current) bringIn([current.row, current.row + 1]);
    this.reveal = false;
    const markRows = this.focusMark ? this.focusRows(this.focusMark.spec, m, doc, noteLines, top) : null;
    if (this.revealMark && markRows) bringIn(markRows);
    this.revealMark = false;
    this.scroll = Math.max(0, Math.min(this.scroll, this.maxScroll));
    this.drawn = { w, top: head.length, scroll: this.scroll, room, doc, lines: noteLines, head, body };
    this.selectionControl(w);
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
    // Where the links landed on screen: below the header, one column in (the body's margin), scrolled.
    // Each is the element it is, so a click also puts `[ ]` there.
    const keyOf = new Map(this.elems.filter(e => e.link).map(e => [`${e.row}:${e.from}`, e.key]));
    if (summary) for (const l of summaryLinks) this.hits.push({ row: 1, from: l.from, to: Math.min(w, l.to), link: l.link, value: l.key, elem: keyOf.get(`1:${l.from}`) });
    const firstOf = new Map<number, string>();
    for (const r of doc.links) if (!firstOf.has(r.n)) firstOf.set(r.n, keyOf.get(`${top + r.line}:${r.from + 1}`) ?? "");
    for (const r of doc.links) {
      const row = r.line - this.scroll;
      const link = drawn[r.n];
      if (link && row >= 0 && row < room && r.from + 1 < w) this.hits.push({ row: top + row, from: r.from + 1, to: Math.min(w, r.to + 1), link, elem: firstOf.get(r.n) || undefined });
    }
    for (const k of marks) {
      const row = k.row - this.scroll;
      if (row >= 0 && row < room) this.hits.push({ row: top + row, from: 0, to: 1, thread: k.thread, elem: `comment:${k.thread}` });
    }
    // The reading ruler: the current element's block, and a focus mark's, in one calm tint.
    const rulers = [current?.ruler, markRows].filter((r): r is [number, number] => !!r);
    const ruled = (row: number) => rulers.some(([a, b]) => row >= a && row < b);
    const lines = [...head, ...body.slice(this.scroll, this.scroll + room)].slice(0, Math.max(1, h)).map((l, i) => {
      const row = i < top ? i : i + this.scroll;
      return this.paintSelection(ruled(row) ? paintRange(pad(l, w), 0, w, RULER_BG) : l, row);
    });
    return room > 0 ? { lines, placements, scroll: { top: this.scroll, room, total: body.length } } : { lines, placements };
  }

  // ── properties ─────────────────────────────────────────────────────────────

  /** The summary line for `m`: its keys (the view's, yours, the environment's or the default) and text. */
  summary(m: Msg): { keys: string[]; source: string; text: string } {
    const { keys, source } = summaryKeys(this.viewKeys);
    return { keys, source, text: summarySegments(m.properties ?? [], keys).map(s => s.plain).join(" · ") };
  }

  /**
   * The summary line as drawn: its text, the line with linked values coloured as links, and where each
   * linked value sits (columns from the line's start).
   */
  private summaryView(m: Msg, src: Source | null) {
    const segs = summarySegments(m.properties ?? [], this.summary(m).keys);
    const prefix = workIdPrefix(src) ?? null;
    const links: { from: number; to: number; link: Link; key: string }[] = [];
    let col = 0, line = "";
    segs.forEach((s, i) => {
      if (i) { line += " · "; col += 3; }
      line += s.label + " "; col += [...s.label].length + 1;
      s.value.split(", ").forEach((v, j) => {
        if (j) { line += ", "; col += 2; }
        const t = valueTarget(s.key, v, prefix), n = [...v].length;
        if (t) { links.push({ from: col, to: col + n, link: t, key: s.key }); line += fg(C.lcyan) + v + fg(C.lgreen); }
        else line += v;
        col += n;
      });
    });
    return { text: segs.map(s => s.plain).join(" · "), line, links };
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
  async followValue(r: Pick<PropRow, "key" | "target">, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | null> {
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
    host.navigate(target, how);
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

  /**
   * Open a draft on the note as the service has it now, not as this surface last drew it. `still` is the
   * host's say, once the service has answered, that the draft is still wanted (the person may have pressed
   * esc or moved on while it was read); without it the draft opens anyway.
   */
  async edit(host: SurfaceHost, external = false, still?: () => boolean): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    const fresh = await host.ctx.board.get(m.id);
    if (still && !still()) return;
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
    const a = completionKey(d, k, this.completer(d, host));
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

  /**
   * The draft's reference completion (PIE-416), from this reader's connection. A note draft can point at
   * its own headings (`((#`), as typed so far; a comment or reply has no note of its own.
   */
  completer(d: Draft, host: SurfaceHost) {
    return completerFor(d, host.ctx.board, () => host.redraw(), () => (d === this.draft ? { blockId: d.blockId, text: d.text } : undefined));
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
      complete: d => this.completer(d, host),
      flash: m => host.ctx.flash(m),
      redraw: () => host.redraw(),
      actor,
    };
  }

  /**
   * `C`: pick a passage of the note as the service has it now; `m`: the thread list. `still` as for `edit`.
   * `mine`: the person's own keys, so the text they selected is where the passage starts (an agent's
   * comment never takes the person's selection).
   */
  async comment(host: SurfaceHost, mode: "select" | "threads", still?: () => boolean, mine = true): Promise<void> {
    const m = this.msg;
    if (!m || this.editing) return;
    // Text selected in the reader is where the passage picker starts: the same text, as a quote.
    const picked = mine && mode === "select" && this.selection ? this.sourceOf(this.selection) : null;
    const fresh = mode === "select" || m.partial ? await host.ctx.board.get(m.id) : m;
    if (still && !still()) return;
    if (!fresh || fresh.revision === undefined) { host.ctx.flash("can't comment: the outline didn't say which revision this note is at"); return; }
    if (this.msg?.id !== m.id || this.editing) return;
    this.msg = fresh;
    if (this.commentsFor !== m.id) await this.loadComments(host);
    if ((still && !still()) || this.msg?.id !== m.id || this.editing) return;
    this.session = new CommentSession(fresh, this.comments ?? [], mode);
    // From a comment mark (⏎, a click, or `m` while on one): the list opens on its thread.
    const on = mine && mode === "threads" && this.cur?.startsWith("comment:") ? this.cur.slice(8) : null;
    const t = on ? this.session.threads.findIndex(x => x.id === on) : -1;
    if (t >= 0) this.session.sel = t;
    const p = this.session.passage;
    if (p && picked && fresh.text === m.text && picked.to > picked.from) { p.from = picked.from; p.to = picked.to; this.selection = null; }
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
    // Selecting text (PIE-419): v starts the keyboard mode, y Y copy, esc lets go; the rest read on.
    if ((c === "v" || c === "y" || c === "Y" || this.selection) && this.msg && this.selectKey(k, host)) return true;
    if ((c === "i" || c === "I") && this.msg) { this.openPanel(c === "I"); host.redraw(); return true; }
    if (c === "C" && this.msg) { void this.comment(host, "select"); return true; }
    // c collapses where a pane can (the board's readers and lanes, which take it first); comment is C.
    if (c === "c") { host.ctx.flash("nothing collapses here · C comments on a passage"); return true; }
    if (c === "m" && this.msg) { void this.comment(host, "threads"); return true; }
    if (c === "e" && this.msg) { void this.edit(host); return true; }
    if (k.kind === "char" && k.ctrl && k.ch === "e" && this.msg) { void this.edit(host, true); return true; }
    // The current element (`[ ]`, `( )`, a click) is let go by esc and by moving on (scrolling, following,
    // u), so ⏎ has its usual meaning again (in the board's preview: open the note in a detail). Then esc
    // lets go of a focus mark someone set here.
    if (k.kind === "esc" && (this.cur || this.link >= 0)) { this.letGo(); host.redraw(); return true; }
    if (k.kind === "esc" && this.focusMark) { host.ctx.flash(`let go of the focus mark ${agentLabel(this.focusMark.by)} set`); this.focusMark = null; host.redraw(); return true; }
    if (isUp(k)) { this.letGo(); this.scroll = Math.max(0, this.scroll - 1); host.redraw(); return true; }
    if (isDown(k)) { this.letGo(); this.scroll++; host.redraw(); return true; }
    if (k.kind === "pgdn" || c === " ") { this.letGo(); this.scroll += 15; host.redraw(); return true; }
    if (k.kind === "pgup") { this.letGo(); this.scroll = Math.max(0, this.scroll - 15); host.redraw(); return true; }
    // [ ] walk every element in reading order (PIE-441); ( ) below stays the folds-only jump.
    if (c === "]" || c === "[") { if (!this.step(c === "]" ? 1 : -1)) host.ctx.flash("nothing to step to: this note has no links, folds, figure rows, embeds or comments"); host.redraw(); return true; }
    if (c === "z") { this.unfold = !this.unfold; host.redraw(); return true; }
    // ⏎ acts on the current element while the person can see it: a link follows (where is the host's call),
    // a fold toggles, a row or an embed opens its note, a comment mark its thread. alt+⏎ opens a link, a
    // row or an embed in a new reader. Otherwise ⏎ isn't the reader's.
    if (k.kind === "enter" || k.kind === "alt-enter") {
      const fresh = k.kind === "alt-enter", e = this.inView();
      if (e) { if (fresh && !opens(e)) return false; void this.enterElement(e, host, { fresh }); host.redraw(); return true; }
      if (!this.cur && this.links[this.link]) { void this.follow(this.link, host, fresh); return true; }
      return false;
    }
    if ((c === "(" || c === ")") && this.msg && !this.msg.partial) { if (!this.stepFold(c === ")" ? 1 : -1)) host.ctx.flash("this note has no headings or nested lists to fold"); host.redraw(); return true; }
    if (c === "f" && this.msg && !this.msg.partial) {
      const p = this.foldTargetAtKeys();
      if (p) this.setFold(p, !this.folded.has(p.key)); else host.ctx.flash("nothing to fold here · ( ) pick a heading or a list item");
      host.redraw(); return true;
    }
    if (c === "F" && this.msg && !this.msg.partial) { const n = this.foldAll(this.folded.size === 0); host.ctx.flash(n ? `${this.folded.size ? `folded ${n}` : `unfolded ${n}`}` : "this note has no headings or nested lists to fold"); host.redraw(); return true; }
    if (c === "u" && this.msg?.parentId) { this.letGo(); void this.up(host); return true; }
    return false;
  }

  /**
   * The wheel, whatever the surface is doing: the note scrolls (under an inline property panel too), a
   * full panel moves its selection, a draft moves its cursor. A comment session keeps its own place.
   */
  wheel(dir: 1 | -1, host: SurfaceHost) {
    const P = this.panel, m = this.msg;
    // Over an open completion popup the wheel moves through its candidates.
    const pop = this.writing();
    if (pop && completerOf(pop)?.shown) { completerOf(pop)!.move(dir); return; }
    if (this.draft) { if (!this.draft.busy) for (let i = 0; i < 3; i++) this.draft.key({ kind: dir > 0 ? "down" : "up" }); }
    else if (this.session) return;
    else if (P?.full && m && !m.partial && !P.field) { const n = this.rows(m).length; if (n) P.sel = Math.max(0, Math.min(n - 1, P.sel + dir * 3)); }
    else { this.letGo(); this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + dir * 3)); }
    host.redraw();
  }

  /** The draft or comment being written here, if any. */
  private writing(): Draft | null {
    return this.draft ?? (this.session?.mode === "compose" ? this.session.composer : null);
  }

  /**
   * Reading keys only (j k, arrows, PgUp PgDn, space, Home End): scroll the note without starting or
   * touching an edit, a comment or the panel. Hosts use it for a reader holding a session the person
   * isn't in. True when the key was one of them.
   */
  scrollKey(k: Key, host: SurfaceHost): boolean {
    // A draft or a comment session renders in place of the note, and its view follows its own cursor:
    // there is no note to scroll, so the keys aren't claimed (and the agent's cursor isn't moved).
    if (!this.scrolls()) return false;
    const c = ch(k);
    const by = isUp(k) ? -1 : isDown(k) ? 1 : k.kind === "pgdn" || c === " " ? 15 : k.kind === "pgup" ? -15 : k.kind === "home" ? -1e9 : k.kind === "end" ? 1e9 : 0;
    if (!by) return false;
    this.letGo();
    this.scroll = Math.max(0, Math.min(this.maxScroll, this.scroll + by));
    host.redraw();
    return true;
  }

  // ── folds ──────────────────────────────────────────────────────────────────

  /** The note's readable source, the note line each of its lines comes from, and its fold points. */
  foldsIn(m: Msg): { text: string; lines: number[]; points: FoldPoint[] } {
    const r = readableSource(m, this.src);
    const sig = r.text + "\0" + r.anchors.join("\0");
    if (this.foldCache?.text !== sig) this.foldCache = { text: sig, points: foldPoints(r.text, r.anchors), lines: r.lines };
    return { text: r.text, lines: r.lines, points: this.foldCache.points };
  }

  /** The fold points drawn now: none inside a folded section or item. */
  visibleFolds(m: Msg): FoldPoint[] {
    const out: FoldPoint[] = [];
    let hideTo = -1;
    for (const p of this.foldsIn(m).points) {
      if (p.line < hideTo) continue;
      out.push(p);
      if (this.folded.has(p.key)) hideTo = p.end;
    }
    return out;
  }

  /**
   * Fold (or unfold) `p`. By the person's keys or click it becomes the selected fold point, kept in view;
   * an agent's fold leaves their selection and scroll where they were.
   */
  setFold(p: FoldPoint, on: boolean, select = true) {
    if (on) this.folded.add(p.key); else this.folded.delete(p.key);
    if (select) { this.foldSel = p.key; this.link = -1; this.reveal = true; }
  }

  /**
   * Fold every outermost heading and list item, or unfold everything. How many changed. By the person's
   * keys (`select`) their selection stays in view, or is let go when a fold hides it; an agent's leaves
   * their selection and scroll where they were.
   */
  foldAll(on: boolean, select = true): number {
    if (!on) { const n = this.folded.size; this.folded.clear(); if (select) this.reveal = !!this.foldSel; return n; }
    const all = this.msg ? this.foldsIn(this.msg).points : [];
    const outer = all.filter(p => !all.some(q => q.line < p.line && p.line < q.end));
    for (const p of outer) this.folded.add(p.key);
    if (select && this.foldSel && !outer.some(p => p.key === this.foldSel)) this.foldSel = null;
    return outer.length;
  }

  /**
   * The fold point `( )` selected, while it's in view (drawn there, or about to be brought there by the
   * next render): what ⏎ folds.
   */
  private selectedFold(): FoldPoint | null {
    const m = this.msg, d = this.drawn;
    if (!this.foldSel || !m || m.partial) return null;
    const p = this.visibleFolds(m).find(p => p.key === this.foldSel);
    if (!p || this.reveal) return p ?? null;
    const row = d?.doc.heads.find(h => h.key === p.key)?.row;
    return d && row !== undefined && row >= d.scroll && row < d.scroll + d.room ? p : null;
  }

  /** `( )`: the previous or next fold point drawn (from the view when none is selected). False when there are none. */
  private stepFold(d: 1 | -1): boolean {
    const vis = this.visibleFolds(this.msg!);
    if (!vis.length) return false;
    const rowOf = (p: FoldPoint) => this.drawn?.doc.heads.find(h => h.key === p.key)?.row ?? 0;
    let i = vis.findIndex(p => p.key === this.foldSel);
    if (i >= 0) i = (i + d + vis.length) % vis.length;
    else if (d === 1) { i = vis.findIndex(p => rowOf(p) >= this.scroll); if (i < 0) i = 0; }
    else { const bottom = this.scroll + (this.drawn?.room ?? 0); i = vis.findLastIndex(p => rowOf(p) < bottom); if (i < 0) i = vis.length - 1; }
    this.foldSel = vis[i]!.key; this.link = -1; this.reveal = true;
    return true;
  }

  /**
   * What `f` folds: the selected fold point, or else the section being read (the innermost heading around
   * the top of the view; failing that, the innermost list item there).
   */
  private foldTargetAtKeys(): FoldPoint | null {
    const m = this.msg!;
    const vis = this.visibleFolds(m);
    const sel = vis.find(p => p.key === this.foldSel);
    if (sel) return sel;
    const d = this.drawn;
    const top = d ? d.doc.source[d.scroll] ?? 0 : 0;
    const around = vis.filter(p => p.line <= top && top < Math.max(p.end, p.line + 1));
    return around.findLast(p => p.kind === "heading") ?? around.at(-1) ?? null;
  }

  /**
   * A click in the reader, at column `x` and row `y` of what `render` returned, that isn't on a link: on a
   * heading, or on a list item's mark, it folds or unfolds it. False when the click wasn't on one.
   */
  private clickFold(x: number, y: number, host: SurfaceHost): boolean {
    const d = this.drawn, m = this.msg;
    if (!d || !m || this.draft || this.session) return false;
    const row = y - d.top;
    // Only the surface's own cells: a host's frame and its scroll thumb (drawn on the border) never fold.
    if (row < 0 || row >= d.room || x < 0 || x >= d.w) return false;
    const h = d.doc.heads.find(x => x.row === d.scroll + row);
    // The body is drawn one column in from the reader's edge.
    if (!h || x > h.cols + 1) return false;
    const p = this.foldsIn(m).points.find(p => p.key === h.key);
    if (!p) return false;
    this.setFold(p, !this.folded.has(p.key));
    host.redraw();
    return true;
  }

  /** The folds for `peek`: how many fold points, which are folded, and the one the keys selected. */
  private describeFolds(m: Msg) {
    const points = this.foldsIn(m).points, sel = points.find(p => p.key === this.foldSel);
    return { points: points.length, folded: points.filter(p => this.folded.has(p.key)).map(foldLabel), selected: sel ? foldLabel(sel) : null };
  }

  /** The note line (from 0, the subject line) reader row `y` of the last render shows, or null off the note's body. */
  sourceLineAt(y: number): number | null {
    const d = this.drawn;
    if (!d) return null;
    const row = y - d.top;
    if (row < 0 || row >= d.room) return null;
    const body = d.doc.source[d.scroll + row];
    return body === undefined ? null : d.lines[body] ?? null;
  }

  private stepLink(d: 1 | -1) {
    const n = this.links.length;
    if (n) this.link = d === 1 ? (this.link + 1) % n : this.link <= 0 ? n - 1 : this.link - 1;
  }

  /** ⏎ on a selected link: media open in the system viewer, blocks and pages open through the host. */
  private follow(i: number, host: SurfaceHost, fresh = false): Promise<Msg | null> {
    const l = this.links[i];
    return l ? this.followTarget(l, host, { link: true, fresh }) : Promise.resolve(null);
  }

  // ── elements: what [ ] walks, ⏎ acts on and the ruler tints (PIE-441) ─────

  /** Nothing is current: the next `[ ]` starts from the view, and ⏎ is the host's again. */
  private letGo() { this.cur = null; this.link = -1; }

  private setElem(e: Element) {
    this.cur = e.key;
    const l = e.link;
    this.link = l ? this.links.findIndex(x => sameLink(x, l)) : -1;
  }

  /** The current element while the person can see it (or it's about to be brought into view). */
  private inView(): Element | null {
    const e = this.elems.find(x => x.key === this.cur), d = this.drawn;
    if (!e || !d) return null;
    if (this.reveal || e.row < d.top) return e;
    const r = e.row - d.top;
    return r >= d.scroll && r < d.scroll + d.room ? e : null;
  }

  /**
   * `[ ]`: the previous or next element in reading order, from the current one, or from the view when none
   * is current. Where nothing is drawn (the river draws its own body), the links.
   * False when there's nothing to step to.
   */
  private step(d: 1 | -1): boolean {
    const v = this.drawn, es = this.elems;
    if (!v) { if (!this.links.length) return false; this.cur = null; this.stepLink(d); return true; }
    const n = es.length;
    if (!n) return false;
    // From the current element even when it's out of view (an agent's focus mark scrolled the reader):
    // only the person's own scrolling lets go of it.
    let i = es.findIndex(e => e.key === this.cur);
    if (i >= 0) i = (i + d + n) % n;
    else if (d === 1) { const from = v.scroll ? v.top + v.scroll : 0; i = es.findIndex(e => e.row >= from); if (i < 0) i = 0; }
    else { const bottom = v.top + v.scroll + v.room; i = es.findLastIndex(e => e.row < bottom); if (i < 0) i = n - 1; }
    this.setElem(es[i]!);
    this.reveal = true;
    return true;
  }

  /**
   * ⏎ (or a click) on an element. The person's (`select`, the default) becomes their `[ ]` position; an
   * agent's leaves it where it was (a fold it toggles isn't selected, a thread list is its own session).
   */
  private async enterElement(e: Element, host: SurfaceHost, { fresh = false, select = true }: { fresh?: boolean; select?: boolean } = {}): Promise<unknown> {
    if (select) this.setElem(e);
    if (e.kind === "fold") {
      const p = this.msg ? this.foldsIn(this.msg).points.find(p => `fold:${p.key}` === e.key) : undefined;
      if (!p) return null;
      this.setFold(p, !this.folded.has(p.key), select);
      host.redraw();
      return { folded: this.folded.has(p.key) };
    }
    if (e.kind === "comment") { if (select) this.openThread(host); return { thread: e.thread }; }
    const how: OpenHow = { link: true, fresh };
    const l = e.link!;
    if (e.value !== undefined) return this.followValue({ key: e.value, target: l.block ? { block: l.block } : { page: l.page! } }, host, how);
    return this.followTarget(l, host, how);
  }

  /** The thread list, on the current comment mark's thread, as the person's `m` opens it (their session). */
  private openThread(host: SurfaceHost) {
    if (host.startSession) host.startSession("threads");
    else void this.comment(host, "threads");
  }

  /** The comment threads placed in the note, each on the rows of the lines its quote spans. */
  private commentMarks(m: Msg, doc: Doc, noteLines: number[]): Mark[] {
    const cs = this.commentsFor === m.id ? this.comments ?? [] : [];
    if (!cs.length) return [];
    const lineOf = lineAtOffset(m.text);
    const out: Mark[] = [];
    for (const c of cs) {
      if (c.start === null || c.end === null) continue;
      const lo = lineOf(c.start), hi = lineOf(Math.max(c.start, c.end - 1));
      const rows = rowsOfLines(doc, noteLines, lo, hi);
      if (!rows) continue;
      const q = printable(c.quote).trim();
      out.push({ thread: c.id, open: c.open, row: rows[0], rows, label: `"${q.length > 40 ? q.slice(0, 39) + "…" : q}" · ${c.author}${c.open ? "" : " · resolved"}` });
    }
    return out;
  }

  /** Everything `[ ]` can stop on in this render, in reading order (content rows, then columns). */
  private elementsOf(doc: Doc, drawn: Link[], marks: Mark[], summary: { from: number; to: number; link: Link; key: string }[], points: readonly FoldPoint[], top: number, head: string[]): Element[] {
    const out: Element[] = [];
    const seen = new Map<string, number>();
    const keyOf = (kind: string, l: Link) => {
      const id = `${kind}:${[l.block ?? "", l.fragment ?? "", l.label ?? "", l.page ?? "", l.media ?? ""].join("|")}`;
      const n = seen.get(id) ?? 0;
      seen.set(id, n + 1);
      return `${id}#${n}`;
    };
    // The block a body row is in: the rows drawn from the same source line (a paragraph, a list item, a
    // heading, a whole table, callout or figure).
    const block = (r: number): [number, number] => {
      const s = doc.source[r];
      let a = r, b = r + 1;
      while (a > 0 && doc.source[a - 1] === s) a--;
      while (b < doc.source.length && doc.source[b] === s) b++;
      return [top + a, top + b];
    };
    const text = (line: string, from: number, to: number) => cellsOf(line).slice(from, to).join("").trim();
    const sum = head[1] ?? "";
    for (const l of summary) out.push({ key: keyOf("link", l.link), kind: "link", row: 1, from: l.from, to: l.to, ruler: [1, 2], label: `${l.key} ${text(sum, l.from, l.to)}`, link: l.link, value: l.key });
    const byN = new Map<number, typeof doc.links>();
    for (const r of doc.links) { const g = byN.get(r.n); if (g) g.push(r); else byN.set(r.n, [r]); }
    for (const [n, rs] of byN) {
      const l = drawn[n], r = rs[0]!;
      if (!l) continue;
      const kind: ElementKind = l.role ?? "link";
      // An embed's ruler is its shaded region; a row's is itself; a link's is the block it's in.
      let ruler = block(r.line);
      if (kind === "row") ruler = [top + r.line, top + r.line + 1];
      else if (kind === "embed") { let b = r.line + 1; while (b < doc.lines.length && doc.lines[b]!.startsWith(SHADE)) b++; ruler = [top + r.line, top + b]; }
      out.push({ key: keyOf(kind, l), kind, row: top + r.line, from: r.from + 1, to: r.to + 1, ruler, label: rs.map(x => text(doc.lines[x.line]!, x.from, x.to)).join(" "), link: l });
    }
    for (const x of doc.media) out.push({ key: keyOf("link", { media: x.path }), kind: "link", row: top + x.row, from: 1, to: 1 + width(doc.lines[x.row] ?? ""), ruler: block(x.row), label: x.path.split("/").pop() ?? x.path, link: { media: x.path } });
    for (const hd of doc.heads) {
      const p = points.find(p => p.key === hd.key);
      if (p) out.push({ key: `fold:${p.key}`, kind: "fold", row: top + hd.row, from: 1, to: hd.cols + 1, ruler: block(hd.row), label: foldLabel(p), fold: p.key });
    }
    for (const k of marks) out.push({ key: `comment:${k.thread}`, kind: "comment", row: top + k.row, from: 0, to: 1, ruler: [top + k.rows[0], top + k.rows[1]], label: k.label, thread: k.thread });
    return out.sort((a, b) => a.row - b.row || a.from - b.from);
  }

  /** The content rows [from, to) a focus mark covers in this render, or null when it isn't drawn. */
  private focusRows(spec: FocusSpec, m: Msg, doc: Doc, noteLines: number[], top: number): [number, number] | null {
    const body = (lo: number, hi: number): [number, number] | null => {
      const r = rowsOfLines(doc, noteLines, lo, hi);
      return r ? [top + r[0], top + r[1]] : lo === 0 ? [0, 1] : null;
    };
    if (spec.quote !== undefined) {
      const at = findQuote(m.text, spec.quote, spec.near);
      if (at < 0) return null;
      const lineOf = lineAtOffset(m.text);
      return body(lineOf(at), lineOf(at + Math.max(0, spec.quote.length - 1)));
    }
    if (spec.line !== undefined) return body(spec.line - 1, (spec.to ?? spec.line) - 1);
    if (spec.block !== undefined) {
      if (sameId(spec.block, m.id)) return [0, 1];      // the note itself: its title
      const e = this.elems.find(e => e.kind === "embed" && sameId(spec.block!, e.link!.block)) ?? this.elems.find(e => sameId(spec.block!, e.link?.block));
      return e ? e.ruler : null;
    }
    return null;
  }

  /**
   * Set a focus mark (PIE-423's door side): a block (the note, or one it embeds or links), note lines, or
   * an exact passage of the note's text, checked against what this reader draws now. It's drawn in the
   * ruler's tint, whoever set it named in the header, and scrolled into view when it isn't; the person's
   * `[ ]` position, selection and keys stay theirs.
   */
  setFocus(spec: FocusSpec, by: Actor): { marked: string; rows: number } {
    const m = this.msg, d = this.drawn;
    if (!m || !d) throw new ActionRefused("this reader doesn't draw the note now (it's editing, commenting, reading the note, showing the full property panel, or it's a river column's digest)");
    // A block, and in it maybe a passage (lines or exact words): the passage is found in the note shown.
    const within = [spec.line, spec.quote].filter(x => x !== undefined).length;
    if (within > 1 || (!within && spec.block === undefined)) throw new ActionRefused("say what to mark: block= (this note, or one it embeds or links), and in this note maybe line= (with to= for a range; 1 is the subject) or quote= (its exact words; near= picks among repeats)");
    if (within && spec.block !== undefined && !sameId(spec.block, m.id)) throw new ActionRefused(`a passage is found in the note this reader shows (${m.id.slice(0, 8)}); name it as block=, or leave block out`);
    if (spec.to !== undefined && spec.line === undefined) throw new ActionRefused("to= goes with line=");
    if (spec.near !== undefined && spec.quote === undefined) throw new ActionRefused("near= goes with quote=");
    if (spec.line !== undefined && (spec.line < 1 || (spec.to ?? spec.line) < spec.line)) throw new ActionRefused("line is from 1 (the subject), and to isn't before it");
    if (spec.quote !== undefined && !spec.quote.trim()) throw new ActionRefused("quote is empty");
    if (spec.quote !== undefined && findQuote(m.text, spec.quote, spec.near) < 0) throw new ActionRefused(`"${spec.quote.length > 40 ? spec.quote.slice(0, 39) + "…" : spec.quote}" isn't in the note's current text`);
    const rows = this.focusRows(spec, m, d.doc, d.lines, d.top);
    if (!rows) {
      if (spec.block !== undefined) throw new ActionRefused(`this note doesn't embed or link ${spec.block} where it's drawn; to mark another note, open it first`);
      throw new ActionRefused("nothing of that is drawn here (past the end, only properties, or in a folded section; unfold it first)");
    }
    const q = spec.quote?.trim() ?? "";
    const label = spec.quote !== undefined ? `"${q.length > 40 ? q.slice(0, 39) + "…" : q}"`
      : spec.line !== undefined ? `line${spec.to && spec.to !== spec.line ? `s ${spec.line}–${spec.to}` : ` ${spec.line}`}`
      : sameId(spec.block!, m.id) ? "this note" : (this.elems.find(e => sameId(spec.block!, e.link?.block))?.label ?? spec.block!).slice(0, 40);
    this.focusMark = { by, spec, label, at: Date.now() };
    this.revealMark = true;
    return { marked: label, rows: rows[1] - rows[0] };
  }

  /** The elements as `peek` and the `elements` action list them. */
  describeElements() {
    return this.elems.map((e, i) => ({
      n: i + 1, kind: e.kind, label: printable(e.label), current: e.key === this.cur,
      ...(e.link ? { target: e.link.block ?? e.link.page ?? e.link.media } : {}), ...(e.thread ? { thread: e.thread } : {}),
    }));
  }

  /** Refused unless the last render drew the note (the elements come from it). */
  requireDrawn() {
    if (!this.drawn) throw new ActionRefused("this reader doesn't draw the note now (it's editing, commenting, reading the note, or it's a river column's digest; link.select steps a river column's links)");
  }

  /** Element `n` (from 1) of the last render. */
  element(n: number): Element {
    this.requireDrawn();
    const e = this.elems[n - 1];
    if (!e) throw new ActionRefused(`there is no element ${n}; the reader draws ${this.elems.length} (elements lists them)`);
    return e;
  }

  /** `element.select`: the person's `[ ]` position, brought into view. */
  selectElement(e: Element) { this.setElem(e); this.reveal = true; }
  /** `element.open`: ⏎ on element `e` (see enterElement). */
  openElement(e: Element, host: SurfaceHost, fresh: boolean, select: boolean) { return this.enterElement(e, host, { fresh, select }); }

  /**
   * A click in the last render (`x`, `y` in the surface's cells). While an edit, a comment or a value
   * being typed holds the surface, only a completion candidate takes it (chosen and inserted, as Enter
   * does). Otherwise a link opens where ⏎ on it would (and becomes the selected `[ ]` link when it is one
   * of them); a property panel row is selected, and a click on its linked value follows it. Elsewhere on
   * a heading, or on a list item's mark, it folds or unfolds it (clickFold). False when nothing is there.
   */
  click(x: number, y: number, host: SurfaceHost): boolean {
    this.use(host);
    if (this.editing) {
      const d = this.writing();
      return !!d && !d.busy && !!completerOf(d)?.click(y);
    }
    const at = this.hits.filter(h => h.row === y && x >= h.from && x < h.to);
    const h = at.find(h => "copy" in h || "link" in h || "thread" in h || ("follow" in h && h.follow)) ?? at[0];
    if (h && "copy" in h) { this.copySelection(h.copy === "source", host); host.redraw(); return true; }
    // A click anywhere else lets go of the selection, and does what it always did.
    if (this.selection) { this.selection = null; host.redraw(); }
    if (!h) return this.clickFold(x, y, host);
    // A comment mark: its thread opens, as ⏎ on it does, and it's the `[ ]` position (PIE-441).
    if ("thread" in h) {
      const e = this.elems.find(e => e.key === h.elem);
      if (e) void this.enterElement(e, host);
      host.redraw();
      return !!e;
    }
    if ("prop" in h) {
      const m = this.msg, r = m && this.panel ? this.rows(m)[h.prop - 1] : undefined;
      if (!r || !this.panel) return false;
      this.panel.sel = h.prop - 1; this.panel.note = "";
      if (h.follow) void this.followValue(r, host);
      host.redraw();
      return true;
    }
    // A link (in the text, the summary line, an embed's title, a figure's row): the `[ ]` position, then
    // it opens where ⏎ on it would.
    const e = h.elem ? this.elems.find(e => e.key === h.elem) : undefined;
    if (e) this.setElem(e);
    else { const i = this.links.findIndex(x => sameLink(x, h.link)); if (i >= 0) { this.cur = null; this.link = i; } }
    host.redraw();
    // A summary-line value: the same resolution as the panel's `o` (no fuzzy search; the panel closes).
    if (h.value !== undefined) void this.followValue({ key: h.value, target: h.link.block ? { block: h.link.block } : { page: h.link.page! } }, host, { link: true });
    else void this.followTarget(h.link, host, { link: true });
    return true;
  }

  /**
   * Open a link the host drew itself (the river's note body): it becomes the selected `[ ]` link when
   * it is one of them, then opens where ⏎ on it would.
   */
  open(l: Link, host: SurfaceHost, fresh = false): Promise<Msg | null> {
    const i = this.links.findIndex(x => sameLink(x, l));
    if (i >= 0) { this.cur = null; this.link = i; }
    host.redraw();
    return this.followTarget(l, host, { link: true, fresh });
  }

  /** Open what a link names: media in the system viewer, blocks and pages through the host (`how`, where). */
  private async followTarget(l: Link, host: SurfaceHost, how: OpenHow = { link: true }): Promise<Msg | null> {
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
    host.navigate(target, how);
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

  // ── selecting text (PIE-419) ───────────────────────────────────────────────

  /** The last render's rows, by content row: the header's (its rule isn't text), then the body's (margin left out). */
  private selRows(): SelectRows | null {
    const d = this.drawn;
    if (!d) return null;
    const cache = new Map<number, string[]>();
    return {
      count: d.top + d.body.length,
      cells: r => {
        let c = cache.get(r);
        if (!c) cache.set(r, c = r === d.top - 1 || r < 0 ? [] : cellsOf((r < d.top ? d.head[r] : d.body[r - d.top]) ?? ""));
        return c;
      },
      margin: r => (r < d.top ? 0 : 1),
    };
  }

  /**
   * The content cell under `x`, `y` of the last render, or null outside it. `edge` (a drag): past the
   * body's bottom or top the note scrolls a row and the selection follows it to the edge.
   */
  private posAt(x: number, y: number, edge = false): Pos | null {
    const d = this.drawn;
    if (!d) return null;
    const col = Math.max(0, Math.min(d.w - 1, x));
    if (!edge && (x < 0 || x >= d.w || y < 0 || y >= d.top + d.room)) return null;
    const body = (row: number) => ({ row: d.top + this.scroll + row, col });
    if (y >= d.top + d.room) {
      if (this.scroll < this.maxScroll) this.scroll++;
      return d.room > 0 ? body(d.room - 1) : null;
    }
    if (y < d.top && edge && this.scroll > 0 && this.selection && this.selection.anchor.row >= d.top) {
      this.scroll--;
      return body(0);
    }
    if (y < d.top) return { row: Math.max(0, y), col };
    return body(y - d.top);
  }

  private stamp(s: Selection): Selection { s.w = this.drawn?.w ?? 0; s.top = this.drawn?.top ?? 0; return s; }

  renderedWidth() { return this.drawn?.w ?? 0; }
  renderedTop() { return this.drawn?.top ?? 0; }

  clearSelections() { this.selection = null; this.agentSelection = null; this.gesture.cancel(); this.dragging = false; }

  /**
   * The mouse button went down at `x`, `y`. Nothing happens yet (release decides: a click, or a drag that
   * selected), except a second or third press on the same cell: it selects the word, then the row.
   */
  press(x: number, y: number, host: SurfaceHost): void {
    this.use(host);
    this.dragging = false;
    const n = this.gesture.press(x, y);
    if (n < 2 || this.editing) return;
    const rows = this.selRows(), p = this.posAt(x, y);
    if (!rows || !p || !rows.cells(p.row).length) return;
    this.selection = this.stamp(n === 2 ? wordAt(rows, p) : lineAt(rows, p.row));
    host.redraw();
  }

  /** The pointer moved with the button down: once off the pressed cell, it selects from there. */
  drag(x: number, y: number, host: SurfaceHost): void {
    const g = this.gesture.pressed;
    if (!g || !this.gesture.drag(x, y) || this.editing || !this.drawn) return;
    if (!this.dragging) {
      // After a double or triple click, the drag extends from the word or row it selected.
      const from = g.n > 1 && this.selection ? this.selection.start : this.posAt(g.x, g.y);
      if (!from) { this.gesture.cancel(); return; }
      this.dragging = true;
      this.selection = this.stamp(new Selection({ ...from }, { ...from }));
    }
    const at = this.posAt(x, y, true);
    if (at && this.selection) this.selection.head = at;
    host.redraw();
  }

  /**
   * The button came up. On the cell it went down on, with no drag, it's a click (`click`: a link, a fold, a
   * panel row, the copy control; anywhere else it lets go of the selection). A drag keeps what it
   * selected, and never copies it. True when the release did something.
   */
  release(x: number, y: number, host: SurfaceHost): boolean {
    const r = this.gesture.release(x, y);
    this.dragging = false;
    if (r.click) {
      // A click that did something (a link, a fold, a panel row) isn't the first half of a double click.
      const acted = this.click(x, y, host);
      if (acted) this.gesture.forget();
      return acted;
    }
    host.redraw();
    return r.moved || r.n > 1;
  }

  /** The selection's line in the header: how much is selected, and the copy control. */
  private selectionControl(w: number) {
    const d = this.drawn!;
    // Another width rewraps the body: the selection would point at other text, so it goes. A header that
    // grew or shrank (a notice, an agent's line, the inline panel: all drawn just above the rule) moves
    // the rule and the body; a selection's ends there move with them, and ends on the title, summary,
    // byline or crumbs stay. So an agent's action never takes the person's selection away.
    const keep = (s: Selection | undefined): boolean => {
      if (!s) return true;
      if (s.w !== w) return false;
      const by = d.top - s.top;
      if (by) {
        const move = (p: Pos): Pos => (p.row >= s.top - 1 ? { ...p, row: p.row + by } : p);
        s.anchor = move(s.anchor); s.head = move(s.head); s.top = d.top;
      }
      return true;
    };
    if (!keep(this.selection ?? undefined)) this.selection = null;
    if (!keep(this.agentSelection?.sel)) this.agentSelection = null;
    const s = this.selection, rows = s && this.selRows();
    if (!s || !rows || d.top < 1) return;
    const n = [...s.text(rows)].length, copy = "[y copy]", source = "[Y source]";
    const lead = `── ${n} chars `;
    const at = d.top - 1, wide = lead.length + copy.length + 1 + source.length <= w, fits = lead.length + copy.length <= w;
    const from = fits ? lead.length : 0;
    if (copy.length > w) return;
    this.hits.push({ row: at, from, to: from + copy.length, copy: "visible" });
    if (wide) this.hits.push({ row: at, from: from + copy.length + 1, to: from + copy.length + 1 + source.length, copy: "source" });
    const shown = (fits ? fg(C.blue) + "── " + fg(C.white) + `${n} chars ` : "") + fg(C.lcyan) + copy + (wide ? " " + source : "");
    d.head[at] = pad(shown + fg(C.blue) + "─".repeat(Math.max(0, w - width(shown))), w) + RESET;
  }

  /** Row `row`'s drawn line with the selections on it painted: an agent's, then the person's over it. */
  private paintSelection(line: string, row: number): string {
    // The body's margin cell is never copied, so it isn't tinted either.
    const m = this.drawn && row >= this.drawn.top ? 1 : 0;
    const a = this.agentSelection?.sel.span(row), p = this.selection?.span(row);
    if (a) line = paintRange(line, Math.max(m, a[0]), a[1], AGENT_BG);
    if (p) line = paintRange(line, Math.max(m, p[0]), p[1], SELECT_BG);
    return line;
  }

  /**
   * `v`, `y`, `Y`, and while there's a selection esc (and in the keyboard mode its movement keys). True
   * when the key was the selection's; the reader's other keys keep their meaning.
   */
  private selectKey(k: Key, host: SurfaceHost): boolean {
    const c = ch(k), rows = this.selRows(), s = this.selection;
    if (!rows) return false;
    if (!s) {
      if (c === "y" || c === "Y") { host.ctx.flash("nothing is selected · drag across the text, or v and move"); return true; }
      if (c !== "v") return false;
      // The keyboard mode starts where the reading is: the first row of the body in view.
      const d = this.drawn!, row = d.room > 0 && d.body.length ? d.top + this.scroll : 0;
      const at = { row, col: rows.margin?.(row) ?? 0 };
      this.selection = this.stamp(new Selection({ ...at }, { ...at }, true));
      this.letGo();
      host.redraw();
      return true;
    }
    if (c === "y" || c === "Y") { this.copySelection(c === "Y", host); host.redraw(); return true; }
    if (!s.keys) {
      if (c === "v") { s.keys = true; host.redraw(); return true; }
      if (k.kind === "esc") { this.selection = null; host.redraw(); return true; }
      return false;
    }
    const d = this.drawn!;
    const r = modeKey(k, s, rows, Math.max(1, d.room - 1));
    if (r === null) return false;
    if (r === "done") this.selection = null;
    else {
      // Keep the moving end in view.
      const b = s.head.row - d.top;
      if (b >= 0 && d.room > 0) { if (b < this.scroll) this.scroll = b; else if (b >= this.scroll + d.room) this.scroll = b - d.room + 1; }
    }
    host.redraw();
    return true;
  }

  /**
   * The note's own text behind a selection: exactly the selected words when they read the same in the
   * source (no link or formatting inside), else the whole source lines it covers. Offsets are into the
   * note's text, as the comment passage picker takes them. Null when only the header's details are selected.
   */
  sourceOf(s: Selection): { text: string; exact: boolean; from: number; to: number; lines: [number, number] } | null {
    const d = this.drawn, m = this.msg, rows = this.selRows();
    if (!d || !m || !rows) return null;
    const lines: number[] = [];
    for (let r = s.start.row; r <= s.end.row; r++) {
      if (r === 0) lines.push(0);                               // the subject line
      else if (r >= d.top) { const b = d.doc.source[r - d.top], l = b === undefined ? undefined : d.lines[b]; if (l !== undefined) lines.push(l); }
    }
    if (!lines.length) return null;
    const lo = Math.min(...lines), hi = Math.max(...lines), all = m.text.split("\n");
    const start = all.slice(0, lo).reduce((n, l) => n + l.length + 1, 0);
    const span = all.slice(lo, hi + 1).join("\n");
    const seen = s.text(rows);
    // A wrapped paragraph reads with a space where the reader broke it.
    for (const t of [seen, seen.replace(/\n/g, " ")]) {
      const at = t.trim() ? span.indexOf(t) : -1;
      if (at >= 0) return { text: t, exact: true, from: start + at, to: start + at + t.length, lines: [lo, hi] };
    }
    const lead = span.length - span.trimStart().length;
    return { text: span, exact: false, from: start + lead, to: start + span.trimEnd().length, lines: [lo, hi] };
  }

  /** `y` (what's drawn) or `Y` (its source) to the person's clipboard, said in the status bar. */
  copySelection(source: boolean, host: SurfaceHost): { text: string; chars: number; exact?: boolean; lines?: [number, number] } | null {
    const s = this.selection, rows = this.selRows();
    if (!s || !rows) return null;
    let text = s.text(rows), said = "";
    let src: ReturnType<NoteSurface["sourceOf"]> = null;
    if (source) {
      src = this.sourceOf(s);
      if (!src) { host.ctx.flash("no source to copy: only the header's details are selected · y copies them"); return null; }
      text = src.text;
      said = src.exact ? " of source" : ` of source · whole line${src.lines[0] === src.lines[1] ? ` ${src.lines[0] + 1}` : `s ${src.lines[0] + 1}–${src.lines[1] + 1}`}`;
    }
    if (!text.trim()) { host.ctx.flash("nothing to copy: only blanks are selected"); return null; }
    const chars = [...text].length;
    host.ctx.copy?.(text);
    host.ctx.flash(`copied ${chars} chars${said}`);
    return { text, chars, ...(src ? { exact: src.exact, lines: [src.lines[0] + 1, src.lines[1] + 1] as [number, number] } : {}) };
  }

  /**
   * A selection made by name, for `select`: `text` (as it's drawn, blanks and row breaks alike; `n` picks
   * the nth time it's drawn) or note lines `line` to `to` (1 is the subject). The whole drawn note, not
   * just the rows in view.
   */
  selectBy({ text, line, to, n }: { text?: string; line?: number; to?: number; n?: number }): Selection {
    const d = this.drawn, rows = this.selRows();
    if (!d || !rows || !this.msg) throw new ActionRefused("this reader doesn't show the note's text now (it's editing, commenting, reading the note, or the full property panel is open)");
    if ((text === undefined) === (line === undefined)) throw new ActionRefused("say what to select: text= (as the note reads) or line= (with to= for a range; 1 is the subject)");
    if (text !== undefined) {
      if (!text.trim()) throw new ActionRefused("text is empty");
      // The drawn rows as one text, remembering where each row starts.
      const starts: number[] = [];
      let flat = "";
      for (let r = 0; r < rows.count; r++) {
        starts.push(flat.length);
        flat += rows.cells(r).slice(rows.margin?.(r) ?? 0).join("").trimEnd() + "\n";
      }
      const re = new RegExp(text.trim().split(/\s+/).map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
      const hits = [...flat.matchAll(re)];
      const hit = hits[(n ?? 1) - 1];
      if (!hit) throw new ActionRefused(hits.length ? `it's drawn ${hits.length} time${hits.length === 1 ? "" : "s"}; n is 1 to ${hits.length}` : `"${text.length > 40 ? text.slice(0, 39) + "…" : text}" isn't drawn in this reader (links read as their titles; folded sections aren't drawn)`);
      const at = (off: number): Pos => {
        const row = starts.findLastIndex(s => s <= off);
        return { row, col: (rows.margin?.(row) ?? 0) + off - starts[row]! };
      };
      return new Selection(at(hit.index!), at(hit.index! + hit[0].length - 1));
    }
    const lo = line! - 1, hi = (to ?? line!) - 1;
    if (lo < 0 || hi < lo) throw new ActionRefused("line is from 1 (the subject), and to isn't before it");
    const hitRows: number[] = [];
    if (lo === 0) hitRows.push(0);
    d.doc.source.forEach((b, i) => { const l = d.lines[b]; if (l !== undefined && l >= lo && l <= hi) hitRows.push(d.top + i); });
    if (!hitRows.length) throw new ActionRefused(`nothing of lines ${line}${to ? `–${to}` : ""} is drawn (past the end, only properties, or folded)`);
    const first = hitRows[0]!, last = hitRows.at(-1)!;
    return new Selection({ row: first, col: rows.margin?.(first) ?? 0 }, lineAt(rows, last).end);
  }

  /** What a selection holds, for `peek` and the select actions. */
  describeSelection(s: Selection | null | undefined) {
    const rows = this.selRows();
    if (!s || !rows) return null;
    const text = s.text(rows), src = this.sourceOf(s);
    return { chars: [...text].length, text, keys: s.keys, ...(src ? { source: src.text, sourceExact: src.exact, lines: [src.lines[0] + 1, src.lines[1] + 1] } : {}) };
  }

  // ── actions ────────────────────────────────────────────────────────────────

  /**
   * Run a named action as `actor`. Keys run the same code; what an agent adds is checking (a refusal
   * says why, nothing is half-done), waiting for the write to land, and saying on screen that it did it.
   */
  act(name: string, args: Record<string, unknown>, host: SurfaceHost, actor: Actor): Promise<unknown> {
    this.use(host);
    // The property panel is the person's (only their `i` opens it); an agent doesn't start an edit or a
    // comment under it, where the panel would take the keys meant for the agent's session.
    if (actor.kind === "agent" && this.panel && !this.draft && !this.session && STARTS_SESSION.has(name))
      return Promise.reject(new ActionRefused("the person has the property panel open on this note; try again once they close it"));
    const h: SurfaceHost = actor.kind === "agent" ? { ...host, ctx: asActor(host.ctx, actor), redraw: () => host.redraw(), navigate: (m, how) => host.navigate(m, { ...how, agent: true }), startSession: undefined } : host;
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
      folds: this.msg && !this.msg.partial ? this.describeFolds(this.msg) : null,
      elements: this.drawn ? { count: this.elems.length, current: this.describeElements().find(e => e.current) ?? null } : null,
      focus: this.focusMark ? { by: this.focusMark.by.kind === "agent" ? this.focusMark.by.id : "you", marked: this.focusMark.label, ...this.focusMark.spec } : null,
      properties: this.panel && this.msg ? {
        open: this.panel.full ? "full" : "inline", selected: this.panel.sel + 1, note: this.panel.note || null,
        editing: this.panel.field ? { n: this.panel.field.row.n, key: this.panel.field.row.key, text: this.panel.field.text, revision: this.panel.field.revision, changedElsewhere: this.panel.field.changedElsewhere, note: this.panel.field.note || null } : null,
        rows: this.rows(this.msg).map(r => describeRow(r, this.src, this.msg!.text)),
      } : null,
      selection: this.describeSelection(this.selection),
      agentSelection: this.agentSelection ? { id: this.agentSelection.id, ...this.describeSelection(this.agentSelection.sel) } : null,
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
      await this.comment(host, mode, undefined, false);
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
  clearLink() { this.letGo(); }
  selectLink(i: number) {
    const l = this.links[i];
    if (!l) throw new ActionRefused(`there is no link ${i + 1}; the note has ${this.links.length}`);
    // The element it's drawn as becomes current (the ruler and ⏎ agree); none when it isn't drawn.
    this.cur = this.elems.find(e => e.link && sameLink(e.link, l))?.key ?? null;
    this.link = i;
  }
  goUp(host: SurfaceHost) { return this.up(host); }
}

/** The note line (from 0, the subject) each offset of `text` is on. */
const lineAtOffset = (text: string) => {
  const starts: number[] = [];
  let o = 0;
  for (const l of text.split("\n")) { starts.push(o); o += l.length + 1; }
  return (off: number) => Math.max(0, starts.findLastIndex(s => s <= off));
};

/** The body rows [from, to) drawn from note lines `lo` to `hi` (from 0, the subject), or null when none is drawn. */
function rowsOfLines(doc: Doc, noteLines: number[], lo: number, hi: number): [number, number] | null {
  let a = -1, b = -1;
  doc.source.forEach((s, r) => { const l = noteLines[s]; if (l !== undefined && l >= lo && l <= hi) { if (a < 0) a = r; b = r; } });
  return a < 0 ? null : [a, b + 1];
}

/** Where `quote` is in `text`: the occurrence nearest `near` (an offset), or the first; -1 when it isn't. */
function findQuote(text: string, quote: string, near?: number): number {
  const hits: number[] = [];
  if (quote) for (let i = text.indexOf(quote); i >= 0; i = text.indexOf(quote, i + 1)) hits.push(i);
  if (!hits.length) return -1;
  return near === undefined ? hits[0]! : hits.reduce((a, b) => (Math.abs(b - near) < Math.abs(a - near) ? b : a));
}

/** A block id as an agent names it: the whole id, or its first 8+ characters. */
const sameId = (named: string, id: string | undefined) => !!id && (named === id || (named.length >= 8 && id.startsWith(named)));

/** `## Beds`, `- dig the bed`: a fold point as the hint, `peek` and the fold actions name it. */
const foldLabel = (p: FoldPoint) => `${p.kind === "heading" ? "#".repeat(p.level) : "-"} ${printable(p.text)}`;

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
  "elements": Record<string, never>;
  "element.select": { n: number };
  "element.open": { n?: number; fresh?: boolean };
  "focus.set": FocusSpec;
  "focus.clear": Record<string, never>;
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
  "complete": { text?: string; insert?: number };
  "folds": Record<string, never>;
  "fold": FoldArgs & { all?: boolean };
  "unfold": FoldArgs & { all?: boolean };
  "fold.toggle": FoldArgs;
  "select": { text?: string; line?: number; to?: number; n?: number };
  "select.copy": { source?: boolean };
  "select.clear": Record<string, never>;
}
interface FoldArgs { text?: string; line?: number; n?: number }

const FOLD_ARGS = {
  text: { type: "string", optional: true, about: "a heading's or list item's text (## optional; a unique start is enough)" },
  line: { type: "number", optional: true, about: "a line of the note (1 is the subject): the heading or item on it, or else the innermost one around it" },
  n: { type: "number", optional: true, about: "which fold point, from 1, as folds lists them" },
} as const;

/** The fold point `text`, `line` or `n` names in the note the reader shows (the whole note, waited for). */
async function foldTarget(surface: NoteSurface, { text, line, n }: FoldArgs): Promise<FoldPoint> {
  const m = await surface.whole();
  const { points, lines } = surface.foldsIn(m);
  if ([text, line, n].filter(x => x !== undefined).length !== 1) throw new ActionRefused("say which heading or list item: one of text=, line= or n= (folds lists them)");
  if (!points.length) throw new ActionRefused("this note has no headings or nested lists to fold");
  const listed = (ps: FoldPoint[]) => ps.slice(0, 8).map(p => `line ${lines[p.line]! + 1} ${foldLabel(p)}`).join("; ");
  if (n !== undefined) {
    const p = points[n - 1];
    if (!p) throw new ActionRefused(`there is no fold point ${n}; the note has ${points.length} (folds lists them)`);
    return p;
  }
  if (line !== undefined) {
    const at = lines.indexOf(line - 1);
    if (at < 0) throw new ActionRefused(line === 1 ? "line 1 is the subject; it doesn't fold" : `line ${line} isn't part of the note's readable body (it's past the end, or holds only properties)`);
    const p = points.find(p => p.line === at) ?? points.filter(p => p.line < at && at < p.end).at(-1);
    if (!p) throw new ActionRefused(`line ${line} isn't a heading or a list item with nested lines, nor inside one; the note's are: ${listed(points)}`);
    return p;
  }
  const want = text!.trim().replace(/^(#{1,6}|[-*]|\d+[.)])\s+/, "").replace(/\s+/g, " ").toLowerCase();
  const heading = /^#{1,6}\s/.test(text!.trim()) ? text!.trim().match(/^#+/)![0].length : null;
  const pool = points.filter(p => heading === null || (p.kind === "heading" && p.level === heading));
  // A task's box ([ ], [x]) needn't be said.
  const reads = (p: FoldPoint) => [p.text.toLowerCase(), p.text.replace(/^\[.\]\s+/, "").toLowerCase()];
  let hits = pool.filter(p => reads(p).includes(want));
  if (!hits.length) hits = pool.filter(p => reads(p).some(r => r.startsWith(want)));
  if (!hits.length) throw new ActionRefused(`no heading or list item reads ${JSON.stringify(text)}; the note's are: ${listed(points)}`);
  if (hits.length > 1) throw new ActionRefused(`${hits.length} match ${JSON.stringify(text)} (${listed(hits)}); pass line= or n=`);
  return hits[0]!;
}

/** What a fold action reports: the fold point, whether it's folded now, and every fold in the reader. */
function foldResult(surface: NoteSurface, p: FoldPoint) {
  const { points, lines } = surface.foldsIn(surface.msg!);
  return {
    n: points.indexOf(p) + 1, kind: p.kind, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.folded.has(p.key),
    foldedNow: points.filter(q => surface.folded.has(q.key)).map(foldLabel),
  };
}

/** fold, unfold: one fold point, or with all=true every outermost one (fold) or all of them (unfold). */
async function runFold(on: boolean, { all, ...which }: FoldArgs & { all?: boolean }, { surface, host }: On, actor: Actor) {
  if (all) {
    if (Object.values(which).some(x => x !== undefined)) throw new ActionRefused("all=true folds or unfolds every one; leave out text, line and n");
    const m = await surface.whole();
    const changed = surface.foldAll(on, actor.kind === "user");
    surface.noteAgent(actor, on ? "folded the note's sections" : "unfolded the whole note");
    host.redraw();
    return { changed, foldedNow: surface.foldsIn(m).points.filter(q => surface.folded.has(q.key)).map(foldLabel) };
  }
  const p = await foldTarget(surface, which);
  surface.setFold(p, on, actor.kind === "user");
  surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p).slice(0, 40)}`);
  host.redraw();
  return foldResult(surface, p);
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
  "complete": {
    summary: "reference completion, as typing [[, (( or [file:: offers it: the candidates for text (such as [[PIE-4, ((beds, ((garden#, [file::src/), or at the open draft's cursor; insert=n puts the nth into the draft",
    keys: "[[ (( [file:: while writing; tab, ctrl+space · up/down, enter/tab, esc",
    args: {
      text: { type: "string", optional: true, about: "text ending in the token to complete; leave out to complete at the draft's cursor" },
      insert: { type: "number", optional: true, about: "put the nth candidate (from 1) into the draft at its cursor, as enter does" },
    },
    async run({ text, insert }, { surface, host }, actor) {
      const board = host.ctx.board as unknown as CompletionBoard;
      if (typeof board?.completePages !== "function") throw new ActionRefused("this connection can't look references up");
      const d = surface.draft ?? (surface.session?.mode === "compose" ? surface.session.composer : null);
      if (insert !== undefined && text !== undefined) throw new ActionRefused("insert completes at the draft's cursor; leave text out");
      let target;
      if (text !== undefined) {
        const line = text.split("\n").at(-1)!;
        target = completionTargetAtCursor(line, line.length);
        if (!target) throw new ActionRefused(`nothing to complete: text should end inside [[, (( or [file:: (it ends ${JSON.stringify(line.slice(-20))})`);
      } else {
        if (!d) throw new ActionRefused("nothing is being written here; pass text=\"[[...\" or open an edit first");
        target = completionTargetAtCursor(d.lines[d.row] ?? "", d.col);
        if (!target) throw new ActionRefused(`the draft's cursor (line ${d.row + 1}, column ${d.col + 1}) isn't inside [[, (( or [file::`);
      }
      // The draft as the target was read from it: typing during the lookups below moves the token, and a
      // splice at the old span would land in the wrong place, so any change refuses the insert.
      const at = d && { text: d.text, row: d.row, col: d.col };
      const still = () => !!d && !!at && d.text === at.text && d.row === at.row && d.col === at.col;
      const own = surface.draft ? { blockId: surface.draft.blockId, text: surface.draft.text } : undefined;
      const prefix = await board.workIdPrefix().catch(() => null);
      const r = await lookupCompletion(board, target, prefix, own);
      const out = {
        kind: target.kind, query: target.query, message: r.message || undefined, truncated: r.truncated ?? undefined,
        items: r.items.map((it, i) => ({ n: i + 1, label: it.label, insertion: it.insertion, kind: it.kind, blockId: it.blockId, address: it.address, fragmentId: it.fragmentId, context: it.context || undefined })),
      };
      if (insert === undefined) return out;
      const item = r.items[insert - 1];
      if (!item) throw new ActionRefused(`there is no candidate ${insert}; there are ${r.items.length}`);
      if (!d || d.busy) throw new ActionRefused(d ? "the save is still landing" : "nothing is being written here");
      try {
        if (!still()) throw new Error("the draft changed while the references were looked up; ask again");
        if (!await insertCompletion(board, d, target, item, own, still, actor)) throw new Error("the draft changed while the reference was checked; ask again");
      } catch (e) { throw new ActionRefused(`not inserted: ${e instanceof Error ? e.message : String(e)}`); }
      surface.noteAgent(actor, `inserted ${item.insertion.slice(0, 60)}`);
      host.redraw();
      return { ...out, inserted: item.insertion, dirty: d.dirty };
    },
  },
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
    summary: "select the note's nth link (1 is the first); element.select picks any element a reader draws", keys: "[ ] (on a link)",
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
  "elements": {
    summary: "list what [ ] steps through in this reader, in reading order: links, folds, figure rows, embeds, comment marks (the current one marked)",
    args: {},
    async run(_, { surface }) {
      await surface.whole();
      surface.requireDrawn();
      return { elements: surface.describeElements() };
    },
  },
  "element.select": {
    summary: "put the person's [ ] position on the nth element (elements lists them); the reading ruler follows. An agent's is refused: the position is the person's (focus.set marks something for them)", keys: "[ ], a click",
    args: { n: { type: "number", about: "which element, from 1, as elements lists them" } },
    async run({ n }, { surface, host }, actor) {
      if (actor.kind === "agent") throw new ActionRefused("the [ ] position is the person's; focus.set marks a block for them without moving it");
      await surface.whole();
      surface.selectElement(surface.element(n));
      host.redraw();
      return surface.describeElements()[n - 1];
    },
  },
  "element.open": {
    summary: "do what enter does on an element: a link follows (where is the view's call), a fold toggles, a row or an embed opens its note, a comment mark opens its thread; fresh=true opens a link, row or embed in a new reader. An agent's leaves the person's [ ] position alone", keys: "enter, alt+enter, a click",
    args: {
      n: { type: "number", optional: true, about: "which element, from 1 (elements lists them); default the current one (the person's own only)" },
      fresh: { type: "boolean", optional: true, about: "open it in a new reader (a new detail on the board), as alt+enter does" },
    },
    async run({ n, fresh }, on, actor) {
      const { surface, host } = on;
      await surface.whole();
      if (n === undefined && actor.kind === "agent") throw new ActionRefused("say which element: n (elements lists them); the current one is the person's");
      const i = n ?? (surface.describeElements().findIndex(e => e.current) + 1);
      if (!i) throw new ActionRefused("no element is current; pass n");
      const e = surface.element(i);
      if (fresh && e.kind !== "link" && e.kind !== "row" && e.kind !== "embed") throw new ActionRefused(`fresh opens a link, a row or an embed; element ${i} is a ${e.kind}`);
      // An agent's comment mark opens the thread list as its own session, on that thread (never under the
      // person's property panel, which would take the keys meant for it).
      if (e.kind === "comment" && actor.kind === "agent") {
        if (surface.panel && !surface.draft && !surface.session) throw new ActionRefused("the person has the property panel open on this note; try again once they close it");
        const r = await NOTE_ACTIONS.run("threads", {}, on, actor) as { threads: { id: string }[] };
        const s = surface.session;
        const t = s ? s.threads.findIndex(x => x.id === e.thread) : -1;
        if (s && t >= 0) s.sel = t;
        host.redraw();
        return { thread: e.thread, ...r };
      }
      const r = await surface.openElement(e, host, !!fresh, actor.kind === "user");
      if (actor.kind === "agent") surface.noteAgent(actor, `${e.kind === "fold" ? "toggled" : "opened"} ${e.label.slice(0, 40)}`);
      host.redraw();
      return { element: i, kind: e.kind, ...(r && typeof r === "object" && "id" in r ? { opened: (r as Msg).id, title: subject(r as Msg) } : r && typeof r === "object" ? r : {}) };
    },
  },
  "focus.set": {
    summary: "set a focus mark: a block (this note, or one it embeds or links), note lines, or an exact passage, tinted like the reading ruler with who set it named, and scrolled into view. The person's [ ] position, selection and keys aren't moved",
    args: {
      block: { type: "string", optional: true, about: "a block id (or its first 8+ characters): this note, or one it embeds or links" },
      line: { type: "number", optional: true, about: "a note line (1 is the subject)" },
      to: { type: "number", optional: true, about: "with line: the last note line" },
      quote: { type: "string", optional: true, about: "the note's exact words, as stored (the same shape as a comment's quote)" },
      near: { type: "number", optional: true, about: "with quote, when the words occur more than once: the offset to be nearest" },
    },
    async run(spec, { surface, host }, actor) {
      await surface.whole();
      const r = surface.setFocus(spec, actor);
      host.ctx.flash(`${agentLabel(actor)} marked ${r.marked}`);
      host.redraw();
      return { ...r, by: actor.kind === "agent" ? actor.id : "you" };
    },
  },
  "focus.clear": {
    summary: "take away the focus mark in this reader (esc does it for the person once nothing else is selected)", keys: "esc",
    args: {},
    run(_, { surface, host }) {
      const had = surface.focusMark;
      surface.focusMark = null;
      host.redraw();
      return { cleared: !!had, ...(had ? { by: had.by.kind === "agent" ? had.by.id : "you" } : {}) };
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
    summary: "start a comment: pick a passage of the note's source text by its exact words (default: the first line with text)", keys: "C, then j k J K h l H L",
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
  "folds": {
    summary: "list the note's fold points (headings, and list items with nested lines): which are folded, and the line each is on",
    args: {},
    async run(_, { surface }) {
      const m = await surface.whole();
      const { points, lines } = surface.foldsIn(m);
      const shown = new Set(surface.visibleFolds(m).map(p => p.key));
      return { folds: points.map((p, i) => ({ n: i + 1, kind: p.kind, level: p.level, text: p.text, line: lines[p.line]! + 1, hidden: p.hidden, folded: surface.folded.has(p.key), shown: shown.has(p.key) })) };
    },
  },
  "fold": {
    summary: "fold a heading (hiding through the next heading of its level or higher) or a list item (hiding its nested items and continuation lines); all=true folds every outermost one. Reading state only: the note's text never changes", keys: "( ) then f or enter, click, F",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "fold every outermost heading and list item" } },
    run: (args, on, actor) => runFold(true, args, on, actor),
  },
  "unfold": {
    summary: "unfold a heading or list item; all=true unfolds everything", keys: "( ) then f or enter, click, F",
    args: { ...FOLD_ARGS, all: { type: "boolean", optional: true, about: "unfold everything in this reader" } },
    run: (args, on, actor) => runFold(false, args, on, actor),
  },
  "fold.toggle": {
    summary: "fold a heading or list item, or unfold it if it's folded", keys: "f, enter, click",
    args: FOLD_ARGS,
    async run(args, { surface, host }, actor) {
      const p = await foldTarget(surface, args);
      const on = !surface.folded.has(p.key);
      surface.setFold(p, on, actor.kind === "user");
      surface.noteAgent(actor, `${on ? "folded" : "unfolded"} ${foldLabel(p).slice(0, 40)}`);
      host.redraw();
      return foldResult(surface, p);
    },
  },
  "select": {
    summary: "select text in the note as the reader draws it: text= (links read as their titles) or line= to= (1 is the subject). An agent's selection is its own, drawn in its own tint; the person's is never touched", keys: "drag, double/triple click, v then h j k l",
    args: {
      text: { type: "string", optional: true, about: "the words as they're drawn (blanks and row breaks match any blank)" },
      line: { type: "number", optional: true, about: "the first note line to select (1 is the subject)" },
      to: { type: "number", optional: true, about: "with line: the last note line" },
      n: { type: "number", optional: true, about: "with text: which time it's drawn, from 1" },
    },
    async run(args, { surface, host }, actor) {
      await surface.whole();
      const s = surface.selectBy(args);
      s.w = surface.renderedWidth(); s.top = surface.renderedTop();
      if (actor.kind === "agent") surface.agentSelection = { id: actor.id, sel: s };
      else surface.selection = s;
      const out = surface.describeSelection(s)!;
      surface.noteAgent(actor, `selected ${out.chars} chars`);
      host.redraw();
      return out;
    },
  },
  "select.copy": {
    summary: "copy the selection: what's drawn, or source=true for its markup. The person's goes to their clipboard (OSC 52); an agent's is returned to it and never touches the person's clipboard", keys: "y, Y, the [y copy] control",
    args: { source: { type: "boolean", optional: true, about: "the note's own text (markup) instead of what's drawn" } },
    run({ source }, { surface, host }, actor) {
      if (actor.kind === "user") {
        if (!surface.selection) throw new ActionRefused("nothing is selected");
        const r = surface.copySelection(!!source, host);
        if (!r) throw new ActionRefused(source ? "no source to copy: only the header's details are selected" : "only blanks are selected");
        host.redraw();
        return { copied: r.chars, text: r.text, clipboard: true };
      }
      const mine = surface.agentSelection?.id === actor.id ? surface.agentSelection.sel : null;
      if (!mine) throw new ActionRefused("you've selected nothing in this reader; select first (the person's own selection is theirs)");
      const d = surface.describeSelection(mine);
      if (!d) throw new ActionRefused("this reader doesn't show the note's text now");
      if (source && d.source === undefined) throw new ActionRefused("no source to copy: only the header's details are selected");
      const text = source ? d.source! : d.text;
      host.ctx.flash(`copied ${[...text].length} chars${source ? " of source" : ""} for itself · your clipboard is untouched`);
      surface.noteAgent(actor, `copied ${[...text].length} chars`);
      return { copied: [...text].length, text, clipboard: false };
    },
  },
  "select.clear": {
    summary: "let go of the selection (an agent's own; the person's is theirs to clear)", keys: "esc, a click",
    args: {},
    run(_, { surface, host }, actor) {
      const had = actor.kind === "agent" ? surface.agentSelection?.id === actor.id : !!surface.selection;
      if (actor.kind === "agent") { if (had) surface.agentSelection = null; } else surface.selection = null;
      host.redraw();
      return { cleared: had };
    },
  },
});

import { foldPoints } from "../doc";
import { wrap } from "../text";
import { stripQuotes } from "@ep0ch/outline-core/callouts";
import { ReaderPane, type DeskApi, type Pane } from "./panes";
import type { TileKind } from "./tile-kinds";
import type { KindHost } from "./tile-kinds";
import { actionSet, def, ActionRefused } from "../surface/actions";
import { partsHint } from "../surface/modes";
import { refOfLink, type Link } from "../surface/link-model";
import type { LinkRange } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { projectionsOf } from "../projection";
import { tileRegistry } from "./tile-registry";

/** An agent's answer callout, as the service writes it under an ask line: `> [!note]+ @yo answered`. */
const ANSWER_FOLD = /^>\s*\[!note\][+-]?\s+@[a-z][a-z0-9-]*\s+answered\s*$/;

/** The same draft viewed beside its editor; no copied answer buffer or save path. */
export class AnswerTile implements Pane {
  readonly kind = "answer";
  top = 0;
  total = 0;
  room = 1;
  links: Link[] = [];
  ranges: LinkRange[] = [];
  /** Its reader went and a close is on its way (render). */
  private closing = false;
  /** Where `f` folds the answer, as its reader was last drawn: the edit open on the note, else the reader (PIE-1741). */
  private foldsIn: keyof typeof FOLD_WHERE = "note";
  /**
   * The ask as the saved note has it, while the tile follows words typed on it in an edit (PIE-1757): an edit put aside
   * leaves the note as it was, and the tile says that ask's state, never that its ask is gone.
   */
  saved?: string;
  constructor(public source: string, public ask: string, public fold?: string, saved?: string) { if (saved) this.saved = saved; }
  /** The tile follows ask `to` (the cursor's, PIE-1722): the saved words it stood for stay known while `to` isn't saved. */
  followAsk(to: string, fold: string | undefined, savedText: string | undefined) {
    const inSaved = (a: string | undefined) => !!a && !!savedText?.split("\n").includes(a);
    this.saved = inSaved(to) ? undefined : inSaved(this.ask) ? this.ask : this.saved;
    Object.assign(this, { ask: to, fold, top: 0 });
  }
  /** The ask it shows in `text`: its own words when they're there, else the saved ones it stands for, else none. */
  shown(text: string): string | undefined {
    const lines = text.split("\n");
    return lines.includes(this.ask) ? this.ask : this.saved && lines.includes(this.saved) ? this.saved : undefined;
  }
  /** The ask it shows as its reader was last drawn: its own words, or the saved ones an edit put aside left (PIE-1757). */
  private showing?: string;
  title() { return this.showing ?? this.ask; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() {
    // What f folds first: the footer is cut to the tile's width, and a 38-column tile showed only the scroll (PIE-1741).
    return partsHint([
      { key: "f", action: "answer.fold", label: `fold/unfold ${FOLD_WHERE[this.foldsIn]}` },
      { key: "up", action: "answer.scroll", args: { by: -1 }, label: "scroll", also: "↓" },
      { key: "1", action: "answer.follow", args: { n: 1 }, label: "follow a link or press a button", also: "2–9" },
    ]);
  }
  spec() { return { source: `tile:${this.source}`, state: { ask: this.ask, fold: this.fold, ...(this.saved ? { saved: this.saved } : {}) } }; }
  answer(text: string) {
    const lines = text.split("\n"), folds = foldPoints(text), ask = this.shown(text);
    if (!ask) return undefined;
    // Its ask's answer and nothing else: the agent's answer callout right under a line saying the ask (a heading or a
    // callout of the person's there, or the ask gone, is no answer: CodeRabbit on #1428).
    const answers = (p: { line: number }) => p.line > 0 && lines[p.line - 1] === ask && ANSWER_FOLD.test(lines[p.line] ?? "");
    // The fold it was opened on (one of several lines saying the ask), else the one under its first: a save can give the
    // same fold another key (PIE-1711, "Waiting for the answer…" over an answer already in the note).
    return (this.fold ? folds.find(p => p.key === this.fold && answers(p)) : undefined) ?? folds.find(p => answers(p) && p.line === lines.indexOf(ask) + 1);
  }
  key(k: Key, desk: DeskApi) {
    const c = ch(k);
    if (c === "f") { void desk.press?.(this, ANSWER_ACTIONS, "answer.fold"); return true; }
    if (c && /^[1-9]$/.test(c)) { void desk.press?.(this, ANSWER_ACTIONS, "answer.follow", { n: Number(c) }); return true; }
    const by = isUp(k) ? -1 : isDown(k) ? 1 : 0;
    if (!by) return false;
    void desk.press?.(this, ANSWER_ACTIONS, "answer.scroll", { by });
    return true;
  }
  wheel(dir: 1 | -1, desk: DeskApi) { void desk.press?.(this, ANSWER_ACTIONS, "answer.scroll", { by: dir * 3 }); }
  /** Whether (x, y) is on a link or a button drawn here. */
  hits(x: number, y: number): boolean { return this.ranges.some(r => r.line === y + this.top && x >= r.from && x < r.to); }
  click(x: number, y: number, desk: DeskApi) {
    const hit = this.ranges.find(r => r.line === y + this.top && x >= r.from && x < r.to);
    if (hit) void desk.press?.(this, ANSWER_ACTIONS, "answer.follow", { n: hit.n + 1 });
  }
  /** Words in place of an answer, wrapped whole to the tile's width (PIE-1733: cut at one row, its close never showed). */
  private said(words: string, w: number, h: number) {
    const lines = wrap(words, w);
    this.links = []; this.ranges = [];
    this.total = lines.length; this.room = h;
    this.top = Math.max(0, Math.min(this.top, this.total - h));
    return { lines: lines.slice(this.top, this.top + h) };
  }
  /** Whether its ask is still in its reader's note (typed or saved): one that's gone isn't kept in a saved layout (PIE-1733). */
  live(desk: Pick<DeskApi, "paneNamed">): boolean {
    const reader = desk.paneNamed?.(this.source);
    if (reader instanceof ReaderPane && reading(reader)) return true;   // a door just restored: its note isn't read yet
    return reader instanceof ReaderPane && this.shown(reader.surface.draft?.text ?? reader.msg?.text ?? "") !== undefined;
  }
  /** What it last drew its ask as: here, or gone. A change saves the layout, so a door opened next keeps it or not as it is now. */
  private shownLive: boolean | null = null;
  render(w: number, h: number, _focused: boolean, desk: DeskApi) {
    const reader = desk.paneNamed?.(this.source);
    // Its reader went (closed, or moved into a group or the drawer, PIE-1716): it closes as an attached tile does, unless
    // the reader is back by the time the close comes round, with no undo step of its own (an undo of the move brings both
    // back). The next ask opens one beside the reader where it is now.
    if (!(reader instanceof ReaderPane)) {
      if (!this.closing) { this.closing = true; queueMicrotask(() => { if (this.closing && !(desk.paneNamed?.(this.source) instanceof ReaderPane)) desk.dismiss?.(this, false); }); }
      return this.said("The answer's reader has gone.", w, h);
    }
    this.closing = false;
    // Its reader hasn't read its note yet (a door just restored, CodeRabbit on #1435): nothing is gone, and nothing is
    // known yet that a save should change.
    if (reading(reader)) return this.said("Reading its note…", w, h);
    const text = reader.surface.draft?.text ?? reader.msg?.text ?? "";
    const lines = text.split("\n"), fold = this.answer(text), ask = this.shown(text), live = ask !== undefined;
    this.showing = ask;
    if (this.shownLive !== null && this.shownLive !== live) queueMicrotask(() => desk.keepLayout?.());
    this.shownLive = live;
    // Its ask is gone from the note (taken out, or the reader gone on to another note): no answer is coming, so it says so
    // and how to close it, never "Waiting for the answer…" (PIE-1731). The tile stays: closing it is the person's.
    if (!live) return this.said(`Its ask is gone from ${reader.msg ? "this note" : "the reader"}: nothing to wait for · x closes this tile`, w, h);
    this.links = [];
    const draft = reader.surface.draft;
    this.foldsIn = draft ? "edit" : "note";
    const projection = reader.msg && projectionsOf(reader.msg, reader.surface.src).find(p => p.kind === "agent" && p.anchor?.line === lines.indexOf(ask));
    const status = draft?.askStatus(ask).replace(/^ · /, "") || projection?.summary || projection?.reason;
    // Its words not sent yet, or asked and nothing written back yet: what the line says, not an answer under it that was to
    // other words (loki on #1445: an answered ask typed on showed the old answer beside "asks once you leave").
    const progress = draft?.liveAsk(ask), pending = !!progress && (progress.state === "queued" || (progress.state === "working" && !progress.blocks));
    // The answer's lines are the note's (as the reader holds it, typed or saved): its buttons press as they do there (PIE-1699).
    const body = fold && !pending ? lines.slice(fold.line + 1, fold.end) : [];
    const doc = fold && !pending
      ? reader.surface.snippetDoc(body.map(l => stripQuotes(l, 1)).join("\n"), w, reader.host(desk), this.links, false, undefined, body.map((_, i) => fold.line + 1 + i))
      : reader.surface.snippetDoc(status || "Waiting for the answer…", w, reader.host(desk), this.links);
    this.ranges = doc.links;
    this.total = doc.lines.length; this.room = h;
    this.top = Math.max(0, Math.min(this.top, this.total - h));
    return { lines: doc.lines.slice(this.top, this.top + h) };
  }
}

/** A reader with no note and no edit yet: still reading the note it was opened on. */
const reading = (reader: ReaderPane) => !reader.surface.draft && !reader.msg;

/**
 * Where `answer.fold` folds the answer, in the words its description and the tile's hint row both use (PIE-1741): the
 * answer in the edit open on its note (fold.toggle's draft branch), else the reader's callout.
 */
export const FOLD_WHERE = { edit: "in the edit", note: "in the reader" } as const;

export const ANSWER_ACTIONS = actionSet<KindHost>()("answer", {
  "answer.fold": def({
    summary: `fold or unfold this answer: ${FOLD_WHERE.edit} while one is open on its note, else ${FOLD_WHERE.note} (its callout as the note is read)`, keys: "f", touches: "tile", replay: "safe",
    args: {},
    async run(_, { pane, desk }, actor) {
      const reader = desk.paneNamed?.(pane.source);
      if (!(reader instanceof ReaderPane)) throw new ActionRefused("open the answer's note first");
      const fold = pane.answer(reader.surface.draft?.text ?? reader.msg?.text ?? "");
      if (!fold) throw new ActionRefused("this ask has no answer to fold");
      const line = fold.line + 1;
      return desk.within?.("fold.toggle", { line }, actor, reader);
    },
  }),
  "answer.scroll": def({
    summary: "scroll the answer beside its note", keys: "↑ ↓ wheel", touches: "tile", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    examples: [
      { act: "answer.scroll tile=answer by=5", does: "scrolls the answer down five rows" },
      { act: "answer.scroll tile=answer by=-5", does: "scrolls it back up five" },
    ],
    run({ by }, { pane, desk }) { pane.top = Math.max(0, Math.min(pane.total - pane.room, pane.top + by)); desk.redraw(); return { top: pane.top }; },
  }),
  "answer.follow": def({
    summary: "follow a link or press a button in the answer beside its note: a button presses as it does in the note (its reader's press, the line typed or saved), the keys staying where they are", keys: [{ keys: "1-9", does: "follow that link, or press that button" }, { keys: "click", does: "follow a link, or press a button" }], touches: "tile", replay: "ask",
    args: {
      n: { type: "number", about: "link or button number, from one, in the order they are drawn" },
      alt: { type: "boolean", optional: true, about: "a button's alt= press (its alt+click in the note)" },
    },
    examples: [
      { act: "answer.follow tile=answer n=1", does: "follows the answer's first link, or presses it when it is a button, as its reader would" },
    ],
    async run({ n, alt }, { pane, desk }, actor) {
      const reader = desk.paneNamed?.(pane.source), link = pane.links[n - 1];
      if (!(reader instanceof ReaderPane)) throw new ActionRefused("open the answer's note first");
      // A button (PIE-1699): the reader's own press of that line, as a click on it in the note, attributed to whoever asks.
      const press = link?.press;
      // It acts where the note is typed: that reader, by its id (the note may be open in another reader too).
      if (press) return reader.surface.runPress(alt && press.alt ? { ...press, act: press.alt } : press, reader.host(desk), actor, !!alt && !press.alt, { tile: tileRegistry.idOf(reader), note: press.block, actor }, !!alt && !!press.alt);
      const ref = link && refOfLink(link);
      if (!ref) throw new ActionRefused("choose a link or a button in the answer");
      return desk.within?.(reader.surface.draft ? "edit.follow" : "link.follow", { ref }, actor, reader);
    },
  }),
});

export const ANSWER_TILE: TileKind = {
  kind: "answer", noun: "an answer tile",
  actions: ANSWER_ACTIONS,
  about: "an ask's answer from the live note beside it",
  make: s => new AnswerTile(s.source?.replace(/^tile:/, "") ?? "reader", String(s.state?.ask ?? ""), s.state?.fold as string | undefined, s.state?.saved as string | undefined),
  // A click on a link or a button presses it; the keys stay in the edit beside it (PIE-1722).
  clickKeepsKeys: (p, x, y) => (p as AnswerTile).hits(x, y),
  // One whose ask is gone isn't kept: a door opened next would bring back a dead tile to close (PIE-1733).
  kept: (p, desk) => (p as AnswerTile).live(desk),
};

import { foldPoints } from "../doc";
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
  constructor(public source: string, public ask: string, public fold?: string) {}
  title() { return this.ask; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() {
    return partsHint([
      { key: "up", action: "answer.scroll", args: { by: -1 }, label: "scroll", also: "↓" },
      { key: "1", action: "answer.follow", args: { n: 1 }, label: "follow a link or press a button", also: "2–9" },
      { key: "f", action: "answer.fold", label: "fold/unfold in the note" },
    ]);
  }
  spec() { return { source: `tile:${this.source}`, state: { ask: this.ask, fold: this.fold } }; }
  answer(text: string) {
    const lines = text.split("\n"), folds = foldPoints(text);
    // Its ask's answer and nothing else: the agent's answer callout right under a line saying the ask (a heading or a
    // callout of the person's there, or the ask gone, is no answer: CodeRabbit on #1428).
    const answers = (p: { line: number }) => p.line > 0 && lines[p.line - 1] === this.ask && ANSWER_FOLD.test(lines[p.line] ?? "");
    // The fold it was opened on (one of several lines saying the ask), else the one under its first: a save can give the
    // same fold another key (PIE-1711, "Waiting for the answer…" over an answer already in the note).
    return (this.fold ? folds.find(p => p.key === this.fold && answers(p)) : undefined) ?? folds.find(p => answers(p) && p.line === lines.indexOf(this.ask) + 1);
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
  render(w: number, h: number, _focused: boolean, desk: DeskApi) {
    const reader = desk.paneNamed?.(this.source);
    // Its reader went (closed, or moved into a group or the drawer, PIE-1716): it closes as an attached tile does, unless
    // the reader is back by the time the close comes round, with no undo step of its own (an undo of the move brings both
    // back). The next ask opens one beside the reader where it is now.
    if (!(reader instanceof ReaderPane)) {
      if (!this.closing) { this.closing = true; queueMicrotask(() => { if (this.closing && !(desk.paneNamed?.(this.source) instanceof ReaderPane)) desk.dismiss?.(this, false); }); }
      return { lines: ["The answer's reader has gone."] };
    }
    this.closing = false;
    const text = reader.surface.draft?.text ?? reader.msg?.text ?? "";
    const lines = text.split("\n"), fold = this.answer(text);
    this.links = [];
    const draft = reader.surface.draft;
    const projection = reader.msg && projectionsOf(reader.msg, reader.surface.src).find(p => p.kind === "agent" && p.anchor?.line === lines.indexOf(this.ask));
    const status = draft?.askStatus(this.ask).replace(/^ · /, "") || projection?.summary || projection?.reason;
    // The answer's lines are the note's (as the reader holds it, typed or saved): its buttons press as they do there (PIE-1699).
    const body = fold ? lines.slice(fold.line + 1, fold.end) : [];
    const doc = fold
      ? reader.surface.snippetDoc(body.map(l => stripQuotes(l, 1)).join("\n"), w, reader.host(desk), this.links, false, undefined, body.map((_, i) => fold.line + 1 + i))
      : reader.surface.snippetDoc(status || "Waiting for the answer…", w, reader.host(desk), this.links);
    this.ranges = doc.links;
    this.total = doc.lines.length; this.room = h;
    this.top = Math.max(0, Math.min(this.top, this.total - h));
    return { lines: doc.lines.slice(this.top, this.top + h) };
  }
}

const ANSWER_ACTIONS = actionSet<KindHost>()("answer", {
  "answer.fold": def({
    summary: "fold or unfold this answer in its note", keys: "f", touches: "tile", replay: "safe",
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
  make: s => new AnswerTile(s.source?.replace(/^tile:/, "") ?? "reader", String(s.state?.ask ?? ""), s.state?.fold as string | undefined),
  // A click on a link or a button presses it; the keys stay in the edit beside it (PIE-1722).
  clickKeepsKeys: (p, x, y) => (p as AnswerTile).hits(x, y),
};

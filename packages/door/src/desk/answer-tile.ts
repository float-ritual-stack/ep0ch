import { foldPoints } from "../doc";
import { stripQuotes } from "@ep0ch/outline-core/callouts";
import { ReaderPane, type DeskApi, type Pane } from "./panes";
import type { TileKind } from "./tile-kinds";
import type { KindHost } from "./tile-kinds";
import { actionSet, def, ActionRefused } from "../surface/actions";
import { refOfLink, type Link } from "../surface/note";
import type { LinkRange } from "../style";
import { ch, isUp, isDown, type Key } from "../term";
import { projectionsOf } from "../projection";

/** The same draft viewed beside its editor; no copied answer buffer or save path. */
export class AnswerTile implements Pane {
  readonly kind = "answer";
  top = 0;
  total = 0;
  room = 1;
  links: Link[] = [];
  ranges: LinkRange[] = [];
  constructor(public source: string, public ask: string, public fold?: string) {}
  title() { return this.ask; }
  renamedTile(from: string, to: string) { if (this.source === from) this.source = to; }
  hint() { return "↑↓ scroll · 1–9 follow a link · f fold/unfold in the note"; }
  spec() { return { source: `tile:${this.source}`, state: { ask: this.ask, fold: this.fold } }; }
  answer(text: string) {
    const at = text.split("\n").indexOf(this.ask);
    return foldPoints(text).find(p => this.fold ? p.key === this.fold : p.line === at + 1);
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
  click(x: number, y: number, desk: DeskApi) {
    const hit = this.ranges.find(r => r.line === y + this.top && x >= r.from && x < r.to);
    if (hit) void desk.press?.(this, ANSWER_ACTIONS, "answer.follow", { n: hit.n + 1 });
  }
  render(w: number, h: number, _focused: boolean, desk: DeskApi) {
    const reader = desk.paneNamed?.(this.source);
    if (!(reader instanceof ReaderPane)) return { lines: ["The answer's reader has closed."] };
    const text = reader.surface.draft?.text ?? reader.msg?.text ?? "";
    const lines = text.split("\n"), fold = this.answer(text);
    this.links = [];
    const draft = reader.surface.draft;
    const projection = reader.msg && projectionsOf(reader.msg, reader.surface.src).find(p => p.kind === "agent" && p.anchor?.line === lines.indexOf(this.ask));
    const status = draft?.askStatus(this.ask).replace(/^ · /, "") || projection?.summary || projection?.reason;
    const doc = reader.surface.snippetDoc(fold ? lines.slice(fold.line + 1, fold.end).map(l => stripQuotes(l, 1)).join("\n") : status || "Waiting for the answer…", w, reader.host(desk), this.links);
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
    summary: "follow a link in the answer beside its note", keys: [{ keys: "1-9", does: "follow that link" }, { keys: "click", does: "follow a link" }], touches: "tile", replay: "safe",
    args: { n: { type: "number", about: "link number, from one" } },
    examples: [
      { act: "answer.follow tile=answer n=1", does: "follows the answer's first link, as its reader would" },
    ],
    async run({ n }, { pane, desk }, actor) {
      const reader = desk.paneNamed?.(pane.source), link = pane.links[n - 1], ref = link && refOfLink(link);
      if (!(reader instanceof ReaderPane) || !ref) throw new ActionRefused("choose a link in the answer");
      return desk.within?.(reader.surface.draft ? "edit.follow" : "link.follow", { ref }, actor, reader);
    },
  }),
});

export const ANSWER_TILE: TileKind = {
  kind: "answer", noun: "an answer tile",
  actions: ANSWER_ACTIONS,
  about: "an ask's answer from the live note beside it",
  make: s => new AnswerTile(s.source?.replace(/^tile:/, "") ?? "reader", String(s.state?.ask ?? ""), s.state?.fold as string | undefined),
};

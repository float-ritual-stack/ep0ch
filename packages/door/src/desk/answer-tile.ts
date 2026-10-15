import { foldPoints } from "../doc";
import { stripQuotes } from "@ep0ch/outline-core/callouts";
import { ReaderPane, type DeskApi, type Pane } from "./panes";
import type { TileKind } from "./tile-kinds";
import type { KindHost } from "./tile-kinds";
import { actionSet, def, ActionRefused } from "../surface/actions";
import { refOfLink, type Link } from "../surface/note";
import type { LinkRange } from "../style";
import { ch, isUp, isDown, type Key } from "../term";

/** The same draft viewed beside its editor; no copied answer buffer or save path. */
export class AnswerTile implements Pane {
  readonly kind = "answer";
  top = 0;
  total = 0;
  room = 1;
  links: Link[] = [];
  ranges: LinkRange[] = [];
  constructor(readonly source: string, public ask: string) {}
  title() { return this.ask; }
  hint() { return "↑↓ scroll · 1–9 follow a link · f fold/unfold in the note"; }
  spec() { return { source: `tile:${this.source}`, state: { ask: this.ask } }; }
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
    const lines = text.split("\n"), at = lines.indexOf(this.ask);
    const fold = foldPoints(text).find(p => p.line === at + 1);
    this.links = [];
    const doc = reader.surface.snippetDoc(fold ? lines.slice(fold.line + 1, fold.end).map(l => stripQuotes(l, 1)).join("\n") : "Waiting for the answer…", w, reader.host(desk), this.links);
    this.ranges = doc.links;
    this.total = doc.lines.length; this.room = h;
    this.top = Math.max(0, Math.min(this.top, this.total - h));
    return { lines: doc.lines.slice(this.top, this.top + h) };
  }
}

const ANSWER_ACTIONS = actionSet<KindHost>()("answer", {
  "answer.fold": def({
    summary: "fold or unfold this answer in its draft", keys: "f", touches: "tile", replay: "safe",
    args: {},
    async run(_, { pane, desk }, actor) {
      const reader = desk.paneNamed?.(pane.source);
      if (!(reader instanceof ReaderPane) || !reader.surface.draft) throw new ActionRefused("open the note's draft first");
      const line = reader.surface.draft.lines.indexOf(pane.ask) + 2;
      return reader.surface.run("fold.toggle", { line }, reader.host(desk), actor);
    },
  }),
  "answer.scroll": def({
    summary: "scroll the answer beside its note", keys: "↑ ↓ wheel", touches: "tile", replay: "safe",
    args: { by: { type: "number", about: "rows to scroll" } },
    run({ by }, { pane, desk }) { pane.top = Math.max(0, Math.min(pane.total - pane.room, pane.top + by)); desk.redraw(); return { top: pane.top }; },
  }),
  "answer.follow": def({
    summary: "follow a link in the answer beside its note", keys: "1–9, click", touches: "tile", replay: "safe",
    args: { n: { type: "number", about: "link number, from one" } },
    async run({ n }, { pane, desk }, actor) {
      const reader = desk.paneNamed?.(pane.source), link = pane.links[n - 1], ref = link && refOfLink(link);
      if (!(reader instanceof ReaderPane) || !ref) throw new ActionRefused("choose a link in the answer");
      return reader.surface.run("edit.follow", { ref }, reader.host(desk), actor);
    },
  }),
});

export const ANSWER_TILE: TileKind = {
  kind: "answer", noun: "an answer tile",
  actions: ANSWER_ACTIONS,
  about: "an ask's answer from the live note beside it",
  make: s => new AnswerTile(s.source?.replace(/^tile:/, "") ?? "reader", String(s.state?.ask ?? "")),
};

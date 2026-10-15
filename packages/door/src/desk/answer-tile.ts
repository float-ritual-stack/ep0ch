import { foldPoints } from "../doc";
import { stripQuotes } from "@ep0ch/outline-core/callouts";
import { ReaderPane, type DeskApi, type Pane } from "./panes";
import type { TileKind } from "./tile-kinds";

/** The same draft viewed beside its editor; no copied answer buffer or save path. */
export class AnswerTile implements Pane {
  readonly kind = "answer";
  constructor(readonly source: string, public ask: string) {}
  title() { return this.ask; }
  hint() { return "the answer in the note · open its fold to edit it"; }
  spec() { return { source: `tile:${this.source}`, state: { ask: this.ask } }; }
  key() { return false; }
  render(w: number, h: number, _focused: boolean, desk: DeskApi) {
    const reader = desk.paneNamed?.(this.source);
    if (!(reader instanceof ReaderPane)) return { lines: ["The answer's reader has closed."] };
    const text = reader.surface.draft?.text ?? reader.msg?.text ?? "";
    const lines = text.split("\n"), at = lines.indexOf(this.ask);
    const fold = foldPoints(text).find(p => p.line === at + 1);
    return { lines: fold
      ? reader.surface.snippet(lines.slice(fold.line + 1, fold.end).map(l => stripQuotes(l, 1)).join("\n"), w, reader.host(desk)).slice(0, h)
      : ["Waiting for the answer…"] };
  }
}

export const ANSWER_TILE: TileKind = {
  kind: "answer", noun: "an answer tile",
  about: "an ask's answer from the live note beside it",
  make: s => new AnswerTile(s.source?.replace(/^tile:/, "") ?? "reader", String(s.state?.ask ?? "")),
};

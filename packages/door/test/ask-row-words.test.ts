// PIE-1768 and Codex on #1466: an ask's row says where its own answer is. The one answer tile shows one line's answer
// (its desk says which, `answerAt`); that row names the side, every other ask with an answer to show says `show ▸`,
// and the desk is asked once a draw however many asks the note holds. Made-up notes.
import { describe, expect, test } from "bun:test";
import { Draft, type AnswerPlace } from "../src/edit";
import { draftView } from "../src/draft-view";
import { visible } from "../src/style";

const ask = "@tally the rows";
const answered = (words: string) => [ask, "> [!note]- @tally answered", `> ${words}`, ""];
const twins = () => new Draft("n1", 1, ["Twin asks", "two beds", ...answered("counted: bed one"), ...answered("counted: bed two")].join("\n"));
const rowsOf = (d: Draft) => d.lines.flatMap((l, i) => (l === ask ? [d.askStatus(l, Infinity, i)] : []));

describe("an ask's row and the one answer tile", () => {
  test("two saved asks in the same words: only the row whose answer the tile shows names its side", () => {
    const d = twins(), second = d.lines.lastIndexOf(ask);
    d.answerAt = () => ({ side: "right", ask, row: second });
    expect(rowsOf(d)).toEqual([" · answered · show ▸", " · answered · beside ▸"]);
  });

  test("with no tile open, a saved answer says show ▸; where no desk holds tiles (a float), nothing", () => {
    const d = twins();
    d.answerAt = () => ({ side: null });
    expect(rowsOf(d)).toEqual([" · answered · show ▸", " · answered · show ▸"]);
    const float = twins();
    float.answerAt = () => undefined;
    expect(rowsOf(float)).toEqual([" · answered", " · answered"]);
  });

  test("a long note's draw asks the desk once, not once a row", () => {
    const lines = ["Many asks", ...Array.from({ length: 96 }, (_, n) => [`@tally bed ${n}`, "> [!note]- @tally answered", `> counted: bed ${n}`, ""]).flat()];
    const d = new Draft("n1", 1, lines.join("\n"));
    let asked = 0;
    d.answerAt = (): AnswerPlace => { asked++; return { side: "down", ask: "@tally bed 3", row: lines.indexOf("@tally bed 3") }; };
    const drawn = draftView(d).render(80, 500).map(visible).join("\n");
    expect(drawn).toContain("@tally bed 3 · answered · below ▾");
    expect(drawn).toContain("@tally bed 4 · answered · show ▸");
    expect(asked).toBe(1);
    // The next frame asks again, and so does a status asked outside a frame: a tile that moved is said where it is now.
    draftView(d).render(80, 500);
    expect(asked).toBe(2);
    d.askStatus("@tally bed 4", Infinity, lines.indexOf("@tally bed 4"));
    expect(asked).toBe(3);
  });
});

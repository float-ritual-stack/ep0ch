// PIE-533 S2: the showcase screen, "Notes that read themselves": the design's fixture note drawn with its values, driven
// through `act`. The harness (harness.ts) seeds a scratch outline and opens the screen on it.
import { beforeAll, describe, expect, test } from "bun:test";
import { App } from "../../src/app";
import { outlineChanged } from "../../src/refs";
import { type Seeded } from "../../src/showcase/seed";
import { Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

describe.skipIf(!outliner)("the showcase screen: notes that read themselves (PIE-533 S2)", () => {
  const h = useShowcaseScreen();
  const { screen, press, ch } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });
  const act = (action: string, args: Record<string, unknown> = {}) => app.act({ action, args, tile: "vent rail", as: "test-agent" }) as Promise<any>;

  test("the fixture reads as its values; a typo is dimmed with its did-you-mean; an agent opens a value's line and selects its words, and the passage is the token", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "values" }, as: "test-agent" })).toMatchObject({ key: "values" });
    await until(() => screen().includes("Owner: Ada"), "the values drawn", 10_000);
    const shown = screen();
    expect(shown).toContain("Play it at https://example.test/vent. Owner: Ada, status active.");
    expect(shown).toContain("Its project is spring-sowing.");
    expect(shown).toContain("The guide is Ada Marsh");                         // through the person link: the note's title would be Ada Marsh, firstName/lastName its values
    expect(shown).toContain("The recipe asks type=chore stage=todo; by page, Ada is the first name.");
    expect(shown).toContain("{{this.ownr}} · did you mean owner?");
    expect(shown).toContain("A fallback: nobody yet.");
    expect(shown).not.toContain("{{this.owner}}");

    // The values are elements: an agent opens Owner's, which lights the line it is written on, in the note's own reader.
    const owner = (await act("elements")).elements.find((e: any) => e.label === "Ada" && e.kind === "link");
    expect(owner).toBeDefined();
    // An agent's open names the note and leaves the person's cursor and focus alone (no line is lit under their eyes).
    expect(await act("element.open", { n: owner.n })).toMatchObject({ kind: "link", opened: seeded.notes.ventRail.id });
    expect(screen()).not.toContain("the line this.owner reads");
    // The person steps onto it with [ ] and presses ⏎: the line it is written on is lit, and the banner says why.
    press({ kind: "enter" });
    for (let i = 0; i < 12 && !screen().includes("link Ada · ⏎ show the line it reads"); i++) ch("]");
    expect(screen()).toContain("link Ada · ⏎ show the line it reads");
    press({ kind: "enter" });
    await until(() => screen().includes("the line this.owner reads"), "the line to be lit");

    // Selecting the drawn words and asking for their source: the whole token, so a comment on it anchors there.
    const selected = await act("select", { text: "Owner: Ada" });
    expect(selected).toBeDefined();
    const text = (await board.get(seeded.notes.ventRail.id))!.text;
    expect(text).toContain("Owner: {{this.owner}}");
  }, 40_000);

  test("fixing the typo redraws the value; the raw text saved as typed, the person's way", async () => {
    const note = (await board.get(seeded.notes.ventRail.id))!;
    await board.update(note.id, note.text.replace("{{this.ownr}}", "{{this.owner}}"), note.revision!);
    outlineChanged([note.id]);
    await until(() => screen().includes("A typo: Ada."), "the fixed value");
    expect(screen()).not.toContain("did you mean owner?");
    // The section is left as it was seeded.
    const now = (await board.get(note.id))!;
    await board.update(note.id, now.text.replace("A typo: {{this.owner}}.", "A typo: {{this.ownr}}."), now.revision!);
    outlineChanged([note.id]);
  }, 20_000);
});

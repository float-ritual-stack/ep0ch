// The twins section (PIE-1258): a near-duplicate of a queued card is offered its twin before it's filed. An agent's
// create is refused naming it; the person's composer shows it on a row of its own, and attaching puts the words under
// the twin, dated. Scratch service, made-up cards, Jev off: the title match alone is the offer.
import { describe, expect, test } from "bun:test";
import { SECTIONS } from "../../src/showcase/showcase";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("showcase: twins at filing (PIE-1258)", () => {
  const h = useShowcaseScreen(200);
  const latch = () => h.board.get(h.seeded.cards[0]!.id);
  const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 15_000) => {
    const end = Date.now() + ms;
    while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
  };
  const model = () => { h.screen(); return (h.S().stage(SECTIONS.findIndex(s => s.key === "twins")).top as any).modelFor("lanes") as any; };
  const open = async () => {
    h.S().focus = "index";
    (h.app as any).lastInput = 0;
    await h.app.act({ action: "section", args: { name: "twins" }, as: "test-agent" });
    await until(() => !!model()?.lanes?.length && model().lanes.every((l: any) => l.items), "the board's lanes", 15_000);
    await until(() => marks.twins!.every(m => h.screen().includes(m)), "the twins section", 15_000);
  };

  test("an agent's near-duplicate is refused naming the twin; card.attach adds its words there", async () => {
    await open();
    const refused = await h.app.act({ action: "card.create", args: { lane: "Queued", text: "Fix the back gate latch [priority::medium] [arc::garden] [track::allotment]" }, as: "test-agent" }).then(() => null, (e: Error) => e.message);
    expect(refused).toContain("(queued) Fix the back gate latch");
    expect(refused).toContain("card.attach twin=");
    const workId = /(HOME-\d+) \(queued\) Fix the back gate latch/.exec(refused!)![1]!;
    expect(await h.app.act({ action: "card.attach", args: { twin: workId, text: "The latch dropped again\nTwice this week, both in the wind." }, as: "test-agent" })).toMatchObject({ attached: workId });
    expect((await latch())!.text).toMatch(/- \*\*Asked again, \w+ \d+\*\* \(by test-agent\): The latch dropped again\n {2}Twice this week, both in the wind\.$/);
  });

  test("the person's composer offers the twin on a row; ctrl+x a attaches it there, and the composer closes", async () => {
    await open();
    await (h.app as any).dispatch.act({ action: "card.new", args: { lane: "Queued" } }, USER);
    await until(() => h.screen().includes("new card in Queued"), "the composer", 10_000);
    // The person's keys go to the section's stage, as ⏎ on its row does.
    h.S().focus = "stage";
    for (const c of "Fix the back gate latch for good [priority::low] [arc::garden] [track::allotment]") h.ch(c);
    h.press({ kind: "char", ch: "s", ctrl: true });
    await until(() => h.screen().includes("[attach here] [file new]"), "the twin row", 15_000).catch(e => { console.log(h.screen()); throw e; });
    expect(h.screen()).toContain("looks like HOME-");
    h.press({ kind: "char", ch: "x", ctrl: true });
    h.ch("a");
    await untilAsync(async () => /\(by Evan\): Fix the back gate latch for good$/.test((await latch())!.text), "the words under the twin");
    await until(() => !h.screen().includes("[attach here]"), "the composer closed", 10_000);
  });

  test("ctrl+s again on the same text files it new, said in the card as filed beside its twin", async () => {
    await open();
    await (h.app as any).dispatch.act({ action: "card.new", args: { lane: "Queued" } }, USER);
    await until(() => h.screen().includes("new card in Queued"), "the composer", 10_000);
    h.S().focus = "stage";
    for (const c of "Fix the back gate latch post [priority::low] [arc::garden] [track::allotment]") h.ch(c);
    h.press({ kind: "char", ch: "s", ctrl: true });
    await until(() => h.screen().includes("[attach here] [file new]"), "the twin row", 15_000);
    h.press({ kind: "char", ch: "s", ctrl: true });
    const filed = async () => (await h.board.query("type=roadmap-item", 100)).find(m => m.text.includes("Fix the back gate latch post"));
    await untilAsync(async () => !!(await filed()), "the card filed anyway", 15_000);
    expect((await filed())!.text).toMatch(/Filed beside \[\[HOME-\d+\]\]/);
  });
});

// Asking an agent from one line (PIE-1437): in the power bar, `@wr` and tab give `@wren `, `[[` completes a page and `%`
// a tile on this screen, and ⏎ sends it as addressed mail: a comment naming @wren on the note in front of the person.
// Driven by the person's keys as Evan would. Scratch service, fictional notes and a made-up demo agent.
import { describe, expect, test } from "bun:test";
import { completionOf } from "../../src/surface/completer";
import { askOf } from "../../src/bar/ask-agent";
import { until } from "../scratch";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe("showcase: ask an agent (PIE-1437)", () => {
  const h = useShowcaseScreen(120);
  const { press, screen } = h;
  const type = (s: string) => { for (const c of s) h.ch(c); };
  const bar = () => (h.app as any).bar;
  const pop = () => (bar() ? completionOf(bar().input) : null);
  const listed = async (what: string, ok: (labels: string[]) => boolean) => {
    await until(() => { const p = pop(); return !!p && !p.loading && ok(p.items.map(i => i.label)); }, what, 8000);
    return pop()!;
  };
  const rota = () => h.seeded.notes.askAgent;

  test("@ lists the agents here, each reference completes by its sigil, ⏎ sends it as a comment naming the agent", async () => {
    await h.app.act({ action: "section", args: { name: "ask-agent" }, as: "test-agent" });
    await until(() => marks["ask-agent"]!.every(m => screen().includes(m)), "the ask-agent section", 8000);
    // Into the stage: the rota is the note in front of the person.
    press({ kind: "enter" });
    await until(() => (h.app as any).noteInFront() === rota().id, "the rota in front", 8000);
    press({ kind: "char", ch: "k", ctrl: true });
    await until(() => !!bar(), "the power bar", 4000);
    // @ stays on the line (the screens moved to :), and lists the agent panel's personas.
    type("@wr");
    expect(bar().query).toBe("@wr");
    await listed("wren among the agents here", labels => labels.includes("@wren"));
    press({ kind: "tab" });
    await until(() => bar().query === "@wren ", "@wren on the line", 8000);
    type("looking at [[Raised beds p");
    await listed("the page", labels => labels.some(l => l.includes("Raised beds plan")));
    press({ kind: "enter" });
    await until(() => /\[\[Raised beds plan\]\]/.test(bar().query), "the page link in the line", 8000);
    type(" can you pop it into %ro");
    await listed("the tile", labels => labels.includes("rota"));
    press({ kind: "tab" });
    await until(() => /%rota $/.test(bar().query), "the tile in the line", 8000);
    await until(() => pop() === null || !pop()!.items.length, "nothing left to complete", 8000);
    // The bar's lit row is the ask, and ⏎ sends it.
    await until(() => bar().describe().rows?.[0]?.label === "ask @wren", "the ask row first", 8000);
    const said: string[] = [], flash = h.app.flash.bind(h.app);
    h.app.flash = ((text: string, ...rest: unknown[]) => { said.push(text); return (flash as any)(text, ...rest); }) as typeof h.app.flash;
    press({ kind: "enter" });
    let body = "";
    await until(() => { void h.board.comments(rota().id).then(cs => { body = cs.find(c => c.body.startsWith("@wren"))?.body ?? ""; }); return !!body; }, "the comment on the rota", 8000);
    expect(body).toStartWith("@wren looking at [[Raised beds plan]] can you pop it into %rota");
    expect(body).toContain("- %rota: the tile rota in the door");
    await until(() => said.some(t => t.startsWith("· asked @wren on Potting bench rota")), "said where the person looks", 8000);
    // Sent: the bar is put away, the line kept under "this session" with what it did.
    await until(() => !bar(), "the bar put away", 8000);
    const sent = (h.app as any).barRuns.at(-1);
    expect(sent.refused).toBe(false);
    expect(sent.line).toStartWith("@wren looking at");
    expect(sent.answer).toContain("asked @wren");
    h.app.flash = flash;
  }, 60_000);

  test("a refused ask keeps its line in the bar, editable, with why (no note in front)", async () => {
    // Out of the stage: the section list has the keys, so no note is in front of the person.
    for (let i = 0; i < 3 && (bar() || (h.app as any).noteInFront() !== null); i++) { press({ kind: "esc" }); await Bun.sleep(100); }
    await until(() => !bar() && (h.app as any).noteInFront() === null, "no note in front", 8000);
    press({ kind: "char", ch: "k", ctrl: true });
    await until(() => !!bar(), "the power bar", 4000);
    type("@wren sort these");
    await until(() => bar().describe().rows?.[0]?.label === "ask @wren", "the ask row first", 8000);
    press({ kind: "enter" });
    await until(() => (h.app as any).barRuns?.some((r: { refused: boolean }) => r.refused), "the refusal said", 8000);
    expect(bar()).toBeTruthy();
    expect(bar().query).toBe("@wren sort these");
    expect((h.app as any).barRuns.at(-1).answer).toContain("the ask goes as a comment on a note");
    press({ kind: "esc" }); press({ kind: "esc" });
    await until(() => !bar(), "the bar put away", 4000);
  }, 30_000);

  test("an agent asks through act, attributed, on a note it names", async () => {
    const out = await h.app.act({ action: "agent.ask", args: { to: "wren", text: "sort the rota", note: rota().id }, as: "test-agent" }) as { note: string; thread: string };
    expect(out.note).toBe(rota().id);
    const c = (await h.board.comments(rota().id)).find(x => x.id === out.thread)!;
    expect(c.body).toBe("@wren sort the rota");
    expect(c.author).toBe("test-agent");
    // A name ends where a person ends it: a comma, a colon or a full stop is punctuation, not the persona's.
    expect(askOf("@wren, sort the rota")).toEqual({ to: "wren", text: "sort the rota" });
    expect(askOf("@wren: sort it")).toEqual({ to: "wren", text: "sort it" });
    expect(askOf("@wren. sort it")).toBeNull();
    // Nothing to ask is refused with what to write.
    await expect(h.app.act({ action: "agent.ask", args: { to: "wren", text: " " }, as: "test-agent" })).rejects.toThrow("what should @wren do?");
  }, 30_000);
});

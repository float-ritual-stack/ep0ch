// The "ask yo" section (PIE-1585): asks, presses and undoes on the seeded outline, through the real extension with no model.
import { describe, expect, test } from "bun:test";
import { until, untilAsync } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe("showcase: ask yo (PIE-1585)", () => {
  const h = useShowcaseScreen(120);
  const note = () => h.seeded.notes.askYo;
  const read = async () => (await h.board.get(note().id))!;
  const say = async (line: string) => { const m = await read(); await h.board.update(m.id, `${m.text.trimEnd()}\n\n${line}\n`, m.revision!, USER); };
  const answered = (what: RegExp) => untilAsync(async () => what.test((await read()).text), `the note says ${what}`, 30_000);

  test("asks on a line: two quoted lines and a button; do it presses as yo; undo takes it back; asked again, from memory", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" });
    await until(() => marks["ask-yo"]!.every(m => h.screen().includes(m)), "the ask-yo section", 8000);
    h.press({ kind: "enter" });
    await until(() => !!h.app.keysScreen()?.dispatch?.tile("focused"), "the keys in the stage", 8000);

    await say("@yo how do I lift the agent again");
    await answered(/@yo answered/);
    const text = (await read()).text;
    expect(text).toContain('> `agent.lift`: "lift the agent tab you\'re using above everything as a column');
    expect(text).toMatch(/> keys: .*✦a/);
    expect(text).toContain('> ::button{label="▲ lift"');
    expect(text).toMatch(/> > \[!note\]- \d+ steps/);
    await until(() => h.screen().includes("▲ lift"), "the button drawn", 8000);

    const keys = () => h.app.keysScreen()?.dispatch?.tile("focused")?.id;
    const focus = keys();
    await say("@yo do it");
    await answered(/✓ yo pressed ▲ lift/);
    const done = (await read()).text;
    expect(done).not.toContain('::button{label="▲ lift"');
    expect(keys()).toBe(focus);
    const run = /ext\.undo run=([\w-]+)/.exec(done)![1]!;

    // The memory it wrote: one note, one fact.
    const memory = await h.board.request("blocks.query", { query: { where: "yo-memory=answer", limit: 5 } });
    expect(memory.blocks.map(b => (b.text ?? "").split("\n")[0])).toEqual(["lift agent: agent.lift [yo-memory::answer] [yo-action::agent.lift] [yo-asked::lift agent] [yo-line::agent.lift]"]);

    const lifted = () => (h.app as any).hostLayer.desks().some((d: any) => d.layout?.lift);
    expect(lifted()).toBe(true);
    // The done row's undo, as the person's press: the lift goes back, one step.
    const undone = await h.app.dispatch.act({ action: "ext.undo", tile: "ask", args: { run } }, USER) as { undone: string; layout?: { undone?: boolean } };
    expect(undone.undone).toBe(run);
    expect(undone.layout?.undone).toBe(true);
    expect(lifted()).toBe(false);

    await say("@yo lift");
    await answered(/@yo lift\n> \[!note\]\+ @yo answered\n> `agent\.lift`: "lift the agent tab[^\n]*· keys: [^\n]*\n> ::button/);
    expect((await read()).text).toContain("answered from memory");
  }, 60_000);

  test("about=tile asks from where you are: the tile on a line, the door and tile on the thread; the tile menu offers it", async () => {
    const rows = h.app.keysScreen()!.dispatch!.menu("focused", USER);
    expect(rows.map(r => r.label)).toContain("ask yo about this");
    const out = await h.app.act({ action: "agent.ask", args: { to: "yo", about: "tile" } }) as { note: string; thread: string; answers: boolean };
    expect(out.answers).toBe(true);
    const threads = await h.board.comments(out.note);
    const thread = threads.find(t => t.id === out.thread)!;
    expect(thread.body).toContain("@yo about this tile");
    expect(thread.props?.["ask-door"]).toEqual([h.board.clientId]);
    expect(thread.props?.["ask-tile"]?.length).toBe(1);
    await untilAsync(async () => ((await h.board.comments(out.note)).find(t => t.id === out.thread)?.replies?.length ?? 0) > 0, "yo's reply in the thread", 30_000);
  }, 60_000);

  test("yo pressing agent.ask at itself doesn't answer itself: an agent's ask never wakes its own name", async () => {
    const out = await h.app.act({ action: "agent.ask", args: { to: "yo", text: "how do I zoom the tile", about: "tile" }, as: "yo" }) as { note: string; thread: string };
    await Bun.sleep(2500);
    expect((await h.board.comments(out.note)).find(t => t.id === out.thread)?.replies ?? []).toEqual([]);
  }, 30_000);

  test("in a thread: the answer's button is a link a comment draws; a reply saying do it acts on the tile asked about, not the one focused now", async () => {
    const desk = () => h.app.keysScreen() as any;
    const asked = h.app.keysScreen()!.dispatch!.tile("focused")!;
    await h.app.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "other" } }, USER);
    await until(() => !!desk().dispatch.tile("other"), "a second tile", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: asked.id! }, USER);
    const out = await h.app.act({ action: "agent.ask", args: { to: "yo", text: "how do I zoom the tile", about: asked.id! } }) as { note: string; thread: string };
    const replies = async () => (await h.board.comments(out.note)).find(t => t.id === out.thread)?.replies ?? [];
    await untilAsync(async () => (await replies()).length > 0, "yo's answer", 30_000);
    expect((await replies())[0]!.body).toContain(`(act: tile.zoom tile=${asked.id}`);
    await h.app.dispatch.act({ action: "tile.focus", tile: "other" }, USER);
    await h.board.reply(crypto.randomUUID(), out.thread, "@yo do it", USER);
    await untilAsync(async () => (await replies()).some(r => /yo pressed|the door refused/.test(r.body)), "the press said in the thread", 30_000);
    // The action reached the tile asked about, and the actor rule holds there: yo won't hide the tile with the keys.
    expect((await replies()).at(-1)!.body).toContain(`zooming tile ${asked.name} would hide tile other`);
  }, 60_000);

  test("yo acting for Evan keeps yo's name: agent.ask through door.act isn't written as him and doesn't answer itself; a key note he pressed is his", async () => {
    const tile = h.app.keysScreen()!.dispatch!.tile("focused")!;
    const asYo = await h.app.dispatch.act({ action: "agent.ask", args: { to: "yo", text: "how do I zoom the tile", note: note().id, about: tile.id! } }, { kind: "agent", id: "yo", for: "you" }) as { note: string; thread: string };
    const thread = (await h.board.comments(asYo.note)).find(t => t.id === asYo.thread)!;
    expect(thread.author).toContain("yo");
    await Bun.sleep(2500);
    expect((await h.board.comments(asYo.note)).find(t => t.id === asYo.thread)?.replies ?? []).toEqual([]);
    const pressed = await h.app.dispatch.act({ action: "agent.ask", args: { to: "yo", text: "how do I zoom the tile", note: note().id, about: tile.id! } }, { kind: "agent", id: "script:ask-yo", for: "you" }) as { note: string; thread: string };
    expect((await h.board.comments(pressed.note)).find(t => t.id === pressed.thread)!.author).not.toContain("script");
  }, 30_000);

  test("a press that changes no note and no layout says it has no undo", async () => {
    await say("@yo tile info");
    await answered(/`tile\.info`/);
    // A line runs once per its words in a note, so this second go says it another way.
    await say("@yo yes");
    await answered(/✓ yo pressed [^\n]*no undo/);
  }, 60_000);
});

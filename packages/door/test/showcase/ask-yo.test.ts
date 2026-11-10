// The "ask yo" section (PIE-1585): asks, presses and undoes on the seeded outline, through the real extension with no model.
import { describe, expect, test } from "bun:test";
import { until, untilAsync } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";
import { pressState } from "../../src/surface/button";

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

  test("typed in the editor: it answers under the line the cursor is on; enter goes on past the answer; other words replace it", async () => {
    await until(() => !!h.app.keysScreen()?.dispatch?.tile("focused"), "the keys in the stage", 8000);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo how do I dock") h.ch(c);
    // Quiet with the cursor still on the line: yo answers under it, and the cursor stays.
    await until(() => h.screen().includes("· tile.dock"), "yo's answer beside the line", 30_000);
    expect(h.screen()).not.toContain("could not accept");
    for (const c of " the tile") h.ch(c);
    const draft = () => h.S().stages.get(h.S().sel).top.pane("ask").surface.draft as { text: string };
    // The answer to the line's first words gives way to the answer to all of them, under it.
    await until(() => /@yo how do I dock the tile\n> \[!note\][-+]? @yo answered\n/.test(draft().text), "the answer to the whole words", 30_000);
    h.press({ kind: "enter" });
    for (const c of "and I go on") h.ch(c);
    h.press({ kind: "char", ch: "s", ctrl: true });
    await untilAsync(async () => (await read()).text.includes("and I go on"), "the save", 8000);
    const text = (await read()).text, asked = text.slice(text.indexOf("@yo how do I dock the tile"));
    expect(asked).toMatch(/^@yo how do I dock the tile\n> \[!note\][-+]? @yo answered\n> `tile\.dock`/);
    expect(asked).toMatch(/\n> > - [^\n]*\nand I go on\s*$/);
    expect(asked.split("\n").filter(l => l.endsWith("@yo answered")).length).toBe(1);
  }, 90_000);

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

  // PIE-1626: a remembered press with arguments reads as what it will do, and a press that changed nothing offers no undo.
  test("a remembered agent.lift on=false reads ▼ drop; pressed with nothing lifted, there is nothing to undo", async () => {
    const lifted = () => (h.app as any).hostLayer.desks().some((d: any) => d.layout?.lift);
    // An agent tab, down: lifted and dropped again by the person, so there is one to drop and nothing lifted.
    await h.app.dispatch.act({ action: "agent.lift", args: { on: true } }, USER);
    await until(lifted, "the agent tab lifted", 8000);
    await h.app.dispatch.act({ action: "agent.lift", args: { on: false } }, USER);
    expect(lifted()).toBe(false);
    // The memory a press of yo's drop button leaves (its second act, ext.yo.remember), so the next ask answers from it.
    await h.board.createBlock(null, "drop agent: agent.lift on=false [yo-memory::answer] [yo-action::agent.lift] [yo-asked::drop agent] [yo-line::agent.lift on=false]");
    await say("@yo drop the agent");
    await answered(/@yo drop the agent\n> \[!note\]\+ @yo answered\n[^\n]*\n> ::button\{label="▼ drop" act=\["agent\.lift on=false"/);
    expect((await read()).text).toContain("answered from memory");
    // A line runs once per its words in a note (the first test said do it), so this go says it another way.
    await say("@yo press it");
    await answered(/✓ yo pressed ▼ drop · nothing to undo/);
    expect((await read()).text).not.toMatch(/✓ yo pressed ▼ drop · \[undo\]/);
    expect(lifted()).toBe(false);
  }, 90_000);

  test("a press that changes no note and no layout says it has no undo", async () => {
    await say("@yo tile info");
    await answered(/`tile\.info`/);
    // A line runs once per its words in a note, so this second go says it another way.
    await say("@yo yes");
    await answered(/✓ yo pressed [^\n]*no undo/);
  }, 60_000);

  // PIE-1693: the button yo draws in its answer callout runs when pressed, by the person (a click is button.press, from the frame
  // they see, drawn before a line was written above it) and through act: its action, then yo's remember, one sequence to its end.
  test("yo's remembered ▼ drop, in its answer callout, runs both steps when the person or an agent presses it", async () => {
    const lifted = () => (h.app as any).hostLayer.desks().some((d: any) => d.layout?.lift);
    // Run alone it opens the section; after the others it is already there.
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    // A note of its own: a note answers its first eight @yo lines, and the section's has had its share.
    const own = await h.board.createBlock(null, "Ask yo, again\n\nWhere the drop button is pressed.\n");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    const read = async () => (await h.board.get(own.id))!;
    const say = async (line: string) => { const m = await read(); await h.board.update(m.id, `${m.text.trimEnd()}\n\n${line}\n`, m.revision!, USER); };
    const answered = (what: RegExp) => untilAsync(async () => what.test((await read()).text), `the note says ${what}`, 30_000);
    await h.board.createBlock(null, "park agent: agent.lift on=false [yo-memory::answer] [yo-action::agent.lift] [yo-asked::park agent] [yo-line::agent.lift on=false]");
    await h.app.dispatch.act({ action: "agent.lift", args: { on: true } }, USER);
    await until(lifted, "the agent tab lifted", 8000);
    await say("@yo park the agent lift");
    await answered(/@yo park the agent lift\n> \[!note\]\+ @yo answered\n[^\n]*\n> ::button\{label="▼ drop" act=\["agent\.lift on=false", "ext\.yo\.remember /);
    const surface = () => h.S().stages.get(h.S().sel).top.pane("ask").surface;
    await until(() => surface().describeElements().some((e: { label: string }) => e.label.includes("▼ drop")), "the button drawn in the reader", 8000);
    const memory = async () => (await h.board.request("blocks.query", { query: { where: "yo-action=agent.lift", limit: 50 } })).blocks.filter(b => (b.text ?? "").startsWith("park agent lift: agent.lift on=false")).length;
    const press = async (as: "person" | "agent") => {
      // A line written above it after it was drawn (the person typing, an answer above): the press finds where it is now.
      if (as === "person") { const m = await read(); await h.board.update(m.id, m.text.replace("\n\n", "\n\nwritten above it after it was drawn\n\n"), m.revision!, USER); }
      const r = (as === "person"
        ? await h.app.dispatch.act({ action: "button.press", tile: "ask", args: { label: "▼ drop" } }, USER)
        : await h.app.act({ action: "button.press", args: { note: own.id, label: "▼ drop" }, as: "test-agent" })) as { extension?: string };
      expect(r.extension).toStartWith(`button:${own.id}:`);
      // The run ends done (scripts.ended), the button drawn as done: both steps ran.
      const line = Number(r.extension!.split(":").at(-1));
      await until(() => pressState(own.id, line, "▼ drop").state === "done", `the ${as}'s press done`, 15_000);
      expect(lifted()).toBe(false);
      // Its last step ran: yo remembered these words, once (the second press finds them kept).
      expect(await memory()).toBe(1);
    };
    await press("person");
    // An agent's press drops nothing now (the person's lift is theirs to drop): it still runs both steps to done.
    await press("agent");
  }, 120_000);
  // PIE-1676: yo's remember takes an argument named asked, and the door's own words for its run never take its place.
  test("an agent's ext.yo.remember asked=… keeps what it asked", async () => {
    await h.app.act({ action: "ext.yo.remember", args: { act: "tile.zoom", asked: "zoom-the-shed", args: "reach:full" }, as: "test-agent" });
    const kept = async () => (await h.board.request("blocks.query", { query: { where: "yo-action=tile.zoom", limit: 20 } })).blocks.map(b => (b.text ?? "").split("\n")[0]!).filter(t => t.includes("reach=full"));
    await untilAsync(async () => (await kept()).length > 0, "the memory written", 15_000);
    expect(await kept()).toEqual(["zoom shed: tile.zoom reach=full [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::zoom shed] [yo-line::tile.zoom reach=full]"]);
  }, 30_000);
});

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
  // PIE-1699: yo's answer beside the line being typed (the answer tile) draws its button live, and pressing it there runs the
  // reader's one press (runPress) on the line as typed, before it is saved: its action, then yo's remember, to the end.
  for (const how of ["click", "keys"] as const) test(`typed in the editor: the ▼ drop in the answer tile beside the line is pressed there, by ${how}`, async () => {
    const lifted = () => (h.app as any).hostLayer.desks().some((d: any) => d.layout?.lift);
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, `Ask yo, while typing (${how})\n\nWhere the answer's button is pressed beside the line.\n`);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    // Into the stage, as a person goes in from the section list (run alone, the keys start on the list).
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    await h.board.createBlock(null, `stow agent ${how}: agent.lift on=false [yo-memory::answer] [yo-action::agent.lift] [yo-asked::stow agent ${how}] [yo-line::agent.lift on=false]`);
    // Lifted by an agent, so the keys stay where the person is.
    await h.app.act({ action: "agent.lift", args: { on: true }, as: "test-agent" });
    await until(lifted, "the agent tab lifted", 8000);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    const asked = `stow the agent ${how}`;
    for (const c of `@yo ${asked}`) h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const answer = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).find(t => t.kind === "answer")?.name;
    await until(() => !!answer() && h.screen().includes("▼ drop"), "yo's answer beside the line, with its button", 30_000);
    const draft = () => stage().pane("ask").surface.draft as { text: string } | null;
    expect(draft()?.text).toContain('::button{label="▼ drop"');
    // Not saved: the button is only in the edit.
    expect((await h.board.get(own.id))!.text).not.toContain("▼ drop");
    if (how === "click") {
      const lines = h.screen().split("\n"), y = lines.findIndex(l => l.includes("▼ drop")), x = lines[y]!.indexOf("▼ drop") + 1;
      h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never);
    } else {
      // The keys into the answer tile (as Tab or ^W there), then its number: the links and buttons are numbered as drawn.
      const tile = stage().pane(answer()!) as { links: { press?: unknown }[] };
      const n = tile.links.findIndex(l => l.press) + 1;
      expect(n).toBeGreaterThan(0);
      await h.app.dispatch.act({ action: "tile.focus", tile: answer()! }, USER);
      h.ch(String(n));
    }
    // The press ran its line as typed to its end (both steps: the drop, then yo's remember), and the tab is down.
    const line = draft()!.text.split("\n").findIndex(l => l.includes('label="▼ drop"'));
    await until(() => pressState(own.id, line, "▼ drop").state === "done", `the ${how}'s press done`, 15_000);
    expect(lifted()).toBe(false);
    // The person's edit is still open, their words in it; saved, it ends.
    expect(draft()?.text).toContain(`@yo ${asked}`);
    await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
    await until(() => !draft(), "the edit saved and closed", 8000);
    await untilAsync(async () => (await h.board.get(own.id))!.text.includes(`@yo ${asked}`), "the saved words");
  }, 90_000);

  // PIE-1699 review: a press from the answer tile acts where the note is, the reader beside it, never the answer tile itself:
  // a remembered tile.title with no tile= names the reader the line is typed in.
  test("typed in the editor: a tile-relative button pressed in the answer tile acts on the reader, not the answer tile", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Ask yo, naming a tile\n\nWhere a tile-relative button is pressed beside the line.\n");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    await h.board.createBlock(null, "name shed tile: tile.title text=Seedlings [yo-memory::answer] [yo-action::tile.title] [yo-asked::name shed tile] [yo-line::tile.title text=Seedlings]");
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo name the shed tile") h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const answer = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).find(t => t.kind === "answer")?.name;
    const pane = stage().pane("ask"), draft = () => pane.surface.draft as { text: string } | null;
    await until(() => !!answer() && /::button\{label="[^"]+" act=\["tile\.title text=/.test(draft()?.text ?? ""), "yo's answer with a tile.title button", 30_000);
    const tile = () => stage().pane(answer()!) as { links: { press?: unknown }[] };
    await until(() => tile().links.some(l => l.press), "the button drawn in the answer tile", 8000);
    const n = tile().links.findIndex(l => l.press) + 1;
    await h.app.dispatch.act({ action: "answer.follow", tile: answer()!, args: { n } }, USER);
    // The reader (the tile the note is in) takes the title, by its id: the answer tile keeps its own.
    const reader = () => (stage().layoutGet().tiles as { tile: string; kind: string; title?: string }[]).find(t => t.kind === "reader")!;
    const answerTitle = () => (stage().layoutGet().tiles as { kind: string; title?: string }[]).find(t => t.kind === "answer")!.title;
    await until(() => reader().title === "Seedlings", `the reader titled (it reads ${reader().title}, the answer tile ${answerTitle()})`, 15_000);
    expect(answerTitle()).not.toBe("Seedlings");
    await h.app.dispatch.act({ action: "edit.save", tile: reader().tile }, USER);
    await until(() => !draft(), "the edit saved and closed", 8000);
    await h.app.dispatch.act({ action: "tile.title", tile: reader().tile, args: { text: "ask" } }, USER);   // the section's name back
  }, 90_000);

  // PIE-1699 (the verifier's repro): a tile-relative button pressed from the answer tile while the keys are there (a click
  // moves them; a number key and answer.follow are pressed there) acts on the reader the ask came from, never the answer tile. tile.agent with
  // no tile= cycles the level of the tile it lands on: the reader goes free → edit, the answer tile stays free (agents can
  // still follow there).
  for (const how of ["click", "keys", "follow", "agent"] as const) test(`typed in the editor: a tile.agent button in the answer tile acts on the reader, by ${how}`, async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, `Ask yo, a tile's agents (${how})\n\nWhere a tile-relative button is pressed beside the line.\n`);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    await h.board.createBlock(null, `guard tile ${how}: tile.agent [yo-memory::answer] [yo-action::tile.agent] [yo-asked::guard tile ${how}] [yo-line::tile.agent]`);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of `@yo guard the tile ${how}`) h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    type Row = { name: string; tile: string; kind: string; agents?: string };
    const rows = () => stage().layoutGet().tiles as Row[];
    const answer = () => rows().find(t => t.kind === "answer")?.name;
    const pane = stage().pane("ask"), draft = () => pane.surface.draft as { text: string } | null;
    await until(() => !!answer() && /::button\{label="[^"]+" act=\["tile\.agent"/.test(draft()?.text ?? ""), "yo's answer with a tile.agent button", 30_000);
    const tile = () => stage().pane(answer()!) as { links: { press?: unknown }[] };
    await until(() => tile().links.some(l => l.press) && h.screen().includes("▸ agent"), "the button drawn in the answer tile", 8000);
    const n = tile().links.findIndex(l => l.press) + 1;
    const reader = () => rows().find(t => t.kind === "reader" && t.name === "ask")!, theAnswer = () => rows().find(t => t.kind === "answer")!;
    try {
      if (how === "click") {
        const lines = h.screen().split("\n"), y = lines.findLastIndex(l => l.includes("▸ agent")), x = lines[y]!.lastIndexOf("▸ agent") + 1;
        h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never);
      } else if (how === "keys") {
        // The keys into the answer tile (as Tab or ^W there), then its number: the focused tile is the answer tile, not the reader.
        await h.app.dispatch.act({ action: "tile.focus", tile: answer()! }, USER);
        h.ch(String(n));
      } else if (how === "follow") {
        await h.app.dispatch.act({ action: "tile.focus", tile: answer()! }, USER);
        await h.app.dispatch.act({ action: "answer.follow", tile: answer()!, args: { n } }, USER);
      } else {
        // An agent's press there while the person types in the reader (the verifier's open path): it lands on the reader, and
        // the answer tile stays free, so the agent can follow there again.
        await h.app.act({ action: "answer.follow", tile: answer()!, args: { n }, as: "test-agent" });
      }
      await until(() => reader().agents === "edit", "the reader set to edit", 15_000)
        .catch(e => { throw new Error(`${e.message}: the reader reads ${reader().agents ?? "free"}, the answer tile ${theAnswer().agents ?? "free"}`); });
      expect(theAnswer().agents).toBeUndefined();
      // The person's edit is still open, their words in it.
      expect(draft()?.text).toContain(`@yo guard the tile ${how}`);
    } finally {
      if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
      await until(() => !draft(), "the edit saved and closed", 8000);
      for (const t of ["ask", answer()].filter(Boolean)) await h.app.dispatch.act({ action: "tile.agent", tile: t!, args: { policy: "inherit" } }, USER);
      await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    }
  }, 90_000);

  // PIE-1716: an edit open while its reader moves (gathered into a group alone or with its answer tile, put in the drawer):
  // asked before and after the move, yo's answer is in one tile beside the reader where it is now, and the caret on an ask
  // selects it there. The draft asks for its reader's host each time, never the one it opened with.
  for (const move of ["group", "group with its answer", "drawer"] as const) test(`an edit open while its reader moves (${move}): yo's answer tile follows it`, async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const tag = move.split(" ").length;
    const own = await h.board.createBlock(null, `Ask yo, then move (${move})\n\nWhere the reader moves while the edit is open.\n`);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    for (const what of ["fold", "zoom"]) await h.board.createBlock(null, `${what} shed ${tag}: tile.${what} [yo-memory::answer] [yo-action::tile.${what}] [yo-asked::${what} shed ${tag}] [yo-line::tile.${what}]`);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const pane = stage().pane("ask");
    const draft = () => pane.surface.draft as { text: string; row: number } | null;
    const { AnswerTile } = await import("../../src/desk/answer-tile");
    // Every desk the door has, a group's own included: where the reader is, and every answer tile anywhere.
    const desks = () => (h.app as any).hostLayer.everyDesk().flatMap((d: any) => [d, ...d.descend()]).filter((d: any, i: number, all: any[]) => all.indexOf(d) === i);
    const holder = () => desks().find((d: any) => [...d.panes.values()].includes(pane));
    const answers = () => desks().flatMap((d: any) => [...d.panes.values()].filter((p: any) => p instanceof AnswerTile).map((p: any) => ({ ask: p.ask as string, beside: d === holder() && d.paneNamed(p.source) === pane })));
    const shows = (words: string) => { const all = answers(); return all.length === 1 && all[0]!.beside && all[0]!.ask.includes(words); };
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => !!draft(), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of `@yo fold the shed ${tag}`) h.ch(c);
    await until(() => shows(`fold the shed ${tag}`), "yo's answer tile beside the reader on the stage", 30_000);
    const answerName = stage().nameOf([...stage().panes].find(([, p]: any) => p instanceof AnswerTile)![0]);
    // The reader moves with the edit open.
    let spill: (() => Promise<unknown>) | null = null;
    if (move === "drawer") {
      await h.app.dispatch.act({ action: "tile.drawer", tile: "ask", args: { on: true } }, USER);
      await h.app.dispatch.act({ action: "host.enter" }, USER);
      spill = () => h.app.dispatch.act({ action: "tile.drawer", tile: holder().tileIdOfPane(pane), args: { on: false } }, USER);
    } else {
      const g = await h.app.dispatch.act({ action: "tile.group", tile: "ask", args: move === "group" ? {} : { with: answerName } }, USER) as { name?: string; tile?: string };
      await h.app.dispatch.act({ action: "tile.focus", tile: holder().tileIdOfPane(pane) }, USER);
      spill = () => h.app.dispatch.act({ action: "tile.group", tile: g.tile ?? g.name!, args: { on: false } }, USER);
    }
    try {
      await until(() => !!holder() && holder() !== stage(), `the reader in the ${move}`, 8000);
      h.press({ kind: "end", ctrl: true });
      h.press({ kind: "enter" }); h.press({ kind: "enter" });
      for (const c of `@yo zoom the shed ${tag}`) h.ch(c);
      await until(() => !!draft()?.text.includes(`@yo zoom the shed ${tag}`), "the second ask typed in the edit", 8000);
      await until(() => shows(`zoom the shed ${tag}`), `one answer tile beside the reader in the ${move}, on the new ask`, 30_000).catch(e => { throw new Error(`${e.message}: ${JSON.stringify(answers())}`); });
      // The caret back on the first ask selects it there, with no refusal.
      const row = draft()!.text.split("\n").findIndex(l => l.startsWith(`@yo fold the shed ${tag}`));
      while (draft()!.row > row) h.press({ kind: "up" });
      await until(() => shows(`fold the shed ${tag}`), `the first ask selected again (${JSON.stringify(answers())})`, 8000);
      expect(h.screen()).not.toContain("no reader on the showcase");
    } finally {
      if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: holder().tileIdOfPane(pane) }, USER);
      await until(() => !draft(), "the edit saved and closed", 8000);
      // Back where the section keeps it, alone, for the next test.
      await spill?.();
      await until(() => stage().pane("ask") === pane, "the reader back on the stage", 8000);
      for (const [, p] of [...stage().panes]) if (p instanceof AnswerTile) await h.app.dispatch.act({ action: "tile.close", tile: stage().tileIdOfPane(p) }, USER);
    }
  }, 90_000);

  // PIE-1676: yo's remember takes an argument named asked, and the door's own words for its run never take its place.
  test("an agent's ext.yo.remember asked=… keeps what it asked", async () => {
    await h.app.act({ action: "ext.yo.remember", args: { act: "tile.zoom", asked: "zoom-the-shed", args: "reach:full" }, as: "test-agent" });
    const kept = async () => (await h.board.request("blocks.query", { query: { where: "yo-action=tile.zoom", limit: 20 } })).blocks.map(b => (b.text ?? "").split("\n")[0]!).filter(t => t.includes("reach=full"));
    await untilAsync(async () => (await kept()).length > 0, "the memory written", 15_000);
    expect(await kept()).toEqual(["zoom shed: tile.zoom reach=full [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::zoom shed] [yo-line::tile.zoom reach=full]"]);
  }, 30_000);
  // PIE-1705: what describes yo's remember (ep0ch actions, its docs, the bar's form) is its own arguments; the door's own
  // words for a press (door:via, door:asked) are still taken, and named apart.
  test("ep0ch actions lists ext.yo.remember with its own arguments, not the door's words", async () => {
    const info = h.app.actions().actions.find(a => a.name === "ext.yo.remember")!;
    expect(Object.keys(info.args)).toEqual(expect.arrayContaining(["act", "asked", "args"]));
    expect(Object.keys(info.args).filter(k => k.startsWith("door:"))).toEqual([]);
    expect(info.doorWords).toEqual(["door:via", "door:asked"]);
    await h.app.act({ action: "ext.yo.remember", args: { act: "tile.zoom", asked: "zoom-the-yard", args: "reach:full", "door:asked": true }, as: "test-agent" });
    // A wrong argument is answered with the part's own arguments, never the door's words.
    const refused = await h.app.act({ action: "ext.yo.remember", args: { nope: "1" }, as: "test-agent" }).then(() => "", (e: Error) => e.message);
    expect(refused).toContain("asked (string)");
    expect(refused).not.toContain("door:");
  }, 30_000);
});


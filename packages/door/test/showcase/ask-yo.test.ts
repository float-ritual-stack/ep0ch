// The "ask yo" section (PIE-1585): asks, presses and undoes on the seeded outline, through the real extension with no model.
import { describe, expect, test } from "bun:test";
import { until, untilAsync } from "../scratch";
import { USER } from "../../src/socket";
import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";
import { pressState } from "../../src/surface/button";
import { ReaderPane } from "../../src/desk/panes";

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
    const memory = await h.board.request("blocks.query", { query: { where: "yo-memory=answer yo-action=agent.lift", limit: 5 } });
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

  // PIE-1711: a find's answer, as yo writes it (findAnswer, its one builder): its buttons open the query in a facets tile,
  // put it on that tile's query line to edit, and save it as a view, each one press.
  test("a find's buttons open the query in facets, put it on the query line, and save it as a view", async () => {
    const { findAnswer } = await import("../../../outliner/extensions/yo/yo-line");
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const a = await h.board.createBlock(null, "Seed swap flyer [type::shed-item] [status::draft]");
    const b = await h.board.createBlock(null, "Shed rota [type::shed-item] [status::queued]");
    await h.board.createBlock(null, "Compost notice [type::shed-item] [status::sent]");
    const where = "type=shed-item NOT status=sent";
    const lines = findAnswer({ words: "shed items that are not sent", where, read: [{ clause: "type=shed-item", from: ["shed items"] }, { clause: "NOT (status=sent)", from: ["not", "sent"] }], found: { notes: [{ id: a.id, title: "Seed swap flyer" }, { id: b.id, title: "Shed rota" }], more: false } });
    const own = await h.board.createBlock(null, ["Find the shed items", "", "@yo find me the shed items that are not sent", "> [!note]+ @yo answered", ...lines.map(l => `> ${l}`), ""].join("\n"));
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const found = () => stage().pane("found") as unknown as { query(): string | null; draft: { text: string } | null; items?: unknown[] } | undefined;
    const text = (await h.board.get(own.id))!.text;
    const press = async (label: string) => {
      await h.app.dispatch.act({ action: "button.press", tile: "ask", args: { label } }, USER);
      const line = text.split("\n").findIndex(l => l.includes(`label="${label}"`));
      await until(() => ["done", "failed"].includes(pressState(own.id, line, label).state ?? ""), `${label} settled`, 15_000);
      return pressState(own.id, line, label);
    };
    expect(await press("▸ open in facets")).toEqual({ state: "done" });
    expect(found()?.query()).toContain("shed-item");
    expect(await press("▸ edit the query")).toEqual({ state: "done" });
    expect(found()?.draft?.text).toBe(where);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    // Saved under the words that asked for it, one press.
    expect(await press("▸ save as a view")).toEqual({ state: "done" });
    const views = await h.board.request("blocks.query", { query: { where: "type=virtual-branch", limit: 200 } });
    expect(views.blocks.map(b => (b.text ?? "").split("\n")[0]).some(t => !!t?.startsWith("Shed items that are not sent"))).toBe(true);
    await h.app.dispatch.act({ action: "tile.close", tile: "found" }, USER).catch(() => {});
  }, 90_000);

  // PIE-1711, the verifier's re-walk: one rule for a yo button pressed while typing. A press whose purpose is typing takes the
  // keys to the line it opens (▸ edit the query); one that shows something (▸ open in facets) opens it beside, keys in the edit.
  test("pressed while typing: open in facets leaves the keys in the edit; edit the query takes them to its line", async () => {
    const { findAnswer } = await import("../../../outliner/extensions/yo/yo-line");
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const job = await h.board.createBlock(null, "Shed rota [type::shed-job] [status::queued]");
    const lines = findAnswer({ words: "shed jobs", where: "type=shed-job", found: { notes: [{ id: job.id, title: "Shed rota" }], more: false } });
    const answer = await h.board.createBlock(null, ["Shed jobs, answered", "", "@yo find the shed jobs", "> [!note]+ @yo answered", ...lines.map(l => `> ${l}`), ""].join("\n"));
    const own = await h.board.createBlock(null, "Typing a find\n\nWhere the person is typing.\n");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const keys = () => h.app.keysScreen()?.dispatch?.tile("focused")?.name;
    const draft = () => stage().pane("ask").surface.draft as { text: string } | null;
    const facets = () => stage().pane("found") as unknown as { draft: { text: string } | null; query(): string | null } | undefined;
    const press = async (label: string) => {
      await h.app.dispatch.act({ action: "button.press", args: { note: answer.id, label } }, USER);
      const line = (await h.board.get(answer.id))!.text.split("\n").findIndex(l => l.includes(`label="${label}"`));
      await until(() => ["done", "failed"].includes(pressState(answer.id, line, label).state ?? ""), `${label} settled`, 15_000);
      return pressState(answer.id, line, label);
    };
    // Shows something: it opens beside, the keys stay where the person writes.
    expect(await press("▸ open in facets")).toEqual({ state: "done" });
    expect(facets()?.query()).toContain("shed-job");
    expect(keys()).toBe("ask");
    h.ch("x");
    await until(() => draft()?.text.includes("x") ?? false, "typing goes on in the edit", 4000);
    // Its purpose is typing: the keys go to the line it opens, and the next keys type there.
    expect(await press("▸ edit the query")).toEqual({ state: "done" });
    expect(keys()).toBe("found");
    // The line holds the query with the cursor after it: typing goes on at its end (PIE-1731).
    for (const c of " NOT status=sent") h.ch(c);
    await until(() => facets()?.draft?.text === "type=shed-job NOT status=sent", "typed on the query line", 4000).catch(e => { throw new Error(`${e.message}: ${JSON.stringify(facets()?.draft?.text)} / edit ${JSON.stringify(draft()?.text.slice(-40))}`); });
    expect(draft()!.text).not.toContain("status=sent");
    h.press({ kind: "esc" });
    await h.app.dispatch.act({ action: "tile.close", tile: "found" }, USER).catch(() => {});
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
  }, 90_000);

  // PIE-1712: an answer fits the ask. backlinks.view with step=kind names its one key, K, and its button says it: ▸ by kind. Asked
  // from a reader, where no backlinks tile is open, the button opens the note's links first (`links`), then groups them.
  test("asked how to see backlinks by kind: K alone, ▸ by kind, and a press opens the links and groups them", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Seed swap, linked\n\nWhere backlinks are grouped by kind.\n");
    await h.board.createBlock(null, `Swap plan [type::plan]\n\nSee ((${own.id})).`);
    await h.board.createBlock(null, `Swap chirp [type::chirp]\n\nAlso ((${own.id})).`);
    await h.board.createBlock(null, "backlinks by kind: backlinks.view step=kind [yo-memory::answer] [yo-action::backlinks.view] [yo-asked::backlinks by kind] [yo-line::backlinks.view step=kind]");
    const stage = () => h.S().stages.get(h.S().sel).top;
    const kinds = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).filter(t => t.kind === "backlinks");
    // A screen with no backlinks tile, as a reader alone is.
    for (const t of kinds()) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const read = async () => (await h.board.get(own.id))!;
    const m = await read();
    await h.board.update(m.id, `${m.text.trimEnd()}\n\n@yo backlinks by kind\n`, m.revision!, USER);
    await untilAsync(async () => (await read()).text.includes("@yo answered"), "yo's answer", 30_000);
    const text = (await read()).text;
    expect(text).toContain("keys: K: by kind");
    expect(text).toContain('::button{label="▸ by kind" act=["links", "backlinks.view step=kind", "ext.yo.remember act=backlinks.view');
    expect(kinds()).toEqual([]);
    const surface = () => stage().pane("ask").surface;
    await until(() => surface().describeElements().some((e: { label: string }) => e.label.includes("▸ by kind")), "the button drawn in the reader", 8000);
    await h.app.dispatch.act({ action: "button.press", tile: "ask", args: { label: "▸ by kind" } }, USER);
    const line = (await read()).text.split("\n").findIndex(l => l.includes('label="▸ by kind"'));
    await until(() => ["done", "failed"].includes(pressState(own.id, line, "▸ by kind").state ?? ""), "the press settled", 15_000);
    expect(pressState(own.id, line, "▸ by kind")).toEqual({ state: "done" });
    const tile = kinds()[0]!;
    expect((stage().pane(tile.name) as unknown as { options: { kind: string | null } }).options.kind).not.toBeNull();
    await h.app.dispatch.act({ action: "tile.close", tile: tile.name }, USER);
  }, 90_000);

  // PIE-1712, typed: the answer tile beside the line draws the ▸ by kind button while the person types, and pressing it there
  // opens the note's links and groups them by kind.
  test("typed in the editor: ▸ by kind in the answer tile opens the links and groups them", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Seed swap, typed\n\nWhere backlinks are grouped by kind while typing.\n");
    await h.board.createBlock(null, `Swap list [type::plan]\n\nSee ((${own.id})).`);
    await h.board.createBlock(null, "backlinks by kind: backlinks.view step=kind [yo-memory::answer] [yo-action::backlinks.view] [yo-asked::backlinks by kind] [yo-line::backlinks.view step=kind]");
    const stage = () => h.S().stages.get(h.S().sel).top;
    const rows = () => stage().layoutGet().tiles as { name: string; kind: string }[];
    for (const t of rows().filter(t => t.kind === "backlinks")) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo backlinks by kind") h.ch(c);
    const answer = () => rows().find(t => t.kind === "answer")?.name;
    const draft = () => stage().pane("ask").surface.draft as { text: string } | null;
    await until(() => !!answer() && /label="▸ by kind"/.test(draft()?.text ?? ""), "yo's answer with ▸ by kind", 30_000);
    const tile = () => stage().pane(answer()!) as { links: { press?: unknown }[] };
    await until(() => tile().links.some(l => l.press), "the button drawn in the answer tile", 8000);
    const n = tile().links.findIndex(l => l.press) + 1;
    await h.app.dispatch.act({ action: "answer.follow", tile: answer()!, args: { n } }, USER);
    await until(() => rows().some(t => t.kind === "backlinks"), "the links opened", 15_000);
    const links = rows().find(t => t.kind === "backlinks")!.name;
    await until(() => (stage().pane(links) as unknown as { options: { kind: string | null } }).options.kind !== null, "grouped by kind", 15_000);
    // Its preview's title quotes the note the preview shows, never another row's (the verifier's re-walk, PIE-1711).
    const preview = rows().find(t => t.kind === "preview");
    if (preview) {
      const p = stage().pane(preview.name) as unknown as { title(): string; msg?: { text: string } | null };
      const q = /^"([^"]+)"/.exec(p.title())?.[1];
      if (q) expect(p.msg?.text.replace(/\s+/g, " ") ?? "(nothing shown)").toContain(q);
    }
    // The links open beside the edit, and the keys stay where the person is writing (loki on #1426).
    expect(h.app.keysScreen()?.dispatch?.tile("focused")?.name).toBe("ask");
    for (const c of " and on") h.ch(c);
    await until(() => draft()?.text.includes(" and on") ?? false, "typing goes on in the edit", 4000);
    if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
    await until(() => !draft(), "the edit saved and closed", 8000);
    await h.app.dispatch.act({ action: "tile.close", tile: links }, USER);
  }, 90_000);

  // PIE-1712, the verifier's walk on the default desk: a desk with a replies tile (a links tile listing children alone). The
  // button's links step aims a links tile that lists backlinks, never the replies, and the run says the button's words.
  test("▸ by kind on a desk with a replies tile groups the note's backlinks, and says ▸ by kind done", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "G\n\nA note others link to.\n");
    await h.board.createBlock(null, `Planning notes [type::plan]\n\nSee ((${own.id})) and again ((${own.id})).`);
    await h.board.createBlock(null, "backlinks by kind: backlinks.view step=kind [yo-memory::answer] [yo-action::backlinks.view] [yo-asked::backlinks by kind] [yo-line::backlinks.view step=kind]");
    const stage = () => h.S().stages.get(h.S().sel).top;
    const rows = () => stage().layoutGet().tiles as { name: string; kind: string }[];
    for (const t of rows().filter(t => t.kind === "backlinks")) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await h.app.dispatch.act({ action: "tile.open", args: { kind: "backlinks", name: "replies", source: "tile:ask", where: "down" } }, USER);
    await h.app.dispatch.act({ action: "backlinks.groups", tile: "replies", args: { show: "children" } }, USER);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const read = async () => (await h.board.get(own.id))!;
    const m = await read();
    await h.board.update(m.id, `${m.text.trimEnd()}\n\n@yo backlinks by kind\n`, m.revision!, USER);
    await untilAsync(async () => (await read()).text.includes("@yo answered"), "yo's answer", 30_000);
    const surface = () => stage().pane("ask").surface;
    await until(() => surface().describeElements().some((e: { label: string }) => e.label.includes("▸ by kind")), "the button drawn", 8000).catch(async e => { throw new Error(`${e.message}: ${(await read()).text.slice(-600)}`); });
    const ended: string[] = [], app = h.app as unknown as { showMessage(m: string, ...rest: unknown[]): unknown }, shown = app.showMessage.bind(app);
    app.showMessage = (m: string, ...rest: unknown[]) => { ended.push(m); return shown(m, ...rest); };
    await h.app.dispatch.act({ action: "button.press", tile: "ask", args: { label: "▸ by kind" } }, USER);
    const line = (await read()).text.split("\n").findIndex(l => l.includes('label="▸ by kind"'));
    await until(() => ["done", "failed"].includes(pressState(own.id, line, "▸ by kind").state ?? ""), "the press settled", 15_000);
    expect(pressState(own.id, line, "▸ by kind")).toEqual({ state: "done" });
    // The run says the button's words, never the note's title.
    await until(() => ended.some(m => m.endsWith("done") || m.includes("done ·")), "the run's end said", 8000).finally(() => { app.showMessage = shown; });
    expect(ended.find(m => /done/.test(m))).toStartWith("▸ by kind done");
    const replies = stage().pane("replies") as unknown as { options: { kind: string | null }; groups: string[] };
    expect(replies.options.kind).toBeNull();
    const links = rows().find(t => t.kind === "backlinks" && t.name !== "replies")!;
    expect((stage().pane(links.name) as unknown as { options: { kind: string | null } }).options.kind).not.toBeNull();
    for (const t of rows().filter(t => t.kind === "backlinks")) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER);
  }, 90_000);

  // PIE-1722 (the verifier's gap): a note action yo offers (note.rename's ▸ rename), pressed in the answer tile, renames the
  // note the reader shows: the answer tile shows no note.
  test("typed in the editor: a note.rename button pressed in the answer tile renames the reader's note", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Ask yo, naming a note\n\nWhere a note action is pressed beside the line.\n");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    await h.board.createBlock(null, "retitle seed note: note.rename text=Seed-swap [yo-memory::answer] [yo-action::note.rename] [yo-asked::retitle seed note] [yo-line::note.rename text=Seed-swap]");
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo retitle the seed note") h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const answer = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).find(t => t.kind === "answer")?.name;
    const pane = stage().pane("ask"), draft = () => pane.surface.draft as { text: string } | null;
    await until(() => !!answer() && /::button\{label="[^"]+" act=\["note\.rename text=/.test(draft()?.text ?? ""), "yo's answer with a note.rename button", 30_000);
    const tile = () => stage().pane(answer()!) as { links: { press?: unknown }[] };
    await until(() => tile().links.some(l => l.press), "the button drawn in the answer tile", 8000);
    const n = tile().links.findIndex(l => l.press) + 1;
    const r = await h.app.dispatch.act({ action: "answer.follow", tile: answer()!, args: { n } }, USER).then(() => "", (e: Error) => e.message);
    expect(r).not.toContain("answer shows no note");
    // The reader's note takes the title, in the person's edit (saved with it), never the answer tile.
    await untilAsync(async () => /^Seed-swap\n/.test(draft()?.text ?? ""), `the note renamed (${r})`, 15_000).catch(e => { const line = (draft()?.text ?? "").split("\n").findIndex(l => l.includes("▸ rename")); throw new Error(`${e.message}\n${JSON.stringify(pressState(own.id, line, "▸ rename"))}`); });
    expect(draft()!.text).toContain("@yo retitle the seed note");
    await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
    await until(() => !draft(), "the edit saved and closed", 8000);
    await untilAsync(async () => (await h.board.get(own.id))!.text.startsWith("Seed-swap\n"), "the saved title");
  }, 90_000);

  // PIE-1722, the verifier's walk: a rename button in the answer tile, clicked while typing: with a title it retitles the edit,
  // the keys staying in it; with none it asks for the title, holding the edit's, and that retitles the edit.
  for (const named of [true, false]) test(`typed in the editor: a click on ${named ? "▸ rename text Seeds" : "▸ rename"} in the answer tile renames the edit's note, keys kept`, async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, `Seed note ${named ? "named" : "bare"}\n\nWhere a rename is clicked beside the line.\n`);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const line = named ? "note.rename text=Seeds" : "note.rename";
    const asked = named ? "call it seeds clicked" : "retitle bare clicked";
    await h.board.createBlock(null, `${asked}: ${line} [yo-memory::answer] [yo-action::note.rename] [yo-asked::${asked}] [yo-line::${line}]`);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of `@yo ${asked}`) h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const answer = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).find(t => t.kind === "answer")?.name;
    const draft = () => stage().pane("ask").surface.draft as { text: string } | null;
    const label = named ? "▸ rename text Seeds" : "▸ rename";
    await until(() => !!answer() && h.screen().includes(label), `yo's answer with ${label}`, 30_000);
    const lines = h.screen().split("\n"), y = lines.findLastIndex(l => l.includes(label)), x = lines[y]!.lastIndexOf(label) + 1;
    h.press({ kind: "mouse", action: "down", button: 0, x, y } as never); h.press({ kind: "mouse", action: "up", button: 0, x, y } as never);
    // The keys stay in the edit: the click pressed the button and nothing else.
    expect(h.app.keysScreen()?.dispatch?.tile("focused")?.name).toBe("ask");
    if (!named) {
      await until(() => h.screen().includes("Rename this note"), "the title prompt", 8000);
      for (let i = 0; i < 20; i++) h.press({ kind: "backspace" });
      for (const c of "Seeds") h.ch(c);
      h.press({ kind: "enter" });
    }
    await until(() => /^Seeds\n/.test(draft()?.text ?? ""), "the edit's title is Seeds", 15_000);
    expect(draft()!.text).toContain(`@yo ${asked}`);
    for (const c of " and on") h.ch(c);
    await until(() => draft()!.text.includes(" and on"), "typing goes on in the edit", 4000);
    await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
    await until(() => !draft(), "saved", 8000);
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

  // PIE-1711, the verifier's re-walk: saved, the answer tile beside the note still shows the answer that is in the note.
  test("after ^S the answer tile shows the answer in the note, not waiting for it", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Saved with its answer\n\nWhere an ask is saved.\n");
    await h.board.createBlock(null, "zoom saved tile: tile.zoom [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::zoom saved tile] [yo-line::tile.zoom]");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => h.screen().includes("editing ·"), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo zoom the saved tile") h.ch(c);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const answer = () => (stage().layoutGet().tiles as { name: string; kind: string }[]).find(t => t.kind === "answer")?.name;
    await until(() => !!answer() && h.screen().includes("tile.zoom"), "the answer beside the line", 30_000);
    h.press({ kind: "char", ch: "s", ctrl: true });
    await untilAsync(async () => (await h.board.get(own.id))!.text.includes("@yo answered"), "saved with its answer", 8000);
    await Bun.sleep(300);
    if (answer()) {
      expect(h.screen()).not.toContain("Waiting for the answer");
      expect(h.screen()).toContain("tile.zoom");
      await h.app.dispatch.act({ action: "tile.close", tile: answer()! }, USER);
    }
    // Left as the next test finds the stage: no edit open, the keys on the reader.
    const draft = () => stage().pane("ask").surface.draft as { text: string } | null;
    if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER).catch(() => {});
    await until(() => !draft(), "the edit closed", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
  }, 90_000);

  // PIE-1731, the verifier's walk: an ask line deleted in the door's edit and saved with ^S takes its answer with it, the
  // answer written into the edit as it was typed (the draft path) and into the saved note alike.
  for (const path of ["draft", "saved"] as const) test(`a deleted ask takes its answer on the door's ^S (${path} path)`, async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const asked = `zoom gone ${path}`;
    await h.board.createBlock(null, `${asked}: tile.zoom [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::${asked}] [yo-line::tile.zoom]`);
    const own = await h.board.createBlock(null, path === "saved" ? `Gone ${path}\n\nkept line\n@yo how do I ${asked}\nlast line\n` : `Gone ${path}\n\nkept line\n`);
    const read = async () => (await h.board.get(own.id))!;
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const draft = () => stage().pane("ask").surface.draft as { text: string; replace(t: string, by?: unknown): void } | null;
    const edit = async () => {
      h.ch("e");
      await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
      h.press({ kind: "enter" });
      await until(() => !!draft(), "the edit", 8000);
    };
    if (path === "draft") {
      await edit();
      h.press({ kind: "end", ctrl: true });
      for (const c of `@yo how do I ${asked}`) h.ch(c);
      await until(() => draft()!.text.includes("@yo answered"), "the answer in the edit", 30_000);
      h.press({ kind: "char", ch: "s", ctrl: true });
      await until(() => !draft(), "saved", 8000);
    }
    await untilAsync(async () => (await read()).text.includes("@yo answered"), "the answer saved", 30_000);
    // The ask line taken out in the door's edit, as backspacing it whole would, and saved with ^S.
    await edit();
    draft()!.replace(draft()!.text.replace(`@yo how do I ${asked}\n`, ""));
    h.press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !draft(), "saved again", 8000);
    await untilAsync(async () => !(await read()).text.includes("@yo answered"), "the answer gone with its ask", 10_000)
      .catch(async e => { throw new Error(`${e.message}: ${JSON.stringify((await read()).text)}`); });
    expect((await read()).text).toContain("kept line");
    // Its answer tile, its ask gone and saved, doesn't wait for an answer that won't come: it says so (the verifier's walk).
    const tile = (stage().layoutGet().tiles as { kind: string; name: string }[]).find(t => t.kind === "answer");
    if (tile) {
      const drawn = (stage().pane(tile.name) as unknown as { render(w: number, h: number, f: boolean, d: unknown): { lines: string[] } }).render(60, 10, false, stage()).lines.join("\n");
      expect(drawn).not.toContain("Waiting for the answer");
      expect(drawn).toContain("Its ask is gone");
    }
  }, 90_000);

  // PIE-1733, the verifier's walk: an ask deleted by mistake and saved, yo takes its answer out (the agent's write after
  // the save); one ctrl+z past the save in the reopened edit brings both back, said as such. The answer tile says its ask
  // is gone whole at a narrow width and isn't kept in the saved layout; a reopened edit folds a saved answer.
  for (const path of ["draft", "saved"] as const) test(`one undo takes back a deleted ask and yo's removal of its answer (${path} path)`, async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const asked = `zoom back ${path}`, ask = `@yo how do I ${asked}`;
    await h.board.createBlock(null, `${asked}: tile.zoom [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::${asked}] [yo-line::tile.zoom]`);
    const own = await h.board.createBlock(null, path === "saved" ? `Undo ${path}\n\nkept line\n${ask}\nlast line\n` : `Undo ${path}\n\nkept line\n`);
    const read = async () => (await h.board.get(own.id))!;
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const stage = () => h.S().stages.get(h.S().sel).top;
    type D = { text: string; replace(t: string, by?: unknown): void; hiddenAnswerLines(): Set<number>; row: number; col: number; status: { line(): string | null } };
    const draft = () => stage().pane("ask").surface.draft as D | null;
    const answerTile = () => (stage().layoutGet().tiles as { kind: string; name: string }[]).find(t => t.kind === "answer");
    const edit = async () => {
      h.ch("e");
      await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
      h.press({ kind: "enter" });
      await until(() => !!draft(), "the edit", 8000);
    };
    const save = async () => { h.press({ kind: "char", ch: "s", ctrl: true }); await until(() => !draft(), "saved", 8000); };
    try {
      if (path === "draft") {
        await edit();
        h.press({ kind: "end", ctrl: true });
        for (const c of ask) h.ch(c);
        await until(() => draft()!.text.includes("@yo answered"), "the answer in the edit", 30_000);
        await save();
      }
      await untilAsync(async () => (await read()).text.includes("@yo answered"), "the answer saved", 30_000);
      // Opened again with the answer saved: folded as the live edit draws it, never its callout's raw lines.
      await edit();
      expect(draft()!.text).toContain("@yo answered");
      expect(draft()!.hiddenAnswerLines().size).toBeGreaterThan(0);
      expect(h.screen()).not.toContain("::button{");
      // The ask taken out by mistake and saved: yo takes its answer out after the save, as its own write.
      let kept = 0;
      const st = stage(), keep = st.keepLayout.bind(st);
      st.keepLayout = () => { kept++; keep(); };
      draft()!.replace(draft()!.text.replace(`${ask}\n`, ""));
      await save();
      await untilAsync(async () => !(await read()).text.includes("@yo answered"), "the answer gone with its ask", 10_000);
      const gone = await read();
      expect(gone.text).not.toContain(ask);
      expect(gone.text).toContain("kept line");
      // Its answer tile says so whole at a narrow width, and the saved layout doesn't keep it.
      const tile = answerTile();
      if (path === "draft") expect(tile).toBeDefined();
      if (tile) {
        const drawn = (stage().pane(tile.name) as unknown as { render(w: number, h: number, f: boolean, d: unknown): { lines: string[] } }).render(38, 10, false, stage()).lines;
        expect(drawn.every(l => Bun.stringWidth(l) <= 38)).toBe(true);
        expect(drawn.join(" ").replace(/\s+/g, " ")).toContain("x closes this tile");
        expect(JSON.stringify(stage().savedState())).not.toContain('"kind":"answer"');
        // Saved as it went, so a door opened next doesn't bring the dead tile back.
        await until(() => kept > 0, "the layout saved when the ask went", 8000);
        st.keepLayout = keep;
        // Gathered with its reader into a group (CodeRabbit on #1435): the layout's own history still holds it, nested,
        // so an undo of a move brings it back; the save leaves it out.
        if (path === "draft") {
          const g = await h.app.dispatch.act({ action: "tile.group", tile: "ask", args: { with: tile.name } }, USER) as { name?: string; tile?: string };
          const answers = (o: unknown) => JSON.stringify(o).includes('\\"kind\\":\\"answer\\"') || JSON.stringify(o).includes('"kind":"answer"');
          const nested = [answers(stage().layoutSpec()), answers(stage().savedState())];
          await h.app.dispatch.act({ action: "tile.group", tile: g.tile ?? g.name!, args: { on: false } }, USER);
          await until(() => !!stage().pane("ask"), "the reader back on the stage", 8000);
          await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
          expect(nested).toEqual([true, false]);   // [layout history, the save]
        }
      }
      // One ctrl+z past the save in the reopened edit: the ask and its answer back, said as both.
      await edit();
      // PIE-1738: the first ctrl+z asks, saying how long the second has, in two rows of a 44-column reader.
      const asks = await h.app.dispatch.act({ action: "draft.undo", tile: "ask" }, USER) as { asks?: string };
      expect(asks.asks).toContain("your save and yo's removal of its answer");
      const reader = (w: number) => (stage().pane("ask") as unknown as { render(w: number, h: number, f: boolean, d: unknown): { lines: string[] } }).render(w, 30, true, stage()).lines.map(l => Bun.stripANSI(l));
      const narrow = reader(44), first = narrow.findIndex(l => l.includes("ctrl+z again in 5s"));
      expect(first).toBeGreaterThan(-1);
      const askRows = narrow.slice(first, first + 3).map(l => l.replace(/[║│]/g, "").trim());
      expect(askRows.slice(0, 2).join(" ")).toContain("removal of its answer");
      expect(askRows[2]).not.toMatch(/answer|revision/);
      const undone = await h.app.dispatch.act({ action: "draft.undo", tile: "ask", args: { past: true } }, USER) as { undone?: string };
      expect(undone.undone).toContain("undid your save and yo's removal of its answer");
      expect(draft()!.text).toContain(`${ask}\n> [!note]`);
      expect(draft()!.text.split("\n").filter(l => /@yo answered$/.test(l)).length).toBe(1);
      // The undo lands at the end of the ask it brought back, its answer folded under it: no raw callout lines.
      expect([draft()!.row, draft()!.col]).toEqual([draft()!.text.split("\n").indexOf(ask), ask.length]);
      expect(draft()!.hiddenAnswerLines().size).toBeGreaterThan(0);
      for (const w of [44, 177]) expect(reader(w).join("\n")).not.toContain("::button{");
      // Saved again: one answer under the ask, not a second one asked for again.
      await save();
      await untilAsync(async () => (await read()).text.includes(ask), "the ask saved back", 8000);
      await Bun.sleep(1500);
      const back = (await read()).text;
      expect(back.split("\n").filter(l => /@yo answered$/.test(l)).length).toBe(1);
      expect(back).toContain(`${ask}\n> [!note]`);
      // The answer put back is still yo's: the ask taken out again takes it again.
      await edit();
      draft()!.replace(draft()!.text.replace(`${ask}\n`, ""));
      await save();
      await untilAsync(async () => !(await read()).text.includes("@yo answered"), "the answer gone with its ask again", 10_000);
    } finally {
      if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER).catch(() => {});
      await until(() => !draft(), "the edit closed", 8000);
      const t = answerTile();
      if (t) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER).catch(() => {});
      await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    }
  }, 120_000);

  // PIE-1738, the verifier's friction: a reopened edit on a saved answer, the cursor brought to the end of its ask by the
  // arrows, End, or a click's draft.place, draws the answer's one fold row (as the live edit does), never its callout's
  // raw lines; at 44 and at 177 columns. Entering the callout opens it; the answer tile's fold closes and opens it again.
  test("a saved answer stays folded with the cursor at its ask: one fold row at 44 and 177; entering it opens it", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const asked = "zoom the folded shed", ask = `@yo how do I ${asked}`;
    await h.board.createBlock(null, `${asked}: tile.zoom [yo-memory::answer] [yo-action::tile.zoom] [yo-asked::${asked}] [yo-line::tile.zoom]`);
    const own = await h.board.createBlock(null, `Folded shed\n\nkept line\n${ask}\nlast line\n`);
    await untilAsync(async () => (await h.board.get(own.id))!.text.includes("@yo answered"), "yo's answer saved", 30_000);
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    const stage = () => h.S().stages.get(h.S().sel).top;
    type D = { text: string; lines: string[]; row: number; col: number; hiddenAnswerLines(): Set<number> };
    const draft = () => stage().pane("ask").surface.draft as D | null;
    const reader = (w: number) => (stage().pane("ask") as unknown as { render(w: number, h: number, f: boolean, d: unknown): { lines: string[] } }).render(w, 30, true, stage()).lines.map(l => Bun.stripANSI(l));
    const folded = (how: string) => {
      const d = draft()!, at = d.lines.indexOf(ask);
      expect([how, d.row, d.col]).toEqual([how, at, ask.length]);
      expect([how, d.hiddenAnswerLines().size > 0]).toEqual([how, true]);
      for (const w of [44, 177]) {
        const drawn = reader(w).join("\n");
        expect([how, w, drawn.includes("::button{") || drawn.includes("[!note]")]).toEqual([how, w, false]);
        // The fold row, under or beside the ask, as the live edit draws its answer's.
        expect([how, w, /· answered\b/.test(drawn)]).toEqual([how, w, true]);
      }
    };
    try {
      h.ch("e");
      await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
      h.press({ kind: "enter" });
      await until(() => !!draft(), "the edit", 8000);
      const at = draft()!.lines.indexOf(ask);
      await h.app.dispatch.act({ action: "draft.place", tile: "ask", args: { line: at + 1, col: ask.length + 1 } }, USER);
      folded("draft.place at the ask's end");
      h.press({ kind: "up" });
      h.press({ kind: "down" });
      h.press({ kind: "end" });
      folded("up, down and End onto the ask");
      // → at the ask's end goes into the callout: entering it opens it.
      h.press({ kind: "right" });
      await until(() => draft()!.hiddenAnswerLines().size === 0, "the answer open once the cursor is in it", 8000);
      expect(reader(177).join("\n")).toContain("[!note]");
      // The answer tile's fold (its f, or its menu row) closes it, the cursor back on the ask, and opens it again.
      const tile = (stage().layoutGet().tiles as { kind: string; name: string }[]).find(t => t.kind === "answer");
      expect(tile).toBeDefined();
      await h.app.dispatch.act({ action: "answer.fold", tile: tile!.name }, USER);
      expect(draft()!.hiddenAnswerLines().size).toBeGreaterThan(0);
      expect(draft()!.row).toBe(at);
      await h.app.dispatch.act({ action: "answer.fold", tile: tile!.name }, USER);
      expect(draft()!.hiddenAnswerLines().size).toBe(0);
    } finally {
      if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER).catch(() => {});
      await until(() => !draft(), "the edit closed", 8000);
      const t = (stage().layoutGet().tiles as { kind: string; name: string }[]).find(t => t.kind === "answer");
      if (t) await h.app.dispatch.act({ action: "tile.close", tile: t.name }, USER).catch(() => {});
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

  // PIE-1716: the answer tile left behind closes itself when its reader is gathered; one undo puts the gather back whole,
  // the reader and its answer tile beside it again on the stage, and the tile doesn't close itself again.
  test("an edit open while its reader is gathered alone: one undo brings back the reader and its answer tile", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    const own = await h.board.createBlock(null, "Ask yo, then undo the gather\n\nWhere the gather is taken back.\n");
    await h.app.dispatch.act({ action: "open", tile: "ask", args: { id: own.id } }, USER);
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    await h.app.dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    await h.board.createBlock(null, "slide shed: tile.slide [yo-memory::answer] [yo-action::tile.slide] [yo-asked::slide shed] [yo-line::tile.slide]");
    const stage = () => h.S().stages.get(h.S().sel).top;
    const pane = stage().pane("ask"), draft = () => pane.surface.draft as { text: string } | null;
    const { AnswerTile } = await import("../../src/desk/answer-tile");
    const onStage = () => [...stage().panes.values()].filter((p: any) => p instanceof AnswerTile).length;
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => !!draft(), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    for (const c of "@yo slide the shed") h.ch(c);
    await until(() => onStage() === 1, "yo's answer tile beside the reader", 30_000);
    const g = await h.app.dispatch.act({ action: "tile.group", tile: "ask" }, USER) as { name?: string; tile?: string };
    try {
      await until(() => { h.screen(); return !stage().pane("ask") && onStage() === 0; }, "the reader gathered, its answer tile closed", 8000);
      await h.app.dispatch.act({ action: "layout.undo", args: { anywhere: true } }, USER);
      await until(() => { h.screen(); return stage().pane("ask") === pane && onStage() === 1; }, `one undo: the reader and its answer tile back (${onStage()} answer tiles)`, 8000)
        .catch(e => { throw new Error(`${e.message}: ${onStage()} answer tiles, the reader ${stage().pane("ask") === pane ? "back" : "not back"}`); });
      await Bun.sleep(300); h.screen();
      expect(onStage()).toBe(1);
      expect(stage().paneNamed([...stage().panes.values()].find((p: any) => p instanceof AnswerTile)!.source)).toBe(pane);
    } finally {
      if (!stage().pane("ask")) await h.app.dispatch.act({ action: "tile.group", tile: g.tile ?? g.name!, args: { on: false } }, USER);
      if (draft()) await h.app.dispatch.act({ action: "edit.save", tile: "ask" }, USER);
      await until(() => !draft(), "the edit saved and closed", 8000);
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
  // PIE-1726: the section's reader closed once and rebuilt (^W x, ^W B) while the drawer holds a tile named ask, so it
  // comes back as ask2 in the place ask fills. An edit open on it, an ask, ^W G ⏎: the same reader is in the group, its
  // edit open with every typed word (it was a fresh reader of the note, the edit lost); ^W B brings it back, still editing.
  test("a rebuilt reader gathered with an open edit keeps the edit and its words; one undo brings both back", async () => {
    await h.app.act({ action: "section", args: { name: "ask-yo" }, as: "test-agent" }).catch((e: Error) => { if (!/is in section \d+ \(ask-yo\)/.test(e.message)) throw e; });
    if (h.screen().includes("⏎ → l tab try it")) h.press({ kind: "enter" });
    await until(() => !h.screen().includes("⏎ → l tab try it"), "the keys in the stage", 8000);
    const stage = () => h.S().stages.get(h.S().sel).top;
    const chord = (c: string) => { h.press({ kind: "char", ch: "w", ctrl: true }); h.screen(); h.ch(c); h.screen(); };
    const own = await h.board.createBlock(null, "Ask yo, rebuilt\n\nWhere the reader comes back and is gathered.\n");
    await h.board.createBlock(null, "tuck shed: tile.slide [yo-memory::answer] [yo-action::tile.slide] [yo-asked::tuck shed] [yo-line::tile.slide]");
    // Closed once (a second tile keeps the stage), a reader named ask in the drawer, then the close undone.
    await stage().dispatch.act({ action: "tile.open", tile: "ask", args: { kind: "reader", name: "spare", where: "right" } }, USER);
    await stage().dispatch.act({ action: "tile.focus", tile: "ask" }, USER);
    chord("x");
    await until(() => !stage().pane("ask"), "the section's reader closed", 8000);
    await h.app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
    const dd: any = (h.app as any).drawer.made;
    await dd.dispatch.act({ action: "tile.open", args: { kind: "reader", name: "ask", where: "right" } }, USER);
    await h.app.dispatch.act({ action: "host.toggle", args: { open: false } }, USER);
    await stage().dispatch.act({ action: "tile.focus", tile: "spare" }, USER);
    (h.app as any).lastInput = 0;
    await stage().dispatch.act({ action: "layout.undo", args: {} }, USER);
    const rebuilt = stage().nameOf(stage().specTiles.get("ask")) as string;   // the place ask fills, under its new name
    expect(rebuilt).toBe("ask2");
    const pane = stage().pane(rebuilt);
    await h.app.dispatch.act({ action: "open", tile: rebuilt, args: { id: own.id } }, USER);
    await h.app.dispatch.act({ action: "tile.close", tile: "spare" }, USER);
    await h.app.dispatch.act({ action: "tile.focus", tile: rebuilt }, USER);
    await until(() => pane.msg?.id === own.id, "the note in the rebuilt reader", 8000);
    const draft = () => pane.surface.draft as { text: string } | null;
    const { AnswerTile } = await import("../../src/desk/answer-tile");
    const answers = () => [...stage().panes.values()].filter((p: any) => p instanceof AnswerTile).length;
    const desks = () => (h.app as any).hostLayer.everyDesk().flatMap((d: any) => [d, ...d.descend()]);
    const holder = () => desks().find((d: any) => [...d.panes.values()].includes(pane));
    // As the person: e ⏎, an ask at the end, ^W G ⏎.
    h.ch("e");
    await until(() => h.screen().includes("opens it"), "the armed edit", 8000);
    h.press({ kind: "enter" });
    await until(() => !!draft(), "the edit", 8000);
    h.press({ kind: "end", ctrl: true });
    h.press({ kind: "enter" });
    for (const c of "@yo tuck the shed") h.ch(c);
    await until(() => answers() === 1, "yo's answer tile beside the reader", 30_000);
    chord("G");
    await until(() => h.screen().includes("this tile · ask2"), "this tile or the whole split?", 8000);
    h.press({ kind: "enter" });
    try {
      await until(() => { h.screen(); return !!holder() && holder() !== stage(); }, "the rebuilt reader itself in the group", 8000);
      expect(draft()?.text).toContain("@yo tuck the shed");
      expect([...holder().panes.values()].filter((p: any) => p instanceof ReaderPane && p.msg?.id === own.id)).toEqual([pane]);
      expect(pane.editing).toBe(true);
      // The next words typed go on in that same edit, in the group.
      for (const c of " gently") h.ch(c);
      await until(() => !!draft()?.text.includes("@yo tuck the shed gently"), "a word typed after the gather, in the edit", 8000);
      // One undo: the reader back on the stage, still editing, every word there, its answer tile beside it answered.
      chord("B");
      await until(() => { h.screen(); return holder() === stage(); }, "the reader back on the stage", 8000);
      expect(draft()?.text).toContain("@yo tuck the shed gently");
      await until(() => answers() === 1, "the answer tile back beside it", 8000);
      await until(() => !h.screen().includes("Waiting for the answer"), "the answer tile answered, not waiting", 30_000);
      // The drawer's ask back beside it, the two gathered together: two readers in the group, the edit still this one's.
      const back = dd.layoutGet().tiles.find((t: any) => t.name === "ask").tile;
      await dd.dispatch.act({ action: "tile.drawer", tile: back, args: { on: false } }, USER);
      const named = stage().layoutGet().tiles.find((t: any) => t.tile === back).name;
      await h.app.dispatch.act({ action: "tile.group", tile: rebuilt, args: { with: named } }, USER);
      await until(() => { h.screen(); return !!holder() && holder() !== stage(); }, "both gathered", 8000);
      const readers = [...holder().panes.values()].filter((p: any) => p instanceof ReaderPane);
      expect(readers.length).toBe(2);
      expect(readers).toContain(pane);
      expect(draft()?.text).toContain("@yo tuck the shed gently");
    } finally {
      if (holder() && holder() !== stage()) await h.app.dispatch.act({ action: "tile.group", tile: stage().layoutGet().tiles.find((t: any) => t.kind === "screen")?.name, args: { on: false } }, USER).catch(() => {});
      if (draft() && holder()) await h.app.dispatch.act({ action: "edit.save", tile: holder().tileIdOfPane(pane) }, USER);
      for (const [, p] of [...stage().panes]) if (p instanceof AnswerTile) await h.app.dispatch.act({ action: "tile.close", tile: stage().tileIdOfPane(p) }, USER);
      await dd.dispatch.act({ action: "tile.close", tile: "ask" }, USER).catch(() => {});
    }
  }, 90_000);

});

// PIE-439: the showcase screen, macros, asks and scripts. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import { editorClick } from "../../src/surface/editor";
import { type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { DRAFT_LEASE_MS, SocketBoard, USER } from "../../src/socket";
import { extensionList } from "../../src/extensions";
import type { ReaderPane } from "../../src/desk/panes";
import { type Key } from "../../src/term";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: macros, asks and scripts", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("a recorded macro saves editable action lines and replays slots through the script runtime", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    await app.dispatch.act({ action: "macro.record", args: { name: "planting-layout" } }, USER);
    await expect(app.act({ action: "macro.stop", as: "test-agent" })).rejects.toThrow("Only the person");
    await expect(app.dispatch.act({ action: "tile.open", args: { kind: "no-such-kind" } }, USER)).rejects.toThrow();
    await app.dispatch.press("bar.open", { query: 'tile.open kind=query query="#beans" name=recorded-query' });
    await until(() => !!(app as any).bar?.describe().rows.length, "the action line is offered");
    await app.dispatch.press("bar.pick");
    await app.dispatch.press("bar.close");
    await app.act({ action: "tile.open", args: { kind: "query", query: "#agent-only", name: "agent-query" }, as: "test-agent" });
    await app.dispatch.act({ action: "block.mark", tile: "notes", args: { reason: "check planting" } }, USER);
    await app.dispatch.act({ action: "tile.link", tile: "notes", args: { to: "source", role: "target" } }, USER);
    const sourceTile = S().stage(SECTIONS.findIndex(s => s.key === "scripts")).top.dispatch.tile("source").id;
    const stopping = app.dispatch.act({ action: "macro.stop" }, USER);
    await expect(app.dispatch.act({ action: "macro.record" }, USER)).rejects.toThrow("saving");
    const saved = await stopping as { block: string };
    const note = (await board.get(saved.block))!;
    expect(note.text).toContain("[script::planting-layout]");
    expect(note.text).toContain("```actions");
    expect(note.text).toContain("tile.open");
    expect(note.text).not.toContain("agent-only");
    expect(note.text).not.toContain("macro.stop");
    expect(note.text).not.toContain("no-such-kind");
    expect(note.text).not.toContain("screen.list");
    expect(note.text).toContain("block.mark");
    expect(note.text).toContain(`to="${sourceTile}"`);
    await board.update(note.id, note.text.replace("\n", " [results::keep]\n").replace("#beans", "#{{props.tag}}").replace("recorded-query", "replayed-query"), note.revision!, USER);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "planting-layout" && e.actions.some(a => a.args?.some(x => x.name === "tag"))), "the edited macro loaded its slot");
    const extension = extensionList()!.extensions.find(e => e.name === "planting-layout")!;
    const run = await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { tag: 'peas "quoted"' } }, USER) as { written: string[] };
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "macro replay finished");
    expect((await board.get(run.written[0]!))!.text).toContain("· done");
    const layout = JSON.stringify(await app.act({ action: "layout.get", as: "test-agent" }));
    expect(layout).toContain("replayed-query");
    expect(layout).toContain('peas');
    const now = (await board.get(note.id))!;
    await board.update(note.id, now.text.replace(/```actions[\s\S]*?```/, '```actions\nno.such.action\ntile.open kind=query name=must-not-open query="#peas"\n```'), now.revision!, USER);
    await until(() => extensionList()!.extensions.find(e => e.id === extension.id)?.actions[0]?.args?.length === 0, "the failed script revision loaded");
    const failed = await app.dispatch.act({ action: `ext.${extension.id}.run` }, USER) as { written: string[] };
    await untilAsync(async () => !(await board.get(failed.written[0]!))!.text.includes("· working"), "the refusal was reported");
    expect((await board.get(failed.written[0]!))!.text).toContain("Line 1 (no.such.action)");
    expect(JSON.stringify(await app.act({ action: "layout.get", as: "test-agent" }))).not.toContain("must-not-open");
    for (const tile of ["recorded-query", "agent-query", "replayed-query"]) {
      await app.dispatch.act({ action: "tile.close", tile }, USER);
    }
    await app.dispatch.act({ action: "tile.link", tile: "notes" }, USER);
    await app.dispatch.act({ action: "block.unmark", tile: "notes" }, USER);
    await app.dispatch.act({ action: "tile.focus", tile: "notes" }, USER);
    for (let i = 0; i < 5 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("an ask's plain answer streams into the showcase's existing answer tile", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "asks" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "asks")).top;
    await until(() => !!extensionList()?.extensions.some(e => e.id === "showcase-planter"), "the planter loaded");
    const reader = stage.paneNamed("notes") as ReaderPane;
    await stage.startSession(reader, "edit");
    const d = reader.surface.draft!;
    await stage.dispatch.press("draft.place", { line: d.lines.length, col: 1 }, "notes");
    await stage.dispatch.press("draft.paste", { text: "@planter describe the beds\nStill writing" }, "notes");
    await until(() => d.text.includes("Sow peas along the fence."), "the first paragraph", 15000).catch(async error => { throw new Error(`${error.message}\n${d.text}\n${JSON.stringify(await board.request("resources.projection.read", { blockId: seeded.notes.asks.id }))}`); });
    expect(d.text).not.toContain("Water the beds in the evening.");
    await stage.dispatch.press("draft.paste", { text: " as it answers" }, "notes");
    await until(() => screen().includes("Water the beds"), "the next paragraph beside the note");
    expect(reader.surface.draft).toBe(d);
    expect(d.text).toContain("Still writing as it answers");
    await stage.dispatch.press("edit.close", { discard: true }, "notes");
  }, 30000);


  test("an ask keeps the draft open while its script view runs beside it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "asks" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "asks")).top;
    await until(() => !!extensionList()?.extensions.some(e => e.id === "showcase-planter"), "the showcase's planter loaded");
    const reader = stage.paneNamed("notes") as ReaderPane;
    await stage.startSession(reader, "edit");
    const d = reader.surface.draft!;
    await stage.dispatch.press("draft.place", { line: d.lines.length, col: 1 }, "notes");
    await stage.dispatch.press("draft.paste", { text: "@planter show the seed counts\nStill writing" }, "notes");
    await until(() => d.text.includes("Edit or keep the script"), "the script linked in the live draft", 15_000);
    expect(reader.surface.draft).toBe(d);
    expect(d.text).toContain("Still writing");
    await until(() => screen().includes("Peas") && screen().includes("Beans"), "the script's table beside the note", 15_000);
    expect(JSON.stringify(await stage.dispatch.act({ action: "layout.get" }, USER))).toContain("answer");
    press({ kind: "enter" });
    const caret = { row: d.row, col: d.col };
    await expect(stage.dispatch.act({ action: "answer.fold", tile: "answer" }, { kind: "agent", id: "test-agent" })).rejects.toThrow();
    expect({ row: d.row, col: d.col }).toEqual(caret);
    await stage.dispatch.press("answer.follow", { n: 1 }, "answer");
    await until(() => screen().includes("Seed counts"), "the answer's script source opened");
    expect(reader.surface.draft).toBe(d);
    await stage.dispatch.press("edit.save", {}, "notes");
    expect((await board.get(seeded.notes.asks.id))!.text).toContain("Still writing");
    await stage.dispatch.act({ action: "answer.fold", tile: "answer" }, USER);
    await stage.startSession(reader, "edit");
    const reopened = reader.surface.draft!;
    await stage.dispatch.press("draft.place", { line: reopened.lines.length, col: reopened.lines.at(-1)!.length + 1 }, "notes");
    await stage.dispatch.press("draft.paste", { text: "\n@planter show the seed counts\n> [!note]- @planter answered\n> Second answer\n\nAfter" }, "notes");
    await stage.dispatch.press("edit.save", {}, "notes");
    await stage.startSession(reader, "edit");
    screen();
    const again = reader.surface.draft!;
    const duplicate = again.lines.lastIndexOf("@planter show the seed counts");
    expect(reader.surface.render(100, 60, reader.host(stage)).lines.map(plain).join("\n")).not.toContain("Second answer");
    await stage.dispatch.press("fold.toggle", { line: duplicate + 2 }, "notes");
    expect(reader.surface.render(100, 60, reader.host(stage)).lines.map(plain).join("\n")).toContain("Second answer");
    await stage.dispatch.press("draft.place", { line: duplicate + 1, col: 1 }, "notes");
    await until(() => {
      const answer = stage.paneNamed("answer")!;
      return answer.render(80, 30, false, stage).lines.map(plain).join("\n").includes("Second answer");
    }, "selecting the duplicate ask shows its own saved answer");
    await stage.dispatch.press("answer.fold", {}, "answer");
    expect(reader.surface.render(100, 60, reader.host(stage)).lines.map(plain).join("\n")).not.toContain("Second answer");
    await stage.dispatch.press("edit.save", {}, "notes");
    await stage.dispatch.press("ask.beside", { ask: "@planter show the seed counts" }, "notes");
    screen();
    await expect(stage.dispatch.press("answer.follow", { n: 1 }, "answer")).resolves.toBeDefined();
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 40_000);


  test("asks in a new unsaved note show unknown agents, live titles and fitting badges (PIE-914)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "asks" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "asks")).top;
    await (app as any).dispatch.press("note.new", { opens: "float" });
    const writing = () => [...stage.panes.values()].find(p => p.surface?.draft) as ReaderPane;
    await until(() => !!writing(), "the new draft");
    const r = writing(), d = r.surface.draft!;
    const tile = stage.nameOf([...stage.panes].find(([, p]) => p === r)![0]);
    await stage.dispatch.press("draft.paste", { text: "yo yo yo this is a test\n\n@ask whats up\n\n@prior-art agent in the outline how do you do\n\n@prior-art when did this trigger ...\n" }, tile);
    screen();
    expect(screen()).toMatch(/[═─].*yo yo yo this is a test/);
    expect(r.title()).toContain("yo yo yo this is a test");
    expect(r.surface.render(80, 40, r.host(stage)).lines.map(plain).join("\n")).toContain("editing · yo yo yo this is a test");
    await until(() => screen().includes("no agent answers @ask"), "the unknown ask explained");
    expect(d.text).toContain("@ask whats up");
    await until(() => d.answerFolds().length === 2 && d.text.includes("I find earlier related notes"), "both prior-art answers", 15000).catch(error => { throw new Error(`${error.message}\n${d.text}\n${JSON.stringify([...d.asks])}`); });
    const narrow = d.render(48, 60).map(plain);
    expect(narrow.join("\n")).toContain("beside ▸");
    expect(narrow.every(line => Bun.stringWidth(line) <= 48)).toBe(true);
    expect(narrow.join("\n")).toContain("agents here:");
    const ask = "@ask whats up", askRow = d.lines.indexOf(ask);
    await stage.dispatch.press("draft.place", { line: askRow + 1, col: 1 }, tile);
    const raw = r.surface.render(48, 60, r.host(stage)).lines.map(plain), y = raw.findIndex(line => line.includes(ask));
    expect(editorClick(d, d.frame!.col + ask.length, y)).toBe(true);
    expect(d.col).toBe(ask.length);
    await stage.dispatch.press("draft.place", { line: askRow + 1, col: 1 }, tile);
    editorClick(d, d.frame!.col + ask.length, y, true);
    expect((await stage.dispatch.press("draft.copy", {}, tile) as { text: string }).text).toBe(ask);
    await stage.dispatch.press("draft.place", { line: d.lines.length, col: d.lines.at(-1)!.length + 1 }, tile);
    await stage.dispatch.press("draft.paste", { text: "\nOrdinary prose that runs beyond a narrow tile should keep its original paragraph ending\ncontinued.\n" }, tile);
    await stage.dispatch.press("rich.toggle", {}, tile);
    const rich = r.surface.render(48, 60, r.host(stage)).lines.map(plain);
    expect(rich.join("\n")).toContain("no agent answers @ask");
    const ending = rich.findIndex(line => line.includes("ending")), continued = rich.findIndex(line => line.includes("continued."));
    expect(ending).toBeGreaterThanOrEqual(0);
    expect(continued).toBeGreaterThanOrEqual(0);
    expect(continued - ending).toBeLessThanOrEqual(1);
    await stage.dispatch.press("rich.toggle", {}, tile);
    expect((await board.get(d.blockId))!.text).toBe("");
    await stage.dispatch.press("edit.save", {}, tile);
    expect((await board.get(d.blockId))!.text).toContain("@ask whats up");
    const saved = await board.request<any>("resources.projection.read", { blockId: d.blockId });
    expect(saved.projections.some((p: any) => p.reason?.includes("no agent answers @ask"))).toBe(true);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 30000);


  test("tidy instructions patch an unsaved passage once and every ask explains its outcome (PIE-916)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "asks" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "asks")).top;
    const folder = join(scratch.root, "config/pi-herdr-outliner/extensions/tidy");
    const replacement = "> [!note] Apples\n> Keep apples\n\n> [!note] Pears\n> Keep pears";
    const model = join(folder, "fixture-answer.ts");
    writeFileSync(model, `const prompt = await Bun.stdin.text();
if (!prompt.includes("wrap each item in a callout") || !prompt.includes("- apples") || prompt.includes("@tidy")) process.exit(2);
console.log(JSON.stringify({ replacement: ${JSON.stringify(replacement)}, message: "rewrote 2 items as callouts" }));`);
    writeFileSync(join(folder, "config.json"), JSON.stringify({ config: { answer: ["bun", model] } }));
    await app.loadExtensions(true);
    await (app as any).dispatch.press("note.new", { opens: "tab" });
    await until(() => [...stage.panes.values()].some(p => p.surface?.draft), "new draft");
    const r = [...stage.panes.values()].find(p => p.surface?.draft) as ReaderPane;
    const d = r.surface.draft!, tile = stage.nameOf([...stage.panes].find(([, p]) => p === r)![0]);
    const instruction = "@tidy wrap each item in a callout";
    const source = `Orchard\n- cherries\n@tidy earlier\nFruit to wrap:\n- apples\n\n  more apples\n\n- pears\n${instruction}\n${instruction}\n@tidy yo\n`;
    await stage.dispatch.press("draft.paste", { text: source }, tile);
    await until(() => d.text.includes("> [!note] Apples"), "the instructed rewrite in the live draft", 8000);
    await until(() => d.askStatus(instruction).includes("rewrote 2 items as callouts") && d.askStatus("@tidy yo").includes("answer command exited 2"), "every ask's outcome", 8000);
    expect(d.text).toContain("- cherries\n@tidy earlier\nFruit to wrap:\n");
    expect(d.text).toContain(instruction + "\n" + instruction);
    expect((await board.get(d.blockId))!.text).toBe("");
    expect(d.flashes.some(s => s.label.includes("tidy"))).toBe(true);
    await stage.dispatch.press("draft.place", { line: d.lines.indexOf(instruction) + 1, col: 1 }, tile);
    screen();
    const opened = await stage.dispatch.press("ask.beside", { ask: instruction }, tile) as { tile: string };
    const answer = stage.pane(opened.tile);
    expect(answer?.render(100, 10, false, stage).lines.map(plain).join("\n")).toContain("rewrote 2 items as callouts");
    await stage.dispatch.press("draft.undo", {}, tile);
    expect(d.text).toBe(source);
    await stage.dispatch.press("edit.close", { discard: true }, tile);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 30000);


  test("a macro starts with its key and stops by mouse without recording the agent", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    press({ kind: "alt", ch: "Q" });
    await until(() => app.recording.active, "the key started recording");
    const body = 'First line "quoted"\nSecond line \\ path';
    await app.dispatch.act({ action: "comment", tile: "notes", args: { quote: "Prepare the seed labels", body } }, USER);
    const status = plain((app as any).statusBar(sc, 160));
    expect(status).toContain("REC stop");
    const at = ((await app.dispatch.act({ action: "status.bar.items" }, { kind: "user" })) as { items: { id: string; from?: number }[] }).items.find(i => i.id === "macro")!;
    press({ kind: "mouse", action: "down", x: at.from!, y: 59, button: 0 });
    await until(() => !app.recording.active, "the click stopped recording");
    let saved: any;
    await untilAsync(async () => {
      const hit = (await board.queryNotes("script", 100)).notes.find(n => n.text.startsWith("recording-"));
      saved = hit ? await board.get(hit.id) : undefined;
      return !!saved;
    }, "the recording saved");
    expect(saved.text).toContain(body.replaceAll('"', '\\"').replaceAll("\\ path", "\\\\ path"));
    await until(() => !!extensionList()?.extensions.find(e => e.name?.startsWith("recording-")), "the multiline recording loaded");
    const extension = extensionList()!.extensions.find(e => e.name?.startsWith("recording-"))!;
    await app.dispatch.act({ action: `ext.${extension.id}.run` }, USER);
    await until(() => (app as any).message.includes("done · ctrl+z"), "the multiline comment replayed");
    await app.dispatch.act({ action: "comment.close", tile: "notes" }, USER);
    screen();
  }, 30_000);


  test("a macro records an extension invocation once, not its asynchronous script actions", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    await until(() => !!extensionList()?.extensions.find(e => e.name === "seed-report"), "the script loaded");
    const extension = extensionList()!.extensions.find(e => e.name === "seed-report")!;
    await app.dispatch.act({ action: "macro.record", args: { name: "scripted-recording" } }, USER);
    const run = await app.dispatch.act({ action: `ext.${extension.id}.run` }, USER) as { written: string[] };
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "the nested script finished");
    expect((await board.get(run.written[0]!))!.text).toContain("· done");
    const saved = await app.dispatch.act({ action: "macro.stop" }, USER) as { block: string };
    const text = (await board.get(saved.block))!.text;
    expect(text).toContain(`ext.${extension.id}.run`);
    expect(text).not.toContain("task.status");
    await app.dispatch.act({ action: "ext.undo", tile: "source" }, USER);
    screen();
  }, 30_000);


  test("scripts run by name with slots from slash and by their bound key", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    const made = await board.request<{ id: string }>("create", { author: "user", text: 'Bound seeds [script::bound-seeds] [results::keep] [effects::write]\n```actions\nblock.mark id="{{props.note}}" reason="Check seeds"\n```' });
    await board.request("extensions.list", { reload: true });
    await until(() => !!extensionList()?.extensions.find(e => e.name === "bound-seeds"), "bound script loaded");
    await app.dispatch.act({ action: "bar.open", args: { query: `bound-seeds note=${seeded.notes.shed.id}`, scope: "notes" } }, USER);
    await until(() => !!app.bar?.items.some(r => r.row.label.includes("bound-seeds")), "named script row");
    await app.dispatch.act({ action: "bar.pick" }, USER);
    await app.dispatch.press("bar.close");
    await untilAsync(async () => (await board.children(made.id)).some(n => n.text.includes("· done")), "named script ran");
    expect(JSON.stringify(await app.dispatch.act({ action: "marks.list" }, USER))).toContain("Check seeds");
    const keyed = await board.request<{ id: string }>("create", { author: "user", text: 'Key seeds [script::key-seeds] [results::keep] [keys::alt+J]\n```js\nreturn "Key seeds ran";\n```' });
    await board.request("extensions.list", { reload: true });
    await until(() => !!extensionList()?.extensions.find(e => e.name === "key-seeds"), "key script loaded");
    press({ kind: "alt", ch: "J" });
    await untilAsync(async () => (await board.children(keyed.id)).some(n => n.text.includes("Key seeds ran")), "bound key ran the script");
    const clash = await board.request<{ id: string }>("create", { author: "user", text: 'Clashing seeds [script::clashing-seeds] [results::keep] [keys::ctrl+k]\n```js\nreturn "Must not run";\n```' });
    await app.loadExtensions(true);
    await until(() => (app as any).message.includes("ctrl+k is held by"), "the key clash is explained");
    press({ kind: "char", ch: "k", ctrl: true });
    expect(app.bar).toBeTruthy();
    press({ kind: "esc" });
    expect(await board.children(clash.id)).toHaveLength(0);
    const inline = await board.request<{ id: string }>("create", { author: "user", text: `While typing [script::while-typing] [results::keep] [effects::write]\n\`\`\`js\nawait act("marks.list");\nawait act("open", {id: "${seeded.notes.shed.id}"}); return "Opened beside";\n\`\`\`` });
    await board.request("extensions.list", { reload: true });
    await until(() => !!extensionList()?.extensions.find(e => e.name === "while-typing"), "inline script loaded");
    screen();
    await app.dispatch.act({ action: "edit", tile: "notes" }, USER);
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "scripts")).top;
    const reader = [...stage.panes.values()].find((p: any) => p.editing) as ReaderPane;
    const draft = reader.surface.draft!;
    press({ kind: "enter" });
    press({ kind: "end" });
    press({ kind: "alt", ch: "J" });
    press({ kind: "paste", text: "\n@while-typing\nStill planting." });
    expect(draft.text).toContain("Still planting.");
    expect(await board.children(keyed.id)).toHaveLength(1);
    await untilAsync(async () => (await board.children(inline.id)).some(n => !n.text.includes("· working")), "inline script answered while typing");
    expect((await board.children(inline.id))[0]!.text).toContain("· done");
    expect(reader.surface.draft).toBe(draft);
    expect(reader.surface.msg!.id).toBe(seeded.notes.scriptTarget.id);
    expect(draft.text).toContain("Still planting.");
    await app.dispatch.act({ action: "open", tile: "source", args: { id: seeded.notes.scripts.id } }, USER);
    for (let i = 0; i < 5 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("a script in the showcase calls the dispatcher and streams an undoable result", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    await until(() => !!extensionList()?.extensions.find(e => e.name === "seed-report"), "the script bound");
    const extension = extensionList()?.extensions.find(e => e.name === "seed-report")!;
    const run = await app.act({ action: `ext.${extension.id}.run`, as: "test-agent" }) as { written: string[]; undo: string };
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "the script finished");
    const log = (await board.get(run.written[0]!))!;
    expect(log.text).toContain("· done");
    expect(log.text).toContain("Ready for planting");
    expect(log.text).toContain("dispatcher");
    expect((await board.get(seeded.notes.scriptTarget.id))!.text).toContain("- [x] Prepare the seed labels");
    const made = (await board.children(seeded.notes.scripts.id)).find(n => n.text === "Labels for planting")!;
    expect(made).toBeDefined();
    await app.act({ action: "ext.undo", tile: "source", as: "test-agent" });
    expect((await board.get(seeded.notes.scriptTarget.id))!.text).toContain("- [ ] Prepare the seed labels");
    expect((await board.children(seeded.notes.scripts.id)).some(n => n.id === made.id || n.id === log.id)).toBe(false);
  }, 30_000);


  test.each(["open", "saved", "roundtrip", "proposal", "dismiss"])("one script undo preserves typing across draft changes: %s", async (mode) => {
    const saveBeforeEnd = mode === "saved";
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "scripts")).top;
    await app.act({ action: "edit", tile: "notes", as: "test-agent" });
    const draft = ([...stage.panes.values()].find((p: any) => p.editing) as any).surface.draft;
    press({ kind: "enter" });
    await stage.dispatch.press("draft.place", { line: draft.lines.length }, "notes");
    press({ kind: "paste", text: "\n\nKeep typing here." });
    const target = seeded.notes.scriptTarget.id;
    const proposed = mode === "proposal" || mode === "dismiss" ? await board.request<{proposalId: string}>("draft.patch", {
      blockId: target, revision: (await board.get(target))!.revision,
      patches: [{observed: "Prepare", replacement: "Sort"}], propose: true, mutation: {author: "agent", actorId: `script:draft-labels-${mode}`},
    }) : null;
    if (mode === "dismiss") press({kind: "paste", text: `\n!((${proposed!.proposalId}))\n`});
    const source = await board.request<{ id: string }>("create", { author: "agent", provenance: { actorId: "seed-writer" }, text: [
      `Draft labels [script::draft-labels-${mode}] [results::keep] [effects::write]`, "```js",
      `const note = await read('${target}');`,
      mode === "proposal" ? `await act('proposal.apply', {id:'${proposed!.proposalId}'});` : `await tools.outline_patch({ref: note.id, revision: note.revision, patches: [{observed:'Prepare', replacement:'Sort'}]});`,
      `await tools.outline_patch({ref: note.id, revision: note.revision, patches: [{observed:'seed labels', replacement:'seed envelopes'}]});`,
      ...(mode === "dismiss" ? [`await act('proposal.dismiss', {id:'${proposed!.proposalId}'});`] : []),
      ...(mode === "roundtrip" ? [`await tools.outline_patch({ref:note.id, revision:note.revision, patches:[{observed:'Sort the seed envelopes',replacement:'Prepare the seed labels'}]});`] : []),
      `await tools.outline_create({parent: '${target}', text: 'Extra envelopes'});`,
      `while (!(await q('signal=draft-ready')).blocks.length) {}`,
      "```",
    ].join("\n") });
    await board.request("extensions.list", { reload: true });
    await until(() => !!extensionList()?.extensions.find(e => e.name === `draft-labels-${mode}`), "draft script bound");
    const extension = extensionList()!.extensions.find(e => e.name === `draft-labels-${mode}`)!;
    const run = await app.act({ action: `ext.${extension.id}.run`, as: "test-agent" }) as { written: string[]; undo: string };
    press({ kind: "paste", text: " Still here." });
    await untilAsync(async () => (await board.children(target)).some(n => n.text === "Extra envelopes"), "draft patched").catch(async error => { throw new Error(`${error.message}; run: ${(await board.get(run.written[0]!))?.text}`); });
    if (saveBeforeEnd) {
      press({ kind: "char", ch: "s", ctrl: true });
      await until(() => ![...stage.panes.values()].some((p: any) => p.editing), "draft saved and closed").catch(error => { throw new Error(`${error.message}; draft: ${draft.note}\n${screen()}`); });
    }
    const signal = await board.request<{id: string}>("create", { author: "user", text: "Continue [signal::draft-ready]" });
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "draft script done");
    await board.request("delete", { blockId: signal.id });
    expect((await board.get(run.written[0]!))!.text).toContain("· done");
    expect(draft.text).toContain(mode === "roundtrip" ? "Prepare the seed labels" : "Sort the seed envelopes");
    expect(draft.text).toContain(mode === "dismiss" ? "Keep typing here." : "Keep typing here. Still here.");
    if (mode === "dismiss") {
      press({ kind: "char", ch: "s", ctrl: true });
      await until(() => ![...stage.panes.values()].some((p: any) => p.editing), "dismissed draft saved");
    }
    await board.request("extensions.undo", { undo: run.undo });
    const undone = saveBeforeEnd || mode === "dismiss" ? (await board.get(target))!.text : draft.text;
    expect(undone).toContain("Prepare the seed labels");
    expect(undone).toContain(mode === "dismiss" ? "Keep typing here." : "Keep typing here. Still here.");
    if (mode === "dismiss") expect(undone).toContain(`!((${proposed!.proposalId}))`);
    expect((await board.children(target)).some(n => n.text === "Extra envelopes")).toBe(false);
    expect((await board.get(source.id))!.text).toContain("script::draft-labels");
    for (let i = 0; i < 5 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("a draft opened by a script keeps receiving agent patches after the run finishes", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "scripts")).top;
    const target = await board.request<{id: string}>("create", {author: "user", text: "Seed plan\n\nPrepare the labels."});
    await app.act({action: "open", args: {id: target.id}, tile: "notes", as: "test-agent"});
    await board.request("create", {author: "user", text: "Open seed plan [script::open-seed-plan] [results::keep] [effects::write]\n```js\nawait act('edit');\n```"});
    await board.request("extensions.list", {reload: true});
    await until(() => !!extensionList()?.extensions.find(e => e.name === "open-seed-plan"), "edit script bound");
    const extension = extensionList()!.extensions.find(e => e.name === "open-seed-plan")!;
    const run = await app.dispatch.act({action: `ext.${extension.id}.run`}, USER) as {written: string[]};
    try {
      await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "edit script done");
      expect((await board.get(run.written[0]!))!.text).toContain("· done");
      const reader = [...stage.panes.values()].find((p: any) => p.editing) as ReaderPane;
      const draft = reader.surface.draft!;
      press({kind: "enter"});
      await stage.dispatch.press("draft.place", {line: draft.lines.length}, "notes");
      await stage.dispatch.press("draft.paste", {text: "\n\nStill typing."}, "notes");
      // The first lease must expire unless the script-created heartbeat remains usable after completion.
      await Bun.sleep(DRAFT_LEASE_MS + 1000);
      const patched = await board.request("draft.patch", {
        blockId: target.id, revision: (await board.get(target.id))!.revision,
        patches: [{observed: "Prepare", replacement: "Sort"}], mutation: {author: "agent", actorId: "seed-helper"},
      });
      expect(patched).toMatchObject({outcome: "applied", edits: [{blockId: target.id, route: "draft"}]});
      expect(draft.text).toContain("Sort the labels.");
      expect(draft.text).toContain("Still typing.");
      expect((await board.get(target.id))!.text).toContain("Prepare the labels.");
    } finally {
      await stage.dispatch.press("edit.close", {discard: true}, "notes");
      for (let i = 0; i < 5 && S().focus === "stage"; i++) press({kind: "esc"});
    }
  }, 30_000);


  test("an agent running a person's script cannot move the draft the person is typing in", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "scripts" }, as: "test-agent" });
    screen();
    const stage = S().stage(SECTIONS.findIndex(s => s.key === "scripts")).top;
    const target = await board.request<{id: string}>("create", {author: "user", text: "Draft at the desk\n\nKeep writing here."});
    await app.act({action: "open", args: {id: target.id}, tile: "notes", as: "test-agent"});
    await app.act({ action: "edit", tile: "notes", as: "test-agent" });
    const reader = [...stage.panes.values()].find((p: any) => p.editing) as ReaderPane;
    const draft = reader.surface.draft!;
    press({ kind: "enter" });
    press({ kind: "end" });
    press({ kind: "paste", text: "\n\nStill writing this note." });
    expect(draft.text).toContain("Still writing this note.");
    const { idle: _idle, ...person } = app.person();
    const source = await board.request<{id: string}>("create", {author: "user", text:
      `Open the shed [script::open-the-shed] [results::keep] [effects::write]\n\`\`\`js\nawait act('open', {id:'${seeded.notes.shed.id}'});\n\`\`\``});
    await board.request("extensions.list", {reload: true});
    await until(() => !!extensionList()?.extensions.find(e => e.name === "open-the-shed"), "open script bound");
    const extension = extensionList()!.extensions.find(e => e.name === "open-the-shed")!;
    const run = await app.act({action: `ext.${extension.id}.run`, as: "test-agent"}) as {written: string[]};
    await untilAsync(async () => !(await board.get(run.written[0]!))!.text.includes("· working"), "open script done");
    expect((await board.get(run.written[0]!))!.text).toContain("· done");
    expect(reader.surface.draft).toBe(draft);
    expect(reader.surface.msg!.id).toBe(target.id);
    const { idle: _afterIdle, ...after } = app.person();
    expect(after).toEqual(person);
    expect(draft.text).toContain("Still writing this note.");
    for (let i = 0; i < 5 && S().focus === "stage"; i++) press({kind: "esc"});
  }, 30_000);
});

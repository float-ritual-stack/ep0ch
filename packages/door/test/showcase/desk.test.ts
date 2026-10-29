import { traceActions } from "../../src/surface/actions";
// PIE-439: the showcase screen, the desk: esc, refusals, drawer, status, sessions, power bar, policy. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../../src/app";
import { Desk } from "../../src/desk/desk";
import { WhatChangedPane } from "../../src/desk/what-changed";
import { seedRace, RACE, RACE_AGENTS, RACE_LINE, RACE_PATCH, type Seeded } from "../../src/showcase/seed";
import { gardenRound, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { subject } from "../../src/board";
import type { ReaderPane } from "../../src/desk/panes";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";
import { prop } from "../../src/props";

describe.skipIf(!outliner)("the showcase screen: the desk: esc, refusals, drawer, status, sessions, power bar, policy", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });



  test("the status-bar section pins Collapse through the note menu and the bar button collapses the extra tile", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status-bar" }, as: "test-agent" });
    await until(() => screen().includes("[Collapse]"), "the status bar guide");
    // The note holds two buttons, so the menu row needs one selected: put the [ ] on Collapse, as the demo's text says.
    const found = await app.dispatch.act({ action: "elements", tile: "notes" }, { kind: "user" }) as { elements: { n: number; label: string }[] };
    await app.dispatch.act({ action: "element.select", tile: "notes", args: { n: found.elements.find(e => e.label.includes("Collapse"))!.n } }, { kind: "user" });
    const menu = await app.dispatch.act({ action: "tile.menu", tile: "notes" }, { kind: "agent", id: "test-agent" }) as any;
    expect(JSON.stringify(menu)).toContain("pin to status bar");
    await app.dispatch.act({ action: "button.pin", tile: "notes", args: { label: "Collapse" } }, { kind: "user" });
    const note = (await board.byProp("status-bar", "true"))[0]!;
    expect(note.text).toContain('::button{label="Collapse" act="tile.collapse tile=extra"}');
    const bar = () => { app.flush(); return plain(h.painted.at(-1)!); };
    await until(() => bar().includes("Collapse"), "the pinned button");
    const ran: string[] = [];
    const stop = traceActions(a => ran.push(a.name));
    try {
      const x = bar().indexOf("Collapse");
      press({ kind: "mouse", action: "down", button: 0, x, y: 59 });
      await until(() => ran.includes("tile.collapse"), "Collapse through the bar");
      expect(ran).toContain("button.press");
      expect(ran).toContain("tile.collapse");
      const layout = await app.dispatch.act({ action: "layout.get" }, { kind: "user" }) as { tiles: { name: string; collapsed?: boolean }[] };
      expect(layout.tiles.find(t => t.name === "extra")?.collapsed).toBe(true);
      expect(layout.tiles.find(t => t.name === "notes")?.collapsed).not.toBe(true);
    } finally {
      stop();
      await board.trash(note.id);
      // The section's layout is kept: the next test starts with extra open, as a person entering it would.
      await app.dispatch.act({ action: "tile.collapse", tile: "extra", args: { on: false } }, { kind: "user" }).catch(() => null);
    }
  });

  test("a right-click on a button the person sees offers pin to status bar for that button, and presses nothing (PIE-1415)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status-bar" }, as: "test-agent" });
    await until(() => screen().includes("[Collapse]"), "the status bar guide");
    // The [ ] on another button first: the right-click alone decides which one the menu pins.
    const found = await app.dispatch.act({ action: "elements", tile: "notes" }, { kind: "user" }) as { elements: { n: number; label: string; kind: string }[] };
    const other = found.elements.find(e => e.kind === "control" && !e.label.includes("Collapse"))!;
    await app.dispatch.act({ action: "element.select", tile: "notes", args: { n: other.n } }, { kind: "user" });
    app.flush();
    const row = h.painted.findIndex((l, i) => i < h.painted.length - 1 && plain(l).includes("[Collapse]")), col = plain(h.painted[row]!).indexOf("[Collapse]") + 2;
    const ran: string[] = [];
    const stop = traceActions(a => ran.push(a.name));
    let note: { id: string } | undefined;
    try {
      press({ kind: "mouse", action: "down", button: 2, x: col, y: row });
      press({ kind: "mouse", action: "up", button: 2, x: col, y: row });
      // The menu's row, not the guide's sentence about it.
      const pinRow = (l: string) => /│ +pin to status bar/.test(plain(l));
      await until(() => { app.flush(); return h.painted.some(pinRow); }, "the tile menu's pin row");
      expect(ran).not.toContain("button.press");
      expect(ran).not.toContain("tile.collapse");
      const at = h.painted.findIndex(pinRow), x = plain(h.painted[at]!).search(/pin to status bar(?=\s*│)/);
      press({ kind: "mouse", action: "down", button: 0, x, y: at });
      press({ kind: "mouse", action: "up", button: 0, x, y: at });
      await untilAsync(async () => !!(note = (await board.byProp("status-bar", "true"))[0]), "the pinned bar note");
      await untilAsync(async () => (await board.get(note!.id))!.text.includes('label="Collapse"'), "Collapse pinned");
      expect((await board.get(note!.id))!.text).not.toContain(`label="${other.label.replace(/^\[|\]$/g, "")}"`);
    } finally {
      stop();
      if (note) await board.trash(note.id);
      // The clicks put the person in the section; the next test moves from the index.
      S().focus = "index";
    }
  });

  test("the status-bar section's group opens as a menu that folds the extra tile, a typo shows as ! with the rest kept, and a list-item button presses in the guide (PIE-1224, PIE-1227)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status-bar" }, as: "test-agent" });
    await until(() => screen().includes("[Fold from a list]"), "the list-item button in the guide");
    const guide = seeded.notes.statusBar.text.split("\n");
    const example = guide.slice(guide.indexOf("```text") + 1, guide.lastIndexOf("```")).join("\n");
    const note = await board.createBlock(null, example);
    const bar = () => { app.flush(); return plain(h.painted.at(-1)!); };
    const collapsed = async () => ((await app.dispatch.act({ action: "layout.get" }, { kind: "user" })) as { tiles: { name: string; collapsed?: boolean }[] }).tiles.find(t => t.name === "extra")?.collapsed === true;
    const unfold = () => app.dispatch.act({ action: "tile.collapse", tile: "extra", args: { on: false } }, { kind: "user" });
    try {
      await until(() => bar().includes("Tiles ▲") && bar().includes("! line 8"), "the group and the skipped line");
      expect(bar()).toContain("ep0ch");
      const rows = (await app.dispatch.act({ action: "status.bar.menu", args: { group: "Tiles" } }, { kind: "agent", id: "test-agent" }) as any).rows;
      expect(rows.map((r: any) => r.label)).toEqual(["[Fold extra]", expect.any(String), "More ▲"]);
      // By mouse: the group's label, then the button's row in its menu.
      press({ kind: "mouse", action: "down", button: 0, x: bar().indexOf("Tiles"), y: 59 });
      await until(() => h.painted.some(l => plain(l).includes("[Fold extra]")), "the group's menu");
      const row = h.painted.findIndex(l => plain(l).includes("[Fold extra]")), col = plain(h.painted[row]!).indexOf("[Fold extra]");
      press({ kind: "mouse", action: "down", button: 0, x: col, y: row });
      press({ kind: "mouse", action: "up", button: 0, x: col, y: row });
      await untilAsync(collapsed, "Fold extra from the group's menu");
      await unfold();
      // A group in the group: its menu opens where Tiles's did, not at the left edge (PIE-1415).
      press({ kind: "mouse", action: "down", button: 0, x: bar().indexOf("Tiles"), y: 59 });
      await until(() => h.painted.some(l => plain(l).includes("More ▲")), "the group's menu again");
      const more = h.painted.findIndex(l => plain(l).includes("More ▲")), at = plain(h.painted[more]!).indexOf("More ▲");
      press({ kind: "mouse", action: "down", button: 0, x: at, y: more });
      press({ kind: "mouse", action: "up", button: 0, x: at, y: more });
      expect((await app.dispatch.act({ action: "status.bar.menu", args: { group: "Tiles/More" } }, { kind: "agent", id: "test-agent" }) as any).rows).toHaveLength(1);
      // Its frame's title says More, standing where the outer menu stood.
      await until(() => { app.flush(); return h.painted.some(l => /┌─ More /.test(plain(l))); }, "the inner menu");
      const inner = h.painted.find(l => /┌─ More /.test(plain(l)))!;
      expect(Math.abs(plain(inner).indexOf("┌─ More") - at)).toBeLessThanOrEqual(4);
      press({ kind: "esc" });
      // The guide's own list-item button presses in the reader, by act.
      const pressed = await app.dispatch.act({ action: "button.press", tile: "notes", args: { label: "Fold from a list" } }, { kind: "user" });
      await untilAsync(collapsed, `the list-item button in the guide (it answered ${JSON.stringify(pressed)})`);
      await unfold();
    } finally {
      await board.trash(note.id);
      // The clicks put the person in the section; the next test moves from the index.
      S().focus = "index";
    }
  });

  test("the terminal showcase paints its program's browser link beside the notebook", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "terminal" }, as: "test-agent" });
    await until(() => {
      screen();
      return sc.render(app).lines.some(line => line.includes("\x1b]8;id=example;"));
    }, "the terminal's example link");
    try {
      (app as any).paint();
      expect(h.painted.join("\n").replace(/\x1b\[[\d;]*m/g, "")).toContain("\x1b]8;id=example;https://example.com\x1b\\Example website »\x1b]8;;\x1b\\");
    } finally { (S().stages.get(S().sel).top as Desk).dispose(); }
  });

  test("tile titles follow their notes, keep written templates through toggles and restore from the layout", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "panes" }, as: "test-agent" });
    await until(() => !!S().stages.get(S().sel), "the panes section");
    const d = S().stages.get(S().sel).top as Desk;
    await until(() => d.layoutGet().tiles.some(t => t.showing?.id === seeded.notes.notebook.id), "the notebook reader");
    const tile = d.layoutGet().tiles.find(t => t.kind === "reader")!.name;
    const info = () => d.layoutGet().tiles.find(t => t.name === tile)!;
    await app.act({ action: "tile.title", tile, args: { text: "" }, as: "test-agent" });
    expect(info().label).toBe(subject(seeded.notes.notebook));
    await app.act({ action: "tile.title", tile, args: { text: "Reading {{this.title}} · {{tile.kind}} {{tile.n}} · {{this.title-colour || unset}}" }, as: "test-agent" });
    expect(info().label).toContain(`Reading ${subject(seeded.notes.notebook)} · reader`);
    expect(screen()).toContain("Reading");
    expect(d.tileOutline().find(t => t.name === tile)!.label).toBe(info().label);
    const writtenTitle = info().label;
    expect(info().title).toBe(writtenTitle);
    await app.act({ action: "tile.title.mode", tile, as: "test-agent" });
    expect(info().label).toBe(subject(seeded.notes.notebook));
    const saved = d.layoutSpec();
    await app.act({ action: "tile.title.mode", tile, as: "test-agent" });
    expect(info().label).toBe(writtenTitle);
    const restored = new Desk({ name: "titles", title: "titles", layout: saved });
    restored.enter(app);
    try {
      await until(() => restored.layoutGet().tiles.find(t => t.name === tile)?.showing?.id === seeded.notes.notebook.id, "the restored notebook");
      expect(restored.layoutGet().tiles.find(t => t.name === tile)!.label).toBe(subject(seeded.notes.notebook));
      await restored.dispatch.press("tile.title.mode", {}, restored.layoutGet().tiles.find(t => t.name === tile)!.tile);
      expect(restored.layoutGet().tiles.find(t => t.name === tile)!.label).toBe(writtenTitle);
    } finally { restored.dispose(); }

    await app.act({ action: "open", tile, args: { id: seeded.notes.shed.id }, as: "test-agent" });
    await until(() => info().label.includes(subject(seeded.notes.shed)), "the title following its note");
    expect(info().name).toBe(tile);
    const shed = (await board.get(seeded.notes.shed.id))!;
    const coloured = await board.update(shed.id, shed.text.replace("\n", " [title-colour::amber]\n"), shed.revision!);
    await until(() => info().label.endsWith("amber"), "the title following an external property change");
    await board.update(shed.id, shed.text, coloured.revision!);
    await d.dispatch.press("tile.focus", {}, tile);
    press({ kind: "enter" });
    press({ kind: "char", ch: "w", ctrl: true }); ch("n");
    await until(() => S().stages.get(S().sel).top.overlays.top()?.name === "tile title", "rename from the key");
    press({ kind: "char", ch: "u", ctrl: true });
    press({ kind: "enter" });
    await until(() => !S().stages.get(S().sel).top.overlays.top(), "empty title saved");
    expect(info().label).toBe(subject(seeded.notes.shed));
    const lines = screen().split("\n"), y = lines.findIndex(l => l.includes("4 Visitors"));
    expect(y).toBeGreaterThan(0);
    const x = lines[y]!.indexOf("Visitors") + 1;
    for (let i = 0; i < 2; i++) {
      press({ kind: "mouse", action: "down", button: 0, x, y });
      press({ kind: "mouse", action: "up", button: 0, x, y });
    }
    expect(screen()).toContain("Rename this tile");
    expect(d.layoutGet().focus).toBe("activity");
    press({ kind: "paste", text: "Garden visitors and callers" });
    press({ kind: "enter" });
    const frame = screen().split("\n").find(l => l.includes("4 Garden"));
    expect(frame).toContain("[name]");
    const chipY = screen().split("\n").indexOf(frame!), chipX = frame!.indexOf("[name]") + 1;
    press({ kind: "mouse", action: "down", button: 0, x: chipX, y: chipY });
    press({ kind: "mouse", action: "up", button: 0, x: chipX, y: chipY });
    expect(d.layoutGet().tiles.find(t => t.name === "activity")!.label).toBe("last callers · live");
    press({ kind: "esc" });
    press({ kind: "esc" });

  }, 30_000);

  test("the esc section: three nested things open (a zoom, a lit link, the tile menu); each Esc closes one, innermost first, then the keys come back to the index, then nothing to close, and the screen stays", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "esc" }, as: "test-agent" });
    await until(() => marks.esc!.every(m => screen().includes(m)), "the esc section");
    const stage = () => S().stages.get(S().sel).top;
    const overlay = () => stage().overlays.top() as { name: string } | null;
    const lit = () => (stage().pane("reader").describe().elements?.current ?? null) as unknown;
    const message = () => (app as any).message as string;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // The person's keys: zoom the reader, light a link in it, open its menu.
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "z" });
    expect(stage().zoom).not.toBeNull();
    press({ kind: "char", ch: "]" });
    await until(() => lit() !== null, "a link lit in the reader");
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "." });
    await until(() => overlay()?.name === "tile menu", "the reader's menu");
    // Esc: the menu, then the link, then the zoom, one each.
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    expect(lit()).not.toBeNull();
    expect(stage().zoom).not.toBeNull();
    press({ kind: "esc" });
    expect(lit()).toBeNull();
    expect(stage().zoom).not.toBeNull();
    press({ kind: "esc" });
    expect(stage().zoom).toBeNull();
    // Nothing left in the stage: the keys come back to the index (section.leave); then nothing to close, and it stays.
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
    (app as any).message = "";
    press({ kind: "esc" });
    expect(message()).toBe("nothing to close · q leaves");
    expect(app.describe()).toMatchObject({ screen: "showcase" });
  }, 20_000);


  test("the proposals section (PIE-725): the race's loser is refused, then offers an intentional proposal beside the guide, a retry is deduped, and its agent dismisses it by act", async () => {
    const guide = (await board.get(seeded.notes.race.id))!;
    // @fern won: the guide reads as @fern left it, and @moss's patch wrote nothing into it.
    expect(guide.text).toContain(RACE_LINE.replace(RACE_PATCH.winner.observed, RACE_PATCH.winner.replacement));
    expect(guide.text).not.toContain(seeded.race.proposal);
    const proposal = (await board.get(seeded.race.proposal))!;
    expect([proposal.parentId, prop(proposal, "type"), prop(proposal, "proposal-status")]).toEqual([guide.id, "draft-proposal", "open"]);
    expect(seeded.race.retry).toEqual({ proposalId: seeded.race.proposal, deduped: true });
    expect((await board.proposalsBeside(guide.id)).proposals.map(p => p.id)).toEqual([seeded.race.proposal]);

    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "proposals" }, as: "test-agent" });
    await until(() => marks.proposals!.every(m => screen().includes(m)), "the proposals section");
    // Another retry now, at the revision @moss read: the same proposal back, still one beside the guide, the guide untouched.
    const at = RACE.indexOf(RACE_PATCH.loser.observed);
    const again = await board.request<any>("draft.patch", { blockId: guide.id, revision: seeded.notes.race.revision! - 1, propose: true, mutation: { author: "agent", actorId: RACE_AGENTS.loser },
      patches: [{ ...RACE_PATCH.loser, range: { start: at, end: at + RACE_PATCH.loser.observed.length }, unit: "utf16" }] });
    expect(again).toMatchObject({ outcome: "proposed", proposalId: seeded.race.proposal, deduped: true, beside: guide.id });
    expect((await board.get(guide.id))!.revision).toBe(guide.revision);
    // Through act, in the guide's reader: @fern dismisses @moss's proposal (any agent may), and it's gone from beside the guide.
    expect(await app.act({ action: "proposal.dismiss", args: { id: seeded.race.proposal }, tile: "guide", as: RACE_AGENTS.winner })).toMatchObject({ outcome: "dismissed", embedRemoved: null });
    await until(() => !screen().includes("proposed edit from @moss"), "the proposal gone from beside the guide");
    expect((await board.get(guide.id))!).toMatchObject({ text: guide.text, revision: guide.revision });
  }, 30_000);


  test("the proposals section resolves by key, click and agent action, and waiting counts follow", async () => {
    writeFileSync(join(scratch.root, "config", "pi-herdr-outliner", "extensions", "tidy", "config.json"), JSON.stringify({config: {answer: ["bun", "-e", `await Bun.stdin.text(); console.log(JSON.stringify({patches: [{observed: "grow beans", replacement: "grow peas"}], message: "Kept Tuesday and changed beans to peas."}));`]}}));
    await board.listExtensions(true);
    const make = async () => {
      const note = await board.request<any>("create", {text: "Resolution garden\ngrow beans\ndelivery Monday", author: "user"});
      const proposal = await board.request<any>("draft.patch", {blockId: note.id, revision: note.revision, propose: true, patches: [{observed: "grow beans", replacement: "grow peas"}], mutation: {author: "agent", actorId: "moss"}});
      await board.update(note.id, note.text.replace("Monday", "Tuesday"), note.revision);
      return {note, proposal: proposal.proposalId};
    };
    const finished = async (id: string) => untilAsync(async () => prop((await board.get(id))!, "proposal-status") === "resolved", "the resolution");
    const first = await make();
    await app.act({action: "section", args: {name: "proposals"}, as: "test-agent"});
    await until(() => { screen(); return !!S().stages.get(S().sel); }, "the proposals stage");
    await (S().stages.get(S().sel).top as Desk).dispatch.press("open", {id: first.proposal}, "guide");
    await until(() => screen().includes("[resolve]") && (S().stages.get(S().sel).top as Desk).layoutGet().tiles.some(t => t.showing?.id === first.proposal), "the reader resolve control");
    ch("l");
    ch("r");
    await finished(first.proposal);
    expect((await board.get(first.note.id))!.text).toContain("grow peas\ndelivery Tuesday");
    press({kind: "char", ch: "z", ctrl: true});
    await untilAsync(async () => prop((await board.get(first.proposal))!, "proposal-status") === "open", "one undo reopens the proposal");
    expect((await board.get(first.note.id))!.text).toContain("grow beans\ndelivery Tuesday");
    const second = await make();
    await (S().stages.get(S().sel).top as Desk).dispatch.press("open", {id: second.proposal}, "guide");
    await until(() => screen().includes("[resolve]") && (S().stages.get(S().sel).top as Desk).layoutGet().tiles.some(t => t.showing?.id === second.proposal), "the second reader resolve control");
    const lines = screen().split("\n");
    const y = lines.findIndex(line => line.includes("[resolve]"));
    const x = lines[y]!.indexOf("[resolve]") + 3;
    press({kind: "mouse", action: "down", button: 0, x, y});
    press({kind: "mouse", action: "up", button: 0, x, y});
    await finished(second.proposal);
    const third = await make();
    await until(() => { press({kind: "esc"}); return S().focus === "index"; }, "back at the section index");
    (app as any).lastInput = 0;
    await app.act({action: "section", args: {name: "status"}, as: "test-agent"});
    await until(() => { screen(); return !!S().stages.get(S().sel); }, "the status stage");
    const stage = () => S().stages.get(S().sel).top as Desk;
    const rows = () => (stage().pane("waiting") as any).describe() as any[];
    await until(() => rows().some(row => row.block === third.proposal), "the proposal in waiting on you");
    const before = rows().length;
    expect(await app.act({action: "proposal.resolve", args: {block: third.proposal}, as: "test-agent"})).toMatchObject({outcome: "resolved"});
    await until(() => !rows().some(row => row.block === third.proposal), "the resolved row removed");
    expect(rows().length).toBe(before - 1);
    const offered = await app.act({action: "bar.open", args: {scope: "actions", query: "proposal.resolve"}, as: "test-agent"});
    expect(JSON.stringify(offered)).toContain("proposal.resolve");
    const fourth = await make();
    await until(() => rows().some(row => row.block === fourth.proposal), "the next proposal row");
    await stage().dispatch.press("status.pick", {n: rows().find(row => row.block === fourth.proposal).n}, "waiting");
    await stage().dispatch.press("tile.focus", {}, "waiting");
    ch("l");
    ch("r");
    await finished(fourth.proposal);
    await until(() => { press({kind: "esc"}); return S().focus === "index"; }, "leave the status section for the next example");
  }, 30_000);

  test("the refusals section (PIE-727): a key the spine refuses says why on its frame, loud the second time, gone on another key; the status bar keeps its copy", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "refusals" }, as: "test-agent" });
    await until(() => marks.refusals!.every(m => screen().includes(m)), "the refusals section");
    const stage = () => S().stages.get(S().sel).top;
    await until(() => stage().describe().panes.find((p: any) => p.name === "shed")?.collapsed === true, "the shed folded to a spine");
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    expect(stage().layoutGet().focus).toBe("shed");
    // x on the spine: refused, said on the spine's own frame (where the keys are) and on the status bar.
    press({ kind: "char", ch: "x" });
    const why = app.refusal()!;
    expect(why).toMatchObject({ loud: false });
    expect(why.text).toContain("is collapsed to a spine");
    expect((app as any).message).toBe(why.text);
    await until(() => screen().includes(`✗ ${why.text.slice(0, 12)}`), "the refusal on the spine's frame");
    // x again: loud (bold, on the warning surface), and it stays.
    press({ kind: "char", ch: "x" });
    expect(app.refusal()).toEqual({ text: why.text, loud: true });
    const raw = sc.render(app).lines.find(l => plain(l).includes(`✗ ${why.text.slice(0, 12)}`))!;
    expect(raw).toContain("\x1b[1m");
    expect(raw).toMatch(/\x1b\[48;2;\d+;\d+;\d+m/);
    // Another key (Tab, to the notebook): gone.
    press({ kind: "tab" });
    expect(app.refusal()).toBeNull();
    expect(screen()).not.toContain(`✗ ${why.text.slice(0, 12)}`);
    expect(stage().layoutGet().focus).toBe("reader");
    // ^W x on the notebook's reader: the screen is locked, and the reader's own bottom edge says so; again, loud.
    const close = () => { press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "x" }); };
    close();
    const locked = app.refusal()!;
    expect(locked).toMatchObject({ loud: false });
    const edge = () => screen().split("\n").find(l => l.includes(`✗ ${locked.text.slice(0, 12)}`)) ?? null;
    await until(() => edge() !== null, "the refusal on the reader's frame");
    expect(edge()).toMatch(/[╚└]/);
    close();
    expect(app.refusal()).toEqual({ text: locked.text, loud: true });
    expect(stage().layoutGet().tiles.map((t: any) => t.name)).toEqual(expect.arrayContaining(["shed", "reader"]));
    // A click (the mouse is first-class): the reader's ⋯, then its dimmed close row, says why the same way.
    press({ kind: "char", ch: "j" });
    expect(app.refusal()).toBeNull();
    const at = S().stageRect;
    sc.render(app);
    const b = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "reader");
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    click(at.col + b.from, at.row + b.row);
    await until(() => stage().overlays.top()?.name === "tile menu", "the reader's menu");
    const row = stage().overlays.top().items.find((r: any) => r.action === "tile.close");
    expect(row?.refused).toBeTruthy();
    const lines = sc.render(app).lines.map(plain), y = lines.findIndex(l => l.includes(` ${row.label} `) && l.includes("^W x"));
    expect(y).toBeGreaterThan(0);
    const x = lines[y]!.indexOf(` ${row.label} `) + 2;
    click(x, y);
    expect(app.refusal()).toEqual({ text: row.refused, loud: false });
    await until(() => screen().includes(`✗ ${String(row.refused).slice(0, 12)}`), "the click's refusal on the reader's frame");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);


  test("a screen in a tile (the screen section's board): Esc with nothing left in the board goes on to the desk's steps (its zoom), then back to the index", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "screen" }, as: "test-agent" });
    await until(() => marks.screen!.every(m => screen().includes(m)), "the screen section");
    const stage = () => S().stages.get(S().sel).top;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    await stage().dispatch.press("tile.focus", {}, "board");
    await stage().dispatch.press("tile.zoom", {}, "board"); // the group frame/menu targets the group itself
    expect(stage().zoom).not.toBeNull();
    for (let i = 0; i < 6 && stage().zoom !== null; i++) press({ kind: "esc" });   // the board's own things first, if any
    expect(stage().zoom).toBeNull();
    expect(S().focus).toBe("stage");                                                 // the zoom went before the stage did
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);


  test("the Welcome on the seeded outline: [welcome::true] notes in the Welcome view's hand-set order, moved through act", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "screen.open", args: { name: "welcome" }, as: "test-agent" });
    const top = () => app.screens().at(-1) as any;
    const items = () => (top().pane?.("welcome")?.items ?? null) as { text: string; id: string }[] | null;
    await until(() => top().name === "welcome" && items()?.length === 2, "the two seeded welcome notes");
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["Start here", "House rules"]);
    await app.act({ action: "welcome.move", args: { id: items()![1]!.id, to: 1 }, as: "test-agent" });
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["House rules", "Start here"]);
    await app.act({ action: "welcome.move", args: { id: items()![1]!.id, to: 1 }, as: "test-agent" });
    expect(items()!.map(m => m.text.split(" [")[0])).toEqual(["Start here", "House rules"]);
    await app.act({ action: "screen.back", args: {}, as: "test-agent" });
    await until(() => top() === sc, "back on the showcase");
  }, 20_000);


  test("the drawer chat's open accents the numbered screen destination until focus (PIE-1131)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = S().stages.get(S().sel).top as Desk;
    await app.act({ action: "tile.drawer", tile: "kettle", as: "test-agent" });
    const drawer = app.drawer.desk!;
    const user = { kind: "user" } as const;
    await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: drawer.pathTo(stage.pane("reader")!) } }, user);
    const focus = stage.focusName();
    await drawer.dispatch.act({ action: "open", args: { from: "kettle", id: seeded.notes.callouts.id } }, { kind: "agent", id: "chat-helper" });
    expect(stage.layoutGet().tiles.find(t => t.name === "reader")).toMatchObject({ arrival: { by: "chat-helper" }, showing: { id: seeded.notes.callouts.id } });
    expect(stage.focusName()).toBe(focus);
    expect(screen()).toContain("*");
    expect((app as any).message).toContain("opened in 1 · reader");
    await stage.dispatch.act({ action: "tile.focus", tile: "reader" }, user);
    expect(stage.layoutGet().tiles.find(t => t.name === "reader")!.arrival).toBeUndefined();
    await drawer.dispatch.act({ action: "tile.drawer", tile: "kettle", args: { on: false } }, user);
  });

  test("the drawer section folds: a terminal on the screen to a spine, a lone drawer tile to a strip of the drawer, both opened as they were (PIE-1254)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = S().stages.get(S().sel).top as Desk;
    const user = { kind: "user" } as const;
    const folded = () => stage.layoutGet().tiles.filter(t => t.collapsed).map(t => t.name);
    await stage.dispatch.act({ action: "tile.collapse", tile: "kettle", args: { on: true } }, user);
    expect(folded()).toEqual(["kettle"]);
    await stage.dispatch.act({ action: "tile.collapse", tile: "kettle", args: { on: false } }, user);
    expect(folded()).toEqual([]);
    await app.act({ action: "tile.drawer", tile: "kettle", as: "test-agent" });
    const drawer = app.drawer.desk!;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    await drawer.dispatch.act({ action: "tile.collapse", tile: "kettle", args: { on: true } }, user);
    expect([app.drawer.open, app.drawer.folded, folded()]).toEqual([true, true, []]);
    expect(app.drawer.render(160, 48, "").lines.join("\n").replace(/\x1b\[[\d;]*m/g, "")).toContain("a click opens it");
    await drawer.dispatch.act({ action: "tile.collapse", tile: "kettle", args: { on: false } }, user);
    expect([app.drawer.open, app.drawer.folded]).toEqual([true, false]);
    await drawer.dispatch.act({ action: "tile.drawer", tile: "kettle", args: { on: false } }, user);
    await app.dispatch.act({ action: "host.toggle", args: { open: false } }, user);
  });

  test("the drawer section: a tile goes in beside the drawer's agent tab where it is dropped, not as a tab (PIE-1263)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const user = { kind: "user" } as const;
    await app.act({ action: "tile.drawer", tile: "kettle", args: { to: "drawer.agent", where: "right" }, as: "test-agent" });
    const drawer = app.drawer.desk!;
    const kettle = drawer.layoutGet().tiles.find(t => t.name === "kettle") as any;
    expect(kettle).toBeDefined();
    expect(kettle.tabs ?? []).not.toContain(app.drawer.agentName());      // beside the agent tab, not one of its tabs
    await drawer.dispatch.act({ action: "tile.drawer", tile: "kettle", args: { on: false } }, user);
  });

  test("the drawer section: the drawer's lock is its own, and it says so, by act (PIE-1346)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    await app.act({ action: "tile.drawer", tile: "reader", as: "test-agent" });
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    const drawer = app.drawer.desk!, stage = S().stages.get(S().sel).top as Desk;
    const r = await app.act({ action: "layout.lock", tile: "@drawer/reader", args: { on: true }, as: "test-agent" }) as any;
    try {
      expect(r).toMatchObject({ locked: true, changed: true, layout: "your drawer" });
      expect(drawer.layoutGet().locked).toBe(true);
      expect(stage.layoutGet().locked).toBeFalsy();
      await until(() => screen().includes("▣ drawer locked"), "the drawer's frame says it is locked");
      // Closing a tile in it is refused in the drawer's name, with its own way out; the screen's tiles close as ever.
      await expect(app.act({ action: "tile.close", tile: "@drawer/reader", as: "test-agent" })).rejects.toThrow("your drawer is locked: closing reader is refused · a click on ▣ drawer locked (or ^W P) unlocks it");
    } finally {
      await app.act({ action: "layout.lock", tile: "@drawer/reader", args: { on: false }, as: "test-agent" });
    }
    expect(drawer.layoutGet().locked).toBeFalsy();
    await until(() => !screen().includes("▣ drawer locked"), "the chip goes with the lock");
    await drawer.dispatch.act({ action: "tile.drawer", tile: "reader", args: { on: false } }, { kind: "user" });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
  });

  test("the drawer section: a pick from the chip's picker opens a new agent tab, and the agent already running keeps its process (PIE-1331)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    if (!app.drawer.tile) app.drawer.newAgentTab({ kind: "agent", id: "test-agent" });
    const own = app.drawer.tile!;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, { kind: "user" });
    (app as any).paint();
    await until(() => own.running, "the agent tab runs");
    const pid = own.pid, tabs = app.drawer.tabs().length;
    const r = await app.act({ action: "host.agent", args: { name: "shell" }, as: "test-agent" }) as any;
    expect(r).toMatchObject({ agent: "shell" });
    expect(app.drawer.tabs()).toHaveLength(tabs + 1);
    expect([own.running, own.pid]).toEqual([true, pid]);
    await app.drawer.desk!.dispatch.act({ action: "tile.close", tile: r.name }, { kind: "user" }).catch(() => app.drawer.desk!.dispatch.act({ action: "tile.close", tile: r.name }, { kind: "user" }));
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
  }, 20_000);

  test("a link pressed in the drawer's agent tab opens in the reader its wire names, by the name the program was given (PIE-1257)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = S().stages.get(S().sel).top as Desk;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    if (!app.drawer.tile) app.drawer.newAgentTab({ kind: "agent", id: "test-agent" });
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, { kind: "user" });
    await until(() => app.drawer.tile?.running === true, "the drawer's agent tab runs");
    const drawer = app.drawer.desk!, user = { kind: "user" } as const;
    await drawer.dispatch.act({ action: "tile.link", tile: "drawer.agent", args: { to: drawer.pathTo(stage.pane("reader")!) } }, user);
    const told = (app.drawer.tile as any).programTile as string;
    await drawer.dispatch.act({ action: "open", args: { from: told, id: seeded.notes.callouts.id } }, { kind: "agent", id: "chat-helper" });
    expect(stage.layoutGet().tiles.find(t => t.name === "reader")).toMatchObject({ arrival: { by: "chat-helper" }, showing: { id: seeded.notes.callouts.id } });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" });
  });

  test("drawer list wires select and open into a drawer detail", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const note = await board.createBlock(null, "A changed garden note");
    await board.update(note.id, "A changed garden note\nWater the seedlings", note.revision!, { kind: "agent", id: "garden-helper" });
    await until(() => app.whatChanged.list().some(r => r.blockId === note.id), "the change arrives");
    await app.act({ action: "changes.open", as: "test-agent" });
    const second = await board.createBlock(null, "Another changed garden note", { kind: "agent", id: "garden-helper" });
    await until(() => app.whatChanged.list().some(r => r.blockId === second.id), "another change arrives");
    const drawer = app.drawer.desk!;
    const list = app.drawer.tabs().find(t => t.kind === "what-changed")!.name;
    const user = { kind: "user" } as const;
    await drawer.dispatch.act({ action: "tile.open", tile: list, args: { kind: "detail", name: "drawer-detail", note: seeded.notes.notebook.id } }, user);
    await drawer.dispatch.act({ action: "tile.link", tile: list, args: { to: "drawer-detail", verb: "select" } }, user);
    await drawer.dispatch.act({ action: "changes.pick", tile: list, args: { id: note.id } }, user);
    await until(() => (drawer.pane("drawer-detail") as ReaderPane).msg?.id === note.id, "selection previews in the drawer detail");
    await drawer.dispatch.act({ action: "tile.link", tile: list, args: { verb: "select" } }, user);
    await drawer.dispatch.act({ action: "tile.link", tile: list, args: { to: "drawer-detail", verb: "open" } }, user);
    await drawer.dispatch.act({ action: "changes.go", tile: list, args: { id: second.id } }, user);
    expect((drawer.pane("drawer-detail") as ReaderPane).msg?.id).toBe(second.id);
    await drawer.dispatch.act({ action: "tile.link", tile: list, args: { to: "drawer-detail", verb: "alt" } }, user);
    await drawer.dispatch.act({ action: "changes.go", tile: list, args: { id: note.id, fresh: true } }, user);
    expect((drawer.pane("drawer-detail") as ReaderPane).msg?.id).toBe(note.id);
    const stage = S().stages.get(S().sel).top as Desk;
    await drawer.dispatch.act({ action: "tile.link", tile: list, args: { to: drawer.pathTo(stage.pane("reader")!), verb: "open" } }, user);
    await drawer.dispatch.act({ action: "changes.go", tile: list, args: { id: second.id } }, user);
    expect((stage.pane("reader") as ReaderPane).msg?.id).toBe(second.id);
    await drawer.dispatch.act({ action: "tile.close", tile: "drawer-detail" }, user);
  });

  test("the drawer section, driven through act: the kettle goes in, a section switch keeps it (the same pid), and it comes out into another section", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = () => S().stages.get(S().sel).top;
    const kettle = () => stage().pane("kettle");
    await until(() => kettle()?.running === true, "the kettle runs");
    const pid = kettle().pid;
    const out = await app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: "test-agent" }) as any;
    expect(out).toMatchObject({ name: "kettle", inDrawer: true });
    expect(stage().pane("kettle")).toBeUndefined();
    expect((app as any).message).toContain("an agent (test-agent) put kettle in your drawer");
    // Another section: a screen switch. The drawer still has it, the same program.
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" });
    expect(app.drawer.tabs().map(t => t.name)).toContain("kettle");
    expect((app.drawer.desk!.pane("kettle") as any).pid).toBe(pid);
    expect((app.describe() as any).drawer.tiles.map((t: any) => t.name)).toContain("kettle");
    // Pulled up by the agent (the person's keys stay put), then taken out into this section beside its tree.
    (app as any).lastInput = 0;
    await app.act({ action: "host.toggle", args: { open: true }, as: "test-agent" });
    expect(app.drawer.open).toBe(true);
    expect(app.drawer.entered).toBe(false);
    // A tab in the drawer has its × (tile.close): the kettle's program runs, so a click asks first and closes nothing yet.
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "kettle" }, { kind: "user" });
    (app as any).paint();
    // The frame's × at the header's end: the tab's title is its program's (on a box whose shell names its host, "boxd@…"
    // has an x of its own, PIE-1412).
    const row = app.drawer.rect!.row + 1, header = plain(h.painted[row] ?? ""), col = header.lastIndexOf("x┐");
    expect(col).toBeGreaterThan(0);
    for (const action of ["down", "up"] as const) press({ kind: "mouse", action, button: 0, x: col, y: row });
    // The header row with it: a miss says what was clicked.
    expect({ message: (app as any).message, header, col }).toMatchObject({ message: expect.stringContaining("closing ends it") });
    expect(app.drawer.tabs().map(t => t.name)).toContain("kettle");
    press({ kind: "char", ch: "]", ctrl: true });
    (app as any).lastInput = 0;
    const back = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "right" }, tile: "kettle", as: "test-agent" }) as any;
    expect(back).toMatchObject({ name: "kettle", inDrawer: false });
    expect(stage().pane("kettle").pid).toBe(pid);
    expect(stage().pane("kettle").running).toBe(true);
    // An agent tab comes out too, like any tab: a terminal tile in this section, its program running on; nothing takes its
    // place in the drawer, and drawer.agent still names it there (PIE-1331).
    if (!app.drawer.tile) app.drawer.newAgentTab({ kind: "agent", id: "test-agent" });
    const own = app.drawer.tile!;
    // Its program starts as its tab is first drawn: shown now (another section, the agent sessions', may have left a tab in the drawer).
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, { kind: "user" }).catch(() => {});
    (app as any).paint();
    await until(() => own.running, "the agent tab runs");
    const ownPid = own.pid;
    (app as any).lastInput = 0;
    const left = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "down" }, tile: "drawer.agent", as: "test-agent" }) as any;
    expect(left).toMatchObject({ inDrawer: false });
    expect(stage().pane(left.tile)).toBe(own);
    expect(stage().pane(left.tile).pid).toBe(ownPid);
    expect(app.drawer.tile).toBe(own);
    expect(app.drawer.tabs().some(t => app.drawer.desk!.pane(t.name) === own)).toBe(false);
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" });
  }, 20_000);


  test("the program status section (PIE-614): a fake deploy reports each state; its header, the status bar, the list, peek and status.list follow it; answering it ends done; going to it clears it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status" }, as: "test-agent" });
    await until(() => marks.status!.every(m => screen().includes(m)), "the status section");
    const stage = () => S().stages.get(S().sel).top;
    const deploy = () => stage().pane("deploy");
    const bar = () => { (app as any).paint(); return plain(h.painted.at(-1) ?? ""); };
    // Working, with its progress, on its header (an earlier visit to the section may have found it further on).
    await until(() => ["working", "blocked"].includes(deploy()?.status.urgent()?.state), "it reports", 8000);
    if (deploy().status.urgent().state === "working") expect(screen()).toMatch(/[◴◷◶◵] (20|60)% \d sh/);
    // Blocked on a permission: the header's ◆, the list's row, the status bar's count, peek and status.list.
    await until(() => deploy()?.status.urgent()?.state === "blocked", "blocked", 8000);
    await until(() => /◆ \d sh/.test(screen()) && screen().includes("deploy · needs you · Deploy v2.4.1 to production?"), "the header and the list", 5000);
    expect(bar()).toMatch(/◆[1-9]\d*/);
    const listed = await app.act({ action: "status.list", args: {}, as: "test-agent" }) as any;
    expect(listed.waiting.find((r: any) => r.name === "deploy")).toMatchObject({ name: "deploy", state: "blocked", kind: "permission", app: "deploy", msg: "Deploy v2.4.1 to production?" });
    expect(JSON.stringify(app.describe())).toContain("\"status\":[{\"id\":\"\",\"state\":\"blocked\",\"kind\":\"permission\",\"app\":\"deploy\",\"msg\":\"Deploy v2.4.1 to production?\"}]");
    // Going to it is the person's: an agent's is refused, its keys stay put.
    await expect(app.act({ action: "status.go", tile: "waiting", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();
    // The agent answers the program itself (tile.type), and it rolls out, then finishes done.
    await app.act({ action: "tile.type", tile: "deploy", args: { text: "y\\n" }, as: "test-agent" });
    await until(() => deploy()?.status.urgent()?.state === "done", "done", 8000);
    await until(() => /✓ \d sh/.test(screen()) && screen().includes("deploy · done · Deployed v2.4.1 to 3 regions"), "done on the header and the list", 5000);
    expect(bar()).toContain("✓1");
    // alt+w: the same list in your drawer.
    (app as any).lastInput = 0;
    press({ kind: "alt", ch: "w" });
    await until(() => app.drawer.tabs().some(t => t.kind === "waiting-you"), "the list in the drawer", 5000);
    expect(app.drawer.open).toBe(true);
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
    // The person goes to it from the list (⏎ on its row runs status.go): the keys go to the deploy, and its done is seen.
    await stage().dispatch.press("status.go", { tile: "deploy" }, "waiting");
    await until(() => deploy()?.status.records.size === 0, "seen once the person is in it", 5000);
    expect(bar()).not.toContain("✓1");
    press({ kind: "char", ch: "]", ctrl: true });
    press({ kind: "esc" });
  }, 30_000);


  test("outline asks join waiting on you and clear live (PIE-1072)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status" }, as: "test-agent" });
    await until(() => !!S().stages.get(S().sel), "waiting section");
    const stage = () => S().stages.get(S().sel).top;
    const ask = seeded.notes.waitingDecision;
    const call = seeded.notes.waitingCalls;
    const rows = () => (stage().pane("waiting") as any).describe() as any[];
    await until(() => rows().some(r => r.block === ask.id), "the outline decision in waiting on you", 3000);
    expect(rows().find(r => r.block === ask.id)).toMatchObject({ kind: "decision", reason: "glass or shade cloth?", by: "garden-agent" });
    expect(rows().filter(r => r.block === call.id)).toMatchObject([{ kind: "call", line: 3, reason: "Choose the north wall" }]);
    expect(rows().some(r => r.kind === "proposal")).toBe(true);
    await app.act({ action: "host.waiting", as: "test-agent" });
    expect(app.drawer.tabs().some(t => t.kind === "waiting-you")).toBe(true);
    expect(JSON.stringify(app.describe())).toContain("glass or shade cloth?");
    const count = rows().length;
    expect(stage().pane("waiting").title()).toBe(`waiting on you · ${count}`);
    (app as any).paint();
    expect(plain(h.painted.at(-1) ?? "")).toContain(`?${rows().filter(r => ["decision", "proposal", "call"].includes(r.kind)).length}`);
    await stage().dispatch.press("tile.open", { kind: "detail", name: "ask-preview", note: seeded.notes.notebook.id }, "waiting");
    await stage().dispatch.press("tile.link", { to: "ask-preview", verb: "select" }, "waiting");
    await stage().dispatch.press("status.pick", { n: rows().find(r => r.block === ask.id).n }, "waiting");
    await until(() => stage().pane("ask-preview").msg?.id === ask.id, "decision previews");
    await stage().dispatch.press("tile.link", { to: "ask-preview", verb: "alt" }, "waiting");
    await stage().dispatch.press("ask.open", { n: rows().find(r => r.block === call.id).n, fresh: true }, "waiting");
    await until(() => stage().pane("ask-preview").msg?.id === call.id, "call opens through the alt wire");
    await until(() => stage().pane("ask-preview").surface.describe().focus?.line === 4, "call opens at its source line");
    const applicable = rows().find(r => r.kind === "proposal" && r.block !== seeded.race.proposal);
    await stage().dispatch.press("ask.proposal", { n: applicable.n, op: "apply" }, "waiting");
    await until(() => !rows().some(r => r.block === applicable.block), "applied proposal leaves the list");
    expect((await board.get(seeded.notes.remoteWrites.id))!.text).toContain("three bags");
    const fresh = await seedRace(board, await board.createBlock(null, RACE));
    await until(() => rows().some(r => r.block === fresh.race.proposal), "new proposal arrives live");
    const proposal = rows().find(r => r.block === fresh.race.proposal);
    await stage().dispatch.press("ask.proposal", { n: proposal.n, op: "dismiss" }, "waiting");
    await until(() => !rows().some(r => r.block === proposal.block), "dismissed proposal leaves the list");
    await stage().dispatch.press("ask.clear", { n: rows().find(r => r.block === ask.id).n }, "waiting");
    await until(() => !rows().some(r => r.block === ask.id), "cleared decision leaves the list");
    expect((await board.comments(ask.id)).some(c => JSON.stringify(c).includes("cleared by you"))).toBe(true);
    const current = (await board.get(call.id))!;
    await board.update(call.id, current.text.replace("- [ ] Choose", "- [x] Choose"), current.revision!);
    await until(() => !rows().some(r => r.block === call.id), "ticked call leaves the list");
    await stage().dispatch.press("tile.close", {}, "ask-preview");
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" });
  }, 20_000);

  test("held requests (PIE-888): an agent's @tidy line is listed after the programs and counted in the status bar; ⏎ opens its note, r sends it as the person, an agent's send is refused", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "status" }, as: "test-agent" });
    await until(() => marks.status!.every(m => screen().includes(m)), "the status section");
    const stage = () => S().stages.get(S().sel).top;
    const bar = () => { (app as any).paint(); return plain(h.painted.at(-1) ?? ""); };
    void app.heldAsks.seed(board);
    await until(() => app.heldAsks.count() === 1, "the held request", 8000);
    const held = () => (stage().pane("waiting").describe() as any[]).filter(r => r.kind === "held");
    expect(held()).toMatchObject([{ kind: "held", agent: "tidy", title: "Reply to the seed swap thread", why: "cap: “Showcase wake cap” is capped at 1/day, and it's used up today · r to send" }]);
    await until(() => bar().includes("‼1"), "the count in the status bar");
    await stage().dispatch.press("status.pick", { n: held()[0].n }, "waiting");
    await until(() => screen().includes("@tidy · Reply to"), "the row");
    // An agent opens it, never sends it.
    await expect(app.act({ action: "held.send", tile: "waiting", args: { id: held()[0].block }, as: "test-agent" })).rejects.toThrow("waits for a person");
    expect(app.heldAsks.count()).toBe(1);
    const request = held()[0];
    await stage().dispatch.press("tile.open", { kind: "detail", name: "held-preview", note: seeded.notes.notebook.id }, "waiting");
    await stage().dispatch.press("tile.link", { to: "held-preview", verb: "select" }, "waiting");
    await stage().dispatch.press("status.pick", { n: request.n }, "waiting");
    await until(() => stage().pane("held-preview").msg?.id === request.block, "held request selects into its preview");
    await stage().dispatch.press("tile.link", { to: "held-preview", verb: "alt" }, "waiting");
    await stage().dispatch.press("held.open", { id: request.block, fresh: true }, "waiting");
    expect(stage().pane("held-preview").msg?.id).toBe(request.block);
    // The person sends it (r on its row): its agent tidies the line, and the request leaves the list.
    await stage().dispatch.press("held.send", { id: held()[0].block }, "waiting");
    await until(() => app.heldAsks.count() === 0, "sent: nothing held", 15_000);
    expect(bar()).not.toContain("‼");
    app.heldAsks.stop();
  }, 60_000);


  test("the agent sessions section (PIE-737): fern in your drawer, moss docked here, the panel listing both; moving one keeps its process and its conversation", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "sessions" }, as: "test-agent" });
    await until(() => marks.sessions!.every(m => screen().includes(m)), "the agent sessions section");
    const rows = () => app.drawer.sessions().filter(s => s.program === "demo-agent");
    const of = (who: string) => rows().find(s => s.persona === who)!;
    await until(() => rows().length === 2, "both sessions", 8000);
    expect(of("fern").shown).toMatchObject({ in: "drawer" });
    expect(of("moss").shown).toMatchObject({ in: "screen", name: "moss", here: true });
    expect(of("moss").folder).toEndWith("potting-bench");
    expect(of("fern").folder).toEndWith("garden-shed");
    const listed = (await app.act({ action: "agents.list", args: {}, as: "test-agent" }) as any).sessions;
    expect(listed.filter((r: any) => r.program === "demo-agent").map((r: any) => [r.persona, r.how])).toEqual([["fern", "started"], ["moss", "started"]]);
    // A turn with moss, here.
    const moss = of("moss").pane, pid = moss.pid;
    await app.act({ action: "tile.type", tile: "moss", args: { text: "which bed for the leeks\\n" }, as: "test-agent" });
    await until(() => moss.text().join("\n").includes("moss · turn 1: which bed for the leeks"), "turn 1", 8000);
    // Into your drawer (a on its row): the same process, and the next turn is turn 2.
    await app.act({ action: "agents.drawer", args: { session: of("moss").id }, as: "test-agent" });
    expect(of("moss").shown).toMatchObject({ in: "drawer" });
    expect(of("moss").pane.pid).toBe(pid);
    await app.act({ action: "tile.type", tile: "moss", args: { text: "and the onions\\n" }, as: "test-agent" });
    await until(() => moss.text().join("\n").includes("moss · turn 2: and the onions"), "turn 2, in the drawer", 8000);
    // And back, docked here (d on its row).
    await app.act({ action: "agents.dock", args: { session: of("moss").id }, as: "test-agent" });
    expect(of("moss").shown).toMatchObject({ in: "screen", here: true });
    expect(of("moss").pane.pid).toBe(pid);
    // Jumping to one is the person's: an agent's is refused, nothing moved.
    await expect(app.act({ action: "agents.go", args: { session: of("fern").id }, as: "test-agent" })).rejects.toThrow();
  }, 30_000);


  test("the what-changed section (PIE-647): a scripted agent changes three notes and links a work item from a comment, a click opens the list in the drawer, a row opens its note, and the count clears", async () => {
    (app as any).lastInput = 0;
    app.whatChanged.markSeen();
    await app.act({ action: "section", args: { name: "changes" }, as: "test-agent" });
    await until(() => marks.changes!.every(m => screen().includes(m)), "the what-changed section");
    const stage = () => S().stages.get(S().sel).top;
    const bar = () => { (app as any).paint(); return plain(h.painted.at(-1) ?? ""); };
    await until(() => app.whatChanged.list().some(r => r.kind === "commented" && r.who === "garden-agent"), "the section agent finished");
    // A round more, after the person looked.
    app.whatChanged.markSeen();
    await gardenRound(board, seeded.notes);
    await until(() => app.whatChanged.count() === 4, "three notes and a comment counted", 8000);
    expect(bar()).toContain("+4 new");
    // The list on the stage: the three, who and what, titles read; an agent's read changes nothing of the person's.
    // (rows other tests' agents changed stay in the list, seen; the three logs are the unseen ones)
    const logs = () => stage().pane("changes").rows().filter((r: any) => !r.seen) as { blockId: string; title?: string }[];
    await until(() => { screen(); return logs().length === 4 && logs().every(r => r.title); }, "the rows with titles");
    const listed = await app.act({ action: "changes.list", args: {}, as: "test-agent" }) as any;
    expect(listed.changed.filter((r: any) => !r.seen).map((r: any) => [r.title, r.who, r.kind, r.seen]).sort()).toEqual([["Bean row log", "garden-agent", "edited", false], ["Compost bay log", "garden-agent", "edited", false], ["See HOME-042 for the plan.", "garden-agent", "commented", false], ["Shed door log", "garden-agent", "edited", false]]);
    expect(app.whatChanged.count()).toBe(4);
    // Looking at the list clears the count.
    const at = ((await app.dispatch.act({ action: "status.bar.items" }, { kind: "user" })) as { items: { id: string; from?: number }[] }).items.find(i => i.id === "new")!;
    expect(at).not.toBeNull();
    press({ kind: "mouse", action: "down", button: 0, x: at.from! + 1, y: 59 });
    press({ kind: "mouse", action: "up", button: 0, x: at.from! + 1, y: 59 });
    await until(() => app.drawer.tabs().some(t => t.kind === "what-changed"), "the list in the drawer", 5000);
    expect(app.drawer.open).toBe(true);
    expect(app.whatChanged.count()).toBe(0);
    expect(bar()).not.toContain("new");
    press({ kind: "char", ch: "]", ctrl: true });
    press({ kind: "alt", ch: "a" });
    await until(() => !app.drawer.open, "drawer put away");
    // The comment is readable by its label in the list, the reader and the power bar.
    const comment = stage().pane("changes").rows().find((r: any) => r.title === "See HOME-042 for the plan.");
    expect(comment).toBeDefined();
    await stage().dispatch.press("changes.go", { id: comment.blockId }, "changes");
    const reader = () => stage().pane("reader") as ReaderPane;
    await until(() => reader().msg?.id === comment.blockId && screen().includes("on Bean row log"), "the comment and its subject");
    expect(screen()).not.toContain(`((${seeded.notes.title.id}`);
    const barRows = await app.act({ action: "bar.open", args: { scope: "recent", query: "HOME-042" }, as: "test-agent" }) as any;
    expect(JSON.stringify(barRows)).toContain("See HOME-042 for the plan.");
    const link = () => (reader().surface.describeElements() as any[]).find(e => e.label.includes("HOME-042"));
    await until(() => { screen(); return !!link(); }, "the comment's outlink");
    await stage().dispatch.press("element.open", { n: link().n }, "reader");
    await until(() => reader().msg?.id === seeded.notes.title.id, "the linked work item");
    // The border count is the same picker as v and backlinks.groups.
    await stage().dispatch.press("backlinks", {}, "reader");
    await until(() => screen().includes(" sources"), "the links count");
    const lines = screen().split("\n"), y = lines.findIndex(l => /\d+ sources?/.test(l));
    const x = lines[y]!.search(/\d+ sources?/);
    press({ kind: "mouse", action: "down", button: 0, x: x + 1, y });
    press({ kind: "mouse", action: "up", button: 0, x: x + 1, y });
    await until(() => screen().includes("groups this tile lists"), "sources opens the group picker");
    press({ kind: "esc" });
    press({ kind: "esc" });
  }, 30_000);


  test("the ^W panel's own group (PIE-1338): with what changed focused, the panel lists its keys first, in the accent; a click on d shows the change, never ^W d", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "changes" }, as: "test-agent" });
    await until(() => marks.changes!.every(m => screen().includes(m)), "the what-changed section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    const list = () => stage().pane("changes") as WhatChangedPane;
    await until(() => { screen(); return list().rows().length > 0; }, "a change listed");
    if (S().focus !== "stage") press({ kind: "enter" });
    await stage().dispatch.act({ action: "tile.focus", tile: "changes" }, { kind: "user" });
    // An agent: the tile's group first, its keys from the kind's actions with what each runs; nothing on screen.
    const seen = await app.act({ action: "keys.panel", tile: undefined, as: "test-agent" }) as any;
    expect(seen.groups[0]).toMatchObject({ title: "this tile: changes", accent: true });
    expect(seen.groups[0].keys).toContainEqual({ key: "d", cap: "d", label: "the change", action: "changes.diff" });
    expect(seen.groups[1].title).toBe("focus & move");
    expect(screen()).not.toContain("this tile: changes");
    // The person: the panel, the tile's group at the top of its first column.
    await stage().dispatch.act({ action: "keys.panel" }, { kind: "user" });
    await until(() => screen().includes("this tile: changes"), "the panel with the tile's group");
    const rows = screen().split("\n"), title = rows.findIndex(l => l.includes("this tile: changes"));
    expect(rows[title]!.indexOf("this tile: changes")).toBeLessThan(rows[title]!.indexOf("focus & move"));
    // A click on d the change: the change under the selected row, as d in the tile does; ^W d (the dock) never runs.
    const y = rows.findIndex(l => /\bd  the change\b/.test(l));
    expect(y).toBeGreaterThan(title);
    const row = list().rows()[list().at]!;
    expect(list().showing(row)).toBe(false);
    const ran: string[] = [], stop = traceActions(r => ran.push(r.name));
    try {
      press({ kind: "mouse", action: "down", button: 0, x: rows[y]!.search(/\bd  the change\b/) + 1, y });
      await until(() => list().showing(row), "the change shown by a click on its row");
    } finally { stop(); }
    expect(ran).toContain("changes.diff");
    expect(ran).not.toContain("tile.slide");
    expect(screen()).not.toContain("this tile: changes");
    await stage().dispatch.press("changes.diff", {}, "changes");
    await until(() => !list().showing(row), "folded again");
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);

  test("the power bar section (PIE-656): the stage's tiles listed as their tree, the folded one a spine; ctrl+k then %pears and ⏎ opens it from its spine and gives it the keys; a pasted action line is the first row; an agent's bar.open answers and opens nothing; layout.move runs through its form (PIE-1031)", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "bar" }, as: "test-agent" });
    await until(() => marks.bar!.every(m => screen().includes(m)), "the power bar section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    await until(() => !!stage().tileOutline().find(t => t.name === "pears")?.collapsed, "the second detail folded");
    // An agent's: the rows, nothing opened.
    const r = await app.act({ action: "bar.open", args: { scope: "tiles" }, as: "test-agent" }) as any;
    const row = (name: string) => r.rows.find((x: any) => x.key.endsWith(`:${name}`));
    expect(row("outline").depth ?? 0).toBe(0);
    expect(row("reader").depth).toBe(1);
    expect(row("pears")).toMatchObject({ depth: 2, label: "Allotment notebook" });
    expect(row("pears").detail).toContain("a spine");
    expect((app as any).bar).toBeNull();
    // / with nothing typed: the notes changed most recently, newest first, none twice; typed, the one search finds a work item by its id.
    const recent = await app.act({ action: "bar.open", args: { scope: "notes" }, as: "test-agent" }) as any;
    expect(recent.rows.length).toBeGreaterThan(3);
    expect(new Set(recent.rows.map((x: any) => x.key)).size).toBe(recent.rows.length);
    const byId = await app.act({ action: "bar.open", args: { scope: "notes", query: "PLOT-4" }, as: "test-agent" }) as any;
    expect(byId.rows[0].label).toMatch(/^PLOT-4 .*Order the seed potatoes/);
    // The person's: ctrl+k, %pears, ⏎.
    press({ kind: "char", ch: "k", ctrl: true });
    for (const c of "%pears") press({ kind: "char", ch: c });
    expect((app as any).bar.describe()).toMatchObject({ scope: "tiles", query: "pears" });
    press({ kind: "enter" });
    await until(() => { const t = stage().tileOutline().find(x => x.name === "pears")!; return !t.collapsed && t.focused; }, "pears opened and given the keys");
    expect((app as any).bar).toBeNull();
    // An action line pasted, its arguments and quotes whole (PIE-856): the first row, ⏎ would run it as typed.
    press({ kind: "char", ch: "k", ctrl: true });
    press({ kind: "paste", text: 'tile.open kind=query query="#seeds"' });
    expect((app as any).bar.describe().rows[0]).toMatchObject({ source: "actions", label: "run tile.open kind=query query=#seeds" });
    press({ kind: "esc" });
    expect((app as any).bar.describe().query).toBe("");
    press({ kind: "esc" });
    expect((app as any).bar).toBeNull();
    await app.dispatch.press("bar.open", { query: "tile.colapse tile=reader on=true direction=h" });
    expect((app as any).bar.describe().rows[0]).toMatchObject({ label: "run tile.collapse tile=reader on=true dir=h" });
    await app.dispatch.press("bar.pick");
    expect((app as any).bar.describe().runs.at(-1)).toMatchObject({ line: "tile.collapse tile=reader on=true dir=h", refused: false });
    expect(stage().tileOutline().find(t => t.name === "reader")?.collapsed).toBe(true);
    const button = await app.dispatch.press("bar.command", { op: "button" }) as { text: string };
    expect(button.text).toContain('act="tile.collapse tile=reader on=true dir=h"');
    await app.dispatch.press("bar.close");
    await stage().dispatch.press("tile.collapse", { on: false }, "reader");
    // layout.move through its form (PIE-1031): ⏎ on the action opens it, a field each; the tile fields list the stage's
    // tiles, where= its choices; the act line under them runs as the person.
    press({ kind: "char", ch: "k", ctrl: true });
    for (const c of ">layout.move") press({ kind: "char", ch: c });
    press({ kind: "enter" });
    await until(() => (app as any).bar?.describe().form?.action === "layout.move", "layout.move's form");
    const form = () => (app as any).bar.describe().form;
    expect(form().fields.map((f: any) => f.name).slice(0, 3)).toEqual(["tile", "to", "where"]);
    await (app as any).bar.settled();
    expect((app as any).bar.describe().rows.some((r: any) => r.key === "answer:shed")).toBe(true);
    for (const c of "shed") press({ kind: "char", ch: c });
    await until(() => (app as any).bar.describe().rows[0]?.key === "answer:shed", "shed offered first");
    press({ kind: "enter" });
    await until(() => form()?.focus === "to", "on to to=");
    await app.dispatch.press("bar.form", { op: "set", field: "to", value: "reader" });
    await app.dispatch.press("bar.form", { op: "set", field: "where", value: "tabs" });
    expect(form().line).toBe("layout.move tile=shed to=reader where=tabs");
    await app.dispatch.press("bar.form", { op: "run" });
    await until(() => !!stage().tileOutline().find(t => t.name === "shed")?.tab, "shed in the reader's tabs");
    expect((app as any).bar).toBeNull();
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);


  test("the ^W keys section (PIE-704): ^W lists the grouped keys once; ? opens the whole list on the bar; typing finds a key and ⏎ presses it; an agent's bar.open answers the same rows", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "wkeys" }, as: "test-agent" });
    await until(() => marks.wkeys!.every(m => screen().includes(m)), "the ^W keys section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    if (S().focus !== "stage") press({ kind: "enter" });
    const r = await app.act({ action: "bar.open", args: { scope: "actions", query: "^W " }, as: "test-agent" }) as any;
    expect(r.rows.some((x: any) => x.keycap === "ctrl+w G" && x.group === "mounts & groups")).toBe(true);
    expect((app as any).bar).toBeNull();
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "?" });
    await until(() => (app as any).bar?.describe().scope === "actions", "the ^W list opened");
    for (const c of "float") press({ kind: "char", ch: c });
    await until(() => (app as any).bar.describe().rows[0]?.keycap === "ctrl+w f", "float found by its letters");
    press({ kind: "enter" });
    await until(() => stage().layoutGet().floats.length === 1, "the tile floated by the list");
    expect((app as any).bar).toBeNull();
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "f" });
    await until(() => stage().layoutGet().floats.length === 0, "put back by its key");
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);


  test("the ^W panel (PIE-1304): keys.panel opens every key grouped; a click on a row runs it; an agent's answers the groups and nothing moves", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "wkeys" }, as: "test-agent" });
    await until(() => marks.wkeys!.every(m => screen().includes(m)), "the ^W keys section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    if (S().focus !== "stage") press({ kind: "enter" });
    // An agent: the groups, in the actions' own words; nothing on screen.
    const seen = await app.act({ action: "keys.panel", tile: undefined, as: "test-agent" }) as any;
    expect(seen.groups.map((g: any) => g.title)).toContain("mounts & groups");
    expect(seen.groups.flatMap((g: any) => g.keys).find((k: any) => k.key === "a").label).toBe("put in your drawer, or take out");
    expect(screen()).not.toContain("tile keys");
    // The person: open at once, every group shown.
    await stage().dispatch.act({ action: "keys.panel" }, { kind: "user" });
    await until(() => screen().includes("tile keys"), "the panel");
    for (const g of ["focus & move", "size & shape", "mounts & groups", "layouts & more"]) expect(screen()).toContain(g);
    // A click on the float row is ^W f.
    const rows = screen().split("\n"), y = rows.findIndex(l => /\bf +float\b/.test(l));
    expect(y).toBeGreaterThan(0);
    press({ kind: "mouse", action: "down", button: 0, x: rows[y]!.search(/\bf +float\b/) + 1, y });
    await until(() => stage().layoutGet().floats.length === 1, "floated by a click on its row");
    expect(screen()).not.toContain("tile keys");
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "f" });
    await until(() => stage().layoutGet().floats.length === 0, "put back by its key");
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);

  test("the one line field section (PIE-1290): the rename prompt types, selects with the mouse, deletes, undoes and erases a word, and enter keeps it", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "line-field" }, as: "test-agent" });
    await until(() => marks["line-field"]!.every(m => screen().includes(m)), "the line field section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    if (S().focus !== "stage") press({ kind: "enter" });
    await stage().dispatch.act({ action: "tile.title", tile: "reader" }, { kind: "user" });
    await until(() => screen().includes("keeps it, typing replaces it"), "the rename prompt, prefilled");
    for (const c of "Seed trays for spring") press({ kind: "char", ch: c });
    await until(() => screen().includes("Seed trays for spring"), "typed");
    const rows = screen().split("\n"), y = rows.findIndex(l => l.includes("Seed trays for spring")), x = rows[y]!.indexOf("trays ");
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x + 6, y });
    press({ kind: "mouse", action: "up", button: 0, x: x + 6, y });
    press({ kind: "backspace" });
    await until(() => screen().includes("Seed for spring"), "the phrase deleted");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => screen().includes("Seed trays for spring"), "undone");
    // Undo puts the cursor where the change was, as the note editor's does: end, then ctrl+w.
    press({ kind: "end" });
    press({ kind: "char", ch: "w", ctrl: true });
    await until(() => screen().includes("Seed trays for ") && !screen().includes("for spring"), "a word erased, not the ^W chord");
    expect((stage() as any).prefix).toBe("");
    press({ kind: "enter" });
    await until(() => stage().layoutGet().tiles.some(t => (t.title ?? "").includes("Seed trays for")), "renamed");
    if (S().focus === "stage") press({ kind: "esc" });
  }, 30_000);

  test("the agent policy section (PIE-639): free, edit only and hands off tiles; an agent's open is refused or lands, its edit of the middle note goes through, peek says the limits, the person's keys are never limited", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "agents" }, as: "test-agent" });
    await until(() => marks.agents!.every(m => screen().includes(m)), `the agents section: ${marks.agents!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const recipe = seeded.notes.recipe.id;
    // Peek says the limits before an agent acts.
    const seen = JSON.stringify(stage().describe());
    expect(stage().describe().agentLimits).toContainEqual(expect.objectContaining({ name: "edit", level: "edit" }));
    expect(seen).toContain('"level":"off"');
    // Saved with the layout: the edit tile's own level in its spec.
    expect(JSON.stringify(stage().layoutSpec())).toContain('"agents":"edit"');
    // Refused, naming the policy and the person's command; nothing moved.
    await expect(app.act({ action: "open", tile: "edit", args: { id: recipe }, as: "test-agent" })).rejects.toThrow(/edit is edit only for agents: open is refused .*tile\.agent policy=free tile=edit/);
    await expect(app.act({ action: "open", tile: "off", args: { id: recipe }, as: "test-agent" })).rejects.toThrow(/off is hands off for agents: open is refused · peek reads it/);
    await expect(app.act({ action: "tile.close", tile: "edit", as: "test-agent" })).rejects.toThrow(/tile\.close is refused/);
    expect(stage().pane("edit").msg.title ?? stage().pane("edit").title()).not.toContain("Lentil");
    // An open that names no tile lands in a free tile, never the limited ones.
    const landed = await app.act({ action: "open", args: { id: recipe }, as: "test-agent" }) as any;
    expect(landed.name).toBe("free");
    expect(stage().pane("edit").msg.id).toBe(seeded.notes.errand.id);
    expect(stage().pane("off").msg.id).toBe(seeded.notes.shed.id);
    // The edit tile's note can be edited by an agent (its draft closed again at once); the hands-off tile's cannot.
    await app.act({ action: "edit.text", tile: "edit", args: { text: "Seed order for the plot\n\nTea, and two packets of beans." }, as: "test-agent" });
    expect(stage().pane("edit").surface.draft.text).toContain("two packets of beans");
    await stage().dispatch.press("edit.close", { discard: true }, "edit");
    await expect(app.act({ action: "edit.text", tile: "off", args: { text: "x" }, as: "test-agent" })).rejects.toThrow(/off is hands off for agents/);
    // An agent may tighten a free tile, never loosen a limited one.
    await app.act({ action: "tile.agent", tile: "free", args: { policy: "edit" }, as: "test-agent" });
    await expect(app.act({ action: "tile.agent", tile: "free", args: { policy: "free" }, as: "test-agent" })).rejects.toThrow(/edit only for agents/);
    await app.act({ action: "tile.agent", tile: "free", args: { policy: "off" }, as: "test-agent" });   // edit to off: through the dispatcher
    expect(stage().agentNow("free").level).toBe("off");
    await expect(app.act({ action: "tile.agent", tile: "free", args: { policy: "edit" }, as: "test-agent" })).rejects.toThrow(/hands off for agents: loosening its own limit is refused/);
    await stage().dispatch.press("tile.agent", { policy: "inherit" }, "free");
    // The person's own keys are never limited: they open into the hands-off tile, and free it by action.
    await stage().dispatch.press("open", { id: recipe }, "off");
    await until(() => stage().pane("off").msg?.id === recipe, "the person's open in the hands-off tile");
    await stage().dispatch.press("tile.agent", { policy: "free" }, "off");
    await app.act({ action: "open", tile: "off", args: { id: seeded.notes.shed.id }, as: "test-agent" });
    // ^W g cycles the focused tile; a click on its chip does too.
    await stage().dispatch.press("tile.focus", {}, "free");
    press({ kind: "enter" });
    press({ kind: "char", ch: "w", ctrl: true });
    press({ kind: "char", ch: "g" });
    expect(stage().agentNow("free")).toMatchObject({ level: "edit" });
    await stage().dispatch.press("tile.agent", { policy: "inherit" }, "free");
    // A click on the chip does the same (edit only to hands off), the keys staying where they are.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("* agents: edit only"));
    expect(y).toBeGreaterThan(0);
    const x = rows[y]!.indexOf("agents: edit only") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => stage().agentNow("edit").level === "off", "the chip's click");
    press({ kind: "esc" });
  }, 30_000);
  test("drawer home: close the last tile and make a note with its button (PIE-1119)", async () => {
    const { app, screen, press } = h;
    await app.press("section.leave");
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await app.dispatch.act({ action: "host.toggle", args: { open: true } }, { kind: "user" });
    screen();
    const drawer = app.drawer.desk!;
    if (drawer.overlaid()) press({ kind: "esc" });
    for (const t of [...app.drawer.tabs()]) {
      const close = () => drawer.dispatch.act({ action: "tile.close", tile: t.name }, { kind: "user" });
      try { await close(); } catch (e) { if (!(e as Error).message.includes("closing ends it")) throw e; await close(); }
    }
    // One more close on the empty home says so in words, not "no tile undefined".
    await expect(drawer.dispatch.act({ action: "tile.close" }, { kind: "user" })).rejects.toThrow(/this screen is empty · ctrl\+n a note/);
    (app as any).paint();
    const rows = h.painted.map(plain);
    const y = rows.findIndex(l => l.includes("[New note]"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = rows[y]!.indexOf("[New note]") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => app.drawer.tabs().some(t => !!(drawer.pane(t.name) as ReaderPane)?.surface?.draft), "a draft from the home button");
    const t = app.drawer.tabs().find(t => (drawer.pane(t.name) as ReaderPane)?.surface?.draft)!;
    await drawer.dispatch.act({ action: "edit.text", tile: t.name, args: { text: "The home button kept this note" } }, { kind: "user" });
    await drawer.dispatch.act({ action: "edit.save", tile: t.name }, { kind: "user" });
    expect((drawer.pane(t.name) as ReaderPane).msg?.text).toBe("The home button kept this note");
    await drawer.dispatch.act({ action: "edit.close", tile: t.name }, { kind: "user" });
    await app.dispatch.act({ action: "host.toggle", args: { open: false } }, { kind: "user" });
  }, 20_000);



});

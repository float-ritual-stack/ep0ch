// PIE-439: the showcase screen, lists: trash, links, tags, threads, questions and dates. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import { seedDay, SOCIETY_LINKED_BACK, SOCIETY_NOTES, type Seeded } from "../../src/showcase/seed";
import { SECTIONS, Showcase } from "../../src/showcase/showcase";
import { SocketBoard } from "../../src/socket";
import { drawNote } from "../../src/notes-cli";
import { makeTile } from "../../src/desk/tiles";
import { outliner, Scratch, until } from "../scratch";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};


const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

import { useShowcaseScreen } from "./harness";
import { marks } from "./marks";

describe.skipIf(!outliner)("the showcase screen: lists: trash, links, tags, threads, questions and dates", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


  test("inline lists: act selects a result beyond the first box of the 60-row demo", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "inline-lists" }, as: "test-agent" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "inline-lists")).top; };
    await until(() => screen().includes("Parcel 01"), "the parcel list");
    const desk = stage();
    const elements = await desk.dispatch.act({ action: "elements", tile: "parcels" }, { kind: "user" }) as any;
    const first = elements.elements.find((e: any) => e.list);
    await desk.dispatch.act({ action: "element.select", tile: "parcels", args: { n: first.n, row: 45 } }, { kind: "user" });
    await until(() => screen().includes("Parcel 45"), "row 45 revealed inside the box");
    expect(screen()).not.toContain("Parcel 01");
    expect(screen()).toContain("After the list:");
  });

  test("focus rows (PIE-999): the outline marker follows the keys while the figures stay held", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "focus" }, as: "test-agent" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "focus")).top; };
    await until(() => screen().includes("Workspace") && screen().includes("Figures"), "the focus exhibits");
    press({ kind: "enter" });
    ch("3"); ch("j");
    await until(() => screen().includes("▌▸ Trash"), "the marker on the next outline row");
    const tiles = stage().layoutGet().tiles;
    expect(tiles.find((t: any) => t.name === "figures").showing.id).toBe(seeded.notes.markdownFigures.id);
    expect(tiles.find((t: any) => t.name === "reader").showing.id).toBe(seeded.notes.keys.id);
    press({ kind: "esc" });
  });

  test("trash (PIE-878): d says what would go, d again trashes the heap and its notes under it, ctrl+z brings them back; the links list's row alone; an agent says confirm=", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "trash" }, as: "test-agent" })).toMatchObject({ key: "trash" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "trash")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const heap = seeded.notes.heap, deleted = async (id: string) => !!(await board.get(id))?.deleted;
    await until(() => tiles().find(t => t.name === "detail")?.showing?.id === heap.id && (tiles().find(t => t.name === "links")?.backlinks?.rows ?? []).filter((r: any) => r.id).length >= 2, "the heap and the notes under it", 8000);
    // The person: into the stage, d shows what goes, d trashes it, ctrl+z brings it back.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("d");
    await until(() => screen().includes("trash “Compost heap”?") && screen().includes("trash it and the 2 notes under it"), "the choice, with the notes under it");
    ch("d");
    await until(() => String((app as any).message).includes("trashed “Compost heap” and the 2 notes under it"), "trashed, said");
    expect(await deleted(heap.id)).toBe(true);
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => String((app as any).message).includes("brought back “Compost heap”"), "brought back, said");
    expect(await deleted(heap.id)).toBe(false);
    // An agent names the list's row (a note under the heap) and says it twice; its undo is its own.
    const lid = (await board.children(heap.id)).find(m => m.text.startsWith("Lid"))!;
    // The restore receipt precedes the links tile's subscription refresh.
    await until(() => tiles().find(t => t.name === "links").backlinks.rows.some((r: { id?: string }) => r.id === lid.id), "the restored lid in the links tile");
    await expect(app.act({ action: "note.trash", tile: "links", args: { ref: lid.id }, as: "test-agent" })).rejects.toThrow("confirm=");
    expect(await app.act({ action: "note.trash", tile: "links", args: { ref: lid.id, confirm: lid.id }, as: "test-agent" })).toMatchObject({ trashed: lid.id, recordedAs: "agent test-agent" });
    expect(await deleted(lid.id)).toBe(true);
    expect(await app.act({ action: "note.untrash", tile: "links", as: "test-agent" })).toMatchObject({ restored: lid.id });
    expect(await deleted(lid.id)).toBe(false);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);


  test("links-open (PIE-646): a detail, its links tile and a preview: the preview follows the pick, ⏎ opens it in the detail, alt+⏎ in a new detail", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "links-open" }, as: "test-agent" })).toMatchObject({ key: "links-open" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "links-open")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const shows = (name: string) => tiles().find(t => t.name === name)?.showing?.id;
    await until(() => shows("detail") === seeded.notes.shed.id && tiles().find(t => t.name === "backlinks")?.backlinks?.rows?.some((r: any) => r.id), "the shed and its links", 8000);
    const rows = tiles().find(t => t.name === "backlinks").backlinks.rows as { n: number; id?: string }[];
    const first = rows.find(r => r.id && r.id !== seeded.notes.shed.id)!;
    // The header's controls narrow all three groups, and the counters say which; the controls keep their cells.
    const links = () => tiles().find(t => t.name === "backlinks").backlinks;
    const cellOf = (what: string) => { const ls = screen().split("\n"), y = ls.findIndex(l => l.includes(what)); return [y, y < 0 ? -1 : ls[y]!.indexOf(what)]; };
    const sortAt = cellOf("Sort: ");
    expect(links().status).toMatch(/^\d+ of \d+ match · →\d+\/\d+ ♦\d+\/\d+ ←\d+\/\d+/);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { stage: "open", sort: "title" }, as: "test-agent" });
    expect(links().status).toContain("Stage: open · Sort: Title");
    expect(cellOf("Sort: ")).toEqual(sortAt);
    await app.act({ action: "backlinks.view", tile: "backlinks", args: { stage: "all", sort: "updated-desc" }, as: "test-agent" });
    // A pick previews; the detail keeps the shed.
    await app.act({ action: "backlinks.pick", tile: "backlinks", args: { n: first.n }, as: "test-agent" });
    await until(() => shows("preview") === first.id, "the preview following the pick", 5000);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // alt+⏎ is a new detail beside the first, which keeps its note.
    const before = tiles().length;
    await app.act({ action: "backlinks.open", tile: "backlinks", args: { n: first.n, where: "new" }, as: "test-agent" });
    await until(() => tiles().length === before + 1, "a new detail", 5000);
    expect(tiles().find(t => t.kind === "reader" && t.mode === "held" && t.name !== "detail")?.showing?.id).toBe(first.id);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // ⏎ opens it in the list's home, the detail; the list keeps the shed's links (PIE-794).
    await app.act({ action: "backlinks.open", tile: "backlinks", args: { n: first.n }, as: "test-agent" });
    await until(() => shows("detail") === first.id, "⏎: the detail holds it", 5000);
    expect(links().target.id).toBe(seeded.notes.shed.id);
    // PIE-884: the row said which line links here (a quote of it), and the detail it opened marks that line.
    expect(screen()).toContain("“");
    // (an agent's open never marks the reader the person is in; the person's does)
    const other = rows.find(r => r.id && r.id !== seeded.notes.shed.id && r.id !== first.id)!;
    await stage().dispatch.act({ action: "backlinks.open", tile: "backlinks", args: { n: other.n } }, { kind: "user" });
    await until(() => shows("detail") === other.id, "the person's open: the detail holds the other source", 5000);
    await until(() => (stage().pane("detail") as any).surface.focusMark?.line === true, "the linking line marked in the opened note", 5000);
    expect(S().focus).toBe("index");
  }, 20_000);


  test("tree-views (PIE-882): the saved view opens in the tree with its matches, D sets how far they open, and an agent can too", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "tree-views" }, as: "test-agent" })).toMatchObject({ key: "tree-views" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "tree-views")).top; };
    const tree = () => stage().panes.get([...stage().panes.keys()].find((k: number) => stage().panes.get(k).kind === "tree")) as any;
    await until(() => tree()?.describe().rows.some((r: any) => r.role === "results"), "the view's matches in the tree", 8000);
    const rows = () => tree().describe().rows as any[];
    const matches = rows().filter(r => r.match);
    expect(matches.length).toBeGreaterThan(0);
    expect(matches.every(r => r.matchOf === seeded.notes.gardenView.id)).toBe(true);
    const out = await app.act({ action: "tree.depth", tile: "tree", args: { id: seeded.notes.gardenView.id, depth: "0" }, as: "test-agent" }) as any;
    expect(out).toMatchObject({ view: seeded.notes.gardenView.id, depth: 0, authored: false });
    await until(() => rows().some(r => r.role === "results" && r.text.includes("results only")), "results only");
  }, 60_000);


  test("lists-open (PIE-794): an inline row selects and previews; a double click replaces the held detail's note, and only it; alt+r shows it in the outline; alt+click opens a detail beside", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "lists-open" }, as: "test-agent" })).toMatchObject({ key: "lists-open" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "lists-open")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const shows = (name: string) => tiles().find(t => t.name === name)?.showing?.id;
    const detail = () => stage().pane("detail") as any;
    const tree = () => stage().pane("tree") as any;
    const person = (action: string, args: Record<string, unknown> = {}, tile = "detail") => stage().dispatch.act({ action, tile, args }, { kind: "user" });
    const rows = () => (detail()?.surface.linkBlocksDrawn[0]?.rows ?? []).filter((r: any) => r.id && r.id !== seeded.notes.shed.id);
    await until(() => shows("detail") === seeded.notes.shed.id && rows().length > 0, "the shed held, its own ::links drawn", 8000);
    const row = rows()[0], n = detail().surface.linkBlocksDrawn[0].rows.findIndex((r: any) => r.key === row.key) + 1;
    await tree().loaded;
    const treeWas = tree().selected()?.id ?? null;
    // A pick (a click, j k inside it) selects the row, and the preview of the detail's selection follows; nothing else moves.
    await person("links.pick", { n });
    await until(() => shows("preview") === row.id, "the preview following the row", 5000);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // ⏎ (a double click) replaces the held detail's note, kept in its history; the outline and the current note stay.
    await person("links.open", { n });
    await until(() => shows("detail") === row.id, "the detail holds the row's note", 5000);
    expect(tiles().find(t => t.name === "detail").mode).toBe("held");
    expect(tree().selected()?.id ?? null).toBe(treeWas);
    expect(stage().current?.id ?? null).not.toBe(row.id);
    // alt+r, or a click on the crumbs: the outline's cursor goes to it. An agent's is refused: the cursor is the person's.
    await expect(app.act({ action: "reader.reveal", tile: "detail", as: "test-agent" })).rejects.toThrow(/person/);
    await person("reader.reveal");
    await until(() => tree().selected()?.id === row.id, "the outline on the detail's note", 5000);
    expect(shows("detail")).toBe(row.id);
    // Back to the shed; alt+⏎ on the row opens a new held detail beside it, which keeps its own note.
    await person("back");
    await until(() => shows("detail") === seeded.notes.shed.id, "back on the shed", 5000);
    const before = tiles().length;
    await until(() => rows().length > 0, "the shed's rows again", 5000);
    await person("links.open", { n, where: "new" });
    await until(() => tiles().length === before + 1, "a new detail beside", 5000);
    expect(tiles().find(t => t.kind === "reader" && t.mode === "held" && t.name !== "detail")?.showing?.id).toBe(row.id);
    expect(shows("detail")).toBe(seeded.notes.shed.id);
    // Growth by room: another detail beside the new one, and another; past a readable width the earlier ones (never the
    // first) fold to spines, said; nothing closes.
    const made = () => tiles().filter(t => t.kind === "reader" && t.mode === "held").map(t => t.name as string);
    for (let i = 0; i < 2; i++) {
      const last = made().at(-1)!;
      stage().setCurrent(seeded.notes.notebook, { from: stage().pane(last), link: true, fresh: true });
    }
    await until(() => made().length === 4, "four details", 5000);
    const spines = () => tiles().filter(t => t.collapsed).map(t => t.name as string);
    expect(spines().length).toBeGreaterThan(0);
    expect(spines()).not.toContain("detail");
    // A spine's × closes it without opening it (tile.close, as ^W x).
    const gone = spines()[0]!;
    const closes = () => { screen(); const st = stage() as any; return st.closeButtons.find((c: any) => c.id === st.idNamed(gone)); };
    await until(() => !!closes(), "the spine's ×", 5000);
    await stage().dispatch.act({ action: "tile.close", tile: gone }, { kind: "user" });
    expect(made()).not.toContain(gone);
    expect(S().focus).toBe("index");
  }, 30_000);


  test("tags (PIE-800): a #tag is a link; opening it lists the notes carrying it beside the reader, nested tags too; the list previews, ⏎ replaces the reader's note, alt+⏎ opens beside", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "tags" }, as: "test-agent" })).toMatchObject({ key: "tags" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "tags")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const shows = (name: string) => tiles().find(t => t.name === name)?.showing?.id;
    const detail = () => stage().pane("detail") as any;
    const person = (action: string, args: Record<string, unknown> = {}, tile = "detail") => stage().dispatch.act({ action, tile, args }, { kind: "user" });
    const tagElem = (tag: string) => (detail().surface.describeElements() as any[]).find(e => e.label === `#${tag}` || e.label?.includes(`#${tag}`));
    await until(() => shows("detail") === seeded.notes.frost.id && !!tagElem("frost-jobs"), "the frost note, its #tags as links", 8000);
    // Opening the tag (⏎ on it, a click) lists every note carrying it (a nested tag's too, and this note) below the detail.
    await person("element.open", { n: tagElem("frost-jobs").n });
    const list = () => tiles().find(t => t.kind === "query");
    await until(() => (list()?.query ?? "") === "#frost-jobs" && (list()?.cards?.length ?? 0) === 4, "the frost jobs listed", 8000);
    expect(list().cards.map((c: any) => c.title).sort()).toEqual(["Before the first frost", "Fleece over the brassicas", "Lag the standpipe", "Lift the dahlias"]);
    expect(list().home).toBe("detail");
    const L = list().name as string, P = tiles().find(t => t.kind === "preview")?.name as string;
    const job = list().cards.findIndex((c: any) => c.title === "Lag the standpipe") + 1, lag = list().cards[job - 1].id;
    // A pick previews (the detail keeps its note); ⏎ replaces the detail's note, kept in its history.
    const pick = (args: Record<string, unknown>) => person("query.pick", args, L);
    await pick({ n: job });
    await until(() => shows(P) === lag, "the preview following the pick", 5000);
    expect(shows("detail")).toBe(seeded.notes.frost.id);
    await pick({ n: job, open: true });
    await until(() => shows("detail") === lag, "⏎: the detail holds it", 5000);
    expect(tiles().find(t => t.name === "detail").mode).toBe("held");
    // alt+⏎: a new detail beside the home, which keeps its note.
    const before = tiles().length;
    await pick({ n: job, fresh: true });
    await until(() => tiles().length === before + 1, "a new detail", 5000);
    expect(shows("detail")).toBe(lag);
    // Back on the frost note, #compost asks the same list for the other tag.
    await person("back");
    await until(() => shows("detail") === seeded.notes.frost.id && !!tagElem("compost"), "back on the frost note", 5000);
    await person("element.open", { n: tagElem("compost").n });
    await until(() => list()?.query === "#compost" && list()?.cards?.length === 2, "the compost list", 5000);
    expect(tiles().filter(t => t.kind === "query")).toHaveLength(1);
    // An agent opening a tag there is answered the notes; the person's list keeps its tag and selection.
    const sel = list().selected?.id;
    const out = await app.act({ action: "element.open", tile: "detail", args: { n: tagElem("frost-jobs").n }, as: "test-agent" }).catch((e: Error) => ({ refused: e.message })) as any;
    expect(out.refused).toBeUndefined();
    // Its answer is the notes carrying the tag.
    expect(out).toMatchObject({ query: "#frost-jobs" });
    expect(out.notes.map((x: any) => x.title)).toContain("Lag the standpipe");
    expect(list().query).toBe("#compost");
    expect(list().selected?.id).toBe(sel);
    // The list saves with the screen as written: its query and its home.
    expect(JSON.stringify(stage().saved())).toContain(`"query":"#compost","source":"tile:detail"`);
    // Held (PIE-855: p, its ○, the menu), it keeps #compost and the next tag opens a list of its own; ⏎ still lands in the detail.
    expect(await person("tile.hold", {}, L)).toMatchObject({ tile: L, held: true });
    expect(list().held).toBe(true);
    await person("element.open", { n: tagElem("frost-jobs").n });
    const lists = () => tiles().filter(t => t.kind === "query");
    await until(() => lists().length === 2 && lists().some(t => t.query === "#frost-jobs" && t.cards?.length === 4), "a second list for #frost-jobs", 8000);
    const held = lists().find(t => t.name === L);
    expect(held).toMatchObject({ query: "#compost", held: true, home: "detail" });
    expect(held.cards).toHaveLength(2);
    // Let go while the new one is the detail's list: refused, with what to do.
    await expect(person("tile.hold", { on: false }, L)).rejects.toThrow(/is detail's list now: close it or hold it/);
    expect(JSON.stringify(stage().saved())).toContain(`"query":"#compost","source":"tile:detail","mode":"held"`);
    // A restarted door makes it from that save still held.
    expect((makeTile({ kind: "query", query: "#compost", source: "tile:detail", mode: "held" }) as any).held).toBe(true);
    const heldCard = held.cards.find((c: any) => c.title === "Lift the dahlias");
    await pick({ id: heldCard.id, open: true });
    await until(() => shows("detail") === heldCard.id, "⏎ in the held list opens in the detail", 5000);
    // What each list follows and where its opens land, in plain words (PIE-855): tile.info for an agent, ^W P's rows for the person.
    const L2 = lists().find(t => t.name !== L).name as string;
    expect(await app.act({ action: "tile.info", tile: L2, as: "test-agent" })).toMatchObject({ follows: "the #tags opened in detail", opens: expect.stringMatching(/^detail, its reader/) });
    expect(await app.act({ action: "tile.info", tile: L, as: "test-agent" })).toMatchObject({ follows: expect.stringMatching(/^nothing: held on its tag/) });
    // The following list's header says ◄ detail; a click on it opens ^W P at its follows row, and the unlink row holds it.
    const rows = () => sc.render(app).lines.map(plain);
    const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
    const mark = () => { const r = rows(), y = r.findIndex(l => l.includes("#frost-jobs") && l.includes("◄ deta")); return { y, x: y >= 0 ? r[y]!.indexOf("◄ deta") : -1 }; };
    await until(() => mark().y >= 0, "◄ detail on the following list's header", 5000);
    click(mark().x + 1, mark().y);
    const panel = () => stage().overlays.top();
    await until(() => panel()?.name === "policy", "^W P from the ◄ mark", 5000);
    expect(panel().items[panel().sel].label).toBe(`${L2} follows: the #tags opened in detail`);
    expect(rows().join("\n")).toContain("⏎ opens in: detail");
    press({ kind: "char", ch: "j" }); press({ kind: "enter" });
    await until(() => lists().find(t => t.name === L2)?.held === true, "unlinked from the panel: held", 5000);
    expect(panel().items[0].label).toMatch(new RegExp(`^${L2} follows: nothing: held on its tag`));
    // Opens into: ⏎ picks the tile its opens land in (tile.link), and a row unlinks it again.
    const opens = () => panel().items.findIndex((r: any) => r.wire === "open");
    panel().sel = opens(); press({ kind: "enter" });
    await until(() => !!stage().linkingFrom(), "pick the open target on screen", 5000);
    rows();
    const previewRect = tiles().find(t => t.name === P).rect, origin = S().stageRect;
    click(origin.col + previewRect.col + 3, origin.row + previewRect.row + 3);
    await until(() => tiles().find(t => t.name === L2)?.link === P, `${L2} linked to ${P}`, 5000);
    await person("tile.focus", {}, L2);
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "P" });
    rows();
    panel().sel = opens(); press({ kind: "char", ch: "x" });
    await until(() => tiles().find(t => t.name === L2)?.link === "detail", "unlinked: opens use the reader again", 5000);
    press({ kind: "esc" });
    expect(stage().overlays.top()?.name).not.toBe("policy");
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 30_000);


  test("thread (PIE-944): the panel draws the thread as a tree around the note; a click only selects, a second opens, ⏎ on a fold shows its posts", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "thread" } })).toMatchObject({ key: "thread" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "thread")).top; };
    const reader = () => (stage().layoutGet().tiles as any[]).find(t => t.name === "reader");
    const rows = () => (reader()?.threadPanel?.rows ?? []) as { n: number; text: string; context?: string; selected?: boolean; id?: string }[];
    await until(() => reader()?.showing?.id === seeded.notes.threadHere.id && rows().length > 5, "the thread panel on the reply three deep ", 8000);
    // The root, the chain to the note, the posts beside each (folded around the chain at the busy level), the note marked, its replies.
    expect(rows().map(r => r.text)).toEqual([
      "Who has spare leek seedlings?", "2 more earlier", "Dee: the garden centre has them", "Eli: not this year, sorry", "Fay: I can bring some on Saturday",
      "Ana: how many do you need?", "Ben: mine are still in modules", "Fay: no rush, Saturday is fine", "Ana: I'll hold a dozen back", "Gus: try the seed swap", "Hal: mine bolted", "1 more later",
    ]);
    const here = rows().find(r => r.selected)!;
    expect(here.text).toBe("Ben: mine are still in modules");
    expect(here.context).toMatch(/^you are here · .+ · \d/);
    // A click selects the row, and only that: the reader stays where it was.
    const n = rows().findIndex(r => r.text === "Eli: not this year, sorry") + 1;
    await (stage() as any).dispatch.press("note.thread.pick", { n }, "reader");
    expect(rows().find(r => r.selected)!.text).toBe("Eli: not this year, sorry");
    expect(reader().showing.id).toBe(seeded.notes.threadHere.id);
    // ⏎ (or a second click) on the fold shows the posts it hid.
    const fold = rows().findIndex(r => r.text === "2 more earlier") + 1;
    await expect((stage() as any).dispatch.act({ action: "note.thread.open", tile: "reader", args: { n: fold } }, { kind: "user" })).rejects.toThrow(/note\.thread\.unfold/);
    expect(await (stage() as any).dispatch.press("note.thread.unfold", { n: fold }, "reader")).toMatchObject({ unfolded: 2 });
    expect(rows().map(r => r.text)).toContain("Ana: I have a tray going spare");
    // b walks the thread, the replies (the old children list), the outlinks and the backlinks, and back.
    const groups = [] as string[];
    for (let i = 0; i < 4; i++) groups.push(((await (stage() as any).dispatch.press("note.thread.groups", {}, "reader")) as { group: string }).group);
    expect(groups).toEqual(["children", "outlinks", "backlinks", "thread"]);
    // ⏎ reads the selected post, as the key does (Eli, picked above and still the one the panel was left on).
    const eli = rows().find(r => r.text === "Eli: not this year, sorry")!.n;
    await (stage() as any).dispatch.press("note.thread.pick", { n: eli }, "reader");
    await (stage() as any).dispatch.press("note.thread.open", {}, "reader");
    await until(() => reader()?.showing?.title === "Eli: not this year, sorry", "Eli's post read", 8000);
  }, 30_000);


  test("children (PIE-693): a thread's replies are a group of its links, narrowed by Stage; a tile's groups are chosen by act and saved; ⏎ opens a reply in the reader", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "children" }, as: "test-agent" })).toMatchObject({ key: "children" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "children")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    const tile = (name: string) => tiles().find(t => t.name === name);
    const childRows = (name: string) => (tile(name)?.backlinks?.rows ?? []).filter((r: any) => r.kind === "child");
    await until(() => tile("reader")?.showing?.id === seeded.notes.swap.id && childRows("replies").length === 4 && childRows("links").length === 4, "the swap thread, its links and its replies", 8000);
    // The replies tile lists Children alone; the links tile every group, the counters across all four.
    expect(tile("replies").backlinks.linkGroups).toEqual(["children"]);
    expect(tile("replies").backlinks.rows.some((r: any) => r.kind === "outlink" || r.kind === "backlink")).toBe(false);
    expect(tile("links").backlinks.status).toMatch(/→\d+\/\d+ ♦\d+\/\d+ ←\d+\/\d+ ↓4\/4/);
    // Stage narrows the children as every group: open keeps Ana's (waiting) and Cal's (active).
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "open" }, as: "test-agent" });
    expect(childRows("replies").map((r: any) => r.text).sort()).toEqual(["Ana: runner beans to swap", "Cal: labels and a pencil"]);
    expect(tile("replies").backlinks.status).toContain("2 of 4 match");
    // A status as the notes write it (PIE-819): Dee's `answered` is its own stage, and the outline's rule note puts it in
    // done, with Ben's.
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "answered" }, as: "test-agent" });
    expect(childRows("replies").map((r: any) => r.text)).toEqual(["Dee: a question about the time"]);
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "done" }, as: "test-agent" });
    expect(childRows("replies").map((r: any) => r.text).sort()).toEqual(["Ben: took the leek seedlings", "Dee: a question about the time"]);
    await app.act({ action: "backlinks.view", tile: "replies", args: { stage: "all" }, as: "test-agent" });
    // An agent chooses the links tile's groups: said, saved with the layout, refused past the last one.
    const focus = S().focus;
    expect(await app.act({ action: "backlinks.groups", tile: "links", args: { show: "children,backlinks" }, as: "test-agent" })).toMatchObject({ groups: ["backlinks", "children"] });
    expect(tile("links").backlinks.rows.some((r: any) => r.kind === "outlink")).toBe(false);
    expect(JSON.stringify(stage().layoutSpec())).toContain('"linkGroups":"backlinks,children"');
    await app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "outlinks" }, as: "test-agent" });
    expect(tile("replies").backlinks.linkGroups).toEqual(["outlinks", "children"]);
    await app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "outlinks" }, as: "test-agent" });
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { toggle: "children" }, as: "test-agent" })).rejects.toThrow(/only group/);
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { show: "kids" }, as: "test-agent" })).rejects.toThrow(/isn't a group/);
    await expect(app.act({ action: "backlinks.groups", tile: "replies", args: { choose: true }, as: "test-agent" })).rejects.toThrow(/person's/);
    await app.act({ action: "backlinks.groups", tile: "links", args: { show: "all" }, as: "test-agent" });
    // ⏎ on a reply opens it where the list's opens land: the reader whose children these are.
    const ana = childRows("replies").find((r: any) => r.text.startsWith("Ana"));
    await app.act({ action: "backlinks.open", tile: "replies", args: { n: ana.n }, as: "test-agent" });
    await until(() => tile("reader")?.showing?.id === ana.id, "the reply opened in the reader", 5000);
    expect(S().focus).toBe(focus);
  }, 30_000);


  test("links-block (PIE-693): an outbox in a day's plan: the query's matches listed, the selection previewed; [ ] and a pick move it, an agent's moves nothing; ⏎ opens where opens land; going in is the person's", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "links-block" }, as: "test-agent" })).toMatchObject({ key: "links-block" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "links-block")).top; };
    const reader = () => stage().pane("reader") as any;
    const blocks = async () => ((await app.act({ action: "links.blocks", tile: "reader", as: "test-agent" })) as any).blocks;
    await until(() => reader()?.surface.linkBlocksDrawn[0]?.rows.length === 3, "the outbox's three waiting letters", 8000);
    let b = (await blocks())[0];
    expect(b).toMatchObject({ n: 1, title: "Outbox", query: "type=letter mail=waiting", groups: ["matches"], entered: false });
    expect(b.rows.map((r: any) => r.text).sort()).toEqual(["Ask Ana about the bean seed", "Order the fruit-cage netting", "Write to the allotment society about the gate"]);
    // A query it can't read (PIE-729) shows the service's whole refusal in its frame: the query, what was read, a fix.
    await until(() => /Invalid property filter key/.test(screen()), "the unreadable query's refusal drawn", 8000);
    const refused = screen().replace(/\x1b\[[\d;]*m/g, "");
    expect(refused).toContain("query: type!=letter");
    expect(refused).toContain("Did you mean NOT type=letter");
    expect(refused).toContain("Example: type=thread");
    expect(refused).not.toContain("Invalid property fi…");
    // The first row is selected and previewed beside the list, drawn as an embed of it is.
    const first = b.rows.find((r: any) => r.selected);
    expect(first.n).toBe(1);
    expect(b.preview).toBe(first.id);
    // An agent's pick answers the row and moves nothing of the person's.
    const read = await app.act({ action: "links.pick", tile: "reader", args: { n: 2 }, as: "test-agent" }) as any;
    expect(read).toMatchObject({ row: 2, moved: false });
    expect((await blocks())[0].rows.find((r: any) => r.selected).n).toBe(1);
    // The person's pick (a key or a click) moves the selection, the [ ] position with it, and the preview follows.
    await stage().dispatch.act({ action: "links.pick", tile: "reader", args: { n: 2 } }, { kind: "user" });
    await until(() => reader().surface.linkBlocksDrawn[0]?.preview === read.id, "the preview following the pick", 5000);
    // The preview is the reader's own drawing of an embed of it: its » title, then its text.
    await until(() => screen().includes(`» ${read.text.slice(0, 20)}`), "the picked letter drawn in the preview", 8000);
    expect(reader().surface.inView()?.link?.linksBlock?.row).toBeDefined();
    // Going in is the person's.
    await expect(app.act({ action: "links.enter", tile: "reader", as: "test-agent" })).rejects.toThrow(/the person's/);
    await stage().dispatch.act({ action: "links.enter", tile: "reader" }, { kind: "user" });
    expect(reader().surface.linksIn).toBe(reader().surface.linkBlocksDrawn[0].key);
    await stage().dispatch.act({ action: "links.enter", tile: "reader", args: { on: false } }, { kind: "user" });
    expect(reader().surface.linksIn).toBeNull();
    // ⏎ on a row opens it where the reader's opens land: here, the reader itself.
    await app.act({ action: "links.open", tile: "reader", args: { n: 3 }, as: "test-agent" });
    await until(() => reader().surface.msg?.id === b.rows[2].id, "the third letter in the reader", 5000);
    await app.act({ action: "back", tile: "reader", as: "test-agent" });
    await until(() => reader().surface.msg?.id === seeded.notes.dayPlan.id, "back on the plan", 5000);
    expect(S().focus).toBe("index");
  }, 30_000);


  test("questions (PIE-745): links:this NOT linkedfrom:this as a list, tabs by crop and a rank by season, grouped by the service; a link back changes all three through queries.changed", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "questions" }, as: "test-agent" })).toMatchObject({ key: "questions" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "questions")).top; };
    const reader = () => stage().pane("reader") as any;
    const rows = () => (reader()?.surface.linkBlocksDrawn[0]?.rows ?? []).map((r: any) => r.text as string);
    await until(() => rows().length === SOCIETY_NOTES.length - SOCIETY_LINKED_BACK, "the notes the page doesn't link back", 8000);
    expect(rows()).not.toContain(SOCIETY_NOTES[0]!.title);
    expect(rows()).toContain("Garlic in before the first frost");
    const tabs = async () => ((await app.act({ action: "figures", tile: "reader", as: "test-agent" })) as any).figures.find((f: any) => f.kind === "tabs").tabs.map((t: any) => `${t.value} ${t.count}`);
    // Grouped by the service, by a property no code knows, in its value order; every match counted.
    expect(await tabs()).toEqual(["beans 3", "brassicas 3", "fruit 3", "garlic 1", "leeks 2", "none 2", "onions 3", "squash 3"]);
    // The rank by season, further down the note: the service's groups, most first.
    const page = await board.get(seeded.notes.society.id);
    const shown = (await import("../../src/notes-cli")).drawNote;
    const printed = (await shown(board, page!.id, 120))!.map(plain).join("\n");
    expect(printed).toMatch(/BY SEASON[\s\S]*autumn[\s\S]*7/);
    // The page links one back: the service says the answer changed (queries.changed on the door's connection), and the
    // list and both figures follow without anyone asking on paint.
    const told: unknown[] = [];
    const watched = board.watched, changed = watched.changed.bind(watched);
    watched.changed = (changes) => { told.push(...changes); changed(changes); };
    try {
      const garlic = (await board.queryNotes('title~"Garlic in before"')).notes[0]!;
      const page = (await board.get(seeded.notes.society.id))!;
      await board.update(page.id, `${page.text}\nAnd now ((${garlic.id})).`, page.revision!, { kind: "agent", id: "test-agent" });
      await until(() => rows().length === SOCIETY_NOTES.length - SOCIETY_LINKED_BACK - 1, "the garlic note linked back", 8000);
      expect(told.length).toBeGreaterThan(0);
      expect(rows()).not.toContain("Garlic in before the first frost");
      for (let i = 0; (await tabs()).includes("garlic 1"); i++) { if (i > 80) throw new Error("the garlic tab is still there"); await Bun.sleep(100); }
    } finally { watched.changed = changed; }
  }, 30_000);


  test("dates (PIE-769): due <= +3d, wait-until <= today and a window holding today answer on the calendar and in its lanes, in calendar order; a value that isn't a date is said, and a write moves a lane", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "dates" }, as: "test-agent" })).toMatchObject({ key: "dates" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "dates")).top; };
    const lane = (name: string) => ((stage().pane(name) as any)?.items ?? []).map((m: any) => m.text.split(" [")[0]);
    await until(() => lane("Due-in-three-days").length === 3 && lane("Waiting-until-today").length === 1 && lane("Window-open-today").length === 1, "the date lanes", 8000);
    // Sorted by due, written three ways: yesterday's ISO date, tomorrow's "Oct 14", the day after next's "10/16".
    expect(lane("Due-in-three-days")).toEqual(["Order the seed potatoes", "Collect the manure delivery", "Pay the plot rent"]);
    expect(lane("Waiting-until-today")).toEqual(["Ask the committee about the shed again"]);
    expect(lane("Window-open-today")).toEqual(["Seed swap"]);
    // The calendar's figures: grouped by the week it's due, and the date nobody can read said under the first.
    const figures = async () => ((await app.act({ action: "figures", tile: "calendar", as: "test-agent" })) as any).figures;
    for (let i = 0; !(await figures()).find((f: any) => f.kind === "tabs")?.tabs?.length; i++) { if (i > 80) throw new Error("no week tabs"); await Bun.sleep(100); }
    expect((await figures()).find((f: any) => f.kind === "tabs").tabs.map((t: any) => t.count).reduce((a: number, b: number) => a + b, 0)).toBe(5);
    await until(() => plain(screen()).includes("after the frost"), "the unreadable date said", 8000);
    // An agent sets a wait to today: the lane fills on its own (a watched answer changed), the note is the agent's write.
    const water = (await board.queryNotes('title~"Chase the water board"')).notes[0]!;
    const { revision, tokens } = await board.propertyTokens(water.id, "wait-until");
    await board.patchProperties(water.id, revision, [{ op: "replace", ordinal: tokens[0]!.ordinal, value: seedDay(0).short }], { kind: "agent", id: "test-agent" });
    await until(() => lane("Waiting-until-today").length === 2, "the water board in the waiting lane", 8000);
    expect(lane("Waiting-until-today")).toContain("Chase the water board");
  }, 30_000);
});

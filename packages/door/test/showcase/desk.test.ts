// PIE-439: the showcase screen, the desk: esc, refusals, drawer, status, sessions, power bar, policy. One of the showcase's test files (split from the one file, so a
// section's test is a file of its own); the harness (harness.ts) seeds a scratch outline and opens the screen on it.
// PIE-439: the showcase. Its seed (every section's content, written through the service) and the screen drawing
// each reuse-map section with its real part, by keys, mouse and act. The `scripts/try-it.sh --showcase` script
// (seeding, --reset, its pidfile) is test/try-it.test.ts's. Scratch services only; the seed is fictional.
import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../../src/app";
import type { Desk } from "../../src/desk/desk";
import { RACE, RACE_AGENTS, RACE_LINE, RACE_PATCH, type Seeded } from "../../src/showcase/seed";
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

describe.skipIf(!outliner)("the showcase screen: the desk: esc, refusals, drawer, status, sessions, power bar, policy", () => {
  const h = useShowcaseScreen();
  const { scratch, written, press, ch, screen, S } = h;
  let board!: SocketBoard, app!: App, sc!: Showcase, seeded!: Seeded;
  beforeAll(() => { ({ board, app, sc, seeded } = h); });


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


  test("the proposals section (PIE-725): the race's loser is a proposal beside the guide, a retry is deduped, and its agent dismisses it by act", async () => {
    const guide = (await board.get(seeded.notes.race.id))!;
    // @fern won: the guide reads as @fern left it, and @moss's patch wrote nothing into it.
    expect(guide.text).toContain(RACE_LINE.replace(RACE_PATCH.winner.observed, RACE_PATCH.winner.replacement));
    expect(guide.text).not.toContain(seeded.race.proposal);
    const proposal = (await board.get(seeded.race.proposal))!;
    expect(proposal).toMatchObject({ parentId: guide.id, props: { type: "draft-proposal", "proposal-status": "open" } });
    expect(seeded.race.retry).toEqual({ proposalId: seeded.race.proposal, deduped: true });
    expect((await board.proposalsBeside(guide.id)).proposals.map(p => p.id)).toEqual([seeded.race.proposal]);

    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "proposals" }, as: "test-agent" });
    await until(() => marks.proposals!.every(m => screen().includes(m)), "the proposals section");
    // Another retry now, at the revision @moss read: the same proposal back, still one beside the guide, the guide untouched.
    const at = RACE.indexOf(RACE_PATCH.loser.observed);
    const again = await board.request<any>("draft.patch", { blockId: guide.id, revision: seeded.notes.race.revision! - 1, mutation: { author: "agent", actorId: RACE_AGENTS.loser },
      patches: [{ ...RACE_PATCH.loser, range: { start: at, end: at + RACE_PATCH.loser.observed.length }, unit: "utf16" }] });
    expect(again).toMatchObject({ outcome: "proposed", proposalId: seeded.race.proposal, deduped: true, beside: guide.id });
    expect((await board.get(guide.id))!.revision).toBe(guide.revision);
    // Through act, in the guide's reader: another agent can't dismiss it; @moss can, and it's gone from beside the guide.
    await expect(app.act({ action: "proposal.dismiss", args: { id: seeded.race.proposal }, tile: "guide", as: RACE_AGENTS.winner })).rejects.toThrow("an agent dismisses only its own");
    expect(await app.act({ action: "proposal.dismiss", args: { id: seeded.race.proposal }, tile: "guide", as: RACE_AGENTS.loser })).toMatchObject({ outcome: "dismissed", embedRemoved: null });
    await until(() => !screen().includes("proposed edit from @moss"), "the proposal gone from beside the guide");
    expect((await board.get(guide.id))!).toMatchObject({ text: guide.text, revision: guide.revision });
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
    const row = (stage().overlays.top().items as any[]).find(r => r.action === "tile.close");
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
    press({ kind: "char", ch: "w", ctrl: true }); press({ kind: "char", ch: "z" });
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


  test("the drawer section, driven through act: the kettle goes in, a section switch keeps it (the same pid), and it comes out into another section", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drawer" }, as: "test-agent" });
    await until(() => marks.drawer!.every(m => screen().includes(m)), "the drawer section");
    const stage = () => S().stages.get(S().sel).top;
    const kettle = () => stage().pane("kettle");
    await until(() => kettle()?.running === true, "the kettle runs");
    const pid = kettle().pid;
    const out = await app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: "test-agent" }) as any;
    expect(out).toMatchObject({ tile: "kettle", inDrawer: true });
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
    const row = app.drawer.rect!.row + 1, col = plain(h.painted[row] ?? "").lastIndexOf("×");
    expect(col).toBeGreaterThan(0);
    for (const action of ["down", "up"] as const) press({ kind: "mouse", action, button: 0, x: col, y: row });
    expect((app as any).message).toContain("closing ends it");
    expect(app.drawer.tabs().map(t => t.name)).toContain("kettle");
    press({ kind: "char", ch: "]", ctrl: true });
    (app as any).lastInput = 0;
    const back = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "right" }, tile: "kettle", as: "test-agent" }) as any;
    expect(back).toMatchObject({ tile: "kettle", inDrawer: false });
    expect(stage().pane("kettle").pid).toBe(pid);
    expect(stage().pane("kettle").running).toBe(true);
    // The drawer's own first tab comes out too: an ordinary terminal tile in this section, its program running on; a
    // new own tab takes its place in the drawer.
    const own = app.drawer.tile!;
    // Its program starts as its tab is first drawn: shown now (another section, the agent sessions', may have left a tab in the drawer).
    await app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, { kind: "user" }).catch(() => {});
    (app as any).paint();
    await until(() => own.running, "the drawer's own program runs");
    const ownPid = own.pid;
    (app as any).lastInput = 0;
    const left = await app.act({ action: "tile.drawer", args: { on: false, to: "tree", where: "down" }, tile: "drawer.agent", as: "test-agent" }) as any;
    expect(left).toMatchObject({ inDrawer: false, fresh: true });
    expect(stage().pane(left.tile)).toBe(own);
    expect(stage().pane(left.tile).pid).toBe(ownPid);
    expect(app.drawer.tile).not.toBe(own);
    expect(app.drawer.tabs()[0]!.name).toBe("drawer.agent");
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
    if (deploy().status.urgent().state === "working") expect(screen()).toMatch(/[◴◷◶◵] (20|60)% \d deploy/);
    // Blocked on a permission: the header's ◆, the list's row, the status bar's count, peek and status.list.
    await until(() => deploy()?.status.urgent()?.state === "blocked", "blocked", 8000);
    await until(() => /◆ \d deploy/.test(screen()) && screen().includes("deploy · needs you · Deploy v2.4.1 to production?"), "the header and the list", 5000);
    expect(bar()).toContain("◆1 on you");
    const listed = await app.act({ action: "status.list", args: {}, as: "test-agent" }) as any;
    expect(listed.waiting[0]).toMatchObject({ n: 1, name: "deploy", state: "blocked", kind: "permission", app: "deploy", msg: "Deploy v2.4.1 to production?" });
    expect(JSON.stringify(app.describe())).toContain("\"status\":[{\"id\":\"\",\"state\":\"blocked\",\"kind\":\"permission\",\"app\":\"deploy\",\"msg\":\"Deploy v2.4.1 to production?\"}]");
    // Going to it is the person's: an agent's is refused, its keys stay put.
    await expect(app.act({ action: "status.go", tile: "waiting", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();
    // The agent answers the program itself (tile.type), and it rolls out, then finishes done.
    await app.act({ action: "tile.type", tile: "deploy", args: { text: "y\\n" }, as: "test-agent" });
    await until(() => deploy()?.status.urgent()?.state === "done", "done", 8000);
    await until(() => /✓ \d deploy/.test(screen()) && screen().includes("deploy · done · Deployed v2.4.1 to 3 regions"), "done on the header and the list", 5000);
    expect(bar()).toContain("✓1 on you");
    // alt+w: the same list in your drawer.
    (app as any).lastInput = 0;
    press({ kind: "alt", ch: "w" });
    await until(() => app.drawer.tabs().some(t => t.kind === "waiting-you"), "the list in the drawer", 5000);
    expect(app.drawer.open).toBe(true);
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "host.toggle", args: { open: false }, as: "test-agent" }).catch(() => {});
    // The person goes to it from the list (⏎ on its row runs status.go): the keys go to the deploy, and its done is seen.
    await stage().dispatch.press("status.go", { n: 1 }, "waiting");
    await until(() => deploy()?.status.records.size === 0, "seen once the person is in it", 5000);
    expect(bar()).not.toContain("on you");
    press({ kind: "char", ch: "]", ctrl: true });
    press({ kind: "esc" });
  }, 30_000);


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
    await until(() => screen().includes("@tidy · Reply to the seed swap thread"), "the row");
    // An agent opens it, never sends it.
    await expect(app.act({ action: "held.send", tile: "waiting", args: { id: held()[0].block }, as: "test-agent" })).rejects.toThrow("waits for a person");
    expect(app.heldAsks.count()).toBe(1);
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
    expect(of("moss").shown).toMatchObject({ in: "screen", tile: "moss", here: true });
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
    const at = (app as any).changedAt;
    expect(at).not.toBeNull();
    press({ kind: "mouse", action: "down", button: 0, x: at.from + 1, y: at.row });
    press({ kind: "mouse", action: "up", button: 0, x: at.from + 1, y: at.row });
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


  test("the power bar section (PIE-656): the stage's tiles listed as their tree, the folded one a spine; ctrl+k then %pears and ⏎ opens it from its spine and gives it the keys; a pasted action line is the first row; an agent's bar.open answers and opens nothing", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "bar" }, as: "test-agent" });
    await until(() => marks.bar!.every(m => screen().includes(m)), "the power bar section");
    const stage = () => S().stages.get(S().sel).top as Desk;
    await until(() => !!stage().tileOutline().find(t => t.name === "pears")?.collapsed, "the second detail folded");
    // An agent's: the rows, nothing opened.
    const r = await app.act({ action: "bar.open", args: { scope: "tiles" }, as: "test-agent" }) as any;
    const row = (name: string) => r.rows.find((x: any) => x.label.startsWith(`${name} ·`));
    expect(row("outline").depth ?? 0).toBe(0);
    expect(row("reader").depth).toBe(1);
    expect(row("pears")).toMatchObject({ depth: 2, label: "pears · Allotment notebook" });
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


  test("the agent policy section (PIE-639): free, edit only and hands off tiles; an agent's open is refused or lands, its edit of the middle note goes through, peek says the limits, the person's keys are never limited", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "agents" }, as: "test-agent" });
    await until(() => marks.agents!.every(m => screen().includes(m)), `the agents section: ${marks.agents!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const recipe = seeded.notes.recipe.id;
    // Peek says the limits before an agent acts.
    const seen = JSON.stringify(stage().describe());
    expect(seen).toContain('"agentLimits":[{"tile":"edit"');
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
    expect(landed.reader).toBe("free");
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
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("✎ agents: edit only"));
    expect(y).toBeGreaterThan(0);
    const x = rows[y]!.indexOf("agents: edit only") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y });
    press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => stage().agentNow("edit").level === "off", "the chip's click");
    press({ kind: "esc" });
  }, 30_000);
});

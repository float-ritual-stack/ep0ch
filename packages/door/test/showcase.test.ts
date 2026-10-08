// PIE-439: the showcase. Its seed (every section's content, written through the service), the
// `scripts/try-it.sh --showcase --reset` path putting it back, and the screen drawing each reuse-map
// section with its real part, by keys, mouse and act. Scratch services only; the seed is fictional.
import { unsent } from "../src/draft-session";
import { osc52 } from "../src/surface/selection";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { GRAPH_KINDS } from "../src/graphs";
import { liveBoard } from "../src/live";
import { Help, MainMenu } from "../src/screens";
import { CHORE_QUEUE, FIGURE_KINDS, LABELS_BEFORE, LANES, MARKDOWN_KINDS, loadShowcase, RECENT_FILES, RECENT_SESSION, REMOTE_CLIENT, REMOTE_LINE, SEED, seedShowcase, type Seeded } from "../src/showcase/seed";
import { SECTIONS, Showcase, SHOWCASE_ACTIONS } from "../src/showcase/showcase";
import { SocketBoard } from "../src/socket";
import { drawNote } from "../src/notes-cli";
import { C, fg } from "../src/style";
import { jevOff } from "../src/surface/completer";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

/**
 * Processes whose environment serves `base`'s state: a scan of `proc`, and none where the host has no
 * /proc (macOS), where only the pidfile is checked.
 */
function servingState(base: string, proc = "/proc"): string[] {
  if (!existsSync(proc)) return [];
  return readdirSync(proc).filter(p => /^\d+$/.test(p)).filter(p => {
    try { return readFileSync(`${proc}/${p}/environ`, "utf8").split("\0").includes(`EP0CH_OUTLINES=${base}/outlines`); } catch { return false; }
  });
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

test("the README's showcase says what SECTIONS registers by key, never a count; the action's summary names every key", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  expect(readme).toContain("act section name=<n|key>");
  expect(readme).not.toMatch(/live, in [a-z-]+ sections|name=<1-\d+\|key>/);
  const summary = SHOWCASE_ACTIONS.list().find((a: any) => a.name === "section")!.summary;
  expect(summary).toContain(`name=<1-${SECTIONS.length}>`);
  for (const s of SECTIONS) expect(summary).toContain(s.key);
  // The map rows without a section are the ones the README names.
  const grammar = readFileSync(join(import.meta.dir, "../docs/UI-GRAMMAR.md"), "utf8");
  const map = grammar.slice(grammar.indexOf("## Before adding a feature"), grammar.indexOf("## TL;DR"));
  const rows = map.split("\n").filter(l => /^\| [a-z]/.test(l) && !l.startsWith("| The feature"));
  expect(rows.length - SECTIONS.length).toBe(6);
  expect(readme).toContain("its list-picker and line-input rows (in the panes section's ^W P and ^W r,\nthe board's g m s), its elements and reading-ruler row (PIE-441) and its terminal-output row (PIE-510");
});

test("the help screen says which screens write to the outline, not that the door is read-only", () => {
  const text = new Help().render({ t: { cols: 140 } } as any).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
  expect(text).not.toContain("Read-only");
  expect(text).toContain("Kanban, Quay, Desk, Today, Waiting, Claude·now, Showcase and the message reader write");
  expect(text).toContain("recorded as you, or as the agent that did them");
});

test("the showcase has every ::graph-* kind the door draws: the figures note the first ones, the Markdown figures and keys notes the newer", () => {
  expect([...FIGURE_KINDS, ...MARKDOWN_KINDS, "keys"].sort() as string[]).toEqual([...GRAPH_KINDS].sort());
});

describe.skipIf(!outliner)("the showcase seed", () => {
  const scratch = new Scratch();
  let board: SocketBoard, seeded: Seeded;
  beforeAll(async () => {
    await scratch.start();
    seeded = await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    await board.info();
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });

  test("every seeded note is found by title under the marked root", async () => {
    const s = await loadShowcase(board);
    expect(s).not.toBeNull();
    expect(Object.keys(s!.notes).sort()).toEqual(Object.keys(SEED).sort());
    expect((await board.roots()).filter(r => r.props.type === "showcase").length).toBe(1);
  });

  test("the remote writes note (PIE-615): a remote client's patch at propose is a proposal under it, its comment a thread, the note unchanged", async () => {
    const note = seeded.notes.remoteWrites;
    const now = (await board.get(note.id))!;
    expect(now.text).toContain(REMOTE_LINE);
    const proposal = (await board.children(note.id)).find(m => m.props.type === "draft-proposal");
    expect(proposal?.text).toContain("from @mcp:chat.example.test: not applied, because its writer may propose changes here, not make them");
    expect(now.text).toContain(`!((${proposal!.id}))`);
    expect((await board.comments(note.id))).toEqual([expect.objectContaining({ body: "Was that the peat-free kind?", quote: "two bags of compost", open: true })]);
  });

  test("a board hub whose lanes are saved views, with cards in every stage", async () => {
    const lanes = (await board.children(seeded.notes.hub.id)).filter(k => k.props.type === "virtual-branch");
    expect(lanes.map(l => l.text.split(" [")[0])).toEqual([...LANES]);
    const counts: Record<string, number> = {};
    for (const l of lanes) { const r = await board.readSavedView(l.id); expect(r?.status).toBe("ready"); counts[l.text.split(" [")[0]!] = r!.blocks.length; }
    expect(counts).toEqual({ Queued: 2, Doing: 2, Review: 1, Done: 1 });
    // Roadmap items through the allocator: work-ids, under the project's work queue.
    expect(seeded.cards.map(c => c.props["work-id"])).toEqual(["HOME-001", "HOME-002", "HOME-003", "HOME-004", "HOME-005", "HOME-006"]);
    expect(seeded.cards.every(c => c.parentId === seeded.notes.queue.id)).toBe(true);
    const garden = await board.readSavedView(seeded.notes.gardenView.id);
    expect(garden?.blocks.map(b => b.text.split(" [")[0])).toEqual(expect.arrayContaining(["Water the beans", "Turn the compost", "Net the brassicas"]));
  });

  test("the notebook: callouts, links and soft links, folds, a literal region, a tilde fence, a transclusion, properties in every scope", async () => {
    const t = seeded.notes.notebook.text;
    for (const piece of ["> [!note] Gate code", "> [!warning]- Slugs", `[[${SEED.shed}]]`, `((${seeded.cards[3]!.id}|the kettle job))`, "HOME-001 is the gate latch",
      "## Beds", "  - runner beans", `((${seeded.cards[3]!.id}|the kettle (the dented one)))`, "<!-- literal -->", "<!-- /literal -->", "~~~text", `!((${seeded.notes.whiteboard.id}))`])
      expect(t).toContain(piece);
    const scope = async (key: string) => (await board.propertyTokens(seeded.notes.notebook.id, key)).tokens.map(x => x.scope);
    expect(await scope("season")).toEqual(["block"]);
    expect(await scope("harvest")).toEqual(["line"]);
    expect(await scope("level")).toEqual(["inline"]);
    // The literal region's and the ~~~ fence's properties are text, not properties.
    expect(await scope("mode")).toEqual([]);
    // The reader draws the ~~~ fence as code, as the service reads it: its **bold** as typed, in the code box.
    const drawn = (await drawNote(board, seeded.notes.notebook.id, 120))!.map(plain);
    expect(drawn.some(l => l.includes("│ **Not bold**, [mode::quiet] and #quiet are code here"))).toBe(true);
    // A label with parentheses is read whole, as the service reads it: the link is "the kettle (the dented one)".
    expect(drawn.some(l => l.includes("A label can hold parentheses: the kettle (the dented one) needs a new lid."))).toBe(true);
    expect((await board.backlinks(seeded.notes.shed.id)).sources.map(b => b.blockId)).toContain(seeded.notes.notebook.id);
    expect((await board.resolvePage(SEED.shed)).status).toBe("resolved");
  });

  test("comment threads, open and resolved; children; every figure kind", async () => {
    const threads = await board.comments(seeded.notes.shed.id);
    expect(threads.map(c => [c.open, c.replies.length])).toEqual([[true, 0], [false, 1]]);
    expect((await board.children(seeded.notes.shed.id)).filter(k => !k.props.type?.startsWith("annotation")).map(k => k.text.split("\n")[0])).toEqual(["Puncture kit", "Chain oil"]);
    for (const k of FIGURE_KINDS) expect(seeded.notes.figures.text).toContain(`::graph-${k}\n`);
    expect(seeded.notes.figures.text).toContain(`view: ((${seeded.notes.gardenView.id}))`);
    for (const k of MARKDOWN_KINDS) expect(seeded.notes.markdownFigures.text).toContain(`::graph-${k}\n`);
    expect(seeded.notes.keys.text).toContain("::graph-keys\n");
    // The figure block it transcludes: a note that is a figure, its rows its child bullets.
    const block = (await board.children(seeded.notes.markdownFigures.id)).find(k => k.text.startsWith("Bean rows\n::graph-timeline"))!;
    expect(seeded.notes.markdownFigures.text).toContain(`!((${block.id}))`);
    expect((await board.children(block.id)).map(k => k.text)).toEqual(["Apr: sow under glass", "**May: plant out** — when the nights are warm", "*Jun: first picking*"]);
    // The chore queue figure sorts by a property: ranks as numbers, the chore without one last.
    const drawn = (await drawNote(board, seeded.notes.figures.id, 120))!.join("\n");
    const queue = drawn.slice(drawn.indexOf("CHORE QUEUE"));
    const at = CHORE_QUEUE.map(t => queue.indexOf(t));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  test("every figure fits its width (PIE-581): the figures note drawn at 40, 80 and 160 columns has no line past the edge", async () => {
    for (const w of [40, 80, 160]) {
      const lines = (await drawNote(board, seeded.notes.figures.id, w))!.map(plain);
      const wide = lines.filter(l => Bun.stringWidth(l) > w);
      expect(wide, `at ${w}: ${wide.slice(0, 3).join(" | ")}`).toEqual([]);
      // The comparison kinds drew with the seeded data, not a refusal.
      // (A narrow frame cuts a long title with …, so the stems.)
      for (const title of ["HOUSE JOBS BY PRIORITY", "HOUSE JOBS BY ARC", "RAISED BEDS OR GROW BAGS", "CHORES BY AREA", "STARTUP BUDGET"]) expect(lines.join("\n")).toContain(title);
      expect(lines.join("\n")).not.toMatch(/name the two properties|no (points|cells|flows|rows):/);
    }
    // The live data drew: the quadrant placed every house job, the matrix's totals are the stage counts, the flow
    // counted the chores by area, and the budget meter's last row is over its limit.
    const at80 = (await drawNote(board, seeded.notes.figures.id, 80))!.map(plain).join("\n");
    expect(at80).toMatch(/HOUSE JOBS BY PRIORITY AND STAGE[\s\S]*live · 6 results/);
    expect(at80).toMatch(/HOUSE JOBS BY ARC AND STAGE[\s\S]*\n ┊\s+2\s+1\s+2\s+1\s+┊/);
    expect(at80).toMatch(/CHORES BY AREA AND STAGE[\s\S]*garden\s+3 █/);
    expect(at80).toMatch(/with the barrel\s+█+┃\s+181 \/ 150 ms\s+┊\n ┊\s+31 ms over/);
  }, 20_000);

  test("a figure can be linked to (PIE-580): the service slices the whole block for an anchor alone after its ::", async () => {
    const read = await board.readFragment(seeded.notes.figures.id, "budget");
    expect(read.status).toBe("resolved");
    if (read.status !== "resolved") return;
    const lines = seeded.notes.figures.text.split("\n");
    expect(lines[read.fragment.startLine]).toBe("::graph-meter");
    expect(lines[read.fragment.endLine]).toBe("::");
    expect(lines[read.fragment.endLine + 1]).toBe("^budget");
    expect(read.fragment.text).toContain("title: Startup budget");
  });

  test("files a session touched (PIE-602): a made-up session's branch, day › project › session › one block per file, each naming its file", async () => {
    const [day] = await board.children(seeded.notes.recentFiles.id);
    const [project] = await board.children(day!.id);
    const [session] = await board.children(project!.id);
    expect([day!.props["file-day"], project!.props["file-project"], session!.props["file-session"]]).toEqual(["2026-03-11", "allotment", RECENT_SESSION]);
    const files = await board.children(session!.id);
    expect(files.map(f => [f.props.file, f.props.type, f.props.touches])).toEqual(RECENT_FILES().map(f => [f.file, "file-touch", String(f.touches)]));
    for (const f of RECENT_FILES()) expect(existsSync(f.file)).toBe(true);
  });

  test("heading styles (PIE-599): banded wide, as written narrow, nothing past the edge; the outline's own style changes the look with no door change", async () => {
    const drawn = async (w: number) => (await drawNote(board, seeded.notes.headings.id, w))!.map(plain);
    for (const w of [40, 80, 160]) {
      const lines = await drawn(w), text = lines.join("\n");
      const wide = lines.filter(l => Bun.stringWidth(l) > w);
      expect(wide, `at ${w}: ${wide.slice(0, 3).join(" | ")}`).toEqual([]);
      expect(text).not.toMatch(/\[heading::|\[heading-|\[rule::/);
      if (w === 40) {
        for (const h of ["# Your calls", "## The plot", "## Beds", "### Water butts", "## Seed order", "## Compost", "## Odd jobs", "## Tool shed", "## Plain"]) expect(lines.map(l => l.trim())).toContain(`▾ ${h}`);
        expect(lines.map(l => l.trim()).filter(l => l === "---").length).toBe(2);
      } else {
        expect(text).toMatch(/[▓▒░]{3}.*Y O U R   C A L L S.*[▓▒░]{3}/);
        expect(text).toMatch(/THE PLOT +▓/);
        expect(text).toMatch(/─  (?:▾ )?COMPOST  ─/);
        // The styled rule fades in from both edges; the plain one is as written.
        expect(lines.some(l => /^ ?▓.*▓\s*$/.test(l) && !/[A-Za-z]/.test(l))).toBe(true);
        expect(text).toContain("▾ ## Plain");
        // One heading's own fields: Odd jobs on the dots band, Tool shed on one row of uptime bars, right-aligned.
        expect(text).toMatch(/^ +▾ Odd jobs +·/m);
        expect(text).toMatch(/[▓▒░·].* ▾ Tool shed\s*$/m);
        expect(text).not.toContain("## Beds");
      }
    }
    // The plot style is declared on a line of the note (drawn as what it declares, not its tokens): dots on the top
    // row. Restyled to the rule pattern there, the seed order is drawn on a rule band, by the same door.
    expect((await drawn(100)).join("\n")).toContain("style plot  dots · 2 rows · left/top · green");
    const before = (await drawn(100)).find(l => l.includes("Seed order"))!;
    expect(before).toMatch(/Seed order.*·/);
    const style = seeded.notes.headings.id;
    const { revision, tokens } = await board.propertyTokens(style, "heading-pattern");
    expect(tokens[0]!.value).toBe("dots");
    await board.patchProperties(style, revision, [{ op: "replace", ordinal: tokens[0]!.ordinal, value: "rule" }], { kind: "user" });
    // A door that connects now (as `ep0ch show` does) asks for the outline's styles and draws the new look.
    const fresh = new SocketBoard(scratch.sock);
    try {
      await fresh.info();
      expect((await drawNote(fresh, seeded.notes.headings.id, 100))!.map(plain).join("\n")).toMatch(/Seed order  ═{20,}/);
    } finally { fresh.close(); }
  }, 20_000);

  test("seeding twice is refused", async () => {
    await expect(seedShowcase(board)).rejects.toThrow(/already has a showcase/);
  });
});

describe.skipIf(!outliner)("scripts/try-it.sh --showcase --reset", () => {
  const home = mkdtempSync(join(tmpdir(), "ep0ch-showcase-home-"));
  const base = join(home, "ep0ch-door", "showcase");
  // Without EP0CH_STATE, which the script would put the showcase under: another test file may have left it
  // set in this process (the order files run in differs between machines; on macOS it broke this one).
  const env = () => { const e: Record<string, string | undefined> = { ...process.env, XDG_STATE_HOME: home }; delete e.EP0CH_STATE; return e; };
  const run = (...args: string[]) => Bun.spawnSync(["sh", "scripts/try-it.sh", "--showcase", "--prepare", "--outliner", outliner!, ...args], {
    cwd: join(import.meta.dir, ".."), env: env(), stdout: "pipe", stderr: "pipe",
  });
  afterAll(() => rmSync(home, { recursive: true, force: true }));

  test("seeds on first run, keeps edits across runs, and --reset puts the seed back", async () => {
    const first = run();
    expect(first.exitCode).toBe(0);
    expect(first.stdout.toString()).toContain("seeded the showcase");
    // An edit on the showcase outline, through its own service on the same state.
    let svc = new Scratch(base, "showcase");
    let board = new SocketBoard(await svc.start());
    let wb = (await loadShowcase(board))!.notes.whiteboard!;
    const original = wb.text;
    await board.update(wb.id, `${original}\nBuy more lemons.`, wb.revision!);
    board.close(); await svc.stop();
    // Another run keeps it (no reseed)…
    const again = run();
    expect(again.exitCode).toBe(0);
    expect(again.stdout.toString()).not.toContain("seeded");
    svc = new Scratch(base, "showcase"); board = new SocketBoard(await svc.start());
    expect((await loadShowcase(board))!.notes.whiteboard!.text).toContain("Buy more lemons.");
    board.close(); await svc.stop();
    // …and --reset deletes it and reseeds.
    const reset = run("--reset");
    expect(reset.exitCode).toBe(0);
    expect(reset.stdout.toString()).toContain("reset: deleted");
    svc = new Scratch(base, "showcase"); board = new SocketBoard(await svc.start());
    const back = (await loadShowcase(board))!;
    expect(back.notes.whiteboard!.text).toBe(original);
    expect((await board.roots()).filter(r => r.props.type === "showcase").length).toBe(1);
    board.close(); await svc.stop();
    // --prepare leaves no service of its own running: no pidfile, and no process serving that state.
    expect(existsSync(join(base, "service.pid"))).toBe(false);
    expect(servingState(base)).toEqual([]);
  }, 60_000);
});

test("the process scan finds nothing, rather than failing, on a host without /proc", () => {
  expect(servingState("/nowhere/showcase", join(tmpdir(), "ep0ch-no-proc-here"))).toEqual([]);
});

describe.skipIf(!outliner || !existsSync("/proc"))("scripts/try-it.sh --showcase with a stale pidfile", () => {
  const home = mkdtempSync(join(tmpdir(), "ep0ch-showcase-stale-"));
  const base = join(home, "ep0ch-door", "showcase");
  const pidfile = join(base, "service.pid");
  const run = (args: string[], env: Record<string, string> = {}, checkout = outliner!) => Bun.spawnSync(["sh", "scripts/try-it.sh", "--showcase", "--prepare", "--outliner", checkout, ...args], {
    cwd: join(import.meta.dir, ".."), env: { ...process.env, XDG_STATE_HOME: home, ...env }, stdout: "pipe", stderr: "pipe",
  });
  // An unrelated process of our own, which the script must never signal. Only we stop it.
  let bystander: ReturnType<typeof Bun.spawn> | null = null;
  const stale = () => { mkdirSync(base, { recursive: true }); writeFileSync(pidfile, `${bystander!.pid}\n`); };
  beforeAll(() => { bystander = Bun.spawn(["sleep", "300"], { stdout: "ignore", stderr: "ignore" }); });
  afterAll(() => { bystander?.kill(); rmSync(home, { recursive: true, force: true }); });

  test("a pidfile naming another process is stale: the script serves and seeds, and leaves that process alone", () => {
    stale();
    const r = run([]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).toContain("seeded the showcase");
    expect(r.stderr.toString()).toContain(`named process ${bystander!.pid}, which isn't its service`);
    expect(alive(bystander!.pid)).toBe(true);
    expect(existsSync(pidfile)).toBe(false);                 // its own service stopped on exit, and said so
    expect(servingState(base)).toEqual([]);
  }, 60_000);

  test("--reset doesn't signal the process a stale pidfile names", () => {
    stale();
    const r = run(["--reset"]);
    expect(r.exitCode).toBe(0);
    expect(r.stdout.toString()).not.toContain("stopped the showcase service");
    expect(r.stdout.toString()).toContain("reset: deleted");
    expect(alive(bystander!.pid)).toBe(true);
    expect(servingState(base)).toEqual([]);
  }, 60_000);

  test("a pidfile naming the showcase's own service is used: no second service, and it keeps running", async () => {
    const svc = new Scratch(base, "showcase");
    await svc.start();
    try {
      writeFileSync(pidfile, `${svc.pid}\n`);
      const r = run([]);
      expect(r.exitCode).toBe(0);
      expect(r.stderr.toString()).not.toContain("isn't its service");
      expect(alive(svc.pid!)).toBe(true);
      expect(servingState(base)).toEqual([String(svc.pid)]);
      expect(readFileSync(pidfile, "utf8").trim()).toBe(String(svc.pid));   // not its to remove
    } finally { await svc.stop(); rmSync(pidfile, { force: true }); }
  }, 60_000);

  test("a service that doesn't start in time is stopped before the script exits, before any pidfile exists", async () => {
    // A stand-in checkout whose server never opens its socket, and says which process it is.
    const fake = mkdtempSync(join(tmpdir(), "ep0ch-fake-outliner-"));
    const started = join(fake, "pid");
    mkdirSync(join(fake, "src"));
    writeFileSync(join(fake, "src/host-main.ts"), `require("node:fs").writeFileSync(${JSON.stringify(started)}, String(process.pid)); setInterval(() => {}, 1000);\n`);
    try {
      rmSync(base, { recursive: true, force: true });
      const r = run([], { EP0CH_TRY_START_CHECKS: "10" }, fake);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain("the private host didn't start");
      const pid = Number(readFileSync(started, "utf8"));
      await until(() => !alive(pid), "the stand-in service stopped", 3000).catch(() => {});
      const left = alive(pid);
      if (left) process.kill(pid);                            // ours: the test started it through the script
      expect(left).toBe(false);
      expect(existsSync(pidfile)).toBe(false);
    } finally { rmSync(fake, { recursive: true, force: true }); }
  }, 30_000);
});

describe.skipIf(!outliner)("the showcase screen", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, sc: Showcase, seeded: Seeded;
  let key: (k: Key) => void = () => {};
  const written: string[] = [];
  let painted: string[] = [];
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const screen = () => sc.render(app).lines.map(plain).join("\n");
  const S = () => sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    // e arms the edit here, as in the door (test/preload.ts turns it off): ⏎ opens it.
    process.env.EP0CH_EDIT_ARM = "60000";
    await scratch.start();
    seeded = await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write(s: string) { written.push(s); }, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    // As the door does at start: the extensions and rules the service lists (the seed installed the example rules).
    await app.loadExtensions(true);
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; process.env.EP0CH_EDIT_ARM = "off"; });

  // What each section's own part draws, once it has read the outline.
  const marks: Record<string, string[]> = {
    note: ["Allotment notebook", "the same NoteSurface, as the BBS reader · src/screens.ts", "Subj: Allotment notebook"],
    // The detail screen spec on the notebook: the detail tile's own frame and keys around the same surface.
    detail: ["─ detail ─", "Allotment notebook", "Our plot at the Elm Row allotments.", "p follow · [ ] elements"],
    // A long note to scroll past the end of (PIE-622), a short one beside it.
    scroll: ["The long row of runner beans", "End (or G) goes to the last line", "Bike shed"],
    // The list scrolls: the note set's header and the registry are on screen; the desk set is further down.
    actions: ["NOTE_ACTIONS · src/surface/note.ts", "the action registry · src/surface/actions.ts"],
    edit: ["Kitchen whiteboard", "properties · 6"],
    // The desk's search overlay, opened on a query with two typos: both allotment notes found, in the service's order.
    search: ["search the board", "alotment notebok", "hit(s)", "Allotment notebook", "Allotment figures"],
    // The draft session: an edit open on the left, a comment being written on the right.
    drafts: ["editing · Kitchen whiteboard", "comment · Allotment notebook", "[add them]"],
    // Three kept edits against notes that moved on: one with a new line, one the note already has (settled), one old (a chip).
    kept: ["Greenhouse watering rota", "from your edit yesterday", "[add them]", "was already in the note", "1 old edit"],
    // An edit with a whole document pasted in by mistake, one step, and the page token selected with its [copy].
    undo: ["editing · Jar labels", "pasted 42 lines · ctrl+z undoes", "[copy]"],
    panes: ["outline", "thread", "│ 4 activity", "Kitchen sink"],
    screens: ["daily brief · 2026-03-11", "2 of 2 briefs"],
    kinds: ["tile kinds", "tree ^W o t", "backlinks ^W o l"],
    terminal: ["a terminal tile: sh in a pty the door owns", "shell"],
    drawer: ["the kettle: a terminal tile to put in your drawer", "kettle"],
    // A fake deploy reporting its status (OSC 7501) beside the waiting-on-you list that follows it.
    status: ["a fake deploy, saying what it does with OSC 7501", "waiting on you"],
    preview: ["preview · tree", "outline"],
    screen: ["board ·", "preview · board"],
    spine: ["Queued", "Doing", "Review", "Done", "HOME-003"],
    entity: ["Bike shed", "The pump's spare valves are on the kitchen whiteboard.", "REPLIES 2", "COMMENTS 1 open · 1 resolved", "← backlinks (", "resources (1)"],
    presence: ["who's online", "last callers · live"],
    live: ["GARDEN CHORES (LIVE QUERY)", "live · 3 results", "HOUSE JOBS BY ARC (LIVE)"],
    tabs: ["PLOT JOBS", "doing 2 · review 1 · validate 0 · done 1 · queued 2", "≡ compact"],
    projection: ["Jira ACME-12 · Rollout checklist for the vendor switch", "Jira ACME-14 · Label printer drops the last line", "Jira · ambiguous: ACME-20, ACME-21", "Jira ACME-30 · not registered", "can't fetch: item was not found"],
    // Without the outliner's examples installed (this scratch seeds with the tickets only), the lines are properties.
    extensions: ["Omens for the allotment week", "extensions"],
    // The outliner's example rules, installed by the seed: meeting-card's card, shout's band, the job done-stamp watches.
    rules: ["Allotment committee, Saturday", "[meeting]", "CLOSE THE COLD FRAME TONIGHT", "Mend the water butt"],
    selection: ["Lentil soup", "Drag across these lines"],
    service: ["views.read ((Garden chores))", "ready · 3 block(s)", "references.backlinks (Bike shed)"],
    // This door runs in its own terminal (the test's App), so the section says so; in a session it lists the terminals.
    session: ["this door runs in its own terminal (--no-daemon)", "session"],
    // Obsidian's examples, nested three deep; the right reader declares a type of the outline's own.
    callouts: ["Callouts, as Obsidian writes them", "Can callouts be nested?", "Yes!, they can.", "Recipe callouts"],
    // This test's terminal has no Kitty graphics: each image's line says what it is, with its controls.
    images: ["Pictures of the plot", "▀ header allotment-dusk.jpg", "▣ seed-packet.webp · no Kitty graphics in this terminal", "[−][+] [◂][▸] [▀]", "▣ allotment-notice.png"],
    // A note whose first block is a picture: scrolled, the header takes it as its background (PIE-598).
    hero: ["An evening on the plot", "▣ evening-beds.jpg", "hero-focus"],
    // The Markdown figures on the left (a decision first), the keys read from the registry on the right.
    figures: ["Figures, written in Markdown", "SQUASH BEDS", "Raised beds", "The reader's keys", "[e]"],
    // A guide note with a [[page]] nobody wrote yet, for ctrl+n, the offer and the page title fill.
    newnotes: ["New notes from anywhere", "Seed swap ledger", "ctrl+n"],
    // A reader and a terminal whose program asked for the mouse, each with its ⋯.
    menu: ["Allotment notebook", "this program asked for the mouse", "⋯"],
    // A blank screen: its rows, each a first step.
    made: ["A blank screen. Start it with a tile here:", "t  the outline", "o  open a screen…"],
    // Two readers to zoom one of, a link to light and a menu to open: the Esc rule's three nested things.
    esc: ["Allotment notebook", "Bike shed"],
    // One note in two readers: the wide one bands its headings, the narrow one draws them as written.
    headings: ["Headings and dividers", "▾ ## Beds", "Water butts"],
    // The component library on the heading styles' page: its tabs, its parts, the minimal example.
    library: ["Heading styles", "1 overview", "Minimal example"],
  };

  test("one section per reuse-map row, in the map's order, each labelled with its part and file, drawn by the part", async () => {
    expect(SECTIONS.map(s => s.key)).toEqual(Object.keys(marks));
    for (let i = 0; i < SECTIONS.length; i++) {
      if (i < 10) ch(i === 9 ? "0" : String(i + 1)); else ch("j");   // past ten: the next one down
      const s = SECTIONS[i]!;
      await until(() => marks[s.key]!.every(m => screen().includes(m)), `section ${s.key}: ${marks[s.key]!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
      const text = screen();
      expect(text).toContain(`${i + 1} · ${s.need} · ${s.part}`.slice(0, 120));
      expect(text).toContain(s.files.slice(0, 60));
      expect(S().focus).toBe("index");
    }
  }, 60_000);

  test("the note section shows one reader (PIE-426): the BBS message reader is the same surface, not a parallel version", async () => {
    ch("1");
    await until(() => marks.note!.every(m => screen().includes(m)), "the note section");
    const stage = screen();
    expect(stage).not.toContain("parallel version");
    expect(stage).not.toContain("BBS Reader");
  });

  test("the index works by mouse: a click picks a section; a click in the part gives it the keys, esc gives them back", async () => {
    const spine = SECTIONS.findIndex(s => s.key === "spine");
    press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + spine * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + spine * 2 });
    expect(S().sel).toBe(spine);
    const r = S().stageRect;
    press({ kind: "mouse", action: "down", button: 0, x: r.col + 5, y: r.row + 5 }); press({ kind: "mouse", action: "up", button: 0, x: r.col + 5, y: r.row + 5 });
    expect(S().focus).toBe("stage");
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
  });

  test("editing works in a section, by keys: e, type, ctrl+s writes to the showcase outline", async () => {
    ch("5"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // e arms the edit (edit.arm): the reader's frame asks, nothing opens until ⏎.
    ch("e");
    const desk = () => S().stages.get(4).top;
    expect(screen()).toContain("✎ edit? ");
    expect(desk().describe().panes[0].editing).toBeFalsy();
    press({ kind: "enter" });
    await until(() => !!desk().describe().panes[0].editing, "the whiteboard in an edit", 5000);
    for (let i = 0; i < 5; i++) press({ kind: "pgdn" });            // to the last line, however it wraps
    press({ kind: "end" });
    for (const c of " Mind the oven.") ch(c);
    press({ kind: "char", ch: "s", ctrl: true });
    await until(() => !desk().describe().panes[0].editing?.dirty, "the save", 5000);
    const wb = await board.get(seeded.notes.whiteboard.id);
    expect(wb!.text.split("\n").at(-1)).toContain("Mind the oven.");
    // Esc backs out through the part (a draft first, if still open), then to the index; never past it.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("agents: act shows a section, never while the person is in one, and reaches the section's own actions", async () => {
    ch("1"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // The person is working in section 1: an agent can't move them out of it (once they've paused, too).
    (app as any).lastInput = 0;
    await expect(app.act({ action: "section", args: { name: "selection" }, as: "test-agent" })).rejects.toThrow(/the person is in section 1/);
    expect(S().focus).toBe("stage");
    expect(S().sel).toBe(0);
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
    (app as any).lastInput = 0;
    const r = await app.act({ action: "section", args: { name: "selection" }, as: "test-agent" }) as any;
    expect(r).toEqual({ section: SECTIONS.findIndex(s => s.key === "selection") + 1, key: "selection" });
    expect(S().focus).toBe("index");
    expect((app as any).message).toContain(`an agent (test-agent) showed section ${SECTIONS.findIndex(s => s.key === "selection") + 1}`);
    const listed = (app.actions() as any).actions.map((a: any) => a.name);
    expect(listed).toContain("section");
    expect(listed).toContain("select");
    // A note action runs in the section's reader, attributed to the agent.
    const sel = await app.act({ action: "select", args: { text: "red lentils" }, as: "test-agent" }) as any;
    expect(JSON.stringify(sel)).toContain("red lentils");
    expect(app.describe()).toMatchObject({ screen: "showcase", state: { kind: "showcase", section: { key: "selection" }, focus: "index" } });
    await expect(app.act({ action: "section", args: { name: "nope" }, as: "test-agent" })).rejects.toThrow(/no section nope/);
    // The shell's actions stay the App's on the showcase: the stage takes only its own (PIE-514).
    expect(await app.act({ action: "screen.list", as: "test-agent" })).toMatchObject({ stack: expect.any(Array) });
  }, 20_000);

  test("a remote MCP client's write is said on the status line with the note's title (PIE-615)", async () => {
    const { actorOf, applyWrite } = await import("../src/mcp-writes");
    const note = seeded.notes.remoteWrites;
    await applyWrite(board, { tool: "outline_comment", blockId: note.id, input: { whole: true, body: "Compost delivered.", requestId: "showcase-flash" } }, { level: "full", actor: actorOf(REMOTE_CLIENT), uri: id => id });
    await until(() => String((app as any).message ?? "").includes("mcp:chat.example.test"), "the remote write said", 8000);
    await until(() => String((app as any).message).includes("commented on “Remote writes"), "the comment said by its note", 8000);
    expect((app as any).message).toBe("mcp:chat.example.test commented on “Remote writes and the netmail queue” · a remote MCP write");
  });

  test("the headings section (PIE-599): the wide reader bands its headings, the narrow one beside it draws them as written; ) stops on a styled heading and f folds its section", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "headings" }, as: "test-agent" })).toMatchObject({ key: "headings" });
    await until(() => screen().includes("Water butts") && screen().includes("▾ ## Beds"), "both readers on the headings note", 8000);
    expect(screen()).toMatch(/[▓▒░]{3}.*▾ Y O U R   C A L L S.*[▓▒░]/);
    // The person goes in: ( ) in the wide reader stops on the first heading, f folds its section there only.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch(")");
    ch("f");
    await until(() => /▸ Y O U R   C A L L S · \d+ lines? folded/.test(screen()), "the first heading folded", 5000);
    expect(screen()).toContain("▾ # Your calls");
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("the scroll section (PIE-622): End puts the last line on the edge, End again brings it to the middle, blank under it; by keys and act; reader.overscroll none stops at the edge", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "scroll" }, as: "test-agent" })).toMatchObject({ key: "scroll" });
    await until(() => screen().includes("End (or G) goes to the last line"), "the long note", 8000);
    const scroll = (args: Record<string, unknown>) => app.act({ action: "scroll", args, tile: "reader", as: "test-agent" }) as Promise<any>;
    // What an agent's view.get says (the viewport the person's keys left, read once it's painted).
    const view = async () => { screen(); return ((await app.act({ action: "view.get", tile: "reader", as: "test-agent" })) as any).viewport; };
    // (The agent's first act adds its line to the reader's header, a row less room: read where it is once painted.)
    expect(await scroll({ to: "end" })).toMatchObject({ atEnd: true, past: 0 });
    await until(() => screen().includes("The last cane"), "the last line drawn", 5000);
    const edge = await view();
    expect(edge).toMatchObject({ atEnd: true, past: 0, top: edge.total - edge.room });
    const half = await scroll({ to: "end" });
    expect(half).toMatchObject({ atEnd: true, past: Math.floor(edge.room / 2), top: edge.top + Math.floor(edge.room / 2) });
    expect(await view()).toMatchObject({ top: half.top, past: half.past });
    // The wheel's rows past that stop there.
    expect(await scroll({ by: 5 })).toMatchObject({ top: half.top });
    // The same by the person's keys: Home, End, End.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    press({ kind: "home" });
    expect(await view()).toMatchObject({ top: 0, atEnd: false });
    press({ kind: "end" });
    expect(await view()).toMatchObject({ top: edge.top, atEnd: true, past: 0 });
    ch("G");
    expect(await view()).toMatchObject({ top: half.top, atEnd: true, past: half.past });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // none: kept for the next start, and End stays on the edge.
    (app as any).lastInput = 0;
    expect(await app.act({ action: "reader.overscroll", args: { rows: "none" }, as: "test-agent" })).toEqual({ rows: "none" });
    expect(JSON.parse(readFileSync(join(process.env.EP0CH_STATE!, "reader-overscroll.json"), "utf8"))).toEqual({ rows: "none" });
    screen();
    expect(await scroll({ to: "end" })).toMatchObject({ top: edge.top, past: 0 });
    expect(await scroll({ to: "end" })).toMatchObject({ top: edge.top, past: 0 });
    await expect(app.act({ action: "reader.overscroll", args: { rows: "most" }, as: "test-agent" })).rejects.toThrow(/half, none or a number/);
    expect(await app.act({ action: "reader.overscroll", args: { rows: 4 }, as: "test-agent" })).toEqual({ rows: 4 });
    expect(await app.act({ action: "reader.overscroll", args: { rows: "half" }, as: "test-agent" })).toEqual({ rows: "half" });
  }, 20_000);

  test("the library section (PIE-618): an agent picks through every combination and copies a variation's source; the outline's own style is a value", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "library" }, as: "test-agent" })).toMatchObject({ key: "library" });
    await until(() => screen().includes("Minimal example"), "the library's overview", 8000);
    expect(await app.act({ action: "library.pick", args: { axis: "heading-pattern", value: "dots" }, as: "test-agent" })).toMatchObject({ on: true, matching: 486 });
    expect(await app.act({ action: "library.pick", args: { axis: "heading-tone", value: "green" }, as: "test-agent" })).toMatchObject({ matching: 81 });
    await until(() => screen().includes("81 of 2430 match · 1–8 shown"), "the picked space drawn", 5000);
    const copy: any = await app.act({ action: "library.copy", args: { n: 1 }, as: "test-agent" });
    expect(copy.source).toContain("[heading-pattern::dots]");
    expect(copy.source).toContain("[heading-tone::green]");
    await app.act({ action: "library.axis", args: { key: "heading" }, as: "test-agent" });
    // The outline's own style joins the values once the service's answer is in (the built-ins stand until then).
    const values = () => (S().stage(SECTIONS.findIndex(s => s.key === "library")).top.describe().library.variations as any[]).map(v => v.values.heading);
    await until(() => (screen(), values().includes("plot")), "the outline's plot style among the values", 8000);
    await app.act({ action: "library.clear", args: {}, as: "test-agent" });
  }, 20_000);

  test("the actions section's registry list: the wheel and keys pick through registry.pick; an agent's pick leaves the person's selection", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "actions" }, as: "test-agent" })).toMatchObject({ key: "actions" });
    const list = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.pane("registry"); };
    await until(() => !!list(), "the registry list", 5000);
    const before = list().picked;
    const r = await app.act({ action: "registry.pick", args: { n: 3 }, as: "test-agent" }) as any;
    expect(r).toMatchObject({ tile: "registry", n: 3, ran: false });
    expect(typeof r.action).toBe("string");
    expect(list().picked).toBe(before);
    // The person's wheel over the list moves their selection, through the same action.
    const at = S().stageRect, t = (S().stage(SECTIONS.findIndex(s => s.key === "actions")).top.describe().panes as any[]).find(x => x.name === "registry");
    press({ kind: "mouse", action: "wheel-down", button: 0, x: at.col + t.rect.col + 3, y: at.row + t.rect.row + 3 });
    await until(() => list().picked === before + 1, "the wheel's pick", 3000);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("tile.preview, driven by an agent: the reader's opens land in a detail opened beside it, the reader keeps its note", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    await until(() => stage().layoutGet().tiles.find((t: any) => t.name === "reader")?.showing?.id === seeded.notes.notebook.id, "the notebook in the reader", 5000);
    const r = await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" }) as any;
    expect(r).toMatchObject({ tile: "reader-preview", kind: "detail", from: "reader" });
    const tiles = () => stage().layoutGet().tiles as any[];
    expect(tiles().find(t => t.name === "reader").link).toBe("reader-preview");
    // A link followed in the reader lands in the preview; the reader still shows the notebook.
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBeTruthy();
    await until(() => tiles().find(t => t.name === "reader-preview")?.showing?.id === f.opened, "the link in the preview", 5000);
    expect(tiles().find(t => t.name === "reader").showing.id).toBe(seeded.notes.notebook.id);
    // Again: that preview, not a second one.
    expect(await app.act({ action: "tile.preview", tile: "reader", as: "test-agent" })).toMatchObject({ tile: "reader-preview", existing: true });
    expect(tiles().filter(t => t.name.startsWith("reader-preview")).length).toBe(1);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("a session's files (PIE-602): an agent's open file= lands the Markdown file drawn as the preview draws it, any other through the file Resource reader, diff=true its changes", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "preview" }, as: "test-agent" })).toMatchObject({ key: "preview" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "preview")).top; };
    const showing = () => (stage().layoutGet().tiles as any[]).map(t => t.showing?.id).filter(Boolean) as string[];
    const [md, txt] = RECENT_FILES();
    const opened = await app.act({ action: "open", args: { file: md!.file }, as: "test-agent" }) as any;
    expect(opened.id).toBe(`file:${md!.file}`);
    await until(() => showing().includes(`file:${md!.file}`), "the bed plan where opens land", 5000);
    await until(() => screen().includes("Net the brassicas before the pigeons find them."), "the Markdown drawn", 5000);
    const other = await app.act({ action: "open", args: { file: txt!.file }, as: "test-agent" }) as any;
    expect(other.id).toStartWith("resource:");
    await until(() => screen().includes("Scarlet Emperor"), "the seed list through the Resource reader", 8000);
    const diff = await app.act({ action: "open", args: { file: md!.file, diff: true }, as: "test-agent" }) as any;
    expect(diff.id).toBe(`file-diff:${md!.file}`);
    await expect(app.act({ action: "open", args: { file: "beds/plan.md" }, as: "test-agent" })).rejects.toThrow(/absolute path/);
    await expect(app.act({ action: "open", args: {}, as: "test-agent" })).rejects.toThrow(/id=<block id> or file=/);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("links (PIE-541): a labelled ref inside italics is drawn in its link colour, italic, with every escape whole; an agent follows it", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "entity" }, as: "test-agent" })).toMatchObject({ key: "entity" });
    const stage = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "entity")).top; };
    const tiles = () => stage().layoutGet().tiles as any[];
    await until(() => tiles().find(t => t.name === "reader")?.showing?.id === seeded.notes.shed.id, "the shed in the reader", 5000);
    await until(() => screen().includes("The pump's spare valves are on the kitchen whiteboard."), "the italic line drawn", 5000);
    const raw = sc.render(app).lines;
    expect(raw.join("\n").match(/(?<!\x1b)\[[\d;]*m/g)).toBeNull();
    const row = raw.find(l => plain(l).includes("The pump's spare valves"))!;
    const at = row.indexOf("the kitchen whiteboard");
    expect(row.slice(0, at)).toContain("\x1b[3m");
    expect(row.slice(0, at).split("\x1b[").at(-1)).toBe(fg(C.lcyan).slice(2));
    // The note's first link is the one in italics.
    expect(JSON.stringify(await app.act({ action: "link.select", tile: "reader", args: { n: 1 }, as: "test-agent" }))).toContain("the kitchen whiteboard");
    const f = await app.act({ action: "link.follow", tile: "reader", args: { n: 1 }, as: "test-agent" }) as any;
    expect(f.opened).toBe(seeded.notes.whiteboard.id);
    expect(S().focus).toBe("index");
  }, 20_000);

  test("terminal: the tile's program copies (OSC 52), and the door passes it on to the person's terminal, said as the tile's", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "terminal" }, as: "test-agent" })).toMatchObject({ key: "terminal" });
    await until(() => screen().includes("copy from it as Claude Code does"), "the shell in the stage", 8000);
    const copying = (what: string, done: string) => `printf '\\033]52;c;?\\007'; printf '\\033]52;c;%s\\007' "$(printf '${what}' | base64)"; echo ${done}-$((6*7))`;
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    // An agent typing it into the shell: the person isn't using the tile, so it isn't passed on, and the toast says so.
    for (let i = 0; ; i++) {
      try { await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Pull the bindweed", "agent") + "\\n" }, as: "test-agent" }); break; }
      catch (e) { if (i > 50 || !/isn't running/.test((e as Error).message)) throw e; await Bun.sleep(100); }
    }
    await until(() => screen().includes("agent-42"), "the agent's command to run", 8000);
    await until(() => (app as any).toast?.text === "not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again", "the toast", 5000);
    app.redraw(); await until(() => painted.map(plain).join("\n").includes("✗ not copied from sh · you haven't typed or clicked in it for 2 min · click in it, then copy again"), "the toast drawn", 3000);
    expect(copies()).toEqual([]);
    // The person clicks in the tile and types it.
    const r = S().stageRect, t = (S().stages.get(SECTIONS.findIndex(s => s.key === "terminal")).top.describe().panes as any[]).find(x => x.kind === "pty");
    const at = { x: r.col + t.rect.col + 3, y: r.row + t.rect.row + 3 };
    press({ kind: "mouse", action: "down", button: 0, ...at }); press({ kind: "mouse", action: "up", button: 0, ...at });
    for (const c of copying("Turn the compost", "copied")) ch(c);
    press({ kind: "enter" });
    await until(() => copies().length > 0, "the copy written to the terminal", 8000);
    await Bun.sleep(150);
    expect(copies()).toEqual([osc52("Turn the compost")]);
    expect((app as any).toast?.text).toBe("copied from sh · 16 chars");
    app.redraw(); await until(() => painted.map(plain).join("\n").includes("✓ copied from sh · 16 chars"), "the toast drawn", 3000);
    // Back to the door: the click a moment ago still counts, so the same agent's copy now reaches the person.
    press({ kind: "char", ch: "]", ctrl: true });
    await app.act({ action: "tile.type", tile: "t2", args: { text: copying("Mulch the roses", "again") + "\\n" }, as: "test-agent" });
    await until(() => copies().length > 1, "the second copy written to the terminal", 8000);
    expect(copies().at(-1)).toBe(osc52("Mulch the roses"));
    press({ kind: "esc" });
  }, 20_000);

  test("the menu section (PIE-492): an agent's tile.menu answers rows; the ⋯ and a right-click open it; a row runs as the person; the terminal keeps its right-click", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "menu" }, as: "test-agent" });
    await until(() => marks.menu!.every(m => screen().includes(m)), "the menu section");
    const stage = () => S().stages.get(S().sel).top;
    const overlay = () => stage().overlays.top() as { name: string; items: any[] } | null;
    // An agent: the rows as data, nothing drawn.
    const out = await app.act({ action: "tile.menu", tile: "reader", args: {}, as: "test-agent" }) as any;
    expect(out.rows.map((r: any) => r.group)).toEqual(expect.arrayContaining(["Tile", "Note"]));
    expect(out.rows.find((r: any) => r.action === "tile.zoom")).toMatchObject({ label: "zoom", key: "ctrl+w z" });
    expect(overlay()).toBeNull();
    const at = S().stageRect, tiles = () => stage().describe().panes as any[];
    const click = (x: number, y: number, button = 0) => { press({ kind: "mouse", action: "down", button, x, y }); press({ kind: "mouse", action: "up", button, x, y }); };
    // The person: a click on the reader's ⋯ opens it; one click on zoom runs it.
    sc.render(app);
    const b = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "reader");
    click(at.col + b.from, at.row + b.row);
    await until(() => overlay()?.name === "tile menu", "the ⋯ opens the reader's menu");
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /\bzoom\s+\^W z/.test(l));
    expect(y).toBeGreaterThan(0);
    // The menu's row, not the index's "open, split, zoom" a scrolled index can put on the same row.
    click(rows[y]!.search(/\bzoom\s+\^W z/), y);
    await until(() => stage().zoom !== null, "zoom ran from the menu");
    expect(overlay()).toBeNull();
    await app.act({ action: "tile.zoom", tile: "reader", args: { on: false }, as: "test-agent" }).catch(() => stage().dispatch.press("tile.zoom", { on: false }, "reader"));
    // A right-click in the reader opens it at the pointer; esc puts it away.
    sc.render(app);
    const r = tiles().find(x => x.name === "reader").rect;
    click(at.col + r.col + 4, at.row + r.row + 4, 2);
    await until(() => overlay()?.name === "tile menu", "a right-click opens the reader's menu");
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The terminal's program asked for the mouse: its right-click is the program's, and its ⋯ still opens the menu.
    await until(() => stage().pane("clicks")?.wantsMouse?.() === true, "the program asked for the mouse");
    sc.render(app);
    const t = tiles().find(x => x.name === "clicks").rect;
    click(at.col + t.col + 4, at.row + t.row + 4, 2);
    expect(overlay()).toBeNull();
    sc.render(app);
    const tb = (stage().menuButtons as any[]).find(x => stage().nameOf(x.id) === "clicks");
    click(at.col + tb.from, at.row + tb.row);
    await until(() => overlay()?.name === "tile menu", "the terminal's ⋯ opens its menu");
    expect(overlay()!.items.map(x => x.group)).toContain("Terminal");
    press({ kind: "esc" });
    expect(overlay()).toBeNull();
    // The right-click went into the terminal (a click there types in it): ctrl+] leaves it, then esc to the index.
    press({ kind: "char", ch: "]", ctrl: true });
    for (let i = 0; i < 4 && S().focus !== "index"; i++) press({ kind: "esc" });
    expect(S().focus).toBe("index");
  }, 20_000);

  test("made, by the person: a blank screen started from a detail; a click on its + New note runs note.new, as ctrl+n does, and writes in that detail", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // d: a detail in the blank's place (its row, as the person picks it).
    press({ kind: "char", ch: "d" });
    await until(() => (stage().layoutGet().tiles as any[]).some(t => t.kind === "detail"), "a detail in the blank's place");
    await until(() => screen().includes("+ New note"), "the empty detail's + New note");
    // A click on + New note, as a mouse event on the screen: the same note.new ctrl+n runs.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("+ New note")), x = rows[y]!.indexOf("+ New note") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    const detail = () => stage().pane((stage().layoutGet().tiles as any[]).find(t => t.kind === "detail").name);
    await until(() => !!detail()?.surface?.draft, "the new note's edit in the detail, by the click", 8000);
    const id = detail().surface.draft.blockId;
    expect(await board.get(id)).toBeTruthy();
    // Nothing typed: esc puts it in the trash, and the detail is empty again.
    press({ kind: "esc" });
    const end = Date.now() + 5000;
    while (!(await board.isTrashed(id))) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    for (let i = 0; i < 6 && S().focus === "stage"; i++) press({ kind: "esc" });
    // Put back as the next test expects it: a fresh blank stage.
    S().stages.delete(S().sel);
  }, 20_000);

  test("made (PIE-565): a blank screen built through act, saved as a screen note, opened again by name, then deleted", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "made" }, as: "test-agent" });
    await until(() => marks.made!.every(m => screen().includes(m)), "the blank screen");
    const stage = () => S().stages.get(S().sel).top;
    const tiles = () => stage().layoutGet().tiles as any[];
    await app.act({ action: "blank.fill", tile: "blank", args: { kind: "tree" }, as: "test-agent" });
    await app.act({ action: "tile.open", tile: "tree", args: { kind: "detail", where: "right" }, as: "test-agent" });
    await app.act({ action: "tile.link", tile: "tree", args: { to: "detail" }, as: "test-agent" });
    expect(tiles().map(t => t.kind)).toEqual(["tree", "detail"]);
    const saved = await app.act({ action: "screen.save", args: { name: "allotment-work" }, as: "test-agent" }) as any;
    expect(saved).toMatchObject({ screen: "allotment-work", created: true, tiles: ["tree", "detail"] });
    const note = await board.get(saved.note);
    expect(note!.props).toMatchObject({ type: "screen", screen: "allotment-work" });
    expect(note!.author).toBe("test-agent");               // attributed to the agent that saved it
    // Opened again by name, as `ep0ch --screen allotment-work` does: the same tiles, the outline's opens landing in the detail.
    await app.act({ action: "screen.open", args: { name: "allotment-work" }, as: "test-agent" });
    const top = () => app.screens().at(-1) as any;
    await until(() => top().name === "allotment-work", "the saved screen opened");
    expect((top().layoutGet().tiles as any[]).map(t => [t.name, t.link ?? null])).toEqual([["tree", "detail"], ["detail", null]]);
    await app.act({ action: "screen.back", args: {}, as: "test-agent" });
    await until(() => top() === sc, "back on the showcase");
    expect(await app.act({ action: "screen.delete", args: { name: "allotment-work" }, as: "test-agent" })).toMatchObject({ trashed: true });
    expect(await board.isTrashed(saved.note)).toBe(true);
  }, 20_000);

  test("drafts: the shed reader's kept-edit line, by act: [show them] opens the edit's own change against the note beside it, and [add them] puts it into an edit", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "drafts" }, as: "test-agent" });
    await until(() => marks.drafts!.every(m => screen().includes(m)), "the drafts section");
    const stage = () => S().stages.get(S().sel).top;
    const name = "reader3";                                        // the third reader shows the shed
    // An agent reads the diff as data (nothing drawn); the person's [diff] opens a reader beside.
    expect(await app.act({ action: "unsent.diff", tile: name, args: {}, as: "test-agent" })).toMatchObject({ diff: expect.stringContaining("+ Oil the padlock before winter.") });
    const els = await app.act({ action: "elements", tile: name, args: {}, as: "test-agent" }) as any;
    const diff = (els.elements as any[]).find(e => e.control === "diff");
    expect(diff).toBeTruthy();
    await stage().dispatch.press("element.open", { n: diff.n }, name);
    const diffView = () => (stage().describe().panes as any[]).map(x => stage().pane(x.name)).find((p: any) => p?.msg?.id?.startsWith?.("unsent:"));
    await until(() => !!diffView(), "the diff beside the shed");
    expect(diffView().msg.text).toContain("+ Oil the padlock before winter.");
    expect(diffView().readOnly).toBe(true);
    // [add them]: the shed reader opens its edit with the unsent line in it, lit as a patch.
    await stage().dispatch.press("unsent.add", {}, name);
    await until(() => !!stage().pane(name).surface.draft, "the edit open");
    expect(stage().pane(name).surface.draft.text).toContain("Oil the padlock before winter.");
    await stage().dispatch.press("edit.close", { discard: true }, name);
    press({ kind: "esc" });
  }, 20_000);

  test("kept edits: the three cases by act: a new line is shown and added as one patch, an edit the note has settles itself, an old conflict folds to a chip and compares both versions", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "kept" }, as: "test-agent" });
    await until(() => marks.kept!.every(m => screen().includes(m)), `the kept section: ${marks.kept!.filter(m => !screen().includes(m)).join(" | ")}`);
    const stage = () => S().stages.get(S().sel).top;
    // Still new: the rota's edit adds a line the note lacks; the note's other change since isn't in the comparison.
    const rota = await app.act({ action: "unsent.diff", tile: "rota", args: {}, as: "test-agent" }) as any;
    expect(rota).toMatchObject({ basis: "three-way", verdict: "new", said: expect.stringContaining("1 line from your edit") });
    expect(rota.diff).toContain("+ Check the seed trays on Fridays.");
    expect(rota.diff).not.toContain("Wipe the shelves");
    await stage().dispatch.press("unsent.add", {}, "rota");
    await until(() => !!stage().pane("rota").surface.draft, "the rota's edit open");
    expect(stage().pane("rota").surface.draft.text).toContain("Shut the vents at dusk.\nCheck the seed trays on Fridays.\nWipe the shelves on Sundays.");
    await stage().dispatch.press("edit.close", { discard: true }, "rota");
    // Already in the note: settled when the reader opened; a copy is kept, and nothing is asked.
    const hedge = S().notes.hedge;
    expect(unsent(`edit:${hedge.id}`)).toBeNull();
    await expect(app.act({ action: "unsent.diff", tile: "hedge", args: {}, as: "test-agent" })).rejects.toThrow("nothing is kept here (edit)");
    // An old edit with a conflict: folded to a chip; [show] opens it, and the comparison shows both versions.
    await app.act({ action: "unsent.show", tile: "compost", args: {}, as: "test-agent" });
    const compost = await app.act({ action: "unsent.diff", tile: "compost", args: {}, as: "test-agent" }) as any;
    expect(compost).toMatchObject({ verdict: "conflict", hunks: [{ state: "conflict", removed: ["Turn the heap monthly."], added: ["Turn the heap weekly in summer."], now: ["Turn the heap every fortnight."] }] });
    expect(compost.diff).toContain("the note now: Turn the heap every fortnight.");
    press({ kind: "esc" });
  }, 20_000);

  test("undo (PIE-621): a big paste is one step, ctrl+z and ctrl+y by keys; copy by a drag's release and by shift+arrows then alt+c; an agent's undo and redo through act, its own only", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "undo" }, as: "test-agent" });
    await until(() => marks.undo!.every(m => screen().includes(m)), `the undo section: ${marks.undo!.filter(m => !screen().includes(m)).join(" | ")}`, 8000);
    const stage = () => S().stages.get(S().sel).top;
    const draft = () => stage().pane("reader").surface.draft;
    expect(draft().text).toContain("# Pantry inventory");
    // An agent can't take back the person's paste: its undo is its own.
    await expect(app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).rejects.toThrow("this agent has no edit to undo");
    // The person, by keys: into the stage and into the edit (⏎ enters one the keys aren't in yet), ctrl+z takes the
    // whole paste back, ctrl+y puts it back, ctrl+z again.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    press({ kind: "enter" });
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "the paste undone in one step");
    expect(draft().note).toContain("undid the paste (42 lines)");
    press({ kind: "char", ch: "y", ctrl: true });
    await until(() => draft().text.includes("Pantry"), "the paste redone");
    press({ kind: "char", ch: "z", ctrl: true });
    await until(() => !draft().text.includes("Pantry"), "undone again");
    expect(draft().dirty).toBe(false);
    // By mouse: a drag across [page::…] on the first line, and its release copies it (OSC 52).
    const before = written.length;
    const copies = () => written.slice(before).filter(w => w.includes("\x1b]52;"));
    const rows = sc.render(app).lines.map(plain);
    const y = rows.findIndex(l => l.includes("Jar labels [page::Jar labels]"));
    expect(y).toBeGreaterThan(0);
    const x0 = rows[y]!.indexOf("[page::"), x1 = x0 + "[page::Jar labels]".length;
    press({ kind: "mouse", action: "down", button: 0, x: x0, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x0 + 4, y });
    press({ kind: "mouse", action: "drag", button: 0, x: x1, y });
    press({ kind: "mouse", action: "up", button: 0, x: x1, y });
    await until(() => copies().length > 0, "the drag's selection copied on release");
    expect(copies()).toEqual([osc52("[page::Jar labels]")]);
    expect(draft().text).not.toContain("Pantry");                    // copying never types
    // By keys: home, shift+→ over the title, then alt+c (cmd+c where the terminal sends it).
    press({ kind: "home" });
    for (let i = 0; i < "Jar".length; i++) press({ kind: "right", shift: true });
    expect(draft().selectedText()).toBe("Jar");
    press({ kind: "alt", ch: "c" });
    await until(() => copies().length > 1, "alt+c copied the selection");
    expect(copies().at(-1)).toBe(osc52("Jar"));
    expect(screen()).toContain("[copy]");
    // A double click's word, copied once it's selected.
    const rows2 = sc.render(app).lines.map(plain), y2 = rows2.findIndex(l => l.includes("Rota: whoever fills")), x2 = rows2[y2]!.indexOf("whoever") + 2;
    for (let i = 0; i < 2; i++) { press({ kind: "mouse", action: "down", button: 0, x: x2, y: y2 }); press({ kind: "mouse", action: "up", button: 0, x: x2, y: y2 }); }
    await until(() => copies().length > 2, "the double click's word copied");
    expect(copies().at(-1)).toBe(osc52("whoever"));
    await stage().dispatch.press("edit.close", { discard: true }, "reader");
    await until(() => !draft(), "the person's edit closed");
    // An agent in an edit of its own, through act: its paste, its undo, its redo.
    await app.act({ action: "edit", tile: "reader", as: "test-agent" });
    await until(() => !!draft(), "the agent's edit open");
    await app.act({ action: "draft.place", tile: "reader", args: { line: 1 }, as: "test-agent" });
    expect(await app.act({ action: "draft.paste", tile: "reader", args: { text: " (wiped Sunday)" }, as: "test-agent" })).toMatchObject({ line: 1 });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    expect(await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" })).toMatchObject({ left: 0, redo: 1 });
    expect(draft().text.split("\n")[0]).not.toContain("wiped");
    expect(await app.act({ action: "draft.redo", tile: "reader", as: "test-agent" })).toMatchObject({ redone: "redid the paste" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    // The note's earlier revision (the seed saved it twice), into its own edit as one step, and taken back.
    expect(await app.act({ action: "revision.restore", tile: "reader", as: "test-agent" })).toMatchObject({ revision: 1, current: 2 });
    expect(draft().text).toBe(LABELS_BEFORE);
    await app.act({ action: "draft.undo", tile: "reader", as: "test-agent" });
    expect(draft().text.split("\n")[0]).toEndWith("(wiped Sunday)");
    await app.act({ action: "edit.close", tile: "reader", args: { discard: true }, as: "test-agent" });
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
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
    const row = app.drawer.rect!.row + 1, col = plain(painted[row] ?? "").lastIndexOf("×");
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
    const bar = () => { (app as any).paint(); return plain(painted.at(-1) ?? ""); };
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

  test("search, driven by an agent: the section's own desk answers the service's forgiving search, the person's overlay left alone", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    const r = await app.act({ action: "search", args: { query: "alotment notebok" }, as: "test-agent" }) as any;
    expect(r.query).toBe("alotment notebok");
    expect(r.hits[0]).toMatchObject({ n: 1, title: "Allotment notebook" });
    expect(r.hits.map((h: any) => h.title)).toContain("Allotment figures");
    // Any word order, punctuation folded.
    const lentil = await app.act({ action: "search", args: { query: "soup, lentil" }, as: "test-agent" }) as any;
    expect(lentil.hits[0].title).toBe("Lentil soup");
    expect(S().focus).toBe("index");
  }, 20_000);

  test("search, from a shell (PIE-534): the section opened through act; find --query, show $(find --ids) and export answer from the same outline", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
    // The section's note says what to try from a shell, under the search overlay the section opens with.
    await until(() => screen().includes("From a shell"), "the finding note's shell section");
    expect(SECTIONS.find(x => x.key === "search")!.aside).toContain("ep0ch export");
    const cli = async (...args: string[]) => {
      const p = Bun.spawn(["bun", join(import.meta.dir, "../src/main.ts"), ...args], { stdout: "pipe", stderr: "pipe", env: { ...process.env, EP0CH_SOCKET: scratch.sock, EP0CH_WS: scratch.name, EP0CH_CONTROL: "/nonexistent/ep0ch-test.sock" } });
      const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
      return { out, err, code };
    };
    const errand = seeded.notes.errand.id;
    const found = await cli("find", "--query", "type=errand tag=spring", "--ids");
    expect(found.out.trim()).toBe(`((${errand}))`);
    const shown = await cli("show", "--width", "70", found.out.trim());
    expect(shown.out.split("\n")[0]).toBe("Seed order for the plot");          // the ` - ` separators aren't in the title
    const out = mkdtempSync(join(tmpdir(), "ep0ch-sink-export-"));
    try {
      expect((await cli("export", "--query", "type=errand", "--children", "--out", out)).code).toBe(0);
      const file = readFileSync(join(out, `seed-order-for-the-plot-${errand.slice(0, 8)}.md`), "utf8");
      expect(file).toContain('type: "errand"\narea: "garden"\nctx: "2026-03-09 @ 09:27:29 AM"\ntag:\n  - "seeds"\n  - "spring"\n---\nSeed order for the plot\nBroad beans');
      expect(file).toContain("\n- Ask the neighbour about netting\n  She has a spare roll.\n");
    } finally { rmSync(out, { recursive: true, force: true }); }
    expect(S().focus).toBe("index");
  }, 30_000);

  test("search: (( forgives a typo and another order through act, from the note read there; / asks from that note, then Jev keeps the pick", async () => {
    (app as any).lastInput = 0;
    const finding = seeded.notes.finding.id;
    const asked: { query: string; semantic: boolean; near?: string }[] = [];
    const real = board.searchBlocks.bind(board);
    // Jev, as a host with a key would answer: the same hits, reversed, said "ranked".
    board.searchBlocks = async (text, opts = {}) => {
      asked.push({ query: text, semantic: !!opts.semantic, near: opts.near });
      const r = await real(text, { ...opts, semantic: false });
      return opts.semantic ? { ...r, matches: [...r.matches].reverse(), semantic: { status: "ranked" } } : r;
    };
    // A scratch host has no Jev key (test/scratch.ts): the overlay that said so is asked again, of the stand-in.
    jevOff.delete(board);
    try {
      S().stages.delete(SECTIONS.findIndex(s => s.key === "search"));   // the search stage built again, its overlay asking the stand-in
      expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 6, key: "search" });
      await until(() => screen().includes("hit(s)"), "the stage's overlay", 5000);
      // (( in the reader's note: the same search a draft's popup asks, with a typo in each word, then another order.
      const typo = await app.act({ action: "complete", args: { text: "((alotment notebok" }, as: "test-agent" }) as any;
      expect(typo).toMatchObject({ kind: "block", query: "alotment notebok" });
      expect(typo.items[0]).toMatchObject({ n: 1, label: "Allotment notebook", insertion: `((${seeded.notes.notebook.id}))` });
      const order = await app.act({ action: "complete", args: { text: "((soup lentl" }, as: "test-agent" }) as any;
      expect(order.items[0].label).toBe("Lentil soup");
      expect(asked.filter(a => a.query === "soup lentl").map(a => a.near)).toEqual([finding]);
      // The / overlay the section opened asked from the note under it; after a pause, Jev's order with the pick kept.
      await until(() => screen().includes("jev ranked"), "Jev's order in the overlay", 5000);
      expect(asked.some(a => a.query === "alotment notebok" && a.semantic && a.near === finding)).toBe(true);
      expect(screen().split("\n").find(l => l.includes("/ alotment notebok"))).toContain("jev ranked");
      // Jev's order (the stand-in reversed it) puts another note first, and the notebook, picked before, is still the
      // one read on the right: the first list row and the picked note share the overlay's first row.
      const rows = screen().split("\n"), at = rows.findIndex(l => l.includes("/ alotment notebok"));
      const first = rows[at + 2]!;
      expect(first).not.toMatch(/│ Allotment notebook\s+│ Allotment notebook/);
      expect(first).toMatch(/│ Allotment notebook\s+│/);
      expect(S().focus).toBe("index");
    } finally { board.searchBlocks = real; }
  }, 20_000);

  test("edit (PIE-626): completion on every line: a property's value and a filter's words, through act, from the same completer", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "edit" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(s => s.key === "edit") + 1, key: "edit" });
    // The property panel's value for [heading::]: the schemas' values with this outline's own plot style among them.
    const value = await app.act({ action: "complete", args: { text: "pl", key: "heading" }, as: "test-agent" }) as any;
    expect(value).toMatchObject({ kind: "filter-value", query: "pl" });
    expect(value.items.map((i: any) => i.insertion)).toContain("plot");
    // A key in a draft: the same list [head offers while typing.
    const key = await app.act({ action: "complete", args: { text: "[heading-p" }, as: "test-agent" }) as any;
    expect(key.items.map((i: any) => i.insertion)).toEqual(["[heading-pattern::", "[heading-padding::"]);
  }, 20_000);

  test("callouts (PIE-538): Obsidian's examples drawn nested and folded; folds, types and starts by keys, mouse and act", async () => {
    const id = seeded.notes.callouts.id, text = async () => (await board.get(id))!.text;
    const reads = async (has: (t: string) => boolean, what: string) => { const end = Date.now() + 5000; while (!has(await text())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); } };
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "callouts" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(s => s.key === "callouts") + 1, key: "callouts" });
    await until(() => screen().includes("You can even use multiple") && screen().includes("♨ Soup stock"), "the nested example drawn, with the outline's own type", 8000);
    let shown = screen();
    expect(shown).toContain("feel the power");                             // [!note]+ starts open
    expect(shown).not.toContain("can you see me");                         // [!note]- starts folded
    expect(shown).toContain("♨ Soup stock");                               // dish: an alias of the outline's own recipe type
    expect(shown).toMatch(/│ │ ╭─ ◆ You can even use multiple/);           // a frame in a frame in a frame
    // The list, as an agent reads it: every callout outermost first, and the outline's types.
    const list = await app.act({ action: "callout.list", as: "test-agent" }) as any;
    expect(list.callouts.map((c: any) => [c.type, c.title, c.starts])).toEqual([
      ["note", "note", "open"], ["warning", "warning", "open"], ["note", "collapse", "folded"], ["note", "expando", "open"],
      ["question", "Can callouts be nested?", "open"], ["todo", "Yes!, they can.", "open"], ["example", "You can even use multiple layers of nesting.", "open"],
      ["faq", "Are callouts foldable?", "folded"], ["tip", "Title-only callout", "open"], ["tip", "Callouts can have custom titles", "open"], ["info", "Info", "open"], ["dish", "Soup stock", "open"],
    ]);
    expect(list.types.find((t: any) => t.name === "recipe")).toMatchObject({ icon: "♨", tone: "green", aliases: ["dish"], declaredIn: seeded.notes.calloutType.id });
    // An agent unfolds one: reading state only, the text untouched.
    expect(await app.act({ action: "unfold", args: { text: "collapse" }, as: "test-agent" })).toMatchObject({ kind: "callout", folded: false });
    await until(() => screen().includes("can you see me"), "the folded callout opened");
    // An agent changes a type and a start through the note's save, attributed; its undo puts the line back.
    const typed = await app.act({ action: "callout.type", args: { n: 2, to: "danger" }, as: "test-agent" }) as any;
    expect(typed).toMatchObject({ changed: true, header: "> > [!danger] warning", recordedAs: { author: "agent", actorId: "test-agent" } });
    expect(await text()).toContain("> > [!danger] warning\n> > body body");
    await app.act({ action: "callout.undo", as: "test-agent" });
    expect(await text()).toContain("> > [!warning] warning");
    await app.act({ action: "callout.start", args: { line: (await text()).split("\n").indexOf("> [!note]+ expando") + 1, folded: true }, as: "test-agent" });
    expect(await text()).toContain("> [!note]- expando");
    await expect(app.act({ action: "callout.menu", args: { n: 1 }, as: "test-agent" })).rejects.toThrow();   // the type choice is the person's
    // The person, by keys: into the stage, [ ] to the first callout's icon, ⏎ opens the type choice, j ⏎ picks the next type.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]"); ch("]");
    press({ kind: "enter" });
    await until(() => screen().includes("note · now") && screen().includes("make it start folded (-)"), "the type choice, every choice drawn", 5000);
    expect(screen()).toContain("note · now");
    ch("j"); press({ kind: "enter" });
    await reads(t => t.includes("> [!abstract] note"), "the type changed");
    // ctrl+z: the last change here (the callout's) put back.
    press({ kind: "char", ch: "z", ctrl: true });
    await reads(t => t.includes("> [!note] note\n"), "the change undone");
    // By mouse: a click on the nested warning's title folds it.
    await until(() => screen().includes("body body"), "the nested warning drawn");
    // In the left reader (the right one shows the type's declaration).
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => /╭─ ▾ ⚠ warning/.test(l)), x = rows[y]!.search(/╭─ ▾ ⚠ warning/) + 8;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !screen().includes("body body"), "the nested callout folded by a click");
    expect(await text()).toContain("> > [!warning] warning");                // folding never writes
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("rules (PIE-600): a rule note's bands, meeting-card's card, shout's band; the card goes and comes with its property through act; R shows it as written; done-stamp stamps once", async () => {
    const id = seeded.notes.rules.id, text = async (of = id) => (await board.get(of))!.text;
    const at = SECTIONS.findIndex(s => s.key === "rules");
    const reader = (n = 0) => S().stages.get(at)?.top.pane(n ? "reader2" : "reader")?.describe() as any;
    const drawn = () => (reader()?.decorations?.drawn ?? []) as { rule: string; place: string; status: string; on: string; line: number }[];
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "rules" }, as: "test-agent" })).toEqual({ section: at + 1, key: "rules" });
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT") && screen().includes("[meeting]") && drawn().filter(d => d.status === "ready").length === 4, "the card, the bands and the shout", 12_000)
      .catch(e => { throw new Error(`${e.message}\n${screen()}\n${JSON.stringify(reader())?.slice(0, 2000)}`); });
    // The rule note's bands are in the headings' places, shout's in the line's; the card above the note.
    expect(drawn().map(d => [d.rule, d.place, d.on, d.line])).toEqual([
      ["meeting-card/card", "above", "block", 0], ["shout/shout", "replace", "text", 13],
      ["committee-bands", "replace", "construct", 6], ["committee-bands", "replace", "construct", 10],
    ]);
    let shown = screen();
    expect(shown).not.toContain("Close the cold frame tonight!!!");
    expect(shown).toContain("Ann, Bo, Cy");
    // Through act, as an agent: the meeting's type changed, the card goes (the text keeps everything else); back, it comes back.
    const before = await text();
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "chat" }, as: "test-agent" });
    await until(() => !drawn().some(d => d.rule === "meeting-card/card") && !screen().includes("[meeting]"), "the card gone", 8000);
    expect(await text()).toBe(before.replace("[type::meeting]", "[type::chat]"));
    await app.act({ action: "props.edit", tile: "reader", args: { key: "type", value: "meeting" }, as: "test-agent" });
    await until(() => drawn().some(d => d.rule === "meeting-card/card" && d.status === "ready") && screen().includes("[meeting]"), "the card back", 10_000);
    expect(await text()).toBe(before);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // A band is still its heading: ( ) stops on it and f folds what's under it, the band drawn over the hidden lines.
    ch(")");
    await until(() => String(reader().folds?.selected ?? "").includes("Agenda"), "( ) on the Agenda band", 5000);
    ch("f");
    await until(() => !screen().includes("Water rota for August") && screen().includes("2 lines folded"), "the Agenda band folded", 5000);
    ch("f");
    await until(() => screen().includes("Water rota for August"), "unfolded", 5000);
    // R: the note as written, and back; nothing written.
    ch("R");
    await until(() => screen().includes("Close the cold frame tonight!!!") && screen().includes("## Agenda"), "the note as written", 5000);
    expect(reader().decorations).toMatchObject({ raw: true, drawn: expect.any(Array) });
    expect(screen()).not.toContain("CLOSE THE COLD FRAME TONIGHT");
    ch("R");
    await until(() => screen().includes("CLOSE THE COLD FRAME TONIGHT"), "decorated again", 5000);
    expect(await text()).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    // done-stamp: the job's status set to done through act stamps it once, as the extension, and its own write sets nothing off.
    const job = (await board.children(id)).find(k => k.text.startsWith("Mend the water butt"))!;
    await until(() => reader(1)?.showing?.id === job.id, "the job beside", 5000);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "done" }, as: "test-agent" });
    const has = async (re: RegExp) => { const end = Date.now() + 10_000; while (!re.test(await text(job.id))) { if (Date.now() > end) throw new Error(`timed out waiting for ${re}`); await Bun.sleep(50); } };
    await has(/\[done-at::\d{4}-\d\d-\d\d\]/);
    const stamped = (await board.get(job.id))!;
    await Bun.sleep(2500);
    expect((await board.get(job.id))!.revision).toBe(stamped.revision);
    expect((await text(job.id)).match(/done-at/g)).toHaveLength(1);
    await app.act({ action: "props.edit", tile: "reader2", args: { key: "status", value: "todo" }, as: "test-agent" });
    await has(/^(?![\s\S]*done-at)/);
  }, 60_000);

  test("tabs: a live figure's tabs and density, switched through act, by keys and by click; the note never written", async () => {
    const id = seeded.notes.plotJobs.id, before = (await board.get(id))!.text;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "tabs" }, as: "test-agent" })).toMatchObject({ key: "tabs" });
    await until(() => screen().includes("doing 2 · review 1 · validate 0 · done 1 · queued 2"), "the tab bar", 8000);
    const left = (l: string) => l.slice(S().stageRect.col, S().stageRect.col + Math.floor(S().stageRect.cols / 2));
    const half = () => sc.render(app).lines.map(plain).map(left).join("\n");
    // The first tab listed in order: doing, its rows; the others' rows aren't drawn.
    expect(half()).toContain("PLOT-2 — Sow the broad beans");
    expect(half()).not.toContain("PLOT-4");
    // An agent reads the figures, then switches the left reader's tab (a reader the person isn't typing in).
    const figs = await app.act({ action: "figures", tile: "1", as: "test-agent" }) as any;
    expect(figs.figures).toEqual([expect.objectContaining({ n: 1, kind: "tabs", title: "Plot jobs", density: "compact", tab: "doing" })]);
    expect(figs.figures[0].tabs.map((t: any) => `${t.value} ${t.count}`)).toEqual(["doing 2", "review 1", "validate 0", "done 1", "queued 2"]);
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "queued" }, as: "test-agent" })).toMatchObject({ tab: "queued", count: 2 });
    await until(() => half().includes("PLOT-4 — Order the seed potatoes"), "the queued tab");
    expect(half()).not.toContain("PLOT-2");
    // Only that reader: the other one on the same note still shows doing.
    expect(((await app.act({ action: "figures", tile: "2", as: "test-agent" })) as any).figures[0].tab).toBe("doing");
    expect(await app.act({ action: "figure.tab", tile: "1", args: { n: "2" }, as: "test-agent" })).toMatchObject({ tab: "review" });
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "nope" }, as: "test-agent" })).rejects.toThrow(/no tab nope; its tabs: 1 doing, 2 review/);
    // element.open on a tab, as an agent, is figure.tab (its rules, its provenance): the right reader's 5th tab.
    const els = await app.act({ action: "elements", tile: "2", as: "test-agent" }) as any;
    const queued = els.elements.find((e: any) => e.kind === "figure" && e.label.startsWith("queued"));
    expect(await app.act({ action: "element.open", tile: "2", args: { n: queued.n }, as: "test-agent" })).toMatchObject({ tab: "queued" });
    expect(await app.act({ action: "figure.tab", tile: "2", args: { tab: "doing" }, as: "test-agent" })).toMatchObject({ tab: "doing" });
    // Density: compact cuts the long title with …; cozy wraps it to two lines, hanging past "PLOT-3 — "; comfortable three.
    await until(() => half().includes("PLOT-3 — Mend"), "the review tab");
    expect(half()).toMatch(/PLOT-3 — Mend the netting[^\n]*…/);
    expect(await app.act({ action: "figure.density", tile: "1", args: { to: "cozy" }, as: "test-agent" })).toMatchObject({ density: "cozy" });
    await until(() => half().includes("≡ cozy"), "cozy");
    const hang = () => { const rows = half().split("\n"), i = rows.findIndex(r => r.includes("PLOT-3 — Mend")); return { first: rows[i]!, next: rows[i + 1]!, third: rows[i + 2]! }; };
    let h = hang();
    const textAt = h.first.indexOf("Mend");
    expect(h.next.slice(0, textAt).replace(/[│║┊ ]/g, "")).toBe("");          // the second line starts under "Mend", past the id
    expect(h.next.slice(textAt, textAt + 1)).toMatch(/\S/);
    expect(h.next).toContain("…");
    expect(await app.act({ action: "figure.density", tile: "1", as: "test-agent" })).toMatchObject({ density: "comfortable" });
    await until(() => half().includes("≡ comfortable"), "comfortable");
    h = hang();
    expect(h.third.slice(textAt, textAt + 1)).toMatch(/\S/);
    await expect(app.act({ action: "figure.density", tile: "1", args: { to: "roomy" }, as: "test-agent" })).rejects.toThrow(/compact, cozy, comfortable/);
    // The person, by keys: into the stage (the left reader), [ ] onto the first element (a tab), → and tab step on.
    await app.act({ action: "figure.density", tile: "1", args: { to: "compact" }, as: "test-agent" });
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]");
    press({ kind: "right" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("validate");
    await until(() => half().includes("nothing in validate"), "the empty validate tab, listed in order");
    press({ kind: "tab" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("done");
    press({ kind: "backtab" }); press({ kind: "left" });
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].tab).toBe("review");
    ch("=");
    expect(((await app.act({ action: "figures", tile: "1", as: "test-agent" })) as any).figures[0].density).toBe("cozy");
    // By mouse: a click on the queued label in the left reader's bar.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => left(l).includes("queued 2")), x = left(rows[y]!).indexOf("queued 2") + S().stageRect.col + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => half().includes("PLOT-5 — Clear the bindweed"), "the queued tab, clicked");
    // The person types in the left reader (an edit): an agent's switch there is refused; the right reader's isn't.
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "doing" }, as: "test-agent" })).rejects.toThrow(/isn't typing in/);
    expect(await app.act({ action: "figure.tab", tile: "2", args: { by: 1 }, as: "test-agent" })).toMatchObject({ tab: "review" });
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
    // Every switch was reading state: the note's text is as seeded.
    expect((await board.get(id))!.text).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("hero header (PIE-598): the opening picture, scrolled under the header, becomes its dimmed background; reader.hero on=false keeps it plain", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "hero" }, as: "test-agent" })).toMatchObject({ key: "hero" });
    await until(() => screen().includes("▣ evening-beds.jpg") && !screen().includes("loading…"), "the hero note, its picture read", 8000);
    const reader = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes[0]; };
    const raw = () => sc.render(app).lines as string[];
    // The title rows inside the tiles (not a frame's label): the reader's is the row's first, the column's beside it.
    const titleRows = () => raw().filter(l => plain(l).includes("│An evening on the plot"));
    const titleRow = () => titleRows()[0]!;
    // At the top the picture is in view: the header knows its hero, at step 0, and is plain.
    expect(reader().header).toEqual({ backdrop: { image: "evening-beds.jpg", line: 2, step: 0, of: 3, mode: "first", drawn: null }, on: true, mode: "first" });
    expect(titleRow()).not.toContain("\x1b[48;2;");
    // Scrolled past it (an agent's scroll, through act): the header takes it, in this terminal's cells, by steps.
    await app.act({ action: "scroll", args: { by: 1 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.drawn === "cells", "the first step drawn", 8000);
    expect(reader().header.backdrop).toMatchObject({ image: "evening-beds.jpg", line: 2, step: 1, of: 3 });
    await app.act({ action: "scroll", args: { by: 4 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.step === 3 && reader().header.backdrop?.drawn === "cells", "the full step drawn", 8000);
    // Each header cell has its colour, dark (no channel above a third of full), the title's text on top.
    const bgs = [...titleRow().matchAll(/\x1b\[48;2;(\d+);(\d+);(\d+)m/g)].map(x => [+x[1]!, +x[2]!, +x[3]!]);
    expect(bgs.length).toBeGreaterThan(20);
    expect(Math.max(...bgs.flat())).toBeLessThan(90);
    expect(new Set(bgs.map(c => c.join(","))).size).toBeGreaterThan(1);
    expect(plain(titleRow())).toContain("An evening on the plot");
    // Turned off: every reader's header is plain, and the setting is kept for the next start.
    expect(await app.act({ action: "reader.hero", args: { on: false }, as: "test-agent" })).toEqual({ on: false, mode: "first" });
    expect(JSON.parse(readFileSync(join(process.env.EP0CH_STATE!, "reader-hero.json"), "utf8"))).toEqual({ on: false, mode: "first" });
    expect(reader().header).toEqual({ backdrop: null, on: false, mode: "first" });
    expect(titleRow()).not.toContain("\x1b[48;2;");
    expect(await app.act({ action: "reader.hero", args: { on: true }, as: "test-agent" })).toEqual({ on: true, mode: "first" });
    await until(() => reader().header.backdrop?.step === 3, "back on", 8000);
    // First mode: scrolled past the second picture, the header keeps the hero.
    await app.act({ action: "scroll", args: { to: "end" }, as: "test-agent" });
    await until(() => reader().header.backdrop?.image === "evening-beds.jpg" && reader().header.backdrop?.step === 3, "still the hero", 8000);
    // Follow mode: the second picture takes over as it scrolls under, fading in over the first, then alone.
    expect(await app.act({ action: "reader.hero", args: { on: true, mode: "follow" }, as: "test-agent" })).toEqual({ on: true, mode: "follow" });
    await until(() => reader().header.backdrop?.image === "allotment-dusk.jpg" && reader().header.backdrop?.step === 3, "the second picture", 8000);
    const second = reader().header.backdrop.line;
    await app.act({ action: "scroll", args: { to: "top" }, as: "test-agent" });
    // Step down until its line has just gone under: the first step, over the hero at full.
    for (let i = 0; i < 80 && reader().header.backdrop?.image !== "allotment-dusk.jpg"; i++) await app.act({ action: "scroll", args: { by: 1 }, as: "test-agent" });
    await until(() => reader().header.backdrop?.drawn === "cells", "the crossfade drawn", 8000);
    expect(reader().header.backdrop).toMatchObject({ image: "allotment-dusk.jpg", line: second, step: 1, mode: "follow", over: "evening-beds.jpg" });
    expect(titleRow()).toContain("\x1b[48;2;");
    expect(await app.act({ action: "reader.hero", args: { on: true, mode: "first" }, as: "test-agent" })).toEqual({ on: true, mode: "first" });
    await expect(app.act({ action: "reader.hero", args: { on: true, mode: "every" }, as: "test-agent" })).rejects.toThrow(/first or follow/);
    // The river column beside it keeps the reader's header above its own scroll, and takes the picture there too.
    const column = () => { sc.render(app); return S().stages.get(S().sel).top.describe().panes[1]; };
    await until(() => !!column().column?.showing, "the column's note", 8000);
    const colTitle = () => (plain(titleRows()[0] ?? "").match(/│An evening on the plot/g) ?? []).length;
    expect(colTitle()).toBe(2);
    expect(column().column.header.backdrop).toMatchObject({ image: "evening-beds.jpg", step: 0 });
    const coloured = () => (titleRows()[0]!.match(/\x1b\[48;2;/g) ?? []).length, before = coloured();
    await app.act({ action: "column.scroll", args: { by: 12 }, tile: column().name, as: "test-agent" });
    await until(() => column().column.header.backdrop?.step === 3 && column().column.header.backdrop?.drawn === "cells", "the column's header, with the picture", 8000);
    // Scrolled, its title is still on screen (sticky), over the picture's colours.
    expect(colTitle()).toBe(2);
    expect(coloured()).toBeGreaterThan(before + 20);
  }, 30_000);

  test("images (PIE-532): sized, placed and the header, by act, by keys and by a click on a caption control; ctrl+z undoes", async () => {
    const id = seeded.notes.images.id, text = async () => (await board.get(id))!.text;
    const reads = async (has: (t: string) => boolean, what: string) => { const end = Date.now() + 5000; while (!has(await text())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}: ${await text()}`); await Bun.sleep(30); } };
    const line = async (n: number) => (await text()).split("\n")[n - 1]!;
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "images" }, as: "test-agent" })).toMatchObject({ key: "images" });
    await until(() => screen().includes("▣ seed-packet.webp") && !screen().includes("loading…"), "the images, read (a JPEG, a WebP and a PNG)", 8000);
    // An agent lists them, with the layout each line writes and what's wrong with none.
    const list = (await app.act({ action: "images", as: "test-agent" }) as any).images;
    expect(list.map((x: any) => [x.n, x.line, x.path.split("/").pop(), x.size ?? null, x.align ?? null, x.layout ?? null])).toEqual([
      [1, 2, "allotment-dusk.jpg", null, null, "hero"], [2, 6, "seed-packet.webp", "25%", "center", null], [3, 10, "allotment-dusk.jpg", "50%", "right", null], [4, 12, "seed-packet.webp", null, null, null],
      [5, 17, "allotment-notice.png", "50%", null, null],
    ]);
    expect(list[0].alt).toBe("the plot at dusk");
    // Sized, placed and made the header through the note's save, attributed; the header moves (one save, two lines).
    expect(await app.act({ action: "image.size", args: { n: 2, to: "40" }, as: "test-agent" })).toMatchObject({ changed: true, recordedAs: { author: "agent", actorId: "test-agent" } });
    expect(await line(6)).toContain("[size::40] [align::center]");
    await app.act({ action: "image.align", args: { line: 6, to: "left" }, as: "test-agent" });
    expect(await line(6)).not.toContain("[align::");
    await app.act({ action: "image.hero", args: { n: 4 }, as: "test-agent" });
    expect(await line(12)).toBe(`- [img::${list[3].path}] [height::6] [layout::hero]`);
    expect(await line(2)).not.toContain("[layout::hero]");
    await expect(app.act({ action: "image.align", args: { n: 4, to: "right" }, as: "test-agent" })).rejects.toThrow(/full width/);
    await expect(app.act({ action: "image.size", args: { n: 2, to: "huge" }, as: "test-agent" })).rejects.toThrow(/cells \(40\), a share \(50%\) or full/);
    await expect(app.act({ action: "image.size", args: { to: "50%" }, as: "test-agent" })).rejects.toThrow(/say which image/);
    await expect(app.act({ action: "image.size", args: { n: 2, by: 5 }, as: "test-agent" })).rejects.toThrow(/by is 1 or -1/);
    // How the header shows when it's too tall (whole, or cropped to fill), and how much an image is dimmed.
    await app.act({ action: "image.fit", args: { n: 1, to: "contain" }, as: "test-agent" });
    expect(await line(2)).toContain("[fit::contain]");
    await app.act({ action: "image.dim", args: { n: 5, to: "0.5" }, as: "test-agent" });
    expect(await line(17)).toContain("[dim::0.5]");
    await expect(app.act({ action: "image.dim", args: { n: 5, to: "bright" }, as: "test-agent" })).rejects.toThrow(/0 \(as it is\) to 1/);
    for (let i = 0; i < 2; i++) await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(2)).not.toContain("[fit::");
    expect(await line(17)).not.toContain("[dim::");
    // Its own undo puts each change back, newest first.
    for (let i = 0; i < 2; i++) await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(2)).toContain("[layout::hero]");
    expect(await line(6)).toContain("[size::40] [align::center]");
    await app.act({ action: "image.undo", as: "test-agent" });
    expect(await line(6)).toContain("[size::25%] [align::center]");
    // The person, by keys: into the stage, [ ] to the seed packet (the header's caption is the first element), + a step bigger.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("]"); ch("]");
    ch("+");
    await reads(t => t.split("\n")[5]!.includes("[size::33%]"), "a step bigger: a third");
    press({ kind: "right" });
    await reads(t => t.split("\n")[5]!.includes("[align::right]"), "→ moved it right");
    ch("H");
    await reads(t => t.split("\n")[5]!.includes("[layout::hero]") && !t.split("\n")[1]!.includes("[layout::hero]"), "H made it the header");
    press({ kind: "char", ch: "z", ctrl: true });
    await reads(t => t.split("\n")[1]!.includes("[layout::hero]"), "ctrl+z: the header back");
    // By mouse: a click on the right-hand image's [−] (on its caption).
    const rows = sc.render(app).lines.map(plain);
    const y = rows.findIndex(l => l.includes("allotment-dusk.jpg") && l.includes("[◂]")), x = rows[y]!.indexOf("[−]") + 1;
    expect(y).toBeGreaterThan(0);
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await reads(t => t.split("\n")[9]!.includes("[size::33%]"), "a click on [−]: a step smaller");
    // The person writes in the note (an edit open): an agent's change is refused, the line untouched.
    ch("e"); press({ kind: "enter" });   // e arms the edit, ⏎ opens it (edit.arm)
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "image.align", args: { n: 3, to: "left" }, as: "test-agent" })).rejects.toThrow(/open in a draft|typing in/);
    expect(await line(10)).toContain("[align::right]");
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
  }, 30_000);

  test("new notes (PIE-544): ctrl+n under the note read, a missing [[page]] offered then made, [page::x] titled; by keys, mouse and act", async () => {
    const guide = seeded.notes.newNotes.id;
    // Out of the stage the test before left the keys in: an agent changes sections only from the index.
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
    const inbox = (await board.roots()).find(r => r.props["system-view"] === "inbox")!.id;
    const reads = async (ok: () => Promise<boolean>, what: string) => { const end = Date.now() + 5000; while (!await ok()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(30); } };
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    expect(await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" })).toEqual({ section: n, key: "newnotes" });
    await until(() => screen().includes("Seed swap ledger ◌"), "the guide, its link missing", 8000);
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    // The person, by keys: into the stage, ] to the link, ⏎ offers the page (nothing made yet), ⏎ again makes it.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    reader().surface.selectLink(0);
    press({ kind: "enter" });
    await until(() => screen().includes("no page [[Seed swap ledger]]"), "the offer under the header");
    expect((await board.resolvePage("Seed swap ledger")).status).toBe("missing");
    // By mouse: a click on the link again makes it.
    const rows = sc.render(app).lines.map(plain), y = rows.findIndex(l => l.includes("Seed swap ledger ◌")), x = rows[y]!.indexOf("Seed swap ledger") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await reads(async () => (await board.resolvePage("Seed swap ledger")).status === "resolved", "the page made");
    const page = (await board.resolvePage("Seed swap ledger")).block!;
    expect(await board.get(page.id)).toMatchObject({ text: "Seed swap ledger [page::Seed swap ledger]", parentId: inbox });
    await until(() => reader().msg?.id === page.id, "the page opened in the reader");
    // Back (alt+←), as the reader's history goes.
    press({ kind: "alt-left" });
    await until(() => reader().msg?.id === guide, "back on the guide");
    // ctrl+n in the reader: a note under the guide, its edit open with the keys; ⏎ on [page::x] titles it, ctrl+s saves.
    press({ kind: "char", ch: "n", ctrl: true });
    // It opens in a detail beside the reader (as O opens one); this stage's reader follows what's current, so it shows it too.
    const writing = () => [...stage().panes.values()].find((p: any) => p.surface?.draft) as any;
    await until(() => !!writing(), "the new note's edit", 8000);
    const id = writing().surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(guide);
    expect(writing()).not.toBe(reader());
    for (const c of "[page::2026-03-12]") press({ kind: "char", ch: c });
    press({ kind: "enter" });
    expect(writing().surface.draft.text).toBe("2026-03-12 [page::2026-03-12]\n");
    for (const c of "Swapped borlotti for chard.") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    await reads(async () => (await board.get(id))!.text === "2026-03-12 [page::2026-03-12]\nSwapped borlotti for chard.", "the new note saved");
    // An agent: note.new and page.create through act, attributed, the person's keys and reader untouched.
    const before = reader().msg?.id;
    const made = await app.act({ action: "note.new", args: { text: "[page::2026-03-13]" }, as: "test-agent" }) as any;
    expect(made).toMatchObject({ rule: "inbox", parentId: inbox, title: "2026-03-13" });
    expect(await board.get(made.id)).toMatchObject({ text: "2026-03-13 [page::2026-03-13]", author: "test-agent" });
    const pg = await app.act({ action: "page.create", args: { address: "Pea trellis" }, as: "test-agent" }) as any;
    expect(pg).toMatchObject({ created: true });
    expect(await board.get(pg.id)).toMatchObject({ text: "Pea trellis [page::Pea trellis]", parentId: inbox, author: "test-agent" });
    expect(reader().msg?.id).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 30_000);

  test("new notes float (PIE-591): five rapid ctrl+n make five floating drafts; one docked by its title's drag, one saved, one from an edit; × on an empty one trashes it", async () => {
    const guide = seeded.notes.newNotes.id;
    for (let i = 0; i < 8 && S().focus === "stage"; i++) press({ kind: "esc" });
    (app as any).lastInput = 0;
    const n = SECTIONS.findIndex(s => s.key === "newnotes") + 1;
    await app.act({ action: "section", args: { name: "newnotes" }, as: "test-agent" });
    const stage = () => S().stages.get(n - 1).top as any;
    const reader = () => [...stage().panes.values()].find((p: any) => p.kind === "reader") as any;
    await until(() => reader()?.msg?.id === guide, "the guide in the reader", 8000);
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    // Floats left by the test before (its saved new note) aren't this test's.
    const old = new Set((stage().describe().floats as any[]).map(f => f.tile));
    const floats = () => (stage().describe().floats as any[]).filter(f => f.newNote && !old.has(f.tile));
    const before = (await board.children(guide)).length;
    // Five, as fast as the keys go: each a float of its own with its edit open, none waiting on the last.
    for (let i = 0; i < 5; i++) press({ kind: "char", ch: "n", ctrl: true });
    await until(() => floats().length === 5 && floats().every(f => f.writing), `five floating drafts, each in its edit (${JSON.stringify(stage().describe().floats)})`, 10_000);
    const kids = await board.children(guide);
    expect(kids.length).toBe(before + 5);
    // Siblings under the note read, never a chain of one under the next.
    for (const f of floats()) expect((await board.get(f.id))!.parentId).toBe(guide);
    // Cascaded, the newest on top with the keys, and the person in its edit.
    const rects = floats().map(f => f.rect);
    expect(new Set(rects.map(r => `${r.col},${r.row}`)).size).toBe(5);
    const top = floats().at(-1)!;
    expect(stage().describe().focusName).toBe(top.tile);
    await until(() => stage().newNoteWhileTyping(), "the person in the newest float's edit", 5000);
    // Saved: typed in the newest, ctrl+s.
    for (const c of "Chard seed: 2 rows") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "s", ctrl: true });
    const saved = async (id: string, text: string) => { const end = Date.now() + 5000; while ((await board.get(id))?.text !== text) { if (Date.now() > end) throw new Error(`timed out waiting for ${text}`); await Bun.sleep(30); } };
    await saved(top.id, "Chard seed: 2 rows");
    // From an edit: into the fourth (its edit open, the keys elsewhere: e enters it), typed, then ctrl+n: saved, a sixth floats.
    const fourth = floats()[3]!;
    await stage().dispatch.press("tile.focus", {}, fourth.tile);
    press({ kind: "char", ch: "e" });
    await until(() => stage().newNoteWhileTyping() && stage().describe().focusName === fourth.tile, "in the fourth's edit", 5000);
    for (const c of "Leek trench") press({ kind: "char", ch: c });
    press({ kind: "char", ch: "n", ctrl: true });
    await saved(fourth.id, "Leek trench");
    await until(() => floats().length === 6 && floats().at(-1)!.writing, "a sixth float from the edit", 8000);
    expect((await board.get(floats().at(-1)!.id))!.parentId).toBe(guide);
    // Docked by mouse: the first float's title dragged onto the reader's header joins its tabs.
    const first = floats()[0]!;
    const rows = () => sc.render(app).lines.map(plain);
    const titleRow = rows().findIndex(l => l.includes(`⧉ `) && l.includes(` ${first.tile} `));
    const fx = rows()[titleRow]!.indexOf(` ${first.tile} `) + 2;
    const head = rows().findIndex(l => /┌─ \d+ reader /.test(l));
    expect(titleRow).toBeGreaterThan(head);
    expect(head).toBeGreaterThan(0);
    const hx = rows()[head]!.indexOf(" reader ") + 2;
    press({ kind: "mouse", action: "down", button: 0, x: fx, y: titleRow });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head + 1 });
    press({ kind: "mouse", action: "drag", button: 32, x: hx, y: head });
    expect(plain(sc.render(app).lines.join("\n"))).toContain("release docks it");
    press({ kind: "mouse", action: "up", button: 0, x: hx, y: head });
    await until(() => !floats().some(f => f.id === first.id), "the first float docked", 5000);
    // A tab beside the reader now, in the layout: one tab set holding both.
    expect(((await stage().dispatch.press("layout.get")) as any).tree).toMatchObject({ tabs: ["reader", first.tile], active: first.tile });
    expect(stage().describe().focusName).toBe(first.tile);
    // × (tile.close) on an empty one: nothing typed, so it goes to the trash and its float with it.
    const empty = floats().find(f => f.id !== top.id && f.id !== fourth.id)!;
    await stage().dispatch.press("tile.close", {}, empty.tile);
    await until(() => !floats().some(f => f.id === empty.id), "the empty float closed", 5000);
    const end = Date.now() + 5000;
    while ((await board.children(guide)).some(k => k.id === empty.id)) { if (Date.now() > end) throw new Error("the empty note wasn't trashed"); await Bun.sleep(30); }
    // An agent's: made and shown floating for the person, attributed; their keys stay where they are.
    const keysOn = stage().describe().focusName;
    const made = await app.act({ action: "note.new", args: { text: "Bean poles: 12", opens: "float" }, as: "test-agent" }) as any;
    expect(made.reader).toBeTruthy();
    expect(stage().describe().focusName).toBe(keysOn);
    expect(await board.get(made.id)).toMatchObject({ author: "test-agent" });
    // Put the rest away, so the next test finds the stage as it was: each closed (saved, or trashed when empty).
    for (const f of [...floats(), ...(stage().describe().floats as any[]).filter(f => old.has(f.tile))]) await stage().dispatch.press("tile.close", {}, f.tile);
    await until(() => (stage().describe().floats as any[]).length === 0, "the floats put away", 8000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);

  test("figures (mdxcn): every Markdown kind drawn, live ones answered; a figure block's child bullets open their notes by act, keys and mouse", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "figures" }, as: "test-agent" })).toEqual({ section: SECTIONS.findIndex(x => x.key === "figures") + 1, key: "figures" });
    // Each kind, by what its Markdown drew; the live decision and uptime answered from the seeded notes.
    const shown = [
      "● Raised beds", "× Straight into the clay", "○ Grow bags",                       // decision, from Markdown
      "THE PLOT'S DECISIONS (LIVE)", "Netting the whole plot",                          // decision, live
      "> Ada", "Bo", "goes to look",                                                   // chat
      "PHOTO DRIVE BACKUPS (LIVE)", "2026-02-16", "2026-03-11",                         // uptime, live (source: backups)
      "SEEDS SOWN", "March 2026", "[11]", "seed potatoes in",                            // activity, calendar
      "[1] close the tap", "[2] three turns of PTFE tape",                              // annotate
      "— Ada, the allotment newsletter",                                               // a quote's byline
      "BEAN ROWS (CHILD BULLETS)", "May  plant out", "live · child notes",                                    // the figure block's child bullets
    ];
    // The whole note as a reader draws it (`ep0ch show`'s drawing, the surface itself): every kind there.
    // On a connection of its own, as `ep0ch show` from a shell beside the door would be.
    const own = new SocketBoard(scratch.sock);
    await own.info();
    const drawn = (await drawNote(own, seeded.notes.markdownFigures.id, 100))!.map(plain).join("\n");
    for (const m of shown) expect(drawn).toContain(m);
    const keys = (await drawNote(own, seeded.notes.keys.id, 100))!.map(plain).join("\n");
    own.close();
    for (const m of ["THE READER (FROM THE REGISTRY)", "[e]", "edit", "[g] then [d]", "[ctrl][k]"]) expect(keys).toContain(m);
    // drawNote listened for the door's answers: it never took the door's live connection.
    expect(liveBoard()).toBe((app as any).board);
    // The left reader scrolls: read every element's label instead of the screen for what's below it.
    const els = async () => ((await app.act({ action: "elements", tile: "reader", as: "test-agent" })) as any).elements as { n: number; kind: string; label: string; current?: boolean }[];
    for (let end = Date.now() + 8000; !(await els()).some(e => e.kind === "row" && e.label.includes("plant out")); await Bun.sleep(50))
      if (Date.now() > end) throw new Error("timed out waiting for the figure block's child rows as elements");
    const rows = (await els()).filter(e => e.kind === "row");
    // The live decision's rows and the child bullets are rows; the Markdown ones (no note behind them) aren't.
    expect(rows.map(r => r.label)).toEqual(expect.arrayContaining(["Raised beds for the squash", "sow under glass", "plant out", "first picking"]));
    expect(rows.some(r => r.label === "Raised beds")).toBe(false);
    const may = rows.find(r => r.label === "plant out")!;
    // An agent opens a child bullet's note in another reader (never the person's).
    const opened = await app.act({ action: "element.open", tile: "reader", args: { n: may.n, fresh: true }, as: "test-agent" }) as any;
    expect(JSON.stringify(opened)).toContain("plant out");
    // The person, by keys: into the stage, [ ] to the row, ⏎ opens its note in the reader.
    press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    for (let i = 0; i < 80 && !(await els()).find(e => e.current && e.label === "sow under glass"); i++) ch("]");
    expect((await els()).find(e => e.current)?.label).toBe("sow under glass");
    press({ kind: "enter" });
    await until(() => screen().includes("Apr: sow under glass") && !screen().includes("SQUASH BEDS"), "the child bullet's note open in the reader", 5000);
    // Back (backspace), where the reader was, then by mouse: a click on another child row opens its note.
    press({ kind: "backspace" });
    // Back where it was, the figure block's row on screen (the reader keeps its place).
    const rowAt = () => sc.render(app).lines.map(plain).findIndex(l => /┊ ●  Apr  sow under glass/.test(l));
    await until(() => rowAt() >= 0, "back on the figures note, the child row on screen", 5000);
    const y = rowAt(), x = sc.render(app).lines.map(plain)[y]!.indexOf("sow under glass") + 2;
    press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y });
    await until(() => !screen().includes("BEAN ROWS (CHILD BULLETS)"), "the child bullet's note opened by a click", 5000);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
  }, 40_000);

  test("spine: the board's lanes are ordered by hand: card.reorder through act, alt+↓ and a drag", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "spine" }, as: "test-agent" })).toMatchObject({ key: "spine" });
    const desk = () => { screen(); return S().stage(SECTIONS.findIndex(s => s.key === "spine")).top as any; };
    const model = () => desk().modelFor("lanes") as any;
    await until(() => !!model()?.lanes?.length && model().lanes.every((l: any) => l.items), "the board's lanes", 8000);
    const queued = () => model().lanes.find((l: any) => l.name === "Queued");
    const ids = () => queued().items.map((m: any) => m.id);
    const first = ids();
    expect(first.length).toBeGreaterThan(1);
    // An agent puts the last card first.
    expect(await app.act({ action: "card.reorder", args: { card: first.at(-1), to: 0 }, as: "test-agent" })).toMatchObject({ lane: "Queued", position: 0 });
    await until(() => ids()[0] === first.at(-1), "the agent's reorder");
    // The person's alt+↓ on the first card.
    press({ kind: "enter" });
    model().lane = model().lanes.indexOf(queued()); queued().sel = 0;
    press({ kind: "alt-down" });
    await until(() => ids()[1] === first.at(-1), "alt+↓");
    // A drag of the second card onto the first's row.
    // The stage's tiles are placed inside the showcase's stage: a click is offset by where the stage is.
    const r = desk().rectOf(queued()), l = queued(), at = S().stageRect;
    const yOf = (i: number) => { for (let y = r.row + 1; y < r.row + r.rows; y++) if (l.rowAt(y - r.row - 1) === i) return y + at.row; throw new Error(`no row ${i}`); };
    const x = r.col + 4 + at.col, from = yOf(1), to = yOf(0), moving = ids()[1];
    press({ kind: "mouse", action: "down", button: 0, x, y: from });
    press({ kind: "mouse", action: "drag", button: 32, x, y: to });
    press({ kind: "mouse", action: "up", button: 0, x, y: to });
    await until(() => ids()[0] === moving, "the drag");
    press({ kind: "esc" });
  }, 30_000);

  test("on an outline without the showcase it says so and writes nothing", async () => {
    const other = new Scratch();
    const b = new SocketBoard(await other.start());
    await b.info();
    const before = (await b.roots()).length;
    const t = { info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    const a = new App(t as any, b, Date.now(), () => {});
    const s = new Showcase();
    a.push(s);
    await until(() => (s as any).problem !== "", "the answer", 5000);
    expect(s.render(a).lines.map(plain).join("\n")).toContain("This outline has no showcase");
    expect((await b.roots()).length).toBe(before);
    a.quit(); b.close(); await other.dispose();
  }, 20_000);
});


// `ep0ch --showcase --reset` while a showcase door stays open: the reset stops the host, deletes the outline and
// seeds a new one, and the open door reconnects to it. The new seed's notes are new blocks, and the same seed ends
// on the same sequence, so the catch-up finds nothing missed: the screen has to notice its root is another one and
// read the notes again, or the notebook it keeps embeds ids the new outline doesn't have (each read `◌`).
describe.skipIf(!outliner)("the showcase screen across a --reset", () => {
  const scratch = new Scratch(undefined, "showcase");
  let board: SocketBoard, app: App, sc: Showcase;
  const screen = () => sc.render(app).lines.map(plain).join("\n");
  const S = () => sc as any;

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    await scratch.start();
    await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    board.reconnectMs = 50;
    await board.info();
    // Tall enough that the notebook's embeds, near its end, are on screen.
    const term = { info: { cols: 200, rows: 130, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  const embeds = ["» Kitchen whiteboard", "Shopping: oats, lemons, washing-up liquid.", "» Kitchen tap ^t-7a9c11", "[~] fix the dripping tap"];

  test("the notebook's embeds show their notes after the outline is reset under the open door", async () => {
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), "the notebook's embeds before the reset", 8000);
    const before = S().notes.root.id;
    // The person has the help over it meanwhile: the showcase isn't on top, so the outline's events don't reach it.
    app.push(new Help());
    // What try-it.sh --reset does: stop the host, delete the outline, start again and seed it anew.
    await scratch.stop();
    rmSync(scratch.outlines, { recursive: true, force: true });
    mkdirSync(scratch.outlines, { recursive: true });
    await scratch.start();
    await scratch.seedShowcase();
    await until(() => (app.reconnects ?? 0) > 0, "the door reconnected", 10_000);
    app.pop();
    screen();
    await until(() => S().notes?.root?.id !== before && !!S().notes?.root, "the showcase read again", 15_000);
    sc.pick(0);
    await until(() => embeds.every(m => screen().includes(m)), `the notebook's embeds after the reset: ${embeds.filter(m => !screen().includes(m)).join(" | ")}`, 10_000);
    expect(screen()).not.toContain("◌");
  }, 60_000);
});

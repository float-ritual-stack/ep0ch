// PIE-439: the showcase. Its seed (every section's content, written through the service), the
// `scripts/try-it.sh --showcase --reset` path putting it back, and the screen drawing each reuse-map
// section with its real part, by keys, mouse and act. Scratch services only; the seed is fictional.
import { osc52 } from "../src/surface/selection";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { GRAPH_KINDS } from "../src/graphs";
import { liveBoard } from "../src/live";
import { Help, MainMenu } from "../src/screens";
import { CHORE_QUEUE, FIGURE_KINDS, LANES, MARKDOWN_KINDS, loadShowcase, SEED, seedShowcase, type Seeded } from "../src/showcase/seed";
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

  test("the notebook: callouts, links and soft links, folds, a literal region, a transclusion, properties in every scope", async () => {
    const t = seeded.notes.notebook.text;
    for (const piece of ["> [!note] Gate code", "> [!warning]- Slugs", `[[${SEED.shed}]]`, `((${seeded.cards[3]!.id}|the kettle job))`, "HOME-001 is the gate latch",
      "## Beds", "  - runner beans", "<!-- literal -->", "<!-- /literal -->", `!((${seeded.notes.whiteboard.id}))`])
      expect(t).toContain(piece);
    const scope = async (key: string) => (await board.propertyTokens(seeded.notes.notebook.id, key)).tokens.map(x => x.scope);
    expect(await scope("season")).toEqual(["block"]);
    expect(await scope("harvest")).toEqual(["line"]);
    expect(await scope("level")).toEqual(["inline"]);
    // The literal region's property is text, not a property.
    expect(await scope("mode")).toEqual([]);
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
    await scratch.start();
    seeded = await scratch.seedShowcase();
    board = new SocketBoard(scratch.sock);
    await board.info();
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write(s: string) { written.push(s); }, paint(l: string[]) { painted = l; }, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    sc = new Showcase();
    app.push(new MainMenu()); app.push(sc);
    await until(() => !!S().notes, "the showcase outline", 8000);
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  // What each section's own part draws, once it has read the outline.
  const marks: Record<string, string[]> = {
    note: ["Allotment notebook", "the same NoteSurface in the BBS message reader · src/screens.ts", "Subj: Allotment notebook"],
    // The list scrolls: the note set's header and the registry are on screen; the desk set is further down.
    actions: ["NOTE_ACTIONS · src/surface/note.ts", "the action registry · src/surface/actions.ts"],
    edit: ["Kitchen whiteboard", "properties · 6"],
    // The desk's search overlay, opened on a query with two typos: both allotment notes found, in the service's order.
    search: ["search the board", "alotment notebok", "hit(s)", "Allotment notebook", "Allotment figures"],
    // The draft session: an edit open on the left, a comment being written on the right.
    drafts: ["editing · Kitchen whiteboard", "comment · Allotment notebook"],
    panes: ["outline", "thread", "│ 4 activity", "Kitchen sink"],
    screens: ["daily brief · 2026-03-11", "2 of 2 briefs"],
    kinds: ["tile kinds", "tree ^W o t", "backlinks ^W o l"],
    terminal: ["a terminal tile: sh in a pty the door owns", "shell"],
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
    selection: ["Lentil soup", "Drag across these lines"],
    service: ["views.read ((Garden chores))", "ready · 3 block(s)", "references.backlinks (Bike shed)"],
    // This door runs in its own terminal (the test's App), so the section says so; in a session it lists the terminals.
    session: ["this door runs in its own terminal (--no-daemon)", "session"],
    // Obsidian's examples, nested three deep; the right reader declares a type of the outline's own.
    callouts: ["Callouts, as Obsidian writes them", "Can callouts be nested?", "Yes!, they can.", "Recipe callouts"],
    // This test's terminal has no Kitty graphics: each image's line says what it is, with its controls.
    images: ["Pictures of the plot", "▀ header allotment-dusk.jpg", "▣ seed-packet.webp · no Kitty graphics in this terminal", "[−][+] [◂][▸] [▀]", "▣ allotment-notice.png"],
    // The Markdown figures on the left (a decision first), the keys read from the registry on the right.
    figures: ["Figures, written in Markdown", "SQUASH BEDS", "Raised beds", "The reader's keys", "[e]"],
    // A guide note with a [[page]] nobody wrote yet, for ctrl+n, the offer and the page title fill.
    newnotes: ["New notes from anywhere", "Seed swap ledger", "ctrl+n"],
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
    press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + 11 * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + 11 * 2 });
    expect(S().sel).toBe(11);                                      // the spine section
    const r = S().stageRect;
    press({ kind: "mouse", action: "down", button: 0, x: r.col + 5, y: r.row + 5 }); press({ kind: "mouse", action: "up", button: 0, x: r.col + 5, y: r.row + 5 });
    expect(S().focus).toBe("stage");
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
  });

  test("editing works in a section, by keys: e, type, ctrl+s writes to the showcase outline", async () => {
    ch("3"); press({ kind: "enter" });
    expect(S().focus).toBe("stage");
    ch("e");
    const desk = () => S().stages.get(2).top;
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
    expect(r).toEqual({ section: 19, key: "selection" });
    expect(S().focus).toBe("index");
    expect((app as any).message).toContain("an agent (test-agent) showed section 19");
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

  test("search, driven by an agent: the section's own desk answers the service's forgiving search, the person's overlay left alone", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 4, key: "search" });
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
    expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 4, key: "search" });
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
      S().stages.delete(3);                                       // the search stage built again, its overlay asking the stand-in
      expect(await app.act({ action: "section", args: { name: "search" }, as: "test-agent" })).toEqual({ section: 4, key: "search" });
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
    expect(h.next.slice(0, textAt).replace(/[│┊ ]/g, "")).toBe("");          // the second line starts under "Mend", past the id
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
    ch("e");
    await until(() => !!S().stages.get(S().sel).top.describe().panes[0].editing, "the edit open", 5000);
    await expect(app.act({ action: "figure.tab", tile: "1", args: { n: "doing" }, as: "test-agent" })).rejects.toThrow(/isn't typing in/);
    expect(await app.act({ action: "figure.tab", tile: "2", args: { by: 1 }, as: "test-agent" })).toMatchObject({ tab: "review" });
    press({ kind: "esc" });
    await until(() => !S().stages.get(S().sel).top.describe().panes[0].editing, "the edit closed", 5000);
    // Every switch was reading state: the note's text is as seeded.
    expect((await board.get(id))!.text).toBe(before);
    for (let i = 0; i < 3 && S().focus === "stage"; i++) press({ kind: "esc" });
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
    ch("e");
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
    await until(() => !!reader().surface.draft, "the new note's edit", 8000);
    const id = reader().surface.draft.blockId;
    expect((await board.get(id))!.parentId).toBe(guide);
    for (const c of "[page::2026-03-12]") press({ kind: "char", ch: c });
    press({ kind: "enter" });
    expect(reader().surface.draft.text).toBe("2026-03-12 [page::2026-03-12]\n");
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

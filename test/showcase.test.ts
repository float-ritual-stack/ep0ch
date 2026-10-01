// PIE-439: the showcase. Its seed (every section's content, written through the service), the
// `scripts/try-it.sh --showcase --reset` path putting it back, and the screen drawing each reuse-map
// section with its real part, by keys, mouse and act. Scratch services only; the seed is fictional.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { GRAPH_KINDS } from "../src/graphs";
import { Help, MainMenu } from "../src/screens";
import { FIGURE_KINDS, LANES, loadShowcase, SEED, seedShowcase, type Seeded } from "../src/showcase/seed";
import { SECTIONS, Showcase, SHOWCASE_ACTIONS } from "../src/showcase/showcase";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import { ComponentCatalog, documentComponent } from "../src/components";

/**
 * Processes whose environment serves `base`'s state: a scan of `proc`, and none where the host has no
 * /proc (macOS), where only the pidfile is checked.
 */
function servingState(base: string, proc = "/proc"): string[] {
  if (!existsSync(proc)) return [];
  return readdirSync(proc).filter(p => /^\d+$/.test(p)).filter(p => {
    try { return readFileSync(`${proc}/${p}/environ`, "utf8").split("\0").includes(`OUTLINER_STATE_DIR=${base}/state`); } catch { return false; }
  });
}
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

test("the README's showcase says what SECTIONS registers: how many, the act range, and every key in the action's summary", () => {
  const readme = readFileSync(join(import.meta.dir, "../README.md"), "utf8");
  const words = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen"];
  expect(readme).toContain(`live, in ${words[SECTIONS.length]} sections`);
  expect(readme).toContain(`act section name=<1-${SECTIONS.length}|key>`);
  const summary = SHOWCASE_ACTIONS.list().find((a: any) => a.name === "section")!.summary;
  expect(summary).toContain(`name=<1-${SECTIONS.length}>`);
  for (const s of SECTIONS) expect(summary).toContain(s.key);
  // The map rows without a section are the ones the README names.
  const grammar = readFileSync(join(import.meta.dir, "../docs/UI-GRAMMAR.md"), "utf8");
  const map = grammar.slice(grammar.indexOf("## Before adding a feature"), grammar.indexOf("## TL;DR"));
  const rows = map.split("\n").filter(l => /^\| [a-z]/.test(l) && !l.startsWith("| The feature"));
  expect(rows.length - SECTIONS.length).toBe(3);
  expect(readme).toContain("its elements and reading-ruler row (PIE-441) and its terminal-output row (PIE-510");
});

test("the help screen says which screens write to the outline, not that the door is read-only", () => {
  const text = new Help().render({ t: { cols: 140 } } as any).lines.join("\n").replace(/\x1b\[[\d;]*m/g, "");
  expect(text).not.toContain("Read-only");
  expect(text).toContain("Kanban, Quay, Desk, Today, Waiting, Claude·now, Showcase and the message reader write");
  expect(text).toContain("recorded as you, or as the agent that did them");
});

test("the figures note has every ::graph-* kind the door draws", () => {
  expect([...FIGURE_KINDS].sort() as string[]).toEqual([...GRAPH_KINDS].sort());
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
    // The outliner's status renderer is installed for the showcase door (PIE-444), as the door reads it.
    const registry = join(base, "config", "pi-herdr-outliner", "document-renderers.json");
    const prior = process.env.OUTLINER_DOCUMENT_RENDERERS;
    process.env.OUTLINER_DOCUMENT_RENDERERS = registry;
    try { expect(documentComponent("component:status", "Beds dug :: 2", new ComponentCatalog())).toEqual({ kind: "labelled-values", entries: [{ label: "Beds dug", value: "2" }] }); }
    finally { if (prior === undefined) delete process.env.OUTLINER_DOCUMENT_RENDERERS; else process.env.OUTLINER_DOCUMENT_RENDERERS = prior; }
    // An edit on the showcase outline, through its own service on the same state.
    let svc = new Scratch(base);
    let board = new SocketBoard(await svc.start());
    let wb = (await loadShowcase(board))!.notes.whiteboard!;
    const original = wb.text;
    await board.update(wb.id, `${original}\nBuy more lemons.`, wb.revision!);
    board.close(); await svc.stop();
    // Another run keeps it (no reseed)…
    const again = run();
    expect(again.exitCode).toBe(0);
    expect(again.stdout.toString()).not.toContain("seeded");
    svc = new Scratch(base); board = new SocketBoard(await svc.start());
    expect((await loadShowcase(board))!.notes.whiteboard!.text).toContain("Buy more lemons.");
    board.close(); await svc.stop();
    // …and --reset deletes it and reseeds.
    const reset = run("--reset");
    expect(reset.exitCode).toBe(0);
    expect(reset.stdout.toString()).toContain("reset: deleted");
    svc = new Scratch(base); board = new SocketBoard(await svc.start());
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
    const svc = new Scratch(base);
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
    writeFileSync(join(fake, "src/server-main.ts"), `require("node:fs").writeFileSync(${JSON.stringify(started)}, String(process.pid)); setInterval(() => {}, 1000);\n`);
    try {
      rmSync(base, { recursive: true, force: true });
      const r = run([], { EP0CH_TRY_START_CHECKS: "10" }, fake);
      expect(r.exitCode).toBe(1);
      expect(r.stderr.toString()).toContain("the private service didn't start");
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
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
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
    edit: ["Kitchen whiteboard", "properties · 6", "parallel version, to consolidate: the board's composer"],
    panes: ["outline", "thread", "│ 4 activity", "Kitchen sink"],
    kinds: ["tile kinds", "tree ^W o t", "backlinks ^W o l"],
    terminal: ["a terminal tile: sh in a pty the door owns", "shell"],
    preview: ["preview · tree", "outline"],
    screen: ["board ·", "preview · board"],
    spine: ["Queued", "Doing", "Review", "Done", "HOME-003"],
    entity: ["Bike shed", "REPLIES 2", "COMMENTS 1 open · 1 resolved", "← backlinks ("],
    presence: ["who's online", "parallel version, to consolidate · WhoOnline", "parallel version, to consolidate · LastCallers"],
    live: ["GARDEN CHORES (LIVE QUERY)", "live · 3 results", "HOUSE JOBS BY ARC (LIVE)"],
    projection: ["Jira ACME-12 · Rollout checklist for the vendor switch", "Jira ACME-14 · Label printer drops the last line", "Jira · ambiguous: ACME-20, ACME-21", "Jira ACME-30 · not registered", "can't fetch: item was not found"],
    // Without the outliner's examples installed (this scratch seeds with the tickets only), the lines are properties.
    extensions: ["Omens for the allotment week", "extensions"],
    selection: ["Lentil soup", "Drag across these lines"],
    service: ["views.read ((Garden chores))", "ready · 3 block(s)", "references.backlinks (Bike shed)"],
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
    press({ kind: "mouse", action: "down", button: 0, x: 3, y: 2 + 8 * 2 }); press({ kind: "mouse", action: "up", button: 0, x: 3, y: 2 + 8 * 2 });
    expect(S().sel).toBe(8);                                       // the spine section
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
    // The person is working in section 1: an agent can't move them out of it.
    await expect(app.act({ action: "section", args: { name: "selection" }, as: "test-agent" })).rejects.toThrow(/the person is in section 1/);
    expect(S().focus).toBe("stage");
    expect(S().sel).toBe(0);
    press({ kind: "esc" });
    expect(S().focus).toBe("index");
    const r = await app.act({ action: "section", args: { name: "selection" }, as: "test-agent" }) as any;
    expect(r).toEqual({ section: 15, key: "selection" });
    expect(S().focus).toBe("index");
    expect((app as any).message).toContain("an agent (test-agent) showed section 15");
    const listed = (app.actions() as any).actions.map((a: any) => a.name);
    expect(listed).toContain("section");
    expect(listed).toContain("select");
    // A note action runs in the section's reader, attributed to the agent.
    const sel = await app.act({ action: "select", args: { text: "red lentils" }, as: "test-agent" }) as any;
    expect(JSON.stringify(sel)).toContain("red lentils");
    expect(app.describe()).toMatchObject({ screen: "showcase", state: { kind: "showcase", section: { key: "selection" }, focus: "index" } });
    await expect(app.act({ action: "section", args: { name: "nope" }, as: "test-agent" })).rejects.toThrow(/no section nope/);
  }, 20_000);

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


// PIE-506: agent parity. Every key a screen handles runs an action that declares it, so an agent can do
// the same through `act`; and every key a hint row names is declared by an action the screen takes. Not a
// hand-kept list of keys: each screen is built against a scratch outline and every key is pressed, one at
// a time from where the screen opens (and, from an input state such as a prefix, a picker or an edit, a
// second key), and the actions that ran are traced (`traceActions`). A key that changed what the screen
// shows, or moved the screen stack, without running an action that names it in its `keys`, fails.
// A key that only puts the screen into an input state (`holdsKeys`: a prefix, a palette, an edit) is the
// start of a chord: what the state ends in is checked the same way. Scratch services, fictional notes.
//
// The screens are probed in six parts, a test file each (test/parity-*.test.ts), each with its own door and
// scratch service. A part runs its scenarios one after another in one worker, so the longest part is the door suite's
// longest file, and CI's run waits for it: in three parts, two took 8½ minutes of a 9-minute green run, and a runner
// that slowed every parity test 2-3x ran past the 12-minute stop (PIE-831). In five, with the shell's states probed once
// (below), the longest takes 231 s on float-box where the longest of three took 331 s. The showcase now runs
// separately so its long walks don't wait behind the desk and its tiles (PIE-901). PARITY_ONLY=<label,…> narrows
// any of them (it splits on commas; `-t` picks a label holding one).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { declaredKeys, hintKeys, keyName, traceActions, type ActionRun } from "../src/surface/actions";
import { rewriteRequests, traceRequests, type RunRequest } from "../src/surface/dispatch";
import { SHELL_ACTIONS, MENU_SCREENS, MainMenu, MessageReader, StatusMessages } from "../src/screens";
import { DRAWER_ACTIONS } from "../src/drawer";
import { EXT_ACTIONS } from "../src/extensions";
import { NEW_NOTE_ACTIONS } from "../src/new-note";
import { SocketBoard } from "../src/socket";
import type { Msg } from "../src/board";
import type { Key } from "../src/term";
import type { Screen } from "../src/app";
import { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { PtyPane } from "../src/desk/pty";
import { SEED } from "../src/showcase/seed";
import { external } from "../src/open";
import { DEFAULT_THEME, setTheme } from "../src/theme";
import { outliner, Scratch } from "./scratch";
import { watchHosts } from "./settle";
import { cacheReads } from "./board-reads";
import { ScenarioBudget } from "./parity-budget";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

/** Every key a person can press, but ctrl+c (the door's own quit) and a paste. */
export const PROBE_KEYS: Key[] = [
  ...Array.from({ length: 94 }, (_, i): Key => ({ kind: "char", ch: String.fromCharCode(33 + i) })),
  { kind: "char", ch: " " },
  ..."abdefghijklmnopqrstuvwxyz".split("").map((ch): Key => ({ kind: "char", ch, ctrl: true })),
  { kind: "char", ch: "]", ctrl: true },
  // cmd+c (super+c): the copy, wherever a selection is.
  { kind: "super", ch: "c" },
  ..."abcdefghijklmnopqrstuvwxyzACDLRX".split("").map((ch): Key => ({ kind: "alt", ch })),
  ...(["up", "down", "left", "right", "alt-enter", "esc", "backspace", "tab", "backtab", "pgup", "pgdn", "home", "end", "delete", "alt-left", "alt-right"] as const).map((kind) => ({ kind }) as Key),
  { kind: "enter" },
];

/**
 * A row with its ages ("12s", "3m": src/text.ts `ago`) as one word: they tick by the second, so a row changed by
 * itself whenever a probe's look fell across a boundary (the hub picker's rows did, now and then).
 * Escape sequences are left whole (their `…;8m` isn't an age).
 */
const ageless = (l: string) => l.replace(/(\x1b\[[\d;?]*[A-Za-z])|(?<![\d.:])\d+[smhd](?![A-Za-z0-9])/g, (m, esc) => esc ?? "#age");

interface Snap { top: Screen | undefined; depth: number; lines: string[]; about: string; holds: boolean; video: string; drawer: string; /** The hint row as drawn (checkHint), when the screen was drawn for this look. */ hint?: string }
interface Finding { screen: string; keys: string; problem: string }

/**
 * The screens each part probes: the menu's screens; the home base, the library, EchoNet and the readers; the board and
 * the river; the desk's views and the drawer; the desk's tiles and daily layout; the showcase and its section states.
 */
export type ParityPart = "screens" | "readers" | "board" | "desk" | "desk-tiles" | "showcase";

export function parity(part: ParityPart) {
describe.skipIf(!outliner)(`agent parity: every key a screen handles is an action (PIE-506), ${part}`, () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, reads: ReturnType<typeof cacheReads>;
  let press: (k: Key) => void = () => {};
  /** Keys read as one chunk of input (Term's onBatch): handled together, the screen painted once after them. */
  let batch: (run: () => void) => void = run => run();
  // Settled means no answer from the host is awaited, whichever way the screen asked (test/settle.ts).
  // The power bar (ctrl+k) still asking its sources is not settled either: its rows land after.
  const hosts = watchHosts(() => { const bar = (app as any)?.bar; return !!bar && (bar.asking.size > 0 || !!bar.timer); });
  // The door paints at most every 16 ms (App.redraw): a paint asked for too soon waits on a timer and fires whenever the event
  // loop next turns, between two probes at random. Settled means that paint was made, now: the screen the probe looks at is the
  // one the door drew (snap), not one drawn again beside it.
  const flushPaint = () => {
    const a = A();
    if (!a?.paintTimer) return false;
    a.flush();   // the door's own "paint now": the timer cleared, the frame made
    return true;
  };
  const settle = async () => {
    for (let i = 0; ; i++) {
      await hosts.settle();
      if (!flushPaint()) return;
      // A paint that asked for more (a chain of loads: a list, then its rows, then their notes) is followed; one that never ends
      // (a spinner) is left, counted for the log.
      if (i === 7) { stats.unsettled++; return; }
    }
  };
  /** The screen as the last paint drew it, while nothing has asked for another (snap reads it instead of drawing the screen again). */
  let painted: { top: Screen; lines: string[]; at: number; refused: boolean } | null = null;
  /** What a paint the door made threw (the timer's, or a key's own), kept for the next look: it is the probe's finding, not an error from outside any test. */
  let paintFailed: unknown = null;
  /** Frames the door has painted: a key's own paint draws the screen as the person sees it, so a build looks again only when none came. */
  const frames = () => (A().speed?.frames ?? 0) as number;
  /** A terminal tile drew since this was last cleared: its program may still be printing. */
  let ptyDrew = false;
  let notes: Msg[] = [];
  /** What beforeAll changed outside this file (prototypes, the environment), put back by afterAll. */
  const restore: (() => void)[] = [];
  const A = () => app as any;
  const found: Finding[] = [];
  const log = process.env.PARITY_LOG;
  const say = (f: Finding) => { if (log) require("node:fs").appendFileSync(log, `${f.screen}\t${f.keys}\t${f.problem}\n`); };
  const findings = { push(f: Finding) { found.push(f); say(f); } };
  const hintFound: Finding[] = [];
  const hintFindings = { push(f: Finding) { if (!hintFound.some(h => h.screen === f.screen && h.keys === f.keys)) { hintFound.push(f); say(f); } } };

  beforeAll(async () => {
    const env = { ...process.env };
    restore.push(() => { for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "VISUAL", "EDITOR", "EP0CH_EDIT_ARM", "EP0CH_BAR_ASK_MS"]) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
    process.env.EP0CH_STATE = join(scratch.root, "door");
    mkdirSync(process.env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    // The daily layout's agent: a program that prints nothing, so no prompt arrives between two looks.
    process.env.EP0CH_DAILY_AGENT = "sleep 3600";
    // e arms the edit (edit.arm): a window longer than any probe, so an arm never runs out between a key and the next.
    process.env.EP0CH_EDIT_ARM = "600000";
    // The power bar asks its searching sources at once, not after typing pauses: settle() waits for the answer anyway.
    process.env.EP0CH_BAR_ASK_MS = "0";
    // ctrl+e hands the note to $EDITOR: one that exits at once, so the probe goes on.
    process.env.VISUAL = process.env.EDITOR = "true";
    // Over the whole door, as on a screen without tiles, not in a tile beside the note (PIE-417): whether that
    // tile's editor had exited by the time the probe looked was a race, so runs explored different input states.
    // The tile's own path is desk-tiles.test.ts's (a fake editor that waits).
    const inTile = Desk.prototype.inTile;
    Desk.prototype.inTile = () => false;
    restore.push(() => { Desk.prototype.inTile = inTile; });
    // A terminal that drew may still be printing (a prompt arriving): fresh() waits for it to hold still.
    const ptyRender = PtyPane.prototype.render;
    PtyPane.prototype.render = function (this: PtyPane, ...a: Parameters<typeof ptyRender>) { ptyDrew = true; return ptyRender.apply(this, a); };
    restore.push(() => { PtyPane.prototype.render = ptyRender; });
    // A paint the timer makes (App.redraw) of a screen whose render throws, as a probe can leave one (a section whose tile it
    // closed), would end the run from outside any test: snap() draws the screen too and says "render threw" about it.
    // The rows it draws the screen with are kept for snap(), which would draw the same screen again.
    const paint = (App.prototype as any).paint;
    (App.prototype as any).paint = function (this: App, ...a: unknown[]) {
      const top = A().stack.at(-1) as Screen | undefined, own = !!top && Object.hasOwn(top, "render"), render = top?.render;
      painted = null;
      if (top) top.render = function (this: Screen, ...r: Parameters<Screen["render"]>) {
        const frame = render!.apply(this, r);
        painted = { top, lines: frame.lines, at: frames(), refused: !!A().refusedNow };
        return frame;
      };
      const t0 = performance.now();
      try { return paint.apply(this, a); } catch (e) { paintFailed = e; /* the probe says it (snap) */ }
      finally { stats.paints++; stats.paintMs += performance.now() - t0; if (top) { if (own) top.render = render!; else delete (top as { render?: unknown }).render; } }
    };
    restore.push(() => { (App.prototype as any).paint = paint; });
    const run = external.run;
    external.run = () => {};
    restore.push(() => { external.run = run; });
    board = new SocketBoard(await scratch.start());
    reads = cacheReads(board);
    await board.info();
    await scratch.seedShowcase();
    notes = await board.changedSince(0, 20);
    // The door's clock two days on: the seeded notes it lists then read "2d" old, not "9s", "10s" … as they did for the
    // first minute and a half, when the activity tile's ages ticked under the probes (a wider age shifts its row and
    // cuts its title one cell shorter, so masking the digits wasn't enough): a key took the blame for a tick.
    const now = Date.now;
    Date.now = () => now() + 2 * 86_400_000;
    restore.push(() => { Date.now = now; });
    newApp();
    board.subscribe(e => { reads.forget(); app.event(e); });
  }, 60_000);

  /** A door of its own for each screen: nothing one screen's probes left (a dock, a timer) reaches the next. */
  function newApp() {
    if (app) { for (const s of [...A().stack.splice(0), ...A().background.splice(0)]) end(s); try { app.quit(); } catch { /* gone */ } }
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { press = f; }, onBatch(f: any) { batch = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    A().cycleVideo = function () { this.video = this.video === "cells" ? "kitty" : "cells"; };
  }

  afterAll(async () => {
    for (const s of [...(A().stack ?? []), ...(A().background ?? [])]) end(s);
    board?.close();
    await scratch.dispose();
    for (const f of restore.splice(0).reverse()) f();
  });

  /**
   * What the door shows (`glance`: only the rows drawn): the screen's rows, and the status bar under them (its `+N ext` and the agent chip
   * take clicks). Of the bar, not what changes by itself: the clock, the uptime, how many changes came in, the
   * agent chip's words (its agent working or not), and the message a key flashes (it runs out on a timer), with its copy
   * on the focused tile's frame when it was a refusal (PIE-727: Ctx.refuse).
   */
  const snap = (mask: Set<number>, glance = false): Snap => {
    const top = A().stack.at(-1) as Screen | undefined;
    let lines: string[] = [], hint: string | undefined;
    try {
      if (top) {
        const { cols, rows } = A().term.info;
        const refused = A().refusedNow;
        A().refusedNow = null;
        // The last paint drew this screen, nothing has changed or asked for a paint since, and no refusal copy is on its frame
        // (a probe leaves that out): its rows are the screen's.
        const current = painted && painted.top === top && painted.at === frames() && !painted.refused && !A().changed && !A().paintTimer;
        try {
          const l0 = performance.now();
          const drawn = current ? painted!.lines : top.render(app).lines;
          if (!current) { stats.looks++; stats.lookMs += performance.now() - l0; }
          hint = plain(drawn.at(top instanceof MainMenu ? -2 : -1) ?? "");
          lines = drawn.slice(0, rows - 1).map(ageless);
        } finally { A().refusedNow = refused; }
        while (lines.length < rows - 1) lines.push("");
        const drawer = A().drawer;
        drawer.active = !top.noDrawer;
        const message = A().message;
        A().message = ""; drawer.chip = drawer.chipText = () => "agent";
        try { lines.push((A().statusBar(top, cols) as string).replace(/on \d+m │ \d\d:\d\d/, "on Nm │ hh:mm").replace(/\+\d+ (new|ext)\b/g, "+N $1")); }
        finally { A().message = message; delete drawer.chip; delete drawer.chipText; }
        A().statusBar(top, cols);   // where its `+N ext` and chip are as drawn, for the clicks
        lines = lines.map((l, i) => (mask.has(i) ? "" : l));
      }
    } catch (e) { lines = [`render threw ${e}`]; }
    if (paintFailed) { lines = [`render threw ${paintFailed}`]; paintFailed = null; }
    // A glance is the screen drawn and nothing to compare: what a build does between its keys (no description, no whereabouts).
    if (glance) return { top, depth: A().stack.length, lines, about: "", holds: false, video: app.video, drawer: dock() };
    let about = "";
    try { about = JSON.stringify(top?.describe?.() ?? null); } catch { about = "?"; }
    return { top, depth: A().stack.length, lines, about: mask.has(-1) ? "" : about, holds: app.person().busy, video: app.video, drawer: dock(), hint };
  };
  /**
   * The drawer over the screen: up or put away, the person in it or not, its height. Its rows are the
   * agent's terminal (they change by themselves), so the dock is compared by these, not by what it draws.
   */
  const dock = () => { const d = A().drawer; return `${d.shown}|${d.entered}|${d.share}`; };
  /** The same screen shown the same way (`about`: and described the same; two builds differ in ids and revisions). */
  const alike = (a: Snap, b: Snap, about = true) => a.top?.constructor === b.top?.constructor && a.depth === b.depth && a.video === b.video && a.drawer === b.drawer && (!about || a.about === b.about) && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);
  const same = (a: Snap, b: Snap) => a.top === b.top && a.depth === b.depth && a.video === b.video && a.drawer === b.drawer && a.about === b.about && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);

  /** A fresh screen on the stack (over the menu), settled; and the rows that change by themselves (a clock, a meter). */
  /** A screen gone for good: what it started ends too (a desk keeps its programs running otherwise). */
  const end = (s: Screen) => {
    try { if (s.dispose?.() === "keep") for (const p of (s as any).panes?.values?.() ?? []) p.dispose?.(); } catch { /* gone */ }
  };
  const masks = new Map<string, Set<number>>();
  /** A fresh screen on the stack (over the menu), settled; and the rows that change by themselves (a clock, a meter). */
  const stats = { fresh: 0, freshMs: 0, second: 0, unsettled: 0, paints: 0, paintMs: 0, looks: 0, lookMs: 0, pressMs: 0, settleMs: 0 };
  /**
   * A scenario is held to a budget (PARITY_BUDGET_MS, 60 s): past it the scenario fails by name, with the slowest key and the
   * slowest build, rather than running on to the test's own timeout (PIE-1307: one ran 570 s against a 600 s limit and took the
   * next scenario with it). Checked between probes and builds, so a hung settle (3 s at most) is the longest it overshoots.
   */
  const budget = new ScenarioBudget(Number(process.env.PARITY_BUDGET_MS) > 0 ? Number(process.env.PARITY_BUDGET_MS) : 60_000);
  const keysLog = process.env.PARITY_KEYS;   // every probe's key and its milliseconds, one line each: what a scenario spends its time on
  let scenario = "";
  const timed = (key: string, since: number) => {
    const ms = performance.now() - since;
    budget.key(key, ms);
    if (keysLog) require("node:fs").appendFileSync(keysLog, `${scenario}\t${key}\t${ms.toFixed(1)}\n`);
  };
  let replaying = false;
  const overBudget = (label: string, doing: string) => replaying || budget.check(label, doing, { builds: stats.fresh, buildMs: stats.freshMs, seconds: stats.second });
  const fresh = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[] = []): Promise<Set<number>> => {
    overBudget(label, "a build");
    stats.fresh++; const f0 = performance.now();
    try { return await freshWith(label, make, setup); } finally { const ms = performance.now() - f0; stats.freshMs += ms; budget.build(ms); }
  };
  /**
   * A setup's keys are a way to a state, not what is probed. Pressed one by one each paints the screen (a person's keys do),
   * and a scenario is built a few hundred times; pressed as one chunk of input, as a fast typist's or a paste arrives, the
   * screen is painted once after them. The first build of a setup is made both ways and the two screens compared: when
   * they match the setup is pressed as a chunk from then on, else it keeps painting between keys (a key that waits on
   * what the last one's paint asked for, a list's rows, is one only the slow way reaches).
   */
  const pacing = new Map<string, boolean>();
  const freshWith = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[]): Promise<Set<number>> => {
    if (setup.length < 2 || process.env.PARITY_PACED === "1") return freshIn(label, make, setup, false);
    const id = `${label}\0${setup.map(named).join(" ")}`, known = pacing.get(id);
    if (known !== undefined) return freshIn(label, make, setup, known);
    const mask = await freshIn(label, make, setup, false);
    const paced = snap(mask);
    await freshIn(label, make, setup, true);
    const chunk = snap(mask), ids = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#id");
    const alikeChunk = paced.top?.constructor === chunk.top?.constructor && paced.depth === chunk.depth && paced.holds === chunk.holds && paced.drawer === chunk.drawer && ids(paced.about) === ids(chunk.about) && paced.lines.length === chunk.lines.length && paced.lines.slice(0, -1).every((l, i) => l === chunk.lines[i]);   // the status bar's clock is another minute's
    pacing.set(id, alikeChunk);
    if (log) require("node:fs").appendFileSync(log, `# ${label}: setup ${setup.map(named).join(" ")} ${alikeChunk ? "as a chunk of input reaches the same screen" : "painted between keys: as a chunk it reaches another screen"}\n`);
    return alikeChunk ? mask : freshIn(label, make, setup, false);
  };
  const freshIn = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[] = [], chunked = false): Promise<Set<number>> => {
    paintFailed = null;
    for (const s of [...A().stack.splice(0), ...A().background.splice(0)]) end(s);
    // The power bar is the App's, over every screen: put away.
    A().bar?.close(); A().bar = null;
    (Desk as any).kept = null;
    // The drawer is the App's, over every screen: put away, its program ended.
    const drawer = A().drawer;
    // Put away by its own operation (the host layer changes only through the layout engine).
    if (drawer.open) drawer.set(false, { kind: "user" });
    drawer.openedBy = null;
    try { drawer.p?.dispose?.(); } catch { /* gone */ }
    drawer.p = null;
    // Its desk too, made again when next needed: a tile a probe moved into the drawer stayed there for every later build, and the
    // screen's own tile of that name was named again beside it (tree2: PIE-1317), so those builds weren't the screen the label names.
    if (drawer.made) { end(drawer.made); drawer.d = null; }
    // What a screen saved (the board's lanes, the desk's layout) would carry one probe's change into the next.
    const dir = process.env.EP0CH_STATE!;
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f), { force: true });
    // A probe's alt+t (theme.cycle) changes every screen's colours: each screen starts in the default theme.
    setTheme(DEFAULT_THEME);
    A().stack.push(new MainMenu());
    ptyDrew = false;
    const s = await make();
    let pressed = frames();
    if (!(s instanceof MainMenu)) app.push(s); else A().stack.splice(0, 1, s);
    A().lastInput = 0;
    await settle();
    // Drawn before each key as the person would see it (a key can depend on the last layout, as the river's
    // ⏎ does), and settled after: a paint asks for what it draws (a reply count, a title).
    if (chunked) { batch(() => { for (const k of setup) press(k); }); await settle(); }
    else for (const k of setup) { if (frames() === pressed) snap(new Set(), true); await settle(); pressed = frames(); press(k); await settle(); }
    // A second look only when the first asked the service for something (what it draws once that comes).
    for (let i = 0; i < 2; i++) { const n = hosts.asked(); if (i > 0 || frames() === pressed) snap(new Set(), true); await settle(); if (hosts.asked() === n) break; }
    // Until it holds still (a terminal's prompt arriving), at most a second. Only a terminal draws by itself
    // (in a tile, or the drawer's): without one, the looks above (settled, nothing more asked of the host) were enough.
    if (ptyDrew || drawer.p) {
      for (let i = 0, was = snap(new Set()); i < 50; i++) { if (ptyDrew || drawer.p || i > 0) await Bun.sleep(5); await settle(); const now = snap(new Set()); if (alike(was, now)) break; was = now; }
    }
    const id = `${label}\0${setup.map(named).join(" ")}`;
    let mask = masks.get(id);
    if (!mask) {
      await Bun.sleep(80); await settle();
      const a = snap(new Set()), b = (await Bun.sleep(150), await settle(), snap(new Set()));
      mask = new Set<number>();
      a.lines.forEach((l, i) => { if (l !== b.lines[i]) mask!.add(i); });
      if (a.about !== b.about) mask.add(-1);
      masks.set(id, mask);
    }
    return mask;
  };

  /**
   * A run a key can be said to have run. A read no key names (touches nothing, declares no keys) is a part asking for
   * what it draws, such as the power bar's screens source calling screen.list for its rows as the person types: the
   * typing is the bar's, and the read is never that key's action.
   */
  const keyed = (r: ActionRun) => r.touches !== "nothing" || !!r.keys;
  const tokens = (runs: ActionRun[]) => new Set(runs.flatMap(r => [...declaredKeys(r.keys)]));
  const named = (k: Key) => (k.kind === "mouse" ? `${k.action === "down" ? "click" : k.action}@${k.x},${k.y}` : keyName(k) ?? "?");
  /** What the declared keys must name for this probe: the key's name, or for the mouse its gesture. */
  const declares = (t: Set<string>, k: Key, prefix?: Key) =>
    k.kind === "mouse" ? t.has(k.action === "wheel-up" || k.action === "wheel-down" ? "wheel" : "click") : t.has(keyName(k)!) || (!!prefix && t.has(`${keyName(prefix)} ${keyName(k)}`));

  /** Clicks over the screen: every row, every 26th column from a start that shifts row by row; and the wheel. */
  const clicks = async (): Promise<Key[]> => {
    const out: Key[] = [];
    // The status bar too (the last row): and its `+N ext` and agent chip, wherever they are drawn.
    for (let y = 0; y < 48; y++) for (let x = 1 + ((y * 7) % 26); x < 160; x += 26) out.push({ kind: "mouse", action: "down", button: 0, x, y });
    const status = await app.dispatch.act({ action: "status.bar.items" }, { kind: "user" }) as { items: { from?: number }[] };
    for (const at of status.items) if (at.from !== undefined) out.push({ kind: "mouse", action: "down", button: 0, x: at.from, y: 47 });
    // The wheel, both ways, over a coarser grid.
    for (let y = 4; y < 47; y += 12) for (let x = 10; x < 160; x += 40) for (const action of ["wheel-down", "wheel-up"] as const) out.push({ kind: "mouse", action, button: 0, x, y });
    return out;
  };
  const push = (k: Key) => {
    press(k);
    if (k.kind === "mouse" && k.action === "down") press({ ...k, action: "up" });
  };
  /** A probe's key: pressed, then waited out. Where the time goes (the door handling it, then painting and settling) is counted for the log. */
  const go = async (k: Key) => {
    const t0 = performance.now();
    push(k);
    const t1 = performance.now();
    await settle();
    stats.pressMs += t1 - t0; stats.settleMs += performance.now() - t1;
  };

  // Hints: every key the hint row names is declared by an action the screen (or the shell, or the drawer) takes.
  const checkHint = (label: string, looked?: Snap) => {
    const top = A().stack.at(-1) as Screen | undefined;
    if (!top) return;
    const acts = [...(top.dispatch?.list().actions ?? []), ...SHELL_ACTIONS.list(), ...DRAWER_ACTIONS.list(), ...EXT_ACTIONS.list(), ...NEW_NOTE_ACTIONS.list()];
    const declared = new Set(acts.flatMap(a => [...declaredKeys(a.keys)]));
    // The hint row, and the hint each tile draws in its frame when it has the keys (the desk and its views).
    const tiles: { hint?(): string }[] = [...((top as any).panes?.values?.() ?? [])];
    // A row cut on a narrow screen ("? more", PIE-509) is checked whole, and so is a float's frame hint.
    // The menu ends in newscan metadata, so its last key hint row is immediately above it.
    const row = looked?.top === top && looked.hint !== undefined ? looked.hint : plain(top.render(app).lines.at(top instanceof MainMenu ? -2 : -1) ?? ""), full = (top as any).hintFull as string | null | undefined;
    for (const hint of [full ? plain(full) : row, plain((top as any).floatHint?.() ?? ""), ...tiles.map(t => plain(t.hint?.() ?? ""))])
    for (const k of hintKeys(hint)) if (!declared.has(k) && k !== "click" && k !== "drag" && k !== "wheel") hintFindings.push({ screen: `${label} (${top.title})`, keys: k, problem: `the hint names ${k}, which no action here declares: ${hint.trim().slice(0, 140)}` });
  };

  /**
   * A change with no action, checked once more before it's a finding: the screen built again, the rows that
   * change by themselves in the meantime (a terminal's prompt arriving, a section opening its panel) masked
   * from then on, and the key pressed again. When it still changes the screen without an action, what changed (the
   * finding says it, so a finding that comes and goes shows what moved); else null.
   */
  async function bare(label: string, make: () => Screen | Promise<Screen>, setup: Key[], k: Key): Promise<string | null> {
    let mask = await fresh(label, make, setup);
    const a = snap(mask);
    await Bun.sleep(150); await settle();
    const b = snap(mask);
    a.lines.forEach((l, i) => { if (l !== b.lines[i]) mask.add(i); });
    if (a.about !== b.about) mask.add(-1);
    const base = snap(mask);
    const runs: ActionRun[] = [];
    const stop = traceActions(r => { if (keyed(r)) runs.push(r); });
    try { await go(k); } finally { stop(); }
    const after = snap(mask);
    if (same(base, after) || runs.length || (after.holds && after.top === base.top)) return null;
    return changes(base, after) || "the screen";
  }
  /** What differs between two looks: the stack, the description, the rows (cut short). Two builds (`sameBuild` false) have their own screens: the stack differs when its kind or depth does. */
  const changes = (a: Snap, b: Snap, sameBuild = true) => {
    /** Where two strings first differ, and a little of each from just before it. */
    const from = (x: string, y: string) => {
      let i = 0;
      while (i < x.length && x[i] === y[i]) i++;
      const at = (z: string) => JSON.stringify(z.slice(Math.max(0, i - 16), i + 40)).slice(1, -1);
      return `at ${i}: "${at(x)}" → "${at(y)}"`;
    };
    // The words that changed; or, the same words drawn differently (a colour, a weight), the escapes that did.
    const row = (l: string, m: string) => (plain(l) !== plain(m) ? from(plain(l), plain(m)) : `same text, drawn differently ${from(l, m)}`);
    const rows = a.lines.flatMap((l, i) => (l === b.lines[i] ? [] : [`row ${i}: ${row(l, b.lines[i] ?? "")}`]));
    return [(sameBuild ? a.top !== b.top : a.top?.constructor !== b.top?.constructor) || a.depth !== b.depth ? "the stack" : "", a.video !== b.video ? `video ${a.video} → ${b.video}` : "", a.drawer !== b.drawer ? `the drawer ${a.drawer} → ${b.drawer}` : "", a.about !== b.about ? "its description" : "", ...rows.slice(0, 3), rows.length > 3 ? `${rows.length - 3} more rows` : ""].filter(Boolean).join("; ");
  };

  /**
   * Press every key, and click across the screen, as it opens; then, from each key that left it holding the
   * keys (an input state), every key again.
   */
  async function audit(label: string, make: () => Screen | Promise<Screen>, setup: Key[] = []) {
    newApp();
    let mask = await fresh(label, make, setup);
    let dirty = false;
    // What the last probe left, when it changed nothing and ran nothing: the next probe's starting point.
    let last: Snap | null = null;
    const states: Key[] = [];
    checkHint(label);
    /**
     * A state probed already (`sharedStates`): one the same action opened, the shell's on any screen, a screen's own
     * on a screen of the same kind.
     */
    const shared = (k: Key, runs: ActionRun[]) => {
      // The action the key ran first opened the state (what it opened may run its own: a tile's tab.select).
      const first = runs[0];
      if (!first) return false;
      // The shell's states are the same on every screen: probed in the desk part only (its first scenario, the tree,
      // opens them all: ctrl+n, alt+a, alt+g, alt+o, alt+s, alt+w), never again in each other part's first scenario
      // that opens them (a minute or two a part).
      if (GLOBAL_SCOPES.has(first.scope) && part !== "desk") return true;
      const where = GLOBAL_SCOPES.has(first.scope) ? "" : ((A().stack.at(-1) as Screen | undefined)?.constructor.name ?? "?");
      const id = `${where}\0${named(k)}\0${first.scope}.${first.name}`;
      if (sharedStates.has(id)) return true;
      sharedStates.add(id);
      return false;
    };
    // The states this scenario has opened: a state is the action that opened it and the screen it left, so a second key that opens
    // the same one (showcase.section.try by enter, l, right and tab) is the same state, probed once. The same only when everything
    // seen is: the rows under the status bar, the description (without the tiles' ids, new each build), the stack and the drawer.
    // Two keys that open different modes of one action (note.props: i inline, I full) draw differently, and both are probed.
    const reachedStates = new Set<string>();
    const reached = (k: Key, runs: ActionRun[], after: Snap) => {
      const ids = (t: string) => t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "#id");
      const id = `${runs[0]?.scope}.${runs[0]?.name}\0${after.top?.constructor.name}\0${after.depth}\0${after.drawer}\0${ids(after.about)}\0${after.lines.slice(0, -1).join("\n")}`;
      if (!reachedStates.has(id)) { reachedStates.add(id); return false; }
      if (log) require("node:fs").appendFileSync(log, `# ${label}: ${named(k)} reaches the state ${runs[0]?.name} did, probed already\n`);
      return true;
    };
    /** The targeted actions a key or click ran alone, once each: replayed below as the act string would address the tile (PIE-1286). */
    const pointed = new Map<string, { key: Key; req: RunRequest }>();
    for (const k of [...PROBE_KEYS, ...await clicks()]) {
      if (dirty) { mask = await fresh(label, make, setup); dirty = false; last = null; }
      const base = last ?? snap(mask);
      const runs: ActionRun[] = [], every: ActionRun[] = [];
      const reqs: RunRequest[] = [];
      const stop = traceActions(r => { every.push(r); if (keyed(r)) runs.push(r); });
      const stopReqs = traceRequests(r => { if (r.actor.kind === "user") reqs.push(r); });
      if (process.env.PARITY_TRACE) require("node:fs").appendFileSync(process.env.PARITY_TRACE, `${label} ${named(k)}\n`);
      overBudget(label, `key ${named(k)}`);
      const pressed = performance.now(), asked = A().redrawsAsked();
      try { await go(k); } finally { stop(); stopReqs(); timed(named(k), pressed); }
      const after = snap(mask);
      const req = reqs[0];
      // Pointed at a tile: it was named (`tile=`), or the action is a tile's own (its default is the focused one, so an id says the same).
      if (runs.length === 1 && reqs.length === 1 && req?.tile?.id && req.replay === "safe" && (req.named || req.takes === "tile") && !same(base, after) && !/t-[0-9a-f]{8}-/.test(JSON.stringify(req.args))) {
        const id = `${req.action}\0${req.tile.name}\0${JSON.stringify(req.args)}`;
        if (!pointed.has(id)) pointed.set(id, { key: k, req });
      }
      last = after;
      // A screen an action changed was repainted (PIE-1301): the action redrew it, or said it changed what's shown (`repaints`).
      if (every.length && !same(base, after) && A().redrawsAsked() === asked) findings.push({ screen: label, keys: named(k), problem: `ran ${every.map(r => r.name).join(", ")}, which changed the screen and asked for no repaint (declare repaints: true)` });
      if (same(base, after) && !runs.length) continue;
      dirty = true;
      if (same(base, after)) continue;          // ran an action that changed nothing (refused): fine
      checkHint(label, after);
      // A key that leaves the screen holding the keys starts an input state (a prefix, a palette, an edit,
      // a comment, the property panel), whether or not an action opened it: its keys are probed next.
      const opened = after.holds && !base.holds && after.top === base.top && k.kind !== "mouse";
      if (runs.length) {
        if (!declares(tokens(runs), k)) findings.push({ screen: label, keys: named(k), problem: `ran ${runs.map(r => r.name).join(", ")}, whose keys don't name it` });
        if (log && opened) require("node:fs").appendFileSync(log, `# ${label}: ${named(k)} opened by ${runs.map(r => `${r.scope}.${r.name}`).join(",")}\n`);
        if (opened && !shared(k, runs) && !reached(k, runs, after)) states.push(k);
        continue;
      }
      if (after.holds && after.top === base.top) { if (log && k.kind !== "mouse") require("node:fs").appendFileSync(log, `# ${label}: ${named(k)} holds, no action\n`); if (k.kind !== "mouse") states.push(k); continue; }
      const changed = await bare(label, make, setup, k);
      if (!changed) continue;
      findings.push({ screen: label, keys: named(k), problem: `${after.top !== base.top || after.depth !== base.depth ? "moved the screen stack without an action" : "changed the screen without an action"} (${changed})` });
    }
    if (log) require("node:fs").appendFileSync(log, `# ${label}: input states ${states.map(named).join(" ")}\n`);
    if (process.env.PARITY_DEPTH === "1") { await addressed(label, make, setup, pointed); return; }
    // The second key, from each input state: typing that keeps the state is the state's; a key that ends it
    // with a change must run an action (a cancel that puts the screen back as it was is fine).
    // Second keys: every key, as the first key is (PARITY_QUICK=1: only the keys that type text or are named,
    // and the ctrl and alt keys an action here declares).
    const top = A().stack.at(-1) as Screen | undefined;
    const declared = new Set([...(top?.dispatch?.list().actions ?? []), ...SHELL_ACTIONS.list(), ...DRAWER_ACTIONS.list(), ...EXT_ACTIONS.list(), ...NEW_NOTE_ACTIONS.list()].flatMap(a => [...declaredKeys(a.keys)]).flatMap(t => t.split(" ")));
    const seconds = process.env.PARITY_QUICK !== "1" ? PROBE_KEYS : PROBE_KEYS.filter(k => (k.kind !== "alt" && !(k.kind === "char" && k.ctrl)) || declared.has(keyName(k)!));
    for (const k1 of states) {
      dirty = true;
      let rest: Snap | null = null, entered: Snap | null = null;
      // What the last second key left, when it changed nothing: the next one starts from it (as the first keys do).
      let cur: Snap | null = null;
      for (const k2 of seconds) {
        if (dirty) {
          mask = await fresh(label, make, setup);
          rest = snap(mask);
          press(k1); await settle(); snap(mask, true); await settle();
          entered = cur = snap(mask); dirty = false;
        }
        const mid = cur ?? snap(mask);
        cur = null;
        const runs: ActionRun[] = [];
        const stop = traceActions(r => { if (keyed(r)) runs.push(r); });
        overBudget(label, `keys ${named(k1)} ${named(k2)}`);
        const pressed = performance.now();
        try { await go(k2); } finally { stop(); timed(`${named(k1)} ${named(k2)}`, pressed); }
        const after = snap(mask);
        if (same(mid, after)) { cur = after; continue; }
        // Typing that keeps the state goes on from where it is (most second keys are text).
        if (!runs.length && after.holds && after.top === mid.top) { cur = after; continue; }
        // A cancel (the screen as it was before k1): k1 again enters the state, no rebuild needed.
        if (!runs.length && rest && alike(rest, after)) {
          press(k1); await settle();
          const again = snap(mask);
          if (!entered || !alike(entered, again)) dirty = true; else cur = again;
          continue;
        }
        dirty = true;
        // What the key ran names it, and the keys before it left the state as it was entered: nothing to confirm. A finding is made only
        // from the state built again (the keys before this one may have moved it on), so a suspect is built again, as the first keys'
        // findings are made from the first look. A state typing has moved on is built again whatever ran.
        if (runs.length && declares(tokens(runs), k2, k1) && entered && alike(entered, mid)) continue;
        const problem = await second(label, make, setup, k1, k2);
        if (problem) findings.push({ screen: label, keys: `${named(k1)} ${named(k2)}`, problem });
      }
    }
    // The address replays last, outside the scenario's budget: they are one more pass over the targeted actions it found, not more keys.
    await addressed(label, make, setup, pointed);
  }

  /**
   * A key or click that ran one action on a tile ran it for that tile's id (PIE-1286). The same key pressed again, its request's
   * `tile=` said once as `t-<uuid>` and once as `role:<role>` (where the tile's role names it alone), must reach the same tile
   * and leave the screen as the key left it: pointing and naming are one path, so they can't drift apart (the sixth lift fix, not
   * the first). Only the address changes. The key's own gesture (where the pointer is, the row it lights) and its arguments are
   * the key's on that build, and its tile is the one the key reaches there: an earlier probe may have changed the outline the
   * screen is built from (PIE-1317), so nothing the walk saw (its arguments, its tile names) is carried in.
   */
  /** The screen once it holds still: looked at again until two looks are alike (a read the action started has landed). */
  async function calm(mask: Set<number>): Promise<Snap> {
    let was = snap(mask);
    for (let i = 0; i < 20; i++) { await Bun.sleep(15); await settle(); const now = snap(mask); if (alike(was, now, false)) return now; was = now; }
    return was;
  }
  const REPLAYED = new Set(["desk: tree", "desk: reader on a note", "desk: thread", "desk: activity"]);
  async function addressed(label: string, make: () => Screen | Promise<Screen>, setup: Key[], pointed: Map<string, { key: Key; req: RunRequest }>) {
    const replayed = { id: 0, role: 0 };
    replaying = true;
    const skip = (key: Key, req: RunRequest, way: string, why: string) => { if (log) require("node:fs").appendFileSync(log, `# ${label}: ${named(key)} ${req.action} by ${way} not replayed: ${why}\n`); return "skip" as const; };
    /**
     * `key` on a screen built afresh; with `address`, its request for `action` has its `tile=` said that way (`address` reads
     * the build: ids are new each build). The request as it ran (the tile it resolved to), what was said, and the screen once it
     * holds still; or why the build has no address.
     */
    const press = async (key: Key, action: string, address?: () => { address: string; id: string } | string) => {
      const mask = await fresh(label, make, setup);
      const to = address?.();
      if (typeof to === "string") return to;
      const heard = A().messages.rows.length;
      let ran: RunRequest | undefined, swapped = false;
      const stopTrace = traceRequests(r => { if (!ran && r.actor.kind === "user" && r.action === action) ran = r; });
      const stopSwap = to ? rewriteRequests((r, actor) => { if (swapped || actor.kind !== "user" || r.action !== action) return r; swapped = true; return { ...r, tile: to.address }; }) : () => {};
      try { push(key); await settle(); } finally { stopTrace(); stopSwap(); }
      // What the key said (a refusal is said, never thrown at a key): said the same whichever way the tile is named.
      const said = plain([A().refusedNow?.text, ...A().messages.rows.slice(heard).map((r: { message: string }) => r.message)].filter(Boolean).join(" · "));
      return { ran, swapped, said, id: to?.id, screen: await calm(mask) };
    };
    /** What's wrong, "skip" (logged with why) when the key can't be replayed `way` on a screen built now, or null. */
    const trial = async (key: Key, req: RunRequest, way: "id" | "role"): Promise<string | null> => {
      // A list's rows are numbered as the list stands when it is asked, and it fills as it draws: two builds can number it differently.
      if (req.action.startsWith("list.")) return skip(key, req, way, "a list's rows");
      const keyed = await press(key, req.action);
      if (typeof keyed === "string") return skip(key, req, way, keyed);
      if (!keyed.ran?.tile) return skip(key, req, way, `on a screen built now the key runs no ${req.action} on a tile${keyed.said ? ` (it said ${JSON.stringify(keyed.said.slice(0, 120))})` : ""}: an earlier probe changed what the screen is built from`);
      const name = keyed.ran.tile.name;
      const named_ = await press(key, req.action, () => {
        const at = (A().stack.at(-1) as Screen | undefined)?.dispatch?.tile(name) ?? A().drawer.desk?.dispatch.tile(name);
        if (!at?.id) return `no tile ${name} on a screen built now`;
        const address = way === "id" ? at.id : at.role ? `role:${at.role}` : "";
        return address ? { address, id: at.id } : `${name} has no role`;
      });
      if (typeof named_ === "string") return skip(key, req, way, named_);
      if (!named_.swapped) return skip(key, req, way, `on the second build the key ran no ${req.action}`);
      // A role that names several tiles is not an address for this one: the refusal says so, and that is the resolver's job.
      if (way === "role" && /names \d+ tiles/.test(named_.said)) return skip(key, req, way, "its role names several tiles");
      replayed[way]++;
      const by = way === "id" ? "id" : `role:${keyed.ran.tile.role}`;
      if (named_.ran?.tile?.id !== named_.id) return `${req.action} by ${by} reached ${named_.ran?.tile ? `${named_.ran.tile.name} (${named_.ran.tile.id})` : "no tile"} where the key reached ${name} (${named_.id})`;
      if (named_.said !== keyed.said) return `${req.action} by ${by} said ${JSON.stringify(named_.said.slice(0, 160))} where the key said ${JSON.stringify(keyed.said.slice(0, 160))}`;
      if (process.env.PARITY_DIFF && !alike(keyed.screen, named_.screen, false)) require("node:fs").appendFileSync(process.env.PARITY_DIFF, `${label} ${named(key)} ${req.action} by ${by}:\n  key: ${keyed.screen.lines.map(plain).join("\n  key: ")}\n  by:  ${named_.screen.lines.map(plain).join("\n  by:  ")}\n`);
      return alike(keyed.screen, named_.screen, false) ? null : `${req.action} ${JSON.stringify(keyed.ran.args)} by ${by} left the screen different from the key (${changes(keyed.screen, named_.screen, false)})`;
    };
    for (const { key, req } of pointed.values()) {
      for (const way of ["id", "role"] as const) {
        let problem = await trial(key, req, way);
        // A list that loads as it is drawn can end differently twice running: a difference is a finding when it comes again.
        if (problem && problem !== "skip") problem = await trial(key, req, way);
        if (problem && problem !== "skip") findings.push({ screen: label, keys: named(key), problem });
      }
    }
    replaying = false;
    // A walk that replays nothing proves nothing: these scenarios have tiles with actions of their own, so none replayed means the trace broke.
    if (REPLAYED.has(label) && replayed.id === 0) findings.push({ screen: label, keys: "-", problem: "no targeted action was replayed by id: the request trace (traceRequests), the rewrite (rewriteRequests) or the filter found none" });
    if (log) require("node:fs").appendFileSync(log, `# ${label}: ${pointed.size} targeted actions replayed by id (${replayed.id}) and by role (${replayed.role})\n`);
  }

  /** `k1` then `k2` on a fresh screen: what's wrong, or null. */
  async function second(label: string, make: () => Screen | Promise<Screen>, setup: Key[], k1: Key, k2: Key): Promise<string | null> {
    stats.second++;
    const mask = await fresh(label, make, [...setup, k1]);
    const mid = snap(mask);
    const runs: ActionRun[] = [];
    const stop = traceActions(r => { if (keyed(r)) runs.push(r); });
    const pressed = performance.now();
    try { await go(k2); } finally { stop(); timed(`${named(k1)} ${named(k2)}`, pressed); }
    const after = snap(mask);
    if (same(mid, after)) return null;
    if (runs.length) return declares(tokens(runs), k2, k1) ? null : `ran ${runs.map(r => r.name).join(", ")}, whose keys don't name it`;
    if (after.holds && after.top === mid.top) return null;   // still typing, or another input state
    // Cancelled: the screen as it was before the state, built again now so rows that age ("3s ago") match.
    // A second boundary can fall between the two snaps: a mismatch is tried twice more from the start.
    for (let tries = 0; tries < 3; tries++) {
      let m = mask;
      if (tries) { m = await fresh(label, make, [...setup, k1]); push(k2); await settle(); }
      const ended = snap(m);
      await fresh(label, make, setup);
      const again = snap(m);
      if (alike(again, ended, false)) return null;
      if (process.env.PARITY_DIFF) require("node:fs").appendFileSync(process.env.PARITY_DIFF, `${label} ${named(k1)} ${named(k2)}: ${again.about === ended.about ? "" : "describe differs; "}${again.lines.map((l, i) => (l === ended.lines[i] ? "" : `row ${i}: ${plain(l).trim().slice(0, 100)} | ${plain(ended.lines[i] ?? "").trim().slice(0, 100)}`)).filter(Boolean).join("\n  ")}\n`);
    }
    const changed = await bare(label, make, [...setup, k1], k2);
    return changed ? `ended an input state with a change and no action (${changed})` : null;
  }

  /**
   * The second keys of an input state an action opened are probed once (PIE-760): the shell's own (alt+g's picker,
   * ctrl+n's new note, the drawer) once in the whole suite, in the desk part on the desk's tree, whichever screen is
   * under them; a screen's own (the board's hub picker, an edit) on the first scenario of that screen that opens them. Probing them
   * again on every scenario was most of a part's time and found nothing new: the keys are the state's actions. A state
   * no action opened (a prefix such as ctrl+w) is probed on every scenario.
   */
  const GLOBAL_SCOPES = new Set(["shell", "drawer", "extensions", "new"]);
  const sharedStates = new Set<string>();

  type Scenario = [string, () => Screen | Promise<Screen>, Key[]?];
  const k = (ch: string): Key => ({ kind: "char", ch });
  const TAB: Key = { kind: "tab" };

  // ── every screen the menu opens, as it opens ──
  const SCREENS: Scenario[] = [
    ["main menu", () => new MainMenu()],
    // G logs off; !, E and + run an action, not a screen (+ is note.new, which the probes press as ctrl+n on every screen).
    // X, the showcase (a desk of its own), is probed in the showcase part.
    ...MENU_SCREENS.filter(([key]) => key !== "G" && key !== "!" && key !== "E" && key !== "+" && key !== "X").map(([key, make]): Scenario => [key, () => make(app) as Screen]),
  ];

  // ── the home base, the library and EchoNet ──
  const OTHERS: Scenario[] = [
    ["message reader", () => new MessageReader(notes, 0)],
    ["message log", () => { app.flash("The greenhouse door needs attention."); return new StatusMessages(app.messages); }],
    // The home base, opened by name on a door that is on an outline: it shows, and its choices are refused (no home).
    ["home base", () => openScreen("home", { folder: scratch.root })],
    // The same, saying a machine lacks the outline asked for (PIE-545): its offers' rows are pressed and clicked too.
    ["home base, an outline missing", () => openScreen("home", { folder: scratch.root, missing: { outline: "fern", machine: "box-a" } })],
    // The component library (PIE-618), in each of its parts: every key and click there is one of its actions.
    ["library", () => openScreen("library")],
    ["library: one property", () => openScreen("library"), [k("2")]],
    ["library: grids", () => openScreen("library"), [k("3")]],
    ["library: every combination", () => openScreen("library"), [k("4")]],
    // EchoNet's message areas (PIE-779), on the showcase's mini network: an area's messages, then one read.
    ["echonet: messages", () => openScreen("echonet"), [{ kind: "enter" }]],
    ["echonet: a message read", () => openScreen("echonet"), [{ kind: "down" }, { kind: "enter" }, { kind: "enter" }]],
  ];

  // ── the board in its other states (the keys and clicks of each area) ──
  const kanban = () => MENU_SCREENS.find(([key]) => key === "K")![1](app) as Screen;
  const BOARD: Scenario[] = [
    ["board: preview", kanban, [TAB]],
    ["board: detail", kanban, [{ kind: "enter" }]],
    ["board: float", kanban, [TAB, k("o")]],
    ["board: outline dock", kanban, [k("t")]],
    ["board: backlinks dock", kanban, [k("b")]],
    ["board: hub picker", kanban, [k("g")]],
  ];

  // ── the river in its other states ──
  const river = () => MENU_SCREENS.find(([key]) => key === "Q")![1](app) as Screen;
  const RIVER: Scenario[] = [
    ["river: a column beside", river, [{ kind: "enter" }]],
    ["river: replies shown", river, [k(" ")]],
    ["river: a held column and a stacked pane", river, [{ kind: "enter" }, k("p"), k("s")]],
  ];

  // ── the desk and the views built on it, in their other states ──
  const CTRL_W: Key = { kind: "char", ch: "w", ctrl: true };
  const ALT = (ch: string): Key => ({ kind: "alt", ch });
  const desk = () => new Desk();
  const DESK: Scenario[] = [
    ["desk: tree", desk, [k("1")]],
    ["desk: select wire", desk, [k("1"), ALT("l"), k("s")]],
    ["desk: alt wire", desk, [k("1"), ALT("l"), k("a")]],
    ["desk: wire policy", desk, [k("1"), CTRL_W, k("P")]],
    ["desk: thread", desk, [k("3")]],
    ["desk: activity", desk, [k("4")]],
    ["desk: reader on a note", desk, [k("1"), { kind: "down" }, { kind: "enter" }, k("2")]],
    ["desk: reader thread panel", desk, [k("1"), { kind: "down" }, { kind: "enter" }, k("2"), k("t")]],
    ["drawer: pulled up", () => new MainMenu(), [ALT("a")]],
  ];
  const DESK_TILES: Scenario[] = [
    ["desk: backlinks tile", desk, [k("1"), { kind: "enter" }, CTRL_W, k("o"), k("l"), k("5")]],
    ["desk: who tile", desk, [CTRL_W, k("o"), k("w"), k("5")]],
    ["desk: art tile", desk, [CTRL_W, k("o"), k("b"), k("5")]],
    ["desk: facets tile", desk, [CTRL_W, k("o"), k("f"), k("5")]],
    ["desk: tags tile", desk, [CTRL_W, k("o"), k("#"), k("5")]],
    ["desk: daily", () => new Desk(undefined, { layout: "daily" })],
    ["desk: a terminal", () => new Desk(undefined, { layout: "daily" }), [k("1")]],
  ];
  const SHOWCASE: Scenario[] = [
    ["X", () => MENU_SCREENS.find(([key]) => key === "X")![1](app) as Screen],
    ["showcase: section 3", () => MENU_SCREENS.find(([key]) => key === "X")![1](app) as Screen, [k("3")]],
    ["showcase: section 3 tried", () => MENU_SCREENS.find(([key]) => key === "X")![1](app) as Screen, [k("3"), { kind: "enter" }]],
  ];

  // ── the reader (the note surface), the edit, the comment and the property panel ──
  /** A seeded note by its title, read whole: what a reader scenario opens. */
  const note = async (title: string) => {
    const hit = (await board.search(title, 10)).find(m => m.text.startsWith(title) || m.text.split("\n")[0]!.includes(title));
    return (hit && (await board.get(hit.id))) ?? notes[0]!;
  };
  const reading = (title: string) => async () => new MessageReader([await note(title)], 0);
  const READER: Scenario[] = [
    ["reader: notebook", reading(SEED.notebook)],
    ["reader: notebook on an element", reading(SEED.notebook), [k("]")]],
    ["reader: notebook with a fold picked", reading(SEED.notebook), [k(")")]],
    ["reader: whiteboard", reading(SEED.whiteboard)],
    ["reader: recipe", reading(SEED.recipe)],
    ["reader: shed", reading(SEED.shed)],
    ["reader: brief", reading(SEED.brief)],
    ["reader: form", reading(SEED.formReading)],
    ["reader: form typing", reading(SEED.formReading), [k("]"), { kind: "enter" }]],
    ["reader: form choice", reading(SEED.formReading), [k("]"), { kind: "enter" }, { kind: "tab" }, { kind: "tab" }]],
    // PIE-786: a configurable note's settings card (,), on a rule note and on a view, and a field moved to.
    ["reader: a rule note's settings card", reading(SEED.settings), [k(",")]],
    ["reader: a rule note's settings card on its third field", reading(SEED.settings), [k(","), k("j"), k("j")]],
    ["reader: a view's settings card", reading(SEED.gardenView), [k(",")]],
    ["reader: a view that is an EchoNet area: a two-section card", reading(SEED.echoArea), [k(",")]],
  ];

  const ALL = { screens: SCREENS, readers: [...OTHERS, ...READER], board: [...BOARD, ...RIVER], desk: DESK, "desk-tiles": DESK_TILES, showcase: SHOWCASE }[part];
  const only = process.env.PARITY_ONLY?.split(",");
  for (const [label, make, setup] of ALL) {
    if (only && !only.includes(label)) continue;
    test(`${label}: every key and click it handles runs an action that names it`, async () => {
      const before = found.length + hintFound.length, t0 = Date.now();
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
      scenario = label; budget.start();
      await audit(label, make, setup ?? []);
      if (log) require("node:fs").appendFileSync(log, `# ${label}: ${Date.now() - t0} ms (${stats.fresh} builds, ${stats.freshMs} ms building, ${stats.second} second checks; slowest key ${budget.worst().key} ${budget.worst().keyMs.toFixed(0)} ms, slowest build ${budget.worst().buildMs.toFixed(0)} ms; keys: ${stats.pressMs.toFixed(0)} ms handling, ${stats.settleMs.toFixed(0)} ms settling; ${stats.unsettled} unsettled; ${stats.paints} paints ${stats.paintMs.toFixed(0)} ms, ${stats.looks} looks ${stats.lookMs.toFixed(0)} ms)\n`);
      for (const k of Object.keys(stats) as (keyof typeof stats)[]) stats[k] = 0;
      const mine = [...found, ...hintFound].slice(before).map(f => `${f.screen}\t${f.keys}\t${f.problem}`);
      expect(mine).toEqual([]);
    }, budget.limitMs + 60_000);
  }
  // The other parts leave the shell's states to this one: a desk that stopped opening one would leave it unprobed.
  if (part === "desk" && !only) test("the shell's input states were probed here, as no other part probes them", () => {
    const probed = new Set([...sharedStates].filter(id => id.startsWith("\0")).map(id => id.split("\0")[1]));
    expect([...probed].sort()).toEqual(["alt+a", "alt+g", "alt+o", "alt+s", "alt+w", "ctrl+n"]);
  });
});
}

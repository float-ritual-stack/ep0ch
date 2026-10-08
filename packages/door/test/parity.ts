// PIE-506: agent parity. Every key a screen handles runs an action that declares it, so an agent can do
// the same through `act`; and every key a hint row names is declared by an action the screen takes. Not a
// hand-kept list of keys: each screen is built against a scratch outline and every key is pressed, one at
// a time from where the screen opens (and, from an input state such as a prefix, a picker or an edit, a
// second key), and the actions that ran are traced (`traceActions`). A key that changed what the screen
// shows, or moved the screen stack, without running an action that names it in its `keys`, fails.
// A key that only puts the screen into an input state (`holdsKeys`: a prefix, a palette, an edit) is the
// start of a chord: what the state ends in is checked the same way. Scratch services, fictional notes.
//
// The screens are probed in three parts, a test file each (test/parity-*.test.ts), each with its own door and
// scratch service. PARITY_ONLY=<label,…> narrows any of them (it splits on commas; `-t` picks a label holding one).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { declaredKeys, hintKeys, keyName, traceActions, type ActionRun } from "../src/surface/actions";
import { SHELL_ACTIONS, MENU_SCREENS, MainMenu, MessageReader } from "../src/screens";
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

interface Snap { top: Screen | undefined; depth: number; lines: string[]; about: string; holds: boolean; video: string; drawer: string }
interface Finding { screen: string; keys: string; problem: string }

/** The screens each part probes: the menu's screens and the readers; the board and the river; the desk and its views. */
export type ParityPart = "screens" | "board" | "desk";

export function parity(part: ParityPart) {
describe.skipIf(!outliner)(`agent parity: every key a screen handles is an action (PIE-506), ${part}`, () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let press: (k: Key) => void = () => {};
  // Requests to the service waiting for their answer (and how many were asked); settle() waits on the last.
  let inflight = 0, asked = 0;
  let idle: (() => void)[] = [];
  const wake = () => { if (inflight === 0) { const w = idle; idle = []; for (const f of w) f(); } };
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
    restore.push(() => { for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "VISUAL", "EDITOR", "EP0CH_EDIT_ARM"]) { if (env[k] === undefined) delete process.env[k]; else process.env[k] = env[k]; } });
    process.env.EP0CH_STATE = join(scratch.root, "door");
    mkdirSync(process.env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    // The daily layout's agent: a program that prints nothing, so no prompt arrives between two looks.
    process.env.EP0CH_DAILY_AGENT = "sleep 3600";
    // e arms the edit (edit.arm): a window longer than any probe, so an arm never runs out between a key and the next.
    process.env.EP0CH_EDIT_ARM = "600000";
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
    const run = external.run;
    external.run = () => {};
    restore.push(() => { external.run = run; });
    board = new SocketBoard(await scratch.start());
    await board.info();
    await scratch.seedShowcase();
    notes = await board.changedSince(0, 20);
    // Settled means no request to the service is waiting for its answer.
    // Every connection's: the river's index reads on a lane of its own (SocketBoard.index).
    const request = SocketBoard.prototype.request;
    SocketBoard.prototype.request = function (this: SocketBoard, action: string, params?: Record<string, unknown>) {
      inflight++; asked++;
      return request.call(this, action, params).finally(() => { inflight--; wake(); });
    } as typeof request;
    restore.push(() => { SocketBoard.prototype.request = request; });
    newApp();
    board.subscribe(e => app.event(e));
  }, 60_000);

  /** A door of its own for each screen: nothing one screen's probes left (a dock, a timer) reaches the next. */
  function newApp() {
    if (app) { for (const s of [...A().stack.splice(0), ...A().background.splice(0)]) end(s); try { app.quit(); } catch { /* gone */ } }
    const term = { info: { cols: 160, rows: 48, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { press = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    A().cycleVideo = function () { this.video = this.video === "cells" ? "kitty" : "cells"; };
  }

  afterAll(async () => {
    for (const s of [...(A().stack ?? []), ...(A().background ?? [])]) end(s);
    board?.close();
    await scratch.dispose();
    for (const f of restore.splice(0).reverse()) f();
  });

  /** Until no answer is awaited, at most 3 s: woken when the last one comes, waiting again while new ones start. */
  const settle = async () => {
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
    const end = Date.now() + 3000;
    while (inflight > 0 && Date.now() < end) {
      await new Promise<void>(r => { const t = setTimeout(r, end - Date.now()); idle.push(() => { clearTimeout(t); r(); }); });
      await Bun.sleep(0);
    }
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
  };

  /**
   * What the door shows: the screen's rows, and the status bar under them (its `+N ext` and the agent chip
   * take clicks). Of the bar, not what changes by itself: the clock, the uptime, how many changes came in, the
   * agent chip's words (its agent working or not), and the message a key flashes (it runs out on a timer).
   */
  const snap = (mask: Set<number>): Snap => {
    const top = A().stack.at(-1) as Screen | undefined;
    let lines: string[] = [];
    try {
      if (top) {
        const { cols, rows } = A().term.info;
        lines = top.render(app).lines.slice(0, rows - 1).map(ageless);
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
    let about = "";
    try { about = JSON.stringify(top?.describe?.() ?? null); } catch { about = "?"; }
    return { top, depth: A().stack.length, lines, about: mask.has(-1) ? "" : about, holds: app.person().busy, video: app.video, drawer: dock() };
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
  const stats = { fresh: 0, freshMs: 0, second: 0 };
  const fresh = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[] = []): Promise<Set<number>> => {
    stats.fresh++; const f0 = Date.now();
    try { return await freshIn(label, make, setup); } finally { stats.freshMs += Date.now() - f0; }
  };
  const freshIn = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[] = []): Promise<Set<number>> => {
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
    // What a screen saved (the board's lanes, the desk's layout) would carry one probe's change into the next.
    const dir = process.env.EP0CH_STATE!;
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f), { force: true });
    // A probe's alt+t (theme.cycle) changes every screen's colours: each screen starts in the default theme.
    setTheme(DEFAULT_THEME);
    A().stack.push(new MainMenu());
    const s = await make();
    if (!(s instanceof MainMenu)) app.push(s); else A().stack.splice(0, 1, s);
    A().lastInput = 0;
    await settle();
    // Drawn before each key as the person would see it (a key can depend on the last layout, as the river's
    // ⏎ does), and settled after: a paint asks for what it draws (a reply count, a title).
    for (const k of setup) { snap(new Set()); await settle(); press(k); await settle(); }
    // A second look only when the first asked the service for something (what it draws once that comes).
    for (let i = 0; i < 2; i++) { const n = asked; snap(new Set()); await settle(); if (asked === n) break; }
    // Until it holds still (a terminal's prompt arriving), at most a second. Only a terminal draws by itself
    // (in a tile, or the drawer's): without one, a settle and one more look is enough.
    ptyDrew = false;
    for (let i = 0, was = snap(new Set()); i < 50; i++) { if (ptyDrew || drawer.p || i > 0) await Bun.sleep(5); await settle(); const now = snap(new Set()); if (alike(was, now)) break; was = now; }
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

  const tokens = (runs: ActionRun[]) => new Set(runs.flatMap(r => [...declaredKeys(r.keys)]));
  const named = (k: Key) => (k.kind === "mouse" ? `${k.action === "down" ? "click" : k.action}@${k.x},${k.y}` : keyName(k) ?? "?");
  /** What the declared keys must name for this probe: the key's name, or for the mouse its gesture. */
  const declares = (t: Set<string>, k: Key, prefix?: Key) =>
    k.kind === "mouse" ? t.has(k.action === "wheel-up" || k.action === "wheel-down" ? "wheel" : "click") : t.has(keyName(k)!) || (!!prefix && t.has(`${keyName(prefix)} ${keyName(k)}`));

  /** Clicks over the screen: every row, every 26th column from a start that shifts row by row; and the wheel. */
  const clicks = (): Key[] => {
    const out: Key[] = [];
    // The status bar too (the last row): and its `+N ext` and agent chip, wherever they are drawn.
    for (let y = 0; y < 48; y++) for (let x = 1 + ((y * 7) % 26); x < 160; x += 26) out.push({ kind: "mouse", action: "down", button: 0, x, y });
    for (const at of [A().extAt, A().drawer.chipAt]) if (at) out.push({ kind: "mouse", action: "down", button: 0, x: at.from + 1, y: at.row });
    // The wheel, both ways, over a coarser grid.
    for (let y = 4; y < 47; y += 12) for (let x = 10; x < 160; x += 40) for (const action of ["wheel-down", "wheel-up"] as const) out.push({ kind: "mouse", action, button: 0, x, y });
    return out;
  };
  const push = (k: Key) => {
    press(k);
    if (k.kind === "mouse" && k.action === "down") press({ ...k, action: "up" });
  };

  // Hints: every key the hint row names is declared by an action the screen (or the shell, or the drawer) takes.
  const checkHint = (label: string) => {
    const top = A().stack.at(-1) as Screen | undefined;
    if (!top) return;
    const acts = [...(top.dispatch?.list().actions ?? []), ...SHELL_ACTIONS.list(), ...DRAWER_ACTIONS.list(), ...EXT_ACTIONS.list(), ...NEW_NOTE_ACTIONS.list()];
    const declared = new Set(acts.flatMap(a => [...declaredKeys(a.keys)]));
    // The hint row, and the hint each tile draws in its frame when it has the keys (the desk and its views).
    const tiles: { hint?(): string }[] = [...((top as any).panes?.values?.() ?? [])];
    // A row cut on a narrow screen ("? more", PIE-509) is checked whole, and so is a float's frame hint.
    const row = plain(top.render(app).lines.at(-1) ?? ""), full = (top as any).hintFull as string | null | undefined;
    for (const hint of [full ? plain(full) : row, plain((top as any).floatHint?.() ?? ""), ...tiles.map(t => plain(t.hint?.() ?? ""))])
    for (const k of hintKeys(hint)) if (!declared.has(k) && k !== "click" && k !== "drag" && k !== "wheel") hintFindings.push({ screen: `${label} (${top.title})`, keys: k, problem: `the hint names ${k}, which no action here declares: ${hint.trim().slice(0, 140)}` });
  };

  /**
   * A change with no action, checked once more before it's a finding: the screen built again, the rows that
   * change by themselves in the meantime (a terminal's prompt arriving, a section opening its panel) masked
   * from then on, and the key pressed again. True when it still changes the screen without an action.
   */
  async function bare(label: string, make: () => Screen | Promise<Screen>, setup: Key[], k: Key): Promise<boolean> {
    let mask = await fresh(label, make, setup);
    const a = snap(mask);
    await Bun.sleep(150); await settle();
    const b = snap(mask);
    a.lines.forEach((l, i) => { if (l !== b.lines[i]) mask.add(i); });
    if (a.about !== b.about) mask.add(-1);
    const base = snap(mask);
    const runs: ActionRun[] = [];
    const stop = traceActions(r => runs.push(r));
    try { push(k); await settle(); } finally { stop(); }
    const after = snap(mask);
    return !same(base, after) && !runs.length && !(after.holds && after.top === base.top);
  }

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
    for (const k of [...PROBE_KEYS, ...clicks()]) {
      if (dirty) { mask = await fresh(label, make, setup); dirty = false; last = null; }
      const base = last ?? snap(mask);
      const runs: ActionRun[] = [];
      const stop = traceActions(r => runs.push(r));
      if (process.env.PARITY_TRACE) require("node:fs").appendFileSync(process.env.PARITY_TRACE, `${label} ${named(k)}\n`);
      try { push(k); await settle(); } finally { stop(); }
      const after = snap(mask);
      last = after;
      if (same(base, after) && !runs.length) continue;
      dirty = true;
      if (same(base, after)) continue;          // ran an action that changed nothing (refused): fine
      checkHint(label);
      // A key that leaves the screen holding the keys starts an input state (a prefix, a palette, an edit,
      // a comment, the property panel), whether or not an action opened it: its keys are probed next.
      const opened = after.holds && !base.holds && after.top === base.top && k.kind !== "mouse";
      if (runs.length) {
        if (!declares(tokens(runs), k)) findings.push({ screen: label, keys: named(k), problem: `ran ${runs.map(r => r.name).join(", ")}, whose keys don't name it` });
        if (opened) states.push(k);
        continue;
      }
      if (after.holds && after.top === base.top) { if (k.kind !== "mouse") states.push(k); continue; }
      if (!(await bare(label, make, setup, k))) continue;
      findings.push({ screen: label, keys: named(k), problem: after.top !== base.top || after.depth !== base.depth ? "moved the screen stack without an action" : "changed the screen without an action" });
    }
    if (log) require("node:fs").appendFileSync(log, `# ${label}: input states ${states.map(named).join(" ")}\n`);
    if (process.env.PARITY_DEPTH === "1") return;
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
      for (const k2 of seconds) {
        if (dirty) {
          mask = await fresh(label, make, setup);
          rest = snap(mask);
          press(k1); await settle(); snap(mask); await settle();
          entered = snap(mask); dirty = false;
        }
        const mid = snap(mask);
        const runs: ActionRun[] = [];
        const stop = traceActions(r => runs.push(r));
        try { push(k2); await settle(); } finally { stop(); }
        const after = snap(mask);
        if (same(mid, after)) continue;
        // Typing that keeps the state goes on from where it is (most second keys are text).
        if (!runs.length && after.holds && after.top === mid.top) continue;
        // A cancel (the screen as it was before k1): k1 again enters the state, no rebuild needed.
        if (!runs.length && rest && alike(rest, after)) {
          press(k1); await settle();
          if (!entered || !alike(entered, snap(mask))) dirty = true;
          continue;
        }
        dirty = true;
        // A finding is made only from the state built again: the keys before this one may have moved it on.
        const problem = await second(label, make, setup, k1, k2);
        if (problem) findings.push({ screen: label, keys: `${named(k1)} ${named(k2)}`, problem });
      }
    }
  }

  /** `k1` then `k2` on a fresh screen: what's wrong, or null. */
  async function second(label: string, make: () => Screen | Promise<Screen>, setup: Key[], k1: Key, k2: Key): Promise<string | null> {
    stats.second++;
    const mask = await fresh(label, make, [...setup, k1]);
    const mid = snap(mask);
    const runs: ActionRun[] = [];
    const stop = traceActions(r => runs.push(r));
    try { push(k2); await settle(); } finally { stop(); }
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
    if (!(await bare(label, make, [...setup, k1], k2))) return null;
    return "ended an input state with a change and no action";
  }

  type Scenario = [string, () => Screen | Promise<Screen>, Key[]?];
  const k = (ch: string): Key => ({ kind: "char", ch });
  const TAB: Key = { kind: "tab" };

  // ── every screen the menu opens, as it opens ──
  const SCREENS: Scenario[] = [
    ["main menu", () => new MainMenu()],
    // G logs off; !, E and + run an action, not a screen (+ is note.new, which the probes press as ctrl+n on every screen).
    ...MENU_SCREENS.filter(([key]) => key !== "G" && key !== "!" && key !== "E" && key !== "+").map(([key, make]): Scenario => [key, () => make(app) as Screen]),
    ["message reader", () => new MessageReader(notes, 0)],
    // The home base, opened by name on a door that is on an outline: it shows, and its choices are refused (no home).
    ["home base", () => openScreen("home", { folder: scratch.root })],
    // The same, saying a machine lacks the outline asked for (PIE-545): its offers' rows are pressed and clicked too.
    ["home base, an outline missing", () => openScreen("home", { folder: scratch.root, missing: { outline: "fern", machine: "box-a" } })],
    // The component library (PIE-618), in each of its parts: every key and click there is one of its actions.
    ["library", () => openScreen("library")],
    ["library: one property", () => openScreen("library"), [k("2")]],
    ["library: grids", () => openScreen("library"), [k("3")]],
    ["library: every combination", () => openScreen("library"), [k("4")]],
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
    ["desk: thread", desk, [k("3")]],
    ["desk: activity", desk, [k("4")]],
    ["desk: reader on a note", desk, [k("1"), { kind: "down" }, { kind: "enter" }, k("2")]],
    ["desk: backlinks tile", desk, [k("1"), { kind: "enter" }, CTRL_W, k("o"), k("l"), k("5")]],
    ["desk: who tile", desk, [CTRL_W, k("o"), k("w"), k("5")]],
    ["desk: art tile", desk, [CTRL_W, k("o"), k("b"), k("5")]],
    ["desk: daily", () => new Desk(undefined, { layout: "daily" })],
    ["desk: a terminal", () => new Desk(undefined, { layout: "daily" }), [k("1")]],
    ["drawer: pulled up", () => new MainMenu(), [ALT("a")]],
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
  ];

  const ALL = { screens: [...SCREENS, ...READER], board: [...BOARD, ...RIVER], desk: DESK }[part];
  const only = process.env.PARITY_ONLY?.split(",");
  for (const [label, make, setup] of ALL) {
    if (only && !only.includes(label)) continue;
    test(`${label}: every key and click it handles runs an action that names it`, async () => {
      const before = found.length + hintFound.length, t0 = Date.now();
      await audit(label, make, setup ?? []);
      if (log) require("node:fs").appendFileSync(log, `# ${label}: ${Date.now() - t0} ms (${stats.fresh} builds, ${stats.freshMs} ms building, ${stats.second} second checks)\n`);
      stats.fresh = stats.freshMs = stats.second = 0;
      const mine = [...found, ...hintFound].slice(before).map(f => `${f.screen}\t${f.keys}\t${f.problem}`);
      expect(mine).toEqual([]);
    }, 600_000);
  }
});
}

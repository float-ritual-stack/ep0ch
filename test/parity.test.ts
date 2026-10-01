// PIE-506: agent parity. Every key a screen handles runs an action that declares it, so an agent can do
// the same through `act`; and every key a hint row names is declared by an action the screen takes. Not a
// hand-kept list of keys: each screen is built against a scratch outline and every key is pressed, one at
// a time from where the screen opens (and, from an input state such as a prefix, a picker or an edit, a
// second key), and the actions that ran are traced (`traceActions`). A key that changed what the screen
// shows, or moved the screen stack, without running an action that names it in its `keys`, fails.
// A key that only puts the screen into an input state (`holdsKeys`: a prefix, a palette, an edit) is the
// start of a chord: what the state ends in is checked the same way. Scratch services, fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { declaredKeys, hintKeys, keyName, traceActions, type ActionRun } from "../src/surface/actions";
import { SHELL_ACTIONS, MENU_SCREENS, MainMenu, MessageReader } from "../src/screens";
import { DOCK_ACTIONS } from "../src/dock";
import { SocketBoard } from "../src/socket";
import type { Msg } from "../src/board";
import type { Key } from "../src/term";
import type { Screen } from "../src/app";
import { Desk } from "../src/desk/desk";
import { SEED } from "../src/showcase/seed";
import { external } from "../src/open";
import { outliner, Scratch } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;?]*[A-Za-z]/g, "").replace(/\x1b\][^\x07]*\x07/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");

/** Every key a person can press, but ctrl+c (the door's own quit) and a paste. */
export const PROBE_KEYS: Key[] = [
  ...Array.from({ length: 94 }, (_, i): Key => ({ kind: "char", ch: String.fromCharCode(33 + i) })),
  { kind: "char", ch: " " },
  ..."abdefghijklmnopqrstuvwxyz".split("").map((ch): Key => ({ kind: "char", ch, ctrl: true })),
  { kind: "char", ch: "]", ctrl: true },
  ..."abcdefghijklmnopqrstuvwxyzACDLRX".split("").map((ch): Key => ({ kind: "alt", ch })),
  ...(["up", "down", "left", "right", "alt-enter", "esc", "backspace", "tab", "backtab", "pgup", "pgdn", "home", "end", "delete", "alt-left", "alt-right"] as const).map((kind) => ({ kind }) as Key),
  { kind: "enter" },
];

interface Snap { top: Screen | undefined; depth: number; lines: string[]; about: string; holds: boolean; video: string }
interface Finding { screen: string; keys: string; problem: string }

describe.skipIf(!outliner)("agent parity: every key a screen handles is an action (PIE-506)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App;
  let press: (k: Key) => void = () => {};
  let inflight = 0;
  let notes: Msg[] = [];
  const A = () => app as any;
  const found: Finding[] = [];
  const log = process.env.PARITY_LOG;
  const say = (f: Finding) => { if (log) require("node:fs").appendFileSync(log, `${f.screen}\t${f.keys}\t${f.problem}\n`); };
  const findings = { push(f: Finding) { found.push(f); say(f); } };
  const hintFound: Finding[] = [];
  const hintFindings = { push(f: Finding) { if (!hintFound.some(h => h.screen === f.screen && h.keys === f.keys)) { hintFound.push(f); say(f); } } };

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    mkdirSync(process.env.EP0CH_STATE, { recursive: true, mode: 0o700 });
    process.env.EP0CH_DAILY_AGENT = "sh";
    // ctrl+e hands the note to $EDITOR: one that exits at once, so the probe goes on.
    process.env.VISUAL = process.env.EDITOR = "true";
    external.run = () => {};
    board = new SocketBoard(await scratch.start());
    await board.info();
    await scratch.seedShowcase();
    notes = await board.changedSince(0, 20);
    // Settled means no request to the service is waiting for its answer.
    const request = board.request.bind(board);
    (board as any).request = (action: string, params?: Record<string, unknown>) => {
      inflight++;
      return request(action, params).finally(() => { inflight--; });
    };
    newApp();
    board.subscribe(e => app.event(e));
  }, 60_000);

  /** A door of its own for each screen: nothing one screen's probes left (a drawer, a timer) reaches the next. */
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
    delete process.env.EP0CH_STATE;
    delete process.env.EP0CH_DAILY_AGENT;
  });

  const settle = async () => {
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
    const end = Date.now() + 3000;
    while (inflight > 0 && Date.now() < end) await Bun.sleep(5);
    for (let i = 0; i < 3; i++) await Bun.sleep(0);
  };

  const snap = (mask: Set<number>): Snap => {
    const top = A().stack.at(-1) as Screen | undefined;
    let lines: string[] = [];
    try { lines = top ? top.render(app).lines.map((l, i) => (mask.has(i) ? "" : l)) : []; } catch (e) { lines = [`render threw ${e}`]; }
    let about = "";
    try { about = JSON.stringify(top?.describe?.() ?? null); } catch { about = "?"; }
    return { top, depth: A().stack.length, lines, about: mask.has(-1) ? "" : about, holds: !!top?.holdsKeys?.() || !!top?.rawKeys?.() || app.dockHoldsKeys(), video: app.video };
  };
  /** The same screen shown the same way, on two builds of it (another instance of the same class). */
  const alike = (a: Snap, b: Snap) => a.top?.constructor === b.top?.constructor && a.depth === b.depth && a.video === b.video && a.about === b.about && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);
  const same = (a: Snap, b: Snap) => a.top === b.top && a.depth === b.depth && a.video === b.video && a.about === b.about && a.lines.length === b.lines.length && a.lines.every((l, i) => l === b.lines[i]);

  /** A fresh screen on the stack (over the menu), settled; and the rows that change by themselves (a clock, a meter). */
  /** A screen gone for good: what it started ends too (a desk keeps its programs running otherwise). */
  const end = (s: Screen) => {
    try { if (s.dispose?.() === "keep") for (const p of (s as any).panes?.values?.() ?? []) p.dispose?.(); } catch { /* gone */ }
  };
  const masks = new Map<string, Set<number>>();
  /** A fresh screen on the stack (over the menu), settled; and the rows that change by themselves (a clock, a meter). */
  const fresh = async (label: string, make: () => Screen | Promise<Screen>, setup: Key[] = []): Promise<Set<number>> => {
    for (const s of [...A().stack.splice(0), ...A().background.splice(0)]) end(s);
    (Desk as any).kept = null;
    // The agent drawer is the App's, over every screen: put away, its program ended.
    const dock = A().dock;
    dock.open = false; dock.entered = false; dock.openedBy = null;
    try { dock.p?.dispose?.(); } catch { /* gone */ }
    dock.p = null;
    // What a screen saved (the board's lanes, the desk's layout) would carry one probe's change into the next.
    const dir = process.env.EP0CH_STATE!;
    for (const f of readdirSync(dir)) if (f.endsWith(".json")) rmSync(join(dir, f), { force: true });
    A().stack.push(new MainMenu());
    const s = await make();
    if (!(s instanceof MainMenu)) app.push(s); else A().stack.splice(0, 1, s);
    A().lastInput = 0;
    await settle();
    for (const k of setup) { press(k); await settle(); }
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
  const named = (k: Key) => (k.kind === "mouse" ? `click@${k.x},${k.y}` : keyName(k) ?? "?");
  /** What the declared keys must name for this probe: the key's name, or for the mouse its gesture. */
  const declares = (t: Set<string>, k: Key, prefix?: Key) =>
    k.kind === "mouse" ? t.has("click") : t.has(keyName(k)!) || (!!prefix && t.has(`${keyName(prefix)} ${keyName(k)}`));

  /** Clicks over the screen: every few columns of every other row. */
  const clicks = (): Key[] => {
    const out: Key[] = [];
    for (let y = 0; y < 47; y += 2) for (let x = 1; x < 160; x += 9) out.push({ kind: "mouse", action: "down", button: 0, x, y });
    return out;
  };
  const push = (k: Key) => {
    press(k);
    if (k.kind === "mouse" && k.action === "down") press({ ...k, action: "up" });
  };

  // Hints: every key the hint row names is declared by an action the screen (or the shell, or the dock) takes.
  const checkHint = (label: string) => {
    const top = A().stack.at(-1) as Screen | undefined;
    if (!top) return;
    const acts = [...(top.actions?.().actions ?? []), ...SHELL_ACTIONS.list(), ...DOCK_ACTIONS.list()];
    const declared = new Set(acts.flatMap(a => [...declaredKeys(a.keys)]));
    // The hint row, and the hint each tile draws in its frame when it has the keys (the desk and its views).
    const tiles: { hint?(): string }[] = [...((top as any).panes?.values?.() ?? [])];
    for (const hint of [plain(top.render(app).lines.at(-1) ?? ""), ...tiles.map(t => plain(t.hint?.() ?? ""))])
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
    const states: Key[] = [];
    checkHint(label);
    for (const k of [...PROBE_KEYS, ...clicks()]) {
      if (dirty) { mask = await fresh(label, make, setup); dirty = false; }
      const base = snap(mask);
      const runs: ActionRun[] = [];
      const stop = traceActions(r => runs.push(r));
      if (process.env.PARITY_TRACE) require("node:fs").appendFileSync(process.env.PARITY_TRACE, `${label} ${named(k)}\n`);
      try { push(k); await settle(); } finally { stop(); }
      const after = snap(mask);
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
    for (const k1 of states) {
      dirty = true;
      for (const k2 of PROBE_KEYS) {
        if (dirty) { mask = await fresh(label, make, [...setup, k1]); dirty = false; }
        const mid = snap(mask);
        const runs: ActionRun[] = [];
        const stop = traceActions(r => runs.push(r));
        try { push(k2); await settle(); } finally { stop(); }
        const after = snap(mask);
        if (same(mid, after)) continue;
        dirty = true;                                         // any change: the next key starts from the state again
        if (runs.length) {
          if (!declares(tokens(runs), k2, k1)) findings.push({ screen: label, keys: `${named(k1)} ${named(k2)}`, problem: `ran ${runs.map(r => r.name).join(", ")}, whose keys don't name it` });
          continue;
        }
        if (after.holds && after.top === mid.top) continue;   // still typing, or another input state
        // Cancelled: the screen as it was before the state (built again now, so rows that age match).
        const ended = snap(mask);
        await fresh(label, make, setup);
        if (alike(snap(mask), ended)) continue;
        if (!(await bare(label, make, [...setup, k1], k2))) continue;
        findings.push({ screen: label, keys: `${named(k1)} ${named(k2)}`, problem: "ended an input state with a change and no action" });
      }
    }
  }

  type Scenario = [string, () => Screen | Promise<Screen>, Key[]?];
  const k = (ch: string): Key => ({ kind: "char", ch });
  const TAB: Key = { kind: "tab" };

  // ── every screen the menu opens, as it opens ──
  const SCREENS: Scenario[] = [
    ["main menu", () => new MainMenu()],
    ...MENU_SCREENS.filter(([key]) => key !== "G" && key !== "!").map(([key, make]): Scenario => [key, () => make(app) as Screen]),
    ["message reader", () => new MessageReader(notes, 0)],
  ];

  // ── the board in its other states (the keys and clicks of each area) ──
  const BOARD: Scenario[] = [
    ["board: preview", () => MENU_SCREENS.find(([key]) => key === "K")![1](app) as Screen, [TAB]],
  ];

  // ── the river in its other states ──
  const RIVER: Scenario[] = [];

  // ── the desk and the views built on it, in their other states ──
  const DESK: Scenario[] = [];

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

  const ALL = [...SCREENS, ...BOARD, ...RIVER, ...DESK, ...READER];
  const only = process.env.PARITY_ONLY?.split(",");
  for (const [label, make, setup] of ALL) {
    if (only && !only.includes(label)) continue;
    test(`${label}: every key and click it handles runs an action that names it`, async () => {
      const before = found.length + hintFound.length;
      await audit(label, make, setup ?? []);
      const mine = [...found, ...hintFound].slice(before).map(f => `${f.screen}\t${f.keys}\t${f.problem}`);
      expect(mine).toEqual([]);
    }, 600_000);
  }
});

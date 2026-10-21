// PIE-498: the general drawer. Any tile joins your drawer as a tab and leaves it again into the screen shown,
// whole: a terminal's program keeps running (the same pid), a reader keeps its note. By `act` (tile.drawer, attributed,
// never the person's keys), by ^W a, by a drag onto the drawer's chip or out of the dock, and by a key while dragging.
// It's saved (drawer-tiles.json) and comes back in the next door. Scratch outline host, fictional notes, `cat` programs.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App } from "../src/app";
import { Desk } from "../src/desk/desk";
import { hostSpec } from "../src/drawer";
import { PtyPane } from "../src/desk/pty";
import { outlineState } from "../src/state";
import { SocketBoard } from "../src/socket";
import { traceActions, type ActionRun } from "../src/surface/actions";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[^m]*m/g, "");
const ctrl = (ch: string): Key => ({ kind: "char", ch, ctrl: true });
const char = (ch: string): Key => ({ kind: "char", ch });
const mouse = (action: "down" | "up" | "drag", x: number, y: number): Key => ({ kind: "mouse", action, button: 0, x, y });
const USER = { kind: "user" } as const;
const AS = "drawer-agent-498";

describe.skipIf(!outliner)("the drawer: any tile, moved whole between screens", () => {
  const scratch = new Scratch();
  let board: SocketBoard;
  let state = "";
  const saved: Record<string, string | undefined> = {};
  /** Who hears the outline's events (the board takes one subscriber): the door a test points it at. */
  let listen: ((e: any) => void) | null = null;
  beforeAll(async () => {
    board = new SocketBoard(await scratch.start());
    await board.info();
    board.subscribe(e => listen?.(e));
    await board.request<any>("create", { parentId: null, text: "Seed potatoes: chit them by the window", author: "agent" });
  }, 30_000);
  afterAll(async () => { board?.close(); await scratch.dispose(); });
  beforeEach(() => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT", "EP0CH_DAILY_CWD", "EP0CH_HERDR_BIN", "CLAUDE_CODE_PLUGIN_DIRS"]) saved[k] = process.env[k];
    state = mkdtempSync(join(tmpdir(), "ep0ch-drawertiles-"));
    process.env.EP0CH_STATE = state;
    process.env.EP0CH_DAILY_AGENT = "cat";
    delete process.env.EP0CH_DAILY_CWD;
  });
  // bun:test doesn't run a function beforeEach returns: the environment and the state folder go back here.
  afterEach(() => { for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v; rmSync(state, { recursive: true, force: true }); });

  /** A door on the desk with a terminal tile running `cat` (named `kettle`), on a fake 140x40 terminal. */
  async function door() {
    let key: (k: Key) => void = () => {};
    let painted: string[] = [];
    const term: any = { info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    const app = new App(term, board, Date.now(), () => {});
    const desk = new Desk(undefined, { layout: "desk" });
    app.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
    const paint = () => { (app as any).paint(); return painted.map(plain); };
    paint();
    const kettle = () => desk.pane("kettle") as PtyPane | undefined;
    await until(() => kettle()?.running === true, "kettle runs");
    const inDrawer = (name: string) => app.drawer.tabs().some(t => t.name === name);
    const pane = (name: string) => app.drawer.desk!.pane(name);
    return { app, desk, key: (k: Key) => key(k), paint, kettle, inDrawer, pane, A: app as any };
  }
  /** Another screen (last callers), on top: the screen switch. */
  const otherScreen = () => new Desk({ name: "lastcall", title: "last callers", layout: { focus: "activity", root: { t: "split", dir: "row", weights: [0.5, 0.5], kids: [{ t: "leaf", kind: "activity", name: "activity" }, { t: "leaf", kind: "reader", name: "notes" }] } as any } });

  test("an open from the drawer identifies and accents its screen tile until clicked (PIE-1131)", async () => {
    const d = await door();
    try {
      const note = await board.createBlock(null, "A letter from the potting shed");
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { ask: true } }, USER);
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: "@desk/reader" } }, USER);
      const focus = d.desk.layoutGet().focus;
      await drawer.dispatch.act({ action: "open", args: { id: note.id, from: "kettle" } }, { kind: "agent", id: AS });
      const tile = () => (d.desk.describe().panes as any[]).find(t => t.name === "reader");
      expect(tile().showing.id).toBe(note.id);
      expect(tile().arrival).toMatchObject({ by: AS });
      expect(d.desk.layoutGet().focus).toBe(focus);
      expect(d.paint().join("\n")).toContain("opened in 2 · reader");
      const accentRect = tile().rect;
      expect(d.paint()[accentRect.row]![accentRect.col + 2]).toBe("*");
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { ask: true } }, USER);
      expect(drawer.linkingHint()!.choices!.some(c => c.label.includes("reader") && c.key === "2")).toBe(true);
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { ask: false } }, USER);
      const r = tile().rect;
      d.key(mouse("down", r.col + 4, r.row + 3));
      d.key(mouse("up", r.col + 4, r.row + 3));
      expect(tile().arrival).toBeUndefined();
      let now = 100;
      d.desk.clock = () => now;
      const open = () => drawer.dispatch.act({ action: "open", args: { id: note.id, from: "kettle" } }, { kind: "agent", id: AS });
      await open(); d.paint();
      d.app.push(otherScreen()); now += 20_000;
      d.app.pop(); d.paint();
      expect(tile().arrival).toBeDefined();
      now += 9999; d.desk.tick();
      expect(tile().arrival).toBeDefined();
      now++; d.desk.tick();
      expect(tile().arrival).toBeUndefined();
      await open();
      await d.desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
      expect(tile().arrival).toBeUndefined();
      await drawer.dispatch.act({ action: "tile.link", tile: "kettle", args: { to: "@desk/reader", verb: "select" } }, USER);
      const preview = await board.createBlock(null, "Seed order preview");
      drawer.showFrom(drawer.pane("kettle")!, preview);
      expect(tile().arrival).toMatchObject({ by: "person" });
      expect(tile().showing.id).toBe(preview.id);
      d.key({ kind: "mouse", action: "wheel-down", button: 0, x: r.col + 4, y: r.row + 3 });
      expect(tile().arrival).toBeUndefined();
    } finally { d.app.quit(); }
  });

  test("a loaded screen renames a drawer name clash once and keeps that name (PIE-1131)", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const spec = { name: "lastcall", title: "letters", lands: "kettle", home: "kettle", keys: [{ key: "x", action: "tile.focus", tile: "kettle" }], layout: { focus: "kettle", policy: { opensInto: "letters" }, root: { t: "split" as const, dir: "row" as const, key: "letters", weights: [1, 1], kids: [{ t: "leaf" as const, kind: "reader", name: "kettle" }, { t: "leaf" as const, kind: "reader", name: "other" }] } } };
      const next = new Desk(spec);
      d.app.push(next); d.paint();
      expect(next.layoutGet().tiles[0]!.name).toBe("kettle2");
      expect(d.app.drawer.tabs().some(t => t.name === "kettle")).toBe(true);
      expect(d.paint().join("\n")).toContain("renamed kettle to kettle2");
      const renames = () => d.app.messages.rows.filter(r => r.message.includes("renamed kettle to kettle2"));
      expect(renames()).toHaveLength(1);
      const rev = next.layoutGet().rev;
      next.enter(d.app); d.paint();
      expect(next.layoutGet().rev).toBe(rev);
      expect(renames()).toHaveLength(1);
      expect(next.layoutGet().tiles[0]!.name).toBe("kettle2");
      const saved = next.savedState();
      d.app.pop();
      const restored = new Desk(spec, { saved });
      d.app.push(restored); d.paint();
      const note = await board.createBlock(null, "A letter after reopening");
      await restored.openLanding(note.id, USER);
      expect(restored.layoutGet().tiles.find(t => t.name === "kettle2")!.showing?.id).toBe(note.id);
      await restored.dispatch.act({ action: "tile.focus", tile: "other" }, USER);
      restored.key(char("x"), d.app);
      expect(restored.focusName()).toBe("kettle2");
      const floated = await restored.openPlace(note.id, "float", USER);
      expect(restored.layoutGet().tiles.find(t => t.name === floated.reader)!.arrival).toBeDefined();
      const made = await restored.saveScreen("Letters to keep", USER);
      await d.app.dispatch.act({ action: "screen.open", args: { name: String(made.screen) } }, USER);
      expect((d.app.screens().at(-1) as Desk).pane("kettle2")).toBeDefined();
    } finally { d.app.quit(); }
  });

  test("a group travels through the drawer with tabs, wires and a draft, and note buttons toggle it (PIE-1120)", async () => {
    const d = await door();
    try {
      const note = await board.createBlock(null, 'Carry the seed tray\n::button{label="Drawer" act="host.toggle"}\n::button{label="Bundle" act="tile.collapse tile=bundle"}');
      await d.desk.dispatch.act({ action: "open", args: { id: note.id }, tile: "reader" }, USER);
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "destination", note: note.id }, tile: "tree" }, USER);
      await d.desk.dispatch.act({ action: "tile.group", args: { with: "replies", name: "bundle" }, tile: "reader" }, USER);
      d.paint();
      const group = d.desk.pane("bundle") as any, inner = group.inner as Desk;
      await inner.dispatch.act({ action: "tile.open", args: { kind: "detail", note: note.id, name: "draft", where: "tabs" }, tile: "reader" }, USER);
      await until(() => (inner.pane("draft") as any)?.msg?.id === note.id, "draft tab loaded");
      await inner.dispatch.act({ action: "tile.link", args: { to: "reader" }, tile: "replies" }, USER);
      await inner.dispatch.act({ action: "tile.link", args: { to: "../destination" }, tile: "reader" }, USER);
      await inner.dispatch.act({ action: "edit.text", args: { text: "Seed tray\nKeep this unsaved" }, tile: "draft" }, USER);
      const draft = (inner.pane("draft") as any).surface.draft;
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
      expect(d.inDrawer("bundle")).toBe(true);
      expect(d.pane("bundle")).toBe(group);
      const next = otherScreen(); d.app.push(next); d.paint();
      expect(d.pane("bundle")).toBe(group);
      await d.app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Drawer" } }, USER);
      expect(d.app.drawer.open).toBe(false);
      await d.app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Bundle" } }, USER);
      expect(d.app.drawer.open).toBe(true);
      await d.app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Bundle" } }, USER);
      expect(d.app.drawer.open).toBe(false);
      await d.app.act({ action: "tile.drawer", args: { on: false }, tile: "bundle", as: AS });
      expect(next.pane("bundle")).toBe(group);
      expect(group.inner).toBe(inner);
      expect((inner.pane("draft") as any).surface.draft).toBe(draft);
      expect(draft.text).toContain("Keep this unsaved");
      expect((inner.layoutGet() as any).tiles.find((t: any) => t.name === "replies").wires).toContainEqual({ verb: "open", to: "reader" });
      expect((inner.layoutGet() as any).tiles.filter((t: any) => t.name === "reader" || t.name === "draft").every((t: any) => t.tabs?.includes("reader") && t.tabs?.includes("draft"))).toBe(true);
      await next.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
      d.app.pop(); d.paint();
      await d.app.dispatch.act({ action: "host.toggle", args: { open: false } }, USER);
      await d.app.act({ action: "tile.drawer", args: { on: false }, tile: "bundle", as: AS });
      const second = await board.createBlock(null, "Another seed tray");
      await inner.dispatch.act({ action: "open", args: { id: second.id, from: "reader" } }, USER);
      expect((d.desk.pane("destination") as any).msg?.id).toBe(second.id);
    } finally { d.app.quit(); }
  });

  test("New note in an empty drawer detail opens its draft in that tile (PIE-1119)", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" });
      d.paint();
      await until(() => !!d.app.drawer.desk?.rawKeys(), "the drawer terminal has its keys");
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.open", args: { kind: "detail", name: "writing" } }, USER);
      await drawer.dispatch.act({ action: "tile.focus", tile: "writing" }, USER);
      d.paint();
      d.key(ctrl("n"));
      await until(() => !!(drawer.pane("writing") as any)?.surface?.draft, "the drawer detail has the new draft");
    } finally { d.app.quit(); }
  });

  test("the first b after restarting opens a group saved in a shut drawer (PIE-1120)", async () => {
    const first = await door();
    const note = await board.createBlock(null, "Seed tray instructions");
    try {
      await first.desk.dispatch.act({ action: "tile.group", args: { with: "replies", name: "bundle" }, tile: "reader" }, USER);
      first.paint();
      await first.desk.dispatch.act({ action: "tile.drawer", tile: "bundle" }, USER);
      await first.app.dispatch.act({ action: "host.toggle", args: { open: false } }, USER);
    } finally { first.app.quit(); }
    const next = await door();
    try {
      await next.desk.dispatch.act({ action: "tile.close", tile: "replies" }, USER);
      await next.desk.dispatch.act({ action: "open", args: { id: note.id }, tile: "reader" }, USER);
      await next.desk.dispatch.act({ action: "tile.focus", tile: "reader" }, USER);
      expect(next.app.drawer.tabs().some(t => t.name === "bundle")).toBe(true);
      next.key(char("b"));
      const links = () => (next.pane("bundle") as any)?.inner?.pane("replies");
      await until(() => { next.paint(); return links()?.target?.id === note.id && !!links()?.data; }, "the restored grouped links loaded on the first b");
      expect(next.app.drawer.open).toBe(true);
      expect(next.desk.layoutGet().tiles.some(t => t.kind === "backlinks")).toBe(false);
    } finally { next.app.quit(); }
  });

  test("a click on the agent chip toggles the drawer, alt+click opens the picker, and choices replace the same tab (PIE-1117)", async () => {
    const bin = join(state, "bin");
    mkdirSync(bin);
    for (const name of ["pi", "claude"]) {
      const file = join(bin, name);
      writeFileSync(file, `#!/bin/sh\nprintf 'scratch ${name} started\\n'\nexec cat\n`);
      chmodSync(file, 0o755);
    }
    const shell = join(bin, "login-shell");
    writeFileSync(shell, '#!/bin/sh\nif [ "$2" = "-c" ]; then exec /bin/sh -c "$3"; fi\nexec cat\n');
    chmodSync(shell, 0o755);
    const oldPath = process.env.PATH, oldShell = process.env.SHELL;
    process.env.PATH = `${bin}:${oldPath}`;
    process.env.SHELL = shell;
    const d = await door();
    try {
      for (const name of ["pi", "claude"]) {
        d.paint();
        const chip = d.app.drawer.chipAt!;
        // A plain click only opens or closes the drawer: never the picker (the person's most frequent click).
        const open = d.app.drawer.open;
        d.key(mouse("down", chip.from + 1, chip.row));
        expect(d.app.drawer.open).toBe(!open);
        expect(d.app.drawer.desk?.overlaid() ?? false).toBe(false);
        d.paint();
        const at = d.app.drawer.chipAt!;
        d.key({ kind: "mouse", action: "down", button: 0, x: at.from + 1, y: at.row, mods: 8 });
        expect(d.app.drawer.desk!.overlaid()).toBe(true);
        if (name === "pi") expect(d.paint().some(l => l.includes("EP0CH_DAILY_AGENT overrides"))).toBe(true);
        d.key({ kind: "esc" });
        delete process.env.EP0CH_DAILY_AGENT;
        if (name === "claude") {
          const pid = d.app.drawer.tile!.pid;
          expect(await d.app.dispatch.act({ action: "host.agent", args: { name } }, USER)).toMatchObject({ confirming: true });
          expect(d.app.drawer.tile!.pid).toBe(pid);
          d.paint();
          d.key({ kind: "down" }); d.key({ kind: "enter" });
        } else await d.app.dispatch.act({ action: "host.agent", args: { name, confirm: true } }, USER);
        d.paint();
        await until(() => !!d.app.drawer.tile?.text().some(l => l.includes(`scratch ${name} started`)), "the chosen program actually runs");
        expect(d.app.drawer.tabs().filter(t => t.name === "drawer.agent")).toHaveLength(1);
      }
    } finally { d.app.quit(); process.env.PATH = oldPath; if (oldShell === undefined) delete process.env.SHELL; else process.env.SHELL = oldShell; }
  }, 20_000);

  test("the last drawer tile closes to home, stays closed, and a shell is one key away (PIE-1119)", async () => {
    process.env.EP0CH_DAILY_AGENT = "sh";
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.tile?.running, "own shell runs");
      await d.app.drawer.desk!.dispatch.act({ action: "tile.type", tile: "drawer.agent", args: { text: "exit\\n" } }, USER);
      await until(() => d.app.drawer.tile?.exited === 0, "own shell exits");
      d.key(ctrl("w")); d.key(char("x"));
      expect(d.app.drawer.tabs()).toEqual([]);
      expect(d.paint().some(l => l.includes("[New note]"))).toBe(true);
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      expect(d.app.drawer.tabs()).toEqual([]);
      const restored = new Desk(hostSpec());
      restored.enter(d.app);
      expect(restored.layoutGet().tiles).toEqual([]);
      restored.dispose();
      d.key({ kind: "alt", ch: "s" });
      await until(() => d.app.drawer.tabs().some(t => (d.pane(t.name) as PtyPane).running), "new shell runs from home");
    } finally { d.app.quit(); }
  });

  test("the chip, edge and peek report the shown terminal after the built-in agent closes (PIE-1172)", async () => {
    const d = await door();
    try {
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.close", tile: "drawer.agent" }, USER);
      expect(d.app.describe().drawer.state).toBe("empty");
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const p = d.pane("kettle") as PtyPane;
      for (const state of ["working", "idle", "blocked"] as const) {
        await drawer.dispatch.act({ action: "tile.type", tile: "kettle", args: { text: `\x1b]7501;state=${state}\x07\n` } }, USER);
        await until(() => p.status.urgent()?.state === state, `kettle reports ${state}`);
        const shown = d.paint();
        const word = state === "blocked" ? "needs you" : state;
        expect(d.app.describe().drawer.state).toBe(state);
        expect(d.app.describe().drawer.tile).toMatchObject({ name: "kettle" });
        expect(shown.at(-1)).toContain(`kettle · ${word}`);
        expect(shown[d.app.drawer.rect!.row]).toContain(`kettle · ${word}`);
        expect(shown[d.app.drawer.rect!.row]).toContain("drag this edge");
      }
      await drawer.dispatch.act({ action: "tile.type", tile: "kettle", args: { text: "\x04" } }, USER);
      await until(() => p.exited !== null, "kettle exits");
      await drawer.dispatch.act({ action: "tile.close", tile: "kettle" }, USER);
      expect(d.app.describe().drawer.state).toBe("empty");
      expect(d.paint().at(-1)).toContain("empty");
    } finally { d.app.quit(); }
  });

  test("round 2: choosing an agent still confirms a busy built-in while an idle terminal is shown (PIE-1172)", async () => {
    const program = join(state, "busy");
    writeFileSync(program, "#!/bin/sh\nprintf '\\033]7501;state=working\\007'\nexec cat\n");
    chmodSync(program, 0o755);
    process.env.EP0CH_DAILY_AGENT = program;
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      const own = d.app.drawer.tile!;
      await until(() => own.status.urgent()?.state === "working", "the built-in reports working");
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      await drawer.dispatch.act({ action: "tile.type", tile: "kettle", args: { text: "\x1b]7501;state=idle\x07\n" } }, USER);
      await until(() => d.app.drawer.state() === "idle", "the shown terminal is idle");
      await expect(d.app.act({ action: "host.agent", args: { name: "shell" }, as: AS })).rejects.toThrow("the drawer agent is busy");
      expect(own.running).toBe(true);
    } finally { d.app.quit(); }
  });

  test("round 2: the shown Herdr terminal and built-in session retain independent polls (PIE-1172)", async () => {
    const herdr = join(state, "herdr");
    writeFileSync(herdr, '#!/bin/sh\necho "$*" >> "' + join(state, "polls") + '"\nif [ "$3" = "other" ]; then while [ ! -e "' + join(state, "release") + '" ]; do sleep 0.01; done; fi\nif [ "$1 $2" = "agent get" ]; then\ncase "$3" in\nown) echo \'{"result":{"agent":{"agent_status":"blocked"}}}\';;\n*) echo \'{"result":{"agent":{"agent_status":"idle"}}}\';;\nesac\nfi\n');
    chmodSync(herdr, 0o755);
    process.env.EP0CH_HERDR_BIN = herdr;
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.tile?.running, "the built-in runs");
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tile.herdr", tile: "drawer.agent", args: { pane: "own", name: "own" } }, USER);
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      await drawer.dispatch.act({ action: "tile.herdr", tile: "kettle", args: { pane: "other", name: "other" } }, USER);
      await drawer.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      d.app.drawer.state();
      d.app.drawer.sessions();
      await until(() => existsSync(join(state, "polls")) && readFileSync(join(state, "polls"), "utf8").includes("agent get own"), "the built-in polls while the shown terminal's poll is pending", 1000);
      writeFileSync(join(state, "release"), "");
      await until(() => {
        const shown = d.app.drawer.state();
        const own = d.app.drawer.sessions().find(s => s.shown.in === "drawer" && s.shown.own);
        return shown === "idle" && own?.state === "waiting";
      }, "the chip is idle while the built-in session needs you");
      await drawer.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, USER);
      expect(d.app.drawer.state()).toBe("blocked");
      await drawer.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      expect(d.app.drawer.state()).toBe("idle");
    } finally { writeFileSync(join(state, "release"), ""); d.app.quit(); }
  });

  test("round 2: a moved terminal's stale knowledge never advertises an unavailable restart (PIE-1172)", async () => {
    const mod = join(state, "claude-mod"), manifest = join(mod, ".claude-plugin", "plugin.json");
    mkdirSync(join(mod, ".claude-plugin"), { recursive: true });
    writeFileSync(manifest, '{"name":"garden-mod"}');
    process.env.CLAUDE_CODE_PLUGIN_DIRS = mod;
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.open", tile: "reader", args: { kind: "pty", name: "old-agent", cmd: "env EP0CH_CONTROL=/tmp/fictional-door.sock EP0CH_CLAUDE_MOD_NAME=old-mod cat" } }, USER);
      await until(() => (d.desk.pane("old-agent") as PtyPane)?.running, "the old agent runs");
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "old-agent" }, USER);
      await d.app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "old-agent" }, USER);
      await until(() => { d.app.drawer.chipText(); return d.app.describe().drawer.knows?.state === "stale"; }, "the shown agent's stale environment is read");
      expect(d.app.drawer.chipText()).toContain("started before update");
      expect(d.app.drawer.offersRestart).toBe(false);
      expect(d.app.drawer.chipText()).not.toContain("⟳");
    } finally { d.app.quit(); }
  });

  test("round 2: peek reports knowledge only for the tile that was polled (PIE-1172)", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.tile?.running, "the built-in runs");
      const own = d.app.drawer.tile!;
      await d.app.act({ action: "agent.knows", args: {}, as: AS });
      expect(d.app.describe().drawer.knows?.pid).toBe(own.pid);
      await d.desk.dispatch.act({ action: "tile.drawer", tile: "kettle" }, USER);
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      expect(d.app.describe().drawer.knows).toBeNull();
      await until(() => { d.app.drawer.chipText(); return d.app.describe().drawer.knows?.pid === (d.pane("kettle") as PtyPane).pid; }, "kettle's own knowledge is read");
      await drawer.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, USER);
      expect(d.app.describe().drawer.knows?.pid).toBe(own.pid);
    } finally { d.app.quit(); }
  });

  test("an agent puts a terminal tile by act: moved, not started again; said; the dock and the person's keys stay put", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      const out = await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS }) as any;
      expect(out).toMatchObject({ tile: "kettle", inDrawer: true, from: "desk" });
      expect(d.desk.pane("kettle")).toBeUndefined();
      expect(d.inDrawer("kettle")).toBe(true);
      const p = d.pane("kettle") as PtyPane;
      expect(p.pid).toBe(pid);                                   // the same program: moved, not respawned
      expect(p.running).toBe(true);
      expect(d.app.drawer.open).toBe(false);                       // an agent's drawer doesn't pull it up
      expect(d.desk.focusedName()).toBe("tree");                 // nor move the person's keys
      expect(d.A.message).toContain(`an agent (${AS})`);
      expect(d.paint().at(-1)).toContain("▲ cat (from EP0CH_DAILY_AGENT) +1");          // the chip: its own program, and one more tile
    } finally { d.app.quit(); }
  });

  test("it travels: switch screens, pull the drawer up, it's the same tile; take it into the other screen beside a tile", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      const other = otherScreen();
      d.app.push(other);
      d.paint();
      // Shown on its tab in the drawer, on the other screen.
      d.key({ kind: "alt", ch: "a" });
      expect(d.app.drawer.open).toBe(true);
      await d.app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "kettle" }, USER);
      const shown = d.paint();
      expect(shown.some(l => l.includes("kettle"))).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      // Out of the drawer, into the other screen, right of its notes reader: the person's.
      const out = await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "notes", where: "right" }, tile: "kettle" }, USER) as any;
      expect(out).toMatchObject({ tile: "kettle", inDrawer: false, into: "last callers" });
      expect(d.inDrawer("kettle")).toBe(false);
      const back = other.pane("kettle") as PtyPane;
      expect(back.pid).toBe(pid);
      expect(back.running).toBe(true);
      // And it types: the same program, its screen kept.
      back.input("still here\r");
      await until(() => back.text().some(l => l.includes("still here")), "cat echoes");
    } finally { d.app.quit(); }
  });

  test("keys: ^W a puts the focused tile (the drawer comes up on it); ^W a in the drawer puts it back into the screen", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "replies" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("replies"), "thread in");
      expect(d.app.drawer.open).toBe(true);
      expect(d.app.drawer.tabs().find(t => t.name === "replies")?.shown).toBe(true);
      d.paint();
      // Into the drawer (a click in it), then ^W a there: back beside the tile the person had.
      const r = d.app.drawer.rect!;
      d.key(mouse("down", 20, r.row + 3)); d.key(mouse("up", 20, r.row + 3));
      expect(d.app.drawer.entered).toBe(true);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => !d.inDrawer("replies"), "thread out");
      expect(d.desk.pane("replies")).toBeDefined();
    } finally { d.app.quit(); }
  });

  test("keys for a terminal in the drawer: in the drawer its keys are its program's, so ^W A on the screen brings it back", async () => {
    const d = await door();
    try {
      const pid = d.kettle()!.pid;
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      d.paint();
      // Into the drawer: typing in the kettle (^W is the program's there); ctrl+] back to the desk.
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      expect(d.app.drawer.entered).toBe(true);
      d.key({ kind: "char", ch: "]", ctrl: true });
      expect(d.app.drawer.entered).toBe(false);
      d.key(ctrl("w")); d.key({ kind: "char", ch: "A" });
      await until(() => !d.inDrawer("kettle") && !!d.desk.pane("kettle"), "^W A brings it back");
      expect((d.desk.pane("kettle") as PtyPane).pid).toBe(pid);
    } finally { d.app.quit(); }
  });

  test("a terminal in the drawer that exited closes by ^W x in the drawer (its keys wait, but ^W is the window's again); said on screen", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      d.key({ kind: "alt", ch: "a" }); d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.made?.rawKeys(), "the person types in the kettle");
      // An agent never closes the tab the person types in.
      await expect(d.app.act({ action: "tile.close", args: {}, tile: "kettle", as: AS })).rejects.toThrow(/keys|typing/);
      d.app.drawer.rawInput(d.A.drawerRun)!("\x04");
      await until(() => (d.pane("kettle") as PtyPane).exited !== null, "cat ended");
      expect(d.paint().some(l => l.includes("^W x closes"))).toBe(true);
      // Any other key waits; ^W x closes it at once (nothing runs to ask about), the person still in the drawer.
      d.key(char("x"));
      expect(d.inDrawer("kettle")).toBe(true);
      d.key(ctrl("w")); d.key(char("x"));
      await until(() => !d.inDrawer("kettle"), "^W x closed it");
      expect(d.app.drawer.entered).toBe(true);
      // The own tab now offers the same close as any other terminal.
      expect(d.app.drawer.made!.exitedSay("drawer.agent")).toContain("^W x");
    } finally { d.app.quit(); }
  });

  test("the drawer's tile menu closes a running program after two presses and an exited program at once", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      d.key(ctrl("w")); d.key(char("a"));
      await until(() => d.inDrawer("kettle"), "kettle in");
      const click = () => {
        const lines = d.paint(), row = d.app.drawer.rect!.row + 1;
        const chip = lines[row]!.lastIndexOf("\u2261");
        expect(chip).toBeGreaterThan(0);
        d.key(mouse("down", chip, row)); d.key(mouse("up", chip, row));
        const card = d.paint(), close = card.findIndex(l => l.includes("close"));
        expect(close).toBeGreaterThan(row);
        const col = card[close]!.indexOf("close");
        d.key(mouse("down", col, close)); d.key(mouse("up", col, close));
      };
      click();
      expect(d.inDrawer("kettle")).toBe(true);                   // running: asked first
      click();
      await until(() => !d.inDrawer("kettle"), "the second click closed it");
      // A terminal opened in the drawer (alt+s) that exited: one click.
      d.key({ kind: "alt", ch: "s" });
      await until(() => d.app.drawer.tabs().length === 2, "a shell tab");
      const shell = d.app.drawer.tabs().find(t => t.name !== "drawer.agent")!.name;
      await until(() => (d.pane(shell) as PtyPane).running, "the shell runs");
      await until(() => !!d.app.drawer.made?.rawInput(), "the person types in it");
      d.app.drawer.rawInput(d.A.drawerRun)!("exit\r");
      await until(() => (d.pane(shell) as PtyPane).exited !== null, "the shell exited");
      click();
      await until(() => d.app.drawer.tabs().length === 1, "closed at once");
    } finally { d.app.quit(); }
  });

  test("the mouse: a tile's title dragged onto the drawer's chip puts it (the chip lights up); a tab dragged out lands by the screen's drop zones", async () => {
    const d = await door();
    try {
      const lines = d.paint();
      const head = (d.desk.describe().panes as any[]).find(p => p.name === "activity").rect;
      const chip = d.app.drawer.chipAt!;
      d.key(mouse("down", head.col + 4, head.row));
      d.key(mouse("drag", head.col + 8, head.row + 2));
      d.key(mouse("drag", chip.from + 1, chip.row));
      expect(d.paint().at(-1)).toContain("⤓ activity into your drawer: travels with you");     // the drop zone lights up
      d.key(mouse("up", chip.from + 1, chip.row));
      await until(() => d.inDrawer("activity"), "activity in");
      expect(lines.length).toBeGreaterThan(0);
      // Pulled up (the person's drawer shows it); its tab's title dragged out over the screen's tree: lands there.
      expect(d.app.drawer.open).toBe(true);
      d.paint();
      const r = d.app.drawer.rect!;
      const tabRow = r.row + 1;
      const row = d.paint()[tabRow]!;
      const at = row.indexOf("last callers");
      expect(at).toBeGreaterThan(0);
      d.key(mouse("down", at + 1, tabRow));
      d.key(mouse("drag", at + 4, tabRow));
      const tree = (d.desk.describe().panes as any[]).find(p => p.name === "tree").rect;
      d.key(mouse("drag", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      d.key(mouse("up", tree.col + tree.cols - 3, tree.row + Math.floor(tree.rows / 2)));
      await until(() => !d.inDrawer("activity") && !!d.desk.pane("activity"), "activity back on the desk");
    } finally { d.app.quit(); }
  });

  test("a key while dragging acts on the dragged tile: a puts it in the drawer, f floats it, p puts it in a dock", async () => {
    const d = await door();
    try {
      d.paint();
      const head = (n: string) => (d.desk.describe().panes as any[]).find(p => p.name === n).rect;
      const grab = (n: string) => { const h = head(n); d.key(mouse("down", h.col + 4, h.row)); d.key(mouse("drag", h.col + 9, h.row + 3)); };
      grab("activity"); d.key(char("a"));
      await until(() => d.inDrawer("activity"), "a puts it in");
      d.paint();
      grab("replies"); d.key(char("f"));
      await until(() => (d.desk.layoutGet() as any).floats.some((f: any) => f.tile === "replies"), "f floats");
      d.paint();
      // p on the float: straight into a dock (one step), and ^W f floats it again: float → dock → float.
      await d.desk.dispatch.act({ action: "tile.dock", args: { on: true }, tile: "replies" }, USER);
      expect((d.desk.layoutGet() as any).floats).toEqual([]);
      expect((d.desk.layoutGet() as any).tiles.find((t: any) => t.name === "replies").dock).toBeTruthy();
      await d.desk.dispatch.act({ action: "tile.float", args: {}, tile: "replies" }, USER);
      expect((d.desk.layoutGet() as any).floats.map((f: any) => f.tile)).toEqual(["replies"]);
    } finally { d.app.quit(); }
  });

  // PIE-892: the drawer's own program leaves whole. Its tab holds the place and starts nothing (a second client of a
  // Herdr session was a mirror nobody could type in or close), says where it went, and ⏎ or a click brings it back.
  test("the drawer's own tab leaves onto the screen whole: its tab starts nothing and says where it went; a click brings the same program back, no restart; a running close asks before ending it", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.running === true, "the drawer's own program runs");
      const own = d.app.drawer.tile!, pid = own.pid, name = d.app.drawer.name;
      // ^W x on it: what and why in a person's words, no kind or policy names.
      const why = await d.app.drawer.desk!.dispatch.act({ action: "tile.close", args: {}, tile: "drawer.agent" }, USER).then(() => "", (e: Error) => e.message);
      expect(why).toContain("closing ends it");
      expect(why).not.toMatch(/drawer\.own|closable|draggable/);
      const out = await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER) as any;
      expect(out).toMatchObject({ tile: name, fresh: true, into: "desk" });
      const moved = d.desk.pane(name) as PtyPane;
      expect(moved).toBe(own);
      expect([moved.pid, moved.running, moved.kind]).toEqual([pid, true, "pty"]);   // an ordinary terminal tile on the desk now
      expect(d.app.drawer.open).toBe(false);                     // the person's: the drawer went away with it
      // Its tab stays, starting nothing even when the drawer comes up: it says where the program went.
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await Bun.sleep(300);
      expect(d.app.drawer.tabs()[0]!.name).toBe("drawer.agent");
      expect(d.app.drawer.tile).not.toBe(own);
      expect(d.app.drawer.tile!.running).toBe(false);
      expect(d.app.drawer.tile!.text().join(" ")).toContain(`${name} is on the desk · ⏎ or a click brings it back`);
      // A click on it: the same program back in its own tab, nothing restarted, the desk without it.
      const rows = d.paint(), y = rows.findIndex(l => l.includes("⏎ or a click brings it back")), x = rows[y]!.indexOf("brings it back");
      d.key(mouse("down", x, y)); d.key(mouse("up", x, y));
      await until(() => d.app.drawer.tile === own, "the program back in the drawer");
      expect([own.pid, own.running, own.kind]).toEqual([pid, true, "drawer.own"]);
      expect(d.app.drawer.tabs().map(t => t.name)).toEqual(["drawer.agent"]);
      expect(d.desk.pane(name)).toBeUndefined();
      // And again by act, both ways: out, then tile.drawer from the desk brings it back to its own tab.
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER);
      expect(d.desk.pane(name)).toBe(own);
      // Restarting it while it's out would start a second one: refused, saying where it is.
      await expect(d.app.act({ action: "agent.restart", args: {}, as: AS })).rejects.toThrow("is on the desk");
      await expect(d.app.act({ action: "agent.back", args: {}, as: AS })).rejects.toThrow("person's keys");
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      d.key({ kind: "alt", ch: "a" }); d.paint();
      expect(d.app.drawer.entered).toBe(true);
      const focused = d.desk.focusedName();
      expect(await d.app.act({ action: "agent.back", args: {}, as: AS })).toMatchObject({ tile: "drawer.agent", back: true });
      expect(d.app.drawer.entered).toBe(true);
      expect(d.desk.focusedName()).toBe(focused);
      expect([d.app.drawer.tile, own.pid, own.running]).toEqual([own, pid, true]);
      expect(d.app.drawer.tabs().map(t => t.name)).toEqual(["drawer.agent"]);
      // Its holder isn't a program to take out; and once the program that's out is closed, the tab runs its own again.
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER);
      d.key({ kind: "alt", ch: "a" }); d.paint();
      d.key({ kind: "enter" });
      await until(() => d.app.drawer.tile === own, "Enter brings the program back");
      expect(own.pid).toBe(pid);
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER);
      await expect(d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER)).rejects.toThrow("brings it back");
      await d.desk.dispatch.act({ action: "tile.close", args: {}, tile: name }, USER).catch(() => d.desk.dispatch.act({ action: "tile.close", args: {}, tile: name }, USER));
      await until(() => !d.desk.pane(name), "the program's tile closed");
      // agent.back (what ⏎ and a click on the tab run), as an agent: the program's gone, so the tab runs its own again.
      await d.app.act({ action: "agent.back", args: {}, as: AS });
      d.paint();
      await until(() => d.app.drawer.tile?.running === true, "the drawer's own program again");
      expect(d.app.drawer.tile!.pid).not.toBe(pid);
    } finally { d.app.quit(); }
  });

  test("while the drawer's own program is out, a door started after (a handover) knows it: its own tab starts nothing; that program's tile goes back into its tab (PIE-892)", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => d.app.drawer.tile?.running === true, "the drawer's own program runs");
      const own = d.app.drawer.tile!, key = own.home;
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "drawer.agent" }, USER);
      expect(JSON.parse(readFileSync(join(state, "drawer.json"), "utf8")).out).toBe(key);
      const e = await door();
      try {
        e.key({ kind: "alt", ch: "a" }); e.paint();
        await Bun.sleep(300);
        expect(e.app.drawer.tile!.running).toBe(false);
        expect(e.app.drawer.tile!.text().join(" ")).toContain("is on a screen · ⏎ or a click brings it back");
        // Its program, found on the new door's desk by its key (as a handover adopts it), goes back into the own tab.
        await e.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "agent" } }, USER);
        e.paint();
        const back = e.desk.pane("agent") as PtyPane;
        back.home = key;
        expect(await e.desk.dispatch.act({ action: "tile.drawer", args: {}, tile: "agent" }, USER)).toMatchObject({ tile: "drawer.agent", back: true });
        expect(e.app.drawer.tile).toBe(back);
        expect(back.kind).toBe("drawer.own");
        expect(JSON.parse(readFileSync(join(state, "drawer.json"), "utf8")).out).toBeUndefined();
      } finally { e.app.quit(); }
    } finally { d.app.quit(); }
  });

  test("leaving a screen with a program running carries it into your drawer, said", async () => {
    const d = await door();
    try {
      const other = otherScreen();
      d.app.push(other); d.paint();
      await other.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "shell" }, tile: "notes" }, USER);
      const shell = () => other.pane("shell") as PtyPane | undefined;
      d.paint();
      await until(() => shell()?.running === true, "shell runs");
      const pid = shell()!.pid;
      // A drawer that can't take it (its layout locked): leaving would end it, so it's refused, said.
      await d.app.drawer.desk!.dispatch.act({ action: "layout.lock", args: { on: true } }, USER);
      d.app.pop();
      expect(d.app.screens().at(-1)).toBe(other);
      expect(d.A.message).toContain("shell couldn't go into your drawer");
      await d.app.drawer.desk!.dispatch.act({ action: "layout.lock", args: { on: false } }, USER);
      d.app.pop();                                               // no refusal: last callers goes, its shell comes along
      expect(d.app.screens().at(-1)).toBe(d.desk);
      expect(d.inDrawer("shell")).toBe(true);
      expect((d.pane("shell") as PtyPane).pid).toBe(pid);
      expect((d.pane("shell") as PtyPane).running).toBe(true);
      expect(d.A.message).toContain("shell went into your drawer · alt+a shows it");
      expect(d.app.drawer.open).toBe(false);                     // nobody's keys or view moved
    } finally { d.app.quit(); }
  });

  test("^W P in your drawer: the policy panel opens over the drawer's tab and Esc closes it, the keys still in the drawer", async () => {
    const d = await door();
    try {
      await d.app.act({ action: "tile.drawer", args: {}, tile: "tree", as: AS });
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tab.select", tile: "tree" }, USER);
      expect(d.app.drawer.entered).toBe(true);
      d.key(ctrl("w")); d.key(char("P"));
      const shown = d.paint().join("\n");
      expect(shown).toContain("─ policy ─");
      expect(shown).toContain("draggable · its tiles move out");
      d.key({ kind: "esc" }); d.paint();
      expect(d.paint().join("\n")).not.toContain("─ policy ─");
      expect(d.app.drawer.entered).toBe(true);
    } finally { d.app.quit(); }
  });

  test("refused, with why: an agent never moves the tile the person types in", async () => {
    const d = await door();
    try {
      d.key({ kind: "alt", ch: "a" }); d.paint();
      // The person in kettle: an agent's drawer of it is refused.
      d.key({ kind: "char", ch: "]", ctrl: true });
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.desk.dispatch.act({ action: "tile.enter", tile: "kettle" }, USER);
      await expect(d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS })).rejects.toThrow(/typing|has the person's keys/);
      expect(d.inDrawer("kettle")).toBe(false);
    } finally { d.app.quit(); }
  });

  test("never lost: a screen that goes for good hands a running tile it was given back to the drawer; ids never collide; a kept tile stays", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pid = d.kettle()!.pid;
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      expect(d.app.drawer.tabs().find(t => t.name === "kettle")!.id).toMatch(/^k\d+$/);     // a drawer id, never a screen's t<n>
      const other = otherScreen();
      d.app.push(other); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "notes" }, tile: "kettle" }, USER);
      expect(other.pane("kettle")).toBeDefined();
      d.app.pop();                                               // last callers is left: gone for good
      expect(d.inDrawer("kettle")).toBe(true);
      expect((d.pane("kettle") as PtyPane).pid).toBe(pid);
      expect((d.pane("kettle") as PtyPane).running).toBe(true);
      // The river's Library (closable off: its save needs it) stays, said.
      const river: any = (await import("../src/desk/screen-specs")).openScreen("river");
      d.app.push(river); d.paint();
      await expect(d.app.act({ action: "tile.drawer", args: {}, tile: "library", as: AS })).rejects.toThrow(/library stays/);
    } finally { d.app.quit(); }
  });

  test("the drawer is the door's too: a reader in the drawer hears outline changes, its unsaved edit holds a quit, one name in both is refused", async () => {
    const d = await door();
    listen = e => d.app.event(e);
    try {
      const note = await board.request<any>("create", { parentId: null, text: "Rhubarb: force it under a bucket", author: "agent" });
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "detail", note: note.id, name: "rhubarb" }, tile: "reader" }, USER);
      await until(() => (d.desk.pane("rhubarb") as any)?.msg?.id === note.id, "the detail shows it");
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "rhubarb", as: AS });
      // Changed by someone else while inDrawer: the reader in the drawer reads it again, as a shown one does.
      const b = await board.request<any>("get", { blockId: note.id });
      await board.request("update", { blockId: note.id, text: "Rhubarb: forced, pick in March", expectedRevision: b.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
      await until(() => /pick in March/.test((d.pane("rhubarb") as any)?.msg?.text ?? ""), "the reader in the drawer re-read");
      // The person's unsaved edit in it, inDrawer: quitting asks first, and a forced end copies the text to disk.
      const drawer = d.app.drawer.desk!;
      await drawer.dispatch.act({ action: "edit.text", args: { text: "Rhubarb: forced, pick in March\nunsaved: lift the bucket in April" }, tile: "rhubarb" }, USER);
      expect(drawer.unsaved?.()).toBe(true);
      expect(d.app.confirmQuit()).toBe(false);
      expect(d.A.message).toContain("an edit isn't saved");
      const kept = d.app.terminate();
      expect(kept.length).toBeGreaterThan(0);
      expect(kept.map(p => readFileSync(p, "utf8")).join("\n")).toContain("lift the bucket in April");
    } finally { listen = null; d.app.quit(); }
  });

  test("a moved preview follows the tile it followed, by identity: never another screen's tile of the same name", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "preview", source: "tile:tree", name: "peek" }, tile: "reader" }, USER);
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      const pv = d.desk.pane("peek")!, follows = (desk: any) => desk.followers(desk.idNamed("tree")) as unknown[];
      expect(follows(d.desk)).toContain(pv);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "peek", as: AS });
      // Another desk with a tree of its own: the preview lands there, and that tree never drives it.
      const other = new Desk(undefined, { layout: "desk" });
      d.app.push(other); d.paint();
      expect((other as any).idNamed("tree")).toBeDefined();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "peek" }, USER);
      expect(other.pane("peek")).toBe(pv);
      expect(follows(other)).not.toContain(pv);
      // Back on the desk it came from, beside the tree it followed: it follows that one again.
      await other.dispatch.act({ action: "tile.drawer", args: {}, tile: "peek" }, USER);
      d.app.pop(); d.paint();
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false }, tile: "peek" }, USER);
      expect(d.desk.pane("peek")).toBe(pv);
      expect(follows(d.desk)).toContain(pv);
    } finally { d.app.quit(); }
  });

  test("a preview keeps following its tree into your drawer and back: by the tree's identity, never by its name", async () => {
    const d = await door();
    listen = e => d.app.event(e);
    try {
      const a = await board.request<any>("create", { parentId: null, text: "Leeks: earth them up", author: "agent" });
      const b = await board.request<any>("create", { parentId: null, text: "Garlic: plant the cloves", author: "agent" });
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "preview", source: "tile:tree", name: "peek" }, tile: "reader" }, USER);
      const pv = d.desk.pane("peek") as any, tree = d.desk.pane("tree") as any;
      const pick = (desk: Desk, id: string) => desk.dispatch.act({ action: "tree.pick", args: { id }, tile: "tree" }, USER);
      await until(() => tree.list().some((r: any) => JSON.stringify(r).includes(a.id)), "the tree lists the notes", 2000);
      await pick(d.desk, a.id);
      await until(() => pv.msg?.id === a.id, "the preview shows the tree's pick");
      // The tree goes into your drawer; the preview stays on the desk and still follows it.
      await d.desk.dispatch.act({ action: "tile.focus", tile: "kettle" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "tree", as: AS });
      expect(d.pane("tree")).toBe(tree);
      await pick(d.app.drawer.desk!, b.id);
      await until(() => pv.msg?.id === b.id, "the preview follows the tree in the drawer");
      // A new tree gets a distinct name and never drives the old tree's preview.
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "tree", name: "tree" }, tile: "kettle" }, USER);
      const twin = d.desk.pane("tree2") as any;
      expect(twin).not.toBe(tree);
      await until(() => twin.list().some((r: any) => JSON.stringify(r).includes(a.id)), "the new tree lists the notes");
      await d.desk.dispatch.act({ action: "tree.pick", args: { id: a.id }, tile: "tree2" }, USER);
      await Bun.sleep(50);
      expect(pv.msg?.id).toBe(b.id);
      await d.desk.dispatch.act({ action: "tile.close", tile: "tree2" }, USER);
      // Back out of the drawer: it follows the same tree, here.
      await d.app.drawer.desk!.dispatch.act({ action: "tile.drawer", args: { on: false, to: "kettle" }, tile: "tree" }, USER);
      expect(d.desk.pane("tree")).toBe(tree);
      await pick(d.desk, a.id);
      await until(() => pv.msg?.id === a.id, "the preview follows it back on the desk");
    } finally { listen = null; d.app.quit(); }
  }, 20_000);

  test("a new screen tile gets a unique name, and the drawer tile is reached by name and id", async () => {
    const d = await door();
    try {
      await d.desk.dispatch.act({ action: "tile.focus", tile: "tree" }, USER);
      await d.app.act({ action: "tile.drawer", args: {}, tile: "kettle", as: AS });
      const kid = d.app.drawer.tabs().find(t => t.name === "kettle")!.id;
      await d.desk.dispatch.act({ action: "tile.open", args: { kind: "pty", cmd: "cat", name: "kettle" }, tile: "reader" }, USER);
      expect(d.desk.pane("kettle2")).toBeDefined();
      await d.app.act({ action: "tile.type", args: { text: "by name\r" }, tile: "kettle", as: AS });
      await until(() => (d.pane("kettle") as PtyPane).text().some(l => l.includes("by name")), "typed by its unique name");
      await until(() => (d.pane("kettle") as PtyPane).running, "the kettle in the drawer runs");
      await d.app.act({ action: "tile.type", args: { text: "by id\r" }, tile: kid, as: AS });
      await until(() => (d.pane("kettle") as PtyPane).text().some(l => l.includes("by id")), "typed into the one in the drawer");
    } finally { d.app.quit(); }
  });

  test("the drawer's agent: listed for an agent, chosen by act (saved for this session), the person's picker; alt+g is the agent panel (PIE-737)", async () => {
    const d = await door();
    try {
      const listed = await d.app.act({ action: "host.agent", args: {}, as: AS }) as any;
      expect(listed.agents.map((a: any) => a.name)).toContain("shell");
      await expect(d.app.act({ action: "host.agent", args: { name: "no-such-agent" }, as: AS })).rejects.toThrow(/no agent no-such-agent here; installed: shell/);
      const r = await d.app.act({ action: "host.agent", args: { name: "shell" }, as: AS }) as any;
      expect(r).toMatchObject({ agent: "shell", herdr: false });
      expect(JSON.parse(readFileSync(join(outlineState(), "drawer-agent.json"), "utf8"))).toEqual({ agent: "shell" });
      // EP0CH_DAILY_AGENT (cat, here) still overrides it, and the door says so.
      expect((d.app.describe() as any).drawer.runs.why.program).toContain("EP0CH_DAILY_AGENT");
      // The person's host.agent: the picker, over the drawer.
      d.A.lastInput = 0;
      await d.app.dispatch.act({ action: "host.agent", args: {} }, USER);
      expect(d.app.drawer.open).toBe(true);
      expect(d.paint().some(l => l.includes("the drawer's agent"))).toBe(true);
      d.key({ kind: "esc" });
      // alt+g: the agent panel, a tab in the drawer.
      d.key({ kind: "alt", ch: "g" });
      await until(() => d.app.drawer.tabs().some(t => t.kind === "agents" && t.shown), "the agent panel");
    } finally { d.app.quit(); }
  });

  test("typing in the drawer's terminal: the agent picker takes the keys from it (no byte goes past), alt+g goes to the agent panel, alt+s opens a shell tab", async () => {
    const d = await door();
    try {
      d.A.lastInput = 0;
      d.key({ kind: "alt", ch: "a" }); d.paint();
      await until(() => !!d.app.drawer.tile?.running, "the drawer's own cat runs");
      d.paint();
      await until(() => !!d.app.drawer.made?.rawKeys(), "the person types in it");
      const raw = () => d.app.drawer.rawInput(d.A.drawerRun);
      void d.app.dispatch.act({ action: "host.agent", args: {} }, USER);
      await until(() => d.paint().some(l => l.includes("the drawer's agent")), "the picker");
      expect(d.app.drawer.made!.rawInput()).toBeNull();            // the picker has the keys, not cat
      expect(d.app.drawer.desk!.overlaid()).toBe(true);
      d.key({ kind: "esc" });
      expect(d.app.drawer.made!.rawInput()).not.toBeNull();        // back to cat
      // alt+g, typed in cat: never cat's; the agent panel's tab, the keys with it.
      raw()!("\x1bg");
      await until(() => d.app.drawer.tabs().some(t => t.kind === "agents" && t.shown), "the agent panel");
      expect(d.app.drawer.made!.rawInput()).toBeNull();
      await d.app.drawer.made!.dispatch.act({ action: "tab.select", tile: "drawer.agent" }, USER);
      d.paint();
      await until(() => !!d.app.drawer.made?.rawInput(), "back in cat");
      const tabs = d.app.drawer.tabs().length;
      raw()!("\x1bs");
      await until(() => d.app.drawer.tabs().length === tabs + 1, "a new shell tab");
    } finally { d.app.quit(); }
  });

  test("a session handover: the person's edit in a reader in the drawer is checkpointed and comes back in the next daemon's drawer", async () => {
    const { Checkpoints, readCheckpoint, restore } = await import("../src/session/restore");
    const { MainMenu } = await import("../src/screens");
    const note = await board.request<any>("create", { parentId: null, text: "Leeks: earth them up", author: "agent" });
    const term = (): any => ({ info: { cols: 140, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {}, stop() {}, resume() {} });
    const one = new App(term(), board, Date.now(), () => {});
    one.push(new MainMenu());
    const desk = new Desk(undefined, { layout: "desk" });
    one.push(desk);
    await desk.dispatch.act({ action: "tile.open", args: { kind: "detail", note: note.id, name: "leeks" }, tile: "reader" }, USER);
    await until(() => (desk.pane("leeks") as any)?.msg?.id === note.id, "the detail shows it");
    await desk.dispatch.act({ action: "tile.drawer", args: {}, tile: "leeks" }, USER);
    await one.drawer.desk!.dispatch.act({ action: "edit.text", args: { text: "Leeks: earth them up\nhalfway: the second row next" }, tile: "leeks" }, USER);
    // The handover's order (src/session/daemon.ts): the checkpoint with the edits, then the drafts put aside.
    new Checkpoints(one, () => ({ cols: 140, rows: 40 })).write(true);
    for (const x of one.holders()) x.keepDrafts?.();
    const c = readCheckpoint()!;
    expect(c.reopen.some(s => s.drawer && s.action === "edit" && s.tile === "leeks")).toBe(true);
    one.quit();
    const two = new App(term(), board, Date.now(), () => {});
    try {
      const r = await restore(two, c);
      expect(r.errors).toEqual([]);
      expect(r.reopened).toBe(1);
      const back = two.drawer.desk!.pane("leeks") as any;
      expect(back?.surface.draft).toBeTruthy();
      expect(back.unsaved()).toBe(true);
    } finally { two.quit(); }
  });

  test("saved: the next door's drawer has the tile back (drawer-tiles.json), the dock as it was", async () => {
    const d = await door();
    await d.app.act({ action: "tile.drawer", args: {}, tile: "replies", as: AS });
    d.app.quit();
    const file = join(outlineState(), "drawer-tiles.json");
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("replies");
    const e = await door();
    try {
      e.paint();
      expect(e.inDrawer("replies2")).toBe(true);
      expect(e.desk.pane("replies")).toBeDefined();               // The restored drawer tab gets a distinct name from the screen's own thread.
    } finally { e.app.quit(); }
  });
});

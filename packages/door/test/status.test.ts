// The status bar: its right part (video, uptime, clock) always shows whole, set apart by a separator.
import { describe, expect, test, spyOn } from "bun:test";
import { App, statusLine } from "../src/app";
import { visible, width } from "../src/style";

const plain = visible;
const right = "kitty+crt │ on 0m │ 09:13 ";

describe("status bar", () => {
  test("a location that fills its room exactly doesn't run into the right part", () => {
    const left = " ep0ch │ board │ float-box:/home/sam/garden";
    const cols = width(left) + 3 + width(right);            // exactly enough for left, separator, right
    const line = plain(statusLine(left, "", right, cols));
    expect(line).toBe(`${left} │ ${right}`);
    expect(width(line)).toBe(cols);
  });

  test("a cut-short location ends in … and the separator and right part stay whole", () => {
    const line = plain(statusLine(" ep0ch │ board │ float-box:/home/sam/a-very-long-garden-path", "", right, 50));
    expect(line.endsWith(`… │ ${right}`)).toBe(true);
    expect(width(line)).toBe(50);
  });

  test("the bar's colours come back after a cut", () => {
    const line = statusLine(" ep0ch │ board │ float-box:/home/sam/a-very-long-garden-path", "", right, 50);
    const afterCut = line.slice(line.indexOf("…"));
    expect(afterCut.indexOf("\x1b[0m")).toBeLessThan(afterCut.indexOf(" │ kitty"));
    expect(afterCut.slice(afterCut.indexOf("\x1b[0m") + 4)).toMatch(/^\x1b\[4[0-9;]*m/);   // background set again
  });
});

describe("the status bar keeps time while the door is idle", () => {
  /** A door on a fake clock and a fake terminal that records what's written, row by row, and every render. */
  function idleDoor(start: number) {
    let now = start, renders = 0;
    const rows: { row: number; text: string }[] = [], raw: string[] = [];
    const term = {
      info: { cols: 100, rows: 30, cellW: 9, cellH: 16, kitty: true },
      write: (s: string) => { raw.push(s); },
      paint(lines: string[]) { lines.forEach((l, r) => rows.push({ row: r, text: plain(l) })); },
      paintRow(r: number, l: string) { rows.push({ row: r, text: plain(l) }); },
      invalidate() {}, onKey() {}, onResize() {},
    };
    const app = new App(term as any, {} as any, start, () => {}, () => now);
    const screen = { title: "board", render: () => { renders++; return { lines: ["an edit in progress"] }; }, key() {} };
    app.push(screen as any);
    const tick = () => (app as any).tick();
    return {
      app, rows, raw, tick,
      get renders() { return renders; },
      at(t: number) { now = t; rows.length = 0; raw.length = 0; },
    };
  }
  const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);

  test("when the minute turns, only the status row is repainted, with the new time; the screen isn't rendered again", () => {
    const start = new Date(2026, 8, 28, 9, 28, 30).getTime();
    const d = idleDoor(start);
    try {
      d.at(start + 20_000);                              // 09:28:50: nothing to change
      d.tick();
      expect(d.rows).toEqual([]);
      const renders = d.renders;
      d.at(start + 30_000);                              // 09:29:00: the clock turns over
      d.tick();
      expect(d.rows.map(r => r.row)).toEqual([29]);
      expect(d.rows[0]!.text).toContain(`on 0m │ ${clock(start + 30_000)}`);
      expect(d.renders).toBe(renders);                   // the edit's frame wasn't redrawn
      expect(d.raw.join("")).not.toContain("\x1b_G");   // no Kitty placement touched
      d.tick();                                          // the same minute again: nothing
      expect(d.rows).toHaveLength(1);
    } finally { d.app.quit(); }
  });

  test("the uptime turning over repaints it too, between clock minutes", () => {
    const start = new Date(2026, 8, 28, 9, 28, 30).getTime();
    const d = idleDoor(start);
    try {
      d.at(start + 30_000); d.tick();                    // 09:29:00, on 0m
      d.at(start + 60_000); d.tick();                    // 09:29:30, on 1m
      expect(d.rows.map(r => r.row)).toEqual([29]);
      expect(d.rows[0]!.text).toContain(`on 1m │ ${clock(start + 60_000)}`);
      d.at(start + 35 * 60_000); d.tick();               // left alone for half an hour
      expect(d.rows[0]!.text).toContain(`on 35m │ ${clock(start + 35 * 60_000)}`);
    } finally { d.app.quit(); }
  });
});

// The bar uses the real outline: a live edit changes its drawing and its presses.
import { afterAll, beforeAll } from "bun:test";
import { join } from "node:path";
import { SocketBoard, USER } from "../src/socket";
import { openScreen } from "../src/desk/screen-specs";
import { traceActions } from "../src/surface/actions";
import type { Key } from "../src/term";
import { Scratch, outliner, until } from "./scratch";

describe.skipIf(!outliner)("the person's status bar (PIE-1121)", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [], press: (k: Key) => void;
  const bar = () => { (app as any).paint(); return visible(painted.at(-1)!); };
  const click = (text: string, alt = false) => {
    const x = bar().indexOf(text);
    expect(x).toBeGreaterThanOrEqual(0);
    press({ kind: "mouse", action: "down", button: alt ? 2 : 0, x, y: 39 });
  };
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App({ info: { cols: 220, rows: 40, cellW: 9, cellH: 16, kitty: true }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; }, invalidate() {}, onKey(f: (k: Key) => void) { press = f; }, onResize() {}, stop() {}, resume() {} }, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    await app.loadExtensions();
    app.push(openScreen("desk")!);
  }, 30_000);
  afterAll(async () => { app?.quit(); app?.drawer.tile?.kill(); board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; });

  test("without a config note the current bar and every item's declared gestures agree, including conditional chips", async () => {
    expect(bar()).toContain("ep0ch ^K");
    expect(bar()).toContain("kitty+crt │");
    expect(bar()).toMatch(/on 0m │ \d\d:\d\d /);
    const screen = app.screens().at(-1)!;
    const probes = [
      spyOn(app, "backupAlert").mockReturnValue({ text: "! backup", say: "Scratch backup needs attention" }),
      spyOn(app.whatChanged, "count").mockReturnValue(1),
      spyOn(app.whatChanged, "machineryCount").mockReturnValue(1),
      spyOn(app.heldAsks, "count").mockReturnValue(1),
    ];
    const wasDance = screen.dancing;
    screen.dancing = () => true;
    const force = () => { app.offline = true; app.agentsYolo = true; app.drawer.active = true; app.drawer.knows = { state: "stale" } as any; app.flash(""); bar(); };
    const items = async () => (await app.dispatch.act({ action: "status.bar.items" }, USER) as any).items;
    try {
      // Every conditional chip is present, so hidden defaults cannot silently escape parity.
      (app.t as any).cols = 500;
      force();
      const declared = await items();
      for (const item of declared) {
        expect(visible(item.text).length).toBeGreaterThan(0);
        for (const gesture of ["click", "alt", "lastCell"] as const) {
          if (!item[gesture]) continue;
          force();
          const current = (await items()).find((i: any) => i.id === item.id);
          expect(current.from).toBeDefined();
          const ran: string[] = [];
          const stop = traceActions(a => ran.push(a.name));
          try {
            press({ kind: "mouse", action: "down", button: 0, ...(gesture === "alt" ? { mods: 8 } : {}), x: gesture === "lastCell" ? current.to - 1 : current.from, y: 39 });
            await until(() => ran.includes(item[gesture].action), `${item.id} ${gesture} dispatches ${item[gesture].action}`);
          } finally { stop(); }
          press({ kind: "esc" });
          if (app.recording.active) {
            force();
            click("REC stop");
            await until(() => !app.recording.active, "the recording chip stops recording");
            await until(() => app.messages.rows.some(m => m.message.startsWith("Saved recording-")), "the recording is saved");
          }
          if (app.drawer.open) await app.dispatch.act({ action: "host.toggle" }, USER);
          while (app.screens().length > 1) app.pop();
        }
      }
    } finally {
      probes.forEach(p => p.mockRestore());
      screen.dancing = wasDance;
      app.offline = false; app.agentsYolo = false; app.drawer.knows = null;
      (app.t as any).cols = 220;
    }
  });

  test("eight pins at 80 columns keep whole, clickable items in their own sections", async () => {
    (app.t as any).cols = 80;
    app.drawer.active = true;
    const note = await board.createBlock(null, 'Narrow status [status-bar::true]\n- brand\n- drawer\n- clock');
    try {
      for (let n = 1; n <= 8; n++) await app.dispatch.act({ action: "status.bar.pin", args: { line: `::button{label="Pin ${n}" act="status.log"}` } }, USER);
      app.flash("");
      const line = bar();
      expect(width(line)).toBe(80);
      expect(line).toMatch(/\d\d:\d\d $/);
      const result = await app.dispatch.act({ action: "status.bar.items" }, USER) as any;
      const shown = result.items.filter((i: any) => i.from !== undefined);
      const pins = shown.filter((i: any) => i.id.startsWith("button:"));
      expect(pins.length).toBeGreaterThan(0);
      expect(pins.length).toBeLessThan(8);
      expect(line.indexOf("Pin 1")).toBeLessThan(line.indexOf(visible(result.items.find((i: any) => i.id === "drawer").text)));
      const overflow = shown.find((i: any) => /^\+\d+$/.test(visible(i.text)));
      expect(overflow).toBeDefined();
      expect(Number(visible(overflow.text).slice(1))).toBe(8 - pins.length);
      for (const item of shown) {
        expect(line.slice(item.from, item.to)).toBe(visible(item.text));
        const ran: string[] = [];
        const stop = traceActions(a => ran.push(a.name));
        try {
          press({ kind: "mouse", action: "down", button: 0, x: item.from, y: 39 });
          await until(() => ran.includes(item.click.action) && (!item.id.startsWith("button:") || ran.includes("status.log")), `click ${visible(item.text)}`);
        } finally { stop(); }
        press({ kind: "esc" });
        while (app.screens().length > 1) app.pop();
        if (app.drawer.open) await app.dispatch.act({ action: "host.toggle" }, USER);
        app.flash("");
        bar();
      }
    } finally {
      await board.trash(note.id, USER);
      (app.t as any).cols = 220;
      if (app.drawer.open) await app.dispatch.act({ action: "host.toggle" }, USER);
      while (app.screens().length > 1) app.pop();
    }
  });

  test("duplicate pins are refused and hand-written duplicates keep the first with one logged warning", async () => {
    const note = await board.createBlock(null, 'Duplicate status [status-bar::true]\n::button{label="Go" act="status.log"}');
    try {
      await until(() => bar().includes("Go"), "the first button");
      await expect(app.dispatch.act({ action: "status.bar.pin", args: { line: '::button{label="go" act="theme.cycle"}' } }, USER)).rejects.toThrow(/line 2.*label=/);
      expect((await board.get(note.id))!.text).toBe(note.text);
      await board.update(note.id, note.text + '\n::button{label="GO" act="theme.cycle"}', note.revision!);
      await until(() => app.messages.rows.some(m => /line 3.*duplicate/i.test(m.message)), "the duplicate warning");
      await app.loadExtensions();
      app.flash("");
      expect(bar().match(/Go|GO/g)).toEqual(["Go"]);
      expect(app.messages.rows.filter(m => /line 3.*duplicate/i.test(m.message))).toHaveLength(1);
      const ran: string[] = [];
      const stop = traceActions(a => ran.push(a.name));
      try {
        click("Go");
        await until(() => ran.includes("status.log"), "the first duplicate still presses");
      } finally { stop(); }
    } finally { await board.trash(note.id, USER); }
  });

  test("a live note reorders and hides built-ins, presses a button through button.press, and keeps malformed text", async () => {
    const note = await board.createBlock(null, 'My status [status-bar::true]\n- theme\n::button{label="Video" act="video.cycle" alt="theme.cycle"}\n::button{label="Video theme" act="theme.cycle"}\n- brand');
    await until(() => bar().includes("Video"), "the configured bar");
    app.flash("");
    expect(bar().indexOf("Video")).toBeLessThan(bar().indexOf("ep0ch"));
    expect(bar()).not.toContain("^K");
    const video = app.video;
    click("Video");
    await until(() => app.video !== video, "the button press");
    const before = bar();
    click("Video", true);
    await until(() => bar() !== before, "the alternate action");
    await board.update(note.id, 'My status [status-bar::true]\n- brand\n::button{label="Broken"}', note.revision!);
    await until(() => app.messages.rows.some(m => m.message.includes("::button needs")), "the broken line in the message log");
    expect((await board.get(note.id))!.text).toContain('label="Broken"');
    app.flash("");
    expect(bar()).toContain("^K");
    await board.trash(note.id, USER);
  });
});

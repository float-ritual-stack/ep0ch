// The status bar: its right part (video, uptime, clock) always shows whole, set apart by a separator.
import { describe, expect, test, spyOn } from "bun:test";
import xterm from "@xterm/headless";
import { rowBytes } from "../src/term";
import { App, statusLine } from "../src/app";
import { visible, width } from "../src/style";
import { setTheme, theme } from "../src/theme";

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
import { afterAll, afterEach, beforeAll } from "bun:test";
import { join } from "node:path";
import { readStatusNote, StatusBarNote } from "../src/status-bar";
import { SocketBoard, USER } from "../src/socket";
import { openScreen } from "../src/desk/screen-specs";
import { traceActions } from "../src/surface/actions";
import type { Key } from "../src/term";
import { Scratch, outliner, until } from "./scratch";

describe.skipIf(!outliner)("the person's status bar (PIE-1121)", () => {
  const scratch = new Scratch();
  const savedAgent = process.env.EP0CH_DAILY_AGENT, savedState = process.env.EP0CH_STATE;
  const savedTheme = theme().name;
  const size = { cols: 220, rows: 40, cellW: 9, cellH: 16, kitty: true };
  let board: SocketBoard, app: App, initialVideo: App["video"], painted: string[] = [], press: (k: Key) => void;
  const bar = () => { (app as any).paint(); return visible(painted.at(-1)!); };
  const click = (text: string, alt = false) => {
    const x = bar().indexOf(text);
    expect(x).toBeGreaterThanOrEqual(0);
    press({ kind: "mouse", action: "down", button: alt ? 2 : 0, x, y: 39 });
  };
  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    process.env.EP0CH_DAILY_AGENT = "cat";
    board = new SocketBoard(await scratch.start());
    await board.info();
    app = new App({ info: size, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; }, invalidate() {}, onKey(f: (k: Key) => void) { press = f; }, onResize() {}, stop() {}, resume() {} }, board, Date.now(), () => {});
    initialVideo = app.video;
    board.subscribe(e => app.event(e));
    await app.loadExtensions();
    app.push(openScreen("desk")!);
  }, 30_000);
  afterAll(async () => { app?.quit(); app?.drawer.tile?.kill(); board?.close(); await scratch.dispose(); if (savedState === undefined) delete process.env.EP0CH_STATE; else process.env.EP0CH_STATE = savedState; if (savedAgent === undefined) delete process.env.EP0CH_DAILY_AGENT; else process.env.EP0CH_DAILY_AGENT = savedAgent; });

  afterEach(async () => {
    if (app.drawer.open) await app.dispatch.act({ action: "host.toggle" }, USER);
    await app.drawer.restarting;
    while (app.screens().length > 1) app.pop();
    for (const note of await board.byProp("status-bar", "true")) await board.trash(note.id, USER);
    await app.loadExtensions();
    app.drawer.active = false;
    app.video = initialVideo;
    setTheme(savedTheme);
    size.cols = 220;
    app.flash("");
  });

  test("a message naming a note by a labelled reference says its label, not the raw ((id|label)) (PIE-1439)", () => {
    app.flash("couldn't run it: ((7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34|Seed order)) changed since you read it");
    const line = bar();
    expect(line).toContain("couldn't run it: Seed order changed since you read it");
    expect(line).not.toContain("((");
    // The message log keeps it as said, the reference whole, so it still finds the note.
    expect(app.messages.rows.at(-1)?.message).toContain("((7d9a1f40-3c52-4b8e-a6d1-0e5f2b9c8a34|Seed order))");
  });

  test("a clipped clickable flash leaves the clock outside its hyperlink", async () => {
    const url = "https://example.test/" + "garden/".repeat(30);
    for (const cols of [80, 50]) {
      size.cols = cols;
      app.flash(`copied ${url} · click to open`, 12000, { href: url });
      bar();
      const terminal = new xterm.Terminal({ cols, rows: 1, allowProposedApi: true });
      try {
        await new Promise<void>(done => terminal.write(rowBytes(0, painted.at(-1)!, cols), done));
        const row = terminal.buffer.active.getLine(0)!;
        const text = row.translateToString();
        const clock = text.search(/\d\d:\d\d/);
        expect(clock).toBeGreaterThanOrEqual(0);
        expect(Array.from({ length: cols }, (_, x) => (row.getCell(x) as any).extended.urlId).some(Boolean)).toBe(true);
        for (let x = clock; x < clock + 5; x++) expect((row.getCell(x) as any).extended.urlId).toBe(0);
      } finally { terminal.dispose(); }
    }
  });

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
      spyOn(app.speed, "slow").mockReturnValue("slow: 300 ms to settle"),
      spyOn(app.splits, "chip").mockReturnValue("⚠ fern-sr ×2"),
    ];
    const wasDance = screen.dancing;
    screen.dancing = () => true;
    const force = async () => {
      app.offline = true; app.agentsYolo = true; app.drawer.active = true;
      if (!app.drawer.tile?.running) {
        await app.dispatch.act({ action: "host.toggle" }, USER);
        bar();
      }
      await until(() => !!app.drawer.tile?.running && !app.drawer.restarting, "the built-in agent runs");
      // Force the conditional gesture on its owning pane, keeping the derived drawer getter intact.
      (app.drawer as any).knowledge.set(app.drawer.tile!, { knows: { state: "stale" }, pid: app.drawer.tile!.pid, at: Date.now(), polling: false });
      app.flash(""); bar();
    };
    const items = async () => (await app.dispatch.act({ action: "status.bar.items" }, USER) as any).items;
    try {
      // Every conditional chip is present, so hidden defaults cannot silently escape parity.
      size.cols = 500;
      await force();
      const declared = await items();
      expect(declared.find((i: any) => i.id === "drawer").lastCell.action).toBe("agent.restart");
      for (const item of declared) {
        expect(visible(item.text).length).toBeGreaterThan(0);
        for (const gesture of ["click", "alt", "lastCell"] as const) {
          if (!item[gesture]) continue;
          await force();
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
            await force();
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
      app.offline = false; app.agentsYolo = false;
      await app.drawer.restarting;
      (app.drawer as any).knowledge.delete(app.drawer.tile!);
      size.cols = 220;
    }
  });

  test("a refresh in the completion microtask sees the newly created status note", async () => {
    const reader = new SocketBoard(board.path);
    let created = "", again: Promise<void> | undefined, queued = false, first = true;
    const query = reader.byProp.bind(reader);
    const probe = spyOn(reader, "byProp").mockImplementation(async (...args) => {
      const snapshot = await query(...args);
      if (first) {
        first = false;
        created = (await reader.createBlock(null, "Late status [status-bar::true]")).id;
      }
      return snapshot;
    });
    const status = new StatusBarNote(reader, () => {
      if (!queued) { queued = true; queueMicrotask(() => { again = status.refresh([]); }); }
    }, () => {});
    try {
      await status.refresh([]);
      await again;
      expect(status.note?.id).toBe(created);
    } finally { probe.mockRestore(); reader.close(); }
  });

  test("eight pins at 80 columns keep whole, clickable items in their own sections", async () => {
    size.cols = 80;
    app.drawer.active = true;
    const note = await board.createBlock(null, 'Narrow status [status-bar::true]\n- brand\n- drawer\n- clock');
    try {
      for (let n = 1; n <= 8; n++) await app.dispatch.act({ action: "status.bar.pin", args: { line: `::button{label="Pin ${n}" act="status.log"}` } }, USER);
      app.flash("");
      const line = bar();
      expect(width(line)).toBe(80);
      // The bar draws each pin as the button part does, one row high (PIE-1287).
      // Pins append after `- clock`, so they sit after it, on its side (a button sits where its line is).
      expect(line).toMatch(/\d\d:\d\d │ \[Pin 1\]/);
      const result = await app.dispatch.act({ action: "status.bar.items" }, USER) as any;
      const shown = result.items.filter((i: any) => i.from !== undefined);
      const pins = shown.filter((i: any) => i.id.startsWith("button:"));
      expect(pins.length).toBeGreaterThan(0);
      expect(pins.length).toBeLessThan(8);
      expect(line.indexOf("Pin 1")).toBeGreaterThan(line.indexOf(visible(result.items.find((i: any) => i.id === "drawer").text)));
      const overflow = shown.find((i: any) => /^\+\d+$/.test(visible(i.text)));
      expect(overflow).toBeDefined();
      // The pins outrank the listed brand: it went first, then the last pins.
      expect(line).not.toContain("ep0ch");
      expect(Number(visible(overflow.text).slice(1))).toBe(8 - pins.length + 1);
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
      size.cols = 220;
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

  test("a button commented out in the bar note is no duplicate: pinning its label lands", async () => {
    const note = await board.createBlock(null, 'Commented status [status-bar::true]\n- brand\n<!-- an example:\n- ::button{label="Neat" act="status.log"}\n-->');
    try {
      await until(() => bar().includes("ep0ch"), "the configured bar");
      await app.dispatch.act({ action: "status.bar.pin", args: { line: '::button{label="neat" act="status.log"}' } }, USER);
      await until(() => bar().includes("[neat]"), "the pinned button");
    } finally { await board.trash(note.id, USER); }
  });

  test("a button sits where its line is in the note, set off by the bar's separator on either side", async () => {
    // Evan, Oct 21: his Collapse line came after `- clock` and drew as `float-2 · pieCollapse`, glued to the location on the left.
    const note = await board.createBlock(null, 'Order status [status-bar::true]\n- machine\n::button{label="Fold" act="status.log"}\n- clock\n::button{label="Collapse" act="status.log"}');
    try {
      await until(() => bar().includes("Collapse"), "the configured bar");
      app.flash("");
      const line = bar();
      expect(line).toMatch(/ │ \[Fold\] │ /);
      expect(line).not.toMatch(/[^\s[](Fold|Collapse)/);
      expect(line.trimEnd().endsWith("[Collapse]")).toBe(true);
      expect(line).toMatch(/\d │ \[Collapse\]/);
      const ran: string[] = [];
      const stop = traceActions(a => ran.push(a.name));
      try {
        click("Collapse");
        await until(() => ran.includes("status.log"), "the right-hand button presses");
      } finally { stop(); }
    } finally { await board.trash(note.id, USER); }
  });

  test("a live note reorders and hides built-ins, presses a button through button.press, and keeps malformed text", async () => {
    const note = await board.createBlock(null, 'My status [status-bar::true]\n- theme\n::button{label="Video" act="video.cycle" alt="theme.cycle"}\n::button{label="Video theme" act="theme.cycle"}\n- brand');
    await until(() => bar().includes("Video"), "the configured bar");
    app.flash("");
    // The buttons follow `- theme`, so they sit after it on the right; brand stays on the left.
    expect(bar().indexOf("Video")).toBeGreaterThan(bar().indexOf(theme().name));
    expect(bar().indexOf("ep0ch")).toBeLessThan(bar().indexOf("Video"));
    expect(bar()).not.toContain("^K");
    const video = app.video;
    click("Video");
    await until(() => app.video !== video, "the button press");
    const before = bar();
    click("Video", true);
    await until(() => bar() !== before, "the alternate action");
    let current = note;
    for (const button of ['::button{label="Both"}\nvideo.cycle\ntheme.cycle\n::', '::button{label="Both" act=["video.cycle", "theme.cycle"]}']) {
      current = await board.update(note.id, 'My status [status-bar::true]\n- brand\n' + button, current.revision!);
      await until(() => bar().includes("Both"), "the sequence on the status bar");
      const videoBefore = app.video, themeBefore = theme().name;
      click("Both");
      await until(() => app.video !== videoBefore && theme().name !== themeBefore, "both status steps").catch(async e => { throw new Error(`${e.message}: ${JSON.stringify(await board.request("site.sources", { blockId: note.id }))}`); });
    }
    await board.update(note.id, 'My status [status-bar::true]\n- brand\n::button{label="Broken"}', current.revision!);
    await until(() => app.messages.rows.some(m => m.message.includes("::button needs")), "the broken line in the message log");
    expect((await board.get(note.id))!.text).toContain('label="Broken"');
    app.flash("");
    expect(bar()).not.toContain("^K");
    expect(bar()).toMatch(/! line 3/);
  });

  test("one bad line keeps every other item in its order, a ! item opens the note at that line, and fixing it clears it (PIE-1227)", async () => {
    const note = await board.createBlock(null, 'Typo status [status-bar::true]\n- brand\ndrawer\n::button{label="neat" act="status.log"}\n- theme\n- clock');
    try {
      await until(() => bar().includes("! line 3"), "the warning item");
      app.flash("");
      const line = bar();
      for (const [a, b] of [["ep0ch", "neat"], ["neat", theme().name], [theme().name, ":"]] as const) expect(line.indexOf(a)).toBeLessThan(line.lastIndexOf(b));
      expect(line).not.toContain("^K");
      expect(app.messages.rows.filter(m => /skipped line 3.*did you mean - drawer/.test(m.message))).toHaveLength(1);
      const warning = (await app.dispatch.act({ action: "status.bar.items" }, USER) as any).items.find((i: any) => i.id === "problems");
      expect(warning.click).toMatchObject({ action: "status.bar.edit", args: { line: 3 } });
      const ran: string[] = [];
      const stop = traceActions(a => ran.push(a.name));
      try {
        click("! line 3");
        await until(() => ran.includes("status.bar.edit"), "the ! item opens the note");
      } finally { stop(); }
      while (app.screens().length > 1) app.pop();
      // A long message displaces the location, never the ! item (PIE-1410): still drawn, still a click.
      app.flash("a long message about something that just happened, long enough to push the location off the bar".repeat(2));
      expect(bar()).toContain("! line 3");
      expect(bar()).not.toContain("ep0ch ");
      expect((await app.dispatch.act({ action: "status.bar.items" }, USER) as any).items.find((i: any) => i.id === "problems").from).toBeDefined();
      app.flash("");
      const now = (await board.get(note.id))!;
      await board.update(note.id, now.text.replace("\ndrawer\n", "\n- drawer\n"), now.revision!);
      await until(() => !bar().includes("! line"), "the fixed line clears the warning");
    } finally { await board.trash(note.id, USER); }
  });

  test("a narrow bar shortens and drops built-ins before any pinned button, and its +N lists what it hid by name (PIE-1213)", async () => {
    app.drawer.active = true;
    const note = await board.createBlock(null, 'Pinned status [status-bar::true]\n- brand\n- power\n- screen\n- machine\n::button{label="Collapse" act="status.log"}\n::button{label="yolo" act="status.log"}\n::button{label="neat" act="status.log"}\n- drawer\n- theme\n- video\n- uptime\n- clock');
    try {
      await until(() => bar().includes("neat"), "the pinned bar");
      // Evan's desk is 177 wide; the three pins stay down to 50, the drawer chip shrinking to its arrow first.
      for (const cols of [177, 80, 60, 50]) {
        size.cols = cols;
        app.flash("");
        const line = bar();
        expect(width(line)).toBe(cols);
        for (const pin of ["Collapse", "yolo", "neat"]) expect(line).toContain(`[${pin}]`);
        expect(line).toMatch(/\d\d:\d\d/);
        expect(line).toMatch(/[▲▼]/);
      }
      const menu = await app.dispatch.act({ action: "status.bar.menu", args: { overflow: true } }, { kind: "agent", id: "test" } as any) as any;
      const hidden = menu.rows.map((r: any) => r.label);
      expect(hidden).toContain(theme().name);
      expect(hidden.at(-1)).toBe("edit the status bar");
      expect(bar()).toContain(`+${hidden.length - 1}`);
      app.flash("saved; a message that would push the left side off");
      expect(bar()).toContain(`+${hidden.length - 1}`);
      app.flash("");
      // The person's press opens it over the screen, each item by its name.
      click(`+${hidden.length - 1}`);
      await until(() => painted.some(l => visible(l).includes(theme().name)) && painted.some(l => visible(l).includes("edit the status bar")), "the overflow menu shows the hidden items");
      press({ kind: "esc" });
    } finally { await board.trash(note.id, USER); size.cols = 220; }
  });

  test("a nested list is a group: its label on the bar opens its items as a menu, by click and by act, and a nested button presses (PIE-1224)", async () => {
    const note = await board.createBlock(null, 'Group status [status-bar::true]\n- brand\n- Tools\n  - ::button{label="Video" act="video.cycle"}\n  - theme\n- clock');
    try {
      await until(() => bar().includes("Tools ▲"), "the group on the bar");
      const asked = await app.dispatch.act({ action: "status.bar.menu", args: { group: "Tools" } }, { kind: "agent", id: "test" } as any) as any;
      expect(asked.rows.map((r: any) => [r.label, r.action])).toEqual([["[Video]", "button.press"], [theme().name, "theme.cycle"]]);
      await expect(app.dispatch.act({ action: "status.bar.menu", args: { group: "Tool" } }, USER)).rejects.toThrow(/no group "Tool".*Tools/);
      expect((await app.dispatch.act({ action: "status.bar.menu", args: { group: " tools " } }, { kind: "agent", id: "test" } as any) as any).title).toBe("Tools");
      app.flash("");
      click("Tools");
      await until(() => painted.some(l => visible(l).includes("[Video]")), "the group's menu over the screen");
      const row = painted.findIndex(l => visible(l).includes("[Video]")), col = visible(painted[row]!).indexOf("[Video]");
      const video = app.video;
      press({ kind: "mouse", action: "down", button: 0, x: col, y: row });
      press({ kind: "mouse", action: "up", button: 0, x: col, y: row });
      await until(() => app.video !== video, "the nested button pressed from the menu");
      const again = app.video;
      await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Video" } }, USER);
      await until(() => app.video !== again, "the nested button pressed by act");
    } finally { await board.trash(note.id, USER); }
  });

  test("a group inside a group opens its menu beside its outer group's, which stays open, never at column 1 (PIE-1415, PIE-1428)", async () => {
    // On the right of the bar, so column 1 is far from the click.
    const note = await board.createBlock(null, 'Nested status [status-bar::true]\n- brand\n- clock\n- Tools\n  - theme\n  - More\n    - ::button{label="Video" act="video.cycle"}');
    try {
      for (const cols of [177, 70, 44]) {
        size.cols = cols;
        app.flash("");
        await until(() => bar().includes("Tools ▲"), "the group on the right of the bar");
        const tools = bar().indexOf("Tools");
        click("Tools");
        await until(() => painted.slice(0, -1).some(l => visible(l).includes("More ▲")), "the outer menu");
        const row = painted.findIndex(l => visible(l).includes("More ▲")), col = visible(painted[row]!).indexOf("More ▲");
        press({ kind: "mouse", action: "down", button: 0, x: col, y: row });
        press({ kind: "mouse", action: "up", button: 0, x: col, y: row });
        await until(() => painted.slice(0, -1).some(l => visible(l).includes("[Video]")), "the inner menu");
        const inner = painted.findIndex(l => visible(l).includes("[Video]")), at = visible(painted[inner]!).indexOf("[Video]");
        // Beside the outer menu (to its right, or its left at the bar's right end), which stays open and in sight (PIE-1428),
        // never pulled to the left edge; Esc closes it, then the outer.
        // (At 44 columns two menus don't fit side by side: the inner is drawn over the outer, which is there again after Esc.)
        if (cols >= 70) expect(painted.slice(0, -1).some(l => visible(l).includes("More ▲"))).toBe(true);
        expect(at).toBeGreaterThan(1);
        expect(tools).toBeGreaterThan(cols / 2);
        press({ kind: "esc" });
        await until(() => !painted.slice(0, -1).some(l => visible(l).includes("[Video]")), "the inner menu closed");
        expect(painted.slice(0, -1).some(l => visible(l).includes("More ▲"))).toBe(true);
        press({ kind: "esc" });
        await until(() => !painted.slice(0, -1).some(l => visible(l).includes("More ▲")), "the outer menu closed");
      }
      // A row in the inner menu runs, and both menus close: one choice, as from one menu.
      click("Tools");
      await until(() => painted.slice(0, -1).some(l => visible(l).includes("More ▲")), "the outer menu again");
      const mr = painted.findIndex(l => visible(l).includes("More ▲")), mc = visible(painted[mr]!).indexOf("More ▲");
      press({ kind: "mouse", action: "down", button: 0, x: mc, y: mr }); press({ kind: "mouse", action: "up", button: 0, x: mc, y: mr });
      await until(() => painted.slice(0, -1).some(l => visible(l).includes("[Video]")), "the inner menu again");
      const vr = painted.findIndex(l => visible(l).includes("[Video]")), vc = visible(painted[vr]!).indexOf("[Video]"), video = app.video;
      press({ kind: "mouse", action: "down", button: 0, x: vc, y: vr }); press({ kind: "mouse", action: "up", button: 0, x: vc, y: vr });
      await until(() => app.video !== video, "Video pressed from the inner menu");
      await until(() => !painted.slice(0, -1).some(l => visible(l).includes("More ▲") || visible(l).includes("[Video]")), "both menus closed");
    } finally { await board.trash(note.id, USER); size.cols = 220; }
  });

  test("at 40 columns a message the bar cuts short is said whole just above it while it's up (PIE-1428)", async () => {
    size.cols = 40;
    try {
      const said = "Pipe stopped at step 2 of 3: no note named Seed swap; the step before it ran";
      app.flash(said, 4000, { kind: "warning" });
      await until(() => { app.flush(); return painted.slice(-6, -1).map(l => visible(l).trim()).join(" ").replace(/\s+/g, " ").includes(said); }, "the whole sentence above the bar");
      app.flash("short");
      app.flush();
      expect(painted.slice(-6, -1).map(l => visible(l)).join(" ")).not.toContain("Pipe stopped");
    } finally { size.cols = 220; app.flash(""); }
  });

  test("a message on a full bar leaves no hit box where nothing is drawn: every clickable item is on the bar as drawn (PIE-1410, PIE-1415)", async () => {
    const note = await board.createBlock(null, 'Full status [status-bar::true]\n- brand\n- screen\n- machine\n::button{label="Collapse" act="status.log"}\n::button{label="yolo" act="status.log"}\n::button{label="neat" act="status.log"}\nbogus\n- theme\n- video\n- uptime\n- clock');
    try {
      await until(() => bar().includes("neat") && bar().includes("! line 8"), "the full bar");
      // Every width from 177 down: the one where what the message keeps fills its room exactly was the invisible +N.
      for (let cols = 177; cols >= 36; cols--) {
        size.cols = cols;
        app.flash("a long message about something that just happened, long enough to push the location off the bar".repeat(2));
        const line = bar();
        const items = (await app.dispatch.act({ action: "status.bar.items" }, USER) as any).items.filter((i: any) => i.from !== undefined);
        for (const i of items) expect(line.slice(i.from, i.to)).toBe(visible(i.text));
        // The bar's own +N and ! outlast the message: drawn, or the ! in the +N's menu when the bar has no room for it.
        const hidden = (await app.dispatch.act({ action: "status.bar.menu", args: { overflow: true } }, { kind: "agent", id: "test" } as any) as any).rows.map((r: any) => r.label);
        if (hidden.length > 1) expect(line).toMatch(/\+\d/);
        expect(line.includes("! line 8") || hidden.includes("! line 8")).toBe(true);
      }
    } finally { await board.trash(note.id, USER); size.cols = 220; app.flash(""); }
  });

  test("a failed button's ! stays on that button when a line above it or the button itself goes (PIE-1415)", async () => {
    const note = await board.createBlock(null, 'Marks status [status-bar::true]\n- brand\n- screen\n::button{label="Broken" act="no.such.action"}\n::button{label="Fine" act="status.log"}\n- clock');
    try {
      await until(() => bar().includes("[Fine]"), "the two buttons");
      await app.dispatch.act({ action: "button.press", args: { note: note.id, label: "Broken" } }, USER).catch(() => null);
      const text = (id: string) => bar() && visible((app as any).statusBoxes.find((h: any) => visible(h.item.text).includes(id))?.item.text ?? "");
      await until(() => text("Broken").includes("!"), "the failed mark on Broken");
      expect(text("Fine")).not.toContain("!");
      // A line above it goes: the ! moves with Broken.
      const was = (await board.get(note.id))!;
      await board.update(note.id, was.text.replace("- screen\n", ""), was.revision!);
      await until(() => !(app as any).statusNote.note.text.includes("- screen"), "the line above gone");
      expect(text("Broken")).toContain("!");
      expect(text("Fine")).not.toContain("!");
      const now = (await board.get(note.id))!;
      await board.update(note.id, now.text.replace('::button{label="Broken" act="no.such.action"}\n', ""), now.revision!);
      await until(() => !bar().includes("Broken"), "Broken gone from the bar");
      expect(text("Fine")).not.toContain("!");
    } finally { await board.trash(note.id, USER); }
  });
});


describe("reading the status-bar note: a list, capture first (PIE-1227, PIE-1224)", () => {
  const ids = ["brand", "drawer", "clock", "theme", "machine"];
  test("a bad line is skipped with a did-you-mean and the rest is the bar as written, groups nested", () => {
    const text = ['Bar [status-bar::true]', '- brand', 'drawer', '- drawr', '- ::button{label="neat" act="layout.neat"}', '- Tools', '  - theme', '  - ::button{label="Fold" act="status.log"}', '  - More', '    - machine', '- clock', '::button{label="Broken"}', '<!-- - nothing', 'here -->'].join("\n");
    const { entries, problems } = readStatusNote(text, ids);
    const shape = (e: any): unknown => e.kind === "group" ? { group: e.label, of: e.children.map(shape) } : e.kind === "builtin" ? e.id : `[${e.call.label}]`;
    expect(entries.map(shape)).toEqual(["brand", "[neat]", { group: "Tools", of: ["theme", "[Fold]", { group: "More", of: ["machine"] }] }, "clock"]);
    expect(problems.map(p => p.line + 1)).toEqual([3, 4, 12]);
    expect(problems[0]!.message).toContain("did you mean - drawer?");
    expect(problems[1]!.message).toContain("did you mean - drawer?");
    expect(problems[2]!.message).toContain("::button needs");
  });

  test("an unclosed comment hides only its own line, a built-in listed twice keeps its first place, numbered items read as items", () => {
    const { entries, problems } = readStatusNote(['Bar', '<!-- todo', '1. brand', '2. ::button{label="Go" act="status.log"}', '- brand', '- clock'].join("\n"), ids);
    expect(entries.map((e: any) => e.kind === "builtin" ? e.id : e.call.label)).toEqual(["brand", "Go", "clock"]);
    expect(problems.map(p => [p.line + 1, p.message.split(":")[0]])).toEqual([[2, "this <!-- comment never closes"], [5, "- brand is already on line 3; a built-in sits in one place"]]);
  });
});

describe("the status bar says when the door settles slowly (PIE-1309)", () => {
  /** A door on a fake clock whose screen takes `paintMs` to draw: the time from a key to the frame that shows it. */
  function door(paintMs: () => number) {
    let now = new Date(2026, 9, 25, 9, 0, 0).getTime();
    const term = { info: { cols: 120, rows: 30, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, paintRow() {}, invalidate() {}, onKey() {}, onResize() {} };
    const app = new App(term as any, {} as any, now, () => {}, () => now);
    const screen = { title: "board", render: () => { now += paintMs(); return { lines: ["a screen"] }; }, key() { app.redraw(); } };
    app.push(screen as any);
    const bar = () => plain((app as any).statusBar(screen, 120));
    /** One burst: a key, the frame it draws (slow: the bar is read while it draws, as the real one is), and a pause. */
    const burst = async (every = 5000) => { now += every; (app as any).key({ kind: "char", ch: "x" }); await Bun.sleep(30); bar(); };
    return { app, bar, burst, wait: (ms: number) => { now += ms; } };
  }

  test("a slow minute puts the number in the bar; a brief slowdown says nothing; a quiet minute takes it away", async () => {
    let slow = 150;
    const d = door(() => slow);
    for (let i = 0; i < 8; i++) await d.burst();
    expect(d.app.speed.describe().settle).toMatchObject({ n: 8, p95: 150, worst: 150 });
    expect(d.bar()).not.toContain("slow:");                         // slow for 40 s so far
    for (let i = 0; i < 14; i++) await d.burst();
    expect(d.bar()).toContain("slow: 150 ms to settle");
    // The chip is a click on status.speed, which says it and gives the numbers (the same object as `peek speed`).
    const said = await d.app.dispatch.act({ action: "status.speed" }, { kind: "agent", id: "test" }) as ReturnType<typeof d.app.speed.describe>;
    expect(said.settle).toMatchObject({ p95: 150, worst: 150 });
    expect((d.app as any).message).toContain("150 ms (p95)");
    // Fast again: the minute's p95 comes down once the slow ones age out of it.
    slow = 5;
    for (let i = 0; i < 24; i++) await d.burst();
    expect(d.bar()).not.toContain("slow:");
    expect(d.app.speed.describe().settle.worst).toBe(150);
  });
});

// PIE-981: the showcase's "Pressable views" section. A render script draws a noughts-and-crosses board whose free squares
// each carry an action; a click, ⏎ on the element and `act` run the move script as the person, and the board is drawn
// again. Edit and rich edit keep the board drawn under its line, read-only. One of the showcase's test files.
import { beforeAll, describe, expect, test } from "bun:test";
import { extensionList } from "../../src/extensions";
import { C, fg } from "../../src/style";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { placeOf } from "../../src/session/place";
import { useOutlineState } from "../../src/state";
import { messageLogPath } from "../../src/status-log";
import { Dispatcher } from "../../src/surface/dispatch";
import { actionSet, def, traceActions } from "../../src/surface/actions";
import { startControl } from "../../src/control";
import { Mirror } from "../../src/mirror";
import { Conferences } from "../../src/screens";
import { openScreen } from "../../src/desk/screen-specs";
import { ReaderPane } from "../../src/desk/panes";
import { Desk } from "../../src/desk/desk";
import { USER } from "../../src/socket";
import { outliner, until } from "../scratch";
import { useShowcaseScreen } from "./harness";

/** `until` for an answer that takes a request. */
const untilAsync = async (ok: () => Promise<boolean>, what: string, ms = 10_000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(50); }
};

describe.skipIf(!outliner)("the showcase screen: pressable views", () => {
  const h = useShowcaseScreen();
  const { screen, press, ch } = h;
  let board!: typeof h.board, app!: typeof h.app, seeded!: typeof h.seeded;
  beforeAll(() => { ({ board, app, seeded } = h); });
  const boardOf = async () => (await board.get(seeded.notes.press.id))!.text.match(/\[board::([.xo]+)\]/)![1]!;
  /** Where a square's number is drawn on the screen, by its text row and column. */
  const find = (square: string) => {
    const rows = screen().split("\n");
    for (let y = 0; y < rows.length; y++) { const m = rows[y]!.match(new RegExp(`\\[${square}\\]`)); if (m) return { x: m.index! + 1, y }; }
    return null;
  };
  /** The square, once the board is drawn again (a move briefly leaves the line unread until the service answers). */
  const at = async (square: string) => { await until(() => !!find(square), `square ${square} drawn`, 15_000); return find(square)!; };

  const click = (x: number, y: number) => { press({ kind: "mouse", action: "down", button: 0, x, y }); press({ kind: "mouse", action: "up", button: 0, x, y }); };
  const status = () => (app as any).armedNow?.a?.say as string | undefined;
  const squarePresses = async () => {
    const { elements } = await app.dispatch.act({ action: "elements", tile: "notes" }, USER) as { elements: { kind: string; label: string }[] };
    return elements.filter(e => e.kind === "control" && /^\[[1-9]\]$/.test(e.label));
  };

  test("a launch button clicks through the door to the desk's layout action", async () => {
    const note = seeded.notes.press;
    const desk = new Desk();
    app.push(desk);
    try {
      await app.dispatch.act({ action: "open", args: { id: note.id } }, USER);
      const drawn = () => desk.render(app).lines.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "")).join("\n");
      await until(() => drawn().includes("[Desk]"), "launch button drawn");
      const lines = drawn().split("\n"), y = lines.findIndex(l => l.includes("[Desk]"));
      click(lines[y]!.indexOf("[Desk]") + 2, y);
      await Bun.sleep(100);
      expect(desk.layoutGet().layout).toBe("daily");
    } finally { app.pop(); desk.dispose(); }
  });

  test("status messages survive their flash and can be searched and opened from the status line", async () => {
    await app.dispatch.act({ action: "section", args: { name: "message-log" } }, USER);
    await until(() => screen().includes("garden gate needs attention"), "the message log showcase");
    try {
      const text = "The watering schedule needs attention. " + "Keep the entire message. ".repeat(25) + "END OF MESSAGE";
      app.flash(text);
      click(1, app.t.rows - 1);
      await Bun.sleep(50);
      const read = await app.dispatch.act({ action: "list.read" }, USER) as { rows: { title: string }[] };
      expect(read.rows.some(r => r.title === text)).toBe(true);
      await app.dispatch.act({ action: "status.filter", args: { text: "watering schedule" } }, USER);
      const filtered = await app.dispatch.act({ action: "list.read" }, USER) as { rows: { title: string }[] };
      expect(filtered.rows.map(r => r.title)).toEqual([text]);
      const view = app.screens().at(-1)!;
      expect(view.render(app).lines.join("\n")).toContain("END OF MESSAGE");
      app.flash("Tall message\n" + "Keep reading the garden log.\n".repeat(120) + "END OF TALL MESSAGE");
      press({ kind: "char", ch: "r" });
      await app.dispatch.act({ action: "status.filter", args: { text: "Tall message" } }, USER);
      expect(view.render(app).lines.join("\n")).not.toContain("END OF TALL MESSAGE");
      let end = false;
      for (let i = 0; i < 4 && !end; i++) { press({ kind: "pgdn" }); end = view.render(app).lines.join("\n").includes("END OF TALL MESSAGE"); }
      expect(end).toBe(true);
    } finally { if (app.screens().at(-1)?.title === "message log") app.pop(); }
  });

  test("launch buttons run by click and enter from the desk, drawer and Welcome", async () => {
    const note = await board.createBlock(null, 'Launch pad [welcome::1115]\n::button{label="Desk" act="layout.load name=daily"}\n::button{label="Waiting on me" act="host.waiting"}\n::button{label="Board" act="screen.open name=board"}');
    const base = app.screens().length;
    const paint = () => { (app as any).paint(); return h.painted.map(l => l.replace(/\x1b\[[\d;]*[A-Za-z]/g, "")).join("\n"); };
    for (const place of ["desk", "drawer", "welcome"]) for (const gesture of ["click", "enter"]) for (const label of ["Desk", "Waiting on me", "Board"]) {
      const d = place === "welcome" ? openScreen("welcome") as Desk : new Desk({ name: "launch", title: "launch", layouts: true, layout: { focus: "launch", root: { t: "split", dir: "row", ratio: 0.7, a: { t: "leaf", kind: "reader", name: "launch", mode: "held", note: note.id }, b: { t: "leaf", kind: "tree", name: "tree" } } } });
      app.push(d);
      let tile = place === "welcome" ? "detail" : "launch";
      try {
        if (place === "welcome") {
          await until(() => paint().includes("Launch pad"), "the Welcome notes listed");
          await app.dispatch.act({ action: "welcome.read", args: { id: note.id } }, USER);
        }
        if (place === "drawer") {
          await app.dispatch.act({ action: "tile.drawer", tile }, USER);
          await app.dispatch.act({ action: "host.toggle", args: { open: true } }, USER);
          await app.drawer.desk!.dispatch.act({ action: "tab.select", tile }, USER);
          await app.dispatch.act({ action: "host.enter" }, USER);
          tile = app.drawer.desk!.layoutGet().tiles.find(t => t.name === "launch")!.id!;
        } else {
          await d.dispatch.act({ action: "tile.focus", tile }, USER);
          press({ kind: "enter" });
        }
        await until(() => paint().includes(`[${label}]`), `${place} ${gesture}: ${label} drawn`);
        if (gesture === "click") {
          const lines = paint().split("\n"), y = lines.findIndex(l => l.includes(`[${label}]`));
          click(lines[y]!.indexOf(`[${label}]`) + 2, y);
        } else {
          const elements = await app.dispatch.act({ action: "elements", tile }, USER) as { elements: { n: number; label: string }[] };
          const n = elements.elements.find(e => e.label.includes(label))!.n;
          await app.dispatch.act({ action: "element.select", tile, args: { n } }, USER);
          press({ kind: "enter" });
        }
        await until(() => label === "Desk" ? (app.screens().at(-1) as Desk).layoutGet().layout === "daily" : label === "Board" ? app.screens().at(-1)?.name === "board" : app.drawer.tabs().some(t => t.name === "waiting-you"), `${place} ${gesture}: ${label} ran`);
        expect(app.messages.rows.some(r => r.message.includes("undefined is not an object"))).toBe(false);
        if (place === "drawer" && gesture === "enter" && label === "Waiting on me") {
          press({ kind: "alt", ch: "M" });
          expect(app.screens().at(-1)?.title).toBe("message log");
          expect(app.drawer.shown).toBe(false);
          press({ kind: "char", ch: "/" });
          press({ kind: "paste", text: "waiting" });
          press({ kind: "enter" });
          const list = await app.dispatch.act({ action: "list.read" }, USER) as { rows: { title: string }[] };
          expect(list.rows.some(r => r.title.includes("undefined is not an object"))).toBe(false);
          press({ kind: "char", ch: "q" });
          expect(app.screens().at(-1) === d).toBe(true);
        }
      } finally {
        if (app.drawer.entered) await app.dispatch.act({ action: "host.leave", args: { quiet: true } }, USER);
        if (place === "drawer" && app.drawer.desk?.pane("launch")) await app.drawer.desk.dispatch.act({ action: "tile.close", tile: "launch" }, USER);
        if (app.drawer.desk?.pane("waiting-you")) await app.drawer.desk.dispatch.act({ action: "tile.close", tile: "waiting-you" }, USER);
        await app.dispatch.act({ action: "host.toggle", args: { open: false } }, USER);
        while (app.screens().length > base) { const top = app.screens().at(-1); app.pop(); top?.dispose?.(); }
      }
    }
  }, 90_000);

  test("a refused button gives a suggestion and its logged row returns to the source note", async () => {
    const note = await board.createBlock(null, 'Typo launch\n::button{label="Typo" act="layout.loda name=daily"}');
    const away = await board.createBlock(null, "Another place\nRead this while the log keeps the warning.");
    const d = new Desk({ name: "typo", title: "typo", layout: { focus: "reader", root: { t: "leaf", kind: "reader", name: "reader", mode: "held", note: note.id } } });
    app.push(d);
    try {
      await until(() => d.render(app).lines.join("\n").includes("[Typo]"), "the typo button");
      await app.dispatch.press("button.press", { label: "Typo" }, "reader");
      const warning = app.messages.rows.findLast(r => r.kind === "refusal")!;
      expect(warning.message).toContain("nothing here answers to layout.loda");
      expect(warning.message).toContain("did you mean layout.load");
      expect(warning).toMatchObject({ note: note.id, action: "layout.loda name=daily" });
      await app.dispatch.act({ action: "open", tile: "reader", args: { id: away.id } }, USER);
      press({ kind: "alt", ch: "M" });
      await app.dispatch.act({ action: "status.filter", args: { text: "nothing here answers to layout.loda" } }, USER);
      press({ kind: "enter" });
      await until(() => d.layoutGet().tiles.some(t => t.showing?.id === note.id), "the logged source note opened again");
    } finally { while (app.screens().at(-1) !== d) app.pop(); app.pop(); d.dispose(); }
  });

  test("log rows stay numbered across new messages, return as their actor, and stay open when refused", async () => {
    const d = new Desk({ name: "log-return", title: "log-return", layout: { focus: "reader", root: { t: "leaf", kind: "reader", name: "reader" } } });
    const note = await board.createBlock(null, "The greenhouse door\nOil its hinges.");
    app.push(d);
    const returned: string[] = [];
    const off = traceActions(r => { if (r.name === "open") returned.push(r.actor.kind); });
    try {
      app.flash("Greenhouse warning", 4000, { note: note.id });
      await app.dispatch.press("status.log");
      const read = await app.dispatch.act({ action: "list.read" }, USER) as { rows: { n: number; title: string }[] };
      const row = read.rows.find(r => r.title === "Greenhouse warning")!;
      app.flash("A later status must not move the numbered row");
      (app as any).lastInput = 0;
      await app.act({ action: "list.open", args: { n: row.n }, as: "log-reader" });
      await until(() => d.layoutGet().tiles.some(t => t.showing?.id === note.id), "the agent's returned note");
      expect(returned).toEqual(["agent"]);
      app.flash("A closed tile's message", 4000, { tile: "closed-greenhouse" });
      await app.dispatch.press("status.log");
      const log = app.screens().at(-1)!;
      await app.dispatch.press("list.open", { n: 1 });
      expect(app.screens().at(-1) === log).toBe(true);
      const kept = await app.dispatch.act({ action: "list.read" }, USER) as { selected: number; rows: { title: string }[] };
      expect(kept.rows[kept.selected - 1]!.title).toBe("A closed tile's message");
    } finally { off(); while (app.screens().at(-1) !== d) app.pop(); app.pop(); d.dispose(); }
  });

  test("the session log keeps errors with stacks in its rotated file, and CLI and peek read the log", async () => {
    const dir = placeOf({ outline: "scratch", socket: h.scratch.sock }).dir;
    useOutlineState(dir);
    const errorActions = actionSet<{}>()("broken", { "broken.press": def({ summary: "exercise a failing press", keys: "enter", touches: "nothing", replay: "ask", args: {}, run() { throw new TypeError("broken fixture action"); } }) });
    const dispatch = Dispatcher.of(errorActions, {}, () => app);
    const errorScreen = { title: "broken fixture", dispatch, key() { void dispatch.press("broken.press"); }, render: () => ({ lines: ["Press enter"] }) };
    app.push(errorScreen);
    const ctl = await startControl({ app, mirror: new Mirror(200, 60), info: () => app.t }, join(h.scratch.root, "door", "log.sock"));
    const env = { ...process.env, EP0CH_CONTROL: ctl.path, EP0CH_SOCKET: h.scratch.sock, EP0CH_WS: "scratch", EP0CH_MACHINE: "" };
    const cli = (args: string[]) => Bun.spawn([process.execPath, resolve(import.meta.dir, "../../src/main.ts"), ...args], { env, stdout: "pipe", stderr: "pipe" });
    try {
      press({ kind: "enter" });
      await until(() => app.messages.rows.at(-1)?.kind === "error", "the error logged");
      expect(app.messages.rows.at(-1)).toMatchObject({ action: "broken.press", message: "could not run broken.press; status.log has the details" });
      expect(JSON.stringify(app.describe())).not.toContain("broken fixture action");
      expect(readFileSync(messageLogPath(dir), "utf8")).toContain("TypeError: broken fixture action");
      for (let i = 0; i < 505; i++) app.flash(`Message ${i}: ${"garden ".repeat(320)}`);
      expect(app.messages.rows).toHaveLength(500);
      expect(app.messages.rows[0]!.message).toStartWith("Message 5:");
      expect(existsSync(messageLogPath(dir) + ".1")).toBe(true);
      const printed = cli(["log", "--ws", "scratch"]);
      const output = await new Response(printed.stdout).text();
      expect(await printed.exited, await new Response(printed.stderr).text()).toBe(0);
      expect(output).toContain("TypeError: broken fixture action");
      expect(output.includes("Message 504:")).toBe(true);
      const peek = cli(["peek"]);
      const peeked = await new Response(peek.stdout).text();
      expect(await peek.exited, await new Response(peek.stderr).text()).toBe(0);
      expect(peeked.includes("Message 504:")).toBe(true);
      expect(peeked).not.toContain("TypeError: broken fixture action");
      const follow = cli(["log", "--follow", "--ws", "scratch"]);
      const reader = follow.stdout.getReader();
      try {
        await reader.read();
        app.flash("The last watering can");
        let tail = "";
        await Promise.race([(async () => { while (!tail.includes("The last watering can")) { const r = await reader.read(); if (r.done) break; tail += new TextDecoder().decode(r.value); } })(), Bun.sleep(5000)]);
        expect(tail.includes("The last watering can")).toBe(true);
      } finally { follow.kill(); await follow.exited; reader.releaseLock(); }
    } finally { ctl.close(); app.pop(); useOutlineState(null); }
  }, 30_000);

  test("a click on a square runs the move at once, as the person; ⏎ on the element, act and an agent's act run the same line; the board is drawn again", async () => {
    (app as any).lastInput = 0;
    await app.act({ action: "section", args: { name: "press" }, as: "test-agent" });
    screen();
    await untilAsync(async () => /\[1\]\s+\[2\]\s+\[3\]/.test(screen()), "the board drawn with its squares", 15_000);
    await until(() => !!extensionList()?.extensions.find(e => e.name === "ttt-move"), "the move script loaded");
    expect(await boardOf()).toBe(".........");
    // By mouse: one click on square 5 is the consent; no question is asked.
    const five = await at("5");
    click(five.x, five.y);
    expect(status()).toBeUndefined();
    await untilAsync(async () => (await boardOf()) === "o...x....", "x on 5 and the reply o on 1");
    // A second click, on square 9 (the keys path, [ ] and ⏎ through element.open, is in the parity tests).
    const nine = await at("9");
    click(nine.x, nine.y);
    await untilAsync(async () => (await boardOf()).charAt(8) === "x", "x on 9");
    // An agent's act of the same action: attributed, with no one to ask (element.open in the person's own reader is refused).
    await untilAsync(async () => (await board.get(seeded.notes.press.id))!.text.includes("[board::oo"), "the reply o on 2");
    const extension = extensionList()!.extensions.find(e => e.name === "ttt-move")!;
    await app.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "3" }, as: "test-agent" });
    await untilAsync(async () => (await boardOf()).charAt(2) === "x", "x on 3 by an agent's act");
    // And by the action itself, as the person would run it, with the slot it carries.
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "7" } }, USER);
    await untilAsync(async () => (await boardOf()).charAt(6) === "x", "x on 7 by act");
    await until(() => screen().includes("x wins"), "the winning board");
    await until(() => (app as any).message.includes("x wins"), "the winning answer");
    expect((app as any).message).toBe("x on 7 · x wins · ctrl+z undoes");
    expect(await squarePresses()).toEqual([]);
  }, 90_000);

  test("a ::button runs a script with its slots, and the prose link is the same press", async () => {
    await until(() => screen().includes("[New game]"), "the button drawn", 15_000);
    const rows = screen().split("\n"), y = rows.findIndex(r => r.includes("[New game]"));
    click(rows[y]!.indexOf("[New game]") + 1, y);
    await untilAsync(async () => (await boardOf()) === ".........", "a new game");
    // The board can read empty before the reset's answer replaces the previous move's line: wait for the answer itself.
    await until(() => (app as any).message === "New game · ctrl+z undoes", "the reset answer");
    expect((app as any).statusBar(h.sc, 200)).toContain(fg(C.lcyan) + "New game · ctrl+z undoes");
    // The inline form: [start over](act: ttt-reset) after a move.
    const extension = extensionList()!.extensions.find(e => e.name === "ttt-move")!;
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "3" } }, USER);
    await untilAsync(async () => (await boardOf()) !== ".........", "a move");
    const proseRow = () => screen().split("\n").findIndex(r => r.includes("In prose it is a link"));
    await until(() => proseRow() >= 0 && !screen().split("\n")[proseRow()]!.includes("(act:"), "the inline press drawn as its words", 15_000);
    const rows2 = screen().split("\n"), y2 = proseRow();
    click(rows2[y2]!.indexOf("start over") + 2, y2);
    await untilAsync(async () => (await boardOf()) === ".........", "a new game by the inline press");
    // An agent presses it by its words, in the reader the person holds, with no element numbers to look up (button.press).
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "6" } }, USER);
    await untilAsync(async () => (await boardOf()) !== ".........", "a move before the agent's press");
    const pressed = await app.act({ action: "button.press", args: { label: "New game" }, as: "test-agent" }) as { ok?: boolean; result?: { act?: string } };
    expect(JSON.stringify(pressed)).toContain("ttt-reset");
    await untilAsync(async () => (await boardOf()) === ".........", "a new game by an agent's button.press");
    // By note=, for a note open nowhere: the door reads its text, and nothing takes the person's focus; tile= names another reader.
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "2" } }, USER);
    await untilAsync(async () => (await boardOf()) !== ".........", "a move before the note= press");
    const focusBefore = ((await app.act({ action: "layout.get", as: "test-agent" })) as { focus: string }).focus;
    const byNote = JSON.stringify(await app.act({ action: "button.press", args: { note: seeded.notes.press.id, label: "New game" }, as: "test-agent" }));
    expect(byNote).toContain("ttt-reset");
    await untilAsync(async () => (await boardOf()) === ".........", "a new game by button.press note=");
    expect(((await app.act({ action: "layout.get", as: "test-agent" })) as { focus: string }).focus).toBe(focusBefore);
    const noNote = await app.act({ action: "button.press", args: { note: seeded.notes.press.id, label: "nothing like it" }, as: "test-agent" }).then(() => "", (e: Error) => e.message);
    expect(noNote).toContain("no button says");
    await app.dispatch.act({ action: `ext.${extension.id}.run`, args: { block: seeded.notes.press.id, at: "3" } }, USER);
    await untilAsync(async () => (await boardOf()) !== ".........", "a move before the tile= press");
    await app.act({ action: "button.press", args: { label: "New game" }, tile: "notes", as: "test-agent" });
    await untilAsync(async () => (await boardOf()) === ".........", "a new game by button.press tile=");
    expect(((await app.act({ action: "layout.get", as: "test-agent" })) as { focus: string }).focus).toBe(focusBefore);
    const refused = await app.act({ action: "button.press", args: { label: "no such button" }, as: "test-agent" }).then(() => "", (e: Error) => e.message);
    expect(refused).toContain("no button says");
    expect(refused).toContain('Example: button.press label="');
    for (const name of ["ttt-move", "ttt-reset"]) {
      const script = (await board.queryNotes(`script=${name}`, 1)).notes[0]!;
      expect(await board.children(script.id)).toEqual([]);
    }
  }, 60_000);

  test("a game ends on o's row or a draw; Enter plays a square and New game restores the presses", async () => {
    for (const [moves, ending] of [[[5, 9, 4], "o wins"], [[2, 4, 5, 7, 9], "draw"]] as const) {
      await until(() => screen().includes("[New game]"), "New game drawn");
      const rows = screen().split("\n"), y = rows.findLastIndex(row => row.includes("[New game]"));
      click(rows[y]!.indexOf("[New game]") + 1, y);
      await untilAsync(async () => (await boardOf()) === ".........", "the empty board");
      for (const [index, square] of moves.entries()) {
        const atSquare = await at(String(square));
        if (ending === "draw" && index === 0) {
          const { elements } = await app.dispatch.act({ action: "elements", tile: "notes" }, USER) as { elements: { n: number; label: string }[] };
          const element = elements.find(e => e.label === `[${square}]`)!;
          await app.dispatch.act({ action: "element.select", tile: "notes", args: { n: element.n } }, USER);
          press({ kind: "enter" });
        } else click(atSquare.x, atSquare.y);
        await untilAsync(async () => (await boardOf())[square - 1] === "x", `x on ${square}`);
      }
      await until(() => screen().split("\n").some(row => new RegExp(`[║│]\\s+${ending}\\s+[║│]`).test(row)), ending);
      await until(() => (app as any).message.includes(ending), "the final answer");
      expect(app.refusal()).toBeNull();
      expect(await squarePresses()).toEqual([]);
    }
    const move = extensionList()!.extensions.find(e => e.name === "ttt-move")!;
    await app.dispatch.act({ action: `ext.${move.id}.run`, args: { block: seeded.notes.press.id, at: "1" } }, USER);
    await until(() => (app as any).message.includes("press New game to play again"), "a finished game's refusal");
    expect((app as any).statusBar(h.sc, 200)).toContain(fg(C.yellow) + (app as any).message);
    await app.act({ action: `ext.${move.id}.run`, args: { block: seeded.notes.press.id, at: "1" }, as: "test-agent" });
    await until(() => (app as any).message.startsWith("an agent (test-agent)") && (app as any).message.includes("press New game to play again"), "the agent's attributed refusal");
    expect(app.refusal()).toBeNull();
    await app.dispatch.act({ action: "button.press", args: { label: "New game" }, tile: "notes" }, USER);
    await at("1");
  }, 60_000);

  test("edit and rich edit keep the board drawn under its line, read-only, while the lines around it are edited", async () => {
    (app as any).lastInput = 0;
    screen();
    await until(() => /\[\d\]/.test(screen()), "the board drawn", 15_000);
    const played = await boardOf();
    press({ kind: "enter" });
    ch("e");
    press({ kind: "enter" });
    await until(() => /editing/.test(screen()), "the note in an edit", 5000);
    // The line is raw source now, and its last drawing is still under it; its controls are not (nothing in an edit presses).
    const pane = () => screen().split("\n").filter(l => l.includes("║")).map(l => l.split("║")[1]!.trim());
    const under = () => { const i = pane().findIndex(l => l === "ttt-board::"); return i < 0 ? [] : pane().slice(i + 1, i + 5); };
    await until(() => /\[[\dxo]\]/.test(under().join("\n")), "the board under its line in the edit");
    expect(screen()).not.toContain("[r run again]");
    // Typing around it leaves it: a new line above it moves its line down, and the drawing goes with it.
    await app.dispatch.act({ action: "draft.place", args: { line: 1, col: 1 } }, USER);
    press({ kind: "enter" });
    for (const c of "A new first line") ch(c);
    expect(pane().indexOf("ttt-board::")).toBeGreaterThan(3);
    expect(under().join("\n")).toMatch(/\[[\dxo]\]/);
    // Rich edit keeps it too.
    await app.dispatch.act({ action: "rich.toggle", args: { on: true } }, USER);
    expect(screen()).toContain("[+row]");
    await until(() => /\[[\dxo]\]/.test(under().join("\n")), "the board under its line in rich edit");
    await app.dispatch.act({ action: "rich.toggle", args: { on: false } }, USER);
    press({ kind: "esc" }); press({ kind: "esc" });
    await untilAsync(async () => !(/editing/.test(screen())), "the edit closed");
    // Looking and typing in a draft that was let go wrote nothing: the board is as the last move left it.
    expect(await boardOf()).toBe(played);
  }, 60_000);
  test("an asynchronous screen read keeps its error stack in the session file", async () => {
    await h.scratch.stop();
    app.push(new Conferences());
    try {
      await Bun.sleep(100);
      const latest = app.messages.rows.at(-1)!;
      expect(latest.kind).toBe("error");
      const records = readFileSync(messageLogPath(), "utf8").trimEnd().split("\n").map(line => JSON.parse(line));
      expect(records.at(-1).stack).toContain(latest.message);
      expect(JSON.stringify(app.describe().messages).includes('"stack":')).toBe(false);
    } finally { app.pop(); }
  });

});

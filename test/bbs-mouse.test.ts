// PIE-452: the main menu and the BBS lists work by mouse. A click on a menu slot, or on a key in the key
// line (T Today and X Showcase have no slot in the art), does what its key does; a drag with the button
// down moves the lit item with the pointer; the wheel is ↑ ↓. On a list a click selects a row, a click on
// the selected row opens it (⏎, as the board's cards open), and the wheel moves the selection. The hint
// lines' keys are clickable. Fictional messages; no service: the screens get a stand-in context.
import { describe, expect, test } from "bun:test";
import type { Ctx, Screen } from "../src/app";
import type { Msg } from "../src/board";
import { Brief } from "../src/brief/brief";
import { members, packs } from "../src/packs";
import { ArtViewer, Conferences, FileAreas, Help, LastCallers, Logon, MainMenu, MessageList, MessageReader, Stats, WhoOnline } from "../src/screens";
import { Showcase } from "../src/showcase/showcase";
import type { Activity } from "../src/socket";
import type { Key } from "../src/term";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const tick = () => new Promise(r => setTimeout(r, 0));

const msg = (n: number, title: string, author = "rook"): Msg => ({
  id: `0000000${n}-aaaa-4bbb-8ccc-dddddddddddd`, text: title, parentId: null, childIds: [], createdAt: n * 1000, updatedAt: n * 1000, author, props: {},
});
const MSGS = [msg(1, "Seed swap on Saturday"), msg(2, "The compost bays need turning", "wren"), msg(3, "Kettle rota for the allotment shed")];

/** A stand-in for the door: a screen stack that doesn't start what it pushes, and a board of fictional notes. */
function door(cols = 120, rows = 40) {
  const stack: Screen[] = [];
  const ctx = {
    t: { cols, rows, cellW: 9, cellH: 16, kitty: false }, graphics: false, video: "cells", events: 0, lastCall: 0, host: "node", workspace: "garden",
    board: {
      changedSince: async () => MSGS, children: async () => [MSGS[2]!], roots: async () => MSGS.slice(0, 2),
      activity: async (): Promise<Activity[]> => MSGS.map((m, i) => ({ cursor: i, block: m, author: "user", actor: m.author!, kind: "edit", at: m.updatedAt })),
      callers: async () => [], clientId: "me",
    },
    push(s: Screen) { stack.push(s); }, pop() { stack.pop(); }, replace(s: Screen) { stack.pop(); stack.push(s); },
    redraw() {}, flash() {}, quit() {}, cycleVideo() {},
  } as unknown as Ctx;
  return { ctx, stack };
}

/** A screen on top of the stand-in door, and the mouse and text over it. */
function on(s: Screen, d = door()) {
  d.stack.push(s);
  const top = () => d.stack.at(-1)!;
  const lines = () => top().render(d.ctx).lines.map(plain);
  const at = (text: string, from = 0) => {
    const ls = lines();
    for (let y = from; y < ls.length; y++) { const x = ls[y]!.indexOf(text); if (x >= 0) return { x, y }; }
    throw new Error(`"${text}" isn't drawn:\n${ls.join("\n")}`);
  };
  const mouse = (action: "down" | "up" | "drag" | "wheel-up" | "wheel-down", x: number, y: number) => { lines(); top().key({ kind: "mouse", action, button: 0, x, y }, d.ctx); };
  const click = (text: string, from = 0) => { const p = at(text, from); mouse("down", p.x, p.y); mouse("up", p.x, p.y); };
  const key = (k: Key) => top().key(k, d.ctx);
  return { ...d, top, lines, at, mouse, click, key };
}

const selected = (m: MainMenu) => (m.describe() as { selected: string }).selected;

// The menu, the file areas and the art viewer draw the WOE packs (EP0CH_PACKS); without them there is no art.
const art = packs().length > 1;

describe.skipIf(!art)("the main menu by mouse", () => {
  test("a click on a slot opens its item, as its key does", () => {
    const s = on(new MainMenu());
    s.click("Newscan");
    expect(s.top()).toBeInstanceOf(MessageList);
    expect(s.top().title).toBe("new scan");
    s.stack.pop();
    s.click("Join");
    expect(s.top()).toBeInstanceOf(Conferences);
  });

  test("T Today and X Showcase, which have no slot in the art, are clickable on the key line", () => {
    const s = on(new MainMenu());
    const drawn = s.lines().slice(0, 23).join("\n");
    expect(drawn).not.toContain("Today");            // the art keeps its twelve slots
    s.click("T Today");
    expect(s.top()).toBeInstanceOf(Brief);
    s.stack.pop();
    s.click("X Showcase");
    expect(s.top()).toBeInstanceOf(Showcase);
  });

  test("the other keys on the key line are clickable too", () => {
    const s = on(new MainMenu());
    const p = s.at("(NJKRWLFSQBDG)");
    const x = p.x + 1 + "NJKRWLFSQBDG".indexOf("S");
    s.mouse("down", x, p.y); s.mouse("up", x, p.y);
    expect(s.top()).toBeInstanceOf(Stats);
  });

  test("a press lights the item; dragging over the menu moves the light with the pointer; the release opens what it's on", () => {
    const m = new MainMenu(), s = on(m);
    const a = s.at("Newscan"), b = s.at("Stats"), c = s.at("Files");
    s.mouse("down", a.x, a.y);
    expect(selected(m)).toBe("N");
    expect(s.stack.length).toBe(1);
    s.mouse("drag", b.x + 2, b.y);
    expect(selected(m)).toBe("S");
    expect(s.lines().at(-2)).toContain(": Stats");
    s.mouse("drag", c.x, c.y);
    expect(selected(m)).toBe("F");
    s.mouse("up", c.x, c.y);
    expect(s.top()).toBeInstanceOf(FileAreas);
  });

  test("released off the item, nothing opens; a release with no press here is ignored", () => {
    const m = new MainMenu(), s = on(m);
    const a = s.at("Newscan");
    s.mouse("down", a.x, a.y);
    s.mouse("up", 2, 30);
    s.mouse("up", a.x, a.y);
    expect(s.stack.length).toBe(1);
    expect(selected(m)).toBe("N");
  });

  test("the wheel moves the light as ↑ ↓ do, into the key line's items too", () => {
    const m = new MainMenu(), s = on(m);
    s.mouse("wheel-down", 0, 0);
    expect(selected(m)).toBe("J");
    s.mouse("wheel-up", 0, 0); s.mouse("wheel-up", 0, 0);
    expect(selected(m)).toBe("T");
    expect(s.lines().at(-2)).toContain(": Today");
    expect(s.stack.length).toBe(1);
  });

  test("a slot a short pane cuts off isn't a place to click", () => {
    const s = on(new MainMenu(), door(120, 12));
    // Rows 0-10 of the art are drawn: the first slot row (10) is, the second (11: Join) isn't.
    s.mouse("down", 64, 11); s.mouse("up", 64, 11);
    expect(s.stack.length).toBe(1);
    s.mouse("down", 64, 10); s.mouse("up", 64, 10);
    expect(s.top()).toBeInstanceOf(MessageList);
  });

  test("keys are unchanged: letters open, arrows move, ⏎ opens the lit item", () => {
    const m = new MainMenu(), s = on(m);
    s.key({ kind: "right" });
    expect(selected(m)).toBe("W");
    s.key({ kind: "enter" });
    expect(s.top()).toBeInstanceOf(WhoOnline);
    s.stack.pop();
    s.key({ kind: "char", ch: "l" });
    expect(s.top()).toBeInstanceOf(LastCallers);
  });
});

describe("the message list by mouse", () => {
  const list = async () => {
    const s = on(new MessageList("recent", async () => MSGS, "", false));
    s.top().enter!(s.ctx);
    await tick();
    return s;
  };

  test("a click selects a row; a click on the selected row reads it", async () => {
    const s = await list();
    s.click("The compost bays");
    expect(s.stack.length).toBe(1);
    expect(s.lines().find(l => l.includes("The compost bays"))).toBeDefined();
    s.click("The compost bays");
    const r = s.top();
    expect(r).toBeInstanceOf(MessageReader);
    expect((r as any).index).toBe(1);
  });

  test("a press on one row and a release on another opens nothing", async () => {
    const s = await list();
    const a = s.at("Seed swap"), b = s.at("Kettle rota");
    s.mouse("down", a.x, a.y); s.mouse("up", b.x, b.y);
    expect(s.stack.length).toBe(1);
  });

  test("the wheel moves the selection; ⏎ then reads where it went", async () => {
    const s = await list();
    s.mouse("wheel-down", 5, 10); s.mouse("wheel-down", 5, 10); s.mouse("wheel-down", 5, 10);
    s.key({ kind: "enter" });
    expect((s.top() as any).index).toBe(2);   // clamped at the last row
  });

  test("the hint's keys are clickable: T thread, Q back", async () => {
    const s = await list();
    s.click("T thread");
    expect(s.top()).toBeInstanceOf(MessageList);
    expect(s.top().title).toStartWith("thread:");
    s.stack.pop();
    s.click("Q back");
    expect(s.stack.length).toBe(0);
  });
});

describe("the other BBS lists by mouse", () => {
  test("conferences: a click selects, a second joins", async () => {
    const s = on(new Conferences());
    s.top().enter!(s.ctx);
    await tick();
    s.click("The compost bays");
    expect(s.stack.length).toBe(1);
    s.click("The compost bays");
    expect(s.top()).toBeInstanceOf(MessageList);
    expect(s.top().title).toBe("The compost bays need turning");
  });

  test("last callers: a click selects, a second reads; the wheel moves the selection", async () => {
    const s = on(new LastCallers());
    s.top().enter!(s.ctx);
    await tick();
    s.click("Kettle rota");
    s.click("Kettle rota");
    expect((s.top() as any).index).toBe(2);
    s.stack.pop();
    s.mouse("wheel-up", 5, 8);
    s.key({ kind: "enter" });
    expect((s.top() as any).index).toBe(1);
  });

  test.skipIf(!art)("file areas: a click selects a pack, a click on it (or the description under it) browses it", () => {
    const s = on(new FileAreas());
    const name = packs()[1]!.split("/").at(-1)!.toUpperCase();
    s.click(name);
    expect(s.stack.length).toBe(1);
    expect(s.lines().findIndex(l => l.includes(name))).toBe(s.at(name).y);
    const y = s.at(name).y;
    const below = s.lines()[y + 1]!.trim() ? y + 1 : y;       // a description line, when the pack has one
    s.mouse("down", 30, below); s.mouse("up", 30, below);
    expect(s.top()).toBeInstanceOf(ArtViewer);
  });
});

describe("the BBS screens with keys and no mouse, until now", () => {
  const viewer = () => new ArtViewer(members(packs()[0]!).filter(m => /\.(ans|asc)$/i.test(m.path)));

  test.skipIf(!art)("the art viewer (and the Bulletin): the wheel scrolls, the hint's keys are clickable", () => {
    const v = viewer(), s = on(v);
    v.key({ kind: "enter" }, s.ctx);                  // the whole piece, not the modem reveal
    const title = v.title;
    s.mouse("wheel-down", 10, 5);
    expect((v as any).scroll).toBe(2);
    s.mouse("wheel-up", 10, 5);
    expect((v as any).scroll).toBe(0);
    const hint = s.lines().at(-1)!;
    const y = s.lines().length - 1;
    const dot = hint.indexOf(", .") + 2;
    s.mouse("down", dot, y); s.mouse("up", dot, y);
    expect(v.title).not.toBe(title);
    s.click("Q back", y);
    expect(s.stack.length).toBe(0);
  });

  test("help: a click on an item closes help and opens it; a click anywhere else only closes", () => {
    const s = on(new Help());
    s.click("[N] Newscan");
    expect(s.stack.length).toBe(1);
    expect(s.top()).toBeInstanceOf(MessageList);
    s.stack.length = 0;
    s.stack.push(new Help());
    s.mouse("down", 0, 0);
    expect(s.stack.length).toBe(0);
  });

  test.skipIf(!art)("the main menu's ? still shows help, and keys there still only close it", () => {
    const s = on(new MainMenu());
    s.key({ kind: "char", ch: "?" });
    expect(s.top()).toBeInstanceOf(Help);
    s.key({ kind: "char", ch: "N" });
    expect(s.top()).toBeInstanceOf(MainMenu);
  });

  test("who's online and stats: Q back is clickable", () => {
    const w = on(new WhoOnline());
    w.click("Q back");
    expect(w.stack.length).toBe(0);
    const st = on(new Stats());
    st.click("Q back");
    expect(st.stack.length).toBe(0);
  });

  test.skipIf(!art)("the logon: a click is ⏎ (the first hurries the modem, the next logs on)", () => {
    const d = door();
    const s = on(new Logon(d.ctx), d);
    s.mouse("down", 5, 5); s.mouse("up", 5, 5);
    expect(s.top()).toBeInstanceOf(Logon);
    s.mouse("down", 5, 5); s.mouse("up", 5, 5);
    expect(s.top()).toBeInstanceOf(MainMenu);
  });
});

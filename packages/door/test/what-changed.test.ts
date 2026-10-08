// PIE-647: the status bar's +N new is the distinct notes others changed since the person last looked, from the
// service's change feed; it opens a what-changed list in the drawer (click, alt+o, `act changes.open`); the person's
// opening marks it seen (kept per outline) and an agent's never does; a row opens its note where opens land.
// A scratch service; fictional notes.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { WhatChanged } from "../src/desk/what-changed";
import type { Msg } from "../src/board";
import { SocketBoard, type Actor } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "");
const AGENT: Actor = { kind: "agent", id: "fern-agent" };

describe.skipIf(!outliner)("what changed", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, painted: string[] = [];
  let key: (k: Key) => void = () => {};
  const bar = () => { (app as any).paint(); return plain(painted.at(-1) ?? ""); };
  const notes: Record<string, Msg> = {};
  const saved: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const k of ["EP0CH_STATE", "EP0CH_DAILY_AGENT"]) saved[k] = process.env[k];
    process.env.EP0CH_STATE = join(scratch.root, "door");
    const cat = join(scratch.root, "claude");
    writeFileSync(cat, "#!/bin/sh\nexec cat \"$@\"\n"); chmodSync(cat, 0o755);
    process.env.EP0CH_DAILY_AGENT = cat;
    board = new SocketBoard(await scratch.start());
    await board.info();
    for (const t of ["Hens", "Beans", "Compost", "Gate"]) notes[t] = await board.createBlock(null, `${t}\nfirst text`);
    const term: any = {
      info: { cols: 120, rows: 40, cellW: 9, cellH: 16, kitty: false }, write() {}, paint(l: string[]) { painted = l; }, paintRow(r: number, l: string) { painted[r] = l; },
      invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {},
    };
    app = new App(term, board, Date.now(), () => {});
    app.push({ title: "plain", key() {}, render: (c: any) => ({ lines: Array.from({ length: c.t.rows - 1 }, () => "") }) } as any);
    app.whatChanged.outline = "scratch";
    board.subscribe(e => app.event(e));
    await app.whatChanged.seed(board);
  }, 30_000);
  afterAll(async () => {
    app?.drawer.tile?.kill(); board?.close(); await scratch.dispose();
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  });

  const edit = async (name: string, text: string, as: Actor) => {
    const m = await board.get(notes[name]!.id);
    notes[name] = await board.update(m!.id, text, m!.revision!, as);
  };

  test("the count is distinct notes others changed; the person's own edits are not news", async () => {
    expect(bar()).not.toContain("new");
    await edit("Hens", "Hens\nthree hens now", AGENT);
    await edit("Hens", "Hens\nfour hens now", AGENT);
    await edit("Beans", "Beans\nstaked", AGENT);
    await edit("Compost", "Compost\nturned", { kind: "agent", id: "moss-agent" });
    await edit("Gate", "Gate\nlatch fixed", { kind: "user" });
    await until(() => app.whatChanged.count() === 3, "three notes counted");
    expect(bar()).toContain("+3 new");
  });

  test("an agent's open and read never mark anything seen; the rows say who, what and when", async () => {
    (app as any).lastInput = 0;
    const r = await app.act({ action: "changes.open", args: {}, as: "test-agent" }) as any;
    expect(r).toMatchObject({ changed: 3, seen: false });
    expect(app.whatChanged.count()).toBe(3);
    const listed = await app.act({ action: "changes.list", args: {}, as: "test-agent" }) as any;
    expect(listed.changed.map((x: any) => [x.title, x.who, x.kind, x.agent, x.seen])).toEqual([
      ["Compost", "moss-agent", "edited", true, false], ["Beans", "fern-agent", "edited", true, false], ["Hens", "fern-agent", "edited", true, false],
    ]);
    // Only the person marks them seen.
    await expect(app.act({ action: "changes.seen", args: {}, as: "test-agent" })).rejects.toThrow();
    expect(app.whatChanged.count()).toBe(3);
  });

  test("a click on +N new opens the list in the drawer, the person's looking clears the count, the rows keep their mark", async () => {
    const at = (app as any).changedAt;
    expect(at).not.toBeNull();
    key({ kind: "mouse", action: "down", button: 0, x: at.from + 1, y: at.row });
    await until(() => app.whatChanged.count() === 0, "seen once the person looked");
    expect(app.drawer.open).toBe(true);
    const tab = app.drawer.tabs().find(t => t.kind === "what-changed")!;
    expect(tab).toBeDefined();
    const pane = (app.drawer as any).d.pane(tab.name);
    expect(pane.rows().length).toBe(3);
    const lines = pane.render(100, 10, true).lines.map(plain);
    expect(lines[0]).toContain("● Compost · moss-agent (agent) · edited");
    expect(bar()).not.toContain("new");
  });

  test("a row opens its note, ⏎ or a click where opens land and alt+⏎ in a new detail; d shows the change", async () => {
    const tab = app.drawer.tabs().find(t => t.kind === "what-changed")!;
    const pane = (app.drawer as any).d.pane(tab.name);
    await app.dispatch.press("changes.diff", { n: 3 }, tab.name) as any;
    const diff = await (async () => { await until(() => pane.describe()[2].diff?.[0] !== "…", "the diff read"); return pane.describe()[2].diff as string[]; })();
    expect(diff.join("\n")).toContain("- three hens now");
    expect(diff.join("\n")).toContain("+ four hens now");
    // In the drawer a tile has no reader of its own: the open lands on the screen shown, and a screen without tiles says so.
    await expect(app.act({ action: "changes.go", args: { n: 3 }, tile: tab.name, as: "test-agent" })).rejects.toThrow(/no tiles to open it in/);
  });

  test("the position is kept per outline: a new door starts from where the person last looked", async () => {
    await edit("Gate", "Gate\nlatch painted", AGENT);
    await until(() => app.whatChanged.count() === 1, "one new");
    const again = new WhatChanged();
    again.outline = "scratch";
    await again.seed(board);
    expect(again.list().map(r => r.blockId)).toEqual([notes.Gate!.id]);
    const other = new WhatChanged();
    other.outline = "elsewhere";
    await other.seed(board);
    expect(other.count()).toBe(0);
  });

  test("a refreshing extension doesn't hide an agent's unseen change; held-back extension writes stay unseen; unseen rows outlive the limit", () => {
    const w = new WhatChanged();
    const ev = (sequence: number, blockId: string, actor: { author: string; actorId: string }, kind = "edit") => ({ domain: "content", action: "block.update", sequence, change: { sequence, changeId: sequence, action: "block.update", kind, blockId, actor, recordedAt: new Date().toISOString() } }) as any;
    w.heard(ev(900, "n1", { author: "agent", actorId: "fern-agent" }));
    w.heard(ev(901, "n1", { author: "agent", actorId: "ext:jira" }));
    w.heard(ev(902, "n2", { author: "agent", actorId: "ext:jira" }));
    expect(w.list().map(r => [r.blockId, r.who])).toEqual([["n1", "fern-agent"]]);
    expect(w.count()).toBe(1);
    w.markSeen();
    expect(w.count()).toBe(0);
    expect(w.extCount()).toBe(1);
    w.includeExt = true;
    expect(w.count()).toBe(1);
    for (let i = 0; i < 250; i++) w.heard(ev(1000 + i, `m${i}`, { author: "agent", actorId: "fern-agent" }));
    expect(w.count()).toBe(251);
  });
});

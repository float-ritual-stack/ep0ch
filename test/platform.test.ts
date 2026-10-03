// The door on the service platform: views.read, projected reads, the change feed, and the refusal of a
// service older than the door. The pure parts run anywhere; the fake service shows the refusal and the
// reconnect. The rest runs against a scratch outliner service (never a real outline) from EP0CH_OUTLINER.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { forScreens } from "../src/app";
import type { Msg } from "../src/board";
import { boardScreen } from "../src/desk/screen-specs";
import type { Desk } from "../src/desk/desk";
import { ReaderPane, WhoPane, type DeskApi } from "../src/desk/panes";
import { answer, setLiveSource } from "../src/live";
import { ACTOR_ID, OUTLINE_CAPABILITIES, SocketBoard, type OutlineEvent } from "../src/socket";
import type { Key } from "../src/term";
import type { ViewRead } from "../src/views";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

// ── pure ──────────────────────────────────────────────────────────────────────

describe("list rows", () => {
  const b = new SocketBoard("/nonexistent");
  test("projected and compact blocks become rows that know they lack the full text", () => {
    const [p, t, f] = b.toMsgs([
      { id: "p", parentId: null, title: "Paint the shed", revision: 3, properties: [{ key: "stage", value: "doing" }], createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-02T00:00:00Z" },
      { id: "t", parentId: "x", preview: "Water the ferns ↵ twice a week", revision: 1 },
      { id: "f", parentId: null, text: "Whole note\nbody", revision: 2 },
    ] as any);
    expect([p!.text, p!.partial, p!.props, p!.revision]).toEqual(["Paint the shed", true, { stage: "doing" }, 3]);
    expect([t!.text, t!.partial]).toEqual(["Water the ferns", true]);
    expect([f!.text, f!.partial]).toEqual(["Whole note\nbody", undefined]);
  });
});

describe("review fixes without a service", () => {
  const row = (id: string, text: string, props: Record<string, string> = {}): Msg => ({
    id, text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: null, revision: 1, props,
    properties: Object.entries(props).map(([key, value]) => ({ key, value })),
  });

  test("a view-domain change record (a lane's reorder) reaches the screens; other view events don't", () => {
    const reorder = { sequence: 5, changeId: 5, action: "virtual.occurrences.reorder", kind: "reorder" as const, blockId: "view", recordedAt: "" };
    expect(forScreens({ domain: "view", action: "virtual.occurrences.reorder", blockId: "view", sequence: 5, change: reorder })).toBe(true);
    expect(forScreens({ domain: "view", action: "clients.register", sequence: 5 })).toBe(false);
    expect(forScreens({ domain: "content", action: "update", sequence: 5 })).toBe(true);
  });

  test("who's online: a title that couldn't be read is asked again on the next load, never cached as …", async () => {
    let mode: "fail" | "missing" | "ok" = "fail";
    const asked: string[][] = [];
    const board = {
      clientId: "me",
      callers: async () => [{ id: "tree-1", name: "tree", host: "garden", activity: "browsing", target: "blk-fern" }],
      readMany: async (ids: string[]) => { asked.push(ids); if (mode === "fail") throw new Error("socket closed"); return mode === "ok" ? [row("blk-fern", "Water the ferns")] : []; },
    };
    const desk = { ctx: { board, t: { cols: 100, rows: 30 }, redraw() {}, flash() {} }, redraw() {} } as any;
    const pane = new WhoPane();
    pane.init(desk);
    const text = () => pane.render(80, 10, false, desk).lines.join("\n");
    for (const next of ["missing", "ok"] as const) {
      const n = asked.length;
      await until(() => asked.length === n + 1, "the title reads");
      await Bun.sleep(5);
      expect(text()).not.toContain("…");
      expect(text()).not.toContain("Water the ferns");
      mode = next;
      pane.onEvent(desk);
    }
    await until(() => asked.length === 3, "the reads after the service answers");
    await until(() => text().includes("Water the ferns"), "the title shown");
  });

  test("a reader whose whole-note read fails says so, and reads it again when the door reconnects", async () => {
    let fail = true;
    const full = row("blk-shed", "Paint the shed\nTwo coats, green.");
    const board = {
      get: async () => { if (fail) throw new Error("socket closed"); return full; },
      comments: async () => [], ancestors: async () => [],
    };
    const b = boardScreen("hub");
    b.ctx = { board, t: { cols: 100, rows: 30, cellW: 9, cellH: 16 }, redraw() {}, flash() {}, graphics: false } as never;
    const pane = BV.view(b).preview as ReaderPane;
    pane.show({ ...full, text: "Paint the shed", partial: true }, b);
    await until(() => pane.unread !== "", "the failed read");
    expect(pane.render(80, 10, false, b).lines.join("\n")).toContain("couldn't read the note: socket closed");
    fail = false;
    b.onEvent({ domain: "content", action: "reconnected", sequence: 1, caughtUp: 0 });
    await until(() => !pane.msg?.partial, "the note read again");
    expect(pane.msg?.text).toBe(full.text);
    expect(pane.render(80, 10, false, b).lines.join("\n")).toContain("Two coats");
  });
});

describe("reconnecting to a fake service", () => {
  // Just enough of the protocol to drop the event connection and watch the door catch up.
  let server: Server, path = "", clients: Socket[] = [];
  let feed: (sequence: number) => unknown = () => ({ kind: "changes", changes: [], nextSequence: 0, completeness: { kind: "complete" }, sequence: 0 });
  const ALL = [...OUTLINE_CAPABILITIES] as string[];
  let caps: string[] | undefined = ALL, protocol = 82;
  let subscribeSequence = 10;
  const onSubscribe: ((s: Socket) => void)[] = [];
  const change = (seq: number, id: number, blockId: string) => ({ sequence: seq, changeId: id, action: "update", kind: "edit", blockId, parentId: null, revision: 2, recordedAt: "" });
  beforeAll(async () => {
    path = join(mkdtempSync(join(tmpdir(), "ep0ch-fake-")), "s.sock");
    server = createServer(s => {
      clients.push(s);
      let buf = "";
      s.on("data", d => {
        buf += d.toString();
        for (let i = buf.indexOf("\n"); i >= 0; i = buf.indexOf("\n")) {
          const r = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
          const reply = (result: unknown) => s.write(JSON.stringify({ id: r.id, ok: true, result, sequence: subscribeSequence }) + "\n");
          if (r.action === "ping") reply({ status: "ready", protocolVersion: protocol, ...(caps ? { capabilities: caps } : {}), location: { hostname: "fake", workspaceRoot: "/fake" } });
          else if (r.action === "events.subscribe") { reply({ subscribed: true }); onSubscribe.shift()?.(s); }
          else if (r.action === "changes.since") {
            const page = feed(r.sequence);
            if (page instanceof Error) s.write(JSON.stringify({ id: r.id, ok: false, error: page.message, sequence: 0 }) + "\n");
            else reply(page);
          }
        }
      });
      s.on("error", () => {});
    });
    await new Promise<void>(r => server.listen(path, r));
  });
  afterAll(() => { for (const c of clients) c.destroy(); server.close(); rmSync(dirname(path), { recursive: true, force: true }); });

  const connect = async () => {
    const b = new SocketBoard(path, 2000);
    b.reconnectMs = 30;
    await b.info();
    const events: OutlineEvent[] = [], states: string[] = [];
    b.onConnection = (s, d) => states.push(`${s}: ${d}`);
    let first: Socket | null = null;
    onSubscribe.push(s => { first = s; });
    b.subscribe(e => events.push(e));
    await until(() => !!first, "the first subscription");
    return { b, events, states, drop: () => first!.destroy(), push: (e: unknown) => first!.write(JSON.stringify({ event: e }) + "\n") };
  };

  test("missed changes are replayed in order; live ones wait for the catch-up and aren't delivered twice", async () => {
    caps = ALL; subscribeSequence = 10;
    const { b, events, states, drop } = await connect();
    expect(b.lastSequence).toBe(10);
    let second: Socket | null = null;
    onSubscribe.push(s => {
      second = s;
      // Live events race the catch-up: one the feed also returns, one newer.
      s.write(JSON.stringify({ event: { domain: "content", action: "update", sequence: 12, blockId: "b", change: change(12, 7, "b") } }) + "\n");
      s.write(JSON.stringify({ event: { domain: "content", action: "update", sequence: 13, blockId: "c", change: change(13, 8, "c") } }) + "\n");
    });
    let asked = -1;
    feed = seq => { asked = seq; return { kind: "changes", changes: [change(11, 6, "a"), change(12, 7, "b")], nextSequence: 12, completeness: { kind: "complete" }, sequence: 12 }; };
    drop();
    await until(() => states.length === 2, "the reconnect", 3000);
    await until(() => events.some(e => e.blockId === "c"), "the held live event");
    expect(asked).toBe(10);
    expect(states).toEqual(["lost: outline connection lost · reconnecting", "restored: caught up 2 changes"]);
    expect(events.map(e => `${e.action}:${e.blockId ?? ""}${e.catchUp ? "*" : ""}`)).toEqual(["update:a*", "update:b*", "reconnected:", "update:c"]);
    expect(b.lastSequence).toBe(13);
    expect(second).not.toBeNull();
    b.close();
  });

  test("a service older than the door is refused at once, with the fix named", async () => {
    for (const [p, c, why] of [[82, ALL.filter(x => x !== "views.planWrite"), /without views\.planWrite/], [82, undefined, /without blocks\.read/], [80, ALL, /protocol 80/]] as const) {
      protocol = p; caps = c as string[] | undefined;
      const b = new SocketBoard(path, 2000);
      const refused = b.info();
      await expect(refused).rejects.toThrow(why);
      await expect(refused).rejects.toThrow("is older than this door");
      await expect(refused).rejects.toThrow("`ep0ch install --apply`, or restart the outline host");
      b.close();
    }
    protocol = 82; caps = ALL;
  });

  test("a feed reset is a reset event and the cursor follows the service", async () => {
    caps = ALL; subscribeSequence = 10;
    const c = await connect();
    feed = () => ({ kind: "reset", reason: "sequence-ahead", oldestSequence: 0, sequence: 4 });
    c.drop();
    await until(() => c.states.length === 2, "the reconnect", 3000);
    expect(c.events.map(e => [e.action, e.reason])).toEqual([["reset", "the feed's history is behind the door"]]);
    expect(c.b.lastSequence).toBe(4);
    c.b.close();
  });
});

// ── against a scratch outliner service ────────────────────────────────────────

describe.skipIf(!outliner)("the board on this service's platform", () => {
  const scratch = new Scratch();
  let board: SocketBoard, other: SocketBoard, b: Desk;
  let hub: any, lanes: Record<string, any> = {}, cards: Record<string, any> = {};
  const flashes: string[] = [], states: string[] = [];
  const B = () => BV.view(b);
  const create = (parentId: string | null, text: string) => other.request("create", { parentId, text, author: "agent" });
  const current = async (id: string) => (await other.request("blocks.context", { blockId: id })).selected;
  const write = async (id: string, edit: (t: string) => string) => {
    const now = await current(id);
    return other.request("update", { blockId: id, text: edit(now.text), expectedRevision: now.revision, mutation: { author: "agent", actorId: "test-other-writer" } });
  };
  const laneIds = (name: string): string[] => (B().lanes.find((l: any) => l.name === name)?.items ?? []).map((m: Msg) => m.id);
  const loaded = () => until(() => B().lanes.length === 7 && B().lanes.every((l: any) => l.items), "the lanes", 10_000);
  /** Lanes asked again from now until the board is quiet. */
  const askedDuring = async (act: () => Promise<unknown>) => {
    await Bun.sleep(400);
    const before = B().asked.length, full = B().refreshes.full;
    await act();
    await Bun.sleep(1800);
    return { lanes: [...new Set<string>(B().asked.slice(before))].sort(), full: B().refreshes.full - full };
  };

  beforeAll(async () => {
    const sock = await scratch.start();
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(sock);
    other = new SocketBoard(sock);
    const info = await board.info();
    expect(info.workspace).toBe(scratch.workspace);                 // it really is the scratch outline
    hub = await create(null, "Garden board");
    for (const [name, q] of [
      ["Queued", "[query::stage=queued]"], ["Doing", "[query::stage=doing]"], ["Done", "[query::stage=done] [sort::updated]"],
      ["Urgent", "[query::priority=high] [limit::2]"], ["Either", "[query::stage=blocked OR stage=waiting]"],
      ["Not done", "[query::NOT stage=done type=chore]"], ["Recent", "[query::type=chore updated >= -7d]"],
    ] as const) lanes[name] = await create(hub.id, `${name} [type::virtual-branch] ${q}`);
    const mk = async (k: string, text: string) => { cards[k] = await create(null, text); };
    await mk("fern", "Water the ferns [type::chore] [stage::queued] [priority::low]\nTwice a week, from the rain barrel.");
    await mk("shed", "Paint the shed [type::chore] [stage::queued] [priority::high]\nTwo coats, green.");
    await mk("gate", "Oil the gate [type::chore] [stage::doing] [priority::high]\nIt squeaks.");
    await mk("seed", "Sort the seed box [type::chore] [stage::done]\nDone last week.");
    await mk("hose", "Mend the hose [type::chore] [stage::blocked] [priority::high]\nWaiting on a new washer.");
    await mk("note", "A loose note about compost\nNo properties at all.");

    b = boardScreen(hub.id);
    const ctx = { board, t: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, workspace: info.workspace, host: "test", flash: (m: string) => flashes.push(m), redraw() {}, pop() {}, cycleVideo() {}, suspend: (r: () => void) => r(), graphics: false };
    board.onConnection = (s, d) => states.push(`${s}: ${d}`);
    board.reconnectMs = 100;
    board.subscribe(e => { if (forScreens(e)) b.onEvent(e); });       // as App.event routes them
    await b.enter(ctx as any);
    await loaded();
  }, 40_000);

  afterAll(async () => {
    board?.close(); other?.close();
    delete process.env.EP0CH_STATE;
    await scratch.dispose();
  });

  test("lanes come from views.read", async () => {
    expect(board.sent.includes("views.read")).toBe(true);
    expect(laneIds("Queued").sort()).toEqual([cards.fern.id, cards.shed.id].sort());
    expect(laneIds("Urgent").length).toBe(2);                                                    // the authored limit
    const either = B().lanes.find((l: any) => l.name === "Either").read as ViewRead;
    expect(either.status).toBe("ready");
    expect(laneIds("Either")).toEqual([cards.hose.id]);
    expect(laneIds("Not done").sort()).toEqual([cards.fern.id, cards.gate.id, cards.hose.id, cards.shed.id].sort());
    expect(laneIds("Recent").length).toBe(5);
  });

  test("lane rows carry no full text; the preview reads the whole note", async () => {
    const row = B().lanes.find((l: any) => l.name === "Queued").items[0] as Msg;
    expect(row.partial).toBe(true);
    expect(row.revision).toBeGreaterThan(0);
    expect(row.properties?.length).toBeGreaterThan(0);
    await until(() => !!B().preview.msg && !B().preview.msg.partial, "the preview's whole note");
    expect(B().preview.msg.text).toContain("\n");
  });

  test("a live figure's saved view is read the same way", async () => {
    setLiveSource(board, () => {});
    const before = board.sent.length;
    const p = { view: `((${lanes.Doing.id}))` };
    answer(p);
    await until(() => answer(p)?.state === "ready", "the live answer");
    expect(answer(p)!.items.map(m => m.id)).toEqual([cards.gate.id]);
    expect(board.sent.slice(before).includes("views.read")).toBe(true);
  });

  test("an unrelated edit asks no lane again", async () => {
    const r = await askedDuring(() => write(cards.note.id, t => t + " More."));
    expect(r).toEqual({ lanes: [], full: 0 });    // the note meets no lane's query, OR lanes included
  });

  test("a reorder made in Tree (a view-domain change) asks that lane again, and its order follows", async () => {
    const before = laneIds("Queued");
    expect(before.length).toBe(2);
    const r = await askedDuring(() => other.request("virtual.occurrences.reorder", { viewId: lanes.Queued.id, orderedBlockIds: [...before].reverse() }));
    expect(r).toEqual({ lanes: ["Queued"], full: 0 });
    expect(laneIds("Queued")).toEqual([...before].reverse());
  });

  test("a stage change asks only the lanes the card was in or could now be in", async () => {
    const r = await askedDuring(() => write(cards.fern.id, t => t.replace("[stage::queued]", "[stage::doing]")));
    expect(r).toEqual({ lanes: ["Doing", "Not done", "Queued", "Recent"], full: 0 });   // not Done, not Urgent, not Either (blocked OR waiting)
    expect(laneIds("Doing")).toContain(cards.fern.id);
    expect(laneIds("Queued")).not.toContain(cards.fern.id);
  });

  test("a draft open on a note another client edits is marked changed elsewhere, never replaced", async () => {
    const pane = B().preview as ReaderPane;
    const desk = b as unknown as DeskApi;
    pane.show(await board.get(cards.gate.id), desk);
    pane.key({ kind: "char", ch: "e" } as Key, desk);
    await until(() => !!pane.draft, "the draft");
    for (const c of " (now)") pane.key({ kind: "char", ch: c } as Key, desk);
    const typed = pane.draft!.text;
    await write(cards.gate.id, t => t.replace("It squeaks.", "It squeaks less."));
    await until(() => pane.draft!.changedElsewhere, "the draft to be marked", 4000);
    expect(pane.draft!.text).toBe(typed);
    pane.key({ kind: "esc" } as Key, desk); pane.key({ kind: "esc" } as Key, desk);
    expect(pane.draft).toBeNull();
  });

  test("the door's own save is not read back: the reader already has that revision", async () => {
    // A detail, so a lane reload's preview-follow can't swap the note out from under the check.
    b.openBlock((await board.get(cards.seed.id))!);
    const pane = B().details[B().active] as ReaderPane, desk = b as unknown as DeskApi;
    await until(() => pane.msg?.id === cards.seed.id && !pane.msg?.partial, "the note");
    const reloads: (string | undefined)[] = [];
    // The reader's note surface reads the comments (src/surface/note.ts).
    const load = pane.surface.loadComments.bind(pane.surface);
    pane.surface.loadComments = h => { reloads.push(pane.msg?.id); return load(h); };
    pane.key({ kind: "char", ch: "e" } as Key, desk);
    await until(() => !!pane.draft, "the draft");
    pane.key({ kind: "end" } as Key, desk);
    pane.key({ kind: "down" } as Key, desk); pane.key({ kind: "end" } as Key, desk);
    for (const c of " Labelled.") pane.key({ kind: "char", ch: c } as Key, desk);
    const skipped = B().refreshes.skipped;
    reloads.length = 0;
    pane.key({ kind: "char", ch: "s", ctrl: true } as Key, desk);
    await until(() => !pane.draft, "the save");
    await Bun.sleep(1000);
    expect(B().refreshes.skipped).toBeGreaterThan(skipped);
    // …but its comments are read again: the edit may have moved the passages they quote.
    expect(reloads).toContain(cards.seed.id);
    const log = await other.request("activity.recent", { author: "user", limit: 20 });
    expect(log.entries.find((e: any) => e.block.id === cards.seed.id)?.actorId).toBe(ACTOR_ID);
  });

  test("a dropped connection catches up on what it missed", async () => {
    board.reconnectMs = 1200;                                          // long enough to write while it's away
    const n = states.length;
    (board as any).events.destroy();
    await until(() => states.length === n + 1, "the drop");
    await write(cards.shed.id, t => t.replace("[stage::queued]", "[stage::done]"));
    await until(() => states.length === n + 2, "the reconnect", 8000);
    expect(states.slice(n)).toEqual(["lost: outline connection lost · reconnecting",
      "restored: caught up 1 change"]);
    await until(() => laneIds("Done").includes(cards.shed.id), "the missed change in the lanes", 4000);
    expect(laneIds("Queued")).not.toContain(cards.shed.id);
    board.reconnectMs = 100;
  }, 15_000);

  test("a service restart: reconnect, catch up (nothing missed), and live refresh keeps working", async () => {
    const n = states.length;
    // The door lets go of its connections when the service drops it, so a SIGTERM restart isn't held up.
    // (The test's second client is a plain request connection; it has to hang up by itself.)
    other.close();
    const restarted = await scratch.restart();
    other = new SocketBoard(restarted.sock);
    expect(restarted.graceful).toBe(true);
    await until(() => states.length >= n + 2, "the reconnect after a restart", 15_000);
    expect(states.slice(n)).toEqual(["lost: outline connection lost · reconnecting",
      "restored: caught up 0 changes"]);
    await write(cards.hose.id, t => t.replace("[stage::blocked]", "[stage::doing]"));
    await until(() => laneIds("Doing").includes(cards.hose.id), "a live change after the restart", 5000);
  }, 30_000);

  test("history the feed can't answer is a reset: everything reloads and the cursor follows the service", async () => {
    board.lastSequence = 10_000_000;                                   // as if the door had seen a different, newer database
    const n = states.length, full = B().refreshes.full;
    await until(() => !!(board as any).events, "the event connection");
    (board as any).events.destroy();
    await until(() => states.length === n + 2, "the reconnect", 8000);
    expect(states.at(-1)).toBe("restored: reloaded everything (the feed's history is behind the door)");
    await until(() => B().refreshes.full > full, "the full reload");
    expect(board.lastSequence).toBeLessThan(10_000_000);
  }, 15_000);

  test("moves still land, and grammar lanes are refused with the construct", async () => {
    await Bun.sleep(300);
    const at = (name: string) => B().lanes.findIndex((l: any) => l.name === name);
    const pick = (lane: string, id: string) => { BV.at(b, "lanes"); B().lane = at(lane); B().lanes[at(lane)].sel = laneIds(lane).indexOf(id); };
    pick("Doing", cards.gate.id);
    B().moveTo(at("Done")); await until(() => !B().moving && laneIds("Done").includes(cards.gate.id), "the move");
    expect((await current(cards.gate.id)).properties.find((p: any) => p.key === "stage").value).toBe("done");
    pick("Done", cards.gate.id);
    await B().moveTo(at("Either"));
    expect(flashes.at(-1)).toBe("can't move to Either: Either needs (stage=blocked OR stage=waiting) and the note has stage=done; a move sets only the plain clauses beside it");
  }, 15_000);
});

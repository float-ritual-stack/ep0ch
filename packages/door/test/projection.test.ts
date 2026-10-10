// PIE-445 (slice 4): readers show a ticket's stored details under a `jira::` line, and at the top of a
// ticket page, the way Detail does. The service reads them (`resources.projection.read`, capability
// `resources.projection`); src/projection.ts lays them out in Detail's words (parity-tested against
// pi-herdr-outliner's detail-embeds.ts) and the note surface draws them as a shaded, read-only region
// that `[ ]` stops on, ⏎ and a click open (the ticket's page) and `y` copies. An older service is never
// asked and nothing extra is drawn. Fictional tickets and notes only; the scratch service's tickets come
// from a made-up extension (src/showcase/tickets) and nothing contacts a real provider.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import { subject, type Msg } from "../src/board";
import { boardScreen } from "./board-view";
import type { Desk } from "../src/desk/desk";
import { external } from "../src/open";
import { forgetProjectionAnswers, mayHaveProjections, projectionKeys, projectionLayout, relativeAge, resourceChanged, ticketRegion, type ResourceProjection, type ResourceProjectionRead } from "../src/projection";
import { bindExtensions } from "../src/extensions";
import type { LinkTarget } from "../src/refs";
import { MainMenu } from "../src/screens";
import { installTickets, SHOWCASE_TICKETS, ticketSource } from "../src/showcase/tickets/install";
import { SocketBoard } from "../src/socket";
import { NoteSurface, type SurfaceHost } from "../src/surface/note";
import { SHADE } from "../src/embeds";
import { RULER_BG } from "../src/surface/selection";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";
import * as BV from "./board-view";

const plain = (s: string) => s.replace(/\x1b\[[\d;:]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const char = (ch: string): Key => ({ kind: "char", ch });
const NOTE_ID = "aaaaaaaa-1111-4222-8333-444444444444";
const RESOURCE = "bbbbbbbb-1111-4222-8333-444444444444";
const minutesAgo = (n: number) => new Date(Date.now() - n * 60_000).toISOString();

const base = (over: Partial<ResourceProjection>): ResourceProjection => ({
  anchor: { kind: "directive", line: 2, start: 0, end: 6 }, provider: "jira", label: "Jira", propertyKey: "jira",
  options: { unknown: [] }, status: "ready", fields: [], ...over,
});
const READY = base({
  key: "ACME-12", resourceId: RESOURCE, sourceId: "src-1", summary: "Rollout checklist for the vendor switch",
  fields: [{ label: "Status", value: "In progress" }, { label: "Assignee", value: "A. Person" }, { label: "Labels", value: "rollout, vendor" }],
  updatedAt: "2026-09-19T08:30:00.000Z", fetchedAt: "2026-09-20T10:00:00.000Z", externalUrl: "https://tickets.example.test/browse/ACME-12",
});

/** One projection per status the service sends, plus options, an older label and a status from a newer service. */
const CASES: ResourceProjection[] = [
  READY,
  { ...READY, options: { compact: true, unknown: [] } },
  { ...READY, options: { comments: 5, unknown: ["--wat"] }, updatedAt: undefined },
  { ...READY, status: "stale", reason: "Showing the stored copy; the last refresh failed: item was not found" },
  { ...READY, fetchedAt: undefined, summary: "No fetched time [kept] ((x))" },
  base({ status: "not-fetched", key: "ACME-13", resourceId: RESOURCE, reason: "Nothing fetched yet. Open ACME-13 (the link above) and press r to fetch it." }),
  base({ status: "not-registered", key: "ACME-14", reason: "ACME-14 is not registered yet. Write jira:: ACME-14 and open that link to register it." }),
  base({ status: "ambiguous", candidates: ["ACME-1", "ACME-2"], reason: "2 Jira keys at the nearest level: ACME-1, ACME-2. Write the key after jira::" }),
  base({ status: "no-key", reason: "No Jira key on this line, above it, in this block or in its ancestors. Write the key after jira::" }),
  base({ status: "unavailable", key: "ACME-15", reason: "Workspace policy denies reading this Source" }),
  base({ status: "refreshing", key: "ACME-16", reason: "A status a newer service sends" }),
  { ...base({ status: "no-key" }), label: undefined },
  { ...READY, summary: "Uses *stars*, _under_ and `ticks` #tag <b> | pipe \\ slash" },
];

describe.skipIf(!outliner)("parity with Detail's layout (pi-herdr-outliner src/detail-embeds.ts)", () => {
  let theirs: any, refs: any;
  beforeAll(async () => {
    theirs = await import(join(outliner!, "src/detail-embeds.ts"));
    refs = await import(join(outliner!, "src/resource-references.ts"));
  });
  // Detail's lines as its Markdown renderer draws them: a Markdown link reads as its text, an escape as the character.
  const drawn = (line: string) => line.replace(/\[([^\]]*)\]\(pi-outliner:[^)]*\)/g, "$1").replace(/\\([\\`*_<>~#|])/g, "$1");

  test("every status, option and escape: the door's lines are Detail's as drawn, with the fetched line in the same place", () => {
    for (const p of CASES) {
      const want = theirs.resourceProjectionLayout(p);
      const mine = projectionLayout(p);
      expect({ status: p.status, lines: mine.lines }).toEqual({ status: p.status, lines: want.lines.map(drawn) });
      expect({ status: p.status, fetchedLine: mine.fetchedLine }).toEqual({ status: p.status, fetchedLine: want.fetchedLine });
    }
  });

  test("the age painted after the fetched time is Detail's relativeAge", () => {
    const now = Date.parse("2026-09-28T12:00:00.000Z");
    for (const ago of [0, 0.5, 1, 12, 59, 60, 61, 47 * 60, 48 * 60, 50 * 60 * 24, -5]) {
      const at = new Date(now - ago * 60_000).toISOString();
      expect({ ago, age: relativeAge(at, now) }).toEqual({ ago, age: theirs.relativeAge(at, now) });
    }
    expect(relativeAge("not a date", now)).toBe(theirs.relativeAge("not a date", now));
  });

  test("the door asks about every note the service could project, by the service's own provider keys", () => {
    // The service's providers as extensions.list lists them (Jira's, a made-up second one), in both tables.
    const providers = [{ provider: "ext:jira", key: "jira", label: "Jira" }, { provider: "ext:kanboard", key: "kanboard", label: "Kanboard" }];
    refs.useResourceDirectiveProviders("door-parity", providers);
    bindExtensions({ generation: 1, extensions: [], tileKinds: [], resourceProviders: providers });
    expect(projectionKeys().sort()).toEqual(refs.resourceDirectiveProviders().map((p: any) => p.propertyKey).sort());
    expect(mayHaveProjections("Board card\nkanboard:: KB-7")).toBe(true);
    const corpus = ["Vendor call ACME-12\njira::", "Page [jira::ACME-12]", "- jira:: --comments", "[type::note] jira:: ACME-1", "JIRA::", "no provider here [type::x]", "jira: not a property", "text jira::"];
    for (const text of corpus) if (refs.mayHaveResourceProjections(text)) expect({ text, asks: mayHaveProjections(text) }).toEqual({ text, asks: true });
    expect(mayHaveProjections("no provider here [type::x]")).toBe(false);
    refs.useResourceDirectiveProviders("door-parity", []);
    bindExtensions(null);
  });
});

// ── a reader over a stub service ───────────────────────────────────────────────────────────────────

const note = (text: string, revision = 4): Msg => ({ id: NOTE_ID, text, parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "you", revision, props: {} });

function stub(read: () => ResourceProjectionRead | Promise<ResourceProjectionRead>) {
  const b = {
    reads: 0,
    ancestors: async () => [], comments: async () => [],
    readResourceProjections: async (id: string) => { b.reads++; expect(id).toBe(NOTE_ID); return read(); },
  };
  return b;
}

function reader(b: ReturnType<typeof stub>) {
  const flashes: string[] = [], copied: string[] = [];
  let redraws = 0;
  const host: SurfaceHost = {
    ctx: { board: b, flash(x: string) { flashes.push(x); }, copy(t: string) { copied.push(t); }, t: { cellW: 9, cellH: 16 }, graphics: false } as any,
    redraw() { redraws++; }, navigate() {},
  };
  const s = new NoteSurface();
  const lines = (w = 90) => s.render(w, 50, host).lines;
  return { s, host, flashes, copied, lines, redraws: () => redraws };
}

/** Shows `m` and waits for the projection read to land (or for the reads to settle when there's none). */
async function shown(b: ReturnType<typeof stub>, m: Msg) {
  const r = reader(b);
  r.s.show(m, r.host);
  r.lines();
  await Bun.sleep(5);
  r.lines();
  return r;
}

const TEXT = "Vendor call ACME-12\nNotes from the call.\njira::\nAfter the region.";
const readOf = (projections: ResourceProjection[], revision = 4): ResourceProjectionRead => ({ blockId: NOTE_ID, revision, projections });

describe("a projection in a reader", () => {
  // The service lists Jira's provider (the door asks about `jira::` notes only then).
  beforeAll(() => { bindExtensions({ generation: 1, extensions: [], tileKinds: [], resourceProviders: [{ provider: "ext:jira", key: "jira", label: "Jira" }] }); });
  afterAll(() => { bindExtensions(null); });
  test("ready: the key, summary, allowed fields, updated time and fetched time with its age, under the jira:: line, shaded", async () => {
    const p = { ...READY, fetchedAt: minutesAgo(12) };
    const r = await shown(stub(() => readOf([p])), note(TEXT));
    const lines = r.lines(120), text = lines.map(plain);
    const at = text.findIndex(l => l.includes("Jira ACME-12 · Rollout checklist"));
    expect(text[at - 1]!.trim()).toBe("jira::");
    expect(text[at]!.trim()).toBe("▌∙ Jira ACME-12 · Rollout checklist for the vendor switch");
    expect(text[at + 1]!.trim()).toBe("▌  Status: In progress · Assignee: A. Person · Labels: rollout, vendor · Updated: 2026-09-19 " + projectionLayout(p).lines[1]!.split("2026-09-19 ")[1]);
    expect(text[at + 2]!.trim()).toMatch(/^▌  fetched \d{4}-\d\d-\d\d \d\d:\d\d \(12 min ago\)$/);
    expect(text[at + 3]!.trim()).toBe("After the region.");
    expect(lines[at]!).toContain(SHADE);                                       // shaded like an embed
  });

  test("each other status says what it is, in Detail's words, with the service's reason", async () => {
    const want: [ResourceProjection, string[]][] = [
      [CASES[3]!, ["Jira ACME-12 · Rollout checklist", "the last refresh failed: item was not found"]],
      [CASES[5]!, ["Jira ACME-13 · not fetched yet", "Nothing fetched yet. Open ACME-13"]],
      [CASES[6]!, ["Jira ACME-14 · not registered", "ACME-14 is not registered yet."]],
      [CASES[7]!, ["Jira · ambiguous: ACME-1, ACME-2", "2 Jira keys at the nearest level"]],
      [CASES[8]!, ["Jira · no key found", "No Jira key on this line"]],
      [CASES[9]!, ["Jira ACME-15 · unavailable", "Workspace policy denies reading this Source"]],
      [CASES[10]!, ["Jira ACME-16 · refreshing", "A status a newer service sends"]],
      [CASES[2]!, ["Comments are not stored yet", "unknown option --wat"]],
    ];
    for (const [p, says] of want) {
      const r = await shown(stub(() => readOf([p])), note(TEXT));
      const text = r.lines(120).map(plain).join("\n");
      for (const s of says) expect({ status: p.status, has: text.includes(s) }).toEqual({ status: p.status, has: true });
    }
  });

  test("a ticket page shows it at the top of the body, and a projection keeps its line's indent", async () => {
    const page = { ...READY, anchor: { kind: "page", line: 0, start: 0, end: 30 } };
    const r = await shown(stub(() => readOf([page])), note("Rollout page [jira::ACME-12]\nLocal notes under the ticket."));
    const body = r.lines().map(plain);
    const rule = body.findIndex(l => l.trim() === "");           // the blank row that ends the header (PIE-657)
    expect(body[rule + 1]!.trim()).toStartWith("▌∙ Jira ACME-12");
    expect(body.findIndex(l => l.includes("Local notes"))).toBeGreaterThan(rule + 3);

    const nested = { ...READY, anchor: { kind: "directive", line: 2, start: 0, end: 0 } };
    const r2 = await shown(stub(() => readOf([nested])), note("Call ACME-12\n- follow up\n    jira::\n- next"));
    const row = r2.lines().map(plain).find(l => l.includes("Jira ACME-12"))!;
    expect(row).toMatch(/^ ▌ {4}∙ Jira ACME-12/);
  });

  test("a folded section hides the projections in it, and they come back unfolded", async () => {
    const p = { ...READY, anchor: { kind: "directive", line: 3, start: 0, end: 0 } };
    const r = await shown(stub(() => readOf([p])), note("Call ACME-12\n## Tickets\nsome text\njira::\n## Later\nmore"));
    expect(r.lines().map(plain).some(l => l.includes("Jira ACME-12"))).toBe(true);
    r.s.key(char("("), r.host); r.s.key(char(")"), r.host); r.s.key(char("f"), r.host);
    // `( )` from nothing selected lands on the first heading; `f` folds it.
    const folded = r.lines().map(plain);
    expect(folded.some(l => l.includes("## Tickets") && l.includes("folded"))).toBe(true);
    expect(folded.some(l => l.includes("Jira ACME-12"))).toBe(false);
  });

  test("[ ] stop on the region, the ruler tints all of it, ⏎ and a click open the ticket's page, and the hint says so", async () => {
    const opened: string[][] = [];
    const run = external.run;
    external.run = cmd => { opened.push(cmd); };
    try {
      const r = await shown(stub(() => readOf([{ ...READY, fetchedAt: minutesAgo(3) }])), note(TEXT));
      r.lines();
      r.s.key(char("]"), r.host);
      const lines = r.lines(120);
      expect(r.s.describe().elements!.current).toMatchObject({ kind: "resource", label: "Jira ACME-12", target: READY.externalUrl });
      expect(r.s.hint()).toContain("⏎ open the ticket's page · y copy");
      const ruled = lines.flatMap(l => (l.includes(RULER_BG) ? [plain(l).trim()] : []));
      expect(ruled).toHaveLength(3);
      expect(ruled[0]).toStartWith("▌∙ Jira ACME-12");
      expect(r.s.key({ kind: "enter" }, r.host)).toBe(true);
      await Bun.sleep(1);
      expect(opened.at(-1)!.at(-1)).toBe(READY.externalUrl);
      expect(r.flashes.at(-1)).toBe(`opened ${READY.externalUrl} in the browser`);
      // A click on the head opens it too.
      const y = lines.findIndex(l => plain(l).includes("Jira ACME-12 ·")), x = plain(lines[y]!).indexOf("ACME-12");
      r.s.key({ kind: "esc" }, r.host);
      r.lines(120);
      expect(r.s.click(x, y, r.host)).toBe(true);
      await Bun.sleep(1);
      expect(opened).toHaveLength(2);
      expect(r.s.describe().elements!.current).toMatchObject({ kind: "resource" });
    } finally { external.run = run; }
  });

  test("with nothing to open (no key, not fetched, not registered), ⏎ says why and opens nothing", async () => {
    const opened: string[][] = [];
    const run = external.run;
    external.run = cmd => { opened.push(cmd); };
    try {
      for (const p of [CASES[8]!, CASES[5]!, CASES[6]!]) {
        const r = await shown(stub(() => readOf([p])), note(TEXT));
        r.s.key(char("]"), r.host);
        r.lines();
        expect(r.s.describe().elements!.current).toMatchObject({ kind: "resource" });
        expect(r.s.hint()).toContain("⏎ say why there's nothing to open");
        r.s.key({ kind: "enter" }, r.host);
        await Bun.sleep(1);
        expect(r.flashes.at(-1)).toStartWith("nothing to open for Jira");
        expect(r.flashes.at(-1)).toContain(p.reason!.slice(0, 20));
      }
      expect(opened).toEqual([]);
    } finally { external.run = run; }
  });

  test("y on the region copies it as drawn (no gutter), and selects what it copied", async () => {
    const r = await shown(stub(() => readOf([{ ...READY, fetchedAt: minutesAgo(5) }])), note(TEXT));
    r.s.key(char("]"), r.host);
    r.lines();
    expect(r.s.key(char("y"), r.host)).toBe(true);
    const got = r.copied.at(-1)!;
    const rows = got.split("\n");
    expect(rows[0]).toBe("∙ Jira ACME-12 · Rollout checklist for the vendor switch");
    expect(rows.at(-1)).toMatch(/^ {2}fetched .* \(5 min ago\)$/);
    expect(got).not.toContain("▌");
    expect(r.flashes.at(-1)).toBe(`copied ${[...got].length} chars`);
    expect(r.s.describe().selection).toBeTruthy();
    // Without a current region, y is the selection's as before.
    r.s.key({ kind: "esc" }, r.host); r.s.key({ kind: "esc" }, r.host);
    r.s.key(char("y"), r.host);
    expect(r.flashes.at(-1)).toStartWith("nothing is selected");
  });

  test("a note that names no provider is never asked about", async () => {
    const b = stub(() => readOf([READY]));
    await shown(b, note("Plain note\nNo tickets here."));
    expect(b.reads).toBe(0);
  });

  test("a failed read leaves the note as it was; an answer for another revision isn't drawn", async () => {
    const before = (await shown(stub(() => readOf([])), note(TEXT))).lines().map(plain);
    const failing = stub(() => Promise.reject(new Error("service went away")));
    const r = await shown(failing, note(TEXT));
    expect(r.lines().map(plain)).toEqual(before);
    expect(r.flashes).toEqual([]);
    const old = await shown(stub(() => readOf([READY], 3)), note(TEXT, 4));
    expect(old.lines().map(plain)).toEqual(before);
    // A read that fails after one that worked keeps the region it drew.
    let fail = false;
    const flaky = stub(() => (fail ? Promise.reject(new Error("hiccup")) : readOf([READY])));
    const r2 = await shown(flaky, note(TEXT));
    expect(r2.lines().map(plain).some(l => l.includes("Jira ACME-12 · Rollout checklist"))).toBe(true);
    fail = true;
    resourceChanged(RESOURCE);
    r2.lines(); await Bun.sleep(5);
    expect(flaky.reads).toBe(2);
    expect(r2.lines().map(plain).some(l => l.includes("Jira ACME-12 · Rollout checklist"))).toBe(true);
  });

  test("repaint: a resource event for a shown projection reads it again and draws the new details; others don't", async () => {
    forgetProjectionAnswers();   // only this test's reader hears the events below
    let summary = "First summary";
    const id = "cccccccc-1111-4222-8333-444444444444";
    const b = stub(() => readOf([{ ...READY, resourceId: id, summary }]));
    const r = await shown(b, note(TEXT));
    expect(r.lines().map(plain).some(l => l.includes("First summary"))).toBe(true);
    const reads = b.reads;
    expect(resourceChanged("dddddddd-0000-4000-8000-000000000000")).toBe(false);   // not shown here
    r.lines(); await Bun.sleep(5);
    expect(b.reads).toBe(reads);
    summary = "Second summary";
    expect(resourceChanged(id)).toBe(true);
    r.lines(); await Bun.sleep(5);
    expect(b.reads).toBe(reads + 1);
    expect(r.lines().map(plain).some(l => l.includes("Second summary"))).toBe(true);
  });

  test("repaint: a projection with no Resource yet is read again after any new Resource", async () => {
    let status: ResourceProjection = CASES[6]!;
    const b = stub(() => readOf([status]));
    const r = await shown(b, note(TEXT));
    expect(r.lines().map(plain).some(l => l.includes("not registered"))).toBe(true);
    status = CASES[5]!;
    expect(resourceChanged("eeeeeeee-0000-4000-8000-000000000000")).toBe(true);
    r.lines(); await Bun.sleep(5);
    expect(r.lines().map(plain).some(l => l.includes("not fetched yet"))).toBe(true);
  });
});

// ── against a scratch service with made-up tickets ─────────────────────────────────────────────────

describe.skipIf(!outliner)("projections from a scratch service, in the board's readers", () => {
  const scratch = new Scratch();
  // `board` is the door's connection; `seeder` stands in for Detail and the person, who register and fetch.
  let board: SocketBoard, seeder: SocketBoard, app: App, b: Desk, ticketsFile = "";
  let key: (k: Key) => void = () => {};
  const n: Record<string, any> = {};
  const B = () => BV.view(b);
  const create = (parentId: string | null, text: string) => board.request<any>("create", { parentId, text, author: "agent" });
  const frame = () => b.render(B().ctx).lines.map(plain).join("\n");

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    board = new SocketBoard(await scratch.start());
    await board.info();
    seeder = new SocketBoard(scratch.sock);
    await seeder.info();
    ticketsFile = installTickets(join(scratch.root, "config"), SHOWCASE_TICKETS);
    await ticketSource(seeder);
    const hub = await create(null, "Ticket board");
    await create(hub.id, "Calls [type::virtual-branch] [query::type=call]");
    n.call = await create(null, "Vendor call ACME-12 [type::call]\nWhat we agreed.\njira:: --comments\nACME-14 is the printer one\njira:: --compact");
    n.hub = hub;
    const term = { info: { cols: 200, rows: 60, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    b = boardScreen(hub.id);
    app.push(b);
    await until(() => B().lanes[0]?.items?.length === 1, "the lane", 10_000);
  }, 30_000);
  afterAll(async () => { board?.close(); seeder?.close(); await scratch.stop(); });

  test("opening a note is the one step: the service fetches its tickets and the preview draws each from its ticket block", async () => {
    await until(() => frame().includes("Jira ACME-12 · Rollout checklist for the vendor switch"), "the ticket", 10_000);
    // ACME-14 was never registered: the open registered and fetched it too.
    await until(() => frame().includes("Jira ACME-14 · Label printer drops the last line"), "the other ticket", 10_000);
    await until(() => frame().includes("│ Steps for moving the depot to the new supplier."), "the ticket's body", 10_000);
    expect(frame()).toContain("In progress · A. Person · Spring 2 · High · Task · rollout, vendor");
    expect(frame()).toMatch(/fetched just now · r refresh/);
    // The door only reads: the fetching is the service's, asked for by the read.
    expect([...new Set(board.sent.filter(a => a.startsWith("resource")))]).toEqual(["resources.projection.read"]);
    const blocks = await board.children(n.call.id);
    expect(blocks.map(m => m.author)).toEqual(["ext:jira", "ext:jira"]);
  }, 30_000);

  test("r fetches the tickets again and the preview repaints with Jira's new text; the person's lines stay theirs", async () => {
    writeFileSync(ticketsFile, JSON.stringify({ ...SHOWCASE_TICKETS, "ACME-12": { ...SHOWCASE_TICKETS["ACME-12"]!, title: "Rollout checklist, now with dates", status: "Review", updatedAt: new Date().toISOString() } }));
    BV.at(b, "preview");
    key(char("r"));
    await until(() => frame().includes("Jira ACME-12 · Rollout checklist, now with dates"), "the refreshed ticket", 10_000);
    expect(frame()).toContain("Review · A. Person");
    expect(board.sent).toContain("resources.projection.refresh");
    const call = await board.get(n.call.id);
    expect(call!.text).toBe(n.call.text);
  }, 30_000);

  test("⏎ on the ticket's title opens its block: a header on top, the body, the comments after; its age refreshes it", async () => {
    BV.at(b, "preview");
    key({ kind: "enter" });
    await until(() => !!B().details[0]?.msg && !B().details[0].msg.partial, "the detail");
    const d = B().details[0];
    for (let i = 0; i < 12 && d.surface.describe().elements?.current?.label !== "Jira ACME-12"; i++) { key(char("]")); frame(); }
    expect(d.surface.describe().elements.current).toMatchObject({ kind: "resource", label: "Jira ACME-12" });
    key({ kind: "enter" });
    await until(() => B().details.some((x: any) => x.msg?.author === "ext:jira"), "the ticket block opened", 10_000);
    const ticket = B().details.find((x: any) => x.msg?.author === "ext:jira");
    expect(subject(ticket.msg)).toBe("Rollout checklist, now with dates");
    await until(() => frame().includes("B. Person · 2026-09-18") || frame().includes("B. Person · 2026-09-18 09:10"), "its comments", 10_000);
    expect(frame()).toContain("Van is booked for the 14th.");
    // Refused if typed into: the ticket's text is Jira's (the service says why; the draft is kept).
    await expect(board.update(ticket.msg.id, ticket.msg.text + "\nmy note", ticket.msg.revision)).rejects.toThrow("comes from Jira");
  }, 30_000);

  test("what changed leaves the extension's writes out: the +N count and the new scan, until the person asks for them", async () => {
    const all = await board.changedSince(0, 200, true);
    const people = await board.changedSince(0, 200);
    expect(all.some(m => m.author === "ext:jira")).toBe(true);
    expect(people.some(m => m.author === "ext:jira")).toBe(false);
    expect(people.map(m => m.id)).toContain(n.call.id);
    const before = { events: app.events, ext: app.extEvents };
    app.event({ domain: "content", action: "ext.jira.sync", sequence: 1, change: { sequence: 1, changeId: 1, action: "ext.jira.sync", kind: "edit", blockId: "t", actor: { author: "agent", actorId: "ext:jira" }, recordedAt: "" } } as any);
    expect(app.events).toBe(before.events);
    expect(app.extEvents).toBe(before.ext + 1);
    const { SHELL_ACTIONS } = await import("../src/screens");
    await expect(app.act({ action: "changes.extensions", as: "helper" })).rejects.toThrow("an agent reads changes itself");
    const held = app.whatChanged.extCount();
    await SHELL_ACTIONS.run("changes.extensions", { include: true }, { ctx: app as any }, { kind: "user" });
    expect(app.extensionChanges).toBe(true);
    expect(app.events).toBe(before.events + held);
    await SHELL_ACTIONS.run("changes.extensions", {}, { ctx: app as any }, { kind: "user" });
    expect(app.extensionChanges).toBe(false);
    expect(app.events).toBe(before.events);
  }, 20_000);

  test("what changed never lets extension writes push the person's own edit out of the list", async () => {
    // A fixture extension whose action writes 20 rows a call: only the service writes as ext:<id> (a client
    // naming ext:test is refused), so the rows are a real extension's writes.
    const dir = join(scratch.workspace, "extensions", "syncrows");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "extension.json"), JSON.stringify({
      contract: 2, id: "syncrows", version: 1, name: "Sync rows", run: ["bun", "sync.ts"],
      actions: [{ id: "sync", label: "Sync rows", on: "block", effects: "write" }],
    }));
    writeFileSync(join(dir, "sync.ts"), `const r = await Bun.stdin.json();
const at = r.input.target.blockId;
process.stdout.write(JSON.stringify({ ok: true, value: { writes: Array.from({ length: 20 }, (_, i) => ({ op: "create", parentId: at, text: "Made-up synced row " + i })) } }));`);
    const end = Date.now() + 15_000;
    while (!(await board.listExtensions(true))?.extensions.some(e => e.id === "syncrows" && e.state === "active") && Date.now() < end) await Bun.sleep(100);
    const rows = await board.request<any>("create", { parentId: null, text: "Synced rows", author: "user" });
    const since = Date.now() - 1;
    const mine = await board.request<any>("create", { parentId: null, text: "Sort the seed packets", author: "user" });
    // Many more extension writes after it than the list's first page holds (a poll that refreshed a lot).
    for (let i = 0; i < 6; i++) expect((await board.actExtension("syncrows", "sync", { blockId: rows.id })).written).toHaveLength(20);
    const first = await board.changedSince(since, 40);
    expect(first.map(m => m.id)).toContain(mine.id);
    expect(first.some(m => m.author === "ext:syncrows")).toBe(false);
    expect((await board.changedSince(since, 40, true)).some(m => m.author === "ext:syncrows")).toBe(true);
  }, 30_000);

  test("a second note asking for the same ticket shows the one ticket block, and its age refreshes through that block", async () => {
    const ticket = (await board.children(n.call.id)).find(m => m.author === "ext:jira" && subject(m).startsWith("Rollout checklist"))!;
    expect(ticket).toBeDefined();
    const followUp = await create(null, "Depot follow-up\nACME-12 again\njira::");
    let read: ResourceProjectionRead | undefined;
    const end = Date.now() + 10_000;
    do { read = await board.readResourceProjections(followUp.id); if (read.projections[0]?.record) break; await Bun.sleep(50); } while (Date.now() < end);
    const p = read!.projections[0]!;
    expect(p.record?.blockId).toBe(ticket.id);
    expect(await board.children(followUp.id)).toEqual([]);
    const targets: LinkTarget[] = [];
    ticketRegion(p, { record: ticket, comments: [] }, "page", 120, 0, Date.now(), (to, text) => { targets.push(to); return text; });
    expect(targets.find(t => t.refresh)).toMatchObject({ refresh: ticket.id });
    expect(targets.find(t => t.refresh)?.refreshLine).toBeUndefined();
    expect(targets.find(t => t.block)).toMatchObject({ block: ticket.id });
  }, 30_000);
});

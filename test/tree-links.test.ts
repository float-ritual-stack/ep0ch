// The outline tree's authored links (PIE-324, PIE-329 in the outliner's Tree): `L` (`tree.links`) shows a
// row's outlinks, resources and backlinks, grouped; ⏎ or a click opens a link where the tree's opens go; on a
// resource it shows what the service stores, registering it first when it must. By keys, the mouse and
// `act`; an agent's never moves the person's selection or keys. The words are checked without a service; the
// rest against a throwaway outliner (never a real outline), with fictional notes and a made-up ticket.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { App } from "../src/app";
import {
  isOutlineNote, outlinkWords, resourceNote, resourceWords, SHOWN_LIMIT,
  type AuthoredOutlink, type AuthoredResourceLink, type ResourceDescription,
} from "../src/authored";
import type { Msg } from "../src/board";
import { Desk } from "../src/desk/desk";
import type { ReaderPane } from "../src/desk/panes";
import type { TreePane } from "../src/desk/tree";
import { MainMenu } from "../src/screens";
import { installTickets, SHOWCASE_TICKETS, ticketSource } from "../src/showcase/tickets/install";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { outliner, Scratch, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*m/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "");
const span = { start: 0, end: 1 };
const outlink = (label: string, resolution: AuthoredOutlink["resolution"], extra: Partial<AuthoredOutlink> = {}): AuthoredOutlink =>
  ({ kind: "outlink", key: label, label, firstSpan: span, occurrenceCount: 1, referenceKind: "work-id", resolution, ...extra });
const ready = (title: string, fragmentId?: string): AuthoredOutlink["resolution"] => ({ kind: "ready", target: { kind: "block", blockId: "aaaaaaaa-1111", ...(fragmentId ? { fragmentId } : {}) }, title });

describe("the rows' words, as the outliner's Tree says them", () => {
  test("PIE-329: a label that repeats its target's Work ID or title reads once; a different one keeps both", () => {
    expect(outlinkWords(outlink("HOME-7", ready("HOME-7 — Oil the hinges"))).text).toBe("HOME-7 — Oil the hinges");
    expect(outlinkWords(outlink("Oil the hinges", ready("Oil the hinges"))).text).toBe("Oil the hinges");
    // A Work ID needs a token boundary: HOME-7 isn't HOME-71.
    expect(outlinkWords(outlink("HOME-7", ready("HOME-71 — Paint the gate"))).text).toBe("HOME-7 → HOME-71 — Paint the gate");
    expect(outlinkWords(outlink("the shed list", ready("Tool shed inventory"), { referenceKind: "block" })).text).toBe("the shed list → Tool shed inventory");
  });

  test("the dim context: fragment, reference kind, occurrences; a page not registered or a missing target says so", () => {
    expect(outlinkWords(outlink("plan", ready("Garden plan", "beds"), { referenceKind: "block", occurrenceCount: 2 })).context).toBe("^beds · block · 2 occurrences");
    const page = outlinkWords(outlink("Nowhere yet", { kind: "unregistered-page", address: "Nowhere yet", reason: "Page is not registered" }));
    expect(page).toMatchObject({ context: "page not registered", problem: true });
    expect(outlinkWords(outlink("x", { kind: "missing", reason: "Block is missing" }))).toMatchObject({ context: "unavailable: Block is missing", problem: true });
    expect(outlinkWords(outlink("old", { kind: "deleted", blockId: "b", title: "Old plan", reason: "in Trash" })).context).toStartWith("Trash");
  });

  test("a resource: a file reads as its name, the rest is context; one not registered says ⏎ registers it", () => {
    const file: AuthoredResourceLink = { kind: "resource", key: "k", label: "notes/compost.md", firstSpan: span, occurrenceCount: 1, resolution: { kind: "unregistered", reference: { kind: "filesystem", path: "notes/compost.md" }, reason: "File is not registered" } };
    expect(resourceWords(file)).toMatchObject({ text: "compost.md", context: "not registered · ⏎ registers and shows it · notes", problem: false });
    const ticket: AuthoredResourceLink = { ...file, label: "ACME-12", resolution: { kind: "ready", target: { kind: "resource", resourceId: "r1" }, sourceName: "Tickets (made up)", provider: "jira", addressLabel: "ACME-12" } };
    expect(resourceWords(ticket)).toMatchObject({ text: "ACME-12", context: "Tickets (made up) · jira" });
    expect(resourceWords({ ...file, resolution: { kind: "missing", reason: "No Jira Source is configured for ACME-9" } }).problem).toBe(true);
  });

  const desc = (over: Partial<ResourceDescription>): ResourceDescription => ({
    resource: { id: "r1", provider: "filesystem", mediaType: null, address: { kind: "filesystem", path: "notes/compost.md" }, createdAt: "2026-09-01T10:00:00.000Z", updatedAt: "2026-09-01T10:00:00.000Z" },
    source: { id: "s1", name: "Filesystem · notes", provider: "filesystem" }, ...over,
  });

  test("a Resource as a note: Markdown as it is, other files fenced, a ticket's fields, or that nothing is stored; never a block", () => {
    const md = resourceNote(desc({ filesystem: { text: "# Compost rota\n- Turn it on Saturdays.", capturedAt: "2026-09-01T10:00:00.000Z" } }));
    expect(md.id).toBe("resource:r1");
    expect(md.text.split("\n")[0]).toBe("compost.md");
    expect(md.text).toContain("# Compost rota\n- Turn it on Saturdays.");
    expect(isOutlineNote(md)).toBe(false);
    const ts = resourceNote(desc({ resource: { ...desc({}).resource, address: { kind: "filesystem", path: "tools/rota.ts" } }, filesystem: { text: "export const day = 6;\n", capturedAt: "2026-09-01T10:00:00.000Z" } }));
    expect(ts.text).toContain("```ts\nexport const day = 6;\n```");
    const ticket = resourceNote(desc({
      resource: { ...desc({}).resource, provider: "jira", address: { kind: "jira", key: "ACME-12", entityId: "1012" } },
      source: { id: "s2", name: "Tickets (made up)", provider: "jira" },
      remoteEntity: { title: "Rollout checklist", markdown: "# Rollout checklist\n\nSteps for the depot.", externalUrl: "https://tickets.example.test/browse/ACME-12", metadata: { key: "ACME-12", status: "In progress", labels: ["rollout"], assignee: null } },
    }));
    expect(ticket.text.split("\n")[0]).toBe("ACME-12 · Rollout checklist");
    expect(ticket.text).toContain("status In progress · labels rollout\n\nSteps for the depot.");
    expect(resourceNote(desc({ resource: { ...desc({}).resource, provider: "jira", address: { kind: "jira", key: "ACME-3" } }, source: { id: "s2", name: "Tickets (made up)", provider: "jira" } })).text).toContain("Nothing is stored for this Resource yet.");
    expect(isOutlineNote({ id: "file:/x", text: "", parentId: null, childIds: [], createdAt: 0, updatedAt: 0, author: "file", props: {} })).toBe(false);
  });

  const at = "2026-09-01T10:00:00.000Z";
  const fileAt = (path: string, text: string | null, over: Partial<ResourceDescription> = {}) =>
    resourceNote(desc({ resource: { ...desc({}).resource, address: { kind: "filesystem", path } }, filesystem: text === null ? null : { text, capturedAt: at }, ...over }));

  test("a binary file says so instead of drawing its bytes", () => {
    const png = fileAt("pics/gate.png", "\uFFFDPNG\r\n\u001a\n\u0000\u0000\u0000\rIHDR\u0000\u0000", { resource: { ...desc({}).resource, mediaType: "image/png", address: { kind: "filesystem", path: "pics/gate.png" } } });
    expect(png.text).toContain("A binary file (image/png): the door shows text files only.");
    expect(png.text).not.toContain("IHDR");
  });

  test("terminal controls in a file never reach the terminal; tabs read as spaces", () => {
    const note = fileAt("logs/run.txt", "ok\u001b]0;renamed\u0007 then\u001b[2J cleared\tdone\r\n");
    expect(note.text).not.toMatch(/[\x00-\x08\x0b-\x1f\x7f]/);
    expect(note.text).toContain("ok]0;renamed then[2J cleared  done");
  });

  test("a long file is cut at a line and says how much is shown; a fence in the file doesn't close the door's", () => {
    const long = Array.from({ length: 30_000 }, (_, i) => `line ${i + 1} of the seed catalogue`).join("\n");
    const note = fileAt("notes/catalogue.txt", long);
    expect(note.text.length).toBeLessThan(SHOWN_LIMIT + 1000);
    expect(note.text).toMatch(/Showing the first [\d,]+ of 30,000 lines/);
    const fenced = fileAt("notes/howto.txt", "before\n```\ninside\n```\nafter\n");
    expect(fenced.text).toContain("````txt\nbefore\n```\ninside\n```\nafter\n````");
  });

  test("a registered file the service can't read now says why; a policy that denies reading says so", () => {
    expect(fileAt("notes/gone.md", null).text).toContain("The file can't be read now: it's gone, isn't a regular file, or is over 2 MiB.");
    expect(fileAt("notes/secret.md", null, { source: { id: "s1", name: "Filesystem · notes", provider: "filesystem", policy: { deniedCapabilities: ["read"] } } }).text)
      .toContain("doesn't let Filesystem · notes be read");
  });
});

describe.skipIf(!outliner)("the tree's links, against a scratch outline", () => {
  const scratch = new Scratch();
  let board: SocketBoard, app: App, desk: Desk;
  let key: (k: Key) => void = () => {};
  const n = {} as Record<"log" | "soil" | "shed" | "plan" | "notes", Msg>;
  let file = "";
  const D = () => desk as any;
  const tree = () => [...D().panes.values()].find((p: any) => p.kind === "tree") as TreePane;
  const reader = () => [...D().panes.values()].find((p: any) => p.kind === "reader") as ReaderPane;
  const rows = () => tree().describe().rows;
  const rowOf = (text: string, from = 0) => { const r = rows().find(x => x.n > from && x.text.includes(text)); if (!r) throw new Error(`no row "${text}" in:\n${rows().map(x => `${x.n} ${"  ".repeat(x.depth)}${x.text}`).join("\n")}`); return r; };
  const focusName = () => D().nameOf(D().focus) as string;
  const message = () => (app as any).message as string;
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  /** Select the row drawing `text`, as j and k would. */
  const selectRow = (text: string) => tree().selectRow(rowOf(text).n - 1, desk);
  const lines = () => desk.render(D().ctx).lines.map(plain);
  const treeRect = () => { desk.render(D().ctx); return D().placed.rects.get([...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0]); };
  const clickTree = (text: string, mark = false) => {
    const r = treeRect(), ls = lines();
    for (let y = r.row; y < r.row + r.rows; y++) {
      const l = ls[y]!.slice(r.col, r.col + r.cols), x = l.indexOf(text);
      if (x < 0) continue;
      const at = { x: r.col + (mark ? x - 2 : x + 1) + 1, y };
      press({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
      press({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y });
      return;
    }
    throw new Error(`"${text}" isn't drawn in the tree`);
  };
  /** A click on row `n` (as peek numbers them): on its mark, or on its text. */
  const clickRow = (n: number, mark = false) => {
    const r = treeRect(), row = rows()[n - 1]!;
    // Inside the frame: its first row and column are the border's. A mouse x counts from 1, as `where` gives it.
    const at = { x: r.col + 1 + row.depth * 2 + (mark ? 0 : 3) + 1, y: r.row + 1 + n - 1 - (tree() as any).top };
    press({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
    press({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y });
  };
  const shows = (id: string) => until(() => reader().msg?.id === id, `the reader on ${id}`, 8000);

  beforeAll(async () => {
    process.env.EP0CH_STATE = join(scratch.root, "door");
    installTickets(join(scratch.root, "config"), SHOWCASE_TICKETS);
    board = new SocketBoard(await scratch.start());
    await board.info();
    await ticketSource(board);
    mkdirSync(join(scratch.workspace, "notes"), { recursive: true });
    file = join(scratch.workspace, "notes", "compost.md");
    writeFileSync(file, "# Compost rota\n\n- Turn the heap on Saturdays.\n- [ ] Buy a second fork\n");
    writeFileSync(join(scratch.workspace, "notes", "gone.md"), "soon gone\n");
    const create = (parentId: string | null, text: string) => board.createBlock(parentId, text);
    n.log = await create(null, "Allotment log");
    n.soil = await create(n.log.id, "Soil test results [page::soil-test]\nA little low on nitrogen.");
    n.shed = await create(n.log.id, "Tool shed inventory\nTwo spades and a fork.");
    n.plan = await create(n.log.id, `Weekend plan\nCheck [[soil-test]] and ((${n.shed.id}|the shed list)).\nCompost: [file::notes/compost.md] and [file::notes/gone.md]\nThe van is [jira::ACME-12].`);
    n.notes = await create(n.log.id, `Compost notes\nSee ((${n.plan.id})) for when.`);
    const term = { info: { cols: 180, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, board, Date.now(), () => {});
    board.subscribe(e => app.event(e));
    app.push(new MainMenu());
    desk = new Desk();
    app.push(desk);
    await until(() => rows().length > 0, "the tree's top level", 8000);
    await tree().reveal(n.plan, desk);
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
  }, 40_000);

  afterAll(async () => { board?.close(); await scratch.dispose(); delete process.env.EP0CH_STATE; }, 20_000);

  test("L shows a row's outlinks, resources and backlinks, grouped as the Tree groups them; L again hides them", async () => {
    selectRow("Weekend plan");
    ch("L");
    await until(() => rows().some(r => r.text.startsWith("← backlinks (1)")) && rows().some(r => r.text.startsWith("→ outlinks (2)")), "the groups");
    const shown = rows().filter(r => r.depth > 1 && r.n > rowOf("Weekend plan").n && r.n < rows().find(x => x.kind === "block" && x.text === "Compost notes")!.n).map(r => `${"  ".repeat(r.depth - 2)}${r.text}${r.context ? ` · ${r.context}` : ""}`);
    expect(shown.slice(0, 4)).toEqual(["→ outlinks (2)", "  soil-test → Soil test results · page", "  the shed list → Tool shed inventory · block", "♦ resources (3)"]);
    expect(shown).toContain("  compost.md · not registered · ⏎ registers and shows it · notes");
    expect(shown.some(s => s.startsWith("  ACME-12 · not registered"))).toBe(true);
    expect(shown).toContain("    Compost notes · Allotment log · block reference ×1");
    // Listing registered nothing and wrote nothing.
    expect(board.sent.filter(a => a.startsWith("resources.") || a === "update")).toEqual([]);
    const drawn = lines().join("\n");
    expect(drawn).toContain("→ outlinks (2)");
    expect(drawn).toContain("♦ resources (3)");
    ch("L");
    await until(() => !rows().some(r => r.text.startsWith("→ outlinks")), "the groups hidden");
    ch("L");
    await until(() => rows().some(r => r.text.startsWith("→ outlinks (2)")), "shown again");
  }, 20_000);

  test("space and h fold a group; l opens it; a click on a group folds it too", async () => {
    selectRow("→ outlinks");
    ch(" ");
    await until(() => !rows().some(r => r.text.startsWith("soil-test")), "outlinks folded");
    ch("l");
    await until(() => rows().some(r => r.text.startsWith("soil-test")), "outlinks open");
    ch("h");
    await until(() => !rows().some(r => r.text.startsWith("soil-test")), "folded by h");
    clickTree("→ outlinks");
    await until(() => rows().some(r => r.text.startsWith("soil-test")), "opened by a click");
  });

  test("⏎ on an outlink opens its note in the reader and gives it the keys; a click on one opens it too", async () => {
    selectRow("soil-test → Soil test results");
    press({ kind: "enter" });
    await shows(n.soil.id);
    expect(focusName()).toBe("reader");
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    clickTree("the shed list → Tool shed");
    await shows(n.shed.id);
  });

  test("l on a link to a note shows that note's links beneath it, one hop (A → B → A by hand); h hides them", async () => {
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    selectRow("the shed list → Tool shed");
    ch("l");
    const shed = () => rowOf("the shed list → Tool shed");
    await until(() => rows().some(r => r.n > shed().n && r.depth === shed().depth + 1 && r.text === "← backlinks (1)"), "the shed's own backlinks");
    // Its backlink is the Weekend plan: a click on its mark shows the plan's links again, a level down.
    clickRow(rowOf("Weekend plan", shed().n).n, true);
    await until(() => rows().filter(r => r.text === "→ outlinks (2)").length === 2, "the plan's links again, nested");
    selectRow("the shed list → Tool shed");
    ch("h");
    await until(() => rows().filter(r => r.text === "→ outlinks (2)").length === 1, "the nested links hidden");
  }, 20_000);

  test("⏎ on a file resource registers it (one step) and shows its stored text; the next ⏎ doesn't register again", async () => {
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    selectRow("compost.md");
    const before = board.sent.length;
    press({ kind: "enter" });
    await until(() => reader().msg?.id.startsWith("resource:") ?? false, "the resource in the reader", 8000);
    expect(board.sent.slice(before)).toEqual(expect.arrayContaining(["resources.follow-authored", "resources.describe"]));
    expect(reader().msg!.text).toContain("- Turn the heap on Saturdays.");
    expect(message()).toContain("compost.md registered and shown");
    // A Resource isn't a block: its checkbox isn't asked about as an outline step.
    desk.render(D().ctx);
    await Bun.sleep(100);
    expect(board.sent.slice(before)).not.toContain("checklist.query");
    await until(() => rowOf("compost.md").context?.includes("filesystem") ?? false, "the row says it's registered");
    // A Resource is read, never edited.
    expect(reader().readOnly).toBe(true);
    ch("e");
    expect(reader().draft).toBeNull();
    expect(message()).toContain("isn't a note in the outline");
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    selectRow("compost.md");
    const again = board.sent.length;
    press({ kind: "enter" });
    await until(() => board.sent.slice(again).includes("resources.describe"), "read again");
    expect(board.sent.slice(again)).not.toContain("resources.follow-authored");
  }, 20_000);

  test("⏎ on a made-up ticket registers it through its Source, fetches it once, and shows it", async () => {
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    selectRow("ACME-12");
    const before = board.sent.length;
    press({ kind: "enter" });
    await until(() => reader().msg?.text.startsWith("ACME-12 · Rollout checklist for the vendor switch") ?? false, "the ticket in the reader", 10_000);
    expect(board.sent.slice(before)).toEqual(expect.arrayContaining(["resources.follow-authored", "resources.describe", "resources.refresh"]));
    expect(reader().msg!.text).toContain("status In progress");
  }, 20_000);

  test("a file that can't be read says why; nothing opens", async () => {
    rmSync(join(scratch.workspace, "notes", "gone.md"));
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    const was = reader().msg?.id;
    selectRow("gone.md");
    press({ kind: "enter" });
    await until(() => message().startsWith("couldn't show"), "the refusal", 8000);
    expect(reader().msg?.id).toBe(was);
  }, 15_000);

  test("an agent's tree.links and tree.pick never move the person's selection or keys, and are said on screen", async () => {
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "reader")![0];
    selectRow("Tool shed inventory");
    const selected = () => tree().describe().selected?.key;
    const was = selected();
    const out = await app.act({ action: "tree.links", args: { id: n.soil.id }, as: "walker-7" }) as any;
    expect(out).toMatchObject({ tile: "tree", shown: true });
    expect(message()).toContain("an agent (walker-7) showed the links under row");
    await until(() => rows().some(r => r.n > rowOf("Soil test results").n && r.text === "← backlinks (1)" && r.depth === 2), "the soil test's backlinks");
    expect(selected()).toBe(was);
    const r = rowOf("compost.md");
    const opened = await app.act({ action: "tree.pick", args: { n: r.n, open: true }, as: "walker-7" }) as any;
    expect(opened.resource).toBeString();
    expect(selected()).toBe(was);
    expect(focusName()).toBe("reader");
    expect(message()).toContain("an agent (walker-7) opened row");
    // Refusals say why: a group has no links, a row past the end isn't there.
    await expect(app.act({ action: "tree.links", args: { n: rowOf("♦ resources").n }, as: "walker-7" })).rejects.toThrow("only a note has links to show");
    await expect(app.act({ action: "tree.pick", args: { n: 999 }, as: "walker-7" })).rejects.toThrow("no row 999");
  }, 20_000);

  test("in a reader, a resource token the service names is a link: a click shows the Resource", async () => {
    await app.act({ action: "open", args: { id: n.plan.id }, as: "walker-7" });
    await until(() => reader().msg?.id === n.plan.id && !reader().msg!.partial, "the plan in the reader");
    const rect = () => { desk.render(D().ctx); return D().placed.rects.get([...D().panes.entries()].find(([, p]: any) => p.kind === "reader")![0]); };
    const find = () => { const r = rect(), ls = lines(); for (let y = r.row; y < r.row + r.rows; y++) { const x = ls[y]!.indexOf("file::notes/compost.md"); if (x >= r.col) return { x: x + 2, y }; } return null; };
    await until(() => !!find() && !lines().join("\n").includes("[file::notes/compost.md]"), "the token drawn as a link (no brackets)", 8000);
    const at = find()!;
    press({ kind: "mouse", action: "down", button: 0, x: at.x, y: at.y });
    press({ kind: "mouse", action: "up", button: 0, x: at.x, y: at.y });
    await until(() => reader().msg?.id.startsWith("resource:") ?? false, "the resource from the token", 8000);
    expect(reader().msg!.text).toContain("Compost rota");
  }, 20_000);
  test("the short-lived Detail client is dropped after every read: a success, a refusal, a missing Resource", async () => {
    const detailsNow = async () => (await board.callers()).filter(c => c.id.includes("-resource-")).length;
    expect(await detailsNow()).toBe(0);
    const reg = await board.followAuthored({ kind: "filesystem", path: "notes/compost.md" });
    await board.describeResource(reg.id, true);
    await expect(board.describeResource("00000000-0000-4000-8000-00000000dead", true)).rejects.toThrow();
    await expect(board.refreshResource(reg.id)).rejects.toThrow();
    let left = -1;
    for (let t = Date.now(); Date.now() - t < 5000 && left !== 0; await Bun.sleep(50)) left = await detailsNow();
    expect(left).toBe(0);
  }, 15_000);

  test("a registered file that goes missing says it can't be read, not that nothing is stored", async () => {
    const path = join(scratch.workspace, "notes", "fleeting.md");
    writeFileSync(path, "here for now\n");
    const reg = await board.followAuthored({ kind: "filesystem", path: "notes/fleeting.md" });
    rmSync(path);
    const d = await board.describeResource(reg.id, true);
    expect(resourceNote(d).text).toContain("The file can't be read now");
  }, 15_000);

  test("an agent never folds away the rows the person's selection is in", async () => {
    D().focus = [...D().panes.entries()].find(([, p]: any) => p.kind === "tree")![0];
    const plan = () => rows().find(r => r.kind === "block" && r.text === "Weekend plan")!;
    await app.act({ action: "tree.links", args: { n: plan().n, show: true }, as: "walker-7" });
    await until(() => !!rows().find(r => r.n > plan().n && r.text.startsWith("→ outlinks (2)")), "the plan's links");
    tree().selectRow(rowOf("soil-test → Soil test results", plan().n).n - 1, desk, false);
    const was = tree().describe().selected?.key;
    expect(was).toStartWith(`b:${n.plan.id} > outlinks`);
    await expect(app.act({ action: "tree.links", args: { n: plan().n, show: false }, as: "walker-7" })).rejects.toThrow("an agent doesn't fold it away");
    await expect(app.act({ action: "tree.pick", args: { n: rowOf("→ outlinks", plan().n).n, open: true }, as: "walker-7" })).rejects.toThrow("an agent doesn't fold it away");
    expect(tree().describe().selected?.key).toBe(was);
    // The person's own L still hides them, and their selection goes to the row the links were under.
    tree().selectRow(plan().n - 1, desk, false);
    ch("L");
    await until(() => rows()[plan().n]?.kind === "block", "the plan's links hidden");
  }, 15_000);
});

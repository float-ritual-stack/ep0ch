// EchoNet's message areas (PIE-779): the areas of every outline on the door's host (a subscription's source boards and
// the named views and tags that start there), their counts and new messages (`unread:me`), the message list, the reader with GoldED's
// header and the FidoNet footer, ] [ stepping and marking read, r and q in the shared composer, an agent's act, and
// the nodelist. A scratch host with two outlines; the network, its nodes and its messages are made up.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { App } from "../src/app";
import type { Msg } from "../src/board";
import type { Desk } from "../src/desk/desk";
import { openScreen } from "../src/desk/screen-specs";
import { areasIn, footerOf, fromOf, headerOf, isMessage, messageFrom, nodelistLines, nodesOf, parseFrom, postsTo, seenBy, seenByMarks, tossOf, upstreamNewer } from "../src/echonet/net";
import { banner, quoteLines, type EchoAreas, type EchoMessages, type EchoReader } from "../src/echonet/screen";
import { SocketBoard } from "../src/socket";
import type { Key } from "../src/term";
import { hostOutliner, ScratchHost, until } from "./scratch";

const plain = (s: string) => s.replace(/\x1b\[[\d;]*[A-Za-z]/g, "").replace(/[\u{100000}-\u{10FFFD}]/gu, "").replace(/\|\d\d/g, "");
const msg = (id: string, text: string, props: Record<string, string>, createdAt = 1, parentId: string | null = null): Msg =>
  ({ id, text, parentId, childIds: [], createdAt, updatedAt: createdAt, author: "agent:echo-tosser", props, properties: Object.entries(props).map(([key, value]) => ({ key, value })) });

describe("the shapes", () => {
  const sub = msg("5ab0c2d4-0000-4000-8000-000000000001", "Cafe chat [subscribe::cafe@box-a] [echo::cafe.chat]", { subscribe: "cafe@box-a", echo: "cafe.chat" });
  const board = msg("5ab0c2d4-0000-4000-8000-000000000002", "cafe@box-a [echo-source::cafe@box-a] [waiting::4]", { "echo-source": "cafe@box-a", waiting: "4" }, 1, sub.id);
  const area = areasIn([sub], [sub], [board], "shack", "box-b")[0]!;
  test("a source board under a subscription is an area, its messages the copies on it; a named view and a tag are a local one", () => {
    expect(area).toMatchObject({ kind: "sub", tag: "cafe.chat", name: "Cafe chat", origin: "cafe@box-a", node: "shack@box-b", queries: [`parent:((${board.id})) from`], tagged: null, waiting: 4 });
    const view = msg("6", "Shack chat [echo::shack.chat] [query::type=shack-post]", { echo: "shack.chat", query: "type=shack-post" });
    // A tag's value can be a list: it posts to each; a note posted only to a name makes that name an area.
    const posted = msg("7", "Roof leak [echo::shack.chat, porch.chat]", { echo: "shack.chat, porch.chat" });
    const copy = msg("8", "A copy", { from: "cafe@box-a/0a1b2c3d-1111-4222-8333-444455556666", echo: "shack.chat" });
    const local = areasIn([view, posted, copy, sub], [sub], [board], "shack", "box-b");
    expect(local.map(a => [a.kind, a.tag, a.name, a.queries, a.tagged])).toEqual([
      ["local", "porch.chat", "porch.chat", [], "porch.chat"],
      ["local", "shack.chat", "Shack chat", ["parent:((6)) OR (type=shack-post)"], "shack.chat"],
      ["sub", "cafe.chat", "Cafe chat", [`parent:((${board.id})) from`], null],
    ]);
    expect([view, posted, copy, sub, board].map(isMessage)).toEqual([false, true, false, false, false]);
    expect(postsTo(posted, "PORCH.CHAT")).toBe(true);
    expect(fromOf(msg("9", "x", { from: "karen" }))).toBeNull();
  });
  test("a copy's footer: the tear line, its origin and area, SEEN-BY from its seen-by marks; its header says when upstream is newer", () => {
    const copy = msg("c1", "Frost tonight\nCover the beans.", { from: "cafe@box-a/0a1b2c3d-1111-4222-8333-444455556666", echo: "cafe.chat", "from-rev": "2", tossed: "2026-10-11T05:12:00Z", "upstream-newer": "3", by: "fern" });
    expect(parseFrom(copy.props.from)).toEqual({ node: "cafe@box-a", id: "0a1b2c3d-1111-4222-8333-444455556666" });
    const marked = seenByMarks([{ props: { kind: ["echo-seen-by"], "echo.node": ["attic@box-c"] } }, { props: { kind: ["note"] } }, {}]);
    expect(marked).toEqual(["attic@box-c"]);
    expect(seenBy(copy, area, marked)).toEqual(["cafe@box-a", "shack@box-b", "attic@box-c"]);
    expect(footerOf(copy, area, 80, marked).map(plain)).toEqual(["", "--- ep0ch echonet", " * Origin: cafe@box-a (Cafe chat)", "SEEN-BY: cafe@box-a shack@box-b attic@box-c"]);
    expect(upstreamNewer(copy)).toEqual({ upstream: 3, here: 2 });
    const head = headerOf({ msg: copy, n: 2, fresh: true }, 5, area).map(plain);
    expect(head[0]).toBe("Msg  : 2 of 5 new");
    expect(head[1]).toStartWith("From : fern @ cafe@box-a · ");
    expect(head[3]).toBe("Subj : Frost tonight");
    expect(head[5]).toContain("a newer version is upstream (rev 3, this copy is rev 2)");
    expect(head[6]).toBe("   take it: ext.echonet.take-newer · compare: ext.echonet.compare-newer");
    const gone = headerOf({ msg: { ...copy, props: { ...copy.props, "upstream-gone": "2026-10-12" } }, n: 2, fresh: false }, 5, area).map(plain);
    expect(gone[7]).toBe(" ! gone upstream since 2026-10-12: the original was trashed at cafe@box-a; this copy stays");
    // A copy that doesn't say who wrote it is from the outline it came from; the person's own post is the sysop's.
    const bare = msg(copy.id, copy.text, { from: copy.props.from! });
    expect(messageFrom(bare)).toBe("cafe");
    expect(plain(headerOf({ msg: bare, n: 1, fresh: false }, 5, area)[1]!)).toStartWith("From : cafe@box-a · ");
    expect(messageFrom({ ...msg(copy.id, copy.text, {}), author: "user" })).toBe("sysop");
  });
  test("the nodelist the tosser writes, as FidoNet wrote it; the banner in half blocks; a quote's > lines", () => {
    const nodes = nodesOf([
      "Nodelist [type::nodelist] [node::shack@box-b]", "", "The nodes this outline knows.", "",
      "## shack@box-b", "- this node", "- last toss: 2026-10-11T05:03:00Z", "- areas: shack.chat (Shack chat)", "- subscriptions: cafe.chat from cafe@box-a", "",
      "## cafe@box-a", "- reachable · we read its areas", "- last toss: never", "- areas: cafe.chat (Cafe chat); jams (Jam talk)", "- subscriptions: none", "",
      "## attic@box-c", "- unreachable: no forward to box-c · reads our areas", "- last toss: unknown", "- areas: unknown", "",
      "## porch@box-d", "- dials in · last call 2026-10-11 04:58 UTC · we read its porch.*", "- netmail held: 2 (its next call takes them)", "- last toss: 2026-10-11T04:58:00Z", "- areas: unknown",
    ].join("\n"));
    expect(nodes.map(n => [n.node, n.self, n.reachable, n.areas])).toEqual([["shack@box-b", true, true, ["shack.chat"]], ["cafe@box-a", false, true, ["cafe.chat", "jams"]], ["attic@box-c", false, false, []], ["porch@box-d", false, null, []]]);
    expect(nodes.map(n => [n.dialsIn, n.held, n.roles])[3]).toEqual([true, 2, "we read its porch.*"]);
    expect(nodes[2]!.why).toBe("no forward to box-c");
    const toss = tossOf(msg("t", "Toss", { type: "toss", node: "shack@box-b", at: "2026-10-11T05:03:00Z", copies: "3", "netmail-out": "1", queued: "2" }));
    const lines = nodelistLines("EchoNet", nodes, [toss], Date.UTC(2026, 9, 11)).map(plain);
    expect(lines[0]).toMatch(/^;A EchoNet Nodelist for .* -- Day number 284$/);
    expect(lines[4]).toMatch(/^, 1,shack@box-b *,HOME ,10-11-26 \(\d\d:\d\d\) *,- *,SHACK\.CHAT$/);
    expect(lines[5]).toMatch(/^, 2,cafe@box-a *,UP *,never *,- *,CAFE\.CHAT JAMS$/);
    expect(lines[6]).toMatch(/^, 3,attic@box-c *,DOWN ,never *,- *,- ; no forward to box-c$/);
    // A node that dials in is never down.
    expect(lines[7]).toMatch(/^, 4,porch@box-d *,DIAL ,10-11-26 \(\d\d:\d\d\) *,2 *,- ; 2 netmail held for its call$/);
    expect(lines.at(-1)).toMatch(/^;  10-11-26 \(\d\d:\d\d\) shack@box-b copies 3 newer 0 netmail 1 out 0 in 2 queued$/);
    expect(banner("echonet").map(plain)).toEqual(["█▀▀ █▀▀ █ █ █▀█ █▀▄ █▀▀ ▀█▀", "█▀  █   █▀█ █ █ █ █ █▀   █ ", "▀▀▀ ▀▀▀ ▀ ▀ ▀▀▀ ▀ ▀ ▀▀▀  ▀ "]);
    expect(quoteLines("Cover the beans.\n\nTonight.")).toBe("> Cover the beans.\n>\n> Tonight.\n\n");
  });
});

describe.skipIf(!hostOutliner)("the message areas screen", () => {
  const host = new ScratchHost();
  let shack: SocketBoard, cafe: SocketBoard, app: App;
  let key: (k: Key) => void = () => {};
  const press = (k: Key) => key(k);
  const ch = (c: string) => press({ kind: "char", ch: c });
  const top = () => (app as any).stack.at(-1) as Desk;
  const areas = () => top().pane("areas") as EchoAreas;
  const list = () => top().pane("messages") as EchoMessages;
  const reader = () => top().pane("reader") as EchoReader;
  const screen = () => top().render(app).lines.map(plain).join("\n");
  const focused = () => (top() as any).nameOf((top() as any).focus) as string;
  const eventually = async (ok: () => Promise<boolean>, what: string, ms = 5000) => {
    const end = Date.now() + ms;
    while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await Bun.sleep(25); }
  };
  const ids = {} as Record<"sub" | "board" | "c1" | "c2" | "c3" | "post" | "cafePost", string>;
  const unread = async (b: SocketBoard, q: string, who = "me") => (await b.queryNotes(`(${q}) unread:${who}`)).notes.map(m => m.id);

  beforeAll(async () => {
    await host.start();
    await host.create("shack");
    await host.create("cafe");
    shack = new SocketBoard(host.sock, undefined, "shack");
    cafe = new SocketBoard(host.sock, undefined, "cafe");
    await shack.info(); await cafe.info();
    // cafe is an origin: its own area; shack subscribes to it (three copies, the tosser's), and has an area of its own.
    await cafe.createBlock(null, "Cafe chat [echo::cafe.chat] [query::type=cafe-post]");
    ids.cafePost = (await cafe.createBlock(null, "Open mic on Friday [type::cafe-post]\nBring a song.")).id;
    const sub = await shack.createBlock(null, "Cafe chat [subscribe::cafe@box-a] [echo::cafe.chat] [since::all]");
    ids.sub = sub.id;
    ids.board = (await shack.createBlock(sub.id, "cafe@box-a [echo-source::cafe@box-a] [waiting::4]", { kind: "agent", id: "echo-tosser" })).id;
    const copy = (n: number, title: string, body: string, more = "") =>
      shack.createBlock(ids.board, `${title} [from::cafe@box-a/0a1b2c3d-1111-4222-8333-00000000000${n}] [echo::cafe.chat] [from-rev::1] [tossed::2026-10-11T05:0${n}:00Z] [by::${["fern", "moss", "wren"][n - 1]}]${more}\n${body}`);
    ids.c1 = (await copy(1, "Frost tonight", "Cover the beans before dark.")).id;
    ids.c2 = (await copy(2, "Seed swap Sunday", "Bring your spare runner beans.\nAnd the squash seeds.", " [upstream-newer::2]")).id;
    ids.c3 = (await copy(3, "Kettle fixed", "The cafe kettle whistles again.")).id;
    await shack.createBlock(null, "Shack chat [echo::shack.chat] [query::type=shack-post]");
    ids.post = (await shack.createBlock(null, "Roof leak [type::shack-post]\nThe bucket is under it.")).id;
    // Posted by its tag, from anywhere in the outline.
    await shack.createBlock(null, "Gate code changed [echo::shack.chat]\nAsk at the shed.");
    const nl = await shack.createBlock(null, ["Nodelist [type::nodelist] [node::shack@box-b]", "",
      "## cafe@box-a", "- reachable", "- last toss: 2026-10-11T05:03:00Z", "- areas: cafe.chat (Cafe chat)", "",
      "## attic@box-c", "- unreachable: offline (config.json's offline list)", "- last toss: unknown"].join("\n"));
    await shack.createBlock(nl.id, "Toss 2026-10-11 05:03 UTC [type::toss] [node::shack@box-b] [at::2026-10-11T05:03:00Z] [copies::3] [updated::0] [netmail-out::0] [netmail-in::0] [queued::0]");
    process.env.EP0CH_STATE = join(host.root, "door");
    const term = { info: { cols: 160, rows: 50, cellW: 9, cellH: 16, kitty: false }, write() {}, paint() {}, invalidate() {}, onKey(f: any) { key = f; }, onResize() {}, stop() {}, resume() {} };
    app = new App(term as any, shack, Date.now(), () => {});
    app.outline = "shack";
    shack.subscribe(e => app.event(e));
  }, 60_000);
  afterAll(async () => { shack?.close(); cafe?.close(); await host.dispose(); delete process.env.EP0CH_STATE; });

  test("the areas of both outlines, the door's own first: counts, new, where each comes from; the band and the nodelist", async () => {
    app.push(openScreen("echonet"));
    await until(() => (areas().areas?.length ?? 0) === 3 && areas().areas!.every(a => a.total !== null), "three areas counted", 10_000);
    expect(areas().areas!.map(a => [a.outline, a.tag, a.kind, a.total, a.fresh])).toEqual([["shack", "cafe.chat", "sub", 3, 3], ["shack", "shack.chat", "local", 2, 2], ["cafe", "cafe.chat", "local", 1, 1]]);
    const s = screen();
    expect(s).toContain("█▀▀ █▀▀ █ █ █▀█ █▀▄ █▀▀ ▀█▀");
    expect(s).toContain("─=[ MESSAGE AREAS ]=");
    expect(s).toContain("echomail across 2 outlines");
    expect(s).toMatch(/1 +CAFE\.CHAT +Cafe chat \+4 waiting +cafe@box-a +3 +3/);
    expect(s).toMatch(/,UP +,10-11-26/);
    expect(s).toMatch(/,DOWN ,never +,- +,- ; offline/);
    expect(s).toMatch(/shack@box-b copies 3 newer 0/);
    // The first area's messages beside, oldest first, all new.
    await until(() => list().items?.length === 3, "the subscription's copies listed");
    expect(screen()).toMatch(/1 ● fern +Frost tonight/);
    expect(app.describe()).toMatchObject({ screen: "echonet · message areas", state: { picked: 1, areas: expect.arrayContaining([expect.objectContaining({ tag: "cafe.chat", from: "cafe@box-a", messages: 3, new: 3 })]) } });
  });

  test("⏎ into the area, ⏎ reads a message: GoldED's header, the FidoNet footer, and it's read (unread:me)", async () => {
    press({ kind: "enter" });
    await until(() => focused() === "messages", "the keys on the message list");
    press({ kind: "enter" });
    await until(() => reader().msg?.id === ids.c1 && !reader().msg?.partial, "the first copy read");
    await until(() => screen().includes("SEEN-BY:"), "the footer drawn");
    const s = screen();
    expect(s).toContain("Msg  : 1 of 3");
    expect(s).toContain("From : fern @ cafe@box-a");
    expect(s).toContain("Subj : Frost tonight");
    expect(s).toContain("Cover the beans before dark.");
    expect(s).toContain("--- ep0ch echonet");
    expect(s).toContain(" * Origin: cafe@box-a (Cafe chat)");
    expect(s).toMatch(/SEEN-BY: cafe@box-a shack@/);
    await eventually(async () => !(await unread(shack, `parent:((${ids.board})) from`)).includes(ids.c1), "the copy marked read");
    expect(list().items![0]!.fresh).toBe(false);
    expect(areas().areas![0]!.fresh).toBe(2);
  });

  test("] and [ step the area, each read as it's shown; a newer upstream is said; the ends are said", async () => {
    ch("]");
    await until(() => reader().msg?.id === ids.c2, "the second copy");
    await until(() => screen().includes("a newer version is upstream"), "upstream said");
    expect(screen()).toContain("(rev 2, this copy is rev 1)");
    ch("]");
    await until(() => reader().msg?.id === ids.c3, "the third");
    ch("]");
    expect((app as any).message).toContain("end of CAFE.CHAT");
    ch("["); ch("[");
    await until(() => reader().msg?.id === ids.c1, "back to the first");
    ch("[");
    expect((app as any).message).toContain("this is the first message");
    await eventually(async () => (await unread(shack, `parent:((${ids.board})) from`)).length === 0, "all three read");
  });

  test("a toss that brings a message while one is read: the list grows, and ] reaches it, new", async () => {
    const c4 = await shack.createBlock(ids.board, "Jam swap [from::cafe@box-a/0a1b2c3d-1111-4222-8333-000000000004] [echo::cafe.chat] [from-rev::1] [tossed::2026-10-11T05:04:00Z] [by::fern]\nPlum, two jars.", { kind: "agent", id: "echo-tosser" });
    await until(() => list().items?.length === 4 && reader().list.length === 4, "the fourth copy listed, and in the reader's list", 8000);
    expect(reader().msg?.id).toBe(ids.c1);
    ch("]"); ch("]"); ch("]");
    await until(() => reader().msg?.id === c4.id, "the new copy read");
    expect(screen()).toContain("Msg  : 4 of 4");
    ch("["); ch("["); ch("[");
    await until(() => reader().msg?.id === ids.c1 && !reader().msg?.partial, "back on the first, read whole");
  });

  test("r opens the shared composer on the subject; q with the message quoted; an agent replies by act", async () => {
    // r: on the subject line, nothing written yet (left unchanged, esc lets it go).
    ch("r");
    await until(() => !!reader().surface.session?.composer, "the reply composer");
    expect(reader().surface.session!.composer!.text).toBe("");
    expect((reader().surface.session as any).target?.passage?.quote).toBe("Frost tonight");
    press({ kind: "esc" });
    await until(() => !reader().surface.session, "closed");
    expect(focused()).toBe("reader");
    // q: the message quoted, > before each line (left, it is put aside as unsent, as any comment is).
    ch("q");
    await until(() => !!reader().surface.session?.composer, "the composer open");
    expect(reader().surface.session!.composer!.text).toStartWith("> Cover the beans before dark.\n");
    expect((reader().surface.session as any).target?.passage?.quote).toBe("Cover the beans before dark.");
    press({ kind: "esc" }); press({ kind: "esc" });
    await until(() => !reader().surface.session, "the composer closed");
    (app as any).lastInput = 0;                                                     // the person is idle
    const r = await app.act({ action: "echo.reply", args: { body: "Covered, thanks." }, as: "test-agent" });
    expect(r).toMatchObject({ thread: expect.any(String) });
    const comments = await shack.comments(ids.c1);
    expect(comments.map(c => c.body)).toContain("Covered, thanks.");
    await expect(app.act({ action: "echo.quote", args: {}, as: "test-agent" })).rejects.toThrow(/say quote= and body=/);
  });

  test("an agent picks an area and reads in it; its read marks are its own, the person's stay; another outline's message reads there", async () => {
    (app as any).lastInput = 0;
    expect(await app.act({ action: "echo.area", args: { n: 3 }, as: "test-agent" })).toMatchObject({ tag: "cafe.chat", at: expect.stringMatching(/^cafe@/), messages: 1, new: 1 });
    await until(() => list().area?.outline === "cafe" && list().items?.length === 1, "cafe's own area listed");
    (app as any).lastInput = 0;
    expect(await app.act({ action: "echo.message", args: { n: 1, read: true }, as: "test-agent" })).toMatchObject({ id: ids.cafePost, read: true, new: true });
    await until(() => reader().msg?.id === ids.cafePost && !reader().msg?.partial, "read from the cafe outline");
    expect(screen()).toContain("Bring a song.");
    expect(screen()).toContain(" * Origin: cafe@");
    // The person hasn't read it: it stays new for them; the agent's mark is its own.
    await eventually(async () => (await unread(cafe, "type=cafe-post", "test-agent")).length === 0, "the agent's mark");
    expect(await unread(cafe, "type=cafe-post")).toEqual([ids.cafePost]);
  });

  test("a copy's SEEN-BY names the nodes marked on its original, read from the origin on the same host", async () => {
    const here = areas().machine, post = (await cafe.get(ids.cafePost))!;
    await cafe.request("annotations.batch", {
      requestId: "seen-attic", author: "agent", provenance: { actorId: "echo-tosser" },
      operations: [{ operationId: "seen", type: "block-comment", input: { blockId: post.id, expectedRevision: post.revision, source: "agent", body: "also in: attic@box-c (Cafe chat)", properties: { kind: "echo-seen-by", "echo.node": "attic@box-c" } } }],
    });
    const sub = await shack.createBlock(null, `Cafe, nearby [subscribe::cafe@${here}] [echo::cafe.near]`);
    const near = await shack.createBlock(sub.id, `cafe@${here} [echo-source::cafe@${here}]`, { kind: "agent", id: "echo-tosser" });
    await shack.createBlock(near.id, `Open mic on Friday [from::cafe@${here}/${post.id}] [echo::cafe.near] [from-rev::1] [tossed::2026-10-11T06:00:00Z]\nBring a song.`, { kind: "agent", id: "echo-tosser" });
    (app as any).lastInput = 0;
    await app.act({ action: "echo.reload", as: "test-agent" });
    (app as any).lastInput = 0;
    await app.act({ action: "echo.area", args: { tag: "cafe.near" }, as: "test-agent" });
    await until(() => list().area?.tag === "cafe.near" && list().items?.length === 1, "the nearby copy listed");
    (app as any).lastInput = 0;
    await app.act({ action: "echo.message", args: { n: 1, read: true }, as: "test-agent" });
    await until(() => screen().includes(`SEEN-BY: cafe@${here} shack@${here} attic@box-c`), "SEEN-BY with the origin's mark", 8000);
    expect(screen()).toContain(`From : cafe@${here} · `);
  });
});

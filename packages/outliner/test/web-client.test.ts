// The tailnet web client (PIE-782, with PIE-774's marginalia and PIE-775's folders): on the tailnet listener every
// note is a page, a folder that is also a file, and being on the tailnet is the sign-in for highlights, comments,
// asks, replies and resolves, which land through the service as the door's do. The public listener stays read-only
// and shows marked notes only. One scratch service (with marginalia, whose @margin answers from the note) and one
// publisher for the whole file; the outline is made up.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { ExtensionsListResult } from "../src/extension-registry";
import type { AnnotationThread, Block } from "../src/types";
import type { ReaderEvent, ReaderView } from "@ep0ch/outline-core/protocol";
import { scratchOutline } from "./scratch-outline";

const HOST = "garden.tail0000.ts.net";
let root = "";
let store: OutlinerStore;
let server: OutlinerServer;
let client: OutlinerClient;
let publisher: Publisher;
const restore: Record<string, string | undefined> = {};
let hub: Block, survey: Block, swap: Block, ledger: Block, letter: Block, twin: Block;

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-web-")));
  for (const key of ["OUTLINER_EXTENSIONS_DIR", "OUTLINER_RESOURCE_EXTENSIONS"]) restore[key] = process.env[key];
  process.env.OUTLINER_EXTENSIONS_DIR = join(root, "user-extensions");
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  const workspace = join(root, "garden");
  mkdirSync(join(workspace, "extensions"), { recursive: true });
  cpSync(join(import.meta.dir, "..", "extensions", "marginalia"), join(workspace, "extensions", "marginalia"), { recursive: true });
  const paths = scratchOutline(root, { name: "garden", folder: workspace });
  store = new OutlinerStore(paths.database, { workspaceRoot: workspace });
  server = new OutlinerServer(store, paths.socket, undefined, undefined, { extensionPollMs: 0, agentRequestQuietMs: 80 });
  await server.start();
  client = new OutlinerClient(paths.socket, 15_000);
  await client.request<ExtensionsListResult>({ action: "extensions.list", reload: true });

  hub = store.create("Field notes [page::Field Notes]\nWhat the garden did this autumn.", null, "user");
  survey = store.create([
    "Moth survey",
    "The night-scented stock drew elephant hawk-moths after dusk.",
    "",
    "Glossary",
    "- light trap — a sheet and a lamp that draws moths in to be counted.",
  ].join("\n"), hub.id, "user");
  swap = store.create("Seed swap\nBring the saved marigold seed.", hub.id, "user");
  store.create("Marigold packets\nTwelve envelopes, labelled.", swap.id, "user");
  ledger = store.create("Private ledger [publish::never]\nWhat the plots cost.", hub.id, "user");
  letter = store.create("Open letter [publish::public]\nTo the allotment committee.", null, "user");
  // A published slug and another note's page name that spell the same address.
  store.create("Plot map [publish::plots]", null, "user");
  twin = store.create("Plot rota [page::plots]", null, "user");

  publisher = new Publisher({ client, basePath: "/pub", publicUrl: "/share" });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  await server?.close();
  store?.close();
  for (const [key, value] of Object.entries(restore)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

const browser = { accept: "text/html,application/xhtml+xml" };
const get = (path: string, headers: Record<string, string> = browser, audience: "tailnet" | "public" = "tailnet") =>
  publisher.handle(new Request(`http://${HOST}${path}`, { headers: { host: HOST, ...headers } }), audience);
const page = async (path: string) => {
  const response = await get(path);
  expect(response.status).toBe(200);
  return response.text();
};
const write = (body: Record<string, unknown>, origin = `https://${HOST}`, audience: "tailnet" | "public" = "tailnet", base = "/pub") =>
  publisher.handle(new Request(`http://${HOST}${base}/_marginalia/write`, {
    method: "POST", headers: { host: HOST, origin, "content-type": "application/json" }, body: JSON.stringify(body),
  }), audience);
const threads = async (blockId: string) => {
  const response = await get(`/pub/_marginalia/threads?page=${blockId}`, {});
  expect(response.status).toBe(200);
  return (await response.json()) as { version: string; choices: { action: string }[]; threads: { id: string; kind: string; body: string; by: string; quote: string; replies: { by: string; body: string }[] }[] };
};
const view = (body: Record<string, unknown>) => publisher.handle(new Request(`http://${HOST}/pub/_marginalia/view`, {
  method: "POST", headers: { host: HOST, origin: `https://${HOST}`, "content-type": "application/json" }, body: JSON.stringify(body),
}), "tailnet");
/** An edit made through the service, as the door's are: the publisher hears of it. */
async function edit(block: Block, text: string): Promise<void> {
  const revision = store.get(block.id)!.revision;
  await client.request({ action: "update", blockId: block.id, text, expectedRevision: revision, mutation: { author: "user" } });
}
const hrefs = (html: string) => [...html.matchAll(/href="([^"]*)"/g)].map((match) => match[1]!.replace(/&amp;/g, "&"));

async function until<T>(what: string, check: () => Promise<T | undefined | null | false>, ms = 10_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await Bun.sleep(50);
  }
}

test("browse: the top level, into a note by its page name, into a child by its id, and back up the breadcrumbs", async () => {
  const top = await page("/pub/");
  expect(top).toMatch(/<h1>[^<]+<\/h1>/);
  // Every note is a page, published or not: the hub by its page name.
  expect(hrefs(top)).toContain("/pub/p/Field%20Notes");
  // The published slug keeps its address; the note whose page name spells it is linked by id.
  expect(hrefs(top)).toEqual(expect.arrayContaining(["/pub/p/plots", `/pub/p/${twin.id}`]));
  expect(await page(`/pub/p/${twin.id}`)).toContain(`data-page="${twin.id}"`);

  const folder = await page("/pub/p/Field%20Notes");
  // The file: its own text. The folder: its children as links with a summary line, the grandchild only counted.
  expect(folder).toContain("What the garden did this autumn.");
  expect(hrefs(folder)).toContain(`/pub/p/${survey.id}`);
  expect(hrefs(folder)).toContain(`/pub/p/${swap.id}`);
  expect(folder).toContain("The night-scented stock drew elephant hawk-moths after dusk.");
  expect(folder).toContain("1 note");
  expect(folder).not.toContain("Twelve envelopes");
  // A [publish::never] child is a locked row: no link, no title, no text.
  expect(folder).toContain("locked note");
  expect(folder).not.toContain("Private ledger");
  expect(hrefs(folder)).not.toContain(`/pub/p/${ledger.id}`);

  const child = await page(`/pub/p/${swap.id}`);
  expect(child).toContain("Bring the saved marigold seed.");
  // Breadcrumbs: the outline, then the hub (back), then this note.
  const crumbs = child.match(/<nav class="crumbs">([\s\S]*?)<\/nav>/)![1]!;
  expect(hrefs(crumbs)).toEqual(["/pub/", "/pub/p/Field%20Notes"]);
  expect(crumbs).toContain("Seed swap");

  // The old all-in-one page, and the Markdown for anything that isn't a browser.
  expect(await page(`/pub/p/Field%20Notes?view=full`)).toContain("Twelve envelopes");
  const markdown = await get(`/pub/p/${swap.id}`, {});
  expect(markdown.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
  expect(await markdown.text()).toContain("Bring the saved marigold seed.");

  // The lock still wins on its own address, and the page runs only the publisher's own reader script.
  expect((await get(`/pub/p/${ledger.id}`)).status).toBe(404);
  const csp = (await get(`/pub/p/${swap.id}`)).headers.get("content-security-policy")!;
  expect(csp).toContain("script-src 'self'");
  expect(csp).not.toContain("unsafe-eval");
});

test("highlight, comment, an answered ask, reply and resolve land in the outline, attributed to the person", async () => {
  const words = { page: survey.id, quote: "elephant hawk-moths", prefix: "The night-scented stock drew ", suffix: " after dusk." };
  const choices = (await threads(survey.id)).choices.map((choice) => choice.action);
  expect(choices).toEqual(expect.arrayContaining(["highlight", "comment", "ask", "copy"]));

  const highlighted = await write({ ...words, action: "highlight", requestId: "highlight-0001" });
  expect(highlighted.status).toBe(200);
  // The page draws it on its words, carrying its thread's id for the reader script.
  expect(await page(`/pub/p/${survey.id}`)).toMatch(/<mark class="ann[^"]*" data-ann="[^"]+" data-kind="highlight"[^>]*>elephant hawk-moths<\/mark>/);

  const commented = await (await write({ ...words, action: "comment", body: "Count them again in October.", requestId: "comment-0001" })).json();
  expect(commented).toMatchObject({ ok: true });
  const listed = await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: survey.id }, includeResolved: false } });
  const comment = listed.find((thread) => thread.block.id === commented.thread)!;
  // The same thread the door reads: on the exact words, the person's.
  expect(comment.body).toBe("Count them again in October.");
  expect(comment.block.author).toBe("user");
  expect(comment.resolvedTarget?.anchor).toMatchObject({ kind: "text-quote", exact: "elephant hawk-moths" });

  const asked = await (await write({ page: survey.id, action: "ask", quote: "light trap", body: "what is this?", requestId: "ask-0000001" })).json();
  expect(asked.ok).toBe(true);
  const answered = await until("the margin's answer", async () =>
    (await threads(survey.id)).threads.find((thread) => thread.id === asked.thread && thread.replies.some((reply) => reply.by === "marginalia")));
  expect(answered.body).toBe("@margin what is this?");

  expect((await write({ page: survey.id, action: "reply", thread: commented.thread, body: "And note the weather.", requestId: "reply-00001" })).status).toBe(200);
  const replied = (await threads(survey.id)).threads.find((thread) => thread.id === commented.thread)!;
  expect(replied.replies.map((reply) => [reply.by, reply.body])).toEqual([["you", "And note the weather."]]);
  expect((await write({ page: survey.id, action: "resolve", thread: commented.thread })).status).toBe(200);
  expect((await threads(survey.id)).threads.some((thread) => thread.id === commented.thread)).toBe(false);

  // Words that can't be placed still land: on the whole note, quoted.
  const stray = await (await write({ page: survey.id, action: "comment", quote: "words that are not here", body: "Keep this anyway.", requestId: "stray-00001" })).json();
  expect(stray).toMatchObject({ ok: true, landed: "note" });
});

test("a mark is a page and a block: quote a comment and a highlight into the Inbox, follow the links both ways, undo once", async () => {
  const beds = store.create("Raised beds\nThe north bed holds frost longest.\nMulch it before November.", hub.id, "user");
  const highlight = (await (await write({ page: beds.id, action: "highlight", quote: "holds frost longest", requestId: "quote-hl-0001" })).json()).thread as string;
  const comment = (await (await write({ page: beds.id, action: "comment", quote: "Mulch it", body: "Straw, not bark.", requestId: "quote-cm-0001" })).json()).thread as string;
  expect(highlight && comment).toBeTruthy();

  // The comment's own page shows the comment: ((comment)) opens on the web as any block does.
  const own = await page(`/pub/p/${comment}`);
  expect(own).toContain("Straw, not bark.");

  // Picked together and quoted into the Inbox, as the person.
  const quoted = await (await write({ page: beds.id, action: "quote", marks: [comment, highlight], place: "inbox", text: "Frost and mulch" })).json();
  expect(quoted).toMatchObject({ ok: true, href: `/pub/p/${quoted.block}`, title: "Frost and mulch" });
  expect(quoted.said).toContain("in the Inbox");
  const made = store.get(quoted.block)!;
  expect(made.author).toBe("user");
  expect(made.text).toContain(`[from::((${comment}))] [from::((${highlight}))]`);
  // Its page transcludes each mark and links back to it.
  const quotePage = await page(quoted.href);
  expect(quotePage).toContain("Straw, not bark.");
  expect(quotePage).toMatch(/from <a href="[^"]+">Comment on/);
  expect(hrefs(quotePage)).toEqual(expect.arrayContaining([comment, highlight].map((id) => expect.stringContaining(`/pub/p/${id}`))));
  // Each mark's card says where it's been quoted, linking the new block's page.
  const drawn = (await threads(beds.id)).threads as unknown as { id: string; quotedIn: { id: string; href: string; title: string }[] }[];
  for (const id of [comment, highlight]) expect(drawn.find((thread) => thread.id === id)!.quotedIn).toEqual([{ id: quoted.block, title: "Frost and mulch", href: quoted.href }]);

  // A mark that isn't on the page, or a note the page can't name, is refused with nothing written.
  expect((await write({ page: beds.id, action: "quote", marks: [survey.id] })).status).toBe(404);
  expect((await write({ page: beds.id, action: "quote", marks: [comment], place: "under", under: ledger.id })).status).toBe(404);

  // Undo, once: the quote goes to the Trash and the cards stop saying it.
  const undone = await (await write({ page: beds.id, action: "undo", undo: quoted.undo })).json();
  expect(undone).toMatchObject({ ok: true, undone: [quoted.block] });
  expect(store.get(quoted.block)?.effectiveDeletedRootId).toBeTruthy();
  expect(((await threads(beds.id)).threads as unknown as { id: string; quotedIn: unknown[] }[]).find((thread) => thread.id === comment)!.quotedIn).toEqual([]);
  expect((await write({ page: beds.id, action: "undo", undo: quoted.undo })).status).toBe(404);

  // Under this note, and under a note found by its words.
  const found = await (await get(`/pub/_marginalia/find?q=${encodeURIComponent("Seed swap")}&page=${beds.id}`, {})).json() as { notes: { id: string; title: string }[] };
  expect(found.notes.map((note) => note.id)).toContain(swap.id);
  const underSwap = await (await write({ page: beds.id, action: "quote", marks: [comment], place: "under", under: swap.id })).json();
  expect(store.get(underSwap.block)!.parentId).toBe(swap.id);
  const underNote = await (await write({ page: beds.id, action: "quote", marks: [highlight], place: "note" })).json();
  expect(store.get(underNote.block)!.parentId).toBe(beds.id);
});

test("words in a comment are marked like a note's: a highlight on them lands on the comment and is drawn in its card", async () => {
  const pots = store.create("Pot sizes\nSeedlings move up a size at four leaves.", hub.id, "user");
  const comment = (await (await write({ page: pots.id, action: "comment", quote: "four leaves", body: "Count them again in October.", requestId: "in-comment-01" })).json()).thread as string;
  const marked = await write({ page: pots.id, action: "highlight", in: comment, quote: "October", prefix: "Count them again in ", suffix: ".", requestId: "in-comment-02" });
  expect(marked.status).toBe(200);
  const on = await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: comment }, includeResolved: false } });
  expect(on.map((thread) => thread.resolvedTarget?.anchor)).toEqual([expect.objectContaining({ kind: "text-quote", exact: "October" })]);
  // The card draws it on its words, and its own card can be replied to and quoted from this page.
  const card = ((await threads(pots.id)).threads as unknown as { id: string; marks: { id: string; quote: string }[] }[]).find((thread) => thread.id === comment)!;
  expect(card.marks).toEqual([expect.objectContaining({ id: on[0]!.block.id, quote: "October" })]);
  expect((await write({ page: pots.id, action: "reply", thread: on[0]!.block.id, body: "Mid-month.", requestId: "in-comment-03" })).status).toBe(200);
  // Quoted "under its note", a mark on a comment goes under the note they're both on, never under the comment.
  const nested = await (await write({ page: pots.id, action: "quote", marks: [on[0]!.block.id], place: "note", requestId: "in-comment-05" })).json();
  expect(store.get(nested.block)!.parentId).toBe(pots.id);
  // Words that are the comment's heading, not its own, aren't found there.
  expect((await write({ page: pots.id, action: "highlight", in: comment, quote: "Comment on", requestId: "in-comment-04" })).status).toBe(422);
});

test("writes come only from the tailnet page itself; the public listener stays read-only and shows marked notes only", async () => {
  const comment = { page: survey.id, action: "comment", quote: "light trap", body: "From elsewhere.", requestId: "elsewhere-01" };
  expect((await write(comment, "https://example.com")).status).toBe(403);
  expect((await write(comment, "null")).status).toBe(403);
  // No marginalia routes on the public listener, and no other write.
  expect((await write(comment, `https://${HOST}`, "public", "/share")).status).toBe(405);
  expect((await get(`/share/_marginalia/threads?page=${letter.id}`, browser, "public")).status).toBe(404);
  // An unmarked note isn't there, by id or page name; the public one is, as it was: one document, no script.
  expect((await get(`/share/p/${survey.id}?view=html`, browser, "public")).status).toBe(404);
  expect((await get(`/share/p/Field%20Notes?view=html`, browser, "public")).status).toBe(404);
  const open = await get(`/share/p/${letter.id}?view=html`, browser, "public");
  expect(open.status).toBe(200);
  expect(open.headers.get("content-security-policy")).not.toContain("script-src");
  expect(await open.text()).not.toContain("<script");
});

test("Recent replies: a page of the replies on his threads, the unread marked, each linking to its thread; opening it there reads it", async () => {
  const seeds = store.create("Seed tray log\nThe basil came up in four days.", hub.id, "user");
  const asked = await (await write({ page: seeds.id, action: "comment", quote: "four days", body: "Is four days quick?", requestId: "replies-ask-1" })).json();
  await client.request({ action: "annotations.reply", requestId: "replies-fern-1", author: "agent", provenance: { actorId: "fern" }, input: { annotationId: asked.thread, body: "Quick for basil: it likes the warm sill.", source: "agent" } });
  const listed = await page("/pub/replies");
  // The answer, unread, on the note it's about, linking to the thread there; his own comment isn't a reply to him.
  expect(listed).toContain("Quick for basil: it likes the warm sill.");
  expect(listed).toMatch(/<li class="new"><a href="[^"]+"><span class="t"><span class="dot" aria-label="unread">●<\/span> Quick for basil/);
  expect(listed).toContain("on Seed tray log");
  expect(listed).toContain("“four days”");
  expect(hrefs(listed)).toContain(`/pub/p/${seeds.id}#thread=${asked.thread}`);
  expect(listed).not.toContain("Is four days quick?");
  // Opening it there (the reader script's read) marks the thread read: no longer new.
  expect(await (await write({ page: seeds.id, action: "read", thread: asked.thread })).json()).toMatchObject({ ok: true, thread: asked.thread, marked: 2 });
  const after = await page("/pub/replies");
  expect(after).toMatch(/<li><a href="[^"]+"><span class="t">Quick for basil/);
  // Only on the tailnet.
  expect((await get("/share/replies", browser, "public")).status).toBe(404);
});

test("through a share link too: Ask about this gets its answer in the margin, and the agent reads what's selected on either page", async () => {
  await client.request({ action: "shares.start", scope: hub.id, ttl: "5m" });
  const kept = JSON.parse(store.readMetadata("share_sessions")!) as { sessions: { token: string; state: string }[] };
  const base = `/s/${kept.sessions.find((session) => session.state === "active")!.token}`;
  const asked = await (await write({ page: survey.id, action: "ask", quote: "light trap", body: "how bright?", requestId: "share-ask-01" }, `https://${HOST}`, "public", base)).json();
  expect(asked.ok).toBe(true);
  await until("the margin's answer through the share", async () => {
    const response = await get(`${base}/_marginalia/threads?page=${survey.id}`, {}, "public");
    const listed = (await response.json()) as { threads: { id: string; replies: { by: string }[] }[] };
    return listed.threads.find((thread) => thread.id === asked.thread && thread.replies.some((reply) => reply.by === "marginalia"));
  });
  // Quoted through the share: under the note, linked inside it; its undo is the share's, not the tailnet's.
  const viaShare = await (await write({ page: survey.id, action: "quote", marks: [asked.thread], place: "note" }, `https://${HOST}`, "public", base)).json();
  expect(viaShare).toMatchObject({ ok: true, href: `${base}/p/${viaShare.block}` });
  expect((await write({ page: survey.id, action: "undo", undo: viaShare.undo })).status).toBe(404);
  expect((await write({ page: survey.id, action: "undo", undo: viaShare.undo }, `https://${HOST}`, "public", base)).status).toBe(200);
  // The tailnet page says what's selected; the agent reads it without opening anything.
  const said = await publisher.handle(new Request(`http://${HOST}/pub/_marginalia/view`, {
    method: "POST", headers: { host: HOST, origin: `https://${HOST}`, "content-type": "application/json" },
    body: JSON.stringify({ page: survey.id, quote: "elephant hawk-moths", prefix: "The night-scented stock drew ", suffix: " after dusk.", url: `https://${HOST}/pub/p/${survey.id}` }),
  }), "tailnet");
  expect(said.status).toBe(200);
  const seen = await client.request<{ view: { reader: string; title: string; selection?: { text: string } } }>({ action: "reader.view" });
  expect(seen.view).toMatchObject({ reader: "tailnet", title: "Moth survey", selection: { text: "elephant hawk-moths" } });
  await client.request({ action: "shares.revoke", all: true });
});

test("wide tables scroll sideways on the page instead of crushing their columns", async () => {
  const wide = store.create("Plot rota by week\n\n| week | bed 1 | bed 2 | bed 3 | bed 4 | bed 5 | bed 6 |\n| --- | --- | --- | --- | --- | --- | --- |\n| 1 | dig | sow | water | weed | net | harvest |", hub.id, "user");
  const html = await page(`/pub/p/${wide.id}`);
  expect(html).toContain("<table>");
  expect(html).toMatch(/table\{[^}]*display:block;max-width:100%;overflow-x:auto/);
  expect(html).toMatch(/th,td\{[^}]*min-width:7em/);
});

test("the long poll waits for a change to what the page draws: a busy outline elsewhere doesn't answer it", async () => {
  const { version } = await threads(swap.id);
  let answered: { version: string } | undefined;
  const waiting = get(`/pub/_marginalia/threads?page=${swap.id}&since=${version}&wait=8000`, {}).then(async (response) => { answered = await response.json(); });
  // Writes to another note: each wakes the wait to look again, and the page's answer is the same, so it waits on.
  for (let at = 0; at < 4; at += 1) {
    await edit(letter, `Open letter [publish::public]\nTo the allotment committee, draft ${at}.`);
    await Bun.sleep(150);
  }
  await Bun.sleep(500);
  expect(answered).toBeUndefined();
  // A change to the page's own note answers it, with the new version.
  await edit(swap, "Seed swap\nBring the saved marigold seed, and the beans.");
  await until("the page's answer", async () => answered);
  await waiting;
  expect(answered!.version).not.toBe(version);
});

test("a page marks where each block is and loads the page helpers; Markdown and public pages carry neither", async () => {
  const whole = await page("/pub/p/Field%20Notes?view=full");
  for (const block of [hub, survey, swap]) expect(whole).toContain(`<span class="bk" data-block="${block.id}"></span>`);
  // The anchor holds no text: the words a reader selects are the note's.
  expect(whole).toContain(`<h1>Field notes<span class="bk" data-block="${hub.id}"></span></h1>`);
  // A folder's rows are its children's.
  expect(await page("/pub/p/Field%20Notes")).toContain(`<li data-block="${swap.id}">`);
  expect(whole).toMatch(/<script src="\/pub\/_marginalia\/reader\.js\?v=\w+" defer><\/script><script src="\/pub\/_marginalia\/webmcp\.js\?v=\w+" defer><\/script>/);
  const polyfill = await get("/pub/_marginalia/webmcp.js", {});
  expect(polyfill.status).toBe(200);
  expect(polyfill.headers.get("content-type")).toBe("text/javascript; charset=utf-8");
  expect(await polyfill.text()).toContain("modelContext");
  const markdown = await (await get("/pub/p/Field%20Notes?view=md", {})).text();
  expect(markdown).not.toMatch(/[\uE000-\uF8FF]|data-block/);
  expect(await (await get(`/share/p/${letter.id}?view=html`, browser, "public")).text()).not.toContain("data-block");
});

test("the page says what's on screen and the service keeps it with what the reader did: ep0ch.view() and ep0ch.journal() read it back", async () => {
  await view({ page: swap.id, url: `https://${HOST}/pub/p/${swap.id}` });
  const opened = await (await view({ page: survey.id, title: "x", url: `https://${HOST}/pub/p/${survey.id}`, visible: [survey.id, letter.id], scroll: { y: 120, max: 900 } })).json() as { view: ReaderView; journal: ReaderEvent[] };
  // Only this page's blocks are said to be on screen.
  expect(opened.view).toMatchObject({ blockId: survey.id, title: "Moth survey", visible: [survey.id], scroll: { y: 120, max: 900 } });
  expect(opened.journal.at(-1)).toMatchObject({ kind: "page", blockId: survey.id, title: "Moth survey" });
  const since = opened.journal.at(-1)!.n;

  const words = { quote: "elephant hawk-moths", prefix: "The night-scented stock drew ", suffix: " after dusk." };
  const selected = await (await view({ page: survey.id, url: `https://${HOST}/pub/p/${survey.id}`, ...words, fold: { blockId: survey.id, open: true } })).json() as { view: ReaderView; journal: ReaderEvent[] };
  const text = store.get(survey.id)!.text;
  // Where the words are in the note's source, at its revision: what an edit through the MCP needs.
  expect(selected.view.selection).toMatchObject({
    text: "elephant hawk-moths", blockId: survey.id, revision: store.get(survey.id)!.revision,
    offsets: { start: text.indexOf("elephant hawk-moths"), end: text.indexOf("elephant hawk-moths") + 19 },
  });
  const after = selected.journal.filter((event) => event.n > since);
  expect(after.map((event) => event.kind)).toEqual(["selection", "fold"]);
  expect(after[1]).toMatchObject({ blockId: survey.id, open: true });
  // The agent in chat reads the same through the service.
  const read = await client.request<{ view: ReaderView; journal: ReaderEvent[] }>({ action: "reader.view", reader: "tailnet", since });
  expect(read.view.selection?.offsets).toEqual(selected.view.selection!.offsets!);
  expect(read.journal.map((event) => event.kind)).toEqual(["selection", "fold"]);
});

// The tailnet web client (PIE-782, with PIE-774's marginalia and PIE-775's folders): on the tailnet listener every
// note is a page, a folder that is also a file, and being on the tailnet is the sign-in for highlights, comments,
// asks, replies and resolves, which land through the service as the door's do. The public listener stays read-only
// and shows marked notes only. One scratch service (with marginalia, whose @margin answers from the note) and one
// publisher for the whole file; the outline is made up.
import { afterAll, beforeAll, expect, test, setSystemTime } from "bun:test";
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

test("highlight, comment, an answered ask, reply and seen land in the outline, attributed to the person", async () => {
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
  // Edit (PIE-763): a comment's and a reply's words changed from the revision the page drew; a stale one is refused.
  const drawnComment = replied as unknown as { edit: { revision: number; words: string }; replies: { id: string; edit: { revision: number; words: string } }[] };
  expect(drawnComment.edit.words).toBe("Count them again in October.");
  expect((await write({ page: survey.id, action: "edit", mark: commented.thread, revision: drawnComment.edit.revision, body: "Count them again in late October." })).status).toBe(200);
  expect((await write({ page: survey.id, action: "edit", mark: commented.thread, revision: "soon", body: "No revision." })).status).toBe(400);
  const stale = await write({ page: survey.id, action: "edit", mark: commented.thread, revision: drawnComment.edit.revision, body: "Lost words." });
  expect(stale.status).toBe(409);
  expect((await stale.json()).error).toContain("your words are still in the box");
  const firstReply = drawnComment.replies[0]!;
  expect((await write({ page: survey.id, action: "edit", mark: firstReply.id, revision: firstReply.edit.revision, body: "And note the weather and the moon." })).status).toBe(200);
  const edited = (await threads(survey.id)).threads.find((thread) => thread.id === commented.thread)! as unknown as { body: string; edited?: string; editedBy?: string; by: string; replies: { body: string; edited?: string }[] };
  expect([edited.body, !!edited.edited, edited.editedBy, edited.by]).toEqual(["Count them again in late October.", true, "you", "you"]);
  expect(edited.replies.map((reply) => [reply.body, !!reply.edited])).toEqual([["And note the weather and the moon.", true]]);
  // Seen puts it on the Earlier shelf (PIE-791): still on the page, out of the margin's default.
  expect((await write({ page: survey.id, action: "seen", thread: commented.thread })).status).toBe(200);
  expect((await threads(survey.id)).threads.find((thread) => thread.id === commented.thread)).toMatchObject({ lifecycle: "seen" });

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
  // A link to a mark is labelled by its own words, never its generated `Comment on “…”` heading.
  expect(quotePage).toMatch(/from <a href="[^"]+">Straw, not bark\.<\/a>/);
  expect(quotePage).not.toContain("Comment on");
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

test("a quote of @margin's answer and its ask: the answer is drawn (a mark, not extension data), and the folder row reads words, not ids", async () => {
  const shed = store.create("Potting shed\nThe **cold frame:** opens at ten degrees.", hub.id, "user");
  const ask = (await (await write({ page: shed.id, action: "ask", quote: "cold frame:** opens", body: "why ten?", requestId: "quote-ask-0001" })).json()).thread as string;
  const answer = await until("the margin's answer", async () =>
    ((await threads(shed.id)).threads.find((thread) => thread.id === ask)?.replies as { id: string; by: string; body: string }[] | undefined)?.find((reply) => reply.by === "marginalia"));
  const quoted = await (await write({ page: shed.id, action: "quote", marks: [answer.id, ask], place: "note", text: "Why ten" })).json();
  const quotePage = await page(quoted.href);
  // @margin wrote the answer (`ext:marginalia`), but a mark is read wherever marks are: never "marginalia data, not published".
  expect(quotePage).not.toContain("not published");
  expect(quotePage).toContain(answer.body.split("\n")[0]!.slice(0, 20));
  // Each embedded mark shows its own words, and each link is labelled by them, without the passage's `**`.
  expect(quotePage).not.toContain("**");
  expect(quotePage).not.toContain("Question on");
  // The note's folder lists the quote by the marks' words: no stray `!`, no ((id)) in its meta line.
  const folder = await page(`/pub/p/${shed.id}`);
  const row = folder.slice(folder.indexOf(`data-block="${quoted.block}"`));
  const li = row.slice(0, row.indexOf("</li>"));
  expect(li).not.toMatch(/!a note|\(\(|<span class="s">!/);
  expect(li).toContain("<span class=\"s\">“");
  expect(li).toContain(`from: <a href="/pub/p/${ask}">@margin why ten?</a>`);
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
  // Edit through the share (PIE-763): what was written through it, yes; the person's own comment on the tailnet, never.
  const onShare = ((await (await get(`${base}/_marginalia/threads?page=${survey.id}`, {}, "public")).json()) as { threads: { id: string; edit?: { revision: number; words: string } }[] }).threads;
  const mine = onShare.find((thread) => thread.id === asked.thread)!;
  expect(mine.edit?.words).toBe("@margin how bright?");
  expect(onShare.filter((thread) => thread.id !== asked.thread).every((thread) => !thread.edit)).toBe(true);
  const theirs = onShare.find((thread) => thread.id !== asked.thread)!;
  expect((await write({ page: survey.id, action: "edit", mark: theirs.id, revision: 1, body: "Rewritten by a guest." }, `https://${HOST}`, "public", base)).status).toBe(403);
  expect((await write({ page: survey.id, action: "edit", mark: asked.thread, revision: mine.edit!.revision, body: "@margin how bright is it?" }, `https://${HOST}`, "public", base)).status).toBe(200);
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
  expect(whole.match(/<h1>(.*?)<\/h1>/)?.[1]?.replace(/<[^>]*>/g, "").trim()).toBe("Field notes");
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

// The web client as the owner's own reader (PIE-789): search like the power bar, completion in the comment box, nothing
// held back by `[publish::]`, and the top level showing the outline rather than its system views.

test("search: a box on every page, the power bar's search behind it; a body phrase finds its note with the line and crumbs; a locked note never shows", async () => {
  const top = await page("/pub/");
  expect(top).toContain('<form class="sx" role="search" action="/pub/search" method="get">');
  expect(top).toMatch(/<script src="\/pub\/_marginalia\/search\.js\?v=[0-9a-f]+" defer>/);
  // From a note's page the search asks from that note, as the bar does (nearer notes first).
  expect(await page(`/pub/p/${survey.id}`)).toContain(`<input type="hidden" name="near" value="${survey.id}">`);

  const started = performance.now();
  const results = await page(`/pub/search?q=elephant+hawk&near=${swap.id}`);
  expect(performance.now() - started).toBeLessThan(1_000);
  expect(results).toContain(`<li data-block="${survey.id}"><a href="/pub/p/${survey.id}"><span class="t">Moth survey</span>`);
  expect(results).toContain("<span class=\"s\">The night-scented stock drew <b>elephant</b> <b>hawk</b>-moths after dusk.</span>");
  expect(results).toContain('<span class="m">Field notes</span>');
  // The same answer for the box's script, as data.
  const asked = await (await get("/pub/search?q=elephant+hawk&format=json", {})).json() as { hits: { id: string; line: string; crumbs: string }[] };
  expect(asked.hits.find((hit) => hit.id === survey.id)).toMatchObject({ crumbs: "Field notes", line: "The night-scented stock drew elephant hawk-moths after dusk." });
  // A locked note isn't found, nor anything in it.
  const locked = await (await get("/pub/search?q=plots+cost&format=json", {})).json() as { hits: { id: string }[] };
  expect(locked.hits.map((hit) => hit.id)).not.toContain(ledger.id);
  expect(await page("/pub/search?q=zzqxv")).toContain("Nothing matches “zzqxv”.");
  // The public listener has no search.
  expect((await get("/share/search?q=moth", browser, "public")).status).toBe(404);
});

test("search inside a share is the share's: only its notes, no crumbs above the shared note", async () => {
  await client.request({ action: "shares.start", scope: swap.id, ttl: "5m", comments: false });
  const kept = JSON.parse(store.readMetadata("share_sessions")!) as { sessions: { token: string; state: string }[] };
  const base = `/s/${kept.sessions.find((session) => session.state === "active")!.token}`;
  const shared = await (await get(`${base}/`, browser, "public")).text();
  expect(shared).toContain(`action="${base}/search"`);
  const inside = await (await get(`${base}/search?q=marigold&format=json`, {}, "public")).json() as { hits: { title: string; crumbs: string; href: string }[] };
  expect(inside.hits.map((hit) => hit.title)).toEqual(expect.arrayContaining(["Seed swap", "Marigold packets"]));
  for (const hit of inside.hits) {
    expect(hit.crumbs).toBe("");
    expect(hit.href.startsWith(`${base}/`)).toBe(true);
  }
  const outside = await (await get(`${base}/search?q=elephant&format=json`, {}, "public")).json() as { hits: unknown[] };
  expect(outside.hits).toEqual([]);
  // A share without comments has no box to complete in.
  expect((await get(`${base}/_marginalia/complete?text=((moth&at=6`, {}, "public")).status).toBe(403);
  await client.request({ action: "shares.revoke", all: true });
});

test("a note's block-level tags are one row of links under its title, not lost with its properties or left as a stray line (PIE-880)", async () => {
  const fence = store.create("Fence plan\n[status::draft] #fencing #timber\nThe fence wants new posts. Also #later.", hub.id, "user");
  const shown = await page(`/pub/p/${fence.id}`);
  const row = '<p><a href="/pub/search?q=%23fencing">#fencing</a> <a href="/pub/search?q=%23timber">#timber</a></p>';
  expect(shown).toContain(row);
  // The row comes before the text and once; the inline tag stays in its sentence.
  expect(shown.indexOf(row)).toBeLessThan(shown.indexOf("The fence wants new posts."));
  expect(shown.split("%23fencing").length - 1).toBe(1);
  expect(shown).toContain('Also <a href="/pub/search?q=%23later">#later</a>.');
  // A hand-made row that already shows every tag is the row: nothing is drawn twice, and no stray line is left.
  const own = store.create("Gate plan\n[from::Gardener] #beds\n\n- #beds\nThe gate sticks.", hub.id, "user");
  const second = await page(`/pub/p/${own.id}`);
  expect(second.split("%23beds").length - 1).toBe(1);
});

test("a #tag on a page opens the notes carrying it: title, the tag's line and crumbs; a nested tag counts; inside a share only its notes", async () => {
  const north = store.create("North bed plan #north-star\nWhat the north bed is for.\n- Keep it for brassicas. #north-star/beds\n- `#north-star` in code is no tag.", hub.id, "user");
  const compost = store.create("Compost bays\nTurn the second bay. #north-star", swap.id, "user");
  store.create("Bench notes\nA bench by the shed, someday. #wishlist", hub.id, "user");

  // On the note's page each #tag is a link to its search; one in code stays code.
  const shown = await page(`/pub/p/${north.id}`);
  expect(hrefs(shown)).toEqual(expect.arrayContaining(["/pub/search?q=%23north-star", "/pub/search?q=%23north-star%2Fbeds"]));
  expect(shown).toContain('<a href="/pub/search?q=%23north-star">#north-star</a>');
  expect(shown).toContain("<code>#north-star</code>");

  // The tag's page: the notes carrying it (the nested one too), each with the line that carries it and its crumbs.
  const tagged = await page("/pub/search?q=%23north-star");
  expect(tagged.match(/<h1>[^<]*<\/h1>/)?.[0]).toBe("<h1>#north-star</h1>");
  expect(tagged.match(/<p class="dim">[^<]*<\/p>/)?.[0]).toBe('<p class="dim">2 notes tagged #north-star</p>');
  const asked = await (await get("/pub/search?q=%23north-star&format=json", {})).json() as { tag: string; hits: { id: string; title: string; line: string; crumbs: string }[] };
  expect(asked.tag).toBe("north-star");
  expect(asked.hits.map((hit) => hit.id).sort()).toEqual([north.id, compost.id].sort());
  expect(asked.hits.find((hit) => hit.id === north.id)).toMatchObject({ title: "North bed plan", line: "Keep it for brassicas. #north-star/beds", crumbs: "Field notes" });
  expect(asked.hits.find((hit) => hit.id === compost.id)).toMatchObject({ line: "Turn the second bay. #north-star", crumbs: "Field notes › Seed swap" });
  expect((await page("/pub/search?q=%23no-such-tag")).match(/<p class="dim">[^<]*<\/p>/)?.[0]).toBe('<p class="dim">No note here is tagged #no-such-tag.</p>');

  // Inside a share of the seed swap: only its note carrying the tag, no crumbs, links that stay in the share. More notes
  // outside it carry the tag than one answer lists: the share's is still found.
  // (Under the moth survey, which comes before the seed swap in the outline, so first in the service's answer.)
  const elsewhere = store.create("Tagged elsewhere", survey.id, "user");
  for (let n = 0; n < 205; n++) store.create(`Bed ${n} #north-star`, elsewhere.id, "user");
  const late = store.create("Late sowing\nBroad beans in November. #north-star", swap.id, "user");
  await client.request({ action: "shares.start", scope: swap.id, ttl: "5m", comments: false });
  const kept = JSON.parse(store.readMetadata("share_sessions")!) as { sessions: { token: string; state: string }[] };
  const base = `/s/${kept.sessions.find((session) => session.state === "active")!.token}`;
  expect(hrefs(await (await get(`${base}/p/${compost.id}`, browser, "public")).text())).toContain(`${base}/search?q=%23north-star`);
  const inside = await (await get(`${base}/search?q=%23north-star&format=json`, {}, "public")).json() as { hits: { id: string; title: string; line: string; crumbs: string; href: string }[] };
  expect(inside.hits.map((hit) => hit.id).sort()).toEqual([compost.id, late.id].sort());
  expect(inside.hits.find((hit) => hit.id === compost.id)).toEqual({ id: compost.id, title: "Compost bays", line: "Turn the second bay. #north-star", crumbs: "", href: expect.stringMatching(new RegExp(`^${base}/`)) });
  await client.request({ action: "shares.revoke", all: true });

  // A public page has no search, so its tags are words.
  const open = store.create("Open day [publish::public]\nCome and see the beds. #north-star", null, "user");
  const public_ = await until("the public page", async () => {
    const response = await get(`/share/p/${open.id}?view=html`, browser, "public");
    return response.status === 200 && response.text();
  });
  expect(public_).toContain("Come and see the beds. #north-star");
  expect(hrefs(public_).some((href) => href.includes("search"))).toBe(false);
});

test("completion in a comment box: [[, (( and # offer what the door's completer offers and insert what it writes", async () => {
  store.create("Pollinator walk #pollinators #pollen-count\nBees on the lavender.", hub.id, "user");
  const ask = async (text: string, at = text.length) =>
    (await get(`/pub/_marginalia/complete?${new URLSearchParams({ text, at: String(at), page: survey.id })}`, {})).json() as Promise<{ kind: string | null; start: number; end: number; items: { label: string; insertion: string }[] }>;
  const pages = await ask("see [[Field");
  expect(pages).toMatchObject({ kind: "page", start: 4, end: 11 });
  expect(pages.items[0]!.insertion).toBe("[[Field Notes]]");
  const notes = await ask("about ((moth surv");
  expect(notes.kind).toBe("block");
  expect(notes.items[0]!.insertion).toBe(`((${survey.id}))`);
  // Typed into the middle of a reference that's already closed, the whole reference is replaced.
  expect(await ask("about ((moth))", 11)).toMatchObject({ kind: "block", start: 6, end: 14 });
  const tags = await ask("for #poll");
  expect(tags).toMatchObject({ kind: "tag", start: 4, end: 9 });
  expect(tags.items.map((item) => item.insertion)).toEqual(expect.arrayContaining(["#pollinators", "#pollen-count"]));
  // On a later line of the box, the offsets are the box's.
  expect(await ask("Two things:\nfor #poll")).toMatchObject({ kind: "tag", start: 16, end: 21 });
  // Not a tag: in a word, in code (a fence opened lines above too), a heading's `#`.
  for (const text of ["mid#poll", "`#poll", "# ", "```\nsee ((moth", "```\nfor #poll"]) expect((await ask(text)).kind).toBeNull();
  // A locked note is never offered.
  expect((await ask("((Private ledger")).items.map((item) => item.insertion)).not.toContain(`((${ledger.id}))`);
});

test("the owner's pages hold nothing back by [publish::]: a [publish::false] child and an extension's record show, and no page says 'not published'", async () => {
  const order = store.create("Seed order\nWhat to buy for spring.", hub.id, "user");
  store.create("Supplier quote [publish::false]\nTwelve packets of stock.", order.id, "user");
  const record = store.create("Ticket GARDEN-12 [type::ticket]\nFix the shed door.", order.id, "agent", { actorId: "ext:tracker" });
  store.create(`Embedded !((${record.id}))`, order.id, "user");
  const full = await page(`/pub/p/${order.id}?view=full`);
  expect(full).toContain("Twelve packets of stock.");
  expect(full).toContain("Fix the shed door.");
  const folder = await page(`/pub/p/${order.id}`);
  for (const body of [full, folder, await page("/pub/"), await (await get(`/pub/p/${order.id}?view=md`, {})).text()]) {
    expect(body).not.toMatch(/not published|unpublished note/i);
  }
  // A note in Trash: no page, and nowhere a row.
  const gone = store.create("Old compost plan", hub.id, "user");
  store.delete(gone.id);
  expect((await get(`/pub/p/${gone.id}`)).status).toBe(404);
  expect(await (await get(`/pub/p/${gone.id}`, {})).text()).toBe("Not found\n");
});

test("every error page a browser opens is dark (he is photosensitive): a missing note, a work id nobody has, a bad path; a fetch still gets the plain words", async () => {
  for (const path of ["/pub/p/PIE-9999", "/pub/p/no-such-page", "/pub/_nothing/here"]) {
    const response = await get(path);
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toStartWith("text/html");
    const body = await response.text();
    expect(body).toContain("color-scheme:dark");
    expect(body).toContain("background:var(--bg)");
    expect(body).toContain("Not found");
  }
  const fetched = await get("/pub/p/PIE-9999", { accept: "*/*" });
  expect(fetched.status).toBe(404);
  expect(await fetched.text()).toBe("Not found\n");
});

test("the top level shows the outline's notes, not its system views: no Trash, no board of untitled deleted notes, Bookmarks a quiet link", async () => {
  const gone = store.create("Rotten fence post", null, "user");
  store.delete(gone.id);
  const top = await page("/pub/");
  const rows = [...top.matchAll(/<li data-block="([^"]+)">.*?<span class="t">([^<]*)<\/span>/g)].map((match) => match[2]);
  expect(rows).toEqual(expect.arrayContaining(["Field notes", "Open letter"]));
  expect(rows).not.toContain("Trash");
  expect(rows).not.toContain("Bookmarks");
  expect(top).not.toContain("untitled");
  expect(top).not.toContain("Rotten fence post");
  expect(top).not.toMatch(/<h2>(Board|View) /);
  expect(top).toMatch(/<footer><a href="\/pub\/p\/[0-9a-f-]+">bookmarks<\/a> · /);
});

// Attention, not tickets (PIE-791): Seen, Keep and TL;DR are the service's, shared by every client.

test("seen puts a thread away and a new reply brings it back; kept stays current; a TL;DR is a [kind::tldr] reply, @margin's or the person's", async () => {
  const note = store.create("Compost log\nThe heap turned warm after the rain.", hub.id, "user");
  const made = await (await write({ page: note.id, action: "comment", quote: "turned warm", prefix: "The heap ", suffix: " after", body: "Check it again on Sunday.", requestId: "attention-01" })).json();
  expect(made.ok).toBe(true);
  const thread = made.thread as string;
  const listed = async (includeResolved: boolean) => (await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: note.id }, includeResolved } }));
  const state = async () => (await listed(true)).find((t) => t.block.id === thread)!;
  const set = (lifecycle: string) => client.request<unknown>({ action: "annotations.lifecycle", input: { annotationId: thread, lifecycle } as never, mutation: { author: "user" } });

  await set("seen");
  expect((await state()).lifecycle).toBe("seen");
  expect((await listed(false)).map((t) => t.block.id)).not.toContain(thread);
  await client.request({ action: "annotations.reply", requestId: "attention-02", input: { annotationId: thread, body: "It's still warm.", source: "user" }, author: "user" });
  expect((await state()).lifecycle).toBe("open");
  await set("kept");
  expect((await listed(false)).map((t) => t.block.id)).toContain(thread);
  await expect(set("closed")).rejects.toThrow(/open, seen, kept or resolved/);

  // No model set up for @margin (this service's marginalia has none): no TL;DR, said with the fix, and nothing posted
  // (PIE-860: its fallback once posted the note's own sentences as the thread's face).
  await expect(client.request<unknown>({ action: "annotations.tldr", annotationId: thread, mutation: { author: "user" } })).rejects.toThrow(/no TL;DR: no model is set up.*config\.json/);
  await Bun.sleep(200);
  expect((await state()).replies.filter((reply) => reply.properties?.kind?.[0] === "tldr")).toEqual([]);
  await client.request({ action: "annotations.tldr", annotationId: thread, body: "Warm after rain; check Sundays.", mutation: { author: "user" } });
  const mine = (await state()).replies.filter((reply) => reply.properties?.kind?.[0] === "tldr").at(-1)!;
  expect(mine).toMatchObject({ body: "Warm after rain; check Sundays.", block: { author: "user" } });
  // Taken away: the TL;DR goes, and the thread's face is its discussion again.
  expect(await client.request<{ removed: string[] }>({ action: "annotations.tldr", annotationId: thread, remove: true, mutation: { author: "user" } })).toEqual({ removed: [mine.block.id] });
  expect((await state()).replies.filter((reply) => reply.properties?.kind?.[0] === "tldr")).toEqual([]);
  await expect(client.request({ action: "annotations.tldr", annotationId: thread, remove: true, mutation: { author: "user" } })).rejects.toThrow(/no TL;DR to take away/);
  expect((await state()).lifecycle).toBe("kept");
});

test("the page's verbs: Seen puts a thread on the Earlier shelf and Back brings it back, Keep keeps it, TL;DR is asked or written; the words are drawn as the note's; Define with no glossary line asks @margin", async () => {
  const note = store.create("Hedge log\nThe hawthorn flowered late; see [[Field Notes]] for the spring.", hub.id, "user");
  const made = await (await write({ page: note.id, action: "comment", quote: "flowered late", prefix: "The hawthorn ", suffix: ";", body: "Late like **last year**? See ((" + survey.id + ")).", requestId: "verbs-0001" })).json();
  const thread = made.thread as string;
  const card = async () => (await threads(note.id)).threads.find((t) => t.id === thread) as unknown as { lifecycle: string; tldr?: string; html?: string; replies: { id: string; body: string; tldr?: boolean }[] };
  expect((await card()).html).toContain("<strong>last year</strong>");
  expect((await card()).html).toContain(`href="/pub/p/${survey.id}?view=html">Moth survey</a>`);
  for (const [action, lifecycle] of [["seen", "seen"], ["back", "open"], ["keep", "kept"], ["unkeep", "open"]] as const) {
    const answer = await (await write({ page: note.id, action, thread })).json();
    expect(answer).toMatchObject({ ok: true, lifecycle });
    expect((await card()).lifecycle).toBe(lifecycle);
  }
  // No model set up: refused with the fix, no face (PIE-860).
  expect(await (await write({ page: note.id, action: "tldr", thread })).json()).toMatchObject({ ok: false });
  expect((await card()).tldr).toBeUndefined();
  expect(await (await write({ page: note.id, action: "tldr", thread, body: "Late again; check the hedge in May.", requestId: "verbs-0002" })).json()).toMatchObject({ ok: true, said: "TL;DR saved" });
  const face = await card();
  expect(face.replies.find((reply) => reply.id === face.tldr)).toMatchObject({ body: "Late again; check the hedge in May.", tldr: true });
  // A seen thread's mark is drawn quietly, with no aside.
  await write({ page: note.id, action: "seen", thread });
  const page = await (await get(`/pub/p/${note.id}?view=full`)).text();
  expect(page).toMatch(/<mark class="ann ann-default ann-earlier" data-ann="[^"]+"/);
  // Define on words the note's glossary doesn't have asks @margin instead of stopping there.
  const defined = await (await write({ page: note.id, action: "define", quote: "hawthorn", prefix: "The ", suffix: " flowered" })).json();
  expect(defined.said).toContain("asked @margin");
  const asked = await until("the define's answer", async () => (await threads(note.id)).threads.find((t) => t.kind === "define" && t.replies.some((reply) => reply.by === "marginalia")));
  expect(asked.body).toContain("@margin what does “hawthorn” mean here?");
});

test("a card's quote is drawn as the note's words: a reference by its title, linked (an unplaced card shows it)", async () => {
  const text = `Bat walk\nWe followed ((${survey.id}|the moth survey)) route at dusk.`;
  const note = store.create(text, hub.id, "user");
  const quote = `((${survey.id}|the moth survey)) route`;
  store.annotations.batch("quote-render-1", [{ type: "block-comment", operationId: "q", input: { blockId: note.id, expectedRevision: note.revision, body: "Same route next year?", source: "user", passage: { quote, start: text.indexOf(quote) } } }]);
  const listed = (await threads(note.id)).threads as unknown as { quote: string; quoteHtml?: string }[];
  expect(listed[0]!.quote).toBe(quote);
  expect(listed[0]!.quoteHtml).toContain(`>the moth survey</a> route`);
  expect(listed[0]!.quoteHtml).not.toContain("((");
});

test("a ::graph-check row on a page (PIE-864): its words drawn as the note's, its box a step button; a written row's mark rewrites its box, a live row's writes its note's property", async () => {
  const chore = store.create("Sweep the shed [type::web-chore] [stage::open]", null, "user");
  const plan = store.create(["Shed test plan", "", "::graph-check", "---", "title: You test", "---",
    "- [ ] open `http://localhost:4175/register` — sign up as **Ana**", "- [~] wait for the email", "::", "",
    "::graph-check", "---", "title: Chores", 'query: "type=web-chore"', 'done: "stage=done"', "---", "::"].join("\n"), null, "user");
  const html = await page(`/pub/p/${plan.id}`);
  // The row's code span and emphasis drawn as the note's would be, not as typed.
  expect(html).toContain("<code>http://localhost:4175/register</code>");
  expect(html).toContain("<strong>Ana</strong>");
  const boxes = [...html.matchAll(/<button type="button" class="step s-(\w+)"[^>]*>/g)];
  expect(boxes.map((box) => box[1])).toEqual(["todo", "waiting", "todo"]);
  const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/data-step-([\w-]+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
  const open = attrs(boxes[0]![0]), live = attrs(boxes[2]![0]);
  expect(live).toMatchObject({ block: chore.id, status: "todo", note: plan.id });
  // The written row: its box rewritten in the note, nothing else on its line.
  let answer = await write({ page: plan.id, action: "step", status: "done", block: plan.id, start: Number(open.start), revision: Number(open.revision), evidence: open.evidence });
  expect(answer.status).toBe(200);
  expect(store.get(plan.id)!.text).toContain("- [x] open `http://localhost:4175/register` — sign up as **Ana**\n");
  // The live row: the chore's own stage written, as the person; the property is the figure's done:, read from it.
  answer = await write({ page: plan.id, action: "step", status: "done", block: chore.id, evidence: live.evidence, live: { note: plan.id, figure: Number(live.figure), revision: store.get(plan.id)!.revision, from: live.status } });
  expect(await answer.json()).toMatchObject({ ok: true, said: "marked done (stage::done)" });
  expect(store.get(chore.id)!.text).toBe("Sweep the shed [type::web-chore] [stage::done]");
  expect(store.get(chore.id)!.author).toBe("user");
  // Drawn as to do, done since: refused as stale, never written over.
  answer = await write({ page: plan.id, action: "step", status: "waiting", block: chore.id, evidence: live.evidence, live: { note: plan.id, figure: Number(live.figure), revision: store.get(plan.id)!.revision, from: "todo" } });
  expect(answer.status).toBe(409);
  expect(store.get(chore.id)!.text).toContain("[stage::done]");
  // A note the figure doesn't list, or a figure not on the page, can't be marked through it.
  expect((await write({ page: plan.id, action: "step", status: "todo", block: survey.id, evidence: "x", live: { note: plan.id, figure: Number(live.figure), revision: store.get(plan.id)!.revision, from: "todo" } })).status).toBe(404);
  expect((await write({ page: plan.id, action: "step", status: "todo", block: chore.id, evidence: "x", live: { note: survey.id, figure: Number(live.figure), revision: store.get(survey.id)!.revision, from: "done" } })).status).toBe(404);
});

test("a page marks the clicked live figure when two figures list the same row (PIE-864)", async () => {
  const chore = store.create("Wash the pot [type::shared-chore] [stage::todo] [review::todo]", null, "user");
  const plan = store.create(['Pot plan', '', '::graph-check', '---', 'query: "type=shared-chore"', 'done: "stage=done"', '---', '::', '',
    '::graph-check', '---', 'query: "type=shared-chore"', 'done: "review=done"', '---', '::'].join("\n"), null, "user");
  const html = await page(`/pub/p/${plan.id}`);
  const boxes = [...html.matchAll(/<button type="button" class="step s-(\w+)"[^>]*>/g)];
  const attrs = Object.fromEntries([...boxes[1]![0].matchAll(/data-step-([\w-]+)="([^"]*)"/g)].map(m => [m[1]!, m[2]!]));
  const answer = await write({ page: plan.id, action: "step", status: "done", block: chore.id, evidence: attrs.evidence,
    live: { note: attrs.note, from: attrs.status, figure: Number(attrs.figure), revision: Number(attrs.revision) } });
  expect(answer.status).toBe(200);
  expect(store.get(chore.id)!.text).toContain("[review::done]");
  expect(store.get(chore.id)!.text).toContain("[stage::todo]");
});

test("a step's box on a page is its state, a button on the owner's page: Approve and Reject land as the note's marks, a stale one is refused; a public page draws it read-only (PIE-811)", async () => {
  const log = store.create(["Shed roof build log [publish::public]", "## Needs you", "- [ ] felt from the merchant ^t-felt01", "- [ ] patch the gutter until spring", "- [x] measure the roof", "- [-] paint it green"].join("\n"), null, "user");
  const html = await page(`/pub/p/${log.id}`);
  const boxes = [...html.matchAll(/<button type="button" class="step s-(\w+)"[^>]*>/g)];
  expect(boxes.map((box) => box[1])).toEqual(["todo", "todo", "done", "rejected"]);
  // Markdown's own checkbox is gone; the words selected across a box stay the note's (the glyph is drawn by the style).
  expect(html).not.toContain('type="checkbox" disabled');
  expect(html).toMatch(/data-glyph="✗"><\/button> paint it green/);
  const attrs = (tag: string) => Object.fromEntries([...tag.matchAll(/data-step-(\w+)="([^"]*)"/g)].map((m) => [m[1]!, m[2]!]));
  const felt = attrs(boxes[0]![0]), gutter = attrs(boxes[1]![0]);
  expect(felt).toMatchObject({ block: log.id, id: "t-felt01" });
  // Approve the felt by its id; reject the gutter (no id yet) by where it starts in the revision drawn.
  let answer = await write({ page: log.id, action: "step", status: "approved", block: log.id, itemId: felt.id, evidence: felt.evidence });
  expect(answer.status).toBe(200);
  expect(await answer.json()).toMatchObject({ ok: true, status: "approved", said: "marked approved" });
  // The gutter's evidence is its own, unchanged: its start moved by nothing (the felt's box is the same length).
  answer = await write({ page: log.id, action: "step", status: "rejected", block: log.id, start: Number(gutter.start), revision: Number(gutter.revision), evidence: gutter.evidence });
  // Its note moved on a revision, so a step with no id is refused as stale and drawn again; by its new place it lands.
  expect(answer.status).toBe(409);
  expect(await answer.json()).toMatchObject({ ok: false, stale: true, error: expect.stringContaining("choose again") });
  const again = attrs([...(await page(`/pub/p/${log.id}`)).matchAll(/<button type="button" class="step s-(\w+)"[^>]*>/g)][1]![0]);
  answer = await write({ page: log.id, action: "step", status: "rejected", block: log.id, start: Number(again.start), revision: Number(again.revision), evidence: again.evidence });
  expect(answer.status).toBe(200);
  const text = store.get(log.id)!.text;
  expect(text).toContain("- [✓] felt from the merchant ^t-felt01");
  expect(text).toMatch(/- \[✗\] patch the gutter until spring \^t-[0-9a-f]{6,}/);
  expect(store.get(log.id)!.author).toBe("user");
  // Not a status, or a note not on this page: refused with why.
  expect((await write({ page: log.id, action: "step", status: "maybe", block: log.id, itemId: "t-felt01", evidence: "x" })).status).toBe(400);
  expect((await write({ page: log.id, action: "step", status: "done", block: survey.id, itemId: "t-felt01", evidence: "x" })).status).toBe(404);
  // The public page draws the same states, as glyphs nobody can press.
  const open = await (await get(`/share/p/${log.id}?view=html`, browser, "public")).text();
  expect([...open.matchAll(/<span class="step s-(\w+)" role="img"/g)].map((m) => m[1])).toEqual(["approved", "rejected", "done", "rejected"]);
  expect(open).not.toContain("<button type=\"button\" class=\"step");
});

test("a reader lease comments without disclosing notes, captures under today, and stops when revoked", async () => {
  const ownerPost = (path: string, body: unknown) => publisher.handle(new Request(`http://${HOST}/pub${path}`, {
    method: "POST", headers: { origin: `http://${HOST}`, "content-type": "application/json" }, body: JSON.stringify(body),
  }));
  const lease = await mintReader();
  expect(lease.bookmarklet).toStartWith("javascript:");
  const send = (body: unknown, method = "POST") => publisher.handle(new Request(lease.writeUrl, {
    method, headers: { origin: `http://${HOST}`, authorization: `Bearer ${lease.token}`, "content-type": "application/json" },
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  }));
  const source = "https://field.example/dispatch";
  const comment = await send({ action: "comment", block: letter.id, quote: "allotment committee", body: "Count again #pie-request", source });
  expect(comment.status).toBe(200);
  expect(comment.headers.get("access-control-allow-origin")).toBeNull();
  expect(await comment.json()).toEqual({ ok: true, said: "Saved to the outline" });
  const threads = await client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: letter.id } } });
  const saved = threads.find(t => t.body === "Count again #pie-request")!;
  expect(saved.block.author).toBe("user");
  expect(saved.properties?.via).toEqual([`reader:${lease.id}`]);
  expect(saved.properties?.source).toEqual([source]);
  expect(saved.resolvedTarget?.anchor).toMatchObject({ exact: "allotment committee" });
  const capture = await send({ action: "comment", quote: "A foreign passage", body: "Keep this #pie-request", source });
  expect(capture.status).toBe(200);
  const now = new Date();
  const day = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  const today = store.resolvePageAddress(day).block!;
  const captured = store.children(today.id).find(b => b.text.includes("Keep this #pie-request"))!;
  expect(captured.text).toContain("> A foreign passage");
  expect(captured.text).toContain(`[source::${source}]`);
  expect(captured.author).toBe("user");
  expect(captured.text).toContain(`[via::reader:${lease.id}]`);
  // A lease is no read capability, even when a caller knows a private block id.
  const hidden = await send({ action: "comment", block: ledger.id, quote: "does not occur", body: "Keep my words", source });
  expect(hidden.status).toBe(403);
  expect(await hidden.json()).toEqual({ ok: false, error: "This lease cannot write to that target" });
  try {
    setSystemTime(new Date(Date.parse(lease.expiresAt) + 1));
    expect((await send({ action: "highlight", quote: "Too late", source })).status).toBe(410);
  } finally { setSystemTime(); }
  expect((await send({}, "GET")).status).toBe(405);
  expect((await send({ action: "update", block: letter.id, body: "replace it", source })).status).toBe(400);
  expect((await ownerPost("/reader/revoke", { id: lease.id })).status).toBe(200);
  expect((await send({ action: "highlight", quote: "No more", source })).status).toBe(410);
});

async function mintReader() {
  const response = await publisher.handle(new Request(`http://${HOST}/pub/reader/bookmark`, {
    method: "POST", headers: { origin: `http://${HOST}`, "content-type": "application/json" }, body: JSON.stringify({ block: letter.id }),
  }));
  expect(response.status).toBe(200);
  const bookmark = await response.json();
  await approveReader("https://field.example");
  const minted = await publisher.handle(new Request(`http://${HOST}/pub/_reader/lease`, {
    method: "POST", headers: { origin: `http://${HOST}`, cookie: response.headers.get("set-cookie")!.split(";")[0]!, "content-type": "application/json" },
    body: JSON.stringify({ source: "https://field.example/dispatch", scope: bookmark.id }),
  }));
  expect(minted.status).toBe(200);
  return { ...bookmark, token: (await minted.json()).token, writeUrl: `http://${HOST}/pub/_reader/write` };
}
const sendReader = (lease: { token: string; writeUrl: string }, body: unknown) => publisher.handle(new Request(lease.writeUrl, {
  method: "POST", headers: { origin: `http://${HOST}`, authorization: `Bearer ${lease.token}`, "content-type": "application/json" }, body: JSON.stringify(body),
}));
const readerCapture = { action: "comment", source: "https://field.example/dispatch", quote: "A seed", body: "Keep it" };

test("reader security: unrelated targets give one refusal without writing", async () => {
  const lease = await mintReader();
  for (const block of [ledger.id, survey.id, crypto.randomUUID()]) {
    for (const quote of ["What the plots cost.", "absent words"]) {
      const response = await sendReader(lease, { ...readerCapture, block, quote });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ ok: false, error: "This lease cannot write to that target" });
    }
  }
});

test("reader security: oversized bodies are rejected before parsing", async () => {
  const lease = await mintReader();
  const response = await sendReader(lease, { ...readerCapture, body: "é".repeat(33_000) });
  expect(response.status).toBe(413);
});

test("reader security: lease write budgets have Retry-After", async () => {
  const lease = await mintReader();
  const start = Date.now();
  try {
    for (let minute = 0; minute < 6; minute++) {
      setSystemTime(new Date(start + minute * 61_000));
      for (let i = 0; i < 10; i++) expect((await sendReader(lease, readerCapture)).status).toBe(200);
      const response = await sendReader(lease, readerCapture);
      expect(response.status).toBe(429);
      expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    }
    setSystemTime(new Date(start + 6 * 61_000));
    const response = await sendReader(lease, readerCapture);
    expect(response.status).toBe(429);
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(60);
  } finally { setSystemTime(); }
});

const readerPost = (path: string, body: unknown, cookie = "") => publisher.handle(new Request(`http://${HOST}/pub/${path}`, {
  method: "POST", headers: { origin: `http://${HOST}`, "content-type": "application/json", cookie }, body: JSON.stringify(body),
}));

async function approveReader(source: string, decision = "allow") {
  const popup = await get(`/pub/reader/approve?source=${encodeURIComponent(source)}`);
  const token = (await popup.text()).match(/name="token" value="([^"]+)"/)?.[1];
  if (!token) return popup; // Already approved origins close the popup without another form.
  return readerPost("reader/approve", { source, decision, token }, popup.headers.get("set-cookie")!.split(";")[0]!);
}

test("reader approval refuses a same-host cross-scheme form POST", async () => {
  const response = await publisher.handle(new Request(`https://${HOST}/pub/reader/approve`, {
    method: "POST", headers: { origin: `http://${HOST}` },
    body: new URLSearchParams({ source: "https://attacker.example", decision: "allow" }),
  }));
  expect(response.status).toBe(403);
  expect((await get("/pub/_reader/frame?source=https://attacker.example")).status).toBe(403);
});

test("reader approval tokens belong to one popup origin and browser and can be used only once before expiry", async () => {
  const source = "https://popup.example/article";
  const open = async () => {
    const popup = await get(`/pub/reader/approve?source=${encodeURIComponent(source)}`);
    const token = (await popup.text()).match(/name="token" value="([^"]+)"/)![1];
    return { token, cookie: popup.headers.get("set-cookie")!.split(";")[0]! };
  };
  const first = await open();
  const second = await open();
  const post = (token: string | undefined, cookie = first.cookie, target = source, origin = `http://${HOST}`) =>
    publisher.handle(new Request(`http://${HOST}/pub/reader/approve`, {
      method: "POST", headers: { origin, cookie },
      body: new URLSearchParams({ source: target, decision: "allow", ...(token ? { token } : {}) }),
    }));
  expect((await post(undefined)).status).toBe(403);
  expect((await post("invented")).status).toBe(403);
  expect((await post(first.token, second.cookie)).status).toBe(403);
  expect((await post(first.token, first.cookie, "https://other.example")).status).toBe(403);
  for (const origin of [`https://${HOST}`, `http://${HOST}:8080`, "http://other.example", "null", ""]) {
    expect((await post(first.token, first.cookie, source, origin)).status).toBe(403);
  }
  expect((await get(`/pub/_reader/frame?source=${encodeURIComponent(source)}`)).status).toBe(403);
  const now = Date.now();
  try {
    setSystemTime(new Date(now + 300_001));
    expect((await post(first.token)).status).toBe(403);
  } finally { setSystemTime(); }
  const fresh = await open();
  expect((await post(fresh.token, fresh.cookie)).status).toBe(200);
  expect((await post(fresh.token, fresh.cookie)).status).toBe(403);
  expect((await get(`/pub/_reader/frame?source=${encodeURIComponent(source)}`)).status).toBe(200);
  await readerPost("reader/origin-revoke", { source });
});

test("reader approval uses the configured HTTPS tailnet origin behind an HTTP proxy", async () => {
  const proxied = new Publisher({ client, basePath: "/pub", url: `https://${HOST}/pub` });
  await proxied.start();
  try {
    const source = "https://proxy-reader.example";
    const url = `http://${HOST}/pub/reader/approve`;
    const popup = await proxied.handle(new Request(`${url}?source=${encodeURIComponent(source)}`));
    const token = (await popup.text()).match(/name="token" value="([^"]+)"/)![1];
    expect(popup.headers.get("set-cookie")).toContain("; Secure");
    const cookie = popup.headers.get("set-cookie")!.split(";")[0]!;
    const post = (origin: string) => proxied.handle(new Request(url, {
      method: "POST", headers: { origin, cookie },
      body: new URLSearchParams({ source, token, decision: "allow" }),
    }));
    expect((await post(`http://${HOST}`)).status).toBe(403);
    expect((await post(`https://${HOST}`)).status).toBe(200);
  } finally { await proxied.stop(); }
});

test("reader approval blocks unapproved origins and revocation stops existing leases", async () => {
  const response = await readerPost("reader/bookmark", {});
  const bookmark = await response.json();
  const cookie = response.headers.get("set-cookie")!.split(";")[0]!;
  const source = "https://unapproved.example/article";
  const mint = () => readerPost("_reader/lease", { source, scope: bookmark.id }, cookie);
  expect((await mint()).status).toBe(403);
  expect((await get(`/pub/_reader/frame?source=${encodeURIComponent(source)}&scope=${bookmark.id}`, { cookie })).status).toBe(403);
  expect((await approveReader(source, "deny")).status).toBe(200);
  expect((await mint()).status).toBe(403);
  expect((await approveReader(source)).status).toBe(200);
  const minted = await mint();
  expect(minted.status).toBe(200);
  const token = (await minted.json()).token;
  expect(await page("/pub/reader")).toContain("https://unapproved.example");
  const frame = await get(`/pub/_reader/frame?source=${encodeURIComponent(source)}&scope=${bookmark.id}`, { cookie });
  expect(frame.headers.get("content-security-policy")).toContain("frame-ancestors https://unapproved.example");
  let finish!: () => void;
  const pending = publisher.handle(new Request(`http://${HOST}/pub/_reader/write`, {
    method: "POST", headers: { origin: `http://${HOST}`, authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: new ReadableStream({ start(controller) {
      controller.enqueue(new TextEncoder().encode(JSON.stringify({ ...readerCapture, source })));
      finish = () => controller.close();
    } }),
  }));
  expect((await readerPost("reader/origin-revoke", { source })).status).toBe(200);
  finish();
  expect((await pending).status).toBe(403);
  expect((await mint()).status).toBe(403);
  expect((await sendReader({ token, writeUrl: `http://${HOST}/pub/_reader/write` }, { ...readerCapture, source })).status).toBe(403);
});

test("reader installation and approval cannot be framed", async () => {
  for (const path of ["/pub/reader", "/pub/reader/approve?source=https%3A%2F%2Ffield.example%2Farticle"]) {
    const response = await get(path);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
  }
});

test("older reader bookmarks retain their day and block after another bookmark is installed", async () => {
  const source = "https://field.example/dispatch";
  const make = async (block: string) => {
    const response = await readerPost("reader/bookmark", { block });
    return { ...await response.json(), cookie: response.headers.get("set-cookie")!.split(";")[0]! };
  };
  try {
    setSystemTime(new Date(2030, 4, 1, 23, 50));
    const first = await make(letter.id);
    setSystemTime(new Date(2030, 4, 2, 0, 5));
    const secondBlock = store.create("Other public page [publish::public]\nAnother passage", null, "user");
    const second = await make(secondBlock.id);
    // Model a browser cookie jar: a newer cookie replaces only the same cookie name.
    const jar = new Map<string, string>();
    for (const cookie of [first.cookie, second.cookie]) jar.set(cookie.split("=")[0], cookie);
    const cookie = [...jar.values()].join("; ");
    await approveReader(source);
    for (const [bookmark, block, day] of [[first, letter, "2030-05-01"], [second, secondBlock, "2030-05-02"]] as const) {
      const minted = await readerPost("_reader/lease", { source, scope: bookmark.id }, cookie);
      expect(minted.status).toBe(200);
      const lease = { token: (await minted.json()).token, writeUrl: `http://${HOST}/pub/_reader/write` };
      expect((await sendReader(lease, { ...readerCapture, block: block.id })).status).toBe(200);
      expect((await sendReader(lease, { ...readerCapture, body: bookmark.id })).status).toBe(200);
      expect(store.children(store.resolvePageAddress(day).block!.id).some(b => b.text.includes(bookmark.id))).toBe(true);
    }
  } finally { setSystemTime(); }
});

// The front page (Oct 25): a note marked [publish-home::true] is the top level's page, with every root note one link
// away; what tools write ([machine::…]) is folded below the rest of a folder, never mixed into it.
test("the top level: tool-written notes fold away, and a [publish-home::true] note is the front page with every note one link away", async () => {
  const snap = store.create("Snapshot of garden [machine::snapshot]", null, "user");
  const before = await page("/pub/");
  const [listed, folded] = before.split('<details class="machinery">');
  expect(listed).toContain("Field notes");
  expect(listed).not.toContain("Snapshot of garden");
  expect(folded).toContain("Snapshot of garden");
  expect(folded).toMatch(/<summary>1 written by tools/);
  expect(listed).toMatch(/<h2>Inside <span class="dim">\d+ · 1 by tools<\/span><\/h2>/);

  const porch = store.create("Front porch [publish-home::true]\nWhat the garden is doing this week.", null, "user");
  await until("the front page", async () => (await page("/pub/")).includes("What the garden is doing this week."));
  const front = await page("/pub/");
  expect(front).toContain(`<a href="/pub/?all">every note</a>`);
  expect(front).toMatch(/<footer>updated /);
  expect(front).toContain(`/pub/index">published notes</a>`);
  const all = await page("/pub/?all");
  expect(all).not.toContain("every note");
  expect(all).toContain("Field notes");
  expect(all).toContain("Front porch");

  // Locked, it is no front page: the folder again.
  await edit(porch, "Front porch [publish-home::true] [publish::never]\nWhat the garden is doing this week.");
  await until("the folder again", async () => !(await page("/pub/")).includes("every note"));
  store.delete(porch.id);
  store.delete(snap.id);
});

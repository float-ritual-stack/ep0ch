// The readwise example extension (PIE-743), end to end: a scratch outline host serving two outlines (a garden of
// notes and the readwise board), the repo's extensions/readwise copied into its user folder, a with-secrets group in
// a temp folder, and a fake Readwise on localhost. Every note, book, highlight and token is made up; the real API is
// never called.
import { afterEach, expect, test } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { createOutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
import type { Block } from "../src/types";

const EXTENSION = join(import.meta.dir, "..", "extensions", "readwise");
const TOKEN = "tok-made-up-readwise-0042";
const MACHINE = "test-box";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface FakeHighlight { id: number; text: string; note?: string; color?: string; tags?: { name: string }[]; highlighted_at?: string; is_deleted?: boolean }
interface FakeBook { user_book_id: number; title: string; author?: string; category?: string; source?: string; source_url?: string; unique_url?: string; document_note?: string; highlights: FakeHighlight[] }

/** A made-up Readwise: Reader's save and Readwise's export, as their docs describe them, with a bearer check. */
function fakeReadwise() {
  const saved: Array<Record<string, unknown>> = [];
  const exports: string[] = [];
  const state = { pages: [] as FakeBook[][], status: 0, limited: 0 };
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(request) {
      const url = new URL(request.url);
      if (request.headers.get("authorization") !== `Token ${TOKEN}`) return new Response("{}", { status: 401 });
      if (state.status) return new Response("{}", { status: state.status });
      if (url.pathname === "/api/v3/save/" && request.method === "POST") {
        const body = (await request.json()) as Record<string, unknown>;
        const already = saved.find((doc) => doc.url === body.url);
        if (!already) saved.push(body);
        const id = `doc-${saved.findIndex((doc) => doc.url === body.url) + 1}`;
        return Response.json({ id, url: `https://read.example.invalid/read/${id}` }, { status: already ? 200 : 201 });
      }
      if (url.pathname === "/api/v2/export/") {
        exports.push(url.search);
        if (state.limited > 0) {
          state.limited--;
          return new Response("{}", { status: 429, headers: { "Retry-After": "1" } });
        }
        const page = Number(url.searchParams.get("pageCursor") ?? "0");
        const results = state.pages[page] ?? [];
        const next = page + 1 < state.pages.length ? String(page + 1) : null;
        return Response.json({ count: results.length, nextPageCursor: next, results });
      }
      return new Response("{}", { status: 404 });
    },
  });
  cleanups.push(() => server.stop(true));
  return { api: `http://127.0.0.1:${server.port}`, saved, exports, state };
}

/** One request on its own connection, as clients send it. */
function send<T>(socket: string, request: Record<string, unknown>): Promise<T> {
  return new Promise((resolve, reject) => {
    const connection = createConnection(socket);
    let buffer = "";
    connection.setEncoding("utf8");
    connection.on("error", reject);
    connection.once("connect", () => connection.write(`${JSON.stringify({ id: crypto.randomUUID(), ...request })}\n`));
    connection.on("data", (chunk: string) => {
      buffer += chunk;
      const end = buffer.indexOf("\n");
      if (end < 0) return;
      connection.destroy();
      const response = JSON.parse(buffer.slice(0, end)) as { ok: boolean; result?: T; error?: string };
      if (response.ok) resolve(response.result as T);
      else reject(new Error(response.error));
    });
  });
}

async function setup() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "readwise-ext-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  const fake = fakeReadwise();
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS, secrets: process.env.WITH_SECRETS_DIR };
  const userExtensions = join(root, "user-extensions");
  const secrets = join(root, "secrets");
  mkdirSync(secrets, { recursive: true, mode: 0o700 });
  writeFileSync(join(secrets, "readwise.env"), `# made up\nREADWISE_TOKEN=${TOKEN}\nOTHER=not-for-readwise\n`, { mode: 0o600 });
  cpSync(EXTENSION, join(userExtensions, "readwise"), { recursive: true });
  writeFileSync(join(userExtensions, "readwise", "config.json"), JSON.stringify({ config: { api: fake.api, machine: MACHINE } }));
  process.env.OUTLINER_EXTENSIONS_DIR = userExtensions;
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-legacy-registry.json");
  process.env.WITH_SECRETS_DIR = secrets;
  const outlines = outlineLayout(join(root, "outlines"));
  const host = new OutlineHost({ outlinesFolder: outlines.root, log: () => {} });
  await host.start();
  cleanups.push(async () => {
    await host.close();
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry], ["WITH_SECRETS_DIR", previous.secrets]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const socket = host.socketPath;
  await send(socket, { action: "outlines.create", name: "garden" });
  await send(socket, { action: "outlines.create", name: "readwise" });
  const call = <T>(outline: string, request: Record<string, unknown>) => send<T>(socket, { outline, ...request });
  const listed = await call<{ extensions: Array<{ id: string; state: string; error?: string }> }>("garden", { action: "extensions.list", reload: true });
  expect(listed.extensions.find((entry) => entry.id === "readwise")).toMatchObject({ state: "active" });
  const act = (outline: string, action: string, blockId?: string) =>
    call<{ message: string }>(outline, { action: "extensions.act", extension: "readwise", extensionAction: action, ...(blockId ? { blockId } : {}), mutation: { author: "user" } });
  const create = (outline: string, text: string, parentId?: string) => call<Block>(outline, { action: "create", text, author: "user", ...(parentId ? { parentId } : {}) });
  const children = (outline: string, parentId: string) => call<Block[]>(outline, { action: "children", parentId });
  const threads = (outline: string, blockId: string) =>
    call<Array<{ block: Block; body: string; properties?: Record<string, string[]>; resolvedTarget: { quote?: string; exact?: string } | null }>>(outline,
      { action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
  return { root, fake, socket, call, act, create, children, threads };
}

/** A publisher for one outline, connected as `publish serve` is: it tells the service where it is opened. */
async function publisherFor(socket: string, outline: string, url: string) {
  const publisher = new Publisher({ client: createOutlinerClient({ socket, mode: "host", outline }), url });
  await publisher.start();
  cleanups.push(() => publisher.stop());
  return publisher;
}

const NOTE = "Pond notes [type::journal]\n\nThe heron came back on Tuesday and stood very still.\n\nMoss grows on the north side of the shed.";

test("send saves a note and the notes under it to Reader as one document that links back; sending again says it's there", async () => {
  const { fake, act, create } = await setup();
  const note = await create("garden", NOTE);
  await create("garden", "Later: the heron left at dusk.", note.id);
  const sent = await act("garden", "send", note.id);
  expect(sent.message).toBe('saved "Pond notes" to Reader: https://read.example.invalid/read/doc-1');
  expect(fake.saved).toHaveLength(1);
  const doc = fake.saved[0]!;
  expect(doc).toMatchObject({ url: `https://ep0ch.invalid/garden@${MACHINE}/b/${note.id}`, title: "Pond notes", tags: ["ep0ch"], should_clean_html: false });
  // The publisher's rendering (notes.render): what the note's published page reads, its properties out.
  const html = String(doc.html);
  expect(html).toContain(`ep0ch://garden@${MACHINE}/b/${note.id}`);
  expect(html).toContain("<h1>Pond notes</h1>");
  expect(html).toContain("<p>The heron came back on Tuesday and stood very still.</p>");
  expect(html).toContain("<li>Later: the heron left at dusk.</li>");
  expect(html).not.toContain("[type::journal]");
  expect((await act("garden", "send", note.id)).message).toStartWith("already in Reader: https://read.example.invalid/read/doc-1");
  expect(fake.saved).toHaveLength(1);
});

test("pull: a highlight on a sent note becomes an annotation at its passage; others land on the readwise board; twice writes nothing new", async () => {
  const { fake, call, act, create, children, threads } = await setup();
  const note = await create("garden", NOTE);
  const later = await create("garden", "Later: the heron left at dusk.", note.id);
  await act("garden", "send", note.id);
  const sentUrl = String(fake.saved[0]!.url);
  const fromNote: FakeBook = {
    user_book_id: 7, title: "Pond notes", category: "articles", source: "reader", source_url: sentUrl, unique_url: "https://read.example.invalid/read/doc-1",
    highlights: [
      { id: 101, text: "The heron came back on Tuesday", note: "Same heron as last spring?", color: "yellow", tags: [{ name: "birds" }] },
      { id: 102, text: "the heron left at dusk" },
      { id: 103, text: "words that were never in the note", note: "a stray" },
      { id: 104, text: "deleted words", is_deleted: true },
    ],
  };
  const book: FakeBook = {
    user_book_id: 8, title: "Pond Days", author: "Ann Example", category: "books", source: "kindle", document_note: "A made-up book about ponds.",
    highlights: [
      { id: 201, text: "Moss keeps its own calendar.\nAnd never shares it.", highlighted_at: "2026-09-30T10:00:00Z", tags: [{ name: "moss" }] },
      { id: 202, text: "Stand still on purpose, see [[Herons]] and [mood::calm].", note: "try this" },
    ],
  };
  fake.state.pages = [[fromNote], [book]];
  fake.state.limited = 1;

  const first = await act("garden", "pull");
  expect(first.message).toBe("pulled: 5 new, 0 changed (3 on notes, 2 on the readwise board, 1 on a whole note: their words aren't in it now)");
  expect(fake.exports).toHaveLength(3);

  // On the note, at the passage: kind=highlight, the note on it as the body, its tone and tags.
  const onNote = await threads("garden", note.id);
  const heron = onNote.find((thread) => thread.properties?.["readwise.highlight"]?.[0] === "101")!;
  expect(heron.body).toBe("Same heron as last spring?");
  expect(heron.properties).toMatchObject({ kind: ["highlight"], color: ["warn"], tags: ["birds"] });
  expect(heron.block).toMatchObject({ author: "agent", actorId: "ext:readwise" });
  expect(JSON.stringify(heron.resolvedTarget)).toContain("The heron came back on Tuesday");
  // On the note under it, where its words are.
  const dusk = (await threads("garden", later.id)).find((thread) => thread.properties?.["readwise.highlight"]?.[0] === "102")!;
  expect(dusk.body).toBe("");
  expect(JSON.stringify(dusk.resolvedTarget)).toContain("the heron left at dusk");
  // Words no longer in the note: on the whole note, the quote kept in the body.
  const stray = onNote.find((thread) => thread.properties?.["readwise.highlight"]?.[0] === "103")!;
  expect(stray.body).toBe("> words that were never in the note\n\na stray");
  expect(stray.properties?.["readwise.anchored"]).toEqual(["no"]);
  expect(onNote.some((thread) => thread.properties?.["readwise.highlight"]?.[0] === "104")).toBe(false);

  // On the board: the page, a block per book, a block per highlight; imported words stay words.
  const page = (await call<{ status: string; block: Block }>("readwise", { action: "pages.resolve", address: "readwise" })).block;
  expect(page.text.split("\n")[0]).toMatch(/^Readwise \[page::readwise\] \[readwise\.synced::\d{4}-/);
  const books = await children("readwise", page.id);
  expect(books.map((b) => b.text.split("\n")[0])).toEqual(["Pond Days — Ann Example"]);
  expect(books[0]!.text).toContain("[readwise.book::8] [readwise.category::books] [readwise.source::kindle] [readwise.author::Ann Example]");
  expect(books[0]!.text).toEndWith("A made-up book about ponds.");
  const highlights = await children("readwise", books[0]!.id);
  expect(highlights.map((h) => h.text)).toEqual([
    "Moss keeps its own calendar. And never shares it.\n[readwise.highlight::201] [highlighted::2026-09-30] [tags::moss]\n\n> Moss keeps its own calendar.\n> And never shares it.",
    "Stand still on purpose, see Herons and mood::calm.\n[readwise.highlight::202]\n\n> Stand still on purpose, see [\\[Herons]] and \\[mood::calm].\n\ntry this",
  ]);
  expect(highlights.every((h) => h.actorId === "ext:readwise")).toBe(true);
  const props = await call<{ blocks: Block[] }>("readwise", { action: "blocks.query", query: { where: "mood=calm", limit: 5 } });
  expect(props.blocks).toHaveLength(0);

  // Twice: nothing new, and the next pull asks only for what changed since.
  const second = await act("garden", "pull");
  expect(second.message).toBe("pulled: nothing new in 5 highlights");
  expect(fake.exports.at(-1)).toContain("updatedAfter=");
  expect(await threads("garden", note.id)).toHaveLength(onNote.length);
  expect(await children("readwise", books[0]!.id)).toHaveLength(2);
  expect(await children("readwise", page.id)).toHaveLength(1);

  // A changed note on a highlight updates what's there, on the note and on the board.
  fromNote.highlights[0]!.note = "Same heron, surely.";
  fromNote.highlights[2]!.note = "still a stray";
  book.highlights[1]!.note = "tried it";
  const third = await act("garden", "pull");
  expect(third.message).toBe("pulled: 0 new, 3 changed (3 on notes, 2 on the readwise board)");
  const strayNow = (await threads("garden", note.id)).find((thread) => thread.properties?.["readwise.highlight"]?.[0] === "103")!;
  expect(strayNow.body).toBe("> words that were never in the note\n\nstill a stray");
  const updated = (await threads("garden", note.id)).filter((thread) => thread.properties?.["readwise.highlight"]?.[0] === "101");
  expect(updated.map((thread) => thread.body)).toEqual(["Same heron, surely."]);
  expect((await children("readwise", books[0]!.id))[1]!.text).toEndWith("tried it");

  // The token reached Readwise and nowhere else.
  for (const outline of ["garden", "readwise"]) {
    const found = await call<{ blocks: Block[] }>(outline, { action: "blocks.query", query: { text: TOKEN, limit: 5 } });
    expect(found.blocks).toHaveLength(0);
  }
});

test("once per host: the pull's schedule is one outline's; pulls asked in two outlines at once run one after the other, and nothing is written twice", async () => {
  const { fake, call, act, children } = await setup();
  fake.state.pages = [[{ user_book_id: 9, title: "Shed Almanac", highlights: [{ id: 301, text: "The shed door creaks louder on days with mail." }] }]];
  // A pull in each outline at once: the host runs a host-wide action one at a time, so the second finds it done.
  const runs = await Promise.all(["garden", "readwise"].map((outline) => act(outline, "pull")));
  expect(runs.map((run) => run.message).sort()).toEqual(["pulled: 1 new, 0 changed (0 on notes, 1 on the readwise board)", "pulled: nothing new in 1 highlight"]);
  const page = (await call<{ block: Block }>("readwise", { action: "pages.resolve", address: "readwise" })).block;
  const books = await children("readwise", page.id);
  expect(books).toHaveLength(1);
  expect(await children("readwise", books[0]!.id)).toHaveLength(1);
  // No claim on the board page any more: only the cursor.
  expect(page.text).not.toContain("readwise.claim");
  type Listed = { extensions: Array<{ id: string; schedules?: Array<{ entry: string; once?: string; runsIn?: string }> }> };
  const schedule = async (outline: string) => (await call<Listed>(outline, { action: "extensions.list" })).extensions.find((e) => e.id === "readwise")!.schedules![0]!;
  // One outline's runner holds the hourly pull (the first to tick); the other lists where it runs.
  const [garden, board] = [await schedule("garden"), await schedule("readwise")];
  expect(garden.once).toBe("host");
  expect(board.once).toBe("host");
  const holders = [garden.runsIn ?? "garden", board.runsIn ?? "readwise"];
  expect(holders[0]).toBe(holders[1]);
});

test("a published note's link in Reader is its permalink, and a highlight on it comes back to it", async () => {
  const { fake, socket, call, act, create, threads } = await setup();
  await publisherFor(socket, "garden", "https://pub.example.invalid/pub");
  const note = await create("garden", "Shed notes [publish::shed]\n\nThe shed door sticks in the rain.");
  const address = await call<{ outline: string; machine: string; uri: string; published: { slug: string; url: string; permalink: string } }>("garden", { action: "notes.address", blockId: note.id });
  expect(address.published).toEqual({ slug: "shed", public: false, url: "https://pub.example.invalid/pub/p/shed", permalink: `https://pub.example.invalid/pub/p/${note.id}` } as never);
  await act("garden", "send", note.id);
  expect(fake.saved[0]!.url).toBe(`https://pub.example.invalid/pub/p/${note.id}?ep0ch=garden@${MACHINE}`);
  fake.state.pages = [[{ user_book_id: 11, title: "Shed notes", source_url: String(fake.saved[0]!.url), highlights: [{ id: 501, text: "sticks in the rain", note: "plane the edge" }] }]];
  expect((await act("garden", "pull")).message).toBe("pulled: 1 new, 0 changed (1 on notes, 0 on the readwise board)");
  expect((await threads("garden", note.id)).map((thread) => thread.body)).toEqual(["plane the edge"]);
});

test("a [publish::never] note isn't sent", async () => {
  const { fake, act, create } = await setup();
  const note = await create("garden", "Private [publish::never]\n\nNot for anywhere else.");
  expect((await act("garden", "send", note.id)).message).toContain("[publish::never]");
  expect(fake.saved).toHaveLength(0);
});

test("a refused token, a missing board outline, and the token never in the extension's folder", async () => {
  const { fake, root, act, create } = await setup();
  const note = await create("garden", NOTE);
  fake.state.status = 401;
  await expect(act("garden", "send", note.id)).rejects.toThrow();
  fake.state.status = 0;
  // A board outline nobody made: the exact command to make it.
  writeFileSync(join(root, "user-extensions", "readwise", "config.json"), JSON.stringify({ config: { api: fake.api, machine: MACHINE, board: "reading-room" } }));
  await send(join(root, "outlines", ".host", "host.sock"), { outline: "garden", action: "extensions.list", reload: true });
  expect((await act("garden", "pull")).message).toBe("readwise: there's no reading-room outline yet: run `ep0ch init reading-room` (or set config.board)");
  for (const file of readdirSync(EXTENSION)) expect(readFileSync(join(EXTENSION, file), "utf8")).not.toContain(TOKEN);
});

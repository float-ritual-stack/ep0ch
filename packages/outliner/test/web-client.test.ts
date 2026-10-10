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
  return (await response.json()) as { generation: number; choices: { action: string }[]; threads: { id: string; kind: string; body: string; by: string; quote: string; replies: { by: string; body: string }[] }[] };
};
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

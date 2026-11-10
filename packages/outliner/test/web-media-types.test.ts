// A `[web::…]` page reads by what it is (PIE-1694): HTML is extracted to Markdown, a Markdown or plain-text page is
// its own text, a page that names no media type is read by its first bytes, and anything else says what it was.
// Served by a real HTTP server, so the headers are the ones a page sends, not a stub's.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerStore } from "../src/store";
import type { WebMarkdownExtractor } from "../src/web-markdown";

const NOTES = "# Garden notes\n\nWater at  dawn, <kbd>not</kbd> noon &amp; never late.\n\n    indented: code block\n\n- peas\n  - snap\n";
const PAGES: Record<string, { type?: string; body: string; etag?: string }> = {
  "/notes.md": { type: "text/markdown; charset=utf-8", body: NOTES, etag: '"notes-1"' },
  // An empty Content-Type a server's default was added to, as Bun.serve sends it: ", text/plain;charset=utf-8".
  "/plain.txt": { type: ", text/plain;charset=utf-8", body: "Seed list\n  1. beans\n  2. kale\n" },
  "/bare.md": { body: "# Bare\n\nNo media type named.\n" },
  "/bare.html": { body: "<!doctype html><html><body><h1>Bare page</h1><p>Still HTML.</p></body></html>" },
  "/binary": { type: "application/octet-stream", body: "\u0000\u0001" },
  "/bare-binary": { body: "\u0000\u0001\u0002" },
  // Markdown that opens with an autolink, served with no media type: a `<` that isn't an HTML tag.
  "/bare-autolink.md": { body: "<https://example.com/guide>\n\nRead  it twice.\n" },
  "/bare-comment.html": { body: "<!-- kept -->\n<p>Comment first.</p>" },
  // The same bytes and ETag, served first as text/plain, then as text/html (`switched` flips it).
  "/switch": { type: "text/plain", body: "<p>Same bytes</p>", etag: '"switch-1"' },
};
let switched: false | "full" | "304" = false;

let server: Server;
let base = "";
let requests: Array<{ path: string; accept: string | undefined }> = [];

beforeAll(async () => {
  server = createServer((request, response) => {
    const path = request.url ?? "/";
    requests.push({ path, accept: request.headers.accept });
    const page = PAGES[path];
    if (!page) { response.statusCode = 404; response.end(); return; }
    const fresh = path === "/switch" && switched === "full";
    if (page.etag && !fresh && request.headers["if-none-match"] === page.etag) { response.statusCode = 304; response.end(); return; }
    if (path === "/switch" && switched) response.setHeader("content-type", "text/html");
    else if (page.type !== undefined) response.setHeader("content-type", page.type);
    if (page.etag) response.setHeader("etag", page.etag);
    response.end(page.body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});
afterAll(() => { server.close(); });

function web(store: OutlinerStore, path: string) {
  const source = store.resources.listSources().find((entry) => entry.provider === "web") ??
    store.resources.createSource({ name: "Garden", provider: "web", boundary: { baseUrl: `${base}/` } });
  return store.resources.intern({ sourceId: source.id, address: { kind: "web", url: `${base}${path}` } }).resource;
}

test("a page served as Markdown reads as its own text, and asks for it (PIE-1694)", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-web-media-"));
  const database = join(root, "garden.sqlite");
  let store = new OutlinerStore(database);
  try {
    requests = [];
    const notes = web(store, "/notes.md");
    const read = await store.resources.refreshWeb(notes.id, true);
    expect(read.webStatus).toMatchObject({ freshness: "fresh", lastError: null });
    expect(read.web?.markdown).toBe(NOTES);
    expect(requests[0]?.accept).toContain("text/markdown");

    // Unchanged (304): the stored text stands, not re-read as HTML.
    const again = await store.resources.refreshWeb(notes.id, true);
    expect(again.web?.representation.id).toBe(read.web?.representation.id);
    expect(again.web?.markdown).toBe(NOTES);
    store.close();

    // A newer HTML extractor leaves a Markdown page's text alone: it was never HTML.
    const replacement: WebMarkdownExtractor = {
      adapter: { id: "fixture.html", version: 7 },
      extract: () => "REPLACED BY THE HTML EXTRACTOR",
    };
    store = new OutlinerStore(database, { webExtractor: replacement });
    const after = await store.resources.refreshWeb(notes.id, true);
    expect(after.webStatus?.freshness).toBe("fresh");
    expect(after.web?.markdown).toBe(NOTES);
    expect((await store.resources.open(notes.id, true)).web?.markdown).toBe(NOTES);
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("plain text reads as text; a page with no media type is read by its bytes; the rest say what they were (PIE-1694)", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-web-media-"));
  const store = new OutlinerStore(join(root, "garden.sqlite"));
  try {
    const plain = await store.resources.refreshWeb(web(store, "/plain.txt").id, true);
    expect(plain.webStatus?.lastError).toBeNull();
    expect(plain.web?.markdown).toBe(PAGES["/plain.txt"]!.body);

    const bareText = await store.resources.refreshWeb(web(store, "/bare.md").id, true);
    expect(bareText.web?.markdown).toBe(PAGES["/bare.md"]!.body);

    const bareHtml = await store.resources.refreshWeb(web(store, "/bare.html").id, true);
    expect(bareHtml.web?.markdown).toBe("# Bare page\n\nStill HTML.");

    const binary = await store.resources.refreshWeb(web(store, "/binary").id, true);
    expect(binary.webStatus?.freshness).toBe("failed");
    expect(binary.webStatus?.lastError).toBe(
      "Web provider returned unsupported media type: application/octet-stream (it reads text/html, text/markdown and text/plain)",
    );

    const bareBinary = await store.resources.refreshWeb(web(store, "/bare-binary").id, true);
    expect(bareBinary.webStatus?.lastError).toBe(
      "Web provider returned no media type, and the page isn't text",
    );
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("a snapshot's kind is its current representation's: the same bytes served as HTML stay HTML after a 304 (PIE-1694)", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-web-media-"));
  const store = new OutlinerStore(join(root, "garden.sqlite"));
  try {
    const page = web(store, "/switch");
    switched = false;
    expect((await store.resources.refreshWeb(page.id, true)).web?.markdown).toBe("<p>Same bytes</p>");
    switched = "full";
    expect((await store.resources.refreshWeb(page.id, true)).web?.markdown).toBe("Same bytes");
    switched = "304";
    expect((await store.resources.refreshWeb(page.id, true)).web?.markdown).toBe("Same bytes");
  } finally {
    switched = false;
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("with no media type, only an HTML signature means HTML: an autolink first is Markdown (PIE-1694)", async () => {
  const root = mkdtempSync(join(tmpdir(), "outliner-web-media-"));
  const store = new OutlinerStore(join(root, "garden.sqlite"));
  try {
    expect((await store.resources.refreshWeb(web(store, "/bare-autolink.md").id, true)).web?.markdown).toBe(PAGES["/bare-autolink.md"]!.body);
    expect((await store.resources.refreshWeb(web(store, "/bare-comment.html").id, true)).web?.markdown).toBe("Comment first.");
  } finally {
    store.close();
    rmSync(root, { recursive: true, force: true });
  }
});

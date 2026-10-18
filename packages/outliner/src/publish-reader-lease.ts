import { randomBytes } from "node:crypto";
import { sameOrigin } from "./publish-page";
import { findDrawnPassage } from "./publish-passage";
import { createBlockComment } from "./block-comments";
import type { PageHost } from "./publish-page";
import type { Block, PageAddressFollowResult } from "./types";

const escapeHtml = Bun.escapeHTML;

interface Lease { id: string; expiresAt: number; ended: boolean }
const headers = { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer", "access-control-allow-origin": "*", "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "content-type" };
const answer = (status: number, body: unknown) => Response.json(body, { status, headers });
let script: Promise<string> | undefined;
function readerScript(): Promise<string> {
  return script ??= Bun.build({ entrypoints: [new URL("./publish-reader.js", import.meta.url).pathname], minify: true, target: "browser" }).then(async build => {
    if (!build.success) throw new Error("Reader script could not be built");
    return build.outputs[0]!.text();
  });
}

/** A publisher owns these one-hour write leases; restarting it ends them too. No lease grants a read. */
export class ReaderLeases {
  private readonly leases = new Map<string, Lease>();
  constructor(private readonly host: Pick<PageHost, "request" | "writes">, private readonly style: string) {}

  async owner(request: Request, route: string, endpoint: string): Promise<Response> {
    if (request.method === "GET" && route === "/reader") {
      return this.page(`<h1>Reader on any page</h1><p>Make a one-hour bookmarklet for this outline. Select words on a page, then use Highlight, Comment or Ask. A block anchor receives a quote comment; other pages become captures under today, with their source URL. Type #pie-request as you would in a note.</p><form method="post" action="reader/lease"><button>Make bookmarklet</button></form><h2>Demo</h2><p>Select these words after installing the bookmarklet: a seed worth keeping.</p><p>This page has no block anchor, so its selection lands under today. Try a published note next to comment on its block.</p>`);
    }
    if (request.method !== "POST") return answer(405, { ok: false });
    if (!sameOrigin(request)) return answer(403, { ok: false });
    if (route === "/reader/revoke") {
      const input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
      for (const lease of this.leases.values()) if (lease.id === input.id) lease.ended = true;
      return answer(200, { ok: true });
    }
    if (route !== "/reader/lease") return answer(404, { ok: false });
    const why = await this.host.writes(true);
    if (why) return answer(403, { ok: false, error: why });
    for (const [token, lease] of this.leases) if (lease.ended || lease.expiresAt <= Date.now()) this.leases.delete(token);
    const token = randomBytes(32).toString("base64url");
    const lease = { id: crypto.randomUUID(), expiresAt: Date.now() + 3_600_000, ended: false };
    this.leases.set(token, lease);
    const writeUrl = `${endpoint}/${token}`;
    const code = `(function(){window.__ep0chReaderLease=${JSON.stringify({ url: writeUrl, style: this.style })};${await readerScript()}})();`;
    const bookmarklet = `javascript:${encodeURIComponent(code)}`;
    if (request.headers.get("content-type")?.includes("application/json")) return answer(200, { id: lease.id, expiresAt: new Date(lease.expiresAt).toISOString(), writeUrl, bookmarklet });
    return this.page(`<h1>Reader on any page</h1><p>Drag <a href="${escapeHtml(bookmarklet)}">ep0ch reader</a> to your bookmarks. It expires ${escapeHtml(new Date(lease.expiresAt).toISOString())}. Select words on any page and click the bookmark.</p><p>Pages that block bookmarklets or cross-origin connections cannot use this reader. A failed send keeps your words in the box.</p><form method="post" action="revoke"><input type="hidden" name="id" value="${lease.id}"><button>End this lease</button></form><p>Demo: select this sentence to capture it under today.</p>`);
  }

  private page(body: string): Response {
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Reader on any page</title><style>body{background:#111;color:#ddd;font:18px/1.5 system-ui;max-width:42rem;margin:2rem auto;padding:1rem}a{color:#bcd}</style>${body}`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  async write(request: Request, token: string): Promise<Response> {
    const lease = this.leases.get(token);
    if (!lease || lease.ended || lease.expiresAt <= Date.now()) return answer(410, { ok: false, error: "Lease ended: make a new bookmarklet on the outline's /reader page" });
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return answer(405, { ok: false });
    let input;
    try { input = await request.json(); } catch { return answer(400, { ok: false, error: "Send JSON" }); }
    if (!input || !["highlight", "comment", "ask"].includes(input.action) || typeof input.source !== "string" || typeof input.quote !== "string" || (input.body !== undefined && typeof input.body !== "string") || (input.block !== undefined && typeof input.block !== "string")) return answer(400, { ok: false, error: "Send a highlight, comment or ask with its quote and source URL" });
    let source: string;
    try {
      const url = new URL(input.source);
      if (!["https:", "http:"].includes(url.protocol)) throw new Error();
      source = url.href.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
    } catch { return answer(400, { ok: false, error: "Source must be the page's http(s) URL" }); }
    const why = await this.host.writes(true);
    if (why) return answer(403, { ok: false, error: "This outline is not taking writes; your text is still here" });
    if (lease.ended || lease.expiresAt <= Date.now()) return answer(410, { ok: false, error: "Lease ended: make a new bookmarklet" });
    const body = input.body ?? "";
    const quoted = input.quote.split(/\r?\n/).map((line: string) => `> ${line}`).join("\n");
    const properties = { source, via: `reader:${lease.id}`, ...(input.action === "ask" ? { kind: "question" } : input.action === "highlight" ? { kind: "highlight" } : {}) };
    let said = "Saved to the outline";
    try {
      if (input.block) {
        const block = await this.host.request<Block>({ action: "get", blockId: input.block });
        const found = findDrawnPassage([block], { quote: input.quote, prefix: "", suffix: "" });
        if (!found.ok) said = "Saved on the block with your quote; the selection could not be anchored";
        await createBlockComment(this.host, { requestId: crypto.randomUUID(), author: "user", input: {
          blockId: block.id, expectedRevision: block.revision, source: "user", properties,
          body: found.ok ? body : `${quoted}\n\n${body}`,
          ...(found.ok ? { passage: { quote: found.passage.quote, start: found.passage.start } } : {}),
        } });
      } else {
        const date = new Date();
        const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
        const today = await this.host.request<PageAddressFollowResult>({ action: "pages.follow", address: day, author: "user" });
        if (!today.block || today.status !== "resolved") throw new Error("Today is unavailable");
        await this.host.request({ action: "notes.create", text: `Web capture [source::${source}] [via::reader:${lease.id}]\n\n${quoted}\n\n${body}`, intent: { kind: "note", near: today.block.id, nearOnly: true }, author: "user" });
      }
      return answer(200, { ok: true, said });
    } catch {
      // Service errors can quote private source text. A foreign page receives only a receipt or this fixed message.
      return answer(422, { ok: false, error: "Could not save; keep your words and check the destination in the outline" });
    }
  }
}

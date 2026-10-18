import { randomBytes } from "node:crypto";
import { MAX_WRITE_BYTES, sameOrigin } from "./publish-page";
import { findDrawnPassage } from "./publish-passage";
import { createBlockComment } from "./block-comments";
import type { PageHost } from "./publish-page";
import type { Block, PageAddressFollowResult } from "./types";

const escapeHtml = Bun.escapeHTML;

interface Scope { id: string; expiresAt: number; ended: boolean; today: string; block?: string; writes: number[] }
interface Lease { scope: Scope; source: string }
const headers = { "content-type": "application/json", "cache-control": "no-store", "referrer-policy": "no-referrer" };
const answer = (status: number, body: unknown) => Response.json(body, { status, headers });

/** A publisher owns these one-hour write leases; restarting it ends them too. No lease grants a read. */
export class ReaderLeases {
  private readonly leases = new Map<string, Lease>();
  private readonly scopes = new Map<string, Scope>();
  private readonly approvedOrigins = new Set<string>();
  constructor(private readonly host: Pick<PageHost, "request" | "writes"> & { published: (id: string) => Promise<boolean> }, private readonly style: string, private readonly outlineName: () => string) {}

  async owner(request: Request, route: string, endpoint: string): Promise<Response> {
    if (route === "/reader/approve") return this.approve(request);
    if (request.method === "GET" && route === "/reader") {
      const origins = [...this.approvedOrigins].map(source => `<li>${escapeHtml(source)}<form method="post" action="reader/origin-revoke"><input type="hidden" name="source" value="${escapeHtml(source)}"><button>Revoke</button></form></li>`).join("");
      return this.page(`<h1>Reader on any page</h1><p>Make a one-hour bookmarklet for this outline. Select words on a page, then use Highlight, Comment or Ask. A block anchor receives a quote comment; other pages become captures under today, with their source URL. Type #pie-request as you would in a note.</p><form method="post" action="reader/bookmark"><label>Published block id (optional) <input name="block"></label><button>Make bookmarklet</button></form><h2>Approved origins</h2><p>Approvals last until revoked or the publisher restarts.</p><ul>${origins}</ul><h2>Try it</h2><p>On a page at another origin, select a passage and click the bookmark. Comment saves under today; on the chosen published page, a block anchor receives the comment. Use the built-in reader on this publisher’s own pages.</p>`);
    }
    if (request.method !== "POST") return answer(405, { ok: false });
    if (!sameOrigin(request)) return answer(403, { ok: false });
    if (route === "/reader/origin-revoke") {
      const input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
      let origin: string;
      try { origin = new URL(input.source).origin; } catch { return answer(400, { ok: false }); }
      this.approvedOrigins.delete(origin);
      return this.page(`<p>Origin revoked.</p><a href="../reader">Back to reader installation</a>`);
    }
    if (route === "/reader/revoke") {
      const input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
      for (const scope of this.scopes.values()) if (scope.id === input.id) scope.ended = true;
      return answer(200, { ok: true });
    }
    if (route !== "/reader/bookmark") return answer(404, { ok: false });
    const why = await this.host.writes(true);
    if (why) return answer(403, { ok: false, error: why });
    for (const [token, lease] of this.leases) if (lease.scope.ended || lease.scope.expiresAt <= Date.now()) this.leases.delete(token);
    for (const [key, scope] of this.scopes) if (scope.ended || scope.expiresAt <= Date.now()) this.scopes.delete(key);
    const input = request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
    if (input.block && (typeof input.block !== "string" || !await this.host.published(input.block))) return answer(403, { ok: false, error: "Choose a published page" });
    const date = new Date();
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const today = await this.host.request<PageAddressFollowResult>({ action: "pages.follow", address: day, author: "user" });
    if (!today.block || today.status !== "resolved") return answer(422, { ok: false, error: "Today is unavailable" });
    const session = randomBytes(32).toString("base64url");
    const scope: Scope = { id: crypto.randomUUID(), expiresAt: Date.now() + 3_600_000, ended: false, today: today.block.id, block: input.block || undefined, writes: [] };
    this.scopes.set(session, scope);
    const code = `${await Bun.file(new URL("./publish-reader-bookmark.js", import.meta.url)).text()}(${JSON.stringify(endpoint)},${JSON.stringify(this.style)},${JSON.stringify(scope.id)});`;
    const bookmarklet = `javascript:${encodeURIComponent(code)}`;
    const response = request.headers.get("content-type")?.includes("application/json")
      ? answer(200, { id: scope.id, expiresAt: new Date(scope.expiresAt).toISOString(), bookmarklet })
      : this.page(`<h1>Reader on any page</h1><p>Drag <a href="${escapeHtml(bookmarklet)}">ep0ch reader</a> to your bookmarks. Select words on a page at another origin and click the bookmark.</p><p>Expires ${escapeHtml(new Date(scope.expiresAt).toISOString())}. Pages must allow frames and the publisher's cookie. A failed send keeps your words in the box. On the publisher's own pages use their reader controls.</p><form method="post" action="revoke"><input type="hidden" name="id" value="${scope.id}"><button>End this lease</button></form>`);
    const url = new URL(endpoint);
    response.headers.set("set-cookie", `ep0ch_reader_${scope.id}=${session}; Path=${url.pathname}; HttpOnly; Max-Age=3600; ${url.protocol === "https:" ? "SameSite=None; Secure" : "SameSite=Lax"}`);
    return response;
  }

  async handle(request: Request, route: string): Promise<Response> {
    if (route === "write") return this.write(request);
    const url = new URL(request.url);
    if (route === "frame" && request.method === "GET") {
      let source: URL;
      try { source = new URL(url.searchParams.get("source") ?? ""); } catch { return answer(400, { ok: false }); }
      if (!["http:", "https:"].includes(source.protocol) || source.origin === url.origin) return answer(403, { ok: false });
      const approved = this.approvedOrigin(source.origin);
      if (!approved) return answer(403, { ok: false, error: "Approve this origin in the reader popup first" });
      const nonce = randomBytes(16).toString("base64url");
      const response = this.page(`<p data-parent-origin="${escapeHtml(approved)}">Connecting…</p><script nonce="${nonce}">${await Bun.file(new URL("./publish-reader-frame.js", import.meta.url)).text()}</script>`);
      response.headers.set("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'self'; style-src 'unsafe-inline'; frame-ancestors ${approved}`);
      return response;
    }
    if (route !== "lease") return answer(404, { ok: false });
    if (request.method !== "POST") return answer(405, { ok: false });
    if (!sameOrigin(request)) return answer(403, { ok: false });
    let input;
    let source: URL;
    try {
      input = await request.json();
      source = new URL(input.source);
    } catch { return answer(400, { ok: false }); }
    if (!["http:", "https:"].includes(source.protocol) || source.origin === url.origin) return answer(403, { ok: false });
    const scope = this.scope(request, input.scope);
    if (!scope) return answer(410, { ok: false, error: "Open the outline's /reader page to make a new bookmark; allow its cookie in this frame" });
    if (!this.approvedOrigin(source.origin)) return answer(403, { ok: false, error: "Approve this origin in the reader popup first" });
    const token = randomBytes(32).toString("base64url");
    this.leases.set(token, { scope, source: source.href });
    return answer(200, { token });
  }

  private approvedOrigin(origin: string): string | undefined {
    return [...this.approvedOrigins].find(approved => approved === origin);
  }

  private scope(request: Request, id: string): Scope | undefined {
    const name = `ep0ch_reader_${id}=`;
    const session = request.headers.get("cookie")?.split(";").map(part => part.trim()).find(part => part.startsWith(name))?.slice(name.length);
    const scope = session ? this.scopes.get(session) : undefined;
    return scope && scope.id === id && !scope.ended && scope.expiresAt > Date.now() ? scope : undefined;
  }

  private async approve(request: Request): Promise<Response> {
    if (request.method !== "GET" && request.method !== "POST") return answer(405, { ok: false });
    if (request.method === "POST" && !sameOrigin(request)) return answer(403, { ok: false });
    const input = request.method === "GET" ? Object.fromEntries(new URL(request.url).searchParams)
      : request.headers.get("content-type")?.includes("application/json") ? await request.json() : Object.fromEntries(await request.formData());
    let source: URL;
    try { source = new URL(input.source); } catch { return answer(400, { ok: false }); }
    if (!["http:", "https:"].includes(source.protocol) || source.origin === new URL(request.url).origin) return answer(403, { ok: false });
    if (request.method === "POST" || this.approvedOrigins.has(source.origin)) {
      const allowed = request.method === "GET" || input.decision === "allow";
      if (allowed) this.approvedOrigins.add(source.origin);
      const nonce = randomBytes(16).toString("base64url");
      const response = this.page(`<p>${allowed ? "Allowed" : "Denied"}. You can close this window.</p><script nonce="${nonce}">if(window.opener){window.opener.postMessage({kind:"ep0ch-approved",allowed:${allowed}},${JSON.stringify(source.origin).replace(/</g, "\\u003c")});window.close();}</script>`);
      response.headers.set("content-security-policy", `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; frame-ancestors 'none'; form-action 'self'`);
      return response;
    }
    return this.page(`<h1>Allow ${escapeHtml(source.origin)} to send highlights and comments to ${escapeHtml(this.outlineName())}?</h1><form method="post"><input type="hidden" name="source" value="${escapeHtml(source.origin)}"><button name="decision" value="allow">Allow</button><button name="decision" value="deny">Deny</button></form>`);
  }

  private page(body: string): Response {
    // Keep same-origin form POSTs from acquiring Origin: null under the sign-in gate’s no-referrer header.
    return new Response(`<!doctype html><meta charset="utf-8"><meta name="referrer" content="same-origin"><meta name="viewport" content="width=device-width"><title>Reader on any page</title><style>body{background:#111;color:#ddd;font:18px/1.5 system-ui;max-width:42rem;margin:2rem auto;padding:1rem}a{color:#bcd}</style>${body}`, { headers: { "content-security-policy": "frame-ancestors 'none'; form-action 'self'", "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" } });
  }

  private async write(request: Request): Promise<Response> {
    const token = request.headers.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]+)$/)?.[1];
    const issued = token ? this.leases.get(token) : undefined;
    const lease = issued?.scope;
    if (!lease || lease.ended || lease.expiresAt <= Date.now()) return answer(410, { ok: false, error: "Lease ended: make a new bookmarklet on the outline's /reader page" });
    if (!this.approvedOrigin(new URL(issued!.source).origin)) return answer(403, { ok: false, error: "This origin was revoked; your words are still here" });
    if (request.method !== "POST") return answer(405, { ok: false });
    if (!sameOrigin(request)) return answer(403, { ok: false });
    let input;
    const decoder = new TextDecoder();
    let raw = "";
    let bytes = 0;
    const reader = request.body?.getReader();
    if (reader) {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > MAX_WRITE_BYTES) {
          await reader.cancel();
          return answer(413, { ok: false, error: "That's too long to send at once" });
        }
        raw += decoder.decode(value, { stream: true });
      }
    }
    raw += decoder.decode();
    try { input = JSON.parse(raw); } catch { return answer(400, { ok: false, error: "Send JSON" }); }
    if (!input || !["highlight", "comment", "ask"].includes(input.action) || typeof input.source !== "string" || typeof input.quote !== "string" || (input.body !== undefined && typeof input.body !== "string") || (input.block !== undefined && typeof input.block !== "string")) return answer(400, { ok: false, error: "Send a highlight, comment or ask with its quote and source URL" });
    if (input.block && input.block !== lease.block && input.block !== lease.today) return answer(403, { ok: false, error: "This lease cannot write to that target" });
    let source: string;
    try {
      const url = new URL(input.source);
      if (url.href !== issued!.source) throw new Error();
      source = url.href.replace(/\[/g, "%5B").replace(/\]/g, "%5D");
    } catch { return answer(400, { ok: false, error: "Source must be the page's http(s) URL" }); }
    const now = Date.now();
    const minute = lease.writes.filter(at => at > now - 60_000);
    const waitUntil = lease.writes.length >= 60 ? lease.expiresAt : minute.length >= 10 ? minute[0]! + 60_000 : 0;
    if (waitUntil) {
      const response = answer(429, { ok: false, error: "This lease's write limit was reached; keep your words and send later" });
      response.headers.set("retry-after", String(Math.max(1, Math.ceil((waitUntil - now) / 1000))));
      return response;
    }
    // Reserve before awaiting the service so concurrent requests share the same budget.
    lease.writes.push(now);
    const why = await this.host.writes(true);
    if (why) return answer(403, { ok: false, error: "This outline is not taking writes; your text is still here" });
    if (lease.ended || lease.expiresAt <= Date.now()) return answer(410, { ok: false, error: "Lease ended: make a new bookmarklet" });
    if (!this.approvedOrigin(new URL(issued!.source).origin)) return answer(403, { ok: false, error: "This origin was revoked; your words are still here" });
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
        await this.host.request({ action: "notes.create", text: `Web capture [source::${source}] [via::reader:${lease.id}]\n\n${quoted}\n\n${body}`, intent: { kind: "note", near: lease.today, nearOnly: true }, author: "user" });
      }
      return answer(200, { ok: true, said });
    } catch {
      // Service errors can quote private source text. A foreign page receives only a receipt or this fixed message.
      return answer(422, { ok: false, error: "Could not save; keep your words and check the destination in the outline" });
    }
  }
}

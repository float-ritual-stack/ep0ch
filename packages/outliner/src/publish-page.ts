// Marginalia on a page of the tailnet web client (PIE-774, PIE-782): the reader script the publisher serves and
// injects, the threads it reads, and the one write route it posts to. Everything lands through the service's own
// paths, the same ones the door uses, so every terminal sees the same threads:
//
// - comment, ask and explain: `annotations.batch` (a `block-comment` on the passage). Ask and explain are a comment
//   starting `@<agent>` for the agent that answers in threads (marginalia's `@margin`), which the service sets off;
// - an extension's passage action (marginalia's highlight, define): `extensions.act` with the passage;
// - reply: `annotations.reply`; resolve: `annotations.lifecycle`;
// - quote: `marks.quote`, one or more of the page's marks (a thread, a reply, or a mark on one) quoted into a new block
//   in the Inbox, under this note or under a note found with `/find`; undo: `extensions.undo` with the undo step a
//   quote from this publisher answered. A mark's card says where it's been quoted (`quotedIn`);
// - words selected in a card (`in`: the mark's id) are a passage of that mark's own text: highlights, comments and asks
//   land on the mark (threads of threads), drawn in its card;
// - read: `annotations.read`, the thread read by the person (he opened it from Recent replies, tapped it or replied),
//   which clears its replies from `unread:me` (the `/replies` page's marks).
//
// Being on the tailnet is the sign-in (Evan, Oct 10: "tailnet access is good enough to verify it's me"): the tailnet
// listener takes these writes with no token. The public listener has these routes only below a share link (its token is
// the sign-in, checked on every request; share-sessions.ts), for the notes inside the share, and writes only when it
// takes comments. A write comes from the
// page's own origin (`Origin` names the host the request was sent to) as JSON, on a passage or thread of the note the
// page shows now. Writes are the person's (`author: user`, with no actor id, exactly as the door writes his: the
// service takes provenance only on an agent's writes). A selection is mapped to its source by publish-passage.ts,
// found once or refused with why; a comment whose words can't be placed still lands, on the page's own note with the
// words quoted, so what he wrote is never lost.
import { readFileSync } from "node:fs";
import { annotationKind, annotationTone } from "@ep0ch/outline-core/annotation-marks";
import { parseActor } from "@ep0ch/outline-core/attribution";
import type { ExtensionsListResult } from "./extension-registry";
import { plainBody } from "./publish-marginalia";
import { stripPropertyTokens } from "./properties";
import { findDrawnPassage, type ShownBlock } from "./publish-passage";
import { extractAnnotationBody } from "./annotations";
import type { AnnotationBatchReceipt, AnnotationRecord, AnnotationThread, Block, BlockProperty, MarkQuoteReceipt, ProjectedBlockCollection } from "./types";
import { passageAt } from "@ep0ch/outline-core/passage";
import type { ShareSession } from "@ep0ch/outline-core/protocol";

/** The script, read once: served at `<base>/_marginalia/reader.js`, the only script a rendered page may run. */
export const READER_SCRIPT = readFileSync(new URL("./publish-reader.js", import.meta.url), "utf8");
const READER_TAG = new Bun.CryptoHasher("sha256").update(READER_SCRIPT).digest("hex").slice(0, 16);

/**
 * The WebMCP polyfill (`@mcp-b/global`, pinned in package.json), served at `<base>/_marginalia/webmcp.js` after the
 * reader script, so `navigator.modelContext` exists where the browser has none yet and the page's helpers are tools
 * there. From this origin, never a CDN; when it isn't installed the page has no such script and works the same.
 */
export const WEBMCP_SCRIPT: string | null = (() => {
  try {
    return readFileSync(new URL(import.meta.resolve("@mcp-b/global/iife")), "utf8");
  } catch {
    return null;
  }
})();
const WEBMCP_TAG = WEBMCP_SCRIPT ? new Bun.CryptoHasher("sha256").update(WEBMCP_SCRIPT).digest("hex").slice(0, 16) : "";

/** The route the page's script reads and writes through, below the listener's base path. */
export const PAGE_ROUTE = "/_marginalia";

const MAX_WRITE_BYTES = 64 * 1024;
const MAX_POLL_MS = 20_000;
/** A change wakes a waiting page this long after it, so a burst of writes elsewhere is one look, not one each. */
const SETTLE_MS = 1_000;
const EXTENSIONS_MAX_AGE_MS = 30_000;
/** At most this many annotated blocks of one page are read for its threads. */
const MAX_THREAD_BLOCKS = 200;

/** A block quoting a mark, as a card links it: its title and page, or why it isn't linked (locked, outside the share). */
export interface PageQuote {
  id: string;
  title: string;
  href: string | null;
}

/** A reply as the page's script reads it, with the marks on its words and where it's been quoted. */
export interface PageReply {
  id: string;
  body: string;
  by: string;
  at: string;
  marks: PageThread[];
  quotedIn: PageQuote[];
}

/** One block's open thread as the page's script reads it. */
export interface PageThread {
  id: string;
  /** The words it's on (empty for a whole-note comment). */
  quote: string;
  kind: string;
  tone: string;
  tags: string[];
  /** Plain text: a reference shows its label, never another note's id. */
  body: string;
  by: string;
  at: string;
  replies: PageReply[];
  /** The open marks on its own words (threads of threads), drawn in its card. */
  marks: PageThread[];
  /** The blocks quoting it (`marks.quote`). */
  quotedIn: PageQuote[];
}

/** Where a thread's words start in what it's on (0 for a whole-note comment): threads in reading order. */
function start(thread: AnnotationThread): number {
  const anchor = thread.resolvedTarget?.anchor;
  return anchor?.kind === "text-quote" ? anchor.start ?? 0 : 0;
}

/** How deep marks on marks are read for a page: a mark on a comment, a mark on that. */
const MAX_MARK_DEPTH = 3;
/** The undo steps this publisher's quotes answered, newest last: only these are undone from a page. */
const MAX_QUOTE_UNDOS = 100;

/** What a page's toolbar offers, as the door's passage toolbar does. */
export interface PageChoice {
  action: string;
  label: string;
}

/** A page as the routes need it: what it shows now. */
export interface PageView {
  /** The page's own note (its first row). */
  root: ShownBlock;
  /** Every row it shows (locked rows and annotations left out), in page order. */
  blocks: ShownBlock[];
  /** Each annotation block the page may show, by id, with the block it's on. */
  annotations: ReadonlyMap<string, string>;
  /** What else the page draws that can change, each as `id:revision`: a folder page's children. */
  listed?: readonly string[];
}

/**
 * A share session's page (share-sessions.ts): the same routes below its link, for notes inside its scope only. Its
 * writes (when it takes comments) are the person's, marked as made through the share (`via: share:<id>`).
 */
export interface PageShare {
  id: string;
  /** The share's own base path (`/share/s/<token>`): every link and route of its pages is below it. */
  base: string;
  scope: ShareSession["scope"];
  comments: boolean;
  /** Whether the link still opens its session now: asked again right before a write lands, and after a long poll. */
  active(): Promise<boolean>;
}

const ended = () => refused(410, "this link has ended");

/** What the routes ask of the publisher. */
export interface PageHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /**
   * The note at `page` (a published slug, a page name or an id) as the tailnet shows it now, locks read now: the note
   * alone (a folder page), or with what's under it (`full`). Undefined when there's no such note or it's locked, or
   * (with `share`) it's outside the share.
   */
  view(page: string, full: boolean, share?: PageShare): Promise<PageView | undefined>;
  /** The tailnet listener's base path (`/pub`): its pages' addresses are below it. */
  readonly basePath: string;
  /** Says what a reader has in front of them now (`reader.report`). */
  report(view: Record<string, unknown>): Promise<unknown>;
  /** Whether a block's own properties lock it (`[publish::never]`). */
  locks(properties: readonly BlockProperty[]): boolean;
  /** Goes up with every change to the outline. */
  generation(): number;
  /** Resolves when the generation passes `since`, or after `ms`. */
  changed(since: number, ms: number): Promise<void>;
  /** Notes a page may link to, each with its title and address (null: locked, or outside the share). */
  linkable(ids: readonly string[], share?: PageShare): Promise<PageQuote[]>;
  /** The outline's notes by words (the service's search), none locked or outside the share. */
  find(query: string, near: string | undefined, share?: PageShare): Promise<{ id: string; title: string; path: string }[]>;
  log(line: string): void;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };

function json(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body)}\n`, { status, headers: JSON_HEADERS });
}

const refused = (status: number, error: string) => json(status, { ok: false, error });

/** The script's URL path on a listener mounted at `basePath`, versioned so a new script is fetched at once. */
export function readerScriptPath(basePath: string): string {
  return `${basePath}${PAGE_ROUTE}/reader.js?v=${READER_TAG}`;
}

/** The WebMCP polyfill's URL path, when it's installed. */
export function webmcpScriptPath(basePath: string): string | undefined {
  return WEBMCP_SCRIPT ? `${basePath}${PAGE_ROUTE}/webmcp.js?v=${WEBMCP_TAG}` : undefined;
}

/**
 * Whether a write comes from a page of this listener: its `Origin` names the host the request was sent to (through
 * `tailscale serve` both are the tailnet name). A page on another site can't post here: its origin differs, and a
 * JSON body makes the browser ask first.
 */
export function sameOrigin(request: Request): boolean {
  const origin = request.headers.get("origin");
  const host = request.headers.get("host") ?? new URL(request.url).host;
  if (!origin || origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export class PageMarginalia {
  private extensions: { at: number; value: Promise<ExtensionsListResult> } | null = null;
  /** Each quote's undo step this publisher answered, with where it was made (`tailnet` or the share's id). */
  private readonly undos = new Map<string, string>();
  /** Each quote's answer by where it came from and its request id: a retry gets the same answer, never a second block. */
  private readonly quotes = new Map<string, Record<string, unknown>>();

  constructor(private readonly host: PageHost) {}

  /**
   * Answers a request below `<base>/_marginalia/` on the tailnet listener, or below a share's link (`share`; `route` is
   * the rest: `/threads`, `/write`, `/view`, …).
   */
  async handle(request: Request, route: string, share?: PageShare): Promise<Response> {
    const script = route === "/reader.js" ? READER_SCRIPT : route === "/webmcp.js" ? WEBMCP_SCRIPT : null;
    if (script) {
      if (request.method !== "GET" && request.method !== "HEAD") return refused(405, "read-only");
      return new Response(script, { headers: {
        // Below a share's link the path holds its secret: nothing keeps it.
        "content-type": "text/javascript; charset=utf-8", "cache-control": share ? "no-store" : "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin",
      } });
    }
    if (route === "/threads") {
      if (request.method !== "GET") return refused(405, "use GET");
      return this.threads(request, share);
    }
    if (route === "/write") {
      if (request.method !== "POST") return refused(405, "use POST");
      return this.write(request, share);
    }
    if (route === "/find") {
      if (request.method !== "GET") return refused(405, "use GET");
      return this.find(request, share);
    }
    if (route === "/view") {
      if (request.method !== "POST") return refused(405, "use POST");
      return this.view(request, share?.base ?? this.host.basePath, share);
    }
    return refused(404, "not here");
  }

  /**
   * What the reader has in front of them (presence, `reader.report`): the page's note, its title and address, the
   * words selected with the drawn text either side, placed in the note row they're in (and where in its source) when
   * they can be, the blocks on screen and how far down the page is; and a fold opened or closed. The title is the
   * note's own, the address must be this page's and the blocks this page's, so a page can't put other words in an
   * agent's read. A share's address is said without its secret, and its reader's selection only when it is found in
   * the note (a share's reader may be anyone with the link: what an agent reads back is the outline's own text).
   * Answers what the service kept, with the reader's journal (on a share, only this visitor's: anyone with the link
   * reads as the share): the page's `ep0ch.view()` and `ep0ch.journal()` are it.
   */
  private async view(request: Request, base: string, share?: PageShare): Promise<Response> {
    if (!sameOrigin(request)) return refused(403, "a page says what's on it itself");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refused(415, "send JSON");
    const raw = await request.text();
    if (raw.length > MAX_WRITE_BYTES) return refused(413, "that's too long to send at once");
    let input: { page?: unknown; view?: unknown; title?: unknown; url?: unknown; quote?: unknown; prefix?: unknown; suffix?: unknown; visible?: unknown; scroll?: unknown; fold?: unknown; visitor?: unknown };
    try { input = JSON.parse(raw); } catch { return refused(400, "send JSON"); }
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const view = await this.host.view(text(input.page), text(input.view) === "full", share);
    if (!view) return refused(404, "no such note here");
    const quote = text(input.quote).trim();
    const found = quote ? findDrawnPassage(view.blocks, { quote, prefix: text(input.prefix), suffix: text(input.suffix) }) : undefined;
    const placed = !!found?.ok || (!share && !!quote);
    if (share && !(await share.active())) return ended();
    const title = plainBody(stripPropertyTokens(view.root.text.split("\n")[0] ?? "")).replace(/^\s*#{1,6}\s+/, "").trim();
    // The page's own address (on this host, below this listener's or this share's base), else the note's path.
    let url = `${base}/p/${view.root.id}`;
    try {
      const given = new URL(text(input.url));
      if (given.host === (request.headers.get("host") ?? new URL(request.url).host) && given.pathname.startsWith(`${base}/`)) url = given.href;
    } catch { /* the note's path */ }
    const onPage = new Set([...view.blocks.map((block) => block.id), ...(view.listed ?? []).map((row) => row.slice(0, row.lastIndexOf(":")))]);
    const visible = Array.isArray(input.visible) ? input.visible.filter((id): id is string => typeof id === "string" && onPage.has(id)) : undefined;
    const scroll = input.scroll && typeof input.scroll === "object" ? input.scroll : undefined;
    const fold = input.fold && typeof input.fold === "object" ? input.fold as { blockId?: unknown; open?: unknown } : undefined;
    const answer = await this.host.report({
      reader: share ? `share:${share.id}` : "tailnet", visitor: text(input.visitor), blockId: view.root.id, title, url: url.replace(/\/s\/[^/?#]+/, "/s/…"),
      ...(placed ? { selection: {
        text: quote, before: text(input.prefix), after: text(input.suffix),
        ...(found?.ok ? { blockId: found.block.id, offsets: { start: found.passage.start, end: found.passage.end }, revision: found.block.revision } : {}),
      } } : {}),
      ...(visible ? { visible } : {}),
      ...(scroll ? { scroll } : {}),
      ...(fold && typeof fold.blockId === "string" && onPage.has(fold.blockId) ? { fold: { blockId: fold.blockId, open: fold.open === true } } : {}),
    });
    return json(200, { ok: true, ...(answer && typeof answer === "object" ? answer : {}) });
  }

  private extensionList(): Promise<ExtensionsListResult> {
    if (!this.extensions || Date.now() - this.extensions.at > EXTENSIONS_MAX_AGE_MS) {
      const value = this.host.request<ExtensionsListResult>({ action: "extensions.list" });
      value.catch(() => { this.extensions = null; });
      this.extensions = { at: Date.now(), value };
    }
    return this.extensions.value;
  }

  /** The agent that answers in threads (the first, as the door's toolbar takes it), and the passage actions that write. */
  private async kit(): Promise<{ agent?: string; actions: { name: string; extension: string; id: string; label: string }[] }> {
    try {
      const list = await this.extensionList();
      const active = list.extensions.filter((extension) => extension.state === "active");
      const agent = active.flatMap((extension) => extension.agents).find((candidate) => candidate.threads)?.name;
      const actions = active.flatMap((extension) => extension.actions
        .filter((action) => action.on === "passage" && action.effects === "write")
        .map((action) => ({ name: action.name, extension: extension.id, id: action.id, label: action.label ?? action.id })));
      return { ...(agent ? { agent } : {}), actions };
    } catch (error) {
      this.host.log(`publish: extensions.list: ${(error as Error).message}`);
      return { actions: [] };
    }
  }

  private by(record: AnnotationRecord): string {
    if (record.block.author === "user") return "you";
    const actor = record.block.actorId ?? "";
    if (actor.startsWith("ext:")) return actor.slice(4);
    return actor ? parseActor(actor).handle : "agent";
  }

  /** The page's open threads, as its script draws them: each with its replies, the marks on its words and where it's quoted. */
  async pageThreads(view: PageView, share?: PageShare): Promise<PageThread[]> {
    const annotated = [...new Set(view.annotations.values())].filter((id) => view.blocks.some((block) => block.id === id)).slice(0, MAX_THREAD_BLOCKS);
    const order = new Map(view.blocks.map((block, index) => [block.id, index]));
    const lists = await Promise.all(annotated.map(async (blockId) => (await this.openOn(blockId))
      .filter((thread) => view.annotations.has(thread.block.id)).map((thread) => ({ blockId, thread }))));
    // The marks whose own words are marked: one read of the page's marks finds them (a mark's parent is what it's on).
    let marked = new Set<string>();
    try {
      const all = await this.host.request<ProjectedBlockCollection>({
        action: "blocks.query", query: { subtreeRootId: view.root.id, filters: [{ key: "type", value: "annotation" }], limit: 1000 }, fields: ["parent"],
      });
      const notes = new Set(view.blocks.map((block) => block.id));
      marked = new Set(all.blocks.flatMap((block) => block.parentId && !notes.has(block.parentId) ? [block.parentId] : []));
    } catch (error) {
      this.host.log(`publish: blocks.query: ${(error as Error).message}`);
    }
    const quoted: string[] = [];
    const roots = lists.flat()
      .sort((a, b) => (order.get(a.blockId)! - order.get(b.blockId)!) || start(a.thread) - start(b.thread));
    const drawn = await Promise.all(roots.map(({ thread }) => this.pageThread(thread, marked, quoted, 1)));
    const links = new Map((await this.host.linkable([...new Set(quoted)], share).catch(() => [] as PageQuote[])).map((quote) => [quote.id, quote]));
    const fill = (thread: PageThread): void => {
      thread.quotedIn = thread.quotedIn.map((quote) => links.get(quote.id) ?? quote);
      thread.marks.forEach(fill);
      for (const reply of thread.replies) {
        reply.quotedIn = reply.quotedIn.map((quote) => links.get(quote.id) ?? quote);
        reply.marks.forEach(fill);
      }
    };
    drawn.forEach(fill);
    return drawn;
  }

  /** A block's open threads on its own text (an annotation block's: the marks on its words), none locked. */
  private async openOn(blockId: string): Promise<AnnotationThread[]> {
    try {
      const threads = await this.host.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: false } });
      return threads.filter((thread) => {
        const subject = thread.resolvedTarget?.representation.subject ?? thread.originalTarget.representation.subject;
        return thread.lifecycle === "open" && !this.host.locks(thread.block.properties ?? []) && subject.kind === "block" && subject.blockId === blockId;
      });
    } catch (error) {
      this.host.log(`publish: annotations.list: ${(error as Error).message}`);
      return [];
    }
  }

  /** One thread as the script draws it; `marked`: the marks with marks on their own words, read `depth` deep. */
  private async pageThread(thread: AnnotationThread, marked: ReadonlySet<string>, quoted: string[], depth: number): Promise<PageThread> {
    const on = async (id: string) => depth < MAX_MARK_DEPTH && marked.has(id)
      ? Promise.all((await this.openOn(id)).sort((a, b) => start(a) - start(b)).map((mark) => this.pageThread(mark, marked, quoted, depth + 1)))
      : [];
    const quotes = (record: AnnotationRecord): PageQuote[] => (record.quotedIn ?? []).map((id) => { quoted.push(id); return { id, title: "", href: null }; });
    const anchor = thread.resolvedTarget?.anchor;
    const properties = thread.properties ?? {};
    // A reply marked [publish::never] stays off the page, as a locked note does.
    const replies = await Promise.all(thread.replies.filter((reply) => !this.host.locks(reply.block.properties ?? []))
      .map(async (reply): Promise<PageReply> => ({ id: reply.block.id, body: plainBody(reply.body), by: this.by(reply), at: reply.block.createdAt, marks: await on(reply.block.id), quotedIn: quotes(reply) })));
    return {
      id: thread.block.id,
      quote: anchor?.kind === "text-quote" ? anchor.exact : "",
      kind: annotationKind(properties, thread.body),
      tone: annotationTone(properties),
      tags: [...new Set((properties.tags ?? []).flatMap((tag) => tag.split(",")).map((tag) => tag.trim()).filter(Boolean))],
      body: plainBody(thread.body),
      by: this.by(thread),
      at: thread.block.createdAt,
      replies,
      marks: await on(thread.block.id),
      quotedIn: quotes(thread),
    };
  }

  /** Every mark a page shows, by id: `root` for a thread (a mark of its own, which takes replies), else a reply. */
  private async onPage(view: PageView, share?: PageShare): Promise<{ marks: Map<string, "root" | "reply">; threads: PageThread[] }> {
    const threads = await this.pageThreads(view, share);
    const marks = new Map<string, "root" | "reply">();
    const walk = (thread: PageThread): void => {
      marks.set(thread.id, "root");
      thread.marks.forEach(walk);
      for (const reply of thread.replies) { marks.set(reply.id, "reply"); reply.marks.forEach(walk); }
    };
    threads.forEach(walk);
    return { marks, threads };
  }

  /** Notes by words, for "Under…" in the quote sheet: the service's search, near the page's note. */
  private async find(request: Request, share?: PageShare): Promise<Response> {
    const url = new URL(request.url);
    const query = (url.searchParams.get("q") ?? "").trim().slice(0, 200);
    if (share && !(await share.active())) return ended();
    if (query.length < 2) return json(200, { notes: [] });
    const near = url.searchParams.get("page") ? (await this.host.view(url.searchParams.get("page")!, false, share))?.root.id : undefined;
    try {
      return json(200, { notes: await this.host.find(query, near, share) });
    } catch (error) {
      return refused(502, `the search didn't answer: ${(error as Error).message}`);
    }
  }

  /**
   * The page's threads and what its toolbar offers, with `version`: a digest of everything the page draws (its rows'
   * revisions, its folder's children, its threads and choices). With `since` (the version the script last saw) the answer
   * waits, up to `wait` ms (at most 20 s), until the page's own version moves: a change elsewhere in the outline wakes it
   * to look again but doesn't answer, so a page nothing touches asks about three times a minute however busy the outline.
   */
  private async threads(request: Request, share?: PageShare): Promise<Response> {
    const url = new URL(request.url);
    const page = url.searchParams.get("page") ?? "";
    const full = url.searchParams.get("view") === "full";
    const since = url.searchParams.get("since");
    const deadline = Date.now() + Math.min(Number(url.searchParams.get("wait")) || MAX_POLL_MS, MAX_POLL_MS);
    for (;;) {
      // Read before the answer is built, so a change made while it's built wakes the wait below at once.
      const generation = this.host.generation();
      const answer = await this.pageState(page, full, share);
      if (answer instanceof Response) return answer;
      const left = deadline - Date.now();
      if (!since || answer.version !== since || left <= 0) return json(200, answer);
      await this.host.changed(generation, left);
      await Bun.sleep(Math.max(0, Math.min(SETTLE_MS, deadline - Date.now())));
    }
  }

  /** What `threads` answers now, or why it can't. */
  private async pageState(page: string, full: boolean, share?: PageShare): Promise<Response | { version: string } & Record<string, unknown>> {
    if (share && !(await share.active())) return ended();
    const view = await this.host.view(page, full, share);
    if (!view) return refused(404, "no such note here");
    const body: Record<string, unknown> = { note: view.root.id };
    // A share without comments is a reading copy: no threads, and Copy alone.
    if (share && !share.comments) Object.assign(body, { choices: [{ action: "copy", label: "Copy" }], threads: [] });
    else {
      const kit = await this.kit();
      const choices: PageChoice[] = [
        ...kit.actions.filter((action) => action.id === "highlight").map((action) => ({ action: action.id, label: action.label })),
        { action: "comment", label: "Comment" },
        ...(kit.agent ? [{ action: "ask", label: "Ask" }] : []),
        { action: "copy", label: "Copy" },
        ...(kit.agent ? [{ action: "explain", label: "Explain" }] : []),
        ...kit.actions.filter((action) => action.id !== "highlight").map((action) => ({ action: action.id, label: action.label })),
      ];
      Object.assign(body, { ...(kit.agent ? { agent: kit.agent } : {}), choices, threads: await this.pageThreads(view, share) });
    }
    const drawn = JSON.stringify([view.blocks.map((block) => `${block.id}:${block.revision}`), view.listed ?? [], body]);
    return { version: new Bun.CryptoHasher("sha256").update(drawn).digest("hex").slice(0, 16), ...body };
  }

  private async write(request: Request, share?: PageShare): Promise<Response> {
    if (!sameOrigin(request)) return refused(403, "a write comes from the page itself");
    if (share && !share.comments) return refused(403, "this link is for reading: it takes no comments");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refused(415, "send JSON");
    const raw = await request.text();
    if (raw.length > MAX_WRITE_BYTES) return refused(413, "that's too long to send at once");
    let input: {
      page?: unknown; view?: unknown; action?: unknown; quote?: unknown; prefix?: unknown; suffix?: unknown; body?: unknown; thread?: unknown; requestId?: unknown;
      marks?: unknown; place?: unknown; under?: unknown; text?: unknown; undo?: unknown; in?: unknown;
    };
    try { input = JSON.parse(raw); } catch { return refused(400, "send JSON"); }
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const action = text(input.action);
    const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(text(input.requestId)) ? text(input.requestId) : crypto.randomUUID();
    const view = await this.host.view(text(input.page), text(input.view) === "full", share);
    if (!view) return refused(404, "this note isn't here now (moved to Trash, or locked)");
    const said = (status: number, body: Record<string, unknown>) => json(status, { ...body, generation: this.host.generation() });
    // The link may have ended while the body was on its way: asked again just before anything lands.
    if (share && !(await share.active())) return ended();
    const where = share ? share.id : "tailnet";
    try {
      if (action === "undo") {
        // Only a quote this publisher made, from the same place (the tailnet, or this share): undone whole, once.
        const undo = text(input.undo);
        if (this.undos.get(undo) !== where) return refused(404, "nothing to undo here: only a quote made on these pages, once");
        const done = await this.host.request<{ written: string[] }>({ action: "extensions.undo", undo, mutation: { author: "user" } });
        this.undos.delete(undo);
        return said(200, { ok: true, undone: done.written, said: "undone: the quote is in the Trash" });
      }
      const { marks: shown } = await this.onPage(view, share);
      if (action === "quote") {
        const wanted = Array.isArray(input.marks) ? input.marks.map(text).filter(Boolean) : [];
        if (!wanted.length) return refused(400, "pick a mark to quote: a highlight, comment or reply on this page");
        const missing = wanted.find((id) => !shown.has(id));
        if (missing) return refused(404, "that mark isn't on this page now (resolved, or moved)");
        const placeName = text(input.place) || "inbox";
        let place: Record<string, string>;
        if (placeName === "inbox") place = { kind: "inbox" };
        // The note the first mark is on (on a mark's own page too: never under the mark), as the door's "under this note".
        else if (placeName === "note") place = { kind: "note" };
        else if (placeName === "under") {
          const under = text(input.under);
          const [target] = under ? await this.host.linkable([under], share) : [];
          if (!target?.href) return refused(404, "that note isn't one this page can put things under (locked, or outside this link)");
          place = { kind: "under", blockId: under };
        } else return refused(400, "place is inbox, note or under (with under: a note's id)");
        // A retry of a quote whose answer was lost (the same request id) gets the first answer, not a second block.
        const again = this.quotes.get(`${where}:${requestId}`);
        if (again) return said(200, again);
        const words = text(input.text).trim();
        const receipt = await this.host.request<MarkQuoteReceipt>({
          action: "marks.quote", input: { marks: wanted, place, ...(words ? { text: words } : {}) }, mutation: { author: "user" },
        });
        if (receipt.undo) {
          this.undos.set(receipt.undo, where);
          while (this.undos.size > MAX_QUOTE_UNDOS) this.undos.delete(this.undos.keys().next().value!);
        }
        const [made] = await this.host.linkable([receipt.block.id], share);
        const answer = {
          ok: true, block: receipt.block.id, href: made?.href ?? null, title: made?.title ?? "", ...(receipt.undo ? { undo: receipt.undo } : {}),
          said: `quoted ${wanted.length === 1 ? "it" : `${wanted.length} marks`} ${receipt.placement.said}`,
        };
        this.quotes.set(`${where}:${requestId}`, answer);
        while (this.quotes.size > MAX_QUOTE_UNDOS) this.quotes.delete(this.quotes.keys().next().value!);
        return said(200, answer);
      }
      if (action === "reply" || action === "resolve" || action === "read") {
        const thread = text(input.thread);
        if (shown.get(thread) !== "root") return refused(404, "that thread isn't on this page");
        if (action === "read") {
          const read = await this.host.request<{ thread: string; marked: number }>({ action: "annotations.read", annotationId: thread });
          return said(200, { ok: true, thread: read.thread, marked: read.marked });
        }
        if (action === "reply") {
          const body = text(input.body).trim() ? text(input.body) : "";
          if (!body) return refused(400, "write a reply first");
          const receipt = await this.host.request<AnnotationBatchReceipt>({
            action: "annotations.reply", requestId, author: "user",
            input: { annotationId: thread, body, source: "user", ...(share ? { properties: { via: `share:${share.id}` } } : {}) },
          });
          return said(200, { ok: true, thread, reply: receipt.annotations[0]?.block.id, said: "replied" });
        }
        await this.host.request({ action: "annotations.lifecycle", input: { annotationId: thread, lifecycle: "resolved" }, mutation: { author: "user" } });
        return said(200, { ok: true, thread, said: "resolved" });
      }
      const kit = await this.kit();
      // An extension's action by its own id (`highlight`) as the toolbar offers it, or by its full name.
      const extensionAction = kit.actions.find((candidate) => candidate.id === action) ?? kit.actions.find((candidate) => candidate.name === action);
      if (action !== "comment" && action !== "ask" && action !== "explain" && !extensionAction) {
        return refused(400, `no action ${action || "(none)"} here: it's comment${kit.agent ? ", ask, explain" : ""}, reply, resolve, read${kit.actions.length ? `, or ${kit.actions.map((candidate) => candidate.id).join(", ")}` : ""}`);
      }
      if ((action === "ask" || action === "explain") && !kit.agent) return refused(409, "no agent here answers in threads: add marginalia to this outline (its @margin agent)");
      // Words selected in a card are a passage of that mark's own words: what's done with them lands on the mark.
      const inside = text(input.in);
      let blocks = view.blocks, home = view.root;
      if (inside) {
        if (!shown.has(inside)) return refused(404, "that mark isn't on this page now (resolved, or moved)");
        const mark = await this.host.request<Block>({ action: "get", blockId: inside });
        home = { id: mark.id, revision: mark.revision, text: mark.text };
        blocks = [{ ...home, text: ownWords(mark.text) }];
      }
      const drawn = findDrawnPassage(blocks, { quote: text(input.quote), prefix: text(input.prefix), suffix: text(input.suffix) });
      // Found in the mark's words alone; its passage is read in its whole text, so the words around it are its own.
      const found = drawn.ok && inside ? { ok: true as const, block: home, passage: passageAt(home.text, drawn.passage.start, drawn.passage.end, home.id, home.revision) } : drawn;
      if (extensionAction) {
        if (!found.ok) return refused(422, found.why);
        const result = await this.host.request<{ written: string[]; message?: string }>({
          action: "extensions.act", extension: extensionAction.extension, extensionAction: extensionAction.id, passage: found.passage,
          mutation: { author: "user" },
        });
        return said(200, { ok: true, thread: result.written[0], said: result.message ?? `${extensionAction.label.toLowerCase()} done` });
      }
      const asked = text(input.body).trim();
      const body = action === "explain" ? `@${kit.agent} explain this passage`
        : action === "ask" ? `@${kit.agent} ${asked || "what does this mean?"}` : asked;
      if (!body) return refused(400, "write a comment first (a highlight is its own action)");
      // Through a share it's still the person's comment, said to have come by that link.
      const properties = { ...(action === "ask" ? { kind: "question" } : action === "explain" ? { kind: "explain" } : {}), ...(share ? { via: `share:${share.id}` } : {}) };
      const selected = text(input.quote).trim();
      if (!found.ok) {
        // What he wrote still lands: on the page's own note (or the mark), the words he meant quoted above it.
        const quoted = selected.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
        const thread = await this.batch(requestId, { blockId: home.id, expectedRevision: home.revision, body: selected ? `${quoted}\n\n${body}` : body, source: "user", ...(Object.keys(properties).length ? { properties } : {}) });
        return said(200, { ok: true, thread, landed: "note", said: selected ? `${found.why}; it landed on the whole note, with the words quoted` : "commented on the whole note" });
      }
      const p = found.passage;
      const thread = await this.batch(requestId, {
        blockId: found.block.id, expectedRevision: found.block.revision, body, source: "user",
        passage: { quote: p.quote, start: p.start, prefix: p.prefix, suffix: p.suffix }, ...(Object.keys(properties).length ? { properties } : {}),
      });
      return said(200, { ok: true, thread, said: action === "comment" ? "commented" : `asked @${kit.agent}: the answer lands in the margin` });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.host.log(`publish: page write ${action}: ${message}`);
      return refused(/stale|revision|changed/i.test(message) ? 409 : 422, message);
    }
  }

  private async batch(requestId: string, input: Record<string, unknown>): Promise<string | undefined> {
    const receipt = await this.host.request<AnnotationBatchReceipt>({
      action: "annotations.batch", requestId, author: "user", operations: [{ operationId: "page", type: "block-comment", input }],
    });
    return receipt.annotations[0]?.block.id;
  }
}

/**
 * A mark's text with all but its own words blanked (its heading and metadata lines as spaces), so a selection in its
 * card is found in its words alone while every offset still means the block's text.
 */
export function ownWords(text: string): string {
  const body = extractAnnotationBody(text);
  const firstBreak = text.indexOf("\n");
  const at = body && firstBreak >= 0 ? text.indexOf(body, firstBreak + 1) : -1;
  if (at < 0) return text.replace(/[^\n]/g, " ");
  return text.slice(0, at).replace(/[^\n]/g, " ") + text.slice(at);
}

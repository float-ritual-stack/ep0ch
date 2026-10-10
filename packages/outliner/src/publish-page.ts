// Marginalia on a page of the tailnet web client (PIE-774, PIE-782): the reader script the publisher serves and
// injects, the threads it reads, and the one write route it posts to. Everything lands through the service's own
// paths, the same ones the door uses, so every terminal sees the same threads:
//
// - comment, ask and explain: `annotations.batch` (a `block-comment` on the passage). Ask and explain are a comment
//   starting `@<agent>` for the agent that answers in threads (marginalia's `@margin`), which the service sets off;
// - an extension's passage action (marginalia's highlight, define): `extensions.act` with the passage;
// - reply: `annotations.reply`; resolve: `annotations.lifecycle`;
// - read: `annotations.read`, the thread read by the person (he opened it from Recent replies, tapped it or replied),
//   which clears its replies from `unread:me` (the `/replies` page's marks).
//
// Being on the tailnet is the sign-in (Evan, Oct 10: "tailnet access is good enough to verify it's me"): the tailnet
// listener takes these writes with no token, and the public listener has none of these routes. A write comes from the
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
import { findDrawnPassage, type ShownBlock } from "./publish-passage";
import type { AnnotationBatchReceipt, AnnotationRecord, AnnotationThread, BlockProperty } from "./types";

/** The script, read once: served at `<base>/_marginalia/reader.js`, the only script a rendered page may run. */
export const READER_SCRIPT = readFileSync(new URL("./publish-reader.js", import.meta.url), "utf8");
const READER_TAG = new Bun.CryptoHasher("sha256").update(READER_SCRIPT).digest("hex").slice(0, 16);

/** The route the page's script reads and writes through, below the listener's base path. */
export const PAGE_ROUTE = "/_marginalia";

const MAX_WRITE_BYTES = 64 * 1024;
const MAX_POLL_MS = 20_000;
const EXTENSIONS_MAX_AGE_MS = 30_000;
/** At most this many annotated blocks of one page are read for its threads. */
const MAX_THREAD_BLOCKS = 200;

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
  replies: { id: string; body: string; by: string; at: string }[];
}

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
}

/** What the routes ask of the publisher. */
export interface PageHost {
  request<T>(request: Record<string, unknown>): Promise<T>;
  /**
   * The note at `page` (a published slug, a page name or an id) as the tailnet shows it now, locks read now: the note
   * alone (a folder page), or with what's under it (`full`). Undefined when there's no such note or it's locked.
   */
  view(page: string, full: boolean): Promise<PageView | undefined>;
  /** Whether a block's own properties lock it (`[publish::never]`). */
  locks(properties: readonly BlockProperty[]): boolean;
  /** Goes up with every change to the outline. */
  generation(): number;
  /** Resolves when the generation passes `since`, or after `ms`. */
  changed(since: number, ms: number): Promise<void>;
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

  constructor(private readonly host: PageHost) {}

  /** Answers a request below `<base>/_marginalia/` on the tailnet listener (`route` is the rest: `/threads`, `/write`, …). */
  async handle(request: Request, route: string): Promise<Response> {
    if (route === "/reader.js") {
      if (request.method !== "GET" && request.method !== "HEAD") return refused(405, "read-only");
      return new Response(READER_SCRIPT, { headers: {
        "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400, immutable",
        "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "cross-origin-resource-policy": "same-origin",
      } });
    }
    if (route === "/threads") {
      if (request.method !== "GET") return refused(405, "use GET");
      return this.threads(request);
    }
    if (route === "/write") {
      if (request.method !== "POST") return refused(405, "use POST");
      return this.write(request);
    }
    return refused(404, "not here");
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

  /** The page's open threads, as its script draws them. */
  async pageThreads(view: PageView): Promise<PageThread[]> {
    const annotated = [...new Set(view.annotations.values())].filter((id) => view.blocks.some((block) => block.id === id)).slice(0, MAX_THREAD_BLOCKS);
    const order = new Map(view.blocks.map((block, index) => [block.id, index]));
    const lists = await Promise.all(annotated.map(async (blockId) => {
      try {
        const threads = await this.host.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: false } });
        return threads.filter((thread) => {
          const subject = thread.resolvedTarget?.representation.subject ?? thread.originalTarget.representation.subject;
          return thread.lifecycle === "open" && view.annotations.has(thread.block.id) && subject.kind === "block" && subject.blockId === blockId;
        }).map((thread) => ({ blockId, thread }));
      } catch (error) {
        this.host.log(`publish: annotations.list: ${(error as Error).message}`);
        return [];
      }
    }));
    const start = (thread: AnnotationThread) => {
      const anchor = thread.resolvedTarget?.anchor;
      return anchor?.kind === "text-quote" ? anchor.start ?? 0 : 0;
    };
    return lists.flat()
      .sort((a, b) => (order.get(a.blockId)! - order.get(b.blockId)!) || start(a.thread) - start(b.thread))
      .map(({ thread }) => {
        const anchor = thread.resolvedTarget?.anchor;
        const properties = thread.properties ?? {};
        return {
          id: thread.block.id,
          quote: anchor?.kind === "text-quote" ? anchor.exact : "",
          kind: annotationKind(properties, thread.body),
          tone: annotationTone(properties),
          tags: [...new Set((properties.tags ?? []).flatMap((tag) => tag.split(",")).map((tag) => tag.trim()).filter(Boolean))],
          body: plainBody(thread.body),
          by: this.by(thread),
          at: thread.block.createdAt,
          // A reply marked [publish::never] stays off the page, as a locked note does.
          replies: thread.replies.filter((reply) => !this.host.locks(reply.block.properties ?? []))
            .map((reply) => ({ id: reply.block.id, body: plainBody(reply.body), by: this.by(reply), at: reply.block.createdAt })),
        };
      });
  }

  /**
   * The page's threads and what its toolbar offers. `since`: the generation the script last saw; while nothing has
   * changed the answer waits (up to 20 s) for a change, so a new answer reaches the page soon after it lands.
   */
  private async threads(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const page = url.searchParams.get("page") ?? "";
    const since = Number(url.searchParams.get("since"));
    if (url.searchParams.has("since") && Number.isFinite(since) && since === this.host.generation()) {
      await this.host.changed(since, Math.min(Number(url.searchParams.get("wait")) || MAX_POLL_MS, MAX_POLL_MS));
    }
    const generation = this.host.generation();
    const view = await this.host.view(page, url.searchParams.get("view") === "full");
    if (!view) return refused(404, "no such note here");
    const kit = await this.kit();
    const choices: PageChoice[] = [
      ...kit.actions.filter((action) => action.id === "highlight").map((action) => ({ action: action.id, label: action.label })),
      { action: "comment", label: "Comment" },
      ...(kit.agent ? [{ action: "ask", label: "Ask" }] : []),
      { action: "copy", label: "Copy" },
      ...(kit.agent ? [{ action: "explain", label: "Explain" }] : []),
      ...kit.actions.filter((action) => action.id !== "highlight").map((action) => ({ action: action.id, label: action.label })),
    ];
    return json(200, { generation, note: view.root.id, ...(kit.agent ? { agent: kit.agent } : {}), choices, threads: await this.pageThreads(view) });
  }

  private async write(request: Request): Promise<Response> {
    if (!sameOrigin(request)) return refused(403, "a write comes from the page itself");
    if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) return refused(415, "send JSON");
    const raw = await request.text();
    if (raw.length > MAX_WRITE_BYTES) return refused(413, "that's too long to send at once");
    let input: { page?: unknown; view?: unknown; action?: unknown; quote?: unknown; prefix?: unknown; suffix?: unknown; body?: unknown; thread?: unknown; requestId?: unknown };
    try { input = JSON.parse(raw); } catch { return refused(400, "send JSON"); }
    const text = (value: unknown) => typeof value === "string" ? value : "";
    const action = text(input.action);
    const requestId = /^[A-Za-z0-9_-]{8,64}$/.test(text(input.requestId)) ? text(input.requestId) : crypto.randomUUID();
    const view = await this.host.view(text(input.page), text(input.view) === "full");
    if (!view) return refused(404, "this note isn't here now (moved to Trash, or locked)");
    const said = (status: number, body: Record<string, unknown>) => json(status, { ...body, generation: this.host.generation() });
    try {
      if (action === "reply" || action === "resolve" || action === "read") {
        const thread = text(input.thread);
        if (!view.annotations.has(thread)) return refused(404, "that thread isn't on this page");
        if (action === "read") {
          const read = await this.host.request<{ thread: string; marked: number }>({ action: "annotations.read", annotationId: thread });
          return said(200, { ok: true, thread: read.thread, marked: read.marked });
        }
        if (action === "reply") {
          const body = text(input.body).trim() ? text(input.body) : "";
          if (!body) return refused(400, "write a reply first");
          const receipt = await this.host.request<AnnotationBatchReceipt>({
            action: "annotations.reply", requestId, author: "user", input: { annotationId: thread, body, source: "user" },
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
      const found = findDrawnPassage(view.blocks, { quote: text(input.quote), prefix: text(input.prefix), suffix: text(input.suffix) });
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
      const properties = action === "ask" ? { kind: "question" } : action === "explain" ? { kind: "explain" } : undefined;
      const selected = text(input.quote).trim();
      if (!found.ok) {
        // What he wrote still lands: on the page's own note, the words he meant quoted above it.
        const quoted = selected.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
        const thread = await this.batch(requestId, { blockId: view.root.id, expectedRevision: view.root.revision, body: selected ? `${quoted}\n\n${body}` : body, source: "user", ...(properties ? { properties } : {}) });
        return said(200, { ok: true, thread, landed: "note", said: selected ? `${found.why}; it landed on the whole note, with the words quoted` : "commented on the whole note" });
      }
      const p = found.passage;
      const thread = await this.batch(requestId, {
        blockId: found.block.id, expectedRevision: found.block.revision, body, source: "user",
        passage: { quote: p.quote, start: p.start, prefix: p.prefix, suffix: p.suffix }, ...(properties ? { properties } : {}),
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

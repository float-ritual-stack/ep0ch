// Isolated spike: intentionally reuse the private service client, never copy RPC or rendering.
import { OutlinerClient, OutlinerRequestError } from "../outliner/src/client";
import type { AnnotationThread, ChangeFeedPage, NewNoteReceipt, RenderedNote, VisibleBlockCollection } from "../outliner/src/types";
import { MAX_BLOCK_RECORD_IDS, type BlockRecordRead } from "../outliner/src/block-records";
import type { BlockRecord } from "@ep0ch/outline-core/block-record";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { edgesFor, type Atlas } from "./model";

const LIMIT = 240;
const MAX_BODY = 64 * 1024;
class HttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function text(value: unknown, name: string, max = MAX_BODY): string {
  if (typeof value !== "string" || value.length > max) throw new HttpError(400, `${name} must be text of at most ${max} characters.`);
  return value;
}
function id(value: unknown): string {
  const result = text(value, "Note id", 80);
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) throw new HttpError(400, "Invalid note id.");
  return result;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new HttpError(400, "A current positive note revision is required; reopen the note.");
  return value as number;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") throw new HttpError(415, "Send application/json.");
  if (Number(request.headers.get("content-length")) > MAX_BODY) throw new HttpError(413, "Request exceeds 64 KiB; shorten the draft.");
  const reader = request.body?.getReader();
  if (!reader) throw new HttpError(400, "A JSON body is required.");
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) {
    const next = await reader.read(); if (next.done) break;
    size += next.value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new HttpError(413, "Request exceeds 64 KiB; shorten the draft."); }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let result: unknown;
  try { result = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new HttpError(400, "Malformed JSON; keep your draft and try again."); }
  if (!result || typeof result !== "object" || Array.isArray(result)) throw new HttpError(400, "A JSON object is required.");
  return result as Record<string, unknown>;
}
function thread(thread: AnnotationThread) {
  const anchor = thread.originalTarget.anchor;
  return { id: thread.block.id, body: thread.body, quote: thread.originalTarget.passage?.quote ?? ("exact" in anchor ? anchor.exact : ""), by: thread.block.author, at: thread.block.createdAt,
    replies: thread.replies.map(reply => ({ id: reply.block.id, body: reply.body, by: reply.block.author, at: reply.block.createdAt })) };
}
export type ResonanceServer = Bun.Server<undefined>;

export async function startServer(client: OutlinerClient, port = 4789): Promise<ResonanceServer> {
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("RESONANCE_PORT must be an integer from 1024 to 65535.");
  await client.requireCompatibleService();
  const roots = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where: "expedition=resonance AND type=atlas", limit: 2 } });
  if (roots.blocks.length !== 1) throw new Error("The fictional expedition must have exactly one canonical atlas root.");
  const root = roots.blocks[0]!.id;
  const origin = `http://127.0.0.1:${port}`;
  const bundle = await Bun.build({ entrypoints: [`${import.meta.dir}/app.ts`], target: "browser", minify: false });
  if (!bundle.success || !bundle.outputs[0]) throw new Error(`Browser bundle failed: ${bundle.logs.map(log => log.message).join("; ")}`);
  const script = await bundle.outputs[0].text();
  const html = await Bun.file(`${import.meta.dir}/index.html`).text();
  const css = await Bun.file(`${import.meta.dir}/style.css`).text();
  async function records(ids: string[]): Promise<BlockRecord[]> {
    const result: BlockRecord[] = [];
    for (let offset = 0; offset < ids.length; offset += MAX_BLOCK_RECORD_IDS) {
      const answer = await client.request<BlockRecordRead>({ action: "blocks.records", ids: ids.slice(offset, offset + MAX_BLOCK_RECORD_IDS) });
      result.push(...answer.records);
    }
    return result;
  }
  async function record(noteId: string) {
    const found = (await records([noteId]))[0];
    if (!found) throw new HttpError(404, "Note no longer exists; refresh the atlas.");
    return found;
  }
  return Bun.serve({ hostname: "127.0.0.1", port, maxRequestBodySize: MAX_BODY,
    async fetch(request) {
      try {
        const url = new URL(request.url);
        if (request.headers.get("host") !== `127.0.0.1:${port}` || url.origin !== origin) throw new HttpError(403, "Use the exact loopback launch URL.");
        const suppliedOrigin = request.headers.get("origin");
        if ((suppliedOrigin && suppliedOrigin !== origin) || (request.method === "POST" && suppliedOrigin !== origin)) throw new HttpError(403, "Only this app's same-origin browser may write.");
        const site = request.headers.get("sec-fetch-site");
        if (site && site !== "same-origin" && site !== "none") throw new HttpError(403, "Cross-site requests are refused.");
        if (request.method !== "GET" && request.method !== "POST") throw new HttpError(405, "Only GET and POST are supported.");
        if (request.method === "GET" && url.pathname === "/api/health") return json({ outline: client.outline, protocol: PROTOCOL });
        if (request.method === "GET" && url.pathname === "/api/atlas") {
          const where = text(url.searchParams.get("where") ?? "expedition=resonance", "Query", 4096);
          const group = text(url.searchParams.get("group") ?? "signal", "Group", 128);
          const sort = text(url.searchParams.get("sort") ?? "title asc", "Sort", 128);
          const answer = await client.request<VisibleBlockCollection>({ action: "blocks.query", query: { where, group, sort, limit: LIMIT, facets: true } });
          const rows = await records(answer.blocks.map(block => block.id));
          const cursor = await client.request<ChangeFeedPage>({ action: "changes.since", sequence: Number.MAX_SAFE_INTEGER });
          const atlas: Atlas = { records: rows, edges: edgesFor(rows), groups: answer.groups ?? [], facets: answer.facets ?? [], completeness: answer.completeness,
            total: answer.completeness.kind === "truncated" ? answer.completeness.matched ?? rows.length : rows.length,
            sequence: cursor.sequence, outline: client.outline ?? "resonance", root };
          return json({ ...atlas, ...(answer.hint ? { hint: answer.hint } : {}) });
        }
        const noteMatch = /^\/api\/note\/([a-zA-Z0-9_-]+)$/.exec(url.pathname);
        if (noteMatch && request.method === "GET") {
          const noteId = id(noteMatch[1]);
          const [found, rendered, threads] = await Promise.all([record(noteId), client.request<RenderedNote>({ action: "notes.render", blockId: noteId, format: "html", marks: true }),
            client.request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: noteId }, includeResolved: true } })]);
          return json({ record: found, html: rendered.text, threads: threads.map(thread) });
        }
        if (noteMatch && request.method === "POST") {
          const input = await body(request); const noteId = id(noteMatch[1]);
          await client.request({ action: "update", blockId: noteId, text: text(input.text, "Draft"), expectedRevision: revision(input.revision), mutation: { author: "user" } });
          return json({ record: await record(noteId) });
        }
        if (url.pathname === "/api/comment" && request.method === "POST") {
          const input = await body(request); const noteId = id(input.id); const expectedRevision = revision(input.revision);
          const message = text(input.text, "Comment");
          if (!message.trim()) throw new HttpError(400, "Write a comment before sending.");
          let passage: { quote: string; start: number } | undefined;
          if (input.quote !== undefined) {
            const quote = text(input.quote, "Source quote"); const found = await record(noteId);
            if (found.revision !== expectedRevision) throw new HttpError(409, "Note changed; reopen it before anchoring a comment. Your comment is not saved.");
            const start = found.text.indexOf(quote);
            if (!quote || start < 0 || found.text.indexOf(quote, start + 1) !== -1) throw new HttpError(422, "Quote must occur exactly once in the current Blockdown source; select a longer exact passage or use a whole-note comment.");
            passage = { quote, start };
          }
          return json(await client.request({ action: "annotations.batch", requestId: crypto.randomUUID(), author: "user",
            operations: [{ operationId: crypto.randomUUID(), type: "block-comment", input: { blockId: noteId, expectedRevision, body: message, source: "user", ...(passage ? { passage } : {}) } }] }));
        }
        if (url.pathname === "/api/trail" && request.method === "POST") {
          const input = await body(request); const title = text(input.title, "Score title", 160).trim();
          if (!title || /[\r\n\[\]]/.test(title)) throw new HttpError(400, "Give the score a plain single-line title without property brackets.");
          if (!Array.isArray(input.ids) || !input.ids.length || input.ids.length > 120) throw new HttpError(400, "A score needs 1–120 notes.");
          const ids = input.ids.map(id); const found = await records([...new Set(ids)]); const existing = new Set(found.map(row => row.id));
          if (ids.some(noteId => !existing.has(noteId))) throw new HttpError(404, "A score note disappeared; refresh before saving. Nothing was written.");
          const source = `${title} [type::score] [expedition::resonance]\n\nA visitor-authored listening sequence. These are live transclusions, not frozen copies.\n\n${ids.map((noteId, index) => `## ${index + 1}. ((` + noteId + `))\n\n!((${noteId}))`).join("\n\n")}`;
          const receipt = await client.request<NewNoteReceipt>({ action: "notes.create", text: source, intent: { kind: "note" }, author: "user" });
          return json({ id: receipt.block.id, title });
        }
        if (request.method === "GET") {
          const asset = url.pathname === "/" || url.pathname === "/index.html" ? [html, "text/html"] : url.pathname === "/app.js" ? [script, "text/javascript"] : url.pathname === "/style.css" ? [css, "text/css"] : null;
          if (asset) return new Response(asset[0], { headers: { "Content-Type": `${asset[1]}; charset=utf-8`, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", "Referrer-Policy": "no-referrer" } });
        }
        throw new HttpError(404, "No such route.");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const status = error instanceof HttpError ? error.status : error instanceof OutlinerRequestError ? (/revision|changed since|conflict/i.test(message) ? 409 : /not found|does not exist|unknown block/i.test(message) ? 404 : 422) : /body.*(large|limit)|payload.*large/i.test(message) ? 413 : /timed out|ECONNREFUSED|ENOENT/.test(message) ? 503 : 500;
        return json({ error: message }, status);
      }
    },
    error(error) { return json({ error: error.message }, /body.*(large|limit)|payload.*large/i.test(error.message) ? 413 : 500); },
  });
}

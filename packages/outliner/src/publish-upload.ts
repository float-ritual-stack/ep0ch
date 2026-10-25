// The upload route (PIE-1267): `PUT|POST /_upload/<token>[/<filename>]` on the signed-in web client's origin
// (my.ep0ch.sh), reached before the sign-in because the token is the credential, like the Loki lease route
// (publish-loki.ts). It takes one file (a page, a zip, a tar), writes it whole into the server-side inbox
// (`inbox-remote`, artifact-inbox.ts) and answers once the watcher has installed it, or has said why not.
//
// The host decides who may upload (`uploads.take`, upload-tokens.ts): GET and HEAD only look, so a link preview never
// burns a lease; a write claims it, and a finished receipt settles it. This route owns the bytes: it streams them to
// a hidden temporary folder, counts them against the cap, and renames the folder into place when they have all
// arrived, so the watcher never sees half of a drop.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { UploadTake } from "@ep0ch/outline-core/protocol";
import { artifactReference } from "@ep0ch/outline-core/artifacts";
import type { OutlinerClient } from "./client";
import { artifactLimit, DROP_FILE, DROP_RESULTS, remoteInbox, type DropMeta, type DropResult } from "./artifact-inbox";
import { looksTar, looksZip } from "./artifact-archive";

export interface UploadRouteOptions {
  /** The outlines folder, which holds the artifact store and so its inbox. */
  outlines: string;
  log: (line: string) => void;
  /** How long the sender's request waits for the watcher's answer before saying it is still installing. */
  waitMs?: number;
  env?: NodeJS.ProcessEnv;
}

const HEADERS = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff" };
const text = (body: string, status: number, extra: Record<string, string> = {}) =>
  new Response(body.endsWith("\n") ? body : `${body}\n`, { status, headers: { ...HEADERS, "content-type": "text/plain; charset=utf-8", ...extra } });
const json = (body: unknown, status: number) => new Response(`${JSON.stringify(body)}\n`, { status, headers: { ...HEADERS, "content-type": "application/json; charset=utf-8" } });

/** The extension a type says (a phone sends a file with no name). */
const TYPES: Record<string, string> = {
  "text/html": ".html", "application/zip": ".zip", "application/x-zip-compressed": ".zip", "application/x-tar": ".tar", "image/svg+xml": ".svg",
  "application/pdf": ".pdf", "image/png": ".png", "image/jpeg": ".jpg", "image/gif": ".gif", "image/webp": ".webp", "text/markdown": ".md",
};

/** A filename that is safe as one path segment of the inbox: letters, numbers, dots, hyphens and underscores. */
export function dropFilename(value: string | undefined): string {
  const base = (value ?? "").split(/[\\/]/).pop() ?? "";
  const clean = base.normalize("NFKD").replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").replace(/-+$/, "").slice(0, 100);
  return clean;
}

function filenameOf(url: URL, rest: string | undefined, headers: Headers): string {
  const disposition = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(headers.get("content-disposition") ?? "")?.[1];
  let fromPath: string | undefined;
  try { fromPath = rest ? decodeURIComponent(rest) : undefined; } catch { fromPath = rest; }
  return dropFilename(fromPath) || dropFilename(url.searchParams.get("filename") ?? undefined) || dropFilename(disposition ? decodeURIComponent(disposition) : undefined) || "upload";
}

/** A name with no extension gets the one its bytes (or its declared type) show; a wrong extension on an archive is corrected. */
function withExtension(filename: string, head: Uint8Array, contentType: string | null): string {
  const dot = filename.lastIndexOf("."), stem = dot > 0 ? filename.slice(0, dot) : filename, ext = dot > 0 ? filename.slice(dot).toLowerCase() : "";
  if (looksZip(head)) return ext === ".zip" ? filename : `${stem}.zip`;
  if (looksTar(head)) return ext === ".tar" ? filename : `${stem}.tar`;
  if (ext) return filename;
  const declared = TYPES[(contentType ?? "").split(";")[0]!.trim().toLowerCase()];
  if (declared) return `${filename}${declared}`;
  const start = Buffer.from(head.subarray(0, 1024)).toString("utf8").trimStart().toLowerCase();
  if (start.startsWith("<!doctype html") || start.startsWith("<html") || start.includes("<title>")) return `${filename}.html`;
  if (start.startsWith("<svg") || start.startsWith("<?xml")) return `${filename}.svg`;
  return filename;
}

const dropPage = (who: { name?: string; outline: string; deviceName?: string }, expiresAt?: string) => `<!doctype html>
<html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Send a file to ep0ch</title>
<style>:root{color-scheme:dark}body{background:#1b1712;color:#e9dfc7;font:17px/1.5 system-ui,sans-serif;margin:0;padding:16px;max-width:36rem}button,input{font:inherit;color:inherit;background:#2b241b;border:1px solid #6b5a3d;border-radius:6px;padding:.5em .8em;min-height:44px}pre{white-space:pre-wrap}</style>
<h1>Send a file to ep0ch</h1>
<p>${who.name ? `It becomes <b>${esc(who.name)}</b>` : "A page, a zip or a tar becomes an artifact"}, with a card in <b>${esc(who.outline)}</b>'s note for today.${expiresAt ? ` One upload, good until ${esc(expiresAt)}.` : ""}</p>
<p><input type="file" id="f"> <button id="b">Send</button></p><pre id="o"></pre>
<script>document.getElementById("b").onclick=async()=>{const f=document.getElementById("f").files[0],o=document.getElementById("o");if(!f){o.textContent="Choose a file first.";return}o.textContent="Sending…";try{const r=await fetch(location.pathname.replace(/\\/?$/,"/")+encodeURIComponent(f.name),{method:"PUT",body:f});o.textContent=await r.text()}catch(e){o.textContent="Failed: "+e.message}}</script>
</html>
`;
const esc = (value: string) => value.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export async function publishUpload(request: Request, host: Pick<OutlinerClient, "request">, options: UploadRouteOptions): Promise<Response> {
  const url = new URL(request.url);
  const match = /^\/_upload\/([A-Za-z0-9_-]{16,})(?:\/(.*))?$/.exec(url.pathname);
  if (!match) return text("No upload link here\n", 404);
  const method = request.method;
  if (method !== "GET" && method !== "HEAD" && method !== "PUT" && method !== "POST") return text("An upload link takes PUT or POST: curl -T <file> <link>", 405, { allow: "GET, HEAD, PUT, POST" });
  const env = options.env ?? process.env;
  const taken = await host.request<UploadTake>({ action: "uploads.take", token: match[1]!, method });
  if (taken.status !== 200) return text(taken.reason, taken.status);
  if (method === "GET" || method === "HEAD") {
    const page = dropPage(taken.who, taken.expiresAt);
    return new Response(method === "HEAD" ? null : page, { status: 200, headers: { ...HEADERS, "content-type": "text/html; charset=utf-8" } });
  }

  const claim = taken.claim!;
  let received = false;
  const inbox = remoteInbox(options.outlines, env);
  const part = join(inbox, `.${crypto.randomUUID()}.part`);
  try {
    const limit = artifactLimit();
    const declared = Number(request.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > limit) return text(`That file is ${declared} bytes; the cap is ${limit}. Send a smaller one (a zip of a built site is usually far smaller).`, 413);
    if (!request.body) return text("Nothing was sent. Send the file as the request body: curl -T <file> <link>", 400);
    const who = taken.who;
    // Only a device may name the artifact or the outline per upload; a lease was made for one name and one outline.
    let name = who.kind === "lease" ? who.name : url.searchParams.get("name")?.trim() || undefined;
    if (name && artifactReference(name)?.name !== name) return text(`name is letters, numbers, dots, underscores or hyphens: ${name}`, 400);
    const outline = who.kind === "device" ? url.searchParams.get("outline")?.trim() || who.outline : who.outline;
    const note = url.searchParams.get("note")?.trim().slice(0, 200) || undefined;

    mkdirSync(join(part, "file"), { recursive: true });
    const staging = join(part, "file", "incoming");
    const sink = Bun.file(staging).writer();
    const hash = new Bun.CryptoHasher("sha256");
    let bytes = 0, head = new Uint8Array(0);
    try {
      for await (const chunk of request.body as unknown as AsyncIterable<Uint8Array>) {
        bytes += chunk.length;
        if (bytes > limit) { await sink.end(); return text(`That file passes the cap of ${limit} bytes. Send a smaller one.`, 413); }
        if (head.length < 4096) head = Buffer.concat([head, chunk.subarray(0, 4096 - head.length)]);
        hash.update(chunk);
        sink.write(chunk);
      }
      await sink.end();
    } catch (error) {
      // The sender went away mid-transfer: nothing is kept, and the link still works until it expires.
      try { await sink.end(); } catch { /* Already closed. */ }
      options.log(`upload: ${who.kind} ${who.id} aborted at ${bytes} bytes: ${error instanceof Error ? error.message : String(error)}`);
      return text("The upload was interrupted; nothing was kept. The link still works until it expires.", 400);
    }
    if (!bytes) return text("That file is empty.", 400);

    const filename = withExtension(filenameOf(url, match[2], request.headers), head, request.headers.get("content-type"));
    renameSync(staging, join(part, "file", filename));
    const id = `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;
    const meta: DropMeta = {
      id, via: who.kind, source: who.kind === "lease" ? who.id : who.deviceName ?? who.id, by: who.by, outline, ...(note ? { note } : {}), ...(name ? { name } : {}),
      filename, bytes, sha256: hash.digest("hex"), at: new Date().toISOString(),
    };
    writeFileSync(join(part, DROP_FILE), JSON.stringify(meta));
    renameSync(part, join(inbox, id));
    received = true;
    options.log(`upload: ${who.kind} ${who.id} delivered ${filename} (${bytes} bytes) as drop ${id}`);
    // The file is in: this link has done its one upload, whatever the check says next.
    await host.request({ action: "uploads.finish", claim, ok: true }).catch((error: Error) => options.log(`upload: could not settle ${who.kind} ${who.id}: ${error.message}`));

    const result = await awaitResult(inbox, id, options.waitMs ?? Number(env.EP0CH_UPLOAD_WAIT_MS ?? 25_000));
    if (!result) return json({ ok: true, pending: true, received: { bytes, sha256: meta.sha256 }, said: `Received ${filename}. It is being checked and installed; a card for it lands in ${outline}'s note for today.` }, 202);
    if (!result.ok) return json({ ok: false, reason: result.reason, received: { bytes, sha256: meta.sha256 }, said: `Refused: ${result.reason}` }, 422);
    return json({
      ok: true, name: result.name, version: result.version, ...(result.title ? { title: result.title } : {}), outline, card: result.card, record: result.record,
      said: `Installed ${result.name} version ${result.version}${result.title ? ` (${result.title})` : ""}. ${result.card}`,
    }, 201);
  } finally {
    if (!received) {
      rmSync(part, { recursive: true, force: true });
      await host.request({ action: "uploads.finish", claim, ok: false }).catch(() => {});
    }
  }
}

/** The watcher's answer to drop `id`, waiting up to `waitMs`; undefined when it has not answered. */
async function awaitResult(inbox: string, id: string, waitMs: number): Promise<DropResult | undefined> {
  const path = join(inbox, DROP_RESULTS, `${id}.json`);
  const end = Date.now() + waitMs;
  for (;;) {
    if (existsSync(path)) {
      try {
        const result = JSON.parse(readFileSync(path, "utf8")) as DropResult;
        rmSync(path, { force: true });
        return result;
      } catch { /* Half written: the next look reads it whole. */ }
    }
    if (Date.now() >= end) return undefined;
    await Bun.sleep(100);
  }
}

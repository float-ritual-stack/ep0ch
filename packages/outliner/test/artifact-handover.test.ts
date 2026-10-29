// Handing a file to ep0ch from outside (PIE-1267), through real HTTP: an upload lease an agent curls, a device token a
// phone's Shortcut uses, the server-side inbox the watcher reads, and the card that lands in today's note. A scratch
// outline host serves two made-up outlines; the sign-in gate fronts the route as my.ep0ch.sh does (its token is the
// credential, so no Clerk is needed); every zip, tar and page is made up.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import type { UploadLease } from "@ep0ch/outline-core/protocol";
import { ArtifactStore } from "../src/artifact-store";
import { arrivalCard } from "../src/artifact-handover";
import { OutlinerClient } from "../src/client";
import { runDeviceCommand } from "../src/device-cli";
import { OutlineHost } from "../src/outline-host";
import { publishUpload } from "../src/publish-upload";
import { shortcutResponse } from "../src/send-to-ep0ch-shortcut";
import { createPdfFixture } from "./pdf-fixture";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { UploadTokens, UPLOAD_LEASE_TTL_MS } from "../src/upload-tokens";
import { SignInGate } from "../src/web-signin";
import { tar, zip } from "./zip-fixture";

const ORIGIN = "https://my.example.test";
const HOST = new URL(ORIGIN).host;

let root = "";
let outlines = "";
let host: OutlineHost;
let client: OutlinerClient;
let watcher: ArtifactStore;
let server: ReturnType<typeof Bun.serve>;
const logged: string[] = [];
const saved: Record<string, string | undefined> = {};

const setEnv = (key: string, value: string | undefined) => {
  if (!(key in saved)) saved[key] = process.env[key];
  if (value === undefined) delete process.env[key]; else process.env[key] = value;
};

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "outliner-handover-")));
  outlines = join(root, "outlines");
  const layout = outlineLayout(outlines);
  for (const name of ["garden", "ledger"]) new OutlinerStore(layout.database(name), { workspaceRoot: root }).close();
  setEnv("EP0CH_WEB_URL", ORIGIN);
  setEnv("EP0CH_ARTIFACT_REMOTE_SETTLE_MS", "20");
  host = new OutlineHost({ outlinesFolder: layout.root, log: line => logged.push(line) });
  await host.start();
  client = new OutlinerClient(layout.socket, 15_000, "garden");
  watcher = new ArtifactStore(layout.root);
  watcher.startWatcher();
  const gate = new SignInGate({
    settings: { origin: ORIGIN, issuer: "http://127.0.0.1:9", clientId: "fictionalWebClient", allowedSubjects: ["user_fictional0001"], home: "/pub/" },
    request: input => client.request(input as Parameters<typeof client.request>[0]),
    serve: async () => new Response("signed in"),
    upload: request => publishUpload(request, client, { outlines: layout.root, log: line => logged.push(line), waitMs: 20_000 }),
    shortcut: deviceId => shortcutResponse(client, deviceId),
    log: line => logged.push(line),
  });
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => gate.handle(request) });
});

afterAll(async () => {
  server?.stop(true);
  await watcher?.close();
  await host?.close();
  for (const [key, value] of Object.entries(saved)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  rmSync(root, { recursive: true, force: true });
});

afterEach(() => { setEnv("EP0CH_ARTIFACT_MAX_BYTES", undefined); setEnv("EP0CH_ARTIFACT_MAX_ENTRIES", undefined); });

const lease = (name?: string, outline = "garden", mutation: { author: "user" } | { author: "agent"; actorId: string } = { author: "user" }) =>
  new OutlinerClient(outlineLayout(outlines).socket, 15_000, outline).request<UploadLease>({ action: "artifacts.lease", ...(name ? { name } : {}), mutation });
/** The lease's link, aimed at the scratch server (the real one is https://my.ep0ch.sh/…). */
const local = (url: string) => `http://127.0.0.1:${server.port}${new URL(url).pathname}`;
const send = (url: string, body: BodyInit | Uint8Array, init: RequestInit = {}) => fetch(local(url), { method: "PUT", body: body as BodyInit, headers: { host: HOST }, redirect: "manual", ...init });
const day = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
async function childrenOf(outline: string, address: string): Promise<Block[]> {
  const page = await new OutlinerClient(outlineLayout(outlines).socket, 15_000, outline).request<{ block?: Block }>({ action: "pages.resolve", address });
  if (!page.block) return [];
  return new OutlinerClient(outlineLayout(outlines).socket, 15_000, outline).request<Block[]>({ action: "children", parentId: page.block.id });
}
const remote = () => join(outlines, ".artifacts", "inbox-remote");
const live = (name: string) => join(outlines, ".artifacts", "live", name);
const site = (title: string) => `<!doctype html><title>${title}</title><h1>${title}</h1>`;

test("a leased zip is unpacked, versioned, carded in today's note and recorded, and the link is then used up", async () => {
  const issued = await lease("orrery");
  expect(issued.url).toStartWith(`${ORIGIN}/_upload/`);
  expect(issued.url.endsWith("/")).toBe(true);
  expect(issued.curl).toContain("curl -sS -T");
  // The real curl, as the agent in claude.ai's sandbox runs it: -T on a link ending in "/" sends the file's own name.
  const file = join(root, "orrery-site.zip");
  writeFileSync(file, zip([
    { name: "orrery-site/index.html", data: site("Moth Orrery") },
    { name: "orrery-site/assets/app.js", data: "console.log('lantern')" },
    { name: "__MACOSX/orrery-site/._index.html", data: "clutter" },
  ]));
  const curl = Bun.spawn(["curl", "-sS", "-H", `Host: ${HOST}`, "-T", file, `${local(issued.url)}`], { stdout: "pipe", stderr: "pipe" });
  const body = await new Response(curl.stdout).text();
  expect(await curl.exited, await new Response(curl.stderr).text()).toBe(0);
  const answer = JSON.parse(body);
  expect(answer).toMatchObject({ ok: true, name: "orrery", version: 1, title: "Moth Orrery", outline: "garden" });
  expect(answer.said).toContain("Installed orrery version 1");
  // Unpacked with the folder's contents at the root, the desktop's clutter left out.
  expect(readFileSync(join(live("orrery"), "index.html"), "utf8")).toContain("Moth Orrery");
  expect(existsSync(join(live("orrery"), "assets/app.js"))).toBe(true);
  expect(existsSync(join(live("orrery"), "__MACOSX"))).toBe(false);
  // The card: today's note in the lease's outline, titled by the page, drawing the artifact.
  const cards = await childrenOf("garden", day());
  expect(cards.map(card => card.text)).toContain("Moth Orrery [arrival::new] [arrival-kind::site] [sent-by::you]\n[artifact::orrery]");
  // The record of the arrival, where records go (machinery, so default searches leave it out).
  const records = await childrenOf("garden", "artifact-uploads");
  expect(records).toHaveLength(1);
  expect(records[0]!.text).toContain("Uploaded orrery version 1");
  expect(records[0]!.text).toContain("[machine::upload]");
  expect(records[0]!.text).toContain("lease " + issued.id);
  expect(records[0]!.text).toContain("orrery-site.zip");
  // The drop is gone from the server-side inbox; nothing came near the synced one.
  expect(readdirSync(remote()).filter(name => !name.startsWith(".") && name !== "receipts.log")).toEqual([]);
  expect(existsSync(join(outlines, ".artifacts", "inbox", "orrery-site.zip"))).toBe(false);
  // One upload: the link says so, and why.
  const again = await send(issued.url, "second try");
  expect(again.status).toBe(410);
  expect(await again.text()).toContain("already used");
});

test("sending the same name again is its next version, and a single page names itself by its title", async () => {
  const second = await send((await lease("orrery")).url, site("Moth Orrery, second light"), { headers: { host: HOST, "content-type": "text/html" } });
  expect(second.status).toBe(201);
  expect((await second.json()).version).toBe(2);
  expect(readFileSync(join(live("orrery"), "upload.html"), "utf8")).toContain("second light");
  // A tar of a folder works the same way as a zip.
  const tarred = await send((await lease("lantern-tar")).url, tar([{ name: "lantern/", type: "5" }, { name: "lantern/index.html", data: site("Lantern") }]), { headers: { host: HOST, "content-disposition": 'attachment; filename="lantern.tar"' } });
  expect(tarred.status).toBe(201);
  expect(readFileSync(join(live("lantern-tar"), "index.html"), "utf8")).toContain("Lantern");
});

test("a 10 MB page and a 10 MB zip are taken, and a page named orrery.html titled ep0ch Orrery is ep0ch-orrery", async () => {
  const big = `<!doctype html><title>ep0ch Orrery</title><script>const graph = "${"x".repeat(10 * 1024 * 1024)}"</script>`;
  const page = await send((await lease()).url + "orrery.html", big);
  expect(page.status, await page.clone().text()).toBe(201);
  expect(await page.json()).toMatchObject({ name: "ep0ch-orrery", version: 1, title: "ep0ch Orrery" });
  // Incompressible bytes: the zip itself is 10 MB.
  const noise = crypto.getRandomValues(new Uint8Array(10 * 1024 * 1024));
  const archive = await send((await lease()).url + "woe-chronicles.zip", zip([{ name: "index.html", data: site("Chronicles") }, { name: "data.bin", data: noise, method: 0 }]));
  expect(archive.status, await archive.clone().text()).toBe(201);
  expect(await archive.json()).toMatchObject({ name: "woe-chronicles", version: 1 });
  expect(readFileSync(join(live("woe-chronicles"), "data.bin")).length).toBe(noise.length);
});

test("a lease with no name lets the page name itself, and an agent's lease makes an agent's card in the outline it was asked of", async () => {
  const issued = await lease(undefined, "ledger", { author: "agent", actorId: "fictional-agent/claude-code@test" });
  expect(issued.outline).toBe("ledger");
  expect(issued.name).toBeUndefined();
  const sent = await send(issued.url, site("Ledger Lanterns"), { headers: { host: HOST, "content-type": "text/html" } });
  expect(sent.status, await sent.clone().text()).toBe(201);
  expect(await sent.json()).toMatchObject({ name: "ledger-lanterns", version: 1, title: "Ledger Lanterns", outline: "ledger" });
  const cards = await childrenOf("ledger", day());
  const card = cards.find(block => block.text.includes("[artifact::ledger-lanterns]"));
  expect(card?.author).toBe("agent");
  expect(card?.actorId).toBe("fictional-agent/claude-code@test");
  expect((await childrenOf("ledger", "artifact-uploads"))[0]!.text).toContain("minted by fictional-agent/claude-code@test");
  // The garden's note for today was not touched.
  expect((await childrenOf("garden", day())).some(block => block.text.includes("ledger-lanterns"))).toBe(false);
});

/** A one-page PDF, written by hand: a page with one line of text, its offsets counted so readers take it as it is. */
function onePagePdf(): Buffer {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 100] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    "<< /Length 44 >>\nstream\nBT /F1 18 Tf 20 40 Td (Lantern deck) Tj ET\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let body = "%PDF-1.4\n";
  const offsets = objects.map((object, i) => { const at = body.length; body += `${i + 1} 0 obj\n${object}\nendobj\n`; return at; });
  const xref = body.length;
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(at => `${String(at).padStart(10, "0")} 00000 n \n`).join("")}`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "latin1");
}
/** A 1×1 PNG. */
const DOT_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const hasPdftoppm = Bun.which("pdftoppm") !== null;

test("a lone PDF arrives as a document: a page drawn by its first page and linking the file, and a card that says so (PIE-1370)", async () => {
  const issued = await lease(undefined, "garden", { author: "agent", actorId: "fictional-agent/claude-code@test" });
  const sent = await send(issued.url + "Lantern-Deck.pdf", onePagePdf());
  const answer = await sent.json();
  expect(sent.status, JSON.stringify(answer)).toBe(201);
  expect(answer).toMatchObject({ ok: true, name: "lantern-deck", kind: "document", title: "Lantern-Deck.pdf" });
  expect(answer.said).toContain("a document");
  // It has a page now: the frame that was an empty box shows the first page and links the PDF.
  const page = readFileSync(join(live("lantern-deck"), "index.html"), "utf8");
  expect(page).toContain('href="./Lantern-Deck.pdf"');
  if (hasPdftoppm) {
    expect(readFileSync(join(live("lantern-deck"), "first-page.png")).subarray(1, 4).toString()).toBe("PNG");
    expect(page).toContain('src="./first-page.png"');
  } else expect(page).toContain("pdftoppm isn&#39;t installed here");
  expect(existsSync(join(live("lantern-deck"), "Lantern-Deck.pdf"))).toBe(true);
  // The card: what it is and who sent it on its title line, the artifact line under it as before.
  const card = (await childrenOf("garden", day())).find(block => block.text.includes("[artifact::lantern-deck]"));
  expect(card?.text).toBe("Lantern-Deck.pdf [arrival::new] [arrival-kind::document] [sent-by::fictional-agent/claude-code@test]\n[artifact::lantern-deck]");
  // A tidy pass finds it by the chip, as a query, with nothing in a reader special-casing the key.
  const open = await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "arrival=new AND arrival-kind=document" } as never });
  expect(open.blocks.map(block => block.id)).toContain(card!.id);
});

test("a lone image arrives as an image, served as itself", async () => {
  const sent = await send((await lease()).url + "moth.png", DOT_PNG);
  const answer = await sent.json();
  expect(sent.status, JSON.stringify(answer)).toBe(201);
  expect(answer).toMatchObject({ name: "moth", kind: "image", title: "moth.png" });
  expect(readdirSync(live("moth"))).toEqual(["moth.png"]);
  expect((await childrenOf("garden", day())).map(block => block.text)).toContain("moth.png [arrival::new] [arrival-kind::image] [sent-by::you]\n[artifact::moth]");
});

test("a page titled like a block opener still makes a card whose properties and artifact line read", () => {
  for (const title of ["~~~example", "::graph-stat", "---", "> quoted"]) {
    const card = arrivalCard({ by: "you" }, { name: "odd", version: 1, kind: "page", title });
    expect(card).toMatch(/^[\p{L}\p{N}]/u);
    expect(card.split("\n")[1]).toBe("[artifact::odd]");
  }
});

test("a link preview or an interrupted upload leaves the lease working; only a finished upload uses it", async () => {
  const issued = await lease("preview-proof");
  expect((await fetch(local(issued.url), { method: "HEAD", headers: { host: HOST } })).status).toBe(200);
  const page = await fetch(local(issued.url), { headers: { host: HOST } });
  expect(page.status).toBe(200);
  expect(await page.text()).toContain("Send a file to ep0ch");
  // A transfer that starts and then drops: nothing is kept and the link is as it was.
  const controller = new AbortController();
  const stalled = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode("<!doctype html><title>Half")); setTimeout(() => controller.abort(), 100); } });
  await send(issued.url, stalled, { signal: controller.signal, duplex: "half" } as RequestInit).catch(() => {});
  let finished: Response | undefined;
  for (let tries = 0; tries < 40; tries++) {
    finished = await send(issued.url, site("Whole"), { headers: { host: HOST, "content-type": "text/html" } });
    if (finished.status !== 409) break;
    await finished.text();
    await Bun.sleep(50);
  }
  expect(finished!.status).toBe(201);
  expect(existsSync(live("preview-proof"))).toBe(true);
  expect(readFileSync(join(live("preview-proof"), "upload.html"), "utf8")).toContain("Whole");
  expect((await send(issued.url, site("Third"))).status).toBe(410);
});

test("a filename with a percent sign, and a zip entry named __proto__, are ordinary", async () => {
  const percent = await send((await lease("percent-page")).url, site("Percent"), { headers: { host: HOST, "content-type": "text/html", "content-disposition": 'attachment; filename="100%.html"' } });
  expect(percent.status, await percent.clone().text()).toBe(201);
  expect(readFileSync(join(live("percent-page"), "100-.html"), "utf8")).toContain("Percent");
  const odd = await send((await lease("proto-site")).url, zip([{ name: "index.html", data: site("Proto") }, { name: "__proto__", data: "kept, not hidden" }]));
  expect(odd.status, await odd.clone().text()).toBe(201);
  expect(readFileSync(join(live("proto-site"), "__proto__"), "utf8")).toBe("kept, not hidden");
});

test("a host that restarted mid-upload still uses the lease up when the upload finishes", () => {
  const file = join(root, "restart-tokens.json");
  const before = new UploadTokens(file);
  const { token } = before.startLease({ name: "survivor", outline: "garden", by: "you" });
  const taken = before.take(token, "PUT");
  if (taken.status !== 200) throw new Error("the lease should admit the upload");
  const after = new UploadTokens(file);
  after.finish(taken.claim!, true);
  expect(after.take(token, "PUT")).toMatchObject({ status: 410 });
});

test("an expired lease, an unknown one and a wrong method are refused, each with why", async () => {
  let now = Date.parse("2026-10-24T20:00:00Z");
  const tokens = new UploadTokens(join(root, "tokens-under-test.json"), () => {}, () => now);
  const stand = {
    request: async (input: Record<string, unknown>) => {
      if (input.action === "uploads.take") return tokens.take(input.token as string, input.method as "PUT");
      if (input.action === "uploads.finish") { tokens.finish(input.claim as string, input.ok === true); return { ok: true }; }
      throw new Error(`unexpected ${String(input.action)}`);
    },
  } as unknown as Pick<OutlinerClient, "request">;
  const front = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: request => publishUpload(request, stand, { outlines, log: () => {}, waitMs: 50 }) });
  try {
    const { token } = tokens.startLease({ name: "late", outline: "garden", by: "you" });
    now += UPLOAD_LEASE_TTL_MS + 1000;
    const expired = await fetch(`http://127.0.0.1:${front.port}/_upload/${token}/late.html`, { method: "PUT", body: site("Late") });
    expect(expired.status).toBe(410);
    expect(await expired.text()).toContain("expired");
    const unknown = await fetch(`http://127.0.0.1:${front.port}/_upload/${"x".repeat(43)}/late.html`, { method: "PUT", body: "nope" });
    expect(unknown.status).toBe(404);
    expect(await unknown.text()).toContain("ask for a new one");
    const wrong = await fetch(`http://127.0.0.1:${front.port}/_upload/${token}/`, { method: "DELETE" });
    expect(wrong.status).toBe(405);
    expect(existsSync(live("late"))).toBe(false);
  } finally { front.stop(true); }
});

const hazards: [string, () => Buffer, RegExp][] = [
  ["a name that climbs out of the folder", () => zip([{ name: "site/index.html", data: site("Ok") }, { name: "site/../../evil.html", data: "x" }]), /Unsafe artifact path/],
  ["an absolute path", () => zip([{ name: "/etc/evil.html", data: "x" }]), /Unsafe artifact path/],
  ["a symlink", () => zip([{ name: "site/index.html", data: site("Ok") }, { name: "site/link", data: "/etc/passwd", mode: 0o120777 }]), /can't contain links/],
  ["a zip bomb that declares more than the cap", () => zip([{ name: "big.bin", data: Buffer.alloc(400_000) }]), /unpacks past/],
  ["a header that lies about its size", () => zip([{ name: "small.txt", data: Buffer.alloc(150_000), claims: 10 }]), /more than the 10 bytes|bytes, not the/],
  ["more entries than the cap", () => zip(Array.from({ length: 30 }, (_, i) => ({ name: `f${i}.txt`, data: "x" }))), /entries; cap is 20/],
  ["a tar that lists a file twice", () => tar([{ name: "index.html", data: site("One") }, { name: "./index.html", data: site("Two") }]), /twice/],
  ["a tar with a symlink", () => tar([{ name: "ok.html", data: site("Ok") }, { name: "link", type: "2", link: "/etc/passwd" }]), /without links/],
];
for (const [what, build, reason] of hazards) {
  test(`an archive with ${what} is held in .failed with its reason and installs nothing`, async () => {
    setEnv("EP0CH_ARTIFACT_MAX_BYTES", "300000");
    setEnv("EP0CH_ARTIFACT_MAX_ENTRIES", "20");
    const name = `hazard-${hazards.findIndex(h => h[0] === what)}`;
    const refused = await send((await lease(name)).url, build());
    const answer = await refused.json();
    expect(refused.status, JSON.stringify(answer)).toBe(422);
    expect(answer.ok).toBe(false);
    expect(answer.reason).toMatch(reason);
    expect(existsSync(live(name))).toBe(false);
    const held = readdirSync(join(remote(), ".failed"));
    expect(held.length).toBeGreaterThan(0);
    const reasons = held.map(id => readFileSync(join(remote(), ".failed", id, "reason.txt"), "utf8"));
    expect(reasons.some(text => reason.test(text))).toBe(true);
    // The refusal is on the record, with no card.
    const records = (await childrenOf("garden", "artifact-uploads")).map(block => block.text);
    expect(records.some(text => text.includes("[state::refused]") && reason.test(text))).toBe(true);
    expect((await childrenOf("garden", day())).some(card => card.text.includes(name))).toBe(false);
  });
}

test("a file past the cap is refused before it is kept, and the lease stays good", async () => {
  setEnv("EP0CH_ARTIFACT_MAX_BYTES", "1000");
  try {
    const issued = await lease("too-big");
    const refused = await send(issued.url, "x".repeat(5000));
    expect(refused.status).toBe(413);
    expect(await refused.text()).toContain("cap");
    expect(readdirSync(remote()).filter(name => name.endsWith(".part"))).toEqual([]);
    setEnv("EP0CH_ARTIFACT_MAX_BYTES", undefined);
    expect((await send(issued.url, site("Small"))).status).toBe(201);
  } finally { setEnv("EP0CH_ARTIFACT_MAX_BYTES", undefined); }
});

test("a device token sends many files, to a note it names, until it is revoked, and is never listed", async () => {
  const lines: string[] = [], errors: string[] = [];
  const io = { out: (line: string) => lines.push(line), err: (line: string) => errors.push(line) };
  const env = { ...process.env, EP0CH_SOCKET: outlineLayout(outlines).socket, EP0CH_OUTLINES: outlines };
  expect(await runDeviceCommand(["add", "Fictional Phone", "--ws", "garden"], io, env), errors.join("\n")).toBe(0);
  const link = lines.join("\n").match(/https:\/\/\S+\/_upload\/\S+/)![0];
  const aim = (extra = "") => `${local(link)}/${extra}`;
  await client.request({ action: "create", parentId: null, text: "Field notes [page::field-notes]\nWhat the garden did this autumn." });
  const first = await fetch(aim("photo-page.html?name=night-page&note=field-notes"), { method: "POST", body: site("Night page"), headers: { host: HOST } });
  expect(first.status, await first.clone().text()).toBe(201);
  expect(await first.json()).toMatchObject({ name: "night-page", version: 1 });
  expect((await childrenOf("garden", "field-notes")).map(card => card.text)).toContain("Night page [arrival::new] [arrival-kind::page] [sent-by::Fictional Phone]\n[artifact::night-page]");
  // A second file with the same token, no note named: it goes under today's.
  const second = await fetch(aim("more.html?name=night-page-two"), { method: "POST", body: site("Night page two"), headers: { host: HOST } });
  expect(second.status).toBe(201);
  expect((await childrenOf("garden", day())).map(card => card.text)).toContain("Night page two [arrival::new] [arrival-kind::page] [sent-by::Fictional Phone]\n[artifact::night-page-two]");

  lines.length = 0;
  expect(await runDeviceCommand(["ls"], io, env)).toBe(0);
  expect(lines.join("\n")).toContain("Fictional Phone");
  expect(lines.join("\n")).not.toContain(link.split("/_upload/")[1]!);
  lines.length = 0;
  expect(await runDeviceCommand(["revoke", "Fictional Phone"], io, env)).toBe(0);
  const after = await fetch(aim("late.html"), { method: "POST", body: site("Too late"), headers: { host: HOST } });
  expect(after.status).toBe(410);
  expect(await after.text()).toContain("revoked");
  // Nothing in the logs carries a token.
  expect(logged.join("\n")).not.toContain(link.split("/_upload/")[1]!);
});

test("a zip dropped in the synced inbox is unpacked the same way", async () => {
  const inbox = join(outlines, ".artifacts", "inbox");
  mkdirSync(inbox, { recursive: true });
  setEnv("EP0CH_ARTIFACT_SETTLE_MS", "20");
  const second = new ArtifactStore(outlineLayout(outlines).root);
  second.startWatcher();
  try {
    writeFileSync(join(inbox, "dropped-site.zip"), zip([{ name: "index.html", data: site("Dropped") }, { name: "style.css", data: "body{}" }]));
    const end = Date.now() + 10_000;
    while (!existsSync(join(live("dropped-site"), "style.css")) && Date.now() < end) await Bun.sleep(50);
    expect(readFileSync(join(live("dropped-site"), "index.html"), "utf8")).toContain("Dropped");
  } finally { await second.close(); }
});

test("device add --shortcut signs a Send to ep0ch Shortcut, serves it only signed in, and the request it sends lands as cards", async () => {
  // A made-up Mac: the "ssh" that reaches it signs by putting the signed file's magic in front of the plist it reads.
  const bin = join(root, "fake-mac");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\nprintf AEA1\ncat\n");
  chmodSync(join(bin, "ssh"), 0o755);
  const lines: string[] = [], errors: string[] = [];
  const io = { out: (line: string) => lines.push(line), err: (line: string) => errors.push(line) };
  const env = { ...process.env, EP0CH_SOCKET: outlineLayout(outlines).socket, EP0CH_OUTLINES: outlines, EP0CH_SSH: join(bin, "ssh"), EP0CH_SHORTCUT_SIGNER: "fictional-mac" };
  expect(await runDeviceCommand(["add", "Fictional's Phone", "--ws", "garden", "--shortcut"], io, env), errors.join("\n")).toBe(0);
  const said = lines.join("\n");
  // It prints the sign-in page that serves the Shortcut, and never the upload link inside it.
  const page = said.match(/https:\/\/\S+\/_shortcut\/[0-9a-f]{8}\/Send%20to%20ep0ch\.shortcut/)![0];
  expect(said).not.toContain("/_upload/");
  expect(said).toContain("tap Add Shortcut");
  const at = (cookie?: string) => fetch(local(page), { headers: { host: HOST, accept: "text/html", ...(cookie ? { cookie } : {}) }, redirect: "manual" });

  // Signed out, it is the sign-in page, which comes back to it.
  const signedOut = await at();
  expect(signedOut.status).toBe(401);
  expect(await signedOut.text()).toContain(encodeURIComponent(new URL(page).pathname));
  const { token } = await client.request<{ token: string }>({ action: "web.sessions.start", subject: "user_fictional0001" });
  const cookie = `__Host-ep0ch_session=${token}`;
  const served = await at(cookie);
  expect(served.status).toBe(200);
  expect(served.headers.get("content-disposition")).toBe('attachment; filename="Send to ep0ch.shortcut"');
  const signed = Buffer.from(await served.arrayBuffer());
  expect(signed.subarray(0, 4).toString("latin1")).toBe("AEA1");

  // The workflow inside: the share sheet, no questions, the guide's steps in order, and the device's link.
  const plist = signed.subarray(4).toString("utf8");
  expect(plist).toContain("<string>ActionExtension</string>");
  expect(plist).toContain("<string>WFPDFContentItem</string>");
  expect(plist).not.toContain("is.workflow.actions.ask");
  expect([...plist.matchAll(/<string>is\.workflow\.actions\.([a-z.]+)<\/string>/g)].map(m => m[1])).toEqual(["repeat.each", "gettext", "urlencode", "downloadurl", "notification", "repeat.each"]);
  const link = /<string>(https:\/\/[^<]+\/_upload\/[A-Za-z0-9_-]+)\/\ufffc\?reply=text<\/string>/.exec(plist)![1]!;
  expect(plist).toContain("<string>POST</string>");
  expect(plist).toContain("<key>WFHTTPBodyType</key>\n\t\t\t\t<string>File</string>");

  // The request the Shortcut makes for a PDF from Files: its encoded "<Name>.<File Extension>", the file as the body.
  const pdf = createPdfFixture([{ width: 300, height: 200, lines: [{ text: "Allotment plan", x: 20, y: 150 }] }]);
  const shared = await fetch(`${local(link)}/${encodeURIComponent("Allotment plan.pdf")}?reply=text`, { method: "POST", body: pdf as BodyInit, headers: { host: HOST, "content-type": "application/pdf" } });
  const answer = await shared.text();
  expect(shared.status, answer).toBe(201);
  expect(shared.headers.get("content-type")).toStartWith("text/plain");
  expect(answer).toStartWith("Installed allotment-plan version 1");
  // A photo whose name came without an extension and with no type: its bytes say what it is.
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.from("fictional photo")]);
  const photo = await fetch(`${local(link)}/${encodeURIComponent("IMG_0001.")}?reply=text`, { method: "POST", body: jpeg, headers: { host: HOST } });
  expect(photo.status, await photo.clone().text()).toBe(201);
  const cards = (await childrenOf("garden", day())).map(card => card.text);
  expect(cards.some(card => card.includes("[arrival-kind::document]") && card.includes("[sent-by::Fictional's Phone]"))).toBe(true);
  expect(cards.some(card => card.startsWith("IMG_0001.jpg") && card.includes("[arrival-kind::image]"))).toBe(true);
  // An iPhone photo is HEIC: kept as a JPEG where ImageMagick reads it, otherwise refused saying what it needs.
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(16)]);
  const live = await fetch(`${local(link)}/${encodeURIComponent("IMG_0002.HEIC")}?reply=text`, { method: "POST", body: heic, headers: { host: HOST } });
  expect(live.status).toBe(422);
  expect(await live.text()).toMatch(/^Refused: .*(HEIC|ImageMagick)/);

  lines.length = 0;
  expect(await runDeviceCommand(["ls"], io, env)).toBe(0);
  expect(lines.join("\n")).toContain(`its Shortcut: ${page}`);
  // Revoked, the link and the Shortcut that carries it both open nothing.
  expect(await runDeviceCommand(["revoke", "Fictional's Phone"], io, env)).toBe(0);
  expect((await at(cookie)).status).toBe(404);
  expect(logged.join("\n")).not.toContain(link.split("/_upload/")[1]!);
});

test("a Shortcut that can't be signed leaves no device behind, so the same name can try again", async () => {
  const bin = join(root, "no-mac");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "ssh"), "#!/bin/sh\necho 'shortcuts: command not found' >&2\nexit 127\n");
  chmodSync(join(bin, "ssh"), 0o755);
  const errors: string[] = [];
  const io = { out: () => {}, err: (line: string) => errors.push(line) };
  const env = { ...process.env, EP0CH_SOCKET: outlineLayout(outlines).socket, EP0CH_OUTLINES: outlines, EP0CH_SSH: join(bin, "ssh"), EP0CH_SHORTCUT_SIGNER: "fictional-linux" };
  expect(await runDeviceCommand(["add", "Spare Phone", "--ws", "garden", "--shortcut"], io, env)).toBe(1);
  expect(errors.join("\n")).toContain("on fictional-linux failed (exit 127): shortcuts: command not found");
  expect(errors.join("\n")).toContain('try again: ep0ch device add "Spare Phone" --ws garden --shortcut');
  const { devices } = await client.request<{ devices: { name: string; revokedAt?: string }[] }>({ action: "devices.list" });
  expect(devices.filter(d => d.name === "Spare Phone" && !d.revokedAt)).toEqual([]);
});

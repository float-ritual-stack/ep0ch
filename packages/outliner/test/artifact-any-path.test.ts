// Type [artifact::<any path on a machine he uses>] or [artifact::<name>] in any outline on any machine and it runs
// (PIE-1644). Two made-up machines on one scratch disk: "laptop" (an outline host with an outline, `notes`) and "hub"
// (the machine whose artifact store the web client serves), reached from the laptop through its shared forward socket
// (`<outlines>/.remote/hub.sock`, as ensureForward finds one already up), and a fake S3 for the media bucket. The laptop
// is told which absolute paths are on its own disk (`filesHere`), so a file "on another machine" is one it can't see.
// Never a real outline, machine or bucket.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { artifactResponse, sharesFromSocket } from "../src/artifact-server";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { connectLink, serveLink } from "../src/link";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";
import type { Block } from "../src/types";
import { fakeS3, type FakeS3 } from "./fake-s3";

const WEB = "https://web.example.test";
/** The publisher's own host, as a tailnet page is asked for. */
const PUB = "lantern.tail0000.ts.net:8443";
const ARTIFACTS = "https://frames.example.test";
const PAGE = "<!doctype html><title>Flat lantern</title><canvas id=lantern></canvas><script>/* made up */</script>";
const LOCAL_PAGE = "<!doctype html><title>Desk moth</title><p>only on the laptop</p>";

let root = "", laptopOutlines = "", hubOutlines = "", otherDisk = "", laptopDisk = "";
let s3: FakeS3;
let hub: OutlineHost;
let laptop: OutlineHost;
let client: OutlinerClient;
let hubClient: OutlinerClient;
let publisher: Publisher;
const keys = ["EP0CH_MEDIA_BUCKET", "EP0CH_MEDIA_ENDPOINT", "EP0CH_MEDIA_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "WITH_SECRETS_DIR", "EP0CH_ARTIFACT_ORIGIN", "EP0CH_WEB_URL", "EP0CH_MACHINE_NAME", "EP0CH_ARTIFACT_MACHINE", "EP0CH_SSH", "EP0CH_OUTLINES"] as const;
const was = Object.fromEntries(keys.map(key => [key, process.env[key]]));

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aap-")));
  laptopOutlines = join(root, "l");
  hubOutlines = join(root, "h");
  // The other machine's disk (the hub's, as the laptop sees it: not there) and the laptop's own.
  otherDisk = join(root, "elsewhere", "inbox", "screenshots");
  laptopDisk = join(root, "laptop", "desk");
  for (const dir of [otherDisk, laptopDisk, join(laptopOutlines, "notes")]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(otherDisk, "flat lantern _ eden.html"), PAGE);
  writeFileSync(join(laptopDisk, "desk-moth.html"), LOCAL_PAGE);
  for (const [outlines, name] of [[laptopOutlines, "laptop"], [hubOutlines, "hub"]] as const) {
    mkdirSync(outlineLayout(outlines).hostDir, { recursive: true, mode: 0o700 });
    writeFileSync(join(outlineLayout(outlines).hostDir, "machine-name"), `${name}\n`);
  }
  // The laptop's artifacts live in the hub's store: one line names that machine.
  writeFileSync(join(outlineLayout(laptopOutlines).hostDir, "artifact-machine"), "hub\n");
  s3 = fakeS3();
  Object.assign(process.env, s3.env, { EP0CH_ARTIFACT_ORIGIN: ARTIFACTS, EP0CH_WEB_URL: WEB });
  delete process.env.EP0CH_MACHINE_NAME; delete process.env.EP0CH_ARTIFACT_MACHINE;

  hub = new OutlineHost({ outlinesFolder: hubOutlines, log: () => {} });
  await hub.start();
  hubClient = new OutlinerClient(outlineLayout(hubOutlines).socket, 15_000);
  // The hub's forward, as the laptop's clients find it when it is up.
  mkdirSync(join(laptopOutlines, ".remote"), { recursive: true, mode: 0o700 });
  symlinkSync(outlineLayout(hubOutlines).socket, join(laptopOutlines, ".remote", "hub.sock"));

  new OutlinerStore(outlineLayout(laptopOutlines).database("notes"), { workspaceRoot: join(laptopOutlines, "notes") }).close();
  laptop = new OutlineHost({
    outlinesFolder: laptopOutlines, log: () => {},
    // One disk for both machines here: the laptop sees everything but the other machine's inbox.
    filesHere: path => !path.startsWith(join(root, "elsewhere")),
  });
  await laptop.start();
  const socket = outlineLayout(laptopOutlines).socket;
  client = new OutlinerClient(socket, 30_000, "notes");
  publisher = new Publisher({ client, basePath: "/pub", publicUrl: `https://${PUB}/share` });
  await publisher.start();
});

afterAll(async () => {
  await publisher?.stop();
  await laptop?.close();
  await hub?.close();
  s3?.stop();
  for (const key of keys) { if (was[key] === undefined) delete process.env[key]; else process.env[key] = was[key]; }
  rmSync(root, { recursive: true, force: true });
});

const write = (text: string) => client.request<Block>({ action: "create", text, author: "user" } as never);
const show = (name: string, frame?: { owner: true }) => client.request<ArtifactInfo>({ action: "artifacts.show", name, ...(frame ? { frame } : {}) } as never, 60_000);
/** What a browser gets following a frame address to the hub's artifact host. */
const follow = (frame: string) => artifactResponse(join(hubOutlines, ".artifacts"), new Request(frame.replace(ARTIFACTS, "http://frames.test")), "'self'");

test("a path on another machine, written in a laptop note, runs: its page is in the hub's store, framed for the owner", async () => {
  const path = join(otherDisk, "flat lantern _ eden.html");
  const note = await write(`Lantern night [publish::public:lantern-night]\n[artifact::${path}]`);
  await (await laptop.open("notes")).server.media.settled();
  // Copied on save, by its content's hash, though the file was never on the laptop.
  const hash = new Bun.CryptoHasher("sha256").update(PAGE).digest("hex");
  expect(s3.puts).toContain(`sha256/${hash}`);

  const info = await show(path, { owner: true });
  expect(info.warning).toBeUndefined();
  // Its page is the web client's on the hub, and the frame is the hub's artifact host.
  expect(info.url).toBe(`${WEB}/pub/a/${encodeURIComponent(`${info.name}@${info.version}`)}/`);
  expect(info.frame).toStartWith(`${ARTIFACTS}/k/`);
  const framed = await follow(info.frame!);
  expect(framed.status).toBe(200);
  expect(await framed.text()).toBe(PAGE);
  // The hub's store answers the name the laptop was given.
  const there = await hubClient.request<ArtifactInfo>({ action: "artifacts.show", name: `${info.name}@${info.version}` } as never);
  expect(there.files).toEqual(["flat lantern _ eden.html"]);

  // The laptop outline's published page frames it from the hub too.
  const page = await publisher.handle(new Request(`http://${PUB}/pub/p/${note.id}/artifact/1`, { headers: { host: PUB, accept: "text/html" } }), "tailnet");
  expect(page.status).toBe(200);
  expect(await page.text()).toContain(`${ARTIFACTS}/k/`);
});

test("a path only on the laptop goes to the hub through the bucket, and its card reads its name", async () => {
  const path = join(laptopDisk, "desk-moth.html");
  await write(`Desk moth\n[artifact::${path}]`);
  const info = await show(path, { owner: true });
  expect(info.name).toBe("desk-moth");
  expect(await (await follow(info.frame!)).text()).toBe(LOCAL_PAGE);
  // Shown again with nothing changed: the same snapshot, nothing uploaded again.
  const puts = s3.puts.length;
  const again = await show(path);
  expect(again.version).toBe(info.version);
  expect(s3.puts.length).toBe(puts);
});

test("a path written as a terminal's drop writes it (PIE-1656), on another machine, is copied on save and runs", async () => {
  const page = "<!doctype html><title>Late shift</title><p>made up, with spaces in its name</p>";
  const path = join(otherDisk, "late shift (copy).html");
  writeFileSync(path, page);
  await write(`Late shift\n[artifact::${path.replace(/([ ()])/g, "\\$1")}]`);
  await (await laptop.open("notes")).server.media.settled();
  expect(s3.puts).toContain(`sha256/${new Bun.CryptoHasher("sha256").update(page).digest("hex")}`);
  const info = await show(path, { owner: true });
  expect(await (await follow(info.frame!)).text()).toBe(page);
});

test("a name resolves through the hub's one store from the laptop's outline", async () => {
  await hubClient.request({ action: "artifacts.put", name: "orrery", files: { "index.html": "<!doctype html><title>Orrery</title>" } } as never);
  const info = await show("orrery", { owner: true });
  expect(info.name).toBe("orrery");
  expect(info.url).toBe(`${WEB}/pub/a/orrery/`);
  expect(await (await follow(info.frame!)).text()).toContain("Orrery");
});

test("what can't be found says what was tried, where, and the one thing to do, never the machinery", async () => {
  const gone = join(root, "nowhere", "ghost-page.html");
  const said = await show(gone).then(() => "", (error: Error) => error.message);
  expect(said).toContain("laptop");
  expect(said).toContain("hub");
  expect(said).toContain(gone);
  const named = await show("no-such-lamp").then(() => "", (error: Error) => error.message);
  expect(named).toContain("no-such-lamp");
  expect(named).toContain("hub");
  for (const message of [said, named]) {
    expect(message).not.toMatch(/EP0CH_SOCKET|artifact put|--machine|store/i);
  }
});

test("a share made in the laptop's outline opens its artifact on the hub's artifact host, and its revoke closes it there", async () => {
  // The hub reaches the laptop's host through its forward, as it reaches the laptop's outlines for pages.
  mkdirSync(join(hubOutlines, ".remote"), { recursive: true, mode: 0o700 });
  symlinkSync(outlineLayout(laptopOutlines).socket, join(hubOutlines, ".remote", "laptop.sock"));
  const path = join(otherDisk, "flat lantern _ eden.html");
  const named = await show(path);
  const { share } = await client.request<{ share: ShareSession }>({ action: "shares.start", artifact: `${named.name}@${named.version}` } as never);
  const info = await client.request<ArtifactInfo>({ action: "artifacts.show", name: path, frame: { share: { id: share.id } } } as never, 60_000);
  expect(info.frame).toContain("/s/notes@laptop/");
  const shareOpen = sharesFromSocket(outlineLayout(hubOutlines).socket, hubOutlines);
  const open = () => artifactResponse(join(hubOutlines, ".artifacts"), new Request(info.frame!.replace(ARTIFACTS, "http://frames.test")), "'self'", { shareOpen });
  const opened = await open();
  expect(opened.status).toBe(200);
  expect(await opened.text()).toBe(PAGE);
  await client.request({ action: "shares.revoke", shareId: share.id } as never);
  expect((await open()).status).toBe(410);
});

test("a folder on another machine runs whole: its index and what it loads, copied as one archive", async () => {
  const site = join(otherDisk, "moth site");
  mkdirSync(join(site, "css"), { recursive: true });
  writeFileSync(join(site, "index.html"), `<!doctype html><title>Moth site</title><link rel="stylesheet" href="css/wing.css">`);
  writeFileSync(join(site, "css", "wing.css"), "body { background: #141413 }");
  writeFileSync(join(site, ".DS_Store"), "made-up clutter");
  const note = await write(`Moth site\n[artifact::${site}]`);
  const info = await show(site, { owner: true });
  expect(info.files.sort()).toEqual(["css/wing.css", "index.html"]);
  expect(await (await follow(info.frame!)).text()).toContain("Moth site");
  const style = await follow(info.frame!.replace(/\/$/, "/css/wing.css"));
  expect(await style.text()).toContain("#141413");
  // Unchanged: the same version. A file changed there: the note's next save copies it again, and it's a new version.
  expect((await show(site)).version).toBe(info.version);
  writeFileSync(join(site, "css", "wing.css"), "body { background: #2a2a28 }");
  await client.request({ action: "update", blockId: note.id, text: `Moth site\n[artifact::${site}]\nRepainted.`, expectedRevision: note.revision, mutation: { author: "user" } } as never);
  await (await laptop.open("notes")).server.media.settled();
  const repainted = await show(site, { owner: true });
  expect(repainted.version).toBe(info.version! + 1);
  expect(await (await follow(repainted.frame!.replace(/\/$/, "/css/wing.css"))).text()).toContain("#2a2a28");
});

test("the store's machine not answering says so on the card, once, never the link's repair steps", async () => {
  const machineFile = join(laptopOutlines, ".host", "artifact-machine");
  // A machine with no forward up, and an ssh that can't reach it.
  const ssh = join(root, "no-ssh");
  writeFileSync(ssh, "#!/bin/sh\nexit 255\n"); chmodSync(ssh, 0o755);
  process.env.EP0CH_SSH = ssh;
  writeFileSync(machineFile, "dusk\n");
  try {
    const said = await show("orrery").then(() => "", (error: Error) => error.message);
    expect(said).toBe("orrery runs from dusk, where laptop's artifacts are kept, and dusk isn't answering now: it shows once dusk is back");
    // Asked again straight away (a drawn card asks every few seconds): no new connection is tried.
    const started = Date.now();
    expect(await show("orrery").then(() => "", (error: Error) => error.message)).toBe(said);
    expect(Date.now() - started).toBeLessThan(1_000);
    const gone = join(root, "nowhere", "dusk-page.html");
    const path = await show(gone).then(() => "", (error: Error) => error.message);
    // The hub, whose forward is up, is asked too.
    expect(path).toContain("isn't on laptop or hub, and dusk isn't answering to ask: it shows once dusk is back.");
    for (const message of [said, path]) expect(message).not.toMatch(/ssh|install|EP0CH_|link status/);
  } finally {
    writeFileSync(machineFile, "hub\n");
    delete process.env.EP0CH_SSH;
  }
});

test("a file with no extension isn't taken for a folder, and another machine won't hand one over", async () => {
  const readme = join(laptopDisk, "README");
  writeFileSync(readme, "made-up notes, not a page");
  await write(`Readme\n[artifact::${readme}]`);
  expect(await show(readme).then(() => "", (error: Error) => error.message)).toBe(`${readme} isn't a page an artifact line runs`);
  const asked = await hubClient.request({ action: "media.read", path: readme } as never).then(() => "", (error: Error) => error.message);
  expect(asked).toBe(`${readme} isn't a picture or a page`);
});

test("while the laptop sleeps, its read-only copy runs the same artifacts from the hub's own store", async () => {
  // The hub follows a copy of the laptop's outline (outline-mirror.ts): the records it carries name the bucket copies.
  const mirror = join(root, "m"), copyFile = join(mirror, "notes.sqlite");
  mkdirSync(join(mirror, ".host"), { recursive: true, mode: 0o700 });
  (await laptop.open("notes")).store.database.exec(`VACUUM INTO '${copyFile}'`);
  process.env.EP0CH_OUTLINES = hubOutlines;
  const store = new OutlinerStore(copyFile, { workspaceRoot: join(mirror, "notes") });
  const server = new OutlinerServer(store, join(mirror, ".host", "notes.sock"), undefined, undefined, { readOnly: true, copy: { address: "notes@laptop", state: join(mirror, "state") }, outlinesFolder: mirror });
  await server.start();
  try {
    const copy = new OutlinerClient(join(mirror, ".host", "notes.sock"), 30_000);
    const path = join(otherDisk, "flat lantern _ eden.html");
    const [fromLaptop, fromCopy] = await Promise.all([show(path), copy.request<ArtifactInfo>({ action: "artifacts.show", name: path, frame: { owner: true } } as never, 60_000)]);
    expect(`${fromCopy.name}@${fromCopy.version}`).toBe(`${fromLaptop.name}@${fromLaptop.version}`);
    expect(await (await follow(fromCopy.frame!)).text()).toBe(PAGE);
    expect((await copy.request<ArtifactInfo>({ action: "artifacts.show", name: "orrery" } as never)).name).toBe("orrery");
  } finally {
    await server.close(); store.close();
  }
});

test("with no artifact machine written, the laptop's artifacts are kept where its link dials in", async () => {
  const machineFile = join(laptopOutlines, ".host", "artifact-machine");
  rmSync(machineFile);
  // The hub serves the link and the laptop dials in, as `ep0ch link setup` and install leave them.
  const server = serveLink({ outlines: hubOutlines, port: 0, keys: { laptop: "fictional-link-key" }, log() {} });
  const connector = connectLink({ server: `http://127.0.0.1:${server.port}`, machine: "laptop", key: "fictional-link-key", host: outlineLayout(laptopOutlines).socket, statusPath: join(laptopOutlines, ".host", "link-state.json"), log() {} });
  try {
    for (let i = 0; i < 100 && !existsSync(join(laptopOutlines, ".host", "link-state.json")); i++) await Bun.sleep(20);
    for (let i = 0; i < 100 && !JSON.parse(readFileSync(join(laptopOutlines, ".host", "link-state.json"), "utf8")).up; i++) await Bun.sleep(20);
    const info = await show("orrery", { owner: true });
    expect(info.name).toBe("orrery");
    expect(info.frame).toStartWith(`${ARTIFACTS}/k/`);
  } finally {
    connector.stop(); await server.stop();
    writeFileSync(machineFile, "hub\n");
  }
});

test("a laptop with no bucket keys hands the file to the hub itself, and the hub keeps it", async () => {
  // A second outline on the laptop, opened with no bucket settings anywhere in its environment.
  const saved = Object.fromEntries(Object.keys(s3.env).map(key => [key, process.env[key]]));
  for (const key of Object.keys(s3.env)) delete process.env[key];
  process.env.WITH_SECRETS_DIR = "/nonexistent";
  new OutlinerStore(outlineLayout(laptopOutlines).database("sketches"), { workspaceRoot: join(laptopOutlines, "sketches") }).close();
  const sketches = new OutlinerClient(outlineLayout(laptopOutlines).socket, 60_000, "sketches");
  try {
    const puts = s3.puts.length;
    const there = join(otherDisk, "keyless lamp.html"), here = join(laptopDisk, "keyless moth.html");
    writeFileSync(there, "<!doctype html><title>Keyless lamp</title>");
    writeFileSync(here, "<!doctype html><title>Keyless moth</title>");
    await sketches.request({ action: "create", text: `Keyless\n[artifact::${there}]\n[artifact::${here}]`, author: "user" } as never);
    for (const [path, title] of [[there, "Keyless lamp"], [here, "Keyless moth"]] as const) {
      const info = await sketches.request<ArtifactInfo>({ action: "artifacts.show", name: path, frame: { owner: true } } as never, 60_000);
      expect(await (await follow(info.frame!)).text()).toContain(title);
      // Asked again: the hub has it already, by its hash.
      expect((await sketches.request<ArtifactInfo>({ action: "artifacts.show", name: path } as never, 60_000)).version).toBe(info.version);
    }
    expect(s3.puts.length).toBe(puts);
  } finally {
    Object.assign(process.env, saved);
  }
});

test("an artifact in a hidden file or folder, or a link into one, is refused and never copied; a picture there still is", async () => {
  const secret = join(laptopDisk, ".ssh", "panel.html"), link = join(laptopDisk, "visible-panel.html");
  const elsewhereSecret = join(otherDisk, ".cache", "panel.html"), site = join(laptopDisk, ".sites", "moth");
  mkdirSync(join(laptopDisk, ".ssh"), { recursive: true }); mkdirSync(join(otherDisk, ".cache"), { recursive: true }); mkdirSync(site, { recursive: true });
  const body = "<!doctype html><title>Fictional private panel</title>";
  writeFileSync(secret, body); writeFileSync(elsewhereSecret, `${body} elsewhere`); writeFileSync(join(site, "index.html"), `${body} site`);
  symlinkSync(secret, link);
  const thumbs = join(laptopDisk, ".thumbs");
  mkdirSync(thumbs, { recursive: true });
  const moth = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 7]);
  writeFileSync(join(thumbs, "moth.png"), moth);
  const hash = (bytes: string | Uint8Array) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
  await write(`Panels\n[artifact::${secret}]\n[artifact::${link}]\n[artifact::${elsewhereSecret}]\n[artifact::${site}]\n[img::${join(thumbs, "moth.png")}]`);
  await (await laptop.open("notes")).server.media.settled();
  for (const path of [secret, link, elsewhereSecret, site]) {
    const said = await show(path).then(() => "", (error: Error) => error.message);
    expect(said).toContain(path);
    expect(said).toContain("hidden");
  }
  for (const bytes of [body, `${body} elsewhere`]) expect(s3.puts).not.toContain(`sha256/${hash(bytes)}`);
  // The hub won't hand over a hidden page to another machine either.
  expect(await hubClient.request({ action: "media.read", path: elsewhereSecret, artifact: true } as never).then(() => "", (error: Error) => error.message)).toContain("hidden");
  // A picture in a hidden folder is copied as PIE-1634 copies pictures.
  expect(s3.puts).toContain(`sha256/${hash(moth)}`);
});

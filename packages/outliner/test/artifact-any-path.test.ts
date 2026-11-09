// Type [artifact::<any path on a machine he uses>] or [artifact::<name>] in any outline on any machine and it runs
// (PIE-1644). Two made-up machines on one scratch disk: "laptop" (an outline host with an outline, `notes`) and "hub"
// (the machine whose artifact store the web client serves), reached from the laptop through its shared forward socket
// (`<outlines>/.remote/hub.sock`, as ensureForward finds one already up), and a fake S3 for the media bucket. The laptop
// is told which absolute paths are on its own disk (`filesHere`), so a file "on another machine" is one it can't see.
// Never a real outline, machine or bucket.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArtifactInfo } from "@ep0ch/outline-core/artifacts";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { artifactResponse, sharesFromSocket } from "../src/artifact-server";
import type { ShareSession } from "@ep0ch/outline-core/protocol";
import { OutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
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
const keys = ["EP0CH_MEDIA_BUCKET", "EP0CH_MEDIA_ENDPOINT", "EP0CH_MEDIA_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "WITH_SECRETS_DIR", "EP0CH_ARTIFACT_ORIGIN", "EP0CH_WEB_URL", "EP0CH_MACHINE_NAME", "EP0CH_ARTIFACT_MACHINE"] as const;
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

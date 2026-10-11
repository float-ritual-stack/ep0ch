// Another machine's outline in the web client (publish-remote.ts, publish-outlines.ts): `/pub/o/<name>@<machine>/`,
// read live through the machine's ssh forward, its writes following the outline's own MCP access there, and read from
// its copy here while the machine doesn't answer. "The other machine" is an outline host in a scratch folder of its own,
// reached through the fake ssh (test/fake-ssh.ts); its copy is a VACUUM INTO of its database, as Litestream's follow
// leaves one. Fictional notes throughout.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerClient } from "../src/client";
import { forwardFor } from "../src/machine-forward";
import { OutlineHost } from "../src/outline-host";
import { Publisher } from "../src/publish";
import { OutlinePublishers } from "../src/publish-outlines";
import { RemoteOutline } from "../src/publish-remote";
import { OutlinerStore } from "../src/store";
import type { AnnotationThread, Block } from "../src/types";

const TAILNET = "garden.tail0000.ts.net";
const FAR = "far-box";
const html = { accept: "text/html" };

let root = "";
let homeHost: OutlineHost, farHost: OutlineHost;
let web: OutlinePublishers;
let remote: RemoteOutline;
let lantern: Block;
let clock = 0;
const env: NodeJS.ProcessEnv = {};
const logged: string[] = [];

const get = (path: string) => web.handle(new Request(`https://${TAILNET}${path}`, { headers: { host: TAILNET, ...html } }));
const threads = async () => (await (await get(`/pub/o/attic-notes@${FAR}/_marginalia/threads?page=${lantern.id}`)).json()) as { choices: { action: string }[]; readOnly?: string; threads: unknown[] };
let comments = 0;
const comment = () => web.handle(new Request(`https://${TAILNET}/pub/o/attic-notes@${FAR}/_marginalia/write`, {
  method: "POST", headers: { host: TAILNET, origin: `https://${TAILNET}`, "content-type": "application/json" },
  body: JSON.stringify({ page: lantern.id, quote: "the moths came", prefix: "The lantern burned until ", suffix: ".", action: "comment", body: "Which moths?", requestId: `remote-comment-${++comments}` }),
}));
const farClient = () => new OutlinerClient(farHost.socketPath, 15_000, "attic-notes");
const farAccess = (level: string) => farClient().request({ action: "mcp.access.configure", level } as never);

beforeAll(async () => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "pr-")));
  for (const d of ["outlines", "bin", "mirrors", "far/home", "far/outlines"]) mkdirSync(join(root, d), { recursive: true, mode: 0o700 });
  const here = outlineLayout(join(root, "outlines")), far = outlineLayout(join(root, "far", "outlines"));
  const garden = new OutlinerStore(here.database("garden"), { workspaceRoot: root });
  garden.create("Seed list\nBorage, then calendula.", null, "user");
  garden.close();
  const attic = new OutlinerStore(far.database("attic-notes"), { workspaceRoot: root });
  lantern = attic.create("Lantern log\nThe lantern burned until the moths came.", null, "user");
  attic.configureMcpAccess("read");
  attic.close();
  homeHost = new OutlineHost({ outlinesFolder: here.root, log: () => {} });
  farHost = new OutlineHost({ outlinesFolder: far.root, log: () => {} });
  await homeHost.start();
  await farHost.start();
  writeFileSync(join(root, "bin", "ssh"), `#!/bin/sh\nexec ${process.execPath} ${join(import.meta.dir, "fake-ssh.ts")} "$@"\n`);
  writeFileSync(join(root, "bin", "ep0ch"), `#!/bin/sh\necho '${JSON.stringify({ socket: farHost.socketPath, outlines: [{ name: "attic-notes" }] })}'\n`);
  for (const f of ["ssh", "ep0ch"]) chmodSync(join(root, "bin", f), 0o755);
  Object.assign(env, {
    PATH: process.env.PATH, HOME: join(root, "home"), EP0CH_SSH: join(root, "bin", "ssh"), FAKE_SSH_LOG: join(root, "ssh.log"),
    FAKE_SSH_HOME: join(root, "far", "home"), FAKE_SSH_OUTLINES: far.root, FAKE_SSH_BIN: join(root, "bin"),
  });
  const home = new Publisher({ client: new OutlinerClient(here.socket, 15_000, "garden"), basePath: "/pub", log: (line) => logged.push(line) });
  await home.start();
  const make = (forward: () => Promise<string>, fastMs?: number) => new RemoteOutline({
    outline: "attic-notes", machine: FAR, mirrors: join(root, "mirrors"), forward, now: () => Date.now() + clock, log: (line) => logged.push(line),
    ...(fastMs ? { fastMs } : {}),
    publisher: (client, page) => new Publisher({ client, basePath: `/pub/o/attic-notes@${FAR}`, webRoot: "/pub", ...page, shares: false, log: (line) => logged.push(line) }),
  });
  remote = make(async () => (await forwardFor(FAR, here.root, env)).socket);
  web = new OutlinePublishers({
    home, homeName: "garden", names: async () => ["garden"], remotes: [remote], log: (line) => logged.push(line),
    open: () => { throw new Error("no other outline here"); },
  });
  hung = make(() => new Promise(() => {}), 300);
});

let hung: RemoteOutline;

afterAll(async () => {
  try { process.kill(Number(readFileSync(join(root, "outlines", ".remote", `${FAR}.ctl`), "utf8"))); } catch { /* not running */ }
  await web?.stop();
  await hung?.stop();
  await homeHost?.close();
  await farHost?.close();
  rmSync(root, { recursive: true, force: true });
});

test("another machine's outline is listed as name@machine and read live through its forward, said on the page", async () => {
  const list = await (await get("/pub/o/")).text();
  expect(list).toContain(`href="/pub/o/attic-notes@${FAR}/"`);
  const page = await get(`/pub/o/attic-notes@${FAR}/p/${lantern.id}`);
  expect(page.status).toBe(200);
  const text = await page.text();
  expect(text).toContain("The lantern burned until the moths came.");
  expect(text).toContain(`attic-notes · ${FAR} · live`);
  // A browser that sends `@` escaped reaches the same page.
  expect((await get(`/pub/o/attic-notes%40${FAR}/p/${lantern.id}`)).status).toBe(200);
  expect(await (await get("/pub/o/")).text()).toContain("(live)");
  expect(readFileSync(join(root, "ssh.log"), "utf8").split("\n").filter((line) => line.includes("-L"))).toHaveLength(1);
}, 30_000);

test("its MCP access governs writes: read shows the threads with no write controls and refuses a write; full takes it", async () => {
  const reading = await threads();
  expect(reading.readOnly).toContain("MCP access read");
  expect(reading.choices.map((choice) => choice.action)).toEqual(["copy"]);
  const refused = await comment();
  expect(refused.status).toBe(403);
  expect(((await refused.json()) as { error: string }).error).toContain(`ep0ch mcp access full --ws attic-notes`);
  await farAccess("full");
  clock += 31_000;
  const writing = await threads();
  expect(writing.readOnly).toBeUndefined();
  expect(writing.choices.map((choice) => choice.action)).toContain("comment");
  expect((await comment()).status).toBe(200);
  const landed = await farClient().request<AnnotationThread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId: lantern.id }, includeResolved: false } } as never);
  expect(JSON.stringify(landed)).toContain("Which moths?");
}, 30_000);

test("the machine asleep: its copy here, said with its time, no write controls, and the forward isn't retried on every page", async () => {
  // Litestream's follow leaves the copy.
  mkdirSync(join(root, "mirrors", FAR), { recursive: true });
  const source = new Database(outlineLayout(join(root, "far", "outlines")).database("attic-notes"), { readonly: true });
  try { source.run("VACUUM INTO ?", [join(root, "mirrors", FAR, "attic-notes.sqlite")]); } finally { source.close(); }
  // The machine goes to sleep: its forward drops, and ssh can't reach it.
  env.FAKE_SSH_DOWN = "1";
  process.kill(Number(readFileSync(join(root, "outlines", ".remote", `${FAR}.ctl`), "utf8")));
  await Bun.sleep(500);
  clock += 11_000;
  const started = Date.now();
  const page = await get(`/pub/o/attic-notes@${FAR}/p/${lantern.id}`);
  expect(Date.now() - started).toBeLessThan(10_000);
  expect(page.status).toBe(200);
  const text = await page.text();
  expect(text).toContain("The lantern burned until");
  expect(text).toMatch(new RegExp(`attic-notes · ${FAR} · as of \\d{4}-\\d\\d-\\d\\d \\d\\d:\\d\\d UTC \\(${FAR} asleep\\)`));
  const state = await threads();
  expect(state.readOnly).toContain(`${FAR} is asleep`);
  // The comment made while it was live is in the copy, shown, read-only.
  expect(JSON.stringify(state.threads)).toContain("Which moths?");
  expect((await comment()).status).toBe(403);
  expect(await (await get("/pub/o/")).text()).toContain(`${FAR} asleep: its copy here`);
  // Within the retry window nothing more is asked of ssh.
  const calls = readFileSync(join(root, "ssh.log"), "utf8").trim().split("\n").length;
  await get(`/pub/o/attic-notes@${FAR}/`);
  expect(readFileSync(join(root, "ssh.log"), "utf8").trim().split("\n").length).toBe(calls);
}, 30_000);

test("a forward that never answers doesn't hold the page: the copy is served after the short wait", async () => {
  const started = Date.now();
  const served = await hung.publisher();
  expect(Date.now() - started).toBeLessThan(5_000);
  expect("error" in served).toBe(false);
  expect(hung.state).toBe("copy");
}, 30_000);

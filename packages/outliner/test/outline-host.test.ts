import { afterEach, expect, test } from "bun:test";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlinerClient } from "../src/client";
import { OutlineHost } from "../src/outline-host";
import { outlineLayout } from "@ep0ch/outline-core/outline-location";
import { OutlinerStore } from "../src/store";
import type { Block, HostedOutlineList, HostedOutlineSummary, OutlinerEvent, OutlinerResponse, OutlinerServiceStatus } from "../src/types";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch(): string {
  // Real: the CLI names paths from its working directory, which macOS gives as /private/var/….
  const root = realpathSync(mkdtempSync(join(tmpdir(), "outline-host-")));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** The outlines folder under a scratch root. */
const layoutOf = (root: string) => outlineLayout(join(root, "outlines"));

async function startHost(root: string, defaultOutline?: string): Promise<OutlineHost> {
  const host = new OutlineHost({ outlinesFolder: layoutOf(root).root, defaultOutline, log: () => {} });
  await host.start();
  cleanups.push(() => host.close());
  return host;
}

/** One request on its own connection, as clients send it, with any fields (such as `outline`). */
function send<T = unknown>(socketPath: string, request: Record<string, unknown>): Promise<OutlinerResponse & { result?: T }> {
  const answered = Promise.withResolvers<OutlinerResponse & { result?: T }>();
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  let buffer = "";
  socket.on("error", answered.reject);
  socket.once("connect", () => socket.write(`${JSON.stringify({ id: crypto.randomUUID(), ...request })}\n`));
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    const newline = buffer.indexOf("\n");
    if (newline < 0) return;
    socket.destroy();
    answered.resolve(JSON.parse(buffer.slice(0, newline)));
  });
  return answered.promise;
}

async function ok<T>(socketPath: string, request: Record<string, unknown>): Promise<T> {
  const response = await send<T>(socketPath, request);
  if (!response.ok) throw new Error(response.error);
  return response.result as T;
}

/** A subscription to one outline (or the default), collecting its events. */
async function subscribe(socketPath: string, outline?: string) {
  const events: OutlinerEvent[] = [];
  const socket = createConnection(socketPath);
  socket.setEncoding("utf8");
  const acknowledged = Promise.withResolvers<void>();
  const id = crypto.randomUUID();
  let buffer = "";
  socket.on("error", acknowledged.reject);
  socket.once("connect", () => socket.write(`${JSON.stringify({
    id, action: "events.subscribe", ...(outline ? { outline } : {}),
    client: { clientId: `watcher-${outline ?? "default"}`, contextId: `context-${outline ?? "default"}`, role: "tree" },
  })}\n`));
  socket.on("data", (chunk: string) => {
    buffer += chunk;
    let newline: number;
    while ((newline = buffer.indexOf("\n")) >= 0) {
      const message = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if ("event" in message) events.push(message.event);
      else if (message.id === id) message.ok ? acknowledged.resolve() : acknowledged.reject(new Error(message.error));
    }
  });
  cleanups.push(() => { socket.destroy(); });
  await acknowledged.promise;
  return { events, stop: () => socket.destroy() };
}

async function eventually(check: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 3_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${what}`);
    await Bun.sleep(10);
  }
}

test("one socket serves two outlines, routed by the request's outline", async () => {
  const root = scratch();
  const host = await startHost(root, "bob");
  await host.create("bob");
  await host.create("fred");

  const bobNote = await ok<Block>(host.socketPath, { action: "create", outline: "bob", text: "Bob's fictional kettle" });
  const fredNote = await ok<Block>(host.socketPath, { action: "create", outline: "fred", text: "Fred's fictional compass" });

  expect((await ok<Block>(host.socketPath, { action: "get", outline: "bob", blockId: bobNote.id })).text).toBe("Bob's fictional kettle");
  expect((await ok<Block>(host.socketPath, { action: "get", outline: "fred", blockId: fredNote.id })).text).toBe("Fred's fictional compass");
  // Each outline has only its own notes.
  const bobInFred = await send(host.socketPath, { action: "get", outline: "fred", blockId: bobNote.id });
  expect(!bobInFred.ok && bobInFred.error).toContain("Block not found");
  const fredInBob = await send(host.socketPath, { action: "get", outline: "bob", blockId: fredNote.id });
  expect(!fredInBob.ok && fredInBob.error).toContain("Block not found");

  // A request without `outline` reaches the default, bob.
  expect((await ok<Block>(host.socketPath, { action: "get", blockId: bobNote.id })).text).toBe("Bob's fictional kettle");

  const fredPing = await ok<OutlinerServiceStatus>(host.socketPath, { action: "ping", outline: "fred" });
  expect(fredPing.outline?.name).toBe("fred");
  const bobPing = await ok<OutlinerServiceStatus>(host.socketPath, { action: "ping", outline: "bob" });
  expect(fredPing.outlineInstanceId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/);
  expect(bobPing.outlineInstanceId).not.toBe(fredPing.outlineInstanceId);
  expect(fredPing.host).toEqual({ socket: host.socketPath, defaultOutline: "bob", outlines: ["bob", "fred"] });
  // The outline is `<outlines>/fred.sqlite`, its own folder `<outlines>/fred/` beside it; the host's socket is private.
  expect(fredPing.location?.database).toBe(layoutOf(root).database("fred"));
  expect(fredPing.location?.stateDirectory).toBe(layoutOf(root).folder("fred"));
  expect(fredPing.location?.workspaceRoot).toBe(layoutOf(root).folder("fred"));
  expect(existsSync(join(layoutOf(root).folder("fred"), "prompts"))).toBe(true);
  // The outline's own folder names it, so a program working there reaches it.
  expect(readFileSync(join(layoutOf(root).folder("fred"), ".ep0ch"), "utf8")).toBe('ws = "fred"\n');
  expect(host.socketPath).toBe(join(root, "outlines", ".host", "host.sock"));
  expect(statSync(layoutOf(root).hostDir).mode & 0o777).toBe(0o700);
});

test("an unnamed outline, an unknown outline and a bad name are refused without creating anything", async () => {
  const root = scratch();
  const host = await startHost(root, "bob");
  const missingDefault = await send(host.socketPath, { action: "get", blockId: "x" });
  expect(missingDefault.ok).toBe(false);
  expect(!missingDefault.ok && missingDefault.error).toContain('No outline named "bob"');
  const unknown = await send(host.socketPath, { action: "get", outline: "uncle", blockId: "x" });
  expect(!unknown.ok && unknown.error).toContain('No outline named "uncle"');
  const invalid = await send(host.socketPath, { action: "get", outline: "Not A Slug", blockId: "x" });
  expect(!invalid.ok && invalid.error).toContain("outline must be an outline name");
  expect(existsSync(layoutOf(root).database("bob"))).toBe(false);
  expect(existsSync(layoutOf(root).database("uncle"))).toBe(false);
  expect(host.list()).toEqual({ defaultOutline: "bob", outlines: [] });

  const noDefault = await startHost(scratch());
  const pong = await ok<OutlinerServiceStatus>(noDefault.socketPath, { action: "ping" });
  expect(pong.host).toEqual({ socket: noDefault.socketPath, outlines: [] });
  const unnamed = await send(noDefault.socketPath, { action: "get", blockId: "x" });
  expect(!unnamed.ok && unnamed.error).toContain("Name the outline");
});

test("a subscription on one outline does not see another outline's changes", async () => {
  const host = await startHost(scratch(), "bob");
  await host.create("bob");
  await host.create("fred");
  const bobWatch = await subscribe(host.socketPath);
  const fredWatch = await subscribe(host.socketPath, "fred");

  await ok(host.socketPath, { action: "create", outline: "fred", text: "Fred's fictional lantern" });
  await eventually(() => fredWatch.events.some(event => event.domain === "content"), "fred's content event");
  await ok(host.socketPath, { action: "create", outline: "bob", text: "Bob's fictional teapot" });
  await eventually(() => bobWatch.events.some(event => event.domain === "content"), "bob's content event");
  await Bun.sleep(50);

  const contentEvents = (events: OutlinerEvent[]) => events.filter(event => event.domain === "content");
  expect(contentEvents(bobWatch.events)).toHaveLength(1);
  expect(contentEvents(fredWatch.events)).toHaveLength(1);
});

test("an unmodified OutlinerClient talks to the host's default outline", async () => {
  const host = await startHost(scratch(), "bandit");
  await host.create("bandit");
  const client = new OutlinerClient(host.socketPath);
  const status = await client.request<OutlinerServiceStatus>({ action: "ping" });
  expect(status.outline?.name).toBe("bandit");
  expect(status.host?.defaultOutline).toBe("bandit");
  const note = await client.request<Block>({ action: "create", text: "Bandit's fictional bone" });
  expect((await client.request<Block>({ action: "get", blockId: note.id })).text).toBe("Bandit's fictional bone");

  const connected = Promise.withResolvers<void>();
  const events: OutlinerEvent[] = [];
  const watcher = client.watch({
    client: { clientId: "bandit-tree", contextId: "bandit-context", role: "tree" },
    onConnect: connected.resolve,
    onEvent: event => { events.push(event); },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await client.request({ action: "create", text: "Bandit's second fictional bone" });
  await eventually(() => events.some(event => event.domain === "content"), "a content event on the default outline");
});

test("create makes a new empty outline, keeps a folder already there, and refuses a taken name", async () => {
  const root = scratch();
  const host = await startHost(root);
  const created = await ok<HostedOutlineSummary>(host.socketPath, { action: "outlines.create", name: "uncle" });
  expect(created).toEqual({ name: "uncle", database: layoutOf(root).database("uncle"), folder: layoutOf(root).folder("uncle"), open: true });
  expect(lstatSync(layoutOf(root).database("uncle")).isFile()).toBe(true);

  const again = await send(host.socketPath, { action: "outlines.create", name: "uncle" });
  expect(!again.ok && again.error).toContain('An outline named "uncle" already exists');
  const badName = await send(host.socketPath, { action: "outlines.create", name: "../uncle" });
  expect(!badName.ok && badName.error).toContain("short slug");
  // Files kept in `<outlines>/fred/` before it had an outline stay, and become its folder.
  mkdirSync(join(layoutOf(root).folder("fred"), "pub"), { recursive: true });
  writeFileSync(join(layoutOf(root).folder("fred"), "pub", "fictional-page.html"), "<p>Fred's fictional page</p>\n");
  await ok(host.socketPath, { action: "outlines.create", name: "fred" });
  expect(readFileSync(join(layoutOf(root).folder("fred"), "pub", "fictional-page.html"), "utf8")).toContain("fictional page");
});

test("outlines.list shows each outline, open or not, and creates nothing", async () => {
  const root = scratch();
  const first = new OutlineHost({ outlinesFolder: layoutOf(root).root, log: () => {} });
  await first.start();
  await first.create("bob");
  await first.create("fred");
  await first.close();

  const host = await startHost(root, "fred");
  // The default opens with the host, before any request; bob opens on its first.
  expect(host.list().outlines.map(outline => [outline.name, outline.open])).toEqual([["bob", false], ["fred", true]]);
  await ok(host.socketPath, { action: "ping", outline: "bob" });
  const listed = await ok<HostedOutlineList>(host.socketPath, { action: "outlines.list" });
  expect(listed).toEqual({
    defaultOutline: "fred",
    outlines: [
      { name: "bob", database: layoutOf(root).database("bob"), folder: layoutOf(root).folder("bob"), open: true },
      { name: "fred", database: layoutOf(root).database("fred"), folder: layoutOf(root).folder("fred"), open: true, default: true },
    ],
  });
  expect(host.list()).toEqual(listed);
});

test("one outline failing to open does not affect the others", async () => {
  const root = scratch();
  const host = await startHost(root, "bob");
  await host.create("bob");
  await host.create("bandit");
  // uncle's database is not a database at all.
  writeFileSync(layoutOf(root).database("uncle"), "these are fictional crumbs, not SQLite\n".repeat(200));
  const corrupt = await send(host.socketPath, { action: "ping", outline: "uncle" });
  expect(!corrupt.ok && corrupt.error).toContain('Outline "uncle" could not be opened');

  // fred's database is held by another owner.
  const held = layoutOf(root).database("fred");
  const owner = new OutlinerStore(held, { workspaceRoot: root });
  cleanups.push(() => owner.close());
  const locked = await send(host.socketPath, { action: "ping", outline: "fred" });
  expect(!locked.ok && locked.error).toContain("already owned");

  expect((await ok<OutlinerServiceStatus>(host.socketPath, { action: "ping" })).outline?.name).toBe("bob");
  const note = await ok<Block>(host.socketPath, { action: "create", outline: "bandit", text: "Bandit's fictional ball" });
  expect(note.text).toBe("Bandit's fictional ball");
  expect((await ok<HostedOutlineList>(host.socketPath, { action: "outlines.list" })).outlines.map(outline => [outline.name, outline.open]))
    .toEqual([["bandit", true], ["bob", true], ["fred", false], ["uncle", false]]);

  // The failure is not remembered: once the other owner lets go, fred opens.
  owner.close();
  cleanups.pop();
  expect((await ok<OutlinerServiceStatus>(host.socketPath, { action: "ping", outline: "fred" })).outline?.name).toBe("fred");
});

test("import makes a new outline from an older database, which is only read; refused while another process holds it", async () => {
  const elsewhere = scratch();
  const database = join(elsewhere, "fictional-old", "outliner.sqlite");
  const store = new OutlinerStore(database, { workspaceRoot: elsewhere });
  const note = store.create("Fred's fictional map, written before the import [page::fictional-map]");

  const root = scratch();
  const host = await startHost(root);
  const refused = await send(host.socketPath, { action: "outlines.import", path: database, name: "fred" });
  expect(!refused.ok && refused.error).toContain("in use by another outliner process");
  expect(existsSync(layoutOf(root).database("fred"))).toBe(false);

  store.close();
  const before = statSync(database);
  const imported = await ok<HostedOutlineSummary & { imported: Record<string, number> }>(host.socketPath, { action: "outlines.import", path: database, name: "fred" });
  expect(imported).toMatchObject({ name: "fred", database: layoutOf(root).database("fred"), folder: layoutOf(root).folder("fred"), open: true });
  expect(lstatSync(layoutOf(root).database("fred")).isFile()).toBe(true);
  const after = statSync(database);
  expect([after.size, after.mtimeMs]).toEqual([before.size, before.mtimeMs]);
  expect((await ok<Block>(host.socketPath, { action: "get", outline: "fred", blockId: note.id })).text).toContain("Fred's fictional map");

  // A taken name, a non-outliner file, a relative path and an outline of this host are refused.
  const taken = await send(host.socketPath, { action: "outlines.import", path: database, name: "fred" });
  expect(!taken.ok && taken.error).toContain('An outline named "fred" already exists');
  const notes = join(elsewhere, "fictional-notes.txt");
  writeFileSync(notes, "Uncle's fictional shopping list\n");
  const notSqlite = await send(host.socketPath, { action: "outlines.import", path: notes, name: "uncle" });
  expect(!notSqlite.ok && notSqlite.error).toContain("not an outliner database");
  const relative = await send(host.socketPath, { action: "outlines.import", path: "fictional.sqlite", name: "uncle" });
  expect(!relative.ok && relative.error).toContain("absolute path");
  const own = await send(host.socketPath, { action: "outlines.import", path: layoutOf(root).database("fred"), name: "uncle" });
  expect(!own.ok && own.error).toContain("already an outline here");
  expect(existsSync(layoutOf(root).database("uncle"))).toBe(false);
});

test("delete moves an outline and its folder aside; nothing is erased", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("uncle");
  const deleted = await host.delete("uncle");
  expect(deleted.movedTo.startsWith(layoutOf(root).deleted)).toBe(true);
  expect(existsSync(join(deleted.movedTo, "uncle.sqlite"))).toBe(true);
  expect(existsSync(layoutOf(root).database("uncle"))).toBe(false);
  expect(host.list().outlines).toEqual([]);
  // Its owner lock and the journal SQLite leaves beside it go too: nothing of uncle's is left in the outlines folder.
  expect(readdirSync(layoutOf(root).root).filter(f => f.startsWith("uncle"))).toEqual([]);
});

test("delete removes the outline's owner lock and its journal, and is refused while another process holds the lock", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("aunt");
  await host.create("cousin");
  const lock = `${realpathSync(layoutOf(root).database("aunt"))}.owner.sqlite`;
  expect(existsSync(lock)).toBe(true);
  writeFileSync(`${lock}-journal`, "");                     // as a crashed opener can leave it
  await host.delete("aunt");
  expect(existsSync(lock)).toBe(false);
  expect(existsSync(`${lock}-journal`)).toBe(false);
  // Held by another process while it's deleted: refused, and nothing moved.
  await ok(host.socketPath, { action: "outlines.close", name: "cousin" });
  const cousinLock = `${realpathSync(layoutOf(root).database("cousin"))}.owner.sqlite`;
  const holder = Bun.spawn([process.execPath, "-e", `const { Database } = require("bun:sqlite"); const d = new Database(${JSON.stringify(cousinLock)}, { create: true }); d.exec("BEGIN IMMEDIATE"); console.log("held"); setInterval(() => {}, 1000);`], { stdout: "pipe" });
  try {
    const reader = holder.stdout.getReader();
    await reader.read();
    await expect(host.delete("cousin")).rejects.toThrow("nothing was moved");
    expect(existsSync(layoutOf(root).database("cousin"))).toBe(true);
    expect(existsSync(cousinLock)).toBe(true);
  } finally { holder.kill(); await holder.exited; }
  await host.delete("cousin");
  expect(existsSync(cousinLock)).toBe(false);
});

test("a second host on the same outlines folder is refused, and a connection stays with its first outline", async () => {
  const root = scratch();
  const host = await startHost(root, "bob");
  await host.create("bob");
  await host.create("fred");
  const second = new OutlineHost({ outlinesFolder: layoutOf(root).root, log: () => {} });
  await expect(second.start()).rejects.toThrow("outline host lock is already owned");
  expect((await ok<OutlinerServiceStatus>(host.socketPath, { action: "ping" })).outline?.name).toBe("bob");

  // Two lines on one connection: the second names another outline and is refused.
  const answers = await new Promise<OutlinerResponse[]>((settle, reject) => {
    const socket = createConnection(host.socketPath);
    socket.setEncoding("utf8");
    const received: OutlinerResponse[] = [];
    let buffer = "";
    socket.on("error", reject);
    socket.once("connect", () => socket.write(
      `${JSON.stringify({ id: "first", action: "ping", outline: "bob" })}\n${JSON.stringify({ id: "second", action: "ping", outline: "fred" })}\n`));
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      let newline: number;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        received.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
      if (received.length === 2) { socket.destroy(); settle(received); }
    });
  });
  expect(answers[0]!.ok).toBe(true);
  expect(!answers[1]!.ok && answers[1]!.error).toContain('serves the outline "bob"');
});

test("a lone OutlinerServer refuses host requests", async () => {
  const root = scratch();
  const store = new OutlinerStore(join(root, "outliner.sqlite"), { workspaceRoot: root });
  const { OutlinerServer } = await import("../src/server");
  const server = new OutlinerServer(store, join(root, "outliner.sock"));
  await server.start();
  cleanups.push(async () => { await server.close(); store.close(); });
  const response = await send(join(root, "outliner.sock"), { action: "outlines.list" });
  expect(!response.ok && response.error).toContain("answered by the outline host");
  const status = await ok<OutlinerServiceStatus>(join(root, "outliner.sock"), { action: "ping" });
  expect(status.host).toBeUndefined();
});

test("the host process and the CLI: create, import refusals, init and list go through the host", async () => {
  const root = scratch();
  const outlines = join(root, "outlines");
  const env = { PATH: process.env.PATH, HOME: root, EP0CH_OUTLINES: outlines, XDG_CONFIG_HOME: join(root, "config"), EP0CH_DEFAULT_WS: "bob" };
  const cli = (cwd: string, ...args: string[]) => {
    const run = Bun.spawnSync([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], { env, cwd, timeout: 15_000 });
    return { code: run.exitCode, stdout: run.stdout.toString(), stderr: run.stderr.toString() };
  };
  // Without a host, create is refused rather than made some other way.
  const offline = cli(root, "outline", "create", "bob");
  expect(offline.code).toBe(1);
  expect(offline.stderr).toContain("No outline host answers");

  const child = Bun.spawn([process.execPath, join(import.meta.dir, "../src/host-main.ts")], { env, stdout: "pipe", stderr: "pipe", timeout: 15_000, killSignal: "SIGKILL" });
  cleanups.push(async () => { child.kill("SIGTERM"); await child.exited; });
  const reader = child.stdout.getReader();
  let output = "";
  while (!output.includes("\n")) {
    const chunk = await reader.read();
    if (chunk.done) throw new Error(`The host exited: ${await new Response(child.stderr).text()}`);
    output += new TextDecoder().decode(chunk.value);
  }
  reader.releaseLock();
  expect(JSON.parse(output.split("\n")[0]!)).toEqual({ status: "ready", socket: join(outlines, ".host", "host.sock"), outlines, defaultOutline: "bob" });

  expect(cli(root, "outline", "create", "bob").code).toBe(0);
  const duplicate = cli(root, "outline", "create", "bob");
  expect(duplicate.code).toBe(1);
  expect(duplicate.stderr).toContain('An outline named "bob" already exists');
  const missing = cli(root, "outline", "import", "fictional-missing.sqlite", "fred");
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain(`No database at ${join(root, "fictional-missing.sqlite")}`);

  // init in a project folder: the outline named after it, created, and its .ep0ch written.
  const project = join(root, "work", "jam-shelf");
  mkdirSync(join(project, "notes"), { recursive: true });
  const init = cli(project, "init");
  expect(init.code).toBe(0);
  expect(init.stdout).toContain("created outline jam-shelf");
  expect(readFileSync(join(project, ".ep0ch"), "utf8")).toBe('ws = "jam-shelf"\n');
  // From a subfolder, the CLI now talks to that outline.
  const note = cli(join(project, "notes"), "create", "--text", "Jam shelf's fictional label");
  expect(note.code, note.stderr).toBe(0);
  // --ws from anywhere reaches the same outline.
  const found = cli(root, "--ws", "jam-shelf", "list", "--text", "fictional label");
  expect(found.code, found.stderr).toBe(0);
  expect(found.stdout).toContain("Jam shelf's fictional label");

  const listed = cli(root, "outlines", "--json");
  expect(listed.code).toBe(0);
  const parsed = JSON.parse(listed.stdout);
  expect(parsed).toMatchObject({ folder: outlines, socket: join(outlines, ".host", "host.sock"), defaultOutline: "bob" });
  expect(parsed.outlines.map((outline: HostedOutlineSummary) => [outline.name, outline.default ?? false, outline.open]))
    .toEqual([["bob", true, true], ["jam-shelf", false, true]]);
  expect(cli(root, "outlines").stdout).toContain("bob  open  default");
});

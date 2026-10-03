import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { createOutlinerClient, OutlinerClient, type OutlinerWatcher } from "../src/client";
import { OutlineChooser, planChoice, renderChooserFrame } from "../src/outline-chooser";
import { OutlineHost } from "../src/outline-host";
import { boundFolderOf, resolveClientPaths, writeDotEp0ch } from "../src/paths";
import { registeredPaneOutline, resolveInvocationPaths } from "../src/outline-host-client";
import { dispatchNativeSelectionComment } from "../src/herdr-comment-selection";
import type { Block, HostedOutlineAttachment, OutlinerClientRegistration, OutlinerEvent, OutlinerServiceStatus } from "../src/types";

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function scratch(): string {
  const root = mkdtempSync(join(tmpdir(), "outline-host-clients-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

/** The host over `<root>/outlines`. */
async function startHost(root: string, defaultOutline?: string): Promise<OutlineHost> {
  const host = new OutlineHost({ outlinesFolder: join(root, "outlines"), defaultOutline, log: () => {} });
  await host.start();
  cleanups.push(() => host.close());
  return host;
}

/** A client's environment in `folder`, with `<root>` as its home and `<root>/outlines` as its outlines. */
function envFor(root: string, folder: string, extra: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return { HOME: root, EP0CH_OUTLINES: join(root, "outlines"), XDG_CONFIG_HOME: join(root, "config"), OUTLINER_WORKSPACE_ROOT: folder, ...extra };
}

test("a client that names its outline reads and watches that outline through the host", async () => {
  const root = scratch();
  const host = await startHost(root, "bob");
  await host.create("bob");
  await host.create("fred");
  const bob = new OutlinerClient(host.socketPath, 3_000, "bob");
  const fred = new OutlinerClient(host.socketPath, 3_000, "fred");
  const fredNote = await fred.request<Block>({ action: "create", text: "Fred's fictional compass" });
  expect((await fred.request<Block>({ action: "get", blockId: fredNote.id })).text).toBe("Fred's fictional compass");
  await expect(bob.request({ action: "get", blockId: fredNote.id })).rejects.toThrow("Block not found");
  expect((await fred.request<OutlinerServiceStatus>({ action: "ping" })).outline?.name).toBe("fred");

  const connected = Promise.withResolvers<void>();
  const events: OutlinerEvent[] = [];
  const watcher = fred.watch({
    client: { clientId: "fred-tree", contextId: "fred-context", role: "tree" },
    onConnect: connected.resolve,
    onEvent: event => { events.push(event); },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  await bob.request({ action: "create", text: "Bob's fictional kettle" });
  await fred.request({ action: "create", text: "Fred's fictional lantern" });
  const deadline = Date.now() + 3_000;
  while (!events.some(event => event.domain === "content") && Date.now() < deadline) await Bun.sleep(10);
  await Bun.sleep(50);
  expect(events.filter(event => event.domain === "content")).toHaveLength(1);
  // The Tree's registration is on fred only.
  expect((await fred.request<OutlinerClientRegistration[]>({ action: "clients.list" })).map(client => client.clientId)).toContain("fred-tree");
  expect((await bob.request<OutlinerClientRegistration[]>({ action: "clients.list" })).map(client => client.clientId)).not.toContain("fred-tree");
});

test("resolution (PIE-530): EP0CH_WS, else the nearest .ep0ch; nothing else names an outline", async () => {
  const root = scratch();
  const outlines = join(root, "outlines");
  const garden = join(root, "work", "garden");
  const deep = join(garden, "beds", "peas");
  const repository = join(root, "code", "Jam Shelf");
  for (const folder of [deep, join(repository, "src")]) mkdirSync(folder, { recursive: true });
  mkdirSync(join(repository, ".git"));
  const hostSocket = join(outlines, ".host", "host.sock");

  // A folder that names nothing: no outline, and the guess (its repository's name) only offered.
  const unnamed = resolveClientPaths(envFor(root, join(repository, "src")));
  expect(unnamed).toMatchObject({ mode: "host", socket: hostSocket, guess: { name: "jam-shelf", folder: repository } });
  expect(unnamed.outline).toBeUndefined();
  expect(unnamed.unnamed).toContain("no .ep0ch here or above");
  // A client for it refuses rather than reach some outline.
  await expect(createOutlinerClient(unnamed).request({ action: "ping" })).rejects.toThrow("no outline is named");
  // $HOME is too broad to guess a name for.
  expect(resolveClientPaths(envFor(root, root)).guess).toBeUndefined();

  // A .ep0ch names it, for every folder below.
  writeDotEp0ch(garden, "garden");
  expect(readFileSync(join(garden, ".ep0ch"), "utf8")).toBe('ws = "garden"\n');
  const inside = resolveClientPaths(envFor(root, deep));
  expect(inside).toMatchObject({
    mode: "host", socket: hostSocket, outline: "garden", outlineSource: "file", configPath: join(garden, ".ep0ch"),
    database: join(outlines, "garden.sqlite"), stateDir: join(outlines, ".clients", "garden"), workspaceRoot: deep,
  });
  expect(boundFolderOf(deep)).toEqual({ folder: garden, configPath: join(garden, ".ep0ch"), outline: "garden" });
  // --ws from anywhere (the openers pass it on as EP0CH_WS) is the same outline and the same file.
  const anywhere = resolveClientPaths(envFor(root, "/", { EP0CH_WS: "garden" }));
  expect([anywhere.outline, anywhere.database, anywhere.socket]).toEqual([inside.outline, inside.database, inside.socket]);
  // Moving the folder breaks nothing: the name moves with it.
  const moved = join(root, "elsewhere", "kitchen-garden");
  mkdirSync(join(root, "elsewhere"));
  Bun.spawnSync(["mv", garden, moved]);
  expect(resolveClientPaths(envFor(root, join(moved, "beds", "peas"))).database).toBe(inside.database);
  // EP0CH_WS wins over a .ep0ch.
  expect(resolveClientPaths(envFor(root, moved, { EP0CH_WS: "bob" }))).toMatchObject({ outline: "bob", outlineSource: "env" });
  expect(() => resolveClientPaths(envFor(root, moved, { EP0CH_WS: "Not A Name" }))).toThrow("EP0CH_WS");

  // A first choice never replaces a .ep0ch; the switcher does.
  expect(() => writeDotEp0ch(moved, "bob")).toThrow("already names an outline");
  writeDotEp0ch(moved, "bob", { replace: true });
  expect(resolveClientPaths(envFor(root, moved)).outline).toBe("bob");

  // EP0CH_SOCKET is a host elsewhere (an SSH tunnel), asked for the same name; there is no local database.
  expect(resolveClientPaths(envFor(root, moved, { EP0CH_SOCKET: "/fictional/tunnel.sock" })))
    .toMatchObject({ mode: "remote", socket: "/fictional/tunnel.sock", outline: "bob", database: "" });
  expect(() => resolveClientPaths(envFor(root, moved, { EP0CH_SOCKET: "relative.sock" }))).toThrow("absolute");
});

test("resolution does not flip while the host restarts, and a client reconnects when it is back", async () => {
  const root = scratch();
  const jam = join(root, "jam-shelf");
  mkdirSync(jam);
  writeDotEp0ch(jam, "jam-shelf");
  let host = await startHost(root);
  await host.create("jam-shelf");
  const paths = resolveClientPaths(envFor(root, jam));
  expect(paths).toMatchObject({ mode: "host", outline: "jam-shelf" });
  const connects: number[] = [];
  const client = createOutlinerClient(paths);
  const watcher = client.watch({ client: { clientId: "jam-tree", contextId: "jam-context", role: "tree" }, onConnect: () => { connects.push(Date.now()); }, onEvent() {} });
  cleanups.push(() => watcher.stop());
  const waitFor = async (condition: () => boolean) => {
    const deadline = Date.now() + 5_000;
    while (!condition() && Date.now() < deadline) await Bun.sleep(20);
    expect(condition()).toBe(true);
  };
  await waitFor(() => connects.length === 1);

  // The host stops mid-run: its socket is gone, but the folder still names the same outline.
  await host.close();
  expect(existsSync(paths.socket)).toBe(false);
  expect(resolveClientPaths(envFor(root, jam))).toMatchObject({ mode: "host", outline: "jam-shelf" });

  // The host is back: the same client reconnects to the same outline.
  host = new OutlineHost({ outlinesFolder: join(root, "outlines"), log: () => {} });
  await host.start();
  cleanups.push(() => host.close());
  await waitFor(() => connects.length === 2);
  expect((await client.request<OutlinerClientRegistration[]>({ action: "clients.list" })).map(registration => [registration.clientId, registration.outline])).toEqual([["jam-tree", "jam-shelf"]]);
}, 20_000);

test("attach creates only when asked, and a plain CLI read never creates", async () => {
  const root = scratch();
  const host = await startHost(root);
  const control = new OutlinerClient(host.socketPath);
  await expect(control.request({ action: "outlines.attach", name: "uncle" })).rejects.toThrow('No outline named "uncle"');
  expect(existsSync(join(root, "outlines", "uncle.sqlite"))).toBe(false);
  const first = await control.request<HostedOutlineAttachment>({ action: "outlines.attach", name: "uncle", create: true });
  expect(first).toMatchObject({ created: true, outline: { name: "uncle", open: true, folder: join(root, "outlines", "uncle") } });
  const again = await control.request<HostedOutlineAttachment>({ action: "outlines.attach", name: "uncle", create: true });
  expect(again).toMatchObject({ created: false, outline: { name: "uncle", open: true } });
  // An outline's root (relative file links, prompts, sessions) is its own folder.
  const ping = await new OutlinerClient(host.socketPath, 3_000, "uncle").request<OutlinerServiceStatus>({ action: "ping" });
  expect(ping.location?.workspaceRoot).toBe(join(root, "outlines", "uncle"));

  // Asynchronous: the host answers from this test's own event loop.
  const cli = async (...args: string[]) => {
    const run = Bun.spawn([process.execPath, join(import.meta.dir, "../src/cli.ts"), ...args], {
      env: { PATH: process.env.PATH, ...envFor(root, root) } as Record<string, string>,
      cwd: root, timeout: 15_000, stdout: "pipe", stderr: "pipe",
    });
    const [code, stdout, stderr] = await Promise.all([run.exited, new Response(run.stdout).text(), new Response(run.stderr).text()]);
    return { code, stdout, stderr };
  };
  const created = await cli("--ws", "uncle", "create", "--text", "Uncle's fictional hat");
  expect(created.stderr).toBe("");
  expect(created.code).toBe(0);
  const listed = await cli("--ws=uncle", "list", "--text", "fictional hat");
  expect(listed.code).toBe(0);
  expect(listed.stdout).toContain("Uncle's fictional hat");
  // --ws is a global flag before the command: never another flag's value.
  const asValue = await cli("--ws", "uncle", "create", "--text=--ws=bandit");
  expect(asValue.stderr).toBe("");
  expect(asValue.stdout).toContain("--ws=bandit");
  expect(existsSync(join(root, "outlines", "bandit.sqlite"))).toBe(false);
  const afterCommand = await cli("list", "--ws", "uncle");
  expect(afterCommand.code).not.toBe(0);
  const missing = await cli("--ws", "bandit", "list");
  expect(missing.code).toBe(1);
  expect(missing.stderr).toContain('No outline named "bandit"');
  // In $HOME with nothing named, a read says so, and nothing is created.
  const nameless = await cli("list");
  expect(nameless.code).toBe(1);
  expect(nameless.stderr).toContain("no outline is named");
  const doctor = await cli("--ws", "bandit", "doctor");
  expect(doctor.stdout).toContain(`Endpoint: ${host.socketPath}`);
  expect(doctor.stdout).toContain("Outline: bandit (EP0CH_WS (or --ws))");
  expect(existsSync(join(root, "outlines", "bandit.sqlite"))).toBe(false);
  expect(host.list().outlines.map(outline => outline.name)).toEqual(["uncle"]);

  // close and delete, for session tools: delete moves an outline aside and never erases it.
  expect((await control.request<{ open: boolean }>({ action: "outlines.close", name: "uncle" })).open).toBe(false);
  const deleted = await control.request<{ movedTo: string }>({ action: "outlines.delete", name: "uncle" });
  expect(existsSync(join(deleted.movedTo, "uncle.sqlite"))).toBe(true);
  expect(host.list().outlines).toEqual([]);
});

test("the chooser picks one of the host's outlines, starts one named after the folder, or imports one", () => {
  const context = { mode: "open-here", workspaceRoot: "/fictional/code/Jam Shelf/src", rootSource: "the invoking pane's foreground cwd", guess: { name: "jam-shelf", folder: "/fictional/code/Jam Shelf" } };
  const chooser = new OutlineChooser(context);
  chooser.setHostedOutlines([
    { name: "bob", database: "/fictional/outlines/bob.sqlite", folder: "/fictional/outlines/bob", open: true },
    { name: "jam-shelf", database: "/fictional/outlines/jam-shelf.sqlite", folder: "/fictional/outlines/jam-shelf", open: false },
  ]);
  const frame = renderChooserFrame(chooser, 120, 24).join("\n");
  expect(frame).toContain("bob");
  expect(frame).toContain('Named "jam-shelf-2"');
  expect(frame).toContain("Import a database");
  // Picking writes the guessed folder's .ep0ch.
  expect(planChoice(chooser, chooser.rows[0]!)).toEqual({ kind: "pick", name: "bob", dotFolder: "/fictional/code/Jam Shelf" });
  // New: first the name is typed (offered free), then it is made.
  const newRow = chooser.rows.find(row => row.kind === "new")!;
  const typing = planChoice(chooser, newRow);
  expect(typing).toEqual({ kind: "input", input: { row: "new", text: "jam-shelf-2" } });
  chooser.input = typing.kind === "input" ? typing.input : undefined;
  expect(planChoice(chooser, newRow)).toEqual({ kind: "create", name: "jam-shelf-2", dotFolder: "/fictional/code/Jam Shelf" });
  chooser.input = { row: "new", text: "bob" };
  expect(planChoice(chooser, newRow)).toMatchObject({ kind: "refuse", message: expect.stringContaining("already an outline named") });
  chooser.input = { row: "new", text: "Not A Name" };
  expect(planChoice(chooser, newRow)).toMatchObject({ kind: "refuse" });
  // Import: a full path, under the folder's free name.
  const importRow = chooser.rows.find(row => row.kind === "import")!;
  chooser.input = { row: "import", text: "/fictional/old/outliner.sqlite" };
  expect(planChoice(chooser, importRow)).toEqual({ kind: "import", path: "/fictional/old/outliner.sqlite", name: "jam-shelf-2", dotFolder: "/fictional/code/Jam Shelf" });
  chooser.input = { row: "import", text: "old.sqlite" };
  expect(planChoice(chooser, importRow)).toMatchObject({ kind: "refuse" });
  // A folder too broad to name an outline after: the choice opens this time only, no .ep0ch.
  const broad = new OutlineChooser({ mode: "open-here", workspaceRoot: "/fictional/home", rootSource: "the invoking pane's foreground cwd" });
  broad.setHostedOutlines([{ name: "bob", database: "/fictional/outlines/bob.sqlite", folder: "/fictional/outlines/bob", open: true }]);
  expect(planChoice(broad, broad.rows[0]!)).toEqual({ kind: "pick", name: "bob" });
  expect(renderChooserFrame(broad, 120, 24).join("\n")).toContain("this time only");
  // The switcher in a folder that names one: the choice replaces that folder's .ep0ch.
  const switcher = new OutlineChooser({ mode: "open-here", workspaceRoot: "/fictional/garden/beds", rootSource: "the invoking pane's foreground cwd", switch: true, dotFolder: "/fictional/garden" });
  switcher.setHostedOutlines([{ name: "bob", database: "/fictional/outlines/bob.sqlite", folder: "/fictional/outlines/bob", open: true }]);
  expect(planChoice(switcher, switcher.rows[0]!)).toEqual({ kind: "pick", name: "bob", dotFolder: "/fictional/garden" });
});

/**
 * herdr-open against a fake Herdr. Each pane Herdr is asked to open registers,
 * as a real pane would, on the outline its `EP0CH_WS` names (Tree for
 * `outliner`, Detail for `detail`), in pane `workspace:<entrypoint>`.
 */
async function openWithFakeHerdr(options: { root: string; host: OutlineHost; folder: string; mode?: string; paneId?: string; env?: Record<string, string>; args?: string[] }) {
  const { root, host, folder } = options;
  const herdr = join(root, "fake-herdr");
  const logPath = join(root, "herdr-calls.jsonl");
  writeFileSync(logPath, "");
  writeFileSync(herdr, `#!/usr/bin/env bun
import { appendFileSync } from "node:fs";
const args = process.argv.slice(2);
appendFileSync(${JSON.stringify(logPath)}, JSON.stringify(args) + "\\n");
if (args[0] === "pane" && args[1] === "get") {
  console.log(JSON.stringify({ result: { pane: { pane_id: args[2], foreground_cwd: ${JSON.stringify(folder)}, cwd: ${JSON.stringify(folder)}, workspace_id: "workspace", tab_id: "workspace:tab" } } }));
} else if (args[0] === "plugin" && args[1] === "pane" && args[2] === "open") {
  console.log(JSON.stringify({ result: { plugin_pane: { pane: { pane_id: "workspace:" + args[args.indexOf("--entrypoint") + 1] } } } }));
} else {
  console.log(JSON.stringify({ result: { type: "ok" } }));
}
`);
  chmodSync(herdr, 0o755);
  let stop = false;
  const watchers: OutlinerWatcher[] = [];
  const panes = (async () => {
    let seen = 0;
    while (!stop) {
      const calls = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]);
      for (const call of calls.slice(seen)) {
        if (call[0] !== "plugin" || call[2] !== "open") continue;
        const entrypoint = call[call.indexOf("--entrypoint") + 1]!;
        const role = entrypoint === "outliner" ? "tree" : entrypoint === "detail" ? "detail" : undefined;
        const outline = call.find(argument => argument.startsWith("EP0CH_WS="))?.slice("EP0CH_WS=".length);
        const context = call.find(argument => argument.startsWith("OUTLINER_BROWSING_CONTEXT_ID="))?.slice("OUTLINER_BROWSING_CONTEXT_ID=".length) ?? "opened-context";
        if (!role || !outline) continue;
        watchers.push(new OutlinerClient(host.socketPath, 3_000, outline).watch({
          client: { clientId: `${outline}-${role}-${watchers.length}`, role, contextId: context, runtime: { hostname: hostname(), paneId: `workspace:${entrypoint}`, workspaceId: "workspace", tabId: "workspace:tab" } },
          onEvent() {},
        }));
      }
      seen = calls.length;
      await Bun.sleep(10);
    }
  })();
  try {
    const child = Bun.spawn(["bun", "run", "src/herdr-open.ts", "--mode", options.mode ?? "open-here", ...options.args ?? []], {
      cwd: join(import.meta.dir, ".."),
      env: {
        PATH: process.env.PATH, HOME: root, HERDR_ENV: "1", HERDR_BIN_PATH: herdr, HERDR_PANE_ID: options.paneId ?? "workspace:pane",
        EP0CH_OUTLINES: join(root, "outlines"), XDG_CONFIG_HOME: join(root, "config"), ...options.env,
      },
      stdout: "pipe", stderr: "pipe", timeout: 15_000, killSignal: "SIGKILL",
    });
    const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    const calls = readFileSync(logPath, "utf8").trim().split("\n").filter(Boolean).map(line => JSON.parse(line) as string[]);
    return { exitCode, stdout, stderr, calls };
  } finally {
    stop = true;
    await panes;
    await Promise.all(watchers.map(watcher => watcher.stop()));
  }
}

/** A live pane already on `outline`, as a Tree or Detail registers it. */
async function livePane(host: OutlineHost, outline: string, role: "tree" | "detail", paneId: string, contextId = `${outline}-context`, where: { workspaceId?: string; events?: OutlinerEvent[] } = {}) {
  const connected = Promise.withResolvers<void>();
  const workspaceId = where.workspaceId ?? "workspace";
  const watcher = new OutlinerClient(host.socketPath, 3_000, outline).watch({
    client: { clientId: `${outline}-${role}-${paneId}`, role, contextId, runtime: { hostname: hostname(), paneId, workspaceId, tabId: `${workspaceId}:tab` } },
    onConnect: connected.resolve,
    onEvent(event) { where.events?.push(event); },
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  return watcher;
}

test("herdr-open opens the outline a folder's .ep0ch names, creating it when nobody has yet, and passes its name to every pane", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("fred");
  const jam = join(root, "jam-shelf");
  const fredFolder = join(root, "fred-folder");
  mkdirSync(jam);
  mkdirSync(fredFolder);
  writeDotEp0ch(jam, "jam-shelf");
  writeDotEp0ch(fredFolder, "fred");

  // Named but not made yet: it is created and opened.
  const named = await openWithFakeHerdr({ root, host, folder: jam });
  expect(named.stderr).toBe("");
  expect(named.exitCode).toBe(0);
  const opened = JSON.parse(named.stdout.trim().split("\n").at(-1)!);
  expect(opened).toMatchObject({ outline: "jam-shelf", outlineCreated: true, workspaceRoot: jam });
  expect(opened.servicePane).toBeUndefined();
  const entrypoints = (calls: string[][]) => calls.filter(call => call[0] === "plugin" && call[2] === "open").map(call => call[call.indexOf("--entrypoint") + 1]);
  expect(entrypoints(named.calls)).toEqual(["outliner", "detail"]);
  for (const call of named.calls.filter(call => call.includes("--entrypoint"))) expect(call).toContain("EP0CH_WS=jam-shelf");
  expect(named.calls.some(call => call[0] === "notification" && call.includes("Created outline jam-shelf"))).toBe(true);
  expect(host.list().outlines.map(outline => outline.name)).toEqual(["fred", "jam-shelf"]);

  // A folder naming fred opens fred.
  const bound = await openWithFakeHerdr({ root, host, folder: fredFolder });
  expect(bound.stderr).toBe("");
  expect(JSON.parse(bound.stdout.trim().split("\n").at(-1)!)).toMatchObject({ outline: "fred", outlineCreated: false });
  expect(entrypoints(bound.calls)).toEqual(["outliner", "detail"]);
  for (const call of bound.calls.filter(call => call.includes("--entrypoint"))) expect(call).toContain("EP0CH_WS=fred");
  expect(bound.calls.some(call => call[0] === "notification")).toBe(false);
}, 30_000);

test("createOutlinerClient carries the resolved outline, and refuses without one", async () => {
  const client = createOutlinerClient({ socket: "/fictional/outlines/.host/host.sock", mode: "host", outline: "bandit" });
  expect(client.outline).toBe("bandit");
  const unnamed = createOutlinerClient({ socket: "/fictional/outlines/.host/host.sock", mode: "remote", unnamed: "no outline is named for /fictional" });
  await expect(unnamed.request({ action: "ping" })).rejects.toThrow("no outline is named for /fictional");
});

test("Herdr actions stay on the outline the invoking pane is on, not the folder's current .ep0ch", async () => {
  const root = scratch();
  const host = await startHost(root);
  const fredFolder = join(root, "fred-folder");
  const nameless = join(root, "bob-scratch");
  mkdirSync(fredFolder);
  mkdirSync(nameless);
  await host.create("fred");
  await host.create("bob");

  // A Tree on fred stays open while its folder's .ep0ch is switched to bob.
  await livePane(host, "fred", "tree", "workspace:fred-tree", "fred-context");
  writeDotEp0ch(fredFolder, "bob");
  expect(resolveClientPaths(envFor(root, fredFolder)).outline).toBe("bob");
  expect(await registeredPaneOutline(new OutlinerClient(host.socketPath), "workspace:fred-tree")).toBe("fred");
  expect(await registeredPaneOutline(new OutlinerClient(host.socketPath), "workspace:not-an-outliner")).toBeUndefined();
  expect(await resolveInvocationPaths(envFor(root, fredFolder), "workspace:fred-tree")).toMatchObject({ mode: "host", outline: "fred", outlineSource: "pane" });
  // An explicit EP0CH_WS still wins; a pane that is no outliner pane falls back to the folder.
  expect((await resolveInvocationPaths(envFor(root, fredFolder, { EP0CH_WS: "bob" }), "workspace:fred-tree")).outline).toBe("bob");
  expect(await resolveInvocationPaths(envFor(root, fredFolder), "workspace:shell")).toMatchObject({ outline: "bob", outlineSource: "file" });

  // ensure-detail from that Tree opens its Detail on fred.
  const detail = await openWithFakeHerdr({ root, host, folder: fredFolder, mode: "ensure-detail", paneId: "workspace:fred-tree" });
  expect(detail.stderr).toBe("");
  expect(detail.exitCode).toBe(0);
  expect(JSON.parse(detail.stdout.trim().split("\n").at(-1)!)).toMatchObject({ outline: "fred", outlineCreated: false, treePane: "workspace:fred-tree", opened: true });
  const opens = detail.calls.filter(call => call[0] === "plugin" && call[2] === "open");
  expect(opens.map(call => call[call.indexOf("--entrypoint") + 1])).toEqual(["detail"]);
  expect(opens[0]).toContain("EP0CH_WS=fred");

  // A Detail opened by name in a folder that names nothing.
  await livePane(host, "fred", "detail", "workspace:named-detail", "named-context");
  expect(resolveClientPaths(envFor(root, nameless)).outline).toBeUndefined();
  const focused = await openWithFakeHerdr({ root, host, folder: nameless, mode: "focus-existing", paneId: "workspace:named-detail" });
  expect(focused.stderr).toBe("");
  expect(JSON.parse(focused.stdout.trim().split("\n").at(-1)!)).toMatchObject({ outline: "fred", outlineCreated: false });
  expect(host.list().outlines.map(outline => outline.name)).toEqual(["bob", "fred"]);
}, 40_000);

/** The Herdr calls that open a pane, by entrypoint, and the ones that move focus. */
function paneCalls(calls: string[][]) {
  const opens = calls.filter(call => call[0] === "plugin" && call[2] === "open");
  return {
    opened: opens.map(call => call[call.indexOf("--entrypoint") + 1]),
    unfocusedOpens: opens.every(call => call.includes("--no-focus")),
    focuses: calls.filter(call => call.includes("focus")),
  };
}

test("ensure-detail --no-focus reuses the Tree's linked Detail without focusing it, and find-detail names it", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("fred");
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  writeDotEp0ch(folder, "fred");
  const events: OutlinerEvent[] = [];
  await livePane(host, "fred", "tree", "workspace:tree");
  await livePane(host, "fred", "detail", "workspace:admin-detail", "fred-context", { events });
  await new OutlinerClient(host.socketPath, 3_000, "fred").request({ action: "navigation.link.set", source: { clientId: "fred-tree-workspace:tree", region: "tree" }, destination: { clientId: "fred-detail-workspace:admin-detail", region: "detail" } });

  // From a shell pane beside them (Claude's), in the same workspace.
  const found = await openWithFakeHerdr({ root, host, folder, mode: "find-detail", paneId: "workspace:claude" });
  expect(found.stderr).toBe("");
  expect(JSON.parse(found.stdout.trim())).toMatchObject({ detailClientId: "fred-detail-workspace:admin-detail", detailPane: "workspace:admin-detail", treePane: "workspace:tree" });
  expect(paneCalls(found.calls)).toMatchObject({ opened: [], focuses: [] });

  const ensured = await openWithFakeHerdr({ root, host, folder, mode: "ensure-detail", paneId: "workspace:claude", args: ["--no-focus"] });
  expect(ensured.stderr).toBe("");
  expect(JSON.parse(ensured.stdout.trim())).toMatchObject({ detailClientId: "fred-detail-workspace:admin-detail", detailPane: "workspace:admin-detail", opened: false });
  expect(paneCalls(ensured.calls)).toMatchObject({ opened: [], focuses: [] });
  expect(events.filter(event => event.command)).toEqual([]);

  // Without the flag, the Herdr action still focuses it.
  await openWithFakeHerdr({ root, host, folder, mode: "ensure-detail", paneId: "workspace:claude" });
  for (let wait = 0; wait < 50 && !events.some(event => event.command); wait++) await Bun.sleep(20);
  expect(events.filter(event => event.command).map(event => event.command?.command)).toEqual(["focus"]);
}, 40_000);

test("ensure-detail --no-focus opens a Detail below a Tree with none linked, and focuses nothing", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("fred");
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  writeDotEp0ch(folder, "fred");
  await livePane(host, "fred", "tree", "workspace:tree");
  const found = await openWithFakeHerdr({ root, host, folder, mode: "find-detail", paneId: "workspace:claude" });
  expect(JSON.parse(found.stdout.trim())).toMatchObject({ detailClientId: null, treePane: "workspace:tree" });
  const ensured = await openWithFakeHerdr({ root, host, folder, mode: "ensure-detail", paneId: "workspace:claude", args: ["--no-focus"] });
  expect(ensured.stderr).toBe("");
  expect(JSON.parse(ensured.stdout.trim())).toMatchObject({ treePane: "workspace:tree", detailPane: "workspace:detail", detailClientId: "fred-detail-0", opened: true });
  expect(paneCalls(ensured.calls)).toEqual({ opened: ["detail"], unfocusedOpens: true, focuses: [] });
}, 40_000);

test("ensure-detail --no-focus with no Tree in this workspace opens a Tree and Detail, focusing neither; another workspace's Detail is not this one's", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("fred");
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  writeDotEp0ch(folder, "fred");
  const elsewhere = { workspaceId: "elsewhere" };
  await livePane(host, "fred", "tree", "elsewhere:tree", "fred-context", elsewhere);
  await livePane(host, "fred", "detail", "elsewhere:detail", "fred-context", elsewhere);
  await new OutlinerClient(host.socketPath, 3_000, "fred").request({ action: "navigation.link.set", source: { clientId: "fred-tree-elsewhere:tree", region: "tree" }, destination: { clientId: "fred-detail-elsewhere:detail", region: "detail" } });
  const found = await openWithFakeHerdr({ root, host, folder, mode: "find-detail", paneId: "workspace:claude" });
  expect(JSON.parse(found.stdout.trim())).toMatchObject({ detailClientId: null, treePane: null });
  const ensured = await openWithFakeHerdr({ root, host, folder, mode: "ensure-detail", paneId: "workspace:claude", args: ["--no-focus"] });
  expect(ensured.stderr).toBe("");
  expect(JSON.parse(ensured.stdout.trim())).toMatchObject({ treePane: "workspace:outliner", detailPane: "workspace:detail", detailClientId: "fred-detail-1", opened: true });
  expect(paneCalls(ensured.calls)).toEqual({ opened: ["outliner", "detail"], unfocusedOpens: true, focuses: [] });
}, 40_000);

test("find-detail reports a selection ensure-detail would refuse as none, with why, and opens nothing", async () => {
  const root = scratch();
  const host = await startHost(root);
  await host.create("fred");
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  writeDotEp0ch(folder, "fred");
  await livePane(host, "fred", "tree", "workspace:tree-a");
  await livePane(host, "fred", "tree", "workspace:tree-b");
  const found = await openWithFakeHerdr({ root, host, folder, mode: "find-detail", paneId: "workspace:claude" });
  expect(found.exitCode).toBe(0);
  expect(JSON.parse(found.stdout.trim())).toMatchObject({ detailClientId: null, why: "Multiple live Tree clients are registered in tab workspace:tab" });
  expect(found.calls.some(call => call[0] === "notification")).toBe(false);
  const ensured = await openWithFakeHerdr({ root, host, folder, mode: "ensure-detail", paneId: "workspace:claude", args: ["--no-focus"] });
  expect(ensured.exitCode).not.toBe(0);
  expect(ensured.stderr).toContain("Multiple live Tree clients are registered in tab workspace:tab");
}, 40_000);

test("--no-focus is refused outside ensure-detail", async () => {
  const root = scratch();
  const host = await startHost(root);
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  writeDotEp0ch(folder, "fred");
  const refused = await openWithFakeHerdr({ root, host, folder, mode: "open-here", args: ["--no-focus"] });
  expect(refused.exitCode).not.toBe(0);
  expect(refused.stderr).toContain("--no-focus is only for --mode ensure-detail");
}, 30_000);

test("focus-existing opens nothing, so it never creates the outline a .ep0ch names", async () => {
  const root = scratch();
  const host = await startHost(root);
  const jam = join(root, "jam-shelf");
  mkdirSync(jam);
  writeDotEp0ch(jam, "jam-shelf");
  const focused = await openWithFakeHerdr({ root, host, folder: jam, mode: "focus-existing" });
  expect(focused.exitCode).not.toBe(0);
  expect(focused.stderr).toContain('No outline named "jam-shelf"');
  expect(host.list().outlines).toEqual([]);
  expect(focused.calls.some(call => call[0] === "plugin" && call[2] === "open")).toBe(false);
}, 30_000);

test("a folder that names no outline gets the chooser, with its guess, and nothing is created by the guess", async () => {
  const root = scratch();
  const host = await startHost(root);
  // HOME is `root` in the fake Herdr run: too broad to name an outline after.
  const opened = await openWithFakeHerdr({ root, host, folder: root });
  expect(opened.exitCode).toBe(0);
  expect(JSON.parse(opened.stdout.trim().split("\n").at(-1)!)).toMatchObject({ outline: "missing", chooser: "choose-outline" });
  const chooserContext = (calls: string[][]) => JSON.parse(calls.find(call => call.includes("choose-outline"))!.find(argument => argument.startsWith("OUTLINER_CHOOSER_CONTEXT="))!.slice("OUTLINER_CHOOSER_CONTEXT=".length));
  expect(chooserContext(opened.calls).guess).toBeUndefined();

  // A git repository's subfolder: the chooser offers the repository's name and folder; the host is untouched.
  const repository = join(root, "code", "jam-shelf");
  mkdirSync(join(repository, ".git"), { recursive: true });
  mkdirSync(join(repository, "src"));
  const inRepository = await openWithFakeHerdr({ root, host, folder: join(repository, "src") });
  expect(inRepository.stderr).toBe("");
  expect(JSON.parse(inRepository.stdout.trim().split("\n").at(-1)!)).toMatchObject({ outline: "missing", chooser: "choose-outline" });
  expect(chooserContext(inRepository.calls).guess).toEqual({ name: "jam-shelf", folder: repository });
  expect(host.list().outlines).toEqual([]);
  expect(existsSync(join(repository, ".ep0ch"))).toBe(false);
}, 40_000);

test("comment on selection reaches the Detail on the outline its pane is on", async () => {
  const root = scratch();
  const host = await startHost(root);
  const folder = join(root, "fred-folder");
  mkdirSync(folder);
  await host.create("fred");
  await host.create("bob");
  writeDotEp0ch(folder, "bob");
  const fred = new OutlinerClient(host.socketPath, 3_000, "fred");
  const note = await fred.request<Block>({ action: "create", text: "Fred's fictional lantern" });
  const connected = Promise.withResolvers<void>();
  const watcher = fred.watch({
    client: { clientId: "fred-detail", role: "detail", contextId: "fred-context", currentTarget: { kind: "block", blockId: note.id }, runtime: { hostname: hostname(), paneId: "workspace:fred-detail", workspaceId: "workspace", tabId: "workspace:tab" } },
    onConnect: connected.resolve,
    onEvent() {},
  });
  cleanups.push(() => watcher.stop());
  await connected.promise;
  const capture = await dispatchNativeSelectionComment({
    env: {
      ...envFor(root, folder), HERDR_ENV: "1", HERDR_SOCKET_PATH: "/fictional/herdr.sock", HERDR_PANE_ID: "workspace:fred-detail",
      HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({ focused_pane_id: "workspace:fred-detail", selected_text: "fictional lantern", invocation_source: "keybinding" }),
    },
    readPane: async () => ({ revision: 7, text: "Fred's fictional lantern" }),
  });
  expect(capture).toMatchObject({ hostBlockId: note.id, detailClientId: "fred-detail" });
}, 20_000);

test("a hosted outline takes mentions from folders whose .ep0ch names it, and refuses other folders", async () => {
  const root = scratch();
  const host = await startHost(root, "fred");
  await host.create("fred");
  const bound = join(root, "projects", "jam-shelf");
  const other = join(root, "projects", "tin-drawer");
  mkdirSync(bound, { recursive: true });
  mkdirSync(other, { recursive: true });
  writeDotEp0ch(bound, "fred");
  const fred = new OutlinerClient(host.socketPath, 3_000, "fred");
  const message = (workspaceRoot: string, messageId: string) => ({ workspaceRoot, agent: "claude", sessionId: "fictional-session", messageId, text: "Mentions PIE-1 in passing." });
  const accepted = await fred.request({ action: "mentions.ingest", message: message(bound, "m1") }).catch((e: Error) => e.message);
  expect(accepted).not.toBeTypeOf("string");
  await expect(fred.request({ action: "mentions.ingest", message: message(other, "m2") })).rejects.toThrow("Mention workspace does not match");
});

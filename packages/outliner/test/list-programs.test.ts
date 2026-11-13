// The service's half of "a shell and an agent beside a note, and a list to jump between them" (src/list-programs.ts,
// the terminal extension, src/screens.ts `drawnBy`): the asker's programs as a list whose picks jump, the tile kinds
// a terminal drawer draws served as rows, and an extension's `run` tile bound to that drawer by its row alone. A
// scratch service in a temp folder; every program and note is made up.
import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ListAnswer, ListSource } from "@ep0ch/outline-core/list-row";
import { OutlinerClient } from "../src/client";
import { defaultOnBuiltIns } from "../src/extension-install";
import type { ProgramSaid } from "../src/list-programs";
import { programLine, type ScreensList } from "../src/screens";
import { OutlinerServer } from "../src/server";
import { OutlinerStore } from "../src/store";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const MANIFEST = JSON.parse(readFileSync(join(import.meta.dir, "..", "extensions", "terminal", "extension.json"), "utf8")) as {
  id: string; tiles: { kind: string; name: string; description: string; drawer: string; fields?: Record<string, unknown> }[];
};

async function setup() {
  const root = mkdtempSync(join(tmpdir(), "outliner-programs-"));
  const previous = { dir: process.env.OUTLINER_EXTENSIONS_DIR, registry: process.env.OUTLINER_RESOURCE_EXTENSIONS };
  const extensionsFolder = join(root, "user-extensions");
  process.env.OUTLINER_EXTENSIONS_DIR = extensionsFolder;
  process.env.OUTLINER_RESOURCE_EXTENSIONS = join(root, "no-registry.json");
  const outline = join(root, "outline"), socket = join(root, "outline.sock");
  mkdirSync(outline);
  const store = new OutlinerStore(join(root, "outline.sqlite"), { workspaceRoot: outline });
  const server = new OutlinerServer(store, socket, undefined, undefined, { extensionPollMs: 0, stateDirectory: join(root, "state") });
  server.setOutline({ name: "garden" });
  await server.start();
  const client = new OutlinerClient(socket, 30_000);
  cleanups.push(async () => {
    await server.close(); store.close(); rmSync(root, { recursive: true, force: true });
    for (const [key, value] of [["OUTLINER_EXTENSIONS_DIR", previous.dir], ["OUTLINER_RESOURCE_EXTENSIONS", previous.registry]] as const) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  });
  const list = (from: string, more: Record<string, unknown> = {}) => client.request<ListAnswer & { sources?: ListSource[] }>({ action: "lists.read", from, ...more } as never);
  const screens = (drawers: string[]) => client.request<ScreensList>({ action: "screens.list", kinds: [], drawers } as never);
  const extensions = () => client.request<{ extensions: { id: string; state: string; error?: string }[]; tileKinds: { kind: string; extension: string; command?: string[]; cwd: string; host: string }[] }>({ action: "extensions.list", reload: true } as never);
  return { client, list, screens, extensions, extensionsFolder };
}

const PROGRAMS: ProgramSaid[] = [
  { key: "garden-1", name: "Shell", cwd: "/plots/north", backend: "tmux", keeps: true, state: "running", tile: "shell" },
  { key: "garden-2", name: "Agent", command: "seedbot --plan beds", backend: "tmux", keeps: true, state: "running", tile: "agent", window: "second" },
  { key: "garden-3", name: "Shell", command: "tail -f watering.log", backend: "pty", keeps: false, state: "exited" },
];

test("programs: the asker's own, a row each with the jump as its pick, the ones no tile shows after", async () => {
  const { client, list } = await setup();
  const source = (await list("sources")).sources!.find(s => s.from === "programs")!;
  // It says what it reads, so a client hands its programs over by the parameter's name, and a bar lists it.
  expect(source).toMatchObject({ about: "Programs", bar: {}, params: [{ name: "programs", required: true }, { name: "query" }] });

  const all = await list("programs", { programs: PROGRAMS });
  expect(all.list).toMatchObject({ type: "list", arrange: "rows", title: "Programs · 2 running" });
  expect(all.list.rows.map(r => [r.id, r.label, r.detail ?? null, r.mark, r.group, r.cells, r.act])).toEqual([
    ["garden-1", "Shell", "/plots/north", "running", "In a tile", ["tmux · outlives the window", "shell"], 'terminal.jump key="garden-1"'],
    ["garden-2", "Agent", "seedbot --plan beds", "running", "In a tile", ["tmux · outlives the window", "agent · window second"], 'terminal.jump key="garden-2"'],
    ["garden-3", "Shell", "tail -f watering.log", "exited", "Running, in no tile", ["pty · ends with the window"], 'terminal.jump key="garden-3"'],
  ]);
  expect(all.list.groups).toEqual([{ name: "In a tile", label: "In a tile", count: 2 }, { name: "Running, in no tile", label: "Running, in no tile", count: 1 }]);

  // Words narrow it, by what a row says: the line that started it, what keeps it, how it stands.
  expect((await list("programs", { programs: PROGRAMS, query: "seedbot" })).list.rows.map(r => r.id)).toEqual(["garden-2"]);
  expect((await list("programs", { programs: PROGRAMS, query: "exited" })).list.rows.map(r => r.id)).toEqual(["garden-3"]);
  // One group has no header to draw.
  expect((await list("programs", { programs: PROGRAMS.slice(0, 1) })).list.groups).toBeUndefined();
  // None running says how one starts; the service keeps no programs of its own, and says so when handed none.
  expect((await list("programs", { programs: [] })).list).toMatchObject({ rows: [], title: "Programs · 0 running", empty: expect.stringContaining("terminal.open") });
  await expect(client.request({ action: "lists.read", from: "programs" } as never)).rejects.toThrow("hand them over as programs=");
});

test("the terminal extension: installed as a person does, its kinds are rows a terminal drawer draws; uninstalled, none is left", async () => {
  const { client, list, screens, extensions } = await setup();
  expect(await defaultOnBuiltIns()).toContain("terminal");
  expect((await screens(["list", "page", "pty"])).kinds).toEqual([]);

  // The bar's Extensions lists it with the act that installs it, and that act does.
  const row = (await list("extensions", { query: "terminal" })).list.rows.find(r => r.id === "install:terminal")!;
  expect(row).toMatchObject({ label: "Install Terminal", act: 'extensions.install id="terminal"' });
  expect(await client.request<{ id: string }>({ action: "extensions.install", extension: "terminal", where: "outline" } as never)).toMatchObject({ id: "terminal" });
  expect((await extensions()).extensions.find(e => e.id === "terminal")).toMatchObject({ state: "active" });

  // Each kind names the drawer and what a tile of it starts with: the agent's command is its row's, and no door's.
  const served = (await screens(["list", "page", "pty"])).kinds.filter(k => k.extension === "terminal");
  expect(served.map(k => [k.kind, k.name, k.drawer, k.fields ?? null, k.about])).toEqual(MANIFEST.tiles.map(t => [`terminal.${t.kind}`, t.name, t.drawer, t.fields ?? null, t.description]));
  expect(served.map(k => k.drawer)).toEqual(["pty", "pty"]);
  expect(served.find(k => k.kind === "terminal.agent")!.fields).toEqual({ command: "claude" });
  // What a door built without its terminal says of the tile is the row's: it says how the terminal is built in.
  for (const kind of served) expect(kind.about, kind.kind).toContain("cargo build --features pty");

  // A screen with a shell beside a reader reads with nothing wrong for a door that has the drawer, and says which
  // tile a door without it can't draw.
  await client.request({ action: "extensions.install", extension: "screens", where: "outline" } as never);
  await extensions();
  const saved = await client.request<{ name: string; id: string }>({ action: "screens.save", spec: { name: "Potting bench", layout: { root: { t: "split", dir: "row", weights: [0.6, 0.4], kids: [{ t: "leaf", kind: "reader", name: "reader" }, { t: "leaf", kind: "terminal.shell", name: "shell" }] } } } } as never);
  expect((await screens(["list", "page", "pty"])).screens.find(s => s.name === saved.name)!.problems).toEqual([]);
  expect((await screens(["list", "page"])).screens.find(s => s.name === saved.name)!.problems).toEqual([{ tile: "shell", said: "this door has no pty drawer, which draws a terminal.shell tile" }]);

  // Uninstalled the same way: its kinds are gone, and the screen says why its tile can't be drawn.
  expect((await client.request<{ removed: boolean }>({ action: "extensions.uninstall", extension: "terminal", demo: "keep" } as never)).removed).toBe(true);
  const left = await screens(["list", "page", "pty"]);
  expect(left.kinds.filter(k => k.extension === "terminal")).toEqual([]);
  expect(left.screens.find(s => s.name === saved.name)!.problems).toEqual([{ tile: "shell", said: "no tile kind terminal.shell here" }]);
});

test("an extension's tile that runs a program is a row the terminal drawer draws: the line that starts it, where, and on which machine", async () => {
  const { screens, extensions, extensionsFolder } = await setup();
  mkdirSync(join(extensionsFolder, "seedlog"), { recursive: true });
  writeFileSync(join(extensionsFolder, "seedlog", "extension.json"), JSON.stringify({
    contract: 2, id: "seedlog", version: 1, name: "Seed log", description: "The watering log, followed in a tile.",
    tiles: [{ kind: "log", name: "Watering log", description: "the watering log as it is written", run: ["tail", "-f", "watering log.txt"] }],
  }));
  const listed = await extensions();
  expect(listed.extensions.find(e => e.id === "seedlog")).toMatchObject({ state: "active" });
  const row = listed.tileKinds.find(k => k.kind === "seedlog.log")!;
  expect(row.command).toEqual(["tail", "-f", "watering log.txt"]);

  // Served to a screen's reader, the same row names the drawer: no door has code for this program.
  const kind = (await screens(["list", "page", "pty"])).kinds.find(k => k.kind === "seedlog.log")!;
  expect(kind).toMatchObject({ name: "Watering log", drawer: "pty", about: "the watering log as it is written" });
  expect(kind.fields).toMatchObject({ cwd: row.cwd, host: row.host });
  // The line is the program in place of the shell that reads it, with what the service sets for it, each word quoted
  // as a shell reads it.
  const line = String(kind.fields!.command);
  expect(line.startsWith("exec env ")).toBe(true);
  expect(line).toContain("OUTLINER_EXTENSION=seedlog");
  expect(line.endsWith("tail -f 'watering log.txt'")).toBe(true);
});

test("the line a terminal types: the program in place of the shell, its variables by env, every word as a shell reads it", () => {
  expect(programLine(["bun", "seeds.ts"])).toBe("exec bun seeds.ts");
  expect(programLine(["tail", "-f", "it's a log.txt"], { PLOT: "north bed", ROWS: "12" })).toBe(`exec env 'PLOT=north bed' ROWS=12 tail -f 'it'\\''s a log.txt'`);
  expect(programLine(["printf", "%s\\n", "$HOME", ""])).toBe(`exec printf '%s\\n' '$HOME' ''`);
});

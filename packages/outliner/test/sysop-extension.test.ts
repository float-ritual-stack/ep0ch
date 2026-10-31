import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OutlineHost } from "../src/outline-host";
import { OutlinerClient } from "../src/client";
import { scratchOutline } from "./scratch-outline";
import { valueOf } from "@ep0ch/outline-core/block-record";
import { parsePropertyRecords } from "@ep0ch/outline-core/property-parse";
import type { Block } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "sysop-"));
const scratch = scratchOutline(root, { name: "garden" });
const previous = { ...process.env };
let host: OutlineHost;
let client: OutlinerClient;
const stateFile = join(root, "machines.json");
const machines = { free: 8 * 1024 ** 3, asleep: false, failed: false, command: "docker", restartDelay: 0, restarts: [] as string[] };
const save = () => writeFileSync(stateFile, JSON.stringify(machines));
const request = <T,>(args: Parameters<OutlinerClient["request"]>[0]) => client.request<T>({ outline: scratch.name, ...args });
const query = async (where: string) => (await request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, machinery: "show", limit: 100 } })).blocks;
const get = (id: string) => request<Block>({ action: "get", blockId: id });
const edit = (b: Block, text: string) => request({ action: "update", blockId: b.id, expectedRevision: b.revision, text, mutation: { author: "user" } });
const look = () => request<{ ok: boolean; message: string; error?: string }>({ action: "extensions.schedule.run", extension: "sysop", entry: "action:look" });

beforeAll(async () => {
  mkdirSync(join(root, "bin"));
  const fake = join(import.meta.dir, "fixtures", "sysop-machine.ts");
  for (const [name, mode] of [["ssh", "remote"], ["sh", "local"]]) {
    const path = join(root, "bin", name!);
    writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${fake}' '${stateFile}' '${mode}' "$@"\n`);
    chmodSync(path, 0o755);
  }
  for (const name of ["uname", "free", "cat", "nproc", "df", "systemctl", "ps", "head", "docker"]) {
    const path = join(root, "bin", name);
    writeFileSync(path, `#!/bin/sh\nexec '${process.execPath}' '${fake}' '${stateFile}' command '${name}' "$@"\n`);
    chmodSync(path, 0o755);
  }
  save();
  Object.assign(process.env, scratch.env, {
    PATH: `${join(root, "bin")}:${previous.PATH}`,
    EP0CH_SSH: join(root, "bin", "ssh"),
    EP0CH_MACHINE_NAME: "garden",
    XDG_RUNTIME_DIR: root,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${join(root, "bus")}`,
    OUTLINER_EXTENSIONS_DIR: join(root, "extensions"),
    OUTLINER_RESOURCE_EXTENSIONS: join(root, "absent.json"),
  });
  host = new OutlineHost({ outlinesFolder: scratch.outlines, log: () => {} });
  await host.start();
  client = new OutlinerClient(host.socketPath, 30_000);
  await client.request({ action: "outlines.create", name: scratch.name });
}, 30_000);

test("uninstall finishes a running sample before clearing its generated notes", async () => {
  await client.request({ action: "outlines.create", name: "orchard" });
  const r = <T,>(args: Parameters<OutlinerClient["request"]>[0]) => client.request<T>({ outline: "orchard", ...args });
  const page = await r<Block>({ action: "create", text: "Sysop [page::sysop] [machines::kiln] [memory-free-min::2G] [load-max::8] [disk-free-min::10%]\n\nKeep my maintenance log.", author: "user" });
  writeFileSync(stateFile, JSON.stringify({ free: 1024 ** 3, command: "docker", restarts: [], sampleDelay: 1_500 }));
  await r({ action: "extensions.install", extension: "sysop", where: "outline" });
  const sampling = r({ action: "extensions.schedule.run", extension: "sysop", entry: "action:look" });
  const deadline = Date.now() + 5_000;
  while (!existsSync(`${stateFile}.sampling`) && Date.now() < deadline) await Bun.sleep(20);
  expect(existsSync(`${stateFile}.sampling`)).toBe(true);
  await r({ action: "extensions.uninstall", extension: "sysop", demo: "remove" });
  await sampling;
  const left = await r<{ blocks: Block[] }>({ action: "blocks.query", query: { where: "machine=health", machinery: "show" } });
  expect(left.blocks).toHaveLength(0);
  expect((await r<Block>({ action: "get", blockId: page.id })).text).toContain("Keep my maintenance log.");
  save();
}, 15_000);

afterAll(async () => {
  await host?.close();
  for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
  Object.assign(process.env, previous);
});

test("install, sample, trip once, calm and recover, then remove only what sysop wrote", async () => {
  await request({ action: "extensions.install", extension: "sysop", where: "outline" });
  const first = await look();
  expect(first.ok, first.error).toBe(true);
  let page = (await query("page=sysop"))[0]!;
  expect(page.text).toContain("::graph-stat");
  expect(page.text).toContain("::graph-uptime");
  const address = await request<{ machine: string }>({ action: "notes.address" });
  await edit(page, page.text.replace(/\[machines::[^\]]+\]/, `[machines::${address.machine}, kiln, notebook]`)
    .replace("::graph-uptime", "Inspect the fan before lunch.\n\n::graph-uptime") + "\n\nMy maintenance notes stay here.");
  machines.free = 1024 ** 3;
  machines.failed = true;
  machines.asleep = true;
  save();
  const trip = await look();
  expect(trip.ok, trip.error).toBe(true);
  expect(trip.message).toContain("kiln");
  expect(trip.message).toContain("tempo");
  expect(trip.message).toContain("4242");
  expect(trip.message).toContain("docker restart kiln-tempo");
  expect(valueOf((await query("machine=health sysop-machine=garden"))[0]!, "failed-units")).toBe("garden-cache.service");
  expect((await get(page.id)).text).toContain("Inspect the fan before lunch.");
  let day = (await query("machine=health sysop-machine=kiln"))[0]!;
  expect(valueOf(day, "status")).toBe("degraded");
  expect(valueOf(day, "needs")).toContain("sysop:");
  expect(day).toMatchObject({ author: "agent", actorId: "ext:sysop" });
  const trips = await query("sysop-trip=kiln");
  expect(trips).toHaveLength(1);
  expect(valueOf(trips[0]!, "machine")).toBeUndefined();
  const sleeper = (await query("machine=health sysop-machine=notebook"))[0]!;
  const since = valueOf(sleeper, "asleep-since");
  expect(since).toBeTruthy();
  expect(valueOf(sleeper, "status")).not.toBe("down");
  const again = await look();
  expect(again.message).not.toContain("docker restart");
  expect((await get(day.id)).text).toBe(day.text);
  expect(valueOf((await query("machine=health sysop-machine=notebook"))[0]!, "asleep-since")).toBe(since);

  const today = valueOf(day, "date")!;
  await edit(day, day.text.replace(`[date::${today}]`, "[date::2001-02-03]"));
  expect((await look()).message).not.toContain("docker restart");
  expect(valueOf(await get(day.id), "needs")).toBeUndefined();
  day = (await query(`machine=health sysop-machine=kiln date=${today}`))[0]!;

  const activeTrip = await get(trips[0]!.id);
  const moved = parsePropertyRecords(activeTrip.text).filter(p => ["needs", "sysop-active", "sysop-command"].includes(p.key));
  let tidied = activeTrip.text;
  for (const p of [...moved].reverse()) tidied = tidied.slice(0, p.start) + tidied.slice(p.end);
  const lineEnd = tidied.indexOf("\n");
  await edit(activeTrip, tidied.slice(0, lineEnd) + "\n" + moved.map(p => `${p.key}:: ${p.value}`).join("\n") + tidied.slice(lineEnd));
  expect(valueOf(await get(activeTrip.id), "needs")).toContain("sysop:");

  page = await get(page.id);
  await edit(page, page.text.replace("[load-max::8]", "[load-max::soon]"));
  await expect(request({ action: "extensions.act", extension: "sysop", extensionAction: "calm", args: { machine: "kiln" } })).rejects.toThrow("thresholds");
  expect(JSON.parse(readFileSync(stateFile, "utf8")).restarts).toHaveLength(0);
  page = await get(page.id);
  expect(page.text).toContain("[load-max::soon]");
  await edit(page, page.text.replace("[load-max::soon]", "[load-max::8]"));

  machines.restartDelay = 9_300;
  save();
  const calm = await request<{ message: string }>({ action: "extensions.act", extension: "sysop", extensionAction: "calm", args: { machine: "kiln" }, mutation: { author: "agent", actorId: "garden-helper" } });
  machines.restartDelay = 0;
  expect(calm.message).toContain("docker restart kiln-tempo");
  expect(JSON.parse(readFileSync(stateFile, "utf8")).restarts).toContain("kiln:docker restart kiln-tempo");
  const recovered = await get(day.id);
  expect(valueOf(recovered, "status")).toBe("degraded");
  expect(valueOf(recovered, "needs")).toBeUndefined();
  expect(valueOf(await get(activeTrip.id), "needs")).toBeUndefined();
  expect(recovered.text).toContain("docker restart kiln-tempo");
  expect(recovered.text).toContain("8.0G");
  const feed = await request<{ kind: string; changes: { action: string; actor?: { actorId?: string }; requestedBy?: { actorId?: string } }[] }>({ action: "changes.since", sequence: 0, limit: 1000 });
  expect(feed.changes.some(c => c.action === "ext.sysop.calm" && c.actor?.actorId === "ext:sysop" && c.requestedBy?.actorId === "garden-helper")).toBe(true);
  await expect(request({ action: "extensions.act", extension: "sysop", extensionAction: "calm", args: { machine: "kiln" }, mutation: { author: "agent", actorId: "garden-helper" } })).rejects.toThrow("nothing safe to run; look");
  page = await get(page.id);
  expect(page.text).toContain("My maintenance notes stay here.");
  expect(page.text).not.toMatch(/kiln.*!!!/);

  const sampled = JSON.parse(readFileSync(stateFile, "utf8"));
  writeFileSync(stateFile, JSON.stringify({ ...sampled, unitBusUnavailable: true }));
  await look();
  expect(valueOf((await query("machine=health sysop-machine=garden"))[0]!, "asleep-since")).toBeTruthy();

  const child = await request<Block>({ action: "create", parentId: recovered.id, text: "Keep this investigation", author: "user" });
  const removed = await request<{ demo: { kept: string[] } }>({ action: "extensions.uninstall", extension: "sysop", demo: "remove" });
  expect((await get(child.id)).effectiveDeletedRootId).toBeUndefined();
  expect((await get(page.id)).effectiveDeletedRootId).toBeUndefined();
  expect(removed.demo.kept.join(" ")).toContain("Sysop");
  expect(await query("machine=health sysop-machine=notebook")).toHaveLength(0);
  expect((await get(page.id)).text).toContain("My maintenance notes stay here.");
}, 60_000);

test("a recorded user unit restart runs through the CLI, and clean removal trashes the generated page", async () => {
  await client.request({ action: "outlines.create", name: "shed" });
  const r = <T,>(args: Parameters<OutlinerClient["request"]>[0]) => client.request<T>({ outline: "shed", ...args });
  const q = async (where: string) => (await r<{ blocks: Block[] }>({ action: "blocks.query", query: { where, machinery: "show" } })).blocks;
  machines.command = "unit";
  machines.free = 1024 ** 3;
  machines.asleep = false;
  save();
  await r({ action: "extensions.install", extension: "sysop", where: "outline" });
  const tripped = await r<{ message: string }>({ action: "extensions.act", extension: "sysop", extensionAction: "look", mutation: { author: "user" } });
  expect(tripped.message).toContain("systemctl --user restart garden-cache.service");
  const page = (await q("page=sysop"))[0]!;
  const cli = async (...args: string[]) => {
    const p = Bun.spawn([process.execPath, join(import.meta.dir, "../../door/src/main.ts"), "--ws", "shed", ...args], { env: { ...process.env }, stdout: "pipe", stderr: "pipe" });
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    expect(code, out + err).toBe(0);
    return out + err;
  };
  const here = await r<{ machine: string }>({ action: "notes.address" });
  const remote = valueOf(page, "machines")!.split(",").map(name => name.trim()).find(name => name !== here.machine)!;
  expect(await cli("ext", "act", "sysop", "calm", "--arg", `machine=${remote}`, "--actor", "garden-helper")).toContain("garden-cache.service");
  expect(JSON.parse(readFileSync(stateFile, "utf8")).restarts).toContain(`${remote}:systemctl --user restart garden-cache.service`);
  expect(await cli("ext", "remove", "sysop", "--outline-folder", join(scratch.outlines, "shed"), "--demo", "remove")).toContain("Trash");
  expect((await r<Block>({ action: "get", blockId: page.id })).effectiveDeletedRootId).toBeTruthy();
  expect(await q("machine=health")).toHaveLength(0);
}, 30_000);

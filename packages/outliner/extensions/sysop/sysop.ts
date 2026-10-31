import { outline } from "./outline";
import { SNIPPET, SAFE_COMMAND, parseReading, thresholdsOf, crossings, bytes, worst, statusOf, machinesOf, clock, dayOf, value, type Reading, type Crossing, type Thresholds } from "./sample";

interface Block { id: string; text: string; revision: number; properties: { key: string; value: string }[] }
const prop = (b: Block | undefined, key: string) => b?.properties.find(p => p.key === key)?.value;
const { input } = await Bun.stdin.json() as { input: { action: string; args?: { machine?: string }; context: { now: string } } };
const now = input.context.now;
const date = dayOf(now);
const get = (id: string) => outline<Block>({ action: "get", blockId: id });
const query = async (where: string, limit = 1) => (await outline<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit, machinery: "show", sort: "created desc" } })).blocks;
const named = (s: string) => JSON.stringify(s);

async function save(b: Block, text: string): Promise<Block> {
  if (text !== b.text) {
    const result = await outline<{ outcome: string }>({ action: "update", blockId: b.id, expectedRevision: b.revision, text });
    if (result.outcome === "proposed") throw new Error("Sysop's change is beside the note as a proposal; finish the edit and run ext.sysop.look again");
  }
  return get(b.id);
}

async function withProps(text: string, changes: Record<string, string | null>): Promise<string> {
  const parsed = await outline<{ tokens: { key: string; start: number; end: number; scope: string; syntax: string }[] }>({ action: "properties.preview", text });
  const remaining = new Map(Object.entries(changes));
  const edits: { start: number; end: number; text: string }[] = [];
  for (const token of parsed.tokens) {
    if (token.scope !== "block" || !(token.key in changes)) continue;
    const next = remaining.get(token.key);
    edits.push({ ...token, text: next == null ? "" : token.syntax === "bare" ? `${token.key}:: ${value(next)}` : `[${token.key}::${value(next)}]` });
    remaining.delete(token.key);
  }
  for (const edit of edits.reverse()) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  const added = [...remaining].filter(([, next]) => next !== null).map(([key, next]) => ` [${key}::${value(next!)}]`).join("");
  const end = text.indexOf("\n");
  return end < 0 ? text + added : text.slice(0, end) + added + text.slice(end);
}

const generated = "[ext.generated::sysop]";
async function pageOf(): Promise<Block> {
  const found = await outline<{ status: string; block?: Block }>({ action: "pages.resolve", address: "sysop" });
  if (found.status === "resolved") return get(found.block!.id);
  const ext = await outline<{ status: string; block?: Block }>({ action: "pages.resolve", address: "ext-sysop" });
  return outline<Block>({ action: "create", parentId: ext.block?.id ?? null, text:
    `Sysop [page::sysop] ${generated} [machines::float-2, float-box, laptop] [memory-free-min::2G] [load-max::8] [disk-free-min::10%]\n\nThe monk looks every minute. Edit the machines and thresholds above.\n\n::button{label="Look now" act="ext.sysop.look"}\n\n## Machines ^sysop-machines\n## Notes ^sysop-notes` });
}

const address = await outline<{ machine: string; aliases?: string[] }>({ action: "notes.address" });
const self = new Set([address.machine, ...(address.aliases ?? [])]);

async function run(machine: string, command: string, timeout: number): Promise<string> {
  // Local shell reads the script on stdin; ssh already runs its command through the remote login shell.
  const local = self.has(machine);
  const p = Bun.spawn(local ? ["sh"] : [process.env.EP0CH_SSH ?? "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=3", "-o", "ServerAliveInterval=3", "-o", "ServerAliveCountMax=1", "--", machine, command], {
    stdin: local ? new Blob([command + "\n"]) : "ignore", stdout: "pipe", stderr: "pipe", timeout,
  });
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
  if (code !== 0) throw new Error(`${machine}: ${err.trim().split("\n")[0] || `sample exited ${code}`}`);
  return out;
}

type Sample = { machine: string; reading?: Reading; error?: string };
async function sample(machine: string): Promise<Sample> {
  try { return { machine, reading: parseReading(await run(machine, SNIPPET, 8_000)) }; }
  catch (e) { return { machine, error: e instanceof Error ? e.message : String(e) }; }
}

const describe = (machine: string, c: Crossing) => `${machine}: ${c.number}${c.process ? `; ${c.process.name} pid ${c.process.pid}, RSS ${bytes(c.process.rss)}` : ""}; ${c.command ?? "nothing safe to run; look"}`;
function doorMessage(text: string): string {
  // Action messages have 500 characters; the page and day notes hold every trip in full.
  if (text.length <= 500) return text;
  const more = "\nMore on [[sysop]].";
  const lines = text.split("\n");
  while (lines.length > 1 && lines.join("\n").length + more.length > 500) lines.pop();
  return lines.join("\n").slice(0, 500 - more.length) + more;
}
async function writeFigures(page: Block, bands: string[], items?: { label: string; value: string }[], machines?: string[]): Promise<void> {
  const parts = new Map([
    ["sysop-alerts", `::box{} ^sysop-alerts\n${bands.join("\n\n") || "No open trips."}\n::`],
    ...(items ? [["sysop-now", ["::graph-stat ^sysop-now", "---", "title: Machines now", `items: ${JSON.stringify(items)}`, "---", "::"].join("\n")] as [string, string]] : []),
    ...(machines ?? []).map((machine, i): [string, string] => [`sysop-history-${i}`, [
      `::graph-uptime ^sysop-history-${i}`, "---", `title: ${JSON.stringify(machine)}`,
      `query: ${JSON.stringify(`machine=health sysop-machine=${named(machine)}`)}`, "machinery: show", "date: date", "state: status", "---", "::",
    ].join("\n")]),
  ]);
  // The service owns component boundaries; prose between the monk's figures is the person's.
  const found = await outline<{ items: { fragmentId?: string; kind: string }[] }>({ action: "fragments.candidates", query: { blockIds: [page.id], mode: "id", fragmentQuery: "sysop-", limit: 100 } });
  const edits: { start: number; end: number; text: string }[] = [];
  for (const item of found.items) {
    const id = item.fragmentId ?? "";
    if (item.kind !== "component" || !/^(sysop-alerts|sysop-now|sysop-history-\d+)$/.test(id)) continue;
    if (machines === undefined && id !== "sysop-alerts") continue;
    const read = await outline<{ revision: number; status: string; fragment: { start: number; end: number } }>({ action: "fragments.read", blockId: page.id, fragmentId: id });
    if (read.revision !== page.revision || read.status !== "resolved") throw new Error("The sysop page changed; the next look will update its figures");
    edits.push({ ...read.fragment, text: parts.get(id) ?? "" });
    parts.delete(id);
  }
  let text = page.text;
  for (const edit of edits.sort((a, b) => b.start - a.start)) text = text.slice(0, edit.start) + edit.text + text.slice(edit.end);
  if (parts.size) {
    const heading = "## Machines ^sysop-machines";
    const at = text.indexOf(heading);
    const after = at < 0 ? text.length : at + heading.length;
    text = text.slice(0, after) + "\n\n" + [...parts.values()].join("\n\n") + "\n" + text.slice(after);
  }
  await save(page, text);
}

async function look(page: Block, samples: Sample[], t: Thresholds, calm?: { machine: string; command: string; result: string }): Promise<string> {
  const messages: string[] = [], bands: string[] = [], items: { label: string; value: string }[] = [];
  for (const s of samples) {
    const machine = s.machine;
    const latest = (await query(`machine=health sysop-machine=${named(machine)}`))[0];
    let day = (await query(`machine=health sysop-machine=${named(machine)} date=${date}`))[0];
    if (!day) {
      if (latest && prop(latest, "needs")) await save(latest, await withProps(latest.text, { needs: null }));
      day = await outline<Block>({ action: "create", parentId: page.id, text: `${machine} · ${date} [machine::health] ${generated} [sysop-machine::${value(machine)}] [date::${date}] [status::ok]` });
    }
    const trip = (await query(`sysop-trip=${named(machine)}`))[0];
    if (!s.reading) {
      const since = prop(latest, "asleep-since") ?? now;
      let text = await withProps(day.text, { "asleep-since": since });
      if (calm?.machine === machine) text += `\n- ${clock(now)} · calm: ${calm.command}; ${calm.result}; reading after unavailable: ${s.error}`;
      await save(day, text);
      items.push({ value: machine, label: `asleep since ${since}` });
      // An unanswered sample cannot establish that an open trip cleared.
      if (prop(trip, "needs")) bands.push(`${prop(trip, "needs")!.replace(/^sysop: /, "")} !!!`);
      continue;
    }
    const r = s.reading;
    const crossed = crossings(r, t);
    const kinds = crossed.map(c => c.kind).join(",");
    const was = prop(trip, "sysop-active") ?? "";
    const fresh = crossed.filter(c => !was.split(",").includes(c.kind));
    const details = crossed.map(c => describe(machine, c));
    const command = crossed.find(c => c.command)?.command;
    let text = await withProps(day.text, {
      status: worst(statusOf(prop(day, "status")), crossed.length ? "degraded" : "ok"),
      "memory-free": String(r.memoryFree), "memory-total": String(r.memoryTotal), load: String(r.load),
      "disk-free": String(r.diskFree), "failed-units": r.failedUnits.join(", ") || "none",
      top: r.top.map(p => `${p.name} pid ${p.pid} RSS ${bytes(p.rss)}`).join("; "),
      needs: crossed.length ? `sysop: ${details.join("; ")}` : null,
      "asleep-since": null,
    });
    for (const c of fresh) {
      const message = describe(machine, c);
      text += `\n- ${clock(now)} · ${message}`;
      messages.push(message);
    }
    if (was && !kinds) text += `\n- ${clock(now)} · cleared; ${bytes(r.memoryFree)} free, load ${r.load}, disk ${bytes(r.diskFree)} free`;
    if (calm?.machine === machine) text += `\n- ${clock(now)} · calm: ${calm.command}; ${calm.result}; after: ${bytes(r.memoryFree)} free, load ${r.load}, disk ${bytes(r.diskFree)} free`;
    await save(day, text);
    if (crossed.length || trip) {
      const base = trip ?? await outline<Block>({ action: "create", parentId: page.id, text: `${machine} needs a look ${generated} [sysop-trip::${value(machine)}]\n\n::button{label="Calm ${value(machine)}" act="ext.sysop.calm machine=${machine}"}` });
      await save(base, await withProps(base.text, { needs: crossed.length ? `sysop: ${details.join("; ")}` : null, "sysop-active": kinds || null, "sysop-command": command ?? null }));
    }
    if (crossed.length) {
      bands.push(...details.map(d => `${d} !!!`));
      if (command) bands.push(`::button{label="Calm ${machine}" act="ext.sysop.calm machine=${machine}"}`);
    }
    items.push({ value: machine, label: `memory ${bytes(r.memoryFree)} / ${bytes(r.memoryTotal)} free · load ${r.load} · disk ${bytes(r.diskFree)} free · failed ${r.failedUnits.join(", ") || "none"}` });
  }
  const freshPage = await get(page.id);
  await writeFigures(freshPage, bands, items, samples.map(s => s.machine));
  return messages.length ? messages.join("\n") : `Sysop: ${samples.length} machines checked${samples.some(s => s.error) ? "; sleeping machines keep their first miss" : ""}`;
}

try {
  const page = await pageOf();
  const machines = [...new Set(machinesOf(prop(page, "machines")))];
  const invalid = machines.find(m => !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(m));
  if (invalid || !machines.length) throw new Error(`Edit [machines::…] on [[sysop]]: use comma-separated ssh names${invalid ? `; ${invalid} is not one` : ""}`);
  const thresholds = thresholdsOf(Object.fromEntries(page.properties.map(p => [p.key, p.value])));
  if (!thresholds.memoryFreeMin || thresholds.loadMax === undefined || !thresholds.diskFreeMin) {
    const message = "Sysop needs valid thresholds: edit [memory-free-min::2G] [load-max::8] [disk-free-min::10%] on [[sysop]]";
    await writeFigures(page, [`${message} !!!`]);
    throw new Error(message + (input.action === "calm" ? "; no restart ran" : ""));
  }
  let calm: { machine: string; command: string; result: string } | undefined;
  if (input.action === "calm") {
    const machine = input.args?.machine ?? "";
    if (!machines.includes(machine)) throw new Error(`Choose a machine from [[sysop]]: ${machines.join(", ")}`);
    const trip = (await query(`sysop-trip=${named(machine)}`))[0];
    const command = prop(trip, "sysop-command");
    if (!prop(trip, "needs") || !command || !SAFE_COMMAND.test(command)) throw new Error(`${machine}: nothing safe to run; look at [[sysop]] and run ext.sysop.look`);
    let result = "completed";
    // A container's normal stop grace period exceeds the sample timeout; leave time to read afterward too.
    try { await run(machine, command, 35_000); } catch (e) { result = `failed: ${e instanceof Error ? e.message : String(e)}`; }
    calm = { machine, command, result };
  }
  const message = await look(page, await Promise.all(machines.map(sample)), thresholds, calm);
  if (calm?.result.startsWith("failed:")) throw new Error(`${calm.machine}: ${calm.command}; ${calm.result}; the day's note records the reading after`);
  process.stdout.write(JSON.stringify({ ok: true, value: { message: doorMessage(calm ? `${calm.machine}: ${calm.command}; ${calm.result}\n${message}` : message) } }));
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
}

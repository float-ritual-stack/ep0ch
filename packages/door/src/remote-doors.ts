// Doors running on another machine, reached through the machine link (PIE-1242): Evan's door on the laptop, peeked and
// acted in by an agent on float-box, attributed and never taking his keys, the same as a door on this machine. The link
// carries each of the laptop's door sessions' control sockets as it carries its outline host (the outliner's
// src/link-doors.ts has the files); this is the door's side: which machine's doors are reachable here, and how.
//
// A machine's doors are reached, in order:
//   1. through its link, when it lands on this machine (`ep0ch link serve`): `.remote/<machine>.doors/` here;
//   2. through the machine its link lands on, named in `.remote/<machine>.json` as `{ "via": "<ssh-name>" }`
//      (`ep0ch link via <machine> <ssh-name>` writes it): that machine is asked which doors its link carries
//      (`ep0ch link doors <machine> --json` there), and each one's socket is forwarded over the ssh connection that
//      already holds that machine's host forward (`ssh -O forward`), to the same names here.
// Nothing is guessed: for a machine that names neither, an agent's `--remote` command runs there over ssh as it always
// has (main.ts), and what lists doors refuses with the command that sets one up.
import { existsSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { forwardPaths, sshArgv } from "@ep0ch/outline-core/machine";
import { isMachineName } from "@ep0ch/outline-core/outline-location";
import { linkDoorSocket, linkDoorsFile, pickLinkDoor, readLinkDoors, type LinkDoorsRecord, type ReachableDoor } from "@ep0ch/outliner/link-doors";
import { linkStates } from "@ep0ch/outliner/link";
import { nodeMachineIO } from "@ep0ch/outliner/machine-forward";
import { outlinesDir } from "./discover";
import { listening } from "./jsonl";
import { forwardTo, sshBin } from "./machine";
import { lastJson, remoteEp0ch } from "./mcp-netmail";

type Env = Record<string, string | undefined>;

/** The machine whose link carries `machine`'s doors to this one, as `.remote/<machine>.json` names it (`via`). */
export function doorsVia(machine: string, env: Env = process.env): string | null {
  try {
    const via = (JSON.parse(readFileSync(forwardPaths(outlinesDir(env), machine).config, "utf8")) as { via?: unknown }).via;
    return typeof via === "string" && isMachineName(via) && via !== machine ? via : null;
  } catch { return null; }
}

/** `ep0ch link via <machine> <ssh-name>`: write `via` into the machine's file, keeping what else it says. */
export function setDoorsVia(machine: string, via: string | null, env: Env = process.env): string {
  const p = forwardPaths(outlinesDir(env), machine);
  nodeMachineIO(env as NodeJS.ProcessEnv).privateDir(p.dir);
  let o: Record<string, unknown> = {};
  try { o = JSON.parse(readFileSync(p.config, "utf8")); } catch { /* none yet */ }
  if (via) o.via = via; else delete o.via;
  writeFileSync(`${p.config}.tmp`, JSON.stringify(o), { mode: 0o600 });
  renameSync(`${p.config}.tmp`, p.config);
  return p.config;
}

/** Whether `machine`'s link lands on this machine and is up now. */
const linkedHere = (machine: string, env: Env) => linkStates(outlinesDir(env)).some(s => s.machine === machine);

const setUp = (machine: string) =>
  `no link carries ${machine}'s doors here · on the machine ${machine}'s link lands on, \`ep0ch link status\` says it is up; here, \`ep0ch link via ${machine} <that machine's ssh name>\``;

/**
 * The doors `machine` runs, reachable here: its link's record when the link lands on this machine, else asked of the
 * machine it lands on (`via`) and forwarded. `forward: false` only reads what is there (for `ep0ch where`, which never
 * starts ssh).
 */
export async function machineDoors(machine: string, env: Env = process.env, o: { forward?: boolean } = {}): Promise<LinkDoorsRecord | { error: string }> {
  if (!isMachineName(machine)) return { error: `"${machine}" isn't an ssh config name` };
  const outlines = outlinesDir(env);
  if (linkedHere(machine, env)) return readLinkDoors(outlines, machine) ?? { machine, addresses: [], doors: [], at: Date.now() };
  const via = doorsVia(machine, env);
  if (!via) return { error: setUp(machine) };
  if (o.forward === false) return readLinkDoors(outlines, machine) ?? { error: `${machine}'s doors haven't been asked of ${via} yet · \`ep0ch session list --machine ${machine}\`` };
  return forwardDoorsVia(machine, via, env);
}

/** Ask `via` which of `machine`'s doors its link carries, and forward each one's socket here over `via`'s ssh connection. */
async function forwardDoorsVia(machine: string, via: string, env: Env): Promise<LinkDoorsRecord | { error: string }> {
  const outlines = outlinesDir(env), ssh = sshBin(env);
  // The connection that holds via's host forward carries the doors too: started here when it isn't up.
  const f = await forwardTo(via, env).catch(e => ({ error: (e as Error).message }));
  if ("error" in f) return { error: `can't reach ${via}, which carries ${machine}'s link: ${f.error}` };
  const p = forwardPaths(outlines, via);
  if (f.transport !== "ssh") return { error: `${via} is reached through its own link here, not ssh, so it can't carry ${machine}'s doors · \`ep0ch link via ${machine} <a machine this one reaches over ssh>\`` };
  const command = `ep0ch link doors ${machine} --json`;
  const asked = await run([ssh, "-S", p.control, "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", "--", via, remoteEp0ch(command)], env, 20_000);
  let there: LinkDoorsRecord;
  try {
    if (asked.code !== 0) throw new Error((asked.err.trim().split("\n").at(-1) ?? "") || `exit ${asked.code}`);
    there = lastJson(asked.out) as LinkDoorsRecord;
    if (!there || !Array.isArray(there.doors)) throw new Error("it answered no door list");
  } catch (e) { return { error: `${via} didn't say which of ${machine}'s doors it carries (${(e as Error).message}) · \`ssh ${via} ${command}\`` }; }
  nodeMachineIO(env as NodeJS.ProcessEnv).privateDir(join(outlines, ".remote", `${machine}.doors`));
  const doors: ReachableDoor[] = [];
  for (const d of there.doors) {
    const local = linkDoorSocket(outlines, machine, d.key);
    if (!(await listening(local, 500))) {
      const added = await run(sshArgv.forwardMore(ssh, p, local, d.control), env, 10_000);
      if (added.code !== 0 && !(await listening(local, 1000))) return { error: `${via} couldn't forward ${machine}'s door ${d.key} (${added.err.trim().split("\n").at(-1) || `exit ${added.code}`}) · \`ssh -S ${p.control} -O forward -L ${local}:${d.control} ${via}\`` };
    }
    doors.push({ ...d, control: local });
  }
  const record: LinkDoorsRecord = { machine, addresses: there.addresses ?? [], via, doors, at: Date.now() };
  const file = linkDoorsFile(outlines, machine);
  writeFileSync(`${file}.tmp`, JSON.stringify(record), { mode: 0o600 });
  renameSync(`${file}.tmp`, file);
  return record;
}

async function run(argv: string[], env: Env, timeoutMs: number) {
  const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "pipe", env: env as Record<string, string> });
  const timer = setTimeout(() => child.kill(), timeoutMs);
  try {
    const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    return { code, out, err };
  } finally { clearTimeout(timer); }
}

/** The door on `machine` an agent means (`--ws`, else the one with the person), reachable here: its control socket. */
export async function reachMachineDoor(machine: string, want: { outline?: string; machine?: string } = {}, env: Env = process.env): Promise<{ control: string; door: ReachableDoor; via?: string } | { error: string }> {
  const record = await machineDoors(machine, env);
  if ("error" in record) return record;
  const door = pickLinkDoor(record.doors, want);
  if ("error" in door) return { error: `${machine}: ${door.error}` };
  if (!(await listening(door.control))) return { error: `${machine}'s door ${door.key} doesn't answer through the link (${door.control}) · \`ep0ch link status\`${record.via ? ` on ${record.via}` : ""}` };
  return { control: door.control, door, ...(record.via ? { via: record.via } : {}) };
}

/** Every machine whose doors this one can reach: its links that land here, and the ones a `via` names. */
export function doorMachines(env: Env = process.env): string[] {
  const outlines = outlinesDir(env), dir = join(outlines, ".remote");
  const names = new Set(linkStates(outlines).map(s => s.machine));
  let files: string[] = [];
  try { files = existsSync(dir) ? readdirSync(dir) : []; } catch { /* none */ }
  for (const f of files) {
    const m = f.endsWith(".json") && !f.endsWith(".link.json") && !f.endsWith(".doors.json") ? f.slice(0, -5) : null;
    if (m && isMachineName(m) && doorsVia(m, env)) names.add(m);
  }
  return [...names].sort();
}

/**
 * The machine an ssh session here came from, among those whose doors are reachable: the link's record of its
 * addresses, else the address ssh's config gives it (`ssh -G`). Null for none: it came from somewhere else.
 */
export async function machineAtAddress(address: string, env: Env = process.env): Promise<string | null> {
  const outlines = outlinesDir(env);
  for (const m of doorMachines(env)) {
    if (readLinkDoors(outlines, m)?.addresses.includes(address)) return m;
    const g = await run([sshBin(env), "-G", "--", m], env, 3000).catch(() => null);
    const host = g?.code === 0 ? g.out.split("\n").find(l => l.startsWith("hostname "))?.slice(9).trim() : undefined;
    if (host === address) return m;
  }
  return null;
}

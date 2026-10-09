// `ep0ch outline …`, `ep0ch init` and `ep0ch status`: the outline host's outlines, like `herdr session …` (PIE-466),
// named by folder (PIE-530). Every command asks the host itself (`outlines.*`, each on its own short connection).
// `attach` opens the door on the outline, the same as `ep0ch --ws <name>`. `--json` prints the host's answer for
// agents. Nothing here reads or writes an outline's notes.
//
// A folder that names no outline (no --ws, no EP0CH_WS, no .ep0ch) gets the home base when the door opens there
// (src/home.ts): never a guess taken silently. Choosing there offers to write `.ep0ch`, so the next `ep0ch` is direct.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { DOT_EP0CH, formatDotEp0ch, isMachineName, mayCreate, missingOutline, tooBroadToName } from "@ep0ch/outline-core/outline-location";
import { homedir, hostname } from "node:os";
import { hostLive, hostSocketOf, outlinesDir, resolveTarget, type Target } from "./discover";
import { hostRequest, type HostedOutline, OUTLINE_NAME } from "./socket";
import type { OutlineAbout } from "@ep0ch/outline-core/protocol";
import { actorLabel } from "@ep0ch/outline-core/attribution";
import { everyOutline, forwardTo, remoteArgs } from "./machine";
import type { HomeArgs, HomeChoice } from "./home";

/** `machine`: `--machine <ssh-name>`, the host that machine's, through its forward (else the one rule: runOutlineCommand). */
export type OutlineCommand = { machine?: string } & (
  | { op: "list"; json: boolean; all?: boolean; lines?: boolean; archived?: boolean }
  | { op: "attach"; name: string; json: boolean; create?: boolean; noCreate?: string | true }
  | { op: "create"; name: string; json: boolean }
  | { op: "import"; path: string; name: string; json: boolean }
  | { op: "stop"; name: string; json: boolean }
  | { op: "delete"; name: string; yes: boolean; json: boolean }
  | { op: "archive" | "unarchive"; name: string; json: boolean }
  | { op: "init"; name?: string; json: boolean; create?: boolean; noCreate?: string | true }
  | { op: "status"; json: boolean });

export const OUTLINE_USAGE = "ep0ch outline list [--all] [--archived] [--lines] | attach <name> [--create] | create <name> | import <database.sqlite> <name> | stop <name> | archive <name> | unarchive <name> | delete <name> [--yes]   (each with --json and --machine <ssh-name>); ep0ch init [<name>] [--create]";

/** `args` after `outline` (or `["status", …]`, `["init", …]`): the command, or why it isn't one. */
export function parseOutlineArgs(argsIn: readonly string[], cwd = process.cwd()): OutlineCommand | { error: string } {
  const at = argsIn.indexOf("--machine");
  const machine = at >= 0 ? argsIn[at + 1] : undefined;
  if (at >= 0 && (!machine || machine.startsWith("-"))) return { error: "--machine needs a machine: an ssh config name (a Host in ~/.ssh/config)" };
  if (machine !== undefined && !isMachineName(machine)) return { error: `--machine ${JSON.stringify(machine)} isn't an ssh config name` };
  const parsed = parseCommand(at >= 0 ? argsIn.filter((_, i) => i !== at && i !== at + 1) : argsIn, cwd);
  return "error" in parsed || !machine ? parsed : { ...parsed, machine };
}

function parseCommand(args: readonly string[], cwd: string): OutlineCommand | { error: string } {
  const json = args.includes("--json"), yes = args.includes("--yes"), create = args.includes("--create") ? { create: true } : {};
  const no = noCreateOf(args), noCreate = no === undefined ? {} : { noCreate: no };
  const words = args.filter(a => !a.startsWith("--"));
  const [op, ...rest] = words;
  const badName = (name: string) => OUTLINE_NAME.test(name) ? null : { error: `"${name}" isn't an outline name: lowercase letters, digits and hyphens, up to 32 (${OUTLINE_NAME.source})` };
  const named = (n: number) => {
    if (rest.length !== n) return { error: `outline ${op} takes ${n === 1 ? "<name>" : "<database.sqlite> <name>"}; ${OUTLINE_USAGE}` };
    return badName(rest[n - 1]!);
  };
  switch (op) {
    case "status": return rest.length ? { error: "status takes no arguments" } : { op: "status", json };
    case "list": {
      if (rest.length) return { error: "outline list takes no arguments" };
      const all = args.includes("--all"), lines = args.includes("--lines"), archived = args.includes("--archived");
      return { op: "list", json, ...(all ? { all } : {}), ...(lines ? { lines } : {}), ...(archived ? { archived } : {}) };
    }
    case "init": {
      if (rest.length > 1) return { error: "init takes [<name>]" };
      if (rest[0]) { const bad = badName(rest[0]); if (bad) return bad; }
      return { op: "init", ...(rest[0] ? { name: rest[0] } : {}), json, ...create, ...noCreate };
    }
    case "attach": { const bad = named(1); return bad ?? { op, name: rest[0]!, json, ...create, ...noCreate }; }
    case "create": case "stop": case "archive": case "unarchive": { const bad = named(1); return bad ?? { op, name: rest[0]!, json }; }
    case "delete": { const bad = named(1); return bad ?? { op, name: rest[0]!, yes, json }; }
    case "import": { const bad = named(2); return bad ?? { op, path: resolve(cwd, rest[0]!), name: rest[1]!, json }; }
    default: return { error: op ? `unknown outline command ${op}; ${OUTLINE_USAGE}` : OUTLINE_USAGE };
  }
}

const flags = (o: HostedOutline) => [o.open ? "open" : "closed", ...(o.default ? ["default"] : [])].join(" · ");
/** An outline an agent made over MCP says who and why beside its row: `made by loki (claude-code@float-2): burps and links`. */
export const madeBy = (a: OutlineAbout | undefined) => a ? `made by ${actorLabel(a.createdBy)}: ${a.purpose}` : "";
export function formatOutlines(outlines: readonly HostedOutline[]): string {
  if (!outlines.length) return `no outlines in ${outlinesDir()}`;
  const w = Math.max(...outlines.map(o => o.name.length));
  return outlines.map(o => `${o.name.padEnd(w)}  ${flags(o).padEnd(14)}  ${o.database}${o.about ? `\n${"".padEnd(w + 18)}${madeBy(o.about)}` : ""}`).join("\n");
}

/** What `delete` does to this outline, in words, before it's done (in its host's outlines folder, on its machine). */
export function deletionPlan(o: HostedOutline, machine?: string): string {
  return `move the outline "${o.name}" (its database and its folder) to ${join(dirname(o.database), ".deleted")}/${machine ? ` on ${machine}` : ""}; nothing is erased`;
}

/** The host's socket: EP0CH_SOCKET when it names one outright, else this machine's. */
export function hostSocket(env: Record<string, string | undefined> = process.env): string {
  return env.EP0CH_SOCKET || hostSocketOf(env);
}

/**
 * Names `folder`'s outline: writes `<folder>/.ep0ch` (`ws = "<name>"`, and `machine = "<ssh-name>"` for one on another
 * machine), beside and renamed over so a reader never sees half. Refuses to replace one that names another outline
 * unless `replace`.
 */
export function writeDotEp0ch(folder: string, name: string, replace = false, machine?: string): string {
  const file = join(resolve(folder), DOT_EP0CH);
  const text = formatDotEp0ch(name, machine);
  let current: string | undefined;
  try { current = readFileSync(file, "utf8"); } catch { current = undefined; }
  if (current === text) return file;
  if (current !== undefined && !replace) throw new Error(`${file} already names an outline; it was left as it is`);
  writeFileSync(`${file}.${process.pid}.tmp`, text, { mode: 0o644 });
  renameSync(`${file}.${process.pid}.tmp`, file);
  return file;
}

/**
 * `ep0ch init [<name>]`: names this folder's outline. The name defaults to the folder's guess (its repository's
 * name, else its own); the outline is attached, created when nobody has it yet (on another machine only with
 * `create`: `--create`), and `.ep0ch` written in the guessed folder (or here, with a name given).
 */
export async function initHere(name: string | undefined, path: string, cwd = process.cwd(), machine?: string, create = false, noCreate?: string | true): Promise<{ name: string; created: boolean; file: string }> {
  const target = resolveTarget([], { ...process.env, EP0CH_WS: "" }, cwd);
  if ("error" in target) throw new Error(target.error);
  const guess = "unnamed" in target ? target.guess : undefined;
  const chosen = name ?? guess?.name;
  if (!chosen) {
    throw new Error("outline" in target ? `this folder already names "${target.outline}" (${target.why}); pass a name to change it` : `${cwd} is too broad to name an outline after; name one: ep0ch init <name>`);
  }
  const folder = name ? cwd : guess!.folder;
  // $HOME, / or a folder right under / would name every folder below it.
  if (tooBroadToName(resolve(folder), process.env.HOME || homedir())) throw new Error(`${folder} is too broad to name an outline for every folder below it; run ep0ch init in a project folder`);
  const r = await attachOutline(path, chosen, { ...(machine ? { machine } : {}), create: mayCreate({ ...(machine ? { machine } : {}), create, noCreate: !!noCreate }), how: "init", ...(typeof noCreate === "string" ? { via: noCreate } : {}) });
  return { name: chosen, created: r.created, file: writeDotEp0ch(folder, chosen, true, machine) };
}

/**
 * Runs a parsed command other than an interactive `attach` (main opens the door for that). Resolves to the
 * exit code. `ask` confirms a delete; without a terminal and without `--yes`, a delete is refused.
 */
export async function runOutlineCommand(cmdIn: OutlineCommand, out = console.log, err = console.error,
  ask: (question: string) => Promise<boolean> = confirm): Promise<number> {
  // Every outline the person can open from here: this machine's host's, then each machine they've opened (as the home
  // base lists them). A machine whose forward isn't up is listed without outlines: nothing is started.
  if (cmdIn.op === "list" && cmdIn.all) {
    if (cmdIn.machine) { err("ep0ch: outline list --all lists every machine already; leave out --machine"); return 2; }
    const every = await everyOutline(hostSocket());
    if (cmdIn.json) out(JSON.stringify(every, null, 2));
    else if (cmdIn.lines) for (const o of every) out([o.name ?? "", o.machine ?? "", o.problem ?? ""].join("\t"));
    else for (const o of every) out(`${(o.name ?? "·").padEnd(24)}  ${o.machine ?? "this machine"}${o.problem ? `  (${o.problem})` : ""}`);
    return 0;
  }
  let cmd = cmdIn;
  // Which host, by the one rule (resolveTarget): --machine, EP0CH_SOCKET, EP0CH_MACHINE, this folder's .ep0ch. `status`
  // is this machine's host unless --machine names another (what another machine asks of it: src/machine.ts there).
  let path = hostSocket(), machine = cmd.machine;
  if (cmd.op !== "status" || cmd.machine) {
    const t = resolveTarget(cmd.machine ? ["--machine", cmd.machine] : []);
    if ("error" in t) { err(`ep0ch: ${t.error}`); return 1; }
    path = t.path; machine = t.machine;
  }
  if (machine) {
    try { path = (await forwardTo(machine)).socket; }
    catch (e) { err(`ep0ch: can't reach the outline host on ${machine}: ${(e as Error).message}`); return 1; }
  }
  cmd = machine ? { ...cmd, machine } : cmd;
  const status = await hostLive(path);
  if (!status) { err(`ep0ch: no outline host answers at ${path}; start it (systemctl --user start outliner-host, or bun packages/outliner/src/host-main.ts)`); return 1; }
  const on = cmd.machine ? ` on ${cmd.machine}` : "";
  const print = (value: unknown, text: string) => out(cmd.json ? JSON.stringify(value, null, 2) : text);
  try {
    switch (cmd.op) {
      case "status": {
        const list = await hostRequest<{ defaultOutline?: string; outlines: HostedOutline[] }>(path, "outlines.list");
        const open = list.outlines.filter(o => o.open).map(o => o.name);
        const folder = cmd.machine ? (list.outlines[0] ? dirname(list.outlines[0].database) : null) : outlinesDir();
        print({ socket: status.socket, folder, open, outlines: list.outlines, ...(cmd.machine ? { machine: cmd.machine } : {}) },
          [`host      ${status.socket}${on}`, `outlines  ${folder ?? "?"}${on} (${list.outlines.length})`, `open      ${open.join(", ") || "none"}`].join("\n"));
        return 0;
      }
      case "list": {
        const list = await hostRequest<{ defaultOutline?: string; outlines: HostedOutline[] }>(path, "outlines.list");
        if (cmd.lines) { for (const o of list.outlines) out([o.name, cmd.machine ?? "", ""].join("\t")); return 0; }
        if (cmd.archived) {
          const archived = (list as { archived?: { name: string; about?: OutlineAbout }[] }).archived ?? [];
          print({ archived }, archived.length ? archived.map(o => `${o.name}${o.about ? `  ${madeBy(o.about)}` : ""}`).join("\n") : "nothing is archived");
          return 0;
        }
        print(list, formatOutlines(list.outlines));
        return 0;
      }
      case "init": {
        const r = await initHere(cmd.name, path, process.cwd(), cmd.machine, !!cmd.create, cmd.noCreate);
        print(r, `${r.created ? "created" : "picked"} outline ${r.name}${on}; ${r.file} names it`);
        return 0;
      }
      case "attach": {
        const r = await attachOutline(path, cmd.name, { ...(cmd.machine ? { machine: cmd.machine } : {}), create: mayCreate({ ...(cmd.machine ? { machine: cmd.machine } : {}), create: !!cmd.create, noCreate: !!cmd.noCreate }), how: "attach", ...(typeof cmd.noCreate === "string" ? { via: cmd.noCreate } : {}) });
        print(r, `${r.created ? "created" : "attached"} outline ${cmd.name}${on}`);
        return 0;
      }
      case "create": {
        const r = await hostRequest<HostedOutline>(path, "outlines.create", { name: cmd.name });
        print(r, `created outline ${r.name}${on}`);
        return 0;
      }
      case "import": {
        const r = await hostRequest<HostedOutline & { imported: { blocks: number; properties: number; pageAddresses: number; workIds: number } }>(path, "outlines.import", { path: cmd.path, name: cmd.name }, 600_000);
        print(r, `imported ${cmd.path}${cmd.machine ? ` (a file on ${cmd.machine})` : ""} as outline ${r.name}${on}: ${r.imported.blocks} blocks, ${r.imported.properties} properties, ${r.imported.pageAddresses} page addresses, ${r.imported.workIds} work ids`);
        return 0;
      }
      case "stop": {
        const r = await hostRequest<HostedOutline>(path, "outlines.close", { name: cmd.name });
        print(r, `stopped outline ${r.name}; its database is released until its next request`);
        return 0;
      }
      case "archive": case "unarchive": {
        const r = await hostRequest<{ name: string; archived: boolean; movedTo: string }>(path, `outlines.${cmd.op}`, { name: cmd.name });
        print(r, r.archived ? `archived outline ${r.name}${on}: out of every list, its database kept in ${r.movedTo}; \`ep0ch outline unarchive ${r.name}\` brings it back` : `restored outline ${r.name}${on}`);
        return 0;
      }
      case "delete": {
        const list = await hostRequest<{ outlines: HostedOutline[] }>(path, "outlines.list");
        const target = list.outlines.find(o => o.name === cmd.name);
        if (!target) { err(`ep0ch: no outline named "${cmd.name}" on this host${on}`); return 1; }
        const plan = deletionPlan(target, cmd.machine);
        if (!cmd.yes && !(await ask(`This will ${plan}. Delete? [y/N] `))) { err(`ep0ch: not deleted (pass --yes to ${plan})`); return 1; }
        const r = await hostRequest<{ name: string; movedTo: string }>(path, "outlines.delete", { name: cmd.name });
        print(r, `moved outline ${r.name} to ${r.movedTo}`);
        return 0;
      }
    }
  } catch (e) {
    err(`ep0ch: ${(e as Error).message}`);
    return 1;
  }
}

/**
 * Whether a door (or `outline attach`, `init`) may make the outline it names when nobody has it yet: outline-core's
 * `mayCreate` (PIE-545), from its flags: `--create`, and `--no-create[=<ssh-name>]`, which `ep0ch --remote <ssh-name>`
 * gives the door on that machine (where the outline is local), naming how it was reached so its refusal says the
 * command to run from there.
 */
export function mayCreateFrom(args: readonly string[], machine?: string): boolean {
  return mayCreate({ ...(machine ? { machine } : {}), create: args.includes("--create"), noCreate: !!noCreateOf(args) });
}

/** `--no-create` (true) or `--no-create=<ssh-name>` (that name) in `args`, else undefined. */
export function noCreateOf(args: readonly string[]): string | true | undefined {
  const a = args.find(x => x === "--no-create" || x.startsWith("--no-create="));
  if (a === undefined) return undefined;
  const via = a.slice("--no-create=".length);
  return a.includes("=") && isMachineName(via) ? via : true;
}

/** How a refused command is run again, as the person ran it: a door, `--remote`, `outline attach` or `init`. */
type How = "door" | "remote" | "attach" | "init";

/**
 * What the door says when `machine` (none: this one) has no outline `outline` and nothing may make it: outline-core's
 * `missingOutline`, with the commands as this person runs them. `via`: this machine was reached as `ep0ch --remote
 * <via>`, so that's the command to say.
 */
export function doorMissing(o: { outline: string; machine?: string; localHas?: boolean; how?: How; via?: string }): string {
  const { outline, machine } = o, how = o.how ?? "door", m = machine ? ` --machine ${machine}` : "";
  const ep0ch = o.via ? `ep0ch --remote ${o.via}` : "ep0ch";
  const create = how === "attach" ? `${ep0ch} outline attach ${outline}${m} --create`
    : how === "init" ? `${ep0ch} init ${outline}${m} --create`
    : how === "remote" ? `ep0ch --remote ${machine} --ws ${outline} --create`
    : `${ep0ch}${m} --ws ${outline} --create`;
  return missingOutline({ outline, ...(machine ? { machine } : {}), host: hostname(), ...(o.localHas !== undefined ? { localHas: o.localHas } : {}),
    openHere: `ep0ch --here --ws ${outline}`, create });
}

const viaOf = (args: readonly string[]) => { const v = noCreateOf(args); return typeof v === "string" ? { via: v } : {}; };

/** The outlines the host at `path` has, or null when it doesn't answer. */
export async function outlinesAt(path: string): Promise<string[] | null> {
  return (await hostLive(path, 5000))?.outlines ?? null;
}

/**
 * Attach to `name` on the host at `path`: made when nobody has it only when `create` (mayCreate); otherwise one nobody
 * has is refused with what to run (missingOutline), and nothing is made.
 */
export async function attachOutline(path: string, name: string, o: { machine?: string; create: boolean; how?: How; via?: string }): Promise<{ outline: HostedOutline; created: boolean }> {
  if (!o.create) {
    const has = await outlinesAt(path);
    if (has && !has.includes(name)) {
      const local = o.machine ? await outlinesAt(hostSocketOf()) : null;
      throw new Error(doorMissing({ outline: name, ...(o.machine ? { machine: o.machine, localHas: !!local?.includes(name) } : {}), ...(o.how ? { how: o.how } : {}), ...(o.via ? { via: o.via } : {}) }));
    }
  }
  return hostRequest<{ outline: HostedOutline; created: boolean }>(path, "outlines.attach", { name, create: o.create });
}

/**
 * Before the door opens a session on an outline: attach to it, creating it when nobody has yet and it may (mayCreate:
 * on this machine, like `herdr --session <name>`; on another only with `--create`). Resolves to whether it was created,
 * so the door can say so; one it may not make is refused with what to run.
 */
export async function attachTarget(target: { path: string; outline?: string; attach?: boolean; machine?: string }, args: readonly string[] = []): Promise<{ created: boolean }> {
  if (!target.attach || !target.outline) return { created: false };
  const r = await attachOutline(target.path, target.outline, { ...(target.machine ? { machine: target.machine } : {}), create: mayCreateFrom(args, target.machine), ...viaOf(args) });
  return { created: r.created };
}

/** A line read from the terminal, asked on stderr (the door's stdout is its screen). */
async function askLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return await rl.question(question); } finally { rl.close(); }
}

/** A yes/no question on the terminal; no terminal means no. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  return /^y(es)?$/i.test((await askLine(question)).trim());
}

/** What to run when a folder names no outline and nobody can be asked (no terminal). */
export function unnamedHelp(target: Extract<Target, { unnamed: string }>): string {
  return `${target.unnamed}. Name one: ep0ch init${target.guess ? ` (starts "${target.guess.name}", writing ${target.guess.folder}/.ep0ch)` : " <name>"}, ` +
    "ep0ch --ws <name> (ep0ch outline list), or ep0ch outline import <database.sqlite> <name>";
}

/**
 * Before a door opens: the outline it opens, by the rule; when the folder names none, `home` (the home base, src/home.ts,
 * which main passes in) opens in this terminal and the door goes on with what was chosen there (`--ws <name>`, and
 * `--machine` for one on another machine; a choice on this machine drops an EP0CH_MACHINE the shell had, so the door
 * that follows is this machine's). Resolves to the arguments to open with and what to say once the door is up, or what
 * to print (an error, or null when they quit).
 *
 * An outline named on another machine that the machine doesn't have is never made there (PIE-545): the home base opens
 * saying so, with the choices (the one on this machine, making it there, cancel); without a terminal it is an error
 * with the commands. `--create` makes it there, on purpose, here in the person's terminal, and goes no further (a
 * session started now never makes it again).
 */
export async function nameTheOutline(args: string[], interactive: boolean,
  home: (a: HomeArgs) => Promise<HomeChoice | null>): Promise<{ args: string[]; notice?: string } | { error: string } | null> {
  const target = resolveTarget(args);
  if ("error" in target) return { error: target.error };
  // Named: said explicitly from here on (the machine too), so a session started now (or its next daemon) opens this
  // outline whatever its folder's .ep0ch or EP0CH_MACHINE says later.
  const on = target.machine && !args.includes("--machine") ? ["--machine", target.machine] : [];
  // The forward is started here, in the person's terminal, where ssh can ask their agent for the key; a session's
  // daemon (which outlives the terminal, and its agent) then finds it up. (The home base connects a machine it's
  // given itself, in this same terminal.)
  if (target.machine && !("unnamed" in target)) {
    let socket: string;
    try { socket = (await forwardTo(target.machine)).socket; } catch (e) { return { error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }; }
    const named = [...(args.includes("--ws") ? args : [...args, "--ws", target.outline]), ...on].filter(a => a !== "--create");
    if (args.includes("--create")) {
      try {
        const r = await attachOutline(socket, target.outline, { machine: target.machine, create: true });
        return { args: named, ...(r.created ? { notice: `created outline ${target.outline} on ${target.machine} (--create)` } : {}) };
      } catch (e) { return { error: `can't create the outline ${target.outline} on ${target.machine}: ${(e as Error).message}` }; }
    }
    const missing = await missingOn(socket, target.outline, target.machine, "door");
    if (!missing) return { args: named };
    if (!interactive) return { error: missing.text };
    const chosen = await home({ folder: process.cwd(), machine: target.machine, missing: { outline: target.outline, machine: target.machine } });
    return chosen ? fromHome(args, chosen) : null;
  }
  if (!("unnamed" in target)) {
    // `--no-create` (a door `--remote` started here): one this machine doesn't have is said before a session starts.
    const has = mayCreateFrom(args) ? null : await outlinesAt(target.path);
    if (has && !has.includes(target.outline)) return { error: doorMissing({ outline: target.outline, ...viaOf(args) }) };
    return { args: [...(args.includes("--ws") ? args : [...args, "--ws", target.outline]), ...on] };
  }
  if (!interactive) return { error: unnamedHelp(target) };
  const chosen = await home({
    folder: target.folder, ...(target.guess ? { guess: target.guess } : {}),
    ...(target.machine ? { machine: target.machine } : { socket: target.path }),
  });
  return chosen ? fromHome(args, chosen) : null;
}

/** `machine` has no `outline` (its host at `socket` answered without it): what to say. Null when it has it, or can't say. */
async function missingOn(socket: string, outline: string, machine: string, how: How): Promise<{ text: string } | null> {
  const has = await outlinesAt(socket);
  if (!has || has.includes(outline)) return null;
  const local = await outlinesAt(hostSocketOf());
  return { text: doorMissing({ outline, machine, localHas: !!local?.includes(outline), how }) };
}

/** The door's arguments for what the home base chose, and what to say once it's up. */
function fromHome(args: readonly string[], chosen: HomeChoice): { args: string[]; notice: string } {
  if (!chosen.machine) delete process.env.EP0CH_MACHINE;
  const who = chosen.by ? `an agent (${chosen.by}) opened` : "opened";
  const drop = new Set(["--machine", "--ws"]);
  // One on this machine is said as --here: a folder's .ep0ch (or EP0CH_MACHINE) putting that name on a machine doesn't
  // take it back there.
  return {
    args: [...args.filter((a, i) => a !== "--create" && a !== "--here" && !drop.has(a) && !drop.has(args[i - 1] ?? "")), "--ws", chosen.outline, ...(chosen.machine ? ["--machine", chosen.machine] : ["--here"])],
    notice: `${who} ${chosen.outline}${chosen.machine ? ` on ${chosen.machine}` : ""} from the home base${chosen.wrote ? ` · ${chosen.wrote} names it now` : ""}`,
  };
}

/**
 * Before `ep0ch --remote <machine> [door flags]` hands this terminal to the door there: the door flags it runs with
 * (remoteArgs). A door named an outline that machine doesn't have would make it there (it is local to that door), so,
 * as for `--machine` (PIE-545), it is asked first, through the machine's forward: missing, the home base opens here
 * with the choices (the one on this machine opens here, a door of this machine's; one made or chosen there goes on
 * there), or, without a terminal, the commands. The door there is passed `--no-create` all the same (it never makes
 * one unless `--create` was given), for when the forward can't be asked. Resolves to the flags for the door there,
 * a door to open here instead, or what to print (an error, or null when they quit).
 */
export async function nameRemoteOutline(machine: string, rest: readonly string[], interactive: boolean,
  home: (a: HomeArgs) => Promise<HomeChoice | null>): Promise<{ remote: string[] } | { args: string[]; notice?: string } | { error: string } | null> {
  const there = remoteArgs(machine, rest, resolveTarget(rest));
  if (there.includes("--create")) return { remote: there };
  const guarded = [...there, `--no-create=${machine}`];
  // A command, not a door: `ep0ch --remote <m> status` (session …, find …) is that command, run there. The ones that
  // could make an outline there (`outline attach`, `init`) are given --no-create too, and refuse there with what to run.
  if (there.length && !there[0]!.startsWith("-")) {
    const makes = there[0] === "init" || (there[0] === "outline" && there[1] === "attach");
    return { remote: makes ? guarded : there };
  }
  const at = there.indexOf("--ws"), outline = at >= 0 ? there[at + 1] : undefined;
  if (!outline) return { remote: guarded };
  let socket: string;
  try { socket = (await forwardTo(machine)).socket; } catch { return { remote: guarded }; }
  const missing = await missingOn(socket, outline, machine, "remote");
  if (!missing) return { remote: guarded };
  if (!interactive) return { error: missing.text };
  const chosen = await home({ folder: process.cwd(), machine, missing: { outline, machine } });
  if (!chosen) return null;
  if (chosen.machine === machine) return { remote: ["--ws", chosen.outline, ...guarded.filter((a, i) => a !== "--ws" && guarded[i - 1] !== "--ws")] };
  return fromHome(rest, chosen);
}

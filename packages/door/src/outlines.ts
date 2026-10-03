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
import { DOT_EP0CH, formatDotEp0ch, isMachineName, tooBroadToName } from "@ep0ch/outline-core/outline-location";
import { homedir } from "node:os";
import { hostLive, hostSocketOf, outlinesDir, resolveTarget, type Target } from "./discover";
import { hostRequest, type HostedOutline, OUTLINE_NAME } from "./socket";
import { everyOutline, forwardTo } from "./machine";
import type { HomeArgs, HomeChoice } from "./home";

/** `machine`: `--machine <ssh-name>`, the host that machine's, through its forward (else the one rule: runOutlineCommand). */
export type OutlineCommand = { machine?: string } & (
  | { op: "list"; json: boolean; all?: boolean; lines?: boolean }
  | { op: "attach"; name: string; json: boolean }
  | { op: "create"; name: string; json: boolean }
  | { op: "import"; path: string; name: string; json: boolean }
  | { op: "stop"; name: string; json: boolean }
  | { op: "delete"; name: string; yes: boolean; json: boolean }
  | { op: "init"; name?: string; json: boolean }
  | { op: "status"; json: boolean });

export const OUTLINE_USAGE = "ep0ch outline list [--all] [--lines] | attach <name> | create <name> | import <database.sqlite> <name> | stop <name> | delete <name> [--yes]   (each with --json and --machine <ssh-name>); ep0ch init [<name>]";

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
  const json = args.includes("--json"), yes = args.includes("--yes");
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
      const all = args.includes("--all"), lines = args.includes("--lines");
      return { op: "list", json, ...(all ? { all } : {}), ...(lines ? { lines } : {}) };
    }
    case "init": {
      if (rest.length > 1) return { error: "init takes [<name>]" };
      if (rest[0]) { const bad = badName(rest[0]); if (bad) return bad; }
      return { op: "init", ...(rest[0] ? { name: rest[0] } : {}), json };
    }
    case "attach": case "create": case "stop": { const bad = named(1); return bad ?? { op, name: rest[0]!, json }; }
    case "delete": { const bad = named(1); return bad ?? { op, name: rest[0]!, yes, json }; }
    case "import": { const bad = named(2); return bad ?? { op, path: resolve(cwd, rest[0]!), name: rest[1]!, json }; }
    default: return { error: op ? `unknown outline command ${op}; ${OUTLINE_USAGE}` : OUTLINE_USAGE };
  }
}

const flags = (o: HostedOutline) => [o.open ? "open" : "closed", ...(o.default ? ["default"] : [])].join(" · ");
export function formatOutlines(outlines: readonly HostedOutline[]): string {
  if (!outlines.length) return `no outlines in ${outlinesDir()}`;
  const w = Math.max(...outlines.map(o => o.name.length));
  return outlines.map(o => `${o.name.padEnd(w)}  ${flags(o).padEnd(14)}  ${o.database}`).join("\n");
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
 * name, else its own); the outline is attached, created when nobody has it yet, and `.ep0ch` written in the
 * guessed folder (or here, with a name given).
 */
export async function initHere(name: string | undefined, path: string, cwd = process.cwd(), machine?: string): Promise<{ name: string; created: boolean; file: string }> {
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
  const r = await hostRequest<{ created: boolean }>(path, "outlines.attach", { name: chosen, create: true });
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
        print(list, formatOutlines(list.outlines));
        return 0;
      }
      case "init": {
        const r = await initHere(cmd.name, path, process.cwd(), cmd.machine);
        print(r, `${r.created ? "created" : "picked"} outline ${r.name}${on}; ${r.file} names it`);
        return 0;
      }
      case "attach": {
        const r = await hostRequest<{ outline: HostedOutline; created: boolean }>(path, "outlines.attach", { name: cmd.name, create: true });
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
 * Before the door opens a session on an outline: attach to it, creating it when nobody has yet (like
 * `herdr --session <name>`). Resolves to whether it was created, so the door can say so.
 */
export async function attachTarget(target: { path: string; outline?: string; attach?: boolean }): Promise<{ created: boolean }> {
  if (!target.attach || !target.outline) return { created: false };
  const r = await hostRequest<{ created: boolean }>(target.path, "outlines.attach", { name: target.outline, create: true });
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
    try { await forwardTo(target.machine); } catch (e) { return { error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }; }
  }
  if (!("unnamed" in target)) return { args: [...(args.includes("--ws") ? args : [...args, "--ws", target.outline]), ...on] };
  if (!interactive) return { error: unnamedHelp(target) };
  const chosen = await home({
    folder: target.folder, ...(target.guess ? { guess: target.guess } : {}),
    ...(target.machine ? { machine: target.machine } : { socket: target.path }),
  });
  if (!chosen) return null;
  if (!chosen.machine) delete process.env.EP0CH_MACHINE;
  const who = chosen.by ? `an agent (${chosen.by}) opened` : "opened";
  return {
    args: [...args.filter((a, i) => a !== "--machine" && args[i - 1] !== "--machine"), "--ws", chosen.outline, ...(chosen.machine ? ["--machine", chosen.machine] : [])],
    notice: `${who} ${chosen.outline}${chosen.machine ? ` on ${chosen.machine}` : ""} from the home base${chosen.wrote ? ` · ${chosen.wrote} names it now` : ""}`,
  };
}

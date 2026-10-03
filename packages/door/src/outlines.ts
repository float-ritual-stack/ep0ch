// `ep0ch outline …`, `ep0ch init` and `ep0ch status`: the outline host's outlines, like `herdr session …` (PIE-466),
// named by folder (PIE-530). Every command asks the host itself (`outlines.*`, each on its own short connection).
// `attach` opens the door on the outline, the same as `ep0ch --ws <name>`. `--json` prints the host's answer for
// agents. Nothing here reads or writes an outline's notes.
//
// A folder that names no outline (no --ws, no EP0CH_WS, no .ep0ch) gets init, pick or import when the door opens
// there (`chooseOutline`): never a guess taken silently. Each writes `.ep0ch`, so the next `ep0ch` there is direct.
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { dirname, join, resolve } from "node:path";
import { DOT_EP0CH, formatDotEp0ch, freeOutlineName as freeName, isMachineName, isOutlineName, slugifyOutlineName, tooBroadToName } from "@ep0ch/outline-core/outline-location";
import { homedir } from "node:os";
import { hostLive, hostSocketOf, outlinesDir, resolveTarget, type Target } from "./discover";
import { hostRequest, type HostedOutline, OUTLINE_NAME } from "./socket";
import { forwardTo } from "./machine";

/** `machine`: the host is that machine's, through its forward (`--machine <ssh-name>`, else EP0CH_MACHINE). */
export type OutlineCommand = { machine?: string } & (
  | { op: "list"; json: boolean }
  | { op: "attach"; name: string; json: boolean }
  | { op: "create"; name: string; json: boolean }
  | { op: "import"; path: string; name: string; json: boolean }
  | { op: "stop"; name: string; json: boolean }
  | { op: "delete"; name: string; yes: boolean; json: boolean }
  | { op: "init"; name?: string; json: boolean }
  | { op: "status"; json: boolean });

export const OUTLINE_USAGE = "ep0ch outline list | attach <name> | create <name> | import <database.sqlite> <name> | stop <name> | delete <name> [--yes]   (each with --json and --machine <ssh-name>); ep0ch init [<name>]";

/** `args` after `outline` (or `["status", …]`, `["init", …]`): the command, or why it isn't one. */
export function parseOutlineArgs(argsIn: readonly string[], cwd = process.cwd(), env: Record<string, string | undefined> = process.env): OutlineCommand | { error: string } {
  const at = argsIn.indexOf("--machine");
  const machine = at >= 0 ? argsIn[at + 1] : env.EP0CH_MACHINE?.trim() || undefined;
  if (at >= 0 && (!machine || machine.startsWith("-"))) return { error: "--machine needs a machine: an ssh config name (a Host in ~/.ssh/config)" };
  if (machine !== undefined && !isMachineName(machine)) return { error: `${at >= 0 ? "--machine" : "EP0CH_MACHINE"} ${JSON.stringify(machine)} isn't an ssh config name` };
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
    case "list": return rest.length ? { error: "outline list takes no arguments" } : { op: "list", json };
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
export async function runOutlineCommand(cmd: OutlineCommand, out = console.log, err = console.error,
  ask: (question: string) => Promise<boolean> = confirm): Promise<number> {
  let path = hostSocket();
  if (cmd.machine) {
    try { path = (await forwardTo(cmd.machine)).socket; }
    catch (e) { err(`ep0ch: can't reach the outline host on ${cmd.machine}: ${(e as Error).message}`); return 1; }
  }
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
        print(r, `imported ${cmd.path}${on} as outline ${r.name}: ${r.imported.blocks} blocks, ${r.imported.properties} properties, ${r.imported.pageAddresses} page addresses, ${r.imported.workIds} work ids`);
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

/** One line of a prompt, answered. */
export type Ask = (question: string) => Promise<string>;

/**
 * A folder that names no outline: ask, on the terminal, whether to start one (named by the folder's guess, or
 * typed), pick one of the host's, or import a database; write `.ep0ch` where the folder may be named. Resolves to
 * the outline's name, or null when the person quits. Without a terminal it never asks: the caller says what to run.
 */
export async function chooseOutline(target: Extract<Target, { unnamed: string }>, ask: Ask, say: (line: string) => void): Promise<string | null> {
  const host = await hostLive(target.path);
  if (!host) throw new Error(`${target.unnamed}, and no outline host answers at ${target.path} to start or pick one`);
  const where = target.guess ? `writes ${target.guess.folder}/.ep0ch` : "this time only: the folder is too broad to name";
  const offered = target.guess ? freeName(target.guess.name, host.outlines) : undefined;
  say(`No outline is named for ${target.folder} (no --ws, no EP0CH_WS, no .ep0ch here or above).`);
  say(`  n) new outline${offered ? ` "${offered}"` : ""} (${where})`);
  host.outlines.forEach((name, i) => say(`  ${i + 1}) ${name}`));
  say(`  i) import a database (.sqlite): a new outline from its notes, properties, pages and work ids`);
  say("  q) quit");
  for (;;) {
    const answer = (await ask(`Choose [n${host.outlines.length ? `, 1-${host.outlines.length}` : ""}, i, q]: `)).trim().toLowerCase();
    let name: string | undefined;
    if (answer === "q" || answer === "") return null;
    if (answer === "n") {
      name = (await ask(`Name${offered ? ` [${offered}]` : ""}: `)).trim() || offered;
      if (!name || !isOutlineName(name)) { say(`"${name ?? ""}" isn't an outline name: lowercase letters, digits and hyphens, up to 32`); continue; }
      if (host.outlines.includes(name)) { say(`there is already an outline named "${name}": pick it by its number`); continue; }
      await hostRequest(target.path, "outlines.create", { name });
      say(`created outline ${name}`);
    } else if (answer === "i" && target.remote) {
      say("import reads a file on the host's machine; run ep0ch outline import there");
      continue;
    } else if (answer === "i") {
      const file = (await ask("Database file: ")).trim().replace(/^~(?=\/)/, process.env.HOME ?? "~");
      if (!file) continue;
      const path = resolve(file);
      name = (await ask(`Name [${freeName(target.guess?.name ?? slugifyOutlineName(path.split("/").at(-1)!.replace(/\.sqlite$/, "")), host.outlines)}]: `)).trim()
        || freeName(target.guess?.name ?? slugifyOutlineName(path.split("/").at(-1)!.replace(/\.sqlite$/, "")), host.outlines);
      if (!isOutlineName(name)) { say(`"${name}" isn't an outline name`); continue; }
      try {
        const r = await hostRequest<{ imported: { blocks: number } }>(target.path, "outlines.import", { path, name }, 600_000);
        say(`imported ${path} as ${name} (${r.imported.blocks} blocks)`);
      } catch (e) { say(`not imported: ${(e as Error).message}`); continue; }
    } else if (/^\d+$/.test(answer) && host.outlines[Number(answer) - 1]) {
      name = host.outlines[Number(answer) - 1]!;
    } else {
      say(`"${answer}" isn't one of the choices`);
      continue;
    }
    if (target.guess) say(`${writeDotEp0ch(target.guess.folder, name)} names it`);
    return name;
  }
}


/** A line read from the terminal, asked on stderr (the door's stdout is its screen). */
export async function askLine(question: string): Promise<string> {
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
 * Before a door opens: the outline it opens, by the rule; when the folder names none, the person is asked (init,
 * pick or import) and the door goes on with `--ws <their choice>`. Resolves to the arguments to open with, or what
 * to print (an error, or null when they quit).
 */
export async function nameTheOutline(args: string[], interactive = !!process.stdin.isTTY, ask: Ask = askLine,
  say: (line: string) => void = line => console.error(line)): Promise<{ args: string[] } | { error: string } | null> {
  const target = resolveTarget(args);
  if ("error" in target) return { error: target.error };
  // Named: said explicitly from here on (the machine too), so a session started now (or its next daemon) opens this
  // outline whatever its folder's .ep0ch or EP0CH_MACHINE says later.
  const on = target.machine && !args.includes("--machine") ? ["--machine", target.machine] : [];
  if (!("unnamed" in target)) return { args: [...(args.includes("--ws") ? args : [...args, "--ws", target.outline]), ...on] };
  if (!interactive) return { error: unnamedHelp(target) };
  if (target.machine) {
    try { await forwardTo(target.machine); } catch (e) { return { error: `can't reach the outline host on ${target.machine}: ${(e as Error).message}` }; }
  }
  const name = await chooseOutline(target, ask, say);
  return name ? { args: [...args, "--ws", name, ...on] } : null;
}

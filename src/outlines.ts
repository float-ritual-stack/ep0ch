// `ep0ch outline …` and `ep0ch status`: the outline host's outlines, like `herdr session …` (PIE-466).
// Every command asks the host itself (`outlines.*` and `ping`, each on its own short connection); `attach`
// opens the door on the outline, the same as `ep0ch --ws <name>`. `--json` prints the host's answer for
// agents. Nothing here reads or writes an outline's notes.
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { hostLive, hostSocketOf, stateBase } from "./discover";
import { hostRequest, type HostedOutline, OUTLINE_NAME } from "./socket";

export type OutlineCommand =
  | { op: "list"; json: boolean }
  | { op: "attach"; name: string; json: boolean }
  | { op: "create"; name: string; json: boolean }
  | { op: "adopt"; path: string; name: string; root?: string; json: boolean }
  | { op: "stop"; name: string; json: boolean }
  | { op: "delete"; name: string; yes: boolean; json: boolean }
  | { op: "status"; json: boolean };

export const OUTLINE_USAGE = "ep0ch outline list | attach <name> | create <name> | adopt <path> <name> [--root <dir>] | stop <name> | delete <name> [--yes]   (each with --json)";

/** `args` after `outline` (or `["status", …]`): the command, or why it isn't one. */
export function parseOutlineArgs(args: readonly string[], cwd = process.cwd()): OutlineCommand | { error: string } {
  const json = args.includes("--json"), yes = args.includes("--yes");
  const rootAt = args.indexOf("--root");
  const root = rootAt >= 0 ? args[rootAt + 1] : undefined;
  if (rootAt >= 0 && (!root || root.startsWith("--"))) return { error: "--root needs a folder" };
  const words = args.filter((a, i) => !a.startsWith("--") && !(rootAt >= 0 && i === rootAt + 1));
  const [op, ...rest] = words;
  const named = (n: number) => {
    if (rest.length !== n) return { error: `outline ${op} takes ${n === 1 ? "<name>" : "<path> <name>"}; ${OUTLINE_USAGE}` };
    const name = rest[n - 1]!;
    return OUTLINE_NAME.test(name) ? null : { error: `"${name}" isn't an outline name: lowercase letters, digits and hyphens, up to 32 (${OUTLINE_NAME.source})` };
  };
  switch (op) {
    case "status": return rest.length ? { error: "status takes no arguments" } : { op: "status", json };
    case "list": return rest.length ? { error: "outline list takes no arguments" } : { op: "list", json };
    case "attach": case "create": case "stop": { const bad = named(1); return bad ?? { op, name: rest[0]!, json }; }
    case "delete": { const bad = named(1); return bad ?? { op, name: rest[0]!, yes, json }; }
    case "adopt": {
      const bad = named(2);
      if (bad) return bad;
      return { op, path: resolve(cwd, rest[0]!), name: rest[1]!, ...(root ? { root: resolve(cwd, root) } : {}), json };
    }
    default: return { error: op ? `unknown outline command ${op}; ${OUTLINE_USAGE}` : OUTLINE_USAGE };
  }
}

const flags = (o: HostedOutline) => [o.open ? "open" : "closed", ...(o.default ? ["default"] : []), ...(o.adopted ? ["adopted"] : [])].join(" · ");
export function formatOutlines(outlines: readonly HostedOutline[]): string {
  if (!outlines.length) return "no outlines on this host";
  const w = Math.max(...outlines.map(o => o.name.length));
  return outlines.map(o => `${o.name.padEnd(w)}  ${flags(o).padEnd(24)}  ${o.root ?? o.database}${o.problem ? `  (${o.problem})` : ""}`).join("\n");
}

/** What `delete` does to this outline, in words, before it's done. */
export function deletionPlan(o: HostedOutline, base = stateBase()): string {
  return o.adopted
    ? `unlink the adopted outline "${o.name}" from the host; its database stays where it lies, at ${o.database}`
    : `move the outline "${o.name}" (its database and side files) to ${resolve(base, "deleted")}/; nothing is erased`;
}

/** The host's socket: EP0CH_SOCKET when it is one (a tunnel to another machine's host), else this machine's. */
export function hostSocket(env: Record<string, string | undefined> = process.env): string {
  return env.EP0CH_SOCKET || hostSocketOf();
}

/**
 * Runs a parsed command other than an interactive `attach` (main opens the door for that). Resolves to the
 * exit code. `ask` confirms a delete; without a terminal and without `--yes`, a delete is refused.
 */
export async function runOutlineCommand(cmd: OutlineCommand, out = console.log, err = console.error,
  ask: (question: string) => Promise<boolean> = confirm): Promise<number> {
  const path = hostSocket();
  const status = await hostLive(path);
  if (!status) { err(`ep0ch: no outline host is running at ${path}; start it (pi-herdr-outliner: bun run host)`); return 1; }
  const print = (value: unknown, text: string) => out(cmd.json ? JSON.stringify(value, null, 2) : text);
  try {
    switch (cmd.op) {
      case "status": {
        const list = await hostRequest<{ defaultOutline?: string; outlines: HostedOutline[] }>(path, "outlines.list");
        const open = list.outlines.filter(o => o.open).map(o => o.name);
        print({ socket: status.socket, defaultOutline: status.defaultOutline ?? null, open, outlines: list.outlines },
          [`host      ${status.socket}`, `default   ${status.defaultOutline ?? "none"}`, `open      ${open.join(", ") || "none"}`,
            `outlines  ${list.outlines.length}`].join("\n"));
        return 0;
      }
      case "list": {
        const list = await hostRequest<{ defaultOutline?: string; outlines: HostedOutline[] }>(path, "outlines.list");
        print(list, formatOutlines(list.outlines));
        return 0;
      }
      case "attach": {
        const r = await hostRequest<{ outline: HostedOutline; created: boolean }>(path, "outlines.attach", { name: cmd.name, create: true });
        print(r, `${r.created ? "created" : "attached"} outline ${cmd.name}`);
        return 0;
      }
      case "create": {
        const r = await hostRequest<HostedOutline>(path, "outlines.create", { name: cmd.name });
        print(r, `created outline ${r.name}`);
        return 0;
      }
      case "adopt": {
        const r = await hostRequest<HostedOutline>(path, "outlines.adopt", { path: cmd.path, name: cmd.name, ...(cmd.root ? { root: cmd.root } : {}) });
        print(r, `adopted ${r.database} as outline ${r.name}${r.root ? ` (root ${r.root})` : ""}`);
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
        if (!target) { err(`ep0ch: no outline named "${cmd.name}" on this host`); return 1; }
        const plan = deletionPlan(target);
        if (!cmd.yes && !(await ask(`This will ${plan}. Delete? [y/N] `))) { err(`ep0ch: not deleted (pass --yes to ${plan})`); return 1; }
        const r = await hostRequest<{ name: string; adopted: boolean; movedTo?: string }>(path, "outlines.delete", { name: cmd.name });
        print(r, r.adopted ? `unlinked outline ${r.name}; its database stays at ${target.database}` : `moved outline ${r.name} to ${r.movedTo}`);
        return 0;
      }
    }
  } catch (e) {
    err(`ep0ch: ${(e as Error).message}`);
    return 1;
  }
}

/**
 * Before the door opens a session on a host outline: attach to it, creating it when there is none (like
 * `herdr --session <name>`). Resolves to whether it was created, so the door can say so.
 */
export async function attachTarget(target: { path: string; outline?: string; attach?: boolean }): Promise<{ created: boolean }> {
  if (!target.attach || !target.outline) return { created: false };
  const r = await hostRequest<{ created: boolean }>(target.path, "outlines.attach", { name: target.outline, create: true });
  return { created: r.created };
}

/** A yes/no question on the terminal; no terminal means no. */
async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = createInterface({ input: process.stdin, output: process.stderr });
  try { return /^y(es)?$/i.test((await rl.question(question)).trim()); } finally { rl.close(); }
}

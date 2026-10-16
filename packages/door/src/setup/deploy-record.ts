import { sessionPersona, whichOutline } from "@ep0ch/outline-core/outline-location";
import { configuredMachineName, hostMachineName } from "@ep0ch/outliner/machine-name";
import { disk } from "../discover";
import { hostRequest } from "../socket";
import { pluginCode, run } from "./facts";
import type { Facts } from "./model";

interface Note { id: string; revision: number; text: string }
type Env = Record<string, string | undefined>;

/** Install writes through its own host, even when the invoking folder names a different machine. */
export async function startDeployRecord(f: Facts, env: Env, folder: string, when: Date, creating: () => void) {
  const host = await hostRequest<{ defaultOutline?: string }>(f.host.socket, "outlines.list");
  const which = whichOutline({ env: env.EP0CH_WS, machineEnv: env.EP0CH_MACHINE, folder, home: f.home, fs: disk });
  const outline = which.kind === "named" && !which.machine ? which.name : host.defaultOutline;
  if (!outline) throw new Error("no outline named here or by the host; run install with EP0CH_WS=<served outline>");
  const actor = sessionPersona({ env, folder, fs: disk })?.name;
  const sessionId = env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_THREAD_ID;
  const provenance = actor ? { actorId: actor, sessionId } : undefined;
  const author = actor ? "agent" : "user";
  const request = <T>(action: string, params: Record<string, unknown> = {}) => hostRequest<T>(f.host.socket, action, { outline, ...params });
  const roots = await request<{ blocks: Note[] }>("blocks.query", { query: { where: "system-view=deploys machine=install" } });
  // Once a create is sent, a lost answer must never lead to another create for this run.
  creating();
  let parent = roots.blocks[0];
  if (!parent) parent = await request<Note>("create", { parentId: null, author, provenance,
    text: "Deploys [system-view::deploys] [machine::install] [type::virtual-branch] [query::type=deploy machine=install] [sort::created] [direction::desc]\n\nInstall runs, newest first. Copy this figure into the build log for the latest five:\n\n::graph-table\nquery: type=deploy machine=install\nsort: created\ndirection: desc\nlimit: 5\ncolumns: [title, created]\n::" });
  const machine = f.machineName?.chosen || configuredMachineName(env, f.host.folder) || hostMachineName();
  const heading = `Deploy ${when.toISOString()} on ${machine} [type::deploy] [machine::install]`;
  const identity = [`When: ${when.toISOString()}`, `Machine: ${machine}`, `Who: ${actor || "person"}`, ...(sessionId ? [`Session: ${sessionId}`] : []), `From: ${f.repo.checkout.head ?? "unknown"}`];
  const legs = new Map((f.installClients?.names ?? []).map(name => [name, `${name}: not run`]));
  let local = "running; if unfinished, inspect the install output before deploying again";
  let to = "pending", protocol = f.repo.protocol;
  const text = () => [heading, "", ...identity, `To: ${to}`, `Protocol: ${protocol ?? "unknown"}`, `Local: ${local}`, "", "Client legs:", ...(legs.size ? legs.values() : ["none configured"])].join("\n");
  let note = await request<Note>("create", { parentId: parent.id, text: text(), author, provenance });
  const save = async () => {
    note = await request<Note>("update", { blockId: note.id, expectedRevision: note.revision, text: text(), mutation: { author, ...provenance } });
  };
  return {
    id: note.id,
    async local(outcome: string) {
      local = outcome;
      const head = await run(["git", "-C", f.repo.root, "rev-parse", "HEAD"], { env });
      to = head.code === 0 ? head.out : "unknown";
      protocol = (await pluginCode(f.repo.outliner)).protocol;
      await save();
    },
    async client(name: string, line: string) { legs.set(name, line); await save(); },
  };
}

import { linkInstallSummary, type LinkDeploy, type LinkInstallResult } from "@ep0ch/outliner/link";
import { sessionPersona, whichOutline } from "@ep0ch/outline-core/outline-location";
import { configuredMachineName, hostMachineName } from "@ep0ch/outliner/machine-name";
import { disk } from "../discover";
import { hostRequest } from "../socket";
import { writeRecord } from "../records";
import { runningSessions } from "../session/place";
import { defaultStateDir } from "../state";
import { pluginCode, run } from "./facts";
import { sshInstallClients } from "./plan";
import type { Facts } from "./model";

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
  const request = <T>(action: string, params: Record<string, unknown> = {}) => {
    // A schema refusal can be tried after restart; a lost create answer must never create twice.
    if (action === "create" || action === "template.stamp") creating();
    return hostRequest<T>(f.host.socket, action, { outline, ...params });
  };
  const machine = f.machineName?.chosen || configuredMachineName(env, f.host.folder) || hostMachineName();
  const heading = `Deploy ${when.toISOString()} on ${machine}`;
  const identity = [`When: ${when.toISOString()}`, `Machine: ${machine}`, `Who: ${actor || "person"}`, ...(sessionId ? [`Session: ${sessionId}`] : []), `From: ${f.repo.checkout.head ?? "unknown"}`];
  const legs = new Map(sshInstallClients(f).map(name => [name, `${name}: not run`]));
  const links = new Map<string, string>();
  let local = "running; if unfinished, inspect the install output before deploying again";
  let to = "pending", protocol = f.repo.protocol;
  const text = () => [heading, "", ...identity, `To: ${to}`, `Protocol: ${protocol ?? "unknown"}`, `Local: ${local}`, "", "Client legs:", ...(legs.size ? legs.values() : ["none configured"]), ...[...links].map(([machine, line]) => `\nLink ${machine}:\n${line}\n`)].join("\n");
  const board = { request };
  const who = { author: author as "agent" | "user", provenance };
  const append = async (previous?: string) => {
    const ping = await request<{ protocolVersion: number; grammarVersion: number }>("ping");
    const sessions = await runningSessions(env.EP0CH_STATE ?? defaultStateDir(env));
    return writeRecord(board, "deploy", {
      sha: to === "pending" ? f.repo.checkout.head ?? "unknown" : to,
      host: machine, protocol: String(ping.protocolVersion), grammar: String(ping.grammarVersion),
      sessions: JSON.stringify(sessions.map(s => ({ pid: s.info.pid, place: s.info.place, code: s.info.code }))),
      failed: [local.startsWith("failed") || local.includes("needs attention") ? local : "", ...[...legs.values()].filter(line => line.startsWith("!"))].filter(Boolean).join("\n") || "none", details: text(), ...(previous ? { previous } : {}),
    }, who);
  };
  let note = await append();
  const first = note.id;
  const save = async () => { note = await append(note.id); };
  return {
    id: first,
    linkRecord: { socket: f.host.socket, outline, id: first },
    async local(outcome: string) {
      local = outcome;
      const head = await run(["git", "-C", f.repo.root, "rev-parse", "HEAD"], { env });
      to = head.code === 0 ? head.out : "unknown";
      protocol = (await pluginCode(f.repo.outliner)).protocol;
      await save();
    },
    async link(name: string, line: string) { links.set(name, line); await save(); },
    async client(name: string, line: string) { legs.set(name, line); await save(); },
  };
}

/** A reconnect may deliver the receipt after the invoking installer has exited. */
export async function recordLinkInstall(deploy: LinkDeploy, machine: string, result: LinkInstallResult) {
  if (!deploy.record) return;
  const { socket, outline, id } = deploy.record;
  await writeRecord({ request: <T>(action: string, params: Record<string, unknown> = {}) => hostRequest<T>(socket, action, { outline, ...params }) }, "deploy", {
    sha: result.commit ?? deploy.sha, host: machine, previous: id,
    sessions: JSON.stringify(result.sessions), failed: [result.error, ...result.notDone].filter(Boolean).join("; ") || (result.code ? `exit ${result.code}` : "none"),
    details: linkInstallSummary(machine, result),
  }, { author: "agent", provenance: { actorId: "ep0ch-install" } });
}

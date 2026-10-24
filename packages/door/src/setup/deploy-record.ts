import { linkInstallSummary, type LinkDeploy, type LinkInstallResult } from "@ep0ch/outliner/link";
import { sessionPersona } from "@ep0ch/outline-core/outline-location";
import { configuredMachineName, hostMachineName } from "@ep0ch/outliner/machine-name";
import { disk, resolveTarget } from "../discover";
import { forwardTo } from "../machine";
import { hostRequest } from "../socket";
import { writeRecord } from "../records";
import { runningSessions } from "../session/place";
import { defaultStateDir } from "../state";
import { pluginCode, run } from "./facts";
import { sshInstallClients } from "./plan";
import type { Facts } from "./model";

type Env = Record<string, string | undefined>;

/** The destination is selected normally; deployment facts are observed on the machine being installed. */
export async function startDeployRecord(f: Facts, env: Env, folder: string, when: Date, creating: () => void, selectors: readonly string[] = []) {
  const target = resolveTarget(selectors, env, folder);
  if ("error" in target) throw new Error(target.error);
  const socket = "unnamed" in target ? f.host.socket : target.path;
  const outline = "unnamed" in target
    ? (await hostRequest<{ defaultOutline?: string }>(socket, "outlines.list")).defaultOutline
    : target.outline;
  if (!("unnamed" in target) && target.machine) await forwardTo(target.machine, env);
  if (!outline) throw new Error("no outline named here or by the host; run install with EP0CH_WS=<served outline>");
  const actor = sessionPersona({ env, folder, fs: disk })?.name;
  const sessionId = env.CLAUDE_CODE_SESSION_ID || env.CLAUDE_SESSION_ID || env.CODEX_THREAD_ID;
  const provenance = actor ? { actorId: actor, sessionId } : undefined;
  const author = actor ? "agent" : "user";
  const request = <T>(action: string, params: Record<string, unknown> = {}) => {
    // A schema refusal can be tried after restart; a lost create answer must never create twice.
    if (action === "create" || action === "template.stamp") creating();
    return hostRequest<T>(socket, action, { outline, ...params });
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
    const ping = f.host.running
      ? await hostRequest<{ protocolVersion: number; grammarVersion: number }>(f.host.socket, "ping")
      : undefined;
    const sessions = await runningSessions(env.EP0CH_STATE ?? defaultStateDir(env));
    return writeRecord(board, "deploy", {
      when: when.toISOString(), who: actor || "person", session: sessionId ?? "unknown",
      from: f.repo.checkout.head ?? "unknown", to, local, clients: [...legs.values()].join("\n") || "none configured",
      sha: to === "pending" ? f.repo.checkout.head ?? "unknown" : to,
      host: machine, protocol: String(ping?.protocolVersion ?? "unknown"), grammar: String(ping?.grammarVersion ?? "unknown"),
      sessions: JSON.stringify(sessions.map(s => ({ pid: s.info.pid, place: s.info.place, code: s.info.code }))),
      failed: [local.startsWith("failed") || local.includes("needs attention") ? local : "", ...[...legs.values()].filter(line => line.startsWith("!"))].filter(Boolean).join("\n") || "none", details: text(), ...(previous ? { previous } : {}),
    }, who);
  };
  let note = await append();
  const first = note.id;
  const save = async () => { note = await append(note.id); };
  return {
    id: first,
    linkRecord: { socket, outline, id: first },
    async local(outcome: string) {
      local = outcome;
      const head = await run(["git", "-C", f.repo.root, "rev-parse", "HEAD"], { env });
      to = head.code === 0 ? head.out : "unknown";
      protocol = (await pluginCode(f.repo.outliner)).protocol;
      await save();
    },
    async link(name: string, line: string, receipt?: LinkInstallResult) {
      links.set(name, line); await save();
      // A same-SHA install can use its saved receipt without another link callback.
      if (receipt) await recordLinkInstall({ sha: receipt.sha, record: { socket, outline, id: first } }, name, receipt);
    },
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

import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { composeActor } from "@ep0ch/outline-core/attribution";
import { sessionPersona } from "@ep0ch/outline-core/outline-location";
import { canonicalLocalMachineName } from "@ep0ch/outliner/machine-name";
import { disk, hostSocketOf } from "./discover";
import { boardFor } from "./notes-cli";
import { RECORD_FIELDS, writeRecord, type RecordKind } from "@ep0ch/outliner/records";
import { runningSessions } from "./session/place";
import { run } from "./setup/facts";
import { hostRequest } from "./socket";

export const RECORD_USAGE = [
  ...Object.entries(RECORD_FIELDS).map(([kind, fields]) => `  ep0ch record ${kind} ${fields.map(k => ` [--${k} <value>]`).join("")}`),
  "                                   append a machinery note under Deploys (deploy) or Records, filled through its use template;",
  "                                   --ws <name> and --machine <ssh-name> name the outline as usual.",
  "                                   --observed on deploy reads this machine's git HEAD, sessions and host versions.",
  "                                   run-end --report-file <path> saves the report and posts it on the start's ticket.",
].join("\n");

export async function recordCommand(args: string[]): Promise<number> {
  const kind = args[1] as RecordKind;
  if (!Object.hasOwn(RECORD_FIELDS, kind)) { console.error(RECORD_USAGE); return 2; }
  const props: Record<string, string> = {};
  let reportFile: string | undefined;
  let observed = false;
  for (let i = 2; i < args.length; i++) {
    const flag = args[i]!;
    if (flag === "--observed" && kind === "deploy") { observed = true; continue; }
    const value = args[++i];
    if (value === undefined || !flag.startsWith("--")) { console.error(`ep0ch record: ${flag} needs a value`); return 2; }
    if (["--ws", "--machine"].includes(flag)) continue;
    if (flag === "--report-file") { reportFile = value; continue; }
    const key = flag.slice(2);
    if (!(RECORD_FIELDS[kind] as readonly string[]).includes(key)) { console.error(`ep0ch record ${kind}: unknown field ${flag}`); return 2; }
    props[key] = value;
  }
  const board = await boardFor(args);
  if ("error" in board) { console.error(`ep0ch record: ${board.error}`); return 1; }
  const actor = sessionPersona({ env: process.env, folder: process.cwd(), fs: disk })?.name;
  const who = actor
    ? { author: "agent" as const, provenance: { actorId: composeActor({ persona: actor, principal: `ep0ch@${canonicalLocalMachineName()}` }), sessionId: process.env.CODEX_THREAD_ID ?? process.env.CLAUDE_CODE_SESSION_ID } }
    : { author: "user" as const };
  try {
    if (reportFile) props.report = readFileSync(reportFile, "utf8");
    if (observed) {
      const head = await run(["git", "rev-parse", "HEAD"]);
      if (head.code) throw new Error(head.err);
      const ping = await hostRequest(hostSocketOf(), "ping");
      const sessions = await runningSessions();
      Object.assign(props, { sha: head.out, host: hostname(), observed: "true", protocol: String(ping.protocolVersion), grammar: String(ping.grammarVersion), sessions: JSON.stringify(sessions.map(s => ({ pid: s.info.pid, place: s.info.place, code: s.info.code }))) });
    }
    const result = await writeRecord({ request: <T>(action: string, params?: Record<string, unknown>) => board.send(action, params) as Promise<T> }, kind, props, who);
    console.log(JSON.stringify(result));
    if (kind === "run-end" && props.report && props.run) {
      const start = await board.request("get", { blockId: props.run });
      const [{ parsePropertyRecords }, { valueOf }] = await Promise.all([import("@ep0ch/outline-core/property-parse"), import("@ep0ch/outline-core/block-record")]);
      const ticket = valueOf({ properties: parsePropertyRecords(start.text) }, "ticket");
      if (ticket && ticket !== "unknown") {
        const answer = await board.request("blocks.resolve", { refs: [ticket] });
        const resolved = answer.resolved[0]!;
        if (!resolved.id) throw new Error(resolved.error);
        await board.request("create", { parentId: resolved.id, text: `Builder report ((${result.id}))\n\n${props.report}`, ...who });
      }
    }
    return 0;
  } catch (e) { console.error(`ep0ch record: ${(e as Error).message}`); return 1; }
  finally { board.close(); }
}

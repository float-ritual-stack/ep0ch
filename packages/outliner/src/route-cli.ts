// `ep0ch route [<note> | --all] [--dry-run]` (PIE-1010): notes route themselves by rules written as notes
// (src/note-routing.ts); this asks the running service (`notes.route`) to route one note or every note, or to say what
// would move where and why. The moves are `ext:route`'s, with this command's caller recorded as who asked.
import { parseArgs } from "node:util";
import type { NoteRouteRun } from "@ep0ch/outline-core/protocol";
import { createOutlinerClient } from "./client";
import { resolveClientPaths } from "./paths";

const USAGE = `usage: ep0ch route <note> [--dry-run] [--ws <outline>] [--json]
       ep0ch route --all [--dry-run] [--ws <outline>] [--json]
  Routes a note (an id, ((id)), [[page]] or Work ID), or every note, by the outline's routing rules: notes with
  [type::route] [query::…] [route-to::((id))], listed in the Routing view; the first whose query holds for a note moves it
  there, as ext:route, in one revision, with a history under the rule. --dry-run says what would move where and why, and
  moves nothing. A note being written in a door is never moved under the person: it routes when the draft closes.
  --actor <name> records who asked (default: you).`;

interface Client { request<T>(input: Record<string, unknown>, timeoutMs?: number): Promise<T> }

/** The run's lines for a person: each note's words, then the rule notes that can't be used, then the count. */
export function routeReport(run: NoteRouteRun, scope: { all: boolean; ws?: string }): string[] {
  const lines = run.results.map(r => r.said);
  for (const problem of run.problems) lines.push(`can't use ${problem}`);
  const count = (outcome: string) => run.results.filter(r => r.outcome === outcome).length;
  const parts: string[] = [];
  if (run.dryRun) { if (count("would-move")) parts.push(`${count("would-move")} would move`); }
  else if (count("moved")) parts.push(`${count("moved")} moved`);
  if (count("unchanged")) parts.push(`${count("unchanged")} already in place`);
  if (count("held")) parts.push(`${count("held")} being written (routes when the draft closes)`);
  if (count("refused")) parts.push(`${count("refused")} refused`);
  if (count("no-rule")) parts.push(`${count("no-rule")} no rule holds for`);
  if (scope.all && run.unmatched) parts.push(`${run.unmatched} no rule holds for`);
  lines.push(`${run.rules} rule${run.rules === 1 ? "" : "s"}${parts.length ? `: ${parts.join(", ")}` : run.rules ? "" : " (write one: a note with [type::route] [query::…] [route-to::((id))])"}`);
  if (run.dryRun && count("would-move")) lines.push(`A dry run. To move them: ep0ch route ${scope.all ? "--all" : run.results[0]?.blockId ?? "<note>"}${scope.ws ? ` --ws ${scope.ws}` : ""}`);
  return lines;
}

export async function runRouteCommand(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  if (args[0] === "help" || args[0] === "--help" || args[0] === "-h") { console.log(USAGE); return 0; }
  let values: { ws?: string; all?: boolean; "dry-run"?: boolean; json?: boolean; actor?: string }, positionals: string[];
  try {
    ({ values, positionals } = parseArgs({ args: [...args], strict: true, allowPositionals: true,
      options: { ws: { type: "string" }, all: { type: "boolean" }, "dry-run": { type: "boolean" }, json: { type: "boolean" }, actor: { type: "string" } } }));
  } catch (error) {
    console.error(`route: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 2;
  }
  const ref = positionals[0];
  if ((ref && values.all) || (!ref && !values.all) || positionals.length > 1) { console.error(USAGE); return 2; }
  try {
    const paths = resolveClientPaths(values.ws ? { ...env, EP0CH_WS: values.ws } : env);
    const client = createOutlinerClient(paths as Parameters<typeof createOutlinerClient>[0]) as unknown as Client;
    const mutation = values.actor ? { author: "agent", actorId: values.actor } : { author: "user" };
    const run = await client.request<NoteRouteRun>({ action: "notes.route", ...(ref ? { ref } : { all: true }), ...(values["dry-run"] ? { dryRun: true } : {}), mutation });
    if (values.json) console.log(JSON.stringify(run));
    else for (const line of routeReport(run, { all: values.all === true, ...(values.ws ? { ws: values.ws } : {}) })) console.log(line);
    return 0;
  } catch (error) {
    console.error(`route: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

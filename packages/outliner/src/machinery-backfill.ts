// `ep0ch machinery backfill` (PIE-867): stamp what tools already wrote with `[machine::<producer>]`, by today's shapes.
// Producers stamp their records from now on; this brings the ones already in an outline into the same rule, so a list
// that hides machinery hides them too. It asks the running service (`blocks.query`, `properties.patch`) and writes as
// an agent named `machinery-backfill`: a dry run says what it would stamp, `--apply` stamps. A note already stamped
// is left alone, so it can be run again.
import { parseArgs } from "node:util";
import { MACHINE_KEY, NOTIFICATION_MACHINE } from "@ep0ch/outline-core/machinery";
import { createOutlinerClient } from "./client";
import { resolveClientPaths } from "./paths";
import type { Block } from "./types";

/** The shapes tools wrote before they stamped: each question and the producer it names. */
export const BACKFILL_SHAPES: readonly { producer: string; where: string; about: string }[] = [
  { producer: "file-touch", where: "type=file-touch OR file-day OR file-project OR file-session", about: "the files a session touched, and their day, project and session folders" },
  { producer: "echonet", where: "type=nodelist OR type=toss OR type=echo-ledger OR type=echo-undeliverable OR kind=echo-seen-by", about: "EchoNet's nodelist, toss logs, ledger, undeliverable notes and seen-by receipts" },
  { producer: "delivery", where: "type=delivery", about: "delivery records" },
  { producer: "intake", where: "type=prior-art", about: "intake's prior-art notes" },
  { producer: "backup", where: "type=backup-run", about: "backup runs" },
  { producer: "peer-log", where: "type=peer-message", about: "the messages between Claude sessions the mod copies under [[peer-messages]] (PIE-1448)" },
  { producer: NOTIFICATION_MACHINE, where: "notify.key", about: "the notifications hub's fetched notifications (PIE-1427)" },
  // The page the notifications hub pulls into, by who wrote it last (the Extensions hub and pages need none: the service
  // writes them again, stamped, on its next reload).
  { producer: "notify", where: "by:ext:notify AND child>=1:notify.key", about: "the page the notifications hub pulls into" },
];

/**
 * The views that hold machinery, so they say so (`[machinery::show]`): the file-touch tree's, and the notifications
 * hub's boards (a lane whose query reads `notify.…`).
 */
const VIEW_SHAPES: readonly { producer: string; where: string }[] = [
  { producer: "file-touch views", where: "type=virtual-branch AND file-project-view" },
  { producer: "notification boards", where: 'type=virtual-branch AND text~"[query::notify."' },
];

const USAGE = `usage: ep0ch machinery backfill [--ws <outline>] [--apply] [--json]
  Stamps [machine::<producer>] on what tools wrote before they stamped: file touches and their folders, EchoNet's
  nodelist, tosses, ledger and receipts, delivery records, intake's prior art, backup runs, peer messages, fetched notifications, the
  page the notifications hub pulls into; and
  [machinery::show] on the file-touch views and the notifications boards. A dry run says what it would stamp; --apply stamps. A note already stamped is left alone.`;

interface Client { request<T>(input: Record<string, unknown>, timeoutMs?: number): Promise<T> }

const MUTATION = { author: "agent" as const, actorId: "machinery-backfill" };
const hasKey = (block: Block, key: string) => block.properties.some(p => p.key === key && p.value.trim() !== "");

/** What a pass over an outline would stamp (or did), by producer. */
export async function backfill(client: Client, apply: boolean): Promise<{ producer: string; stamped: number; skipped: number; atLeast?: true }[]> {
  const report: { producer: string; stamped: number; skipped: number; atLeast?: true }[] = [];
  const questions: { producer: string; where: string; key: string; value: string }[] = [
    ...BACKFILL_SHAPES.map(s => ({ producer: s.producer, where: s.where, key: MACHINE_KEY, value: s.producer })),
    ...VIEW_SHAPES.map(v => ({ ...v, key: "machinery", value: "show" }))];
  for (const q of questions) {
    let stamped = 0, skipped = 0, atLeast = false;
    // Pages of a thousand: the ones stamped drop out of the next ask, so it ends when nothing is left to stamp.
    for (let pass = 0; pass < 200; pass++) {
      const found = await client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where: `(${q.where}) AND NOT ${q.key}`, limit: 1000, machinery: "show" } });
      const todo = found.blocks.filter(b => !b.effectiveDeletedRootId && !hasKey(b, q.key));
      if (!todo.length) break;
      // A dry run reads one page (it stamps nothing, so the next ask would be the same): a full page is a lower bound.
      if (!apply) { stamped += todo.length; atLeast = found.blocks.length >= 1000; break; }
      let progressed = 0;
      for (const block of todo) {
        try {
          await client.request({ action: "properties.patch", blockId: block.id, expectedRevision: block.revision, operations: [{ op: "append", key: q.key, value: q.value }], mutation: MUTATION });
          stamped++; progressed++;
        } catch { skipped++; }
      }
      if (!progressed) break;
    }
    report.push({ producer: q.producer, stamped, skipped, ...(atLeast ? { atLeast: true as const } : {}) });
  }
  return report;
}

export async function runMachineryCommand(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [operation, ...rest] = args;
  if (operation !== "backfill") {
    console.error(USAGE);
    return operation === undefined || operation === "help" || operation === "--help" ? 0 : 2;
  }
  try {
    const { values } = parseArgs({ args: [...rest], strict: true, options: { ws: { type: "string" }, apply: { type: "boolean" }, json: { type: "boolean" } } });
    const paths = resolveClientPaths(values.ws ? { ...env, EP0CH_WS: values.ws } : env);
    const client = createOutlinerClient(paths as Parameters<typeof createOutlinerClient>[0]) as unknown as Client;
    const report = await backfill(client, values.apply === true);
    if (values.json) console.log(JSON.stringify({ applied: values.apply === true, report }));
    else {
      for (const r of report) console.log(`${r.producer}: ${values.apply ? "stamped" : "would stamp"} ${r.atLeast ? "at least " : ""}${r.stamped}${r.skipped ? `, ${r.skipped} changed meanwhile or refused: run it again` : ""}`);
      if (!values.apply) console.log("A dry run. To stamp them: ep0ch machinery backfill" + (values.ws ? ` --ws ${values.ws}` : "") + " --apply");
    }
    return 0;
  } catch (error) {
    console.error(`machinery: ${error instanceof Error ? error.message : String(error)}\n${USAGE}`);
    return 1;
  }
}

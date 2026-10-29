// `ep0ch review backfill` (PIE-1388): the write review run over what agents already wrote in an outline, read only, so
// the thresholds are tuned from what's there (the outliner's write-review-backfill.ts). `--into` keeps the findings and
// the run as records in that outline, for the suggestions page; without it, the stats are printed and nothing is written.
import { boardFor } from "./notes-cli";

type Client = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
/** The outliner's module, loaded by name: its sources are the outliner's to type-check, under its own settings (as mcp-write loads agent-tools). */
interface Backfill {
  reviewBackfill(source: Client, o: { since: string; limit?: number; outline?: string; into?: Client; jev: boolean }): Promise<unknown>;
  backfillSummary(report: unknown): string;
}
const BACKFILL = "@ep0ch/outliner/write-review-backfill";

export const REVIEW_USAGE = `  ep0ch review backfill [--since 7d] [--limit <n>] [--into <name> [--into-machine <ssh-name>]] [--no-jev] [--json] [--ws <name>] [--machine <ssh-name>]
                                   every note an agent last wrote in the window (7d, 12h, 2w), reviewed as a new write would be:
                                   code's measures and Jev's judgments against Evan's rubric (dense, format, buried, unclear,
                                   mixed, context, argues), counted by rubric, rule and writer, with samples and Jev's tokens.
                                   Reads the outline only; --into keeps the findings (source::backfill) and the run
                                   (experiment::write-review-backfill) as records there, for the suggestions page.
                                   --no-jev: code's measures alone.`;

const SOLO = ["--json", "--no-jev", "--here"];
const VALUED = ["--since", "--limit", "--into", "--into-machine", "--ws", "--machine"];

export async function reviewCommand(args: string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  if (args[1] !== "backfill") { io.err(REVIEW_USAGE); return 2; }
  const rest = args.slice(2), opts: Record<string, string> = {};
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (SOLO.includes(a)) continue;
    if (!VALUED.includes(a) || rest[i + 1] === undefined) { io.err(`ep0ch review backfill: ${a} ${VALUED.includes(a) ? "needs a value" : "isn't a flag it takes"}\n${REVIEW_USAGE}`); return 2; }
    opts[a] = rest[++i]!;
  }
  const limit = opts["--limit"] === undefined ? undefined : Number(opts["--limit"]);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) { io.err("ep0ch review backfill: --limit takes a number of notes, 1 or more"); return 2; }
  const source = await boardFor(rest, args);
  if ("error" in source) { io.err(`ep0ch review backfill: ${source.error}`); return 1; }
  const into = opts["--into"] ? await boardFor(["--ws", opts["--into"], ...(opts["--into-machine"] ? ["--machine", opts["--into-machine"]] : [])]) : undefined;
  if (into && "error" in into) { source.close(); io.err(`ep0ch review backfill: --into: ${into.error}`); return 1; }
  const client = (board: typeof source): Client => ({ request: <T>(input: { action: string } & Record<string, unknown>) => { const { action, ...params } = input; return board.request<T>(action, params, 60_000); } });
  try {
    const { reviewBackfill, backfillSummary } = await import(BACKFILL) as Backfill;
    const report = await reviewBackfill(client(source), {
      since: opts["--since"] ?? "7d", ...(limit ? { limit } : {}), outline: source.address.outline,
      ...(into ? { into: client(into) } : {}), jev: !rest.includes("--no-jev"),
    });
    io.out(rest.includes("--json") ? JSON.stringify(report, null, 2) : backfillSummary(report));
    return 0;
  } catch (e) {
    io.err(`ep0ch review backfill: ${(e as Error).message}`);
    return 1;
  } finally {
    source.close();
    if (into) into.close();
  }
}

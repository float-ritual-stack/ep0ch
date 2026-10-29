// `ep0ch work …` (PIE-1258): the workboard's commands. `groom` and `try` are Jev's loops over a board (the outliner's
// work-groom.ts and work-try.ts, loaded by name as review-cli loads the backfill); every other operation is the outliner's
// own `work` command (create, stage, set, deliver, complete, body, link), one implementation.
import { join } from "node:path";
import { boardFor } from "./notes-cli";

type Client = { request<T>(input: { action: string } & Record<string, unknown>): Promise<T> };
type Board = Exclude<Awaited<ReturnType<typeof boardFor>>, { error: string }>;

/** The outliner's modules, loaded by name: their sources are the outliner's to type-check, under its own settings. */
interface Groom {
  groom(source: Client, evidence: { changelog: string; prs: { ref: string; title: string; body?: string }[] }, o: { jev: boolean; where?: string; limit?: number; progress?: (line: string) => void }): Promise<unknown>;
  keepGroom(into: Client, report: unknown): Promise<{ verdicts: number; comments: number; run: string }>;
  groomSummary(report: unknown): string;
}
interface Try {
  planTries(tickets: unknown[], actions: { name: string; summary: string; keys?: string; examples?: readonly { act: string; does: string }[] }[], o: { jev: boolean }): Promise<{ jev: string; tokens: number }>;
  keepTries(into: Client, report: unknown): Promise<{ note: string; run: string }>;
  tryMarkdown(report: unknown): string;
}
const GROOM = "@ep0ch/outliner/work-groom";
const TRY = "@ep0ch/outliner/work-try";

export const WORK_USAGE = `  ep0ch work groom [--ws <name>] [--repo <dir>] [--since 120d] [--where <query>] [--limit <n>] [--into <name>] [--no-jev] [--json]
                                   Jev's first pass over the queued tickets: each against the CHANGELOG and merged pull
                                   requests (--repo, default this checkout) and the other tickets; solved, superseded,
                                   duplicate or open, with confidence and evidence. Reads only; --into keeps the verdicts,
                                   a comment on each confident "solved" for the verifier, the "Jev thinks these are done"
                                   view and the run's tokens and cost. Jev never closes a ticket.
  ep0ch work try <PIE-n>… [--ws <name>] [--into <name>] [--no-jev] [--json]
                                   what a validator would try for merged tickets: the door's actions and each ticket's
                                   lines Jev picks, as journeys (where, which keys or act call, what should show).
                                   --into keeps it as a [type::validation-plan] note for the verifier's brief.
  ep0ch work create|stage|set|deliver|complete|body|link …   the outliner's work command (ep0ch work help)`;

const SOLO = ["--json", "--no-jev", "--here"];
const VALUED = ["--repo", "--since", "--where", "--limit", "--into", "--into-machine", "--ws", "--machine"];

const clientOf = (board: Board): Client => ({ request: <T>(input: { action: string } & Record<string, unknown>) => { const { action, ...params } = input; return board.request<T>(action, params, 60_000); } });

/** Merged pull requests on the checkout's first-parent history since `since` (`120d`): their ref and title. */
async function mergedPullRequests(repo: string, since: string): Promise<{ ref: string; title: string; body?: string }[]> {
  const days = /^(\d+)d$/.exec(since)?.[1];
  if (!days) throw new Error("--since takes days, like 120d");
  const git = Bun.spawn(["git", "-C", repo, "log", "--first-parent", `--since=${days}.days`, "--pretty=%h%x1f%s%x1f%b%x1e"], { stdout: "pipe", stderr: "pipe" });
  const [out, code] = [await new Response(git.stdout).text(), await git.exited];
  if (code !== 0) throw new Error(`git log in ${repo} failed (exit ${code})`);
  return out.split("\x1e").map(r => r.trim()).filter(Boolean).map(r => {
    const [sha, subject, body] = r.split("\x1f");
    const pr = /^Merge pull request (#\d+)/.exec(subject ?? "");
    // A merge's title is its body's first line; a direct commit's is its subject.
    return pr ? { ref: pr[1]!, title: (body ?? "").split("\n")[0]!.trim() || subject!, body: (body ?? "").split("\n").slice(1, 6).join(" ") } : { ref: sha!, title: subject ?? "" };
  });
}

export async function workCommand(args: string[], io = { out: (s: string) => console.log(s), err: (s: string) => console.error(s) }): Promise<number> {
  const op = args[1];
  if (op !== "groom" && op !== "try") {
    // The outliner's own: --ws and --machine name the outline, as EP0CH_WS and EP0CH_MACHINE do for it.
    let rest = args.slice(1);
    for (const [flag, name] of [["--ws", "EP0CH_WS"], ["--machine", "EP0CH_MACHINE"]] as const) {
      const at = rest.indexOf(flag);
      if (at >= 0 && rest[at + 1]) { process.env[name] = rest[at + 1]; rest = [...rest.slice(0, at), ...rest.slice(at + 2)]; }
    }
    if (op === undefined || op === "help" || op === "--help") io.out(WORK_USAGE);
    const cli = join(import.meta.dir, "../../outliner/src/cli.ts");
    const run = Bun.spawn([process.execPath, cli, "work", ...rest], { stdio: ["inherit", "inherit", "inherit"], env: process.env });
    return await run.exited;
  }
  const rest = args.slice(2), opts: Record<string, string> = {}, ids: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (SOLO.includes(a)) continue;
    if (!a.startsWith("--") && op === "try") { ids.push(a); continue; }
    if (!VALUED.includes(a) || rest[i + 1] === undefined) { io.err(`ep0ch work ${op}: ${a} ${VALUED.includes(a) ? "needs a value" : "isn't a flag it takes"}\n${WORK_USAGE}`); return 2; }
    opts[a] = rest[++i]!;
  }
  if (op === "try" && !ids.length) { io.err(`ep0ch work try: which tickets? name them, e.g. ep0ch work try PIE-12 PIE-13\n${WORK_USAGE}`); return 2; }
  const limit = opts["--limit"] === undefined ? undefined : Number(opts["--limit"]);
  if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) { io.err(`ep0ch work ${op}: --limit takes a number of tickets, 1 or more`); return 2; }
  const source = await boardFor(rest, args);
  if ("error" in source) { io.err(`ep0ch work ${op}: ${source.error}`); return 1; }
  const into = opts["--into"] ? await boardFor(["--ws", opts["--into"], ...(opts["--into-machine"] ? ["--machine", opts["--into-machine"]] : [])]) : undefined;
  if (into && "error" in into) { source.close(); io.err(`ep0ch work ${op}: --into: ${into.error}`); return 1; }
  const jev = !rest.includes("--no-jev");
  try {
    if (op === "groom") {
      const repo = opts["--repo"] ?? join(import.meta.dir, "../../..");
      const changelog = await Bun.file(join(repo, "CHANGELOG.md")).text().catch(() => { throw new Error(`no CHANGELOG.md in ${repo}: --repo names the checkout`); });
      const prs = await mergedPullRequests(repo, opts["--since"] ?? "120d");
      const m = await import(GROOM) as Groom;
      const report = await m.groom(clientOf(source), { changelog, prs }, { jev, ...(opts["--where"] ? { where: opts["--where"] } : {}), ...(limit ? { limit } : {}), progress: line => { if (!rest.includes("--json")) process.stderr.write(`\r${line}\x1b[K`); } });
      if (!rest.includes("--json")) process.stderr.write("\r\x1b[K");
      const kept = into ? await m.keepGroom(clientOf(into), report) : undefined;
      io.out(rest.includes("--json") ? JSON.stringify({ ...(report as object), ...(kept ? { kept } : {}) }, null, 2)
        : `${m.groomSummary(report)}${kept ? `\n\nkept in ${opts["--into"]}: ${kept.verdicts} verdicts, ${kept.comments} comments for the verifier, run ${kept.run}` : "\n\nread only: --into <name> keeps it"}`);
      return 0;
    }
    const m = await import(TRY) as Try;
    const tickets: unknown[] = [];
    for (const id of ids) {
      const found = await clientOf(source).request<{ blocks: { id: string }[] }>({ action: "blocks.query", query: { where: `type=roadmap-item work-id=${id}`, limit: 1 } });
      const block = found.blocks[0] ? await clientOf(source).request<unknown>({ action: "get", blockId: found.blocks[0].id }) : null;
      if (!block) { io.err(`ep0ch work try: no ticket ${id} in ${source.address.outline}`); return 1; }
      tickets.push(block);
    }
    const { registryActions } = await import("./actions-doc");
    const actions = (await registryActions()).map(a => ({ name: a.name, summary: a.summary, ...(a.keys ? { keys: a.keys } : {}), ...(a.examples ? { examples: a.examples } : {}) }));
    const report = await m.planTries(tickets, actions, { jev });
    const kept = into ? await m.keepTries(clientOf(into), report) : undefined;
    io.out(rest.includes("--json") ? JSON.stringify({ ...(report as object), ...(kept ? { kept } : {}) }, null, 2)
      : `${m.tryMarkdown(report)}\n\nJev: ${report.jev} · ${report.tokens} tokens in${kept ? `\nkept in ${opts["--into"]}: ((${kept.note})) · run ${kept.run}` : ""}`);
    return 0;
  } catch (e) {
    io.err(`ep0ch work ${op}: ${(e as Error).message}`);
    return 1;
  } finally {
    source.close();
    if (into) into.close();
  }
}

// `ep0ch echo` (PIE-779): EchoNet from the shell. `toss` and `nodelist` run the echonet extension's own actions
// (`extensions.act`), so a toss from the shell is the run its schedule makes, attributed to whoever asked; `subscribe`
// writes a subscription note; `areas` reads an outline's areas and subscriptions with the extension's own shapes.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { areasIn, type Block, firstLine, isCopy, kindOf, parseMask, parseNode, prop, trashed, values } from "../extensions/echonet/shapes";
import { createOutlinerClient } from "./client";
import { resolveClientPaths } from "./paths";
import { tossHealth } from "./echo-health";

/** How long a toss may take: echonet's deadline (extension.json, 4 minutes) and the minute it may wait for a toss already running. */
const TOSS_TIMEOUT_MS = 5 * 60_000 + 30_000;

const USAGE = `usage: ep0ch echo toss [--ws <outline>] [--json]
       ep0ch echo status [--ws <outline>] [--json]   when each outline's tosser last ran, and whether that's too long ago
       ep0ch echo nodelist [--ws <outline>] [--json]
       ep0ch echo subscribe <node mask> <area> [--ws <outline>] [--under <id>] [--since all|<date>] [--cap <n>] [--title <words>]
       ep0ch echo areas [--ws <outline>] [--json]
  toss       copies new echomail in, carries netmail both ways, writes the nodelist, and a toss log when anything
             moved or went wrong: in --ws, or in every outline on this host that has the echonet extension in its
             own extensions/ folder
  status     each such outline: "tossed 4 min ago (every 30m)", or how long it hasn't and the command that tosses
             now (exit 1 when one is older than twice its schedule)
  nodelist   writes the nodelist again and prints it
  subscribe  writes a subscription: <node mask> is outline@machine (* for any part: *@float-2, rexall-*@laptop,
             *@*) or @<page> (a page listing nodes); <area> a name or a mask (ep0ch.*). It reads from now unless
             --since all (or a date); --cap is how many new copies a toss takes from each node (default 25)
  areas      the areas the outline offers (named views and tagged notes), its subscriptions with a board per node,
             and what its nodelist says the other nodes offer
  Install EchoNet in an outline first (off by default): ep0ch ext add echonet --outline-folder <outlines>/<name>`;

interface Client { request<T>(input: Record<string, unknown>, timeoutMs?: number): Promise<T> }

export async function runEchoCommand(args: readonly string[], env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const [operation, ...rest] = args;
  if (operation !== "toss" && operation !== "nodelist" && operation !== "subscribe" && operation !== "areas" && operation !== "status") {
    console.error(USAGE);
    return operation === undefined || operation === "help" || operation === "--help" ? 0 : 2;
  }
  try {
    const { values: flags, positionals } = parseArgs({
      args: [...rest], strict: true, allowPositionals: true,
      options: {
        ws: { type: "string" }, node: { type: "string" }, json: { type: "boolean" },
        under: { type: "string" }, since: { type: "string" }, cap: { type: "string" }, title: { type: "string" },
      },
    });
    const outlineName = flags.ws ?? flags.node;
    const paths = resolveClientPaths(outlineName ? { ...env, EP0CH_WS: outlineName } : env);
    const client = (outline: string): Client => createOutlinerClient({ ...paths, outline } as Parameters<typeof createOutlinerClient>[0]) as unknown as Client;
    const here = (): string => {
      const named = outlineName ?? (paths as { outline?: string }).outline ?? env.EP0CH_WS;
      if (!named) throw new Error("Which outline? Name one with --ws <name> (or EP0CH_WS, or a .ep0ch here)");
      return named;
    };
    if (operation === "subscribe") return await subscribe(client(here()), positionals, flags);
    if (positionals.length) throw new Error(USAGE);
    if (operation === "areas") return await areas(client(here()), here(), flags.json === true);
    if (operation === "status") {
      // A toss that moved nothing writes no log: when each tosser last ran is the bulletin it writes every toss.
      const health = tossHealth(paths.outlinesFolder).filter((h) => !outlineName || h.outline === outlineName);
      if (flags.json) console.log(JSON.stringify(health));
      else if (!health.length) console.log(`No outline${outlineName ? ` named ${outlineName}` : ""} here has EchoNet in its own folder: ep0ch ext add echonet --outline-folder <outlines>/<name>`);
      else for (const h of health) (h.status === "ok" ? console.log : console.error)(`${h.outline}: ${h.detail}${h.fix ? `\n  ${h.fix}` : ""}`);
      return health.every((h) => h.status === "ok") ? 0 : 1;
    }

    let nodes: string[];
    if (outlineName) nodes = [outlineName];
    else {
      // A host action: any outline's connection asks it.
      const listed = await createOutlinerClient(paths as Parameters<typeof createOutlinerClient>[0]).request<{ outlines: Array<{ name: string }> }>({ action: "outlines.list" });
      // A node keeps echonet in its own extensions/ folder; the others aren't asked anything.
      nodes = listed.outlines.map((entry) => entry.name).filter((name) => existsSync(join(paths.outlinesFolder, name, "extensions", "echonet", "extension.json")));
      if (!nodes.length) throw new Error("No outline on this host has the echonet extension in its own folder: ep0ch ext add echonet --outline-folder <outlines>/<name>, or name one with --ws");
    }
    const results: Array<{ node: string; ok: boolean; message: string }> = [];
    for (const node of nodes) {
      // One node failing (its toss stopped, its outline closed) doesn't keep the others from tossing.
      // A toss takes what it takes (another machine slow to answer, a minute waiting on a toss already running): the
      // request waits for its own answer, as long as the extension's deadline, and a terminal hears it's still going.
      const slow = process.stderr.isTTY ? setTimeout(() => process.stderr.write(`${node}: still tossing (another machine can take a while to answer)…\n`), 3_000) : undefined;
      const run = await client(node).request<{ message?: string }>({
        action: "extensions.act", extension: "echonet", extensionAction: operation, mutation: { author: "user" },
      }, TOSS_TIMEOUT_MS).catch((error: unknown) => ({ failed: error instanceof Error ? error.message : String(error) })).finally(() => clearTimeout(slow));
      if ("failed" in run) {
        results.push({ node, ok: false, message: `${node}: ${run.failed}` });
        continue;
      }
      results.push({ node, ok: true, message: run.message ?? "done" });
      if (operation === "nodelist" && !flags.json) {
        const found = await client(node).request<{ blocks: Array<{ text: string }> }>({ action: "blocks.query", query: { where: "type=nodelist", limit: 1 } });
        results.at(-1)!.message += `\n\n${found.blocks[0]?.text ?? "(no nodelist)"}`;
      }
    }
    if (flags.json) console.log(JSON.stringify(results));
    else for (const result of results) (result.ok ? console.log : console.error)(result.message);
    return results.every((result) => result.ok) ? 0 : 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

/** A subscription note: `<title> [subscribe::<mask>] [echo::<area>]`, with since and cap when given. */
async function subscribe(client: Client, positionals: string[], flags: { under?: string; since?: string; cap?: string; title?: string; json?: boolean }): Promise<number> {
  const [mask, area, extra] = positionals;
  if (!mask || !area || extra !== undefined) throw new Error(USAGE);
  if (!parseMask(mask)) throw new Error(`${mask} isn't a node mask: outline@machine (* for any part, as in *@float-2), or @<page> for a page listing nodes`);
  if (!/^[\w*.-]+$/.test(area)) throw new Error(`${area} isn't an area name: letters, digits, - _ . and * (as in ep0ch.requests or ep0ch.*)`);
  if (flags.since !== undefined && flags.since !== "all" && !Number.isFinite(Date.parse(flags.since))) throw new Error(`--since takes all or a date (2026-10-01); got ${flags.since}`);
  if (flags.cap !== undefined && !(Number.isInteger(Number(flags.cap)) && Number(flags.cap) > 0)) throw new Error(`--cap takes a whole number above 0; got ${flags.cap}`);
  const title = flags.title?.trim() || `${area} from ${mask}`;
  const text = `${title} [subscribe::${mask}] [echo::${area}]${flags.since ? ` [since::${flags.since}]` : ""}${flags.cap ? ` [cap::${flags.cap}]` : ""}`;
  const block = await client.request<{ id: string }>({ action: "create", text, parentId: flags.under ?? null, author: "user" });
  if (flags.json) console.log(JSON.stringify({ id: block.id, text }));
  else console.log(`${block.id}  ${text}\n${flags.since ? "" : "It reads from its first toss on (--since all takes what's there already). "}The next toss (every 30 minutes, or ep0ch echo toss) reads it.`);
  return 0;
}

/** This outline's areas and subscriptions, and the other nodes' areas as its nodelist last wrote them. */
async function areas(client: Client, outline: string, json: boolean): Promise<number> {
  const query = (where: string) => client.request<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: 1000 } }).then((r) => r.blocks);
  const offered = [...areasIn(await query("echo")).values()].map((area) => ({
    name: area.name,
    views: area.blocks.map((block) => ({ id: block.id, title: firstLine(block.text), query: prop(block, "query") })),
    posted: area.postings,
  }));
  const subscriptions = [];
  for (const sub of (await query("subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block))) {
    const boards = (await client.request<Block[]>({ action: "children", parentId: sub.id })).filter((child) => parseNode(prop(child, "echo-source")) && !trashed(child));
    const sources = [];
    for (const board of boards) {
      const copies = (await client.request<Block[]>({ action: "children", parentId: board.id })).filter(isCopy).length;
      sources.push({ node: prop(board, "echo-source")!, copies, waiting: Number(prop(board, "waiting") ?? 0) });
    }
    subscriptions.push({ id: sub.id, title: firstLine(sub.text), subscribe: values(sub, "subscribe"), echo: values(sub, "echo"), since: prop(sub, "since") ?? "its first toss", cap: prop(sub, "cap"), sources });
  }
  const nodelist = (await query("type=nodelist"))[0];
  const elsewhere = nodelist ? otherNodes(nodelist.text) : [];
  if (json) {
    console.log(JSON.stringify({ outline, areas: offered, subscriptions, nodes: elsewhere }));
    return 0;
  }
  const lines = [`${outline} offers:`];
  if (!offered.length) lines.push("  no areas: tag a view [echo::<name>], or post a note with [echo::<name>]");
  for (const area of offered) {
    const how = [...area.views.map((view) => `view ${view.title || view.id}${view.query ? ` (${view.query})` : ""}`), ...(area.posted ? [`${area.posted} posted`] : [])];
    lines.push(`  ${area.name}  ${how.join("; ")}`);
  }
  lines.push(`${outline} reads:`);
  if (!subscriptions.length) lines.push("  no subscriptions: ep0ch echo subscribe <outline@machine> <area>");
  for (const sub of subscriptions) {
    lines.push(`  ${sub.echo.join(",")} from ${sub.subscribe.join(",")}  (${sub.title}; since ${sub.since}${sub.cap ? `, cap ${sub.cap}` : ""})`);
    if (!sub.sources.length) lines.push("    no node yet: the next toss looks");
    for (const source of sub.sources) lines.push(`    ${source.node}: ${source.copies} copies${source.waiting ? `, ${source.waiting} waiting` : ""}`);
  }
  if (elsewhere.length) {
    lines.push("Other nodes, as the nodelist last saw them:");
    for (const node of elsewhere) lines.push(`  ${node.node}: ${node.areas}`);
  }
  console.log(lines.join("\n"));
  return 0;
}

/** The other nodes in a nodelist's text and the areas line under each. */
function otherNodes(text: string): Array<{ node: string; areas: string }> {
  const out: Array<{ node: string; areas: string }> = [];
  let node: string | undefined;
  let self = false;
  for (const line of text.split("\n")) {
    const head = line.match(/^## (\S+)/);
    if (head) { node = head[1]; self = false; continue; }
    if (line.startsWith("- this node")) self = true;
    const areas = line.match(/^- areas: (.*)$/);
    if (node && areas && !self) out.push({ node, areas: areas[1]! });
  }
  return out;
}

import { createBlockComment } from "./block-comments";
import { readSavedView } from "./saved-view-read";
import {inspectWorkspaceConnection} from './workspace-diagnostics';
import { resolve } from "node:path";
import { homedir } from "node:os";
import { tooBroadToName } from "@ep0ch/outline-core/outline-location";
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import { normalizePropertyQueryScope, parsePropertyFilterClause } from "./block-query";
import {
  focusBlockByQuery,
  formatBlockFocusMatch,
} from "./block-focus";
import { createOutlinerClient, OutlinerRequestError, type RequestInput } from "./client";
import { requireClientIdForRole } from "./client-target";
import { boundFolderOf, clientSocket, machineFor, outlinesLayout, resolveClientPaths, resolveOutlinesFolder, whichOutlineFor, writeDotEp0ch } from "./paths";
import { attachNamedOutline, importHostedOutline, listHostedOutlines, outlineHostClient } from "./outline-host-client";
import { navigateOutlinerLink, parseOutlinerLinkUri, resolveOutlinerLinkTarget } from "./outliner-links";
import { blockDisplayTitle } from "./references";
import type { MentionCollection } from "./mentions-types";
import type { BlockActivityKind, HostedOutlineDeletion, HostedOutlineSummary, BlockReadField, BlockSearchQuery, CaptureReceipt, MutationProvenance, RoadmapItemCreateInput } from "./types";
import {
  completeWorkItem,
  createWorkItem,
  deliverPullRequest,
  readPullRequestFacts,
  replaceItemBody,
  replaceNoteSection,
  setWorkProperty,
  setWorkStage,
  type WorkActor,
} from "./work-tools";
import { colourOnlyToATerminal } from "./plain-stderr";
// Piped stderr stays plain: the Claude mod, door-open and tests parse these refusals.
colourOnlyToATerminal();

/**
 * `outliner --ws <name> <command> …` (or `--ws=<name>`) is `EP0CH_WS=<name>`: the command talks to that outline.
 * Like `tmux -L` or `herdr --session`, it is a global flag before the command, so it is never taken from another
 * flag's value (`--text --ws`). Plain commands never create the outline; `init` and the session openers (Herdr,
 * the door) do.
 */
while (process.argv[2] === "--ws" || process.argv[2]?.startsWith("--ws=")) {
  const argument = process.argv[2]!;
  const value = argument === "--ws" ? process.argv[3] : argument.slice("--ws=".length);
  if (!value || value.startsWith("-")) throw new Error("--ws requires an outline name");
  process.env.EP0CH_WS = value;
  process.argv.splice(2, argument === "--ws" ? 2 : 1);
}
const OUTLINE_USAGE = "outline create <name> | import <database.sqlite> <name> | close <name> | delete <name>   (each with --json); init [<name>] [--folder <dir>] [--create]";

/** `outliner --help`, `-h`, `help` and a bare `outliner`: what it does, never a command run on the folder's outline. */
const USAGE = `usage: outliner [--ws <name>] <command> [options]

The outline host's command line: each command asks the outline this folder names (--ws, EP0CH_WS, the nearest
.ep0ch). Writes take --author user|agent|system and --actor <id> (--session <id>); an agent names itself.

Reading
  list [--filter key=value]… [--query <expression>] [--text <words>] [--subtree <id>] [--limit <n>] [--fields <f,…>]
  read <id>… [--fields <f,…>]          blocks by id, whole or the fields named
  view <view id> [--limit <n>] [--offset <n>] [--expected <revision>]
                                       a saved view's members, as the service reads them
  ticket <id> [--line <n>]             a Resource projection in a block
  goto <id, prefix or words> [--limit <n>] [--client <tree client id>]
                                       the block that best matches, selected in Tree
  resolve <pi-outliner:// url>         where a link points
  activity [--limit <n>] [--since <time>] [--after <cursor>] [--author …] [--actor <id>] [--kinds <k,…>]
  changes --since <sequence> [--limit <n>]
  selection | clients [--role <role>] | properties-preview --text <text>
  mentions list [--agent <a> --session <id>] [--limit <n>] | ingest (JSON on stdin) | clear

Writing
  create --text <text> [--parent <id>]   capture --text <text> | --stdin
  new [--text <text>] [--near <id>]    a note where new notes go: under --near, else the top of the Inbox
  update --id <id> --text <text> --expected <revision>
  move --id <id> --parent <id|root> [--position <n>]
  delete --id <id> [--expected <revision>] [--if-empty] | restore --id <id>
  comment --id <id> --expected <revision> --text <text> | --stdin [--quote <text> …]
  agent read|edit …                    an agent's read and edit (JSON), as the Pi extension's tools
  work …, note …                       roadmap items and notes ("outliner work" lists them)
  work-id-status | work-id-configure --prefix <P> | work-id-allocate

Panes, links and the door
  select --id <id>                     the block Tree selects
  link <pi-outliner:// url> [--tree-client <id> | --detail-client <id> | --source-client <id> …]
  door-open <id> [--control <socket>] [--actor <id>] [--from <tile>]

Outlines
  outlines [--json]                    the host's outlines
  ${OUTLINE_USAGE}
  import <source.sqlite> <target.sqlite> [--json]
                                       a new outline database from an older one (no host needed)
  bound-folder [<folder>]              the nearest folder whose .ep0ch names an outline

Publishing and extensions
  publish serve [--port <n>] [--root <dir>]… [--public-url <url>] … | publish list [--json]
  ext …                                install and list extensions

More in README.md, "Headless service and CLI".`;
if (["--help", "-h", "help", undefined].includes(process.argv[2])) {
  console.log(USAGE);
  process.exit(0);
}

/**
 * `import <source.sqlite> <target.sqlite> [--json]`: a new outline database at
 * `target` with the current schema, filled from `source` (opened read-only):
 * `importOutline` in src/outline-import.ts says what is carried. Prints counts,
 * never content. Needs no service; `target` must not exist.
 */
if (process.argv[2] === "import") {
  const { values, positionals } = parseArgs({ args: process.argv.slice(3), allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
  if (positionals.length !== 2) {
    console.error("error: import expects: <source.sqlite> <target.sqlite> [--json]");
    process.exit(2);
  }
  try {
    const { importOutline } = await import("./outline-import");
    const report = importOutline(positionals[0]!, positionals[1]!);
    if (values.json) console.log(JSON.stringify(report, null, 2));
    else {
      console.log(`imported ${report.source} into ${report.target}: ${report.blocks} blocks, ${report.properties} properties, ${report.pageAddresses} page addresses, ${report.workIds} work ids`);
      for (const [table, why] of Object.entries(report.notCarried)) console.log(`  not carried: ${table} (${why})`);
      for (const column of report.droppedColumns) console.log(`  dropped column: ${column}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
/**
 * `bound-folder [folder]`: the nearest folder, from `folder` (default: this one) up, whose `.ep0ch` names an
 * outline, as one JSON line: `{ bound: true, folder, configPath, outline }`, or `{ bound: false, folder }`. Never a
 * guess. Reads only; needs no service. The Claude mod asks it which outline a session's folder feeds.
 */
if (process.argv[2] === "bound-folder") {
  const [folderArgument, ...extra] = process.argv.slice(3);
  if (extra.length || folderArgument?.startsWith("-")) {
    console.error("error: bound-folder expects: [folder]");
    process.exit(2);
  }
  try {
    const folder = resolve(folderArgument ?? process.cwd());
    const bound = boundFolderOf(folder);
    console.log(JSON.stringify(bound ? { bound: true, ...bound } : { bound: false, folder }));
    process.exit(0);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
if(process.argv[2]==='doctor'){
 const report=await inspectWorkspaceConnection();
 console.log(process.argv.includes('--json')?JSON.stringify(report,null,2):report.lines.join('\n'));
 process.exit(report.ok?0:1);
}
/**
 * `door-open <block-id> [--control <socket>] [--actor <id>] [--from <tile>]`:
 * shows a block in ep0ch-door as an agent's `open` (see src/door-control.ts).
 * `--from` is the tile the caller runs in (EP0CH_TILE): the door puts it where
 * that tile's opens land.
 * The socket defaults to EP0CH_CONTROL, which a door gives the programs in its
 * tiles. Exit 3 when no door answers there, so a caller can show it elsewhere.
 */
if (process.argv[2] === "door-open") {
  let parsed;
  try {
    parsed = parseArgs({
      args: process.argv.slice(3),
      options: { control: { type: "string" }, actor: { type: "string" }, from: { type: "string" } },
      allowPositionals: true,
      strict: true,
    });
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  const { values, positionals } = parsed;
  const control = values.control ?? process.env.EP0CH_CONTROL;
  const [blockId, ...extra] = positionals;
  if (!blockId || extra.length || !control) {
    console.error("error: door-open requires one block id and a door control socket (--control or EP0CH_CONTROL)");
    process.exit(2);
  }
  const { DoorUnreachable, openInDoor } = await import("./door-control");
  try {
    const opened = await openInDoor(control, blockId, { actor: values.actor ?? "agent", ...(values.from ? { from: values.from } : {}) });
    console.log(JSON.stringify(opened));
    process.exit(0);
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(error instanceof DoorUnreachable ? 3 : 1);
  }
}
if (process.argv[2] === "ext") {
  const { runExtCommand } = await import("./extension-install");
  process.exit(await runExtCommand(process.argv.slice(3)));
}
if (process.argv[2] === "outlines" || process.argv[2] === "outline" || process.argv[2] === "init") {
  process.exit(await runOutlinesCommand(process.argv[2], process.argv.slice(3)));
}
/**
 * `publish serve [--port N] [--root DIR]… [--max-bytes N] [--base-path /pub] [--allow-host NAME]… [--artifact-cache DIR] [--public-port N] [--public-url URL] [--public-bind ADDR] [--ws NAME]`:
 * serves blocks carrying `[publish::…]` read-only on 127.0.0.1 (src/publish.ts).
 * React artifacts compile into `--artifact-cache` (default `<state root>/publish/artifacts`).
 * `--public-port` adds the public listener (only `[publish::public]` notes, no index) for
 * `tailscale funnel`; `--public-url` (or OUTLINER_PUBLIC_URL) is where anyone opens it, and
 * `--public-bind` (or OUTLINER_PUBLIC_BIND, default 127.0.0.1) the one address it listens on.
 * `publish list [--json]` prints the same index once, with each public note's public URL.
 */
if (process.argv[2] === "publish") {
  process.exit(await runPublishCommand(process.argv[3], process.argv.slice(4)));
}

async function runPublishCommand(operation: string | undefined, args: string[]): Promise<number> {
  try {
    if (operation !== "serve" && operation !== "list") {
      throw new Error("publish expects: serve [--port N] [--root DIR]… [--max-bytes N] [--base-path /pub] [--allow-host NAME]… [--artifact-cache DIR] [--public-port N] [--public-url URL] [--public-bind ADDR] [--ws NAME] | list [--public-url URL] [--json]");
    }
    const { values } = parseArgs({
      args, strict: true,
      options: {
        port: { type: "string" }, root: { type: "string", multiple: true }, "max-bytes": { type: "string" },
        "base-path": { type: "string" }, "allow-host": { type: "string", multiple: true }, ws: { type: "string" },
        "artifact-cache": { type: "string" }, "public-port": { type: "string" }, "public-url": { type: "string" },
        "public-bind": { type: "string" },
        json: { type: "boolean" },
      },
    });
    if (values.ws) process.env.EP0CH_WS = values.ws;
    const port = values.port === undefined ? 8790 : Number(values.port);
    const maxBytes = values["max-bytes"] === undefined ? undefined : Number(values["max-bytes"]);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be a port number");
    if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 1)) throw new Error("--max-bytes must be a positive integer");
    const publicPort = values["public-port"] === undefined ? undefined : Number(values["public-port"]);
    if (publicPort !== undefined && (!Number.isInteger(publicPort) || publicPort < 0 || publicPort > 65535)) throw new Error("--public-port must be a port number");
    if (publicPort !== undefined && publicPort !== 0 && publicPort === port) throw new Error("--public-port must differ from --port");
    const publicUrl = values["public-url"] ?? process.env.OUTLINER_PUBLIC_URL;
    const { checkPublicBind } = await import("./publish");
    const publicBind = checkPublicBind(values["public-bind"] ?? process.env.OUTLINER_PUBLIC_BIND ?? "127.0.0.1");
    const { Publisher, servePublisher, renderIndexText } = await import("./publish");
    const publisher = new Publisher({
      client: createOutlinerClient(resolveClientPaths()),
      roots: (values.root ?? []).map(root => resolve(root)),
      ...(maxBytes === undefined ? {} : { maxBytes }),
      ...(values["base-path"] === undefined ? {} : { basePath: values["base-path"] }),
      ...(values["allow-host"] === undefined ? {} : { allowedHosts: values["allow-host"] }),
      artifactCacheDirectory: resolve(values["artifact-cache"] ?? `${outlinesLayout().publish}/artifacts`),
      ...(publicUrl ? { publicUrl } : {}),
      log: line => console.error(line),
    });
    const status = await publisher.start();
    if (operation === "list") {
      const index = await publisher.readIndex();
      await publisher.stop();
      const listed = { ...index, entries: index.entries.map(entry => ({ ...entry, ...(entry.public ? { publicUrl: publisher.publicHref(entry) } : {}) })) };
      console.log(values.json ? JSON.stringify(listed, null, 2) : renderIndexText(index, publisher.basePath, entry => publisher.publicHref(entry)).trimEnd());
      return 0;
    }
    const server = servePublisher(publisher, port);
    // One publisher, one index; the public listener is the same publisher seen by the public audience.
    const publicServer = publicPort === undefined ? undefined : servePublisher(publisher, publicPort, "public", publicBind);
    console.log(JSON.stringify({
      status: "publishing", url: `http://127.0.0.1:${server.port}${publisher.basePath}/`,
      ...(publicServer ? { publicListener: `http://${publicBind.includes(":") ? `[${publicBind}]` : publicBind}:${publicServer.port}${publisher.publicBase.basePath}/p/…`, publicUrl: `${publisher.publicBase.origin ?? ""}${publisher.publicBase.basePath}` } : {}),
      outline: status.outline?.name ?? process.env.EP0CH_WS ?? null, roots: publisher.roots,
    }));
    const stopped = Promise.withResolvers<void>();
    for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stopped.resolve());
    await stopped.promise;
    server.stop(true);
    publicServer?.stop(true);
    await publisher.stop();
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
const paths = resolveClientPaths();

function describeHostedOutline(outline: HostedOutlineSummary): string {
  const flags = [outline.open ? "open" : "closed", ...(outline.default ? ["default"] : [])];
  return [`${outline.name}  ${flags.join("  ")}`, `  database ${outline.database}`, `  folder   ${outline.folder}`].join("\n");
}


/**
 * `outlines [--json]` lists the outline host's outlines. `outline create|import|close|delete` go through the
 * host. `init [<name>] [--folder <dir>]` names a folder's outline (PIE-530): it attaches to `<name>` (default: the
 * folder's guess, its repository's or its own name), creating it when there is none, and writes `<folder>/.ep0ch`.
 * None of them needs the invoking folder's own outline, so they run before it resolves.
 */
async function runOutlinesCommand(group: "outlines" | "outline" | "init", args: string[]): Promise<number> {
  try {
    const host = await outlineHostClient();
    const hostOrThrow = () => {
      if (!host) throw new Error(`No outline host answers at ${clientSocket(process.env, machineFor()).socket}; start it (systemctl --user start outliner-host, or bun packages/outliner/src/host-main.ts)`);
      return host;
    };
    if (group === "outlines") {
      const { values } = parseArgs({ args, strict: true, options: { json: { type: "boolean" } } });
      const listed = await listHostedOutlines(hostOrThrow());
      if (values.json) console.log(JSON.stringify({ folder: resolveOutlinesFolder(), socket: hostOrThrow().socketPath, ...listed }, null, 2));
      else console.log(listed.outlines.length ? listed.outlines.map(describeHostedOutline).join("\n\n") : `No outlines in ${resolveOutlinesFolder()}.`);
      return 0;
    }
    if (group === "init") {
      const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { json: { type: "boolean" }, folder: { type: "string" }, create: { type: "boolean" } } });
      if (positionals.length > 1) throw new Error(`init expects: [<name>] [--folder <dir>] [--create]`);
      const asked = resolve(values.folder ?? process.cwd());
      const which = whichOutlineFor(asked, { ...process.env, EP0CH_WS: "" });
      const guess = which.kind === "unnamed" ? which.guess : undefined;
      const name = positionals[0] ?? guess?.name;
      if (!name) throw new Error(which.kind === "named" ? `${which.file} already names "${which.name}"` : `${asked} is too broad to name an outline after; name one: init <name>`);
      const folder = values.folder || positionals[0] ? asked : guess!.folder;
      // $HOME, / or a folder right under / would name every folder below it: only when asked for by --folder.
      if (!values.folder && tooBroadToName(folder, process.env.HOME || homedir())) throw new Error(`${folder} is too broad to name an outline for every folder below it; run init in a project folder, or pass --folder ${folder} to mean it`);
      // On another machine's host (EP0CH_MACHINE, the folder's .ep0ch), the machine is written beside the name.
      const at = { ...process.env, OUTLINER_WORKSPACE_ROOT: folder };
      const machine = clientSocket(at, machineFor(at)).machine;
      // A name nobody has is made on this machine; on another only with --create (PIE-545).
      const attached = await attachNamedOutline(values.folder ? (await outlineHostClient(at)) ?? hostOrThrow() : hostOrThrow(), name, {
        ...(machine ? { machine } : {}), create: values.create === true, createCommand: `outliner init ${name}${values.folder ? ` --folder ${folder}` : ""} --create`,
      });
      const file = writeDotEp0ch(folder, name, { replace: true, ...(machine ? { machine } : {}) });
      console.log(values.json ? JSON.stringify({ ...attached, file }, null, 2) : `${attached.created ? "created" : "picked"} outline ${name}; ${file} names it`);
      return 0;
    }
    const [operation, ...operands] = args;
    const { values, positionals } = parseArgs({ args: operands, allowPositionals: true, strict: true, options: { json: { type: "boolean" } } });
    const print = (value: unknown, text: string) => console.log(values.json ? JSON.stringify(value, null, 2) : text);
    if (operation === "create" && positionals.length === 1) {
      const created = await hostOrThrow().request<HostedOutlineSummary>({ action: "outlines.create", name: positionals[0]! });
      print(created, describeHostedOutline(created));
    } else if (operation === "import" && positionals.length === 2) {
      const imported = await importHostedOutline(hostOrThrow(), resolve(positionals[0]!), positionals[1]!);
      print(imported, `${describeHostedOutline(imported)}\n  imported ${imported.imported.blocks} blocks, ${imported.imported.properties} properties, ${imported.imported.pageAddresses} page addresses, ${imported.imported.workIds} work ids`);
    } else if (operation === "close" && positionals.length === 1) {
      const closed = await hostOrThrow().request<HostedOutlineSummary>({ action: "outlines.close", name: positionals[0]! });
      print(closed, `closed outline ${closed.name}; its next request opens it again`);
    } else if (operation === "delete" && positionals.length === 1) {
      const deleted = await hostOrThrow().request<HostedOutlineDeletion>({ action: "outlines.delete", name: positionals[0]! });
      print(deleted, `moved outline ${deleted.name} to ${deleted.movedTo}`);
    } else {
      throw new Error(`expects: ${OUTLINE_USAGE}`);
    }
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}
/** `--author` for writes and filters: who made the change, as the service records it. */
function parseAuthor(value: string | undefined): "user" | "agent" | "system" {
  if (value === "user" || value === "agent" || value === "system") return value;
  throw new Error("--author must be user, agent, or system");
}

/** An agent must say which agent it is; the CLI's own `cli` label would hide it. */
function writerAuthor(value: string | undefined, actor: string | undefined): "user" | "agent" | "system" {
  const author = parseAuthor(value);
  if (author === "agent" && !actor?.trim()) throw new Error("--author agent requires --actor <agent id>");
  return author;
}

/** Who made a structural change: the person through the CLI unless --author/--actor say otherwise. */
function writerMutation(values: { author?: string; actor?: string; session?: string }): MutationProvenance {
  return {
    author: writerAuthor(values.author, values.actor),
    actorId: values.actor ?? "cli",
    ...(values.session ? { sessionId: values.session } : {}),
  };
}

function parseRevision(value: string | undefined): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new Error("--expected must be the positive integer revision read before editing");
  }
  return revision;
}
function parseLimit(value: string | undefined, fallback: number): number {
  const limit = value === undefined ? fallback : Number(value);
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

/** Comma-separated block fields; the service validates the names. */
function parseFields(value: string): BlockReadField[] {
  return value.split(",").map((field) => field.trim()).filter(Boolean) as BlockReadField[];
}

/** Text from exactly one of `--<file>` or `--stdin`. */
async function textInput(values: Record<string, unknown>, fileOption: string, label: string, required = true): Promise<string | undefined> {
  const file = values[fileOption] as string | undefined;
  if (file !== undefined && values.stdin) throw new Error(`${label}: use --${fileOption} or --stdin, not both`);
  if (file !== undefined) return Bun.file(file).text();
  if (values.stdin) return Bun.stdin.text();
  if (required) throw new Error(`${label} requires --${fileOption} or --stdin`);
  return undefined;
}

function workActor(values: Record<string, unknown>): WorkActor {
  const author = (values.author as string | undefined) ?? "user";
  if (author !== "user" && author !== "agent") throw new Error("--author must be user or agent");
  const actorId = (values.actor as string | undefined) ?? "cli";
  if (!actorId.trim()) throw new Error("--actor requires an actor ID");
  const sessionId = values.session as string | undefined;
  return { author, actorId, ...(sessionId ? { sessionId } : {}) };
}

/** The `work` / `note` synopsis, printed by `work help` and after an unknown operation. */
const WORK_USAGE = [
  "  work create --title T --project P --arc A --track T… --priority high|medium|low [--stage S] [--batch UUID] [--stdin|--body-file F]",
  "  work stage <item> <stage> [--expected N]",
  "  work set <item> <key> <value> [--expected N]",
  "  work set <delivery> delivery-stage complete|validate [--expected N]   (delivery: block UUID or key, e.g. PIE-123/door)",
  "  work deliver <item> --repo owner/name --pr N [--key name] [--base B] [--branch W]",
  "  work complete <item> [--delivery <uuid|key|name>]… [--all-merged] --proof-file F|--stdin|--proof-block UUID",
  "  work body <item> --file F|--stdin [--expected N]",
  "  note section <block> <heading> --file F|--stdin [--expected N]",
  "  Writers: --author user|agent --actor ID [--session ID]. <item> is a Work ID or block UUID.",
].join("\n");

const ACTOR_OPTIONS = {
  author: { type: "string" }, actor: { type: "string" }, session: { type: "string" }, expected: { type: "string" },
} as const;

/**
 * `work …` / `note …`: agent workboard operations over src/work-tools.ts.
 * Refusals print one `error: …` line and exit 1.
 */
async function runWorkCommand(group: "work" | "note", args: string[]): Promise<unknown> {
  try {
    const [operation, ...operands] = args;
    const parse = (options: ParseArgsOptionsConfig) => parseArgs({
      args: operands, allowPositionals: true, strict: true, options: { ...ACTOR_OPTIONS, ...options },
    }) as { values: Record<string, string | boolean | string[] | undefined>; positionals: string[] };
    const expected = (value: unknown) => value === undefined ? {} : { expectedRevision: parseRevision(value as string) };
    if (operation === undefined || operation === "help" || operation === "--help") {
      console.log(WORK_USAGE);
      process.exit(0);
    }
    await client.requireCompatibleService();
    if (group === "note") {
      if (operation !== "section") throw new Error("note expects: section <block> <heading> --file <path>|--stdin");
      const { values, positionals } = parse({ file: { type: "string" }, stdin: { type: "boolean" } });
      if (positionals.length !== 2) throw new Error("note section requires a block and a heading");
      const body = (await textInput(values, "file", "note section"))!;
      return await replaceNoteSection(client, positionals[0]!, positionals[1]!, body, workActor(values), expected(values.expected));
    }
    switch (operation) {
      case "create": {
        const { values, positionals } = parse({
          title: { type: "string" }, project: { type: "string" }, arc: { type: "string" },
          track: { type: "string", multiple: true }, priority: { type: "string" }, stage: { type: "string" },
          batch: { type: "string" }, "depends-on": { type: "string", multiple: true },
          "related-to": { type: "string", multiple: true }, source: { type: "string" },
          "body-file": { type: "string" }, stdin: { type: "boolean" },
        });
        if (positionals.length) throw new Error("work create takes no positional arguments");
        for (const name of ["title", "project", "arc", "track", "priority"] as const) {
          if (values[name] === undefined) throw new Error(`work create requires --${name}`);
        }
        const body = await textInput(values, "body-file", "work create", false);
        return await createWorkItem(client, {
          title: values.title as string,
          project: values.project as string,
          arc: values.arc as string,
          tracks: values.track as string[],
          priority: values.priority as RoadmapItemCreateInput["priority"],
          ...(values.stage === undefined ? {} : { workStage: values.stage as RoadmapItemCreateInput["workStage"] }),
          ...(values.batch === undefined ? {} : { workBatchId: values.batch as string }),
          ...(values["depends-on"] === undefined ? {} : { dependsOn: values["depends-on"] as string[] }),
          ...(values["related-to"] === undefined ? {} : { relatedTo: values["related-to"] as string[] }),
          ...(values.source === undefined ? {} : { sourceBlockId: values.source as string }),
          ...(body === undefined ? {} : { body }),
        }, workActor(values));
      }
      case "stage": {
        const { values, positionals } = parse({});
        if (positionals.length !== 2) throw new Error("work stage requires an item and a stage");
        return await setWorkStage(client, positionals[0]!, positionals[1]!, workActor(values), expected(values.expected));
      }
      case "set": {
        const { values, positionals } = parse({});
        if (positionals.length !== 3) throw new Error("work set requires an item, a key and a value");
        return await setWorkProperty(client, positionals[0]!, positionals[1]!, positionals[2]!, workActor(values), expected(values.expected));
      }
      case "deliver": {
        const { values, positionals } = parse({
          repo: { type: "string" }, pr: { type: "string" }, base: { type: "string" },
          branch: { type: "string" }, key: { type: "string" },
        });
        if (positionals.length !== 1) throw new Error("work deliver requires one item");
        if (!values.repo || !values.pr) throw new Error("work deliver requires --repo owner/name and --pr N");
        const number = Number(values.pr);
        if (!Number.isSafeInteger(number) || number < 1) throw new Error("--pr must be a pull request number");
        const pullRequest = await readPullRequestFacts(values.repo as string, number);
        return await deliverPullRequest(client, {
          address: positionals[0]!,
          repository: values.repo as string,
          pullRequest,
          ...(values.base === undefined ? {} : { baseBranch: values.base as string }),
          ...(values.branch === undefined ? {} : { workBranch: values.branch as string }),
          ...(values.key === undefined ? {} : { deliveryKey: values.key as string }),
        }, workActor(values));
      }
      case "complete": {
        const { values, positionals } = parse({
          delivery: { type: "string", multiple: true }, "all-merged": { type: "boolean" },
          "proof-file": { type: "string" }, "proof-block": { type: "string" }, stdin: { type: "boolean" },
        });
        if (positionals.length !== 1) throw new Error("work complete requires one item");
        const proofText = await textInput(values, "proof-file", "work complete", false);
        if ((proofText === undefined) === (values["proof-block"] === undefined)) {
          throw new Error("work complete requires proof: --proof-file, --stdin, or an existing --proof-block");
        }
        return await completeWorkItem(client, {
          task: positionals[0]!,
          ...(values.delivery === undefined ? {} : {
            deliveries: (values.delivery as string[]).flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean),
          }),
          ...(values["all-merged"] ? { allMerged: true } : {}),
          proof: proofText === undefined ? { blockId: values["proof-block"] as string } : { text: proofText },
        }, workActor(values));
      }
      case "body": {
        const { values, positionals } = parse({ file: { type: "string" }, stdin: { type: "boolean" } });
        if (positionals.length !== 1) throw new Error("work body requires one item");
        const body = (await textInput(values, "file", "work body"))!;
        return await replaceItemBody(client, positionals[0]!, body, workActor(values), expected(values.expected));
      }
      default:
        throw new Error(`work expects one of:\n${WORK_USAGE}`);
    }
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * `agent <operation> [--actor ID] [--session ID] [--json TEXT | --stdin]`: one agent operation on a JSON
 * input, printed as compact JSON. Writes are `author: agent`, attributed to --actor. A refusal exits 1
 * with the reason on stderr.
 */
async function runAgentCommand(args: string[]): Promise<number> {
  const { AGENT_OPERATIONS, runAgentOperation } = await import("./agent-tools");
  try {
    const [operation, ...flags] = args;
    if (!operation || !(AGENT_OPERATIONS as readonly string[]).includes(operation)) {
      throw new Error(`agent expects one of ${AGENT_OPERATIONS.join(", ")}, then --json '{…}' or --stdin`);
    }
    const { values } = parseArgs({
      args: flags, strict: true,
      options: { json: { type: "string" }, stdin: { type: "boolean" }, actor: { type: "string" }, session: { type: "string" } },
    });
    if ((values.json !== undefined) === Boolean(values.stdin)) throw new Error(`agent ${operation} takes its input as --json '{…}' or --stdin`);
    const input: unknown = JSON.parse(values.stdin ? await Bun.stdin.text() : values.json!);
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("the input is a JSON object");
    const actor = values.actor?.trim() ? { actorId: values.actor.trim(), ...(values.session ? { sessionId: values.session } : {}) } : undefined;
    await client.requireCompatibleService();
    const result = await runAgentOperation(client, operation as (typeof AGENT_OPERATIONS)[number], input as Record<string, unknown>, actor);
    console.log(JSON.stringify(result));
    return 0;
  } catch (error) {
    console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

const [command = "", ...rest] = process.argv.slice(2);
const client = createOutlinerClient(paths);
let request: RequestInput | null = null;
let directResult: unknown;
/** A refusal's runnable fix, said under the service's reason (`new --near` on a note that's gone). */
let refusalFix: { when: RegExp; command: string } | null = null;

switch (command) {
  case "patch-demo": {
    // A CLI demo of draft.patch's prose policy (PIE-501), not the @tidy agent (extensions/tidy): tidy the paragraph above a mark line.
    const { values } = parseArgs({
      args: rest,
      options: { block: { type: "string" }, "tidy-above": { type: "string" }, actor: { type: "string", default: "patch-demo" }, session: { type: "string" } },
      strict: true,
    });
    if (!values.block || !values["tidy-above"]) throw new Error("patch-demo requires --block <id> and --tidy-above <mark line>");
    await client.requireCompatibleService();
    const { tidyAboveMark } = await import("./draft-patch-demo");
    const read = await client.request<{ text: string; revision: number; route: string }>({ action: "drafts.read", blockId: values.block }, 10_000);
    const span = tidyAboveMark(read.text, values["tidy-above"]);
    if (!span) { directResult = { outcome: "unchanged", route: read.route, why: "nothing above the mark to tidy" }; break; }
    directResult = {
      read: read.route,
      ...(await client.request<object>({
        action: "draft.patch", blockId: values.block, revision: read.revision, patches: [span],
        mark: { text: values["tidy-above"] }, policy: "prose",
        mutation: { author: "agent", actorId: values.actor!, ...(values.session ? { sessionId: values.session } : {}) },
      }, 15_000)),
    };
    break;
  }
  case "mentions": {
    const operation=rest[0]??"list";
    if(operation==="ingest") request={action:"mentions.ingest",message:JSON.parse(await Bun.stdin.text())};
    else if(operation==="list"){
      // One conversation's (both --agent and --session, as the Tree's s key scopes it), newest first, at most --limit.
      const {values}=parseArgs({args:rest.slice(1),strict:true,options:{agent:{type:"string"},session:{type:"string"},limit:{type:"string"}}});
      if((values.agent===undefined)!==(values.session===undefined))throw Error("mentions list scopes to one conversation: give both --agent and --session, or neither");
      if(values.limit!==undefined&&!/^\d+$/.test(values.limit))throw Error("--limit must be a whole number, 1 to 100");
      request={action:"mentions.list",...values.agent!==undefined?{scope:{agent:values.agent,sessionId:values.session!}}:{},...values.limit!==undefined?{limit:Number(values.limit)}:{}};
    }
    else if(operation==="clear") request={action:"mentions.clear"};
    else throw Error("mentions expects ingest (JSON stdin), list [--agent <a> --session <id>] [--limit <n>], or clear");
    break;
  }
  case "view": {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true, strict: true,
      options: { limit: { type: "string" }, offset: { type: "string" }, expected: { type: "string" } },
    });
    if (positionals.length !== 1) throw new Error("view requires one saved virtual-branch block ID");
    const offset = values.offset === undefined ? undefined : Number(values.offset);
    if (offset !== undefined && (!/^\d+$/.test(values.offset!) || !Number.isSafeInteger(offset))) {
      throw new Error("--offset must be a non-negative integer");
    }
    await client.requireCompatibleService();
    directResult = await readSavedView(client, positionals[0]!, {
      ...(values.limit === undefined ? {} : { limit: parseLimit(values.limit, 200) }),
      ...(offset === undefined ? {} : { offset }),
      ...(values.expected === undefined ? {} : { expectedRevision: parseRevision(values.expected) }),
    });
    break;
  }
  case "ticket": {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true, strict: true,
      options: { line: { type: "string" } },
    });
    if (positionals.length !== 1) throw new Error("ticket requires one block ID");
    const line = values.line === undefined ? undefined : Number(values.line);
    if (line !== undefined && (!/^\d+$/.test(values.line!) || !Number.isSafeInteger(line))) {
      throw new Error("--line must be a non-negative integer");
    }
    await client.requireCompatibleService();
    request = { action: "resources.projection.read", blockId: positionals[0]!, ...(line === undefined ? {} : { line }) };
    break;
  }
  case "properties-preview": {
    const { values } = parseArgs({
      args: rest, strict: true,
      options: { text: { type: "string" }, stdin: { type: "boolean" } },
    });
    if ((values.text !== undefined) === Boolean(values.stdin)) {
      throw new Error("properties-preview requires either --text or --stdin");
    }
    await client.requireCompatibleService();
    request = { action: "properties.preview", text: values.stdin ? await Bun.stdin.text() : values.text! };
    break;
  }
  case "list": {
    const { values } = parseArgs({
      args: rest,
      options: {
        filter: { type: "string", multiple: true },
        query: { type: "string" },
        text: { type: "string" },
        limit: { type: "string" },
        subtree: { type: "string" },
        "property-scope": { type: "string" },
        fields: { type: "string" },
      },
      strict: true,
    });
    const filters = values.filter?.map((filter) => parsePropertyFilterClause(filter));
    const limit = parseLimit(values.limit, 500);
    const query: BlockSearchQuery = {
      filters,
      ...(values.query === undefined ? {} : { expression: values.query }),
      text: values.text,
      subtreeRootId: values.subtree,
      propertyScope: values["property-scope"] === undefined
        ? undefined
        : normalizePropertyQueryScope(values["property-scope"]),
      limit,
    };
    // An older service ignores `expression` and would return unfiltered results.
    if (query.expression !== undefined) await client.requireCompatibleService();
    request = {
      action: "blocks.query",
      query,
      ...(values.fields === undefined ? {} : { fields: parseFields(values.fields) }),
    };
    break;
  }
  case "read": {
    const { values, positionals } = parseArgs({
      args: rest, allowPositionals: true, strict: true,
      options: { fields: { type: "string" } },
    });
    if (positionals.length === 0) throw new Error("read requires one or more block IDs");
    await client.requireCompatibleService();
    request = {
      action: "blocks.read",
      ids: positionals,
      ...(values.fields === undefined ? {} : { fields: parseFields(values.fields) }),
    };
    break;
  }
  case "comment": {
    const {values} = parseArgs({args: rest, strict: true, options: {
      id: {type: "string"}, expected: {type: "string"}, text: {type: "string"}, stdin: {type: "boolean"},
      "request-id": {type: "string"}, quote: {type: "string"}, start: {type: "string"},
      prefix: {type: "string"}, suffix: {type: "string"}, item: {type: "string"}, whole: {type: "boolean"},
      author: {type: "string", default: "user"}, actor: {type: "string"}, session: {type: "string"},
    }});
    if (!values.id || !values["request-id"]) throw new Error("comment requires --id and a stable --request-id");
    if (values.whole === (values.quote !== undefined) || (!values.whole && values.quote === undefined)) {
      throw new Error("Choose either --quote with exact source text or --whole for a whole-block comment");
    }
    if (values.whole && [values.start, values.prefix, values.suffix, values.item].some(value => value !== undefined)) {
      throw new Error("Passage context cannot be used with --whole");
    }
    if ((values.text !== undefined) === Boolean(values.stdin)) throw new Error("comment requires either --text or --stdin");
    const body = values.stdin ? await Bun.stdin.text() : values.text!;
    const start = values.start === undefined ? undefined : Number(values.start);
    if (start !== undefined && (!Number.isSafeInteger(start) || start < 0)) throw new Error("--start must be a non-negative UTF-16 source offset");
    await client.requireCompatibleService();
    // An agent's comment says which agent (--author agent --actor <id>); the person's stays the default.
    const author = writerAuthor(values.author, values.actor);
    if (author === "system") throw new Error("--author must be user or agent for a comment");
    directResult = await createBlockComment(client, {
      requestId: values["request-id"], author,
      ...(author === "agent" ? {provenance: {actorId: values.actor!, ...(values.session ? {sessionId: values.session} : {})}} : {}),
      input: {blockId: values.id, expectedRevision: parseRevision(values.expected), body, source: author,
        ...(values.whole ? {} : {passage: {quote: values.quote!, start, prefix: values.prefix, suffix: values.suffix, itemId: values.item}})},
    });
    break;
  }
  case "capture": {
    const { values } = parseArgs({
      args: rest,
      options: {
        text: { type: "string" },
        stdin: { type: "boolean" },
        "request-id": { type: "string" },
        "captured-from": { type: "string" },
      },
      strict: true,
    });
    if (values.text !== undefined && values.stdin) {
      throw new Error("capture accepts either --text or --stdin, not both");
    }
    const readStdin =
      values.stdin === true || (values.text === undefined && process.stdin.isTTY !== true);
    if (values.text === undefined && !readStdin) {
      throw new Error("capture requires --text or stdin");
    }
    const text = values.text ?? await Bun.stdin.text();
    await client.requireCompatibleService();
    request = {
      action: "capture.create",
      requestId: values["request-id"] ?? crypto.randomUUID(),
      text,
      source: "cli",
      capturedFromBlockId: values["captured-from"],
      author: "user",
    };
    break;
  }
  case "create": {
    const { values } = parseArgs({
      args: rest,
      options: {
        text: { type: "string" },
        parent: { type: "string" },
        author: { type: "string", default: "user" },
        actor: { type: "string" },
        session: { type: "string" },
      },
      strict: true,
    });
    if (!values.text) throw new Error("create requires --text");
    const author = writerAuthor(values.author, values.actor);
    request = {
      action: "create",
      text: values.text,
      parentId: values.parent ?? null,
      author,
      ...(values.actor ? { provenance: { actorId: values.actor, ...(values.session ? { sessionId: values.session } : {}) } } : {}),
    };
    break;
  }
  case "new": {
    const { values } = parseArgs({
      args: rest,
      options: {
        text: { type: "string" },
        near: { type: "string" },
        author: { type: "string", default: "user" },
        actor: { type: "string" },
        session: { type: "string" },
      },
      strict: true,
    });
    const author = writerAuthor(values.author, values.actor);
    await client.requireCompatibleService();
    request = {
      action: "notes.create",
      text: values.text ?? "",
      intent: { kind: "note", ...(values.near ? { near: values.near, nearOnly: true } : {}) },
      author,
      ...(values.actor ? { provenance: { actorId: values.actor, ...(values.session ? { sessionId: values.session } : {}) } } : {}),
    };
    if (values.near) {
      const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
      const ws = process.env.EP0CH_WS ? `--ws ${quote(process.env.EP0CH_WS)} ` : "";
      refusalFix = { when: /^No live note /, command: `outliner ${ws}new${values.text ? ` --text ${quote(values.text)}` : ""}` };
    }
    break;
  }
  case "update": {
    const { values } = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        text: { type: "string" },
        expected: { type: "string" },
        author: { type: "string", default: "user" },
        actor: { type: "string" },
        session: { type: "string" },
      },
      strict: true,
    });
    if (!values.id || values.text === undefined) throw new Error("update requires --id and --text");
    request = {
      action: "update",
      blockId: values.id,
      text: values.text,
      expectedRevision: parseRevision(values.expected),
      mutation: writerMutation(values),
    };
    break;
  }
  case "move": {
    const { values } = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        parent: { type: "string" },
        position: { type: "string" },
        author: { type: "string", default: "user" },
        actor: { type: "string" },
        session: { type: "string" },
      },
      strict: true,
    });
    if (!values.id || !values.parent) throw new Error("move requires --id and --parent");
    request = {
      action: "move",
      blockId: values.id,
      parentId: values.parent === "root" ? null : values.parent,
      position: values.position ? Number(values.position) : undefined,
      mutation: writerMutation(values),
    };
    break;
  }
  case "activity": {
    const { values } = parseArgs({
      args: rest,
      options: {
        limit: { type: "string" },
        since: { type: "string" },
        after: { type: "string" },
        author: { type: "string" },
        kinds: { type: "string" },
        actor: { type: "string" },
      },
      strict: true,
    });
    if (values.actor !== undefined) await client.requireCompatibleService();
    request = {
      action: "activity.recent",
      ...(values.actor !== undefined ? { actorId: values.actor } : {}),
      ...(values.kinds ? { kinds: values.kinds.split(",").map(kind => kind.trim()).filter(Boolean) as BlockActivityKind[] } : {}),
      ...(values.limit ? { limit: parseRevision(values.limit) } : {}),
      ...(values.since ? { since: values.since } : {}),
      ...(values.after ? { afterCursor: parseRevision(values.after) } : {}),
      ...(values.author ? { author: parseAuthor(values.author) } : {}),
    };
    break;
  }
  case "delete":
  case "restore": {
    const { values } = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        author: { type: "string", default: "user" },
        actor: { type: "string" },
        session: { type: "string" },
        expected: { type: "string" },
        "if-empty": { type: "boolean" },
      },
      strict: true,
    });
    if (!values.id) throw new Error(`${command} requires --id`);
    if (values.expected !== undefined && command !== "delete") throw new Error("--expected is for delete: trash only the block at that revision");
    if (values["if-empty"] && command !== "delete") throw new Error("--if-empty is for delete: trash only a block with no text and no children");
    request = command === "delete"
      ? { action: "delete", blockId: values.id, ...(values.expected !== undefined ? { expectedRevision: parseRevision(values.expected) } : {}), ...(values["if-empty"] ? { ifEmpty: true } : {}), mutation: writerMutation(values) }
      : { action: "trash.restore", blockId: values.id, mutation: writerMutation(values) };
    break;
  }
  case "select": {
    const { values } = parseArgs({
      args: rest,
      options: { id: { type: "string" } },
      strict: true,
    });
    if (!values.id) throw new Error("select requires --id");
    request = { action: "selection.set", blockId: values.id };
    break;
  }
  case "goto": {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        query: { type: "string" },
        limit: { type: "string" },
        client: { type: "string" },
      },
      allowPositionals: true,
      strict: true,
    });
    const query = values.query ?? positionals.join(" ");
    if (!query.trim()) throw new Error("goto requires a block ID, short prefix, or text query");
    const limit = parseLimit(values.limit, 10);
    if (values.client !== undefined) {
      await requireClientIdForRole(client, values.client, "tree");
    }
    const focused = await focusBlockByQuery(client, query, limit, values.client);
    if (focused.resolution.kind === "none") {
      throw new Error(`No block matches: ${query}`);
    }
    if (focused.resolution.kind === "ambiguous") {
      directResult = {
        focused: false,
        query,
        candidates: focused.resolution.matches.map((match) => ({
          id: match.block.id,
          label: formatBlockFocusMatch(match, match.block.id),
          kind: match.kind,
        })),
      };
      process.exitCode = 2;
      break;
    }
    directResult = {
      focused: true,
      id: focused.resolution.match.block.id,
      title: focused.resolution.match.title,
      kind: focused.resolution.match.kind,
    };
    break;
  }
  case "resolve": {
    // Read-only: an unresolved page address is an error, never a new page.
    const [url, ...extra] = rest;
    if (!url || extra.length) throw new Error("resolve requires one pi-outliner URL");
    const resolved = await resolveOutlinerLinkTarget(client, parseOutlinerLinkUri(url), { followMissingPages: false });
    directResult = {
      id: resolved.block.id,
      title: blockDisplayTitle(resolved.block),
      ...(resolved.fragmentId ? { fragmentId: resolved.fragmentId } : {}),
      ...(resolved.block.effectiveDeletedRootId ? { deleted: true } : {}),
    };
    break;
  }
  case "link": {
    const { values, positionals } = parseArgs({
      args: rest,
      options: {
        url: { type: "string" },
        "source-client": { type: "string" },
        "source-region": { type: "string" },
        "detail-client": { type: "string" },
        "tree-client": { type: "string" },
        "no-focus": { type: "boolean" },
      },
      allowPositionals: true,
      strict: true,
    });
    if (positionals.length > 1 || (values.url !== undefined && positionals.length > 0)) {
      throw new Error("link accepts one URL, either positional or --url");
    }
    const url = values.url ?? positionals[0];
    if (!url) throw new Error("link requires a pi-outliner URL");
    const sourceClientId = values["source-client"];
    const sourceRegion = values["source-region"];
    const detailClientId = values["detail-client"];
    const treeClientId = values["tree-client"];
    for (const name of ["source-client", "detail-client", "tree-client"] as const) {
      if (values[name] !== undefined && !values[name].trim()) throw new Error(`--${name} requires a client ID`);
    }
    if (sourceRegion !== undefined && sourceRegion !== "tree" && sourceRegion !== "detail") {
      throw new Error("--source-region must be tree or detail");
    }
    if (sourceRegion !== undefined && !sourceClientId) {
      throw new Error("--source-region requires --source-client");
    }
    if ([sourceClientId, detailClientId, treeClientId].filter(value => value !== undefined).length > 1) {
      throw new Error("Use only one of --source-client, --detail-client, or --tree-client");
    }
    const target = parseOutlinerLinkUri(url);
    const resourceTarget = target.kind === "resource" || target.kind === "reference";
    if (detailClientId && target.kind === "goto") {
      throw new Error("goto URLs require --tree-client, not --detail-client");
    }
    if (values["no-focus"] && !detailClientId) {
      throw new Error("--no-focus requires --detail-client");
    }
    if (treeClientId && resourceTarget) {
      throw new Error("Resource and reference URLs require --detail-client or --source-client");
    }
    if (sourceClientId && target.kind === "goto") {
      throw new Error("goto URLs require --tree-client, not --source-client");
    }
    directResult = await navigateOutlinerLink(client, url, {
      sourceClientId, sourceRegion, detailClientId, treeClientId,
      ...(values["no-focus"] ? { focus: false } : {}),
    });
    break;
  }
  case "work":
  case "note": {
    directResult = await runWorkCommand(command, rest);
    break;
  }
  case "agent": {
    // The outline operations the Claude mod's outline_* tools run (src/agent-tools.ts): JSON in, compact JSON out.
    process.exit(await runAgentCommand(rest));
  }
  case "work-id-status":
    request = { action: "work-ids.status" };
    break;
  case "work-id-configure": {
    const { values } = parseArgs({
      args: rest,
      options: { prefix: { type: "string" } },
      strict: true,
    });
    if (!values.prefix) throw new Error("work-id-configure requires --prefix");
    request = { action: "work-ids.configure", prefix: values.prefix };
    break;
  }
  case "work-id-allocate": {
    const { values } = parseArgs({
      args: rest,
      options: {
        id: { type: "string" },
        expected: { type: "string" },
      },
      strict: true,
    });
    if (!values.id || !values.expected) {
      throw new Error("work-id-allocate requires --id and --expected");
    }
    request = {
      action: "work-ids.allocate",
      blockId: values.id,
      expectedRevision: parseRevision(values.expected),
    };
    break;
  }
  case "changes": {
    const { values } = parseArgs({
      args: rest,
      options: { since: { type: "string" }, limit: { type: "string" } },
      strict: true,
    });
    const sequence =
      values.since !== undefined && /^\d+$/.test(values.since) ? Number(values.since) : Number.NaN;
    if (!Number.isSafeInteger(sequence)) {
      throw new Error("changes requires --since <sequence>, a non-negative integer");
    }
    await client.requireCompatibleService();
    request = {
      action: "changes.since",
      sequence,
      ...(values.limit === undefined ? {} : { limit: parseLimit(values.limit, 200) }),
    };
    break;
  }
  case "selection":
    request = { action: "selection.get" };
    break;
  case "clients": {
    const { values } = parseArgs({
      args: rest,
      options: {
        role: { type: "string" },
      },
      strict: true,
    });
    if (values.role !== undefined && values.role !== "tree" && values.role !== "detail" && values.role !== "composed" && values.role !== "observer") {
      throw new Error("clients --role must be tree, detail, composed, or observer");
    }
    request = {
      action: "clients.list",
      ...(values.role ? { role: values.role } : {}),
    };
    break;
  }
  default:
    console.error(`error: unknown command: ${command}; outliner --help lists them`);
    process.exit(2);
}

// Older services treat an absent timestamp token as an unconditional update.
// Never send the integer contract to one of those services.
if (request && "expectedRevision" in request) await client.requireCompatibleService();
// An older service would move or trash without recording who did it.
if (request && (["move", "delete", "trash.restore"].includes(request.action) || "kinds" in request)) {
  await client.requireCompatibleService();
}
let result: unknown;
try {
  result = request ? await client.request(request) : directResult;
} catch (error) {
  if (refusalFix && error instanceof Error && refusalFix.when.test(error.message)) {
    console.error(`error: ${error.message}\n  to make it in the Inbox instead: ${refusalFix.command}`);
    process.exit(1);
  }
  // Query syntax errors carry a position; print it as data instead of a stack trace.
  if (error instanceof OutlinerRequestError && error.problem) {
    console.error(JSON.stringify({ error: error.message, problem: error.problem }, null, 2));
    process.exit(1);
  }
  throw error;
}
if (command === "capture") {
  const receipt = result as CaptureReceipt;
  const capturedFromBlockId = receipt.block.properties.find(
    (property) => property.key === "captured-from",
  )?.value;
  console.log(JSON.stringify({
    blockId: receipt.block.id,
    inboxBlockId: receipt.inboxBlockId,
    source: "cli",
    ...(capturedFromBlockId ? { capturedFromBlockId } : {}),
    deduplicated: receipt.deduplicated,
  }, null, 2));
} else if (command === "mentions" && (rest[0] ?? "list") === "list") {
  // Each entry with the title Tree and Detail show for it (its block's, else the address it was written as).
  const found = result as MentionCollection;
  console.log(JSON.stringify({ ...found, entries: found.entries.map(entry => ({ ...entry, title: entry.block ? blockDisplayTitle(entry.block) : entry.address })) }, null, 2));
} else {
  console.log(JSON.stringify(result, null, 2));
}

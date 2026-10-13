// EchoNet's tosser (PIE-779, PIE-792): this outline is a node, `name@machine`, on a FidoNet-style store-and-forward
// network of outlines. Nodes mail (ADR 0005): a node never writes another outline's blocks. Each one publishes a
// bulletin (what its areas offer) and hands packets (netmail, seen-by marks) to the nodes whose notes they're about;
// each outline's own tosser writes its own blocks, from the bulletins it reads and the packets it was handed. Nothing
// here reads the MCP access level: that knob is for agents. What consents is this outline's own notes: an area
// (`[echo::]` on a view) offers, a subscription (`[subscribe::] [echo::]`) asks. One run ("a toss"):
//
//   1. calls, when this node dials in (its inbound ssh off or gated, `notes.address`'s `dialsIn`): it takes the
//      packets each node on another machine holds for it, since none of them can hand it anything.
//   2. imports its inbound (`<outlines>/<name>/echonet/inbound/`): netmail onto its originals as comments, seen-by
//      marks, and the bulletin of a node that dials in (kept for the subscriptions that name it). An item about a note
//      it doesn't offer is logged and dropped.
//   3. writes its bulletin (`echonet/bulletin.json`): its areas' messages and the notes under them, the originals
//      other nodes hold copies of, the netmail threads on those, the seen-by marks.
//   4. echomail in: each subscription here reads the bulletin of every node its mask matches (asked of that node's host,
//      through the relay on another machine; a node that dials in left its own) and copies what's new under a source
//      board per node, from its `since`, at most `cap` a toss. A copy is a local note: edit it, move it, trash it; a
//      newer original is a marker (`[upstream-newer::n]`), a gone one `[upstream-gone::<day>]`.
//   5. netmail out: a comment on a copy, and the seen-by mark for each new copy, go into a packet for the origin, handed
//      to its host now, or held here (`echonet/outbound/<node>/`) for a node that dials in until it calls. Replies
//      written at the origin come back from its bulletin into the copy's thread.
//   6. the nodelist (`Nodelist [type::nodelist]`) is written again, with a `[type::toss]` log under it.
//
// Nothing that came over the network goes out again: a copy is never a message (shapes.ts), and a mark that came in
// carries `netmail-from`. Offline is normal: a node that can't be reached is said in the nodelist, and what this node
// has for it waits.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { outline, type OutlineRequest, type Route } from "./outline";
import {
  areaQuery, areasIn, type Block, firstLine, FROM, fromOf, glob, hasStar, isCopy, isMark, isMarkCopy, isMessage, kindOf, type Mask, masksIn, postsTo,
  type Node, nodeOf, parseMask, parseNode, prop, sameMachine, setHeaderProperty, trashed, values,
} from "./shapes";

interface Target { passage?: { quote?: string }; anchor?: { kind: string; exact?: string } }
interface Mark {
  block: Block; body: string; source: "user" | "agent"; properties?: Record<string, string[]>;
  originalTarget?: Target; resolvedTarget?: Target | null;
}
interface Thread extends Mark { replies: Mark[] }

interface Request {
  operation: "act";
  input: {
    action: "toss" | "nodelist" | "take-newer" | "compare-newer";
    context: { now: string; block?: Block };
    scheduled?: { at: string };
  };
  config: { offline?: string[]; keepLogs?: number; cap?: number; undeliverableAfter?: number };
}

const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const { input, config } = (await Bun.stdin.json()) as Request;
const now = input.context.now;
/** New messages copied per source each toss when a subscription doesn't say (`[cap::n]`). */
const CAP = config.cap ?? 25;
/** Tosses netmail waits for an original that is gone before it becomes an undeliverable note. */
const TRIES = config.undeliverableAfter ?? 3;
const LIMIT = 1000;

const address = await outline<{ outline?: string; machine: string; aliases?: string[]; dialsIn?: boolean }>({ action: "notes.address" });
const self = nodeOf(process.env.EP0CH_WS ?? address.outline ?? "unknown", address.machine);

// ── one node, one name ──
//
// A machine is named by its person (`<outlines>/.host/machine-name`, `ep0ch install --apply`), else by its host name.
// Before it had a name, its tosser signed with its host name's form, while other machines reach it by an ssh name.
// Each node's bulletin says the names it went by, so a mark under an old name is the same node's.

/** The names this node went by: its own, then its machine's older ones. */
const selfIds = [self.id, ...(address.aliases ?? []).map((machine) => nodeOf(self.outline, machine).id)];
const isSelf = (id: string | undefined) => id !== undefined && selfIds.some((mine_) => mine_.toLowerCase() === id.toLowerCase());
const selfMachine = (machine: string) => [self.machine, ...(address.aliases ?? [])].some((name) => sameMachine(name, machine));
/** Whether a `netmail-from` (`<node>/<mark>`) is this node's, under any name it went by. */
const sentHere = (key: string | undefined, markId: string) => key !== undefined && key.endsWith(`/${markId}`) && isSelf(key.slice(0, -markId.length - 1));
/** Another node's other names, learned from its bulletin: `<outline>@<name>` → its id here. */
const aliasOf = new Map<string, string>();
/** The other names `id` goes by, as learned: what the nodelist says under it. */
const akaOf = (id: string) => [...aliasOf].filter(([, to]) => to === id).map(([from]) => from);
/** A node id as this node knows it: its own name for itself, another node's by how it is reached from here. */
function canonical(id: string): string {
  if (isSelf(id)) return self.id;
  const known = [...aliasOf].find(([from]) => from.toLowerCase() === id.toLowerCase());
  return known?.[1] ?? id;
}

// ── this outline's mail folder ──

const mine = <T>(request: OutlineRequest) => outline<T>(request);
const remote = (machine: string) => !selfMachine(machine);

/** This host's outlines folder, from its socket (`<outlines>/.host/host.sock`); undefined when it isn't laid out so. */
function outlinesFolder(): string | undefined {
  const socket = process.env.EP0CH_SOCKET;
  return socket && basename(dirname(socket)) === ".host" ? dirname(dirname(socket)) : undefined;
}
/** `<outlines>/<this outline>/echonet`: its bulletin, inbound, outbound and the bulletins left by nodes that dial in. */
const box = (() => {
  const folder = outlinesFolder();
  return folder ? join(folder, self.outline, "echonet") : undefined;
})();
const boxPath = (...parts: string[]) => {
  if (!box) throw new Error("EchoNet keeps its mail beside the outline: this outline isn't served from an outlines folder (<outlines>/.host/host.sock)");
  return join(box, ...parts);
};
/** A file written whole and then renamed, so no reader sees half of it. */
function writeWhole(file: string, value: unknown): void {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.${basename(file)}.${process.pid}.tmp`);
  writeFileSync(temporary, JSON.stringify(value));
  renameSync(temporary, file);
}
const readJson = <T>(file: string): T | undefined => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return undefined; } };
const jsonFiles = (dir: string) => { try { return readdirSync(dir).filter((file) => file.endsWith(".json") && !file.startsWith(".")).sort(); } catch { return []; } };
const stamp = () => `${new Date().toISOString().replace(/[:.]/g, "-")}-${crypto.randomUUID().slice(0, 8)}`;

/**
 * One toss at a time per outline: the schedule, a packet's arrival and `ep0ch echo toss` can each start one. A run
 * that finds another going waits for it, up to a minute; a lock older than five minutes is a run that died.
 */
async function lock(wait: boolean): Promise<(() => void) | undefined> {
  const file = boxPath("toss.lock");
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; ; tries += 1) {
    try {
      writeFileSync(file, `${process.pid} ${now}\n`, { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch {
      try { if (Date.now() - statSync(file).mtimeMs > 5 * 60_000) { rmSync(file, { force: true }); continue; } } catch { continue; }
      if (!wait || tries > 600) return undefined;
      await Bun.sleep(100);
    }
  }
}

// ── bulletins and packets: what passes between nodes ──

/** What a node publishes: its areas' messages and what other nodes need to keep their copies and netmail current. */
interface Bulletin {
  node: string; machine: string; aliases: string[]; dialsIn: boolean; at: string;
  /** Every note it publishes, by id: its `echo` notes, its areas' messages and the notes under them, the originals copied. */
  blocks: Record<string, Block>;
  /** The notes carrying `echo` (areas and postings), newest first: what `areasIn` reads. */
  tagged: string[];
  /** Each area view's messages (its query's answer), newest first. */
  areaResults: Record<string, string[]>;
  children: Record<string, string[]>;
  /** The netmail threads on its originals (comments that came over the network, with their replies). */
  threads: Record<string, Thread[]>;
  /** The nodes that left a seen-by mark on each original. */
  seenBy: Record<string, string[]>;
  /** The pages its messages link to (`[[name]]`): their note, or null when there is none. */
  pages: Record<string, string | null>;
  /** Its subscriptions (`<areas> from <masks>`) and its last toss, for the nodelist. */
  subscriptions: string[];
  lastToss?: string;
}

/** What a node hands another: items about the receiver's own notes, and, from a node that dials in, its bulletin. */
interface Packet { from: string; at: string; aliases?: string[]; dialsIn?: boolean; bulletin?: Bulletin; items: Item[]; tries?: number }
type Item =
  /** A copy of the original was made there: one whole-note mark "also in: <from>". */
  | { kind: "seen-by"; original: string; copy: string; area: string }
  /** A comment on a copy, for the original: at its words when they're still there, else on the whole note, quoting them. */
  | { kind: "netmail"; original: string; key: string; body: string; quote?: string; properties: Record<string, string[]>; author: string }
  /** A reply on the copy's thread, for the thread `thread` (its netmail-from) on the original. */
  | { kind: "reply"; original: string; thread: string; key: string; body: string; author: string }
  /** A comment on a copy of a comment: a reply in the original comment's thread (`root`, the comment there). */
  | { kind: "thread-reply"; original: string; root: string; key: string; body: string; author: string };

/** A node's published notes, as the tosser reads them: from its bulletin, never its blocks. */
interface Origin {
  readonly node: Node;
  readonly bulletin: Bulletin;
  get(id: string): Block | null;
  tagged(): Block[];
  areaMessages(area: Block): Block[];
  children(id: string): Block[];
  threads(id: string): Thread[];
  seenBy(id: string): string[];
  page(name: string): string | null | undefined;
}
function originOf(node: Node, bulletin: Bulletin): Origin {
  const get = (id: string) => bulletin.blocks[id] ?? null;
  const many = (ids: string[] | undefined) => (ids ?? []).map((id) => bulletin.blocks[id]).filter((block): block is Block => !!block);
  return {
    node, bulletin, get,
    tagged: () => many(bulletin.tagged),
    areaMessages: (area) => many(bulletin.areaResults[area.id]),
    children: (id) => many(bulletin.children[id]),
    threads: (id) => bulletin.threads[id] ?? [],
    seenBy: (id) => bulletin.seenBy[id] ?? [],
    page: (name) => (name in bulletin.pages ? bulletin.pages[name] : undefined),
  };
}

// ── nodes ──

/** How this node reaches another: its bulletin (asked of its host, or left here by a node that dials in) and its mail. */
interface Link {
  readonly node: Node;
  /** Whether its host answers: packets for it are handed over now. */
  readonly reachable: boolean;
  /** Why not, when it isn't (offline, no forward, another protocol), or how it is reached when it dials in. */
  readonly why?: string;
  /** It dials in: never called from here; its last call. */
  readonly dialsIn?: { readonly lastCall?: string };
  /** What it publishes, when this node has its bulletin. */
  readonly origin?: Origin;
  readonly route?: Route;
}
const links = new Map<string, Link>();

async function linkTo(node: Node): Promise<Link> {
  const known = links.get(node.id);
  if (known) return known;
  let link: Link;
  const dialing = dialsInFrom(node);
  const left = () => {
    // The bulletin a node that dials in left at its last call.
    const bulletin = box ? readJson<Bulletin>(boxPath("bulletins", `${node.id}.json`)) : undefined;
    return bulletin ? originOf(node, bulletin) : undefined;
  };
  if ((config.offline ?? []).includes(node.id)) link = { node, reachable: false, why: "offline (config.json's offline list)" };
  else if (dialing) {
    const origin = left();
    link = { node, reachable: false, why: `it dials in: ${dialing.lastCall ? `last call ${when(dialing.lastCall)}` : "it hasn't called yet"}`, dialsIn: dialing, ...(origin ? { origin } : {}) };
  } else {
    // Another machine: its host is asked through the shared ssh forward, started when nobody has (the first contact
    // waits for ssh); a machine or host that doesn't answer is offline for this toss.
    const route: Route = { outline: node.outline, ...(remote(node.machine) ? { machine: node.machine, timeoutMs: 60_000 } : {}) };
    try {
      const { bulletin } = await outline<{ bulletin: Bulletin | null }>({ action: "echonet.bulletin" }, route);
      link = { node, reachable: true, route, ...(bulletin ? { origin: originOf(node, bulletin) } : {}) };
    } catch (error) {
      link = { node, reachable: false, why: error instanceof Error ? error.message.split("\n")[0]! : String(error), route };
    }
  }
  // What it calls itself, and the names it went by: a mark it left under one of them is its.
  const said = link.origin?.bulletin;
  if (said) for (const name of [said.machine, ...said.aliases]) if (name && !sameMachine(name, node.machine)) aliasOf.set(nodeOf(node.outline, name).id, node.id);
  links.set(node.id, link);
  return link;
}

/** The machines a `*` machine mask can match: this one, each with a forward or a machine file, and each named outright. */
function knownMachines(named: readonly string[]): string[] {
  const found = [self.machine, ...named.filter((machine) => !hasStar(machine))];
  const folder = outlinesFolder();
  if (folder) {
    try {
      for (const file of readdirSync(join(folder, ".remote"))) {
        const match = file.match(/^(.+)\.(json|sock)$/);
        if (match) found.push(match[1]!);
      }
    } catch { /* no forward yet */ }
  }
  const out: string[] = [];
  for (const machine of found) if (!out.some((seen) => sameMachine(seen, machine))) out.push(machine);
  return out;
}

// ── machines that dial in (PIE-562) ──
//
// A machine whose inbound ssh is off or gated (a laptop under a work policy) calls the others and is never called. It
// says so itself (`<outlines>/.host/dials-in`, `notes.address`'s `dialsIn`), and each node it calls learns it from the
// packet it leaves, recorded as `call <node> -> <time>` in this node's ledger. `<outlines>/.remote/<machine>.json`
// here can say it outright: `"dialsIn": true` before the first call, `false` to call it again.

/** Each node's last call here (`call <node> -> <time>` in this node's ledger), read once a run. */
let calls = new Map<string, string>();
/** The calls a ledger records, and the old names each caller said it went by (learned as `aliasOf`). */
function callsIn(ledger: Ledger): Map<string, string> {
  for (const [key, to] of ledger.lines) if (key.startsWith("aka ") && !isSelf(to)) aliasOf.set(key.slice(4), to);
  return new Map([...ledger.lines].filter(([key]) => key.startsWith("call ")).map(([key, at]) => [key.slice(5), at]));
}

/** What `<outlines>/.remote/<machine>.json` says of a machine's dialing in: true, false, or nothing. */
function dialsInSetting(machine: string): boolean | undefined {
  const folder = outlinesFolder();
  if (!folder) return undefined;
  const value = readJson<{ dialsIn?: unknown }>(join(folder, ".remote", `${machine}.json`))?.dialsIn;
  return typeof value === "boolean" ? value : undefined;
}

/** Whether a machine dials in, as this node knows: its file here, else whether any node on it has called. */
function machineDialsIn(machine: string): boolean {
  if (selfMachine(machine)) return false;
  const said = dialsInSetting(machine);
  return said ?? [...calls.keys()].some((id) => { const node = parseNode(id); return !!node && sameMachine(node.machine, machine); });
}

/** A node that dials in, with its last call here; undefined for one this node calls. */
function dialsInFrom(node: Node): { lastCall?: string } | undefined {
  if (!machineDialsIn(node.machine)) return undefined;
  const at = [...calls].find(([id]) => id.toLowerCase() === node.id.toLowerCase())?.[1];
  return at ? { lastCall: at } : {};
}

/** A time as a nodelist line says it: `2026-10-12 14:02 UTC`. */
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** The outlines on a machine that publish a bulletin: what a `*` outline mask can match there. */
const listed = new Map<string, Promise<string[]>>();
function outlinesOn(machine: string): Promise<string[]> {
  const key = machine.toLowerCase();
  // A machine that dials in isn't asked: its outlines are the ones that have called.
  if (!listed.has(key) && machineDialsIn(machine)) {
    listed.set(key, Promise.resolve([...calls.keys()].map(parseNode).filter((node): node is Node => !!node && sameMachine(node.machine, machine)).map((node) => node.outline)));
  }
  if (!listed.has(key)) {
    const ask = outline<{ outlines: Array<{ name: string }> }>({ action: "echonet.list" }, remote(machine) ? { machine, timeoutMs: 60_000 } : {});
    listed.set(key, ask.then((r) => r.outlines.map((entry) => entry.name)).catch((error: unknown) => {
      log.push(`- ${machine}: its outlines couldn't be listed (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
      return [];
    }));
  }
  return listed.get(key)!;
}

type NodeMask = Extract<Mask, { kind: "node" }>;
/** A subscription's masks with each named list read from its page here; `unread` when a list couldn't be. */
async function flatten(masks: readonly Mask[], depth = 0): Promise<{ masks: NodeMask[]; unread: boolean }> {
  const out: NodeMask[] = [];
  let unread = false;
  for (const mask of masks) {
    if (mask.kind === "node") { out.push(mask); continue; }
    if (depth > 2) continue;
    const page = await mine<{ status: string; block?: Block }>({ action: "pages.resolve", address: mask.page }).catch(() => undefined);
    if (page?.status !== "resolved" || !page.block) {
      log.push(`- the node list ${mask.text} names no page here ([page::${mask.page}] on a note listing name@machine lines)`);
      unread = true;
      continue;
    }
    const under = await mine<Block[]>({ action: "children", parentId: page.block.id }).catch(() => []);
    const inner = await flatten([page.block.text, ...under.map((child) => child.text)].flatMap(masksIn).map(parseMask).filter((m): m is Mask => !!m), depth + 1);
    out.push(...inner.masks);
    unread ||= inner.unread;
  }
  return { masks: out, unread };
}

/** Whether node masks name `node`. */
const masksName = (masks: readonly NodeMask[], node: Node) => masks.some((mask) => glob(mask.outline).test(node.outline) && glob(mask.machine).test(node.machine));

/** The nodes node masks name, this node left out. */
async function nodesFor(masks: readonly NodeMask[], named: readonly string[]): Promise<Node[]> {
  const out = new Map<string, Node>();
  for (const mask of masks) {
    const machines = hasStar(mask.machine) ? knownMachines(named).filter((machine) => glob(mask.machine).test(machine)) : [mask.machine];
    for (const machine of machines) {
      const names = hasStar(mask.outline) ? (await outlinesOn(machine)).filter((name) => glob(mask.outline).test(name)) : [mask.outline];
      for (const name of names) {
        const node = nodeOf(name, selfMachine(machine) ? self.machine : machine);
        if (!isSelf(node.id)) out.set(node.id, node);
      }
    }
  }
  return [...out.values()];
}

// ── blocks ──

const query = (call: typeof mine, where: string, extra: Record<string, unknown> = {}) =>
  call<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: LIMIT, ...extra } }).then((r) => r.blocks);
const quoteOf = (mark: Mark) => {
  const target = mark.resolvedTarget ?? mark.originalTarget;
  return target?.passage?.quote ?? (target?.anchor?.kind === "text-quote" ? target.anchor.exact : undefined);
};
const authorOf = (mark: Mark) => (mark.source === "agent" ? `agent:${mark.block.actorId ?? "unknown"}` : "user");
const threadsOn = (blockId: string) =>
  mine<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
const netmailFrom = (mark: Mark) => mark.properties?.["netmail-from"]?.[0];
/** A mark that came over the network: it never goes out again (the loop guard, across nodes). */
const cameIn = (mark: Mark) => !!netmailFrom(mark) || !!mark.properties?.via?.some((via) => via.startsWith("echonet:"));
const day = now.slice(0, 10);
const time = (block: Block) => Date.parse(block.updatedAt ?? block.createdAt ?? "") || 0;

/**
 * Header properties a copy can't keep as they are: an address or an id the original owns in its own outline, and a
 * rule's keys (a copy of a rule note never runs here: it reads `from-rule-*` until someone here makes it a rule).
 */
const OWNED = /\[(page|work-id|welcome|publish|rule(?:-[a-z-]+)?)::([^\]]*)\]/gi;
/**
 * A mark's own keys (the annotation store's): a copy of a comment is a note here, never a mark with no passage, so it
 * reads `[from-type::annotation]`, `[from-annotation-status::open]` and so on.
 */
const MARK_KEYS = /\[(type|annotation-source|annotation-status|parent-annotation|promoted-block)::([^\]]*)\]/g;
/** The keys EchoNet writes on a copy: an original that already has one keeps it as `source-<key>`. */
const TRANSPORT = /\[(from|echo|from-rev|tossed|upstream-newer|upstream-gone|echo-source|subscribe)::([^\]]*)\]/g;
/** Code fences and code spans: their words are literal, so a copy keeps them as written. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** The original's text as a local copy reads it: references into the origin become ep0ch:// links into it. */
function localText(origin: Origin, text: string): string {
  const parts: string[] = [];
  let at = 0;
  for (const match of text.matchAll(CODE)) {
    parts.push(localProse(origin, text.slice(at, match.index)), match[0]);
    at = match.index! + match[0].length;
  }
  parts.push(localProse(origin, text.slice(at)));
  return parts.join("");
}

function localProse(origin: Origin, text: string): string {
  const uri = (id: string) => `ep0ch://${origin.node.id}/b/${id}`;
  let out = text.replace(OWNED, (_all, key: string, value: string) => (key === "welcome" ? "" : `[from-${key}::${value}]`))
    .replace(TRANSPORT, (_all, key: string, value: string) => `[source-${key}::${value}]`);
  out = out.replace(/!?\(\(([0-9a-f-]{36})(?:\|([^)]*))?\)\)/g, (_all, id: string, label?: string) => `[${label?.trim() || `a note in ${origin.node.outline}`}](${uri(id)})`);
  for (const page of new Set([...out.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!))) {
    const id = origin.page(page);
    out = out.split(`[[${page}]]`).join(id ? `[${page}](${uri(id)})` : `${page} (in ${origin.node.outline})`);
  }
  return out;
}

/**
 * A copy's text: the original's, localized, with EchoNet's keys on its first line. A note its writer kept off the web
 * (`[publish::never]`) stays off it here too.
 */
function copyText(origin: Origin, message: Block, area: string, tossed?: string, keptOff = false): string {
  const [head, ...rest] = (isMark(message) ? markText(origin, message) : localText(origin, message.text)).split("\n");
  const keep = keptOff || prop(message, "publish") === "never" ? " [publish::never]" : "";
  const keys = `[from::${origin.node.id}/${message.id}] [echo::${area}] [from-rev::${message.revision}]${tossed ? ` [tossed::${tossed}]` : ""}${keep}`;
  return [`${head!.trimEnd()} ${keys}`, ...rest].join("\n");
}

/**
 * A comment's text as a copy reads it: its heading says what it's on and links the note it's on in the origin
 * (`Comment on “forty seconds” in [Recon: flaky cron](ep0ch://…)`), and the store's keys are the original's
 * (`from-type`), so the copy is a note here with its thread (the replies, copied under it) and a way back.
 */
function markText(origin: Origin, mark: Block): string {
  // The store's keys are on the line under the heading; the body after it is the writer's words, copied as written.
  const [heading, meta = "", ...body] = localText(origin, mark.text).split("\n");
  const local = [meta.replace(MARK_KEYS, (all, key: string, value: string) =>
    key === "type" && !["annotation", "annotation-reply"].includes(value.trim()) ? all : `[from-${key}::${value}]`), ...body];
  if (prop(mark, "type") !== "annotation" || !mark.parentId) return [heading!, ...local].join("\n");
  const note = origin.get(mark.parentId);
  const title = note ? firstLine(note.text).replace(/[[\]]/g, "") || "a note" : `a note in ${origin.node.outline}`;
  return [`${heading!.trimEnd()} in [${title}](ep0ch://${origin.node.id}/b/${mark.parentId})`, ...local].join("\n");
}

/** A note's first line changed in place, read fresh, written only when it changes. */
async function setOn(blockId: string, change: (text: string) => string): Promise<void> {
  const current = await mine<Block>({ action: "get", blockId });
  const text = change(current.text);
  if (text !== current.text) await mine({ action: "update", blockId, expectedRevision: current.revision, text });
}

// ── the ledger: what was carried, both ways, and what waits ──

interface Ledger { block?: Block; lines: Map<string, string>; before: Map<string, string> }
/**
 * `out <local mark> -> <node>` per mark packed as netmail (never twice), `in <mark here> -> <node>/<mark>` per reply
 * carried in, `tries <mark> -> n` for netmail waiting on an original that is gone, `undeliverable <mark> -> <note>` once
 * it gave up, `seen <copy> -> <node>/<original>` once its seen-by mark is packed, `call <node> -> <time>` for a node that
 * dials in, and `aka <old name> -> <node>`, the names it said it went by.
 */
function readLedger(block: Block | undefined): Ledger {
  const lines = new Map<string, string>();
  for (const line of block?.text.split("\n").slice(1) ?? []) {
    const match = line.match(/^- (out|in|tries|undeliverable|seen|call|aka) (\S+) -> (\S+)$/);
    if (match) lines.set(`${match[1]} ${match[2]}`, match[3]!);
  }
  return { block, lines, before: new Map(lines) };
}
const LEDGER_TITLE = "EchoNet ledger [type::echo-ledger]";

/** The ledger, when this run changed it. */
async function saveLedger(ledger: Ledger): Promise<void> {
  if (ledger.lines.size === ledger.before.size && [...ledger.lines].every(([key, value]) => ledger.before.get(key) === value)) return;
  await setOn(ledger.block!.id, () => [LEDGER_TITLE, ...[...ledger.lines].map(([key, value]) => `- ${key} -> ${value}`)].join("\n"));
}

// ── the toss ──

interface Counts { copies: number; updated: number; gone: number; skipped: number; waiting: number; seenBy: number; seenByIn: number; netmailOut: number; netmailIn: number; queued: number; held: number; undeliverable: number; dropped: number }
const counts: Counts = { copies: 0, updated: 0, gone: 0, skipped: 0, waiting: 0, seenBy: 0, seenByIn: 0, netmailOut: 0, netmailIn: 0, queued: 0, held: 0, undeliverable: 0, dropped: 0 };
const log: string[] = [];

/** The oldest live one, so every run keeps to the same nodelist and ledger. */
const oldest = (blocks: Block[]) => blocks.filter((block) => !trashed(block)).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))[0];

async function nodelistBlock(): Promise<Block> {
  const found = oldest(await query(mine, "type=nodelist"));
  if (found) return found;
  return mine<Block>({ action: "create", text: `Nodelist [type::nodelist] [node::${self.id}]\n\nWritten by EchoNet's tosser; the next toss writes it again.` });
}

async function ledgerBlock(nodelist: Block): Promise<Block> {
  const found = oldest(await query(mine, "type=echo-ledger"));
  if (found) return found;
  return mine<Block>({ action: "create", parentId: nodelist.id, text: LEDGER_TITLE });
}

/** A subscription's reading of its masks and the areas it wants, or why it can't be read. */
interface Wanted { masks: Mask[]; areas: string[]; since: number; cap: number }
function wantedBy(sub: Block): Wanted | string {
  const masks = values(sub, "subscribe").map(parseMask);
  const areas = values(sub, "echo");
  if (!masks.length || masks.some((mask) => !mask)) return `[subscribe::…] names a node (outline@machine, * for any part) or a list (@<page>); got ${values(sub, "subscribe").join(", ") || "nothing"}`;
  if (!areas.length) return "needs [echo::<area>] (a name, or a mask such as ep0ch.*)";
  const since = prop(sub, "since")?.trim();
  const from = !since || since === "all" ? 0 : Date.parse(since);
  // A date it can't read is said, never taken as "all": that would copy the whole backlog.
  if (Number.isNaN(from)) return `[since::${since}] isn't a date: write one (2026-10-01) or all`;
  const cap = Number(prop(sub, "cap"));
  return { masks: masks as Mask[], areas, since: from, cap: Number.isInteger(cap) && cap > 0 ? cap : CAP };
}

const subscriptionsHere = async () => (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block));

/** The source boards under a subscription, by node. */
async function sourcesUnder(sub: Block): Promise<Map<string, Block>> {
  const boards = new Map<string, Block>();
  for (const child of await mine<Block[]>({ action: "children", parentId: sub.id })) {
    const node = parseNode(prop(child, "echo-source"));
    if (node && !trashed(child)) boards.set(node.id, child);
  }
  return boards;
}

/** Whether this node holds a copy of `from` (live or trashed) that the toss's list of copies didn't reach. */
async function copyHeld(from: string, everyCopy: Map<string, Block>): Promise<boolean> {
  const where = `from="${from}"`;
  const found = [...await query(mine, where), ...await query(mine, where, { includeDeleted: "all" })].find((block) => fromOf(block) === from);
  if (found) everyCopy.set(from, found);
  return !!found;
}

/** Every live copy from `node`, for netmail: each once, whichever subscription brought it. */
const fromNode = (everyCopy: Map<string, Block>, node: Node) => [...everyCopy.values()].filter((copy) => fromOf(copy)!.startsWith(`${node.id}/`) && !trashed(copy));

/** What this toss packs for each node: handed to its host at the end, or held here for a node that dials in. */
const outgoing = new Map<string, { node: Node; items: Item[] }>();
function pack(node: Node, item: Item): void {
  if (!outgoing.has(node.id)) outgoing.set(node.id, { node, items: [] });
  outgoing.get(node.id)!.items.push(item);
}

/** One subscription: echomail in from each node it matches, seen-by packed. Answers the nodes it read, for netmail. */
async function tossSubscription(sub: Block, everyCopy: Map<string, Block>, ledger: Ledger): Promise<Link[]> {
  const name = firstLine(sub.text) || values(sub, "echo").join(", ");
  const wanted = wantedBy(sub);
  if (typeof wanted === "string") {
    log.push(`- ${name}: ${wanted}`);
    return [];
  }
  // "From now": a subscription without `since` takes what is new from its first toss, and says so on itself.
  if (prop(sub, "since") === undefined) {
    await setOn(sub.id, (text) => setHeaderProperty(text, "since", now));
    wanted.since = Date.parse(now);
  }
  const flat = await flatten(wanted.masks);
  const named = flat.masks.map((mask) => mask.machine);
  const boards = await sourcesUnder(sub);
  const nodes = new Map((await nodesFor(flat.masks, named)).map((node) => [node.id, node]));
  // A node with a board stays read while a mask still names it, even when its machine can't list its outlines now;
  // all of them while a named list can't be read.
  for (const id of boards.keys()) {
    const node = parseNode(id)!;
    if (!nodes.has(id) && (masksName(flat.masks, node) || flat.unread)) nodes.set(id, node);
  }
  const exact = wanted.masks.length === 1 && wanted.masks[0]!.kind === "node" && !hasStar(wanted.masks[0]!.text);
  const read: Link[] = [];
  for (const node of nodes.values()) {
    const link = await linkTo(node);
    const board = boards.get(node.id);
    // A mask reaches many nodes: only a node with a board, or the one node named outright, is worth a line.
    const say = (line: string) => { if (board || exact) log.push(`- ${line}`); };
    if (!link.origin) {
      const why = link.dialsIn ? `${link.why}; no bulletin yet, its next call leaves one` : !link.reachable ? `unreachable (${link.why}); its copies stay as they are` : "publishes no bulletin (no EchoNet there, or it hasn't tossed)";
      say(`${node.id} (${name}): ${why}`);
      if (board) read.push(link);
      continue;
    }
    if (await tossSource(sub, link, link.origin, board, wanted, name, everyCopy, ledger)) read.push(link);
    else say(`${node.id} (${name}): no area there named ${wanted.areas.join(" or ")}`);
  }
  if (!nodes.size) log.push(`- ${name}: ${wanted.masks.map((mask) => mask.text).join(", ")} matches no node this toss`);
  return read;
}

/** One node's messages for one subscription, from its bulletin. False when it offers none of the areas wanted (and had no board). */
async function tossSource(sub: Block, link: Link, origin: Origin, existing: Block | undefined, wanted: Wanted, name: string, everyCopy: Map<string, Block>, ledger: Ledger): Promise<boolean> {
  const offered = areasIn(origin.tagged());
  const matched = [...offered.values()].filter((area) => wanted.areas.some((mask) => glob(mask).test(area.name)));
  if (!matched.length && !existing) return false;
  // Each message once, in the first area that has it (a cross-post is copied once).
  const messages = new Map<string, { message: Block; area: string }>();
  const add = (message: Block, area: string) => { if (isMessage(message) && !trashed(message) && !messages.has(message.id)) messages.set(message.id, { message, area }); };
  for (const area of matched) {
    for (const block of area.blocks) for (const message of origin.areaMessages(block)) add(message, area.name);
    for (const message of origin.tagged()) if (postsTo(message, area.name)) add(message, area.name);
  }
  {
    const board = existing ?? await mine<Block>({ action: "create", parentId: sub.id, text: `${link.node.id} [echo-source::${link.node.id}]` });
    const fresh: Array<{ message: Block; area: string }> = [];
    let newer = 0, skipped = 0;
    for (const entry of messages.values()) {
      const { message } = entry;
      const copy = everyCopy.get(`${link.node.id}/${message.id}`);
      if (copy && trashed(copy)) { skipped += 1; continue; }
      if (!copy) {
        if (time(message) >= wanted.since) fresh.push(entry);
        continue;
      }
      if (prop(copy, "echo-partial") !== undefined) {
        await copyChildren(origin, entry.area, message.id, copy.id, everyCopy, 0, isMark(message));
        await setOn(copy.id, (text) => setHeaderProperty(text, "echo-partial", undefined));
      }
      // Kept off the web there since it was copied: the copy is kept off at once, whether or not its text is taken.
      if (prop(message, "publish") === "never" && prop(copy, "publish") !== "never") await setOn(copy.id, (text) => setHeaderProperty(text, "publish", "never"));
      const seen = Number(prop(copy, "from-rev") ?? 0);
      if (message.revision > seen && prop(copy, "upstream-newer") !== String(message.revision)) {
        await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-newer", String(message.revision)));
        newer += 1;
      }
      if (prop(copy, "upstream-gone") !== undefined) await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", undefined));
      if (!isMark(message)) seenBy(origin, message, copy, name, ledger);
    }
    // Oldest first, `cap` a toss: a broad area's first toss doesn't flood, and what waits is said on the board.
    fresh.sort((a, b) => time(a.message) - time(b.message));
    let copied = 0;
    for (const { message, area } of fresh) {
      if (copied >= wanted.cap) break;
      const from = `${link.node.id}/${message.id}`;
      // Copied with its parent a moment ago, or held beyond the copies this toss could list: asked outright.
      if (everyCopy.has(from) || await copyHeld(from, everyCopy)) continue;
      const made = await mine<Block>({ action: "create", parentId: board.id, text: copyText(origin, message, area, now) });
      try {
        await copyChildren(origin, area, message.id, made.id, everyCopy, 0, isMark(message));
      } catch (error) {
        // Stopped partway through the notes under it: the next toss finishes them (`echo-partial`).
        await setOn(made.id, (text) => setHeaderProperty(text, "echo-partial", "yes")).catch(() => undefined);
        throw error;
      }
      everyCopy.set(from, made);
      copied += 1;
      if (!isMark(message)) seenBy(origin, message, made, name, ledger);
    }
    const waiting = fresh.filter(({ message }) => !everyCopy.has(`${link.node.id}/${message.id}`)).length;
    await setOn(board.id, (text) => setHeaderProperty(text, "waiting", waiting ? String(waiting) : undefined));
    // An original gone upstream (trashed, deleted, or no longer published there): the copy stays and says so.
    let gone = 0;
    for (const copy of (await mine<Block[]>({ action: "children", parentId: board.id })).filter(isCopy)) {
      const id = fromOf(copy)!.match(FROM)![2]!;
      if (messages.has(id) || prop(copy, "upstream-gone") !== undefined) continue;
      if (origin.get(id) === null) {
        await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", day));
        gone += 1;
      }
    }
    counts.copies += copied; counts.updated += newer; counts.skipped += skipped; counts.waiting += waiting; counts.gone += gone;
    log.push(`- ${link.node.id} (${name}, bulletin ${when(origin.bulletin.at)}): ${messages.size} in ${matched.map((area) => area.name).join(", ") || "no area now"}; ` +
      `${copied} copied${waiting ? `, ${waiting} waiting` : ""}, ${newer} marked newer, ${gone} gone upstream, ${skipped} trashed here and left so`);
  }
  return true;
}

/**
 * The notes under a message, each a copy with its own `from` (so it is never echoed again as an original here, and a
 * mark on it is netmail too). Copied once, with the message; later notes under the original are upstream's.
 */
async function copyChildren(origin: Origin, area: string, fromId: string, toId: string, everyCopy: Map<string, Block>, depth: number, markParent = false): Promise<void> {
  if (depth > 4) return;
  for (const child of origin.children(fromId)) {
    const from = `${origin.node.id}/${child.id}`;
    // A copy there (moved under a note of its own) is never sent on: it's another node's. A note's marks travel as
    // netmail and seen-by, never as copies; a comment's replies are its thread, copied with it.
    if (everyCopy.has(from) || isCopy(child) || (isMark(child) && !markParent)) continue;
    const made = await mine<Block>({ action: "create", parentId: toId, text: copyText(origin, child, area) });
    everyCopy.set(from, made);
    await copyChildren(origin, area, child.id, made.id, everyCopy, depth + 1, isMark(child));
  }
}

/** "also in: <this node>": packed once per copy, for the origin's tosser to mark the original. */
function seenBy(origin: Origin, message: Block, copy: Block, area: string, ledger: Ledger): void {
  if (ledger.lines.has(`seen ${copy.id}`)) return;
  ledger.lines.set(`seen ${copy.id}`, `${origin.node.id}/${message.id}`);
  // Already there (a ledger lost, or another of this node's names): nothing to send.
  if (origin.seenBy(message.id).some(isSelf)) return;
  pack(origin.node, { kind: "seen-by", original: message.id, copy: copy.id, area });
  counts.seenBy += 1;
}

/**
 * Netmail for one copy: its marks packed for the original (once each, the ledger says so), and the replies written at
 * the origin carried back into the copy's thread from its bulletin.
 */
async function netmail(link: Link, copy: Block, ledger: Ledger): Promise<void> {
  const originalId = fromOf(copy)!.match(FROM)![2]!;
  const local = (await threadsOn(copy.id)).filter((thread) => !cameIn(thread) || thread.replies.length);
  if (!local.length) return;
  const own = (thread: Thread) => [thread, ...thread.replies].filter((mark) => !cameIn(mark));
  const gaveUp = (mark: Mark) => ledger.lines.has(`undeliverable ${mark.block.id}`);
  const unsent = local.flatMap(own).filter((mark) => !ledger.lines.has(`out ${mark.block.id}`) && !gaveUp(mark));
  const origin = link.origin;
  // Gone from what the node publishes: tried a few tosses (it may come back from Trash), then undeliverable.
  if (origin && origin.get(originalId) === null) {
    await undeliverable(link, copy, unsent, ledger);
    return;
  }
  const sent = (mark: Mark) => { ledger.lines.set(`out ${mark.block.id}`, link.node.id); ledger.lines.delete(`tries ${mark.block.id}`); counts.netmailOut += 1; };
  if (isMarkCopy(copy)) {
    // A comment's copy: what's written on it joins the original comment's thread there, as replies.
    const original = origin?.get(originalId);
    if (!original) return;
    const root = prop(original, "type") === "annotation-reply" && original.parentId ? original.parentId : original.id;
    for (const mark of unsent) {
      const quote = quoteOf(mark);
      const body = `${quote ? `(on “${quote}”)${mark.body ? "\n" : ""}` : ""}${mark.body}` || "(a highlight on the copy)";
      pack(link.node, { kind: "thread-reply", original: originalId, root, key: `${self.id}/${mark.block.id}`, body, author: authorOf(mark) });
      sent(mark);
    }
    return;
  }
  const there = origin?.threads(originalId) ?? [];
  for (const thread of local) {
    if (cameIn(thread) || gaveUp(thread)) continue;
    const key = `${self.id}/${thread.block.id}`;
    // Already there (a ledger lost, or sent under a name this node went by): the ledger catches up, nothing is sent.
    const theirs = there.find((candidate) => sentHere(netmailFrom(candidate), thread.block.id));
    if (theirs) for (const mark of [theirs, ...theirs.replies]) {
      const local_ = [thread, ...thread.replies].find((candidate) => sentHere(netmailFrom(mark), candidate.block.id));
      if (local_ && !ledger.lines.has(`out ${local_.block.id}`)) ledger.lines.set(`out ${local_.block.id}`, link.node.id);
    }
    if (!ledger.lines.has(`out ${thread.block.id}`)) {
      const { "netmail-from": _a, via: _b, ...props } = thread.properties ?? {};
      const quote = quoteOf(thread);
      pack(link.node, { kind: "netmail", original: originalId, key, body: thread.body, ...(quote ? { quote } : {}), properties: props, author: authorOf(thread) });
      sent(thread);
    }
    // Replies written here go out; replies written there come in. One that came in carries netmail-from, so it never
    // goes back out, and one that went out carries it there, so it never comes back.
    for (const reply of thread.replies.filter((candidate) => !cameIn(candidate) && !gaveUp(candidate) && !ledger.lines.has(`out ${candidate.block.id}`))) {
      pack(link.node, { kind: "reply", original: originalId, thread: key, key: `${self.id}/${reply.block.id}`, body: reply.body, author: authorOf(reply) });
      sent(reply);
    }
    for (const reply of theirs?.replies.filter((candidate) => !netmailFrom(candidate)) ?? []) {
      const replyKey = `${link.node.id}/${reply.block.id}`;
      if (thread.replies.some((candidate) => netmailFrom(candidate) === replyKey)) continue;
      const receipt = await mine<{ annotations: Mark[] }>({
        action: "annotations.reply", requestId: `echonet-in-${replyKey}-${thread.block.id}`,
        input: { annotationId: thread.block.id, body: reply.body, source: "agent", properties: { via: `echonet:${link.node.id}`, "netmail-from": replyKey, "netmail-author": authorOf(reply) } },
      });
      ledger.lines.set(`in ${receipt.annotations[0]!.block.id}`, replyKey);
      counts.netmailIn += 1;
    }
  }
}

/**
 * Netmail whose original is gone: tried again for `TRIES` tosses (it may come back from Trash), then left here as an
 * undeliverable note beside the copy, saying what it was and why, and never queued again.
 */
async function undeliverable(link: Link, copy: Block, marks: Mark[], ledger: Ledger): Promise<void> {
  for (const mark of marks) {
    const tries = Number(ledger.lines.get(`tries ${mark.block.id}`) ?? 0) + 1;
    if (tries < TRIES) {
      ledger.lines.set(`tries ${mark.block.id}`, String(tries));
      counts.queued += 1;
      continue;
    }
    const said = (mark.body || quoteOf(mark) || "a highlight").replace(/\s+/g, " ").slice(0, 60);
    const note = await mine<Block>({
      action: "create", parentId: copy.parentId,
      text: `Undeliverable: “${said}” [type::echo-undeliverable] [netmail::${mark.block.id}] [echo-copy::${copy.id}]\n\n` +
        `Netmail on ((${copy.id})) couldn't reach its original, ${fromOf(copy)}: ${link.node.id} no longer publishes it (trashed or deleted there). ` +
        `It was tried for ${TRIES} tosses and stays here, on the copy, where it was written.`,
    });
    ledger.lines.delete(`tries ${mark.block.id}`);
    ledger.lines.set(`undeliverable ${mark.block.id}`, note.id);
    counts.undeliverable += 1;
  }
  if (marks.length) log.push(`- netmail for ${firstLine(copy.text)}: the original is gone from ${link.node.id}`);
}

// ── mail: handed over, held, taken, imported ──

/** The netmail and seen-by this node holds for `node` (it dials in, or can't be reached): taken when it calls. */
const itemsHeldFor = (node: string) => box ? jsonFiles(boxPath("outbound", node)).reduce((sum, file) => sum + (readJson<Packet>(boxPath("outbound", node, file))?.items.length ?? 0), 0) : 0;

/**
 * What this toss packed, handed to each node's host (its inbound; its tosser imports it), with what was held for it
 * before; held here for a node that dials in, or one that can't be reached now.
 */
async function deliver(): Promise<void> {
  for (const { node, items } of outgoing.values()) {
    const link = await linkTo(node);
    if (items.length) writeWhole(boxPath("outbound", node.id, `${stamp()}.json`), { from: self.id, at: now, aliases: address.aliases ?? [], items } satisfies Packet);
    const files = jsonFiles(boxPath("outbound", node.id));
    const count = files.reduce((sum, file) => sum + (readJson<Packet>(boxPath("outbound", node.id, file))?.items.length ?? 0), 0);
    if (link.dialsIn) { counts.held += count; log.push(`- ${node.id}: ${count} held until it calls`); continue; }
    if (!link.reachable || !link.route) { counts.queued += count; log.push(`- ${node.id}: ${count} queued (unreachable: ${link.why})`); continue; }
    let handed = 0;
    for (const file of files) {
      const packet = readJson<Packet>(boxPath("outbound", node.id, file));
      if (!packet) continue;
      try {
        await outline({ action: "echonet.put", from: self.id, packet }, link.route);
        rmSync(boxPath("outbound", node.id, file), { force: true });
        handed += packet.items.length;
      } catch (error) {
        counts.queued += count - handed;
        log.push(`- ${node.id}: ${count - handed} queued (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
        break;
      }
    }
    if (handed) log.push(`- ${node.id}: ${handed} handed over`);
  }
}

/** The nodes on other machines this node knows: those that read it, those it reads, and those that publish there. */
async function nodesElsewhere(subscribers: Set<string>): Promise<Node[]> {
  const nodes = new Map<string, Node>();
  const add = (node: Node | undefined) => { if (node && remote(node.machine) && !isSelf(node.id)) nodes.set(canonical(node.id), node); };
  for (const id of subscribers) add(parseNode(canonical(id)));
  for (const sub of await subscriptionsHere()) for (const id of (await sourcesUnder(sub)).keys()) add(parseNode(id));
  for (const machine of knownMachines([]).filter(remote)) for (const name of await outlinesOn(machine)) add(nodeOf(name, machine));
  return [...nodes.values()];
}

/**
 * This node dials in: no other machine can hand it anything, so it calls each node on another machine it knows,
 * takes what that node holds for it (into its own inbound), and leaves its bulletin there for the subscriptions that
 * read it. Two steps per take, so nothing is lost on the way: the packets are kept here first, then acknowledged.
 */
async function callOut(subscribers: Set<string>, leave: boolean): Promise<void> {
  for (const node of await nodesElsewhere(subscribers)) {
    const link = await linkTo(node);
    if (!link.reachable || !link.route) { if (!leave) log.push(`- ${node.id}: unreachable (${link.why}); the next toss calls again`); continue; }
    try {
      if (!leave) {
        // Kept in the order they were held (their names begin with when), then acknowledged; a long backlog comes in
        // several takes.
        let taken = 0;
        for (let round = 0; round < 50; round += 1) {
          const { packets, more } = await outline<{ packets: Array<{ file: string; packet: Packet }>; more?: boolean }>({ action: "echonet.take", for: self.id }, link.route);
          for (const { file, packet } of packets) writeWhole(boxPath("inbound", `${file.replace(/\.json$/, "")}-from-${node.id}.json`), packet);
          if (packets.length) await outline({ action: "echonet.take", for: self.id, ack: packets.map((p) => p.file) }, link.route);
          taken += packets.length;
          if (!more) break;
        }
        log.push(`- ${node.id}: called; took ${taken} packet${taken === 1 ? "" : "s"}`);
      } else {
        await outline({ action: "echonet.put", from: self.id, packet: { from: self.id, at: now, aliases: address.aliases ?? [], dialsIn: true, bulletin: built!, items: [] } satisfies Packet }, link.route);
        log.push(`- ${node.id}: left our bulletin`);
      }
    } catch (error) {
      log.push(`- ${node.id}: the call stopped (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); the next toss calls again`);
    }
  }
}

/**
 * The packets handed to this node, imported by its own tosser: each item about a note it publishes lands on it, as
 * this tosser's own write, with where it came from (`via`, `netmail-from`); an item about any other note is logged and
 * dropped. A bulletin from a node that dials in is kept for the subscriptions here that name it, and its call noted.
 */
async function importInbound(ledger: Ledger, published: Bulletin, subs: Block[]): Promise<void> {
  if (!box) return;
  const files = jsonFiles(boxPath("inbound"));
  if (!files.length) return;
  log.push("## imported");
  const masks = await Promise.all(subs.map(async (sub) => (await flatten(values(sub, "subscribe").map(parseMask).filter((m): m is Mask => !!m))).masks));
  const offered = (id: string) => id in published.blocks;
  for (const file of files) {
    const packet = readJson<Packet>(boxPath("inbound", file));
    const from = parseNode(packet?.from);
    if (!packet || !from) { log.push(`- ${file}: not a packet; dropped`); rmSync(boxPath("inbound", file), { force: true }); continue; }
    for (const name of packet.aliases ?? []) {
      const old = nodeOf(from.outline, name).id;
      if (old !== from.id && !isSelf(old)) { aliasOf.set(old, from.id); ledger.lines.set(`aka ${old}`, from.id); }
    }
    if (packet.dialsIn) { ledger.lines.set(`call ${from.id}`, now); calls.set(from.id, now); }
    if (packet.bulletin) {
      // Kept only when a subscription here reads that node: the subscription note is what asks for it.
      if (masks.some((list) => masksName(list, from))) writeWhole(boxPath("bulletins", `${from.id}.json`), packet.bulletin);
      else { log.push(`- ${from.id}: its bulletin, which no subscription here reads; dropped`); counts.dropped += 1; }
    }
    // Each item alone: one that can't be read is dropped, one that waits on a thread not there yet is tried again at
    // the next toss (three times), and one that fails on the way keeps its packet for the next toss (three times, then
    // it is set aside in inbound/failed/ for a look). Nothing in one packet stops the next.
    const again: Item[] = [];
    let failed: unknown;
    for (const item of Array.isArray(packet.items) ? packet.items : []) {
      if (!wellFormed(item)) { log.push(`- an item from ${from.id} that isn't one EchoNet knows; dropped`); counts.dropped += 1; continue; }
      try {
        if ((await importItem(from, item, offered)) === "later") again.push(item);
      } catch (error) {
        failed = error;
        break;
      }
    }
    const tries = (packet.tries ?? 0) + 1;
    if (failed !== undefined) {
      const why = failed instanceof Error ? failed.message.split("\n")[0] : String(failed);
      if (tries >= 3) {
        mkdirSync(boxPath("inbound", "failed"), { recursive: true });
        renameSync(boxPath("inbound", file), boxPath("inbound", "failed", file));
        log.push(`- a packet from ${from.id} failed three tosses (${why}); set aside in echonet/inbound/failed/${file}`);
      } else {
        writeWhole(boxPath("inbound", file), { ...packet, tries });
        log.push(`- a packet from ${from.id} stopped (${why}); the next toss tries it again`);
      }
      continue;
    }
    rmSync(boxPath("inbound", file), { force: true });
    if (again.length && tries < 3) writeWhole(boxPath("inbound", file), { from: packet.from, at: packet.at, items: again, tries } satisfies Packet);
    else for (const item of again) { log.push(`- ${item.kind} from ${from.id}: its thread never came; dropped`); counts.dropped += 1; }
  }
}

/** An item EchoNet knows, in its shape: anything else in a packet is dropped, never a reason to stop. */
function wellFormed(item: unknown): item is Item {
  if (!item || typeof item !== "object") return false;
  const it = item as Record<string, unknown>;
  const text = (key: string) => typeof it[key] === "string";
  if (!text("original") || !/^[0-9a-f-]{36}$/.test(it.original as string)) return false;
  switch (it.kind) {
    case "seen-by": return text("copy") && text("area");
    case "netmail": return text("key") && text("body") && text("author") && (it.quote === undefined || text("quote")) && !!it.properties && typeof it.properties === "object";
    case "reply": return text("thread") && text("key") && text("body") && text("author");
    case "thread-reply": return text("root") && text("key") && text("body") && text("author");
    default: return false;
  }
}

async function importItem(from: Node, item: Item, offered: (id: string) => boolean): Promise<void | "later"> {
  const drop = (why: string) => { log.push(`- ${item.kind} from ${from.id}: ${why}; dropped`); counts.dropped += 1; };
  if (!offered(item.original)) return drop(`((${item.original})) isn't a note this node publishes`);
  const original = await mine<Block>({ action: "get", blockId: item.original }).catch(() => undefined);
  if (!original || trashed(original)) return drop(`((${item.original})) is gone here`);
  const title = firstLine(original.text).replace(/[|)]/g, "") || "a note";
  const said = (what: string) => { log.push(`- ${what} from ${from.id} on ((${original.id}|${title}))`); };
  if (item.kind === "seen-by") {
    const marks = await threadsOn(original.id);
    if (marks.some((mark) => mark.properties?.kind?.includes("echo-seen-by") && mark.properties["echo.node"]?.some((id) => canonical(id) === canonical(from.id)))) return;
    await mine({
      action: "annotations.batch", requestId: `echonet-seen-${from.id}-${item.copy}`,
      operations: [{ operationId: "seen", type: "block-comment", input: {
        blockId: original.id, expectedRevision: original.revision, source: "agent", body: `also in: ${from.id} (${item.area})`,
        properties: { kind: "echo-seen-by", "echo.node": from.id, "echo.copy": item.copy, via: `echonet:${from.id}` },
      } }],
    });
    counts.seenByIn += 1;
    return said("seen-by");
  }
  const props = { via: `echonet:${from.id}`, "netmail-from": item.key, "netmail-author": item.author };
  if (item.kind === "netmail") {
    if ((await threadsOn(original.id)).some((thread) => netmailFrom(thread) === item.key)) return;
    const anchored = !!item.quote && original.text.includes(item.quote);
    const body = anchored ? item.body : `${item.quote ? `(on words no longer in the note: “${item.quote}”)${item.body ? "\n" : ""}` : ""}${item.body}`;
    await mine({
      action: "annotations.batch", requestId: `echonet-out-${item.key}`,
      operations: [{ operationId: "netmail", type: "block-comment", input: {
        blockId: original.id, expectedRevision: original.revision, source: "agent", body, ...(anchored ? { passage: { quote: item.quote } } : {}),
        properties: { ...item.properties, ...props },
      } }],
    });
  } else {
    let annotationId: string | undefined;
    if (item.kind === "reply") {
      annotationId = (await threadsOn(original.id)).find((thread) => netmailFrom(thread) === item.thread)?.block.id;
      // Its thread is in a packet not imported yet: tried again.
      if (!annotationId) return "later";
    } else {
      // A copy of a comment: its root is that comment, or the one it replies to; nothing else.
      if (!isMark(original) || (item.root !== original.id && item.root !== original.parentId)) return drop(`((${item.root})) isn't the thread of ((${original.id}))`);
      annotationId = item.root;
    }
    await mine({ action: "annotations.reply", requestId: `echonet-out-${item.key}`, input: { annotationId, body: item.body, source: "agent", properties: props } });
  }
  counts.netmailIn += 1;
  said("netmail");
}

// ── the bulletin: what this node publishes ──

/** This node's bulletin, built this run (and written beside the outline). */
let built: Bulletin | undefined;

/**
 * What this node's areas publish, from its own notes: the area views and postings, each area's messages and the notes
 * under them, the originals other nodes copied (their seen-by marks say which), and the netmail threads on those.
 */
async function buildBulletin(lastToss: string | undefined): Promise<Bulletin> {
  const blocks: Record<string, Block> = {};
  const keep = (block: Block) => { if (!trashed(block)) blocks[block.id] = block; };
  // Only what offers: area views and postings. A subscription, a source board or a copy carries `echo` too, and is never published.
  const tagged = (await query(mine, "echo", { sort: "updated desc" })).filter((block) => !trashed(block) && ["area", "posting"].includes(kindOf(block)));
  tagged.forEach(keep);
  const areaResults: Record<string, string[]> = {};
  const messages = new Set<string>();
  for (const area of areasIn(tagged).values()) {
    for (const view of area.blocks) {
      const found = (await query(mine, areaQuery(view), { sort: "updated desc" })).filter((block) => isMessage(block) && !trashed(block));
      found.forEach(keep);
      areaResults[view.id] = found.map((block) => block.id);
      for (const block of found) messages.add(block.id);
    }
  }
  for (const block of tagged) if (kindOf(block) === "posting" && isMessage(block)) messages.add(block.id);
  // A comment in an area says what it's on: that note comes with it.
  for (const id of [...messages]) {
    const mark = blocks[id];
    if (mark && isMark(mark) && mark.parentId && !blocks[mark.parentId]) { const on = await mine<Block>({ action: "get", blockId: mark.parentId }).catch(() => undefined); if (on) keep(on); }
  }
  // The originals another node holds a copy of: published while those copies live, so they can tell newer from gone.
  const seenBy: Record<string, string[]> = {};
  for (const mark of await query(mine, "kind=echo-seen-by")) {
    if (trashed(mark) || !mark.parentId) continue;
    seenBy[mark.parentId] = [...new Set([...(seenBy[mark.parentId] ?? []), ...values(mark, "echo.node")])];
    if (!blocks[mark.parentId]) { const original = await mine<Block>({ action: "get", blockId: mark.parentId }).catch(() => undefined); if (original) keep(original); }
  }
  const children: Record<string, string[]> = {};
  const under = async (id: string, depth: number): Promise<void> => {
    if (depth > 5 || children[id]) return;
    const found = (await mine<Block[]>({ action: "children", parentId: id }).catch(() => [])).filter((block) => !trashed(block));
    children[id] = found.map((block) => block.id);
    for (const child of found) { keep(child); await under(child.id, depth + 1); }
  };
  for (const id of [...messages, ...Object.keys(seenBy)]) if (blocks[id]) await under(id, 0);
  // The netmail threads on its originals: what came in, with its replies, so the nodes that sent it read the answers.
  const threads: Record<string, Thread[]> = {};
  const noted = new Set<string>();
  for (const mark of await query(mine, "netmail-from")) {
    let at: Block | undefined = mark;
    for (let depth = 0; at && isMark(at) && at.parentId && depth < 4; depth += 1) at = await mine<Block>({ action: "get", blockId: at.parentId }).catch(() => undefined);
    if (at && !isMark(at) && blocks[at.id] && !noted.has(at.id)) {
      noted.add(at.id);
      const found = (await threadsOn(at.id)).filter((thread) => netmailFrom(thread));
      if (found.length) threads[at.id] = found;
    }
  }
  const pages: Record<string, string | null> = {};
  for (const id of messages) for (const match of (blocks[id]?.text ?? "").matchAll(/\[\[([^\]]+)\]\]/g)) {
    const name = match[1]!;
    if (name in pages) continue;
    const resolved = await mine<{ status: string; block?: { id: string } }>({ action: "pages.resolve", address: name }).catch(() => undefined);
    pages[name] = resolved?.status === "resolved" && resolved.block ? resolved.block.id : null;
  }
  const subscriptions = (await subscriptionsHere()).map((sub) => `${values(sub, "echo").join(",")} from ${values(sub, "subscribe").join(",")}`);
  return {
    node: self.id, machine: self.machine, aliases: address.aliases ?? [], dialsIn: !!address.dialsIn, at: now,
    blocks, tagged: tagged.map((block) => block.id), areaResults, children, threads, seenBy, pages, subscriptions, ...(lastToss ? { lastToss } : {}),
  };
}

// ── the nodelist ──

interface NodeFacts { link: Link; areas: string[]; subscriptions: string[]; lastToss?: string; role: string[] }

function factsOf(link: Link, role: string[]): NodeFacts {
  const facts: NodeFacts = { link, areas: [], subscriptions: [], role };
  const bulletin = link.origin?.bulletin;
  if (!bulletin) return facts;
  facts.areas = [...areasIn(link.origin!.tagged()).values()].sort((a, b) => a.name.localeCompare(b.name)).map((area) => `${area.name} (${area.blocks.length ? firstLine(area.blocks[0]!.text) || "a view" : `${area.postings} posted`})`);
  facts.subscriptions = bulletin.subscriptions;
  facts.lastToss = bulletin.lastToss;
  return facts;
}

function nodelistText(facts: NodeFacts[], lastToss: string | undefined): string {
  const lines = [`Nodelist [type::nodelist] [node::${self.id}]${lastToss ? ` [last-toss::${lastToss}]` : ""}`, "",
    "The nodes this outline knows, written again by EchoNet's tosser at every toss (`ep0ch echo toss`). Edit the areas and subscriptions, not this.", ""];
  for (const f of facts) {
    const { link } = f;
    const roles = f.role.length ? ` · ${f.role.join(", ")}` : "";
    const aka = link.node.id === self.id ? selfIds.slice(1) : akaOf(link.node.id);
    const known = !!link.origin;
    lines.push(`## ${link.node.id}`);
    if (link.node.id === self.id) lines.push(`- this node${address.dialsIn ? " · dials in" : ""}${roles}`);
    // Never down: it calls when it can, and what waits for it is held here.
    else if (link.dialsIn) lines.push(`- dials in · last call ${link.dialsIn.lastCall ? when(link.dialsIn.lastCall) : "never"}${roles}`);
    else lines.push(`- ${link.reachable ? "reachable" : `unreachable: ${link.why}`}${roles}`);
    if (aka.length) lines.push(`- also known as: ${aka.join(", ")}`);
    const held = link.node.id === self.id ? 0 : itemsHeldFor(link.node.id);
    if (link.dialsIn || held) lines.push(`- netmail held: ${held}${held ? ` (${link.dialsIn ? "its next call takes" : "the next toss that reaches it hands over"} ${held === 1 ? "it" : "them"})` : ""}`);
    lines.push(`- last toss: ${f.lastToss ?? (known ? "never" : "unknown")}`);
    lines.push(`- areas: ${f.areas.length ? f.areas.join("; ") : known ? "none" : "unknown"}`);
    lines.push(`- subscriptions: ${f.subscriptions.length ? f.subscriptions.join("; ") : known ? "none" : "unknown"}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/**
 * The other names the last nodelist learned (`- also known as:` under each node): a node that doesn't answer this
 * toss is still known by them.
 */
function rememberAliases(nodelist: Block): void {
  let at: string | undefined;
  for (const line of nodelist.text.split("\n")) {
    const head = line.match(/^## (\S+)$/);
    if (head) { at = parseNode(head[1])?.id; continue; }
    const aka = line.match(/^- also known as: (.+)$/);
    if (!at || !aka || isSelf(at)) continue;
    for (const name of aka[1]!.split(",").map((part) => part.trim())) if (parseNode(name) && !aliasOf.has(name)) aliasOf.set(name, at);
  }
}

/** `tossed`: this run is a toss, so this node's last toss is now; a nodelist-only run keeps the one it had. */
async function writeNodelist(nodelist: Block, subscribers: Set<string>, tossed: boolean): Promise<void> {
  rememberAliases(nodelist);
  const roles = new Map<string, string[]>();
  const add = (id: string, role: string) => roles.set(id, [...new Set([...(roles.get(id) ?? []), role])]);
  for (const sub of await subscriptionsHere()) {
    for (const id of (await sourcesUnder(sub)).keys()) {
      // Linked first: what each node read here calls itself is how its marks are known (`canonical`).
      const node = parseNode(id);
      if (node && !isSelf(id)) await linkTo(node);
      add(canonical(id), `we read its ${values(sub, "echo").join(",")}`);
    }
  }
  for (const id of subscribers) add(canonical(id), "reads our areas");
  // A node that has called and is read by nothing here is still listed: it may hold netmail, and it calls.
  for (const id of calls.keys()) if (!roles.has(canonical(id)) && parseNode(id)) roles.set(canonical(id), ["calls in"]);
  const own = { link: { node: self, reachable: true, ...(built ? { origin: originOf(self, built) } : {}) } as Link, role: [] as string[] };
  const ownFacts = factsOf(own.link, []);
  ownFacts.lastToss = tossed ? now : prop(nodelist, "last-toss");
  const facts = [ownFacts];
  for (const [id, role] of roles) {
    const node = parseNode(id);
    if (node && !isSelf(node.id)) facts.push(factsOf(await linkTo(node), role));
  }
  // Unchanged, not written: a toss that learned nothing adds nothing to the change feed.
  await setOn(nodelist.id, () => nodelistText(facts, ownFacts.lastToss));
}

/** The nodes that read this one's areas: the seen-by marks they left here. */
async function subscribersHere(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const mark of await query(mine, "kind=echo-seen-by")) for (const value of values(mark, "echo.node")) found.add(value);
  return found;
}

async function toss(): Promise<string> {
  const nodelist = await nodelistBlock();
  const ledger = readLedger(await ledgerBlock(nodelist));
  calls = callsIn(ledger);
  const subs = await subscriptionsHere();
  let subscribers = await subscribersHere();
  if (address.dialsIn) {
    log.push("## calls (this node dials in)");
    await callOut(subscribers, false);
  }
  // What this node publishes, for checking what arrived against, then again once it has landed.
  await importInbound(ledger, await buildBulletin(prop(nodelist, "last-toss")), subs);
  built = await buildBulletin(now);
  writeWhole(boxPath("bulletin.json"), built);
  subscribers = await subscribersHere();
  // Every copy this node holds, trashed ones too: a trashed copy is what keeps a message from coming back.
  const everyCopy = new Map<string, Block>();
  // `includeDeleted` answers only trashed blocks, so the live ones are a second question.
  for (const block of [...await query(mine, "from"), ...await query(mine, "from", { includeDeleted: "all" })]) {
    const from = fromOf(block);
    if (from && !everyCopy.has(from)) everyCopy.set(from, block);
  }
  if (everyCopy.size >= LIMIT) log.push(`- ${LIMIT} or more copies here: a toss reads ${LIMIT} at a time and may copy again what it didn't see`);
  log.push("## echomail");
  const read = new Map<string, Link>();
  for (const sub of subs) for (const link of await tossSubscription(sub, everyCopy, ledger)) read.set(link.node.id, link);
  log.push("## netmail");
  for (const link of read.values()) for (const copy of fromNode(everyCopy, link.node)) await netmail(link, copy, ledger);
  // Mail already held for a node this toss reads nothing of goes too, once it can.
  if (box) for (const id of readdirSafe(boxPath("outbound"))) { const node = parseNode(id); if (node && !outgoing.has(id)) outgoing.set(id, { node, items: [] }); }
  await deliver();
  if (address.dialsIn) await callOut(subscribers, true);
  await saveLedger(ledger);
  await writeNodelist(nodelist, subscribers, true);
  const summary = `copies ${counts.copies}, waiting ${counts.waiting}, newer ${counts.updated}, gone ${counts.gone}, skipped ${counts.skipped}, seen-by ${counts.seenBy}, ` +
    `netmail out ${counts.netmailOut}, in ${counts.netmailIn}, queued ${counts.queued}, undeliverable ${counts.undeliverable}` +
    `${counts.held ? `, held ${counts.held}` : ""}${counts.seenByIn ? `, seen-by in ${counts.seenByIn}` : ""}${counts.dropped ? `, dropped ${counts.dropped}` : ""}`;
  const title = `Toss ${now.slice(0, 16).replace("T", " ")} UTC [type::toss] [node::${self.id}] [at::${now}] [copies::${counts.copies}] [waiting::${counts.waiting}] ` +
    `[updated::${counts.updated}] [gone::${counts.gone}] [skipped::${counts.skipped}] [netmail-out::${counts.netmailOut}] [netmail-in::${counts.netmailIn}] ` +
    `[seen-by-in::${counts.seenByIn}] [queued::${counts.queued}] [held::${counts.held}] [undeliverable::${counts.undeliverable}] [dropped::${counts.dropped}]`;
  await mine({ action: "create", parentId: nodelist.id, text: [title, "", ...(input.scheduled ? ["(scheduled)", ""] : []), ...log].join("\n") });
  await pruneLogs(nodelist);
  return `${self.id} tossed: ${summary}`;
}

const readdirSafe = (dir: string) => { try { return readdirSync(dir); } catch { return []; } };

/** The newest `keepLogs` toss logs stay (default 20); older ones go to Trash. */
async function pruneLogs(nodelist: Block): Promise<void> {
  const keep = config.keepLogs ?? 20;
  const logs = (await mine<Block[]>({ action: "children", parentId: nodelist.id })).filter((block) => prop(block, "type") === "toss");
  for (const old of logs.slice(0, Math.max(0, logs.length - keep))) {
    await mine({ action: "delete", blockId: old.id, expectedRevision: old.revision }).catch(() => undefined);
  }
}

// ── take the newer version: the person's choice, never the tosser's ──

/**
 * A copy whose original is newer: `take-newer` replaces its text with the original's as its node last published it
 * (its own edits go, its EchoNet keys stay); `compare-newer` proposes that text beside it, the difference drawn.
 */
async function takeNewer(propose: boolean): Promise<{ message: string; open?: string }> {
  const block = input.context.block;
  const from = block ? fromOf(block)?.match(FROM) : undefined;
  if (!block || !from) return { message: "This note isn't an EchoNet copy: a copy carries [from::<outline>@<machine>/<id>]" };
  const node = parseNode(from[1])!;
  const link = await linkTo(node);
  if (!link.origin) return { message: `${node.id} has no bulletin here (${link.dialsIn ? "its next call leaves one" : link.reachable ? "it publishes none" : `unreachable: ${link.why}`}); try again then` };
  const original = link.origin.get(from[2]!);
  if (!original) return { message: `The original is gone from ${node.id}: this copy is all there is now` };
  const current = await mine<Block>({ action: "get", blockId: block.id });
  const area = prop(current, "echo") ?? "?";
  const tossed = prop(current, "tossed");
  // A copy kept off the web here stays off, whatever the original says.
  const text = copyText(link.origin, original, area, tossed, prop(current, "publish") === "never");
  if (text === current.text) return { message: `This copy already has ${node.id}'s revision ${original.revision}` };
  if (propose) {
    const result = await mine<{ outcome: string; proposalId?: string }>({
      action: "draft.patch", blockId: current.id, revision: current.revision, propose: "always",
      patches: [{ observed: current.text, replacement: text }], mutation: { author: "agent", actorId: "ext:echonet" },
    });
    return { message: `${node.id}'s revision ${original.revision} is proposed beside the copy: apply or dismiss it there`, ...(result.proposalId ? { open: result.proposalId } : {}) };
  }
  await mine({ action: "update", blockId: current.id, expectedRevision: current.revision, text });
  return { message: `This copy now has ${node.id}'s revision ${original.revision} (its own edits are in its history)`, open: current.id };
}

let release: (() => void) | undefined;
try {
  // Which nodes have called (they dial in, and are never called from here): the ledger says, before any node is linked.
  calls = callsIn(readLedger(oldest(await query(mine, "type=echo-ledger"))));
  if (input.action === "nodelist") {
    const nodelist = await nodelistBlock();
    built = existsSync(boxPath("bulletin.json")) ? readJson<Bulletin>(boxPath("bulletin.json")) : undefined;
    await writeNodelist(nodelist, await subscribersHere(), false);
    answer({ message: `${self.id}: nodelist written`, open: nodelist.id });
  } else if (input.action === "take-newer" || input.action === "compare-newer") {
    answer(await takeNewer(input.action === "compare-newer"));
  } else {
    // One toss at a time: a second waits for the first (up to a minute), then reads what arrived meanwhile.
    release = await lock(true);
    if (!release) answer({ message: `${self.id}: another toss has run for over a minute; this one gives way to it` });
    else answer({ message: await toss() });
  }
} catch (error) {
  // A failure, not an answer: the service reports it and `ep0ch echo toss` exits non-zero. A failure carries only a
  // code, so why it stopped goes in a toss log first. What it wrote stays, and the next toss carries on from there
  // (every step looks before it writes).
  const why = error instanceof Error ? error.message : String(error);
  if (input.action === "toss") {
    await nodelistBlock().then((nodelist) => mine({ action: "create", parentId: nodelist.id,
      text: [`Toss ${now.slice(0, 16).replace("T", " ")} UTC stopped [type::toss] [node::${self.id}] [at::${now}] [failed::yes]`, "", `It stopped: ${why}`, "", ...log].join("\n") })).catch(() => undefined);
  }
  process.stdout.write(JSON.stringify({ ok: false, code: input.action === "toss" ? "toss-failed" : "echonet-failed" }));
} finally {
  release?.();
}

// EchoNet's tosser (PIE-779): this outline is a node, `name@machine`, on a FidoNet-style store-and-forward network of
// outlines. One run ("a toss") does what a FidoNet mailer did on its nightly call:
//
//   1. echomail in: each subscription here (`[subscribe::<mask>] [echo::<name or mask>]`) reads the areas of every node
//      its mask matches, and copies what's new under a source board per node (`[echo-source::<node>]`), from its
//      `since`, at most `cap` a toss, saying how many wait. A copy is a local note: edit it, move it, trash it; a trashed
//      copy stays trashed. A newer original is a marker on the copy (`[upstream-newer::n]`), and a gone one
//      (`[upstream-gone::<day>]`); taking the newer text is the person's choice (the take-newer and compare-newer actions).
//   2. seen-by: each original gets one mark per node it reached ("also in: …"), never a change to its text.
//   3. netmail out: a highlight, comment or reply on a copy is carried to the original as a comment, `via
//      echonet:<this node>`, `[netmail-from::<this node>/<mark id>]`. To an original that is gone, it is tried a few
//      tosses and then left here as an undeliverable note beside the copy.
//   4. netmail in: a reply written in the origin on such a thread is carried back into the copy's thread.
//   5. the nodelist (`Nodelist [type::nodelist]`) is written again, with a `[type::toss]` log under it.
//
// Nothing that came over the network goes out again: a copy is never a message (shapes.ts), and a mark that came in
// carries `netmail-from`, so the loop guard holds across any number of nodes. Offline is normal: a node that can't be
// reached is said in the nodelist, and what this node would send it stays here, counted as queued. The one access rule
// is the origin's own (`ep0ch mcp access`): `none` refuses, `read` lets this node copy, `propose` and `full` also let it
// write marks there (seen-by and netmail). Everything is written over the extension's connection, as `ext:echonet`.
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { outline, type OutlineRequest, type Route } from "./outline";
import {
  areaQuery, areasIn, type Block, firstLine, FROM, fromOf, glob, hasStar, isCopy, isMessage, kindOf, type Mask, masksIn, postsTo,
  type Node, nodeOf, parseMask, parseNode, prop, sameMachine, setHeaderProperty, trashed, values,
} from "./shapes";

interface Target { passage?: { quote?: string }; anchor?: { kind: string; exact?: string } }
interface Mark {
  block: Block; body: string; source: "user" | "agent"; properties?: Record<string, string[]>;
  originalTarget?: Target; resolvedTarget?: Target | null;
}
interface Thread extends Mark { replies: Mark[] }
type Level = "none" | "read" | "propose" | "full";

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

const address = await outline<{ outline?: string; machine: string }>({ action: "notes.address" });
const self = nodeOf(process.env.EP0CH_WS ?? address.outline ?? "unknown", address.machine);

// ── nodes ──

/** How this node reaches another, and what that node lets it do. Learned once per toss. */
interface Link {
  readonly node: Node;
  readonly reachable: boolean;
  /** Why not, when it isn't (offline, no forward, another protocol). */
  readonly why?: string;
  readonly level: Level;
  call<T>(request: OutlineRequest): Promise<T>;
}

const mine = <T>(request: OutlineRequest) => outline<T>(request);
const canMark = (level: Level) => level === "propose" || level === "full";
const remote = (machine: string) => !sameMachine(machine, self.machine);
const links = new Map<string, Link>();

async function linkTo(node: Node): Promise<Link> {
  const known = links.get(node.id);
  if (known) return known;
  let link: Link;
  const unreachable = (why: string): Link => ({ node, reachable: false, why, level: "none", call: () => Promise.reject(new Error(`${node.id} is unreachable: ${why}`)) });
  if ((config.offline ?? []).includes(node.id)) link = unreachable("offline (config.json's offline list)");
  // This node's own level is what it grants others; its tosser itself may do anything here.
  else if (node.id === self.id) link = { node, reachable: true, level: (await mine<{ level: Level }>({ action: "mcp.access.status" })).level, call: mine };
  else {
    // What the node lets this extension do (`granted`): on this machine an outline whose owner set no level is open.
    // Another machine: the host sends the request through the shared ssh forward, starting it when nobody has (the
    // first contact waits for ssh); a machine or host that doesn't answer is offline for this toss.
    const route: Route = { outline: node.outline, ...(remote(node.machine) ? { machine: node.machine, timeoutMs: 60_000 } : {}) };
    const call = <T>(request: OutlineRequest) => outline<T>(request, route);
    try {
      const status = await call<{ level: Level; granted?: Level }>({ action: "mcp.access.status" });
      link = { node, reachable: true, level: status.granted ?? status.level, call };
    } catch (error) {
      link = unreachable(error instanceof Error ? error.message.split("\n")[0]! : String(error));
    }
  }
  links.set(node.id, link);
  return link;
}

/** This host's outlines folder, from its socket (`<outlines>/.host/host.sock`); undefined when it isn't laid out so. */
function outlinesFolder(): string | undefined {
  const socket = process.env.EP0CH_SOCKET;
  return socket && basename(dirname(socket)) === ".host" ? dirname(dirname(socket)) : undefined;
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

/** The outlines on a machine this node may read: every one here; on another machine, the ones that opted in. */
const listed = new Map<string, Promise<string[]>>();
function outlinesOn(machine: string): Promise<string[]> {
  const key = machine.toLowerCase();
  if (!listed.has(key)) {
    const ask = remote(machine)
      ? outline<{ outlines: Array<{ name: string }> }>({ action: "outlines.list" }, { machine, timeoutMs: 60_000 })
      : mine<{ outlines: Array<{ name: string }> }>({ action: "outlines.list" });
    listed.set(key, ask.then((r) => r.outlines.map((entry) => entry.name)).catch((error: unknown) => {
      log.push(`- ${machine}: its outlines couldn't be listed (${error instanceof Error ? error.message.split("\n")[0] : String(error)})`);
      return [];
    }));
  }
  return listed.get(key)!;
}

/** The nodes a subscription's masks name, this node left out. A named list is read from its page here. */
async function nodesFor(masks: readonly Mask[], named: readonly string[], depth = 0): Promise<Node[]> {
  const out = new Map<string, Node>();
  for (const mask of masks) {
    if (mask.kind === "list") {
      if (depth > 2) continue;
      const page = await mine<{ status: string; block?: Block }>({ action: "pages.resolve", address: mask.page }).catch(() => undefined);
      if (page?.status !== "resolved" || !page.block) {
        log.push(`- the node list ${mask.text} names no page here ([page::${mask.page}] on a note listing name@machine lines)`);
        continue;
      }
      const under = await mine<Block[]>({ action: "children", parentId: page.block.id }).catch(() => []);
      const inner = [page.block.text, ...under.map((child) => child.text)].flatMap(masksIn).map(parseMask).filter((m): m is Mask => !!m);
      for (const node of await nodesFor(inner, named, depth + 1)) out.set(node.id, node);
      continue;
    }
    const machines = hasStar(mask.machine) ? knownMachines(named).filter((machine) => glob(mask.machine).test(machine)) : [mask.machine];
    for (const machine of machines) {
      const names = hasStar(mask.outline) ? (await outlinesOn(machine)).filter((name) => glob(mask.outline).test(name)) : [mask.outline];
      for (const name of names) {
        const node = nodeOf(name, sameMachine(machine, self.machine) ? self.machine : machine);
        if (node.id !== self.id) out.set(node.id, node);
      }
    }
  }
  return [...out.values()];
}

// ── blocks ──

const query = (call: Link["call"], where: string, extra: Record<string, unknown> = {}) =>
  call<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: LIMIT, ...extra } }).then((r) => r.blocks);
const quoteOf = (mark: Mark) => {
  const target = mark.resolvedTarget ?? mark.originalTarget;
  return target?.passage?.quote ?? (target?.anchor?.kind === "text-quote" ? target.anchor.exact : undefined);
};
const authorOf = (mark: Mark) => (mark.source === "agent" ? `agent:${mark.block.actorId ?? "unknown"}` : "user");
const threadsOn = (call: Link["call"], blockId: string) =>
  call<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
const netmailFrom = (mark: Mark) => mark.properties?.["netmail-from"]?.[0];
/** A mark that came over the network: it never goes out again (the loop guard, across nodes). */
const cameIn = (mark: Mark) => !!netmailFrom(mark) || !!mark.properties?.via?.some((via) => via.startsWith("echonet:"));
const day = now.slice(0, 10);
const time = (block: Block) => Date.parse(block.updatedAt ?? block.createdAt ?? "") || 0;

/** Header properties a copy can't keep as they are: an address or an id the original owns in its own outline. */
const OWNED = /\[(page|work-id|welcome|publish)::([^\]]*)\]/g;
/** The keys EchoNet writes on a copy: an original that already has one keeps it as `source-<key>`. */
const TRANSPORT = /\[(from|echo|from-rev|tossed|upstream-newer|upstream-gone|echo-source|subscribe)::([^\]]*)\]/g;
/** Code fences and code spans: their words are literal, so a copy keeps them as written. */
const CODE = /```[\s\S]*?(?:```|$)|`[^`\n]*`/g;

/** The original's text as a local copy reads it: references into the origin become ep0ch:// links into it. */
async function localText(origin: Link, text: string): Promise<string> {
  const parts: string[] = [];
  let at = 0;
  for (const match of text.matchAll(CODE)) {
    parts.push(await localProse(origin, text.slice(at, match.index)), match[0]);
    at = match.index! + match[0].length;
  }
  parts.push(await localProse(origin, text.slice(at)));
  return parts.join("");
}

async function localProse(origin: Link, text: string): Promise<string> {
  const uri = (id: string) => `ep0ch://${origin.node.id}/b/${id}`;
  let out = text.replace(OWNED, (_all, key: string, value: string) => (key === "welcome" ? "" : `[from-${key}::${value}]`))
    .replace(TRANSPORT, (_all, key: string, value: string) => `[source-${key}::${value}]`);
  out = out.replace(/!?\(\(([0-9a-f-]{36})(?:\|([^)]*))?\)\)/g, (_all, id: string, label?: string) => `[${label?.trim() || `a note in ${origin.node.outline}`}](${uri(id)})`);
  const pages = [...new Set([...out.matchAll(/\[\[([^\]]+)\]\]/g)].map((m) => m[1]!))];
  for (const page of pages) {
    const resolved = await origin.call<{ status: string; block?: { id: string } }>({ action: "pages.resolve", address: page }).catch(() => undefined);
    const replacement = resolved?.status === "resolved" && resolved.block ? `[${page}](${uri(resolved.block.id)})` : `${page} (in ${origin.node.outline})`;
    out = out.split(`[[${page}]]`).join(replacement);
  }
  return out;
}

/**
 * A copy's text: the original's, localized, with EchoNet's keys on its first line. A note its writer kept off the web
 * (`[publish::never]`) stays off it here too.
 */
async function copyText(origin: Link, message: Block, area: string, tossed?: string): Promise<string> {
  const [head, ...rest] = (await localText(origin, message.text)).split("\n");
  const keep = prop(message, "publish") === "never" ? " [publish::never]" : "";
  const keys = `[from::${origin.node.id}/${message.id}] [echo::${area}] [from-rev::${message.revision}]${tossed ? ` [tossed::${tossed}]` : ""}${keep}`;
  return [`${head!.trimEnd()} ${keys}`, ...rest].join("\n");
}

/** A note's first line changed in place, read fresh, written only when it changes. */
async function setOn(blockId: string, change: (text: string) => string): Promise<void> {
  const current = await mine<Block>({ action: "get", blockId });
  const text = change(current.text);
  if (text !== current.text) await mine({ action: "update", blockId, expectedRevision: current.revision, text });
}

// ── the ledger: what was carried, both ways, and what waits ──

interface Ledger { block?: Block; lines: Map<string, string> }
/**
 * `out <local mark> -> <node>/<mark>` and `in …` per carried mark (netmail is never carried twice), `tries <mark> -> n`
 * for netmail waiting on an original that is gone, and `undeliverable <mark> -> <note>` once it gave up.
 */
function readLedger(block: Block | undefined): Ledger {
  const lines = new Map<string, string>();
  for (const line of block?.text.split("\n").slice(1) ?? []) {
    const match = line.match(/^- (out|in|tries|undeliverable) (\S+) -> (\S+)$/);
    if (match) lines.set(`${match[1]} ${match[2]}`, match[3]!);
  }
  return { block, lines };
}

// ── the toss ──

interface Counts { copies: number; updated: number; gone: number; skipped: number; waiting: number; seenBy: number; netmailOut: number; netmailIn: number; queued: number; undeliverable: number }
const counts: Counts = { copies: 0, updated: 0, gone: 0, skipped: 0, waiting: 0, seenBy: 0, netmailOut: 0, netmailIn: 0, queued: 0, undeliverable: 0 };
const log: string[] = [];

async function nodelistBlock(): Promise<Block> {
  const found = (await query(mine, "type=nodelist")).find((block) => !trashed(block));
  if (found) return found;
  return mine<Block>({ action: "create", text: `Nodelist [type::nodelist] [node::${self.id}]\n\nWritten by EchoNet's tosser; the next toss writes it again.` });
}

async function ledgerBlock(nodelist: Block): Promise<Block> {
  const found = (await query(mine, "type=echo-ledger")).find((block) => !trashed(block));
  if (found) return found;
  return mine<Block>({ action: "create", parentId: nodelist.id, text: "EchoNet ledger [type::echo-ledger]" });
}

/** A subscription's reading of its masks and the areas it wants, or why it can't be read. */
interface Wanted { masks: Mask[]; areas: string[]; since: number; cap: number }
function wantedBy(sub: Block): Wanted | string {
  const masks = values(sub, "subscribe").map(parseMask);
  const areas = values(sub, "echo");
  if (!masks.length || masks.some((mask) => !mask)) return `[subscribe::…] names a node (outline@machine, * for any part) or a list (@<page>); got ${values(sub, "subscribe").join(", ") || "nothing"}`;
  if (!areas.length) return "needs [echo::<area>] (a name, or a mask such as ep0ch.*)";
  const since = prop(sub, "since")?.trim();
  const cap = Number(prop(sub, "cap"));
  return {
    masks: masks as Mask[], areas,
    since: !since || since === "all" ? 0 : Date.parse(since) || 0,
    cap: Number.isInteger(cap) && cap > 0 ? cap : CAP,
  };
}

/** The source boards under a subscription, by node. */
async function sourcesUnder(sub: Block): Promise<Map<string, Block>> {
  const boards = new Map<string, Block>();
  for (const child of await mine<Block[]>({ action: "children", parentId: sub.id })) {
    const node = parseNode(prop(child, "echo-source"));
    if (node && !trashed(child)) boards.set(node.id, child);
  }
  return boards;
}

/** Every live copy from `node`, for netmail: each once, whichever subscription brought it. */
const fromNode = (everyCopy: Map<string, Block>, node: Node) => [...everyCopy.values()].filter((copy) => fromOf(copy)!.startsWith(`${node.id}/`) && !trashed(copy));

/** One subscription: echomail in from each node it matches, seen-by out. Answers the nodes it read, for netmail. */
async function tossSubscription(sub: Block, everyCopy: Map<string, Block>): Promise<Link[]> {
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
  const named = wanted.masks.flatMap((mask) => (mask.kind === "node" ? [mask.machine] : []));
  const boards = await sourcesUnder(sub);
  const nodes = new Map((await nodesFor(wanted.masks, named)).map((node) => [node.id, node]));
  // A node with a board stays read while a mask still names it, even when its machine can't list its outlines now.
  for (const id of boards.keys()) {
    const node = parseNode(id)!;
    if (!nodes.has(id) && wanted.masks.some((mask) => mask.kind === "list" || (glob(mask.outline).test(node.outline) && glob(mask.machine).test(node.machine)))) nodes.set(id, node);
  }
  const exact = wanted.masks.length === 1 && wanted.masks[0]!.kind === "node" && !hasStar(wanted.masks[0]!.text);
  const read: Link[] = [];
  for (const node of nodes.values()) {
    const link = await linkTo(node);
    const board = boards.get(node.id);
    // A mask reaches many nodes: only a node with a board, or the one node named outright, is worth a line.
    const say = (line: string) => { if (board || exact) log.push(`- ${line}`); };
    if (!link.reachable) { say(`${node.id} (${name}): unreachable (${link.why}); its copies stay as they are`); if (board) read.push(link); continue; }
    if (link.level === "none") { say(`${node.id} (${name}): refused (${node.id} grants none; its owner runs \`ep0ch mcp access read --ws ${node.outline}\`)`); if (board) read.push(link); continue; }
    if (await tossSource(sub, link, board, wanted, name, everyCopy)) read.push(link);
    else say(`${node.id} (${name}): no area there named ${wanted.areas.join(" or ")}`);
  }
  if (!nodes.size) log.push(`- ${name}: ${wanted.masks.map((mask) => mask.text).join(", ")} matches no node this toss`);
  return read;
}

/** One node's messages for one subscription. False when it offers none of the areas wanted (and had no board). */
async function tossSource(sub: Block, link: Link, existing: Block | undefined, wanted: Wanted, name: string, everyCopy: Map<string, Block>): Promise<boolean> {
  const tagged = await query(link.call, "echo");
  const offered = areasIn(tagged);
  const matched = [...offered.values()].filter((area) => wanted.areas.some((mask) => glob(mask).test(area.name)));
  if (!matched.length && !existing) return false;
  // Each message once, in the first area that has it (a cross-post is copied once).
  const messages = new Map<string, { message: Block; area: string }>();
  const add = (message: Block, area: string) => { if (isMessage(message) && !trashed(message) && !messages.has(message.id)) messages.set(message.id, { message, area }); };
  for (const area of matched) {
    for (const block of area.blocks) for (const message of await query(link.call, areaQuery(block))) add(message, area.name);
    for (const message of tagged) if (postsTo(message, area.name)) add(message, area.name);
  }
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
    const seen = Number(prop(copy, "from-rev") ?? 0);
    if (message.revision > seen && prop(copy, "upstream-newer") !== String(message.revision)) {
      await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-newer", String(message.revision)));
      newer += 1;
    }
    if (prop(copy, "upstream-gone") !== undefined) await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", undefined));
    if (canMark(link.level)) await seenBy(link, message, copy, name);
  }
  // Oldest first, `cap` a toss: a broad area's first toss doesn't flood, and what waits is said on the board.
  fresh.sort((a, b) => time(a.message) - time(b.message));
  const now_ = fresh.slice(0, wanted.cap), waiting = fresh.length - now_.length;
  for (const { message, area } of now_) {
    const made = await mine<Block>({ action: "create", parentId: board.id, text: await copyText(link, message, area, now) });
    await copyChildren(link, area, message.id, made.id, everyCopy, 0);
    everyCopy.set(`${link.node.id}/${message.id}`, made);
    if (canMark(link.level)) await seenBy(link, message, made, name);
  }
  await setOn(board.id, (text) => setHeaderProperty(text, "waiting", waiting ? String(waiting) : undefined));
  // An original gone upstream (trashed or deleted there): the copy stays, drift being the point, and says so.
  let gone = 0;
  for (const copy of (await mine<Block[]>({ action: "children", parentId: board.id })).filter(isCopy)) {
    const id = fromOf(copy)!.match(FROM)![2]!;
    if (messages.has(id) || prop(copy, "upstream-gone") !== undefined) continue;
    const original = await link.call<Block>({ action: "get", blockId: id }).catch(() => undefined);
    if (!original || trashed(original)) {
      await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", day));
      gone += 1;
    }
  }
  counts.copies += now_.length; counts.updated += newer; counts.skipped += skipped; counts.waiting += waiting; counts.gone += gone;
  log.push(`- ${link.node.id} (${name}, ${link.level}): ${messages.size} in ${matched.map((area) => area.name).join(", ") || "no area now"}; ` +
    `${now_.length} copied${waiting ? `, ${waiting} waiting` : ""}, ${newer} marked newer, ${gone} gone upstream, ${skipped} trashed here and left so`);
  return true;
}

/**
 * The notes under a message, each a copy with its own `from` (so it is never echoed again as an original here, and a
 * mark on it is netmail too). Copied once, with the message; later notes under the original are upstream's.
 */
async function copyChildren(origin: Link, area: string, fromId: string, toId: string, everyCopy: Map<string, Block>, depth: number): Promise<void> {
  if (depth > 4) return;
  const children = await origin.call<Block[]>({ action: "children", parentId: fromId });
  for (const child of children) {
    const from = `${origin.node.id}/${child.id}`;
    if (everyCopy.has(from)) continue;
    const made = await mine<Block>({ action: "create", parentId: toId, text: await copyText(origin, child, area) });
    everyCopy.set(from, made);
    await copyChildren(origin, area, child.id, made.id, everyCopy, depth + 1);
  }
}

/** "also in: <this node>": one whole-note mark on the original per node it reached. Its text is never touched. */
async function seenBy(origin: Link, message: Block, copy: Block, area: string): Promise<void> {
  const threads = await threadsOn(origin.call, message.id);
  if (threads.some((thread) => thread.properties?.kind?.includes("echo-seen-by") && thread.properties["echo.node"]?.includes(self.id))) return;
  await origin.call({
    action: "annotations.batch", requestId: `echonet-seen-${self.id}-${copy.id}`,
    operations: [{ operationId: "seen", type: "block-comment", input: {
      blockId: message.id, expectedRevision: message.revision, source: "agent",
      body: `also in: ${self.id} (${area})`,
      properties: { kind: "echo-seen-by", "echo.node": self.id, "echo.copy": copy.id, via: `echonet:${self.id}` },
    } }],
  });
  counts.seenBy += 1;
}

/** Netmail for one copy: its marks out to the original, the origin's replies back in. */
async function netmail(origin: Link, copy: Block, ledger: Ledger): Promise<void> {
  const originalId = fromOf(copy)!.match(FROM)![2]!;
  const local = (await threadsOn(mine, copy.id)).filter((thread) => !cameIn(thread) || thread.replies.length);
  const outgoing = (thread: Thread) => [thread, ...thread.replies].filter((mark) => !cameIn(mark));
  const waiting = () => local.flatMap(outgoing).filter((mark) => !ledger.lines.has(`out ${mark.block.id}`) && !ledger.lines.has(`undeliverable ${mark.block.id}`));
  if (!origin.reachable || !canMark(origin.level)) {
    counts.queued += waiting().length;
    return;
  }
  if (!local.length) return;
  let original = await origin.call<Block>({ action: "get", blockId: originalId }).catch(() => undefined);
  if (!original || trashed(original)) {
    await undeliverable(origin, copy, waiting(), ledger);
    return;
  }
  const remoteThreads = await threadsOn(origin.call, originalId);
  for (const thread of local) {
    if (cameIn(thread)) continue;
    const key = `${self.id}/${thread.block.id}`;
    let there = remoteThreads.find((candidate) => netmailFrom(candidate) === key);
    if (!there) {
      original = await origin.call<Block>({ action: "get", blockId: originalId });
      const quote = quoteOf(thread);
      const anchored = quote !== undefined && quote.length > 0 && original.text.includes(quote);
      const body = anchored ? thread.body : `${quote ? `(on words no longer in the note: “${quote}”)${thread.body ? "\n" : ""}` : ""}${thread.body}`;
      const { "netmail-from": _a, via: _b, ...own } = thread.properties ?? {};
      const receipt = await origin.call<{ annotations: Mark[] }>({
        action: "annotations.batch", requestId: `echonet-out-${key}`,
        operations: [{ operationId: "netmail", type: "block-comment", input: {
          blockId: originalId, expectedRevision: original.revision, source: "agent", body,
          ...(anchored ? { passage: { quote } } : {}),
          properties: { ...own, via: `echonet:${self.id}`, "netmail-from": key, "netmail-author": authorOf(thread) },
        } }],
      });
      there = { ...receipt.annotations[0]!, replies: [] };
      ledger.lines.set(`out ${thread.block.id}`, `${origin.node.id}/${there.block.id}`);
      ledger.lines.delete(`tries ${thread.block.id}`);
      counts.netmailOut += 1;
    } else if (!ledger.lines.has(`out ${thread.block.id}`)) ledger.lines.set(`out ${thread.block.id}`, `${origin.node.id}/${there.block.id}`);
    // Replies written here go out; replies written there come in. One that came in carries netmail-from, so it never
    // goes back out, and one that went out carries it there, so it never comes back.
    for (const reply of thread.replies.filter((candidate) => !cameIn(candidate))) {
      const replyKey = `${self.id}/${reply.block.id}`;
      if (there.replies.some((candidate) => netmailFrom(candidate) === replyKey)) continue;
      const receipt = await origin.call<{ annotations: Mark[] }>({
        action: "annotations.reply", requestId: `echonet-out-${replyKey}`,
        input: { annotationId: there.block.id, body: reply.body, source: "agent", properties: { via: `echonet:${self.id}`, "netmail-from": replyKey, "netmail-author": authorOf(reply) } },
      });
      ledger.lines.set(`out ${reply.block.id}`, `${origin.node.id}/${receipt.annotations[0]!.block.id}`);
      counts.netmailOut += 1;
    }
    for (const reply of there.replies.filter((candidate) => !netmailFrom(candidate))) {
      const replyKey = `${origin.node.id}/${reply.block.id}`;
      if (thread.replies.some((candidate) => netmailFrom(candidate) === replyKey)) continue;
      const receipt = await mine<{ annotations: Mark[] }>({
        action: "annotations.reply", requestId: `echonet-in-${replyKey}-${thread.block.id}`,
        input: { annotationId: thread.block.id, body: reply.body, source: "agent", properties: { via: `echonet:${origin.node.id}`, "netmail-from": replyKey, "netmail-author": authorOf(reply) } },
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
async function undeliverable(origin: Link, copy: Block, marks: Mark[], ledger: Ledger): Promise<void> {
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
        `Netmail on ((${copy.id})) couldn't reach its original, ${fromOf(copy)}: it is gone from ${origin.node.id} (trashed or deleted). ` +
        `It was tried for ${TRIES} tosses and stays here, on the copy, where it was written.`,
    });
    ledger.lines.delete(`tries ${mark.block.id}`);
    ledger.lines.set(`undeliverable ${mark.block.id}`, note.id);
    counts.undeliverable += 1;
  }
  if (marks.length) log.push(`- netmail for ${firstLine(copy.text)}: the original is gone from ${origin.node.id}`);
}

// ── the nodelist ──

interface NodeFacts { link: Link; areas: string[]; subscriptions: string[]; lastToss?: string; role: string[] }

async function factsOf(link: Link, role: string[]): Promise<NodeFacts> {
  const facts: NodeFacts = { link, areas: [], subscriptions: [], role };
  if (!link.reachable || link.level === "none") return facts;
  const tagged = await query(link.call, "echo");
  facts.areas = [...areasIn(tagged).values()].map((area) => `${area.name} (${area.blocks.length ? firstLine(area.blocks[0]!.text) || "a view" : `${area.postings} posted`})`);
  facts.subscriptions = (await query(link.call, "subscribe")).filter((sub) => kindOf(sub) === "subscription" && !trashed(sub))
    .map((sub) => `${values(sub, "echo").join(",")} from ${values(sub, "subscribe").join(",")}`);
  const list = (await query(link.call, "type=nodelist"))[0];
  facts.lastToss = list ? prop(list, "last-toss") : undefined;
  return facts;
}

function nodelistText(facts: NodeFacts[], lastToss: string | undefined): string {
  const lines = [`Nodelist [type::nodelist] [node::${self.id}]${lastToss ? ` [last-toss::${lastToss}]` : ""}`, "",
    "The nodes this outline knows, written again by EchoNet's tosser at every toss (`ep0ch echo toss`). Edit the areas and subscriptions, not this.", ""];
  for (const f of facts) {
    const { link } = f;
    const state = link.node.id === self.id ? "this node" : link.reachable ? "reachable" : `unreachable: ${link.why}`;
    const open = link.reachable && link.level !== "none";
    lines.push(`## ${link.node.id}`);
    lines.push(`- ${state} · access ${link.reachable ? link.level : "unknown"}${f.role.length ? ` · ${f.role.join(", ")}` : ""}`);
    lines.push(`- last toss: ${f.lastToss ?? (link.reachable ? "never" : "unknown")}`);
    lines.push(`- areas: ${f.areas.length ? f.areas.join("; ") : open ? "none" : "unknown"}`);
    lines.push(`- subscriptions: ${f.subscriptions.length ? f.subscriptions.join("; ") : open ? "none" : "unknown"}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** `tossed`: this run is a toss, so this node's last toss is now; a nodelist-only run keeps the one it had. */
async function writeNodelist(nodelist: Block, subscribers: Set<string>, tossed: boolean): Promise<void> {
  const roles = new Map<string, string[]>();
  const add = (id: string, role: string) => roles.set(id, [...new Set([...(roles.get(id) ?? []), role])]);
  for (const sub of (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block))) {
    for (const id of (await sourcesUnder(sub)).keys()) add(id, `we read its ${values(sub, "echo").join(",")}`);
  }
  for (const id of subscribers) add(id, "reads our areas");
  const own = await factsOf(await linkTo(self), []);
  if (tossed) own.lastToss = now;
  const facts = [own];
  for (const [id, role] of roles) {
    const node = parseNode(id);
    if (node && node.id !== self.id) facts.push(await factsOf(await linkTo(node), role));
  }
  const text = nodelistText(facts, own.lastToss);
  // Unchanged, not written: a toss that learned nothing adds nothing to the change feed.
  await setOn(nodelist.id, () => text);
}

/** The nodes that read this one's areas: the seen-by marks they left here. */
async function subscribersHere(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const mark of await query(mine, "kind=echo-seen-by")) for (const value of values(mark, "echo.node")) found.add(value);
  return found;
}

async function toss(): Promise<string> {
  const nodelist = await nodelistBlock();
  const ledgerHome = await ledgerBlock(nodelist);
  const ledger = readLedger(ledgerHome);
  const before = new Map(ledger.lines);
  // Every copy this node holds, trashed ones too: a trashed copy is what keeps a message from coming back.
  const everyCopy = new Map<string, Block>();
  // `includeDeleted` answers only trashed blocks, so the live ones are a second question.
  for (const block of [...await query(mine, "from"), ...await query(mine, "from", { includeDeleted: "all" })]) {
    const from = fromOf(block);
    if (from && !everyCopy.has(from)) everyCopy.set(from, block);
  }
  if (everyCopy.size >= LIMIT) log.push(`- ${LIMIT} or more copies here: a toss reads ${LIMIT} at a time and may copy again what it didn't see`);
  const subs = (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block));
  log.push("## echomail");
  const read = new Map<string, Link>();
  for (const sub of subs) for (const link of await tossSubscription(sub, everyCopy)) read.set(link.node.id, link);
  log.push("## netmail");
  for (const link of read.values()) {
    const before = { out: counts.netmailOut, in: counts.netmailIn, queued: counts.queued, undeliverable: counts.undeliverable };
    for (const copy of fromNode(everyCopy, link.node)) await netmail(link, copy, ledger);
    const queued = counts.queued - before.queued, gaveUp = counts.undeliverable - before.undeliverable;
    const why = !link.reachable ? `unreachable (${link.why})` : !canMark(link.level) ? `${link.node.id} grants ${link.level}; netmail needs propose` : "waiting on an original that is gone";
    log.push(`- ${link.node.id}: ${counts.netmailOut - before.out} out, ${counts.netmailIn - before.in} in${queued ? `, ${queued} queued: ${why}` : ""}${gaveUp ? `, ${gaveUp} undeliverable` : ""}`);
  }
  // The ledger, when it learned something.
  if (ledger.lines.size !== before.size || [...ledger.lines].some(([key, value]) => before.get(key) !== value)) {
    await setOn(ledgerHome.id, () => ["EchoNet ledger [type::echo-ledger]", ...[...ledger.lines].map(([key, value]) => `- ${key} -> ${value}`)].join("\n"));
  }
  await writeNodelist(nodelist, await subscribersHere(), true);
  const summary = `copies ${counts.copies}, waiting ${counts.waiting}, newer ${counts.updated}, gone ${counts.gone}, skipped ${counts.skipped}, seen-by ${counts.seenBy}, ` +
    `netmail out ${counts.netmailOut}, in ${counts.netmailIn}, queued ${counts.queued}, undeliverable ${counts.undeliverable}`;
  const title = `Toss ${now.slice(0, 16).replace("T", " ")} UTC [type::toss] [node::${self.id}] [at::${now}] [copies::${counts.copies}] [waiting::${counts.waiting}] ` +
    `[updated::${counts.updated}] [gone::${counts.gone}] [skipped::${counts.skipped}] [netmail-out::${counts.netmailOut}] [netmail-in::${counts.netmailIn}] [queued::${counts.queued}] [undeliverable::${counts.undeliverable}]`;
  await mine({ action: "create", parentId: nodelist.id, text: [title, "", ...(input.scheduled ? ["(scheduled)", ""] : []), ...log].join("\n") });
  await pruneLogs(nodelist);
  return `${self.id} tossed: ${summary}`;
}

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
 * A copy whose original is newer: `take-newer` replaces its text with the original's (its own edits go, its EchoNet
 * keys stay); `compare-newer` proposes that text beside it, the difference drawn for the person to apply or dismiss.
 */
async function takeNewer(propose: boolean): Promise<{ message: string; open?: string }> {
  const block = input.context.block;
  const from = block ? fromOf(block)?.match(FROM) : undefined;
  if (!block || !from) return { message: "This note isn't an EchoNet copy: a copy carries [from::<outline>@<machine>/<id>]" };
  const node = parseNode(from[1])!;
  const link = await linkTo(node);
  if (!link.reachable) return { message: `${node.id} is unreachable (${link.why}); try again once it answers` };
  if (link.level === "none") return { message: `${node.id} grants none; its owner runs \`ep0ch mcp access read --ws ${node.outline}\`` };
  const original = await link.call<Block>({ action: "get", blockId: from[2]! }).catch(() => undefined);
  if (!original || trashed(original)) return { message: `The original is gone from ${node.id}: this copy is all there is now` };
  const current = await mine<Block>({ action: "get", blockId: block.id });
  const area = prop(current, "echo") ?? "?";
  const tossed = prop(current, "tossed");
  const text = await copyText(link, original, area, tossed);
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

try {
  if (input.action === "nodelist") {
    const nodelist = await nodelistBlock();
    await writeNodelist(nodelist, await subscribersHere(), false);
    answer({ message: `${self.id}: nodelist written`, open: nodelist.id });
  } else if (input.action === "take-newer" || input.action === "compare-newer") {
    answer(await takeNewer(input.action === "compare-newer"));
  } else {
    answer({ message: await toss() });
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
}

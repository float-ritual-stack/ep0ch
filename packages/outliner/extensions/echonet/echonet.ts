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
//   6. a machine that dials in (PIE-562: its inbound ssh off or gated, `notes.address`'s `dialsIn`) also calls the
//      nodes that read it: it delivers its areas' new messages into their subscriptions and carries the netmail both
//      ways, exactly as their own toss would have, and writes `call <this node> -> <time>` in their ledger. A node
//      that learns a machine dials in (that line, or `"dialsIn": true` in `<outlines>/.remote/<machine>.json`) never
//      calls it: it waits for the call, and its netmail for it is held until then.
//
// Nothing that came over the network goes out again: a copy is never a message (shapes.ts), and a mark that came in
// carries `netmail-from`, so the loop guard holds across any number of nodes. Offline is normal: a node that can't be
// reached is said in the nodelist, and what this node would send it stays here, counted as queued. The one access rule
// is the origin's own (`ep0ch mcp access`): `none` refuses, `read` lets this node copy, `propose` and `full` also let it
// write marks there (seen-by and netmail). Everything is written over the extension's connection, as `ext:echonet`.
import { readdirSync, readFileSync } from "node:fs";
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

const address = await outline<{ outline?: string; machine: string; aliases?: string[]; dialsIn?: boolean }>({ action: "notes.address" });
const self = nodeOf(process.env.EP0CH_WS ?? address.outline ?? "unknown", address.machine);

// ── one node, one name ──
//
// A machine is named by its person (`<outlines>/.host/machine-name`, `ep0ch install --apply`), else by its host name.
// Before it had a name, its tosser signed seen-by marks, netmail and the nodelist with its host name's form
// (`float-hub@evans-MacBook-Pro.local`), while other machines reach it by an ssh name (`float-hub@laptop`). Each
// host says the names it went by (`notes.address`'s `aliases`), so a mark under an old name is the same node's:
// never counted twice, never sent again.

/** The names this node went by: its own, then its machine's older ones. */
const selfIds = [self.id, ...(address.aliases ?? []).map((machine) => nodeOf(self.outline, machine).id)];
const isSelf = (id: string | undefined) => id !== undefined && selfIds.some((mine_) => mine_.toLowerCase() === id.toLowerCase());
const selfMachine = (machine: string) => [self.machine, ...(address.aliases ?? [])].some((name) => sameMachine(name, machine));
/** Another node's other names (what it calls itself, the names it went by), learned when it is linked: `<outline>@<name>` → its id here. */
const aliasOf = new Map<string, string>();
/** The other names `id` goes by, as learned: what the nodelist says under it. */
const akaOf = (id: string) => [...aliasOf].filter(([, to]) => to === id).map(([from]) => from);
/** A node id as this node knows it: its own name for itself, another node's by how it is reached from here. */
function canonical(id: string): string {
  if (isSelf(id)) return self.id;
  const known = [...aliasOf].find(([from]) => from.toLowerCase() === id.toLowerCase());
  return known?.[1] ?? id;
}

// ── nodes ──

/** How this node reaches another, and what that node lets it do. Learned once per toss. */
interface Link {
  readonly node: Node;
  readonly reachable: boolean;
  /** Why not, when it isn't (offline, no forward, another protocol). */
  readonly why?: string;
  readonly level: Level;
  /** It dials in: never called from here, it calls (its last call, when it has). */
  readonly dialsIn?: { readonly lastCall?: string };
  call<T>(request: OutlineRequest): Promise<T>;
}

const mine = <T>(request: OutlineRequest) => outline<T>(request);
const canMark = (level: Level) => level === "propose" || level === "full";
const remote = (machine: string) => !selfMachine(machine);
const links = new Map<string, Link>();

async function linkTo(node: Node): Promise<Link> {
  const known = links.get(node.id);
  if (known) return known;
  let link: Link;
  const unreachable = (why: string): Link => ({ node, reachable: false, why, level: "none", call: () => Promise.reject(new Error(`${node.id} is unreachable: ${why}`)) });
  const dialing = node.id === self.id ? undefined : dialsInFrom(node);
  if ((config.offline ?? []).includes(node.id)) link = unreachable("offline (config.json's offline list)");
  // A node that dials in is never called: its call brings what it has, and takes what waits here for it.
  else if (dialing) link = { ...unreachable(`waiting for ${node.id} to call in (${dialing.lastCall ? `last call ${when(dialing.lastCall)}` : "it hasn't called yet"})`), dialsIn: dialing };
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
      // What it calls itself, and the names it went by: a mark it left under one of them is this node's.
      const there = await call<{ machine?: string; aliases?: string[] }>({ action: "notes.address" }).catch(() => undefined);
      for (const name of [there?.machine, ...(there?.aliases ?? [])]) {
        if (name && !sameMachine(name, node.machine)) aliasOf.set(nodeOf(node.outline, name).id, node.id);
      }
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

// ── machines that dial in (PIE-562) ──
//
// A machine whose inbound ssh is off or gated (a laptop under a work policy) calls the others and is never called. It
// says so itself (`<outlines>/.host/dials-in`, `notes.address`'s `dialsIn`), and each node it calls learns it from the
// `call <node> -> <time>` line its call leaves in that node's ledger. `<outlines>/.remote/<machine>.json` here can say
// it outright: `"dialsIn": true` before the first call, `false` to call it again whatever the ledger learned.

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
  try {
    const value = (JSON.parse(readFileSync(join(folder, ".remote", `${machine}.json`), "utf8")) as { dialsIn?: unknown }).dialsIn;
    return typeof value === "boolean" ? value : undefined;
  } catch {
    return undefined;
  }
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

/** How recently a node must have called for this node's toss to leave its sources to the call. */
const RECENT_CALL_MS = 10 * 60_000;

/** A time as a nodelist line says it: `2026-10-12 14:02 UTC`. */
const when = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;

/** The outlines on a machine this node may read: every one here; on another machine, the ones that opted in. */
const listed = new Map<string, Promise<string[]>>();
function outlinesOn(machine: string): Promise<string[]> {
  const key = machine.toLowerCase();
  // A machine that dials in isn't asked: its outlines are the ones that have called.
  if (!listed.has(key) && machineDialsIn(machine)) {
    listed.set(key, Promise.resolve([...calls.keys()].map(parseNode).filter((node): node is Node => !!node && sameMachine(node.machine, machine)).map((node) => node.outline)));
  }
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

type NodeMask = Extract<Mask, { kind: "node" }>;
/** A subscription's masks with each named list read from its page here; `unread` when a list couldn't be. */
async function flatten(masks: readonly Mask[], depth = 0, call: Link["call"] = mine): Promise<{ masks: NodeMask[]; unread: boolean }> {
  const out: NodeMask[] = [];
  let unread = false;
  for (const mask of masks) {
    if (mask.kind === "node") { out.push(mask); continue; }
    if (depth > 2) continue;
    const page = await call<{ status: string; block?: Block }>({ action: "pages.resolve", address: mask.page }).catch(() => undefined);
    if (page?.status !== "resolved" || !page.block) {
      log.push(`- the node list ${mask.text} names no page here ([page::${mask.page}] on a note listing name@machine lines)`);
      unread = true;
      continue;
    }
    const under = await call<Block[]>({ action: "children", parentId: page.block.id }).catch(() => []);
    const inner = await flatten([page.block.text, ...under.map((child) => child.text)].flatMap(masksIn).map(parseMask).filter((m): m is Mask => !!m), depth + 1, call);
    out.push(...inner.masks);
    unread ||= inner.unread;
  }
  return { masks: out, unread };
}

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

const query = (call: Link["call"], where: string, extra: Record<string, unknown> = {}) =>
  call<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: LIMIT, ...extra } }).then((r) => r.blocks);
/**
 * The original, if it's still there: `null` when its node says it's gone (trashed, or no such block), `undefined` when
 * the node couldn't be asked (that's offline, not gone: netmail for it stays queued and no try is spent).
 */
async function originalOf(origin: Link, id: string): Promise<Block | null | undefined> {
  try {
    const block = await origin.call<Block>({ action: "get", blockId: id });
    return trashed(block) ? null : block;
  } catch (error) {
    return /block not found/i.test(error instanceof Error ? error.message : String(error)) ? null : undefined;
  }
}
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
async function copyText(origin: Link, message: Block, area: string, tossed?: string, keptOff = false): Promise<string> {
  const [head, ...rest] = (isMark(message) ? await markText(origin, message) : await localText(origin, message.text)).split("\n");
  const keep = keptOff || prop(message, "publish") === "never" ? " [publish::never]" : "";
  const keys = `[from::${origin.node.id}/${message.id}] [echo::${area}] [from-rev::${message.revision}]${tossed ? ` [tossed::${tossed}]` : ""}${keep}`;
  return [`${head!.trimEnd()} ${keys}`, ...rest].join("\n");
}

/**
 * A comment's text as a copy reads it: its heading says what it's on and links the note it's on in the origin
 * (`Comment on “forty seconds” in [Recon: flaky cron](ep0ch://…)`), and the store's keys are the original's
 * (`from-type`), so the copy is a note here with its thread (the replies, copied under it) and a way back.
 */
async function markText(origin: Link, mark: Block): Promise<string> {
  // The store's keys are on the line under the heading; the body after it is the writer's words, copied as written.
  const [heading, meta = "", ...body] = (await localText(origin, mark.text)).split("\n");
  const local = [meta.replace(MARK_KEYS, (all, key: string, value: string) =>
    key === "type" && !["annotation", "annotation-reply"].includes(value.trim()) ? all : `[from-${key}::${value}]`), ...body];
  if (prop(mark, "type") !== "annotation" || !mark.parentId) return [heading!, ...local].join("\n");
  const note = await originalOf(origin, mark.parentId).catch(() => undefined);
  const title = note ? firstLine(note.text).replace(/[[\]]/g, "") || "a note" : `a note in ${origin.node.outline}`;
  return [`${heading!.trimEnd()} in [${title}](ep0ch://${origin.node.id}/b/${mark.parentId})`, ...local].join("\n");
}

/** A note's first line changed in place, read fresh, written only when it changes. `call`: the outline it is in. */
async function setOn(blockId: string, change: (text: string) => string, call: Link["call"] = mine): Promise<void> {
  const current = await call<Block>({ action: "get", blockId });
  const text = change(current.text);
  if (text !== current.text) await call({ action: "update", blockId, expectedRevision: current.revision, text });
}

// ── the ledger: what was carried, both ways, and what waits ──

interface Ledger { block?: Block; lines: Map<string, string>; before: Map<string, string> }
/**
 * `out <local mark> -> <node>/<mark>` and `in …` per carried mark (netmail is never carried twice), `tries <mark> -> n`
 * for netmail waiting on an original that is gone, `undeliverable <mark> -> <note>` once it gave up, `seen <copy> ->
 * <node>/<original>` once its seen-by mark is there, `call <node> -> <time>`: a node that dials in, its last call, and
 * `aka <old name> -> <node>`: the names it went by, which its call says since it is never reached to be asked.
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
/**
 * The ledger, when this run changed it. Two runs may write one ledger (this node's toss and the call of a node that
 * dials in), so what this run changed is applied to the ledger as it is now, read again, never over it.
 */
async function saveLedger(home: Home): Promise<void> {
  const { ledger } = home;
  const set = [...ledger.lines].filter(([key, value]) => ledger.before.get(key) !== value);
  const gone = [...ledger.before.keys()].filter((key) => !ledger.lines.has(key));
  if (!set.length && !gone.length) return;
  for (let attempt = 0; ; attempt += 1) {
    const fresh = readLedger(await home.call<Block>({ action: "get", blockId: ledger.block!.id }));
    for (const [key, value] of set) fresh.lines.set(key, value);
    for (const key of gone) fresh.lines.delete(key);
    try {
      await home.call({ action: "update", blockId: fresh.block!.id, expectedRevision: fresh.block!.revision, text: [LEDGER_TITLE, ...[...fresh.lines].map(([key, value]) => `- ${key} -> ${value}`)].join("\n") });
      return;
    } catch (error) {
      if (attempt >= 2 || !/saved since it was read/.test(error instanceof Error ? error.message : String(error))) throw error;
    }
  }
}

// ── home: the node a toss writes for ──

interface Counts { copies: number; updated: number; gone: number; skipped: number; waiting: number; seenBy: number; netmailOut: number; netmailIn: number; queued: number; held: number; undeliverable: number }
const noCounts = (): Counts => ({ copies: 0, updated: 0, gone: 0, skipped: 0, waiting: 0, seenBy: 0, netmailOut: 0, netmailIn: 0, queued: 0, held: 0, undeliverable: 0 });

/**
 * The subscriber a toss writes for: its subscriptions, copies, ledger and log. A toss writes for this node; a node that
 * dials in also writes for each node that reads it, over the relay, exactly as that node's own toss would have.
 */
interface Home {
  readonly node: Node;
  readonly call: Link["call"];
  /** The names it went by: a mark under any of them is its own. */
  readonly names: readonly string[];
  readonly ledger: Ledger;
  /** Every copy it holds, trashed ones too, by `from`: a trashed copy is what keeps a message from coming back. */
  readonly everyCopy: Map<string, Block>;
  readonly counts: Counts;
  readonly log: string[];
}
const isHome = (home: Home, id: string | undefined) => id !== undefined && home.names.some((name) => name.toLowerCase() === id.toLowerCase());
/** Whether a `netmail-from` (`<node>/<mark>`) is the home's, under any name it went by. */
const sentFrom = (home: Home, key: string | undefined, markId: string) => key !== undefined && key.endsWith(`/${markId}`) && isHome(home, key.slice(0, -markId.length - 1));

/**
 * The oldest live one: a node's toss and a call can each make a nodelist or ledger at once, and every later run then
 * keeps to the same one.
 */
const oldest = (blocks: Block[]) => blocks.filter((block) => !trashed(block)).sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? "") || a.id.localeCompare(b.id))[0];

async function nodelistBlock(call: Link["call"] = mine, node: Node = self): Promise<Block> {
  const found = oldest(await query(call, "type=nodelist"));
  if (found) return found;
  return call<Block>({ action: "create", text: `Nodelist [type::nodelist] [node::${node.id}]\n\nWritten by EchoNet's tosser; the next toss writes it again.` });
}

async function ledgerBlock(nodelist: Block, call: Link["call"] = mine): Promise<Block> {
  const found = oldest(await query(call, "type=echo-ledger"));
  if (found) return found;
  return call<Block>({ action: "create", parentId: nodelist.id, text: LEDGER_TITLE });
}

/** A home's copies, live and trashed (`includeDeleted` answers only trashed blocks, so the live ones are a second question). */
async function copiesAt(call: Link["call"], log: string[]): Promise<Map<string, Block>> {
  const everyCopy = new Map<string, Block>();
  for (const block of [...await query(call, "from"), ...await query(call, "from", { includeDeleted: "all" })]) {
    const from = fromOf(block);
    if (from && !everyCopy.has(from)) everyCopy.set(from, block);
  }
  if (everyCopy.size >= LIMIT) log.push(`- ${LIMIT} or more copies here: a toss reads ${LIMIT} at a time and may copy again what it didn't see`);
  return everyCopy;
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
  return {
    masks: masks as Mask[], areas,
    since: from,
    cap: Number.isInteger(cap) && cap > 0 ? cap : CAP,
  };
}

/** "From now": a subscription without `since` takes what is new from its first toss, and says so on itself. */
async function sinceNow(home: Home, sub: Block, wanted: Wanted): Promise<void> {
  if (prop(sub, "since") !== undefined) return;
  await setOn(sub.id, (text) => setHeaderProperty(text, "since", now), home.call);
  wanted.since = Date.parse(now);
}

/** The source boards under a subscription, by node. */
async function sourcesUnder(sub: Block, call: Link["call"] = mine): Promise<Map<string, Block>> {
  const boards = new Map<string, Block>();
  for (const child of await call<Block[]>({ action: "children", parentId: sub.id })) {
    const node = parseNode(prop(child, "echo-source"));
    if (node && !trashed(child)) boards.set(node.id, child);
  }
  return boards;
}

/** Whether the home holds a copy of `from` (live or trashed) that the toss's list of copies didn't reach. */
async function copyHeld(home: Home, from: string): Promise<boolean> {
  const where = `from="${from}"`;
  const found = [...await query(home.call, where), ...await query(home.call, where, { includeDeleted: "all" })].find((block) => fromOf(block) === from);
  if (found) home.everyCopy.set(from, found);
  return !!found;
}

/** Every live copy from `node`, for netmail: each once, whichever subscription brought it. */
const fromNode = (everyCopy: Map<string, Block>, node: Node) => [...everyCopy.values()].filter((copy) => fromOf(copy)!.startsWith(`${node.id}/`) && !trashed(copy));

// ── the toss ──

/** One subscription here: echomail in from each node it matches, seen-by out. Answers the nodes it read, for netmail. */
async function tossSubscription(home: Home, sub: Block): Promise<Link[]> {
  const { log } = home;
  const name = firstLine(sub.text) || values(sub, "echo").join(", ");
  const wanted = wantedBy(sub);
  if (typeof wanted === "string") {
    log.push(`- ${name}: ${wanted}`);
    return [];
  }
  await sinceNow(home, sub, wanted);
  const flat = await flatten(wanted.masks);
  const named = flat.masks.map((mask) => mask.machine);
  const boards = await sourcesUnder(sub);
  const nodes = new Map((await nodesFor(flat.masks, named)).map((node) => [node.id, node]));
  // A node with a board stays read while a mask still names it, even when its machine can't list its outlines now;
  // all of them while a named list can't be read.
  for (const id of boards.keys()) {
    const node = parseNode(id)!;
    const named_ = flat.masks.some((mask) => glob(mask.outline).test(node.outline) && glob(mask.machine).test(node.machine));
    if (!nodes.has(id) && (named_ || flat.unread)) nodes.set(id, node);
  }
  const exact = wanted.masks.length === 1 && wanted.masks[0]!.kind === "node" && !hasStar(wanted.masks[0]!.text);
  const read: Link[] = [];
  for (const node of nodes.values()) {
    const link = await linkTo(node);
    const board = boards.get(node.id);
    // A mask reaches many nodes: only a node with a board, or the one node named outright, is worth a line.
    const say = (line: string) => { if (board || exact) log.push(`- ${line}`); };
    if (link.dialsIn) { say(`${node.id} (${name}): ${link.why}; its call brings the new messages`); if (board) read.push(link); continue; }
    // It called a moment ago and tosses this itself: two at once would each make the same copy.
    const lastCall = [...calls].find(([id]) => id.toLowerCase() === node.id.toLowerCase())?.[1];
    if (lastCall && Date.parse(now) - Date.parse(lastCall) < RECENT_CALL_MS) { say(`${node.id} (${name}): it called at ${when(lastCall)} and tosses this itself; left to its call`); if (board) read.push(link); continue; }
    if (!link.reachable) { say(`${node.id} (${name}): unreachable (${link.why}); its copies stay as they are`); if (board) read.push(link); continue; }
    if (link.level === "none") { say(`${node.id} (${name}): refused (${node.id} grants none; its owner runs \`ep0ch mcp access read --ws ${node.outline}\`)`); if (board) read.push(link); continue; }
    if (await tossSource(home, sub, link, board, wanted, name)) read.push(link);
    else say(`${node.id} (${name}): no area there named ${wanted.areas.join(" or ")}`);
  }
  if (!nodes.size) log.push(`- ${name}: ${wanted.masks.map((mask) => mask.text).join(", ")} matches no node this toss`);
  return read;
}

/** One node's messages for one subscription. False when it offers none of the areas wanted (and had no board). */
async function tossSource(home: Home, sub: Block, link: Link, existing: Block | undefined, wanted: Wanted, name: string): Promise<boolean> {
  const { everyCopy, counts, log } = home;
  // Newest first: past the 1000 a question answers, it's the oldest that a toss doesn't see.
  const tagged = await query(link.call, "echo", { sort: "updated desc" });
  const offered = areasIn(tagged);
  const matched = [...offered.values()].filter((area) => wanted.areas.some((mask) => glob(mask).test(area.name)));
  if (!matched.length && !existing) return false;
  // Each message once, in the first area that has it (a cross-post is copied once).
  const messages = new Map<string, { message: Block; area: string }>();
  const add = (message: Block, area: string) => { if (isMessage(message) && !trashed(message) && !messages.has(message.id)) messages.set(message.id, { message, area }); };
  for (const area of matched) {
    for (const block of area.blocks) for (const message of await query(link.call, areaQuery(block), { sort: "updated desc" })) add(message, area.name);
    for (const message of tagged) if (postsTo(message, area.name)) add(message, area.name);
  }
  const board = existing ?? await home.call<Block>({ action: "create", parentId: sub.id, text: `${link.node.id} [echo-source::${link.node.id}]` });
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
      await copyChildren(home, link, entry.area, message.id, copy.id, 0, isMark(message));
      await setOn(copy.id, (text) => setHeaderProperty(text, "echo-partial", undefined), home.call);
    }
    // Kept off the web there since it was copied: the copy is kept off at once, whether or not its text is taken.
    if (prop(message, "publish") === "never" && prop(copy, "publish") !== "never") await setOn(copy.id, (text) => setHeaderProperty(text, "publish", "never"), home.call);
    const seen = Number(prop(copy, "from-rev") ?? 0);
    if (message.revision > seen && prop(copy, "upstream-newer") !== String(message.revision)) {
      await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-newer", String(message.revision)), home.call);
      newer += 1;
    }
    if (prop(copy, "upstream-gone") !== undefined) await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", undefined), home.call);
    // The newer version asked for while its node couldn't be called (it dials in): taken or proposed now.
    const take = prop(copy, "echo-take");
    if (take !== undefined) home.log.push(`- ${firstLine(copy.text)}: ${(await newerFor(home.call, copy.id, link, message.id, take === "compare")).message}`);
    if (canMark(link.level) && !isMark(message)) await seenBy(home, link, message, copy, name);
  }
  // Oldest first, `cap` a toss: a broad area's first toss doesn't flood, and what waits is said on the board.
  fresh.sort((a, b) => time(a.message) - time(b.message));
  let copied = 0;
  for (const { message, area } of fresh) {
    if (copied >= wanted.cap) break;
    const from = `${link.node.id}/${message.id}`;
    // Copied with its parent a moment ago, or held beyond the copies this toss could list: asked outright.
    if (everyCopy.has(from) || await copyHeld(home, from)) continue;
    const made = await home.call<Block>({ action: "create", parentId: board.id, text: await copyText(link, message, area, now) });
    try {
      await copyChildren(home, link, area, message.id, made.id, 0, isMark(message));
    } catch (error) {
      // Stopped partway through the notes under it: the next toss finishes them (`echo-partial`).
      await setOn(made.id, (text) => setHeaderProperty(text, "echo-partial", "yes"), home.call).catch(() => undefined);
      throw error;
    }
    everyCopy.set(from, made);
    copied += 1;
    if (canMark(link.level) && !isMark(message)) await seenBy(home, link, message, made, name);
  }
  const waiting = fresh.filter(({ message }) => !everyCopy.has(`${link.node.id}/${message.id}`)).length;
  await setOn(board.id, (text) => setHeaderProperty(text, "waiting", waiting ? String(waiting) : undefined), home.call);
  // An original gone upstream (trashed or deleted there): the copy stays, drift being the point, and says so.
  let gone = 0;
  for (const copy of (await home.call<Block[]>({ action: "children", parentId: board.id })).filter(isCopy)) {
    const id = fromOf(copy)!.match(FROM)![2]!;
    if (messages.has(id) || prop(copy, "upstream-gone") !== undefined) continue;
    // Gone only when the node says so: a request that failed on the way says nothing.
    if ((await originalOf(link, id)) === null) {
      await setOn(copy.id, (text) => setHeaderProperty(text, "upstream-gone", day), home.call);
      gone += 1;
    }
  }
  counts.copies += copied; counts.updated += newer; counts.skipped += skipped; counts.waiting += waiting; counts.gone += gone;
  log.push(`- ${link.node.id} (${name}, ${link.level}): ${messages.size} in ${matched.map((area) => area.name).join(", ") || "no area now"}; ` +
    `${copied} copied${waiting ? `, ${waiting} waiting` : ""}, ${newer} marked newer, ${gone} gone upstream, ${skipped} trashed here and left so`);
  return true;
}

/**
 * The notes under a message, each a copy with its own `from` (so it is never echoed again as an original here, and a
 * mark on it is netmail too). Copied once, with the message; later notes under the original are upstream's.
 */
async function copyChildren(home: Home, origin: Link, area: string, fromId: string, toId: string, depth: number, markParent = false): Promise<void> {
  if (depth > 4) return;
  const children = await origin.call<Block[]>({ action: "children", parentId: fromId });
  for (const child of children) {
    const from = `${origin.node.id}/${child.id}`;
    // A copy there (moved under a note of its own) is never sent on: it's another node's. A note's marks travel as
    // netmail and seen-by, never as copies; a comment's replies are its thread, copied with it.
    if (home.everyCopy.has(from) || isCopy(child) || (isMark(child) && !markParent)) continue;
    const made = await home.call<Block>({ action: "create", parentId: toId, text: await copyText(origin, child, area) });
    home.everyCopy.set(from, made);
    await copyChildren(home, origin, area, child.id, made.id, depth + 1, isMark(child));
  }
}

/** "also in: <the home node>": one whole-note mark on the original per node it reached. Its text is never touched. */
async function seenBy(home: Home, origin: Link, message: Block, copy: Block, area: string): Promise<void> {
  const { ledger } = home;
  // Left once: the ledger says so, and the original's marks aren't read again every toss.
  if (ledger.lines.has(`seen ${copy.id}`)) return;
  const threads = await threadsOn(origin.call, message.id);
  if (threads.some((thread) => thread.properties?.kind?.includes("echo-seen-by") && thread.properties["echo.node"]?.some((id) => isHome(home, id)))) {
    ledger.lines.set(`seen ${copy.id}`, `${origin.node.id}/${message.id}`);
    return;
  }
  await origin.call({
    action: "annotations.batch", requestId: `echonet-seen-${home.node.id}-${copy.id}`,
    operations: [{ operationId: "seen", type: "block-comment", input: {
      blockId: message.id, expectedRevision: message.revision, source: "agent",
      body: `also in: ${home.node.id} (${area})`,
      properties: { kind: "echo-seen-by", "echo.node": home.node.id, "echo.copy": copy.id, via: `echonet:${home.node.id}` },
    } }],
  });
  ledger.lines.set(`seen ${copy.id}`, `${origin.node.id}/${message.id}`);
  home.counts.seenBy += 1;
}

/** The marks on a home's copy that go out as netmail and haven't yet: written there, not carried, not given up on. */
async function outgoingOn(home: Home, copy: Block): Promise<{ local: Thread[]; waiting: Mark[] }> {
  const local = (await threadsOn(home.call, copy.id)).filter((thread) => !cameIn(thread) || thread.replies.length);
  const waiting = local.flatMap(outgoing).filter((mark) => !home.ledger.lines.has(`out ${mark.block.id}`) && !home.ledger.lines.has(`undeliverable ${mark.block.id}`));
  return { local, waiting };
}
const outgoing = (thread: Thread) => [thread, ...thread.replies].filter((mark) => !cameIn(mark));

/** Netmail for one of the home's copies: its marks out to the original, the origin's replies back in. */
async function netmail(home: Home, origin: Link, copy: Block): Promise<void> {
  const { ledger, counts } = home;
  const originalId = fromOf(copy)!.match(FROM)![2]!;
  const { local, waiting } = await outgoingOn(home, copy);
  // A node that dials in takes its netmail when it calls: held here till then, never a queue that grows on its own.
  if (origin.dialsIn) {
    counts.held += waiting.length;
    return;
  }
  if (!origin.reachable || !canMark(origin.level)) {
    counts.queued += waiting.length;
    return;
  }
  if (!local.length) return;
  let original = await originalOf(origin, originalId);
  if (original === undefined) {
    counts.queued += waiting.length;
    return;
  }
  if (original === null) {
    await undeliverable(home, origin, copy, waiting);
    return;
  }
  // A mark left as undeliverable stays so, even if its original comes back.
  const gaveUp = (mark: Mark) => ledger.lines.has(`undeliverable ${mark.block.id}`);
  if (isMarkCopy(copy)) {
    await threadNetmail(home, origin, original, local.flatMap(outgoing).filter((mark) => !gaveUp(mark)));
    return;
  }
  const remoteThreads = await threadsOn(origin.call, originalId);
  for (const thread of local) {
    if (cameIn(thread) || gaveUp(thread)) continue;
    const key = `${home.node.id}/${thread.block.id}`;
    let there = remoteThreads.find((candidate) => sentFrom(home, netmailFrom(candidate), thread.block.id));
    if (!there) {
      original = (await originalOf(origin, originalId)) ?? original;
      const quote = quoteOf(thread);
      const anchored = quote !== undefined && quote.length > 0 && original.text.includes(quote);
      const body = anchored ? thread.body : `${quote ? `(on words no longer in the note: “${quote}”)${thread.body ? "\n" : ""}` : ""}${thread.body}`;
      const { "netmail-from": _a, via: _b, ...own } = thread.properties ?? {};
      const receipt = await origin.call<{ annotations: Mark[] }>({
        action: "annotations.batch", requestId: `echonet-out-${key}`,
        operations: [{ operationId: "netmail", type: "block-comment", input: {
          blockId: originalId, expectedRevision: original.revision, source: "agent", body,
          ...(anchored ? { passage: { quote } } : {}),
          properties: { ...own, via: `echonet:${home.node.id}`, "netmail-from": key, "netmail-author": authorOf(thread) },
        } }],
      });
      there = { ...receipt.annotations[0]!, replies: [] };
      ledger.lines.set(`out ${thread.block.id}`, `${origin.node.id}/${there.block.id}`);
      ledger.lines.delete(`tries ${thread.block.id}`);
      counts.netmailOut += 1;
    } else if (!ledger.lines.has(`out ${thread.block.id}`)) ledger.lines.set(`out ${thread.block.id}`, `${origin.node.id}/${there.block.id}`);
    // Replies written here go out; replies written there come in. One that came in carries netmail-from, so it never
    // goes back out, and one that went out carries it there, so it never comes back.
    for (const reply of thread.replies.filter((candidate) => !cameIn(candidate) && !gaveUp(candidate))) {
      const replyKey = `${home.node.id}/${reply.block.id}`;
      const sent = there.replies.find((candidate) => sentFrom(home, netmailFrom(candidate), reply.block.id));
      if (sent) {
        // Sent by a toss that stopped before it wrote the ledger: written now.
        if (!ledger.lines.has(`out ${reply.block.id}`)) ledger.lines.set(`out ${reply.block.id}`, `${origin.node.id}/${sent.block.id}`);
        continue;
      }
      const receipt = await origin.call<{ annotations: Mark[] }>({
        action: "annotations.reply", requestId: `echonet-out-${replyKey}`,
        input: { annotationId: there.block.id, body: reply.body, source: "agent", properties: { via: `echonet:${home.node.id}`, "netmail-from": replyKey, "netmail-author": authorOf(reply) } },
      });
      ledger.lines.set(`out ${reply.block.id}`, `${origin.node.id}/${receipt.annotations[0]!.block.id}`);
      counts.netmailOut += 1;
    }
    for (const reply of there.replies.filter((candidate) => !netmailFrom(candidate))) {
      const replyKey = `${origin.node.id}/${reply.block.id}`;
      if (thread.replies.some((candidate) => netmailFrom(candidate) === replyKey)) continue;
      const receipt = await home.call<{ annotations: Mark[] }>({
        action: "annotations.reply", requestId: `echonet-in-${replyKey}-${thread.block.id}`,
        input: { annotationId: thread.block.id, body: reply.body, source: "agent", properties: { via: `echonet:${origin.node.id}`, "netmail-from": replyKey, "netmail-author": authorOf(reply) } },
      });
      ledger.lines.set(`in ${receipt.annotations[0]!.block.id}`, replyKey);
      counts.netmailIn += 1;
    }
  }
}

/**
 * Netmail for a copy of a comment: what's written on the copy here joins the original's thread there, as replies (a
 * mark can't be marked), each once, `via echonet:<the home node>`. Its replies there were copied with it; later ones
 * are upstream's, like later notes under a copied note.
 */
async function threadNetmail(home: Home, origin: Link, original: Block, marks: Mark[]): Promise<void> {
  const { ledger, counts } = home;
  const root = prop(original, "type") === "annotation-reply" && original.parentId ? original.parentId : original.id;
  for (const mark of marks) {
    if (ledger.lines.has(`out ${mark.block.id}`)) continue;
    const key = `${home.node.id}/${mark.block.id}`;
    const quote = quoteOf(mark);
    const body = `${quote ? `(on “${quote}”)${mark.body ? "\n" : ""}` : ""}${mark.body}`;
    const receipt = await origin.call<{ annotations: Mark[] }>({
      action: "annotations.reply", requestId: `echonet-out-${key}`,
      input: { annotationId: root, body: body || "(a highlight on the copy)", source: "agent", properties: { via: `echonet:${home.node.id}`, "netmail-from": key, "netmail-author": authorOf(mark) } },
    });
    ledger.lines.set(`out ${mark.block.id}`, `${origin.node.id}/${receipt.annotations[0]!.block.id}`);
    ledger.lines.delete(`tries ${mark.block.id}`);
    counts.netmailOut += 1;
  }
}

/**
 * Netmail whose original is gone: tried again for `TRIES` tosses (it may come back from Trash), then left in the home
 * as an undeliverable note beside the copy, saying what it was and why, and never queued again.
 */
async function undeliverable(home: Home, origin: Link, copy: Block, marks: Mark[]): Promise<void> {
  const { ledger, counts, log } = home;
  for (const mark of marks) {
    const tries = Number(ledger.lines.get(`tries ${mark.block.id}`) ?? 0) + 1;
    if (tries < TRIES) {
      ledger.lines.set(`tries ${mark.block.id}`, String(tries));
      counts.queued += 1;
      continue;
    }
    const said = (mark.body || quoteOf(mark) || "a highlight").replace(/\s+/g, " ").slice(0, 60);
    const note = await home.call<Block>({
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

/** Netmail for every copy a home holds from the nodes it read, each node's said in its log. */
async function netmailFor(home: Home, read: Iterable<Link>): Promise<void> {
  const { counts, log } = home;
  for (const link of read) {
    const before = { ...counts };
    for (const copy of fromNode(home.everyCopy, link.node)) await netmail(home, link, copy);
    const queued = counts.queued - before.queued, held = counts.held - before.held, gaveUp = counts.undeliverable - before.undeliverable;
    const why = !link.reachable ? `unreachable (${link.why})` : !canMark(link.level) ? `${link.node.id} grants ${link.level}; netmail needs propose` : "waiting on an original that is gone";
    log.push(`- ${link.node.id}: ${counts.netmailOut - before.netmailOut} out, ${counts.netmailIn - before.netmailIn} in` +
      `${queued ? `, ${queued} queued: ${why}` : ""}${held ? `, ${held} held until it calls in` : ""}${gaveUp ? `, ${gaveUp} undeliverable` : ""}`);
  }
}

// ── the call: a node that dials in tosses for the nodes that read it ──

/**
 * This node dials in: no other machine calls it, so it calls each node on another machine that reads it (or holds
 * its copies) and does that node's toss for it, through the relay and held to that node's access level: the new
 * messages of the areas it subscribes to here go into its subscriptions, and the netmail on its copies comes here
 * and the replies written here go back. Its ledger gets `call <this node> -> <time>`, which is how it learns that
 * this node dials in, and a toss log of the call goes under its nodelist.
 */
async function callIn(subscribers: Set<string>): Promise<void> {
  log.push("## calls (this node dials in)");
  const nodes = new Map<string, Node>();
  const add = (node: Node | undefined) => { if (node && remote(node.machine) && !isSelf(node.id)) nodes.set(canonical(node.id), node); };
  // The nodes it knows on other machines: those that read it, those it reads, and every outline that opted in on a
  // machine it knows of.
  for (const id of subscribers) add(parseNode(canonical(id)));
  for (const sub of (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block))) {
    for (const id of (await sourcesUnder(sub)).keys()) add(parseNode(id));
  }
  for (const machine of knownMachines([]).filter(remote)) for (const name of await outlinesOn(machine)) add(nodeOf(name, machine));
  if (!nodes.size) log.push("- no node on another machine to call");
  const origin = await linkTo(self);
  for (const node of nodes.values()) {
    const link = await linkTo(node);
    if (link.dialsIn) { log.push(`- ${node.id} dials in too: neither calls the other`); continue; }
    if (!link.reachable) { log.push(`- ${node.id}: unreachable (${link.why}); the next toss calls again`); continue; }
    try {
      await callNode(link, origin);
    } catch (error) {
      log.push(`- ${node.id}: the call stopped (${error instanceof Error ? error.message.split("\n")[0] : String(error)}); the next toss carries on from there`);
    }
  }
}

/** Whether a subscription's masks name this node (under any name it went by); its named lists are read there. */
async function namesSelf(home: Home, wanted: Wanted): Promise<boolean> {
  const flat = await flatten(wanted.masks, 0, home.call);
  return flat.masks.some((mask) => glob(mask.outline).test(self.outline) && [self.machine, ...(address.aliases ?? [])].some((machine) => glob(mask.machine).test(machine)));
}

async function callNode(link: Link, origin: Link): Promise<void> {
  const there = link.node;
  const subs = (await query(link.call, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block));
  const callLog: string[] = [];
  // Its copies of this node's notes, for netmail even after the subscription that brought them is gone.
  const ours = (await query(link.call, "from")).some((block) => { const from = fromOf(block); return !!from && isSelf(from.split("/")[0]); });
  const wanting: Array<{ sub: Block; wanted: Wanted }> = [];
  const probe: Home = { node: there, call: link.call, names: [there.id, ...akaOf(there.id)], ledger: readLedger(undefined), everyCopy: new Map(), counts: noCounts(), log: callLog };
  for (const sub of subs) {
    const wanted = wantedBy(sub);
    if (typeof wanted !== "string" && await namesSelf(probe, wanted)) wanting.push({ sub, wanted });
  }
  if (!wanting.length && !ours) { log.push(`- ${there.id}: reads nothing of ${self.id}`); return; }
  // Its toss would write its copies, ledger and log: so does the call, and it needs what that needs.
  // At propose, its host lets a call write what that node's own toss would and nothing else (src/echonet-scope.ts).
  if (!canMark(link.level)) {
    log.push(`- ${there.id}: grants ${link.level}, and a call needs propose (its owner runs \`ep0ch mcp access propose --ws ${there.outline}\` on ${there.machine})`);
    return;
  }
  const nodelist = await nodelistBlock(link.call, there);
  const ledger = readLedger(await ledgerBlock(nodelist, link.call));
  const home: Home = { ...probe, ledger, everyCopy: await copiesAt(link.call, callLog), counts: noCounts() };
  if (origin.level === "none") callLog.push(`- ${self.id} grants none: nothing of its goes out (\`ep0ch mcp access read --ws ${self.outline}\` here)`);
  else {
    callLog.push("## echomail");
    for (const { sub, wanted } of wanting) {
      const name = firstLine(sub.text) || values(sub, "echo").join(", ");
      await sinceNow(home, sub, wanted);
      const boards = await sourcesUnder(sub, link.call);
      const board = [...boards].find(([id]) => isSelf(id))?.[1];
      if (!await tossSource(home, sub, origin, board, wanted, name)) callLog.push(`- ${self.id} (${name}): no area here named ${wanted.areas.join(" or ")}`);
    }
  }
  callLog.push("## netmail");
  await netmailFor(home, [origin]);
  ledger.lines.set(`call ${self.id}`, now);
  // It is never reached to be asked what it went by: its call says, so marks under an old name stay its own there.
  for (const machine of address.aliases ?? []) ledger.lines.set(`aka ${nodeOf(self.outline, machine).id}`, self.id);
  await saveLedger(home);
  const c = home.counts;
  await link.call({ action: "create", parentId: nodelist.id, text: [
    `Call from ${self.id} ${now.slice(0, 16).replace("T", " ")} UTC [type::toss] [node::${self.id}] [call::${there.id}] [at::${now}] [copies::${c.copies}] [waiting::${c.waiting}] ` +
      `[updated::${c.updated}] [gone::${c.gone}] [skipped::${c.skipped}] [netmail-out::${c.netmailOut}] [netmail-in::${c.netmailIn}] [queued::${c.queued}] [undeliverable::${c.undeliverable}]`,
    "", `${self.id} dials in: it called and did ${there.id}'s toss for what ${there.id} reads of it.`, "", ...callLog,
  ].join("\n") });
  const said = `${c.copies} copied there${c.waiting ? `, ${c.waiting} waiting` : ""}, ${c.updated} marked newer, ` +
    `netmail ${c.netmailOut} to here, ${c.netmailIn} to there${c.queued ? `, ${c.queued} queued` : ""}${c.undeliverable ? `, ${c.undeliverable} undeliverable` : ""}`;
  log.push(`- ${there.id} (${link.level}): called; ${said}`);
  called.push(`${there.id} (${said})`);
}

/** The nodes this run called (it dials in), and what each call carried: said in the toss's answer. */
const called: string[] = [];

// ── the nodelist ──

interface NodeFacts { link: Link; areas: string[]; subscriptions: string[]; lastToss?: string; role: string[]; held?: number }

async function factsOf(link: Link, role: string[]): Promise<NodeFacts> {
  const facts: NodeFacts = { link, areas: [], subscriptions: [], role };
  if (link.dialsIn) {
    facts.lastToss = link.dialsIn.lastCall;
    facts.held = await heldFor(link);
    return facts;
  }
  if (!link.reachable || link.level === "none") return facts;
  const tagged = await query(link.call, "echo");
  facts.areas = [...areasIn(tagged).values()].map((area) => `${area.name} (${area.blocks.length ? firstLine(area.blocks[0]!.text) || "a view" : `${area.postings} posted`})`);
  facts.subscriptions = (await query(link.call, "subscribe")).filter((sub) => kindOf(sub) === "subscription" && !trashed(sub))
    .map((sub) => `${values(sub, "echo").join(",")} from ${values(sub, "subscribe").join(",")}`);
  const list = (await query(link.call, "type=nodelist"))[0];
  facts.lastToss = list ? prop(list, "last-toss") : undefined;
  return facts;
}

/** The netmail held here for a node that dials in: marks on its copies not yet carried, which its next call takes. */
async function heldFor(link: Link): Promise<number> {
  const home = selfHome ?? await homeHere();
  let held = 0;
  for (const copy of fromNode(home.everyCopy, link.node)) held += (await outgoingOn(home, copy)).waiting.length;
  return held;
}

function nodelistText(facts: NodeFacts[], lastToss: string | undefined): string {
  const lines = [`Nodelist [type::nodelist] [node::${self.id}]${lastToss ? ` [last-toss::${lastToss}]` : ""}`, "",
    "The nodes this outline knows, written again by EchoNet's tosser at every toss (`ep0ch echo toss`). Edit the areas and subscriptions, not this.", ""];
  for (const f of facts) {
    const { link } = f;
    const roles = f.role.length ? ` · ${f.role.join(", ")}` : "";
    const aka = link.node.id === self.id ? selfIds.slice(1) : akaOf(link.node.id);
    lines.push(`## ${link.node.id}`);
    if (link.dialsIn) {
      // Never down: it calls when it can, and what waits for it is held here.
      lines.push(`- dials in · last call ${link.dialsIn.lastCall ? when(link.dialsIn.lastCall) : "never"}${roles}`);
      if (aka.length) lines.push(`- also known as: ${aka.join(", ")}`);
      lines.push(`- netmail held: ${f.held ?? 0}${f.held ? ` (its next call takes ${f.held === 1 ? "it" : "them"})` : ""}`);
      lines.push(`- last toss: ${f.lastToss ?? "unknown"}`);
      lines.push("- areas: unknown");
      lines.push("- subscriptions: unknown");
      lines.push("");
      continue;
    }
    const state = link.node.id === self.id ? "this node" : link.reachable ? "reachable" : `unreachable: ${link.why}`;
    const open = link.reachable && link.level !== "none";
    const dialing = link.node.id === self.id && address.dialsIn ? " · dials in" : "";
    lines.push(`- ${state} · access ${link.reachable ? link.level : "unknown"}${dialing}${roles}`);
    if (aka.length) lines.push(`- also known as: ${aka.join(", ")}`);
    lines.push(`- last toss: ${f.lastToss ?? (link.reachable ? "never" : "unknown")}`);
    lines.push(`- areas: ${f.areas.length ? f.areas.join("; ") : open ? "none" : "unknown"}`);
    lines.push(`- subscriptions: ${f.subscriptions.length ? f.subscriptions.join("; ") : open ? "none" : "unknown"}`);
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
  for (const sub of (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block))) {
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
  const own = await factsOf(await linkTo(self), []);
  if (tossed) own.lastToss = now;
  const facts = [own];
  for (const [id, role] of roles) {
    const node = parseNode(id);
    if (node && !isSelf(node.id)) facts.push(await factsOf(await linkTo(node), role));
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

/** This node as a home: its ledger and copies, read once a run. */
let selfHome: Home | undefined;
async function homeHere(): Promise<Home> {
  if (selfHome) return selfHome;
  const nodelist = await nodelistBlock();
  const ledger = readLedger(await ledgerBlock(nodelist));
  calls = callsIn(ledger);
  selfHome = { node: self, call: mine, names: selfIds, ledger, everyCopy: await copiesAt(mine, log), counts, log };
  return selfHome;
}

const counts = noCounts();
const log: string[] = [];

/**
 * Where this node's last toss stopped looking for what others delivered (its `[scanned::]`, else when its log was
 * written; a call's log left out): what landed after is new, and what that toss wrote itself is before it.
 */
async function lastTossEnd(nodelist: Block): Promise<string | undefined> {
  const logs = (await mine<Block[]>({ action: "children", parentId: nodelist.id }))
    .filter((block) => prop(block, "type") === "toss" && isSelf(prop(block, "node")) && prop(block, "call") === undefined);
  // `scanned`: when that toss last looked; what landed after is this one's, even if it came before that log was written.
  return logs.map((block) => prop(block, "scanned") ?? block.createdAt ?? "").filter(Boolean).sort().at(-1);
}

/**
 * Netmail and seen-by marks that other nodes' tosses (or calls) left here since this node's last toss: whoever carried
 * them, they are this node's mail in. This toss's own are counted where it wrote them.
 */
let scanned: string | undefined;
async function landedHere(home: Home, since: string | undefined): Promise<void> {
  scanned = new Date().toISOString();
  if (!since) return;
  const after = (block: Block) => (block.createdAt ?? "") > since && (block.createdAt ?? "") <= scanned! && !trashed(block);
  // This toss's own: the `in` lines it added to the ledger.
  const ownIn = new Set([...home.ledger.lines.keys()].filter((key) => key.startsWith("in ") && !home.ledger.before.has(key)).map((key) => key.slice(3)));
  const netmail = (await query(mine, "netmail-from")).filter((block) => after(block) && !ownIn.has(block.id));
  const seen = (await query(mine, "kind=echo-seen-by")).filter(after);
  if (!netmail.length && !seen.length) return;
  log.push("## delivered here by other nodes");
  for (const mark of netmail) {
    // A reply's note is its comment's.
    let on = mark.parentId ? await mine<Block>({ action: "get", blockId: mark.parentId }).catch(() => undefined) : undefined;
    if (on && isMark(on) && on.parentId) on = await mine<Block>({ action: "get", blockId: on.parentId }).catch(() => undefined);
    const from = prop(mark, "netmail-from")?.split("/")[0] ?? "another node";
    log.push(`- netmail from ${from}${prop(mark, "netmail-author") ? ` (${prop(mark, "netmail-author")})` : ""} on ${on ? `((${on.id}|${firstLine(on.text).replace(/[|)]/g, "") || "a note"}))` : "a note gone since"}`);
  }
  home.counts.netmailIn += netmail.length;
  if (seen.length) log.push(`- seen-by: ${seen.length} (${[...new Set(seen.flatMap((mark) => values(mark, "echo.node")))].join(", ")})`);
}

async function toss(): Promise<string> {
  const nodelist = await nodelistBlock();
  const since = await lastTossEnd(nodelist);
  const home = await homeHere();
  const subs = (await query(mine, "subscribe")).filter((block) => kindOf(block) === "subscription" && !trashed(block));
  log.push("## echomail");
  const read = new Map<string, Link>();
  for (const sub of subs) for (const link of await tossSubscription(home, sub)) read.set(link.node.id, link);
  log.push("## netmail");
  await netmailFor(home, read.values());
  await saveLedger(home);
  await landedHere(home, since);
  const subscribers = await subscribersHere();
  if (address.dialsIn) await callIn(subscribers);
  await writeNodelist(nodelist, subscribers, true);
  const summary = `copies ${counts.copies}, waiting ${counts.waiting}, newer ${counts.updated}, gone ${counts.gone}, skipped ${counts.skipped}, seen-by ${counts.seenBy}, ` +
    `netmail out ${counts.netmailOut}, in ${counts.netmailIn}, queued ${counts.queued}, undeliverable ${counts.undeliverable}${counts.held ? `, held ${counts.held}` : ""}`;
  const title = `Toss ${now.slice(0, 16).replace("T", " ")} UTC [type::toss] [node::${self.id}] [at::${now}] [copies::${counts.copies}] [waiting::${counts.waiting}] ` +
    `[updated::${counts.updated}] [gone::${counts.gone}] [skipped::${counts.skipped}] [netmail-out::${counts.netmailOut}] [netmail-in::${counts.netmailIn}] [queued::${counts.queued}] [held::${counts.held}] [undeliverable::${counts.undeliverable}]${scanned ? ` [scanned::${scanned}]` : ""}`;
  await mine({ action: "create", parentId: nodelist.id, text: [title, "", ...(input.scheduled ? ["(scheduled)", ""] : []), ...log].join("\n") });
  await pruneLogs(nodelist);
  return `${self.id} tossed: ${summary}${called.length ? `; called ${called.join("; ")}` : ""}`;
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
  // A node that dials in can't be asked: the copy says what the person wants, and its next call does it.
  if (link.dialsIn) {
    await setOn(block.id, (text) => setHeaderProperty(text, "echo-take", propose ? "compare" : "newer"));
    return { message: `${node.id} dials in and is never called from here (${link.why}): its next call ${propose ? "proposes" : "brings"} the newer version` };
  }
  if (!link.reachable) return { message: `${node.id} is unreachable (${link.why}); try again once it answers` };
  if (link.level === "none") return { message: `${node.id} grants none; its owner runs \`ep0ch mcp access read --ws ${node.outline}\`` };
  return newerFor(mine, block.id, link, from[2]!, propose);
}

/**
 * The original's current text for a copy (in the outline `call` reaches), taken or proposed beside it. A take asked
 * of a copy of a node that dials in (`[echo-take::newer|compare]`) is done by its call, with this.
 */
async function newerFor(call: Link["call"], copyId: string, link: Link, originalId: string, propose: boolean): Promise<{ message: string; open?: string }> {
  const node = link.node;
  const original = await link.call<Block>({ action: "get", blockId: originalId }).catch(() => undefined);
  if (prop(await call<Block>({ action: "get", blockId: copyId }), "echo-take") !== undefined) await setOn(copyId, (text) => setHeaderProperty(text, "echo-take", undefined), call);
  if (!original || trashed(original)) return { message: `The original is gone from ${node.id}: this copy is all there is now` };
  const current = await call<Block>({ action: "get", blockId: copyId });
  const area = prop(current, "echo") ?? "?";
  const tossed = prop(current, "tossed");
  // A copy kept off the web here stays off, whatever the original says.
  const text = await copyText(link, original, area, tossed, prop(current, "publish") === "never");
  if (text === current.text) return { message: `This copy already has ${node.id}'s revision ${original.revision}` };
  if (propose) {
    const result = await call<{ outcome: string; proposalId?: string }>({
      action: "draft.patch", blockId: current.id, revision: current.revision, propose: "always",
      patches: [{ observed: current.text, replacement: text }], mutation: { author: "agent", actorId: "ext:echonet" },
    });
    return { message: `${node.id}'s revision ${original.revision} is proposed beside the copy: apply or dismiss it there`, ...(result.proposalId ? { open: result.proposalId } : {}) };
  }
  await call({ action: "update", blockId: current.id, expectedRevision: current.revision, text });
  return { message: `This copy now has ${node.id}'s revision ${original.revision} (its own edits are in its history)`, open: current.id };
}

try {
  // Which nodes have called (they dial in, and are never called from here): the ledger says, before any node is linked.
  calls = callsIn(readLedger(oldest(await query(mine, "type=echo-ledger"))));
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

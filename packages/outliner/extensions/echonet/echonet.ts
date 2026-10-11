// EchoNet's tosser (the spike on spike/echonet): this outline is a node, `name@machine`, on a FidoNet-style
// store-and-forward network of outlines. One run ("a toss") does what a FidoNet mailer did on its nightly call:
//
//   1. echomail in: for each subscription here (`[type::echo-sub] [subscribe::<node>] [echo::<tag>]`), read the
//      origin's area (`[type::echo-area] [echo::<tag>] [query::…]`), and copy each message it doesn't have yet under
//      the subscription. A copy is a local block: edit it, move it, trash it. A trashed copy stays trashed. A newer
//      upstream revision is a marker on the copy (`[upstream-newer::n]`), never a new text.
//   2. seen-by: each original gets one mark per node it was echoed to ("also in: …"), never a change to its text.
//   3. netmail out: a highlight, comment or reply on a copy is carried to the original as a comment, `via
//      echonet:<this node>`, `[netmail-from::<this node>/<mark id>]`.
//   4. netmail in: a reply written in the origin on such a thread is carried back into the copy's thread.
//   5. the nodelist (`Nodelist [type::nodelist]`) is written again, with a `[type::toss]` log under it.
//
// Offline is normal: a node that can't be reached (its machine or its host doesn't answer, or `offline` in config.json) is said in
// the nodelist, and what this node would send it stays here, counted as queued, until a toss reaches it. The one access
// rule is the origin's own (`ep0ch mcp access`): `none` refuses, `read` lets this node copy, `propose` and `full` also
// let it write marks there (seen-by and netmail). Everything is written over the extension's connection, as
// `ext:echonet`.
import { outline, type OutlineRequest, type Route } from "./outline";

interface Property { key: string; value: string }
interface Block {
  id: string; parentId: string | null; text: string; revision: number; properties: Property[];
  author?: string; actorId?: string; deletedAt?: string; effectiveDeletedRootId?: string;
}
interface Target { passage?: { quote?: string }; anchor?: { kind: string; exact?: string } }
interface Mark {
  block: Block; body: string; source: "user" | "agent"; properties?: Record<string, string[]>;
  originalTarget?: Target; resolvedTarget?: Target | null;
}
interface Thread extends Mark { replies: Mark[] }
type Level = "none" | "read" | "propose" | "full";

interface Request {
  operation: "act";
  input: { action: "toss" | "nodelist"; context: { now: string }; scheduled?: { at: string } };
  config: { offline?: string[]; keepLogs?: number };
}

const answer = (value: unknown) => process.stdout.write(JSON.stringify({ ok: true, value }));
const { input, config } = (await Bun.stdin.json()) as Request;
const now = input.context.now;

// ── nodes ──

interface Node { readonly outline: string; readonly machine: string; readonly id: string }
const nodeOf = (outlineName: string, machine: string): Node => ({ outline: outlineName, machine, id: `${outlineName}@${machine}` });
function parseNode(text: string | undefined): Node | undefined {
  const match = text?.trim().match(/^([a-z0-9][a-z0-9-]*)@([A-Za-z0-9][\w.-]*)$/);
  return match ? nodeOf(match[1]!, match[2]!) : undefined;
}

const address = await outline<{ outline?: string; machine: string }>({ action: "notes.address" });
const self = nodeOf(process.env.EP0CH_WS ?? address.outline ?? "unknown", address.machine);
const sameMachine = (a: string, b: string) => a.toLowerCase().split(".")[0] === b.toLowerCase().split(".")[0];

/** How this node reaches another, and what that node lets it do. Learned once per toss. */
interface Link {
  readonly node: Node;
  readonly reachable: boolean;
  /** Why not, when it isn't (offline, no forward, an error). */
  readonly why?: string;
  readonly level: Level;
  call<T>(request: OutlineRequest): Promise<T>;
}

const links = new Map<string, Link>();
async function linkTo(node: Node): Promise<Link> {
  const known = links.get(node.id);
  if (known) return known;
  let link: Link;
  const unreachable = (why: string): Link => ({ node, reachable: false, why, level: "none", call: () => Promise.reject(new Error(`${node.id} is unreachable: ${why}`)) });
  if ((config.offline ?? []).includes(node.id)) link = unreachable("offline (config.json's offline list)");
  else {
    // Another machine: the host sends the request through the shared ssh forward, starting it when nobody has (the
    // first contact waits for ssh); a machine or host that doesn't answer is offline for this toss.
    const remote = !sameMachine(node.machine, self.machine);
    const route: Route = { outline: node.outline, ...(remote ? { machine: node.machine, timeoutMs: 60_000 } : {}) };
    const call = <T>(request: OutlineRequest) => outline<T>(request, route);
    try {
      const status = await call<{ level: Level }>({ action: "mcp.access.status" });
      link = { node, reachable: true, level: status.level, call };
    } catch (error) {
      link = unreachable(error instanceof Error ? error.message.split("\n")[0]! : String(error));
    }
  }
  links.set(node.id, link);
  return link;
}

const mine = <T>(request: OutlineRequest) => outline<T>(request);
const canMark = (level: Level) => level === "propose" || level === "full";

// ── blocks ──

const prop = (block: Block, key: string) => block.properties.find((p) => p.key === key)?.value;
/** A copy's `from` is the one in EchoNet's shape (`<node>/<id>`), whatever other `from` the text holds. */
const fromOf = (block: Block) => block.properties.find((p) => p.key === "from" && FROM.test(p.value))?.value;
const LIMIT = 1000;
const query = (call: Link["call"], where: string, extra: Record<string, unknown> = {}) =>
  call<{ blocks: Block[] }>({ action: "blocks.query", query: { where, limit: LIMIT, ...extra } }).then((r) => r.blocks);
const SYSTEM_TYPES = new Set(["echo-area", "echo-sub", "nodelist", "toss", "echo-ledger"]);
const FROM = /^([a-z0-9][a-z0-9-]*@[\w.-]+)\/([0-9a-f-]{36})$/;
const isCopy = (block: Block) => fromOf(block) !== undefined;
const firstLine = (text: string) => text.split("\n", 1)[0]!.replace(/\s*\[[A-Za-z][\w.-]*::[^\]]*\]/g, "").trim();
const quoteOf = (mark: Mark) => {
  const target = mark.resolvedTarget ?? mark.originalTarget;
  return target?.passage?.quote ?? (target?.anchor?.kind === "text-quote" ? target.anchor.exact : undefined);
};
const authorOf = (mark: Mark) => (mark.source === "agent" ? `agent:${mark.block.actorId ?? "unknown"}` : "user");
const threadsOn = (call: Link["call"], blockId: string) =>
  call<Thread[]>({ action: "annotations.list", query: { subject: { kind: "block", blockId }, includeResolved: true } });
const netmailFrom = (mark: Mark) => mark.properties?.["netmail-from"]?.[0];

/** Header properties a copy can't keep as they are: an address or an id the original owns in its own outline. */
const OWNED = /\[(page|work-id|welcome|publish)::([^\]]*)\]/g;
/** The keys EchoNet writes on a copy: an original that already has one keeps it as `source-<key>`. */
const TRANSPORT = /\[(from|echo|from-rev|tossed|upstream-newer)::([^\]]*)\]/g;
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

const withHeader = (text: string, add: string) => {
  const [head, ...rest] = text.split("\n");
  return [`${head!.trimEnd()} ${add}`, ...rest].join("\n");
};
function setHeaderProperty(text: string, key: string, value: string): string {
  const [head, ...rest] = text.split("\n");
  const token = `[${key}::${value}]`;
  const pattern = new RegExp(`\\[${key}::[^\\]]*\\]`);
  const next = pattern.test(head!) ? head!.replace(pattern, token) : `${head!.trimEnd()} ${token}`;
  return [next, ...rest].join("\n");
}

// ── the ledger: what was carried, both ways ──

interface Ledger { block?: Block; lines: Map<string, string> }
/** `<local mark id> -> <node>/<mark id>` per carried mark: netmail is never carried twice, and the queue is countable offline. */
function readLedger(block: Block | undefined): Ledger {
  const lines = new Map<string, string>();
  for (const line of block?.text.split("\n").slice(1) ?? []) {
    const match = line.match(/^- (out|in) (\S+) -> (\S+)$/);
    if (match) lines.set(`${match[1]} ${match[2]}`, match[3]!);
  }
  return { block, lines };
}

// ── the toss ──

interface Counts { copies: number; updated: number; skipped: number; seenBy: number; netmailOut: number; netmailIn: number; queued: number }
const counts: Counts = { copies: 0, updated: 0, skipped: 0, seenBy: 0, netmailOut: 0, netmailIn: 0, queued: 0 };
const log: string[] = [];

async function nodelistBlock(): Promise<Block> {
  const found = (await query(mine, "type=nodelist")).find((block) => !block.effectiveDeletedRootId);
  if (found) return found;
  return mine<Block>({ action: "create", text: `Nodelist [type::nodelist] [node::${self.id}]\n\nWritten by EchoNet's tosser; the next toss writes it again.` });
}

async function ledgerBlock(nodelist: Block): Promise<Block> {
  const found = (await query(mine, "type=echo-ledger")).find((block) => !block.effectiveDeletedRootId);
  if (found) return found;
  return mine<Block>({ action: "create", parentId: nodelist.id, text: "EchoNet ledger [type::echo-ledger]" });
}

/** One subscription: echomail in, seen-by out. Answers the live copies under it, for netmail. */
async function tossSubscription(sub: Block, everyCopy: Map<string, Block>): Promise<{ origin?: Link; copies: Block[] }> {
  const origin = parseNode(prop(sub, "subscribe"));
  const tag = prop(sub, "echo");
  const name = firstLine(sub.text);
  if (!origin || !tag) {
    log.push(`- ${name}: needs [subscribe::<outline>@<machine>] and [echo::<tag>]`);
    return { copies: [] };
  }
  const link = await linkTo(origin);
  const copies = () => [...everyCopy.values()].filter((copy) => fromOf(copy)!.startsWith(`${origin.id}/`) && prop(copy, "echo") === tag && !copy.effectiveDeletedRootId);
  if (!link.reachable) {
    log.push(`- ${tag} from ${origin.id}: unreachable (${link.why}); ${copies().length} copies kept as they are`);
    return { origin: link, copies: copies() };
  }
  if (link.level === "none") {
    log.push(`- ${tag} from ${origin.id}: refused (${origin.id} grants none; its owner runs \`ep0ch mcp access read --ws ${origin.outline}\`)`);
    return { origin: link, copies: copies() };
  }
  const area = (await query(link.call, `type=echo-area AND echo=${tag}`)).find((block) => prop(block, "query"));
  if (!area) {
    log.push(`- ${tag} from ${origin.id}: no area there ([type::echo-area] [echo::${tag}] [query::…])`);
    return { origin: link, copies: copies() };
  }
  const messages = (await query(link.call, prop(area, "query")!))
    .filter((block) => block.id !== area.id && !SYSTEM_TYPES.has(prop(block, "type") ?? "") && !isCopy(block));
  let made = 0, newer = 0, skipped = 0;
  for (const message of messages) {
    const from = `${origin.id}/${message.id}`;
    const copy = everyCopy.get(from);
    if (copy?.effectiveDeletedRootId || copy?.deletedAt) {
      skipped += 1;
      continue;
    }
    if (!copy) {
      const text = withHeader(await localText(link, message.text), `[from::${from}] [echo::${tag}] [from-rev::${message.revision}] [tossed::${now}]`);
      const made_ = await mine<Block>({ action: "create", parentId: sub.id, text });
      await copyChildren(link, tag, message.id, made_.id, everyCopy, 0);
      everyCopy.set(from, made_);
      made += 1;
      if (canMark(link.level)) await seenBy(link, message, made_, name);
      continue;
    }
    const seen = Number(prop(copy, "from-rev") ?? 0);
    if (message.revision > seen && prop(copy, "upstream-newer") !== String(message.revision)) {
      const current = await mine<Block>({ action: "get", blockId: copy.id });
      await mine({ action: "update", blockId: copy.id, expectedRevision: current.revision, text: setHeaderProperty(current.text, "upstream-newer", String(message.revision)) });
      newer += 1;
    }
    if (canMark(link.level)) await seenBy(link, message, copy, name);
  }
  counts.copies += made; counts.updated += newer; counts.skipped += skipped;
  log.push(`- ${tag} from ${origin.id} (${link.level}): ${messages.length} in the area; ${made} copied, ${newer} marked newer, ${skipped} trashed here and left so`);
  return { origin: link, copies: copies() };
}

/**
 * The notes under a message, each a copy with its own `from` (so it is never echoed again as an original here, and a
 * mark on it is netmail too). Copied once, with the message; later notes under the original are upstream's.
 */
async function copyChildren(origin: Link, tag: string, fromId: string, toId: string, everyCopy: Map<string, Block>, depth: number): Promise<void> {
  if (depth > 4) return;
  const children = await origin.call<Block[]>({ action: "children", parentId: fromId });
  for (const child of children) {
    const from = `${origin.node.id}/${child.id}`;
    if (everyCopy.has(from)) continue;
    const made = await mine<Block>({ action: "create", parentId: toId, text: withHeader(await localText(origin, child.text), `[from::${from}] [echo::${tag}] [from-rev::${child.revision}]`) });
    everyCopy.set(from, made);
    await copyChildren(origin, tag, child.id, made.id, everyCopy, depth + 1);
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
  const from = fromOf(copy)!.match(FROM)!;
  const originalId = from[2]!;
  const local = (await threadsOn(mine, copy.id)).filter((thread) => !thread.properties?.kind?.includes("echo-seen-by"));
  const outgoing = (thread: Thread) => [thread, ...thread.replies.filter((reply) => !netmailFrom(reply))];
  if (!origin.reachable || !canMark(origin.level)) {
    for (const thread of local) counts.queued += outgoing(thread).filter((mark) => !ledger.lines.has(`out ${mark.block.id}`)).length;
    return;
  }
  if (!local.length) return;
  let original = await origin.call<Block>({ action: "get", blockId: originalId }).catch(() => undefined);
  if (!original || original.effectiveDeletedRootId) {
    for (const thread of local) counts.queued += outgoing(thread).filter((mark) => !ledger.lines.has(`out ${mark.block.id}`)).length;
    log.push(`- netmail for ${firstLine(copy.text)} held: the original is gone from ${origin.node.id}`);
    return;
  }
  const remote = await threadsOn(origin.call, originalId);
  for (const thread of local) {
    const key = `${self.id}/${thread.block.id}`;
    let there = remote.find((candidate) => netmailFrom(candidate) === key);
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
      counts.netmailOut += 1;
    } else if (!ledger.lines.has(`out ${thread.block.id}`)) ledger.lines.set(`out ${thread.block.id}`, `${origin.node.id}/${there.block.id}`);
    // Replies written here go out; replies written there come in. A reply that came in carries netmail-from, so it
    // never goes back out (no echo loops), and one that went out carries it there, so it never comes back.
    for (const reply of thread.replies.filter((candidate) => !netmailFrom(candidate))) {
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

// ── the nodelist ──

interface NodeFacts { link: Link; areas: string[]; subscriptions: string[]; lastToss?: string; role: string[] }

async function factsOf(link: Link, role: string[]): Promise<NodeFacts> {
  const facts: NodeFacts = { link, areas: [], subscriptions: [], role };
  if (!link.reachable || link.level === "none") return facts;
  const call = link.node.id === self.id ? mine : link.call;
  facts.areas = (await query(call, "type=echo-area")).map((area) => `${prop(area, "echo")} (${firstLine(area.text)})`);
  facts.subscriptions = (await query(call, "type=echo-sub")).map((sub) => `${prop(sub, "echo")} from ${prop(sub, "subscribe")}`);
  const list = (await query(call, "type=nodelist"))[0];
  facts.lastToss = list ? prop(list, "last-toss") : undefined;
  return facts;
}

function nodelistText(facts: NodeFacts[], lastToss: string | undefined): string {
  const lines = [`Nodelist [type::nodelist] [node::${self.id}]${lastToss ? ` [last-toss::${lastToss}]` : ""}`, "",
    "The nodes this outline knows, written again by EchoNet's tosser at every toss (`ep0ch echo toss`). Edit the areas and subscriptions, not this.", ""];
  for (const f of facts) {
    const { link } = f;
    const state = link.node.id === self.id ? "this node" : link.reachable ? "reachable" : `unreachable: ${link.why}`;
    lines.push(`## ${link.node.id}`);
    lines.push(`- ${state} · access ${link.reachable ? link.level : "unknown"}${f.role.length ? ` · ${f.role.join(", ")}` : ""}`);
    lines.push(`- last toss: ${f.lastToss ?? (link.reachable ? "never" : "unknown")}`);
    lines.push(`- areas: ${f.areas.length ? f.areas.join("; ") : link.reachable && link.level !== "none" ? "none" : "unknown"}`);
    lines.push(`- subscriptions: ${f.subscriptions.length ? f.subscriptions.join("; ") : link.reachable && link.level !== "none" ? "none" : "unknown"}`);
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** `tossed`: this run is a toss, so this node's last toss is now; a nodelist-only run keeps the one it had. */
async function writeNodelist(nodelist: Block, subscribers: Set<string>, tossed: boolean): Promise<void> {
  const selfStatus = await mine<{ level: Level }>({ action: "mcp.access.status" });
  links.set(self.id, { node: self, reachable: true, level: selfStatus.level, call: mine });
  const roles = new Map<string, string[]>();
  const add = (id: string, role: string) => roles.set(id, [...(roles.get(id) ?? []), role]);
  for (const sub of await query(mine, "type=echo-sub")) {
    const node = parseNode(prop(sub, "subscribe"));
    if (node) add(node.id, `we read its ${prop(sub, "echo")}`);
  }
  for (const id of subscribers) add(id, "reads our areas");
  const own = await factsOf(links.get(self.id)!, []);
  if (tossed) own.lastToss = now;
  const facts = [own];
  for (const [id, role] of roles) {
    const node = parseNode(id);
    if (node && node.id !== self.id) facts.push(await factsOf(await linkTo(node), role));
  }
  const text = nodelistText(facts, own.lastToss);
  const current = await mine<Block>({ action: "get", blockId: nodelist.id });
  // Unchanged, not written: a toss that learned nothing adds nothing to the change feed.
  if (current.text !== text) await mine({ action: "update", blockId: nodelist.id, expectedRevision: current.revision, text });
}

/** The nodes that read this one's areas: the seen-by marks they left on its messages. */
async function subscribersHere(): Promise<Set<string>> {
  const found = new Set<string>();
  for (const area of await query(mine, "type=echo-area")) {
    const where = prop(area, "query");
    if (!where) continue;
    for (const message of (await query(mine, where)).filter((block) => !isCopy(block) && !SYSTEM_TYPES.has(prop(block, "type") ?? ""))) {
      for (const thread of await threadsOn(mine, message.id)) {
        if (thread.properties?.kind?.includes("echo-seen-by")) for (const node of thread.properties["echo.node"] ?? []) found.add(node);
      }
    }
  }
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
  if (everyCopy.size >= LIMIT) log.push(`- ${LIMIT} or more copies here: a toss reads ${LIMIT} at a time and may copy again what it didn't see (spike limit)`);
  const subs = (await query(mine, "type=echo-sub")).filter((sub) => !sub.effectiveDeletedRootId);
  log.push("## echomail");
  const held: Array<{ origin: Link; copies: Block[] }> = [];
  for (const sub of subs) {
    const result = await tossSubscription(sub, everyCopy);
    if (result.origin) held.push({ origin: result.origin, copies: result.copies });
  }
  log.push("## netmail");
  for (const { origin, copies } of held) {
    const before = { out: counts.netmailOut, in: counts.netmailIn, queued: counts.queued };
    for (const copy of copies) await netmail(origin, copy, ledger);
    const queued = counts.queued - before.queued;
    const why = !origin.reachable ? `unreachable (${origin.why})` : !canMark(origin.level) ? `${origin.node.id} grants ${origin.level}; netmail needs propose` : "";
    log.push(`- ${origin.node.id}: ${counts.netmailOut - before.out} out, ${counts.netmailIn - before.in} in${queued ? `, ${queued} queued: ${why}` : ""}`);
  }
  // The ledger, when it learned something.
  if ([...ledger.lines].some(([key, value]) => before.get(key) !== value)) {
    const current = await mine<Block>({ action: "get", blockId: ledgerHome.id });
    const text = ["EchoNet ledger [type::echo-ledger]", ...[...ledger.lines].map(([key, value]) => `- ${key} -> ${value}`)].join("\n");
    await mine({ action: "update", blockId: ledgerHome.id, expectedRevision: current.revision, text });
  }
  await writeNodelist(nodelist, await subscribersHere(), true);
  const summary = `copies ${counts.copies}, newer ${counts.updated}, skipped ${counts.skipped}, seen-by ${counts.seenBy}, netmail out ${counts.netmailOut}, in ${counts.netmailIn}, queued ${counts.queued}`;
  const title = `Toss ${now.slice(0, 16).replace("T", " ")} UTC [type::toss] [node::${self.id}] [at::${now}] [copies::${counts.copies}] [updated::${counts.updated}] [skipped::${counts.skipped}] [netmail-out::${counts.netmailOut}] [netmail-in::${counts.netmailIn}] [queued::${counts.queued}]`;
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

try {
  if (input.action === "nodelist") {
    const nodelist = await nodelistBlock();
    await writeNodelist(nodelist, await subscribersHere(), false);
    answer({ message: `${self.id}: nodelist written`, open: nodelist.id });
  } else {
    answer({ message: await toss() });
  }
} catch (error) {
  // A failure, not an answer: the service reports it and `ep0ch echo toss` exits non-zero. A failure carries only a
  // code, so why it stopped goes in a toss log first. What it wrote stays, and the next toss carries on from there
  // (every step looks before it writes).
  const why = error instanceof Error ? error.message : String(error);
  await nodelistBlock().then((nodelist) => mine({ action: "create", parentId: nodelist.id,
    text: [`Toss ${now.slice(0, 16).replace("T", " ")} UTC stopped [type::toss] [node::${self.id}] [at::${now}] [failed::yes]`, "", `It stopped: ${why}`, "", ...log].join("\n") })).catch(() => undefined);
  process.stdout.write(JSON.stringify({ ok: false, code: "toss-failed" }));
}

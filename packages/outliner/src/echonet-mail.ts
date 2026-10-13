// EchoNet's mail, as a host carries it (ADR 0005: agents act, nodes mail, readers read). A node never writes another
// outline's blocks: it reads the other node's bulletin (what its areas publish) and hands it a packet (netmail and
// seen-by marks for its originals, or, from a node that dials in, its own bulletin). The receiving outline's own
// tosser imports the packet, writing as itself where its own notes ask. These files are the whole exchange; nothing
// here reads the MCP access level, and nothing here writes a block.
//
//   <outlines>/<name>/echonet/bulletin.json         what <name>'s areas publish, written by its tosser each toss
//   <outlines>/<name>/echonet/inbound/<file>.json    packets handed to <name>, waiting for its tosser
//   <outlines>/<name>/echonet/outbound/<node>/…      packets <name> holds for a node that dials in, until it calls
//
// The tosser reads and writes its own outline's folder itself; another node reaches it through these actions on the
// host (on another machine through the relay): `echonet.bulletin`, `echonet.put`, `echonet.take`, and `echonet.list`,
// which outlines here publish a bulletin.
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The mail actions an outline answers, for any client or extension, local or relayed: they write no block. */
export const ECHONET_MAIL_ACTIONS: ReadonlySet<string> = new Set(["echonet.bulletin", "echonet.put", "echonet.take"]);
const NODE = /^[a-z0-9][a-z0-9-]*@[A-Za-z0-9][\w.-]*$/;
/** A packet's size, at most: a bulletin of a few thousand notes fits well under it. */
const MAX_PACKET = 24 * 1024 * 1024;
/** What one take answers, at most (the relay carries an answer of up to 64 MB). */
const MAX_TAKE = 24 * 1024 * 1024;

/** An outline's EchoNet folder (`<outlines>/<name>/echonet`). */
export const mailFolder = (outlineFolder: string) => join(outlineFolder, "echonet");

/** The outline's bulletin as its tosser last wrote it, or null when it publishes none (no EchoNet, or never tossed). */
export function readBulletin(outlineFolder: string): unknown {
  try {
    return JSON.parse(readFileSync(join(mailFolder(outlineFolder), "bulletin.json"), "utf8"));
  } catch {
    return null;
  }
}

/** Whether an outline publishes a bulletin: the outlines a `*` mask on another machine may read. */
export const publishes = (outlineFolder: string) => existsSync(join(mailFolder(outlineFolder), "bulletin.json"));

/** A packet handed to the outline: kept in its inbound for its tosser. Answers the file's name. */
export function putPacket(outlineFolder: string, from: unknown, packet: unknown): { file: string } {
  if (typeof from !== "string" || !NODE.test(from)) throw new Error(`echonet.put needs from: the sending node (<outline>@<machine>); got ${JSON.stringify(from)}`);
  if (!packet || typeof packet !== "object" || Array.isArray(packet)) throw new Error("echonet.put needs packet: { from, at, items, bulletin? }");
  const text = JSON.stringify(packet);
  if (text.length > MAX_PACKET) throw new Error(`a packet is at most ${MAX_PACKET} bytes; this one is ${text.length}`);
  const inbound = join(mailFolder(outlineFolder), "inbound");
  mkdirSync(inbound, { recursive: true });
  const file = `${new Date().toISOString().replace(/[:.]/g, "-")}-${from}-${crypto.randomUUID().slice(0, 8)}.json`;
  // Written whole, then renamed: the tosser never reads half a packet.
  writeFileSync(join(inbound, `.${file}.tmp`), text);
  renameSync(join(inbound, `.${file}.tmp`), join(inbound, file));
  return { file };
}

/**
 * The packets the outline holds for `forNode` (a node that dials in, calling): `{ packets: [{ file, packet }] }`. Taken
 * in two steps, so none is lost on the way: the caller keeps them, then asks again with `ack` (the files it kept),
 * and only those are removed.
 */
export function takePackets(outlineFolder: string, forNode: unknown, ack: unknown): { packets: Array<{ file: string; packet: unknown }>; more?: boolean; removed?: number } {
  if (typeof forNode !== "string" || !NODE.test(forNode)) throw new Error(`echonet.take needs for: the calling node (<outline>@<machine>); got ${JSON.stringify(forNode)}`);
  const held = join(mailFolder(outlineFolder), "outbound", forNode);
  if (ack !== undefined) {
    if (!Array.isArray(ack) || ack.some((file) => typeof file !== "string" || !/^[\w.@-]+\.json$/.test(file))) throw new Error("ack is the list of files taken");
    for (const file of ack as string[]) rmSync(join(held, file), { force: true });
    return { packets: [], removed: (ack as string[]).length };
  }
  let files: string[] = [];
  try { files = readdirSync(held).filter((file) => file.endsWith(".json") && !file.startsWith(".")).sort(); } catch { /* none held */ }
  // Oldest first, as many as fit one answer (well under the relay's limit); `more` when the rest wait for the next take.
  const packets: Array<{ file: string; packet: unknown }> = [];
  let size = 0;
  for (const file of files) {
    let text: string;
    try { text = readFileSync(join(held, file), "utf8"); } catch { continue; }
    if (packets.length && size + text.length > MAX_TAKE) return { packets, more: true };
    try { packets.push({ file, packet: JSON.parse(text) }); size += text.length; } catch { /* being written */ }
  }
  return { packets };
}

// Zip archives for the artifacts inbox (PIE-1267), under the rules the tar path already has (artifact-store.ts's
// `untar`): regular files only, every name a safe relative path, caps on the entry count and the unpacked size. A zip
// is read from its central directory and every claim it makes is checked against what is actually there, so a header
// that lies (a size smaller than the data, a name outside the folder) is refused before any byte reaches the store.
import { inflateRawSync } from "node:zlib";

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const UNIX = 3;
const MODE_TYPE = 0xf000, MODE_FILE = 0x8000, MODE_DIR = 0x4000, MODE_LINK = 0xa000;

export interface ArchiveLimits {
  entries: number;
  bytes: number;
  /** Checks one entry's name; throws why it's unsafe. */
  path: (name: string) => string;
}

/** True when `data` starts like a zip (a file, or an empty archive). */
export const looksZip = (data: Uint8Array) => data.length >= 4 && data[0] === 0x50 && data[1] === 0x4b && (data[2] === 3 || data[2] === 5) && (data[3] === 4 || data[3] === 6);

/** True when `data` carries the ustar magic of a tar header. */
export const looksTar = (data: Uint8Array) => data.length >= 512 && Buffer.from(data.subarray(257, 262)).toString("latin1") === "ustar";

/** Whether this zip entry is the desktop's own clutter, which no one meant to ship. */
const clutter = (name: string) => name.startsWith("__MACOSX/") || name.split("/").some(part => part === ".DS_Store" || part.startsWith("._"));

/** The files of a zip, by path; throws a reason a person can act on when the archive breaks a rule. */
export function unzip(input: Uint8Array, limits: ArchiveLimits): Record<string, Buffer> {
  const data = Buffer.from(input.buffer, input.byteOffset, input.length);
  let end = -1;
  for (let at = data.length - 22; at >= Math.max(0, data.length - 22 - 0xffff); at--) {
    if (data.readUInt32LE(at) === EOCD) { end = at; break; }
  }
  if (end < 0) throw new Error("Not a readable zip: its end-of-archive record is missing.");
  const count = data.readUInt16LE(end + 10), size = data.readUInt32LE(end + 12), offset = data.readUInt32LE(end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) throw new Error("Zip64 archives aren't accepted: send a smaller zip, or a tar.");
  if (count > limits.entries) throw new Error(`Archive has ${count} entries; cap is ${limits.entries}.`);
  if (offset + size > end) throw new Error("Not a readable zip: its directory runs past the end of the file.");

  type Entry = { name: string; method: number; compressed: number; size: number; crc: number; local: number };
  const entries: Entry[] = [];
  let declared = 0, at = offset;
  for (let i = 0; i < count; i++) {
    if (at + 46 > end || data.readUInt32LE(at) !== CENTRAL) throw new Error("Not a readable zip: a directory entry is damaged.");
    const flags = data.readUInt16LE(at + 8), method = data.readUInt16LE(at + 10), crc = data.readUInt32LE(at + 16);
    const compressed = data.readUInt32LE(at + 20), unpacked = data.readUInt32LE(at + 24);
    const nameLength = data.readUInt16LE(at + 28), extraLength = data.readUInt16LE(at + 30), commentLength = data.readUInt16LE(at + 32);
    const made = data.readUInt16LE(at + 4), external = data.readUInt32LE(at + 38), local = data.readUInt32LE(at + 42);
    if (at + 46 + nameLength > end) throw new Error("Not a readable zip: a name runs past the directory.");
    const raw = data.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    at += 46 + nameLength + extraLength + commentLength;
    if (flags & 1) throw new Error(`Encrypted zips aren't accepted (${raw}).`);
    if (compressed === 0xffffffff || unpacked === 0xffffffff || local === 0xffffffff) throw new Error("Zip64 archives aren't accepted: send a smaller zip, or a tar.");
    if (made >> 8 === UNIX) {
      const type = (external >>> 16) & MODE_TYPE;
      if (type === MODE_LINK) throw new Error(`Archives can't contain links: ${raw}`);
      if (type !== 0 && type !== MODE_FILE && type !== MODE_DIR) throw new Error(`Archives can only hold regular files and folders: ${raw}`);
    }
    if (raw.endsWith("/")) continue;
    if (clutter(raw)) continue;
    declared += unpacked;
    if (declared > limits.bytes) throw new Error(`Archive unpacks past ${limits.bytes} bytes.`);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported compression (method ${method}) in ${raw}; re-zip it with deflate.`);
    entries.push({ name: limits.path(raw.replace(/^\.\//, "")), method, compressed, size: unpacked, crc, local });
  }

  // No prototype: an entry named `__proto__` is a file like any other, not a way to hide one.
  const files: Record<string, Buffer> = Object.create(null);
  for (const entry of entries) {
    if (Object.hasOwn(files, entry.name)) throw new Error(`The archive lists ${entry.name} twice.`);
    if (entry.local + 30 > end || data.readUInt32LE(entry.local) !== LOCAL) throw new Error(`Not a readable zip: ${entry.name} has no data.`);
    const start = entry.local + 30 + data.readUInt16LE(entry.local + 26) + data.readUInt16LE(entry.local + 28);
    if (start + entry.compressed > offset) throw new Error(`Not a readable zip: ${entry.name} runs past its data.`);
    const packed = data.subarray(start, start + entry.compressed);
    let content: Buffer;
    if (entry.method === 0) content = Buffer.from(packed);
    else {
      try { content = inflateRawSync(packed, { maxOutputLength: Math.max(1, entry.size) }); }
      catch { throw new Error(`${entry.name} unpacks to more than the ${entry.size} bytes its header claims, or is damaged.`); }
    }
    if (content.length !== entry.size) throw new Error(`${entry.name} is ${content.length} bytes, not the ${entry.size} its header claims.`);
    if (Bun.hash.crc32(content) !== entry.crc) throw new Error(`${entry.name} doesn't match its checksum: the zip is damaged.`);
    files[entry.name] = content;
  }
  return stripRoot(files);
}

/** A zip of one folder (what the desktop's "Compress" makes) installs that folder's contents, so `index.html` is at the root. */
export function stripRoot(files: Record<string, Buffer>): Record<string, Buffer> {
  const paths = Object.keys(files);
  if (!paths.length) return files;
  const first = paths[0]!.split("/")[0]!;
  if (!paths.every(path => path.includes("/") && path.split("/")[0] === first)) return files;
  return Object.fromEntries(paths.map(path => [path.slice(first.length + 1), files[path]!]));
}

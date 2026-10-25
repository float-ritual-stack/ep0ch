// Made-up zips and tars for the artifact handover tests: a writer that can also produce what a careful tool would
// not (a name that climbs out, a symlink, a header that lies about its size).
import { deflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data?: string | Uint8Array;
  /** Stored with this unix mode in the external attributes (0o120777 is a symlink). */
  mode?: number;
  method?: 0 | 8;
  /** What the central directory claims the unpacked size is, when it should differ from the truth. */
  claims?: number;
}

export function zip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), data = Buffer.from(entry.data ?? "");
    const method = entry.method ?? 8, packed = method === 8 ? deflateRawSync(data) : data;
    const crc = Bun.hash.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
    const head = Buffer.concat([local, name, packed]);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE((3 << 8) | 20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(method, 10);
    dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20); dir.writeUInt32LE(entry.claims ?? data.length, 24); dir.writeUInt16LE(name.length, 28);
    dir.writeUInt32LE(((entry.mode ?? (entry.name.endsWith("/") ? 0o040755 : 0o100644)) << 16) >>> 0, 38); dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, name]));
    parts.push(head); offset += head.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

export interface TarEntry { name: string; data?: string; type?: "0" | "2" | "5"; link?: string }

/** A POSIX ustar archive of the entries (type 2 is a symlink to `link`). */
export function tar(entries: TarEntry[]): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const data = Buffer.from(entry.data ?? ""), header = Buffer.alloc(512);
    header.write(entry.name, 0, 100); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116);
    header.write(`${data.length.toString(8).padStart(11, "0")}\0`, 124); header.write("00000000000\0", 136);
    header.write("        ", 148); header.write(entry.type ?? "0", 156); if (entry.link) header.write(entry.link, 157, 100);
    header.write("ustar\0", 257); header.write("00", 263);
    const sum = header.reduce((n, b) => n + b, 0);
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    blocks.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

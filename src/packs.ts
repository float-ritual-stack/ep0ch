// Art packs: the original WOE zips, read in place. Nothing is extracted to disk.
import { readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { parseAnsi, type Art } from "./ansi";

export const PACK_DIR = process.env.EP0CH_PACKS ?? "/opt/float/bbs/inbox/evan";
const MAX_MEMBER = 512_000;

export interface Member { pack: string; path: string; size: number }

function unzip(args: string[]): Uint8Array {
  const r = Bun.spawnSync(["unzip", ...args], { stdout: "pipe", stderr: "pipe" });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString().trim() || `unzip ${args.join(" ")} failed`);
  return r.stdout;
}

export function packs(dir = PACK_DIR): string[] {
  try {
    return readdirSync(dir).filter(f => /^r?a?woe.*\.zip$/i.test(f)).sort().map(f => join(dir, f));
  } catch { return []; }
}

export function members(pack: string): Member[] {
  const listing = new TextDecoder().decode(unzip(["-l", pack])).split("\n");
  const out: Member[] = [];
  for (const line of listing) {
    const m = line.match(/^\s*(\d+)\s+\S+\s+\S+\s+(.+)$/);
    if (!m || !/\.(ans|asc|diz|nfo|txt|mem)$/i.test(m[2]!)) continue;
    out.push({ pack, path: m[2]!.trim(), size: Number(m[1]) });
  }
  return out;
}

export function loadArt(member: Member, opts: { ice?: boolean } = {}): Art {
  if (member.size > MAX_MEMBER) throw new Error(`${member.path} is larger than ${MAX_MEMBER} bytes`);
  return parseAnsi(`${basename(member.pack)}:${member.path}`, unzip(["-p", member.pack, member.path]), opts);
}

/** Find one member by file name across every pack, newest pack first. */
export function find(file: string, dir = PACK_DIR): Member | null {
  for (const pack of packs(dir).reverse()) {
    const hit = members(pack).find(m => basename(m.path).toLowerCase() === file.toLowerCase());
    if (hit) return hit;
  }
  return null;
}

const named = new Map<string, Art | null>();
/** A piece by file name from the packs, read once and kept (null when no pack has it: another machine, a test). */
export function artNamed(file: string): Art | null {
  if (!named.has(file)) {
    try { const m = find(file); named.set(file, m ? loadArt(m) : null); } catch { named.set(file, null); }
  }
  return named.get(file)!;
}

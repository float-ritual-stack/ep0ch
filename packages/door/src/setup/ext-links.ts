// The door's userland extensions (packages/door/ext/<name>/), as `ep0ch install` sees them: each folder that has an
// `ext.json` may ask for its files to be linked where another program finds them (television's cable files, a helper
// on PATH). Install makes those links and says each one; it never replaces a file or link it didn't make, and it
// takes away only its own links whose file is gone (an extension deleted, a file renamed). Deleting an ext folder
// leaves the door as it was: nothing in the door imports one.
//
// ext.json:
//   { "about": "…", "requires": ["tv"], "links": [{ "from": "cable", "into": ["$TELEVISION_CONFIG/cable", "~/.config/television/cable"] },
//                                                 { "from": "bin", "into": ["@bin"] }] }
// `from` is a folder in the extension; each file in it is linked by its name into the first `into` that applies: one
// starting `$NAME` applies when NAME is set, `~/` is the home folder, `@bin` the folder `ep0ch` is linked in.
import { existsSync, lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type Env = Record<string, string | undefined>;

export interface ExtManifest { about?: string; requires?: string[]; links: { from: string; into: string[] }[] }

/** One link an extension asks for, and what's there now: nothing, this link, or something else (left alone). */
export interface ExtLink { src: string; dest: string; state: "missing" | "ours" | "taken" }

export interface ExtFacts {
  name: string;
  dir: string;
  about?: string;
  links: ExtLink[];
  /** Why none of its links are made (a program it needs isn't on PATH, an `into` that doesn't apply, a bad ext.json). */
  problem?: string;
}

/** Links this checkout's install made whose file is gone: in a folder some extension links into, pointing into ext/. */
export interface StaleLink { dest: string; target: string }

/** `into` as a folder: the first candidate that applies, or why none does. */
export function intoDir(into: readonly string[], env: Env, home: string, bin: string | null): string | { problem: string } {
  for (const c of into) {
    if (c === "@bin") { if (bin) return bin; continue; }
    const v = /^\$([A-Z_][A-Z0-9_]*)(\/.*)?$/.exec(c);
    if (v) { const val = env[v[1]!]?.trim(); if (val) return join(val, v[2] ?? ""); continue; }
    if (c.startsWith("~/")) return join(home, c.slice(2));
    if (c.startsWith("/")) return c;
  }
  return { problem: `none of ${into.join(", ")} applies here` };
}

/** What's at `dest`: nothing, a link to `src`, or anything else. */
function stateOf(dest: string, src: string): ExtLink["state"] {
  try {
    const l = lstatSync(dest);
    if (l.isSymbolicLink() && resolve(dirname(dest), readlinkSync(dest)) === src) return "ours";
    return "taken";
  } catch { return "missing"; }
}

/**
 * Every extension under `extRoot` with an ext.json, its links resolved against this machine (`which` finds a program
 * on PATH), and the links install made earlier whose file is gone.
 */
export function extFacts(extRoot: string, o: { env: Env; home: string; bin: string | null; which: (name: string) => string | null }): { exts: ExtFacts[]; stale: StaleLink[] } {
  const exts: ExtFacts[] = [];
  const dirs = new Set<string>();
  let names: string[] = [];
  try { names = readdirSync(extRoot).filter(n => existsSync(join(extRoot, n, "ext.json"))).sort(); } catch { /* no ext/ */ }
  for (const name of names) {
    const dir = join(extRoot, name);
    let m: ExtManifest;
    try {
      m = JSON.parse(readFileSync(join(dir, "ext.json"), "utf8"));
      if (!Array.isArray(m.links) || m.links.some(l => typeof l?.from !== "string" || !Array.isArray(l.into))) throw new Error("links must be [{ from, into: [] }]");
    } catch (e) { exts.push({ name, dir, links: [], problem: `ext.json: ${(e as Error).message}` }); continue; }
    const base: ExtFacts = { name, dir, ...(m.about ? { about: m.about } : {}), links: [] };
    const missing = (m.requires ?? []).filter(p => !o.which(p));
    const links: ExtLink[] = [];
    let problem = missing.length ? `${missing.join(", ")} isn't on PATH` : "";
    for (const l of m.links) {
      const into = intoDir(l.into, o.env, o.home, o.bin);
      if (typeof into === "object") { problem ||= into.problem; continue; }
      dirs.add(into);
      let files: string[] = [];
      try { files = readdirSync(join(dir, l.from)).filter(f => !f.startsWith(".")).sort(); } catch { problem ||= `${l.from}/ isn't there`; }
      for (const f of files) { const src = join(dir, l.from, f), dest = join(into, f); links.push({ src, dest, state: stateOf(dest, src) }); }
    }
    exts.push(problem ? { ...base, links: [], problem } : { ...base, links });
  }
  // Links into ext/ whose file is gone: install made them (nothing else points into a checkout's ext/), so it takes them away.
  const stale: StaleLink[] = [];
  const root = resolve(extRoot) + "/";
  for (const d of dirs) {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { continue; }
    for (const e of entries) {
      const dest = join(d, e);
      try {
        if (!lstatSync(dest).isSymbolicLink()) continue;
        const target = resolve(d, readlinkSync(dest));
        if (target.startsWith(root) && !existsSync(target)) stale.push({ dest, target });
      } catch { /* gone meanwhile */ }
    }
  }
  return { exts, stale };
}

/** The folder `ep0ch` is linked in, for `@bin`: where the link on PATH is when it's this checkout's, else none. */
export const binDirOf = (found: string | null, pointsHere: boolean) => (found && pointsHere ? dirname(found) : null);

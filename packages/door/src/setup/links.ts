// The links `ep0ch install` owns: symlinks from where another program looks (television's cable folder, PATH, Claude
// Code's skills folder) into this checkout. One mechanism for every kind (the door's extensions, ext-links.ts; the
// shipped agent skills, skill-links.ts):
//   - a link is made only where nothing is (a symlink never replaces anything it wasn't told to);
//   - a symlink that is another checkout's copy of the same thing (the kind says what "same" is) is replaced;
//   - anything else there (a file or folder of the person's own, someone else's link) is left as it is, and said;
//   - a link install made into one of its roots whose file is gone (the thing was deleted or renamed) is taken away;
//   - what it made is recorded (`install-links.json` in the door's state), so the folders it linked into are found
//     again after the last thing linking there is gone.
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/** What's at a link's place: nothing, this link, another checkout's copy (replaced), or anything else (left alone). */
export type LinkState = "missing" | "ours" | "replace" | "taken";

/** One link install wants, and what's there now (`was`: where a symlink there points, when it's one). */
export interface OwnedLink { src: string; dest: string; state: LinkState; was?: string }

/** Links install made whose file is gone: in a folder it links into, pointing into one of its roots. */
export interface StaleLink { dest: string; target: string }

/** Where the symlink at `dest` points, resolved; null when there's no symlink there. */
export function linkTarget(dest: string): string | null {
  try { return lstatSync(dest).isSymbolicLink() ? resolve(dirname(dest), readlinkSync(dest)) : null; } catch { return null; }
}

/**
 * What's at `dest` for a link to `src`. `sameAs` says whether a symlink's target is another checkout's copy of the
 * same thing (then it's replaced); without it, any other symlink is left alone.
 */
export function linkAt(src: string, dest: string, sameAs?: (target: string) => boolean): OwnedLink {
  let isLink: boolean;
  try { isLink = lstatSync(dest).isSymbolicLink(); } catch { return { src, dest, state: "missing" }; }
  if (!isLink) return { src, dest, state: "taken" };
  const was = linkTarget(dest)!;
  return { src, dest, was, state: was === resolve(src) ? "ours" : sameAs?.(was) ? "replace" : "taken" };
}

/** Whether `dest` is a symlink into the folder `root` whose file is gone: the only kind install takes away. */
export function staleLinkInto(dest: string, root: string): boolean {
  const target = linkTarget(dest);
  return !!target && target.startsWith(resolve(root) + "/") && !existsSync(target);
}

/** Every link in `dirs` that points into one of `roots` and whose file is gone. */
export function staleLinks(dirs: Iterable<string>, roots: readonly string[]): StaleLink[] {
  const out: StaleLink[] = [];
  for (const d of new Set(dirs)) {
    let entries: string[] = [];
    try { entries = readdirSync(d); } catch { continue; }
    for (const e of entries) {
      const dest = join(d, e);
      if (roots.some(r => staleLinkInto(dest, r))) out.push({ dest, target: linkTarget(dest)! });
    }
  }
  return out;
}

/** The links install made, as it recorded them. */
export function madeLinks(record: string): string[] {
  try { const l = JSON.parse(readFileSync(record, "utf8"))?.links; return Array.isArray(l) ? l.filter((d: unknown) => typeof d === "string") : []; } catch { return []; }
}

/** Keep the record: the links made now added, the ones taken away dropped. */
export function recordLinks(record: string, made: readonly string[], removed: readonly string[]): void {
  const now = [...new Set([...madeLinks(record), ...made])].filter(d => !removed.includes(d)).sort();
  mkdirSync(dirname(record), { recursive: true, mode: 0o700 });
  writeFileSync(record, JSON.stringify({ links: now }, null, 2) + "\n");
}

/** A link step's work, as its commands say: make, replace (another checkout's), take away (stale). */
export interface LinkWork {
  make: { src: string; dest: string }[];
  replace: { src: string; dest: string; was: string }[];
  remove: string[];
  /** The folders install's links point into: a stale link is taken away only while it still points into one. */
  roots: string[];
  record?: string;
}

/** The work for a set of wanted links and the stale ones found, and what's left alone. */
export function linkWork(links: readonly OwnedLink[], stale: readonly StaleLink[], roots: readonly string[], record?: string): { work: LinkWork; taken: OwnedLink[]; ours: number } {
  return {
    work: {
      make: links.filter(l => l.state === "missing").map(l => ({ src: l.src, dest: l.dest })),
      replace: links.filter(l => l.state === "replace").map(l => ({ src: l.src, dest: l.dest, was: l.was! })),
      remove: stale.map(s => s.dest),
      roots: [...roots],
      ...(record ? { record } : {}),
    },
    taken: links.filter(l => l.state === "taken"),
    ours: links.filter(l => l.state === "ours").length,
  };
}

/** The work as commands a person could type. */
export function linkCommands(w: LinkWork, gone = "its file is gone"): string[] {
  return [
    ...w.remove.map(d => `rm ${d}   # ${gone}`),
    ...w.replace.map(l => `ln -sfn ${l.src} ${l.dest}   # was ${l.was}`),
    ...w.make.map(l => `ln -s ${l.src} ${l.dest}`),
  ];
}

/** "2 to link, 1 to replace, 1 stale to take away" */
export function linkCounts(w: LinkWork): string {
  return [w.make.length ? `${w.make.length} to link` : "", w.replace.length ? `${w.replace.length} to replace (another checkout's)` : "",
    w.remove.length ? `${w.remove.length} stale to take away` : ""].filter(Boolean).join(", ");
}

/** A link that couldn't be made: what happened, and the command that does it by hand. */
export class LinkFailed extends Error { constructor(message: string, readonly recover: string) { super(message); } }

/**
 * Runs the work, saying each link: each stale one taken away (only while it's still a link into a root whose file is
 * gone), each of another checkout's replaced (only while it still points where the plan saw), each missing one made (a
 * symlink never replaces anything: if something came there since the plan, it fails and says so). The record is kept
 * whatever happens.
 */
export function applyLinks(w: LinkWork, say: (s: string) => void): void {
  const removed: string[] = [], made: string[] = [];
  const link = (src: string, dest: string, hint: string) => {
    try {
      mkdirSync(dirname(dest), { recursive: true });
      symlinkSync(src, dest);
    } catch (e) { throw new LinkFailed(`linking ${dest} failed: ${(e as Error).message}`, hint); }
    made.push(dest);
  };
  try {
    for (const dest of w.remove) {
      if (w.roots.some(r => staleLinkInto(dest, r))) { unlinkSync(dest); removed.push(dest); say(`took away ${dest} (its file is gone)`); }
    }
    for (const l of w.replace) {
      if (linkTarget(l.dest) !== l.was) throw new LinkFailed(`${l.dest} changed since the plan (it pointed at ${l.was})`, `nothing was replaced; rerun ep0ch install to see the plan`);
      unlinkSync(l.dest);
      link(l.src, l.dest, `${l.dest} was taken away and not linked again; link it by hand: ln -s ${l.src} ${l.dest}`);
      say(`${l.dest} → ${l.src} (was ${l.was})`);
    }
    for (const l of w.make) {
      link(l.src, l.dest, `nothing there was replaced; link it by hand: ln -s ${l.src} ${l.dest}`);
      say(`${l.dest} → ${l.src}`);
    }
  } finally { if (w.record) recordLinks(w.record, made, removed); }
}

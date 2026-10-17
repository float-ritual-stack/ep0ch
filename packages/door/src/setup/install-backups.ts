import { existsSync, lstatSync, readdirSync, realpathSync, rmdirSync, statfsSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { size } from "./progress";

/** Only install's timestamp folders and SQLite copies belong to this retention policy. */
export function pruneInstallBackups(root: string, keep: number, say: (line: string) => void): void {
  if (!existsSync(root)) return;
  const runs = readdirSync(root, { withFileTypes: true })
    .filter(e => e.isDirectory() && /^\d{8}T\d{6}Z$/.test(e.name)).map(e => e.name).sort().reverse();
  const seen = new Map<string, number>();
  let removed = 0;
  for (const run of runs) {
    const folder = join(root, run);
    const outlines = new Map<string, string[]>();
    for (const entry of readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".sqlite")) continue;
      const name = entry.name.replace(/(?:\.schema-\d+)?\.sqlite$/, "");
      outlines.set(name, [...(outlines.get(name) ?? []), entry.name]);
    }
    for (const [name, files] of outlines) {
      const count = (seen.get(name) ?? 0) + 1;
      seen.set(name, count);
      if (count <= keep) continue;
      for (const file of files) { unlinkSync(join(folder, file)); removed++; }
    }
    if (!readdirSync(folder).length) rmdirSync(folder);
  }
  if (removed) say(`Pruned ${removed} old install backups in ${root}; kept the last ${keep} runs per outline.`);
}

function diskBytes(path: string): number {
  if (!existsSync(path)) return 0;
  const seen = new Set<string>();
  const walk = (path: string): number => {
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) return 0;
    const id = `${stat.dev}:${stat.ino}`;
    if (seen.has(id)) return 0;
    seen.add(id);
    return stat.blocks * 512 + (stat.isDirectory()
      ? readdirSync(path).reduce((total, name) => total + walk(join(path, name)), 0) : 0);
  };
  // ~/wt and ~/backups can point at the volume; nested links and Bun's hard links mustn't inflate usage.
  return walk(realpathSync(path));
}

export function prepareInstallBackups(root: string, worktrees: string, needed: number, keep: number, say: (line: string) => void): void {
  pruneInstallBackups(root, keep, say);
  let volume = root;
  while (!existsSync(volume)) volume = dirname(volume);
  const disk = statfsSync(volume);
  const available = disk.bavail * disk.bsize;
  if (available >= needed) return;
  throw new Error(`Not enough backup space at ${root}: need ${size(needed)} (${needed} bytes), available ${size(available)} (${available} bytes). Old install backups: ${size(diskBytes(root))} in ${root}; worktrees (including any stale worktrees): ${size(diskBytes(worktrees))} in ${worktrees}. Inspect with git worktree list before removing stale checkouts.`);
}

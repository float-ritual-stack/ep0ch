import { existsSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { migrateBinding } from "@ep0ch/outliner/outline-binding";
import { outlineOfFile } from "@ep0ch/outline-core/outline-location";

export interface OutlineFiles { folder: string; binding: boolean; scripts: boolean; backup: boolean }

/** Bindings may be in projects; only outline side folders supplied scripts to the host. */
export function outlineFiles(cwd: string, outlines: string): OutlineFiles[] {
  const folders = new Set<string>();
  const sideFolders = new Set<string>();
  for (let folder = resolve(cwd); ; folder = dirname(folder)) {
    if (existsSync(join(folder, ".ep0ch"))) folders.add(folder);
    if (dirname(folder) === folder) break;
  }
  if (existsSync(outlines)) for (const file of readdirSync(outlines)) {
    const name = outlineOfFile(file);
    if (name) { folders.add(join(outlines, name)); sideFolders.add(join(outlines, name)); }
  }
  return [...folders].map(folder => ({ folder,
    binding: existsSync(join(folder, ".ep0ch")) && lstatSync(join(folder, ".ep0ch")).isFile(),
    backup: existsSync(join(folder, ".ep0ch", "config.toml")) && existsSync(join(folder, ".ep0ch.bak")),
    scripts: sideFolders.has(folder) && existsSync(join(folder, "scripts")) && lstatSync(join(folder, "scripts")).isDirectory(),
  })).filter(f => f.binding || f.scripts || f.backup);
}

export function fixOutlineFiles(files: readonly OutlineFiles[], options: { moveScripts?: boolean; retireBackups?: boolean } = {}): string[] {
  const done: string[] = [];
  for (const { folder, scripts, backup: previousBackup } of files) {
    if (options.retireBackups && previousBackup) {
      unlinkSync(join(folder, ".ep0ch.bak"));
      done.push(`${folder}/.ep0ch.bak: retired the previous binding backup`);
    }
    const backup = migrateBinding(folder);
    if (backup) done.push(`${folder}/.ep0ch/config.toml: binding moved; kept ${backup}`);
    if (options.moveScripts && scripts && existsSync(join(folder, "scripts"))) {
      const destination = join(folder, ".ep0ch", "scripts");
      if (existsSync(destination)) throw new Error(`${destination} already exists; move scripts individually after reviewing them`);
      mkdirSync(join(folder, ".ep0ch"), { recursive: true });
      renameSync(join(folder, "scripts"), destination);
      done.push(`${destination}: scripts moved; each file still needs // ep0ch-script to opt in`);
    }
  }
  return done;
}

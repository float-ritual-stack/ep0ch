import { existsSync, lstatSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { formatDotEp0ch, parseDotEp0ch } from "@ep0ch/outline-core/outline-location";

/** The binding moves verbatim, including comments; its backup is never overwritten. */
export function migrateBinding(folder: string): string | undefined {
  const dot = join(folder, ".ep0ch");
  if (!existsSync(dot) || !lstatSync(dot).isFile()) return undefined;
  const backup = `${dot}.bak`;
  if (existsSync(backup)) throw new Error(`${backup} already exists; move it aside before ep0ch doctor --fix`);
  const text = readFileSync(dot, "utf8");
  renameSync(dot, backup);
  mkdirSync(dot);
  writeFileSync(join(dot, "config.toml"), text, { mode: 0o644 });
  return backup;
}

/** One writer for init, the outline chooser and the host's own folder. */
export function writeDotEp0ch(folderInput: string, name: string, options: { replace?: boolean; machine?: string } = {}): string {
  const folder = resolve(folderInput);
  const dot = join(folder, ".ep0ch");
  const file = join(dot, "config.toml");
  const old = existsSync(dot) && lstatSync(dot).isFile() ? dot : file;
  const current = existsSync(old) ? readFileSync(old, "utf8") : undefined;
  let agent: string | undefined;
  try { agent = current === undefined ? undefined : parseDotEp0ch(current, old).agent; } catch { /* A replacement can repair a malformed binding. */ }
  const text = formatDotEp0ch(name, options.machine, agent);
  if (current !== undefined && current !== text && !options.replace) {
    const error = new Error(`${old} already names an outline; it was left as it is`) as NodeJS.ErrnoException;
    error.code = "EEXIST";
    throw error;
  }
  migrateBinding(folder);
  mkdirSync(dot, { recursive: true });
  if (current === text) return file;
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, text, { mode: 0o644 });
  renameSync(temporary, file);
  return file;
}

import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, linkSync, mkdtempSync, rmSync, rmdirSync, statSync } from "node:fs";

/**
 * Copies a stopped database consistently (VACUUM INTO, from a read-only connection) and checks the copy: install's, with
 * the host stopped or not running. A live outline is copied by its host (`outlines.backup`, PIE-1750), never here.
 */
export function backupDatabase(path: string, dest: string): { integrity: string } {
  // An existing file is never touched: not overwritten, and not removed when this copy fails.
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  const folder = mkdtempSync(join(dirname(dest), ".ep0ch-snapshot-"));
  const temporary = join(folder, "copy.sqlite");
  try {
    const src = new Database(path, { readonly: true });
    try { src.run("VACUUM INTO ?", [temporary]); } finally { src.close(); }
    chmodSync(temporary, 0o600);
    const copy = new Database(temporary, { readonly: true });
    try {
      const rows = copy.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
      const verdict = rows.map(r => r.integrity_check).join("; ");
      if (verdict !== "ok") throw new Error(`the copy of ${path} failed its integrity check: ${verdict}`);
      // A hard link publishes the checked file atomically and refuses an existing destination.
      try { linkSync(temporary, dest); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new Error(`${dest} already exists; not overwritten`);
        throw error;
      }
      return { integrity: verdict };
    } finally { copy.close(); }
  } finally {
    for (const file of [temporary, `${temporary}-journal`, `${temporary}-wal`, `${temporary}-shm`]) rmSync(file, { force: true });
    rmdirSync(folder);
  }
}


/**
 * What a snapshot's copy holds, read from the copy (never a live outline): its size, SHA-256 and schema, refused when it
 * fails its integrity check. A process of its own runs it (`--check <copy>`), so a big outline's check never holds the
 * host's loop; the copy itself is the store's (`OutlinerStore.backupTo`, PIE-1750).
 */
export async function describeCopy(path: string): Promise<{ bytes: number; sha256: string; schema: number }> {
  const copy = new Database(path, { readonly: true });
  try {
    const rows = copy.query("PRAGMA integrity_check").all() as { integrity_check: string }[];
    const verdict = rows.map(r => r.integrity_check).slice(0, 3).join("; ");
    if (verdict !== "ok") throw new Error(`the copy failed its integrity check: ${verdict}`);
    const schema = (copy.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(path).arrayBuffer()).digest("hex");
    return { bytes: statSync(path).size, sha256, schema };
  } finally { copy.close(); }
}

if (import.meta.main) {
  const [flag, copy] = process.argv.slice(2);
  if (flag !== "--check" || !copy) throw new Error("snapshot-database needs --check <copy>");
  console.log(JSON.stringify(await describeCopy(copy)));
}

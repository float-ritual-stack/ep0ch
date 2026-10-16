import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { chmodSync, existsSync, linkSync, mkdtempSync, rmSync, rmdirSync, statSync } from "node:fs";

/** Copies a database consistently (VACUUM INTO, from a read-only connection) and checks the copy. */
export function backupDatabase(path: string, dest: string): { integrity: string } {
  // An existing file is never touched: not overwritten, and not removed when this copy fails.
  if (existsSync(dest)) throw new Error(`${dest} already exists; not overwritten`);
  const folder = mkdtempSync(join(dirname(dest), ".ep0ch-snapshot-"));
  const temporary = join(folder, "copy.sqlite");
  try {
    const src = new Database(path, { readonly: true });
    try {
      // A reader of a WAL database rarely waits, but a service's checkpoint or recovery can hold it briefly.
      src.run("PRAGMA busy_timeout = 5000");
      src.run("VACUUM INTO ?", [temporary]);
    } finally { src.close(); }
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


if (import.meta.main) {
  const [source, destination] = process.argv.slice(2);
  if (!source || !destination) throw new Error("snapshot-database needs source and destination");
  const asOf = new Date().toISOString();
  backupDatabase(source, destination);
  const copy = new Database(destination, { readonly: true });
  try {
    const schema = (copy.query("PRAGMA user_version").get() as { user_version: number }).user_version;
    const sha256 = new Bun.CryptoHasher("sha256").update(await Bun.file(destination).arrayBuffer()).digest("hex");
    console.log(JSON.stringify({ bytes: statSync(destination).size, sha256, schema, asOf }));
  } finally { copy.close(); }
}

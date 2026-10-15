// One toss at a time per outline (PIE-779): a lock file beside its mail. A run that finds another going waits for it, up
// to a minute; a lock older than five minutes is a run that died. A folder that is gone, or one this run can't write,
// ends the wait with the reason (PIE-850): only "a lock file is already there" is a reason to wait.
import { mkdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** The lock at `file`, held by this process (the releasing function), or undefined when another run held it too long to wait. */
export async function lockFile(file: string, wait: boolean, stamp: string): Promise<(() => void) | undefined> {
  mkdirSync(dirname(file), { recursive: true });
  for (let tries = 0; ; tries += 1) {
    try {
      writeFileSync(file, `${process.pid} ${stamp}\n`, { flag: "wx" });
      return () => rmSync(file, { force: true });
    } catch (error) {
      const code = (error as NodeJS.ErrnoException)?.code;
      // Anything but "it is there already" is the folder's problem (gone, not ours to write): said, not retried.
      if (code !== "EEXIST") throw new Error(`EchoNet can't take its toss lock ${file}: ${code === "ENOENT" ? "its folder is gone (was the outline removed?)" : (error as Error).message}`);
      let age: number;
      try { age = Date.now() - statSync(file).mtimeMs; } catch (gone) {
        // The other run let go between our write and our look: try again, a few times, not for ever.
        if ((gone as NodeJS.ErrnoException)?.code !== "ENOENT" || tries > 600) throw new Error(`EchoNet can't read its toss lock ${file}: ${(gone as Error).message}`);
        await Bun.sleep(10);
        continue;
      }
      if (age > 5 * 60_000) { rmSync(file, { force: true }); continue; }
      if (!wait || tries > 600) return undefined;
      await Bun.sleep(100);
    }
  }
}

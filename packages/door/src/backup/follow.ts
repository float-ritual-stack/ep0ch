// `ep0ch backup follow` (ADR 0009): this machine's followers of other machines' outlines, run by the ep0ch-follow unit.
// Each outline `EP0CH_MCP_MIRRORS` names (`<outline>@<machine>`) is followed into `<mirrors>/<machine>/` by the
// outliner's OutlineFollower: the home's change log applied within seconds of a change there, served read-only to the
// gateway and the web client from the same folder. On a machine with no gateway (float-box following pie), it is the
// seconds-fresh copy of that outline if its machine's disk is lost.
import { existsSync, readFileSync } from "node:fs";
import { parseEnvFile } from "@ep0ch/outliner/env-file";
import { mirrorsConfig, OutlineFollower } from "../mcp-mirror";
import type { BackupConfig, Env } from "./config";

export async function followCommand(c: BackupConfig, io: { out: (s: string) => void; err: (s: string) => void }, o: { once?: boolean; env?: Env } = {}): Promise<number> {
  // The unit runs with the settings file's values (what install wrote); this shell's own win.
  const fromFile = existsSync(c.file) ? parseEnvFile(readFileSync(c.file, "utf8")) : {};
  const config = mirrorsConfig({ ...fromFile, ...(o.env ?? c.env) });
  if ("error" in config) { io.err(`ep0ch backup follow: ${config.error}`); return 2; }
  if (!config.mirrors.length) { io.err(`ep0ch backup follow: nothing to follow; EP0CH_MCP_MIRRORS=<outline>@<machine>[,…] in ${c.file} names what this machine follows`); return 2; }
  const followers = config.mirrors.map(m => new OutlineFollower(m.outline, m.machine, config.folder, line => io.out(line)));
  const report = async () => {
    let ok = true;
    for (const f of followers) {
      const r = await f.read();
      if ("error" in r) { ok = false; io.out(`✗ ${f.outline}@${f.machine}: ${r.error}`); }
      else io.out(`${r.stale ? "!" : "✓"} ${f.outline}@${f.machine}: entry ${r.copy.cursor}, newest change ${r.asOf}${r.stale ? `; stale: ${r.stale.why}` : ""}`);
    }
    return ok;
  };
  if (o.once) {
    for (const f of followers) await f.pull();
    const ok = await report();
    await Promise.all(followers.map(f => f.close()));
    return ok ? 0 : 1;
  }
  await report();
  const stop = Promise.withResolvers<void>();
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => stop.resolve());
  await stop.promise;
  await Promise.all(followers.map(f => f.close()));
  return 0;
}

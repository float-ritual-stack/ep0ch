import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { recordJson, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { exportFiles, readRecords } from "./export";
import { boardFor, type Out } from "./notes-cli";

export const MIRROR_USAGE = `  ep0ch mirror <dir> [--once] [--ws <name>] [--machine <ssh-name>]
                                   export every live note as source in its tree, then follow changes;
                                   --once writes one pass and exits. manifest.json records asOf,
                                   sequence and leftOut. Restarted hosts reconnect and catch up`;

function atomicFile(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

export async function mirrorCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1), valued = ["--ws", "--machine"];
  for (const flag of valued) {
    const at = args.indexOf(flag);
    if (at >= 0 && (!args[at + 1] || args[at + 1]!.startsWith("--"))) { io.err(`ep0ch: ${flag} needs a value`); return 2; }
  }
  const rest = args.filter((arg, i) => !valued.includes(arg) && !valued.includes(args[i - 1] ?? "") && arg !== "--once" && arg !== "--here");
  if (rest.length !== 1 || rest[0]!.startsWith("--")) { io.err(MIRROR_USAGE); return 2; }
  const dir = rest[0]!, once = args.includes("--once");
  const board = await boardFor(args, argsIn);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  const manifestPath = join(dir, "manifest.json");
  let records = new Map<string, BlockRecord>(), sequence = 0;
  let written = new Map<string, string>(), previousFiles: string[] = [];
  let dirty = false, full = true, connected = true, stopped = false;
  let active: Promise<void> | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (code: number) => void = () => {};
  const done = new Promise<number>(resolve => { finish = resolve; });
  const stop = () => { stopped = true; finish(0); };

  const sync = async () => {
    if (full) {
      // Capture the feed position before reading: edits during the snapshot are replayed afterward.
      const start = await board.changesSince(sequence);
      const ids = (await board.queryIds({ machinery: "show" })).ids;
      records = ids.length ? (await readRecords(board, ids, false)).byId : new Map();
      sequence = start.sequence;
      full = false;
    }
    for (;;) {
      const page = await board.changesSince(sequence);
      if (page.kind === "reset") { full = true; dirty = true; return; }
      const changed = [...new Set(page.changes.map(c => c.blockId).filter((id): id is string => !!id))];
      if (changed.length) {
        // A parent's title or location changes every descendant's file path; trash removes the same subtree.
        const affected = new Set(changed);
        const include = (id: string) => { for (const child of records.get(id)?.children ?? []) if (!affected.has(child)) { affected.add(child); include(child); } };
        changed.forEach(include);
        const fresh = await readRecords(board, [...affected], true);
        for (const id of affected) records.delete(id);
        for (const [id, record] of fresh.byId) records.set(id, record);
      }
      sequence = page.nextSequence;
      if (page.completeness.kind === "complete") break;
    }
    const files = exportFiles([...records.values()], records, { format: "md", children: false, split: true, resolveLinks: false, source: true });
    const next = new Map(files.map(f => [f.name, f.content]));
    for (const [name, content] of next) if (written.get(name) !== content) atomicFile(join(dir, name), content);
    for (const name of previousFiles) if (!next.has(name) && existsSync(join(dir, name))) unlinkSync(join(dir, name));
    atomicFile(manifestPath, recordJson({ outline: board.address.outline, machine: board.address.machine, outlineInstanceId: board.outlineInstanceId,
      format: "md", asOf: new Date().toISOString(), sequence, files: [...next.keys()], leftOut: [] }));
    written = next; previousFiles = [...next.keys()];
  };
  const drain = async () => {
    while (dirty && connected && !stopped) { dirty = false; await sync(); }
  };
  const wake = () => {
    dirty = true;
    if (active || timer || !connected || stopped) return;
    timer = setTimeout(() => {
      timer = undefined;
      active = drain().catch(e => {
        if (connected) { io.err(`ep0ch mirror: ${(e as Error).message}`); stopped = true; finish(1); }
        else dirty = true;
      }).finally(() => { active = undefined; if (dirty) wake(); });
    }, 25);
  };
  try {
    if (existsSync(manifestPath)) {
      const previous = JSON.parse(readFileSync(manifestPath, "utf8"));
      previousFiles = previous.files;
      sequence = previous.sequence ?? 0;
    }
    if (!once) {
      board.onConnection = (state, detail) => { connected = state === "restored"; io.err(`ep0ch mirror: ${detail}`); if (connected) wake(); };
      board.subscribe(event => { if (event.action === "reset") full = true; if (event.domain === "content") wake(); });
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    }
    dirty = true;
    active = drain(); await active; active = undefined;
    io.err(`ep0ch: mirrored ${written.size} notes in ${dir}${once ? "" : " · following changes"}`);
    return once ? 0 : await done;
  } catch (e) { io.err(`ep0ch mirror: ${(e as Error).message}`); return 1; }
  finally {
    stopped = true;
    if (timer) clearTimeout(timer);
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
    await active?.catch(() => {}); board.close();
  }
}

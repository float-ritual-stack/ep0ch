// What Jev was asked, one line per ask (PIE-1546). A quiet ask (Jev read a write and said nothing) was a
// `review-quiet` block, and every ask rewrote the day's `jev-run` tally: on a busy evening pie took a block write a
// second from Jev alone, and each one was a turn on the host's loop and a pass over every watched question. Now an ask
// is a line appended to `<outline folder>/jev/<day>.jsonl` (note, revision, writer, harness, source, tokens), the day's
// tally is written from that file at most every 15 minutes, and a backfill rerun skips a note by the file
// (`suggestions.asks`). Findings stay blocks: they are the suggestions page's rows.
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** One ask: what Jev was asked about and what it cost. `told` asks left findings (blocks); `quiet` ones none. */
export interface JevAsk {
  kind: "quiet" | "unavailable" | "told";
  at: string;
  experiment: string;
  note?: string;
  revision?: number;
  writer?: string;
  harness?: string;
  source?: string;
  title?: string;
  model?: string;
  promptRev?: string;
  /** A quiet ask code reviewed alone (Jev wasn't asked): a backfill skips it, the day's quiet count doesn't hold it. */
  read?: false;
  tokensIn: number;
  tokensOut: number;
}

/**
 * What the day's run said before its asks were kept here (the first tally written from the file takes it once), so a
 * day that began with the old in-place counts keeps them.
 */
export interface JevRunBase { kind: "base"; at: string; experiment: string; quiet: number; unavailable: number; tokensIn: number; tokensOut: number }

export type JevAskLine = JevAsk | JevRunBase;

/** How often a day's tally is written from the file at most. */
export const TALLY_EVERY_MS = 15 * 60_000;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The asks of an outline, by day: a folder of JSONL files, or (no folder: a scratch service, a test) kept in memory. */
export class JevAsks {
  private readonly memory = new Map<string, JevAskLine[]>();
  private readonly tallied = new Map<string, number>();

  constructor(readonly folder?: string, private readonly now: () => number = Date.now) {}

  append(day: string, line: JevAskLine): void {
    if (!DAY.test(day)) throw new Error(`a day is YYYY-MM-DD, not ${day}`);
    if (!this.folder) { this.memory.set(day, [...(this.memory.get(day) ?? []), line]); return; }
    mkdirSync(this.folder, { recursive: true });
    appendFileSync(join(this.folder, `${day}.jsonl`), `${JSON.stringify(line)}\n`);
  }

  /** A day's lines, oldest first; a line that doesn't read (a write cut off) is skipped. */
  lines(day: string): JevAskLine[] {
    if (!DAY.test(day)) return [];
    if (!this.folder) return [...(this.memory.get(day) ?? [])];
    const file = join(this.folder, `${day}.jsonl`);
    if (!existsSync(file)) return [];
    return readFileSync(file, "utf8").split("\n").flatMap(line => {
      if (!line.trim()) return [];
      try { return [JSON.parse(line) as JevAskLine]; } catch { return []; }
    });
  }

  /** The days kept, newest first. */
  days(): string[] {
    if (!this.folder) return [...this.memory.keys()].sort().reverse();
    if (!existsSync(this.folder)) return [];
    return readdirSync(this.folder).flatMap(name => name.endsWith(".jsonl") && DAY.test(name.slice(0, -6)) ? [name.slice(0, -6)] : []).sort().reverse();
  }

  /** The asks of the last `days` days matching `keep`, newest day first (`suggestions.asks`). */
  find(keep: (ask: JevAsk) => boolean, days = 30): JevAsk[] {
    return this.days().slice(0, days).flatMap(day => this.lines(day).filter((l): l is JevAsk => l.kind !== "base" && keep(l)));
  }

  /** Whether the day's tally of `experiment` is due: never written by this service, or not in the last 15 minutes. Marks it written. */
  due(experiment: string, day: string): boolean {
    const key = `${experiment}\0${day}`, last = this.tallied.get(key), now = this.now();
    if (last !== undefined && now - last < TALLY_EVERY_MS) return false;
    this.tallied.set(key, now);
    return true;
  }
}

/** The day's counts of one experiment, from its lines: undefined when the file has no line of it (a day from before). */
export function tallyOf(lines: readonly JevAskLine[], experiment: string): { base?: JevRunBase; quiet: number; unavailable: number; tokensIn: number; tokensOut: number; model?: string; promptRev?: string } | undefined {
  const own = lines.filter(l => l.experiment === experiment);
  if (!own.length) return undefined;
  const base = own.find((l): l is JevRunBase => l.kind === "base");
  const asks = own.filter((l): l is JevAsk => l.kind !== "base" && l.source !== "backfill");
  const read = [...asks].reverse().find(a => a.model);
  return {
    ...(base ? { base } : {}),
    quiet: (base?.quiet ?? 0) + asks.filter(a => a.kind === "quiet" && a.read !== false).length,
    unavailable: (base?.unavailable ?? 0) + asks.filter(a => a.kind === "unavailable").length,
    tokensIn: (base?.tokensIn ?? 0) + asks.reduce((n, a) => n + (a.tokensIn || 0), 0),
    tokensOut: (base?.tokensOut ?? 0) + asks.reduce((n, a) => n + (a.tokensOut || 0), 0),
    ...(read?.model ? { model: read.model } : {}),
    ...(read?.promptRev ? { promptRev: read.promptRev } : {}),
  };
}

const held = new Map<string, JevAsks>();
/** The asks of the outline whose folder is `workspaceRoot` (`<folder>/jev/`), one keeper per folder for the service's life. */
export function asksFor(workspaceRoot: string): JevAsks {
  let asks = held.get(workspaceRoot);
  if (!asks) held.set(workspaceRoot, asks = new JevAsks(join(workspaceRoot, "jev")));
  return asks;
}

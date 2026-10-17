import { appendFileSync, mkdirSync, readdirSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { PROPERTY_KEY_SOURCE, propertyTokenMatches } from "@ep0ch/outline-core/property-grammar";
import { blockReferenceEnvelopeRanges, pageLinkRanges } from "@ep0ch/outline-core/link-syntax";
import type { BlockSizeCensus } from "@ep0ch/outline-core/protocol";
import { boardFor } from "./notes-cli";
import { stateDir } from "./state";

interface Usage {
  time: string; actor: string; tool: string; outline: string | null;
  shape: Record<string, unknown>;
  requestBytes: number; responseBytes: number; requestTokens: number; responseTokens: number; durationMs: number;
}
const usageDir = () => join(stateDir(), "mcp-usage");
const DAY = 86_400_000;

// Mask literals before looking for keys: a quoted value can itself contain query-looking text.
function queryShape(text: string): string {
  for (const token of [...propertyTokenMatches(text)].reverse()) {
    text = text.slice(0, token.start) + `${token.key}=?` + text.slice(token.end);
  }
  text = text.replace(/"(?:[^"\\]|\\.)*(?:"|$)/g, "?");
  for (const ranges of [blockReferenceEnvelopeRanges, pageLinkRanges]) {
    for (const range of ranges(text).reverse()) text = text.slice(0, range.start) + "?" + text.slice(range.end);
  }
  // A value runs to the next blank, parentheses and all (`text~secret(private)` is one value): what's cut off is a
  // group's closing parentheses, which the shape keeps. Over-redacting a shape is fine; leaking a value isn't.
  const value = String.raw`\S+`;
  const closers = (v: string) => /\)*$/.exec(v)![0];
  const child = String.raw`child(?:>=\d+)?:${PROPERTY_KEY_SOURCE}(?:\s*(?:::|>=|<=|=|>|<)\s*${value})?`;
  const clause = new RegExp(`(${child})|(${PROPERTY_KEY_SOURCE})\\s*(::|:|>=|<=|!=|=|>|<|~)\\s*(${value})|#\\S+`, "g");
  return text.replace(clause, (all, childClause: string | undefined, key: string | undefined, op: string | undefined, literal: string | undefined) => {
    if (childClause) {
      const colon = childClause.indexOf(":");
      return childClause.slice(0, colon).replace(/\d+/g, "?") + ":" + queryShape(childClause.slice(colon + 1));
    }
    return key ? `${key}${op}?${closers(literal ?? "")}` : `#?${closers(all)}`;
  }).replace(/\s+/g, " ").trim();
}

export function usageShape(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const shape: Record<string, unknown> = {};
  for (const key of ["where", "query"]) if (typeof args[key] === "string") {
    shape[key] = tool === "outline_find" && key === "query" ? "?" : queryShape(args[key]);
  }
  for (const key of ["fields", "limit", "sort"]) if (args[key] !== undefined) shape[key] = args[key];
  return shape;
}

export function recordUsage(row: Usage): void {
  const dir = usageDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, `${row.time.slice(0, 10)}.jsonl`), JSON.stringify(row) + "\n", { mode: 0o600 });
  pruneUsage(dir, Date.parse(row.time));
}

/** Days older than 30 go, on every record and every read (a quiet machine still forgets). */
function pruneUsage(dir: string, now: number): void {
  const oldest = new Date(now - 29 * DAY).toISOString().slice(0, 10);
  let files: string[];
  try { files = readdirSync(dir); } catch { return; }
  for (const file of files) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && file.slice(0, 10) < oldest) {
    try { unlinkSync(join(dir, file)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  }
}

function stats(values: number[]) {
  values.sort((a, b) => a - b);
  const n = values.length;
  return { total: values.reduce((a, b) => a + b, 0), median: n ? (values[Math.floor((n - 1) / 2)]! + values[Math.floor(n / 2)]!) / 2 : 0,
    p90: n ? values[Math.ceil(n * .9) - 1]! : 0 };
}
function summarize(rows: Usage[]) {
  return { calls: rows.length, requestBytes: stats(rows.map(r => r.requestBytes)), responseBytes: stats(rows.map(r => r.responseBytes)),
    requestTokens: stats(rows.map(r => r.requestTokens)), responseTokens: stats(rows.map(r => r.responseTokens)), durationMs: stats(rows.map(r => r.durationMs)) };
}

export async function usageCommand(args: string[], io: { write?: (s: string) => void; err?: (s: string) => void }): Promise<number> {
  const out = io.write ?? console.log, err = io.err ?? console.error;
  pruneUsage(usageDir(), Date.now());
  let since = 24 * 3_600_000, by: "tool" | "actor" | "outline" = "tool", json = false, census = false;
  const boardArgs: string[] = [];
  try {
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      if (a === "--json") json = true;
      else if (a === "--census") census = true;
      else if (a === "--since") {
        const match = /^(\d+(?:\.\d+)?)([mhd])$/.exec(args[++i] ?? "");
        if (!match || Number(match[1]) <= 0) throw new Error("use --since <duration>, for example --since 24h (m, h or d)");
        since = Number(match[1]) * ({ m: 60_000, h: 3_600_000, d: DAY }[match[2]!]!);
      } else if (a === "--by") {
        const value = args[++i];
        if (value !== "tool" && value !== "actor" && value !== "outline") throw new Error("use --by tool|actor|outline");
        by = value;
      } else if (a === "--ws" || a === "--machine") {
        const value = args[++i];
        if (!value || value.startsWith("--")) throw new Error(`${a} needs a name`);
        boardArgs.push(a, value);
      } else throw new Error(`unknown usage option ${a}; run ep0ch --help`);
    }
    if (census) {
      const board = await boardFor(boardArgs);
      if ("error" in board) throw new Error(board.error);
      try {
        const result = await board.request<BlockSizeCensus>("blocks.census");
        if (json) out(JSON.stringify({ ...board.address, census: result }));
        else {
          out(`Block size census for ${board.address.outline}@${board.address.machine} (characters; current live blocks, latest writer)`);
          for (const [group, rows] of [["outline", [result.outline]], ["actor", result.actors], ["branch", result.branches]] as const) {
            for (const row of rows) out(`${group} ${"key" in row ? row.key : board.address.outline}: ${row.blocks} blocks, ${row.characters} characters, median ${row.median}, p90 ${row.p90}`);
          }
        }
      } finally { board.close(); }
      return 0;
    }
    if (boardArgs.length) throw new Error("--ws and --machine apply to --census; usage reads this machine's MCP state directory");
    const cutoff = new Date(Date.now() - since).toISOString(), dir = usageDir();
    let files: string[];
    try { files = readdirSync(dir); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; files = []; }
    const rows: Usage[] = [];
    for (const file of files.sort()) if (/^\d{4}-\d{2}-\d{2}\.jsonl$/.test(file) && file.slice(0, 10) >= cutoff.slice(0, 10)) {
      for (const line of readFileSync(join(dir, file), "utf8").split("\n")) if (line) {
        const row: Usage = JSON.parse(line);
        if (row.time >= cutoff) rows.push(row);
      }
    }
    const grouped = new Map<string, Usage[]>();
    for (const row of rows) { const key = row[by] ?? "(no outline)"; const group = grouped.get(key) ?? []; group.push(row); grouped.set(key, group); }
    const report = { since: cutoff, directory: dir, by, total: summarize(rows), groups: [...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([key, entries]) => ({ key, ...summarize(entries) })) };
    if (json) out(JSON.stringify(report));
    else {
      out(`MCP usage since ${cutoff}; ${dir} (30 daily files retained; tokens estimated as bytes / 4)`);
      for (const row of [{ key: "total", ...report.total }, ...report.groups]) {
        out(`${row.key}: ${row.calls} calls`);
        for (const key of ["requestBytes", "responseBytes", "requestTokens", "responseTokens", "durationMs"] as const) {
          const s = row[key]; out(`  ${key}: total ${s.total}, median ${s.median}, p90 ${s.p90}`);
        }
      }
    }
    return 0;
  } catch (e) { err(`ep0ch: ${(e as Error).message}`); return 1; }
}

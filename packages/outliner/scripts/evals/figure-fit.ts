// The figure-fit eval (PIE-721): score src/figure-fit.ts on an outline's own notes before it tells anyone anything.
//
//   bun scripts/evals/figure-fit.ts <copy.sqlite> [--labels <file.json>] [--shaped <n>] [--gate <g>] [--confidence <c>]
//                                                 [--out <report.json>] [--note]
//
// <copy.sqlite> is a copy of an outline (the MCP gateway's outline_snapshot, or `sqlite3 <db> ".backup <copy>"`), opened
// read-only; a file in the outlines folder (EP0CH_OUTLINES, else ~/outlines) is refused: an eval never touches a live
// outline. --labels is a JSON map of block id → a figure's id or "none" (the notes a person pointed at). --shaped caps the
// unlabelled shaped notes asked about (default 150). Jev's answers are cached per model, prompt and text under
// $XDG_CACHE_HOME/ep0ch/figure-fit (else ~/.cache), so a second run, or a threshold changed, asks nothing again. --note prints
// the report as a note the outline draws (its figures the eval's subject); otherwise a summary. The key is Jev's own
// (TYPESAFE_API_KEY, else the `typesafe` with-secrets group). Exits 0 with a report, 1 when Jev couldn't be asked at all.
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, join, resolve } from "node:path";
import { BUILTIN_COMPONENT_SCHEMAS } from "@ep0ch/outline-core/component-schema";
import { outlinesFolder } from "@ep0ch/outline-core/outline-location";
import { loadFigureFitPrompt } from "../../src/ai-prompts";
import { askFigureFit, FIGURE_FIT_THRESHOLDS, type FigureFitReading } from "../../src/figure-fit";
import { evalSet, reportNote, scoreReadings, sweepThresholds, type EvalItem } from "../../src/figure-fit-eval";
import { JEV_MODEL } from "../../src/search-ranking";

const USAGE = "usage: bun scripts/evals/figure-fit.ts <copy.sqlite> [--labels <file.json>] [--shaped <n>] [--gate <g>] [--confidence <c>] [--out <report.json>] [--note]";

export async function main(argv: string[], env: NodeJS.ProcessEnv = process.env, out = (s: string) => console.log(s), err = (s: string) => console.error(s)): Promise<number> {
  const value = (flag: string) => { const i = argv.indexOf(flag); return i >= 0 ? argv[i + 1] : undefined; };
  const db = argv.find((a, i) => !a.startsWith("--") && !["--labels", "--shaped", "--gate", "--confidence", "--out"].includes(argv[i - 1] ?? ""));
  if (!db) { err(USAGE); return 2; }
  const path = resolve(db);
  const outlines = resolve(outlinesFolder({ EP0CH_OUTLINES: env.EP0CH_OUTLINES }, homedir()));
  if (path.startsWith(`${outlines}/`)) { err(`figure-fit eval: ${path} is in the outlines folder; take a copy first (outline_snapshot, or sqlite3 <db> ".backup <copy>") and pass that`); return 2; }
  if (!existsSync(path)) { err(`figure-fit eval: no file ${path}`); return 2; }
  const labels = value("--labels") ? JSON.parse(readFileSync(resolve(value("--labels")!), "utf8")) as Record<string, string> : {};
  const shapedCap = Number(value("--shaped") ?? 150);
  const thresholds = { gate: Number(value("--gate") ?? FIGURE_FIT_THRESHOLDS.gate), confidence: Number(value("--confidence") ?? FIGURE_FIT_THRESHOLDS.confidence) };

  const read = new Database(path, { readonly: true });
  const blocks = read.query<{ id: string; text: string }, []>("SELECT id, text FROM blocks WHERE deleted_at IS NULL ORDER BY updated_at DESC").all();
  read.close();
  const all = evalSet(blocks, labels);
  let shaped = 0;
  const items: (EvalItem & { reading?: FigureFitReading })[] = all.filter(i => i.label !== null || shaped++ < shapedCap);

  const schemas = BUILTIN_COMPONENT_SCHEMAS;
  const prompt = await loadFigureFitPrompt();
  const cacheDir = join(env.XDG_CACHE_HOME || join(homedir(), ".cache"), "ep0ch", "figure-fit");
  mkdirSync(cacheDir, { recursive: true });
  const keyOf = (text: string) => createHash("sha256").update(`${JEV_MODEL}\n${prompt.revisions[0]!.sha256}\n${text}`).digest("hex");
  let asked = 0, cached = 0, unavailable = 0, lastWhy = "";
  const queue = [...items];
  await Promise.all(Array.from({ length: 4 }, async () => {
    for (let item = queue.shift(); item; item = queue.shift()) {
      const file = join(cacheDir, `${keyOf(item.text)}.json`);
      if (existsSync(file)) { item.reading = JSON.parse(readFileSync(file, "utf8")); cached++; continue; }
      asked++;
      const reading = await askFigureFit(item.text, schemas, { env, timeoutMs: 15_000 });
      if ("unavailable" in reading) { unavailable++; lastWhy = reading.unavailable; continue; }
      item.reading = reading;
      writeFileSync(file, JSON.stringify(reading));
    }
  }));
  if (unavailable && unavailable === asked && !cached) { err(`figure-fit eval: Jev couldn't be asked (${lastWhy})`); return 1; }

  const score = scoreReadings(items, schemas, thresholds);
  const sweep = sweepThresholds(items, schemas);
  const meta = { outline: basename(path), model: JEV_MODEL, prompt: prompt.revisions[0]!.sha256, asked, cached, unavailable };
  if (value("--out")) writeFileSync(resolve(value("--out")!), JSON.stringify({ meta, score, sweep }, null, 2));
  if (argv.includes("--note")) out(reportNote(score, sweep, meta));
  else {
    const p = score.positives;
    out(`figure-fit eval on ${meta.outline}: ${p.n} positives, ${score.shaped.n} shaped, ${score.none.n} none (Jev asked ${asked}, cached ${cached}, unavailable ${unavailable})`);
    out(`  at gate ${thresholds.gate} / confidence ${thresholds.confidence}: right figure suggested ${p.correct}/${p.n}, first choice right ${p.top1}/${p.n}, shaped notes told ${score.shaped.suggested}/${score.shaped.n}, told when none ${score.none.suggested}/${score.none.n}`);
    for (const r of sweep) out(`  gate ${r.gate} confidence ${r.confidence}: recall ${r.recall ?? "—"} precision ${r.precision ?? "—"} shaped told ${r.shapedRate ?? "—"} none told ${r.noneRate ?? "—"}`);
  }
  return 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));

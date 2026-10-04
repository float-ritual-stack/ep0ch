// `ep0ch export`: notes out as files (PIE-534), Markdown or JSON, deterministic so an exported folder can live in git.
// Which notes: ids given, and `ep0ch find`'s selection flags (--query, --view, --under, the date flags), which the
// outline evaluates (selectNotes); with --children, everything under them too. A selection cut short at the outline's
// limits is refused: a folder must hold all of what was asked. What each note is: its block record,
// built by the service (`blocks.records`, outline-core's block-record.ts). Nothing here parses a note: the header line
// and front matter are outline-core's header-line.ts, the record's `header` and `body` the service's.
//
// Markdown: a file a note. Front matter is its identity (id, parent, created, updated, author, actor) and its header
// line's chips, which move there out of the body; the body is the rest verbatim, its first line the prose that shared
// line 1 (the title). Children follow as nested list items (each child's text verbatim, indented), or, with --split,
// as files of their own that the parent lists as links. Links stay `((id))` and `[[page]]`; --resolve-links makes the
// ones whose target was exported relative file links. JSON: the records, keys sorted. `--manifest` writes manifest.json
// (the export time, the outline, the selection): the only file that says when. A `::graph-*` figure is written as its
// ASCII twin (graphs.ts figureAscii: the door's own drawing, colour taken off, in mdxcn's fenced frame, live ones
// answered first), so the file reads as the door shows it; --source keeps the block as written.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { recordJson, type BlockRecord } from "@ep0ch/outline-core/block-record";
import { noteFile, type NoteIdentity } from "@ep0ch/outline-core/header-line";
import { boardFor, selectionOf, selectNotes, selects, type Out } from "./notes-cli";
import { connectFigures, figureAscii, figureSource, isGraphStart } from "./graphs";
import { liveSettled } from "./live";
import { titleLine } from "./board";
import { metadataLines } from "./props";
import type { SocketBoard } from "./socket";
import { blockIdOf, printable } from "./text";

export const EXPORT_USAGE = `  ep0ch export [<id>…] [--query "<expression>"] [--view <id>] [--under <id>] [<date flags>]
               [--children] [--format md|json] [--out <dir>|-] [--split] [--resolve-links] [--manifest] [--source]
                                   notes out as files: the notes named (((id)) or bare ids, as find --ids
                                   prints them) and the ones find's flags select. --format md (the default): a
                                   file a note, its header line's [k::v] chips moved into YAML front matter
                                   (values verbatim strings, a repeated key a list) with its id, parent,
                                   created, updated and author; the body verbatim, its first line the prose
                                   line 1 held. --children adds what's under each note, as nested lists, or
                                   files of their own with --split. --resolve-links turns ((id)) and [[page]]
                                   links to exported notes into relative file links. A ::graph-* figure
                                   is written as its plain ASCII drawing in a fence (+--[ TITLE ]--+, 60
                                   wide, live ones answered first); --source keeps it as written. --format json: block
                                   records (as find --json), keys sorted. --out <dir> writes <title>-<id8>.md
                                   (or .json) files there (it adds and replaces, never removes); without it
                                   (or -), stdout. --manifest adds manifest.json: the export time, the outline,
                                   the selection and the files it wrote`;

/** A note's file name: its title as a slug, then the start of its id (so two notes of one title never collide). */
export function fileName(r: Pick<BlockRecord, "id" | "title">, ext: "md" | "json"): string {
  const slug = r.title.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60).replace(/-+$/, "");
  return `${slug || "note"}-${r.id.slice(0, 8)}.${ext}`;
}

/** A record's identity, as its front matter says it. */
export const identityOf = (r: BlockRecord): NoteIdentity => ({
  id: r.id, ...(r.parent ? { parent: r.parent } : {}), created: r.created, updated: r.updated, author: r.author, ...(r.actor ? { actor: r.actor } : {}),
});

/**
 * The note's body (or, `whole`, its text) with its links to exported notes made relative file links: every place the
 * service says a link is written (the record's `links[].spans`), when its target was exported, becomes `[label](file)`.
 * An embed (`!((id))`) and every other link stay as written; the door never reads link syntax itself.
 */
export function resolveLinks(r: BlockRecord, files: ReadonlyMap<string, { file: string; title: string }>, whole = false): string {
  const source = whole ? r.text : r.body;
  const cuts: { start: number; end: number; with: string }[] = [];
  for (const l of r.links) {
    const f = l.target ? files.get(l.target) : undefined;
    if (!f) continue;
    for (const [start, end] of whole ? l.spans : l.bodySpans) {
      if (source[start - 1] === "!") continue;
      cuts.push({ start, end, with: `[${(l.label || f.title).replace(/[[\]]/g, "\\$&")}](${encodeURI(f.file)})` });
    }
  }
  let out = source;
  for (const c of cuts.sort((a, b) => b.start - a.start)) out = out.slice(0, c.start) + c.with + out.slice(c.end);
  return out;
}

export interface ExportOptions {
  format: "md" | "json";
  children: boolean;
  split: boolean;
  resolveLinks: boolean;
  /** Figures as written (--source); otherwise (Markdown) each is its ASCII twin. */
  source?: boolean;
}

/** The figure's ASCII twin's width in an exported file. */
export const FIGURE_WIDTH = 60;

/**
 * `text` with each `::graph-*` figure (outside code fences) written as its ASCII twin in a fence. `drawn`: the text the
 * figures are read from, when `text` had its links rewritten (resolveLinks): the same figures in the same order. `note`:
 * the note it is, for a figure block's child bullets. `whole`: `text` starts with the note's title (else it is its body).
 */
export function figuresAsAscii(text: string, note: string, drawn = text, whole = true): string {
  const blocks = (t: string) => {
    const lines = t.split("\n"), out: { kind: string; from: number; to: number }[] = [];
    let fence = false;
    for (let i = 0; i < lines.length; i++) {
      if (/^\s*(```|~~~)/.test(lines[i]!)) { fence = !fence; continue; }
      const kind = fence ? null : isGraphStart(lines[i]!);
      if (!kind) continue;
      let j = i + 1;
      while (j < lines.length && !/^\s*::\s*$/.test(lines[j]!)) j++;
      // `to`: its closing `::`, or (unclosed) the line after its last.
      out.push({ kind, from: i, to: j });
      i = j;
    }
    return { lines, out };
  };
  const target = blocks(text), source = blocks(drawn);
  if (!target.out.length || target.out.length !== source.out.length) return text;
  const lines = target.lines.slice();
  // The note's figure block, as the reader finds it (surface/note.ts readableSource): the first line with text below
  // the title and its property lines.
  const start = whole ? Math.max(0, titleLine(drawn).line) + 1 : 0, meta = whole ? metadataLines(drawn, null) : new Set<number>();
  const blockLine = source.lines.findIndex((l, i) => i >= start && !meta.has(i) && l.trim());
  for (let k = target.out.length - 1; k >= 0; k--) {
    const t = target.out[k]!, s = source.out[k]!;
    const first = s.from === blockLine;
    const ascii = figureAscii(s.kind, figureSource(source.lines.slice(s.from + 1, s.to), note, first), FIGURE_WIDTH);
    lines.splice(t.from, Math.min(t.to, lines.length - 1) - t.from + 1, "```", ...ascii, "```");
  }
  return lines.join("\n");
}

/** One output file: its name and its content. */
export interface ExportFile { name: string; content: string }

/**
 * The files an export writes, in order: `roots` are the notes selected (their records), `byId` every record read (the
 * descendants too, with --children). Deterministic: the same records give the same bytes.
 */
export function exportFiles(roots: readonly BlockRecord[], byId: ReadonlyMap<string, BlockRecord>, o: ExportOptions): ExportFile[] {
  const ext = o.format;
  // Which records get files of their own: the roots, and with --split every descendant.
  const own: BlockRecord[] = [];
  const seen = new Set<string>();
  const walk = (r: BlockRecord) => {
    if (seen.has(r.id)) return;
    seen.add(r.id);
    own.push(r);
    if (o.children && o.split) for (const c of r.children) { const k = byId.get(c); if (k) walk(k); }
  };
  roots.forEach(walk);
  // Two notes whose names would be the same (one title, one id start) both take their whole id.
  const names = own.map(r => fileName(r, ext));
  const twice = new Set(names.filter((n, i) => names.indexOf(n) !== i));
  const files = new Map(own.map((r, i) => [r.id, { file: twice.has(names[i]!) ? `${names[i]!.slice(0, -(ext.length + 10))}-${r.id}.${ext}` : names[i]!, title: r.title }]));
  if (ext === "json") {
    return own.map(r => ({ name: files.get(r.id)!.file, content: recordJson(o.children && !o.split ? subtree(r, byId) : r) }));
  }
  const linked = (r: BlockRecord, whole: boolean) => {
    const raw = whole ? r.text : r.body, text = o.resolveLinks ? resolveLinks(r, files, whole) : raw;
    return o.source ? text : figuresAsAscii(text, r.id, raw, whole);
  };
  return own.map(r => {
    const lines: string[] = [];
    if (o.children) {
      const list = (k: BlockRecord, depth: number) => {
        const pad = "  ".repeat(depth);
        const mine = files.get(k.id);
        if (mine) { lines.push(`${pad}- [${k.title.replace(/[[\]]/g, "\\$&")}](${encodeURI(mine.file)})`); return; }
        const [first = "", ...rest] = linked(k, true).split("\n");
        lines.push(`${pad}- ${first}`, ...rest.map(l => (l ? `${pad}  ${l}` : "")));
        for (const c of k.children) { const g = byId.get(c); if (g) list(g, depth + 1); }
      };
      for (const c of r.children) { const k = byId.get(c); if (k) list(k, 0); }
    }
    // The body verbatim, trailing newlines too (noteFile ends the file in one more, which readNoteFile takes off).
    const body = linked(r, false);
    const content = noteFile(identityOf(r), r.header, lines.length ? `${body.replace(/\n+$/, "")}\n\n${lines.join("\n")}` : body);
    return { name: files.get(r.id)!.file, content };
  });
}

/** A record and everything under it, in outline order: what a note's JSON file holds with --children. */
function subtree(r: BlockRecord, byId: ReadonlyMap<string, BlockRecord>): BlockRecord[] {
  const out: BlockRecord[] = [];
  const walk = (k: BlockRecord) => { out.push(k); for (const c of k.children) { const g = byId.get(c); if (g) walk(g); } };
  walk(r);
  return out;
}

/** Records for `ids` and, with `children`, everything under them, read level by level; plus the ids not found. */
export async function readRecords(board: SocketBoard, ids: string[], children: boolean): Promise<{ byId: Map<string, BlockRecord>; missing: string[] }> {
  const byId = new Map<string, BlockRecord>();
  const missing: string[] = [];
  let next = ids;
  while (next.length) {
    const r = await board.records(next.filter(id => !byId.has(id)));
    for (const rec of r.records) byId.set(rec.id, rec);
    missing.push(...r.unavailable.filter(u => ids.includes(u.id)).map(u => `${u.id} (${u.status})`));
    next = children ? r.records.flatMap(rec => rec.children).filter(id => !byId.has(id)) : [];
  }
  return { byId, missing };
}

/** `ep0ch export …`: its exit code. */
export async function exportCommand(argsIn: string[], io: Out = { out: s => process.stdout.write(`${s}\n`), err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  const valued = ["--ws", "--machine", "--format", "--out"];
  for (const f of valued) {
    const at = args.indexOf(f);
    if (at >= 0 && (args[at + 1] === undefined || (args[at + 1]!.startsWith("--") && args[at + 1] !== "-"))) { io.err(`ep0ch: ${f} needs a value`); return 2; }
  }
  const value = (f: string) => { const at = args.indexOf(f); return at >= 0 ? args[at + 1] : undefined; };
  const format = (value("--format") ?? "md") as ExportOptions["format"];
  const again = (change: (a: string[]) => string[]) => `ep0ch ${change(argsIn).map(a => (/^[\w@%+=:,./()-]+$/.test(a) ? a : `'${a.replace(/'/g, "'\\''")}'`)).join(" ")}`;
  if (format !== "md" && format !== "json") { io.err(`ep0ch: --format is md or json, not ${format}: ${again(a => a.map((x, i) => (a[i - 1] === "--format" ? "md" : x)))}`); return 2; }
  const o: ExportOptions = { format, children: args.includes("--children"), split: args.includes("--split"), resolveLinks: args.includes("--resolve-links"), source: args.includes("--source") };
  const out = value("--out"), manifest = args.includes("--manifest");
  if (o.split && !o.children) { io.err(`ep0ch: --split puts each child in a file of its own: ${again(a => [...a, "--children"])}`); return 2; }
  if ((o.split || manifest) && (!out || out === "-")) { io.err(`ep0ch: ${o.split ? "--split" : "--manifest"} writes files into a folder: ${again(a => [...a.filter((x, i) => x !== "--out" && a[i - 1] !== "--out"), "--out", "./notes"])}`); return 2; }
  const picked = selectionOf(args.filter((a, i) => !valued.includes(a) && !valued.includes(args[i - 1] ?? "")));
  if ("error" in picked) { io.err(`ep0ch: ${picked.error}`); return 2; }
  const bare = ["--children", "--split", "--resolve-links", "--manifest", "--source"];
  const ids = picked.rest.filter(a => !bare.includes(a));
  const unknown = ids.find(a => a.startsWith("--"));
  if (unknown) { io.err(`ep0ch: export doesn't take ${unknown}\n${EXPORT_USAGE}`); return 2; }
  const sel = { ids: ids.map(blockIdOf), words: [] as string[], ...picked.selection };
  if (!sel.ids.length && !selects(sel)) { io.err(`ep0ch: export takes notes' ids or find's flags (--query, --view, --under)\n${EXPORT_USAGE}`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    const chosen = await selectNotes(board, sel);
    if ("error" in chosen) { io.err(`ep0ch: ${chosen.error}`); return 1; }
    if (chosen.truncated) { io.err(`ep0ch: the selection holds more than ${chosen.truncated}: nothing written. Narrow it (another clause in --query, or --under <id>), or export it in parts`); return 1; }
    if (!chosen.ids.length) { io.err("ep0ch: nothing matches: no files written"); return 1; }
    const { byId, missing } = await readRecords(board, chosen.ids, o.children);
    for (const m of missing) io.err(`ep0ch: no note ${m}: left out (export takes notes' ids; for words, ep0ch find <words> --ids)`);
    const roots = chosen.ids.flatMap(id => byId.get(id) ?? []);
    // Live figures and figure blocks' child bullets ask the outline: ask once, wait for every answer, then draw.
    if (format === "md" && !o.source) {
      connectFigures(board, () => {});
      for (const r of byId.values()) if (r.text.includes("::graph-")) figuresAsAscii(r.text, r.id);
      await liveSettled();
    }
    const files = exportFiles(roots, byId, o);
    if (!out || out === "-") {
      if (format === "json") io.out(recordJson(o.children ? [...new Set(roots.flatMap(r => subtree(r, byId)))] : roots).trimEnd());
      else io.out(files.map(f => f.content.trimEnd()).join("\n\n"));
      return missing.length ? 1 : 0;
    }
    mkdirSync(out, { recursive: true });
    for (const f of files) writeFileSync(join(out, f.name), f.content);
    if (manifest) {
      const info = await board.info();
      writeFileSync(join(out, "manifest.json"), recordJson({
        exportedAt: new Date().toISOString(), outline: info.outline ?? null, format, files: files.map(f => f.name),
        selection: { ids: sel.ids, query: sel.query ?? null, view: sel.view ?? null, under: sel.under ?? null, dates: sel.dates, children: o.children, split: o.split, resolveLinks: o.resolveLinks },
      }));
    }
    io.err(`ep0ch: ${files.length} file${files.length === 1 ? "" : "s"} in ${printable(out)}${manifest ? " (and manifest.json)" : ""}`);
    return missing.length ? 1 : 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}

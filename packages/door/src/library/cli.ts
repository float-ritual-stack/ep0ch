// `ep0ch library` (PIE-618): the component schemas from a shell. `--json` prints them as the outline merges them (its own
// styles and types among the values, its extensions' components): what an editor's completion source or an agent's
// tool description reads, the same answer the door completes from. `--out <dir>` writes a page per component as
// Markdown (outline-core's `componentPageMarkdown`), each variation drawn as the door draws it at `--width` above its
// source; a page attached to a published note (`[file::…] [publish::true]`) is served as HTML by the publisher's renderer.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { componentBriefs, componentPageMarkdown, type ComponentSchema, type Variation } from "@ep0ch/outline-core/component-schema";
import { calloutsReady } from "../callouts";
import { componentsReady } from "../component-schemas";
import { headingStylesReady } from "../heading-styles";
import { boardFor, type Out } from "../notes-cli";
import { visible } from "../style";
import { drawVariation, variationReady } from "./draw";
import { chooseComponents } from "./brief";
import { WIDTHS } from "./library";

export const LIBRARY_USAGE = `  ep0ch library [<component>…] [--brief | --json | --out <dir> [--width 40|80|160]] [--ws <name>] [--machine <ssh-name>]
                                   the component library (PIE-618): every component's properties, as the outline
                                   has them (its own heading styles and callout types among the values, its
                                   extensions' components). With no flag, the components; --brief, what an agent
                                   reads: per component its purpose, where it goes, each property as
                                   key: values (default) — meaning, and a minimal example (the
                                   outline_components tool says the same); --json, their schemas
                                   (what completion reads); --out <dir>, a Markdown page each (<id>.md, and
                                   README.md listing them), every variation drawn as the door draws it above its
                                   source: attach one to a note with [file::<dir>/<id>.md] [publish::true] and the
                                   publisher serves it as HTML. The pages to browse: ep0ch --screen library`;

const value = (args: string[], f: string) => { const at = args.indexOf(f); return at >= 0 ? args[at + 1] : undefined; };

export async function libraryCommand(argsIn: string[], io: Out = { out: console.log, err: console.error }): Promise<number> {
  const args = argsIn.slice(1);
  const takes = ["--ws", "--machine", "--out", "--width"];
  for (const f of takes) if (args.includes(f) && (value(args, f) === undefined || value(args, f)!.startsWith("--"))) { io.err(`ep0ch: ${f} takes a value\n${LIBRARY_USAGE}`); return 2; }
  const names = args.filter((a, i) => !a.startsWith("--") && !takes.includes(args[i - 1] ?? ""));
  const unknown = args.find(a => a.startsWith("--") && !takes.includes(a) && a !== "--json" && a !== "--brief" && a !== "--here");
  if (unknown) { io.err(`ep0ch: library doesn't take ${unknown}\n${LIBRARY_USAGE}`); return 2; }
  const out = value(args, "--out"), width = Number(value(args, "--width") ?? 80);
  if ([args.includes("--json"), args.includes("--brief"), !!out].filter(Boolean).length > 1) { io.err(`ep0ch: library prints --brief, prints --json or writes --out, one of them\n${LIBRARY_USAGE}`); return 2; }
  if (!(WIDTHS as readonly number[]).includes(width)) { io.err(`ep0ch: --width is ${WIDTHS.join(", ")}`); return 2; }
  const board = await boardFor(args);
  if ("error" in board) { io.err(`ep0ch: ${board.error}`); return 1; }
  try {
    const src = { board, redraw: () => {} };
    const all = await componentsReady(src);
    const picked = chooseComponents(all, names);
    if ("error" in picked) { io.err(`ep0ch: ${picked.error}`); return 1; }
    const chosen: readonly ComponentSchema[] = picked.chosen;
    if (args.includes("--brief")) { io.out(componentBriefs(chosen).trimEnd()); return 0; }
    if (args.includes("--json")) { io.out(JSON.stringify(chosen, null, 2)); return 0; }
    if (!out) {
      for (const s of chosen) io.out(`${s.id.padEnd(16)} ${s.title} · ${s.props.length} properties${s.origin && s.origin !== "built-in" ? ` · ${s.origin}` : ""}`);
      io.out("\nep0ch --screen library browses them; --json prints their schemas; --out <dir> writes their pages");
      return 0;
    }
    await Promise.all([headingStylesReady(src), calloutsReady(src)]);
    const dir = resolve(out);
    mkdirSync(dir, { recursive: true });
    for (const s of chosen) {
      // Every variation the page draws is asked for first (a rule's, the service draws), then the page is drawn whole.
      const waits: Promise<void>[] = [];
      componentPageMarkdown(s, (v: Variation) => { waits.push(variationReady(v, src)); return null; });
      await Promise.all(waits);
      writeFileSync(join(dir, `${s.id}.md`), componentPageMarkdown(s, v => drawVariation(v, width, src).map(l => visible(l).trimEnd())));
    }
    writeFileSync(join(dir, "README.md"), ["# Component library", "", ...chosen.map(s => `- [${s.title}](${s.id}.md): ${s.where}`), ""].join("\n"));
    io.out(`wrote ${chosen.length} page${chosen.length === 1 ? "" : "s"} and README.md to ${dir}`);
    return 0;
  } catch (e) {
    io.err(`ep0ch: ${(e as Error).message}`);
    return 1;
  } finally { board.close(); }
}

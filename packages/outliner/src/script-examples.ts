import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The worked examples of the scripts reference (docs/scripts.md, PIE-982): each is a few notes you can paste, written in the
 * page as a four-backtick fence, so one source serves the reader, the showcase (which seeds them) and the tests (which run
 * them and compare what they draw to the page's own "shows" block).
 *
 *   ````note ex2-host parent=ex2-script     one note's source; `parent` names an earlier note of the example
 *   ````shows ex2                           what the example draws, as text
 */
export interface ScriptExampleNote { example: number; label: string; parent?: string; text: string }
export interface ScriptExample { example: number; title: string; notes: ScriptExampleNote[]; shows: string }

export const SCRIPTS_DOC_FILE = join(import.meta.dir, "..", "docs", "scripts.md");

/** The examples a page holds, by number: `#### Example 2: a title` starts one, its fences follow. */
export function scriptExamples(page: string = readFileSync(SCRIPTS_DOC_FILE, "utf8")): ScriptExample[] {
  const examples = new Map<number, ScriptExample>();
  for (const heading of page.matchAll(/^#### Example (\d+): (.+)$/gm)) {
    examples.set(Number(heading[1]), { example: Number(heading[1]), title: heading[2]!.trim(), notes: [], shows: "" });
  }
  for (const fence of page.matchAll(/^````(note|shows) ([^\n]+)\n([\s\S]*?)\n````$/gm)) {
    const [, kind, info, body] = fence as unknown as [string, "note" | "shows", string, string];
    const [label = "", ...words] = info.trim().split(/\s+/);
    const number = Number(/^ex(\d+)/.exec(label)?.[1]);
    const example = examples.get(number);
    if (!example) throw new Error(`the ${kind} fence "${label}" belongs to no "#### Example ${number}:" heading`);
    if (kind === "shows") example.shows = body;
    else example.notes.push({ example: number, label, ...(words.find(w => w.startsWith("parent=")) ? { parent: words.find(w => w.startsWith("parent="))!.slice(7) } : {}), text: body });
  }
  return [...examples.values()].sort((a, b) => a.example - b.example);
}

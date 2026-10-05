// One-off (PIE-565): the layouts a door saved by name in its state (layouts.json, before screens were notes) written to
// an outline as screen notes, so `--screen <name>`, ^W r and every door on the outline find them. Run it by hand once
// per outline that should have them, check the screens, then delete layouts.json and this script (git keeps it). The
// door never reads layouts.json again: one version, no runtime import.
//
//   bun scripts/import-layouts.ts --ws <outline> [--state <dir>] [--apply]
//
// Without --apply it says what it would write. A layout whose name isn't a screen's name (it starts with a digit), is a
// built-in screen's (desk, river, board), or is already a screen note is left out, with why. Written as the person
// (author: user): they're the person's own layouts.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { connectTarget } from "../src/door";
import { stateDir } from "../src/state";
import { USER } from "../src/socket";
import { loadScreenNotes, saveScreenNote, screenNote } from "../src/desk/screen-notes";
import { builtinScreen, readSpec, screenNameProblem } from "../src/desk/screen-spec";
import "../src/desk/screen-specs";

const args = process.argv.slice(2);
const flag = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined; };
const ws = flag("--ws"), apply = args.includes("--apply"), dir = flag("--state") ?? stateDir();
if (!ws) { console.error("say which outline: bun scripts/import-layouts.ts --ws <outline> [--state <dir>] [--apply]"); process.exit(2); }
const file = join(dir, "layouts.json");
let saved: Record<string, unknown>;
try { saved = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.error(`can't read ${file}: ${(e as Error).message}`); process.exit(1); }

const target = await connectTarget(["--ws", ws]);
if ("error" in target) { console.error(target.error); process.exit(1); }
const { board } = target;
await loadScreenNotes(board);
let wrote = 0, skipped = 0;
for (const [name, layout] of Object.entries(saved)) {
  const why = screenNameProblem(name) ?? (builtinScreen(name) ? `${name} is a built-in screen's name` : screenNote(name) ? `the outline already has a screen note named ${name}` : null);
  if (why) { console.log(`✗ ${name}: left out (${why}); save it again from the door under another name: ^W r, then ^W w`); skipped++; continue; }
  let spec;
  try { spec = readSpec({ name, title: name, layouts: true, layout }); } catch (e) { console.log(`✗ ${name}: left out (${(e as Error).message})`); skipped++; continue; }
  if (!apply) { console.log(`· ${name}: would be written as a screen note`); continue; }
  const { note } = await saveScreenNote(board, spec, USER);
  console.log(`✓ ${name}: screen note ((${note.id})) · ep0ch --screen ${name} --ws ${ws}`);
  wrote++;
}
board.close();
if (!apply) console.log(`\nnothing written yet · bun scripts/import-layouts.ts --ws ${ws}${flag("--state") ? ` --state ${dir}` : ""} --apply`);
else console.log(`\n${wrote} written, ${skipped} left out · once the screens open as they should: rm ${file}`);

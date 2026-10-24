// Fictional callout cases shared by the write-receipt regression and the live figure-fit eval.
// bun scripts/evals/figure-fit-callouts.ts <scratch-directory>, then run the printed eval command.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OutlinerStore } from "../../src/store";

export const CALLOUT_CASES = [
  { title: "Today on the allotment", component: "graph-compare", text: "> [!note] Today on the allotment\n> - Watering: today by hand; after with a drip line.\n> - Paths: today muddy; after covered with chips.\n> - Seeds: today loose packets; after labelled trays." },
  { title: "Choices with reasons", component: "graph-decision", text: "> [!abstract]+ Choices with reasons\n> - Pick cedar beds: chosen because they last through wet winters.\n> - Reject plastic beds: rejected because repairs need special parts.\n> - Defer stone beds: deferred because moving them needs a second pair of hands." },
  { title: "Weekend plan", component: "graph-check", text: "> [!todo] Weekend plan\n> - [x] Clear the old beds.\n> - [x] Mark the paths.\n> - [ ] Fit the water barrel.\n> - [ ] Plant the beans." },
  { title: "Claims and sources", component: "graph-table", text: "> [!info] Claims and sources\n> | Claim | Source | Checked |\n> | --- | --- | --- |\n> | Barrel holds 80 litres | Maker's label | 2026-06-02 |\n> | Bed is 2 metres long | Tape measurement | 2026-06-03 |\n> | Seeds need 7 days | Packet instructions | 2026-06-04 |" },
  { title: "Wet paint", component: "none", text: "> [!warning] Wet paint\n> Leave the gate open until the paint dries." },
];

if (import.meta.main) {
  if (!process.argv[2]) { console.error("usage: bun packages/outliner/scripts/evals/figure-fit-callouts.ts <scratch-directory>"); process.exit(2); }
  const directory = resolve(process.argv[2]!);
  mkdirSync(directory, { recursive: true });
  const database = join(directory, "callouts.sqlite"), labels = join(directory, "labels.json");
  const store = new OutlinerStore(database, { workspaceRoot: directory });
  const labelled = Object.fromEntries(CALLOUT_CASES.map(c => [store.create(c.text).id, c.component]));
  store.close();
  writeFileSync(labels, JSON.stringify(labelled, null, 2));
  console.log(`bun packages/outliner/scripts/evals/figure-fit.ts ${database} --labels ${labels} --shaped 0`);
}

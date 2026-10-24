// Fictional callout cases shared by the write-receipt regression and the live figure-fit eval.
// bun scripts/evals/figure-fit-callouts.ts <scratch-directory>, then run the printed eval command.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { OutlinerStore } from "../../src/store";

// Verbatim fictional Before from pie [[callouts-to-figures]] (41280a8e).
const REFERENCE_BEFORE = `Get the seed order to the co-op before the frost, then confirm to Priya [status::next]

> [!question] The ask
> Priya, Oct 22 (thread): the order reaches the co-op with the frost list.

> [!bug] Today on the shared sheet
> The order carries the beans and the onions only.
> Frost-tender seeds stay on our side.

> [!tip] The route, per Sam
> 1. Write the frost list to the co-op's form.
> 2. The Friday run takes it to the co-op.
> Not tested yet.
> > [!info] The form
> > POST /orders/:plot
> > order.frostList.tender

> [!note] Rules
> Two crates at most.
> Do it before the Saturday dig, so the dig covers the tender seeds.

> [!success] Superseded Oct 23 by Sam
> Nothing is required: blanks go as "none".
> Saved on the co-op form, not the plot ledger.
> Cap of 2: Sam confirmed.

> [!info] History · June sheet reading, replaced
> Two crates at most: the old sheet refused three.
> Three fields required per crate: grower, plot number, variety.
> It lands on the plot ledger.

> [!note] Edges the order must cover
> By design, in scope: a plot with a standing order gets no new form.
> By design: the frost list is on in spring and autumn only.
> Possible defect, unproven: a write replaces the whole list.`;

const [, today, route, rules, superseded, history, edges] = REFERENCE_BEFORE.split(/\n\n(?=> \[!)/).slice(1);

const reference = [
  // Before omits the plan; these plan rows are copied from After, rather than invented.
  { title: "The plan", component: "graph-check", text: `> [!todo] The plan
> - [x] Sheet built and shared — Oct 20
> - [ ] Three fields, all or nothing — Sam's draft
> - [ ] Frost list in the order — this to-do
> - [ ] Saturday dig — after the order, so it covers the tender seeds
> - [ ] Priya has her answer in the thread — done when` },
  { title: "What changes", component: "graph-compare", text: [today, route, rules].join("\n\n") },
  { title: "What we send", component: "graph-decision", text: [rules, superseded, history].join("\n\n") },
  { title: "Edges the order must cover", component: "graph-table", text: edges! },
  { title: "Route from Sam, not tested yet", component: "none", text: "> [!warning] Route from Sam, not tested yet" },
];

export const REFERENCE_CASES = reference.flatMap(c => {
  let lead = c.title;
  const bullets = c.text.split("\n").map(line => {
    const header = /^> \[![^\]]+\] ?(.*)$/.exec(line);
    if (header) { lead = header[1]!; return ""; }
    const body = line.replace(/^>(?: >)* ?/, "");
    return body ? `- **${lead}:** ${body}` : "";
  }).join("\n");
  return [
    { ...c, text: `${c.title}\n\n${c.text}` },
    { ...c, title: `${c.title} (bold leads)`, text: `${c.title} (bold leads)\n\n${bullets || `- **${c.title}:**`}` },
  ];
});

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
  const labelled = Object.fromEntries([...REFERENCE_CASES, ...CALLOUT_CASES].map(c => [store.create(c.text).id, c.component]));
  store.close();
  writeFileSync(labels, JSON.stringify(labelled, null, 2));
  console.log(`bun packages/outliner/scripts/evals/figure-fit.ts ${database} --labels ${labels} --shaped 0`);
}

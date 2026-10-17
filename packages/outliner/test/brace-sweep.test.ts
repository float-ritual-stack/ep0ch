import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applySweep, planSweep, sweepDiff, sweepText } from "../src/brace-sweep";
import { OutlinerStore } from "../src/store";

// Fictional notes holding each old form, in a scratch outline file.
const work = mkdtempSync(join(tmpdir(), "brace-sweep-"));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const RULE = "Bay badges [rule-name::bay-badges] [rule-match::type=bay-job] [rule-decorate::badge] [rule-place::below] [rule-label::{title} · {status} · {$1} · {text} · {level}]";
const SCRIPT = "Plant beans [script::plant-beans] [effects::write]\n```actions\nblock.mark id=\"{note}\" reason=\"{why}\"\ntile.open kind=query query={tag}\n```";
const UNTOUCHED = [
  "Prose with {braces} and `{code}` and a `[rule-label::{title}]` in code, plus {{this.title}} already new.",
  "Other script [script::other]\n```js\nconst o = {note};\n```",
  "A rule already new [rule-name::fresh] [rule-match::type=x] [rule-decorate::badge] [rule-place::append] [rule-label::{{this.title}}]",
];

test("the sweep turns each old form into the new grammar and leaves the rest", () => {
  const rule = sweepText(RULE);
  expect(rule.text).toBe("Bay badges [rule-name::bay-badges] [rule-match::type=bay-job] [rule-decorate::badge] [rule-place::append] [rule-label::{{this.title}} · {{this.status}} · {{match[1]}} · {{match.text}} · {{match.level}}]");
  expect(rule.changes.map(c => c.form)).toEqual(["rule-place", "rule-label"]);
  expect(sweepText(SCRIPT).text).toBe("Plant beans [script::plant-beans] [effects::write]\n```actions\nblock.mark id=\"{{props.note}}\" reason=\"{{props.why}}\"\ntile.open kind=query query={{props.tag}}\n```");
  for (const text of UNTOUCHED) expect(sweepText(text)).toEqual({ text, changes: [] });
});

test("a label keeps reading properties, a place word it doesn't know stays, and a script example in a literal region is text", () => {
  // `{author}` was the block's property of that name, not its record field; a dotted key has no path and stays.
  expect(sweepText("Badge [rule-name::b] [rule-label::{author} {id} {margin.x}]").text).toBe("Badge [rule-name::b] [rule-label::{{this.block.author}} {{this.block.id}} {margin.x}]");
  expect(sweepText("Badge [rule-name::b] [rule-place::constructor]")).toEqual({ text: "Badge [rule-name::b] [rule-place::constructor]", changes: [] });
  const shown = "How to [script::howto]\n<!-- literal -->\n```actions\nopen id={note}\n```\n<!-- /literal -->";
  expect(sweepText(shown)).toEqual({ text: shown, changes: [] });
});

test("a dry run writes nothing, the apply is one attributed change, and a second run is a no-op", async () => {
  const database = join(work, "pie.sqlite");
  const store = new OutlinerStore(database);
  const made = [RULE, SCRIPT, ...UNTOUCHED].map(text => store.create(text, null, "user"));
  store.close();

  const plan = planSweep(database);
  expect(plan.applied).toBe(false);
  expect(plan.notes.map(n => n.id).sort()).toEqual([made[0]!.id, made[1]!.id].sort());
  expect(sweepDiff(plan.notes.find(n => n.id === made[0]!.id)!)).toContain("+ Bay badges");
  const afterPlan = new OutlinerStore(database);
  expect(afterPlan.require(made[0]!.id).text).toBe(RULE);
  afterPlan.close();

  const report = await applySweep(database);
  expect(report.applied).toBe(true);
  const after = new OutlinerStore(database);
  try {
    expect(after.require(made[0]!.id).text).toContain("[rule-place::append]");
    expect(after.require(made[1]!.id).text).toContain("{{props.note}}");
    for (const [i, text] of UNTOUCHED.entries()) expect(after.require(made[i + 2]!.id).text).toBe(text);
    // Every rewritten note keeps its previous text in its revisions, and the writes are one attributed change.
    expect(after.revisions(made[0]!.id).revisions.length).toBeGreaterThan(1);
    const feed = after.changes.since(0, 1000);
    const swept = feed.kind === "changes" ? feed.changes.filter(c => c.action === "brace-sweep") : [];
    expect(swept.map(c => c.blockId).sort()).toEqual([made[0]!.id, made[1]!.id].sort());
    expect(swept.every(c => c.actor?.actorId === "brace-sweep")).toBe(true);
  } finally {
    after.close();
  }
  expect(planSweep(database).notes).toEqual([]);
  expect((await applySweep(database)).applied).toBe(false);
});

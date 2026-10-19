import { expect, test } from "bun:test";
import { anchorRunbookSteps, runbookSteps } from "../src/runbook";

const command = "```sh run\nprintf garden\n```";

test("step anchors use titles without changing context, controls, or literal text", () => {
  const cases = [
    { before: "Water the pots\ncwd:: /tmp", anchored: "Water the pots ^step-water-the-pots\ncwd:: /tmp", title: "Water the pots", cwd: "/tmp" },
    { before: "Water the pots\nrun:: --cwd='/tmp/garden pots'", anchored: "Water the pots ^step-water-the-pots\nrun:: --cwd='/tmp/garden pots'", title: "Water the pots", cwd: "/tmp/garden pots" },
    { before: "## Water the pots", anchored: "## Water the pots ^step-water-the-pots", title: "Water the pots" },
    { before: "A paragraph about the garden.", anchored: "A paragraph about the garden. ^step-a-paragraph-about-the-garden", title: "A paragraph about the garden." },
    { before: "cwd:: /tmp", anchored: "cwd:: /tmp\n^step-step", title: "Step", cwd: "/tmp" },
    { before: "[label::garden]", anchored: "[label::garden]\n^step-step", title: "Step" },
    { before: "- Water the pots", anchored: "- Water the pots\n^step-step", title: "Step" },
    { before: "> [!note] Water the pots", anchored: "> [!note] Water the pots\n^step-step", title: "Step" },
    { before: "```env\nLABEL=garden\n```", anchored: "```env\nLABEL=garden\n```\n^step-step", title: "Step" },
    { before: "run:: --cwd=/tmp", anchored: "^step-step\nrun:: --cwd=/tmp", title: "Step", cwd: "/tmp" },
  ];
  for (const c of cases) {
    const saved = anchorRunbookSteps(`${c.before}\n${command}`, new Set());
    expect(saved).toBe(`${c.anchored}\n${command}`);
    expect(anchorRunbookSteps(saved, new Set())).toBe(saved);
    expect(runbookSteps({ id: "garden", text: `[type::runbook]\n\n${saved}` })[0]).toMatchObject({ title: c.title, ...(c.cwd ? { cwd: c.cwd } : {}) });
  }
});

test.each(["## Garden", "Garden"])("two fences under %s keep separate stable anchors without using a title inside a fence", (heading) => {
  const source = `${heading}\n${command}\n\n${command}\n\n\`\`\`text\n## Example title\n\`\`\`\n${command}`;
  const saved = anchorRunbookSteps(source, new Set());
  const steps = runbookSteps({ id: "garden", text: `[type::runbook]\n\n${saved}` });
  expect(steps.map(s => s.anchor)).toEqual(["step-garden", "step-garden-2", "step-garden-3"]);
  expect(saved).toContain(`${heading} ^step-garden\n`);
  expect(saved).toContain("\n^step-garden-2\n```sh run");
  expect(saved).toContain("## Example title\n```\n^step-garden-3\n");
  expect(anchorRunbookSteps(saved, new Set())).toBe(saved);
});

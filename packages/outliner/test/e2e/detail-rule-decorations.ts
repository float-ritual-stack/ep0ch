import type {Block} from "../../src/types";
import {runHerdrScenario} from "./herdr-runner";

// Detail draws what a rule decorates (PIE-600) under the note as written: a rule
// written while Detail is open is learned from the extensions event, not a restart.
const result = await runHerdrScenario({
  name: "detail-rule-decorations",
  async prepare() {},
  async run(s) {
    const meeting = await s.client.request<Block>({action: "create", text: "Committee [type::meeting] [when::Sat 10:00] [where::the shed]"});
    await s.revealTree(s.panes.tree, meeting.id);
    await s.keys(s.panes.tree, "enter");
    await s.waitVisible(s.panes.detail, "Committee");
    await s.checkpoint("01-note-before-rule");
    await s.client.request<Block>({action: "create", text: "Meetings [rule-name::meetings] [rule-match::type=meeting] [rule-decorate::card] [rule-fields::when] [rule-label::{{this.title}} at {{this.where}}]"});
    await s.waitVisible(s.panes.detail, "Committee at the shed");
    await s.checkpoint("02-rule-card-drawn");
  },
});
console.log(JSON.stringify(result));
if (result.status !== "passed") process.exitCode = 1;

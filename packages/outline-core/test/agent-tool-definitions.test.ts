import { expect, test } from "bun:test";
import { AGENT_TOOL_DEFINITIONS } from "../src/agent-tool-definitions";
import { FIX_BEFORE_DONE, SHAPE_LIMITS } from "../src/write-shape";

const tool = (name: string) => AGENT_TOOL_DEFINITIONS.find(t => t.name === name)!.description;
const NOTE_WRITERS = ["outline_create", "outline_edit", "outline_patch"];
const gate = FIX_BEFORE_DONE.replace(/:\s*$/, "");

// PIE-1270: the rule is next to the call, right after the first sentence, because a rule read once at the start fades.
test("the note write tools carry the house rules right after their first sentence, in numbers write-shape measures", () => {
  for (const name of NOTE_WRITERS) {
    const description = tool(name);
    const first = description.split(/\.\s/)[0]!;
    expect(description.slice(first.length + 2), name).toStartWith("Evan reads on a phone");
    expect(description, name).toContain(`under about ${SHAPE_LIMITS.title} characters`);
    expect(description, name).toContain("at most three sentences");
    expect(SHAPE_LIMITS.sentences).toBe(3);
    expect(description, name).toContain("one `- [ ]` line");
    expect(description, name).toContain("[needs::sysop");
    expect(description, name).toContain(gate);
  }
});

test("the comment tool carries the wall rule and the gate; the read tools carry neither", () => {
  const comment = tool("outline_comment");
  expect(comment).toContain("at most three sentences");
  expect(comment).toContain(gate);
  for (const name of ["outline_read", "outline_find", "outline_query"]) if (AGENT_TOOL_DEFINITIONS.some(t => t.name === name)) expect(tool(name), name).not.toContain(gate);
});

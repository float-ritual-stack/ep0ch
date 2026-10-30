// The navigator's answers (PIE-1443): relative date buckets (`group=updated:recent`) and a note's excerpt, both the
// service's, so every client draws the same groups and the same preview line. Fictional notes.
import { describe, expect, test } from "bun:test";
import { noteExcerpt } from "@ep0ch/outline-core/excerpt";
import { normalizeGroupField } from "../src/block-query";
import { projectBlock } from "../src/block-projection";
import { questionGroups, recentBucket } from "../src/question-answer";
import type { Block } from "../src/types";

// Thursday Oct 30 2026, mid-afternoon on this machine's wall clock.
const NOW = new Date(2026, 9, 30, 15, 0).getTime();
const at = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour).toISOString();

describe("relative date buckets", () => {
  test("a time falls in Today, Yesterday, Previous 7 days, Previous 30 days, then its month", () => {
    expect(recentBucket(at(10, 30, 1), NOW)).toBe("Today");
    expect(recentBucket(at(10, 29, 23), NOW)).toBe("Yesterday");
    expect(recentBucket(at(10, 24), NOW)).toBe("Previous 7 days");
    expect(recentBucket(at(10, 2), NOW)).toBe("Previous 30 days");
    expect(recentBucket(at(9, 12), NOW)).toBe("2026-09");
    expect(recentBucket(at(11, 3), NOW)).toBe("Later");
    expect(recentBucket("not a date", NOW)).toBeNull();
  });

  test("updated:recent is a group the service takes, its groups newest first", () => {
    expect(normalizeGroupField("updated:recent")).toBe("updated:recent");
    expect(normalizeGroupField("due:recent")).toBe("due:recent");
    const block = (id: string, updatedAt: string) => ({ id, updatedAt, createdAt: updatedAt, properties: [] }) as unknown as Block;
    const notes = [block("a", at(8, 1)), block("b", at(10, 30)), block("c", at(10, 25)), block("d", at(10, 29)), block("e", at(9, 3))];
    const groups = questionGroups(notes, notes, "updated:recent", () => [], NOW);
    expect(groups.map(g => [g.value, g.ids])).toEqual([["Today", ["b"]], ["Yesterday", ["d"]], ["Previous 7 days", ["c"]], ["2026-09", ["e"]], ["2026-08", ["a"]]]);
  });
});

describe("a note's excerpt", () => {
  test("the first lines after the title, properties and markup out, cut to length", () => {
    expect(noteExcerpt("Pea trellis plan [type::task]\n[stage::next]\n\nNetting arrives **Thursday**; see [[Garden]].\n- posts first")).toBe("Netting arrives Thursday; see Garden. posts first");
    expect(noteExcerpt("Only a title")).toBe("");
    // Tags ending a line are chips, drawn as chips; a tag in the words stays.
    expect(noteExcerpt("Standpipe\nThe lagging is on the top shelf. #frost/water #shed\n#compost")).toBe("The lagging is on the top shelf.");
    expect(noteExcerpt("Frost\n#frost lists every job.")).toBe("#frost lists every job.");
    // A figure is no preview; an embed says nothing; a labelled link says its label; an escape is dropped.
    expect(noteExcerpt("Board\n::graph-stat\n---\ntitle: Now\n---\n::\nSee ((7d9a1f40-0000-4000-8000-000000000001|the plan)) and !((7d9a1f40-0000-4000-8000-000000000002)) \u001b[31mnow.")).toBe("See the plan and [31mnow.");
    expect(noteExcerpt(`Long\n${"word ".repeat(100)}`, 40).length).toBeLessThanOrEqual(40);
  });

  test("blocks.read answers it as a field", () => {
    const block = { id: "x", text: "Seed order\nForty packets of sugar snap.", properties: [], parentId: null, position: 0 } as unknown as Block;
    expect(projectBlock(block, false, ["excerpt"])).toEqual({ id: "x", excerpt: "Forty packets of sugar snap." });
  });
});

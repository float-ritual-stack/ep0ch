// `ep0ch --skill`: the stack's skills from the door and the installed Outliner, and one skill's path.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatSkills, skillCommand, skillsIn } from "../src/skills";

const root = mkdtempSync(join(tmpdir(), "ep0ch-skills-"));
const door = join(root, "door"), outliner = join(root, "outliner");
const skill = (dir: string, folder: string, fm: string) => {
  mkdirSync(join(dir, folder), { recursive: true });
  writeFileSync(join(dir, folder, "SKILL.md"), `---\n${fm}\n---\n\n# ${folder}\n`);
};
skill(join(door, "skills"), "ep0ch", "name: ep0ch\ndescription: Use when driving a door.");
skill(join(outliner, "pi-extension/skills"), "garden-planning", 'name: garden-planning\ndescription: "Use to plan the allotment beds."');
skill(join(outliner, "pi-extension/skills"), "no-name-field", "description: Falls back to the folder name.");
skill(join(outliner, ".agents/skills"), "compost-review", "name: compost-review\ndescription: Contributor skill.");
mkdirSync(join(outliner, "pi-extension/skills/not-a-skill"), { recursive: true });   // no SKILL.md: skipped
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("ep0ch --skill", () => {
  test("lists the shipped skills of both, with their source; folders without SKILL.md are skipped", () => {
    const r = skillCommand(["--skill"], door, outliner);
    expect(r.code).toBe(0);
    const names = r.out.split("\n").map(l => l.split(/\s+/)[0]);
    expect(names).toEqual(["ep0ch", "garden-planning", "no-name-field"]);
    expect(r.out).toMatch(/^garden-planning\s+outliner\s+Use to plan the allotment beds\.$/m);
    expect(r.out).not.toContain("compost-review");
  });

  test("--all adds contributor skills", () => {
    expect(skillCommand(["--skill", "--all"], door, outliner).out).toMatch(/^compost-review\s+outliner \(contributor\)/m);
  });

  test("a name prints the path of its SKILL.md; contributor skills are found by name too", () => {
    expect(skillCommand(["--skill", "garden-planning"], door, outliner)).toEqual({ out: join(outliner, "pi-extension/skills/garden-planning/SKILL.md"), code: 0 });
    expect(skillCommand(["--skill", "compost-review"], door, outliner).out).toBe(join(outliner, ".agents/skills/compost-review/SKILL.md"));
  });

  test("an unknown name exits 1 and suggests near names", () => {
    const r = skillCommand(["--skill", "garden"], door, outliner);
    expect(r.code).toBe(1);
    expect(r.out).toBe("no skill named garden; did you mean garden-planning?");
  });

  test("without the Outliner plugin, the door's skills are listed and it says why the rest aren't", () => {
    const r = skillCommand(["--skill"], door, null);
    expect(r.out).toContain("ep0ch");
    expect(r.out).toContain("wasn't found through Herdr");
  });

  test("the door ships its own skill", () => {
    const own = skillsIn([{ source: "ep0ch", dir: join(import.meta.dir, "../skills") }]);
    expect(own.map(s => s.name)).toContain("ep0ch");
    expect(formatSkills([])).toBe("no skills found");
  });
});

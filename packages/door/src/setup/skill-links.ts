// The agent skills this checkout ships, linked where Claude Code finds them (`~/.claude/skills/<name>`, or
// `$CLAUDE_CONFIG_DIR/skills`) and, when the folder is there, `~/.agents/skills/<name>` (shared skills). Install owns
// these links the way it owns the extensions' (links.ts). A symlink there that is another checkout's copy of the same
// skill (its folder has the same name and its SKILL.md the same `name:`; the old ep0ch-door checkout's, say) is
// replaced, so `/ep0ch-core` never reads a stale copy; a real folder, or a link to some other skill, is never install's.
//
// Which skills: every one in the door's `skills/`, and of the outliner's `pi-extension/skills/` (written for Pi, whose
// tools are `outliner_*`) only those that also say how to do it with Claude Code's tools (the Claude mod's `outline_*`).
import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { readSkill, skillsIn } from "../skills";
import { linkAt, type OwnedLink, type StaleLink, staleLinks } from "./links";

type Env = Record<string, string | undefined>;

/**
 * The outliner's Pi skills Claude Code can follow too. outliner-documentation has a Claude Code section (outline_find,
 * outline_read, outline_edit). outliner-workflow and work-placeholder-resolver run on Pi-only tools (outliner_task,
 * outliner_delivery, outliner_roadmap_create, outliner_work_id) Claude Code doesn't have, so they'd send it astray.
 */
export const CLAUDE_CODE_OUTLINER_SKILLS: readonly string[] = ["outliner-documentation"];

export interface SkillLinkFacts {
  /** The skills folders install links from (the door's, the outliner's): a stale link points into one of these. */
  roots: string[];
  /** The folders it links into: Claude Code's, and the shared one when it exists. */
  into: string[];
  links: OwnedLink[];
  stale: StaleLink[];
  record?: string;
}

/** The skills folders this checkout links from, with the skills meant for agents in each. */
export function shippedSkills(door: string, outliner: string): { roots: string[]; skills: { name: string; dir: string }[] } {
  const roots = [join(door, "skills"), join(outliner, "pi-extension/skills")];
  const skills = skillsIn([{ source: "ep0ch", dir: roots[0]! }, { source: "outliner", dir: roots[1]! }])
    .map(s => ({ source: s.source, dir: dirname(s.path), name: basename(dirname(s.path)) }))
    .filter(s => s.source === "ep0ch" || CLAUDE_CODE_OUTLINER_SKILLS.includes(s.name))
    .map(({ name, dir }) => ({ name, dir }));
  return { roots, skills };
}

/** Whether a folder is another copy of the skill `name`: the same folder name, and its SKILL.md says the same `name:`. */
export function sameSkill(name: string, target: string): boolean {
  if (basename(target) !== name) return false;
  // No folder name as the fallback: a SKILL.md without `name:` isn't known to be the same skill.
  try { return readSkill(join(target, "SKILL.md"), "", "").name === name; } catch { return false; }
}

/** Each shipped skill's link in each folder it goes in, as things stand, and install's links whose skill is gone. */
export function skillLinkFacts(o: { door: string; outliner: string; env: Env; home: string; record?: string }): SkillLinkFacts {
  const { roots, skills } = shippedSkills(o.door, o.outliner);
  const claude = join(o.env.CLAUDE_CONFIG_DIR || join(o.home, ".claude"), "skills");
  const shared = join(o.home, ".agents", "skills");
  const into = [claude, ...(existsSync(shared) ? [shared] : [])];
  const links = into.flatMap(dir => skills.map(s => linkAt(s.dir, join(dir, s.name), t => sameSkill(s.name, t))));
  return { roots, into, links, stale: staleLinks(into, roots), ...(o.record ? { record: o.record } : {}) };
}

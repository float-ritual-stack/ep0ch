// `ep0ch --skill`: the skills this stack ships, and where each one's SKILL.md is. Sources: the door's own
// `skills/`, and the outliner's `pi-extension/skills/`: the installed plugin's, found through Herdr, else the
// outliner package beside the door in this repository. `--all` adds contributor skills (`.agents/skills/` in both).
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { ellipsize } from "./style";

export interface Skill { name: string; source: string; description: string; path: string }
export interface SkillRoot { source: string; dir: string }

/** A SKILL.md's frontmatter `name` and `description` (the folder name when there's no `name`). */
export function readSkill(path: string, folder: string, source: string): Skill {
  const text = readFileSync(path, "utf8");
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const field = (k: string) => new RegExp(`^${k}:\\s*(.*)$`, "m").exec(fm)?.[1]?.trim().replace(/^["']|["']$/g, "") ?? "";
  return { name: field("name") || folder, source, description: field("description"), path };
}

/** Every `<dir>/<folder>/SKILL.md` under the given roots, sorted by name within each source. */
export function skillsIn(roots: readonly SkillRoot[]): Skill[] {
  const out: Skill[] = [];
  for (const { source, dir } of roots) {
    if (!existsSync(dir)) continue;
    const found = readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory() && existsSync(join(dir, d.name, "SKILL.md")))
      .map(d => readSkill(join(dir, d.name, "SKILL.md"), d.name, source))
      .sort((a, b) => a.name.localeCompare(b.name));
    out.push(...found);
  }
  return out;
}

/** The Herdr command: HERDR_BIN_PATH (what Herdr sets in its panes, and what the Outliner uses), else `herdr`. */
export const herdrBin = (env: Record<string, string | undefined> = process.env) => env.HERDR_BIN_PATH || "herdr";

/**
 * The installed Outliner plugin as Herdr records it (`herdr plugin list --json`): its root, manifest, source
 * (`kind` local for a linked checkout, github for a managed install, with `owner`, `repo`, `requested_ref`
 * and `resolved_commit`) and actions. Null when Herdr or the plugin isn't there.
 */
export function outlinerPlugin(env: Record<string, string | undefined> = process.env): any | null {
  try {
    const r = Bun.spawnSync([herdrBin(env), "plugin", "list", "--plugin", "float.pi-outliner", "--json"], { stdout: "pipe", stderr: "ignore", env: env as Record<string, string> });
    if (r.exitCode !== 0) return null;
    const plugins = JSON.parse(r.stdout.toString())?.result?.plugins;
    const hit = Array.isArray(plugins) ? plugins.filter((p: any) => p?.plugin_id === "float.pi-outliner") : [];
    return hit.length === 1 && typeof hit[0].plugin_root === "string" && hit[0].plugin_root.startsWith("/") ? hit[0] : null;
  } catch { return null; }
}

/**
 * The outliner's root: the installed plugin's, as Herdr reports it, else the outliner package beside the door in
 * this repository (packages/outliner); null when neither is there.
 */
export function outlinerRoot(doorRoot = resolve(import.meta.dir, "..")): string | null {
  const sibling = resolve(doorRoot, "../outliner");
  return outlinerPlugin()?.plugin_root ?? (existsSync(join(sibling, "herdr-plugin.toml")) ? sibling : null);
}

/** Where to look: shipped skills, and contributor skills with `all`. */
export function skillRoots(doorRoot: string, outliner: string | null, all: boolean): SkillRoot[] {
  const roots: SkillRoot[] = [{ source: "ep0ch", dir: join(doorRoot, "skills") }];
  if (outliner) roots.push({ source: "outliner", dir: join(outliner, "pi-extension/skills") });
  if (all) {
    roots.push({ source: "ep0ch (contributor)", dir: join(doorRoot, ".agents/skills") });
    if (outliner) roots.push({ source: "outliner (contributor)", dir: join(outliner, ".agents/skills") });
  }
  return roots;
}

/** The list: name, source and the start of the description, one line each. */
export function formatSkills(skills: readonly Skill[], width = 100): string {
  if (!skills.length) return "no skills found";
  const n = Math.max(4, ...skills.map(s => s.name.length)), src = Math.max(6, ...skills.map(s => s.source.length));
  const room = Math.max(20, width - n - src - 4);
  const cut = (s: string) => ellipsize(s, room);
  return skills.map(s => `${s.name.padEnd(n)}  ${s.source.padEnd(src)}  ${cut(s.description)}`).join("\n");
}

/**
 * `ep0ch --skill [--all] [<name>]`: the list, or the path of one skill's SKILL.md (every match, one per line,
 * when two sources share a name). Unknown name: exit 1 with the names that contain it.
 */
export function skillCommand(args: readonly string[], doorRoot = resolve(import.meta.dir, ".."), outliner = outlinerRoot()): { out: string; code: number } {
  const all = args.includes("--all");
  const name = args.find(a => a !== "--skill" && a !== "--all" && !a.startsWith("--"));
  const skills = skillsIn(skillRoots(doorRoot, outliner, all || !!name));
  const note = outliner ? "" : "\n(the Outliner plugin wasn't found through Herdr, so its skills aren't listed)";
  if (!name) return { out: formatSkills(skills, process.stdout.columns ?? 100) + note, code: 0 };
  const hits = skills.filter(s => s.name === name);
  if (hits.length) return { out: hits.map(s => s.path).join("\n"), code: 0 };
  const near = skills.filter(s => s.name.includes(name) || name.includes(s.name)).map(s => s.name);
  return { out: `no skill named ${name}${near.length ? `; did you mean ${near.join(", ")}?` : ""}${note}`, code: 1 };
}

// `ep0ch doctor`: every piece of the stack, its state (✓ current, ! behind, ✗ missing, · for information)
// and the exact command that fixes it. Read-only; built from the facts (model.ts) so tests describe machines.
import { basename, dirname, join, resolve } from "node:path";
import { byFolder, lnCommand, sh } from "./links";
import { clauses } from "./progress";
import { hyperOn } from "../hyper";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { DRAWER_TILE_ID } from "../desk/agent-env";
import { CHANGE_AGENT } from "../desk/drawer-program";
import { backupChecks } from "./backups";
import { resticChecks } from "../backup/setup";
import { KEYED_ACTIONS, MIN_BUN, PLUGIN_ID, type Facts, short, staleness } from "./model";
import { ep0ch, sessionFlags } from "../session/place";
import { chooseLinkDir, claudeModState, oldMentionsAllowlist, hostRestartHint, hostUnitCommand, mcpBehind, mcpIsHere, mcpRestartCommand, linkStep, pluginStep, repoStep, schemaStep, sessionName, sessionVerdict, unitChanges } from "./plan";

/** unknown: it couldn't be checked (a fetch failed), so it isn't counted as current. */
export type CheckStatus = "ok" | "behind" | "missing" | "info" | "unknown";
export interface Check { group: string; name: string; status: CheckStatus; detail: string; fix?: string }

export const MARK: Record<CheckStatus, string> = { ok: "✓", behind: "!", missing: "✗", info: "·", unknown: "?" };

/** a.b.c ≥ min.b.c */
export function versionAtLeast(version: string, min: string): boolean {
  const a = version.split(/[.-]/).map(Number), b = min.split(".").map(Number);
  for (let i = 0; i < b.length; i++) { const x = a[i] ?? 0, y = b[i]!; if (x !== y) return x > y; }
  return true;
}

export function doctorChecks(f: Facts): Check[] {
  const out: Check[] = [];
  const add = (group: string, name: string, status: CheckStatus, detail: string, fix?: string) => out.push({ group, name, status, detail, ...(fix ? { fix } : {}) });

  // bun
  if (!f.bun.path) add("bun", "bun", "missing", "not on PATH", f.platform === "macos" ? "brew install oven-sh/bun/bun" : "curl -fsSL https://bun.sh/install | bash");
  else if (f.bun.version && !versionAtLeast(f.bun.version, MIN_BUN)) add("bun", "bun", "behind", `${f.bun.path} ${f.bun.version}; the Outliner needs ${MIN_BUN} or newer`, f.platform === "macos" && f.bun.path.startsWith("/opt/homebrew") ? "brew upgrade bun" : "bun upgrade");
  else add("bun", "bun", "ok", `${f.bun.path} ${f.bun.version ?? "(version unknown)"}`);

  // the ep0ch checkout: the door, the outliner and outline-core, one repo
  const repo = repoStep(f);
  const c = f.repo.checkout;
  add("ep0ch", "checkout", repo.status === "skip" ? "ok" : repo.unchecked ? "unknown" : "behind", `${c.root}${c.head ? ` at ${short(c.head)}${c.branch ? ` on ${c.branch}` : ""}` : ""}; ${repo.why}`,
    repo.status === "do" ? repo.commands.filter(x => !x.includes("# when")).join(" && ") : undefined);
  add("ep0ch", "bun install", f.repo.deps.needed ? "behind" : "ok", f.repo.deps.why, f.repo.deps.needed ? `(cd ${c.root} && bun install --frozen-lockfile)` : undefined);
  add("ep0ch", "protocol", f.repo.protocol === null ? "missing" : "info",
    f.repo.protocol === null ? `couldn't read packages/outline-core/src/protocol.ts in ${f.repo.root}` : `protocol ${f.repo.protocol}`);
  if (f.repo.protocol !== null && f.repo.protocol !== PROTOCOL) add("ep0ch", "this door", "behind", `this door speaks protocol ${PROTOCOL} and the checkout ${f.repo.protocol}: restart the door on the checkout's code`);
  const link = linkStep(f);
  if (f.ep0ch.pointsHere) add("ep0ch", "ep0ch on PATH", "ok", `${f.ep0ch.found} → ${f.repo.entry}`);
  else if (f.ep0ch.found) add("ep0ch", "ep0ch on PATH", "behind", link.why, link.commands[0]);
  else add("ep0ch", "ep0ch on PATH", "missing", `not on PATH${chooseLinkDir(f.linkDirs) ? `; install links it in ${chooseLinkDir(f.linkDirs)}` : ""}`, link.commands[0] ?? link.why);
  // The door sessions (PIE-418), one per outline: each daemon, on the checkout's code or behind it.
  if (f.sessions !== undefined) {
    if (!f.sessions.length) add("ep0ch", "sessions", "info", `none running · \`${ep0ch().trim()}\` starts one`);
    for (const sx of f.sessions) {
      const v = sessionVerdict(sx, f, { status: "skip" });
      add("ep0ch", `session ${sessionName(sx)}`, v.status === "do" ? "behind" : /another checkout|left for you/.test(v.why) ? "info" : "ok", `pid ${sx.pid} · ${sx.clients} terminal${sx.clients === 1 ? "" : "s"} attached · ${sx.programs} program${sx.programs === 1 ? "" : "s"} in its tiles; ${v.brief}`, v.status === "do" ? `${ep0ch(process.env, sx)}session upgrade ${sessionFlags({ place: sx })}` : undefined);
    }
  }

  // The art packs (PIE-596): optional. Without them every screen draws, with no art; the checkout's own few pieces will do.
  if (f.art) {
    const few = join(f.repo.door, "test/fixtures/packs");
    if (f.art.packs) add("ep0ch", "art packs", "ok", `${f.art.packs} in ${f.art.dir}`);
    else add("ep0ch", "art packs", "info", `none in ${f.art.dir}${f.art.fromEnv ? " (EP0CH_PACKS)" : ""}: the menus draw without art`,
      `export EP0CH_PACKS=<the folder with the woe*.zip packs>, or the checkout's few pieces: export EP0CH_PACKS=${sh(few)}`);
  }

  // the Outliner plugin: Herdr's link to this checkout's packages/outliner
  const plugin = pluginStep(f);
  const p = f.plugin;
  if (!p) add("plugin", PLUGIN_ID, "missing", plugin.why, plugin.commands.join(" && "));
  else {
    // A managed install whose source couldn't be reached (ls-remote failed) isn't known to be current either.
    const unreachable = p.kind === "github" && !!p.source?.commit && !p.remote?.commit && !!p.remote?.error && p.remote.error !== "not fetched";
    const how = p.kind === "local" ? `linked ${p.root}` : `managed install ${p.root}`;
    const status = plugin.status === "skip" ? "ok" : plugin.status === "do" ? "behind" : unreachable ? "unknown" : p.kind === "github" && !p.remote?.commit && p.source?.repo === "ep0ch" ? "info" : "behind";
    const commit = p.kind === "github" && p.source?.commit ? ` at ${short(p.source.commit)}` : "";
    // A link to this checkout: the plan's words already name the folder.
    const said = plugin.why.startsWith(`linked to ${p.root}`) ? `${plugin.why}${p.enabled ? "" : " (disabled in Herdr)"}` : `${how}${commit}${p.enabled ? "" : " (disabled in Herdr)"}; ${plugin.why}`;
    add("plugin", "in Herdr", status, said, plugin.status === "skip" ? undefined : plugin.commands.join(" && ") || "ep0ch install --apply");
  }

  // The remote MCP gateway (its own unit): on the checkout's code, started before the checkout last moved, or unknown.
  if (f.mcp) {
    const m = f.mcp, u = m.unit, here = mcpIsHere(f), behind = here ? mcpBehind(f, false) : null;
    const unknown = here && u.state?.active && !behind && m.behind === undefined;
    add("ep0ch", "mcp gateway", !here || !u.state?.active ? "info" : behind ? "behind" : unknown ? "unknown" : "ok",
      !here ? (m.door ? `${u.kind} ${u.name} runs ${m.door}, not this checkout's door` : `${u.kind} ${u.name}: which checkout's door it runs can't be told from ${u.path}`)
        : !u.state?.active ? `${u.kind} ${u.name} isn't running${u.state ? ` (${u.state.detail})` : ""}`
        : behind ? `${u.kind} ${u.name} runs older code than the checkout: ${behind}`
        : unknown ? `${u.kind} ${u.name}: whether it runs the checkout's code can't be told (no start time or reflog)`
        : `${u.kind} ${u.name} runs the checkout's code${m.runs ? ` (${short(m.runs)})` : ""}`,
      behind ? `ep0ch install --apply restarts it (${mcpRestartCommand(m)})` : unknown ? mcpRestartCommand(m) : here && !u.state?.active ? hostUnitCommand({ ...u, outlines: "", stale: [] }, "start") : undefined);
  }
  // outlines: the folder, the host serving it by name, its unit, and which outline this folder opens
  const h = f.host;
  add("outlines", "folder", "info", `${h.folder} · ${f.databases.length ? f.databases.map(d => d.name).join(", ") : "no outlines yet"}`);
  const unit = h.unit ? `${h.unit.kind} ${h.unit.name}, ${h.unit.path}${h.unit.state ? `; ${h.unit.state.detail}` : ""}` : "no service unit";
  if (!h.running) {
    add("outlines", "host", "missing", `nothing answers at ${h.socket} (${unit})`,
      h.unit ? hostUnitCommand(h.unit, "start") : `bun ${f.repo.outliner}/src/host-main.ts (or a ${f.platform === "macos" ? "launchd agent" : "systemd user unit"} running it)`);
  } else {
    const missing = staleness(h, f.repo.protocol);
    const names = h.outlines.map(o => `${o.name}${o.open ? "" : " (closed)"}`).join(", ");
    // The socket answers, but the unit says its job isn't running: something else serves it (a host started by hand).
    const stray = h.unit?.state?.active === false ? `; ${h.unit.kind} isn't running it, so another process answers` : "";
    add("outlines", "host", missing.length || stray ? "behind" : "ok",
      `${h.socket} (${unit}); serves ${names || "no outlines yet"}${h.protocol ? `; protocol ${h.protocol}` : ""}${missing.length ? `; runs old code: ${missing.join(", ")}` : ""}${stray}`,
      missing.length ? hostRestartHint(f) : undefined);
  }
  // Each outline's schema against what the checkout's code opens (PIE-617): one behind is refused by the host.
  if (f.schema && f.schema.head.version !== null) {
    const to = f.schema.head.version, s = schemaStep(f, false);
    const behind = f.schema.outlines.filter(o => o.version !== null && o.version < to), ahead = f.schema.outlines.filter(o => o.version !== null && o.version > to);
    const unread = f.schema.outlines.filter(o => o.version === null);
    if (behind.length) add("outlines", "schema", "behind", `${behind.map(o => `${o.name} is schema ${o.version}`).join(", ")}; the checkout's code opens only schema ${to}, so the host refuses ${behind.length === 1 ? "it" : "them"}`,
      s?.status === "do" ? "ep0ch install --apply" : s?.why);
    else if (f.schema.outlines.length) add("outlines", "schema", unread.length ? "unknown" : "ok", `${unread.length ? `couldn't read ${unread.map(o => `${o.name}'s (${o.error})`).join(", ")}; ` : ""}${f.schema.outlines.filter(o => o.version !== null).map(o => o.name).join(", ")} at schema ${to}, what the checkout's code opens`);
    if (ahead.length) add("outlines", "schema ahead", "behind", `${ahead.map(o => `${o.name} is schema ${o.version}`).join(", ")}, newer than the checkout's code opens (${to})`, repo.status === "do" ? "ep0ch install --apply (updates the checkout)" : undefined);
  }
  const change = unitChanges(f);
  if (h.unit && change) add("outlines", "host unit", "behind", `${h.unit.path} is from before outlines by name (PIE-530) or another checkout`, change);
  // What the drawer's own tab runs in a door opened here (PIE-498), and why: the person's program and folder, or the rule's.
  if (f.drawer) add("ep0ch", "drawer", "info", `runs ${f.drawer.cmd.join(" ")} (${f.drawer.programWhy}) in ${f.drawer.cwd} (${f.drawer.folderWhy})`);
  // Each outline session's drawer agent, where the choice came from, its Herdr pane, and how to change it.
  for (const d of f.drawers ?? []) add("ep0ch", `drawer ${d.session}`, "info", `runs ${d.cmd.map(c => c.split("/").pop()).join(" ")} (${d.programWhy})${d.pane ? ` · Herdr pane ${d.pane}` : ""}`, `change it: ${CHANGE_AGENT}${d.from === "env" ? " (and unset EP0CH_DAILY_AGENT, which overrides it)" : ""}`);
  if (f.here) {
    if (f.here.outline) add("outlines", "this folder", "info", `${f.here.folder} opens ${f.here.why}`);
    else add("outlines", "this folder", "info", `${f.here.folder}: ${f.here.unnamed}${f.here.guess ? `; ep0ch init would start "${f.here.guess}"` : ""}`);
  }

  // other machines: each one's forward, as it is (doctor starts none)
  for (const m of f.machines ?? []) {
    const what = `${m.socket}${m.here ? " (this folder's)" : ""}`;
    if (m.answers) add("machines", m.machine, "ok", `forward up at ${what}; serves ${m.outlines?.length ? m.outlines.join(", ") : "no outlines yet"}`);
    else if (m.connected) add("machines", m.machine, "behind", `connected, but no outline host answers through ${what}`, `ssh ${m.machine} ep0ch status (its host), or ep0ch --machine ${m.machine} (starts the forward again)`);
    else add("machines", m.machine, "info", `no forward running (${what}) · a door on it starts one (ep0ch --machine ${m.machine})`);
  }

  // backups: each Litestream unit, its log, and how far each replica (or mirror) trails
  if (f.backups) for (const c of backupChecks(f.backups, f.home)) add("backups", c.name, c.status, c.detail, c.fix);
  // and the restic job (PIE-607): its units, each outline's newest snapshot, the mirrors, the drill
  if (f.restic) for (const c of resticChecks(f.restic)) add("backups", c.name, c.status, c.detail, c.fix);

  // Herdr
  if (!f.herdr.path) add("herdr", "herdr", "missing", "not on PATH", "see https://herdr.dev");
  else {
    add("herdr", "server", f.herdr.server ? "ok" : "missing", f.herdr.server ? `running (${f.herdr.path} ${f.herdr.version ?? ""})`.replace(" )", ")") : "not running", f.herdr.server ? undefined : "herdr");
    const missing = KEYED_ACTIONS.filter(a => !f.herdr.keys[a]);
    const bound = KEYED_ACTIONS.filter(a => f.herdr.keys[a]).map(a => `${a} ${f.herdr.keys[a]}`).join(", ");
    add("herdr", "keys", missing.length ? "missing" : "ok", missing.length ? `no key for ${missing.join(", ")} in ${f.herdr.configPath}${bound ? ` (bound: ${bound})` : ""}` : bound,
      missing.length ? `add [[keys.command]] entries (type = "plugin_action", command = "${PLUGIN_ID}.<action>"), or run the Outliner's install.sh` : undefined);
    const unregistered = p ? KEYED_ACTIONS.filter(a => !p.actions.includes(a)) : [];
    if (unregistered.length) add("herdr", "actions", "behind", `the plugin doesn't register ${unregistered.join(", ")}`, "update the plugin (ep0ch install --apply)");
  }

  // The hyper layer (PIE-699): off unless asked for; Herdr passes the chord on unless its own config binds it.
  {
    const layer = hyperOn() ? "on (EP0CH_HYPER)" : "off · EP0CH_HYPER=1, or `ep0ch act hyper.set on=true` in a door, turns it on";
    const taken = f.herdr.hyperChords ?? [];
    if (taken.length) add("ep0ch", "hyper keys", "behind", `layer ${layer}; Herdr's ${f.herdr.configPath} binds ${taken.join(", ")}, which Herdr takes before a pane's program sees ⌃⌥⇧⌘ chords`, `remove or change those keys entries, then herdr server reload-config`);
    else add("ep0ch", "hyper keys", "info", `layer ${layer}; ⌃⌥⇧⌘ and a key needs a terminal sending the Kitty keyboard protocol and a key mapped to ⌃⌥⇧⌘ (Raycast's Hyper Key, Karabiner)${f.herdr.path ? `; Herdr ${f.herdr.version ?? ""} passes them on as Kitty reports and binds none by default (checked with injected keys: a physical keyboard is yours to check)` : ""} · in a door, \`ep0ch act keys.probe\` shows what a chord arrives as`);
  }

  // Claude
  const mod = claudeModState(f);
  add("claude", "claude-mod", mod.status, mod.detail, mod.fix);
  const old = oldMentionsAllowlist(f);
  if (old) add("claude", "mentions", "info", old);
  if (f.claude.forceHyperlink !== undefined) add("claude", "FORCE_HYPERLINK", "info", `set to ${f.claude.forceHyperlink}: a known issue (PIE-486)`);
  for (const c of doorAgentChecks(f)) out.push(c);
  for (const c of skillChecks(f)) out.push(c);
  return out;
}

/**
 * The shipped agent skills' links (src/setup/skill-links.ts): ✓ into this checkout, ! a symlink pointing elsewhere (an
 * old checkout's copy, which install replaces, or anything else, which it leaves), ✗ missing, and a real folder said
 * and left: it's never install's.
 */
export function skillChecks(f: Facts): Check[] {
  if (!f.skills) return [];
  const out: Check[] = [];
  const add = (name: string, status: CheckStatus, detail: string, fix?: string) => out.push({ group: "skills", name, status, detail, ...(fix ? { fix } : {}) });
  // The links already this checkout's: one line per folder, by name (the folder is the line's name).
  for (const [dir, names] of byFolder(f.skills.links.filter(l => l.state === "ours").map(l => l.dest))) add(`${basename(dirname(dir))}/${basename(dir)}`, "ok", `${names.length} linked into this checkout: ${names.join(" · ")}`);
  for (const l of f.skills.links) {
    const name = basename(l.dest);
    if (l.state === "ours") continue;
    else if (l.state === "missing") add(name, "missing", `no ${l.dest}`, `${lnCommand(l.src, l.dest)}   (or ep0ch install --apply)`);
    else if (l.state === "replace") add(name, "behind", `${l.dest} → ${l.was}, another checkout's copy; install replaces it`, `${lnCommand(l.src, l.dest, true)}   (or ep0ch install --apply)`);
    else if (l.was) add(name, "behind", `${l.dest} → ${l.was}, not this skill's copy; install leaves it`, `${lnCommand(l.src, l.dest, true)}   (if it should be this checkout's)`);
    else add(name, "info", `${l.dest} is yours (not a link); install leaves it`);
  }
  for (const s of f.skills.stale) add(basename(s.dest), "behind", `${s.dest} → ${s.target}, a skill that's gone`, `rm ${sh(s.dest)}   (or ep0ch install --apply)`);
  return out;
}

/** The fix for a door agent that doesn't know what it should: a restart, which keeps the conversation. */
export const AGENT_RESTART_FIX = {
  drawer: "restart it: the ⟳ on its door's drawer chip (▲ claude), alt+R, or `ep0ch act agent.restart` (it keeps the conversation)",
  tile: "restart it: /exit in its tile, then claude --continue",
};
/** The door's own agent (the ▲ claude chip, D's daily tile, its Herdr pane): `agent.restart` restarts it. */
const isDrawerAgent = (env: Record<string, string> | null) => env?.EP0CH_TILE_ID === DRAWER_TILE_ID || /(^| › )herdr:[^›]*$/.test(env?.EP0CH_NEST ?? "") && !!env?.EP0CH_NEST?.includes("door:");

/** Door agents (Claude in a door tile or the door's Herdr pane) running on an older mod, or without door tools. */
export function doorAgentChecks(f: Facts): Check[] {
  const agents = f.claude.agents;
  if (!agents) return [];
  if (!agents.length) return [{ group: "claude", name: "door agents", status: "info", detail: "no Claude running in a door tile or the door's Herdr pane" }];
  return agents.map(a => {
    const where = a.env?.EP0CH_NEST?.split(" › ").at(-1) ?? a.env?.EP0CH_TILE ?? "a door";
    const name = `agent ${a.pid}`;
    const detail = `${where}: ${a.knows.why}`;
    if (a.knows.state === "current") return { group: "claude", name, status: "ok" as const, detail };
    if (a.knows.state === "unknown") return { group: "claude", name, status: "info" as const, detail };
    return { group: "claude", name, status: "behind" as const, detail, fix: isDrawerAgent(a.env) ? AGENT_RESTART_FIX.drawer : AGENT_RESTART_FIX.tile };
  });
}

export function doctorReport(f: Facts) {
  const checks = doctorChecks(f);
  return { platform: f.platform, ok: checks.every(c => c.status === "ok" || c.status === "info"), checks };
}

export function formatDoctor(f: Facts, checks = doctorChecks(f)): string {
  const lines = [`ep0ch doctor · ${f.platform} · ${f.home}`];
  let group = "";
  const width = Math.max(...checks.map(c => c.name.length));
  for (const c of checks) {
    if (c.group !== group) { group = c.group; lines.push("", group); }
    // A detail of several clauses: one a line, under the first.
    const [first, ...more] = clauses(c.detail);
    lines.push(`  ${MARK[c.status]} ${c.name.padEnd(width)}  ${first ?? ""}`, ...more.map(m => `    ${" ".repeat(width)}  ${m}`));
    if (c.fix) lines.push(`    ${" ".repeat(width)}  fix: ${c.fix}`);
  }
  const bad = checks.filter(c => c.status === "behind" || c.status === "missing").length;
  const unknown = checks.filter(c => c.status === "unknown").length;
  const unchecked = unknown ? `${unknown} couldn't be checked (? above)` : "";
  lines.push("", bad ? `${bad} to fix${unchecked ? `, ${unchecked}` : ""}; \`ep0ch install\` shows the plan, \`ep0ch install --apply\` runs it` : unchecked ? `${unchecked}; the rest is current` : "all current");
  return lines.join("\n");
}

// `ep0ch doctor`: every piece of the stack, its state (✓ current, ! behind, ✗ missing, · for information)
// and the exact command that fixes it. Read-only; built from the facts (model.ts) so tests describe machines.
import { basename } from "node:path";
import { lnCommand, sh } from "./links";
import { PROTOCOL } from "@ep0ch/outline-core/protocol";
import { DOCK_TILE_ID } from "../desk/agent-env";
import { KEYED_ACTIONS, MIN_BUN, PLUGIN_ID, type Facts, short, staleness } from "./model";
import { ep0ch, sessionFlags } from "../session/place";
import { chooseLinkDir, claudeModState, oldMentionsAllowlist, hostRestartHint, hostUnitCommand, linkStep, pluginStep, repoStep, sessionName, sessionVerdict, unitChanges } from "./plan";

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
      add("ep0ch", `session ${sessionName(sx)}`, v.status === "do" ? "behind" : /another checkout|left for you/.test(v.why) ? "info" : "ok", `pid ${sx.pid} · ${sx.clients} terminal${sx.clients === 1 ? "" : "s"} attached · ${sx.programs} program${sx.programs === 1 ? "" : "s"} in its tiles; ${v.why}`, v.status === "do" ? (sx.old ? `${ep0ch()}session upgrade` : `${ep0ch(process.env, sx)}session upgrade ${sessionFlags({ place: sx })}`) : undefined);
    }
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
    add("plugin", "in Herdr", status, `${how}${commit}${p.enabled ? "" : " (disabled in Herdr)"}; ${plugin.why}`, plugin.status === "skip" ? undefined : plugin.commands.join(" && ") || "ep0ch install --apply");
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
  const change = unitChanges(f);
  if (h.unit && change) add("outlines", "host unit", "behind", `${h.unit.path} is from before outlines by name (PIE-530) or another checkout`, change);
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
  for (const l of f.skills.links) {
    const name = basename(l.dest);
    if (l.state === "ours") add(name, "ok", `${l.dest} → ${l.src}`);
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
  dock: "restart it: the ⟳ on its door's ▲ claude chip, alt+R, or `ep0ch act agent.restart` (it keeps the conversation)",
  tile: "restart it: /exit in its tile, then claude --continue",
};
/** The door's own agent (the ▲ claude chip, D's daily tile, its Herdr pane): `agent.restart` restarts it. */
const isDockAgent = (env: Record<string, string> | null) => env?.EP0CH_TILE_ID === DOCK_TILE_ID || /(^| › )herdr:[^›]*$/.test(env?.EP0CH_NEST ?? "") && !!env?.EP0CH_NEST?.includes("door:");

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
    return { group: "claude", name, status: "behind" as const, detail, fix: isDockAgent(a.env) ? AGENT_RESTART_FIX.dock : AGENT_RESTART_FIX.tile };
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
    lines.push(`  ${MARK[c.status]} ${c.name.padEnd(width)}  ${c.detail}`);
    if (c.fix) lines.push(`    ${" ".repeat(width)}  fix: ${c.fix}`);
  }
  const bad = checks.filter(c => c.status === "behind" || c.status === "missing").length;
  const unknown = checks.filter(c => c.status === "unknown").length;
  const unchecked = unknown ? `${unknown} couldn't be checked (? above)` : "";
  lines.push("", bad ? `${bad} to fix${unchecked ? `, ${unchecked}` : ""}; \`ep0ch install\` shows the plan, \`ep0ch install --apply\` runs it` : unchecked ? `${unchecked}; the rest is current` : "all current");
  return lines.join("\n");
}
